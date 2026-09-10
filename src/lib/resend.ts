import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;

if (!apiKey) {
  console.warn("WARNING: RESEND_API_KEY or AUTH_RESEND_KEY is not defined. Email operations will fail.");
}

// Placeholder keeps the production build alive when the key is unset;
// sends fail at call time with a clear error instead of at import time.
export const resend = new Resend(apiKey ?? "re_key_not_configured");
