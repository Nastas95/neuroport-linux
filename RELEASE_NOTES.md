# Neuroport 1.0 — Linux Desktop Release

## Desktop bug fixes

- Fixed the desktop wallpaper action: selecting “Set as wallpaper” from the photo viewer now saves the selected image, returns to Home and confirms the change.
- Reworked the desktop Shards reader into a persistent two-pane layout: the shard list remains on the left while the selected document opens on the right. The app-bar Back control closes the document and restores the empty reader pane.
- Preserved the mobile full-screen shard reader and restored full-height scrolling for the list and reader.

## Linux packaging and installation

- Reorganized the Linux distribution as a source repository that follows the upstream `mod/`, `server/`, `web/` and `tools/` layout.
- Added a graphical installer for Linux. It detects common Steam library locations, lets the user select the Cyberpunk 2077 folder, checks system requirements and can install dependencies using PolicyKit (`pkexec`).
- Added distribution-specific dependency handling for Fedora/Nobara, Debian/Ubuntu, Arch Linux and openSUSE.
- Added a desktop application entry under `$XDG_DATA_HOME/applications/`. Its `Exec` command starts the installed `neuroport-control.py` with the correct companion directory.
- Added a graphical control panel for starting/stopping the server, opening the local app and displaying the phone pairing QR code.
- Added a native Linux image-extraction setup based on Rust `oozextract` and Linux Pillow. No Windows Python runtime or proprietary Oodle DLL is bundled for the Linux path.

## Interface

- Kept the touch-first mobile interface while adding a wider desktop layout.
- Added side-by-side conversation navigation and chat in Comms.
- Reworked desktop Car Mode with the map in the left column and vehicle/navigation controls in a compact right column.
- Reduced the initial map zoom distance for the desktop Car Mode view.

## Documentation and maintenance

- Adapted the upstream README for Linux and Steam Proton.
- Added Linux installation, dependency, update and uninstall instructions.
- Removed redundant comments from the new Linux scripts and provided English desktop-control and installer text.

## AI-use disclosure

AI assistance (OpenAI ChatGPT) was used to help implement and revise the Linux-specific installer, dependency checks, desktop launcher integration, translations and documentation, and to review packaging and syntax. The upstream Neuroport project was created by its original author; this AI-assisted work is a Linux adaptation and does not claim authorship of the original mod. The AI did not generate Cyberpunk 2077 assets: game-derived data and images are extracted locally from the user's own game files. The resulting package has undergone static checks, but it has not been exhaustively tested across every Linux distribution, desktop environment or Cyberpunk installation.

## Compatibility notes

- Cyberpunk 2077 2.x under Steam Proton.
- Cyber Engine Tweaks, RED4ext and Codeware are separate requirements.
- Node.js 18 or later and Python 3.10 or later are required for the Linux installer/control panel.
- `xdotool` is used for photo-mode key automation on supported X11/XWayland sessions; the optional native image extractor requires Rust/Cargo, Python venv/pip and an Internet connection on first setup.

## Credits

Neuroport's own code is distributed under the MIT License. See `LICENSE`, `CREDITS.md` and `release/LICENSES/` for attribution and third-party notices. Cyberpunk 2077 and its content are (c) CD PROJEKT S.A.
