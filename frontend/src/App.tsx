import { useState } from "react";
import { TemplateBuilderPage } from "./pages/TemplateBuilderPage";
import { DataViewPage } from "./pages/DataViewPage";
import { SummaryViewPage } from "./pages/SummaryViewPage";
import "./App.css";

type Tab = "templates" | "records" | "summary";

export function App() {
  const [tab, setTab] = useState<Tab>("records");

  return (
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
  );
}
