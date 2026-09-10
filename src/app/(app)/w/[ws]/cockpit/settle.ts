export function resolved<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  failed: string[],
): T {
  if (result.status === "fulfilled") return result.value;
  failed.push(label);
  return fallback;
}
