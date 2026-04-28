# GRC Platform — One-Shot Setup Script (Windows PowerShell)
# ----------------------------------------------------------
# Installs prerequisites (Python 3.12, Node.js LTS), creates a Python virtualenv,
# installs backend + frontend dependencies, and prepares .env files.
#
# Usage:
#   pwsh -ExecutionPolicy Bypass -File .\setup.ps1
#   (or run from Windows PowerShell after: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }

function Test-Cmd($name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { return $false }
    # Filter out the Microsoft Store python.exe stub
    if ($cmd.Source -like '*WindowsApps*python.exe*') { return $false }
    return $true
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

# ---------------------------------------------------------------- 1. Python
Write-Step 'Checking Python 3.12+'
if (-not (Test-Cmd 'python')) {
    Write-Warn2 'Python not found. Installing Python 3.12 via winget...'
    winget install --id Python.Python.3.12 -e --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
}
$pyVer = & python --version 2>&1
Write-Ok "Python: $pyVer"

# ---------------------------------------------------------------- 2. Node.js
Write-Step 'Checking Node.js (LTS)'
if (-not (Test-Cmd 'node')) {
    Write-Warn2 'Node.js not found. Installing Node.js LTS via winget...'
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
}
$nodeVer = & node --version 2>&1
$npmVer  = & npm --version 2>&1
Write-Ok "Node: $nodeVer / npm: $npmVer"

# ---------------------------------------------------------------- 3. Ollama (optional)
Write-Step 'Checking Ollama (optional, required for AI features)'
if (-not (Test-Cmd 'ollama')) {
    Write-Warn2 'Ollama not found. Installing via winget (skip with Ctrl+C if not needed)...'
    try {
        winget install --id Ollama.Ollama -e --silent --accept-source-agreements --accept-package-agreements
        Refresh-Path
        Write-Ok 'Ollama installed. Run "ollama pull deepseek-v3.1:671b-cloud" later to fetch the model.'
    } catch {
        Write-Warn2 'Ollama install failed or skipped. AI features will not work until installed manually.'
    }
} else {
    Write-Ok 'Ollama already installed.'
}

# ---------------------------------------------------------------- 4. Backend venv + deps
Write-Step 'Creating backend virtualenv (backend/.venv)'
$venvPath = Join-Path $ProjectRoot 'backend\.venv'
if (-not (Test-Path $venvPath)) {
    & python -m venv $venvPath
}
$venvPython = Join-Path $venvPath 'Scripts\python.exe'
$venvPip    = Join-Path $venvPath 'Scripts\pip.exe'

Write-Step 'Upgrading pip and installing backend dependencies'
& $venvPython -m pip install --upgrade pip wheel setuptools
& $venvPip install -r (Join-Path $ProjectRoot 'backend\requirements.txt')
Write-Ok 'Backend dependencies installed.'

# ---------------------------------------------------------------- 5. Backend .env files
Write-Step 'Verifying backend env files'
$envLocal = Join-Path $ProjectRoot 'backend\.env.local'
if (-not (Test-Path $envLocal)) {
    Copy-Item (Join-Path $ProjectRoot 'backend\.env.example') $envLocal
    Write-Ok 'Created backend/.env.local from .env.example'
} else {
    Write-Ok 'backend/.env.local already exists.'
}

# ---------------------------------------------------------------- 6. Frontend deps
Write-Step 'Installing frontend dependencies (npm install)'
Push-Location (Join-Path $ProjectRoot 'frontend')
try {
    & npm install
} finally {
    Pop-Location
}
Write-Ok 'Frontend dependencies installed.'

# ---------------------------------------------------------------- 7. Frontend .env
Write-Step 'Verifying frontend env file'
$frontEnv = Join-Path $ProjectRoot 'frontend\.env'
if (-not (Test-Path $frontEnv)) {
    Copy-Item (Join-Path $ProjectRoot 'frontend\.env.example') $frontEnv
    Write-Ok 'Created frontend/.env from .env.example'
} else {
    Write-Ok 'frontend/.env already exists.'
}

# ---------------------------------------------------------------- Done
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Setup complete." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Start both servers:    .\start.ps1"
Write-Host "  2. Open the app:          http://localhost:4000"
Write-Host "  3. Login as:              admin@demo.com / demo123"
Write-Host ""
Write-Host "Optional (AI features):"
Write-Host "  ollama pull deepseek-v3.1:671b-cloud"
Write-Host ""
