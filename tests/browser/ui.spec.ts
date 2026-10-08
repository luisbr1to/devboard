import { test, expect, type Page } from "@playwright/test";
import { fixtures, members, project } from "./fixtures";
import { summarize, type Activity } from "../../src/shared/contracts";
async function mockApi(page: Page) {
  const suites = fixtures();
  let activities: Activity[] = [];
  const posted: { path: string; data: any }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1", "");
    const suite = suites.find((suite) => path.includes(suite.id));
    const data =
      req.method() !== "GET" &&
      req.headers()["content-type"]?.includes("application/json")
        ? req.postDataJSON()
        : null;
    let result: unknown;
    let status = 200;
    if (path.endsWith("/photo")) {
      await route.fulfill({ status: 204 });
      return;
    } else if (path.endsWith("/summary")) {
      const active = suites.filter((suite) => !suite.archivedAt);
      const counts = { pending: 0, approved: 0, revoked: 0 };
      active.forEach((suite) => counts[suite.status]++);
      result = {
        total: active.length,
        archived: suites.length - active.length,
        counts,
      };
    } else if (/\/steps\/[\da-f-]+\/result$/.test(path)) {
      const parent = suites.find((suite) =>
        suite.tests!.some((test) => path.includes(test.id)),
      )!;
      const target = parent.tests!.find((test) => path.includes(test.id))!;
      const step = target.steps.find((item) => path.includes(item.id))!;
      if (Number(req.headers()["if-match"]) !== step.version) {
        status = 409;
        result = { error: "Este registo foi alterado por outra pessoa." };
      } else {
        Object.assign(step, {
          status: data.status,
          version: step.version + 1,
          updatedByName: "Ana Silva",
          updatedAt: "2026-10-02T12:00:00Z",
        });
        if (!target.testers.length)
          target.testers.push({ id: members[0].id, name: "Ana Silva" });
        result = step;
      }
    } else if (req.method() === "GET" && path.startsWith("/projects/")) {
      const archive = url.searchParams.get("archive") || "active";
      const status = url.searchParams.get("status") || "all";
      const items = suites.filter(
        (suite) =>
          (archive === "all" ||
            Boolean(suite.archivedAt) === (archive === "archived")) &&
          (status === "all" || suite.status === status) &&
          suite.title
            .toLowerCase()
            .includes((url.searchParams.get("q") || "").toLowerCase()),
      );
      result = { items, total: items.length, pageSize: 30 };
    } else if (/\/suites\/(archive|restore|delete)$/.test(path)) {
      posted.push({ path, data });
      const action = path.split("/").at(-1);
      const ids = data.suites.map((item: any) => item.id);
      for (const item of suites.filter((item) => ids.includes(item.id))) {
        item.archivedAt =
          action === "archive" ? "2026-10-02T12:00:00Z" : null;
        item.archivedBy = item.archivedAt ? members[0].id : null;
        item.version++;
      }
      if (action === "delete")
        suites.splice(
          0,
          suites.length,
          ...suites.filter((item) => !ids.includes(item.id)),
        );
      result = {
        [{ archive: "archived", restore: "restored", delete: "deleted" }[
          action!
        ]!]: ids.length,
      };
    } else if (suite && /\/(archive|restore)$/.test(path)) {
      suite.archivedAt = path.endsWith("/archive")
        ? "2026-10-02T12:00:00Z"
        : null;
      suite.archivedBy = suite.archivedAt ? members[0].id : null;
      suite.version++;
      result = suite;
    } else if (req.method() === "PATCH" && path.startsWith("/tests/")) {
      const parent = suites.find((suite) =>
        suite.tests!.some((test) => path.includes(test.id)),
      )!;
      const target = parent.tests!.find((test) => path.includes(test.id))!;
      if (Number(req.headers()["if-match"]) !== target.version) {
        status = 409;
        result = {
          error:
            "Este registo foi alterado por outra pessoa. Atualize os dados antes de guardar.",
        };
      } else {
        const from = parent.tests!.indexOf(target);
        const to = data.position;
        parent.tests!.splice(from, 1);
        parent.tests!.splice(to, 0, target);
        parent.tests!.forEach((test, index) => {
          test.position = index;
          test.version++;
        });
        parent.version++;
        result = target;
      }
    } else if (path.startsWith("/tests/") && path.endsWith("/result")) {
      const parent = suites.find((suite) =>
        suite.tests!.some((test) => path.includes(test.id)),
      )!;
      const target = parent.tests!.find((test) => path.includes(test.id))!;
      target.status = data.status;
      target.version++;
      Object.assign(
        parent,
        summarize(parent.tests!.map((test) => test.status)),
      );
      parent.version++;
      activities.push({
        id: "event-1",
        suiteId: parent.id,
        testId: target.id,
        actorName: "Ana Silva",
        kind: "result_recorded",
        body: data.comment || "",
        detail: { status: data.status },
        createdAt: "2026-10-02T12:00:00Z",
        attachments: [],
      });
      result = target;
    } else if (path.endsWith("/attachments") && req.method() === "POST") {
      status = 201;
      result = {
        id: "50000000-0000-4000-8000-000000000001",
        fileName: decodeURIComponent(req.headers()["x-file-name"]),
        contentType: "image/png",
        size: req.postDataBuffer()?.length || 0,
      };
    } else if (path.endsWith("/comments") && req.method() === "POST") {
      posted.push({ path, data });
      status = 201;
      result = { ok: true };
    } else if (suite && req.method() === "DELETE") {
      if (Number(req.headers()["if-match"]) !== suite.version) status = 409;
      else suites.splice(suites.indexOf(suite), 1);
      await route.fulfill({ status: status === 200 ? 204 : status });
      return;
    } else if (suite && path.endsWith("/activity")) result = activities;
    else if (suite && req.method() === "GET") result = suite;
    else if (suite && req.method() === "PATCH") {
      if (Number(req.headers()["if-match"]) !== suite.version) {
        status = 409;
        result = {
          error:
            "Este registo foi alterado por outra pessoa. Atualize os dados antes de guardar.",
        };
      } else {
        suite.title = data.title;
        suite.description = data.description;
        suite.version++;
        result = suite;
      }
    } else {
      status = 404;
      result = { error: "Mock não definido" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  return { suites, activities, posted };
}
test("Portuguese suite list, clickable rows, archive and restore keep results", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/tests/browser/harness.html");
  await expect(
    page.getByRole("heading", { name: "Suites de testes" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova suite" })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Suite", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Ativas/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: /Ativas/ })).toContainText("3");
  const checkout = page
    .getByRole("row")
    .filter({ hasText: "Checkout — pagamentos" });
  await expect(checkout.locator(".id-column")).toHaveText("SU-01");
  await expect(checkout.locator(".row-description")).toHaveText(
    "Validar o comportamento da aplicação em staging.",
  );
  await expect(checkout).toContainText("0/1 executados");
  for (const width of [1024, 760]) {
    await page.setViewportSize({ width, height: 720 });
    expect(
      await page.locator(".suite-table").evaluate((table) => {
        const scroll = table.closest(".table-scroll")!;
        return scroll.scrollWidth <= scroll.clientWidth;
      }),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator(".progress-donut")).toHaveCount(0);
  await expect(page.locator(".progress-track").first()).toBeVisible();
  await expect(
    page
      .locator(".status-badge.status-revoked")
      .filter({ hasText: "Rejeitada" })
      .first(),
  ).toBeVisible();
  await expect(checkout.locator(".status-badge")).toHaveText("Por iniciar");
  await expect(page.getByText("Revogado", { exact: true })).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);
  const row = page
    .getByRole("row")
    .filter({ hasText: "Recuperação de palavra-passe" });
  await row
    .getByRole("button", { name: "Ações de Recuperação de palavra-passe" })
    .click();
  await page.getByRole("menuitem", { name: "Arquivar" }).click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Recuperação de palavra-passe" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Arquivadas/ }).click();
  await expect(page.getByRole("tab", { name: /Arquivadas/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const archived = page
    .getByRole("row")
    .filter({ hasText: "Recuperação de palavra-passe" });
  await expect(archived).toContainText("Rejeitada");
  await archived
    .getByRole("button", { name: "Ações de Recuperação de palavra-passe" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Editar" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Restaurar" }).click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("tab", { name: /Ativas/ }).click();
  await expect(page.getByRole("button", { name: "Quadro" })).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({ hasText: "Checkout — pagamentos" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Checkout — pagamentos" }),
  ).toBeVisible();
  await expect(page.locator(".suite-tags .id-chip")).toHaveText("SU-01");
  await page.screenshot({
    path: "test-results/suite-list-light.png",
    fullPage: true,
  });
});
test("manual rejection requires a reason and appears safely in the timeline", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/tests/browser/harness.html?screen=detail");
  await page
    .getByRole("row")
    .filter({ hasText: "Validar fluxo principal" })
    .click();
  await expect(page.locator(".drawer-surface")).toBeVisible();
  await expect
    .poll(async () => {
      const box = await page.locator(".drawer-surface").boundingBox();
      return Math.round(box!.x + box!.width);
    })
    .toBe(1280);
  const drawerBox = await page.locator(".drawer-surface").boundingBox();
  expect(Math.round(drawerBox!.height)).toBe(720);
  const testDialog = page.getByRole("dialog", {
    name: "Validar fluxo principal",
  });
  await expect(testDialog.locator(".drawer-path")).toHaveText("SU-01 / TC-1");
  const commentBox = await testDialog
    .getByRole("textbox", { name: "Adicionar comentário" })
    .boundingBox();
  const stepsBox = await testDialog
    .getByRole("heading", { name: "Passos" })
    .boundingBox();
  expect(stepsBox!.y).toBeLessThan(commentBox!.y);
  await expect(testDialog.locator(".step")).toHaveCount(2);
  await expect(testDialog.locator(".step").first()).toContainText(
    "Abrir a aplicação.",
  );
  await testDialog.getByRole("button", { name: "Passo 2: falhou" }).click();
  await expect(testDialog.locator(".step").nth(1)).toHaveClass(/step-fail/);
  await expect(
    testDialog.getByRole("button", { name: "Passo 2: falhou" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(testDialog.locator(".test-meta-list")).toContainText(
    "1/2 executados",
  );
  await expect(testDialog.locator(".test-meta .status-badge")).toContainText(
    "Pendente",
  );
  await expect(
    testDialog.getByRole("button", { name: "Pendente", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await testDialog.getByRole("button", { name: "Aprovar" }).click();
  await expect(testDialog.locator(".test-meta .status-badge")).toContainText(
    "Aprovado",
  );
  await expect(
    testDialog.getByRole("button", { name: "Aprovar" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    testDialog.getByRole("button", { name: "Passo 2: falhou" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Registar resultado", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Rejeitar", exact: true }).click();
  const record = page.getByRole("button", {
    name: "Registar resultado",
    exact: true,
  });
  await expect(record).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Motivo da rejeição (obrigatório)" })
    .fill("Não confirma o pagamento. Precisamos de mais informação.");
  await record.click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Não confirma o pagamento. Precisamos de mais informação."),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").locator(".test-meta .status-badge"),
  ).toContainText("Rejeitado");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Pendente", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").locator(".test-meta .status-badge"),
  ).toContainText("Pendente");
  await expect(
    page.getByRole("button", { name: "Registar resultado", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".markdown script")).toHaveCount(0);
  await expect(page.locator('.markdown a[href^="javascript:"]')).toHaveCount(0);
  const editor = (await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Adicionar comentário" })
    .boundingBox())!;
  await page.mouse.move(editor.x + 40, editor.y + 20);
  await page.mouse.down();
  await page.mouse.move(100, 300, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.click(100, 300);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("member permissions, dark theme and mobile layout render without page overflow", async ({
  page,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/harness.html?theme=dark&role=member");
  await expect(
    page.getByRole("heading", { name: "Suites de testes" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
  ).toBe("#0d0d11");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole("button", { name: /^Ações de / })).toHaveCount(3);
  // Card layout: title, description and full-width progress stay visible.
  const card = page
    .getByRole("row")
    .filter({ hasText: "Checkout — pagamentos" });
  await expect(card.locator(".row-title")).toBeVisible();
  await expect(card.locator(".row-description")).toBeVisible();
  const [row, bar] = await Promise.all([
    card.boundingBox(),
    card.locator(".progress-track").boundingBox(),
  ]);
  expect(bar!.width).toBeGreaterThan(row!.width * 0.8);
  await expect(page.locator(".progress-track").first()).toBeAttached();
  await page
    .getByRole("button", { name: /^Ações de / })
    .first()
    .click();
  await expect(page.getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Arquivar" })).toHaveCount(0);
  expect(
    await page.locator(".suite-table").evaluate((table) => {
      const scroll = table.closest(".table-scroll")!;
      return scroll.scrollWidth <= scroll.clientWidth;
    }),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Boolean(document.elementFromPoint(20, 20)?.closest("#root")),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/list-mobile-dark.png",
    fullPage: true,
  });
});
test("edit dialogs retain unsaved content on conflicts and support keyboard dismissal", async ({
  page,
}) => {
  const { suites } = await mockApi(page);
  await page.goto("/tests/browser/harness.html?theme=contrast");
  const actions = page
    .getByRole("row")
    .filter({ hasText: "Checkout — pagamentos" })
    .getByRole("button", { name: "Ações de Checkout — pagamentos" });
  await actions.click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await page
    .getByLabel("Título", { exact: true })
    .fill("Título ainda não guardado");
  suites[0].version++;
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "alterado por outra pessoa",
  );
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue(
    "Título ainda não guardado",
  );
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document.querySelector("dialog")?.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(actions).toBeFocused();
});
test("suite tests support filters, scoped activity, reordering and TipTap checklists", async ({
  page,
}) => {
  const { suites, activities } = await mockApi(page);
  const original = suites[0].tests![0];
  activities.push({
    id: "comment-1",
    suiteId: suites[0].id,
    testId: original.id,
    actorName: "Ana Silva",
    kind: "comment",
    body: "O cenário foi revisto com a equipa.",
    detail: {},
    createdAt: "2026-10-05T14:30:00Z",
    attachments: [],
  });
  for (let index = 2; index <= 12; index++) {
    suites[0].tests!.push({
      ...original,
      id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      number: index,
      title: `Caso paginado ${index}`,
      status: index === 2 ? "approved" : index === 3 ? "revoked" : "pending",
      assigneeId: index === 4 ? null : original.assigneeId,
      position: index - 1,
    });
  }
  activities.push({
    id: "result-summary-1",
    suiteId: suites[0].id,
    testId: suites[0].tests![2].id,
    actorName: "Ana Silva",
    kind: "result_recorded",
    body: "O resultado não corresponde ao esperado.",
    detail: { status: "revoked" },
    createdAt: "2026-10-05T15:00:00Z",
    attachments: [],
  });
  Object.assign(
    suites[0],
    summarize(suites[0].tests!.map((test) => test.status)),
  );
  await page.setViewportSize({ width: 1100, height: 600 });
  await page.goto("/tests/browser/harness.html?screen=detail");
  await expect(page.locator(".summary-grid > .card")).toHaveCount(2);
  await expect(page.locator(".suite-tags .status-badge")).toHaveText(
    "Rejeitada",
  );
  const progress = page.locator(".progress-card");
  await expect(progress).toContainText("2/12 executados");
  await expect(progress.locator(".progress-figure")).toContainText("17%");
  await expect(progress.locator(".legend")).toContainText("Pendentes 10");
  const colours = await progress.evaluate((card) =>
    [".progress-track", ".progress-pass", ".progress-fail"].map(
      (selector) =>
        getComputedStyle(card.querySelector(selector)!).backgroundColor,
    ),
  );
  expect(colours).toEqual([
    "rgb(227, 227, 232)",
    "rgb(34, 160, 90)",
    "rgb(229, 72, 77)",
  ]);
  await page.getByRole("button", { name: "Ver detalhes" }).click();
  await expect(page.locator(".drawer-surface")).toBeVisible();
  const detailsDialog = page.getByRole("dialog", { name: "Detalhes da suite" });
  await expect(
    detailsDialog.getByRole("heading", { name: "Descrição", exact: true }),
  ).toBeVisible();
  await expect(
    detailsDialog.getByRole("heading", { name: "Resumo da atividade" }),
  ).toBeVisible();
  await expect(detailsDialog.locator(".suite-activity-summary")).toContainText(
    "marcou TC-3 como Rejeitado",
  );
  await expect(detailsDialog.locator(".suite-activity-summary")).toContainText(
    "adicionou um comentário ao TC-1",
  );
  await detailsDialog
    .getByRole("button", { name: "TC-1", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Validar fluxo principal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar" }).click();
  await expect(page.locator(".test-table tbody tr")).toHaveCount(10);
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 600 });
    expect(
      await page.locator(".test-table").evaluate((table) => {
        const scroll = table.closest(".table-scroll")!;
        return scroll.scrollWidth <= scroll.clientWidth;
      }),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1100, height: 600 });
  await expect(page.locator(".test-table tbody tr").nth(2)).toContainText(
    "TC-3",
  );
  await expect(page.getByLabel("Paginação dos testes")).toContainText(
    "1–10 de 12 testes",
  );
  await expect(page.locator(".suite-activity")).toHaveCount(0);

  await page.getByRole("button", { name: /Filtrar testes por estado/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Aprovado" }).click();
  await expect(page.locator(".test-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".test-table tbody tr")).toContainText(
    "Caso paginado 2",
  );
  // The menu stays open, so a second status widens the selection.
  await page.getByRole("menuitemcheckbox", { name: "Rejeitado" }).click();
  await expect(page.locator(".test-table tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Filtrar testes por estado/ }),
  ).toContainText("Aprovado, Rejeitado");
  await page.getByRole("menuitem", { name: "Limpar seleção" }).click();
  await page
    .getByRole("button", { name: /Filtrar testes por responsável/ })
    .click();
  await page.getByRole("menuitemradio", { name: "Sem responsável" }).click();
  await expect(page.locator(".test-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".test-table tbody tr")).toContainText(
    "Caso paginado 4",
  );
  await page
    .getByRole("button", { name: /Filtrar testes por responsável/ })
    .click();
  await page.getByRole("menuitemradio", { name: "Todos" }).click();
  await page.getByLabel("Pesquisar testes").fill("Caso paginado 12");
  await expect(page.locator(".test-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Pesquisar testes").fill("");

  await page
    .getByRole("row")
    .filter({ hasText: "Validar fluxo principal" })
    .click();
  const testDialog = page.getByRole("dialog", {
    name: "Validar fluxo principal",
  });
  const commentInput = testDialog.getByRole("textbox", {
    name: "Adicionar comentário",
  });
  await expect(commentInput).toHaveJSProperty("tagName", "DIV");
  await expect(
    testDialog.getByText("Adicionar comentário", { exact: true }),
  ).toHaveCount(0);
  await expect(
    testDialog.getByText("Conteúdo guardado em Markdown."),
  ).toHaveCount(0);
  await expect(
    testDialog.getByRole("button", { name: "Comentar" }),
  ).toBeDisabled();
  await expect(testDialog.locator(".timeline-comment")).toContainText(
    "O cenário foi revisto com a equipa.",
  );
  await expect(
    testDialog.getByRole("button", { name: "Teste anterior" }),
  ).toBeDisabled();
  await testDialog.getByRole("button", { name: "Teste seguinte" }).click();
  const nextDialog = page.getByRole("dialog", { name: "Caso paginado 2" });
  await expect(nextDialog.locator(".drawer-path")).toHaveText("SU-01 / TC-2");
  await nextDialog.getByRole("button", { name: "Teste anterior" }).click();
  await expect(testDialog).toBeVisible();
  await testDialog
    .getByRole("button", { name: "Próximo", exact: true })
    .click();
  await expect(nextDialog.locator(".drawer-path")).toHaveText("SU-01 / TC-2");
  await nextDialog.getByRole("button", { name: "Teste anterior" }).click();
  await testDialog.getByRole("button", { name: "Fechar" }).click();

  await expect(page.locator(".pagination-summary")).toHaveText(
    "1–10 de 12 testes",
  );
  await page.getByRole("button", { name: "Página seguinte" }).click();
  await expect(page.locator(".test-table tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("row").filter({ hasText: "Caso paginado 12" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reordenar Caso paginado 12" })
    .dragTo(page.getByRole("row").filter({ hasText: "Caso paginado 11" }), {
      targetPosition: { x: 200, y: 6 },
    });
  await expect(page.locator(".test-table tbody tr").first()).toContainText(
    "Caso paginado 12",
  );

  await page.getByRole("button", { name: "Ações de Caso paginado 12" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const instructions = page.getByRole("textbox", {
    name: "Instruções de teste manual",
  });
  const instructionsField = page.locator(".field").filter({
    has: instructions,
  });
  await instructions.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Nova verificação");
  await instructionsField.getByRole("button", { name: "Checklist" }).click();
  await expect(
    instructionsField.locator('ul[data-type="taskList"]'),
  ).toBeVisible();
  await expect(
    instructionsField.getByRole("button", { name: "Inserir tabela" }),
  ).toBeVisible();

  const modalBody = page.locator(".modal-body");
  await modalBody.evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(page.locator(".modal-heading")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fechar" })).toBeVisible();
});

test("local development mode signs in, switches users and signs out", async ({
  page,
}) => {
  const localUsers = [
    {
      oid: "10000000-0000-4000-8000-000000000001",
      name: "Ana Silva",
      email: "ana@local.test",
    },
    {
      oid: "10000000-0000-4000-8000-000000000002",
      name: "João Costa",
      email: "joao@local.test",
    },
  ];
  let current = localUsers[0];
  let revoked = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let status = 200;
    let result: unknown = {};
    if (path === "/config") {
      result = {
        mode: "local",
        tenantId: "",
        clientId: "",
        resourceUri: "",
        scope: "/access_as_user",
        configured: true,
        localUsers,
      };
    } else if (path === "/auth/local/session" && request.method() === "POST") {
      const oid = request.postDataJSON().oid;
      current = localUsers.find((user) => user.oid === oid)!;
      status = 201;
      result = { token: `local-${current.oid}`, user: current };
    } else if (
      path === "/auth/local/session" &&
      request.method() === "DELETE"
    ) {
      revoked++;
      status = 204;
      await route.fulfill({ status });
      return;
    } else if (path === "/me") {
      result = { ...current, id: current.oid, tenantId: "local" };
    } else if (path === "/projects") {
      result = [];
    } else {
      status = 404;
      result = { error: "Mock não definido" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/");
  await expect(page.getByText("Modo de desenvolvimento local")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Iniciar sessão com Microsoft" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await expect(page.locator(".sidebar-bottom")).toContainText("Ana Silva");
  await page.getByRole("button", { name: "Mudar utilizador" }).click();
  await expect(page.getByLabel("Utilizador local")).toBeVisible();
  await page.getByLabel("Utilizador local").selectOption(localUsers[1].oid);
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await expect(page.locator(".sidebar-bottom")).toContainText("João Costa");
  await page.getByRole("button", { name: "Mudar utilizador" }).click();
  expect(revoked).toBe(2);
});

test("comments mention members with @, attach files and testers stack in the table", async ({
  page,
}) => {
  const { suites, posted } = await mockApi(page);
  const people = [
    "Ana Silva",
    "João Costa",
    "Marta Santos",
    "Rui Lopes",
    "Inês Rocha",
    "Pedro Dias",
  ];
  suites[0].tests![0].testers = people.map((name, index) => ({
    id: `60000000-0000-4000-8000-00000000000${index}`,
    name,
  }));
  await page.goto("/tests/browser/harness.html?screen=detail");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Validar fluxo principal" });
  await expect(row.locator(".avatar-stack .user-avatar")).toHaveCount(5);
  await expect(row.locator(".avatar-more")).toHaveText("+2");
  await row.click();
  const dialog = page.getByRole("dialog", { name: "Validar fluxo principal" });
  await expect(dialog.locator(".tester-list li")).toHaveCount(6);
  const editor = dialog.getByRole("textbox", { name: "Adicionar comentário" });
  await editor.click();
  await page.keyboard.type("Pode rever @Ana");
  await expect(page.getByRole("option", { name: /Ana Silva/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".tiptap-editor .mention")).toHaveText(
    "@Ana Silva",
  );
  await page.keyboard.type(" por favor");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "captura.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgo=", "base64"),
  });
  await expect(dialog.locator(".pending-attachments")).toContainText(
    "captura.png",
  );
  await dialog.getByRole("button", { name: "Comentar" }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].data.mentions).toEqual([members[0].id]);
  expect(posted[0].data.attachmentIds).toEqual([
    "50000000-0000-4000-8000-000000000001",
  ]);
  expect(posted[0].data.body).toContain(`[@ id="${members[0].id}"`);
  await expect(dialog.locator(".pending-attachments")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await page
    .getByRole("button", { name: "Ações de Validar fluxo principal" })
    .click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByRole("textbox", { name: /^Passo \d$/ })).toHaveCount(
    2,
  );
  await page.getByRole("button", { name: "Adicionar passo" }).click();
  await page.getByRole("textbox", { name: "Passo 3" }).fill("Validar recibo");
  await expect(page.getByText("Confirmo que o resultado")).toHaveCount(0);
});

test("notification centre and global search open the exact test and comment", async ({
  page,
}) => {
  const suites = fixtures();
  const suite = suites[0];
  const testCase = suite.tests![0];
  const notification = {
    id: "70000000-0000-4000-8000-000000000001",
    kind: "mention",
    actorName: "João Costa",
    detail: { excerpt: "@Ana Silva consegue repetir?" },
    createdAt: "2026-10-06T10:00:00Z",
    readAt: null,
    projectId: project.id,
    projectName: project.name,
    suiteId: suite.id,
    suiteNumber: 1,
    suiteTitle: suite.title,
    testId: testCase.id,
    testNumber: 1,
    testTitle: testCase.title,
    activityId: "80000000-0000-4000-8000-000000000001",
  };
  let read = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    let status = 200;
    let result: unknown = {};
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
    } else if (path === "/me") result = members[0];
    else if (path === "/projects")
      result = [
        project,
        {
          ...project,
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          name: "Outro",
        },
      ];
    else if (path.endsWith("/members")) result = members;
    else if (path.endsWith("/photo")) return route.fulfill({ status: 204 });
    else if (path.endsWith("/summary"))
      result = { total: 3, archived: 0, counts: {} };
    else if (path.endsWith("/suites"))
      result = { items: suites, total: 3, pageSize: 30 };
    else if (path === "/notifications")
      result = {
        items: [{ ...notification, readAt: read ? "x" : null }],
        unread: read ? 0 : 1,
      };
    else if (path.endsWith("/read")) {
      read++;
      return route.fulfill({ status: 204 });
    } else if (path === "/search")
      result = {
        suites: [],
        tests: [
          {
            id: testCase.id,
            suiteId: suite.id,
            projectId: project.id,
            projectName: project.name,
            suiteNumber: 1,
            suiteTitle: suite.title,
            number: 1,
            title: testCase.title,
          },
        ],
        issues: [],
        comments: [],
      };
    else if (path.endsWith("/activity"))
      result = [
        {
          id: notification.activityId,
          suiteId: suite.id,
          testId: testCase.id,
          actorName: "João Costa",
          kind: "comment",
          body: `[@ id="${members[0].id}" label="Ana Silva"] consegue repetir?`,
          detail: {},
          createdAt: notification.createdAt,
          attachments: [],
        },
      ];
    else if (path === `/suites/${suite.id}`) result = suite;
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
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await expect(
    page.getByRole("heading", { name: "Suites de testes" }),
  ).toBeVisible();
  const switcher = page.getByRole("button", { name: /Mudar de projeto/ });
  await switcher.click();
  await expect(page.getByRole("menu")).toBeVisible();
  const menu = page.locator(".fui-MenuPopover");
  const [trigger, list] = [
    await switcher.boundingBox(),
    await menu.boundingBox(),
  ];
  expect(Math.round(list!.width)).toBe(Math.round(trigger!.width));
  await page.keyboard.press("Escape");
  const bell = page.getByRole("button", { name: "Notificações, 1 por ler" });
  await expect(bell).toBeVisible();
  await bell.click();
  const item = page.getByRole("button", {
    name: /Menção de João Costa em TC-1/,
  });
  await expect(item).toContainText("@Ana Silva consegue repetir?");
  await item.click();
  const dialog = page.getByRole("dialog", { name: testCase.title });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".timeline-flash")).toContainText(
    "consegue repetir?",
  );
  await expect(dialog.locator(".timeline-flash .mention")).toHaveText(
    "@Ana Silva",
  );
  // The highlight fades out by itself after a few seconds.
  await expect(dialog.locator(".timeline-flash")).toHaveCount(0, {
    timeout: 5000,
  });
  expect(read).toBe(1);
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(page).toHaveURL(new RegExp(`suite=${suite.id}$`));
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Procurar" });
  await search
    .getByRole("searchbox", {
      name: "Procurar suites, testes, issues e comentários",
    })
    .fill("fluxo");
  await search
    .getByRole("button", { name: /TC-1 Validar fluxo principal/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: testCase.title }),
  ).toBeVisible();
});

test("owners delete suites after a danger confirmation; members cannot", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/tests/browser/harness.html");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Registo de utilizador" });
  await row
    .getByRole("button", { name: "Ações de Registo de utilizador" })
    .click();
  await page.getByRole("menuitem", { name: "Apagar" }).click();
  const confirm = page.getByRole("dialog", { name: "Apagar suite" });
  await expect(confirm).toContainText("SU-02 «Registo de utilizador»");
  await expect(confirm.getByRole("button", { name: "Apagar" })).toHaveClass(
    /btn-danger/,
  );
  await confirm.getByRole("button", { name: "Apagar" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Registo de utilizador" }),
  ).toHaveCount(0);
  await page.goto("/tests/browser/harness.html?role=member&screen=detail");
  await expect(page.getByRole("button", { name: "Apagar suite" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Ações de Validar fluxo principal" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Editar" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Apagar" })).toHaveCount(0);
});

test("overflow menus open above modal drawers", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?screen=dialog-menu");
  await page.getByRole("button", { name: "Ações do drawer" }).click();
  const item = page.getByRole("menuitem", { name: "Arquivar" });
  await expect(item).toBeVisible();
  // A portal on <body> renders under the dialog's top layer and is not clickable.
  await item.click({ trial: true });
  await expect(page.locator("dialog[open] [role=menu]")).toHaveCount(1);
});

test("owners restore archived issues in bulk and archive by status rule", async ({
  page,
}) => {
  const status = (n: number, name: string, category: string) => ({
    id: `dddddddd-dddd-4ddd-8ddd-00000000000${n}`,
    projectId: project.id,
    name,
    color: "gray",
    category,
    position: n,
    version: 1,
  });
  const statuses = [
    status(1, "Backlog", "todo"),
    status(2, "Resolvido", "done"),
    status(3, "Duplicado", "done"),
  ];
  const issue = (n: number, title: string, archived: boolean) => ({
    id: `eeeeeeee-eeee-4eee-8eee-00000000000${n}`,
    projectId: project.id,
    number: n,
    title,
    description: "",
    statusId: statuses[2].id,
    priority: null,
    estimate: null,
    reportedAt: "2026-10-08T10:00:00Z",
    deployedAt: null,
    reporterId: members[0].id,
    reporterName: members[0].name,
    reporterNote: null,
    externalRef: null,
    position: 0,
    createdAt: "2026-10-08T10:00:00Z",
    updatedAt: "2026-10-08T10:00:00Z",
    archivedAt: archived ? "2026-10-08T11:00:00Z" : null,
    version: n + 1,
    assignees: [],
    moduleIds: [],
    labelIds: [],
    comments: 0,
  });
  let issues = [
    issue(1, "Repetido A", true),
    issue(2, "Repetido B", true),
    issue(3, "Repetido C", true),
    issue(4, "Repetido ativo", false),
  ];
  const posted: { path: string; data: any }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1", "");
    let result: unknown = {};
    if (path === "/me/preferences") result = {};
    else if (path.endsWith("/issue-config"))
      result = { statuses, modules: [], labels: [] };
    else if (path.endsWith("/issues/restore")) {
      const data = req.postDataJSON();
      posted.push({ path, data });
      const ids = data.issues.map((item: any) => item.id);
      issues = issues.map((item) =>
        ids.includes(item.id) ? { ...item, archivedAt: null } : item,
      );
      result = { restored: ids.length };
    } else if (path.endsWith("/issues/delete")) {
      const data = req.postDataJSON();
      posted.push({ path, data });
      const ids = data.issues.map((item: any) => item.id);
      issues = issues.filter((item) => !ids.includes(item.id));
      result = { deleted: ids.length };
    } else if (path.endsWith("/issues/archive")) {
      const data = req.postDataJSON();
      posted.push({ path, data });
      const before = issues.filter((item) => !item.archivedAt).length;
      issues = issues.map((item) => ({
        ...item,
        archivedAt: item.archivedAt || "2026-10-08T12:00:00Z",
      }));
      result = { archived: before };
    } else if (path.endsWith("/issues")) {
      const archived = url.searchParams.get("archive") === "archived";
      const items = issues.filter((item) => !!item.archivedAt === archived);
      result = {
        items,
        total: items.length,
        page: 1,
        pageSize: 25,
        counts: {
          active: issues.filter((item) => !item.archivedAt).length,
          archived: issues.filter((item) => item.archivedAt).length,
          open: 0,
        },
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/tests/browser/harness.html?screen=issues");
  await expect(page.getByText("Repetido ativo")).toBeVisible();
  const bar = page.getByRole("group", { name: "Ações em lote" });
  // Active issues are archived or deleted in bulk, never restored.
  await page
    .getByRole("checkbox", { name: "Selecionar IS-4 Repetido ativo" })
    .check();
  await expect(
    bar.getByRole("button", { name: "Arquivar selecionados" }),
  ).toBeVisible();
  await expect(
    bar.getByRole("button", { name: "Apagar selecionados" }),
  ).toBeVisible();
  await expect(
    bar.getByRole("button", { name: "Restaurar selecionados" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Arquivados/ }).click();
  // Changing tab clears the selection.
  await expect(bar).toContainText("Selecione issues");
  // Selecting from the checkbox must not open the issue panel.
  await page.getByRole("checkbox", { name: "Selecionar IS-1 Repetido A" }).check();
  await expect(page.locator(".drawer-surface")).toHaveCount(0);
  const all = page.getByRole("checkbox", {
    name: "Selecionar os issues desta página",
  });
  expect(await all.evaluate((box: HTMLInputElement) => box.indeterminate)).toBe(
    true,
  );
  await page.getByRole("checkbox", { name: "Selecionar IS-3 Repetido C" }).check();
  await expect(bar).toContainText("2 issues selecionados");
  await bar.getByRole("button", { name: "Restaurar selecionados" }).click();
  const dialog = page.getByRole("dialog", { name: "Restaurar issues" });
  await expect(dialog).toContainText("Restaurar 2 issues?");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("status")).toHaveText("2 issues restaurados.");
  expect(posted.at(-1)).toEqual({
    path: `/projects/${project.id}/issues/restore`,
    data: {
      issues: [
        { id: issues[0].id, version: 2 },
        { id: issues[2].id, version: 4 },
      ],
    },
  });
  await expect(page.getByText("Repetido B")).toBeVisible();
  await expect(page.getByText("Repetido A")).toHaveCount(0);
  await expect(bar).toContainText("Selecione issues");

  await bar.getByRole("button", { name: "Arquivar por regra" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Arquivar todos em «Resolvido»",
    "Arquivar todos em «Duplicado»",
    "Arquivar todos os concluídos",
  ]);
  await page
    .getByRole("menuitem", { name: "Arquivar todos em «Duplicado»" })
    .click();
  const rule = page.getByRole("dialog", { name: "Arquivar por regra" });
  await expect(rule).toContainText("Arquivar 3 issues ativos em «Duplicado»?");
  await rule.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("status")).toHaveText("3 issues arquivados.");
  expect(posted.at(-1)).toEqual({
    path: `/projects/${project.id}/issues/archive`,
    data: { statusIds: [statuses[2].id] },
  });
  await expect(page.getByText("Repetido ativo")).toBeVisible();
  // Deleting from Arquivados asks for a danger confirmation.
  await page
    .getByRole("checkbox", { name: "Selecionar IS-2 Repetido B" })
    .check();
  await bar.getByRole("button", { name: "Apagar selecionados" }).click();
  const remove = page.getByRole("dialog", { name: "Apagar issue" });
  await expect(remove).toContainText("Apagar 1 issue?");
  await remove.getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByRole("status")).toHaveText("1 issue apagado.");
  expect(posted.at(-1)).toEqual({
    path: `/projects/${project.id}/issues/delete`,
    data: {
      issues: [{ id: "eeeeeeee-eeee-4eee-8eee-000000000002", version: 3 }],
    },
  });
  await expect(page.getByText("Repetido B")).toHaveCount(0);
});

test("owners archive, restore and delete suites in bulk; members cannot select", async ({
  page,
}) => {
  const { posted } = await mockApi(page);
  await page.goto("/tests/browser/harness.html");
  const bar = page.getByRole("group", { name: "Ações em lote" });
  await expect(bar).toContainText("Selecione suites para ações em lote.");
  await page
    .getByRole("checkbox", { name: "Selecionar SU-01 Checkout — pagamentos" })
    .check();
  await expect(page.locator(".drawer-surface")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Selecionar SU-02 Registo de utilizador" })
    .check();
  await expect(bar).toContainText("2 suites selecionadas");
  await bar.getByRole("button", { name: "Arquivar selecionadas" }).click();
  const dialog = page.getByRole("dialog", { name: "Arquivar suites" });
  await expect(dialog).toContainText("Arquivar 2 suites?");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("status")).toHaveText("2 suites arquivadas.");
  expect(posted.at(-1)!.data.suites.map((item: any) => item.version)).toEqual([
    1, 1,
  ]);
  await expect(
    page.getByRole("row").filter({ hasText: "Checkout — pagamentos" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Arquivadas/ }).click();
  await page
    .getByRole("checkbox", { name: "Selecionar as suites desta página" })
    .check();
  await expect(bar).toContainText("2 suites selecionadas");
  await expect(
    bar.getByRole("button", { name: "Restaurar selecionadas" }),
  ).toBeVisible();
  await bar.getByRole("button", { name: "Apagar selecionadas" }).click();
  const remove = page.getByRole("dialog", { name: "Apagar suites" });
  await remove.getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByRole("status")).toHaveText("2 suites apagadas.");
  expect(posted.at(-1)!.path).toMatch(/\/suites\/delete$/);
  expect(posted.at(-1)!.data.suites.map((item: any) => item.version)).toEqual([
    2, 2,
  ]);
  await expect(page.getByText("Sem suites arquivadas")).toBeVisible();

  await page.goto("/tests/browser/harness.html?role=member");
  await expect(
    page.getByRole("row").filter({ hasText: "Recuperação de palavra-passe" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Ações em lote" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("first-run setup makes the signed-in person master, who then manages administrators", async ({
  page,
}) => {
  const ana = {
    id: "10000000-0000-4000-8000-0000000000a1",
    oid: "10000000-0000-4000-8000-000000000001",
    tenantId: "local",
    name: "Ana Silva",
    email: "ana@local.test",
  };
  const joao = {
    id: "10000000-0000-4000-8000-0000000000a2",
    oid: "10000000-0000-4000-8000-000000000002",
    tenantId: "local",
    name: "João Costa",
    email: "joao@local.test",
  };
  let master = false;
  let admins: any[] = [];
  const codes: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    let status = 200;
    let result: unknown = {};
    if (path === "/config")
      result = {
        mode: "local",
        tenantId: "",
        clientId: "",
        resourceUri: "",
        scope: "/access_as_user",
        configured: true,
        localUsers: [ana],
      };
    else if (path === "/auth/local/session") {
      status = 201;
      result = { token: "local-ana", user: ana };
    } else if (path === "/me")
      result = {
        ...ana,
        admin: master,
        master,
        setupRequired: !master,
      };
    else if (path === "/setup") {
      const { code } = request.postDataJSON();
      codes.push(code);
      if (code !== "abcd-1234") {
        status = 403;
        result = { error: "Código de setup inválido." };
      } else {
        master = true;
        admins = [
          {
            ...ana,
            master: true,
            createdAt: "2026-10-08T10:00:00Z",
            createdByName: ana.name,
          },
        ];
        status = 201;
        result = { ...ana, admin: true, master: true, setupRequired: false };
      }
    } else if (!master) {
      status = 409;
      result = { error: "A aplicação ainda não foi configurada." };
    } else if (path === "/projects") result = [];
    else if (path === "/notifications")
      result = { items: [], unread: 0, total: 0 };
    else if (path === "/admins" && request.method() === "GET") result = admins;
    else if (path === "/admins/directory") result = [ana, joao];
    else if (path === "/admins" && request.method() === "POST") {
      const added = {
        ...joao,
        master: false,
        createdAt: "2026-10-08T11:00:00Z",
        createdByName: ana.name,
      };
      admins = [...admins, added];
      status = 201;
      result = added;
    } else if (path === `/admins/${joao.id}`) {
      admins = admins.filter((admin) => admin.id !== joao.id);
      status = 204;
      await route.fulfill({ status });
      return;
    } else {
      status = 404;
      result = { error: "Mock não definido" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await expect(
    page.getByRole("heading", { name: "Configurar a aplicação" }),
  ).toBeVisible();
  await expect(page.locator(".setup-identity")).toContainText("Ana Silva");
  // The workspace stays hidden until the setup is done.
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByLabel("Código de setup").fill("errado");
  await page
    .getByRole("button", { name: "Tornar-me administrador master" })
    .click();
  await expect(page.getByText("Código de setup inválido.")).toBeVisible();
  await page.getByLabel("Código de setup").fill("abcd-1234");
  await page
    .getByRole("button", { name: "Tornar-me administrador master" })
    .click();
  await expect(page.locator(".sidebar-bottom")).toContainText("Administrador");
  expect(codes).toEqual(["errado", "abcd-1234"]);
  await expect(
    page.getByRole("button", { name: "Criar projeto" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Administração" }).click();
  await expect(
    page.getByRole("heading", { name: "Administração", level: 1 }),
  ).toBeVisible();
  const table = page.locator(".member-table");
  await expect(table).toContainText("Master");
  // The master can never be removed.
  await expect(
    page.getByRole("button", { name: /^Remover Ana Silva/ }),
  ).toHaveCount(0);
  await page.getByLabel("Pesquisar no diretório").fill("co");
  await page.getByRole("button", { name: "Pesquisar" }).click();
  await expect(page.locator(".member-list")).toContainText(
    "Já é administrador",
  );
  await page.getByRole("button", { name: "Tornar administrador" }).click();
  await expect(table).toContainText("João Costa");
  await expect(table).toContainText("por Ana Silva");
  await page
    .getByRole("button", { name: "Remover João Costa dos administradores" })
    .click();
  await page
    .getByRole("dialog", { name: "Remover administrador" })
    .getByRole("button", { name: "Remover" })
    .click();
  await expect(table).not.toContainText("João Costa");
});

test("board columns can be hidden and reordered per user, by drag or keyboard", async ({
  page,
}) => {
  const statuses = ["Backlog", "Resolvido", "Duplicado"].map((name, n) => ({
    id: `dddddddd-dddd-4ddd-8ddd-00000000000${n + 1}`,
    projectId: project.id,
    name,
    color: "gray",
    category: n ? "done" : "todo",
    position: n,
    version: 1,
  }));
  const issues = statuses.map((item, n) => ({
    id: `eeeeeeee-eeee-4eee-8eee-00000000000${n + 1}`,
    projectId: project.id,
    number: n + 1,
    title: `Issue ${item.name}`,
    description: "",
    statusId: item.id,
    priority: null,
    estimate: null,
    reportedAt: "2026-10-08T10:00:00Z",
    deployedAt: null,
    reporterId: members[0].id,
    reporterName: members[0].name,
    reporterNote: null,
    externalRef: null,
    position: 0,
    createdAt: "2026-10-08T10:00:00Z",
    updatedAt: "2026-10-08T10:00:00Z",
    archivedAt: null,
    version: 1,
    assignees: [],
    moduleIds: [],
    labelIds: [],
    comments: 0,
  }));
  const key = `issues.board.${project.id}`;
  const preferences: Record<string, unknown> = { "issues.view": "board" };
  const saved: any[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    let result: unknown = {};
    if (path === "/me/preferences") result = preferences;
    else if (path === `/me/preferences/${key}`) {
      const { value } = req.postDataJSON();
      preferences[key] = value;
      saved.push(value);
      result = { key, value };
    } else if (path.startsWith("/me/preferences/")) result = {};
    else if (path.endsWith("/issue-config"))
      result = { statuses, modules: [], labels: [] };
    else if (path.endsWith("/issues"))
      result = {
        items: issues,
        total: issues.length,
        page: 1,
        pageSize: 25,
        counts: { active: 3, archived: 0, open: 1 },
      };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  const columns = () =>
    page
      .locator(".board-column")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("aria-label")!.split(":")[0]),
      );
  const id = (name: string) => statuses.find((item) => item.name === name)!.id;
  await page.goto("/tests/browser/harness.html?screen=issues");
  await expect.poll(columns).toEqual(["Backlog", "Resolvido", "Duplicado"]);

  // Hide a status; the last visible one cannot be hidden.
  await page.getByRole("button", { name: "Estados visíveis no board" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Resolvido" }).click();
  await expect.poll(columns).toEqual(["Backlog", "Duplicado"]);
  expect(saved.at(-1)).toEqual({
    order: [id("Backlog"), id("Resolvido"), id("Duplicado")],
    hidden: [id("Resolvido")],
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Estados visíveis no board" }),
  ).toContainText("2/3");

  // Keyboard: Alt+← moves Duplicado before Backlog.
  await page
    .getByRole("button", { name: /^Coluna Duplicado/ })
    .press("Alt+ArrowLeft");
  await expect.poll(columns).toEqual(["Duplicado", "Backlog"]);
  expect(saved.at(-1).order).toEqual([
    id("Duplicado"),
    id("Backlog"),
    id("Resolvido"),
  ]);

  // Drag: Backlog's header onto the left half of Duplicado.
  await page
    .locator(".board-column-header")
    .filter({ hasText: "Backlog" })
    .dragTo(page.locator(".board-column").filter({ hasText: "Issue Duplicado" }), {
      targetPosition: { x: 10, y: 40 },
    });
  await expect.poll(columns).toEqual(["Backlog", "Duplicado"]);

  // The layout is saved on the server and comes back after a reload.
  await page.reload();
  await expect.poll(columns).toEqual(["Backlog", "Duplicado"]);

  await page.getByRole("button", { name: "Estados visíveis no board" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Duplicado" }).click();
  // The menu stays open; Backlog is now the only visible column.
  await expect.poll(columns).toEqual(["Backlog"]);
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Backlog" }),
  ).toBeDisabled();
  await page.getByRole("menuitem", { name: "Repor ordem e estados" }).click();
  await expect.poll(columns).toEqual(["Backlog", "Resolvido", "Duplicado"]);
  expect(saved.at(-1)).toEqual({ order: [], hidden: [] });
});
