import { z } from "zod";

export const BRIEF_MIN_CHARS = 10;
export const BRIEF_MAX_CHARS = 400;
export const BRIEF_MAX_LINES = 2;

/** The two-line brief: what is being promoted and who it is for. */
export const briefSchema = z
  .string()
  .transform((raw) => raw.replace(/\r\n/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(BRIEF_MIN_CHARS, "Add a little more detail: what is it, and who is it for?")
      .max(BRIEF_MAX_CHARS, "Keep the brief short: two lines is plenty.")
      .refine(
        (text) =>
          text.split("\n").filter((line) => line.trim().length > 0).length <=
          BRIEF_MAX_LINES,
        `Keep the brief to ${BRIEF_MAX_LINES} lines.`,
      ),
  );
