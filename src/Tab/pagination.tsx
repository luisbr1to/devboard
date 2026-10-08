import { useState } from "react";
import {
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from "@fluentui/react-components";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { api, useRemote } from "./api";
import { Button, IconButton } from "./components";

export const pageSizes = [10, 25, 50, 100];

/** Page size remembered per user on the server (falls back when unavailable). */
export function usePageSize(
  key: "issues.pageSize" | "suites.pageSize" | "tests.pageSize",
  fallback: number,
) {
  const preferences = useRemote<Record<string, unknown>>("/me/preferences", 0);
  const [chosen, setChosen] = useState<number>();
  const saved = Number(preferences.data?.[key]);
  const value = chosen ?? (pageSizes.includes(saved) ? saved : fallback);
  const change = (size: number) => {
    setChosen(size);
    void api(`/me/preferences/${key}`, "PUT", { value: String(size) }).catch(
      () => undefined,
    );
  };
  return [value, change] as const;
}

/** 1 … 4 5 6 … 12: first, last and the neighbours of the current page. */
function pageList(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const pages = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((value) => pages.add(value));
  if (page >= count - 2)
    [count - 3, count - 2, count - 1].forEach((value) => pages.add(value));
  const sorted = [...pages]
    .filter((value) => value >= 1 && value <= count)
    .sort((a, b) => a - b);
  return sorted.flatMap((value, index) =>
    index && value - sorted[index - 1] > 1 ? ["gap" as const, value] : [value],
  );
}

export function Pagination({
  label,
  noun,
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  label: string;
  /** Singular and plural, e.g. ["issue", "issues"]. */
  noun: [string, string];
  total: number;
  page: number;
  pageSize: number;
  onPage(page: number): void;
  onPageSize?(size: number): void;
}) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return (
    <nav className="pagination" aria-label={label}>
      <span className="pagination-summary">
        {first}–{last} de {total} {total === 1 ? noun[0] : noun[1]}
      </span>
      {onPageSize && (
        <Menu
          positioning="above-end"
          checkedValues={{ pageSize: [String(pageSize)] }}
          onCheckedValueChange={(_, data) =>
            onPageSize(Number(data.checkedItems[0]))
          }
        >
          <MenuTrigger disableButtonEnhancement>
            <Button
              size="sm"
              className="pagination-size"
              aria-label={`Itens por página: ${pageSize}`}
            >
              {pageSize} por página
              <ChevronDownIcon className="pagination-caret" aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {pageSizes.map((size) => (
                <MenuItemRadio key={size} name="pageSize" value={String(size)}>
                  {size} por página
                </MenuItemRadio>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
      {count > 1 && (
        <div className="pagination-pages">
          <IconButton
            size="sm"
            icon={<ChevronLeftIcon />}
            label="Página anterior"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          />
          {pageList(page, count).map((value, index) =>
            value === "gap" ? (
              <span key={`gap-${index}`} className="pagination-gap" aria-hidden>
                …
              </span>
            ) : (
              <Button
                key={value}
                size="sm"
                variant={value === page ? "secondary" : "ghost"}
                className="pagination-page"
                aria-label={`Página ${value}`}
                aria-current={value === page ? "page" : undefined}
                onClick={() => onPage(value)}
              >
                {value}
              </Button>
            ),
          )}
          <IconButton
            size="sm"
            icon={<ChevronRightIcon />}
            label="Página seguinte"
            disabled={page >= count}
            onClick={() => onPage(page + 1)}
          />
        </div>
      )}
    </nav>
  );
}
