// Satınalma iş akışı kuralları — yalnızca sunucuda (Edge Function) çalışır.
// talep → talep onayı → teklif → değerlendirme onayı → sipariş → sipariş onayı → mal kabul → teslim
export const LIM_TALEP = 1500;   // üstü: Fabrika Müdürü talep onayı
export const LIM_GM = 100000;    // üstü: Genel Müdür onayı
export const KDV = 0.20;

const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const dStr = (iso) => {
  if (/^\d{4}-\d\d-\d\d$/.test(iso)) { const [, m, d] = iso.split('-'); return +d + ' ' + AY[+m - 1]; }
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'numeric' }).formatToParts(new Date(iso));
  return p.find((x) => x.type === 'day').value + ' ' + AY[+p.find((x) => x.type === 'month').value - 1];
};
const money = (n) => '₺' + (Number(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
export const estTotal = (t) => t.lines.reduce((s, l) => s + l.qty * l.est, 0);
export const qTotal = (t, q) => t.lines.reduce((s, l, i) => s + l.qty * (q.prices[i] || 0), 0);
export const picked = (t) => t.quotes.find((q) => q.id === t.pick);

/** c: { me:{id,ad,role}, skus:Set<string> } — out: yan etkiler (bildirim, stok hareketi) */
export function flow(c) {
  const out = { notifs: [], stock: [] };
  const now = () => new Date().toISOString();
  const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const log = (t, text) => t.log.unshift({ at: now(), by: c.me.id, text });
  const stamp = (t, i, text) => { t.stamps[i] = dStr(now()) + ' · ' + text; };
  const notify = (to, text, talepId) => { if (to !== c.me.id) out.notifs.push({ to, text, talepId }); };
  const inStock = (sku) => sku !== 'SERBEST' && c.skus.has(sku);

  function stop(t, i, status, text, note) {
    t.stopAt = i; t.status = status; stamp(t, i, c.me.ad + (status === 'iptal' ? ' iptal etti' : ' reddetti'));
    log(t, text + (note ? ': ' + note : ''));
    notify(t.by, t.no + ' — ' + text.toLowerCase() + (note ? ': ' + note : ''), t.id);
    if (i > 1) notify('role:satinalma', t.no + ' — ' + text.toLowerCase(), t.id);
  }
  return {
    out, stop,
    createTalep(no, d) {
      const t = { id: uid(), no, by: c.me.id, at: now(), machine: d.machine, urgency: d.urgency, need: d.need, note: d.note || '',
        lines: d.lines, quotes: [], pick: null, pickNote: '', poId: null, log: [], stamps: {}, gm: false, direct: false };
      const tot = estTotal(t);
      stamp(t, 0, c.me.ad);
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
      return t;
    },
    decideTalep(t, ok, note) {
      if (!ok) return stop(t, 1, 'reddedildi', 'Talep reddedildi', note);
      t.status = 'teklif'; stamp(t, 1, c.me.ad + ' onayladı');
      log(t, 'Talep onaylandı' + (note ? ': ' + note : ''));
      notify(t.by, t.no + ' talebiniz onaylandı, teklif toplanıyor', t.id);
      notify('role:satinalma', t.no + ' satınalma masasına düştü', t.id);
    },
    addQuote(t, q) {
      const o = { id: uid(), at: now(), by: c.me.id, ...q };
      t.quotes.push(o);
      if (!t.pick) t.pick = o.id;
      log(t, 'Teklif eklendi: ' + q.supplier + ' · ' + money(qTotal(t, o)));
    },
    delQuote(t, id) {
      const q = t.quotes.find((x) => x.id === id);
      t.quotes = t.quotes.filter((x) => x.id !== id);
      if (t.pick === id) t.pick = t.quotes[0] ? t.quotes[0].id : null;
      log(t, 'Teklif silindi: ' + q.supplier);
    },
    sendQuotes(t, note) {
      const q = picked(t);
      t.pickNote = note || ''; t.status = 'teklif_onayi';
      stamp(t, 2, t.quotes.length + ' teklif · öneri ' + q.supplier);
      log(t, 'Teklifler değerlendirme onayına gönderildi · öneri: ' + q.supplier + ' ' + money(qTotal(t, q)));
      notify('role:mudur', t.no + ' teklif değerlendirme onayınızı bekliyor (' + money(qTotal(t, q)) + ')', t.id);
    },
    decideQuote(t, dec, note) {
      const isGm = t.status === 'gm_onayi', i = isGm ? 4 : 3, tot = qTotal(t, picked(t));
      if (dec === 'ok') {
        if (!isGm && tot > LIM_GM) {
          t.status = 'gm_onayi'; t.gm = true; stamp(t, 3, c.me.ad + ' uygun gördü');
          log(t, 'Uygun görüş verildi; ' + money(LIM_GM) + ' üzeri — Genel Müdür onayına yükseltildi' + (note ? ': ' + note : ''));
          notify('role:gm', t.no + ' alım onayınızı bekliyor (' + money(tot) + ')', t.id);
        } else {
          t.status = 'siparis_bekliyor'; stamp(t, i, c.me.ad + ' onayladı');
          log(t, 'Teklif onaylandı: ' + picked(t).supplier + (note ? ' — ' + note : ''));
          notify('role:satinalma', t.no + ' teklifi onaylandı, sipariş açabilirsiniz', t.id);
          notify(t.by, t.no + ' için tedarikçi onaylandı', t.id);
        }
      } else if (dec === 'rev') {
        t.status = 'teklif'; delete t.stamps[2]; delete t.stamps[3]; delete t.stamps[4];
        log(t, 'Revizyon istendi' + (note ? ': ' + note : ''));
        notify('role:satinalma', t.no + ' için revizyon / ek teklif istendi' + (note ? ': ' + note : ''), t.id);
      } else stop(t, i, 'reddedildi', 'Alım reddedildi', note);
    },
    createPO(t, no, d) {
      const q = picked(t);
      const lines = t.lines.map((l, i) => ({ sku: l.sku, name: l.name, qty: l.qty, unit: l.unit, price: q.prices[i] || 0, received: 0 }));
      const subtotal = qTotal(t, q);
      const p = { id: uid(), no, talepId: t.id, supplier: q.supplier, lines, subtotal, kdv: subtotal * KDV, total: subtotal * (1 + KDV),
        eta: d.eta, term: d.term || q.term || '', place: d.place || '', note: d.note || '',
        status: 'onay_bekliyor', approver: subtotal > LIM_GM ? 'gm' : 'mudur', at: now(), by: c.me.id, receipts: [] };
      t.poId = p.id; t.status = 'siparis_onayi';
      stamp(t, 5, p.no + ' · ' + q.supplier);
      log(t, 'Sipariş oluşturuldu: ' + p.no + ' · ' + money(p.total) + ' (KDV dahil)');
      notify('role:' + p.approver, p.no + ' sipariş onayınızı bekliyor (' + money(p.total) + ')', t.id);
      return p;
    },
    decidePO(t, p, ok, note) {
      if (ok) {
        p.status = 'tedarikte'; t.status = 'tedarikte'; stamp(t, 6, c.me.ad + ' onayladı');
        log(t, p.no + ' siparişi onaylandı, tedarikçiye iletildi' + (note ? ' — ' + note : ''));
        notify('role:satinalma', p.no + ' onaylandı, tedarikçiye iletebilirsiniz', t.id);
        notify(t.by, t.no + ' siparişi verildi · tahmini teslim ' + dStr(p.eta), t.id);
      } else {
        p.status = 'reddedildi'; t.poId = null; t.status = 'siparis_bekliyor'; delete t.stamps[5];
        log(t, p.no + ' siparişi reddedildi' + (note ? ': ' + note : ''));
        notify('role:satinalma', p.no + ' reddedildi, siparişi yeniden düzenleyin' + (note ? ': ' + note : ''), t.id);
      }
    },
    receive(t, p, qtys, irsaliye) {
      const items = [];
      p.lines.forEach((l, i) => {
        const q = Math.min(Math.max(qtys[i] || 0, 0), l.qty - l.received);
        if (!q) return;
        l.received += q; items.push({ i, qty: q });
        if (inStock(l.sku)) out.stock.push({ sku: l.sku, delta: q, last: l.price });
      });
      if (!items.length) return false;
      p.receipts.unshift({ at: now(), by: c.me.id, irsaliye: irsaliye || '', items });
      const full = p.lines.every((l) => l.received >= l.qty);
      p.status = full ? 'teslim' : 'kismi'; t.status = full ? 'depoda' : 'kismi';
      const txt = items.map((x) => p.lines[x.i].name + ' ' + x.qty + ' ' + p.lines[x.i].unit).join(', ');
      log(t, (full ? 'Mal kabul tamamlandı' : 'Kısmi mal kabul') + (irsaliye ? ' · irsaliye ' + irsaliye : '') + ' · ' + txt);
      if (full) { stamp(t, 7, 'Depoya girdi'); notify(t.by, t.no + ' malzemeniz depoda, teslim alabilirsiniz', t.id); }
      else notify(t.by, t.no + ' için kısmi teslimat depoya girdi', t.id);
      return true;
    },
    handover(t) {
      t.lines.forEach((l) => { if (inStock(l.sku)) out.stock.push({ sku: l.sku, delta: -l.qty }); });
      t.status = 'teslim'; stamp(t, 8, c.me.ad + ' teslim aldı');
      log(t, 'Malzeme depodan teslim alındı, talep kapandı');
      notify('role:satinalma', t.no + ' teslim alındı ve kapandı', t.id);
    },
  };
}
