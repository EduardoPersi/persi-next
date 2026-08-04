import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stdin, stdout } from "node:process";

const TIMEOUT_MS = 15_000;

const color = {
  green: (value: string) => `\u001b[32m${value}\u001b[0m`,
  yellow: (value: string) => `\u001b[33m${value}\u001b[0m`,
  red: (value: string) => `\u001b[31m${value}\u001b[0m`,
  bold: (value: string) => `\u001b[1m${value}\u001b[0m`,
};

interface RequestResult {
  status: number;
  durationMs: number;
  headers: Headers;
  data: unknown;
}

interface JwtPayload {
  alg?: unknown;
  typ?: unknown;
  iss?: unknown;
  iat?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  user_email?: unknown;
  user_id?: unknown;
  display_name?: unknown;
}

interface DiagnosticSummary {
  wordpress: string;
  endpoint: string;
  connection: string;
  plugin: string;
  token: string;
  validation: string;
  user: string;
  session: string;
  result: string;
}

function loadLocalEnvironment() {
  if (process.env.WORDPRESS_URL) return;

  const loadEnvFile = (
    process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }
  ).loadEnvFile;

  try {
    loadEnvFile?.(".env.local");
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code !== "ENOENT") throw error;
  }
}

class MaskedOutput extends Writable {
  muted = false;

  _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (!this.muted) {
      stdout.write(chunk, encoding);
    }
    callback();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAsString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function printHeader(title: string) {
  console.log("\n======================================");
  console.log(color.bold(title));
  console.log("======================================");
}

function printStep(title: string) {
  console.log(`\n${color.bold(title)}`);
}

function printField(label: string, value: unknown) {
  console.log(`${label}: ${String(value)}`);
}

function describeHttpError(status: number, data: unknown): string {
  const record = isRecord(data) ? data : undefined;
  const code = valueAsString(record?.code)?.toLowerCase() ?? "";
  const message = valueAsString(record?.message) ?? "";
  const combined = `${code} ${message}`.toLowerCase();

  if (status === 401 && /incorrect_password|senha/.test(combined)) return "Senha incorreta";
  if (status === 401 && /invalid_username|unknown_email|usu.rio|email/.test(combined)) return "Usuário inexistente ou e-mail inválido";
  if (status === 401) return "Não autorizado (401)";
  if (status === 403) return "Acesso proibido (403)";
  if (status === 404) return "Endpoint inexistente ou plugin JWT inativo (404)";
  if (/bad_config|not configur|secret|key|chave/.test(combined)) {
    return `Secret Key JWT ausente ou inválida (${status})`;
  }
  if (status >= 500) return `Erro interno do WordPress (${status})`;
  return message ? `${message} (${status})` : `Erro HTTP ${status}`;
}

async function request(url: string, init?: RequestInit): Promise<RequestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }

    return {
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      headers: response.headers,
      data,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timeout após ${TIMEOUT_MS / 1000} segundos`);
    }
    const message = error instanceof Error ? error.message : "Erro de conexão desconhecido";
    throw new Error(`Falha de rede, DNS, TLS ou CORS: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeJwt(token: string): JwtPayload | null {
  const [headerPart, payloadPart] = token.split(".");
  if (!headerPart || !payloadPart) return null;

  try {
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as unknown;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as unknown;
    if (!isRecord(header) || !isRecord(payload)) return null;

    return {
      alg: header.alg,
      typ: header.typ,
      iss: payload.iss,
      iat: payload.iat,
      exp: payload.exp,
      nbf: payload.nbf,
      sub: payload.sub,
      user_email: payload.user_email,
      user_id: payload.user_id,
      display_name: payload.display_name,
    };
  } catch {
    return null;
  }
}

function printJwtClaims(payload: JwtPayload) {
  const fields: Array<keyof JwtPayload> = [
    "alg",
    "typ",
    "iss",
    "iat",
    "exp",
    "nbf",
    "sub",
    "user_email",
    "user_id",
    "display_name",
  ];

  for (const field of fields) {
    if (payload[field] !== undefined && payload[field] !== null) {
      printField(field, payload[field]);
    }
  }
}

function maskToken(token: string): string {
  if (token.length <= 20) return `${token.slice(0, 4)}...${token.slice(-4)}`;
  return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

function findToken(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  return valueAsString(data.token) ?? valueAsString(data.data && isRecord(data.data) ? data.data.token : undefined);
}

function formatRoles(value: unknown): string {
  if (Array.isArray(value)) return value.filter((role): role is string => typeof role === "string").join(", ") || "Não informado";
  if (isRecord(value)) return Object.keys(value).join(", ") || "Não informado";
  return valueAsString(value) ?? "Não informado";
}

async function askCredentials(): Promise<{ email: string; password: string }> {
  const output = new MaskedOutput();
  const terminal = Boolean(stdin.isTTY && stdout.isTTY);
  const readline = createInterface({ input: stdin, output, terminal });

  try {
    const email = (await readline.question("E-mail: ")).trim();
    stdout.write("Senha: ");
    output.muted = true;
    const password = await readline.question("");
    output.muted = false;
    stdout.write("\n");
    return { email, password };
  } finally {
    output.muted = false;
    readline.close();
  }
}

async function main() {
  printHeader("JWT DIAGNOSTIC");
  loadLocalEnvironment();

  const rawWordpressUrl = process.env.WORDPRESS_URL?.trim();
  if (!rawWordpressUrl) {
    console.error(color.red("WORDPRESS_URL não está definida no ambiente."));
    process.exitCode = 1;
    return;
  }

  let wordpressUrl: string;
  try {
    const parsedUrl = new URL(rawWordpressUrl);
    if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("Protocolo inválido");
    wordpressUrl = parsedUrl.toString().replace(/\/$/, "");
  } catch {
    console.error(color.red("WORDPRESS_URL é inválida. Use uma URL HTTP ou HTTPS completa."));
    process.exitCode = 1;
    return;
  }

  const restUrl = `${wordpressUrl}/wp-json`;
  const namespaceUrl = `${restUrl}/jwt-auth/v1`;
  const tokenUrl = `${namespaceUrl}/token`;
  const validateUrl = `${tokenUrl}/validate`;
  const userUrl = `${restUrl}/wp/v2/users/me`;
  const summary: DiagnosticSummary = {
    wordpress: wordpressUrl,
    endpoint: tokenUrl,
    connection: "Não testada",
    plugin: "Não testado",
    token: "Não testado",
    validation: "Não testada",
    user: "Não consultado",
    session: "Não alterada (sem cookies)",
    result: "Falha",
  };

  printField("WordPress URL", wordpressUrl);
  printField("JWT Endpoint", tokenUrl);

  try {
    printStep("TESTE 1 — WordPress REST API");
    console.log("Testando conexão...");
    const root = await request(restUrl);
    printField("HTTP", root.status);
    printField("Tempo", `${root.durationMs} ms`);
    if (root.status < 200 || root.status >= 300) throw new Error(describeHttpError(root.status, root.data));
    if (!isRecord(root.data)) throw new Error("Resposta inválida da API REST do WordPress");

    const namespaces = Array.isArray(root.data.namespaces)
      ? root.data.namespaces.filter((item): item is string => typeof item === "string")
      : [];
    const version = valueAsString(root.data.version) ?? root.headers.get("x-wordpress-version") ?? "Não informada pela API";
    const corsHeader = root.headers.get("access-control-allow-origin");
    printField("Versão WordPress", version);
    printField("Namespaces", namespaces.length ? namespaces.join(", ") : "Não informados");
    printField(
      "CORS",
      corsHeader
        ? `Cabeçalho Access-Control-Allow-Origin: ${corsHeader}`
        : "Cabeçalho não informado (fetch no terminal não aplica bloqueio CORS)",
    );
    summary.connection = `OK (${root.status}, ${root.durationMs} ms)`;

    printStep("TESTE 2 — Namespace JWT");
    const namespace = await request(namespaceUrl);
    printField("HTTP", namespace.status);
    printField("Tempo", `${namespace.durationMs} ms`);
    if (namespace.status === 404) throw new Error("Endpoint inexistente ou plugin JWT inativo (404)");
    if (namespace.status < 200 || namespace.status >= 300) throw new Error(describeHttpError(namespace.status, namespace.data));
    console.log(color.green("✓ Endpoint encontrado"));
    summary.plugin = "JWT ativo / endpoint encontrado";

    const { email, password } = await askCredentials();
    if (!email || !password) throw new Error("E-mail e senha são obrigatórios");

    printStep("TESTE 3 — Solicitação do token");
    const tokenResponse = await request(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password }),
    });
    printField("HTTP Status", tokenResponse.status);
    printField("Tempo", `${tokenResponse.durationMs} ms`);
    if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
      throw new Error(describeHttpError(tokenResponse.status, tokenResponse.data));
    }

    const token = findToken(tokenResponse.data);
    if (!token) throw new Error("Resposta inválida: token ausente");
    console.log(color.green("✓ Token recebido"));
    printField("Token", maskToken(token));
    summary.token = `Recebido (${maskToken(token)})`;

    printStep("TESTE 4 — Validação do token");
    const validation = await request(validateUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    printField("HTTP Status", validation.status);
    printField("Tempo", `${validation.durationMs} ms`);
    if (validation.status < 200 || validation.status >= 300) {
      summary.validation = "Token inválido";
      throw new Error(`Token inválido: ${describeHttpError(validation.status, validation.data)}`);
    }
    console.log(color.green("✓ Token válido"));
    summary.validation = "Token válido";

    printStep("TESTE 5 — Conteúdo local do JWT (assinatura não verificada)");
    const payload = decodeJwt(token);
    if (!payload) throw new Error("Resposta inválida: JWT não pôde ser decodificado");
    printJwtClaims(payload);

    printStep("TESTE 6 — Expiração");
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      console.log(color.yellow("Expiração não informada no JWT"));
    } else {
      const remainingMinutes = Math.floor((payload.exp * 1000 - Date.now()) / 60_000);
      if (remainingMinutes <= 0) {
        console.log(color.red("Token expirado."));
        throw new Error("Token expirado");
      }
      printField("Expira em", `${remainingMinutes} minutos`);
    }

    printStep("TESTE 7 — Usuário atual");
    const userResponse = await request(userUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    printField("HTTP Status", userResponse.status);
    printField("Tempo", `${userResponse.durationMs} ms`);
    if (userResponse.status < 200 || userResponse.status >= 300) {
      throw new Error(describeHttpError(userResponse.status, userResponse.data));
    }
    if (!isRecord(userResponse.data)) throw new Error("Resposta inválida ao consultar o usuário");

    printField("ID", userResponse.data.id ?? "Não informado");
    printField("Nome", userResponse.data.name ?? "Não informado");
    printField("Display Name", userResponse.data.display_name ?? userResponse.data.name ?? "Não informado");
    printField("Email", userResponse.data.email ?? "Não informado");
    printField("Roles", formatRoles(userResponse.data.roles));
    summary.user = `Consultado (ID ${String(userResponse.data.id ?? "não informado")})`;
    summary.result = "Sucesso";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error(color.red(`\n✗ ${message}`));
    summary.result = `Falha: ${message}`;
    process.exitCode = 1;
  } finally {
    printHeader("RESUMO");
    printField("WordPress", summary.wordpress);
    printField("Endpoint", summary.endpoint);
    printField("Tempo / conexão", summary.connection);
    printField("Plugin JWT", summary.plugin);
    printField("Token", summary.token);
    printField("Validação", summary.validation);
    printField("Usuário", summary.user);
    printField("Sessão", summary.session);
    const resultColor = summary.result === "Sucesso" ? color.green : color.red;
    printField("Resultado final", resultColor(summary.result));
    console.log("======================================\n");
  }
}

void main();
