import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ROLES = ["technician", "buyer", "plant_manager", "general_manager", "admin"];

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** İsteği yapanın aktif bir yönetici olduğunu doğrular. */
async function requireAdmin(request: Request) {
  const admin = adminClient();
  if (!admin) return { error: fail(500, "Sunucuda SUPABASE_SERVICE_ROLE_KEY tanımlı değil.") };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: fail(401, "Oturum bulunamadı.") };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { error: fail(401, "Oturum geçersiz.") };
  const { data: profile } = await admin
    .from("profiles").select("role, active").eq("id", data.user.id).maybeSingle();
  if (!profile?.active || profile.role !== "admin") return { error: fail(403, "Bu işlem için yönetici yetkisi gerekli.") };
  return { admin, callerId: data.user.id };
}

function isUuidList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
}

// Yeni kullanıcı oluşturur
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role;
  const factoryIds = body?.factory_ids ?? [];
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(400, "Geçerli bir e-posta girin.");
  if (!fullName) return fail(400, "Ad soyad gerekli.");
  if (password.length < 8) return fail(400, "Şifre en az 8 karakter olmalı.");
  if (!ROLES.includes(role)) return fail(400, "Geçersiz rol.");
  if (!isUuidList(factoryIds)) return fail(400, "Geçersiz fabrika listesi.");

  const { data, error } = await auth.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });
  if (error || !data.user) {
    const exists = error?.message.toLowerCase().includes("already");
    return fail(400, exists ? "Bu e-posta ile kayıtlı bir kullanıcı var." : "Kullanıcı oluşturulamadı: " + error?.message);
  }
  // Profil tetikleyiciyle oluşur; rolü burada da kesinleştir (ilk kullanıcı kuralını ezmek için)
  const { error: roleError } = await auth.admin
    .from("profiles").update({ role, full_name: fullName }).eq("id", data.user.id);
  if (roleError) return fail(500, "Kullanıcı oluşturuldu ancak rol atanamadı: " + roleError.message);
  if (factoryIds.length) {
    const { error: memberError } = await auth.admin
      .from("profile_factories")
      .insert(factoryIds.map((factory_id) => ({ profile_id: data.user.id, factory_id })));
    if (memberError) return fail(500, "Kullanıcı oluşturuldu ancak fabrika ataması yapılamadı: " + memberError.message);
  }
  return NextResponse.json({ id: data.user.id });
}

// Kullanıcının şifresini sıfırlar
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const id = body?.id;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!isUuidList([id])) return fail(400, "Geçersiz kullanıcı.");
  if (password.length < 8) return fail(400, "Şifre en az 8 karakter olmalı.");
  const { error } = await auth.admin.auth.admin.updateUserById(id, { password });
  if (error) return fail(400, "Şifre güncellenemedi: " + error.message);
  return NextResponse.json({ ok: true });
}
