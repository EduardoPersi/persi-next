# Política de preços e GTIN — Fase E.5

## Resultado executivo

A auditoria foi exclusivamente de leitura no WooCommerce e não escreveu no staging. A
política de preço reproduz o valor comercial atual; os conflitos de fonte GTIN foram
resolvidos por autoridade comprovada; e duplicidades sem proprietário inequívoco foram
neutralizadas sem inventar dados. O full dry-run pós-política foi aprovado.

## Preços

Os 197 `regular_price` com dígitos não nulos além de centavos foram comparados aos valores
inteiros da Store API usados pelo frontend, carrinho e checkout:

| Política | Correspondência Store API | Diferença total | Diferença máxima |
| --- | ---: | ---: | ---: |
| HALF UP | 197/197 | 0 centavo | 0 centavo |
| HALF EVEN | 196/197 | 1 centavo | 1 centavo |
| Truncamento | 98/197 | 99 centavos | 1 centavo |

Política adotada: conversão decimal textual exata e `HALF UP`, sem ponto flutuante. Entre
os 197 casos, 99 sobem um centavo em relação ao truncamento e 98 permanecem no centavo
inferior. Exemplos: `0.1371216600 → 14`, `67.7815000000 → 6778` e
`38.1942000001 → 3819` unidades menores.

## Autoridade de GTIN

O campo nativo `global_unique_id` é lido pela busca Next e recebe a sincronização do Olist
feita pelo Persi Catalog Engine após correspondência exata de SKU. O metadata legado
`hwp_product_gtin` não é lido por esses fluxos. Nos 14 conflitos válidos, o campo nativo
prevalece; os dois valores são preservados na proveniência.

| Woo ID | SKU | Nativo adotado | Legado preservado |
| ---: | --- | --- | --- |
| 24391 | MS1430 | 606529242534 | 7897754305016 |
| 22345 | 30615 | 3253562306159 | 747752339896 |
| 21433 | 164-38-LT | 2112345164380 | 2112345164397 |
| 20300 | 311V-38-TB | 2112344311389 | 2112345311388 |
| 20297 | 311V-39-TB | 2112344311396 | 2112345311395 |
| 20283 | 311V-43-TB | 2112344311433 | 2112345311432 |
| 19075 | K90104.01palha | 7909421000312 | 7909421000237 |
| 17227 | 408338 | 7897109111354 | 0742832474788 |
| 14809 | 305030 | 0606529242510 | 7897754305030 |
| 9387 | 60011PZ | 7897866460122 | 7899833500022 |
| 9031 | 736039 | 7899713564809 | 7899713564762 |
| 5400 | GUIA90 | 2027540263502 | 7908167506843 |
| 5264 | IW13947 | 7898543592327 | 7897095037133 |
| 4446 | 11000401-M | 07898543590699 | 7898543590699 |

## Grupos duplicados

Os 27 grupos abrangem 56 produtos. A classe é triagem, não autorização para atribuir
propriedade. Sem prova suficiente para escolher um membro, todos recebem `NULL`; a UNIQUE
parcial continua válida e o código bruto permanece no relatório local ignorado pelo Git.

| GTIN | Woo IDs / SKUs | Classe |
| --- | --- | --- |
| 2112344311365 | 21397/311V-36-TB; 21389/311V-36-PTO | D — insuficiente |
| 2112345311449 | 20303/311V-44-PTO; 20280/311V-44-TB | D — insuficiente |
| 7898157440908 | 18253/440908; 18250/40908 | C — embalagem/conjunto |
| 7898543591351 | 29473/10000601-M; 17234/10000601 | A — provável cadastro |
| 6945031111209 | 16812/63E-7525; 16810/63E-1025; 16808/1209 | D — insuficiente |
| 7898529716372 | 22489/270024; 13861/16372 | B — item comercial duplicado |
| 7899612788771 | 16042/88771; 12615/7034455 | D — insuficiente |
| 7898543594901 | 29569/10000751-M; 12170/10000751 | A — provável cadastro |
| 2057717782000 | 12061/PLACACIM6; 12059/PLACACIM10; 12054/PLACACIMEN4 | D — insuficiente |
| 7894627026429 | 20151/00000000760262; 6855/3128-CR | D — insuficiente |
| 7897801313254 | 29615/0117-M; 6317/0117 | D — insuficiente |
| 7897801313261 | 29611/0118-M; 6313/0118 | D — insuficiente |
| 7897801313278 | 29606/0119-M; 6309/0119 | D — insuficiente |
| 7897801313285 | 29601/0120-M; 6305/0120 | D — insuficiente |
| 7897801313292 | 29595/0121-M; 6301/0121 | D — insuficiente |
| 7897801313308 | 29590/0122-M; 6299/0122 | D — insuficiente |
| 649615735596 | 5899/35596; 5844/40057 | D — insuficiente |
| 7897273257568 | 18756/9205000059resistencia; 5434/9205000059 | B — item comercial duplicado |
| 7898543590668 | 5320/10000251; 4481/10000251-M | D — insuficiente |
| 7898543590675 | 5316/10000321; 4466/10000321-M | D — insuficiente |
| 7898543590651 | 5324/10000201; 4462/10000201-M | D — insuficiente |
| 7898543590682 | 5312/10000501; 4458/10000501-M | D — insuficiente |
| 7898543590712 | 5296/11000751; 4454/11000751-M | D — insuficiente |
| 7898543590705 | 5300/11000501; 4450/11000501-M | D — insuficiente |
| 7898543590729 | 5308/11001001; 4442/11001001-M | D — insuficiente |
| 7898963309208 | 3740/1016001; 3737/1016002 | D — insuficiente |
| 7898543591207 | 4437/10000401; 3551/10000401-M | D — insuficiente |

Resumo: 22 grupos D, dois A, dois B e um C. Propriedade comercial inferida: 0/27.
Neutralização operacional determinística: 27/27. Produtos afetados: 56.

## Gate final

O full dry-run pós-política processou 3.080 produtos em 38 GETs, sem retry. Produziu 3.080
SKUs válidos, 197 preços válidos, 14 conflitos resolvidos, 208 GTINs `NULL` (152 ausentes e
56 neutralizados), zero registro inválido e zero conflito bloqueante. PIM permaneceu em
1.410 mapeados, um não mapeado e 237 ambíguos. Nenhum dos 2.980 restantes foi importado.

## Aplicação na E.6

A política foi aplicada aos 3.080 produtos. O staging terminou com 3.080 preços válidos,
zero divergência comercial, 208 GTINs `NULL` e zero GTIN não nulo duplicado. A segunda
passagem não alterou preço ou GTIN.
