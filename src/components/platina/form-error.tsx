/**
 * Renders a refusal handed back by a gate action through `?error=`.
 */
export function PlatinaFormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      {message}
    </p>
  );
}
