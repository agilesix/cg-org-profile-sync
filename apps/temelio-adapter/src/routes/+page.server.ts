import { temelioMode } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

/**
 * Which Temelio this adapter is in front of.
 *
 * On the page as well as in the start-up log, because the log line scrolls
 * away and the person who needs this most is a presenter checking, thirty
 * seconds before a demo, that the thing about to be shown is the real
 * integration and not the stand-in.
 */
export const load: PageServerLoad = () => ({ mode: temelioMode() });
