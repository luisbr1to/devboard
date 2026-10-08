// Teams activity feed notifications (Microsoft Graph). Built from the in-app notifications
// after the transaction commits; delivery is best effort and never affects the request.
import type { NotificationKind } from "../shared/contracts";

export interface FeedItem {
  kind: NotificationKind;
  recipientOids: string[];
  projectId: string;
  projectName: string;
  suiteId: string | null;
  suiteNumber: number | null;
  suiteTitle: string | null;
  suiteDeleted: boolean;
  testId: string | null;
  testNumber: number | null;
  testTitle: string | null;
  testDeleted: boolean;
  issueId: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  issueDeleted: boolean;
  activityId: string | null;
  detail: Record<string, unknown>;
}
export interface ActivityPayload {
  topic: { source: "text"; value: string; webUrl: string };
  activityType: string;
  previewText: { content: string };
  templateParameters: { name: string; value: string }[];
  recipients: {
    "@odata.type": "microsoft.graph.aadUserNotificationRecipient";
    userId: string;
  }[];
}

/** Must match `activities.activityTypes` in appPackage/manifest.json. */
export const activityTypes = {
  testResult: "{actor} marcou {test} como {status}",
  comment: "{actor} comentou em {item}",
  mention: "{actor} fez-lhe uma menção em {item}",
  assignment: "{actor} atribuiu-lhe {test}",
  suiteCreated: "{actor} criou a suite {suite}",
  testAdded: "{actor} adicionou {test} a {suite}",
  suiteChanged: "{actor} {action} a suite {suite}",
  testChanged: "{actor} {action} {test}",
  issueAssigned: "{actor} atribuiu-lhe {issue}",
  issueChanged: "{actor} {action} {issue}",
} as const;

const statusText: Record<string, string> = {
  approved: "Aprovado",
  revoked: "Rejeitado",
  pending: "Pendente",
};
const suiteKey = (number: number | null) =>
  number ? `SU-${String(number).padStart(2, "0")}` : "suite";
const testKey = (number: number | null) => (number ? `TC-${number}` : "teste");
const issueKey = (number: number | null) => (number ? `IS-${number}` : "issue");

/** Same hash route the web app understands (see src/Tab/routes.ts). */
export function subEntityId(item: FeedItem) {
  const params = new URLSearchParams({ project: item.projectId });
  if (item.issueId) {
    params.set("view", "dev");
    if (!item.issueDeleted) {
      params.set("issue", item.issueId);
      if (item.activityId) params.set("activity", item.activityId);
    }
  } else if (item.suiteId && !item.suiteDeleted) {
    params.set("suite", item.suiteId);
    if (item.testId && !item.testDeleted) params.set("test", item.testId);
    if (item.activityId) params.set("activity", item.activityId);
  }
  return params.toString();
}
export function deepLink(teamsAppId: string, item: FeedItem) {
  const context = JSON.stringify({ subEntityId: subEntityId(item) });
  return `https://teams.microsoft.com/l/entity/${encodeURIComponent(teamsAppId)}/index0?context=${encodeURIComponent(context)}`;
}

/** One Graph request per 100 recipients. */
export function activityPayloads(
  teamsAppId: string,
  item: FeedItem,
): ActivityPayload[] {
  const test = testKey(item.testNumber);
  const suite = suiteKey(item.suiteNumber);
  const issue = issueKey(item.issueNumber);
  const where = item.testId ? test : `a suite ${suite}`;
  const [activityType, parameters]: [string, Record<string, string>] = (() => {
    switch (item.kind) {
      case "result":
        return [
          "testResult",
          {
            test,
            status: statusText[String(item.detail.status)] || "atualizado",
          },
        ];
      case "comment":
        return ["comment", { item: where }];
      case "mention":
        return ["mention", { item: where }];
      case "assignment":
        return ["assignment", { test }];
      case "suite_created":
        return ["suiteCreated", { suite }];
      case "test_added":
        return ["testAdded", { test, suite }];
      case "suite_edited":
        return ["suiteChanged", { action: "editou", suite }];
      case "suite_archived":
        return ["suiteChanged", { action: "arquivou", suite }];
      case "suite_restored":
        return ["suiteChanged", { action: "restaurou", suite }];
      case "suite_deleted":
        return ["suiteChanged", { action: "apagou", suite }];
      case "test_edited":
        return ["testChanged", { action: "alterou", test }];
      case "test_deleted":
        return ["testChanged", { action: "apagou", test }];
      case "issue_comment":
        return ["comment", { item: issue }];
      case "issue_mention":
        return ["mention", { item: issue }];
      case "issue_assignment":
        return ["issueAssigned", { issue }];
      case "issue_status":
        return [
          "issueChanged",
          {
            action: `mudou para ${String(item.detail.status || "outro estado")}`,
            issue,
          },
        ];
      case "issue_deleted":
        return ["issueChanged", { action: "apagou", issue }];
    }
  })();
  const excerpt =
    typeof item.detail.excerpt === "string" ? item.detail.excerpt : "";
  const preview = (
    excerpt ||
    item.issueTitle ||
    item.testTitle ||
    (typeof item.detail.title === "string" ? item.detail.title : "") ||
    item.suiteTitle ||
    item.projectName
  ).slice(0, 150);
  const topic = {
    source: "text" as const,
    value: (item.issueNumber
      ? `${issue} · ${item.issueTitle || ""}`
      : item.suiteNumber
        ? `${suite} · ${item.suiteTitle || ""}`
        : item.projectName
    ).slice(0, 200),
    webUrl: deepLink(teamsAppId, item),
  };
  const payloads: ActivityPayload[] = [];
  for (let start = 0; start < item.recipientOids.length; start += 100)
    payloads.push({
      topic,
      activityType,
      previewText: { content: preview },
      templateParameters: Object.entries(parameters).map(([name, value]) => ({
        name,
        value,
      })),
      recipients: item.recipientOids
        .slice(start, start + 100)
        .map((userId) => ({
          "@odata.type": "microsoft.graph.aadUserNotificationRecipient",
          userId,
        })),
    });
  return payloads;
}
