// Cash-event derivation shared by Financial and Dashboard. The drawer ledger is
// DERIVED from sales/payments/returns plus manual movements (ports App.tsx:13283).
import { roundBaseMoney } from "./money";
import { groupPayments } from "./payments";
import type { BootstrapData } from "../types";

export interface CashEvent {
  id: string;
  at: string;
  label: string;
  category: string;
  amount: number;           // signed base
  tenderCurrency: string;
  tenderRate: number | null;
}

export function buildCashEvents(boot: BootstrapData): CashEvent[] {
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
}
