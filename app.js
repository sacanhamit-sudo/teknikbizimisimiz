/* Teknik Satınalma — talep → onay → teklif → değerlendirme onayı → sipariş → sipariş onayı → mal kabul → teslim
   Veriler bu cihazın tarayıcısında (localStorage) tutulur; sunucu yoktur. */
'use strict';
(() => {

const KEY = 'tbi-satinalma-v1';
const LIM_TALEP = 1500;      // bu tutarın üstündeki talepler Fabrika Müdürü talep onayına gider
const LIM_GM = 100000;       // bu tutarın üstündeki alımlar Genel Müdür onayına yükselir
const KDV = 0.20;

const ROLES = {
  teknisyen: { ad: 'Bakım Teknisyeni', c: '#17624A' },
  satinalma: { ad: 'Satınalma Uzmanı', c: '#2E5FA3' },
  mudur: { ad: 'Fabrika Müdürü', c: '#7A4FA8' },
  gm: { ad: 'Genel Müdür', c: '#14181A' },
};
const ST = {
  talep_onayi: { ad: 'Talep onayında', t: 'amber', i: 1 },
  teklif: { ad: 'Teklif toplanıyor', t: 'blue', i: 2 },
  teklif_onayi: { ad: 'Teklif onayında', t: 'amber', i: 3 },
  gm_onayi: { ad: 'Genel Müdür onayında', t: 'amber', i: 4 },
  siparis_bekliyor: { ad: 'Sipariş açılacak', t: 'blue', i: 5 },
  siparis_onayi: { ad: 'Sipariş onayında', t: 'amber', i: 6 },
  tedarikte: { ad: 'Sipariş verildi', t: 'green', i: 7 },
  kismi: { ad: 'Kısmi teslim', t: 'green', i: 7 },
  depoda: { ad: 'Depoda · teslim alınacak', t: 'green', i: 8 },
  teslim: { ad: 'Teslim edildi', t: 'gray', i: 9 },
  reddedildi: { ad: 'Reddedildi', t: 'red', i: -1 },
  iptal: { ad: 'İptal edildi', t: 'gray', i: -1 },
};
const PST = {
  onay_bekliyor: { ad: 'Onay bekliyor', t: 'amber' },
  tedarikte: { ad: 'Tedarikçide', t: 'blue' },
  kismi: { ad: 'Kısmi teslim', t: 'green' },
  teslim: { ad: 'Teslim alındı', t: 'gray' },
  reddedildi: { ad: 'Reddedildi', t: 'red' },
};
const MAKINELER = ['Dolum Hattı 1', 'Dolum Hattı 2', 'Pastörizatör 1', 'Paketleme 3', 'CIP Hattı', 'Genel / Atölye'];
const BIRIMLER = ['adet', 'takım', 'L', 'kg', 'm', 'tüp'];

/* ---------- yardımcılar ---------- */
let _now = null;
const now = () => _now || new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₺' + (Number(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const num = (s) => {
  s = String(s ?? '').trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};
const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const p2 = (n) => String(n).padStart(2, '0');
const dStr = (iso) => { const d = new Date(iso); return d.getDate() + ' ' + AY[d.getMonth()]; };
const dtStr = (iso) => { const d = new Date(iso); return dStr(iso) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const dayISO = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const addDays = (n, from) => { const d = from ? new Date(from) : new Date(now()); d.setDate(d.getDate() + n); return dayISO(d); };
const today = () => dayISO(new Date());
const initials = (ad) => ad.split(' ').map((x) => x[0]).join('').slice(0, 2);

/* ---------- veri ---------- */
let db;
const user = (id) => db.users.find((u) => u.id === id) || { ad: 'Sistem', role: '' };
const me = () => user(db.currentUser);
const talep = (id) => db.talepler.find((t) => t.id === id);
const po = (id) => db.siparisler.find((p) => p.id === id);
const item = (sku) => db.items.find((m) => m.sku === sku);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* depolama kapalı olabilir */ } };

const estTotal = (t) => t.lines.reduce((s, l) => s + l.qty * l.est, 0);
const qTotal = (t, q) => t.lines.reduce((s, l, i) => s + l.qty * (q.prices[i] || 0), 0);
const picked = (t) => t.quotes.find((q) => q.id === t.pick);
const tTotal = (t) => { const p = t.poId && po(t.poId); if (p) return p.subtotal; const q = picked(t); return q ? qTotal(t, q) : estTotal(t); };
const tTitle = (t) => t.lines[0].name + (t.lines.length > 1 ? ' +' + (t.lines.length - 1) + ' kalem' : '');
const isOpen = (t) => ST[t.status].i > 0 && t.status !== 'teslim';
const isLate = (t) => isOpen(t) && t.need < today();

function log(t, text) { t.log.unshift({ at: now(), by: db.currentUser, text }); }
function stamp(t, i, text) { t.stamps[i] = dStr(now()) + ' · ' + text; }
function notify(to, text, talepId) {
  if (to === db.currentUser) return;
  db.bildirimler.unshift({ id: uid(), at: now(), to, text, talepId, read: [] });
}

/* ---------- iş akışı ---------- */
function createTalep(d) {
  const t = {
    id: uid(), no: 'TLP-' + db.seq.tlp++, by: db.currentUser, at: now(),
    machine: d.machine, urgency: d.urgency, need: d.need, note: d.note || '',
    lines: d.lines, quotes: [], pick: null, pickNote: '', poId: null, log: [], stamps: {}, gm: false, direct: false,
  };
  const tot = estTotal(t);
  stamp(t, 0, me().ad);
  log(t, 'Talep oluşturuldu · tahmini ' + money(tot));
  if (tot > LIM_TALEP) {
    t.status = 'talep_onayi';
    notify('role:mudur', t.no + ' talep onayınızı bekliyor (' + money(tot) + ')', t.id);
  } else {
    t.status = 'teklif'; t.direct = true;
    stamp(t, 1, 'Gerekmedi (limit altı)');
    log(t, 'Limit altı — onaysız satınalmaya düştü');
    notify('role:satinalma', t.no + ' satınalma masasına düştü', t.id);
  }
  db.talepler.unshift(t);
  return t;
}
function decideTalep(t, ok, note) {
  if (ok) {
    t.status = 'teklif'; stamp(t, 1, me().ad + ' onayladı');
    log(t, 'Talep onaylandı' + (note ? ': ' + note : ''));
    notify(t.by, t.no + ' talebiniz onaylandı, teklif toplanıyor', t.id);
    notify('role:satinalma', t.no + ' satınalma masasına düştü', t.id);
  } else stop(t, 1, 'reddedildi', 'Talep reddedildi', note);
}
function stop(t, i, status, text, note) {
  t.stopAt = i; t.status = status; stamp(t, i, me().ad + (status === 'iptal' ? ' iptal etti' : ' reddetti'));
  log(t, text + (note ? ': ' + note : ''));
  notify(t.by, t.no + ' — ' + text.toLowerCase() + (note ? ': ' + note : ''), t.id);
  if (i > 1) notify('role:satinalma', t.no + ' — ' + text.toLowerCase(), t.id);
}
function addQuote(t, q) {
  const o = { id: uid(), at: now(), by: db.currentUser, ...q };
  t.quotes.push(o);
  if (!t.pick) t.pick = o.id;
  log(t, 'Teklif eklendi: ' + q.supplier + ' · ' + money(qTotal(t, o)));
}
function delQuote(t, id) {
  const q = t.quotes.find((x) => x.id === id);
  t.quotes = t.quotes.filter((x) => x.id !== id);
  if (t.pick === id) t.pick = t.quotes[0] ? t.quotes[0].id : null;
  log(t, 'Teklif silindi: ' + q.supplier);
}
function sendQuotes(t, note) {
  const q = picked(t);
  t.pickNote = note || ''; t.status = 'teklif_onayi';
  stamp(t, 2, t.quotes.length + ' teklif · öneri ' + q.supplier);
  log(t, 'Teklifler değerlendirme onayına gönderildi · öneri: ' + q.supplier + ' ' + money(qTotal(t, q)));
  notify('role:mudur', t.no + ' teklif değerlendirme onayınızı bekliyor (' + money(qTotal(t, q)) + ')', t.id);
}
function decideQuote(t, dec, note) {
  const isGm = t.status === 'gm_onayi', i = isGm ? 4 : 3, tot = tTotal(t);
  if (dec === 'ok') {
    if (!isGm && tot > LIM_GM) {
      t.status = 'gm_onayi'; t.gm = true; stamp(t, 3, me().ad + ' uygun gördü');
      log(t, 'Uygun görüş verildi; ' + money(LIM_GM) + ' üzeri — Genel Müdür onayına yükseltildi' + (note ? ': ' + note : ''));
      notify('role:gm', t.no + ' alım onayınızı bekliyor (' + money(tot) + ')', t.id);
    } else {
      t.status = 'siparis_bekliyor'; stamp(t, i, me().ad + ' onayladı');
      log(t, 'Teklif onaylandı: ' + picked(t).supplier + (note ? ' — ' + note : ''));
      notify('role:satinalma', t.no + ' teklifi onaylandı, sipariş açabilirsiniz', t.id);
      notify(t.by, t.no + ' için tedarikçi onaylandı', t.id);
    }
  } else if (dec === 'rev') {
    t.status = 'teklif'; delete t.stamps[2]; delete t.stamps[3];
    log(t, 'Revizyon istendi' + (note ? ': ' + note : ''));
    notify('role:satinalma', t.no + ' için revizyon / ek teklif istendi' + (note ? ': ' + note : ''), t.id);
  } else stop(t, i, 'reddedildi', 'Alım reddedildi', note);
}
function createPO(t, d) {
  const q = picked(t);
  const lines = t.lines.map((l, i) => ({ sku: l.sku, name: l.name, qty: l.qty, unit: l.unit, price: q.prices[i] || 0, received: 0 }));
  const subtotal = qTotal(t, q);
  const p = {
    id: uid(), no: 'SAS-' + new Date(now()).getFullYear() + '-' + String(db.seq.sas++).padStart(4, '0'),
    talepId: t.id, supplier: q.supplier, lines, subtotal, kdv: subtotal * KDV, total: subtotal * (1 + KDV),
    eta: d.eta, term: d.term || q.term || '', place: d.place || '', note: d.note || '',
    status: 'onay_bekliyor', approver: subtotal > LIM_GM ? 'gm' : 'mudur', at: now(), by: db.currentUser, receipts: [],
  };
  db.siparisler.unshift(p);
  t.poId = p.id; t.status = 'siparis_onayi';
  stamp(t, 5, p.no + ' · ' + q.supplier);
  log(t, 'Sipariş oluşturuldu: ' + p.no + ' · ' + money(p.total) + ' (KDV dahil)');
  notify('role:' + p.approver, p.no + ' sipariş onayınızı bekliyor (' + money(p.total) + ')', t.id);
  return p;
}
function decidePO(t, ok, note) {
  const p = po(t.poId);
  if (ok) {
    p.status = 'tedarikte'; t.status = 'tedarikte'; stamp(t, 6, me().ad + ' onayladı');
    log(t, p.no + ' siparişi onaylandı, tedarikçiye iletildi' + (note ? ' — ' + note : ''));
    notify('role:satinalma', p.no + ' onaylandı, tedarikçiye iletebilirsiniz', t.id);
    notify(t.by, t.no + ' siparişi verildi · tahmini teslim ' + dStr(p.eta), t.id);
  } else {
    p.status = 'reddedildi'; t.poId = null; t.status = 'siparis_bekliyor'; delete t.stamps[5];
    log(t, p.no + ' siparişi reddedildi' + (note ? ': ' + note : ''));
    notify('role:satinalma', p.no + ' reddedildi, siparişi yeniden düzenleyin' + (note ? ': ' + note : ''), t.id);
  }
}
function receive(t, qtys, irsaliye) {
  const p = po(t.poId), items = [];
  p.lines.forEach((l, i) => {
    const q = Math.min(Math.max(qtys[i] || 0, 0), l.qty - l.received);
    if (!q) return;
    l.received += q; items.push({ i, qty: q });
    const m = item(l.sku); if (m) { m.stock += q; m.last = l.price; }
  });
  p.receipts.unshift({ at: now(), by: db.currentUser, irsaliye: irsaliye || '', items });
  const full = p.lines.every((l) => l.received >= l.qty);
  p.status = full ? 'teslim' : 'kismi'; t.status = full ? 'depoda' : 'kismi';
  const txt = items.map((x) => p.lines[x.i].name + ' ' + x.qty + ' ' + p.lines[x.i].unit).join(', ');
  log(t, (full ? 'Mal kabul tamamlandı' : 'Kısmi mal kabul') + (irsaliye ? ' · irsaliye ' + irsaliye : '') + ' · ' + txt);
  if (full) { stamp(t, 7, 'Depoya girdi'); notify(t.by, t.no + ' malzemeniz depoda, teslim alabilirsiniz', t.id); }
  else notify(t.by, t.no + ' için kısmi teslimat depoya girdi', t.id);
}
function handover(t) {
  t.lines.forEach((l) => { const m = item(l.sku); if (m) m.stock = Math.max(0, m.stock - l.qty); });
  t.status = 'teslim'; stamp(t, 8, me().ad + ' teslim aldı');
  log(t, 'Malzeme depodan teslim alındı, talep kapandı');
  notify('role:satinalma', t.no + ' teslim alındı ve kapandı', t.id);
}

/* ---------- örnek veri ---------- */
function seed() {
  db = {
    v: 1, seq: { tlp: 2405, sas: 414 }, currentUser: null, talepler: [], siparisler: [], bildirimler: [],
    users: [
      { id: 'okan', ad: 'Okan Yalçın', role: 'teknisyen' }, { id: 'meral', ad: 'Meral Koç', role: 'teknisyen' },
      { id: 'ayse', ad: 'Ayşe Tuna', role: 'satinalma' }, { id: 'levent', ad: 'Levent Arslan', role: 'mudur' },
      { id: 'kemal', ad: 'Kemal Demir', role: 'gm' },
    ],
    items: [
      ['RLM-6204-2Z', 'Rulman 6204-2Z (paslanmaz)', 'adet', 0, 4, 810], ['BNT-80-PU', 'Taşıyıcı bant kayışı 80 mm', 'adet', 2, 2, 1240],
      ['YTK-UCP204', 'Rulman yatağı UCP 204', 'adet', 3, 2, 460], ['GRS-H1-400G', 'Gıda sınıfı gres NSF H1 400 g', 'tüp', 2, 6, 185],
      ['SNS-PT100-3M', 'Sıcaklık sensörü PT100 3 m', 'adet', 1, 2, 1450], ['YAG-H1-5L', 'Zincir yağlayıcı NSF H1', 'L', 2, 5, 310],
      ['REZ-220-450W', 'Çene ısıtıcı rezistans 220V 450W', 'adet', 2, 4, 540], ['CNT-EPDM-80', 'Hijyenik conta EPDM DN80', 'adet', 14, 10, 95],
      ['SLM-CIP-40', 'CIP pompası salmastra takımı', 'takım', 0, 1, 3950], ['VKM-PED-80', 'Vakum pedi 80 mm (gıda uyumlu)', 'adet', 5, 8, 150],
      ['VNA-DN65-SS', 'Hijyenik kelebek vana DN65', 'adet', 1, 1, 9500], ['NZL-12-SS', 'Dolum nozulu 12 mm (paslanmaz)', 'adet', 2, 6, 920],
    ].map(([sku, name, unit, stock, min, last]) => ({ sku, name, unit, stock, min, last })),
  };
  const as = (u, daysAgo, h, m) => { db.currentUser = u; const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m || 0, 0, 0); _now = d.toISOString(); };
  const L = (sku, qty, est, name, unit) => { const it = item(sku); return { sku: it ? sku : 'SERBEST', name: name || it.name, qty, unit: unit || it.unit, est: est ?? it.last }; };
  const T = (u, d, h, machine, urgency, needIn, note, lines) => { as(u, d, h, 12); return createTalep({ machine, urgency, need: addDays(needIn), note, lines }); };
  const Q = (t, d, supplier, prices, lead, term, note) => { as('ayse', d, 11, 20); addQuote(t, { supplier, prices, lead, term, note }); };
  const send = (t, d, pick, note) => { as('ayse', d, 15); t.pick = t.quotes[pick].id; sendQuotes(t, note); };
  let t;

  t = T('okan', 14, 8, 'Paketleme 3', 'Yüksek', 6, 'Çene sıcaklığı düşüyor, yapışma hatası artıyor.', [L('REZ-220-450W', 6)]);
  as('levent', 14, 9); decideTalep(t, true, 'Planlı duruşta değişsin');
  Q(t, 13, 'Isı Teknik A.Ş.', [520], 3, '30 gün', '12 ay garanti'); Q(t, 13, 'Rezistans Dünyası', [565], 2, 'Peşin', '');
  send(t, 13, 0, 'Fiyat ve garanti avantajlı.'); as('levent', 12, 9); decideQuote(t, 'ok', 'Bütçe içinde');
  as('ayse', 12, 10); createPO(t, { eta: addDays(3), term: '30 gün', place: 'Bakım deposu' });
  as('levent', 12, 14); decidePO(t, true); as('ayse', 9, 10); receive(t, [6], 'IRS-44021'); as('okan', 9, 13); handover(t);

  t = T('meral', 10, 7, 'CIP Hattı', 'Normal', 10, 'Yedek conta stoğu azalıyor.', [L('CNT-EPDM-80', 20)]);
  as('levent', 10, 9); decideTalep(t, false, 'Stokta 14 adet var, mevcut conta ile devam');

  t = T('okan', 8, 8, 'Paketleme 3', 'Normal', 12, 'Zincir yağlama periyodu için.', [L('YAG-H1-5L', 5)]);
  as('levent', 8, 10); decideTalep(t, true);
  Q(t, 7, 'Lubrikant Kimya', [298], 4, '30 gün', 'NSF H1 sertifikalı'); Q(t, 7, 'Endüstri Yağ Ltd.', [325], 2, '15 gün', '');
  send(t, 7, 0, 'En uygun fiyat.'); as('levent', 6, 9); decideQuote(t, 'ok');
  as('ayse', 6, 11); createPO(t, { eta: addDays(8), term: '30 gün', place: 'Bakım deposu' }); as('levent', 6, 15); decidePO(t, true);

  t = T('meral', 7, 9, 'Genel / Atölye', 'Normal', 9, 'Aylık yağlama sarfı.', [L('GRS-H1-400G', 12)]);
  as('levent', 7, 10); decideTalep(t, true);
  Q(t, 6, 'Lubrikant Kimya', [179], 3, '30 gün', ''); Q(t, 6, 'Teknik Yedek Ltd.', [192], 1, 'Peşin', '');
  send(t, 6, 0, ''); as('levent', 5, 9); decideQuote(t, 'ok');
  as('ayse', 5, 10); createPO(t, { eta: addDays(6), term: '30 gün', place: 'Bakım deposu' }); as('levent', 5, 13); decidePO(t, true);
  as('ayse', 2, 10); receive(t, [6], 'IRS-45102');

  t = T('meral', 6, 8, 'Dolum Hattı 1', 'Yüksek', 7, 'Bant kayışında yıpranma var.', [L('BNT-80-PU', 2)]);
  as('levent', 6, 9); decideTalep(t, true);
  Q(t, 5, 'Anadolu Rulman A.Ş.', [1210], 2, '30 gün', ''); Q(t, 5, 'Bant Sistemleri Ltd.', [1290], 1, '15 gün', '');
  send(t, 5, 0, ''); as('levent', 4, 9); decideQuote(t, 'ok');
  as('ayse', 4, 10); createPO(t, { eta: addDays(4), term: '30 gün', place: 'Bakım deposu' }); as('levent', 4, 12); decidePO(t, true);
  as('ayse', 1, 11); receive(t, [2], 'IRS-45377');

  t = T('okan', 5, 17, 'Dolum Hattı 2', 'Kritik', 12, 'Servo arızası tekrarlıyor; revizyon yerine set değişimi öneriliyor.',
    [L('X', 1, 120000, 'Dolum makinesi servo motor ve sürücü seti', 'takım')]);
  as('levent', 4, 8); decideTalep(t, true, 'Duruş riski yüksek');
  Q(t, 3, 'Endüstri Otomasyon A.Ş.', [128400], 6, '45 gün', 'Orijinal · 24 ay garanti');
  Q(t, 3, 'Motor Sistemleri Ltd.', [109700], 4, '30 gün', 'Muadil · 12 ay garanti');
  Q(t, 3, 'Global Drive', [131900], 21, '60 gün', 'Orijinal · 24 ay garanti');
  send(t, 2, 0, 'Orijinal parça ve 24 ay garanti; 3 yıllık toplam maliyet daha düşük.');
  as('levent', 1, 17, 20); decideQuote(t, 'ok', 'Orijinal set ile devam edilmesi uygun');

  t = T('meral', 4, 6, 'Dolum Hattı 1', 'Yüksek', 7, 'Nozullarda damlama var, dolum tartı sapması %1,8.',
    [L('NZL-12-SS', 6), L('X', 2, 665, 'O-ring takımı FDA silikon', 'takım')]);
  as('levent', 4, 9); decideTalep(t, true);
  Q(t, 3, 'Dolum Teknik A.Ş.', [905, 640], 4, '30 gün', ''); Q(t, 3, 'Paslanmaz Market', [960, 610], 2, 'Peşin', '');
  send(t, 2, 0, 'Toplamda en uygun.'); as('levent', 1, 10); decideQuote(t, 'ok');

  t = T('okan', 4, 10, 'Dolum Hattı 1', 'Kritik', 5, 'Vana sızdırıyor, hijyen riski.', [L('VNA-DN65-SS', 3)]);
  as('levent', 4, 11); decideTalep(t, true);
  Q(t, 3, 'Vana Teknik A.Ş.', [9500], 3, '30 gün', 'Stoktan'); Q(t, 3, 'Hijyenik Akış Ltd.', [9150], 9, '30 gün', '');
  Q(t, 2, 'Proses Armatür', [10200], 2, 'Peşin', '');
  send(t, 2, 0, 'Stoktan teslim; hat duruş riskini en hızlı kapatıyor.'); as('levent', 1, 9); decideQuote(t, 'ok', 'Aciliyet nedeniyle onaylandı');
  as('ayse', 0, 8, 30); createPO(t, { eta: addDays(3), term: '30 gün', place: 'Bakım deposu', note: 'Acil sevk' });

  t = T('okan', 3, 8, 'Pastörizatör 1', 'Yüksek', 6, 'Sensör sapması ±2°C, kalibrasyon tutmuyor.', [L('SNS-PT100-3M', 2)]);
  as('levent', 3, 9); decideTalep(t, true);
  Q(t, 2, 'Ölçüm Kontrol A.Ş.', [1420], 3, '30 gün', 'Kalibrasyon sertifikalı'); Q(t, 2, 'Sensör Market', [1290], 7, 'Peşin', '');
  Q(t, 1, 'Teknik Yedek Ltd.', [1510], 1, '15 gün', '');
  send(t, 1, 0, 'Sertifikalı ürün; teslim süresi uygun.');

  t = T('okan', 2, 7, 'Dolum Hattı 2', 'Kritik', 1, 'Taşıyıcı bant rulmanı ses yapıyor, hat duruşu riski.', [L('RLM-6204-2Z', 4)]);
  as('levent', 2, 8); decideTalep(t, true, 'Acil');
  Q(t, 1, 'Anadolu Rulman A.Ş.', [810], 2, '30 gün', '12 ay garanti'); Q(t, 1, 'Teknik Yedek Ltd.', [970], 1, 'Peşin', '6 ay garanti');

  t = T('meral', 0, 6, 'CIP Hattı', 'Yüksek', 8, 'Planlı bakımda salmastra değişecek.', [L('SLM-CIP-40', 2)]);
  t = T('okan', 0, 9, 'Paketleme 3', 'Normal', 13, 'Paletleyici pedleri sertleşmiş.', [L('VKM-PED-80', 8)]);

  _now = null; db.currentUser = null;
}
function load() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
  if (!db || db.v !== 1) { seed(); save(); }
}

/* ---------- arayüz durumu ---------- */
const ui = { tab: 'gorev', page: null, f: {}, filt: 'Tümü', seg: null };
const set = (k, v) => { ui.f[k] = v; };
const fv = (k, d = '') => (ui.f[k] ?? d);
function open(page, fresh = true) { if (fresh) ui.f = {}; ui.page = page; history.pushState({ p: 1 }, ''); render(); window.scrollTo(0, 0); }
function closePage() { ui.page = null; ui.f = {}; render(); }
window.addEventListener('popstate', () => { if (ui.page) closePage(); });
const back = () => history.back();
let toastT;
function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }

const myNotifs = () => db.bildirimler.filter((n) => n.to === db.currentUser || n.to === 'role:' + me().role);
const unread = () => myNotifs().filter((n) => !n.read.includes(db.currentUser)).length;

/* rolün yapması gereken işler */
function tasks() {
  const r = me().role, T = db.talepler, by = (s) => T.filter((t) => t.status === s);
  if (r === 'teknisyen') return [{ ad: 'Depodan teslim alınacak', list: by('depoda').filter((t) => t.by === db.currentUser) }];
  if (r === 'satinalma') return [
    { ad: 'Teklif toplanacak', list: by('teklif') }, { ad: 'Sipariş açılacak', list: by('siparis_bekliyor') },
    { ad: 'Mal kabul bekleyen', list: T.filter((t) => t.status === 'tedarikte' || t.status === 'kismi') }];
  const poOf = (role) => by('siparis_onayi').filter((t) => po(t.poId).approver === role);
  if (r === 'mudur') return [{ ad: 'Talep onayı', list: by('talep_onayi') }, { ad: 'Teklif değerlendirme onayı', list: by('teklif_onayi') }, { ad: 'Sipariş onayı', list: poOf('mudur') }];
  return [{ ad: 'Alım onayı (₺100.000 üzeri)', list: by('gm_onayi') }, { ad: 'Sipariş onayı', list: poOf('gm') }];
}
const taskCount = () => tasks().reduce((s, g) => s + g.list.length, 0);

/* ---------- bileşenler ---------- */
const badge = (s, map = ST) => `<span class="badge ${map[s].t}">${map[s].ad}</span>`;
const urg = (u) => `<span class="urg ${u}"><i></i>${u}</span>`;
function talepCard(t) {
  const late = isLate(t);
  return `<button class="card tap ${late ? 'late' : ''}" data-a="openTalep" data-id="${t.id}">
    <div class="row"><span class="mono">${t.no}</span><span class="sp"></span>${badge(t.status)}</div>
    <div class="ttl">${esc(tTitle(t))}</div>
    <div class="row wrap meta">${urg(t.urgency)}<span>· ${esc(t.machine)}</span><span>· ${esc(user(t.by).ad)}</span></div>
    <div class="row meta" style="margin-top:6px"><span style="${late ? 'color:var(--red);font-weight:600' : ''}">${late ? 'Gecikti · ' : 'İhtiyaç '}${dStr(t.need)}</span><span class="sp"></span><b style="color:var(--ink)">${money(tTotal(t))}</b></div>
  </button>`;
}
function poCard(p) {
  const tot = p.lines.reduce((s, l) => s + l.qty, 0), rec = p.lines.reduce((s, l) => s + l.received, 0);
  return `<button class="card tap" data-a="openPO" data-id="${p.id}">
    <div class="row"><span class="mono">${p.no}</span><span class="sp"></span>${badge(p.status, PST)}</div>
    <div class="ttl">${esc(p.supplier)}</div>
    <div class="meta">${esc(p.lines[0].name)}${p.lines.length > 1 ? ' +' + (p.lines.length - 1) : ''}</div>
    <div class="row meta" style="margin:6px 0"><span>Teslim ${dStr(p.eta)}</span><span class="sp"></span><b style="color:var(--ink)">${money(p.total)}</b></div>
    <div class="bar"><i style="width:${Math.round(rec / tot * 100)}%"></i></div>
  </button>`;
}
const ICON = {
  gorev: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9"/>',
  talepler: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  siparisler: '<path d="M3 7h13v10H3zM16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  stok: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  bildirim: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>',
};
function tabs() {
  const defs = [['gorev', 'Görevler', taskCount()], ['talepler', 'Talepler', 0], ['siparisler', 'Siparişler', 0], ['stok', 'Stok', 0], ['bildirim', 'Bildirim', unread()]];
  return `<nav class="tabs">${defs.map(([k, ad, n]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="tab" data-k="${k}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>${ad}${n ? `<span class="dot">${n}</span>` : ''}</button>`).join('')}</nav>`;
}
const top = (title, sub) => `<header class="top"><div style="flex:1;min-width:0"><div class="sub">${sub}</div><h1>${title}</h1></div>
  <button class="avatar" data-a="profil" aria-label="Profil">${initials(me().ad)}</button></header>`;
const topBack = (title, sub) => `<header class="top"><button class="back" data-a="back" aria-label="Geri">‹</button><div style="flex:1;min-width:0"><div class="sub">${sub || ''}</div><h1>${title}</h1></div></header>`;

/* ---------- ekranlar ---------- */
function vLogin() {
  return `<div class="login"><div class="mono">TEKNİK SATINALMA · DEMO</div><h1>Kim olarak giriş yapıyorsunuz?</h1>
    <p class="meta" style="margin:0 0 6px">Şifre yok; rolü seçin, o kişinin ekranını görün. Her rol akışın kendi adımını yürütür.</p>
    ${db.users.map((u) => `<button class="card tap user" data-a="login" data-id="${u.id}"><span class="av" style="background:${ROLES[u.role].c}">${initials(u.ad)}</span>
      <span><b>${esc(u.ad)}</b><br><span class="meta">${ROLES[u.role].ad}</span></span></button>`).join('')}</div>`;
}
function vGorev() {
  const g = tasks(), T = db.talepler, r = me().role;
  const mine = r === 'teknisyen' ? T.filter((t) => t.by === db.currentUser) : T;
  const stats = [[taskCount(), 'Bekleyen işim'], [mine.filter(isOpen).length, r === 'teknisyen' ? 'Açık talebim' : 'Açık talep'],
    [db.siparisler.filter((p) => p.status === 'tedarikte' || p.status === 'kismi').length, 'Yoldaki sipariş'], [mine.filter(isLate).length, 'Geciken']];
  let h = top('Merhaba, ' + esc(me().ad.split(' ')[0]), ROLES[r].ad);
  h += `<main><div class="stats">${stats.map(([n, ad], i) => `<div class="stat ${i === 3 && n ? 'warn' : ''}"><b>${n}</b><span>${ad}</span></div>`).join('')}</div>`;
  g.forEach((s) => { h += `<div class="h2">${s.ad} <b>${s.list.length}</b></div>` + (s.list.map(talepCard).join('') || `<div class="card empty" style="padding:14px">Bekleyen iş yok</div>`); });
  if (r === 'teknisyen') {
    const acik = mine.filter((t) => isOpen(t) && t.status !== 'depoda');
    h += `<div class="h2">Devam eden taleplerim <b>${acik.length}</b></div>` + (acik.map(talepCard).join('') || `<div class="card empty">Açık talebiniz yok</div>`);
    h += `<button class="fab" data-a="yeni">+ Yeni talep</button>`;
  }
  return h + '</main>' + tabs();
}
function vTalepler() {
  const r = me().role, chips = ['Tümü', ...(r === 'teknisyen' ? ['Benim'] : []), 'Onayda', 'Tedarikte', 'Geciken', 'Kapalı'];
  const q = fv('q').trim().toLocaleLowerCase('tr');
  const F = { Tümü: () => true, Benim: (t) => t.by === db.currentUser, Onayda: (t) => ST[t.status].t === 'amber',
    Tedarikte: (t) => ['teklif', 'siparis_bekliyor', 'tedarikte', 'kismi', 'depoda'].includes(t.status), Geciken: isLate, Kapalı: (t) => !isOpen(t) };
  const list = db.talepler.filter(F[ui.filt] || F.Tümü).filter((t) => !q || (t.no + ' ' + t.lines.map((l) => l.name + ' ' + l.sku).join(' ') + ' ' + user(t.by).ad + ' ' + t.machine).toLocaleLowerCase('tr').includes(q));
  return top('Talepler', 'Tüm talepler ve durumları') + `<main>
    <input class="in" placeholder="Talep no, malzeme, kişi ara…" data-bind="q" data-live value="${esc(fv('q'))}">
    <div class="chips">${chips.map((c) => `<button class="chip ${ui.filt === c ? 'on' : ''}" data-a="filt" data-k="${c}">${c}</button>`).join('')}</div>
    ${list.map(talepCard).join('') || '<div class="empty">Kayıt bulunamadı</div>'}
    ${r === 'teknisyen' ? '<button class="fab" data-a="yeni">+ Yeni talep</button>' : ''}</main>` + tabs();
}
function vSiparisler() {
  const chips = ['Tümü', 'Onayda', 'Yolda', 'Teslim'];
  const F = { Tümü: () => true, Onayda: (p) => p.status === 'onay_bekliyor', Yolda: (p) => p.status === 'tedarikte' || p.status === 'kismi', Teslim: (p) => p.status === 'teslim' };
  const list = db.siparisler.filter(F[ui.filt] || F.Tümü);
  return top('Siparişler', 'Satınalma siparişleri') + `<main>
    <div class="chips">${chips.map((c) => `<button class="chip ${ui.filt === c ? 'on' : ''}" data-a="filt" data-k="${c}">${c}</button>`).join('')}</div>
    ${list.map(poCard).join('') || '<div class="empty">Sipariş yok</div>'}</main>` + tabs();
}
function stockInfo(m) {
  let yolda = 0, talepte = 0;
  db.siparisler.forEach((p) => { if (['onay_bekliyor', 'tedarikte', 'kismi'].includes(p.status)) p.lines.forEach((l) => { if (l.sku === m.sku) yolda += l.qty - l.received; }); });
  db.talepler.forEach((t) => { if (isOpen(t) && !t.poId) t.lines.forEach((l) => { if (l.sku === m.sku) talepte += l.qty; }); });
  return { yolda, talepte, eksik: m.stock + yolda + talepte < m.min };
}
function vStok() {
  const q = fv('q').trim().toLocaleLowerCase('tr');
  const list = db.items.filter((m) => !q || (m.name + ' ' + m.sku).toLocaleLowerCase('tr').includes(q)).map((m) => ({ m, s: stockInfo(m) })).sort((a, b) => b.s.eksik - a.s.eksik);
  return top('Stok', 'Malzeme durumu ve ihtiyaç') + `<main>
    <input class="in" placeholder="Malzeme veya stok kodu ara…" data-bind="q" data-live value="${esc(fv('q'))}">
    ${list.map(({ m, s }) => `<div class="card"><div class="row"><span class="mono">${m.sku}</span><span class="sp"></span>
      <span class="badge ${s.eksik ? 'red' : m.stock < m.min ? 'amber' : 'green'}">${s.eksik ? 'Talep açılmalı' : m.stock < m.min ? 'Tedarik sürüyor' : 'Yeterli'}</span></div>
      <div class="ttl">${esc(m.name)}</div>
      <div class="row meta wrap"><span>Stok <b style="color:var(--ink)">${m.stock} ${m.unit}</b></span><span>· Min ${m.min}</span><span>· Yolda ${s.yolda}</span><span>· Talepte ${s.talepte}</span></div>
      ${s.eksik && me().role === 'teknisyen' ? `<button class="btn sm" style="margin-top:10px" data-a="yeni" data-sku="${m.sku}" data-qty="${m.min - m.stock - s.yolda - s.talepte}">Önerilen talebi aç (${m.min - m.stock - s.yolda - s.talepte} ${m.unit})</button>` : ''}
    </div>`).join('') || '<div class="empty">Malzeme bulunamadı</div>'}</main>` + tabs();
}
function vBildirim() {
  const list = myNotifs();
  return top('Bildirimler', unread() + ' okunmamış') + `<main>
    ${list.length ? '<button class="btn ghost sm" data-a="readAll" style="align-self:flex-end">Tümünü okundu say</button>' : ''}
    ${list.map((n) => `<button class="card tap notif ${n.read.includes(db.currentUser) ? 'read' : ''}" data-a="openNotif" data-id="${n.id}"><span class="ic"></span>
      <span><b style="font-weight:600;font-size:14px">${esc(n.text)}</b><br><span class="meta">${dtStr(n.at)}</span></span></button>`).join('') || '<div class="empty">Bildirim yok</div>'}</main>` + tabs();
}
function vProfil() {
  const u = me();
  return topBack('Profil') + `<main class="nopad">
    <div class="card user"><span class="av" style="background:${ROLES[u.role].c}">${initials(u.ad)}</span><span><b>${esc(u.ad)}</b><br><span class="meta">${ROLES[u.role].ad} · MM-2140 Bakım</span></span></div>
    <div class="h2">Kullanıcı değiştir</div>
    ${db.users.filter((x) => x.id !== u.id).map((x) => `<button class="card tap user" data-a="login" data-id="${x.id}"><span class="av" style="background:${ROLES[x.role].c}">${initials(x.ad)}</span>
      <span><b>${esc(x.ad)}</b><br><span class="meta">${ROLES[x.role].ad}</span></span></button>`).join('')}
    <div class="h2">Onay kuralları</div>
    <div class="card"><div class="kv"><span>Talep onayı (Fabrika Müdürü)</span><span>${money(LIM_TALEP)} üzeri</span></div>
      <div class="kv"><span>Teklif değerlendirme onayı</span><span>Fabrika Müdürü</span></div>
      <div class="kv"><span>Genel Müdür onayı</span><span>${money(LIM_GM)} üzeri</span></div>
      <div class="kv"><span>KDV</span><span>%${KDV * 100}</span></div></div>
    <div class="info amber">Bu sürümde veriler yalnızca bu cihazın tarayıcısında saklanır; başka telefonlarla paylaşılmaz.</div>
    <button class="btn danger" data-a="reset">Örnek verileri sıfırla</button></main>`;
}

/* --- yeni talep --- */
function vYeni() {
  const lines = ui.f.lines || [], q = fv('mq').trim().toLocaleLowerCase('tr'), pick = ui.f.pick;
  const tot = lines.reduce((s, l) => s + l.qty * l.est, 0), need = tot > LIM_TALEP;
  let h = topBack('Yeni talep', 'Satınalma talebi') + '<main class="nopad">';
  h += `<div class="h2">Kalemler <b>${lines.length}</b></div>`;
  h += lines.map((l, i) => `<div class="card row"><div style="flex:1;min-width:0"><b style="font-weight:600">${esc(l.name)}</b><br><span class="meta">${l.qty} ${esc(l.unit)} × ${money(l.est)} = ${money(l.qty * l.est)}</span></div>
    <button class="btn danger sm" data-a="delLine" data-i="${i}" aria-label="Kalemi sil">Sil</button></div>`).join('');
  if (!pick) {
    const cat = db.items.filter((m) => !q || (m.name + ' ' + m.sku).toLocaleLowerCase('tr').includes(q)).slice(0, q ? 12 : 5);
    h += `<div class="card stack"><input class="in" placeholder="Malzeme adı veya stok kodu ara…" data-bind="mq" data-live value="${esc(fv('mq'))}">
      ${cat.map((m) => `<button class="q" data-a="pickItem" data-sku="${m.sku}"><span style="flex:1"><b style="font-weight:600">${esc(m.name)}</b><br><span class="mono">${m.sku}</span></span>
        <span class="badge ${m.stock ? 'green' : 'red'}">${m.stock ? m.stock + ' ' + m.unit : 'Stok yok'}</span></button>`).join('')}
      <button class="btn ghost sm" data-a="pickItem" data-sku="SERBEST">+ Katalogda yok — serbest tanımla</button></div>`;
  } else {
    const m = item(pick);
    h += `<div class="card act stack"><div class="lbl">Kalem ekle</div>
      ${m ? `<div><b>${esc(m.name)}</b><br><span class="meta">${m.sku} · stokta ${m.stock} ${m.unit} · son alış ${money(m.last)}</span></div>
        ${m.stock > 0 ? `<div class="info green">Stokta ${m.stock} ${m.unit} var. İhtiyacınız stoktan karşılanabiliyorsa talep açmanız gerekmeyebilir.</div>` : ''}`
        : `<label class="f">Malzeme tanımı<input class="in" data-bind="lname" value="${esc(fv('lname'))}" placeholder="Örn. Redüktör yağ keçesi 35×52×7"></label>`}
      <div class="grid2"><label class="f">Miktar<input class="in" inputmode="decimal" data-bind="lqty" value="${esc(fv('lqty', '1'))}"></label>
        <label class="f">Birim<select class="in" data-bind="lunit">${BIRIMLER.map((b) => `<option ${fv('lunit', m ? m.unit : 'adet') === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label></div>
      <label class="f">Tahmini birim fiyat (₺, KDV hariç)<input class="in" inputmode="decimal" data-bind="lest" value="${esc(fv('lest', m ? String(m.last) : ''))}" placeholder="0"></label>
      <div class="btns"><button class="btn ghost" data-a="cancelItem">Vazgeç</button><button class="btn" data-a="addLine">Kalemi ekle</button></div></div>`;
  }
  h += `<div class="h2">Talep bilgileri</div><div class="card stack">
    <label class="f">Ekipman / hat<select class="in" data-bind="machine">${MAKINELER.map((b) => `<option ${fv('machine', MAKINELER[0]) === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
    <div class="grid2"><label class="f">Aciliyet<select class="in" data-bind="urgency">${['Normal', 'Yüksek', 'Kritik'].map((b) => `<option ${fv('urgency', 'Normal') === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <label class="f">İhtiyaç tarihi<input class="in" type="date" data-bind="need" min="${today()}" value="${fv('need', addDays(7))}"></label></div>
    <label class="f">Gerekçe / açıklama<textarea class="in" data-bind="note" placeholder="Arıza, risk veya planlı bakım bilgisi">${esc(fv('note'))}</textarea></label></div>`;
  if (lines.length) h += `<div class="card"><div class="kv tot"><span>Tahmini toplam</span><span>${money(tot)}</span></div></div>
    <div class="info ${need ? 'amber' : 'green'}">${need ? `${money(LIM_TALEP)} limitinin üzerinde — önce Fabrika Müdürü talep onayına gider, onaylanınca satınalmaya düşer.` : `${money(LIM_TALEP)} limitinin altında — ek onay gerekmez, doğrudan satınalma masasına düşer.`}</div>`;
  h += `<button class="btn" data-a="sendTalep">${need ? 'Müdür onayına gönder' : 'Satınalmaya gönder'}</button></main>`;
  return h;
}

/* --- talep detayı --- */
function steps(t) {
  const defs = [[0, 'Talep oluşturuldu'], [1, 'Fabrika Müdürü talep onayı'], [2, 'Teklif toplama'], [3, 'Teklif değerlendirme onayı']];
  if (t.gm || tTotal(t) > LIM_GM) defs.push([4, 'Genel Müdür alım onayı']);
  defs.push([5, 'Sipariş oluşturma'], [6, 'Sipariş onayı'], [7, 'Tedarik ve mal kabul'], [8, 'Talep sahibine teslim']);
  const stopped = ST[t.status].i < 0, cur = stopped ? t.stopAt : ST[t.status].i;
  return defs.map(([i, ad]) => {
    const st = stopped && i === cur ? 'stop' : i < cur ? 'done' : i === cur ? 'now' : 'todo';
    let meta = t.stamps[i] || (st === 'now' ? 'Devam ediyor' : st === 'todo' ? (stopped ? '—' : 'Bekliyor') : '');
    if (i === 7 && st !== 'done' && t.poId && !stopped) meta = 'Tahmini teslim ' + dStr(po(t.poId).eta);
    return `<div class="tl ${st}"><div class="rail"><span class="d"></span><span class="l"></span></div><div class="b"><div class="t">${ad}</div><div class="meta">${esc(meta)}</div></div></div>`;
  }).join('');
}
function quoteList(t, selectable) {
  if (!t.quotes.length) return '<div class="empty" style="padding:10px">Henüz teklif girilmedi</div>';
  const min = Math.min(...t.quotes.map((q) => qTotal(t, q)));
  return t.quotes.map((q) => {
    const sel = t.pick === q.id, tot = qTotal(t, q);
    const tag = sel ? `<span class="tag" style="color:var(--acc)">${ST[t.status].i > 4 || t.status === 'teslim' ? 'Seçilen' : 'Öneri'}</span>` : tot === min ? '<span class="tag" style="color:var(--green)">En uygun</span>' : '';
    const body = `<span class="radio" ${selectable ? '' : 'style="display:none"'}></span><span style="flex:1;min-width:0"><b style="font-weight:600">${esc(q.supplier)}</b> ${tag}<br>
      <span class="meta">Teslim ${q.lead || '?'} gün${q.term ? ' · ' + esc(q.term) : ''}${q.note ? ' · ' + esc(q.note) : ''}</span>
      ${t.lines.length > 1 ? `<br><span class="meta">${t.lines.map((l, i) => esc(l.name.split(' ')[0]) + ' ' + money(q.prices[i])).join(' · ')}</span>` : ''}</span><span class="p">${money(tot)}</span>`;
    return selectable ? `<div class="row" style="align-items:stretch"><button class="q ${sel ? 'sel' : ''}" data-a="pickQuote" data-id="${q.id}">${body}</button>
      <button class="btn danger sm" data-a="delQuote" data-id="${q.id}" aria-label="Teklifi sil">✕</button></div>` : `<div class="q ${sel ? 'sel' : ''}">${body}</div>`;
  }).join('');
}
function poSummary(p) {
  return `${p.lines.map((l) => `<div class="kv"><span>${esc(l.name)}<br><span class="mono">${l.qty} ${esc(l.unit)} × ${money(l.price)} · teslim ${l.received}/${l.qty}</span></span><span>${money(l.qty * l.price)}</span></div>`).join('')}
    <div class="kv"><span>Ara toplam</span><span>${money(p.subtotal)}</span></div><div class="kv"><span>KDV %${KDV * 100}</span><span>${money(p.kdv)}</span></div>
    <div class="kv tot"><span>Genel toplam</span><span>${money(p.total)}</span></div>
    <div class="kv"><span>Tedarikçi</span><span>${esc(p.supplier)}</span></div><div class="kv"><span>Tahmini teslim</span><span>${dStr(p.eta)}</span></div>
    ${p.term ? `<div class="kv"><span>Ödeme vadesi</span><span>${esc(p.term)}</span></div>` : ''}${p.place ? `<div class="kv"><span>Teslim yeri</span><span>${esc(p.place)}</span></div>` : ''}
    ${p.note ? `<div class="kv"><span>Not</span><span>${esc(p.note)}</span></div>` : ''}`;
}
const noteBox = (ph) => `<label class="f">Karar notu<textarea class="in" data-bind="note" placeholder="${ph}">${esc(fv('note'))}</textarea></label>`;

function actionPanel(t) {
  const r = me().role, s = t.status, mine = t.by === db.currentUser, P = (lbl, body) => `<div class="card act stack"><div class="lbl">${lbl}</div>${body}</div>`;
  if (s === 'talep_onayi' && r === 'mudur') return P('Sizden bekleniyor · Talep onayı',
    `<div class="meta">Tahmini tutar <b style="color:var(--ink)">${money(estTotal(t))}</b> — ${money(LIM_TALEP)} limitinin üzerinde.</div>${noteBox('İsteğe bağlı; red için zorunlu')}
     <div class="btns"><button class="btn danger" data-a="talepRed">Reddet</button><button class="btn" data-a="talepOk">Talebi onayla</button></div>`);
  if (s === 'talep_onayi' && mine) return P('Talebiniz onay bekliyor', `<div class="meta">Fabrika Müdürü onayladığında satınalmaya düşer.</div><button class="btn danger" data-a="talepIptal">Talebi iptal et</button>`);
  if (s === 'teklif' && r === 'satinalma') {
    const q = picked(t);
    let b = quoteList(t, true);
    if (ui.f.qform) b += `<div class="card stack" style="background:#fff"><label class="f">Tedarikçi<input class="in" data-bind="qs" value="${esc(fv('qs'))}" placeholder="Firma adı"></label>
      ${t.lines.map((l, i) => `<label class="f">${esc(l.name)} — birim fiyat (₺) · ${l.qty} ${esc(l.unit)}<input class="in" inputmode="decimal" data-bind="qp${i}" value="${esc(fv('qp' + i))}" placeholder="Tahmini ${money(l.est)}"></label>`).join('')}
      <div class="grid2"><label class="f">Teslim (gün)<input class="in" inputmode="numeric" data-bind="ql" value="${esc(fv('ql'))}"></label>
        <label class="f">Ödeme vadesi<input class="in" data-bind="qt" value="${esc(fv('qt'))}" placeholder="30 gün"></label></div>
      <label class="f">Not<input class="in" data-bind="qn" value="${esc(fv('qn'))}" placeholder="Garanti, marka, koşullar"></label>
      <div class="btns"><button class="btn ghost" data-a="qformOff">Vazgeç</button><button class="btn" data-a="addQuote">Teklifi kaydet</button></div></div>`;
    else b += `<button class="btn ghost" data-a="qformOn">+ Teklif ekle</button>`;
    if (t.quotes.length) b += `<label class="f">Değerlendirme / öneri gerekçesi<textarea class="in" data-bind="note" placeholder="Neden bu tedarikçi?">${esc(fv('note', t.pickNote))}</textarea></label>
      ${t.quotes.length < 2 ? '<div class="info amber">Tek teklif var. Karşılaştırma için en az 2 teklif önerilir.</div>' : ''}
      <button class="btn" data-a="sendQuotes">Onaya gönder · ${esc(q.supplier)} ${money(qTotal(t, q))}</button>`;
    return P('Sizden bekleniyor · Teklif toplama', b);
  }
  if ((s === 'teklif_onayi' && r === 'mudur') || (s === 'gm_onayi' && r === 'gm')) {
    const q = picked(t), tot = qTotal(t, q), esk = s === 'teklif_onayi' && tot > LIM_GM;
    return P('Sizden bekleniyor · ' + (s === 'gm_onayi' ? 'Alım onayı' : 'Teklif değerlendirme onayı'),
      `${quoteList(t, false)}${t.pickNote ? `<div class="info blue"><b>Satınalma görüşü:</b> ${esc(t.pickNote)}</div>` : ''}
       <div class="info ${esk ? 'amber' : 'gray'}">${esk ? `Tutar ${money(LIM_GM)} yetki limitinizin üzerinde — uygun görüşünüzle Genel Müdür onayına yükselir.` : s === 'gm_onayi' ? 'Fabrika Müdürü uygun görüş verdi; nihai alım kararı sizde.' : `Yetki içinde (${money(LIM_GM)}).`}</div>
       ${noteBox('İsteğe bağlı; red ve revizyon için zorunlu')}
       <button class="btn" data-a="quoteOk">${esk ? 'Uygun gör · Genel Müdüre yükselt' : 'Onayla · ' + money(tot)}</button>
       <div class="btns"><button class="btn danger" data-a="quoteRed">Reddet</button><button class="btn ghost" data-a="quoteRev">Revizyon iste</button></div>`);
  }
  if (s === 'siparis_bekliyor' && r === 'satinalma') {
    const q = picked(t), sub = qTotal(t, q);
    return P('Sizden bekleniyor · Sipariş oluştur',
      `<div class="kv"><span>Tedarikçi</span><span>${esc(q.supplier)}</span></div><div class="kv"><span>Ara toplam</span><span>${money(sub)}</span></div>
       <div class="kv tot"><span>KDV dahil</span><span>${money(sub * (1 + KDV))}</span></div>
       <div class="grid2"><label class="f">Tahmini teslim<input class="in" type="date" data-bind="eta" min="${today()}" value="${fv('eta', addDays(Number(q.lead) || 3))}"></label>
         <label class="f">Ödeme vadesi<input class="in" data-bind="term" value="${esc(fv('term', q.term || ''))}"></label></div>
       <label class="f">Teslim yeri<input class="in" data-bind="place" value="${esc(fv('place', 'Bakım deposu'))}"></label>
       <label class="f">Sipariş notu<input class="in" data-bind="note" value="${esc(fv('note'))}"></label>
       <button class="btn" data-a="createPO">Siparişi oluştur · ${sub > LIM_GM ? 'Genel Müdür' : 'Fabrika Müdürü'} onayına gönder</button>`);
  }
  if (s === 'siparis_onayi' && r === po(t.poId).approver) return P('Sizden bekleniyor · Sipariş onayı',
    `${poSummary(po(t.poId))}${noteBox('İsteğe bağlı; red için zorunlu')}
     <div class="btns"><button class="btn danger" data-a="poRed">Reddet</button><button class="btn" data-a="poOk">Siparişi onayla</button></div>`);
  if ((s === 'tedarikte' || s === 'kismi') && r === 'satinalma') {
    const p = po(t.poId);
    return P('Sizden bekleniyor · Mal kabul',
      `${p.lines.map((l, i) => l.received >= l.qty ? `<div class="kv"><span>${esc(l.name)}</span><span>Tamamlandı ✓</span></div>`
        : `<label class="f">${esc(l.name)} — kalan ${l.qty - l.received} ${esc(l.unit)}<input class="in" inputmode="decimal" data-bind="rq${i}" value="${esc(fv('rq' + i, String(l.qty - l.received)))}"></label>`).join('')}
       <label class="f">İrsaliye no<input class="in" data-bind="irs" value="${esc(fv('irs'))}" placeholder="IRS-…"></label>
       <button class="btn" data-a="receive">Mal kabulü kaydet</button>`);
  }
  if (s === 'depoda' && mine) return P('Sizden bekleniyor · Teslim alma', `<div class="meta">Malzemeniz depoya girdi. Teslim aldığınızda stoktan düşülür ve talep kapanır.</div><button class="btn" data-a="handover">Teslim aldım</button>`);
  const kim = { talep_onayi: 'Fabrika Müdürü talep onayı', teklif: 'Satınalma teklif topluyor', teklif_onayi: 'Fabrika Müdürü teklif değerlendirme onayı', gm_onayi: 'Genel Müdür alım onayı',
    siparis_bekliyor: 'Satınalma sipariş açacak', siparis_onayi: 'Sipariş onayı bekleniyor', tedarikte: 'Tedarikçiden teslimat bekleniyor', kismi: 'Kalan teslimat bekleniyor', depoda: 'Talep sahibi teslim alacak' }[s];
  return kim ? `<div class="info gray"><b>Sıradaki adım:</b> ${kim}</div>` : '';
}
function vTalep(t) {
  const p = t.poId && po(t.poId), showQ = t.quotes.length && !(t.status === 'teklif' && me().role === 'satinalma') && !((t.status === 'teklif_onayi' && me().role === 'mudur') || (t.status === 'gm_onayi' && me().role === 'gm'));
  return topBack(t.no, 'Talep detayı') + `<main class="nopad">
    <div class="card"><div class="row">${badge(t.status)}<span class="sp"></span>${urg(t.urgency)}</div>
      <div class="ttl" style="font-size:17px">${esc(tTitle(t))}</div>
      <div class="kv"><span>Talep eden</span><span>${esc(user(t.by).ad)}</span></div><div class="kv"><span>Ekipman</span><span>${esc(t.machine)}</span></div>
      <div class="kv"><span>İhtiyaç tarihi</span><span style="${isLate(t) ? 'color:var(--red)' : ''}">${dStr(t.need)}${isLate(t) ? ' · gecikti' : ''}</span></div>
      <div class="kv"><span>${p ? 'Sipariş tutarı' : picked(t) ? 'Teklif tutarı' : 'Tahmini tutar'}</span><span>${money(tTotal(t))}</span></div>
      ${t.note ? `<div class="meta" style="margin-top:8px">${esc(t.note)}</div>` : ''}</div>
    ${actionPanel(t)}
    <div class="h2">Süreç</div><div class="card">${steps(t)}</div>
    <div class="h2">Kalemler <b>${t.lines.length}</b></div>
    <div class="card">${t.lines.map((l) => `<div class="kv"><span>${esc(l.name)}<br><span class="mono">${l.sku} · ${l.qty} ${esc(l.unit)} × ${money(l.est)}</span></span><span>${money(l.qty * l.est)}</span></div>`).join('')}</div>
    ${showQ ? `<div class="h2">Teklifler <b>${t.quotes.length}</b></div><div class="stack">${quoteList(t, false)}</div>` : ''}
    ${p ? `<div class="h2">Sipariş</div><button class="card tap" data-a="openPO" data-id="${p.id}"><div class="row"><span class="mono">${p.no}</span><span class="sp"></span>${badge(p.status, PST)}</div>
      <div class="ttl">${esc(p.supplier)}</div><div class="row meta"><span>Teslim ${dStr(p.eta)}</span><span class="sp"></span><b style="color:var(--ink)">${money(p.total)}</b></div></button>` : ''}
    <div class="h2">Geçmiş</div><div class="card">${t.log.map((l) => `<div class="log">${esc(l.text)}<br><span class="meta">${dtStr(l.at)} · ${esc(user(l.by).ad)}</span></div>`).join('')}</div></main>`;
}
function vPO(p) {
  const t = talep(p.talepId);
  return topBack(p.no, 'Satınalma siparişi') + `<main class="nopad">
    <div class="card"><div class="row">${badge(p.status, PST)}<span class="sp"></span><span class="meta">${dtStr(p.at)}</span></div><div class="ttl" style="font-size:17px">${esc(p.supplier)}</div>${poSummary(p)}
      <div class="kv"><span>Oluşturan</span><span>${esc(user(p.by).ad)}</span></div><div class="kv"><span>Onay makamı</span><span>${ROLES[p.approver].ad}</span></div></div>
    <div class="h2">Mal kabul kayıtları <b>${p.receipts.length}</b></div>
    <div class="card">${p.receipts.map((r) => `<div class="log">${r.items.map((x) => esc(p.lines[x.i].name) + ' · ' + x.qty + ' ' + esc(p.lines[x.i].unit)).join('<br>')}<br><span class="meta">${dtStr(r.at)} · ${esc(user(r.by).ad)}${r.irsaliye ? ' · ' + esc(r.irsaliye) : ''}</span></div>`).join('') || '<div class="empty" style="padding:8px">Henüz teslimat yok</div>'}</div>
    ${t ? `<button class="btn ghost" data-a="openTalep" data-id="${t.id}">İlgili talep: ${t.no}${t.poId === p.id && actionable(t) ? ' · işlem bekliyor' : ''}</button>` : ''}</main>`;
}
const actionable = (t) => tasks().some((g) => g.list.includes(t));

/* ---------- çizim ---------- */
function render() {
  const app = document.getElementById('app'), a = document.activeElement, key = a && a.dataset && a.dataset.bind, pos = key && a.selectionStart;
  let h;
  if (!db.currentUser) { document.body.dataset.role = ''; h = vLogin(); }
  else {
    document.body.dataset.role = me().role;
    const p = ui.page;
    if (p) {
      const t = p.type === 'talep' && talep(p.id), o = p.type === 'po' && po(p.id);
      h = p.type === 'yeni' ? vYeni() : p.type === 'profil' ? vProfil() : t ? vTalep(t) : o ? vPO(o) : null;
      if (!h) { ui.page = null; }
    }
    if (!h) h = { gorev: vGorev, talepler: vTalepler, siparisler: vSiparisler, stok: vStok, bildirim: vBildirim }[ui.tab]();
  }
  app.innerHTML = h;
  if (key) { const el = app.querySelector(`[data-bind="${key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* select/date */ } } }
}
const cur = () => talep(ui.page.id);
function commit(msg) { save(); ui.f = {}; render(); if (msg) toast(msg); }
function needNote() { const n = fv('note').trim(); if (!n) toast('Bu karar için not yazmalısınız'); return n; }

const A = {
  login: (d) => { db.currentUser = d.id; ui.tab = 'gorev'; ui.filt = 'Tümü'; ui.f = {}; save(); if (ui.page) back(); else render(); window.scrollTo(0, 0); },
  tab: (d) => { ui.tab = d.k; ui.filt = 'Tümü'; ui.f = {}; render(); window.scrollTo(0, 0); },
  filt: (d) => { ui.filt = d.k; render(); },
  back, profil: () => open({ type: 'profil' }),
  openTalep: (d) => open({ type: 'talep', id: d.id }), openPO: (d) => open({ type: 'po', id: d.id }),
  openNotif: (d) => { const n = db.bildirimler.find((x) => x.id === d.id); if (!n.read.includes(db.currentUser)) n.read.push(db.currentUser); save(); open({ type: 'talep', id: n.talepId }); },
  readAll: () => { myNotifs().forEach((n) => { if (!n.read.includes(db.currentUser)) n.read.push(db.currentUser); }); save(); render(); },
  reset: () => { if (!confirm('Tüm kayıtlar silinip örnek veriler yeniden yüklenecek. Emin misiniz?')) return; seed(); save(); ui.page = null; render(); },
  yeni: (d) => { open({ type: 'yeni' }); ui.f.lines = []; if (d.sku) { ui.f.pick = d.sku; ui.f.lqty = d.qty; } render(); },
  pickItem: (d) => { ui.f.pick = d.sku; ['lname', 'lqty', 'lunit', 'lest'].forEach((k) => delete ui.f[k]); render(); },
  cancelItem: () => { delete ui.f.pick; render(); },
  addLine: () => {
    const m = item(ui.f.pick), name = m ? m.name : fv('lname').trim(), qty = num(fv('lqty', '1')), est = num(fv('lest', m ? m.last : ''));
    if (!name) return toast('Malzeme tanımını yazın');
    if (qty <= 0) return toast('Miktar sıfırdan büyük olmalı');
    if (est <= 0) return toast('Tahmini birim fiyatı girin');
    ui.f.lines.push({ sku: m ? m.sku : 'SERBEST', name, qty, unit: fv('lunit', m ? m.unit : 'adet'), est });
    ['pick', 'lname', 'lqty', 'lunit', 'lest', 'mq'].forEach((k) => delete ui.f[k]); render();
  },
  delLine: (d) => { ui.f.lines.splice(+d.i, 1); render(); },
  sendTalep: () => {
    if (!(ui.f.lines || []).length) return toast(ui.f.pick ? 'Önce "Kalemi ekle"ye basın' : 'En az bir kalem ekleyin');
    const t = createTalep({ lines: ui.f.lines, machine: fv('machine', MAKINELER[0]), urgency: fv('urgency', 'Normal'), need: fv('need', addDays(7)), note: fv('note').trim() });
    save(); ui.f = {}; ui.page = { type: 'talep', id: t.id }; render(); window.scrollTo(0, 0);
    toast(t.no + (t.direct ? ' satınalmaya gönderildi' : ' müdür onayına gönderildi'));
  },
  talepOk: () => { decideTalep(cur(), true, fv('note').trim()); commit('Talep onaylandı'); },
  talepRed: () => { const n = needNote(); if (n) { decideTalep(cur(), false, n); commit('Talep reddedildi'); } },
  talepIptal: () => { if (confirm('Talep iptal edilsin mi?')) { stop(cur(), 1, 'iptal', 'Talep iptal edildi'); commit('Talep iptal edildi'); } },
  qformOn: () => { ui.f.qform = true; render(); }, qformOff: () => { ui.f.qform = false; render(); },
  addQuote: () => {
    const t = cur(), supplier = fv('qs').trim(), prices = t.lines.map((l, i) => num(fv('qp' + i)));
    if (!supplier) return toast('Tedarikçi adını yazın');
    if (prices.some((p) => p <= 0)) return toast('Her kalem için birim fiyat girin');
    const note = fv('note');
    addQuote(t, { supplier, prices, lead: num(fv('ql')) || '', term: fv('qt').trim(), note: fv('qn').trim() });
    save(); ui.f = { note }; render(); toast('Teklif kaydedildi');
  },
  delQuote: (d) => { if (confirm('Teklif silinsin mi?')) { delQuote(cur(), d.id); save(); render(); } },
  pickQuote: (d) => { cur().pick = d.id; save(); render(); },
  sendQuotes: () => { sendQuotes(cur(), fv('note', cur().pickNote).trim()); commit('Değerlendirme onayına gönderildi'); },
  quoteOk: () => { const t = cur(); decideQuote(t, 'ok', fv('note').trim()); commit(t.status === 'gm_onayi' ? 'Genel Müdür onayına yükseltildi' : 'Onaylandı — satınalma sipariş açabilir'); },
  quoteRev: () => { const n = needNote(); if (n) { decideQuote(cur(), 'rev', n); commit('Revizyon istendi'); } },
  quoteRed: () => { const n = needNote(); if (n) { decideQuote(cur(), 'red', n); commit('Alım reddedildi'); } },
  createPO: () => {
    const eta = fv('eta', addDays(Number(picked(cur()).lead) || 3));
    if (!eta) return toast('Tahmini teslim tarihini seçin');
    const p = createPO(cur(), { eta, term: fv('term', picked(cur()).term || '').trim(), place: fv('place', 'Bakım deposu').trim(), note: fv('note').trim() });
    commit(p.no + ' oluşturuldu, onaya gönderildi');
  },
  poOk: () => { decidePO(cur(), true, fv('note').trim()); commit('Sipariş onaylandı'); },
  poRed: () => { const n = needNote(); if (n) { decidePO(cur(), false, n); commit('Sipariş reddedildi'); } },
  receive: () => {
    const t = cur(), p = po(t.poId), qtys = p.lines.map((l, i) => num(fv('rq' + i, String(l.qty - l.received))));
    if (p.lines.some((l, i) => qtys[i] > l.qty - l.received)) return toast('Kalan miktardan fazla kabul edilemez');
    if (!qtys.some((q) => q > 0)) return toast('Teslim alınan miktarı girin');
    receive(t, qtys, fv('irs').trim()); commit(t.status === 'depoda' ? 'Mal kabul tamamlandı' : 'Kısmi mal kabul kaydedildi');
  },
  handover: () => { handover(cur()); commit('Teslim alındı, talep kapandı'); },
};

document.addEventListener('click', (e) => { const el = e.target.closest('[data-a]'); if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset); });
const onInput = (e) => { const el = e.target; if (!el.dataset || !el.dataset.bind) return; set(el.dataset.bind, el.value); if ('live' in el.dataset) render(); };
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);

load();
render();
})();
