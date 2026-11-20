# Start Expo in "server mode" (talks to the Spring backend).
# Usage:  .\scripts\start-with-backend.ps1            -> backend on this PC (LAN IP, works for iPhone too)
#         .\scripts\start-with-backend.ps1 -Url https://api.example.com
# Without this script (plain `npx expo start` / Vercel build) the app stays in demo mode.
param([string]$Url = '')

if (-not $Url) {
    # Use the adapter that has a default gateway (real Wi-Fi/LAN), not Docker/WSL virtual adapters.
    $ip = (Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
        Select-Object -First 1).IPv4Address.IPAddress
    if (-not $ip) { $ip = 'localhost' }
    $Url = "http://${ip}:8080"
}

$env:EXPO_PUBLIC_API_URL = $Url
Write-Host "Server mode: EXPO_PUBLIC_API_URL=$Url"
Set-Location (Split-Path $PSScriptRoot -Parent)
npx expo start --go --clear
