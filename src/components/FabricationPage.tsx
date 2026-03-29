/**
 * FabricationPage.tsx
 *
 * Full-page overlay shown after "save for fabrication" is clicked.
 * Displays the three cut-ready sheets side-by-side with instructions
 * and individual download buttons.
 */

import { useState, useEffect } from "react";
import type { CanvasObject } from "../types";
import { buildFabricationSheets, downloadPng } from "../fabricationExport";

interface Props {
  background: string | null;
  objects: CanvasObject[];
  canvasW: number;
  canvasH: number;
  revealRatio: number;
  onClose: () => void;
}

interface Sheets {
  leversDataUrl: string;
  objectsDataUrl: string;
  backgroundDataUrl: string;
}

const STEPS = [
  {
    num: "01",
    title: "Print all three layers",
    body: "Print each PNG at 100 % (no scaling). Use the registration marks in the corners to align the sheets when stacking.",
  },
  {
    num: "02",
    title: "Cut the lever arms",
    body: "Using the Levers sheet, cut along each solid black outline. Punch a small hole at the marked pivot point.",
  },
  {
    num: "03",
    title: "Cut the object tiles",
    body: "Cut the Objects sheet along every black rectangle. For rotation objects, pierce the anchor dot. Glue or tape your printed image to the tile.",
  },
  {
    num: "04",
    title: "Cut the background windows",
    body: "On the Background sheet, cut out the solid-outlined windows (slide slots and transition paths). The dashed guides show the sweep zone — no cutting needed there.",
  },
  {
    num: "05",
    title: "Assemble",
    body: "Layer the sheets. Attach levers to objects through the pivot holes. Slide lever arms through the background cut-outs so the handles protrude from the back.",
  },
];

export function FabricationPage({
  background,
  objects,
  canvasW,
  canvasH,
  revealRatio,
  onClose,
}: Props) {
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "levers" | "objects" | "background"
  >("levers");

  useEffect(() => {
    setLoading(true);
    setError(null);
    buildFabricationSheets(
      background,
      objects,
      canvasW,
      canvasH,
      revealRatio,
    )
      .then((s) => {
        setSheets(s);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [background, objects, canvasW, canvasH, revealRatio]);

  const currentUrl = sheets
    ? activeTab === "levers"
      ? sheets.leversDataUrl
      : activeTab === "objects"
        ? sheets.objectsDataUrl
        : sheets.backgroundDataUrl
    : null;

  const labels: Record<typeof activeTab, string> = {
    levers: "Layer 1 — Levers",
    objects: "Layer 2 — Objects",
    background: "Layer 3 — Background",
  };

  return (
    <div className="fab-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="fab-header">
        <div className="fab-header-left">
          <span className="fab-title">Fabrication Files</span>
          <span className="fab-subtitle">
            3 cut-ready layers for physical assembly
          </span>
        </div>
        <button className="fab-close" onClick={onClose} title="Back to editor">
          ← Back to editor
        </button>
      </header>

      <div className="fab-body">
        {/* ── Left: instructions ──────────────────────────────────────── */}
        <aside className="fab-instructions">
          <h2 className="fab-section-title">Assembly Instructions</h2>
          <ol className="fab-steps">
            {STEPS.map((s) => (
              <li key={s.num} className="fab-step">
                <span className="fab-step-num">{s.num}</span>
                <div>
                  <strong className="fab-step-title">{s.title}</strong>
                  <p className="fab-step-body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="fab-legend">
            <h3 className="fab-legend-title">Cut line guide</h3>
            <div className="fab-legend-row">
              <span className="fab-legend-swatch fab-legend-solid" />
              <span>Solid black — cut here</span>
            </div>
            <div className="fab-legend-row">
              <span className="fab-legend-swatch fab-legend-dashed" />
              <span>Dashed grey — reference only</span>
            </div>
            <div className="fab-legend-row">
              <span className="fab-legend-swatch fab-legend-reg" />
              <span>⊕ corner marks — registration</span>
            </div>
          </div>
        </aside>

        {/* ── Right: preview + downloads ──────────────────────────────── */}
        <section className="fab-preview-area">
          {/* Tab switcher */}
          <div className="fab-tabs">
            {(["levers", "objects", "background"] as const).map((tab) => (
              <button
                key={tab}
                className={`fab-tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "levers" ? "Levers" : null}
                {tab === "objects" ? "Objects" : null}
                {tab === "background" ? "Background" : null}
              </button>
            ))}
          </div>

          {/* Preview canvas */}
          <div className="fab-preview-frame">
            {loading && (
              <div className="fab-spinner-wrap">
                <div className="fab-spinner" />
                <p>Rendering cut files…</p>
              </div>
            )}
            {error && (
              <div className="fab-error">
                <p>⚠ Could not render sheets</p>
                <pre>{error}</pre>
              </div>
            )}
            {!loading && !error && currentUrl && (
              <img
                key={activeTab}
                src={currentUrl}
                className="fab-preview-img"
                alt={labels[activeTab]}
              />
            )}
          </div>

          {/* Download buttons */}
          {!loading && !error && sheets && (
            <div className="fab-download-row">
              <button
                className="fab-dl-btn"
                onClick={() =>
                  downloadPng(sheets.leversDataUrl, "cut-levers.png")
                }
              >
                ↓ Levers PNG
              </button>
              <button
                className="fab-dl-btn"
                onClick={() =>
                  downloadPng(sheets.objectsDataUrl, "cut-objects.png")
                }
              >
                ↓ Objects PNG
              </button>
              <button
                className="fab-dl-btn"
                onClick={() =>
                  downloadPng(sheets.backgroundDataUrl, "cut-background.png")
                }
              >
                ↓ Background PNG
              </button>
              <button
                className="fab-dl-btn fab-dl-btn-all"
                onClick={() => {
                  downloadPng(sheets.leversDataUrl, "cut-levers.png");
                  setTimeout(
                    () => downloadPng(sheets.objectsDataUrl, "cut-objects.png"),
                    200,
                  );
                  setTimeout(
                    () =>
                      downloadPng(
                        sheets.backgroundDataUrl,
                        "cut-background.png",
                      ),
                    400,
                  );
                }}
              >
                ↓ Download All 3
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
