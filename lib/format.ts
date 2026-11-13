const numFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
const wholeFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const centsFmt = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Tam tutarlar kuruşsuz (₺3.240), kuruşlu tutarlar iki haneli (₺3.365,50) yazılır. */
export function money(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0) * 100) / 100;
  return "₺" + (Number.isInteger(v) ? wholeFmt : centsFmt).format(v);
}

export const qty = (n: number) => numFmt.format(Number(n));

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
