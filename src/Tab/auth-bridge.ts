import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
void broadcastResponseToMainFrame().catch(() => {
  document.getElementById("auth-message")!.textContent =
    "Volte ao DevBoard para iniciar sessão.";
});
