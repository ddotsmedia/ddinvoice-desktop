# Unattended sequential runner for the phase prompts in docs/PHASES.md (Prompt 0c).
# Windows PowerShell 5.1 compatible. Never runs reset, clean, force or delete.
param(
  [int]$From = 1,
  [int]$To = 16,
  [int[]]$Skip = @(),
  [switch]$DryRun,
  [int]$MaxRetries = 2
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$StatePath = Join-Path $Root 'docs\phase-state.json'
$ReportPath = Join-Path $Root 'docs\RUN-REPORT.md'
$LogDir = Join-Path $Root 'logs'

function Stop-Run([string]$Msg) {
  Write-Host "STOP: $Msg" -ForegroundColor Red
  exit 1
}

function Get-Phases {
  $lines = Get-Content -LiteralPath (Join-Path $Root 'docs\PHASES.md') -Encoding UTF8
  $phases = New-Object System.Collections.ArrayList
  $cur = $null; $sb = $null; $fence = ''; $closeRe = ''
  foreach ($line in $lines) {
    if ($null -eq $sb -and $line -match '^## Prompt (\d+) \S+ (.+)$') {
      $cur = [pscustomobject]@{ N = [int]$matches[1]; Title = $matches[2].Trim(); Prompt = $null }
      [void]$phases.Add($cur); continue
    }
    if ($null -eq $cur -or $null -ne $cur.Prompt) { continue }
    if ($null -eq $sb) {
      if ($line -match '^(`{3,4})text\s*$') {
        $sb = New-Object System.Text.StringBuilder
        $closeRe = '^' + $matches[1] + '\s*$'
      }
      continue
    }
    if ($line -match $closeRe) { $cur.Prompt = $sb.ToString().TrimEnd(); $sb = $null; continue }
    [void]$sb.AppendLine($line)
  }
  # Ignore prompts 0, 0b, 0c (only numeric N >= 1 are runnable)
  return @($phases | Where-Object { $_.N -ge 1 -and $_.Prompt })
}

function Get-ModelFor($Phase) {
  $first = ($Phase.Prompt -split "`n")[0]
  if ($first -notmatch 'MODEL:\s*(\w+)') { Stop-Run "Phase $($Phase.N): no MODEL: on first line" }
  switch ($matches[1].ToLower()) {
    'sonnet' { return 'sonnet' }
    'haiku'  { return 'haiku' }
    default  { Stop-Run "Phase $($Phase.N): unknown model '$($matches[1])'" }
  }
}

function Get-State {
  if (Test-Path -LiteralPath $StatePath) {
    return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  return [pscustomobject]@{ completed = @(); skipped = @(); runs = @() }
}

function Save-State($State) {
  $State | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Get-DirtyPaths {
  # tracked changes only; docs/phase-state.json is runner-owned and may be dirty between phases
  $out = git status --porcelain --untracked-files=no
  return @($out | Where-Object { $_ -and ($_ -notmatch 'docs/phase-state\.json$') })
}

function Get-CiRunForSha([string]$Sha) {
  for ($i = 0; $i -lt 60; $i++) {
    $runs = gh run list --branch main --workflow ci.yml --limit 10 --json databaseId,headSha,status,conclusion | ConvertFrom-Json
    $hit = @($runs | Where-Object { $_.headSha -eq $Sha })
    if ($hit.Count -gt 0) { return $hit[0] }
    Start-Sleep -Seconds 15
  }
  return $null
}

function Test-Attempt($StartHead, $Phase) {
  # returns '' on success, else the reason
  $head = (git rev-parse HEAD).Trim()
  if ($head -eq $StartHead) { return 'HEAD did not move (no commit made)' }
  if (@(Get-DirtyPaths).Count -gt 0) { return 'working tree not clean after session' }
  git fetch origin main --quiet
  $ahead = (git rev-list --count "origin/main..HEAD").Trim()
  if ($ahead -ne '0') { return "HEAD not pushed ($ahead commits ahead of origin/main)" }
  $run = Get-CiRunForSha $head
  if ($null -eq $run) { return "no CI run found for $head" }
  gh run watch $run.databaseId --exit-status | Out-Null
  $final = gh run view $run.databaseId --json conclusion | ConvertFrom-Json
  if ($final.conclusion -ne 'success') { return "CI run $($run.databaseId) conclusion: $($final.conclusion)" }
  return ''
}

function Invoke-Claude([string]$Prompt, [string]$Model, [string]$LogPath) {
  $Prompt | & claude -p --model $Model --dangerously-skip-permissions --output-format json |
    Out-File -FilePath $LogPath -Encoding utf8
  return [pscustomobject]@{ Exit = $LASTEXITCODE; Raw = (Get-Content -LiteralPath $LogPath -Raw -Encoding UTF8) }
}

# ---- Plan ----
$all = Get-Phases
$plan = @($all | Where-Object { $_.N -ge $From -and $_.N -le $To })
if ($plan.Count -eq 0) { Stop-Run "no phases in range $From..$To" }

if ($DryRun) {
  $plan | ForEach-Object {
    $gate = ''
    if ($_.N -eq 15 -and -not (Get-ChildItem -LiteralPath (Join-Path $Root 'docs\payroll-inputs') -File -ErrorAction SilentlyContinue)) { $gate = 'SKIP (payroll inputs missing)' }
    if ($Skip -contains $_.N) { $gate = 'SKIP (-Skip)' }
    [pscustomobject]@{ Phase = $_.N; Title = $_.Title; Model = (Get-ModelFor $_); PromptChars = $_.Prompt.Length; Gate = $gate }
  } | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "Dry run: $($plan.Count) phases planned, nothing executed."
  exit 0
}

# ---- Prechecks ----
if (-not (Test-Path -LiteralPath (Join-Path $Root 'CLAUDE.md'))) { Stop-Run 'cwd is not repo root (CLAUDE.md missing)' }
if ((git rev-parse --abbrev-ref HEAD).Trim() -ne 'main') { Stop-Run 'git branch is not main' }
if (@(Get-DirtyPaths).Count -gt 0) { Stop-Run 'working tree not clean (tracked changes present)' }
gh auth status | Out-Null; if ($LASTEXITCODE -ne 0) { Stop-Run 'gh auth status failed' }
claude --version | Out-Null; if ($LASTEXITCODE -ne 0) { Stop-Run 'claude --version failed' }
git pull --rebase origin main | Out-Null; if ($LASTEXITCODE -ne 0) { Stop-Run 'git pull --rebase failed' }
$lastCi = @(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,status | ConvertFrom-Json)
if ($lastCi.Count -eq 0 -or $lastCi[0].conclusion -ne 'success') { Stop-Run "latest CI run on main is not success ($($lastCi[0].conclusion))" }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---- Run ----
$state = Get-State
$runs = New-Object System.Collections.ArrayList
foreach ($r in @($state.runs)) { [void]$runs.Add($r) }
$completed = New-Object System.Collections.ArrayList
foreach ($c in @($state.completed)) { [void]$completed.Add([int]$c) }
$skipped = New-Object System.Collections.ArrayList
foreach ($s in @($state.skipped)) { [void]$skipped.Add($s) }

foreach ($phase in $plan) {
  $n = $phase.N
  if ($completed -contains $n) { Write-Host "Phase $n already completed, skipping"; continue }

  $skipReason = $null
  if ($Skip -contains $n) { $skipReason = 'skipped via -Skip' }
  if ($n -eq 15 -and -not (Get-ChildItem -LiteralPath (Join-Path $Root 'docs\payroll-inputs') -File -ErrorAction SilentlyContinue)) {
    $skipReason = 'payroll inputs missing'
  }
  if ($skipReason) {
    Write-Host "Phase $n skipped: $skipReason"
    [void]$skipped.Add([pscustomobject]@{ n = $n; reason = $skipReason })
    $state.skipped = @($skipped); Save-State $state
    continue
  }

  $model = Get-ModelFor $phase
  $attemptPrompt = $phase.Prompt
  $ok = $false; $lastReason = ''; $attempt = 0; $cost = 0.0; $commit = ''
  $startedAt = (Get-Date).ToString('o')
  while (-not $ok -and $attempt -le $MaxRetries) {
    $attempt++
    $startHead = (git rev-parse HEAD).Trim()
    $logPath = Join-Path $LogDir ("phase-{0:D2}-a{1}.json" -f $n, $attempt)
    Write-Host "Phase $n ($($phase.Title)) attempt $attempt model=$model"
    $res = Invoke-Claude $attemptPrompt $model $logPath
    $parsed = $null
    try { $parsed = $res.Raw | ConvertFrom-Json } catch { $parsed = $null }
    if ($null -ne $parsed -and $parsed.total_cost_usd) { $cost += [double]$parsed.total_cost_usd }

    if ($res.Exit -ne 0 -or $null -eq $parsed -or $parsed.is_error) {
      $lastReason = "claude session error (exit $($res.Exit))"
    } else {
      $lastReason = Test-Attempt $startHead $phase
    }

    if ($lastReason -eq '') {
      $ok = $true
      $commit = (git rev-parse --short HEAD).Trim()
    } else {
      Write-Host "Phase $n attempt $attempt failed: $lastReason" -ForegroundColor Yellow
      $attemptPrompt = "Phase $n ($($phase.Title)) did not finish: $lastReason. Read docs/STATUS.md and logs/phase-$('{0:D2}' -f $n)-a$attempt.json tail, fix, then complete the original phase goal and end per CLAUDE.md rule 13.`n`nORIGINAL PROMPT FOLLOWS:`n$($phase.Prompt)"
    }
  }

  $endedAt = (Get-Date).ToString('o')
  if (-not $ok) {
    $tailLines = @()
    $lastLog = Join-Path $LogDir ("phase-{0:D2}-a{1}.json" -f $n, $attempt)
    if (Test-Path -LiteralPath $lastLog) { $tailLines = @(Get-Content -LiteralPath $lastLog -Encoding UTF8 | Select-Object -Last 40) }
    $report = @(
      "",
      "## Failed run $(Get-Date -Format 'yyyy-MM-dd HH:mm') - Phase $n ($($phase.Title))",
      "Reason: $lastReason",
      '```',
      ($tailLines -join "`n"),
      '```'
    )
    Add-Content -LiteralPath $ReportPath -Value $report -Encoding UTF8
    $state.runs = @($runs) + [pscustomobject]@{ n = $n; model = $model; startedAt = $startedAt; endedAt = $endedAt; costUsd = $cost; attempts = $attempt; commit = ''; error = $lastReason }
    Save-State $state
    Stop-Run "Phase $n failed after $attempt attempt(s): $lastReason. See docs/RUN-REPORT.md"
  }

  [void]$completed.Add($n)
  $run = [pscustomobject]@{ n = $n; model = $model; startedAt = $startedAt; endedAt = $endedAt; costUsd = [math]::Round($cost, 4); attempts = $attempt; commit = $commit }
  [void]$runs.Add($run)
  $state.completed = @($completed); $state.runs = @($runs)
  Save-State $state
  Write-Host ("Phase {0} OK ({1}) {2} USD {3}" -f $n, $model, $commit, $run.costUsd)
  if ($model -eq 'sonnet') {
    $idx = [array]::IndexOf(@($plan), $phase)
    $next = if ($idx + 1 -lt $plan.Count) { Get-ModelFor $plan[$idx + 1] } else { 'none' }
    Write-Host "Complex phase complete. Next phase model: $next"
  }
}

# ---- Summary ----
$summary = @($runs | Where-Object { $_.n -ge $From -and $_.n -le $To })
$table = $summary | Select-Object @{N='Phase';E={$_.n}}, model, attempts, @{N='CostUsd';E={$_.costUsd}}
$table | Format-Table -AutoSize | Out-String | Write-Host
$haiku = @($summary | Where-Object { $_.model -eq 'haiku' }).Count
$sonnet = @($summary | Where-Object { $_.model -eq 'sonnet' }).Count
$ratio = "$($haiku):$($sonnet)"
$total = ($summary | Measure-Object -Property costUsd -Sum).Sum
Write-Host "Haiku:Sonnet ratio $ratio, total cost `$$([math]::Round([double]$total, 4))"

$report = @(
  "",
  "## Run $From-$To finished $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
  "Haiku:Sonnet ratio $ratio, total cost `$$([math]::Round([double]$total, 4))",
  ($table | Format-Table -AutoSize | Out-String)
)
Add-Content -LiteralPath $ReportPath -Value $report -Encoding UTF8

git add docs/phase-state.json docs/RUN-REPORT.md
git commit -m "runner: phases $From-$To complete" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>" | Out-Null
git pull --rebase origin main | Out-Null
git push origin main | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Run 'push of runner state failed' }
Write-Host 'Runner finished.'
