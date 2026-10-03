# 44 — Deploy da etapa C: produtos e preços ao vivo

Dois repositórios, nesta ordem: **o site primeiro**, o painel depois.

## 0. ANTES DE TUDO: a `main` do site já está mexida

O merge da etapa C na `main` do site **já foi feito e empurrado** (commit
`3fd4e1c`), antes de a regra "não faça o merge sem eu confirmar" existir.

E ele levou junto **mais do que a etapa C**. Estes commits estavam na branch de
trabalho e ainda não estavam na `main`:

| commit | o que é | muda o site em produção? |
| --- | --- | --- |
| `9e614fb` | a rota `/api/painel/produtos` (etapa C) | **não**, sem `PAINEL_API_KEY` ela responde 401 a todo mundo |
| `be6a061` | documento de desenho | não |
| `53eb1f8` | o aviso de pedido pago pelo WhatsApp, lado do site | **sim, em potencial** — ver abaixo |
| `0d6ff50`, `1077352`, `6b7a959` | configuração do MCP da Hostinger | não |

**O único com efeito real é o `53eb1f8`.** Ele mexe em
`services/payments/reconcile.ts`, no ponto em que um pedido vira pago, e passa
a pedir ao painel que avise o cliente no WhatsApp. Esse caminho só acorda se
**as duas** variáveis existirem no ambiente do site:

```
PAINEL_URL=
SITE_WEBHOOK_KEY=
```

Com qualquer uma vazia, `avisarPeloWhatsapp` devolve `enviado: false` sem
sequer fazer a requisição, e o pedido segue igual. **Confira isso antes de
publicar** (passo 1).

### Como a publicação acontece — eu não consigo dizer daqui

Não há `.github/workflows` neste repositório, então **não é GitHub Actions**.
Resta a publicação da Hostinger, e a API dela está bloqueada pela política de
rede deste ambiente (`request blocked: developers.hostinger.com`), então não dá
para eu olhar.

**Confira em uma tela**, no hPanel:

> **Websites → persimateriais.com.br → (aplicação Node.js) → Git / Implantação
> automática**

- **Se a implantação automática estiver LIGADA na `main`**: o push já disparou
  uma publicação. Vá ao passo 1 agora e confira as duas variáveis.
- **Se estiver DESLIGADA**: nada foi publicado. A `main` mudou no GitHub e o
  site no ar continua o de antes, até alguém mandar publicar.

### Desfazer o merge do site, se for o caso

Pelo GitHub (não há cópia do site no VPS). Em
`EduardoPersi/persi-next → Commits → 3fd4e1c → Revert`, ou me peça que eu faço:
reverter um merge é `git revert -m 1 3fd4e1c`, que desfaz **os seis commits de
uma vez** e volta a `main` ao estado de `062931d`.

Se a implantação for automática, **reverter dispara outra publicação** — é uma
segunda mudança, não um desfazer silencioso.

---

## 1. A chave, sem passar pelo histórico

No **terminal do navegador do hPanel do VPS** (o do painel), gere:

```
openssl rand -hex 32
```

Ela aparece **na tela**, e não no histórico: o comando não contém segredo
nenhum. Copie da tela, guarde no seu gerenciador de senhas e, no fim de tudo,
limpe a tela com `clear`.

**Não cole a chave aqui na conversa.** Ela vai para dois lugares, os dois em
campo de formulário:

| Onde | Tela | Nome |
| --- | --- | --- |
| site | hPanel → Websites → persimateriais.com.br → aplicação Node.js → **Variáveis de ambiente** | `PAINEL_API_KEY` |
| painel | Painel → Configurações → Integrações → **Site (produtos e preços)** | campo "Chave compartilhada" |

No painel, cadastre **pela tela** e não pelo `.env`: lá a chave fica cifrada no
cofre, dá para testar com um clique e trocar sem reiniciar nada.

> Enquanto estiver nessa tela de variáveis do site, **confira também
> `PAINEL_URL` e `SITE_WEBHOOK_KEY`** (o passo 0). Se não quiser o aviso de
> pedido no WhatsApp ainda, deixe as duas vazias.

---

## 2. Publicar o site

Na mesma tela da aplicação Node.js, use **Build** (ou "Implantar") e depois
**Reiniciar aplicação**. Variável de ambiente nova só vale depois do reinício.

### Conferência, com os dois `curl`

No terminal do hPanel do VPS — de propósito: o que interessa é se **o servidor
do painel** alcança o site.

**Primeiro: sem chave, tem de recusar.** Tem de imprimir `401`:

```
curl -s -o /dev/null -w "%{http_code}\n" "https://persimateriais.com.br/api/painel/produtos?q=cimento"
```

**Segundo: com a chave, tem de aceitar.** A chave **não pode ir na linha de
comando** — ela ficaria no `~/.bash_history` e à vista de qualquer `ps`. Então
ela é digitada sem eco e guardada num arquivo de configuração do `curl`, que é
apagado em seguida. Cole os três, um por vez:

```
umask 077 && read -r -s -p "Cole a chave e tecle Enter: " K && echo && printf 'header = "X-Painel-Key: %s"\n' "$K" > /tmp/k.conf && unset K && echo "pronto"
```

```
curl -s -K /tmp/k.conf -o /dev/null -w "%{http_code}\n" "https://persimateriais.com.br/api/painel/produtos?q=cimento"
```

```
rm -f /tmp/k.conf && history -c 2>/dev/null; clear
```

O segundo tem de imprimir **200**.

| Resposta | O que é |
| --- | --- |
| `200` | certo |
| `401` nos dois | a variável não chegou ao processo no ar — reinicie a aplicação |
| `404` | a publicação não levou o commit novo |
| `502` | a rota está de pé; quem não respondeu foi o catálogo atrás dela |
| `000` | o VPS não alcança o site |

---

## 3. O painel

```
cd ~/persi-atendimento && git log --oneline -1 && git status --short
```

```
cd ~/persi-atendimento && bash scripts/atualizar.sh
```

Em `== 3/4 Migrações ==` tem de dizer **"Banco em dia"**: nem a etapa C nem o
conserto do menu têm migração.

**Esta atualização leva duas coisas**: a busca de produto (etapa C) e o
**botão de fechar do menu "Mais" no celular** (`docs/deploy-fechar-do-menu.md`).

Depois, **Configurações → Integrações → Site (produtos e preços) → Cadastrar**:

- **Endereço do site**: `https://persimateriais.com.br` (com `https://`, sem
  barra no fim);
- **Chave compartilhada**: a do passo 1;
- a sua senha, para confirmar.

E **Testar**. Tem de dizer que respondeu com produto.

---

## 4. Conferir na tela

Na conversa:

- [ ] o **"+"** mostra **Produto do site**;
- [ ] buscar "cimento" traz nome e preço, e embaixo **"preço lido às HH:MM"**;
- [ ] um produto em promoção mostra **os dois preços**;
- [ ] um sem estoque diz **"sem estoque no site"** por escrito;
- [ ] tocar num produto põe **nome — preço** e o **link na linha de baixo**, e
      **não** escreve nada sobre estoque;
- [ ] escreva algo antes e insira: o que você escreveu **continua lá**.

No celular:

- [ ] a folha do **"Mais"** tem um **×** no canto, e ele fecha sem escolher nada;
- [ ] a busca de produto abre acima do teclado e a lista rola.

---

## 5. Desfazer

**No painel** — Configurações → Integrações → Site (produtos e preços) →
**Remover**. O atalho some do "+" e o atendimento segue como era. Não há dado
guardado para limpar, porque preço nunca é guardado.

Para voltar o código do painel inteiro:

```
cd ~/persi-atendimento && git log --oneline -3
```

```
cd ~/persi-atendimento && git checkout 50234f2 && bash scripts/atualizar.sh
```

(`50234f2` é a `main` antes da etapa C — ela já tem o conserto do menu "Mais".)

**No site** — apagar a variável `PAINEL_API_KEY` na tela de variáveis de
ambiente e reiniciar a aplicação. A rota passa a responder 401 a todo mundo,
que é o mesmo que não existir. Para tirar o código, o `Revert` do passo 0.

---

## 6. Ordem, em uma linha

1. conferir se a implantação do site é automática (passo 0);
2. gerar a chave e pô-la nas **duas** telas (passo 1);
3. publicar o site e reiniciar a aplicação;
4. os dois `curl`: `401` sem chave, `200` com chave;
5. `atualizar.sh` no painel;
6. cadastrar e **Testar** em Integrações;
7. conferir na conversa e no celular.
