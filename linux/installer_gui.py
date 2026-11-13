#!/usr/bin/env python3
"""Graphical Linux installer for Neuroport."""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import install as install_backend

ROOT = Path(__file__).resolve().parents[1]
INSTALL_SCRIPT = Path(__file__).with_name("install.py")
MOD_REL = install_backend.MOD_REL

BG = "#11161d"
PANEL = "#1a222c"
FG = "#edf2f7"
MUTED = "#aab6c2"
ACCENT = "#e8a52b"
GREEN = "#69c991"
RED = "#e47a75"


class NeuroportInstaller:
    def __init__(self, root: tk.Tk, requested_game: str | None = None):
        self.root = root
        self.busy = False
        self.closed = False
        self.package_manager = self._find_package_manager()
        self.distro = self._read_distro()
        self.root.title("Neuroport — Linux Installer")
        self.root.configure(bg=BG)
        self.root.geometry("780x720")
        self.root.minsize(720, 650)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background=BG)
        style.configure("Panel.TFrame", background=PANEL)
        style.configure("TLabel", background=BG, foreground=FG)
        style.configure("Muted.TLabel", background=BG, foreground=MUTED)
        style.configure("Title.TLabel", background=BG, foreground=ACCENT,
                        font=("TkDefaultFont", 18, "bold"))
        style.configure("Treeview", background=PANEL, foreground=FG,
                        fieldbackground=PANEL, rowheight=27, borderwidth=0)
        style.configure("Treeview.Heading", background="#273543", foreground=FG)
        style.map("Treeview", background=[("selected", "#35495d")])
        style.configure("Accent.TButton", padding=(12, 8), font=("TkDefaultFont", 10, "bold"))

        outer = ttk.Frame(root, padding=20)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="NEUROPORT", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            outer,
            text="Linux setup assistant for Cyberpunk 2077 (Steam / Proton)",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(2, 14))

        game_frame = ttk.Frame(outer, style="Panel.TFrame", padding=12)
        game_frame.pack(fill="x", pady=(0, 12))
        ttk.Label(game_frame, text="Cyberpunk 2077 installation folder").pack(anchor="w")
        game_row = ttk.Frame(game_frame, style="Panel.TFrame")
        game_row.pack(fill="x", pady=(7, 0))
        self.game_var = tk.StringVar(value=requested_game or "")
        self.game_var.trace_add("write", lambda *_: self._refresh_install_action())
        self.game_entry = ttk.Entry(game_row, textvariable=self.game_var)
        self.game_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(game_row, text="Browse…", command=self.browse_game).pack(side="left", padx=(8, 0))
        ttk.Button(game_row, text="Detect Steam", command=self.detect_games).pack(side="left", padx=(8, 0))
        self.detected_games = install_backend.discover_games(Path.home())
        if not requested_game and self.detected_games:
            self.game_var.set(str(self.detected_games[0]))

        dep_frame = ttk.Frame(outer, style="Panel.TFrame", padding=12)
        dep_frame.pack(fill="x", pady=(0, 12))
        ttk.Label(dep_frame, text="System requirements", font=("TkDefaultFont", 11, "bold")).pack(anchor="w")
        self.dep_tree = ttk.Treeview(dep_frame, columns=("status", "purpose"), show="headings", height=5)
        self.dep_tree.heading("status", text="Component")
        self.dep_tree.heading("purpose", text="Detected status")
        self.dep_tree.column("status", width=190, stretch=False)
        self.dep_tree.column("purpose", width=490, stretch=True)
        self.dep_tree.pack(fill="x", pady=(8, 6))
        dep_actions = ttk.Frame(dep_frame, style="Panel.TFrame")
        dep_actions.pack(fill="x")
        self.check_btn = ttk.Button(dep_actions, text="Refresh checks", command=self.refresh_dependencies)
        self.check_btn.pack(side="left")
        self.deps_btn = ttk.Button(dep_actions, text="Install missing dependencies", command=self.install_dependencies)
        self.deps_btn.pack(side="left", padx=(8, 0))
        self.distro_label = ttk.Label(dep_actions, text=f"Detected: {self.distro}", style="Muted.TLabel")
        self.distro_label.pack(side="right")

        options = ttk.Frame(outer, style="Panel.TFrame", padding=12)
        options.pack(fill="x", pady=(0, 12))
        self.native_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            options,
            text="Set up native image extraction (Rust decoder + Linux Pillow)",
            variable=self.native_var,
        ).pack(anchor="w")
        ttk.Label(
            options,
            text="Recommended for contact portraits, vehicle photos and game images. Requires Cargo and an Internet connection for the first build.",
            style="Muted.TLabel", wraplength=700,
        ).pack(anchor="w", padx=(25, 0), pady=(3, 0))

        action_row = ttk.Frame(outer)
        action_row.pack(fill="x", pady=(0, 10))
        self.install_btn = ttk.Button(action_row, text="Install Neuroport", style="Accent.TButton", command=self.install_neuroport)
        self.install_btn.pack(side="right")

        log_frame = ttk.Frame(outer, style="Panel.TFrame", padding=10)
        log_frame.pack(fill="both", expand=True)
        ttk.Label(log_frame, text="Installation log", font=("TkDefaultFont", 10, "bold")).pack(anchor="w")
        self.log_text = tk.Text(log_frame, height=10, wrap="word", bg="#0c1015", fg=FG,
                                insertbackground=FG, relief="flat", borderwidth=0,
                                font=("TkFixedFont", 9), state="disabled")
        self.log_text.pack(fill="both", expand=True, pady=(7, 0))

        self.refresh_dependencies()
        self._refresh_install_action()
        self.log(f"System: {platform.platform()}")
        if not self.detected_games:
            self.log("No Steam installation was detected automatically. Browse to your Cyberpunk 2077 folder.")
        self.log("CET, RED4ext and Codeware must be installed in the game separately.")

    def _read_distro(self) -> str:
        try:
            values = {}
            for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
                if "=" in line:
                    key, value = line.split("=", 1)
                    values[key] = value.strip().strip('"')
            return values.get("PRETTY_NAME", values.get("ID", platform.system()))
        except OSError:
            return platform.system()

    @staticmethod
    def _find_package_manager() -> str | None:
        for name in ("dnf", "apt-get", "pacman", "zypper"):
            if shutil.which(name):
                return name
        return None

    def log(self, message: str) -> None:
        if self.closed:
            return
        def append() -> None:
            if self.closed:
                return
            self.log_text.configure(state="normal")
            self.log_text.insert("end", message.rstrip() + "\n")
            self.log_text.see("end")
            self.log_text.configure(state="disabled")
        self.root.after(0, append)

    def _refresh_install_action(self) -> None:
        game = Path(self.game_var.get()).expanduser()
        dest = game / MOD_REL
        if hasattr(self, "install_btn"):
            self.install_btn.configure(text="Update Neuroport" if dest.is_dir() else "Install Neuroport")

    def browse_game(self) -> None:
        selected = filedialog.askdirectory(title="Select the Cyberpunk 2077 folder")
        if selected:
            self.game_var.set(selected)

    def detect_games(self) -> None:
        self.detected_games = install_backend.discover_games(Path.home())
        if not self.detected_games:
            messagebox.showinfo("Neuroport", "No Cyberpunk 2077 installation was found in the standard Steam libraries.")
            return
        if len(self.detected_games) == 1:
            self.game_var.set(str(self.detected_games[0]))
        else:
            choices = "\n".join(str(path) for path in self.detected_games)
            messagebox.showinfo("Detected installations", f"Choose the correct folder in the path field:\n\n{choices}")
            with_cet = [path for path in self.detected_games if (path / "bin/x64/plugins/cyber_engine_tweaks").is_dir()]
            self.game_var.set(str(with_cet[0] if len(with_cet) == 1 else self.detected_games[0]))

    def _dependency_status(self) -> list[tuple[str, str, bool, bool]]:
        rows: list[tuple[str, str, bool, bool]] = []
        node = shutil.which("node")
        node_ok = False
        node_version = "not found"
        if node:
            try:
                node_version = subprocess.check_output([node, "--version"], text=True, stderr=subprocess.STDOUT).strip()
                numbers = tuple(int(part) for part in node_version.lstrip("v").split(".")[:2])
                node_ok = bool(numbers and numbers[0] >= 18)
            except (OSError, subprocess.SubprocessError, ValueError):
                node_version = "unknown version"
        rows.append(("Node.js 18+", node_version if node_ok else f"Missing / outdated ({node_version})", node_ok, True))

        py_ok = sys.version_info >= (3, 10)
        rows.append(("Python 3.10+", platform.python_version() if py_ok else f"Too old ({platform.python_version()})", py_ok, True))
        try:
            import tkinter  # noqa: F401
            tk_ok = True
        except ImportError:
            tk_ok = False
        rows.append(("Python Tkinter", "Available" if tk_ok else "Missing", tk_ok, True))

        xdotool_ok = shutil.which("xdotool") is not None
        rows.append(("xdotool", "Installed" if xdotool_ok else "Not installed (Photo Mode may not work)", xdotool_ok, False))
        cargo = shutil.which("cargo") or (Path.home() / ".cargo/bin/cargo")
        cargo_ok = Path(cargo).is_file() if cargo else False
        rows.append(("Rust / Cargo", str(cargo) if cargo_ok else "Not installed (native image extraction unavailable)", cargo_ok, False))
        return rows

    def refresh_dependencies(self) -> None:
        for item in self.dep_tree.get_children():
            self.dep_tree.delete(item)
        self.status_rows = self._dependency_status()
        for name, status, ok, required in self.status_rows:
            self.dep_tree.insert("", "end", values=(name, status))
        required_ok = all(row[2] for row in self.status_rows if row[3])
        self.install_btn.configure(state="normal" if required_ok else "disabled")
        if not self.package_manager:
            self.deps_btn.configure(state="disabled")

    def _package_commands(self) -> list[list[str]]:
        manager = self.package_manager
        if not manager:
            return []
        if manager == "dnf":
            packages = ["nodejs", "python3-tkinter", "python3-pip", "cargo", "xdotool"]
            return [["pkexec", "dnf", "install", "-y", *packages]]
        if manager == "apt-get":
            packages = ["nodejs", "python3-tk", "python3-venv", "python3-pip", "cargo", "xdotool", "build-essential"]
            return [["pkexec", "apt-get", "update"], ["pkexec", "apt-get", "install", "-y", *packages]]
        if manager == "pacman":
            packages = ["nodejs", "python", "tk", "python-pip", "rust", "xdotool", "base-devel"]
            return [["pkexec", "pacman", "-Sy", "--needed", "--noconfirm", *packages]]
        packages = ["nodejs", "python3-tk", "python3-pip", "cargo", "xdotool", "gcc"]
        return [["pkexec", "zypper", "--non-interactive", "install", *packages]]

    def install_dependencies(self) -> None:
        if self.busy:
            return
        if not shutil.which("pkexec"):
            messagebox.showwarning(
                "PolicyKit unavailable",
                "pkexec was not found. Install the listed packages with your distribution's graphical package manager, then click Refresh checks.\n\n"
                "Fedora / Nobara: nodejs python3-tkinter python3-pip cargo xdotool\n"
                "Debian / Ubuntu: nodejs python3-tk python3-venv python3-pip cargo xdotool build-essential",
            )
            return
        commands = self._package_commands()
        if not commands:
            messagebox.showerror("Neuroport", "No supported package manager was detected.")
            return
        self.busy = True
        self.deps_btn.configure(state="disabled")
        self.install_btn.configure(state="disabled")
        self.log("Installing system dependencies. A PolicyKit authentication prompt may appear.")

        def worker() -> None:
            success = True
            for command in commands:
                self.log("$ " + " ".join(command))
                try:
                    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                               text=True, bufsize=1)
                    assert process.stdout is not None
                    for line in process.stdout:
                        self.log(line.rstrip())
                    code = process.wait()
                    if code != 0:
                        self.log(f"Package manager exited with code {code}.")
                        success = False
                        break
                except OSError as exc:
                    self.log(f"Could not start the package manager: {exc}")
                    success = False
                    break
            self.root.after(0, lambda: self._dependencies_finished(success))

        threading.Thread(target=worker, daemon=True).start()

    def _dependencies_finished(self, success: bool) -> None:
        self.busy = False
        self.refresh_dependencies()
        self.deps_btn.configure(state="normal" if self.package_manager else "disabled")
        self.log("Dependency installation completed." if success else "Dependency installation did not complete.")
        if success:
            messagebox.showinfo("Neuroport", "Dependency installation finished. Review the checks before continuing.")

    def install_neuroport(self) -> None:
        if self.busy:
            return
        game = Path(self.game_var.get()).expanduser()
        if not game.is_dir():
            messagebox.showerror("Neuroport", "Select a valid Cyberpunk 2077 installation folder first.")
            return
        cet = game / "bin/x64/plugins/cyber_engine_tweaks"
        if not cet.is_dir():
            messagebox.showerror(
                "Cyber Engine Tweaks not found",
                f"CET was not found here:\n{cet}\n\nInstall Cyber Engine Tweaks before installing Neuroport.",
            )
            return
        missing = [row[0] for row in self.status_rows if row[3] and not row[2]]
        if missing:
            messagebox.showerror("Missing requirements", "Install the required components first:\n\n" + "\n".join(missing))
            return
        if self.native_var.get() and not any(row[0] == "Rust / Cargo" and row[2] for row in self.status_rows):
            if not messagebox.askyesno(
                "Cargo not found",
                "Cargo is required for native image extraction. Continue installing Neuroport without this optional feature?",
            ):
                return
            setup_native = False
        else:
            setup_native = self.native_var.get()

        self.busy = True
        self.install_btn.configure(state="disabled")
        self.deps_btn.configure(state="disabled")
        updating = (game / MOD_REL).is_dir()
        self.log(f"{'Updating' if updating else 'Installing'} Neuroport in: {game}")

        def worker() -> None:
            command = [sys.executable, str(INSTALL_SCRIPT), "--game", str(game), "--skip-native-setup"]
            self.log("$ " + " ".join(command))
            code = self._stream_process(command, cwd=ROOT)
            native_code = 0
            if code == 0 and setup_native:
                setup_script = game / MOD_REL / "companion/setup-native-image-extraction.sh"
                self.log("Starting the native image extraction setup. The first run downloads and builds the Rust decoder.")
                native_code = self._stream_process([str(setup_script)], cwd=setup_script.parent, timeout=1200)
            self.root.after(0, lambda: self._installation_finished(code, native_code, setup_native, updating))

        threading.Thread(target=worker, daemon=True).start()

    def _stream_process(self, command: list[str], *, cwd: Path, timeout: int | None = None) -> int:
        try:
            process = subprocess.Popen(command, cwd=str(cwd), stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, bufsize=1)
            assert process.stdout is not None

            def read_output() -> None:
                for line in process.stdout:
                    self.log(line.rstrip())

            reader = threading.Thread(target=read_output, daemon=True)
            reader.start()
            try:
                result = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                reader.join(timeout=2)
                self.log("The process timed out. You can retry the image extraction setup later.")
                return 124
            reader.join(timeout=2)
            return result
        except OSError as exc:
            self.log(f"Could not start command: {exc}")
            return 127

    def _installation_finished(self, code: int, native_code: int, native_requested: bool, updating: bool) -> None:
        self.busy = False
        self.refresh_dependencies()
        self.deps_btn.configure(state="normal" if self.package_manager else "disabled")
        if code == 0:
            action = "updated" if updating else "installed"
            message = f"Neuroport was {action}. Open it from your desktop application menu."
            if native_requested and native_code != 0:
                message += "\n\nNative image extraction did not finish; you can retry it later from the installed companion folder."
            self.log(message)
            messagebox.showinfo(f"Neuroport {action}", message)
        else:
            self.log(f"Installation failed with exit code {code}. See the log above.")
            messagebox.showerror("Installation failed", f"The installer exited with code {code}. See the log above.")

    def close(self) -> None:
        self.closed = True
        self.root.destroy()


def main() -> int:
    requested_game = None
    if "--game" in sys.argv:
        index = sys.argv.index("--game")
        if index + 1 < len(sys.argv):
            requested_game = sys.argv[index + 1]
    root = tk.Tk()
    NeuroportInstaller(root, requested_game)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
