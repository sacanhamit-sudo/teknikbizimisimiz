// Malzeme kartı işlemleri: barkodu bir malzemeye atama / kaldırma (satınalma, müdür, genel müdür).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ hata: "Oturum geçersiz; yeniden giriş yapın" });
    const { data: pr } = await admin.from("profiller").select("rol, aktif, gecici_sifre").eq("id", user.id).maybeSingle();
    if (!pr || !pr.aktif || pr.gecici_sifre) return json({ hata: "Hesabınız bu işlem için uygun değil" });
    if (!["satinalma", "mudur", "gm"].includes(pr.rol)) return json({ hata: "Barkod tanımlama yetkiniz yok" });

    const { a, p = {} } = await req.json();
    if (a !== "barkodAta") return json({ hata: "Bilinmeyen işlem" });
    const sku = String(p.sku ?? "").trim().slice(0, 60), barkod = String(p.barkod ?? "").trim().slice(0, 80);
    const { data: m } = await admin.from("malzemeler").select("sku, name").eq("sku", sku).maybeSingle();
    if (!m) return json({ hata: "Malzeme bulunamadı" });
    if (barkod) {
      const { data: baska } = await admin.from("malzemeler").select("name").eq("barkod", barkod).neq("sku", sku).maybeSingle();
      if (baska) return json({ hata: "Bu barkod başka bir malzemede tanımlı: " + baska.name });
    }
    const { error } = await admin.from("malzemeler").update({ barkod: barkod || null }).eq("sku", sku);
    if (error) throw error;
    return json({ ok: true, name: m.name });
  } catch (e) {
    console.error(e);
    return json({ hata: "Sunucu hatası; tekrar deneyin" }, 500);
  }
});
