/* Platform layer: replaces the Claude artifact runtime (window.claude) with
   Firebase (Auth + Firestore) and native file saving, so the same app code runs as an Android app. */
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SUPABASE_URL, SUPABASE_KEY, OWNER_EMAIL } from './config.js';


const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage } });

/* ---------- helpers ---------- */
function mapErr(e) {
  const msg = String((e && e.message) || e || 'error'), x = new Error(msg);
  if (/not_found/.test(msg)) x.code = 'not_found';
  else if (e && (e.code === '42501' || /row-level security|permission denied/i.test(msg))) x.code = 'revoked';
  else if (/fetch|network|timeout|failed/i.test(msg)) x.code = 'unavailable';
  else x.code = (e && e.code) || 'error';
  return x;
}
function snapOf(row) { return { exists: !!row, data: () => row ? JSON.parse(JSON.stringify(row)) : undefined }; }
async function fetchDoc(path) {
  const r = await sb.from('docs').select('data').eq('path', path).maybeSingle();
  if (r.error) throw mapErr(r.error);
  return r.data ? r.data.data : null;
}
const listeners = {};   /* path -> Set of {ok, err} */
async function refresh(path) {
  const ls = listeners[path]; if (!ls || !ls.size) return;
  try { const d = await fetchDoc(path); ls.forEach(l => l.ok(snapOf(d))); }
  catch (e) { ls.forEach(l => l.err && l.err(e)); }
}

const db = {
  /* list documents whose path starts with prefix; with a field, only that part of each document is fetched */
  async list(prefix, field) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const sel = field ? 'path, v:data->' + field : 'path, data';
      const r = await sb.from('docs').select(sel).like('path', prefix + '%').order('path').range(from, from + 999);
      if (r.error) throw mapErr(r.error);
      (r.data || []).forEach(x => out.push({ path: x.path, data: field ? { [field]: x.v } : x.data }));
      if (!r.data || r.data.length < 1000) break;
    }
    return out;
  },
  /* call cb(list) now and whenever a document under the prefix changes; returns a stop function */
  watch(prefix, cb) {
    let dead = false;
    let lastW = null;
    const run = async () => { try { const l = await db.list(prefix); if (dead) return; const j = JSON.stringify(l); if (j === lastW) return; lastW = j; cb(l); } catch (e) {} };
    run();
    const timer = setInterval(run, 6000);
    const ch = sb.channel('watch-' + prefix + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
        const path = (p.new && p.new.path) || (p.old && p.old.path) || '';
        if (path.indexOf(prefix) === 0) run();
      })
      .subscribe();
    return () => { dead = true; clearInterval(timer); sb.removeChannel(ch); };
  },
  doc(path) {
    return {
      get: async () => snapOf(await fetchDoc(path)),
      set: async d => {
        const r = await sb.from('docs').upsert({ path, data: d, updated_at: new Date().toISOString() });
        if (r.error) throw mapErr(r.error);
        refresh(path);
      },
      update: async d => {
        const r = await sb.rpc('patch_doc', { p_path: path, p_patch: d });
        if (r.error) throw mapErr(r.error);
        refresh(path);
      },
      delete: async () => {
        const r = await sb.from('docs').delete().eq('path', path);
        if (r.error) throw mapErr(r.error);
        refresh(path);
      },
      onSnapshot: (ok, err) => {
        const l = { ok, err };
        (listeners[path] = listeners[path] || new Set()).add(l);
        let dead = false, last = null;
        /* skip identical data so the screen is not redrawn (and scrolling not interrupted) by every poll */
        const push = d => { const j = JSON.stringify(d === undefined ? null : d); if (j === last) return; last = j; ok(snapOf(d)); };
        l.ok = d => push(d && typeof d.data === 'function' ? d.data() : d);
        const run = async () => {
          try { const d = await fetchDoc(path); if (!dead) push(d); }
          catch (e) { if (!dead && err) err(e); }
        };
        run();
        const timer = setInterval(run, 20000);
        const ch = sb.channel('doc-' + path + '-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'path=eq.' + path }, p => {
            if (dead) return;
            if (p.eventType === 'DELETE') push(null); else if (p.new && p.new.data) push(p.new.data); else run();
          })
          .subscribe(st => { if (st === 'SUBSCRIBED') run(); });
        return () => { dead = true; clearInterval(timer); listeners[path].delete(l); sb.removeChannel(ch); };
      },
      acquire: async o => {
        const r = await sb.rpc('acquire_lock', { p_path: path, p_holder: (o && o.holder) || 'viewer', p_ttl: (o && o.ttlMs) || 20000 });
        return { acquired: !r.error && r.data === true };
      }
    };
  }
};

/* ---------- sign-in and sign-up ---------- */
/* A phone number is turned into a private e-mail style login name, so people only type their phone number and a password.
   The address is never mailed: e-mail confirmation must be switched off in Supabase (Authentication, Providers, Email). */
const OWNER_BASE = OWNER_EMAIL.split('@');
function phoneDigits(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d;
}
function loginName(v) {
  v = String(v || '').trim();
  return v.indexOf('@') >= 0 ? v.toLowerCase() : OWNER_BASE[0] + '+' + phoneDigits(v) + '@' + OWNER_BASE[1];
}
let current = null;
const ready = new Promise(resolve => {
  const style = document.createElement('style');
  style.textContent = '#loginBox,#waitBox{position:fixed;inset:0;z-index:99999;background:#f4f8f4;display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif;overflow:auto}#loginBox form,#waitBox .wc{background:#fff;border:1px solid #cfe0cf;border-radius:14px;padding:20px;width:100%;max-width:360px;display:grid;gap:12px}#loginBox h1,#waitBox h1{font-size:1.2rem;margin:0;color:#1f6b34}#loginBox input{font:inherit;font-size:16px;padding:12px;border:1px solid #9bb59b;border-radius:10px}#loginBox button,#waitBox button{font:inherit;padding:12px;border-radius:10px;border:1px solid #2a7f3e;background:#2a7f3e;color:#fff;font-weight:600}#loginBox button.alt,#waitBox button.alt{background:#fff;color:#1f6b34}#loginMsg{color:#b3261e;font-size:.9rem;min-height:1.2em;margin:0}#loginBox small,#waitBox p{color:#5a6b5a;margin:0}@media (prefers-color-scheme:dark){#loginBox,#waitBox{background:#0F1713}#loginBox form,#waitBox .wc{background:#1A2620;border-color:#2C3D33}#loginBox h1,#waitBox h1{color:#6DBE6F}#loginBox input{background:#111A15;color:#E9F1EB;border-color:#2C3D33}#loginBox button,#waitBox button{background:#6DBE6F;border-color:#6DBE6F;color:#0B1A10}#loginBox button.alt,#waitBox button.alt{background:transparent;color:#6DBE6F}#loginBox small,#waitBox p{color:#9DB1A4}#loginMsg{color:#FF9381}}';
  document.head.appendChild(style);
  const box = document.createElement('div'); box.id = 'loginBox';
  box.innerHTML = '<form id="loginForm" novalidate><h1>Nursery Manager</h1>' +
    '<input id="loginName" type="text" autocomplete="name" placeholder="Your name" hidden>' +
    '<input id="loginEmail" type="text" inputmode="text" autocomplete="username" placeholder="Phone number or owner email" autocapitalize="none">' +
    '<input id="loginPass" type="password" autocomplete="current-password" placeholder="Password">' +
    '<input id="loginPass2" type="password" autocomplete="new-password" placeholder="Type the password again" hidden>' +
    '<p id="loginMsg" role="alert"></p><button type="submit" id="loginGo">Sign in</button>' +
    '<button type="button" class="alt" id="loginSwap">Create new account</button>' +
    '<small id="loginNote">New here? Create an account with your phone number. The owner approves it before you can use the app.</small></form>';
  const wait = document.createElement('div'); wait.id = 'waitBox';
  wait.innerHTML = '<div class="wc"><h1 id="waitTitle">Waiting for approval</h1><p id="waitText"></p><button type="button" id="waitCheck">Check Again</button><button type="button" class="alt" id="waitOut">Sign Out</button></div>';
  const attach = () => { document.body.appendChild(box); document.body.appendChild(wait); };
  if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
  const q = id => box.querySelector(id);
  const msg = t => { q('#loginMsg').textContent = t; };
  let mode = 'in';
  const setMode = m => {
    mode = m; msg('');
    q('#loginName').hidden = q('#loginPass2').hidden = m !== 'up';
    q('#loginGo').textContent = m === 'up' ? 'Create account' : 'Sign in';
    q('#loginSwap').textContent = m === 'up' ? 'I already have an account' : 'Create new account';
    q('#loginEmail').placeholder = m === 'up' ? 'Phone number' : 'Phone number or owner email';
    q('#loginPass').autocomplete = m === 'up' ? 'new-password' : 'current-password';
    q('#loginNote').hidden = m === 'up';
  };
  q('#loginSwap').addEventListener('click', () => setMode(mode === 'up' ? 'in' : 'up'));
  const bad = e => /fetch|network/i.test(e.message) ? 'No internet connection.' : null;
  q('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); msg('');
    const who = q('#loginEmail').value.trim(), pass = q('#loginPass').value;
    if (!who) { msg('Enter your phone number.'); return; }
    if (who.indexOf('@') < 0 && phoneDigits(who).length < 10) { msg('Enter a valid 10 digit phone number.'); return; }
    if (!pass) { msg('Enter your password.'); return; }
    if (mode === 'up') {
      const nm = q('#loginName').value.trim().replace(/\s+/g, ' ');
      if (who.indexOf('@') >= 0) { msg('Use your phone number to create an account.'); return; }
      if (!nm) { msg('Enter your name.'); return; }
      if (pass.length < 6) { msg('The password needs at least 6 characters.'); return; }
      if (pass !== q('#loginPass2').value) { msg('The two passwords do not match.'); return; }
      const r = await sb.auth.signUp({ email: loginName(who), password: pass, options: { data: { name: nm, phone: phoneDigits(who) } } });
      if (r.error) { msg(bad(r.error) || (/registered|exists/i.test(r.error.message) ? 'This phone number already has an account. Tap "I already have an account".' : 'Could not create the account. ' + r.error.message)); return; }
      if (!r.data.session) { msg('Account created, but sign in is not switched on yet. Please tell the owner.'); }
      return;
    }
    const r = await sb.auth.signInWithPassword({ email: loginName(who), password: pass });
    if (r.error) msg(bad(r.error) || (/not confirmed/i.test(r.error.message) ? 'This login is not confirmed yet. Please tell the owner.' : 'Wrong phone number or password.'));
  });
  /* A person who is not the owner can use the app only after the owner approves the record users/<id>. */
  const isOwnerUser = u => (u.email || '').toLowerCase() === OWNER_EMAIL;
  let approved = false, first = true, gateTimer = null, gateFor = '';
  const open = u => { approved = true; clearInterval(gateTimer); wait.style.display = 'none'; box.style.display = 'none'; if (first) { first = false; resolve(u); } addSignOut(); };
  const showWait = (title, text) => { wait.querySelector('#waitTitle').textContent = title; wait.querySelector('#waitText').textContent = text; wait.style.display = 'flex'; box.style.display = 'none'; };
  const check = async u => {
    if (!current || current.id !== u.id) return;
    const path = 'users/' + u.id;
    const r = await sb.from('docs').select('data').eq('path', path).maybeSingle();
    if (r.error) { showWait('Could not check your account', 'Check your internet connection. This page tries again by itself.'); return; }
    let d = r.data && r.data.data;
    if (!d) {
      const md = u.user_metadata || {};
      d = { n: md.name || (u.email || '').split('@')[0], ph: md.phone || '', st: 'pending', at: Date.now() };
      const w = await sb.from('docs').upsert({ path, data: d, updated_at: new Date().toISOString() });
      if (w.error) { showWait('Could not create your account record', 'Please tell the owner. This page tries again by itself.'); return; }
    }
    if (d.st === 'ok') { open(u); return; }
    if (d.st === 'no') showWait('Not approved', 'The owner has not approved this account. Please contact the owner.');
    else showWait('Waiting for approval', 'Your account (' + (u.email || '').replace(/^.*\+/, '') + ') has been created. The owner needs to approve it before you can use the app. This page opens by itself once you are approved. Last checked at ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.');
  };
  wait.querySelector('#waitCheck').addEventListener('click', async () => { const bt = wait.querySelector('#waitCheck'); bt.textContent = 'Checking...'; bt.disabled = true; try { await sb.auth.refreshSession(); } catch (e) {} if (current) await check(current); setTimeout(() => { bt.textContent = 'Check Again'; bt.disabled = false; }, 800); });
  wait.querySelector('#waitOut').addEventListener('click', async () => { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {} location.reload(); });
  const onSession = sess => {
    current = sess ? sess.user : null;
    if (!current) { approved = false; gateFor = ''; clearInterval(gateTimer); wait.style.display = 'none'; box.style.display = 'flex'; return; }
    if (approved && gateFor === current.id) return;
    if (isOwnerUser(current)) { gateFor = current.id; open(current); return; }
    gateFor = current.id; box.style.display = 'none';
    clearInterval(gateTimer); const u = current; check(u); gateTimer = setInterval(() => check(u), 5000);
  };
  sb.auth.onAuthStateChange((ev, sess) => onSession(sess));
  sb.auth.getSession().then(r => onSession(r.data && r.data.session));
});
function addSignOut() {
  const acts = document.querySelector('.acts'); if (!acts || document.getElementById('signOutBtn')) return;
  const b = document.createElement('button'); b.className = 'btn'; b.id = 'signOutBtn'; b.textContent = 'Sign out';
  b.addEventListener('click', async () => { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {} location.reload(); });
  acts.appendChild(b);
}

const user = {
  canEdit: async () => !!current && (current.email || '').toLowerCase() === OWNER_EMAIL,
  can: async () => !!current,
  id: async () => current ? current.id : null,
  me: async () => current ? { name: (current.user_metadata && current.user_metadata.name) || (current.email || '').split('@')[0], phone: (current.user_metadata && current.user_metadata.phone) || '' } : null
};

/* ---------- saving files ---------- */
function toBase64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const downloads = {
  async save(o) {
    const name = o.filename || 'file', isStr = typeof o.data === 'string';
    if (Capacitor.isNativePlatform()) {
      try {
        const w = await Filesystem.writeFile(isStr
          ? { path: name, data: o.data, directory: Directory.Cache, encoding: Encoding.UTF8 }
          : { path: name, data: toBase64(o.data), directory: Directory.Cache });
        await Share.share({ title: name, url: w.uri, dialogTitle: 'Save or share ' + name });
      } catch (e) {
        if (e && /cancel/i.test(String(e.message || e))) { const x = new Error('declined'); x.code = 'declined'; throw x; }
        throw e;
      }
      return { status: 'saved' };
    }
    const type0 = /\.pdf$/i.test(name) ? 'application/pdf' : 'application/json';
    try {
      const file = new File([o.data], name, { type: type0 });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return { status: 'saved' }; }
    } catch (e) { if (e && e.name === 'AbortError') { const x = new Error('declined'); x.code = 'declined'; throw x; } }
    const blob = new Blob([o.data], { type: /\.pdf$/i.test(name) ? 'application/pdf' : 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return { status: 'saved' };
  }
};

const notify = {
  native: Capacitor.isNativePlatform(),
  async enable() { const r = await LocalNotifications.requestPermissions(); return r.display === 'granted'; },
  async show(title, body) { await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2000000000), title, body }] }); }
};

window.claude = {
  use: async n => {
    if (n === 'db') { await ready; return db; }
    if (n === 'user') { await ready; return user; }
    if (n === 'downloads') return downloads;
    if (n === 'notify') return notify;
    return null;
  }
};
