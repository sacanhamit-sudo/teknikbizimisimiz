export interface CatalogRow {
  sku: string;
  name: string;
  unit?: string;
  last_price?: number;
  barcode?: string;
  factory_code?: string;
  stock?: number;
}

type Field = keyof CatalogRow;

const HEADERS: Record<Field, string[]> = {
  sku: ["sku", "stok kodu", "malzeme kodu", "kod"],
  name: ["malzeme adı", "malzeme adi", "ad", "adı", "tanım", "tanim", "malzeme"],
  unit: ["birim"],
  last_price: ["son fiyat", "fiyat", "birim fiyat", "son alış fiyatı"],
  barcode: ["barkod"],
  factory_code: ["fabrika kodu", "fabrika"],
  stock: ["stok", "stok miktarı", "stok miktari", "miktar"],
};

const norm = (v: unknown) => String(v ?? "").trim().toLocaleLowerCase("tr");

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s|₺/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

/** Excel sayfasını (ilk satır başlık) katalog satırlarına çevirir; hatalı satırları raporlar. */
export function parseCatalogSheet(sheet: unknown[][]): { rows: CatalogRow[]; errors: string[] } {
  const errors: string[] = [];
  if (!sheet.length) return { rows: [], errors: ["Dosya boş."] };

  const header = sheet[0].map(norm);
  const col = {} as Record<Field, number>;
  for (const field of Object.keys(HEADERS) as Field[]) {
    col[field] = header.findIndex((h) => HEADERS[field].includes(h));
  }
  if (col.sku < 0) errors.push('"SKU" sütunu bulunamadı.');
  if (col.name < 0) errors.push('"Malzeme Adı" sütunu bulunamadı.');
  if (errors.length) return { rows: [], errors };

  const rows: CatalogRow[] = [];
  sheet.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (f: Field) => (col[f] >= 0 ? r[col[f]] : null);
    const sku = String(cell("sku") ?? "").trim();
    const name = String(cell("name") ?? "").trim();
    if (!sku && !name) return; // boş satır
    if (!sku) return void errors.push(`Satır ${line}: SKU boş.`);
    if (!name) return void errors.push(`Satır ${line}: malzeme adı boş.`);

    const row: CatalogRow = { sku, name };
    const unit = String(cell("unit") ?? "").trim();
    if (unit) row.unit = unit;
    const barcode = String(cell("barcode") ?? "").trim();
    if (barcode) row.barcode = barcode;

    const rawPrice = cell("last_price");
    if (rawPrice != null && rawPrice !== "") {
      const price = toNumber(rawPrice);
      if (price == null || price < 0) return void errors.push(`Satır ${line}: fiyat sayı değil (${rawPrice}).`);
      row.last_price = price;
    }
    const factory = String(cell("factory_code") ?? "").trim();
    const rawStock = cell("stock");
    if (rawStock != null && rawStock !== "") {
      const stock = toNumber(rawStock);
      if (stock == null) return void errors.push(`Satır ${line}: stok sayı değil (${rawStock}).`);
      if (!factory) return void errors.push(`Satır ${line}: stok var ama fabrika kodu boş.`);
      row.stock = stock;
      row.factory_code = factory;
    }
    rows.push(row);
  });
  return { rows, errors };
}
