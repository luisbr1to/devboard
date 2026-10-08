import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { SearchResults } from "../shared/contracts";
import { api } from "./api";
import { Loading, Modal } from "./components";
import { issueKey, suiteKey, testKey } from "./presentation";
import { route } from "./routes";

/** Ctrl+K search over suites, tests (including steps), issues and comments the user can access. */
export function GlobalSearch({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2 && !/^\d$/.test(text)) {
      setResults(undefined);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      api<SearchResults>(
        `/search?q=${encodeURIComponent(text)}`,
        "GET",
        undefined,
        undefined,
        controller.signal,
      )
        .then((data) => {
          setResults(data);
          setError("");
        })
        .catch((failure: Error) => {
          if (!controller.signal.aborted) setError(failure.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);
  const go = (...args: Parameters<typeof route>) => {
    onClose();
    route(...args);
  };
  const move = (event: KeyboardEvent, from: number) => {
    const buttons = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>(".search-result") ||
        []),
    ];
    const target =
      event.key === "ArrowDown"
        ? Math.min(from + 1, buttons.length - 1)
        : event.key === "ArrowUp"
          ? from - 1
          : null;
    if (target === null) return;
    event.preventDefault();
    if (target < 0)
      (
        list.current?.parentElement?.querySelector("input") as HTMLElement
      )?.focus();
    else buttons[target]?.focus();
  };
  let index = -1;
  const result = (key: string, onSelect: () => void, content: ReactNode) => {
    const position = ++index;
    return (
      <li key={key}>
        <button
          type="button"
          className="search-result"
          onClick={onSelect}
          onKeyDown={(event) => move(event, position)}
        >
          {content}
        </button>
      </li>
    );
  };
  const empty =
    results &&
    !results.suites.length &&
    !results.tests.length &&
    !results.issues.length &&
    !results.comments.length;
  return (
    <Modal title="Procurar" variant="modal" onClose={onClose}>
      <div className="global-search">
        <label className="search-field">
          <MagnifyingGlassIcon aria-hidden />
          <span className="visually-hidden">
            Procurar suites, testes, issues e comentários
          </span>
          <input
            type="search"
            placeholder="Suites, testes, issues, comentários, SU-04, TC-2 ou nº do issue…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Native search inputs clear on Escape; here Escape closes the dialog.
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else move(event, -1);
            }}
          />
        </label>
        <div ref={list} className="search-results" aria-live="polite">
          {error && <p className="muted">{error}</p>}
          {loading && !results && <Loading />}
          {!results && !loading && (
            <p className="muted">
              Escreva pelo menos 2 caracteres ou o número de um issue.
            </p>
          )}
          {empty && <p className="muted">Sem resultados para “{query}”.</p>}
          {results && results.suites.length > 0 && (
            <section>
              <h3 className="section-label">Suites</h3>
              <ul>
                {results.suites.map((suite) =>
                  result(
                    suite.id,
                    () => go(suite.projectId, suite.id),
                    <>
                      <span className="mono search-key">
                        {suiteKey(suite.number)}
                      </span>
                      <span className="search-title">
                        {suite.title}
                        <small>
                          {suite.projectName}
                          {suite.archived && " · Arquivada"}
                        </small>
                      </span>
                    </>,
                  ),
                )}
              </ul>
            </section>
          )}
          {results && results.tests.length > 0 && (
            <section>
              <h3 className="section-label">Testes</h3>
              <ul>
                {results.tests.map((test) =>
                  result(
                    test.id,
                    () =>
                      go(test.projectId, test.suiteId, "suites", {
                        test: test.id,
                      }),
                    <>
                      <span className="mono search-key">
                        {testKey(test.number)}
                      </span>
                      <span className="search-title">
                        {test.title}
                        <small>
                          {suiteKey(test.suiteNumber)} {test.suiteTitle} ·{" "}
                          {test.projectName}
                        </small>
                      </span>
                    </>,
                  ),
                )}
              </ul>
            </section>
          )}
          {results && results.issues.length > 0 && (
            <section>
              <h3 className="section-label">Issues</h3>
              <ul>
                {results.issues.map((issue) =>
                  result(
                    issue.id,
                    () => go(issue.projectId, "", "dev", { issue: issue.id }),
                    <>
                      <span className="mono search-key">
                        {issueKey(issue.number)}
                      </span>
                      <span className="search-title">
                        {issue.title}
                        <small>
                          {issue.projectName}
                          {issue.archived && " · Arquivado"}
                        </small>
                      </span>
                    </>,
                  ),
                )}
              </ul>
            </section>
          )}
          {results && results.comments.length > 0 && (
            <section>
              <h3 className="section-label">Comentários</h3>
              <ul>
                {results.comments.map((comment) =>
                  result(
                    comment.id,
                    () =>
                      comment.issueId
                        ? go(comment.projectId, "", "dev", {
                            issue: comment.issueId,
                            activity: comment.id,
                          })
                        : go(
                            comment.projectId,
                            comment.suiteId || "",
                            "suites",
                            {
                              test: comment.testId,
                              activity: comment.id,
                            },
                          ),
                    <>
                      <span className="mono search-key">
                        {comment.issueNumber
                          ? issueKey(comment.issueNumber)
                          : comment.testNumber
                            ? testKey(comment.testNumber)
                            : suiteKey(comment.suiteNumber || 0)}
                      </span>
                      <span className="search-title">
                        “{comment.excerpt}”
                        <small>
                          {comment.actorName} · {comment.projectName}
                        </small>
                      </span>
                    </>,
                  ),
                )}
              </ul>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
