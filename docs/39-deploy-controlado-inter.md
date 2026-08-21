# Deploy controlado — Pix e boleto Banco Inter

Este roteiro prepara a publicação do checkout Next sem alterar sua arquitetura,
sem executar cobrança automaticamente e sem modificar Cloudflare. A Worker Route
existente segue o plano operacional já aprovado e não faz parte deste deploy de
código.

## 1. Variáveis da aplicação Hostinger

Confirmar no ambiente de runtime, sem imprimir os valores nos logs:

### Checkout e WooCommerce

- `WORDPRESS_URL=https://loja.persimateriais.com.br`
- `CHECKOUT_MODE=next`
- `CHECKOUT_PIX_ENABLED=true`
- `CHECKOUT_BOLETO_ENABLED=true`
- `CHECKOUT_CARD_ENABLED=false`
- `CHECKOUT_CARD_PRODUCTION_APPROVED=false`
- `WOOCOMMERCE_CONSUMER_KEY`
- `WOOCOMMERCE_CONSUMER_SECRET`
- `PERSI_HEADLESS_CHECKOUT_HMAC_SECRET`
- `PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID=primary`
- `PERSI_HEADLESS_CHECKOUT_ORIGIN=https://persimateriais.com.br`
- `PERSI_HEADLESS_CHECKOUT_ATTEMPT_ENDPOINT=https://loja.persimateriais.com.br/wp-json/persi-headless/v1/checkout-attempt`
- `PERSI_HEADLESS_CHECKOUT_AUTH_SECRET`
- `PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID=primary`

O segredo HMAC, o key ID e a origem precisam corresponder exatamente aos
valores do plugin WordPress. O endpoint de transferência continua necessário
para o rollback híbrido, mas não participa do pagamento normal em modo `next`.

### Banco Inter

- `APP_BASE_URL=https://persimateriais.com.br`
- `INTER_API_BASE_URL` apontando para o ambiente Inter contratado
- `INTER_CLIENT_ID`
- `INTER_CLIENT_SECRET`
- `INTER_CERTIFICATE_BASE64`
- `INTER_PRIVATE_KEY_BASE64`
- `INTER_PIX_KEY`
- `CRON_SECRET`

Certificado e chave privada devem conter o arquivo completo codificado em
Base64, sem prefixo `data:`, aspas adicionais ou quebras introduzidas pelo
painel. Não usar prefixo `NEXT_PUBLIC_` em nenhuma dessas variáveis.

### Somente staging

Não configurar `CHECKOUT_STAGING_DRY_RUN_SECRET`,
`CHECKOUT_STAGING_INSTANCE_URLS`, `CHECKOUT_STAGING_COOKIE` ou
`CHECKOUT_STAGING_PAYMENT_JSON` em produção. Manter
`WOO_REQUEST_DIAGNOSTICS=0` normalmente; ativá-lo temporariamente apenas em uma
janela acompanhada de diagnóstico.

## 2. Checklist de deploy Hostinger

1. Guardar o SHA atual em produção e confirmar que o rollback consegue
   republicá-lo.
2. Fazer backup do banco e confirmar o plugin **Persi Headless Checkout 0.6.0**.
3. Abrir `/wp-admin/plugins.php` como administrador para executar
   `Activator::maybe_upgrade()` caso a versão do banco ainda não seja `2`.
4. Conferir as variáveis acima no serviço Next e a correspondência HMAC no
   WordPress, sem copiar valores para tickets ou logs.
5. Publicar exatamente o commit aprovado da branch `main`.
6. Executar instalação reproduzível das dependências e `npm run build`.
7. Reiniciar apenas a aplicação Next e confirmar que o processo iniciou sem
   erro de configuração.
8. Não alterar DNS, regras de cache, Worker ou Worker Route neste deploy.
9. Chamar `GET /api/checkout/payment/health` com o header privado
   `x-persi-staging-dry-run`, usando temporariamente um segredo forte e removendo
   o segredo logo depois. O endpoint somente autentica, consulta referências
   inexistentes e verifica a tabela; não cria cobrança.
10. Exigir HTTP 200, `healthy: true`, OAuth/mTLS válidos, leitura Pix/boleto
    autorizada, tabela existente e índice UNIQUE existente.
11. Fazer smoke test de Home, produto, carrinho, Identity Gate, endereço, frete,
    cupom e revisão do pedido sem finalizar o pagamento.
12. Abrir uma janela de logs da Hostinger, WordPress/WooCommerce, PHP e MySQL
    para os testes manuais.

### Rollback

Se health, carrinho ou checkout falhar antes dos testes financeiros, interromper
o teste e republicar o SHA anterior. Não apagar pedidos nem cobranças para
“limpar” o teste; cancelar pelos fluxos administrativos dos respectivos
sistemas, preservando a trilha de auditoria.

## 3. Teste manual Pix de baixo valor

1. Confirmar explicitamente se `INTER_API_BASE_URL` é sandbox ou produção. Em
   produção, usar produto real de menor valor autorizado e dados reais do
   comprador responsável pelo teste.
2. Criar carrinho novo, registrar o total exibido e guardar apenas IDs técnicos.
3. Passar por Identity Gate, endereço, CEP, frete e cupom aplicável.
4. Conferir que o total final do checkout coincide com carrinho e WooCommerce.
5. Selecionar Pix e clicar **uma única vez** em finalizar. Este é o ponto que
   cria pedido e cobrança real; nenhuma etapa anterior deve cobrar.
6. Confirmar exatamente um pedido Woo, um `checkout_attempt_id`, um `txid` e
   uma cobrança Inter com o mesmo valor.
7. Validar QR Code, copia e cola, vencimento, refresh da confirmação e retomada
   sem nova emissão.
8. Pagar manualmente apenas se o teste real estiver autorizado. Confirmar
   polling/webhook, status pago no Woo e página de confirmação.
9. Confirmar que o carrinho/sessão não se perdeu antes do estado terminal.
10. Registrar status HTTP, duração, IDs e valores; nunca registrar documento,
    endereço, cookies, token, certificado ou segredo.

## 4. Teste manual de boleto

Executar somente depois de o Pix terminar sem erro.

1. Usar carrinho, UUID e pedido novos; repetir endereço, frete, cupom e
   conferência do total autoritativo.
2. Selecionar boleto e clicar **uma única vez** em finalizar. Esse clique cria
   uma cobrança real quando o ambiente Inter é produção.
3. Confirmar exatamente um pedido Woo, uma tentativa e um
   `codigoSolicitacao`, todos vinculados ao mesmo valor.
4. Validar linha digitável, código de barras, vencimento, PDF, refresh e
   retomada sem segunda emissão.
5. Não pagar o boleto sem autorização adicional. Se o objetivo for somente
   emissão, cancelar administrativamente depois de registrar a evidência.
6. Se houver pagamento autorizado, conferir polling/webhook e status final no
   WooCommerce.

## 5. Critério de aprovação

Pix ou boleto só é aprovado quando houver exatamente um pedido e uma cobrança,
total Inter igual ao total WooCommerce, sessão preservada e nenhum erro
recorrente HTTP 500/502/503, timeout, PHP ou banco na janela do teste. Em caso
de resposta ambígua, não clicar novamente: consultar a tentativa, o pedido e o
provedor antes de qualquer retry.
