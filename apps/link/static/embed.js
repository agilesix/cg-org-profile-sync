/**
 * The embed loader: put the Link widget in an overlay on a host page.
 *
 * Served from Link's own origin and included by the host, the way Plaid's
 * `link-initialize.js` is — so the widget and the script that mounts it are
 * always the same version, and a host upgrades by doing nothing.
 *
 * Plain script, no bundling and no framework: it has to run on whatever a
 * grant system's own pages are built with. Kept small enough to read in one
 * sitting, because it is the one piece of this demo that runs inside somebody
 * else's page.
 *
 *   CgLink.open({
 *     linkOrigin: "http://localhost:5176",
 *     registry: "org:us:ein",
 *     id: "123456789",
 *     host: "portal",
 *     token: "<an access token for that host>",
 *     onSynced: function (message) { ... },
 *     onClose: function () { ... },
 *   });
 */

(function () {
  "use strict";

  /** The overlay currently mounted, if any. One widget at a time. */
  var current = null;

  /**
   * Mount the widget over the host page.
   *
   * Returns a handle with `close()`, so a host that wants to dismiss the frame
   * itself does not have to go looking for the element.
   */
  function open(options) {
    var settings = options || {};

    if (current) {
      // Already open. Opening twice would stack two frames over each other and
      // leave the first one listening, which is a confusing way to do nothing.
      return current;
    }

    var frameOrigin = originOf(settings.linkOrigin);

    if (!frameOrigin) {
      throw new Error("CgLink.open needs a linkOrigin, such as http://localhost:5176");
    }

    var overlay = document.createElement("div");
    overlay.setAttribute("data-testid", "cg-link-overlay");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(9,20,19,0.55);";

    var frame = document.createElement("iframe");
    frame.setAttribute("data-testid", "cg-link-frame");
    frame.setAttribute("title", "CommonGrants Link");
    frame.src = frameUrl(frameOrigin, settings);
    frame.style.cssText =
      "width:min(60rem,94vw);height:min(46rem,92vh);border:0;border-radius:0.5rem;" +
      "background:#f5f7f6;box-shadow:0 1.5rem 3rem rgba(0,0,0,0.35);";

    overlay.appendChild(frame);
    document.body.appendChild(overlay);

    /**
     * Everything the widget says, and nothing anyone else does.
     *
     * Both checks matter and neither is enough alone: `message` fires for
     * anything any window posts, so the origin check is what stops another
     * page claiming a sync happened — and the source check is what stops one
     * frame on this page speaking for another.
     */
    function onMessage(event) {
      if (event.origin !== frameOrigin || event.source !== frame.contentWindow) {
        return;
      }

      var message = event.data;

      if (!message || typeof message.type !== "string") {
        return;
      }

      if (message.type === "cg-link:ready") {
        // The frame says it is listening. Only now is there anything to post
        // to: a message sent on the iframe's `load` can arrive before the
        // widget has attached its handler, and would simply be dropped.
        //
        // Targeted at `frameOrigin`, never `"*"`. This is an access token; a
        // wildcard target would hand it to whatever document happened to
        // occupy the frame.
        if (settings.token) {
          frame.contentWindow.postMessage(
            { type: "cg-link:host-token", token: settings.token },
            frameOrigin,
          );
        }
      } else if (message.type === "cg-link:synced") {
        if (typeof settings.onSynced === "function") {
          settings.onSynced(message);
        }
      } else if (message.type === "cg-link:close") {
        close();
      }
    }

    /** Escape closes it too, so a frame that will not load is not a dead end. */
    function onKeydown(event) {
      if (event.key === "Escape") {
        close();
      }
    }

    function close() {
      if (current !== handle) {
        return;
      }

      window.removeEventListener("message", onMessage);
      document.removeEventListener("keydown", onKeydown);

      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }

      current = null;

      if (typeof settings.onClose === "function") {
        settings.onClose();
      }
    }

    var handle = { close: close };

    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKeydown);
    current = handle;

    return handle;
  }

  /**
   * The widget's URL, carrying the org and who is framing it.
   *
   * `parent` is this page's origin. Link checks it against its own allow-list
   * before posting anything back, so sending it is a request rather than a
   * permission — but without it Link has nowhere to answer.
   */
  function frameUrl(frameOrigin, settings) {
    var params = new URLSearchParams({ parent: window.location.origin });

    if (settings.registry) params.set("registry", settings.registry);
    if (settings.id) params.set("id", settings.id);
    if (settings.host) params.set("host", settings.host);

    return frameOrigin + "/?" + params.toString();
  }

  /** One value as its origin, or nothing if it is not a usable absolute URL. */
  function originOf(value) {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }

  window.CgLink = { open: open };
})();
