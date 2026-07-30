# Chem-QA user reports: daily fetch + unattended triage draft (ASCII only, for Windows PowerShell 5.1).
# 1) fetch_reports.py --quiet-empty : prints the triage packet ONLY when there are new reports.
# 2) if new: append the packet to reports_inbox.md, then run claude (read-only) to write a triage draft.
# claude runs with read-only tools (Read/Grep/Glob) -> it CANNOT edit files or run git. Text output only.
# Runs claude only on days with new reports (no token use on empty days).
# Scheduled via: powershell -NoProfile -ExecutionPolicy Bypass -File <this file>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # capture claude's UTF-8 (Japanese) output correctly

$here   = $PSScriptRoot
$repo   = (Get-Item $here).Parent.Parent.FullName
$py     = 'C:\Python314\python.exe'                  # python path; update if it moves
$claude = Join-Path $env:APPDATA 'npm\claude.cmd'    # Claude Code CLI launcher
$script = Join-Path $here 'fetch_reports.py'
$inbox  = Join-Path $here 'reports_inbox.md'

$out = (& $py $script --quiet-empty 2>&1 | Out-String)
if ($out.Trim().Length -eq 0) { return }             # no new reports: stop (no draft, no token use)

$stamp = "`n===== fetch " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + " =====`n"
Add-Content -Path $inbox -Value ($stamp + $out) -Encoding utf8

# Unattended triage draft. English prompt (ASCII-safe); ask for Japanese output. Read-only tools.
$draft  = Join-Path $here ("triage-draft-" + (Get-Date -Format 'yyyy-MM-dd') + ".md")
$prompt = 'Triage the new user reports in qa/tools/last_triage.md. Read qa/REVIEW_CRITERIA.md (criteria C1-C16) and qa/questions.json as needed. For each report give: (1) the relevant criteria id(s), (2) whether it is a real issue (bug / wording / UI / duplicate / no-action-needed), (3) if real, a concrete before->after fix to questions.json. Respond in Japanese as concise Markdown. Do NOT edit any files and do NOT run git; output text only.'
Push-Location $repo
try {
    $d = (& $claude -p $prompt --allowedTools 'Read Grep Glob' 2>&1 | Out-String)
    Set-Content -Path $draft -Value $d -Encoding utf8
} finally { Pop-Location }
