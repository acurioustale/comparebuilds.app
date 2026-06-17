const CACHE = 'zamimg-icons-v1'

// Take over immediately without waiting for existing tabs to close.
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Activate: claim all clients and purge any caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim().then(() =>
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
    ),
  )
})

// Cache-first for wow.zamimg.com icons; ignore everything else.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (new URL(request.url).hostname !== 'wow.zamimg.com') return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)

      // Image requests from <img> tags arrive as no-cors, so the response is
      // opaque (status 0, ok=false). Cache it anyway — zamimg icons are stable
      // assets and an occasional bad opaque response is not worth the risk of
      // missing icons entirely.
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone())
      }

      return response
    }),
  )
})
