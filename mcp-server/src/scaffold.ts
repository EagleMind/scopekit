import * as fs from 'fs';
import * as path from 'path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '__pycache__', '.pytest_cache', 'venv',
  '.venv', 'env', '.env', 'coverage', '.nyc_output', 'vendor',
  'AGENTS', '.idea', '.vscode',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.cs', '.php',
  '.swift', '.c', '.cpp', '.h', '.hpp',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm',
  '.sql',
]);

interface DirEntry {
  path: string;       // relative to project root
  fileCount: number;
  codeFileCount: number;
  children: string[]; // immediate subdirectory names
}

function walk(
  dir: string,
  root: string,
  depth: number,
  result: Map<string, DirEntry>
): { total: number; code: number } {
  if (depth > 4) return { total: 0, code: 0 };

  let total = 0;
  let code = 0;
  const children: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { total: 0, code: 0 };
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    if (entry.isDirectory()) {
      children.push(entry.name);
      const sub = walk(path.join(dir, entry.name), root, depth + 1, result);
      total += sub.total;
      code += sub.code;
    } else if (entry.isFile()) {
      total++;
      if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) code++;
    }
  }

  const rel = path.relative(root, dir).replace(/\\/g, '/') || '.';
  result.set(rel, { path: rel, fileCount: total, codeFileCount: code, children });
  return { total, code };
}

function loadGitignorePatterns(root: string): string[] {
  try {
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    return gi.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

export function analyzeProject(root: string): string {
  const dirMap = new Map<string, DirEntry>();
  walk(root, root, 0, dirMap);

  const rootEntry = dirMap.get('.');
  if (!rootEntry || rootEntry.children.length === 0) {
    return 'Project root appears empty or has no recognizable source structure.';
  }

  const lines: string[] = [];

  lines.push('## Project Structure\n');
  lines.push('```');

  // Top-level dirs with file counts
  const topDirs = rootEntry.children
    .map(name => dirMap.get(name))
    .filter((e): e is DirEntry => !!e && e.codeFileCount > 0)
    .sort((a, b) => b.codeFileCount - a.codeFileCount);

  for (const dir of topDirs) {
    lines.push(`${dir.path}/  (${dir.codeFileCount} code files)`);
    for (const child of dir.children.slice(0, 6)) {
      const sub = dirMap.get(`${dir.path}/${child}`);
      if (sub && sub.codeFileCount > 0) {
        lines.push(`  ${child}/  (${sub.codeFileCount})`);
      }
    }
    if (dir.children.length > 6) {
      lines.push(`  ... ${dir.children.length - 6} more`);
    }
  }
  lines.push('```\n');

  // Config/manifest files at root (hints at project type)
  const rootFiles = fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(n => !n.startsWith('.'));

  const manifests = rootFiles.filter(n => [
    'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml',
    'build.gradle', 'Gemfile', 'composer.json', 'mix.exs',
  ].includes(n));

  if (manifests.length > 0) {
    lines.push(`**Project manifests:** ${manifests.join(', ')}\n`);
  }

  const gitignorePatterns = loadGitignorePatterns(root);
  if (gitignorePatterns.length > 0) {
    lines.push(`**Gitignore patterns (${gitignorePatterns.length}):** ${gitignorePatterns.slice(0, 8).join(', ')}${gitignorePatterns.length > 8 ? ', ...' : ''}\n`);
  }

  lines.push('---\n');
  lines.push('## Instructions for Claude\n');
  lines.push(
    'Based on the structure above, propose a ScopeKit module breakdown for this project.\n' +
    'For each module you propose:\n' +
    '1. Assign it a `MOD-XXX` ID starting from `MOD-001`\n' +
    '2. Name it (e.g. "API Layer", "Auth", "UI Components")\n' +
    '3. List the directories/files it owns\n' +
    '4. Identify its dependencies on other proposed modules\n' +
    '5. Write the `MOD-XXX.md` file using the ScopeKit module brief format\n' +
    '6. Write or update `AGENTS/INDEX.md` with all modules, the dependency graph, and shared contracts\n\n' +
    'Aim for 5–10 modules. Group by logical ownership, not by file type.\n' +
    'If the codebase shows signs of mixed concerns or unclear boundaries, note it explicitly ' +
    'and propose the boundaries based on what the structure *should* be.\n\n' +
    'Create the AGENTS/ directory and write all files when ready.'
  );

  return lines.join('\n');
}
