# GRC Platform — Start both backend (port 8000) and frontend (port 4000)
# in two new PowerShell windows.

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython  = Join-Path $ProjectRoot 'backend\.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
    Write-Host "Backend venv not found. Run .\setup.ps1 first." -ForegroundColor Red
    exit 1
}

$backendCmd  = "cd `"$ProjectRoot\backend`"; & `"$venvPython`" -m uvicorn app.main:app --reload --port 8000"
$frontendCmd = "cd `"$ProjectRoot\frontend`"; npm run dev -- --port 4000"

Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCmd

Write-Host ""
Write-Host "Backend:  http://localhost:8000/api/v1/docs" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:4000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Login: admin@demo.com / demo123" -ForegroundColor Yellow
