#!/usr/bin/env python3
"""Remove the Neuroport Linux integration without touching CET or other mods."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

MOD_REL = Path("bin/x64/plugins/cyber_engine_tweaks/mods/neuroport")


def main() -> int:
    parser = argparse.ArgumentParser(description="Uninstall Neuroport from Linux")
    parser.add_argument("--game", type=Path, help="Cyberpunk 2077 folder (optional)")
    parser.add_argument("--keep-image-runtime", action="store_true",
                        help="Keep the Python/Pillow environment and native Oodle decoder")
    args = parser.parse_args()

    home = Path.home()
    data_home = Path(os.environ.get("XDG_DATA_HOME", home / ".local/share")).expanduser()
    state_home = Path(os.environ.get("XDG_STATE_HOME", home / ".local/state")).expanduser()
    cache_home = Path(os.environ.get("XDG_CACHE_HOME", home / ".cache")).expanduser()
    app_data = data_home / "neuroport"
    paths_file = app_data / "install-paths.json"

    game = args.game.expanduser().resolve() if args.game else None
    if game is None and paths_file.is_file():
        try:
            saved = json.loads(paths_file.read_text(encoding="utf-8"))
            candidate = Path(saved.get("game_dir", "")).expanduser()
            if candidate.is_dir():
                game = candidate.resolve()
        except (OSError, ValueError, TypeError):
            pass

    if game is None:
        print("Could not locate the game installation.", file=sys.stderr)
        print("Run again with: ./uninstall-linux.sh --game '/path/to/Cyberpunk 2077'", file=sys.stderr)
        return 2

    companion = game / MOD_REL / "companion"
    stop_script = companion / "stop-neuroport.sh"
    if stop_script.is_file():
        try:
            result = subprocess.run([str(stop_script)], text=True, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, timeout=10, check=False)
            if result.stdout.strip():
                print(result.stdout.strip())
        except (OSError, subprocess.TimeoutExpired) as exc:
            print(f"Warning: could not stop the server automatically: {exc}")

    mod_dir = game / MOD_REL
    if mod_dir.exists():
        if not (mod_dir / "init.lua").is_file():
            print(f"Refusing to remove a folder that does not look like Neuroport: {mod_dir}", file=sys.stderr)
            return 3
        shutil.rmtree(mod_dir)
        print(f"Removed: {mod_dir}")
    else:
        print(f"Mod folder is already absent: {mod_dir}")

    desktop = data_home / "applications/neuroport.desktop"
    if desktop.is_file():
        try:
            contents = desktop.read_text(encoding="utf-8", errors="replace")
        except OSError:
            contents = ""
        if "neuroport-control.py" in contents:
            desktop.unlink(missing_ok=True)
            print(f"Removed application launcher: {desktop}")

    (data_home / "icons/neuroport.svg").unlink(missing_ok=True)
    update_db = shutil.which("update-desktop-database")
    if update_db:
        subprocess.run([update_db, str(data_home / "applications")], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if args.keep_image_runtime:
        paths_file.unlink(missing_ok=True)
        print("Native image runtime kept in ~/.local/share/neuroport")
    elif app_data.exists():
        shutil.rmtree(app_data)
        print("Removed application data and native image runtime: ~/.local/share/neuroport")

    for folder, label in (
        (state_home / "neuroport", "server logs and PID files"),
        (cache_home / "neuroport", "Rust build cache"),
    ):
        if folder.exists():
            shutil.rmtree(folder)
            print(f"Removed {label}: {folder}")

    print("Neuroport was uninstalled. CET, RED4ext, Codeware and other mods were not touched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
