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
}

export {};
