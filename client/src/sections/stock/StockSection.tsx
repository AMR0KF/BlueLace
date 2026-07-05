// Stock: stock matrix (color x size per model), models CRUD with variant
// matrix editor, receive/adjust stock, movements ledger, oversell review queue.
import {
  AlertTriangle, ImagePlus, Info, PackagePlus, Pencil, Plus, Search, X,
} from "lucide-react";
import { useState } from "react";
import { Badge, blurOnWheel, EmptyState, MoneyInput, timeLabel } from "../../components/ui";
import { SHOE_ICON_KEYS, SHOE_ICONS, ShoeVisual } from "../../components/ShoeVisual";
import { fileToThumb } from "../../lib/images";
import { formatBase, roundBaseMoney } from "../../lib/money";
import { askConfirm, Modal } from "../../lib/modal";
import { useApp } from "../../state/AppState";
import type { ShoeModel, StockMovement, Variant } from "../../types";

type Tab = "stock" | "models" | "movements" | "review";

export function StockSection() {
  const { boot } = useApp();
  const [tab, setTab] = useState<Tab>("stock");
  const [editing, setEditing] = useState<ShoeModel | "new" | null>(null);
  const [receiving, setReceiving] = useState<Variant | null>(null);
  const [adjusting, setAdjusting] = useState<Variant | null>(null);
  if (!boot) return null;

  const activeModels = boot.models.filter((m) => m.active);
  const variantsByModel = new Map<string, Variant[]>();
  for (const variant of boot.variants) {
    if (!variant.active) continue;
    const list = variantsByModel.get(variant.modelId) ?? [];
    list.push(variant);
    variantsByModel.set(variant.modelId, list);
  }

  const totalPairs = boot.variants.reduce((sum, v) => sum + Math.max(v.stockQty, 0), 0);
  const stockValue = boot.variants.reduce(
    (sum, v) => sum + Math.max(v.stockQty, 0) * (v.lastCost ?? 0), 0);
  const lowCount = [...variantsByModel.values()].flat()
    .filter((v) => v.stockQty > 0 && v.stockQty <= 1).length;
  const outCount = [...variantsByModel.values()].flat().filter((v) => v.stockQty <= 0).length;
  const reviewCount = boot.stockReviewItems.length;

  return (
    <div className="section-page">
      <header className="page-head">
        <h1>Stock</h1>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Plus size={17} /> New model
        </button>
      </header>

      <div className="metric-row">
        <div className="metric-card">
          <div className="metric-label">Pairs in stock</div>
          <div className="metric-value num">{totalPairs}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Stock value (cost)</div>
          <div className="metric-value num">{formatBase(roundBaseMoney(stockValue))}</div>
        </div>
        <div className={`metric-card ${lowCount ? "metric-warning" : ""}`}>
          <div className="metric-label">Low stock</div>
          <div className="metric-value num">{lowCount}</div>
          <div className="metric-sub">variants at 1 left</div>
        </div>
        <div className={`metric-card ${outCount ? "metric-danger" : ""}`}>
          <div className="metric-label">Out / negative</div>
          <div className="metric-value num">{outCount}</div>
        </div>
      </div>

      <div className="preset-row">
        {(["stock", "models", "movements", "review"] as Tab[]).map((name) => (
          <button key={name} className={`chip ${tab === name ? "chip-active" : ""}`}
                  onClick={() => setTab(name)}>
            <span className="cap">{name}</span>
            {name === "review" && reviewCount ? <em>{reviewCount}</em> : null}
          </button>
        ))}
      </div>

      {tab === "stock" ? (
        <StockTab models={activeModels} variantsByModel={variantsByModel}
                  onReceive={setReceiving} onAdjust={setAdjusting} />
      ) : null}
      {tab === "models" ? (
        <ModelsTab models={boot.models} variantsByModel={variantsByModel}
                   onEdit={setEditing} />
      ) : null}
      {tab === "movements" ? <MovementsTab movements={boot.stockMovements} /> : null}
      {tab === "review" ? <ReviewTab items={boot.stockReviewItems} /> : null}

      {editing ? (
        <ModelEditorModal
          model={editing === "new" ? null : editing}
          variants={editing === "new" ? [] : boot.variants.filter((v) => v.modelId === editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {receiving ? (
        <ReceiveModal variant={receiving} onClose={() => setReceiving(null)} />
      ) : null}
      {adjusting ? (
        <AdjustModal variant={adjusting} onClose={() => setAdjusting(null)} />
      ) : null}
    </div>
  );
}

// ---------- Stock matrix ----------
function StockTab({ models, variantsByModel, onReceive, onAdjust }: {
  models: ShoeModel[];
  variantsByModel: Map<string, Variant[]>;
  onReceive: (v: Variant) => void;
  onAdjust: (v: Variant) => void;
}) {
  const { boot } = useApp();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) =>
        m.name.toLowerCase().includes(q) || (m.brand ?? "").toLowerCase().includes(q) ||
        (variantsByModel.get(m.id) ?? []).some((v) =>
          (v.sku ?? "").toLowerCase().includes(q) || (v.barcode ?? "") === q))
    : models;

  if (models.length === 0) {
    return <EmptyState title="No shoe models yet" hint="Create your first model to start tracking stock." />;
  }
  return (
    <>
      <div className="search-box" style={{ marginBottom: 14 }}>
        <Search size={18} />
        <input placeholder="Search models, brand, SKU..." value={query}
               onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="stock-cards">
        {filtered.map((model) => {
          const variants = variantsByModel.get(model.id) ?? [];
          const colors = [...new Set(variants.map((v) => v.color))];
          const sizes = [...new Set(variants.map((v) => v.size))]
            .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
          const byKey = new Map(variants.map((v) => [`${v.color}|${v.size}`, v]));
          return (
            <section key={model.id} className="card stock-card">
              <div className="stock-card-head">
                <div className="model-cell-visual">
                  <ShoeVisual image={model.image} size={32} className="model-thumb" />
                  <div>
                    <h2 className="card-title" style={{ marginBottom: 0 }}>{model.name}</h2>
                    <span className="muted">
                      {model.brand ?? ""} · {formatBase(model.basePrice)}
                    </span>
                  </div>
                </div>
                <span className="badge badge-neutral num">
                  {variants.reduce((s, v) => s + Math.max(v.stockQty, 0), 0)} pairs
                </span>
              </div>
              {variants.length === 0 ? (
                <p className="muted">No variants — edit the model to add colors and sizes.</p>
              ) : (
                <div className="matrix-scroll">
                  <table className="matrix">
                    <thead>
                      <tr>
                        <th />
                        {sizes.map((size) => <th key={size} className="num">{size}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {colors.map((color) => (
                        <tr key={color}>
                          <th className="matrix-color">{color}</th>
                          {sizes.map((size) => {
                            const variant = byKey.get(`${color}|${size}`);
                            if (!variant) return <td key={size} className="matrix-empty">—</td>;
                            const tone = variant.stockQty <= 0 ? "cell-danger"
                              : variant.stockQty <= 1 ? "cell-warn" : "";
                            return (
                              <td key={size}>
                                <button
                                  className={`matrix-cell num ${tone}`}
                                  title={`${model.name} ${color}/${size} — click to receive, right-click to adjust`}
                                  onClick={() => onReceive(variant)}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    onAdjust(variant);
                                  }}
                                >
                                  {variant.stockQty}
                                  {variant.priceOverride != null ? <i className="cell-dot" /> : null}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="matrix-hint muted">
                Tap a cell to receive stock · long-press / right-click to adjust ·
                purple dot = that variant has a custom selling price
                {boot ? ` (base ${formatBase(model.basePrice)})` : ""}
              </p>
            </section>
          );
        })}
      </div>
    </>
  );
}

// ---------- Models CRUD ----------
function ModelsTab({ models, variantsByModel, onEdit }: {
  models: ShoeModel[];
  variantsByModel: Map<string, Variant[]>;
  onEdit: (m: ShoeModel) => void;
}) {
  const { mutate } = useApp();
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Model</th><th>Brand</th><th>Category</th>
            <th className="num">Price</th><th className="num">Cost</th>
            <th className="num">Variants</th><th>Status</th><th className="th-actions" />
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id}>
              <td>
                <span className="model-cell-visual">
                  <ShoeVisual image={model.image} size={28} className="model-thumb" />
                  <strong>{model.name}</strong>
                </span>
              </td>
              <td>{model.brand ?? "—"}</td>
              <td>{model.category ?? "—"}</td>
              <td className="num">{formatBase(model.basePrice)}</td>
              <td className="num">{formatBase(model.defaultCost)}</td>
              <td className="num">{(variantsByModel.get(model.id) ?? []).length}</td>
              <td>{model.active
                ? <Badge kind="success">Active</Badge>
                : <Badge kind="neutral">Inactive</Badge>}</td>
              <td className="td-actions">
                <button className="btn btn-sm" onClick={() => onEdit(model)}>
                  <Pencil size={14} /> Edit
                </button>
                <button
                  className="btn btn-sm btn-danger-soft"
                  onClick={async () => {
                    const { ok } = await askConfirm({
                      title: model.active ? `Delete "${model.name}"?` : `Reactivate "${model.name}"?`,
                      message: model.active
                        ? "Models with sales history are deactivated instead of deleted."
                        : undefined,
                      danger: model.active,
                      confirmLabel: model.active ? "Delete" : "Reactivate",
                    });
                    if (!ok) return;
                    if (model.active) await mutate("DELETE", `/api/models/${model.id}`);
                    else await mutate("PATCH", `/api/models/${model.id}`, { active: true });
                  }}
                >
                  {model.active ? "Delete" : "Reactivate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Model editor with variant matrix ----------
const TILE_COLORS = ["stone", "blue", "emerald", "amber", "rose", "violet", "slate", "black"];

function ModelEditorModal({ model, variants, onClose }: {
  model: ShoeModel | null;
  variants: Variant[];
  onClose: () => void;
}) {
  const { boot, mutate, pushToast } = useApp();
  const [form, setForm] = useState({
    name: model?.name ?? "",
    brand: model?.brand ?? "",
    category: model?.category ?? "",
    image: model?.image ?? "icon:sneaker",
    tileColor: model?.tileColor ?? "stone",
    basePrice: model?.basePrice ?? 0,
    defaultCost: model?.defaultCost ?? 0,
  });
  const [colorImages, setColorImages] = useState<Record<string, string>>(
    model?.colorImages ?? {});
  const [colorsText, setColorsText] = useState(
    [...new Set(variants.map((v) => v.color))].join(", "));
  const [sizesText, setSizesText] = useState(
    [...new Set(variants.map((v) => v.size))].join(", "));
  const [overrides, setOverrides] = useState<Map<string, number | null>>(
    new Map(variants.filter((v) => v.priceOverride != null)
      .map((v) => [`${v.color}|${v.size}`, v.priceOverride])));
  // Price grid is opt-in: hidden unless the model already has custom prices,
  // so it can't be mistaken for a stock-entry grid.
  const [editingPrices, setEditingPrices] = useState(
    () => variants.some((v) => v.priceOverride != null));
  const [busy, setBusy] = useState(false);

  const colors = colorsText.split(",").map((s) => s.trim()).filter(Boolean);
  const sizes = sizesText.split(",").map((s) => s.trim()).filter(Boolean);
  const matrix = colors.flatMap((color) => sizes.map((size) => ({ color, size })));
  const stockByKey = new Map(variants.map((v) => [`${v.color}|${v.size}`, v.stockQty]));
  const overrideCount = [...overrides.values()].filter((v) => v != null && v > 0).length;

  const save = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      let modelId = model?.id;
      const prunedImages = Object.fromEntries(
        Object.entries(colorImages).filter(([color]) => colors.includes(color)));
      const payload = {
        name: form.name.trim(), brand: form.brand.trim() || null,
        category: form.category.trim() || null, image: form.image.trim() || null,
        colorImages: Object.keys(prunedImages).length ? prunedImages : null,
        tileColor: form.tileColor, basePrice: form.basePrice, defaultCost: form.defaultCost,
      };
      if (modelId) {
        if (!(await mutate("PATCH", `/api/models/${modelId}`, payload))) return;
      } else {
        // Create, then find the new id from the fresh bootstrap via a follow-up read.
        const created = await createAndFind(payload);
        if (!created) return;
        modelId = created;
      }
      if (matrix.length > 0) {
        const specs = matrix.map(({ color, size }) => ({
          color, size,
          priceOverride: overrides.get(`${color}|${size}`) ?? undefined,
        }));
        if (!(await mutate("POST", `/api/models/${modelId}/variants`,
                           { variants: specs, prune: true }))) return;
      }
      pushToast("success", `Saved "${form.name.trim()}".`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  async function createAndFind(payload: Record<string, unknown>): Promise<string | null> {
    const before = new Set((boot?.models ?? []).map((m) => m.id));
    if (!(await mutate("POST", "/api/models", payload))) return null;
    // mutate() already swapped state; read the newest bootstrap from localStorage cache.
    try {
      const cached = JSON.parse(localStorage.getItem("shoepos.bootstrap-cache.v1") ?? "null");
      const fresh = (cached?.models ?? []).find(
        (m: ShoeModel) => !before.has(m.id) && m.name === payload.name);
      return fresh?.id ?? null;
    } catch {
      return null;
    }
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const pickPhoto = (apply: (dataUrl: string) => void) =>
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        apply(await fileToThumb(file));
      } catch (err) {
        pushToast("error", err instanceof Error ? err.message : "Couldn't load the image.");
      }
    };

  return (
    <Modal onClose={onClose} wide labelledBy="model-editor-title">
      <h3 id="model-editor-title" className="modal-title">
        {model ? `Edit ${model.name}` : "New shoe model"}
      </h3>
      <div className="form-grid">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={form.name} onChange={set("name")} autoFocus /></label>
        <label className="field"><span className="field-label">Brand</span>
          <input className="input" value={form.brand} onChange={set("brand")} /></label>
        <label className="field"><span className="field-label">Category</span>
          <input className="input" value={form.category} onChange={set("category")}
                 placeholder="Sneakers, Boots, Sandals..." /></label>
        <label className="field"><span className="field-label">Tile color</span>
          <select className="input" value={form.tileColor} onChange={set("tileColor")}>
            {TILE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="field"><span className="field-label">Selling price (USD)</span>
          <MoneyInput value={form.basePrice}
                      onCommit={(v) => setForm((p) => ({ ...p, basePrice: v }))} /></label>
        <label className="field"><span className="field-label">Default cost (USD)</span>
          <MoneyInput value={form.defaultCost}
                      onCommit={(v) => setForm((p) => ({ ...p, defaultCost: v }))} /></label>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <span className="field-label">Tile visual — icon or photo</span>
        <div className="visual-row">
          {SHOE_ICON_KEYS.map((key) => {
            const Icon = SHOE_ICONS[key];
            const active = form.image === `icon:${key}`;
            return (
              <button key={key} type="button" title={key}
                      className={`icon-choice ${active ? "icon-active" : ""}`}
                      onClick={() => setForm((p) => ({ ...p, image: `icon:${key}` }))}>
                <Icon size={24} />
              </button>
            );
          })}
          <label className="btn btn-sm upload-btn">
            <ImagePlus size={15} /> Photo
            <input type="file" accept="image/*"
                   onChange={pickPhoto((data) => setForm((p) => ({ ...p, image: data })))} />
          </label>
          {form.image.startsWith("data:") ? (
            <span className="visual-preview">
              <img src={form.image} alt="Model" />
              <button type="button" className="thumb-remove" aria-label="Remove photo"
                      onClick={() => setForm((p) => ({ ...p, image: "icon:sneaker" }))}>
                <X size={12} />
              </button>
            </span>
          ) : null}
        </div>
      </div>

      <h4 className="subhead">Variants — colors × sizes</h4>
      <div className="form-grid">
        <label className="field"><span className="field-label">Colors (comma-separated)</span>
          <input className="input" value={colorsText}
                 onChange={(event) => setColorsText(event.target.value)}
                 placeholder="Black, White, Navy" /></label>
        <label className="field"><span className="field-label">Sizes (comma-separated)</span>
          <input className="input" value={sizesText}
                 onChange={(event) => setSizesText(event.target.value)}
                 placeholder="40, 41, 42, 43, 44" /></label>
      </div>

      {colors.length > 0 ? (
        <div className="field" style={{ marginTop: 4 }}>
          <span className="field-label">Photos per color (optional — shown in the POS picker)</span>
          <div className="color-image-grid">
            {colors.map((color) => (
              <span key={color} className="color-image-chip">
                {colorImages[color]
                  ? <img src={colorImages[color]} alt={color} />
                  : <span className="color-thumb-empty"><ImagePlus size={15} /></span>}
                <span className="color-chip-name">{color}</span>
                <label className="btn btn-sm upload-btn">
                  {colorImages[color] ? "Change" : "Photo"}
                  <input type="file" accept="image/*"
                         onChange={pickPhoto((data) =>
                           setColorImages((prev) => ({ ...prev, [color]: data })))} />
                </label>
                {colorImages[color] ? (
                  <button type="button" className="btn btn-sm btn-danger-soft"
                          onClick={() => setColorImages((prev) => {
                            const next = { ...prev };
                            delete next[color];
                            return next;
                          })}>
                    <X size={13} />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {matrix.length > 0 ? (
        <>
          <div className="callout">
            <Info size={15} />
            <span>
              <strong>Stock quantities are not set here.</strong> To bring pairs in, record
              a purchase in <strong>Purchasing</strong> (recommended) or tap a cell in the
              Stock tab to receive.
            </span>
          </div>
          <div className="subhead-row">
            <h4 className="subhead" style={{ margin: 0 }}>
              Custom selling prices (optional)
              {overrideCount > 0 ? ` — ${overrideCount} set` : ""}
            </h4>
            <span className="subhead-actions">
              {editingPrices && overrideCount > 0 ? (
                <button type="button" className="btn btn-sm"
                        onClick={() => setOverrides(new Map())}>
                  Clear all ({overrideCount})
                </button>
              ) : null}
              <button type="button" className="btn btn-sm"
                      onClick={() => setEditingPrices((v) => !v)}>
                {editingPrices ? "Done" : <><Pencil size={13} /> Edit prices</>}
              </button>
            </span>
          </div>
          {editingPrices ? (
            <div className="override-grid">
              {matrix.map(({ color, size }) => {
                const key = `${color}|${size}`;
                const override = overrides.get(key);
                const stock = stockByKey.get(key);
                return (
                  <label key={key} className="override-cell">
                    <span className="num">
                      {color} / {size}
                      {stock !== undefined ? (
                        <em className="override-stock">{stock} in stock</em>
                      ) : null}
                    </span>
                    <MoneyInput
                      value={override ?? 0}
                      placeholder={`= ${formatBase(form.basePrice)}`}
                      onCommit={(v) => {
                        setOverrides((prev) => {
                          const next = new Map(prev);
                          if (v > 0) next.set(key, v);
                          else next.delete(key);
                          return next;
                        });
                      }}
                    />
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {overrideCount > 0
                ? `${overrideCount} variant${overrideCount === 1 ? " sells" : "s sell"} at a custom price — “Edit prices” to change.`
                : `All ${matrix.length} variants sell at the base price (${formatBase(form.basePrice)}).`}
            </p>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            Variants removed from the color/size lists are pruned (kept-but-hidden when
            they have history).
          </p>
        </>
      ) : (
        <p className="muted">Add at least one color and one size to sell this model.</p>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-cta" disabled={!form.name.trim() || busy}
                onClick={() => void save()}>
          {busy ? "Saving…" : "Save model"}
        </button>
      </div>
    </Modal>
  );
}

// ---------- Receive / adjust ----------
function ReceiveModal({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  const { boot, mutate, pushToast } = useApp();
  const model = boot?.models.find((m) => m.id === variant.modelId);
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState(variant.lastCost ?? model?.defaultCost ?? 0);
  const [note, setNote] = useState("");
  return (
    <Modal onClose={onClose} labelledBy="receive-title">
      <h3 id="receive-title" className="modal-title">
        <PackagePlus size={18} /> Receive — {model?.name} {variant.color}/{variant.size}
      </h3>
      <p className="muted">Current stock: <strong className="num">{variant.stockQty}</strong></p>
      <div className="form-grid">
        <label className="field"><span className="field-label">Quantity</span>
          <input className="input num" type="number" min={1} value={qty} onWheel={blurOnWheel}
                 onChange={(event) => setQty(Math.max(1, Math.floor(Number(event.target.value) || 1)))} /></label>
        <label className="field"><span className="field-label">Unit cost (USD)</span>
          <MoneyInput value={cost} onCommit={setCost} /></label>
        <label className="field field-span"><span className="field-label">Note</span>
          <input className="input" value={note} maxLength={200}
                 onChange={(event) => setNote(event.target.value)}
                 placeholder="Supplier, invoice no..." /></label>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Receiving a whole supplier invoice? Use Purchasing → New purchase instead —
        it records every line and the payment in one document.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-cta"
                onClick={async () => {
                  if (await mutate("POST", "/api/stock/receive", {
                    variantId: variant.id, qty, unitCost: cost, note: note.trim() || null,
                  })) {
                    pushToast("success", `Received ${qty} × ${variant.color}/${variant.size}.`);
                    onClose();
                  }
                }}>
          Receive {qty}
        </button>
      </div>
    </Modal>
  );
}

function AdjustModal({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  const { boot, mutate, pushToast } = useApp();
  const model = boot?.models.find((m) => m.id === variant.modelId);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  return (
    <Modal onClose={onClose} labelledBy="adjust-title">
      <h3 id="adjust-title" className="modal-title">
        Adjust — {model?.name} {variant.color}/{variant.size}
      </h3>
      <p className="muted">
        Current stock: <strong className="num">{variant.stockQty}</strong> →
        new stock: <strong className="num">{variant.stockQty + delta}</strong>
      </p>
      <div className="form-grid">
        <label className="field"><span className="field-label">Change (+/-)</span>
          <input className="input num" type="number" value={delta} onWheel={blurOnWheel}
                 onChange={(event) => setDelta(Math.trunc(Number(event.target.value) || 0))} /></label>
        <label className="field"><span className="field-label">Reason (required)</span>
          <input className="input" value={reason} maxLength={200}
                 onChange={(event) => setReason(event.target.value)}
                 placeholder="Count correction, damage, found pair..." /></label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={delta === 0 || !reason.trim()}
                onClick={async () => {
                  if (await mutate("POST", "/api/stock/adjust", {
                    variantId: variant.id, qtyDelta: delta, reason: reason.trim(),
                  })) {
                    pushToast("success", "Stock adjusted.");
                    onClose();
                  }
                }}>
          Apply
        </button>
      </div>
    </Modal>
  );
}

// ---------- Movements ledger ----------
const MOVE_LABEL: Record<StockMovement["movementType"], string> = {
  receive: "Received", sale: "Sold", return: "Returned",
  adjustment: "Adjusted", void_restock: "Void restock",
};
const MOVE_KIND: Record<StockMovement["movementType"], "success" | "neutral" | "info" | "warning"> = {
  receive: "success", sale: "neutral", return: "info",
  adjustment: "warning", void_restock: "warning",
};

function MovementsTab({ movements }: { movements: StockMovement[] }) {
  if (movements.length === 0) {
    return <EmptyState title="No stock movements yet" />;
  }
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>When</th><th>Variant</th><th>Type</th>
            <th className="num">Qty</th><th className="num">Unit cost</th><th>Note</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id}>
              <td className="muted">{timeLabel(movement.createdAt)}</td>
              <td>{movement.modelName} <span className="muted">
                {movement.color}/{movement.size}</span></td>
              <td>
                <Badge kind={MOVE_KIND[movement.movementType]}>
                  {MOVE_LABEL[movement.movementType]}
                </Badge>
                {movement.refPurchaseId ? <Badge kind="info">Purchase</Badge> : null}
                {movement.needsReview && !movement.reviewedAt
                  ? <Badge kind="danger">Review</Badge> : null}
              </td>
              <td className={`num ${movement.qty < 0 ? "neg" : "pos"}`}>
                {movement.qty > 0 ? `+${movement.qty}` : movement.qty}
              </td>
              <td className="num">{movement.unitCost != null ? formatBase(movement.unitCost) : "—"}</td>
              <td className="muted">{movement.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Review queue ----------
function ReviewTab({ items }: { items: StockMovement[] }) {
  const { mutate, pushToast } = useApp();
  if (items.length === 0) {
    return <EmptyState title="Nothing to review"
                       hint="Oversold variants show up here for sign-off." />;
  }
  return (
    <div className="card">
      {items.map((item) => (
        <div key={item.id} className="review-row">
          <AlertTriangle size={18} className="review-icon" />
          <div className="review-body">
            <strong>{item.modelName} {item.color}/{item.size}</strong>
            <span className="muted">
              Sold {Math.abs(item.qty)} beyond available stock on {timeLabel(item.createdAt)} —
              stock is now <strong className="num">{item.stockQty}</strong>.
              Count the shelf, then adjust stock if needed.
            </span>
          </div>
          <button className="btn btn-sm"
                  onClick={async () => {
                    const { ok, reason } = await askConfirm({
                      title: "Mark reviewed",
                      message: "Optional note about what you found.",
                      requireReason: false,
                      reasonPlaceholder: "e.g. found pair in stockroom",
                      confirmLabel: "Mark reviewed",
                    });
                    if (!ok) return;
                    if (await mutate("POST", `/api/stock/review/${item.id}/resolve`,
                                     { note: reason ?? null })) {
                      pushToast("success", "Marked reviewed.");
                    }
                  }}>
            Mark reviewed
          </button>
        </div>
      ))}
    </div>
  );
}
