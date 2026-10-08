// Development area: per-project issues with configurable statuses, modules and labels.
// Follows the suite/test rules: project row lock for writes, If-Match versions, activity in
// the same transaction, logical deletion, archived items read-only.
import express, { type Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  commentInput,
  issueArchiveInput,
  issueAssigneesInput,
  issueSelectionInput,
  issueImportInput,
  issueInput,
  issuePatchInput,
  issueStatusInput,
  issueTagInput,
  multiFilter,
  boardPreferenceInput,
  boardPreferencePattern,
  preferenceInput,
  preferenceKeys,
  type Issue,
  type IssueConfig,
  type IssueImportResult,
} from "../shared/contracts";
import { transaction, type Connection, type Database } from "./db";
import { HttpError, type Actor } from "./auth";
import {
  actorName,
  actorOf,
  assignableMember,
  checkAttachment,
  digest,
  dto,
  excerpt,
  expectVersion,
  human,
  id,
  likePattern,
  maxAttachment,
  mentioned,
  notify,
  projectScope,
  type Row,
} from "./api";

/** Workflow given to every new project; owners can change it in Definições. */
export const defaultIssueStatuses = [
  { name: "Backlog", color: "gray", category: "todo" },
  { name: "Em análise", color: "purple", category: "todo" },
  { name: "A aguardar informação", color: "amber", category: "todo" },
  { name: "Em curso", color: "blue", category: "doing" },
  { name: "Para testar", color: "teal", category: "doing" },
  { name: "Resolvido", color: "green", category: "done" },
  { name: "Fechado", color: "gray", category: "done" },
  { name: "Duplicado", color: "gray", category: "done" },
] as const;
export async function seedIssueStatuses(db: Connection, projectId: string) {
  for (const [position, status] of defaultIssueStatuses.entries())
    await db.query(
      "INSERT INTO issue_statuses(id,project_id,name,color,category,position) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        projectId,
        status.name,
        status.color,
        status.category,
        position,
      ],
    );
}

const tables = {
  statuses: "issue_statuses",
  modules: "issue_modules",
  labels: "issue_labels",
} as const;
type ConfigKind = keyof typeof tables;
const configLabels: Record<ConfigKind, string> = {
  statuses: "estado",
  modules: "módulo",
  labels: "label",
};
/** Positions within a board column never include archived or deleted issues. */
const column =
  "project_id=$1 AND status_id=$2 AND deleted_at IS NULL AND archived_at IS NULL";
const unique = <T>(list: T[]) => [...new Set(list)];
const uniqueViolation = (error: unknown) => (error as Row)?.code === "23505";

export async function issueScope(
  db: Connection | Database,
  issueId: string,
  actor: Actor,
  options: { owner?: boolean; write?: boolean; lock?: boolean } = {},
) {
  const initial = (
    await db.query(
      "SELECT project_id FROM issues WHERE id=$1 AND deleted_at IS NULL",
      [issueId],
    )
  ).rows[0];
  if (!initial) throw new HttpError(404, "Issue não encontrado.");
  const project = await projectScope(db, initial.project_id, actor, options);
  const issue = (await db.query("SELECT * FROM issues WHERE id=$1", [issueId]))
    .rows[0];
  if (options.write && issue.archived_at)
    throw new HttpError(
      409,
      "Este issue está arquivado e é apenas de leitura.",
    );
  return { issue, project };
}
async function issueEvent(
  db: Connection,
  issueId: string,
  actor: Actor,
  kind: string,
  body = "",
  detail: Row = {},
) {
  const activityId = randomUUID();
  await db.query(
    "INSERT INTO activities(id,issue_id,actor_id,actor_name,kind,body,detail) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      activityId,
      issueId,
      actor.type === "user" ? actor.user.id : null,
      actorName(actor),
      kind,
      body,
      JSON.stringify(detail),
    ],
  );
  return activityId;
}
async function touch(db: Connection, issueId: string) {
  await db.query(
    "UPDATE issues SET updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
    [issueId],
  );
}
async function count(db: Connection, sql: string, values: unknown[]) {
  return Number((await db.query(sql, values)).rows[0].count);
}
async function nextIssueNumber(db: Connection, projectId: string) {
  return count(
    db,
    "SELECT coalesce(max(number),0)+1 AS count FROM issues WHERE project_id=$1",
    [projectId],
  );
}
const columnSize = (db: Connection, projectId: string, statusId: string) =>
  count(db, `SELECT count(*) FROM issues WHERE ${column}`, [
    projectId,
    statusId,
  ]);
async function config(
  db: Connection | Database,
  projectId: string,
): Promise<IssueConfig> {
  const load = async (table: string) =>
    (
      await db.query(
        `SELECT * FROM ${table} WHERE project_id=$1 AND deleted_at IS NULL ORDER BY position,created_at,id`,
        [projectId],
      )
    ).rows.map(({ deleted_at: _deleted, created_at: _created, ...row }) =>
      dto(row),
    );
  return {
    statuses: (await load(tables.statuses)) as IssueConfig["statuses"],
    modules: (await load(tables.modules)) as IssueConfig["modules"],
    labels: (await load(tables.labels)) as IssueConfig["labels"],
  };
}
async function defaultStatus(db: Connection, projectId: string) {
  const row = (
    await db.query(
      "SELECT id FROM issue_statuses WHERE project_id=$1 AND deleted_at IS NULL ORDER BY category='todo' DESC,position LIMIT 1",
      [projectId],
    )
  ).rows[0];
  if (!row)
    throw new HttpError(409, "Configure pelo menos um estado nas Definições.");
  return row.id as string;
}
async function checkStatus(
  db: Connection,
  projectId: string,
  statusId: string,
) {
  const row = (
    await db.query(
      "SELECT id,name FROM issue_statuses WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL",
      [statusId, projectId],
    )
  ).rows[0];
  if (!row) throw new HttpError(400, "Estado inválido para este projeto.");
  return row as { id: string; name: string };
}
async function checkTags(
  db: Connection,
  kind: "modules" | "labels",
  projectId: string,
  ids: string[],
) {
  if (!ids.length) return;
  const found = await count(
    db,
    `SELECT count(*) FROM ${tables[kind]} WHERE project_id=$1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
    [projectId, ids],
  );
  if (found !== ids.length)
    throw new HttpError(
      400,
      `Um dos ${kind === "modules" ? "módulos" : "labels"} não existe neste projeto.`,
    );
}
async function checkMembers(db: Connection, projectId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await count(
    db,
    `SELECT count(*) FROM project_members m WHERE m.project_id=$1 AND m.user_id = ANY($2::uuid[]) AND ${assignableMember}`,
    [projectId, ids],
  );
  if (found !== ids.length)
    throw new HttpError(
      400,
      "Os responsáveis devem ser membros do projeto com permissão de edição.",
    );
}
/** Removes a member from the active issues they work on (left the project or became read-only). */
export async function releaseIssueAssignments(
  db: Connection,
  actor: Actor,
  projectId: string,
  userId: string,
) {
  const issues = (
    await db.query(
      "SELECT i.id FROM issue_assignees a JOIN issues i ON i.id=a.issue_id WHERE i.project_id=$1 AND a.user_id=$2 AND i.deleted_at IS NULL AND i.archived_at IS NULL",
      [projectId, userId],
    )
  ).rows;
  for (const issue of issues) {
    await db.query(
      "DELETE FROM issue_assignees WHERE issue_id=$1 AND user_id=$2",
      [issue.id, userId],
    );
    await touch(db, issue.id);
    await issueEvent(db, issue.id, actor, "issue_assigned", "", {
      added: [],
      removed: [userId],
    });
  }
}
async function setLinks(
  db: Connection,
  kind: "modules" | "labels",
  issueId: string,
  ids: string[],
) {
  const [table, key] =
    kind === "modules"
      ? ["issue_module_links", "module_id"]
      : ["issue_label_links", "label_id"];
  await db.query(`DELETE FROM ${table} WHERE issue_id=$1`, [issueId]);
  for (const value of ids)
    await db.query(`INSERT INTO ${table}(issue_id,${key}) VALUES($1,$2)`, [
      issueId,
      value,
    ]);
}
async function assigneeIds(db: Connection, issueId: string) {
  return (
    await db.query("SELECT user_id FROM issue_assignees WHERE issue_id=$1", [
      issueId,
    ])
  ).rows.map((row) => row.user_id as string);
}
/** Reporter, assignees and anyone who already commented. */
async function issuePeople(db: Connection, issue: Row) {
  const commenters = (
    await db.query(
      "SELECT DISTINCT actor_id FROM activities WHERE issue_id=$1 AND kind='comment' AND actor_id IS NOT NULL",
      [issue.id],
    )
  ).rows.map((row) => row.actor_id as string);
  return [
    issue.reporter_id as string,
    ...(await assigneeIds(db, issue.id)),
    ...commenters,
  ];
}

const issueColumns =
  "i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.priority,i.estimate,i.reported_at,to_char(i.deployed_at,'YYYY-MM-DD') AS deployed_at,i.reporter_id,u.name AS reporter_name,i.reporter_note,i.external_ref,i.position,i.created_at,i.updated_at,i.archived_at,i.version,(SELECT count(*) FROM activities a WHERE a.issue_id=i.id AND a.kind='comment') AS comments";
async function hydrate(
  db: Connection | Database,
  rows: Row[],
): Promise<Issue[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const people = (
    await db.query(
      "SELECT a.issue_id,u.id,u.name FROM issue_assignees a JOIN users u ON u.id=a.user_id WHERE a.issue_id = ANY($1::uuid[]) ORDER BY a.assigned_at,u.name",
      [ids],
    )
  ).rows;
  const modules = (
    await db.query(
      "SELECT l.issue_id,l.module_id AS id FROM issue_module_links l JOIN issue_modules m ON m.id=l.module_id AND m.deleted_at IS NULL WHERE l.issue_id = ANY($1::uuid[]) ORDER BY m.position",
      [ids],
    )
  ).rows;
  const labels = (
    await db.query(
      "SELECT l.issue_id,l.label_id AS id FROM issue_label_links l JOIN issue_labels m ON m.id=l.label_id AND m.deleted_at IS NULL WHERE l.issue_id = ANY($1::uuid[]) ORDER BY m.position",
      [ids],
    )
  ).rows;
  return rows.map((row) => ({
    ...(dto(row) as Issue),
    estimate: row.estimate === null ? null : Number(row.estimate),
    comments: Number(row.comments),
    assignees: people
      .filter((person) => person.issue_id === row.id)
      .map((person) => ({ id: person.id, name: person.name })),
    moduleIds: modules
      .filter((link) => link.issue_id === row.id)
      .map((link) => link.id),
    labelIds: labels
      .filter((link) => link.issue_id === row.id)
      .map((link) => link.id),
  }));
}
async function loadIssue(db: Connection | Database, issueId: string) {
  const rows = (
    await db.query(
      `SELECT ${issueColumns} FROM issues i JOIN users u ON u.id=i.reporter_id WHERE i.id=$1`,
      [issueId],
    )
  ).rows;
  return (await hydrate(db, rows))[0];
}
/** Moves an issue to `target` within `statusId`, keeping both columns contiguous. */
async function place(
  db: Connection,
  issue: Row,
  statusId: string,
  target?: number,
) {
  if (issue.archived_at) {
    await db.query("UPDATE issues SET status_id=$2 WHERE id=$1", [
      issue.id,
      statusId,
    ]);
    return;
  }
  const same = statusId === issue.status_id;
  const size =
    (await columnSize(db, issue.project_id, statusId)) - (same ? 1 : 0);
  const position = Math.min(Math.max(target ?? size, 0), size);
  if (same && position === issue.position) return;
  // Leave the old slot, then open the new one.
  await db.query(
    `UPDATE issues SET position=position-1 WHERE ${column} AND position>$3 AND id<>$4`,
    [issue.project_id, issue.status_id, issue.position, issue.id],
  );
  await db.query(
    `UPDATE issues SET position=position+1 WHERE ${column} AND position>=$3 AND id<>$4`,
    [issue.project_id, statusId, position, issue.id],
  );
  await db.query("UPDATE issues SET status_id=$2,position=$3 WHERE id=$1", [
    issue.id,
    statusId,
    position,
  ]);
}
async function leaveColumn(db: Connection, issue: Row) {
  await db.query(
    `UPDATE issues SET position=position-1 WHERE ${column} AND position>$3`,
    [issue.project_id, issue.status_id, issue.position],
  );
}
async function insertIssue(
  db: Connection,
  actor: Actor,
  projectId: string,
  input: {
    title: string;
    description: string;
    statusId: string;
    priority: number | null;
    estimate: number | null;
    deployedAt: string | null;
    reportedAt?: string | null;
    reporterId: string;
    reporterNote?: string | null;
    externalRef?: string | null;
    moduleIds: string[];
    labelIds: string[];
    assigneeIds: string[];
  },
  detail: Row = {},
) {
  const issueId = randomUUID();
  await db.query(
    "INSERT INTO issues(id,project_id,number,title,description,status_id,priority,estimate,reported_at,deployed_at,reporter_id,reporter_note,external_ref,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz,now()),$10,$11,$12,$13,$14)",
    [
      issueId,
      projectId,
      await nextIssueNumber(db, projectId),
      input.title,
      input.description,
      input.statusId,
      input.priority,
      input.estimate,
      input.reportedAt ?? null,
      input.deployedAt,
      input.reporterId,
      input.reporterNote ?? null,
      input.externalRef ?? null,
      await columnSize(db, projectId, input.statusId),
    ],
  );
  await setLinks(db, "modules", issueId, input.moduleIds);
  await setLinks(db, "labels", issueId, input.labelIds);
  for (const userId of input.assigneeIds)
    await db.query(
      "INSERT INTO issue_assignees(issue_id,user_id,assigned_by) VALUES($1,$2,$3)",
      [issueId, userId, actor.type === "user" ? actor.user.id : null],
    );
  const activityId = await issueEvent(
    db,
    issueId,
    actor,
    "issue_created",
    "",
    detail,
  );
  return { issueId, activityId };
}

const listFilter = z.object({
  archive: z.enum(["active", "archived", "all"]).default("active"),
  view: z.enum(["table", "board"]).default("table"),
  q: z.string().trim().max(200).default(""),
  status: multiFilter(z.union([z.string().uuid(), z.literal("open")])),
  module: z.union([z.string().uuid(), z.literal("all")]).default("all"),
  label: z.union([z.string().uuid(), z.literal("all")]).default("all"),
  assignee: z
    .union([z.string().uuid(), z.enum(["all", "me", "none"])])
    .default("all"),
  reporter: z.union([z.string().uuid(), z.literal("all")]).default("all"),
  priority: z.enum(["all", "none", "1", "2", "3", "4", "5"]).default("all"),
  sort: z
    .enum(["reported", "updated", "created", "priority", "number", "title"])
    .default("reported"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const sorts: Record<z.infer<typeof listFilter>["sort"], string> = {
  reported: "i.reported_at DESC,i.number DESC",
  updated: "i.updated_at DESC,i.number DESC",
  created: "i.created_at DESC,i.number DESC",
  priority: "i.priority ASC NULLS LAST,i.number DESC",
  number: "i.number DESC",
  title: "lower(i.title),i.number",
};

export function issueRoutes(router: Router, db: Database) {
  router.get("/projects/:projectId/issue-config", async (req, res) => {
    const projectId = id(req, "projectId");
    await projectScope(db, projectId, actorOf(res));
    res.json(await config(db, projectId));
  });
  for (const kind of Object.keys(tables) as ConfigKind[]) {
    const table = tables[kind];
    const input = kind === "statuses" ? issueStatusInput : issueTagInput;
    const label = configLabels[kind];
    const duplicate = () =>
      new HttpError(409, `Já existe um ${label} com esse nome.`);
    router.post(`/projects/:projectId/issue-${kind}`, async (req, res) => {
      const body = input.parse(req.body) as z.infer<typeof issueStatusInput>;
      const projectId = id(req, "projectId");
      const actor = actorOf(res);
      human(actor);
      const result = await transaction(db, async (client) => {
        await projectScope(client, projectId, actor, {
          owner: true,
          write: true,
          lock: true,
        });
        const size = await count(
          client,
          `SELECT count(*) FROM ${table} WHERE project_id=$1 AND deleted_at IS NULL`,
          [projectId],
        );
        const position = Math.min(body.position ?? size, size);
        await client.query(
          `UPDATE ${table} SET position=position+1 WHERE project_id=$1 AND deleted_at IS NULL AND position>=$2`,
          [projectId, position],
        );
        try {
          const row =
            kind === "statuses"
              ? (
                  await client.query(
                    `INSERT INTO ${table}(id,project_id,name,color,category,position) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
                    [
                      randomUUID(),
                      projectId,
                      body.name,
                      body.color,
                      body.category,
                      position,
                    ],
                  )
                ).rows[0]
              : (
                  await client.query(
                    `INSERT INTO ${table}(id,project_id,name,color,position) VALUES($1,$2,$3,$4,$5) RETURNING *`,
                    [randomUUID(), projectId, body.name, body.color, position],
                  )
                ).rows[0];
          return dto(row);
        } catch (error) {
          if (uniqueViolation(error)) throw duplicate();
          throw error;
        }
      });
      res.status(201).json(result);
    });
    router.patch(`/issue-${kind}/:itemId`, async (req, res) => {
      const body = input.parse(req.body) as z.infer<typeof issueStatusInput>;
      const actor = actorOf(res);
      human(actor);
      const itemId = id(req, "itemId");
      const result = await transaction(db, async (client) => {
        const initial = (
          await client.query(
            `SELECT project_id FROM ${table} WHERE id=$1 AND deleted_at IS NULL`,
            [itemId],
          )
        ).rows[0];
        if (!initial) throw new HttpError(404, "Registo não encontrado.");
        await projectScope(client, initial.project_id, actor, {
          owner: true,
          write: true,
          lock: true,
        });
        const row = (
          await client.query(`SELECT * FROM ${table} WHERE id=$1`, [itemId])
        ).rows[0];
        expectVersion(req, row);
        if (kind === "statuses" && body.category !== row.category) {
          const remaining = await count(
            client,
            "SELECT count(*) FROM issue_statuses WHERE project_id=$1 AND deleted_at IS NULL AND category=$2 AND id<>$3",
            [row.project_id, row.category, row.id],
          );
          if (row.category !== "doing" && !remaining)
            throw new HttpError(
              409,
              "O projeto precisa de pelo menos um estado «Por fazer» e um «Concluído».",
            );
        }
        if (body.position !== undefined && body.position !== row.position) {
          const size = await count(
            client,
            `SELECT count(*) FROM ${table} WHERE project_id=$1 AND deleted_at IS NULL`,
            [row.project_id],
          );
          const target = Math.min(body.position, size - 1);
          await client.query(
            target < row.position
              ? `UPDATE ${table} SET position=position+1 WHERE project_id=$1 AND deleted_at IS NULL AND position>=$2 AND position<$3`
              : `UPDATE ${table} SET position=position-1 WHERE project_id=$1 AND deleted_at IS NULL AND position>$3 AND position<=$2`,
            [row.project_id, target, row.position],
          );
          await client.query(`UPDATE ${table} SET position=$2 WHERE id=$1`, [
            itemId,
            target,
          ]);
        }
        try {
          const updated = (
            await client.query(
              kind === "statuses"
                ? `UPDATE ${table} SET name=$2,color=$3,category=$4,version=version+1 WHERE id=$1 RETURNING *`
                : `UPDATE ${table} SET name=$2,color=$3,version=version+1 WHERE id=$1 RETURNING *`,
              kind === "statuses"
                ? [itemId, body.name, body.color, body.category]
                : [itemId, body.name, body.color],
            )
          ).rows[0];
          return dto(updated);
        } catch (error) {
          if (uniqueViolation(error)) throw duplicate();
          throw error;
        }
      });
      res.json(result);
    });
    router.delete(`/issue-${kind}/:itemId`, async (req, res) => {
      const actor = actorOf(res);
      human(actor);
      const itemId = id(req, "itemId");
      const moveTo = req.query.moveTo
        ? z.string().uuid().parse(req.query.moveTo)
        : null;
      await transaction(db, async (client) => {
        const initial = (
          await client.query(
            `SELECT project_id FROM ${table} WHERE id=$1 AND deleted_at IS NULL`,
            [itemId],
          )
        ).rows[0];
        if (!initial) throw new HttpError(404, "Registo não encontrado.");
        await projectScope(client, initial.project_id, actor, {
          owner: true,
          write: true,
          lock: true,
        });
        const row = (
          await client.query(`SELECT * FROM ${table} WHERE id=$1`, [itemId])
        ).rows[0];
        expectVersion(req, row);
        if (kind === "statuses") {
          if (row.category !== "doing") {
            const remaining = await count(
              client,
              "SELECT count(*) FROM issue_statuses WHERE project_id=$1 AND deleted_at IS NULL AND category=$2 AND id<>$3",
              [row.project_id, row.category, row.id],
            );
            if (!remaining)
              throw new HttpError(
                409,
                "O projeto precisa de pelo menos um estado «Por fazer» e um «Concluído».",
              );
          }
          const issues = (
            await client.query(
              "SELECT * FROM issues WHERE status_id=$1 AND deleted_at IS NULL ORDER BY archived_at IS NOT NULL,position",
              [itemId],
            )
          ).rows;
          if (issues.length) {
            if (!moveTo || moveTo === itemId)
              throw new HttpError(
                409,
                "Escolha o estado para onde mover os issues deste estado.",
              );
            const target = await checkStatus(client, row.project_id, moveTo);
            const start = await columnSize(client, row.project_id, target.id);
            let offset = 0;
            for (const issue of issues) {
              await client.query(
                "UPDATE issues SET status_id=$2,position=$3,updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
                [issue.id, target.id, issue.archived_at ? 0 : start + offset],
              );
              if (!issue.archived_at) offset++;
              await issueEvent(
                client,
                issue.id,
                actor,
                "issue_status_changed",
                "",
                {
                  from: row.name,
                  to: target.name,
                },
              );
            }
          }
        }
        await client.query(
          `UPDATE ${table} SET deleted_at=clock_timestamp(),version=version+1 WHERE id=$1`,
          [itemId],
        );
        await client.query(
          `UPDATE ${table} SET position=position-1 WHERE project_id=$1 AND deleted_at IS NULL AND position>$2`,
          [row.project_id, row.position],
        );
      });
      res.status(204).end();
    });
  }

  router.get("/projects/:projectId/issues", async (req, res) => {
    const projectId = id(req, "projectId");
    const actor = actorOf(res);
    const user = human(actor);
    await projectScope(db, projectId, actor);
    const filter = listFilter.parse(req.query);
    const where = ["i.project_id=$1", "i.deleted_at IS NULL"];
    const values: unknown[] = [projectId];
    const add = (clause: (param: string) => string, value: unknown) => {
      values.push(value);
      where.push(clause(`$${values.length}`));
    };
    const board = filter.view === "board";
    const archive = board ? "active" : filter.archive;
    if (archive === "active") where.push("i.archived_at IS NULL");
    if (archive === "archived") where.push("i.archived_at IS NOT NULL");
    // "IS-12" matches only that issue; a bare "12" or "#12" matches it first, then text.
    const prefixed = filter.q.match(/^is-?(\d{1,6})$/i)?.[1];
    const bare = filter.q.match(/^#?(\d{1,6})$/)?.[1];
    const text = (p: string) =>
      `i.title ILIKE ${p} ESCAPE '\\' OR i.description ILIKE ${p} ESCAPE '\\' OR i.external_ref ILIKE ${p} ESCAPE '\\'`;
    let exact = "";
    if (prefixed) add((p) => `i.number=${p}`, Number(prefixed));
    else if (bare) {
      values.push(Number(bare), likePattern(filter.q));
      exact = `$${values.length - 1}`;
      where.push(`(i.number=${exact} OR ${text(`$${values.length}`)})`);
    } else if (filter.q) add((p) => `(${text(p)})`, likePattern(filter.q));
    // Selected statuses combine with OR; "open" stands for every non-done status.
    if (filter.status.length) {
      const statusIds = filter.status.filter((value) => value !== "open");
      const any = filter.status.includes("open")
        ? [
            "EXISTS (SELECT 1 FROM issue_statuses st WHERE st.id=i.status_id AND st.category<>'done')",
          ]
        : [];
      if (statusIds.length) {
        values.push(statusIds);
        any.push(`i.status_id = ANY($${values.length}::uuid[])`);
      }
      where.push(`(${any.join(" OR ")})`);
    }
    if (filter.module !== "all")
      add(
        (p) =>
          `EXISTS (SELECT 1 FROM issue_module_links l WHERE l.issue_id=i.id AND l.module_id=${p})`,
        filter.module,
      );
    if (filter.label !== "all")
      add(
        (p) =>
          `EXISTS (SELECT 1 FROM issue_label_links l WHERE l.issue_id=i.id AND l.label_id=${p})`,
        filter.label,
      );
    if (filter.assignee === "none")
      where.push(
        "NOT EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id=i.id)",
      );
    else if (filter.assignee !== "all")
      add(
        (p) =>
          `EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id=i.id AND a.user_id=${p})`,
        filter.assignee === "me" ? user.id : filter.assignee,
      );
    if (filter.reporter !== "all")
      add((p) => `i.reporter_id=${p}`, filter.reporter);
    if (filter.priority === "none") where.push("i.priority IS NULL");
    else if (filter.priority !== "all")
      add((p) => `i.priority=${p}`, Number(filter.priority));
    const clause = where.join(" AND ");
    const total = Number(
      (await db.query(`SELECT count(*) FROM issues i WHERE ${clause}`, values))
        .rows[0].count,
    );
    const pageSize = board ? 1000 : filter.pageSize;
    const offset = board ? 0 : (filter.page - 1) * pageSize;
    const rows = (
      await db.query(
        `SELECT ${issueColumns} FROM issues i JOIN users u ON u.id=i.reporter_id WHERE ${clause} ORDER BY ${board ? "i.position,i.number" : `${exact ? `i.number=${exact} DESC,` : ""}${sorts[filter.sort]}`} LIMIT ${pageSize} OFFSET ${offset}`,
        values,
      )
    ).rows;
    const counts = (
      await db.query(
        "SELECT count(*) FILTER (WHERE i.archived_at IS NULL) AS active,count(*) FILTER (WHERE i.archived_at IS NOT NULL) AS archived,count(*) FILTER (WHERE i.archived_at IS NULL AND st.category<>'done') AS open FROM issues i JOIN issue_statuses st ON st.id=i.status_id WHERE i.project_id=$1 AND i.deleted_at IS NULL",
        [projectId],
      )
    ).rows[0];
    res.json({
      items: await hydrate(db, rows),
      total,
      page: board ? 1 : filter.page,
      pageSize,
      counts: {
        active: Number(counts.active),
        archived: Number(counts.archived),
        open: Number(counts.open),
      },
    });
  });
  router.post("/projects/:projectId/issues", async (req, res) => {
    const parsed = issueInput.parse(req.body);
    const input = {
      ...parsed,
      moduleIds: unique(parsed.moduleIds),
      labelIds: unique(parsed.labelIds),
      assigneeIds: unique(parsed.assigneeIds),
    };
    const projectId = id(req, "projectId");
    const actor = actorOf(res);
    const user = human(actor);
    const result = await transaction(db, async (client) => {
      await projectScope(client, projectId, actor, { write: true, lock: true });
      const statusId = input.statusId
        ? (await checkStatus(client, projectId, input.statusId)).id
        : await defaultStatus(client, projectId);
      await checkTags(client, "modules", projectId, input.moduleIds);
      await checkTags(client, "labels", projectId, input.labelIds);
      await checkMembers(client, projectId, input.assigneeIds);
      const { issueId, activityId } = await insertIssue(
        client,
        actor,
        projectId,
        { ...input, statusId, reporterId: user.id },
      );
      await notify(
        client,
        actor,
        "issue_assignment",
        { projectId, issueId, activityId },
        input.assigneeIds,
      );
      return loadIssue(client, issueId);
    });
    res.status(201).json(result);
  });
  router.get("/issues/:issueId", async (req, res) => {
    const issueId = id(req, "issueId");
    await issueScope(db, issueId, actorOf(res));
    res.json(await loadIssue(db, issueId));
  });
  router.get("/issues/:issueId/activity", async (req, res) => {
    const issueId = id(req, "issueId");
    await issueScope(db, issueId, actorOf(res));
    const rows = (
      await db.query(
        "SELECT * FROM activities WHERE issue_id=$1 ORDER BY created_at,id",
        [issueId],
      )
    ).rows;
    const attachments = (
      await db.query(
        "SELECT id,activity_id,file_name,content_type,size FROM attachments WHERE issue_id=$1 AND activity_id IS NOT NULL ORDER BY created_at,id",
        [issueId],
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
  router.patch("/issues/:issueId", async (req, res) => {
    const input = issuePatchInput.parse(req.body);
    const actor = actorOf(res);
    human(actor);
    const issueId = id(req, "issueId");
    const result = await transaction(db, async (client) => {
      const { issue } = await issueScope(client, issueId, actor, {
        write: true,
        lock: true,
      });
      expectVersion(req, issue);
      const projectId = issue.project_id as string;
      const fields: [string, string, unknown][] = [
        ["title", "title", input.title],
        ["description", "description", input.description],
        ["priority", "priority", input.priority],
        ["estimate", "estimate", input.estimate],
        ["deployedAt", "deployed_at", input.deployedAt],
      ];
      const current = await loadIssue(client, issueId);
      const changes: string[] = [];
      for (const [name, columnName, value] of fields)
        if (
          value !== undefined &&
          value !== (current as unknown as Row)[name]
        ) {
          await client.query(`UPDATE issues SET ${columnName}=$2 WHERE id=$1`, [
            issueId,
            value,
          ]);
          changes.push(name);
        }
      const same = (a: string[], b: string[]) =>
        a.length === b.length && a.every((value) => b.includes(value));
      for (const kind of ["modules", "labels"] as const) {
        const listed = kind === "modules" ? input.moduleIds : input.labelIds;
        const ids = listed && unique(listed);
        const previous =
          kind === "modules" ? current.moduleIds : current.labelIds;
        if (!ids || same(ids, previous)) continue;
        await checkTags(client, kind, projectId, ids);
        await setLinks(client, kind, issueId, ids);
        changes.push(kind);
      }
      let statusChange: { from: string; to: string } | null = null;
      if (input.statusId && input.statusId !== issue.status_id) {
        const target = await checkStatus(client, projectId, input.statusId);
        const from = (
          await client.query("SELECT name FROM issue_statuses WHERE id=$1", [
            issue.status_id,
          ])
        ).rows[0].name as string;
        await place(client, issue, target.id, input.position);
        statusChange = { from, to: target.name };
      } else if (input.position !== undefined) {
        if (issue.archived_at)
          throw new HttpError(409, "Este issue está arquivado.");
        await place(client, issue, issue.status_id, input.position);
      }
      if (!changes.length && !statusChange) {
        if (input.position !== undefined) {
          await client.query(
            "UPDATE issues SET version=version+1 WHERE id=$1",
            [issueId],
          );
          return loadIssue(client, issueId);
        }
        return current;
      }
      await touch(client, issueId);
      if (changes.length)
        await issueEvent(client, issueId, actor, "issue_edited", "", {
          changes,
        });
      if (statusChange) {
        const activityId = await issueEvent(
          client,
          issueId,
          actor,
          "issue_status_changed",
          "",
          statusChange,
        );
        await notify(
          client,
          actor,
          "issue_status",
          {
            projectId,
            issueId,
            activityId,
            detail: { status: statusChange.to },
          },
          [issue.reporter_id, ...(await assigneeIds(client, issueId))],
        );
      }
      return loadIssue(client, issueId);
    });
    res.json(result);
  });
  router.put("/issues/:issueId/assignees", async (req, res) => {
    const input = {
      userIds: unique(issueAssigneesInput.parse(req.body).userIds),
    };
    const actor = actorOf(res);
    const user = human(actor);
    const issueId = id(req, "issueId");
    const result = await transaction(db, async (client) => {
      const { issue } = await issueScope(client, issueId, actor, {
        write: true,
        lock: true,
      });
      expectVersion(req, issue);
      await checkMembers(client, issue.project_id, input.userIds);
      const previous = await assigneeIds(client, issueId);
      const added = input.userIds.filter((value) => !previous.includes(value));
      const removed = previous.filter(
        (value) => !input.userIds.includes(value),
      );
      if (!added.length && !removed.length) return loadIssue(client, issueId);
      await client.query(
        "DELETE FROM issue_assignees WHERE issue_id=$1 AND user_id = ANY($2::uuid[])",
        [issueId, removed],
      );
      for (const userId of added)
        await client.query(
          "INSERT INTO issue_assignees(issue_id,user_id,assigned_by) VALUES($1,$2,$3)",
          [issueId, userId, user.id],
        );
      await touch(client, issueId);
      const activityId = await issueEvent(
        client,
        issueId,
        actor,
        "issue_assigned",
        "",
        { added, removed },
      );
      await notify(
        client,
        actor,
        "issue_assignment",
        { projectId: issue.project_id, issueId, activityId },
        added,
      );
      return loadIssue(client, issueId);
    });
    res.json(result);
  });
  for (const method of ["post", "delete"] as const)
    router[method]("/issues/:issueId/assign-me", async (req, res) => {
      const actor = actorOf(res);
      const user = human(actor);
      const issueId = id(req, "issueId");
      const result = await transaction(db, async (client) => {
        await issueScope(client, issueId, actor, { write: true, lock: true });
        const assignedNow = (await assigneeIds(client, issueId)).includes(
          user.id,
        );
        if (assignedNow === (method === "post"))
          return loadIssue(client, issueId);
        if (method === "post")
          await client.query(
            "INSERT INTO issue_assignees(issue_id,user_id,assigned_by) VALUES($1,$2,$2)",
            [issueId, user.id],
          );
        else
          await client.query(
            "DELETE FROM issue_assignees WHERE issue_id=$1 AND user_id=$2",
            [issueId, user.id],
          );
        await touch(client, issueId);
        await issueEvent(
          client,
          issueId,
          actor,
          "issue_assigned",
          "",
          method === "post"
            ? { added: [user.id], removed: [] }
            : { added: [], removed: [user.id] },
        );
        return loadIssue(client, issueId);
      });
      res.json(result);
    });
  router.post("/issues/:issueId/duplicate", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    const issueId = id(req, "issueId");
    const result = await transaction(db, async (client) => {
      const { issue } = await issueScope(client, issueId, actor, {
        lock: true,
      });
      const source = await loadIssue(client, issueId);
      const members = (
        await client.query(
          `SELECT m.user_id FROM project_members m WHERE m.project_id=$1 AND ${assignableMember}`,
          [issue.project_id],
        )
      ).rows.map((row) => row.user_id as string);
      const assignees = source.assignees
        .map((person) => person.id)
        .filter((value) => members.includes(value));
      const created = await insertIssue(
        client,
        actor,
        issue.project_id,
        {
          title: `${source.title.slice(0, 191)} (cópia)`,
          description: source.description,
          statusId: await defaultStatus(client, issue.project_id),
          priority: source.priority,
          estimate: source.estimate,
          deployedAt: null,
          reporterId: user.id,
          moduleIds: source.moduleIds,
          labelIds: source.labelIds,
          assigneeIds: assignees,
        },
        { duplicateOf: source.number },
      );
      await notify(
        client,
        actor,
        "issue_assignment",
        {
          projectId: issue.project_id,
          issueId: created.issueId,
          activityId: created.activityId,
        },
        assignees,
      );
      return loadIssue(client, created.issueId);
    });
    res.status(201).json(result);
  });
  type Change = "archive" | "restore" | "delete";
  /** Applies one change to a locked issue row; shared by the single and bulk routes. */
  async function changeIssue(
    client: Connection,
    actor: Actor,
    issue: Row,
    change: Change,
    detail: Row = {},
  ) {
    const user = human(actor);
    if (change === "archive") {
      await leaveColumn(client, issue);
      await client.query(
        "UPDATE issues SET archived_at=clock_timestamp(),archived_by=$2 WHERE id=$1",
        [issue.id, user.id],
      );
      await touch(client, issue.id);
      await issueEvent(client, issue.id, actor, "issue_archived", "", detail);
    } else if (change === "restore") {
      await client.query(
        "UPDATE issues SET archived_at=NULL,archived_by=NULL,position=$2 WHERE id=$1",
        [issue.id, await columnSize(client, issue.project_id, issue.status_id)],
      );
      await touch(client, issue.id);
      await issueEvent(client, issue.id, actor, "issue_restored");
    } else {
      const people = [
        issue.reporter_id,
        ...(await assigneeIds(client, issue.id)),
      ];
      if (!issue.archived_at) await leaveColumn(client, issue);
      await client.query(
        "UPDATE issues SET deleted_at=clock_timestamp(),deleted_by=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [issue.id, user.id],
      );
      const info = { number: issue.number, title: issue.title };
      const activityId = await issueEvent(
        client,
        issue.id,
        actor,
        "issue_deleted",
        "",
        info,
      );
      await notify(
        client,
        actor,
        "issue_deleted",
        {
          projectId: issue.project_id,
          issueId: issue.id,
          activityId,
          detail: info,
        },
        people,
      );
    }
  }
  /**
   * Owners (and administrators) change several issues in one transaction. Issues already in
   * the wanted state are skipped; one stale version refuses the whole batch.
   */
  async function bulkChange(
    projectId: string,
    actor: Actor,
    change: Change,
    items: { id: string; version: number }[],
  ) {
    return transaction(db, async (client) => {
      await projectScope(client, projectId, actor, {
        owner: true,
        write: true,
        lock: true,
      });
      let count = 0;
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        // Read each row afresh: earlier changes may have moved its column position.
        const issue = (
          await client.query(
            "SELECT * FROM issues WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL",
            [item.id, projectId],
          )
        ).rows[0];
        if (!issue) throw new HttpError(404, "Issue não encontrado.");
        if (
          (change === "archive" && issue.archived_at) ||
          (change === "restore" && !issue.archived_at)
        )
          continue;
        if (issue.version !== item.version)
          throw new HttpError(
            409,
            `O issue «${issue.title}» foi alterado por outra pessoa. Atualize a lista e tente de novo.`,
          );
        await changeIssue(client, actor, issue, change);
        count++;
      }
      return count;
    });
  }
  for (const action of ["archive", "restore"] as const)
    router.post(`/issues/:issueId/${action}`, async (req, res) => {
      const actor = actorOf(res);
      const issueId = id(req, "issueId");
      const result = await transaction(db, async (client) => {
        const { issue } = await issueScope(client, issueId, actor, {
          owner: true,
          lock: true,
        });
        if (Boolean(issue.archived_at) === (action === "archive"))
          return loadIssue(client, issueId);
        expectVersion(req, issue);
        await changeIssue(client, actor, issue, action);
        return loadIssue(client, issueId);
      });
      res.json(result);
    });
  router.post("/projects/:projectId/issues/archive", async (req, res) => {
    const input = issueArchiveInput.parse(req.body);
    const projectId = id(req, "projectId");
    const actor = actorOf(res);
    const user = human(actor);
    if ("issues" in input)
      return void res.json({
        archived: await bulkChange(projectId, actor, "archive", input.issues),
      });
    const statusIds = unique(input.statusIds);
    const result = await transaction(db, async (client) => {
      await projectScope(client, projectId, actor, {
        owner: true,
        write: true,
        lock: true,
      });
      const statuses = (
        await client.query(
          "SELECT id,name,category FROM issue_statuses WHERE project_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL",
          [projectId, statusIds],
        )
      ).rows;
      if (statuses.length !== statusIds.length)
        throw new HttpError(404, "Estado não encontrado.");
      if (statuses.some((status) => status.category !== "done"))
        throw new HttpError(
          400,
          "Só é possível arquivar por regra issues em estados concluídos.",
        );
      // Every active issue of these statuses leaves, so no column positions need closing.
      const archived = (
        await client.query(
          "UPDATE issues SET archived_at=clock_timestamp(),archived_by=$3,updated_at=clock_timestamp(),version=version+1 WHERE project_id=$1 AND status_id = ANY($2::uuid[]) AND deleted_at IS NULL AND archived_at IS NULL RETURNING id,status_id",
          [projectId, statusIds, user.id],
        )
      ).rows;
      for (const issue of archived)
        await issueEvent(client, issue.id, actor, "issue_archived", "", {
          rule: statuses.find((status) => status.id === issue.status_id)!.name,
        });
      return { archived: archived.length };
    });
    res.json(result);
  });
  router.post("/projects/:projectId/issues/restore", async (req, res) => {
    const input = issueSelectionInput.parse(req.body);
    res.json({
      restored: await bulkChange(
        id(req, "projectId"),
        actorOf(res),
        "restore",
        input.issues,
      ),
    });
  });
  router.post("/projects/:projectId/issues/delete", async (req, res) => {
    const input = issueSelectionInput.parse(req.body);
    res.json({
      deleted: await bulkChange(
        id(req, "projectId"),
        actorOf(res),
        "delete",
        input.issues,
      ),
    });
  });
  router.delete("/issues/:issueId", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    const issueId = id(req, "issueId");
    await transaction(db, async (client) => {
      const { issue, project } = await issueScope(client, issueId, actor, {
        lock: true,
      });
      // Reporters delete their own issues; owners and administrators delete any.
      if (project.role !== "owner" && issue.reporter_id !== user.id)
        throw new HttpError(
          403,
          "Só os proprietários e o reporter do issue o podem apagar.",
        );
      expectVersion(req, issue);
      await changeIssue(client, actor, issue, "delete");
    });
    res.status(204).end();
  });
  router.post("/issues/:issueId/comments", async (req, res) => {
    const input = commentInput.parse(req.body);
    const actor = actorOf(res);
    const user = human(actor);
    const issueId = id(req, "issueId");
    const activityId = await transaction(db, async (client) => {
      const { issue } = await issueScope(client, issueId, actor, {
        write: true,
        lock: true,
      });
      const people = await issuePeople(client, issue);
      const mentions = await mentioned(
        client,
        issue.project_id,
        input.mentions,
      );
      const activityId = await issueEvent(
        client,
        issueId,
        actor,
        "comment",
        input.body,
        mentions.length ? { mentions } : {},
      );
      if (input.attachmentIds.length) {
        const linked = (
          await client.query(
            "UPDATE attachments SET activity_id=$1 WHERE id = ANY($2::uuid[]) AND uploaded_by=$3 AND issue_id=$4 AND activity_id IS NULL RETURNING id",
            [activityId, input.attachmentIds, user.id, issueId],
          )
        ).rows;
        if (linked.length !== new Set(input.attachmentIds).size)
          throw new HttpError(
            400,
            "Um dos anexos é inválido ou já foi publicado.",
          );
      }
      const target = {
        projectId: issue.project_id,
        issueId,
        activityId,
        detail: { excerpt: excerpt(input.body) },
      };
      await notify(client, actor, "issue_mention", target, mentions);
      await notify(client, actor, "issue_comment", target, people, mentions);
      await touch(client, issueId);
      return activityId;
    });
    res.status(201).json({ ok: true, id: activityId });
  });
  router.post(
    "/issues/:issueId/attachments",
    express.raw({ type: "application/octet-stream", limit: maxAttachment }),
    async (req, res) => {
      const actor = actorOf(res);
      const user = human(actor);
      const issueId = id(req, "issueId");
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
        const { issue } = await issueScope(client, issueId, actor, {
          write: true,
        });
        return dto(
          (
            await client.query(
              "INSERT INTO attachments(id,project_id,issue_id,uploaded_by,file_name,content_type,size,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,file_name,content_type,size",
              [
                randomUUID(),
                issue.project_id,
                issueId,
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
  router.post("/projects/:projectId/issues/import", async (req, res) => {
    const input = issueImportInput.parse(req.body);
    const projectId = id(req, "projectId");
    const actor = actorOf(res);
    const user = human(actor);
    const key = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(req.get("Idempotency-Key"));
    const hash = digest(JSON.stringify(input));
    const outcome = await transaction(db, async (client) => {
      await projectScope(client, projectId, actor, {
        owner: true,
        write: true,
        lock: true,
      });
      const previous = (
        await client.query(
          "SELECT payload_hash,result FROM issue_imports WHERE project_id=$1 AND idempotency_key=$2",
          [projectId, key],
        )
      ).rows[0];
      if (previous) {
        if (previous.payload_hash !== hash)
          throw new HttpError(
            409,
            "Esta importação já foi feita com outro conteúdo. Recomece a importação.",
          );
        return { result: previous.result as IssueImportResult, replay: true };
      }
      const current = await config(client, projectId);
      const normalize = (value: string) =>
        value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
      const created = { statuses: 0, modules: 0, labels: 0 };
      /** Resolves keys of new entries to ids, reusing existing names (case and accents ignored). */
      async function resolve(
        kind: ConfigKind,
        entries: { key: string; name: string; category?: string }[],
      ) {
        const existing = current[kind];
        const map = new Map<string, string>(
          existing.map((item) => [item.id, item.id]),
        );
        let position = existing.length;
        for (const entry of entries) {
          const match = existing.find(
            (item) => normalize(item.name) === normalize(entry.name),
          );
          if (match) {
            map.set(entry.key, match.id);
            continue;
          }
          const newId = randomUUID();
          if (kind === "statuses")
            await client.query(
              "INSERT INTO issue_statuses(id,project_id,name,category,position) VALUES($1,$2,$3,$4,$5)",
              [newId, projectId, entry.name, entry.category, position++],
            );
          else
            await client.query(
              `INSERT INTO ${tables[kind]}(id,project_id,name,position) VALUES($1,$2,$3,$4)`,
              [newId, projectId, entry.name, position++],
            );
          existing.push({ id: newId, name: entry.name } as never);
          map.set(entry.key, newId);
          created[kind]++;
        }
        return map;
      }
      const statuses = await resolve("statuses", input.newStatuses);
      const modules = await resolve("modules", input.newModules);
      const labels = await resolve("labels", input.newLabels);
      const memberRows = (
        await client.query(
          "SELECT user_id,role FROM project_members WHERE project_id=$1",
          [projectId],
        )
      ).rows;
      const members = new Set(memberRows.map((row) => row.user_id as string));
      const assignable = new Set(
        memberRows
          .filter((row) => row.role !== "viewer")
          .map((row) => row.user_id as string),
      );
      const fallbackStatus = await defaultStatus(client, projectId);
      const seen = new Set(
        (
          await client.query(
            "SELECT external_ref FROM issues WHERE project_id=$1 AND external_ref IS NOT NULL",
            [projectId],
          )
        ).rows.map((row) => row.external_ref as string),
      );
      const result: IssueImportResult = {
        created: 0,
        skipped: [],
        statuses: created.statuses,
        modules: created.modules,
        labels: created.labels,
      };
      const lookup = (
        map: Map<string, string>,
        value: string,
        what: string,
        line: number,
      ) => {
        const found = map.get(value);
        if (!found)
          throw new HttpError(
            400,
            `Linha ${line}: ${what} «${value}» não foi associado.`,
          );
        return found;
      };
      for (const [index, row] of input.rows.entries()) {
        const line = index + 1;
        if (row.externalRef && seen.has(row.externalRef)) {
          result.skipped.push({
            externalRef: row.externalRef,
            reason: "Já importado",
          });
          continue;
        }
        if (
          (row.reporterId && !members.has(row.reporterId)) ||
          row.assigneeIds.some((person) => !assignable.has(person))
        )
          throw new HttpError(
            400,
            `Linha ${line}: o reporter tem de ser membro do projeto e os responsáveis membros com permissão de edição.`,
          );
        const { issueId } = await insertIssue(
          client,
          actor,
          projectId,
          {
            title: row.title,
            description: row.description,
            statusId: row.status
              ? lookup(statuses, row.status, "o estado", line)
              : fallbackStatus,
            priority: row.priority,
            estimate: row.estimate,
            deployedAt: row.deployedAt,
            reportedAt: row.reportedAt,
            reporterId: row.reporterId ?? user.id,
            reporterNote: row.reporterId ? null : row.reporterNote,
            externalRef: row.externalRef,
            moduleIds: [
              ...new Set(
                row.modules.map((value) =>
                  lookup(modules, value, "o módulo", line),
                ),
              ),
            ],
            labelIds: [
              ...new Set(
                row.labels.map((value) =>
                  lookup(labels, value, "a label", line),
                ),
              ),
            ],
            assigneeIds: [...new Set(row.assigneeIds)],
          },
          { imported: true, fileName: input.fileName },
        );
        // Imported observations become comments by the importer; no notifications.
        for (const body of row.comments)
          await issueEvent(client, issueId, actor, "comment", body);
        if (row.externalRef) seen.add(row.externalRef);
        result.created++;
      }
      await client.query(
        "INSERT INTO issue_imports(project_id,idempotency_key,payload_hash,imported_by,result) VALUES($1,$2,$3,$4,$5)",
        [projectId, key, hash, user.id, JSON.stringify(result)],
      );
      return { result, replay: false };
    });
    res.status(outcome.replay ? 200 : 201).json(outcome.result);
  });
  router.get("/me/preferences", async (_req, res) => {
    const user = human(actorOf(res));
    const rows = (
      await db.query(
        "SELECT key,value FROM user_preferences WHERE user_id=$1",
        [user.id],
      )
    ).rows;
    res.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  });
  router.put("/me/preferences/:key", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    const board = req.params.key.match(boardPreferencePattern);
    let key: string;
    let value: unknown;
    if (board) {
      // Only for projects the person can open, so keys cannot be made up at will.
      await projectScope(db, z.string().uuid().parse(board[1]), actor);
      key = req.params.key;
      value = boardPreferenceInput.parse(req.body?.value);
    } else {
      key = z.enum(preferenceKeys).parse(req.params.key);
      value = preferenceInput.parse(req.body?.value);
    }
    await db.query(
      "INSERT INTO user_preferences(user_id,key,value,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=now()",
      [user.id, key, JSON.stringify(value)],
    );
    res.json({ key, value });
  });
}
