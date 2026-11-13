import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

/** Supabase hatasını kullanıcıya gösterilecek metne çevirir. */
export function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message: unknown }).message);
    if (m === "Failed to fetch" || m.includes("NetworkError"))
      return "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";
    return m;
  }
  return "Beklenmeyen bir hata oluştu.";
}
