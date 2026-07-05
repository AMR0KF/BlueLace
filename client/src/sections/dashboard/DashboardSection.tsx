// Dashboard: live "today" glance — KPIs, revenue trend with still-owed overlay,
// receivables aging strip, top models, recent sales. All client-derived from the
// bootstrap (ports Dashboard, App.tsx:7000).
import { useMemo } from "react";
import { StatusBadge, timeLabel } from "../../components/ui";
import { buildCashEvents } from "../../lib/cash";
import { formatBase, roundBaseMoney } from "../../lib/money";
import { useApp } from "../../state/AppState";
import type { Sale } from "../../types";

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

export function DashboardSection() {
  const { boot, setSection } = useApp();

  const derived = useMemo(() => {
    if (!boot) return null;
    const sales = boot.sales.filter((s) => s.status !== "voided");
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86_400_000).toDateString();

    const netOf = (sale: Sale) => roundBaseMoney(sale.total - sale.returnedAmount);
    const salesOn = (day: string) => sales.filter((s) => dayKey(s.createdAt) === day);
    const revenueToday = roundBaseMoney(salesOn(today).reduce((sum, s) => sum + netOf(s), 0));
    const revenueYesterday = roundBaseMoney(
      salesOn(yesterday).reduce((sum, s) => sum + netOf(s), 0));

    const cashInBox = roundBaseMoney(
      buildCashEvents(boot).reduce((sum, e) => sum + e.amount, 0));
    const receivables = roundBaseMoney(
      boot.customers.reduce((sum, c) => sum + c.balance, 0));
    const stockValue = roundBaseMoney(boot.variants.reduce(
      (sum, v) => sum + Math.max(v.stockQty, 0) * (v.lastCost ?? 0), 0));

    // 14-day revenue trend with a still-owed tip per day.
    const days: { label: string; total: number; owed: number; isToday: boolean }[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86_400_000);
      const key = date.toDateString();
      const daySales = salesOn(key);
      days.push({
        label: date.toLocaleDateString(undefined, { weekday: "narrow" }),
        total: roundBaseMoney(daySales.reduce((sum, s) => sum + netOf(s), 0)),
        owed: roundBaseMoney(daySales.reduce((sum, s) => sum + s.dueAmount, 0)),
        isToday: i === 0,
      });
    }

    // Receivables aging (0-7 / 8-30 / 31+ days) over open sales.
    const now = Date.now();
    const aging = { fresh: 0, warm: 0, stale: 0 };
    for (const sale of sales) {
      if (sale.dueAmount <= 0.004) continue;
      const ageDays = (now - new Date(sale.createdAt).getTime()) / 86_400_000;
      if (ageDays <= 7) aging.fresh += sale.dueAmount;
      else if (ageDays <= 30) aging.warm += sale.dueAmount;
      else aging.stale += sale.dueAmount;
    }

    // Top models (30 days, by net revenue).
    const cutoff = now - 30 * 86_400_000;
    const perModel = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const sale of sales) {
      if (new Date(sale.createdAt).getTime() < cutoff) continue;
      for (const line of sale.lines) {
        const key = line.modelName;
        const entry = perModel.get(key) ?? { name: key, qty: 0, revenue: 0 };
        const netQty = line.qty - line.returnedQty;
        entry.qty += netQty;
        entry.revenue = roundBaseMoney(entry.revenue + netQty * line.unitPrice);
        perModel.set(key, entry);
      }
    }
    const topModels = [...perModel.values()]
      .sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    const recent = sales.slice(0, 6);
    return {
      revenueToday, revenueYesterday, cashInBox, receivables, stockValue,
      days, aging, topModels, recent,
    };
  }, [boot]);

  if (!boot || !derived) return null;
  const { settings } = boot;
  const maxDay = Math.max(...derived.days.map((d) => d.total), 1);
  const agingTotal = derived.aging.fresh + derived.aging.warm + derived.aging.stale;
  const customerName = (id: string | null) =>
    id ? boot.customers.find((c) => c.id === id)?.name ?? "?" : "Walk-in";
  const delta = derived.revenueYesterday > 0
    ? (derived.revenueToday - derived.revenueYesterday) / derived.revenueYesterday * 100
    : null;

  return (
    <div className="section-page">
      <header className="page-head"><h1>Dashboard</h1></header>

      <div className="metric-row">
        <div className="metric-card">
          <div className="metric-label">Revenue today</div>
          <div className="metric-value num">{formatBase(derived.revenueToday)}</div>
          <div className="metric-sub num">
            {delta === null ? `yesterday ${formatBase(derived.revenueYesterday)}`
              : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}% vs yesterday`}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Cash in box</div>
          <div className="metric-value num">{formatBase(derived.cashInBox)}</div>
          <div className="metric-sub">
            <button className="link-btn" onClick={() => setSection("financial")}>open drawer</button>
          </div>
        </div>
        <div className={`metric-card ${derived.receivables > 0 ? "metric-warning" : ""}`}>
          <div className="metric-label">Receivables</div>
          <div className="metric-value num">{formatBase(derived.receivables)}</div>
          <div className="metric-sub">
            <button className="link-btn" onClick={() => setSection("crm")}>collect</button>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Stock value</div>
          <div className="metric-value num">{formatBase(derived.stockValue)}</div>
          <div className="metric-sub">at cost</div>
        </div>
      </div>

      <div className="dash-grid">
        <section className="card">
          <h2 className="card-title">Last 14 days</h2>
          <div className="trend-chart">
            {derived.days.map((day, index) => {
              const height = Math.max(day.total / maxDay * 120, day.total > 0 ? 4 : 1);
              const owedHeight = day.total > 0
                ? Math.min(day.owed / maxDay * 120, height) : 0;
              return (
                <div key={index} className="trend-col" title={`${formatBase(day.total)} (${formatBase(day.owed)} owed)`}>
                  <div className="trend-bar-wrap" style={{ height: 124 }}>
                    <div className={`trend-bar ${day.isToday ? "trend-today" : ""}`}
                         style={{ height }}>
                      {owedHeight > 1 ? (
                        <div className="trend-owed" style={{ height: owedHeight }} />
                      ) : null}
                    </div>
                  </div>
                  <span className="trend-label">{day.label}</span>
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
            Amber tip = still owed from that day's sales.
          </p>
        </section>

        <section className="card">
          <h2 className="card-title">Receivables aging</h2>
          {agingTotal <= 0.004 ? (
            <p className="pos-text" style={{ fontWeight: 700 }}>Nothing outstanding.</p>
          ) : (
            <>
              <div className="aging-strip">
                <div className="aging-fresh" style={{ flex: derived.aging.fresh || 0.0001 }} />
                <div className="aging-warm" style={{ flex: derived.aging.warm || 0.0001 }} />
                <div className="aging-stale" style={{ flex: derived.aging.stale || 0.0001 }} />
              </div>
              <div className="aging-legend num">
                <span><i className="dot aging-fresh" /> 0-7d {formatBase(roundBaseMoney(derived.aging.fresh))}</span>
                <span><i className="dot aging-warm" /> 8-30d {formatBase(roundBaseMoney(derived.aging.warm))}</span>
                <span><i className="dot aging-stale" /> 31d+ {formatBase(roundBaseMoney(derived.aging.stale))}</span>
              </div>
            </>
          )}

          <h2 className="card-title" style={{ marginTop: 18 }}>Top models — 30 days</h2>
          {derived.topModels.length === 0 ? (
            <p className="muted">No sales yet.</p>
          ) : (
            derived.topModels.map((model) => {
              const max = derived.topModels[0].revenue || 1;
              return (
                <div key={model.name} className="top-row">
                  <span className="top-name">{model.name}</span>
                  <div className="top-bar-track">
                    <div className="top-bar" style={{ width: `${model.revenue / max * 100}%` }} />
                  </div>
                  <span className="num top-val">{formatBase(model.revenue)}</span>
                </div>
              );
            })
          )}
        </section>

        <section className="card dash-recent">
          <h2 className="card-title">Recent orders</h2>
          <table className="table">
            <tbody>
              {derived.recent.map((sale) => (
                <tr key={sale.id}>
                  <td><strong>{sale.orderRef}</strong> <StatusBadge status={sale.status} /></td>
                  <td>{customerName(sale.customerId)}</td>
                  <td className="muted">{timeLabel(sale.createdAt)}</td>
                  <td className="num">{formatBase(sale.total)}</td>
                </tr>
              ))}
              {derived.recent.length === 0 ? (
                <tr><td className="muted">No sales yet — the register is waiting.</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
