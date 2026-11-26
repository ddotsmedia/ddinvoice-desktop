# Installer smoke (CI, elevated): silent server install to a temp dir, services running, /health 200, silent uninstall, data kept.
param([string]$Installer = (Get-ChildItem (Join-Path $PSScriptRoot '..\..\release') -Filter 'DDInvoice-Setup-*.exe' | Where-Object Name -notmatch '__uninstaller' | Select-Object -First 1 -ExpandProperty FullName))
$ErrorActionPreference = 'Stop'
$data = Join-Path $env:ProgramData 'DDInvoice'
$dir = Join-Path $env:TEMP ('ddinv-install-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host 'SMOKE SKIPPED: needs elevation'; exit 2 }
if (Test-Path (Join-Path $data 'server.json')) { Write-Host "SMOKE REFUSED: $data already has an install"; exit 3 }
$svc = 'DDInvoicePostgres', 'DDInvoiceApi', 'DDInvoiceWorker'
$fail = $null
try {
  $p = Start-Process $Installer -ArgumentList '/S', '/ROLE=server', "/D=$dir" -PassThru
  if (-not $p.WaitForExit(420000)) { throw 'installer timed out after 7 min' }
  if ($p.ExitCode) { throw "installer exit $($p.ExitCode)" }
  foreach ($s in $svc) { if ((Get-Service $s -ErrorAction Stop).Status -ne 'Running') { throw "$s not running" } }
  $cfg = Get-Content (Join-Path $data 'server.json') -Raw | ConvertFrom-Json
  $code = ''
  for ($i = 0; $i -lt 30 -and $code -ne '200'; $i++) { $code = (& curl.exe -sk -o NUL -w '%{http_code}' "https://127.0.0.1:$($cfg.port)/health"); if ($code -ne '200') { Start-Sleep 2 } }
  if ($code -ne '200') { throw "/health returned $code" }
  if ((Get-Content (Join-Path $data 'role.json') -Raw | ConvertFrom-Json).role -ne 'server') { throw 'role.json wrong' }
  $un = Get-ChildItem $dir -Filter 'Uninstall*.exe' | Select-Object -First 1
  $u = Start-Process $un.FullName -ArgumentList '/S' -PassThru
  if (-not $u.WaitForExit(180000)) { throw 'uninstaller timed out after 3 min' }
  if ($u.ExitCode) { throw "uninstaller exit $($u.ExitCode)" }
  Start-Sleep 3
  foreach ($s in $svc) { if (Get-Service $s -ErrorAction SilentlyContinue) { throw "$s still registered" } }
  if (-not (Test-Path (Join-Path $data 'server.json'))) { throw 'data folder was removed' }
} catch {
  $fail = $_
  foreach ($l in 'install-out.log', 'logs\setup.log', 'logs\server.log') { $lf = Join-Path $data $l; if (Test-Path $lf) { Write-Host "--- $l (tail)"; Get-Content $lf -Tail 40 } }
}
finally {
  # Test cleanup of this run's own temp install data only.
  if (Test-Path $data) {
    $cli = Join-Path $dir 'resources\dist\setup.cjs'
    if (Test-Path $cli) { & (Join-Path $dir 'resources\vendor\node\node.exe') $cli uninstall-server --delete-data --data-dir $data --app-root (Join-Path $dir 'resources') | Out-Null }
    if (Test-Path $data) { Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
if ($fail) { Write-Host "SMOKE FAILED: $fail"; exit 1 } else { Write-Host 'SMOKE OK' }
