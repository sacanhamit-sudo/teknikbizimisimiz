"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { errText, supabase } from "@/lib/supabase";
import { dateTime, day, money, parseAmount, qty } from "@/lib/format";
import {
  REQUEST_SELECT, STATUS, URGENCY_LABEL, isLate, requestTitle, todayISO,
  type Quote, type RequestEvent, type RequestRow,
} from "@/lib/types";

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const justCreated = useSearchParams().get("yeni") === "1";
  const { profile } = useAuth();
  const [req, setReq] = useState<RequestRow | null>(null);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([
      supabase.from("requests").select(REQUEST_SELECT).eq("id", id).maybeSingle(),
      supabase
        .from("request_events")
        .select("id, kind, message, created_at, actor:profiles(full_name)")
        .eq("request_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ]);
    if (r.error || e.error) {
      setLoadError(errText(r.error ?? e.error));
      return setState("error");
    }
    if (!r.data) return setState("missing");
    setReq(r.data as unknown as RequestRow);
    setEvents(e.data as unknown as RequestEvent[]);
    setState("ready");
  }, [id]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (state === "loading")
    return <main className="page"><p className="muted">Yükleniyor…</p></main>;
  if (state === "error")
    return (
      <main className="page">
        <button className="back" onClick={() => router.push("/")}>← Talepler</button>
        <div className="note-box danger">{loadError} <button className="link-btn" onClick={load}>Tekrar dene</button></div>
      </main>
    );
  if (state === "missing" || !req)
    return (
      <main className="page">
        <button className="back" onClick={() => router.push("/")}>← Talepler</button>
        <div className="empty"><p>Talep bulunamadı ya da görüntüleme yetkiniz yok.</p></div>
      </main>
    );

  const selected = req.quotes.find((q) => q.id === req.selected_quote_id) ?? null;
  const late = isLate(req);
  const showQuotes = profile.role !== "technician" && req.quotes.length > 0 && req.status !== "sourcing";
  const isBuyer = profile.role === "buyer";
  const isOwner = req.requester_id === profile.id;

  return (
    <main className="page">
      <header className="page-head">
        <button className="back" onClick={() => router.push("/")}>← Talepler</button>
        <div className="row between wrap">
          <span className="mono small muted">{req.code}</span>
          <span className={`pill ${STATUS[req.status].tone}`}>{STATUS[req.status].label}</span>
        </div>
        <h1>{requestTitle(req)}</h1>
      </header>

      {justCreated && (
        <p className="note-box" role="status">
          {req.status === "pending_approval"
            ? "Talebiniz Fabrika Müdürü onayına gönderildi. Onaylanınca satınalma masasına düşer."
            : "Talebiniz doğrudan satınalma masasına düştü."}
        </p>
      )}

      <section className="card">
        <dl className="kv">
          <dt>Talep eden</dt><dd>{req.requester?.full_name}</dd>
          <dt>Fabrika</dt><dd>{req.factory?.name}</dd>
          <dt>Ekipman</dt><dd>{req.equipment?.name ?? "—"}</dd>
          <dt>Maliyet merkezi</dt><dd>{req.cost_center?.code} · {req.cost_center?.name}</dd>
          <dt>Aciliyet</dt><dd><span className={`urg ${req.urgency}`}>{URGENCY_LABEL[req.urgency]}</span></dd>
          <dt>İhtiyaç tarihi</dt>
          <dd style={late ? { color: "var(--danger)" } : undefined}>{day(req.needed_by)}{late ? " · gecikti" : ""}</dd>
          {req.po_number && (<><dt>Sipariş no</dt><dd className="mono">{req.po_number}</dd></>)}
          {req.eta && (<><dt>Tahmini teslim</dt><dd>{day(req.eta)}</dd></>)}
        </dl>
        {req.note && (
          <>
            <hr className="divider" style={{ margin: "12px 0" }} />
            <p className="small"><span className="muted">Gerekçe: </span>{req.note}</p>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Kalemler · {req.lines.length}</h2>
        {req.lines.map((l) => (
          <div key={l.id} className="row between" style={{ alignItems: "flex-start" }}>
            <div className="grow">
              <p className="card-title">{l.description}</p>
              <p className="meta mono">
                {l.sku ? l.sku + " · " : ""}{qty(l.quantity)} {l.unit} × {money(l.est_unit_price)}
              </p>
            </div>
            <span className="mono">{money(l.quantity * l.est_unit_price)}</span>
          </div>
        ))}
        <hr className="divider" />
        <div className="row between">
          <span className="muted">Tahmini toplam</span>
          <b className="mono">{money(req.estimated_total)}</b>
        </div>
        {selected && (
          <div className="row between">
            <span className="muted">Seçilen teklif · {selected.supplier_name}</span>
            <b className="mono">{money(selected.total)}</b>
          </div>
        )}
      </section>

      {showQuotes && (
        <section className="stack">
          <h2>Teklifler · {req.quotes.length}</h2>
          <QuoteList quotes={req.quotes} selectedId={req.selected_quote_id} selectedTag="Satınalma önerisi" />
        </section>
      )}

      {/* ── Role ve aşamaya göre işlem paneli ── */}
      {profile.role === "plant_manager" && req.status === "pending_approval" && (
        <DecisionPanel
          title="Talep onayı"
          info={`Tahmini tutar ${money(req.estimated_total)}, ${money(req.factory?.request_approval_limit)} talep limitinin üzerinde.`}
          approveLabel="Talebi onayla"
          snippets={["Aciliyet nedeniyle onaylandı", "Bütçe içinde", "Mevcut parça ile devam edilsin"]}
          onDecide={(decision, note) => supabase.rpc("decide_request", { p_request: req.id, p_decision: decision, p_note: note })}
          onDone={load}
        />
      )}

      {((profile.role === "plant_manager" && req.status === "purchase_approval") ||
        (profile.role === "general_manager" && req.status === "gm_approval")) && selected && (
        <DecisionPanel
          title="Alım kararı"
          info={
            req.status === "purchase_approval" && selected.total > (req.factory?.gm_approval_limit ?? Infinity)
              ? `Tutar ${money(req.factory?.gm_approval_limit)} yetki limitinin üzerinde — onaylarsanız Genel Müdür onayına yükselir.`
              : `${selected.supplier_name} · ${money(selected.total)}`
          }
          approveLabel={
            req.status === "purchase_approval" && selected.total > (req.factory?.gm_approval_limit ?? Infinity)
              ? "Genel Müdür onayına yükselt"
              : `Alımı onayla · ${money(selected.total)}`
          }
          allowRevise
          snippets={["Aciliyet nedeniyle onaylandı", "Bütçe içinde", "Tek teklif yeterli değil", "Alternatif tedarikçi araştırılsın"]}
          onDecide={(decision, note) => supabase.rpc("decide_purchase", { p_request: req.id, p_decision: decision, p_note: note })}
          onDone={load}
        />
      )}

      {isBuyer && req.status === "sourcing" && <SourcingPanel req={req} onDone={load} />}
      {isBuyer && req.status === "approved" && <OrderPanel req={req} onDone={load} />}

      {(isBuyer || isOwner) && req.status === "ordered" && (
        <ActionCard
          title="Teslim"
          text="Malzeme hatta teslim alındıysa talebi kapatın."
          label="Teslim alındı olarak işaretle"
          confirm="Malzemenin teslim alındığını onaylıyor musunuz?"
          run={() => supabase.rpc("mark_delivered", { p_request: req.id })}
          onDone={load}
        />
      )}

      {isBuyer && ["sourcing", "purchase_approval", "gm_approval", "approved", "ordered"].includes(req.status) && (
        <NotePanel requestId={req.id} onDone={load} />
      )}

      {isOwner && ["pending_approval", "sourcing"].includes(req.status) && (
        <ActionCard
          title="Talebi iptal et"
          text="Alım kararına gönderilmeden önce talebinizi iptal edebilirsiniz."
          label="Talebi iptal et"
          danger
          confirm="Bu talebi iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          run={() => supabase.rpc("cancel_request", { p_request: req.id })}
          onDone={load}
        />
      )}

      <section className="card stack">
        <h2>Süreç geçmişi</h2>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <p>{e.message}</p>
              <span className="meta">{dateTime(e.created_at)}{e.actor ? " · " + e.actor.full_name : ""}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

type RpcResult = PromiseLike<{ error: { message: string } | null }>;

function QuoteList({
  quotes, selectedId, selectedTag, onPick, onDelete,
}: {
  quotes: Quote[];
  selectedId: string | null;
  selectedTag: string;
  onPick?: (id: string) => void;
  onDelete?: (q: Quote) => void;
}) {
  const min = Math.min(...quotes.map((q) => q.total));
  return (
    <div className="stack tight">
      {[...quotes].sort((a, b) => a.total - b.total).map((q) => {
        const sel = q.id === selectedId;
        const body = (
          <>
            {onPick && <span className="radio" aria-hidden />}
            <div className="grow">
              <p className="card-title">{q.supplier_name}</p>
              <p className="meta">
                {q.lead_days != null ? `Teslim ${q.lead_days} gün` : "Teslim süresi belirtilmedi"}
                {q.note ? " · " + q.note : ""}
              </p>
              <span className={"tag" + (sel ? " accent" : "")}>
                {sel ? selectedTag : q.total === min && quotes.length > 1 ? "En uygun fiyat" : ""}
              </span>
            </div>
            <b className="mono">{money(q.total)}</b>
          </>
        );
        return (
          <div key={q.id} className="stack tight">
            {onPick ? (
              <button type="button" className={"quote" + (sel ? " selected" : "")} aria-pressed={sel} onClick={() => onPick(q.id)}>
                {body}
              </button>
            ) : (
              <div className={"quote" + (sel ? " selected" : "")}>{body}</div>
            )}
            {onDelete && (
              <button className="link-btn danger" style={{ alignSelf: "flex-end" }} onClick={() => onDelete(q)}>
                {q.supplier_name} teklifini sil
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DecisionPanel({
  title, info, approveLabel, allowRevise, snippets, onDecide, onDone,
}: {
  title: string;
  info: string;
  approveLabel: string;
  allowRevise?: boolean;
  snippets: string[];
  onDecide: (decision: "approve" | "reject" | "revise", note: string) => RpcResult;
  onDone: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "reject" | "revise") {
    setError("");
    if (decision === "reject" && !note.trim()) return setError("Reddetmek için karar notu yazın.");
    if (decision === "reject" && !window.confirm("Reddetmek istediğinize emin misiniz?")) return;
    setBusy(true);
    const { error } = await onDecide(decision, note.trim());
    if (error) setError(errText(error));
    else await onDone();
    setBusy(false);
  }

  return (
    <section className="card stack" style={{ borderColor: "var(--accent)" }}>
      <h2>{title}</h2>
      <p className="small">{info}</p>
      <label className="field">
        <span>Karar notu</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ret için zorunlu" />
      </label>
      <div className="chips wrap">
        {snippets.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => setNote((n) => (n ? n.trimEnd() + " " : "") + s + ".")}>
            {s}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => decide("approve")}>{approveLabel}</button>
      <div className="row">
        {allowRevise && (
          <button className="btn grow" disabled={busy} onClick={() => decide("revise")}>Ek teklif iste</button>
        )}
        <button className="btn danger grow" disabled={busy} onClick={() => decide("reject")}>Reddet</button>
      </div>
    </section>
  );
}

function SourcingPanel({ req, onDone }: { req: RequestRow; onDone: () => Promise<void> }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(req.quotes.length === 0);
  const [supplier, setSupplier] = useState("");
  const [total, setTotal] = useState("");
  const [lead, setLead] = useState("");
  const [qNote, setQNote] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickedQuote = req.quotes.find((q) => q.id === picked) ?? null;
  const gmLimit = req.factory?.gm_approval_limit ?? Infinity;

  async function run(fn: () => RpcResult) {
    setBusy(true);
    setError("");
    const { error } = await fn();
    if (error) setError(errText(error));
    else await onDone();
    setBusy(false);
    return !error;
  }

  async function addQuote(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(total);
    const days = lead.trim() ? Number(lead) : null;
    if (!supplier.trim()) return setError("Tedarikçi adını yazın.");
    if (!(amount > 0)) return setError("Teklif toplam tutarını yazın.");
    if (days != null && !(Number.isInteger(days) && days >= 0)) return setError("Teslim süresi gün olarak tam sayı olmalı.");
    const ok = await run(() =>
      supabase.rpc("add_quote", {
        p_request: req.id, p_supplier: supplier, p_total: amount, p_lead_days: days, p_note: qNote.trim(),
      }),
    );
    if (ok) {
      setSupplier(""); setTotal(""); setLead(""); setQNote("");
      setFormOpen(false);
    }
  }

  return (
    <section className="card stack" style={{ borderColor: "var(--accent)" }}>
      <h2>Teklifler · {req.quotes.length}</h2>
      {req.quotes.length === 0 && <p className="small muted">Henüz teklif girilmedi. Tedarikçilerden gelen teklifleri ekleyin.</p>}
      {req.quotes.length > 0 && (
        <QuoteList
          quotes={req.quotes}
          selectedId={picked}
          selectedTag="Seçili tedarikçi"
          onPick={setPicked}
          onDelete={(q) => {
            if (!window.confirm(`${q.supplier_name} teklifini silmek istiyor musunuz?`)) return;
            if (picked === q.id) setPicked(null);
            run(() => supabase.rpc("delete_quote", { p_quote: q.id }));
          }}
        />
      )}

      {formOpen ? (
        <form className="stack" onSubmit={addQuote}>
          <hr className="divider" />
          <label className="field">
            <span>Tedarikçi</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Toplam tutar (₺)</span>
              <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
            </label>
            <label className="field">
              <span>Teslim (gün)</span>
              <input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Not (garanti, KDV, vade…)</span>
            <input value={qNote} onChange={(e) => setQNote(e.target.value)} />
          </label>
          <p className="meta">Tutar, talepteki tüm kalemler için toplam teklif bedelidir.</p>
          <div className="row">
            {req.quotes.length > 0 && <button type="button" className="btn" onClick={() => setFormOpen(false)}>Vazgeç</button>}
            <button className="btn dark grow" disabled={busy}>Teklifi kaydet</button>
          </div>
        </form>
      ) : (
        <button className="btn" onClick={() => setFormOpen(true)}>+ Teklif ekle</button>
      )}

      {req.quotes.length > 0 && (
        <>
          <hr className="divider" />
          <label className="field">
            <span>Satınalma görüşü (isteğe bağlı)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tedarikçi seçim gerekçesi" />
          </label>
          <p className={"note-box" + (pickedQuote ? "" : " warn")}>
            {pickedQuote
              ? `Seçili tedarikçi: ${pickedQuote.supplier_name} — onaya ${money(pickedQuote.total)} gider.` +
                (pickedQuote.total > gmLimit ? ` ${money(gmLimit)} üzeri olduğu için Fabrika Müdüründen sonra Genel Müdür onayı da gerekir.` : "")
              : "Alım kararına göndermek için bir tedarikçi seçin."}
          </p>
          <button
            className="btn primary"
            disabled={busy || !pickedQuote}
            onClick={() => run(() => supabase.rpc("submit_purchase", { p_request: req.id, p_quote: picked, p_note: note.trim() }))}
          >
            Fabrika Müdürü alım kararına gönder
          </button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function OrderPanel({ req, onDone }: { req: RequestRow; onDone: () => Promise<void> }) {
  const [po, setPo] = useState("");
  const [eta, setEta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!po.trim()) return setError("Sipariş numarasını yazın.");
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("place_order", { p_request: req.id, p_po_number: po, p_eta: eta || null });
    if (error) setError(errText(error));
    else await onDone();
    setBusy(false);
  }

  return (
    <form className="card stack" style={{ borderColor: "var(--accent)" }} onSubmit={submit}>
      <h2>Sipariş</h2>
      <p className="small">Alım onaylandı. Siparişi tedarikçiye geçtikten sonra bilgileri kaydedin.</p>
      <label className="field">
        <span>Sipariş no</span>
        <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="Örn. SAS-2026-0418" />
      </label>
      <label className="field">
        <span>Tahmini teslim tarihi</span>
        <input type="date" min={todayISO()} value={eta} onChange={(e) => setEta(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>Sipariş verildi olarak kaydet</button>
    </form>
  );
}

function NotePanel({ requestId, onDone }: { requestId: string; onDone: () => Promise<void> }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const snippets = ["Tedarikçi teyit etti", "Kargoya verildi", "Fiyat revize bekleniyor", "Alternatif ürün önerildi"];

  async function save() {
    if (!msg.trim()) return setError("Not yazın.");
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("add_note", { p_request: requestId, p_message: msg });
    if (error) setError(errText(error));
    else {
      setMsg("");
      await onDone();
    }
    setBusy(false);
  }

  return (
    <section className="card stack">
      <h2>Süreç notu</h2>
      <label className="field">
        <span>Talep sahibine bildirilecek güncelleme</span>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} />
      </label>
      <div className="chips wrap">
        {snippets.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => setMsg((n) => (n ? n.trimEnd() + " " : "") + s + ".")}>
            {s}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy} onClick={save}>Notu kaydet ve bildir</button>
    </section>
  );
}

function ActionCard({
  title, text, label, danger, confirm, run, onDone,
}: {
  title: string;
  text: string;
  label: string;
  danger?: boolean;
  confirm: string;
  run: () => RpcResult;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="card stack">
      <h2>{title}</h2>
      <p className="small muted">{text}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button
        className={"btn " + (danger ? "danger" : "primary")}
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(confirm)) return;
          setBusy(true);
          setError("");
          const { error } = await run();
          if (error) setError(errText(error));
          else await onDone();
          setBusy(false);
        }}
      >
        {label}
      </button>
    </section>
  );
}
