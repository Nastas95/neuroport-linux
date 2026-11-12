#!/usr/bin/env python3
"""Desktop control panel for the Neuroport Linux server."""
from __future__ import annotations

import argparse
import json
import subprocess
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import messagebox
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PORT = 7077
BG = "#101318"
PANEL = "#191f27"
FG = "#e8edf2"
MUTED = "#9ba8b5"
ACCENT = "#e8a52b"
GREEN = "#5ac78a"
RED = "#e16b68"


class NeuroportControl:
    def __init__(self, root: tk.Tk, companion: Path):
        self.root = root
        self.companion = companion.resolve()
        self.start_script = self.companion / "start-neuroport.sh"
        self.stop_script = self.companion / "stop-neuroport.sh"
        self.server_url = f"http://127.0.0.1:{PORT}/admin/api/status"
        self.qr_js = self.companion / "web/vendor/qrcode.min.js"
        self.qr_helper = self.companion / "neuroport-qr-matrix.js"
        self.last_qr_url: str | None = None
        self.busy = False
        self.server_info: dict | None = None

        root.title("Neuroport — Control Panel")
        root.configure(bg=BG)
        root.geometry("540x720")
        root.minsize(500, 800)

        outer = tk.Frame(root, bg=BG, padx=28, pady=22)
        outer.pack(fill="both", expand=True)

        tk.Label(outer, text="N E U R O P O R T", bg=BG, fg=ACCENT,
                 font=("Rajdhani", 23, "bold")).pack(pady=(0, 3))
        tk.Label(outer, text="CYBERPUNK 2077 COMPANION", bg=BG, fg=MUTED,
                 font=("TkDefaultFont", 9, "bold")).pack(pady=(0, 18))

        self.status = tk.Label(outer, text="● SERVER OFFLINE", bg=PANEL, fg=RED,
                               font=("TkDefaultFont", 10, "bold"), padx=12, pady=9)
        self.status.pack(fill="x", pady=(0, 16))

        self.start_btn = self._button(outer, "START SERVER", self.start_server)
        self.start_btn.pack(fill="x", pady=5, ipady=8)
        self.stop_btn = self._button(outer, "STOP SERVER", self.stop_server, danger=True)
        self.stop_btn.pack(fill="x", pady=5, ipady=8)
        self.open_btn = self._button(outer, "OPEN NEUROPORT ON THIS PC", self.open_local)
        self.open_btn.pack(fill="x", pady=5, ipady=8)

        qr_panel = tk.Frame(outer, bg=PANEL, padx=16, pady=15,
                            highlightthickness=1, highlightbackground="#303945")
        qr_panel.pack(fill="both", expand=True, pady=(20, 0))
        tk.Label(qr_panel, text="CONNECT YOUR PHONE", bg=PANEL, fg=FG,
                 font=("TkDefaultFont", 11, "bold")).pack(pady=(0, 10))
        self.qr_canvas = tk.Canvas(qr_panel, width=280, height=280, bg="#ffffff",
                                   highlightthickness=0, bd=0)
        self.qr_canvas.pack(pady=4)
        self.qr_canvas.create_text(140, 140, text="START THE SERVER\nTO DISPLAY THE QR CODE",
                                   fill="#59636e", font=("TkDefaultFont", 11, "bold"),
                                   justify="center")
        self.address = tk.Label(qr_panel, text="", bg=PANEL, fg=MUTED,
                                font=("TkFixedFont", 9), wraplength=440, justify="center")
        self.address.pack(pady=(10, 1))
        tk.Label(
            qr_panel,
            text="Scan the QR code with your phone camera.\nYour phone and PC must be on the same Wi-Fi network.",
            bg=PANEL, fg=MUTED, font=("TkDefaultFont", 9), justify="center",
        ).pack(pady=(7, 0))

        self.note = tk.Label(outer, text="", bg=BG, fg=MUTED,
                             font=("TkDefaultFont", 9), wraplength=475, justify="center")
        self.note.pack(fill="x", pady=(12, 0))
        self._poll()

    def _button(self, parent, text, command, danger: bool = False):
        color = "#7d2e31" if danger else "#273543"
        active = "#a63a3d" if danger else "#35495d"
        return tk.Button(
            parent, text=text, command=command, bg=color, fg=FG,
            activebackground=active, activeforeground=FG,
            disabledforeground="#87919b", relief="flat", bd=0,
            cursor="hand2", font=("TkDefaultFont", 11, "bold"),
            padx=12, pady=8,
        )

    def _set_note(self, text: str, color: str = MUTED) -> None:
        self.note.configure(text=text, fg=color)

    def _run_script(self, script: Path, success_text: str) -> None:
        if self.busy:
            return
        if not script.is_file():
            messagebox.showerror("Neuroport", f"Script not found:\n{script}")
            return
        self.busy = True
        for button in (self.start_btn, self.stop_btn, self.open_btn):
            button.configure(state="disabled")
        self._set_note("Working…")

        def worker() -> None:
            try:
                result = subprocess.run(
                    [str(script)], cwd=str(self.companion), capture_output=True,
                    text=True, timeout=20, check=False,
                )
                output = (result.stdout + "\n" + result.stderr).strip()
                if result.returncode == 0:
                    message, success = success_text, True
                else:
                    message = output[-1200:] or f"The script exited with code {result.returncode}."
                    success = False
            except (OSError, subprocess.TimeoutExpired) as exc:
                message, success = str(exc), False
            self.root.after(0, lambda: self._script_done(message, success))

        threading.Thread(target=worker, daemon=True).start()

    def _script_done(self, message: str, success: bool) -> None:
        self.busy = False
        for button in (self.start_btn, self.stop_btn, self.open_btn):
            button.configure(state="normal")
        self._set_note(message, GREEN if success else RED)
        self._poll()

    def start_server(self) -> None:
        self._run_script(self.start_script, "Neuroport started.")

    def stop_server(self) -> None:
        self._run_script(self.stop_script, "Neuroport stopped.")

    def open_local(self) -> None:
        info = self._get_status()
        if not info:
            messagebox.showwarning("Neuroport", "The server is not running. Start it first.")
            return
        token = str(info.get("token", "")).strip()
        if not token:
            messagebox.showerror("Neuroport", "The server did not provide a pairing code.")
            return
        url = f"http://localhost:{int(info.get('port') or PORT)}/?k={token}"
        webbrowser.open(url)
        self._set_note("Neuroport opened in your PC browser.", GREEN)

    def _get_status(self) -> dict | None:
        try:
            request = Request(self.server_url, headers={"Cache-Control": "no-cache"})
            with urlopen(request, timeout=1.2) as response:
                data = json.loads(response.read().decode("utf-8"))
            self.server_info = data
            return data
        except (URLError, HTTPError, TimeoutError, OSError, ValueError):
            self.server_info = None
            return None

    def _show_placeholder(self, text: str) -> None:
        self.qr_canvas.delete("all")
        self.qr_canvas.configure(bg="#ffffff")
        self.qr_canvas.create_text(140, 140, text=text, fill="#59636e",
                                   font=("TkDefaultFont", 11, "bold"), justify="center")
        self.address.configure(text="")
        self.last_qr_url = None

    def _render_qr(self, url: str) -> None:
        if not self.qr_js.is_file() or not self.qr_helper.is_file():
            self._show_placeholder("QR LIBRARY\nNOT FOUND")
            return
        try:
            result = subprocess.run(
                ["node", str(self.qr_helper), str(self.qr_js), url],
                check=True, capture_output=True, text=True, timeout=5,
            )
            rows = json.loads(result.stdout)
            if not rows:
                raise ValueError("QR matrix is empty")
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            self._show_placeholder("COULD NOT\nGENERATE QR CODE")
            self._set_note(f"QR error: {exc}", RED)
            return

        self.qr_canvas.delete("all")
        self.qr_canvas.configure(bg="#ffffff")
        size, quiet = 280, 4
        count = len(rows)
        module = size / (count + quiet * 2)
        for y, row in enumerate(rows):
            for x, bit in enumerate(row):
                if bit == "1":
                    x0 = int((x + quiet) * module)
                    y0 = int((y + quiet) * module)
                    x1 = int((x + quiet + 1) * module + 0.5)
                    y1 = int((y + quiet + 1) * module + 0.5)
                    self.qr_canvas.create_rectangle(x0, y0, x1, y1, fill="#101010", outline="")
        self.address.configure(text=url)
        self.last_qr_url = url

    def _poll(self) -> None:
        info = self._get_status()
        if info:
            self.status.configure(text="● SERVER ONLINE", fg=GREEN)
            ips = info.get("ips") or []
            token = str(info.get("token") or "").strip()
            port = int(info.get("port") or PORT)
            if ips and token:
                url = f"http://{ips[0]}:{port}/?k={token}"
                if url != self.last_qr_url:
                    self._render_qr(url)
            else:
                self._show_placeholder("NO NETWORK\nADDRESS AVAILABLE")
        else:
            self.status.configure(text="● SERVER OFFLINE", fg=RED)
            if self.last_qr_url is not None or not self.address.cget("text"):
                self._show_placeholder("START THE SERVER\nTO DISPLAY THE QR CODE")
        self.root.after(2000, self._poll)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--companion", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    root = tk.Tk()
    NeuroportControl(root, args.companion)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
