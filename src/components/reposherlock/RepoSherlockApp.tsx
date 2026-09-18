import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bell, BookOpen, Boxes, Braces, Check,
  ChevronDown, CircleDot, Clock3, Code2, Coffee, GitBranch, Github, History,
  Home, Layers3, LockKeyhole, Menu, Network, PanelLeftClose, PanelLeftOpen,
  Search, Settings, ShieldCheck, Sparkles, Star, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { codeLines, evidence, investigationStages, issues, repositories } from "./mock-data";

type Screen = "entry" | "login" | "dashboard" | "repositories" | "indexing" | "issues" | "investigating" | "workspace" | "settings";
type WorkspaceTab = "overview" | "graph" | "code" | "history" | "impact" | "plan";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-2.5"><span className="logo-mark"><Search size={18} strokeWidth={2.8} /></span>{!compact && <span className="text-lg font-extrabold tracking-tight">RepoSherlock</span>}</div>;
}

function Character({ mood = "curious", className }: { mood?: "curious" | "sleepy" | "detective" | "coffee" | "shy" | "oops" | "happy"; className?: string }) {
  const eyesCovered = mood === "shy";
  return (
    <div className={cn("character", `character-${mood}`, className)} aria-label={`${mood} developer illustration`}>
      <div className="character-hair" />
      <div className="character-head">
        <div className="character-glasses"><i /><i /></div>
        {eyesCovered && <div className="character-hands"><i /><i /></div>}
        <div className="character-mouth" />
      </div>
      <div className="character-body"><span>{mood === "coffee" ? "☕" : mood === "detective" ? "⌕" : "{ }"}</span></div>
      <div className="character-laptop">RS<span /></div>
    </div>
  );
}

function Entry({ onStart, onHow }: { onStart: () => void; onHow: () => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <main className="entry-scene" onPointerMove={(e) => setPos({ x: (e.clientX / innerWidth - .5) * 16, y: (e.clientY / innerHeight - .5) * 10 })}>
      <header className="entry-nav"><Logo /><span className="mini-proof"><ShieldCheck size={14} /> Mock prototype · No repository access</span></header>
      <div className="software-sky" aria-hidden="true" style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}>
        <div className="sky-path path-a" /><div className="sky-path path-b" />
        <div className="float-object folder one"><span>src</span><small>42 files</small></div>
        <div className="float-object issue two"><CircleDot size={15}/><span>#1842</span></div>
        <div className="float-object code three"><Braces size={20}/><span>webhook.ts</span></div>
        <div className="float-object commit four"><GitBranch size={18}/><span>8f3a21c</span></div>
        <div className="float-object pull five"><GitBranch size={16}/><span>PR #892</span></div>
        <div className="float-object folder six"><span>payments</span><small>18 files</small></div>
      </div>
      <section className="entry-copy">
        <p className="eyebrow"><Sparkles size={15} /> Investigate first. Code second.</p>
        <h1>Meet <span>RepoSherlock.</span></h1>
        <p className="entry-sub">Investigate the codebase before you touch the code.</p>
        <div className="entry-actions"><Button size="lg" onClick={onStart}>Start Investigating <ArrowRight /></Button><Button size="lg" variant="outline" onClick={onHow}>See how it works</Button></div>
        <p className="credibility"><ShieldCheck size={16}/> Evidence-backed investigation for GitHub repositories.</p>
      </section>
      <div className="entry-character"><Character mood="detective" /></div>
      <div className="process-ribbon"><span>INVESTIGATE</span><ArrowRight/><span>UNDERSTAND</span><ArrowRight/><span>VERIFY</span><ArrowRight/><span>ACT</span></div>
    </main>
  );
}

function Login({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [state, setState] = useState<"normal" | "loading" | "error" | "success">("normal");
  const [email, setEmail] = useState("alex@acme.dev");
  const signIn = async () => { setState("loading"); await wait(1200); setState("success"); await wait(650); onSuccess(); };
  return <main className="login-scene">
    <Button variant="ghost" className="back-button" onClick={onBack}><ArrowLeft/> Back</Button>
    <div className="login-cast" aria-hidden="true">
      <Character mood={passwordFocus ? "shy" : state === "error" ? "oops" : state === "success" ? "happy" : "curious"} className="cast-one" />
      <Character mood={passwordFocus ? "shy" : "sleepy"} className="cast-two" />
      <Character mood={passwordFocus ? "shy" : state === "loading" ? "detective" : "coffee"} className="cast-three" />
      <Character mood={passwordFocus ? "shy" : "detective"} className="cast-four" />
    </div>
    <section className="login-card">
      <Logo/><p className="eyebrow">YOUR INVESTIGATION DESK</p><h1>Welcome back, detective.</h1><p>There are mysteries waiting in the codebase.</p>
      <Button className="github-button" size="lg" onClick={signIn} disabled={state === "loading"}><Github /> Continue with GitHub</Button>
      <div className="divider"><span>or</span></div>
      <label>Email<Input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" /></label>
      <label>Password<Input type="password" defaultValue="evidencefirst" onFocus={()=>setPasswordFocus(true)} onBlur={()=>setPasswordFocus(false)} /></label>
      {state === "error" && <p className="form-error"><AlertTriangle size={16}/> That clue didn’t match. Check your details.</p>}
      {state === "success" && <p className="form-success"><Check size={16}/> Identity confirmed. Opening the case board…</p>}
      <Button size="lg" onClick={signIn} disabled={state === "loading"}>{state === "loading" ? <><Search className="investigate-spin"/> Investigating credentials…</> : state === "success" ? <><Check/> Welcome back</> : "Sign in"}</Button>
      <div className="login-links"><button type="button">Create account</button><button type="button">Forgot password?</button></div>
      <button type="button" className="error-demo" onClick={()=>setState("error")}>Preview invalid login</button>
    </section>
    <p className="login-footer">Your code stays yours. RepoSherlock investigates; it doesn’t rewrite your repository.</p>
  </main>;
}

const nav = [
  ["Home", Home], ["Repositories", Boxes], ["Investigations", Search], ["Evidence", ShieldCheck], ["History", History], ["Settings", Settings],
] as const;

function AppShell({ screen, setScreen, children }: { screen: Screen; setScreen: (s: Screen)=>void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return <div className="app-shell">
    <aside className={cn("sidebar", collapsed && "collapsed")}>
      <div className="sidebar-top"><Logo compact={collapsed}/><Button variant="ghost" size="icon" aria-label="Toggle sidebar" onClick={()=>setCollapsed(!collapsed)}>{collapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</Button></div>
      <nav>{nav.map(([label, Icon])=><button type="button" key={label} className={cn((screen === "dashboard" && label === "Home") || (screen === "repositories" && label === "Repositories") || (screen === "settings" && label === "Settings") ? "active" : "")} onClick={()=> label === "Home" ? setScreen("dashboard") : label === "Repositories" ? setScreen("repositories") : label === "Settings" ? setScreen("settings") : undefined}><Icon/><span>{label}</span></button>)}</nav>
      <div className="profile"><div className="avatar">AC</div><div><strong>Alex Chen</strong><small>Pro detective</small></div><ChevronDown/></div>
    </aside>
    <div className="mobile-bar"><Logo compact/><span>RepoSherlock</span><Button variant="ghost" size="icon"><Menu/></Button></div>
    <div className="app-main">{children}</div>
    <nav className="bottom-nav">{nav.slice(0,5).map(([label,Icon])=><button type="button" key={label} onClick={()=> label==="Home"?setScreen("dashboard"):label==="Repositories"?setScreen("repositories"):undefined}><Icon/><span>{label}</span></button>)}</nav>
  </div>;
}

function Dashboard({ goRepos, goWorkspace }: { goRepos:()=>void; goWorkspace:()=>void }) {
  return <div className="page-wrap dashboard-page">
    <div className="page-heading"><div><p className="eyebrow">THURSDAY · 3 CASES ACTIVE</p><h1>Good to see you, Alex.</h1><p>What are we investigating today?</p></div><div className="header-character"><Character mood="coffee"/></div></div>
    <section className="continue-band"><div><span className="status-dot"/> INVESTIGATION IN PROGRESS<h2>Payment webhook intermittently times out</h2><p><strong>payments-service</strong> · Issue #1842 · 6 of 8 stages complete</p><div className="progress"><i style={{width:"74%"}}/></div></div><Button onClick={goWorkspace}>Continue investigation <ArrowRight/></Button></section>
    <div className="section-title"><div><p className="eyebrow">RECENT REPOSITORIES</p><h2>Open a codebase</h2></div><Button variant="ghost" onClick={goRepos}>View all <ArrowRight/></Button></div>
    <div className="repo-grid compact-grid">{repositories.slice(0,3).map((repo)=><RepositoryCard key={repo.name} repo={repo} onClick={goRepos}/>)}</div>
    <div className="dashboard-grid"><section><div className="section-title"><div><p className="eyebrow">RECENT INVESTIGATIONS</p><h2>Your case board</h2></div></div>{issues.slice(0,3).map((issue,i)=><button type="button" className="activity-row" key={issue.number} onClick={goWorkspace}><span className={`activity-icon a${i}`}><Search/></span><span><strong>{issue.title}</strong><small>#{issue.number} · {i===0?"Investigation active":"Investigation complete"}</small></span><span className="confidence-mini">{87-i*6}%</span><ArrowRight/></button>)}</section>
      <section className="saved-panel"><div className="section-title"><div><p className="eyebrow">SAVED EVIDENCE</p><h2>Pinboard</h2></div></div><div className="sticky-note mint-note">Payment acknowledgement follows provider request.<small>PaymentWebhookHandler.ts:184</small></div><div className="sticky-note peach-note">Regression began after commit 8f3a21c.<small>Saved yesterday</small></div></section></div>
  </div>;
}

function RepositoryCard({ repo, onClick }: { repo: typeof repositories[number]; onClick:()=>void }) {
  return <button type="button" className={cn("repo-card", `repo-${repo.color}`)} onClick={onClick}><div className="repo-top"><span className="repo-folder"><Github/></span><Star size={16}/></div><small>{repo.owner}</small><h3>{repo.name}</h3><div className="repo-stats"><span><i className="lang-dot"/>{repo.language}</span><span><Star/> {repo.stars}</span><span><CircleDot/> {repo.issues}</span></div><div className="repo-foot"><span>{repo.updated}</span><span>{repo.size}</span></div></button>;
}

function Repositories({ onSelect }: { onSelect:()=>void }) {
  return <div className="page-wrap"><div className="page-heading simple"><div><p className="eyebrow">OPEN A NEW CASE</p><h1>Which codebase are we investigating?</h1><p>Pick a repository and let Sherlock get to work.</p></div><Button><Github/> Connect Repository</Button></div>
    <div className="tool-row"><div className="search-box"><Search/><Input placeholder="Search repositories…"/></div><div className="filters"><Button variant="secondary">Recent</Button><Button variant="ghost">Pinned</Button><Button variant="outline"><Layers3/> Filter</Button></div></div>
    <div className="repo-grid">{repositories.map((repo)=><RepositoryCard key={repo.name} repo={repo} onClick={onSelect}/>)}</div>
    <EmptyState compact />
  </div>;
}

function Indexing({ onDone }: { onDone:()=>void }) {
  const [step,setStep]=useState(0);
  useEffect(()=>{const id=setInterval(()=>setStep(v=>Math.min(v+1,5)),650);return()=>clearInterval(id)},[]);
  useEffect(()=>{if(step===5){const id=setTimeout(onDone,1000);return()=>clearTimeout(id)}},[step,onDone]);
  const stages=["Repository connected","Reading repository structure","Mapping files","Understanding code relationships","Indexing history","Preparing investigation engine"];
  return <div className="indexing-page"><div className="indexing-copy"><p className="eyebrow">PAYMENTS-SERVICE</p><h1>Getting to know your codebase<span className="ellipsis">...</span></h1><p>Building a map before we start investigating.</p><div className="index-stages">{stages.map((s,i)=><div className={cn("index-stage",i<step&&"done",i===step&&"active")} key={s}><span>{i<step?<Check/>:i===step?<Search/>:<span/>}</span><div><strong>{s}</strong>{i===step&&<small>{["Connected securely","Found 1,284 files","Mapping source files","Tracing 312 relationships","Reading commit history","Preparing Sherlock…"][i]}</small>}</div></div>)}</div></div>
    <div className="repo-unfold"><div className="tree-title"><span className="repo-folder"><Github/></span><div><small>acme-fintech</small><strong>payments-service</strong></div></div>{["src","webhooks","payment.ts","services","billing.ts","tests","history / 842 commits"].map((f,i)=><div className={cn("tree-row",i<=step&&"visible",f.includes(".")&&"file")} style={{paddingLeft:`${18+(i%3)*24}px`}} key={f}><span>{f.includes(".")?<Code2/>:<span className="tiny-folder"/>}</span>{f}</div>)}<Character mood="detective"/></div>
  </div>;
}

function Issues({ onInvestigate }: { onInvestigate:()=>void }) {
  const [selected,setSelected]=useState(1842);
  return <div className="page-wrap"><div className="page-heading simple"><div><p className="eyebrow">PAYMENTS-SERVICE · 31 OPEN ISSUES</p><h1>What’s the mystery?</h1><p>Pick an issue and let Sherlock investigate it.</p></div></div><div className="tool-row"><div className="search-box"><Search/><Input placeholder="Search issues…"/></div><div className="filters">{["Open","Recently Updated","Bug","Performance","Security","All"].map((f,i)=><Button key={f} variant={i===0?"secondary":"ghost"}>{f}</Button>)}</div></div>
    <div className="issue-list">{issues.map(issue=><div role="button" tabIndex={0} key={issue.number} className={cn("issue-card",selected===issue.number&&"selected")} onClick={()=>setSelected(issue.number)} onKeyDown={(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelected(issue.number)}}}><span className="issue-radio">{selected===issue.number&&<i/>}</span><div className="issue-main"><div><span className="issue-number">#{issue.number}</span><span className="status-label"><CircleDot/> {issue.status}</span></div><h3>{issue.title}</h3><div className="labels">{issue.labels.map(l=><span key={l}>{l}</span>)}</div><small>Opened {issue.age} by {issue.author} · {issue.comments} comments</small></div>{selected===issue.number&&<Button onClick={(e)=>{e.stopPropagation();onInvestigate()}}>INVESTIGATE <Search/></Button>}</div>)}</div>
  </div>;
}

function Investigating({ onDone }: { onDone:()=>void }) {
  const [step,setStep]=useState(0);
  useEffect(()=>{const id=setInterval(()=>setStep(v=>Math.min(v+1,7)),520);return()=>clearInterval(id)},[]);
  useEffect(()=>{if(step===7){const id=setTimeout(onDone,1100);return()=>clearTimeout(id)}},[step,onDone]);
  return <div className="investigating-page"><div className="investigation-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="center-lens"><Search/></div>{[Code2,GitBranch,CircleDot,History].map((Icon,i)=><span key={i} className={`orbit-node n${i}`}><Icon/></span>)}</div><div className="investigating-heading"><p className="eyebrow">ISSUE #1842 · PAYMENTS-SERVICE</p><h1>Sherlock is investigating...</h1><p>This is a visual simulation using mock repository evidence.</p></div><div className="investigation-stages">{investigationStages.map(([num,title,activity],i)=><div key={num} className={cn("investigation-stage",i<step&&"done",i===step&&"active")}><span>{i<step?<Check/>:num}</span><div><strong>{title}</strong>{i===step&&<small>{activity}</small>}</div><i/></div>)}</div></div>;
}

function ConfidenceIndicator() { return <div className="confidence"><div className="confidence-ring"><strong>87</strong><span>%</span></div><div><strong>High confidence</strong><small>Evidence-backed hypothesis</small></div></div>; }

function Workspace({ tab, setTab, openEvidence }: { tab: WorkspaceTab; setTab:(t:WorkspaceTab)=>void; openEvidence:()=>void }) {
  return <div className="workspace"><header className="workspace-header"><div><div className="crumbs"><span>payments-service</span><span>/</span><span>Issue #1842</span></div><h1>Payment webhook intermittently times out</h1></div><div className="workspace-status"><span><Check/> Investigation complete</span><ConfidenceIndicator/></div></header><div className="workspace-body">
    <aside className="case-nav"><p>INVESTIGATION</p>{[["overview","Overview",Search],["graph","Evidence map",Network],["code","Code path",Code2],["history","Git history",History],["impact","Blast radius",Zap],["plan","Fix plan",BookOpen]] .map(([id,label,Icon])=><button type="button" key={id as string} className={tab===id?"active":""} onClick={()=>setTab(id as WorkspaceTab)}><Icon className="nav-icon"/><span>{label as string}</span></button>)}<div className="philosophy"><Sparkles/><span>Understand first.<br/>Code second.</span></div></aside>
    <main className="case-content">{tab==="overview"&&<Overview openEvidence={openEvidence} setTab={setTab}/>} {tab==="graph"&&<EvidenceGraph/>} {tab==="code"&&<CodeView/>} {tab==="history"&&<GitTimeline/>} {tab==="impact"&&<ImpactGraph/>} {tab==="plan"&&<FixPlan/>}</main>
    <aside className="context-panel"><div className="context-head"><div><p className="eyebrow">EVIDENCE STACK</p><h3>3 sources agree</h3></div><ShieldCheck/></div>{evidence.map((ev)=><EvidenceCard key={ev.id} ev={ev} compact onClick={openEvidence}/>)}<Button variant="outline" onClick={openEvidence}>Inspect all evidence <ArrowRight/></Button></aside>
  </div></div>;
}

function Overview({ openEvidence, setTab }: {openEvidence:()=>void;setTab:(t:WorkspaceTab)=>void}) { return <div className="overview animate-enter"><section className="question-block"><p className="eyebrow">THE QUESTION</p><h2>Why is the payment webhook timing out?</h2></section><section className="hypothesis-card"><div className="hypothesis-top"><span><Search/> ROOT-CAUSE HYPOTHESIS</span><ConfidenceIndicator/></div><h2>Webhook processing performs a synchronous downstream API call before acknowledging the request.</h2><p>When provider latency exceeds the gateway timeout, the acknowledgement never reaches the caller—even though processing may eventually succeed.</p><div className="hypothesis-actions"><Button size="lg" onClick={openEvidence}>WHY? <ArrowRight/></Button><span>Hypothesis, not absolute truth · supported by 3 sources</span></div></section><div className="finding-grid"><button type="button" onClick={()=>setTab("code")}><span className="finding-icon blue"><Code2/></span><small>RELEVANT FILES</small><strong>3 source files</strong><p>Primary execution path traced</p><ArrowRight/></button><button type="button" onClick={()=>setTab("history")}><span className="finding-icon violet"><History/></span><small>HISTORICAL CONTEXT</small><strong>Change introduced Jan 18</strong><p>Related to commit 8f3a21c</p><ArrowRight/></button><button type="button" onClick={()=>setTab("impact")}><span className="finding-icon coral"><Zap/></span><small>IMPACT</small><strong>6 connected services</strong><p>2 direct, 3 indirect, 1 potential</p><ArrowRight/></button><button type="button" onClick={()=>setTab("plan")}><span className="finding-icon mint"><BookOpen/></span><small>FIX PLAN</small><strong>5 evidence-linked steps</strong><p>Medium implementation risk</p><ArrowRight/></button></div><section className="understanding"><p className="eyebrow">PROBLEM UNDERSTANDING</p><h2>The timeout is an ordering problem, not a processing failure.</h2><p>The webhook handler waits for provider communication and billing reconciliation before responding. Under normal latency this is invisible. Under load, the request exceeds the gateway’s 10-second window while downstream work continues.</p></section></div> }

function EvidenceCard({ev,compact,onClick}:{ev:typeof evidence[number];compact?:boolean;onClick?:()=>void}) { return <button type="button" className={cn("evidence-card",`evidence-${ev.accent}`,compact&&"compact")} onClick={onClick}><div className="evidence-top"><span>Evidence {ev.id}</span><span>{ev.kind}</span></div><h3>{ev.name}</h3><small>{ev.locator} · {ev.time}</small><blockquote>“{ev.excerpt}”</blockquote>{!compact&&<><div className="relation"><GitBranch/> {ev.relation}</div><div className="evidence-action">{ev.kind==="SOURCE FILE"?"Open source":ev.kind==="COMMIT"?"View commit":"View issue"}<ArrowRight/></div></>}</button> }

function EvidenceDrawer({open,onClose}:{open:boolean;onClose:()=>void}) { return <><div className={cn("drawer-backdrop",open&&"open")} onClick={onClose}/><aside className={cn("evidence-drawer",open&&"open")} aria-hidden={!open}><header><div><p className="eyebrow">EVIDENCE PROVENANCE</p><h2>Why does Sherlock believe this?</h2><p>Three independent sources support the hypothesis.</p></div><Button variant="ghost" size="icon" aria-label="Close evidence" onClick={onClose}><X/></Button></header><div className="drawer-confidence"><ConfidenceIndicator/><p>Strong agreement across code, history, and issue context.</p></div><div className="drawer-cards">{evidence.map(ev=><EvidenceCard key={ev.id} ev={ev}/>)}</div><p className="drawer-note"><ShieldCheck/> Every claim stays linked to its source so you can verify it yourself.</p></aside></> }

function EvidenceGraph(){const [active,setActive]=useState("file");const nodes=[{id:"issue",label:"Issue #1842",sub:"Starting clue",x:"14%",y:"22%",icon:CircleDot},{id:"file",label:"WebhookHandler",sub:"Source file · L184",x:"78%",y:"18%",icon:Code2},{id:"function",label:"handleWebhook",sub:"Function",x:"84%",y:"67%",icon:Braces},{id:"commit",label:"8f3a21c",sub:"Commit",x:"14%",y:"72%",icon:GitBranch},{id:"previous",label:"Issue #1742",sub:"Previous incident",x:"47%",y:"86%",icon:History}];return <div className="graph-page animate-enter"><div className="content-title"><p className="eyebrow">EVIDENCE MAP</p><h2>How did Sherlock arrive here?</h2><p>Select a source to inspect its relationship to the hypothesis.</p></div><div className="evidence-graph"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 48 L18 27 M50 48 L76 24 M50 48 L80 66 M50 48 L18 70 M50 48 L48 83"/><path className="pulse-edge" d="M18 27 L76 24 M76 24 L80 66 M18 70 L48 83"/></svg><div className="root-node"><span>ROOT CAUSE</span><strong>Blocking call before acknowledgement</strong></div>{nodes.map(n=><button type="button" key={n.id} style={{left:n.x,top:n.y}} className={cn("graph-node",active===n.id&&"active")} onClick={()=>setActive(n.id)}><n.icon/><span><strong>{n.label}</strong><small>{n.sub}</small></span></button>)}</div><div className="graph-detail"><ShieldCheck/><div><small>SELECTED EVIDENCE</small><strong>{nodes.find(n=>n.id===active)?.label}</strong><p>{active==="file"?"The acknowledgement is returned only after two awaited downstream operations.":"This source helps establish the timing and scope of the observed failure."}</p></div><Button variant="outline">Inspect source <ArrowRight/></Button></div></div>}

function CodeView(){return <div className="code-page animate-enter"><div className="content-title"><p className="eyebrow">CODE PATH · PRIMARY EVIDENCE</p><h2>src/webhooks/payment.ts</h2><p>Relevant function: handlePaymentWebhook</p></div><div className="code-window"><div className="code-toolbar"><div><span/><span/><span/></div><span>payment.ts</span><Button size="sm" variant="outline">Evidence #01</Button></div><pre>{codeLines.map((line,i)=><div key={i} className={cn(i>=4&&i<=7&&"highlighted",i===7&&"critical")}><span className="line-number">{180+i}</span><code>{line||" "}</code>{i===7&&<b>01</b>}</div>)}</pre></div><section className="why-file"><span className="finding-icon blue"><Code2/></span><div><p className="eyebrow">WHY THIS FILE MATTERS</p><h3>The acknowledgement boundary is below both downstream calls.</h3><p>This makes the external response time dependent on provider and billing latency. Evidence #01 directly supports the root-cause hypothesis.</p></div></section></div>}

function GitTimeline(){const events=[["Issue created","#1842 · Maya Chen","Feb 12, 2025","Intermittent timeouts first reported in production."],["Related commit","8f3a21c · Jon Bell","Jan 18, 2025","Provider lookup moved into the synchronous request path."],["Related PR","PR #892 · Priya Shah","Jan 16, 2025","Consolidated payment processing for consistency."],["Previous incident","Issue #1742","Sep 02, 2024","Similar timeout under high provider latency."],["Current code","HEAD · payment.ts:184","Today","Acknowledgement remains after downstream processing."]];return <div className="history-page animate-enter"><div className="content-title"><p className="eyebrow">HISTORICAL CONTEXT</p><h2>The code remembers what the issue forgot.</h2><p>A focused timeline of changes related to this behavior.</p></div><div className="git-timeline">{events.map((e,i)=><button type="button" key={e[0]}><span className={cn("timeline-dot",i===4&&"current")}>{i===4?<CircleDot/>:<GitBranch/>}</span><div><small>{e[2]}</small><h3>{e[0]}</h3><strong>{e[1]}</strong><p>{e[3]}</p></div><ArrowRight/></button>)}</div></div>}

function ImpactGraph(){const nodes=["PaymentService","BillingService","EventQueue","NotificationService","Database","API Gateway"];return <div className="impact-page animate-enter"><div className="content-title"><p className="eyebrow">BLAST RADIUS</p><h2>What could this change affect?</h2><p>Understand consequences before touching the code.</p></div><div className="impact-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M50 50 L18 20 M50 50 L82 19 M50 50 L12 58 M50 50 L87 57 M50 50 L28 84 M50 50 L72 84"/></svg><div className="impact-core"><Zap/><strong>PaymentWebhook<br/>Handler</strong></div>{nodes.map((n,i)=><button type="button" key={n} className={`impact-node impact-${i}`}><span>{i<2?"Direct":i<5?"Indirect":"Potential"}</span><strong>{n}</strong></button>)}</div><div className="impact-legend"><span><i className="direct"/> Direct</span><span><i className="indirect"/> Indirect</span><span><i className="potential"/> Potential</span></div></div>}

function FixPlan(){const steps=["Reproduce the timeout under simulated provider latency.","Confirm webhook acknowledgement happens after downstream processing.","Move acknowledgement boundary before non-critical downstream work.","Add timeout handling around provider communication.","Add regression test for delayed provider response."];return <div className="plan-page animate-enter"><div className="content-title"><p className="eyebrow">STRUCTURED FIX PLAN</p><h2>Recommended investigation / implementation path</h2><p>Understand first. Code second. No code is generated here.</p></div><div className="plan-list">{steps.map((step,i)=><article key={step}><span>{String(i+1).padStart(2,"0")}</span><div><h3>{step}</h3><p>{["Establish a reliable baseline before changing behavior.","Verify the hypothesis against runtime behavior.","Reduce request latency while preserving delivery semantics.","Prevent an external dependency from controlling webhook duration.","Protect the acknowledgement boundary from regression."][i]}</p><div className="step-meta"><span><ShieldCheck/> Evidence {i<2?"01":i===2?"01 + 02":"02 + 03"}</span><span><Code2/> {i===4?"payment.test.ts":"payment.ts"}</span><span className={i===2?"risk-med":""}>Risk: {i===2?"Medium":"Low"}</span></div></div><span className="plan-status">{i<2?"Verify":"Planned"}</span></article>)}</div></div>}

function SettingsPage(){return <div className="page-wrap settings-page"><div className="page-heading simple"><div><p className="eyebrow">PERSONALIZATION</p><h1>Make Sherlock yours.</h1><p>Adjust your workspace without losing its investigative character.</p></div></div><div className="settings-layout"><aside><button className="active">Profile</button><button>Appearance</button><button>Investigation</button><button>Notifications</button><button>Plan & usage</button></aside><main><section><h2>Detective profile</h2><div className="profile-editor"><div className="avatar big">AC</div><Button variant="outline">Change avatar</Button></div><div className="form-grid"><label>Display name<Input defaultValue="Alex Chen"/></label><label>Preferred language<select defaultValue="English"><option>English</option><option>Spanish</option><option>German</option></select></label></div></section><section><h2>Workspace preferences</h2><SettingRow title="Code theme" text="Syntax palette for evidence excerpts"><select defaultValue="Sherlock Light"><option>Sherlock Light</option><option>Midnight Case</option></select></SettingRow><SettingRow title="Density" text="How compact your investigation workspace feels"><div className="segmented"><button>Comfortable</button><button className="active">Compact</button></div></SettingRow><SettingRow title="Animation level" text="Control motion and character reactions"><input type="range" min="0" max="2" defaultValue="1" aria-label="Animation level"/></SettingRow><SettingRow title="Evidence view" text="Default format when opening provenance"><select><option>Evidence stack</option><option>Evidence map</option></select></SettingRow></section><section><h2>Investigation defaults</h2><SettingRow title="Default repository" text="Start new investigations from this codebase"><select><option>payments-service</option><option>identity-gateway</option></select></SettingRow><SettingRow title="Investigation notifications" text="Notify when a mock investigation is ready"><button className="switch active"><i/></button></SettingRow></section><Button size="lg">Save preferences</Button></main></div></div>}
function SettingRow({title,text,children}:{title:string;text:string;children:ReactNode}){return <div className="setting-row"><div><strong>{title}</strong><p>{text}</p></div>{children}</div>}

function EmptyState({compact=false}:{compact?:boolean}){return <section className={cn("empty-state",compact&&"compact")}><div className="empty-visual"><Character mood="curious"/></div><div><h3>Your investigation board is empty.</h3><p>Connect another repository when you’re ready for a new mystery.</p></div><Button variant="outline">Connect Repository</Button></section>}

function PricingModal({open,onClose}:{open:boolean;onClose:()=>void}){if(!open)return null;return <div className="modal-layer" role="dialog" aria-modal="true"><div className="pricing-modal"><header><div><p className="eyebrow">COMING SOON</p><h2>More mysteries. More evidence.</h2></div><Button variant="ghost" size="icon" onClick={onClose}><X/></Button></header><div className="plans">{[["Free","$0","3 investigations / month"],["Pro","$19","Unlimited personal investigations"],["Team","$49","Shared evidence and team workflows"]].map((p,i)=><article className={i===1?"featured":""} key={p[0]}>{i===1&&<span className="popular">MOST CURIOUS</span>}<h3>{p[0]}</h3><strong>{p[1]}<small>/mo</small></strong><p>{p[2]}</p><ul><li><Check/>Evidence provenance</li><li><Check/>Code and history maps</li><li><Check/>{i===0?"Community support":"Priority investigations"}</li></ul><Button variant={i===1?"default":"outline"}>{i===0?"Current plan":"Choose plan"}</Button></article>)}</div><p className="mock-note">Prototype only · No payment will be processed.</p></div></div>}

export function RepoSherlockApp(){
 const [screen,setScreen]=useState<Screen>("entry"); const [tab,setTab]=useState<WorkspaceTab>("overview"); const [drawer,setDrawer]=useState(false); const [pricing,setPricing]=useState(false);
 const inApp=!(["entry","login","indexing","investigating"] as Screen[]).includes(screen);
 const content=useMemo(()=>{switch(screen){case"entry":return <Entry onStart={()=>setScreen("login")} onHow={()=>setScreen("login")}/>;case"login":return <Login onBack={()=>setScreen("entry")} onSuccess={()=>setScreen("dashboard")}/>;case"dashboard":return <Dashboard goRepos={()=>setScreen("repositories")} goWorkspace={()=>setScreen("workspace")}/>;case"repositories":return <Repositories onSelect={()=>setScreen("indexing")}/>;case"indexing":return <Indexing onDone={()=>setScreen("issues")}/>;case"issues":return <Issues onInvestigate={()=>setScreen("investigating")}/>;case"investigating":return <Investigating onDone={()=>setScreen("workspace")}/>;case"workspace":return <Workspace tab={tab} setTab={setTab} openEvidence={()=>setDrawer(true)}/>;case"settings":return <SettingsPage/>;}},[screen,tab]);
 return <>{inApp?<AppShell screen={screen} setScreen={setScreen}>{content}<button className="pricing-chip" type="button" onClick={()=>setPricing(true)}><Sparkles/> Plans</button></AppShell>:content}<EvidenceDrawer open={drawer} onClose={()=>setDrawer(false)}/><PricingModal open={pricing} onClose={()=>setPricing(false)}/></>;
}
