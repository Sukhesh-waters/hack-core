"use server";

import { DEV_BYPASS_EMAIL, signIn } from "@/auth";
import { emailSchema } from "@/lib/validation";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { safeCallbackUrl } from "./callback-url";

export async function signInWithGoogle(callbackUrl: string) {
  await signIn("google", { redirectTo: safeCallbackUrl(callbackUrl) });
}

/** Dev-only — the "dev-bypass" provider itself only exists in src/auth.ts
 *  when NODE_ENV !== "production" && AUTH_DEV_BYPASS === "true"; this action
 *  is inert (signIn throws) if that provider was never registered. */
export async function signInWithDevBypass(callbackUrl: string) {
  await signIn("dev-bypass", {
    email: DEV_BYPASS_EMAIL,
    redirectTo: safeCallbackUrl(callbackUrl),
  });
}

export type EmailSignInState = { error?: string } | undefined;

export async function signInWithEmail(
  _prev: EmailSignInState,
  formData: FormData,
): Promise<EmailSignInState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl") as string | null);
  try {
    await signIn("resend", {
      email: parsed.data.email,
      redirect: false,
      callbackUrl,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: error.message };
    }
    return { error: "Failed to send magic link." };
  }
  redirect("/login?sent=1");
}
