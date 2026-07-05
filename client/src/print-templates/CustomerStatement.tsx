// Printable customer account statement: open orders + payments + balance.
import { formatBase, formatSecondary, toSecondary } from "../lib/money";
import { groupPayments } from "../lib/payments";
import type { Customer, Payment, Sale, Settings } from "../types";

export function CustomerStatement({ customer, sales, payments, settings }: {
  customer: Customer;
  sales: Sale[];
  payments: Payment[];
  settings: Settings;
}) {
  const open = sales.filter((s) => s.status !== "voided" && s.dueAmount > 0.004);
  const groups = groupPayments(payments).slice(0, 20);
  return (
    <div className="print-doc">
      <header className="print-head">
        {settings.logoUrl ? (
          <img className="print-logo" src={settings.logoUrl} alt={settings.businessName} />
        ) : (
          <h1>{settings.businessName}</h1>
        )}
        <p>Account statement — {new Date().toLocaleDateString()}</p>
      </header>
      <div className="print-meta">
        <div>
          <strong>{customer.name}</strong>
          {customer.phone ? <span>{customer.phone}</span> : null}
        </div>
        <div>
          <span>Balance due: <strong>{formatBase(customer.balance)}</strong></span>
          <span>
            ≈ {formatSecondary(toSecondary(customer.balance, settings.exchangeRate),
              settings.secondaryCurrency, settings.lbpDisplayRounding)}
          </span>
        </div>
      </div>

      <h2 className="print-sub">Open orders</h2>
      <table className="print-table">
        <thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Paid</th><th>Due</th></tr></thead>
        <tbody>
          {open.map((sale) => (
            <tr key={sale.id}>
              <td>{sale.orderRef}</td>
              <td>{new Date(sale.createdAt).toLocaleDateString()}</td>
              <td>{formatBase(sale.total)}</td>
              <td>{formatBase(sale.paidAmount)}</td>
              <td>{formatBase(sale.dueAmount)}</td>
            </tr>
          ))}
          {open.length === 0 ? <tr><td colSpan={5}>Nothing outstanding.</td></tr> : null}
        </tbody>
      </table>

      <h2 className="print-sub">Recent payments</h2>
      <table className="print-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.groupId}>
              <td>{new Date(group.createdAt).toLocaleDateString()}</td>
              <td>{formatBase(group.total)}</td>
              <td>{group.creditTotal > 0 ? "cash + store credit" : "cash"}</td>
            </tr>
          ))}
          {groups.length === 0 ? <tr><td colSpan={3}>No payments yet.</td></tr> : null}
        </tbody>
      </table>
      <footer className="print-foot"><p>{settings.receiptFooter}</p></footer>
    </div>
  );
}
