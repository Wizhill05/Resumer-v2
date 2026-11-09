self.addEventListener("push", (event) => {
  let data = { title: "New reply on your Resumer support issue", body: "", url: "/support" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "The support team replied to your issue.",
      icon: "/icon-192.png",
      data: { url: data.url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/support";
  event.waitUntil(
    clients.matchAll({ type: "window", includeControlled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
