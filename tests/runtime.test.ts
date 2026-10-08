import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
test(
  "compiled server serves the tab, auth bridge and protected API without configuration",
  { skip: !existsSync("dist/index.js") },
  async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const child = spawn(process.execPath, ["dist/index.js"], {
      env: {
        ...process.env,
        PORT: String(port),
        DOTENV_CONFIG_PATH: "/tmp/testhub-no-env",
        ENTRA_TENANT_ID: "",
        ENTRA_CLIENT_ID: "",
        ENTRA_RESOURCE_URI: "",
        ENTRA_CLIENT_SECRET: "",
        SSL_CRT_FILE: "",
        SSL_KEY_FILE: "",
        DATABASE_URL: "postgresql://testhub:test@127.0.0.1:1/testhub",
        CLIENT_ID: "",
        CLIENT_SECRET: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(
          () => reject(new Error(`Server startup timed out: ${output}`)),
          10000,
        );
        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          if (output.includes("listening on port")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.stderr.on("data", (chunk) => {
          output += chunk.toString();
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Server exited (${code}): ${output}`));
        });
      });
      const origin = `http://127.0.0.1:${port}`;
      const root = await fetch(origin, { redirect: "manual" });
      assert.equal(root.status, 302);
      assert.equal(root.headers.get("location"), "/tabs/home/");
      const page = await fetch(`${origin}/tabs/home/`);
      const html = await page.text();
      assert.equal(page.status, 200, `Tab response: ${html}`);
      assert.match(html, /lang="pt-PT"/);
      assert.match(
        page.headers.get("content-security-policy") || "",
        /frame-ancestors/,
      );
      assert.equal((await fetch(`${origin}/tabs/home/auth.html`)).status, 200);
      assert.equal(
        (await fetch(`${origin}/tabs/home/teams-auth.html`)).status,
        200,
      );
      assert.equal(
        (await (await fetch(`${origin}/api/v1/config`)).json()).configured,
        false,
      );
      assert.equal((await fetch(`${origin}/api/v1/projects`)).status, 401);
      assert.equal((await fetch(`${origin}/health`)).status, 503);
    } finally {
      child.kill("SIGTERM");
      if (child.exitCode === null)
        await new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
    }
  },
);

test(
  "compiled server refuses local authentication in production",
  { skip: !existsSync("dist/index.js") },
  async () => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: "/tmp/testhub-no-env",
        NODE_ENV: "production",
        AUTH_MODE: "local",
        SSL_CRT_FILE: "",
        SSL_KEY_FILE: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    assert.notEqual(code, 0);
    assert.match(output, /AUTH_MODE=local não pode ser usado/);
  },
);
