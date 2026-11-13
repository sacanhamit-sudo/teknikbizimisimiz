"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { errText, supabase } from "@/lib/supabase";
import { day, money, parseAmount, qty as fmtQty } from "@/lib/format";
import {
  URGENCY_LABEL, localISO, todayISO,
  type CatalogItem, type CostCenter, type Equipment, type Urgency,
} from "@/lib/types";

interface Line {
  item_id: string | null;
  sku: string | null;
  description: string;
  quantity: number;
  unit: string;
  est_unit_price: number;
}

interface Draft {
  item: CatalogItem | null; // null = serbest tanım
  description: string;
  quantity: string;
  unit: string;
  price: string;
}

interface Saved {
  factoryId: string;
  lines: Line[];
  costCenterId: string;
  equipmentId: string;
  neededBy: string;
  urgency: Urgency;
  note: string;
}

/** Yarım kalan talep bu cihazda saklanır; bağlantı kesilse ya da sayfa kapansa da kaybolmaz. */
function readSaved(key: string): Partial<Saved> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v === "object" && Array.isArray(v.lines) ? v : {};
  } catch {
    return {};
  }
}

const STEP_NAMES = ["Malzeme", "Detay", "Özet"];
const UNITS = ["adet", "takım", "L", "kg", "m"];

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localISO(d);
}

export default function NewRequestPage() {
  const { factories, profile } = useAuth();
  const router = useRouter();
  const savedKey = "talep-taslak-" + profile.id;
  const [saved] = useState(() => readSaved(savedKey));
  const restored = !!saved.lines?.length;
  const [step, setStep] = useState(0);
  const [factoryId, setFactoryId] = useState(
    saved.factoryId && factories.some((f) => f.id === saved.factoryId)
      ? saved.factoryId
      : factories.length === 1 ? factories[0].id : "",
  );
  const factory = factories.find((f) => f.id === factoryId);

  // 1 · Malzeme
  const [lines, setLines] = useState<Line[]>(saved.lines ?? []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogItem[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  // 2 · Detay
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [costCenterId, setCostCenterId] = useState(saved.costCenterId ?? "");
  const [equipmentId, setEquipmentId] = useState(saved.equipmentId ?? "");
  const [neededBy, setNeededBy] = useState(
    saved.neededBy && saved.neededBy >= todayISO() ? saved.neededBy : addDays(3),
  );
  const [urgency, setUrgency] = useState<Urgency>(saved.urgency ?? "normal");
  const [note, setNote] = useState(saved.note ?? "");
  const [showRestored, setShowRestored] = useState(restored);

  useEffect(() => {
    try {
      if (lines.length) {
        const draft: Saved = { factoryId, lines, costCenterId, equipmentId, neededBy, urgency, note };
        localStorage.setItem(savedKey, JSON.stringify(draft));
      } else localStorage.removeItem(savedKey);
    } catch {}
  }, [savedKey, factoryId, lines, costCenterId, equipmentId, neededBy, urgency, note]);

  function discard() {
    setLines([]);
    setCostCenterId(costCenters.length === 1 ? costCenters[0].id : "");
    setEquipmentId("");
    setNeededBy(addDays(3));
    setUrgency("normal");
    setNote("");
    setStep(0);
    setShowRestored(false);
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Fabrikaya bağlı maliyet merkezi ve ekipmanlar
  useEffect(() => {
    if (!factoryId) return;
    let stale = false;
    (async () => {
      const [cc, eq] = await Promise.all([
        supabase.from("cost_centers").select("*").eq("factory_id", factoryId).eq("active", true).order("code"),
        supabase.from("equipment").select("*").eq("factory_id", factoryId).eq("active", true).order("name"),
      ]);
      if (stale) return;
      const ccs = (cc.data ?? []) as CostCenter[];
      setCostCenters(ccs);
      const eqs = (eq.data ?? []) as Equipment[];
      setEquipment(eqs);
      // Taslaktan gelen seçimler bu fabrikada geçerliyse korunur
      setCostCenterId((cur) => (ccs.some((c) => c.id === cur) ? cur : ccs.length === 1 ? ccs[0].id : ""));
      setEquipmentId((cur) => (eqs.some((e) => e.id === cur) ? cur : ""));
    })();
    return () => {
      stale = true;
    };
  }, [factoryId]);

  // Katalog araması
  useEffect(() => {
    const q = query.trim();
    let stale = false;
    const t = setTimeout(async () => {
      let req = supabase
        .from("catalog_items")
        .select("id, sku, name, unit, last_price, barcode, stock_levels(factory_id, quantity)")
        .eq("active", true)
        .order("name")
        .limit(25);
      if (q) {
        const safe = q.replace(/[%,()\\]/g, " ");
        req = req.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
      }
      const { data, error } = await req;
      if (stale) return;
      if (error) setSearchError(errText(error));
      else {
        setSearchError("");
        setResults(data as CatalogItem[]);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query]);

  const total = useMemo(
    () => lines.reduce((s, l) => s + Math.round(l.quantity * l.est_unit_price * 100) / 100, 0),
    [lines],
  );
  const needsApproval = !!factory && total > factory.request_approval_limit;

  function stockOf(item: CatalogItem): number | null {
    const s = item.stock_levels?.find((x) => x.factory_id === factoryId);
    return s ? Number(s.quantity) : null;
  }

  function pick(item: CatalogItem | null) {
    setDraftError("");
    setScanMsg("");
    setDraft({
      item,
      description: item ? item.name : query.trim(),
      quantity: "1",
      unit: item?.unit ?? "adet",
      price: item?.last_price != null ? String(item.last_price).replace(".", ",") : "",
    });
  }

  async function onScanned(code: string) {
    setScanning(false);
    const safe = code.trim();
    const { data, error } = await supabase
      .from("catalog_items")
      .select("id, sku, name, unit, last_price, barcode, stock_levels(factory_id, quantity)")
      .or(`barcode.eq."${safe.replace(/"/g, "")}",sku.eq."${safe.replace(/"/g, "")}"`)
      .eq("active", true)
      .limit(1);
    if (error) return setScanMsg(errText(error));
    if (data?.length) pick(data[0] as CatalogItem);
    else {
      setQuery(safe);
      setScanMsg(`"${safe}" katalogda bulunamadı. Arayabilir veya serbest tanımla ekleyebilirsiniz.`);
    }
  }

  function addLine() {
    if (!draft) return;
    const q = parseAmount(draft.quantity);
    const p = parseAmount(draft.price);
    if (!draft.description.trim()) return setDraftError("Malzeme tanımı yazın.");
    if (!(q > 0)) return setDraftError("Miktar sıfırdan büyük olmalı.");
    if (Number.isNaN(p)) return setDraftError("Tahmini birim fiyatı yazın (bilmiyorsanız 0).");
    setLines((ls) => [
      ...ls,
      {
        item_id: draft.item?.id ?? null,
        sku: draft.item?.sku ?? null,
        description: draft.description.trim(),
        quantity: q,
        unit: draft.unit,
        est_unit_price: p,
      },
    ]);
    setDraft(null);
    setQuery("");
    setError("");
  }

  function next() {
    setError("");
    if (step === 0) {
      if (!factoryId) return setError("Önce fabrikayı seçin.");
      if (!lines.length) return setError("En az bir malzeme ekleyin.");
    }
    if (step === 1) {
      if (!costCenterId) return setError("Maliyet merkezini seçin.");
      if (!neededBy || neededBy < todayISO()) return setError("İhtiyaç tarihi bugün veya sonrası olmalı.");
    }
    setStep(step + 1);
  }

  async function submit() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("create_request", {
      p_factory: factoryId,
      p_cost_center: costCenterId,
      p_equipment: equipmentId || null,
      p_urgency: urgency,
      p_needed_by: neededBy,
      p_note: note.trim(),
      p_lines: lines,
    });
    if (error) {
      setError(errText(error) + " Talebiniz bu cihazda taslak olarak duruyor; bağlantı gelince tekrar gönderebilirsiniz.");
      setBusy(false);
      return;
    }
    try {
      localStorage.removeItem(savedKey);
    } catch {}
    router.replace(`/talep/${data}?yeni=1`);
  }

  if (!factories.length)
    return (
      <main className="page">
        <button className="back" onClick={() => router.push("/")}>← Talepler</button>
        <div className="empty">
          <p>Hesabınız henüz bir fabrikaya atanmamış. Talep açabilmek için sistem yöneticinize başvurun.</p>
        </div>
      </main>
    );

  return (
    <main className="page" style={{ paddingBottom: 96 }}>
      <header className="page-head">
        <button className="back" onClick={() => (step === 0 ? router.push("/") : setStep(step - 1))}>
          ← {step === 0 ? "Vazgeç" : "Geri"}
        </button>
        <span className="eyebrow">Yeni talep · Adım {step + 1}/3</span>
        <h1>{STEP_NAMES[step]}</h1>
        <div className="steps" aria-hidden>
          {STEP_NAMES.map((_, i) => <span key={i} className={i <= step ? "on" : ""} />)}
        </div>
      </header>

      {showRestored && (
        <p className="note-box" role="status">
          Yarım kalan talebiniz geri yüklendi.{" "}
          <button className="link-btn danger" onClick={discard}>Taslağı sil</button>
        </p>
      )}

      {step === 0 && (
        <>
          {factories.length > 1 && (
            <label className="field">
              <span>Fabrika</span>
              <select
                value={factoryId}
                onChange={(e) => setFactoryId(e.target.value)}
                disabled={lines.length > 0}
              >
                <option value="">Seçin…</option>
                {factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}

          {lines.length > 0 && (
            <section className="card stack">
              <div className="row between">
                <h2>Talep kalemleri · {lines.length}</h2>
                <span className="mono">{money(total)}</span>
              </div>
              {lines.map((l, i) => (
                <div key={i} className="row between" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <p className="card-title">{l.description}</p>
                    <p className="meta mono">
                      {fmtQty(l.quantity)} {l.unit} × {money(l.est_unit_price)}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p className="mono">{money(l.quantity * l.est_unit_price)}</p>
                    <button className="link-btn danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      Kaldır
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {draft ? (
            <section className="card stack">
              <div>
                <h2>{draft.item ? "Seçilen malzeme" : "Serbest tanım"}</h2>
                {draft.item && <p className="meta mono">{draft.item.sku}</p>}
              </div>
              <label className="field">
                <span>Malzeme tanımı</span>
                <input
                  value={draft.description}
                  readOnly={!!draft.item}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
              <div className="grid-2">
                <div className="field">
                  <span id="qty-label">Miktar</span>
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label="Azalt"
                      onClick={() => setDraft({ ...draft, quantity: String(Math.max(1, (parseAmount(draft.quantity) || 1) - 1)).replace(".", ",") })}
                    >
                      −
                    </button>
                    <input
                      inputMode="decimal"
                      aria-labelledby="qty-label"
                      value={draft.quantity}
                      onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label="Artır"
                      onClick={() => setDraft({ ...draft, quantity: String((parseAmount(draft.quantity) || 0) + 1).replace(".", ",") })}
                    >
                      +
                    </button>
                  </div>
                </div>
                <label className="field">
                  <span>Birim</span>
                  <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                    {[...new Set([draft.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Tahmini birim fiyat (₺)</span>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
              </label>
              {draft.item?.last_price != null && (
                <p className="meta">Katalogdaki son fiyat: {money(draft.item.last_price)} / {draft.item.unit}</p>
              )}
              {draftError && <p className="error">{draftError}</p>}
              <div className="row">
                <button className="btn" onClick={() => setDraft(null)}>Vazgeç</button>
                <button className="btn dark grow" onClick={addLine}>Kalemi ekle</button>
              </div>
            </section>
          ) : (
            <section className="stack">
              <h2>{lines.length ? "Başka malzeme ekle" : "Malzeme seç"}</h2>
              <div className="row">
                <input
                  className="input grow"
                  type="search"
                  placeholder="Malzeme adı veya SKU ara"
                  aria-label="Katalogda ara"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="btn dark" onClick={() => setScanning(true)}>Barkod</button>
              </div>
              {scanMsg && <p className="note-box warn">{scanMsg}</p>}
              {searchError && <p className="error">{searchError}</p>}
              {!results && !searchError && <p className="muted small">Katalog yükleniyor…</p>}
              {results && (
                <div className="card stack tight" style={{ padding: "6px 14px" }}>
                  {results.map((c) => {
                    const stock = stockOf(c);
                    return (
                      <button
                        key={c.id}
                        className="list-row"
                        style={{ background: "none", border: 0, borderBottom: "1px solid var(--line)", textAlign: "left", width: "100%", padding: "11px 0" }}
                        onClick={() => pick(c)}
                      >
                        <div className="grow">
                          <p className="card-title">{c.name}</p>
                          <p className="meta mono">{c.sku}</p>
                        </div>
                        {factoryId && (
                          <span className={"pill " + (stock && stock > 0 ? "siparis" : "red")}>
                            {stock && stock > 0 ? `Stok ${fmtQty(stock)} ${c.unit}` : "Stok yok"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {results.length === 0 && (
                    <p className="muted small" style={{ padding: "10px 0" }}>
                      {query ? "Katalogda eşleşen malzeme yok." : "Katalog boş. Serbest tanımla ekleyebilirsiniz."}
                    </p>
                  )}
                  <button className="link-btn" style={{ padding: "11px 0", textAlign: "left" }} onClick={() => pick(null)}>
                    + Katalogda yok — serbest tanımla ekle
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {step === 1 && (
        <section className="stack">
          <label className="field">
            <span>Ekipman / hat (isteğe bağlı)</span>
            <select
              value={equipmentId}
              onChange={(e) => {
                setEquipmentId(e.target.value);
                const cc = equipment.find((x) => x.id === e.target.value)?.cost_center_id;
                if (cc) setCostCenterId(cc);
              }}
            >
              <option value="">Belirtilmedi</option>
              {equipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Maliyet merkezi</span>
            <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
              <option value="">Seçin…</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          {costCenters.length === 0 && (
            <p className="note-box warn">Bu fabrika için maliyet merkezi tanımlanmamış. Sistem yöneticinize başvurun.</p>
          )}
          <div className="field">
            <span>İhtiyaç tarihi</span>
            <div className="chips wrap">
              {[["Bugün", 0], ["3 gün", 3], ["1 hafta", 7]].map(([label, n]) => (
                <button
                  key={label}
                  type="button"
                  className="chip"
                  aria-pressed={neededBy === addDays(n as number)}
                  onClick={() => setNeededBy(addDays(n as number))}
                >
                  {label}
                </button>
              ))}
            </div>
            <input type="date" aria-label="İhtiyaç tarihi" min={todayISO()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </div>
          <div className="field">
            <span>Aciliyet</span>
            <div className="chips wrap">
              {(Object.keys(URGENCY_LABEL) as Urgency[]).map((u) => (
                <button key={u} type="button" className="chip" aria-pressed={urgency === u} onClick={() => setUrgency(u)}>
                  {URGENCY_LABEL[u]}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Gerekçe / not</span>
            <textarea
              placeholder="Örn. rulman ses yapıyor, hat duruş riski var"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </section>
      )}

      {step === 2 && factory && (
        <>
          <section className="card stack">
            <h2>Kalemler · {lines.length}</h2>
            {lines.map((l, i) => (
              <div key={i} className="row between" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <p className="card-title">{l.description}</p>
                  <p className="meta mono">{fmtQty(l.quantity)} {l.unit} × {money(l.est_unit_price)}</p>
                </div>
                <span className="mono">{money(l.quantity * l.est_unit_price)}</span>
              </div>
            ))}
            <hr className="divider" />
            <div className="row between">
              <b>Tahmini toplam</b>
              <b className="mono">{money(total)}</b>
            </div>
          </section>
          <section className="card">
            <dl className="kv">
              <dt>Fabrika</dt><dd>{factory.name}</dd>
              <dt>Ekipman</dt><dd>{equipment.find((e) => e.id === equipmentId)?.name ?? "—"}</dd>
              <dt>Maliyet merkezi</dt><dd>{costCenters.find((c) => c.id === costCenterId)?.code}</dd>
              <dt>İhtiyaç tarihi</dt><dd>{day(neededBy)}</dd>
              <dt>Aciliyet</dt><dd>{URGENCY_LABEL[urgency]}</dd>
              {note.trim() && (<><dt>Not</dt><dd>{note.trim()}</dd></>)}
            </dl>
          </section>
          <p className={"note-box" + (needsApproval ? " warn" : "")}>
            {needsApproval
              ? `${money(factory.request_approval_limit)} limitinin üzerinde — önce Fabrika Müdürü onayına gider, onaydan sonra satınalmaya düşer.`
              : `${money(factory.request_approval_limit)} limitinin altında — ek onay gerekmez, doğrudan satınalma masasına düşer.`}
          </p>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {!draft && (
        <div className="sticky-actions no-tabs">
          {step < 2 ? (
            <button className="btn dark" onClick={next}>Devam</button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={submit}>
              {busy ? "Gönderiliyor…" : needsApproval ? "Müdür onayına gönder" : "Satınalmaya gönder"}
            </button>
          )}
        </div>
      )}

      {scanning && <BarcodeScanner onCode={onScanned} onClose={() => setScanning(false)} />}
    </main>
  );
}
