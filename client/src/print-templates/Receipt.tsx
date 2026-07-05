// Printable order receipt/invoice: business header, frozen tender rate,
// dual-currency totals, footer. Renders inside PrintPortal only.
import { formatBase, formatSecondary, toSecondary } from "../lib/money";
import type { Customer, Sale, Settings } from "../types";

export function Receipt({ sale, settings, customer }: {
  sale: Sale;
  settings: Settings;
  customer: Customer | null;
}) {
  const rate = sale.tenderRate ?? settings.exchangeRate;
  const inSecondary = (amount: number) =>
    formatSecondary(toSecondary(amount, rate), settings.secondaryCurrency,
      settings.lbpDisplayRounding);
  return (
    <div className="print-doc">
      <header className="print-head">
        {settings.logoUrl ? (
          <img className="print-logo" src={settings.logoUrl} alt={settings.businessName} />
        ) : (
          <h1>{settings.businessName}</h1>
        )}
        {settings.businessTagline ? <p>{settings.businessTagline}</p> : null}
        <p>
          {[settings.businessPhone, settings.businessAddress].filter(Boolean).join(" · ")}
        </p>
      </header>

      <div className="print-meta">
        <div>
          <strong>{sale.orderRef}</strong>
          <span>{new Date(sale.createdAt).toLocaleString()}</span>
        </div>
        <div>
          <span>Customer: <strong>{customer?.name ?? "Walk-in"}</strong></span>
          {sale.tenderCurrency !== settings.baseCurrency ? (
            <span>Rate: 1 {settings.baseCurrency} = {rate.toLocaleString()} {settings.secondaryCurrency}</span>
          ) : null}
        </div>
      </div>

      <table className="print-table">
        <thead>
          <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.modelName}
                {line.color ? ` — ${line.color} / ${line.size}` : ""}
              </td>
              <td>{line.qty}</td>
              <td>{formatBase(line.unitPrice, settings.baseCurrency)}</td>
              <td>{formatBase(line.lineTotal, settings.baseCurrency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="print-totals">
        <tbody>
          {sale.discountAmount > 0 || sale.taxAmount > 0 ? (
            <tr><td>Subtotal</td><td>{formatBase(sale.subtotal)}</td></tr>
          ) : null}
          {sale.discountAmount > 0 ? (
            <tr><td>Discount{sale.discountReason ? ` (${sale.discountReason})` : ""}</td>
              <td>−{formatBase(sale.discountAmount)}</td></tr>
          ) : null}
          {sale.taxAmount > 0 ? (
            <tr><td>Tax</td><td>{formatBase(sale.taxAmount)}</td></tr>
          ) : null}
          <tr className="print-grand">
            <td>Total</td>
            <td>{formatBase(sale.total)}<br /><small>{inSecondary(sale.total)}</small></td>
          </tr>
          {sale.returnedAmount > 0 ? (
            <tr><td>Returned</td><td>−{formatBase(sale.returnedAmount)}</td></tr>
          ) : null}
          <tr><td>Paid</td><td>{formatBase(sale.paidAmount)}</td></tr>
          {sale.dueAmount > 0.004 ? (
            <tr className="print-due">
              <td>Amount due</td>
              <td>{formatBase(sale.dueAmount)}<br /><small>{inSecondary(sale.dueAmount)}</small></td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {sale.status === "voided" ? <p className="print-void">VOIDED</p> : null}
      <footer className="print-foot">
        <p>{settings.receiptFooter}</p>
        <small>Prices in {settings.baseCurrency}; {settings.secondaryCurrency} shown at the
          rate frozen when this order was made.</small>
      </footer>
    </div>
  );
}
