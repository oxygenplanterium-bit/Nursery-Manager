/* Network first, falls back to the cached app shell when offline. */
var C='nursery-shell-v1';
self.addEventListener('install',function(e){ self.skipWaiting(); });
self.addEventListener('activate',function(e){ e.waitUntil(caches.keys().then(function(k){ return Promise.all(k.filter(function(n){ return n!==C; }).map(function(n){ return caches.delete(n); })); }).then(function(){ return self.clients.claim(); })); });
self.addEventListener('fetch',function(e){
  var r=e.request; if(r.method!=='GET'||new URL(r.url).origin!==location.origin) return;
  e.respondWith(fetch(r).then(function(res){ var c=res.clone(); caches.open(C).then(function(ch){ ch.put(r,c); }); return res; }).catch(function(){ return caches.match(r).then(function(m){ return m||caches.match('./'); }); }));
});
