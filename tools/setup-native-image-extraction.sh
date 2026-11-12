#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$HERE/tools/native_oodle/setup_native_image_extraction.py" "$@"
