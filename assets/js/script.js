// assets/js/script.js

// ▼▼▼ 設定エリア ▼▼▼
// 1. 発行したVAPIDの公開鍵 (Public Key)
const PUBLIC_VAPID_KEY = "BFTEWHggLHDw7FPQatTOKwC9-3c4-1qtI3s_y2BYtDcfIPin69PevQqHNnbeEBjm0oInxJ3dVdozExYLVD7wY1w";

// 2. 作成した通知登録用LambdaのURL (SavePushSubscription)
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
            
            // メニューが開いた状態ではない(=閉じた)時
            if (!navOverlay.classList.contains('open')) {
                // トップページのタイトルが消えていたら戻す
                const hero = document.querySelector('.hero');
                if (hero && hero.classList.contains('hero-exit')) {
                    hero.classList.remove('hero-exit');
                }

                // コンセプトボタンを表示状態にする
                const conceptBtn = document.getElementById('concept-btn');
                if (conceptBtn) {
                    conceptBtn.classList.add('visible');
                }
            }
        });

        // 現在のページのメニュー項目を非表示にする
        const pathParts = window.location.pathname.split('/');
        let currentFile = pathParts[pathParts.length - 1];
        if (currentFile === '' || currentFile === '/') {
            currentFile = 'index.html';
        }

        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href === currentFile) {
                const listItem = link.closest('li');
                if (listItem) {
                    listItem.style.display = 'none';
                }
            }
        });

        // --- トップページアニメーション制御 & コンセプトモーダル ---
        if (currentFile === 'index.html') {
            const hero = document.querySelector('.hero');
            const conceptBtn = document.getElementById('concept-btn');
            const conceptModal = document.getElementById('concept-modal');
            const closeModalBtn = document.getElementById('close-modal-btn');
            
            let autoMenuTimer = null; 

            // モーダル開閉処理
            const openModal = () => {
                if(conceptModal) conceptModal.classList.add('active');
                if(autoMenuTimer) {
                    clearTimeout(autoMenuTimer);
                    autoMenuTimer = null;
                }
            };

            const closeModal = () => {
                if(conceptModal) conceptModal.classList.remove('active');
            };

            if (conceptBtn) conceptBtn.addEventListener('click', openModal);
            if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

            
            // タイムライン設定
            const exitDelay = 11000; 

            setTimeout(() => {
                // もしコンセプトモーダルが開いていたらスキップ
                if (conceptModal && conceptModal.classList.contains('active')) {
                    return; 
                }

                if (hero) {
                    hero.classList.add('hero-exit'); 
                }

                // フェードアウト開始とほぼ同時にメニューを開く
                autoMenuTimer = setTimeout(() => {
                    if (conceptModal && conceptModal.classList.contains('active')) return;

                    if (!navOverlay.classList.contains('open')) {
                        menuToggle.classList.add('active');
                        navOverlay.classList.add('open');
                        
                        // メニューが開いた後、背後のタイトルを表示状態に戻す
                        setTimeout(() => {
                            if (hero) {
                                hero.classList.remove('hero-exit');
                            }
                        }, 600);
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
        let stars = [];
        let shootingStars = [];
        
        let rotationAngle = 0;
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
                const currentAlpha = Math.max(0, Math.min(1, alpha));

                ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        class ShootingStar {
            constructor() {
                this.reset();
            }

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

                if (this.life <= 0 || this.x > width || this.y > height) {
                    this.active = false;
                }
            }

            draw() {
                if (!this.active) return;
                
                const tailX = this.x - Math.cos(this.angle) * this.length;
                const tailY = this.y - Math.sin(this.angle) * this.length;

                const gradient = ctx.createLinearGradient(this.x, this.y, tailX, tailY);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${this.life})`);
                gradient.addColorStop(1, `rgba(255, 255, 255, 0)`);

                ctx.lineWidth = 2;
                ctx.strokeStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(tailX, tailY);
                ctx.stroke();
            }
        }

        function initStars() {
            stars = [];
            const starCount = Math.floor((width * height) / 800); 
            for (let i = 0; i < starCount; i++) {
                stars.push(new Star());
            }
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
                if (s.active) {
                    s.update();
                    s.draw();
                } else {
                    shootingStars.splice(index, 1);
                }
            });

            if (Math.random() < 0.005 && shootingStars.length < 2) {
                shootingStars.push(new ShootingStar());
            }

            requestAnimationFrame(animate);
        }

        window.addEventListener('resize', resize);
        resize();
        animate();
    }


    /* =========================================
       PWA Push Notification Logic (Button Trigger)
       ========================================= */

    const pushBtn = document.getElementById('push-subscribe-btn');
    const pushMsg = document.getElementById('push-status-msg');

    // 1. Service Workerの登録（画面が開かれたら裏で準備だけしておく）
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW Registered');
                initializePushState(registration);
            })
            .catch(err => console.error('SW Error:', err));
    }

    // 2. ボタンの状態を初期化する関数
    async function initializePushState(registration) {
        if (!pushBtn) return; 

        // 既に通知が許可されているかチェック
        if (Notification.permission === 'denied') {
            pushMsg.textContent = "通知がブロックされています。本体設定から許可してください。";
            pushBtn.disabled = true;
            pushBtn.style.opacity = 0.5;
            return;
        }

        // 既に購読済みかチェック
        const subscription = await registration.pushManager.getSubscription();
        
        if (subscription) {
            // 購読済みの場合
            pushBtn.textContent = "✅ 通知設定済み";
            pushBtn.style.borderColor = "#4CAF50";
            pushBtn.style.color = "#4CAF50";
            
            // 念のためサーバーに最新情報を再送信しておく（期限切れ対策）
            updateSubscriptionOnServer(subscription);
        } else {
            // 未購読の場合：クリックイベントを設定
            pushBtn.addEventListener('click', () => subscribeUser(registration));
        }
    }

    // 3. ユーザーがボタンを押した時の処理
    async function subscribeUser(registration) {
        if (!PUBLIC_VAPID_KEY) {
            alert("VAPIDキーが設定されていません。script.jsを確認してください。");
            return;
        }

        pushBtn.disabled = true;
        pushMsg.textContent = "設定中...";

        try {
            // ★ここで「許可しますか？」のダイアログが出ます（iOS対応）
            const permission = await Notification.requestPermission();

            if (permission === 'granted') {
                // 許可されたら、購読情報を発行
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
                });

                // サーバーに保存
                const isSaved = await updateSubscriptionOnServer(subscription);
                
                if (isSaved) {
                    pushBtn.textContent = "✅ 通知設定済み";
                    pushBtn.style.borderColor = "#4CAF50";
                    pushBtn.style.color = "#4CAF50";
                    pushMsg.textContent = "登録しました！";
                } else {
                    throw new Error("サーバー保存失敗");
                }
            } else {
                pushMsg.textContent = "通知が許可されませんでした。";
                pushBtn.disabled = false;
            }
        } catch (err) {
            console.error('Push setup failed:', err);
            pushMsg.textContent = "エラーが発生しました。通信環境を確認してください。";
            pushBtn.disabled = false;
        }
    }

    // 4. サーバー保存処理
    async function updateSubscriptionOnServer(subscription) {
        if (!SAVE_SUBSCRIPTION_URL) {
            console.error("LambdaのURLが設定されていません script.jsを確認してください");
            return false;
        }
        
        try {
            await fetch(SAVE_SUBSCRIPTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subscription)
            });
            console.log('Subscription sent to server.');
            return true;
        } catch (e) {
            console.error('Save error:', e);
            return false;
        }
    }
});

// VAPIDキー変換用ユーティリティ
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