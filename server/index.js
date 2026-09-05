const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const ICONS_DIR = path.join(DATA_DIR, 'icons');
const BACKGROUNDS_DIR = path.join(DATA_DIR, 'backgrounds');
const APPS_FILE = path.join(DATA_DIR, 'apps.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PORT = process.env.PORT || 3000;
const INITIAL_PASSWORD = process.env.EDIT_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MIN_PASSWORD_LENGTH = 4;

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, lockUntil }

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/gif']);
const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
  'image/gif': '.gif',
};

fs.mkdirSync(ICONS_DIR, { recursive: true });
fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });

function loadApps() {
  if (!fs.existsSync(APPS_FILE)) return [];
  try {
    const raw = fs.readFileSync(APPS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read apps.json, starting fresh:', err.message);
    return [];
  }
}

function saveApps(apps) {
  const tmpFile = APPS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(apps, null, 2));
  fs.renameSync(tmpFile, APPS_FILE);
}

let apps = loadApps();

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return { background: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { background: null, ...parsed };
  } catch (err) {
    console.error('Failed to read settings.json, starting fresh:', err.message);
    return { background: null };
  }
}

function saveSettings(nextSettings) {
  const tmpFile = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(nextSettings, null, 2));
  fs.renameSync(tmpFile, SETTINGS_FILE);
}

let settings = loadSettings();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const candidate = crypto.scryptSync(password, salt, 64);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function loadAuth() {
  if (!fs.existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read auth.json:', err.message);
    return null;
  }
}

function saveAuth(nextAuth) {
  const tmpFile = AUTH_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(nextAuth, null, 2));
  fs.renameSync(tmpFile, AUTH_FILE);
}

// `auth` is the persisted password state. Once set (either by an initial
// EDIT_PASSWORD or a later change), it lives in /data and EDIT_PASSWORD is
// only ever consulted to bootstrap it the first time.
let auth = loadAuth();
if (!auth && INITIAL_PASSWORD) {
  auth = { passwordHash: hashPassword(INITIAL_PASSWORD), mustChange: true };
  saveAuth(auth);
}

const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    name: 'tile_dashboard_sid',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/icons', express.static(ICONS_DIR));
app.use('/backgrounds', express.static(BACKGROUNDS_DIR));

function requireAuth(req, res, next) {
  if (!auth) return next();
  if (!req.session || !req.session.unlocked) {
    return res.status(401).json({ error: 'Locked. Unlock with the password to make changes.' });
  }
  if (req.session.mustChange) {
    return res.status(403).json({ error: 'You must set a new password before making changes.' });
  }
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return cb(new Error('Unsupported image type'));
    }
    cb(null, true);
  },
});

const uploadBackground = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return cb(new Error('Unsupported image type'));
    }
    cb(null, true);
  },
});

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Auth status: is a password configured, is this session unlocked, and does
// the password still need to be changed from its initial value
app.get('/api/auth/status', (req, res) => {
  const unlocked = !auth || Boolean(req.session && req.session.unlocked);
  res.json({
    required: Boolean(auth),
    unlocked,
    mustChange: Boolean(auth) && unlocked && Boolean(req.session && req.session.mustChange),
  });
});

// Unlock editing for this session
app.post('/api/auth/unlock', (req, res) => {
  if (!auth) return res.json({ unlocked: true, mustChange: false });

  const ip = req.ip;
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.lockUntil > Date.now()) {
    const retryAfter = Math.ceil((attempt.lockUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${retryAfter}s.` });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !verifyPassword(password, auth.passwordHash)) {
    const next = { count: (attempt?.count || 0) + 1, lockUntil: 0 };
    if (next.count >= MAX_LOGIN_ATTEMPTS) {
      next.lockUntil = Date.now() + LOGIN_LOCKOUT_MS;
      next.count = 0;
    }
    loginAttempts.set(ip, next);
    return res.status(401).json({ error: 'Incorrect password' });
  }

  loginAttempts.delete(ip);
  req.session.unlocked = true;
  req.session.mustChange = Boolean(auth.mustChange);
  res.json({ unlocked: true, mustChange: req.session.mustChange });
});

// Lock editing for this session
app.post('/api/auth/lock', (req, res) => {
  if (req.session) req.session.unlocked = false;
  res.json({ unlocked: false });
});

// Change the password. Requires an unlocked session (works even while
// mustChange is pending, since that's exactly when this gets called).
app.post('/api/auth/change-password', (req, res) => {
  if (!auth) return res.status(400).json({ error: 'Password protection is not enabled.' });
  if (!req.session || !req.session.unlocked) {
    return res.status(401).json({ error: 'Unlock with the current password first.' });
  }
  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }
  auth = { passwordHash: hashPassword(newPassword), mustChange: false };
  saveAuth(auth);
  req.session.mustChange = false;
  res.json({ success: true });
});

// List all apps, sorted by order
app.get('/api/apps', (req, res) => {
  const sorted = [...apps].sort((a, b) => a.order - b.order);
  res.json(sorted);
});

// Create a new app
app.post('/api/apps', requireAuth, (req, res) => {
  const { name, url, icon } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (typeof url !== 'string' || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'a valid http(s) url is required' });
  }
  if (icon !== undefined && icon !== '' && typeof icon !== 'string') {
    return res.status(400).json({ error: 'icon must be a string' });
  }

  const maxOrder = apps.reduce((max, a) => Math.max(max, a.order), -1);
  const newApp = {
    id: crypto.randomUUID(),
    name: name.trim(),
    url: url.trim(),
    icon: icon ? icon.trim() : '',
    enabled: true,
    order: maxOrder + 1,
  };
  apps.push(newApp);
  saveApps(apps);
  res.status(201).json(newApp);
});

// Update an app (name, url, icon, enabled)
app.put('/api/apps/:id', requireAuth, (req, res) => {
  const existing = apps.find((a) => a.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, url, icon, enabled } = req.body || {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    existing.name = name.trim();
  }
  if (url !== undefined) {
    if (typeof url !== 'string' || !isValidHttpUrl(url)) {
      return res.status(400).json({ error: 'a valid http(s) url is required' });
    }
    existing.url = url.trim();
  }
  if (icon !== undefined) {
    if (typeof icon !== 'string') return res.status(400).json({ error: 'icon must be a string' });
    existing.icon = icon.trim();
  }
  if (enabled !== undefined) {
    existing.enabled = Boolean(enabled);
  }
  saveApps(apps);
  res.json(existing);
});

// Delete an app
app.delete('/api/apps/:id', requireAuth, (req, res) => {
  const idx = apps.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  apps.splice(idx, 1);
  saveApps(apps);
  res.status(204).end();
});

// Reorder apps: body = { order: [id1, id2, id3, ...] }
app.post('/api/apps/reorder', requireAuth, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order must be an array of ids' });
  }
  const byId = new Map(apps.map((a) => [a.id, a]));
  order.forEach((id, index) => {
    const a = byId.get(id);
    if (a) a.order = index;
  });
  saveApps(apps);
  res.json([...apps].sort((a, b) => a.order - b.order));
});

// Upload a custom icon, returns { icon: '/icons/xxxx.png' }
app.post('/api/icons', requireAuth, upload.single('icon'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const ext = EXT_BY_TYPE[req.file.mimetype] || '';
  const filename = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(ICONS_DIR, filename), req.file.buffer);
  res.status(201).json({ icon: `/icons/${filename}` });
});

// Site-wide settings (currently just the background image), visible to everyone
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

function deleteBackgroundFile() {
  if (!settings.background) return;
  const filePath = path.join(BACKGROUNDS_DIR, path.basename(settings.background));
  fs.rm(filePath, { force: true }, () => {});
}

// Upload/replace the background image, returns { background: '/backgrounds/xxxx.png' }
app.post('/api/background', requireAuth, uploadBackground.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  deleteBackgroundFile();
  const ext = EXT_BY_TYPE[req.file.mimetype] || '';
  const filename = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(BACKGROUNDS_DIR, filename), req.file.buffer);
  settings = { ...settings, background: `/backgrounds/${filename}` };
  saveSettings(settings);
  res.status(201).json({ background: settings.background });
});

// Remove the background image
app.delete('/api/background', requireAuth, (req, res) => {
  deleteBackgroundFile();
  settings = { ...settings, background: null };
  saveSettings(settings);
  res.json({ background: null });
});

// Talks to the Docker Engine API over its Unix socket. Only ever used for
// GET requests (read-only) — see dockerRequest callers below.
function dockerRequest(apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: DOCKER_SOCKET_PATH, path: apiPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`Docker API responded with ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// List running containers so the "Add App" form can offer them as a picker,
// instead of the user typing name/URL by hand. Requires the Docker socket to
// be mounted into this container — degrades to a clear error if it isn't.
app.get('/api/docker/containers', requireAuth, async (req, res) => {
  try {
    const containers = await dockerRequest('/containers/json');
    const simplified = containers
      .map((c) => ({
        name: ((c.Names && c.Names[0]) || '').replace(/^\//, ''),
        image: c.Image,
        icon: (c.Labels && c.Labels['net.unraid.docker.icon']) || '',
        ports: (c.Ports || [])
          .filter((p) => p.PublicPort && p.Type === 'tcp')
          .map((p) => p.PublicPort)
          .sort((a, b) => a - b),
      }))
      .filter((c) => c.name && c.name !== 'dockyard')
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(simplified);
  } catch (err) {
    console.error('Docker API error:', err.message);
    res.status(503).json({
      error: 'Could not reach the Docker socket. Mount /var/run/docker.sock into this container to enable this.',
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'unexpected error' });
});

app.listen(PORT, () => {
  console.log(`Dockyard listening on port ${PORT}`);
  if (!auth) {
    console.log('EDIT_PASSWORD is not set — editing is open to anyone who can reach this dashboard.');
  } else if (auth.mustChange) {
    console.log('Editing is password-protected. The initial password must be changed on first use.');
  } else {
    console.log('Editing is password-protected.');
  }
});
