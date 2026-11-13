"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";

const ICONS: Record<string, React.ReactNode> = {
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  bell: <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6m4 10a2 2 0 0 0 4 0" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-7 8a7 7 0 0 1 14 0" />,
  cog: <path d="M4 7h10m4 0h2M4 17h2m4 0h10M16 4v6M8 14v6" />,
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  const loadUnread = useCallback(async () => {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    setUnread(count ?? 0);
  }, []);

  useEffect(() => {
    const first = setTimeout(loadUnread, 0);
    const t = setInterval(loadUnread, 60_000);
    const onVisible = () => document.visibilityState === "visible" && loadUnread();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadUnread, pathname]);

  const tabs = [
    { href: "/", label: "Talepler", icon: "list" },
    { href: "/bildirimler", label: "Bildirim", icon: "bell", badge: unread },
    ...(profile.role === "admin" ? [{ href: "/yonetim", label: "Yönetim", icon: "cog" }] : []),
    { href: "/profil", label: "Profil", icon: "user" },
  ];
  // Yeni talep sihirbazında alt çubuk yerine kendi ileri/geri düğmeleri var
  const hideTabs = pathname === "/yeni";

  return (
    <div className="shell" data-role={profile.role}>
      {children}
      {!hideTabs && (
        <div className="tabbar">
          <nav>
            {tabs.map((t) => {
              const current =
                t.href === "/" ? pathname === "/" || pathname.startsWith("/talep") : pathname.startsWith(t.href);
              return (
                <Link key={t.href} href={t.href} aria-current={current ? "page" : undefined}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {ICONS[t.icon]}
                  </svg>
                  {t.label}
                  {!!t.badge && <span className="badge">{t.badge > 99 ? "99+" : t.badge}</span>}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
