import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "pg";

export const e2eDatabaseName = "testhub_e2e";

function configuredUrl() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL é obrigatório para os testes end-to-end.");
  return new URL(process.env.DATABASE_URL);
}

export function e2eDatabaseUrl() {
  const url = configuredUrl();
  url.pathname = `/${e2eDatabaseName}`;
  return url.toString();
}

export async function recreateE2eDatabase() {
  const adminUrl = configuredUrl();
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query("DROP DATABASE IF EXISTS testhub_e2e WITH (FORCE)");
    await admin.query("CREATE DATABASE testhub_e2e");
  } finally {
    await admin.end();
  }
  const database = new Client({ connectionString: e2eDatabaseUrl() });
  await database.connect();
  try {
    await database.query("BEGIN");
    await database.query(
      "CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("migrations"))
      .filter((entry) => entry.endsWith(".sql"))
      .sort()) {
      await database.query(await readFile(`migrations/${name}`, "utf8"));
      await database.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
        name,
      ]);
    }
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    await database.end();
  }
}
