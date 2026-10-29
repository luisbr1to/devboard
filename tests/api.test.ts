import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import { createApi } from "../src/server/api";
import { activityTypes } from "../src/server/teams";
import {
  HttpError,
  localAuthentication,
  localDirectory,
  type Authentication,
} from "../src/server/auth";
import type { Database } from "../src/server/db";
import { summarize, resultInput, statusLabels } from "../src/shared/contracts";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const identities = {
  owner: {
    oid: "11111111-1111-4111-8111-111111111111",
    name: "Ana Silva",
    email: "ana@example.test",
  },
  member: {
    oid: "22222222-2222-4222-8222-222222222222",
    name: "João Costa",
    email: "joao@example.test",
  },
  guest: {
    oid: "33333333-3333-4333-8333-333333333333",
    name: "Convidada",
    email: "guest@example.test",
  },
  outsider: {
    oid: "44444444-4444-4444-8444-444444444444",
    name: "Sem acesso",
    email: "outsider@example.test",
  },
  admin: {
    oid: "55555555-5555-4555-8555-555555555555",
    name: "Administradora",
    email: "admin@example.test",
  },
};
const setupCode = "codigo-de-setup-dos-testes";
const authentication: Authentication = {
  mode: "microsoft",
  async authenticate(token) {
    if (!(token in identities)) throw new HttpError(401, "Token inválido.");
    return { ...identities[token as keyof typeof identities], tenantId, token };
  },
  async search(token) {
    if (token === "guest")
      throw new HttpError(403, "Convidados não podem listar o diretório.");
    return Object.values(identities);
  },
  async person(_token, oid) {
    const person = Object.values(identities).find(
      (person) => person.oid === oid,
    );
    if (!person) throw new HttpError(404, "Identidade inexistente.");
    return person;
  },
};
let engine: PGlite;
let databaseDirectory: string;
let queued: Promise<void> = Promise.resolve();
const db: Database = {
  async connect() {
    const previous = queued;
    let unlock!: () => void;
    queued = new Promise((resolve) => {
      unlock = resolve;
    });
    await previous;
    return {
      async query<R extends QueryResultRow = QueryResultRow>(
        sql: string,
        values?: unknown[],
      ) {
        const result = await engine.query<R>(sql, values);
        return {
          rows: result.rows,
          rowCount: result.affectedRows ?? result.rows.length,
        };
      },
      release: unlock,
    };
  },
  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ) {
    const client = await this.connect();
    try {
      return await client.query<R>(sql, values);
    } finally {
      client.release();
    }
  },
};
const app = express();
app.use("/api/v1", createApi(db, authentication, { setupCode }));
const localAuthenticator = localAuthentication();
const localApp = express();
localApp.use("/api/v1", createApi(db, localAuthenticator, { setupCode }));
const call = (
  method: "get" | "post" | "patch" | "put" | "delete",
  path: string,
  token = "owner",
  body?: object,
  version?: number,
) => {
  let req = request(app)
    [method](`/api/v1${path}`)
    .set("Authorization", `Bearer ${token}`);
  if (version !== undefined) req = req.set("If-Match", String(version));
  if (body !== undefined) req = req.send(body);
  return req;
};
/** Administrators create projects; `owner` then joins as the project's owner. */
async function createProject(body: object) {
  const project = (await call("post", "/projects", "admin", body).expect(201))
    .body;
  await call("post", `/projects/${project.id}/members`, "admin", {
    oid: identities.owner.oid,
    role: "owner",
  }).expect(201);
  return project;
}
async function fixture() {
  const project = await createProject({
    name: "Checkout",
    description: "# Projeto",
  });
  await call("post", `/projects/${project.id}/members`, "owner", {
    oid: identities.member.oid,
  }).expect(201);
  await call("post", `/projects/${project.id}/members`, "owner", {
    oid: identities.guest.oid,
  }).expect(201);
  const members = (await call("get", `/projects/${project.id}/members`)).body;
  const memberId = members.find(
    (member: any) => member.oid === identities.member.oid,
  ).id;
  const suite = (
    await call("post", `/projects/${project.id}/suites`, "owner", {
      title: "Pagamentos",
      description: "**Revisão manual**",
      tests: [
        {
          title: "Cartão",
          instructions: "1. Abrir checkout",
          expectedResult: "Pagamento confirmado",
          assigneeId: memberId,
        },
        {
          title: "Email",
          instructions: "Verificar caixa de entrada",
          expectedResult: "Email recebido",
        },
      ],
    }).expect(201)
  ).body;
  return { project, suite, members, memberId };
}
before(async () => {
  databaseDirectory = await mkdtemp(join(tmpdir(), "testhub-persistence-"));
  engine = new PGlite(databaseDirectory);
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await engine.exec(await readFile(`migrations/${name}`, "utf8"));
});
beforeEach(async () => {
  await engine.exec(
    "TRUNCATE personal_attachments,issue_drafts,notes,note_folders,app_admins,user_preferences,issue_imports,issue_assignees,issue_module_links,issue_label_links,notifications,attachments,issues,issue_statuses,issue_modules,issue_labels,test_steps,import_requests,integration_keys,activities,project_activities,tests,suites,project_members,projects,users CASCADE",
  );
  await call("post", "/setup", "admin", { code: setupCode }).expect(201);
});
after(async () => {
  await engine.close();
  await rm(databaseDirectory, { recursive: true, force: true });
});

test("Portuguese rejection label, empty suites and reviewed progress", () => {
  assert.equal(statusLabels.revoked, "Rejeitado");
  assert.equal(summarize([]).status, "pending");
  assert.equal(summarize([]).progress, 0);
  assert.equal(summarize(["approved", "pending"]).status, "pending");
  assert.equal(summarize(["approved", "revoked"]).status, "revoked");
  assert.equal(summarize(["approved", "revoked"]).progress, 100);
  assert.equal(summarize(["approved", "approved"]).status, "approved");
  assert.equal(
    resultInput.safeParse({ status: "revoked", comment: "  " }).success,
    false,
  );
});
test("setup: nothing but /me works until someone with the setup code becomes master", async () => {
  await engine.exec("TRUNCATE app_admins");
  const me = (await call("get", "/me", "member").expect(200)).body;
  assert.equal(me.setupRequired, true);
  assert.equal(me.admin, false);
  await call("get", "/projects", "member").expect(409);
  await call("post", "/projects", "member", { name: "Antes" }).expect(409);
  await call("post", "/setup", "member", { code: "errado" }).expect(403);
  await call("post", "/setup", "member", { code: "" }).expect(400);
  const master = (
    await call("post", "/setup", "member", { code: setupCode }).expect(201)
  ).body;
  assert.equal(master.master, true);
  assert.equal(master.setupRequired, false);
  // The setup happens once, even with the right code.
  await call("post", "/setup", "owner", { code: setupCode }).expect(409);
  const after = (await call("get", "/me", "owner").expect(200)).body;
  assert.deepEqual(
    [after.setupRequired, after.admin, after.master],
    [false, false, false],
  );
  await call("get", "/projects", "owner").expect(200);
  const admins = (await call("get", "/admins", "member").expect(200)).body;
  assert.deepEqual(
    admins.map((admin: any) => [admin.email, admin.master]),
    [["joao@example.test", true]],
  );
});
test("admins: create projects, act as invisible owners everywhere and manage admins", async () => {
  // Only administrators create projects; their projects start without members.
  await call("post", "/projects", "owner", { name: "Meu" }).expect(403);
  const solo = (
    await call("post", "/projects", "admin", { name: "Sem equipa" }).expect(201)
  ).body;
  assert.equal(solo.role, "owner");
  assert.deepEqual(
    (await call("get", `/projects/${solo.id}/members`, "admin").expect(200))
      .body,
    [],
  );
  const { project, suite } = await fixture();
  // Not a member, yet sees every project and works in it as an owner.
  assert.deepEqual(
    (await call("get", "/projects", "admin")).body
      .map((item: any) => [item.name, item.role])
      .sort(),
    [
      ["Checkout", "owner"],
      ["Sem equipa", "owner"],
    ],
  );
  assert.deepEqual(
    (await call("get", "/projects", "owner")).body.map(
      (item: any) => item.name,
    ),
    ["Checkout"],
  );
  assert.ok(
    !(await call("get", `/projects/${project.id}/members`, "admin")).body.some(
      (member: any) => member.oid === identities.admin.oid,
    ),
  );
  await call(
    "patch",
    `/projects/${project.id}`,
    "admin",
    { name: "Checkout 2", description: "" },
    project.version,
  ).expect(200);
  await call("post", `/projects/${project.id}/keys`, "admin", {
    name: "CI",
  }).expect(201);
  assert.equal(
    (await call("get", `/search?q=Pagamentos`, "admin")).body.suites[0].id,
    suite.id,
  );
  assert.equal(
    (await call("get", `/search?q=Pagamentos`, "outsider")).body.suites.length,
    0,
  );

  // Managing administrators.
  await call("get", "/admins", "owner").expect(403);
  await call("post", "/admins", "owner", { oid: identities.member.oid }).expect(
    403,
  );
  await call("get", "/admins/directory?q=an", "owner").expect(403);
  assert.ok(
    (await call("get", "/admins/directory?q=an", "admin").expect(200)).body
      .length,
  );
  const added = (
    await call("post", "/admins", "admin", {
      oid: identities.member.oid,
    }).expect(201)
  ).body;
  assert.equal(added.master, false);
  assert.equal(added.createdByName, identities.admin.name);
  // Adding twice keeps a single administrator row.
  await call("post", "/admins", "admin", {
    oid: identities.member.oid,
  }).expect(201);
  assert.deepEqual(
    (await call("get", "/admins", "member").expect(200)).body.map(
      (admin: any) => [admin.name, admin.master],
    ),
    [
      ["Administradora", true],
      ["João Costa", false],
    ],
  );
  // An administrator overrides a read-only membership.
  await call("patch", `/projects/${project.id}/members/${added.id}`, "owner", {
    role: "viewer",
  }).expect(204);
  await call("post", `/suites/${suite.id}/comments`, "member", {
    body: "Como administrador",
  }).expect(201);
  await call("post", "/projects", "member", { name: "Do João" }).expect(201);
  const masterId = (await call("get", "/me", "admin")).body.id;
  await call("delete", `/admins/${masterId}`, "member").expect(409);
  await call("delete", `/admins/${added.id}`, "admin").expect(204);
  await call("delete", `/admins/${added.id}`, "admin").expect(404);
  assert.equal((await call("get", "/me", "member")).body.admin, false);
  await call("post", "/projects", "member", { name: "Outro" }).expect(403);
  await call("post", `/suites/${suite.id}/comments`, "member", {
    body: "Já só leitor",
  }).expect(403);
  // A removed administrator can be made one again.
  await call("post", "/admins", "admin", {
    oid: identities.member.oid,
  }).expect(201);
  assert.equal((await call("get", "/me", "member")).body.admin, true);
});
test("project icons are returned and cannot exceed 48 by 48 pixels", async () => {
  const icon =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const project = await createProject({
    name: "Com ícone",
    description: "",
    icon,
  });
  assert.equal(project.icon, icon);
  assert.equal((await call("get", "/projects")).body[0].icon, icon);
  await call("post", "/projects", "admin", {
    name: "Ícone demasiado grande",
    description: "",
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADEAAAAx",
  }).expect(400);
});
test("any member, including a guest, can record results; rejection and reason are atomic", async () => {
  const { suite } = await fixture();
  const testCase = suite.tests[0];
  await call(
    "post",
    `/tests/${testCase.id}/result`,
    "guest",
    { status: "revoked", comment: " " },
    1,
  ).expect(400);
  assert.equal(
    (await call("get", `/suites/${suite.id}/activity`)).body.filter(
      (item: any) => item.kind === "result_recorded",
    ).length,
    0,
  );
  await call(
    "post",
    `/tests/${testCase.id}/result`,
    "guest",
    { status: "revoked", comment: "O pagamento não confirma." },
    1,
  ).expect(200);
  const updated = (await call("get", `/suites/${suite.id}`, "member")).body;
  assert.equal(updated.status, "revoked");
  assert.equal(updated.progress, 50);
  const activity = (
    await call("get", `/suites/${suite.id}/activity`)
  ).body.find((item: any) => item.kind === "result_recorded");
  assert.equal(activity.actorName, "Convidada");
  assert.equal(activity.body, "O pagamento não confirma.");
});
test("discussion, reopening and editing preserve history and reset material changes", async () => {
  const { suite, memberId } = await fixture();
  let testCase = suite.tests[0];
  testCase = (
    await call(
      "post",
      `/tests/${testCase.id}/result`,
      "member",
      { status: "approved" },
      testCase.version,
    )
  ).body;
  await call("post", `/tests/${testCase.id}/comments`, "guest", {
    body: "Pode explicar o cenário?",
  }).expect(201);
  testCase = (
    await call(
      "patch",
      `/tests/${testCase.id}`,
      "owner",
      {
        title: "Cartão atualizado",
        instructions: "Novas instruções",
        expectedResult: testCase.expectedResult,
        assigneeId: memberId,
      },
      testCase.version,
    ).expect(200)
  ).body;
  assert.equal(testCase.status, "pending");
  testCase = (
    await call(
      "post",
      `/tests/${testCase.id}/result`,
      "member",
      { status: "approved" },
      testCase.version,
    )
  ).body;
  testCase = (
    await call(
      "post",
      `/tests/${testCase.id}/result`,
      "guest",
      { status: "pending" },
      testCase.version,
    )
  ).body;
  assert.equal(testCase.status, "pending");
  const activity = (await call("get", `/suites/${suite.id}/activity`)).body;
  assert.equal(
    activity.filter((item: any) => item.kind === "result_recorded").length,
    3,
  );
  assert.equal(
    activity.find((item: any) => item.kind === "comment").body,
    "Pode explicar o cenário?",
  );
  assert.equal(
    activity.find((item: any) => item.kind === "test_edited").detail
      .resetToPending,
    true,
  );
});
test("archive hides suites from active lists and counts, blocks writes and restores all data", async () => {
  const { suite, project } = await fixture();
  await call(
    "post",
    `/tests/${suite.tests[0].id}/result`,
    "member",
    { status: "revoked", comment: "Erro 500" },
    1,
  );
  await call("post", `/suites/${suite.id}/comments`, "guest", {
    body: "A investigar.",
  });
  const previous = (await call("get", `/suites/${suite.id}`)).body;
  await call(
    "post",
    `/suites/${suite.id}/archive`,
    "member",
    undefined,
    previous.version,
  ).expect(403);
  const archived = (
    await call(
      "post",
      `/suites/${suite.id}/archive`,
      "owner",
      undefined,
      previous.version,
    ).expect(200)
  ).body;
  await call(
    "post",
    `/suites/${suite.id}/archive`,
    "owner",
    undefined,
    previous.version,
  ).expect(200);
  assert.equal(
    (await call("get", `/projects/${project.id}/suites`)).body.total,
    0,
  );
  assert.equal(
    (await call("get", `/projects/${project.id}/summary`)).body.total,
    0,
  );
  assert.equal(
    (await call("get", `/projects/${project.id}/suites?archive=archived`)).body
      .total,
    1,
  );
  for (const [path, body] of [
    [`/suites/${suite.id}/comments`, { body: "blocked" }],
    [`/tests/${suite.tests[0].id}/comments`, { body: "blocked" }],
    [`/tests/${suite.tests[0].id}/result`, { status: "approved" }],
    [`/suites/${suite.id}/tests`, { title: "blocked" }],
  ] as const)
    await call("post", path, "owner", body, 2).expect(409);
  await call(
    "patch",
    `/suites/${suite.id}`,
    "owner",
    { title: "blocked", description: "" },
    archived.version,
  ).expect(409);
  await call(
    "patch",
    `/tests/${suite.tests[0].id}`,
    "owner",
    { title: "blocked" },
    2,
  ).expect(409);
  const restored = (
    await call(
      "post",
      `/suites/${suite.id}/restore`,
      "owner",
      undefined,
      archived.version,
    ).expect(200)
  ).body;
  assert.equal(restored.status, previous.status);
  assert.equal(restored.progress, previous.progress);
  assert.deepEqual(restored.tests, previous.tests);
  await call(
    "post",
    `/suites/${suite.id}/restore`,
    "owner",
    undefined,
    archived.version,
  ).expect(200);
  const activity = (await call("get", `/suites/${suite.id}/activity`)).body;
  assert.equal(
    activity.filter((item: any) => item.kind === "suite_archived").length,
    1,
  );
  assert.equal(
    activity.filter((item: any) => item.kind === "suite_restored").length,
    1,
  );
  assert.equal(
    activity.filter((item: any) => item.kind === "comment").length,
    1,
  );
});
test("project deletion is owner-only, versioned, hidden and preserves its data", async () => {
  const { suite, project } = await fixture();
  await call(
    "delete",
    `/projects/${project.id}`,
    "member",
    undefined,
    project.version,
  ).expect(403);
  await call("delete", `/projects/${project.id}`, "owner").expect(428);
  await call(
    "delete",
    `/projects/${project.id}`,
    "owner",
    undefined,
    project.version,
  ).expect(204);
  assert.equal(
    (await call("get", "/projects", "owner")).body.some(
      (item: any) => item.id === project.id,
    ),
    false,
  );
  await call("get", `/suites/${suite.id}`, "owner").expect(404);
  await call("get", `/projects/${project.id}/members`, "member").expect(404);
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*) FROM suites WHERE project_id=$1", [
          project.id,
        ])
      ).rows[0].count,
    ),
    1,
  );
});
test("duplicate retains definitions, resets results and does not copy discussion", async () => {
  const { suite } = await fixture();
  await call(
    "post",
    `/tests/${suite.tests[0].id}/result`,
    "member",
    { status: "approved" },
    1,
  );
  await call("post", `/suites/${suite.id}/comments`, "owner", {
    body: "Não copiar",
  });
  const copy = (
    await call("post", `/suites/${suite.id}/duplicate`, "guest").expect(201)
  ).body;
  assert.notEqual(copy.id, suite.id);
  assert.equal(copy.status, "pending");
  assert.equal(copy.progress, 0);
  assert.equal(copy.tests[0].instructions, suite.tests[0].instructions);
  assert.equal(copy.tests[0].assigneeId, suite.tests[0].assigneeId);
  const activity = (await call("get", `/suites/${copy.id}/activity`)).body;
  assert.equal(
    activity.filter((item: any) => item.kind === "suite_created").length,
    1,
  );
  assert.equal(
    activity.filter((item: any) => item.kind === "test_created").length,
    2,
  );
  assert.equal(
    activity.filter(
      (item: any) => item.kind === "comment" || item.kind === "result_recorded",
    ).length,
    0,
  );
});
test("optimistic versions reject missing, stale and concurrent writes", async () => {
  const { suite } = await fixture();
  const path = `/tests/${suite.tests[0].id}/result`;
  await call("post", path, "member", { status: "approved" }).expect(428);
  const results = await Promise.all([
    call("post", path, "member", { status: "approved" }, 1),
    call(
      "post",
      path,
      "guest",
      { status: "revoked", comment: "Outra observação" },
      1,
    ),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
});
test("outsiders and unauthenticated users cannot access resources", async () => {
  const { suite, project } = await fixture();
  await request(app)
    .post("/api/v1/auth/local/session")
    .send({ oid: identities.owner.oid })
    .expect(404);
  await request(app).get("/api/v1/projects").expect(401);
  await call("get", "/projects", "invalid").expect(401);
  assert.equal((await call("get", "/projects", "outsider")).body.length, 0);
  for (const path of [
    `/suites/${suite.id}`,
    `/suites/${suite.id}/activity`,
    `/projects/${project.id}/members`,
    `/projects/${project.id}/suites`,
  ])
    await call("get", path, "outsider").expect(404);
  await call("post", `/tests/${suite.tests[0].id}/comments`, "outsider", {
    body: "Forbidden",
  }).expect(404);
  await call("get", `/projects/${project.id}/keys`, "member").expect(403);
});
test("last owner protected and removed members lose access and active assignments", async () => {
  const { project, memberId, members, suite } = await fixture();
  const owner = members.find((member: any) => member.role === "owner");
  await call("delete", `/projects/${project.id}/members/${owner.id}`).expect(
    409,
  );
  await call("post", `/projects/${project.id}/members`, "owner", {
    oid: identities.owner.oid,
    role: "member",
  }).expect(409);
  await call("delete", `/projects/${project.id}/members/${memberId}`).expect(
    204,
  );
  assert.equal(
    (await call("get", `/suites/${suite.id}`)).body.tests[0].assigneeId,
    null,
  );
  await call("get", `/suites/${suite.id}`, "member").expect(404);
});
test("invalid assignee rolls back the entire suite creation", async () => {
  const { project } = await fixture();
  await call("post", `/projects/${project.id}/suites`, "owner", {
    title: "Atomic",
    tests: [
      { title: "Valid" },
      { title: "Invalid", assigneeId: identities.outsider.oid },
    ],
  }).expect(400);
  assert.equal(
    (await call("get", `/projects/${project.id}/suites`)).body.total,
    1,
  );
});
test("test priority is optional, kept when omitted and never resets results", async () => {
  const { project, suite } = await fixture();
  assert.equal(suite.tests[0].priority, null);
  const key = (
    await call("post", `/projects/${project.id}/keys`, "owner", {
      name: "Pipeline IA",
    }).expect(201)
  ).body;
  const published = (
    await call("post", `/projects/${project.id}/suites`, key.secret, {
      title: "Release",
      tests: [
        { title: "Checkout", expectedResult: "Compra concluída", priority: 1 },
        { title: "Rodapé", expectedResult: "Links corretos" },
      ],
    })
      .set("Idempotency-Key", "priority-1")
      .expect(201)
  ).body;
  assert.deepEqual(
    published.tests.map((test: any) => test.priority),
    [1, null],
  );
  for (const priority of [0, 6, 2.5, "1"])
    await call("post", `/projects/${project.id}/suites`, key.secret, {
      title: "Inválida",
      tests: [{ title: "Teste", priority }],
    })
      .set("Idempotency-Key", `priority-invalid-${priority}`)
      .expect(400);
  const [test] = published.tests;
  await call(
    "post",
    `/tests/${test.id}/result`,
    "member",
    { status: "approved" },
    test.version,
  ).expect(200);
  const approved = (await call("get", `/suites/${published.id}`)).body.tests[0];
  // Changing only the priority keeps the result and is recorded as an edit.
  const edited = (
    await call(
      "patch",
      `/tests/${test.id}`,
      "member",
      {
        title: test.title,
        instructions: test.instructions,
        expectedResult: test.expectedResult,
        priority: 3,
      },
      approved.version,
    ).expect(200)
  ).body;
  assert.equal(edited.priority, 3);
  assert.equal(edited.status, "approved");
  const activity = (await call("get", `/suites/${published.id}/activity`)).body;
  assert.ok(
    activity.some(
      (item: any) => item.kind === "test_edited" && item.testId === test.id,
    ),
  );
  // Clients that do not send a priority (older ones, reordering) keep it.
  const moved = (
    await call(
      "patch",
      `/tests/${test.id}`,
      "owner",
      {
        title: test.title,
        instructions: test.instructions,
        expectedResult: test.expectedResult,
        position: 1,
      },
      edited.version,
    ).expect(200)
  ).body;
  assert.equal(moved.priority, 3);
  const cleared = (
    await call(
      "patch",
      `/tests/${test.id}`,
      "owner",
      {
        title: test.title,
        instructions: test.instructions,
        expectedResult: test.expectedResult,
        priority: null,
      },
      moved.version,
    ).expect(200)
  ).body;
  assert.equal(cleared.priority, null);
  const copy = (
    await call("post", `/suites/${published.id}/duplicate`, "owner").expect(201)
  ).body;
  assert.deepEqual(
    copy.tests.map((test: any) => [test.title, test.priority]),
    [
      ["Rodapé", null],
      ["Checkout", null],
    ],
  );
  const openapi = (await call("get", "/openapi.json")).body;
  assert.match(JSON.stringify(openapi), /"priority"/);
});
test("test reorder shifts neighbours and preserves QA results", async () => {
  const { suite } = await fixture();
  const first = suite.tests[0];
  const second = suite.tests[1];
  await call(
    "patch",
    `/tests/${second.id}`,
    "owner",
    {
      title: second.title,
      instructions: second.instructions,
      expectedResult: second.expectedResult,
      position: 0,
    },
    second.version,
  ).expect(200);
  const updated = (await call("get", `/suites/${suite.id}`)).body;
  assert.equal(updated.tests[0].id, second.id);
  assert.equal(updated.tests[1].id, first.id);
  assert.equal(updated.tests[1].position, 1);
  assert.equal(updated.tests[0].status, "pending");
});
test("AI imports are atomic, pending, attributed, scoped, hashed and retry-safe", async () => {
  const { project } = await fixture();
  const key = (
    await call("post", `/projects/${project.id}/keys`, "owner", {
      name: "Pipeline IA",
    }).expect(201)
  ).body;
  assert.match(key.secret, /^th_/);
  assert.equal(
    (await call("get", `/projects/${project.id}/keys`)).body[0].secret,
    undefined,
  );
  const stored = await db.query(
    "SELECT secret_hash FROM integration_keys WHERE id=$1",
    [key.id],
  );
  assert.notEqual(stored.rows[0].secret_hash, key.secret);
  const payload = {
    title: "Suite de hoje",
    description: "# Gerada",
    provenance: { branch: "master", commit: "abc123" },
    tests: [
      {
        title: "Validar checkout",
        instructions: "Abrir",
        expectedResult: "Funciona",
      },
    ],
  };
  await call(
    "post",
    `/projects/${project.id}/suites`,
    key.secret,
    payload,
  ).expect(400);
  const created = (
    await call("post", `/projects/${project.id}/suites`, key.secret, payload)
      .set("Idempotency-Key", "pipeline-123")
      .expect(201)
  ).body;
  const retry = (
    await call("post", `/projects/${project.id}/suites`, key.secret, payload)
      .set("Idempotency-Key", "pipeline-123")
      .expect(200)
  ).body;
  assert.equal(created.id, retry.id);
  assert.equal(created.status, "pending");
  assert.equal(created.createdBy, "Integração: Pipeline IA");
  assert.equal(created.provenance.commit, "abc123");
  await call("post", `/projects/${project.id}/suites`, key.secret, {
    ...payload,
    title: "Different",
  })
    .set("Idempotency-Key", "pipeline-123")
    .expect(409);
  await call("get", `/projects/${project.id}/suites`, key.secret).expect(403);
  await call(
    "post",
    `/tests/${created.tests[0].id}/result`,
    key.secret,
    { status: "approved" },
    1,
  ).expect(403);
  const another = await createProject({ name: "Other" });
  await call("post", `/projects/${another.id}/suites`, key.secret, payload)
    .set("Idempotency-Key", "cross-project")
    .expect(403);
  const byEmail = (
    await call("post", `/projects/${project.id}/suites`, key.secret, {
      ...payload,
      tests: [{ ...payload.tests[0], assigneeEmail: "JOAO@example.test" }],
    })
      .set("Idempotency-Key", "assignee-email")
      .expect(201)
  ).body;
  const members = (await call("get", `/projects/${project.id}/members`)).body;
  assert.equal(
    byEmail.tests[0].assigneeId,
    members.find((member: any) => member.email === identities.member.email).id,
  );
  await call("post", `/projects/${project.id}/suites`, key.secret, {
    ...payload,
    tests: [{ ...payload.tests[0], assigneeEmail: identities.outsider.email }],
  })
    .set("Idempotency-Key", "assignee-outsider")
    .expect(400);
  await call("post", `/projects/${project.id}/suites`, key.secret, {
    ...payload,
    tests: [
      {
        ...payload.tests[0],
        assigneeEmail: identities.member.email,
        assigneeId: byEmail.tests[0].assigneeId,
      },
    ],
  })
    .set("Idempotency-Key", "assignee-both")
    .expect(400);
  await call("post", `/projects/${project.id}/keys/${key.id}/revoke`).expect(
    200,
  );
  await call("post", `/projects/${project.id}/suites`, key.secret, payload)
    .set("Idempotency-Key", "new")
    .expect(401);
});
test("manage keys read and edit suites and tests of their project only", async () => {
  const { project, suite, memberId } = await fixture();
  const publish = (
    await call("post", `/projects/${project.id}/keys`, "owner", {
      name: "Só publica",
    }).expect(201)
  ).body;
  const manage = (
    await call("post", `/projects/${project.id}/keys`, "owner", {
      name: "Agente QA",
      scope: "manage",
    }).expect(201)
  ).body;
  await call("post", `/projects/${project.id}/keys`, "owner", {
    name: "Errada",
    scope: "admin",
  }).expect(400);
  assert.deepEqual(
    (await call("get", `/projects/${project.id}/keys`)).body
      .map((key: any) => [key.name, key.scope])
      .sort(),
    [
      ["Agente QA", "manage"],
      ["Só publica", "publish"],
    ],
  );
  // A publishing key still only publishes.
  await call("get", `/suites/${suite.id}`, publish.secret).expect(403);
  await call(
    "patch",
    `/suites/${suite.id}`,
    publish.secret,
    { title: "X", description: "" },
    suite.version,
  ).expect(403);
  const listed = (
    await call("get", `/projects/${project.id}/suites`, manage.secret).expect(
      200,
    )
  ).body;
  assert.deepEqual(
    listed.items.map((item: any) => item.id),
    [suite.id],
  );
  let current = (
    await call("get", `/suites/${suite.id}`, manage.secret).expect(200)
  ).body;
  current = (
    await call(
      "patch",
      `/suites/${suite.id}`,
      manage.secret,
      { title: "Pagamentos v2", description: "Revista" },
      current.version,
    ).expect(200)
  ).body;
  assert.equal(current.title, "Pagamentos v2");
  // New tests may name their assignee by email and their modules by name.
  const added = (
    await call(
      "post",
      `/suites/${suite.id}/tests`,
      manage.secret,
      {
        title: "MB Way",
        instructions: "1. Pagar com MB Way",
        expectedResult: "Pagamento aceite",
        assigneeEmail: identities.member.email,
        modules: ["Pagamentos"],
      },
      current.version,
    ).expect(201)
  ).body;
  assert.equal(added.assigneeId, memberId);
  current = (await call("get", `/suites/${suite.id}`, manage.secret)).body;
  const withModule = current.tests.find((test: any) => test.id === added.id);
  assert.equal(withModule.moduleIds.length, 1);
  // A retry with the old suite version is refused instead of adding it twice.
  await call(
    "post",
    `/suites/${suite.id}/tests`,
    manage.secret,
    { title: "MB Way", instructions: "", expectedResult: "" },
    current.version - 1,
  ).expect(409);
  // Replacing a recorded result needs explicit confirmation from a key.
  const [first] = current.tests;
  const approved = (
    await call(
      "post",
      `/tests/${first.id}/result`,
      "member",
      { status: "approved" },
      first.version,
    ).expect(200)
  ).body;
  const edit = {
    title: first.title,
    instructions: "1. Abrir checkout novo",
    expectedResult: first.expectedResult,
  };
  await call(
    "patch",
    `/tests/${first.id}`,
    manage.secret,
    edit,
    approved.version,
  ).expect(409);
  const retitled = (
    await call(
      "patch",
      `/tests/${first.id}`,
      manage.secret,
      { ...edit, instructions: first.instructions, title: "Cartão Visa" },
      approved.version,
    ).expect(200)
  ).body;
  assert.equal(retitled.status, "approved");
  const reset = (
    await call(
      "patch",
      `/tests/${first.id}`,
      manage.secret,
      { ...edit, title: "Cartão Visa", confirmReset: true, assigneeId: null },
      retitled.version,
    ).expect(200)
  ).body;
  assert.equal(reset.status, "pending");
  assert.equal(reset.assigneeId, null);
  const reassigned = (
    await call(
      "patch",
      `/tests/${first.id}`,
      manage.secret,
      { ...edit, title: "Cartão Visa", assigneeEmail: identities.member.email },
      reset.version,
    ).expect(200)
  ).body;
  assert.equal(reassigned.assigneeId, memberId);
  // Deletion stays logical and is attributed to the key.
  await call(
    "delete",
    `/tests/${added.id}`,
    manage.secret,
    undefined,
    added.version - 1,
  ).expect(409);
  await call(
    "delete",
    `/tests/${added.id}`,
    manage.secret,
    undefined,
    added.version,
  ).expect(204);
  const deleted = await db.query(
    "SELECT deleted_at,deleted_by FROM tests WHERE id=$1",
    [added.id],
  );
  assert.ok(deleted.rows[0].deleted_at);
  assert.equal(deleted.rows[0].deleted_by, null);
  const history = (
    await call("get", `/suites/${suite.id}/activity`).expect(200)
  ).body.filter((item: any) => item.actorName === "Integração: Agente QA");
  assert.deepEqual(
    history.map((item: any) => item.kind),
    [
      "suite_edited",
      "test_created",
      "test_edited",
      "test_edited",
      "assignment_changed",
      "assignment_changed",
      "test_deleted",
    ],
  );
  // Still no results, suite deletion, archival or other projects.
  current = (await call("get", `/suites/${suite.id}`, manage.secret)).body;
  await call(
    "post",
    `/tests/${first.id}/result`,
    manage.secret,
    { status: "approved" },
    current.tests[0].version,
  ).expect(403);
  await call(
    "delete",
    `/suites/${suite.id}`,
    manage.secret,
    undefined,
    current.version,
  ).expect(403);
  await call(
    "post",
    `/suites/${suite.id}/archive`,
    manage.secret,
    undefined,
    current.version,
  ).expect(403);
  await call("get", `/projects/${project.id}/members`, manage.secret).expect(
    403,
  );
  const another = await createProject({ name: "Outro" });
  const foreign = (
    await call("post", `/projects/${another.id}/suites`, "owner", {
      title: "Alheia",
      description: "",
      tests: [{ title: "T", instructions: "", expectedResult: "" }],
    }).expect(201)
  ).body;
  await call("get", `/suites/${foreign.id}`, manage.secret).expect(403);
  await call("get", `/projects/${another.id}/suites`, manage.secret).expect(
    403,
  );
  await call(
    "delete",
    `/tests/${foreign.tests[0].id}`,
    manage.secret,
    undefined,
    foreign.tests[0].version,
  ).expect(403);
  await call("post", `/projects/${project.id}/keys/${manage.id}/revoke`).expect(
    200,
  );
  await call("get", `/suites/${suite.id}`, manage.secret).expect(401);
});
test("suite search, status, assignee and archive filters agree with pagination", async () => {
  const { project, suite, memberId } = await fixture();
  await call("post", `/projects/${project.id}/suites`, "owner", {
    title: "Autenticação",
  });
  assert.equal(
    (await call("get", `/projects/${project.id}/suites?q=pagamentos`)).body
      .total,
    1,
  );
  assert.equal(
    (await call("get", `/projects/${project.id}/suites?assignee=${memberId}`))
      .body.total,
    1,
  );
  assert.equal(
    (await call("get", `/projects/${project.id}/suites?status=approved`)).body
      .total,
    0,
  );
  assert.equal(
    (
      await call(
        "get",
        `/projects/${project.id}/suites?status=approved,pending`,
      ).expect(200)
    ).body.total,
    2,
  );
  await call(
    "get",
    `/projects/${project.id}/suites?status=pending,bogus`,
  ).expect(400);
  const page = (
    await call(
      "get",
      `/projects/${project.id}/suites?pageSize=1&page=2&sort=title`,
    )
  ).body;
  assert.equal(page.items.length, 1);
  assert.equal(page.total, 2);
  await call(
    "post",
    `/suites/${suite.id}/archive`,
    "owner",
    undefined,
    suite.version,
  );
  assert.equal(
    (await call("get", `/projects/${project.id}/suites?archive=all`)).body
      .total,
    2,
  );
});
test("OpenAPI is public and records publishing schema and archive endpoints", async () => {
  const result = await request(app).get("/api/v1/openapi.json").expect(200);
  assert.equal(result.body.openapi, "3.0.3");
  assert.ok(result.body.paths["/suites/{suiteId}/restore"]);
  assert.ok(result.body.paths["/projects/{projectId}"].delete);
  assert.ok(
    result.body.paths["/projects/{projectId}/suites"].post.requestBody.content[
      "application/json"
    ].schema.properties.tests,
  );
});
test("database reopening preserves archives, results, assignments and discussion", async () => {
  const { suite, memberId } = await fixture();
  await call(
    "post",
    `/tests/${suite.tests[0].id}/result`,
    "guest",
    {
      status: "revoked",
      comment: "O pagamento não foi confirmado.",
    },
    1,
  ).expect(200);
  await call("post", `/tests/${suite.tests[0].id}/comments`, "member", {
    body: "Vou investigar o erro.",
  }).expect(201);
  const updated = (await call("get", `/suites/${suite.id}`)).body;
  await call(
    "post",
    `/suites/${suite.id}/archive`,
    "owner",
    undefined,
    updated.version,
  ).expect(200);
  await engine.close();
  engine = new PGlite(databaseDirectory);
  const persisted = (
    await call("get", `/suites/${suite.id}`, "guest").expect(200)
  ).body;
  assert.ok(persisted.archivedAt);
  assert.equal(persisted.status, "revoked");
  assert.equal(persisted.progress, 50);
  assert.equal(persisted.tests[0].assigneeId, memberId);
  const activity = (await call("get", `/suites/${suite.id}/activity`, "guest"))
    .body;
  assert.ok(
    activity.some(
      (item: any) =>
        item.body === "O pagamento não foi confirmado." &&
        item.actorName === "Convidada",
    ),
  );
  assert.ok(
    activity.some((item: any) => item.body === "Vou investigar o erro."),
  );
});

test("local sessions preserve server identity, directory membership and attribution", async () => {
  const config = (await request(localApp).get("/api/v1/config").expect(200))
    .body;
  assert.equal(config.mode, "local");
  assert.deepEqual(
    config.localUsers.map((user: any) => user.oid),
    localDirectory.map((user) => user.oid),
  );
  await request(localApp)
    .post("/api/v1/auth/local/session")
    .send({ oid: localDirectory[0].oid, name: "Nome forjado" })
    .expect(400);
  const ana = (
    await request(localApp)
      .post("/api/v1/auth/local/session")
      .send({ oid: localDirectory[0].oid })
      .expect(201)
  ).body.token;
  const joao = (
    await request(localApp)
      .post("/api/v1/auth/local/session")
      .send({ oid: localDirectory[1].oid })
      .expect(201)
  ).body.token;
  const localCall = (
    method: "get" | "post",
    path: string,
    token: string,
    body?: object,
    version?: number,
  ) => {
    let req = request(localApp)
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${token}`);
    if (body) req = req.send(body);
    if (version !== undefined) req = req.set("If-Match", String(version));
    return req;
  };
  // Ana administers the app; she creates the project and adds herself as owner.
  await localCall("get", "/me", ana).expect(200);
  await engine.query(
    "INSERT INTO app_admins(id,user_id) SELECT gen_random_uuid(),id FROM users WHERE oid=$1",
    [localDirectory[0].oid],
  );
  const project = (
    await localCall("post", "/projects", ana, {
      name: "Projeto local",
      description: "",
    }).expect(201)
  ).body;
  await localCall("post", `/projects/${project.id}/members`, ana, {
    oid: localDirectory[0].oid,
    role: "owner",
  }).expect(201);
  await localCall("get", `/projects/${project.id}/members`, joao).expect(404);
  const directory = (
    await localCall(
      "get",
      `/projects/${project.id}/directory?q=jo`,
      ana,
    ).expect(200)
  ).body;
  assert.deepEqual(
    directory.map((person: any) => person.oid),
    [localDirectory[1].oid],
  );
  await localCall("post", `/projects/${project.id}/members`, ana, {
    oid: localDirectory[1].oid,
    role: "member",
  }).expect(201);
  await localCall("get", `/projects/${project.id}/members`, joao).expect(200);
  const suite = (
    await localCall("post", `/projects/${project.id}/suites`, ana, {
      title: "Suite local",
      tests: [{ title: "Teste local" }],
    }).expect(201)
  ).body;
  await localCall(
    "post",
    `/tests/${suite.tests[0].id}/result`,
    joao,
    { status: "revoked", comment: "Falhou localmente." },
    1,
  ).expect(200);
  const activity = (
    await localCall("get", `/suites/${suite.id}/activity`, ana).expect(200)
  ).body;
  assert.ok(
    activity.some(
      (item: any) =>
        item.kind === "result_recorded" &&
        item.actorName === localDirectory[1].name,
    ),
  );
  await localCall("get", "/projects", `${ana}tampered`).expect(401);
  await request(localApp)
    .delete("/api/v1/auth/local/session")
    .set("Authorization", `Bearer ${joao}`)
    .expect(204);
  await localCall("get", "/projects", joao).expect(401);
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const upload = (
  suiteId: string,
  name: string,
  data: Buffer,
  token = "owner",
  testId?: string,
) =>
  request(app)
    .post(
      `/api/v1/suites/${suiteId}/attachments${testId ? `?testId=${testId}` : ""}`,
    )
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "application/octet-stream")
    .set("X-File-Name", encodeURIComponent(name))
    .send(data);
const notifications = async (token: string) =>
  (await call("get", "/notifications", token).expect(200)).body;

test("suites and tests keep stable numbers across reorders and duplicates", async () => {
  const { project, suite } = await fixture();
  assert.equal(suite.number, 1);
  assert.deepEqual(
    suite.tests.map((test: any) => test.number),
    [1, 2],
  );
  const second = (
    await call("post", `/projects/${project.id}/suites`, "owner", {
      title: "Login",
      description: "",
      tests: [],
    }).expect(201)
  ).body;
  assert.equal(second.number, 2);
  const [first, last] = suite.tests;
  await call(
    "patch",
    `/tests/${last.id}`,
    "owner",
    {
      title: last.title,
      instructions: last.instructions,
      expectedResult: last.expectedResult,
      position: 0,
    },
    last.version,
  ).expect(200);
  const current = (
    await call(
      "post",
      `/suites/${suite.id}/tests`,
      "owner",
      {
        title: "SMS",
        instructions: "",
        expectedResult: "",
      },
      (await call("get", `/suites/${suite.id}`)).body.version,
    ).expect(201)
  ).body;
  assert.equal(current.number, 3);
  const reordered = (await call("get", `/suites/${suite.id}`)).body;
  assert.deepEqual(
    reordered.tests.map((test: any) => [test.title, test.number]),
    [
      [last.title, 2],
      [first.title, 1],
      ["SMS", 3],
    ],
  );
  const copy = (await call("post", `/suites/${suite.id}/duplicate`).expect(201))
    .body;
  assert.equal(copy.number, 3);
  assert.deepEqual(
    copy.tests.map((test: any) => test.number),
    [1, 2, 3],
  );
  const listed = (await call("get", `/projects/${project.id}/suites?q=SU-03`))
    .body;
  assert.deepEqual(
    listed.items.map((item: any) => item.id),
    [copy.id],
  );
});

test("structured steps: parsed on publish, shared results, versioned and reset by edits", async () => {
  const { suite } = await fixture();
  const [card, email] = suite.tests;
  assert.deepEqual(
    card.steps.map((step: any) => [step.body, step.status]),
    [["Abrir checkout", "pending"]],
  );
  assert.equal(card.instructions, "");
  assert.deepEqual(email.steps, []);
  assert.equal(email.instructions, "Verificar caixa de entrada");
  const step = card.steps[0];
  await call("post", `/tests/${card.id}/steps/${step.id}/result`, "guest", {
    status: "failed",
  }).expect(428);
  const marked = (
    await call(
      "post",
      `/tests/${card.id}/steps/${step.id}/result`,
      "guest",
      { status: "failed" },
      step.version,
    ).expect(200)
  ).body;
  assert.equal(marked.status, "failed");
  assert.equal(marked.updatedByName, "Convidada");
  await call(
    "post",
    `/tests/${card.id}/steps/${step.id}/result`,
    "member",
    { status: "passed" },
    step.version,
  ).expect(409);
  await call(
    "post",
    `/tests/${card.id}/steps/${step.id}/result`,
    "outsider",
    { status: "passed" },
    marked.version,
  ).expect(404);
  const shared = (await call("get", `/suites/${suite.id}`, "member")).body
    .tests[0];
  assert.equal(shared.steps[0].status, "failed");
  assert.equal(shared.status, "pending");
  assert.deepEqual(
    shared.testers.map((tester: any) => tester.name),
    ["Convidada"],
  );
  await call(
    "post",
    `/tests/${card.id}/result`,
    "owner",
    { status: "approved" },
    shared.version,
  ).expect(200);
  const approved = (await call("get", `/suites/${suite.id}`)).body.tests[0];
  await call(
    "patch",
    `/tests/${card.id}`,
    "owner",
    {
      title: card.title,
      instructions: "",
      steps: ["Abrir checkout", "Pagar com MB Way"],
      expectedResult: card.expectedResult,
    },
    approved.version,
  ).expect(200);
  const edited = (await call("get", `/suites/${suite.id}`)).body.tests[0];
  assert.equal(edited.status, "pending");
  assert.deepEqual(
    edited.steps.map((item: any) => [item.body, item.status]),
    [
      ["Abrir checkout", "pending"],
      ["Pagar com MB Way", "pending"],
    ],
  );
  assert.deepEqual(
    edited.testers.map((tester: any) => tester.name),
    ["Convidada", "Ana Silva"],
  );
  const kept = (
    await call(
      "patch",
      `/tests/${card.id}`,
      "owner",
      {
        title: "Cartão renomeado",
        instructions: "",
        expectedResult: card.expectedResult,
      },
      edited.version,
    ).expect(200)
  ).body;
  assert.equal(kept.title, "Cartão renomeado");
  assert.equal(
    (await call("get", `/suites/${suite.id}`)).body.tests[0].steps.length,
    2,
  );
});

test("mentions and notifications reach assignees, testers and members but never the actor", async () => {
  const { project, suite, members, memberId } = await fixture();
  const guestId = members.find(
    (member: any) => member.oid === identities.guest.oid,
  ).id;
  const ownerId = members.find(
    (member: any) => member.oid === identities.owner.oid,
  ).id;
  const created = await notifications("member");
  assert.deepEqual(
    created.items.map((item: any) => [item.kind, item.suiteNumber]),
    [["suite_created", 1]],
  );
  assert.equal((await notifications("owner")).items.length, 0);
  const testCase = suite.tests[0];
  await call("post", `/tests/${testCase.id}/comments`, "owner", {
    body: "Ver isto",
    mentions: [identities.outsider.oid],
  }).expect(400);
  await call("post", `/tests/${testCase.id}/comments`, "guest", {
    body: "Primeiro teste feito.",
  }).expect(201);
  await call("post", `/tests/${testCase.id}/comments`, "owner", {
    body: "@Convidada consegue repetir?",
    mentions: [guestId],
  }).expect(201);
  const guest = await notifications("guest");
  assert.deepEqual(
    guest.items.slice(0, 2).map((item: any) => item.kind),
    ["mention", "suite_created"],
  );
  assert.equal(guest.items[0].testNumber, 1);
  assert.equal(guest.items[0].detail.excerpt, "@Convidada consegue repetir?");
  const member = await notifications("member");
  assert.deepEqual(
    member.items.map((item: any) => item.kind),
    ["comment", "comment", "suite_created"],
  );
  assert.equal(member.unread, 3);
  const current = (await call("get", `/suites/${suite.id}`)).body.tests[0];
  await call(
    "post",
    `/tests/${testCase.id}/result`,
    "member",
    { status: "approved" },
    current.version,
  ).expect(200);
  assert.equal((await notifications("guest")).items[0].kind, "result");
  assert.equal(
    (await notifications("guest")).items[0].detail.status,
    "approved",
  );
  assert.equal((await notifications("member")).items[0].kind, "comment");
  const second = (await call("get", `/suites/${suite.id}`)).body.tests[1];
  await call(
    "patch",
    `/tests/${second.id}`,
    "member",
    {
      title: second.title,
      instructions: second.instructions,
      expectedResult: second.expectedResult,
      assigneeId: ownerId,
    },
    second.version,
  ).expect(200);
  const owner = await notifications("owner");
  assert.equal(owner.items[0].kind, "assignment");
  assert.equal(owner.items[0].testNumber, 2);
  await call(
    "post",
    `/notifications/${owner.items[0].id}/read`,
    "member",
  ).expect(404);
  await call("post", `/notifications/${owner.items[0].id}/read`).expect(204);
  assert.equal((await notifications("owner")).items[0].readAt !== null, true);
  await call("post", "/notifications/read-all", "member").expect(204);
  assert.equal((await notifications("member")).unread, 0);
  await call("delete", `/projects/${project.id}/members/${guestId}`).expect(
    204,
  );
  assert.equal((await notifications("guest")).items.length, 0);
  assert.equal(memberId.length, 36);
});

test("attachments are validated, private until published and scoped to members", async () => {
  const { suite } = await fixture();
  const testCase = suite.tests[0];
  await upload(suite.id, "ecra.svg", png).expect(415);
  await upload(suite.id, "ecra.png", Buffer.from("not an image")).expect(415);
  await upload(suite.id, "ecra.png", png, "outsider").expect(404);
  const image = (
    await upload(suite.id, "ecrã 1.png", png, "guest", testCase.id).expect(201)
  ).body;
  assert.equal(image.contentType, "image/png");
  assert.equal(image.fileName, "ecrã 1.png");
  const log = (
    await upload(
      suite.id,
      "consola.log",
      Buffer.from("erro 403\n"),
      "guest",
      testCase.id,
    ).expect(201)
  ).body;
  await call("get", `/attachments/${image.id}`, "member").expect(404);
  await call("post", `/tests/${testCase.id}/comments`, "member", {
    body: "",
    attachmentIds: [image.id],
  }).expect(400);
  await call("post", `/tests/${testCase.id}/comments`, "guest", {
    body: "",
    attachmentIds: [image.id, log.id],
  }).expect(201);
  await call("post", `/tests/${testCase.id}/comments`, "guest", {
    body: "Outra vez",
    attachmentIds: [image.id],
  }).expect(400);
  const activity = (
    await call("get", `/suites/${suite.id}/activity?testId=${testCase.id}`)
  ).body.find((item: any) => item.kind === "comment");
  assert.deepEqual(
    activity.attachments.map((file: any) => file.fileName),
    ["ecrã 1.png", "consola.log"],
  );
  const download = await call("get", `/attachments/${image.id}`, "member")
    .buffer(true)
    .expect(200);
  assert.equal(download.headers["content-type"], "image/png");
  assert.match(download.headers["content-disposition"], /^inline;/);
  assert.equal(download.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(Buffer.from(download.body), png);
  const text = await call("get", `/attachments/${log.id}`, "owner").expect(200);
  assert.match(text.headers["content-disposition"], /^attachment;/);
  await call("get", `/attachments/${image.id}`, "outsider").expect(404);
  await call("delete", `/attachments/${image.id}`, "guest").expect(409);
  const pending = (await upload(suite.id, "nota.txt", Buffer.from("ok"))).body;
  await call("delete", `/attachments/${pending.id}`, "member").expect(404);
  await call("delete", `/attachments/${pending.id}`).expect(204);
  await call(
    "post",
    `/suites/${suite.id}/archive`,
    "owner",
    undefined,
    (await call("get", `/suites/${suite.id}`)).body.version,
  ).expect(200);
  await upload(suite.id, "tarde.png", png).expect(409);
});

test("global search covers suites, tests, steps and comments within membership", async () => {
  const { suite } = await fixture();
  await call("post", `/tests/${suite.tests[1].id}/comments`, "member", {
    body: "O email chegou com atraso de 5 minutos.",
  }).expect(201);
  const bySuite = (await call("get", "/search?q=pagamen", "guest")).body;
  assert.deepEqual(
    bySuite.suites.map((item: any) => [item.title, item.number]),
    [["Pagamentos", 1]],
  );
  const byStep = (await call("get", "/search?q=abrir checkout")).body;
  assert.deepEqual(
    byStep.tests.map((item: any) => [item.title, item.suiteNumber]),
    [["Cartão", 1]],
  );
  const byComment = (await call("get", "/search?q=atraso")).body;
  assert.equal(byComment.comments.length, 1);
  assert.equal(byComment.comments[0].testNumber, 2);
  assert.match(byComment.comments[0].excerpt, /atraso de 5 minutos/);
  assert.deepEqual(
    (await call("get", "/search?q=TC-2")).body.tests.map(
      (item: any) => item.title,
    ),
    ["Email"],
  );
  assert.equal((await call("get", "/search?q=100%_")).body.suites.length, 0);
  const outsider = (await call("get", "/search?q=pagamen", "outsider")).body;
  assert.deepEqual(outsider, {
    suites: [],
    tests: [],
    issues: [],
    comments: [],
    notes: [],
  });
  await call("get", "/search?q=a").expect(400);
});

test("logical deletion: owners delete suites, owners or the assignee delete tests, history is kept", async () => {
  const { project, suite } = await fixture();
  const [card, email] = suite.tests;
  await call("post", `/tests/${email.id}/comments`, "guest", {
    body: "Já testei.",
  }).expect(201);
  await call(
    "delete",
    `/tests/${email.id}`,
    "guest",
    undefined,
    email.version,
  ).expect(403);
  await call("delete", `/tests/${card.id}`, "member").expect(428);
  await call(
    "delete",
    `/tests/${card.id}`,
    "member",
    undefined,
    card.version,
  ).expect(204);
  await call(
    "delete",
    `/tests/${card.id}`,
    "member",
    undefined,
    card.version,
  ).expect(404);
  await call(
    "delete",
    `/tests/${email.id}`,
    "owner",
    undefined,
    email.version,
  ).expect(204);
  const added = (
    await call(
      "post",
      `/suites/${suite.id}/tests`,
      "owner",
      { title: "SMS", instructions: "", expectedResult: "" },
      (await call("get", `/suites/${suite.id}`)).body.version,
    ).expect(201)
  ).body;
  assert.equal(added.number, 3);
  assert.equal(added.position, 0);
  const current = (await call("get", `/suites/${suite.id}`)).body;
  assert.deepEqual(
    current.tests.map((test: any) => test.title),
    ["SMS"],
  );
  assert.equal(current.total, 1);
  const activity = (await call("get", `/suites/${suite.id}/activity`)).body;
  assert.deepEqual(
    activity
      .filter((item: any) => item.kind === "test_deleted")
      .map((item: any) => item.detail.number),
    [1, 2],
  );
  const guest = await notifications("guest");
  // The guest is a tester of the suite, so the new test is also announced.
  assert.deepEqual(
    guest.items.slice(0, 2).map((item: any) => item.kind),
    ["test_added", "test_deleted"],
  );
  assert.equal(guest.items[1].testDeleted, true);
  assert.equal(guest.items[1].detail.title, "Email");
  await call(
    "delete",
    `/suites/${suite.id}`,
    "member",
    undefined,
    current.version,
  ).expect(403);
  await call(
    "delete",
    `/suites/${suite.id}`,
    "owner",
    undefined,
    current.version,
  ).expect(204);
  await call("get", `/suites/${suite.id}`).expect(404);
  assert.equal(
    (await call("get", `/projects/${project.id}/suites`)).body.total,
    0,
  );
  assert.equal(
    (await call("get", `/projects/${project.id}/summary`)).body.total,
    0,
  );
  assert.deepEqual((await call("get", "/search?q=pagamentos")).body.suites, []);
  const member = await notifications("member");
  assert.equal(member.items[0].kind, "suite_deleted");
  assert.equal(member.items[0].suiteDeleted, true);
  const next = (
    await call("post", `/projects/${project.id}/suites`, "owner", {
      title: "Nova",
      description: "",
      tests: [],
    }).expect(201)
  ).body;
  assert.equal(next.number, 2);
});

test("suite and test edits notify the people involved, reordering does not", async () => {
  const { suite, members } = await fixture();
  const guestId = members.find(
    (member: any) => member.oid === identities.guest.oid,
  ).id;
  const [card, email] = suite.tests;
  await call("post", `/tests/${email.id}/comments`, "guest", {
    body: "Testado.",
  }).expect(201);
  await call("post", "/notifications/read-all", "member").expect(204);
  await call("post", "/notifications/read-all", "guest").expect(204);
  await call(
    "patch",
    `/suites/${suite.id}`,
    "owner",
    { title: "Pagamentos v2", description: "" },
    (await call("get", `/suites/${suite.id}`)).body.version,
  ).expect(200);
  for (const token of ["member", "guest"]) {
    const box = await notifications(token);
    assert.equal(box.items[0].kind, "suite_edited");
    assert.equal(box.items[0].suiteTitle, "Pagamentos v2");
  }
  const fresh = (await call("get", `/suites/${suite.id}`)).body.tests;
  await call(
    "patch",
    `/tests/${fresh[1].id}`,
    "owner",
    {
      title: fresh[1].title,
      instructions: fresh[1].instructions,
      expectedResult: fresh[1].expectedResult,
      position: 0,
    },
    fresh[1].version,
  ).expect(200);
  assert.equal((await notifications("guest")).unread, 1);
  const moved = (await call("get", `/suites/${suite.id}`)).body.tests;
  const target = moved.find((test: any) => test.id === email.id);
  await call(
    "patch",
    `/tests/${email.id}`,
    "owner",
    {
      title: target.title,
      instructions: "Verificar a caixa de entrada e o spam",
      expectedResult: target.expectedResult,
      assigneeId: guestId,
    },
    target.version,
  ).expect(200);
  const guest = await notifications("guest");
  assert.deepEqual(
    guest.items.slice(0, 2).map((item: any) => item.kind),
    ["assignment", "suite_edited"],
  );
  assert.equal(guest.unread, 2);
  const cardNow = (await call("get", `/suites/${suite.id}`)).body.tests.find(
    (test: any) => test.id === card.id,
  );
  await call(
    "patch",
    `/tests/${card.id}`,
    "owner",
    {
      title: "Cartão Visa",
      instructions: cardNow.instructions,
      expectedResult: cardNow.expectedResult,
    },
    cardNow.version,
  ).expect(200);
  const member = await notifications("member");
  assert.equal(member.items[0].kind, "test_edited");
  assert.equal(member.items[0].testTitle, "Cartão Visa");
});

test("Teams activity feed is sent after commit, on behalf of the actor, with deep links", async () => {
  const sent: { token: string | null; payload: any }[] = [];
  const feedApp = express();
  feedApp.use(
    "/api/v1",
    createApi(
      db,
      {
        ...authentication,
        async sendActivity(token, payload) {
          sent.push({ token, payload });
        },
      },
      { teamsAppId: "teams-app-id" },
    ),
  );
  const feed = (path: string, token: string, body: object) =>
    request(feedApp)
      .post(`/api/v1${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const settle = async (count: number) => {
    for (let attempt = 0; attempt < 50 && sent.length < count; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 50));
  };
  const { project, suite, members } = await fixture();
  assert.equal(sent.length, 0);
  const guestId = members.find(
    (member: any) => member.oid === identities.guest.oid,
  ).id;
  const testCase = suite.tests[0];
  await feed(`/tests/${testCase.id}/comments`, "owner", {
    body: "Ver isto",
    mentions: [identities.outsider.oid],
  }).expect(400);
  await feed(`/tests/${testCase.id}/comments`, "owner", {
    body: "@Convidada pode repetir?",
    mentions: [guestId],
  }).expect(201);
  await settle(2);
  assert.equal(sent.length, 2);
  const mention = sent.find((item) => item.payload.activityType === "mention")!;
  assert.equal(mention.token, "owner");
  assert.deepEqual(mention.payload.recipients, [
    {
      "@odata.type": "microsoft.graph.aadUserNotificationRecipient",
      userId: identities.guest.oid,
    },
  ]);
  assert.deepEqual(mention.payload.templateParameters, [
    { name: "item", value: "TC-1" },
  ]);
  assert.equal(mention.payload.previewText.content, "@Convidada pode repetir?");
  assert.equal(mention.payload.topic.source, "text");
  assert.equal(mention.payload.topic.value, "SU-01 · Pagamentos");
  const link = new URL(mention.payload.topic.webUrl);
  assert.equal(link.pathname, "/l/entity/teams-app-id/index0");
  const anchor = new URLSearchParams(
    JSON.parse(link.searchParams.get("context")!).subEntityId,
  );
  assert.equal(anchor.get("project"), project.id);
  assert.equal(anchor.get("suite"), suite.id);
  assert.equal(anchor.get("test"), testCase.id);
  assert.ok(anchor.get("activity"));
  const comment = sent.find((item) => item.payload.activityType === "comment")!;
  assert.deepEqual(
    comment.payload.recipients.map((recipient: any) => recipient.userId),
    [identities.member.oid],
  );
  const key = (
    await call("post", `/projects/${project.id}/keys`, "owner", {
      name: "Pipeline",
    }).expect(201)
  ).body.secret;
  const memberBefore = (await notifications("member")).items.length;
  const published = (
    await request(feedApp)
      .post(`/api/v1/projects/${project.id}/suites`)
      .set("Authorization", `Bearer ${key}`)
      .set("Idempotency-Key", "feed-1")
      .send({
        title: "Smoke",
        description: "",
        tests: ["A", "B", "C"].map((title) => ({
          title,
          instructions: "1. Abrir",
          expectedResult: "Funciona",
          assigneeEmail: identities.member.email,
        })),
      })
      .expect(201)
  ).body;
  await settle(4);
  // A new suite announces itself once; its tests and assignments do not notify.
  assert.equal(sent.length, 3);
  const memberAfter = (await notifications("member")).items;
  assert.deepEqual(
    memberAfter
      .slice(0, memberAfter.length - memberBefore)
      .map((item: any) => item.kind),
    ["suite_created"],
  );
  const created = sent[2];
  assert.equal(created.token, null);
  assert.equal(created.payload.activityType, "suiteCreated");
  assert.deepEqual(created.payload.templateParameters, [
    { name: "suite", value: "SU-02" },
  ]);
  assert.deepEqual(
    created.payload.recipients.map((recipient: any) => recipient.userId).sort(),
    [identities.owner.oid, identities.member.oid, identities.guest.oid].sort(),
  );
  // Adding a test to an existing suite does notify.
  await feed(`/suites/${published.id}/tests`, "owner", {
    title: "D",
    instructions: "",
    expectedResult: "Funciona",
    assigneeId: published.tests[0].assigneeId,
  })
    .set("If-Match", String(published.version))
    .expect(201);
  await settle(4);
  assert.deepEqual(
    sent.slice(3).map((item) => item.payload.activityType),
    ["assignment"],
  );
  assert.equal((await notifications("member")).items[0].kind, "assignment");
});

test("Teams manifest declares every activity type the server sends", async () => {
  const manifest = JSON.parse(
    await readFile("appPackage/manifest.json", "utf8"),
  );
  assert.deepEqual(
    Object.fromEntries(
      manifest.activities.activityTypes.map((item: any) => [
        item.type,
        item.templateText,
      ]),
    ),
    activityTypes,
  );
  assert.equal(manifest.staticTabs[0].entityId, "index0");
});

async function issueFixture() {
  const base = await fixture();
  const config = (
    await call("get", `/projects/${base.project.id}/issue-config`).expect(200)
  ).body;
  const ownerId = base.members.find(
    (member: any) => member.oid === identities.owner.oid,
  ).id;
  const status = (name: string) =>
    config.statuses.find((item: any) => item.name === name);
  return { ...base, config, ownerId, status };
}
const board = async (projectId: string) =>
  (await call("get", `/projects/${projectId}/issues?view=board`).expect(200))
    .body.items;

test("issues: default workflow, reporter is the creator and cannot be changed", async () => {
  const { project, config, ownerId, memberId, status } = await issueFixture();
  assert.deepEqual(
    config.statuses.map((item: any) => [item.name, item.category]),
    [
      ["Backlog", "todo"],
      ["Em análise", "todo"],
      ["A aguardar informação", "todo"],
      ["Em curso", "doing"],
      ["Para testar", "doing"],
      ["Resolvido", "done"],
      ["Fechado", "done"],
      ["Duplicado", "done"],
    ],
  );
  const created = (
    await call("post", `/projects/${project.id}/issues`, "member", {
      title: "Data de nascimento no perfil",
      description: "Campo **opcional**",
      priority: 2,
      estimate: 1.5,
    }).expect(201)
  ).body;
  assert.equal(created.number, 1);
  assert.equal(created.reporterId, memberId);
  assert.equal(created.reporterName, "João Costa");
  assert.equal(created.statusId, status("Backlog").id);
  assert.equal(created.estimate, 1.5);
  await call("post", `/projects/${project.id}/issues`, "owner", {
    title: "Forjar reporter",
    reporterId: ownerId,
  }).expect(400);
  await call(
    "patch",
    `/issues/${created.id}`,
    "owner",
    { reporterId: ownerId },
    created.version,
  ).expect(400);
  const edited = (
    await call(
      "patch",
      `/issues/${created.id}`,
      "owner",
      { title: "Data de nascimento (opcional)", deployedAt: "2026-08-04" },
      created.version,
    ).expect(200)
  ).body;
  assert.equal(edited.reporterId, memberId);
  assert.equal(edited.deployedAt, "2026-08-04");
  await call(
    "patch",
    `/issues/${created.id}`,
    "owner",
    { title: "Versão antiga" },
    created.version,
  ).expect(409);
  await call("get", `/issues/${created.id}`, "outsider").expect(404);
  await call("post", `/projects/${project.id}/issues`, "outsider", {
    title: "Fora",
  }).expect(404);
});

test("issues: modules, labels, assignees and self-assignment", async () => {
  const { project, ownerId, memberId } = await issueFixture();
  const module = (
    await call("post", `/projects/${project.id}/issue-modules`, "owner", {
      name: "Backoffice",
      color: "blue",
    }).expect(201)
  ).body;
  await call("post", `/projects/${project.id}/issue-modules`, "owner", {
    name: "backoffice",
  }).expect(409);
  await call("post", `/projects/${project.id}/issue-labels`, "member", {
    name: "Bug",
  }).expect(403);
  const label = (
    await call("post", `/projects/${project.id}/issue-labels`, "owner", {
      name: "Bug",
      color: "red",
    }).expect(201)
  ).body;
  const outsider = (await call("get", "/me", "outsider").expect(200)).body;
  await call("post", `/projects/${project.id}/issues`, "owner", {
    title: "Responsável de fora",
    assigneeIds: [outsider.id],
  }).expect(400);
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title: "Pop-ups configuráveis",
      moduleIds: [module.id],
      labelIds: [label.id],
      assigneeIds: [memberId],
    }).expect(201)
  ).body;
  assert.deepEqual(issue.moduleIds, [module.id]);
  assert.deepEqual(issue.labelIds, [label.id]);
  assert.deepEqual(
    issue.assignees.map((person: any) => person.id),
    [memberId],
  );
  const mine = (
    await call("post", `/issues/${issue.id}/assign-me`, "guest").expect(200)
  ).body;
  assert.equal(mine.assignees.length, 2);
  const replaced = (
    await call(
      "put",
      `/issues/${issue.id}/assignees`,
      "owner",
      { userIds: [ownerId, memberId] },
      mine.version,
    ).expect(200)
  ).body;
  assert.deepEqual(
    replaced.assignees.map((person: any) => person.id).sort(),
    [ownerId, memberId].sort(),
  );
  const left = (
    await call("delete", `/issues/${issue.id}/assign-me`, "member").expect(200)
  ).body;
  assert.deepEqual(
    left.assignees.map((person: any) => person.id),
    [ownerId],
  );
  const filtered = (
    await call(
      "get",
      `/projects/${project.id}/issues?module=${module.id}&label=${label.id}&assignee=me`,
    ).expect(200)
  ).body;
  assert.equal(filtered.total, 1);
  assert.equal(
    (await call("get", `/projects/${project.id}/issues?assignee=me`, "member"))
      .body.total,
    0,
  );
  // Deleted modules disappear from pickers and issues but stay in history.
  await call(
    "delete",
    `/issue-modules/${module.id}`,
    "owner",
    undefined,
    module.version,
  ).expect(204);
  assert.deepEqual(
    (await call("get", `/issues/${issue.id}`)).body.moduleIds,
    [],
  );
  const activity = (await call("get", `/issues/${issue.id}/activity`)).body;
  assert.deepEqual(
    activity.map((item: any) => item.kind),
    ["issue_created", "issue_assigned", "issue_assigned", "issue_assigned"],
  );
});

test("issues: board moves keep both columns contiguous", async () => {
  const { project, status } = await issueFixture();
  const create = async (title: string) =>
    (
      await call("post", `/projects/${project.id}/issues`, "owner", {
        title,
      }).expect(201)
    ).body;
  const a = await create("A");
  const b = await create("B");
  const c = await create("C");
  const doing = status("Em curso").id;
  const columns = async () => {
    const items = await board(project.id);
    const of = (statusId: string) =>
      items
        .filter((item: any) => item.statusId === statusId)
        .map((item: any) => [item.title, item.position]);
    return { backlog: of(status("Backlog").id), doing: of(doing) };
  };
  assert.deepEqual((await columns()).backlog, [
    ["A", 0],
    ["B", 1],
    ["C", 2],
  ]);
  await call(
    "patch",
    `/issues/${b.id}`,
    "member",
    { statusId: doing, position: 0 },
    b.version,
  ).expect(200);
  assert.deepEqual(await columns(), {
    backlog: [
      ["A", 0],
      ["C", 1],
    ],
    doing: [["B", 0]],
  });
  const fresh = (await call("get", `/issues/${c.id}`)).body;
  await call(
    "patch",
    `/issues/${c.id}`,
    "member",
    { position: 0 },
    fresh.version,
  ).expect(200);
  assert.deepEqual((await columns()).backlog, [
    ["C", 0],
    ["A", 1],
  ]);
  const activity = (await call("get", `/issues/${b.id}/activity`)).body;
  assert.deepEqual(activity.at(-1).detail, {
    from: "Backlog",
    to: "Em curso",
  });
  // Archiving leaves the column; restoring appends to it.
  const aNow = (await call("get", `/issues/${a.id}`)).body;
  await call(
    "post",
    `/issues/${a.id}/archive`,
    "member",
    undefined,
    aNow.version,
  ).expect(403);
  const archived = (
    await call(
      "post",
      `/issues/${a.id}/archive`,
      "owner",
      undefined,
      aNow.version,
    ).expect(200)
  ).body;
  assert.ok(archived.archivedAt);
  assert.deepEqual((await columns()).backlog, [["C", 0]]);
  await call(
    "patch",
    `/issues/${a.id}`,
    "owner",
    { title: "Arquivado" },
    archived.version,
  ).expect(409);
  await call("post", `/issues/${a.id}/comments`, "member", {
    body: "Ainda?",
  }).expect(409);
  assert.equal(
    (await call("get", `/projects/${project.id}/issues?archive=archived`)).body
      .total,
    1,
  );
  await call(
    "post",
    `/issues/${a.id}/restore`,
    "owner",
    undefined,
    archived.version,
  ).expect(200);
  assert.deepEqual((await columns()).backlog, [
    ["C", 0],
    ["A", 1],
  ]);
});

test("issues: the status filter accepts several statuses combined with OR", async () => {
  const { project, status } = await issueFixture();
  const create = async (title: string, statusName: string) =>
    (
      await call("post", `/projects/${project.id}/issues`, "owner", {
        title,
        statusId: status(statusName).id,
      }).expect(201)
    ).body;
  await create("A", "Backlog");
  await create("B", "Em curso");
  await create("C", "Resolvido");
  const titles = async (filter: string) =>
    (
      await call(
        "get",
        `/projects/${project.id}/issues?status=${filter}&sort=title`,
      ).expect(200)
    ).body.items.map((item: any) => item.title);
  assert.deepEqual(
    await titles(`${status("Backlog").id},${status("Em curso").id}`),
    ["A", "B"],
  );
  assert.deepEqual(await titles(status("Resolvido").id), ["C"]);
  assert.deepEqual(await titles(`open,${status("Resolvido").id}`), [
    "A",
    "B",
    "C",
  ]);
  assert.deepEqual(await titles("all"), ["A", "B", "C"]);
  await call(
    "get",
    `/projects/${project.id}/issues?status=${status("Backlog").id},nope`,
  ).expect(400);
});
test("issues: owners archive by status rule and restore several at once", async () => {
  const { project, status } = await issueFixture();
  const create = async (title: string, statusName: string) =>
    (
      await call("post", `/projects/${project.id}/issues`, "owner", {
        title,
        statusId: status(statusName).id,
      }).expect(201)
    ).body;
  const open = await create("Aberto", "Backlog");
  const duplicate1 = await create("Repetido 1", "Duplicado");
  const duplicate2 = await create("Repetido 2", "Duplicado");
  const resolved = await create("Resolvido", "Resolvido");
  const rule = (statusIds: string[], token = "owner") =>
    call("post", `/projects/${project.id}/issues/archive`, token, {
      statusIds,
    });
  await rule([status("Duplicado").id], "member").expect(403);
  // Rules only take finished work: open statuses are refused.
  await rule([status("Backlog").id]).expect(400);
  await rule([]).expect(400);
  assert.deepEqual((await rule([status("Duplicado").id]).expect(200)).body, {
    archived: 2,
  });
  const titles = async (archive: string) =>
    (
      await call(
        "get",
        `/projects/${project.id}/issues?archive=${archive}&sort=title`,
      ).expect(200)
    ).body.items.map((item: any) => item.title);
  assert.deepEqual(await titles("active"), ["Aberto", "Resolvido"]);
  assert.deepEqual(await titles("archived"), ["Repetido 1", "Repetido 2"]);
  const activity = (await call("get", `/issues/${duplicate1.id}/activity`))
    .body;
  assert.deepEqual(activity.at(-1).kind, "issue_archived");
  assert.deepEqual(activity.at(-1).detail, { rule: "Duplicado" });
  // Running the same rule again is harmless.
  assert.deepEqual((await rule([status("Duplicado").id]).expect(200)).body, {
    archived: 0,
  });
  assert.deepEqual(
    (await rule([status("Resolvido").id, status("Fechado").id]).expect(200))
      .body,
    { archived: 1 },
  );

  const current = async (issue: any) =>
    (await call("get", `/issues/${issue.id}`).expect(200)).body;
  const [d1, d2, r] = await Promise.all(
    [duplicate1, duplicate2, resolved].map(current),
  );
  const restore = (issues: object[], token = "owner") =>
    call("post", `/projects/${project.id}/issues/restore`, token, { issues });
  await restore([{ id: d1.id, version: d1.version }], "member").expect(403);
  // A stale version refuses the whole batch.
  await restore([
    { id: d1.id, version: d1.version },
    { id: d2.id, version: d2.version - 1 },
  ]).expect(409);
  assert.deepEqual(await titles("active"), ["Aberto"]);
  // Already active issues are skipped.
  assert.deepEqual(
    (
      await restore([
        { id: d1.id, version: d1.version },
        { id: d2.id, version: d2.version },
        { id: open.id, version: open.version },
      ]).expect(200)
    ).body,
    { restored: 2 },
  );
  assert.deepEqual(await titles("archived"), ["Resolvido"]);
  assert.equal((await current(d2)).archivedAt, null);
  const restoredActivity = (await call("get", `/issues/${d2.id}/activity`))
    .body;
  assert.equal(restoredActivity.at(-1).kind, "issue_restored");
  // Restored issues rejoin the end of their board column in order.
  const column = (await board(project.id))
    .filter((item: any) => item.statusId === status("Duplicado").id)
    .map((item: any) => [item.title, item.position]);
  assert.deepEqual(column, [
    ["Repetido 1", 0],
    ["Repetido 2", 1],
  ]);
  const other = await fixture();
  await restore([{ id: r.id, version: r.version }], "owner").expect(200);
  await call("post", `/projects/${other.project.id}/issues/restore`, "owner", {
    issues: [{ id: d1.id, version: d1.version + 2 }],
  }).expect(404);
});
test("issues: owners archive and delete selected issues in one transaction", async () => {
  const { project, status, memberId } = await issueFixture();
  const create = async (title: string, token = "owner") =>
    (
      await call("post", `/projects/${project.id}/issues`, token, {
        title,
        statusId: status("Backlog").id,
        assigneeIds: [memberId],
      }).expect(201)
    ).body;
  const a = await create("A");
  const b = await create("B");
  const c = await create("C", "member");
  await create("D");
  const pick = (...issues: any[]) =>
    issues.map((issue) => ({ id: issue.id, version: issue.version }));
  const current = async (issue: any) =>
    (await call("get", `/issues/${issue.id}`).expect(200)).body;
  // Bulk actions are for owners, even on the member's own issues.
  await call("post", `/projects/${project.id}/issues/delete`, "member", {
    issues: pick(c),
  }).expect(403);
  await call("post", `/projects/${project.id}/issues/archive`, "member", {
    issues: pick(c),
  }).expect(403);
  await call("post", `/projects/${project.id}/issues/delete`, "owner", {
    issues: [],
  }).expect(400);
  assert.deepEqual(
    (
      await call("post", `/projects/${project.id}/issues/archive`, "owner", {
        issues: pick(a, await current(b)),
      }).expect(200)
    ).body,
    { archived: 2 },
  );
  // Board positions close up behind the archived issues.
  assert.deepEqual(
    (await board(project.id)).map((item: any) => [item.title, item.position]),
    [
      ["C", 0],
      ["D", 1],
    ],
  );
  // A stale version refuses the whole deletion.
  const archivedA = await current(a);
  await call("post", `/projects/${project.id}/issues/delete`, "owner", {
    issues: [...pick(archivedA), { id: c.id, version: c.version + 5 }],
  }).expect(409);
  await call("get", `/issues/${a.id}`).expect(200);
  // Archived and active issues are deleted together and notify the people involved.
  assert.deepEqual(
    (
      await call("post", `/projects/${project.id}/issues/delete`, "owner", {
        issues: pick(archivedA, c),
      }).expect(200)
    ).body,
    { deleted: 2 },
  );
  await call("get", `/issues/${a.id}`).expect(404);
  await call("get", `/issues/${c.id}`).expect(404);
  assert.deepEqual(
    (await board(project.id)).map((item: any) => [item.title, item.position]),
    [["D", 0]],
  );
  const deletedNotes = (
    await call("get", "/notifications", "member").expect(200)
  ).body.items.filter((item: any) => item.kind === "issue_deleted");
  assert.deepEqual(deletedNotes.map((item: any) => item.detail.title).sort(), [
    "A",
    "C",
  ]);
  // Deleted issues can no longer be picked.
  await call("post", `/projects/${project.id}/issues/delete`, "owner", {
    issues: pick(a),
  }).expect(404);
});
test("suites: owners archive, restore and delete selected suites in bulk", async () => {
  const { project, suite } = await fixture();
  const second = (
    await call("post", `/projects/${project.id}/suites`, "owner", {
      title: "Segunda",
      tests: [{ title: "T" }],
    }).expect(201)
  ).body;
  const pick = (...suites: any[]) =>
    suites.map((item) => ({ id: item.id, version: item.version }));
  const current = async (item: any) =>
    (await call("get", `/suites/${item.id}`).expect(200)).body;
  const bulk = (action: string, suites: object[], token = "owner") =>
    call("post", `/projects/${project.id}/suites/${action}`, token, {
      suites,
    });
  await bulk("archive", pick(suite), "member").expect(403);
  await bulk("delete", pick(suite), "member").expect(403);
  assert.deepEqual(
    (await bulk("archive", pick(suite, second)).expect(200)).body,
    { archived: 2 },
  );
  const titles = async (archive: string) =>
    (
      await call(
        "get",
        `/projects/${project.id}/suites?archive=${archive}`,
      ).expect(200)
    ).body.items.map((item: any) => item.title);
  assert.deepEqual(await titles("active"), []);
  const [archivedSuite, archivedSecond] = await Promise.all(
    [suite, second].map(current),
  );
  // Results and tests survive; a stale version refuses the batch.
  assert.equal(archivedSuite.tests.length, 2);
  await bulk("restore", [
    ...pick(archivedSuite),
    { id: second.id, version: archivedSecond.version - 1 },
  ]).expect(409);
  assert.deepEqual(
    (await bulk("restore", pick(archivedSuite)).expect(200)).body,
    { restored: 1 },
  );
  assert.deepEqual(await titles("active"), ["Pagamentos"]);
  const kinds = (
    await call("get", `/suites/${suite.id}/activity`).expect(200)
  ).body.map((item: any) => item.kind);
  assert.ok(
    kinds.includes("suite_archived") && kinds.includes("suite_restored"),
  );
  // Deleting mixes active and archived suites.
  assert.deepEqual(
    (
      await bulk("delete", pick(await current(suite), archivedSecond)).expect(
        200,
      )
    ).body,
    { deleted: 2 },
  );
  await call("get", `/suites/${suite.id}`).expect(404);
  assert.deepEqual(await titles("all"), []);
  const notes = (
    await call("get", "/notifications", "member").expect(200)
  ).body.items.filter((item: any) => item.kind === "suite_deleted");
  assert.equal(notes.length, 2);
});
test("issues: statuses are configurable and in-use statuses need a destination", async () => {
  const { project, status } = await issueFixture();
  const review = status("Em análise");
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title: "Em revisão",
      statusId: review.id,
    }).expect(201)
  ).body;
  const added = (
    await call("post", `/projects/${project.id}/issue-statuses`, "owner", {
      name: "Em produção",
      color: "green",
      category: "done",
      position: 0,
    }).expect(201)
  ).body;
  assert.equal(added.position, 0);
  const config = (await call("get", `/projects/${project.id}/issue-config`))
    .body;
  assert.equal(config.statuses[0].name, "Em produção");
  assert.equal(config.statuses[1].name, "Backlog");
  await call(
    "delete",
    `/issue-statuses/${review.id}`,
    "owner",
    undefined,
    review.version,
  ).expect(409);
  await call(
    "delete",
    `/issue-statuses/${review.id}?moveTo=${status("Em curso").id}`,
    "owner",
    undefined,
    review.version,
  ).expect(204);
  assert.equal(
    (await call("get", `/issues/${issue.id}`)).body.statusId,
    status("Em curso").id,
  );
  const renamed = (
    await call(
      "patch",
      `/issue-statuses/${added.id}`,
      "owner",
      { name: "Em produção", color: "teal", category: "done", position: 3 },
      added.version,
    ).expect(200)
  ).body;
  assert.equal(renamed.color, "teal");
  const after = (await call("get", `/projects/${project.id}/issue-config`))
    .body;
  assert.deepEqual(
    after.statuses.map((item: any) => [item.name, item.position]),
    [
      ["Backlog", 0],
      ["A aguardar informação", 1],
      ["Em curso", 2],
      ["Em produção", 3],
      ["Para testar", 4],
      ["Resolvido", 5],
      ["Fechado", 6],
      ["Duplicado", 7],
    ],
  );
  // The last "todo" status cannot be removed or recategorised.
  for (const item of after.statuses.filter(
    (row: any) => row.category === "todo" && row.name !== "Backlog",
  ))
    await call(
      "delete",
      `/issue-statuses/${item.id}`,
      "owner",
      undefined,
      item.version,
    ).expect(204);
  const backlog = after.statuses.find((row: any) => row.name === "Backlog");
  await call(
    "patch",
    `/issue-statuses/${backlog.id}`,
    "owner",
    { name: "Backlog", color: "gray", category: "doing" },
    backlog.version,
  ).expect(409);
});

test("issues: duplicate, delete permissions, comments and notifications", async () => {
  const { project, memberId, status } = await issueFixture();
  const guestMember = (await call("get", "/me", "guest")).body;
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "guest", {
      title: "Talão de oferta",
      priority: 3,
      assigneeIds: [memberId],
    }).expect(201)
  ).body;
  // Creating with an assignee notifies only that assignee.
  assert.deepEqual(
    (await notifications("member")).items.map((item: any) => [
      item.kind,
      item.issueNumber,
    ]),
    [
      ["issue_assignment", 1],
      ["suite_created", null],
    ],
  );
  assert.equal(
    (await notifications("owner")).items.filter((item: any) =>
      item.kind.startsWith("issue"),
    ).length,
    0,
  );
  await call("post", `/issues/${issue.id}/comments`, "owner", {
    body: "@Convidada pode confirmar?",
    mentions: [guestMember.id],
  }).expect(201);
  const guest = (await notifications("guest")).items;
  assert.deepEqual(
    guest.slice(0, 1).map((item: any) => [item.kind, item.detail.excerpt]),
    [["issue_mention", "@Convidada pode confirmar?"]],
  );
  assert.equal((await notifications("member")).items[0].kind, "issue_comment");
  const moved = (
    await call(
      "patch",
      `/issues/${issue.id}`,
      "owner",
      { statusId: status("Para testar").id },
      (await call("get", `/issues/${issue.id}`)).body.version,
    ).expect(200)
  ).body;
  const statusNotes = (await notifications("guest")).items.filter(
    (item: any) => item.kind === "issue_status",
  );
  assert.equal(statusNotes.length, 1);
  assert.equal(statusNotes[0].detail.status, "Para testar");
  const copy = (
    await call("post", `/issues/${issue.id}/duplicate`, "member").expect(201)
  ).body;
  assert.equal(copy.number, 2);
  assert.equal(copy.title, "Talão de oferta (cópia)");
  assert.equal(copy.reporterId, memberId);
  assert.equal(copy.statusId, status("Backlog").id);
  assert.equal(copy.priority, 3);
  // Only owners and the reporter delete; numbers are never reused.
  await call(
    "delete",
    `/issues/${issue.id}`,
    "member",
    undefined,
    moved.version,
  ).expect(403);
  await call(
    "delete",
    `/issues/${issue.id}`,
    "guest",
    undefined,
    moved.version,
  ).expect(204);
  await call("get", `/issues/${issue.id}`).expect(404);
  const deleted = (await notifications("member")).items[0];
  assert.equal(deleted.kind, "issue_deleted");
  assert.equal(deleted.issueDeleted, true);
  assert.equal(deleted.detail.title, "Talão de oferta");
  const third = (
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title: "Novo",
    }).expect(201)
  ).body;
  assert.equal(third.number, 3);
  const search = (await call("get", "/search?q=IS-3")).body;
  assert.deepEqual(
    search.issues.map((item: any) => item.title),
    ["Novo"],
  );
  assert.equal(
    (await call("get", "/search?q=pode confirmar")).body.comments.length,
    0,
  );
});

test("issues: attachments on comments are scoped to the issue", async () => {
  const { project, suite } = await issueFixture();
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title: "Com anexo",
    }).expect(201)
  ).body;
  const file = (
    await request(app)
      .post(`/api/v1/issues/${issue.id}/attachments`)
      .set("Authorization", "Bearer member")
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", "erro.txt")
      .send(Buffer.from("stack trace"))
      .expect(201)
  ).body;
  await call("get", `/attachments/${file.id}`, "owner").expect(404);
  await call("post", `/suites/${suite.id}/comments`, "member", {
    body: "Noutro sítio",
    attachmentIds: [file.id],
  }).expect(400);
  await call("post", `/issues/${issue.id}/comments`, "member", {
    body: "Ver anexo",
    attachmentIds: [file.id],
  }).expect(201);
  const activity = (await call("get", `/issues/${issue.id}/activity`)).body;
  assert.equal(activity.at(-1).attachments[0].fileName, "erro.txt");
  await call("get", `/attachments/${file.id}`, "owner").expect(200);
  await call("get", `/attachments/${file.id}`, "outsider").expect(404);
});

test("issues: spreadsheet import maps people and values, is atomic, retry-safe and silent", async () => {
  const { project, memberId, ownerId, status } = await issueFixture();
  const before = (await notifications("member")).items.length;
  const payload = {
    fileName: "Testes - Projeto Demo.csv",
    newStatuses: [
      { key: "TBR", name: "TBR", category: "doing" },
      { key: "Resolvido", name: "resolvido", category: "done" },
    ],
    newModules: [
      { key: "frontend", name: "Frontend" },
      { key: "mobile", name: "Mobile" },
    ],
    newLabels: [{ key: "melhoria", name: "Melhoria" }],
    rows: [
      {
        externalRef: "1",
        title: "Data de nascimento opcional",
        description: "é preciso colocar a data de nascimento",
        status: "Resolvido",
        priority: 2,
        estimate: 0.5,
        reportedAt: "2024-08-04T00:00:00.000Z",
        deployedAt: "2026-08-04",
        reporterId: memberId,
        assigneeIds: [ownerId, memberId],
        modules: ["frontend", "mobile"],
        labels: ["melhoria"],
        comments: ["**Obs DSI** (importado)\n\no campo não existe"],
      },
      {
        externalRef: "2",
        title: "Pop-ups",
        description: "É preciso ter pop-ups",
        status: "TBR",
        reporterNote: "Reportado originalmente por cmendes",
        modules: ["frontend"],
      },
    ],
  };
  const send = (body: object, key = "import-1", token = "owner") =>
    request(app)
      .post(`/api/v1/projects/${project.id}/issues/import`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(body);
  await send(payload, "import-1", "member").expect(403);
  // A bad row rolls everything back.
  await send(
    {
      ...payload,
      rows: [...payload.rows, { title: "Sem estado", status: "Inexistente" }],
    },
    "broken",
  ).expect(400);
  assert.equal(
    (await call("get", `/projects/${project.id}/issues`)).body.total,
    0,
  );
  const result = (await send(payload).expect(201)).body;
  assert.deepEqual(result, {
    created: 2,
    skipped: [],
    statuses: 1,
    modules: 2,
    labels: 1,
  });
  assert.deepEqual((await send(payload).expect(200)).body, result);
  await send({ ...payload, fileName: "outro.csv" }).expect(409);
  const again = (await send(payload, "import-2").expect(201)).body;
  assert.equal(again.created, 0);
  assert.deepEqual(
    again.skipped.map((item: any) => item.externalRef),
    ["1", "2"],
  );
  // Deleted issues no longer count as imported, so a corrected sheet can be imported again.
  const imported = (
    await call("get", `/projects/${project.id}/issues?sort=number`)
  ).body.items;
  await call("post", `/projects/${project.id}/issues/delete`, "owner", {
    issues: imported
      .filter((item: any) => item.externalRef === "2")
      .map((item: any) => ({ id: item.id, version: item.version })),
  }).expect(200);
  const reimport = (await send(payload, "import-3").expect(201)).body;
  assert.equal(reimport.created, 1);
  assert.deepEqual(
    reimport.skipped.map((item: any) => item.externalRef),
    ["1"],
  );
  const list = (await call("get", `/projects/${project.id}/issues?sort=number`))
    .body.items;
  const [second, first] = list;
  assert.equal(first.reporterId, memberId);
  assert.equal(first.statusId, status("Resolvido").id);
  assert.equal(first.reportedAt, "2024-08-04T00:00:00.000Z");
  assert.equal(first.deployedAt, "2026-08-04");
  assert.equal(first.moduleIds.length, 2);
  assert.equal(first.comments, 1);
  assert.equal(first.assignees.length, 2);
  assert.equal(second.reporterId, ownerId);
  assert.equal(second.reporterNote, "Reportado originalmente por cmendes");
  const config = (await call("get", `/projects/${project.id}/issue-config`))
    .body;
  assert.ok(config.statuses.some((item: any) => item.name === "TBR"));
  assert.equal(
    config.statuses.filter((item: any) => item.name === "Resolvido").length,
    1,
  );
  assert.equal((await notifications("member")).items.length, before);
});

test("issues: projects without soft delete remove deleted issues for good and reuse their numbers", async () => {
  const project = await createProject({
    name: "Sem histórico",
    issueSoftDelete: false,
  });
  assert.equal(project.issueSoftDelete, false);
  // The choice is made at creation only.
  await call(
    "patch",
    `/projects/${project.id}`,
    "owner",
    {
      name: "Sem histórico",
      issueSoftDelete: true,
    },
    project.version,
  ).expect(400);
  await call("post", `/projects/${project.id}/members`, "owner", {
    oid: identities.member.oid,
  }).expect(201);
  const memberId = (
    await call("get", `/projects/${project.id}/members`)
  ).body.find((member: any) => member.oid === identities.member.oid).id;
  const create = async (title: string) =>
    (
      await call("post", `/projects/${project.id}/issues`, "owner", {
        title,
        assigneeIds: [memberId],
      }).expect(201)
    ).body;
  const first = await create("Primeiro");
  const second = await create("Segundo");
  await call("post", `/issues/${first.id}/comments`, "member", {
    body: "Comentário",
  }).expect(201);
  await call(
    "delete",
    `/issues/${second.id}`,
    "owner",
    undefined,
    second.version,
  ).expect(204);
  const current = (await call("get", `/issues/${first.id}`).expect(200)).body;
  await call("post", `/projects/${project.id}/issues/delete`, "owner", {
    issues: [{ id: current.id, version: current.version }],
  }).expect(200);
  for (const table of [
    "issues",
    "activities",
    "notifications",
    "issue_assignees",
  ])
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE ${table === "issues" ? "id" : "issue_id"} = ANY($1::uuid[])`,
          [[first.id, second.id]],
        )
      ).rows[0].n,
      0,
      table,
    );
  // The assignee still learns about the deletion, without a link to the removed issue.
  const deleted = (await notifications("member")).items.filter(
    (item: any) =>
      item.kind === "issue_deleted" && item.projectId === project.id,
  );
  assert.equal(deleted.length, 2);
  assert.ok(deleted.every((item: any) => item.issueId === null));
  assert.equal((await create("Novo")).number, 1);
});

test("issues: per-user preferences", async () => {
  await call("get", "/me/preferences", "member").expect(200, {});
  await call("put", "/me/preferences/issues.columns", "member", {
    value: ["id", "title", "modules"],
  }).expect(200);
  await call("put", "/me/preferences/other", "member", {
    value: "x",
  }).expect(400);
  assert.deepEqual((await call("get", "/me/preferences", "member")).body, {
    "issues.columns": ["id", "title", "modules"],
  });
  assert.deepEqual((await call("get", "/me/preferences", "owner")).body, {});
});

test("issues: each person keeps their own board columns per project", async () => {
  const { project, status } = await issueFixture();
  const key = `/me/preferences/issues.board.${project.id}`;
  const layout = {
    order: [status("Em curso").id, status("Backlog").id],
    hidden: [status("Fechado").id, status("Duplicado").id],
  };
  await call("put", key, "member", { value: layout }).expect(200);
  // Read-only members arrange their own view too.
  await call("post", `/projects/${project.id}/members`, "owner", {
    oid: identities.guest.oid,
    role: "viewer",
  }).expect(201);
  await call("put", key, "guest", { value: layout }).expect(200);
  await call("put", key, "member", {
    value: { order: ["not-a-status"], hidden: [] },
  }).expect(400);
  await call("put", key, "member", { value: ["a"] }).expect(400);
  // Only for projects the person can open.
  await call("put", key, "outsider", { value: layout }).expect(404);
  await call(
    "put",
    "/me/preferences/issues.board.00000000-0000-4000-8000-000000000000",
    "member",
    { value: layout },
  ).expect(404);
  assert.deepEqual(
    (await call("get", "/me/preferences", "member")).body[
      `issues.board.${project.id}`
    ],
    layout,
  );
  assert.equal(
    (await call("get", "/me/preferences", "owner")).body[
      `issues.board.${project.id}`
    ],
    undefined,
  );
});

test("issues: search by bare number, IS-n or #n, exact number first", async () => {
  const { project } = await issueFixture();
  for (const title of ["Primeiro", "Erro 2 no checkout", "Terceiro"])
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title,
    }).expect(201);
  const list = async (q: string) =>
    (
      await call(
        "get",
        `/projects/${project.id}/issues?q=${encodeURIComponent(q)}`,
      ).expect(200)
    ).body.items.map((item: any) => item.number);
  // "2" finds IS-2 first, then other issues mentioning 2 in the text.
  assert.deepEqual(await list("2"), [2]);
  assert.deepEqual(await list("3"), [3]);
  assert.deepEqual(await list("#1"), [1]);
  assert.deepEqual(await list("IS-2"), [2]);
  assert.deepEqual(await list("is3"), [3]);
  await call("post", `/projects/${project.id}/issues`, "owner", {
    title: "Pedido 1 urgente",
  }).expect(201);
  assert.deepEqual(await list("1"), [1, 4]);
  assert.deepEqual(await list("IS-1"), [1]);
  const global = async (q: string) =>
    (
      await call("get", `/search?q=${encodeURIComponent(q)}`).expect(200)
    ).body.issues.map((item: any) => item.number);
  assert.deepEqual(await global("1"), [1, 4]);
  assert.deepEqual(await global("3"), [3]);
  assert.deepEqual(await global("IS-4"), [4]);
  await call("get", "/search?q=a").expect(400);
});

test("members: read-only viewers can see but not change anything nor be assigned", async () => {
  const { project, suite, memberId } = await fixture();
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title: "Com responsável",
      assigneeIds: [memberId],
    }).expect(201)
  ).body;
  const owner = (await call("get", "/me")).body;
  await call("patch", `/projects/${project.id}/members/${owner.id}`, "owner", {
    role: "viewer",
  }).expect(409);
  await call("patch", `/projects/${project.id}/members/${memberId}`, "member", {
    role: "viewer",
  }).expect(403);
  await call("patch", `/projects/${project.id}/members/${memberId}`, "owner", {
    role: "viewer",
  }).expect(204);
  // Becoming read-only releases active assignments, with history.
  assert.equal(
    (await call("get", `/suites/${suite.id}`)).body.tests[0].assigneeId,
    null,
  );
  assert.deepEqual(
    (await call("get", `/issues/${issue.id}`)).body.assignees,
    [],
  );
  const role = (await call("get", `/projects/${project.id}/members`)).body.find(
    (item: any) => item.id === memberId,
  ).role;
  assert.equal(role, "viewer");
  // Reading still works.
  assert.equal(
    (await call("get", "/projects", "member")).body[0].role,
    "viewer",
  );
  await call("get", `/projects/${project.id}/issues`, "member").expect(200);
  await call("get", `/suites/${suite.id}`, "member").expect(200);
  // Every change is refused.
  const testCase = (await call("get", `/suites/${suite.id}`)).body.tests[0];
  await call("post", `/projects/${project.id}/issues`, "member", {
    title: "Não",
  }).expect(403);
  await call("post", `/issues/${issue.id}/comments`, "member", {
    body: "Não",
  }).expect(403);
  await call("post", `/issues/${issue.id}/assign-me`, "member").expect(403);
  await call("post", `/issues/${issue.id}/duplicate`, "member").expect(403);
  await call("post", `/tests/${testCase.id}/comments`, "member", {
    body: "Não",
  }).expect(403);
  await call(
    "post",
    `/tests/${testCase.id}/result`,
    "member",
    { status: "approved" },
    testCase.version,
  ).expect(403);
  await call("post", `/suites/${suite.id}/duplicate`, "member").expect(403);
  await call("post", `/projects/${project.id}/suites`, "member", {
    title: "Não",
  }).expect(403);
  // Nobody can assign work to a viewer.
  await call("post", `/projects/${project.id}/issues`, "owner", {
    title: "Para o leitor",
    assigneeIds: [memberId],
  }).expect(400);
  await call(
    "put",
    `/issues/${issue.id}/assignees`,
    "owner",
    { userIds: [memberId] },
    (await call("get", `/issues/${issue.id}`)).body.version,
  ).expect(400);
  // Back to member: editing works again.
  await call("patch", `/projects/${project.id}/members/${memberId}`, "owner", {
    role: "member",
  }).expect(204);
  await call("post", `/issues/${issue.id}/assign-me`, "member").expect(200);
});

test("members: temporary blocks hide the project until lifted or expired", async () => {
  const { project, memberId } = await fixture();
  const owner = (await call("get", "/me")).body;
  await call(
    "post",
    `/projects/${project.id}/members/${owner.id}/block`,
    "owner",
    {},
  ).expect(409);
  await call(
    "post",
    `/projects/${project.id}/members/${memberId}/block`,
    "member",
    {},
  ).expect(403);
  await call(
    "post",
    `/projects/${project.id}/members/${memberId}/block`,
    "owner",
    { until: "2020-01-01T00:00:00.000Z" },
  ).expect(400);
  await call(
    "post",
    `/projects/${project.id}/members/${memberId}/block`,
    "owner",
    {},
  ).expect(204);
  const listed = (
    await call("get", `/projects/${project.id}/members`)
  ).body.find((item: any) => item.id === memberId);
  assert.ok(listed.blockedAt);
  assert.equal(listed.blockedUntil, null);
  assert.deepEqual((await call("get", "/projects", "member")).body, []);
  await call("get", `/projects/${project.id}/suites`, "member").expect(403);
  assert.equal(
    (await call("get", "/search?q=pagamentos", "member")).body.suites.length,
    0,
  );
  // No notifications are written while blocked (and existing ones are hidden).
  assert.equal((await notifications("member")).items.length, 0);
  const stored = async () =>
    Number(
      (
        await engine.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1",
          [memberId],
        )
      ).rows[0].count,
    );
  const before = await stored();
  await call("post", `/projects/${project.id}/issues`, "owner", {
    title: "Durante o bloqueio",
    assigneeIds: [memberId],
  }).expect(201);
  await call(
    "post",
    `/projects/${project.id}/members/${memberId}/unblock`,
    "owner",
  ).expect(204);
  assert.equal(await stored(), before);
  assert.ok((await notifications("member")).items.length > 0);
  assert.equal((await call("get", "/projects", "member")).body.length, 1);
  // A dated block ends by itself.
  const until = new Date(Date.now() + 60_000).toISOString();
  await call(
    "post",
    `/projects/${project.id}/members/${memberId}/block`,
    "owner",
    { until },
  ).expect(204);
  await call("get", `/projects/${project.id}/suites`, "member").expect(403);
  await engine.query(
    "UPDATE project_members SET blocked_until=now() - interval '1 minute' WHERE user_id=$1",
    [memberId],
  );
  await call("get", `/projects/${project.id}/suites`, "member").expect(200);
  assert.equal(
    (await call("get", `/projects/${project.id}/members`)).body.find(
      (item: any) => item.id === memberId,
    ).blockedAt,
    null,
  );
});
test("discussions: replies, resolution and counts on tests", async () => {
  const { project, suite, members } = await fixture();
  const [card, email] = suite.tests;
  await call("post", `/tests/${card.id}/comments`, "owner", {
    body: "Comentário simples",
  }).expect(201);
  const root = (
    await call("post", `/tests/${card.id}/comments`, "member", {
      body: "Falha no Safari?",
      discussion: true,
    }).expect(201)
  ).body.id;
  // A reply cannot open another discussion, and only discussions take replies.
  await call("post", `/tests/${card.id}/comments`, "guest", {
    body: "Sim",
    discussion: true,
    replyTo: root,
  }).expect(400);
  const plain = (
    await call("get", `/suites/${suite.id}/activity?testId=${card.id}`)
  ).body.find((item: any) => item.body === "Comentário simples");
  assert.equal(plain.discussion, false);
  await call("post", `/tests/${card.id}/comments`, "guest", {
    body: "Resposta",
    replyTo: plain.id,
  }).expect(404);
  // Replies stay on the discussion's own test.
  await call("post", `/tests/${email.id}/comments`, "guest", {
    body: "Noutro teste",
    replyTo: root,
  }).expect(404);
  await call("post", `/tests/${card.id}/comments`, "guest", {
    body: "Sim, na versão 17.",
    replyTo: root,
  }).expect(201);
  const thread = (
    await call("get", `/suites/${suite.id}/activity?testId=${card.id}`)
  ).body.filter((item: any) => item.id === root || item.replyTo === root);
  assert.deepEqual(
    thread.map((item: any) => [item.actorName, item.discussion, item.replyTo]),
    [
      ["João Costa", true, null],
      ["Convidada", false, root],
    ],
  );
  // The discussion author hears about replies.
  const reply = (await notifications("member")).items[0];
  assert.deepEqual(
    [reply.kind, reply.detail.reply, reply.detail.excerpt],
    ["comment", true, "Sim, na versão 17."],
  );
  const counts = async () =>
    (await call("get", `/suites/${suite.id}`)).body.tests.map(
      (test: any) => test.discussions,
    );
  assert.deepEqual(await counts(), [
    { total: 1, resolved: 0 },
    { total: 0, resolved: 0 },
  ]);
  const path = `/suites/${suite.id}/discussions/${root}`;
  await call("patch", path, "outsider", { resolved: true }).expect(404);
  await call("patch", `/suites/${suite.id}/discussions/${plain.id}`, "owner", {
    resolved: true,
  }).expect(404);
  const resolved = (
    await call("patch", path, "guest", { resolved: true }).expect(200)
  ).body;
  assert.equal(resolved.resolvedByName, "Convidada");
  assert.ok(resolved.resolvedAt);
  // Resolving again keeps who resolved it first.
  const again = (
    await call("patch", path, "owner", { resolved: true }).expect(200)
  ).body;
  assert.deepEqual(
    [again.resolvedByName, again.resolvedAt],
    [resolved.resolvedByName, resolved.resolvedAt],
  );
  assert.deepEqual((await counts())[0], { total: 1, resolved: 1 });
  const reopened = (
    await call("patch", path, "member", { resolved: false }).expect(200)
  ).body;
  assert.deepEqual(
    [reopened.resolvedAt, reopened.resolvedByName],
    [null, null],
  );
  assert.deepEqual((await counts())[0], { total: 1, resolved: 0 });
  // Viewers read discussions but cannot resolve them.
  const guestMembership = members.find(
    (member: any) => member.oid === identities.guest.oid,
  );
  await call(
    "patch",
    `/projects/${project.id}/members/${guestMembership.id}`,
    "owner",
    { role: "viewer" },
  ).expect(204);
  await call("patch", path, "guest", { resolved: true }).expect(403);
  await call("post", `/tests/${card.id}/comments`, "guest", {
    body: "Leitura",
    replyTo: root,
  }).expect(403);
});
test("discussions: suite discussions notify their participants", async () => {
  const { suite } = await fixture();
  const root = (
    await call("post", `/suites/${suite.id}/comments`, "guest", {
      body: "Rever o âmbito",
      discussion: true,
    }).expect(201)
  ).body.id;
  await call("post", `/suites/${suite.id}/comments`, "member", {
    body: "Concordo",
    replyTo: root,
  }).expect(201);
  const [first] = (await notifications("guest")).items;
  assert.deepEqual(
    [first.kind, first.detail.reply, first.activityId === root],
    ["comment", true, false],
  );
});
test("discussions: issues count and resolve their own discussions", async () => {
  const { project, suite } = await issueFixture();
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "member", {
      title: "Botão desalinhado",
    }).expect(201)
  ).body;
  assert.deepEqual(issue.discussions, { total: 0, resolved: 0 });
  const comments = `/issues/${issue.id}/comments`;
  const first = (
    await call("post", comments, "owner", {
      body: "Qual o browser?",
      discussion: true,
    }).expect(201)
  ).body.id;
  await call("post", comments, "owner", {
    body: "Também no tablet?",
    discussion: true,
  }).expect(201);
  await call("post", comments, "member", {
    body: "Chrome 130.",
    replyTo: first,
  }).expect(201);
  const issueNote = (await notifications("owner")).items[0];
  assert.deepEqual(
    [issueNote.kind, issueNote.detail.reply],
    ["issue_comment", true],
  );
  // A discussion from a suite cannot be answered or resolved through an issue.
  const suiteRoot = (
    await call("post", `/suites/${suite.id}/comments`, "owner", {
      body: "Da suite",
      discussion: true,
    }).expect(201)
  ).body.id;
  await call("post", comments, "member", {
    body: "Errado",
    replyTo: suiteRoot,
  }).expect(404);
  await call(
    "patch",
    `/issues/${issue.id}/discussions/${suiteRoot}`,
    "member",
    { resolved: true },
  ).expect(404);
  await call("patch", `/issues/${issue.id}/discussions/${first}`, "member", {
    resolved: true,
  }).expect(200);
  assert.deepEqual(
    (await call("get", `/issues/${issue.id}`)).body.discussions,
    { total: 2, resolved: 1 },
  );
  const listed = (
    await call("get", `/projects/${project.id}/issues`).expect(200)
  ).body.items.find((item: any) => item.id === issue.id);
  assert.deepEqual(listed.discussions, { total: 2, resolved: 1 });
  assert.equal(listed.comments, 3);
});
test("comments: only the author edits them, newly mentioned people are notified", async () => {
  const { suite, members } = await fixture();
  const guestId = members.find(
    (member: any) => member.oid === identities.guest.oid,
  ).id;
  const [card] = suite.tests;
  const root = (
    await call("post", `/tests/${card.id}/comments`, "member", {
      body: "Falha no Safari",
      discussion: true,
    }).expect(201)
  ).body.id;
  const path = `/suites/${suite.id}/comments/${root}`;
  await call("patch", path, "owner", { body: "Outro texto" }).expect(403);
  await call("patch", path, "outsider", { body: "Outro texto" }).expect(404);
  await call("patch", path, "member", { body: "  " }).expect(400);
  await call("patch", path, "member", {
    body: "Falha",
    mentions: [identities.outsider.oid],
  }).expect(400);
  const before = (await notifications("guest")).items.length;
  const edited = (
    await call("patch", path, "member", {
      body: "Falha no Safari 17, @Convidada consegue confirmar?",
      mentions: [guestId],
    }).expect(200)
  ).body;
  assert.ok(edited.editedAt);
  assert.equal(edited.discussion, true);
  const guest = await notifications("guest");
  assert.equal(guest.items.length, before + 1);
  assert.deepEqual(
    [guest.items[0].kind, guest.items[0].activityId],
    ["mention", root],
  );
  // Keeping the same mention does not notify again, and the text is what search finds.
  await call("patch", path, "member", {
    body: "Falha no Safari 17 e 18, @Convidada consegue confirmar?",
    mentions: [guestId],
  }).expect(200);
  assert.equal((await notifications("guest")).items.length, before + 1);
  const listed = (
    await call("get", `/suites/${suite.id}/activity?testId=${card.id}`)
  ).body.find((item: any) => item.id === root);
  assert.equal(
    listed.body,
    "Falha no Safari 17 e 18, @Convidada consegue confirmar?",
  );
  assert.equal(listed.actorId, edited.actorId);
  // Only comments are editable, and only through their own suite or issue.
  const result = (
    await call("get", `/suites/${suite.id}/activity?testId=${card.id}`)
  ).body.find((item: any) => item.kind !== "comment");
  if (result)
    await call("patch", `/suites/${suite.id}/comments/${result.id}`, "owner", {
      body: "x",
    }).expect(404);
  const { project: other } = await issueFixture();
  const issue = (
    await call("post", `/projects/${other.id}/issues`, "member", {
      title: "Botão desalinhado",
    }).expect(201)
  ).body;
  await call("patch", `/issues/${issue.id}/comments/${root}`, "member", {
    body: "Errado",
  }).expect(404);
  const issueComment = (
    await call("post", `/issues/${issue.id}/comments`, "member", {
      body: "No Chrome",
    }).expect(201)
  ).body.id;
  const issuePath = `/issues/${issue.id}/comments/${issueComment}`;
  await call("patch", issuePath, "owner", { body: "Firefox" }).expect(403);
  // With an attachment, the text can be emptied.
  const file = (
    await request(app)
      .post(`/api/v1/issues/${issue.id}/attachments`)
      .set("Authorization", "Bearer member")
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", "erro.txt")
      .send(Buffer.from("stack trace"))
      .expect(201)
  ).body;
  const withFile = (
    await call("post", `/issues/${issue.id}/comments`, "member", {
      body: "Ver anexo",
      attachmentIds: [file.id],
    }).expect(201)
  ).body.id;
  await call("patch", `/issues/${issue.id}/comments/${withFile}`, "member", {
    body: "",
  }).expect(200);
  assert.ok(
    (
      await call("patch", issuePath, "member", {
        body: "No Chrome e Firefox",
      }).expect(200)
    ).body.editedAt,
  );
  // Archived suites are read-only, so their comments cannot be edited.
  const current = (await call("get", `/suites/${suite.id}`)).body;
  await call(
    "post",
    `/suites/${suite.id}/archive`,
    "owner",
    undefined,
    current.version,
  ).expect(200);
  await call("patch", path, "member", { body: "Depois" }).expect(409);
});
test("tests: modules come from the project, are kept on edits and published by name", async () => {
  const { project, suite } = await fixture();
  const module = (name: string) =>
    call("post", `/projects/${project.id}/issue-modules`, "owner", {
      name,
    }).expect(201);
  const checkout = (await module("Carrinho / Checkout")).body;
  const payments = (await module("Pagamentos")).body;
  const [card] = suite.tests;
  const edit = (body: object, version: number) =>
    call(
      "patch",
      `/tests/${card.id}`,
      "member",
      {
        title: card.title,
        instructions: card.instructions,
        expectedResult: card.expectedResult,
        ...body,
      },
      version,
    );
  const current = async () =>
    (await call("get", `/suites/${suite.id}`)).body.tests[0];
  // A module of another project, or an unknown one, is refused.
  await edit(
    { moduleIds: ["99999999-9999-4999-8999-999999999999"] },
    card.version,
  ).expect(400);
  await call(
    "post",
    `/tests/${card.id}/result`,
    "member",
    {
      status: "approved",
    },
    card.version,
  ).expect(200);
  let test = await current();
  await edit(
    { moduleIds: [payments.id, checkout.id, checkout.id] },
    test.version,
  ).expect(200);
  test = await current();
  // Listed in the project's order; a new module is an edit that keeps the result.
  assert.deepEqual(test.moduleIds, [checkout.id, payments.id]);
  assert.equal(test.status, "approved");
  // Omitting moduleIds keeps them; an empty list clears them.
  await edit({ title: "Cartão renomeado" }, test.version).expect(200);
  test = await current();
  assert.deepEqual(test.moduleIds, [checkout.id, payments.id]);
  const duplicate = (
    await call("post", `/suites/${suite.id}/duplicate`, "owner").expect(201)
  ).body;
  assert.deepEqual(duplicate.tests[0].moduleIds, [checkout.id, payments.id]);
  await edit({ moduleIds: [] }, test.version).expect(200);
  assert.deepEqual((await current()).moduleIds, []);
  const added = (
    await call(
      "post",
      `/suites/${suite.id}/tests`,
      "member",
      { title: "Novo", moduleIds: [payments.id] },
      (await call("get", `/suites/${suite.id}`)).body.version,
    ).expect(201)
  ).body;
  assert.deepEqual(
    (await call("get", `/suites/${suite.id}`)).body.tests.find(
      (item: any) => item.id === added.id,
    ).moduleIds,
    [payments.id],
  );
  // Publishing keys name modules: existing ones match ignoring case and accents,
  // missing ones are created in the project.
  const key = (
    await call("post", `/projects/${project.id}/keys`, "owner", {
      name: "pending-qa-suite",
    }).expect(201)
  ).body;
  const published = (
    await call("post", `/projects/${project.id}/suites`, key.secret, {
      title: "Release pendente",
      tests: [
        {
          title: "Pagar com MB WAY",
          modules: ["pagamentos", "Integrações Externas", "PAGAMENTOS"],
        },
        { title: "Sincronizar ERP", modules: ["integracoes externas"] },
        { title: "Sem módulo" },
      ],
    })
      .set("Idempotency-Key", "release-modules")
      .expect(201)
  ).body;
  const config = (await call("get", `/projects/${project.id}/issue-config`))
    .body;
  assert.deepEqual(
    config.modules.map((item: any) => item.name),
    ["Carrinho / Checkout", "Pagamentos", "Integrações Externas"],
  );
  const integrations = config.modules[2].id;
  assert.deepEqual(
    published.tests.map((item: any) => item.moduleIds),
    [[payments.id, integrations], [integrations], []],
  );
  // Deleted modules disappear from the tests.
  await call(
    "delete",
    `/issue-modules/${payments.id}`,
    "owner",
    undefined,
    payments.version,
  ).expect(204);
  assert.deepEqual(
    (await call("get", `/suites/${published.id}`)).body.tests[0].moduleIds,
    [integrations],
  );
});
test("avatar colors: each person picks their own, everyone sees it", async () => {
  const { project } = await fixture();
  await call("put", "/me/avatar-color", "member", { color: "red" }).expect(400);
  await call("put", "/me/avatar-color", "member", {
    color: "#12345",
  }).expect(400);
  const saved = (
    await call("put", "/me/avatar-color", "member", {
      color: "#DB2777",
    }).expect(200)
  ).body;
  assert.equal(saved.avatarColor, "#db2777");
  assert.equal(
    (await call("get", "/me", "member").expect(200)).body.avatarColor,
    "#db2777",
  );
  const colors = async () =>
    Object.fromEntries(
      (await call("get", `/projects/${project.id}/members`)).body.map(
        (member: any) => [member.name, member.avatarColor],
      ),
    );
  assert.deepEqual(await colors(), {
    "Ana Silva": null,
    Convidada: null,
    "João Costa": "#db2777",
  });
  // Signing in again keeps the colour; null goes back to the default.
  await call("get", "/me", "member").expect(200);
  await call("put", "/me/avatar-color", "member", { color: null }).expect(200);
  assert.equal((await colors())["João Costa"], null);
});

const personalUpload = (
  path: string,
  token: string,
  name: string,
  body: string,
) =>
  request(app)
    .post(`/api/v1${path}`)
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "application/octet-stream")
    .set("X-File-Name", name)
    .send(Buffer.from(body));
test("notes: private to their author, with folders, tags, search and a recycle bin", async () => {
  const { project } = await fixture();
  const meetings = (
    await call("post", "/me/note-folders", "owner", {
      name: "Reuniões",
    }).expect(201)
  ).body;
  const year = (
    await call("post", "/me/note-folders", "owner", {
      name: "2026",
      parentId: meetings.id,
    }).expect(201)
  ).body;
  await call("post", "/me/note-folders", "owner", { name: "reuniões" }).expect(
    409,
  );
  await call("post", "/me/note-folders", "member", {
    name: "Minha",
    parentId: meetings.id,
  }).expect(404);
  await call("patch", `/me/note-folders/${meetings.id}`, "owner", {
    parentId: year.id,
  }).expect(409);
  const note = (
    await call("post", "/me/notes", "owner", {
      title: "Daily de segunda",
      body: "- Corrigir o checkout no Safari\n- Rever pagamentos",
      folderId: year.id,
      tags: ["#Daily", "daily", "Equipa"],
    }).expect(201)
  ).body;
  assert.deepEqual(note.tags, ["daily", "equipa"]);
  assert.equal(note.version, 1);
  for (const token of ["member", "admin"]) {
    await call("get", `/me/notes/${note.id}`, token).expect(404);
    await call(
      "patch",
      `/me/notes/${note.id}`,
      token,
      { title: "x" },
      1,
    ).expect(404);
  }
  assert.deepEqual((await call("get", "/me/notes", "member")).body, []);
  await call("patch", `/me/notes/${note.id}`, "owner", { title: "x" }).expect(
    428,
  );
  await call(
    "patch",
    `/me/notes/${note.id}`,
    "owner",
    { title: "x" },
    9,
  ).expect(409);
  const edited = (
    await call(
      "patch",
      `/me/notes/${note.id}`,
      "owner",
      { body: `${note.body}\n- Ligar ao cliente` },
      1,
    ).expect(200)
  ).body;
  assert.equal(edited.version, 2);
  assert.equal(edited.title, "Daily de segunda");
  const other = (
    await call("post", "/me/notes", "owner", { title: "Ideias" }).expect(201)
  ).body;
  const found = (await call("get", "/me/notes?q=safari")).body;
  assert.deepEqual(
    found.map((item: any) => item.id),
    [note.id],
  );
  assert.match(found[0].excerpt, /Safari/);
  assert.equal((await call("get", "/me/notes?tag=%23daily")).body.length, 1);
  assert.deepEqual((await call("get", "/me/note-tags")).body, [
    { name: "daily", count: 1 },
    { name: "equipa", count: 1 },
  ]);
  assert.equal(
    (await call("get", "/search?q=safari")).body.notes[0].id,
    note.id,
  );
  assert.deepEqual(
    (await call("get", "/search?q=safari", "member")).body.notes,
    [],
  );
  // Removing a folder keeps everything it held, one level up.
  await call("delete", `/me/note-folders/${meetings.id}`).expect(204);
  const folders = (await call("get", "/me/note-folders")).body;
  assert.deepEqual(folders, [{ id: year.id, parentId: null, name: "2026" }]);
  const file = (
    await personalUpload(
      `/me/notes/${note.id}/attachments`,
      "owner",
      "ata.txt",
      "ata",
    ).expect(201)
  ).body;
  await personalUpload(
    `/me/notes/${note.id}/attachments`,
    "member",
    "x.txt",
    "x",
  ).expect(404);
  assert.equal(
    (await call("get", `/me/notes/${note.id}`)).body.attachments[0].fileName,
    "ata.txt",
  );
  await call("get", `/me/attachments/${file.id}`, "owner").expect(200);
  await call("get", `/me/attachments/${file.id}`, "member").expect(404);
  await call("delete", `/me/attachments/${file.id}`, "member").expect(404);
  // Recycle bin: deleted notes can be restored, and only then removed for good.
  await call("delete", `/me/notes/${other.id}?permanent=1`).expect(409);
  await call("delete", `/me/notes/${note.id}`).expect(204);
  assert.deepEqual(
    (await call("get", "/me/notes")).body.map((item: any) => item.id),
    [other.id],
  );
  assert.equal((await call("get", "/me/notes?deleted=1")).body[0].id, note.id);
  await call(
    "patch",
    `/me/notes/${note.id}`,
    "owner",
    { title: "x" },
    3,
  ).expect(409);
  const restored = (
    await call("post", `/me/notes/${note.id}/restore`).expect(200)
  ).body;
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.folderId, year.id);
  await call("delete", `/me/notes/${note.id}`).expect(204);
  await call("delete", `/me/notes/${note.id}?permanent=1`).expect(204);
  await call("get", `/me/notes/${note.id}`).expect(404);
  // Integration keys never reach the personal area.
  const key = (
    await call("post", `/projects/${project.id}/keys`, "owner", {
      name: "Pipeline",
      scope: "manage",
    }).expect(201)
  ).body;
  await call("get", "/me/notes", key.secret).expect(403);
});
test("drafts: personal board, items from notes and conversion into issues", async () => {
  const { project, members, ownerId } = await issueFixture();
  const note = (
    await call("post", "/me/notes", "owner", {
      title: "Daily",
      body: "- A\n- B\n- C",
    }).expect(201)
  ).body;
  const items = ["A", "B", "C"].map((title) => ({
    title,
    description: `Da daily: ${title}`,
    sourceText: title,
  }));
  const drafts = (
    await call("post", "/me/drafts", "owner", {
      noteId: note.id,
      projectId: project.id,
      priority: 2,
      items,
    }).expect(201)
  ).body;
  assert.deepEqual(
    drafts.map((draft: any) => [draft.title, draft.state, draft.position]),
    [
      ["A", "review", 0],
      ["B", "review", 1],
      ["C", "review", 2],
    ],
  );
  assert.equal(drafts[0].projectName, "Checkout");
  assert.equal(drafts[0].noteTitle, "Daily");
  assert.equal(drafts[0].priority, 2);
  const [a, b, c] = drafts;
  await call("post", "/me/drafts", "member", { noteId: note.id, items }).expect(
    404,
  );
  await call("post", "/me/drafts", "outsider", {
    projectId: project.id,
    items,
  }).expect(404);
  const guest = members.find(
    (member: any) => member.oid === identities.guest.oid,
  );
  await call("patch", `/projects/${project.id}/members/${guest.id}`, "owner", {
    role: "viewer",
  }).expect(204);
  await call("post", "/me/drafts", "guest", {
    projectId: project.id,
    items,
  }).expect(403);
  assert.deepEqual((await call("get", "/me/drafts", "member")).body, []);
  await call("get", `/me/drafts/${a.id}`, "member").expect(404);
  // Board moves keep each column contiguous; "Criado" is never a target.
  await call("post", `/me/drafts/${c.id}/move`, "owner", {
    state: "ready",
    position: 0,
  }).expect(200);
  const moved = (
    await call("post", `/me/drafts/${a.id}/move`, "owner", {
      state: "ready",
      position: 5,
    }).expect(200)
  ).body;
  assert.equal(moved.position, 1);
  await call("post", `/me/drafts/${b.id}/move`, "owner", {
    state: "created",
    position: 0,
  }).expect(400);
  const columns = async () =>
    (await call("get", "/me/drafts")).body.map((draft: any) => [
      draft.title,
      draft.state,
      draft.position,
    ]);
  assert.deepEqual(await columns(), [
    ["C", "ready", 0],
    ["A", "ready", 1],
    ["B", "review", 0],
  ]);
  await personalUpload(
    `/me/drafts/${a.id}/attachments`,
    "owner",
    "erro.txt",
    "trace",
  ).expect(201);
  // Someone else cannot use the draft, and the failed attempt creates nothing.
  await call("post", `/projects/${project.id}/issues`, "member", {
    title: "Alheio",
    draftId: a.id,
  }).expect(404);
  assert.equal(
    (await call("get", `/projects/${project.id}/issues`)).body.total,
    0,
  );
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title: "A, revisto",
      description: "Da daily: A",
      priority: 2,
      draftId: a.id,
    }).expect(201)
  ).body;
  assert.equal(issue.reporterId, ownerId);
  const created = (await call("get", `/me/drafts/${a.id}`)).body;
  assert.equal(created.state, "created");
  assert.equal(created.issueId, issue.id);
  assert.equal(created.issueNumber, issue.number);
  assert.deepEqual(await columns(), [
    ["A", "created", 0],
    ["C", "ready", 0],
    ["B", "review", 0],
  ]);
  const activity = (await call("get", `/issues/${issue.id}/activity`)).body;
  assert.equal(activity[0].kind, "issue_created");
  assert.equal(activity[0].detail.draft, true);
  assert.equal(activity[0].attachments[0].fileName, "erro.txt");
  await call("post", `/projects/${project.id}/issues`, "owner", {
    title: "De novo",
    draftId: a.id,
  }).expect(409);
  await call(
    "patch",
    `/me/drafts/${a.id}`,
    "owner",
    { title: "x" },
    created.version,
  ).expect(409);
  await call("post", `/me/drafts/${a.id}/move`, "owner", {
    state: "review",
    position: 0,
  }).expect(409);
  // Only discarded drafts can be removed; removing the note keeps its drafts.
  await call("delete", `/me/drafts/${b.id}`).expect(409);
  await call("post", `/me/drafts/${b.id}/move`, "owner", {
    state: "discarded",
    position: 0,
  }).expect(200);
  await call("delete", `/me/drafts/${b.id}`).expect(204);
  const patched = (
    await call(
      "patch",
      `/me/drafts/${c.id}`,
      "owner",
      { projectId: null, priority: null },
      (await call("get", `/me/drafts/${c.id}`)).body.version,
    ).expect(200)
  ).body;
  assert.equal(patched.projectId, null);
  await call("put", "/me/preferences/drafts.view", "owner", {
    value: "table",
  }).expect(200);
  await call("delete", `/me/notes/${note.id}`).expect(204);
  await call("delete", `/me/notes/${note.id}?permanent=1`).expect(204);
  const left = (await call("get", "/me/drafts")).body;
  assert.equal(left.length, 2);
  assert.ok(left.every((draft: any) => draft.noteId === null));
});
test("drafts: an issue removed for good leaves its draft as created, without the issue", async () => {
  const project = await createProject({
    name: "Sem histórico",
    issueSoftDelete: false,
  });
  const [draft] = (
    await call("post", "/me/drafts", "owner", {
      projectId: project.id,
      items: [{ title: "Temporário" }],
    }).expect(201)
  ).body;
  const issue = (
    await call("post", `/projects/${project.id}/issues`, "owner", {
      title: "Temporário",
      draftId: draft.id,
    }).expect(201)
  ).body;
  await call(
    "delete",
    `/issues/${issue.id}`,
    "owner",
    undefined,
    issue.version,
  ).expect(204);
  const left = (await call("get", `/me/drafts/${draft.id}`)).body;
  assert.equal(left.state, "created");
  assert.equal(left.issueId, null);
  assert.equal(left.issueNumber, null);
});
