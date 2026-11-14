#!/usr/bin/env python3
"""Build the minimal Neuroport Linux release ZIP from source plus prior generated assets."""

from __future__ import annotations

import argparse
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[1]
EXECUTABLES = {
    "install-linux.sh",
    "uninstall-linux.sh",
    "linux/neuroport-control.py",
    "linux/installer_gui.py",
    "linux/install.py",
    "linux/uninstall.py",
    "tools/setup-native-image-extraction.sh",
    "tools/native_oodle/setup_native_image_extraction.py",
}
LOGOS = {
    "web/icons/autofixer.png": (200, 104),
    "web/icons/autofixer_wide.png": (344, 48),
}
SEEDED_FILES = {
    "web/ringtone/ringtone.ogg",
    "tools/gamefiles/atlas_index.json",
}
MAP3D_REQUIRED = {
    "web/map3d/manifest.json",
    "web/map3d/roads.bin",
    "web/map3d/buildings.bin",
    "web/map3d/world.glb",
}
GAMEFILE_SCRIPTS = (
    "tools/gamefiles/atlas_bc7.py",
    "tools/gamefiles/avatar.py",
    "tools/gamefiles/cr2w.py",
    "tools/gamefiles/extract_ringtone.py",
    "tools/gamefiles/rdar.py",
)
LINUX_FILES = (
    "linux/neuroport-control.py",
    "linux/neuroport-qr-matrix.js",
    "linux/installer_gui.py",
    "linux/install.py",
    "linux/uninstall.py",
    "linux/neuroport.desktop.in",
)
ROOT_FILES = (
    "LICENSE",
    "install-linux.sh",
    "uninstall-linux.sh",
    "mod/neuroport/init.lua",
    "server/server.js",
    "tools/setup-native-image-extraction.sh",
)


def fail(message: str) -> None:
    raise SystemExit(f"package-linux: error: {message}")


def copy_file(source_rel: str, dest_rel: str, package_root: Path) -> None:
    source = REPO / source_rel
    if not source.is_file():
        fail(f"required source file is missing: {source_rel}")
    destination = package_root / PurePosixPath(dest_rel)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def copy_tree(source_rel: str, dest_rel: str, package_root: Path) -> None:
    source_root = REPO / source_rel
    if not source_root.is_dir():
        fail(f"required source directory is missing: {source_rel}")
    for source in sorted(source_root.rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(source_root)
        destination = package_root / PurePosixPath(dest_rel) / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def copy_web(package_root: Path) -> None:
    source_root = REPO / "web"
    if not source_root.is_dir():
        fail("required source directory is missing: web")

    generated_dirs = {"map3d", "mapicons", "avatars", "ringtone"}
    for source in sorted(source_root.rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(source_root)
        if relative.parts and relative.parts[0] in generated_dirs:
            continue
        if relative.parts[0] == "icons":
            # Keep only the two current PNG logos in the release, not editable sources
            # or unrelated local/game-derived icon files.
            if relative.suffix.lower() == ".svg":
                continue
            if relative.suffix.lower() == ".png" and f"web/icons/{relative.name}" not in LOGOS:
                continue
        destination = package_root / "web" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def find_seed_root(archive: zipfile.ZipFile) -> str:
    candidates: set[str] = set()
    marker = "/web/map3d/manifest.json"
    for item in archive.infolist():
        name = item.filename
        if name.endswith(marker):
            root = name[: -len(marker)]
            if root.startswith("Neuroport-Linux-"):
                candidates.add(root)
    if len(candidates) != 1:
        fail("seed ZIP must contain one Neuroport-Linux-*/web/map3d/manifest.json")
    return candidates.pop()


def copy_seed_assets(seed_zip: Path, package_root: Path) -> None:
    if not seed_zip.is_file():
        fail(f"seed release ZIP not found: {seed_zip}")

    with zipfile.ZipFile(seed_zip) as archive:
        root = find_seed_root(archive)
        prefix = root + "/"
        copied: set[str] = set()
        map_icon_count = 0

        for item in archive.infolist():
            if item.is_dir() or not item.filename.startswith(prefix):
                continue
            relative = PurePosixPath(item.filename[len(prefix) :])
            if relative.is_absolute() or ".." in relative.parts:
                fail(f"unsafe path in seed ZIP: {item.filename}")
            relative_name = relative.as_posix()
            keep = (
                relative_name.startswith("web/map3d/")
                or (relative_name.startswith("web/mapicons/") and relative.suffix.lower() == ".png")
                or relative_name in SEEDED_FILES
            )
            # Never carry forward the old Autofixer logos from the seed ZIP.
            if not keep or relative_name.startswith("web/icons/"):
                continue

            destination = package_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(item))
            copied.add(relative_name)
            if relative_name.startswith("web/mapicons/"):
                map_icon_count += 1

    missing = (MAP3D_REQUIRED | SEEDED_FILES) - copied
    if missing:
        fail("seed ZIP is missing required release assets: " + ", ".join(sorted(missing)))
    if map_icon_count == 0:
        fail("seed ZIP contains no web/mapicons/*.png assets")


def verify_png(path: Path, expected_size: tuple[int, int]) -> None:
    if not path.is_file():
        fail(f"required current logo is missing: {path.relative_to(REPO)}")
    data = path.read_bytes()
    if len(data) < 26 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        fail(f"logo is not a valid PNG: {path.relative_to(REPO)}")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    bit_depth, color_type = data[24], data[25]
    if (width, height) != expected_size or bit_depth != 8 or color_type != 6:
        fail(
            f"logo must be an 8-bit RGBA PNG at {expected_size[0]}x{expected_size[1]}: "
            f"{path.relative_to(REPO)} is {width}x{height}, color type {color_type}"
        )


def write_zip(package_root: Path, output_zip: Path, root_name: str) -> None:
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source in sorted(path for path in package_root.rglob("*") if path.is_file()):
            relative = source.relative_to(package_root).as_posix()
            archive_name = f"{root_name}/{relative}"
            mode = 0o755 if relative in EXECUTABLES or source.stat().st_mode & 0o111 else 0o644
            info = zipfile.ZipInfo(archive_name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(info, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def verify_zip(output_zip: Path, root_name: str) -> int:
    with zipfile.ZipFile(output_zip) as archive:
        names = set(archive.namelist())
        prefix = root_name + "/"
        required = {
            prefix + "install-linux.sh",
            prefix + "uninstall-linux.sh",
            prefix + "web/icons/autofixer.png",
            prefix + "web/icons/autofixer_wide.png",
            prefix + "web/map3d/manifest.json",
            prefix + "web/ringtone/ringtone.ogg",
            prefix + "tools/gamefiles/atlas_index.json",
        }
        missing = required - names
        if missing:
            fail("built ZIP is missing required files: " + ", ".join(sorted(missing)))
        if any(name.startswith(prefix + "web/icons/") and name.endswith(".svg") for name in names):
            fail("built ZIP unexpectedly contains editable SVG logo sources")
        if any(name.startswith(prefix + "Screenshots/") for name in names):
            fail("built ZIP unexpectedly contains development screenshots")
        if any(name.startswith(prefix + ".git/") for name in names):
            fail("built ZIP unexpectedly contains Git metadata")
        return len(names)


def build(version: str, seed_zip: Path, output_dir: Path) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", version):
        fail("version may contain only letters, digits, dots, underscores, plus signs and hyphens")

    for relative, dimensions in LOGOS.items():
        verify_png(REPO / relative, dimensions)

    root_name = f"Neuroport-Linux-{version}"
    output_zip = output_dir.resolve() / f"{root_name}-Release.zip"

    with tempfile.TemporaryDirectory(prefix="neuroport-linux-release-") as temporary:
        package_root = Path(temporary) / root_name
        package_root.mkdir(parents=True, exist_ok=True)

        for relative in ROOT_FILES:
            copy_file(relative, relative, package_root)
        copy_file("release/README.txt", "README.txt", package_root)
        copy_file("release/CREDITS.txt", "CREDITS.txt", package_root)
        copy_tree("linux", "linux", package_root)
        copy_tree("mod/neuroport", "mod/neuroport", package_root)
        copy_tree("release/LICENSES", "LICENSES", package_root)
        copy_tree("tools/native_oodle", "tools/native_oodle", package_root)
        for relative in GAMEFILE_SCRIPTS:
            copy_file(relative, relative, package_root)
        for relative in LINUX_FILES:
            # These explicit checks keep the package manifest aligned with the last release ZIP.
            if not (REPO / relative).is_file():
                fail(f"required Linux installer file is missing: {relative}")
        copy_file("server/server.js", "server/server.js", package_root)
        copy_web(package_root)
        copy_seed_assets(seed_zip, package_root)

        output_zip.parent.mkdir(parents=True, exist_ok=True)
        write_zip(package_root, output_zip, root_name)

    count = verify_zip(output_zip, root_name)
    print(f"Created {output_zip} ({output_zip.stat().st_size} bytes, {count} files)")
    return output_zip


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="release tag/version, e.g. 1.1.2")
    parser.add_argument("--seed-zip", required=True, type=Path, help="previous release ZIP supplying ignored generated assets")
    parser.add_argument("--output-dir", type=Path, default=REPO / "dist")
    args = parser.parse_args()
    build(args.version, args.seed_zip.resolve(), args.output_dir)


if __name__ == "__main__":
    main()
