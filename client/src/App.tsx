import { CloudOff } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { useT } from "./lib/i18n";
import { ConfirmHost } from "./lib/modal";
import { CrmSection } from "./sections/crm/CrmSection";
import { DashboardSection } from "./sections/dashboard/DashboardSection";
import { FinancialSection } from "./sections/financial/FinancialSection";
import { LoginScreen } from "./sections/LoginScreen";
import { OrdersSection } from "./sections/orders/OrdersSection";
import { PosSection } from "./sections/pos/PosSection";
import { PurchasingSection } from "./sections/purchasing/PurchasingSection";
import { ReportsSection } from "./sections/reports/ReportsSection";
import { SettingsSection } from "./sections/settings/SettingsSection";
import { StockSection } from "./sections/stock/StockSection";
import { useApp } from "./state/AppState";

function SyncStatusBar() {
  const { serverReachable, offlineSales } = useApp();
  const { t } = useT();
  if (serverReachable && offlineSales.length === 0) return null;
  return (
    <div className="sync-bar">
      <CloudOff size={16} />
      <span>
        {!serverReachable
          ? t("Working offline from last saved data. Sales will sync when the server is back.")
          : null}
        {offlineSales.length > 0
          ? ` ${offlineSales.length} ${t(offlineSales.length === 1 ? "queued sale" : "queued sales")}`
          : null}
      </span>
    </div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>{toast.text}</div>
      ))}
    </div>
  );
}

const SECTIONS = {
  dashboard: DashboardSection,
  pos: PosSection,
  stock: StockSection,
  purchasing: PurchasingSection,
  crm: CrmSection,
  orders: OrdersSection,
  financial: FinancialSection,
  reports: ReportsSection,
  settings: SettingsSection,
} as const;

export default function App() {
  const { booted, boot, section } = useApp();
  const { dir, lang } = useT();

  if (!booted) {
    return <div className="boot-splash">…</div>;
  }
  if (!boot) {
    return (
      <>
        <LoginScreen />
        <Toasts />
      </>
    );
  }

  const allowed = new Set(boot.posUser.sections);
  const active = allowed.has(section) ? section : boot.posUser.sections[0] ?? "pos";
  const ActiveSection = SECTIONS[active];

  return (
    <div className="app-shell" dir={active === "pos" ? dir : "ltr"} lang={active === "pos" ? lang : "en"}>
      <Sidebar />
      <main className="app-main">
        <SyncStatusBar />
        <ActiveSection />
      </main>
      <Toasts />
      <ConfirmHost />
    </div>
  );
}
