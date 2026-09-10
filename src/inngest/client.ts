import { Inngest } from "inngest";

/** Single Inngest client — all scheduled/background work registers here. */
export const inngest = new Inngest({ id: "instamedia-ai" });
