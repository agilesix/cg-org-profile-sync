// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Principal } from "@cg-link/org-sync/server";

declare global {
  namespace App {
    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }

    interface Locals {
      /**
       * Who this request is, set by the guard in `hooks.server.ts`.
       *
       * Optional because it is set on `/common-grants/*` and nowhere else, and
       * because that is the honest shape: `scopedStore` grants an absent
       * principal nothing, so a route mounted outside the guard by mistake
       * serves an empty store rather than every profile.
       */
      principal?: Principal;
    }

    // interface Error {}
    // interface PageData {}
    // interface PageState {}
  }

  /**
   * The embed loader Link serves from its own origin.
   *
   * Declared rather than imported: `embed.js` is a plain script fetched from
   * another origin at runtime, so there is no module here to get a type from.
   * This is the contract that script promises, written down where the page
   * that calls it can be held to it.
   */
  interface CgLinkOptions {
    /** Where Link is served from. The frame and its messages both come from here. */
    linkOrigin: string;

    /** The identifier registry and id the widget should look the org up by. */
    registry?: string;
    id?: string;

    /** Which system's page this is, so the widget can name its host. */
    host?: string;

    /** A sync finished inside the frame. `results` is one entry per target. */
    onSynced?: (message: { targets?: string[]; results?: unknown }) => void;

    /** The frame has been taken away, whether by the widget or by Escape. */
    onClose?: () => void;
  }

  interface Window {
    CgLink?: { open: (options: CgLinkOptions) => { close: () => void } };
  }
}

export {};
