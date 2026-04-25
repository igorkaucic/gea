# GEA Deploy Script - Build + Push to GitHub Pages
$ErrorActionPreference = "Stop"

$versionFile = "src/version.ts"
Write-Host "`n Incrementing version..." -ForegroundColor Cyan
if (Test-Path $versionFile) {
    $currentContent = Get-Content $versionFile -Raw
    $currentVersion = [regex]::Match($currentContent, "'(\d+\.\d+)'").Groups[1].Value
} else {
    $currentVersion = "1.0"
}

$parts = $currentVersion.Split('.')
if ($parts.Count -eq 2) {
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    if ($minor -ge 9) {
        $major = $major + 1
        $newMinor = 0
    } else {
        $newMinor = $minor + 1
    }
    $newVersion = "$major.$newMinor"
} else {
    $newVersion = "1.1"
}

Set-Content -Path $versionFile -Value "export const APP_VERSION = '$newVersion';" -Encoding UTF8
Write-Host " Version bumped: $currentVersion -> $newVersion" -ForegroundColor Green

# Build
Write-Host "Building..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# Deploy to GitHub Pages
Write-Host "Deploying to GitHub Pages..." -ForegroundColor Green
git add .
git commit -m "$newVersion - deploy"
git push origin main

# Deploy dist to gh-pages branch
npx -y gh-pages -d dist
Write-Host "Deployed $newVersion to https://igorkaucic.github.io/gea/" -ForegroundColor Green
