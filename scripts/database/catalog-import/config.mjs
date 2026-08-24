import fs from "node:fs";

export const STAGING_PROJECT_REF = "vtrujmhhkmvjzfklzxip";

export function readPrivateEnvironment() {
  const paths = [".env.staging.local", ".env.local"].filter((path) => fs.existsSync(path));
  const values = new Map();
  for (const path of paths.reverse()) {
    for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values.set(match[1], match[2].trim().replace(/^(['"])(.*)\1$/, "$2"));
    }
  }
  const required = (name) => {
    const value = values.get(name);
    if (!value) throw new Error(`${name} não configurada.`);
    return value;
  };
  return {
    wordpressUrl: required("WORDPRESS_URL"),
    wooKey: required("WOOCOMMERCE_CONSUMER_KEY"),
    wooSecret: required("WOOCOMMERCE_CONSUMER_SECRET"),
    stagingPassword: required("PERSI_STAGING_DB_PASSWORD"),
  };
}

export function stagingDirectUrl(password) {
  const url = new URL(`postgresql://postgres@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`);
  url.password = password;
  return url.toString();
}

export function parseArguments(argv) {
  const options = { dryRun: false, limit: undefined, productId: undefined, sku: undefined, resume: false };
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--resume") options.resume = true;
    else if (argument.startsWith("--limit=")) options.limit = Number(argument.slice(8));
    else if (argument.startsWith("--product-id=")) options.productId = Number(argument.slice(13));
    else if (argument.startsWith("--sku=")) options.sku = argument.slice(6);
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("--limit inválido.");
  if (options.productId !== undefined && (!Number.isInteger(options.productId) || options.productId < 1)) throw new Error("--product-id inválido.");
  return options;
}
