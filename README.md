# Teknik Satınalma

Bakım ekiplerinin satınalma taleplerini telefondan yürüttüğü uygulama:
talep → talep onayı → teklif → teklif değerlendirme onayı → sipariş → sipariş onayı → mal kabul → teslim.

- `index.html`, `app.js`, `app.css` — telefon arayüzü (derleme adımı yok, statik dosyalar).
- `vendor/supabase.js` — Supabase istemci kitaplığı (2.119.0); `vendor/zxing.min.js` — barkod çözücü (0.21.3, tarayıcının kendi okuyucusu yoksa yüklenir).
- `supabase/functions/islem/` — sunucu işlevi. Tüm yazma işlemleri buradan geçer; kimlik, rol ve durum
  kontrolü ile akış kuralları (`akis.js`) burada uygulanır.
- `supabase/functions/malzeme/` — barkodu malzemeye tanımlama işlevi.
- `supabase/migrations/` — veritabanı şeması ve erişim kuralları. Tablolar yalnızca okunabilir;
  yazma yetkisi sadece sunucu işlevindedir.
- `scripts/ornek-veri.mjs` — örnek kayıtları API üzerinden yükler.
- `prototip/` — ilk Claude Design prototipi (referans).

Onay limitleri (`akis.js`): ₺1.500 üzeri talepler Fabrika Müdürü talep onayına, ₺100.000 üzeri alımlar
Genel Müdür onayına gider.
