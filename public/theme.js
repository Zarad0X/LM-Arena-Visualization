(function initThemeSystem() {
  const themes = {
    "current-polished": {
      label: "Current Polished",
      titles: {
        leaderboard: "当前榜单与置信区间",
        history: "排名历史",
        activity: "活跃时间轴",
        "organization-matrix": "机构能力—覆盖矩阵",
        "organization-coverage": "机构模型覆盖",
        "arena-scale": "Arena 规模",
        table: "榜单明细",
      },
    },
    "research-lab": {
      label: "Research Lab",
      titles: {
        leaderboard: "Is the current leader statistically reliable?",
        history: "How stable is rank ordering over time?",
        activity: "How does evaluation activity shift?",
        "organization-matrix": "How concentrated are top models by organization?",
        "organization-coverage": "Which organizations sustain model breadth?",
        "arena-scale": "Where is benchmark coverage concentrated?",
        table: "Which models are hard to distinguish?",
      },
    },
    "terminal-analytics": {
      label: "Terminal Analytics",
      titles: {
        leaderboard: "RANK / INTERVAL MONITOR",
        history: "RANK HISTORY",
        activity: "VOTE ACTIVITY",
        "organization-matrix": "ORG CAPABILITY MATRIX",
        "organization-coverage": "ORG COVERAGE",
        "arena-scale": "ARENA COVERAGE",
        table: "LEADERBOARD TAPE",
      },
    },
  };

  const defaultTheme = "current-polished";

  function storedTheme() {
    try {
      return window.localStorage.getItem("lmarena-theme");
    } catch {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      window.localStorage.setItem("lmarena-theme", theme);
    } catch {
      // Theme selection still works through the URL when storage is unavailable.
    }
  }

  function requestedTheme() {
    const queryTheme = new URLSearchParams(window.location.search).get("theme");
    if (themes[queryTheme]) return queryTheme;
    const stored = storedTheme();
    return themes[stored] ? stored : defaultTheme;
  }

  function updateUi(theme) {
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      const active = button.dataset.themeOption === theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-title-key]").forEach((heading) => {
      const title = themes[theme].titles[heading.dataset.titleKey];
      if (title) heading.textContent = title;
    });
  }

  function setTheme(theme, options = {}) {
    const nextTheme = themes[theme] ? theme : defaultTheme;
    document.documentElement.dataset.theme = nextTheme;
    storeTheme(nextTheme);
    if (options.updateUrl !== false) {
      const url = new URL(window.location.href);
      url.searchParams.set("theme", nextTheme);
      window.history.replaceState({}, "", url);
    }
    updateUi(nextTheme);
    window.dispatchEvent(new CustomEvent("lmarena:themechange", { detail: { theme: nextTheme } }));
  }

  const initialTheme = requestedTheme();
  document.documentElement.dataset.theme = initialTheme;

  window.LMArenaTheme = {
    current: () => document.documentElement.dataset.theme || defaultTheme,
    set: setTheme,
    themes: Object.keys(themes),
  };

  document.addEventListener("DOMContentLoaded", () => {
    updateUi(initialTheme);
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      button.addEventListener("click", () => setTheme(button.dataset.themeOption));
    });
  });
})();
