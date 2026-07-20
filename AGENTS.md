# AGENTS.md — Persi Materiais

## 1. Finalidade deste arquivo

Este arquivo define as regras obrigatórias para qualquer agente de IA, desenvolvedor ou colaborador que altere o projeto Next.js da Persi Materiais.

O objetivo é garantir:

- consistência de arquitetura;
- segurança nas alterações;
- boa experiência de usuário;
- alta performance;
- SEO técnico correto;
- integração confiável com o WooCommerce;
- facilidade de manutenção;
- respeito às decisões já aprovadas para o projeto.

Antes de iniciar qualquer tarefa, o agente deve ler este arquivo e os documentos relacionados na pasta `docs/`.

Nenhuma instrução genérica de um framework, biblioteca ou ferramenta deve substituir uma regra específica deste projeto.

---

## 2. Identidade do projeto

### 2.1 Nome

Persi Materiais — Front-end Next.js Headless.

### 2.2 Empresa

Persi Construções e Comércio LTDA.

### 2.3 Site principal

`persimateriais.com.br`

### 2.4 Contexto comercial

A Persi Materiais atua com loja física e e-commerce de materiais de construção, com foco principal em:

- hidráulica;
- elétrica;
- impermeabilização;
- poço artesiano;
- filtros de entrada;
- ferramentas;
- EPIs;
- tintas e acessórios;
- drywall;
- forros;
- piscinas;
- serviços relacionados à construção a seco.

### 2.5 Região de atuação prioritária

O projeto deve considerar SEO local e experiência de compra para:

- Jundiaí;
- Itupeva;
- Jarinu;
- Cabreúva;
- Itatiba;
- Louveira;
- Várzea Paulista;
- Campo Limpo Paulista;
- Cajamar;
- Vinhedo;
- Itu;
- Valinhos;
- Perus;
- Franco da Rocha.

### 2.6 Objetivo do novo front-end

Criar uma experiência de e-commerce rápida, moderna, responsiva e escalável usando Next.js, mantendo o WooCommerce como back-end de catálogo, pedidos, clientes, estoque e conteúdo operacional.

A nova aplicação deve:

- manter o visual reconhecível da Persi;
- melhorar o layout atual;
- reduzir dependência de Elementor no front-end;
- alcançar excelente desempenho em dispositivos móveis;
- priorizar Core Web Vitals;
- preservar recursos comerciais importantes;
- facilitar SEO técnico;
- permitir evolução gradual;
- continuar usando o WordPress e WooCommerce como fonte administrativa.

---

## 3. Princípios obrigatórios

Toda implementação deve seguir estes princípios, nesta ordem:

1. Não quebrar o que já funciona.
2. Preservar dados e integrações existentes.
3. Priorizar segurança.
4. Priorizar clareza para o cliente.
5. Priorizar performance real em celular.
6. Priorizar SEO técnico.
7. Criar componentes reutilizáveis.
8. Evitar complexidade desnecessária.
9. Documentar decisões importantes.
10. Testar antes de concluir.

O projeto não deve ser transformado em um experimento tecnológico. Bibliotecas, padrões e abstrações só devem ser adicionados quando houver ganho claro.

---

## 4. Stack principal

### 4.1 Tecnologias aprovadas

- Next.js com App Router;
- React;
- TypeScript;
- Tailwind CSS;
- Lucide React;
- Swiper;
- React Hook Form;
- Zod;
- `@hookform/resolvers`;
- `clsx`;
- WooCommerce como back-end;
- WordPress como CMS e gerenciador de mídia;
- Git;
- GitHub;
- Node.js LTS.

### 4.2 Tecnologias que exigem autorização antes da instalação

Qualquer nova dependência deve ser justificada antes de ser instalada, especialmente:

- bibliotecas completas de UI;
- gerenciadores globais de estado;
- bibliotecas de animação pesadas;
- SDKs de terceiros;
- bibliotecas de ícones adicionais;
- soluções alternativas de formulário;
- bibliotecas de data;
- bibliotecas de requisição HTTP;
- soluções de cache;
- bibliotecas de autenticação;
- ferramentas de observabilidade.

### 4.3 Não instalar sem necessidade

Evitar instalar uma biblioteca para resolver algo simples que pode ser feito com:

- recursos nativos do JavaScript;
- recursos do React;
- recursos do Next.js;
- utilitários já presentes;
- classes Tailwind;
- um componente pequeno e local.

---

## 5. Leitura obrigatória

Antes de realizar tarefas relevantes, ler os documentos aplicáveis:

- `docs/00-visao-geral.md`
- `docs/01-arquitetura-nextjs.md`
- `docs/02-design-system.md`
- `docs/03-ux-e-conversao.md`
- `docs/04-seo.md`
- `docs/05-performance.md`
- `docs/06-woocommerce-headless.md`
- `docs/07-componentes.md`
- `docs/08-git-codex-fluxo.md`
- `docs/09-roadmap-checklists.md`

Alguns documentos podem ainda não existir. Nesse caso:

- não inventar uma regra conflitante;
- seguir este `AGENTS.md`;
- registrar a necessidade de documentação;
- manter a solução simples e reversível.

---

## 6. Estrutura de pastas recomendada

A estrutura pode evoluir, mas deve manter separação clara de responsabilidades.

```text
app/
├── (store)/
│   ├── page.tsx
│   ├── categoria/
│   ├── produto/
│   ├── marca/
│   ├── busca/
│   ├── carrinho/
│   ├── checkout/
│   └── minha-conta/
├── api/
├── error.tsx
├── global-error.tsx
├── globals.css
├── layout.tsx
├── loading.tsx
├── not-found.tsx
├── robots.ts
└── sitemap.ts

components/
├── ui/
├── layout/
├── header/
├── footer/
├── home/
├── product/
├── category/
├── brand/
├── cart/
├── checkout/
├── search/
├── filters/
└── forms/

lib/
├── api/
├── commerce/
├── seo/
├── analytics/
├── validation/
├── formatting/
└── constants/

services/
├── products/
├── categories/
├── brands/
├── cart/
├── checkout/
├── customer/
└── orders/

hooks/
types/
utils/
public/
docs/
```

### 6.1 Regras de organização

- Componentes genéricos devem ficar em `components/ui`.
- Componentes de estrutura global devem ficar em `components/layout`.
- Componentes específicos de uma funcionalidade devem ficar na pasta correspondente.
- Chamadas ao WooCommerce não devem ficar espalhadas diretamente em componentes.
- Tipos reutilizados devem ficar em `types`.
- Funções puras e genéricas devem ficar em `utils`.
- Configurações e constantes devem ficar em `lib/constants` ou arquivo equivalente.
- Não criar pastas vazias sem uma necessidade real.
- Não mover arquivos existentes apenas por preferência pessoal.
- Refatorações de estrutura devem ser planejadas e separadas de tarefas funcionais.

---

## 7. Convenções de código

### 7.1 Idioma

- Código, nomes de funções, tipos, variáveis e componentes: inglês.
- Textos exibidos ao usuário: português do Brasil.
- Comentários técnicos: preferencialmente em português claro ou inglês consistente.
- Nomes de rotas públicas: português, quando fizer sentido para SEO e experiência.

### 7.2 Clareza

O código deve ser legível por um desenvolvedor intermediário.

Evitar:

- abreviações obscuras;
- nomes de uma letra, exceto índices simples;
- funções excessivamente longas;
- componentes com muitas responsabilidades;
- condicionais profundamente aninhadas;
- comentários que apenas repetem o código;
- abstrações prematuras.

### 7.3 TypeScript

- Não usar `any` sem justificativa explícita.
- Preferir tipos específicos.
- Validar respostas externas.
- Tratar campos opcionais corretamente.
- Não assumir que dados da API sempre estarão completos.
- Usar `unknown` quando o formato ainda não for conhecido.
- Não silenciar erros de TypeScript com comentários sem resolver a causa.
- Não usar casts apenas para “fazer compilar”.
- Exportar tipos compartilhados de forma organizada.

### 7.4 Funções

- Funções devem ter responsabilidade única.
- Nomes devem indicar a ação.
- Evitar efeitos colaterais escondidos.
- Preferir retornos antecipados quando melhorarem a leitura.
- Tratar erros de forma explícita.
- Não capturar erros e ignorá-los silenciosamente.

---

## 8. Regras para React

### 8.1 Server Components por padrão

Todo componente deve ser Server Component por padrão.

Adicionar `"use client"` somente quando for necessário para:

- estado local;
- efeitos;
- eventos do navegador;
- APIs do navegador;
- contexto que exige cliente;
- bibliotecas incompatíveis com Server Components.

### 8.2 Client Components

Client Components devem ser:

- pequenos;
- localizados;
- focados em interação;
- separados do carregamento de dados quando possível.

Não transformar uma página inteira em Client Component apenas porque um pequeno botão exige estado.

### 8.3 Props

- Definir tipos explícitos.
- Evitar props booleanas ambíguas.
- Não criar componentes com dezenas de props sem avaliar composição.
- Usar nomes previsíveis.
- Não repassar dados irrelevantes.
- Sanitizar ou validar conteúdo externo.

### 8.4 Estado

- Manter estado o mais próximo possível de onde é usado.
- Evitar estado global para dados locais.
- Não duplicar estado derivado.
- Preferir valores calculados durante renderização quando adequado.
- Persistência local deve ser usada com cuidado.
- Estado do carrinho deve ter estratégia documentada.

### 8.5 Efeitos

- Não usar `useEffect` para lógica que pode ocorrer no servidor ou durante renderização.
- Limpar listeners e timers.
- Evitar efeitos que atualizam estado em cadeia.
- Tratar condições de corrida.
- Não fazer requisições redundantes no cliente.

### 8.6 Chaves

- Usar identificadores estáveis.
- Não usar índice como chave quando a lista pode mudar de ordem.
- Não gerar chave aleatória durante renderização.

---

## 9. Regras para Next.js

### 9.1 App Router

Usar os padrões oficiais do App Router:

- `layout.tsx`;
- `page.tsx`;
- `loading.tsx`;
- `error.tsx`;
- `not-found.tsx`;
- `generateMetadata`;
- Route Handlers quando necessários;
- Server Actions somente quando realmente adequadas.

### 9.2 Navegação

- Usar `next/link` para navegação interna.
- Não usar `<a>` puro para rotas internas sem motivo.
- Evitar navegação completa da página.
- Prefetch deve ser avaliado em páginas com muitas ligações.

### 9.3 Imagens

- Usar `next/image` sempre que apropriado.
- Informar dimensões ou usar `fill` com contêiner correto.
- Evitar layout shift.
- Definir `sizes`.
- Usar `priority` somente em imagens realmente críticas.
- Nunca marcar todas as imagens como prioritárias.
- Alt deve ser descritivo e útil.
- Não repetir palavras-chave de forma artificial.
- Imagens decorativas devem usar alt vazio.

### 9.4 Metadata

Toda página indexável deve ter:

- título único;
- descrição coerente;
- canonical quando necessário;
- Open Graph;
- configuração de indexação adequada;
- dados estruturados quando aplicáveis.

### 9.5 Cache e revalidação

Toda chamada de dados deve declarar uma estratégia coerente:

- dados estáticos;
- revalidação;
- dados dinâmicos;
- dados por usuário;
- dados sensíveis;
- dados de estoque e preço.

Não aplicar cache de forma indiscriminada em:

- carrinho;
- sessão;
- conta;
- checkout;
- pedido;
- dados privados.

### 9.6 Erros e estados de carregamento

- Toda área crítica deve ter estado de carregamento coerente.
- Erros devem orientar o usuário.
- Não mostrar detalhes internos de exceção.
- Falhas de API devem ter fallback quando possível.
- Página de produto inexistente deve retornar 404 real.

---

## 10. Tailwind CSS e layout

### 10.1 Mobile first

Todo layout deve ser criado primeiro para celular.

A sequência de validação mínima:

1. 320 px;
2. 375 px;
3. 390 px;
4. 768 px;
5. 1024 px;
6. 1280 px;
7. 1440 px.

### 10.2 Container

Usar o componente central `Container`.

Não criar containers diferentes em cada página.

O `Container` deve:

- limitar a largura;
- manter margens consistentes;
- controlar paddings horizontais;
- funcionar em todas as seções;
- ser alterado apenas com autorização quando a mudança afetar todo o site.

### 10.3 Espaçamento

- Usar escala consistente do Tailwind.
- Evitar valores arbitrários sem necessidade.
- Preservar ritmo vertical.
- Não comprimir áreas de toque.
- Diferenciar espaçamento interno de externo.
- Manter seções visualmente separadas.

### 10.4 Bordas

Padrão geral aprovado:

- cantos arredondados de 12 px para botões, inputs, cards e elementos equivalentes;
- exceções devem ser justificadas pelo contexto;
- elementos circulares podem usar `rounded-full`.

### 10.5 Estilos inline

Não usar estilos inline para layout e visual comuns.

Só usar quando:

- o valor é realmente dinâmico;
- não existe alternativa limpa;
- a decisão está documentada.

### 10.6 Classes

- Evitar classes duplicadas.
- Usar `clsx` para condicionais.
- Extrair variantes repetitivas.
- Não criar strings gigantes difíceis de manter.
- Não usar `!important` sem necessidade comprovada.
- Não adicionar CSS global para corrigir apenas um componente isolado.

### 10.7 Breakpoints

Não criar breakpoints arbitrários sem necessidade.

Usar os breakpoints do projeto de forma consistente.

---

## 11. Identidade visual

### 11.1 Cores principais atuais

- Azul escuro superior: `#071f5c`
- Azul principal do cabeçalho: `#0c2d72`
- Laranja de destaque: `#ff6a00`
- Branco: `#ffffff`
- Texto escuro: usar tom de alto contraste e boa leitura

### 11.2 Uso das cores

- Azul: confiança, navegação, estrutura e identidade.
- Laranja: ações principais, destaque comercial e elementos de conversão.
- Branco e tons neutros: área de conteúdo e leitura.
- Não usar laranja em excesso.
- Não usar azul escuro como fundo de grandes áreas sem avaliar legibilidade.
- Estados de sucesso, alerta e erro devem ter cores próprias e acessíveis.

### 11.3 Logo

- Preferir SVG.
- Preservar proporção.
- Não distorcer.
- Não aplicar efeitos desnecessários.
- Garantir legibilidade em fundos claros e escuros.

---

## 12. Componentes de interface

### 12.1 Regra geral

Antes de criar um componente, verificar se já existe algo equivalente.

Antes de alterar um componente compartilhado, localizar todos os usos.

### 12.2 Componentes obrigatoriamente reutilizáveis

Exemplos:

- `Container`
- `Button`
- `IconButton`
- `Input`
- `Checkbox`
- `Select`
- `Modal`
- `Drawer`
- `Badge`
- `Price`
- `ProductCard`
- `CategoryCard`
- `BrandCard`
- `Breadcrumb`
- `SectionHeader`
- `EmptyState`
- `LoadingSkeleton`

### 12.3 Button

O botão deve oferecer variantes previsíveis:

- primary;
- secondary;
- outline;
- ghost;
- destructive;
- link, quando realmente necessário.

Deve também suportar:

- tamanhos;
- loading;
- disabled;
- ícone antes ou depois;
- largura total;
- foco visível;
- estado de hover;
- estado de active.

Não duplicar implementação de botão em cada página.

### 12.4 Formulários

- Todo campo deve ter label.
- Placeholder não substitui label.
- Erros devem ser claros.
- Campos obrigatórios devem ser identificados.
- Usar React Hook Form e Zod quando houver formulário relevante.
- Não enviar formulário inválido.
- Prevenir cliques repetidos.
- Exibir confirmação.
- Preservar dados quando uma falha recuperável ocorrer.

### 12.5 Modais e drawers

- Devem poder ser fechados por teclado.
- Devem controlar foco.
- Devem impedir rolagem indevida.
- Devem ter título acessível.
- Não devem esconder ações críticas.
- No mobile, avaliar drawer inferior ou lateral conforme o caso.

---

## 13. Header

O Header é componente crítico e não deve ser alterado amplamente sem aprovação.

### 13.1 Estrutura esperada

Pode incluir:

- barra de informação de frete;
- logo;
- busca;
- login e cadastro;
- wishlist;
- carrinho;
- menu de categorias;
- navegação principal;
- versão mobile;
- mini carrinho.

### 13.2 Regras

- Busca deve ser destacada.
- Login não deve ficar visualmente apertado.
- Ícones devem ter rótulos acessíveis.
- Áreas clicáveis devem ser confortáveis.
- Menu mobile deve ser simples.
- Cabeçalho não pode causar CLS.
- Sticky deve ser avaliado pelo impacto em espaço e conversão.
- Mini carrinho não pode ser coberto pelo botão do WhatsApp.
- Alterações devem ser testadas em desktop e mobile.

---

## 14. Home

### 14.1 Regra comercial já definida

Na Home, cards de produto devem mostrar:

- imagem;
- nome;
- preço;
- informações comerciais aprovadas.

Não devem mostrar botão “Adicionar ao carrinho” por padrão.

### 14.2 Seções possíveis

- hero principal;
- categorias;
- destaques;
- marcas;
- produtos;
- banners;
- benefícios;
- serviços;
- conteúdo local;
- conteúdo institucional.

### 14.3 Regras

- Evitar excesso de sliders.
- Evitar seções repetitivas.
- Priorizar conteúdo visível sem rolagem.
- Não prejudicar LCP com banner pesado.
- H1 deve existir e ser único.
- Conteúdo SEO não deve atrapalhar compra.
- Banners devem ser gerenciáveis pelo WordPress quando possível.

---

## 15. Produto

### 15.1 Informações prioritárias

A página de produto deve apresentar com clareza:

- nome;
- marca;
- imagens;
- preço;
- desconto Pix;
- parcelamento;
- disponibilidade;
- variações;
- quantidade;
- frete;
- botão de compra;
- WhatsApp para indisponíveis;
- descrição;
- especificações;
- produtos relacionados;
- compre junto;
- avaliações;
- perguntas frequentes quando aplicável.

### 15.2 Estoque

Quando o produto estiver sem estoque:

- não mostrar ação de compra inválida;
- oferecer contato por WhatsApp;
- preservar SEO da página quando fizer sentido;
- informar indisponibilidade de forma clara;
- não esconder conteúdo útil.

### 15.3 Compre junto

A implementação futura deve permitir:

- itens inicialmente desmarcados, conforme regra comercial aprovada;
- seleção independente;
- quantidade independente;
- cálculo correto;
- um único botão de compra;
- compatibilidade com variações;
- tratamento de item indisponível;
- experiência simples no mobile.

### 15.4 Sticky

A área sticky da página de produto não deve incluir o bloco “Compre Junto”.

---

## 16. Categorias, busca e filtros

### 16.1 Categorias

- Categorias devem vir dinamicamente do WooCommerce.
- Descrições continuam gerenciáveis no WordPress.
- URLs devem ser estáveis.
- Breadcrumb deve refletir hierarquia.
- O layout deve funcionar com categorias pequenas e grandes.

### 16.2 Busca

A busca deve priorizar:

- velocidade;
- tolerância a pequenas variações;
- produtos relevantes;
- nomes;
- SKU;
- categorias;
- marcas;
- termos populares.

Não bloquear a digitação com requisições excessivas.

### 16.3 Filtros

Filtros devem:

- refletir atributos reais;
- preservar URL compartilhável quando aplicável;
- ter estado claro;
- permitir limpar;
- funcionar no mobile;
- evitar recarregamentos completos;
- não gerar combinações indexáveis sem controle;
- manter acessibilidade;
- não esconder produtos por erro silencioso.

---

## 17. Carrinho e mini carrinho

### 17.1 Requisitos

- alteração de quantidade;
- remoção;
- subtotal;
- mensagens de estoque;
- cálculo comercial correto;
- acesso ao checkout;
- comportamento confiável;
- persistência adequada;
- feedback imediato.

### 17.2 Mini carrinho

- Deve ser utilizável em telas pequenas.
- O CTA principal deve permanecer visível.
- O botão WhatsApp deve ficar acima sem cobrir o CTA.
- O foco deve ser controlado.
- O fechamento deve ser fácil.
- Não deve causar perda do estado do carrinho.

### 17.3 Segurança

Nunca confiar apenas no valor calculado no cliente.

Preço, estoque, desconto e frete devem ser confirmados no servidor ou back-end autorizado.

---

## 18. Checkout

### 18.1 Objetivo

Checkout transparente, simples e confiável.

### 18.2 Regras

- Reduzir campos desnecessários.
- Deixar custos visíveis.
- Validar CEP.
- Validar estoque antes da conclusão.
- Evitar perda de dados.
- Mostrar erros específicos.
- Não expor credenciais.
- Não armazenar dados sensíveis de pagamento.
- Usar provedores aprovados.
- Manter compatibilidade com Pix e cartão.
- Considerar parcelamento conforme regras comerciais.
- Tratar pedidos duplicados.
- Registrar falhas com segurança.

---

## 19. WooCommerce Headless

### 19.1 Fonte de verdade

O WooCommerce permanece como fonte de verdade para:

- produtos;
- preços;
- estoque;
- variações;
- pedidos;
- clientes;
- cupons;
- status;
- dados operacionais.

O WordPress permanece como fonte para:

- imagens;
- banners;
- descrições;
- categorias;
- conteúdo editorial;
- páginas de marcas;
- textos administráveis.

### 19.2 Integrações

A implementação deve considerar a continuidade de:

- Bling ERP;
- Melhor Envio;
- Banco Inter;
- Google Merchant Center;
- GA4;
- GTM;
- Meta;
- feeds;
- Cloudflare;
- notificações;
- operações do WooCommerce.

### 19.3 Credenciais

- Nunca expor consumer secret no navegador.
- Variáveis privadas não podem usar prefixo público.
- Não registrar segredos.
- Não salvar credenciais em Git.
- Usar `.env.local`.
- Manter `.env.example` sem valores secretos.

### 19.4 Serviços

Chamadas ao comércio devem ser centralizadas.

Exemplo:

```text
services/products/
services/categories/
services/cart/
services/checkout/
```

Componentes não devem conhecer detalhes de autenticação da API.

### 19.5 Validação

Toda resposta externa deve ser tratada como potencialmente incompleta.

Validar:

- campos;
- tipos;
- imagens;
- preços;
- variações;
- estoque;
- paginação;
- erros;
- códigos HTTP.

---

## 20. SEO

SEO é requisito estrutural, não tarefa posterior.

### 20.1 Regras básicas

Toda página indexável deve ter:

- um H1 principal;
- título exclusivo;
- descrição exclusiva;
- URL estável;
- conteúdo útil;
- canonical correto;
- breadcrumb;
- links internos;
- imagem adequada;
- metadados sociais.

### 20.2 Produtos

Página de produto deve considerar:

- `Product`;
- `Offer`;
- disponibilidade;
- preço;
- moeda;
- SKU;
- marca;
- imagens;
- avaliações quando verdadeiras;
- dados estruturados consistentes com a página.

Nunca inserir avaliação, preço ou estoque falso em schema.

### 20.3 Categorias

- H1 único;
- texto introdutório útil;
- conteúdo adicional quando necessário;
- paginação rastreável;
- canonical coerente;
- filtros sob controle;
- links para subcategorias;
- breadcrumbs;
- conteúdo local somente quando realmente relevante.

### 20.4 SEO local

Considerar Jundiaí e cidades atendidas sem criar conteúdo repetitivo ou artificial.

Não repetir nomes de cidades sem contexto.

### 20.5 Parâmetros

Parâmetros de busca, filtro, ordenação e rastreamento devem ter estratégia de indexação.

Evitar desperdício de rastreamento com URLs infinitas.

### 20.6 Conteúdo duplicado

- Definir canonical.
- Evitar rotas duplicadas.
- Tratar produtos semelhantes com conteúdo real.
- Não copiar descrições de fabricante sem necessidade.
- Não criar páginas vazias apenas para palavras-chave.

---

## 21. Performance e Core Web Vitals

### 21.1 Metas

Priorizar boa experiência real em celular.

Metas principais:

- LCP baixo;
- CLS próximo de zero;
- INP responsivo;
- TTFB consistente;
- JavaScript reduzido;
- imagens otimizadas.

### 21.2 LCP

- Identificar o elemento LCP.
- Otimizar a imagem principal.
- Não aplicar lazy loading no elemento LCP.
- Evitar scripts que atrasem renderização.
- Precarregar apenas o necessário.
- Reduzir dependência de dados lentos.

### 21.3 CLS

- Reservar espaço de imagens.
- Reservar espaço de banners.
- Evitar inserção tardia acima do conteúdo.
- Carregar fontes corretamente.
- Manter skeleton com dimensões coerentes.

### 21.4 INP

- Reduzir JavaScript no cliente.
- Dividir componentes interativos.
- Evitar handlers pesados.
- Não bloquear thread principal.
- Usar debounce quando apropriado.
- Otimizar busca e filtros.

### 21.5 Imagens

- Usar formatos modernos.
- Dimensionar corretamente.
- Não enviar imagem muito maior que a área.
- Usar `sizes`.
- Configurar domínios remotos.
- Evitar carrosséis com imagens gigantes.

### 21.6 Fontes

- Usar `next/font` quando possível.
- Limitar pesos.
- Evitar várias famílias sem necessidade.
- Prevenir mudança visual.
- Não carregar fontes externas desnecessárias.

### 21.7 Scripts

Scripts de analytics, chat, marketing e terceiros devem ser avaliados quanto a:

- necessidade;
- momento de carregamento;
- consentimento;
- impacto em INP;
- duplicidade;
- privacidade.

---

## 22. Acessibilidade

O projeto deve atender boas práticas de acessibilidade.

### 22.1 Obrigatório

- HTML semântico;
- navegação por teclado;
- foco visível;
- contraste adequado;
- labels;
- alt;
- títulos;
- estados anunciáveis;
- botões reais;
- links reais;
- área de toque adequada.

### 22.2 Não fazer

- `div` clicável sem suporte de teclado;
- remover outline sem substituição;
- usar apenas cor para indicar estado;
- esconder label;
- abrir modal sem controlar foco;
- usar ícone sem nome acessível;
- criar texto pequeno demais.

---

## 23. Segurança

### 23.1 Dados

- Não expor dados privados.
- Não confiar em dados do cliente.
- Sanitizar conteúdo.
- Validar entrada.
- Não renderizar HTML externo sem análise.
- Proteger rotas privadas.
- Não armazenar tokens sensíveis de forma insegura.

### 23.2 API

- Aplicar rate limiting quando necessário.
- Tratar abuso.
- Não retornar detalhes internos.
- Validar origem quando aplicável.
- Registrar erros sem credenciais.
- Separar permissões administrativas.

### 23.3 Pagamento

- Não manipular dados brutos de cartão.
- Usar fluxo do provedor.
- Confirmar pagamento no servidor.
- Tratar webhook com validação.
- Evitar duplicidade de pedido.

---

## 24. Analytics e rastreamento

O projeto deve manter rastreamento confiável sem duplicar eventos.

### 24.1 Eventos principais

- `view_item_list`
- `select_item`
- `view_item`
- `add_to_cart`
- `remove_from_cart`
- `view_cart`
- `begin_checkout`
- `add_shipping_info`
- `add_payment_info`
- `purchase`
- busca interna

### 24.2 Regras

- Não disparar evento duas vezes.
- Não inventar receita.
- Não enviar dados pessoais indevidos.
- Validar GTM e GA4.
- Preservar identificadores de produto.
- Testar fluxo completo.
- Documentar mudanças.

---

## 25. Git e GitHub

### 25.1 Regras gerais

O agente não deve:

- fazer push sem autorização;
- apagar branches remotas;
- reescrever histórico;
- executar `git reset --hard` sem autorização;
- apagar arquivos não relacionados;
- incluir segredos;
- fazer commit automático sem pedido.

### 25.2 Commits

Commits devem ser:

- pequenos;
- coerentes;
- descritivos;
- relacionados a uma tarefa.

Exemplos:

```text
feat(header): add responsive account actions
fix(cart): prevent quantity below one
refactor(product): extract price display component
docs(agents): document Next.js project rules
```

### 25.3 Antes do commit

Verificar:

- `git status`;
- arquivos alterados;
- ausência de segredos;
- lint;
- build;
- comportamento;
- documentação.

---

## 26. Fluxo de trabalho do agente

Antes de alterar o código, o agente deve:

1. Entender a solicitação.
2. Localizar arquivos relevantes.
3. Ler os componentes relacionados.
4. Identificar impactos.
5. Evitar alterações fora do escopo.
6. Explicar o plano quando a tarefa for ampla.
7. Executar mudanças pequenas e verificáveis.
8. Rodar validações.
9. Informar arquivos alterados.
10. Informar limitações reais.

### 26.1 Tarefas pequenas

Pode executar diretamente quando o impacto for local e claro.

Exemplos:

- ajustar espaçamento;
- corrigir texto;
- alterar ícone;
- corrigir classe;
- adicionar atributo acessível;
- corrigir erro simples.

### 26.2 Tarefas amplas

Deve propor plano antes de modificar quando envolver:

- arquitetura;
- autenticação;
- checkout;
- carrinho;
- integração de API;
- alteração de Header global;
- mudança de Container;
- troca de biblioteca;
- grande refatoração;
- migração de rotas;
- cache global;
- segurança.

---

## 27. Refatoração

Refatorar significa melhorar a estrutura interna sem mudar o comportamento esperado.

### 27.1 Regras

- Não misturar grande refatoração com nova funcionalidade sem necessidade.
- Preservar comportamento.
- Criar testes ou validações.
- Alterar por etapas.
- Não renomear tudo apenas por preferência.
- Não criar abstração genérica sem usos reais.
- Informar riscos.
- Comparar antes e depois.

### 27.2 Refatoração proibida sem autorização

- reescrever o Header inteiro;
- trocar Tailwind;
- trocar App Router;
- trocar estratégia de integração;
- substituir WooCommerce;
- alterar todas as rotas;
- introduzir novo gerenciador global;
- modificar checkout em produção;
- remover integrações existentes.

---

## 28. Testes e validação

### 28.1 Comandos mínimos

Quando disponíveis:

```bash
npm run lint
npm run build
npm run dev
```

Se houver testes:

```bash
npm test
```

### 28.2 Validação manual

Testar:

- desktop;
- mobile;
- teclado;
- carregamento;
- erro;
- dados vazios;
- produto sem imagem;
- produto sem estoque;
- variações;
- carrinho;
- navegação;
- links;
- layout.

### 28.3 Não concluir com erro conhecido

Se um erro permanecer:

- informar claramente;
- explicar impacto;
- indicar arquivo;
- não afirmar que está resolvido.

---

## 29. Compatibilidade

### 29.1 Navegadores

Priorizar versões atuais de:

- Chrome;
- Edge;
- Safari;
- Firefox;
- navegadores móveis baseados em Chromium;
- Safari no iPhone.

### 29.2 Dispositivos

O site deve funcionar bem em:

- celulares pequenos;
- celulares comuns;
- tablets;
- notebooks;
- monitores grandes.

---

## 30. Regras específicas da Persi

### 30.1 WhatsApp

- Deve ser acessível.
- Não pode cobrir CTA crítico.
- Produto sem estoque deve poder direcionar ao WhatsApp.
- Mensagens podem incluir nome e URL do produto.
- Não enviar dados sensíveis.

### 30.2 Preços

- Exibir desconto Pix conforme regra comercial.
- Exibir parcelamento de forma clara.
- Nunca calcular valor final apenas no front-end.
- Formatar em real brasileiro.
- Tratar preço promocional.
- Tratar variações.
- Evitar preço divergente do WooCommerce.

### 30.3 Marcas

Páginas de marcas devem suportar:

- logo;
- descrição;
- catálogo;
- SEO;
- navegação;
- produtos;
- conteúdo administrável.

### 30.4 Menu

- Categorias devem ser dinâmicas.
- Evitar menu gigante e confuso.
- Priorizar categorias comerciais.
- Garantir versão mobile.
- Não depender de edição manual no código para toda alteração de catálogo.

### 30.5 Serviços

Conteúdo de serviços pode ser integrado, mas não deve confundir a jornada principal de compra.

---

## 31. Documentação de componentes

Componentes relevantes devem ter documentação contendo:

- objetivo;
- localização;
- quando usar;
- quando não usar;
- props;
- estados;
- responsividade;
- acessibilidade;
- SEO;
- performance;
- dependências;
- exemplos;
- riscos;
- checklist.

---

## 32. Definição de concluído

Uma tarefa só pode ser considerada concluída quando:

- atende ao pedido;
- não quebra funcionalidades existentes;
- está tipada;
- está responsiva;
- está acessível;
- passa no lint;
- passa no build, quando possível;
- não expõe segredos;
- não cria erro no console;
- trata estados vazios;
- trata carregamento;
- trata falhas relevantes;
- segue identidade visual;
- respeita SEO;
- respeita performance;
- tem alterações explicadas.

---

## 33. Comunicação do agente

Ao finalizar, informar de forma objetiva:

- o que foi feito;
- quais arquivos foram alterados;
- quais comandos foram executados;
- resultado do lint e build;
- riscos ou pendências;
- próximo passo necessário, somente quando houver.

Não usar explicações longas quando o usuário pediu execução direta.

Não afirmar que testou algo que não foi testado.

---

## 34. Proibições gerais

Não fazer sem autorização:

- excluir arquivos importantes;
- modificar `.env`;
- expor tokens;
- instalar muitas dependências;
- alterar configuração de produção;
- mudar DNS;
- mudar Cloudflare;
- alterar WooCommerce ao vivo;
- criar pedido real;
- disparar e-mail real;
- publicar no GitHub;
- fazer deploy;
- alterar banco de dados;
- remover rastreamento;
- inventar dados;
- inventar disponibilidade;
- inventar avaliação;
- inventar preço.

---

## 35. Ordem de prioridade em conflitos

Quando duas orientações entrarem em conflito, usar esta ordem:

1. segurança;
2. integridade de pedidos e pagamentos;
3. regras explícitas do usuário;
4. este `AGENTS.md`;
5. documentação específica em `docs/`;
6. padrões já existentes no repositório;
7. boas práticas oficiais;
8. preferência pessoal do agente.

Quando ainda houver dúvida, manter a implementação atual e solicitar decisão antes de uma mudança ampla.

---

## 36. Manutenção deste arquivo

Atualizar este arquivo quando houver mudança duradoura em:

- arquitetura;
- stack;
- fluxo Git;
- regras de segurança;
- identidade visual;
- integrações;
- checkout;
- SEO;
- padrões de componentes.

Não adicionar regras temporárias.

Toda atualização deve ser clara, datada no Git e relacionada a uma decisão real do projeto.
