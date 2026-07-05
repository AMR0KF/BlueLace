// Bootstrap payload types — field names mirror server/app/bootstrap.py exactly.

export type Role = "admin" | "manager" | "cashier";
export type Section =
  | "dashboard" | "pos" | "stock" | "purchasing" | "crm" | "orders"
  | "financial" | "reports" | "settings";

export interface Settings {
  baseCurrency: string;
  secondaryCurrency: string;
  exchangeRate: number;
  taxRate: number;
  lbpDisplayRounding: number;
  businessName: string;
  businessTagline: string;
  businessPhone: string;
  businessAddress: string;
  receiptFooter: string;
  logoUrl: string;
}

export interface PosUser {
  id: string;
  name: string;
  role: Role;
  sections: Section[];
}

export interface ManagedUser extends PosUser {
  active: boolean;
  isDefaultPin: boolean;
}

export interface ShoeModel {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  image: string | null;                        // 'icon:<key>', data-URL photo, or legacy emoji
  colorImages: Record<string, string> | null;  // color name -> data-URL photo
  tileColor: string | null;
  basePrice: number;
  defaultCost: number;
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

export interface Variant {
  id: string;
  modelId: string;
  color: string;
  size: string;
  sku: string | null;
  barcode: string | null;
  priceOverride: number | null;
  stockQty: number;
  lastCost: number | null;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  creditLimit: number;
  storeCredit: number;
  isSystem: boolean;
  createdAt: string;
  balance: number; // server-derived: sum of open dues
}

export type SaleStatus = "completed" | "partial" | "unpaid" | "voided";

export interface SaleLine {
  id: string;
  saleId: string;
  variantId: string | null;
  modelName: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  sku: string | null;
  qty: number;
  returnedQty: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  orderNo: number | null;
  orderRef: string;
  customerId: string | null;
  status: SaleStatus;
  subtotal: number;
  discountAmount: number;
  discountReason: string | null;
  taxAmount: number;
  total: number;
  upfrontPaid: number;
  paidAmount: number;
  dueAmount: number;
  returnedAmount: number;
  returnStatus: "partial" | "full" | null;
  itemsCount: number;
  tenderCurrency: string;
  tenderRate: number | null;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  statusBeforeVoid: SaleStatus | null;
  userId: string | null;
  createdAt: string;
  lines: SaleLine[];
  queued?: boolean; // client-only: offline sale awaiting sync
}

export interface Payment {
  id: string; // '<groupId>:<n>'
  customerId: string | null;
  saleId: string;
  amount: number;
  method: string;
  kind: "collection" | "store_credit_use";
  notes: string | null;
  tenderCurrency: string | null;
  tenderRate: number | null;
  userId: string | null;
  createdAt: string;
}

export interface ReturnLine {
  id: string;
  returnId: string;
  saleItemId: string | null;
  variantId: string | null;
  modelName: string | null;
  color: string | null;
  size: string | null;
  qty: number;
  unitPrice: number;
  unitCost: number;
  lineValue: number;
}

export interface SaleReturn {
  id: string;
  saleId: string;
  customerId: string | null;
  totalValue: number;
  appliedToDue: number;
  refundCash: number;
  refundCredit: number;
  refundMethod: "cash" | "store_credit";
  reason: string | null;
  tenderCurrency: string | null;
  tenderRate: number | null;
  userId: string | null;
  createdAt: string;
  lines: ReturnLine[];
}

export interface StockMovement {
  id: string;
  variantId: string;
  movementType: "receive" | "sale" | "return" | "adjustment" | "void_restock";
  qty: number;
  unitCost: number | null;
  refSaleId: string | null;
  refReturnId: string | null;
  refPurchaseId: string | null;
  note: string | null;
  needsReview: number;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  userId: string | null;
  createdAt: string;
  // joined labels
  color: string;
  size: string;
  modelId: string;
  modelName: string;
  stockQty?: number; // present on review-queue items
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
}

export interface PurchaseLine {
  id: string;
  purchaseId: string;
  variantId: string | null;
  modelName: string;
  color: string | null;
  size: string | null;
  sku: string | null;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  purchaseNo: number | null;
  purchaseRef: string;
  supplierId: string | null;
  invoiceNo: string | null;
  status: "received" | "voided";
  totalCost: number;
  itemsCount: number;
  paidAmount: number;   // paid from the cash drawer at entry time
  notes: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  userId: string | null;
  createdAt: string;
  lines: PurchaseLine[];
}

export interface CashMovement {
  id: string;
  amount: number; // signed base
  movementType: "paid_out" | "cash_in";
  category: string | null;
  notes: string | null;
  tenderCurrency: string;
  tenderRate: number | null;
  userId: string | null;
  createdAt: string;
}

export interface AuditCheck {
  id: string;
  severity: "danger" | "warning";
  area: string;
  message: string;
  targetType: string | null;
  targetId: string | null;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: Record<string, unknown> | string | null;
  createdAt: string;
}

export interface BootstrapData {
  serverTime: string;
  settings: Settings;
  posUser: PosUser;
  users: ManagedUser[];
  models: ShoeModel[];
  variants: Variant[];
  customers: Customer[];
  sales: Sale[];
  payments: Payment[];
  saleReturns: SaleReturn[];
  stockMovements: StockMovement[];
  stockReviewItems: StockMovement[];
  cashDrawerMovements: CashMovement[];
  suppliers: Supplier[];
  purchases: Purchase[];
  auditChecks: AuditCheck[];
  auditLogs: AuditLogEntry[];
}

// ---- POS cart (client-local) ----
export interface CartLine {
  key: string;            // variantId or custom key
  variantId: string | null;
  customName?: string;
  modelName: string;
  color: string | null;
  size: string | null;
  qty: number;
  unitPrice: number;      // base currency, editable inline
  defaultPrice: number;   // for the "custom price" badge + reset
  stockQty?: number;
}
