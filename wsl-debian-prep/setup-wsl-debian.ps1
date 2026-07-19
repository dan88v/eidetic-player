[CmdletBinding()]
# Environment bootstrap only; it does not modify Eidetic Player application code.
param(
    [string]$DistroName = "Debian",
    [string]$RepositoryUrl = "https://github.com/dan88v/eidetic-player.git",
    [string]$LinuxRepositoryPath = "~/src/eidetic-player",
    [string]$NodeVersion = "24.18.0",
    [switch]$SkipPackages,
    [switch]$SkipClone
)

$ErrorActionPreference = "Stop"

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Get-WslDistros {
    $output = & wsl.exe --list --quiet 2>$null
    if ($LASTEXITCODE -ne 0) { return @() }
    return @($output | ForEach-Object { ($_ -replace "`0", "").Trim() } |
        Where-Object { $_ })
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    if (-not (Test-Administrator)) {
        throw "WSL is absent. Re-run this script from an elevated PowerShell."
    }
    & wsl.exe --install --no-distribution
    if ($LASTEXITCODE -ne 0) { throw "WSL installation failed." }
    Write-Host "A Windows restart may be required. Re-run this script afterward."
    exit 10
}

& wsl.exe --update
if ($LASTEXITCODE -ne 0) { throw "WSL update failed." }
& wsl.exe --set-default-version 2
if ($LASTEXITCODE -ne 0) { throw "Unable to select WSL2 for new distros." }

$distros = Get-WslDistros
if ($distros -notcontains $DistroName) {
    & wsl.exe --install --no-launch -d $DistroName
    if ($LASTEXITCODE -ne 0) { throw "$DistroName installation failed." }
    Write-Host "$DistroName installed. Launch it once and create a non-root user."
    exit 11
}

& wsl.exe --set-version $DistroName 2
if ($LASTEXITCODE -ne 0) { throw "Unable to verify $DistroName as WSL2." }

$linuxUser = (& wsl.exe -d $DistroName -- id -un).Trim()
if (-not $linuxUser -or $linuxUser -eq "root") {
    throw "$DistroName needs a default non-root user before setup can continue."
}

$bashScript = Join-Path $PSScriptRoot "setup-debian-dev.sh"
$linuxScript = (& wsl.exe -d $DistroName -- wslpath -a $bashScript).Trim()
$arguments = @(
    "-d", $DistroName, "--", "bash", $linuxScript,
    "--repo-url", $RepositoryUrl,
    "--repo-path", $LinuxRepositoryPath,
    "--node-version", $NodeVersion
)
if ($SkipPackages) { $arguments += "--skip-packages" }
if ($SkipClone) { $arguments += "--skip-clone" }

& wsl.exe @arguments
exit $LASTEXITCODE
