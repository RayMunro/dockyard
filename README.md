# Dockyard

A minimal, self-hosted tiled launcher dashboard for your favorite apps. Add apps
with a name, URL, and icon; show/hide them; drag to rearrange. Everything is
stored in a single `apps.json` file on a mounted volume.

Copyright © 2026 Ray Munro. All rights reserved.

## Running on Unraid

The easiest path is Unraid's **Docker Compose Manager** plugin (available in
Community Applications), which lets you paste a compose file directly. If you'd
rather build/run by hand over SSH, both options are below.

### Option A: Docker Compose Manager plugin (recommended)

1. Install "Docker Compose Manager" from Community Applications if you don't have it.
2. Copy this whole `unraid-tile-dashboard` folder onto your Unraid box, e.g. into
   `/mnt/user/appdata/dockyard-src` (via the Unraid GUI file browser, `scp`,
   or a network share).
3. In the plugin, create a new stack pointing at that folder (it will pick up
   `docker-compose.yml`).
4. Before starting, edit the compose file's `volumes:` line if you want config
   stored elsewhere, e.g.:
   ```yaml
   volumes:
     - /mnt/user/appdata/dockyard:/data
   ```
5. Start the stack. The dashboard will be at `http://<unraid-ip>:8090`.

### Option B: build and run manually over SSH

```bash
scp -r unraid-tile-dashboard root@<unraid-ip>:/mnt/user/appdata/dockyard-src
ssh root@<unraid-ip>
cd /mnt/user/appdata/dockyard-src
docker build -t dockyard .
mkdir -p /mnt/user/appdata/dockyard
docker run -d \
  --name dockyard \
  --restart unless-stopped \
  -p 8090:3000 \
  -v /mnt/user/appdata/dockyard:/data \
  --label net.unraid.docker.managed=dockerman \
  --label 'net.unraid.docker.webui=http://[IP]:[PORT:8090]/' \
  --label 'net.unraid.docker.icon=http://<unraid-hostname>.local:8090/icon.png' \
  dockyard
```

Then open `http://<unraid-ip>:8090`. The `--label` flags make Unraid's Docker
tab show a WebUI button and icon for the container even though it wasn't
created from an Unraid template. Use your box's mDNS hostname (`.local`) for
the icon label rather than its IP — see the callout in Option D below for why.

### Option C: add as a custom container via the Unraid GUI

If you'd rather not use compose, build the image first (Option B's `docker build`
step, or push it to a registry like Docker Hub / GHCR from your dev machine),
then in Unraid's Docker tab click **Add Container** and set:

- Repository: `dockyard` (or your pushed image name)
- Port: container `3000` → host `8090` (or any free port)
- Path: container `/data` → host `/mnt/user/appdata/dockyard`
- WebUI: `http://[IP]:[PORT:8090]/`

Adding it through this form (rather than the labels in Option B) also gets you
a proper Unraid template, so the container shows up with full Edit/icon support
like any other app.

### Option D: use the included Unraid template (recommended if you built via Option B)

`unraid-template.xml` in this repo is a ready-made Unraid template with proper
fields for the WebUI port, data path, optional `EDIT_PASSWORD`, and the
optional Docker socket mount. Copy it to Unraid's user-templates folder:

```bash
scp unraid-template.xml root@<unraid-ip>:/boot/config/plugins/dockerMan/templates-user/my-dockyard.xml
```

This does two things without touching a running container:
- If a container named `dockyard` is already running (e.g. from Option B),
  Unraid's Docker tab immediately gains a proper **Edit** option for it, with
  labeled fields instead of a raw/unlisted container.
- It also appears as a template when you click **Add Container**, so
  installing fresh presents the same configuration screen — letting you
  change the port, path, or password before the container is even created.

The template's `<Icon>` uses a `YOUR-UNRAID-HOSTNAME.local` placeholder — edit
it to your own Unraid box's mDNS hostname before copying it over (try pinging
`<hostname>.local`; avahi is on by default on Unraid). Two things that *don't*
work here, in case you're tempted: the `[IP]`/`[PORT]` macros only resolve for
the `<WebUI>` link at click-time (this is a plain `<img>` tag with no such
substitution), and a `data:` URI with the icon embedded directly also fails —
Unraid fetches this value server-side to cache it, and its fetcher only
accepts real http(s) URLs. A hostname avoids hardcoding an IP that breaks on
the next DHCP reassignment; fall back to the literal IP if mDNS isn't reliable
on your network.

**If the icon still shows as a broken/question-mark placeholder after fixing
the URL**, that's Unraid's own caching, not your config: it downloads a
container's icon once and never retries once *any* file is cached for it
(including the fallback placeholder from an earlier bad URL). Force a refresh
with the same script "Check for Updates" uses:
```bash
/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/dockerupdate nonotify
```

Note the `Repository` field is `dockyard:latest`, which only exists once
you've built it locally (Option B) — this template doesn't publish the image
anywhere, so "installing fresh" only works on a box where you've already run
`docker build`.

## Using it

- **+ Add App** — add a tile: name, target URL, and an icon (paste an image URL,
  or upload a small PNG/SVG/ICO). Leaving the icon blank shows a letter avatar.
  A good source for app icons is https://dashboardicons.com or the app's own
  favicon (e.g. `http://192.168.1.10:8989/favicon.ico`).
- **Edit Layout** — reveals hide/edit/delete controls on every tile (including
  hidden ones) and lets you drag tiles into any order. Click **Done** to return
  to the normal launcher view, which only shows enabled tiles in your chosen order.
- Clicking a tile in normal mode opens its URL in a new tab.

All data lives in `/data/apps.json` and `/data/icons/` inside the container —
back up that mounted folder if you want to preserve your layout.

## Setting a background image

While in **Edit Layout** mode, a **Set Background** button appears. Upload an
image (up to 10MB) to use it as the page background, or remove it to go back
to the default gradient. It's stored at `/data/backgrounds/` and shared for
everyone who views the dashboard — this is a site-wide setting, not per-viewer.

## Picking apps from running containers

Instead of typing name/URL by hand, the **Add App** form has a **Pick from
Running Containers** button that lists containers currently running on the
host and auto-fills the form when you pick one (name, a guessed URL from its
first published port, and its icon if the container has an
`net.unraid.docker.icon` label).

This requires mounting the Docker socket into the container:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

**Security note:** even mounted `:ro`, this gives Dockyard's process the same
level of control over Docker on the host as root would have — the `:ro` flag
only stops the container from overwriting the socket file itself, not what API
calls it can make through it. Dockyard's own code only ever calls the
read-only list-containers endpoint, but anyone who compromised Dockyard would
inherit that full access too. Leave the socket unmounted if you'd rather not
take on that risk — the picker just shows a clear error and everything else
works normally.

The guessed URL only works cleanly for containers using bridge networking with
published ports; containers on host networking or with no exposed ports still
appear in the list but need the URL filled in by hand.

## Password-protecting changes

By default anyone who can open the dashboard can also add, edit, delete,
reorder, or hide tiles. To require a password before any change can be made
(viewing/launching tiles stays open to everyone), set the `EDIT_PASSWORD`
environment variable on the container:

- **Compose**: uncomment the `environment:` block in `docker-compose.yml` and
  set `EDIT_PASSWORD` to your chosen password.
- **Unraid GUI container**: add a variable named `EDIT_PASSWORD` with your
  password as the value.

Once set, clicking **Edit Layout** or **+ Add App** prompts for the password.
After entering it correctly, editing stays unlocked for that browser session
(12 hours, or until you click the lock icon in the top bar to lock it again
immediately). Five wrong attempts locks out further attempts for 5 minutes.

`EDIT_PASSWORD` only ever sets the *initial* password. The first time it's
used to unlock, you're immediately required to set a new password before any
change can be made — there's no way to skip this and start editing with the
initial password. That new password is hashed and stored in `/data/auth.json`
on the mounted volume, so:

- It survives container restarts and updates.
- Changing or removing `EDIT_PASSWORD` afterward has no effect — it's only
  read when no password has been set yet.
- You can rotate the password anytime afterward via the **Change Password**
  button that appears in the top bar once unlocked.
- To fully reset (e.g. you forgot the password), delete `auth.json` from the
  data volume and restart the container with `EDIT_PASSWORD` set again.

Leaving `EDIT_PASSWORD` unset keeps the original open-editing behavior.

## Local development

```bash
cd server
npm install
DATA_DIR=../data PORT=3000 npm start
```

Then open `http://localhost:3000`.
