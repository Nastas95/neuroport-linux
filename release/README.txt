NEUROPORT — LINUX DESKTOP COMPANION FOR CYBERPUNK 2077
======================================================

Your phone becomes V's. Neuroport is a second-screen companion for Cyberpunk
2077. Use Comms, calls, Night City's map, Car Mode, your garage, radio, shards
and more from a phone or desktop browser over your local Wi-Fi.

REQUIREMENTS
------------
- Cyberpunk 2077 2.x installed through Steam and launched at least once.
- Cyber Engine Tweaks (CET): https://www.nexusmods.com/cyberpunk2077/mods/107
- RED4ext: https://www.nexusmods.com/cyberpunk2077/mods/2380
- Codeware: https://www.nexusmods.com/cyberpunk2077/mods/7780
- Node.js 18 or later.
- Python 3.10 or later with Tkinter.
- A phone on the same trusted Wi-Fi network as the PC.

INSTALL
-------
1. Extract the archive to a directory of your choice.
2. Open a terminal in that directory and run:
       chmod +x install-linux.sh
       ./install-linux.sh
3. The graphical installer detects Steam installations, checks dependencies
   and can install packages through PolicyKit. Browse to the game folder if
   automatic detection does not find it.
4. Keep the native image extraction option enabled for contact portraits,
   vehicle pictures and game images. This first-time setup needs Cargo/Rust,
   Python venv/pip and an Internet connection to download and build the decoder.
5. Open Neuroport from the desktop application menu, start the server and scan
   the QR code with your phone. Both devices must be on the same Wi-Fi network.

If Tkinter is missing, the shell launcher offers to install it through a
system dialog. If the dialog is unavailable, install the Python Tkinter package
for your distribution and run install-linux.sh again.

DESKTOP CONTROL PANEL
---------------------
The installer creates a desktop application entry that starts
neuroport-control.py. From this window you can start and stop the local server,
open Neuroport in the PC browser and display the phone pairing QR code.

INTERFACE
---------
The interface adapts to the available device. Touch-first screens retain the
mobile layout. Desktop browsers use a wider dashboard and persistent side
navigation; Comms displays the conversation list next to the open chat, and
Car Mode places the map on the left with vehicle/navigation controls on the
right.

NATIVE LINUX IMAGE EXTRACTION
-----------------------------
Linux image extraction does not use Windows Python, Proton or the game's PE
Oodle DLL. The setup builds a native Rust shared library from the MIT-licensed
oozextract crate and uses Linux Pillow for BC7 texture decoding. The compiled
runtime is stored under ~/.local/share/neuroport/. Restart the Neuroport server
after the setup completes.

UNINSTALL
---------
From the extracted project folder, run:
       ./uninstall-linux.sh
To keep the native image runtime, use:
       ./uninstall-linux.sh --keep-image-runtime

FEATURES
--------
Comms, phone calls, map and GPS, Car Mode, garage, Autofixer, Quick Gig,
journal, radio, shards, player status, photo mode, gallery and immersive HUD
controls. Desktop and phone layouts are adapted independently.

CREDITS
-------
Neuroport is a fan-made project and is not affiliated with CD PROJEKT RED.
Cyberpunk 2077 and its game content are (c) CD PROJEKT S.A. See CREDITS.txt
and LICENSES/ for the full credits and third-party license notices.
