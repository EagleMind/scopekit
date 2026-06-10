# ─────────────────────────────────────────────────────────────────────────────
# ScopeKit — Bootstrap the scoped agent system in any project (PowerShell)
#
# Usage:
#   .\setup.ps1 -ProjectName "My Project" -NumModules 5
#   .\setup.ps1 "My Project"          # NumModules defaults to 5
#   .\setup.ps1                       # all defaults
#
# What it does:
#   1. Creates the AGENTS/ directory
#   2. Copies INDEX.md.template → AGENTS/INDEX.md  (with project name substituted)
#   3. Creates stub MOD-XXX.md files for each module
#   4. Prints next steps
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$ProjectName = "My Project",
    [int]$NumModules = 5
)

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$TemplateDir  = Join-Path $ScriptDir "..\templates"
$AgentsDir    = "AGENTS"

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
        -replace '\{\{PROJECT_NAME\}\}',       $ProjectName `
        -replace '\{\{MODULE_TABLE_ROWS\}\}',  '| MOD-001 | Module One | `MOD-001.md` | `src/` |' `
        -replace '\{\{DEPENDENCY_GRAPH\}\}',   'MOD-001 (no deps yet)' `
        -replace '\{\{FOUNDATIONAL_MODULES\}\}','**MOD-001**' `
        -replace '\{\{SHARED_CONTRACTS\}\}',   '| `src/types.ts` | Shared interfaces |' `
        -replace '\{\{CUSTOM_RULE_1\}\}',      'Add project-specific rule here' `
        -replace '\{\{CUSTOM_RULE_2\}\}',      'Add project-specific rule here'
    Set-Content -Path $IndexDest -Value $IndexContent -Encoding utf8
    Write-Host "✓ Created AGENTS/INDEX.md"
}

# ── 3. Create stub module files ───────────────────────────────────────────────
$ModuleTemplate = Get-Content (Join-Path $TemplateDir "MODULE.md.template") -Raw

for ($i = 1; $i -le $NumModules; $i++) {
    $Id   = "MOD-{0:D3}" -f $i
    $Dest = Join-Path $AgentsDir "$Id.md"
    if (Test-Path $Dest) {
        Write-Host "⚠  $Dest already exists — skipping"
        continue
    }
    $Content = $ModuleTemplate `
        -replace '\{\{MODULE_ID\}\}',     $Id `
        -replace '\{\{MODULE_NAME\}\}',   "Module $i" `
        -replace '\{\{AGENT_NUMBER\}\}',  $i `
        -replace '\{\{DEPENDENCIES\}\}',  '[]'
    Set-Content -Path $Dest -Value $Content -Encoding utf8
    Write-Host "✓ Created $Dest"
}

# ── 4. Copy checklist ─────────────────────────────────────────────────────────
$ChecklistDest = Join-Path $AgentsDir "MODULE-CHECKLIST.md"
if (-not (Test-Path $ChecklistDest)) {
    Copy-Item (Join-Path $TemplateDir "MODULE-CHECKLIST.md") $ChecklistDest
    Write-Host "✓ Copied MODULE-CHECKLIST.md"
}

# ── 5. Print next steps ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "-----------------------------------------"
Write-Host " Next steps"
Write-Host "-----------------------------------------"
Write-Host ""
Write-Host "  1. Edit AGENTS/INDEX.md:"
Write-Host "     - Replace placeholder module names with your actual modules"
Write-Host "     - Draw the dependency graph"
Write-Host "     - List your shared contract files"
Write-Host "     - Add project-specific agent rules"
Write-Host ""
Write-Host "  2. Fill in each AGENTS/MOD-XXX.md:"
Write-Host "     - List the files in scope"
Write-Host "     - Describe what the module does"
Write-Host "     - Document key constraints"
Write-Host "     - Use AGENTS/MODULE-CHECKLIST.md as you write"
Write-Host ""
Write-Host "  3. Trigger a scoped edit:"
Write-Host '     Tell Claude: "MOD-002: add feature X"'
Write-Host ""
Write-Host "-----------------------------------------"
Write-Host " Done! Your AGENTS/ directory is ready."
Write-Host "-----------------------------------------"
Write-Host ""
