// Tüm yazma işlemleri buradan geçer: kimlik doğrulanır, rol ve durum kontrol edilir, akış kuralları uygulanır.
import { createClient } from "npm:@supabase/supabase-js@2";
import { flow, picked } from "./akis.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
class Hata extends Error {}
const iste = (kosul: unknown, mesaj: string) => { if (!kosul) throw new Hata(mesaj); };
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ROLLER = ["teknisyen", "satinalma", "mudur", "gm"];
const ACIL = ["Normal", "Yüksek", "Kritik"];
type Ben = { id: string; ad: string; role: string };

async function seq(tip: string) {
  const { data, error } = await admin.rpc("sira_no", { tip });
  if (error) throw error;
  return Number(data);
}
function sifreKontrol(s: unknown) {
  const v = String(s ?? "");
  iste(v.length >= 8, "Şifre en az 8 karakter olmalı");
  return v;
}

async function yonetim(a: string, p: any, me: Ben) {
  if (a === "sifreDegistir") {
    const { error } = await admin.auth.admin.updateUserById(me.id, { password: sifreKontrol(p.sifre) });
    iste(!error, "Şifre değiştirilemedi: " + (error?.message ?? ""));
    await admin.from("profiller").update({ gecici_sifre: false }).eq("id", me.id);
    return {};
  }
  if (a === "okundu") {
    let q = admin.from("bildirimler").select("id, okuyan").in("alici", [me.id, "role:" + me.role]).not("okuyan", "cs", `{${me.id}}`);
    if (p.id) q = q.eq("id", str(p.id, 60));
    const { data } = await q;
    for (const n of data ?? []) await admin.from("bildirimler").update({ okuyan: [...n.okuyan, me.id] }).eq("id", n.id);
    return {};
  }
  iste(me.role === "mudur" || me.role === "gm", "Bu işlem için yetkiniz yok");
  if (a === "kullaniciEkle") {
    const ad = str(p.ad, 80), email = str(p.email, 200).toLowerCase(), rol = str(p.rol, 20);
    iste(ad.length >= 3, "Ad soyad yazın");
    iste(/^\S+@\S+\.\S+$/.test(email), "Geçerli bir e-posta yazın");
    iste(ROLLER.includes(rol), "Rol seçin");
    const { data, error } = await admin.auth.admin.createUser({ email, password: sifreKontrol(p.sifre), email_confirm: true });
    iste(!error && data.user, error?.message?.includes("already") ? "Bu e-posta zaten kayıtlı" : "Kullanıcı oluşturulamadı: " + (error?.message ?? ""));
    const { error: e2 } = await admin.from("profiller").insert({ id: data.user!.id, ad, rol, gecici_sifre: true });
    if (e2) { await admin.auth.admin.deleteUser(data.user!.id); throw e2; }
    return {};
  }
  const id = str(p.id, 60);
  iste(id, "Kullanıcı seçilmedi");
  if (a === "kullaniciGuncelle") {
    const d: Record<string, unknown> = {};
    if (typeof p.aktif === "boolean") { iste(id !== me.id || p.aktif, "Kendi hesabınızı pasifleştiremezsiniz"); d.aktif = p.aktif; }
    if (p.rol !== undefined) { iste(ROLLER.includes(p.rol), "Geçersiz rol"); iste(id !== me.id, "Kendi rolünüzü değiştiremezsiniz"); d.rol = p.rol; }
    const { error } = await admin.from("profiller").update(d).eq("id", id);
    if (error) throw error;
    return {};
  }
  if (a === "sifreSifirla") {
    const { error } = await admin.auth.admin.updateUserById(id, { password: sifreKontrol(p.sifre) });
    iste(!error, "Şifre sıfırlanamadı: " + (error?.message ?? ""));
    await admin.from("profiller").update({ gecici_sifre: true }).eq("id", id);
    return {};
  }
  throw new Hata("Bilinmeyen işlem");
}

async function akis(a: string, p: any, me: Ben) {
  const { data: its } = await admin.from("malzemeler").select("sku");
  const skus = new Set((its ?? []).map((x: any) => x.sku));
  const f = flow({ me, skus });
  let t: any, surum: number | null = null, po: any = null;
  const note = str(p.note, 1000);

  if (a === "createTalep") {
    iste(me.role === "teknisyen", "Talep açma yetkiniz yok");
    const lines = (Array.isArray(p.lines) ? p.lines : []).slice(0, 50).map((l: any) => ({
      sku: skus.has(l.sku) ? l.sku : "SERBEST", name: str(l.name, 200), qty: num(l.qty), unit: str(l.unit, 20) || "adet", est: num(l.est),
    }));
    iste(lines.length, "En az bir kalem ekleyin");
    iste(lines.every((l: any) => l.name && l.qty > 0 && l.est > 0), "Kalemlerde ad, miktar ve tahmini fiyat zorunlu");
    iste(/^\d{4}-\d\d-\d\d$/.test(p.need), "İhtiyaç tarihini seçin");
    iste(ACIL.includes(p.urgency), "Aciliyet seçin");
    t = f.createTalep("TLP-" + await seq("tlp"), { lines, machine: str(p.machine, 80) || "Genel", urgency: p.urgency, need: p.need, note });
  } else {
    const { data: row } = await admin.from("talepler").select("veri, surum").eq("id", str(p.id, 60)).maybeSingle();
    iste(row, "Talep bulunamadı");
    t = row!.veri; surum = row!.surum;
    if (t.poId) {
      const { data: pr } = await admin.from("siparisler").select("veri").eq("id", t.poId).maybeSingle();
      po = pr?.veri ?? null;
    }
    const durum = (...s: string[]) => iste(s.includes(t.status), "Talep bu işlem için uygun durumda değil; sayfayı yenileyin");
    const rol = (r: string) => iste(me.role === r, "Bu işlem için yetkiniz yok");
    switch (a) {
      case "decideTalep":
        rol("mudur"); durum("talep_onayi"); iste(p.ok || note, "Red için not yazmalısınız");
        f.decideTalep(t, !!p.ok, note); break;
      case "cancelTalep":
        iste(t.by === me.id, "Yalnızca talep sahibi iptal edebilir"); durum("talep_onayi");
        f.stop(t, 1, "iptal", "Talep iptal edildi"); break;
      case "addQuote": {
        rol("satinalma"); durum("teklif");
        const supplier = str(p.supplier, 120), prices = t.lines.map((_: unknown, i: number) => num(p.prices?.[i]));
        iste(supplier, "Tedarikçi adını yazın"); iste(prices.every((x: number) => x > 0), "Her kalem için birim fiyat girin");
        iste(t.quotes.length < 20, "En fazla 20 teklif girilebilir");
        f.addQuote(t, { supplier, prices, lead: num(p.lead) || "", term: str(p.term, 60), note: str(p.qnote, 300) }); break;
      }
      case "delQuote":
        rol("satinalma"); durum("teklif"); iste(t.quotes.some((q: any) => q.id === p.qid), "Teklif bulunamadı");
        f.delQuote(t, p.qid); break;
      case "pickQuote":
        rol("satinalma"); durum("teklif"); iste(t.quotes.some((q: any) => q.id === p.qid), "Teklif bulunamadı");
        t.pick = p.qid; break;
      case "sendQuotes":
        rol("satinalma"); durum("teklif"); iste(picked(t), "Önce teklif girip tedarikçi seçin");
        f.sendQuotes(t, note); break;
      case "decideQuote":
        iste((me.role === "mudur" && t.status === "teklif_onayi") || (me.role === "gm" && t.status === "gm_onayi"), "Bu onay sizde değil; sayfayı yenileyin");
        iste(["ok", "rev", "red"].includes(p.dec), "Geçersiz karar"); iste(p.dec === "ok" || note, "Red ve revizyon için not yazmalısınız");
        f.decideQuote(t, p.dec, note); break;
      case "createPO":
        rol("satinalma"); durum("siparis_bekliyor"); iste(/^\d{4}-\d\d-\d\d$/.test(p.eta), "Tahmini teslim tarihini seçin");
        po = f.createPO(t, "SAS-" + new Date().getFullYear() + "-" + String(await seq("sas")).padStart(4, "0"),
          { eta: p.eta, term: str(p.term, 60), place: str(p.place, 120), note });
        break;
      case "decidePO":
        durum("siparis_onayi"); iste(po && me.role === po.approver, "Bu sipariş onayı sizde değil"); iste(p.ok || note, "Red için not yazmalısınız");
        f.decidePO(t, po, !!p.ok, note); break;
      case "receive": {
        rol("satinalma"); durum("tedarikte", "kismi"); iste(po, "Sipariş bulunamadı");
        const qtys = po.lines.map((_: unknown, i: number) => num(p.qtys?.[i]));
        iste(po.lines.every((l: any, i: number) => qtys[i] <= l.qty - l.received), "Kalan miktardan fazla kabul edilemez");
        iste(f.receive(t, po, qtys, str(p.irsaliye, 60)), "Teslim alınan miktarı girin"); break;
      }
      case "handover":
        iste(t.by === me.id, "Yalnızca talep sahibi teslim alabilir"); durum("depoda");
        f.handover(t); break;
      default: throw new Hata("Bilinmeyen işlem");
    }
  }
  const { error } = await admin.rpc("akis_kaydet", { p_talep: t, p_surum: surum, p_po: po, p_stok: f.out.stock, p_bildirim: f.out.notifs });
  if (error) {
    iste(!String(error.message).includes("SURUM"), "Kayıt az önce başka biri tarafından güncellendi; tekrar deneyin");
    throw error;
  }
  return { id: t.id, no: t.no, status: t.status, poNo: po?.no ?? null };
}

const YONETIM = ["sifreDegistir", "okundu", "kullaniciEkle", "kullaniciGuncelle", "sifreSifirla"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    iste(user, "Oturum geçersiz; yeniden giriş yapın");
    const { data: pr } = await admin.from("profiller").select("id, ad, rol, aktif, gecici_sifre").eq("id", user!.id).maybeSingle();
    iste(pr && pr.aktif, "Hesabınız aktif değil");
    const { a, p = {} } = await req.json();
    iste(!pr!.gecici_sifre || a === "sifreDegistir", "Önce şifrenizi değiştirin");
    const me = { id: pr!.id, ad: pr!.ad, role: pr!.rol };
    const sonuc = YONETIM.includes(a) ? await yonetim(a, p, me) : await akis(a, p, me);
    return json({ ok: true, ...sonuc });
  } catch (e) {
    if (e instanceof Hata) return json({ hata: e.message });
    console.error(e);
    return json({ hata: "Sunucu hatası; tekrar deneyin" }, 500);
  }
});
