import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  FluentProvider,
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from "@fluentui/react-components";
import {
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  ChevronUpDownIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlusIcon,
  ShieldCheckIcon,
  SunIcon,
  ViewColumnsIcon,
} from "@heroicons/react/24/outline";
import type { IssuePage, Me, Project, Member } from "../shared/contracts";
import {
  clientConfig,
  initializeHost,
  localSignIn,
  signIn,
  type ClientConfig,
} from "./auth";
import { endSession, setSession, useRemote } from "./api";
import { Administration, Setup } from "./Admin";
import {
  Avatar,
  Button,
  ErrorMessage,
  IconButton,
  Loading,
  Empty,
} from "./components";
import { DefinitionForm } from "./forms";
import { initials } from "./presentation";
import { BrandIcon } from "./BrandIcon";
import { NotificationCenter } from "./notifications";
import { adminHash, readRoute, route, routeHash } from "./routes";
import { GlobalSearch } from "./search";
import { IssueList } from "./IssueList";
import { SuiteDetail } from "./SuiteDetail";
import { SuiteList } from "./SuiteList";
import { Settings } from "./Settings";
import { fluentThemes, useTheme } from "./theme";
import "./App.css";
export default function App() {
  const { theme, setHostTheme, toggle } = useTheme();
  const [config, setConfig] = useState<ClientConfig>();
  const [inTeams, setInTeams] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [localUser, setLocalUser] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([
      clientConfig(),
      initializeHost((value) => {
        if (live) setHostTheme(value);
      }),
    ])
      .then(async ([cfg, host]) => {
        if (!live) return;
        setConfig(cfg);
        setLocalUser(cfg.localUsers?.[0]?.oid || "");
        setInTeams(host);
        if (cfg.configured) {
          const session = await signIn(cfg, host);
          if (session && live) {
            setSession(session);
            setReady(true);
          }
        }
      })
      .catch((error) => {
        if (live) setError(error.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [setHostTheme]);
  return (
    <FluentProvider theme={fluentThemes[theme]} className="app-root">
      {ready ? (
        <SetupGate
          onSignIn={async () => {
            await endSession();
            setReady(false);
            setError("");
          }}
        >
          {(me, refreshMe, onSignIn) => (
            <Workspace
              me={me}
              refreshMe={refreshMe}
              localMode={config?.mode === "local"}
              theme={theme}
              onThemeChange={toggle}
              onSignIn={onSignIn}
            />
          )}
        </SetupGate>
      ) : (
        <main className="welcome">
          <div className="welcome-card">
            <div className="brand-mark">
              <BrandIcon />
            </div>
            <span className="eyebrow">
              {config?.mode === "local"
                ? "DEVBOARD · DESENVOLVIMENTO LOCAL"
                : "DEVBOARD · MICROSOFT TEAMS"}
            </span>
            <h1>Qualidade, em equipa.</h1>
            <p>
              Organize testes manuais, acompanhe resultados e mantenha cada
              decisão no seu contexto.
            </p>
            {busy ? (
              <Loading />
            ) : config && !config.configured ? (
              <div className="notice">
                <strong>Configuração necessária</strong>
                <p>
                  {config.mode === "local"
                    ? "Configure PostgreSQL, aplique as migrações e reinicie a aplicação."
                    : "Configure PostgreSQL e Microsoft Entra no servidor, aplique as migrações e reinicie a aplicação."}{" "}
                  Consulte o README do projeto.
                </p>
              </div>
            ) : config?.mode === "local" ? (
              <div className="local-sign-in">
                <div className="local-mode-label">
                  Modo de desenvolvimento local
                </div>
                <label className="field" htmlFor="local-user">
                  Utilizador local
                  <select
                    id="local-user"
                    value={localUser}
                    onChange={(event) => setLocalUser(event.target.value)}
                  >
                    {config.localUsers?.map((user) => (
                      <option key={user.oid} value={user.oid}>
                        {user.name} · {user.email}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="primary"
                  disabled={!localUser}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const session = await localSignIn(localUser);
                      setSession(session);
                      setReady(true);
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Entrar localmente
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                disabled={!config}
                onClick={async () => {
                  if (!config) return;
                  setBusy(true);
                  setError("");
                  try {
                    const session = await signIn(config, inTeams, true);
                    if (session) {
                      setSession(session);
                      setReady(true);
                    }
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Iniciar sessão com Microsoft
              </Button>
            )}
            {error && <ErrorMessage message={error} />}
          </div>
        </main>
      )}
    </FluentProvider>
  );
}
/** Nothing but the setup page is available until a master administrator exists. */
function SetupGate({
  onSignIn,
  children,
}: {
  onSignIn(): Promise<void>;
  children(
    me: Me,
    refreshMe: () => void,
    onSignIn: () => Promise<void>,
  ): ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const refreshMe = useCallback(() => setRevision((value) => value + 1), []);
  const me = useRemote<Me>("/me", revision);
  if (!me.data)
    return (
      <main className="welcome">
        <div className="welcome-card">
          {me.error ? (
            <>
              <ErrorMessage message={me.error} />
              <Button onClick={() => void onSignIn()}>Iniciar sessão</Button>
            </>
          ) : (
            <Loading />
          )}
        </div>
      </main>
    );
  return me.data.setupRequired ? (
    <Setup me={me.data} onDone={refreshMe} onSignIn={onSignIn} />
  ) : (
    <>{children(me.data, refreshMe, onSignIn)}</>
  );
}
function ProjectBadge({ project }: { project: Project }) {
  return project.icon ? (
    <img className="project-badge" src={project.icon} alt="" />
  ) : (
    <span className="project-badge" aria-hidden>
      {initials(project.name)}
    </span>
  );
}
function ProjectSwitcher({
  projects,
  current,
  onCreate,
  onNavigate,
}: {
  projects: Project[];
  current?: Project;
  /** Only administrators create projects. */
  onCreate?: () => void;
  onNavigate(): void;
}) {
  return (
    <Menu
      positioning={{
        position: "below",
        align: "start",
        matchTargetSize: "width",
      }}
      checkedValues={{ project: current ? [current.id] : [] }}
      onCheckedValueChange={(_, data) => {
        route(data.checkedItems[0]);
        onNavigate();
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <button
          type="button"
          className="project-switcher"
          aria-label={
            current
              ? `Projeto atual: ${current.name}. Mudar de projeto`
              : "Escolher projeto"
          }
        >
          {current ? (
            <ProjectBadge project={current} />
          ) : (
            <span className="project-badge" aria-hidden>
              ?
            </span>
          )}
          <span className="project-switcher-name">
            {current?.name || "Escolher projeto"}
          </span>
          <ChevronUpDownIcon aria-hidden />
        </button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {projects.map((project) => (
            <MenuItemRadio
              key={project.id}
              name="project"
              value={project.id}
              icon={<ProjectBadge project={project} />}
            >
              {project.name}
            </MenuItemRadio>
          ))}
          {projects.length > 0 && onCreate && <MenuDivider />}
          {onCreate && (
            <MenuItem icon={<PlusIcon />} onClick={onCreate}>
              Criar projeto
            </MenuItem>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
function Workspace({
  me,
  refreshMe,
  localMode,
  onSignIn,
  theme,
  onThemeChange,
}: {
  me: Me;
  refreshMe(): void;
  localMode: boolean;
  onSignIn(): Promise<void>;
  theme: "light" | "dark" | "contrast";
  onThemeChange(): void;
}) {
  const [revision, setRevision] = useState(0);
  const refresh = () => {
    setRevision((value) => value + 1);
    refreshMe();
  };
  const [current, setCurrent] = useState(readRoute);
  const [newProject, setNewProject] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [suiteTitle, setSuiteTitle] = useState<{ id: string; title: string }>();
  const projects = useRemote<Project[]>("/projects", revision);
  const admin = me.admin;
  const members = useRemote<Member[]>(
    current.projectId ? `/projects/${current.projectId}/members` : null,
    revision,
  );
  useEffect(() => {
    const change = () => {
      setCurrent(readRoute());
      setNavOpen(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    if (
      projects.data &&
      !current.projectId &&
      !(admin && current.section === "admin")
    ) {
      const first = projects.data[0];
      if (first) route(first.id);
    }
  }, [projects.data, current.projectId, current.section, admin]);
  useEffect(() => {
    if (!navOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navOpen]);
  const project = projects.data?.find(
    (project) => project.id === current.projectId,
  );
  const summary = useRemote<{ total: number }>(
    project ? `/projects/${project.id}/summary` : null,
    revision,
  ).data;
  const openIssues = useRemote<IssuePage>(
    project ? `/projects/${project.id}/issues?pageSize=1` : null,
    revision,
  ).data?.counts.open;
  const settings = current.section === "settings";
  const administration = admin && current.section === "admin";
  const outsider =
    admin && !!members.data && !members.data.some((item) => item.id === me.id);
  const dev = current.section === "dev";
  const issueFocus = useMemo(
    () =>
      current.issueId
        ? { issueId: current.issueId, activityId: current.activityId }
        : undefined,
    [current],
  );
  const syncIssue = useCallback(
    (issueId?: string) => {
      if (!current.projectId) return;
      history.replaceState(
        null,
        "",
        routeHash(current.projectId, "", "dev", { issue: issueId }),
      );
    },
    [current.projectId],
  );
  // A new route object (every hash change) re-applies the anchor, even to the same test.
  const focus = useMemo(
    () =>
      current.testId || current.activityId
        ? { testId: current.testId, activityId: current.activityId }
        : undefined,
    [current],
  );
  const syncTest = useCallback(
    (testId?: string) => {
      if (!current.projectId || !current.suiteId) return;
      history.replaceState(
        null,
        "",
        routeHash(current.projectId, current.suiteId, "suites", {
          test: testId,
        }),
      );
    },
    [current.projectId, current.suiteId],
  );
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);
  return (
    <div className={`workspace ${navOpen ? "nav-open" : ""}`}>
      <aside className="sidebar" id="app-sidebar">
        <div className="brand">
          <span className="brand-mark">
            <BrandIcon />
          </span>
          <strong>DevBoard</strong>
        </div>
        <ProjectSwitcher
          projects={projects.data || []}
          current={project}
          onCreate={admin ? () => setNewProject(true) : undefined}
          onNavigate={() => setNavOpen(false)}
        />
        {project && (
          <nav className="sidebar-nav" aria-labelledby="nav-quality">
            <span className="nav-label" id="nav-quality">
              Projeto
            </span>
            <a
              className="nav-link"
              href={routeHash(project.id, "", "dev")}
              aria-current={dev ? "page" : undefined}
              onClick={() => setNavOpen(false)}
            >
              <ViewColumnsIcon aria-hidden />
              <span>Desenvolvimento</span>
              {openIssues !== undefined && (
                <span
                  className="nav-count mono"
                  title={`${openIssues} issues em aberto`}
                >
                  {openIssues}
                </span>
              )}
            </a>
            <a
              className="nav-link"
              href={routeHash(project.id)}
              aria-current={!settings && !dev ? "page" : undefined}
              onClick={() => setNavOpen(false)}
            >
              <ClipboardDocumentListIcon aria-hidden />
              <span>Suite de testes</span>
              {summary && (
                <span className="nav-count mono">{summary.total}</span>
              )}
            </a>
            <a
              className="nav-link"
              href={routeHash(project.id, "", "settings")}
              aria-current={settings ? "page" : undefined}
              onClick={() => setNavOpen(false)}
            >
              <Cog6ToothIcon aria-hidden />
              <span>Definições</span>
            </a>
          </nav>
        )}
        {admin && (
          <nav className="sidebar-nav" aria-labelledby="nav-app">
            <span className="nav-label" id="nav-app">
              Aplicação
            </span>
            <a
              className="nav-link"
              href={adminHash}
              aria-current={administration ? "page" : undefined}
              onClick={() => setNavOpen(false)}
            >
              <ShieldCheckIcon aria-hidden />
              <span>Administração</span>
            </a>
          </nav>
        )}
        <div className="sidebar-bottom">
          <Avatar name={me.name} size="medium" />
          <div>
            <strong>{me.name}</strong>
            <small>
              {admin
                ? "Administrador"
                : localMode
                  ? "Desenvolvimento local"
                  : "Microsoft 365"}
            </small>
          </div>
          <IconButton
            size="sm"
            icon={<ArrowRightStartOnRectangleIcon />}
            label={localMode ? "Mudar utilizador" : "Terminar sessão"}
            onClick={() => void onSignIn()}
          />
        </div>
      </aside>
      <div
        className="sidebar-scrim"
        aria-hidden
        onClick={() => setNavOpen(false)}
      />
      <div className="workspace-main">
        <header className="topbar">
          <IconButton
            className="nav-toggle"
            icon={<Bars3Icon />}
            label={navOpen ? "Fechar navegação" : "Abrir navegação"}
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            onClick={() => setNavOpen((open) => !open)}
          />
          <nav className="breadcrumb" aria-label="Localização">
            {administration ? (
              <ol>
                <li aria-current="page">Administração</li>
              </ol>
            ) : project && (
              <ol>
                <li>
                  <a href={routeHash(project.id)}>{project.name}</a>
                </li>
                {settings ? (
                  <li aria-current="page">Definições</li>
                ) : dev ? (
                  <li aria-current="page">Desenvolvimento</li>
                ) : current.suiteId ? (
                  <>
                    <li>
                      <a href={routeHash(project.id)}>Suites de testes</a>
                    </li>
                    <li aria-current="page">
                      {suiteTitle?.id === current.suiteId
                        ? suiteTitle.title
                        : "Suite"}
                    </li>
                  </>
                ) : (
                  <li aria-current="page">Suites de testes</li>
                )}
              </ol>
            )}
          </nav>
          <button
            type="button"
            className="search-trigger"
            aria-keyshortcuts="Control+K"
            onClick={() => setSearching(true)}
          >
            <MagnifyingGlassIcon aria-hidden />
            <span>Procurar…</span>
            <kbd className="mono">Ctrl K</kbd>
          </button>
          <NotificationCenter revision={revision} refresh={refresh} />
          {theme !== "contrast" && (
            <IconButton
              icon={theme === "dark" ? <SunIcon /> : <MoonIcon />}
              label="Alternar modo claro/escuro"
              onClick={onThemeChange}
            />
          )}
        </header>
        <main className="main-content">
          <div className="content">
            {projects.error && <ErrorMessage message={projects.error} />}
            {outsider && settings && !administration && (
              <p className="notice">
                Não é membro deste projeto: tem acesso de proprietário como
                administrador da aplicação. Adicione-se como membro para receber
                notificações e poder ser responsável.
              </p>
            )}
            {project?.role === "viewer" && !settings && (
              <p className="notice read-only-notice">
                Tem acesso só de leitura neste projeto: pode consultar suites,
                testes e issues, mas não editar, comentar ou ser responsável.
              </p>
            )}
            {members.error && <ErrorMessage message={members.error} />}
            {administration ? (
              <Administration me={me} onChanged={refresh} />
            ) : !projects.data ? (
              <Loading />
            ) : project ? (
              settings ? (
                <Settings
                  key={project.id}
                  project={project}
                  members={members.data || []}
                  userId={me.id}
                  revision={revision}
                  refresh={refresh}
                  onDeleted={() => {
                    location.hash = "";
                    refresh();
                  }}
                />
              ) : dev ? (
                <IssueList
                  key={project.id}
                  project={project}
                  members={members.data || []}
                  revision={revision}
                  refresh={refresh}
                  userId={me.id}
                  focus={issueFocus}
                  onIssueChange={syncIssue}
                />
              ) : current.suiteId ? (
                <SuiteDetail
                  key={current.suiteId}
                  project={project}
                  suiteId={current.suiteId}
                  members={members.data || []}
                  revision={revision}
                  refresh={refresh}
                  navigate={(suiteId) => route(project.id, suiteId)}
                  focus={focus}
                  onTestChange={syncTest}
                  userId={me.id}
                  onLoaded={(title) =>
                    setSuiteTitle((previous) =>
                      previous?.id === current.suiteId &&
                      previous.title === title
                        ? previous
                        : { id: current.suiteId, title },
                    )
                  }
                />
              ) : (
                <SuiteList
                  key={project.id}
                  project={project}
                  members={members.data || []}
                  revision={revision}
                  refresh={refresh}
                  openSuite={(suiteId) => route(project.id, suiteId)}
                />
              )
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <h1>Os seus projetos de QA</h1>
                    <p>Organize a revisão manual do produto.</p>
                  </div>
                  {admin && (
                    <Button
                      variant="primary"
                      icon={<PlusIcon />}
                      onClick={() => setNewProject(true)}
                    >
                      Criar projeto
                    </Button>
                  )}
                </div>
                <Empty
                  title={
                    current.projectId
                      ? "Projeto indisponível"
                      : admin
                        ? "Comece pelo primeiro projeto"
                        : "Ainda sem projetos"
                  }
                >
                  {current.projectId
                    ? "Selecione outro projeto ou confirme o acesso com um proprietário."
                    : admin
                      ? "Crie um projeto e adicione a equipa nas definições do projeto."
                      : "Os projetos são criados pelos administradores. Peça a um administrador ou proprietário para o adicionar a um projeto."}
                </Empty>
              </>
            )}
          </div>
        </main>
      </div>
      {searching && <GlobalSearch onClose={() => setSearching(false)} />}
      {newProject && (
        <DefinitionForm
          kind="project"
          onClose={() => setNewProject(false)}
          onSaved={(id) => {
            refresh();
            // New projects have no members yet: start where the team is added.
            if (id) route(id, "", "settings");
          }}
        />
      )}
    </div>
  );
}
