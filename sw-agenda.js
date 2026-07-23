const AGENDA_OFFLINE_CACHE = 'agenda-offline-v11';

// Firebase Messaging usa o mesmo service worker já existente, evitando dois
// controladores concorrentes para o PWA.
try {
  importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyBwSb7AzenKzGXcOSNzFFNIehqGrPLCRtw',
    authDomain: 'super-agenda-fa.firebaseapp.com',
    projectId: 'super-agenda-fa',
    storageBucket: 'super-agenda-fa.firebasestorage.app',
    messagingSenderId: '860394426284',
    appId: '1:860394426284:web:bfbae23ed378ceffc93409'
  });
  firebase.messaging();
} catch (_) {
  // O modo offline continua funcionando mesmo se o CDN estiver indisponível.
}

const SHELL_FILES = [
  './',
  './index.html',
  './agenda.html',
  './auth.js',
  './status-formatters.js',
  './site.webmanifest',
  './img/favicon.ico',
  './img/favicon-16.png',
  './img/favicon-32.png',
  './img/favicon-48.png',
  './img/favicon-96x96.png',
  './img/apple-touch-icon.png',
  './img/android-192.png',
  './img/android-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(AGENDA_OFFLINE_CACHE).then(async (cache) => {
      for (const url of SHELL_FILES) {
        try {
          await cache.add(url);
        } catch (_) {
          // Ignora falhas pontuais de cache em assets opcionais.
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== AGENDA_OFFLINE_CACHE) return caches.delete(key);
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigate = event.request.mode === 'navigate';
  const isAgenda = url.pathname.endsWith('/agenda.html') || url.pathname.endsWith('/agenda');
  const isIndex = url.pathname.endsWith('/index.html') || /\/site\/?$/.test(url.pathname);

  if (isNavigate && (isAgenda || isIndex)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(AGENDA_OFFLINE_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (isAgenda) return (await caches.match('./agenda.html')) || Response.error();
          if (isIndex) return (await caches.match('./index.html')) || Response.error();
          return Response.error();
        })
    );
    return;
  }

  if (isNavigate) {
    // Demais páginas: sempre rede (não reutiliza HTML em cache para evitar tela desatualizada).
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(AGENDA_OFFLINE_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => Response.error());
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification && event.notification.data && event.notification.data.url) || './index.html?menu=1';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
      for (const cliente of clientes) {
        if ('focus' in cliente) {
          cliente.navigate(destino);
          return cliente.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(destino) : null;
    })
  );
});
