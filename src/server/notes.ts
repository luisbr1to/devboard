// Personal area: Markdown notes in folders with tags, and issue drafts on a personal board.
// Everything belongs to its author alone (administrators and keys included): rows are always
// filtered by user, a missing or foreign row is a 404, and writes lock the author's user row.
import express, { type Request, type Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  draftBatchInput,
  draftMoveInput,
  draftPatchInput,
  noteFolderInput,
  noteFolderPatchInput,
  noteInput,
  notePatchInput,
  type IssueDraft,
  type Note,
} from "../shared/contracts";
import { transaction, type Connection, type Database } from "./db";
import { HttpError, type Actor } from "./auth";
import {
  activeMember,
  actorOf,
  checkAttachment,
  dto,
  expectVersion,
  human,
  id,
  likePattern,
  maxAttachment,
  projectScope,
  type Row,
} from "./api";

const uniqueViolation = (error: unknown) => (error as Row)?.code === "23505";
const plain = (body: string) =>
  body
    .replace(/\[@\s+[^\]]*?label="([^"]*)"[^\]]*\]/g, "@$1")
    .replace(/[#>*_`~\[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Start of the note, or the text around the first match of the search. */
export function snippet(body: string, query: string) {
  const text = plain(body);
  const at = query
    ? text.toLocaleLowerCase("pt-PT").indexOf(query.toLocaleLowerCase("pt-PT"))
    : -1;
  return at > 60 ? `…${text.slice(at - 40, at + 120)}` : text.slice(0, 160);
}
const tagsOf = (tags: string[]) => [
  ...new Set(
    tags.map((tag) => tag.replace(/^#/, "").toLocaleLowerCase("pt-PT")),
  ),
];
/** Serializes the author's changes, as the project row lock does for project data. */
const lockUser = (db: Connection, userId: string) =>
  db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);

async function ownNote(
  db: Connection | Database,
  noteId: string,
  userId: string,
  options: { lock?: boolean; write?: boolean } = {},
) {
  const note = (
    await db.query(
      `SELECT * FROM notes WHERE id=$1 AND user_id=$2${options.lock ? " FOR UPDATE" : ""}`,
      [noteId, userId],
    )
  ).rows[0];
  if (!note) throw new HttpError(404, "Nota não encontrada.");
  if (options.write && note.deleted_at)
    throw new HttpError(
      409,
      "Esta nota está na reciclagem. Restaure-a para a alterar.",
    );
  return note;
}
async function ownFolder(db: Connection, folderId: string, userId: string) {
  const folder = (
    await db.query("SELECT * FROM note_folders WHERE id=$1 AND user_id=$2", [
      folderId,
      userId,
    ])
  ).rows[0];
  if (!folder) throw new HttpError(404, "Pasta não encontrada.");
  return folder;
}
async function loadNote(db: Connection | Database, noteId: string) {
  const note = (
    await db.query(
      "SELECT id,folder_id,title,body,tags,created_at,updated_at,deleted_at,version FROM notes WHERE id=$1",
      [noteId],
    )
  ).rows[0];
  const attachments = (
    await db.query(
      "SELECT id,file_name,content_type,size FROM personal_attachments WHERE note_id=$1 ORDER BY created_at,id",
      [noteId],
    )
  ).rows;
  return { ...dto(note), attachments: attachments.map(dto) } as Note;
}

/** Board columns other than "Criado" keep contiguous positions. */
async function columnSize(db: Connection, userId: string, state: string) {
  return Number(
    (
      await db.query(
        "SELECT count(*) AS count FROM issue_drafts WHERE user_id=$1 AND state=$2",
        [userId, state],
      )
    ).rows[0].count,
  );
}
async function leaveColumn(db: Connection, draft: Row) {
  await db.query(
    "UPDATE issue_drafts SET position=position-1 WHERE user_id=$1 AND state=$2 AND position>$3",
    [draft.user_id, draft.state, draft.position],
  );
}
async function ownDraft(
  db: Connection | Database,
  draftId: string,
  userId: string,
  options: { lock?: boolean; write?: boolean } = {},
) {
  const draft = (
    await db.query(
      `SELECT * FROM issue_drafts WHERE id=$1 AND user_id=$2${options.lock ? " FOR UPDATE" : ""}`,
      [draftId, userId],
    )
  ).rows[0];
  if (!draft) throw new HttpError(404, "Rascunho não encontrado.");
  if (options.write && draft.state === "created")
    throw new HttpError(409, "Este rascunho já deu origem a um issue.");
  return draft;
}
async function loadDrafts(
  db: Connection | Database,
  actor: Actor,
  where: string,
  values: unknown[],
) {
  const admin = actor.type === "user" && actor.admin;
  // Projects the author can no longer open show no name or issue; $1 is the author.
  const access = `p.deleted_at IS NULL AND (${admin ? "TRUE" : "FALSE"} OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1 AND ${activeMember}))`;
  const rows = (
    await db.query(
      `SELECT d.id,d.note_id,n.title AS note_title,d.source_text,d.project_id,CASE WHEN ${access} THEN p.name END AS project_name,d.title,d.description,d.priority,d.state,d.position,d.issue_id,CASE WHEN ${access} AND i.deleted_at IS NULL THEN i.number END AS issue_number,d.created_at,d.updated_at,d.version FROM issue_drafts d LEFT JOIN notes n ON n.id=d.note_id AND n.deleted_at IS NULL LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN issues i ON i.id=d.issue_id WHERE d.user_id=$1 AND ${where} ORDER BY d.state,d.position,d.updated_at DESC`,
      values,
    )
  ).rows;
  const files = rows.length
    ? (
        await db.query(
          "SELECT id,draft_id,file_name,content_type,size FROM personal_attachments WHERE draft_id = ANY($1::uuid[]) ORDER BY created_at,id",
          [rows.map((row) => row.id)],
        )
      ).rows
    : [];
  return rows.map(
    (row) =>
      ({
        ...dto(row),
        attachments: files
          .filter((file) => file.draft_id === row.id)
          .map(({ draft_id: _draft, ...file }) => dto(file)),
      }) as IssueDraft,
  );
}
async function loadDraft(
  db: Connection | Database,
  actor: Actor,
  draftId: string,
) {
  const user = human(actor);
  const [draft] = await loadDrafts(db, actor, "d.id=$2", [user.id, draftId]);
  if (!draft) throw new HttpError(404, "Rascunho não encontrado.");
  return draft;
}
async function checkProject(
  db: Connection,
  actor: Actor,
  projectId: string | null | undefined,
) {
  // Only projects where the author may create issues.
  if (projectId) await projectScope(db, projectId, actor, { write: true });
}

/** Locks a draft its author is turning into an issue; call inside the issue's transaction. */
export async function claimDraft(
  db: Connection,
  draftId: string,
  actor: Actor,
) {
  const user = human(actor);
  await lockUser(db, user.id);
  return ownDraft(db, draftId, user.id, { lock: true, write: true });
}
/** Marks the draft as created and copies its files to the issue's creation event. */
export async function completeDraft(
  db: Connection,
  draft: Row,
  projectId: string,
  issueId: string,
  activityId: string,
) {
  await db.query(
    "INSERT INTO attachments(id,project_id,issue_id,activity_id,uploaded_by,file_name,content_type,size,data) SELECT gen_random_uuid(),$1,$2,$3,user_id,file_name,content_type,size,data FROM personal_attachments WHERE draft_id=$4 ORDER BY created_at,id",
    [projectId, issueId, activityId, draft.id],
  );
  await leaveColumn(db, draft);
  await db.query(
    "UPDATE issue_drafts SET state='created',position=0,project_id=$2,issue_id=$3,updated_at=now(),version=version+1 WHERE id=$1",
    [draft.id, projectId, issueId],
  );
}

function fileName(req: Request) {
  let name: string;
  try {
    name = decodeURIComponent(req.get("X-File-Name") || "");
  } catch {
    name = "";
  }
  name = name
    .replace(/[\u0000-\u001f\u007f/\\]/g, "")
    .trim()
    .slice(-200);
  if (!name) throw new HttpError(400, "Indique o nome do ficheiro.");
  return name;
}

export function noteRoutes(router: Router, db: Database) {
  router.get("/me/note-folders", async (_req, res) => {
    const user = human(actorOf(res));
    res.json(
      (
        await db.query(
          "SELECT id,parent_id,name FROM note_folders WHERE user_id=$1 ORDER BY lower(name),id",
          [user.id],
        )
      ).rows.map(dto),
    );
  });
  router.post("/me/note-folders", async (req, res) => {
    const input = noteFolderInput.parse(req.body);
    const user = human(actorOf(res));
    const folder = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      if (input.parentId) await ownFolder(client, input.parentId, user.id);
      try {
        await client.query("SAVEPOINT folder");
        return (
          await client.query(
            "INSERT INTO note_folders(id,user_id,parent_id,name) VALUES($1,$2,$3,$4) RETURNING id,parent_id,name",
            [randomUUID(), user.id, input.parentId, input.name],
          )
        ).rows[0];
      } catch (error) {
        if (!uniqueViolation(error)) throw error;
        await client.query("ROLLBACK TO SAVEPOINT folder");
        throw new HttpError(409, "Já existe uma pasta com esse nome aqui.");
      }
    });
    res.status(201).json(dto(folder));
  });
  router.patch("/me/note-folders/:folderId", async (req, res) => {
    const input = noteFolderPatchInput.parse(req.body);
    const user = human(actorOf(res));
    const folderId = id(req, "folderId");
    const folder = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const current = await ownFolder(client, folderId, user.id);
      const parentId =
        input.parentId === undefined ? current.parent_id : input.parentId;
      // A folder cannot move into itself or into one of its subfolders.
      for (let ancestor = parentId; ancestor;) {
        if (ancestor === folderId)
          throw new HttpError(
            409,
            "Não pode mover uma pasta para dentro de si própria.",
          );
        ancestor = (await ownFolder(client, ancestor, user.id)).parent_id;
      }
      try {
        await client.query("SAVEPOINT folder");
        return (
          await client.query(
            "UPDATE note_folders SET name=$2,parent_id=$3 WHERE id=$1 RETURNING id,parent_id,name",
            [folderId, input.name ?? current.name, parentId],
          )
        ).rows[0];
      } catch (error) {
        if (!uniqueViolation(error)) throw error;
        await client.query("ROLLBACK TO SAVEPOINT folder");
        throw new HttpError(409, "Já existe uma pasta com esse nome aqui.");
      }
    });
    res.json(dto(folder));
  });
  router.delete("/me/note-folders/:folderId", async (req, res) => {
    const user = human(actorOf(res));
    const folderId = id(req, "folderId");
    await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const folder = await ownFolder(client, folderId, user.id);
      // Its notes and subfolders move up to the parent; nothing is lost.
      await client.query(
        "UPDATE notes SET folder_id=$2 WHERE folder_id=$1 AND user_id=$3",
        [folderId, folder.parent_id, user.id],
      );
      const children = (
        await client.query(
          "SELECT id,name FROM note_folders WHERE parent_id=$1 AND user_id=$2",
          [folderId, user.id],
        )
      ).rows;
      const taken = new Set(
        (
          await client.query(
            "SELECT lower(name) AS name FROM note_folders WHERE user_id=$1 AND parent_id IS NOT DISTINCT FROM $2 AND id<>$3",
            [user.id, folder.parent_id, folderId],
          )
        ).rows.map((row) => row.name),
      );
      for (const child of children) {
        let name = child.name;
        for (let copy = 2; taken.has(name.toLowerCase()); copy++)
          name = `${child.name} (${copy})`;
        taken.add(name.toLowerCase());
        await client.query(
          "UPDATE note_folders SET parent_id=$2,name=$3 WHERE id=$1",
          [child.id, folder.parent_id, name],
        );
      }
      await client.query("DELETE FROM note_folders WHERE id=$1", [folderId]);
    });
    res.status(204).end();
  });

  router.get("/me/notes", async (req, res) => {
    const user = human(actorOf(res));
    const filter = z
      .object({
        q: z.string().trim().max(100).default(""),
        tag: z.string().trim().max(40).default(""),
        folderId: z.string().uuid().optional(),
        deleted: z.enum(["0", "1"]).default("0"),
      })
      .parse(req.query);
    const values: unknown[] = [user.id];
    const where = [
      "user_id=$1",
      filter.deleted === "1" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL",
    ];
    if (filter.q) {
      values.push(likePattern(filter.q));
      where.push(
        `(title ILIKE $${values.length} ESCAPE '\\' OR body ILIKE $${values.length} ESCAPE '\\')`,
      );
    }
    if (filter.tag) {
      values.push(filter.tag.replace(/^#+/, "").toLocaleLowerCase("pt-PT"));
      where.push(`$${values.length}=ANY(tags)`);
    }
    if (filter.folderId) {
      values.push(filter.folderId);
      where.push(`folder_id=$${values.length}`);
    }
    const rows = (
      await db.query(
        `SELECT id,folder_id,title,tags,updated_at,deleted_at,${filter.q ? "body" : "left(body,600) AS body"} FROM notes WHERE ${where.join(" AND ")} ORDER BY updated_at DESC,id LIMIT 1000`,
        values,
      )
    ).rows;
    res.json(
      rows.map(({ body, ...row }) => ({
        ...dto(row),
        excerpt: snippet(body, filter.q),
      })),
    );
  });
  router.get("/me/note-tags", async (_req, res) => {
    const user = human(actorOf(res));
    res.json(
      (
        await db.query(
          "SELECT tag AS name,count(*)::int AS count FROM notes,unnest(tags) AS tag WHERE user_id=$1 AND deleted_at IS NULL GROUP BY tag ORDER BY tag",
          [user.id],
        )
      ).rows,
    );
  });
  router.post("/me/notes", async (req, res) => {
    const input = noteInput.parse(req.body);
    const user = human(actorOf(res));
    const note = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      if (input.folderId) await ownFolder(client, input.folderId, user.id);
      const noteId = randomUUID();
      await client.query(
        "INSERT INTO notes(id,user_id,folder_id,title,body,tags) VALUES($1,$2,$3,$4,$5,$6)",
        [
          noteId,
          user.id,
          input.folderId,
          input.title,
          input.body,
          tagsOf(input.tags),
        ],
      );
      return loadNote(client, noteId);
    });
    res.status(201).json(note);
  });
  router.get("/me/notes/:noteId", async (req, res) => {
    const user = human(actorOf(res));
    const noteId = id(req, "noteId");
    await ownNote(db, noteId, user.id);
    res.json(await loadNote(db, noteId));
  });
  router.patch("/me/notes/:noteId", async (req, res) => {
    const input = notePatchInput.parse(req.body);
    const user = human(actorOf(res));
    const noteId = id(req, "noteId");
    const note = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const current = await ownNote(client, noteId, user.id, {
        lock: true,
        write: true,
      });
      expectVersion(req, current);
      if (input.folderId) await ownFolder(client, input.folderId, user.id);
      await client.query(
        "UPDATE notes SET title=$2,body=$3,folder_id=$4,tags=$5,updated_at=now(),version=version+1 WHERE id=$1",
        [
          noteId,
          input.title ?? current.title,
          input.body ?? current.body,
          input.folderId === undefined ? current.folder_id : input.folderId,
          input.tags ? tagsOf(input.tags) : current.tags,
        ],
      );
      return loadNote(client, noteId);
    });
    res.json(note);
  });
  router.delete("/me/notes/:noteId", async (req, res) => {
    const user = human(actorOf(res));
    const noteId = id(req, "noteId");
    const permanent = req.query.permanent === "1";
    await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const note = await ownNote(client, noteId, user.id, { lock: true });
      if (!permanent) {
        await client.query(
          "UPDATE notes SET deleted_at=coalesce(deleted_at,now()),version=version+1 WHERE id=$1",
          [noteId],
        );
        return;
      }
      if (!note.deleted_at)
        throw new HttpError(
          409,
          "Mova a nota para a reciclagem antes de a eliminar definitivamente.",
        );
      // Drafts made from it stay, without the link; its files go with it.
      await client.query("DELETE FROM notes WHERE id=$1", [noteId]);
    });
    res.status(204).end();
  });
  router.post("/me/notes/:noteId/restore", async (req, res) => {
    const user = human(actorOf(res));
    const noteId = id(req, "noteId");
    const note = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const current = await ownNote(client, noteId, user.id, { lock: true });
      // A folder removed meanwhile leaves the note at the root.
      await client.query(
        "UPDATE notes SET deleted_at=NULL,folder_id=(SELECT id FROM note_folders WHERE id=$2),version=version+1 WHERE id=$1",
        [noteId, current.folder_id],
      );
      return loadNote(client, noteId);
    });
    res.json(note);
  });

  router.get("/me/drafts", async (req, res) => {
    const actor = actorOf(res);
    const user = human(actor);
    const filter = z
      .object({
        noteId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      })
      .parse(req.query);
    const values: unknown[] = [user.id];
    const where = ["TRUE"];
    if (filter.noteId) {
      values.push(filter.noteId);
      where.push(`d.note_id=$${values.length}`);
    }
    if (filter.projectId) {
      values.push(filter.projectId);
      where.push(`d.project_id=$${values.length}`);
    }
    res.json(await loadDrafts(db, actor, where.join(" AND "), values));
  });
  router.post("/me/drafts", async (req, res) => {
    const input = draftBatchInput.parse(req.body);
    const actor = actorOf(res);
    const user = human(actor);
    const drafts = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      if (input.noteId)
        await ownNote(client, input.noteId, user.id, { write: true });
      await checkProject(client, actor, input.projectId);
      let position = await columnSize(client, user.id, "review");
      const ids: string[] = [];
      for (const item of input.items) {
        const draftId = randomUUID();
        ids.push(draftId);
        await client.query(
          "INSERT INTO issue_drafts(id,user_id,note_id,source_text,project_id,title,description,priority,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            draftId,
            user.id,
            input.noteId,
            item.sourceText,
            input.projectId,
            item.title,
            item.description,
            input.priority,
            position++,
          ],
        );
      }
      return loadDrafts(client, actor, "d.id = ANY($2::uuid[])", [
        user.id,
        ids,
      ]);
    });
    res.status(201).json(drafts);
  });
  router.get("/me/drafts/:draftId", async (req, res) => {
    res.json(await loadDraft(db, actorOf(res), id(req, "draftId")));
  });
  router.patch("/me/drafts/:draftId", async (req, res) => {
    const input = draftPatchInput.parse(req.body);
    const actor = actorOf(res);
    const user = human(actor);
    const draftId = id(req, "draftId");
    const draft = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const current = await ownDraft(client, draftId, user.id, {
        lock: true,
        write: true,
      });
      expectVersion(req, current);
      if (
        input.projectId !== undefined &&
        input.projectId !== current.project_id
      )
        await checkProject(client, actor, input.projectId);
      await client.query(
        "UPDATE issue_drafts SET title=$2,description=$3,project_id=$4,priority=$5,updated_at=now(),version=version+1 WHERE id=$1",
        [
          draftId,
          input.title ?? current.title,
          input.description ?? current.description,
          input.projectId === undefined ? current.project_id : input.projectId,
          input.priority === undefined ? current.priority : input.priority,
        ],
      );
      return loadDraft(client, actor, draftId);
    });
    res.json(draft);
  });
  router.post("/me/drafts/:draftId/move", async (req, res) => {
    const input = draftMoveInput.parse(req.body);
    const actor = actorOf(res);
    const user = human(actor);
    const draftId = id(req, "draftId");
    const draft = await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const current = await ownDraft(client, draftId, user.id, {
        lock: true,
        write: true,
      });
      await leaveColumn(client, current);
      const size =
        (await columnSize(client, user.id, input.state)) -
        (input.state === current.state ? 1 : 0);
      const position = Math.min(input.position, size);
      await client.query(
        "UPDATE issue_drafts SET position=position+1 WHERE user_id=$1 AND state=$2 AND position>=$3 AND id<>$4",
        [user.id, input.state, position, draftId],
      );
      await client.query(
        "UPDATE issue_drafts SET state=$2,position=$3,updated_at=now(),version=version+1 WHERE id=$1",
        [draftId, input.state, position],
      );
      return loadDraft(client, actor, draftId);
    });
    res.json(draft);
  });
  router.delete("/me/drafts/:draftId", async (req, res) => {
    const user = human(actorOf(res));
    const draftId = id(req, "draftId");
    await transaction(db, async (client) => {
      await lockUser(client, user.id);
      const draft = await ownDraft(client, draftId, user.id, { lock: true });
      if (draft.state !== "discarded")
        throw new HttpError(
          409,
          "Só pode eliminar rascunhos que foram descartados.",
        );
      await leaveColumn(client, draft);
      await client.query("DELETE FROM issue_drafts WHERE id=$1", [draftId]);
    });
    res.status(204).end();
  });

  const upload = (target: "note" | "draft") =>
    async function (req: Request, res: express.Response) {
      const user = human(actorOf(res));
      const targetId = id(req, target === "note" ? "noteId" : "draftId");
      const name = fileName(req);
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const contentType = checkAttachment(name, data);
      const file = await transaction(db, async (client) => {
        await lockUser(client, user.id);
        if (target === "note")
          await ownNote(client, targetId, user.id, { write: true });
        else await ownDraft(client, targetId, user.id, { write: true });
        return (
          await client.query(
            `INSERT INTO personal_attachments(id,user_id,${target}_id,file_name,content_type,size,data) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,file_name,content_type,size`,
            [
              randomUUID(),
              user.id,
              targetId,
              name,
              contentType,
              data.length,
              data,
            ],
          )
        ).rows[0];
      });
      res.status(201).json(dto(file));
    };
  const raw = express.raw({
    type: "application/octet-stream",
    limit: maxAttachment,
  });
  router.post("/me/notes/:noteId/attachments", raw, upload("note"));
  router.post("/me/drafts/:draftId/attachments", raw, upload("draft"));
  async function ownAttachment(req: Request, res: express.Response) {
    const user = human(actorOf(res));
    const file = (
      await db.query(
        "SELECT a.id,a.note_id,a.draft_id,a.file_name,a.content_type,d.state AS draft_state,n.deleted_at AS note_deleted FROM personal_attachments a LEFT JOIN issue_drafts d ON d.id=a.draft_id LEFT JOIN notes n ON n.id=a.note_id WHERE a.id=$1 AND a.user_id=$2",
        [id(req, "attachmentId"), user.id],
      )
    ).rows[0];
    if (!file) throw new HttpError(404, "Anexo não encontrado.");
    return file;
  }
  router.get("/me/attachments/:attachmentId", async (req, res) => {
    const file = await ownAttachment(req, res);
    const data = (
      await db.query("SELECT data FROM personal_attachments WHERE id=$1", [
        file.id,
      ])
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
  router.delete("/me/attachments/:attachmentId", async (req, res) => {
    const file = await ownAttachment(req, res);
    if (file.draft_state === "created")
      throw new HttpError(409, "Este rascunho já deu origem a um issue.");
    if (file.note_deleted)
      throw new HttpError(
        409,
        "Esta nota está na reciclagem. Restaure-a para a alterar.",
      );
    await db.query("DELETE FROM personal_attachments WHERE id=$1", [file.id]);
    res.status(204).end();
  });
}
