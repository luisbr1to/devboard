import "dotenv/config";
import { readFile } from "node:fs/promises";
import { suiteInput } from "../src/shared/contracts";
async function publish() {
  const [file, projectId, idempotencyKey] = process.argv.slice(2);
  const endpoint = process.env.TESTHUB_URL;
  const token = process.env.TESTHUB_API_KEY;
  if (!file || !projectId || !idempotencyKey || !endpoint || !token)
    throw new Error(
      "Uso: TESTHUB_URL=https://host TESTHUB_API_KEY=… npm run publish:suite -- suite.json PROJECT_ID IDEMPOTENCY_KEY",
    );
  const url = new URL(
    `/api/v1/projects/${encodeURIComponent(projectId)}/suites`,
    endpoint,
  );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("A publicação remota exige HTTPS.");
  const payload = suiteInput.parse(JSON.parse(await readFile(file, "utf8")));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `Publicação falhou (${response.status}): ${result.error || "dados inválidos"}`,
    );
  console.log(
    JSON.stringify(
      {
        id: result.id,
        title: result.title,
        status: result.status,
        url: `${url.origin}/tabs/home/#project=${projectId}&suite=${result.id}`,
      },
      null,
      2,
    ),
  );
}
void publish().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
