// Configuração do Next em JavaScript, e não em TypeScript.
//
// A build da Hostinger roda `next build --webpack`, e o arquivo de
// configuração em `.ts` depende do carregador de TypeScript do Next — que não
// é o mesmo caminho em todas as combinações de versão e bundler. Em `.mjs` o
// próprio Node lê o arquivo, sem carregador no meio.
//
// O comentário de tipo abaixo não é enfeite: ele dá ao editor a mesma
// conferência de campos que o `NextConfig` dava, sem o arquivo deixar de ser
// JavaScript.

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), web-share=(self)",
  },
  // max-age moderado (180 dias), sem includeSubDomains (o subdomínio
  // loja.persimateriais.com.br roda o WordPress/WooCommerce administrativo
  // e não foi validado para HSTS) e sem preload (praticamente irreversível).
  {
    key: "Strict-Transport-Security",
    value: "max-age=15552000",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Facilita depurar erros reais de produção (ex: mismatches de
  // hidratação) sem expor o código-fonte de forma óbvia — os .map ficam
  // publicados junto com o bundle, mas não são referenciados por nada
  // que um usuário comum abriria.
  productionBrowserSourceMaps: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Link de recuperação de carrinho (/r/<token>): o token não pode vazar
        // por Referer. Vem depois da regra geral, então este valor prevalece.
        source: "/r/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/api/cart/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "Vary", value: "Cookie" },
        ],
      },
      {
        source: "/api/checkout/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "Vary", value: "Cookie" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "loja.persimateriais.com.br",
      },
      {
        protocol: "https",
        hostname: "secure.gravatar.com",
      },
    ],
  },
};

export default nextConfig;
