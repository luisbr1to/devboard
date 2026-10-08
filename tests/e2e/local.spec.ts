import { test, expect, type Page } from "@playwright/test";

/** The first sign-in on a fresh database goes through the setup and becomes master. */
async function finishSetup(page: Page) {
  await expect(page.locator(".sidebar, .setup-form").first()).toBeVisible();
  if (!(await page.locator(".setup-form").count())) return;
  await page.getByLabel("Código de setup").fill("e2e-setup-code");
  await page
    .getByRole("button", { name: "Tornar-me administrador master" })
    .click();
  await expect(page.locator(".sidebar-bottom")).toContainText("Administrador");
}

test("complete local workflow uses Docker PostgreSQL and preserves attribution", async ({
  page,
}) => {
  await page.goto("/tabs/home/");
  const localUser = page.getByLabel("Utilizador local");
  await expect(localUser).toBeVisible();
  await localUser.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Entrar localmente" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await finishSetup(page);
  await expect(
    page.getByRole("heading", { name: "Os seus projetos de QA" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Criar projeto", exact: true })
    .last()
    .click();
  const projectDialog = page.getByRole("dialog", { name: "Criar projeto" });
  await projectDialog.getByLabel("Nome").fill("Projeto E2E local");
  await projectDialog
    .getByRole("textbox", { name: "Descrição" })
    .fill("Fluxo completo com PostgreSQL Docker.");
  await projectDialog.getByRole("button", { name: "Guardar" }).click();
  // A new project opens in its settings, where the administrator adds the team.
  await expect(page.getByRole("heading", { name: "Definições" })).toBeVisible();

  const hash = await page.evaluate(() => location.hash.slice(1));
  const projectId = new URLSearchParams(hash).get("project");
  expect(projectId).toBeTruthy();
  await page
    .locator(".sidebar-nav")
    .getByRole("link", { name: "Definições" })
    .click();
  await page.getByLabel("Pesquisar no diretório").fill("João");
  await page.getByRole("button", { name: "Pesquisar" }).click();
  const joao = page
    .locator(".member-list li")
    .filter({ hasText: "João Costa" });
  await joao.getByRole("button", { name: "Adicionar / atualizar" }).click();
  await expect(
    page.locator(".member-table tbody tr").filter({ hasText: "João Costa" }),
  ).toContainText("Membro");

  await page.getByLabel("Nome da integração").fill("Publicação E2E");
  await page.getByRole("button", { name: "Criar chave" }).click();
  const secret = (await page.locator(".secret-box code").textContent())!;
  expect(secret).toMatch(/^th_/);
  const published = await page.request.post(
    `/api/v1/projects/${projectId}/suites`,
    {
      headers: {
        Authorization: `Bearer ${secret}`,
        "Idempotency-Key": "e2e-local-suite-v1",
      },
      data: {
        title: "Suite publicada E2E",
        description: "# Publicada pela integração local",
        tests: [
          {
            title: "Validar checkout local",
            instructions: "1. Abrir checkout\n2. Confirmar pagamento",
            expectedResult: "Pagamento confirmado",
          },
        ],
      },
    },
  );
  expect(published.status()).toBe(201);
  await page.getByRole("button", { name: "Já guardei" }).click();
  await page
    .locator(".sidebar-nav")
    .getByRole("link", { name: /Suite de testes/ })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "Suite publicada E2E" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suite publicada E2E" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Mudar utilizador" }).click();
  await page
    .getByLabel("Utilizador local")
    .selectOption({ label: "João Costa · joao@local.test" });
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await expect(page.locator(".sidebar-bottom")).toContainText("João Costa");
  await page
    .getByRole("row")
    .filter({ hasText: "Validar checkout local" })
    .click();
  await page.getByRole("button", { name: "Rejeitar" }).click();
  await page
    .getByRole("textbox", { name: "Motivo da rejeição (obrigatório)" })
    .fill("O pagamento não foi confirmado no fluxo E2E.");
  await page.getByRole("button", { name: "Registar resultado" }).click();
  const testDialog = page.getByRole("dialog", {
    name: "Validar checkout local",
  });
  await expect(testDialog).toContainText("Rejeitado");
  await expect(
    testDialog.locator(".timeline").getByText("João Costa", { exact: true }),
  ).toBeVisible();
  await expect(
    testDialog.getByText("O pagamento não foi confirmado no fluxo E2E."),
  ).toBeVisible();
  await testDialog.getByRole("button", { name: "Fechar" }).click();
  await expect(page.locator(".suite-activity")).toHaveCount(0);

  await page.getByRole("button", { name: "Mudar utilizador" }).click();
  await page
    .getByLabel("Utilizador local")
    .selectOption({ label: "Ana Silva · ana@local.test" });
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await page.getByRole("button", { name: "Arquivar suite" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Esta suite está arquivada.")).toBeVisible();
  await page.getByRole("button", { name: "Restaurar suite" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("button", { name: "Arquivar suite" }),
  ).toBeVisible();
  await expect(page.getByText("Revogado", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("development area: issues, self-assignment, board and spreadsheet import", async ({
  page,
}) => {
  await page.goto("/tabs/home/");
  await page
    .getByLabel("Utilizador local")
    .selectOption({ label: "Ana Silva · ana@local.test" });
  await page.getByRole("button", { name: "Entrar localmente" }).click();
  await finishSetup(page);
  await page.locator(".project-switcher").click();
  await page.getByRole("menuitem", { name: "Criar projeto" }).click();
  const projectDialog = page.getByRole("dialog", { name: "Criar projeto" });
  await projectDialog.getByLabel("Nome").fill("Desenvolvimento E2E");
  await projectDialog.getByRole("button", { name: "Guardar" }).click();
  // Administrators are not members: Ana joins as owner to be assignable.
  await page.getByLabel("Pesquisar no diretório").fill("Ana");
  await page.locator(".member-search").getByLabel("Papel").selectOption("owner");
  await page.getByRole("button", { name: "Pesquisar" }).click();
  await page
    .locator(".member-list li")
    .filter({ hasText: "Ana Silva" })
    .getByRole("button", { name: "Adicionar / atualizar" })
    .click();
  await expect(
    page.locator(".member-table tbody tr").filter({ hasText: "Ana Silva" }),
  ).toContainText("Proprietário");
  await page
    .locator(".sidebar-nav")
    .getByRole("link", { name: /Desenvolvimento/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Desenvolvimento" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Novo issue" }).click();
  const form = page.getByRole("dialog", { name: "Novo issue" });
  await form
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Talão de oferta no histórico");
  await form.getByRole("combobox", { name: "Prioridade" }).click();
  await form.getByRole("option", { name: "Alta", exact: true }).click();
  await expect(
    form.getByRole("combobox", { name: "Prioridade" }),
  ).toContainText("Alta");
  await form.getByRole("button", { name: "Criar issue" }).click();
  const panel = page.getByRole("dialog", {
    name: "Talão de oferta no histórico",
  });
  await expect(panel).toContainText("IS-1");
  await expect(panel).toContainText("Ana Silva");
  // Self-assignment through the multi-select: the current user is listed first as "(eu)".
  const people = panel.getByRole("combobox", { name: "Responsáveis" });
  await people.click();
  await panel.getByRole("option", { name: "Ana Silva (eu)" }).click();
  await people.press("Escape");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Remover Ana Silva (eu)" }),
  ).toBeAttached();
  await expect(panel).toContainText("atribuiu-se o issue");
  await panel.getByRole("combobox", { name: "Estado" }).click();
  await panel.getByRole("option", { name: "Em curso" }).click();
  await expect(panel).toContainText(
    "mudou o estado de «Backlog» para «Em curso»",
  );
  await panel.getByRole("button", { name: "Fechar" }).click();

  const row = page
    .getByRole("row")
    .filter({ hasText: "Talão de oferta no histórico" });
  await expect(row).toContainText("Em curso");
  await expect(row).toContainText("Alta");

  // Columns other than ID and Issue are reordered by dragging headers or Alt+arrows; the order persists.
  // The owner's selection column is not one of the movable data columns.
  const headers = () =>
    page
      .locator(".issue-table thead th:not(.select-column)")
      .allTextContents();
  await page
    .locator("th.issue-col-reported")
    .dragTo(page.locator("th.issue-col-status"), {
      targetPosition: { x: 4, y: 10 },
    });
  await page
    .locator("th.issue-col-priority")
    .dragTo(page.locator("th.issue-col-id"));
  await page.getByRole("button", { name: /Coluna Reporter/ }).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  const order = [
    "ID",
    "Issue",
    "Criado em",
    "Estado",
    "Reporter",
    "Prioridade",
    "Responsáveis",
    "Ações",
  ];
  await expect.poll(headers).toEqual(order);
  await page.reload();
  await expect.poll(headers).toEqual(order);

  await page.getByRole("button", { name: "Board" }).click();
  const doing = page.getByRole("listitem", { name: /^Em curso: 1 issues/ });
  await expect(doing).toContainText("Talão de oferta no histórico");
  await doing
    .getByRole("button", { name: "Ações de Talão de oferta no histórico" })
    .click();
  await page.getByRole("menuitem", { name: "Mover para Para testar" }).click();
  await expect(
    page.getByRole("listitem", { name: /^Para testar: 1 issues/ }),
  ).toContainText("Talão de oferta no histórico");
  await page.getByRole("button", { name: "Tabela" }).click();

  await page.getByRole("button", { name: "Importar" }).click();
  const importer = page.getByRole("dialog", { name: "Importar issues" });
  await importer.locator('input[type="file"]').setInputFiles({
    name: "projeto-demo.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Id,Utilizador,Módulo,Informações/teste,Data,Estado DSI,Tipo,Prioridade DSI+DM,User DSI,Obs DSI",
        '1,ana,frontend,"Data de nascimento opcional no perfil",04-08-2024,Resolvido,Melhoria,2,ana,"o campo não existe"',
        "2,cmendes,backoffice - email,Pop-ups configuráveis,2025-08-22,TBR,Bug,4,,",
      ].join("\n"),
    ),
  });
  await expect(importer).toContainText("projeto-demo.csv · 2 linhas");
  await expect(importer.getByLabel("Associar ana")).toHaveValue(/.+/);
  await importer.getByRole("button", { name: "Rever" }).click();
  await expect(importer).toContainText("2 issues a criar");
  await importer.getByRole("button", { name: "Importar 2 issues" }).click();
  await expect(importer).toContainText("Foram criados 2 issues");
  await importer.getByRole("button", { name: "Concluir" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Pop-ups configuráveis" }),
  ).toContainText("Para testar");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
