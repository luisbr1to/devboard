import { test, expect, type Page } from "@playwright/test";
import { members, project } from "./fixtures";
import type { IssueDraft, Note, NoteFolder } from "../../src/shared/contracts";

const issue = {
  id: "70000000-0000-4000-8000-000000000007",
  projectId: project.id,
  projectName: project.name,
  number: 7,
  title: "Checkout falha no Safari",
  archived: false,
};
/** The whole app signed in locally, with notes and drafts kept in memory. */
async function mockApp(page: Page) {
  const notes: Note[] = [];
  const folders: NoteFolder[] = [];
  const drafts: IssueDraft[] = [];
  const saved: { path: string; data: any }[] = [];
  const preferences: Record<string, unknown> = {};
  const summary = (note: Note) => ({
    id: note.id,
    folderId: note.folderId,
    title: note.title,
    tags: note.tags,
    excerpt: note.body.slice(0, 160),
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  });
  let sequence = 0;
  const uuid = (prefix: string) =>
    `${prefix}000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const data =
      method !== "GET" &&
      request.headers()["content-type"]?.includes("application/json")
        ? request.postDataJSON()
        : null;
    if (data) saved.push({ path, data });
    let status = 200;
    let result: unknown = {};
    const note = notes.find((item) => path.includes(item.id));
    const draft = drafts.find((item) => path.includes(item.id));
    if (path === "/config")
      result = {
        mode: "local",
        configured: true,
        tenantId: "",
        clientId: "",
        resourceUri: "",
        scope: "",
        localUsers: [{ oid: members[0].oid, name: "Ana Silva", email: "a@b" }],
      };
    else if (path === "/auth/local/session") {
      status = 201;
      result = { token: "local-token", user: members[0] };
    } else if (path === "/me") result = { ...members[0], admin: false };
    else if (path === "/projects") result = [project];
    else if (path.endsWith("/members")) result = members;
    else if (path.endsWith("/photo")) return route.fulfill({ status: 204 });
    else if (path.endsWith("/summary"))
      result = { total: 0, archived: 0, counts: {} };
    else if (path.endsWith("/issue-config"))
      result = {
        statuses: [
          {
            id: "60000000-0000-4000-8000-000000000001",
            projectId: project.id,
            name: "Backlog",
            color: "gray",
            category: "todo",
            position: 0,
            version: 1,
          },
        ],
        modules: [],
        labels: [],
        templates: [
          {
            id: "61000000-0000-4000-8000-000000000001",
            name: "Pedido de suporte",
            body: "## Cliente",
            version: 1,
          },
        ],
      };
    else if (path === `/projects/${project.id}/issues` && method === "POST") {
      status = 201;
      const target = drafts.find((item) => item.id === data.draftId)!;
      Object.assign(target, {
        state: "created",
        issueId: "70000000-0000-4000-8000-000000000008",
        issueNumber: 8,
        version: target.version + 1,
      });
      result = { id: target.issueId, number: 8, title: data.title };
    } else if (path.endsWith("/issues"))
      result = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 1,
        counts: { active: 0, archived: 0, open: 0 },
      };
    else if (path === "/notifications") result = { items: [], unread: 0 };
    else if (path === "/search")
      result = {
        suites: [],
        tests: [],
        issues: [issue],
        comments: [],
        notes: [],
      };
    else if (path === "/me/preferences") result = preferences;
    else if (path.startsWith("/me/preferences/")) {
      preferences[path.split("/").at(-1)!] = data.value;
      result = { value: data.value };
    } else if (path === "/me/note-folders") result = folders;
    else if (path === "/me/note-tags") result = [];
    else if (path === "/me/notes" && method === "POST") {
      status = 201;
      const created: Note = {
        id: uuid("4"),
        folderId: null,
        title: data.title,
        body: "",
        tags: [],
        createdAt: "2026-10-26T09:00:00Z",
        updatedAt: "2026-10-26T09:00:00Z",
        deletedAt: null,
        version: 1,
        attachments: [],
      };
      notes.push(created);
      result = created;
    } else if (path === "/me/notes")
      result = notes
        .filter((item) => !item.deletedAt === !url.searchParams.get("deleted"))
        .map(summary);
    else if (note && method === "DELETE") {
      status = 204;
      note.deletedAt = "2026-10-26T10:00:00Z";
      note.version++;
    } else if (note && method === "PATCH") {
      if (Number(request.headers()["if-match"]) !== note.version) {
        status = 409;
        result = { error: "Este registo foi alterado por outra pessoa." };
      } else {
        Object.assign(note, data, { version: note.version + 1 });
        result = note;
      }
    } else if (note) result = note;
    else if (path === "/me/drafts" && method === "POST") {
      status = 201;
      result = data.items.map((item: any) => {
        const created: IssueDraft = {
          id: uuid("5"),
          noteId: data.noteId,
          noteTitle:
            notes.find((item) => item.id === data.noteId)?.title ?? null,
          sourceText: item.sourceText ?? null,
          projectId: data.projectId,
          projectName: data.projectId ? project.name : null,
          title: item.title,
          description: item.description ?? "",
          priority: data.priority,
          steps: item.steps ?? [],
          state: "todo",
          position: drafts.length,
          issueId: null,
          issueNumber: null,
          createdAt: "2026-10-26T09:05:00Z",
          updatedAt: "2026-10-26T09:05:00Z",
          version: 1,
          attachments: [],
        };
        drafts.push(created);
        return created;
      });
    } else if (path === "/me/drafts")
      result = drafts.filter(
        (item) =>
          !url.searchParams.get("noteId") ||
          item.noteId === url.searchParams.get("noteId"),
      );
    else if (draft && path.endsWith("/move")) {
      Object.assign(draft, {
        state: data.state,
        position: data.position,
        version: draft.version + 1,
      });
      result = draft;
    } else if (draft && method === "PATCH") {
      Object.assign(draft, data, { version: draft.version + 1 });
      result = draft;
    } else if (draft) result = draft;
    else {
      status = 404;
      result = { error: "Mock não definido" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  return { notes, folders, drafts, saved, preferences };
}

test("a daily pasted in a personal note becomes drafts on the board and then an issue", async ({
  page,
}) => {
  const { notes, drafts, saved } = await mockApp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await page.getByRole("link", { name: "Notas" }).click();
  await expect(
    page.getByRole("heading", { name: "Escolha ou crie uma nota" }),
  ).toBeVisible();
  // The project's links stay in the sidebar while in the personal area.
  await expect(
    page.getByRole("link", { name: /Desenvolvimento/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Nova nota" }).click();
  const title = page.getByRole("textbox", { name: "Título da nota" });
  await expect(title).toHaveValue(/^Nota de /);
  await title.fill("Daily 26/10");
  const body = page.getByRole("textbox", { name: "Conteúdo" });
  await body.click();
  await page.keyboard.type("- Corrigir o checkout, ver #IS");
  const option = page.getByRole("option", { name: /IS-7/ });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Rever pagamentos");
  // Saved on its own, with the reference as a link to the issue's page.
  await expect
    .poll(() => notes[0]?.body)
    .toContain(
      `[IS-7 · Checkout falha no Safari](#project=${project.id}&view=dev&issue=${issue.id})`,
    );
  await expect.poll(() => notes[0]?.body).toContain("- Rever pagamentos");
  expect(notes[0].title).toBe("Daily 26/10");
  await expect(page.getByText(/^Guardado/)).toBeVisible();
  await page.getByRole("textbox", { name: "Adicionar tag" }).fill("daily");
  await page.keyboard.press("Enter");
  await expect.poll(() => notes[0].tags).toEqual(["daily"]);

  // «Guardar» leaves a reading view; «Editar» brings the fields back.
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page.getByRole("heading", { name: "Daily 26/10" }),
  ).toBeVisible();
  await expect(page.getByText("Rever pagamentos")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Conteúdo" })).toHaveCount(0);
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(title).toHaveValue("Daily 26/10");
  await page.getByRole("button", { name: "Guardar" }).click();

  await page
    .getByRole("button", { name: "Ações da nota", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Criar tarefas" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Criar tarefas",
  });
  await expect(dialog.getByRole("checkbox")).toHaveCount(2);
  await dialog.getByRole("checkbox", { name: /Rever pagamentos/ }).uncheck();
  await dialog.getByRole("button", { name: "Criar 1 tarefa" }).click();
  await expect(dialog.getByText("Foi criada 1 tarefa")).toBeVisible();
  const batch = saved.find((item) => item.path === "/me/drafts")!.data;
  expect(batch.projectId).toBe(project.id);
  expect(batch.items).toEqual([
    {
      title: "Corrigir o checkout, ver IS-7 · Checkout falha no Safari",
      description: "",
      sourceText: "corrigir o checkout, ver is-7 · checkout falha no safari",
    },
  ]);
  await dialog
    .getByRole("button", { name: "Abrir a board de tarefas" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Tarefas", exact: true }),
  ).toBeVisible();
  const review = page.getByRole("listitem", { name: "Por fazer: 1 tarefas" });
  await expect(review).toContainText("Daily 26/10");
  await expect(review).toContainText(project.name);
  await review.getByRole("button", { name: /^Corrigir o checkout/ }).click();
  const drawer = page.getByRole("dialog", { name: /Corrigir o checkout/ });
  await drawer
    .getByRole("textbox", { name: "Título" })
    .fill("Corrigir o checkout");
  await drawer.getByRole("button", { name: "Guardar" }).click();
  await drawer.getByRole("button", { name: "Criar issue" }).click();
  const form = page.getByRole("dialog", { name: "Novo issue" });
  await expect(form.getByRole("textbox", { name: "Título" })).toHaveValue(
    "Corrigir o checkout",
  );
  await form.getByRole("button", { name: "Criar issue" }).click();
  await expect(drawer.getByText("Deu origem a IS-8")).toBeVisible();
  const created = saved.find(
    (item) => item.path === `/projects/${project.id}/issues`,
  )!.data;
  expect(created).toMatchObject({
    title: "Corrigir o checkout",
    draftId: drafts[0].id,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("listitem", { name: "Issue criado: 1 tarefas" }),
  ).toContainText("IS-8");
});

for (const theme of ["light", "dark"] as const)
  test(`notes and the drafts board fit a phone screen (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({
      colorScheme: theme === "dark" ? "dark" : "light",
    });
    await mockApp(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar localmente" }).click();
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page.getByRole("link", { name: "Notas" }).click();
    await page.getByRole("button", { name: "Nova nota" }).click();
    await expect(
      page.getByRole("textbox", { name: "Título da nota" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page.getByRole("link", { name: "Tarefas" }).click();
    await expect(
      page.getByRole("listitem", { name: "Por fazer: 0 tarefas" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Tabela", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });
test("a direct link to the notes keeps the page and picks the sidebar's project", async ({
  page,
}) => {
  await mockApp(page);
  await page.goto("/#view=notes");
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await expect(page).toHaveURL(
    new RegExp(`#view=notes&project=${project.id}$`),
  );
  await expect(
    page.getByRole("heading", { name: "Escolha ou crie uma nota" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Desenvolvimento/ }),
  ).toBeVisible();
});
test("tasks can also be listed in a table, by state, like the issues", async ({
  page,
}) => {
  const { drafts, preferences } = await mockApp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await page.getByRole("link", { name: "Tarefas" }).click();
  for (const title of ["Rever pagamentos", "Atualizar documentação"]) {
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova tarefa" });
    await dialog.getByRole("textbox", { name: "Título" }).fill(title);
    await dialog.getByRole("button", { name: "Criar tarefa" }).click();
    await page.getByRole("dialog", { name: title }).waitFor();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page
    .getByRole("list", { name: "Board de tarefas" })
    .getByRole("button", { name: "Ações de Atualizar documentação" })
    .click();
  await page.getByRole("menuitem", { name: "Mover para Em curso" }).click();
  await expect.poll(() => drafts[1].state).toBe("doing");
  await page.getByRole("button", { name: "Tabela", exact: true }).click();
  await expect.poll(() => preferences["drafts.view"]).toBe("table");
  // One table, like the issues: the states are a filter, not tabs.
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const rows = page.locator(".draft-table tbody tr");
  await expect(rows).toHaveCount(2);
  await page
    .getByRole("button", { name: "Ordenar tarefas: Atualização recente" })
    .click();
  await page.getByRole("menuitemradio", { name: "Estado" }).click();
  await expect(rows.first()).toContainText("Por fazer");
  await expect(rows.first()).toContainText(project.name);
  await expect(rows.nth(1)).toContainText("Em curso");
  await page.getByRole("button", { name: "Filtrar por estado: Todos" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Em curso" }).click();
  await page.keyboard.press("Escape");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Atualizar documentação");
  await page
    .getByRole("button", { name: "Filtrar por estado: Em curso" })
    .click();
  await page.getByRole("menuitem", { name: "Limpar seleção" }).click();
  await expect(rows).toHaveCount(2);
  // Moving from the row menu, as on the board.
  await page.getByRole("button", { name: "Ações de Rever pagamentos" }).click();
  await page.getByRole("menuitem", { name: "Mover para Descartado" }).click();
  await expect.poll(() => drafts[0].state).toBe("discarded");
  await page
    .getByRole("row", { name: "Abrir tarefa Atualizar documentação" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Atualizar documentação" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // The choice is remembered.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Tabela", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("notes are edited, moved and recycled from the sidebar, or dragged into folders", async ({
  page,
}) => {
  const { notes, folders } = await mockApp(page);
  folders.push({
    id: "50000000-0000-4000-8000-000000000001",
    parentId: null,
    name: "Reuniões",
  });
  const note = (id: string, title: string): Note => ({
    id,
    folderId: null,
    title,
    body: `- Ponto de ${title}`,
    tags: [],
    createdAt: "2026-10-26T09:00:00Z",
    updatedAt: "2026-10-26T09:00:00Z",
    deletedAt: null,
    version: 1,
    attachments: [],
  });
  notes.push(
    note("40000000-0000-4000-8000-000000000101", "Daily"),
    note("40000000-0000-4000-8000-000000000102", "Retro"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await page.getByRole("link", { name: "Notas" }).click();

  // A note with text opens for reading; «Editar» in the sidebar opens it for editing.
  await page.getByRole("link", { name: "Daily" }).click();
  await expect(page.getByRole("heading", { name: "Daily" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Título da nota" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ações da nota Retro" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(
    page.getByRole("textbox", { name: "Título da nota" }),
  ).toHaveValue("Retro");

  await page
    .getByRole("link", { name: "Daily" })
    .dragTo(page.getByRole("button", { name: "Reuniões", exact: true }));
  await expect.poll(() => notes[0].folderId).toBe(folders[0].id);

  // The open note moves through the editor, so its next save is not a conflict.
  await page.getByRole("button", { name: "Ações da nota Retro" }).click();
  await page.getByRole("menuitem", { name: "Mover para pasta…" }).click();
  const dialog = page.getByRole("dialog", { name: "Mover nota" });
  await dialog.getByRole("combobox", { name: "Pasta de «Retro»" }).click();
  await page.getByRole("option", { name: "Reuniões" }).click();
  await dialog.getByRole("button", { name: "Mover" }).click();
  await expect.poll(() => notes[1].folderId).toBe(folders[0].id);
  await page.getByRole("textbox", { name: "Título da nota" }).fill("Retro Q4");
  await expect.poll(() => notes[1].title).toBe("Retro Q4");
  await expect(page.getByText(/^Guardado/)).toBeVisible();

  await page.getByRole("button", { name: "Ações da nota Daily" }).click();
  await page.getByRole("menuitem", { name: "Mover para a reciclagem" }).click();
  await expect.poll(() => notes[0].deletedAt).not.toBeNull();
  await expect(page.getByRole("link", { name: "Daily" })).toHaveCount(0);
});

test("a task has steps to tick, loads a template and becomes an issue with them as a checklist", async ({
  page,
}) => {
  const { drafts, saved } = await mockApp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await page.getByRole("link", { name: "Tarefas" }).click();
  // «Nova tarefa» opens the whole task in a drawer, steps after the description.
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova tarefa" });
  await dialog
    .getByRole("textbox", { name: "Título" })
    .fill("Checkout no Safari");
  await dialog.getByRole("button", { name: "Adicionar passo" }).click();
  await dialog.getByRole("textbox", { name: "Passo 1" }).fill("Reproduzir");
  // Enter adds the next step.
  await page.keyboard.press("Enter");
  await dialog.getByRole("textbox", { name: "Passo 2" }).fill("Corrigir");
  await dialog.getByRole("button", { name: "Criar tarefa" }).click();
  const panel = page.getByRole("dialog", { name: "Checkout no Safari" });
  await expect
    .poll(() => drafts[0]?.steps)
    .toEqual([
      { body: "Reproduzir", done: false },
      { body: "Corrigir", done: false },
    ]);
  // Saving leaves a reading view like a test's: numbered steps ticked at once.
  await expect(panel.getByRole("textbox", { name: "Título" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Passo 1: feito" }).click();
  await expect.poll(() => drafts[0].steps[0].done).toBe(true);
  await expect(panel.getByText("1/2 feitos")).toBeVisible();
  // The state is changed from the bar at the bottom, without an issue.
  const states = panel.getByRole("group", { name: "Estado" });
  await states.getByRole("button", { name: "Em curso" }).click();
  await expect.poll(() => drafts[0].state).toBe("doing");
  await expect(
    states.getByRole("button", { name: "Em curso" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Templates: the built-in ones and the project's own; the description starts empty.
  await panel.getByRole("button", { name: "Editar tarefa" }).click();
  const description = panel.getByRole("textbox", { name: "Descrição" });
  await expect(description).toHaveText("");
  await panel.getByRole("combobox", { name: "Template" }).click();
  await expect(
    page.getByRole("option", { name: "Pedido de suporte" }),
  ).toBeVisible();
  await page.getByRole("option", { name: "Reportar bug" }).click();
  await expect(
    description.getByRole("heading", { name: "Passos para reproduzir" }),
  ).toBeVisible();
  // Replacing text the person wrote asks first.
  await description.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Visto no iPhone.");
  await panel.getByRole("combobox", { name: "Template" }).click();
  await page.getByRole("option", { name: "Nova funcionalidade" }).click();
  const confirm = page.getByRole("dialog", { name: "Substituir a descrição" });
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(description).toContainText("Visto no iPhone.");
  await panel.getByRole("button", { name: "Guardar" }).click();

  await panel.getByRole("button", { name: "Criar issue" }).click();
  const form = page.getByRole("dialog", { name: "Novo issue" });
  await form.getByRole("button", { name: "Criar issue" }).click();
  await expect(panel.getByText("Deu origem a IS-8")).toBeVisible();
  const created = saved.find(
    (item) => item.path === `/projects/${project.id}/issues`,
  )!.data;
  expect(created.description).toContain("## Resultado esperado");
  expect(created.description).toContain("Visto no iPhone.");
  expect(created.description).toContain("1. Abrir …");
  expect(created.description).toContain(
    "## Passos\n\n- [x] Reproduzir\n- [ ] Corrigir",
  );
});
