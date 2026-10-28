// How numbers and dates are shown to people.

/** 1234.5 -> "₹1,234.50", -0.4 -> "−₹0.40" */
export const rupees = (n: number) =>
  (n < 0 ? '−₹' : '₹') + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What you'd type into a UPI app: "466.65". */
export const plainAmount = (n: number) => n.toFixed(2);

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** 0.5 -> "½", 2.5 -> "2½", 0.33 -> "0.33" */
export function fmtUnits(n: number): string {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  if (frac === 0) return String(whole);
  if (frac === 0.5) return whole ? `${whole}½` : '½';
  return n.toFixed(2).replace(/0+$/, '');
}
