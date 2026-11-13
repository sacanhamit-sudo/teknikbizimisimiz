const moneyFmt = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const money = (n: number | null | undefined) => "₺" + moneyFmt.format(Number(n ?? 0));

export const qty = (n: number) => moneyFmt.format(Number(n));

/** "2026-11-14" gibi tarih alanlarını yerel gün olarak biçimlendirir. */
export function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
}

export const dateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

/** "1.250,50" veya "1250.5" girişini sayıya çevirir; geçersizse NaN. */
export function parseAmount(s: string): number {
  const t = s.trim().replace(/\s|₺/g, "");
  if (!t) return NaN;
  // Virgül varsa ya da "1.250" / "12.500.000" biçimindeyse noktalar binlik ayırıcıdır
  const thousands = t.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(t);
  const normalized = thousands ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}
