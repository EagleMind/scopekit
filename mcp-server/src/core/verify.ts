import * as fs from 'fs';
import * as path from 'path';
import { ProjectModel } from './config.js';
import { DepGraph } from './imports.js';
import { loadBrief } from './brief.js';
import { matchGlob } from './fsutil.js';

export interface Finding {
  level: 'error' | 'warn' | 'info';
  msg: string;
}

/**
 * Verify briefs against the live codebase. Errors fail CI:
 *   - a glob matches no files (dead scope)
 *   - an @anchor points at a missing file or symbol (stale claim)
 * Warnings/info surface drift without failing.
 */
export function verify(root: string, model: ProjectModel, graph: DepGraph): Finding[] {
  const f: Finding[] = [];
  const fileset = new Set(model.files);

  // 1. Dead globs.
  for (const def of model.config.modules) {
    for (const g of def.globs) {
      if (!model.files.some(file => matchGlob(g, file))) {
        f.push({ level: 'error', msg: `${def.id}: glob "${g}" matches no files.` });
      }
    }
  }

  // 2. Overlapping ownership.
  for (const o of model.overlaps) {
    f.push({ level: 'warn', msg: `${o.file} is claimed by multiple modules: ${o.modules.join(', ')}.` });
  }

  // 3. Anchors must resolve — this is the staleness defense.
  for (const def of model.config.modules) {
    const b = loadBrief(root, def.id);
    if (!b) {
      f.push({ level: 'warn', msg: `${def.id}: no brief file (AGENTS/${def.id}.md).` });
      continue;
    }
    for (const inv of [...b.contract, ...b.invariants, ...b.internal]) {
      for (const a of inv.anchors) {
        const abs = path.join(root, a.file);
        if (!fileset.has(a.file) && !fs.existsSync(abs)) {
          f.push({ level: 'error', msg: `${def.id}: anchor file "${a.file}" does not exist — claim may be stale: "${inv.text}"` });
          continue;
        }
        if (a.symbol) {
          let src = '';
          try { src = fs.readFileSync(abs, 'utf8'); } catch { /* unreadable */ }
          if (!src.includes(a.symbol)) {
            f.push({ level: 'error', msg: `${def.id}: symbol "${a.symbol}" not found in ${a.file} — claim may be stale: "${inv.text}"` });
          }
        }
      }
    }
  }

  // 4. Declared deps vs. real imports (only when deps are manually declared).
  for (const def of model.config.modules) {
    if (!def.deps) continue;
    const declared = new Set(def.deps);
    const real = graph.derived.get(def.id) ?? new Set<string>();
    for (const r of real) {
      if (!declared.has(r)) {
        f.push({ level: 'warn', msg: `${def.id}: imports ${r} but does not declare it in deps.` });
      }
    }
    for (const d of declared) {
      if (!real.has(d)) {
        f.push({ level: 'info', msg: `${def.id}: declares dep ${d} but no import was found (runtime-only?).` });
      }
    }
  }

  return f;
}
