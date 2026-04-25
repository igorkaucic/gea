# GEA Deploy Script - Build + Push to GitHub Pages
$ErrorActionPreference = "Stop"

# Bump version
$versionFile = "src/version.ts"
$content = Get-Content $versionFile -Raw
$match = [regex]::Match($content, "v(\d+)\.(\d+)\.(\d+)")
$major = [int]$match.Groups[1].Value
$minor = [int]$match.Groups[2].Value
$patch = [int]$match.Groups[3].Value + 1
$newVersion = "v$major.$minor.$patch"
$content = $content -replace "v\d+\.\d+\.\d+", $newVersion
Set-Content $versionFile $content
Write-Host "Version bumped to $newVersion" -ForegroundColor Cyan

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
