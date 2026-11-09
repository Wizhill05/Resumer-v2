self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Only ever open or focus pages on this site, whatever the push payload says.
function sameOriginUrl(raw) {
  try {
    const target = new URL(raw || "/support", self.location.origin);
    if (target.origin !== self.location.origin) return null;
    return target;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  let data = { title: "New reply on your Resumer support issue", body: "", url: "/support" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}
  const target = sameOriginUrl(data.url) || sameOriginUrl("/support");
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "The support team replied to your issue.",
      icon: "/icon-192.png",
      data: { url: target.href }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    sameOriginUrl(event.notification.data && event.notification.data.url) || sameOriginUrl("/support");
  if (!target) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url === target.href && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target.href);
    })
  );
});
