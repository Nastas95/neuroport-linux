# Neuroport — Credits and Licenses

Neuroport is a fan-made mod. It is not affiliated with or endorsed by CD PROJEKT RED.

## Required mods (installed separately)

- **Cyber Engine Tweaks (CET)** — yamashi and CET contributors, MIT. Runs Neuroport's Lua code inside the game. <https://github.com/maximegmd/CyberEngineTweaks>
- **RED4ext** — WopsS and contributors, MIT. <https://github.com/wopss/RED4ext>
- **Codeware** — psiberx, MIT. Provides access to the game's map markers. <https://github.com/psiberx/cp2077-codeware>

## Runtimes

- **Node.js** — OpenJS Foundation and contributors, MIT. Runs the local Neuroport server. <https://nodejs.org>
- **Python** — Python Software Foundation, PSF License. Used by the game-data extractors. <https://www.python.org>
- **Pillow** — Jeffrey A. Clark and contributors, MIT-CMU. Decodes BC7 textures. <https://python-pillow.org>
- **oozextract 0.5.4** — MIT. Native Linux Oodle/Kraken decompression bridge. <https://github.com/lvlvllvlvllvlvl/oozextract>

## Libraries used by the app

- **three.js r170** — three.js authors, MIT. Map renderer, including GLTFLoader and Line2/LineMaterial add-ons. <https://threejs.org>
- **qrcode-generator 1.4.4** — Kazuhiko Arase, MIT. QR-code generation. <https://github.com/kazuhikoarase/qrcode-generator>

## Fonts

- **Rajdhani** — Indian Type Foundry, SIL OFL 1.1.
- **Share Tech Mono** — Carrois Type Design (Ralph du Carrois), SIL OFL 1.1.

## Map data

- **Open2077 / op77_map3d** — Open2077 contributors, MIT. Map data format and exporter. The exported game data itself is not covered by the MIT license. See `release/LICENSES/open2077-map3d-LICENSE.txt` and `release/LICENSES/open2077-map3d-NOTICE.txt`.

## References

- WolvenKit and the Cyberpunk 2077 modding community (<https://wiki.redmodding.org>) document the `.archive` and CR2W formats used by the extractors.
- The Windows Oodle path uses the game's own `oo2ext_7_win64.dll`, loaded from the user's installation and not redistributed.
- The Linux path uses the MIT-licensed `oozextract` crate; no proprietary Oodle DLL is bundled.
- El Capitan vehicle-contract areas were cross-referenced with guides by GNL Magazine and GamingBolt.

## Game content

Cyberpunk 2077 (c) CD PROJEKT S.A. All rights reserved. CD PROJEKT, Cyberpunk and Cyberpunk 2077 are registered trademarks of CD PROJEKT S.A. Map geometry, map icons, contact portraits, vehicle images, message images, ringtone and Personal Link artwork belong to CD PROJEKT S.A. These assets are generated from the user's own game installation or shown as promotional art under CD PROJEKT RED's fan-content guidelines.

## Tools used during development

- FFmpeg (LGPL/GPL) — video captures and preview GIFs.
- Microsoft Edge (headless) — page banners.
- luaparse (MIT) — Lua syntax checks.
- Claude Code (Anthropic) — AI coding assistance used during upstream development.
- OpenAI ChatGPT — AI assistance for this Linux adaptation, installer, desktop integration, translations, documentation and packaging checks; see `RELEASE_NOTES.md`.
