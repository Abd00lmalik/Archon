param(
  [switch]$AddAlias = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Configuring Archon commit workflow..." -ForegroundColor Cyan

# Use repo template for plain-language commit messages.
git config commit.template .gitmessage

# Optional helper alias for one-command commit/push.
if ($AddAlias) {
  git config alias.archon '!git add . && git commit -m "Archon final build" && git push'
}

# Report current local configuration.
$template = git config --get commit.template
$alias = git config --get alias.archon 2>$null

Write-Host "commit.template = $template" -ForegroundColor Green
if ($alias) {
  Write-Host "alias.archon   = $alias" -ForegroundColor Green
} else {
  Write-Host "alias.archon   = (not set)" -ForegroundColor Yellow
}

Write-Host "Done. Plain commit messages are allowed (no conventional prefix required)." -ForegroundColor Green
