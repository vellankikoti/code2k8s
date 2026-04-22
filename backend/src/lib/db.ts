import pg from "pg";
import { config } from "../config.js";

export const db = new pg.Pool({ connectionString: config.databaseUrl });

export async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS deployments (
      id           TEXT PRIMARY KEY,
      slug         TEXT UNIQUE NOT NULL,
      repo_url     TEXT NOT NULL,
      branch       TEXT NOT NULL DEFAULT 'main',
      port         INTEGER NOT NULL DEFAULT 3000,
      image        TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      url          TEXT,
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at   TIMESTAMPTZ,
      min_replicas INTEGER NOT NULL DEFAULT 2,
      max_replicas INTEGER NOT NULL DEFAULT 10
    );
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS min_replicas INTEGER NOT NULL DEFAULT 2;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS max_replicas INTEGER NOT NULL DEFAULT 10;
    CREATE TABLE IF NOT EXISTS databases (
      id            TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL,
      env_var       TEXT NOT NULL DEFAULT 'DATABASE_URL',
      secret_name   TEXT NOT NULL,
      service_name  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      error         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at    TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_databases_env
      ON databases(deployment_id, env_var) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS events (
      id           BIGSERIAL PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      level        TEXT NOT NULL DEFAULT 'info',
      message      TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_events_dep ON events(deployment_id, id);
  `);
}

export type DeploymentStatus =
  | "pending"
  | "building"
  | "deploying"
  | "live"
  | "failed"
  | "deleting"
  | "deleted";

export interface Deployment {
  id: string;
  slug: string;
  repo_url: string;
  branch: string;
  port: number;
  image: string | null;
  status: DeploymentStatus;
  url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  min_replicas: number;
  max_replicas: number;
}

export type DatabaseKind = "postgres";
export type DatabaseStatus = "pending" | "provisioning" | "ready" | "failed" | "deleting" | "deleted";

export interface Database {
  id: string;
  deployment_id: string;
  kind: DatabaseKind;
  env_var: string;
  secret_name: string;
  service_name: string;
  status: DatabaseStatus;
  error: string | null;
  created_at: string;
  deleted_at: string | null;
}
