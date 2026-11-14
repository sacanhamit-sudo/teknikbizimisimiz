// Örnek kayıtları gerçek API üzerinden yükler: her adımı ilgili rolün hesabıyla yürütür.
// Kullanım: SIFRE=... NODE_USE_ENV_PROXY=1 node scripts/ornek-veri.mjs
const URL = 'https://pzclkevawmiqmqixudnt.supabase.co';
const KEY = 'sb_publishable_xU20CMCioALUunSwRPrlEg__Rf0ioTz';
const SIFRE = process.env.SIFRE;
const tok = {};
async function giris(u) {
  if (tok[u]) return tok[u];
  const r = await fetch(URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u + '@teknikbizimisimiz.app', password: SIFRE }) });
  const j = await r.json(); if (!j.access_token) throw new Error('giriş: ' + JSON.stringify(j));
  return (tok[u] = j.access_token);
}
async function is(u, a, p) {
  const r = await fetch(URL + '/functions/v1/islem', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + await giris(u), 'Content-Type': 'application/json' }, body: JSON.stringify({ a, p }) });
  const j = await r.json(); if (!j.ok) throw new Error(u + ' ' + a + ': ' + JSON.stringify(j));
  return j;
}
const gun = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const L = (sku, name, qty, unit, est) => ({ sku, name, qty, unit, est });
const T = async (u, machine, urgency, needIn, note, lines) => (await is(u, 'createTalep', { machine, urgency, need: gun(needIn), note, lines })).id;
const ok = (id, note) => is('levent', 'decideTalep', { id, ok: true, note });
const Q = (id, supplier, prices, lead, term, qnote) => is('ayse', 'addQuote', { id, supplier, prices, lead, term, qnote });
const send = (id, note) => is('ayse', 'sendQuotes', { id, note });
const qok = (id, note) => is('levent', 'decideQuote', { id, dec: 'ok', note });
const PO = (id, etaIn, note) => is('ayse', 'createPO', { id, eta: gun(etaIn), term: '30 gün', place: 'Bakım deposu', note });
const pok = (id) => is('levent', 'decidePO', { id, ok: true });
let t;

t = await T('okan', 'Paketleme 3', 'Yüksek', 6, 'Çene sıcaklığı düşüyor, yapışma hatası artıyor.', [L('REZ-220-450W', 'Çene ısıtıcı rezistans 220V 450W', 6, 'adet', 540)]);
await ok(t, 'Planlı duruşta değişsin'); await Q(t, 'Isı Teknik A.Ş.', [520], 3, '30 gün', '12 ay garanti'); await Q(t, 'Rezistans Dünyası', [565], 2, 'Peşin', '');
await send(t, 'Fiyat ve garanti avantajlı.'); await qok(t, 'Bütçe içinde'); await PO(t, 3); await pok(t);
await is('ayse', 'receive', { id: t, qtys: [6], irsaliye: 'IRS-44021' }); await is('okan', 'handover', { id: t });

t = await T('meral', 'CIP Hattı', 'Normal', 10, 'Yedek conta stoğu azalıyor.', [L('CNT-EPDM-80', 'Hijyenik conta EPDM DN80', 20, 'adet', 95)]);
await is('levent', 'decideTalep', { id: t, ok: false, note: 'Stokta 14 adet var, mevcut conta ile devam' });

t = await T('okan', 'Paketleme 3', 'Normal', 12, 'Zincir yağlama periyodu için.', [L('YAG-H1-5L', 'Zincir yağlayıcı NSF H1', 5, 'L', 310)]);
await ok(t); await Q(t, 'Lubrikant Kimya', [298], 4, '30 gün', 'NSF H1 sertifikalı'); await Q(t, 'Endüstri Yağ Ltd.', [325], 2, '15 gün', '');
await send(t, 'En uygun fiyat.'); await qok(t); await PO(t, 8); await pok(t);

t = await T('meral', 'Genel / Atölye', 'Normal', 9, 'Aylık yağlama sarfı.', [L('GRS-H1-400G', 'Gıda sınıfı gres NSF H1 400 g', 12, 'tüp', 185)]);
await ok(t); await Q(t, 'Lubrikant Kimya', [179], 3, '30 gün', ''); await Q(t, 'Teknik Yedek Ltd.', [192], 1, 'Peşin', '');
await send(t, ''); await qok(t); await PO(t, 6); await pok(t); await is('ayse', 'receive', { id: t, qtys: [6], irsaliye: 'IRS-45102' });

t = await T('meral', 'Dolum Hattı 1', 'Yüksek', 7, 'Bant kayışında yıpranma var.', [L('BNT-80-PU', 'Taşıyıcı bant kayışı 80 mm', 2, 'adet', 1240)]);
await ok(t); await Q(t, 'Anadolu Rulman A.Ş.', [1210], 2, '30 gün', ''); await Q(t, 'Bant Sistemleri Ltd.', [1290], 1, '15 gün', '');
await send(t, ''); await qok(t); await PO(t, 4); await pok(t); await is('ayse', 'receive', { id: t, qtys: [2], irsaliye: 'IRS-45377' });

t = await T('okan', 'Dolum Hattı 2', 'Kritik', 12, 'Servo arızası tekrarlıyor; revizyon yerine set değişimi öneriliyor.', [L('', 'Dolum makinesi servo motor ve sürücü seti', 1, 'takım', 120000)]);
await ok(t, 'Duruş riski yüksek'); await Q(t, 'Endüstri Otomasyon A.Ş.', [128400], 6, '45 gün', 'Orijinal · 24 ay garanti');
await Q(t, 'Motor Sistemleri Ltd.', [109700], 4, '30 gün', 'Muadil · 12 ay garanti'); await Q(t, 'Global Drive', [131900], 21, '60 gün', 'Orijinal · 24 ay garanti');
await send(t, 'Orijinal parça ve 24 ay garanti; 3 yıllık toplam maliyet daha düşük.'); await qok(t, 'Orijinal set ile devam edilmesi uygun');

t = await T('meral', 'Dolum Hattı 1', 'Yüksek', 7, 'Nozullarda damlama var, dolum tartı sapması %1,8.',
  [L('NZL-12-SS', 'Dolum nozulu 12 mm (paslanmaz)', 6, 'adet', 920), L('', 'O-ring takımı FDA silikon', 2, 'takım', 665)]);
await ok(t); await Q(t, 'Dolum Teknik A.Ş.', [905, 640], 4, '30 gün', ''); await Q(t, 'Paslanmaz Market', [960, 610], 2, 'Peşin', '');
await send(t, 'Toplamda en uygun.'); await qok(t);

t = await T('okan', 'Dolum Hattı 1', 'Kritik', 5, 'Vana sızdırıyor, hijyen riski.', [L('VNA-DN65-SS', 'Hijyenik kelebek vana DN65', 3, 'adet', 9500)]);
await ok(t); await Q(t, 'Vana Teknik A.Ş.', [9500], 3, '30 gün', 'Stoktan'); await Q(t, 'Hijyenik Akış Ltd.', [9150], 9, '30 gün', ''); await Q(t, 'Proses Armatür', [10200], 2, 'Peşin', '');
await send(t, 'Stoktan teslim; hat duruş riskini en hızlı kapatıyor.'); await qok(t, 'Aciliyet nedeniyle onaylandı'); await PO(t, 3, 'Acil sevk');

t = await T('okan', 'Pastörizatör 1', 'Yüksek', 6, 'Sensör sapması ±2°C, kalibrasyon tutmuyor.', [L('SNS-PT100-3M', 'Sıcaklık sensörü PT100 3 m', 2, 'adet', 1450)]);
await ok(t); await Q(t, 'Ölçüm Kontrol A.Ş.', [1420], 3, '30 gün', 'Kalibrasyon sertifikalı'); await Q(t, 'Sensör Market', [1290], 7, 'Peşin', ''); await Q(t, 'Teknik Yedek Ltd.', [1510], 1, '15 gün', '');
await send(t, 'Sertifikalı ürün; teslim süresi uygun.');

t = await T('okan', 'Dolum Hattı 2', 'Kritik', -1, 'Taşıyıcı bant rulmanı ses yapıyor, hat duruşu riski.', [L('RLM-6204-2Z', 'Rulman 6204-2Z (paslanmaz)', 4, 'adet', 810)]);
await ok(t, 'Acil'); await Q(t, 'Anadolu Rulman A.Ş.', [810], 2, '30 gün', '12 ay garanti'); await Q(t, 'Teknik Yedek Ltd.', [970], 1, 'Peşin', '6 ay garanti');

await T('meral', 'CIP Hattı', 'Yüksek', 8, 'Planlı bakımda salmastra değişecek.', [L('SLM-CIP-40', 'CIP pompası salmastra takımı', 2, 'takım', 3950)]);
await T('okan', 'Paketleme 3', 'Normal', 13, 'Paletleyici pedleri sertleşmiş.', [L('VKM-PED-80', 'Vakum pedi 80 mm (gıda uyumlu)', 8, 'adet', 150)]);

// yetki kontrolü: teknisyen onay veremez, satınalma talep açamaz
for (const [u, a, p] of [['okan', 'decideTalep', { id: t, ok: true }], ['ayse', 'createTalep', {}], ['meral', 'kullaniciEkle', {}]]) {
  try { await is(u, a, p); console.log('HATA: izin verildi', u, a); } catch (e) { console.log('reddedildi ✓', e.message); }
}
console.log('tamam');
