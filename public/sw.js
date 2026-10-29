// Notification delivery only. Authenticated pages and data are never cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const chat=event.notification.data?.type==='chat';
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const windowClient = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (windowClient) {
      await windowClient.focus();
      windowClient.postMessage({type:chat?'open-chat':'open-reminders'});
    } else await self.clients.openWindow(chat?'/#chat':'/#reminders');
  })());
});
