/* Platform layer: replaces the Claude artifact runtime (window.claude) with
   Firebase (Auth + Firestore) and native file saving, so the same app code runs as an Android app. */
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF, applyPlugin } from './jspdf-autotable-shim.js';
import * as XLSX from 'xlsx';
import { SUPABASE_URL, SUPABASE_KEY, OWNER_EMAIL } from './config.js';

window.jspdf = { jsPDF };
window.XLSX = XLSX;

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
        let dead = false;
        const run = async () => {
          try { const d = await fetchDoc(path); if (!dead) ok(snapOf(d)); }
          catch (e) { if (!dead && err) err(e); }
        };
        run();
        const timer = setInterval(run, 20000);
        const ch = sb.channel('doc-' + path + '-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'path=eq.' + path }, p => {
            if (dead) return;
            if (p.eventType === 'DELETE') ok(snapOf(null)); else if (p.new && p.new.data) ok(snapOf(p.new.data)); else run();
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

/* ---------- sign-in ---------- */
let current = null;
const ready = new Promise(resolve => {
  const style = document.createElement('style');
  style.textContent = '#loginBox{position:fixed;inset:0;z-index:99999;background:#f4f8f4;display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif}#loginBox form{background:#fff;border:1px solid #cfe0cf;border-radius:14px;padding:20px;width:100%;max-width:360px;display:grid;gap:12px}#loginBox h1{font-size:1.2rem;margin:0;color:#1f6b34}#loginBox input{font:inherit;padding:12px;border:1px solid #9bb59b;border-radius:10px}#loginBox button{font:inherit;padding:12px;border-radius:10px;border:1px solid #2a7f3e;background:#2a7f3e;color:#fff;font-weight:600}#loginMsg{color:#b3261e;font-size:.9rem;min-height:1.2em;margin:0}#loginBox small{color:#5a6b5a}';
  document.head.appendChild(style);
  const box = document.createElement('div'); box.id = 'loginBox';
  box.innerHTML = '<form id="loginForm"><h1>Nursery Daily Manager</h1><input id="loginEmail" type="email" autocomplete="username" placeholder="Email" required><input id="loginPass" type="password" autocomplete="current-password" placeholder="Password" required><p id="loginMsg" role="alert"></p><button type="submit">Sign in</button><small>Forgot your password? Ask the owner to reset it.</small></form>';
  const attach = () => document.body.appendChild(box);
  if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
  const msg = t => { box.querySelector('#loginMsg').textContent = t; };
  box.querySelector('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); msg('');
    const r = await sb.auth.signInWithPassword({ email: box.querySelector('#loginEmail').value.trim(), password: box.querySelector('#loginPass').value });
    if (r.error) msg(/fetch|network/i.test(r.error.message) ? 'No internet connection.' : 'Wrong email or password.');
  });
  let first = true;
  const onSession = sess => {
    current = sess ? sess.user : null;
    if (current) { box.style.display = 'none'; if (first) { first = false; resolve(current); } addSignOut(); }
    else box.style.display = 'flex';
  };
  sb.auth.onAuthStateChange((ev, sess) => onSession(sess));
  sb.auth.getSession().then(r => onSession(r.data && r.data.session));
});
function addSignOut() {
  const acts = document.querySelector('.acts'); if (!acts || document.getElementById('signOutBtn')) return;
  const b = document.createElement('button'); b.className = 'btn'; b.id = 'signOutBtn'; b.textContent = 'Sign out';
  b.addEventListener('click', async () => { try { await sb.auth.signOut(); } catch (e) {} location.reload(); });
  acts.appendChild(b);
}

const user = {
  canEdit: async () => !!current && (current.email || '').toLowerCase() === OWNER_EMAIL,
  can: async () => !!current,
  id: async () => current ? current.id : null,
  me: async () => current ? { name: (current.user_metadata && current.user_metadata.name) || (current.email || '').split('@')[0] } : null
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

window.claude = {
  use: async n => {
    if (n === 'db') { await ready; return db; }
    if (n === 'user') { await ready; return user; }
    if (n === 'downloads') return downloads;
    return null;
  }
};
