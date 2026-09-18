import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Boxes,
  Braces,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  Coffee,
  GitBranch,
  Github,
  History,
  Home,
  Layers3,
  LockKeyhole,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  Zap,
  Eye,
  EyeOff,
  ChevronRight,
  ExternalLink,
  Maximize2,
  Minimize2,
  FileText,
  UserPlus,
  Key,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  apiClient,
  ApiClientError,
  type ApiInvestigation,
  type InvestigationStatus,
} from "@/api/client";
import {
  resultEvidence,
  resultSummary,
  toEvidenceView,
  toIssueView,
  toRepositoryView,
  type EvidenceView,
  type IssueView,
  type RepositoryView,
} from "./api-models";

type Screen =
  | "entry"
  | "login"
  | "how-it-works"
  | "dashboard"
  | "repositories"
  | "indexing"
  | "issues"
  | "investigating"
  | "workspace"
  | "settings"
  | "evidence-detail";
type WorkspaceTab = "overview" | "graph" | "code" | "history" | "impact" | "plan";
type SettingsTab = "profile" | "appearance" | "investigation" | "notifications" | "plan";

const investigationStages: Array<[string, string, string]> = [
  ["01", "Understand issue", "Reading the selected issue..."],
  ["02", "Search repository", "Searching indexed source..."],
  ["03", "Trace relevant code", "Tracing returned source evidence..."],
  ["04", "Investigate Git history", "Checking verified commits..."],
  ["05", "Find related issues", "Comparing related repository issues..."],
  ["06", "Form hypothesis", "Forming an evidence-backed hypothesis..."],
  ["07", "Verify evidence", "Validating provenance..."],
  ["08", "Build investigation", "Preparing the investigation brief..."],
];

const stageOrder = [
  "understanding_issue",
  "searching_repository",
  "tracing_code",
  "checking_history",
  "finding_related_issues",
  "forming_hypothesis",
  "verifying_evidence",
  "synthesizing",
  "validating",
  "completed",
];
const errorMessage = (error: unknown) =>
  error instanceof ApiClientError ? error.message : "The investigation connection was interrupted.";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="logo-mark">
        <Search size={18} strokeWidth={2.8} />
      </span>
      {!compact && <span className="text-lg font-extrabold tracking-tight">RepoSherlock</span>}
    </div>
  );
}

function Character({
  mood = "curious",
  className,
}: {
  mood?: "curious" | "sleepy" | "detective" | "coffee" | "shy" | "oops" | "happy";
  className?: string;
}) {
  const eyesCovered = mood === "shy";
  return (
    <div
      className={cn("character", `character-${mood}`, className)}
      aria-label={`${mood} developer illustration`}
    >
      <div className="character-hair" />
      <div className="character-head">
        <div className="character-glasses">
          <i />
          <i />
        </div>
        {eyesCovered && (
          <div className="character-hands">
            <i />
            <i />
          </div>
        )}
        <div className="character-mouth" />
      </div>
      <div className="character-body">
        <span>{mood === "coffee" ? "☕" : mood === "detective" ? "⌕" : "{ }"}</span>
      </div>
      <div className="character-laptop">
        RS
        <span />
      </div>
    </div>
  );
}

function Entry({ onStart, onHow }: { onStart: () => void; onHow: () => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <main
      className="entry-scene"
      onPointerMove={(e) =>
        setPos({ x: (e.clientX / innerWidth - 0.5) * 16, y: (e.clientY / innerHeight - 0.5) * 10 })
      }
    >
      <header className="entry-nav">
        <Logo />
        <span className="mini-proof">
          <ShieldCheck size={14} /> Mock prototype · No repository access
        </span>
      </header>
      <div
        className="software-sky"
        aria-hidden="true"
        style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      >
        <div className="sky-path path-a" />
        <div className="sky-path path-b" />
        <div className="float-object folder one">
          <span>src</span>
          <small>42 files</small>
        </div>
        <div className="float-object issue two">
          <CircleDot size={15} />
          <span>#1842</span>
        </div>
        <div className="float-object code three">
          <Braces size={20} />
          <span>webhook.ts</span>
        </div>
        <div className="float-object commit four">
          <GitBranch size={18} />
          <span>8f3a21c</span>
        </div>
        <div className="float-object pull five">
          <GitBranch size={16} />
          <span>PR #892</span>
        </div>
        <div className="float-object folder six">
          <span>payments</span>
          <small>18 files</small>
        </div>
      </div>
      <section className="entry-copy">
        <p className="eyebrow">
          <Sparkles size={15} /> Investigate first. Code second.
        </p>
        <h1>
          Meet <span>RepoSherlock.</span>
        </h1>
        <p className="entry-sub">Investigate the codebase before you touch the code.</p>
        <div className="entry-actions">
          <Button size="lg" onClick={onStart}>
            Start Investigating <ArrowRight />
          </Button>
          <Button size="lg" variant="outline" onClick={onHow}>
            See how it works
          </Button>
        </div>
        <p className="credibility">
          <ShieldCheck size={16} /> Evidence-backed investigation for GitHub repositories.
        </p>
      </section>
      <div className="entry-character">
        <Character mood="detective" />
      </div>
      <div className="process-ribbon">
        <span>INVESTIGATE</span>
        <ArrowRight />
        <span>UNDERSTAND</span>
        <ArrowRight />
        <span>VERIFY</span>
        <ArrowRight />
        <span>ACT</span>
      </div>
    </main>
  );
}

function Login({
  onBack,
  onSuccess,
  onError,
}: {
  onBack: () => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<"normal" | "loading" | "error" | "success">("normal");
  const [email, setEmail] = useState("alex@acme.dev");
  const signIn = async () => {
    setState("loading");
    try {
      await apiClient.createSession();
      setState("success");
      await wait(250);
      onSuccess();
    } catch (error) {
      setState("error");
      onError(errorMessage(error));
    }
  };
  return (
    <main className="login-scene">
      <Button variant="ghost" className="back-button" onClick={onBack}>
        <ArrowLeft /> Back
      </Button>
      <div className="login-cast" aria-hidden="true">
        <Character
          mood={
            passwordFocus
              ? "shy"
              : state === "error"
                ? "oops"
                : state === "success"
                  ? "happy"
                  : "curious"
          }
          className="cast-one"
        />
        <Character mood={passwordFocus ? "shy" : "sleepy"} className="cast-two" />
        <Character
          mood={passwordFocus ? "shy" : state === "loading" ? "detective" : "coffee"}
          className="cast-three"
        />
        <Character mood={passwordFocus ? "shy" : "detective"} className="cast-four" />
      </div>
      <section className="login-card">
        <Logo />
        <p className="eyebrow">YOUR INVESTIGATION DESK</p>
        <h1>Welcome back, detective.</h1>
        <p>There are mysteries waiting in the codebase.</p>
        <Button className="github-button" size="lg" onClick={signIn} disabled={state === "loading"}>
          <Github /> Continue with GitHub
        </Button>
        <div className="divider">
          <span>or</span>
        </div>
        <label>
          Email
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </label>
        <label className="password-field">
          <span className="pw-label">Password</span>
          <Input
            type={showPassword ? "text" : "password"}
            defaultValue="evidencefirst"
            onFocus={() => setPasswordFocus(true)}
            onBlur={() => setPasswordFocus(false)}
          />
          <button
            type="button"
            className="pw-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </label>
        {state === "error" && (
          <p className="form-error">
            <AlertTriangle size={16} /> The authentication connection was interrupted.
          </p>
        )}
        {state === "success" && (
          <p className="form-success">
            <Check size={16} /> Identity confirmed. Opening the case board...
          </p>
        )}
        <Button size="lg" onClick={signIn} disabled={state === "loading"}>
          {state === "loading" ? (
            <>
              <Search className="investigate-spin" /> Investigating credentials...
            </>
          ) : state === "success" ? (
            <>
              <Check /> Welcome back
            </>
          ) : (
            "Sign in"
          )}
        </Button>
        <div className="login-links">
          <button
            type="button"
            onClick={() => {
              setState("normal");
              alert("Account creation flow would open a mock signup wizard here.");
            }}
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => {
              setState("normal");
              alert("Password reset email would be sent to alex@acme.dev in the full product.");
            }}
          >
            Forgot password?
          </button>
        </div>
        <button type="button" className="error-demo" onClick={() => setState("error")}>
          Preview invalid login
        </button>
      </section>
      <p className="login-footer">
        Your code stays yours. RepoSherlock investigates; it doesn't rewrite your repository.
      </p>
    </main>
  );
}

const nav = [
  ["Home", Home],
  ["Repositories", Boxes],
  ["Investigations", Search],
  ["Evidence", ShieldCheck],
  ["History", History],
  ["Settings", Settings],
] as const;

function AppShell({
  screen,
  setScreen,
  children,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="app-shell">
      <aside className={cn("sidebar", collapsed && "collapsed")}>
        <div className="sidebar-top">
          <Logo compact={collapsed} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button
              type="button"
              key={label}
              className={cn(
                (screen === "dashboard" && label === "Home") ||
                  (screen === "repositories" && label === "Repositories") ||
                  (screen === "settings" && label === "Settings")
                  ? "active"
                  : "",
              )}
              onClick={() =>
                label === "Home"
                  ? setScreen("dashboard")
                  : label === "Repositories"
                    ? setScreen("repositories")
                    : label === "Settings"
                      ? setScreen("settings")
                      : undefined
              }
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="profile">
          <div className="avatar">AC</div>
          <div>
            <strong>Alex Chen</strong>
            <small>Pro detective</small>
          </div>
          <ChevronDown />
        </div>
      </aside>
      <div className="mobile-bar">
        <Logo compact />
        <span>RepoSherlock</span>
        <Button variant="ghost" size="icon">
          <Menu />
        </Button>
      </div>
      <div className="app-main">{children}</div>
      <nav className="bottom-nav">
        {nav.slice(0, 5).map(([label, Icon]) => (
          <button
            type="button"
            key={label}
            onClick={() =>
              label === "Home"
                ? setScreen("dashboard")
                : label === "Repositories"
                  ? setScreen("repositories")
                  : undefined
            }
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Dashboard({
  goRepos,
  goWorkspace,
  repositories,
  issues,
}: {
  goRepos: () => void;
  goWorkspace: () => void;
  repositories: RepositoryView[];
  issues: IssueView[];
}) {
  return (
    <div className="page-wrap dashboard-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THURSDAY · 3 CASES ACTIVE</p>
          <h1>Good to see you, Alex.</h1>
          <p>What are we investigating today?</p>
        </div>
        <div className="header-character">
          <Character mood="coffee" />
        </div>
      </div>
      {issues[0] && (
        <section className="continue-band">
          <div>
            <span className="status-dot" /> RECENT ISSUE<h2>{issues[0].title}</h2>
            <p>
              <strong>Issue #{issues[0].number}</strong> · {issues[0].status}
            </p>
          </div>
          <Button onClick={goWorkspace}>
            Open investigation <ArrowRight />
          </Button>
        </section>
      )}
      <div className="section-title">
        <div>
          <p className="eyebrow">RECENT REPOSITORIES</p>
          <h2>Open a codebase</h2>
        </div>
        <Button variant="ghost" onClick={goRepos}>
          View all <ArrowRight />
        </Button>
      </div>
      <div className="repo-grid compact-grid">
        {repositories.slice(0, 3).map((repo) => (
          <RepositoryCard key={repo.repositoryId} repo={repo} onClick={goRepos} />
        ))}
      </div>
      <div className="dashboard-grid">
        <section>
          <div className="section-title">
            <div>
              <p className="eyebrow">RECENT ISSUES</p>
              <h2>Repository activity</h2>
            </div>
          </div>
          {issues.slice(0, 3).map((issue, i) => (
            <button type="button" className="activity-row" key={issue.number} onClick={goWorkspace}>
              <span className={`activity-icon a${i}`}>
                <Search />
              </span>
              <span>
                <strong>{issue.title}</strong>
                <small>
                  #{issue.number} · {issue.status}
                </small>
              </span>
              <ArrowRight />
            </button>
          ))}
        </section>
        <section className="saved-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">EVIDENCE</p>
              <h2>Build a case</h2>
            </div>
          </div>
          <div className="empty-state compact">
            <div>
              <h3>Evidence appears after an investigation.</h3>
              <p>Select an issue to begin.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function RepositoryCard({ repo, onClick }: { repo: RepositoryView; onClick: () => void }) {
  return (
    <button type="button" className={cn("repo-card", `repo-${repo.color}`)} onClick={onClick}>
      <div className="repo-top">
        <span className="repo-folder">
          <Github />
        </span>
        <Star size={16} />
      </div>
      <small>{repo.owner}</small>
      <h3>{repo.name}</h3>
      <div className="repo-stats">
        <span>
          <i className="lang-dot" />
          {repo.language}
        </span>
        <span>{repo.stars}</span>
        <span>{repo.issues}</span>
      </div>
      <div className="repo-foot">
        <span>{repo.updated}</span>
        <span>{repo.size}</span>
      </div>
    </button>
  );
}

function Repositories({
  repositories,
  loading,
  error,
  onRetry,
  onSelect,
  onBack,
}: {
  repositories: RepositoryView[];
  loading: boolean;
  error?: string | undefined;
  onRetry: () => void;
  onSelect: (repository: RepositoryView) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const filtered = repositories.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.owner.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      activeFilter === "All" ||
      (activeFilter === "Recent" && r.updated === "12 min ago") ||
      (activeFilter === "Pinned" && false);
    return matchesSearch && matchesFilter;
  });
  return (
    <div className="page-wrap">
      <div className="page-heading simple">
        <Button variant="ghost" size="sm" onClick={onBack} className="back-btn">
          <ArrowLeft /> Back
        </Button>
        <div>
          <p className="eyebrow">OPEN A NEW CASE</p>
          <h1>Which codebase are we investigating?</h1>
          <p>Pick a repository and let Sherlock get to work.</p>
        </div>
        <Button>
          <Github /> Connect Repository
        </Button>
      </div>
      <div className="tool-row">
        <div className="search-box">
          <Search />
          <Input
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filters">
          {["All", "Recent", "Pinned"].map((f, i) => (
            <Button
              key={f}
              variant={activeFilter === f ? "secondary" : "ghost"}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </Button>
          ))}
          <Button variant="outline">
            <Layers3 /> Filter
          </Button>
        </div>
      </div>
      {loading ? (
        <EmptyState compact />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : filtered.length > 0 ? (
        <div className="repo-grid">
          {filtered.map((repo) => (
            <RepositoryCard key={repo.repositoryId} repo={repo} onClick={() => onSelect(repo)} />
          ))}
        </div>
      ) : (
        <EmptyState compact />
      )}
    </div>
  );
}

function Indexing({
  repository,
  onDone,
  onCancel,
}: {
  repository: RepositoryView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await apiClient.getIndexStatus(repository.repositoryId);
        if (!active) return;
        setStep(status.status === "completed" ? 5 : 1);
        if (status.status !== "completed" && status.status !== "failed")
          timer = window.setTimeout(poll, 1500);
      } catch (reason) {
        if (active) {
          setError(errorMessage(reason));
          timer = window.setTimeout(poll, 2500);
        }
      }
    };
    void apiClient
      .startIndexing(repository.repositoryId)
      .then(poll)
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [repository.repositoryId]);
  useEffect(() => {
    if (step === 5) {
      onDone();
    }
  }, [step, onDone]);
  const stages = [
    "Repository connected",
    "Reading repository structure",
    "Mapping files",
    "Understanding code relationships",
    "Indexing history",
    "Preparing investigation engine",
  ];
  return (
    <div className="indexing-page">
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="back-btn"
        style={{ position: "absolute", top: 16, left: 16 }}
      >
        <ArrowLeft /> Back
      </Button>
      <div className="indexing-copy">
        <p className="eyebrow">{repository.owner.toUpperCase()}</p>
        <h1>
          Getting to know your codebase<span className="ellipsis">...</span>
        </h1>
        <p>{error ?? "Building a map before we start investigating."}</p>
        <div className="index-stages">
          {stages.map((s, i) => (
            <div className={cn("index-stage", i < step && "done", i === step && "active")} key={s}>
              <span>{i < step ? <Check /> : i === step ? <Search /> : <span />}</span>
              <div>
                <strong>{s}</strong>
                {i === step && (
                  <small>{i === 0 ? "Connecting securely" : "Waiting for backend status"}</small>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="repo-unfold">
        <div className="tree-title">
          <span className="repo-folder">
            <Github />
          </span>
          <div>
            <small>{repository.owner}</small>
            <strong>{repository.name}</strong>
          </div>
        </div>
        <div className="tree-row visible">
          <span>
            <span className="tiny-folder" />
          </span>
          {repository.defaultBranch ?? "Repository index"}
        </div>
        <Character mood="detective" />
      </div>
      {step < 5 && (
        <Button variant="outline" onClick={onCancel} className="cancel-btn">
          Cancel indexing
        </Button>
      )}
    </div>
  );
}

function Issues({
  repository,
  onInvestigate,
  onBack,
}: {
  repository: RepositoryView;
  onInvestigate: (issue: IssueView) => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<number>();
  const [items, setItems] = useState<IssueView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiClient
      .listIssues(repository.repositoryId)
      .then((value) => {
        if (active) {
          setItems(value.map(toIssueView));
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [repository.repositoryId, retry]);
  const filtered = items.filter((issue) => {
    const matchesSearch =
      issue.title.toLowerCase().includes(search.toLowerCase()) ||
      String(issue.number).includes(search);
    const matchesFilter =
      activeFilter === "All" ||
      (activeFilter === "Bug" && issue.labels.includes("bug")) ||
      (activeFilter === "Performance" && issue.labels.includes("performance")) ||
      (activeFilter === "Security" && issue.labels.includes("security")) ||
      (activeFilter === "Open" && issue.status === "Open") ||
      (activeFilter === "Recently Updated" && issue.age === "2 days ago");
    return matchesSearch && matchesFilter;
  });
  return (
    <div className="page-wrap">
      <div className="page-heading simple">
        <Button variant="ghost" size="sm" onClick={onBack} className="back-btn">
          <ArrowLeft /> Back
        </Button>
        <div>
          <p className="eyebrow">PAYMENTS-SERVICE · 31 OPEN ISSUES</p>
          <h1>What's the mystery?</h1>
          <p>Pick an issue and let Sherlock investigate it.</p>
        </div>
      </div>
      <div className="tool-row">
        <div className="search-box">
          <Search />
          <Input
            placeholder="Search issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filters">
          {["All", "Open", "Recently Updated", "Bug", "Performance", "Security"].map((f) => (
            <Button
              key={f}
              variant={activeFilter === f ? "secondary" : "ghost"}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>
      {loading ? (
        <EmptyState compact />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(undefined);
            setRetry((value) => value + 1);
          }}
        />
      ) : filtered.length > 0 ? (
        <div className="issue-list">
          {filtered.map((issue) => (
            <div
              role="button"
              tabIndex={0}
              key={issue.number}
              className={cn("issue-card", selected === issue.number && "selected")}
              onClick={() => setSelected(issue.number)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(issue.number);
                }
              }}
            >
              <span className="issue-radio">{selected === issue.number && <i />}</span>
              <div className="issue-main">
                <div>
                  <span className="issue-number">#{issue.number}</span>
                  <span className="status-label">
                    <CircleDot /> {issue.status}
                  </span>
                </div>
                <h3>{issue.title}</h3>
                <div className="labels">
                  {issue.labels.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </div>
                <small>
                  Updated {issue.age} by {issue.author} · {issue.comments} comments
                </small>
              </div>
              {selected === issue.number && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onInvestigate(issue);
                  }}
                >
                  INVESTIGATE <Search />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState compact />
      )}
    </div>
  );
}

function Investigating({
  investigationId,
  onDone,
}: {
  investigationId: string;
  onDone: (result: ApiInvestigation) => void;
}) {
  const [status, setStatus] = useState<InvestigationStatus>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await apiClient.getInvestigationStatus(investigationId);
        if (!active) return;
        setStatus(next);
        if (next.status === "completed") {
          onDone(await apiClient.getInvestigation(investigationId));
          return;
        }
        if (next.status === "failed" || next.status === "timeout") {
          setError(next.failureCode ?? "Sherlock hit a dead end.");
          return;
        }
        timer = window.setTimeout(poll, 1500);
      } catch (reason) {
        if (active) {
          setError(errorMessage(reason));
          timer = window.setTimeout(poll, 2500);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [investigationId, onDone]);
  const step = Math.max(0, stageOrder.indexOf(status?.currentStage ?? "understanding_issue"));
  return (
    <div className="investigating-page">
      <div className="investigation-orbit">
        <div className="orbit-ring ring-one" />
        <div className="orbit-ring ring-two" />
        <div className="center-lens">
          <Search />
        </div>
        {[Code2, GitBranch, CircleDot, History].map((Icon, i) => (
          <span key={i} className={`orbit-node n${i}`}>
            <Icon />
          </span>
        ))}
      </div>
      <div className="investigating-heading">
        <p className="eyebrow">INVESTIGATION · {status?.progress ?? 0}%</p>
        <h1>{error ? "Sherlock hit a dead end." : "Sherlock is investigating..."}</h1>
        <p>{error ?? "Following real backend stages and verified repository evidence."}</p>
        {error && <Button onClick={() => window.location.reload()}>Retry</Button>}
      </div>
      <div className="investigation-stages">
        {investigationStages.map(([num, title, activity], i) => (
          <div
            key={num}
            className={cn(
              "investigation-stage",
              i < step && "done",
              i === step && !error && "active",
            )}
          >
            <span>{i < step ? <Check /> : num}</span>
            <div>
              <strong>{title}</strong>
              {i === step && !error && <small>{status?.currentStage ?? activity}</small>}
            </div>
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfidenceIndicator() {
  return (
    <div className="confidence">
      <div className="confidence-ring">
        <strong>87</strong>
        <span>%</span>
      </div>
      <div>
        <strong>High confidence</strong>
        <small>Evidence-backed hypothesis</small>
      </div>
    </div>
  );
}

const workspaceNav: Array<[WorkspaceTab, string, LucideIcon]> = [
  ["overview", "Overview", Search],
  ["graph", "Evidence map", Network],
  ["code", "Code path", Code2],
  ["history", "Git history", History],
  ["impact", "Blast radius", Zap],
  ["plan", "Fix plan", BookOpen],
];
function Workspace({
  tab,
  setTab,
  openEvidence,
  result,
  evidence,
}: {
  tab: WorkspaceTab;
  setTab: (t: WorkspaceTab) => void;
  openEvidence: () => void;
  result: ApiInvestigation;
  evidence: EvidenceView[];
}) {
  const title = resultSummary(result) || `Investigation for issue #${result.issueNumber ?? ""}`;
  return (
    <div className="workspace">
      <header className="workspace-header">
        <div>
          <div className="crumbs">
            <span>{result.repositoryId}</span>
            <span>/</span>
            <span>Issue #{result.issueNumber}</span>
          </div>
          <h1>{title}</h1>
        </div>
        <div className="workspace-status">
          <span>
            <Check /> Investigation complete
          </span>
          <ConfidenceIndicator />
        </div>
      </header>
      <div className="workspace-body">
        <aside className="case-nav">
          <p>INVESTIGATION</p>
          {workspaceNav.map(([id, label, Icon]) => (
            <button
              type="button"
              key={id}
              className={tab === id ? "active" : ""}
              aria-label={label}
              title={label}
              onClick={() => setTab(id)}
            >
              <Icon className="nav-icon" />
              <span>{label}</span>
            </button>
          ))}
          <div className="philosophy">
            <Sparkles />
            <span>
              Understand first.
              <br />
              Code second.
            </span>
          </div>
        </aside>
        <main className="case-content">
          {tab === "overview" && (
            <Overview
              openEvidence={openEvidence}
              setTab={setTab}
              result={result}
              evidence={evidence}
            />
          )}{" "}
          {tab === "graph" && <EvidenceGraph evidence={evidence} />}{" "}
          {tab === "code" && <CodeView evidence={evidence} />}{" "}
          {tab === "history" && <GitTimeline evidence={evidence} />}{" "}
          {tab === "impact" && <ImpactGraph />} {tab === "plan" && <FixPlan />}
        </main>
        <aside className="context-panel">
          <div className="context-head">
            <div>
              <p className="eyebrow">EVIDENCE STACK</p>
              <h3>{evidence.length} verified sources</h3>
            </div>
            <ShieldCheck />
          </div>
          {evidence.length ? (
            evidence.map((ev) => (
              <EvidenceCard key={ev.id} ev={ev} compact onClick={openEvidence} />
            ))
          ) : (
            <EmptyState compact />
          )}
          <Button variant="outline" onClick={openEvidence}>
            Inspect all evidence <ArrowRight />
          </Button>
        </aside>
      </div>
    </div>
  );
}

function Overview({
  openEvidence,
  setTab,
  result,
  evidence,
}: {
  openEvidence: () => void;
  setTab: (t: WorkspaceTab) => void;
  result: ApiInvestigation;
  evidence: EvidenceView[];
}) {
  const claim = Array.isArray(result.result?.["claims"])
    ? (result.result["claims"][0] as { text?: string } | undefined)
    : undefined;
  return (
    <div className="overview animate-enter">
      <section className="question-block">
        <p className="eyebrow">INVESTIGATION RESULT</p>
        <h2>{resultSummary(result) || `Issue #${result.issueNumber}`}</h2>
      </section>
      <section className="hypothesis-card">
        <div className="hypothesis-top">
          <span>
            <Search /> EVIDENCE-BACKED HYPOTHESIS
          </span>
          <ConfidenceIndicator />
        </div>
        <h2>{claim?.text ?? "The investigation returned no hypothesis."}</h2>
        <p>
          {evidence.length
            ? "This conclusion is linked to resolved repository provenance."
            : "No resolved evidence was returned."}
        </p>
        <div className="hypothesis-actions">
          <Button size="lg" onClick={openEvidence} disabled={!evidence.length}>
            WHY? <ArrowRight />
          </Button>
          <span>
            {evidence.length} verified source{evidence.length === 1 ? "" : "s"}
          </span>
        </div>
      </section>
      <div className="finding-grid">
        <button type="button" onClick={() => setTab("code")}>
          <span className="finding-icon blue">
            <Code2 />
          </span>
          <small>RELEVANT FILES</small>
          <strong>
            {evidence.filter((item) => item.kind.includes("FILE")).length} source files
          </strong>
          <p>Resolved source provenance</p>
          <ArrowRight />
        </button>
        <button type="button" onClick={() => setTab("history")}>
          <span className="finding-icon violet">
            <History />
          </span>
          <small>HISTORICAL CONTEXT</small>
          <strong>{evidence.filter((item) => item.kind.includes("COMMIT")).length} commits</strong>
          <p>Resolved history provenance</p>
          <ArrowRight />
        </button>
        <button type="button" onClick={() => setTab("impact")}>
          <span className="finding-icon coral">
            <Zap />
          </span>
          <small>IMPACT</small>
          <strong>Not available</strong>
          <p>No impact data returned</p>
          <ArrowRight />
        </button>
        <button type="button" onClick={() => setTab("plan")}>
          <span className="finding-icon mint">
            <BookOpen />
          </span>
          <small>FIX PLAN</small>
          <strong>Not available</strong>
          <p>No fix plan data returned</p>
          <ArrowRight />
        </button>
      </div>
      <section className="understanding">
        <p className="eyebrow">PROBLEM UNDERSTANDING</p>
        <h2>{resultSummary(result) || "No investigation summary was returned."}</h2>
        <p>
          {evidence.length
            ? "Inspect WHY to verify every conclusion against its source provenance."
            : "The backend returned no evidence for this investigation."}
        </p>
      </section>
    </div>
  );
}

function EvidenceCard({
  ev,
  compact,
  onClick,
}: {
  ev: EvidenceView;
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("evidence-card", `evidence-${ev.accent}`, compact && "compact")}
      onClick={onClick}
    >
      <div className="evidence-top">
        <span>Evidence {ev.id}</span>
        <span>{ev.kind}</span>
      </div>
      <h3>{ev.name}</h3>
      <small>
        {ev.locator} · {ev.time}
      </small>
      <blockquote>"{ev.excerpt}"</blockquote>
      {!compact && (
        <>
          <div className="relation">
            <GitBranch /> {ev.relation}
          </div>
          <div className="evidence-action">
            Inspect provenance
            <ArrowRight />
          </div>
        </>
      )}
    </button>
  );
}

function EvidenceDetailModal({ ev, onClose }: { ev: EvidenceView | null; onClose: () => void }) {
  if (!ev) return null;
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <div className="evidence-detail-modal">
        <header>
          <div>
            <p className="eyebrow">EVIDENCE DETAIL</p>
            <h2>{ev.name}</h2>
            <small>
              {ev.kind} · {ev.locator}
            </small>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="evidence-detail-body">
          <div className="detail-meta">
            <ShieldCheck />
            <strong>{ev.time}</strong>
            <span>{ev.relation}</span>
          </div>
          <blockquote>"{ev.excerpt}"</blockquote>
          <div className="detail-sections">
            <div className="detail-section">
              <p className="eyebrow">CONTEXT</p>
              <p>
                This {ev.kind.toLowerCase()} was identified as a key piece of evidence during the
                investigation of Issue #1842. It supports the root-cause hypothesis that
                acknowledgement occurs after downstream processing.
              </p>
            </div>
            <div className="detail-section">
              <p className="eyebrow">VERIFICATION</p>
              <p>
                Cross-referenced with{" "}
                {ev.id === "01"
                  ? "commit 8f3a21c and Issue #1742"
                  : ev.id === "02"
                    ? "source file PaymentWebhookHandler.ts line 184 and Issue #1742"
                    : "related commits including 8f3a21c and source file evidence"}
                .
              </p>
            </div>
          </div>
          <div className="detail-actions">
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                alert("Opening in code viewer mock...");
              }}
            >
              <Code2 /> View source
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                alert("Opening in git history mock...");
              }}
            >
              <History /> View history
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EvidenceDrawer({
  open,
  onClose,
  evidence,
}: {
  open: boolean;
  onClose: () => void;
  evidence: EvidenceView[];
}) {
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceView | null>(null);
  return (
    <>
      <div className={cn("drawer-backdrop", open && "open")} onClick={onClose} />
      <aside className={cn("evidence-drawer", open && "open")} aria-hidden={!open}>
        <header>
          <div>
            <p className="eyebrow">EVIDENCE PROVENANCE</p>
            <h2>Why does Sherlock believe this?</h2>
            <p>Three independent sources support the hypothesis.</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close evidence" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="drawer-confidence">
          <ConfidenceIndicator />
          <p>Strong agreement across code, history, and issue context.</p>
        </div>
        <div className="drawer-cards">
          {evidence.length ? (
            evidence.map((ev) => (
              <EvidenceCard key={ev.id} ev={ev} onClick={() => setSelectedEvidence(ev)} />
            ))
          ) : (
            <EmptyState compact />
          )}
        </div>
        <p className="drawer-note">
          <ShieldCheck /> Every claim stays linked to its source so you can verify it yourself.
        </p>
        {selectedEvidence && (
          <EvidenceDetailModal ev={selectedEvidence} onClose={() => setSelectedEvidence(null)} />
        )}
      </aside>
    </>
  );
}

function EvidenceGraph({ evidence }: { evidence: EvidenceView[] }) {
  const [active, setActive] = useState(0);
  const nodes = evidence.map((item, index) => ({
    id: item.id,
    label: item.name,
    sub: item.locator,
    x: `${18 + (index % 3) * 32}%`,
    y: `${22 + (index % 2) * 52}%`,
    icon: item.kind.includes("COMMIT")
      ? GitBranch
      : item.kind.includes("ISSUE")
        ? CircleDot
        : Code2,
  }));
  return (
    <div className="graph-page animate-enter">
      <div className="content-title">
        <p className="eyebrow">EVIDENCE MAP</p>
        <h2>How did Sherlock arrive here?</h2>
        <p>Select a verified source to inspect its provenance.</p>
      </div>
      <div className="evidence-graph">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M50 48 L18 27 M50 48 L76 24 M50 48 L80 66" />
          <path className="pulse-edge" d="M18 27 L76 24 M76 24 L80 66" />
        </svg>
        <div className="root-node">
          <span>INVESTIGATION</span>
          <strong>Evidence-backed result</strong>
        </div>
        {nodes.map((n, index) => (
          <button
            type="button"
            key={n.id}
            style={{ left: n.x, top: n.y }}
            className={cn("graph-node", active === index && "active")}
            onClick={() => setActive(index)}
          >
            <n.icon />
            <span>
              <strong>{n.label}</strong>
              <small>{n.sub}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="graph-detail">
        <ShieldCheck />
        <div>
          <small>SELECTED EVIDENCE</small>
          <strong>{nodes[active]?.label ?? "No evidence"}</strong>
          <p>{evidence[active]?.excerpt ?? "No evidence was returned."}</p>
        </div>
      </div>
    </div>
  );
}

function CodeView({ evidence }: { evidence: EvidenceView[] }) {
  const [file, setFile] = useState("payment.ts");
  const files = evidence.filter((item) => item.kind.includes("FILE")).map((item) => item.name);
  const selected =
    evidence.find((item) => item.name === file) ??
    evidence.find((item) => item.kind.includes("FILE"));
  return (
    <div className="code-page animate-enter">
      <div className="content-title">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => alert("Closing code view...")}
          className="back-btn"
        >
          <ArrowLeft /> Back
        </Button>
        <div>
          <p className="eyebrow">CODE PATH · PRIMARY EVIDENCE</p>
          <h2>{selected?.name ?? "No source file evidence"}</h2>
          <p>{selected?.locator ?? "The investigation returned no source file."}</p>
        </div>
      </div>
      <div className="code-window">
        <div className="code-toolbar">
          <div>
            <span />
            <span />
            <span />
          </div>
          <nav className="code-file-nav">
            {files.map((f) => (
              <button
                key={f}
                type="button"
                className={cn("code-file-tab", file === f && "active")}
                onClick={() => setFile(f)}
              >
                {f}
              </button>
            ))}
          </nav>
          <Button size="sm" variant="outline">
            Verified evidence
          </Button>
        </div>
        {selected ? (
          <pre>
            {selected.excerpt.split(/\r?\n/).map((line, i) => (
              <div key={i} className="highlighted">
                <span className="line-number">{i + 1}</span>
                <code>{line || " "}</code>
              </div>
            ))}
          </pre>
        ) : (
          <EmptyState compact />
        )}
      </div>
      <section className="why-file">
        <span className="finding-icon blue">
          <Code2 />
        </span>
        <div>
          <p className="eyebrow">WHY THIS FILE MATTERS</p>
          <h3>{selected?.name ?? "No source file returned"}</h3>
          <p>{selected?.relation ?? "The backend returned no source file evidence."}</p>
        </div>
      </section>
    </div>
  );
}

function GitTimeline({ evidence }: { evidence: EvidenceView[] }) {
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const detail = evidence.map((item) => [item.kind, item.excerpt, item.locator]);
  return (
    <div className="history-page animate-enter">
      <div className="content-title">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => alert("Closing history view...")}
          className="back-btn"
        >
          <ArrowLeft /> Back
        </Button>
        <div>
          <p className="eyebrow">HISTORICAL CONTEXT</p>
          <h2>The code remembers what the issue forgot.</h2>
          <p>A focused timeline of changes related to this behavior.</p>
        </div>
      </div>
      <div className="git-timeline">
        {detail.map(([label, desc, date], i) => (
          <button
            type="button"
            key={`${label}-${i}`}
            onClick={() => setSelectedEvent(selectedEvent === i ? null : i)}
            className={cn("timeline-item", selectedEvent === i && "selected")}
          >
            <span className={cn("timeline-dot", i === detail.length - 1 && "current")}>
              {(label ?? "").includes("COMMIT") ? <GitBranch /> : <CircleDot />}
            </span>
            <div>
              <small>{date}</small>
              <h3>{label}</h3>
              <strong>{date}</strong>
              <p>{desc}</p>
            </div>
            <ArrowRight />
          </button>
        ))}
      </div>
      {selectedEvent !== null && (
        <div className="timeline-detail-panel">
          <ShieldCheck />
          <div>
            <p className="eyebrow">DETAIL</p>
            <h3>{detail[selectedEvent]?.[0]}</h3>
            <p>{detail[selectedEvent]?.[1]}</p>
            <p>
              <small>Click anywhere outside to close.</small>
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSelectedEvent(null)}>
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}

function ImpactGraph() {
  return (
    <div className="impact-page animate-enter">
      <div className="content-title">
        <p className="eyebrow">BLAST RADIUS</p>
        <h2>No impact data returned</h2>
        <p>The backend investigation did not provide a verified impact graph.</p>
      </div>
      <EmptyState compact />
    </div>
  );
}

function FixPlan() {
  return (
    <div className="plan-page animate-enter">
      <div className="content-title">
        <p className="eyebrow">STRUCTURED FIX PLAN</p>
        <h2>No fix plan returned</h2>
        <p>The backend investigation did not provide a verified implementation plan.</p>
      </div>
      <EmptyState compact />
    </div>
  );
}

function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [saved, setSaved] = useState(false);
  const tabs: [SettingsTab, string][] = [
    ["profile", "Profile"],
    ["appearance", "Appearance"],
    ["investigation", "Investigation"],
    ["notifications", "Notifications"],
    ["plan", "Plan & usage"],
  ];
  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return (
    <div className="page-wrap settings-page">
      <div className="page-heading simple">
        <div>
          <p className="eyebrow">PERSONALIZATION</p>
          <h1>Make Sherlock yours.</h1>
          <p>Adjust your workspace without losing its investigative character.</p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-tabs">
          {tabs.map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={cn("settings-tab", activeTab === id && "active")}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </aside>
        <main className="settings-main">
          {activeTab === "profile" && (
            <section>
              <h2>Detective profile</h2>
              <div className="profile-editor">
                <div className="avatar big">AC</div>
                <Button
                  variant="outline"
                  onClick={() => alert("Avatar picker modal would open here in full product.")}
                >
                  Change avatar
                </Button>
              </div>
              <div className="form-grid">
                <label>
                  Display name
                  <Input defaultValue="Alex Chen" />
                </label>
                <label>
                  Preferred language
                  <select defaultValue="English">
                    <option>English</option>
                    <option>Spanish</option>
                    <option>German</option>
                  </select>
                </label>
              </div>
            </section>
          )}
          {activeTab === "appearance" && (
            <section>
              <h2>Workspace appearance</h2>
              <SettingRow title="Code theme" text="Syntax palette for evidence excerpts">
                <select defaultValue="Sherlock Light">
                  <option>Sherlock Light</option>
                  <option>Midnight Case</option>
                </select>
              </SettingRow>
              <SettingRow title="Density" text="How compact your investigation workspace feels">
                <div className="segmented">
                  <button>Comfortable</button>
                  <button className="active" onClick={() => alert("Compact density applied.")}>
                    Compact
                  </button>
                </div>
              </SettingRow>
              <SettingRow title="Animation level" text="Control motion and character reactions">
                <input
                  type="range"
                  min="0"
                  max="2"
                  defaultValue="1"
                  aria-label="Animation level"
                  onChange={(e) => alert(`Animation level set to ${e.target.value}`)}
                />
              </SettingRow>
              <SettingRow title="Evidence view" text="Default format when opening provenance">
                <select>
                  <option>Evidence stack</option>
                  <option>Evidence map</option>
                </select>
              </SettingRow>
            </section>
          )}
          {activeTab === "investigation" && (
            <section>
              <h2>Investigation defaults</h2>
              <SettingRow
                title="Default repository"
                text="Start new investigations from this codebase"
              >
                <select>
                  <option>payments-service</option>
                  <option>identity-gateway</option>
                </select>
              </SettingRow>
              <SettingRow
                title="Auto-investigate on connect"
                text="Begin indexing immediately after connecting a repository"
              >
                <button
                  className="switch active"
                  onClick={(e: React.MouseEvent) => {
                    const el = e.currentTarget;
                    el.classList.toggle("active");
                    alert(
                      el.classList.contains("active")
                        ? "Auto-investigate enabled."
                        : "Auto-investigate disabled.",
                    );
                  }}
                >
                  <i />
                </button>
              </SettingRow>
              <SettingRow
                title="Evidence confidence threshold"
                text="Minimum confidence to surface a hypothesis"
              >
                <select>
                  <option>High (≥80%)</option>
                  <option>Medium (≥60%)</option>
                  <option>Low (≥40%)</option>
                </select>
              </SettingRow>
            </section>
          )}
          {activeTab === "notifications" && (
            <section>
              <h2>Notifications</h2>
              <SettingRow
                title="Investigation complete"
                text="Notify when a mock investigation finishes"
              >
                <button
                  className="switch active"
                  onClick={(e: React.MouseEvent) => {
                    const el = e.currentTarget;
                    el.classList.toggle("active");
                    alert(
                      el.classList.contains("active")
                        ? "Notification enabled."
                        : "Notification disabled.",
                    );
                  }}
                >
                  <i />
                </button>
              </SettingRow>
              <SettingRow
                title="New evidence found"
                text="Alert when new evidence appears mid-investigation"
              >
                <button
                  className="switch"
                  onClick={(e: React.MouseEvent) => {
                    const el = e.currentTarget;
                    el.classList.toggle("active");
                    alert(el.classList.contains("active") ? "Alert enabled." : "Alert disabled.");
                  }}
                >
                  <i />
                </button>
              </SettingRow>
              <SettingRow
                title="Digest frequency"
                text="How often you receive investigation summaries"
              >
                <select>
                  <option>Daily</option>
                  <option>Weekly</option>
                  <option>Never</option>
                </select>
              </SettingRow>
            </section>
          )}
          {activeTab === "plan" && (
            <section>
              <h2>Plan & usage</h2>
              <div className="plan-info">
                <div className="plan-badge">Pro Detective</div>
                <p>
                  You are on the <strong>Pro plan</strong> (mock). Unlimited investigations.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => alert("Pricing modal is coming soon.")}
                >
                  <Sparkles /> View plans
                </Button>
              </div>
              <div className="usage-bars">
                <div>
                  <span>Investigations used</span>
                  <span>3 / ∞</span>
                </div>
                <div className="usage-bar">
                  <i style={{ width: "15%" }} />
                </div>
              </div>
            </section>
          )}
          <div className="settings-save-area">
            {saved ? (
              <p className="save-feedback">
                <Check /> Preferences saved
              </p>
            ) : (
              <Button size="lg" onClick={handleSave}>
                Save preferences
              </Button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
function SettingRow({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ compact = false }: { compact?: boolean }) {
  return (
    <section className={cn("empty-state", compact && "compact")}>
      <div className="empty-visual">
        <Character mood="curious" />
      </div>
      <div>
        <h3>No data available.</h3>
        <p>The backend has not returned anything for this view yet.</p>
      </div>
    </section>
  );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="empty-state compact">
      <div>
        <h3>Something interrupted the investigation.</h3>
        <p>{message}</p>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </section>
  );
}

function HowItWorks({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  const steps = [
    {
      icon: Search,
      title: "Select a repository",
      desc: "Pick the GitHub repo you want to investigate. RepoSherlock reads only what it needs.",
    },
    {
      icon: Boxes,
      title: "Index the codebase",
      desc: "Builds a map of files, relationships, and history — no code changes, read-only access.",
    },
    {
      icon: CircleDot,
      title: "Choose an issue",
      desc: "Link the investigation to a real problem — bug, regression, or performance concern.",
    },
    {
      icon: Zap,
      title: "Sherlock investigates",
      desc: "Traces execution paths, compares commits, correlates issues — all using mock evidence.",
    },
    {
      icon: ShieldCheck,
      title: "Get evidence-backed brief",
      desc: "See the root-cause hypothesis with sourced evidence, blast radius, and a fix plan.",
    },
  ];
  return (
    <div className="how-it-works-page">
      <Button variant="ghost" size="sm" onClick={onBack} className="back-btn">
        <ArrowLeft /> Back
      </Button>
      <div className="hiw-hero">
        <Logo />
        <h1>How RepoSherlock works</h1>
        <p className="hiw-sub">
          Four phases, zero guesswork. See the reasoning behind every conclusion.
        </p>
      </div>
      <div className="hiw-steps">
        {steps.map((s, i) => (
          <div key={s.title} className={cn("hiw-step", i === 0 && "first")}>
            <div className="hiw-step-num">{String(i + 1).padStart(2, "0")}</div>
            <div className="hiw-step-icon">
              <s.icon />
            </div>
            <div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
            {i < 4 && <ArrowRight className="hiw-arrow" />}
          </div>
        ))}
      </div>
      <div className="hiw-footer">
        <Character mood="detective" />
        <div>
          <h2>Ready to investigate?</h2>
          <p>Sign in and start your first case.</p>
          <Button size="lg" onClick={onStart}>
            Start Investigating <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PricingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <div className="pricing-modal">
        <header>
          <div>
            <p className="eyebrow">COMING SOON</p>
            <h2>More mysteries. More evidence.</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="plans">
          {[
            ["Free", "$0", "3 investigations / month"],
            ["Pro", "$19", "Unlimited personal investigations"],
            ["Team", "$49", "Shared evidence and team workflows"],
          ].map((p, i) => (
            <article className={i === 1 ? "featured" : ""} key={p[0]}>
              {i === 1 && <span className="popular">MOST CURIOUS</span>}
              <h3>{p[0]}</h3>
              <strong>
                {p[1]}
                <small>/mo</small>
              </strong>
              <p>{p[2]}</p>
              <ul>
                <li>
                  <Check />
                  Evidence provenance
                </li>
                <li>
                  <Check />
                  Code and history maps
                </li>
                <li>
                  <Check />
                  {i === 0 ? "Community support" : "Priority investigations"}
                </li>
              </ul>
              <Button
                variant={i === 1 ? "default" : "outline"}
                onClick={() => alert(`Switching to ${p[0]} plan is coming soon — prototype only.`)}
              >
                {i === 0 ? "Current plan" : "Choose plan"}
              </Button>
            </article>
          ))}
        </div>
        <p className="mock-note">Prototype only · No payment will be processed.</p>
      </div>
    </div>
  );
}

export function RepoSherlockApp() {
  const [screen, setScreen] = useState<Screen>("entry");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [drawer, setDrawer] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryView[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [repositoriesError, setRepositoriesError] = useState<string>();
  const [selectedRepository, setSelectedRepository] = useState<RepositoryView>();
  const [issues, setIssues] = useState<IssueView[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<IssueView>();
  const [investigationId, setInvestigationId] = useState<string>();
  const [investigationResult, setInvestigationResult] = useState<ApiInvestigation>();
  const [investigationEvidence, setInvestigationEvidence] = useState<EvidenceView[]>([]);
  const [appError, setAppError] = useState<string>();
  useEffect(() => {
    if (
      (screen === "dashboard" || screen === "repositories") &&
      !repositories.length &&
      !repositoriesLoading
    ) {
      setRepositoriesLoading(true);
      void apiClient
        .listRepositories()
        .then((items) => setRepositories(items.map(toRepositoryView)))
        .catch((reason) => setRepositoriesError(errorMessage(reason)))
        .finally(() => setRepositoriesLoading(false));
    }
  }, [screen, repositories.length, repositoriesLoading]);
  const selectRepository = (repository: RepositoryView) => {
    setSelectedRepository(repository);
    setScreen("indexing");
  };
  const selectIssue = useCallback(
    async (issue: IssueView) => {
      if (!selectedRepository) return;
      setSelectedIssue(issue);
      try {
        const created = await apiClient.createInvestigation(
          selectedRepository.repositoryId,
          issue.number,
        );
        setInvestigationId(created.investigationId);
        setScreen("investigating");
      } catch (reason) {
        setAppError(errorMessage(reason));
      }
    },
    [selectedRepository],
  );
  const completeInvestigation = async (result: ApiInvestigation) => {
    setInvestigationResult(result);
    try {
      const items = await apiClient.listEvidence(result.investigationId);
      setInvestigationEvidence(items.map(toEvidenceView));
    } catch {
      setInvestigationEvidence(resultEvidence(result));
    }
    setScreen("workspace");
  };
  const inApp = !(["entry", "login", "indexing", "investigating"] as Screen[]).includes(screen);
  const content = useMemo(() => {
    switch (screen) {
      case "entry":
        return <Entry onStart={() => setScreen("login")} onHow={() => setScreen("how-it-works")} />;
      case "login":
        return (
          <Login
            onBack={() => setScreen("entry")}
            onSuccess={() => {
              setAppError(undefined);
              setScreen("dashboard");
            }}
            onError={setAppError}
          />
        );
      case "how-it-works":
        return <HowItWorks onBack={() => setScreen("entry")} onStart={() => setScreen("login")} />;
      case "dashboard":
        return (
          <>
            {appError && <ErrorState message={appError} onRetry={() => setAppError(undefined)} />}
            <Dashboard
              repositories={repositories}
              issues={issues}
              goRepos={() => setScreen("repositories")}
              goWorkspace={() => setScreen("repositories")}
            />
          </>
        );
      case "repositories":
        return (
          <Repositories
            repositories={repositories}
            loading={repositoriesLoading}
            error={repositoriesError}
            onRetry={() => {
              setRepositoriesError(undefined);
              setRepositories([]);
            }}
            onSelect={selectRepository}
            onBack={() => setScreen("dashboard")}
          />
        );
      case "indexing":
        return selectedRepository ? (
          <Indexing
            repository={selectedRepository}
            onDone={() => setScreen("issues")}
            onCancel={() => setScreen("repositories")}
          />
        ) : (
          <EmptyState />
        );
      case "issues":
        return selectedRepository ? (
          <Issues
            repository={selectedRepository}
            onInvestigate={selectIssue}
            onBack={() => setScreen("repositories")}
          />
        ) : (
          <EmptyState />
        );
      case "investigating":
        return investigationId ? (
          <Investigating investigationId={investigationId} onDone={completeInvestigation} />
        ) : (
          <EmptyState />
        );
      case "workspace":
        return investigationResult ? (
          <Workspace
            result={investigationResult}
            evidence={investigationEvidence}
            tab={tab}
            setTab={setTab}
            openEvidence={() => setDrawer(true)}
          />
        ) : (
          <EmptyState />
        );
      case "settings":
        return <SettingsPage />;
      default:
        return null;
    }
  }, [
    screen,
    tab,
    repositories,
    repositoriesLoading,
    repositoriesError,
    selectedRepository,
    issues,
    investigationId,
    investigationResult,
    investigationEvidence,
    appError,
    selectIssue,
  ]);
  return (
    <>
      {inApp ? (
        <AppShell screen={screen} setScreen={setScreen}>
          {content}
          <button className="pricing-chip" type="button" onClick={() => setPricing(true)}>
            <Sparkles /> Plans
          </button>
        </AppShell>
      ) : (
        content
      )}
      <EvidenceDrawer
        evidence={investigationEvidence}
        open={drawer}
        onClose={() => setDrawer(false)}
      />
      <PricingModal open={pricing} onClose={() => setPricing(false)} />
    </>
  );
}
