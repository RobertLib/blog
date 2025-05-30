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
})();
