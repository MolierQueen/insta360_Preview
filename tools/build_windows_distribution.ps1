param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "Product"
$Cache = Join-Path $Root ".build-cache\windows-x64"
$NodeVersion = "22.16.0"
$PythonVersion = "3.14.6"
$RuntimeRelease = "20260718"

$PythonArchive = Join-Path $Cache "cpython-windows-x64.tar.gz"
$NodeArchive = Join-Path $Cache "node-windows-x64.zip"
$PythonUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/$RuntimeRelease/cpython-$PythonVersion%2B$RuntimeRelease-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$App = Join-Path $Dist "Insta Library-Windows-x64"
$AppRoot = Join-Path $App "Resources\app"
$Runtime = Join-Path $App "Resources\runtime"
$ZipPath = Join-Path $Dist "Insta-Library-Windows-x64.zip"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing build command: $Name"
    }
}

function Download-IfMissing([string]$Path, [string]$Url) {
    if ((Test-Path $Path) -and ((Get-Item $Path).Length -gt 0)) {
        return
    }
    Write-Host "Downloading $(Split-Path -Leaf $Path)..."
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing -TimeoutSec 600
}

foreach ($CommandName in @("node", "npm", "python", "tar")) {
    Require-Command $CommandName
}

New-Item -ItemType Directory -Force -Path $Dist, $Cache | Out-Null

$Vinext = Join-Path $Root "web\node_modules\.bin\vinext.cmd"
if (-not (Test-Path $Vinext)) {
    Write-Host "Installing locked web build dependencies..."
    $env:npm_config_cache = Join-Path $Root ".build-cache\npm"
    & npm --prefix (Join-Path $Root "web") ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
}

Download-IfMissing $PythonArchive $PythonUrl
Download-IfMissing $NodeArchive $NodeUrl

Write-Host "Building production web bundle..."
Push-Location (Join-Path $Root "web")
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

if (Test-Path $App) { Remove-Item -Recurse -Force $App }
$Directories = @(
    (Join-Path $AppRoot "tools"),
    (Join-Path $AppRoot "vendor\insta360-wifi-api"),
    (Join-Path $App "Resources\Licenses"),
    $Runtime
)
New-Item -ItemType Directory -Force -Path $Directories | Out-Null

$CmdSource = Join-Path $Root "packaging\windows\Insta Library.cmd"
$CmdTarget = Join-Path $App "Insta Library.cmd"
$CmdText = [System.IO.File]::ReadAllText($CmdSource) -replace "`r?`n", "`r`n"
[System.IO.File]::WriteAllText($CmdTarget, $CmdText, [System.Text.UTF8Encoding]::new($false))
Copy-Item (Join-Path $Root "packaging\windows\README-使用说明.txt") (Join-Path $App "README.txt")
Copy-Item (Join-Path $Root "packaging\licenses\NODE_LICENSE") (Join-Path $App "Resources\Licenses\Node-LICENSE")
Copy-Item (Join-Path $Root "packaging\THIRD_PARTY_NOTICES.md") (Join-Path $App "Resources\Licenses\THIRD_PARTY_NOTICES.md")

& tar -xzf $PythonArchive -C $Runtime
if ($LASTEXITCODE -ne 0) { throw "Python runtime extraction failed" }
$NodeExtract = Join-Path $Cache "node-extract"
if (Test-Path $NodeExtract) { Remove-Item -Recurse -Force $NodeExtract }
Expand-Archive -Path $NodeArchive -DestinationPath $NodeExtract -Force
Copy-Item (Join-Path $NodeExtract "node-v$NodeVersion-win-x64\node.exe") (Join-Path $Runtime "node.exe")
Remove-Item -Recurse -Force $NodeExtract

foreach ($Tool in @("insta360_web_server.py", "probe_ucd2_replay_readonly.py", "run_bundled_app.py", "standalone_web_server.mjs")) {
    Copy-Item (Join-Path $Root "tools\$Tool") (Join-Path $AppRoot "tools\$Tool")
}
Copy-Item (Join-Path $Root "web\dist") (Join-Path $AppRoot "web-dist") -Recurse
Copy-Item (Join-Path $Root "vendor\insta360-wifi-api\pb2") (Join-Path $AppRoot "vendor\insta360-wifi-api\pb2") -Recurse
Copy-Item (Join-Path $Root "vendor\insta360-wifi-api\LICENSE") (Join-Path $AppRoot "vendor\insta360-wifi-api\LICENSE")
Copy-Item (Join-Path $Root "packaging\python-packages") (Join-Path $AppRoot "python-packages") -Recurse

Get-ChildItem -Path $App -Directory -Filter "__pycache__" -Recurse -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force

if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path $App -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Host "Created $ZipPath"
