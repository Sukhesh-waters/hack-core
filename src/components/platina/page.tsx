export function PlatinaPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </p>
      <h1 className="mb-6 font-display text-3xl">{title}</h1>
      {children}
    </div>
  );
}
