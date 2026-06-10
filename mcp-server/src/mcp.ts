#!/usr/bin/env node
// ScopeKit MCP server — the context PROVIDER. Enforcement lives in the hook (hook.ts).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import { findRoot, loadAll } from './core/load.js';
import { resolveModule } from './core/resolve.js';
import { buildContext } from './core/context.js';
import { verify } from './core/verify.js';
import { scaffold } from './core/scaffold.js';

const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const root = findRoot(argRoot);

const server = new Server(
  { name: 'scopekit', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scopekit_scaffold',
      description:
        'Analyze the project tree and real import edges, and return a plan for creating ' +
        'AGENTS/scopekit.json and the MOD-XXX.md briefs. Run once when setting up a project.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'scopekit_list_modules',
      description: "List all modules registered in AGENTS/scopekit.json with their owned file counts.",
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'scopekit_get_context',
      description:
        'Load scoped context for a module: its file list, contract, and invariants, plus the ' +
        'contract surface of every dependency. ALWAYS call before editing. ' +
        'Pass module_id (e.g. "MOD-003") or file_path to auto-resolve the owner.',
      inputSchema: {
        type: 'object',
        properties: {
          module_id: { type: 'string', description: 'Module ID such as "MOD-003".' },
          file_path: { type: 'string', description: 'A file path; its owning module is resolved automatically.' },
        },
      },
    },
    {
      name: 'scopekit_resolve_module',
      description: 'Find which module owns a given file path.',
      inputSchema: {
        type: 'object',
        properties: { file_path: { type: 'string', description: 'File path to look up.' } },
        required: ['file_path'],
      },
    },
    {
      name: 'scopekit_verify',
      description:
        'Check every brief against the live codebase: dead globs, stale @anchors (missing files/symbols), ' +
        'and dependency drift. Use to confirm briefs are still accurate.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
}));

function text(s: string) {
  return { content: [{ type: 'text', text: s }] };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, string>;

  if (name === 'scopekit_scaffold') {
    const { model } = loadAll(root);
    if (model && model.config.modules.length > 0) {
      return text(`AGENTS/scopekit.json already defines ${model.config.modules.length} module(s). Use scopekit_list_modules to see them.`);
    }
    return text(scaffold(root));
  }

  const { model, graph } = loadAll(root);
  if (!model || !graph) {
    return text('No AGENTS/scopekit.json found. Run scopekit_scaffold first, then create the config and briefs.');
  }

  switch (name) {
    case 'scopekit_list_modules': {
      const lines = model.modules.map(m => `- **${m.def.id}** — ${m.def.name}  (${m.files.length} files)`);
      return text(`# ${model.config.project} — Modules\n\n${lines.join('\n')}`);
    }

    case 'scopekit_resolve_module': {
      if (!args.file_path) throw new McpError(ErrorCode.InvalidParams, 'file_path is required');
      const relPath = toRel(args.file_path);
      const id = resolveModule(relPath, model);
      if (!id) return text(`No module owns \`${relPath}\`. Use scopekit_list_modules to browse.`);
      const def = model.config.modules.find(m => m.id === id);
      return text(`\`${relPath}\` is owned by **${id}** — ${def?.name}.\nCall scopekit_get_context with module_id "${id}".`);
    }

    case 'scopekit_get_context': {
      let id = args.module_id;
      if (!id && args.file_path) {
        const found = resolveModule(toRel(args.file_path), model);
        if (!found) return text(`Could not resolve a module for \`${args.file_path}\`. Use scopekit_list_modules.`);
        id = found;
      }
      if (!id) throw new McpError(ErrorCode.InvalidParams, 'Provide module_id or file_path.');
      if (!model.config.modules.find(m => m.id === id)) {
        return text(`Module "${id}" is not registered. Use scopekit_list_modules.`);
      }
      return text(buildContext(root, model, graph, id));
    }

    case 'scopekit_verify': {
      const findings = verify(root, model, graph);
      if (!findings.length) return text('✓ All briefs are consistent with the codebase.');
      const errors = findings.filter(f => f.level === 'error').length;
      const body = findings.map(f => `[${f.level}] ${f.msg}`).join('\n');
      return text(`${body}\n\n${errors} error(s).`);
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

function toRel(p: string): string {
  return path.relative(root, path.resolve(root, p)).split(path.sep).join('/');
}

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error('ScopeKit MCP server error:', err);
  process.exit(1);
});
