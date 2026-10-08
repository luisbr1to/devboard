# DevBoard — roadmap

## Piloto partilhado

| Marco                      | Entrega                                                                                        | Estado                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| M1 — Fundação e identidade | PostgreSQL, migrações, login local, JWT Entra, SSO e fallback MSAL                             | Local validado; aceitação no tenant pendente  |
| M2 — Projetos e suites     | Membros, suites independentes, lista, TipTap/Markdown, ícones, atribuição e eliminação lógica  | Implementado; validado localmente             |
| M3 — Revisão manual        | Barra de progresso por estado, filtros/reordenação e atividade por teste em timeline           | Implementado; validado localmente             |
| M4 — Arquivo de suites     | Arquivar suites, vista Arquivadas, restauro e leitura protegida                                | Implementado; validado localmente             |
| M5 — Publicação por IA     | API JSON, chaves por projeto, idempotência, exemplo/script, OpenAPI                            | Implementado; validado localmente             |
| M6 — Aceitação do piloto   | Teams web/desktop, convidados, Graph e acessibilidade                                          | Acessibilidade local validada; Teams pendente |
| M7 — Colaboração           | Números SU/TC estáveis, passos partilhados, testers, anexos, @menções, notificações e pesquisa | Implementado; validado localmente             |
| M8 — Feed de atividade     | Notificações Teams via Graph com deep link para o teste e comentário                           | Implementado; validação no tenant pendente    |
| M9 — Desenvolvimento       | Issues com tabela/board, estados/módulos/labels por projeto, reporter fixo e vários responsáveis | Implementado; validado localmente             |
| M10 — Importação de issues | Assistente .xlsx/.csv com associação de pessoas e valores, idempotente e sem notificações      | Implementado; validado localmente             |

## Sequência de ativação

Para desenvolvimento local: iniciar a base PostgreSQL do projeto com `npm run db:up` → aplicar migrações → usar `AUTH_MODE=local` → iniciar a aplicação → validar o fluxo completo e a acessibilidade. Esta fase local está automatizada também por `npm run test:e2e`, usando a base isolada `testhub_e2e`. Como último passo, para validar no Teams: registar/configurar Entra → preencher ambiente e manifesto → usar `AUTH_MODE=microsoft` → validar sign-in, Graph e acesso de convidados → disponibilizar pelo processo existente. Uma implantação alojada deve configurar e validar separadamente o seu PostgreSQL.

## Possíveis evoluções (fora do piloto)

Exportação Markdown/CSV, geração de IA dentro da aplicação, sincronização de membros de uma equipa Teams, pesquisa/paginação SQL para grandes volumes e métricas históricas. Não constituem funcionalidades já entregues nem compromissos de implementação.
