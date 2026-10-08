import * as teams from "@microsoft/teams-js";
import { clientConfig, msalClient } from "./auth";

// Teams authentication window. MSAL's bridge returns a cached redirect response to this page.
async function authenticate() {
  const config = await clientConfig();
  const msal = msalClient(config);
  await msal.initialize();
  const result = await msal.handleRedirectPromise();
  try {
    await teams.app.initialize();
  } catch {
    document.getElementById("auth-message")!.textContent =
      "Pode fechar esta janela e voltar ao DevBoard.";
    return;
  }
  if (result?.accessToken) {
    teams.authentication.notifySuccess(result.accessToken);
    return;
  }
  await msal.loginRedirect({
    scopes: [config.scope],
    redirectUri: `${location.origin}/tabs/home/auth.html`,
  });
}
void authenticate().catch((error) => {
  document.getElementById("auth-message")!.textContent =
    error instanceof Error ? error.message : "Falha na autenticação.";
  teams.authentication.notifyFailure("Não foi possível iniciar sessão.");
});
