-- AI Canvas persistence schema (SQLite, migration 001)
-- Chose SQLite via better-sqlite3 for the MVP: zero external services, synchronous API,
-- and a relational schema that maps 1:1 onto PostgreSQL if migrated later.

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  viewport   TEXT NOT NULL DEFAULT '{}',       -- JSON {x,y,zoom}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('aiChat','note','idea','summary','task')),
  title          TEXT NOT NULL DEFAULT '',
  x              REAL NOT NULL DEFAULT 0,
  y              REAL NOT NULL DEFAULT 0,
  width          REAL NOT NULL DEFAULT 360,
  height         REAL NOT NULL DEFAULT 260,
  content        TEXT NOT NULL DEFAULT '',            -- note/idea/task/summary body
  model          TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  temperature    REAL NOT NULL DEFAULT 0.7,
  parent_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  origin         TEXT,                                -- JSON {messageId?, fragment?} branch provenance
  context_mode   TEXT NOT NULL DEFAULT 'current' CHECK (context_mode IN ('current','parent','selected','workspace')),
  context_nodes  TEXT NOT NULL DEFAULT '[]',          -- JSON string[] for 'selected' mode
  collapsed      INTEGER NOT NULL DEFAULT 0,
  hidden         INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'idle',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_workspace ON nodes(workspace_id);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL DEFAULT '',
  pending    INTEGER NOT NULL DEFAULT 0,              -- assistant reply not finished (generation error/interrupt)
  tokens     INTEGER,                                 -- approximate token count when available
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_node ON messages(node_id);

CREATE TABLE IF NOT EXISTS edges (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'related' CHECK (kind IN ('parent','related','derived')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_edges_workspace ON edges(workspace_id);
