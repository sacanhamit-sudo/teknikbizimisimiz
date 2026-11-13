export type Role =
  | "technician"
  | "buyer"
  | "plant_manager"
  | "general_manager"
  | "admin";

export type Status =
  | "pending_approval"
  | "sourcing"
  | "purchase_approval"
  | "gm_approval"
  | "approved"
  | "ordered"
  | "delivered"
  | "rejected"
  | "cancelled";

export type Urgency = "normal" | "high" | "critical";

export interface Factory {
  id: string;
  code: string;
  name: string;
  request_approval_limit: number;
  gm_approval_limit: number;
  active: boolean;
}

export interface CostCenter {
  id: string;
  factory_id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface Equipment {
  id: string;
  factory_id: string;
  cost_center_id: string | null;
  name: string;
  active: boolean;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
}

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  last_price: number | null;
  barcode: string | null;
  stock_levels?: { factory_id: string; quantity: number }[];
}

export interface RequestLine {
  id: string;
  item_id: string | null;
  sku: string | null;
  description: string;
  quantity: number;
  unit: string;
  est_unit_price: number;
}

export interface Quote {
  id: string;
  request_id: string;
  supplier_name: string;
  total: number;
  lead_days: number | null;
  note: string;
  created_at: string;
}

export interface RequestEvent {
  id: number;
  kind: string;
  message: string;
  created_at: string;
  actor: { full_name: string } | null;
}

export interface RequestRow {
  id: string;
  code: string;
  factory_id: string;
  requester_id: string;
  urgency: Urgency;
  needed_by: string;
  note: string;
  status: Status;
  estimated_total: number;
  selected_quote_id: string | null;
  po_number: string | null;
  eta: string | null;
  created_at: string;
  updated_at: string;
  requester: { full_name: string } | null;
  factory: { code: string; name: string; request_approval_limit: number; gm_approval_limit: number } | null;
  equipment: { name: string } | null;
  cost_center: { code: string; name: string } | null;
  lines: RequestLine[];
  quotes: Quote[];
}

export const REQUEST_SELECT = `
  id, code, factory_id, requester_id, urgency, needed_by, note, status,
  estimated_total, selected_quote_id, po_number, eta, created_at, updated_at,
  requester:profiles!requests_requester_id_fkey(full_name),
  factory:factories(code, name, request_approval_limit, gm_approval_limit),
  equipment(name),
  cost_center:cost_centers(code, name),
  lines:request_lines(id, item_id, sku, description, quantity, unit, est_unit_price),
  quotes:quotes!quotes_request_id_fkey(id, request_id, supplier_name, total, lead_days, note, created_at)
`;

export const ROLE_LABEL: Record<Role, string> = {
  technician: "Bakım Teknisyeni",
  buyer: "Satınalma Uzmanı",
  plant_manager: "Fabrika Müdürü",
  general_manager: "Genel Müdür",
  admin: "Yönetici",
};

type Tone = "onay" | "teklif" | "siparis" | "teslim" | "red";

export const STATUS: Record<Status, { label: string; tone: Tone }> = {
  pending_approval: { label: "Müdür talep onayında", tone: "onay" },
  sourcing: { label: "Teklif toplanıyor", tone: "teklif" },
  purchase_approval: { label: "Müdür alım kararında", tone: "onay" },
  gm_approval: { label: "Genel Müdür onayında", tone: "onay" },
  approved: { label: "Onaylandı · sipariş bekliyor", tone: "siparis" },
  ordered: { label: "Sipariş verildi", tone: "siparis" },
  delivered: { label: "Teslim edildi", tone: "teslim" },
  rejected: { label: "Reddedildi", tone: "red" },
  cancelled: { label: "İptal edildi", tone: "teslim" },
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  normal: "Normal",
  high: "Yüksek",
  critical: "Kritik",
};

export const CLOSED: Status[] = ["delivered", "rejected", "cancelled"];

export function isLate(r: Pick<RequestRow, "needed_by" | "status">): boolean {
  return !CLOSED.includes(r.status) && r.needed_by < todayISO();
}

export function todayISO(): string {
  const d = new Date();
  return localISO(d);
}

export function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function requestTitle(r: Pick<RequestRow, "lines">): string {
  if (!r.lines.length) return "Talep";
  const first = r.lines[0].description;
  return r.lines.length > 1 ? `${first} +${r.lines.length - 1} kalem` : first;
}
