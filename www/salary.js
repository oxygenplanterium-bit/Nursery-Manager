/* Labour salary section for Nursery Daily Manager.
   Daily labour attendance, advances, deductions, bonus and monthly salary, kept separately for each nursery.
   Data lives in the same Supabase "docs" table, under these paths (n = nursery 1 or 2, Y = year):
     sa/n/meta   labour list (names, phone, archived flag)            - everyone can read, owner writes
     sa/n/Y      attendance for the year                               - everyone can read and write
     sf/n/meta   wage rates and bonus rule                             - owner only
     sf/n/Y      advances, deductions, salary paid for the year        - owner only
   The app shell (index.html) hands over what this file needs through window.NM. */
(function(){
'use strict';
var NM = window.NM; if(!NM) return;
var $ = function(s){ return document.querySelector(s); };

/* ---------- small helpers ---------- */
var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
var MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MF = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var pad = function(n){ return String(n).padStart(2,'0'); };
var toStr = function(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
var today = function(){ return toStr(new Date()); };
var thisYm = function(){ return today().slice(0,7); };
var parse = function(s){ var p=s.split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); };
var addDays = function(s,n){ var d=parse(s); d.setDate(d.getDate()+n); return toStr(d); };
var fmtDay = function(s){ var d=parse(s); return DW[d.getDay()]+', '+d.getDate()+' '+MS[d.getMonth()]+' '+d.getFullYear(); };
var fmtShort = function(s){ var d=parse(s); return d.getDate()+' '+MS[d.getMonth()]; };
var fmtMonth = function(ym){ var p=ym.split('-').map(Number); return MF[p[1]-1]+' '+p[0]; };
var shiftMonth = function(ym,n){ var p=ym.split('-').map(Number), y=p[0], m=p[1]+n; while(m>12){m-=12;y++;} while(m<1){m+=12;y--;} return y+'-'+pad(m); };
var dim = function(ym){ var p=ym.split('-').map(Number); return new Date(p[0],p[1],0).getDate(); };
var numf = function(n){ return Number.isInteger(n) ? String(n) : n.toFixed(1); };
var inr = function(n){ return (n<0?'−':'')+'₹'+Math.abs(Math.round(n)).toLocaleString('en-IN'); };
var uid = function(p){ return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6); };
var LBL = {P:'Present',H:'Half day',A:'Absent','':'Not marked'};
var isOwner = function(){ return NM.isOwner(); };

/* ---------- state ---------- */
var S = { n:'', unsubs:[], docs:{}, yrsKey:'', ver:0, dver:-1, sub:'att', date:today(), adM:thisYm(), payM:thisYm(), open:'', confirm:'', q:'', got:{}, err:false };
var D = { labours:{}, att:{}, adv:{}, ded:{}, pay:{}, settings:{} };   /* derived from S.docs */
var chain = Promise.resolve();

function yearsFor(){
  var cur = new Date().getFullYear(), m = S.docs['sa/'+S.n+'/meta'] || {};
  var y0 = Math.min(+m.y0 || cur, cur - 1), out = [];
  for(var y=y0; y<=cur; y++) out.push(y);
  return out;
}
function subscribe(){
  var db = NM.db(); if(!db) return;
  var owner = isOwner(), n = NM.nursery();
  var key0 = n+'|'+owner;
  if(S.key0 !== key0){
    S.unsubs.forEach(function(u){ try{ u(); }catch(e){} });
    S.unsubs = []; S.docs = {}; S.yrsKey = ''; S.got = {}; S.watching = {}; S.n = n; S.key0 = key0; S.open = ''; S.confirm = ''; S.ver++;
    watch('sa/'+n+'/meta');
    if(owner) watch('sf/'+n+'/meta');
  }
  var ys = yearsFor(), yk = ys.join(',');
  if(yk !== S.yrsKey){
    S.yrsKey = yk;
    ys.forEach(function(y){
      var p1 = 'sa/'+n+'/'+y; if(!S.watching[p1]) watch(p1);
      if(owner){ var p2 = 'sf/'+n+'/'+y; if(!S.watching[p2]) watch(p2); }
    });
  }
}
function watch(path){
  var db = NM.db(); S.watching = S.watching || {};
  if(S.watching[path]) return;
  S.watching[path] = true;
  var un = db.doc(path).onSnapshot(function(s){
    S.docs[path] = s.exists ? s.data() : null; S.got[path] = true; S.err = false; S.ver++;
    if(/\/meta$/.test(path)) subscribe();
    schedule();
  }, function(){ S.err = true; S.got[path] = true; schedule(); });
  S.unsubs.push(un);
}
var rafT = 0;
function schedule(){ if(rafT) return; rafT = requestAnimationFrame(function(){ rafT = 0; paint(); }); }

/* ---------- derive working tables from the stored docs ---------- */
function derive(){
  if(S.dver === S.ver) return; S.dver = S.ver;
  var n = S.n, m = S.docs['sa/'+n+'/meta'] || {}, fm = S.docs['sf/'+n+'/meta'] || {};
  var lab = {}, att = {}, adv = {}, ded = {}, pay = {};
  Object.keys(m.lab || {}).forEach(function(id){
    var x = m.lab[id]; if(!x) return;
    lab[id] = { id:id, name:x.n||'', phone:x.ph||'', active:x.act!==false, created:x.c||0, rates:(fm.rates&&fm.rates[id])||[] };
  });
  yearsFor().forEach(function(y){
    var a = S.docs['sa/'+n+'/'+y], f = S.docs['sf/'+n+'/'+y];
    if(a && a.a) Object.keys(a.a).forEach(function(id){
      var o = a.a[id]; if(!o) return;
      Object.keys(o).forEach(function(date){
        var s = o[date]; if(!s) return;
        var ym = date.slice(0,7), k = id+'_'+ym;
        (att[k] = att[k] || { labourId:id, ym:ym, d:{} }).d[String(+date.slice(8,10))] = s;
      });
    });
    if(f){
      Object.keys(f.adv||{}).forEach(function(id){ var o=f.adv[id]; if(o) adv[id] = { id:id, labourId:o.l, date:o.date, amount:o.amt, note:o.note||'', created:o.at||0 }; });
      Object.keys(f.ded||{}).forEach(function(id){ var o=f.ded[id]; if(o) ded[id] = { id:id, labourId:o.l, date:o.date, amount:o.amt, note:o.note||'', created:o.at||0 }; });
      Object.keys(f.pay||{}).forEach(function(k){ var o=f.pay[k]; if(o) pay[k] = { labourId:o.l, ym:o.ym, paidOn:o.paidOn, amount:o.amount==null?null:o.amount }; });
    }
  });
  D = { labours:lab, att:att, adv:adv, ded:ded, pay:pay, settings:{ bonus:fm.bonus||{} } };
}

/* ---------- salary engine (same rules as the Labour Ledger app) ---------- */
function labList(all){
  return Object.keys(D.labours).map(function(k){ return D.labours[k]; })
    .filter(function(l){ return all || l.active !== false; })
    .sort(function(a,b){ return (a.created||0)-(b.created||0) || String(a.name).localeCompare(String(b.name)); });
}
function rateFor(l, ym){
  var r = (l.rates||[]).slice().sort(function(a,b){ return a.from<b.from?-1:a.from>b.from?1:0; });
  var w = r.length ? r[0].wage : 0;
  r.forEach(function(x){ if(x.from <= ym) w = x.wage; });
  return w;
}
var attDoc = function(id, ym){ return D.att[id+'_'+ym]; };
var statusAt = function(id, date){ var a = attDoc(id, date.slice(0,7)); return a && a.d ? (a.d[String(+date.slice(8,10))] || '') : ''; };
function sumDays(id, ym, fn){
  var a = attDoc(id, ym); if(!a || !a.d) return 0;
  var n = 0; for(var k in a.d) n += fn(a.d[k]); return n;
}
var daysWorked = function(id, ym){ return sumDays(id, ym, function(s){ return s==='P'?1:s==='H'?.5:0; }); };
var absentDays = function(id, ym){ return sumDays(id, ym, function(s){ return s==='A'?1:s==='H'?.5:0; }); };
var markedDays = function(id, ym){ return sumDays(id, ym, function(s){ return s?1:0; }); };
/* First month this labour appears in: when added, or earlier if data was entered for earlier months. */
function labStart(l){
  var m = l.created ? toStr(new Date(l.created)).slice(0,7) : thisYm();
  Object.keys(D.att).forEach(function(k){ var v=D.att[k]; if(v.labourId===l.id && v.ym < m) m = v.ym; });
  Object.keys(D.adv).concat(Object.keys(D.ded)).forEach(function(k){
    var a = D.adv[k] || D.ded[k];
    if(a.labourId===l.id){ var x=(a.date||'').slice(0,7); if(x && x<m) m=x; }
  });
  return m;
}
/* An advance is deducted from the earliest month whose salary was still unpaid on the day it was given. */
function advMap(){
  var by = {}, tgt = {}, starts = {};
  Object.keys(D.adv).forEach(function(id){
    var a = D.adv[id], dm = (a.date||'').slice(0,7); if(!dm) return;
    var l = D.labours[a.labourId];
    if(l && starts[l.id]===undefined) starts[l.id] = labStart(l);
    var e = l ? starts[l.id] : dm; if(e > dm) e = dm;
    for(var g=0; g<600; g++){
      var p = D.pay[a.labourId+'_'+e];
      if(p && (p.paidOn||'') < a.date) e = shiftMonth(e,1); else break;
    }
    tgt[a.id] = e;
    var lab = by[a.labourId] = by[a.labourId] || {};
    (lab[e] = lab[e] || []).push(a);
  });
  return { by:by, tgt:tgt };
}
var advIn = function(id, ym, am){ return ((am || advMap()).by[id] || {})[ym] || []; };
var advTotal = function(id, ym, am){ return advIn(id, ym, am).reduce(function(s,a){ return s+(+a.amount||0); }, 0); };
var dedIn = function(id, ym){ return Object.keys(D.ded).map(function(k){ return D.ded[k]; }).filter(function(a){ return a.labourId===id && (a.date||'').slice(0,7)===ym; }); };
var dedTotal = function(id, ym){ return dedIn(id, ym).reduce(function(s,a){ return s+(+a.amount||0); }, 0); };
function firstMonth(){
  var m = null;
  Object.keys(D.att).forEach(function(k){ var v=D.att[k]; if(!m || v.ym < m) m = v.ym; });
  Object.keys(D.adv).concat(Object.keys(D.ded)).forEach(function(k){ var a=D.adv[k]||D.ded[k], x=(a.date||'').slice(0,7); if(x && (!m || x<m)) m=x; });
  return m;
}
function bonusFor(rate){
  var b = D.settings.bonus || {}, v = +b.value || 0;
  return b.mode==='flat' ? Math.round(v) : Math.round(v*rate);
}
/* Balance = daily wage x days in month + bonus - advances - absent deductions - other deductions - advance carried from earlier months.
   A shortfall (or excess salary paid) is carried into the next month as an advance. */
function calcMonth(ym){
  var m = firstMonth(); if(!m || m > ym) m = ym;
  var carry = {}, rows = {}, guard = 0, am = advMap(), starts = {};
  for(;;){
    rows = {};
    labList(true).forEach(function(l){
      if(starts[l.id]===undefined) starts[l.id] = labStart(l);
      if(m < starts[l.id]) return;
      var days = daysWorked(l.id,m), rate = rateFor(l,m), nd = dim(m), ab = absentDays(l.id,m);
      var gross = Math.round(rate*nd), absDed = Math.round(ab*rate);
      var adv = advTotal(l.id,m,am), ded = dedTotal(l.id,m), bf = carry[l.id] || 0;
      var paid = D.pay[l.id+'_'+m] || null;
      var unmarked = Math.max(0, nd - markedDays(l.id,m));
      var over = m < thisYm() || unmarked===0;
      var bstatus = ab>0 ? 'no' : days===0 ? 'none' : over ? 'ok' : 'track';
      var bonus = bstatus==='ok' ? bonusFor(rate) : 0;
      var net = gross + bonus - adv - absDed - ded + bf, due = Math.max(0, net);
      var paidAmt = paid ? (paid.amount==null ? due : (+paid.amount||0)) : 0;
      var excess = paid ? Math.max(0, paidAmt - due) : 0;
      var owe = Math.max(0, -net) + excess;
      rows[l.id] = { l:l, bonus:bonus, bstatus:bstatus, paid:paid, paidAmt:paidAmt, excess:excess, days:days, rate:rate, nd:nd, ab:ab, unmarked:unmarked, gross:gross, absDed:absDed, adv:adv, ded:ded, bf:bf, net:net, pay:due, owe:owe };
      carry[l.id] = -owe;
    });
    if(m === ym || ++guard > 600) break;
    m = shiftMonth(m, 1);
  }
  return rows;
}
function monthRows(ym){
  var rows = calcMonth(ym);
  return labList(true).map(function(l){ return rows[l.id]; }).filter(function(r){ return r && (r.l.active !== false || r.days>0 || r.adv>0 || r.ded>0 || r.ab>0 || r.bf!==0); });
}

/* ---------- writes ---------- */
function strip(o){
  if(o && typeof o === 'object' && !Array.isArray(o)){
    var r = {}; Object.keys(o).forEach(function(k){ if(o[k] !== null){ var v = strip(o[k]); r[k] = v; } }); return r;
  }
  return o;
}
function merge(a, b){
  var r = a && typeof a==='object' && !Array.isArray(a) ? JSON.parse(JSON.stringify(a)) : {};
  Object.keys(b).forEach(function(k){
    var v = b[k];
    if(v === null) delete r[k];
    else if(v && typeof v==='object' && !Array.isArray(v)) r[k] = merge(r[k], v);
    else r[k] = v;
  });
  return r;
}
function put(path, patch){
  S.docs[path] = merge(S.docs[path] || {}, patch); S.ver++; schedule();      /* show the change at once */
  var db = NM.db();
  var p = chain.then(function(){
    var d = db.doc(path);
    return d.update(patch).catch(function(e){ if(e && e.code==='not_found') return d.set(strip(patch)); throw e; });
  });
  chain = p.catch(function(){});
  return p.then(function(){ return true; }, function(){
    NM.toast('Could not save. Check your connection and try again.');
    S.dver = -1; S.ver++; schedule();
    return false;
  });
}
var yearOf = function(date){ return date.slice(0,4); };
function bumpY0(date){
  var y = +yearOf(date), m = S.docs['sa/'+S.n+'/meta'] || {}, cur = new Date().getFullYear();
  if(y < Math.min(+m.y0 || cur, cur)) return put('sa/'+S.n+'/meta', { y0:y });
}
function canMark(date){ return isOwner() || (date <= today() && date >= addDays(today(), -6)); }
function setStatus(id, date, s){
  if(!NM.canWrite()) { NM.toast('You have view-only access.'); return; }
  if(!canMark(date)){ NM.toast('Supervisors can mark today and the last 6 days only.'); return; }
  if(NM.needSup()){ NM.toast('Choose your name at the top first.'); return; }
  if(isOwner()) bumpY0(date);
  var o = {}; o[date] = s || null;
  var a = {}; a[id] = o;
  put('sa/'+S.n+'/'+yearOf(date), { a:a });
}
function putLabour(id, fields){
  var l = {}; l[id] = fields;
  return put('sa/'+S.n+'/meta', { lab:l });
}
function putRates(id, arr){
  var r = {}; r[id] = arr;
  return put('sf/'+S.n+'/meta', { rates:r });
}
function putFin(kind, id, val, date){
  var o = {}; o[id] = val; var p = {}; p[kind] = o;
  if(val) bumpY0(date);
  return put('sf/'+S.n+'/'+yearOf(date), p);
}

/* ---------- views ---------- */
var hit = function(name){ var q = S.q.trim().toLowerCase(); return !q || String(name).toLowerCase().includes(q); };
var noHit = function(){ return '<div class="card state">No one matches “'+esc(S.q.trim())+'”.</div>'; };
var emptyBlock = function(){ return '<div class="card state"><p style="margin:0">No labour added yet.</p>'+(isOwner()?'<button class="btn primary" data-act="sheet-lab">+ Add labour</button>':'<p class="pmeta">The owner adds labour in the Labour tab.</p>')+'</div>'; };
var ready = function(){ return !!S.n && ((S.got['sa/'+S.n+'/meta'] && (!isOwner() || S.got['sf/'+S.n+'/meta'])) || S.err); };
var skeleton = function(){ return '<div class="card state">Loading…</div>'; };
function monthNav(key, ym){
  var atMax = ym >= thisYm();
  return '<div class="sx-nav"><button class="btn" data-act="mon" data-key="'+key+'" data-v="-1" aria-label="Previous month">‹</button>'
    + '<div class="sx-navl">'+fmtMonth(ym)+'</div>'
    + '<button class="btn" data-act="mon" data-key="'+key+'" data-v="1" aria-label="Next month"'+(atMax?' disabled':'')+'>›</button></div>';
}

function viewAtt(){
  var labs = labList(false);
  if(!labs.length) return emptyBlock();
  var d = S.date, ym = d.slice(0,7), canDay = canMark(d) && NM.canWrite(), own = isOwner();
  var c = { P:0, H:0, A:0, U:0 };
  labs.forEach(function(l){ c[statusAt(l.id, d) || 'U']++; });
  var out = '<div class="sx-nav"><button class="btn" data-act="day" data-v="-1" aria-label="Previous day">‹</button>'
    + '<label class="sx-navl"><span>'+fmtDay(d)+'</span><input type="date" id="salDate" value="'+d+'"'+(own?'':' min="'+addDays(today(),-6)+'" max="'+today()+'"')+' aria-label="Pick a date"></label>'
    + '<button class="btn" data-act="day" data-v="1" aria-label="Next day">›</button></div>';
  if(d !== today()) out += '<button class="btn small" data-act="day" data-v="today">Back to today</button>';
  out += '<p class="tsum">'+c.P+' present · '+c.H+' half day · '+c.A+' absent · '+c.U+' not marked</p>';
  if(!canMark(d)) out += '<p class="pmeta">Supervisors can mark today and the last 6 days only.</p>';
  var rows = labs.map(function(l,i){ return { l:l, i:i }; }).filter(function(x){ return hit(x.l.name); });
  out += rows.map(function(x){
    var l = x.l, s = statusAt(l.id, d);
    var btns = [['P','✔ Present',''],['H','½ Half day','h'],['A','✖ Absent','a']].map(function(b){
      return '<button type="button" class="btn '+b[2]+'" data-act="mark" data-id="'+esc(l.id)+'" data-s="'+b[0]+'" aria-pressed="'+(s===b[0])+'"'+(canDay?'':' disabled')+'>'+b[1]+'</button>';
    }).join('');
    return '<div class="card arow"><div class="ttop"><span class="sl sx-no">'+pad(x.i+1)+'</span><div class="ttitle">'+esc(l.name)+'</div></div>'
      + '<div class="aseg">'+btns+'</div>'
      + '<div class="tmeta">'+(own?inr(rateFor(l,ym))+'/day · ':'')+numf(daysWorked(l.id,ym))+' days in '+MS[+ym.slice(5,7)-1]+(s?' · '+LBL[s]:' · Not marked')+'</div></div>';
  }).join('');
  if(!rows.length) out += noHit();
  if(canDay && c.U>0 && !S.q.trim()) out += '<button class="btn" data-act="markrest">Mark the '+c.U+' not marked as present</button>';
  return out;
}

function viewAdv(){
  var ym = S.adM, am = advMap();
  var items = Object.keys(D.adv).map(function(k){ return D.adv[k]; }).filter(function(a){ return (a.date||'').slice(0,7)===ym; })
    .sort(function(a,b){ return a.date<b.date?1:a.date>b.date?-1:(b.created||0)-(a.created||0); });
  var total = items.reduce(function(s,a){ return s+(+a.amount||0); }, 0), per = {};
  items.forEach(function(a){ per[a.labourId] = (per[a.labourId]||0) + (+a.amount||0); });
  var nameOf = function(id){ return D.labours[id] ? D.labours[id].name : 'Removed labour'; };
  var np = Object.keys(per).length;
  var out = monthNav('adM', ym)
    + '<section class="card sx-hero"><div class="sx-herorow"><div><div class="sx-eye">Given in '+fmtMonth(ym)+'</div><div class="sx-big">'+inr(total)+'</div></div>'
    + (labList(false).length ? '<button class="btn primary" data-act="sheet-adv">+ Give advance</button>' : '')+'</div>'
    + '<p class="pmeta">'+items.length+(items.length===1?' entry':' entries')+' · '+np+(np===1?' labour':' labours')+'</p></section>';
  if(!labList(true).length) return out + emptyBlock();
  if(!items.length) return out + '<div class="card state">No advances recorded in '+fmtMonth(ym)+'.</div>';
  var ids = Object.keys(per).sort(function(a,b){ return per[b]-per[a]; }).filter(function(id){ return hit(nameOf(id)); });
  if(!ids.length) return out + noHit();
  return out + ids.map(function(id){
    var rows = items.filter(function(a){ return a.labourId===id; }).map(function(a){
      var ask = S.confirm===a.id, tg = am.tgt[a.id];
      var meta = tg && tg!==ym ? 'deducted from '+fmtMonth(tg) : '';
      return '<div class="sx-ent"><span class="sx-d">'+fmtShort(a.date)+'</span><div class="sx-t">'+esc(a.note||'Advance')+(meta?'<div class="tmeta">'+esc(meta)+'</div>':'')+'</div>'
        + (ask ? '<span class="sx-ask"><button class="btn small danger" data-act="adel-yes" data-id="'+esc(a.id)+'">Delete</button><button class="btn small" data-act="cancel-ask">No</button></span>'
               : '<b class="sx-v">'+inr(a.amount)+'</b><button class="btn small" data-act="adel-ask" data-id="'+esc(a.id)+'" aria-label="Delete this advance">×</button>')
        + '</div>';
    }).join('');
    return '<section class="card sx-grp"><div class="sx-grph"><span class="ttitle">'+esc(nameOf(id))+'</span><b class="sx-v">'+inr(per[id])+'</b></div>'+rows+'</section>';
  }).join('');
}

function viewBonus(){
  var ym = S.payM, out = monthNav('payM', ym);
  if(!labList(true).length) return out + emptyBlock();
  var b = D.settings.bonus || {}, v = +b.value || 0;
  var rule = !(v>0) ? 'No bonus amount set yet'
    : b.mode==='flat' ? inr(v)+' for each labour with no absence'
    : numf(v)+(v===1?' day':' days')+' of wages for each labour with no absence';
  var rows = monthRows(ym).map(function(r,i){ return { r:r, i:i }; });
  var vis = rows.filter(function(x){ return hit(x.r.l.name); });
  var elig = vis.filter(function(x){ return x.r.bstatus==='ok'; }), track = vis.filter(function(x){ return x.r.bstatus==='track'; });
  var no = vis.filter(function(x){ return x.r.bstatus==='no' || x.r.bstatus==='none'; });
  var total = rows.reduce(function(s,x){ return s+x.r.bonus; }, 0), count = rows.filter(function(x){ return x.r.bstatus==='ok'; }).length;
  out += '<section class="card sx-hero"><div class="sx-herorow"><div><div class="sx-eye">Bonus · '+fmtMonth(ym)+'</div><div class="sx-big">'+inr(total)+'</div></div>'
    + '<button class="btn primary" data-act="sheet-bonus">'+(v>0?'Change bonus':'Set bonus')+'</button></div>'
    + '<p class="pmeta">'+count+(count===1?' labour':' labours')+' with no absence</p><p class="pmeta">'+esc(rule)+'. A half day counts as an absence.</p></section>';
  var row = function(x, right, meta){
    return '<div class="card sx-line"><span class="sl sx-no">'+pad(x.i+1)+'</span><div class="sx-who"><div class="ttitle">'+esc(x.r.l.name)+'</div><div class="tmeta">'+meta+'</div></div>'+right+'</div>';
  };
  var un = function(r){ return r.unmarked>0 ? ' · '+r.unmarked+' not marked' : ''; };
  if(elig.length) out += '<h2 class="sx-sec">Gets bonus ('+elig.length+')</h2>' + elig.map(function(x){
    return row(x, '<b class="sx-v">'+(x.r.bonus?'+'+inr(x.r.bonus):'—')+'</b>', numf(x.r.days)+' days present · no absence'+un(x.r)); }).join('');
  if(track.length) out += '<h2 class="sx-sec">On track (month not over)</h2>' + track.map(function(x){
    return row(x, '', 'No absence so far'+un(x.r)); }).join('');
  if(no.length) out += '<h2 class="sx-sec">Not eligible ('+no.length+')</h2>' + no.map(function(x){
    return row(x, '', x.r.bstatus==='none' ? 'No attendance marked' : numf(x.r.ab)+(x.r.ab===1?' absent day':' absent days')); }).join('');
  if(!vis.length) out += noHit();
  return out + '<p class="pmeta">Unmarked days are not counted as absences, so mark every day before relying on this.</p>';
}

function normPhone(p){ var d = String(p||'').replace(/\D/g,''); return d.length===10 ? '91'+d : d; }
var waLink = function(text, phone){ return 'https://wa.me/'+normPhone(phone)+'?text='+encodeURIComponent(text); };
function slipText(r, ym){
  var L = ['*'+r.l.name+'* — salary slip, '+fmtMonth(ym), 'Salary: '+inr(r.rate)+' × '+r.nd+' days = '+inr(r.gross)];
  if(r.bonus) L.push('Add bonus (no absence): +'+inr(r.bonus));
  if(r.adv) L.push('Less advance received: −'+inr(r.adv));
  if(r.absDed) L.push('Less absent deduction ('+numf(r.ab)+' days): −'+inr(r.absDed));
  if(r.ded) L.push('Less other deductions: −'+inr(r.ded));
  if(r.bf) L.push('Less advance recovered from previous month: −'+inr(-r.bf));
  L.push(r.paid ? '*Paid on '+fmtShort(r.paid.paidOn)+': '+inr(r.paidAmt)+'*' : r.owe ? 'Advance to recover: '+inr(r.owe) : '*Balance to be paid: '+inr(r.pay)+'*');
  if(r.owe) L.push('To be recovered next month as advance: '+inr(r.owe));
  return L.join('\n');
}
function summaryText(rows, ym, t){
  var L = ['*Salary summary — '+NM.nurseryName()+', '+fmtMonth(ym)+'*'];
  rows.forEach(function(r){ L.push(r.l.name+': '+inr(r.gross)+' − adv '+inr(r.adv)+' − absent '+inr(r.absDed)+(r.ded?' − other '+inr(r.ded):'')+' = '+(r.owe?'recover '+inr(r.owe):inr(r.pay))); });
  L.push('Total balance to pay: '+inr(t.pay));
  return L.join('\n');
}
function gridHTML(id, ym){
  var n = dim(ym), first = new Date(+ym.slice(0,4), +ym.slice(5,7)-1, 1).getDay();
  var h = '<div class="sx-grid">' + ['S','M','T','W','T','F','S'].map(function(x){ return '<span class="sx-gh">'+x+'</span>'; }).join('');
  for(var i=0;i<first;i++) h += '<span></span>';
  for(var d=1; d<=n; d++){
    var s = statusAt(id, ym+'-'+pad(d));
    h += '<button type="button" class="sx-cell'+(s?' s'+s:'')+'" data-act="cell" data-id="'+esc(id)+'" data-ym="'+ym+'" data-day="'+d+'" aria-label="'+d+' '+fmtMonth(ym)+': '+LBL[s]+'"><span>'+d+'</span><b>'+(s==='H'?'½':s)+'</b></button>';
  }
  return h + '</div>';
}
function statement(r, ym){
  var row = function(k, v, cls){ return '<dt'+(cls?' class="'+cls+'"':'')+'>'+k+'</dt><dd'+(cls?' class="'+cls+'"':'')+'>'+v+'</dd>'; };
  var less = function(n){ return n ? '−'+inr(n) : inr(0); };
  return '<dl class="sx-sum">'
    + row('Salary<div class="tmeta">'+inr(r.rate)+' × '+r.nd+' days</div>', inr(r.gross))
    + (r.bonus ? row('Add bonus<div class="tmeta">no absence in '+fmtMonth(ym)+'</div>', '+'+inr(r.bonus)) : '')
    + row('Less advance received', less(r.adv))
    + row('Less absent deduction<div class="tmeta">'+numf(r.ab)+(r.ab===1?' day':' days')+' × '+inr(r.rate)+'</div>', less(r.absDed))
    + row('Less other deductions', less(r.ded))
    + (r.bf ? row('Less advance recovered from previous month<div class="tmeta">excess paid earlier</div>', less(-r.bf)) : '')
    + (r.paid ? row('Salary paid on '+fmtShort(r.paid.paidOn), inr(r.paidAmt), 'tot')
              : r.owe ? row('Advance to recover', inr(r.owe), 'tot')
                      : row('Balance to be paid', inr(r.pay), 'tot'))
    + (r.owe ? row('To be recovered in '+fmtMonth(shiftMonth(ym,1))+' as advance', inr(r.owe), 'carry') : '')
    + '</dl>';
}
function payDetail(r, ym){
  var ad = advIn(r.l.id, ym).sort(function(a,b){ return a.date<b.date?-1:1; });
  var dd = dedIn(r.l.id, ym).sort(function(a,b){ return a.date<b.date?-1:1; });
  var warn = r.unmarked>0 ? '<p class="pmeta">'+r.unmarked+(r.unmarked===1?' day is':' days are')+' not marked yet. Unmarked days are not deducted.</p>' : '';
  var adv = ad.length ? '<h2 class="sx-sec">Advances received</h2>'+ad.map(function(a){
    return '<div class="sx-ent"><span class="sx-d">'+fmtShort(a.date)+'</span><div class="sx-t">'+esc(a.note||'Advance')+'</div><b class="sx-v">'+inr(a.amount)+'</b></div>'; }).join('') : '';
  var dl = dd.length ? '<h2 class="sx-sec">Other deductions</h2>'+dd.map(function(a){
    var ask = S.confirm===a.id;
    return '<div class="sx-ent"><span class="sx-d">'+fmtShort(a.date)+'</span><div class="sx-t">'+esc(a.note||'Deduction')+'</div>'
      + (ask ? '<span class="sx-ask"><button class="btn small danger" data-act="ddel-yes" data-id="'+esc(a.id)+'">Delete</button><button class="btn small" data-act="cancel-ask">No</button></span>'
             : '<b class="sx-v">'+inr(a.amount)+'</b><button class="btn small" data-act="ddel-ask" data-id="'+esc(a.id)+'" aria-label="Delete this deduction">×</button>')
      + '</div>'; }).join('') : '';
  var acts = '<div class="sx-btns"><a class="btn small" target="_blank" rel="noopener" href="'+esc(waLink(slipText(r,ym), r.l.phone))+'">Send slip on WhatsApp</a>'
    + '<button class="btn small" data-act="sheet-adv" data-id="'+esc(r.l.id)+'">Give advance</button><button class="btn small" data-act="sheet-ded" data-id="'+esc(r.l.id)+'">Add deduction</button></div>';
  return warn + adv + dl
    + '<div class="tsum sx-legend"><span>✔ Present</span><span>½ Half</span><span>✖ Absent</span><span>Tap a day to change it</span></div>'
    + gridHTML(r.l.id, ym) + acts;
}
function viewSalary(){
  var ym = S.payM, out = monthNav('payM', ym);
  if(!labList(true).length) return out + emptyBlock();
  var rows = monthRows(ym);
  var t = rows.reduce(function(a,r){ return { pay:a.pay+(r.paid?0:r.pay), done:a.done+(r.paid?r.paidAmt:0), bonus:a.bonus+r.bonus, gross:a.gross+r.gross, adv:a.adv+r.adv, absDed:a.absDed+r.absDed, ded:a.ded+r.ded, owe:a.owe+r.owe }; }, { pay:0, done:0, bonus:0, gross:0, adv:0, absDed:0, ded:0, owe:0 });
  out += '<section class="card sx-hero"><div class="sx-eye">Balance to be paid · '+fmtMonth(ym)+'</div><div class="sx-big">'+inr(t.pay)+'</div>'
    + '<p class="tsum"><span>Salary '+inr(t.gross)+'</span>'+(t.bonus?'<span>Bonus +'+inr(t.bonus)+'</span>':'')+'<span>Advances −'+inr(t.adv)+'</span><span>Absent −'+inr(t.absDed)+'</span>'+(t.ded?'<span>Other −'+inr(t.ded)+'</span>':'')+(t.done?'<span>Already paid '+inr(t.done)+'</span>':'')+(t.owe?'<span>To recover '+inr(t.owe)+'</span>':'')+'</p>'
    + '<div class="sx-btns"><a class="btn small" target="_blank" rel="noopener" href="'+esc(waLink(summaryText(rows,ym,t)))+'">Share on WhatsApp</a><button class="btn small" data-act="csv">Download CSV</button></div></section>';
  out += '<h2 class="sx-sec">Salary statement <span class="pmeta">Tap a name for full details</span></h2>';
  out += rows.map(function(r,i){ return { r:r, i:i }; }).filter(function(x){ return hit(x.r.l.name); }).map(function(x){
    var r = x.r, open = S.open===r.l.id;
    return '<article class="card sx-pay'+(open?' open':'')+'"><button type="button" class="sx-payh" data-act="open" data-id="'+esc(r.l.id)+'" aria-expanded="'+open+'">'
      + '<span class="sl sx-no">'+pad(x.i+1)+'</span><span class="ttitle">'+esc(r.l.name)+(r.l.active===false?' <span class="chip">Archived</span>':'')+'</span>'
      + '<span class="sx-amt"><b>'+(r.paid?inr(r.paidAmt):r.owe?inr(r.owe):inr(r.pay))+'</b><small>'+(r.paid?'paid':r.owe?'to recover':'to be paid')+'</small></span>'
      + '<span aria-hidden="true">'+(open?'⌄':'›')+'</span></button>'
      + (open ? '<div class="sx-body">'+statement(r,ym)+'<div class="sx-btns">'
          + (r.paid ? '<button class="btn small" data-act="unpay" data-id="'+esc(r.l.id)+'">Undo salary paid</button>' : '<button class="btn small primary" data-act="sheet-paid" data-id="'+esc(r.l.id)+'">Mark salary paid</button>')
          + '</div>'+payDetail(r,ym)+'</div>' : '') + '</article>';
  }).join('');
  if(rows.length && !rows.some(function(r){ return hit(r.l.name); })) out += noHit();
  out += '<p class="pmeta">Advances are deducted from the oldest month that is not marked paid. Mark a month paid to start deducting from the next one.</p>';
  if(t.owe || rows.some(function(r){ return r.bf; })) out += '<p class="pmeta">When deductions are more than the salary, or more than the balance was paid, the rest is carried into next month and taken off then.</p>';
  if(!rows.length) out += '<div class="card state">Nothing to pay for '+fmtMonth(ym)+' yet.</div>';
  return out;
}

function viewCrew(){
  var act = labList(false), arch = labList(true).filter(function(l){ return l.active===false; });
  var out = '<button class="btn primary" data-act="sheet-lab">+ Add labour</button>';
  var ym = thisYm();
  var item = function(l,i,archived){
    return '<button type="button" class="card sx-line sx-tap" data-act="sheet-lab" data-id="'+esc(l.id)+'"><span class="sl sx-no">'+pad(i+1)+'</span>'
      + '<span class="sx-who"><span class="ttitle">'+esc(l.name)+'</span><span class="tmeta">'+inr(rateFor(l,ym))+'/day'+(l.phone?' · '+esc(l.phone):'')+'</span></span><span aria-hidden="true">›</span></button>';
  };
  var shown = act.map(function(l,i){ return { l:l, i:i }; }).filter(function(x){ return hit(x.l.name); });
  out += shown.map(function(x){ return item(x.l, x.i); }).join('');
  if(!act.length) out += '<div class="card state">No labour added yet.</div>';
  else if(!shown.length) out += noHit();
  var ash = arch.filter(function(l){ return hit(l.name); });
  if(ash.length) out += '<h2 class="sx-sec">Archived ('+ash.length+')</h2>' + ash.map(function(l,i){ return item(l,i,true); }).join('');
  return out + '<p class="pmeta">Tap a name to change the daily wage, phone or to archive. Archived labour no longer appear in attendance, and their past records stay in the salary statement.</p>';
}

/* ---------- sheets (one shared dialog) ---------- */
var sheetCtx = null;
function openSheet(html, focus, tall){
  var dlg = $('#dlgSal'); $('#salSheet').innerHTML = html;
  dlg.classList.toggle('tall', !!tall);
  if(!dlg.open){ try{ dlg.showModal(); }catch(e){ dlg.setAttribute('open',''); } }
  if(focus){ var f = $('#'+focus); if(f) setTimeout(function(){ try{ f.focus(); }catch(e){} }, 60); }
}
function closeSheet(){ var dlg = $('#dlgSal'); if(dlg.open) dlg.close(); $('#salSheet').innerHTML = ''; sheetCtx = null; }
var head = function(t){ return '<div class="sx-sh"><h2>'+t+'</h2><button type="button" class="btn small" data-act="close" aria-label="Close">×</button></div>'; };

function advSheet(labId){
  var labs = labList(false); if(!labs.length) return;
  sheetCtx = { kind:'adv', sel:labId || '' };
  var list = labs.map(function(l,i){
    return '<button type="button" class="sx-p'+(l.id===labId?' on':'')+'" data-act="pick" data-id="'+esc(l.id)+'" data-name="'+esc(l.name.toLowerCase())+'"><span class="sl sx-no">'+pad(i+1)+'</span><span class="ttitle">'+esc(l.name)+'</span></button>';
  }).join('');
  openSheet('<form id="fAdv" novalidate><div class="sx-sh"><h2>Give advance</h2>'
    + '<input type="date" id="aDate" class="sx-dateTop" value="'+today()+'" max="'+today()+'" aria-label="Date"><button type="button" class="btn small" data-act="close" aria-label="Close">×</button></div>'
    + '<input type="search" id="aQ" placeholder="Search name" aria-label="Search name" autocomplete="off">'
    + '<div class="sx-pick" id="aPick">'+list+'</div>'
    + '<label class="f"><span>Amount (₹)</span><input id="aAmt" type="number" inputmode="decimal" min="1" step="any" class="sx-amtIn" placeholder="0"></label>'
    + '<label class="f"><span>Notes</span><textarea id="aNote" rows="3" maxlength="200" placeholder="Reason or note (optional)"></textarea></label>'
    + '<p class="pmeta" id="aErr" role="alert" style="color:var(--warn);min-height:1.2em"></p>'
    + '<button class="btn primary" type="submit">Save advance</button></form>', labId ? 'aAmt' : 'aQ', true);
}
function dedSheet(labId){
  var l = D.labours[labId]; if(!l) return;
  sheetCtx = { kind:'ded', id:labId };
  openSheet('<form id="fDed" novalidate>'+head('Add deduction')
    + '<p class="pmeta">For '+esc(l.name)+'. This is taken off the month it falls in.</p>'
    + '<label class="f"><span>Date</span><input type="date" id="dDate" value="'+today()+'"></label>'
    + '<label class="f"><span>Amount (₹)</span><input id="dAmt" type="number" inputmode="decimal" min="1" step="any" class="sx-amtIn" placeholder="0"></label>'
    + '<label class="f"><span>Reason</span><textarea id="dNote" rows="3" maxlength="200" placeholder="For example damaged tools"></textarea></label>'
    + '<p class="pmeta" id="dErr" role="alert" style="color:var(--warn);min-height:1.2em"></p>'
    + '<button class="btn primary" type="submit">Save deduction</button></form>', 'dAmt');
}
function paidSheet(labId){
  var r = calcMonth(S.payM)[labId]; if(!r) return;
  sheetCtx = { kind:'paid', id:labId, ym:S.payM };
  openSheet('<form id="fPaid" novalidate>'+head('Mark salary paid')
    + '<p class="pmeta">'+esc(r.l.name)+' · '+fmtMonth(S.payM)+' · balance '+inr(r.pay)+'</p>'
    + '<label class="f"><span>Paid on</span><input type="date" id="pDate" value="'+today()+'"></label>'
    + '<label class="f"><span>Amount paid (₹)</span><input id="pAmt" type="number" inputmode="decimal" min="0" step="any" class="sx-amtIn" value="'+r.pay+'"></label>'
    + '<p class="pmeta">If you pay more than the balance, the extra is carried to next month as an advance and shown there as “advance recovered from previous month”.</p>'
    + '<p class="pmeta" id="pErr" role="alert" style="color:var(--warn);min-height:1.2em"></p>'
    + '<button class="btn primary" type="submit">Save</button></form>', 'pAmt');
}
function bonusSheet(){
  var b = D.settings.bonus || {}, mode = b.mode==='flat' ? 'flat' : 'days';
  sheetCtx = { kind:'bonus', mode:mode };
  openSheet('<form id="fBonus" novalidate>'+head('Bonus for full attendance')
    + '<p class="pmeta">Given to a labour with no absent day and no half day in the whole month. It is added to that month’s salary.</p>'
    + '<div class="aseg" style="grid-template-columns:1fr 1fr"><button type="button" class="btn" data-act="bmode" data-v="days" aria-pressed="'+(mode==='days')+'">Days of wages</button><button type="button" class="btn" data-act="bmode" data-v="flat" aria-pressed="'+(mode==='flat')+'">Fixed amount</button></div>'
    + '<label class="f"><span id="bLbl">'+(mode==='flat'?'Bonus amount (₹)':'Number of days of wages')+'</span><input id="bVal" type="number" inputmode="decimal" min="0" step="any" class="sx-amtIn" value="'+(+b.value>0?esc(b.value):'')+'" placeholder="for example 1"></label>'
    + '<p class="pmeta">Set 0 to stop giving a bonus.</p>'
    + '<p class="pmeta" id="bErr" role="alert" style="color:var(--warn);min-height:1.2em"></p>'
    + '<button class="btn primary" type="submit">Save bonus rule</button></form>', 'bVal');
}
function labSheet(id){
  var l = id ? D.labours[id] : null, ym = thisYm();
  sheetCtx = { kind:'lab', id:id || '' };
  openSheet('<form id="fLab" novalidate>'+head(l ? 'Edit labour' : 'Add labour')
    + '<label class="f"><span>Name</span><input id="lName" type="text" maxlength="60" autocomplete="off" value="'+esc(l?l.name:'')+'"></label>'
    + '<label class="f"><span>Phone (for WhatsApp slip)</span><input id="lPhone" type="tel" inputmode="numeric" maxlength="16" value="'+esc(l?l.phone:'')+'" placeholder="10 digits"></label>'
    + '<label class="f"><span>Daily wage (₹)</span><input id="lWage" type="number" inputmode="decimal" min="0" step="any" class="sx-amtIn" value="'+(l?rateFor(l,ym):'')+'" placeholder="0"></label>'
    + (l ? '<label class="f" id="lFromWrap" hidden><span>New wage applies from</span><input id="lFrom" type="month" value="'+ym+'"></label>' : '')
    + '<p class="pmeta" id="lErr" role="alert" style="color:var(--warn);min-height:1.2em"></p>'
    + '<div class="sx-btns"><button class="btn primary" type="submit">Save</button>'
    + (l ? '<button type="button" class="btn" data-act="archive">'+(l.active===false?'Restore to attendance':'Archive')+'</button>' : '') + '</div></form>', 'lName');
  if(l){ $('#lWage').addEventListener('input', function(){ $('#lFromWrap').hidden = (+this.value||0) === rateFor(l, ym); }); }
}

/* ---------- CSV ---------- */
async function exportCsv(){
  var ym = S.payM, rows = monthRows(ym), dl = NM.dl();
  var q = function(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; };
  var L = [['Sl.No.','Name','Daily wage','Days in month','Salary','Bonus','Advance received','Absent days','Absent deduction','Other deductions','Advance recovered from previous month','Balance to be paid','Paid on','Amount paid','To recover next month'].map(q).join(',')];
  rows.forEach(function(r,i){ L.push([i+1, r.l.name, r.rate, r.nd, r.gross, r.bonus, r.adv, r.ab, r.absDed, r.ded, -r.bf, r.pay, r.paid?r.paid.paidOn:'', r.paid?r.paidAmt:'', r.owe].map(q).join(',')); });
  var name = 'salary-'+NM.nurseryName().split(' ')[0].toLowerCase()+'-'+ym+'.csv', text = '﻿'+L.join('\r\n');
  try{
    if(dl && dl.save) await dl.save({ filename:name, data:text });
    else { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type:'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    NM.toast('Saved '+name);
  }catch(e){ if(!e || e.code!=='declined') NM.toast('Could not save the file.'); }
}

/* ---------- painting ---------- */
var SUBS = ['att','adv','pay','bon','crew'];
function paint(){
  var pane = $('#paneSal'); if(!pane || pane.hidden) return;
  subscribe(); derive();
  var own = isOwner();
  if(!own) S.sub = 'att';
  document.querySelectorAll('#salSubs [data-sub]').forEach(function(b){ b.setAttribute('aria-selected', b.getAttribute('data-sub')===S.sub); });
  $('#salSubs').hidden = !own;
  $('#salQ').value !== S.q && ($('#salQ').value = S.q);
  var body = $('#salBody');
  if(!ready()){ body.innerHTML = skeleton(); return; }
  if(S.err && !Object.keys(D.labours).length){ body.innerHTML = '<div class="card state">Could not load. Check your connection.</div>'; return; }
  var html = S.sub==='adv' ? viewAdv() : S.sub==='pay' ? viewSalary() : S.sub==='bon' ? viewBonus() : S.sub==='crew' ? viewCrew() : viewAtt();
  var ae = document.activeElement, keep = ae && ae.id==='salDate';
  if(!keep) body.innerHTML = html;
}

/* ---------- events ---------- */
function num(v){ var n = parseFloat(v); return isFinite(n) ? n : NaN; }
function err(id, msg){ $(id).textContent = msg; }
document.addEventListener('click', function(e){
  var t = e.target.closest('[data-act],[data-sub]'); if(!t) return;
  if(t.hasAttribute('data-sub') && t.closest('#salSubs')){ S.sub = t.getAttribute('data-sub'); S.open = ''; S.confirm = ''; schedule(); return; }
  var a = t.getAttribute('data-act'), id = t.getAttribute('data-id'); if(!a) return;
  if(!t.closest('#paneSal') && !t.closest('#dlgSal')) return;
  var own = isOwner();
  switch(a){
    case 'close': closeSheet(); break;
    case 'day': { var v = t.getAttribute('data-v'); var d = v==='today' ? today() : addDays(S.date, +v);
      if(!own && (d > today() || d < addDays(today(), -6))) { NM.toast('Supervisors can mark today and the last 6 days only.'); break; }
      S.date = d; schedule(); break; }
    case 'mark': { var s = t.getAttribute('data-s'), cur = statusAt(id, S.date); setStatus(id, S.date, cur===s ? '' : s); break; }
    case 'markrest': { labList(false).forEach(function(l){ if(!statusAt(l.id, S.date)) setStatus(l.id, S.date, 'P'); }); break; }
    case 'mon': { if(!own) break; var k = t.getAttribute('data-key'), nx = shiftMonth(S[k], +t.getAttribute('data-v')); if(nx > thisYm()) nx = thisYm(); S[k] = nx; S.open = ''; S.confirm = ''; schedule(); break; }
    case 'open': S.open = S.open===id ? '' : id; S.confirm = ''; schedule(); break;
    case 'cell': { if(!own) break; var date = t.getAttribute('data-ym')+'-'+pad(+t.getAttribute('data-day')); var c = statusAt(id, date); var order = ['','P','H','A']; setStatus(id, date, order[(order.indexOf(c)+1)%4]); break; }
    case 'sheet-adv': if(own) advSheet(id); break;
    case 'sheet-ded': if(own) dedSheet(id); break;
    case 'sheet-paid': if(own) paidSheet(id); break;
    case 'sheet-bonus': if(own) bonusSheet(); break;
    case 'sheet-lab': if(own) labSheet(id); break;
    case 'bmode': { sheetCtx.mode = t.getAttribute('data-v'); document.querySelectorAll('#salSheet [data-act="bmode"]').forEach(function(b){ b.setAttribute('aria-pressed', b===t); }); $('#bLbl').textContent = sheetCtx.mode==='flat' ? 'Bonus amount (₹)' : 'Number of days of wages'; break; }
    case 'pick': { sheetCtx.sel = id; document.querySelectorAll('#aPick .sx-p').forEach(function(b){ b.classList.toggle('on', b===t); }); var am = $('#aAmt'); if(am) am.focus(); break; }
    case 'adel-ask': case 'ddel-ask': S.confirm = id; schedule(); break;
    case 'cancel-ask': S.confirm = ''; schedule(); break;
    case 'adel-yes': { if(!own) break; var ad = D.adv[id]; S.confirm = ''; if(ad) putFin('adv', id, null, ad.date); break; }
    case 'ddel-yes': { if(!own) break; var dd = D.ded[id]; S.confirm = ''; if(dd) putFin('ded', id, null, dd.date); break; }
    case 'unpay': { if(!own) break; var pk = id+'_'+S.payM, o = {}; o[pk] = null; put('sf/'+S.n+'/'+S.payM.slice(0,4), { pay:o }); break; }
    case 'csv': exportCsv(); break;
    case 'archive': { var l = D.labours[sheetCtx.id]; if(l){ putLabour(l.id, { act:l.active===false ? true : false }); NM.toast(l.active===false ? l.name+' restored' : l.name+' archived'); closeSheet(); } break; }
  }
});
document.addEventListener('input', function(e){
  if(e.target.id==='salQ'){ S.q = e.target.value; schedule(); }
  else if(e.target.id==='aQ'){
    var q = e.target.value.trim().toLowerCase(), n = 0;
    document.querySelectorAll('#aPick .sx-p').forEach(function(b){ var ok = !q || b.getAttribute('data-name').indexOf(q) >= 0; b.hidden = !ok; if(ok) n++; });
  }
});
document.addEventListener('change', function(e){
  if(e.target.id==='salDate'){
    var d = e.target.value; if(!d) return;
    if(!isOwner() && (d > today() || d < addDays(today(), -6))){ NM.toast('Supervisors can mark today and the last 6 days only.'); e.target.value = S.date; return; }
    S.date = d; S.ver++; schedule();
  }
});
document.addEventListener('submit', function(e){
  var f = e.target.id; if(!/^f(Adv|Ded|Paid|Bonus|Lab)$/.test(f)) return;
  e.preventDefault();
  if(!isOwner() || !NM.canWrite()) return;
  if(f==='fAdv'){
    var amt = num($('#aAmt').value), date = $('#aDate').value;
    if(!sheetCtx.sel) return err('#aErr', 'Choose a name from the list.');
    if(!(amt > 0)) return err('#aErr', 'Enter the amount.');
    if(!date) return err('#aErr', 'Choose the date.');
    putFin('adv', uid('v'), { l:sheetCtx.sel, date:date, amt:amt, note:$('#aNote').value.trim(), at:Date.now() }, date);
    NM.toast('Advance saved'); closeSheet();
  } else if(f==='fDed'){
    var da = num($('#dAmt').value), dt = $('#dDate').value;
    if(!(da > 0)) return err('#dErr', 'Enter the amount.');
    if(!dt) return err('#dErr', 'Choose the date.');
    putFin('ded', uid('d'), { l:sheetCtx.id, date:dt, amt:da, note:$('#dNote').value.trim(), at:Date.now() }, dt);
    NM.toast('Deduction saved'); closeSheet();
  } else if(f==='fPaid'){
    var pa = num($('#pAmt').value), pd = $('#pDate').value;
    if(!(pa >= 0)) return err('#pErr', 'Enter the amount paid.');
    if(!pd) return err('#pErr', 'Choose the date.');
    var po = {}; po[sheetCtx.id+'_'+sheetCtx.ym] = { l:sheetCtx.id, ym:sheetCtx.ym, paidOn:pd, amount:pa };
    put('sf/'+S.n+'/'+sheetCtx.ym.slice(0,4), { pay:po }); bumpY0(sheetCtx.ym+'-01');
    NM.toast('Salary marked paid'); closeSheet();
  } else if(f==='fBonus'){
    var bv = num($('#bVal').value || '0');
    if(!(bv >= 0)) return err('#bErr', 'Enter a number, or 0 for no bonus.');
    put('sf/'+S.n+'/meta', { bonus:{ mode:sheetCtx.mode, value:bv } });
    NM.toast('Bonus rule saved'); closeSheet();
  } else if(f==='fLab'){
    var name = $('#lName').value.trim().replace(/\s+/g,' '), wage = num($('#lWage').value), phone = $('#lPhone').value.trim();
    if(!name) return err('#lErr', 'Enter the name.');
    if(!(wage >= 0)) return err('#lErr', 'Enter the daily wage.');
    var dup = labList(true).some(function(l){ return l.id!==sheetCtx.id && l.name.trim().toLowerCase()===name.toLowerCase(); });
    if(dup) return err('#lErr', name+' is already in the list.');
    var ym = thisYm();
    if(!sheetCtx.id){
      var id = uid('l');
      putLabour(id, { n:name, ph:phone, act:true, c:Date.now() });
      putRates(id, [{ from:ym, wage:wage }]);
    } else {
      var l = D.labours[sheetCtx.id];
      putLabour(l.id, { n:name, ph:phone });
      if(wage !== rateFor(l, ym) || ($('#lFrom') && !$('#lFromWrap').hidden)){
        var from = ($('#lFrom') && $('#lFrom').value) || ym;
        var rs = (l.rates||[]).filter(function(x){ return x.from !== from; }).concat([{ from:from, wage:wage }]).sort(function(a,b){ return a.from<b.from?-1:1; });
        putRates(l.id, rs);
      }
    }
    NM.toast('Saved'); closeSheet();
  }
});
$('#dlgSal').addEventListener('close', function(){ sheetCtx = null; });

window.Sal = { render: function(){ schedule(); } };
schedule();
})();
