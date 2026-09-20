import { Inngest } from "inngest";

/**
 * Single Inngest client — all scheduled/background work registers here.
 * The app id is an external identifier (Inngest keys its registered
 * functions and run history on it), so it keeps the pre-rebrand value:
 * changing it would orphan every scheduled function. Rename deliberately, in
 * the Inngest dashboard too, not as part of a text rebrand.
 */
export const inngest = new Inngest({ id: "instamedia-ai" });
