# Python API — Agent Module Registry

## Module Registry

| ID      | Name               | Context File    | Primary Directory     |
|---------|--------------------|-----------------|-----------------------|
| MOD-001 | Data Models        | `MOD-001.md`    | `app/models/`         |
| MOD-002 | API Routes         | `MOD-002.md`    | `app/routes/`         |
| MOD-003 | Business Logic     | `MOD-003.md`    | `app/services/`       |
| MOD-004 | Auth & Middleware  | `MOD-004.md`    | `app/auth/`           |
| MOD-005 | Database Layer     | `MOD-005.md`    | `app/db/`             |

## Dependency Graph

```
MOD-002 (Routes)
  ├── MOD-003 (Services)
  │     └── MOD-005 (DB)
  │           └── MOD-001 (Models)
  └── MOD-004 (Auth)
```

Foundational (no deps): **MOD-001**

## Shared Contracts

| File | Why It Matters |
|------|----------------|
| `app/schemas.py` | Pydantic request/response schemas — shared by routes and services |
| `app/exceptions.py` | Custom exception classes — use these, don't raise generic exceptions |
| `app/config.py` | Settings (loaded from env) — never hardcode config values |

## Rules for Agents

1. Read only files in your scope unless cross-module understanding is needed
2. Business logic goes in `app/services/`, not in route handlers
3. Never access `request` objects inside services — pass data as plain arguments
4. All DB access goes through `app/db/` — never import SQLAlchemy models in routes
5. Secrets come from `app/config.py` (env vars) — never hardcode credentials
6. All exceptions must be typed using classes from `app/exceptions.py`
