# React SPA — Agent Module Registry

## Module Registry

| ID      | Name              | Context File    | Primary Directory           |
|---------|-------------------|-----------------|-----------------------------|
| MOD-001 | API Layer         | `MOD-001.md`    | `src/services/`             |
| MOD-002 | State Management  | `MOD-002.md`    | `src/store/`                |
| MOD-003 | UI Components     | `MOD-003.md`    | `src/components/`           |
| MOD-004 | Auth              | `MOD-004.md`    | `src/auth/`                 |
| MOD-005 | UI Primitives     | `MOD-005.md`    | `src/components/ui/`        |

## Dependency Graph

```
MOD-003 (UI Components)
  ├── MOD-002 (State)
  │     └── MOD-001 (API)
  ├── MOD-004 (Auth)
  └── MOD-005 (UI Primitives)
```

Foundational (no deps): **MOD-001**, **MOD-005**

## Shared Contracts

| File | Why It Matters |
|------|----------------|
| `src/types/api.ts` | Shared TypeScript interfaces — changes affect every module |
| `src/utils/http.ts` | Base fetch wrapper used by all API calls |
| `src/index.css` | Design tokens (CSS variables) — used everywhere |

## Rules for Agents

1. Read only files in your scope unless a cross-module check is needed
2. New shared types go in `src/types/api.ts`, not inline
3. Use CSS variables from `src/index.css` — no raw hex colors
4. API calls must go through `src/utils/http.ts`, not raw `fetch()`
5. Auth tokens are stored in `httpOnly` cookies — never in `localStorage`
