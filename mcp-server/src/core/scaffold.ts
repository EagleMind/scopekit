import * as path from 'path';
import { walkFiles } from './fsutil.js';
import { extractImportSpecifiers } from './imports.js';

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|vue|svelte|astro)$/;

function groupOf(file: string): string {
  const parts = file.split('/');
  if (parts.length <= 1) return '(root)';
  if (parts.length === 2) return parts[0];
  return parts[0] + '/' + parts[1];
}

/**
 * Pre-config analysis: seed candidate modules from the directory tree AND report the
 * real cross-group import edges, so Claude can refine boundaries from actual coupling
 * rather than directory names alone.
 */
export function scaffold(root: string): string {
  const code = walkFiles(root).filter(f => CODE_RE.test(f));
  if (!code.length) return 'No source files found under this root.';

  const fileset = new Set(code);
  const groups = new Map<string, string[]>();
  for (const f of code) {
    const g = groupOf(f);
    const arr = groups.get(g) ?? [];
    arr.push(f);
    groups.set(g, arr);
  }

  const edges = new Map<string, Map<string, number>>();
  const addEdge = (a: string, b: string) => {
    if (a === b) return;
    const m = edges.get(a) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    edges.set(a, m);
  };

  for (const f of code) {
    for (const spec of extractImportSpecifiers(path.join(root, f))) {
      if (!spec.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      const bases = [target, target.replace(/\.(js|jsx|mjs|cjs)$/, '')];
      const cand: string[] = [];
      for (const b of bases) {
        cand.push(b);
        for (const e of ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb']) cand.push(b + e);
        for (const x of ['index.ts', 'index.js', '__init__.py']) cand.push(path.posix.join(b, x));
      }
      const hit = cand.find(c => fileset.has(c));
      if (hit) addEdge(groupOf(f), groupOf(hit));
    }
  }

  const out: string[] = [];
  out.push('## Detected source groups (candidate modules)\n');
  out.push('```');
  let i = 1;
  for (const [g, fl] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`${g}/  (${fl.length} files)  → candidate MOD-${String(i).padStart(3, '0')}`);
    i++;
  }
  out.push('```\n');

  out.push('## Import edges between groups (real coupling — who depends on whom)\n');
  out.push('```');
  let any = false;
  for (const [a, m] of edges) for (const [b, n] of m) { out.push(`${a}  →  ${b}   (${n} imports)`); any = true; }
  if (!any) out.push('(no internal cross-group imports detected)');
  out.push('```\n');

  out.push('## Instructions for Claude\n');
  out.push(
    'Using the groups and the real import edges above, design the ScopeKit module breakdown:\n\n' +
    '1. Decide module boundaries. Merge groups that import each other heavily; split a group ' +
    'that owns unrelated concerns. The edges are ground truth — prefer them over directory names.\n' +
    '2. Write `AGENTS/scopekit.json` with one entry per module: `id`, `name`, and `globs` ' +
    '(do NOT hand-list every file — use globs like `src/auth/**`). Omit `deps`; they are derived from imports.\n' +
    '3. For each module, write `AGENTS/MOD-XXX.md` using the brief format: `## Contract`, ' +
    '`## Invariants`, `## Internal`. Keep it to anchored judgment — things the code cannot tell the reader. ' +
    'Anchor each claim with `@anchor path/to/file.ts` (or `@anchor file.ts::symbol`).\n' +
    '4. Run `scopekit verify` and fix every error before finishing.\n\n' +
    'If the codebase shows mixed concerns or unclear boundaries, say so explicitly and base the ' +
    'modules on what the structure should be.'
  );
  return out.join('\n');
}
