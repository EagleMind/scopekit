#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { parseIndex, parseModule, fileMatchesScope, ModuleEntry } from './parser.js';

// Resolve the project root: --root <path> flag > SCOPEKIT_ROOT env > walk up from CWD
function findProjectRoot(): string {
  const rootArgIdx = process.argv.indexOf('--root');
  if (rootArgIdx !== -1 && process.argv[rootArgIdx + 1]) {
    return path.resolve(process.argv[rootArgIdx + 1]);
  }
  if (process.env.SCOPEKIT_ROOT) {
    return path.resolve(process.env.SCOPEKIT_ROOT);
  }
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'AGENTS', 'INDEX.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
const agentsDir = path.join(projectRoot, 'AGENTS');

function loadIndex(): ModuleEntry[] {
  const indexPath = path.join(agentsDir, 'INDEX.md');
  if (!fs.existsSync(indexPath)) return [];
  try {
    return parseIndex(indexPath);
  } catch {
    return [];
  }
}

function loadModule(contextFile: string) {
  const modPath = path.join(agentsDir, contextFile);
  if (!fs.existsSync(modPath)) return null;
  try {
    return parseModule(modPath);
  } catch {
    return null;
  }
}

function resolveTransitiveDeps(
  startId: string,
  modules: ModuleEntry[],
  visited = new Set<string>()
): string[] {
  if (visited.has(startId)) return [];
  visited.add(startId);

  const entry = modules.find(m => m.id === startId);
  if (!entry) return [];

  const mod = loadModule(entry.contextFile);
  if (!mod) return [startId];

  const result: string[] = [startId];
  for (const depId of mod.deps) {
    result.push(...resolveTransitiveDeps(depId, modules, visited));
  }
  return result;
}

function buildContext(targetId: string, modules: ModuleEntry[]): string {
  const allIds = resolveTransitiveDeps(targetId, modules);
  const parts: string[] = [];

  const indexPath = path.join(agentsDir, 'INDEX.md');
  if (fs.existsSync(indexPath)) {
    parts.push(`# ScopeKit Index\n\n${fs.readFileSync(indexPath, 'utf8')}`);
  }

  const targetEntry = modules.find(m => m.id === targetId);
  if (targetEntry) {
    const mod = loadModule(targetEntry.contextFile);
    if (mod) {
      parts.push(`\n---\n\n# Primary Module: ${targetId} — ${mod.name}\n\n${mod.raw}`);
    }
  }

  for (const depId of allIds.slice(1)) {
    const depEntry = modules.find(m => m.id === depId);
    if (depEntry) {
      const mod = loadModule(depEntry.contextFile);
      if (mod) {
        parts.push(`\n---\n\n# Dependency: ${depId} — ${mod.name}\n\n${mod.raw}`);
      }
    }
  }

  return parts.join('\n');
}

function findOwningModule(filePath: string, modules: ModuleEntry[]): ModuleEntry | null {
  for (const entry of modules) {
    const mod = loadModule(entry.contextFile);
    if (!mod) continue;
    for (const scopeFile of mod.scopeFiles) {
      if (fileMatchesScope(filePath, scopeFile)) return entry;
    }
  }
  return null;
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'scopekit', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scopekit_list_modules',
      description:
        'List all modules registered in this project\'s ScopeKit index. ' +
        'Call this first to discover module IDs before loading context.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'scopekit_get_context',
      description:
        'Load the scoped context for a module — the module brief plus all transitive dependency briefs. ' +
        'ALWAYS call this before editing any file in a ScopeKit-managed project. ' +
        'Pass either module_id (e.g. "MOD-003") or file_path to auto-resolve the owning module.',
      inputSchema: {
        type: 'object',
        properties: {
          module_id: {
            type: 'string',
            description: 'Module ID such as "MOD-003". Use when you know the module.',
          },
          file_path: {
            type: 'string',
            description: 'File path such as "src/services/api.ts". Owning module is resolved automatically.',
          },
        },
      },
    },
    {
      name: 'scopekit_resolve_module',
      description:
        'Find which module owns a given file path. ' +
        'Use this before editing a file when you don\'t know which module it belongs to.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path to look up, e.g. "src/services/api.ts"',
          },
        },
        required: ['file_path'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const modules = loadIndex();

  // ── scopekit_list_modules ────────────────────────────────────────────────
  if (name === 'scopekit_list_modules') {
    if (modules.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No AGENTS/INDEX.md found or no modules registered. Run the ScopeKit setup script first.',
        }],
      };
    }
    const lines = modules.map(m => `- **${m.id}** — ${m.name}  (\`${m.primaryDir}\`)`);
    return {
      content: [{ type: 'text', text: `# ScopeKit Modules\n\n${lines.join('\n')}` }],
    };
  }

  // ── scopekit_resolve_module ──────────────────────────────────────────────
  if (name === 'scopekit_resolve_module') {
    const filePath = (args as Record<string, string>)?.file_path;
    if (!filePath) throw new McpError(ErrorCode.InvalidParams, 'file_path is required');

    const entry = findOwningModule(filePath, modules);
    if (!entry) {
      return {
        content: [{
          type: 'text',
          text: `No module found for \`${filePath}\`. The file may not be listed in any module's scope. Try \`scopekit_list_modules\` to browse available modules.`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `\`${filePath}\` is owned by **${entry.id}** — ${entry.name}.\n\nCall \`scopekit_get_context\` with \`module_id: "${entry.id}"\` to load the full context.`,
      }],
    };
  }

  // ── scopekit_get_context ─────────────────────────────────────────────────
  if (name === 'scopekit_get_context') {
    const a = args as Record<string, string> | undefined;
    const moduleId = a?.module_id;
    const filePath = a?.file_path;

    if (!moduleId && !filePath) {
      throw new McpError(ErrorCode.InvalidParams, 'Provide either module_id or file_path.');
    }

    let targetId = moduleId;

    if (!targetId && filePath) {
      const entry = findOwningModule(filePath, modules);
      if (!entry) {
        return {
          content: [{
            type: 'text',
            text: `Could not resolve a module for \`${filePath}\`. Try \`scopekit_list_modules\` to find the right module ID, then call \`scopekit_get_context\` with that ID.`,
          }],
        };
      }
      targetId = entry.id;
    }

    if (!modules.find(m => m.id === targetId)) {
      return {
        content: [{
          type: 'text',
          text: `Module "${targetId}" not found in the registry. Call \`scopekit_list_modules\` to see available modules.`,
        }],
      };
    }

    const context = buildContext(targetId!, modules);
    return {
      content: [{ type: 'text', text: context }],
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ScopeKit MCP server error:', err);
  process.exit(1);
});
