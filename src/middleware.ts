import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge middleware uses the adapter-free config: it only checks the JWT
// session cookie; unauthenticated users are redirected to /login.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    "/hub/:path*",
    "/hub",
    "/org/:path*",
    "/workspace/:path*",
    "/join/:path*",
    "/join",
    "/w/:path*",
  ],
};
