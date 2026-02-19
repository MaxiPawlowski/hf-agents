param(
  [Parameter(Mandatory = $true)]
  [string]$ScriptName
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bashPath = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $bashPath)) {
  $bashCommand = Get-Command bash -ErrorAction SilentlyContinue
  if ($bashCommand) {
    $bashPath = $bashCommand.Source
  }
}

if (-not (Test-Path $bashPath)) {
  Write-Error "Git Bash not found. Install Git for Windows or add bash to PATH."
  exit 2
}

& $bashPath -l -c "cd \"$(cygpath -u '$scriptDir')\" && ./run-hook.sh '$ScriptName'"
exit $LASTEXITCODE
