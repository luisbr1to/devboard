import { test } from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import {
  buildImport,
  distinct,
  distinctModules,
  parseDay,
  splitModules,
  splitPeople,
  suggestColumns,
  suggestMember,
  suggestStatus,
  suggestTag,
  titleFrom,
  toSheet,
  type ImportDecisions,
} from "../src/Tab/importSheet";
import type { IssueConfig, Member } from "../src/shared/contracts";

// Excerpt of «Testes - Projeto Demo (Pós-Golive).csv», with fictitious people and data, including quoted multi-line cells.
const csv = `Id,Id original,Utilizador,Módulo,Sub-módulo,Informações/teste,Data,prioridade,Estado Teste User,Estado DSI,Data Deployed,Tipo,Estimativa DSI,Prioridade DSI+DM,User DSI,Obs DSI,Obs User
1,1,cmendes,frontend,perfil,é preciso colocar a data de nascimento não opcional quando edita dados via perfil,04-08-2024,,,Resolvido,4/8/2026,,,,irocha,"o campo não existe, é para acrescentar?","sim, por favor"
2,19,cmendes,backoffice,Pop-ups,"É preciso ter pop-ups 
- onde configurar?",2025-08-22,,,,,Melhoria,10.0,4,tferreira,"Popups que aparecem com periodicidade?",
18,427,cmendes,frontend,Newsletters,"
""Unsubscribe"" - quando se carrega no Unsubscribe",2025-12-31,,,Em curso,,,,2,irocha / tferreira,é necessario criar uma ponte,
20,438,cmendes,frontend,App,Landing page para a app móvel,2026-01-08,,,A aguardar informação,,Melhoria,3.0,2,irocha,Devo esperar pelo template?,"Esperar por template, pf"
112,,cmendes,frontend,artigo,Passar a mask de preço,2026-04-15,,,Aguarda Informação,,Melhoria,0.5,3,,colocado pr,
284,,cmendes,Norte — Frontend,Menu de topo (mega-menu),Replicar na loja Norte,2026-08-19,,,Resolvido,,Melhoria,,2,rlopes,Teste: no gestor,
137,,cmendes,site+app+eShop,,Acessibilidade do leitor de PDF,2026-04-15,,,,,Melhoria,5.0,2,,tempo estimado,
266,,tferreira,backoffice,relatórios,O Botão de exportar,2026-08-05,,,Para testar,,bug,,1,rlopes,,
103,,cmendes,frontend,artigos,Esgotados com data de reposição,2026-04-15,,,TBR,,Melhoria,3.0,1,rlopes,colocado pr,
,,,,,,,,,,,,,,,,
`;
const sheet = toSheet(
  Papa.parse<string[]>(csv, { skipEmptyLines: "greedy" }).data,
);
const members: Member[] = [
  {
    id: "u-ines",
    oid: "",
    tenantId: "",
    name: "Inês Rocha",
    email: "ines.rocha@exemplo.pt",
    role: "owner",
  },
  {
    id: "u-tomas",
    oid: "",
    tenantId: "",
    name: "Tomás Ferreira",
    email: "tomas.ferreira@cliente.example",
    role: "member",
  },
  {
    id: "u-carla",
    oid: "",
    tenantId: "",
    name: "Carla Mendes",
    email: "cmendes@cliente.example",
    role: "member",
  },
];
const config: IssueConfig = {
  statuses: [
    ["s-backlog", "Backlog", "todo"],
    ["s-wait", "A aguardar informação", "todo"],
    ["s-doing", "Em curso", "doing"],
    ["s-test", "Para testar", "doing"],
    ["s-done", "Resolvido", "done"],
  ].map(([id, name, category], position) => ({
    id,
    name,
    category,
    position,
    projectId: "p",
    color: "gray",
    version: 1,
  })) as IssueConfig["statuses"],
  modules: [
    {
      id: "m-front",
      name: "Frontend",
      projectId: "p",
      color: "blue",
      position: 0,
      version: 1,
    },
  ],
  labels: [],
};

test("import: columns of a real-world test sheet are recognised", () => {
  assert.equal(sheet.rows.length, 9);
  const mapping = suggestColumns(sheet.headers);
  const header = (index: number) => sheet.headers[index];
  assert.equal(mapping.title, -1);
  assert.equal(header(mapping.description), "Informações/teste");
  assert.equal(header(mapping.externalRef), "Id");
  assert.equal(header(mapping.reporter), "Utilizador");
  assert.equal(header(mapping.assignees), "User DSI");
  assert.equal(header(mapping.status), "Estado DSI");
  assert.equal(header(mapping.modules), "Módulo");
  assert.equal(header(mapping.submodules), "Sub-módulo");
  assert.equal(header(mapping.labels), "Tipo");
  assert.equal(header(mapping.priority), "Prioridade DSI+DM");
  assert.equal(header(mapping.estimate), "Estimativa DSI");
  assert.equal(header(mapping.reportedAt), "Data");
  assert.equal(header(mapping.deployedAt), "Data Deployed");
  assert.deepEqual(mapping.comments.map(header), ["Obs DSI", "Obs User"]);
});

test("import: values are split, grouped and matched", () => {
  assert.deepEqual(splitPeople("irocha / tferreira"), ["irocha", "tferreira"]);
  assert.deepEqual(splitModules("frontend - mobile"), ["frontend", "mobile"]);
  assert.deepEqual(splitModules("Norte — Frontend"), ["Norte", "Frontend"]);
  assert.deepEqual(splitModules("site+app+eShop"), ["site", "app", "eShop"]);
  assert.deepEqual(splitModules("Menu frontend"), ["Menu frontend"]);
  assert.equal(suggestMember("irocha", members), "u-ines");
  assert.equal(suggestMember("tferreira", members), "u-tomas");
  assert.equal(suggestMember("cmendes", members), "u-carla");
  assert.equal(suggestMember("rlopes", members), "");
  const labels = distinct(sheet, suggestColumns(sheet.headers).labels);
  assert.deepEqual([...labels.keys()], ["melhoria", "bug"]);
  assert.deepEqual(suggestStatus("Aguarda Informação", config), {
    kind: "existing",
    id: "s-wait",
  });
  assert.deepEqual(suggestStatus("Em Curso", config), {
    kind: "existing",
    id: "s-doing",
  });
  assert.deepEqual(suggestStatus("TBR", config), {
    kind: "existing",
    id: "s-test",
  });
  assert.deepEqual(suggestStatus("Fechado Auto", config), {
    kind: "create",
    name: "Fechado Auto",
    category: "done",
  });
  assert.deepEqual(suggestTag("frontend", config.modules), {
    kind: "existing",
    id: "m-front",
  });
  assert.equal(parseDay("04-08-2024"), "2024-08-04");
  assert.equal(parseDay("4/8/2026"), "2026-08-04");
  assert.equal(parseDay("2025-08-22"), "2025-08-22");
  assert.equal(parseDay("31-02-2026"), null);
  assert.equal(
    titleFrom('\n"Unsubscribe" - quando se carrega'),
    '"Unsubscribe" - quando se carrega',
  );
  assert.ok(titleFrom("palavra ".repeat(40)).length <= 120);
});

test("import: payload follows the associations and skips empty rows", () => {
  const mapping = suggestColumns(sheet.headers);
  const decisions: ImportDecisions = {
    people: {},
    statuses: {},
    modules: {},
    labels: {},
  };
  const values = {
    people: distinct(sheet, mapping.assignees, splitPeople),
    reporters: distinct(sheet, mapping.reporter),
  };
  for (const [key, { name }] of [...values.people, ...values.reporters])
    decisions.people[key] = suggestMember(name, members);
  for (const [key, { name }] of distinct(sheet, mapping.status))
    decisions.statuses[key] = suggestStatus(name, config);
  for (const [key, { name }] of distinctModules(sheet, mapping))
    decisions.modules[key] = suggestTag(name, config.modules);
  for (const [key, { name }] of distinct(sheet, mapping.labels))
    decisions.labels[key] = suggestTag(name, config.labels);
  const { payload, skipped } = buildImport(
    sheet,
    mapping,
    decisions,
    "projeto-demo.csv",
  );
  assert.equal(skipped, 0);
  assert.equal(payload.rows.length, 9);
  assert.deepEqual(
    payload.newLabels.map((item) => item.name),
    ["Melhoria", "Bug"],
  );
  assert.deepEqual(
    payload.newModules.map((item) => item.name),
    [
      "Backoffice",
      "Norte",
      "Site",
      "App",
      "eShop",
      "Perfil",
      "Pop-ups",
      "Newsletters",
      "Artigo",
      "Menu de topo (mega-menu)",
      "Relatórios",
      "Artigos",
    ],
  );
  const [first, second, third] = payload.rows;
  assert.deepEqual(
    { ...first, comments: first.comments.length },
    {
      externalRef: "1",
      title:
        "é preciso colocar a data de nascimento não opcional quando edita dados via perfil",
      description:
        "é preciso colocar a data de nascimento não opcional quando edita dados via perfil",
      status: "s-done",
      priority: null,
      estimate: null,
      reportedAt: "2024-08-04T12:00:00.000Z",
      deployedAt: "2026-08-04",
      reporterId: "u-carla",
      reporterNote: null,
      assigneeIds: ["u-ines"],
      modules: ["m-front", "perfil"],
      labels: [],
      comments: 2,
    },
  );
  assert.equal(
    first.comments[0],
    "**Obs DSI** (importado)\n\no campo não existe, é para acrescentar?",
  );
  assert.equal(second.title, "É preciso ter pop-ups");
  assert.equal(second.status, null);
  assert.equal(second.priority, 4);
  assert.equal(second.estimate, 10);
  assert.deepEqual(second.labels, ["melhoria"]);
  assert.deepEqual(third.assigneeIds, ["u-ines", "u-tomas"]);
  // People without an association are not assigned.
  const unmatched = payload.rows.find((row) => row.externalRef === "284")!;
  assert.deepEqual(unmatched.assigneeIds, []);
  assert.deepEqual(unmatched.modules, [
    "norte",
    "m-front",
    "menu de topo (mega-menu)",
  ]);
  // A row without a submodule keeps only its modules.
  const noSubmodule = payload.rows.find((row) => row.externalRef === "137")!;
  assert.deepEqual(noSubmodule.modules, ["site", "app", "eshop"]);
});
