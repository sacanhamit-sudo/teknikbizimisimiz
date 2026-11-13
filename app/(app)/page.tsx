"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { errText, supabase } from "@/lib/supabase";
import { day, money } from "@/lib/format";
import {
  CLOSED, REQUEST_SELECT, ROLE_LABEL, STATUS, URGENCY_LABEL, isLate, requestTitle,
  type RequestRow, type Role,
} from "@/lib/types";

interface Filter {
  label: string;
  test: (r: RequestRow) => boolean;
}

const open = (r: RequestRow) => !CLOSED.includes(r.status);

const FILTERS: Record<Role, Filter[]> = {
  technician: [
    { label: "Açık", test: open },
    { label: "Onayda", test: (r) => ["pending_approval", "purchase_approval", "gm_approval"].includes(r.status) },
    { label: "Tedarikte", test: (r) => ["sourcing", "approved", "ordered"].includes(r.status) },
    { label: "Kritik", test: (r) => open(r) && r.urgency === "critical" },
    { label: "Tümü", test: () => true },
  ],
  buyer: [
    { label: "Yeni düşen", test: (r) => r.status === "sourcing" && r.quotes.length === 0 },
    { label: "Teklif toplanıyor", test: (r) => r.status === "sourcing" && r.quotes.length > 0 },
    { label: "Onayda", test: (r) => ["purchase_approval", "gm_approval"].includes(r.status) },
    { label: "Sipariş bekleyen", test: (r) => r.status === "approved" },
    { label: "Siparişte", test: (r) => r.status === "ordered" },
    { label: "Geciken", test: isLate },
    { label: "Tümü", test: () => true },
  ],
  plant_manager: [
    { label: "Talep onayı", test: (r) => r.status === "pending_approval" },
    { label: "Alım kararı", test: (r) => r.status === "purchase_approval" },
    { label: "Açık", test: open },
    { label: "Tümü", test: () => true },
  ],
  general_manager: [
    { label: "Onay bekleyen", test: (r) => r.status === "gm_approval" },
    { label: "Açık", test: open },
    { label: "Tümü", test: () => true },
  ],
  admin: [
    { label: "Açık", test: open },
    { label: "Geciken", test: isLate },
    { label: "Tümü", test: () => true },
  ],
};

const EMPTY: Record<Role, string> = {
  technician: "Henüz talebiniz yok. İlk talebinizi oluşturun.",
  buyer: "Bu filtrede bekleyen iş yok.",
  plant_manager: "Onayınızı bekleyen kayıt yok.",
  general_manager: "Onayınızı bekleyen alım yok.",
  admin: "Kayıt yok.",
};

export default function RequestsPage() {
  const { profile, factories } = useAuth();
  const filters = FILTERS[profile.role];
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(filters[0].label);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("requests")
      .select(REQUEST_SELECT)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setError(errText(error));
    else {
      setError("");
      setRows(data as unknown as RequestRow[]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const f = filters.find((x) => x.label === filter) ?? filters[0];
    const q = query.trim().toLocaleLowerCase("tr");
    return rows.filter(f.test).filter((r) => {
      if (!q) return true;
      return [r.code, r.requester?.full_name, r.equipment?.name, ...r.lines.flatMap((l) => [l.description, l.sku])]
        .some((s) => s?.toLocaleLowerCase("tr").includes(q));
    });
  }, [rows, filters, filter, query]);

  const stats = rows && {
    open: rows.filter(open).length,
    waiting: rows.filter(filters[0].test).length,
    late: rows.filter(isLate).length,
  };
  const canCreate = profile.role === "technician" || profile.role === "admin";
  const multiFactory = factories.length > 1;

  return (
    <main className="page">
      <header className="page-head">
        <span className="eyebrow">{ROLE_LABEL[profile.role]}</span>
        <h1>Talepler</h1>
      </header>

      {stats && (
        <div className="stats">
          <div className="stat"><b>{stats.open}</b><span>Açık talep</span></div>
          <div className="stat"><b>{stats.waiting}</b><span>{filters[0].label}</span></div>
          <div className={"stat" + (stats.late ? " alert" : "")}><b>{stats.late}</b><span>Geciken</span></div>
        </div>
      )}

      <input
        className="input"
        type="search"
        placeholder="Talep no, malzeme, SKU veya kişi ara"
        aria-label="Taleplerde ara"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="chips" role="group" aria-label="Filtre">
        {filters.map((f) => (
          <button key={f.label} className="chip" aria-pressed={filter === f.label} onClick={() => setFilter(f.label)}>
            {f.label}
            {rows && <span className="count">{rows.filter(f.test).length}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="note-box danger">
          {error} <button className="link-btn" onClick={load}>Tekrar dene</button>
        </div>
      )}
      {!rows && !error && <p className="muted">Yükleniyor…</p>}

      {rows && visible.length === 0 && (
        <div className="empty">
          <p>{query ? "Aramanızla eşleşen talep yok." : rows.length === 0 ? EMPTY[profile.role] : "Bu filtrede talep yok."}</p>
          {canCreate && rows.length === 0 && <Link className="btn primary" href="/yeni">Yeni talep oluştur</Link>}
        </div>
      )}

      <div className="stack">
        {visible.map((r) => {
          const late = isLate(r);
          const selected = r.quotes.find((q) => q.id === r.selected_quote_id);
          return (
            <Link key={r.id} href={`/talep/${r.id}`} className={"card stack tight" + (late ? " late" : "")}>
              <div className="row between">
                <span className="mono small muted">
                  {r.code}{multiFactory && r.factory ? ` · ${r.factory.code}` : ""}
                </span>
                <span className={`pill ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
              </div>
              <p className="card-title">{requestTitle(r)}</p>
              <div className="row between wrap">
                <span className={`urg ${r.urgency}`}>{URGENCY_LABEL[r.urgency]}</span>
                <span className="meta">{r.equipment?.name ?? r.cost_center?.name}</span>
              </div>
              <div className="row between wrap">
                <span className="meta" style={late ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                  İhtiyaç {day(r.needed_by)}{late ? " · gecikti" : ""}
                </span>
                <span className="mono small">
                  {selected ? money(selected.total) : "≈ " + money(r.estimated_total)}
                </span>
              </div>
              {profile.role !== "technician" && (
                <span className="meta">
                  {r.requester?.full_name}
                  {r.status === "sourcing" ? ` · ${r.quotes.length} teklif` : ""}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {canCreate && <Link className="fab" href="/yeni">+ Yeni talep</Link>}
    </main>
  );
}
