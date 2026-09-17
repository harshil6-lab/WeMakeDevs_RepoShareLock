# Sherlock's Workbench

Build ONLY the UI/UX and frontend prototype for a product called "RepoSherlock".

CRITICAL SCOPE RESTRICTION:

THIS TASK IS UI/UX ONLY.

Do NOT implement or connect:

- backend

- database

- GitHub API

- GitHub OAuth

- AWS

- Amazon Bedrock

- real AI agents

- repository cloning/indexing

- real repository analysis

- real Git history

- real issue retrieval

- real authentication

- real payment processing

- API endpoints

- secrets/environment variables

- production infrastructure

Do NOT modify, create, inspect, or depend on any existing repository implementation.

Create a completely self-contained frontend prototype using realistic MOCK DATA ONLY.

The frontend must be structured cleanly so it can later be integrated into the real RepoSherlock repository.

Do NOT display any Lovable branding, logo, badge, attribution, watermark, "Made with Lovable", or similar branding anywhere in the UI.

==================================================

PRODUCT

==================================================

Name:

RepoSherlock

Tagline:

"Don't ask AI to write the solution. Let it investigate the problem first."

RepoSherlock is an agentic software-engineering investigation product.

A developer gives it a GitHub repository and issue. Sherlock investigates the unfamiliar codebase and produces:

- root-cause hypothesis

- evidence

- relevant files

- code paths

- Git history

- related issues/PRs

- historical context

- impact/blast radius

- structured fix plan

This is NOT a chatbot.

The interface must communicate:

INVESTIGATE → UNDERSTAND → VERIFY → ACT

The strongest visual differentiator is the investigation process and evidence provenance.

==================================================

DESIGN DIRECTION

==================================================

Create a premium, playful, colorful developer-tool experience.

The emotional progression should be:

PLAYFUL → CURIOUS → INVESTIGATIVE → TECHNICAL → TRUSTWORTHY

Do NOT create:

- generic AI SaaS

- purple-gradient AI dashboard

- boring enterprise dashboard

- black terminal interface

- cyberpunk UI

- excessive glassmorphism

- generic ChatGPT clone

- cryptocurrency aesthetics

Think conceptually:

modern developer tooling + playful indie SaaS + forensic investigation console.

The design must be original.

Use:

- warm off-white backgrounds

- cream surfaces

- pale lavender

- muted blue

- soft peach

- gentle mint

- coral/orange

- electric blue

- violet

- yellow accents

Use colors intentionally, not as rainbow decoration.

Typography:

Inter / Geist / similar modern sans-serif.

Code:

JetBrains Mono / IBM Plex Mono.

==================================================

3D / CHARACTER STYLE

==================================================

Use tasteful lightweight 3D/cartoon developer characters.

Characters can include:

- developer with laptop

- detective developer

- developer with magnifying glass

- sleepy developer

- curious developer

- developer holding coffee

Also use:

- repository folders

- Git branches

- commits

- issue cards

- bugs

- magnifying glass

- evidence board

- code files

The visual style should feel premium and polished, not childish.

Use lightweight assets/SVG/CSS wherever possible.

Avoid heavy 3D engines.

==================================================

ENTRY EXPERIENCE

==================================================

Create a memorable full-screen entry screen.

Concept:

A developer stands at the bottom of the screen and looks upward.

Above them is a huge floating software landscape containing:

- repository folders

- Git branches

- commits

- code files

- GitHub issues

- pull requests

- dependency paths

The environment extends upward into the distance.

The developer is looking upward as if preparing to investigate an unfamiliar codebase.

Add subtle parallax.

Headline:

"Meet RepoSherlock."

Subheadline:

"Investigate the codebase before you touch the code."

Primary CTA:

"Start Investigating"

Secondary CTA:

"See how it works"

Small credibility text:

"Evidence-backed investigation for GitHub repositories."

On pointer movement:

- subtle parallax

- repository objects react slightly

- character can look toward hovered objects

Keep the animation calm and premium.

Clicking "Start Investigating" transitions smoothly to Login.

==================================================

LOGIN

==================================================

Create a playful full-screen login scene.

Do NOT make it look like a standard corporate authentication page.

Central login card surrounded by 3–5 developer characters.

Characters:

- impatient developer

- sleepy developer

- curious developer

- detective developer

- coffee developer

Heading:

"Welcome back, detective."

Primary button:

"Continue with GitHub"

Divider:

"or"

Fields:

Email

Password

Actions:

Sign in

Create account

Forgot password?

Footer:

"Your code stays yours. RepoSherlock investigates; it doesn't rewrite your repository."

SPECIAL INTERACTION:

When password input is focused:

characters cover their eyes.

When password loses focus:

characters subtly peek again.

Invalid login:

one character reacts humorously but professionally.

Loading:

characters perform a subtle investigation animation.

Success:

characters celebrate and transition to dashboard.

Use smooth 200–600ms transitions.

Create all states:

normal

hover

focus

loading

error

success

Authentication remains MOCK ONLY.

==================================================

DASHBOARD

==================================================

After login, show a personalized developer headquarters.

Header:

"Good to see you, [Developer Name]."

Subheading:

"What are we investigating today?"

Sections:

Continue Investigation

Recent Repositories

Recent Investigations

Saved Evidence

Developer Activity

Use subtle character moments.

Examples:

"3 investigations waiting 👀"

A tiny detective character examining an issue.

Navigation:

Home

Repositories

Investigations

Evidence

History

Settings

Bottom:

Developer Profile

Use a compact sidebar that expands smoothly.

Do NOT make this a generic analytics dashboard.

==================================================

REPOSITORY SELECTION

==================================================

Heading:

"Which codebase are we investigating?"

Subheading:

"Pick a repository and let Sherlock get to work."

Create beautiful repository cards.

Each card contains:

repository name

owner

language

stars

open issues

last updated

repository size

GitHub icon

Actions:

Search repositories

Filter

Recent

Pinned

Connect Repository

Use MOCK DATA.

Example:

payments-service

Make repository selection visually feel like opening a codebase.

==================================================

REPOSITORY INDEXING

==================================================

Create an animated mock indexing experience.

IMPORTANT:

This is visual simulation only.

Do NOT call any API.

Heading:

"Getting to know your codebase..."

Stages:

✓ Repository connected

✓ Reading repository structure

● Mapping files

○ Understanding code relationships

○ Indexing history

○ Preparing investigation engine

Show a repository tree progressively unfolding.

Example mock activity:

"Found 1,284 files"

"Mapping source files"

"Reading commit history"

"Building repository map"

"Preparing Sherlock..."

Include a detective character inspecting folders.

==================================================

ISSUE SELECTION

==================================================

Heading:

"What's the mystery?"

Subheading:

"Pick an issue and let Sherlock investigate it."

Issue cards:

#1842 Payment webhook intermittently times out

#1837 User session expires unexpectedly

#1819 Duplicate events appear in billing pipeline

#1804 API returns stale user profile

Each card:

issue number

title

labels

author

age

comments

status

Filters:

Open

Recently Updated

Bug

Performance

Security

All

Add search.

Use realistic mock data.

==================================================

INVESTIGATION START

==================================================

When user clicks:

"INVESTIGATE"

DO NOT call any AI.

Create a beautifully animated MOCK investigation sequence.

Heading:

"Sherlock is investigating..."

Stages:

01 Understand issue

02 Search repository

03 Trace relevant code

04 Investigate Git history

05 Find related issues

06 Form hypothesis

07 Verify evidence

08 Build investigation

Stages transition:

waiting → active → completed

Mock activity:

"Reading issue #1842..."

"Searching payment handlers..."

"Found relevant source file..."

"Checking previous timeout fixes..."

"Comparing related commits..."

"Verifying evidence..."

This must NOT be a generic spinner.

The interface should visually demonstrate what the eventual real agent will do.

After the simulated investigation, transition to the result screen.

==================================================

INVESTIGATION WORKSPACE

==================================================

This is the most important screen.

Create a premium three-column developer investigation workspace.

LEFT:

Navigation/sidebar.

CENTER:

Investigation content.

RIGHT:

Evidence/context panel.

Top:

payments-service

Issue #1842

Payment webhook intermittently times out

Status:

Investigation complete

Confidence:

87%

Main question:

"Why is the payment webhook timing out?"

Root Cause Hypothesis:

"Webhook processing performs a synchronous downstream API call before acknowledging the request."

Show confidence as a visual indicator.

IMPORTANT:

This is MOCK DATA.

Make it visually clear that the confidence represents a hypothesis, not absolute truth.

Main sections:

Problem Understanding

Root-Cause Hypothesis

Relevant Files

Historical Context

Impact

Fix Plan

Primary interaction:

[ WHY? ]

This must be visually prominent.

==================================================

WHY / EVIDENCE

==================================================

This is the signature RepoSherlock interaction.

Clicking [WHY?] opens an elegant right-side evidence drawer.

Heading:

"Why does Sherlock believe this?"

Evidence cards:

Evidence 01

PaymentWebhookHandler.ts

Line 184

"Webhook acknowledgement occurs after downstream processing."

Evidence 02

Commit 8f3a21c

"Move payment provider call into webhook handler."

Evidence 03

Issue #1742

"Webhook timeout reported under high provider latency."

Each evidence card contains:

source type

source name

locator

excerpt

timestamp

relationship to hypothesis

Actions:

Open Source

View Commit

View Issue

Everything is mock data.

Create smooth drawer transitions.

==================================================

EVIDENCE GRAPH

==================================================

Create an interactive evidence graph.

Center:

ROOT CAUSE

Connected nodes:

Issue

File

Function

Commit

Previous Issue

PR

Documentation

Use distinct shapes/icons for each source type.

Clicking a node reveals details.

Edges animate subtly.

The graph should visually answer:

"How did Sherlock arrive here?"

Do NOT make it look like a generic network graph.

It should feel like a forensic evidence map.

==================================================

CODE VIEW

==================================================

Create a beautiful code inspection screen/panel.

Show:

src/webhooks/payment.ts

Relevant function

Line numbers

Syntax highlighting

Highlighted relevant lines

Evidence #01 marker

Below:

"Why this file matters"

Add source/evidence interactions.

Do NOT build a complete IDE.

RepoSherlock investigates code; it does not write code.

==================================================

HISTORY

==================================================

Create a visual Git history timeline.

Events:

Issue Created

Related Commit

Related PR

Previous Incident

Current Code

Each event includes:

commit SHA

author

date

short explanation

Make events interactive.

Use a timeline rather than a boring table.

==================================================

IMPACT / BLAST RADIUS

==================================================

Heading:

"What could this change affect?"

Create an interactive dependency/impact map.

Center:

PaymentWebhookHandler

Connected:

PaymentService

BillingService

EventQueue

NotificationService

Database

API Gateway

Relationship labels:

Direct

Indirect

Potential

The visual should communicate:

"Understand consequences before touching the code."

==================================================

FIX PLAN

==================================================

Heading:

"Recommended investigation / implementation path"

Create structured ordered steps.

01

Reproduce the timeout under simulated provider latency.

02

Confirm webhook acknowledgement happens after downstream processing.

03

Move acknowledgement boundary before non-critical downstream work.

04

Add timeout handling around provider communication.

05

Add regression test for delayed provider response.

Each step:

reason

related evidence

affected file

risk

status

IMPORTANT:

Do NOT generate code.

Product philosophy:

"Understand first. Code second."

==================================================

PERSONALIZATION / SETTINGS

==================================================

Create polished settings.

Allow configuration of:

Display name

Avatar

Preferred language

Code theme

Density

Animation level

Investigation preferences

Default repository

Evidence view

Notifications

Do not make themes the central feature.

Keep RepoSherlock's colorful visual identity.

==================================================

PRICING

==================================================

Create a premium but secondary pricing screen/modal.

Plans:

Free

Pro

Team

This is MOCK UI only.

No real Stripe/payment integration.

No payment API.

No billing backend.

Use "Coming soon" or "Choose plan".

==================================================

EMPTY / ERROR STATES

==================================================

Create polished states.

No repositories:

"Your investigation board is empty."

No issues:

"Sherlock couldn't find a mystery yet."

Disconnected:

"Looks like our detective lost the GitHub connection."

Investigation error:

"Sherlock hit a dead end."

Action:

Try Again

Rate limited:

"GitHub asked us to slow down."

Loading:

Detective investigating code.

Success:

Subtle celebration.

==================================================

COMPONENT SYSTEM

==================================================

Create reusable components:

Button

IconButton

Input

SearchInput

RepositoryCard

IssueCard

InvestigationStage

EvidenceCard

EvidenceBadge

ConfidenceIndicator

CodeViewer

GitTimeline

ImpactNode

ImpactGraph

InvestigationSidebar

Navigation

Character

Toast

Modal

Drawer

Tooltip

Tabs

StatusBadge

Avatar

Dropdown

EmptyState

LoadingState

ErrorState

SuccessState

Use consistent spacing, typography, radius, shadows and interaction states.

==================================================

MICRO-INTERACTIONS

==================================================

Use intentional animation.

Buttons:

subtle hover lift

Cards:

small depth movement

Repository:

unfold/open interaction

Investigation:

progressively reveal stages

Evidence:

soft highlight when selected

Characters:

contextual reactions

Panels:

spring-based transitions

Success:

small celebration

Do NOT use excessive bouncing, flashing, particles or noisy effects.

Respect reduced-motion preferences.

==================================================

RESPONSIVE

==================================================

Primary:

1440 × 900

Also:

1280 × 800

1024 × 768

mobile

Desktop investigation:

3 columns

Tablet:

2 columns

Mobile:

single column with sheets/bottom navigation.

==================================================

ACCESSIBILITY

==================================================

Use:

- strong contrast

- keyboard navigation

- visible focus states

- accessible labels

- don't communicate information through color alone

- reduced-motion support

==================================================

PERFORMANCE

==================================================

The frontend must be realistically implementable in React/Next.js.

Prefer:

CSS

SVG

lightweight illustrations

optimized assets

simple animation

Avoid heavy 3D engines.

==================================================

MOST IMPORTANT PRODUCT EXPERIENCE

==================================================

The complete clickable prototype must tell this story:

Entry

→ Login

→ Personalized Dashboard

→ Repository

→ Mock Indexing

→ Issue

→ Investigate

→ Investigation Progress

→ Investigation Result

→ WHY?

→ Evidence

→ Code

→ Git History

→ Impact

→ Fix Plan

The emotional progression:

PLAYFUL

→ CURIOUS

→ INVESTIGATIVE

→ TECHNICAL

→ TRUSTWORTHY

The characters make RepoSherlock enjoyable.

The investigation workflow makes it impressive.

The evidence makes it trustworthy.

The structured result makes it useful.

The UI must make it immediately obvious that this is NOT ChatGPT + GitHub.

The central philosophy:

INVESTIGATE → UNDERSTAND → VERIFY → ACT

Final demo issue:

#1842 Payment webhook intermittently times out

Final demo repository:

payments-service

Use realistic MOCK DATA throughout.

==================================================

FINAL AND STRICT INSTRUCTION

==================================================

THIS IS A UI/UX PROTOTYPE TASK ONLY.

Do not implement backend functionality.

Do not connect APIs.

Do not connect GitHub.

Do not connect AWS.

Do not connect Bedrock.

Do not implement authentication.

Do not implement payment processing.

Do not implement repository ingestion.

Do not implement real AI.

Do not create infrastructure.

Do not modify any existing repository.

Do not add Lovable branding anywhere.

Create a clean, modular frontend that can later be imported/integrated into the real RepoSherlock codebase.

Prioritize exceptional visual design, UX, transitions, responsive behavior, component consistency and the investigation storytelling experience above everything else.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/72d9d67e-9de7-4dea-8fcf-4bcd4ec0eb96).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
