// Searchable select in the spirit of Select2: chips for the chosen values and a filtered
// listbox. Rendered inline (not in a portal) so it also works inside native <dialog>s.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export interface SelectOption {
  value: string;
  /** Plain text: used for search, chips without `render` and accessibility. */
  label: string;
  /** Rich content for the list and the chosen value (e.g. a coloured tag). */
  render?: ReactNode;
}
const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Props = {
  label: string;
  /** Visible label; omit when an external <label> or heading names the field. */
  showLabel?: boolean;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
} & (
  | {
      multiple: true;
      value: string[];
      onChange(value: string[]): void;
      /** Report the selection once, when the list closes (for saving to the API). */
      deferred?: boolean;
    }
  | {
      multiple?: false;
      value: string;
      onChange(value: string): void;
      deferred?: never;
    }
);

export function Select2(props: Props) {
  const {
    label,
    showLabel = false,
    options,
    placeholder = "Selecionar…",
    disabled = false,
  } = props;
  const multiple = props.multiple === true;
  const searchable = props.searchable ?? multiple;
  const selected = useMemo(
    () => (multiple ? (props.value as string[]) : [props.value as string]),
    [multiple, props.value],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [draft, setDraft] = useState<string[]>(selected);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement & HTMLButtonElement>(null);
  const listId = useId();
  const labelId = useId();
  const current = open && multiple && props.deferred ? draft : selected;
  const filtered = options.filter((option) =>
    fold(option.label).includes(fold(query.trim())),
  );
  useEffect(() => {
    if (!open) setDraft(selected);
  }, [open, selected]);
  useEffect(() => {
    root.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const emit = (values: string[]) => {
    if (props.multiple === true) props.onChange(values);
  };
  function close() {
    if (!open) return;
    setOpen(false);
    setQuery("");
    if (
      multiple &&
      props.deferred &&
      (draft.length !== selected.length ||
        draft.some((value) => !selected.includes(value)))
    )
      emit(draft);
  }
  function choose(value: string) {
    if (props.multiple === true) {
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      if (props.deferred) setDraft(next);
      else props.onChange(next);
      setQuery("");
      field.current?.focus();
    } else {
      setOpen(false);
      setQuery("");
      if (value !== props.value) props.onChange(value);
      field.current?.focus();
    }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        filtered.length
          ? (index + step + filtered.length) % filtered.length
          : 0,
      );
    } else if (event.key === "Enter" || (event.key === " " && !searchable)) {
      event.preventDefault();
      if (!open) setOpen(true);
      else if (filtered[active]) choose(filtered[active].value);
    } else if (event.key === "Escape" && open) {
      // Keep the surrounding dialog open: Escape only closes the list.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (
      event.key === "Backspace" &&
      multiple &&
      !query &&
      current.length &&
      !props.deferred
    )
      emit(current.slice(0, -1));
  }
  const chosen = current
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is SelectOption => !!option);
  const activeId = open && filtered[active] ? `${listId}-${active}` : undefined;
  const control = {
    id: `${listId}-field`,
    role: "combobox" as const,
    "aria-expanded": open,
    "aria-controls": listId,
    "aria-activedescendant": activeId,
    "aria-labelledby": showLabel ? labelId : undefined,
    "aria-label": showLabel ? undefined : label,
    disabled,
    onKeyDown,
  };
  return (
    <div
      ref={root}
      className={`select2 ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node)) close();
      }}
    >
      {showLabel && (
        <span className="select2-label" id={labelId}>
          {label}
        </span>
      )}
      <div
        className="select2-control"
        onMouseDown={(event) => {
          if (disabled || (event.target as HTMLElement).closest("button"))
            return;
          event.preventDefault();
          field.current?.focus();
          setOpen((value) => !value || searchable);
        }}
      >
        {multiple ? (
          <>
            {chosen.map((option) => (
              <span key={option.value} className="select2-chip">
                {option.render ?? option.label}
                {!disabled && (
                  <button
                    type="button"
                    className="select2-remove"
                    aria-label={`Remover ${option.label}`}
                    tabIndex={-1}
                    onClick={() => {
                      const next = current.filter(
                        (value) => value !== option.value,
                      );
                      if (props.deferred && open) setDraft(next);
                      else emit(next);
                    }}
                  >
                    <XMarkIcon aria-hidden />
                  </button>
                )}
              </span>
            ))}
            <input
              ref={field}
              {...control}
              className="select2-search"
              value={query}
              autoComplete="off"
              placeholder={chosen.length ? "" : placeholder}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setOpen(true);
              }}
            />
          </>
        ) : (
          <button
            ref={field}
            type="button"
            {...control}
            className="select2-value"
            onClick={() => setOpen((value) => !value)}
          >
            {chosen[0] ? (
              (chosen[0].render ?? chosen[0].label)
            ) : (
              <span className="muted">{placeholder}</span>
            )}
          </button>
        )}
        <ChevronDownIcon className="select2-caret" aria-hidden />
      </div>
      {open && (
        <ul
          className="select2-menu"
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
        >
          {filtered.map((option, index) => {
            const isSelected = current.includes(option.value);
            return (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                className={index === active ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option.value)}
              >
                <span className="select2-check" aria-hidden>
                  {isSelected && <CheckIcon />}
                </span>
                {option.render ?? option.label}
              </li>
            );
          })}
          {!filtered.length && (
            <li className="select2-empty" role="presentation">
              Sem resultados
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
