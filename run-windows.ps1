<#
Starts Data Handyman on Windows with no containers, no admin rights, and no
manual install steps: checks for Python 3.14 / Node 26 / uv, downloads and
installs whichever is missing (official sources only, checksum-verified),
installs the app's dependencies, starts the backend and frontend, and
prints the URL to open.

This automates the manual steps in docs/install-windows-no-container.md.
Run it from a PowerShell window opened in this folder:

    powershell -ExecutionPolicy Bypass -File .\run-windows.ps1

or just double-click run-windows.bat.
#>

$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$NodeInstallDir = Join-Path $env:LOCALAPPDATA 'DataHandyman\node'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "    $msg" }

# Only ever download from these two hosts, over HTTPS. Checked right
# before every download, not just when building the URL, so a bug in the
# URL-building code can't silently widen this.
function Assert-OfficialHost([string]$url, [string[]]$allowedHosts) {
    $uri = [uri]$url
    if ($uri.Scheme -ne 'https' -or ($allowedHosts -notcontains $uri.Host)) {
        throw "Refusing to download from untrusted URL: $url"
    }
}

function Update-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:PATH = @($machinePath, $userPath) -join ';'
}

function Test-PortOpen([int]$port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Assert-Checksum([string]$filePath, [string]$expectedSha256) {
    $actual = (Get-FileHash -Path $filePath -Algorithm SHA256).Hash
    if ($actual.ToLowerInvariant() -ne $expectedSha256.ToLowerInvariant()) {
        Remove-Item $filePath -ErrorAction SilentlyContinue
        throw "Checksum mismatch for $filePath -- expected $expectedSha256, got $actual. The download may be corrupted or tampered with; aborting."
    }
}

function Test-PythonOk {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $cmd) { return $false }
    try {
        $verOut = (& python --version) 2>&1
        if ($verOut -match '(\d+)\.(\d+)\.(\d+)') {
            $maj = [int]$Matches[1]; $min = [int]$Matches[2]
            return ($maj -gt 3) -or ($maj -eq 3 -and $min -ge 11)
        }
    } catch {}
    return $false
}

function Test-NodeOk {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { return $false }
    try {
        $verOut = (& node --version) 2>&1
        if ($verOut -match 'v(\d+)\.') {
            return [int]$Matches[1] -ge 20
        }
    } catch {}
    return $false
}

# Resolves the latest published Python 3.14.x release, looks up its official
# SHA256 via python.org's own API, downloads the Windows installer, verifies
# the hash, then runs it as a per-user install (no admin rights needed).
function Install-Python {
    Write-Info 'Looking up the latest Python 3.14 release on python.org...'
    $listingUrl = 'https://www.python.org/ftp/python/'
    Assert-OfficialHost $listingUrl @('www.python.org')
    $listing = Invoke-WebRequest -Uri $listingUrl -UseBasicParsing -TimeoutSec 20
    $patches = [regex]::Matches($listing.Content, '3\.14\.(\d+)/') | ForEach-Object { [int]$_.Groups[1].Value }
    if (-not $patches) { throw 'Could not find a Python 3.14 release listed on python.org.' }
    $patch = ($patches | Sort-Object -Descending | Select-Object -First 1)
    $slug = "python-314$patch"

    $releaseUrl = "https://www.python.org/api/v2/downloads/release/?slug=$slug&is_published=true"
    Assert-OfficialHost $releaseUrl @('www.python.org')
    $release = Invoke-RestMethod -Uri $releaseUrl -TimeoutSec 20
    if (-not $release -or -not $release.resource_uri) { throw "python.org's API has no published release for slug $slug." }
    $releaseId = ($release.resource_uri.TrimEnd('/') -split '/')[-1]

    $filesUrl = "https://www.python.org/api/v2/downloads/release_file/?release=$releaseId"
    Assert-OfficialHost $filesUrl @('www.python.org')
    $files = Invoke-RestMethod -Uri $filesUrl -TimeoutSec 20
    $installerFile = $files | Where-Object { $_.url -like '*-amd64.exe' } | Select-Object -First 1
    if (-not $installerFile -or -not $installerFile.sha256_sum) {
        throw "Couldn't find a checksummed Windows installer for Python 3.14.$patch."
    }
    Assert-OfficialHost $installerFile.url @('www.python.org')

    $installer = Join-Path $env:TEMP "python-3.14.$patch-amd64.exe"
    Write-Info "Downloading Python 3.14.$patch..."
    Invoke-WebRequest -Uri $installerFile.url -OutFile $installer -UseBasicParsing
    if (-not (Test-Path $installer) -or (Get-Item $installer).Length -eq 0) { throw 'Python download failed or was empty.' }
    Assert-Checksum $installer $installerFile.sha256_sum

    Write-Info 'Installing Python (per-user install, no admin rights needed)...'
    $proc = Start-Process -FilePath $installer -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=0', 'Include_test=0' -Wait -PassThru
    Remove-Item $installer -ErrorAction SilentlyContinue
    if ($proc.ExitCode -ne 0) { throw "Python installer exited with code $($proc.ExitCode)." }
}

# Resolves the latest published Node.js 26.x release from nodejs.org's own
# index, verifies the zip against nodejs.org's official SHASUMS256.txt, then
# extracts it locally and adds it to the user PATH (no admin rights needed --
# the official installer is an MSI, which needs elevation, so this uses the
# official zip distribution instead).
function Install-Node {
    Write-Info 'Looking up the latest Node.js 26 release on nodejs.org...'
    $indexUrl = 'https://nodejs.org/dist/index.json'
    Assert-OfficialHost $indexUrl @('nodejs.org')
    $releases = Invoke-RestMethod -Uri $indexUrl -TimeoutSec 20
    $v26 = $releases | Where-Object { $_.version -match '^v26\.\d+\.\d+$' }
    if (-not $v26) { throw 'Could not find a Node.js 26 release on nodejs.org.' }
    $latest = $v26 | Sort-Object { [version]($_.version.TrimStart('v')) } -Descending | Select-Object -First 1
    $version = $latest.version

    $zipUrl = "https://nodejs.org/dist/$version/node-$version-win-x64.zip"
    Assert-OfficialHost $zipUrl @('nodejs.org')
    $sumsUrl = "https://nodejs.org/dist/$version/SHASUMS256.txt"
    Assert-OfficialHost $sumsUrl @('nodejs.org')
    $sums = Invoke-WebRequest -Uri $sumsUrl -UseBasicParsing -TimeoutSec 20
    $sumLine = ($sums.Content -split "`n") | Where-Object { $_ -match "node-$version-win-x64\.zip$" } | Select-Object -First 1
    if (-not $sumLine) { throw "Couldn't find an official checksum for node-$version-win-x64.zip." }
    $expectedSha256 = ($sumLine -split '\s+')[0]

    $zipPath = Join-Path $env:TEMP "node-$version-win-x64.zip"
    Write-Info "Downloading Node.js $version..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -eq 0) { throw 'Node download failed or was empty.' }
    Assert-Checksum $zipPath $expectedSha256

    $extractRoot = Join-Path $env:TEMP "node-extract-$(Get-Random)"
    Write-Info 'Extracting Node.js...'
    Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force
    Remove-Item $zipPath -ErrorAction SilentlyContinue

    $extractedFolder = Join-Path $extractRoot "node-$version-win-x64"
    if (Test-Path $NodeInstallDir) { Remove-Item $NodeInstallDir -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path $NodeInstallDir) -Force | Out-Null
    Move-Item -Path $extractedFolder -Destination $NodeInstallDir
    Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    if ($userPath -notlike "*$NodeInstallDir*") {
        [Environment]::SetEnvironmentVariable('Path', "$NodeInstallDir;$userPath", 'User')
    }
}

try {
    Write-Step 'Checking Python'
    if (Test-PythonOk) {
        Write-Ok "Already installed: $(python --version)"
    } else {
        Install-Python
        Update-SessionPath
        if (-not (Test-PythonOk)) { throw 'Python was installed but is still not on PATH. Close this window, open a new PowerShell, and re-run this script.' }
        Write-Ok "Installed $(python --version)"
    }

    Write-Step 'Checking Node.js'
    if (Test-NodeOk) {
        Write-Ok "Already installed: $(node --version)"
    } else {
        Install-Node
        Update-SessionPath
        if (-not (Test-NodeOk)) { throw 'Node.js was installed but is still not on PATH. Close this window, open a new PowerShell, and re-run this script.' }
        Write-Ok "Installed $(node --version)"
    }

    Write-Step 'Checking uv'
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        Write-Ok "Already installed: $(uv --version)"
    } else {
        Write-Info 'Installing uv...'
        python -m pip install --quiet uv
        Update-SessionPath
        if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv was installed but is still not on PATH. Close this window, open a new PowerShell, and re-run this script.' }
        Write-Ok "Installed $(uv --version)"
    }

    Write-Step 'Installing backend dependencies'
    Push-Location $Backend
    uv sync
    Pop-Location
    Write-Ok 'Backend dependencies ready'

    Write-Step 'Installing frontend dependencies'
    Push-Location $Frontend
    npm install
    Pop-Location
    Write-Ok 'Frontend dependencies ready'

    Write-Step 'Starting the backend'
    if (Test-PortOpen 8000) {
        Write-Ok 'Already running on port 8000'
    } else {
        $backendCmd = "Set-Location `"$Backend`"; `$env:DB_PATH = '.\handy_recorder.db'; uv run uvicorn app.main:app --host 0.0.0.0 --port 8000"
        Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd
        Write-Ok 'Opened in a new window'
    }

    Write-Step 'Starting the frontend'
    if (Test-PortOpen 5173) {
        Write-Ok 'Already running on port 5173'
    } else {
        $frontendCmd = "Set-Location `"$Frontend`"; `$env:VITE_DEV_PROXY_TARGET = 'http://localhost:8000'; npm run dev"
        Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCmd
        Write-Ok 'Opened in a new window'
    }

    Write-Step 'Waiting for the app to come up'
    $deadline = (Get-Date).AddSeconds(60)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) { $ready = $true; break }
        } catch {}
        Start-Sleep -Seconds 2
    }

    if ($ready) {
        Write-Host "`nData Handyman is ready: http://localhost:5173" -ForegroundColor Green
        Start-Process 'http://localhost:5173'
    } else {
        Write-Host "`nStill starting -- check the two new PowerShell windows for errors." -ForegroundColor Yellow
        Write-Host "Once ready, open: http://localhost:5173" -ForegroundColor Yellow
    }
    Write-Host "`nLeave both new PowerShell windows open while you use the app. Press Ctrl+C in each to stop it."
}
catch {
    Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
