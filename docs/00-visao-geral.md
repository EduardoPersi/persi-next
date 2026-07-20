# 00 — Visão Geral do Projeto Persi Materiais

## 1. Propósito deste documento

Este documento apresenta a visão geral do novo front-end da Persi Materiais.

Ele deve ser lido por:

- desenvolvedores;
- agentes de IA;
- designers;
- profissionais de SEO;
- responsáveis por integrações;
- responsáveis pelo e-commerce;
- colaboradores que precisem compreender as decisões do projeto.

O objetivo é fornecer contexto suficiente para que qualquer pessoa entenda:

- o que está sendo construído;
- por que o projeto existe;
- quais problemas ele pretende resolver;
- quais decisões já foram tomadas;
- quais princípios devem orientar novas decisões;
- quais funcionalidades são prioritárias;
- quais riscos devem ser evitados.

---

## 2. Resumo executivo

A Persi Materiais possui atualmente uma operação de e-commerce baseada em WordPress, WooCommerce, Woodmart e Elementor Pro.

O novo projeto não pretende eliminar imediatamente o WooCommerce. A estratégia é manter o WooCommerce como back-end administrativo e comercial, enquanto o Next.js passa a ser responsável pela experiência do cliente.

Esse modelo é chamado de arquitetura headless.

No projeto:

- WordPress continua gerenciando conteúdo;
- WooCommerce continua gerenciando comércio;
- Next.js entrega o front-end;
- APIs conectam as partes;
- integrações existentes precisam continuar funcionando;
- a migração deve acontecer de forma controlada.

A principal motivação é melhorar:

- velocidade;
- Core Web Vitals;
- estabilidade;
- responsividade;
- experiência de compra;
- organização do código;
- SEO técnico;
- liberdade de evolução;
- manutenção futura.

---

## 3. Visão do produto

A nova Persi Materiais deve se tornar um e-commerce de materiais de construção rápido, confiável e fácil de usar.

O usuário deve conseguir:

- encontrar um produto rapidamente;
- entender preço e condição de pagamento;
- verificar disponibilidade;
- selecionar variações;
- calcular frete;
- adicionar ao carrinho;
- finalizar o pedido;
- pedir ajuda pelo WhatsApp;
- navegar por categorias e marcas;
- acessar informações técnicas;
- comprar pelo celular sem dificuldade.

A experiência deve transmitir:

- confiança;
- organização;
- conhecimento técnico;
- proximidade regional;
- segurança;
- agilidade.

---

## 4. Contexto da empresa

### 4.1 Operação

A Persi Materiais combina:

- loja física;
- e-commerce próprio;
- marketplaces;
- atendimento por WhatsApp;
- serviços;
- atuação regional;
- vendas para diferentes partes do Brasil.

### 4.2 Localização

A empresa está sediada em Jundiaí, São Paulo.

Endereço operacional registrado:

Rua Itirapina, 163 — Vila Lacerda — Jundiaí/SP.

### 4.3 Contato comercial

WhatsApp principal:

`(11) 3964-8294`

E-mail:

`vendas@persimateriais.com.br`

Esses dados devem ser mantidos centralizados em configuração, evitando repetição manual em vários componentes.

### 4.4 Categorias estratégicas

As categorias com maior importância comercial incluem:

- hidráulica;
- elétrica;
- impermeabilizantes;
- poço artesiano;
- bombas;
- painéis;
- filtros;
- ferramentas;
- EPIs;
- tintas;
- acessórios de pintura;
- construção a seco;
- forros;
- drywall;
- piscina.

### 4.5 Marcas relevantes

O catálogo inclui marcas como:

- Fortlev;
- Krona;
- Amanco Wavin;
- Tigre;
- Astra;
- Tramontina;
- Margirius;
- Alumbra;
- Taschibra;
- Ourolux;
- Dellani;
- Walsywa;
- Viqua;
- Blukit;
- Vonder;
- Starrett;
- Irwin;
- MTX;
- Lotus;
- Prescott;
- Mactra;
- Viapol;
- Quartzolit;
- Vedacit;
- Hidroazul;
- Jeruel;
- Fauzi.

O projeto deve permitir que marcas sejam entidades navegáveis, com:

- página;
- logo;
- descrição;
- catálogo;
- SEO;
- associação com produtos.

---

## 5. Problemas que motivaram o projeto

A plataforma atual atende a operação, mas possui limitações típicas de uma estrutura WordPress altamente personalizada.

Entre os problemas já observados:

- lentidão em alguns carregamentos;
- TTFB variável;
- dependência de tema;
- dependência de Elementor;
- excesso de CSS;
- excesso de JavaScript;
- dificuldade de controlar o LCP;
- elementos que somem no primeiro carregamento;
- comportamento inconsistente de cache;
- layout complexo de manter;
- dificuldade para criar experiências mais específicas;
- conflitos entre plugins;
- limitações do Woodmart;
- risco de alterações visuais afetarem outras áreas;
- dificuldade de evoluir componentes isoladamente;
- complexidade de otimização para celular.

O Next.js não resolve automaticamente todos esses problemas. O projeto só será bem-sucedido se a arquitetura for simples, o código for disciplinado e as integrações forem tratadas com cuidado.

---

## 6. Estratégia headless

### 6.1 Conceito

Em uma arquitetura headless, o back-end e o front-end são separados.

O WooCommerce continua responsável por:

- cadastro de produtos;
- preços;
- estoque;
- variações;
- pedidos;
- clientes;
- cupons;
- status;
- regras comerciais;
- integrações operacionais.

O Next.js passa a ser responsável por:

- páginas;
- navegação;
- layout;
- componentes;
- carregamento;
- interações;
- SEO técnico;
- otimização de imagens;
- experiência mobile;
- parte do cache;
- apresentação dos dados.

### 6.2 Benefícios esperados

- melhor controle de performance;
- código reutilizável;
- menor dependência de tema;
- melhor previsibilidade de layout;
- componentes específicos para a Persi;
- SEO controlado em código;
- possibilidade de testes;
- evolução gradual;
- melhor experiência em celular;
- possibilidade de integrar novas fontes no futuro.

### 6.3 Riscos

- aumento de complexidade técnica;
- necessidade de integrar carrinho e sessão;
- necessidade de preservar recursos do WooCommerce;
- desafios de checkout;
- sincronização de preço e estoque;
- autenticação;
- cache incorreto;
- duplicidade de URLs;
- rastreamento incompleto;
- necessidade de manutenção do front-end e do back-end.

A arquitetura deve reduzir esses riscos com implementação incremental.

---

## 7. Decisões já aprovadas

### 7.1 Next.js como front-end

A aplicação será desenvolvida em Next.js com App Router.

### 7.2 WooCommerce como back-end

O WooCommerce não será removido nesta fase.

### 7.3 WordPress como CMS

Imagens, banners, descrições e conteúdos continuarão sendo administrados no WordPress quando possível.

### 7.4 Trabalho local e GitHub

O desenvolvimento acontece localmente, com controle de versão por Git e repositório no GitHub.

### 7.5 Hospedagem

A hospedagem atual é Hostinger Cloud Professional, com suporte a Node.js confirmado.

A experiência anterior com VPS foi considerada inadequada e não deve ser adotada novamente sem uma análise técnica completa.

### 7.6 Cloudflare

Cloudflare continua fazendo parte da infraestrutura.

Mudanças em cache, DNS, regras, SSL ou proxy devem ser planejadas e aprovadas.

### 7.7 Layout

O novo layout deve:

- manter semelhança com a identidade atual;
- ser mais limpo;
- ser mais moderno;
- evitar excesso de informação;
- priorizar celular;
- conservar cores da marca;
- melhorar espaçamentos;
- reduzir elementos apertados;
- usar cantos arredondados de 12 px como padrão visual.

### 7.8 Home

A Home não deve exibir botão “Adicionar ao carrinho” nos cards de produto por padrão.

Os cards devem priorizar:

- imagem;
- nome;
- preço;
- clique para detalhes.

### 7.9 Produto indisponível

Produtos sem estoque devem oferecer contato pelo WhatsApp.

### 7.10 Menu

Categorias devem ser dinâmicas e refletir a organização do WooCommerce.

### 7.11 Marcas

Páginas de marcas existentes devem ser preservadas e evoluídas.

---

## 8. Stack técnica inicial

### 8.1 Aplicação

- Next.js;
- React;
- TypeScript;
- Tailwind CSS.

### 8.2 Interface

- Lucide React;
- Swiper;
- `clsx`.

### 8.3 Formulários e validação

- React Hook Form;
- Zod;
- `@hookform/resolvers`.

### 8.4 Desenvolvimento

- Node.js LTS;
- Visual Studio Code;
- Git;
- GitHub;
- Codex.

### 8.5 Back-end

- WordPress;
- WooCommerce;
- APIs do WooCommerce;
- integrações existentes do WordPress.

---

## 9. Progresso atual

A estrutura inicial já possui elementos como:

- `app/`;
- página inicial;
- `Header`;
- `HeroBanner`;
- `MobileMenu`;
- `MiniCart`;
- `Container`;
- Tailwind configurado;
- Lucide instalado;
- Swiper instalado;
- bibliotecas de formulário instaladas.

O Header inicial já considera:

- barra de frete;
- logo;
- busca;
- login;
- wishlist;
- carrinho;
- menu mobile;
- cores principais da marca.

A versão mobile recebeu avaliação positiva.

A versão desktop ainda exige refinamentos, especialmente:

- espaçamento da área de login;
- proporção do cabeçalho;
- largura do conjunto;
- uso correto do container;
- equilíbrio entre busca, logo e ações.

---

## 10. Público-alvo

O público da Persi é amplo.

Inclui:

- consumidores finais;
- profissionais da construção;
- encanadores;
- eletricistas;
- instaladores;
- pintores;
- pedreiros;
- condomínios;
- empresas;
- responsáveis por manutenção;
- proprietários rurais;
- clientes de poço artesiano;
- compradores por necessidade urgente.

Isso afeta o projeto.

A interface não deve assumir que todos conhecem termos técnicos.

Descrições e filtros precisam ser claros.

Ao mesmo tempo, o site deve oferecer especificações suficientes para profissionais.

---

## 11. Princípios de experiência do usuário

### 11.1 Clareza

O cliente deve entender rapidamente:

- o que é o produto;
- para que serve;
- se está disponível;
- quanto custa;
- como pagar;
- como receber;
- como comprar;
- como pedir ajuda.

### 11.2 Velocidade

A página deve responder rapidamente.

Não basta obter uma boa nota em laboratório. A experiência precisa ser rápida em celular comum e conexão móvel.

### 11.3 Confiança

A interface deve reforçar:

- empresa real;
- loja física;
- atendimento;
- informações corretas;
- pagamento seguro;
- política clara;
- disponibilidade;
- marca;
- especificações;
- avaliações verdadeiras.

### 11.4 Menor esforço

O usuário não deve:

- procurar demais;
- repetir dados;
- perder o carrinho;
- voltar várias páginas;
- enfrentar filtros confusos;
- encontrar botões escondidos;
- receber mensagens genéricas de erro.

### 11.5 Consistência

Botões, preços, cards, campos e mensagens devem manter padrão.

---

## 12. Estrutura de navegação esperada

### 12.1 Navegação global

- Home;
- categorias;
- marcas;
- promoções;
- busca;
- conta;
- wishlist;
- carrinho;
- atendimento.

### 12.2 Rotas principais previstas

```text
/
 /categoria/[slug]
 /produto/[slug]
 /marca/[slug]
 /busca
 /carrinho
 /checkout
 /minha-conta
 /pedidos
```

A estrutura final deve considerar URLs atuais e redirecionamentos para preservar SEO.

### 12.3 Breadcrumb

Breadcrumb deve ser usado em:

- categorias;
- produtos;
- marcas;
- páginas informativas relevantes.

---

## 13. Funcionalidades comerciais prioritárias

### 13.1 Catálogo

- produtos simples;
- produtos variáveis;
- categorias;
- subcategorias;
- marcas;
- atributos;
- estoque;
- preço;
- promoção;
- imagens;
- descrição;
- especificações.

### 13.2 Busca

- sugestão rápida;
- busca por nome;
- busca por SKU;
- busca por marca;
- busca por categoria;
- tolerância a pequenas diferenças;
- resultados relevantes.

### 13.3 Filtros

- preço;
- marca;
- atributos;
- disponibilidade;
- categorias;
- variações relevantes.

### 13.4 Carrinho

- adicionar;
- remover;
- alterar quantidade;
- persistir;
- validar estoque;
- mostrar subtotal;
- direcionar ao checkout.

### 13.5 Checkout

- Pix;
- cartão;
- parcelamento;
- endereço;
- frete;
- confirmação;
- pedido;
- mensagens claras.

### 13.6 Conta

- login;
- cadastro;
- login social;
- pedidos;
- dados;
- endereços;
- recuperação.

### 13.7 Wishlist

A funcionalidade pode ser mantida, desde que:

- tenha valor real;
- não prejudique performance;
- não complique autenticação;
- funcione em celular.

### 13.8 WhatsApp

O WhatsApp é canal estratégico.

Deve estar disponível sem cobrir elementos importantes.

---

## 14. Funcionalidades específicas já solicitadas

O projeto deve prever:

- checkout transparente;
- login Google;
- login Facebook;
- possibilidade de login automático Google quando tecnicamente viável e permitido;
- mini carrinho;
- botão WhatsApp;
- quantidade no arquivo de produtos;
- botão comprar ocupando largura adequada;
- “Compre Junto”;
- order bump;
- Home sem botão de adicionar ao carrinho;
- WhatsApp para produtos em falta;
- sticky sem “Compre Junto”;
- troca de imagem no hover;
- páginas de marcas;
- marcas visíveis no produto;
- categorias dinâmicas;
- menu dinâmico;
- variações por tamanho;
- integração com WordPress para mídia;
- descrições administráveis no WordPress.

Cada funcionalidade deve ser implementada em etapa própria.

---

## 15. Design e identidade visual

### 15.1 Cores iniciais

- Azul escuro: `#071f5c`
- Azul principal: `#0c2d72`
- Laranja: `#ff6a00`
- Branco: `#ffffff`

### 15.2 Sensação desejada

- profissional;
- moderna;
- organizada;
- confiável;
- técnica;
- próxima;
- comercial sem excesso.

### 15.3 Formas

- cantos arredondados;
- botões claros;
- cards leves;
- sombras discretas;
- ícones consistentes;
- áreas de toque grandes;
- boa separação entre seções.

### 15.4 Tipografia

A tipografia deve:

- carregar rapidamente;
- ter boa leitura;
- usar poucos pesos;
- diferenciar títulos;
- funcionar bem em telas pequenas;
- evitar texto muito fino;
- não comprometer LCP ou CLS.

---

## 16. SEO como parte da arquitetura

SEO deve ser planejado desde a primeira rota.

### 16.1 Objetivos

- preservar tráfego existente;
- evitar perda de indexação;
- melhorar páginas de categoria;
- melhorar páginas de produto;
- melhorar páginas de marca;
- fortalecer SEO local;
- controlar páginas de busca;
- controlar filtros;
- manter sitemap;
- manter robots;
- implementar schema correto;
- preservar URLs importantes.

### 16.2 Migração

Antes de substituir o front-end atual, será necessário:

- mapear URLs;
- identificar páginas indexadas;
- registrar redirects;
- comparar títulos;
- comparar canonicals;
- comparar conteúdo;
- comparar dados estruturados;
- testar sitemap;
- testar robots;
- testar status HTTP;
- acompanhar Search Console.

### 16.3 H1

Cada página deve ter um H1 principal.

O H1 não deve existir apenas para satisfazer uma ferramenta; deve fazer sentido visual e semanticamente.

---

## 17. Performance

### 17.1 Objetivo

A meta é alcançar excelente experiência mobile e Core Web Vitals estáveis.

### 17.2 Prioridades

1. LCP;
2. CLS;
3. INP;
4. TTFB;
5. peso de JavaScript;
6. imagens;
7. fontes;
8. scripts de terceiros.

### 17.3 Estratégia

- Server Components por padrão;
- JavaScript no cliente somente quando necessário;
- imagens dimensionadas;
- cache por tipo de dado;
- carregamento progressivo;
- componentes pequenos;
- evitar bibliotecas pesadas;
- monitorar produção.

---

## 18. Infraestrutura e integrações

### 18.1 Hospedagem

Hostinger Cloud Professional.

O projeto deve confirmar:

- versão de Node;
- processo de build;
- processo de execução;
- variáveis de ambiente;
- reinício;
- logs;
- domínio;
- SSL;
- cache.

### 18.2 Cloudflare

Cloudflare pode oferecer:

- DNS;
- proxy;
- cache;
- segurança;
- compressão;
- regras;
- proteção.

É importante evitar cache de:

- carrinho;
- conta;
- checkout;
- sessão;
- pedidos;
- páginas personalizadas por usuário.

### 18.3 WooCommerce e WordPress

O WordPress atual possui integrações importantes.

Nenhuma migração pode ignorar:

- Bling;
- Melhor Envio;
- Banco Inter;
- feeds;
- analytics;
- Merchant Center;
- notificações;
- estoque;
- e-mails;
- status de pedido.

---

## 19. Estratégia de implementação

### 19.1 Desenvolvimento incremental

A implementação deve ocorrer em fases.

Uma sequência recomendada:

1. base visual;
2. design system;
3. Header e Footer;
4. Home estática;
5. conexão de categorias;
6. conexão de produtos;
7. página de categoria;
8. página de produto;
9. busca;
10. filtros;
11. carrinho;
12. autenticação;
13. checkout;
14. analytics;
15. SEO avançado;
16. migração;
17. monitoramento.

### 19.2 Ambiente de teste

O novo front-end deve ser validado em ambiente separado ou subdomínio antes de substituir o site principal.

### 19.3 Não migrar tudo de uma vez

Funcionalidades críticas devem ser testadas isoladamente.

---

## 20. Critérios de sucesso

O projeto será considerado bem-sucedido quando:

- navegação estiver mais rápida;
- celular estiver fácil de usar;
- produtos forem encontrados rapidamente;
- carrinho for confiável;
- checkout funcionar sem perda de pedidos;
- preço e estoque estiverem corretos;
- SEO for preservado;
- Core Web Vitals melhorarem;
- manutenção ficar mais simples;
- componentes puderem evoluir sem afetar tudo;
- integrações continuarem funcionando;
- o usuário perceber maior confiança.

### 20.1 Métricas técnicas

- LCP;
- CLS;
- INP;
- TTFB;
- erros;
- uptime;
- taxa de falhas de API;
- tamanho de bundle;
- tempo de resposta.

### 20.2 Métricas comerciais

- conversão;
- abandono de carrinho;
- busca sem resultado;
- adição ao carrinho;
- início de checkout;
- compra;
- receita;
- ticket médio;
- contato por WhatsApp;
- uso de filtros;
- uso de categorias.

### 20.3 Métricas de SEO

- cliques;
- impressões;
- CTR;
- posição;
- indexação;
- páginas válidas;
- erros de rastreamento;
- resultados ricos;
- tráfego orgânico;
- tráfego local.

---

## 21. Riscos principais

### 21.1 Cache incorreto

Pode mostrar:

- carrinho de outro usuário;
- preço antigo;
- estoque antigo;
- sessão quebrada;
- checkout inconsistente.

### 21.2 Integração incompleta

Pode causar:

- pedido não enviado;
- pagamento sem pedido;
- estoque incorreto;
- frete incorreto;
- rastreamento duplicado;
- e-mail ausente.

### 21.3 Migração de SEO

Pode causar:

- perda de posições;
- páginas 404;
- canonical errado;
- sitemap incompleto;
- conteúdo ausente;
- schema inválido.

### 21.4 Excesso de JavaScript

Pode anular a vantagem do Next.js.

### 21.5 Dependências demais

Podem aumentar:

- bundle;
- manutenção;
- risco de segurança;
- incompatibilidade;
- complexidade.

### 21.6 Refatoração prematura

Pode atrasar o projeto sem benefício real.

---

## 22. Governança de decisões

Decisões duradouras devem ser documentadas.

Exemplos:

- escolha de autenticação;
- estratégia de carrinho;
- estratégia de cache;
- API usada;
- formato de produto;
- tratamento de variações;
- estrutura de URLs;
- checkout;
- analytics;
- design system;
- migração.

Decisões não devem existir apenas em conversas.

---

## 23. Uso de agentes de IA

Agentes podem:

- analisar;
- planejar;
- editar arquivos;
- criar componentes;
- executar comandos;
- revisar;
- testar;
- documentar.

Agentes não devem:

- alterar produção sem autorização;
- publicar sem autorização;
- expor segredos;
- inventar dados;
- fazer grandes mudanças silenciosamente;
- afirmar que algo funciona sem testar;
- apagar código por preferência.

O `AGENTS.md` é a principal regra operacional.

---

## 24. Documentação planejada

A documentação deve evoluir nestes arquivos:

```text
docs/
├── 00-visao-geral.md
├── 01-arquitetura-nextjs.md
├── 02-design-system.md
├── 03-ux-e-conversao.md
├── 04-seo.md
├── 05-performance.md
├── 06-woocommerce-headless.md
├── 07-componentes.md
├── 08-git-codex-fluxo.md
└── 09-roadmap-checklists.md
```

### 24.1 Responsabilidade de cada arquivo

`00-visao-geral.md`  
Contexto, objetivos, decisões, requisitos e direção do produto.

`01-arquitetura-nextjs.md`  
Estrutura técnica, App Router, dados, cache, erros e organização.

`02-design-system.md`  
Cores, tipografia, layout, espaçamento, botões, cards e componentes visuais.

`03-ux-e-conversao.md`  
Jornada, navegação, busca, filtros, carrinho, checkout e conversão.

`04-seo.md`  
SEO técnico, conteúdo, schema, sitemap, canonical e migração.

`05-performance.md`  
Core Web Vitals, imagens, fontes, cache, scripts e monitoramento.

`06-woocommerce-headless.md`  
API, produtos, categorias, sessão, carrinho, checkout e integrações.

`07-componentes.md`  
Documentação dos principais componentes.

`08-git-codex-fluxo.md`  
Git, branches, commits, revisão e uso de agentes.

`09-roadmap-checklists.md`  
Fases, checklist, QA, deploy e definição de concluído.

---

## 25. Próximos passos recomendados

1. Manter `AGENTS.md` na raiz.
2. Criar a pasta `docs`.
3. Colocar este arquivo como `docs/00-visao-geral.md`.
4. Versionar os dois arquivos.
5. Revisar a estrutura atual do projeto.
6. Criar o design system mínimo.
7. Documentar arquitetura.
8. Continuar o Header.
9. Criar componentes base.
10. Conectar dados somente após a base estar estável.

---

## 26. Conclusão

O projeto Persi Materiais em Next.js não é apenas uma troca de tecnologia.

É uma reconstrução controlada da experiência de compra, mantendo a operação existente e criando uma base mais rápida, organizada e sustentável.

A prioridade não é produzir o maior número de páginas no menor tempo.

A prioridade é construir uma plataforma:

- confiável;
- rápida;
- fácil de usar;
- fácil de manter;
- compatível com o WooCommerce;
- preparada para SEO;
- alinhada com a operação real da Persi;
- capaz de crescer sem repetir os mesmos problemas da plataforma atual.
