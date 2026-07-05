// Mirrors server/app/money.py exactly — client previews must match server results.

export const MONEY_EPSILON = 0.005;

export function roundBaseMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // HALF_UP on the absolute value (matches Python Decimal ROUND_HALF_UP).
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
}

export function roundSecondaryMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) + Number.EPSILON);
}

/** rate = secondary per 1 base (LBP per USD). */
export function toSecondary(baseAmount: number, rate: number): number {
  return roundSecondaryMoney(baseAmount * rate);
}

export function fromSecondary(secondaryAmount: number, rate: number): number {
  if (!rate) return 0;
  return roundBaseMoney(secondaryAmount / rate);
}

export function moneyEq(a: number, b: number): boolean {
  return Math.abs(a - b) < MONEY_EPSILON;
}

const baseFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const wholeFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatBase(amount: number, currency = "USD"): string {
  const sign = amount < 0 ? "-" : "";
  const body = baseFmt.format(Math.abs(roundBaseMoney(amount)));
  return currency === "USD" ? `${sign}$${body}` : `${sign}${body} ${currency}`;
}

/** LBP display, optionally snapped to the display-rounding step (cosmetic only). */
export function formatSecondary(amount: number, currency = "LBP", displayRounding = 1): string {
  let v = roundSecondaryMoney(amount);
  if (displayRounding > 1) v = Math.round(v / displayRounding) * displayRounding;
  const sign = v < 0 ? "-" : "";
  return `${sign}${wholeFmt.format(Math.abs(v))} ${currency}`;
}

/** Format an amount stored in base, shown in the given tender currency. */
export function formatInCurrency(
  baseAmount: number,
  currency: string,
  settings: { baseCurrency: string; secondaryCurrency: string; lbpDisplayRounding: number },
  rate: number,
): string {
  if (currency === settings.baseCurrency) return formatBase(baseAmount, settings.baseCurrency);
  return formatSecondary(toSecondary(baseAmount, rate), settings.secondaryCurrency,
    settings.lbpDisplayRounding);
}
