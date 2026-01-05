document.addEventListener('DOMContentLoaded', () => {
    /* UI Logic */
    const menuToggle = document.getElementById('menu-toggle');
    const navOverlay = document.getElementById('nav-overlay');

    if (menuToggle && navOverlay) {
        menuToggle.addEventListener('click', () => {
            menuToggle.classList.toggle('active');
            navOverlay.classList.toggle('open');
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

        // --- トップページアニメーション制御 ---
        if (currentFile === 'index.html') {
            const hero = document.querySelector('.hero');
            
            // タイムライン:
            // 0.0s : タイトルfadeIn開始
            // 8.0s : 円描画完了 (CSS animation設定より)
            
            // 8.0s後に「縮んで拡大フェードアウト」を開始
            setTimeout(() => {
                if (hero) {
                    // CSS animation: heroExitSequence (1.2s)
                    hero.classList.add('hero-exit'); 
                }

                // フェードアウトアニメーション完了(1.2秒後)に合わせてメニューを開く
                setTimeout(() => {
                    if (!navOverlay.classList.contains('open')) {
                        menuToggle.classList.add('active');
                        navOverlay.classList.add('open');
                        
                        // メニューが開いた後(少し待ってから)、背後のタイトルを表示状態に戻す
                        // すぐに戻すとメニューのフェードイン中にタイトルがパッと現れてしまうため、
                        // メニューが十分に見えてから(0.6秒後くらい)リセットする
                        setTimeout(() => {
                            if (hero) {
                                hero.classList.remove('hero-exit');
                            }
                        }, 600);
                    }
                }, 1100); // アニメーション終了直前(1.1s)くらいでメニューを開き始める

            }, 8000); // ページロードから8秒後に終了シーケンス開始
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