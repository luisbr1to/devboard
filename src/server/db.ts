import { Pool, type QueryResultRow } from "pg";
export interface Connection {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  release(): void;
}
export interface Database {
  connect(): Promise<Connection>;
  query: Connection["query"];
}
export function createDatabase(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
}
export async function transaction<T>(
  db: Database,
  run: (client: Connection) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
