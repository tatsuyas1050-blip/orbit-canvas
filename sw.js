// sw.js
// PWAのService Worker: 通知の受信とバッジ制御を行います

self.addEventListener('install', (event) => {
  // インストールされたら即座に有効化
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// プッシュ通知を受信した時のイベント
self.addEventListener('push', (event) => {
  let data = {};
  
  // サーバーから送られてきたデータを取り出す
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      // JSONでない場合は文字列として扱う
      data = { title: 'ソノッキーの部屋', body: event.data.text() };
    }
  }

  const title = data.title || '新しいお知らせ';
  const options = {
    body: data.body || 'コンテンツが更新されました',
    // アイコンは既存のロゴ画像を指定しています
    icon: '/assets/img/lifelog_mark.png', 
    badge: '/assets/img/lifelog_mark_white.png', // Androidステータスバー用の白黒アイコン（適宜変更可）
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/theater.html' // 通知をクリックした時に開くURL
    }
  };

  // 1. 通知バナーを表示
  event.waitUntil(
    self.registration.showNotification(title, options)
  );

  // 2. アプリアイコンにバッジを付ける (対応ブラウザのみ)
  if (navigator.setAppBadge) {
    navigator.setAppBadge(1).catch((error) => {
      console.log('Badge error:', error);
    });
  }
});

// 通知がクリックされた時のイベント
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // バッジをクリアする
  if (navigator.clearAppBadge) {
    navigator.clearAppBadge();
  }

  // 通知に含まれるURL（なければtheater.html）を開く
  const urlToOpen = event.notification.data.url || '/theater.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 既に開いているタブがあればフォーカスする
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // 開いていなければ新しく開く
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});