import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellProvider } from "@/components/app-shell-provider";
import { MobileNavTrigger } from "@/components/mobile-nav-trigger";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <AppShellProvider>
      <div className="flex h-screen gap-3 overflow-hidden bg-background p-3 text-foreground">
        <AppSidebar user={session.user} />
        <main className="relative flex-1 overflow-y-auto rounded-2xl border border-border bg-card shadow-sm">
          {/* Mobile Top Bar with Burger Trigger */}
          <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border/50 bg-background/70 px-4 py-2.5 backdrop-blur-md md:hidden">
            <div className="flex items-center gap-3">
              <MobileNavTrigger />
              <span className="font-display font-semibold text-sm">InstaMedia AI</span>
            </div>
          </div>

          {/* Decorative wash. Sticky (not absolute) so it stays put against the
              viewport instead of scrolling away with the content, and only the
              soft top-corner tint remains. */}
          <div
            aria-hidden
            className="pointer-events-none sticky top-0 z-0 -mb-[100vh] h-[100vh] bg-[radial-gradient(700px_400px_at_80%_0%,rgba(139,92,246,0.12),transparent_60%)]"
          />
          <div className="relative z-10">
            {children}
          </div>
        </main>
      </div>
    </AppShellProvider>
  );
}
