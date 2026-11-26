# Local smoke: install-server --no-service (process mode) into a temp dir, check API + pairing, uninstall.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
$data = Join-Path $env:TEMP ("ddinv-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$port = Get-Random -Minimum 47900 -Maximum 47950
$pgPort = $port + 100
$node = Join-Path $root 'vendor\node\node.exe'
$cli = Join-Path $root 'dist\setup.cjs'
$fail = $false
try {
  pnpm vendor | Out-Null; if ($LASTEXITCODE) { throw 'vendor failed' }
  pnpm bundle:server | Out-Null; if ($LASTEXITCODE) { throw 'bundle failed' }
  $out = & $node $cli install-server --no-service --company-name 'Smoke Co' --admin-email smoke@example.com --data-dir $data --port $port --pg-port $pgPort 2>&1 | Out-String
  if ($LASTEXITCODE) { throw "install failed:`n$out" }
  $pw = ([regex]::Match($out, 'Admin password \(shown once\): (\S+)')).Groups[1].Value
  $json = & $node $cli pairing-code --data-dir $data
  if ($LASTEXITCODE) { throw 'pairing-code failed' }
  $code = ($json | ConvertFrom-Json).code
  & $node (Join-Path $root 'tools\scripts\smoke-check.mjs') $data $port smoke@example.com $pw $code
  if ($LASTEXITCODE) { $fail = $true }
} catch { Write-Host "SMOKE ERROR: $_"; $fail = $true }
finally {
  & $node $cli uninstall-server --delete-data --data-dir $data 2>&1 | Out-Null
  Write-Host ("cleanup: " + $(if (Test-Path $data) { 'data dir remains' } else { 'removed' }))
}
if ($fail) { Write-Host 'SMOKE FAILED'; exit 1 } else { Write-Host 'SMOKE OK' }
