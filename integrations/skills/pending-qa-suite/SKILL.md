---
name: pending-qa-suite
description: Cria no DevBoard, através da API de publicação, uma suite de testes manuais para tudo o que está em master mas ainda não foi para produção (release pendente). A descrição da suite resume as alterações e destaca os pontos críticos; cada teste tem título, instruções, passos e resultado esperado, atribuído ao email git/GitLab de quem corre a skill (ou a --email=...). Ativar quando o utilizador disser "/pending-qa-suite", "cria a suite de QA da release", "suite de testes do que vai para produção", "preparar QA antes do deploy" ou similar.
---

# pending-qa-suite

## Contexto

Esta skill corre no repositório da aplicação a libertar (ex.: `empresa/loja-online`), não
no DevBoard. Em vez de devolver uma checklist em Markdown, **publica uma suite no DevBoard**
com um teste manual por alteração relevante, para que a equipa registe Aprovado/Rejeitado
na própria aplicação.

O raciocínio: comparar `deploy-producao-last` (tag da última produção conhecida; use
`--base` se o seu repositório usar outro nome) com `origin/master`, classificar cada MR por
área e risco e destacar o que é crítico.

Regras do DevBoard que esta skill respeita:
- os testes são manuais e começam **Pendentes**; nunca enviar estados ou resultados;
- a chave de integração só pode criar suites no seu projeto; o segredo nunca é impresso,
  registado nem escrito em ficheiros;
- cada publicação usa uma `Idempotency-Key` e retries da mesma publicação reutilizam-na.

## Argumentos

| Argumento | Efeito |
|---|---|
| `--email=nome@empresa.pt` | Email do responsável dos testes. Substitui a deteção automática. |
| `--base=<ref>` (ou um ref posicional) | Baseline no lugar de `deploy-producao-last` (branch, tag ou commit). |
| `--project=<uuid>` | Projeto DevBoard no lugar de `TESTHUB_PROJECT_ID`. |
| `--dry-run` | Gera e mostra o JSON da suite, mas não publica. |
| `--yes` | Publica sem pedir confirmação depois da pré-visualização. |

Exemplo: `/pending-qa-suite --email=nome@empresa.pt`

## Configuração necessária (ambiente)

- `TESTHUB_URL`: endereço do DevBoard, ex.: `https://devboard.empresa.pt`. Tem de ser HTTPS,
  exceto `http://localhost` ou `http://127.0.0.1`.
- `TESTHUB_API_KEY`: chave de integração do projeto (DevBoard → Definições → Publicação
  por IA → Criar chave). Sugestão de nome da chave: `pending-qa-suite`.
- `TESTHUB_PROJECT_ID`: UUID do projeto DevBoard (ou `--project`).

Verificar apenas a presença, sem mostrar valores:

```bash
for v in TESTHUB_URL TESTHUB_API_KEY TESTHUB_PROJECT_ID; do
  [ -n "${!v}" ] && echo "$v: definido" || echo "$v: EM FALTA"
done
```

Se faltar alguma variável (e não houver `--project`), parar e explicar ao utilizador como
a definir. Nunca pedir que cole a chave no chat. Nunca correr comandos com `set -x` nem
fazer `echo` da chave.

## Workflow

### 1. Determinar o responsável

Ordem de resolução:
1. `--email=...`, se foi passado;
2. `git config user.email` (normalmente é o email da conta GitLab);
3. se `glab` estiver instalado e autenticado, `glab api user` (campo `email`).

Se nenhum devolver um email válido, parar e pedir ao utilizador para correr de novo com
`--email=...`.

Este email vai em `assigneeEmail` em **todos** os testes. O servidor converte-o no membro
do projeto com esse email (sem distinguir maiúsculas). Se a pessoa não for membro do
projeto, a publicação é recusada (400) e nada é criado.

Sobre o **criador da suite**: o DevBoard regista sempre o autor verificado do pedido, que
numa publicação por chave aparece como `Integração: <nome da chave>`. A API não aceita um
criador indicado pelo cliente, porque isso permitiria fazer-se passar por outra pessoa.
Por isso o responsável fica:
- como responsável de todos os testes (`assigneeEmail`);
- indicado na descrição da suite (`**Responsável:** email`).

### 2. Atualizar referências e calcular o intervalo pendente

```bash
git fetch origin master
git fetch origin +refs/tags/deploy-producao-last:refs/tags/deploy-producao-last
BASE_REF="${BASE_OVERRIDE:-deploy-producao-last}"
if git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null; then
  RANGE="$BASE_REF..origin/master"
  BASE_SHA=$(git rev-parse "$BASE_REF^{commit}")
else
  RANGE="-10 origin/master"   # fallback: avisar que não há tag de referência
  BASE_SHA=$(git rev-parse origin/master~10)
fi
HEAD_SHA=$(git rev-parse origin/master)
git rev-list --count $RANGE
```

Se a contagem for 0: **não criar suite**. Responder só "Não há alterações pendentes de
subir para produção neste momento." e terminar.

### 3. Listar os MRs pendentes

```bash
git log --merges --first-parent --pretty=format:"%H|%s|%b|||" $RANGE
```

De cada bloco extrair o hash do merge, o título e o número do MR (`See merge request .*!(\d+)`).
Commits diretos em `master` sem merge (`git log --no-merges --first-parent $RANGE`) também
contam e são tratados como um MR sem número.

Se `glab` estiver autenticado, `glab mr view <iid>` pode enriquecer o contexto com a
descrição do MR. É opcional e não bloqueia.

### 4. Ficheiros alterados por MR

```bash
git diff --stat <merge>^1..<merge>
```

Quando o título não chega para perceber o comportamento a testar, ler o diff relevante
(`git diff <merge>^1..<merge> -- <ficheiro>`). Não copiar código, segredos, dados de
clientes ou valores de `.env` para a suite.

### 5. Classificar por área e risco

| Padrão de ficheiros / pasta | Área | Nível | O que confirmar |
|---|---|---|---|
| Carrinho, checkout, cálculo de totais | Carrinho / Checkout | 🔴 CRÍTICO | Adicionar/remover artigos, concluir uma compra sem encomenda duplicada, totais corretos |
| Controllers/rotas que mostram dados de um cliente (encomendas, faturas, perfil) | Controlo de acesso | 🔴 CRÍTICO | Um cliente autenticado **não consegue** ver dados de outro cliente mudando um identificador no URL |
| Integrações e webhooks de pagamento | Pagamentos | 🔴 CRÍTICO | Os métodos de pagamento concluem; o webhook não duplica nem falha a marcação como paga; reembolsos funcionam |
| Promoções, vouchers, regras de preço | Preços / Campanhas | 🔴 CRÍTICO | Preços finais corretos; caches de preços atualizadas após o deploy, se necessário |
| Backoffice, permissões, RBAC | Backoffice / Permissões | 🔴 CRÍTICO | Cada role só vê/altera o que lhe é permitido; sem escalonamento de privilégio |
| Login social / OpenID / SSO | Autenticação de clientes | 🔴 CRÍTICO | Contas não são associadas só por email (risco de account takeover); SSO funciona |
| `database/migrations/**`, schema | Base de dados | 🔴 CRÍTICO | Migração corre sem erros em produção; dados de teste atualizados se o schema mudou |
| Integração com ERP, faturação, sincronizações agendadas | Integrações externas | 🟠 ALTO | Encomendas/faturas chegam ao sistema externo; sincronizações sem erros |
| Configuração por loja, país ou domínio | Multi-loja | 🟠 ALTO | Comportamento correto em cada loja/domínio |
| Motor de pesquisa, indexação, homepage, facetas | Catálogo / Pesquisa | 🟡 MÉDIO | Pesquisa e listagens corretas; produto novo/alterado aparece |
| Resto (copy, estilos, pequenos ajustes visuais) | Geral | ⚪ BAIXO | Verificação visual rápida |

Ajustar/acrescentar áreas conforme a aplicação e os ficheiros realmente alterados. Se o
repositório tiver um registo de achados de segurança em aberto (ex.: `docs/SECURITY.md`),
cruzar com ele: um MR que toque num ficheiro associado a um achado em aberto tem de
aparecer nos pontos críticos da descrição e nas instruções do teste (ex.: "⚠️ Este MR mexe
em código relacionado com o achado SEC-…").

### 6. Gerar o JSON da suite

Formato aceite por `POST /api/v1/projects/{projectId}/suites` (o servidor rejeita campos
desconhecidos):

```json
{
  "title": "Release pendente — 2026-10-07 (a1b2c3d → e4f5a6b)",
  "description": "…Markdown…",
  "provenance": {
    "repository": "<git remote get-url origin, sem credenciais>",
    "branch": "master",
    "commit": "<HEAD_SHA>"
  },
  "tests": [
    {
      "title": "[CRÍTICO] Checkout — finalizar compra com MB WAY (MR !123)",
      "instructions": "…Markdown: contexto e pré-condições…",
      "steps": ["Passo 1", "Passo 2"],
      "expectedResult": "…resultado observável…",
      "assigneeEmail": "nome@empresa.pt"
    }
  ]
}
```

Limites: título ≤ 200 caracteres; cada passo ≤ 2000; ≤ 100 passos por teste; ≤ 500
testes. Remover credenciais do URL do repositório (`https://user:token@…` → `https://…`).

**Descrição da suite** (Markdown, curta e legível pelo gestor):

```markdown
## Resumo da release
2 a 4 frases em linguagem simples sobre o que muda para clientes e para o backoffice.

## ⚠️ Pontos críticos a confirmar
- **Checkout** (MR !123): …porque é crítico, numa frase.
- **SEC-…**: o MR !130 mexe em código ligado a um achado de segurança em aberto…
(se não houver: "Esta release não tem alterações críticas.")

## Alterações por área
- **Preços / Campanhas**: MR !124, !127 — …
- **Outros**: …

## Âmbito
- Intervalo: `deploy-producao-last` (`a1b2c3d`) → `origin/master` (`e4f5a6b`)
- {{N}} MRs, {{N}} commits
- **Responsável:** nome@empresa.pt

> Testes manuais para validação antes/depois do deploy. Não substituem os testes
> automáticos nem o pipeline de CI.
```

Se a tag não existir e for usado o fallback de 10 commits, indicar isso no Âmbito.

**Testes**: regras de conteúdo
- Um teste por MR, ou por grupo de MRs muito relacionados que se testem juntos.
  As alterações ⚪ BAIXO podem ficar num único teste "Verificação visual geral".
- Ordem: 🔴 CRÍTICO primeiro, depois 🟠 ALTO, 🟡 MÉDIO e ⚪ BAIXO (a ordem do array é a
  ordem na suite).
- `title`: `[CRÍTICO|ALTO|MÉDIO|BAIXO] Área — ação a validar (MR !NNN)`.
- `instructions` (Markdown, sem listas numeradas, porque os passos vão em `steps`):
  - **Contexto:** o que mudou, em linguagem simples, e o MR;
  - **Pré-condições:** ambiente (produção/staging), loja ou domínio quando há vários, tipo
    de utilizador, dados necessários (ex.: "uma conta de cliente com uma encomenda paga");
  - alertas de segurança (`⚠️ SEC-…`) ou operacionais (ex.: limpar uma cache após o deploy).
- `steps`: 3 a 8 ações concretas que uma pessoa executa na interface, com verbo no
  infinitivo ("Abrir…", "Adicionar…", "Confirmar…"). Sem código.
- `expectedResult`: o que deve ser observado se estiver tudo bem, de forma verificável
  (valores, mensagens, estados). Para testes de segurança, descrever o bloqueio esperado
  (ex.: "É apresentada a página 403/404 e nenhum dado da outra encomenda é mostrado").
- `assigneeEmail`: o email do passo 1, em todos os testes.
- Nunca incluir `status`, resultados, nem afirmar que algo já foi testado.

### 7. Guardar, pré-visualizar e confirmar

```bash
IDEM="pending-qa-${BASE_SHA:0:12}-${HEAD_SHA:0:12}"
OUT_DIR="${TMPDIR:-/tmp}/pending-qa-suite"
PAYLOAD="$OUT_DIR/$IDEM.json"
mkdir -p "$OUT_DIR"
```

- Se `$PAYLOAD` já existir (tentativa anterior do mesmo intervalo), perguntar se o
  utilizador quer **repetir a mesma publicação** (reutilizar o ficheiro e a chave, sendo
  seguro se a anterior chegou a ser criada) ou **criar uma suite nova** (gerar de novo e
  acrescentar `-$(date +%Y%m%d%H%M%S)` ao `IDEM`).
- Caso contrário, escrever o JSON gerado em `$PAYLOAD`.

Mostrar ao utilizador uma pré-visualização curta: título, responsável, número de testes
por nível e os títulos dos críticos. Com `--dry-run`, mostrar também o JSON e parar.
Sem `--yes`, pedir confirmação antes de publicar, porque a suite notifica todos os
membros do projeto.

### 8. Publicar

```bash
PROJECT="${PROJECT_OVERRIDE:-$TESTHUB_PROJECT_ID}"
case "$TESTHUB_URL" in
  https://*|http://localhost*|http://127.0.0.1*) ;;
  *) echo "TESTHUB_URL tem de usar HTTPS"; exit 1 ;;
esac
curl -sS -X POST "${TESTHUB_URL%/}/api/v1/projects/$PROJECT/suites" \
  -H "Authorization: Bearer $TESTHUB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM" \
  --data-binary @"$PAYLOAD" \
  -w '\nHTTP %{http_code}\n' --max-time 30
```

Interpretar a resposta:

| HTTP | Significado | Ação |
|---|---|---|
| 201 | Suite criada | Reportar (passo 9) |
| 200 | Repetição: a suite já existia com este conteúdo | Reportar como a suite existente |
| 400 | Dados inválidos ou responsável que não é membro | Mostrar `error`. Se for o email: pedir ao owner para adicionar a pessoa ao projeto, ou correr de novo com outro `--email`. Não retirar o responsável em silêncio. Um 400 por `assigneeEmail` desconhecido indica que o servidor DevBoard ainda não tem esta funcionalidade |
| 401 | Chave inválida ou revogada | Pedir para criar/configurar uma chave nova |
| 403 | A chave não pertence a este projeto | Verificar `TESTHUB_PROJECT_ID` |
| 409 | Mesma `Idempotency-Key` com conteúdo diferente | Perguntar se deve criar uma suite nova (novo `IDEM`, ver passo 7) |

### 9. Entregar o resultado

Da resposta JSON usar `id`, `number` e `title`. Responder com:
- link: `${TESTHUB_URL%/}/tabs/home/#project=$PROJECT&suite=<id>`;
- título, número de testes e responsável;
- a lista dos pontos críticos (os mesmos da descrição);
- o caminho de `$PAYLOAD`, para retries.

## O que esta skill não é

- Não executa testes nem regista resultados: os testes ficam Pendentes até alguém os
  validar no DevBoard.
- Não faz deploy, não mexe na tag `deploy-producao-last`, não escreve no repositório nem
  publica no Teams/GitLab. Só cria a suite no DevBoard, depois da confirmação.
- Não substitui os testes automáticos, o pipeline de CI nem as notas de release.
