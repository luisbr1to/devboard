/** A top-level list or checklist item of a note, offered as an issue draft. */
export interface NoteItem {
  title: string;
  /** Its nested lines (sub-items, details), as Markdown. */
  description: string;
  /** Normalized item text, to recognize items already drafted. */
  sourceText: string;
  done: boolean;
}

const listItem = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const inline = (text: string) =>
  text
    .replace(/\[@\s+[^\]]*?label="([^"]*)"[^\]]*\]/g, "@$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2")
    .replace(/(\S)[*_](?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
export const sourceKey = (text: string) =>
  inline(text).toLocaleLowerCase("pt-PT").slice(0, 2000);

/** Each list's top-level items; deeper lines become the item's description. */
export function noteItems(markdown: string): NoteItem[] {
  const items: NoteItem[] = [];
  let current: { indent: number; text: string; done: boolean; body: string[] };
  let open = false;
  const flush = () => {
    if (!open) return;
    open = false;
    const body = current.body.filter((line, index, lines) =>
      line.trim() ? true : index > 0 && index < lines.length - 1,
    );
    const margin = Math.min(
      ...body.filter((line) => line.trim()).map((line) => line.search(/\S/)),
    );
    const title = inline(current.text).slice(0, 200);
    if (!title) return;
    items.push({
      title,
      description: body
        .map((line) => line.slice(Number.isFinite(margin) ? margin : 0))
        .join("\n")
        .trim(),
      sourceText: sourceKey(current.text),
      done: current.done,
    });
  };
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(listItem);
    const indent = line.search(/\S/);
    if (match && (!open || match[1].length <= current!.indent)) {
      flush();
      current = {
        indent: match[1].length,
        text: match[3],
        done: /x/i.test(match[2] || ""),
        body: [],
      };
      open = true;
    } else if (open && (!line.trim() || indent > current!.indent))
      current!.body.push(line);
    else flush();
  }
  flush();
  return items;
}
