/* Platform layer: replaces the Claude artifact runtime (window.claude) with
   Firebase (Auth + Firestore) and native file saving, so the same app code runs as an Android app. */
import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, memoryLocalCache,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, deleteField, FieldPath, runTransaction } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF, applyPlugin } from './jspdf-autotable-shim.js';
import * as XLSX from 'xlsx';

const firebaseConfig = {
  apiKey: "AIzaSyCDFOBdw9jHRC4STvp4iA4_zebkS38TOAU",
  authDomain: "nursery-manager-aeff9.firebaseapp.com",
  projectId: "nursery-manager-aeff9",
  storageBucket: "nursery-manager-aeff9.firebasestorage.app",
  messagingSenderId: "719393874592",
  appId: "1:719393874592:web:9fe465bcad3ade02511fc5"
};
/* The only account treated as the owner. Must match the email in firestore.rules. */
const OWNER_EMAIL = 'oxygenplanterium@gmail.com';

window.jspdf = { jsPDF };
window.XLSX = XLSX;

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
let fs;
try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) }); }
catch (e) { fs = initializeFirestore(app, { localCache: memoryLocalCache() }); }

/* ---------- helpers ---------- */
const CODE = { 'not-found': 'not_found', 'resource-exhausted': 'quota_exceeded', 'permission-denied': 'revoked', 'invalid-argument': 'invalid_argument' };
function mapErr(e) { const c = (e && e.code || '').replace(/^firestore\//, ''); const x = new Error(e && e.message || 'error'); x.code = CODE[c] || c || 'error'; return x; }
/* Offline writes only resolve once the server confirms; the local snapshot already shows them, so don't block the UI. */
function soft(p) {
  return new Promise((res, rej) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(); } }, 4000);
    p.then(() => { if (!done) { done = true; clearTimeout(t); res(); } },
      e => { if (!done) { done = true; clearTimeout(t); rej(mapErr(e)); } });
  });
}
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
/* Turn a nested patch into [FieldPath, value, ...] so nested maps merge and null deletes a key. */
function flatten(obj, prefix, out) {
  Object.keys(obj).forEach(k => {
    const v = obj[k], p = prefix.concat(k);
    if (isObj(v)) { if (Object.keys(v).length) flatten(v, p, out); else out.push(new FieldPath(...p), {}); }
    else out.push(new FieldPath(...p), v === null || v === undefined ? deleteField() : v);
  });
  return out;
}
function snapOf(s) { return { exists: s.exists(), data: () => s.data() }; }

const db = {
  doc(path) {
    const ref = doc(fs, path);
    return {
      get: () => getDoc(ref).then(snapOf, e => { throw mapErr(e); }),
      set: d => soft(setDoc(ref, d)),
      update: d => { const a = flatten(d, [], []); if (!a.length) return Promise.resolve(); return soft(updateDoc(ref, ...a)); },
      delete: () => soft(deleteDoc(ref)),
      onSnapshot: (ok, err) => onSnapshot(ref, s => ok(snapOf(s)), e => { if (err) err(mapErr(e)); }),
      acquire: async o => {
        const me = (o && o.holder) || 'viewer', ttl = (o && o.ttlMs) || 20000;
        try {
          return await runTransaction(fs, async tx => {
            const s = await tx.get(ref), now = Date.now(), d = s.exists() ? s.data() : {};
            if (d.until && d.until > now && d.holder !== me) return { acquired: false };
            tx.set(ref, { holder: me, until: now + ttl });
            return { acquired: true };
          });
        } catch (e) { return { acquired: false }; }
      }
    };
  }
};

/* ---------- sign-in ---------- */
let current = null;
const ready = new Promise(resolve => {
  const style = document.createElement('style');
  style.textContent = '#loginBox{position:fixed;inset:0;z-index:99999;background:#f4f8f4;display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif}#loginBox form{background:#fff;border:1px solid #cfe0cf;border-radius:14px;padding:20px;width:100%;max-width:360px;display:grid;gap:12px}#loginBox h1{font-size:1.2rem;margin:0;color:#1f6b34}#loginBox input{font:inherit;padding:12px;border:1px solid #9bb59b;border-radius:10px}#loginBox button{font:inherit;padding:12px;border-radius:10px;border:1px solid #2a7f3e;background:#2a7f3e;color:#fff;font-weight:600}#loginBox button.l{background:none;color:#1f6b34;border:0;text-decoration:underline;font-weight:400;padding:4px}#loginMsg{color:#b3261e;font-size:.9rem;min-height:1.2em;margin:0}';
  document.head.appendChild(style);
  const box = document.createElement('div'); box.id = 'loginBox';
  box.innerHTML = '<form id="loginForm"><h1>Nursery Daily Manager</h1><input id="loginEmail" type="email" autocomplete="username" placeholder="Email" required><input id="loginPass" type="password" autocomplete="current-password" placeholder="Password" required><p id="loginMsg" role="alert"></p><button type="submit">Sign in</button><button type="button" class="l" id="loginReset">Forgot password?</button></form>';
  const attach = () => document.body.appendChild(box);
  if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
  const msg = t => { box.querySelector('#loginMsg').textContent = t; };
  box.querySelector('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); msg('');
    try { await signInWithEmailAndPassword(auth, box.querySelector('#loginEmail').value.trim(), box.querySelector('#loginPass').value); }
    catch (err) { msg(err.code === 'auth/network-request-failed' ? 'No internet connection.' : 'Wrong email or password.'); }
  });
  box.querySelector('#loginReset').addEventListener('click', async () => {
    const em = box.querySelector('#loginEmail').value.trim();
    if (!em) { msg('Type your email first.'); return; }
    try { await sendPasswordResetEmail(auth, em); msg('Password reset email sent.'); box.querySelector('#loginMsg').style.color = '#1f6b34'; }
    catch (err) { msg('Could not send the reset email.'); }
  });
  let first = true;
  onAuthStateChanged(auth, u => {
    current = u;
    if (u) { box.style.display = 'none'; if (first) { first = false; resolve(u); } addSignOut(); }
    else { box.style.display = 'flex'; }
  });
});
function addSignOut() {
  const acts = document.querySelector('.acts'); if (!acts || document.getElementById('signOutBtn')) return;
  const b = document.createElement('button'); b.className = 'btn'; b.id = 'signOutBtn'; b.textContent = 'Sign out';
  b.addEventListener('click', async () => { try { await signOut(auth); } catch (e) {} location.reload(); });
  acts.appendChild(b);
}

const user = {
  canEdit: async () => !!current && (current.email || '').toLowerCase() === OWNER_EMAIL,
  can: async () => !!current,
  id: async () => current ? current.uid : null,
  me: async () => current ? { name: current.displayName || (current.email || '').split('@')[0] } : null
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
