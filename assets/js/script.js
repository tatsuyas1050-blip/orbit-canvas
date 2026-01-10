document.addEventListener('DOMContentLoaded', () => {
    /* UI Logic */
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

            
            // タイムライン設定:
            // 0.0s : タイトルfadeIn開始
            // 2.5s : キャッチコピーfadeIn開始
            // 5.0s : 円描画開始 (6秒かけて描画)
            // 11.0s : 円描画完了
            
            // 11.0s後に「縮んで拡大フェードアウト」を開始し、すぐにメニューを開く
            const exitDelay = 11000; 

            setTimeout(() => {
                // もしコンセプトモーダルが開いていたらスキップ
                if (conceptModal && conceptModal.classList.contains('active')) {
                    return; 
                }

                if (hero) {
                    hero.classList.add('hero-exit'); 
                }

                // フェードアウト開始とほぼ同時にメニューを開く (100msの微小ディレイのみ)
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
                }, 100); // 描画完了後「すぐ」

            }, exitDelay); 
        }
    }

    /* Canvas Logic (Top Page Only) */
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
});