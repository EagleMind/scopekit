import { ProjectModel } from './config.js';
import { DepGraph, effectiveDeps } from './imports.js';
import { loadBrief } from './brief.js';
import { Invariant } from './types.js';

function fmt(list: Invariant[]): string {
  return list
    .map(i => `- ${i.text}${i.anchors.length ? `  → ${i.anchors.map(a => a.raw).join(', ')}` : ''}`)
    .join('\n');
}

function fileList(model: ProjectModel, id: string): string {
  const m = model.modules.find(x => x.def.id === id);
  return (m?.files ?? []).map(f => `  ${f}`).join('\n');
}

function transitive(id: string, model: ProjectModel, graph: DepGraph, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const out: string[] = [];
  for (const d of effectiveDeps(model, graph, id)) {
    if (!seen.has(d)) {
      out.push(d);
      out.push(...transitive(d, model, graph, seen));
    }
  }
  return out;
}

/**
 * Build scoped context for a module:
 *   - cheap one-line module map
 *   - primary module: derived file list + Contract + Invariants + Internal
 *   - each transitive dependency: Contract + Invariants only (never Internal)
 */
export function buildContext(root: string, model: ProjectModel, graph: DepGraph, id: string): string {
  const def = model.config.modules.find(m => m.id === id);
  if (!def) return `Module ${id} is not registered in AGENTS/scopekit.json.`;

  const parts: string[] = [];

  parts.push(`# ${model.config.project} — module map`);
  for (const m of model.config.modules) {
    parts.push(`${m.id === id ? '▶' : ' '} ${m.id}  ${m.name}`);
  }

  // Primary module — editable.
  parts.push(`\n---\n\n## ▶ ${id} — ${def.name}  (PRIMARY — you may edit these files)\n`);
  parts.push('### Files in scope');
  parts.push('```');
  parts.push(fileList(model, id) || "  (no files currently match this module's globs)");
  parts.push('```');

  const brief = loadBrief(root, id);
  if (brief) {
    if (brief.contract.length) {
      parts.push('\n### Contract (what other modules rely on)');
      parts.push(fmt(brief.contract));
    }
    if (brief.invariants.length) {
      parts.push('\n### Invariants (these silently break if ignored)');
      parts.push(fmt(brief.invariants));
    }
    if (brief.internal.length) {
      parts.push('\n### Internal notes');
      parts.push(fmt(brief.internal));
    }
  } else {
    parts.push(`\n_No brief authored yet — create AGENTS/${id}.md._`);
  }

  // Dependencies — read-only, contract surface only.
  const deps = transitive(id, model, graph);
  if (deps.length) {
    parts.push(`\n---\n\n## Dependencies (READ-ONLY context — do not edit these files)\n`);
    for (const d of deps) {
      const ddef = model.config.modules.find(m => m.id === d);
      const db = loadBrief(root, d);
      parts.push(`### ${d} — ${ddef?.name ?? ''}`);
      if (db && (db.contract.length || db.invariants.length)) {
        if (db.contract.length) {
          parts.push('Contract:');
          parts.push(fmt(db.contract));
        }
        if (db.invariants.length) {
          parts.push('Respect these invariants:');
          parts.push(fmt(db.invariants));
        }
      } else {
        parts.push('_(no contract documented)_');
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}
