import { useState } from "react";
import { TemplateBuilderPage } from "./pages/TemplateBuilderPage";
import { DataViewPage } from "./pages/DataViewPage";
import "./App.css";

type Tab = "templates" | "records";

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
      </nav>
      {tab === "records" ? <DataViewPage /> : <TemplateBuilderPage />}
    </div>
  );
}
