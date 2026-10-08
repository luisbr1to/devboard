import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { randomBytes } from "node:crypto";
import type { User } from "../shared/contracts";
import type { ActivityPayload } from "./teams";
const uuidPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export interface Identity {
  oid: string;
  tenantId: string;
  name: string;
  email: string;
  token: string;
}
export interface DirectoryPerson {
  oid: string;
  name: string;
  email: string;
}
export interface Authentication {
  readonly mode: "microsoft" | "local";
  readonly directory?: readonly DirectoryPerson[];
  authenticate(token: string): Promise<Identity>;
  search(token: string, query: string): Promise<DirectoryPerson[]>;
  person(token: string, oid: string): Promise<DirectoryPerson>;
  photo?(
    token: string,
    oid: string,
  ): Promise<{ body: Buffer; type: string } | null>;
  /**
   * Sends a Teams activity feed notification. With a user token it is sent on behalf of that
   * user (delegated TeamsActivity.Send); with null, as the app (application permission).
   */
  sendActivity?(token: string | null, payload: ActivityPayload): Promise<void>;
  createSession?(oid: string): Promise<{ token: string; identity: Identity }>;
  revokeSession?(token: string): void;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function authConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    tenantId: env.ENTRA_TENANT_ID || "",
    clientId: env.ENTRA_CLIENT_ID || "",
    resourceUri: env.ENTRA_RESOURCE_URI || "",
  };
}
export async function validateToken(
  token: string,
  config: ReturnType<typeof authConfig>,
  key: JWTVerifyGetKey,
): Promise<Identity> {
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["RS256"],
    issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    audience: config.clientId,
    requiredClaims: ["exp", "iat", "oid", "tid", "scp"],
  });
  if (
    payload.tid !== config.tenantId ||
    typeof payload.oid !== "string" ||
    !uuidPattern.test(payload.oid) ||
    typeof payload.scp !== "string" ||
    !payload.scp.split(" ").includes("access_as_user")
  )
    throw new HttpError(401, "Token sem autorização para o DevBoard.");
  return {
    oid: payload.oid,
    tenantId: config.tenantId,
    name:
      typeof payload.name === "string"
        ? payload.name
        : "Utilizador Microsoft 365",
    email:
      typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : "",
    token,
  };
}
export function microsoftAuthentication(
  env: NodeJS.ProcessEnv = process.env,
): Authentication {
  const config = authConfig(env);
  const validConfig =
    uuidPattern.test(config.tenantId) &&
    uuidPattern.test(config.clientId) &&
    !!config.resourceUri;
  const key = validConfig
    ? createRemoteJWKSet(
        new URL(
          `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
        ),
      )
    : null;
  const msal =
    validConfig && env.ENTRA_CLIENT_SECRET
      ? new ConfidentialClientApplication({
          auth: {
            clientId: config.clientId,
            authority: `https://login.microsoftonline.com/${config.tenantId}`,
            clientSecret: env.ENTRA_CLIENT_SECRET,
          },
        })
      : null;
  async function graphResponse(token: string, path: string) {
    if (!msal)
      throw new HttpError(
        503,
        "A pesquisa de membros requer ENTRA_CLIENT_SECRET e consentimento do Microsoft Graph.",
      );
    let accessToken: string | undefined;
    try {
      accessToken = (
        await msal.acquireTokenOnBehalfOf({
          oboAssertion: token,
          scopes: ["https://graph.microsoft.com/.default"],
        })
      )?.accessToken;
    } catch {
      throw new HttpError(
        403,
        "Não foi possível consultar o diretório. Peça ao administrador consentimento para User.ReadBasic.All ou a um proprietário interno para adicionar membros.",
      );
    }
    if (!accessToken)
      throw new HttpError(403, "Sem autorização para consultar o diretório.");
    const response = await fetch(`https://graph.microsoft.com/v1.0/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new HttpError(
        response.status === 404 ? 404 : 403,
        "Diretório indisponível ou sem permissão. Os convidados podem continuar a colaborar nos projetos existentes.",
      );
    return response;
  }
  async function graph(token: string, path: string) {
    return (await graphResponse(token, path)).json();
  }
  const person = (value: Record<string, string>): DirectoryPerson => ({
    oid: value.id,
    name: value.displayName || value.mail || value.id,
    email: value.mail || value.userPrincipalName || "",
  });
  return {
    mode: "microsoft",
    async sendActivity(token, payload) {
      if (!msal) throw new Error("ENTRA_CLIENT_SECRET em falta");
      const result = token
        ? await msal.acquireTokenOnBehalfOf({
            oboAssertion: token,
            scopes: ["https://graph.microsoft.com/.default"],
          })
        : await msal.acquireTokenByClientCredential({
            scopes: ["https://graph.microsoft.com/.default"],
          });
      if (!result?.accessToken) throw new Error("sem token Graph");
      const response = await fetch(
        "https://graph.microsoft.com/v1.0/teamwork/sendActivityNotificationToRecipients",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${result.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `Graph ${response.status} ${error?.error?.code || ""}`.trim(),
        );
      }
    },
    async authenticate(token) {
      if (!key)
        throw new HttpError(
          503,
          "Configure a autenticação Microsoft Entra no servidor.",
        );
      try {
        return await validateToken(token, config, key);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          401,
          "Sessão inválida ou expirada. Inicie sessão novamente.",
        );
      }
    },
    async search(token, query) {
      const escaped = query.replace(/'/g, "''");
      const params = new URLSearchParams({
        $filter: `startswith(displayName,'${escaped}') or startswith(mail,'${escaped}') or startswith(userPrincipalName,'${escaped}')`,
        $select: "id,displayName,mail,userPrincipalName",
        $top: "20",
      });
      const data = await graph(token, `users?${params}`);
      return data.value.map(person);
    },
    async person(token, oid) {
      return person(
        await graph(
          token,
          `users/${encodeURIComponent(oid)}?$select=id,displayName,mail,userPrincipalName`,
        ),
      );
    },
    async photo(token, oid) {
      try {
        const response = await graphResponse(
          token,
          `users/${encodeURIComponent(oid)}/photos/48x48/$value`,
        );
        return {
          body: Buffer.from(await response.arrayBuffer()),
          type: response.headers.get("content-type") || "image/jpeg",
        };
      } catch (error) {
        if (error instanceof HttpError && [403, 404].includes(error.status))
          return null;
        throw error;
      }
    },
  };
}

const localTenantId = "00000000-0000-4000-8000-000000000001";
export const localDirectory: readonly DirectoryPerson[] = Object.freeze([
  Object.freeze({
    oid: "10000000-0000-4000-8000-000000000001",
    name: "Ana Silva",
    email: "ana@local.test",
  }),
  Object.freeze({
    oid: "10000000-0000-4000-8000-000000000002",
    name: "João Costa",
    email: "joao@local.test",
  }),
  Object.freeze({
    oid: "10000000-0000-4000-8000-000000000003",
    name: "Marta Santos",
    email: "marta@local.test",
  }),
  Object.freeze({
    oid: "10000000-0000-4000-8000-000000000004",
    name: "Rui Lopes",
    email: "rui@local.test",
  }),
  Object.freeze({
    oid: "10000000-0000-4000-8000-000000000005",
    name: "Inês Rocha",
    email: "ines@local.test",
  }),
  // External addresses stand in for Teams guests in local development.
  Object.freeze({
    oid: "10000000-0000-4000-8000-000000000006",
    name: "Carla Mendes",
    email: "carla.mendes@parceiro.example",
  }),
  Object.freeze({
    oid: "10000000-0000-4000-8000-000000000007",
    name: "Tomás Ferreira",
    email: "tomas@agencia.example",
  }),
]);

export function localAuthentication(): Authentication {
  const sessions = new Map<
    string,
    { identity: Omit<Identity, "token">; expiresAt: number }
  >();
  const authenticate = async (token: string): Promise<Identity> => {
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token);
      throw new HttpError(401, "Sessão local inválida ou expirada.");
    }
    return { ...session.identity, token };
  };
  return {
    mode: "local",
    directory: localDirectory,
    authenticate,
    async createSession(oid) {
      const person = localDirectory.find((candidate) => candidate.oid === oid);
      if (!person) throw new HttpError(400, "Utilizador local inválido.");
      const token = `local_${randomBytes(32).toString("base64url")}`;
      const identity = { ...person, tenantId: localTenantId };
      sessions.set(token, {
        identity,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      });
      return { token, identity: { ...identity, token } };
    },
    revokeSession(token) {
      sessions.delete(token);
    },
    async search(token, query) {
      await authenticate(token);
      const normalized = query.trim().toLocaleLowerCase("pt-PT");
      return localDirectory.filter(
        (person) =>
          person.name.toLocaleLowerCase("pt-PT").includes(normalized) ||
          person.email.toLocaleLowerCase("pt-PT").includes(normalized),
      );
    },
    async person(token, oid) {
      await authenticate(token);
      const person = localDirectory.find((candidate) => candidate.oid === oid);
      if (!person) throw new HttpError(404, "Utilizador local inexistente.");
      return person;
    },
  };
}

export function createAuthentication(
  env: NodeJS.ProcessEnv = process.env,
): Authentication {
  const mode = env.AUTH_MODE || "microsoft";
  if (mode === "local") {
    if (env.NODE_ENV === "production")
      throw new Error(
        "AUTH_MODE=local não pode ser usado com NODE_ENV=production.",
      );
    return localAuthentication();
  }
  if (mode !== "microsoft")
    throw new Error("AUTH_MODE deve ser 'microsoft' ou 'local'.");
  return microsoftAuthentication(env);
}
export type Actor =
  | {
      type: "user";
      user: User;
      identity: Identity;
      /** Application administrator: acts as an owner in every project. */
      admin: boolean;
      master: boolean;
    }
  | { type: "integration"; id: string; projectId: string; name: string };
