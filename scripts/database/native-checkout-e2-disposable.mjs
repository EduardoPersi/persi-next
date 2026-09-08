import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");
if (process.env.HARNESS_SELF_TEST_ONLY !== "1") throw new Error("E2_DISPOSABLE_RUNNER_SELF_TEST_ONLY");
const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-e2h-${crypto.randomBytes(6).toString("hex")}`;
const adminPassword = crypto.randomBytes(32).toString("base64url");
const appPassword = crypto.randomBytes(32).toString("base64url");

function run(command, args, { input, env = process.env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${quiet ? "output redacted" : `${stderr.trim()}\n${stdout.trim()}`}`)));
    child.stdin.end(input);
  });
}

const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.unref(); server.on("error", reject);
  server.listen(0, host, () => { const address = server.address(); server.close(() => resolve(address.port)); });
});
assert.notEqual(port, 15422);
let created = false;
try {
  await run("docker", ["image", "inspect", image]);
  await run("docker", ["run", "-d", "--pull", "never", "--name", container, "-p", `${host}:${port}:5432`, "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=1g", "-e", `POSTGRES_PASSWORD=${adminPassword}`, image], { quiet: true });
  created = true;
  let consecutiveReady = 0;
  for (let attempt = 0; attempt < 180; attempt++) {
    try {
      const logs = await run("docker", ["logs", container]);
      const probe = await run("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-Atc", "select (current_setting('server_version_num')::int>=170000 and to_regnamespace('extensions') is not null and to_regrole('supabase_admin') is not null)::text"]);
      consecutiveReady = logs.stdout.includes("PostgreSQL init process complete; ready for start up.") && probe.stdout.trim() === "true" ? consecutiveReady + 1 : 0;
      if (consecutiveReady >= 3) break;
    } catch { consecutiveReady = 0; }
    if (attempt === 179) throw new Error("DISPOSABLE_POSTGRES_NOT_READY");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const migrations = fs.readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.length, 31); assert.ok(migrations.at(-1).startsWith("20260907180000_"));
  for (const name of migrations) await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync(`supabase/migrations/${name}`, "utf8") });
  const versions = migrations.map((name) => name.slice(0, 14));
  const historySql = `create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key); ${versions.map((version) => `insert into supabase_migrations.schema_migrations(version) values('${version}') on conflict do nothing;`).join(" ")}`;
  await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: historySql });
  const escaped = appPassword.replaceAll("'", "''");
  await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: `create role persi_e2_app_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${escaped}'; grant connect on database postgres to persi_e2_app_login; grant persi_app to persi_e2_app_login with admin false, inherit false, set true;` });
  const adminUrl = `postgresql://postgres:${encodeURIComponent(adminPassword)}@${host}:${port}/postgres`;
  const appUrl = `postgresql://persi_e2_app_login:${encodeURIComponent(appPassword)}@${host}:${port}/postgres`;
  const execution = await run(process.execPath, ["--conditions=react-server", "--experimental-loader", "./scripts/database/typescript-loader.mjs", "scripts/database/native-checkout-e2-concurrency.mjs"], { env: { ...process.env, PERSI_DISPOSABLE_DATABASE: "1", PERSI_OFFLINE_VALIDATION: "1", HARNESS_SELF_TEST_ONLY: "1", E2_CYCLES: "2", PERSI_E2_ADMIN_DATABASE_URL: adminUrl, PERSI_E2_APP_DATABASE_URL: appUrl } });
  process.stdout.write(execution.stdout); process.stderr.write(execution.stderr);
} finally {
  if (created) await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
}
