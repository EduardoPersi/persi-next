# Persi Materiais — loja

Front-end Next.js da Persi Materiais, publicado na **Hostinger**.

## ⚠️ A build é por webpack, e a configuração é `.mjs`

**Não troque estas duas coisas sem testar uma implantação de verdade na
Hostinger primeiro.**

```json
"build": "next build --webpack"
```

e a configuração em **`next.config.mjs`** — não `next.config.ts`.

**Por quê.** É a recomendação da Hostinger para a publicação deste site. O
Turbopack (o padrão do `next build` a partir do Next 16) e o arquivo de
configuração em TypeScript não se comportaram bem na build da hospedagem: o
`.ts` depende do carregador de TypeScript do Next, que não é o mesmo caminho
em todas as combinações de versão e bundler, enquanto o `.mjs` é lido pelo
próprio Node, sem carregador no meio.

O erro que isso causa não aparece aqui: aparece **na implantação**, depois do
merge. Por isso a regra é testar a implantação antes de voltar atrás — rodar
`npm run build` na sua máquina não prova nada sobre a build da Hostinger.

O comentário `/** @type {import('next').NextConfig} */` no topo do
`next.config.mjs` mantém a conferência de campos no editor, que era o que o
tipo `NextConfig` dava.

Roteiro de implantação: `docs/19-deploy-hostinger.md` e, para a ligação com o
painel de atendimento, `docs/44-deploy-etapa-c.md`.

---

Projeto Next.js criado com [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load Inter for the interface.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Publicação

**Este site NÃO é publicado na Vercel** — o texto padrão do `create-next-app`
dizia isso e foi removido daqui para ninguém seguir por engano. A publicação é
na **Hostinger**, pelo hPanel, com as duas exigências do começo deste arquivo.

Ver `docs/19-deploy-hostinger.md`.
