import { useMemo, useState } from "react";
import {
  Menu,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from "@fluentui/react-components";
import { ViewColumnsIcon } from "@heroicons/react/24/outline";
import { api } from "./api";
import { Button } from "./components";

export interface ColumnDefinition<Id extends string> {
  id: Id;
  label: string;
  /** Always visible and always first. */
  fixed?: boolean;
}
/**
 * Columns a person shows and orders in a table, saved on the server under `key`
 * (a preference of that person). Fixed columns always come first.
 */
export function useColumns<Id extends string>(
  key: string,
  columns: readonly ColumnDefinition<Id>[],
  defaults: Id[],
  preferences: Record<string, unknown> | undefined,
) {
  const [chosen, setChosen] = useState<Id[]>();
  const fixed = columns
    .filter((column) => column.fixed)
    .map((column) => column.id);
  const active = useMemo(() => {
    const saved = chosen ?? preferences?.[key];
    const known = new Set<string>(columns.map((column) => column.id));
    const list =
      Array.isArray(saved) && saved.length
        ? (saved.filter((id) => known.has(id)) as Id[])
        : defaults;
    return [...fixed, ...list.filter((id) => !fixed.includes(id))];
    // `columns`, `defaults` and `fixed` are constants of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, preferences, key]);
  const save = (next: Id[]) => {
    setChosen(next);
    void api(`/me/preferences/${key}`, "PUT", { value: next }).catch(
      () => undefined,
    );
  };
  return {
    columns,
    fixed,
    active,
    visible: active.map((id) => columns.find((column) => column.id === id)!),
    save,
    /** Moves `id` next to `target` (before or after it); fixed columns never move. */
    move(id: Id, target: Id, after: boolean) {
      if (id === target || fixed.includes(id)) return;
      const rest = active.filter(
        (column) => column !== id && !fixed.includes(column),
      );
      const index = fixed.includes(target)
        ? 0
        : rest.indexOf(target) + (after ? 1 : 0);
      rest.splice(index, 0, id);
      save([...fixed, ...rest]);
    },
  };
}
export type ColumnLayout<Id extends string> = ReturnType<typeof useColumns<Id>>;

/** "Colunas" menu: shows or hides the movable columns. */
export function ColumnMenu<Id extends string>({
  layout,
}: {
  layout: ColumnLayout<Id>;
}) {
  return (
    <Menu
      positioning="below-end"
      checkedValues={{ columns: layout.active }}
      onCheckedValueChange={(_, data) => {
        // Keep the current order; newly shown columns go to the end.
        const kept = layout.active.filter(
          (id) => layout.fixed.includes(id) || data.checkedItems.includes(id),
        );
        const added = layout.columns
          .map((column) => column.id)
          .filter((id) => data.checkedItems.includes(id) && !kept.includes(id));
        layout.save([...kept, ...added]);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Button size="sm" icon={<ViewColumnsIcon />}>
          Colunas
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {layout.columns.map((column) => (
            <MenuItemCheckbox
              key={column.id}
              name="columns"
              value={column.id}
              disabled={!!column.fixed}
            >
              {column.label}
            </MenuItemCheckbox>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** Header cells of the visible columns; movable ones are dragged or moved with Alt+arrows. */
export function ColumnHeaders<Id extends string>({
  layout,
  className,
}: {
  layout: ColumnLayout<Id>;
  /** Class of a column's cells, shared by its header. */
  className(id: Id): string;
}) {
  const [dragged, setDragged] = useState<Id>();
  const [target, setTarget] = useState<{ id: Id; after: boolean }>();
  const { visible, fixed } = layout;
  return (
    <>
      {visible.map((column, index) => {
        const still = fixed.includes(column.id);
        const drop = target?.id === column.id ? target : undefined;
        return (
          <th
            key={column.id}
            className={[
              className(column.id),
              !still && "movable-column",
              dragged === column.id && "dragging",
              drop && (drop.after ? "drop-after" : "drop-before"),
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={!still}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", column.id);
              setDragged(column.id);
            }}
            onDragOver={(event) => {
              if (!dragged || still) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const after = event.clientX > rect.left + rect.width / 2;
              if (target?.id !== column.id || target.after !== after)
                setTarget({ id: column.id, after });
            }}
            onDragLeave={() => setTarget(undefined)}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged && drop) layout.move(dragged, column.id, drop.after);
              setDragged(undefined);
              setTarget(undefined);
            }}
            onDragEnd={() => {
              setDragged(undefined);
              setTarget(undefined);
            }}
          >
            {still ? (
              column.label
            ) : (
              <button
                type="button"
                className="column-handle"
                title="Arraste para reordenar (Alt+← / Alt+→)"
                aria-label={`Coluna ${column.label}: Alt+seta para a esquerda ou direita para mover`}
                onKeyDown={(event) => {
                  if (
                    !event.altKey ||
                    (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  )
                    return;
                  event.preventDefault();
                  const neighbour =
                    visible[index + (event.key === "ArrowLeft" ? -1 : 1)];
                  if (neighbour && !fixed.includes(neighbour.id))
                    layout.move(
                      column.id,
                      neighbour.id,
                      event.key === "ArrowRight",
                    );
                }}
              >
                {column.label}
              </button>
            )}
          </th>
        );
      })}
    </>
  );
}
