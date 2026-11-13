"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { errText, supabase } from "@/lib/supabase";
import { ROLE_LABEL } from "@/lib/types";

export default function ProfilePage() {
  const { profile, factories, signOut } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ ok: false, text: "Şifre en az 8 karakter olmalı." });
    if (pw !== pw2) return setMsg({ ok: false, text: "Şifreler aynı değil." });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errText(error) });
    setPw("");
    setPw2("");
    setMsg({ ok: true, text: "Şifreniz güncellendi." });
  }

  return (
    <main className="page">
      <header className="page-head">
        <span className="eyebrow">{ROLE_LABEL[profile.role]}</span>
        <h1>{profile.full_name}</h1>
      </header>

      <section className="card">
        <dl className="kv">
          <dt>E-posta</dt><dd>{profile.email}</dd>
          <dt>Rol</dt><dd>{ROLE_LABEL[profile.role]}</dd>
          <dt>Fabrikalar</dt>
          <dd>{factories.length ? factories.map((f) => f.name).join(", ") : "Atanmamış"}</dd>
        </dl>
      </section>

      <form className="card stack" onSubmit={changePassword}>
        <h2>Şifre değiştir</h2>
        <label className="field">
          <span>Yeni şifre</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field">
          <span>Yeni şifre (tekrar)</span>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {msg && <p className={msg.ok ? "ok-text" : "error"} role="status">{msg.text}</p>}
        <button className="btn" disabled={busy}>Şifreyi güncelle</button>
      </form>

      <button className="btn danger" onClick={signOut}>Çıkış yap</button>
    </main>
  );
}
