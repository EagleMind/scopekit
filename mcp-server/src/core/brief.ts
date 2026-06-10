import * as fs from 'fs';
import * as path from 'path';
import { Brief, Invariant, Anchor } from './types.js';
import { agentsDir } from './config.js';

function parseAnchors(line: string): { text: string; anchors: Anchor[] } {
  const anchors: Anchor[] = [];
  const re = /@anchor\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const raw = m[1];
    const [file, symbol] = raw.split('::');
    anchors.push({ raw, file, symbol });
  }
  const text = line.replace(/@anchor\s+\S+/g, '').replace(/\s+/g, ' ').trim();
  return { text, anchors };
}

/** Split a markdown body into a map of lowercased "## Heading" → section text. */
function sections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => { if (cur !== null) out[cur.toLowerCase()] = buf.join('\n'); };
  for (const line of body.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { flush(); cur = h[1]; buf = []; }
    else if (cur !== null) buf.push(line);
  }
  flush();
  return out;
}

function items(section: string | undefined): Invariant[] {
  if (!section) return [];
  const res: Invariant[] = [];
  for (const raw of section.split('\n')) {
    const t = raw.trim();
    if (!t.startsWith('- ')) continue;
    const { text, anchors } = parseAnchors(t.slice(2));
    if (text) res.push({ text, anchors });
  }
  return res;
}

export function parseBrief(filePath: string): Brief | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');

  let id = '';
  let name = '';
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const i = fm[1].match(/^id:\s*(.+)$/m);
    if (i) id = i[1].trim();
    const n = fm[1].match(/^name:\s*(.+)$/m);
    if (n) name = n[1].trim();
  }

  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const secs = sections(body);

  return {
    id,
    name,
    raw,
    contract: items(secs['contract']),
    invariants: items(secs['invariants']),
    internal: items(secs['internal']),
  };
}

export function briefPath(root: string, id: string): string {
  return path.join(agentsDir(root), `${id}.md`);
}

export function loadBrief(root: string, id: string): Brief | null {
  return parseBrief(briefPath(root, id));
}
