[CmdletBinding()]
param(
    [ValidateSet("quick", "security", "architect", "frontend", "parser", "qa", "desktop", "implementer", "opus")]
    [string]$Profile = "quick",

    [string]$Task = "Review the current WhatsApp Delivery Counter project and report the most important actionable issues.",

    [switch]$NoReport
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

$profiles = @{
    quick = @{ Agent = "ifrim-claude-code-reviewer"; Model = "sonnet"; Effort = "medium"; Label = "claude-quick-review" }
    security = @{ Agent = "ifrim-claude-security-auditor"; Model = "opus"; Effort = "high"; Label = "claude-security-review" }
    architect = @{ Agent = "ifrim-claude-architect"; Model = "opus"; Effort = "high"; Label = "claude-architecture-review" }
    frontend = @{ Agent = "ifrim-claude-frontend-reviewer"; Model = "sonnet"; Effort = "medium"; Label = "claude-frontend-review" }
    parser = @{ Agent = "ifrim-claude-backend-reviewer"; Model = "sonnet"; Effort = "high"; Label = "claude-parser-review" }
    qa = @{ Agent = "ifrim-claude-qa-runner"; Model = "sonnet"; Effort = "high"; Label = "claude-qa-review" }
    desktop = @{ Agent = "ifrim-claude-desktop-packager"; Model = "opus"; Effort = "high"; Label = "claude-desktop-packaging-review" }
    implementer = @{ Agent = "ifrim-claude-implementer"; Model = "sonnet"; Effort = "high"; Label = "claude-implementation" }
    opus = @{ Agent = "ifrim-claude-opus-principal"; Model = "opus"; Effort = "high"; Label = "claude-opus-review" }
}

$selected = $profiles[$Profile]
if ($Profile -eq "implementer") {
    $prompt = "You are being invoked by Codex for IfrimDigital WhatsApp Delivery Counter. Implementation task: $Task. Do not read secrets. Do not commit or push. Apply the production implementation rule from CLAUDE.md."
}
else {
    $prompt = "You are being invoked by Codex for IfrimDigital WhatsApp Delivery Counter. Task: $Task. Do not edit files. Do not read secrets. Return findings with severity, file/line, evidence, impact, fix recipe, and verification command."
}

$rawOutput = & claude --agent $selected.Agent --model $selected.Model --effort $selected.Effort -p $prompt --output-format json
if ($LASTEXITCODE -ne 0) { throw "Claude Code exited with status $LASTEXITCODE" }

$resultText = $rawOutput
try {
    $parsed = $rawOutput | ConvertFrom-Json
    if ($parsed.result) { $resultText = $parsed.result }
}
catch {
    $resultText = $rawOutput
}

if (-not $NoReport) {
    $reportDir = Join-Path $projectRoot ".ifrim\AGENT_REPORTS"
    New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
    $timestamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
    $reportPath = Join-Path $reportDir "$timestamp-$($selected.Label).md"
    Set-Content -Path $reportPath -Value $resultText -Encoding UTF8
    Write-Output "Report saved: $reportPath"
}

Write-Output $resultText
