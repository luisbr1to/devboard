import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import type { SearchResults } from "../shared/contracts";
import { api } from "./api";
import { suggestionPopup, type ListHandle } from "./mentions";
import { issueKey, testKey } from "./presentation";
import { routeHash } from "./routes";

/** An issue or test, inserted as a plain Markdown link to its page. */
export interface Reference {
  id: string;
  key: string;
  title: string;
  projectName: string;
  href: string;
}
async function findReferences(query: string): Promise<Reference[]> {
  const text = query.trim();
  if (text.length < 2 && !/^\d$/.test(text)) return [];
  try {
    const results = await api<SearchResults>(
      `/search?q=${encodeURIComponent(text)}`,
    );
    return [
      ...results.issues.map((issue) => ({
        id: issue.id,
        key: issueKey(issue.number),
        title: issue.title,
        projectName: issue.projectName,
        href: routeHash(issue.projectId, "", "dev", { issue: issue.id }),
      })),
      ...results.tests.map((test) => ({
        id: test.id,
        key: testKey(test.number),
        title: test.title,
        projectName: test.projectName,
        href: routeHash(test.projectId, test.suiteId, "suites", {
          test: test.id,
        }),
      })),
    ].slice(0, 8);
  } catch {
    return [];
  }
}

const ReferenceList = forwardRef<ListHandle, SuggestionProps<Reference>>(
  function ReferenceList({ items, command, query }, ref) {
    const [active, setActive] = useState(0);
    useEffect(() => setActive(0), [items]);
    const pick = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };
    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (!items.length) return false;
        if (event.key === "ArrowDown") {
          setActive((index) => (index + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setActive((index) => (index - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          pick(active);
          return true;
        }
        return false;
      },
    }));
    return (
      <div
        className="mention-list"
        role="listbox"
        aria-label="Referenciar issue ou teste"
      >
        {items.length ? (
          items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className="mention-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(index)}
            >
              <span className="mono reference-key">{item.key}</span>
              <span>
                {item.title}
                <small>{item.projectName}</small>
              </span>
            </button>
          ))
        ) : (
          <p className="muted">
            {query.trim()
              ? "Nenhum issue ou teste encontrado."
              : "Escreva para procurar issues e testes."}
          </p>
        )}
      </div>
    );
  },
);

/** Links to app pages (#project=…) open in place instead of a new tab. */
export const ReferenceLinks = Extension.create({
  name: "referenceLinks",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("referenceLinks"),
        props: {
          handleClick(_view, _pos, event) {
            const link = (event.target as HTMLElement).closest?.("a");
            const href = link?.getAttribute("href");
            if (!href?.startsWith("#")) return false;
            event.preventDefault();
            location.hash = href.slice(1);
            return true;
          },
        },
      }),
    ];
  },
});

/** "#" opens a search for issues and tests (not at the start of a line, where it makes a heading). */
export const referenceEditor = Extension.create({
  name: "references",
  addProseMirrorPlugins() {
    return [
      Suggestion<Reference>({
        pluginKey: new PluginKey("references"),
        editor: this.editor,
        char: "#",
        debounce: 200,
        allow: ({ state, range }) =>
          range.from > state.doc.resolve(range.from).start(),
        items: ({ query }) => findReferences(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: "text",
                text: `${props.key} · ${props.title}`,
                marks: [{ type: "link", attrs: { href: props.href } }],
              },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: () => suggestionPopup(ReferenceList),
      }),
    ];
  },
});
