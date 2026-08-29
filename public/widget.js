/**
 * The one line an agency pastes into a client's site.
 *
 *   <script src="https://YOUR-DEPLOYMENT/widget.js" defer></script>
 *
 * Everything the visitor sees lives in an iframe. That is the point, not a
 * shortcut: the host page is a Squarespace, WordPress or Webflow theme we have
 * never seen, and an inline widget inherits its resets, its z-index stack and
 * its fonts. The iframe also keeps the chat request same-origin with the API,
 * so installing this needs no CORS on either side.
 *
 * The launcher itself sits in a shadow root so the theme's `button {}` rules
 * cannot reach it, and it is a real <button>: replacing it with a styled <div>
 * would take it out of the accessibility tree and off the keyboard.
 */
(function () {
  "use strict";

  // `defer` keeps document.currentScript set while this runs. It is null when
  // the tag was injected dynamically or marked async, and a widget that just
  // vanishes is a support ticket nobody can answer: say why, and offer a way
  // out that this file actually implements. An earlier version of this message
  // told the reader to set window.groundedChatSrc and then never looked at it.
  var script = document.currentScript;
  var configured = window.groundedChat;
  if (!script && !configured) {
    if (window.console) {
      console.warn(
        "[grounded-chat] widget.js could not find its own <script> tag, which " +
        "happens when it is injected dynamically or loaded with async. Either " +
        "load it as <script src=\"…/widget.js\" defer>, or set " +
        "window.groundedChat = { src: \"…/widget.js\" } before it runs.",
      );
    }
    return;
  }

  function setting(name, fallback) {
    if (script) {
      var attr = script.getAttribute("data-" + name);
      if (attr !== null && attr !== "") return attr;
    }
    if (configured && configured[name]) return configured[name];
    return fallback;
  }

  var src;
  try {
    src = new URL(
      script ? script.src : configured.src,
      window.location.href,
    );
  } catch (e) {
    if (window.console) console.warn("[grounded-chat] widget.js has no usable src", e);
    return;
  }

  var label = setting("label", "Ask us");
  var heading = setting("title", label);
  // Bottom-right is the convention; a site whose own controls live there can
  // move it rather than have two things fight over the same corner.
  var side = setting("side", "right") === "left" ? "left" : "right";
  // Interpolated into a stylesheet below, so it is validated rather than
  // trusted: `red; } .panel { display: block` would otherwise close our rule
  // and write new ones into the shadow root, including one that forces the
  // panel open on every page load.
  var accent = setting("accent", "");
  if (!/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^[a-z]{3,20}$/i.test(accent)) {
    if (accent && window.console) {
      console.warn("[grounded-chat] ignoring data-accent " + JSON.stringify(accent) +
        " — use a hex colour like #111827 or a plain CSS colour name");
    }
    accent = "#111827";
  }

  var mounted = false;

  function mount() {
    if (mounted) return;
    mounted = true;

    var host = document.createElement("div");
    host.setAttribute("data-grounded-chat", "");
    if (!host.attachShadow) {
      // Falling back to a plain div was worse than not rendering: the
      // stylesheet below is written for a shadow root, so without one its
      // `.wrap` / `.launch` / `.panel` rules escape into the client's page and
      // restyle whatever already uses those class names.
      if (window.console) {
        console.warn("[grounded-chat] this browser has no shadow DOM; widget not loaded");
      }
      return;
    }
    var root = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = [
      ":host { all: initial; }",
      ".wrap {",
      "  position: fixed; bottom: 20px; " + side + ": 20px;",
      "  z-index: 2147483000;",
      "  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;",
      "}",
      ".launch {",
      "  display: inline-flex; align-items: center; gap: 8px;",
      "  min-height: 48px; padding: 0 20px;",
      "  border: 0; border-radius: 999px; cursor: pointer;",
      "  background: " + accent + "; color: #fff;",
      "  font: inherit; font-size: 15px; font-weight: 600; line-height: 1;",
      "  box-shadow: 0 6px 24px rgba(0,0,0,.22);",
      "}",
      ".launch:hover { filter: brightness(1.12); }",
      ".launch:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }",
      ".panel {",
      "  position: fixed; bottom: 84px; " + side + ": 20px;",
      "  width: min(400px, calc(100vw - 32px));",
      "  height: min(620px, calc(100dvh - 120px));",
      "  border: 0; border-radius: 16px; overflow: hidden;",
      "  background: #fff;",
      "  box-shadow: 0 18px 60px rgba(0,0,0,.28);",
      "  display: none;",
      "}",
      ".panel.open { display: block; }",
      ".panel iframe { width: 100%; height: 100%; border: 0; display: block; }",
      // A phone has no room for a floating card, and a 400px panel over a
      // 360px viewport is a panel with the site showing through the gap.
      "@media (max-width: 480px) {",
      "  .panel { inset: 0; width: 100%; height: 100dvh; border-radius: 0; }",
      "}",
      "@media (prefers-reduced-motion: reduce) { .launch { transition: none; } }",
    ].join("\n");

    var wrap = document.createElement("div");
    wrap.className = "wrap";

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "grounded-chat-panel";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "launch";
    button.textContent = label;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", panel.id);

    var frame = null;

    function open() {
      if (!frame) {
        // Built on first open, not on page load: an assistant nobody clicks
        // should not cost the visitor a second page load, and it should not
        // put a model-backed endpoint one automatic request from every hit.
        frame = document.createElement("iframe");
        frame.src = new URL("/embed", src.origin).toString();
        frame.title = heading;
        frame.setAttribute("loading", "lazy");
        panel.appendChild(frame);
      }
      panel.classList.add("open");
      button.setAttribute("aria-expanded", "true");
      if (frame && frame.focus) frame.focus();
    }

    function close() {
      panel.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
      button.focus();
    }

    button.addEventListener("click", function () {
      if (panel.classList.contains("open")) close();
      else open();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel.classList.contains("open")) close();
    });

    // The chat inside the frame is the only thing that knows it wants to be
    // dismissed. Accept that message from our own deployment and nowhere else —
    // and from *this* frame, not merely from something on the same origin. The
    // origin check alone let any other window the deployment had opened close
    // someone's widget.
    window.addEventListener("message", function (event) {
      if (event.origin !== src.origin) return;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.data === "grounded-chat:close") close();
    });

    root.appendChild(style);
    wrap.appendChild(panel);
    wrap.appendChild(button);
    root.appendChild(wrap);
    document.body.appendChild(host);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
