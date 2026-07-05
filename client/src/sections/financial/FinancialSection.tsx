// Financial: Cash drawer (cash-in-box hero, per-currency note split, running
// ledger derived from sales/payments/returns + manual movements), payments
// ledger, audit checks + activity log. Ports CashDrawerPanel (App.tsx:12386)
// and the Audit tab. The cash ledger is DERIVED client-side, exactly like the
// original (App.tsx:13283) — cash_drawer_movements holds only manual entries.
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, timeLabel } from "../../components/ui";
import { buildCashEvents, type CashEvent } from "../../lib/cash";
import { askConfirm, Modal } from "../../lib/modal";
import {
  formatBase, formatSecondary, fromSecondary, roundBaseMoney, roundSecondaryMoney,
  toSecondary,
} from "../../lib/money";
import { groupPayments } from "../../lib/payments";
import { useApp } from "../../state/AppState";
import type { Section } from "../../types";

type Tab = "cash" | "ledgers" | "audit";

const PAIDOUT_CATEGORIES = [
  { id: "owner_draw", label: "Owner draw" },
  { id: "cash_drop", label: "Cash drop / bank" },
  { id: "supplier", label: "Supplier" },
  { id: "petty_cash", label: "Petty cash" },
  { id: "refund", label: "Refund" },
  { id: "other", label: "Other" },
] as const;

export function FinancialSection() {
  const { boot } = useApp();
  const [tab, setTab] = useState<Tab>("cash");
  if (!boot) return null;
  const auditCount = boot.auditChecks.length;
  return (
    <div className="section-page">
      <header className="page-head"><h1>Financial</h1></header>
      <div className="preset-row">
        {(["cash", "ledgers", "audit"] as Tab[]).map((name) => (
          <button key={name} className={`chip ${tab === name ? "chip-active" : ""}`}
                  onClick={() => setTab(name)}>
            <span className="cap">{name}</span>
            {name === "audit" && auditCount ? <em>{auditCount}</em> : null}
          </button>
        ))}
      </div>
      {tab === "cash" ? <CashTab /> : null}
      {tab === "ledgers" ? <LedgersTab /> : null}
      {tab === "audit" ? <AuditTab /> : null}
    </div>
  );
}

// ---------- Cash drawer ----------
function useCashEvents(): CashEvent[] {
  const { boot } = useApp();
  return useMemo(() => {
    if (!boot) return [];
    const customerName = (id: string | null) =>
      id ? boot.customers.find((c) => c.id === id)?.name ?? "?" : "Walk-in";
    const events: CashEvent[] = [];
    for (const sale of boot.sales) {
      if (sale.status === "voided" || sale.queued) continue;
      if (sale.upfrontPaid > 0.004) {
        events.push({
          id: `sale-${sale.id}`, at: sale.createdAt,
          label: `Sale ${sale.orderRef} — ${customerName(sale.customerId)}`,
          category: "sale", amount: sale.upfrontPaid,
          tenderCurrency: sale.tenderCurrency, tenderRate: sale.tenderRate,
        });
      }
    }
    for (const group of groupPayments(boot.payments)) {
      if (group.cashTotal <= 0.004) continue;
      events.push({
        id: `pay-${group.groupId}`, at: group.createdAt,
        label: `Collection — ${customerName(group.customerId)}`,
        category: "collection", amount: roundBaseMoney(group.cashTotal),
        tenderCurrency: group.tenderCurrency ?? boot.settings.baseCurrency,
        tenderRate: group.tenderRate,
      });
    }
    for (const ret of boot.saleReturns) {
      if (ret.refundCash <= 0.004) continue;
      events.push({
        id: `ret-${ret.id}`, at: ret.createdAt,
        label: `Refund — ${customerName(ret.customerId)}`,
        category: "refund", amount: -ret.refundCash,
        tenderCurrency: ret.tenderCurrency ?? boot.settings.baseCurrency,
        tenderRate: ret.tenderRate,
      });
    }
    for (const movement of boot.cashDrawerMovements) {
      events.push({
        id: `cdm-${movement.id}`, at: movement.createdAt,
        label: movement.notes || (movement.movementType === "paid_out" ? "Paid out" : "Cash in"),
        category: movement.category ?? movement.movementType,
        amount: movement.amount,
        tenderCurrency: movement.tenderCurrency, tenderRate: movement.tenderRate,
      });
    }
    return events.sort((a, b) => a.at.localeCompare(b.at));
  }, [boot]);
}

function CashTab() {
  const { boot, mutate, posUser } = useApp();
  const events = useCashEvents();
  const settings = boot!.settings;
  const [recording, setRecording] = useState<"paid_out" | "cash_in" | null>(null);

  const cashInBox = roundBaseMoney(events.reduce((sum, e) => sum + e.amount, 0));
  // Physical note split per currency, using each event's FROZEN tender rate
  // (whole-LBP amounts, so physical counts reconcile — plan invariant 7).
  let baseNotes = 0;
  let secondaryNotes = 0;
  for (const event of events) {
    if (event.tenderCurrency === settings.secondaryCurrency) {
      secondaryNotes += toSecondary(event.amount, event.tenderRate ?? settings.exchangeRate);
    } else {
      baseNotes = roundBaseMoney(baseNotes + event.amount);
    }
  }
  secondaryNotes = roundSecondaryMoney(secondaryNotes);

  const today = new Date().toDateString();
  const todayIn = roundBaseMoney(events
    .filter((e) => new Date(e.at).toDateString() === today && e.amount > 0)
    .reduce((sum, e) => sum + e.amount, 0));
  const todayOut = roundBaseMoney(events
    .filter((e) => new Date(e.at).toDateString() === today && e.amount < 0)
    .reduce((sum, e) => sum + e.amount, 0));

  let running = 0;
  const ledger = events.map((event) => {
    running = roundBaseMoney(running + event.amount);
    return { ...event, running };
  }).reverse();

  const canRecord = posUser?.role !== "cashier";

  return (
    <>
      <div className="cash-hero card">
        <div>
          <div className="metric-label">Cash in box</div>
          <div className="cash-hero-value num">{formatBase(cashInBox)}</div>
          <div className="muted num">
            ≈ {formatSecondary(toSecondary(cashInBox, settings.exchangeRate),
              settings.secondaryCurrency, settings.lbpDisplayRounding)}
          </div>
        </div>
        <div className="note-split">
          <div className="note-box">
            <span className="metric-label">{settings.baseCurrency} notes</span>
            <strong className="num">{formatBase(baseNotes)}</strong>
          </div>
          <div className="note-box">
            <span className="metric-label">{settings.secondaryCurrency} notes</span>
            <strong className="num">
              {formatSecondary(secondaryNotes, settings.secondaryCurrency)}
            </strong>
          </div>
        </div>
        <div className="cash-hero-today num">
          <span>Today in <strong className="pos-text">{formatBase(todayIn)}</strong></span>
          <span>Today out <strong className="neg-text">{formatBase(Math.abs(todayOut))}</strong></span>
          <span>Net <strong>{formatBase(roundBaseMoney(todayIn + todayOut))}</strong></span>
        </div>
        {canRecord ? (
          <div className="cash-hero-actions">
            <button className="btn" onClick={() => setRecording("paid_out")}>
              <ArrowUpFromLine size={15} /> Record paid-out
            </button>
            <button className="btn" onClick={() => setRecording("cash_in")}>
              <ArrowDownToLine size={15} /> Record cash-in
            </button>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="card-title">Cash ledger</h2>
        <table className="table">
          <thead><tr><th>When</th><th>Event</th><th>Type</th>
            <th className="num">Amount</th><th className="num">Balance</th><th /></tr></thead>
          <tbody>
            {ledger.slice(0, 100).map((event) => (
              <tr key={event.id}>
                <td className="muted">{timeLabel(event.at)}</td>
                <td>{event.label}</td>
                <td><CashCategoryBadge category={event.category} /></td>
                <td className={`num ${event.amount < 0 ? "neg" : "pos"}`}>
                  {event.amount > 0 ? "+" : ""}{formatBase(event.amount)}
                  {event.tenderCurrency !== settings.baseCurrency ? (
                    <div className="muted" style={{ fontWeight: 600, fontSize: 11.5 }}>
                      {formatSecondary(
                        toSecondary(event.amount, event.tenderRate ?? settings.exchangeRate),
                        settings.secondaryCurrency)}
                    </div>
                  ) : null}
                </td>
                <td className="num">{formatBase(event.running)}</td>
                <td className="td-actions">
                  {event.id.startsWith("cdm-") && canRecord ? (
                    <DeleteMovementButton movementId={event.id.slice(4)} />
                  ) : null}
                </td>
              </tr>
            ))}
            {ledger.length === 0 ? (
              <tr><td colSpan={6} className="muted">No cash activity yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {recording ? (
        <RecordMovementModal type={recording} onClose={() => setRecording(null)} />
      ) : null}
    </>
  );
}

function DeleteMovementButton({ movementId }: { movementId: string }) {
  const { mutate } = useApp();
  return (
    <button className="btn btn-sm btn-danger-soft"
            onClick={async () => {
              const { ok } = await askConfirm({
                title: "Delete this movement?", danger: true, confirmLabel: "Delete",
              });
              if (ok) await mutate("DELETE", `/api/cash/movements/${movementId}`);
            }}>
      Delete
    </button>
  );
}

const CATEGORY_TONES: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  sale: "success", collection: "success", refund: "danger",
  owner_draw: "warning", cash_drop: "info", supplier: "warning",
  petty_cash: "neutral", other: "neutral", note: "neutral",
  paid_out: "warning", cash_in: "success",
};

function CashCategoryBadge({ category }: { category: string }) {
  return (
    <Badge kind={CATEGORY_TONES[category] ?? "neutral"}>
      {category.replace(/_/g, " ")}
    </Badge>
  );
}

function RecordMovementModal({ type, onClose }: {
  type: "paid_out" | "cash_in"; onClose: () => void;
}) {
  const { boot, mutate, pushToast } = useApp();
  const settings = boot!.settings;
  const [tender, setTender] = useState<"base" | "secondary">("base");
  const [amountText, setAmountText] = useState("");
  const [category, setCategory] = useState<string>(type === "paid_out" ? "supplier" : "other");
  const [notes, setNotes] = useState("");

  const parsed = parseFloat(amountText.replace(/,/g, "")) || 0;
  const tenderCurrency = tender === "base" ? settings.baseCurrency : settings.secondaryCurrency;
  const amountBase = tender === "base"
    ? roundBaseMoney(parsed) : fromSecondary(parsed, settings.exchangeRate);

  return (
    <Modal onClose={onClose} labelledBy="movement-title">
      <h3 id="movement-title" className="modal-title">
        {type === "paid_out" ? "Record paid-out" : "Record cash-in"}
      </h3>
      <div className="segmented" style={{ marginBottom: 10 }}>
        <button className={tender === "base" ? "seg-active" : ""}
                onClick={() => setTender("base")}>{settings.baseCurrency}</button>
        <button className={tender === "secondary" ? "seg-active" : ""}
                onClick={() => setTender("secondary")}>{settings.secondaryCurrency}</button>
      </div>
      <label className="field">
        <span className="field-label">Amount ({tenderCurrency})</span>
        <input className="input num" value={amountText} inputMode="decimal" autoFocus
               onChange={(event) => setAmountText(event.target.value)} />
      </label>
      {tender === "secondary" && amountBase > 0 ? (
        <p className="muted num">= {formatBase(amountBase)}</p>
      ) : null}
      {type === "paid_out" ? (
        <div className="preset-row" style={{ marginTop: 8 }}>
          {PAIDOUT_CATEGORIES.map((c) => (
            <button key={c.id} className={`chip ${category === c.id ? "chip-active" : ""}`}
                    onClick={() => setCategory(c.id)}>{c.label}</button>
          ))}
        </div>
      ) : null}
      <label className="field" style={{ marginTop: 8 }}>
        <span className="field-label">Notes</span>
        <input className="input" value={notes} maxLength={200}
               onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={amountBase <= 0}
                onClick={async () => {
                  if (await mutate("POST", "/api/cash/movements", {
                    movementType: type, amountBase, category,
                    notes: notes.trim() || null, tenderCurrency,
                  })) {
                    pushToast("success", "Movement recorded.");
                    onClose();
                  }
                }}>
          Record
        </button>
      </div>
    </Modal>
  );
}

// ---------- Ledgers ----------
function LedgersTab() {
  const { boot, mutate, posUser } = useApp();
  const groups = groupPayments(boot!.payments);
  const customerName = (id: string | null) =>
    id ? boot!.customers.find((c) => c.id === id)?.name ?? "?" : "—";
  const canCancel = posUser?.role !== "cashier";
  return (
    <div className="card">
      <h2 className="card-title">Payment history (collections)</h2>
      {groups.length === 0 ? <p className="muted">No collections yet.</p> : (
        <table className="table">
          <thead><tr><th>When</th><th>Customer</th><th className="num">Total</th>
            <th>Split</th><th>Tender</th><th className="th-actions" /></tr></thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.groupId}>
                <td className="muted">{timeLabel(group.createdAt)}</td>
                <td>{customerName(group.customerId)}</td>
                <td className="num">{formatBase(roundBaseMoney(group.total))}</td>
                <td>
                  {group.cashTotal > 0 ? <Badge kind="success">cash</Badge> : null}
                  {group.creditTotal > 0 ? <Badge kind="info">store credit</Badge> : null}
                  <span className="muted num"> {group.rows.length} order(s)</span>
                </td>
                <td className="muted">{group.tenderCurrency ?? "—"}</td>
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
    </div>
  );
}

// ---------- Audit ----------
const AUDIT_TARGET_SECTION: Record<string, Section> = {
  variant: "stock", sale: "orders", customer: "crm", user: "settings",
};

function AuditTab() {
  const { boot, setSection } = useApp();
  const checks = boot!.auditChecks;
  return (
    <>
      <div className="card">
        <h2 className="card-title"><ShieldCheck size={18} /> Audit checks</h2>
        {checks.length === 0 ? (
          <p className="pos-text" style={{ fontWeight: 700 }}>
            All checks pass — every number reconciles.
          </p>
        ) : (
          checks.map((check) => (
            <div key={check.id} className="review-row">
              <AlertTriangle size={18}
                className={check.severity === "danger" ? "neg-text" : "review-icon"} />
              <div className="review-body">
                <strong>
                  {check.area}
                  <Badge kind={check.severity === "danger" ? "danger" : "warning"}>
                    {check.severity}
                  </Badge>
                </strong>
                <span className="muted">{check.message}</span>
              </div>
              {check.targetType && AUDIT_TARGET_SECTION[check.targetType] ? (
                <button className="btn btn-sm"
                        onClick={() => setSection(AUDIT_TARGET_SECTION[check.targetType!])}>
                  Go fix
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="card-title">Activity log</h2>
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {boot!.auditLogs.slice(0, 50).map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{timeLabel(entry.createdAt)}</td>
                <td>{entry.userId
                  ? boot!.users.find((u) => u.id === entry.userId)?.name ?? entry.userId
                  : "—"}</td>
                <td><code className="log-action">{entry.action}</code></td>
                <td className="muted log-detail">
                  {entry.detail ? JSON.stringify(entry.detail) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
