import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '__pycache__', '.pytest_cache', 'venv',
  '.venv', 'env', 'coverage', '.nyc_output', 'vendor', '.idea', '.vscode',
  'AGENTS',
]);

export function rel(root: string, p: string): string {
  return path.relative(root, p).split(path.sep).join('/');
}

/** Recursively list project-relative file paths under root, skipping ignored dirs. */
export function walkFiles(root: string, extraIgnore: string[] = []): string[] {
  const ignore = new Set([...DEFAULT_IGNORE, ...extraIgnore]);
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      if (ignore.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(rel(root, full));
    }
  }
  return out;
}

/** Convert a glob (supporting **, *, ?) anchored at the project root into a RegExp. */
export function globToRegex(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function matchGlob(glob: string, file: string): boolean {
  const f = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (globToRegex(glob).test(f)) return true;
  // A wildcard-free glob is treated as a directory prefix.
  if (!/[*?]/.test(glob)) {
    const g = glob.replace(/\/+$/, '');
    return f === g || f.startsWith(g + '/');
  }
  return false;
}
