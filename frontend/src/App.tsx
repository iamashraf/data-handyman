import { useEffect, useState } from "react";
import { TemplateBuilderPage } from "./pages/TemplateBuilderPage";
import { DataViewPage } from "./pages/DataViewPage";
import { SummaryViewPage } from "./pages/SummaryViewPage";
import { ThemeContext } from "./lib/ThemeContext";
import { getStoredTheme, getSystemTheme, storeTheme } from "./lib/theme";
import type { ThemeMode } from "./lib/theme";
import "./App.css";

type Tab = "templates" | "records" | "summary";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("records");
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme() ?? getSystemTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      storeTheme(next);
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={theme}>
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-title">
            <svg
              className="app-icon"
              viewBox="0 0 24 24"
              width="28"
              height="28"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.6 2.6-2-2z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <h1 className="app-title">Data Handyman</h1>
            <button
              type="button"
              className="app-theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
          <nav className="app-nav">
            <button
              type="button"
              className="app-nav-button"
              aria-current={tab === "records" ? "true" : undefined}
              onClick={() => setTab("records")}
            >
              Records
            </button>
            <button
              type="button"
              className="app-nav-button"
              aria-current={tab === "templates" ? "true" : undefined}
              onClick={() => setTab("templates")}
            >
              Templates
            </button>
            <button
              type="button"
              className="app-nav-button"
              aria-current={tab === "summary" ? "true" : undefined}
              onClick={() => setTab("summary")}
            >
              Summary
            </button>
          </nav>
        </header>

        <main className="app-body">
          {tab === "records" ? (
            <DataViewPage />
          ) : tab === "templates" ? (
            <TemplateBuilderPage />
          ) : (
            <SummaryViewPage />
          )}
        </main>

        <footer className="app-footer">
          <span>Data Handyman</span>
          <span className="app-footer-sep">·</span>
          <span>self-hosted records &amp; templates</span>
        </footer>
      </div>
    </ThemeContext.Provider>
  );
}
