$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
    throw 'Visual Studio Installer was not found. Install the Desktop development with C++ workload.'
}

$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $installation) {
    throw 'Visual Studio C++ build tools were not found.'
}

$devShell = Join-Path $installation 'Common7\Tools\Launch-VsDevShell.ps1'
& $devShell -Arch amd64 -HostArch amd64 -NoLogo

docker compose up -d --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not start the local services.' }

npm run tauri dev
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
