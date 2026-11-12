# Copy the Neuroport CET mod into the Cyber Engine Tweaks mods folder.
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 [-Game "D:\...\Cyberpunk 2077"]
param(
  [string]$Game = "C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077"
)
$cet = Join-Path $Game "bin\x64\plugins\cyber_engine_tweaks"
if (-not (Test-Path $cet)) {
  Write-Host ""
  Write-Host "Cyber Engine Tweaks was not found at:" -ForegroundColor Red
  Write-Host $cet
  Write-Host "Install CET first (see README.md), then run this script again."
  exit 1
}
$src = Join-Path $PSScriptRoot "mod\neuroport"
$dst = Join-Path $cet "mods\neuroport"
$old = Join-Path $cet "mods\holophone"
if (Test-Path $old) {
  Remove-Item $old -Recurse -Force
  Write-Host "Removed the old holophone mod folder."
}
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item (Join-Path $src "init.lua") $dst -Force
Write-Host ""
Write-Host "Neuroport installed in: $dst" -ForegroundColor Cyan
Write-Host "Start the server with start.bat, then launch the game."
