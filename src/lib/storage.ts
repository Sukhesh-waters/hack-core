import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Private bucket. Created once by hand in the Supabase dashboard. */
export const ASSETS_BUCKET = "workspace-assets";

/**
 * Surfaced verbatim by actionErrorMessage — same treatment as
 * PermissionError. A storage failure that reads "Something went wrong" turns
 * a fixable config problem into a support ticket.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Degradation-ladder switch, same shape as bedrockConfigured() in
 * src/lib/flags.ts. Absence disables the feature visibly; it never serves
 * wrong data, which is why SUPABASE_SERVICE_ROLE_KEY is deliberately NOT in
 * the required-in-production list in src/lib/env.ts.
 */
export function storageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

let cached: SupabaseClient | null = null;

/** Test-only seam: env is read once per client, so a test that changes env
 *  must be able to drop the memoised client. */
export function __resetStorageClientForTests(): void {
  cached = null;
}

function storageClient(): SupabaseClient {
  if (!storageConfigured()) {
    throw new StorageError(
      "File storage isn't configured — set SUPABASE_SERVICE_ROLE_KEY in the environment, then retry.",
    );
  }
  cached ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}

export async function putObject(
  path: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const { error } = await storageClient()
    .storage.from(ASSETS_BUCKET)
    // upsert:false — paths carry a fresh UUID, so a collision means a bug,
    // and silently overwriting someone's file is the worst way to find out.
    .upload(path, body, { contentType, upsert: false });
  if (error) throw new StorageError(`Upload failed: ${error.message}`);
}

export async function removeObject(path: string): Promise<void> {
  const { error } = await storageClient()
    .storage.from(ASSETS_BUCKET)
    .remove([path]);
  if (error) throw new StorageError(`Delete failed: ${error.message}`);
}

/**
 * Short-lived signed URL. The bucket is private, so this is the only way
 * bytes leave. 60 seconds is enough for a click-to-download and short enough
 * that a leaked URL in a log or a chat is worthless by the time it is read.
 */
export async function signedUrlFor(
  path: string,
  expiresInSeconds = 60,
): Promise<string> {
  const { data, error } = await storageClient()
    .storage.from(ASSETS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw new StorageError(`Download link failed: ${error.message}`);
  if (!data?.signedUrl) {
    throw new StorageError("Download link failed: storage returned no URL.");
  }
  return data.signedUrl;
}

/**
 * Downloads object bytes directly from the private bucket on the server.
 * Used by knowledge ingest and asset processing pipelines.
 */
export async function getObject(path: string): Promise<ArrayBuffer> {
  const { data, error } = await storageClient()
    .storage.from(ASSETS_BUCKET)
    .download(path);
  if (error) throw new StorageError(`Download failed: ${error.message}`);
  if (!data) throw new StorageError("Download failed: storage returned no data.");
  return data.arrayBuffer();
}
