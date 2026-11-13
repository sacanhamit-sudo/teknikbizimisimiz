# Teknik Satınalma Talebi

Bakım ekipleri için satınalma talebi ve onay takibi. Telefona "ana ekrana ekle" ile kurulan bir web uygulamasıdır (PWA).

- **Teknisyen** malzemeyi katalogdan arayarak ya da barkod okutarak talep açar, süreci takip eder, teslim alır.
- **Fabrika Müdürü** limit üstü talepleri ve alım kararlarını onaylar, reddeder ya da ek teklif ister.
- **Satınalma Uzmanı** teklifleri girer, tedarikçi seçip alım kararına gönderir, siparişi kaydeder.
- **Genel Müdür** yetki limitinin üzerindeki alımları onaylar.
- **Yönetici** fabrikaları, maliyet merkezlerini, ekipmanları, kullanıcıları ve kataloğu yönetir.

## İş kuralları

| Kural | Nerede ayarlanır |
| --- | --- |
| Tahmini tutarı talep limitini (varsayılan ₺1.500) aşan talep önce Fabrika Müdürü onayına gider; aşmayan doğrudan satınalmaya düşer | Yönetim → Fabrikalar |
| Seçilen teklifi Genel Müdür limitini (varsayılan ₺100.000) aşan alım, Fabrika Müdüründen sonra Genel Müdüre yükselir | Yönetim → Fabrikalar |
| Teknisyen yalnızca kendi taleplerini; satınalma ve müdür yalnızca kendi fabrikalarını; Genel Müdür ve yönetici hepsini görür | Yönetim → Kullanıcılar |
| Ret kararında not zorunludur; her karar süreç geçmişine kişi ve saatle yazılır | — |

Kurallar tarayıcıda değil veritabanında uygulanır: `supabase/migrations/` altındaki fonksiyonlar durum geçişlerini ve yetkileri denetler, tablolara doğrudan yazılamaz.

## Kurulum

Gerekenler: Node.js 20+, bir [Supabase](https://supabase.com) projesi.

1. **Veritabanı.** Supabase'de yeni bir proje açın, sonra şemayı uygulayın:

   ```bash
   npx supabase link --project-ref PROJE-REF
   ```

   ```bash
   npx supabase db push
   ```

2. **Ortam değişkenleri.** `.env.example` dosyasını `.env.local` olarak kopyalayıp Supabase panelindeki (Project Settings → API) değerlerle doldurun. `SUPABASE_SERVICE_ROLE_KEY` yalnızca sunucuda kullanılır; yöneticinin kullanıcı oluşturabilmesi için gereklidir.

3. **İlk yönetici.** Supabase paneli → Authentication → Users → *Add user* ile bir kullanıcı oluşturun ("Auto Confirm User" işaretli). Sisteme eklenen **ilk kullanıcı otomatik olarak yönetici olur**; sonraki herkesi yönetici uygulamanın içinden ekler. Uygulama dışından oluşturulan diğer hesaplar pasif başlar ve yönetici etkinleştirene kadar hiçbir veriyi göremez. Yine de Supabase panelinde Authentication → Sign In / Providers altında "Allow new users to sign up" seçeneğini kapatmanız önerilir.

4. **Çalıştırma.**

   ```bash
   npm install
   ```

   ```bash
   npm run dev
   ```

5. **İlk ayarlar** (yönetici olarak giriş yapıp *Yönetim* sekmesinden): fabrikaları ve limitlerini, her fabrikanın maliyet merkezlerini ve ekipmanlarını, kullanıcıları ve kataloğu girin.

Yayına almak için projeyi Vercel'e (ya da Node.js çalıştıran herhangi bir sunucuya) bağlayıp aynı üç ortam değişkenini tanımlamak yeterlidir. Kamera (barkod) ve "ana ekrana ekle" için adresin HTTPS olması gerekir.

## Katalog ve stok (Excel)

Yönetim → Katalog bölümünden `.xlsx` dosyası yüklenir. İlk satır başlıktır:

| SKU | Malzeme Adı | Birim | Son Fiyat | Barkod | Fabrika Kodu | Stok |
| --- | --- | --- | --- | --- | --- | --- |
| RLM-6204-2Z | Rulman 6204-2Z (paslanmaz) | adet | 810 | 8690000000012 | IST | 0 |

- Yalnızca **SKU** ve **Malzeme Adı** zorunludur. Aynı ekrandan boş şablon indirilebilir.
- SKU'su kayıtlı malzeme güncellenir, yenisi eklenir; boş bırakılan hücreler mevcut değeri silmez.
- Stok, satırdaki fabrika için yazılır. Bir malzemenin birden fazla fabrikadaki stoku için satır tekrarlanır.
- Dosya her yüklendiğinde stok değerleri dosyadakiyle değiştirilir; uygulama stoktan kendisi düşmez.

## Testler

İş akışı ve yetki kuralları yerel Supabase'e karşı test edilir (Docker gerekir):

```bash
npx supabase start
```

```bash
npm test
```

## Klasörler

- `app/` — ekranlar (`(app)/` giriş gerektiren sayfalar, `api/admin/users` kullanıcı oluşturma)
- `components/`, `lib/` — oturum, barkod okuyucu, biçimlendirme, Excel ayrıştırma
- `supabase/migrations/` — şema, yetkiler (RLS) ve iş akışı fonksiyonları
- `tests/` — iş akışı ve yetki testleri
- `prototype/` — Claude Design'dan gelen ilk tıklanabilir prototip (yalnızca referans)

## Henüz olmayanlar

- Telefona anlık (push) bildirim — bildirimler şimdilik uygulama içindeki *Bildirim* sekmesinde görünür
- Tam çevrimdışı çalışma — yarım kalan talep cihazda taslak olarak saklanır, ancak göndermek ve listeleri görmek için bağlantı gerekir
- Depo rolü ve stok kontrol adımı — stok bilgisi Excel'den gelir, talep sırasında gösterilir
- Teklif dosyası / fotoğraf ekleme, raporlar, ERP entegrasyonu
- "Şifremi unuttum" e-postası — şifreyi yönetici Yönetim → Kullanıcılar'dan sıfırlar
