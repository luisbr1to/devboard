import * as teams from "@microsoft/teams-js";
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";

export interface ClientConfig {
  mode: "microsoft" | "local";
  tenantId: string;
  clientId: string;
  resourceUri: string;
  scope: string;
  configured: boolean;
  localUsers?: Array<{ oid: string; name: string; email: string }>;
}
export interface Session {
  getToken(): Promise<string>;
  signOut?(): Promise<void>;
}
const localTokenKey = "testhub.local-session";
export async function clientConfig(): Promise<ClientConfig> {
  const response = await fetch("/api/v1/config");
  if (!response.ok)
    throw new Error("Não foi possível obter a configuração do DevBoard.");
  return response.json();
}
export function msalClient(config: ClientConfig) {
  return new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: `${location.origin}/tabs/home/auth.html`,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
}
export async function initializeHost(onTheme: (theme: string) => void) {
  try {
    await Promise.race([
      teams.app.initialize(),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("browser")), 4000),
      ),
    ]);
    const context = await teams.app.getContext();
    // Opened from an activity feed notification: subPageId carries the app route
    // (project=…&suite=…&test=…&activity=…); only accept that shape.
    const anchor = context.page.subPageId;
    if (anchor && /^project=[\da-f-]{36}(&[a-z]+=[\w-]+)*$/i.test(anchor))
      location.hash = anchor;
    onTheme(context.app.theme || "default");
    teams.app.registerOnThemeChangeHandler(onTheme);
    return true;
  } catch {
    return false;
  }
}
export async function signIn(
  config: ClientConfig,
  inTeams: boolean,
  interactive = false,
): Promise<Session | null> {
  if (config.mode === "local") {
    const token = sessionStorage.getItem(localTokenKey);
    if (!token) return null;
    const response = await fetch("/api/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      sessionStorage.removeItem(localTokenKey);
      return null;
    }
    return localSession(token);
  }
  if (inTeams) {
    let fallbackToken: string | undefined;
    try {
      await teams.authentication.getAuthToken();
    } catch {
      if (!interactive) return null;
      fallbackToken = await teams.authentication.authenticate({
        url: `${location.origin}/tabs/home/teams-auth.html`,
        width: 600,
        height: 600,
      });
    }
    return {
      async getToken() {
        try {
          return await teams.authentication.getAuthToken();
        } catch {
          if (fallbackToken) return fallbackToken;
          throw new Error("Inicie sessão novamente para continuar.");
        }
      },
    };
  }
  const msal = msalClient(config);
  await msal.initialize();
  let account = msal.getAllAccounts()[0];
  if (interactive) {
    account = (
      await msal.acquireTokenPopup({
        scopes: [config.scope],
        account,
        redirectUri: `${location.origin}/tabs/home/auth.html`,
      })
    ).account!;
  } else if (!account) return null;
  return {
    async getToken() {
      try {
        return (
          await msal.acquireTokenSilent({ scopes: [config.scope], account })
        ).accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError)
          throw new Error("Inicie sessão novamente para continuar.");
        throw error;
      }
    },
  };
}

function localSession(token: string): Session {
  return {
    async getToken() {
      return token;
    },
    async signOut() {
      try {
        await fetch("/api/v1/auth/local/session", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } finally {
        sessionStorage.removeItem(localTokenKey);
      }
    },
  };
}

export async function localSignIn(oid: string): Promise<Session> {
  const response = await fetch("/api/v1/auth/local/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oid }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Não foi possível iniciar a sessão local.");
  sessionStorage.setItem(localTokenKey, result.token);
  return localSession(result.token);
}
