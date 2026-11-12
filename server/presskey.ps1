# Sends a key to the Cyberpunk 2077 window using the scan code read by the game.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File presskey.ps1 -Scan 0x31 (0x31 = N, photo mode).
param([int]$Scan = 0x31, [int]$HoldMs = 70)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NpKeys {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static void Key(ushort scan, bool up) {
    INPUT[] i = new INPUT[1];
    i[0].type = 1;
    i[0].u.ki.wScan = scan;
    i[0].u.ki.dwFlags = 0x0008u | (up ? 0x0002u : 0u);   // KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@

$p = Get-Process -Name 'Cyberpunk2077' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'no_game'; exit 2 }
if ([NpKeys]::GetForegroundWindow() -ne $p.MainWindowHandle) {
  [NpKeys]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 250
}
[NpKeys]::Key([uint16]$Scan, $false)
Start-Sleep -Milliseconds $HoldMs
[NpKeys]::Key([uint16]$Scan, $true)
Write-Output 'ok'
