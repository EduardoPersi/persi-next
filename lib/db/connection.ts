import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

type PersiDatabase = PostgresJsDatabase<typeof schema>;
type DatabaseState = { client?: Sql; db?: PersiDatabase };

const globalDatabase = globalThis as typeof globalThis & {
  __persiDatabase?: DatabaseState;
};

function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL não está configurada no servidor.");
  return value;
}

export function getDatabase(): PersiDatabase {
  const state = (globalDatabase.__persiDatabase ??= {});
  if (state.db) return state.db;

  state.client = postgres(getDatabaseUrl(), {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  state.db = drizzle(state.client, { schema });
  return state.db;
}

export async function closeDatabaseForTests(): Promise<void> {
  const state = globalDatabase.__persiDatabase;
  await state?.client?.end({ timeout: 5 });
  globalDatabase.__persiDatabase = undefined;
}

export type { PersiDatabase };
