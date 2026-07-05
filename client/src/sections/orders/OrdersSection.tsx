// Orders: chronological feed interleaving sales and returns, SaleDetailModal
// (edit lines/customer/discount, reset upfront, void, delete voided, return),
// cancel return. Ports Orders/SaleList/SaleDetailModal (App.tsx:11929/14902/15200).
import { Copy, Eye, Printer, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, StatusBadge, timeLabel } from "../../components/ui";
import { askConfirm, Modal } from "../../lib/modal";
import { formatBase, MONEY_EPSILON, roundBaseMoney } from "../../lib/money";
import { PrintPortal } from "../../lib/print";
import { Receipt } from "../../print-templates/Receipt";
import { useApp } from "../../state/AppState";
import type { Sale, SaleReturn } from "../../types";

type FeedRow =
  | { kind: "sale"; at: string; sale: Sale }
  | { kind: "return"; at: string; ret: SaleReturn; sale: Sale | undefined };

type Filter = "all" | "open" | "paid" | "voided" | "returns";

export function OrdersSection() {
  const { boot, setSection, setCart, pushToast, posUser } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  if (!boot) return null;
  const isManager = posUser?.role !== "cashier";

  const byId = new Map(boot.sales.map((s) => [s.id, s]));
  const customerName = (id: string | null) =>
    id ? boot.customers.find((c) => c.id === id)?.name ?? "?" : "Walk-in";

  let rows: FeedRow[] = [
    ...boot.sales.map((sale): FeedRow => ({ kind: "sale", at: sale.createdAt, sale })),
    ...boot.saleReturns.map((ret): FeedRow => ({
      kind: "return", at: ret.createdAt, ret, sale: byId.get(ret.saleId),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (filter === "open") rows = rows.filter((r) => r.kind === "sale"
    && (r.sale.status === "partial" || r.sale.status === "unpaid"));
  if (filter === "paid") rows = rows.filter((r) => r.kind === "sale" && r.sale.status === "completed");
  if (filter === "voided") rows = rows.filter((r) => r.kind === "sale" && r.sale.status === "voided");
  if (filter === "returns") rows = rows.filter((r) => r.kind === "return");
  const q = query.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      const sale = r.kind === "sale" ? r.sale : r.sale;
      return (sale?.orderRef ?? "").toLowerCase().includes(q)
        || customerName(sale?.customerId ?? null).toLowerCase().includes(q);
    });
  }

  const copyToCart = (sale: Sale) => {
    const lines = sale.lines.map((line) => ({
      key: line.variantId ?? `custom-${line.id}`,
      variantId: line.variantId,
      modelName: line.modelName,
      color: line.color, size: line.size,
      qty: line.qty, unitPrice: line.unitPrice, defaultPrice: line.unitPrice,
      stockQty: line.variantId
        ? boot.variants.find((v) => v.id === line.variantId)?.stockQty
        : undefined,
    }));
    setCart(() => lines);
    setSection("pos");
    pushToast("info", `Copied ${sale.orderRef} to the cart.`);
  };

  const detail = detailId ? byId.get(detailId) : null;

  return (
    <div className="section-page">
      <header className="page-head"><h1>Orders</h1></header>
      <div className="crm-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input placeholder="Search order or customer..." value={query}
                 onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="preset-row" style={{ marginBottom: 0 }}>
          {(["all", "open", "paid", "voided", "returns"] as Filter[]).map((name) => (
            <button key={name} className={`chip ${filter === name ? "chip-active" : ""}`}
                    onClick={() => setFilter(name)}>
              <span className="cap">{name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <table className="table orders-table">
          <thead>
            <tr><th>Order</th><th>Customer</th><th>When</th>
              <th className="num">Total</th><th className="num">Paid</th>
              <th className="num">Due</th><th className="th-actions" /></tr>
          </thead>
          <tbody>
            {rows.slice(0, 120).map((row) => row.kind === "sale" ? (
              <tr key={`s-${row.sale.id}`}
                  className={row.sale.status === "voided" ? "row-voided" : ""}>
                <td>
                  <strong>{row.sale.orderRef}</strong>
                  <StatusBadge status={row.sale.status} />
                  {row.sale.queued ? <Badge kind="warning">queued</Badge> : null}
                  {row.sale.returnStatus ? <Badge kind="info">
                    {row.sale.returnStatus === "full" ? "fully returned" : "part returned"}
                  </Badge> : null}
                  <Badge kind="neutral">{row.sale.tenderCurrency}</Badge>
                </td>
                <td>{customerName(row.sale.customerId)}</td>
                <td className="muted">{timeLabel(row.sale.createdAt)}</td>
                <td className="num">{formatBase(row.sale.total)}</td>
                <td className="num">{formatBase(row.sale.paidAmount)}</td>
                <td className={`num ${row.sale.dueAmount > 0 ? "neg-text" : ""}`}>
                  {row.sale.dueAmount > 0 ? formatBase(row.sale.dueAmount) : "—"}
                </td>
                <td className="td-actions">
                  <button className="btn btn-sm" onClick={() => setDetailId(row.sale.id)}>
                    <Eye size={14} /> View
                  </button>
                  <button className="btn btn-sm" title="Copy to cart"
                          onClick={() => copyToCart(row.sale)}>
                    <Copy size={14} />
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={`r-${row.ret.id}`} className="row-return">
                <td>
                  <strong>↩ {row.sale?.orderRef ?? row.ret.saleId.slice(0, 10)}</strong>
                  <Badge kind="info">return</Badge>
                  <Badge kind="neutral">
                    {row.ret.refundMethod === "cash" ? "cash refund" : "store credit"}
                  </Badge>
                </td>
                <td>{customerName(row.ret.customerId)}</td>
                <td className="muted">{timeLabel(row.ret.createdAt)}</td>
                <td className="num neg-text">−{formatBase(row.ret.totalValue)}</td>
                <td className="num muted">
                  {row.ret.refundCash > 0 ? `cash ${formatBase(row.ret.refundCash)}` : ""}
                  {row.ret.refundCredit > 0 ? `credit ${formatBase(row.ret.refundCredit)}` : ""}
                  {row.ret.appliedToDue > 0 ? ` due −${formatBase(row.ret.appliedToDue)}` : ""}
                </td>
                <td />
                <td className="td-actions">
                  {posUser?.role === "admin" ? (
                    <CancelReturnButton returnId={row.ret.id} />
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="muted">No orders match.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {detail ? (
        <SaleDetailModal sale={detail} isManager={isManager}
                         onClose={() => setDetailId(null)} />
      ) : null}
    </div>
  );
}

function CancelReturnButton({ returnId }: { returnId: string }) {
  const { mutate } = useApp();
  return (
    <button className="btn btn-sm btn-danger-soft"
            onClick={async () => {
              const { ok } = await askConfirm({
                title: "Cancel this return?",
                message: "Stock goes back out and the refund is reversed.",
                danger: true, confirmLabel: "Cancel return",
              });
              if (ok) await mutate("POST", `/api/returns/${returnId}/cancel`, {});
            }}>
      Cancel
    </button>
  );
}

// ---------- Sale detail: the editing hub ----------
function SaleDetailModal({ sale, isManager, onClose }: {
  sale: Sale; isManager: boolean; onClose: () => void;
}) {
  const { boot, mutate, pushToast, posUser } = useApp();
  const [editingPrices, setEditingPrices] = useState(false);
  const [prices, setPrices] = useState<Map<string, string>>(new Map());
  const [returning, setReturning] = useState(false);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [printing, setPrinting] = useState(false);
  const settings = boot!.settings;
  const customer = sale.customerId
    ? boot!.customers.find((c) => c.id === sale.customerId) : null;
  const voided = sale.status === "voided";
  const hasPayments = boot!.payments.some((p) => p.saleId === sale.id);
  const hasReturns = boot!.saleReturns.some((r) => r.saleId === sale.id);

  const newTotal = useMemo(() => {
    if (!editingPrices) return sale.total;
    const subtotal = roundBaseMoney(sale.lines.reduce((sum, line) => {
      const raw = prices.get(line.id);
      const price = raw !== undefined && raw !== "" ? parseFloat(raw) : line.unitPrice;
      return sum + roundBaseMoney(line.qty * (Number.isFinite(price) ? price : line.unitPrice));
    }, 0));
    const discount = sale.subtotal > 0 && sale.discountAmount > 0
      ? roundBaseMoney(sale.discountAmount * subtotal / sale.subtotal) : 0;
    const taxable = roundBaseMoney(subtotal - Math.min(discount, subtotal));
    const taxRate = sale.subtotal - sale.discountAmount > 0 && sale.taxAmount > 0
      ? sale.taxAmount / (sale.subtotal - sale.discountAmount) * 100 : 0;
    return roundBaseMoney(taxable + (taxRate > 0 ? roundBaseMoney(taxable * taxRate / 100) : 0));
  }, [editingPrices, prices, sale]);

  const savePrices = async () => {
    const lines = sale.lines
      .map((line) => {
        const raw = prices.get(line.id);
        if (raw === undefined || raw === "") return null;
        const price = parseFloat(raw);
        if (!Number.isFinite(price) || price < 0 || Math.abs(price - line.unitPrice) < 0.004) return null;
        return { saleItemId: line.id, unitPrice: roundBaseMoney(price) };
      })
      .filter((x): x is { saleItemId: string; unitPrice: number } => x !== null);
    if (lines.length === 0) { setEditingPrices(false); return; }
    if (await mutate("PATCH", `/api/sales/${sale.id}/lines`, { lines })) {
      pushToast("success", "Prices updated.");
      setEditingPrices(false);
      setPrices(new Map());
    }
  };

  const editDiscount = async () => {
    const { ok, reason } = await askConfirm({
      title: "Set discount (USD amount)",
      message: `Current: ${formatBase(sale.discountAmount)} on subtotal ${formatBase(sale.subtotal)}. Enter the new discount amount; add "|" then a reason for 50%+.`,
      requireReason: true,
      reasonPlaceholder: "e.g. 10  or  25|old stock",
      confirmLabel: "Apply",
    });
    if (!ok || !reason) return;
    const [amountPart, ...reasonParts] = reason.split("|");
    const amount = parseFloat(amountPart.trim());
    if (!Number.isFinite(amount) || amount < 0) {
      pushToast("error", "Enter a valid amount.");
      return;
    }
    await mutate("PATCH", `/api/sales/${sale.id}/discount`, {
      discountAmount: roundBaseMoney(amount),
      discountReason: reasonParts.join("|").trim() || null,
    });
  };

  return (
    <Modal onClose={onClose} wide labelledBy="sale-detail-title">
      <h3 id="sale-detail-title" className="modal-title">
        {sale.orderRef} <StatusBadge status={sale.status} />
        {sale.returnStatus ? <Badge kind="info">
          {sale.returnStatus === "full" ? "fully returned" : "part returned"}</Badge> : null}
      </h3>
      <p className="muted" style={{ marginTop: -6 }}>
        {timeLabel(sale.createdAt)} · {sale.tenderCurrency}
        {sale.tenderRate && sale.tenderCurrency !== settings.baseCurrency
          ? ` @ ${sale.tenderRate.toLocaleString()}` : ""}
        {" · "}
        {customer ? customer.name : "Walk-in"}
        {isManager && !voided ? (
          <button className="btn btn-sm btn-ghost" onClick={() => setPickingCustomer(true)}>
            change
          </button>
        ) : null}
      </p>
      {voided ? (
        <p className="login-error">Voided{sale.voidReason ? ` — ${sale.voidReason}` : ""}</p>
      ) : null}

      <table className="table">
        <thead><tr><th>Item</th><th className="num">Qty</th>
          <th className="num">Price</th><th className="num">Total</th></tr></thead>
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.modelName}
                {line.color ? <span className="muted"> {line.color}/{line.size}</span> : null}
                {line.returnedQty > 0 ? (
                  <Badge kind="info">{line.returnedQty} returned</Badge>
                ) : null}
              </td>
              <td className="num">{line.qty}</td>
              <td className="num">
                {editingPrices ? (
                  <input className="input num" style={{ minHeight: 34, width: 100 }}
                         inputMode="decimal"
                         defaultValue={line.unitPrice}
                         onChange={(event) => {
                           setPrices((prev) => {
                             const next = new Map(prev);
                             next.set(line.id, event.target.value);
                             return next;
                           });
                         }} />
                ) : formatBase(line.unitPrice)}
              </td>
              <td className="num">{formatBase(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="confirm-grid num" style={{ marginTop: 12 }}>
        <span>Subtotal</span><strong>{formatBase(sale.subtotal)}</strong>
        {sale.discountAmount > 0 ? (<>
          <span>Discount{sale.discountReason ? ` · ${sale.discountReason}` : ""}</span>
          <strong>−{formatBase(sale.discountAmount)}</strong>
        </>) : null}
        {sale.taxAmount > 0 ? (<>
          <span>Tax</span><strong>{formatBase(sale.taxAmount)}</strong>
        </>) : null}
        <span>Total</span><strong>{formatBase(sale.total)}</strong>
        {sale.returnedAmount > 0 ? (<>
          <span>Returned</span><strong>−{formatBase(sale.returnedAmount)}</strong>
        </>) : null}
        <span>Paid</span><strong>{formatBase(sale.paidAmount)}</strong>
        <span>Due</span>
        <strong className={sale.dueAmount > 0 ? "neg-text" : ""}>{formatBase(sale.dueAmount)}</strong>
        {editingPrices && Math.abs(newTotal - sale.total) > MONEY_EPSILON ? (<>
          <span>New total (preview)</span><strong>{formatBase(newTotal)}</strong>
        </>) : null}
      </div>
      {editingPrices && newTotal < sale.paidAmount - MONEY_EPSILON ? (
        <p className="login-error">New total is below what's paid — reset the payment first.</p>
      ) : null}

      <div className="modal-actions" style={{ flexWrap: "wrap" }}>
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => setPrinting(true)}>
          <Printer size={15} /> Print
        </button>
        {isManager && !voided ? (
          <>
            {editingPrices ? (
              <>
                <button className="btn" onClick={() => { setEditingPrices(false); setPrices(new Map()); }}>
                  Cancel edit
                </button>
                <button className="btn btn-primary" onClick={() => void savePrices()}>
                  Save prices
                </button>
              </>
            ) : (
              <button className="btn" disabled={hasReturns}
                      title={hasReturns ? "Cancel returns first" : ""}
                      onClick={() => setEditingPrices(true)}>
                Edit prices
              </button>
            )}
            <button className="btn" disabled={hasReturns} onClick={() => void editDiscount()}>
              Discount
            </button>
            {sale.upfrontPaid > MONEY_EPSILON && customer ? (
              <button className="btn"
                      onClick={async () => {
                        const { ok } = await askConfirm({
                          title: "Reset register payment?",
                          message: `${formatBase(sale.upfrontPaid)} moves back onto ${customer.name}'s balance.`,
                          confirmLabel: "Reset payment",
                        });
                        if (ok) await mutate("POST", `/api/sales/${sale.id}/reset-upfront`, {});
                      }}>
                Reset payment
              </button>
            ) : null}
            <button className="btn"
                    disabled={sale.lines.every((l) => l.qty - l.returnedQty <= 0)}
                    onClick={() => setReturning(true)}>
              <RotateCcw size={15} /> Return items
            </button>
            <button className="btn btn-danger-soft"
                    disabled={hasPayments || hasReturns}
                    title={hasPayments ? "Cancel collections first"
                      : hasReturns ? "Cancel returns first" : ""}
                    onClick={async () => {
                      const { ok, reason } = await askConfirm({
                        title: `Void ${sale.orderRef}?`,
                        message: "Stock is restored. A reason is required.",
                        danger: true, requireReason: true,
                        reasonPlaceholder: "Why is this order voided?",
                        confirmLabel: "Void order",
                      });
                      if (ok && reason) {
                        if (await mutate("POST", `/api/sales/${sale.id}/void`, { reason })) onClose();
                      }
                    }}>
              Void
            </button>
          </>
        ) : null}
        {posUser?.role === "admin" && voided ? (
          <button className="btn btn-danger"
                  onClick={async () => {
                    const { ok } = await askConfirm({
                      title: "Delete this voided order permanently?",
                      danger: true, confirmLabel: "Delete",
                    });
                    if (ok) {
                      if (await mutate("DELETE", `/api/sales/${sale.id}`)) onClose();
                    }
                  }}>
            Delete
          </button>
        ) : null}
      </div>

      {returning ? (
        <ReturnModal sale={sale} hasCustomer={Boolean(customer && !customer.isSystem)}
                     onClose={() => setReturning(false)}
                     onDone={() => { setReturning(false); onClose(); }} />
      ) : null}
      {printing ? (
        <PrintPortal onDone={() => setPrinting(false)}>
          <Receipt sale={sale} settings={settings} customer={customer ?? null} />
        </PrintPortal>
      ) : null}
      {pickingCustomer ? (
        <CustomerPickModal
          currentId={sale.customerId}
          disallowWalkIn={sale.dueAmount > MONEY_EPSILON}
          onPick={async (customerId) => {
            if (await mutate("PATCH", `/api/sales/${sale.id}/customer`, { customerId })) {
              setPickingCustomer(false);
            }
          }}
          onClose={() => setPickingCustomer(false)}
        />
      ) : null}
    </Modal>
  );
}

// ---------- Return items ----------
function ReturnModal({ sale, hasCustomer, onClose, onDone }: {
  sale: Sale; hasCustomer: boolean; onClose: () => void; onDone: () => void;
}) {
  const { mutate, pushToast } = useApp();
  const [qtys, setQtys] = useState<Map<string, number>>(new Map());
  const [method, setMethod] = useState<"cash" | "store_credit">(
    hasCustomer ? "store_credit" : "cash");

  // Mirror the server's per-line value math (discount + tax share).
  const taxRate = sale.subtotal - sale.discountAmount > 0 && sale.taxAmount > 0
    ? sale.taxAmount / (sale.subtotal - sale.discountAmount) * 100 : 0;
  let totalValue = 0;
  for (const line of sale.lines) {
    const qty = qtys.get(line.id) ?? 0;
    if (qty <= 0) continue;
    const gross = roundBaseMoney(line.unitPrice * qty);
    const discShare = sale.subtotal > 0 && sale.discountAmount > 0
      ? roundBaseMoney(gross / sale.subtotal * sale.discountAmount) : 0;
    const taxable = roundBaseMoney(gross - discShare);
    const taxShare = taxRate > 0 ? roundBaseMoney(taxable * taxRate / 100) : 0;
    totalValue = roundBaseMoney(totalValue + taxable + taxShare);
  }
  const appliedToDue = roundBaseMoney(Math.min(sale.dueAmount, totalValue));
  const excess = roundBaseMoney(totalValue - appliedToDue);

  return (
    <Modal onClose={onClose} labelledBy="return-title">
      <h3 id="return-title" className="modal-title">Return items — {sale.orderRef}</h3>
      {sale.lines.map((line) => {
        const returnable = line.qty - line.returnedQty;
        if (returnable <= 0) return null;
        const qty = qtys.get(line.id) ?? 0;
        return (
          <div key={line.id} className="return-line">
            <span>
              {line.modelName}
              {line.color ? <span className="muted"> {line.color}/{line.size}</span> : null}
              <span className="muted num"> · {formatBase(line.unitPrice)} × {returnable} returnable</span>
            </span>
            <div className="cart-line-qty">
              <button className="qty-btn" onClick={() =>
                setQtys((p) => new Map(p).set(line.id, Math.max(qty - 1, 0)))}>−</button>
              <span className="qty-input num">{qty}</span>
              <button className="qty-btn" onClick={() =>
                setQtys((p) => new Map(p).set(line.id, Math.min(qty + 1, returnable)))}>+</button>
            </div>
          </div>
        );
      })}
      <div className="segmented" style={{ margin: "12px 0" }}>
        <button className={method === "cash" ? "seg-active" : ""}
                onClick={() => setMethod("cash")}>Cash refund</button>
        <button className={method === "store_credit" ? "seg-active" : ""}
                disabled={!hasCustomer}
                title={hasCustomer ? "" : "Walk-ins get cash"}
                onClick={() => setMethod("store_credit")}>Store credit</button>
      </div>
      <div className="confirm-grid num">
        <span>Return value</span><strong>{formatBase(totalValue)}</strong>
        {appliedToDue > 0 ? (<>
          <span>Clears open due</span><strong>−{formatBase(appliedToDue)}</strong>
        </>) : null}
        <span>{method === "cash" ? "Cash back" : "Store credit"}</span>
        <strong>{formatBase(excess)}</strong>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={totalValue <= MONEY_EPSILON}
                onClick={async () => {
                  const lines = [...qtys.entries()]
                    .filter(([, qty]) => qty > 0)
                    .map(([saleItemId, qty]) => ({ saleItemId, qty }));
                  if (await mutate("POST", `/api/sales/${sale.id}/returns`,
                                   { lines, refundMethod: method })) {
                    pushToast("success", "Return recorded.");
                    onDone();
                  }
                }}>
          Confirm return
        </button>
      </div>
    </Modal>
  );
}

// ---------- Customer re-pick ----------
function CustomerPickModal({ currentId, disallowWalkIn, onPick, onClose }: {
  currentId: string | null;
  disallowWalkIn: boolean;
  onPick: (customerId: string | null) => void;
  onClose: () => void;
}) {
  const { boot } = useApp();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const customers = boot!.customers.filter((c) =>
    (!q || c.name.toLowerCase().includes(q)) && (!disallowWalkIn || !c.isSystem));
  return (
    <Modal onClose={onClose} labelledBy="pick-customer-title">
      <h3 id="pick-customer-title" className="modal-title">Assign customer</h3>
      <div className="search-box" style={{ marginBottom: 10 }}>
        <Search size={16} />
        <input value={query} autoFocus onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="customer-pick-list">
        {customers.map((c) => (
          <button key={c.id}
                  className={`customer-pick ${currentId === c.id ? "pick-active" : ""}`}
                  onClick={() => onPick(c.id)}>
            <span><strong>{c.name}</strong>{c.isSystem ? " (walk-in)" : ""}</span>
            <span className="num">{c.balance > 0 ? formatBase(c.balance) : ""}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
