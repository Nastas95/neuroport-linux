#!/usr/bin/env python3
"""Build/configure native Linux Oodle + Python/Pillow for Neuroport image extraction."""
from __future__ import annotations
import ctypes
import os
import shutil
import subprocess
import sys
from pathlib import Path

COMPANION = Path(__file__).resolve().parents[2]
GAME_DIR = COMPANION.parents[6]
PROJECT = Path(__file__).resolve().parent
HOME = Path.home()
DATA_HOME = Path(os.environ.get("XDG_DATA_HOME", HOME / ".local/share")).expanduser()
CACHE_HOME = Path(os.environ.get("XDG_CACHE_HOME", HOME / ".cache")).expanduser()
IMAGE_HOME = DATA_HOME / "neuroport"
VENV = IMAGE_HOME / "image-venv"
PYTHON = VENV / "bin" / "python"
LIB_DEST = IMAGE_HOME / "libneuroport_oodle.so"


def run(command: list[str], *, env: dict[str, str] | None = None, cwd: Path | None = None) -> None:
    print("$", " ".join(str(x) for x in command), flush=True)
    subprocess.run(command, check=True, env=env, cwd=cwd)


def main() -> int:
    if sys.platform != "linux":
        print("This setup is intended for Linux.", file=sys.stderr)
        return 2
    if not (GAME_DIR / "archive/pc/content").is_dir():
        print(f"Unrecognized game directory: {GAME_DIR}", file=sys.stderr)
        return 3

    cargo = shutil.which("cargo")
    if not cargo:
        cargo_home = Path.home() / ".cargo/bin/cargo"
        if cargo_home.is_file():
            cargo = str(cargo_home)
    if not cargo:
        print("Cargo/Rust is missing. On Nobara/Fedora, install it with:", file=sys.stderr)
        print("  sudo dnf install cargo", file=sys.stderr)
        return 4

    IMAGE_HOME.mkdir(parents=True, exist_ok=True)
    CACHE_HOME.mkdir(parents=True, exist_ok=True)

    if not PYTHON.is_file():
        print("Creating Neuroport's isolated Linux Python environment…", flush=True)
        run([sys.executable, "-m", "venv", "--system-site-packages", str(VENV)])

    # Pillow's BCn/BC7 decoder must be available in this Linux virtualenv.
    try:
        subprocess.run(
            [str(PYTHON), "-c", "from PIL import Image; print('Pillow', __import__('PIL').__version__); Image.frombuffer('RGBA',(4,4),bytes([0x40])+bytes(15),'bcn',7,'').load()"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Installing Pillow in the Linux Python environment…", flush=True)
        run([str(PYTHON), "-m", "pip", "install", "--disable-pip-version-check", "Pillow>=11"])
        run([str(PYTHON), "-c", "from PIL import Image; Image.frombuffer('RGBA',(4,4),bytes([0x40])+bytes(15),'bcn',7,'').load()"])

    target = CACHE_HOME / "neuroport" / "native-oodle-target"
    target.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["CARGO_TARGET_DIR"] = str(target)
    print("Building the native Oodle/Kraken decoder (Rust)…", flush=True)
    run([cargo, "build", "--release", "--manifest-path", str(PROJECT / "Cargo.toml")], env=env, cwd=PROJECT)
    built = target / "release" / "libneuroport_oodle.so"
    if not built.is_file():
        print(f"Build completed, but the library was not found: {built}", file=sys.stderr)
        return 5
    shutil.copy2(built, LIB_DEST)
    LIB_DEST.chmod(0o755)

    # Exercise the C ABI with the crate's documented uncompressed Kraken block
    # pattern, and verify Pillow's BC7 mode-6 decoder. This tests the native call
    # boundary and BC7 decoder without pretending to validate a real game archive.
    try:
        lib = ctypes.CDLL(str(LIB_DEST))
        lib.neuroport_oodle_abi_version.restype = ctypes.c_uint32
        abi = lib.neuroport_oodle_abi_version()
        if abi != 1:
            raise RuntimeError(f"Unsupported ABI: {abi}")
        fn = lib.neuroport_oodle_decompress
        fn.restype = ctypes.c_int64
        fn.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
        sample_len = 0x40000
        sample = ctypes.create_string_buffer(bytes([0x4C, 0x06]) + bytes([0xAB]) * sample_len)
        output = ctypes.create_string_buffer(sample_len)
        count = fn(sample, len(sample) - 1, output, sample_len)
        if count != sample_len or output.raw != bytes([0xAB]) * sample_len:
            raise RuntimeError(f"ABI/decompression test failed: decoder={count}")
        subprocess.run(
            [str(PYTHON), "-c", "from PIL import Image; im=Image.frombuffer('RGBA',(4,4),bytes([0x40])+bytes(15),'bcn',7,''); im.load(); print('BC7 decoder OK')"],
            check=True,
        )
    except Exception as exc:
        print(f"Native runtime test failed: {exc}", file=sys.stderr)
        return 6

    print("\nNATIVE IMAGE RUNTIME CONFIGURED", flush=True)
    print(f"Linux Python: {PYTHON}")
    print(f"Linux Oodle decoder: {LIB_DEST}")
    print("No Windows Python, PE DLL, or Proton prefix is required for extraction.")
    print("Stop and restart Neuroport: images will be extracted from the local game archives.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Command failed (exit {exc.returncode}). Check the logs, Cargo, and your Internet connection.", file=sys.stderr)
        raise SystemExit(exc.returncode or 1)
    except Exception as exc:
        print(f"Native image setup failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
