/* Teknik Satınalma — talep → onay → teklif → değerlendirme onayı → sipariş → sipariş onayı → mal kabul → teslim
   Veriler ortak Supabase veritabanındadır. Bu dosya yalnızca okur ve gösterir; tüm yazma işlemleri
   kimlik, rol ve durum kontrolü yapan sunucu işlevinden (supabase/functions/islem) geçer. */
'use strict';
(() => {

const SB_URL = 'https://pzclkevawmiqmqixudnt.supabase.co';
const SB_KEY = 'sb_publishable_xU20CMCioALUunSwRPrlEg__Rf0ioTz'; // herkese açık istemci anahtarı
const LIM_TALEP = 1500;      // (gösterim için; kural sunucuda) bu tutarın üstündeki talepler Fabrika Müdürü talep onayına gider
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
const sb = window.supabase.createClient(SB_URL, SB_KEY);
const db = { users: [], items: [], talepler: [], siparisler: [], bildirimler: [], currentUser: null };
const user = (id) => db.users.find((u) => u.id === id) || { ad: 'Sistem', role: '' };
const me = () => user(db.currentUser);
const talep = (id) => db.talepler.find((t) => t.id === id);
const po = (id) => db.siparisler.find((p) => p.id === id);
const item = (sku) => db.items.find((m) => m.sku === sku);

const estTotal = (t) => t.lines.reduce((s, l) => s + l.qty * l.est, 0);
const qTotal = (t, q) => t.lines.reduce((s, l, i) => s + l.qty * (q.prices[i] || 0), 0);
const picked = (t) => t.quotes.find((q) => q.id === t.pick);
const tTotal = (t) => { const p = t.poId && po(t.poId); if (p) return p.subtotal; const q = picked(t); return q ? qTotal(t, q) : estTotal(t); };
const tTitle = (t) => t.lines[0].name + (t.lines.length > 1 ? ' +' + (t.lines.length - 1) + ' kalem' : '');
const isOpen = (t) => ST[t.status].i > 0 && t.status !== 'teslim';
const isLate = (t) => isOpen(t) && t.need < today();

/* ---------- sunucu ---------- */
let snap = '', busy = false;
async function loadData() {
  const r = await Promise.all([
    sb.from('profiller').select('id, ad, rol, aktif, gecici_sifre').order('ad'),
    sb.from('malzemeler').select('*').order('name'),
    sb.from('talepler').select('veri').order('created_at', { ascending: false }),
    sb.from('siparisler').select('veri').order('created_at', { ascending: false }),
    sb.from('bildirimler').select('*').order('at', { ascending: false }).limit(100)]);
  const bad = r.find((x) => x.error); if (bad) throw bad.error;
  const next = {
    users: r[0].data.map((x) => ({ id: x.id, ad: x.ad, role: x.rol, aktif: x.aktif, gecici: x.gecici_sifre })),
    items: r[1].data, talepler: r[2].data.map((x) => x.veri), siparisler: r[3].data.map((x) => x.veri),
    bildirimler: r[4].data.map((n) => ({ id: n.id, at: n.at, to: n.alici, text: n.metin, talepId: n.talep_id, read: n.okuyan })),
  };
  const j = JSON.stringify(next), changed = j !== snap;
  snap = j; Object.assign(db, next);
  return changed;
}
/* sunucuda bir işlem çalıştırır; başarılıysa veriyi tazeler ve sonucu döndürür, değilse null */
async function run(a, p, fn = 'islem') {
  if (busy) return null;
  busy = true; document.body.classList.add('busy');
  try {
    const { data, error } = await sb.functions.invoke(fn, { body: { a, p } });
    if (error || !data) { toast('Bağlantı hatası; tekrar deneyin'); return null; }
    if (data.hata) { toast(data.hata); try { if (await loadData()) render(); } catch (e) { /* yoksay */ } return null; }
    await loadData();
    return data;
  } catch (e) { toast('Bağlantı hatası; tekrar deneyin'); return null; }
  finally { busy = false; document.body.classList.remove('busy'); }
}
async function onSession(session) {
  if (!session) { db.currentUser = null; snap = ''; ui.auth = 'out'; ui.page = null; ui.f = {}; render(); return; }
  if (db.currentUser === session.user.id && ui.auth === 'in') return;
  db.currentUser = session.user.id;
  try { await loadData(); ui.auth = 'in'; } catch (e) { ui.auth = 'err'; }
  render();
}
async function refresh() {
  if (ui.auth !== 'in' || busy || document.visibilityState !== 'visible') return;
  try { if (await loadData()) render(); } catch (e) { /* bağlantı yoksa sonraki denemede */ }
}

/* ---------- arayüz durumu ---------- */
const ui = { auth: 'loading', tab: 'gorev', page: null, f: {}, filt: 'Tümü' };
const set = (k, v) => { ui.f[k] = v; };
const fv = (k, d = '') => (ui.f[k] ?? d);
function open(page, fresh = true) { if (fresh) ui.f = {}; ui.page = page; history.pushState({ p: 1 }, ''); render(); window.scrollTo(0, 0); }
function closePage() { ui.page = null; ui.f = {}; render(); }
window.addEventListener('popstate', () => { if (skipPop) { skipPop = false; return; } if (scanHist) { scanHist = false; stopScan(); return; } if (ui.page) closePage(); });
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

/* ---------- barkod okuma ---------- */
/* Tarayıcının kendi okuyucusu (BarcodeDetector) varsa o, yoksa ZXing kitaplığı kullanılır. */
let scan = null, scanHist = false, skipPop = false;
const scanBtn = (a) => `<button class="btn dark sm scanbtn" data-a="${a}" aria-label="Barkod okut"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 8v8M10.5 8v8M14 8v8M17 8v8"/></svg></button>`;
const findByCode = (code) => { const c = code.toLocaleLowerCase('tr'); return db.items.find((m) => m.sku.toLocaleLowerCase('tr') === c || (m.barkod && m.barkod.toLocaleLowerCase('tr') === c)); };
const loadZX = () => window.ZXing ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/zxing.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
function stopScan() {
  if (!scan) return;
  clearTimeout(scan.t);
  try { if (scan.reader) scan.reader.reset(); } catch (e) { /* yoksay */ }
  if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
  scan = null;
  const el = document.getElementById('scan'); el.classList.remove('on'); el.innerHTML = '';
}
async function startScan(onCode) {
  if (scan) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('Bu tarayıcıda kamera kullanılamıyor');
  const el = document.getElementById('scan');
  el.innerHTML = `<video playsinline muted autoplay></video><div class="frame"><i></i></div>
    <div class="scanbar"><div><b>Barkodu çerçeveye getirin</b><br><span>Okunduğunda kendiliğinden kapanır</span></div><button class="btn ghost" data-a="scanOff">Vazgeç</button></div>`;
  el.classList.add('on');
  const video = el.querySelector('video'), my = (scan = {});
  history.pushState({ scan: 1 }, ''); scanHist = true;
  const close = () => { stopScan(); if (scanHist) { scanHist = false; skipPop = true; history.back(); } };
  const done = (code) => { if (scan !== my) return; close(); if (navigator.vibrate) navigator.vibrate(60); onCode(String(code).trim()); };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    if (scan !== my) { stream.getTracks().forEach((t) => t.stop()); return; }
    my.stream = stream;
    if ('BarcodeDetector' in window) {
      video.srcObject = stream; await video.play();
      const det = new window.BarcodeDetector();
      const tick = async () => {
        if (scan !== my) return;
        try { const r = await det.detect(video); if (r.length) return done(r[0].rawValue); } catch (e) { /* kare hazır değil */ }
        my.t = setTimeout(tick, 150);
      };
      tick();
    } else {
      await loadZX();
      if (scan !== my) return;
      my.reader = new window.ZXing.BrowserMultiFormatReader();
      my.reader.decodeFromStream(stream, video, (res) => { if (res) done(res.getText()); });
    }
  } catch (e) {
    if (scan === my) close();
    toast(e && e.name === 'NotAllowedError' ? 'Kamera izni verilmedi; tarayıcı ayarlarından kameraya izin verin' : 'Kamera açılamadı');
  }
}

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
  return `<div class="login"><div class="mono">TEKNİK SATINALMA</div><h1>Giriş yapın</h1>
    <label class="f">E-posta<input class="in" type="email" autocomplete="username" inputmode="email" data-bind="email" value="${esc(fv('email'))}"></label>
    <label class="f">Şifre<input class="in" type="password" autocomplete="current-password" data-bind="pw" value="${esc(fv('pw'))}"></label>
    <button class="btn dark" data-a="login">Giriş yap</button>
    <p class="meta">Hesabınız yoksa veya şifrenizi unuttuysanız Fabrika Müdürü ya da Genel Müdür hesabından yeni şifre atanabilir.</p></div>`;
}
function vSifre() {
  return `<div class="login"><div class="mono">TEKNİK SATINALMA</div><h1>Yeni şifrenizi belirleyin</h1>
    <p class="meta" style="margin:0">Size verilen geçici şifreyle giriş yaptınız. Devam etmek için kendi şifrenizi belirleyin (en az 8 karakter).</p>
    <label class="f">Yeni şifre<input class="in" type="password" autocomplete="new-password" data-bind="np1" value="${esc(fv('np1'))}"></label>
    <label class="f">Yeni şifre (tekrar)<input class="in" type="password" autocomplete="new-password" data-bind="np2" value="${esc(fv('np2'))}"></label>
    <button class="btn dark" data-a="sifre">Şifreyi kaydet</button><button class="btn ghost" data-a="logout">Çıkış yap</button></div>`;
}
const vMesaj = (baslik, metin, retry) => `<div class="login"><div class="mono">TEKNİK SATINALMA</div><h1>${baslik}</h1><p class="meta" style="margin:0">${metin}</p>
  ${retry ? '<button class="btn dark" data-a="retry">Tekrar dene</button>' : ''}<button class="btn ghost" data-a="logout">Çıkış yap</button></div>`;
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
  const list = db.items.filter((m) => !q || (m.name + ' ' + m.sku + ' ' + (m.barkod || '')).toLocaleLowerCase('tr').includes(q)).map((m) => ({ m, s: stockInfo(m) })).sort((a, b) => b.s.eksik - a.s.eksik);
  const ata = ui.f.ata;
  return top('Stok', 'Malzeme durumu ve ihtiyaç') + `<main>
    <div class="row"><input class="in" placeholder="Malzeme veya stok kodu ara…" data-bind="q" data-live value="${esc(fv('q'))}">${scanBtn('scanStok')}</div>
    ${ata ? `<div class="info amber"><b>${esc(ata)}</b> barkodu hiçbir malzemede tanımlı değil. Tanımlamak için aşağıdan malzemeyi seçin.
      <button class="btn ghost sm" style="margin-top:8px" data-a="ataOff">Vazgeç</button></div>` : ''}
    ${list.map(({ m, s }) => `<div class="card"><div class="row"><span class="mono">${m.sku}${m.barkod ? ' · ▮▯▮ ' + esc(m.barkod) : ''}</span><span class="sp"></span>
      <span class="badge ${s.eksik ? 'red' : m.stock < m.min ? 'amber' : 'green'}">${s.eksik ? 'Talep açılmalı' : m.stock < m.min ? 'Tedarik sürüyor' : 'Yeterli'}</span></div>
      <div class="ttl">${esc(m.name)}</div>
      <div class="row meta wrap"><span>Stok <b style="color:var(--ink)">${m.stock} ${m.unit}</b></span><span>· Min ${m.min}</span><span>· Yolda ${s.yolda}</span><span>· Talepte ${s.talepte}</span></div>
      ${s.eksik && me().role === 'teknisyen' ? `<button class="btn sm" style="margin-top:10px" data-a="yeni" data-sku="${m.sku}" data-qty="${m.min - m.stock - s.yolda - s.talepte}">Önerilen talebi aç (${m.min - m.stock - s.yolda - s.talepte} ${m.unit})</button>` : ''}
      ${ata ? `<button class="btn sm" style="margin-top:10px" data-a="ataSec" data-sku="${m.sku}">Barkodu bu malzemeye tanımla</button>` : ''}
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
  const u = me(), yon = u.role === 'mudur' || u.role === 'gm';
  return topBack('Profil') + `<main class="nopad">
    <div class="card user"><span class="av" style="background:${ROLES[u.role].c}">${initials(u.ad)}</span><span><b>${esc(u.ad)}</b><br><span class="meta">${ROLES[u.role].ad}</span></span></div>
    ${yon ? '<button class="btn ghost" data-a="kullanicilar">Kullanıcı yönetimi</button>' : ''}
    <div class="h2">Şifre değiştir</div>
    <div class="card stack"><label class="f">Yeni şifre<input class="in" type="password" autocomplete="new-password" data-bind="np1" value="${esc(fv('np1'))}"></label>
      <label class="f">Yeni şifre (tekrar)<input class="in" type="password" autocomplete="new-password" data-bind="np2" value="${esc(fv('np2'))}"></label>
      <button class="btn" data-a="sifre">Şifreyi kaydet</button></div>
    <div class="h2">Onay kuralları</div>
    <div class="card"><div class="kv"><span>Talep onayı (Fabrika Müdürü)</span><span>${money(LIM_TALEP)} üzeri</span></div>
      <div class="kv"><span>Teklif değerlendirme onayı</span><span>Fabrika Müdürü</span></div>
      <div class="kv"><span>Genel Müdür onayı</span><span>${money(LIM_GM)} üzeri</span></div>
      <div class="kv"><span>KDV</span><span>%${KDV * 100}</span></div></div>
    <button class="btn danger" data-a="logout">Çıkış yap</button></main>`;
}
function vKullanicilar() {
  const rolSec = (k, v) => `<select class="in" data-bind="${k}">${Object.keys(ROLES).map((r) => `<option value="${r}" ${v === r ? 'selected' : ''}>${ROLES[r].ad}</option>`).join('')}</select>`;
  return topBack('Kullanıcılar', 'Kullanıcı yönetimi') + `<main class="nopad">
    ${db.users.map((x) => `<div class="card stack"><div class="user"><span class="av" style="background:${x.aktif ? ROLES[x.role].c : '#B9BBB3'}">${initials(x.ad)}</span>
        <span style="flex:1"><b>${esc(x.ad)}</b><br><span class="meta">${ROLES[x.role].ad}${x.aktif ? '' : ' · pasif'}${x.gecici ? ' · geçici şifre' : ''}</span></span></div>
      ${x.id === db.currentUser ? '' : ui.f.rs === x.id
        ? `<label class="f">Yeni geçici şifre (en az 8 karakter)<input class="in" data-bind="rspw" autocomplete="off" value="${esc(fv('rspw'))}"></label>
           <div class="btns"><button class="btn ghost sm" data-a="rsOff">Vazgeç</button><button class="btn sm" data-a="rsSave" data-id="${x.id}">Şifreyi ata</button></div>`
        : `<div class="btns"><button class="btn ghost sm" data-a="rsOn" data-id="${x.id}">Şifre sıfırla</button>
           <button class="btn ${x.aktif ? 'danger' : 'ghost'} sm" data-a="aktif" data-id="${x.id}" data-v="${x.aktif ? 0 : 1}">${x.aktif ? 'Pasifleştir' : 'Aktifleştir'}</button></div>`}</div>`).join('')}
    <div class="h2">Yeni kullanıcı</div>
    <div class="card stack"><label class="f">Ad soyad<input class="in" data-bind="uad" value="${esc(fv('uad'))}"></label>
      <label class="f">E-posta (giriş adı)<input class="in" type="email" inputmode="email" autocomplete="off" data-bind="uemail" value="${esc(fv('uemail'))}"></label>
      <label class="f">Rol${rolSec('urol', fv('urol', 'teknisyen'))}</label>
      <label class="f">Geçici şifre (en az 8 karakter)<input class="in" autocomplete="off" data-bind="upw" value="${esc(fv('upw'))}"></label>
      <div class="info gray">Kullanıcı ilk girişte kendi şifresini belirler. Geçici şifreyi kendisine siz iletin.</div>
      <button class="btn" data-a="userAdd">Kullanıcıyı ekle</button></div></main>`;
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
    const cat = db.items.filter((m) => !q || (m.name + ' ' + m.sku + ' ' + (m.barkod || '')).toLocaleLowerCase('tr').includes(q)).slice(0, q ? 12 : 5);
    h += `<div class="card stack"><div class="row"><input class="in" placeholder="Malzeme adı veya stok kodu ara…" data-bind="mq" data-live value="${esc(fv('mq'))}">${scanBtn('scanYeni')}</div>
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
  const u = ui.auth === 'in' ? me() : null;
  let h;
  document.body.dataset.role = (u && u.role) || '';
  if (ui.auth === 'loading') h = '<div class="login"><div class="empty">Yükleniyor…</div></div>';
  else if (ui.auth === 'out') h = vLogin();
  else if (ui.auth === 'err') h = vMesaj('Bağlantı kurulamadı', 'Veriler yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.', true);
  else if (!u.role || u.aktif === false) h = vMesaj('Hesabınız aktif değil', 'Bu hesap için erişim tanımlı değil. Fabrika Müdürü veya Genel Müdür ile görüşün.');
  else if (u.gecici) h = vSifre();
  else {
    const p = ui.page;
    if (p) {
      const t = p.type === 'talep' && talep(p.id), o = p.type === 'po' && po(p.id);
      h = p.type === 'yeni' ? vYeni() : p.type === 'profil' ? vProfil() : p.type === 'kullanicilar' ? vKullanicilar() : t ? vTalep(t) : o ? vPO(o) : null;
      if (!h) { ui.page = null; }
    }
    if (!h) h = { gorev: vGorev, talepler: vTalepler, siparisler: vSiparisler, stok: vStok, bildirim: vBildirim }[ui.tab]();
  }
  app.innerHTML = h;
  if (key) { const el = app.querySelector(`[data-bind="${key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* select/date */ } } }
}
const cur = () => talep(ui.page.id);
/* talep üzerinde sunucu işlemi: başarılıysa formu temizler, yeniden çizer, mesaj gösterir */
async function act(a, p, msg, keep) {
  const r = await run(a, { id: ui.page.id, ...p });
  if (!r) return null;
  ui.f = keep || {}; render();
  if (msg) toast(typeof msg === 'function' ? msg(r) : msg);
  return r;
}
function needNote() { const n = fv('note').trim(); if (!n) toast('Bu karar için not yazmalısınız'); return n; }
function yeniSifre() {
  const a = fv('np1'), b = fv('np2');
  if (a.length < 8) { toast('Şifre en az 8 karakter olmalı'); return null; }
  if (a !== b) { toast('Şifreler aynı değil'); return null; }
  return a;
}

const A = {
  login: async () => {
    const email = fv('email').trim(), password = fv('pw');
    if (!email || !password) return toast('E-posta ve şifrenizi yazın');
    if (busy) return; busy = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    busy = false;
    if (error) toast(/invalid/i.test(error.message) ? 'E-posta veya şifre hatalı' : 'Giriş yapılamadı; bağlantınızı kontrol edin');
    else { ui.f = {}; ui.tab = 'gorev'; }
  },
  logout: async () => { await sb.auth.signOut(); },
  retry: async () => { const { data } = await sb.auth.getSession(); ui.auth = 'loading'; render(); db.currentUser = null; onSession(data.session); },
  sifre: async () => {
    const sifre = yeniSifre(); if (!sifre) return;
    const { data } = await sb.auth.getSession(), email = data.session.user.email;
    if (!(await run('sifreDegistir', { sifre }))) return;
    await sb.auth.signInWithPassword({ email, password: sifre });
    try { await loadData(); } catch (e) { /* sonraki tazelemede */ }
    ui.f = {}; render(); toast('Şifreniz değiştirildi');
  },
  kullanicilar: () => open({ type: 'kullanicilar' }),
  rsOn: (d) => { ui.f.rs = d.id; ui.f.rspw = ''; render(); }, rsOff: () => { delete ui.f.rs; render(); },
  rsSave: async (d) => {
    if (fv('rspw').length < 8) return toast('Şifre en az 8 karakter olmalı');
    if (await run('sifreSifirla', { id: d.id, sifre: fv('rspw') })) { ui.f = {}; render(); toast('Geçici şifre atandı'); }
  },
  aktif: async (d) => {
    if (d.v === '0' && !confirm('Kullanıcı pasifleştirilsin mi? Giriş yapamaz ve kayıtları göremez.')) return;
    if (await run('kullaniciGuncelle', { id: d.id, aktif: d.v === '1' })) { render(); toast(d.v === '1' ? 'Kullanıcı aktifleştirildi' : 'Kullanıcı pasifleştirildi'); }
  },
  userAdd: async () => {
    const p = { ad: fv('uad').trim(), email: fv('uemail').trim(), rol: fv('urol', 'teknisyen'), sifre: fv('upw') };
    if (p.ad.length < 3) return toast('Ad soyad yazın');
    if (!/^\S+@\S+\.\S+$/.test(p.email)) return toast('Geçerli bir e-posta yazın');
    if (p.sifre.length < 8) return toast('Geçici şifre en az 8 karakter olmalı');
    if (await run('kullaniciEkle', p)) { ui.f = {}; render(); toast(p.ad + ' eklendi'); }
  },
  tab: (d) => { ui.tab = d.k; ui.filt = 'Tümü'; ui.f = {}; render(); window.scrollTo(0, 0); refresh(); },
  filt: (d) => { ui.filt = d.k; render(); },
  back, profil: () => open({ type: 'profil' }),
  openTalep: (d) => open({ type: 'talep', id: d.id }), openPO: (d) => open({ type: 'po', id: d.id }),
  openNotif: (d) => {
    const n = db.bildirimler.find((x) => x.id === d.id);
    if (!n.read.includes(db.currentUser)) { n.read.push(db.currentUser); sb.functions.invoke('islem', { body: { a: 'okundu', p: { id: n.id } } }); }
    if (talep(n.talepId)) open({ type: 'talep', id: n.talepId }); else render();
  },
  readAll: async () => { if (await run('okundu', {})) render(); },
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
  sendTalep: async () => {
    if (!(ui.f.lines || []).length) return toast(ui.f.pick ? 'Önce "Kalemi ekle"ye basın' : 'En az bir kalem ekleyin');
    const r = await run('createTalep', { lines: ui.f.lines, machine: fv('machine', MAKINELER[0]), urgency: fv('urgency', 'Normal'), need: fv('need', addDays(7)), note: fv('note').trim() });
    if (!r) return;
    ui.f = {}; ui.page = { type: 'talep', id: r.id }; render(); window.scrollTo(0, 0);
    toast(r.no + (r.status === 'teklif' ? ' satınalmaya gönderildi' : ' müdür onayına gönderildi'));
  },
  talepOk: () => act('decideTalep', { ok: true, note: fv('note').trim() }, 'Talep onaylandı'),
  talepRed: () => { const n = needNote(); if (n) act('decideTalep', { ok: false, note: n }, 'Talep reddedildi'); },
  talepIptal: () => { if (confirm('Talep iptal edilsin mi?')) act('cancelTalep', {}, 'Talep iptal edildi'); },
  qformOn: () => { ui.f.qform = true; render(); }, qformOff: () => { ui.f.qform = false; render(); },
  addQuote: () => {
    const t = cur(), supplier = fv('qs').trim(), prices = t.lines.map((l, i) => num(fv('qp' + i)));
    if (!supplier) return toast('Tedarikçi adını yazın');
    if (prices.some((p) => p <= 0)) return toast('Her kalem için birim fiyat girin');
    act('addQuote', { supplier, prices, lead: num(fv('ql')), term: fv('qt').trim(), qnote: fv('qn').trim() }, 'Teklif kaydedildi', { note: fv('note') });
  },
  delQuote: (d) => { if (confirm('Teklif silinsin mi?')) act('delQuote', { qid: d.id }, null, ui.f); },
  pickQuote: (d) => { if (cur().pick !== d.id) act('pickQuote', { qid: d.id }, null, ui.f); },
  sendQuotes: () => act('sendQuotes', { note: fv('note', cur().pickNote).trim() }, 'Değerlendirme onayına gönderildi'),
  quoteOk: () => act('decideQuote', { dec: 'ok', note: fv('note').trim() }, (r) => r.status === 'gm_onayi' ? 'Genel Müdür onayına yükseltildi' : 'Onaylandı — satınalma sipariş açabilir'),
  quoteRev: () => { const n = needNote(); if (n) act('decideQuote', { dec: 'rev', note: n }, 'Revizyon istendi'); },
  quoteRed: () => { const n = needNote(); if (n) act('decideQuote', { dec: 'red', note: n }, 'Alım reddedildi'); },
  createPO: () => {
    const q = picked(cur()), eta = fv('eta', addDays(Number(q.lead) || 3));
    if (!eta) return toast('Tahmini teslim tarihini seçin');
    act('createPO', { eta, term: fv('term', q.term || '').trim(), place: fv('place', 'Bakım deposu').trim(), note: fv('note').trim() }, (r) => r.poNo + ' oluşturuldu, onaya gönderildi');
  },
  poOk: () => act('decidePO', { ok: true, note: fv('note').trim() }, 'Sipariş onaylandı'),
  poRed: () => { const n = needNote(); if (n) act('decidePO', { ok: false, note: n }, 'Sipariş reddedildi'); },
  receive: () => {
    const p = po(cur().poId), qtys = p.lines.map((l, i) => num(fv('rq' + i, String(l.qty - l.received))));
    if (p.lines.some((l, i) => qtys[i] > l.qty - l.received)) return toast('Kalan miktardan fazla kabul edilemez');
    if (!qtys.some((q) => q > 0)) return toast('Teslim alınan miktarı girin');
    act('receive', { qtys, irsaliye: fv('irs').trim() }, (r) => r.status === 'depoda' ? 'Mal kabul tamamlandı' : 'Kısmi mal kabul kaydedildi');
  },
  handover: () => act('handover', {}, 'Teslim alındı, talep kapandı'),
  scanOff: () => { if (scanHist) history.back(); else stopScan(); },
  scanYeni: () => startScan((code) => {
    const m = findByCode(code);
    if (m) { A.pickItem({ sku: m.sku }); toast(m.name); }
    else { ui.f.mq = code; render(); toast('Bu barkod tanımlı değil: ' + code + ' — adıyla arayın veya serbest tanımlayın'); }
  }),
  scanStok: () => startScan((code) => {
    const m = findByCode(code);
    if (m) { ui.f = { q: m.sku }; render(); toast(m.name); }
    else if (me().role === 'teknisyen') toast('Bu barkod tanımlı değil: ' + code);
    else { ui.f = { ata: code }; render(); window.scrollTo(0, 0); }
  }),
  ataOff: () => { ui.f = {}; render(); },
  ataSec: async (d) => {
    const m = item(d.sku), kod = ui.f.ata;
    if (m.barkod && !confirm(m.name + ' için tanımlı barkod (' + m.barkod + ') değiştirilsin mi?')) return;
    if (await run('barkodAta', { sku: d.sku, barkod: kod }, 'malzeme')) { ui.f = { q: d.sku }; render(); toast('Barkod tanımlandı: ' + m.name); }
  },
};

document.addEventListener('click', (e) => { const el = e.target.closest('[data-a]'); if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.login input')) { const b = document.querySelector('.login .btn'); if (b) b.click(); } });
const onInput = (e) => { const el = e.target; if (!el.dataset || !el.dataset.bind) return; set(el.dataset.bind, el.value); if ('live' in el.dataset) render(); };
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 20000);

render();
sb.auth.onAuthStateChange((ev, session) => { setTimeout(() => onSession(session), 0); });
})();
