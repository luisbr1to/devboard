import type {
  Project,
  Member,
  Suite,
  TestCase,
} from "../../src/shared/contracts";
import { summarize } from "../../src/shared/contracts";
export const project: Project = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Plataforma de produto",
  description: "Projeto de QA",
  createdAt: "2026-10-02T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  icon: null,
  version: 1,
  role: "owner",
};
export const members: Member[] = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    oid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    tenantId: project.id,
    name: "Ana Silva",
    email: "ana@example.test",
    role: "owner",
  },
];
export function fixtures(): Suite[] {
  return [
    "Checkout — pagamentos",
    "Registo de utilizador",
    "Recuperação de palavra-passe",
  ].map((title, index) => {
    const suiteId = `00000000-0000-4000-8000-00000000000${index + 1}`;
    const tests: TestCase[] = [
      {
        id: `10000000-0000-4000-8000-00000000000${index + 1}`,
        suiteId,
        number: 1,
        title: "Validar fluxo principal",
        instructions: "",
        steps: ["Abrir a aplicação.", "Confirmar a operação."].map(
          (body, position) => ({
            id: `30000000-0000-4000-8000-00000000${index + 1}00${position}`,
            position,
            body,
            status: "pending" as const,
            updatedByName: null,
            updatedAt: null,
            version: 1,
          }),
        ),
        testers: [],
        expectedResult: "A operação é confirmada sem erros.",
        assigneeId: members[0].id,
        priority: index === 0 ? 1 : null,
        status: index === 0 ? "pending" : index === 1 ? "approved" : "revoked",
        position: 0,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        version: 1,
      },
    ];
    return {
      id: suiteId,
      projectId: project.id,
      number: index + 1,
      title,
      description:
        "## Objetivo\nValidar o comportamento da aplicação em staging.\n\n<script>window.untrusted = true</script>\n[Não seguro](javascript:alert(1))",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      createdBy: "Ana Silva",
      archivedAt: null,
      archivedBy: null,
      version: 1,
      provenance: null,
      tests,
      ...summarize(tests.map((test) => test.status)),
    };
  });
}
