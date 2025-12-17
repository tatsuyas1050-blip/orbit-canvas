document.addEventListener('DOMContentLoaded', () => {
    /* UI Logic */
    const menuToggle = document.getElementById('menu-toggle');
    const navOverlay = document.getElementById('nav-overlay');

    // ハンバーガーメニューが存在する場合のみイベントを設定
    if (menuToggle && navOverlay) {
        menuToggle.addEventListener('click', () => {
            menuToggle.classList.toggle('active');
            navOverlay.classList.toggle('open');
        });

        // --- 追加機能: 現在のページのメニュー項目を非表示にする ---
        // 現在のURLのパスからファイル名を取得
        const pathParts = window.location.pathname.split('/');
        let currentFile = pathParts[pathParts.length - 1];
        
        // ファイル名が空（ルートディレクトリなど）の場合は index.html とみなす
        if (currentFile === '' || currentFile === '/') {
            currentFile = 'index.html';
        }

        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            // リンク先が現在のファイル名と一致したら親のliを隠す
            if (href === currentFile) {
                const listItem = link.closest('li');
                if (listItem) {
                    listItem.style.display = 'none';
                }
            }
        });
    }

    /* Canvas Logic (Top Page Only) */
    const canvas = document.getElementById('starry-sky');
    if (canvas) {
        const ctx = canvas.getContext('2d');

        let width, height;
        let stars = [];
        let shootingStars = [];
        
        // 日周運動のための回転角度
        let rotationAngle = 0;
        const rotationSpeed = 0.0002; // 回転速度

        // リサイズ処理
        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
            initStars();
        };

        // 星クラス
        class Star {
            constructor() {
                // 画面外も含めて広範囲に配置（回転時に角が切れないように）
                const maxDim = Math.sqrt(width * width + height * height);
                this.x = (Math.random() - 0.5) * maxDim * 1.5;
                this.y = (Math.random() - 0.5) * maxDim * 1.5;
                this.size = Math.random() * 1.5;
                this.baseAlpha = 0.3 + Math.random() * 0.7; // 基本の透明度
                this.blinkSpeed = 0.01 + Math.random() * 0.03;
                this.blinkOffset = Math.random() * Math.PI * 2;
            }

            draw() {
                // 瞬きのアニメーション (Sin波を使用)
                const alpha = this.baseAlpha + Math.sin(Date.now() * 0.001 + this.blinkOffset) * 0.2;
                const currentAlpha = Math.max(0, Math.min(1, alpha)); // 0~1に制限

                ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 流れ星クラス
        class ShootingStar {
            constructor() {
                this.reset();
            }

            reset() {
                this.x = Math.random() * width;
                this.y = Math.random() * height * 0.5; // 上半分から出現
                this.length = Math.random() * 80 + 10;
                this.speed = Math.random() * 10 + 6;
                this.angle = Math.PI / 4 + (Math.random() * 0.2 - 0.1); // 右下方向へ
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

        // 星の初期化
        function initStars() {
            stars = [];
            // 画面サイズに応じて星の数を調整
            const starCount = Math.floor((width * height) / 800); 
            for (let i = 0; i < starCount; i++) {
                stars.push(new Star());
            }
        }

        // アニメーションループ
        function animate() {
            ctx.clearRect(0, 0, width, height);

            // 1. 背景の星（日周運動あり）
            ctx.save();
            
            // 画面中心へ移動 -> 回転 -> 元の位置へ戻す（中心軸回転）
            ctx.translate(width / 2, height / 2);
            ctx.rotate(rotationAngle);
            
            stars.forEach(star => star.draw());
            
            ctx.restore();

            // 回転角度の更新
            rotationAngle += rotationSpeed;

            // 2. 流れ星（回転の影響を受けないように個別に描画）
            shootingStars.forEach((s, index) => {
                if (s.active) {
                    s.update();
                    s.draw();
                } else {
                    shootingStars.splice(index, 1);
                }
            });

            // 確率で新しい流れ星を生成
            if (Math.random() < 0.005 && shootingStars.length < 2) {
                shootingStars.push(new ShootingStar());
            }

            requestAnimationFrame(animate);
        }

        // イベントリスナーと初期実行
        window.addEventListener('resize', resize);
        resize();
        animate();
    }
});