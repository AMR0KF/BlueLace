// POS register: model tiles -> variant picker (color -> size grid with stock),
// cart with inline price editor, tender toggle, whole-cart discount (>=50% needs
// reason), Cash-in-full + 3-step Partial/Unpaid wizard, hold/resume.
// Ports PosRegister (App.tsx:7869) to the shoe domain.
import {
  Minus, Pause, Percent, Play, Plus, RotateCcw, Search, ShoppingCart, Trash2, X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ShoeVisual } from "../../components/ShoeVisual";
import { useT } from "../../lib/i18n";
import { askConfirm, Modal } from "../../lib/modal";
import {
  formatBase, formatInCurrency, formatSecondary, fromSecondary, roundBaseMoney,
  toSecondary,
} from "../../lib/money";
import { useApp, type OfflineSalePayload } from "../../state/AppState";
import type { CartLine, Customer, ShoeModel, Variant } from "../../types";

const LARGE_DISCOUNT_PERCENT = 50;
const HIDE_OUT_KEY = "shoepos.pos-hide-out.v1";

function newSaleId(): string {
  return `S-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function unitPriceFor(variant: Variant, model: ShoeModel): number {
  return variant.priceOverride ?? model.basePrice;
}

export function PosSection() {
  const {
    boot, cart, setCart, heldCart, holdCart, resumeHeldCart, pushToast, createSale,
  } = useApp();
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [hideOut, setHideOut] = useState(() => localStorage.getItem(HIDE_OUT_KEY) === "1");
  const [pickerModel, setPickerModel] = useState<ShoeModel | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [tender, setTender] = useState<"base" | "secondary">("base");
  const [discount, setDiscount] = useState<{ amount: number; reason: string | null }>({
    amount: 0, reason: null,
  });
  const completing = useRef(false);

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

  if (!boot) return null;
  const settings = boot.settings;
  const tenderCurrency = tender === "base" ? settings.baseCurrency : settings.secondaryCurrency;

  const models = boot.models.filter((m) => m.active);

  const stockOf = (m: ShoeModel) =>
    (variantsByModel.get(m.id) ?? []).reduce((sum, v) => sum + Math.max(v.stockQty, 0), 0);

  const q = query.trim().toLowerCase();
  const matched = q
    ? models.filter((m) =>
        m.name.toLowerCase().includes(q) || (m.brand ?? "").toLowerCase().includes(q) ||
        (m.category ?? "").toLowerCase().includes(q) ||
        (variantsByModel.get(m.id) ?? []).some(
          (v) => (v.sku ?? "").toLowerCase() === q || (v.barcode ?? "") === q))
    : models;
  const filtered = hideOut ? matched.filter((m) => stockOf(m) > 0) : matched;
  const hiddenCount = matched.length - filtered.length;

  const toggleHideOut = () => {
    setHideOut((prev) => {
      localStorage.setItem(HIDE_OUT_KEY, prev ? "0" : "1");
      return !prev;
    });
  };

  // ---- cart math (mirrors server compute_totals; previews must match) ----
  const subtotal = roundBaseMoney(
    cart.reduce((sum, line) => sum + roundBaseMoney(line.qty * line.unitPrice), 0));
  const discountAmount = Math.min(discount.amount, subtotal);
  const taxable = roundBaseMoney(subtotal - discountAmount);
  const tax = settings.taxRate > 0 ? roundBaseMoney(taxable * settings.taxRate / 100) : 0;
  const total = roundBaseMoney(taxable + tax);

  const addVariant = (variant: Variant, model: ShoeModel) => {
    setCart((prev) => {
      const existing = prev.find((line) => line.variantId === variant.id);
      if (existing) {
        return prev.map((line) =>
          line.variantId === variant.id ? { ...line, qty: line.qty + 1 } : line);
      }
      const price = unitPriceFor(variant, model);
      return [...prev, {
        key: variant.id, variantId: variant.id, modelName: model.name,
        color: variant.color, size: variant.size, qty: 1,
        unitPrice: price, defaultPrice: price, stockQty: variant.stockQty,
      }];
    });
  };

  const clearSaleState = () => {
    setCart(() => []);
    setDiscount({ amount: 0, reason: null });
    setTender("base");
  };

  const completeCashSale = async (customerId: string | null = null) => {
    if (cart.length === 0 || completing.current) return;
    completing.current = true;
    try {
      const payload = buildPayload("cash", 0, customerId);
      const result = await createSale(payload);
      if (result === "saved") {
        pushToast("success", t("Sale completed"));
        clearSaleState();
      } else if (result === "queued") {
        pushToast("info", `${t("Queued")} — ${t("Sale completed")}`);
        clearSaleState();
      }
    } finally {
      completing.current = false;
    }
  };

  function buildPayload(mode: "cash" | "partial", paidNow: number,
                        customerId: string | null): OfflineSalePayload {
    return {
      id: newSaleId(),
      createdAt: new Date().toISOString(),
      customerId,
      lines: cart.map((line) => ({
        variantId: line.variantId,
        customName: line.variantId ? undefined : line.modelName,
        qty: line.qty,
        unitPrice: line.unitPrice,
      })),
      discountAmount,
      discountReason: discount.reason,
      tenderCurrency,
      tenderRate: settings.exchangeRate,
      paymentMode: mode,
      paidNow,
    };
  }

  return (
    <div className="pos-layout">
      <div className="pos-catalog">
        <div className="search-box">
          <Search size={18} />
          <input placeholder={t("Search shoes...")} value={query}
                 onChange={(event) => setQuery(event.target.value)} />
          {query ? (
            <button onClick={() => setQuery("")} aria-label={t("Cancel")}><X size={16} /></button>
          ) : null}
        </div>
        <div className="preset-row">
          <button className={`chip ${hideOut ? "chip-active" : ""}`} onClick={toggleHideOut}>
            {t("Hide out of stock")}
            {hideOut && hiddenCount > 0 ? <em className="num">{hiddenCount}</em> : null}
          </button>
        </div>
        <div className="tile-grid">
          {filtered.map((model) => {
            const stock = stockOf(model);
            return (
              <button key={model.id}
                      className={`product-tile tile-${model.tileColor ?? "stone"} ${stock <= 0 ? "tile-out" : ""}`}
                      onClick={() => setPickerModel(model)}>
                <span className="tile-visual"><ShoeVisual image={model.image} size={40} /></span>
                <span className="tile-name">{model.name}</span>
                <span className="tile-meta">
                  <strong className="num">{formatBase(model.basePrice)}</strong>
                  <span className={`num tile-stock ${stock <= 0 ? "stock-out" : stock <= 3 ? "stock-low" : ""}`}>
                    {stock} {t("left")}
                  </span>
                </span>
              </button>
            );
          })}
          <button className="product-tile tile-custom" onClick={() => setCustomOpen(true)}>
            <span className="tile-visual"><Plus size={30} /></span>
            <span className="tile-name">{t("Custom item")}</span>
          </button>
        </div>
      </div>

      <aside className="cart-panel">
        <div className="cart-head">
          <h2><ShoppingCart size={18} /> {t("Cart")}
            {cart.length ? <em className="num">{cart.reduce((s, l) => s + l.qty, 0)}</em> : null}
          </h2>
          <div className="cart-head-actions">
            {heldCart ? (
              <button className="btn btn-sm" onClick={resumeHeldCart}>
                <Play size={13} /> {t("Resume")}
              </button>
            ) : null}
            {cart.length > 0 ? (
              <>
                <button className="btn btn-sm" onClick={holdCart}>
                  <Pause size={13} /> {t("Hold")}
                </button>
                <button className="btn btn-sm btn-danger-soft"
                        onClick={async () => {
                          const { ok } = await askConfirm({
                            title: t("Clear cart"), danger: true, confirmLabel: t("Clear cart"),
                          });
                          if (ok) clearSaleState();
                        }}>
                  <Trash2 size={13} />
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="cart-lines">
          {cart.length === 0 ? (
            <p className="cart-empty muted">{t("Cart is empty")}</p>
          ) : cart.map((line) => (
            <CartLineRow key={line.key} line={line} settings={settings} />
          ))}
        </div>

        <div className="cart-summary">
          <div className="currency-toggle">
            <span className="field-label">{t("Charge in")}</span>
            <div className="segmented">
              <button className={tender === "base" ? "seg-active" : ""}
                      onClick={() => setTender("base")}>{settings.baseCurrency}</button>
              <button className={tender === "secondary" ? "seg-active" : ""}
                      onClick={() => setTender("secondary")}>{settings.secondaryCurrency}</button>
            </div>
          </div>
          {tender === "secondary" ? (
            <p className="rate-line muted num">
              1 {settings.baseCurrency} = {formatSecondary(settings.exchangeRate, settings.secondaryCurrency)}
            </p>
          ) : null}

          {(discountAmount > 0 || tax > 0) && (
            <div className="sum-row muted">
              <span>{t("Subtotal")}</span>
              <span className="num">{formatInCurrency(subtotal, tenderCurrency, settings, settings.exchangeRate)}</span>
            </div>
          )}
          {discountAmount > 0 ? (
            <div className="sum-row sum-discount">
              <span>{t("Discount")}{discount.reason ? ` · ${discount.reason}` : ""}</span>
              <span className="num">
                −{formatInCurrency(discountAmount, tenderCurrency, settings, settings.exchangeRate)}
              </span>
            </div>
          ) : null}
          {tax > 0 ? (
            <div className="sum-row muted">
              <span>{t("Tax")} ({settings.taxRate}%)</span>
              <span className="num">{formatInCurrency(tax, tenderCurrency, settings, settings.exchangeRate)}</span>
            </div>
          ) : null}
          <div className="sum-row sum-total">
            <span>{t("Total")}</span>
            <span className="num">{formatInCurrency(total, tenderCurrency, settings, settings.exchangeRate)}</span>
          </div>
          <div className="sum-row muted sum-equiv">
            <span />
            <span className="num">
              {tender === "base"
                ? formatSecondary(toSecondary(total, settings.exchangeRate),
                    settings.secondaryCurrency, settings.lbpDisplayRounding)
                : formatBase(total, settings.baseCurrency)}
            </span>
          </div>

          <button className="btn btn-ghost btn-discount" onClick={() => setDiscountOpen(true)}
                  disabled={cart.length === 0}>
            <Percent size={15} />
            {discountAmount > 0 ? `${t("Discount")}: ${formatBase(discountAmount)}` : t("Discount")}
          </button>

          {/* total 0 stays allowed: a 100% discount is a tracked giveaway */}
          <button className="btn btn-cta btn-block btn-checkout"
                  disabled={cart.length === 0}
                  onClick={() => void completeCashSale()}>
            {t("Cash (paid in full)")}
          </button>
          <button className="btn btn-block" disabled={cart.length === 0 || total <= 0}
                  onClick={() => setWizardOpen(true)}>
            {t("Partial / Unpaid")}
          </button>
        </div>
      </aside>

      {pickerModel ? (
        <VariantPicker
          model={pickerModel}
          variants={variantsByModel.get(pickerModel.id) ?? []}
          onAdd={(variant) => addVariant(variant, pickerModel)}
          onClose={() => setPickerModel(null)}
        />
      ) : null}
      {customOpen ? (
        <CustomItemModal
          onAdd={(name, price) => {
            setCart((prev) => [...prev, {
              key: `custom-${Date.now()}`, variantId: null, modelName: name,
              color: null, size: null, qty: 1, unitPrice: price, defaultPrice: price,
            }]);
            setCustomOpen(false);
          }}
          onClose={() => setCustomOpen(false)}
        />
      ) : null}
      {discountOpen ? (
        <DiscountPopover
          subtotal={subtotal}
          current={discount}
          tenderCurrency={tenderCurrency}
          onApply={(amount, reason) => {
            setDiscount({ amount, reason });
            setDiscountOpen(false);
          }}
          onClose={() => setDiscountOpen(false)}
        />
      ) : null}
      {wizardOpen ? (
        <PartialWizard
          total={total}
          tenderCurrency={tenderCurrency}
          onDone={async (customerId, paidNow) => {
            setWizardOpen(false);
            if (completing.current) return;
            completing.current = true;
            try {
              const payload = buildPayload("partial", paidNow, customerId);
              const result = await createSale(payload);
              if (result !== "failed") {
                pushToast(result === "saved" ? "success" : "info",
                  result === "saved" ? t("Sale completed") : t("Queued"));
                clearSaleState();
              }
            } finally {
              completing.current = false;
            }
          }}
          onClose={() => setWizardOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ---------- Cart line ----------
function CartLineRow({ line, settings }: {
  line: CartLine;
  settings: { baseCurrency: string; secondaryCurrency: string; exchangeRate: number; lbpDisplayRounding: number };
}) {
  const { setCart } = useApp();
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceText, setPriceText] = useState("");
  const custom = Math.abs(line.unitPrice - line.defaultPrice) > 0.004;

  const setQty = (qty: number) => {
    setCart((prev) => qty <= 0
      ? prev.filter((l) => l.key !== line.key)
      : prev.map((l) => (l.key === line.key ? { ...l, qty } : l)));
  };

  return (
    <div className="cart-line">
      <div className="cart-line-info">
        <strong>{line.modelName}</strong>
        <span className="muted">
          {line.color ? `${line.color} / ${line.size}` : "custom"}
          {line.stockQty !== undefined && line.qty > line.stockQty ? (
            <span className="badge badge-warning">review</span>
          ) : null}
        </span>
        {editingPrice ? (
          <span className="price-edit">
            <input className="input num" autoFocus value={priceText} inputMode="decimal"
                   onChange={(event) => setPriceText(event.target.value)}
                   onBlur={() => {
                     const parsed = parseFloat(priceText);
                     if (Number.isFinite(parsed) && parsed >= 0) {
                       setCart((prev) => prev.map((l) =>
                         l.key === line.key ? { ...l, unitPrice: roundBaseMoney(parsed) } : l));
                     }
                     setEditingPrice(false);
                   }}
                   onKeyDown={(event) => {
                     if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                     if (event.key === "Escape") setEditingPrice(false);
                   }} />
          </span>
        ) : (
          <button className="price-btn num" onClick={() => {
            setPriceText(String(line.unitPrice));
            setEditingPrice(true);
          }}>
            {formatBase(line.unitPrice)}
            {custom ? <span className="badge badge-info">custom</span> : null}
          </button>
        )}
        {custom && !editingPrice ? (
          <button className="price-reset" title="Reset price"
                  onClick={() => setCart((prev) => prev.map((l) =>
                    l.key === line.key ? { ...l, unitPrice: l.defaultPrice } : l))}>
            <RotateCcw size={12} />
          </button>
        ) : null}
      </div>
      <div className="cart-line-qty">
        <button className="qty-btn" onClick={() => setQty(line.qty - 1)}><Minus size={14} /></button>
        <input className="qty-input num" value={line.qty} inputMode="numeric"
               onChange={(event) => {
                 const parsed = Math.floor(Number(event.target.value));
                 if (Number.isFinite(parsed) && parsed >= 0) setQty(parsed);
               }} />
        <button className="qty-btn" onClick={() => setQty(line.qty + 1)}><Plus size={14} /></button>
      </div>
      <div className="cart-line-total num">
        {formatBase(roundBaseMoney(line.qty * line.unitPrice))}
      </div>
      <button className="cart-line-remove" onClick={() => setQty(0)} aria-label="Remove">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

// ---------- Variant picker: full color × size grid, tap a cell to add ----------
function VariantPicker({ model, variants, onAdd, onClose }: {
  model: ShoeModel;
  variants: Variant[];
  onAdd: (v: Variant) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [added, setAdded] = useState<Record<string, number>>({});
  const totalAdded = Object.values(added).reduce((s, n) => s + n, 0);

  const colors = [...new Set(variants.map((v) => v.color))];
  const sizes = [...new Set(variants.map((v) => v.size))]
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const byKey = new Map(variants.map((v) => [`${v.color}|${v.size}`, v]));
  // Rows show the color photo when the model has one; otherwise the swatch name only.
  const anyPhoto = colors.some((c) => model.colorImages?.[c]);

  const add = (variant: Variant) => {
    onAdd(variant);
    setAdded((prev) => ({ ...prev, [variant.id]: (prev[variant.id] ?? 0) + 1 }));
  };

  return (
    <Modal onClose={onClose} wide labelledBy="picker-title">
      <h3 id="picker-title" className="modal-title">
        <ShoeVisual image={model.image} size={20} /> {model.name}
        <span className="muted"> · {formatBase(model.basePrice)}</span>
      </h3>
      {variants.length === 0 ? (
        <p className="muted">No variants — add colors and sizes in Stock.</p>
      ) : (
        <>
          <p className="field-label">{t("Tap a size to add it to the cart")}</p>
          <div className="matrix-scroll">
            <table className="matrix pos-pick-matrix">
              <thead>
                <tr>
                  <th />
                  {sizes.map((size) => <th key={size} className="num">{size}</th>)}
                </tr>
              </thead>
              <tbody>
                {colors.map((color) => (
                  <tr key={color}>
                    <th className="matrix-color pos-pick-rowhead">
                      {anyPhoto && model.colorImages?.[color] ? (
                        <img className="pick-row-thumb" src={model.colorImages[color]} alt="" />
                      ) : null}
                      {color}
                    </th>
                    {sizes.map((size) => {
                      const variant = byKey.get(`${color}|${size}`);
                      if (!variant) return <td key={size} className="matrix-empty">—</td>;
                      const inCart = added[variant.id] ?? 0;
                      const tone = variant.stockQty <= 0 ? "cell-danger"
                        : variant.stockQty <= 1 ? "cell-warn" : "";
                      return (
                        <td key={size}>
                          <button
                            className={`matrix-cell pos-pick-cell num ${tone} ${inCart ? "cell-added" : ""}`}
                            title={`${color} / ${size} — ${variant.stockQty <= 0 ? t("Out of stock") : `${variant.stockQty} ${t("left")}`}`}
                            onClick={() => add(variant)}
                          >
                            <span className="pick-stock">{variant.stockQty}</span>
                            {variant.priceOverride != null ? (
                              <span className="pick-price">{formatBase(variant.priceOverride)}</span>
                            ) : null}
                            {inCart ? <em className="pick-badge num">{inCart}</em> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="matrix-hint muted">
            {t("Numbers show stock on hand. Red = out, amber = last pair — you can still sell (it goes to review).")}
          </p>
          <div className="modal-actions">
            <button className="btn btn-cta" onClick={onClose}>
              {totalAdded > 0
                ? `${t("Done")} · ${totalAdded} ${t("added")}`
                : t("Done")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Custom item ----------
function CustomItemModal({ onAdd, onClose }: {
  onAdd: (name: string, price: number) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const parsed = parseFloat(price);
  const valid = name.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0;
  return (
    <Modal onClose={onClose} labelledBy="custom-title">
      <h3 id="custom-title" className="modal-title">{t("Custom item")}</h3>
      <div className="form-grid">
        <label className="field field-span"><span className="field-label">{t("Item name")}</span>
          <input className="input" value={name} autoFocus maxLength={120}
                 onChange={(event) => setName(event.target.value)} /></label>
        <label className="field field-span"><span className="field-label">{t("Price")} (USD)</span>
          <input className="input num" value={price} inputMode="decimal"
                 onChange={(event) => setPrice(event.target.value)}
                 onKeyDown={(event) => {
                   if (event.key === "Enter" && valid) onAdd(name.trim(), roundBaseMoney(parsed));
                 }} /></label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-cta" disabled={!valid}
                onClick={() => onAdd(name.trim(), roundBaseMoney(parsed))}>
          {t("Add to cart")}
        </button>
      </div>
    </Modal>
  );
}

// ---------- Discount popover ----------
function DiscountPopover({ subtotal, current, tenderCurrency, onApply, onClose }: {
  subtotal: number;
  current: { amount: number; reason: string | null };
  tenderCurrency: string;
  onApply: (amountBase: number, reason: string | null) => void;
  onClose: () => void;
}) {
  const { boot } = useApp();
  const { t } = useT();
  const settings = boot!.settings;
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [text, setText] = useState(current.amount > 0 && subtotal > 0
    ? String(Math.round(current.amount / subtotal * 100)) : "");
  const [reason, setReason] = useState(current.reason ?? "");

  const parsed = parseFloat(text.replace(/,/g, ""));
  let amountBase = 0;
  if (Number.isFinite(parsed) && parsed > 0) {
    if (mode === "percent") {
      amountBase = roundBaseMoney(subtotal * Math.min(parsed, 100) / 100);
    } else if (tenderCurrency === settings.baseCurrency) {
      amountBase = roundBaseMoney(parsed);
    } else {
      amountBase = fromSecondary(parsed, settings.exchangeRate);
    }
    amountBase = Math.min(amountBase, subtotal);
  }
  const percent = subtotal > 0 ? amountBase / subtotal * 100 : 0;
  const needsReason = percent >= LARGE_DISCOUNT_PERCENT - 0.01 && amountBase > 0;
  const canApply = amountBase === 0 || !needsReason || reason.trim().length > 0;

  return (
    <Modal onClose={onClose} labelledBy="discount-title">
      <h3 id="discount-title" className="modal-title">{t("Discount")}</h3>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={mode === "percent" ? "seg-active" : ""}
                onClick={() => { setMode("percent"); setText(""); }}>{t("Percent")}</button>
        <button className={mode === "amount" ? "seg-active" : ""}
                onClick={() => { setMode("amount"); setText(""); }}>
          {t("Amount")} ({tenderCurrency})
        </button>
      </div>
      {mode === "percent" ? (
        <div className="preset-row">
          {[5, 10, 15, 20, 25, 50, 100].map((preset) => (
            <button key={preset}
                    className={`chip ${text === String(preset) ? "chip-active" : ""}`}
                    onClick={() => setText(String(preset))}>{preset}%</button>
          ))}
        </div>
      ) : null}
      <input className="input num" value={text} inputMode="decimal" autoFocus
             placeholder={mode === "percent" ? "%" : tenderCurrency}
             onChange={(event) => setText(event.target.value)} />
      <p className="discount-preview num muted">
        {formatBase(subtotal)} − {formatBase(amountBase)} = <strong>{formatBase(roundBaseMoney(subtotal - amountBase))}</strong>
        {amountBase > 0 ? ` (${percent.toFixed(0)}%)` : ""}
      </p>
      {needsReason ? (
        <label className="field">
          <span className="field-label">{t("Reason (required for big discounts)")}</span>
          <input className="input" value={reason} maxLength={200}
                 onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : null}
      <div className="modal-actions">
        {current.amount > 0 ? (
          <button className="btn btn-danger-soft" onClick={() => onApply(0, null)}>
            {t("Remove")}
          </button>
        ) : null}
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" disabled={!canApply}
                onClick={() => onApply(amountBase, needsReason ? reason.trim() : reason.trim() || null)}>
          {t("Apply")}
        </button>
      </div>
    </Modal>
  );
}

// ---------- Partial / Unpaid wizard (3 steps, real customer required) ----------
function PartialWizard({ total, tenderCurrency, onDone, onClose }: {
  total: number;
  tenderCurrency: string;
  onDone: (customerId: string, paidNowBase: number) => void;
  onClose: () => void;
}) {
  const { boot } = useApp();
  const { t } = useT();
  const settings = boot!.settings;
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [paidText, setPaidText] = useState("0");

  const customers = boot!.customers.filter((c) => !c.isSystem);
  const q = query.trim().toLowerCase();
  const list = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q))
    : customers;

  const parsed = parseFloat(paidText.replace(/,/g, "")) || 0;
  const paidBase = tenderCurrency === settings.baseCurrency
    ? roundBaseMoney(parsed)
    : fromSecondary(parsed, settings.exchangeRate);
  const clampedPaid = Math.min(Math.max(paidBase, 0), Math.max(total - 0.01, 0));
  const due = roundBaseMoney(total - clampedPaid);
  const newBalance = customer ? roundBaseMoney(customer.balance + due) : 0;
  const overLimit = customer && customer.creditLimit > 0 && newBalance > customer.creditLimit;

  return (
    <Modal onClose={onClose} labelledBy="wizard-title" wide>
      <h3 id="wizard-title" className="modal-title">
        {t("Partial / Unpaid")} — {t("Total")}: <span className="num">{formatBase(total)}</span>
      </h3>
      <div className="wizard-steps">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`wiz-step ${step === n ? "wiz-active" : step > n ? "wiz-done" : ""}`}>{n}</span>
        ))}
      </div>

      {step === 1 ? (
        <>
          <p className="field-label">{t("Pick a customer")}</p>
          <div className="search-box" style={{ marginBottom: 10 }}>
            <Search size={16} />
            <input value={query} autoFocus placeholder="Name or phone..."
                   onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="customer-pick-list">
            {list.map((c) => (
              <button key={c.id}
                      className={`customer-pick ${customer?.id === c.id ? "pick-active" : ""}`}
                      onClick={() => setCustomer(c)}>
                <span>
                  <strong>{c.name}</strong>
                  {c.phone ? <span className="muted"> · {c.phone}</span> : null}
                </span>
                <span className="num">{c.balance > 0 ? formatBase(c.balance) : ""}</span>
              </button>
            ))}
            {list.length === 0 ? (
              <p className="muted">No customers — create one in the Customers tab first.</p>
            ) : null}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>{t("Cancel")}</button>
            <button className="btn btn-primary" disabled={!customer}
                    onClick={() => setStep(2)}>{t("Next")}</button>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <p className="field-label">{t("Paid now")} ({tenderCurrency})</p>
          <div className="preset-row">
            {[0, 25, 50, 75].map((pct) => {
              const base = roundBaseMoney(total * pct / 100);
              const shown = tenderCurrency === settings.baseCurrency
                ? base : toSecondary(base, settings.exchangeRate);
              return (
                <button key={pct} className="chip"
                        onClick={() => setPaidText(String(shown))}>{pct}%</button>
              );
            })}
          </div>
          <input className="input num" value={paidText} inputMode="decimal" autoFocus
                 onChange={(event) => setPaidText(event.target.value)} />
          <p className="discount-preview num">
            {t("Remaining due")}: <strong>{formatBase(due)}</strong>
          </p>
          {overLimit ? (
            <p className="login-error">
              Over credit limit: {formatBase(newBalance)} / {formatBase(customer!.creditLimit)}
            </p>
          ) : null}
          <div className="modal-actions">
            <button className="btn" onClick={() => setStep(1)}>{t("Back")}</button>
            <button className="btn btn-primary" disabled={due <= 0}
                    onClick={() => setStep(3)}>{t("Next")}</button>
          </div>
        </>
      ) : null}

      {step === 3 && customer ? (
        <>
          <div className="confirm-grid num">
            <span>{t("Total")}</span><strong>{formatBase(total)}</strong>
            <span>{t("Paid now")}</span><strong>{formatBase(clampedPaid)}</strong>
            <span>{t("Remaining due")}</span><strong className="neg-text">{formatBase(due)}</strong>
            <span>{t("New balance")} — {customer.name}</span>
            <strong>{formatBase(newBalance)}</strong>
          </div>
          {overLimit ? (
            <p className="login-error">Over credit limit — confirm only if intended.</p>
          ) : null}
          <div className="modal-actions">
            <button className="btn" onClick={() => setStep(2)}>{t("Back")}</button>
            <button className="btn btn-cta" onClick={() => onDone(customer.id, clampedPaid)}>
              {t("Confirm")}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
