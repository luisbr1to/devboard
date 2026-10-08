// Creates a demo project through the API of a local server (AUTH_MODE=local), acting as
// each local user so that activity, testers and notifications are produced as in real use.
// Usage: npm run seed:demo [-- --force]   (TESTHUB_URL defaults to http://localhost:PORT)
import "dotenv/config";
import { deflateSync } from "node:zlib";

const base = (
  process.env.TESTHUB_URL || `http://localhost:${process.env.PORT || 3978}`
).replace(/\/$/, "");
const projectName = "Loja Online · Demo";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  version?: number,
  headers: Record<string, string> = {},
): Promise<Json> {
  const binary = body instanceof Uint8Array;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !binary
        ? { "Content-Type": "application/json" }
        : {}),
      ...(version !== undefined ? { "If-Match": String(version) } : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : binary
          ? new Blob([body as Uint8Array<ArrayBuffer>])
          : JSON.stringify(body),
  });
  if (response.status === 204) return undefined;
  const data = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${data.error}`);
  return data;
}

// Minimal PNG encoder for a screenshot-like image (no extra dependencies).
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function screenshot(accent: [number, number, number]) {
  const width = 480;
  const height = 300;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      let color: [number, number, number] = [246, 246, 248];
      if (y < 36) color = [24, 24, 29];
      else if (y > 60 && y < 250 && x > 40 && x < 440) {
        color = [255, 255, 255];
        if (y > 76 && y < 104 && x > 60 && x < 420) color = accent;
        else if ((y - 120) % 26 < 10 && y > 120 && y < 230 && x > 60)
          color = x < 60 + ((y * 7) % 300) ? [227, 227, 232] : color;
      }
      row.set(color, 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);

interface TestSpec {
  title: string;
  steps: string[];
  expected: string;
  assignee?: string;
  instructions?: string;
}
const ANA = "Ana Silva";
const JOAO = "João Costa";
const MARTA = "Marta Santos";
const RUI = "Rui Lopes";
const INES = "Inês Rocha";
const CARLA = "Carla Mendes";
const TOMAS = "Tomás Ferreira";

async function seed() {
  const config = await call(null, "GET", "/config");
  if (config.mode !== "local")
    throw new Error("O servidor não está em AUTH_MODE=local.");
  const people: { oid: string; name: string }[] = config.localUsers;
  for (const name of [ANA, JOAO, MARTA, RUI, INES, CARLA, TOMAS])
    if (!people.some((person) => person.name === name))
      throw new Error(
        `Utilizador local em falta: ${name}. Reinicie o servidor com o código atual.`,
      );
  const tokens: Record<string, string> = {};
  for (const person of people)
    tokens[person.name] = (
      await call(null, "POST", "/auth/local/session", { oid: person.oid })
    ).token;
  const as = (name: string) => tokens[name];
  // Projects are created by administrators: Ana runs the setup when needed.
  let me = await call(as(ANA), "GET", "/me");
  if (me.setupRequired) {
    if (!process.env.TESTHUB_SETUP_CODE)
      throw new Error(
        "Conclua o setup inicial na aplicação ou defina TESTHUB_SETUP_CODE para que a Ana o conclua.",
      );
    me = await call(as(ANA), "POST", "/setup", {
      code: process.env.TESTHUB_SETUP_CODE,
    });
  }
  if (!me.admin)
    throw new Error(
      `${ANA} tem de ser administradora da aplicação para criar o projeto de demonstração.`,
    );

  const existing = (await call(as(ANA), "GET", "/projects")).find(
    (project: Json) => project.name === projectName,
  );
  if (existing && !process.argv.includes("--force")) {
    console.log(
      `O projeto «${projectName}» já existe. Use --force para criar outro.\n${base}/tabs/home/#project=${existing.id}`,
    );
    return;
  }
  const project = await call(as(ANA), "POST", "/projects", {
    name: projectName,
    description:
      "Projeto de demonstração com suites, passos, testers, menções, anexos e notificações.",
  });
  // Administrators do not join the projects they create; Ana joins as owner.
  const roles: Record<string, "owner" | "member"> = {
    [ANA]: "owner",
    [JOAO]: "owner",
  };
  for (const person of people)
    await call(as(ANA), "POST", `/projects/${project.id}/members`, {
      oid: person.oid,
      role: roles[person.name] || "member",
    });
  const members: Json[] = await call(
    as(ANA),
    "GET",
    `/projects/${project.id}/members`,
  );
  const idOf = (name: string) =>
    members.find((member) => member.name === name).id as string;
  const mention = (name: string) => `[@ id="${idOf(name)}" label="${name}"]`;

  const createSuite = (
    who: string,
    title: string,
    description: string,
    tests: TestSpec[],
    token = as(who),
  ) =>
    call(
      token,
      "POST",
      `/projects/${project.id}/suites`,
      {
        title,
        description,
        tests: tests.map((test) => ({
          title: test.title,
          instructions: test.instructions || "",
          steps: test.steps,
          expectedResult: test.expected,
          assigneeId: test.assignee ? idOf(test.assignee) : null,
        })),
      },
      undefined,
      token.startsWith("th_")
        ? { "Idempotency-Key": `demo-${Date.now()}` }
        : {},
    );
  const testOf = async (suiteId: string, number: number) =>
    (await call(as(ANA), "GET", `/suites/${suiteId}`)).tests.find(
      (test: Json) => test.number === number,
    );
  const steps = async (
    who: string,
    suiteId: string,
    number: number,
    statuses: ("passed" | "failed")[],
  ) => {
    const test = await testOf(suiteId, number);
    for (const [index, status] of statuses.entries())
      await call(
        as(who),
        "POST",
        `/tests/${test.id}/steps/${test.steps[index].id}/result`,
        { status },
        test.steps[index].version,
      );
  };
  const upload = async (
    who: string,
    suiteId: string,
    testId: string | null,
    name: string,
    data: Buffer,
  ) =>
    (
      await call(
        as(who),
        "POST",
        `/suites/${suiteId}/attachments${testId ? `?testId=${testId}` : ""}`,
        new Uint8Array(data),
        undefined,
        {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(name),
        },
      )
    ).id as string;
  const result = async (
    who: string,
    suiteId: string,
    number: number,
    status: "approved" | "revoked" | "pending",
    comment = "",
    options: { mentions?: string[]; files?: [string, Buffer][] } = {},
  ) => {
    const test = await testOf(suiteId, number);
    const attachmentIds = [];
    for (const [name, data] of options.files || [])
      attachmentIds.push(await upload(who, suiteId, test.id, name, data));
    await call(
      as(who),
      "POST",
      `/tests/${test.id}/result`,
      {
        status,
        comment,
        mentions: (options.mentions || []).map(idOf),
        attachmentIds,
      },
      test.version,
    );
  };
  const comment = async (
    who: string,
    suiteId: string,
    number: number | null,
    body: string,
    options: { mentions?: string[]; files?: [string, Buffer][] } = {},
  ) => {
    const test = number ? await testOf(suiteId, number) : null;
    const attachmentIds = [];
    for (const [name, data] of options.files || [])
      attachmentIds.push(
        await upload(who, suiteId, test?.id ?? null, name, data),
      );
    await call(
      as(who),
      "POST",
      test ? `/tests/${test.id}/comments` : `/suites/${suiteId}/comments`,
      {
        body,
        mentions: (options.mentions || []).map(idOf),
        attachmentIds,
      },
    );
  };
  const red = screenshot([229, 72, 77]);
  const indigo = screenshot([79, 70, 229]);
  const log = (lines: string[]) => Buffer.from(lines.join("\n") + "\n");

  // SU-01: rejected, many testers on TC-1.
  const auth = await createSuite(
    ANA,
    "Registo e autenticação",
    "## Objetivo\nValidar o registo, a validação por email e o início de sessão antes da release 1.0.\n\n**Ambiente:** Staging · **Build:** 1.0.0-rc.2",
    [
      {
        title: "Registar conta",
        assignee: ANA,
        steps: [
          "Criar conta através da aplicação.",
          "Verificar que o login é bloqueado enquanto a conta não estiver validada.",
          "Verificar que o email de validação chega e que o link valida a conta.",
        ],
        expected:
          "O utilizador consegue criar conta e validá-la, podendo depois iniciar sessão.",
      },
      {
        title: "Validar email de confirmação",
        assignee: JOAO,
        steps: [
          "Registar uma conta nova.",
          "Abrir o email recebido.",
          "Confirmar que o remetente e o assunto estão corretos.",
        ],
        expected: "O email chega em menos de 1 minuto com o link de validação.",
      },
      {
        title: "Login com credenciais válidas",
        assignee: MARTA,
        steps: [
          "Abrir o ecrã de login.",
          "Introduzir email e palavra-passe válidos.",
        ],
        expected: "A sessão é iniciada e o utilizador vê a página inicial.",
      },
      {
        title: "Bloqueio após 5 tentativas falhadas",
        assignee: CARLA,
        steps: [
          "Introduzir uma palavra-passe errada 5 vezes.",
          "Tentar a palavra-passe correta.",
          "Confirmar a mensagem de bloqueio temporário.",
        ],
        expected: "A conta fica bloqueada 15 minutos com mensagem clara.",
      },
      {
        title: "Recuperar palavra-passe",
        assignee: RUI,
        instructions: "Usar uma conta já validada.",
        steps: [
          "Escolher «Esqueci-me da palavra-passe».",
          "Introduzir o email da conta.",
          "Abrir o link recebido.",
          "Definir uma nova palavra-passe e iniciar sessão.",
        ],
        expected:
          "A nova palavra-passe funciona e a antiga deixa de funcionar.",
      },
    ],
  );
  await steps(MARTA, auth.id, 1, ["passed", "passed", "failed"]);
  await comment(
    MARTA,
    auth.id,
    1,
    `${mention(ANA)} o link de validação devolve **403** quando aberto noutro navegador. Segue captura e log.`,
    {
      mentions: [ANA],
      files: [
        ["erro-validacao.png", red],
        [
          "consola.log",
          log([
            "GET /auth/validate?token=… 403 Forbidden",
            "x-request-id: 7f3c2a",
            "Token associado a outra sessão",
          ]),
        ],
      ],
    },
  );
  await comment(INES, auth.id, 1, "Consegui reproduzir no Safari iOS também.");
  await comment(
    RUI,
    auth.id,
    1,
    "No Firefox funciona. Parece ligado à sessão.",
  );
  await comment(
    CARLA,
    auth.id,
    1,
    `Do nosso lado (parceiro) acontece o mesmo. ${mention(JOAO)} pode confirmar a configuração dos cookies?`,
    { mentions: [JOAO] },
  );
  await steps(TOMAS, auth.id, 1, ["passed"]);
  await result(
    JOAO,
    auth.id,
    1,
    "revoked",
    `Rejeitado: o link de validação só funciona na mesma sessão. ${mention(MARTA)} obrigado pela análise.`,
    { mentions: [MARTA], files: [["rejeicao.png", red]] },
  );
  await steps(JOAO, auth.id, 2, ["passed", "passed", "passed"]);
  await result(JOAO, auth.id, 2, "approved", "Chegou em 12 segundos.");
  await steps(RUI, auth.id, 3, ["passed", "passed"]);
  await result(RUI, auth.id, 3, "approved");
  await steps(CARLA, auth.id, 4, ["passed", "passed", "failed"]);
  await comment(
    CARLA,
    auth.id,
    4,
    "O bloqueio só acontece à 6.ª tentativa e a mensagem não indica a duração.",
    {
      files: [
        [
          "tentativas.log",
          log(["tentativa 1..5: 401", "tentativa 6: 423 Locked"]),
        ],
      ],
    },
  );
  await comment(
    INES,
    auth.id,
    5,
    `${mention(RUI)} quando puderes, este depende do fix do email.`,
    { mentions: [RUI] },
  );

  // SU-02: in progress, created by João; edits, reassignment, add and delete a test.
  const checkout = await createSuite(
    JOAO,
    "Checkout e pagamentos",
    "Carrinho, MB Way, cartão e fatura.\n\n**Ambiente:** Staging · **Build:** 1.0.0-rc.2",
    [
      {
        title: "Adicionar livros ao carrinho",
        assignee: INES,
        steps: [
          "Pesquisar um livro.",
          "Adicionar ao carrinho.",
          "Abrir o carrinho.",
        ],
        expected: "O livro aparece no carrinho com o preço correto.",
      },
      {
        title: "Pagamento com cartão",
        assignee: ANA,
        steps: [
          "Escolher cartão.",
          "Introduzir cartão de teste 4242.",
          "Confirmar.",
        ],
        expected: "Pagamento aceite e encomenda criada.",
      },
      {
        title: "Pagamento com MB Way",
        assignee: RUI,
        steps: [
          "Escolher MB Way.",
          "Introduzir o número de telemóvel.",
          "Aceitar na app.",
        ],
        expected: "Pagamento aceite após confirmação na app MB Way.",
      },
      {
        title: "Cartão recusado",
        assignee: TOMAS,
        steps: ["Usar o cartão de teste recusado.", "Confirmar o pagamento."],
        expected: "Mensagem clara e encomenda não criada.",
      },
      {
        title: "Fatura em PDF",
        assignee: MARTA,
        steps: [
          "Concluir uma compra.",
          "Descarregar a fatura na área de cliente.",
        ],
        expected: "A fatura PDF tem NIF, IVA e total corretos.",
      },
      {
        title: "Portes grátis acima de 30 €",
        assignee: JOAO,
        steps: ["Adicionar livros até 31 €.", "Avançar para o checkout."],
        expected: "Os portes aparecem a 0,00 €.",
      },
    ],
  );
  await steps(INES, checkout.id, 1, ["passed", "passed", "passed"]);
  await result(INES, checkout.id, 1, "approved");
  await steps(TOMAS, checkout.id, 4, ["passed", "passed"]);
  await result(TOMAS, checkout.id, 4, "approved", "Mensagem correta.");
  await steps(RUI, checkout.id, 3, ["passed", "failed"]);
  await comment(
    RUI,
    checkout.id,
    3,
    `${mention(JOAO)} o pedido MB Way expira ao fim de 30 s em vez de 4 min.`,
    { mentions: [JOAO], files: [["mbway-timeout.png", indigo]] },
  );
  await result(MARTA, checkout.id, 5, "approved", "Fatura conferida.", {
    files: [["fatura-exemplo.pdf", pdf]],
  });
  await steps(ANA, checkout.id, 2, ["passed", "passed", "passed"]);
  await result(ANA, checkout.id, 2, "approved");
  const freeShipping = await testOf(checkout.id, 6);
  await call(
    as(JOAO),
    "PATCH",
    `/tests/${freeShipping.id}`,
    {
      title: freeShipping.title,
      instructions: "Usar uma morada em Portugal continental.",
      steps: [
        "Adicionar livros até 31 €.",
        "Avançar para o checkout.",
        "Confirmar o resumo da encomenda.",
      ],
      expectedResult: freeShipping.expectedResult,
      assigneeId: idOf(ANA),
    },
    freeShipping.version,
  );
  const duplicate = await call(
    as(JOAO),
    "POST",
    `/suites/${checkout.id}/tests`,
    {
      title: "Pagamento com cartão (duplicado)",
      instructions: "",
      steps: ["Repetir o pagamento com cartão."],
      expectedResult: "Igual ao TC-2.",
      assigneeId: idOf(RUI),
    },
    (await call(as(JOAO), "GET", `/suites/${checkout.id}`)).version,
  );
  await call(
    as(RUI),
    "DELETE",
    `/tests/${duplicate.id}`,
    undefined,
    duplicate.version,
  );

  // SU-03: approved, then edited.
  const searchSuite = await createSuite(
    ANA,
    "Pesquisa de livros",
    "Filtros, ordenação e resultados.",
    [
      {
        title: "Pesquisar por título",
        assignee: MARTA,
        steps: ["Pesquisar «Os Maias»."],
        expected: "O livro aparece em primeiro lugar.",
      },
      {
        title: "Filtrar por autor",
        assignee: JOAO,
        steps: ["Abrir filtros.", "Escolher «Eça de Queirós»."],
        expected: "Só aparecem livros do autor.",
      },
      {
        title: "Ordenar por preço",
        assignee: INES,
        steps: ["Ordenar por preço crescente."],
        expected: "A lista fica ordenada.",
      },
      {
        title: "Pesquisa sem resultados",
        assignee: CARLA,
        steps: ["Pesquisar «xyzxyz»."],
        expected: "Mensagem «Sem resultados» com sugestões.",
      },
    ],
  );
  for (const [who, number] of [
    [MARTA, 1],
    [JOAO, 2],
    [INES, 3],
    [CARLA, 4],
  ] as const) {
    const test = await testOf(searchSuite.id, number);
    await steps(
      who,
      searchSuite.id,
      number,
      test.steps.map(() => "passed" as const),
    );
    await result(who, searchSuite.id, number, "approved");
  }
  const current = await call(as(JOAO), "GET", `/suites/${searchSuite.id}`);
  await call(
    as(JOAO),
    "PATCH",
    `/suites/${searchSuite.id}`,
    {
      title: current.title,
      description:
        "Filtros, ordenação e resultados. Revisto para a release 1.0.",
    },
    current.version,
  );
  await comment(JOAO, searchSuite.id, null, "Suite fechada, obrigado a todos!");

  // SU-04: published by an integration key, untouched (Por iniciar).
  const key = await call(as(ANA), "POST", `/projects/${project.id}/keys`, {
    name: "Pipeline de QA",
  });
  await createSuite(
    ANA,
    "Smoke test v1.0",
    "Fluxos críticos antes do release, gerados pelo pipeline.",
    [
      {
        title: "Abrir a aplicação",
        steps: ["Abrir a app em modo anónimo."],
        expected: "Página inicial em menos de 2 s.",
      },
      {
        title: "Iniciar sessão",
        steps: ["Entrar com a conta de teste."],
        expected: "Sessão iniciada.",
      },
      {
        title: "Pesquisar um livro",
        steps: ["Pesquisar «Mensagem»."],
        expected: "Resultados relevantes.",
      },
      {
        title: "Comprar com cartão",
        steps: ["Comprar um livro com o cartão 4242."],
        expected: "Encomenda criada.",
      },
      {
        title: "Ver encomendas",
        steps: ["Abrir a área de cliente."],
        expected: "A encomenda aparece.",
      },
      {
        title: "Terminar sessão",
        steps: ["Terminar sessão."],
        expected: "Volta ao ecrã inicial.",
      },
    ],
    key.secret,
  );

  // SU-05: completed and archived.
  const release = await createSuite(
    ANA,
    "Release 0.9 — regressão",
    "Regressão da versão anterior.",
    [
      {
        title: "Registo",
        assignee: MARTA,
        steps: ["Registar conta."],
        expected: "Conta criada.",
      },
      {
        title: "Checkout",
        assignee: RUI,
        steps: ["Comprar um livro."],
        expected: "Encomenda criada.",
      },
      {
        title: "Fatura",
        assignee: INES,
        steps: ["Descarregar fatura."],
        expected: "PDF correto.",
      },
    ],
  );
  for (const [who, number] of [
    [MARTA, 1],
    [RUI, 2],
    [INES, 3],
  ] as const)
    await result(who, release.id, number, "approved");
  await call(
    as(ANA),
    "POST",
    `/suites/${release.id}/archive`,
    undefined,
    (await call(as(ANA), "GET", `/suites/${release.id}`)).version,
  );

  // SU-06: a draft that is deleted (logical deletion and its notifications).
  const draft = await createSuite(
    ANA,
    "Rascunho — pagamentos antigos",
    "Substituída por «Checkout e pagamentos».",
    [
      {
        title: "Pagamento por referência",
        assignee: MARTA,
        steps: ["Gerar referência."],
        expected: "Referência válida.",
      },
    ],
  );
  await comment(MARTA, draft.id, 1, "Isto já não se aplica, certo?");
  await call(
    as(JOAO),
    "DELETE",
    `/suites/${draft.id}`,
    undefined,
    (await call(as(JOAO), "GET", `/suites/${draft.id}`)).version,
  );

  console.log(`Projeto de demonstração criado: «${projectName}»`);
  console.log(`Abrir: ${base}/tabs/home/#project=${project.id}`);
  console.log(
    "Entre como Ana Silva para ver notificações por ler; mude de utilizador no canto inferior da barra lateral.",
  );
}
void seed().catch((error) => {
  console.error("Falha ao criar os dados de demonstração:", error.message);
  process.exitCode = 1;
});
