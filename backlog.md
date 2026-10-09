# DevBoard — backlog

O trabalho operacional é gerido com a CLI Backlog.md nos ficheiros de [`backlog/tasks`](backlog/tasks). Este documento mantém apenas o resumo dos requisitos e do estado de aceitação do produto.

Estados: **Implementado** = código entregue; **Validado localmente** = verificações automatizadas concluídas; **Pendente externo** = requer serviços/configuração reais. A aceitação do piloto não é inferida a partir de testes locais.

## Requisitos do piloto

| ID     | Prioridade | Dependências   | Estado                           | Critério de aceitação                                                                            |
| ------ | ---------- | -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| TH-001 | P0         | —              | Implementado                     | Esquema PostgreSQL e migração explícita, dados preservados após reinício                         |
| TH-002 | P0         | TH-001         | Implementado                     | Validar JWT; acesso limitado aos membros; owner/member; convidados existentes                    |
| TH-003 | P0         | TH-002         | Implementado                     | Criar/editar/apagar logicamente projetos, imagem 48 px e membros; proteger o último proprietário |
| TH-004 | P0         | TH-003         | Implementado                     | Criar/editar/duplicar suites independentes; lista clicável, pesquisa e filtros                   |
| TH-005 | P0         | TH-004         | Implementado                     | TipTap/Markdown seguro com formatação, checklists e tabelas                                      |
| TH-006 | P0         | TH-004         | Implementado                     | Qualquer membro regista resultado; rejeição exige motivo; progresso conta revisões               |
| TH-007 | P0         | TH-006         | Implementado                     | Timeline atribuída e imutável; alterações materiais repõem pendente                              |
| TH-008 | P0         | TH-004, TH-007 | Implementado                     | Arquivar/consultar Arquivadas/restaurar; impedir escrita e preservar resultados                  |
| TH-009 | P0         | TH-002, TH-004 | Implementado                     | Chaves com hash e âmbito de projeto; publicação atómica pendente e retries seguros               |
| TH-010 | P1         | TH-009         | Implementado                     | OpenAPI, JSON de exemplo e script de publicação utilizáveis                                      |
| TH-011 | P1         | TH-004         | Implementado                     | PT-PT, temas, avatares, tabelas responsivas e painéis laterais com cabeçalho fixo                |
| TH-012 | P0         | TH-001–TH-011  | Validado localmente              | Typecheck/build e testes de regras, permissões, arquivo, concorrência e idempotência             |
| TH-013 | P0         | TH-012         | Validado localmente              | Usar Docker PostgreSQL como base do projeto; migrações, persistência e runtime validados         |
| TH-014 | P0         | TH-012         | Pendente externo                 | Validar SSO, fallback, consentimento Graph e membro/convidado em Teams web/desktop               |
| TH-015 | P1         | TH-014         | Local validado; externo pendente | Rever teclado, temas, tamanhos e fluxo completo com a equipa piloto                              |
| TH-016 | P1         | TH-007         | Validado localmente              | Números SU/TC estáveis, passos partilhados, testers, anexos, @menções, notificações e pesquisa   |
| TH-017 | P1         | TH-014, TH-016 | Implementado; tenant pendente    | Notificações no feed de atividade do Teams (Graph, OBO) com deep link para o teste/comentário    |
| TH-018 | P0         | TH-003         | Validado localmente              | Renomear para DevBoard sem alterar identificadores técnicos (base, variáveis, chaves)            |
| TH-019 | P0         | TH-016         | Validado localmente              | Issues IS-n com tabela e board, reporter imutável, vários responsáveis e autoatribuição          |
| TH-020 | P1         | TH-019         | Validado localmente              | Estados, módulos e labels por projeto nas Definições; colunas da tabela por utilizador           |
| TH-021 | P1         | TH-019         | Validado localmente              | Importar .xlsx/.csv com associação de pessoas/valores, observações como comentários, sem avisos  |
| TH-022 | P1         | TH-017, TH-019 | Implementado; tenant pendente    | Notificações de issues no feed do Teams e deep link `view=dev&issue=`                            |
| TH-023 | P1         | TH-003         | Validado localmente              | Leitores só de leitura e bloqueio temporário de membros; pesquisa e filtro na tabela de membros |

## Evoluções possíveis

| ID      | Prioridade | Dependências | Estado       | Critério proposto                                       |
| ------- | ---------- | ------------ | ------------ | ------------------------------------------------------- |
| FUT-003 | P2         | TH-004       | Não planeado | Exportar suites em Markdown/CSV                         |
| FUT-004 | P2         | TH-009       | Não planeado | Geração de suites por IA dentro da aplicação            |
| FUT-005 | P2         | TH-003       | Não planeado | Sincronizar acesso com membros de uma equipa Teams      |
| FUT-006 | P2         | TH-004       | Não planeado | Pesquisa/paginação agregada em SQL para grandes volumes |

## Verificação local

Em 2 de outubro de 2026: `typecheck`, build de produção, 21 testes de API/runtime, 6 testes rápidos Playwright e 1 cenário end-to-end Playwright concluídos. O cenário end-to-end recompila o servidor, recria a base Docker isolada `testhub_e2e`, aplica as migrações e valida login local, projeto, membro, chave de integração, publicação, rejeição com motivo e autoria, arquivo, restauro e layout a 390 px. PostgreSQL 16 foi iniciado via Docker Compose; as migrações `001_initial.sql` e `002_project_activity.sql` foram aplicadas; o contentor foi removido e recriado sem remover o volume; a segunda migração foi idempotente; `/health` devolveu `{"status":"ready"}`. A autenticação local foi validada com sessões opacas, identidades controladas pelo servidor, diretório local, isolamento por membro, atribuição, revogação, deteção de adulteração e recusa em produção. Os testes API continuam a usar PGlite; a base normal `testhub` não é alterada pelo end-to-end. Os testes locais não substituem a aceitação final no Teams.

Em 4 de outubro de 2026: `typecheck`, build de produção, 22 testes de API/runtime, 6 testes rápidos Playwright e o cenário end-to-end Docker concluídos após a revisão de navegação e design. Foram validados lista e linhas clicáveis, ausência do quadro, arquivo/restauro de suites, painel lateral de testes, rejeição com motivo em TipTap, permissões, tema escuro, layout móvel, conflitos de versão, teclado e login local. A migração aditiva `003_project_icons_and_soft_delete.sql`, ícones até 48 × 48 px e a eliminação lógica versionada de projetos foram cobertos por PGlite; o end-to-end recriou apenas a base isolada `testhub_e2e` e aplicou todas as migrações. Os serviços Entra/Teams não foram testados nesta revisão.

Em 5 de outubro de 2026: `typecheck`, build de produção, 22 testes de API/runtime e 6 testes rápidos Playwright concluídos após a atualização da página da suite. Foram validados cartões de resumo, paginação local de 10 testes, comentários/histórico num cartão próprio, compositor compacto, checklists e novas opções TipTap e painéis laterais com cabeçalho fixo durante o scroll. Não foi repetido o cenário end-to-end Docker porque esta revisão não alterou API, persistência ou autenticação.

Em 6 de outubro de 2026: `typecheck`, build de produção, 22 testes de API/runtime e 6 testes rápidos Playwright concluídos após a simplificação visual. Foram validados o novo título e rótulos da lista, remoção das descrições na tabela, donuts tricolores com separadores em desktop/móvel e temas claro/escuro, cartões compactos, pesquisa/filtros de testes, reordenação por drag-and-drop com fallback no menu, aprovação e reposição pendente diretas, rejeição com motivo, atividade limitada ao teste, sequência do painel, compositor TipTap sem invólucro ou texto redundante, timeline em cartões e diálogos direitos de altura total. Não foi repetido o cenário end-to-end Docker porque não houve alterações à API, persistência ou autenticação.

Em 6 de outubro de 2026 (redesign visual): `typecheck`, build de produção, 22 testes de API/runtime, 6 testes rápidos Playwright e o cenário end-to-end Docker concluídos. Foram validados tokens claro/escuro/contraste, aplicação do tema antes da pintura, sidebar com seletor de projeto, breadcrumb, separadores Ativas/Arquivadas, filtros compactos em menu, identificadores SU/TC, barra de progresso segmentada no lugar dos donuts, menus de ações por linha com retorno de foco, painel do teste com passos e marcações locais, navegação anterior/seguinte, rodapé de resultado com `aria-pressed`, compositor com barra mínima e ausência de scroll horizontal a 390 px. Os pares de cor dos tokens cumprem AA (mínimo 4,67:1). Sem alterações à API, persistência ou autenticação.

Em 6 de outubro de 2026 (colaboração): `typecheck`, build de produção, 27 testes de API/runtime, 8 testes rápidos Playwright e o cenário end-to-end Docker concluídos. As migrações aditivas `004_stable_numbers.sql` a `007_notifications.sql` foram aplicadas no PostgreSQL 16 da base isolada `testhub_e2e` e numa cópia temporária da base de desenvolvimento (removida depois), confirmando a conversão das listas existentes em passos. Foram cobertos: números estáveis ao reordenar e duplicar, passos com versão, autoria e reposição por edição, testers, menções restritas a membros, regras de destinatários das notificações e leitura, anexos validados por extensão e conteúdo e privados até publicação, pesquisa limitada aos projetos do utilizador, seletor `@`, anexo pelo compositor, centro de notificações com âncora no comentário, pesquisa Ctrl+K e menu de projetos com a largura do seletor.

Em 6 de outubro de 2026 (eliminação e notificações de alterações): `typecheck`, build, 29 testes de API/runtime, 9 testes rápidos Playwright e o cenário end-to-end Docker concluídos. A migração `008_soft_delete_and_change_notifications.sql` foi aplicada na base de desenvolvimento, onde `npm run seed:demo` criou o projeto «Loja Online · Demo». A adição de membros foi verificada na aplicação local (pesquisa no diretório e adicionar/atualizar um convidado) e pelos testes; a pesquisa de convidados reais no diretório Microsoft 365 continua por validar no tenant.

Em 6 de outubro de 2026 (feed de atividade do Teams): `typecheck`, 31 testes de API/runtime (incluindo envio após commit, em nome do autor, como aplicação para chaves de integração, deep links e coerência entre manifesto e servidor) e testes Playwright concluídos. O envio real para o Graph e a abertura por deep link no Teams não foram testados: exigem o tenant, a permissão `TeamsActivity.Send` e a app instalada.

## Verificação externa

Em 7 de outubro de 2026 (responsável por email na publicação): `typecheck`, build de produção e 31 testes de API/runtime concluídos. A publicação de suites aceita `assigneeEmail` por teste, resolvido no servidor para um membro do projeto; email de não membro e `assigneeId` com `assigneeEmail` em simultâneo devolvem 400. Foi verificado que uma suite publicada por chave com vários testes atribuídos gera só a notificação «nova suite» (uma por membro, na app e no feed Teams), e que adicionar um teste a uma suite existente notifica o responsável. Foi adicionada a skill `integrations/skills/pending-qa-suite`. A skill ainda não foi executada contra um TestHub real nem contra o repositório da aplicação a libertar.

Em 7 de outubro de 2026 (DevBoard e Desenvolvimento): `typecheck`, build de produção, 39 testes de API/runtime (8 novos de issues: estados predefinidos, reporter imutável, módulos/labels, atribuição e autoatribuição, movimentos no board, configuração de estados, duplicar/apagar/comentários/notificações, anexos por issue, importação atómica/idempotente/silenciosa e preferências), 3 testes unitários da leitura da folha «Testes - Projeto Demo», 9 testes rápidos Playwright e 2 cenários end-to-end Docker concluídos. O segundo cenário end-to-end cria um issue, atribui-se, muda o estado, move no board, importa um CSV e confirma o layout a 390 px. A migração aditiva `009_issues.sql` foi aplicada na base isolada `testhub_e2e`. Nesta máquina (WSL arm64) o Chromium do Playwright precisou da biblioteca `libasound.so.2`, carregada a partir de um pacote extraído localmente via `LD_LIBRARY_PATH`. O feed do Teams e o deep link dos issues não foram testados num tenant. A migração 009 ainda não foi aplicada à base de desenvolvimento `testhub`; corra `npm run db:migrate` quando quiser.

Em 7 de outubro de 2026 (acesso de membros): 45 testes de API/runtime (incluindo leitores sem escrita nem atribuições, bloqueios com e sem data, notificações e pesquisa ocultas durante o bloqueio), 9 testes Playwright e 2 cenários end-to-end concluídos. A migração `010_member_access.sql` foi aplicada na base isolada `testhub_e2e`; aplique-a à base de desenvolvimento com `npm run db:migrate`.

Em 8 de outubro de 2026 (filtro de estado múltiplo): `typecheck`, build de produção e 46 testes de API/runtime concluídos. O filtro Estado das tabelas de issues, suites e testes aceita vários valores (ex.: Backlog e Em curso), combinados com «ou»; a API recebe `status` separado por vírgulas e mantém `all` e valores únicos. Os testes rápidos Playwright foram atualizados mas não correram neste ambiente (o Chromium não arranca por falta de `libasound.so.2`).

Em 8 de outubro de 2026 (arquivo de issues em lote): `typecheck`, build do frontend, 47 testes de API/runtime concluídos. Novos `POST /projects/{projectId}/issues/archive` (proprietário; `statusIds` só de estados concluídos; regista a regra no histórico) e `POST /projects/{projectId}/issues/restore` (proprietário; lista de `{ id, version }`, recusada por inteiro com 409 se alguma versão estiver desatualizada; ignora issues já ativos). Em Arquivados, os proprietários têm «Arquivar por regra» e seleção com «Restaurar selecionados». O menu «…» do painel do issue passou a abrir dentro do `<dialog>`, acima dos campos. 11 testes rápidos Playwright concluídos, 2 deles novos: o menu dentro de diálogos e o restauro em lote e arquivo por regra. O Chromium correu com `libasound.so.2` extraída localmente via `LD_LIBRARY_PATH`.

Em 8 de outubro de 2026 (administradores e setup inicial): `typecheck`, build, 49 testes de API/runtime (2 novos: setup com código e administradores), 12 testes rápidos Playwright (1 novo: setup e página Administração) e os 2 cenários end-to-end Docker concluídos. A migração aditiva `011_app_admins.sql` foi aplicada na base isolada `testhub_e2e`; ainda não foi aplicada à base de desenvolvimento `testhub` (corra `npm run db:migrate` e depois conclua o setup). Só administradores criam projetos; quem cria não fica membro. O `seed:demo` foi adaptado mas não correu nesta revisão.

Em 8 de outubro de 2026 (ações em lote): `typecheck`, 51 testes de API/runtime (2 novos: lote de issues e de suites), 13 testes rápidos Playwright (1 novo de suites) e os 2 cenários end-to-end Docker concluídos. Novos `POST /projects/{projectId}/issues/delete`, `/suites/archive`, `/suites/restore` e `/suites/delete`; `/issues/archive` aceita também uma seleção. Os proprietários e administradores selecionam issues (Ativos e Arquivados) e suites para arquivar, restaurar ou apagar; a eliminação individual continua limitada ao reporter ou a proprietários. O teste de runtime do servidor compilado falhou uma vez por timeout de arranque ao correr em paralelo e passou ao repetir.

Em 8 de outubro de 2026 (colunas do board): `typecheck`, 52 testes de API/runtime (1 novo: disposição do board por pessoa e projeto), 14 testes rápidos Playwright (1 novo: ocultar, reordenar por arrastar e teclado, persistência e repor) e os 2 cenários end-to-end Docker concluídos. A preferência `issues.board.<projectId>` guarda `{ order, hidden }` e só é aceite para projetos a que a pessoa tem acesso.

Em 9 de outubro de 2026 (prioridade dos testes): `typecheck`, 54 testes de API/runtime (1 novo: prioridade opcional na publicação por chave, mantida quando omitida numa edição, sem repor o resultado, copiada ao duplicar e recusada fora de 1–5) e 14 testes rápidos Playwright (o de testes de suite verifica a coluna Prioridade antes do Estado). A tabela de testes passa a cartões abaixo de 760 px de largura do contentor, para caber a nova coluna. A migração aditiva `012_test_priority.sql` foi aplicada à base de desenvolvimento `testhub`; os cenários end-to-end Docker não correram nesta revisão.

Não foram fornecidas credenciais Entra para a aceitação real. Não foram criados recursos cloud nem publicados pacotes Teams. Uma eventual implantação alojada terá de fornecer o seu próprio PostgreSQL e validar as migrações nesse ambiente. Atualizar este registo com os resultados efetivamente obtidos.

## Trabalho de desenvolvimento local

Usar esta secção para registar trabalho ativo e a evidência de conclusão, sem confundir validação local com aceitação externa.

| ID      | Prioridade | Estado              | Entrega / evidência esperada                                                      |
| ------- | ---------- | ------------------- | --------------------------------------------------------------------------------- |
| DEV-001 | P0         | Validado localmente | PostgreSQL 16 via Docker Compose, `.env` local ignorado, migrações e persistência |
| DEV-002 | P0         | Validado localmente | `typecheck`, build, 22 API/runtime, 6 UI e 1 end-to-end Docker concluídos         |
| DEV-003 | P0         | Pendente externo    | Validar Entra/Teams, Graph OBO e convidados com configuração real                 |
| DEV-004 | P0         | Validado localmente | Login local, troca de utilizador, diretório e proteção contra uso em produção     |
| DEV-005 | P1         | Validado localmente | Teclado, temas claro/escuro/contraste, PT-PT e layouts desktop/móvel revistos     |
