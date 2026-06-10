# Tauri App — Agent Module Registry

## Module Registry

| ID      | Name               | Context File    | Primary Directory                        |
|---------|--------------------|-----------------|-----------------------------------------|
| MOD-001 | Rust Backend       | `MOD-001.md`    | `src-tauri/src/`                         |
| MOD-002 | IPC / Services     | `MOD-002.md`    | `src/services/`                          |
| MOD-003 | App State          | `MOD-003.md`    | `src/store/`                             |
| MOD-004 | UI Components      | `MOD-004.md`    | `src/components/`                        |
| MOD-005 | Local Data Store   | `MOD-005.md`    | `src-tauri/src/appdb.rs`                 |

## Dependency Graph

```
MOD-004 (UI)
  └── MOD-003 (State)
        └── MOD-002 (IPC)
              └── MOD-001 (Rust Backend)
                    └── MOD-005 (Data Store)
```

Foundational (no deps): **MOD-005**

## Shared Contracts

| File | Why It Matters |
|------|----------------|
| `src/types/api.ts` | TypeScript interfaces shared between IPC layer and UI |
| `src/utils/tauri.ts` | `safeInvoke<T>()` — all Tauri IPC goes through this |
| `src-tauri/src/lib.rs` | All Tauri command registration — new commands added here |

## Rules for Agents

1. Read only files in your scope unless cross-module understanding is needed
2. New Tauri commands must be registered in `lib.rs` `invoke_handler![]`
3. New shared TypeScript types go in `src/types/api.ts`, not inline
4. All Rust Tauri commands must be `async` and return `Result<T, String>`
5. Secrets (passwords, API keys) go in the OS keychain via `keyring` — never in SQLite
6. Use CSS variables from `src/index.css` — no raw hex colors
