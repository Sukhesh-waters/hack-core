import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * No @tailwindcss/typography plugin in this repo (confirmed absent from
 * tailwind.config.ts) — style each markdown element explicitly via
 * ReactMarkdown's `components` override instead of relying on an unstyled
 * "prose" class. Tailwind-only, no inline styles.
 */
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 font-display text-2xl first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 font-display text-xl first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 text-base font-semibold text-foreground">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground first:mt-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-brand-teal underline underline-offset-2 hover:text-brand-teal/80"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-accent px-1 py-0.5 font-mono text-xs text-brand-teal">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-black/30 p-3 text-xs">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 border-brand-teal/40 pl-3 text-sm italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2 py-1 text-left text-xs text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-xs text-muted-foreground">
      {children}
    </td>
  ),
  hr: () => <hr className="mt-4 border-border" />,
};

/**
 * Plain Server Component — no "use client" directive. This is the file that
 * actually executes react-markdown + remark-gfm, so Next.js renders it on
 * the server and the parser never ships to the client bundle for this
 * route (see doc-detail.tsx, which only needs client state for the
 * view/edit toggle and receives this component's output as a prop).
 *
 * ReactMarkdown escapes HTML by default (no dangerouslySetInnerHTML
 * anywhere in this feature) — see jira-confluence-plan.md D1: "never
 * dangerouslySetInnerHTML raw markdown without a sanitizer." Moving the
 * render from client to server changes WHERE this runs, not HOW it
 * escapes — that property is unchanged.
 */
export function RenderedDocBody({ body }: { body: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {body}
    </ReactMarkdown>
  );
}
