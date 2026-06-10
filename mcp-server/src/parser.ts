import * as fs from 'fs';

export interface ModuleEntry {
  id: string;
  name: string;
  contextFile: string;
  primaryDir: string;
}

export interface ModuleContext {
  id: string;
  name: string;
  agent: string;
  deps: string[];
  scopeFiles: string[];
  raw: string;
}

export function parseIndex(indexPath: string): ModuleEntry[] {
  const content = fs.readFileSync(indexPath, 'utf8');
  const entries: ModuleEntry[] = [];

  // Match table rows with at least 4 pipe-delimited columns
  const rowRe = /^\|\s*(MOD-\d+)\s*\|\s*([^|]+?)\s*\|\s*`?([^|`]+?)`?\s*\|\s*`?([^|`]+?)`?\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(content)) !== null) {
    const [, id, name, contextFile, primaryDir] = match;
    entries.push({
      id: id.trim(),
      name: name.trim(),
      contextFile: contextFile.trim(),
      primaryDir: primaryDir.trim(),
    });
  }

  return entries;
}

export function parseModule(modulePath: string): ModuleContext {
  const content = fs.readFileSync(modulePath, 'utf8');

  let id = '';
  let name = '';
  let agent = '';
  let deps: string[] = [];

  // Parse YAML frontmatter between --- delimiters
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const idMatch = fm.match(/^id:\s*(.+)$/m);
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const agentMatch = fm.match(/^agent:\s*(.+)$/m);
    const depsMatch = fm.match(/^deps:\s*(.+)$/m);

    if (idMatch) id = idMatch[1].trim();
    if (nameMatch) name = nameMatch[1].trim();
    if (agentMatch) agent = agentMatch[1].trim();
    if (depsMatch) {
      const raw = depsMatch[1].trim();
      if (raw !== '[]' && raw !== '') {
        deps = raw
          .replace(/[\[\]]/g, '')
          .split(',')
          .map(d => d.trim())
          .filter(Boolean);
      }
    }
  }

  // Parse file paths from the Scope code block
  const scopeFiles: string[] = [];
  const scopeMatch = content.match(/##\s+Scope[^\n]*\n[\s\S]*?```[^\n]*\n([\s\S]*?)```/);
  if (scopeMatch) {
    for (const line of scopeMatch[1].split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Strip ← comments and trailing whitespace annotations
      const filePath = trimmed.split(/\s{2,}|\s+←/)[0].trim();
      if (filePath && !filePath.startsWith('//') && !filePath.startsWith('#')) {
        scopeFiles.push(filePath);
      }
    }
  }

  return { id, name, agent, deps, scopeFiles, raw: content };
}

export function fileMatchesScope(filePath: string, scopeFile: string): boolean {
  // Normalize path separators and strip leading slashes
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const f = norm(filePath);
  const s = norm(scopeFile);
  return f === s || f.endsWith('/' + s) || s.endsWith('/' + f);
}
