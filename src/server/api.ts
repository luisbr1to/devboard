import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { ZodError, z } from "zod";
import { imageSize } from "image-size";
import {
  projectInput,
  suiteInput,
  suiteEditInput,
  suiteSelectionInput,
  testInput,
  resultInput,
  commentInput,
  stepResultInput,
  adminInput,
  memberInput,
  memberRoleInput,
  setupInput,
  memberBlockInput,
  keyInput,
  summarize,
  multiFilter,
  statusSchema,
  type Suite,
  type TestCase,
  type Status,
  type User,
  type Me,
  type NotificationKind,
} from "../shared/contracts";
import { parseSteps } from "../shared/steps";
import { transaction, type Database, type Connection } from "./db";
import {
  HttpError,
  authConfig,
  type Actor,
  type Authentication,
  type Identity,
} from "./auth";
import { openapi } from "./openapi";
import { activityPayloads } from "./teams";
import {
  issueRoutes,
  issueScope,
  releaseIssueAssignments,
  seedIssueStatuses,
} from "./issues";

export type Row = Record<string, any>;
/** Membership whose temporary block (if any) is over; use with the alias `m`. */
export const activeMember =
  "(m.blocked_at IS NULL OR (m.blocked_until IS NOT NULL AND m.blocked_until <= now()))";
/** Members who may be assigned work: not read-only. */
export const assignableMember = `m.role <> 'viewer'`;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const loopback = (address?: string) =>
  address === "127.0.0.1" ||
  address === "::1" ||
  address === "::ffff:127.0.0.1";
const validateProjectIcon = (value?: string | null) => {
  if (!value) return;
  try {
    const bytes = Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
    const dimensions = imageSize(bytes);
    if (
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width > 48 ||
      dimensions.height > 48
    )
      throw new Error("dimensions");
  } catch {
    throw new HttpError(
      400,
      "O ícone do projeto deve ser uma imagem válida com um máximo de 48 × 48 px.",
    );
  }
};
export const dto = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
export const actorOf = (res: Response): Actor => res.locals.actor;
export const maxAttachment = 10 * 1024 * 1024;
/** Allowed attachments by extension; the stored type never comes from the client. */
const attachmentTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};
const imageFormats: Record<string, string> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
};
export function checkAttachment(fileName: string, data: Buffer) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const type = attachmentTypes[extension];
  if (!type)
    throw new HttpError(
      415,
      "Tipo de ficheiro não suportado. Use PNG, JPEG, GIF, WebP, PDF, TXT, LOG, CSV ou JSON.",
    );
  if (!data.length) throw new HttpError(400, "O ficheiro está vazio.");
  if (data.length > maxAttachment)
    throw new HttpError(413, "Cada anexo pode ter no máximo 10 MB.");
  let valid: boolean;
  if (imageFormats[extension]) {
    try {
      valid = imageSize(data).type === imageFormats[extension];
    } catch {
      valid = false;
    }
  } else if (extension === "pdf")
    valid = data.subarray(0, 5).toString("latin1") === "%PDF-";
  else {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(data);
      valid = !data.includes(0);
    } catch {
      valid = false;
    }
  }
  if (!valid)
    throw new HttpError(
      415,
      "O conteúdo do ficheiro não corresponde à sua extensão.",
    );
  return type;
}
export const likePattern = (query: string) =>
  `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
export const human = (actor: Actor) => {
  if (actor.type !== "user")
    throw new HttpError(403, "Esta operação requer um utilizador.");
  return actor.user;
};
export const actorName = (actor: Actor) =>
  actor.type === "user" ? actor.user.name : `Integração: ${actor.name}`;
export const id = (req: Request, key: string) =>
  z.string().uuid().parse(req.params[key]);
export const version = (req: Request) => {
  const header = req.get("If-Match");
  if (!header || !/^"?\d+"?$/.test(header))
    throw new HttpError(
      428,
      "Atualize a página e envie a versão do registo (If-Match).",
    );
  return Number(header.replaceAll('"', ""));
};
export const expectVersion = (req: Request, row: Row) => {
  if (version(req) !== row.version)
    throw new HttpError(
      409,
      "Este registo foi alterado por outra pessoa. Atualize os dados antes de guardar.",
    );
};

async function userUpsert(
  db: Connection | Database,
  identity: Pick<Identity, "tenantId" | "oid" | "name" | "email">,
): Promise<User> {
  const result = await db.query(
    "INSERT INTO users(id,tenant_id,oid,name,email) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,oid) DO UPDATE SET name=excluded.name,email=excluded.email RETURNING *",
    [
      randomUUID(),
      identity.tenantId,
      identity.oid,
      identity.name,
      identity.email,
    ],
  );
  return dto(result.rows[0]) as User;
}
export async function projectScope(
  db: Connection | Database,
  projectId: string,
  actor: Actor,
  options: { owner?: boolean; write?: boolean; lock?: boolean } = {},
) {
  const result = await db.query(
    `SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL${options.lock ? " FOR UPDATE" : ""}`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project) throw new HttpError(404, "Projeto não encontrado.");
  if (actor.type === "integration") {
    if (actor.projectId !== projectId || options.owner)
      throw new HttpError(403, "Chave sem acesso a este projeto.");
    const key = (
      await db.query("SELECT revoked_at FROM integration_keys WHERE id=$1", [
        actor.id,
      ])
    ).rows[0];
    if (!key || key.revoked_at)
      throw new HttpError(401, "Chave de integração revogada.");
    project.role = "integration";
  } else if (actor.admin) {
    // Administrators act as owners everywhere, member or not, blocked or read-only.
    project.role = "owner";
  } else {
    const membership = (
      await db.query(
        `SELECT m.role,NOT ${activeMember} AS blocked FROM project_members m WHERE m.project_id=$1 AND m.user_id=$2`,
        [projectId, actor.user.id],
      )
    ).rows[0];
    if (!membership)
      throw new HttpError(404, "Projeto não encontrado ou sem acesso.");
    if (membership.blocked)
      throw new HttpError(
        403,
        "O seu acesso a este projeto está bloqueado temporariamente.",
      );
    // Every change goes through write or the project lock; read-only members only read.
    if (membership.role === "viewer" && (options.write || options.lock))
      throw new HttpError(403, "Tem acesso só de leitura neste projeto.");
    if (options.owner && membership.role !== "owner")
      throw new HttpError(
        403,
        "Apenas os proprietários podem realizar esta ação.",
      );
    project.role = membership.role;
  }
  return project;
}
async function suiteScope(
  db: Connection | Database,
  suiteId: string,
  actor: Actor,
  options: { owner?: boolean; write?: boolean; lock?: boolean } = {},
) {
  const initial = (
    await db.query(
      "SELECT project_id FROM suites WHERE id=$1 AND deleted_at IS NULL",
      [suiteId],
    )
  ).rows[0];
  if (!initial) throw new HttpError(404, "Suite não encontrada.");
  const project = await projectScope(db, initial.project_id, actor, options);
  const suite = (await db.query("SELECT * FROM suites WHERE id=$1", [suiteId]))
    .rows[0];
  if (options.write && suite.archived_at)
    throw new HttpError(
      409,
      "Esta suite está arquivada e é apenas de leitura.",
    );
  return { suite, project };
}
async function testScope(db: Connection, testId: string, actor: Actor) {
  const initial = (
    await db.query(
      "SELECT suite_id FROM tests WHERE id=$1 AND deleted_at IS NULL",
      [testId],
    )
  ).rows[0];
  if (!initial) throw new HttpError(404, "Teste não encontrado.");
  const scope = await suiteScope(db, initial.suite_id, actor, {
    write: true,
    lock: true,
  });
  const test = (await db.query("SELECT * FROM tests WHERE id=$1", [testId]))
    .rows[0];
  return { ...scope, test };
}
export async function assigned(
  db: Connection,
  projectId: string,
  assigneeId?: string | null,
) {
  if (
    assigneeId &&
    !(
      await db.query(
        `SELECT 1 FROM project_members m WHERE m.project_id=$1 AND m.user_id=$2 AND ${assignableMember}`,
        [projectId, assigneeId],
      )
    ).rows.length
  )
    throw new HttpError(
      400,
      "O responsável deve ser membro do projeto com permissão de edição.",
    );
}
async function assigneeByEmail(
  db: Connection,
  projectId: string,
  email: string,
) {
  const rows = (
    await db.query(
      `SELECT u.id FROM users u JOIN project_members m ON m.user_id=u.id WHERE m.project_id=$1 AND lower(u.email)=lower($2) AND ${assignableMember}`,
      [projectId, email],
    )
  ).rows;
  if (rows.length !== 1)
    throw new HttpError(
      400,
      `O responsável ${email} deve ser membro do projeto.`,
    );
  return rows[0].id as string;
}
async function event(
  db: Connection,
  suiteId: string,
  actor: Actor,
  kind: string,
  body = "",
  testId: string | null = null,
  detail: Row = {},
) {
  const activityId = randomUUID();
  await db.query(
    "INSERT INTO activities(id,suite_id,test_id,actor_id,actor_name,kind,body,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      activityId,
      suiteId,
      testId,
      actor.type === "user" ? actor.user.id : null,
      actorName(actor),
      kind,
      body,
      JSON.stringify(detail),
    ],
  );
  return activityId;
}
async function touch(db: Connection, suiteId: string) {
  await db.query(
    "UPDATE suites SET updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
    [suiteId],
  );
}
/** Activity kinds that make the actor a tester of the test. */
const testerKinds = ["result_recorded", "comment", "step_recorded"];
const testDto = ({ legacy_instructions: _legacy, ...row }: Row) => dto(row);
async function snapshot(
  db: Connection | Database,
  suiteId: string,
): Promise<Suite> {
  const suite = dto(
    (await db.query("SELECT * FROM suites WHERE id=$1", [suiteId])).rows[0],
  );
  const steps = (
    await db.query(
      "SELECT s.id,s.test_id,s.position,s.body,s.status,s.updated_by_name,s.updated_at,s.version FROM test_steps s JOIN tests t ON t.id=s.test_id WHERE t.suite_id=$1 AND t.deleted_at IS NULL ORDER BY s.position,s.id",
      [suiteId],
    )
  ).rows;
  const testers = (
    await db.query(
      "SELECT a.test_id,u.id,u.name,min(a.created_at) AS first FROM activities a JOIN users u ON u.id=a.actor_id WHERE a.suite_id=$1 AND a.test_id IS NOT NULL AND a.kind = ANY($2::text[]) GROUP BY a.test_id,u.id,u.name ORDER BY first,u.id",
      [suiteId, testerKinds],
    )
  ).rows;
  const tests = (
    await db.query(
      "SELECT * FROM tests WHERE suite_id=$1 AND deleted_at IS NULL ORDER BY position,id",
      [suiteId],
    )
  ).rows.map(
    (row) =>
      ({
        ...testDto(row),
        steps: steps
          .filter((step) => step.test_id === row.id)
          .map(({ test_id: _test, ...step }) => dto(step)),
        testers: testers
          .filter((tester) => tester.test_id === row.id)
          .map((tester) => ({ id: tester.id, name: tester.name })),
      }) as TestCase,
  );
  return {
    ...suite,
    ...summarize(tests.map((test) => test.status)),
    tests,
  } as Suite;
}
/** Explicit steps win; otherwise the first list of the instructions becomes the steps. */
function definition(input: { instructions: string; steps?: string[] }) {
  if (input.steps)
    return { instructions: input.instructions, steps: input.steps };
  const parsed = parseSteps(input.instructions);
  if (!parsed.steps.length)
    return { instructions: input.instructions, steps: [] };
  return {
    instructions: [parsed.before, parsed.after].filter(Boolean).join("\n\n"),
    steps: parsed.steps.filter(Boolean),
  };
}
async function insertSteps(db: Connection, testId: string, steps: string[]) {
  for (const [position, body] of steps.entries())
    await db.query(
      "INSERT INTO test_steps(id,test_id,position,body) VALUES($1,$2,$3,$4)",
      [randomUUID(), testId, position, body],
    );
}
/** Requires the project row lock held by the caller. */
async function nextNumber(
  db: Connection,
  table: "suites" | "tests",
  parentId: string,
) {
  const parent = table === "suites" ? "project_id" : "suite_id";
  return Number(
    (
      await db.query(
        `SELECT coalesce(max(number),0)+1 AS next FROM ${table} WHERE ${parent}=$1`,
        [parentId],
      )
    ).rows[0].next,
  );
}
async function testerIds(
  db: Connection,
  column: "test_id" | "suite_id",
  id: string,
) {
  return (
    await db.query(
      `SELECT DISTINCT actor_id FROM activities WHERE ${column}=$1 AND test_id IS NOT NULL AND actor_id IS NOT NULL AND kind = ANY($2::text[])`,
      [id, testerKinds],
    )
  ).rows.map((row) => row.actor_id as string);
}
/** Everyone involved in a suite: testers of any of its tests and assignees of its tests. */
async function suitePeople(db: Connection, suiteId: string) {
  const assignees = (
    await db.query(
      "SELECT DISTINCT assignee_id FROM tests WHERE suite_id=$1 AND deleted_at IS NULL AND assignee_id IS NOT NULL",
      [suiteId],
    )
  ).rows.map((row) => row.assignee_id as string);
  return [...(await testerIds(db, "suite_id", suiteId)), ...assignees];
}
export async function mentioned(
  db: Connection,
  projectId: string,
  ids: string[],
) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const members = (
    await db.query(
      "SELECT user_id FROM project_members WHERE project_id=$1 AND user_id = ANY($2::uuid[])",
      [projectId, unique],
    )
  ).rows.map((row) => row.user_id as string);
  if (members.length !== unique.length)
    throw new HttpError(400, "Só pode mencionar membros do projeto.");
  return unique;
}
async function linkAttachments(
  db: Connection,
  actor: Actor,
  ids: string[],
  scope: { suiteId: string; testId: string | null; activityId: string },
) {
  if (!ids.length) return;
  const linked = (
    await db.query(
      "UPDATE attachments SET activity_id=$1 WHERE id = ANY($2::uuid[]) AND uploaded_by=$3 AND suite_id=$4 AND test_id IS NOT DISTINCT FROM $5 AND activity_id IS NULL RETURNING id",
      [
        scope.activityId,
        [...new Set(ids)],
        human(actor).id,
        scope.suiteId,
        scope.testId,
      ],
    )
  ).rows;
  if (linked.length !== new Set(ids).size)
    throw new HttpError(400, "Um dos anexos é inválido ou já foi publicado.");
}
export const excerpt = (body: string) =>
  body
    .replace(/\[@\s+[^\]]*?label="([^"]*)"[^\]]*\]/g, "@$1")
    .replace(/[#>*_`~\[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
/** Notifications written by the current request, sent to Teams once it succeeds. */
export interface PendingFeed {
  kind: NotificationKind;
  userIds: string[];
  projectId: string;
  suiteId: string | null;
  testId: string | null;
  issueId: string | null;
  activityId: string | null;
  detail: Row;
}
const feedOutbox = new AsyncLocalStorage<PendingFeed[]>();
/** Writes in-app notifications, skipping the actor and anyone who left the project. */
export async function notify(
  db: Connection,
  actor: Actor,
  kind: NotificationKind,
  target: {
    projectId: string;
    suiteId?: string | null;
    testId?: string | null;
    issueId?: string | null;
    activityId?: string | null;
    detail?: Row;
  },
  recipients: Iterable<string | null | undefined>,
  except: Iterable<string> = [],
) {
  const skip = new Set(except);
  if (actor.type === "user") skip.add(actor.user.id);
  const unique = [
    ...new Set([...recipients].filter((id): id is string => !!id)),
  ].filter((id) => !skip.has(id));
  if (!unique.length) return;
  const members = (
    await db.query(
      `SELECT m.user_id FROM project_members m WHERE m.project_id=$1 AND m.user_id = ANY($2::uuid[]) AND ${activeMember}`,
      [target.projectId, unique],
    )
  ).rows.map((row) => row.user_id as string);
  for (const userId of members)
    await db.query(
      "INSERT INTO notifications(id,user_id,project_id,suite_id,test_id,issue_id,activity_id,kind,actor_name,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        randomUUID(),
        userId,
        target.projectId,
        target.suiteId ?? null,
        target.testId ?? null,
        target.issueId ?? null,
        target.activityId ?? null,
        kind,
        actorName(actor),
        JSON.stringify(target.detail ?? {}),
      ],
    );
  if (members.length)
    feedOutbox.getStore()?.push({
      kind,
      userIds: members,
      projectId: target.projectId,
      suiteId: target.suiteId ?? null,
      testId: target.testId ?? null,
      issueId: target.issueId ?? null,
      activityId: target.activityId ?? null,
      detail: target.detail ?? {},
    });
}
async function newSuite(
  db: Connection,
  projectId: string,
  input: z.infer<typeof suiteInput>,
  actor: Actor,
) {
  const suiteId = randomUUID();
  await db.query(
    "INSERT INTO suites(id,project_id,number,title,description,created_by,provenance) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      suiteId,
      projectId,
      await nextNumber(db, "suites", projectId),
      input.title,
      input.description,
      actorName(actor),
      input.provenance ? JSON.stringify(input.provenance) : null,
    ],
  );
  const activityId = await event(db, suiteId, actor, "suite_created");
  for (const [position, test] of input.tests.entries()) {
    const assigneeId = test.assigneeEmail
      ? await assigneeByEmail(db, projectId, test.assigneeEmail)
      : test.assigneeId;
    await assigned(db, projectId, assigneeId);
    const testId = randomUUID();
    const { instructions, steps } = definition(test);
    await db.query(
      "INSERT INTO tests(id,suite_id,number,title,instructions,expected_result,assignee_id,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        testId,
        suiteId,
        position + 1,
        test.title,
        instructions,
        test.expectedResult,
        assigneeId || null,
        position,
      ],
    );
    await insertSteps(db, testId, steps);
    await event(db, suiteId, actor, "test_created", "", testId);
  }
  const members = (
    await db.query("SELECT user_id FROM project_members WHERE project_id=$1", [
      projectId,
    ])
  ).rows.map((row) => row.user_id as string);
  await notify(
    db,
    actor,
    "suite_created",
    { projectId, suiteId, activityId },
    members,
  );
  return snapshot(db, suiteId);
}

/** Unassigns a member from active tests and issues (removed or made read-only). */
async function releaseAssignments(
  client: Connection,
  actor: Actor,
  projectId: string,
  userId: string,
  note: string,
) {
  const tests = (
    await client.query(
      "SELECT t.id,t.suite_id FROM tests t JOIN suites s ON s.id=t.suite_id WHERE s.project_id=$1 AND t.assignee_id=$2 AND s.archived_at IS NULL AND s.deleted_at IS NULL AND t.deleted_at IS NULL",
      [projectId, userId],
    )
  ).rows;
  for (const test of tests) {
    await client.query(
      "UPDATE tests SET assignee_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
      [test.id],
    );
    await event(
      client,
      test.suite_id,
      actor,
      "assignment_changed",
      note,
      test.id,
      { previousAssigneeId: userId, assigneeId: null },
    );
    await touch(client, test.suite_id);
  }
  await releaseIssueAssignments(client, actor, projectId, userId);
}
/** Owners manage other people: never themselves, never another owner's block. */
async function managedMember(
  client: Connection,
  actor: Actor,
  projectId: string,
  userId: string,
) {
  await projectScope(client, projectId, actor, {
    owner: true,
    write: true,
    lock: true,
  });
  if (human(actor).id === userId)
    throw new HttpError(409, "Não pode alterar o seu próprio acesso.");
  const member = (
    await client.query(
      "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2",
      [projectId, userId],
    )
  ).rows[0];
  if (!member) throw new HttpError(404, "Membro não encontrado.");
  return member as { role: string };
}
async function ownerCount(client: Connection, projectId: string) {
  return Number(
    (
      await client.query(
        "SELECT count(*) FROM project_members WHERE project_id=$1 AND role='owner'",
        [projectId],
      )
    ).rows[0].count,
  );
}
export function createApi(
  db: Database,
  authentication: Authentication,
  options: { teamsAppId?: string; setupCode?: string } = {
    teamsAppId: process.env.TEAMS_APP_ID,
  },
) {
  const router = express.Router();
  // The first-run setup asks for this code: TESTHUB_SETUP_CODE, or one generated per
  // process and printed to the server log while the setup is pending.
  const fixedCode = options.setupCode ?? process.env.TESTHUB_SETUP_CODE?.trim();
  const setupCode =
    fixedCode || randomBytes(8).toString("hex").match(/.{4}/g)!.join("-");
  let announced = Boolean(fixedCode);
  const announceSetup = () => {
    if (announced) return;
    announced = true;
    console.log(
      `DevBoard: setup inicial pendente. Código de setup: ${setupCode}`,
    );
  };
  const setupRequired = async (client: Connection | Database) =>
    !(await client.query("SELECT 1 FROM app_admins WHERE master")).rows.length;
  /** Best effort: a Graph failure never affects the request or the in-app notifications. */
  async function deliverToTeams(pending: PendingFeed[], actor?: Actor) {
    const teamsAppId = options.teamsAppId;
    if (!authentication.sendActivity || !teamsAppId || !actor) return;
    const token = actor.type === "user" ? actor.identity.token : null;
    for (const item of pending) {
      try {
        const recipientOids = (
          await db.query("SELECT oid FROM users WHERE id = ANY($1::uuid[])", [
            item.userIds,
          ])
        ).rows.map((row) => row.oid as string);
        const info = (
          await db.query(
            "SELECT p.name AS project_name,s.number AS suite_number,s.title AS suite_title,s.deleted_at IS NOT NULL AS suite_deleted,t.number AS test_number,t.title AS test_title,t.deleted_at IS NOT NULL AS test_deleted,i.number AS issue_number,i.title AS issue_title,i.deleted_at IS NOT NULL AS issue_deleted FROM projects p LEFT JOIN suites s ON s.id=$2 LEFT JOIN tests t ON t.id=$3 LEFT JOIN issues i ON i.id=$4 WHERE p.id=$1",
            [item.projectId, item.suiteId, item.testId, item.issueId],
          )
        ).rows[0];
        if (!info || !recipientOids.length) continue;
        for (const payload of activityPayloads(teamsAppId, {
          ...item,
          recipientOids,
          projectName: info.project_name,
          suiteNumber: info.suite_number,
          suiteTitle: info.suite_title,
          suiteDeleted: Boolean(info.suite_deleted),
          testNumber: info.test_number,
          testTitle: info.test_title,
          testDeleted: Boolean(info.test_deleted),
          issueNumber: info.issue_number,
          issueTitle: info.issue_title,
          issueDeleted: Boolean(info.issue_deleted),
        }))
          await authentication.sendActivity(token, payload);
      } catch (error) {
        console.warn(
          "Notificação Teams não enviada:",
          error instanceof Error ? error.message : "erro desconhecido",
        );
      }
    }
  }
  router.use((_req, res, next) => {
    const pending: PendingFeed[] = [];
    res.on("finish", () => {
      // Only after a successful response: the transaction has committed.
      if (pending.length && res.statusCode < 400)
        void deliverToTeams(pending, res.locals.actor);
    });
    feedOutbox.run(pending, next);
  });
  const json = express.json({ limit: "2mb" });
  // Spreadsheet imports carry up to 1000 issues in one request.
  const importJson = express.json({ limit: "10mb" });
  router.use((req, res, next) =>
    (/^\/projects\/[\da-f-]{36}\/issues\/import$/i.test(req.path)
      ? importJson
      : json)(req, res, next),
  );
  router.get("/config", (_req, res) => {
    const config = authConfig();
    res.set("Cache-Control", "no-store");
    res.json({
      ...config,
      mode: authentication.mode,
      scope: `${config.resourceUri}/access_as_user`,
      localUsers:
        authentication.mode === "local" ? authentication.directory : undefined,
      configured:
        authentication.mode === "local"
          ? Boolean(process.env.DATABASE_URL)
          : Boolean(
              config.clientId &&
              config.tenantId &&
              config.resourceUri &&
              process.env.DATABASE_URL,
            ),
    });
  });
  router.post("/auth/local/session", async (req, res) => {
    if (!authentication.createSession)
      throw new HttpError(404, "Autenticação local indisponível.");
    if (!loopback(req.socket.remoteAddress))
      throw new HttpError(
        403,
        "A autenticação local só está disponível através de localhost.",
      );
    const input = z.object({ oid: z.string().uuid() }).strict().parse(req.body);
    const session = await authentication.createSession(input.oid);
    res.set("Cache-Control", "no-store");
    res.status(201).json({
      token: session.token,
      user: {
        oid: session.identity.oid,
        name: session.identity.name,
        email: session.identity.email,
      },
    });
  });
  router.delete("/auth/local/session", (req, res) => {
    if (!authentication.revokeSession)
      throw new HttpError(404, "Autenticação local indisponível.");
    const token = req.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (token) authentication.revokeSession(token);
    res.status(204).end();
  });
  router.get("/openapi.json", (_req, res) => res.json(openapi));
  router.use(async (req, res, next) => {
    const token = req.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw new HttpError(401, "Inicie sessão para continuar.");
    if (token.startsWith("th_")) {
      if (
        req.method !== "POST" ||
        !/^\/projects\/[\da-f-]{36}\/suites$/i.test(req.path)
      )
        throw new HttpError(
          403,
          "Esta chave só permite publicar suites no seu projeto.",
        );
      const key = (
        await db.query(
          "SELECT id,project_id,name FROM integration_keys WHERE secret_hash=$1 AND revoked_at IS NULL",
          [digest(token)],
        )
      ).rows[0];
      if (!key)
        throw new HttpError(401, "Chave de integração inválida ou revogada.");
      res.locals.actor = {
        type: "integration",
        id: key.id,
        projectId: key.project_id,
        name: key.name,
      } satisfies Actor;
    } else {
      const identity = await authentication.authenticate(token);
      const user = await userUpsert(db, identity);
      const access = (
        await db.query(
          "SELECT bool_or(user_id=$1) AS admin,bool_or(master AND user_id=$1) AS master,bool_or(master) AS configured FROM app_admins WHERE removed_at IS NULL",
          [user.id],
        )
      ).rows[0];
      res.locals.actor = {
        type: "user",
        user,
        identity,
        admin: Boolean(access.admin),
        master: Boolean(access.master),
      } satisfies Actor;
      res.locals.setupRequired = !access.configured;
    }
    res.set("Cache-Control", "no-store");
    next();
  });
  // Until a master administrator exists, people can only see who they are and run the setup.
  router.use((req, res, next) => {
    if (res.locals.setupRequired) {
      announceSetup();
      if (req.path !== "/me" && req.path !== "/setup")
        throw new HttpError(
          409,
          "A aplicação ainda não foi configurada. Conclua o setup inicial.",
        );
    }
    next();
  });
  const me = (res: Response): Me => {
    const actor = actorOf(res);
    const user = human(actor);
    return {
      ...user,
      admin: actor.type === "user" && actor.admin,
      master: actor.type === "user" && actor.master,
      setupRequired: Boolean(res.locals.setupRequired),
    };
  };
  router.get("/me", (_req, res) => res.json(me(res)));
  router.post("/setup", async (req, res) => {
    const user = human(actorOf(res));
    const input = setupInput.parse(req.body);
    const valid = timingSafeEqual(
      createHash("sha256").update(input.code).digest(),
      createHash("sha256").update(setupCode).digest(),
    );
    await transaction(db, async (client) => {
      // Two people finishing the setup at once: only the first becomes master.
      await client.query("LOCK TABLE app_admins IN SHARE ROW EXCLUSIVE MODE");
      if (!(await setupRequired(client)))
        throw new HttpError(409, "A aplicação já está configurada.");
      if (!valid) throw new HttpError(403, "Código de setup inválido.");
      await client.query(
        "INSERT INTO app_admins(id,user_id,master,created_by) VALUES($1,$2,true,$2)",
        [randomUUID(), user.id],
      );
    });
    res
      .status(201)
      .json({ ...user, admin: true, master: true, setupRequired: false });
  });
  const administrator = (res: Response) => {
    const actor = actorOf(res);
    human(actor);
    if (actor.type !== "user" || !actor.admin)
      throw new HttpError(
        403,
        "Apenas os administradores da aplicação podem realizar esta ação.",
      );
    return actor;
  };
  const adminColumns =
    "u.id,u.oid,u.tenant_id,u.name,u.email,a.master,a.created_at,c.name AS created_by_name FROM app_admins a JOIN users u ON u.id=a.user_id LEFT JOIN users c ON c.id=a.created_by WHERE a.removed_at IS NULL";
  router.get("/admins", async (_req, res) => {
    administrator(res);
    res.json(
      (
        await db.query(`SELECT ${adminColumns} ORDER BY a.master DESC,u.name`)
      ).rows.map(dto),
    );
  });
  router.get("/admins/directory", async (req, res) => {
    const actor = administrator(res);
    const query = z.string().trim().min(2).max(100).parse(req.query.q);
    res.json(await authentication.search(actor.identity.token, query));
  });
  router.post("/admins", async (req, res) => {
    const actor = administrator(res);
    const input = adminInput.parse(req.body);
    const person = await authentication.person(actor.identity.token, input.oid);
    const result = await transaction(db, async (client) => {
      const user = await userUpsert(client, {
        ...person,
        tenantId: actor.identity.tenantId,
      });
      await client.query(
        "INSERT INTO app_admins(id,user_id,created_by) VALUES($1,$2,$3) ON CONFLICT (user_id) WHERE removed_at IS NULL DO NOTHING",
        [randomUUID(), user.id, actor.user.id],
      );
      return dto(
        (
          await client.query(`SELECT ${adminColumns} AND a.user_id=$1`, [
            user.id,
          ])
        ).rows[0],
      );
    });
    res.status(201).json(result);
  });
  router.delete("/admins/:userId", async (req, res) => {
    const actor = administrator(res);
    const userId = id(req, "userId");
    await transaction(db, async (client) => {
      const row = (
        await client.query(
          "SELECT id,master FROM app_admins WHERE user_id=$1 AND removed_at IS NULL FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, "Administrador não encontrado.");
      if (row.master)
        throw new HttpError(
          409,
          "O administrador master não pode ser removido.",
        );
      await client.query(
        "UPDATE app_admins SET removed_at=clock_timestamp(),removed_by=$2 WHERE id=$1",
        [row.id, actor.user.id],
      );
    });
    res.status(204).end();
  });
  router.get("/projects", async (_req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    const rows =
      actor.type === "user" && actor.admin
        ? await db.query(
            "SELECT p.*,p.icon_data_url AS icon,'owner' AS role FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC",
          )
        : await db.query(
            `SELECT p.*,p.icon_data_url AS icon,m.role FROM projects p JOIN project_members m ON m.project_id=p.id WHERE m.user_id=$1 AND p.deleted_at IS NULL AND ${activeMember} ORDER BY p.created_at DESC`,
            [user.id],
          );
    res.json(rows.rows.map(dto));
  });
  router.post("/projects", async (req, res) => {
    administrator(res);
    const input = projectInput.parse(req.body);
    validateProjectIcon(input.icon);
    // Administrators own every project without joining it; they add the team afterwards.
    const project = await transaction(db, async (client) => {
      const row = (
        await client.query(
          "INSERT INTO projects(id,name,description,icon_data_url) VALUES($1,$2,$3,$4) RETURNING *,icon_data_url AS icon",
          [randomUUID(), input.name, input.description, input.icon ?? null],
        )
      ).rows[0];
      await seedIssueStatuses(client, row.id);
      return { ...dto(row), role: "owner" };
    });
    res.status(201).json(project);
  });
  router.patch("/projects/:projectId", async (req, res) => {
    const input = projectInput.parse(req.body);
    validateProjectIcon(input.icon);
    const actor = actorOf(res);
    const project = await transaction(db, async (client) => {
      const row = await projectScope(client, id(req, "projectId"), actor, {
        owner: true,
        write: true,
        lock: true,
      });
      expectVersion(req, row);
      return dto(
        (
          await client.query(
            "UPDATE projects SET name=$2,description=$3,icon_data_url=$4,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *,icon_data_url AS icon",
            [
              row.id,
              input.name,
              input.description,
              input.icon === undefined ? row.icon_data_url : input.icon,
            ],
          )
        ).rows[0],
      );
    });
    res.json(project);
  });
  router.delete("/projects/:projectId", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    await transaction(db, async (client) => {
      const row = await projectScope(client, id(req, "projectId"), actor, {
        owner: true,
        lock: true,
      });
      expectVersion(req, row);
      await client.query(
        "UPDATE projects SET deleted_at=clock_timestamp(),deleted_by=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [row.id, user.id],
      );
    });
    res.status(204).end();
  });
  router.get("/projects/:projectId/members", async (req, res) => {
    const projectId = id(req, "projectId");
    await projectScope(db, projectId, actorOf(res));
    res.json(
      (
        await db.query(
          `SELECT u.*,m.role,CASE WHEN ${activeMember} THEN NULL ELSE m.blocked_at END AS blocked_at,CASE WHEN ${activeMember} THEN NULL ELSE m.blocked_until END AS blocked_until FROM users u JOIN project_members m ON m.user_id=u.id WHERE m.project_id=$1 ORDER BY u.name`,
          [projectId],
        )
      ).rows.map(dto),
    );
  });
  router.get("/projects/:projectId/members/:userId/photo", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    const projectId = id(req, "projectId");
    const userId = id(req, "userId");
    await projectScope(db, projectId, actor);
    const member = (
      await db.query(
        "SELECT u.oid FROM users u JOIN project_members m ON m.user_id=u.id WHERE m.project_id=$1 AND u.id=$2",
        [projectId, userId],
      )
    ).rows[0];
    if (!member) throw new HttpError(404, "Membro não encontrado.");
    if (!authentication.photo) return res.status(204).end();
    const photo = await authentication.photo(
      actor.type === "user" ? actor.identity.token : user.oid,
      member.oid,
    );
    if (!photo) return res.status(204).end();
    res.type(photo.type).send(photo.body);
  });
  router.get("/projects/:projectId/directory", async (req, res) => {
    const actor = actorOf(res);
    human(actor);
    await projectScope(db, id(req, "projectId"), actor, {
      owner: true,
      write: true,
    });
    const query = z.string().trim().min(2).max(100).parse(req.query.q);
    res.json(
      await authentication.search(
        actor.type === "user" ? actor.identity.token : "",
        query,
      ),
    );
  });
  router.post("/projects/:projectId/members", async (req, res) => {
    const actor = actorOf(res);
    human(actor);
    const input = memberInput.parse(req.body);
    const projectId = id(req, "projectId");
    await projectScope(db, projectId, actor, { owner: true, write: true });
    const person = await authentication.person(
      actor.type === "user" ? actor.identity.token : "",
      input.oid,
    );
    const result = await transaction(db, async (client) => {
      await projectScope(client, projectId, actor, {
        owner: true,
        write: true,
        lock: true,
      });
      const user = await userUpsert(client, {
        ...person,
        tenantId: actor.type === "user" ? actor.identity.tenantId : "",
      });
      const existing = (
        await client.query(
          "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2",
          [projectId, user.id],
        )
      ).rows[0];
      if (existing?.role === "owner" && input.role !== "owner") {
        const count = (
          await client.query(
            "SELECT count(*) FROM project_members WHERE project_id=$1 AND role='owner'",
            [projectId],
          )
        ).rows[0];
        if (Number(count.count) <= 1)
          throw new HttpError(
            409,
            "O projeto deve manter pelo menos um proprietário.",
          );
      }
      await client.query(
        "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
        [projectId, user.id, input.role],
      );
      if (existing && input.role === "viewer" && existing.role !== "viewer")
        await releaseAssignments(
          client,
          actor,
          projectId,
          user.id,
          "Responsável passou a só leitura.",
        );
      return { ...user, role: input.role };
    });
    res.status(201).json(result);
  });
  router.delete("/projects/:projectId/members/:userId", async (req, res) => {
    const actor = actorOf(res);
    const projectId = id(req, "projectId");
    const userId = id(req, "userId");
    await transaction(db, async (client) => {
      await projectScope(client, projectId, actor, {
        owner: true,
        write: true,
        lock: true,
      });
      const owners = (
        await client.query(
          "SELECT user_id FROM project_members WHERE project_id=$1 AND role='owner'",
          [projectId],
        )
      ).rows;
      if (owners.length === 1 && owners[0].user_id === userId)
        throw new HttpError(
          409,
          "O projeto deve manter pelo menos um proprietário.",
        );
      await releaseAssignments(
        client,
        actor,
        projectId,
        userId,
        "Responsável removido do projeto.",
      );
      await client.query(
        "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
        [projectId, userId],
      );
    });
    res.status(204).end();
  });
  router.patch("/projects/:projectId/members/:userId", async (req, res) => {
    const input = memberRoleInput.parse(req.body);
    const actor = actorOf(res);
    const projectId = id(req, "projectId");
    const userId = id(req, "userId");
    await transaction(db, async (client) => {
      const member = await managedMember(client, actor, projectId, userId);
      if (member.role === input.role) return;
      if (member.role === "owner" && (await ownerCount(client, projectId)) <= 1)
        throw new HttpError(
          409,
          "O projeto deve manter pelo menos um proprietário.",
        );
      await client.query(
        "UPDATE project_members SET role=$3 WHERE project_id=$1 AND user_id=$2",
        [projectId, userId, input.role],
      );
      if (input.role === "viewer")
        await releaseAssignments(
          client,
          actor,
          projectId,
          userId,
          "Responsável passou a só leitura.",
        );
    });
    res.status(204).end();
  });
  router.post(
    "/projects/:projectId/members/:userId/block",
    async (req, res) => {
      const input = memberBlockInput.parse(req.body ?? {});
      const actor = actorOf(res);
      const projectId = id(req, "projectId");
      const userId = id(req, "userId");
      if (input.until && new Date(input.until) <= new Date())
        throw new HttpError(400, "Escolha uma data de fim no futuro.");
      await transaction(db, async (client) => {
        const member = await managedMember(client, actor, projectId, userId);
        if (member.role === "owner")
          throw new HttpError(
            409,
            "Não pode bloquear um proprietário. Altere primeiro o papel.",
          );
        await client.query(
          "UPDATE project_members SET blocked_at=clock_timestamp(),blocked_until=$3,blocked_by=$4 WHERE project_id=$1 AND user_id=$2",
          [projectId, userId, input.until, human(actor).id],
        );
      });
      res.status(204).end();
    },
  );
  router.post(
    "/projects/:projectId/members/:userId/unblock",
    async (req, res) => {
      const actor = actorOf(res);
      const projectId = id(req, "projectId");
      const userId = id(req, "userId");
      await transaction(db, async (client) => {
        await managedMember(client, actor, projectId, userId);
        await client.query(
          "UPDATE project_members SET blocked_at=NULL,blocked_until=NULL,blocked_by=NULL WHERE project_id=$1 AND user_id=$2",
          [projectId, userId],
        );
      });
      res.status(204).end();
    },
  );
  router.get("/projects/:projectId/suites", async (req, res) => {
    const projectId = id(req, "projectId");
    await projectScope(db, projectId, actorOf(res));
    const filter = z
      .object({
        archive: z.enum(["active", "archived", "all"]).default("active"),
        q: z.string().max(200).default(""),
        status: multiFilter(statusSchema),
        assignee: z.union([z.string().uuid(), z.literal("all")]).default("all"),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
        sort: z.enum(["updated", "created", "title"]).default("updated"),
      })
      .parse(req.query);
    const rows = (
      await db.query(
        "SELECT * FROM suites WHERE project_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id",
        [projectId],
      )
    ).rows;
    const tests = (
      await db.query(
        "SELECT t.* FROM tests t JOIN suites s ON s.id=t.suite_id WHERE s.project_id=$1 AND t.deleted_at IS NULL ORDER BY t.position",
        [projectId],
      )
    ).rows;
    let items: Suite[] = rows
      .map((row) => {
        const children = tests.filter((test) => test.suite_id === row.id);
        return {
          ...dto(row),
          ...summarize(children.map((test) => test.status as Status)),
          tests: children.map((test) => testDto(test) as TestCase),
        } as Suite;
      })
      .filter(
        (suite) =>
          (filter.archive === "all" ||
            Boolean(suite.archivedAt) === (filter.archive === "archived")) &&
          (!filter.status.length || filter.status.includes(suite.status)) &&
          (filter.assignee === "all" ||
            suite.tests?.some((test) => test.assigneeId === filter.assignee)) &&
          `SU-${String(suite.number).padStart(2, "0")} ${suite.title} ${suite.description}`
            .toLocaleLowerCase("pt-PT")
            .includes(filter.q.toLocaleLowerCase("pt-PT")),
      );
    items.sort((a, b) =>
      filter.sort === "title"
        ? a.title.localeCompare(b.title, "pt-PT")
        : filter.sort === "created"
          ? b.createdAt.localeCompare(a.createdAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
    const total = items.length;
    items = items.slice(
      (filter.page - 1) * filter.pageSize,
      filter.page * filter.pageSize,
    );
    res.json({
      items: items.map(({ tests: _tests, ...suite }) => suite),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    });
  });
  router.get("/projects/:projectId/summary", async (req, res) => {
    const projectId = id(req, "projectId");
    await projectScope(db, projectId, actorOf(res));
    const rows = (
      await db.query(
        "SELECT s.id,coalesce(json_agg(t.status) FILTER (WHERE t.id IS NOT NULL),'[]') AS statuses FROM suites s LEFT JOIN tests t ON t.suite_id=s.id AND t.deleted_at IS NULL WHERE s.project_id=$1 AND s.archived_at IS NULL AND s.deleted_at IS NULL GROUP BY s.id",
        [projectId],
      )
    ).rows;
    const counts = { pending: 0, approved: 0, revoked: 0 };
    for (const row of rows) counts[summarize(row.statuses).status]++;
    const archived = Number(
      (
        await db.query(
          "SELECT count(*) FROM suites WHERE project_id=$1 AND archived_at IS NOT NULL AND deleted_at IS NULL",
          [projectId],
        )
      ).rows[0].count,
    );
    res.json({ total: rows.length, archived, counts });
  });
  router.post("/projects/:projectId/suites", async (req, res) => {
    const actor = actorOf(res);
    const projectId = id(req, "projectId");
    const input = suiteInput.parse(req.body);
    const idem =
      actor.type === "integration"
        ? z.string().trim().min(1).max(200).parse(req.get("Idempotency-Key"))
        : undefined;
    const result = await transaction(db, async (client) => {
      await projectScope(client, projectId, actor, { write: true, lock: true });
      if (actor.type === "integration") {
        const existing = (
          await client.query(
            "SELECT * FROM import_requests WHERE integration_key_id=$1 AND idempotency_key=$2",
            [actor.id, idem],
          )
        ).rows[0];
        if (existing) {
          if (existing.payload_hash !== digest(JSON.stringify(input)))
            throw new HttpError(
              409,
              "Esta chave de idempotência já foi usada com conteúdo diferente.",
            );
          return {
            suite: await snapshot(client, existing.suite_id),
            replay: true,
          };
        }
      }
      const suite = await newSuite(client, projectId, input, actor);
      if (actor.type === "integration")
        await client.query(
          "INSERT INTO import_requests(integration_key_id,idempotency_key,payload_hash,suite_id) VALUES($1,$2,$3,$4)",
          [actor.id, idem, digest(JSON.stringify(input)), suite.id],
        );
      return { suite, replay: false };
    });
    res.status(result.replay ? 200 : 201).json(result.suite);
  });
  router.get("/suites/:suiteId", async (req, res) => {
    const suiteId = id(req, "suiteId");
    await suiteScope(db, suiteId, actorOf(res));
    res.json(await snapshot(db, suiteId));
  });
  router.get("/suites/:suiteId/activity", async (req, res) => {
    const suiteId = id(req, "suiteId");
    await suiteScope(db, suiteId, actorOf(res));
    const testId = req.query.testId
      ? z.string().uuid().parse(req.query.testId)
      : null;
    const rows = (
      await db.query(
        "SELECT * FROM activities WHERE suite_id=$1 AND ($2::uuid IS NULL OR test_id=$2) ORDER BY created_at,id",
        [suiteId, testId],
      )
    ).rows;
    const attachments = (
      await db.query(
        "SELECT id,activity_id,file_name,content_type,size FROM attachments WHERE suite_id=$1 AND activity_id IS NOT NULL ORDER BY created_at,id",
        [suiteId],
      )
    ).rows;
    res.json(
      rows.map((row) => ({
        ...dto(row),
        attachments: attachments
          .filter((file) => file.activity_id === row.id)
          .map(({ activity_id: _activity, ...file }) => dto(file)),
      })),
    );
  });
  router.patch("/suites/:suiteId", async (req, res) => {
    const input = suiteEditInput.parse(req.body);
    const actor = actorOf(res);
    const suiteId = id(req, "suiteId");
    const result = await transaction(db, async (client) => {
      const { suite } = await suiteScope(client, suiteId, actor, {
        write: true,
        lock: true,
      });
      expectVersion(req, suite);
      await client.query(
        "UPDATE suites SET title=$2,description=$3 WHERE id=$1",
        [suiteId, input.title, input.description],
      );
      await touch(client, suiteId);
      const activityId = await event(client, suiteId, actor, "suite_edited");
      await notify(
        client,
        actor,
        "suite_edited",
        { projectId: suite.project_id, suiteId, activityId },
        await suitePeople(client, suiteId),
      );
      return snapshot(client, suiteId);
    });
    res.json(result);
  });
  router.post("/suites/:suiteId/duplicate", async (req, res) => {
    const actor = actorOf(res);
    const suiteId = id(req, "suiteId");
    const result = await transaction(db, async (client) => {
      const { suite, project } = await suiteScope(client, suiteId, actor, {
        lock: true,
      });
      const source = await snapshot(client, suiteId);
      const members = (
        await client.query(
          `SELECT m.user_id FROM project_members m WHERE m.project_id=$1 AND ${assignableMember}`,
          [project.id],
        )
      ).rows.map((row) => row.user_id);
      return newSuite(
        client,
        suite.project_id,
        {
          title: `${suite.title.slice(0, 191)} (cópia)`,
          description: suite.description,
          tests: source.tests!.map((test) => ({
            title: test.title,
            instructions: test.instructions,
            steps: test.steps.map((step) => step.body),
            expectedResult: test.expectedResult,
            assigneeId:
              test.assigneeId && members.includes(test.assigneeId)
                ? test.assigneeId
                : null,
          })),
        },
        actor,
      );
    });
    res.status(201).json(result);
  });
  type SuiteChange = "archive" | "restore" | "delete";
  /** Applies one change to a locked suite row; shared by the single and bulk routes. */
  async function changeSuite(
    client: Connection,
    actor: Actor,
    suite: Row,
    change: SuiteChange,
  ) {
    const user = human(actor);
    if (change === "delete") {
      const people = await suitePeople(client, suite.id);
      await client.query(
        "UPDATE suites SET deleted_at=clock_timestamp(),deleted_by=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [suite.id, user.id],
      );
      const activityId = await event(client, suite.id, actor, "suite_deleted");
      const members = (
        await client.query(
          "SELECT user_id FROM project_members WHERE project_id=$1",
          [suite.project_id],
        )
      ).rows.map((row) => row.user_id as string);
      await notify(
        client,
        actor,
        "suite_deleted",
        {
          projectId: suite.project_id,
          suiteId: suite.id,
          activityId,
          detail: { number: suite.number, title: suite.title },
        },
        [...people, ...members],
      );
      return;
    }
    await client.query(
      "UPDATE suites SET archived_at=$2,archived_by=$3 WHERE id=$1",
      [
        suite.id,
        change === "archive" ? new Date() : null,
        change === "archive" ? user.id : null,
      ],
    );
    await touch(client, suite.id);
    const kind = change === "archive" ? "suite_archived" : "suite_restored";
    const activityId = await event(client, suite.id, actor, kind);
    await notify(
      client,
      actor,
      kind,
      { projectId: suite.project_id, suiteId: suite.id, activityId },
      await testerIds(client, "suite_id", suite.id),
    );
  }
  for (const action of ["archive", "restore"] as const)
    router.post(`/suites/:suiteId/${action}`, async (req, res) => {
      const actor = actorOf(res);
      const suiteId = id(req, "suiteId");
      const result = await transaction(db, async (client) => {
        const { suite } = await suiteScope(client, suiteId, actor, {
          owner: true,
          lock: true,
        });
        if (Boolean(suite.archived_at) === (action === "archive"))
          return snapshot(client, suiteId);
        expectVersion(req, suite);
        await changeSuite(client, actor, suite, action);
        return snapshot(client, suiteId);
      });
      res.json(result);
    });
  // Owners (and administrators) change several suites in one transaction. Suites already in
  // the wanted state are skipped; one stale version refuses the whole batch.
  for (const [action, key] of [
    ["archive", "archived"],
    ["restore", "restored"],
    ["delete", "deleted"],
  ] as const)
    router.post(`/projects/:projectId/suites/${action}`, async (req, res) => {
      const input = suiteSelectionInput.parse(req.body);
      const projectId = id(req, "projectId");
      const actor = actorOf(res);
      const count = await transaction(db, async (client) => {
        await projectScope(client, projectId, actor, {
          owner: true,
          write: true,
          lock: true,
        });
        let changed = 0;
        const seen = new Set<string>();
        for (const item of input.suites) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          const suite = (
            await client.query(
              "SELECT * FROM suites WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL",
              [item.id, projectId],
            )
          ).rows[0];
          if (!suite) throw new HttpError(404, "Suite não encontrada.");
          if (
            (action === "archive" && suite.archived_at) ||
            (action === "restore" && !suite.archived_at)
          )
            continue;
          if (suite.version !== item.version)
            throw new HttpError(
              409,
              `A suite «${suite.title}» foi alterada por outra pessoa. Atualize a lista e tente de novo.`,
            );
          await changeSuite(client, actor, suite, action);
          changed++;
        }
        return changed;
      });
      res.json({ [key]: count });
    });
  router.post("/suites/:suiteId/tests", async (req, res) => {
    const input = testInput.parse(req.body);
    const actor = actorOf(res);
    const suiteId = id(req, "suiteId");
    const result = await transaction(db, async (client) => {
      const { suite } = await suiteScope(client, suiteId, actor, {
        write: true,
        lock: true,
      });
      expectVersion(req, suite);
      await assigned(client, suite.project_id, input.assigneeId);
      const position = Number(
        (
          await client.query(
            "SELECT coalesce(max(position),-1)+1 AS next FROM tests WHERE suite_id=$1 AND deleted_at IS NULL",
            [suiteId],
          )
        ).rows[0].next,
      );
      const { instructions, steps } = definition(input);
      const test = (
        await client.query(
          "INSERT INTO tests(id,suite_id,number,title,instructions,expected_result,assignee_id,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            suiteId,
            await nextNumber(client, "tests", suiteId),
            input.title,
            instructions,
            input.expectedResult,
            input.assigneeId || null,
            position,
          ],
        )
      ).rows[0];
      await insertSteps(client, test.id, steps);
      await touch(client, suiteId);
      const activityId = await event(
        client,
        suiteId,
        actor,
        "test_created",
        "",
        test.id,
      );
      const target = {
        projectId: suite.project_id,
        suiteId,
        testId: test.id,
        activityId,
      };
      await notify(client, actor, "assignment", target, [test.assignee_id]);
      await notify(
        client,
        actor,
        "test_added",
        target,
        await suitePeople(client, suiteId),
        [test.assignee_id].filter(Boolean),
      );
      return testDto(test);
    });
    res.status(201).json(result);
  });
  router.patch("/tests/:testId", async (req, res) => {
    const input = testInput
      .extend({ position: z.number().int().min(0).max(10000).optional() })
      .parse(req.body);
    const actor = actorOf(res);
    const result = await transaction(db, async (client) => {
      const { test, suite } = await testScope(client, id(req, "testId"), actor);
      expectVersion(req, test);
      await assigned(client, suite.project_id, input.assigneeId);
      const currentSteps = (
        await client.query(
          "SELECT body FROM test_steps WHERE test_id=$1 ORDER BY position,id",
          [test.id],
        )
      ).rows.map((row) => row.body as string);
      const stepsChanged =
        input.steps !== undefined &&
        JSON.stringify(input.steps) !== JSON.stringify(currentSteps);
      const changed =
        stepsChanged ||
        test.instructions !== input.instructions ||
        test.expected_result !== input.expectedResult;
      if (stepsChanged) {
        await client.query("DELETE FROM test_steps WHERE test_id=$1", [
          test.id,
        ]);
        await insertSteps(client, test.id, input.steps!);
      }
      if (input.position !== undefined && input.position !== test.position) {
        const count = Number(
          (
            await client.query(
              "SELECT count(*) FROM tests WHERE suite_id=$1 AND deleted_at IS NULL",
              [suite.id],
            )
          ).rows[0].count,
        );
        if (input.position >= count)
          throw new HttpError(400, "Posição fora da checklist.");
        await client.query(
          "UPDATE tests SET position=position+$4,version=version+1,updated_at=clock_timestamp() WHERE suite_id=$1 AND id<>$2 AND deleted_at IS NULL AND position BETWEEN $3 AND $5",
          [
            suite.id,
            test.id,
            Math.min(test.position, input.position),
            input.position < test.position ? 1 : -1,
            Math.max(test.position, input.position),
          ],
        );
      }
      const row = (
        await client.query(
          "UPDATE tests SET title=$2,instructions=$3,expected_result=$4,assignee_id=$5,status=$6,position=$7,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",
          [
            test.id,
            input.title,
            input.instructions,
            input.expectedResult,
            input.assigneeId === undefined
              ? test.assignee_id
              : input.assigneeId,
            changed ? "pending" : test.status,
            input.position ?? test.position,
          ],
        )
      ).rows[0];
      const reassigned =
        input.assigneeId !== undefined && input.assigneeId !== test.assignee_id;
      if (
        changed ||
        test.title !== input.title ||
        input.position !== undefined
      ) {
        const activityId = await event(
          client,
          suite.id,
          actor,
          "test_edited",
          "",
          test.id,
          { resetToPending: changed, previousStatus: test.status },
        );
        // Reordering alone is not worth a notification.
        if (changed || test.title !== input.title)
          await notify(
            client,
            actor,
            "test_edited",
            {
              projectId: suite.project_id,
              suiteId: suite.id,
              testId: test.id,
              activityId,
              detail: { resetToPending: changed },
            },
            [
              test.assignee_id,
              ...(await testerIds(client, "test_id", test.id)),
            ],
            reassigned && input.assigneeId ? [input.assigneeId] : [],
          );
      }
      if (reassigned) {
        const activityId = await event(
          client,
          suite.id,
          actor,
          "assignment_changed",
          "",
          test.id,
          {
            previousAssigneeId: test.assignee_id,
            assigneeId: input.assigneeId,
          },
        );
        await notify(
          client,
          actor,
          "assignment",
          {
            projectId: suite.project_id,
            suiteId: suite.id,
            testId: test.id,
            activityId,
          },
          [input.assigneeId],
        );
      }
      await touch(client, suite.id);
      return testDto(row);
    });
    res.json(result);
  });
  router.post("/tests/:testId/result", async (req, res) => {
    const input = resultInput.parse(req.body);
    const actor = actorOf(res);
    const result = await transaction(db, async (client) => {
      const { test, suite } = await testScope(client, id(req, "testId"), actor);
      expectVersion(req, test);
      const mentions = await mentioned(
        client,
        suite.project_id,
        input.mentions,
      );
      const row = (
        await client.query(
          "UPDATE tests SET status=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *",
          [test.id, input.status],
        )
      ).rows[0];
      const activityId = await event(
        client,
        suite.id,
        actor,
        "result_recorded",
        input.comment || "",
        test.id,
        { previousStatus: test.status, status: input.status, mentions },
      );
      await linkAttachments(client, actor, input.attachmentIds, {
        suiteId: suite.id,
        testId: test.id,
        activityId,
      });
      const target = {
        projectId: suite.project_id,
        suiteId: suite.id,
        testId: test.id,
        activityId,
      };
      await notify(
        client,
        actor,
        "mention",
        { ...target, detail: { excerpt: excerpt(input.comment || "") } },
        mentions,
      );
      await notify(
        client,
        actor,
        "result",
        { ...target, detail: { status: input.status } },
        [test.assignee_id, ...(await testerIds(client, "test_id", test.id))],
        mentions,
      );
      await touch(client, suite.id);
      return testDto(row);
    });
    res.json(result);
  });
  async function comment(
    client: Connection,
    actor: Actor,
    input: z.infer<typeof commentInput>,
    suite: Row,
    test: Row | null,
  ) {
    human(actor);
    const mentions = await mentioned(client, suite.project_id, input.mentions);
    const activityId = await event(
      client,
      suite.id,
      actor,
      "comment",
      input.body,
      test?.id ?? null,
      mentions.length ? { mentions } : {},
    );
    await linkAttachments(client, actor, input.attachmentIds, {
      suiteId: suite.id,
      testId: test?.id ?? null,
      activityId,
    });
    const target = {
      projectId: suite.project_id,
      suiteId: suite.id,
      testId: test?.id ?? null,
      activityId,
      detail: { excerpt: excerpt(input.body) },
    };
    await notify(client, actor, "mention", target, mentions);
    await notify(
      client,
      actor,
      "comment",
      target,
      test
        ? [test.assignee_id, ...(await testerIds(client, "test_id", test.id))]
        : await testerIds(client, "suite_id", suite.id),
      mentions,
    );
    await touch(client, suite.id);
    return activityId;
  }
  router.post("/suites/:suiteId/comments", async (req, res) => {
    const input = commentInput.parse(req.body);
    const suiteId = id(req, "suiteId");
    const actor = actorOf(res);
    const activityId = await transaction(db, async (client) => {
      const { suite } = await suiteScope(client, suiteId, actor, {
        write: true,
        lock: true,
      });
      return comment(client, actor, input, suite, null);
    });
    res.status(201).json({ ok: true, id: activityId });
  });
  router.post("/tests/:testId/comments", async (req, res) => {
    const input = commentInput.parse(req.body);
    const actor = actorOf(res);
    const activityId = await transaction(db, async (client) => {
      const { test, suite } = await testScope(client, id(req, "testId"), actor);
      return comment(client, actor, input, suite, test);
    });
    res.status(201).json({ ok: true, id: activityId });
  });
  router.delete("/suites/:suiteId", async (req, res) => {
    const actor = actorOf(res);
    const suiteId = id(req, "suiteId");
    await transaction(db, async (client) => {
      // Owners only; archived suites can also be deleted. Deletion is logical.
      const { suite } = await suiteScope(client, suiteId, actor, {
        owner: true,
        lock: true,
      });
      expectVersion(req, suite);
      await changeSuite(client, actor, suite, "delete");
    });
    res.status(204).end();
  });
  router.delete("/tests/:testId", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    await transaction(db, async (client) => {
      const { test, suite, project } = await testScope(
        client,
        id(req, "testId"),
        actor,
      );
      if (project.role !== "owner" && test.assignee_id !== user.id)
        throw new HttpError(
          403,
          "Só os proprietários e o responsável do teste o podem apagar.",
        );
      expectVersion(req, test);
      const people = [
        test.assignee_id,
        ...(await testerIds(client, "test_id", test.id)),
      ];
      await client.query(
        "UPDATE tests SET deleted_at=clock_timestamp(),deleted_by=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [test.id, user.id],
      );
      // Keep the visible checklist contiguous; the TC number is never reused.
      await client.query(
        "UPDATE tests SET position=position-1 WHERE suite_id=$1 AND deleted_at IS NULL AND position>$2",
        [suite.id, test.position],
      );
      const activityId = await event(
        client,
        suite.id,
        actor,
        "test_deleted",
        "",
        test.id,
        { number: test.number, title: test.title },
      );
      await touch(client, suite.id);
      await notify(
        client,
        actor,
        "test_deleted",
        {
          projectId: suite.project_id,
          suiteId: suite.id,
          testId: test.id,
          activityId,
          detail: { number: test.number, title: test.title },
        },
        people,
      );
    });
    res.status(204).end();
  });
  router.post("/tests/:testId/steps/:stepId/result", async (req, res) => {
    const input = stepResultInput.parse(req.body);
    const actor = actorOf(res);
    const user = human(actor);
    const result = await transaction(db, async (client) => {
      const { test, suite } = await testScope(client, id(req, "testId"), actor);
      const step = (
        await client.query(
          "SELECT * FROM test_steps WHERE id=$1 AND test_id=$2",
          [id(req, "stepId"), test.id],
        )
      ).rows[0];
      if (!step) throw new HttpError(404, "Passo não encontrado.");
      expectVersion(req, step);
      const row = (
        await client.query(
          "UPDATE test_steps SET status=$2,updated_by=$3,updated_by_name=$4,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING id,position,body,status,updated_by_name,updated_at,version",
          [step.id, input.status, user.id, user.name],
        )
      ).rows[0];
      await client.query(
        "UPDATE tests SET updated_at=clock_timestamp() WHERE id=$1",
        [test.id],
      );
      await event(client, suite.id, actor, "step_recorded", "", test.id, {
        stepId: step.id,
        step: step.position + 1,
        previousStatus: step.status,
        status: input.status,
      });
      await touch(client, suite.id);
      return dto(row);
    });
    res.json(result);
  });
  router.post(
    "/suites/:suiteId/attachments",
    express.raw({ type: "application/octet-stream", limit: maxAttachment }),
    async (req, res) => {
      const actor = actorOf(res);
      const user = human(actor);
      const suiteId = id(req, "suiteId");
      const testId = req.query.testId
        ? z.string().uuid().parse(req.query.testId)
        : null;
      let fileName: string;
      try {
        fileName = decodeURIComponent(req.get("X-File-Name") || "");
      } catch {
        fileName = "";
      }
      fileName = fileName
        .replace(/[\u0000-\u001f\u007f/\\]/g, "")
        .trim()
        .slice(-200);
      if (!fileName) throw new HttpError(400, "Indique o nome do ficheiro.");
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const contentType = checkAttachment(fileName, data);
      const result = await transaction(db, async (client) => {
        const { suite } = await suiteScope(client, suiteId, actor, {
          write: true,
        });
        if (
          testId &&
          !(
            await client.query(
              "SELECT 1 FROM tests WHERE id=$1 AND suite_id=$2 AND deleted_at IS NULL",
              [testId, suiteId],
            )
          ).rows.length
        )
          throw new HttpError(404, "Teste não encontrado.");
        return dto(
          (
            await client.query(
              "INSERT INTO attachments(id,project_id,suite_id,test_id,uploaded_by,file_name,content_type,size,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,file_name,content_type,size",
              [
                randomUUID(),
                suite.project_id,
                suiteId,
                testId,
                user.id,
                fileName,
                contentType,
                data.length,
                data,
              ],
            )
          ).rows[0],
        );
      });
      res.status(201).json(result);
    },
  );
  async function attachmentScope(req: Request, res: Response) {
    const actor = actorOf(res);
    const user = human(actor);
    const file = (
      await db.query(
        "SELECT id,suite_id,issue_id,activity_id,uploaded_by,file_name,content_type,size FROM attachments WHERE id=$1",
        [id(req, "attachmentId")],
      )
    ).rows[0];
    if (!file) throw new HttpError(404, "Anexo não encontrado.");
    if (file.issue_id) await issueScope(db, file.issue_id, actor);
    else await suiteScope(db, file.suite_id, actor);
    // Uploads that were never published stay private to their author.
    if (!file.activity_id && file.uploaded_by !== user.id)
      throw new HttpError(404, "Anexo não encontrado.");
    return { file, user };
  }
  router.get("/attachments/:attachmentId", async (req, res) => {
    const { file } = await attachmentScope(req, res);
    const data = (
      await db.query("SELECT data FROM attachments WHERE id=$1", [file.id])
    ).rows[0].data;
    const inline = file.content_type.startsWith("image/");
    res.set({
      "Content-Type": file.content_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(Buffer.from(data));
  });
  router.delete("/attachments/:attachmentId", async (req, res) => {
    const { file, user } = await attachmentScope(req, res);
    if (file.activity_id || file.uploaded_by !== user.id)
      throw new HttpError(
        409,
        "Só pode remover anexos seus que ainda não foram publicados.",
      );
    await db.query(
      "DELETE FROM attachments WHERE id=$1 AND activity_id IS NULL",
      [file.id],
    );
    res.status(204).end();
  });
  const visibleNotifications = `FROM notifications n JOIN projects p ON p.id=n.project_id AND p.deleted_at IS NULL JOIN project_members m ON m.project_id=n.project_id AND m.user_id=n.user_id AND ${activeMember} LEFT JOIN suites s ON s.id=n.suite_id LEFT JOIN tests t ON t.id=n.test_id LEFT JOIN issues i ON i.id=n.issue_id WHERE n.user_id=$1`;
  router.get("/notifications", async (req, res) => {
    const user = human(actorOf(res));
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .parse(req.query.limit);
    const items = (
      await db.query(
        `SELECT n.id,n.kind,n.actor_name,n.detail,n.created_at,n.read_at,n.project_id,p.name AS project_name,n.suite_id,s.number AS suite_number,s.title AS suite_title,s.deleted_at IS NOT NULL AS suite_deleted,n.test_id,t.number AS test_number,t.title AS test_title,t.deleted_at IS NOT NULL AS test_deleted,n.issue_id,i.number AS issue_number,i.title AS issue_title,coalesce(i.deleted_at IS NOT NULL,false) AS issue_deleted,n.activity_id ${visibleNotifications} ORDER BY n.created_at DESC,n.id DESC LIMIT $2`,
        [user.id, limit],
      )
    ).rows.map(dto);
    const unread = Number(
      (
        await db.query(
          `SELECT count(*) ${visibleNotifications} AND n.read_at IS NULL`,
          [user.id],
        )
      ).rows[0].count,
    );
    res.json({ items, unread });
  });
  router.post("/notifications/read-all", async (_req, res) => {
    const user = human(actorOf(res));
    await db.query(
      "UPDATE notifications SET read_at=clock_timestamp() WHERE user_id=$1 AND read_at IS NULL",
      [user.id],
    );
    res.status(204).end();
  });
  router.post("/notifications/:notificationId/read", async (req, res) => {
    const user = human(actorOf(res));
    const updated = await db.query(
      "UPDATE notifications SET read_at=coalesce(read_at,clock_timestamp()) WHERE id=$1 AND user_id=$2",
      [id(req, "notificationId"), user.id],
    );
    if (!updated.rowCount)
      throw new HttpError(404, "Notificação não encontrada.");
    res.status(204).end();
  });
  router.get("/search", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    const admin = actor.type === "user" && actor.admin;
    // Two characters minimum, except a bare number ("7" finds IS-7).
    const query = z
      .string()
      .trim()
      .max(100)
      .refine((value) => value.length >= 2 || /^\d$/.test(value))
      .parse(req.query.q);
    const pattern = likePattern(query);
    const suiteNumber = query.match(/^su-?0*(\d{1,6})$/i)?.[1];
    const testNumber = query.match(/^tc-?(\d{1,6})$/i)?.[1];
    const issueNumber = query.match(/^is-?(\d{1,6})$/i)?.[1];
    const bareNumber = query.match(/^#?(\d{1,6})$/)?.[1];
    // Administrators search every project; $1 stays referenced so its type is known.
    const member = `(${admin ? "TRUE" : "FALSE"} OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1 AND ${activeMember}))`;
    const issueAccess = `JOIN projects p ON p.id=i.project_id AND p.deleted_at IS NULL AND ${member}`;
    const access = `JOIN projects p ON p.id=s.project_id AND p.deleted_at IS NULL AND ${member}`;
    const suites = (
      await db.query(
        `SELECT s.id,s.project_id,p.name AS project_name,s.number,s.title,s.archived_at IS NOT NULL AS archived FROM suites s ${access} WHERE s.deleted_at IS NULL AND (${suiteNumber ? "s.number=$2" : "s.title ILIKE $2 ESCAPE '\\' OR s.description ILIKE $2 ESCAPE '\\'"}) ORDER BY s.archived_at IS NOT NULL,s.updated_at DESC LIMIT 8`,
        suiteNumber ? [user.id, Number(suiteNumber)] : [user.id, pattern],
      )
    ).rows.map(dto);
    const tests = (
      await db.query(
        `SELECT t.id,t.suite_id,s.project_id,p.name AS project_name,s.number AS suite_number,s.title AS suite_title,t.number,t.title FROM tests t JOIN suites s ON s.id=t.suite_id ${access} WHERE s.deleted_at IS NULL AND t.deleted_at IS NULL AND (${testNumber ? "t.number=$2" : "t.title ILIKE $2 ESCAPE '\\' OR t.instructions ILIKE $2 ESCAPE '\\' OR EXISTS (SELECT 1 FROM test_steps st WHERE st.test_id=t.id AND st.body ILIKE $2 ESCAPE '\\')"}) ORDER BY s.archived_at IS NOT NULL,t.updated_at DESC LIMIT 8`,
        testNumber ? [user.id, Number(testNumber)] : [user.id, pattern],
      )
    ).rows.map(dto);
    const issues =
      suiteNumber || testNumber
        ? []
        : (
            await db.query(
              `SELECT i.id,i.project_id,p.name AS project_name,i.number,i.title,i.archived_at IS NOT NULL AS archived FROM issues i ${issueAccess} WHERE i.deleted_at IS NULL AND (${issueNumber ? "i.number=$2" : `i.title ILIKE $2 ESCAPE '\\' OR i.description ILIKE $2 ESCAPE '\\'${bareNumber ? " OR i.number=$3" : ""}`}) ORDER BY ${bareNumber ? "i.number=$3 DESC," : ""}i.archived_at IS NOT NULL,i.updated_at DESC LIMIT 8`,
              issueNumber
                ? [user.id, Number(issueNumber)]
                : bareNumber
                  ? [user.id, pattern, Number(bareNumber)]
                  : [user.id, pattern],
            )
          ).rows.map(dto);
    const issueComments =
      suiteNumber || testNumber || issueNumber
        ? []
        : (
            await db.query(
              `SELECT a.id,a.issue_id,i.project_id,p.name AS project_name,i.number AS issue_number,a.actor_name,a.body,a.created_at FROM activities a JOIN issues i ON i.id=a.issue_id ${issueAccess} WHERE i.deleted_at IS NULL AND a.kind='comment' AND a.body ILIKE $2 ESCAPE '\\' ORDER BY a.created_at DESC LIMIT 8`,
              [user.id, pattern],
            )
          ).rows;
    const comments =
      suiteNumber || testNumber || issueNumber
        ? []
        : (
            await db.query(
              `SELECT a.id,a.suite_id,a.test_id,s.project_id,p.name AS project_name,s.number AS suite_number,t.number AS test_number,a.actor_name,a.body,a.created_at FROM activities a JOIN suites s ON s.id=a.suite_id ${access} LEFT JOIN tests t ON t.id=a.test_id WHERE s.deleted_at IS NULL AND t.deleted_at IS NULL AND a.kind IN ('comment','result_recorded') AND a.body ILIKE $2 ESCAPE '\\' ORDER BY a.created_at DESC LIMIT 8`,
              [user.id, pattern],
            )
          ).rows;
    const snippet = ({ body, ...row }: Row) => {
      const text = excerpt(body);
      const at = text
        .toLocaleLowerCase("pt-PT")
        .indexOf(query.toLocaleLowerCase("pt-PT"));
      return {
        suiteId: null,
        testId: null,
        issueId: null,
        suiteNumber: null,
        testNumber: null,
        issueNumber: null,
        ...dto(row),
        excerpt: at > 60 ? `…${text.slice(at - 40, at + 120)}` : text,
      };
    };
    const allComments = [...comments, ...issueComments]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 8)
      .map(snippet);
    res.json({ suites, tests, issues, comments: allComments });
  });
  router.get("/projects/:projectId/keys", async (req, res) => {
    const projectId = id(req, "projectId");
    await projectScope(db, projectId, actorOf(res), { owner: true });
    res.json(
      (
        await db.query(
          "SELECT id,name,created_at,revoked_at FROM integration_keys WHERE project_id=$1 ORDER BY created_at DESC",
          [projectId],
        )
      ).rows.map(dto),
    );
  });
  router.post("/projects/:projectId/keys", async (req, res) => {
    const input = keyInput.parse(req.body);
    const projectId = id(req, "projectId");
    const actor = actorOf(res);
    const user = human(actor);
    const secret = `th_${randomBytes(32).toString("base64url")}`;
    const result = await transaction(db, async (client) => {
      await projectScope(client, projectId, actor, {
        owner: true,
        write: true,
        lock: true,
      });
      return dto(
        (
          await client.query(
            "INSERT INTO integration_keys(id,project_id,name,secret_hash,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name,created_at,revoked_at",
            [randomUUID(), projectId, input.name, digest(secret), user.id],
          )
        ).rows[0],
      );
    });
    res.status(201).json({ ...result, secret });
  });
  router.post("/projects/:projectId/keys/:keyId/revoke", async (req, res) => {
    const projectId = id(req, "projectId");
    await transaction(db, async (client) => {
      await projectScope(client, projectId, actorOf(res), {
        owner: true,
        lock: true,
      });
      await client.query(
        "UPDATE integration_keys SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND project_id=$2",
        [id(req, "keyId"), projectId],
      );
    });
    res.json({ ok: true });
  });
  issueRoutes(router, db);
  router.use((_req, _res, next) =>
    next(new HttpError(404, "Operação não encontrada.")),
  );
  router.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ZodError) {
        res
          .status(400)
          .json({ error: "Dados inválidos.", fields: error.flatten() });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "JSON inválido." });
        return;
      }
      if ((error as Row)?.type === "entity.too.large") {
        res.status(413).json({
          error:
            "O pedido excede o limite permitido (2 MB por pedido, 10 MB por anexo).",
        });
        return;
      }
      console.error(
        "Erro na API:",
        error instanceof Error ? error.message : "Erro desconhecido",
      );
      res.status(503).json({
        error:
          "Serviço indisponível. Confirme a ligação à base de dados e as migrações.",
      });
    },
  );
  return router;
}
