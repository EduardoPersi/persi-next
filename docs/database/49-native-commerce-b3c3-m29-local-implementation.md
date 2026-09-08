# B.3-C3-P3-C-M29-A/B — local implementation attempt

## Retomada A2/B2 (2026-09-05)

O blocker foi resolvido na candidata local: DML direto é revogado, primitivas de cart
são owner-aware e guards estruturais precedem o hash e a submissão atômica. A
validação foi estática/offline. PostgreSQL permaneceu em 28 migrations, último
histórico `20260905130000`, com zero objetos M29 persistentes. Compilação transacional
e comportamento real das roles continuam reservados para M29-C.

Data: 2026-09-05. Resultado: hard stop no gate de reconciliação P0, antes de criar a
migration candidata.

## Baseline

- PostgreSQL 17.6;
- migrations persistentes 28/28;
- última `20260905130000`;
- migration 29 ausente;
- hashes P3-A, P3-B e migrations 26–28 canônicos;
- pgTAP canônico anterior 508/508;
- zero acesso remoto e zero requests externos.

## Blocker

`M29_IMPLEMENTATION_CONTRACT_MISMATCH`.

O P0 assumiu que um cart `locked` não muda durante a submissão e que um cart
`converted` é terminal. O catálogo atual mostra o contrário na fronteira da role:

- `persi_app`: SELECT/INSERT/UPDATE em `carts`;
- `persi_app`: SELECT/INSERT/UPDATE/DELETE em `cart_items`;
- `persi_worker`: policies equivalentes `FOR ALL`;
- somente triggers `*_set_updated_at` nas duas tabelas;
- nenhuma validação estrutural de transições de `cart_status`;
- nenhum guard de mutabilidade de item condicionado ao status do cart.

Bloquear a linha do cart não elimina INSERTs concorrentes em `cart_items`. Bloquear os
itens existentes também não elimina phantoms sob o isolamento padrão. Um table lock
global dentro da submissão seria desproporcional e não é a fronteira projetada.

## Decisão

Conforme o hard stop da M29-A/B:

- migration 29 criada: não;
- SQL de submissão criado: não;
- Drizzle alterado: não;
- testes estáticos M29 criados: não;
- banco persistente alterado: não;
- reset/truncate: não;
- M29-C: não iniciada.

O próximo design deve incorporar autoridade estreita do carrinho. A alternativa mais
coerente é endurecer as quatro primitivas existentes de cart, revogar DML direto das
roles técnicas e adicionar transição/imutabilidade estrutural compatível. Outra solução
só é aceitável se provar ausência de phantoms e impossibilidade de reativar carts
terminais sem table locks globais.

Referência posterior: o P0B resolveu o desenho desse blocker sem alterar o banco. A
solução aprovada e o delta revisado estão documentados em
`docs/database/50-native-commerce-b3c3-cart-authority-hardening-design.md`. Esta seção
preserva o hard stop histórico da tentativa A/B; a implementação continua pendente de
autorização separada para A2/B2.
