#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ScopeKit — Bootstrap the scoped agent system in any project
#
# Usage:
#   ./setup.sh "My Project"
#   ./setup.sh               # defaults to current directory name
#
# What it does:
#   1. Creates the AGENTS/ directory
#   2. Copies INDEX.md.template → AGENTS/INDEX.md  (with project name substituted)
#   3. Copies MODULE-CHECKLIST.md into AGENTS/
#
# Module files are NOT generated — run scopekit_scaffold via the MCP server
# to have Claude analyze your codebase and create them automatically.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "$SCRIPT_DIR/../templates" && pwd)"

PROJECT_NAME="${1:-$(basename "$PWD")}"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ScopeKit — Scoped Agent System Setup   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Create AGENTS/ directory ──────────────────────────────────────────────
mkdir -p AGENTS
echo "✓ Created AGENTS/"

# ── 2. Scaffold INDEX.md ──────────────────────────────────────────────────────
INDEX_DEST="AGENTS/INDEX.md"
if [ -f "$INDEX_DEST" ]; then
  echo "⚠  AGENTS/INDEX.md already exists — skipping (won't overwrite)"
else
  sed "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" "$TEMPLATE_DIR/INDEX.md.template" \
    | sed 's/{{MODULE_TABLE_ROWS}}/| MOD-001 | (fill in) | `MOD-001.md` | `src\/` |/' \
    | sed 's/{{DEPENDENCY_GRAPH}}/(fill in after running scopekit_scaffold)/' \
    | sed 's/{{FOUNDATIONAL_MODULES}}/(fill in)/' \
    | sed 's/{{SHARED_CONTRACTS}}/| (file) | (why it matters) |/' \
    | sed 's/{{CUSTOM_RULE_1}}/Add project-specific rule here/' \
    | sed 's/{{CUSTOM_RULE_2}}/Add project-specific rule here/' \
    > "$INDEX_DEST"
  echo "✓ Created AGENTS/INDEX.md"
fi

# ── 3. Copy checklist ─────────────────────────────────────────────────────────
CHECKLIST_DEST="AGENTS/MODULE-CHECKLIST.md"
if [ ! -f "$CHECKLIST_DEST" ]; then
  cp "$TEMPLATE_DIR/MODULE-CHECKLIST.md" "$CHECKLIST_DEST"
  echo "✓ Copied MODULE-CHECKLIST.md"
fi

# ── 4. Print next steps ───────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────"
echo " Next steps"
echo "─────────────────────────────────────────"
echo ""
echo "  1. Connect the ScopeKit MCP server to your AI client"
echo "     (see the ScopeKit README for config)"
echo ""
echo "  2. Tell Claude:"
echo '     "Run scopekit_scaffold to analyze this project and create the module files."'
echo ""
echo "     Claude will walk the codebase, propose module boundaries,"
echo "     and write the MOD-XXX.md files and INDEX.md for you."
echo ""
echo "  3. Review and adjust the generated briefs."
echo "     Use AGENTS/MODULE-CHECKLIST.md as a guide."
echo ""
echo "─────────────────────────────────────────"
echo " Done! AGENTS/ is ready for scaffolding."
echo "─────────────────────────────────────────"
echo ""
