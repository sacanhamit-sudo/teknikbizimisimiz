"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Factory, Profile } from "@/lib/types";

interface AuthState {
  profile: Profile;
  /** Kullanıcının üyesi olduğu fabrikalar (yönetici ve genel müdür için tümü) */
  factories: Factory[];
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth, AuthProvider içinde kullanılmalı");
  return v;
}

type Loaded =
  | { kind: "loading" }
  | { kind: "anon" }
  | { kind: "error"; message: string }
  | { kind: "ready"; profile: Profile; factories: Factory[] };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const router = useRouter();
  const pathname = usePathname();

  const load = useCallback(async (userId: string | null) => {
    if (!userId) return setState({ kind: "anon" });
    const [p, f, m] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("factories").select("*").eq("active", true).order("name"),
      supabase.from("profile_factories").select("factory_id").eq("profile_id", userId),
    ]);
    const err = p.error ?? f.error ?? m.error;
    if (err) return setState({ kind: "error", message: err.message });
    const profile = p.data as Profile | null;
    if (!profile || !profile.active) {
      await supabase.auth.signOut();
      return setState({ kind: "anon" });
    }
    const all = (f.data ?? []) as Factory[];
    const mine = new Set((m.data ?? []).map((x) => x.factory_id));
    const seesAll = profile.role === "admin" || profile.role === "general_manager";
    setState({
      kind: "ready",
      profile,
      factories: seesAll ? all : all.filter((x) => mine.has(x.id)),
    });
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return;
      // Supabase, bu geri çağrının içinde başka Supabase çağrısı beklenmesini istemez
      setTimeout(() => load(session?.user.id ?? null), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  useEffect(() => {
    if (state.kind === "anon" && pathname !== "/login") router.replace("/login");
    if (state.kind === "ready" && pathname === "/login") router.replace("/");
  }, [state.kind, pathname, router]);

  if (pathname === "/login" && state.kind !== "ready") return <>{children}</>;

  if (state.kind === "error")
    return (
      <div className="center-screen">
        <p className="muted">Bilgiler yüklenemedi: {state.message}</p>
        <button className="btn" onClick={() => location.reload()}>
          Tekrar dene
        </button>
      </div>
    );

  if (state.kind !== "ready")
    return (
      <div className="center-screen">
        <p className="muted">Yükleniyor…</p>
      </div>
    );

  return (
    <Ctx.Provider
      value={{
        profile: state.profile,
        factories: state.factories,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
