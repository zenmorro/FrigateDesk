@echo off
REM Build the FrigateDesk installer (MSI + NSIS).
REM Ensures Rust (cargo) is on PATH. Just run `build.cmd`.
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cd /d "%~dp0"
npm run tauri build %*
