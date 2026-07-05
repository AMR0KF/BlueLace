// Settings: currency & rate, tax, business profile (+ receipt preview), users &
// PINs, appearance, backup. Each card saves ONLY its own fields (PATCH semantics).
import { Download, KeyRound, UserPlus } from "lucide-react";
import { useState } from "react";
import { getToken } from "../../lib/api";
import { formatBase, formatSecondary, toSecondary } from "../../lib/money";
import { askConfirm } from "../../lib/modal";
import { useApp, type Theme } from "../../state/AppState";
import type { ManagedUser, Role } from "../../types";

const THEME_CARDS: { id: Theme; name: string; blurb: string }[] = [
  { id: "voltage", name: "Voltage", blurb: "Warm stone + electric lime" },
  { id: "teal", name: "Teal", blurb: "Cool calm + deep teal" },
  { id: "oxblood", name: "Oxblood", blurb: "Warm ivory + oxblood red" },
];

export function SettingsSection() {
  const { boot } = useApp();
  if (!boot) return null;
  return (
    <div className="section-page settings-page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <div className="settings-grid">
        <CurrencyCard />
        <TaxCard />
        <BusinessCard />
        <UsersCard />
        <AppearanceCard />
        <BackupCard />
      </div>
    </div>
  );
}

function CurrencyCard() {
  const { boot, mutate, pushToast } = useApp();
  const settings = boot!.settings;
  const [rate, setRate] = useState(String(settings.exchangeRate));
  const [rounding, setRounding] = useState(settings.lbpDisplayRounding);
  const [saving, setSaving] = useState(false);

  const parsed = parseFloat(rate.replace(/,/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0;
  const example = valid
    ? `${formatBase(40, settings.baseCurrency)} = ${formatSecondary(
        toSecondary(40, parsed), settings.secondaryCurrency, rounding)}`
    : "—";

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const ok = await mutate("PUT", "/api/settings",
      { exchangeRate: parsed, lbpDisplayRounding: rounding });
    setSaving(false);
    if (ok) pushToast("success", "Currency settings saved.");
  };

  return (
    <section className="card settings-card">
      <h2 className="card-title">Currency &amp; exchange rate</h2>
      <p className="muted">
        Base currency is <strong>{settings.baseCurrency}</strong> (prices, storage, rounding) —
        <strong> {settings.secondaryCurrency}</strong> is the companion shown alongside.
      </p>
      <label className="field">
        <span className="field-label">
          {settings.secondaryCurrency} per 1 {settings.baseCurrency}
        </span>
        <input className="input num" inputMode="decimal" value={rate}
               onChange={(event) => setRate(event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{settings.secondaryCurrency} display rounding</span>
        <select className="input" value={rounding}
                onChange={(event) => setRounding(Number(event.target.value))}>
          <option value={1}>Exact</option>
          <option value={250}>Nearest 250</option>
          <option value={500}>Nearest 500</option>
          <option value={1000}>Nearest 1,000</option>
        </select>
      </label>
      <p className="settings-example num">{example}</p>
      <div className="card-actions">
        <button className="btn btn-primary" disabled={!valid || saving} onClick={() => void save()}>
          Save
        </button>
      </div>
    </section>
  );
}

function TaxCard() {
  const { boot, mutate, pushToast } = useApp();
  const settings = boot!.settings;
  const [tax, setTax] = useState(String(settings.taxRate));
  const parsed = parseFloat(tax);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  return (
    <section className="card settings-card">
      <h2 className="card-title">Sales tax (VAT)</h2>
      <div className="preset-row">
        {[0, 5, 11, 15].map((preset) => (
          <button key={preset}
                  className={`chip ${parsed === preset ? "chip-active" : ""}`}
                  onClick={() => setTax(String(preset))}>
            {preset}%
          </button>
        ))}
        <input className="input num input-narrow" inputMode="decimal" value={tax}
               onChange={(event) => setTax(event.target.value)} />
      </div>
      <p className="muted">0% hides the tax line at the register.</p>
      <div className="card-actions">
        <button className="btn btn-primary" disabled={!valid}
                onClick={async () => {
                  if (await mutate("PUT", "/api/settings", { taxRate: parsed })) {
                    pushToast("success", "Tax rate saved.");
                  }
                }}>
          Save
        </button>
      </div>
    </section>
  );
}

function BusinessCard() {
  const { boot, mutate, pushToast } = useApp();
  const settings = boot!.settings;
  const [form, setForm] = useState({
    businessName: settings.businessName,
    businessTagline: settings.businessTagline,
    businessPhone: settings.businessPhone,
    businessAddress: settings.businessAddress,
    receiptFooter: settings.receiptFooter,
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  return (
    <section className="card settings-card">
      <h2 className="card-title">Business profile</h2>
      <div className="form-grid">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={form.businessName} onChange={set("businessName")} /></label>
        <label className="field"><span className="field-label">Tagline</span>
          <input className="input" value={form.businessTagline} onChange={set("businessTagline")} /></label>
        <label className="field"><span className="field-label">Phone</span>
          <input className="input" value={form.businessPhone} onChange={set("businessPhone")} /></label>
        <label className="field"><span className="field-label">Address</span>
          <input className="input" value={form.businessAddress} onChange={set("businessAddress")} /></label>
        <label className="field field-span"><span className="field-label">Receipt footer</span>
          <input className="input" value={form.receiptFooter} onChange={set("receiptFooter")} /></label>
      </div>
      <div className="receipt-preview">
        <strong>{form.businessName || "—"}</strong>
        {form.businessTagline ? <span>{form.businessTagline}</span> : null}
        {form.businessPhone ? <span>{form.businessPhone}</span> : null}
        {form.businessAddress ? <span>{form.businessAddress}</span> : null}
        <em>{form.receiptFooter}</em>
      </div>
      <div className="card-actions">
        <button className="btn btn-primary"
                disabled={!form.businessName.trim()}
                onClick={async () => {
                  if (await mutate("PUT", "/api/settings", form)) {
                    pushToast("success", "Business profile saved.");
                  }
                }}>
          Save
        </button>
      </div>
    </section>
  );
}

function UsersCard() {
  const { boot, mutate, pushToast, posUser } = useApp();
  const users = boot!.users;
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [pin, setPin] = useState("");

  const create = async () => {
    if (!name.trim() || pin.length < 4) return;
    if (await mutate("POST", "/api/users", { name: name.trim(), role, pin })) {
      pushToast("success", `User "${name.trim()}" created.`);
      setName(""); setPin("");
    }
  };

  const resetPin = async (target: ManagedUser) => {
    const { ok, reason } = await askConfirm({
      title: `New PIN for ${target.name}`,
      message: "Enter a new 4-12 digit PIN.",
      requireReason: true,
      reasonPlaceholder: "New PIN (digits only)",
      confirmLabel: "Set PIN",
    });
    if (!ok || !reason) return;
    if (!/^\d{4,12}$/.test(reason)) {
      pushToast("error", "PIN must be 4-12 digits.");
      return;
    }
    if (await mutate("PATCH", `/api/users/${target.id}`, { pin: reason })) {
      pushToast("success", `PIN updated for ${target.name}.`);
    }
  };

  return (
    <section className="card settings-card settings-card-wide">
      <h2 className="card-title">Users &amp; access</h2>
      <div className="user-create">
        <input className="input" placeholder="Name (login username)" value={name}
               onChange={(event) => setName(event.target.value)} />
        <select className="input" value={role}
                onChange={(event) => setRole(event.target.value as Role)}>
          <option value="cashier">Cashier</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <input className="input num" placeholder="PIN (4-12 digits)" value={pin}
               inputMode="numeric" maxLength={12}
               onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} />
        <button className="btn btn-primary" onClick={() => void create()}
                disabled={!name.trim() || pin.length < 4}>
          <UserPlus size={16} /> Add
        </button>
      </div>
      <table className="table">
        <thead>
          <tr><th>User</th><th>Role</th><th>Status</th><th className="th-actions" /></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                {user.name}
                {user.isDefaultPin ? <span className="badge badge-warning">Default PIN</span> : null}
              </td>
              <td className="cap">{user.role}</td>
              <td>{user.active
                ? <span className="badge badge-success">Active</span>
                : <span className="badge badge-neutral">Disabled</span>}</td>
              <td className="td-actions">
                <button className="btn btn-sm" onClick={() => void resetPin(user)}>
                  <KeyRound size={14} /> PIN
                </button>
                {user.id !== posUser?.id ? (
                  <button className="btn btn-sm"
                          onClick={() => void mutate("PATCH", `/api/users/${user.id}`,
                            { active: !user.active })}>
                    {user.active ? "Disable" : "Enable"}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useApp();
  return (
    <section className="card settings-card">
      <h2 className="card-title">Appearance</h2>
      <div className="theme-cards">
        {THEME_CARDS.map((card) => (
          <button key={card.id}
                  className={`theme-card theme-preview-${card.id} ${theme === card.id ? "theme-card-active" : ""}`}
                  onClick={() => setTheme(card.id)}>
            <span className="theme-swatches">
              <i className="sw sw-bg" /><i className="sw sw-chrome" /><i className="sw sw-accent" />
            </span>
            <strong>{card.name}</strong>
            <small className="muted">{card.blurb}</small>
          </button>
        ))}
      </div>
      <p className="muted">Theme is per device.</p>
    </section>
  );
}

function BackupCard() {
  const { pushToast } = useApp();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/backup", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) throw new Error("Backup failed.");
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = match?.[1] ?? "shoepos-backup.db";
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      pushToast("success", "Backup downloaded.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card settings-card">
      <h2 className="card-title">Data &amp; backup</h2>
      <p className="muted">
        Downloads a consistent snapshot of the whole database (.db). To restore:
        stop the server and replace <code>server/data/shoepos.db</code> with the file.
      </p>
      <div className="card-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void download()}>
          <Download size={16} /> Download backup
        </button>
      </div>
    </section>
  );
}
