import { Footprints } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { useT } from "../lib/i18n";
import { useApp } from "../state/AppState";

interface PublicConfig {
  businessName: string;
  logoUrl: string;
}

export function LoginScreen() {
  const { login } = useApp();
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState<PublicConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<PublicConfig>("GET", "/api/config")
      .then((config) => { if (!cancelled) setBrand(config); })
      .catch(() => { /* offline — generic branding below */ });
    return () => { cancelled = true; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-scene">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          {brand?.logoUrl ? (
            <img className="brand-logo brand-logo-lg" src={brand.logoUrl}
                 alt={brand.businessName} />
          ) : (
            <>
              <span className="brand-mark brand-mark-lg"><Footprints size={42} /></span>
              <h1>{brand?.businessName || "SHOEPOS"}</h1>
            </>
          )}
          <p className="muted">Point of sale &amp; stock</p>
        </div>
        <label className="field">
          <span className="field-label">{t("Username")}</span>
          <input
            className="input"
            value={username}
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("PIN")}</span>
          <input
            className="input input-pin num"
            value={pin}
            type="password"
            inputMode="numeric"
            maxLength={12}
            autoComplete="current-password"
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <button className="btn btn-cta btn-block" disabled={busy || pin.length < 4}>
          {busy ? "…" : t("Sign in")}
        </button>
      </form>
    </div>
  );
}
