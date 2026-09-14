const tileGrid = document.getElementById('tileGrid');
const emptyState = document.getElementById('emptyState');
const editToggleBtn = document.getElementById('editToggleBtn');
const addAppBtn = document.getElementById('addAppBtn');

const appModal = document.getElementById('appModal');
const appForm = document.getElementById('appForm');
const modalTitle = document.getElementById('modalTitle');
const appIdField = document.getElementById('appId');
const appContainerNameField = document.getElementById('appContainerName');
const appNameField = document.getElementById('appName');
const appUrlField = document.getElementById('appUrl');
const appGroupField = document.getElementById('appGroup');
const groupOptionsDatalist = document.getElementById('groupOptions');
const appIconUrlField = document.getElementById('appIconUrl');
const appIconFileField = document.getElementById('appIconFile');
const iconPreviewWrap = document.getElementById('iconPreviewWrap');
const iconPreview = document.getElementById('iconPreview');
const cancelBtn = document.getElementById('cancelBtn');
const pickDockerBtn = document.getElementById('pickDockerBtn');
const dockerPickerList = document.getElementById('dockerPickerList');

const lockBtn = document.getElementById('lockBtn');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const passwordModal = document.getElementById('passwordModal');
const passwordForm = document.getElementById('passwordForm');
const passwordInput = document.getElementById('passwordInput');
const passwordError = document.getElementById('passwordError');
const passwordCancelBtn = document.getElementById('passwordCancelBtn');

const changePasswordModal = document.getElementById('changePasswordModal');
const changePasswordNotice = document.getElementById('changePasswordNotice');
const changePasswordForm = document.getElementById('changePasswordForm');
const newPasswordInput = document.getElementById('newPasswordInput');
const confirmPasswordInput = document.getElementById('confirmPasswordInput');
const changePasswordError = document.getElementById('changePasswordError');
const changePasswordCancelBtn = document.getElementById('changePasswordCancelBtn');

const backgroundBtn = document.getElementById('backgroundBtn');
const backgroundModal = document.getElementById('backgroundModal');
const backgroundFileInput = document.getElementById('backgroundFileInput');
const backgroundPreviewWrap = document.getElementById('backgroundPreviewWrap');
const backgroundPreview = document.getElementById('backgroundPreview');
const backgroundError = document.getElementById('backgroundError');
const removeBackgroundBtn = document.getElementById('removeBackgroundBtn');
const backgroundCancelBtn = document.getElementById('backgroundCancelBtn');
const saveBackgroundBtn = document.getElementById('saveBackgroundBtn');
const searchInput = document.getElementById('searchInput');

let apps = [];
let editMode = false;
let currentEditIcon = '';
let sortableInstances = [];
let authRequired = false;
let unlocked = false;
let mustChange = false;
let pendingAction = null;
let settings = { background: null };
let searchTerm = '';
let statusMap = {};

async function fetchApps() {
  const res = await fetch('/api/apps');
  apps = await res.json();
  updateGroupOptions();
  render();
}

function updateGroupOptions() {
  const groups = [...new Set(apps.map((a) => a.group).filter(Boolean))].sort();
  groupOptionsDatalist.innerHTML = '';
  groups.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g;
    groupOptionsDatalist.appendChild(opt);
  });
}

async function fetchStatus() {
  const res = await fetch('/api/status');
  statusMap = await res.json().catch(() => ({}));
  applyStatusDots();
}

function applyStatusDots() {
  document.querySelectorAll('.status-dot').forEach((dot) => {
    const info = statusMap[dot.dataset.statusFor];
    dot.classList.remove('up', 'down');
    if (!info || info.state === 'unknown') {
      dot.title = 'Status unknown';
      return;
    }
    dot.classList.add(info.state);
    if (info.state === 'up') {
      dot.title = info.source === 'docker' ? 'Container running' : 'Reachable';
    } else {
      dot.title = info.source === 'docker' ? 'Container stopped' : 'Unreachable';
    }
  });
}

async function fetchSettings() {
  const res = await fetch('/api/settings');
  settings = await res.json();
  applyBackground(settings.background);
}

function applyBackground(url) {
  if (url) {
    document.body.style.setProperty('--bg-image', `url('${url}')`);
    document.body.classList.add('has-bg-image');
  } else {
    document.body.classList.remove('has-bg-image');
    document.body.style.removeProperty('--bg-image');
  }
}

async function fetchAuthStatus() {
  const res = await fetch('/api/auth/status');
  const data = await res.json();
  authRequired = data.required;
  unlocked = data.unlocked;
  mustChange = data.mustChange;
  updateLockUI();
}

function updateLockUI() {
  lockBtn.hidden = !authRequired;
  changePasswordBtn.hidden = !authRequired || !unlocked || mustChange;
  if (authRequired) {
    lockBtn.textContent = unlocked ? '\u{1F513} Unlocked' : '\u{1F512} Locked';
    lockBtn.title = unlocked ? 'Click to lock editing' : 'Editing is locked — click to unlock';
  }
}

function exitEditMode() {
  if (!editMode) return;
  editMode = false;
  editToggleBtn.textContent = 'Edit Layout';
  editToggleBtn.classList.remove('active');
  render();
}

function resetToLocked() {
  unlocked = false;
  mustChange = false;
  updateLockUI();
  exitEditMode();
}

function ensureUnlocked(action) {
  if (!authRequired || (unlocked && !mustChange)) {
    action();
    return;
  }
  pendingAction = action;
  if (unlocked && mustChange) {
    openChangePasswordModal();
  } else {
    passwordError.hidden = true;
    passwordInput.value = '';
    passwordModal.hidden = false;
    passwordInput.focus();
  }
}

function openChangePasswordModal() {
  changePasswordNotice.hidden = !mustChange;
  changePasswordError.hidden = true;
  newPasswordInput.value = '';
  confirmPasswordInput.value = '';
  changePasswordModal.hidden = false;
  newPasswordInput.focus();
}

async function authedFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    resetToLocked();
    alert('Editing is locked. Please unlock again to make changes.');
  } else if (res.status === 403) {
    await fetchAuthStatus();
    alert('You must set a new password before making changes.');
    if (mustChange) openChangePasswordModal();
  }
  return res;
}

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = passwordInput.value;
  const res = await fetch('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    passwordError.textContent = data.error || 'Incorrect password';
    passwordError.hidden = false;
    return;
  }
  unlocked = true;
  mustChange = Boolean(data.mustChange);
  updateLockUI();
  passwordModal.hidden = true;
  if (mustChange) {
    openChangePasswordModal();
    return;
  }
  const action = pendingAction;
  pendingAction = null;
  if (action) action();
});

passwordCancelBtn.addEventListener('click', () => {
  passwordModal.hidden = true;
  pendingAction = null;
});

passwordModal.addEventListener('click', (e) => {
  if (e.target === passwordModal) {
    passwordModal.hidden = true;
    pendingAction = null;
  }
});

changePasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  if (newPassword !== confirmPassword) {
    changePasswordError.textContent = 'Passwords do not match.';
    changePasswordError.hidden = false;
    return;
  }
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    changePasswordError.textContent = data.error || 'Could not change password.';
    changePasswordError.hidden = false;
    return;
  }
  mustChange = false;
  updateLockUI();
  changePasswordModal.hidden = true;
  const action = pendingAction;
  pendingAction = null;
  if (action) action();
});

changePasswordModal.addEventListener('click', (e) => {
  if (e.target === changePasswordModal && !mustChange) {
    changePasswordModal.hidden = true;
    pendingAction = null;
  }
});

changePasswordCancelBtn.addEventListener('click', async () => {
  changePasswordModal.hidden = true;
  pendingAction = null;
  if (mustChange) {
    // Forced change was declined — re-lock rather than leave a half-unlocked session.
    await fetch('/api/auth/lock', { method: 'POST' });
    resetToLocked();
  }
});

lockBtn.addEventListener('click', async () => {
  if (unlocked) {
    await fetch('/api/auth/lock', { method: 'POST' });
    resetToLocked();
  } else {
    ensureUnlocked(() => {});
  }
});

changePasswordBtn.addEventListener('click', () => openChangePasswordModal());

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

function buildTile(a) {
  const tile = document.createElement(editMode ? 'div' : 'a');
  tile.className = 'tile' + (!a.enabled ? ' disabled' : '');
  tile.dataset.id = a.id;
  if (!editMode) {
    tile.href = a.url;
    tile.target = '_blank';
    tile.rel = 'noopener noreferrer';
  }

  const iconWrap = document.createElement('div');
  iconWrap.className = 'tile-icon-wrap';

  let iconEl;
  if (a.icon) {
    iconEl = document.createElement('img');
    iconEl.className = 'tile-icon';
    iconEl.src = a.icon;
    iconEl.alt = '';
    iconEl.onerror = () => {
      const fallback = buildFallbackIcon(a.name);
      iconEl.replaceWith(fallback);
    };
  } else {
    iconEl = buildFallbackIcon(a.name);
  }
  iconWrap.appendChild(iconEl);

  const dot = document.createElement('span');
  dot.className = 'status-dot';
  dot.dataset.statusFor = a.id;
  dot.title = 'Status unknown';
  iconWrap.appendChild(dot);

  tile.appendChild(iconWrap);

  const nameEl = document.createElement('div');
  nameEl.className = 'tile-name';
  nameEl.textContent = a.name;
  tile.appendChild(nameEl);

  if (editMode) {
    const controls = document.createElement('div');
    controls.className = 'tile-controls';

    const visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.className = 'tile-control-btn';
    visBtn.title = a.enabled ? 'Hide from dashboard' : 'Show on dashboard';
    visBtn.textContent = a.enabled ? '–' : '+';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEnabled(a);
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'tile-control-btn';
    editBtn.title = 'Edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(a);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'tile-control-btn';
    delBtn.title = 'Delete';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteApp(a);
    });

    controls.append(visBtn, editBtn, delBtn);
    tile.appendChild(controls);
  }

  return tile;
}

function render() {
  // Search is ignored in edit mode: hiding filtered-out tiles would drop them
  // from the drag-reorder payload, since that's built from what's in the DOM.
  const term = editMode ? '' : searchTerm.trim().toLowerCase();
  let visibleApps = editMode ? apps : apps.filter((a) => a.enabled);
  if (term) {
    visibleApps = visibleApps.filter((a) => a.name.toLowerCase().includes(term));
  }
  emptyState.hidden = apps.length > 0;
  tileGrid.innerHTML = '';
  tileGrid.classList.toggle('edit-mode', editMode);
  backgroundBtn.hidden = !editMode;
  searchInput.disabled = editMode;
  searchInput.placeholder = editMode ? 'Search disabled while editing' : 'Search… (press /)';

  const groupOrder = [];
  const byGroup = new Map();
  visibleApps.forEach((a) => {
    const g = a.group || '';
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      groupOrder.push(g);
    }
    byGroup.get(g).push(a);
  });
  // Keep an ungrouped drop zone available in edit mode even when it's empty,
  // so tiles can always be dragged out of a group back to "no group".
  if (editMode && !byGroup.has('')) {
    byGroup.set('', []);
    groupOrder.unshift('');
  }

  sortableInstances.forEach((s) => s.destroy());
  sortableInstances = [];

  groupOrder.forEach((groupName) => {
    const groupApps = byGroup.get(groupName);

    const section = document.createElement('section');
    section.className = 'tile-group';

    if (groupName) {
      const header = document.createElement('h2');
      header.className = 'tile-group-header';
      header.textContent = groupName;
      section.appendChild(header);
    } else if (editMode && groupOrder.length > 1) {
      const header = document.createElement('h2');
      header.className = 'tile-group-header';
      header.textContent = 'Ungrouped';
      section.appendChild(header);
    }

    const grid = document.createElement('div');
    grid.className = 'tile-grid';
    grid.dataset.group = groupName;
    groupApps.forEach((a) => grid.appendChild(buildTile(a)));
    section.appendChild(grid);
    tileGrid.appendChild(section);

    if (editMode) {
      sortableInstances.push(
        new Sortable(grid, {
          animation: 150,
          group: 'dockyard-tiles',
          onEnd: handleReorderEnd,
        })
      );
    }
  });

  applyStatusDots();
}

function buildFallbackIcon(name) {
  const div = document.createElement('div');
  div.className = 'tile-icon fallback';
  div.textContent = (name || '?').trim().charAt(0).toUpperCase();
  return div;
}

async function handleReorderEnd() {
  const order = [];
  tileGrid.querySelectorAll('.tile-grid').forEach((grid) => {
    const group = grid.dataset.group;
    [...grid.children].forEach((el) => order.push({ id: el.dataset.id, group }));
  });
  await authedFetch('/api/apps/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
  await fetchApps();
}

async function toggleEnabled(a) {
  await authedFetch(`/api/apps/${a.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: !a.enabled }),
  });
  await fetchApps();
}

async function deleteApp(a) {
  if (!confirm(`Remove "${a.name}" from the dashboard?`)) return;
  await authedFetch(`/api/apps/${a.id}`, { method: 'DELETE' });
  await fetchApps();
}

function openAddModal() {
  modalTitle.textContent = 'Add App';
  appIdField.value = '';
  appContainerNameField.value = '';
  appNameField.value = '';
  appUrlField.value = '';
  appGroupField.value = '';
  appIconUrlField.value = '';
  appIconFileField.value = '';
  currentEditIcon = '';
  iconPreviewWrap.hidden = true;
  dockerPickerList.hidden = true;
  appModal.hidden = false;
  appNameField.focus();
}

function openEditModal(a) {
  modalTitle.textContent = 'Edit App';
  appIdField.value = a.id;
  appContainerNameField.value = a.containerName || '';
  appNameField.value = a.name;
  appUrlField.value = a.url;
  appGroupField.value = a.group || '';
  appIconUrlField.value = a.icon && a.icon.startsWith('http') ? a.icon : '';
  appIconFileField.value = '';
  currentEditIcon = a.icon || '';
  if (currentEditIcon) {
    iconPreview.src = currentEditIcon;
    iconPreviewWrap.hidden = false;
  } else {
    iconPreviewWrap.hidden = true;
  }
  dockerPickerList.hidden = true;
  appModal.hidden = false;
  appNameField.focus();
}

function closeModal() {
  appModal.hidden = true;
}

appIconUrlField.addEventListener('input', () => {
  const val = appIconUrlField.value.trim();
  if (val) {
    iconPreview.src = val;
    iconPreviewWrap.hidden = false;
  } else if (!appIconFileField.files.length) {
    iconPreviewWrap.hidden = true;
  }
});

appIconFileField.addEventListener('change', () => {
  const file = appIconFileField.files[0];
  if (file) {
    iconPreview.src = URL.createObjectURL(file);
    iconPreviewWrap.hidden = false;
    appIconUrlField.value = '';
  }
});

appForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = appIdField.value;
  const name = appNameField.value.trim();
  const url = normalizeUrl(appUrlField.value);
  const iconUrlValue = appIconUrlField.value.trim();
  const file = appIconFileField.files[0];

  let icon = iconUrlValue || currentEditIcon;

  if (file) {
    const formData = new FormData();
    formData.append('icon', file);
    const uploadRes = await authedFetch('/api/icons', { method: 'POST', body: formData });
    if (uploadRes.status === 401 || uploadRes.status === 403) return;
    if (!uploadRes.ok) {
      alert('Icon upload failed');
      return;
    }
    const uploadData = await uploadRes.json();
    icon = uploadData.icon;
  }

  const payload = { name, url, icon, group: appGroupField.value.trim(), containerName: appContainerNameField.value || null };

  const res = await authedFetch(id ? `/api/apps/${id}` : '/api/apps', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.status === 401 || res.status === 403) return;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Something went wrong');
    return;
  }

  closeModal();
  await fetchApps();
});

cancelBtn.addEventListener('click', closeModal);
appModal.addEventListener('click', (e) => {
  if (e.target === appModal) closeModal();
});
addAppBtn.addEventListener('click', () => ensureUnlocked(openAddModal));

function selectDockerContainer(container) {
  appNameField.value = container.name;
  appContainerNameField.value = container.name;
  appUrlField.value = container.ports.length
    ? `http://${window.location.hostname}:${container.ports[0]}`
    : '';
  if (container.icon) {
    appIconUrlField.value = container.icon;
    iconPreview.src = container.icon;
    iconPreviewWrap.hidden = false;
  }
  dockerPickerList.hidden = true;
}

function setPickerMessage(text) {
  dockerPickerList.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'docker-picker-message';
  msg.textContent = text;
  dockerPickerList.appendChild(msg);
}

pickDockerBtn.addEventListener('click', async () => {
  if (!dockerPickerList.hidden) {
    dockerPickerList.hidden = true;
    return;
  }
  setPickerMessage('Loading…');
  dockerPickerList.hidden = false;
  const res = await authedFetch('/api/docker/containers');
  if (res.status === 401 || res.status === 403) {
    dockerPickerList.hidden = true;
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setPickerMessage(data.error || 'Could not list containers.');
    return;
  }
  if (!data.length) {
    setPickerMessage('No running containers found.');
    return;
  }
  dockerPickerList.innerHTML = '';
  data.forEach((container) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'docker-picker-item';

    const nameEl = document.createElement('span');
    nameEl.textContent = container.name;
    const imageEl = document.createElement('span');
    imageEl.className = 'image';
    imageEl.textContent = container.image;

    item.append(nameEl, imageEl);
    item.addEventListener('click', () => selectDockerContainer(container));
    dockerPickerList.appendChild(item);
  });
});

editToggleBtn.addEventListener('click', () => {
  ensureUnlocked(() => {
    editMode = !editMode;
    editToggleBtn.textContent = editMode ? 'Done' : 'Edit Layout';
    editToggleBtn.classList.toggle('active', editMode);
    render();
  });
});

function openBackgroundModal() {
  backgroundError.hidden = true;
  backgroundFileInput.value = '';
  if (settings.background) {
    backgroundPreview.src = settings.background;
    backgroundPreviewWrap.hidden = false;
  } else {
    backgroundPreviewWrap.hidden = true;
  }
  backgroundModal.hidden = false;
}

function closeBackgroundModal() {
  backgroundModal.hidden = true;
}

backgroundBtn.addEventListener('click', () => ensureUnlocked(openBackgroundModal));

backgroundFileInput.addEventListener('change', () => {
  const file = backgroundFileInput.files[0];
  if (file) {
    backgroundPreview.src = URL.createObjectURL(file);
    backgroundPreviewWrap.hidden = false;
  }
});

saveBackgroundBtn.addEventListener('click', async () => {
  const file = backgroundFileInput.files[0];
  if (!file) {
    backgroundError.textContent = 'Choose an image first.';
    backgroundError.hidden = false;
    return;
  }
  const formData = new FormData();
  formData.append('background', file);
  const res = await authedFetch('/api/background', { method: 'POST', body: formData });
  if (res.status === 401 || res.status === 403) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    backgroundError.textContent = data.error || 'Could not set background.';
    backgroundError.hidden = false;
    return;
  }
  settings.background = data.background;
  applyBackground(settings.background);
  closeBackgroundModal();
});

removeBackgroundBtn.addEventListener('click', async () => {
  const res = await authedFetch('/api/background', { method: 'DELETE' });
  if (res.status === 401 || res.status === 403) return;
  if (!res.ok) {
    backgroundError.textContent = 'Could not remove background.';
    backgroundError.hidden = false;
    return;
  }
  settings.background = null;
  applyBackground(null);
  closeBackgroundModal();
});

backgroundCancelBtn.addEventListener('click', closeBackgroundModal);
backgroundModal.addEventListener('click', (e) => {
  if (e.target === backgroundModal) closeBackgroundModal();
});

searchInput.addEventListener('input', () => {
  searchTerm = searchInput.value;
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || document.activeElement === searchInput) return;
  const tag = document.activeElement.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable;
  if (isTyping) return;
  e.preventDefault();
  searchInput.focus();
});

const STATUS_POLL_INTERVAL_MS = 30 * 1000;

fetchAuthStatus();
fetchApps();
fetchSettings();
fetchStatus();
setInterval(fetchStatus, STATUS_POLL_INTERVAL_MS);
