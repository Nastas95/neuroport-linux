# Build the Nexus Mods release package in dist\Neuroport-<version>.zip.
# The package is laid out for Vortex/MO2 or direct extraction into the game folder.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$lua = Get-Content (Join-Path $root 'mod\neuroport\init.lua') -Raw
if ($lua -notmatch 'local VERSION = "([^"]+)"') { throw 'VERSION was not found in init.lua' }
$version = $Matches[1]

$dist = Join-Path $root 'dist'
$stage = Join-Path $dist "stage-$version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$mod = Join-Path $stage 'bin\x64\plugins\cyber_engine_tweaks\mods\neuroport'
$comp = Join-Path $mod 'companion'
New-Item -ItemType Directory -Force $comp | Out-Null
Copy-Item (Join-Path $root 'mod\neuroport\init.lua') $mod

New-Item -ItemType Directory -Force (Join-Path $comp 'server') | Out-Null
foreach ($file in 'server.js', 'mock.js', 'presskey.ps1') {
  Copy-Item (Join-Path $root "server\$file") (Join-Path $comp 'server')
}

robocopy (Join-Path $root 'web') (Join-Path $comp 'web') /E /XD avatars /NFL /NDL /NJH /NJS /NP | Out-Null
New-Item -ItemType Directory -Force (Join-Path $comp 'web\avatars') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $comp 'tools\gamefiles') | Out-Null
Get-ChildItem (Join-Path $root 'tools\gamefiles') -File |
  Where-Object { $_.Extension -in '.py', '.json' } |
  ForEach-Object { Copy-Item $_.FullName (Join-Path $comp 'tools\gamefiles') }

@"
@echo off
title Neuroport Server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Install the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
node server\server.js --gui %*
pause
"@ | Set-Content -Encoding ASCII (Join-Path $comp 'Start Neuroport.bat')
Copy-Item (Join-Path $root 'release\README.txt') $comp
Copy-Item (Join-Path $root 'release\CREDITS.txt') $comp
New-Item -ItemType Directory -Force (Join-Path $comp 'LICENSES') | Out-Null
Copy-Item (Join-Path $root 'release\LICENSES\open2077-map3d-LICENSE.txt') (Join-Path $comp 'LICENSES\open2077-map3d-LICENSE.txt')
Copy-Item (Join-Path $root 'release\LICENSES\open2077-map3d-NOTICE.txt') (Join-Path $comp 'LICENSES\open2077-map3d-NOTICE.txt')

New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "Neuroport-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage 'bin') -DestinationPath $zip
Remove-Item $stage -Recurse -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Package: $zip ($mb MB)"
