$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $taskNodeDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.tools/node-v24.15.0-win-x64'))
  if (-not (Test-Path -LiteralPath (Join-Path $taskNodeDirectory 'node.exe'))) { throw 'Install Node.js 24 or later, then run npm install and npm run dev.' }
  $env:PATH = $taskNodeDirectory + ';' + $env:PATH
}
if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item -LiteralPath '.env.example' -Destination '.env.local' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
& npm.cmd run dev
