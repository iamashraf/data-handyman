# Running Data Handyman on Windows without containers

This is an alternative to the main [install guide](../README.md), for a
Windows PC that can't run Podman or Docker (for example, virtualization
can't be turned on). It runs the same app directly on Windows instead,
with no containers, no virtualization, and no WSL.

Follow every command exactly, in order. Each step says what success
looks like before you move to the next one.

**Prefer one command over following these steps by hand?** Download the
project (see [step 4](#4-get-the-app) below), then double-click
`run-windows.bat` in the project folder (or run
`powershell -ExecutionPolicy Bypass -File .\run-windows.ps1`). It checks
for Python, Node.js and uv, installs whichever are missing straight from
python.org/nodejs.org with the official checksum verified, then starts
the app and opens it in your browser. It does everything below, in order,
every time you run it.

## What you need

- Windows 10 or 11
- About 10 minutes
- An internet connection
- No administrator access or BIOS changes required

## Part 1: One-time setup

### 1. Install Python

1. Go to <https://www.python.org/downloads/> and click the yellow
   **Download Python** button.
2. Run the downloaded installer.
3. On the first screen, **check the box "Add python.exe to PATH"** at
   the bottom before clicking anything else. This step is easy to miss
   and everything later depends on it.
4. Click **Install Now** and let it finish.
5. Close any open PowerShell windows, then open a new one (press the
   Windows key, type `powershell`, press Enter).
6. Run:

   ```powershell
   python --version
   ```

   **Success looks like:** `Python 3.12.x` (or similar). If you instead
   see an error or it opens the Microsoft Store, Python isn't on PATH —
   reinstall and make sure to check the box in step 3.

### 2. Install Node.js

1. Go to <https://nodejs.org/> and download the **LTS** installer (the
   recommended version on the page).
2. Run the installer, clicking **Next** through the default options.
3. Close and reopen PowerShell, then run:

   ```powershell
   node --version
   npm --version
   ```

   **Success looks like:** two version numbers, e.g. `v22.x.x` and
   `10.x.x`.

### 3. Install uv

`uv` runs the backend's Python environment. In the same PowerShell
window:

```powershell
python -m pip install uv
```

Close and reopen PowerShell, then run:

```powershell
uv --version
```

**Success looks like:** a version number, e.g. `uv 0.13.x`. If it says
`uv` is not recognized, close and reopen PowerShell again — this picks
up the PATH change from the install.

### 4. Get the app

1. Go to <https://github.com/iamashraf/data-handyman>.
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip it somewhere easy to find, for example `C:\data-handyman`.

### 5. Install the backend's dependencies

1. In File Explorer, open the `backend` folder inside the unzipped
   project.
2. Click the address bar, type `powershell`, press Enter. This opens a
   terminal already inside that folder — check the prompt shows a path
   ending in `\backend`.
3. Run:

   ```powershell
   uv sync
   ```

   **Success looks like:** a list of installed packages ending without
   an error. This takes a minute or two the first time.

### 6. Install the frontend's dependencies

1. In File Explorer, open the `frontend` folder inside the unzipped
   project (a sibling of `backend`).
2. Click the address bar, type `powershell`, press Enter.
3. Run:

   ```powershell
   npm install
   ```

   **Success looks like:** a line like `added 115 packages` without an
   error.

Setup is done. You won't need to repeat Part 1 again on this PC.

## Part 2: Running the app (every time)

You need two PowerShell windows open at the same time, one for the
backend and one for the frontend. Both must stay open while you use the
app.

### Window 1: start the backend

1. Open the `backend` folder in File Explorer, click the address bar,
   type `powershell`, press Enter.
2. Run these two lines, in order:

   ```powershell
   $env:DB_PATH = ".\handy_recorder.db"
   uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

   **Success looks like:** the last line printed is
   `Uvicorn running on http://0.0.0.0:8000`. Leave this window open.

### Window 2: start the frontend

1. Open the `frontend` folder in File Explorer, click the address bar,
   type `powershell`, press Enter.
2. Run these two lines, in order:

   ```powershell
   $env:VITE_DEV_PROXY_TARGET = "http://localhost:8000"
   npm run dev
   ```

   **Success looks like:** a line showing `Local: http://localhost:5173/`.
   Leave this window open.

### Open the app

Open a browser and go to:

```
http://localhost:5173
```

## Stopping the app

In each PowerShell window, press `Ctrl+C`. If it asks to confirm,
type `Y` and press Enter.

## Running it again later

You don't need to repeat Part 1. Each time you want to use the app,
repeat Part 2 exactly: both windows, both lines in each window,
including the `$env:` line — that setting doesn't carry over to a new
PowerShell window, so skipping it will make the UI unable to reach the
backend.

## Where your data lives

Your templates and records are stored in a single file:
`backend\handy_recorder.db`, inside the project folder you unzipped.

This is different from the container-based guide, where data lives in
a Podman volume independent of the folder. Here, if you delete the
project folder, you delete your data with it.

**To update to a new version without losing data:** download and unzip
the new version to a new folder, then copy your old
`backend\handy_recorder.db` file into the new folder's `backend`
directory before starting it.

## Troubleshooting

| Problem | Try this |
|---|---|
| `python`, `node`, `npm`, or `uv` is "not recognized" | Close every PowerShell window and open a fresh one — PATH changes only apply to new windows. If it still fails, reinstall that tool and confirm the PATH checkbox (Python) or default options (Node) were used. |
| Browser can't reach `localhost:5173` | Check the frontend PowerShell window is still open and didn't show an error. |
| The UI loads but shows no data / errors on every action | The backend window probably isn't running, or `VITE_DEV_PROXY_TARGET` wasn't set before `npm run dev`. Stop both (Ctrl+C) and restart Window 1 fully, then Window 2 fully. |
| "Port already in use" for 8000 or 5173 | Something else on the PC is using that port. Pick a free port, e.g. change `--port 8000` to `--port 8010` in Window 1, and update `VITE_DEV_PROXY_TARGET` to match before starting Window 2. |
| `npm install` or `npm run dev` fails mentioning a missing native binding | Delete the `frontend\node_modules` folder and run `npm install` again. |
