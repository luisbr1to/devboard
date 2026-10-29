// Hash routes: #project=…&suite=…&test=…&activity=…&view=settings|dev&issue=…, or #view=admin,
// or the personal #view=notes&note=… and #view=drafts&draft=… (keeping the current project, if any).
export type Section = "suites" | "dev" | "settings" | "admin" | Personal;
export type Personal = "notes" | "drafts";
const sections: Section[] = ["settings", "dev", "admin", "notes", "drafts"];
/** Application administration, outside any project. */
export const adminHash = "#view=admin";
/** Personal notes and drafts; the project only keeps the sidebar where it was. */
export function personalHash(view: Personal, projectId = "", id = "") {
  const params = new URLSearchParams({ view });
  if (projectId) params.set("project", projectId);
  if (id) params.set(view === "notes" ? "note" : "draft", id);
  return `#${params}`;
}
export interface Anchor {
  test?: string | null;
  issue?: string | null;
  activity?: string | null;
}
export function readRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  const view = params.get("view");
  return {
    projectId: params.get("project") || "",
    suiteId: params.get("suite") || "",
    testId: params.get("test") || "",
    issueId: params.get("issue") || "",
    activityId: params.get("activity") || "",
    noteId: params.get("note") || "",
    draftId: params.get("draft") || "",
    section: (sections.includes(view as Section) ? view : "suites") as Section,
  };
}
export function routeHash(
  projectId: string,
  suiteId = "",
  section: Section = "suites",
  anchor: Anchor = {},
) {
  const params = new URLSearchParams({ project: projectId });
  if (section === "dev") {
    params.set("view", "dev");
    if (anchor.issue) params.set("issue", anchor.issue);
    if (anchor.issue && anchor.activity)
      params.set("activity", anchor.activity);
    return `#${params}`;
  }
  if (suiteId) params.set("suite", suiteId);
  if (suiteId && anchor.test) params.set("test", anchor.test);
  if (suiteId && anchor.activity) params.set("activity", anchor.activity);
  if (section === "settings") params.set("view", "settings");
  return `#${params}`;
}
export function route(
  projectId: string,
  suiteId = "",
  section: Section = "suites",
  anchor: Anchor = {},
) {
  location.hash = routeHash(projectId, suiteId, section, anchor).slice(1);
}
