#!/usr/bin/env python3
"""Install the Neuroport source tree into a Steam Cyberpunk 2077 installation."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

MOD_REL = Path("bin/x64/plugins/cyber_engine_tweaks/mods/neuroport")


def steam_roots(home: Path) -> list[Path]:
    candidates = [
        home / ".local/share/Steam",
        home / ".steam/steam",
        home / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
        home / ".var/app/com.valvesoftware.Steam/.steam/steam",
        home / "Games/Steam",
    ]
    roots: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if str(resolved) not in seen:
            roots.append(resolved)
            seen.add(str(resolved))

    for root in list(roots):
        vdf = root / "steamapps/libraryfolders.vdf"
        try:
            content = vdf.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for raw in re.findall(r'"path"\s+"((?:\\.|[^"])*)"', content):
            candidate = Path(raw.replace("\\\\", "\\").replace('\\"', '"')).expanduser()
            try:
                resolved = candidate.resolve(strict=True)
            except OSError:
                continue
            if str(resolved) not in seen:
                roots.append(resolved)
                seen.add(str(resolved))
    return roots


def discover_games(home: Path) -> list[Path]:
    games: list[Path] = []
    seen: set[str] = set()
    for root in steam_roots(home):
        game = root / "steamapps/common/Cyberpunk 2077"
        if (game / "bin/x64/Cyberpunk2077.exe").exists() or (game / "bin/x64/plugins/cyber_engine_tweaks").is_dir():
            resolved = game.resolve()
            if str(resolved) not in seen:
                games.append(resolved)
                seen.add(str(resolved))
    return games


def _desktop_quote(value: str | Path) -> str:
    value = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{value}"'


def write_control_scripts(companion: Path) -> tuple[Path, Path]:
    state_home = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")).expanduser()
    state_dir = state_home / "neuroport"
    state_dir.mkdir(parents=True, exist_ok=True)

    start = companion / "start-neuroport.sh"
    stop = companion / "stop-neuroport.sh"
    start.write_text(r'''#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/neuroport"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/neuroport"
mkdir -p "$STATE_DIR" "$APP_DIR"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"
SERVER="$HERE/server/server.js"
if ! command -v node >/dev/null 2>&1; then
  MSG="Node.js 18 or later is required. Install it with your distribution's package manager."
  echo "$MSG" | tee -a "$LOG_FILE" >&2
  command -v notify-send >/dev/null 2>&1 && notify-send "Neuroport" "$MSG" || true
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 18 )); then
  MSG="Neuroport requires Node.js 18 or later (found $(node --version))."
  echo "$MSG" | tee -a "$LOG_FILE" >&2
  command -v notify-send >/dev/null 2>&1 && notify-send "Neuroport" "$MSG" || true
  exit 1
fi
is_neuroport_pid() {
  local candidate="$1"
  [[ "$candidate" =~ ^[0-9]+$ && -r "/proc/$candidate/cmdline" ]] || return 1
  tr '\0' ' ' < "/proc/$candidate/cmdline" | grep -Fq "$SERVER"
}
if [[ -s "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_neuroport_pid "$OLD_PID"; then
    echo "Neuroport is already running (PID $OLD_PID)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi
export NEUROPORT_PID_FILE="$PID_FILE"
IMAGE_PYTHON="$APP_DIR/image-venv/bin/python"
if [[ -x "$IMAGE_PYTHON" ]]; then
  export NEUROPORT_IMAGE_PYTHON="$IMAGE_PYTHON"
fi
nohup node "$SERVER" >>"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Neuroport failed to start. Log: $LOG_FILE"
  tail -40 "$LOG_FILE" || true
  exit 1
fi
echo "Neuroport started. Log: $LOG_FILE"
echo "Open the Neuroport control window."
''', encoding="utf-8")
    stop.write_text(r'''#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/neuroport"
PID_FILE="$STATE_DIR/server.pid"
SERVER="$HERE/server/server.js"
if [[ ! -s "$PID_FILE" ]]; then
  echo "Neuroport was not started by this launcher."
  exit 0
fi
PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ "$PID" =~ ^[0-9]+$ && -r "/proc/$PID/cmdline" ]] && tr '\0' ' ' < "/proc/$PID/cmdline" | grep -Fq "$SERVER"; then
  kill "$PID" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 "$PID" 2>/dev/null || break
    sleep .1
  done
  if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi
fi
rm -f "$PID_FILE"
echo "Neuroport stopped."
''', encoding="utf-8")
    start.chmod(0o755)
    stop.chmod(0o755)
    return start, stop


def write_desktop_entry(companion: Path, source_root: Path, home: Path) -> Path:
    data_home = Path(os.environ.get("XDG_DATA_HOME", home / ".local/share")).expanduser()
    applications = data_home / "applications"
    applications.mkdir(parents=True, exist_ok=True)
    icons = data_home / "icons"
    icons.mkdir(parents=True, exist_ok=True)

    icon_source = companion / "web/icon.svg"
    icon_target = icons / "neuroport.svg"
    if icon_source.is_file():
        shutil.copy2(icon_source, icon_target)

    control = companion / "neuroport-control.py"
    template = source_root / "linux/neuroport.desktop.in"
    if template.is_file():
        content = template.read_text(encoding="utf-8")
        content = content.replace("@PYTHON@", _desktop_quote(shutil.which("python3") or "/usr/bin/python3"))
        content = content.replace("@CONTROL_SCRIPT@", _desktop_quote(control))
        content = content.replace("@COMPANION_DIR@", _desktop_quote(companion))
        content = content.replace("@ICON@", str(icon_target if icon_target.exists() else "applications-games"))
    else:
        content = "\n".join([
            "[Desktop Entry]", "Version=1.0", "Type=Application", "Name=Neuroport",
            "GenericName=Cyberpunk 2077 Companion Control",
            "Comment=Start and control Neuroport and display the phone pairing QR code",
            f"Exec={_desktop_quote(shutil.which('python3') or '/usr/bin/python3')} {_desktop_quote(control)} --companion {_desktop_quote(companion)}",
            f"Icon={icon_target if icon_target.exists() else 'applications-games'}",
            "Terminal=false", "Categories=Game;Utility;", "StartupNotify=true", "",
        ])
    desktop = applications / "neuroport.desktop"
    desktop.write_text(content, encoding="utf-8")
    desktop.chmod(0o644)
    updater = shutil.which("update-desktop-database")
    if updater:
        subprocess.run([updater, str(applications)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return desktop


def write_user_install_info(game_dir: Path, companion: Path, home: Path) -> None:
    data_home = Path(os.environ.get("XDG_DATA_HOME", home / ".local/share")).expanduser()
    app_data = data_home / "neuroport"
    app_data.mkdir(parents=True, exist_ok=True)
    (app_data / "install-paths.json").write_text(json.dumps({
        "game_dir": str(game_dir),
        "companion": str(companion),
    }, indent=2) + "\n", encoding="utf-8")


def assemble_mod_tree(source_root: Path, staging: Path) -> None:
    source_mod = source_root / "mod/neuroport/init.lua"
    if not source_mod.is_file():
        raise FileNotFoundError(f"CET mod source not found: {source_mod}")
    shutil.copy2(source_mod, staging / "init.lua")
    companion = staging / "companion"
    companion.mkdir(parents=True, exist_ok=True)

    copy_jobs = [
        (source_root / "server", companion / "server"),
        (source_root / "web", companion / "web"),
        (source_root / "tools/gamefiles", companion / "tools/gamefiles"),
        (source_root / "tools/native_oodle", companion / "tools/native_oodle"),
    ]
    for src, dst in copy_jobs:
        if not src.is_dir():
            raise FileNotFoundError(f"Required project folder not found: {src}")
        shutil.copytree(src, dst, symlinks=True)

    extra_files = [
        (source_root / "tools/setup-native-image-extraction.sh", companion / "setup-native-image-extraction.sh"),
        (source_root / "linux/neuroport-control.py", companion / "neuroport-control.py"),
        (source_root / "linux/neuroport-qr-matrix.js", companion / "neuroport-qr-matrix.js"),
        (source_root / "release/README.txt", companion / "README.txt"),
        (source_root / "release/CREDITS.txt", companion / "CREDITS.txt"),
    ]
    for src, dst in extra_files:
        if src.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    licenses_src = source_root / "release/LICENSES"
    if licenses_src.is_dir():
        shutil.copytree(licenses_src, companion / "LICENSES", symlinks=True)
    (companion / "web/avatars").mkdir(parents=True, exist_ok=True)
    for script in (companion / "setup-native-image-extraction.sh", companion / "neuroport-control.py"):
        if script.exists():
            script.chmod(0o755)


def install(game_dir: Path, source_root: Path, *, setup_native: bool = True, log=print) -> Path:
    game = game_dir.expanduser().resolve()
    if not game.is_dir():
        raise NotADirectoryError(f"Game folder does not exist: {game}")
    cet = game / "bin/x64/plugins/cyber_engine_tweaks"
    if not cet.is_dir():
        raise FileNotFoundError(f"Cyber Engine Tweaks was not found at: {cet}\nInstall CET before installing Neuroport.")

    dest = game / MOD_REL
    dest.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = None
    if dest.exists():
        backup = dest.with_name(f"neuroport.backup-{stamp}")
        shutil.copytree(dest, backup, symlinks=True)
        log(f"Previous installation backed up to: {backup}")

    preserve_names = [
        "neuroport_settings.txt", "neuroport_capspots.txt", "state.json", "world.json",
        "shards.json", "probe.json", "inbox.txt",
    ]
    preserved_files: dict[str, bytes] = {}
    preserved_token: bytes | None = None
    preserved_avatars: list[tuple[str, bytes]] = []
    if dest.is_dir():
        for name in preserve_names:
            path = dest / name
            if path.is_file():
                try:
                    preserved_files[name] = path.read_bytes()
                except OSError:
                    pass
        token = dest / "companion/server/.token"
        if token.is_file():
            try:
                preserved_token = token.read_bytes()
            except OSError:
                pass
        avatars = dest / "companion/web/avatars"
        if avatars.is_dir():
            for path in avatars.glob("*.png"):
                try:
                    preserved_avatars.append((path.name, path.read_bytes()))
                except OSError:
                    pass

    staging = dest.with_name(f"neuroport.installing-{stamp}")
    if staging.exists():
        shutil.rmtree(staging)
    try:
        staging.mkdir(parents=True)
        assemble_mod_tree(source_root, staging)
        for name, data in preserved_files.items():
            (staging / name).write_bytes(data)
        if preserved_token is not None:
            token = staging / "companion/server/.token"
            token.parent.mkdir(parents=True, exist_ok=True)
            token.write_bytes(preserved_token)
        for name, data in preserved_avatars:
            avatar_dir = staging / "companion/web/avatars"
            avatar_dir.mkdir(parents=True, exist_ok=True)
            (avatar_dir / name).write_bytes(data)
        if dest.exists():
            shutil.rmtree(dest)
        staging.rename(dest)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        raise

    companion = dest / "companion"
    write_control_scripts(companion)
    desktop = write_desktop_entry(companion, source_root, Path.home())
    write_user_install_info(game, companion, Path.home())

    log(f"Neuroport installed in: {dest}")
    log(f"Control script: {companion / 'neuroport-control.py'}")
    log(f"Desktop launcher: {desktop}")
    log("Open Neuroport from your desktop application menu.")
    if backup:
        log(f"Previous installation backup retained at: {backup}")

    if setup_native:
        setup = companion / "setup-native-image-extraction.sh"
        if setup.is_file():
            log("Setting up native image extraction (Rust Oodle/Kraken + Linux Pillow)...")
            result = subprocess.run([str(setup)], cwd=str(companion), check=False)
            if result.returncode:
                log("Native image setup did not complete. Run setup-native-image-extraction.sh after installing Cargo.")
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Neuroport on Linux / Steam Proton")
    parser.add_argument("--game", type=Path, help="Cyberpunk 2077 installation directory")
    parser.add_argument("--skip-native-setup", action="store_true", help="Do not build the optional native image runtime")
    args = parser.parse_args()
    source_root = Path(__file__).resolve().parents[1]

    if args.game:
        game = args.game.expanduser()
    else:
        games = discover_games(Path.home())
        if not games:
            print("Cyberpunk 2077 was not found in the standard Steam libraries.", file=sys.stderr)
            print("Run again with --game '/path/to/SteamLibrary/steamapps/common/Cyberpunk 2077'.", file=sys.stderr)
            return 3
        with_cet = [g for g in games if (g / "bin/x64/plugins/cyber_engine_tweaks").is_dir()]
        if len(with_cet) == 1:
            game = with_cet[0]
        elif len(games) == 1:
            game = games[0]
        else:
            print("Multiple Cyberpunk 2077 installations were found. Specify --game:", file=sys.stderr)
            for candidate in games:
                print(f"  {candidate}", file=sys.stderr)
            return 4

    try:
        install(game, source_root, setup_native=not args.skip_native_setup)
    except (OSError, RuntimeError, FileNotFoundError, NotADirectoryError) as exc:
        print(f"Installation failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
