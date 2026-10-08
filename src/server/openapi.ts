import { z } from "zod";
import {
  adminInput,
  projectInput,
  setupInput,
  suiteInput,
  suiteEditInput,
  testInput,
  commentInput,
  memberInput,
  memberRoleInput,
  memberBlockInput,
  keyInput,
  issueInput,
  issuePatchInput,
  issueArchiveInput,
  issueAssigneesInput,
  issueSelectionInput,
  suiteSelectionInput,
  issueStatusInput,
  issueTagInput,
  issueImportInput,
} from "../shared/contracts";

const schema = (value: z.ZodType) =>
  z.toJSONSchema(value, { target: "openapi-3.0" });
const paths: Record<string, Record<string, unknown>> = {};
function operation(
  path: string,
  method: string,
  summary: string,
  input?: z.ZodType,
  versioned = false,
  integration = false,
) {
  const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map(
    (match) => ({
      in: "path",
      name: match[1],
      required: true,
      schema: { type: "string", format: "uuid" },
    }),
  );
  if (versioned)
    parameters.push({
      in: "header",
      name: "If-Match",
      required: true,
      description: "Versão atual do recurso para controlo de concorrência.",
      schema: { type: "string", example: "1" },
    });
  if (integration)
    parameters.push({
      in: "header",
      name: "Idempotency-Key",
      required: false,
      description:
        "Obrigatório quando autenticado com uma chave de publicação. Mesma chave e conteúdo: devolve a suite original; conteúdo diferente: 409.",
      schema: { type: "string", maxLength: 200 },
    });
  const success =
    method === "delete"
      ? "204"
      : method === "post" &&
          !/archive|restore|result|revoke|assign-me|block/.test(path)
        ? "201"
        : "200";
  paths[path] = {
    ...paths[path],
    [method]: {
      summary,
      security: [{ bearerAuth: [] }],
      parameters,
      ...(input
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: schema(input) } },
            },
          }
        : {}),
      responses: {
        [success]: { description: "Operação concluída." },
        ...(integration
          ? { "200": { description: "Repetição de uma publicação existente." } }
          : {}),
        "400": {
          description: "Dados inválidos. Rejeição requer comentário não vazio.",
        },
        "401": { description: "Sessão/chave inválida ou expirada." },
        "403": { description: "Sem permissão." },
        "404": { description: "Recurso inexistente ou sem acesso." },
        "409": { description: "Conflito de versão, arquivo ou idempotência." },
        "428": { description: "Falta If-Match." },
        "503": { description: "Configuração ou serviço indisponível." },
      },
    },
  };
}
operation(
  "/me",
  "get",
  "Identidade atual, se é administrador e se o setup inicial está pendente",
);
operation(
  "/setup",
  "post",
  "Concluir o setup inicial com o código de setup; quem o conclui fica administrador master",
  setupInput,
);
operation("/admins", "get", "Administradores da aplicação (administrador)");
operation(
  "/admins",
  "post",
  "Tornar uma pessoa do diretório administradora (administrador)",
  adminInput,
);
operation(
  "/admins/{userId}",
  "delete",
  "Remover um administrador; o master não pode ser removido (administrador)",
);
operation(
  "/admins/directory",
  "get",
  "Pesquisar pessoas no diretório para as tornar administradoras (administrador)",
);
operation(
  "/projects",
  "get",
  "Projetos ativos do utilizador; os administradores veem todos",
);
operation(
  "/projects",
  "post",
  "Criar projeto (administrador; quem cria não fica membro)",
  projectInput,
);
operation(
  "/projects/{projectId}",
  "patch",
  "Editar projeto (proprietário)",
  projectInput,
  true,
);
operation(
  "/projects/{projectId}",
  "delete",
  "Apagar projeto logicamente, preservando o histórico (proprietário)",
  undefined,
  true,
);
operation("/projects/{projectId}/members", "get", "Membros do projeto");
operation(
  "/projects/{projectId}/summary",
  "get",
  "Contagens completas das suites ativas",
);
operation(
  "/projects/{projectId}/members",
  "post",
  "Adicionar membro ou alterar papel (proprietário)",
  memberInput,
);
operation(
  "/projects/{projectId}/members/{userId}",
  "delete",
  "Remover membro (mantém pelo menos um proprietário)",
);
operation(
  "/projects/{projectId}/directory",
  "get",
  "Pesquisar colegas e convidados existentes (proprietário)",
);
operation(
  "/projects/{projectId}/suites",
  "get",
  "Listar suites com contagens e progresso",
);
(
  paths["/projects/{projectId}/suites"].get as Record<string, any>
).parameters.push(
  ...[
    [
      "archive",
      {
        type: "string",
        enum: ["active", "archived", "all"],
        default: "active",
      },
    ],
    ["q", { type: "string" }],
    [
      "status",
      {
        type: "string",
        enum: ["pending", "approved", "revoked", "all"],
        default: "all",
      },
    ],
    ["assignee", { type: "string", description: "UUID do membro ou all" }],
    ["sort", { type: "string", enum: ["updated", "created", "title"] }],
    ["page", { type: "integer", minimum: 1 }],
    ["pageSize", { type: "integer", minimum: 1, maximum: 100 }],
  ].map(([name, value]) => ({ in: "query", name, schema: value })),
);
(
  paths["/projects/{projectId}/directory"].get as Record<string, any>
).parameters.push({
  in: "query",
  name: "q",
  required: true,
  schema: { type: "string", minLength: 2, maxLength: 100 },
});
operation(
  "/projects/{projectId}/suites",
  "post",
  "Criar suite com testes manuais pendentes (utilizador ou integração)",
  suiteInput,
  false,
  true,
);
operation("/suites/{suiteId}", "get", "Suite, testes e resumo derivado");
operation(
  "/suites/{suiteId}",
  "patch",
  "Editar título e descrição",
  suiteEditInput,
  true,
);
operation(
  "/suites/{suiteId}/activity",
  "get",
  "Comentários e histórico imutável",
);
(
  paths["/suites/{suiteId}/activity"].get as Record<string, any>
).parameters.push({
  in: "query",
  name: "testId",
  schema: { type: "string", format: "uuid" },
});
operation(
  "/suites/{suiteId}/duplicate",
  "post",
  "Duplicar como suite independente pendente",
);
for (const action of ["archive", "restore"])
  operation(
    `/suites/{suiteId}/${action}`,
    "post",
    `${action === "archive" ? "Arquivar" : "Restaurar"} suite (proprietário)`,
    undefined,
    true,
  );
operation(
  "/suites/{suiteId}/tests",
  "post",
  "Adicionar teste",
  testInput,
  true,
);
operation(
  "/tests/{testId}",
  "patch",
  "Editar, atribuir ou ordenar teste; mudanças das instruções/resultado esperado repõem pendente",
  testInput.extend({ position: z.number().int().min(0).max(10000).optional() }),
  true,
);
operation(
  "/tests/{testId}/result",
  "post",
  "Registar resultado manual; revoked significa Rejeitado",
  z.object({
    status: z.enum(["pending", "approved", "revoked"]),
    comment: z.string().trim().max(50000).optional(),
  }),
  true,
);
operation("/tests/{testId}/comments", "post", "Comentar teste", commentInput);
operation("/suites/{suiteId}/comments", "post", "Comentar suite", commentInput);
operation(
  "/projects/{projectId}/keys",
  "get",
  "Listar metadados de chaves (proprietário)",
);
operation(
  "/projects/{projectId}/keys",
  "post",
  "Criar chave; segredo apresentado uma única vez",
  keyInput,
);
operation(
  "/projects/{projectId}/keys/{keyId}/revoke",
  "post",
  "Revogar chave (proprietário)",
);
operation(
  "/projects/{projectId}/members/{userId}",
  "patch",
  "Mudar o papel de um membro: owner, member ou viewer (só leitura; remove atribuições ativas)",
  memberRoleInput,
);
operation(
  "/projects/{projectId}/members/{userId}/block",
  "post",
  "Bloquear temporariamente o acesso de um membro (proprietário; opcionalmente até uma data)",
  memberBlockInput,
);
operation(
  "/projects/{projectId}/members/{userId}/unblock",
  "post",
  "Desbloquear o acesso de um membro (proprietário)",
);
operation(
  "/projects/{projectId}/issue-config",
  "get",
  "Estados, módulos e labels do Desenvolvimento",
);
for (const [kind, label, input] of [
  ["statuses", "estado", issueStatusInput],
  ["modules", "módulo", issueTagInput],
  ["labels", "label", issueTagInput],
] as const) {
  operation(
    `/projects/{projectId}/issue-${kind}`,
    "post",
    `Criar ${label} (proprietário)`,
    input,
  );
  operation(
    `/issue-${kind}/{itemId}`,
    "patch",
    `Editar ou reordenar ${label} (proprietário)`,
    input,
    true,
  );
  operation(
    `/issue-${kind}/{itemId}`,
    "delete",
    `Apagar ${label} (proprietário)${kind === "statuses" ? "; com issues exige ?moveTo=estado" : ""}`,
    undefined,
    true,
  );
}
operation(
  "/projects/{projectId}/issues",
  "get",
  "Listar issues (tabela paginada ou view=board)",
);
(
  paths["/projects/{projectId}/issues"].get as Record<string, any>
).parameters.push(
  ...[
    ["archive", { type: "string", enum: ["active", "archived", "all"] }],
    ["view", { type: "string", enum: ["table", "board"] }],
    ["q", { type: "string", description: "Texto ou IS-n" }],
    ["status", { type: "string", description: "UUID, open ou all" }],
    ["module", { type: "string", description: "UUID ou all" }],
    ["label", { type: "string", description: "UUID ou all" }],
    ["assignee", { type: "string", description: "UUID, me, none ou all" }],
    ["reporter", { type: "string", description: "UUID ou all" }],
    [
      "priority",
      { type: "string", enum: ["all", "none", "1", "2", "3", "4", "5"] },
    ],
    [
      "sort",
      {
        type: "string",
        enum: ["reported", "updated", "created", "priority", "number", "title"],
      },
    ],
    ["page", { type: "integer", minimum: 1 }],
    ["pageSize", { type: "integer", minimum: 1, maximum: 100 }],
  ].map(([name, value]) => ({ in: "query", name, schema: value })),
);
operation(
  "/projects/{projectId}/issues",
  "post",
  "Criar issue; o reporter é sempre quem cria",
  issueInput,
);
operation("/issues/{issueId}", "get", "Obter issue");
operation(
  "/issues/{issueId}",
  "patch",
  "Editar issue, mudar de estado ou mover no board",
  issuePatchInput,
  true,
);
operation(
  "/issues/{issueId}",
  "delete",
  "Apagar issue (proprietário ou reporter)",
  undefined,
  true,
);
operation(
  "/issues/{issueId}/activity",
  "get",
  "Histórico e comentários do issue",
);
operation(
  "/issues/{issueId}/assignees",
  "put",
  "Definir os responsáveis do issue",
  issueAssigneesInput,
  true,
);
operation("/issues/{issueId}/assign-me", "post", "Atribuir-me o issue");
operation("/issues/{issueId}/assign-me", "delete", "Deixar de ser responsável");
operation("/issues/{issueId}/duplicate", "post", "Duplicar issue");
for (const action of ["archive", "restore"])
  operation(
    `/issues/{issueId}/${action}`,
    "post",
    `${action === "archive" ? "Arquivar" : "Restaurar"} issue (proprietário)`,
    undefined,
    true,
  );
operation(
  "/projects/{projectId}/issues/archive",
  "post",
  "Arquivar os issues selecionados ou, com statusIds, todos os ativos de estados concluídos (proprietário)",
  issueArchiveInput,
);
for (const [action, label] of [
  ["restore", "Restaurar"],
  ["delete", "Apagar logicamente"],
])
  operation(
    `/projects/{projectId}/issues/${action}`,
    "post",
    `${label} os issues selecionados; cada versão tem de coincidir (proprietário)`,
    issueSelectionInput,
  );
for (const [action, label] of [
  ["archive", "Arquivar"],
  ["restore", "Restaurar"],
  ["delete", "Apagar logicamente"],
])
  operation(
    `/projects/{projectId}/suites/${action}`,
    "post",
    `${label} as suites selecionadas; cada versão tem de coincidir (proprietário)`,
    suiteSelectionInput,
  );
operation("/issues/{issueId}/comments", "post", "Comentar issue", commentInput);
operation(
  "/projects/{projectId}/issues/import",
  "post",
  "Importar issues de uma folha de cálculo já associada (proprietário; Idempotency-Key obrigatório; sem notificações)",
  issueImportInput,
);
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "DevBoard — API de testes e desenvolvimento",
    version: "1.0.0",
    description:
      "API autenticada. Estados internos: pending=Pendente, approved=Aprovado, revoked=Rejeitado. Suites independentes; sem execução automática. Issues do Desenvolvimento com estados, módulos e labels por projeto. As chaves th_ apenas permitem POST /projects/{projectId}/suites.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Token Microsoft Entra ou chave de publicação th_.",
      },
    },
  },
  paths,
};
