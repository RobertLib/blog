// Shared behaviour: theme toggle, sticky-header state, reading progress.
(function () {
  "use strict";

  var root = document.documentElement;

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
    var next = currentTheme() === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", "Switch to " + next + " theme");
    toggle.setAttribute("title", "Switch to " + next + " theme");
  }

  if (toggle) {
    syncToggleLabel();
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        /* storage unavailable — the choice just won't persist */
      }
      syncToggleLabel();
    });

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", syncToggleLabel);
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
      progress.style.width = Math.min(Math.max(value, 0), 1) * 100 + "%";
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

  /* ---------- Copy link ---------- */
  var copyBtn = document.querySelector("[data-copy-link]");
  if (copyBtn && navigator.clipboard) {
    copyBtn.addEventListener("click", function () {
      var label = copyBtn.querySelector("[data-copy-label]");
      navigator.clipboard
        .writeText(copyBtn.getAttribute("data-copy-link"))
        .then(function () {
          if (!label) return;
          var original = label.textContent;
          label.textContent = "Copied";
          setTimeout(function () {
            label.textContent = original;
          }, 2000);
        })
        .catch(function () {
          /* clipboard denied — nothing to do */
        });
    });
  }

  /* ---------- Click-to-play embeds ---------- */
  // <figure class="embed" data-embed="https://itch.io/embed-upload/..."
  // data-embed-ratio="800/552"> holding a poster image and a fallback link.
  // The game (or video) loads only when asked for, so it never slows the
  // page down or starts making sound by itself. The build checks the URL
  // against config.embeds.allowedHosts.
  var embeds = document.querySelectorAll("[data-embed]");
  Array.prototype.forEach.call(embeds, function (embed) {
    var src = embed.getAttribute("data-embed");
    var title = embed.getAttribute("data-embed-title") || "Embedded content";
    var stage = embed.querySelector(".embed__stage") || embed;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "embed__play";
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>';
    var label = document.createElement("span");
    label.textContent =
      embed.getAttribute("data-embed-label") || "Play in your browser";
    button.appendChild(label);
    stage.appendChild(button);
    embed.classList.add("embed--ready");

    button.addEventListener("click", function () {
      var ratio = embed.getAttribute("data-embed-ratio");
      var frame = document.createElement("iframe");
      frame.src = src;
      frame.title = title;
      frame.className = "embed__frame";
      frame.setAttribute("allow", "autoplay; fullscreen; gamepad");
      frame.setAttribute("allowfullscreen", "");
      if (ratio) stage.style.aspectRatio = ratio;
      stage.innerHTML = "";
      stage.appendChild(frame);
      embed.classList.add("embed--playing");
      frame.focus();
    });
  });
})();
