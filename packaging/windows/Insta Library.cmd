@echo off
setlocal
set "APP_DIR=%~dp0"
set "RESOURCES=%APP_DIR%Resources"
set "PYTHONHOME=%RESOURCES%\runtime\python"
set "PYTHONPATH=%RESOURCES%\app\python-packages"
set "PYTHONDONTWRITEBYTECODE=1"
set "PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python"

if not exist "%RESOURCES%\runtime\python\pythonw.exe" (
  echo Insta Library is incomplete: bundled Python was not found.
  pause
  exit /b 1
)

start "Insta Library" /D "%RESOURCES%\app" "%RESOURCES%\runtime\python\pythonw.exe" "%RESOURCES%\app\tools\run_bundled_app.py"
endlocal
