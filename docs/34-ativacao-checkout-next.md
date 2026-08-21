# Ativação do checkout Next

## Configuração definitiva desta fase

`CHECKOUT_MODE=next`, Pix e boleto ativos, cartão desativado. O modo `hybrid` só pode ser ligado manualmente para rollback. Falhas do checkout Next exibem erro controlado e nunca redirecionam automaticamente ao WooCommerce.

Os CTAs do carrinho e mini carrinho abrem `/checkout`. A rota `/checkout/hybrid`, a transferência assinada, o plugin e o Worker continuam no repositório, mas não participam do fluxo normal.

## Carrinho

O carrinho não é limpo na criação do pedido. Continua disponível enquanto Pix/boleto estiver pendente, preservando autorização e retomada. Quando a rota server-side de status observa estado terminal (`paid` ou `failed`, incluindo expiração categorizada), ela expira o cookie `Cart-Token`; o carrinho Woo anterior fica inacessível e uma nova visita inicia outra sessão. A tentativa, pedido e referência continuam no WordPress, portanto refresh da confirmação não recria pedido ou cobrança.

## Cloudflare — operação manual

No painel Cloudflare, localizar a Worker Route exatamente `persimateriais.com.br/checkout/*` e removê-la/desativá-la, sem apagar o Worker. Confirmar depois que `/checkout` responde pelo deploy Next e que `/checkout/hybrid` só é usado conscientemente no rollback.

## Concorrência de staging

Configurar um segredo temporário `CHECKOUT_STAGING_DRY_RUN_SECRET` somente no staging e executar `npm run test:checkout:staging-concurrency` com duas instâncias Next atrás do balanceamento. O script faz 20 POSTs simultâneos com a mesma tentativa e interrompe o vencedor depois do pedido, antes do gateway. Exigir um HTTP 202, um `order_id` único e confirmar no WooCommerce que há exatamente um pedido. Remover o segredo após o teste.

Durante Pix/boleto E2E, registrar somente endpoint, status HTTP, duração e etapa. Comparar o total do pedido Woo com o valor enviado ao Inter. Contabilizar chamadas por render, CEP, seleção de frete, cupom, pagamento e polling; não registrar endereço, documento, e-mail, telefone, cookie ou segredo.

## Checklist futuro de cartão

- homologação PagBank/EFI;
- tokenização sem cartão bruto no servidor Persi;
- revisão PCI;
- 3DS, quando aplicável;
- webhooks e reconciliação;
- parcelamento;
- antifraude;
- testes de autorização, recusa, retry e charge duplicada.

## Ordem operacional

1. Deploy do Next.
2. Deploy do plugin `persi-headless-checkout` 0.6.0.
3. Abrir uma página administrativa autorizada para executar o upgrade controlado da tabela.
4. Validar o endpoint assinado `checkout-attempt`.
5. Executar o teste concorrente sem gateway.
6. Remover somente a Worker Route `persimateriais.com.br/checkout/*`.
7. Definir `CHECKOUT_MODE=next`, Pix/boleto `true` e cartão `false`.
8. Reiniciar/redeployar a aplicação e limpar apenas os caches necessários.
9. Testar Pix em sandbox e conferir igualdade de valores.
10. Testar boleto em sandbox, PDF e igualdade de valores.

## Rollback

Definir `CHECKOUT_MODE=hybrid`, reativar a Worker Route `persimateriais.com.br/checkout/*`, reiniciar a aplicação e validar uma compra de teste. Não apagar Worker, proxy ou plugin híbrido.
