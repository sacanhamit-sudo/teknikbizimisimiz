import type { NextConfig } from "next";

// Uygulama tümüyle oturuma bağlı ve veriyi tarayıcıdan Supabase'e sorar.
// Sayfaların gizli tutulup durumunun korunması (cacheComponents) burada
// istenmez: eski form taslakları ve başka kullanıcının girdileri kalabilir.
const nextConfig: NextConfig = {};

export default nextConfig;
