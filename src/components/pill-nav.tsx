import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const links = [
  { label: "Playbook", href: "#playbook" },
  { label: "How to Use", href: "#how-to-use" },
  { label: "Core Modules", href: "#modules" },
  { label: "Quickstart", href: "#quickstart" },
  { label: "FAQ", href: "#faq" },
];

/** Floating glass pill navigation for the marketing layer. */
export function PillNav() {
  return (
    <header className="fixed inset-x-0 top-5 z-50 flex justify-center px-4">
      <nav className="glass flex w-full max-w-4xl items-center justify-between rounded-full px-4 py-2 text-foreground shadow-2xl backdrop-blur-xl transition">
        <BrandMark className="text-foreground text-base md:text-lg pl-2" />
        
        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            className="rounded-full bg-brand-teal px-4 font-medium text-primary-foreground shadow-md shadow-brand-teal/20 transition hover:bg-brand-teal/90 hover:shadow-brand-teal/40"
          >
            <Link href="/login" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <span>Sign In</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}


