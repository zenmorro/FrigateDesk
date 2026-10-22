@echo off
REM Launch FrigateDesk in development mode.
REM Ensures Rust (cargo) is on PATH even if the terminal was opened before
REM rustup was installed. Just run `dev.cmd` (or double-click it).
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cd /d "%~dp0"
npm run tauri dev %*
