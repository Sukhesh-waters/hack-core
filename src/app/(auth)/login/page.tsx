import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { GlassCard } from "@/components/glass-card";
import { GradientBackdrop } from "@/components/gradient-backdrop";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { signInWithDevBypass, signInWithGoogle } from "./actions";
import { safeCallbackUrl } from "./callback-url";
import { EmailForm } from "./email-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage(
  props: {
    searchParams: Promise<{ sent?: string; error?: string; callbackUrl?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const callbackUrl = safeCallbackUrl(searchParams.callbackUrl);
  const session = await auth();
  if (session?.user) redirect(callbackUrl);

  return (
    <GradientBackdrop className="flex items-center justify-center px-4 py-16">
      <GlassCard className="w-full max-w-md p-8 text-center">
        <BrandMark className="text-2xl text-foreground" />
        <h1 className="mt-6 font-display text-3xl">Welcome back</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to your agency&apos;s workspaces.
        </p>

        {searchParams.sent ? (
          <div className="mt-6 rounded-xl border border-brand-success/30 bg-brand-success/10 p-4 text-sm text-brand-success">
            Check your inbox — we sent you a sign-in link.
          </div>
        ) : null}
        {searchParams.error ? (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Sign-in failed ({searchParams.error}). Try again.
          </div>
        ) : null}

        <form action={signInWithGoogle.bind(null, callbackUrl)} className="mt-8">
          <Button
            type="submit"
            variant="outline"
            className="w-full rounded-full border-border bg-muted text-foreground hover:bg-accent hover:text-foreground"
          >
            Continue with Google
          </Button>
        </form>

        <div className="my-6 flex items-center gap-4">
          <Separator className="flex-1 bg-accent" />
          <span className="label-mono text-muted-foreground/50">or</span>
          <Separator className="flex-1 bg-accent" />
        </div>

        <EmailForm callbackUrl={callbackUrl} />

        {process.env.NODE_ENV !== "production" &&
        process.env.AUTH_DEV_BYPASS === "true" ? (
          <form action={signInWithDevBypass.bind(null, callbackUrl)} className="mt-4">
            <Button
              type="submit"
              variant="outline"
              className="w-full rounded-full border-brand-amber/30 bg-brand-amber/5 text-brand-amber hover:bg-brand-amber/10 hover:text-brand-amber"
            >
              Dev bypass (non-production only)
            </Button>
          </form>
        ) : null}
      </GlassCard>
    </GradientBackdrop>
  );
}
