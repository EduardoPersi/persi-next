import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCanonicalAccountRequest,
  signAccountRequest,
} from "../lib/account/hmac.ts";
import {
  ACCOUNT_SESSION_COOKIE,
  getAccountSessionCookieOptions,
} from "../lib/account/sessionCookie.ts";
import { getAccountGreetingName } from "../lib/account/display.ts";
import {
  getHeaderAccountAction,
  isAccountRoute,
  isPublicAccountAuthRoute,
} from "../lib/account/headerNavigation.ts";
import {
  parseAccountLoginPayload,
  validateMutationSource,
} from "../lib/account/validation.ts";
import {
  AccountServiceError,
  getAccountClientConfig,
} from "../services/account/client.ts";
import {
  getAccountSession,
  loginAccount,
  logoutAccount,
} from "../services/account/auth.ts";

const config = {
  endpoint: "https://persimateriais.com.br/wp-json/persi-account/v1",
  keyId: "primary",
  origin: "https://app.persimateriais.com.br",
  secret: "test-only-account-secret",
};
const token = "A".repeat(43);
const profile = {
  firstName: "Ana",
  displayName: "Ana Cliente",
  email: "ana@example.test",
};

test("HMAC assina POST com corpo e caminho canônico correto", () => {
  const rawBody =
    '{"identifier":"ana","password":"senha","remember":false}';
  const result = signAccountRequest(
    {
      method: "POST",
      path: "/wp-json/persi-account/v1/login",
      rawBody,
    },
    config,
    { timestamp: "1800000000", nonce: "AbCdEfGhIjKlMnOpQrStUv" },
  );

  assert.equal(
    result.canonicalRequest,
    buildCanonicalAccountRequest({
      method: "POST",
      path: "/wp-json/persi-account/v1/login",
      rawBody,
      timestamp: "1800000000",
      nonce: "AbCdEfGhIjKlMnOpQrStUv",
      origin: config.origin,
    }),
  );
  assert.match(result.headers["X-Persi-Signature"], /^v1=[a-f0-9]{64}$/);
  assert.equal(result.canonicalRequest.endsWith("\n"), false);
});

test("HMAC de GET usa corpo vazio e SHA-256 do vazio", () => {
  const canonical = buildCanonicalAccountRequest({
    method: "GET",
    path: "/wp-json/persi-account/v1/session",
    rawBody: "",
    timestamp: "1800000000",
    nonce: "AbCdEfGhIjKlMnOpQrStUv",
    origin: config.origin,
  });
  assert.equal(
    canonical.split("\n").at(-1),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("configuração rejeita segredo ausente e endpoint inválido", () => {
  assert.throws(
    () =>
      getAccountClientConfig({
        PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID: "primary",
        PERSI_HEADLESS_ACCOUNT_ORIGIN: config.origin,
        PERSI_HEADLESS_ACCOUNT_ENDPOINT: config.endpoint,
      }),
    AccountServiceError,
  );
  assert.throws(
    () =>
      getAccountClientConfig({
        PERSI_HEADLESS_ACCOUNT_HMAC_SECRET: "test",
        PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID: "primary",
        PERSI_HEADLESS_ACCOUNT_ORIGIN: config.origin,
        PERSI_HEADLESS_ACCOUNT_ENDPOINT: "https://example.test/account",
      }),
    AccountServiceError,
  );
});

test("login valida contrato fechado sem normalizar senha", () => {
  const parsed = parseAccountLoginPayload(
    '{"identifier":"  ana  ","password":"  senha  ","remember":true}',
  );
  assert.equal(parsed.identifier, "ana");
  assert.equal(parsed.password, "  senha  ");
  assert.throws(() =>
    parseAccountLoginPayload(
      '{"identifier":"ana","password":"senha","remember":false,"role":"admin"}',
    ),
  );
});

test("origem ou referer são obrigatórios nas mutações", () => {
  assert.equal(
    validateMutationSource(
      new Headers({ Origin: config.origin }),
      config.origin,
    ),
    true,
  );
  assert.equal(
    validateMutationSource(
      new Headers({ Referer: `${config.origin}/entrar` }),
      config.origin,
    ),
    true,
  );
  assert.equal(
    validateMutationSource(
      new Headers({ Origin: "https://evil.example" }),
      config.origin,
    ),
    false,
  );
});

test("login aceita sucesso, preserva token apenas na camada interna e mapeia falha", async () => {
  let sentBody = "";
  const successFetch = async (_url, init) => {
    sentBody = String(init.body);
    return Response.json({
      authenticated: true,
      sessionToken: token,
      expiresAt: "2030-01-01T00:00:00+00:00",
      customer: profile,
    });
  };
  const result = await loginAccount(
    { identifier: "ana", password: "senha", remember: false },
    { config, fetchImplementation: successFetch },
  );
  assert.equal(result.sessionToken, token);
  assert.equal(JSON.parse(sentBody).password, "senha");

  await assert.rejects(
    loginAccount(
      { identifier: "ana", password: "errada", remember: false },
      {
        config,
        fetchImplementation: async () =>
          Response.json({}, { status: 401 }),
      },
    ),
    (error) => error instanceof AccountServiceError && error.status === 401,
  );
});

test("login aceita e-mail e nome de usuário no mesmo contrato", async () => {
  for (const identifier of ["ana@example.test", "ana"]) {
    let sentBody;
    await loginAccount(
      { identifier, password: "senha-correta", remember: false },
      {
        config,
        fetchImplementation: async (_url, init) => {
          sentBody = JSON.parse(String(init.body));
          return Response.json({
            authenticated: true,
            sessionToken: token,
            expiresAt: "2030-01-01T00:00:00+00:00",
            customer: profile,
          });
        },
      },
    );
    assert.deepEqual(sentBody, {
      identifier,
      password: "senha-correta",
      remember: false,
    });
  }
});

test("login preserva diagnóstico seguro do WordPress", async () => {
  await assert.rejects(
    loginAccount(
      { identifier: "ana", password: "incorreta", remember: false },
      {
        config,
        fetchImplementation: async () =>
          Response.json(
            {
              message: "Resposta genérica",
              code: "ACCOUNT_LOGIN_CREDENTIALS_REJECTED",
            },
            { status: 401 },
          ),
      },
    ),
    (error) =>
      error instanceof AccountServiceError &&
      error.status === 401 &&
      error.code === "ACCOUNT_LOGIN_CREDENTIALS_REJECTED" &&
      !error.message.includes("incorreta"),
  );
});

test("sessão cobre válida e inválida sem devolver token", async () => {
  const valid = await getAccountSession(token, {
    config,
    fetchImplementation: async (_url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(init.headers["X-Persi-Session"], token);
      assert.equal(init.body, undefined);
      return Response.json({
        authenticated: true,
        expiresAt: "2030-01-01T00:00:00+00:00",
        customer: profile,
      });
    },
  });
  assert.equal(valid.authenticated, true);
  assert.equal("sessionToken" in valid, false);

  const invalid = await getAccountSession(token, {
    config,
    fetchImplementation: async () =>
      Response.json({ authenticated: false }),
  });
  assert.deepEqual(invalid, { authenticated: false });
});

test("logout envia sessão e informa indisponibilidade sem criar estado local", async () => {
  await logoutAccount(token, {
    config,
    fetchImplementation: async (_url, init) => {
      assert.equal(init.headers["X-Persi-Session"], token);
      return Response.json({ authenticated: false });
    },
  });
  await assert.rejects(
    logoutAccount(token, {
      config,
      fetchImplementation: async () => {
        throw new Error("offline");
      },
    }),
    AccountServiceError,
  );
});

test("cookie é HttpOnly, host-only e contém apenas o token opaco", () => {
  const options = getAccountSessionCookieOptions({
    isProduction: true,
    remember: true,
    expiresAt: "2030-01-01T00:00:00+00:00",
  });
  assert.equal(ACCOUNT_SESSION_COOKIE, "__Host-persi_account_session");
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal("domain" in options, false);
});

test("rotas públicas não expõem token e sempre removem cookie no logout", async () => {
  const loginRoute = await readFile(
    new URL("../app/api/account/login/route.ts", import.meta.url),
    "utf8",
  );
  const sessionRoute = await readFile(
    new URL("../app/api/account/session/route.ts", import.meta.url),
    "utf8",
  );
  const logoutRoute = await readFile(
    new URL("../app/api/account/logout/route.ts", import.meta.url),
    "utf8",
  );
  assert.equal(loginRoute.includes("sessionToken: result.sessionToken"), false);
  assert.equal(loginRoute.includes("code }, status"), false);
  assert.equal(sessionRoute.includes("X-Persi-Session"), false);
  assert.match(logoutRoute, /getExpiredAccountSessionCookieOptions/);
  assert.match(logoutRoute, /catch \{/);
});

test("interface possui formulário acessível, loading e proteção server-side", async () => {
  const form = await readFile(
    new URL("../components/Account/AccountLoginForm.tsx", import.meta.url),
    "utf8",
  );
  const privatePage = await readFile(
    new URL("../app/(institutional)/minha-conta/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(form, /autoComplete="username"/);
  assert.match(form, /autoComplete="current-password"/);
  assert.match(form, /Entrando\.\.\./);
  assert.match(form, /role="alert"/);
  assert.match(form, /router\.push\(callbackPath === "\/minha-conta"/);
  assert.match(privatePage, /getServerAccountSession/);
  assert.match(privatePage, /redirect\("\/entrar"\)/);
});

test("saudação da conta prioriza primeiro nome e possui fallbacks seguros", () => {
  assert.equal(
    getAccountGreetingName({ firstName: "Eduardo", displayName: "Eduardo Persi" }),
    "Eduardo",
  );
  assert.equal(
    getAccountGreetingName({ firstName: " ", displayName: "Cliente Persi" }),
    "Cliente Persi",
  );
  assert.equal(
    getAccountGreetingName({ firstName: "", displayName: "" }),
    "",
  );
});

test("Customer Workspace possui dashboard funcional e navegação compartilhada", async () => {
  const dashboard = await readFile(
    new URL("../components/Account/AccountDashboard.tsx", import.meta.url),
    "utf8",
  );
  const dashboardCard = await readFile(
    new URL("../components/Account/AccountDashboardCard.tsx", import.meta.url),
    "utf8",
  );
  const privatePage = await readFile(
    new URL("../app/(institutional)/minha-conta/page.tsx", import.meta.url),
    "utf8",
  );
  const workspaceShell = await readFile(
    new URL("../components/Account/CustomerWorkspaceShell.tsx", import.meta.url),
    "utf8",
  );

  for (const title of [
    "Pedidos",
    "Endereços",
    "Dados pessoais",
    "Lista de espera",
    "Minhas listas",
  ]) {
    assert.match(dashboard, new RegExp(title));
  }
  assert.match(dashboard, /href: "\/minha-conta\/pedidos"/);
  assert.match(dashboard, /href: "\/minha-conta\/listas"/);
  assert.match(dashboard, /CustomerWorkspaceSummary/);
  assert.match(dashboard, /Produtos vistos/);
  assert.equal(dashboardCard.includes("Em breve"), false);
  assert.match(workspaceShell, /CUSTOMER_WORKSPACE_NAVIGATION/);
  assert.match(workspaceShell, /<Drawer/);
  assert.match(workspaceShell, /aria-current/);
  assert.match(workspaceShell, /AccountLogoutButton/);
  assert.match(dashboard, /grid-cols-1/);
  assert.match(dashboard, /sm:grid-cols-2/);
  assert.match(dashboard, /xl:grid-cols-3/);
  assert.equal(privatePage.includes("AccountNavigation"), false);
  assert.equal((privatePage.match(/AccountLogoutButton/g) ?? []).length, 0);
  assert.match(privatePage, /getServerAccountSession/);
  assert.match(privatePage, /redirect\("\/entrar"\)/);
});

test("ação da conta no cabeçalho respeita sessão e rota atual", () => {
  assert.equal(getHeaderAccountAction("anonymous", "/"), "open-drawer");
  assert.equal(getHeaderAccountAction("anonymous", "/entrar"), "go-to-login");
  assert.equal(
    getHeaderAccountAction("anonymous", "/criar-conta"),
    "go-to-login",
  );
  assert.equal(
    getHeaderAccountAction("authenticated", "/"),
    "go-to-account",
  );
  assert.equal(
    getHeaderAccountAction("authenticated", "/minha-conta"),
    "refresh-page",
  );
  assert.equal(
    getHeaderAccountAction("authenticated", "/minha-conta/pedidos/10"),
    "refresh-page",
  );
  assert.equal(getHeaderAccountAction("loading", "/"), "wait");
  assert.equal(isAccountRoute("/minha-conta/pedidos"), true);
  assert.equal(isAccountRoute("/minha-contabilidade"), false);
  assert.equal(isPublicAccountAuthRoute("/redefinir-senha"), true);
});

test("desktop e mobile compartilham a ação e o drawer fecha com rota ou login", async () => {
  const header = await readFile(
    new URL("../components/Header/Header.tsx", import.meta.url),
    "utf8",
  );
  const mobileMenu = await readFile(
    new URL("../components/Header/MobileMenu.tsx", import.meta.url),
    "utf8",
  );

  assert.match(header, /getHeaderAccountAction\(accountStatus, pathname\)/);
  assert.match(header, /accountDrawerPathname === pathname/);
  assert.match(header, /setAccountDrawerPathname\(pathname\)/);
  assert.match(header, /setAccountDrawerPathname\(null\)/);
  assert.match(header, /accountAction === "refresh-page"/);
  assert.match(header, /window\.location\.reload\(\)/);
  assert.match(header, /open=\{accountOpen && canOpenAccountDrawer\}/);
  assert.match(header, /accountHref=\{accountHref\}/);
  assert.match(header, /onAccountAction=\{handleAccountAction\}/);
  assert.match(mobileMenu, /accountHref/);
  assert.match(mobileMenu, /onAccountAction/);
  assert.equal((header.match(/<AccountDrawer/g) ?? []).length, 1);
});
