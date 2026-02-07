// assets/js/script.js

// ▼▼▼ 設定エリア (前回の内容に書き換えてください) ▼▼▼
// 1. 発行したVAPIDの公開鍵
const PUBLIC_VAPID_KEY = "BFTEWHggLHDw7FPQatTOKwC9-3c4-1qtI3s_y2BYtDcfIPin69PevQqHNnbeEBjm0oInxJ3dVdozExYLVD7wY1w";

// 2. 登録用LambdaのURL (SavePushSubscription)
const SAVE_SUBSCRIPTION_URL = "https://raukhf5t4u5fzx3cuyno7muptu0dqrvp.lambda-url.ap-northeast-1.on.aws/";
// ▲▲▲ 設定エリアここまで ▲▲▲


document.addEventListener('DOMContentLoaded', () => {
    /* =========================================
       UI Logic (Menu, Navigation, Animation)
       ========================================= */
    const menuToggle = document.getElementById('menu-toggle');
    const navOverlay = document.getElementById('nav-overlay');

    if (menuToggle && navOverlay) {
        menuToggle.addEventListener('click', () => {
            menuToggle.classList.toggle('active');
            navOverlay.classList.toggle('open');
            if (!navOverlay.classList.contains('open')) {
                const hero = document.querySelector('.hero');
                if (hero && hero.classList.contains('hero-exit')) hero.classList.remove('hero-exit');
                const conceptBtn = document.getElementById('concept-btn');
                if (conceptBtn) conceptBtn.classList.add('visible');
            }
        });

        const pathParts = window.location.pathname.split('/');
        let currentFile = pathParts[pathParts.length - 1];
        if (currentFile === '' || currentFile === '/') currentFile = 'index.html';

        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.getAttribute('href') === currentFile) {
                const li = link.closest('li');
                if (li) li.style.display = 'none';
            }
        });

        if (currentFile === 'index.html') {
            const hero = document.querySelector('.hero');
            const conceptBtn = document.getElementById('concept-btn');
            const conceptModal = document.getElementById('concept-modal');
            const closeModalBtn = document.getElementById('close-modal-btn');
            let autoMenuTimer = null; 

            const openModal = () => {
                if(conceptModal) conceptModal.classList.add('active');
                if(autoMenuTimer) { clearTimeout(autoMenuTimer); autoMenuTimer = null; }
            };
            const closeModal = () => { if(conceptModal) conceptModal.classList.remove('active'); };

            if (conceptBtn) conceptBtn.addEventListener('click', openModal);
            if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

            const exitDelay = 11000; 
            setTimeout(() => {
                if (conceptModal && conceptModal.classList.contains('active')) return; 
                if (hero) hero.classList.add('hero-exit'); 
                autoMenuTimer = setTimeout(() => {
                    if (conceptModal && conceptModal.classList.contains('active')) return;
                    if (!navOverlay.classList.contains('open')) {
                        menuToggle.classList.add('active');
                        navOverlay.classList.add('open');
                        setTimeout(() => { if (hero) hero.classList.remove('hero-exit'); }, 600);
                    }
                }, 100); 
            }, exitDelay); 
        }
    }

    /* =========================================
       Canvas Logic (Top Page Only)
       ========================================= */
    const canvas = document.getElementById('starry-sky');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let width, height;
        let stars = [], shootingStars = [], rotationAngle = 0;
        const rotationSpeed = 0.0002;

        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
            initStars();
        };

        class Star {
            constructor() {
                const maxDim = Math.sqrt(width * width + height * height);
                this.x = (Math.random() - 0.5) * maxDim * 1.5;
                this.y = (Math.random() - 0.5) * maxDim * 1.5;
                this.size = Math.random() * 1.5;
                this.baseAlpha = 0.3 + Math.random() * 0.7;
                this.blinkSpeed = 0.01 + Math.random() * 0.03;
                this.blinkOffset = Math.random() * Math.PI * 2;
            }
            draw() {
                const alpha = this.baseAlpha + Math.sin(Date.now() * 0.001 + this.blinkOffset) * 0.2;
                ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, Math.min(1, alpha))})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        class ShootingStar {
            constructor() { this.reset(); }
            reset() {
                this.x = Math.random() * width;
                this.y = Math.random() * height * 0.5;
                this.length = Math.random() * 80 + 10;
                this.speed = Math.random() * 10 + 6;
                this.angle = Math.PI / 4 + (Math.random() * 0.2 - 0.1);
                this.life = 1.0;
                this.active = true;
            }
            update() {
                this.x += Math.cos(this.angle) * this.speed;
                this.y += Math.sin(this.angle) * this.speed;
                this.life -= 0.02;
                if (this.life <= 0 || this.x > width || this.y > height) this.active = false;
            }
            draw() {
                if (!this.active) return;
                const tailX = this.x - Math.cos(this.angle) * this.length;
                const tailY = this.y - Math.sin(this.angle) * this.length;
                const gradient = ctx.createLinearGradient(this.x, this.y, tailX, tailY);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${this.life})`);
                gradient.addColorStop(1, `rgba(255, 255, 255, 0)`);
                ctx.lineWidth = 2; ctx.strokeStyle = gradient;
                ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(tailX, tailY); ctx.stroke();
            }
        }

        function initStars() {
            stars = [];
            const starCount = Math.floor((width * height) / 800); 
            for (let i = 0; i < starCount; i++) stars.push(new Star());
        }

        function animate() {
            ctx.clearRect(0, 0, width, height);
            ctx.save();
            ctx.translate(width / 2, height / 2);
            ctx.rotate(rotationAngle);
            stars.forEach(star => star.draw());
            ctx.restore();
            rotationAngle += rotationSpeed;

            shootingStars.forEach((s, index) => {
                if (s.active) { s.update(); s.draw(); } 
                else { shootingStars.splice(index, 1); }
            });
            if (Math.random() < 0.005 && shootingStars.length < 2) shootingStars.push(new ShootingStar());
            requestAnimationFrame(animate);
        }
        window.addEventListener('resize', resize);
        resize();
        animate();
    }


    /* =========================================
       PWA Push Notification Logic (Toggle & Stabilization)
       ========================================= */
    
    const pushBtn = document.getElementById('push-subscribe-btn');
    const pushMsg = document.getElementById('push-status-msg');
    let isProcessing = false; // 連打防止用

    if (pushBtn && 'serviceWorker' in navigator) {
        // Service Workerの準備完了を待ってから初期化
        navigator.serviceWorker.register('/sw.js')
            .then(() => navigator.serviceWorker.ready)
            .then(registration => {
                console.log('SW Ready');
                initializePushState(registration);
                
                // ボタンのクリックイベント（トグル処理）
                pushBtn.addEventListener('click', () => {
                    if (isProcessing) return;
                    handlePushToggle(registration);
                });
            })
            .catch(err => console.error('SW Error:', err));
    }

    // 初期状態の表示設定
    async function initializePushState(registration) {
        // ブロックされている場合
        if (Notification.permission === 'denied') {
            pushMsg.textContent = "通知がブロックされています。本体設定から許可してください。";
            pushBtn.disabled = true;
            pushBtn.style.opacity = 0.5;
            return;
        }

        const subscription = await registration.pushManager.getSubscription();
        updateUI(!!subscription); // subscriptionがあればtrue
    }

    // ボタン押下時の処理（分岐）
    async function handlePushToggle(registration) {
        isProcessing = true;
        pushBtn.disabled = true;
        pushMsg.textContent = "処理中...";

        try {
            const subscription = await registration.pushManager.getSubscription();

            if (subscription) {
                // --- ON -> OFF (解除) ---
                await unsubscribeUser(subscription);
                updateUI(false);
                pushMsg.textContent = "通知をオフにしました。";
            } else {
                // --- OFF -> ON (登録) ---
                await subscribeUser(registration);
                updateUI(true);
                pushMsg.textContent = "通知をオンにしました！";
            }
        } catch (err) {
            console.error('Toggle Error:', err);
            pushMsg.textContent = "エラーが発生しました。";
        } finally {
            isProcessing = false;
            pushBtn.disabled = false;
        }
    }

    // 登録処理
    async function subscribeUser(registration) {
        if (!PUBLIC_VAPID_KEY) throw new Error("VAPIDキー未設定");

        // 許可を求める
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error("許可されませんでした");
        }

        // 購読発行
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
        });

        // サーバーへ送信
        await callServer(subscription, 'POST');
    }

    // 解除処理
    async function unsubscribeUser(subscription) {
        // 1. サーバーから削除
        await callServer(subscription, 'DELETE');
        // 2. ブラウザ側の購読解除
        await subscription.unsubscribe();
    }

    // サーバー通信 (POST=登録, DELETE=削除)
    async function callServer(subscription, method) {
        if (!SAVE_SUBSCRIPTION_URL) return;

        // DELETEの場合は endpoint だけ送ればよいが、念のためsubscription全体からendpointを抽出して送る形でもOK
        const bodyData = method === 'DELETE' 
            ? { endpoint: subscription.endpoint } 
            : subscription;

        const res = await fetch(SAVE_SUBSCRIPTION_URL, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);
    }

    // UI更新（ボタンの見た目切り替え）
    function updateUI(isSubscribed) {
        if (isSubscribed) {
            pushBtn.textContent = "✅ 通知をオフにする";
            pushBtn.style.borderColor = "#4CAF50";
            pushBtn.style.color = "#4CAF50";
            pushBtn.style.background = "rgba(76, 175, 80, 0.1)";
        } else {
            pushBtn.textContent = "🔔 更新通知を受け取る";
            pushBtn.style.borderColor = "rgba(255,255,255,0.4)";
            pushBtn.style.color = "white";
            pushBtn.style.background = "rgba(255,255,255,0.1)";
        }
    }
});

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}