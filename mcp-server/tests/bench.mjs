#!/usr/bin/env node
/**
 * ScopeKit Token Efficiency Benchmark
 *
 * Measures context token usage across four strategies when an AI prepares to
 * edit a single module, across three project sizes.
 *
 *   Strategy 1 — Naive full-dump:  every source file (what repomix / @codebase tools do)
 *   Strategy 2 — Module-src:       only the files in the target module
 *   Strategy 3 — Module + dep-src: module files + full source of its dependencies
 *   Strategy 4 — ScopeKit:         module brief + dep contracts (what this tool injects)
 *
 * Token estimation: cl100k_base ≈ 3.5 chars / token for source code.
 * (Validated against tiktoken on TypeScript; ±5 % for typical codebases.)
 *
 * Usage:
 *   cd mcp-server
 *   npm run build
 *   node tests/bench.mjs
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir   = path.resolve(__dirname, '..', 'dist');

// ── Load ScopeKit from built dist ─────────────────────────────────────────
// Use pathToFileURL for Windows compatibility (import() needs file:// URLs).

import { pathToFileURL } from 'url';

let loadAll, buildContext, walkFiles;
try {
  ({ loadAll }       = await import(pathToFileURL(path.join(distDir, 'core', 'load.js')).href));
  ({ buildContext }  = await import(pathToFileURL(path.join(distDir, 'core', 'context.js')).href));
  ({ walkFiles }     = await import(pathToFileURL(path.join(distDir, 'core', 'fsutil.js')).href));
} catch (e) {
  console.error('ERROR: dist/ not found. Run  npm run build  first.\n', e.message);
  process.exit(1);
}

// ── Token estimation ───────────────────────────────────────────────────────

const CPT = 3.5; // chars per token — cl100k_base on code
function tok(text) { return Math.round(text.length / CPT); }

// ── Helpers ────────────────────────────────────────────────────────────────

function srcFiles(root) {
  return walkFiles(root).filter(f =>
    /\.(ts|tsx|js|jsx|py|go|rb|rs|vue|svelte)$/.test(f)
  );
}

function readSrc(root, file) {
  try { return fs.readFileSync(path.join(root, file), 'utf-8'); } catch { return ''; }
}

function write(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// ── Context strategies ─────────────────────────────────────────────────────

/** Strategy 1: Naive — all source files concatenated (repomix / @codebase style) */
function strategy_naive(root) {
  return srcFiles(root)
    .map(f => `### ${f}\n\`\`\`typescript\n${readSrc(root, f)}\n\`\`\``)
    .join('\n\n');
}

/** Strategy 2: Module source — only the files inside the target module */
function strategy_mod_src(root, moduleId) {
  const { model } = loadAll(root);
  if (!model) return '';
  const mod = model.modules.find(m => m.def.id === moduleId);
  return (mod?.files ?? [])
    .map(f => `### ${f}\n${readSrc(root, f)}`)
    .join('\n\n');
}

/** Strategy 3: Module source + full source of every dependency module */
function strategy_mod_plus_deps(root, moduleId) {
  const { model, graph } = loadAll(root);
  if (!model || !graph) return '';

  function transitive(id, seen = new Set()) {
    if (seen.has(id)) return [];
    seen.add(id);
    const out = [];
    const deps = graph.derived.get(id) ?? new Set();
    for (const d of deps) { out.push(d); out.push(...transitive(d, seen)); }
    return out;
  }

  const ids = [moduleId, ...transitive(moduleId)];
  const parts = [];
  for (const id of ids) {
    const m = model.modules.find(x => x.def.id === id);
    if (!m) continue;
    for (const f of m.files) {
      parts.push(`### ${f}\n${readSrc(root, f)}`);
    }
  }
  return parts.join('\n\n');
}

/** Strategy 4: ScopeKit — module brief + file-list + transitive dep contracts */
function strategy_scopekit(root, moduleId) {
  const { model, graph } = loadAll(root);
  if (!model || !graph) return 'ERROR: no AGENTS/scopekit.json found';
  return buildContext(root, model, graph, moduleId);
}

// ── Benchmark runner ───────────────────────────────────────────────────────

function bench(label, root, targetModule) {
  const all = srcFiles(root);
  const { model } = loadAll(root);
  const mod = model?.modules.find(m => m.def.id === targetModule);

  const c = {
    naive:   strategy_naive(root),
    modSrc:  strategy_mod_src(root, targetModule),
    modDeps: strategy_mod_plus_deps(root, targetModule),
    sk:      strategy_scopekit(root, targetModule),
  };

  return {
    label,
    totalFiles: all.length,
    modFiles:   mod?.files.length ?? 0,
    T: { naive: tok(c.naive), modSrc: tok(c.modSrc), modDeps: tok(c.modDeps), sk: tok(c.sk) },
  };
}

// ── Output ─────────────────────────────────────────────────────────────────

function fmt(n)         { return n.toLocaleString('en-US'); }
function pct(n, base)   { const r = (base - n) / base * 100; return `-${r.toFixed(0)}%`; }
function ratio(n, base) { return `${(base / Math.max(n, 1)).toFixed(1)}×`; }

function printResult(r) {
  const { T } = r;
  const W = 34;
  console.log(`\n  ┌─ ${r.label}`);
  console.log(`  │  ${r.totalFiles} source files · target module: ${r.modFiles} file(s)\n  │`);
  const hdr = `  │  ${'Strategy'.padEnd(W)} ${'Tokens'.padStart(9)}  ${'vs naive'.padStart(9)}  ${'savings'.padStart(8)}  Dep contracts?`;
  const sep = `  │  ${'─'.repeat(W + 41)}`;
  console.log(hdr);
  console.log(sep);

  const rows = [
    ['Full codebase dump (naive)',   T.naive,   '—',            '1.0×',             '✗  (buried in noise)'],
    ['Module files only',            T.modSrc,  pct(T.modSrc,  T.naive), ratio(T.modSrc,  T.naive), '✗  (missing)'],
    ['Module + dep source files',    T.modDeps, pct(T.modDeps, T.naive), ratio(T.modDeps, T.naive), '✗  (full noise)'],
    ['ScopeKit (brief + contracts)', T.sk,      pct(T.sk,      T.naive), ratio(T.sk,      T.naive), '✓  (structured)'],
  ];

  for (const [name, t, p, rx, deps] of rows) {
    console.log(`  │  ${name.padEnd(W)} ${fmt(t).padStart(9)}  ${p.padStart(9)}  ${rx.padStart(8)}  ${deps}`);
  }
  console.log(`  └${'─'.repeat(W + 45)}`);
}

function printMarkdown(results) {
  // Use short labels for table columns
  const shortLabels = results.map(r => {
    const m = r.label.match(/(\d+) modules.*?(\d+)[,\s]+files.*?~(\d[\d,]+)\s*LOC/);
    return m ? `${m[2]} files / ~${m[3]} LOC` : r.label.slice(0, 30);
  });

  console.log('\n\n───────────────────────────────────────────────────────────────');
  console.log('  Markdown table (paste into README)');
  console.log('───────────────────────────────────────────────────────────────\n');

  const colW = 30;
  console.log(`| ${'Strategy'.padEnd(colW)} | ${shortLabels.join(' | ')} |`);
  console.log(`| ${':'.padEnd(colW, '-')} | ${shortLabels.map(l => ':'.padEnd(l.length, '-')).join(' | ')} |`);

  const rows = [
    ['Full codebase dump',           r => r.T.naive,   false],
    ['Module files only',            r => r.T.modSrc,  false],
    ['Module + dep source files',    r => r.T.modDeps, false],
    ['**ScopeKit** ← this tool',     r => r.T.sk,      true ],
  ];

  for (const [name, getter, highlight] of rows) {
    const cells = results.map(r => {
      const t = getter(r);
      const base = r.T.naive;
      if (t === base) return `${fmt(t)} tok`;
      const rx = ratio(t, base);
      const reduction = pct(t, base);
      return highlight
        ? `**${fmt(t)} tok** (**${rx} smaller**)`
        : `${fmt(t)} tok (${reduction})`;
    });
    console.log(`| ${name.padEnd(colW)} | ${cells.join(' | ')} |`);
  }

  console.log('');
  console.log('> Token estimates: cl100k\\_base ≈ 3.5 chars / token (standard for TypeScript/Python code).');
  console.log('> ScopeKit context = module map + brief (Contract / Invariants / Internal) + transitive dep contracts.');
  console.log('> The AI still reads target module files directly; ScopeKit *replaces* reading dep source with structured contracts.');
}

// ══════════════════════════════════════════════════════════════════════════
//  Synthetic project generator
// ══════════════════════════════════════════════════════════════════════════

// Generates realistic TypeScript content. All generators return a string of
// approximately `n` lines so token counts are meaningful.

function genService(domain, deps, n) {
  const D = domain[0].toUpperCase() + domain.slice(1);
  const lines = [
    `import { http } from '../api/client.js';`,
    ...deps.map(d => `import { ${d[0].toUpperCase()+d.slice(1)}Service } from '../${d}/${d}.service.js';`),
    `import type { ${D}Item, ${D}CreateInput, ${D}UpdateInput } from './${domain}.types.js';`,
    `import { logger } from '../utils/logger.js';`,
    ``,
    `export class ${D}Service {`,
    `  private cache = new Map<string, ${D}Item>();`,
    `  private subs: Array<(items: ${D}Item[]) => void> = [];`,
    ``,
    `  constructor(`,
    ...deps.map(d => `    private readonly ${d}: ${d[0].toUpperCase()+d.slice(1)}Service,`),
    `  ) {}`,
    ``,
    `  async getAll(force = false): Promise<${D}Item[]> {`,
    `    if (!force && this.cache.size > 0) return Array.from(this.cache.values());`,
    `    logger.debug('${domain}.getAll');`,
    `    const items = await http.get<${D}Item[]>('/api/${domain}s');`,
    `    this.cache.clear();`,
    `    for (const i of items) this.cache.set(i.id, i);`,
    `    this.notify();`,
    `    return items;`,
    `  }`,
    ``,
    `  async getById(id: string): Promise<${D}Item> {`,
    `    if (this.cache.has(id)) return this.cache.get(id)!;`,
    `    const item = await http.get<${D}Item>(\`/api/${domain}s/\${id}\`);`,
    `    this.cache.set(id, item);`,
    `    return item;`,
    `  }`,
    ``,
    `  async create(input: ${D}CreateInput): Promise<${D}Item> {`,
    `    this.validate(input);`,
    `    const item = await http.post<${D}Item>('/api/${domain}s', input);`,
    `    this.cache.set(item.id, item);`,
    `    this.notify();`,
    `    logger.info('${domain}.created', { id: item.id });`,
    `    return item;`,
    `  }`,
    ``,
    `  async update(id: string, patch: ${D}UpdateInput): Promise<${D}Item> {`,
    `    const existing = await this.getById(id);`,
    `    const merged = { ...existing, ...patch };`,
    `    this.validate(merged as ${D}CreateInput);`,
    `    const updated = await http.patch<${D}Item>(\`/api/${domain}s/\${id}\`, patch);`,
    `    this.cache.set(id, updated);`,
    `    this.notify();`,
    `    return updated;`,
    `  }`,
    ``,
    `  async remove(id: string): Promise<void> {`,
    `    await http.delete(\`/api/${domain}s/\${id}\`);`,
    `    this.cache.delete(id);`,
    `    this.notify();`,
    `    logger.info('${domain}.removed', { id });`,
    `  }`,
    ``,
    `  subscribe(fn: (items: ${D}Item[]) => void): () => void {`,
    `    this.subs.push(fn);`,
    `    return () => { this.subs = this.subs.filter(s => s !== fn); };`,
    `  }`,
    ``,
    `  private notify() { const items = Array.from(this.cache.values()); this.subs.forEach(f => f(items)); }`,
    ``,
    `  private validate(input: ${D}CreateInput): void {`,
    `    if (!input.name?.trim()) throw new Error(\`${D}: name is required\`);`,
    `  }`,
    ``,
    `  clearCache(): void { this.cache.clear(); }`,
    `  getCached(id: string): ${D}Item | undefined { return this.cache.get(id); }`,
    `  isLoading = false;`,
    `}`,
    ``,
    `export function create${D}Service(...args: ConstructorParameters<typeof ${D}Service>) {`,
    `  return new ${D}Service(...args);`,
    `}`,
  ];
  // Pad with realistic helpers
  let i = 0;
  while (lines.length < n) {
    i++;
    lines.push(
      ``, `export async function search${D}s(q: string, page = 1, limit = 20) {`,
      `  const p = new URLSearchParams({ q, page: String(page), limit: String(limit) });`,
      `  return http.get<{ items: ${D}Item[]; total: number }>(\`/api/${domain}s/search?\${p}\`);`,
      `}`,
      ``, `export async function bulk${D}Delete(ids: string[]) {`,
      `  await http.post('/api/${domain}s/bulk-delete', { ids });`,
      `}`,
    );
  }
  return lines.slice(0, n).join('\n');
}

function genTypes(domain, n) {
  const D = domain[0].toUpperCase() + domain.slice(1);
  const lines = [
    `/** ${domain} domain types */`,
    ``,
    `export interface ${D}Item {`,
    `  id: string;`,
    `  name: string;`,
    `  description: string;`,
    `  status: ${D}Status;`,
    `  tags: string[];`,
    `  metadata: Record<string, unknown>;`,
    `  createdAt: string;`,
    `  updatedAt: string;`,
    `  createdBy: string;`,
    `}`,
    ``,
    `export type ${D}Status = 'active' | 'inactive' | 'pending' | 'archived';`,
    ``,
    `export interface ${D}CreateInput {`,
    `  name: string;`,
    `  description?: string;`,
    `  status?: ${D}Status;`,
    `  tags?: string[];`,
    `  metadata?: Record<string, unknown>;`,
    `}`,
    ``,
    `export interface ${D}UpdateInput extends Partial<${D}CreateInput> {}`,
    ``,
    `export interface ${D}Filter {`,
    `  status?: ${D}Status;`,
    `  tags?: string[];`,
    `  search?: string;`,
    `  createdAfter?: string;`,
    `  createdBefore?: string;`,
    `}`,
    ``,
    `export interface ${D}ListResult {`,
    `  items: ${D}Item[];`,
    `  total: number;`,
    `  page: number;`,
    `  pageSize: number;`,
    `  hasMore: boolean;`,
    `}`,
    ``,
    `export function is${D}Item(v: unknown): v is ${D}Item {`,
    `  return typeof v === 'object' && v !== null && 'id' in v && 'name' in v;`,
    `}`,
    ``,
    `export type ${D}Id = string & { readonly __brand: '${D}Id' };`,
    `export const as${D}Id = (id: string): ${D}Id => id as ${D}Id;`,
  ];
  while (lines.length < n) {
    const k = lines.length;
    lines.push(``, `export type ${D}Field${k} = keyof ${D}Item;`);
    lines.push(`export type ${D}Partial${k} = Partial<${D}Item>;`);
  }
  return lines.slice(0, n).join('\n');
}

function genStore(domain, n) {
  const D = domain[0].toUpperCase() + domain.slice(1);
  const lines = [
    `import type { ${D}Item, ${D}Filter } from './${domain}.types.js';`,
    `import { ${D}Service } from './${domain}.service.js';`,
    ``,
    `const STALE_MS = 5 * 60 * 1_000;`,
    ``,
    `interface State {`,
    `  items: Map<string, ${D}Item>;`,
    `  selected: string | null;`,
    `  filter: ${D}Filter;`,
    `  loading: boolean;`,
    `  error: string | null;`,
    `  lastFetched: number | null;`,
    `}`,
    ``,
    `export class ${D}Store {`,
    `  private s: State = { items: new Map(), selected: null, filter: {},`,
    `                        loading: false, error: null, lastFetched: null };`,
    ``,
    `  constructor(private readonly svc: ${D}Service) {}`,
    ``,
    `  async load(filter?: ${D}Filter): Promise<void> {`,
    `    if (filter) this.s.filter = filter;`,
    `    if (this.s.lastFetched && Date.now() - this.s.lastFetched < STALE_MS) return;`,
    `    this.s.loading = true;`,
    `    try {`,
    `      const items = await this.svc.getAll(true);`,
    `      this.s.items = new Map(items.map(i => [i.id, i]));`,
    `      this.s.lastFetched = Date.now();`,
    `      this.s.error = null;`,
    `    } catch (err) {`,
    `      this.s.error = err instanceof Error ? err.message : 'Load failed';`,
    `    } finally {`,
    `      this.s.loading = false;`,
    `    }`,
    `  }`,
    ``,
    `  getAll(): ${D}Item[] {`,
    `    return Array.from(this.s.items.values()).filter(i => this.matches(i));`,
    `  }`,
    ``,
    `  getById(id: string): ${D}Item | undefined { return this.s.items.get(id); }`,
    `  select(id: string | null): void { this.s.selected = id; }`,
    `  getSelected(): ${D}Item | undefined {`,
    `    return this.s.selected ? this.s.items.get(this.s.selected) : undefined;`,
    `  }`,
    `  setFilter(f: ${D}Filter): void { this.s.filter = f; }`,
    `  isLoading(): boolean { return this.s.loading; }`,
    `  hasError(): boolean  { return this.s.error !== null; }`,
    `  getError(): string | null { return this.s.error; }`,
    ``,
    `  private matches(item: ${D}Item): boolean {`,
    `    const { status, search } = this.s.filter;`,
    `    if (status && item.status !== status) return false;`,
    `    if (search) {`,
    `      const q = search.toLowerCase();`,
    `      return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);`,
    `    }`,
    `    return true;`,
    `  }`,
    `}`,
    ``,
    `export const create${D}Store = (svc: ${D}Service) => new ${D}Store(svc);`,
  ];
  while (lines.length < n) lines.push(`// ${D}Store utility ${lines.length}`);
  return lines.slice(0, n).join('\n');
}

function genComponent(compName, domain, importDomains, n) {
  const D = domain[0].toUpperCase() + domain.slice(1);
  const lines = [
    `import React, { useState, useEffect, useCallback } from 'react';`,
    ...importDomains.map(d => `import { ${d[0].toUpperCase()+d.slice(1)}Store } from '../${d}/${d}.store.js';`),
    `import type { ${D}Item } from '../${domain}/${domain}.types.js';`,
    ``,
    `interface ${compName}Props {`,
    `  store: ${D}Store;`,
    `  onSelect?: (item: ${D}Item) => void;`,
    `  onClose?: () => void;`,
    `  className?: string;`,
    `}`,
    ``,
    `export const ${compName}: React.FC<${compName}Props> = ({`,
    `  store, onSelect, onClose, className = ''`,
    `}) => {`,
    `  const [items, setItems]   = useState<${D}Item[]>([]);`,
    `  const [loading, setLoading] = useState(false);`,
    `  const [error, setError]   = useState<string | null>(null);`,
    `  const [search, setSearch] = useState('');`,
    ``,
    `  useEffect(() => {`,
    `    let mounted = true;`,
    `    setLoading(true);`,
    `    store.load().then(() => {`,
    `      if (mounted) { setItems(store.getAll()); setLoading(false); }`,
    `    }).catch(err => {`,
    `      if (mounted) { setError(err.message); setLoading(false); }`,
    `    });`,
    `    return () => { mounted = false; };`,
    `  }, [store]);`,
    ``,
    `  const filtered = items.filter(i =>`,
    `    !search || i.name.toLowerCase().includes(search.toLowerCase())`,
    `  );`,
    ``,
    `  const handleSelect = useCallback((item: ${D}Item) => {`,
    `    store.select(item.id);`,
    `    onSelect?.(item);`,
    `  }, [store, onSelect]);`,
    ``,
    `  if (loading) return <div className="sk-loading">Loading…</div>;`,
    `  if (error)   return <div className="sk-error">Error: {error}</div>;`,
    ``,
    `  return (`,
    `    <div className={\`${compName.toLowerCase()} \${className}\`}>`,
    `      <header>`,
    `        <input value={search} onChange={e => setSearch(e.target.value)}`,
    `               placeholder="Search…" />`,
    `        {onClose && <button onClick={onClose}>✕</button>}`,
    `      </header>`,
    `      <ul>`,
    `        {filtered.map(item => (`,
    `          <li key={item.id}`,
    `              className={item.status === 'active' ? 'active' : ''}`,
    `              onClick={() => handleSelect(item)}>`,
    `            <span>{item.name}</span>`,
    `            <span className="badge">{item.status}</span>`,
    `          </li>`,
    `        ))}`,
    `        {filtered.length === 0 && <li className="empty">No results.</li>}`,
    `      </ul>`,
    `    </div>`,
    `  );`,
    `};`,
    ``,
    `export const format${compName}Label = (i: ${D}Item) => \`\${i.name} (\${i.status})\`;`,
    `export const get${compName}StatusColor = (s: ${D}Item['status']) =>`,
    `  ({ active: '#22c55e', inactive: '#6b7280', pending: '#f59e0b', archived: '#ef4444' }[s] ?? '#6b7280');`,
  ];
  while (lines.length < n) lines.push(`// ${compName} helper ${lines.length}`);
  return lines.slice(0, n).join('\n');
}

function genApiClient(n) {
  const lines = [
    `const BASE = typeof window !== 'undefined' ? '' : (process.env.API_URL ?? 'http://localhost:3000');`,
    ``,
    `export class HttpError extends Error {`,
    `  constructor(public readonly status: number, msg: string, public readonly body?: unknown) {`,
    `    super(msg); this.name = 'HttpError';`,
    `  }`,
    `  isNotFound()    { return this.status === 404; }`,
    `  isUnauthorized(){ return this.status === 401; }`,
    `  isForbidden()   { return this.status === 403; }`,
    `  isServerError() { return this.status >= 500; }`,
    `}`,
    ``,
    `type Opts = { headers?: Record<string, string>; signal?: AbortSignal; timeout?: number };`,
    ``,
    `async function req<T>(method: string, url: string, body?: unknown, opts: Opts = {}): Promise<T> {`,
    `  const { headers = {}, signal, timeout = 10_000 } = opts;`,
    `  const ctrl = new AbortController();`,
    `  const timer = setTimeout(() => ctrl.abort(), timeout);`,
    `  const tok = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;`,
    `  if (tok) headers['Authorization'] = \`Bearer \${tok}\`;`,
    `  headers['Content-Type'] = 'application/json';`,
    `  headers['X-Request-Id'] = crypto.randomUUID();`,
    `  let res: Response;`,
    `  try {`,
    `    res = await fetch(\`\${BASE}\${url}\`, {`,
    `      method,`,
    `      headers,`,
    `      body: body !== undefined ? JSON.stringify(body) : undefined,`,
    `      signal: signal ?? ctrl.signal,`,
    `    });`,
    `  } finally { clearTimeout(timer); }`,
    `  if (!res.ok) {`,
    `    let b: unknown; try { b = await res.json(); } catch { /* ignore */ }`,
    `    throw new HttpError(res.status, \`HTTP \${res.status}: \${res.statusText}\`, b);`,
    `  }`,
    `  if (res.status === 204) return undefined as T;`,
    `  return res.json() as Promise<T>;`,
    `}`,
    ``,
    `export const http = {`,
    `  get:    <T>(url: string,             opts?: Opts) => req<T>('GET',    url, undefined, opts),`,
    `  post:   <T>(url: string, b: unknown, opts?: Opts) => req<T>('POST',   url, b,         opts),`,
    `  patch:  <T>(url: string, b: unknown, opts?: Opts) => req<T>('PATCH',  url, b,         opts),`,
    `  put:    <T>(url: string, b: unknown, opts?: Opts) => req<T>('PUT',    url, b,         opts),`,
    `  delete: <T>(url: string,             opts?: Opts) => req<T>('DELETE', url, undefined, opts),`,
    `};`,
    ``,
    `export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {`,
    `  const e = Object.entries(params).filter(([, v]) => v !== undefined);`,
    `  return e.length ? '?' + new URLSearchParams(e.map(([k, v]) => [k, String(v)])).toString() : '';`,
    `}`,
    ``,
    `export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {`,
    `  for (let i = 0; i < retries; i++) {`,
    `    try { return await fn(); } catch (err) {`,
    `      if (i === retries - 1) throw err;`,
    `      await new Promise(r => setTimeout(r, delay * (i + 1)));`,
    `    }`,
    `  }`,
    `  throw new Error('unreachable');`,
    `}`,
  ];
  while (lines.length < n) lines.push(`// http helper ${lines.length}`);
  return lines.slice(0, n).join('\n');
}

function genLogger(n) {
  const lines = [
    `type Level = 'debug' | 'info' | 'warn' | 'error';`,
    `const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };`,
    `const MIN: Level = (process.env['LOG_LEVEL'] as Level) ?? 'info';`,
    ``,
    `function emit(level: Level, scope: string, msg: string, data?: Record<string, unknown>) {`,
    `  if (ORDER[level] < ORDER[MIN]) return;`,
    `  const ts = new Date().toISOString();`,
    `  const line = data ? \`[\${ts}][\${level.toUpperCase()}][\${scope}] \${msg} \${JSON.stringify(data)}\``,
    `                     : \`[\${ts}][\${level.toUpperCase()}][\${scope}] \${msg}\`;`,
    `  ({ debug: console.debug, info: console.info, warn: console.warn, error: console.error })[level](line);`,
    `}`,
    ``,
    `export class Logger {`,
    `  constructor(private readonly scope: string) {}`,
    `  debug(m: string, d?: Record<string, unknown>) { emit('debug', this.scope, m, d); }`,
    `  info (m: string, d?: Record<string, unknown>) { emit('info',  this.scope, m, d); }`,
    `  warn (m: string, d?: Record<string, unknown>) { emit('warn',  this.scope, m, d); }`,
    `  error(m: string, d?: Record<string, unknown>) { emit('error', this.scope, m, d); }`,
    `  child(sub: string) { return new Logger(\`\${this.scope}:\${sub}\`); }`,
    `}`,
    ``,
    `export const logger = new Logger('app');`,
  ];
  while (lines.length < n) lines.push(`export const createLogger = (s: string) => new Logger(s); // ${lines.length}`);
  return lines.slice(0, n).join('\n');
}

function genUtils(name, n) {
  const lines = [
    `/** ${name} utilities */`,
    ``,
    `const intlNum = new Intl.NumberFormat('en-US');`,
    `const intlUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });`,
    `const intlDt  = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });`,
    ``,
    `export const fmtNumber   = (n: number) => intlNum.format(n);`,
    `export const fmtCurrency = (n: number) => intlUSD.format(n);`,
    `export const fmtDate     = (d: Date | string) => intlDt.format(new Date(d));`,
    ``,
    `export function truncate(s: string, max: number, e = '…') {`,
    `  return s.length <= max ? s : s.slice(0, max - e.length) + e;`,
    `}`,
    `export function slugify(s: string) {`,
    `  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');`,
    `}`,
    `export function capitalize(s: string) { return s[0].toUpperCase() + s.slice(1).toLowerCase(); }`,
    `export function titleCase(s: string)   { return s.split(/\\s+/).map(capitalize).join(' '); }`,
    `export function pluralize(n: number, sing: string, pl = sing + 's') { return n === 1 ? sing : pl; }`,
    ``,
    `export function relativeTime(d: Date | string): string {`,
    `  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);`,
    `  if (s < 60) return 'just now';`,
    `  const m = Math.round(s / 60); if (m < 60) return \`\${m}m ago\`;`,
    `  const h = Math.round(m / 60); if (h < 24) return \`\${h}h ago\`;`,
    `  return \`\${Math.round(h / 24)}d ago\`;`,
    `}`,
    ``,
    `export function deepEqual(a: unknown, b: unknown): boolean {`,
    `  if (a === b) return true;`,
    `  if (typeof a !== typeof b || a === null || b === null) return false;`,
    `  if (Array.isArray(a) && Array.isArray(b)) {`,
    `    return a.length === b.length && a.every((v, i) => deepEqual(v, (b as unknown[])[i]));`,
    `  }`,
    `  if (typeof a === 'object' && typeof b === 'object') {`,
    `    const ka = Object.keys(a as object), kb = Object.keys(b as object);`,
    `    return ka.length === kb.length && ka.every(k => deepEqual((a as Record<string,unknown>)[k], (b as Record<string,unknown>)[k]));`,
    `  }`,
    `  return false;`,
    `}`,
  ];
  while (lines.length < n) lines.push(`export const identity${lines.length} = <T>(v: T): T => v;`);
  return lines.slice(0, n).join('\n');
}

function genBrief(id, name, contract, invariants, internal) {
  return [
    `---`, `id: ${id}`, `name: ${name}`, `---`, ``,
    `## Contract`, ``, ...contract.map(c => `- ${c}`), ``,
    `## Invariants`, ``, ...invariants.map(i => `- ${i}`), ``,
    `## Internal`, ``, ...internal.map(n => `- ${n}`),
  ].join('\n');
}

// ── Create synthetic projects ──────────────────────────────────────────────

function createProject(dir, scale) {
  const x = scale === 'large' ? 2.5 : scale === 'medium' ? 1 : 0.5;
  const r = n => Math.max(8, Math.round(n * x));

  // Source files: 8 modules for medium/large, 3 for small
  const modules = scale === 'small' ? [
    // Small: 3 modules (mirrors fixture topology)
    {
      id: 'MOD-001', name: 'API Client', dir: 'src/api',
      files: [['client.ts', genApiClient(r(70))], ['logger.ts', genLogger(r(40))]],
      deps: [],
    },
    {
      id: 'MOD-002', name: 'Store', dir: 'src/store',
      files: [['product.service.ts', genService('product', [], r(65))], ['product.types.ts', genTypes('product', r(35))]],
      deps: ['MOD-001'],
    },
    {
      id: 'MOD-003', name: 'UI', dir: 'src/components',
      files: [
        ['ProductList.tsx', genComponent('ProductList', 'product', ['product'], r(75))],
        ['Button.tsx',      genComponent('Button',      'product', [],          r(40))],
      ],
      deps: ['MOD-002'],
    },
  ] : [
    {
      id: 'MOD-001', name: 'API Client', dir: 'src/api',
      files: [['client.ts', genApiClient(r(95))], ['logger.ts', genLogger(r(55))]],
      deps: [],
    },
    {
      id: 'MOD-002', name: 'Auth', dir: 'src/auth',
      files: [
        ['auth.service.ts', genService('auth', [], r(88))],
        ['auth.types.ts',   genTypes('auth', r(42))],
        ['auth.store.ts',   genStore('auth', r(65))],
      ],
      deps: ['MOD-001'],
    },
    {
      id: 'MOD-003', name: 'Products', dir: 'src/products',
      files: [
        ['product.service.ts', genService('product', ['auth'], r(92))],
        ['product.types.ts',   genTypes('product', r(40))],
        ['product.store.ts',   genStore('product', r(68))],
      ],
      deps: ['MOD-001', 'MOD-002'],
    },
    {
      id: 'MOD-004', name: 'Cart', dir: 'src/cart',
      files: [
        ['cart.service.ts', genService('cart', ['product'], r(88))],
        ['cart.types.ts',   genTypes('cart', r(38))],
        ['cart.store.ts',   genStore('cart', r(62))],
      ],
      deps: ['MOD-001', 'MOD-003'],
    },
    {
      id: 'MOD-005', name: 'Orders', dir: 'src/orders',
      files: [
        ['order.service.ts', genService('order', ['cart', 'auth'], r(92))],
        ['order.types.ts',   genTypes('order', r(42))],
        ['order.store.ts',   genStore('order', r(65))],
      ],
      deps: ['MOD-002', 'MOD-004'],
    },
    {
      id: 'MOD-006', name: 'UI Components', dir: 'src/components',
      files: [
        ['ProductList.tsx',  genComponent('ProductList',  'product', ['product'], r(85))],
        ['CartDrawer.tsx',   genComponent('CartDrawer',   'cart',    ['cart'],    r(105))],
        ['OrderHistory.tsx', genComponent('OrderHistory', 'order',   ['order'],   r(95))],
        ['LoginForm.tsx',    genComponent('LoginForm',    'auth',    ['auth'],    r(88))],
        ['Button.tsx',       genComponent('Button',       'product', [],          r(55))],
      ],
      deps: ['MOD-003', 'MOD-004', 'MOD-005'],
    },
    {
      id: 'MOD-007', name: 'Pages', dir: 'src/pages',
      files: [
        ['HomePage.tsx',     genComponent('HomePage',     'product', ['product', 'cart'],          r(112))],
        ['CartPage.tsx',     genComponent('CartPage',     'cart',    ['cart', 'order'],             r(108))],
        ['CheckoutPage.tsx', genComponent('CheckoutPage', 'order',   ['order', 'cart', 'auth'],     r(125))],
      ],
      deps: ['MOD-006'],
    },
    {
      id: 'MOD-008', name: 'Utils', dir: 'src/utils',
      files: [
        ['format.ts',   genUtils('format',   r(62))],
        ['validate.ts', genUtils('validate', r(55))],
        ['storage.ts',  genUtils('storage',  r(48))],
      ],
      deps: [],
    },
  ];

  // Write source files
  for (const mod of modules) {
    for (const [filename, content] of mod.files) {
      write(dir, `${mod.dir}/${filename}`, content);
    }
  }

  // Write AGENTS/scopekit.json
  write(dir, 'AGENTS/scopekit.json', JSON.stringify({
    project: `Synthetic ${scale[0].toUpperCase() + scale.slice(1)} Project`,
    srcRoots: ['src'],
    modules: modules.map(m => ({
      id: m.id, name: m.name,
      globs: [`${m.dir}/**`],
      ...(m.deps.length ? { deps: m.deps } : {}),
    })),
  }, null, 2));

  // Write AGENTS/MOD-XXX.md briefs
  const briefTemplates = {
    'MOD-001': genBrief('MOD-001', 'API Client',
      ['`http.get/post/patch/put/delete` are the only way to reach the backend. @anchor src/api/client.ts::http',
       '`HttpError` is the standard error shape for failed requests. @anchor src/api/client.ts::HttpError'],
      ['Never call `fetch()` directly — always use `http`. @anchor src/api/client.ts',
       'Always attach `X-Request-Id` header (done automatically). @anchor src/api/client.ts::req',
       'Throw `HttpError`; never throw raw `Error` from network paths. @anchor src/api/client.ts::HttpError'],
      ['`withRetry` is for read operations only; avoid for mutations.'],
    ),
    'MOD-002': genBrief('MOD-002', 'Auth',
      ['`AuthService.login(credentials)` authenticates and returns `AuthUser`. @anchor src/auth/auth.service.ts::AuthService',
       '`AuthStore` is the single source of truth for session state. @anchor src/auth/auth.store.ts::AuthStore'],
      ['Session tokens are stored only via `AuthStore`; never write to localStorage directly. @anchor src/auth/auth.store.ts',
       'Check `AuthService.isAuthenticated()` before protected API calls. @anchor src/auth/auth.service.ts',
       'Never expose raw JWT payload outside this module. @anchor src/auth/auth.service.ts'],
      ['`AuthStore` wraps `SessionStore` for persistence; do not bypass it.'],
    ),
    'MOD-003': genBrief('MOD-003', 'Products',
      ['`ProductService.getAll()` returns cached products, force-refresh with `getAll(true)`. @anchor src/products/product.service.ts::ProductService',
       '`ProductItem` is the canonical product shape across the app. @anchor src/products/product.types.ts::ProductItem'],
      ['Always go through `ProductService` for reads — never fetch `/api/products` directly. @anchor src/products/product.service.ts',
       '`ProductStore` is the reactive layer; components should subscribe to it, not the service. @anchor src/products/product.store.ts'],
      ['Cache is keyed on `id`; invalidate via `clearCache()` after bulk operations.'],
    ),
    'MOD-004': genBrief('MOD-004', 'Cart',
      ['`CartService.create/update/remove` are the only mutations. @anchor src/cart/cart.service.ts::CartService',
       '`CartItem` references a `ProductItem` by id, not by embedding. @anchor src/cart/cart.types.ts::CartItem'],
      ['Never mutate cart state outside `CartService` — subscribers depend on atomic notify. @anchor src/cart/cart.service.ts',
       'Validate product existence via `ProductService.getById` before adding to cart. @anchor src/cart/cart.service.ts'],
      ['`CartStore.load()` is idempotent within the stale window — safe to call multiple times.'],
    ),
    'MOD-005': genBrief('MOD-005', 'Orders',
      ['`OrderService.create(cartId)` converts a cart to an order. @anchor src/orders/order.service.ts::OrderService',
       '`OrderItem` embeds a product snapshot — not a live reference. @anchor src/orders/order.types.ts::OrderItem'],
      ['An order must be created from a non-empty cart. @anchor src/orders/order.service.ts',
       'Do not mutate `OrderItem.product` after creation — it is a snapshot. @anchor src/orders/order.types.ts'],
      ['Order total is computed at creation time; do not recompute from live product prices.'],
    ),
    'MOD-006': genBrief('MOD-006', 'UI Components',
      ['All components accept a `*Store` prop; never instantiate stores inside components. @anchor src/components/ProductList.tsx::ProductList',
       '`onSelect` callbacks receive full `*Item` objects. @anchor src/components/CartDrawer.tsx::CartDrawer'],
      ['Components must not call service methods directly — only call store methods. @anchor src/components/ProductList.tsx',
       'Keep components stateless for data; only local UI state (search, hover) is allowed. @anchor src/components/CartDrawer.tsx'],
      ['Shared style classes use the `sk-` prefix to avoid collisions.'],
    ),
    'MOD-007': genBrief('MOD-007', 'Pages',
      ['Each page owns its store wiring; sub-components receive stores as props. @anchor src/pages/HomePage.tsx::HomePage',
       'Page-level error boundaries live here; component-level errors surface up to them. @anchor src/pages/CheckoutPage.tsx'],
      ['Pages must not import from sibling page files — page-to-page nav uses the router. @anchor src/pages/HomePage.tsx',
       'Destructuring store state for rendering must happen inside the component, not at module level. @anchor src/pages/CartPage.tsx'],
      ['Use `React.lazy` for page-level code splitting.'],
    ),
    'MOD-008': genBrief('MOD-008', 'Utils',
      ['All formatting helpers are pure functions with no side-effects. @anchor src/utils/format.ts',
       '`deepEqual` is structural equality, not reference equality. @anchor src/utils/format.ts::deepEqual'],
      ['Do not import domain types (Product, Cart, etc.) into utils — keep them generic. @anchor src/utils/format.ts',
       'All functions must be individually tree-shakeable (named exports only). @anchor src/utils/format.ts'],
      ['`relativeTime` uses `Date.now()` internally — not mockable in pure unit tests.'],
    ),
    // Small-only modules (MOD-001..003 reused with different content for small project)
  };

  for (const mod of modules) {
    const brief = briefTemplates[mod.id] ?? genBrief(
      mod.id, mod.name,
      [`\`${mod.name}\` public API is defined here. @anchor ${mod.dir}/${mod.files[0][0]}`],
      [`Always use the service layer — never access internals directly. @anchor ${mod.dir}/${mod.files[0][0]}`],
      [`Internals may change without notice.`],
    );
    write(dir, `AGENTS/${mod.id}.md`, brief);
  }

  const targetMod = modules[modules.length - 2]?.id ?? modules[0].id; // second-to-last = UI Components
  return targetMod;
}

// ══════════════════════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  ScopeKit Token Efficiency Benchmark');
console.log('  Token estimation: cl100k_base ≈ 3.5 chars / token');
console.log('═══════════════════════════════════════════════════════════════════');

const tmpBase = path.join(os.tmpdir(), `scopekit-bench-${Date.now()}`);
const results  = [];

// ── 1. Real fixture ────────────────────────────────────────────────────────

const FIXTURE = path.resolve(__dirname, '..', 'fixture');
const r0 = bench('Real fixture  (3 modules · 6 files · ~40 LOC)', FIXTURE, 'MOD-003');
printResult(r0);
results.push(r0);

// ── 2. Synthetic small ─────────────────────────────────────────────────────

{
  const dir = path.join(tmpBase, 'small');
  const targetMod = createProject(dir, 'small');
  const files = srcFiles(dir);
  const locs  = files.reduce((a, f) => a + readSrc(dir, f).split('\n').length, 0);
  const r = bench(`Synthetic small  (3 modules · ${files.length} files · ~${locs} LOC)`, dir, targetMod);
  printResult(r);
  results.push(r);
}

// ── 3. Synthetic medium ────────────────────────────────────────────────────

{
  const dir = path.join(tmpBase, 'medium');
  const targetMod = createProject(dir, 'medium');
  const files = srcFiles(dir);
  const locs  = files.reduce((a, f) => a + readSrc(dir, f).split('\n').length, 0);
  const r = bench(`Synthetic medium (8 modules · ${files.length} files · ~${locs} LOC)`, dir, targetMod);
  printResult(r);
  results.push(r);
}

// ── 4. Synthetic large ─────────────────────────────────────────────────────

{
  const dir = path.join(tmpBase, 'large');
  const targetMod = createProject(dir, 'large');
  const files = srcFiles(dir);
  const locs  = files.reduce((a, f) => a + readSrc(dir, f).split('\n').length, 0);
  const r = bench(`Synthetic large  (8 modules · ${files.length} files · ~${locs} LOC)`, dir, targetMod);
  printResult(r);
  results.push(r);
}

// ── Markdown table for README ──────────────────────────────────────────────

printMarkdown(results);

// ── Cleanup ────────────────────────────────────────────────────────────────

fs.rmSync(tmpBase, { recursive: true, force: true });

console.log('\n  Done.\n');
