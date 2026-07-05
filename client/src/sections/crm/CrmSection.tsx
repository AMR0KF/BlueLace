// CRM: customer credit management — list w/ meters and filters, ledger modal,
// collect payment (Auto oldest-first w/ live allocation preview / Per-order),
// cancel collection. Ports CRM (App.tsx:10717) + PaymentCollectionModal (11612).
import { HandCoins, Pencil, Phone, Plus, Printer, Search, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Meter, StatusBadge, timeLabel } from "../../components/ui";
import { askConfirm, Modal } from "../../lib/modal";
import { PrintPortal } from "../../lib/print";
import { CustomerStatement } from "../../print-templates/CustomerStatement";
import {
  formatBase, formatSecondary, fromSecondary, roundBaseMoney, toSecondary, MONEY_EPSILON,
} from "../../lib/money";
import { groupPayments, type PaymentGroup } from "../../lib/payments";
import { useApp } from "../../state/AppState";
import type { Customer, Sale } from "../../types";

type Filter = "all" | "owes" | "over" | "clear";

export function CrmSection() {
  const { boot } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [ledgerFor, setLedgerFor] = useState<Customer | null>(null);
  const [collectFor, setCollectFor] = useState<Customer | null>(null);
  if (!boot) return null;

  const customers = boot.customers.filter((c) => !c.isSystem);
  const totalOwed = roundBaseMoney(customers.reduce((sum, c) => sum + c.balance, 0));
  const openOrders = boot.sales.filter(
    (s) => (s.status === "partial" || s.status === "unpaid") && s.customerId).length;
  const overLimit = customers.filter(
    (c) => c.creditLimit > 0 && c.balance > c.creditLimit).length;

  const q = query.trim().toLowerCase();
  let list = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q))
    : [...customers];
  if (filter === "owes") list = list.filter((c) => c.balance > MONEY_EPSILON);
  if (filter === "over") list = list.filter((c) => c.creditLimit > 0 && c.balance > c.creditLimit);
  if (filter === "clear") list = list.filter((c) => c.balance <= MONEY_EPSILON);
  list.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

  // Keep modals pointed at fresh customer objects after each bootstrap swap.
  const fresh = (c: Customer | null) =>
    c ? boot.customers.find((x) => x.id === c.id) ?? null : null;

  return (
    <div className="section-page">
      <header className="page-head">
        <h1>Customers</h1>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Plus size={17} /> New customer
        </button>
      </header>

      <div className="metric-row">
        <div className="metric-card">
          <div className="metric-label">Customers</div>
          <div className="metric-value num">{customers.length}</div>
        </div>
        <div className={`metric-card ${totalOwed > 0 ? "metric-warning" : ""}`}>
          <div className="metric-label">Total owed</div>
          <div className="metric-value num">{formatBase(totalOwed)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Open orders</div>
          <div className="metric-value num">{openOrders}</div>
        </div>
        <div className={`metric-card ${overLimit ? "metric-danger" : ""}`}>
          <div className="metric-label">Over limit</div>
          <div className="metric-value num">{overLimit}</div>
        </div>
      </div>

      <div className="crm-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input placeholder="Search name or phone..." value={query}
                 onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="preset-row" style={{ marginBottom: 0 }}>
          {(["all", "owes", "over", "clear"] as Filter[]).map((name) => (
            <button key={name} className={`chip ${filter === name ? "chip-active" : ""}`}
                    onClick={() => setFilter(name)}>
              <span className="cap">{name === "over" ? "Over limit" : name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="customer-grid">
        {list.map((customer) => {
          const over = customer.creditLimit > 0 && customer.balance > customer.creditLimit;
          return (
            <section key={customer.id} className="card customer-card">
              <div className="customer-head">
                <div className="customer-id">
                  <span className="customer-avatar"><UserRound size={18} /></span>
                  <div>
                    <strong>{customer.name}</strong>
                    {customer.phone ? (
                      <span className="muted customer-phone"><Phone size={11} /> {customer.phone}</span>
                    ) : null}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(customer)}>
                  <Pencil size={14} />
                </button>
              </div>
              <div className="customer-balance">
                <span className="metric-label">Owes</span>
                <strong className={`num ${customer.balance > 0 ? (over ? "neg-text" : "") : "pos-text"}`}>
                  {formatBase(customer.balance)}
                </strong>
                <small className="muted num">
                  {formatSecondary(toSecondary(customer.balance, boot.settings.exchangeRate),
                    boot.settings.secondaryCurrency, boot.settings.lbpDisplayRounding)}
                </small>
              </div>
              {customer.creditLimit > 0 ? (
                <>
                  <Meter value={customer.balance} max={customer.creditLimit} />
                  <small className="muted num">
                    limit {formatBase(customer.creditLimit)}{over ? " — over limit" : ""}
                  </small>
                </>
              ) : null}
              {customer.storeCredit > 0 ? (
                <Badge kind="info">Store credit {formatBase(customer.storeCredit)}</Badge>
              ) : null}
              <div className="customer-actions">
                <button className="btn btn-sm" onClick={() => setLedgerFor(customer)}>Ledger</button>
                <button className="btn btn-sm btn-primary"
                        disabled={customer.balance <= MONEY_EPSILON && customer.storeCredit <= 0}
                        onClick={() => setCollectFor(customer)}>
                  <HandCoins size={14} /> Collect
                </button>
              </div>
            </section>
          );
        })}
        {list.length === 0 ? <p className="muted">No customers match.</p> : null}
      </div>

      {editing ? (
        <CustomerModal customer={editing === "new" ? null : editing}
                       onClose={() => setEditing(null)} />
      ) : null}
      {ledgerFor && fresh(ledgerFor) ? (
        <LedgerModal customer={fresh(ledgerFor)!}
                     onCollect={() => { setCollectFor(fresh(ledgerFor)); setLedgerFor(null); }}
                     onClose={() => setLedgerFor(null)} />
      ) : null}
      {collectFor && fresh(collectFor) ? (
        <CollectModal customer={fresh(collectFor)!} onClose={() => setCollectFor(null)} />
      ) : null}
    </div>
  );
}

// ---------- Customer create/edit ----------
function CustomerModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { mutate, pushToast } = useApp();
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    note: customer?.note ?? "",
    creditLimit: customer?.creditLimit ?? 0,
  });
  return (
    <Modal onClose={onClose} labelledBy="customer-modal-title">
      <h3 id="customer-modal-title" className="modal-title">
        {customer ? `Edit ${customer.name}` : "New customer"}
      </h3>
      <div className="form-grid">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={form.name} autoFocus
                 onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></label>
        <label className="field"><span className="field-label">Phone</span>
          <input className="input" value={form.phone}
                 onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></label>
        <label className="field"><span className="field-label">Credit limit (USD, 0 = unlimited)</span>
          <input className="input num" inputMode="decimal" value={form.creditLimit || ""}
                 onChange={(e) => setForm((p) => ({ ...p, creditLimit: Number(e.target.value) || 0 }))} /></label>
        <label className="field"><span className="field-label">Note</span>
          <input className="input" value={form.note}
                 onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} /></label>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        Balance is controlled by orders and payments — it can't be edited directly.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!form.name.trim()}
                onClick={async () => {
                  const body = {
                    name: form.name.trim(), phone: form.phone.trim() || null,
                    note: form.note.trim() || null, creditLimit: form.creditLimit,
                  };
                  const ok = customer
                    ? await mutate("PATCH", `/api/customers/${customer.id}`, body)
                    : await mutate("POST", "/api/customers", body);
                  if (ok) { pushToast("success", "Customer saved."); onClose(); }
                }}>
          Save
        </button>
      </div>
    </Modal>
  );
}

// ---------- Ledger ----------
function LedgerModal({ customer, onCollect, onClose }: {
  customer: Customer; onCollect: () => void; onClose: () => void;
}) {
  const { boot, mutate, posUser } = useApp();
  const [printing, setPrinting] = useState(false);
  const sales = boot!.sales
    .filter((s) => s.customerId === customer.id && s.status !== "voided")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = sales.filter((s) => s.dueAmount > MONEY_EPSILON);
  const groups = groupPayments(boot!.payments.filter((p) => p.customerId === customer.id));
  const invoiced = roundBaseMoney(sales.reduce((sum, s) => sum + s.total - s.returnedAmount, 0));
  const received = roundBaseMoney(
    sales.reduce((sum, s) => sum + s.paidAmount, 0));
  const canCancel = posUser?.role === "admin" || posUser?.role === "manager";

  return (
    <Modal onClose={onClose} wide labelledBy="ledger-title">
      <h3 id="ledger-title" className="modal-title">{customer.name} — ledger</h3>
      <div className="metric-row">
        <div className={`metric-card ${customer.balance > 0 ? "metric-warning" : ""}`}>
          <div className="metric-label">Balance due</div>
          <div className="metric-value num">{formatBase(customer.balance)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Paid in</div>
          <div className="metric-value num">{formatBase(received)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total invoiced</div>
          <div className="metric-value num">{formatBase(invoiced)}</div>
        </div>
      </div>

      {open.length > 0 ? (
        <>
          <h4 className="subhead">Open orders</h4>
          <table className="table">
            <thead><tr><th>Order</th><th>When</th><th className="num">Total</th>
              <th className="num">Paid</th><th className="num">Due</th></tr></thead>
            <tbody>
              {open.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.orderRef} <StatusBadge status={sale.status} /></td>
                  <td className="muted">{timeLabel(sale.createdAt)}</td>
                  <td className="num">{formatBase(sale.total)}</td>
                  <td className="num">{formatBase(sale.paidAmount)}</td>
                  <td className="num neg-text">{formatBase(sale.dueAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h4 className="subhead">Payments received</h4>
      {groups.length === 0 ? <p className="muted">No collections yet.</p> : (
        <table className="table">
          <thead><tr><th>When</th><th className="num">Amount</th><th>Split</th>
            <th>Orders</th><th className="th-actions" /></tr></thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.groupId}>
                <td className="muted">{timeLabel(group.createdAt)}</td>
                <td className="num">{formatBase(roundBaseMoney(group.total))}</td>
                <td>
                  {group.cashTotal > 0 ? <Badge kind="success">cash {formatBase(roundBaseMoney(group.cashTotal))}</Badge> : null}
                  {group.creditTotal > 0 ? <Badge kind="info">credit {formatBase(roundBaseMoney(group.creditTotal))}</Badge> : null}
                </td>
                <td className="muted num">{group.rows.length}</td>
                <td className="td-actions">
                  {canCancel ? (
                    <button className="btn btn-sm btn-danger-soft"
                            onClick={async () => {
                              const { ok } = await askConfirm({
                                title: "Cancel this collection?",
                                message: "The amount goes back to what's owed.",
                                danger: true, confirmLabel: "Cancel collection",
                              });
                              if (ok) await mutate("POST", `/api/payments/${group.groupId}/cancel`, {});
                            }}>
                      Cancel
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="subhead">All orders</h4>
      <table className="table">
        <thead><tr><th>Order</th><th>When</th><th className="num">Total</th>
          <th className="num">Due</th></tr></thead>
        <tbody>
          {sales.slice(0, 30).map((sale) => (
            <tr key={sale.id}>
              <td>{sale.orderRef} <StatusBadge status={sale.status} />
                {sale.returnStatus ? <Badge kind="info">returned</Badge> : null}</td>
              <td className="muted">{timeLabel(sale.createdAt)}</td>
              <td className="num">{formatBase(sale.total)}</td>
              <td className="num">{sale.dueAmount > 0 ? formatBase(sale.dueAmount) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => setPrinting(true)}>
          <Printer size={15} /> Print statement
        </button>
        <button className="btn btn-cta" disabled={customer.balance <= MONEY_EPSILON}
                onClick={onCollect}>
          <HandCoins size={16} /> Collect payment
        </button>
      </div>
      {printing ? (
        <PrintPortal onDone={() => setPrinting(false)}>
          <CustomerStatement
            customer={customer}
            sales={boot!.sales.filter((s) => s.customerId === customer.id)}
            payments={boot!.payments.filter((p) => p.customerId === customer.id)}
            settings={boot!.settings}
          />
        </PrintPortal>
      ) : null}
    </Modal>
  );
}

// ---------- Collect payment (Auto / Per-order) ----------
function CollectModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { boot, mutate, pushToast } = useApp();
  const settings = boot!.settings;
  const [mode, setMode] = useState<"auto" | "per_order">("auto");
  const [tender, setTender] = useState<"base" | "secondary">("base");
  const [amountText, setAmountText] = useState("");
  const [useCredit, setUseCredit] = useState(customer.storeCredit > 0);
  const [perOrder, setPerOrder] = useState<Map<string, string>>(new Map());

  const openSales = useMemo(
    () => boot!.sales
      .filter((s) => s.customerId === customer.id
        && (s.status === "partial" || s.status === "unpaid")
        && s.dueAmount > MONEY_EPSILON)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [boot, customer.id]);
  const totalOpen = roundBaseMoney(openSales.reduce((sum, s) => sum + s.dueAmount, 0));

  const tenderCurrency = tender === "base" ? settings.baseCurrency : settings.secondaryCurrency;
  const parsed = parseFloat(amountText.replace(/,/g, "")) || 0;
  const cashBase = tender === "base"
    ? roundBaseMoney(parsed) : fromSecondary(parsed, settings.exchangeRate);
  const creditApplied = useCredit
    ? roundBaseMoney(Math.min(customer.storeCredit, totalOpen)) : 0;
  const maxCash = roundBaseMoney(Math.max(totalOpen - creditApplied, 0));

  // Live allocation preview mirroring the server's oldest-first spread.
  const preview = useMemo(() => {
    let credit = creditApplied;
    let cash = Math.min(cashBase, maxCash);
    return openSales.map((sale) => {
      let pay = 0;
      const fromCredit = Math.min(credit, sale.dueAmount);
      credit = roundBaseMoney(credit - fromCredit);
      pay += fromCredit;
      const fromCash = Math.min(cash, roundBaseMoney(sale.dueAmount - fromCredit));
      cash = roundBaseMoney(cash - fromCash);
      pay += fromCash;
      return { sale, pay: roundBaseMoney(pay) };
    });
  }, [openSales, creditApplied, cashBase, maxCash]);

  const perOrderTotal = roundBaseMoney(
    openSales.reduce((sum, sale) => {
      const raw = parseFloat((perOrder.get(sale.id) ?? "").replace(/,/g, "")) || 0;
      const base = tender === "base" ? raw : (raw ? fromSecondary(raw, settings.exchangeRate) : 0);
      return sum + Math.min(base, sale.dueAmount);
    }, 0));

  const submit = async () => {
    let body: Record<string, unknown>;
    if (mode === "auto") {
      if (cashBase + creditApplied <= MONEY_EPSILON) return;
      body = {
        customerId: customer.id, amount: Math.min(cashBase, maxCash),
        tenderCurrency, tenderRate: settings.exchangeRate,
        mode: "auto", useStoreCredit: useCredit,
      };
    } else {
      const allocations = openSales
        .map((sale) => {
          const raw = parseFloat((perOrder.get(sale.id) ?? "").replace(/,/g, "")) || 0;
          const base = tender === "base" ? roundBaseMoney(raw)
            : (raw ? fromSecondary(raw, settings.exchangeRate) : 0);
          return { saleId: sale.id, amount: Math.min(base, sale.dueAmount) };
        })
        .filter((a) => a.amount > MONEY_EPSILON);
      if (allocations.length === 0) return;
      body = {
        customerId: customer.id,
        amount: roundBaseMoney(allocations.reduce((s, a) => s + a.amount, 0)),
        tenderCurrency, tenderRate: settings.exchangeRate,
        mode: "per_order", allocations,
      };
    }
    if (await mutate("POST", "/api/payments/collect", body)) {
      pushToast("success", "Payment collected.");
      onClose();
    }
  };

  return (
    <Modal onClose={onClose} wide labelledBy="collect-title">
      <h3 id="collect-title" className="modal-title">
        Collect from {customer.name} — owes <span className="num">{formatBase(totalOpen)}</span>
      </h3>

      <div className="collect-controls">
        <div className="segmented">
          <button className={mode === "auto" ? "seg-active" : ""}
                  onClick={() => setMode("auto")}>Auto</button>
          <button className={mode === "per_order" ? "seg-active" : ""}
                  onClick={() => setMode("per_order")}>Per order</button>
        </div>
        <div className="segmented">
          <button className={tender === "base" ? "seg-active" : ""}
                  onClick={() => setTender("base")}>{settings.baseCurrency}</button>
          <button className={tender === "secondary" ? "seg-active" : ""}
                  onClick={() => setTender("secondary")}>{settings.secondaryCurrency}</button>
        </div>
      </div>

      {customer.storeCredit > 0 && mode === "auto" ? (
        <label className="check-row">
          <input type="checkbox" checked={useCredit}
                 onChange={(event) => setUseCredit(event.target.checked)} />
          <span>Apply store credit first ({formatBase(customer.storeCredit)})</span>
        </label>
      ) : null}

      {mode === "auto" ? (
        <>
          <label className="field" style={{ marginTop: 8 }}>
            <span className="field-label">Cash received ({tenderCurrency})</span>
            <input className="input num" value={amountText} inputMode="decimal" autoFocus
                   placeholder={tender === "base"
                     ? String(maxCash)
                     : String(toSecondary(maxCash, settings.exchangeRate))}
                   onChange={(event) => setAmountText(event.target.value)} />
          </label>
          <h4 className="subhead">Allocation preview (oldest first)</h4>
          <table className="table">
            <thead><tr><th>Order</th><th className="num">Due</th>
              <th className="num">Will receive</th><th className="num">After</th></tr></thead>
            <tbody>
              {preview.map(({ sale, pay }) => (
                <tr key={sale.id} className={pay > 0 ? "row-active" : ""}>
                  <td>{sale.orderRef} <span className="muted">{timeLabel(sale.createdAt)}</span></td>
                  <td className="num">{formatBase(sale.dueAmount)}</td>
                  <td className="num pos-text">{pay > 0 ? formatBase(pay) : "—"}</td>
                  <td className="num">{formatBase(roundBaseMoney(sale.dueAmount - pay))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <h4 className="subhead">Amount per order ({tenderCurrency})</h4>
          <table className="table">
            <thead><tr><th>Order</th><th className="num">Due</th><th className="num">Collect</th></tr></thead>
            <tbody>
              {openSales.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.orderRef} <span className="muted">{timeLabel(sale.createdAt)}</span></td>
                  <td className="num">{formatBase(sale.dueAmount)}</td>
                  <td className="num" style={{ width: 140 }}>
                    <input className="input num" style={{ minHeight: 38 }}
                           inputMode="decimal"
                           value={perOrder.get(sale.id) ?? ""}
                           placeholder={tender === "base"
                             ? String(sale.dueAmount)
                             : String(toSecondary(sale.dueAmount, settings.exchangeRate))}
                           onChange={(event) => {
                             setPerOrder((prev) => {
                               const next = new Map(prev);
                               next.set(sale.id, event.target.value);
                               return next;
                             });
                           }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="discount-preview num">
            Collecting: <strong>{formatBase(perOrderTotal)}</strong>
          </p>
        </>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-cta"
                disabled={mode === "auto"
                  ? cashBase + creditApplied <= MONEY_EPSILON
                  : perOrderTotal <= MONEY_EPSILON}
                onClick={() => void submit()}>
          Collect
        </button>
      </div>
    </Modal>
  );
}
