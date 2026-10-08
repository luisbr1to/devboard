import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { createDatabase, transaction } from "../src/server/db";
async function migrate() {
  const db = createDatabase();
  try {
    if (!process.env.DATABASE_URL)
      throw new Error("Configure DATABASE_URL antes de executar as migrações.");
    await transaction(db, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(3978001)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const applied = new Set(
        (await client.query("SELECT name FROM schema_migrations")).rows.map(
          (row) => row.name,
        ),
      );
      for (const name of (await readdir("migrations"))
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        if (applied.has(name)) continue;
        await client.query(await readFile(`migrations/${name}`, "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
          name,
        ]);
        console.log(`Aplicada: ${name}`);
      }
    });
  } finally {
    await db.end();
  }
}
void migrate().catch((error) => {
  console.error("Migração falhou:", error.message);
  process.exitCode = 1;
});
