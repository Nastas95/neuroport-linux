# Neuroport for Linux

<img width="1300" height="372" alt="immagine" src="https://github.com/user-attachments/assets/d114c436-3667-4657-bfaf-e28c4218fa57" />


**Your phone becomes V's.** Neuroport is a second-screen companion for Cyberpunk 2077: messages, calls, Night City's map, your garage, radio, shards and more, live from the game in a browser on your phone or desktop over your local network.

This repository contains the original Neuroport source layout, together with a Linux-native server, installer and desktop control panel. Cyberpunk 2077 runs through Steam Proton; the companion server and image extraction run natively on Linux.

## Features

- **Comms and calls:** conversations, contacts, replies, old messages, gig images, notifications, calls, portraits and subtitles.
- **Map and car mode:** Night City map with in-game icons, active jobs, GPS routes, autodrive, radio and vehicle paint controls.
- **Garage:** summon vehicles, view specifications, browse El Capitan's contracts and the cars they unlock, and use the Autofixer shop.
- **Quick Gig and journal:** nearby gigs and NCPD jobs; track or untrack jobs and objectives.
- **Radio, shards and status:** stations and volume, shard reader, level, attributes and statistics.
- **Immersive mode and camera:** hide selected HUD elements, open photo mode and browse in-game screenshots.
- **Adaptive interface:** touch-first screens retain the mobile layout; desktop browsers use a wider dashboard, persistent navigation, side-by-side Comms and a map-first Car Mode layout.

## Requirements

- Cyberpunk 2077 2.x installed through Steam and launched at least once.
- **Cyber Engine Tweaks (CET)**: <https://www.nexusmods.com/cyberpunk2077/mods/107>
- **RED4ext**: <https://www.nexusmods.com/cyberpunk2077/mods/2380>
- **Codeware**: <https://www.nexusmods.com/cyberpunk2077/mods/7780>
- Node.js 18 or later.
- Python 3.10 or later with Tkinter.
- `xdotool` for photo-mode key automation on X11/XWayland. Wayland compositor support may vary.
- Rust/Cargo and Python venv/pip for the optional native image extraction runtime.
- A phone or another browser on the same local Wi-Fi network.

CET, RED4ext and Codeware are separate game mods and must be installed before Neuroport. The installer checks for CET and explains the system dependencies. RED4ext and Codeware are needed for map markers and Quick Gig features.

## Install on Linux

1. Extract this repository/release archive to a directory of your choice.
2. Open a terminal in the extracted directory and run:

   ```bash
   chmod +x install-linux.sh
   ./install-linux.sh
   ```

3. The graphical installer detects standard Steam libraries, lets you browse to the game folder, checks the required software and can install system packages through PolicyKit. On KDE, GNOME and other supported desktop environments, authenticate in the system prompt when package installation is requested.
4. Keep **Set up native image extraction** enabled to configure the native Rust/Pillow image decoder. The first build requires an Internet connection. You can also install Neuroport without this optional feature and configure it later.
5. When installation finishes, open **Neuroport** from your desktop application menu. Start the server, scan the QR code with your phone and load a save in Cyberpunk 2077.

If the graphical installer cannot start because Tkinter is missing, `install-linux.sh` offers to install the Python Tkinter package through a desktop dialog. If no dialog utility is available, install the matching package manually and run the installer again:

| Distribution family | Package names |
|---|---|
| Fedora / Nobara | `nodejs python3-tkinter python3-pip cargo xdotool` |
| Debian / Ubuntu | `nodejs python3-tk python3-venv python3-pip cargo xdotool build-essential` |
| Arch Linux | `nodejs python tk python-pip rust xdotool base-devel` |
| openSUSE | `nodejs python3-tk python3-pip cargo xdotool gcc` |

The installer uses `pkexec` for graphical authentication. If your distribution does not provide PolicyKit, install the listed dependencies with its package manager before running the installer.

## Run and pair

The installer creates a desktop entry at `$XDG_DATA_HOME/applications/neuroport.desktop` (normally `~/.local/share/applications/neuroport.desktop`). It launches the installed `neuroport-control.py` control window.

1. Select **Start Server**.
2. Scan the QR code with your phone, or open the displayed local address manually.
3. Make sure the phone and PC are on the same trusted Wi-Fi network.
4. Load a save. The control window reports when the game is connected.

The server listens on your local network and the phone pairs with a code. The local web app, fonts, QR library and map renderer are served by the companion server; the app does not require a third-party web service for normal operation.

## Native Linux image extraction

The Linux build does not use Windows Python, a Proton Python installation or the game's Windows Oodle DLL for image extraction. The setup script creates an isolated Python environment under `~/.local/share/neuroport/`, installs Pillow, builds `libneuroport_oodle.so` from the MIT-licensed `oozextract` crate and stores the compiled library in the same application-data directory.

The optional runtime extracts contact portraits, vehicle photos and other game images from the user's own Cyberpunk archives. It requires Rust/Cargo, Python venv/pip and an Internet connection on the first setup. After changing or installing the runtime, restart the Neuroport server.

To retry the setup manually, run the installed script:

```bash
"<Cyberpunk 2077>/bin/x64/plugins/cyber_engine_tweaks/mods/neuroport/companion/setup-native-image-extraction.sh"
```

## Uninstall

Run this from the extracted project directory:

```bash
./uninstall-linux.sh
```

To retain the native Python/Pillow environment and compiled decoder:

```bash
./uninstall-linux.sh --keep-image-runtime
```

The uninstaller removes only Neuroport's CET mod folder, desktop launcher, application data (unless retained), logs and build cache. It does not remove CET, RED4ext, Codeware or other mods.

## Repository layout

| Path | Description |
|---|---|
| `mod/neuroport/init.lua` | Cyber Engine Tweaks mod. Reads game state and handles commands. |
| `server/server.js` | Local Node.js server, HTTP API, event stream, pairing and control panel. |
| `server/mock.js` | Mock game state for UI development. |
| `server/presskey.ps1` | Original Windows photo-mode key helper. Linux uses `xdotool`/`ydotool` in `server.js`. |
| `web/` | Web app, desktop/mobile layouts, control panel, map, icons and bundled libraries. |
| `tools/gamefiles/` | Extractors for portraits, vehicle images, map icons and ringtone. |
| `tools/native_oodle/` | Native Linux Oodle/Kraken decoder bridge (Rust). |
| `linux/` | Linux graphical installer, installation backend, controller, desktop-entry template and uninstaller. |
| `release/` | In-game companion documentation and third-party notices. |

## Development and mock mode

The server has no npm dependencies and uses Node.js built-in modules. To run the UI without Cyberpunk 2077, use the Windows `start-mock.bat` launcher or run:

```bash
node server/server.js --mock --port 7078
```

The mock instance uses the pairing code `TEST01`. For a live installation outside the standard Steam paths, pass the game mod folder explicitly:

```bash
node server/server.js --bridge "/path/to/Cyberpunk 2077/bin/x64/plugins/cyber_engine_tweaks/mods/neuroport"
```

The original Windows installation and packaging scripts remain in the source tree. The Linux installer uses the native Python implementation in `linux/`.

## Security and privacy

- Neuroport is designed to run on your local network. It does not send game state to a remote Neuroport service.
- The pairing code is generated locally. Only paired clients can use the phone API.
- The control panel is restricted to requests from the local PC.
- Local-network transport uses HTTP, not HTTPS. Use a trusted private network; do not expose the server port to the public Internet.
- Game images and map assets are generated from the user's own game installation. They are not a substitute for owning Cyberpunk 2077.

## License and acknowledgements

Neuroport's own code is distributed under the [MIT License](LICENSE). Cyberpunk 2077 and its content are (c) CD PROJEKT S.A. Neuroport is a fan-made project and is not affiliated with or endorsed by CD PROJEKT RED. See [CREDITS.md](CREDITS.md) and `release/LICENSES/` for third-party notices.

For the Linux release changes and AI-use disclosure, see [RELEASE_NOTES.md](RELEASE_NOTES.md).
