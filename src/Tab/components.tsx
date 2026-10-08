import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
} from "@fluentui/react-components";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Markdown as MarkdownExtension } from "@tiptap/markdown";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowsUpDownIcon,
  Bars3BottomLeftIcon,
  BoldIcon,
  CheckCircleIcon,
  CodeBracketIcon,
  CodeBracketSquareIcon,
  H1Icon,
  H2Icon,
  H3Icon,
  EllipsisHorizontalIcon,
  ItalicIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  NumberedListIcon,
  PaperClipIcon,
  PlusIcon,
  StrikethroughIcon,
  TableCellsIcon,
  UnderlineIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  CheckIcon as CheckSolidIcon,
  ClockIcon as ClockSolidIcon,
  XMarkIcon as XMarkSolidIcon,
} from "@heroicons/react/16/solid";
import type { Activity, Member, Status } from "../shared/contracts";
import { apiBlob } from "./api";
import { AttachmentList, attachmentAccept } from "./attachments";
import { MentionView, mentionEditor, type Mentionable } from "./mentions";
import {
  date,
  initials,
  statusCounts,
  type DisplayStatus,
} from "./presentation";

export { date } from "./presentation";

const editorExtensions = [
  StarterKit,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem.configure({ nested: true }),
  MarkdownExtension.configure({ markedOptions: { gfm: true } }),
];
const viewerExtensions = [...editorExtensions, MentionView];

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dashed";
  size?: "md" | "sm";
  icon?: ReactNode;
  /** Keeps the button focusable while an action runs (avoids losing focus). */
  disabledFocusable?: boolean;
};
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  disabledFocusable = false,
  className = "",
  type = "button",
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`.trim()}
      aria-disabled={disabledFocusable || undefined}
      onClick={(event) => {
        if (disabledFocusable) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {icon && (
        <span className="btn-icon" aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
/** Icon-only button: the label is mandatory and becomes the accessible name and tooltip. */
export function IconButton({
  label,
  icon,
  className = "",
  ...rest
}: Omit<ButtonProps, "children" | "aria-label"> & {
  label: string;
  icon: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      {...rest}
      className={`btn-icon-only ${className}`.trim()}
      aria-label={label}
      title={label}
      icon={icon}
    />
  );
}

const statusText: Record<DisplayStatus, [test: string, suite: string]> = {
  approved: ["Aprovado", "Aprovada"],
  revoked: ["Rejeitado", "Rejeitada"],
  pending: ["Pendente", "Pendente"],
  running: ["Em curso", "Em curso"],
  notStarted: ["Por iniciar", "Por iniciar"],
};
export const statusLabel = (status: DisplayStatus, suite = false) =>
  statusText[status][suite ? 1 : 0];
function PendingIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="2.4 2.1"
      />
    </svg>
  );
}
export function StatusIcon({ status }: { status: DisplayStatus }) {
  switch (status) {
    case "approved":
      return <CheckSolidIcon aria-hidden />;
    case "revoked":
      return <XMarkSolidIcon aria-hidden />;
    case "running":
      return <ClockSolidIcon aria-hidden />;
    default:
      return <PendingIcon />;
  }
}
/** Fixed meaning per state, always icon + text. */
export function StatusBadge({
  status,
  suite = false,
}: {
  status: DisplayStatus;
  suite?: boolean;
}) {
  return (
    <span className={`status-badge status-${status}`}>
      <StatusIcon status={status} />
      {statusLabel(status, suite)}
    </span>
  );
}

export function ProgressBar({
  counts,
  total,
  size = "sm",
  showCount = true,
}: {
  counts: Record<Status, number>;
  total: number;
  size?: "sm" | "lg";
  showCount?: boolean;
}) {
  const value = statusCounts(counts);
  const percent = (count: number) => (total ? (count / total) * 100 : 0);
  const done = total ? Math.round((value.executed / total) * 100) : 0;
  const summary = `${value.executed} de ${total} executados: ${value.approved} aprovados, ${value.revoked} rejeitados e ${value.pending} pendentes`;
  return (
    <div className={`progress progress-${size}`}>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={summary}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={done}
        title={summary}
      >
        {(
          [
            ["pass", value.approved],
            ["fail", value.revoked],
          ] as const
        ).map(
          ([kind, count]) =>
            count > 0 && (
              <span
                key={kind}
                className={`progress-segment progress-${kind}`}
                style={{ width: `${percent(count)}%` }}
              />
            ),
        )}
      </div>
      {showCount && (
        <span className="progress-count mono" aria-hidden>
          {value.executed}/{total} executados
        </span>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: T;
  tabs: { value: T; label: string; count?: number }[];
  onChange(value: T): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    onChange(tabs[target].value);
    list.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [target]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={list}>
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="tab-count mono">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="search-field">
      <MagnifyingGlassIcon aria-hidden />
      <span className="visually-hidden">{label}</span>
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/** Compact filter: dashed "+ Estado" when unset, solid "Estado: Aprovada" when set. */
export function FilterMenu<T extends string>({
  name,
  label,
  ariaLabel,
  value,
  options,
  onChange,
  sort = false,
}: {
  name: string;
  label: string;
  ariaLabel: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
  sort?: boolean;
}) {
  const current = options.find((option) => option.value === value);
  const unset = !sort && value === options[0]?.value;
  return (
    <Menu
      positioning="below-start"
      checkedValues={{ [name]: [value] }}
      onCheckedValueChange={(_, data) => onChange(data.checkedItems[0] as T)}
    >
      <MenuTrigger disableButtonEnhancement>
        <Button
          size="sm"
          variant={unset ? "dashed" : "secondary"}
          icon={sort ? <ArrowsUpDownIcon /> : unset ? <PlusIcon /> : undefined}
          aria-label={`${ariaLabel}: ${current?.label}`}
          className={unset || sort ? "" : "filter-active"}
        >
          {sort || unset ? (
            sort ? (
              current?.label
            ) : (
              label
            )
          ) : (
            <>
              {label}: <strong>{current?.label}</strong>
            </>
          )}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {options.map((option) => (
            <MenuItemRadio key={option.value} name={name} value={option.value}>
              {option.label}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** Filter menu that accepts several values; an empty selection means "Todos". */
export function MultiFilterMenu<T extends string>({
  name,
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  ariaLabel: string;
  value: T[];
  options: { value: T; label: string }[];
  onChange(value: T[]): void;
}) {
  const chosen = options.filter((option) => value.includes(option.value));
  const summary =
    chosen.length > 2
      ? `${chosen[0].label} +${chosen.length - 1}`
      : chosen.map((option) => option.label).join(", ");
  const unset = !chosen.length;
  return (
    <Menu
      positioning="below-start"
      checkedValues={{ [name]: chosen.map((option) => option.value) }}
      onCheckedValueChange={(_, data) =>
        onChange(
          options
            .map((option) => option.value)
            .filter((item) => data.checkedItems.includes(item)),
        )
      }
    >
      <MenuTrigger disableButtonEnhancement>
        <Button
          size="sm"
          variant={unset ? "dashed" : "secondary"}
          icon={unset ? <PlusIcon /> : undefined}
          aria-label={`${ariaLabel}: ${unset ? "Todos" : chosen.map((option) => option.label).join(", ")}`}
          className={unset ? "" : "filter-active"}
        >
          {unset ? (
            label
          ) : (
            <>
              {label}: <strong>{summary}</strong>
            </>
          )}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {options.map((option) => (
            <MenuItemCheckbox
              key={option.value}
              name={name}
              value={option.value}
            >
              {option.label}
            </MenuItemCheckbox>
          ))}
          {!unset && (
            <>
              <MenuDivider />
              <MenuItem onClick={() => onChange([])}>Limpar seleção</MenuItem>
            </>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function Markdown({ children }: { children: string }) {
  const editor = useEditor({
    extensions: viewerExtensions,
    content: children || "Sem descrição.",
    contentType: "markdown",
    editable: false,
    editorProps: { attributes: { class: "markdown" } },
  });
  useEffect(() => {
    editor?.commands.setContent(children || "Sem descrição.", {
      contentType: "markdown",
    });
  }, [children, editor]);
  return (
    <div className="tiptap-viewer">
      <EditorContent editor={editor} />
    </div>
  );
}
export function MarkdownField({
  label,
  value,
  onChange,
  focusOnMount = false,
  compact = false,
  placeholder = "",
  actions,
  mentionables,
  onFiles,
  footer,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  focusOnMount?: boolean;
  /** Minimal toolbar below the text, as in the comment box. */
  compact?: boolean;
  placeholder?: string;
  actions?: ReactNode;
  /** Enables "@" mentions of these people. */
  mentionables?: Mentionable[];
  /** Enables attaching files (button, paste and drop). */
  onFiles?(files: File[]): void;
  /** Rendered inside the field, below the text (e.g. pending attachments). */
  footer?: ReactNode;
}) {
  const people = useRef(mentionables || []);
  people.current = mentionables || [];
  const files = useRef(onFiles);
  files.current = onFiles;
  const picker = useRef<HTMLInputElement>(null);
  const withMentions = !!mentionables;
  const extensions = useMemo(
    () => [
      ...editorExtensions,
      withMentions ? mentionEditor(people) : MentionView,
      Placeholder.configure({ placeholder }),
    ],
    [placeholder, withMentions],
  );
  const take = (list?: FileList | null) => {
    const selected = [...(list || [])];
    if (!selected.length || !files.current) return false;
    files.current(selected);
    return true;
  };
  const editor = useEditor({
    extensions,
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "markdown tiptap-editor",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
      // Pasted or dropped files (e.g. screenshots) become attachments.
      handlePaste: (_view, event) => take(event.clipboardData?.files),
      handleDrop: (_view, event) => take(event.dataTransfer?.files),
    },
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
  });
  useEffect(() => {
    if (editor && editor.getMarkdown() !== value)
      editor.commands.setContent(value, { contentType: "markdown" });
  }, [editor, value]);
  useEffect(() => {
    if (editor && focusOnMount) editor.commands.focus("end");
  }, [editor, focusOnMount]);
  const tool = (
    title: string,
    icon: ReactElement,
    active: boolean,
    run: () => void,
  ) => (
    <IconButton
      key={title}
      size="sm"
      label={title}
      icon={icon}
      aria-pressed={active}
      onClick={run}
    />
  );
  const basic = [
    tool("Negrito", <BoldIcon />, !!editor?.isActive("bold"), () =>
      editor?.chain().focus().toggleBold().run(),
    ),
    tool("Itálico", <ItalicIcon />, !!editor?.isActive("italic"), () =>
      editor?.chain().focus().toggleItalic().run(),
    ),
  ];
  const attach = onFiles && (
    <>
      <IconButton
        key="attach"
        size="sm"
        label="Anexar ficheiro ou captura"
        icon={<PaperClipIcon />}
        onClick={() => picker.current?.click()}
      />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept={attachmentAccept}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
  if (compact)
    return (
      <div className="field compact-markdown-field">
        <div className="tiptap-shell compact">
          <EditorContent editor={editor} />
          {footer}
          <div
            className="tiptap-toolbar"
            role="toolbar"
            aria-label={`Formatação de ${label}`}
          >
            {basic}
            {tool(
              "Código inline",
              <CodeBracketIcon />,
              !!editor?.isActive("code"),
              () => editor?.chain().focus().toggleCode().run(),
            )}
            {tool(
              "Lista",
              <ListBulletIcon />,
              !!editor?.isActive("bulletList"),
              () => editor?.chain().focus().toggleBulletList().run(),
            )}
            {attach}
            {actions && <div className="tiptap-actions">{actions}</div>}
          </div>
        </div>
      </div>
    );
  return (
    <div className="field">
      <span>{label}</span>
      <div className="tiptap-shell">
        <div
          className="tiptap-toolbar"
          role="toolbar"
          aria-label={`Formatação de ${label}`}
        >
          {basic}
          {tool(
            "Sublinhado",
            <UnderlineIcon />,
            !!editor?.isActive("underline"),
            () => editor?.chain().focus().toggleUnderline().run(),
          )}
          {tool(
            "Rasurado",
            <StrikethroughIcon />,
            !!editor?.isActive("strike"),
            () => editor?.chain().focus().toggleStrike().run(),
          )}
          {tool(
            "Código inline",
            <CodeBracketSquareIcon />,
            !!editor?.isActive("code"),
            () => editor?.chain().focus().toggleCode().run(),
          )}
          <span className="tiptap-divider" aria-hidden />
          {tool(
            "Título 1",
            <H1Icon />,
            !!editor?.isActive("heading", { level: 1 }),
            () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
          )}
          {tool(
            "Título 2",
            <H2Icon />,
            !!editor?.isActive("heading", { level: 2 }),
            () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          )}
          {tool(
            "Título 3",
            <H3Icon />,
            !!editor?.isActive("heading", { level: 3 }),
            () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
          )}
          {tool(
            "Citação",
            <Bars3BottomLeftIcon />,
            !!editor?.isActive("blockquote"),
            () => editor?.chain().focus().toggleBlockquote().run(),
          )}
          <span className="tiptap-divider" aria-hidden />
          {tool(
            "Lista",
            <ListBulletIcon />,
            !!editor?.isActive("bulletList"),
            () => editor?.chain().focus().toggleBulletList().run(),
          )}
          {tool(
            "Lista numerada",
            <NumberedListIcon />,
            !!editor?.isActive("orderedList"),
            () => editor?.chain().focus().toggleOrderedList().run(),
          )}
          {tool(
            "Checklist",
            <CheckCircleIcon />,
            !!editor?.isActive("taskList"),
            () => editor?.chain().focus().toggleTaskList().run(),
          )}
          {tool(
            "Bloco de código",
            <CodeBracketIcon />,
            !!editor?.isActive("codeBlock"),
            () => editor?.chain().focus().toggleCodeBlock().run(),
          )}
          {tool("Separador", <MinusIcon />, false, () =>
            editor?.chain().focus().setHorizontalRule().run(),
          )}
          {tool("Inserir tabela", <TableCellsIcon />, false, () =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run(),
          )}
          <span className="tiptap-divider" aria-hidden />
          {tool("Desfazer", <ArrowUturnLeftIcon />, false, () =>
            editor?.chain().focus().undo().run(),
          )}
          {tool("Refazer", <ArrowUturnRightIcon />, false, () =>
            editor?.chain().focus().redo().run(),
          )}
          {attach && <span className="tiptap-divider" aria-hidden />}
          {attach}
        </div>
        <EditorContent editor={editor} />
        {footer}
      </div>
      <small>Conteúdo guardado em Markdown.</small>
    </div>
  );
}

export interface OverflowAction {
  label: string;
  icon: ReactElement;
  disabled?: boolean;
  onClick(): void;
}

export function OverflowActions({
  label = "Mais ações",
  actions,
}: {
  label?: string;
  actions: OverflowAction[];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Menu
      positioning="below-end"
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      // A portal on <body> sits under a modal <dialog>'s top layer, so render inside it.
      inline={!!trigger.current?.closest("dialog")}
    >
      <MenuTrigger disableButtonEnhancement>
        <IconButton
          ref={trigger}
          size="sm"
          label={label}
          icon={<EllipsisHorizontalIcon />}
          onClick={(event) => event.stopPropagation()}
        />
      </MenuTrigger>
      <MenuPopover className="overflow-menu">
        <MenuList>
          {actions.map((action) => (
            <MenuItem
              key={action.label}
              icon={action.icon}
              disabled={action.disabled}
              onClick={() => {
                // Dialogs opened from here return focus to the menu button when closed.
                trigger.current?.focus();
                action.onClick();
              }}
            >
              {action.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
export function Modal({
  title,
  children,
  onClose,
  variant = "drawer",
  toolbar,
  actions,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  variant?: "modal" | "drawer";
  /** Replaces the heading row content; the title then opens the body. */
  toolbar?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const surface = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  useEffect(() => {
    const dialog = surface.current!;
    dialog.showModal();
    (
      dialog.querySelector<HTMLElement>(
        "input:not([data-comment-input]),textarea:not([data-comment-input])",
      ) || dialog.querySelector<HTMLElement>("button:not([disabled])")
    )?.focus();
    return () => {
      dialog.close();
      window.setTimeout(() => {
        if (document.querySelector("dialog[open]")) return;
        const target = opener?.isConnected
          ? opener
          : document.querySelector<HTMLElement>("main button:not([disabled])");
        target?.focus();
      }, 0);
    };
  }, [opener]);
  return (
    <dialog
      ref={surface}
      className={`native-dialog ${variant === "drawer" ? "drawer-surface" : "modal-surface"}`}
      aria-labelledby={titleId}
      onKeyDownCapture={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]",
          ),
        ].filter(
          (control) =>
            control.tabIndex >= 0 && control.getClientRects().length > 0,
        );
        if (!controls.length) return;
        event.preventDefault();
        event.stopPropagation();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        controls[
          (current + (event.shiftKey ? -1 : 1) + controls.length) %
            controls.length
        ].focus();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = onBackdrop(event);
      }}
      onClick={(event) => {
        // Close only when the press also started on the backdrop: selecting text and
        // releasing the pointer outside the panel must not dismiss it.
        const close = pressedBackdrop.current && onBackdrop(event);
        pressedBackdrop.current = false;
        if (close) onClose();
      }}
    >
      <header className="modal-heading">
        {toolbar ? (
          <div className="modal-toolbar">{toolbar}</div>
        ) : (
          <h2 id={titleId}>{title}</h2>
        )}
        <div className="modal-heading-actions">
          {actions}
          <IconButton label="Fechar" icon={<XMarkIcon />} onClick={onClose} />
        </div>
      </header>
      <div className="modal-body">
        {toolbar && (
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
        )}
        {children}
      </div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </dialog>
  );
}

export function Avatar({
  name,
  photo,
  size = "small",
}: {
  name: string;
  photo?: string | null;
  size?: "small" | "medium";
}) {
  return (
    <span className={`user-avatar ${size}`} aria-hidden>
      {photo ? <img src={photo} alt="" /> : initials(name)}
    </span>
  );
}

const photoCache = new Map<string, string | null>();
export function UserAvatar({
  projectId,
  member,
  size = "medium",
}: {
  projectId: string;
  member?: Member;
  size?: "small" | "medium";
}) {
  const key = member ? `${projectId}:${member.id}` : "";
  const [photo, setPhoto] = useState<string | null | undefined>(() =>
    key && photoCache.has(key) ? photoCache.get(key) : undefined,
  );
  useEffect(() => {
    let live = true;
    if (!member || photoCache.has(key)) return;
    void apiBlob(`/projects/${projectId}/members/${member.id}/photo`)
      .then((blob) => {
        const url = blob ? URL.createObjectURL(blob) : null;
        photoCache.set(key, url);
        if (live) setPhoto(url);
      })
      .catch(() => {
        photoCache.set(key, null);
        if (live) setPhoto(null);
      });
    return () => {
      live = false;
    };
  }, [key, member, projectId]);
  return (
    <Avatar
      name={member?.name || "Sem responsável"}
      photo={photo}
      size={size}
    />
  );
}

export function Assignee({
  projectId,
  member,
}: {
  projectId: string;
  member?: Member;
}) {
  return (
    <span className={`assignee ${member ? "" : "unassigned"}`}>
      <UserAvatar projectId={projectId} member={member} size="small" />
      <span>{member?.name || "Sem responsável"}</span>
    </span>
  );
}
/** Up to `max` overlapping avatars, then "+N"; the full list is in the test panel. */
export function AvatarStack({
  projectId,
  people,
  members,
  max = 4,
  label = "Testers",
}: {
  projectId: string;
  people: { id: string; name: string }[];
  members: Member[];
  max?: number;
  /** Prefix of the screen-reader list of names. */
  label?: string;
}) {
  if (!people.length) return <span className="muted">—</span>;
  const names = people.map((person) => person.name).join(", ");
  return (
    <span className="avatar-stack" title={names}>
      {people.slice(0, max).map((person) => {
        const member = members.find((item) => item.id === person.id);
        return member ? (
          <UserAvatar
            key={person.id}
            projectId={projectId}
            member={member}
            size="small"
          />
        ) : (
          <Avatar key={person.id} name={person.name} />
        );
      })}
      {people.length > max && (
        <span className="user-avatar small avatar-more" aria-hidden>
          +{people.length - max}
        </span>
      )}
      <span className="visually-hidden">
        {label}: {names}
      </span>
    </span>
  );
}
export function Confirm({
  title,
  description,
  onConfirm,
  onClose,
  danger = false,
  confirmLabel = "Confirmar",
}: {
  title: string;
  description: string;
  onConfirm(): Promise<void>;
  onClose(): void;
  danger?: boolean;
  confirmLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>{description}</p>
      {error && <ErrorMessage message={error} />}
      <div className="form-actions">
        <Button disabled={busy} onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabledFocusable={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "A guardar…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="error" role="alert">
      {message}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <Spinner size="small" label="A carregar…" />
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
const eventLabels: Record<string, string> = {
  suite_created: "criou a suite",
  suite_edited: "editou a suite",
  test_created: "criou o teste",
  test_edited: "editou o teste",
  assignment_changed: "alterou o responsável",
  result_recorded: "registou um resultado",
  suite_archived: "arquivou a suite",
  suite_restored: "restaurou a suite",
  suite_deleted: "apagou a suite",
  test_deleted: "apagou o teste",
  comment: "comentou",
  issue_created: "criou o issue",
  issue_edited: "editou o issue",
  issue_assigned: "alterou os responsáveis",
  issue_status_changed: "mudou o estado",
  issue_archived: "arquivou o issue",
  issue_restored: "restaurou o issue",
  issue_deleted: "apagou o issue",
};
const stepLabels: Record<string, string> = {
  passed: "passou",
  failed: "falhou",
  pending: "por executar",
};
/**
 * Briefly highlights an activity reached from a notification or search, then fades out.
 * A new `key` (each navigation) replays it, even for the same activity.
 */
export function useFlash(
  id: string | undefined,
  ready: boolean,
  key?: unknown,
) {
  const [flash, setFlash] = useState<string>();
  useEffect(() => {
    if (!id || !ready) return;
    setFlash(id);
    document
      .querySelector(`[data-activity="${id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFlash(undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [id, ready, key]);
  return flash;
}
export function Timeline({
  items,
  testTitles,
  focusId,
  focusKey,
  describe,
}: {
  items: Activity[];
  testTitles?: Record<string, string>;
  /** Overrides the default description of an event (e.g. issue status names). */
  describe?(item: Activity): ReactNode | undefined;
  /** Activity to highlight and scroll to (link from a notification or search). */
  focusId?: string;
  focusKey?: unknown;
}) {
  const flash = useFlash(
    focusId,
    items.some((item) => item.id === focusId),
    focusKey,
  );
  return items.length ? (
    <ol className="timeline">
      {items.map((item) => {
        const context =
          item.testId && testTitles?.[item.testId]
            ? testTitles[item.testId]
            : null;
        const status = item.detail.status;
        const files = item.attachments || [];
        return (
          <li
            key={item.id}
            data-activity={item.id}
            className={[
              item.kind === "comment" && "timeline-comment-item",
              item.id === flash && "timeline-flash",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="timeline-dot" aria-hidden />
            <div className="timeline-entry">
              {item.kind === "comment" ? (
                <article className="timeline-comment">
                  <header>
                    <span>
                      <strong>{item.actorName}</strong> comentou
                      {context && <span> em {context}</span>}
                    </span>
                    <time className="mono" dateTime={item.createdAt}>
                      {date(item.createdAt)}
                    </time>
                  </header>
                  <div className="timeline-comment-body">
                    {item.body && <Markdown>{item.body}</Markdown>}
                    <AttachmentList files={files} />
                  </div>
                </article>
              ) : (
                <div className="timeline-event">
                  <div>
                    <strong>{item.actorName}</strong>{" "}
                    {describe?.(item) ??
                      (item.kind === "step_recorded"
                        ? `marcou o passo ${item.detail.step} como ${stepLabels[String(status)] || "atualizado"}`
                        : eventLabels[item.kind] || item.kind)}
                    {context && <span> · {context}</span>}
                    {item.kind !== "step_recorded" &&
                      (status === "pending" ||
                        status === "approved" ||
                        status === "revoked") && (
                        <>
                          {" "}
                          <StatusBadge status={status} />
                        </>
                      )}
                  </div>
                  <time className="mono" dateTime={item.createdAt}>
                    {date(item.createdAt)}
                  </time>
                  {item.detail.resetToPending === true && (
                    <p className="muted">
                      Resultado reposto para pendente devido a alterações do
                      teste.
                    </p>
                  )}
                  {(item.body || files.length > 0) && (
                    <div className="timeline-note">
                      {item.body && <Markdown>{item.body}</Markdown>}
                      <AttachmentList files={files} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  ) : (
    <p className="muted">Ainda sem atividade.</p>
  );
}
