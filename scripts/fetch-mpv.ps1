# Downloads a self-contained Windows mpv.exe and places it at
# src-tauri/resources/mpv/mpv.exe so Tauri bundles it into the installer.
# Idempotent: skips when mpv.exe is already present, or when FRIGATEDESK_MPV
# points to an existing executable.

$ErrorActionPreference = "Stop"

$dest = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\src-tauri\resources\mpv\mpv.exe"))

if (Test-Path $dest) {
  Write-Host "mpv already present at $dest - skipping download."
  exit 0
}
if ($env:FRIGATEDESK_MPV -and (Test-Path $env:FRIGATEDESK_MPV)) {
  Write-Host "FRIGATEDESK_MPV is set ($env:FRIGATEDESK_MPV) - skipping bundled download."
  exit 0
}

New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null

$headers = @{ "User-Agent" = "frigatedesk-build" }

Write-Host "Resolving latest mpv Windows build..."
$release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest"
# Pick the generic x86_64 build (date-prefixed), not the -v3- (modern-CPU) variant.
$asset = $release.assets | Where-Object { $_.name -like "mpv-x86_64-2*.7z" } | Select-Object -First 1
if (-not $asset) { throw "Could not find a generic mpv-x86_64 .7z asset in the latest release." }

$archive = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $archive

# Locate 7-Zip (required to extract the .7z archive).
$sevenZip = (Get-Command 7z -ErrorAction SilentlyContinue).Source
if (-not $sevenZip) {
  foreach ($c in @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe")) {
    if (Test-Path $c) { $sevenZip = $c; break }
  }
}
if (-not $sevenZip) {
  throw "7-Zip not found. Install it (winget install 7zip.7zip) or set FRIGATEDESK_MPV to an existing mpv.exe."
}

$extractDir = Join-Path $env:TEMP "frigatedesk-mpv-extract"
Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue | Out-Null
& $sevenZip x $archive "-o$extractDir" -y mpv.exe | Out-Null

$exe = Join-Path $extractDir "mpv.exe"
if (-not (Test-Path $exe)) { throw "mpv.exe was not found inside $($asset.name)." }

Copy-Item $exe $dest -Force
Write-Host "mpv.exe ready at $dest"
