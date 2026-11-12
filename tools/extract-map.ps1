# Extract the 3D map from the user's Cyberpunk 2077 installation.
# Output: web/map3d/world.glb, buildings.bin, roads.bin and manifest.json.
# Requires WolvenKit CLI and the Open2077 op77_map3d exporter (MIT).
# Usage: powershell -ExecutionPolicy Bypass -File tools\extract-map.ps1 [-Game "<game folder>"]
param(
  [string]$Game = "C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077"
)
$ErrorActionPreference = "Stop"
$tools = $PSScriptRoot
$wk = Join-Path $tools "wolvenkit\WolvenKit.CLI.exe"
$root = Join-Path $tools "open77_3dmap"
$content = Join-Path $Game "archive\pc\content"
$ep1 = Join-Path $Game "archive\pc\ep1"
$out = Join-Path $tools "..\web\map3d"
function Step($message) { Write-Host ""; Write-Host "== $message" -ForegroundColor Cyan }

Set-Location $root
Step "1/6 Extracting 3D map meshes"
& $wk uncook "$content\basegame_1_engine.archive" "$content\basegame_4_gamedata.archive" -r "(?i)3dmap" -o cooked -or raw
if ($LASTEXITCODE) { throw "3D map extraction failed" }
Step "2/6 Extracting building point clouds"
& $wk uncook "$content\basegame_1_engine.archive" "$content\basegame_4_gamedata.archive" -r "(?i)3dmap.*_data" --uext dds -o cooked-dds -or raw-dds
if ($LASTEXITCODE) { throw "DDS extraction failed" }
Step "3/6 Extracting the traffic network"
& $wk unbundle "$ep1\ep1_1_nightcity.archive" -r "(?i)_generated.traffic.all\.(lane_polygons|traffic_persistent|lane_connections)" -o traffic-ep1
if ($LASTEXITCODE) { throw "Traffic extraction failed" }
Step "4/6 Converting assets to JSON"
New-Item -ItemType Directory -Force json, json-traffic | Out-Null
$ent = Get-ChildItem cooked -Recurse -Filter "3dmap_view.ent" | Select-Object -First 1
$soup = Get-ChildItem cooked -Recurse -Filter "3dmap_triangle_soup.mesh" | Select-Object -First 1
if (-not $ent -or -not $soup) { throw "Required 3D map mesh files were not found" }
& $wk convert serialize $ent.FullName -o json
& $wk convert serialize $soup.FullName -o json
foreach ($file in Get-ChildItem traffic-ep1 -Recurse -File) {
  & $wk convert serialize $file.FullName -o json-traffic
}
Step "5/6 Exporting the web map"
python -m pip install --quiet numpy trimesh networkx
if ($LASTEXITCODE) { throw "Python dependency installation failed" }
python tools\export_web.py out
if ($LASTEXITCODE) { throw "Web map export failed" }
Step "6/6 Optimizing the GLB"
Push-Location out
npx --yes @gltf-transform/cli weld world.raw.glb w.glb
npx --yes @gltf-transform/cli quantize w.glb world.glb
Pop-Location
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item out\world.glb, out\buildings.bin, out\roads.bin, out\manifest.json $out -Force
Write-Host "Map generated in $((Resolve-Path $out).Path)" -ForegroundColor Green
