# P0-3 Database Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight database layer and migration runner for the PPT AI app, creating the five tables defined in `app/ppt-ai-app-integration-design.md` §9.

**Architecture:** Use a tiny driver abstraction with SQLite for local development and PostgreSQL support via lazy-loaded `pg` for production. Store migrations as portable SQL files and track applied files in `schema_migrations`.

**Tech Stack:** Node.js ESM, Node built-in `node:sqlite` for SQLite, optional `pg` package for PostgreSQL, Node built-in `node:test`.

## Global Constraints

- Active code lives in `ppt-ai-app/`.
- Do not write secrets to files; `DATABASE_URL` defaults to local SQLite.
- Keep dependencies minimal; SQLite must work without installing packages.
- JSON columns are stored as text for SQLite/PostgreSQL portability.
- IDs use text UUIDs; timestamps use epoch milliseconds.
- Preserve existing tests and behavior.

---

### Task 1: Add Database Configuration Tests

**Files:**
- Modify: `ppt-ai-app/test/config.test.js`
- Modify later: `ppt-ai-app/src/config.js`

**Interfaces:**
- Produces expectation: `loadConfig(env).databaseUrl` defaults to `sqlite:./data/ppt-ai.db`.
- Produces expectation: `DATABASE_URL` overrides the default.

- [ ] **Step 1: Write failing tests**

Add assertions to `test/config.test.js`:

```js
assert.equal(config.databaseUrl, "sqlite:./data/ppt-ai.db");

const config = loadConfig({
  MOLING_API_BASE_URL: "http://platform.test",
  INTERNAL_API_TOKEN: "token",
  DATABASE_URL: "sqlite::memory:",
});
assert.equal(config.databaseUrl, "sqlite::memory:");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ppt-ai-app && node --test test/config.test.js`
Expected: FAIL because `databaseUrl` is `undefined`.

- [ ] **Step 3: Implement minimal config change**

In `src/config.js`, return:

```js
databaseUrl: env.DATABASE_URL || "sqlite:./data/ppt-ai.db",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ppt-ai-app && node --test test/config.test.js`
Expected: PASS.

### Task 2: Add SQLite Driver and Migration Runner

**Files:**
- Create: `ppt-ai-app/src/db/sqlite-driver.js`
- Create: `ppt-ai-app/src/db/migrate.js`
- Create: `ppt-ai-app/src/db/migrations/0001_init.sql`
- Create: `ppt-ai-app/test/db.test.js`

**Interfaces:**
- `openSqliteDatabase(databaseUrl)` returns `{ dialect, query(sql, params), run(sql, params), close() }`.
- `runMigrations({ databaseUrl, migrationsDir })` applies pending `.sql` files and returns `{ applied, skipped }`.

- [ ] **Step 1: Write failing migration test**

Create `test/db.test.js` with tests that call `runMigrations({ databaseUrl: "sqlite::memory:" })`, assert the five application tables exist, and assert a second run skips already applied migrations.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ppt-ai-app && node --test test/db.test.js`
Expected: FAIL with missing `../src/db/migrate.js`.

- [ ] **Step 3: Implement SQLite driver, migration runner, and init SQL**

Use `node:sqlite` `DatabaseSync`. Create `schema_migrations`, split migration SQL on statement boundaries, apply each file inside a transaction, and insert the filename after success.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ppt-ai-app && node --test test/db.test.js`
Expected: PASS.

### Task 3: Add Driver Selection and CLI Script

**Files:**
- Create: `ppt-ai-app/src/db/index.js`
- Create: `ppt-ai-app/src/db/pg-driver.js`
- Create: `ppt-ai-app/scripts/migrate.js`
- Modify: `ppt-ai-app/package.json`
- Modify: `ppt-ai-app/test/db.test.js`

**Interfaces:**
- `openDatabase(databaseUrl)` selects SQLite for `sqlite:` URLs and PostgreSQL for `postgres:`/`postgresql:` URLs.
- `npm run migrate` runs `scripts/migrate.js` against `DATABASE_URL` or the default.

- [ ] **Step 1: Write failing driver selection tests**

Extend `test/db.test.js` to assert `openDatabase("sqlite::memory:").dialect === "sqlite"` and unsupported schemes throw `Unsupported DATABASE_URL scheme`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ppt-ai-app && node --test test/db.test.js`
Expected: FAIL with missing `../src/db/index.js`.

- [ ] **Step 3: Implement driver selection and CLI**

Add `openDatabase`, a lazy `pg` driver that throws a clear install message if `pg` is absent, `scripts/migrate.js`, and package scripts: `"migrate": "node scripts/migrate.js"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ppt-ai-app && node --test test/db.test.js`
Expected: PASS.

### Task 4: Document Database Setup and Verify Commands

**Files:**
- Modify: `ppt-ai-app/.env.example`
- Modify: `ppt-ai-app/README.md`
- Modify: `ppt-ai-app/package.json`

**Interfaces:**
- Developers see `DATABASE_URL=sqlite:./data/ppt-ai.db` in `.env.example`.
- README documents `npm run migrate` and PostgreSQL URL format.

- [ ] **Step 1: Update docs and engine requirement**

Add `DATABASE_URL` to `.env.example`, document migration commands in README, and set `engines.node` to `>=24` because this implementation uses `node:sqlite`.

- [ ] **Step 2: Run final verifications**

Run:

```bash
cd ppt-ai-app
node --test test/config.test.js
node --test test/platform-client.test.js
node --test test/db.test.js
npm run migrate -- --database-url sqlite::memory:
```

Expected: all commands exit 0. Note that `test/http-app.test.js` is a known pre-existing baseline hang and is excluded from P0-3 verification until fixed separately.
