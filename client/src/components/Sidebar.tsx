import {
  BarChart3, Boxes, Footprints, LayoutDashboard, Menu,
  Settings as SettingsIcon, ShoppingCart, Store, Truck, Users, Wallet, X,
} from "lucide-react";
import { useState } from "react";
import { useT } from "../lib/i18n";
import { useBodyScrollLock, useEscapeKey } from "../lib/modal";
import { useApp, type Theme } from "../state/AppState";
import type { Section } from "../types";

const NAV: { section: Section; label: string; icon: React.ReactNode }[] = [
  { section: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={19} /> },
  { section: "pos", label: "Point of Sale", icon: <Store size={19} /> },
  { section: "stock", label: "Stock", icon: <Boxes size={19} /> },
  { section: "purchasing", label: "Purchasing", icon: <Truck size={19} /> },
  { section: "crm", label: "Customers", icon: <Users size={19} /> },
  { section: "orders", label: "Orders", icon: <ShoppingCart size={19} /> },
  { section: "financial", label: "Financial", icon: <Wallet size={19} /> },
  { section: "reports", label: "Reports", icon: <BarChart3 size={19} /> },
  { section: "settings", label: "Settings", icon: <SettingsIcon size={19} /> },
];

const THEMES: Theme[] = ["faress", "voltage", "teal", "oxblood"];

export function Sidebar() {
  const { boot, section, setSection, logout, theme, setTheme } = useApp();
  const { t, lang, setLang } = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Same overlay manners as modals: freeze the page and close on Escape.
  useBodyScrollLock(drawerOpen);
  useEscapeKey(() => setDrawerOpen(false), drawerOpen);
  if (!boot) return null;
  const allowed = new Set(boot.posUser.sections);
  const items = NAV.filter((item) => allowed.has(item.section));
  const auditDanger = boot.auditChecks.filter((c) => c.severity === "danger").length;

  const nav = (
    <>
      <div className="sidebar-brand">
        {boot.settings.logoUrl ? (
          <img className="brand-logo" src={boot.settings.logoUrl}
               alt={boot.settings.businessName} />
        ) : (
          <>
            <span className="brand-mark"><Footprints size={22} /></span>
            <span className="brand-name">{boot.settings.businessName}</span>
          </>
        )}
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <button
            key={item.section}
            className={`nav-item ${section === item.section ? "nav-active" : ""}`}
            onClick={() => { setSection(item.section); setDrawerOpen(false); }}
          >
            {item.icon}
            <span>{t(item.label)}</span>
            {item.section === "financial" && auditDanger > 0 ? (
              <em className="nav-alert">{auditDanger}</em>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="theme-dots" role="group" aria-label={t("Theme")}>
          {THEMES.map((name) => (
            <button
              key={name}
              className={`theme-dot dot-${name} ${theme === name ? "dot-active" : ""}`}
              title={name}
              onClick={() => setTheme(name)}
            />
          ))}
        </div>
        <button className="lang-toggle" onClick={() => setLang(lang === "en" ? "ar" : "en")}>
          {lang === "en" ? "عربي" : "EN"}
        </button>
        <div className="sidebar-user">
          <span className="user-name">{boot.posUser.name}</span>
          <span className="user-role">{boot.posUser.role}</span>
        </div>
        <button className="btn btn-ghost btn-signout" onClick={() => void logout()}>
          {t("Sign out")}
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="sidebar">{nav}</aside>
      <button className="mobile-menu-btn" onClick={() => setDrawerOpen(true)}
              aria-label="Menu">
        <Menu size={22} />
      </button>
      {drawerOpen ? (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <aside className="sidebar sidebar-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)}
                    aria-label="Close">
              <X size={20} />
            </button>
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}
