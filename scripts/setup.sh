#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ScopeKit — Bootstrap the scoped agent system in any project
#
# Usage:
#   ./setup.sh "My Project" 5
#   ./setup.sh "My Project"        # defaults to 5 modules
#
# What it does:
#   1. Creates the AGENTS/ directory
#   2. Copies INDEX.md.template → AGENTS/INDEX.md  (with project name substituted)
#   3. Creates stub MOD-XXX.md files for each module
#   4. Prints next steps
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "$SCRIPT_DIR/../templates" && pwd)"

PROJECT_NAME="${1:-My Project}"
NUM_MODULES="${2:-5}"

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
    | sed 's/{{MODULE_TABLE_ROWS}}/| MOD-001 | Module One | `MOD-001.md` | `src\/` |/' \
    | sed 's/{{DEPENDENCY_GRAPH}}/MOD-001 (no deps yet)/' \
    | sed 's/{{FOUNDATIONAL_MODULES}}/**MOD-001**/' \
    | sed 's/{{SHARED_CONTRACTS}}/| `src\/types.ts` | Shared interfaces |/' \
    | sed 's/{{CUSTOM_RULE_1}}/Add project-specific rule here/' \
    | sed 's/{{CUSTOM_RULE_2}}/Add project-specific rule here/' \
    > "$INDEX_DEST"
  echo "✓ Created AGENTS/INDEX.md"
fi

# ── 3. Create stub module files ───────────────────────────────────────────────
for i in $(seq 1 "$NUM_MODULES"); do
  ID=$(printf "MOD-%03d" "$i")
  DEST="AGENTS/$ID.md"
  if [ -f "$DEST" ]; then
    echo "⚠  $DEST already exists — skipping"
    continue
  fi
  sed "s/{{MODULE_ID}}/$ID/g" "$TEMPLATE_DIR/MODULE.md.template" \
    | sed "s/{{MODULE_NAME}}/Module $i/" \
    | sed "s/{{AGENT_NUMBER}}/$i/" \
    | sed 's/{{DEPENDENCIES}}/[]/' \
    > "$DEST"
  echo "✓ Created $DEST"
done

# ── 4. Copy checklist ─────────────────────────────────────────────────────────
CHECKLIST_DEST="AGENTS/MODULE-CHECKLIST.md"
if [ ! -f "$CHECKLIST_DEST" ]; then
  cp "$TEMPLATE_DIR/MODULE-CHECKLIST.md" "$CHECKLIST_DEST"
  echo "✓ Copied MODULE-CHECKLIST.md"
fi

# ── 5. Print next steps ───────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────"
echo " Next steps"
echo "─────────────────────────────────────────"
echo ""
echo "  1. Edit AGENTS/INDEX.md:"
echo "     • Replace placeholder module names with your actual modules"
echo "     • Draw the dependency graph"
echo "     • List your shared contract files"
echo "     • Add project-specific agent rules"
echo ""
echo "  2. Fill in each AGENTS/MOD-XXX.md:"
echo "     • List the files in scope"
echo "     • Describe what the module does"
echo "     • Document key constraints"
echo "     • Consult AGENTS/MODULE-CHECKLIST.md as you write"
echo ""
echo "  3. Trigger a scoped edit:"
echo "     Tell Claude: \"MOD-002: add feature X\""
echo ""
echo "─────────────────────────────────────────"
echo " Done! Your AGENTS/ directory is ready."
echo "─────────────────────────────────────────"
echo ""
