# ─────────────────────────────────────────────────────────────────────────────
# ScopeKit — Bootstrap the scoped agent system in any project (PowerShell)
#
# Usage:
#   .\setup.ps1 -ProjectName "My Project"
#   .\setup.ps1                            # defaults to current directory name
#
# What it does:
#   1. Creates the AGENTS/ directory
#   2. Copies INDEX.md.template → AGENTS/INDEX.md  (with project name substituted)
#   3. Copies MODULE-CHECKLIST.md into AGENTS/
#
# Module files are NOT generated — run scopekit_scaffold via the MCP server
# to have Claude analyze your codebase and create them automatically.
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$ProjectName = (Split-Path -Leaf (Get-Location))
)

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$TemplateDir = Join-Path $ScriptDir "..\templates"
$AgentsDir   = "AGENTS"

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗"
Write-Host "║   ScopeKit — Scoped Agent System Setup   ║"
Write-Host "╚══════════════════════════════════════════╝"
Write-Host ""

# ── 1. Create AGENTS/ directory ──────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $AgentsDir | Out-Null
Write-Host "✓ Created $AgentsDir/"

# ── 2. Scaffold INDEX.md ──────────────────────────────────────────────────────
$IndexDest = Join-Path $AgentsDir "INDEX.md"
if (Test-Path $IndexDest) {
    Write-Host "⚠  AGENTS/INDEX.md already exists — skipping (won't overwrite)"
} else {
    $IndexTemplate = Get-Content (Join-Path $TemplateDir "INDEX.md.template") -Raw
    $IndexContent  = $IndexTemplate `
        -replace '\{\{PROJECT_NAME\}\}',        $ProjectName `
        -replace '\{\{MODULE_TABLE_ROWS\}\}',   '| MOD-001 | (fill in) | `MOD-001.md` | `src/` |' `
        -replace '\{\{DEPENDENCY_GRAPH\}\}',    '(fill in after running scopekit_scaffold)' `
        -replace '\{\{FOUNDATIONAL_MODULES\}\}','(fill in)' `
        -replace '\{\{SHARED_CONTRACTS\}\}',    '| (file) | (why it matters) |' `
        -replace '\{\{CUSTOM_RULE_1\}\}',       'Add project-specific rule here' `
        -replace '\{\{CUSTOM_RULE_2\}\}',       'Add project-specific rule here'
    Set-Content -Path $IndexDest -Value $IndexContent -Encoding utf8
    Write-Host "✓ Created AGENTS/INDEX.md"
}

# ── 3. Copy checklist ─────────────────────────────────────────────────────────
$ChecklistDest = Join-Path $AgentsDir "MODULE-CHECKLIST.md"
if (-not (Test-Path $ChecklistDest)) {
    Copy-Item (Join-Path $TemplateDir "MODULE-CHECKLIST.md") $ChecklistDest
    Write-Host "✓ Copied MODULE-CHECKLIST.md"
}

# ── 4. Print next steps ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "-----------------------------------------"
Write-Host " Next steps"
Write-Host "-----------------------------------------"
Write-Host ""
Write-Host "  1. Connect the ScopeKit MCP server to your AI client"
Write-Host "     (see the ScopeKit README for config)"
Write-Host ""
Write-Host "  2. Tell Claude:"
Write-Host '     "Run scopekit_scaffold to analyze this project and create the module files."'
Write-Host ""
Write-Host "     Claude will walk the codebase, propose module boundaries,"
Write-Host "     and write the MOD-XXX.md files and INDEX.md for you."
Write-Host ""
Write-Host "  3. Review and adjust the generated briefs."
Write-Host "     Use AGENTS/MODULE-CHECKLIST.md as a guide."
Write-Host ""
Write-Host "-----------------------------------------"
Write-Host " Done! AGENTS/ is ready for scaffolding."
Write-Host "-----------------------------------------"
Write-Host ""
