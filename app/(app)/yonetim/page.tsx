"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { errText, supabase } from "@/lib/supabase";
import { money, parseAmount } from "@/lib/format";
import { parseCatalogSheet, type CatalogRow } from "@/lib/catalogImport";
import {
  ROLE_LABEL,
  type CostCenter, type Equipment, type Factory, type Profile, type Role,
} from "@/lib/types";

const TABS = ["Fabrikalar", "Kullanıcılar", "Katalog"] as const;

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Fabrikalar");

  if (profile.role !== "admin")
    return (
      <main className="page">
        <div className="empty"><p>Bu sayfa yalnızca yöneticiler içindir.</p></div>
      </main>
    );

  return (
    <main className="page">
      <header className="page-head">
        <span className="eyebrow">Yönetici</span>
        <h1>Yönetim</h1>
      </header>
      <div className="chips" role="group" aria-label="Bölüm">
        {TABS.map((t) => (
          <button key={t} className="chip" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Fabrikalar" && <FactoriesTab />}
      {tab === "Kullanıcılar" && <UsersTab />}
      {tab === "Katalog" && <CatalogTab />}
    </main>
  );
}

/* ───────────────────────── Fabrikalar ───────────────────────── */

function FactoriesTab() {
  const [factories, setFactories] = useState<Factory[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("factories").select("*").order("name");
    if (error) return setError(errText(error));
    setError("");
    setFactories(data as Factory[]);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      {error && <p className="note-box danger">{error}</p>}
      {!factories && !error && <p className="muted">Yükleniyor…</p>}
      {factories?.length === 0 && !adding && (
        <p className="note-box warn">Henüz fabrika yok. Talep açılabilmesi için önce bir fabrika ve maliyet merkezi tanımlayın.</p>
      )}
      {factories?.map((f) =>
        openId === f.id ? (
          <section key={f.id} className="card stack">
            <FactoryForm factory={f} onSaved={load} onClose={() => setOpenId(null)} />
            <hr className="divider" />
            <FactoryChildren factory={f} />
          </section>
        ) : (
          <button key={f.id} className="card row between" style={{ textAlign: "left" }} onClick={() => { setOpenId(f.id); setAdding(false); }}>
            <div>
              <p className="card-title">{f.name}{!f.active && " (pasif)"}</p>
              <p className="meta mono">
                {f.code} · talep limiti {money(f.request_approval_limit)} · GM limiti {money(f.gm_approval_limit)}
              </p>
            </div>
            <span className="link-btn">Düzenle</span>
          </button>
        ),
      )}
      {adding ? (
        <section className="card stack">
          <FactoryForm onSaved={load} onClose={() => setAdding(false)} />
        </section>
      ) : (
        <button className="btn" onClick={() => { setAdding(true); setOpenId(null); }}>+ Fabrika ekle</button>
      )}
    </>
  );
}

function FactoryForm({ factory, onSaved, onClose }: { factory?: Factory; onSaved: () => Promise<void>; onClose: () => void }) {
  const [code, setCode] = useState(factory?.code ?? "");
  const [name, setName] = useState(factory?.name ?? "");
  const [reqLimit, setReqLimit] = useState(String(factory?.request_approval_limit ?? 1500));
  const [gmLimit, setGmLimit] = useState(String(factory?.gm_approval_limit ?? 100000));
  const [active, setActive] = useState(factory?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const rl = parseAmount(reqLimit);
    const gl = parseAmount(gmLimit);
    if (!code.trim() || !name.trim()) return setError("Kod ve ad gerekli.");
    if (Number.isNaN(rl) || Number.isNaN(gl)) return setError("Limitleri sayı olarak girin.");
    setBusy(true);
    setError("");
    const values = { code: code.trim().toUpperCase(), name: name.trim(), request_approval_limit: rl, gm_approval_limit: gl, active };
    const { error } = factory
      ? await supabase.from("factories").update(values).eq("id", factory.id)
      : await supabase.from("factories").insert(values);
    setBusy(false);
    if (error) return setError(error.code === "23505" ? "Bu kodla bir fabrika zaten var." : errText(error));
    await onSaved();
    onClose();
  }

  return (
    <form className="stack" onSubmit={save}>
      <h2>{factory ? "Fabrika bilgileri" : "Yeni fabrika"}</h2>
      <div className="grid-2">
        <label className="field"><span>Kod</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="IST" /></label>
        <label className="field"><span>Ad</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Talep onay limiti (₺)</span>
          <input inputMode="decimal" value={reqLimit} onChange={(e) => setReqLimit(e.target.value)} />
        </label>
        <label className="field">
          <span>Genel Müdür limiti (₺)</span>
          <input inputMode="decimal" value={gmLimit} onChange={(e) => setGmLimit(e.target.value)} />
        </label>
      </div>
      <p className="meta">
        Talep limitinin üzerindeki talepler Fabrika Müdürü onayına gider; Genel Müdür limitinin üzerindeki alımlar Genel Müdüre yükselir.
      </p>
      <label className="row small">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={onClose}>Kapat</button>
        <button className="btn dark grow" disabled={busy}>Kaydet</button>
      </div>
    </form>
  );
}

function FactoryChildren({ factory }: { factory: Factory }) {
  const [ccs, setCcs] = useState<CostCenter[]>([]);
  const [eqs, setEqs] = useState<Equipment[]>([]);
  const [ccCode, setCcCode] = useState("");
  const [ccName, setCcName] = useState("");
  const [eqName, setEqName] = useState("");
  const [eqCc, setEqCc] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [c, e] = await Promise.all([
      supabase.from("cost_centers").select("*").eq("factory_id", factory.id).order("code"),
      supabase.from("equipment").select("*").eq("factory_id", factory.id).order("name"),
    ]);
    if (c.error || e.error) return setError(errText(c.error ?? e.error));
    setCcs(c.data as CostCenter[]);
    setEqs(e.data as Equipment[]);
  }, [factory.id]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function run(p: PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setError("");
    const { error } = await p;
    if (error) setError(error.code === "23505" ? "Bu kayıt zaten var." : errText(error));
    else await load();
    return !error;
  }

  return (
    <div className="stack">
      <h2>Maliyet merkezleri</h2>
      <div>
        {ccs.map((c) => (
          <div key={c.id} className="list-row">
            <span className="grow">
              <span className="mono">{c.code}</span> · {c.name}{!c.active && " (pasif)"}
            </span>
            <button className="link-btn" onClick={() => run(supabase.from("cost_centers").update({ active: !c.active }).eq("id", c.id))}>
              {c.active ? "Pasifleştir" : "Aktifleştir"}
            </button>
          </div>
        ))}
        {ccs.length === 0 && <p className="small muted">Maliyet merkezi yok.</p>}
      </div>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ccCode.trim() || !ccName.trim()) return setError("Maliyet merkezi kodu ve adı gerekli.");
          if (await run(supabase.from("cost_centers").insert({ factory_id: factory.id, code: ccCode.trim().toUpperCase(), name: ccName.trim() }))) {
            setCcCode(""); setCcName("");
          }
        }}
      >
        <input className="input" style={{ width: 110 }} placeholder="Kod" aria-label="Maliyet merkezi kodu" value={ccCode} onChange={(e) => setCcCode(e.target.value)} />
        <input className="input grow" placeholder="Ad" aria-label="Maliyet merkezi adı" value={ccName} onChange={(e) => setCcName(e.target.value)} />
        <button className="btn">Ekle</button>
      </form>

      <hr className="divider" />
      <h2>Ekipman / hatlar</h2>
      <div>
        {eqs.map((q) => (
          <div key={q.id} className="list-row">
            <span className="grow">
              {q.name}{!q.active && " (pasif)"}
              <span className="meta"> · {ccs.find((c) => c.id === q.cost_center_id)?.code ?? "maliyet merkezi yok"}</span>
            </span>
            <button className="link-btn" onClick={() => run(supabase.from("equipment").update({ active: !q.active }).eq("id", q.id))}>
              {q.active ? "Pasifleştir" : "Aktifleştir"}
            </button>
          </div>
        ))}
        {eqs.length === 0 && <p className="small muted">Ekipman yok.</p>}
      </div>
      <form
        className="stack tight"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!eqName.trim()) return setError("Ekipman adı gerekli.");
          if (await run(supabase.from("equipment").insert({ factory_id: factory.id, name: eqName.trim(), cost_center_id: eqCc || null }))) {
            setEqName("");
          }
        }}
      >
        <input className="input" placeholder="Ekipman adı (örn. Dolum Hattı 2)" aria-label="Ekipman adı" value={eqName} onChange={(e) => setEqName(e.target.value)} />
        <div className="row">
          <select className="input grow" aria-label="Ekipmanın maliyet merkezi" value={eqCc} onChange={(e) => setEqCc(e.target.value)}>
            <option value="">Maliyet merkezi (isteğe bağlı)</option>
            {ccs.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
          <button className="btn">Ekle</button>
        </div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/* ───────────────────────── Kullanıcılar ───────────────────────── */

type UserRow = Profile & { profile_factories: { factory_id: string }[] };

async function callUsersApi(method: "POST" | "PATCH", body: unknown): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  try {
    const res = await fetch("/api/admin/users", {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.error ?? "İşlem başarısız oldu.";
  } catch {
    return "Sunucuya ulaşılamadı.";
  }
}

function UsersTab() {
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [u, f] = await Promise.all([
      supabase.from("profiles").select("*, profile_factories(factory_id)").order("full_name"),
      supabase.from("factories").select("*").order("name"),
    ]);
    if (u.error || f.error) return setError(errText(u.error ?? f.error));
    setError("");
    setUsers(u.data as UserRow[]);
    setFactories(f.data as Factory[]);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      {error && <p className="note-box danger">{error}</p>}
      {!users && !error && <p className="muted">Yükleniyor…</p>}
      {users?.map((u) =>
        openId === u.id ? (
          <UserForm key={u.id} user={u} isSelf={u.id === me.id} factories={factories} onSaved={load} onClose={() => setOpenId(null)} />
        ) : (
          <button key={u.id} className="card row between" style={{ textAlign: "left" }} onClick={() => { setOpenId(u.id); setAdding(false); }}>
            <div className="grow">
              <p className="card-title">{u.full_name}{!u.active && " (pasif)"}</p>
              <p className="meta">
                {ROLE_LABEL[u.role]} · {u.email}
                {u.role !== "admin" && u.role !== "general_manager" &&
                  " · " + (u.profile_factories.map((p) => factories.find((f) => f.id === p.factory_id)?.code).filter(Boolean).join(", ") || "fabrika atanmamış")}
              </p>
            </div>
            <span className="link-btn">Düzenle</span>
          </button>
        ),
      )}
      {adding ? (
        <UserForm factories={factories} onSaved={load} onClose={() => setAdding(false)} />
      ) : (
        <button className="btn" onClick={() => { setAdding(true); setOpenId(null); }}>+ Kullanıcı ekle</button>
      )}
    </>
  );
}

function UserForm({
  user, isSelf, factories, onSaved, onClose,
}: {
  user?: UserRow;
  isSelf?: boolean;
  factories: Factory[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "technician");
  const [active, setActive] = useState(user?.active ?? true);
  const [factoryIds, setFactoryIds] = useState<string[]>(user?.profile_factories.map((p) => p.factory_id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const seesAll = role === "admin" || role === "general_manager";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!fullName.trim()) return setError("Ad soyad gerekli.");
    setBusy(true);
    try {
      if (!user) {
        const err = await callUsersApi("POST", {
          email, password, full_name: fullName, role, factory_ids: seesAll ? [] : factoryIds,
        });
        if (err) return setError(err);
      } else {
        const { error: e1 } = await supabase
          .from("profiles").update({ full_name: fullName.trim(), role, active }).eq("id", user.id);
        if (e1) return setError(errText(e1));
        const current = new Set(user.profile_factories.map((p) => p.factory_id));
        const wanted = new Set(seesAll ? [] : factoryIds);
        const remove = [...current].filter((x) => !wanted.has(x));
        const add = [...wanted].filter((x) => !current.has(x));
        if (remove.length) {
          const { error } = await supabase.from("profile_factories").delete().eq("profile_id", user.id).in("factory_id", remove);
          if (error) return setError(errText(error));
        }
        if (add.length) {
          const { error } = await supabase.from("profile_factories").insert(add.map((factory_id) => ({ profile_id: user.id, factory_id })));
          if (error) return setError(errText(error));
        }
        if (password) {
          const err = await callUsersApi("PATCH", { id: user.id, password });
          if (err) return setError(err);
        }
      }
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2>{user ? user.email : "Yeni kullanıcı"}</h2>
      <label className="field"><span>Ad soyad</span><input value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
      {!user && (
        <label className="field">
          <span>E-posta</span>
          <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>{user ? "Yeni şifre (değiştirmek için doldurun)" : "Geçici şifre (en az 8 karakter)"}</span>
        <input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="field">
        <span>Rol</span>
        <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      {seesAll ? (
        <p className="meta">Bu rol tüm fabrikaları görür; fabrika ataması gerekmez.</p>
      ) : (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Fabrikalar</span>
          {factories.length === 0 && <p className="meta">Önce Fabrikalar bölümünden fabrika ekleyin.</p>}
          {factories.map((f) => (
            <label key={f.id} className="row small" style={{ fontWeight: 400, color: "var(--ink)" }}>
              <input
                type="checkbox"
                checked={factoryIds.includes(f.id)}
                onChange={(e) => setFactoryIds(e.target.checked ? [...factoryIds, f.id] : factoryIds.filter((x) => x !== f.id))}
              />
              {f.name}
            </label>
          ))}
        </fieldset>
      )}
      {user && (
        <label className="row small">
          <input type="checkbox" checked={active} disabled={isSelf} onChange={(e) => setActive(e.target.checked)} /> Aktif (giriş yapabilir)
        </label>
      )}
      {isSelf && <p className="meta">Kendi rolünüzü ve aktiflik durumunuzu değiştiremezsiniz.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {info && <p className="ok-text">{info}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={onClose}>Kapat</button>
        <button className="btn dark grow" disabled={busy}>{user ? "Kaydet" : "Kullanıcıyı oluştur"}</button>
      </div>
    </form>
  );
}

/* ───────────────────────── Katalog ───────────────────────── */

interface CatalogListRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  last_price: number | null;
}

function CatalogTab() {
  const [count, setCount] = useState<number | null>(null);
  const [items, setItems] = useState<CatalogListRow[]>([]);
  const [query, setQuery] = useState("");
  const [parsed, setParsed] = useState<{ rows: CatalogRow[]; errors: string[]; fileName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async (q: string) => {
    let req = supabase
      .from("catalog_items")
      .select("id, sku, name, unit, last_price", { count: "exact" })
      .eq("active", true)
      .order("name")
      .limit(30);
    const safe = q.trim().replace(/[%,()\\]/g, " ");
    if (safe) req = req.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
    const { data, count, error } = await req;
    if (error) return setError(errText(error));
    setItems(data as CatalogListRow[]);
    if (!safe) setCount(count ?? 0);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
  }, [load, query]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setResult("");
    setParsed(null);
    try {
      const { readSheet } = await import("read-excel-file/browser");
      const sheet = await readSheet(file);
      setParsed({ ...parseCatalogSheet(sheet as unknown[][]), fileName: file.name });
    } catch {
      setError("Dosya okunamadı. .xlsx biçiminde bir Excel dosyası seçin.");
    }
  }

  async function runImport() {
    if (!parsed) return;
    setBusy(true);
    setError("");
    let items = 0;
    let stock = 0;
    for (let i = 0; i < parsed.rows.length; i += 500) {
      const { data, error } = await supabase.rpc("import_catalog", { p_rows: parsed.rows.slice(i, i + 500) });
      if (error) {
        setError(`${i} satır aktarıldıktan sonra hata: ${errText(error)}`);
        setBusy(false);
        return;
      }
      items += data.items;
      stock += data.stock;
    }
    setBusy(false);
    setParsed(null);
    setResult(`${items} malzeme ve ${stock} stok kaydı aktarıldı.`);
    load("");
  }

  async function downloadTemplate() {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const header = ["SKU", "Malzeme Adı", "Birim", "Son Fiyat", "Barkod", "Fabrika Kodu", "Stok"].map((value) => ({
      value, fontWeight: "bold" as const,
    }));
    const sample = [
      [{ value: "RLM-6204-2Z" }, { value: "Rulman 6204-2Z (paslanmaz)" }, { value: "adet" }, { value: 810 }, { value: "8690000000017" }, { value: "IST" }, { value: 0 }],
      [{ value: "BNT-80-PU" }, { value: "Taşıyıcı bant kayışı 80 mm" }, { value: "adet" }, { value: 1240 }, { value: "" }, { value: "IST" }, { value: 12 }],
    ];
    await writeExcelFile([header, ...sample]).toFile("katalog-sablonu.xlsx");
  }

  return (
    <>
      <section className="card stack">
        <h2>Excel&apos;den katalog ve stok aktar</h2>
        <p className="small muted">
          İlk satır başlık olmalı: <b>SKU</b>, <b>Malzeme Adı</b>, Birim, Son Fiyat, Barkod, Fabrika Kodu, Stok.
          SKU&apos;su kayıtlı olan malzemeler güncellenir, olmayanlar eklenir. Stok, satırdaki fabrika kodu için yazılır;
          aynı malzemenin farklı fabrikalardaki stoku için satırı tekrarlayın.
        </p>
        <div className="row wrap">
          <label className="btn dark" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            Excel dosyası seç
            <input type="file" accept=".xlsx" hidden onChange={onFile} />
          </label>
          <button className="btn" onClick={downloadTemplate}>Şablonu indir</button>
        </div>
        {parsed && (
          <div className="stack">
            <p className="small">
              <b>{parsed.fileName}</b>: {parsed.rows.length} geçerli satır
              {parsed.errors.length > 0 && `, ${parsed.errors.length} satır atlanacak`}.
            </p>
            {parsed.errors.length > 0 && (
              <div className="note-box warn">
                {parsed.errors.slice(0, 8).map((e) => <div key={e}>{e}</div>)}
                {parsed.errors.length > 8 && <div>… ve {parsed.errors.length - 8} satır daha</div>}
              </div>
            )}
            <div className="row">
              <button className="btn" onClick={() => setParsed(null)}>Vazgeç</button>
              <button className="btn primary grow" disabled={busy || parsed.rows.length === 0} onClick={runImport}>
                {busy ? "Aktarılıyor…" : `${parsed.rows.length} satırı aktar`}
              </button>
            </div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {result && <p className="ok-text" role="status">{result}</p>}
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>Katalog</h2>
          {count != null && <span className="meta">{count} malzeme</span>}
        </div>
        <input className="input" type="search" placeholder="Malzeme adı veya SKU ara" aria-label="Katalogda ara" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div>
          {items.map((c) => (
            <div key={c.id} className="list-row">
              <div className="grow">
                <p className="card-title">{c.name}</p>
                <p className="meta mono">{c.sku} · {c.unit}</p>
              </div>
              <span className="mono small">{c.last_price != null ? money(c.last_price) : "—"}</span>
            </div>
          ))}
          {items.length === 0 && <p className="small muted">{query ? "Eşleşen malzeme yok." : "Katalog boş."}</p>}
        </div>
      </section>
    </>
  );
}
