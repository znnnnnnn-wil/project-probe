$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'load-env.ps1')
Push-Location (Join-Path (Split-Path $PSScriptRoot -Parent) 'backend')
try { & mvn.cmd spring-boot:run } finally { Pop-Location }
