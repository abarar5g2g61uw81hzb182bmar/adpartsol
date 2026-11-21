/**
 * D1-compatible wrapper around Turso / libSQL.
 * Existing code can keep using env.DB.prepare(...).bind(...).first|all|run|batch
 */
import { createClient } from "@libsql/client";

function makeStmt(client, sql, boundArgs) {
  const args = boundArgs || [];
  return {
    bind(...nextArgs) {
      return makeStmt(client, sql, nextArgs);
    },
    async first() {
      const r = await client.execute({ sql, args });
      const row = r.rows[0];
      if (!row) return null;
      return { ...row };
    },
    async all() {
      const r = await client.execute({ sql, args });
      return { results: r.rows.map((row) => ({ ...row })) };
    },
    async run() {
      const r = await client.execute({ sql, args });
      return {
        success: true,
        meta: {
          changes: Number(r.rowsAffected || 0),
          last_row_id: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : 0
        }
      };
    }
  };
}

export function createTursoDB(url, authToken) {
  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
  }
  const client = createClient({ url, authToken });

  return {
    prepare(sql) {
      return makeStmt(client, sql, []);
    },
    async batch(statements) {
      const results = [];
      for (const stmt of statements) {
        if (typeof stmt.run === "function") {
          results.push(await stmt.run());
        } else if (stmt && stmt.sql) {
          results.push(
            await client.execute({ sql: stmt.sql, args: stmt.args || [] })
          );
        }
      }
      return results;
    },
    _client: client
  };
}

/** Build env object for handlers: process.env + DB binding */
export function buildEnv() {
  const env = { ...process.env };
  env.DB = createTursoDB(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  return env;
}
