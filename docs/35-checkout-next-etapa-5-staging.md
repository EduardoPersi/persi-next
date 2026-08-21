# Etapa 5 — validação do checkout Next em staging/Hostinger

Este roteiro não autoriza mudanças em Cloudflare, DNS ou produção. A Worker Route `persimateriais.com.br/checkout/*` deve permanecer intacta durante toda esta etapa. Nenhum teste concorrente pode alcançar o gateway.

## 1. Instalação exata do plugin 0.6.0

O artefato correto é `wordpress-plugin/persi-headless-checkout.zip` e o plugin exibido no WordPress é **Persi Headless Checkout 0.6.0** (não confundir com o plugin maior `persi-headless`).

1. Fazer backup do banco do staging e da pasta atual do plugin.
2. Confirmar que o staging usa banco, WooCommerce e credenciais separados de produção.
3. Em Plugins → Adicionar plugin → Enviar plugin, selecionar o ZIP acima.
4. Aceitar a substituição da versão anterior e ativar o plugin.
5. Não alterar Worker Route, Cloudflare ou checkout de produção.
6. Confirmar no painel a versão 0.6.0 e a presença do WooCommerce ativo.
7. Confirmar no `wp-config.php`/ambiente do staging o mesmo `PERSI_HEADLESS_CHECKOUT_HMAC_SECRET`, key ID e origem usados pelas instâncias Next de staging.

## 2. Migração administrativa

A ativação chama `Activator::activate()` e executa `dbDelta`. Em atualização de plugin já ativo, um administrador com `activate_plugins` deve abrir `/wp-admin/plugins.php`: o hook `admin_init` chama `Activator::maybe_upgrade()` e executa a migração somente quando `persi_headless_checkout_db_version` é diferente de `2`. Nenhuma rota pública executa `dbDelta`.

Depois, executar `npm run test:checkout:staging-health` em uma máquina segura com as variáveis HMAC. O resultado obrigatório é HTTP 200 com `healthy`, `tableExists` e `uniqueCheckoutAttemptId` verdadeiros, e versões `2`. O endpoint é POST HMAC no mesmo `/checkout-attempt`; não existe health público anônimo.

## 3. Duas instâncias Next reais

1. Publicar o mesmo commit em duas instâncias independentes, A e B, ambas apontando para o mesmo WordPress/MySQL de staging.
2. Configurar nas duas: `CHECKOUT_MODE=next`, Pix/boleto ativos, cartão desativado, `WOO_REQUEST_DIAGNOSTICS=1` e o mesmo segredo temporário `CHECKOUT_STAGING_DRY_RUN_SECRET`.
3. Não configurar credenciais reais de gateway. O header secreto faz a rota parar após persistir o pedido e antes de `PAYMENT_CREATING`.
4. Informar as duas origens diretas em `CHECKOUT_STAGING_INSTANCE_URLS=https://instancia-a,...instancia-b`.
5. Criar um carrinho exclusivo no staging, preencher endereço/frete e guardar o cookie técnico somente no ambiente seguro.
6. Gerar um UUID v4 novo e colocá-lo como `idempotencyKey` no JSON de pagamento.
7. Executar `npm run test:checkout:staging-concurrency`.
8. O script distribui 20 chamadas entre A/B, exige exatamente um HTTP 202 vencedor e consulta o Woo REST pelo metadado `_persi_idempotency_key`. Só passa com exatamente um pedido real e o mesmo `order_id`.
9. Confirmar também no banco/admin Woo e cancelar o pedido seco de staging.
10. Remover imediatamente o segredo dry-run das duas instâncias.

## 4. Chamadas WooCommerce e erros

Com `WOO_REQUEST_DIAGNOSTICS=1`, cada chamada server-side registra `[woocommerce-outbound]` com `api`, `endpoint`, método, status, duração, tentativa e cache, sem payload, cookie ou dados pessoais. Abrir uma janela limpa de logs por etapa e preencher:

| Etapa | Chamadas esperadas a medir | Quantidade real | 500/502/503/timeout | Maior duração |
|---|---|---:|---|---:|
| Carregar `/checkout` | Store API `cart` | Pendente | Pendente | Pendente |
| Preencher CEP/endereço | `cart/update-customer` | Pendente | Pendente | Pendente |
| Escolher frete | `cart/select-shipping-rate` | Pendente | Pendente | Pendente |
| Aplicar/remover cupom | `cart/apply-coupon` ou `cart/remove-coupon` | Pendente | Pendente | Pendente |
| Finalizar | cart autoritativo, produtos/pedido REST v3 e tentativa HMAC | Pendente | Pendente | Pendente |
| Polling | consulta Inter + reconciliação Woo quando terminal | Pendente | Pendente | Pendente |

Para cada falha, registrar horário com timezone, instância, etapa, endpoint sanitizado, status, duração e tipo `timeout/network/database`. Correlacionar com logs PHP/Woo, MySQL, CPU, RAM, I/O e PHP workers da Hostinger. Nunca copiar corpo de requisição, CPF, endereço, e-mail, telefone, cookies ou segredos.

## 5. E2E Pix sandbox

Usar produto e cliente exclusivos do staging. Carrinho → checkout Next → convidado → endereço → frete → cupom opcional → Pix sandbox. Confirmar pedido único, total Woo exatamente igual ao valor enviado ao Inter, `txid` determinístico, referência persistida, QR/copia e cola, refresh da confirmação, polling/webhook e transição final. Guardar apenas IDs técnicos e valores. Se o ambiente Inter não for inequivocamente sandbox, não executar.

## 6. E2E boleto sandbox

Repetir com UUID e carrinho novos. Confirmar pedido único, igualdade de valor, `codigoSolicitacao` persistido, linha digitável, PDF, vencimento, refresh, polling/webhook e status Woo. Simular uma resposta perdida somente com mock controlado; confirmar que `PAYMENT_CREATING` impede segunda emissão. Se o ambiente Inter não for inequivocamente sandbox, não executar.

## 7. Critério final

`STAGING VALIDATED: SIM` exige: health íntegro, 20 chamadas reais entre duas instâncias produzindo exatamente um pedido no Woo/MySQL, E2E sandbox concluído e zero erro 500/502/503, timeout ou banco em toda a janela. Qualquer campo pendente mantém o resultado como `NÃO`.
