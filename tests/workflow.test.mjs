// İş akışı ve yetki testleri. Yerel Supabase'e karşı çalışır:
//   npx supabase start && npx supabase db reset && npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL, SERVICE, opts);
const run = Date.now().toString(36);
const PASSWORD = "test-sifre-1234";

const u = {}; // rol → { client, id }
let ist, ank, ccIst, ccAnk, eqIst;

async function makeUser(key, role, factoryIds) {
  const email = `${key}-${run}@test.local`;
  const { data, error } = await service.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: key },
  });
  assert.ifError(error);
  // Yönetici API'sinin yaptığı gibi: rolü ver ve etkinleştir
  assert.ifError((await service.from("profiles").update({ role, active: true }).eq("id", data.user.id)).error);
  if (factoryIds.length)
    assert.ifError((await service.from("profile_factories")
      .insert(factoryIds.map((factory_id) => ({ profile_id: data.user.id, factory_id })))).error);
  const client = createClient(URL, ANON, opts);
  assert.ifError((await client.auth.signInWithPassword({ email, password: PASSWORD })).error);
  u[key] = { client, id: data.user.id };
}

const line = (price, quantity = 1) => ({ description: "Test malzeme", quantity, unit: "adet", est_unit_price: price });

async function createRequest(who, lines, factory = ist, cc = ccIst) {
  const { data, error } = await u[who].client.rpc("create_request", {
    p_factory: factory, p_cost_center: cc, p_equipment: null,
    p_urgency: "high", p_needed_by: "2030-01-15", p_note: "test", p_lines: lines,
  });
  assert.ifError(error);
  return data;
}

const statusOf = async (id) =>
  (await service.from("requests").select("status, selected_quote_id, estimated_total").eq("id", id).single()).data;

const rpc = (who, fn, args) => u[who].client.rpc(fn, args);
const fails = async (p, pattern) => {
  const { error } = await p;
  assert.ok(error, "hata bekleniyordu");
  if (pattern) assert.match(error.message, pattern);
};
const ok = async (p) => {
  const { data, error } = await p;
  assert.ifError(error);
  return data;
};

before(async () => {
  const f = await service.from("factories").insert([
    { code: `IST${run}`, name: "İstanbul", request_approval_limit: 1500, gm_approval_limit: 100000 },
    { code: `ANK${run}`, name: "Ankara", request_approval_limit: 5000, gm_approval_limit: 50000 },
  ]).select();
  assert.ifError(f.error);
  [ist, ank] = [f.data[0].id, f.data[1].id];
  const c = await service.from("cost_centers").insert([
    { factory_id: ist, code: "MM-1", name: "Bakım" },
    { factory_id: ank, code: "MM-9", name: "Bakım" },
  ]).select();
  assert.ifError(c.error);
  [ccIst, ccAnk] = [c.data[0].id, c.data[1].id];
  const e = await service.from("equipment").insert({ factory_id: ist, name: "Dolum Hattı", cost_center_id: ccIst }).select();
  eqIst = e.data[0].id;

  await makeUser("admin", "admin", []);
  await makeUser("tech", "technician", [ist]);
  await makeUser("tech2", "technician", [ist]);
  await makeUser("techAnk", "technician", [ank]);
  await makeUser("buyer", "buyer", [ist]);
  await makeUser("buyerAnk", "buyer", [ank]);
  await makeUser("pm", "plant_manager", [ist]);
  await makeUser("pmAnk", "plant_manager", [ank]);
  await makeUser("gm", "general_manager", []);
});

test("limit altındaki talep doğrudan satınalmaya düşer", async () => {
  const id = await createRequest("tech", [line(500, 3)]);
  const r = await statusOf(id);
  assert.equal(r.status, "sourcing");
  assert.equal(Number(r.estimated_total), 1500); // limit dahil değil: 1500 > 1500 yanlış
});

test("limit üstündeki talep Fabrika Müdürü onayına gider; tutar miktar × fiyat toplamıdır", async () => {
  const id = await createRequest("tech", [line(810, 4), line(185.5, 2)]);
  const r = await statusOf(id);
  assert.equal(r.status, "pending_approval");
  assert.equal(Number(r.estimated_total), 810 * 4 + 371);
});

test("fabrika limiti fabrikaya özeldir", async () => {
  const id = await createRequest("techAnk", [line(4000)], ank, ccAnk);
  assert.equal((await statusOf(id)).status, "sourcing"); // Ankara limiti 5000
});

test("talep numaraları benzersiz ve sıralıdır", async () => {
  const a = await createRequest("tech", [line(10)]);
  const b = await createRequest("tech", [line(10)]);
  const { data } = await service.from("requests").select("code").in("id", [a, b]).order("created_at");
  const [n1, n2] = data.map((x) => Number(x.code.replace("TLP-", "")));
  assert.equal(n2, n1 + 1);
});

test("geçersiz talepler reddedilir", async () => {
  const base = { p_factory: ist, p_cost_center: ccIst, p_equipment: null, p_urgency: "normal", p_needed_by: "2030-01-01", p_note: "" };
  await fails(rpc("tech", "create_request", { ...base, p_lines: [] }), /en az bir/i);
  await fails(rpc("tech", "create_request", { ...base, p_lines: [line(10, 0)] }));
  await fails(rpc("tech", "create_request", { ...base, p_lines: [line(-5)] }));
  await fails(rpc("tech", "create_request", { ...base, p_cost_center: ccAnk, p_lines: [line(10)] }), /maliyet merkezi/i);
  await fails(rpc("techAnk", "create_request", { ...base, p_lines: [line(10)] }), /yetkiniz yok/i);
});

test("görünürlük: teknisyen yalnızca kendi talebini, satınalma/müdür kendi fabrikasını, GM hepsini görür", async () => {
  const id = await createRequest("tech", [line(100)]);
  const sees = async (who) => (await u[who].client.from("requests").select("id").eq("id", id)).data.length === 1;
  assert.equal(await sees("tech"), true);
  assert.equal(await sees("tech2"), false);
  assert.equal(await sees("buyer"), true);
  assert.equal(await sees("pm"), true);
  assert.equal(await sees("buyerAnk"), false);
  assert.equal(await sees("pmAnk"), false);
  assert.equal(await sees("gm"), true);
  assert.equal(await sees("admin"), true);
  // Alt kayıtlar da aynı kurala uyar
  assert.equal((await u.tech2.client.from("request_lines").select("id").eq("request_id", id)).data.length, 0);
  assert.equal((await u.tech2.client.from("request_events").select("id").eq("request_id", id)).data.length, 0);
});

test("giriş yapmamış kullanıcı hiçbir şey okuyamaz ve fonksiyon çağıramaz", async () => {
  const anon = createClient(URL, ANON, opts);
  for (const t of ["requests", "profiles", "factories", "catalog_items", "quotes", "notifications"]) {
    const { data, error } = await anon.from(t).select("*").limit(1);
    assert.ok(error || data.length === 0, t + " anonim okunabiliyor");
  }
  await fails(anon.rpc("create_request", {
    p_factory: ist, p_cost_center: ccIst, p_equipment: null, p_urgency: "normal",
    p_needed_by: "2030-01-01", p_note: "", p_lines: [line(1)],
  }));
});

test("tablolara doğrudan yazılamaz; kullanıcı kendi rolünü yükseltemez", async () => {
  const id = await createRequest("tech", [line(5000)]);
  await u.tech.client.from("requests").update({ status: "approved" }).eq("id", id);
  assert.equal((await statusOf(id)).status, "pending_approval");
  await u.tech.client.from("requests").delete().eq("id", id);
  assert.ok(await statusOf(id));
  const ins = await u.tech.client.from("quotes")
    .insert({ request_id: id, supplier_name: "x", total: 1, created_by: u.tech.id });
  assert.ok(ins.error);
  await u.tech.client.from("profiles").update({ role: "admin" }).eq("id", u.tech.id);
  const { data } = await service.from("profiles").select("role").eq("id", u.tech.id).single();
  assert.equal(data.role, "technician");
  const lim = await u.pm.client.from("factories").update({ request_approval_limit: 999999 }).eq("id", ist).select();
  assert.equal(lim.data?.length ?? 0, 0);
});

test("talep onayı yalnızca o fabrikanın müdüründe; ret için not zorunlu", async () => {
  const id = await createRequest("tech", [line(5000)]);
  const args = { p_request: id, p_decision: "approve", p_note: "" };
  await fails(rpc("tech", "decide_request", args), /yetkiniz yok/i);
  await fails(rpc("buyer", "decide_request", args), /yetkiniz yok/i);
  await fails(rpc("pmAnk", "decide_request", args), /yetkiniz yok/i);
  await fails(rpc("gm", "decide_request", args), /yetkiniz yok/i);
  await fails(rpc("pm", "decide_request", { ...args, p_decision: "reject" }), /not/i);
  await ok(rpc("pm", "decide_request", args));
  assert.equal((await statusOf(id)).status, "sourcing");
  await fails(rpc("pm", "decide_request", args), /onay aşamasında değil/i);

  const id2 = await createRequest("tech", [line(5000)]);
  await ok(rpc("pm", "decide_request", { p_request: id2, p_decision: "reject", p_note: "Mevcut parça ile devam" }));
  assert.equal((await statusOf(id2)).status, "rejected");
});

test("tam akış: teklif → alım kararı → sipariş → teslim", async () => {
  const id = await createRequest("tech", [line(810, 4)]);
  await ok(rpc("pm", "decide_request", { p_request: id, p_decision: "approve", p_note: "" }));

  const q = { p_request: id, p_supplier: "Anadolu Rulman", p_total: 3240, p_lead_days: 2, p_note: "" };
  await fails(rpc("tech", "add_quote", q), /satınalma yetkisi/i);
  await fails(rpc("buyerAnk", "add_quote", q), /satınalma yetkisi/i);
  await fails(rpc("buyer", "add_quote", { ...q, p_total: 0 }), /sıfırdan büyük/i);
  const q1 = await ok(rpc("buyer", "add_quote", q));
  const q2 = await ok(rpc("buyer", "add_quote", { ...q, p_supplier: "Teknik Yedek", p_total: 3880 }));
  await ok(rpc("buyer", "delete_quote", { p_quote: q2 }));

  // Başka talebin teklifiyle gönderilemez
  const other = await createRequest("tech", [line(100)]);
  const qOther = await ok(rpc("buyer", "add_quote", { ...q, p_request: other }));
  await fails(rpc("buyer", "submit_purchase", { p_request: id, p_quote: qOther, p_note: "" }), /ait değil/i);

  // Onaylanmadan sipariş açılamaz
  await fails(rpc("buyer", "place_order", { p_request: id, p_po_number: "SAS-1", p_eta: null }), /onaylanmadan/i);

  await ok(rpc("buyer", "submit_purchase", { p_request: id, p_quote: q1, p_note: "En hızlı teslim" }));
  assert.equal((await statusOf(id)).status, "purchase_approval");
  await fails(rpc("buyer", "add_quote", q), /teklif toplama aşamasında değil/i);

  const d = { p_request: id, p_decision: "approve", p_note: "" };
  await fails(rpc("buyer", "decide_purchase", d), /Fabrika Müdürü/);
  await fails(rpc("gm", "decide_purchase", d), /Fabrika Müdürü/);
  await fails(rpc("pmAnk", "decide_purchase", d), /Fabrika Müdürü/);
  await ok(rpc("pm", "decide_purchase", d));
  assert.equal((await statusOf(id)).status, "approved"); // 3240 < 100000: GM gerekmez

  await fails(rpc("buyer", "place_order", { p_request: id, p_po_number: " ", p_eta: null }), /numarası/i);
  await fails(rpc("tech", "place_order", { p_request: id, p_po_number: "SAS-1", p_eta: null }), /satınalma yetkisi/i);
  await ok(rpc("buyer", "place_order", { p_request: id, p_po_number: "SAS-2030-1", p_eta: "2030-01-10" }));
  assert.equal((await statusOf(id)).status, "ordered");

  await fails(rpc("tech2", "mark_delivered", { p_request: id }), /yetkiniz yok/i);
  await ok(rpc("tech", "mark_delivered", { p_request: id }));
  assert.equal((await statusOf(id)).status, "delivered");

  const { data: events } = await u.tech.client.from("request_events").select("kind").eq("request_id", id).order("id");
  assert.deepEqual(events.map((e) => e.kind), [
    "created", "request_approved", "quote_added", "quote_added", "quote_removed",
    "purchase_submitted", "purchase_approved", "ordered", "delivered",
  ]);
});

test("GM limiti üstündeki alım Genel Müdüre yükselir", async () => {
  const id = await createRequest("tech", [line(120000)]);
  await ok(rpc("pm", "decide_request", { p_request: id, p_decision: "approve", p_note: "" }));
  const q = await ok(rpc("buyer", "add_quote", { p_request: id, p_supplier: "Endüstri Otomasyon", p_total: 128400, p_lead_days: 6, p_note: "" }));
  await ok(rpc("buyer", "submit_purchase", { p_request: id, p_quote: q, p_note: "" }));

  const d = { p_request: id, p_decision: "approve", p_note: "" };
  await fails(rpc("gm", "decide_purchase", d), /Fabrika Müdürü/); // önce müdür
  await ok(rpc("pm", "decide_purchase", d));
  assert.equal((await statusOf(id)).status, "gm_approval");
  await fails(rpc("pm", "decide_purchase", d), /Genel Müdür/);
  await fails(rpc("buyer", "place_order", { p_request: id, p_po_number: "X", p_eta: null }), /onaylanmadan/i);
  await ok(rpc("gm", "decide_purchase", d));
  assert.equal((await statusOf(id)).status, "approved");
});

test("GM limiti fabrikaya özeldir; tam limit tutarı yükselmez", async () => {
  const mk = async (total) => {
    const id = await createRequest("techAnk", [line(100)], ank, ccAnk);
    const q = await ok(rpc("buyerAnk", "add_quote", { p_request: id, p_supplier: "T", p_total: total, p_lead_days: null, p_note: "" }));
    await ok(rpc("buyerAnk", "submit_purchase", { p_request: id, p_quote: q, p_note: "" }));
    await ok(rpc("pmAnk", "decide_purchase", { p_request: id, p_decision: "approve", p_note: "" }));
    return (await statusOf(id)).status;
  };
  assert.equal(await mk(50000), "approved");      // Ankara GM limiti 50000 (dahil değil)
  assert.equal(await mk(50000.01), "gm_approval");
});

test("revize: satınalmaya döner ve seçim temizlenir; ret için not zorunlu", async () => {
  const id = await createRequest("tech", [line(100)]);
  const q = await ok(rpc("buyer", "add_quote", { p_request: id, p_supplier: "T", p_total: 90, p_lead_days: 1, p_note: "" }));
  await ok(rpc("buyer", "submit_purchase", { p_request: id, p_quote: q, p_note: "" }));
  await fails(rpc("pm", "decide_purchase", { p_request: id, p_decision: "reject", p_note: " " }), /not/i);
  await fails(rpc("pm", "decide_purchase", { p_request: id, p_decision: "bogus", p_note: "" }), /geçersiz/i);
  await ok(rpc("pm", "decide_purchase", { p_request: id, p_decision: "revise", p_note: "Tek teklif yetmez" }));
  let r = await statusOf(id);
  assert.equal(r.status, "sourcing");
  assert.equal(r.selected_quote_id, null);
  await ok(rpc("buyer", "submit_purchase", { p_request: id, p_quote: q, p_note: "" }));
  await ok(rpc("pm", "decide_purchase", { p_request: id, p_decision: "reject", p_note: "Bütçe yok" }));
  r = await statusOf(id);
  assert.equal(r.status, "rejected");
});

test("iptal: yalnızca talep sahibi, yalnızca alım kararından önce", async () => {
  const id = await createRequest("tech", [line(100)]);
  await fails(rpc("tech2", "cancel_request", { p_request: id }), /talep sahibi/i);
  await fails(rpc("buyer", "cancel_request", { p_request: id }), /talep sahibi/i);
  await ok(rpc("tech", "cancel_request", { p_request: id }));
  assert.equal((await statusOf(id)).status, "cancelled");

  const id2 = await createRequest("tech", [line(100)]);
  const q = await ok(rpc("buyer", "add_quote", { p_request: id2, p_supplier: "T", p_total: 90, p_lead_days: 1, p_note: "" }));
  await ok(rpc("buyer", "submit_purchase", { p_request: id2, p_quote: q, p_note: "" }));
  await fails(rpc("tech", "cancel_request", { p_request: id2 }), /iptal edilemez/i);
});

test("bildirimler doğru kişilere gider ve yalnızca sahibi görür", async () => {
  const id = await createRequest("tech", [line(5000)]);
  const mine = async (who) => (await u[who].client.from("notifications").select("title").eq("request_id", id)).data.length;
  assert.equal(await mine("pm"), 1);
  assert.equal(await mine("pmAnk"), 0);
  assert.equal(await mine("buyer"), 0);
  assert.equal(await mine("tech"), 0);
  await ok(rpc("pm", "decide_request", { p_request: id, p_decision: "approve", p_note: "" }));
  assert.equal(await mine("buyer"), 1);
  assert.equal(await mine("buyerAnk"), 0);
  assert.equal(await mine("tech"), 1);
  // Başkasının bildirimi okunamaz / değiştirilemez
  const all = await u.tech2.client.from("notifications").select("id").eq("request_id", id);
  assert.equal(all.data.length, 0);
  // Okundu işaretleme
  await u.tech.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("request_id", id);
  const { data } = await u.tech.client.from("notifications").select("read_at").eq("request_id", id);
  assert.ok(data[0].read_at);
  // Bildirim içeriği değiştirilemez
  const upd = await u.tech.client.from("notifications").update({ title: "x" }).eq("request_id", id);
  assert.ok(upd.error);
});

test("katalog aktarımı yalnızca yöneticide; ekler, günceller, stok yazar", async () => {
  const sku = `SKU-${run}`;
  const rows = [{ sku, name: "Rulman 6204", unit: "adet", last_price: 810, barcode: "869" + run, factory_code: `ist${run}`, stock: 4 }];
  await fails(rpc("tech", "import_catalog", { p_rows: rows }), /yönetici/i);
  await fails(rpc("buyer", "import_catalog", { p_rows: rows }), /yönetici/i);
  assert.deepEqual(await ok(rpc("admin", "import_catalog", { p_rows: rows })), { items: 1, stock: 1 });
  // Güncelleme: ad değişir, boş bırakılan fiyat korunur, stok üzerine yazılır
  await ok(rpc("admin", "import_catalog", { p_rows: [{ sku, name: "Rulman 6204-2Z", factory_code: `IST${run}`, stock: 0 }] }));
  const { data } = await u.tech.client.from("catalog_items")
    .select("name, last_price, unit, stock_levels(quantity, factory_id)").eq("sku", sku).single();
  assert.equal(data.name, "Rulman 6204-2Z");
  assert.equal(Number(data.last_price), 810);
  assert.equal(data.stock_levels.length, 1);
  assert.equal(Number(data.stock_levels[0].quantity), 0);
  await fails(rpc("admin", "import_catalog", { p_rows: [{ sku, name: "x", factory_code: "YOK", stock: 1 }] }), /fabrika kodu/i);
  // Teknisyen kataloğu değiştiremez
  await u.tech.client.from("catalog_items").update({ last_price: 1 }).eq("sku", sku);
  const after = await service.from("catalog_items").select("last_price").eq("sku", sku).single();
  assert.equal(Number(after.data.last_price), 810);
});

test("ekipman başka fabrikaya aitse talep açılamaz", async () => {
  await fails(u.techAnk.client.rpc("create_request", {
    p_factory: ank, p_cost_center: ccAnk, p_equipment: eqIst, p_urgency: "normal",
    p_needed_by: "2030-01-01", p_note: "", p_lines: [line(1)],
  }), /ekipman/i);
});

test("pasifleştirilen kullanıcı işlem yapamaz", async () => {
  await service.from("profiles").update({ active: false }).eq("id", u.tech2.id);
  await fails(u.tech2.client.rpc("create_request", {
    p_factory: ist, p_cost_center: ccIst, p_equipment: null, p_urgency: "normal",
    p_needed_by: "2030-01-01", p_note: "", p_lines: [line(1)],
  }));
  await service.from("profiles").update({ active: true }).eq("id", u.tech2.id);
});

test("kendi kendine kayıt olan kullanıcı pasif başlar ve veri göremez", async () => {
  const client = createClient(URL, ANON, opts);
  const { data, error } = await client.auth.signUp({ email: `disaridan-${run}@test.local`, password: PASSWORD });
  if (error) return assert.match(error.message, /signups? (are |not allowed|disabled)/i); // kayıt kapalıysa zaten giremez
  const { data: profile } = await service.from("profiles").select("role, active").eq("id", data.user.id).single();
  assert.equal(profile.active, false);
  assert.equal(profile.role, "technician");
  if (data.session) {
    for (const t of ["profiles", "factories", "catalog_items", "requests"]) {
      assert.equal((await client.from(t).select("*").limit(1)).data?.length ?? 0, 0, t);
    }
    await fails(client.rpc("create_request", {
      p_factory: ist, p_cost_center: ccIst, p_equipment: null, p_urgency: "normal",
      p_needed_by: "2030-01-01", p_note: "", p_lines: [line(1)],
    }));
  }
});
