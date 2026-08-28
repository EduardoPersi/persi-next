# PIM P.2 — workflow editorial

## Separação de dados

SOURCE permanece no catálogo operacional e é somente leitura. DRAFT usa as colunas editoriais de `pim_product_profiles`. APPROVED é um snapshot em `approved_content`. Nenhum desses dados é publicado automaticamente em PDP, cards, busca, feeds, Merchant ou SEO público.

## Conteúdo

O perfil contém nome comercial, descrições curta e completa, bullet points, aplicação, especificações, SEO title, meta description, search terms e alt editorial. Bullet points e search terms são arrays; os demais campos são texto simples renderizado com escaping do React. HTML arbitrário não é aceito.

## Workflow

- ausência/needs enrichment → salvar → draft;
- draft → enviar → needs review;
- needs review → approve ou reject;
- approved/rejected → reopen → draft;
- draft → discard → último approved, quando existente, ou needs enrichment.

Uma aprovação copia o draft para o snapshot. Reabrir e editar nunca modifica o snapshot anterior. Uma nova aprovação é necessária para substituí-lo.

## Concorrência e auditoria

Cada profile possui `version`. As ações usam lock de linha e comparam a versão enviada pela tela; versão stale é rejeitada sem last-write-wins. CREATE_DRAFT, UPDATE_DRAFT, SUBMIT_REVIEW, APPROVE, REJECT, REOPEN e DISCARD_DRAFT registram before/after, actor, motivo e timestamp na mesma transação da alteração.

O actor é produzido no servidor a partir da sessão WordPress autenticada e autorizada. O navegador não pode fornecer actor confiável nem acessar PostgreSQL administrativo diretamente.

## Limites

Atributos continuam somente leitura. Não há autosave agressivo, chamada externa de IA, backfill, mudança de slug/canonical, escrita Woo/Olist ou publicação. A migration P.2 somente poderá ser considerada aprovada após rebuild local e pgTAP em ambiente com espaço seguro.
