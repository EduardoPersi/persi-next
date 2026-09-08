export const LOCAL_DATABASE_HOST = "127.0.0.1";
export const LOCAL_DATABASE_PORT = 15422;
export const LOCAL_DATABASE_NAME = "postgres";

const LOCAL_DEFAULT_URL = `postgresql://postgres:postgres@${LOCAL_DATABASE_HOST}:${LOCAL_DATABASE_PORT}/${LOCAL_DATABASE_NAME}`;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function assertLocalDatabaseUrl(value) {
  const url = new URL(value);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("PERSI_LOCAL_DATABASE_URL_MUST_USE_LOOPBACK");
  }
  return url.toString();
}

export function localDatabaseUrl(environment = process.env) {
  const explicit = environment.PERSI_LOCAL_DATABASE_URL?.trim();
  if (explicit) return assertLocalDatabaseUrl(explicit);
  if (environment.NODE_ENV === "production") {
    throw new Error("PERSI_LOCAL_DATABASE_URL_REQUIRED_IN_PRODUCTION");
  }
  return LOCAL_DEFAULT_URL;
}
