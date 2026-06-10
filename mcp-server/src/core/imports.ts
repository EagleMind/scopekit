import * as fs from 'fs';
import * as path from 'path';
import { ProjectModel } from './config.js';

const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const COMPONENT_EXT = ['.vue', '.svelte', '.astro'];

/** Extract raw import specifiers from a source file (best-effort, per language). */
export function extractImportSpecifiers(absFile: string): string[] {
  let src = '';
  try {
    src = fs.readFileSync(absFile, 'utf8');
  } catch {
    return [];
  }
  const specs: string[] = [];
  const ext = path.extname(absFile).toLowerCase();
  const push = (s?: string) => { if (s) specs.push(s.trim()); };

  if (JS_EXT.includes(ext) || COMPONENT_EXT.includes(ext)) {
    const re = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) push(m[1] || m[2] || m[3] || m[4]);
  } else if (ext === '.py') {
    const re = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w. ,]+))/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (m[1]) push(m[1]);
      if (m[2]) m[2].split(',').forEach(s => push(s.trim().split(/\s+/)[0]));
    }
  } else if (ext === '.go') {
    const block = /import\s*\(([\s\S]*?)\)/g;
    let b: RegExpExecArray | null;
    while ((b = block.exec(src))) {
      const r = /"([^"]+)"/g;
      let mm: RegExpExecArray | null;
      while ((mm = r.exec(b[1]))) push(mm[1]);
    }
    const single = /import\s+"([^"]+)"/g;
    let s: RegExpExecArray | null;
    while ((s = single.exec(src))) push(s[1]);
  } else if (ext === '.rb') {
    const re = /\brequire(?:_relative)?\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) push(m[1]);
  } else if (ext === '.rs') {
    const mods = /\bmod\s+(\w+)\s*;/g;
    let m: RegExpExecArray | null;
    while ((m = mods.exec(src))) push(m[1]);
  }
  return specs;
}

/** Resolve an internal import specifier to a project-relative file path, or null if external. */
export function resolveImport(spec: string, fromFile: string, model: ProjectModel): string | null {
  const fileset = new Set(model.files);
  const srcRoots = model.config.srcRoots ?? ['src'];
  let base: string | null = null;

  if (spec.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else if (spec.startsWith('@/')) {
    base = path.posix.join(srcRoots[0], spec.slice(2));
  } else if (srcRoots.some(r => spec === r || spec.startsWith(r + '/'))) {
    base = spec;
  } else if (/^[\w.]+$/.test(spec) && spec.includes('.') && !spec.startsWith('.')) {
    // Python dotted module path → filesystem path.
    base = spec.replace(/\./g, '/');
  } else {
    return null; // external package
  }
  if (!base) return null;

  const bases = [base];
  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  if (stripped !== base) bases.push(stripped);

  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.rs', '.vue', '.svelte'];
  const indexes = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', '__init__.py', 'mod.rs'];

  const candidates: string[] = [];
  for (const b of bases) {
    candidates.push(b);
    for (const e of exts) candidates.push(b + e);
    for (const f of indexes) candidates.push(path.posix.join(b, f));
  }
  for (const c of candidates) if (fileset.has(c)) return c;
  return null;
}

export interface DepGraph {
  /** moduleId → set of moduleIds it imports from. */
  derived: Map<string, Set<string>>;
}

export function buildDepGraph(root: string, model: ProjectModel): DepGraph {
  const derived = new Map<string, Set<string>>();
  for (const m of model.modules) derived.set(m.def.id, new Set());

  for (const m of model.modules) {
    for (const f of m.files) {
      for (const spec of extractImportSpecifiers(path.join(root, f))) {
        const target = resolveImport(spec, f, model);
        if (!target) continue;
        const owner = model.fileToModule.get(target);
        if (owner && owner !== m.def.id) derived.get(m.def.id)!.add(owner);
      }
    }
  }
  return { derived };
}

/** Effective deps = manual override if present, else import-derived. */
export function effectiveDeps(model: ProjectModel, graph: DepGraph, id: string): string[] {
  const def = model.config.modules.find(m => m.id === id);
  if (def?.deps) return def.deps;
  return [...(graph.derived.get(id) ?? [])];
}
