"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "E-posta veya şifre hatalı."
          : "Giriş yapılamadı: " + error.message,
      );
      setBusy(false);
    }
    // Başarılı girişte AuthProvider ana sayfaya yönlendirir
  }

  return (
    <main className="login">
      <div className="login-brand">
        <span className="eyebrow">Bakım · Satınalma</span>
        <h1>Teknik Satınalma Talebi</h1>
        <p className="muted">Talep aç, onayla, tedarik sürecini takip et.</p>
      </div>
      <form className="card stack" onSubmit={submit}>
        <label className="field">
          <span>E-posta</span>
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Şifre</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
      </form>
      <p className="muted small">Hesabınız yoksa sistem yöneticinize başvurun.</p>
    </main>
  );
}
