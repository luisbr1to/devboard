// Test-only entry point: never included by the production Vite build.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { SuiteList } from "../../src/Tab/SuiteList";
import { SuiteDetail } from "../../src/Tab/SuiteDetail";
import { IssueList } from "../../src/Tab/IssueList";
import { Modal, OverflowActions } from "../../src/Tab/components";
import { ArchiveBoxIcon } from "@heroicons/react/24/outline";
import { setSession } from "../../src/Tab/api";
import { fluentThemes, type ThemeName } from "../../src/Tab/theme";
import { project, members, fixtures } from "./fixtures";
import "../../src/Tab/App.css";
setSession({
  async getToken() {
    return "browser-fixture-only";
  },
});
const params = new URLSearchParams(location.search);
const theme: ThemeName =
  params.get("theme") === "dark"
    ? "dark"
    : params.get("theme") === "contrast"
      ? "contrast"
      : "light";
document.documentElement.dataset.theme = theme;
function Harness() {
  const [revision, setRevision] = useState(0);
  const [suiteId, setSuiteId] = useState(
    params.get("screen") === "detail" ? fixtures()[0].id : "",
  );
  const selectedProject = {
    ...project,
    role:
      params.get("role") === "member"
        ? ("member" as const)
        : ("owner" as const),
  };
  return (
    <FluentProvider theme={fluentThemes[theme]} className="app-root">
      <main className="main-content content" style={{ height: "100%" }}>
        {params.get("screen") === "issues" ? (
          <IssueList
            project={selectedProject}
            members={members}
            revision={revision}
            refresh={() => setRevision((value) => value + 1)}
            userId={members[0].id}
            onIssueChange={() => {}}
          />
        ) : params.get("screen") === "dialog-menu" ? (
          <Modal title="Drawer com ações" onClose={() => {}}>
            <OverflowActions
              label="Ações do drawer"
              actions={[
                {
                  label: "Arquivar",
                  icon: <ArchiveBoxIcon />,
                  onClick() {},
                },
              ]}
            />
          </Modal>
        ) : suiteId ? (
          <SuiteDetail
            project={selectedProject}
            suiteId={suiteId}
            members={members}
            revision={revision}
            refresh={() => setRevision((value) => value + 1)}
            navigate={(id) => setSuiteId(id || "")}
          />
        ) : (
          <SuiteList
            project={selectedProject}
            members={members}
            revision={revision}
            refresh={() => setRevision((value) => value + 1)}
            openSuite={setSuiteId}
          />
        )}
      </main>
    </FluentProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
