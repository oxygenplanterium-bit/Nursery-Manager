/* Network first, falls back to the cached app shell when offline. */
var C='nursery-shell-v1';
self.addEventListener('install',function(e){ self.skipWaiting(); });
self.addEventListener('activate',function(e){ e.waitUntil(caches.keys().then(function(k){ return Promise.all(k.filter(function(n){ return n!==C; }).map(function(n){ return caches.delete(n); })); }).then(function(){ return self.clients.claim(); })); });
self.addEventListener('fetch',function(e){
  var r=e.request; if(r.method!=='GET'||new URL(r.url).origin!==location.origin) return;
  e.respondWith(fetch(r).then(function(res){ var c=res.clone(); caches.open(C).then(function(ch){ ch.put(r,c); }); return res; }).catch(function(){ return caches.match(r).then(function(m){ return m||caches.match('./'); }); }));
});

self.addEventListener('push',function(e){
  var d={}; try{ d=e.data?e.data.json():{}; }catch(x){ d={title:'New message',body:e.data?e.data.text():''}; }
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    if(cs.some(function(c){ return c.visibilityState==='visible'; })) return;
    return self.registration.showNotification(d.title||'Nursery Manager',{body:d.body||'',tag:d.tag||'chat',icon:'icon-192.png',badge:'icon-192.png',vibrate:[200,100,200],data:{url:d.url||'./'}});
  }));
});
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    for(var i=0;i<cs.length;i++){ if('focus' in cs[i]) return cs[i].focus(); }
    return self.clients.openWindow((e.notification.data&&e.notification.data.url)||'./');
  }));
});
