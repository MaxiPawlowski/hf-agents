: << 'CMDBLOCK'
@echo off
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SCRIPT_NAME=%~1"
set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH_EXE%" set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%BASH_EXE%" for %%I in (bash.exe) do set "BASH_EXE=%%~$PATH:I"
if "%SCRIPT_NAME%"=="" (
  echo usage: %~nx0 ^<script-name^> [args...]
  exit /b 2
)
if not exist "%BASH_EXE%" (
  echo bash not found. Install Git Bash or add bash to PATH.
  exit /b 2
)
"%BASH_EXE%" -l -c "cd \"$(cygpath -u \"%SCRIPT_DIR%\")\" && ./run-hook.sh \"%SCRIPT_NAME%\""
exit /b
CMDBLOCK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SCRIPT_NAME="${1:-}"
if [ -z "$SCRIPT_NAME" ]; then
  printf 'usage: %s <script-name> [args...]\n' "$0" >&2
  exit 2
fi
shift || true
"${SCRIPT_DIR}/run-hook.sh" "$SCRIPT_NAME" "$@"
