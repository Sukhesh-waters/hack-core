import { z } from "zod";

/** Plain module (not "use server") so these schemas are importable in tests —
 *  server-action files can only export async functions. */
export const sendReportSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  audience: z.enum(["team", "client"]),
  body: z.string().trim().min(1, "Report body can't be empty"),
});

/** Client contact-email field: trims, accepts a valid email or empty
 *  string, and maps "" to null (no contact email on file). */
export const contactEmailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address")
  .or(z.literal(""))
  .transform((value) => (value === "" ? null : value));
