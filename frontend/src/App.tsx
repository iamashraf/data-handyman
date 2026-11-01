import { useState } from "react";
import { TemplateBuilderPage } from "./pages/TemplateBuilderPage";
import { DataViewPage } from "./pages/DataViewPage";
import { SummaryViewPage } from "./pages/SummaryViewPage";
import "./App.css";

type Tab = "templates" | "records" | "summary";

export function App() {
  const [tab, setTab] = useState<Tab>("records");

  return (
    <div>
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
      {tab === "records" ? (
        <DataViewPage />
      ) : tab === "templates" ? (
        <TemplateBuilderPage />
      ) : (
        <SummaryViewPage />
      )}
    </div>
  );
}
