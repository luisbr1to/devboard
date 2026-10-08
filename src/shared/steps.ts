// Splits Markdown instructions into the text before the first list, the list items (steps)
// and the rest. Used when a test is published without explicit steps; migration
// 005_test_steps.sql applies the same rules to tests that existed before steps were stored.
export interface ParsedInstructions {
  before: string;
  steps: string[];
  after: string;
}
const listItem = /^( *)(?:\d{1,3}[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const stepsHeading =
  /^#{1,6}\s+(?:passos|instruções|instrucoes|steps)\s*:?\s*$/i;
/** Splits instructions into the text before the first list, the list items (steps) and the rest. */
export function parseSteps(markdown: string): ParsedInstructions {
  const lines = markdown.split(/\r?\n/);
  const steps: string[] = [];
  let fenced = false;
  let start = -1;
  let end = lines.length;
  let indent = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s*(```|~~~)/.test(line);
    if (start < 0) {
      if (fence) fenced = !fenced;
      const match = !fenced && line.match(listItem);
      if (match && match[1].length <= 3) {
        start = index;
        indent = match[1].length;
        steps.push(match[2]);
      }
      continue;
    }
    const match = line.match(listItem);
    const lineIndent = line.length - line.trimStart().length;
    if (!line.trim()) {
      const next = lines.slice(index + 1).find((candidate) => candidate.trim());
      const nextIndent = next ? next.length - next.trimStart().length : 0;
      if (next && (nextIndent > indent || next.match(listItem))) {
        steps[steps.length - 1] += "\n";
        continue;
      }
      end = index;
      break;
    }
    if (match && lineIndent <= indent) steps.push(match[2]);
    else if (lineIndent > indent)
      steps[steps.length - 1] +=
        `\n${line.slice(Math.min(lineIndent, indent + 3))}`;
    else {
      end = index;
      break;
    }
  }
  if (start < 0) return { before: markdown, steps: [], after: "" };
  const before = lines.slice(0, start);
  while (before.length && !before[before.length - 1].trim()) before.pop();
  if (before.length && stepsHeading.test(before[before.length - 1].trim()))
    before.pop();
  return {
    before: before.join("\n").trim(),
    steps: steps.map((step) => step.trim()),
    after: lines.slice(end).join("\n").trim(),
  };
}
