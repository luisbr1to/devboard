import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type RefObject,
} from "react";
import { ReactRenderer } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import { initials } from "./presentation";

export interface Mentionable {
  id: string;
  name: string;
  email?: string;
}
/** Mentions are stored in Markdown as [@ id="…" label="…"]. */
export const mentionIds = (markdown: string) => [
  ...new Set(
    [...markdown.matchAll(/\[@\s+[^\]]*?id="([0-9a-f-]{36})"/gi)].map(
      (match) => match[1],
    ),
  ),
];
/** Read-only rendering of stored mentions. */
export const MentionView = Mention.configure({
  HTMLAttributes: { class: "mention" },
});

interface ListHandle {
  onKeyDown(props: SuggestionKeyDownProps): boolean;
}
const MentionList = forwardRef<ListHandle, SuggestionProps<Mentionable>>(
  function MentionList({ items, command }, ref) {
    const [active, setActive] = useState(0);
    useEffect(() => setActive(0), [items]);
    const pick = (index: number) => {
      const item = items[index];
      if (item) command({ id: item.id, label: item.name });
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
        aria-label="Mencionar membro"
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
              <span className="user-avatar small" aria-hidden>
                {initials(item.name)}
              </span>
              <span>
                {item.name}
                {item.email && <small>{item.email}</small>}
              </span>
            </button>
          ))
        ) : (
          <p className="muted">Nenhum membro encontrado.</p>
        )}
      </div>
    );
  },
);

/** Editable mentions with a member picker opened by "@". */
export function mentionEditor(people: RefObject<Mentionable[]>) {
  return MentionView.configure({
    suggestion: {
      items: ({ query }) => {
        const search = query.toLocaleLowerCase("pt-PT");
        return (people.current || [])
          .filter((person) =>
            `${person.name} ${person.email || ""}`
              .toLocaleLowerCase("pt-PT")
              .includes(search),
          )
          .slice(0, 6);
      },
      render: () => {
        let renderer: ReactRenderer<ListHandle, SuggestionProps<Mentionable>>;
        const place = (props: SuggestionProps<Mentionable>) => {
          const rect = props.clientRect?.();
          const element = renderer.element as HTMLElement;
          if (!rect) return;
          const below = rect.bottom + 240 < window.innerHeight;
          Object.assign(element.style, {
            position: "fixed",
            zIndex: "10",
            left: `${Math.min(rect.left, window.innerWidth - 280)}px`,
            top: below ? `${rect.bottom + 4}px` : "",
            bottom: below ? "" : `${window.innerHeight - rect.top + 4}px`,
          });
        };
        return {
          onStart(props) {
            renderer = new ReactRenderer(MentionList, {
              props,
              editor: props.editor,
            });
            // Inside a modal dialog only its own subtree is rendered above the backdrop.
            (props.editor.view.dom.closest("dialog") || document.body).append(
              renderer.element,
            );
            place(props);
          },
          onUpdate(props) {
            renderer.updateProps(props);
            place(props);
          },
          onKeyDown(props) {
            if (props.event.key === "Escape") {
              renderer.element.remove();
              return true;
            }
            return renderer.ref?.onKeyDown(props) ?? false;
          },
          onExit() {
            renderer.element.remove();
            renderer.destroy();
          },
        };
      },
    },
  });
}
