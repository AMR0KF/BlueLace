// Small shared UI atoms: dual-currency amounts, badges, meters, money input.
import { useEffect, useState } from "react";
import { formatBase, formatSecondary, roundBaseMoney, toSecondary } from "../lib/money";
import type { SaleStatus, Settings } from "../types";

export function DualAmount({
  amount, settings, rate, primary, className = "",
}: {
  amount: number;               // base currency
  settings: Settings;
  rate?: number | null;         // frozen rate; falls back to current
  primary?: string;             // which currency leads (default base)
  className?: string;
}) {
  const useRate = rate ?? settings.exchangeRate;
  const inBase = formatBase(amount, settings.baseCurrency);
  const inSecondary = formatSecondary(
    toSecondary(amount, useRate), settings.secondaryCurrency, settings.lbpDisplayRounding);
  const leadSecondary = primary === settings.secondaryCurrency;
  return (
    <span className={`dual-amount ${className}`}>
      <strong className="num">{leadSecondary ? inSecondary : inBase}</strong>
      <small className="num muted">{leadSecondary ? inBase : inSecondary}</small>
    </span>
  );
}

const STATUS_LABEL: Record<SaleStatus, string> = {
  completed: "Paid", partial: "Partial", unpaid: "Unpaid", voided: "Voided",
};
const STATUS_CLASS: Record<SaleStatus, string> = {
  completed: "badge-success", partial: "badge-warning", unpaid: "badge-danger",
  voided: "badge-neutral",
};

export function StatusBadge({ status }: { status: SaleStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Badge({ kind, children }: {
  kind: "success" | "warning" | "danger" | "neutral" | "info";
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

/** Slim meter that shifts charcoal -> amber -> rose across thresholds. */
export function Meter({ value, max, warnAt = 0.75, dangerAt = 1 }: {
  value: number; max: number; warnAt?: number; dangerAt?: number;
}) {
  const ratio = max > 0 ? Math.min(value / max, 1.25) : 0;
  const tone = ratio >= dangerAt ? "danger" : ratio >= warnAt ? "warn" : "ok";
  return (
    <div className="meter">
      <div className={`meter-fill meter-${tone}`}
           style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
    </div>
  );
}

/** Numeric money input that tolerates partial typing and commits parsed values. */
export function MoneyInput({
  value, onCommit, className = "", placeholder, autoFocus, max,
}: {
  value: number;
  onCommit: (v: number) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  max?: number;
}) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => {
    setText(value ? String(value) : "");
  }, [value]);
  const commit = () => {
    let parsed = parseFloat(text.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) parsed = 0;
    if (max !== undefined) parsed = Math.min(parsed, max);
    onCommit(roundBaseMoney(parsed));
    setText(parsed ? String(roundBaseMoney(parsed)) : "");
  };
  return (
    <input
      className={`input num ${className}`}
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? "0"}
      autoFocus={autoFocus}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** type="number" inputs silently change value on scroll wheel while focused —
 *  blur on wheel so scrolling a modal can never edit a quantity. */
export function blurOnWheel(event: React.WheelEvent<HTMLInputElement>): void {
  event.currentTarget.blur();
}

export function EmptyState({ icon, title, hint }: {
  icon?: React.ReactNode; title: string; hint?: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <p className="empty-title">{title}</p>
      {hint ? <p className="empty-hint">{hint}</p> : null}
    </div>
  );
}

export function timeLabel(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}
