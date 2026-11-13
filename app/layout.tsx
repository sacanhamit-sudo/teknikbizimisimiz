import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const archivo = Archivo({ variable: "--font-sans", subsets: ["latin", "latin-ext"] });
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Teknik Satınalma",
  description: "Bakım ekipleri için teknik satınalma talebi ve onay takibi",
  appleWebApp: { capable: true, title: "Satınalma", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F3EE",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        {/* Oturum ve adres bilgisi yalnızca tarayıcıda bilinir */}
        <Suspense fallback={<div className="center-screen"><p className="muted">Yükleniyor…</p></div>}>
          <AuthProvider>{children}</AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
