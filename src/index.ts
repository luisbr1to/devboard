import fs from "fs";
import https from "https";
import path from "path";

import { App, ExpressAdapter } from "@microsoft/teams.apps";
import { ConsoleLogger } from "@microsoft/teams.common/logging";
import "dotenv/config";
import { createDatabase } from "./server/db";
import { createApi } from "./server/api";
import { createAuthentication } from "./server/auth";

const sslOptions = {
  key: process.env.SSL_KEY_FILE
    ? fs.readFileSync(process.env.SSL_KEY_FILE)
    : undefined,
  cert: process.env.SSL_CRT_FILE
    ? fs.readFileSync(process.env.SSL_CRT_FILE)
    : undefined,
};

// Workaround for SDK bug in v2.0.6+: ExpressAdapter uses `instanceof http.Server`
// which fails for https.Server (extends tls.Server, not http.Server).
// Fix: create the adapter, then replace its internal http.Server with our https.Server.
class TabAdapter extends ExpressAdapter {
  get application() {
    return this.express;
  }
}
const adapter = new TabAdapter();
const db = createDatabase();
adapter.application.disable("x-powered-by");
adapter.get("/", (_req, res) => res.redirect("/tabs/home/"));
adapter.get("/health", async (_req, res) => {
  try {
    await db.query("SELECT 1 FROM schema_migrations LIMIT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});
adapter.use("/api/v1", createApi(db, createAuthentication()));
adapter.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://login.microsoftonline.com https://*.msauth.net https://*.msftauth.net; frame-src 'self' https://login.microsoftonline.com https://*.msauth.net https://*.msftauth.net; img-src 'self' data: blob: https:; font-src 'self' data:; frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft https://*.office.com https://*.microsoft365.com; base-uri 'self'; object-src 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
if (sslOptions.cert && sslOptions.key) {
  const httpsServer = https.createServer(sslOptions, (adapter as any).express);
  (adapter as any).server = httpsServer;
}

const app = new App({
  logger: new ConsoleLogger("tab", { level: "debug" }),
  httpServerAdapter: adapter,
});

app.tab("home", path.join(__dirname, "./client"));

(async () => {
  await app.start(process.env.PORT || 3978);
})().catch((error) => {
  console.error("Falha ao iniciar DevBoard:", error.message);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.stop();
    await db.end();
  });
