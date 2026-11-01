# Handy Recorder

Handy Recorder is a web app for building custom data-entry templates (with
formula columns), recording data against them, importing existing Excel
files as templates, and exporting the results.

This guide walks through running the app on Windows with Podman, written
for someone who has never used a terminal before. No programming
knowledge needed.

## What you need

- Windows 10 or 11
- Administrator access on the PC
- About 15 minutes
- An internet connection

## 1. Turn on virtualization

Podman runs the app inside a small Linux virtual machine. Windows needs
two things turned on first:

1. **Hardware virtualization.** Most PCs have this on by default. If
   setup fails later with a virtualization error, restart the PC, enter
   the BIOS/UEFI setup (usually by pressing F2, F10, or Del right after
   power-on), and enable the setting called **Intel VT-x**, **AMD-V**, or
   **Virtualization Technology**.
2. **WSL (Windows Subsystem for Linux).** Open **PowerShell as
   Administrator** (right-click the Start button, choose "Terminal
   (Admin)" or "PowerShell (Admin)") and run:

   ```powershell
   wsl --install
   ```

   Restart the PC if prompted.

## 2. Install Podman Desktop

1. Go to [podman-desktop.io/downloads](https://podman-desktop.io/downloads)
   and download the Windows installer.
2. Run the installer and follow the on-screen prompts.
3. Open **Podman Desktop** from the Start menu. On first launch it asks
   to create a "Podman machine" — accept the defaults. This sets up the
   Linux VM the app will run in.
4. Wait for the Podman Desktop window to show the machine as running
   (green status) before continuing.
5. This guide uses `podman compose`, which needs the Compose extension.
   The first-run setup usually offers it as a checkbox alongside Podman
   itself — enable it there. If you skipped it, or `podman compose`
   later says it can't find a compose provider, open Podman Desktop's
   **Settings**, find the Compose option (under Resources or Docker
   Compatibility, depending on your version), and use its **Setup**
   button to install it.

## 3. Get the app

1. Go to <https://github.com/iamashraf/data-handyman>.
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip it somewhere easy to find, for example `C:\data-handyman`.

## 4. Build and start the app

The app is two containers (the UI and the server) started together as
one stack, with one command.

1. Open the unzipped folder in File Explorer.
2. Click the address bar, type `powershell`, and press Enter. This opens
   a terminal already inside that folder.
3. Start the app:

   ```powershell
   podman compose up -d --build
   ```

   This takes a few minutes the first time.

## 5. Open the app

Open a browser and go to:

```
http://localhost:8080
```

## Stopping and starting it later

You don't need to rebuild each time — from a terminal in the project
folder:

```powershell
podman compose stop
podman compose start
```

To fully stop and remove the containers (your data is unaffected,
since it lives in a separate volume, not in the containers):

```powershell
podman compose down
```

If the PC restarts, open **Podman Desktop** first (to start the Podman
machine), then run `podman compose start` again from the project folder.

## Updating to a new version

1. Download the latest ZIP from the GitHub page again and unzip it,
   to a new folder if you like — your data is not tied to this folder.
2. In a terminal inside that new folder, run:

   ```powershell
   podman compose up -d --build
   ```

Your templates and records are stored outside the containers, so they
survive this update.

## Where your data lives

All templates and records are stored in a Podman volume, separate from
the project folder, tied to the stack name (`data-handyman`) rather
than to any particular folder. You don't need to know its exact name
to use the app.

**Never run `podman compose down -v`** — the `-v` deletes that volume,
and with it every template and record, permanently.

## Troubleshooting

| Problem | Try this |
|---|---|
| "Virtualization not supported" or similar error | Restart the PC, enable virtualization in the BIOS/UEFI, try again. |
| Podman Desktop shows the machine as stopped | Open Podman Desktop and start the machine, or run `podman machine start`. |
| Browser can't reach `localhost:8080` | Check both containers are running: `podman compose ps`. |
| Port 8080 already in use | Edit `compose.yml`, change `"127.0.0.1:8080:80"` to a free port like `"127.0.0.1:8081:80"`, then open that port instead. |
| `podman` command not found in terminal | Close and reopen the terminal after installing Podman Desktop, or restart the PC. |
| `podman compose up --build` fails with "Source image rejected ... by policy" | See the comment at the top of `compose.yml` for a workaround. |
