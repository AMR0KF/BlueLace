// Reports: period-scoped operating summary — sales & margin from FROZEN line
// costs, per-model profit table, sales by size/color, discounts & giveaways,
// receivables aging detail. All client-derived (ports Reports, App.tsx:14087).
import { useMemo, useState } from "react";
import { timeLabel } from "../../components/ui";
import { formatBase, roundBaseMoney } from "../../lib/money";
import { useApp } from "../../state/AppState";

type Period = 7 | 30 | 90 | 0; // 0 = all time

export function ReportsSection() {
  const { boot } = useApp();
  const [period, setPeriod] = useState<Period>(30);

  const report = useMemo(() => {
    if (!boot) return null;
    const cutoff = period === 0 ? 0 : Date.now() - period * 86_400_000;
    const sales = boot.sales.filter((s) =>
      s.status !== "voided" && new Date(s.createdAt).getTime() >= cutoff);

    let gross = 0, returned = 0, discounts = 0, cogs = 0, pairs = 0, giveaways = 0;
    const perModel = new Map<string, {
      name: string; qty: number; revenue: number; cost: number;
    }>();
    const perSize = new Map<string, number>();
    const perColor = new Map<string, number>();

    for (const sale of sales) {
      gross = roundBaseMoney(gross + sale.total);
      returned = roundBaseMoney(returned + sale.returnedAmount);
      discounts = roundBaseMoney(discounts + sale.discountAmount);
      for (const line of sale.lines) {
        const netQty = line.qty - line.returnedQty;
        if (netQty <= 0) continue;
        pairs += line.variantId ? netQty : 0;
        cogs = roundBaseMoney(cogs + netQty * line.unitCost);
        if (line.unitPrice <= 0.004) giveaways += netQty;
        const entry = perModel.get(line.modelName)
          ?? { name: line.modelName, qty: 0, revenue: 0, cost: 0 };
        entry.qty += netQty;
        entry.revenue = roundBaseMoney(entry.revenue + netQty * line.unitPrice);
        entry.cost = roundBaseMoney(entry.cost + netQty * line.unitCost);
        perModel.set(line.modelName, entry);
        if (line.size) perSize.set(line.size, (perSize.get(line.size) ?? 0) + netQty);
        if (line.color) perColor.set(line.color, (perColor.get(line.color) ?? 0) + netQty);
      }
    }
    const netSales = roundBaseMoney(gross - returned);
    const grossProfit = roundBaseMoney(netSales - cogs);
    const models = [...perModel.values()].sort((a, b) => b.revenue - a.revenue);
    const sizes = [...perSize.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]));
    const colors = [...perColor.entries()].sort((a, b) => b[1] - a[1]);
    const openSales = boot.sales
      .filter((s) => s.status !== "voided" && s.dueAmount > 0.004)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      netSales, returned, discounts, cogs, grossProfit, pairs, giveaways,
      models, sizes, colors, openSales,
    };
  }, [boot, period]);

  if (!boot || !report) return null;
  const marginPct = report.netSales > 0 ? report.grossProfit / report.netSales * 100 : 0;
  const maxSize = Math.max(...report.sizes.map(([, qty]) => qty), 1);
  const customerName = (id: string | null) =>
    id ? boot.customers.find((c) => c.id === id)?.name ?? "?" : "Walk-in";

  return (
    <div className="section-page">
      <header className="page-head">
        <h1>Reports</h1>
        <div className="preset-row" style={{ marginBottom: 0 }}>
          {([7, 30, 90, 0] as Period[]).map((days) => (
            <button key={days} className={`chip ${period === days ? "chip-active" : ""}`}
                    onClick={() => setPeriod(days)}>
              {days === 0 ? "All time" : `${days}d`}
            </button>
          ))}
        </div>
      </header>

      <div className="metric-row">
        <div className="metric-card">
          <div className="metric-label">Net sales</div>
          <div className="metric-value num">{formatBase(report.netSales)}</div>
          <div className="metric-sub num">
            {report.returned > 0 ? `after ${formatBase(report.returned)} returns` : "no returns"}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Gross profit</div>
          <div className="metric-value num">{formatBase(report.grossProfit)}</div>
          <div className="metric-sub num">{marginPct.toFixed(1)}% margin (frozen costs)</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pairs sold</div>
          <div className="metric-value num">{report.pairs}</div>
          <div className="metric-sub num">
            {report.giveaways > 0 ? `${report.giveaways} given free` : ""}
          </div>
        </div>
        <div className={`metric-card ${report.discounts > 0 ? "metric-warning" : ""}`}>
          <div className="metric-label">Discounts given</div>
          <div className="metric-value num">{formatBase(report.discounts)}</div>
        </div>
      </div>

      <div className="dash-grid">
        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2 className="card-title">Profit by model</h2>
          <table className="table">
            <thead><tr><th>Model</th><th className="num">Sold</th>
              <th className="num">Revenue</th><th className="num">Cost</th>
              <th className="num">Profit</th><th className="num">Margin</th></tr></thead>
            <tbody>
              {report.models.map((model) => {
                const profit = roundBaseMoney(model.revenue - model.cost);
                const margin = model.revenue > 0 ? profit / model.revenue * 100 : 0;
                return (
                  <tr key={model.name}>
                    <td>{model.name}</td>
                    <td className="num">{model.qty}</td>
                    <td className="num">{formatBase(model.revenue)}</td>
                    <td className="num">{formatBase(model.cost)}</td>
                    <td className={`num ${profit >= 0 ? "pos" : "neg"}`}>{formatBase(profit)}</td>
                    <td className="num">{margin.toFixed(0)}%</td>
                  </tr>
                );
              })}
              {report.models.length === 0 ? (
                <tr><td colSpan={6} className="muted">No sales in this period.</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2 className="card-title">Sales by size</h2>
          {report.sizes.length === 0 ? <p className="muted">No data.</p> : (
            report.sizes.map(([size, qty]) => (
              <div key={size} className="top-row">
                <span className="top-name num">{size}</span>
                <div className="top-bar-track">
                  <div className="top-bar" style={{ width: `${qty / maxSize * 100}%` }} />
                </div>
                <span className="num top-val">{qty}</span>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Sales by color</h2>
          {report.colors.length === 0 ? <p className="muted">No data.</p> : (
            report.colors.map(([color, qty]) => {
              const max = report.colors[0][1] || 1;
              return (
                <div key={color} className="top-row">
                  <span className="top-name">{color}</span>
                  <div className="top-bar-track">
                    <div className="top-bar" style={{ width: `${qty / max * 100}%` }} />
                  </div>
                  <span className="num top-val">{qty}</span>
                </div>
              );
            })
          )}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2 className="card-title">Open receivables (oldest first)</h2>
          <table className="table">
            <thead><tr><th>Order</th><th>Customer</th><th>When</th>
              <th className="num">Total</th><th className="num">Due</th>
              <th className="num">Age</th></tr></thead>
            <tbody>
              {report.openSales.map((sale) => {
                const age = Math.floor(
                  (Date.now() - new Date(sale.createdAt).getTime()) / 86_400_000);
                return (
                  <tr key={sale.id}>
                    <td>{sale.orderRef}</td>
                    <td>{customerName(sale.customerId)}</td>
                    <td className="muted">{timeLabel(sale.createdAt)}</td>
                    <td className="num">{formatBase(sale.total)}</td>
                    <td className="num neg-text">{formatBase(sale.dueAmount)}</td>
                    <td className={`num ${age > 30 ? "neg-text" : age > 7 ? "warn-text" : ""}`}>
                      {age}d
                    </td>
                  </tr>
                );
              })}
              {report.openSales.length === 0 ? (
                <tr><td colSpan={6} className="pos-text" style={{ fontWeight: 700 }}>
                  Nothing outstanding.</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
