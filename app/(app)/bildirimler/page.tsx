"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { errText, supabase } from "@/lib/supabase";
import { dateTime } from "@/lib/format";

interface Notification {
  id: number;
  request_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, request_id, title, body, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return setError(errText(error));
    setError("");
    setItems(data as Notification[]);
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function markAll() {
    const now = new Date().toISOString();
    const { error } = await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
    if (error) setError(errText(error));
    else setItems((xs) => xs?.map((x) => ({ ...x, read_at: x.read_at ?? now })) ?? null);
  }

  const markOne = (id: number) =>
    supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).then(() => {});

  const unread = items?.filter((x) => !x.read_at).length ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <div className="row between">
          <h1>Bildirimler</h1>
          {unread > 0 && <button className="link-btn" onClick={markAll}>Tümünü okundu say</button>}
        </div>
      </header>
      {error && <p className="note-box danger">{error}</p>}
      {!items && !error && <p className="muted">Yükleniyor…</p>}
      {items?.length === 0 && <div className="empty"><p>Henüz bildiriminiz yok.</p></div>}
      <div className="stack tight">
        {items?.map((n) => {
          const inner = (
            <>
              <p className="card-title" style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</p>
              {n.body && <p className="small muted">{n.body}</p>}
              <span className="meta">{dateTime(n.created_at)}</span>
            </>
          );
          const style = n.read_at ? { background: "var(--surface-2)" } : { borderColor: "var(--accent)" };
          return n.request_id ? (
            <Link key={n.id} href={`/talep/${n.request_id}`} className="card stack tight" style={style} onClick={() => !n.read_at && markOne(n.id)}>
              {inner}
            </Link>
          ) : (
            <div key={n.id} className="card stack tight" style={style}>{inner}</div>
          );
        })}
      </div>
    </main>
  );
}
