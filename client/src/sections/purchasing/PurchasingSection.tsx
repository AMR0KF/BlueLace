// Purchasing: supplier purchases (goods-in) linked to stock, plus suppliers CRUD.
// A purchase receives every line into stock (movements carry the PUR reference) and
// can optionally pay the supplier from the cash box in the same document — that
// payment shows up in Financial's cash ledger as a 'supplier' paid-out.
import {
  Eye, Minus, PackagePlus, Pencil, Plus, Search, Trash2, Truck, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, blurOnWheel, EmptyState, MoneyInput, timeLabel } from "../../components/ui";
import { formatBase, roundBaseMoney } from "../../lib/money";
import { askConfirm, Modal } from "../../lib/modal";
import { useApp } from "../../state/AppState";
import type { Purchase, Supplier, Variant } from "../../types";

type Tab = "purchases" | "suppliers";

export function PurchasingSection() {
  const { boot } = useApp();
  const [tab, setTab] = useState<Tab>("purchases");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | "new" | null>(null);
  if (!boot) return null;

  // Older cached bootstraps (offline mode) may predate these feeds.
  const suppliers = boot.suppliers ?? [];
  const purchases = boot.purchases ?? [];

  const monthKey = new Date().toISOString().slice(0, 7);
  const received = purchases.filter((p) => p.status === "received");
  const thisMonth = received.filter((p) => p.createdAt.slice(0, 7) === monthKey);
  const monthSpend = roundBaseMoney(thisMonth.reduce((s, p) => s + p.totalCost, 0));
  const monthPairs = thisMonth.reduce((s, p) => s + p.itemsCount, 0);

  return (
    <div className="section-page">
      <header className="page-head">
        <h1>Purchasing</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <PackagePlus size={17} /> New purchase
        </button>
      </header>

      <div className="metric-row">
        <div className="metric-card">
          <div className="metric-label">This month — spend</div>
          <div className="metric-value num">{formatBase(monthSpend)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">This month — pairs in</div>
          <div className="metric-value num">{monthPairs}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Purchases</div>
          <div className="metric-value num">{received.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Suppliers</div>
          <div className="metric-value num">{suppliers.filter((s) => s.active).length}</div>
        </div>
      </div>

      <div className="preset-row">
        {(["purchases", "suppliers"] as Tab[]).map((name) => (
          <button key={name} className={`chip ${tab === name ? "chip-active" : ""}`}
                  onClick={() => setTab(name)}>
            <span className="cap">{name}</span>
          </button>
        ))}
      </div>

      {tab === "purchases" ? (
        <PurchasesTab purchases={purchases} suppliers={suppliers} onView={setViewing} />
      ) : null}
      {tab === "suppliers" ? (
        <SuppliersTab suppliers={suppliers} purchases={purchases}
                      onEdit={setEditingSupplier} />
      ) : null}

      {creating ? <NewPurchaseModal onClose={() => setCreating(false)} /> : null}
      {viewing ? (
        <PurchaseDetailModal purchase={viewing} suppliers={suppliers}
                             onClose={() => setViewing(null)} />
      ) : null}
      {editingSupplier ? (
        <SupplierEditorModal supplier={editingSupplier === "new" ? null : editingSupplier}
                             onClose={() => setEditingSupplier(null)} />
      ) : null}
    </div>
  );
}

// ---------- Purchases list ----------
function PurchasesTab({ purchases, suppliers, onView }: {
  purchases: Purchase[];
  suppliers: Supplier[];
  onView: (p: Purchase) => void;
}) {
  const { mutate, pushToast } = useApp();
  const [query, setQuery] = useState("");
  const supplierName = (id: string | null) =>
    id ? suppliers.find((s) => s.id === id)?.name ?? "?" : "—";

  const q = query.trim().toLowerCase();
  const filtered = q
    ? purchases.filter((p) =>
        p.purchaseRef.toLowerCase().includes(q) ||
        (p.invoiceNo ?? "").toLowerCase().includes(q) ||
        supplierName(p.supplierId).toLowerCase().includes(q) ||
        p.lines.some((l) => l.modelName.toLowerCase().includes(q)))
    : purchases;

  if (purchases.length === 0) {
    return <EmptyState icon={<Truck size={28} />} title="No purchases yet"
                       hint="Record a purchase to bring stock in with full cost tracking." />;
  }
  return (
    <>
      <div className="search-box" style={{ marginBottom: 14 }}>
        <Search size={18} />
        <input placeholder="Search ref, invoice, supplier, model..." value={query}
               onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>When</th><th>Ref</th><th>Supplier</th><th>Invoice</th>
              <th className="num">Items</th><th className="num">Total</th>
              <th className="num">Paid from box</th><th>Status</th><th className="th-actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((purchase) => (
              <tr key={purchase.id} className={purchase.status === "voided" ? "row-voided" : ""}>
                <td className="muted">{timeLabel(purchase.createdAt)}</td>
                <td><strong className="num">{purchase.purchaseRef}</strong></td>
                <td>{supplierName(purchase.supplierId)}</td>
                <td className="muted">{purchase.invoiceNo ?? "—"}</td>
                <td className="num">{purchase.itemsCount}</td>
                <td className="num">{formatBase(purchase.totalCost)}</td>
                <td className="num">
                  {purchase.paidAmount > 0 ? formatBase(purchase.paidAmount) : "—"}
                </td>
                <td>{purchase.status === "received"
                  ? <Badge kind="success">Received</Badge>
                  : <Badge kind="neutral">Voided</Badge>}</td>
                <td className="td-actions">
                  <button className="btn btn-sm" onClick={() => onView(purchase)}>
                    <Eye size={14} /> View
                  </button>
                  {purchase.status === "received" ? (
                    <button className="btn btn-sm btn-danger-soft"
                            onClick={async () => {
                              const { ok, reason } = await askConfirm({
                                title: `Void ${purchase.purchaseRef}?`,
                                message: "Stock added by this purchase is removed again and "
                                  + "any cash-box payment is returned to the box.",
                                danger: true,
                                requireReason: true,
                                reasonPlaceholder: "Why is it voided?",
                                confirmLabel: "Void purchase",
                              });
                              if (!ok || !reason) return;
                              if (await mutate("POST", `/api/purchases/${purchase.id}/void`,
                                               { reason })) {
                                pushToast("success", `${purchase.purchaseRef} voided.`);
                              }
                            }}>
                      Void
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PurchaseDetailModal({ purchase, suppliers, onClose }: {
  purchase: Purchase;
  suppliers: Supplier[];
  onClose: () => void;
}) {
  const supplier = purchase.supplierId
    ? suppliers.find((s) => s.id === purchase.supplierId) : null;
  return (
    <Modal onClose={onClose} wide labelledBy="purchase-detail-title">
      <h3 id="purchase-detail-title" className="modal-title">
        {purchase.purchaseRef}
        {purchase.status === "voided"
          ? <Badge kind="neutral">Voided</Badge>
          : <Badge kind="success">Received</Badge>}
      </h3>
      <p className="muted">
        {timeLabel(purchase.createdAt)}
        {supplier ? <> · {supplier.name}</> : null}
        {purchase.invoiceNo ? <> · Invoice {purchase.invoiceNo}</> : null}
      </p>
      {purchase.notes ? <p className="muted">{purchase.notes}</p> : null}
      {purchase.status === "voided" ? (
        <p className="login-error">
          Voided {purchase.voidedAt ? timeLabel(purchase.voidedAt) : ""} — {purchase.voidReason}
        </p>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th className="num">Qty</th>
            <th className="num">Unit cost</th><th className="num">Line total</th>
          </tr>
        </thead>
        <tbody>
          {purchase.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.modelName} <span className="muted">
                {line.color}/{line.size}{line.sku ? ` · ${line.sku}` : ""}</span></td>
              <td className="num">{line.qty}</td>
              <td className="num">{formatBase(line.unitCost)}</td>
              <td className="num">{formatBase(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="confirm-grid num" style={{ marginTop: 10 }}>
        <span>Total cost</span><strong>{formatBase(purchase.totalCost)}</strong>
        <span>Paid from cash box</span><strong>{formatBase(purchase.paidAmount)}</strong>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ---------- New purchase ----------
interface DraftLine {
  variantId: string;
  modelName: string;
  color: string;
  size: string;
  qty: number;
  unitCost: number;
}

function NewPurchaseModal({ onClose }: { onClose: () => void }) {
  const { boot, mutate, pushToast } = useApp();
  const suppliers = (boot?.suppliers ?? []).filter((s) => s.active);
  const models = (boot?.models ?? []).filter((m) => m.active);

  const variantsByModel = useMemo(() => {
    const map = new Map<string, Variant[]>();
    for (const variant of boot?.variants ?? []) {
      if (!variant.active) continue;
      const list = map.get(variant.modelId) ?? [];
      list.push(variant);
      map.set(variant.modelId, list);
    }
    return map;
  }, [boot?.variants]);

  const [supplierId, setSupplierId] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  // Item entry: picking a model opens a color×size grid — type quantities
  // straight in, exactly like reading them off the supplier invoice.
  const [modelId, setModelId] = useState("");
  const [cellQty, setCellQty] = useState<Map<string, number>>(new Map());
  const [fillQty, setFillQty] = useState("");
  const [cost, setCost] = useState(0);
  // Empty set = show every color/size (default). Selecting narrows the grid, and
  // Fill only touches what's shown — filter to one color, then fill it in one tap.
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [sizeFilter, setSizeFilter] = useState<Set<string>>(new Set());
  // Payment: draw from the cash box by default; uncheck to buy on credit/other cash.
  const [payFromBox, setPayFromBox] = useState(true);
  const [paidTouched, setPaidTouched] = useState(false);
  const [paidAmount, setPaidAmount] = useState(0);
  const [busy, setBusy] = useState(false);

  const model = models.find((m) => m.id === modelId) ?? null;
  const modelVariants = model ? variantsByModel.get(model.id) ?? [] : [];
  const allColors = [...new Set(modelVariants.map((v) => v.color))];
  const allSizes = [...new Set(modelVariants.map((v) => v.size))]
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const gridColors = colorFilter.size ? allColors.filter((c) => colorFilter.has(c)) : allColors;
  const gridSizes = sizeFilter.size ? allSizes.filter((s) => sizeFilter.has(s)) : allSizes;
  const byKey = new Map(modelVariants.map((v) => [`${v.color}|${v.size}`, v]));
  const modelVariantIds = new Set(modelVariants.map((v) => v.id));
  const modelHasLines = lines.some((l) => modelVariantIds.has(l.variantId));
  const pendingPairs = modelVariants
    .reduce((sum, v) => sum + (cellQty.get(v.id) ?? 0), 0);
  // Variants currently visible under the filters — Fill and its count use these.
  const shownVariants = modelVariants.filter((v) =>
    gridColors.includes(v.color) && gridSizes.includes(v.size));
  const filtersActive = colorFilter.size > 0 || sizeFilter.size > 0;

  const toggleFrom = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (value: string) => setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  const toggleColor = toggleFrom(setColorFilter);
  const toggleSize = toggleFrom(setSizeFilter);

  const total = roundBaseMoney(
    lines.reduce((sum, l) => sum + roundBaseMoney(l.qty * l.unitCost), 0));
  const effectivePaid = payFromBox
    ? Math.min(paidTouched ? paidAmount : total, total)
    : 0;

  const selectModel = (id: string) => {
    setModelId(id);
    setFillQty("");
    setColorFilter(new Set());
    setSizeFilter(new Set());
    const mv = (variantsByModel.get(id) ?? []);
    const ids = new Set(mv.map((v) => v.id));
    // Re-picking a model that's already in the document edits it in place.
    const existing = lines.filter((l) => ids.has(l.variantId));
    setCellQty(new Map(existing.map((l) => [l.variantId, l.qty])));
    const m = models.find((mm) => mm.id === id);
    setCost(existing[0]?.unitCost
      ?? mv.find((v) => v.lastCost != null)?.lastCost
      ?? m?.defaultCost ?? 0);
  };

  const setCell = (variantId: string, qty: number) => {
    setCellQty((prev) => {
      const next = new Map(prev);
      if (qty > 0) next.set(variantId, qty);
      else next.delete(variantId);
      return next;
    });
  };

  /** Replace this model's lines with the grid contents (qty 0 = drop the line). */
  const applyModel = () => {
    if (!model) return;
    setLines((prev) => [
      ...prev.filter((l) => !modelVariantIds.has(l.variantId)),
      ...modelVariants
        .filter((v) => (cellQty.get(v.id) ?? 0) > 0)
        .map((v) => ({
          variantId: v.id, modelName: model.name, color: v.color, size: v.size,
          qty: cellQty.get(v.id)!, unitCost: cost,
        })),
    ]);
    setModelId("");
    setCellQty(new Map());
    setFillQty("");
    setColorFilter(new Set());
    setSizeFilter(new Set());
  };

  const quickAddSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) return;
    const before = new Set(suppliers.map((s) => s.id));
    if (!(await mutate("POST", "/api/suppliers", { name }))) return;
    try {
      const cached = JSON.parse(localStorage.getItem("shoepos.bootstrap-cache.v1") ?? "null");
      const fresh = (cached?.suppliers ?? []).find(
        (s: Supplier) => !before.has(s.id) && s.name === name);
      if (fresh) setSupplierId(fresh.id);
    } catch { /* select stays empty — supplier still exists */ }
    setNewSupplierName("");
    setAddingSupplier(false);
  };

  const submit = async () => {
    if (lines.length === 0 || busy) return;
    setBusy(true);
    try {
      const ok = await mutate("POST", "/api/purchases", {
        supplierId: supplierId || null,
        invoiceNo: invoiceNo.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitCost: l.unitCost })),
        paidFromDrawer: effectivePaid,
      });
      if (ok) {
        pushToast("success", `Purchase recorded — ${lines.reduce((s, l) => s + l.qty, 0)} pairs in.`);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} wide labelledBy="new-purchase-title">
      <h3 id="new-purchase-title" className="modal-title">
        <PackagePlus size={18} /> New purchase
      </h3>

      <div className="form-grid">
        <label className="field"><span className="field-label">Supplier (optional)</span>
          {addingSupplier ? (
            <span className="supplier-quick-add">
              <input className="input" value={newSupplierName} autoFocus
                     placeholder="Supplier name"
                     onChange={(event) => setNewSupplierName(event.target.value)}
                     onKeyDown={(event) => {
                       if (event.key === "Enter") void quickAddSupplier();
                     }} />
              <button className="btn btn-sm btn-primary" disabled={!newSupplierName.trim()}
                      onClick={() => void quickAddSupplier()}>Add</button>
              <button className="btn btn-sm" onClick={() => setAddingSupplier(false)}>
                <X size={13} />
              </button>
            </span>
          ) : (
            <span className="supplier-quick-add">
              <select className="input" value={supplierId}
                      onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">— No supplier —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn btn-sm" onClick={() => setAddingSupplier(true)}>
                <Plus size={13} /> New
              </button>
            </span>
          )}
        </label>
        <label className="field"><span className="field-label">Supplier invoice no.</span>
          <input className="input" value={invoiceNo} maxLength={80}
                 onChange={(event) => setInvoiceNo(event.target.value)}
                 placeholder="INV-1234" /></label>
        <label className="field field-span"><span className="field-label">Notes</span>
          <input className="input" value={notes} maxLength={400}
                 onChange={(event) => setNotes(event.target.value)} /></label>
      </div>

      <h4 className="subhead">Items</h4>
      <div className="line-adder">
        <div className="adder-row">
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span className="field-label">Model — pick one to enter quantities</span>
            <select className="input" value={modelId}
                    onChange={(event) => selectModel(event.target.value)}>
              <option value="">Pick a model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.brand ? ` — ${m.brand}` : ""}
                </option>
              ))}
            </select>
          </label>
          {model ? (
            <label className="field" style={{ width: 140 }}>
              <span className="field-label">Unit cost (USD)</span>
              <MoneyInput value={cost} onCommit={setCost} />
            </label>
          ) : null}
        </div>

        {model ? (
          modelVariants.length === 0 ? (
            <p className="muted">This model has no variants — add colors and sizes in Stock first.</p>
          ) : (
            <>
              {allColors.length > 1 || allSizes.length > 1 ? (
                <div className="filter-block">
                  {allColors.length > 1 ? (
                    <div className="filter-line">
                      <span className="field-label">Colors</span>
                      <div className="preset-row">
                        {allColors.map((name) => (
                          <button key={name} type="button"
                                  className={`chip ${colorFilter.has(name) ? "chip-active" : ""}`}
                                  onClick={() => toggleColor(name)}>
                            {name}
                          </button>
                        ))}
                        {colorFilter.size ? (
                          <button type="button" className="chip chip-clear"
                                  onClick={() => setColorFilter(new Set())}>All</button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {allSizes.length > 1 ? (
                    <div className="filter-line">
                      <span className="field-label">Sizes</span>
                      <div className="preset-row">
                        {allSizes.map((name) => (
                          <button key={name} type="button"
                                  className={`chip ${sizeFilter.has(name) ? "chip-active" : ""}`}
                                  onClick={() => toggleSize(name)}>
                            {name}
                          </button>
                        ))}
                        {sizeFilter.size ? (
                          <button type="button" className="chip chip-clear"
                                  onClick={() => setSizeFilter(new Set())}>All</button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="adder-row">
                <input className="input num" style={{ width: 90 }} type="number" min={0}
                       placeholder="Qty" value={fillQty} onWheel={blurOnWheel}
                       onChange={(event) => setFillQty(event.target.value)} />
                <button className="btn btn-sm" disabled={fillQty === ""}
                        onClick={() => {
                          const q = Math.max(0, Math.floor(Number(fillQty) || 0));
                          setCellQty((prev) => {
                            const next = new Map(prev);
                            for (const v of shownVariants) {
                              if (q > 0) next.set(v.id, q);
                              else next.delete(v.id);
                            }
                            return next;
                          });
                        }}>
                  {filtersActive
                    ? `Fill shown (${shownVariants.length})`
                    : "Fill every variant"}
                </button>
                {pendingPairs > 0 ? (
                  <button className="btn btn-sm" onClick={() => setCellQty(new Map())}>
                    Clear grid
                  </button>
                ) : null}
              </div>

              <div className="matrix-scroll">
                <table className="matrix qty-matrix">
                  <thead>
                    <tr>
                      <th />
                      {gridSizes.map((size) => <th key={size} className="num">{size}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {gridColors.map((color) => (
                      <tr key={color}>
                        <th className="matrix-color">{color}</th>
                        {gridSizes.map((size) => {
                          const variant = byKey.get(`${color}|${size}`);
                          if (!variant) return <td key={size} className="matrix-empty">—</td>;
                          const q = cellQty.get(variant.id) ?? 0;
                          return (
                            <td key={size}>
                              <div className="qty-cell">
                                <div className="qty-stepper">
                                  <button type="button" className="qty-btn" aria-label="Less"
                                          disabled={q <= 0}
                                          onClick={() => setCell(variant.id, q - 1)}>
                                    <Minus size={13} />
                                  </button>
                                  <input className="input num qty-cell-input" type="number"
                                         min={0} value={q || ""} placeholder="0"
                                         onWheel={blurOnWheel}
                                         onChange={(event) => setCell(variant.id,
                                           Math.max(0, Math.floor(Number(event.target.value) || 0)))} />
                                  <button type="button" className="qty-btn" aria-label="More"
                                          onClick={() => setCell(variant.id, q + 1)}>
                                    <Plus size={13} />
                                  </button>
                                </div>
                                <span className="qty-cell-stock num">{variant.stockQty} now</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button className="btn btn-primary" disabled={pendingPairs === 0 && !modelHasLines}
                      onClick={applyModel}>
                {pendingPairs > 0
                  ? `Add ${pendingPairs} pair${pendingPairs === 1 ? "" : "s"} of ${model.name}`
                  : modelHasLines
                    ? `Remove ${model.name} from this purchase`
                    : "Type quantities above"}
              </button>
            </>
          )
        ) : null}
      </div>

      {lines.length > 0 ? (
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Item</th><th className="num">Qty</th>
              <th className="num">Unit cost</th><th className="num">Total</th><th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.variantId}>
                <td>{line.modelName} <span className="muted">{line.color}/{line.size}</span></td>
                <td className="num" style={{ width: 132 }}>
                  <div className="qty-stepper">
                    <button type="button" className="qty-btn" aria-label="Less"
                            disabled={line.qty <= 1}
                            onClick={() => setLines((prev) => prev.map((l) =>
                              l.variantId === line.variantId
                                ? { ...l, qty: l.qty - 1 } : l))}>
                      <Minus size={13} />
                    </button>
                    <input className="input num qty-cell-input" type="number" min={1}
                           value={line.qty} onWheel={blurOnWheel}
                           onChange={(event) => {
                             const parsed = Math.max(1, Math.floor(Number(event.target.value) || 1));
                             setLines((prev) => prev.map((l) =>
                               l.variantId === line.variantId ? { ...l, qty: parsed } : l));
                           }} />
                    <button type="button" className="qty-btn" aria-label="More"
                            onClick={() => setLines((prev) => prev.map((l) =>
                              l.variantId === line.variantId
                                ? { ...l, qty: l.qty + 1 } : l))}>
                      <Plus size={13} />
                    </button>
                  </div>
                </td>
                <td className="num" style={{ width: 120 }}>
                  <MoneyInput value={line.unitCost}
                              onCommit={(v) => setLines((prev) => prev.map((l) =>
                                l.variantId === line.variantId ? { ...l, unitCost: v } : l))} />
                </td>
                <td className="num">{formatBase(roundBaseMoney(line.qty * line.unitCost))}</td>
                <td className="td-actions">
                  <button className="btn btn-sm btn-danger-soft" aria-label="Remove line"
                          onClick={() => setLines((prev) =>
                            prev.filter((l) => l.variantId !== line.variantId))}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ marginTop: 10 }}>No items yet — add lines above.</p>
      )}

      <div className="purchase-total-row num">
        <span>{lines.reduce((s, l) => s + l.qty, 0)} pairs</span>
        <span>Total: {formatBase(total)}</span>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={payFromBox}
               onChange={(event) => setPayFromBox(event.target.checked)} />
        <span>Pay supplier from the cash box now
          <span className="muted"> — shows as a paid-out in Financial</span></span>
      </label>
      {payFromBox ? (
        <div className="form-grid" style={{ marginTop: 6 }}>
          <label className="field"><span className="field-label">Amount paid now (USD)</span>
            <MoneyInput value={paidTouched ? paidAmount : total} max={total}
                        onCommit={(v) => { setPaidTouched(true); setPaidAmount(v); }} />
          </label>
        </div>
      ) : (
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Nothing leaves the cash box — record the payment later as a “supplier” paid-out
          in Financial.
        </p>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-cta" disabled={lines.length === 0 || busy}
                onClick={() => void submit()}>
          {busy ? "Saving…" : `Receive ${lines.reduce((s, l) => s + l.qty, 0)} pairs`}
        </button>
      </div>
    </Modal>
  );
}

// ---------- Suppliers ----------
function SuppliersTab({ suppliers, purchases, onEdit }: {
  suppliers: Supplier[];
  purchases: Purchase[];
  onEdit: (s: Supplier | "new") => void;
}) {
  const { mutate, pushToast } = useApp();
  const purchaseCount = (id: string) =>
    purchases.filter((p) => p.supplierId === id && p.status === "received").length;
  return (
    <div className="card">
      <div className="card-head-row">
        <h2 className="card-title" style={{ marginBottom: 0 }}>Suppliers</h2>
        <button className="btn btn-sm btn-primary" onClick={() => onEdit("new")}>
          <Plus size={14} /> New supplier
        </button>
      </div>
      {suppliers.length === 0 ? (
        <EmptyState title="No suppliers yet"
                    hint="Add the wholesalers you buy from to track purchases per supplier." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th><th>Phone</th><th>Note</th>
              <th className="num">Purchases</th><th>Status</th><th className="th-actions" />
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td><strong>{supplier.name}</strong></td>
                <td className="muted">{supplier.phone ?? "—"}</td>
                <td className="muted">{supplier.note ?? ""}</td>
                <td className="num">{purchaseCount(supplier.id)}</td>
                <td>{supplier.active
                  ? <Badge kind="success">Active</Badge>
                  : <Badge kind="neutral">Inactive</Badge>}</td>
                <td className="td-actions">
                  <button className="btn btn-sm" onClick={() => onEdit(supplier)}>
                    <Pencil size={14} /> Edit
                  </button>
                  <button className="btn btn-sm btn-danger-soft"
                          onClick={async () => {
                            const { ok } = await askConfirm({
                              title: supplier.active
                                ? `Delete "${supplier.name}"?`
                                : `Reactivate "${supplier.name}"?`,
                              message: supplier.active
                                ? "Suppliers with purchase history are deactivated instead of deleted."
                                : undefined,
                              danger: supplier.active,
                              confirmLabel: supplier.active ? "Delete" : "Reactivate",
                            });
                            if (!ok) return;
                            if (supplier.active) {
                              if (await mutate("DELETE", `/api/suppliers/${supplier.id}`)) {
                                pushToast("success", "Supplier removed.");
                              }
                            } else {
                              await mutate("PATCH", `/api/suppliers/${supplier.id}`,
                                           { active: true });
                            }
                          }}>
                    {supplier.active ? "Delete" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SupplierEditorModal({ supplier, onClose }: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const { mutate, pushToast } = useApp();
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    phone: supplier?.phone ?? "",
    note: supplier?.note ?? "",
  });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const save = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        note: form.note.trim() || null,
      };
      const ok = supplier
        ? await mutate("PATCH", `/api/suppliers/${supplier.id}`, payload)
        : await mutate("POST", "/api/suppliers", payload);
      if (ok) {
        pushToast("success", `Saved "${form.name.trim()}".`);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="supplier-editor-title">
      <h3 id="supplier-editor-title" className="modal-title">
        {supplier ? `Edit ${supplier.name}` : "New supplier"}
      </h3>
      <div className="form-grid">
        <label className="field field-span"><span className="field-label">Name</span>
          <input className="input" value={form.name} onChange={set("name")} autoFocus
                 maxLength={120} /></label>
        <label className="field"><span className="field-label">Phone</span>
          <input className="input" value={form.phone} onChange={set("phone")}
                 maxLength={40} /></label>
        <label className="field"><span className="field-label">Note</span>
          <input className="input" value={form.note} onChange={set("note")}
                 maxLength={400} /></label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-cta" disabled={!form.name.trim() || busy}
                onClick={() => void save()}>
          {busy ? "Saving…" : "Save supplier"}
        </button>
      </div>
    </Modal>
  );
}
