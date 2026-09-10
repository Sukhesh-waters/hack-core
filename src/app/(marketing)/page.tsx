import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { GradientBackdrop } from "@/components/gradient-backdrop";
import { PillNav } from "@/components/pill-nav";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  BookOpen,
  Cpu,
  Workflow,
  BarChart3,
  Check,
  FolderLock,
} from "lucide-react";

const stats = [
  { value: "10x", label: "Faster Ingestion & Briefing", accent: "text-brand-teal" },
  { value: "100%", label: "Brand Voice & Guardrail Fidelity", accent: "text-brand-purple" },
  { value: "0 Drift", label: "Predictive Baseline Monitoring", accent: "text-brand-amber" },
  { value: "100% Isolated", label: "Multi-Tenant Client Workspaces", accent: "text-brand-teal" },
];

const operationalPlaybook = [
  {
    step: "01",
    phase: "Phase 1: Ingestion & Knowledge Isolation",
    accent: "text-brand-teal",
    badgeBg: "bg-brand-teal/10 border-brand-teal/30 text-brand-teal",
    route: "/kb & /docs",
    title: "Ingest Client DNA into an Isolated Brain",
    description:
      "Upload brand guidelines, style books, product catalogs, customer personas, and historical top-performing posts. InstaMedia AI parses and organizes them into a secure, workspace-isolated knowledge base that grounds every AI generation.",
    highlights: [
      "PDF, markdown, CSV, and doc asset ingestion",
      "Semantic indexing with strict workspace boundaries",
      "Living memory updated continuously with fresh collateral",
    ],
  },
  {
    step: "02",
    phase: "Phase 2: Baseline Scoring & Rules Setup",
    accent: "text-brand-purple",
    badgeBg: "bg-brand-purple/10 border-brand-purple/30 text-brand-purple",
    route: "/brand-gene & /rules",
    title: "Define Tone, Constraints & Scoring Weights",
    description:
      "Set up the brand's guardrails: forbidden terminology, required disclaimers, tone dimensions (e.g., authoritative vs. playful), and target engagement benchmarks that calibrate how every generated concept is scored.",
    highlights: [
      "Multi-dimensional tone of voice parameters",
      "Automated compliance and legal guardrails",
      "Baseline scoring formulas calibrated to past winners",
    ],
  },
  {
    step: "03",
    phase: "Phase 3: Defensible AI Ideation",
    accent: "text-brand-amber",
    badgeBg: "bg-brand-amber/10 border-brand-amber/30 text-brand-amber",
    route: "/ideation",
    title: "Generate Concepts with Defensible 'Why'",
    description:
      "Generate batches of social content ideas with predictive baseline scores. Each idea comes with an auditable explanation of why it will perform based on client historical data and current audience resonance.",
    highlights: [
      "Multi-angle batch ideation (educational, viral, conversion)",
      "Predictive resonance and hook strength scoring",
      "Direct 'one-click promote to Studio' pipeline",
    ],
  },
  {
    step: "04",
    phase: "Phase 4: Creative Studio & Compliance Check",
    accent: "text-brand-teal",
    badgeBg: "bg-brand-teal/10 border-brand-teal/30 text-brand-teal",
    route: "/studio",
    title: "Draft, Polish & Validate in Real-Time",
    description:
      "Flesh out concepts into full social drafts: multi-slide carousels, short-form video hooks, caption variations, and visual briefs. Built-in compliance checks immediately flag off-brand phrasing or rule violations.",
    highlights: [
      "Split-screen drafting with real-time AI assistance",
      "Instant compliance and guardrail validation check",
      "Multi-format adapters (LinkedIn, Instagram, TikTok, X)",
    ],
  },
  {
    step: "05",
    phase: "Phase 5: Multi-Tier Approval Workflows",
    accent: "text-brand-purple",
    badgeBg: "bg-brand-purple/10 border-brand-purple/30 text-brand-purple",
    route: "/approvals & /workflows",
    title: "Frictionless Internal & Client Sign-Off",
    description:
      "Route drafts through structured approval gates: copywriter → creative director → brand client. Approvers can leave targeted comments, request revisions with structured feedback, or approve with one click.",
    highlights: [
      "Role-based permission gates (Writer, Editor, Client)",
      "Structured rejection reasons with undo & revision tracking",
      "Client portal view with zero clutter or friction",
    ],
  },
  {
    step: "06",
    phase: "Phase 6: Omni-Channel Calendar & Drift Loop",
    accent: "text-brand-amber",
    badgeBg: "bg-brand-amber/10 border-brand-amber/30 text-brand-amber",
    route: "/calendar & /drift",
    title: "Schedule, Monitor Drift & Train the Loop",
    description:
      "Publish across multi-channel content calendars. Post-launch performance metrics are ingested automatically, triggering drift detection if messaging diverges from baseline and feeding learnings back into future ideation.",
    highlights: [
      "Visual drag-and-drop unified content calendar",
      "Automated drift alerts when content strays from voice",
      "Closed-loop feedback updating the client baseline",
    ],
  },
];

const howToUseSteps = [
  {
    num: "1",
    title: "Create or Select Your Client Workspace",
    desc: "Switch between isolated agency workspaces (`/w/[client-name]`). Every workspace operates with its own sandboxed database, knowledge base, rules, and calendar.",
    icon: FolderLock,
    tag: "Setup",
  },
  {
    num: "2",
    title: "Ingest Assets & Train Knowledge Base",
    desc: "Navigate to the Knowledge Base (`/kb`) to upload client PDFs, brand decks, voice guidelines, and past top-performing copy. Ask InstaMedia AI directly to verify memory recall.",
    icon: BookOpen,
    tag: "Ingest",
  },
  {
    num: "3",
    title: "Generate Scored Ideas & Promote to Studio",
    desc: "Open Ideation (`/ideation`), trigger idea generation batches, inspect the baseline scores, and promote high-scoring concepts directly into the Creative Studio (`/studio`).",
    icon: Sparkles,
    tag: "Ideate",
  },
  {
    num: "4",
    title: "Refine Drafts & Submit to Approval Pipeline",
    desc: "In Studio, compose copy, optimize hooks, and run compliance checks. When ready, submit the draft to the approval pipeline (`/approvals`) for team and client sign-off.",
    icon: ShieldCheck,
    tag: "Review",
  },
  {
    num: "5",
    title: "Schedule on Calendar & Monitor Live Drift",
    desc: "Drop approved posts into the content calendar (`/calendar`) and track performance drift in the Cockpit (`/cockpit`) to continuously elevate content ROI.",
    icon: Calendar,
    tag: "Publish & Learn",
  },
];

const coreModules = [
  {
    icon: BookOpen,
    name: "Living Knowledge Base",
    route: "/kb & /docs",
    accent: "text-brand-teal",
    borderColor: "border-brand-teal/20",
    desc: "Central repository storing tone guides, approved messaging, product specs, and customer research with deep semantic search and strict client isolation.",
  },
  {
    icon: Cpu,
    name: "Brand DNA & Rules Engine",
    route: "/brand-gene & /rules",
    accent: "text-brand-purple",
    borderColor: "border-brand-purple/20",
    desc: "Configurable rule sets, voice sliders, forbidden tokens, and scoring weights that enforce strict brand consistency across all AI outputs.",
  },
  {
    icon: Sparkles,
    name: "Predictive Ideation Engine",
    route: "/ideation",
    accent: "text-brand-amber",
    borderColor: "border-brand-amber/20",
    desc: "Generate dozens of defensible content angles with objective performance scoring based on client historical benchmarks and audience resonance.",
  },
  {
    icon: Workflow,
    name: "Creative Studio & Compliance",
    route: "/studio",
    accent: "text-brand-teal",
    borderColor: "border-brand-teal/20",
    desc: "Rich drafting suite for multi-slide carousels, video scripts, and captions with automated real-time compliance checks and AI hook generation.",
  },
  {
    icon: Calendar,
    name: "Multi-Channel Calendar",
    route: "/calendar & /automations",
    accent: "text-brand-purple",
    borderColor: "border-brand-purple/20",
    desc: "Visual schedule coordinating cross-platform releases, tracking production bottlenecks, and triggering webhook automation dispatches.",
  },
  {
    icon: BarChart3,
    name: "Drift Detection & Cockpit",
    route: "/drift & /cockpit",
    accent: "text-brand-amber",
    borderColor: "border-brand-amber/20",
    desc: "Continuous telemetry tracking brand drift, approval cycle times, and audience engagement to complete the learning loop.",
  },
];

const roleGuidance = [
  {
    role: "Agency Leaders & Strategists",
    focus: "Scale Client Capacity Without Headcount",
    bullets: [
      "Maintain 100% brand voice consistency across dozens of concurrent client workspaces.",
      "Track production velocity, client turnaround times, and approval bottlenecks in the Cockpit.",
      "Eliminate repetitive onboarding with persistent, self-updating knowledge bases.",
    ],
  },
  {
    role: "Content Writers & Creative Leads",
    focus: "Eliminate Blank Page Syndrome & Rework",
    bullets: [
      "Generate high-conviction ideas backed by proven historical performance baselines.",
      "Craft multi-platform captions, hooks, and briefs with real-time compliance safeguards.",
      "Speed up client review cycles with structured visual diffs and in-context revisions.",
    ],
  },
  {
    role: "Brand Clients & Stakeholders",
    focus: "Zero-Friction Review & Total Control",
    bullets: [
      "Review and approve scheduled posts from a clean, distraction-free portal view.",
      "Ensure legal compliance and approved messaging without micro-managing every draft.",
      "See direct metrics on how content aligns with core strategic pillars.",
    ],
  },
];

const faqs = [
  {
    q: "How does InstaMedia AI ensure one client's data never leaks to another?",
    a: "Every client operates within a strictly isolated workspace (`/w/[workspace-slug]`). Knowledge bases, custom rules, historical performance data, and prompts are partitioned at the database and retrieval layers.",
  },
  {
    q: "What makes the Ideation Engine 'defensible' compared to generic ChatGPT prompts?",
    a: "Generic AI tools guess in a vacuum. InstaMedia AI scores each idea against your client's baseline performance data, past high-performing formats, and strict brand DNA rules, giving you a transparent scoring breakdown.",
  },
  {
    q: "How do we get started with a new client?",
    a: "Create a workspace, upload the client's brand guide, past top 10 social posts, and product documentation into the Knowledge Base (`/kb`). Set up your tone rules in Brand DNA, and you can immediately generate compliant, scored ideas.",
  },
  {
    q: "Can team members have different permission levels?",
    a: "Yes. Workspaces support role-based permissions separating writers/creators (who draft and ideate), creative leads (who review and assign), and client stakeholders (who have one-click approval permissions).",
  },
];

export default function LandingPage() {
  return (
    <GradientBackdrop>
      <PillNav />

      <main className="mx-auto max-w-6xl px-6 pb-28 pt-36 sm:pt-44">
        {/* ================= HERO SECTION ================= */}
        <section className="mx-auto max-w-4xl text-center" id="hero">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-teal/30 bg-brand-teal/10 px-4 py-1.5 backdrop-blur-md">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-teal" />
            <span className="label-mono text-[11px] font-semibold text-brand-teal tracking-wider">
              Agency Operating System &amp; Content Engine
            </span>
          </div>

          <h1 className="mt-7 text-balance font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl">
            Every client workspace.{" "}
            <span className="bg-gradient-to-r from-brand-teal via-teal-300 to-brand-purple bg-clip-text italic text-transparent">
              One living content engine.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
            InstaMedia AI turns raw client brand guidelines, offers, and historical metrics into
            an autonomous, baseline-driven social content machine — from continuous ingestion
            to predictive ideation, studio drafting, and automated calendar publishing.
          </p>

          {/* Action buttons */}
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Button
              asChild
              size="lg"
              className="rounded-full bg-brand-teal px-8 text-slate-950 font-semibold shadow-lg shadow-brand-teal/25 transition hover:bg-brand-teal/90 hover:scale-[1.02]"
            >
              <Link href="/login" className="flex items-center gap-2">
                <span>Enter Workspace</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-white/20 bg-white/5 px-8 text-slate-100 backdrop-blur-md transition hover:bg-white/10 hover:text-white"
            >
              <a href="#playbook" className="flex items-center gap-2">
                <span>Operational Playbook</span>
              </a>
            </Button>
          </div>

          {/* Quick Stats Banner */}
          <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-center backdrop-blur-lg"
              >
                <span className={`font-display text-2xl font-bold sm:text-3xl ${s.accent}`}>
                  {s.value}
                </span>
                <span className="mt-1 text-xs font-medium text-slate-400">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ================= OPERATIONAL PLAYBOOK ================= */}
        <section id="playbook" className="mt-32 scroll-mt-24">
          <div className="text-center">
            <p className="label-mono font-semibold text-brand-teal">System Architecture</p>
            <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight text-white sm:text-5xl">
              How to Operationalize InstaMedia AI
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
              A continuous 6-phase operating loop that replaces disconnected spreadsheets,
              guesswork, and endless review cycles with a governed, baseline-backed production pipeline.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {operationalPlaybook.map((stage) => (
              <GlassCard
                key={stage.step}
                className="flex flex-col justify-between border-white/10 bg-slate-900/70 p-7 transition hover:border-white/25 hover:bg-slate-900/90"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-2xl font-bold text-slate-500">
                      {stage.step}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${stage.badgeBg}`}
                    >
                      {stage.route}
                    </span>
                  </div>

                  <p className={`mt-3 text-xs font-semibold uppercase tracking-wider ${stage.accent}`}>
                    {stage.phase}
                  </p>
                  <h3 className="mt-2 font-display text-xl font-bold text-white">
                    {stage.title}
                  </h3>
                  <p className="mt-3 text-xs leading-relaxed text-slate-300 sm:text-sm">
                    {stage.description}
                  </p>
                </div>

                <div className="mt-6 border-t border-white/10 pt-4">
                  <p className="label-mono text-[10px] text-slate-400">Core Capabilities</p>
                  <ul className="mt-2.5 space-y-1.5 text-xs text-slate-300">
                    {stage.highlights.map((h, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${stage.accent}`} />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </GlassCard>
            ))}
          </div>
        </section>

        {/* ================= HOW TO USE THIS APPLICATION ================= */}
        <section id="how-to-use" className="mt-32 scroll-mt-24">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950 p-8 sm:p-12">
            <div className="text-center">
              <span className="label-mono font-semibold text-brand-purple">User Playbook</span>
              <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
                How to Use This Application in 5 Steps
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-slate-300">
                Follow this quick workflow inside your workspace to go from raw assets to
                published, compliant content.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {howToUseSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.num}
                    className="relative flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-950/70 p-6 backdrop-blur-md transition hover:border-white/20"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-purple/10 border border-brand-purple/30 text-brand-purple font-bold">
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-[10px] font-mono text-slate-400">
                          {step.tag}
                        </span>
                      </div>
                      <h4 className="mt-4 font-display text-base font-bold text-white">
                        {step.num}. {step.title}
                      </h4>
                      <p className="mt-2 text-xs leading-relaxed text-slate-300">
                        {step.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================= CORE MODULES ================= */}
        <section id="modules" className="mt-32 scroll-mt-24">
          <div className="text-center">
            <p className="label-mono font-semibold text-brand-amber">Platform Anatomy</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-5xl">
              Engineered for End-to-End Content Operations
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Every tool within InstaMedia AI is interconnected to ensure real-time data flows
              from knowledge ingestion directly into ideation, drafting, and post analytics.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {coreModules.map((mod) => {
              const Icon = mod.icon;
              return (
                <GlassCard
                  key={mod.name}
                  className={`flex flex-col justify-between border ${mod.borderColor} bg-slate-900/60 p-6 transition hover:bg-slate-900/90 hover:scale-[1.01]`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 border border-white/10">
                        <Icon className={`h-5 w-5 ${mod.accent}`} />
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">{mod.route}</span>
                    </div>
                    <h3 className="mt-5 font-display text-lg font-bold text-white">
                      {mod.name}
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-slate-300 sm:text-sm">
                      {mod.desc}
                    </p>
                  </div>
                  <div className="mt-5 border-t border-white/10 pt-3">
                    <span className={`text-xs font-semibold flex items-center gap-1.5 ${mod.accent}`}>
                      <span>Active in Workspace</span>
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </section>

        {/* ================= ROLE-BASED OPERATIONAL MATRIX ================= */}
        <section className="mt-32">
          <div className="text-center">
            <p className="label-mono font-semibold text-brand-teal">Team Alignment</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
              Built for Every Stakeholder in the Agency
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-slate-300">
              Clear divisions of responsibility to accelerate output without compromising quality.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {roleGuidance.map((role) => (
              <div
                key={role.role}
                className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-7 backdrop-blur-lg"
              >
                <div>
                  <h3 className="font-display text-xl font-bold text-white">{role.role}</h3>
                  <p className="mt-1 text-xs font-medium text-brand-teal">{role.focus}</p>
                  <ul className="mt-5 space-y-2.5 text-xs text-slate-300">
                    {role.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ================= QUICKSTART ONBOARDING ================= */}
        <section id="quickstart" className="mt-32 scroll-mt-24">
          <GlassCard className="border-brand-teal/30 bg-gradient-to-r from-slate-900/90 via-slate-900/70 to-brand-teal/10 p-8 sm:p-12">
            <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl">
                <span className="label-mono text-brand-teal font-semibold">Quickstart Setup</span>
                <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
                  Deploy Your First Client Workspace in Minutes
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  Ready to operationalize? Sign in, name your client workspace, ingest their core brand
                  materials, and generate your first batch of baseline-scored content immediately.
                </p>
                <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-300">
                  <span className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1">
                    <Check className="h-3.5 w-3.5 text-brand-teal" /> Multi-tenant isolation
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1">
                    <Check className="h-3.5 w-3.5 text-brand-teal" /> Real-time compliance checking
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1">
                    <Check className="h-3.5 w-3.5 text-brand-teal" /> Instant calendar sync
                  </span>
                </div>
              </div>

              <div className="shrink-0">
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-brand-teal px-8 py-6 text-base font-semibold text-slate-950 shadow-xl shadow-brand-teal/30 hover:bg-brand-teal/90 hover:scale-[1.02] transition"
                >
                  <Link href="/login" className="flex items-center gap-2">
                    <span>Launch Workspace</span>
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
              </div>
            </div>
          </GlassCard>
        </section>

        {/* ================= FAQ SECTION ================= */}
        <section id="faq" className="mt-32 scroll-mt-24">
          <div className="text-center">
            <p className="label-mono font-semibold text-brand-purple">Knowledge &amp; Support</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
              Frequently Asked Operational Questions
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-slate-300">
              Clear answers on security, scoring models, and production integration.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {faqs.map((f, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-md"
              >
                <h4 className="font-display text-base font-bold text-white">{f.q}</h4>
                <p className="mt-3 text-xs leading-relaxed text-slate-300 sm:text-sm">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-white/10 bg-[#05070d] py-12">
        <div className="mx-auto max-w-6xl px-6 flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="font-display text-base font-bold text-white">InstaMedia AI</span>
            <span className="text-slate-500">·</span>
            <p className="label-mono text-xs text-slate-400">
              Agency Operating System
            </p>
          </div>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} InstaMedia AI. All rights reserved.
          </p>
        </div>
      </footer>
    </GradientBackdrop>
  );
}

