// Each installed copy has its own offline cache: do not delete a sibling app on the same domain.
const CACHE_SCOPE = encodeURIComponent(new URL('./', self.location.href).pathname);
const CACHE_PREFIX = `ozan-bookings-${CACHE_SCOPE}-`;
const CACHE = `${CACHE_PREFIX}v2.16.43-fix67-8-package-pricing-persistence-single-css-js`;
const ASSETS = [
  "./",
  "./index.html",
  "./assets/css/myfnt-all.css",
  "./assets/js/myfnt-bundle.js",
  "./privacy.html",
  "./terms.html",
  "./licenses.html",
  "./assets/images/appstore-phone-1.webp",
  "./assets/images/appstore-phone-2.webp",
  "./assets/images/appstore-phone-3.webp",
  "./assets/config/subscription-plans.json",
  "./assets/config/feature-catalog.json",
  "./manifest.json",
  "./assets/images/icon.svg",
  "./assets/images/icon-192.png",
  "./assets/images/icon-512.png",
  "./assets/images/icon-maskable-512.png",
  "./assets/images/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // ملفات التشغيل أساسية: فشل أحدها يمنع تثبيت عامل خدمة ناقص.
    // Limit simultaneous requests: downloading the whole application in one burst
    // can starve the visible calendar and controls on slower mobile connections.
    const required=ASSETS.filter(asset=>/\.(?:js|css)(?:\?|$)/.test(asset)||asset==="./index.html");
    const optional=ASSETS.filter(asset=>!/\.(?:js|css)(?:\?|$)/.test(asset)&&asset!=="./index.html");
    async function precacheInBatches(items, requiredResource, parallel=6){
      for(let offset=0;offset<items.length;offset+=parallel){
        await Promise.all(items.slice(offset,offset+parallel).map(async asset=>{
          try{
            const response=await fetch(asset,{cache:"reload"});
            if(!response.ok) throw Error("PWA resource: "+asset+" "+response.status);
            if(asset.includes("manifest")&&!(await response.clone().text()).trimStart().startsWith("{"))throw Error("Manifest invalid");
            await cache.put(asset,response.clone());
          }catch(error){
            if(requiredResource)throw error;
            console.warn("[SW:precache]",asset,error);
          }
        }));
      }
    }
    await precacheInBatches(required,true);
    await precacheInBatches(optional,false);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  if(/manifest\.(?:json|webmanifest)$/.test(url.pathname)) { event.respondWith(fetch(event.request,{cache:"no-store"}).catch(()=>caches.match(event.request).then(r=>r||caches.match("./manifest.json")))); return; }

  const isInstallScreenshot=/\/assets\/images\/screenshot-(?:mobile|desktop)\.png$/i.test(url.pathname);
  if(isInstallScreenshot){ event.respondWith(fetch(event.request,{cache:"no-store"})); return; }

  const isNavigate=event.request.mode === "navigate";
  const isVersionedStatic=/\.(?:js|css)$/.test(url.pathname) && url.searchParams.has('v');
  const isStatic=/\.(?:js|css|png|jpg|jpeg|webp|svg|ico|woff2?|ttf|json)$/.test(url.pathname);

  if(isNavigate){
    // FIX61: the application shell must never wait for an unreachable network on offline launch.
    // A completed SW installation pins a complete shell; new releases are installed atomically
    // by the SW lifecycle, rather than caching fresh HTML alongside older JS/CSS.
    const shellPath=new URL('./index.html',self.location.href).pathname;
    const rootPath=new URL('./',self.location.href).pathname;
    if(url.pathname===rootPath||url.pathname===shellPath){
      event.respondWith((async()=>{
        const cache=await caches.open(CACHE);
        const stored=(await cache.match('./index.html'))||(await cache.match('./'));
        if(stored)return stored;
        try{return await fetch(event.request,{cache:'no-store'});}catch{return Response.error();}
      })());
      return;
    }
    // Legal/secondary pages keep network-first behavior and retain their own offline cache.
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(response=>{
      if(response?.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));}
      return response;
    }).catch(async()=>{const exact=await caches.match(event.request);return exact||Response.error();}));
    return;
  }

  if(isVersionedStatic){
    // Versioned assets are immutable for this release. Cache-first removes repeated
    // network/parse stalls on mobile while a new ?v= value naturally busts the cache.
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request,{cache:"reload"}).then(response=>{
      if(response?.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
      return response;
    })));
    return;
  }

  if(isStatic){
    // Stale-while-revalidate for non-versioned static resources: instant local response,
    // silent refresh in the background, with no HTML fallback for missing assets.
    event.respondWith(caches.match(event.request).then(cached=>{
      const refresh=fetch(event.request).then(response=>{
        if(response?.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
        return response;
      }).catch(()=>null);
      if(cached){event.waitUntil(refresh);return cached;}
      return refresh.then(response=>response||Response.error());
    }));
    return;
  }

  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(r=>r||Response.error())));
});

/* Fix62: Push display is dormant until a server delivers subscribed push events.
   Do not include customer PII, tokens, amounts or raw message bodies in push payloads. */
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let payload={};try{payload=event.data?.json()||{}}catch{}
    if(payload.type!=='myfnt-update')return;
    const tag=String(payload.event_id||'myfnt-update').slice(0,80);
    await self.registration.showNotification('مايفنت — يوجد تحديث جديد',{
      body:'افتح التطبيق للاطلاع على التحديثات.',
      icon:'./assets/images/icon-192.png',badge:'./assets/images/icon-192.png',
      tag,renotify:false,data:{target:'./'}
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const root=new URL('./',self.registration.scope).href;
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=tabs.find(c=>c.url.startsWith(root));
    if(existing){await existing.focus();return;}
    await self.clients.openWindow(root);
  })());
});
