// Collection grouping: rows share '<groupId>:<n>' ids (ports paymentBaseId,
// local-db-server.mjs:1161). A group renders as ONE collected payment.
import type { Payment } from "../types";

export interface PaymentGroup {
  groupId: string;
  customerId: string | null;
  createdAt: string;
  total: number;
  cashTotal: number;
  creditTotal: number;
  tenderCurrency: string | null;
  tenderRate: number | null;
  notes: string | null;
  rows: Payment[];
}

export function paymentBaseId(id: string): string {
  const index = id.lastIndexOf(":");
  return index > 0 ? id.slice(0, index) : id;
}

export function groupPayments(payments: Payment[]): PaymentGroup[] {
  const groups = new Map<string, PaymentGroup>();
  for (const payment of payments) {
    const groupId = paymentBaseId(payment.id);
    let group = groups.get(groupId);
    if (!group) {
      group = {
        groupId,
        customerId: payment.customerId,
        createdAt: payment.createdAt,
        total: 0, cashTotal: 0, creditTotal: 0,
        tenderCurrency: payment.tenderCurrency,
        tenderRate: payment.tenderRate,
        notes: payment.notes,
        rows: [],
      };
      groups.set(groupId, group);
    }
    group.rows.push(payment);
    group.total += payment.amount;
    if (payment.kind === "store_credit_use") group.creditTotal += payment.amount;
    else {
      group.cashTotal += payment.amount;
      group.tenderCurrency = group.tenderCurrency ?? payment.tenderCurrency;
      group.tenderRate = group.tenderRate ?? payment.tenderRate;
    }
  }
  return [...groups.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
