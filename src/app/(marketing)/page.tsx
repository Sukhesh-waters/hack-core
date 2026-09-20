import Link from "next/link";
import { ArrowRight, GitBranchPlus, MessageSquareText, Repeat2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { GlassCard } from "@/components/glass-card";
import { GradientBackdrop } from "@/components/gradient-backdrop";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: MessageSquareText,
    title: "Write a two-line brief",
    body: "Say what you are promoting and who it is for. Nothing else is needed to start.",
  },
  {
    icon: GitBranchPlus,
    title: "Get a visual roadmap",
    body: "A phased plan laid out on a timeline, with channels and messages you can read at a glance.",
  },
  {
    icon: Repeat2,
    title: "Log what happened",
    body: "Mark plans as worked, mixed or failed. The next plan starts from those lessons.",
  },
];

export default function LandingPage() {
  return (
    <GradientBackdrop className="min-h-screen px-4">
      <header className="mx-auto flex max-w-5xl items-center justify-between py-6">
        <BrandMark />
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl pb-24 pt-16 sm:pt-24">
        <p className="label-mono text-brand-teal">Campaign planning</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight sm:text-6xl">
          A campaign plan from two lines, that gets better every time.
        </h1>
        <p className="mt-6 max-w-xl text-base text-muted-foreground">
          Platina AI OS turns a short brief into a phased roadmap, then learns
          from the results you record, so each plan builds on what worked.
        </p>
        <div className="mt-8">
          <Button asChild className="rounded-full bg-brand-teal text-foreground hover:bg-brand-teal/90">
            <Link href="/login">
              Start planning <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>

        <ol className="mt-20 grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title}>
              <GlassCard className="h-full p-6">
                <Icon className="h-5 w-5 text-brand-purple" aria-hidden />
                <p className="label-mono mt-4 text-muted-foreground/70">Step {i + 1}</p>
                <h2 className="mt-1 font-display text-xl">{title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </GlassCard>
            </li>
          ))}
        </ol>
      </main>
    </GradientBackdrop>
  );
}
