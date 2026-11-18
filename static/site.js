// Shared behaviour: theme toggle, sticky-header state, reading progress.
(function () {
  "use strict";

  var root = document.documentElement;

  // Text this script writes, in the page's language (<html lang>)
  var STRINGS = {
    en: {
      toDark: "Switch to dark theme",
      toLight: "Switch to light theme",
      copied: "Copied",
      play: "Play {name}",
      playDefault: "Play in your browser",
      embedded: "Embedded content"
    },
    cs: {
      toDark: "Přepnout na tmavý motiv",
      toLight: "Přepnout na světlý motiv",
      copied: "Zkopírováno",
      play: "Spustit {name}",
      playDefault: "Spustit v prohlížeči",
      embedded: "Vložený obsah"
    }
  };
  var text = STRINGS[(root.lang || "").split("-")[0]] || STRINGS.en;

  /* ---------- Theme ---------- */
  var toggle = document.querySelector("[data-theme-toggle]");

  function currentTheme() {
    if (root.dataset.theme === "dark" || root.dataset.theme === "light") {
      return root.dataset.theme;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function syncToggleLabel() {
    if (!toggle) return;
    var label = currentTheme() === "dark" ? text.toLight : text.toDark;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
  }

  // The browser UI colour follows the chosen theme, not the system's
  var THEME_COLORS = { light: "#fbfaf8", dark: "#111214" };

  // A chosen theme ("dark" or "light"), or anything else to follow the
  // system again, where each theme-color tag gets its media query back
  function applyTheme(theme) {
    var chosen = theme === "dark" || theme === "light";
    if (chosen) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    } else {
      delete root.dataset.theme;
      root.style.colorScheme = "";
    }
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    Array.prototype.forEach.call(metas, function (meta) {
      var scheme = meta.getAttribute("data-scheme");
      if (chosen || !scheme) {
        meta.setAttribute("content", THEME_COLORS[chosen ? theme : "light"]);
        meta.removeAttribute("media");
      } else {
        meta.setAttribute("content", THEME_COLORS[scheme]);
        meta.setAttribute("media", "(prefers-color-scheme: " + scheme + ")");
      }
    });
    syncToggleLabel();
  }

  // Colour transitions are paused while the palette changes, so the whole
  // page switches at once; they resume once the new colours are painted
  function switchTheme(theme) {
    root.classList.add("theme-switching");
    applyTheme(theme);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        root.classList.remove("theme-switching");
      });
    });
  }

  if (toggle) {
    toggle.hidden = false;
    syncToggleLabel();
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      switchTheme(next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        /* storage unavailable — the choice just won't persist */
      }
    });

    // A choice made in another tab of the site applies here too
    window.addEventListener("storage", function (event) {
      if (event.key === "theme" || event.key === null) {
        switchTheme(event.newValue);
      }
    });

    var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    if (systemDark.addEventListener) {
      systemDark.addEventListener("change", syncToggleLabel);
    } else if (systemDark.addListener) {
      // Safari before 14
      systemDark.addListener(syncToggleLabel);
    }
  }

  /* ---------- Header + reading progress ---------- */
  var header = document.querySelector(".site-header");
  var progress = document.querySelector(".progress");
  var ticking = false;

  function onScroll() {
    if (header) {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }

    if (progress) {
      var span =
        document.documentElement.scrollHeight - window.innerHeight;
      var value = span > 0 ? window.scrollY / span : 0;
      progress.style.transform =
        "scaleX(" + Math.min(Math.max(value, 0), 1) + ")";
    }

    ticking = false;
  }

  function requestScroll() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(onScroll);
    }
  }

  window.addEventListener("scroll", requestScroll, { passive: true });
  window.addEventListener("resize", requestScroll, { passive: true });
  onScroll();

  /* ---------- Code blocks ---------- */
  // The build makes every code block focusable, so one that scrolls sideways
  // can be scrolled from the keyboard even without this script. Here the
  // blocks that fit their width leave the tab order (and rejoin it when a
  // narrower window makes them scroll).
  var codeBlocks = document.querySelectorAll(".prose pre");
  var codeTicking = false;

  function syncCodeFocus() {
    Array.prototype.forEach.call(codeBlocks, function (pre) {
      if (pre.scrollWidth > pre.clientWidth) {
        pre.setAttribute("tabindex", "0");
      } else {
        pre.removeAttribute("tabindex");
      }
    });
    codeTicking = false;
  }

  if (codeBlocks.length > 0) {
    syncCodeFocus();
    window.addEventListener(
      "resize",
      function () {
        if (!codeTicking) {
          codeTicking = true;
          window.requestAnimationFrame(syncCodeFocus);
        }
      },
      { passive: true }
    );
  }

  /* ---------- Copy link ---------- */
  // Shown only where it can work (it starts hidden in the markup)
  var copyBtn = document.querySelector("[data-copy-link]");
  if (copyBtn && navigator.clipboard) {
    var copyLabel = copyBtn.querySelector("[data-copy-label]");
    var copyText = copyLabel ? copyLabel.textContent : "";
    var copyTimer = null;
    copyBtn.hidden = false;
    copyBtn.addEventListener("click", function () {
      navigator.clipboard
        .writeText(copyBtn.getAttribute("data-copy-link"))
        .then(function () {
          if (!copyLabel) return;
          copyLabel.textContent = text.copied;
          clearTimeout(copyTimer);
          copyTimer = setTimeout(function () {
            copyLabel.textContent = copyText;
          }, 2000);
        })
        .catch(function () {
          /* clipboard denied — nothing to do */
        });
    });
  }

  /* ---------- Click-to-play embeds ---------- */
  // <figure class="embed" data-embed="https://itch.io/embed-upload/..."
  // data-embed-ratio="800 / 582"> holding a poster image (a link to the
  // game's page) and a caption. The game (or video) loads only when asked
  // for, so it never slows the page down or starts making sound by itself.
  // The build checks the URL against config.embeds.allowedHosts and gives the
  // stage the frame's shape from data-embed-ratio.
  //
  // On a touch-only device (a phone or tablet without a mouse or trackpad),
  // data-embed-touch-note ("Needs a keyboard or gamepad") is shown on the
  // button, so nobody starts a game they can't control without knowing.
  var touchOnly =
    window.matchMedia("(pointer: coarse)").matches &&
    !window.matchMedia("(any-pointer: fine)").matches;
  var embeds = document.querySelectorAll("[data-embed]");
  Array.prototype.forEach.call(embeds, function (embed) {
    var src = embed.getAttribute("data-embed");
    var name = embed.getAttribute("data-embed-title");
    var touchNote = embed.getAttribute("data-embed-touch-note");
    var stage = embed.querySelector(".embed__stage") || embed;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "embed__play";
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>';
    var label = document.createElement("span");
    label.className = "embed__play-text";
    label.textContent =
      embed.getAttribute("data-embed-label") ||
      (name ? text.play.replace("{name}", name) : text.playDefault);
    if (touchNote && touchOnly) {
      var note = document.createElement("small");
      note.className = "embed__play-note";
      note.textContent = touchNote;
      label.appendChild(note);
    }
    button.appendChild(label);
    stage.appendChild(button);
    embed.classList.add("embed--ready");

    function play() {
      var frame = document.createElement("iframe");
      frame.src = src;
      frame.title = name || text.embedded;
      frame.className = "embed__frame";
      frame.setAttribute("allow", "autoplay; fullscreen; gamepad");
      frame.setAttribute("allowfullscreen", "");
      stage.innerHTML = "";
      stage.appendChild(frame);
      embed.classList.add("embed--playing");
      frame.focus();
    }

    button.addEventListener("click", play);

    // The poster's link (to the game's page) plays in place instead; the
    // button is the keyboard's way in. Modified clicks still open the link.
    Array.prototype.forEach.call(stage.querySelectorAll("a"), function (link) {
      link.tabIndex = -1;
      link.addEventListener("click", function (event) {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        play();
      });
    });
  });
})();
