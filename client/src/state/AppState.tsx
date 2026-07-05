// App-wide state: bootstrap swap (ports applyBootstrap, App.tsx:2690), auth,
// offline sales queue + reconnect poll (ports App.tsx:2993-3098), POS cart,
// toasts, theme. Everything else is section-local useState.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { ApiError, apiRequest, getToken, setToken } from "../lib/api";
import { roundBaseMoney } from "../lib/money";
import type {
  BootstrapData, CartLine, PosUser, Sale, Section, Settings,
} from "../types";

const CACHE_KEY = "shoepos.bootstrap-cache.v1";
const QUEUE_KEY = "shoepos.offline-sales.v2";
const THEME_KEY = "shoepos.theme.v1";

export type Theme = "faress" | "voltage" | "teal" | "oxblood";

export interface OfflineSalePayload {
  id: string;
  createdAt: string;
  customerId: string | null;
  lines: { variantId: string | null; customName?: string; qty: number; unitPrice: number }[];
  discountAmount: number;
  discountReason: string | null;
  tenderCurrency: string;
  tenderRate: number;
  paymentMode: "cash" | "partial";
  paidNow: number;
}

interface Toast { id: number; kind: "info" | "error" | "success"; text: string }

interface AppStateValue {
  booted: boolean;
  boot: BootstrapData | null;
  posUser: PosUser | null;
  settings: Settings | null;
  section: Section;
  setSection: (s: Section) => void;
  serverReachable: boolean;
  offlineSales: OfflineSalePayload[];
  login: (username: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Run a mutation; server returns a fresh bootstrap which replaces all state. */
  mutate: (method: string, path: string, body?: unknown) => Promise<boolean>;
  createSale: (payload: OfflineSalePayload) => Promise<"saved" | "queued" | "failed">;
  reload: () => Promise<void>;
  pushToast: (kind: Toast["kind"], text: string) => void;
  toasts: Toast[];
  theme: Theme;
  setTheme: (t: Theme) => void;
  // POS cart (lives here so it survives section switches; ports hold/resume)
  cart: CartLine[];
  setCart: (updater: (prev: CartLine[]) => CartLine[]) => void;
  heldCart: CartLine[] | null;
  holdCart: () => void;
  resumeHeldCart: () => void;
}

const Ctx = createContext<AppStateValue | null>(null);

function loadCachedBootstrap(): BootstrapData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as BootstrapData) : null;
  } catch {
    return null;
  }
}

function loadQueue(): OfflineSalePayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineSalePayload[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: OfflineSalePayload[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Build the optimistic local Sale shown while a payload waits in the queue. */
function queuedSaleFromPayload(p: OfflineSalePayload, boot: BootstrapData): Sale {
  const lines = p.lines.map((line, index) => {
    const variant = line.variantId
      ? boot.variants.find((v) => v.id === line.variantId)
      : undefined;
    const model = variant ? boot.models.find((m) => m.id === variant.modelId) : undefined;
    return {
      id: `${p.id}-l${index}`,
      saleId: p.id,
      variantId: line.variantId,
      modelName: model?.name ?? line.customName ?? "Item",
      brand: model?.brand ?? null,
      color: variant?.color ?? null,
      size: variant?.size ?? null,
      sku: variant?.sku ?? null,
      qty: line.qty,
      returnedQty: 0,
      unitPrice: line.unitPrice,
      unitCost: 0,
      lineTotal: roundBaseMoney(line.qty * line.unitPrice),
    };
  });
  const subtotal = roundBaseMoney(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const discount = Math.min(p.discountAmount, subtotal);
  const taxRate = boot.settings.taxRate;
  const tax = taxRate > 0 ? roundBaseMoney((subtotal - discount) * taxRate / 100) : 0;
  const total = roundBaseMoney(subtotal - discount + tax);
  const paid = p.paymentMode === "cash" ? total : roundBaseMoney(p.paidNow);
  const due = roundBaseMoney(total - paid);
  return {
    id: p.id, orderNo: null, orderRef: p.id.slice(0, 12), customerId: p.customerId,
    status: due <= 0 ? "completed" : paid > 0 ? "partial" : "unpaid",
    subtotal, discountAmount: discount, discountReason: p.discountReason,
    taxAmount: tax, total, upfrontPaid: paid, paidAmount: paid, dueAmount: due,
    returnedAmount: 0, returnStatus: null, itemsCount: lines.reduce((s, l) => s + l.qty, 0),
    tenderCurrency: p.tenderCurrency, tenderRate: p.tenderRate,
    voidReason: null, voidedAt: null, voidedBy: null, statusBeforeVoid: null,
    userId: boot.posUser.id, createdAt: p.createdAt, lines, queued: true,
  };
}

function applyThemeToDom(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

const initialTheme = ((): Theme => {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "voltage" || saved === "teal" || saved === "oxblood"
    ? saved : "faress";
})();
applyThemeToDom(initialTheme);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [rawBoot, setRawBoot] = useState<BootstrapData | null>(null);
  const [section, setSection] = useState<Section>("pos");
  const [serverReachable, setServerReachable] = useState(true);
  const [offlineSales, setOfflineSales] = useState<OfflineSalePayload[]>(loadQueue);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [cart, setCartState] = useState<CartLine[]>([]);
  const [heldCart, setHeldCart] = useState<CartLine[] | null>(null);
  const toastSeq = useRef(0);
  const syncing = useRef(false);
  const offlineRef = useRef(offlineSales);
  offlineRef.current = offlineSales;

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === "error" ? 6000 : 3500);
  }, []);

  const applyBootstrap = useCallback((data: BootstrapData) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch { /* storage full — cache is best-effort */ }
    setRawBoot(data);
    setServerReachable(true);
  }, []);

  // Merge queued sales ahead of server rows, dropping any the server now has
  // (ports the queued-sale merge, App.tsx:2758).
  const boot = useMemo<BootstrapData | null>(() => {
    if (!rawBoot) return null;
    if (offlineSales.length === 0) return rawBoot;
    const serverIds = new Set(rawBoot.sales.map((s) => s.id));
    const pending = offlineSales.filter((p) => !serverIds.has(p.id));
    if (pending.length === 0) return rawBoot;
    return {
      ...rawBoot,
      sales: [...pending.map((p) => queuedSaleFromPayload(p, rawBoot)), ...rawBoot.sales],
    };
  }, [rawBoot, offlineSales]);

  const reload = useCallback(async () => {
    try {
      const data = await apiRequest<BootstrapData>("GET", "/api/bootstrap");
      applyBootstrap(data);
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) {
        setServerReachable(false);
        const cached = loadCachedBootstrap();
        if (cached) {
          setRawBoot(cached);
          pushToast("info",
            "Working offline from last saved data. Sales will sync when the server is back.");
        }
      } else if (err instanceof ApiError && err.status === 401) {
        setRawBoot(null);
      } else {
        pushToast("error", err instanceof Error ? err.message : "Couldn't load data.");
      }
    } finally {
      setBooted(true);
    }
  }, [applyBootstrap, pushToast]);

  useEffect(() => {
    if (getToken()) void reload();
    else setBooted(true);
    const onAuthExpired = () => setRawBoot(null);
    window.addEventListener("auth-expired", onAuthExpired);
    return () => window.removeEventListener("auth-expired", onAuthExpired);
  }, [reload]);

  const syncOfflineSales = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      let queue = [...offlineRef.current];
      let lastBootstrap: BootstrapData | null = null;
      const stillQueued: OfflineSalePayload[] = [];
      for (const payload of queue) {
        try {
          lastBootstrap = await apiRequest<BootstrapData>("POST", "/api/sales", payload);
        } catch (err) {
          if (err instanceof ApiError && !err.isNetwork) {
            // Rejected by business rules — drop it and tell the operator.
            pushToast("error", `A queued sale was rejected: ${err.message}`);
          } else {
            stillQueued.push(payload);
          }
        }
      }
      setOfflineSales(stillQueued);
      saveQueue(stillQueued);
      if (lastBootstrap) {
        applyBootstrap(lastBootstrap);
        if (stillQueued.length === 0 && queue.length > 0) {
          pushToast("success", "Queued sales synced.");
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [applyBootstrap, pushToast]);

  // Reconnect poll: every 8s while offline or holding a queue (ports App.tsx:2993).
  useEffect(() => {
    if (serverReachable && offlineSales.length === 0) return;
    const timer = window.setInterval(async () => {
      try {
        await apiRequest<unknown>("GET", "/api/health", undefined, { timeoutMs: 4000 });
        setServerReachable(true);
        if (offlineRef.current.length > 0) void syncOfflineSales();
        else if (getToken()) void reload();
      } catch { /* still down */ }
    }, 8000);
    return () => window.clearInterval(timer);
  }, [serverReachable, offlineSales.length, reload, syncOfflineSales]);

  const login = useCallback(async (username: string, pin: string) => {
    const r = await apiRequest<{ token: string; bootstrap: BootstrapData }>(
      "POST", "/api/auth/login", { username, pin });
    setToken(r.token);
    applyBootstrap(r.bootstrap);
  }, [applyBootstrap]);

  const logout = useCallback(async () => {
    try { await apiRequest("POST", "/api/auth/logout"); } catch { /* best effort */ }
    setToken(null);
    setRawBoot(null);
    localStorage.removeItem(CACHE_KEY);
  }, []);

  const mutate = useCallback(async (method: string, path: string, body?: unknown) => {
    try {
      const data = await apiRequest<BootstrapData>(method, path, body);
      applyBootstrap(data);
      return true;
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "That didn't save.");
      return false;
    }
  }, [applyBootstrap, pushToast]);

  const createSale = useCallback(async (payload: OfflineSalePayload) => {
    try {
      const data = await apiRequest<BootstrapData>("POST", "/api/sales", payload);
      applyBootstrap(data);
      return "saved" as const;
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) {
        // Queue offline — replay is idempotent on the client-generated id.
        const queue = [...offlineRef.current, payload];
        setOfflineSales(queue);
        saveQueue(queue);
        setServerReachable(false);
        return "queued" as const;
      }
      pushToast("error", err instanceof Error ? err.message : "Sale failed.");
      return "failed" as const;
    }
  }, [applyBootstrap, pushToast]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    applyThemeToDom(next);
  }, []);

  const setCart = useCallback((updater: (prev: CartLine[]) => CartLine[]) => {
    setCartState(updater);
  }, []);

  const holdCart = useCallback(() => {
    setCartState((current) => {
      if (current.length > 0) setHeldCart(current);
      return [];
    });
  }, []);

  const resumeHeldCart = useCallback(() => {
    setHeldCart((held) => {
      if (held) setCartState(held);
      return null;
    });
  }, []);

  const value = useMemo<AppStateValue>(() => ({
    booted, boot, posUser: boot?.posUser ?? null, settings: boot?.settings ?? null,
    section, setSection, serverReachable, offlineSales,
    login, logout, mutate, createSale, reload, pushToast, toasts,
    theme, setTheme, cart, setCart, heldCart, holdCart, resumeHeldCart,
  }), [booted, boot, section, serverReachable, offlineSales, login, logout, mutate,
       createSale, reload, pushToast, toasts, theme, setTheme, cart, setCart,
       heldCart, holdCart, resumeHeldCart]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppStateValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp outside provider");
  return value;
}
