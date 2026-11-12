#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-python3}"

show_bootstrap_message() {
  local message="$1"
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --title "Neuroport Installer" --yesno "$message" --yes-label "Install Tkinter" --no-label "Cancel"
  elif command -v zenity >/dev/null 2>&1; then
    zenity --question --title="Neuroport Installer" --text="$message"
  else
    return 2
  fi
}

install_tkinter() {
  command -v pkexec >/dev/null 2>&1 || return 1
  if command -v dnf >/dev/null 2>&1; then
    pkexec dnf install -y python3-tkinter
  elif command -v apt-get >/dev/null 2>&1; then
    pkexec apt-get update
    pkexec apt-get install -y python3-tk
  elif command -v pacman >/dev/null 2>&1; then
    pkexec pacman -Sy --needed --noconfirm tk
  elif command -v zypper >/dev/null 2>&1; then
    pkexec zypper --non-interactive install python3-tk
  else
    return 1
  fi
}

if ! "$PYTHON" -c 'import tkinter' >/dev/null 2>&1; then
  MESSAGE="Python Tkinter is required to open the Neuroport graphical installer. Would you like to install it now using your system package manager?"
  if show_bootstrap_message "$MESSAGE"; then
    if ! install_tkinter; then
      echo "Could not install Tkinter automatically. Install the Tkinter package for Python 3, then run this script again." >&2
      exit 1
    fi
  else
    echo "Tkinter is missing. Install python3-tkinter (Fedora/Nobara), python3-tk (Debian/Ubuntu), or tk (Arch), then run ./install-linux.sh again." >&2
    exit 1
  fi
fi

exec "$PYTHON" "$SCRIPT_DIR/linux/installer_gui.py" "$@"
