const CACHE="wayv-mvp-v7";
const FILES=["./","./index.html","./styles.css","./app.js","./config.js","./backend.js","./manifest.webmanifest","./icon.svg","./wayv-wordmark.svg","./icon-192.png","./icon-512.png"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});
