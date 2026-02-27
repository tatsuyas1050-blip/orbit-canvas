(function () {
    'use strict';

    const CFG = Object.freeze({
        startTimeJst: '2026-03-03T17:00:00+09:00',
        durationMin: 390,
        initialMin: 214, // 初期位置を「食の最大(20:34)」に変更
        earthRkm: 6371,
        moonRkm: 1737.4,
        moonDistanceEr: 60.3,
        pathY0: 1.361, // 月の移動軌道を時間に合わせて調整
        pathY1: -1.821, // 月の移動軌道を時間に合わせて調整
        pathZBase: 0.3765, 
        pathZAmp: 0.08,
        scaleX: 0.18,
        scaleYZ: 1.8,
        shadowLenEr: 90,
        frameMs: 120
    });
    const SHADOW_PHYS = Object.freeze({
        sunRkm: 695700,
        earthSunDistanceKm: 149597870.7
    });
    const SHADOW_GEOM = Object.freeze((() => {
        const sunRer = SHADOW_PHYS.sunRkm / CFG.earthRkm;
        const earthSunDistanceEr = SHADOW_PHYS.earthSunDistanceKm / CFG.earthRkm;
        const umbraSlopeEr = (sunRer - 1) / earthSunDistanceEr;
        const penumbraSlopeEr = (sunRer + 1) / earthSunDistanceEr;
        return {
            sunRer: sunRer,
            earthSunDistanceEr: earthSunDistanceEr,
            umbraSlopeEr: umbraSlopeEr,
            penumbraSlopeEr: penumbraSlopeEr,
            umbraLengthEr: 1 / umbraSlopeEr
        };
    })());
    
    const VIEW_CTRL = Object.freeze({
        yawTurnPerCanvas: Math.PI * 1.15,
        pitchTurnPerCanvas: Math.PI * 0.55,
        pitchMin: -0.62,
        pitchMax: 0.62,
        followLerp: 0.35
    });
    const MOON_VIEW = Object.freeze({
        camDist: 3.45,          // 月半径を1としたときのカメラ距離（衛星軌道風）
        focalScale: 1.28,       // 透視投影の強さ
        skyEarthDist: 22,       // Earthを描画する疑似天球距離
        skySunDist: 28,         // Sunを描画する疑似天球距離
        earthAngDeg: 0.95,      // 月から見た地球の見かけ半径（概算）
        sunAngDeg: 0.266        // 月から見た太陽の見かけ半径（概算）
    });
    const AXIS_REF = Object.freeze({
        earthTiltRad: 23.44 * Math.PI / 180,   // 地球の自転軸傾斜（黄道面基準）
        moonOrbitInclRad: 5.145 * Math.PI / 180 // 月軌道面の傾斜（黄道面基準）
    });
    const OFFICIAL_EVENT_MIN = Object.freeze({
        // JST 2026-03-03 を基準にした公式値（CFG.startTimeJst からの分オフセット）
        P1: 43,   // 半影食開始 17:43
        U1: 110,  // 部分食開始 18:50
        U2: 184,  // 皆既食開始 20:04
        MAX: 214, // 食最大     20:34
        U3: 243,  // 皆既食終了 21:03
        U4: 318,  // 部分食終了 22:18
        P4: 385   // 半影食終了 23:25
    });
    const MODEL_EVENT_MIN = Object.freeze({
        // 現行幾何モデルでの接触時刻（内部計算用）
        P1: -16,
        U1: 55,
        U2: 138,
        MAX: 167,
        U3: 197,
        U4: 280,
        P4: 351
    });
    const TIME_WARP_ANCHORS = Object.freeze({
        // 表示時刻(17:00基準) -> 幾何計算時刻の対応
        // 17:00 は半影外にしつつ、各イベント時刻を一致させる
        display: [0, OFFICIAL_EVENT_MIN.P1, OFFICIAL_EVENT_MIN.U1, OFFICIAL_EVENT_MIN.U2, OFFICIAL_EVENT_MIN.MAX, OFFICIAL_EVENT_MIN.U3, OFFICIAL_EVENT_MIN.U4, OFFICIAL_EVENT_MIN.P4, CFG.durationMin],
        model: [-62, MODEL_EVENT_MIN.P1, MODEL_EVENT_MIN.U1, MODEL_EVENT_MIN.U2, MODEL_EVENT_MIN.MAX, MODEL_EVENT_MIN.U3, MODEL_EVENT_MIN.U4, MODEL_EVENT_MIN.P4, 356]
    });

    // ====== 月食専用の星データ(CSV)の読み込み ======
    let realStarsData = null;
    fetch('assets/catalogs/eclipse_stars.csv')
        .then(res => res.text())
        .then(csvText => {
            const lines = csvText.trim().split('\n');
            const parsedStars = [];
            
            // 1行目はヘッダー「ra,dec,vmag」なので、i=1 からループを開始します
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length >= 3) {
                    const ra = parseFloat(parts[0]);
                    const dec = parseFloat(parts[1]);
                    const vmag = parseFloat(parts[2]);
                    
                    // 数値として正しい行だけを配列に追加
                    if (!isNaN(ra) && !isNaN(dec) && !isNaN(vmag)) {
                        parsedStars.push({
                            ra_deg: ra,
                            dec_deg: dec,
                            vmag: vmag
                        });
                    }
                }
            }
            realStarsData = parsedStars;
            console.log(`月食背景用の星データを ${realStarsData.length} 個読み込みました。`);
        })
        .catch(err => console.warn('CSV catalog load error:', err));

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smoothstep(edge0, edge1, x) {
        const span = edge1 - edge0;
        if (Math.abs(span) < 1e-9) return x >= edge1 ? 1 : 0;
        const t = clamp((x - edge0) / span, 0, 1);
        return t * t * (3 - 2 * t);
    }
    function hexToRgb(hex) {
        const normalized = String(hex).replace(/^#/, '');
        if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 255, g: 255, b: 255 };
        return {
            r: parseInt(normalized.slice(0, 2), 16),
            g: parseInt(normalized.slice(2, 4), 16),
            b: parseInt(normalized.slice(4, 6), 16)
        };
    }
    function mixRgbHex(aHex, bHex, t) {
        const a = hexToRgb(aHex);
        const b = hexToRgb(bHex);
        const k = clamp(t, 0, 1);
        return {
            r: Math.round(lerp(a.r, b.r, k)),
            g: Math.round(lerp(a.g, b.g, k)),
            b: Math.round(lerp(a.b, b.b, k))
        };
    }
    function rgbCss(c) { return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')'; }
    function rgbaCss(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
    function wrapAngle(rad) {
        const twoPi = Math.PI * 2;
        let x = (rad + Math.PI) % twoPi;
        if (x < 0) x += twoPi;
        return x - Math.PI;
    }
    function lerpAngle(a, b, t) {
        const d = wrapAngle(b - a);
        return wrapAngle(a + d * t);
    }
    function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    function cross(a, b) {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        };
    }
    function normalize(v) {
        const len = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    }
    function add(a,b){return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z};}
    function sub(a,b){return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
    function scale(v,s){return {x:v.x*s,y:v.y*s,z:v.z*s};}

    function rotateAroundAxis(v, axis, angle) {
        const k = normalize(axis);
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const kv = dot(k, v);
        const kxv = cross(k, v);
        return {
            x: v.x * c + kxv.x * s + k.x * kv * (1 - c),
            y: v.y * c + kxv.y * s + k.y * kv * (1 - c),
            z: v.z * c + kxv.z * s + k.z * kv * (1 - c)
        };
    }

    function lcg(seed) {
        let x = seed >>> 0;
        return function () {
            x = (1664525 * x + 1013904223) >>> 0;
            return x / 4294967296;
        };
    }

    function makeStars(n, seed) {
        const rnd = lcg(seed);
        const out = [];
        for (let i = 0; i < n; i++) {
            out.push({ x: rnd(), y: rnd(), a: 0.3 + rnd() * 0.7, s: 0.4 + rnd() * 1.6 });
        }
        return out;
    }

    function overlapArea(r1, r2, d) {
        if (d >= r1 + r2) return 0;
        if (d <= Math.abs(r1 - r2)) {
            const r = Math.min(r1, r2);
            return Math.PI * r * r;
        }
        if (d <= 0) return 0;
        const c1 = clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1, 1);
        const c2 = clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1, 1);
        const a1 = r1 * r1 * Math.acos(c1);
        const a2 = r2 * r2 * Math.acos(c2);
        const a3 = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
        return a1 + a2 - a3;
    }

    function sizeCanvas(canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        return { w, h };
    }

    function circle(ctx, x, y, r) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
    }

    function liveActive() {
        return (typeof window.isLiveTabActive === 'function') ? window.isLiveTabActive() : true;
    }
    function mapDisplayToModelMinute(displayMinute) {
        const m = clamp(displayMinute, 0, CFG.durationMin);
        const ds = TIME_WARP_ANCHORS.display;
        const ms = TIME_WARP_ANCHORS.model;
        for (let i = 0; i < ds.length - 1; i++) {
            const d0 = ds[i];
            const d1 = ds[i + 1];
            if (m <= d1) {
                const span = d1 - d0;
                if (span <= 0) return ms[i];
                const t = (m - d0) / span;
                return lerp(ms[i], ms[i + 1], t);
            }
        }
        return ms[ms.length - 1];
    }

    window.initLunarEclipseSim = function initLunarEclipseSim() {
        const panel = document.getElementById('eclipse-sim-panel');
        if (!panel || panel.dataset.ready === '1') return;
        panel.dataset.ready = '1';
        const moonImg = new Image();
        moonImg.src = "assets/img/moon_img.png"; // パスはご自身の環境に合わせてください

        // ====== Moon globe view: NASA の月面テクスチャ ======
        // ブラウザでは Windows の絶対パス (例: C:\\... ) は参照できないため、
        // theater.html からアクセスできる相対パスに配置してください。
        // 期待パス: assets/img/moon_color.jpg
        const moonColorImg = new Image();
        moonColorImg.src = "assets/img/moon_color.jpg";
        let moonTex = { ready: false, w: 0, h: 0, data: null };
        moonColorImg.addEventListener('load', () => {
            try {
                const off = document.createElement('canvas');
                off.width = moonColorImg.naturalWidth || 0;
                off.height = moonColorImg.naturalHeight || 0;
                if (off.width < 2 || off.height < 2) return;
                const octx = off.getContext('2d', { willReadFrequently: true });
                if (!octx) return;
                octx.drawImage(moonColorImg, 0, 0);
                const img = octx.getImageData(0, 0, off.width, off.height);
                moonTex = { ready: true, w: off.width, h: off.height, data: img.data };
                if (liveActive()) render();
            } catch (err) {
                console.warn('moon_color.jpg load error:', err);
            }
        });
        const earthColorImg = new Image();
        earthColorImg.src = "assets/img/earth_color.jpg";
        let earthTex = { ready: false, w: 0, h: 0, data: null };
        earthColorImg.addEventListener('load', () => {
            try {
                const off = document.createElement('canvas');
                off.width = earthColorImg.naturalWidth || 0;
                off.height = earthColorImg.naturalHeight || 0;
                if (off.width >= 2 && off.height >= 2) {
                    const octx = off.getContext('2d', { willReadFrequently: true });
                    if (octx) {
                        octx.drawImage(earthColorImg, 0, 0);
                        const img = octx.getImageData(0, 0, off.width, off.height);
                        earthTex = { ready: true, w: off.width, h: off.height, data: img.data };
                    }
                }
            } catch (err) {
                console.warn('earth_color.jpg pixel buffer error:', err);
            }
            if (liveActive()) render();
        });
        earthColorImg.addEventListener('error', (err) => {
            console.warn('earth_color.jpg load error:', err);
        });

        const slider = document.getElementById('eclipse-time-slider');
        const playBtn = document.getElementById('eclipse-play-toggle');
        const rotateBtn = document.getElementById('eclipse-autorotate-toggle');
        const centerEarthBtn = document.getElementById('eclipse-center-earth');
        const centerMoonBtn = document.getElementById('eclipse-center-moon');
        const zoomInBtn = document.getElementById('eclipse-zoom-in');
        const zoomOutBtn = document.getElementById('eclipse-zoom-out');
        const faceCanvas = document.getElementById('eclipse-face-canvas');
        const orbitCanvas = document.getElementById('eclipse-orbit-canvas') || document.getElementById('eclipse-3d-canvas');
        const viewCanvas = orbitCanvas;
        const moonCentricCanvas = orbitCanvas;
        const eventList = document.getElementById('eclipse-event-list');
        if (!slider || !playBtn || !rotateBtn || !faceCanvas || !orbitCanvas || !eventList) return;

        const dom = {
            time: document.getElementById('eclipse-time-label'),
            min: document.getElementById('eclipse-minute-label'),
            stage: document.getElementById('eclipse-stage'),
            umbra: document.getElementById('eclipse-umbra-coverage'),
            penumbra: document.getElementById('eclipse-penumbra-coverage'),
            axis: document.getElementById('eclipse-axis-distance'),
            dist: document.getElementById('eclipse-moon-distance'),
            speed: document.getElementById('eclipse-rel-speed'),
            cam: document.getElementById('eclipse-camera-angle')
        };

        const moonRer = CFG.moonRkm / CFG.earthRkm;
        const ZOOM_CFG = Object.freeze({
            earthMin: 2.2,
            earthMax: 12,
            earthStep: 0.28,
            moonMin: 2.2,
            moonMax: 7.2,
            moonStep: 0.22
        });
        const EARTH_ROT = Object.freeze({
            solarDayMin: 1440
        });
        const startMs = new Date(CFG.startTimeJst).getTime();
        const fmtJst = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const startUtc = new Date(startMs);
        const startUtcHours = startUtc.getUTCHours()
            + startUtc.getUTCMinutes() / 60
            + startUtc.getUTCSeconds() / 3600;
        const startSubsolarLonDeg = (12 - startUtcHours) * 15;
        const earthSpinPhaseTurns = (startSubsolarLonDeg - 180) / 360;
        const sunAxis = Object.freeze({ x: 1, y: 0, z: 0 });
        const eclipticNorth = Object.freeze({ x: 0, y: 1, z: 0 });
        const earthSpinAxis = Object.freeze(normalize(rotateAroundAxis(eclipticNorth, sunAxis, AXIS_REF.earthTiltRad)));
        const orbitAxis = Object.freeze(normalize(rotateAroundAxis(eclipticNorth, sunAxis, AXIS_REF.moonOrbitInclRad)));
        const orbitPerpAxis = Object.freeze(normalize(cross(orbitAxis, sunAxis)));
        const viewForwardRef = Object.freeze({ x: 0, y: 0, z: 1 });

        function moonLocalFromWorld(v) {
            return {
                x: dot(v, orbitPerpAxis),
                y: dot(v, orbitAxis),
                z: dot(v, sunAxis)
            };
        }
        function moonLocalToWorld(v) {
            return {
                x: orbitPerpAxis.x * v.x + orbitAxis.x * v.y + sunAxis.x * v.z,
                y: orbitPerpAxis.y * v.x + orbitAxis.y * v.y + sunAxis.y * v.z,
                z: orbitPerpAxis.z * v.x + orbitAxis.z * v.y + sunAxis.z * v.z
            };
        }
        function rotateMoonLocal(v, yaw, pitch) {
            const cy = Math.cos(yaw), sy = Math.sin(yaw);
            const cp = Math.cos(pitch), sp = Math.sin(pitch);
            const x1 = v.x * cy - v.z * sy;
            const z1 = v.x * sy + v.z * cy;
            return {
                x: x1,
                y: v.y * cp - z1 * sp,
                z: v.y * sp + z1 * cp
            };
        }
        function spherePoint(latRad, lonRad) {
            const c = Math.cos(latRad);
            return {
                x: c * Math.sin(lonRad),
                y: Math.sin(latRad),
                z: c * Math.cos(lonRad)
            };
        }
        function shadowDirFromMoon(p) {
            const v = { x: 0, y: -p.y, z: -p.z };
            const len = Math.hypot(v.x, v.y, v.z);
            if (len < 1e-6) return { x: 0, y: 1, z: 0 };
            return { x: v.x / len, y: v.y / len, z: v.z / len };
        }

        const sim = {
            m: CFG.initialMin,
            play: false,
            auto: true,
            center: 'moon',
            dragMode: null,
            last: 0,
            starsFace: makeStars(140, 901),
            stars3d: makeStars(90, 2203),
            view: {
                yaw: -0.92,
                pitch: 0.34,
                targetYaw: -0.92,
                targetPitch: 0.34,
                dist: 4.6,
                scale: 320,
                cx: 0,
                cy: 0,
                drag: false,
                pid: null,
                x: 0,
                y: 0
            },
            moonView: {
                yaw: -1.0,
                pitch: 0.18,
                targetYaw: -1.0,
                targetPitch: 0.18,
                dist: MOON_VIEW.camDist,
                drag: false,
                pid: null,
                x: 0,
                y: 0
            }
        };

        slider.min = '0';
        slider.max = String(CFG.durationMin);
        slider.step = '1';
        slider.value = String(sim.m);

        function syncCenterToggle() {
            if (!centerEarthBtn || !centerMoonBtn) return;
            const earthMode = sim.center === 'earth';
            centerEarthBtn.classList.toggle('is-active', earthMode);
            centerEarthBtn.setAttribute('aria-pressed', earthMode ? 'true' : 'false');
            centerMoonBtn.classList.toggle('is-active', !earthMode);
            centerMoonBtn.setAttribute('aria-pressed', earthMode ? 'false' : 'true');
        }
        function viewStateByMode(mode) {
            return mode === 'earth' ? sim.view : sim.moonView;
        }
        function zoomInfoByMode(mode) {
            if (mode === 'earth') {
                return { min: ZOOM_CFG.earthMin, max: ZOOM_CFG.earthMax, step: ZOOM_CFG.earthStep, unit: 'R' };
            }
            return { min: ZOOM_CFG.moonMin, max: ZOOM_CFG.moonMax, step: ZOOM_CFG.moonStep, unit: 'R' };
        }
        function ensureViewDistance(mode) {
            const active = viewStateByMode(mode);
            const z = zoomInfoByMode(mode);
            const fallback = mode === 'earth' ? 4.6 : MOON_VIEW.camDist;
            const d = clamp(Number(active.dist) || fallback, z.min, z.max);
            active.dist = d;
            return d;
        }
        function zoomBy(notches) {
            if (!Number.isFinite(notches) || notches === 0) return;
            const mode = sim.center === 'earth' ? 'earth' : 'moon';
            const active = viewStateByMode(mode);
            const z = zoomInfoByMode(mode);
            const base = ensureViewDistance(mode);
            active.dist = clamp(base + z.step * notches, z.min, z.max);
            if (sim.auto) { sim.auto = false; syncBtn(); }
            if (liveActive()) render();
        }
        function setCenterMode(mode) {
            if (mode !== 'earth' && mode !== 'moon') return;
            if (sim.center === mode) return;
            if (sim.dragMode) stopDrag();
            ensureViewDistance(mode);
            sim.center = mode;
            syncCenterToggle();
            if (liveActive()) render();
        }

        function moonPos(minute) {
            const p = minute / CFG.durationMin;

            // Moon position is defined in the *world* (ecliptic) frame.
            // - sunAxis: direction toward the Sun (x axis in this sim)
            // - orbitPerpAxis: in-plane axis orthogonal to sunAxis
            // - orbitAxis: orbit-plane normal (tilt/inclination)
            //
            // IMPORTANT: build the vector with full basis components (do NOT pick only .y/.z),
            // otherwise the direction becomes inconsistent when the camera rotates.
            const sweep = lerp(CFG.pathY0, CFG.pathY1, p);
            const axisOffset = CFG.pathZBase;

            // Along the Sun-axis (x): keep the original distance + small wobble.
            const xAlongSun = CFG.moonDistanceEr + 0.35 * Math.sin(p * Math.PI * 2);

            const v = add(
                scale(sunAxis, xAlongSun),
                add(
                    scale(orbitPerpAxis, sweep),
                    scale(orbitAxis, axisOffset)
                )
            );
            return v;
        }

        function shadowAt(xEr) {
            const x = Math.max(0, xEr);
            return {
                umbra: Math.max(0, 1 - x * SHADOW_GEOM.umbraSlopeEr),
                penumbra: 1 + x * SHADOW_GEOM.penumbraSlopeEr
            };
        }

        function speed(minute) {
            const m0 = clamp(minute - 0.5, 0, CFG.durationMin);
            const m1 = clamp(minute + 0.5, 0, CFG.durationMin);
            const a = moonPos(mapDisplayToModelMinute(m0));
            const b = moonPos(mapDisplayToModelMinute(m1));
            return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * CFG.earthRkm / 60;
        }
        function stageByOfficialTime(minute) {
            const m = clamp(minute, 0, CFG.durationMin);
            if (m < OFFICIAL_EVENT_MIN.P1) return '半影外';
            if (m < OFFICIAL_EVENT_MIN.U1) return '半影月食';
            if (m < OFFICIAL_EVENT_MIN.U2) return '部分月食';
            if (m < OFFICIAL_EVENT_MIN.U3) return '皆既月食';
            if (m < OFFICIAL_EVENT_MIN.U4) return '部分月食';
            if (m <= OFFICIAL_EVENT_MIN.P4) return '半影月食';
            return '半影外';
        }

        function state(minute) {
            const m = clamp(minute, 0, CFG.durationMin);
            const modelM = mapDisplayToModelMinute(m);
            const p = moonPos(modelM);
            const sh = shadowAt(p.x);
            const d = Math.hypot(p.y, p.z);
            const inP = d < sh.penumbra + moonRer;
            const inU = d < sh.umbra + moonRer;
            const total = d < Math.max(0, sh.umbra - moonRer);
            const stage = stageByOfficialTime(m);
            const moonArea = Math.PI * moonRer * moonRer;
            return {
                m, modelM, p, sh, d, inP, inU, total, stage,
                umC: clamp(overlapArea(moonRer, sh.umbra, d) / moonArea, 0, 1),
                peC: clamp(overlapArea(moonRer, sh.penumbra, d) / moonArea, 0, 1)
            };
        }

        const initState = state(sim.m);
        const initShadowLocal = moonLocalFromWorld(shadowDirFromMoon(initState.p));
        sim.moonView.yaw = wrapAngle(Math.atan2(initShadowLocal.x, initShadowLocal.z));
        sim.moonView.pitch = clamp(-Math.atan2(initShadowLocal.y, Math.hypot(initShadowLocal.x, initShadowLocal.z)), VIEW_CTRL.pitchMin, VIEW_CTRL.pitchMax);
        sim.moonView.targetYaw = sim.moonView.yaw;
        sim.moonView.targetPitch = sim.moonView.pitch;

        function disp(v) { return { x: v.x * CFG.scaleX, y: v.y * CFG.scaleYZ, z: v.z * CFG.scaleYZ }; }
        function rot(v) {
            // 1) 公転軸基準で水平回転 2) その姿勢に直交する軸で上下回転
            const yawed = rotateAroundAxis(v, orbitAxis, sim.view.yaw);
            const forward = rotateAroundAxis(sunAxis, orbitAxis, sim.view.yaw);
            let tiltAxis = cross(orbitAxis, forward);
            const tl = Math.hypot(tiltAxis.x, tiltAxis.y, tiltAxis.z);
            if (tl < 1e-6) {
                tiltAxis = { x: 0, y: 0, z: 1 };
            } else {
                tiltAxis = { x: tiltAxis.x / tl, y: tiltAxis.y / tl, z: tiltAxis.z / tl };
            }
            return rotateAroundAxis(yawed, tiltAxis, sim.view.pitch);
        }
        function proj(v) {
            const z = v.z + sim.view.dist;
            if (z <= 0.2) return null;
            const s = sim.view.scale / z;
            return { x: sim.view.cx + v.x * s, y: sim.view.cy - v.y * s, s, z };
        }

        function fmtNum(v, d) {
            return Number(v).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
        }
        function earthSpinTurns(displayMinute) {
            const m = Number.isFinite(displayMinute) ? displayMinute : 0;
            return earthSpinPhaseTurns + m / EARTH_ROT.solarDayMin;
        }
        function drawTexturedDisc(ctx, img, x, y, r, spinTurns) {
            if (!img || !img.complete || img.naturalWidth < 2 || img.naturalHeight < 2) return false;
            const imgW = img.naturalWidth;
            const imgH = img.naturalHeight;
            const hemiW = Math.max(2, Math.min(imgW, Math.round(imgH)));
            let turns = Number.isFinite(spinTurns) ? spinTurns : 0;
            turns = turns - Math.floor(turns);
            const centerPx = turns * imgW;
            let sx = Math.floor(centerPx - hemiW * 0.5);
            while (sx < 0) sx += imgW;
            while (sx >= imgW) sx -= imgW;

            ctx.save();
            circle(ctx, x, y, r);
            ctx.clip();
            if (sx + hemiW <= imgW) {
                ctx.drawImage(img, sx, 0, hemiW, imgH, x - r, y - r, r * 2, r * 2);
            } else {
                const partA = imgW - sx;
                const partB = hemiW - partA;
                const dstA = (partA / hemiW) * (r * 2);
                ctx.drawImage(img, sx, 0, partA, imgH, x - r, y - r, dstA, r * 2);
                ctx.drawImage(img, 0, 0, partB, imgH, x - r + dstA, y - r, r * 2 - dstA, r * 2);
            }
            ctx.restore();
            return true;
        }
        function sampleEquirectTex(tex, nx, ny, nz, spinTurns) {
            if (!tex || !tex.ready || !tex.data) return null;
            const lon = Math.atan2(nx, nz);
            const lat = Math.asin(clamp(ny, -1, 1));
            let u = (Number.isFinite(spinTurns) ? spinTurns : 0) + lon / (Math.PI * 2) + 0.5;
            let v = 0.5 - lat / Math.PI;
            u = u - Math.floor(u);
            v = clamp(v, 0, 1);
            const x = Math.min(tex.w - 1, Math.max(0, Math.floor(u * (tex.w - 1))));
            const y = Math.min(tex.h - 1, Math.max(0, Math.floor(v * (tex.h - 1))));
            const o = (y * tex.w + x) * 4;
            const td = tex.data;
            return { r: td[o], g: td[o + 1], b: td[o + 2] };
        }

       function renderFace(st) {
            const { w, h } = sizeCanvas(faceCanvas);
            const ctx = faceCanvas.getContext('2d');
            if (!ctx || w < 3 || h < 3) return;

            // ① 宇宙の背景色
            const bg = ctx.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, '#0b1320'); bg.addColorStop(1, '#03060b');
            ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

            const cx = w * 0.5, cy = h * 0.5, r = Math.min(w, h) * 0.28;

            // ====== 天頂を上にするための回転角度（パララクティック角） ======
            const lat = 32.83 * Math.PI / 180;
            const dec = 6.5 * Math.PI / 180;
            const H = (st.m - 390) * 0.25 * Math.PI / 180;
            const num = Math.sin(H);
            const den = Math.tan(lat) * Math.cos(dec) - Math.sin(dec) * Math.cos(H);
            const zenithAngle = Math.atan2(num, den);

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(zenithAngle);

            // ====== 影の座標計算 ======
            const offRight = st.p.y * orbitPerpAxis.y + st.p.z * orbitPerpAxis.z;
            const offUp = st.p.y * orbitAxis.y + st.p.z * orbitAxis.z;
            const sx = - (offRight / moonRer) * r;
            const sy = - (offUp / moonRer) * r; 

            // ====== ② 星空の描画（実際の星表データを使用） ======
            const moonApparentRadiusDeg = 0.258; // 月の視半径（約15.5分角）
            const scaleDegToPx = r / moonApparentRadiusDeg;
            
            // 食の最大(20:34 = 開始から214分)からの経過時間で、地球の影の正確な赤経・赤緯を計算
            // （太陽の動きに合わせて影も1日で約1度東へ、約0.38度南へ動くのを反映）
            const tOffset = st.m - OFFICIAL_EVENT_MIN.MAX;
            const currentShadowRa = 164.095 + tOffset * 0.000694;
            const currentShadowDec = 6.538 - tOffset * 0.000264;

            if (realStarsData && realStarsData.length > 0) {
                realStarsData.forEach(s => {
                    // 影の中心からのオフセット（度）
                    const dx = (s.ra_deg - currentShadowRa) * Math.cos(currentShadowDec * Math.PI / 180);
                    const dy = s.dec_deg - currentShadowDec;
                    
                    // 影のCanvas座標(sx, sy)を基準に星の位置を決定
                    // CanvasのX軸は右が正（西）、Y軸は下が正（南）
                    const px = sx - dx * scaleDegToPx;
                    const py = sy - dy * scaleDegToPx;
                    
                    // 画面内に収まる星のみ描画
                    if (px >= -w && px <= w*2 && py >= -h && py <= h*2) {
                        const mag = s.vmag || 6;
                        // 等級から星のサイズと透明度を計算（1等星が大きく明るく、暗い星ほど小さく）
                        const alpha = clamp(1.0 - (mag + 1.0) / 8.5, 0.15, 1.0);
                        const size = clamp(2.8 - mag * 0.3, 0.5, 3.5);
                        
                        ctx.fillStyle = `rgba(230, 240, 255, ${alpha.toFixed(3)})`;
                        ctx.beginPath();
                        ctx.arc(px, py, size, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });
            } else {
                // 読み込み前や失敗時は従来のランダム星空をフォールバックとして描画
                const areaSize = Math.max(w, h) * 2;
                sim.starsFace.forEach((s) => {
                    ctx.fillStyle = 'rgba(220,235,255,' + (s.a * 0.7).toFixed(3) + ')';
                    let px = (s.x * areaSize + sx) % areaSize;
                    let py = (s.y * areaSize + sy) % areaSize;
                    if (px < 0) px += areaSize;
                    if (py < 0) py += areaSize;
                    ctx.fillRect(px - areaSize / 2, py - areaSize / 2, s.s, s.s);
                });
            }

            // ====== ③ 月の画像と影の描画 ======
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.clip(); 
            
            if (moonImg.complete && moonImg.naturalWidth > 0) {
                ctx.drawImage(moonImg, -r, -r, r * 2, r * 2);
            } else {
                const moonGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.24, r * 0.16, 0, 0, r);
                moonGrad.addColorStop(0, '#fffef7'); moonGrad.addColorStop(0.55, '#d6d5cc'); moonGrad.addColorStop(1, '#91939d');
                ctx.fillStyle = moonGrad; ctx.fill();
            }

            ctx.globalCompositeOperation = 'multiply';

            // 半影
            const pR = r * (st.sh.penumbra / moonRer);
            const peEase = smoothstep(0.02, 0.98, st.peC);
            const pOuter = pR * 1.06;
            const pg = ctx.createRadialGradient(sx, sy, pR * 0.22, sx, sy, pOuter);
            pg.addColorStop(0, 'rgba(22,26,42,' + (0.16 + peEase * 0.28).toFixed(3) + ')');
            pg.addColorStop(0.62, 'rgba(16,20,34,' + (0.10 + peEase * 0.20).toFixed(3) + ')');
            pg.addColorStop(1, 'rgba(10,14,26,0.0)');
            ctx.fillStyle = pg;
            ctx.beginPath(); ctx.arc(sx, sy, pOuter, 0, Math.PI * 2); ctx.fill();

            // 本影
            const uR = r * (st.sh.umbra / moonRer);
            const umEase = smoothstep(0.01, 0.98, st.umC);
            const uOuter = uR * 1.05;
            const ug = ctx.createRadialGradient(sx, sy, Math.max(0.001, uR * 0.02), sx, sy, uOuter);
            ug.addColorStop(0, 'rgba(12,8,14,' + (0.84 + umEase * 0.12).toFixed(3) + ')');
            ug.addColorStop(0.48, 'rgba(16,8,14,' + (0.74 + umEase * 0.16).toFixed(3) + ')');
            ug.addColorStop(0.86, 'rgba(6,7,12,' + (0.78 + umEase * 0.10).toFixed(3) + ')');
            ug.addColorStop(1, 'rgba(2,4,10,0.0)');
            ctx.fillStyle = ug;
            ctx.beginPath(); ctx.arc(sx, sy, uOuter, 0, Math.PI * 2); ctx.fill();
            const coreR = Math.max(0.001, uR * 0.42);
            const uCore = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreR);
            uCore.addColorStop(0, 'rgba(8,6,12,' + (0.34 + umEase * 0.18).toFixed(3) + ')');
            uCore.addColorStop(1, 'rgba(8,6,12,0.0)');
            ctx.fillStyle = uCore;
            ctx.beginPath(); ctx.arc(sx, sy, coreR, 0, Math.PI * 2); ctx.fill();

            ctx.globalCompositeOperation = 'source-over';

            // 皆既中の赤銅色表現（本影領域を主対象にする）
            const totalityTone = smoothstep(0.16, 0.98, st.umC);
            if (uR > 1.2 && totalityTone > 0.001) {
                const redScope = Math.max(r * 0.2, uOuter * 1.08);
                const rg = ctx.createRadialGradient(
                    sx - uR * 0.1, sy - uR * 0.08, Math.max(0.001, uR * 0.08),
                    sx, sy, redScope
                );
                rg.addColorStop(0, 'rgba(176,70,38,' + (0.08 + totalityTone * 0.24).toFixed(3) + ')');
                rg.addColorStop(0.55, 'rgba(112,32,22,' + (0.10 + totalityTone * 0.30).toFixed(3) + ')');
                rg.addColorStop(1, 'rgba(70,16,14,0.0)');
                ctx.save();
                ctx.beginPath();
                ctx.arc(sx, sy, redScope, 0, Math.PI * 2);
                ctx.clip();
                ctx.fillStyle = rg;
                ctx.beginPath();
                ctx.arc(sx, sy, redScope, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            ctx.restore(); // 回転とクリッピングを解除

            // ====== ⑤ 枠線とステータステキスト ======
            ctx.strokeStyle = 'rgba(255,240,210,0.62)'; ctx.lineWidth = Math.max(1.1, r * 0.02);
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

            ctx.fillStyle = 'rgba(240,248,255,0.92)'; ctx.font = Math.max(12, Math.floor(w * 0.032)) + 'px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(st.stage, cx, h - Math.max(14, h * 0.05));
        }

        function render3D(st) {
            const { w, h } = sizeCanvas(viewCanvas);
            const ctx = viewCanvas.getContext('2d');
            if (!ctx || w < 3 || h < 3) return;
            ensureViewDistance('earth');
            sim.view.cx = w * 0.5; sim.view.cy = h * 0.54; sim.view.scale = Math.min(w, h) * 0.92;

            const bg = ctx.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, '#070d18'); bg.addColorStop(1, '#02050a'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
            sim.stars3d.forEach((s) => { ctx.fillStyle = 'rgba(190,215,255,' + (s.a * 0.55).toFixed(3) + ')'; ctx.fillRect(s.x * w, s.y * h, s.s, s.s); });

            function drawRingPath(ring) {
                if (!ring || !ring.length) return;
                ctx.beginPath();
                ctx.moveTo(ring[0].x, ring[0].y);
                for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
                ctx.closePath();
            }

            function drawShadowSolid(opts) {
                const seg = opts.segments || 28;
                const nearRing = [];
                const farRing = [];
                const useTip = opts.r1 <= 0.03;
                const nearCenter = proj(rot(disp({ x: opts.x0, y: 0, z: 0 })));
                const opaque = !!opts.opaque;

                function mulRgb(rgb, scale) {
                    return [
                        Math.max(0, Math.min(255, Math.round(rgb[0] * scale))),
                        Math.max(0, Math.min(255, Math.round(rgb[1] * scale))),
                        Math.max(0, Math.min(255, Math.round(rgb[2] * scale)))
                    ];
                }

                for (let i = 0; i < seg; i++) {
                    const a = (i / seg) * Math.PI * 2;
                    const near = proj(rot(disp({ x: opts.x0, y: Math.cos(a) * opts.r0, z: Math.sin(a) * opts.r0 })));
                    if (!near) return;
                    nearRing.push(near);

                    if (!useTip) {
                        const far = proj(rot(disp({ x: opts.x1, y: Math.cos(a) * opts.r1, z: Math.sin(a) * opts.r1 })));
                        if (!far) return;
                        farRing.push(far);
                    }
                }

                const tip = useTip ? proj(rot(disp({ x: opts.x1, y: 0, z: 0 }))) : null;
                if (useTip && !tip) return;
                const farCenter = useTip ? tip : proj(rot(disp({ x: opts.x1, y: 0, z: 0 })));

                const faces = [];
                for (let i = 0; i < seg; i++) {
                    const j = (i + 1) % seg;
                    const midA = ((i + 0.5) / seg) * Math.PI * 2;
                    const shade = 0.45 + 0.55 * Math.abs(Math.sin(midA - sim.view.yaw * 0.25));
                    const alpha = opaque ? 1 : (opts.alphaMin + (opts.alphaMax - opts.alphaMin) * shade);
                    const brightness = (typeof opts.brightnessMin === 'number' && typeof opts.brightnessMax === 'number')
                        ? (opts.brightnessMin + (opts.brightnessMax - opts.brightnessMin) * shade)
                        : 1;
                    const rgb = mulRgb(opts.rgb, brightness);

                    if (useTip) {
                        const p0 = nearRing[i];
                        const p1 = nearRing[j];
                        const p2 = tip;
                        const depth = (p0.z + p1.z + p2.z) / 3;
                        faces.push({ points: [p0, p1, p2], depth: depth, alpha: alpha, rgb: rgb });
                    } else {
                        const p0 = nearRing[i];
                        const p1 = nearRing[j];
                        const p2 = farRing[j];
                        const p3 = farRing[i];
                        const depth = (p0.z + p1.z + p2.z + p3.z) * 0.25;
                        faces.push({ points: [p0, p1, p2, p3], depth: depth, alpha: alpha, rgb: rgb });
                    }
                }

                if (opts.capNear && nearCenter) {
                    faces.push({
                        points: nearRing.slice(),
                        depth: nearCenter.z + 0.001,
                        alpha: (typeof opts.capNearAlpha === 'number') ? opts.capNearAlpha : (opaque ? 1 : opts.alphaMax),
                        rgb: opts.capRgb || opts.rgb
                    });
                }
                if (opts.capFar && !useTip && farCenter) {
                    faces.push({
                        points: farRing.slice(),
                        depth: farCenter.z - 0.001,
                        alpha: (typeof opts.capFarAlpha === 'number') ? opts.capFarAlpha : (opaque ? 1 : opts.alphaMax),
                        rgb: opts.capRgb || opts.rgb
                    });
                }

                faces.sort((a, b) => b.depth - a.depth);
                faces.forEach((face) => {
                    ctx.beginPath();
                    ctx.moveTo(face.points[0].x, face.points[0].y);
                    for (let i = 1; i < face.points.length; i++) ctx.lineTo(face.points[i].x, face.points[i].y);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(' + face.rgb[0] + ',' + face.rgb[1] + ',' + face.rgb[2] + ',' + face.alpha.toFixed(3) + ')';
                    ctx.fill();
                });

                ctx.strokeStyle = opts.edge;
                ctx.lineWidth = Math.max(0.8, w * 0.0018);
                drawRingPath(nearRing);
                ctx.stroke();
                if (!useTip) {
                    drawRingPath(farRing);
                    ctx.stroke();
                }

                const guides = 4;
                for (let k = 0; k < guides; k++) {
                    const idx = Math.floor((k / guides) * seg) % seg;
                    const a = nearRing[idx];
                    const b = useTip ? tip : farRing[idx];
                    if (!a || !b) continue;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }

            const penumbraEndX = Math.min(CFG.shadowLenEr + 20, SHADOW_GEOM.umbraLengthEr * 0.65);
            const penumbraEndR = 1 + penumbraEndX * SHADOW_GEOM.penumbraSlopeEr;
            const umbraCylinderEndX = 14;
            // 要望: 本影円錐の長さを半影と同じ長さにする
            const umbraConeEndX = penumbraEndX;
            const umbraConeEndR = Math.max(0.03, 1 - umbraConeEndX * SHADOW_GEOM.umbraSlopeEr);

            drawShadowSolid({
                x0: 0.2, r0: 1.0,
                x1: penumbraEndX, r1: penumbraEndR,
                segments: 30,
                rgb: [124, 154, 220],
                alphaMin: 0.02,
                alphaMax: 0.07,
                edge: 'rgba(126,172,235,0.22)'
            });

            drawShadowSolid({
                x0: 0.2, r0: 1.0,
                x1: umbraCylinderEndX, r1: 1.0,
                segments: 26,
                rgb: [30, 24, 74],
                opaque: true,
                brightnessMin: 0.76,
                brightnessMax: 1.0,
                alphaMin: 1,
                alphaMax: 1,
                edge: 'rgba(112,102,196,0.45)',
                capNear: true,
                capFar: true,
                capNearAlpha: 1,
                capFarAlpha: 1,
                capRgb: [20, 16, 54]
            });

            drawShadowSolid({
                x0: umbraCylinderEndX, r0: 1.0,
                x1: umbraConeEndX, r1: umbraConeEndR,
                segments: 26,
                rgb: [36, 28, 88],
                opaque: true,
                brightnessMin: 0.74,
                brightnessMax: 1.0,
                alphaMin: 1,
                alphaMax: 1,
                edge: 'rgba(124,108,214,0.42)',
                capNear: true,
                capNearAlpha: 1,
                capRgb: [22, 18, 60]
            });

            const sunA = proj(rot(disp({ x: -26, y: 0, z: 0 }))), sunB = proj(rot(disp({ x: -2, y: 0, z: 0 })));
            if (sunA && sunB) {
                ctx.strokeStyle = 'rgba(255,208,110,0.85)'; ctx.lineWidth = Math.max(1.2, w * 0.003);
                ctx.beginPath(); ctx.moveTo(sunA.x, sunA.y); ctx.lineTo(sunB.x, sunB.y); ctx.stroke();
            }

            ctx.strokeStyle = 'rgba(125,198,255,0.52)'; ctx.lineWidth = Math.max(1.1, w * 0.0024); ctx.beginPath();
            let started = false;
            for (let i = 0; i <= 64; i++) {
                const q = proj(rot(disp(moonPos(mapDisplayToModelMinute((i / 64) * CFG.durationMin)))));
                if (!q) continue;
                if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
            }
            if (started) ctx.stroke();

            function sphere(center, rEr, colors, label) {
                const c3 = rot(disp(center)), c2 = proj(c3);
                if (!c2) return null;
                const rp = rEr * CFG.scaleYZ * c2.s;
                if (rp < 0.7) return null;
                return { z: c3.z, draw: function () {
                    const g = ctx.createRadialGradient(c2.x - rp * 0.36, c2.y - rp * 0.18, rp * 0.14, c2.x, c2.y, rp);
                    g.addColorStop(0, colors[0]); g.addColorStop(0.58, colors[1]); g.addColorStop(1, colors[2]);
                    ctx.fillStyle = g; circle(ctx, c2.x, c2.y, rp); ctx.fill();
                    ctx.strokeStyle = colors[3]; ctx.lineWidth = Math.max(1.1, rp * 0.055); ctx.stroke();
                    ctx.fillStyle = 'rgba(236,242,255,0.9)'; ctx.font = Math.max(11, Math.floor(w * 0.018)) + 'px sans-serif'; ctx.textAlign = 'center';
                    ctx.fillText(label, c2.x, c2.y - rp - 8);
                } };
            }
            function texturedSphere(center, rEr, textureImg, fallbackColors, label, spinTurns) {
                const c3 = rot(disp(center)), c2 = proj(c3);
                if (!c2) return null;
                const rp = rEr * CFG.scaleYZ * c2.s;
                if (rp < 0.7) return null;
                return { z: c3.z, draw: function () {
                    const textured = drawTexturedDisc(ctx, textureImg, c2.x, c2.y, rp, spinTurns);
                    if (!textured) {
                        const g = ctx.createRadialGradient(c2.x - rp * 0.36, c2.y - rp * 0.18, rp * 0.14, c2.x, c2.y, rp);
                        g.addColorStop(0, fallbackColors[0]); g.addColorStop(0.58, fallbackColors[1]); g.addColorStop(1, fallbackColors[2]);
                        ctx.fillStyle = g; circle(ctx, c2.x, c2.y, rp); ctx.fill();
                    }
                    ctx.save();
                    circle(ctx, c2.x, c2.y, rp);
                    ctx.clip();
                    const shade = ctx.createLinearGradient(c2.x - rp * 1.05, c2.y - rp * 1.05, c2.x + rp * 1.05, c2.y + rp * 1.05);
                    shade.addColorStop(0, 'rgba(255,255,255,0.22)');
                    shade.addColorStop(0.52, 'rgba(0,0,0,0.0)');
                    shade.addColorStop(1, 'rgba(0,0,0,0.52)');
                    ctx.fillStyle = shade;
                    circle(ctx, c2.x, c2.y, rp);
                    ctx.fill();
                    ctx.restore();
                    ctx.strokeStyle = fallbackColors[3];
                    ctx.lineWidth = Math.max(1.1, rp * 0.055);
                    circle(ctx, c2.x, c2.y, rp);
                    ctx.stroke();
                    ctx.fillStyle = 'rgba(236,242,255,0.9)';
                    ctx.font = Math.max(11, Math.floor(w * 0.018)) + 'px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(label, c2.x, c2.y - rp - 8);
                } };
            }

            const moonTone = smoothstep(0.18, 0.95, st.umC);
            const moonCore = mixRgbHex('#f0f0f0', '#deab86', moonTone);
            const moonMid = mixRgbHex('#9ea4ad', '#8f4a36', moonTone);
            const moonRim = mixRgbHex('#3e434b', '#2f1713', moonTone);
            const moonEdge = mixRgbHex('#f2f5ff', '#ffa684', moonTone);
            const moonColors = [
                rgbCss(moonCore),
                rgbCss(moonMid),
                rgbCss(moonRim),
                rgbaCss(moonEdge, lerp(0.45, 0.58, moonTone))
            ];
            const earthFallbackColors = ['#8bc0ff', '#3568a3', '#102848', 'rgba(165,208,255,0.65)'];
            const items = [
                texturedSphere({ x: 0, y: 0, z: 0 }, 1, earthColorImg, earthFallbackColors, 'Earth', earthSpinTurns(st.m)),
                sphere(st.p, moonRer, moonColors, 'Moon')
            ].filter(Boolean).sort((a, b) => b.z - a.z);
            items.forEach((it) => it.draw());
        }

        
        function renderEarthCentric(st) {
            const { w, h } = sizeCanvas(viewCanvas);
            const ctx = viewCanvas.getContext('2d');
            if (!ctx || w < 3 || h < 3) return;

            // ============================================================
            // Earth-centric view (re-built from scratch)
            // ------------------------------------------------------------
            //  - Geometry stays in one WORLD frame (Earth at origin).
            //  - Camera orbits Earth with yaw/pitch.
            //  - Right-handed camera basis (fixes mirrored/incorrect rotation).
            //
            // WORLD frame:
            //   sunAxis       : +X points away from the Sun (shadow axis)
            //   eclipticNorth : +Y
            //   +Z completes RHS
            //   earthSpinAxis : tilted axis in WORLD
            // ============================================================

            // ---- background ----
            const bg = ctx.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, '#070d18');
            bg.addColorStop(1, '#02050a');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);
            sim.stars3d.forEach((s) => {
                ctx.fillStyle = 'rgba(190,215,255,' + (s.a * 0.55).toFixed(3) + ')';
                ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
            });

            // ---- camera (orbit around Earth) ----
            const cx = w * 0.5;
            const cy = h * 0.54;
            const focal = Math.min(w, h) * MOON_VIEW.focalScale;

            const camDist = ensureViewDistance('earth'); // in Earth radii
            const upWorld = earthSpinAxis;

            // Start from anti-sun direction so the shadow cone is visible.
            const baseDir = normalize(add(scale(sunAxis, -1), scale(eclipticNorth, 0.22)));

            // Yaw about Earth's spin axis.
            const dirYaw = rotateAroundAxis(baseDir, upWorld, sim.view.yaw);

            // Pitch about camera-right axis (computed from the yawed direction).
            let pitchAxis = cross(dirYaw, upWorld);
            if (Math.hypot(pitchAxis.x, pitchAxis.y, pitchAxis.z) < 1e-6) {
                pitchAxis = cross(dirYaw, { x: 0, y: 0, z: 1 });
            }
            pitchAxis = normalize(pitchAxis);

            const camDir = rotateAroundAxis(dirYaw, pitchAxis, sim.view.pitch);
            const camPos = scale(camDir, camDist);

            // Camera basis (RIGHT-HANDED)
            const camForward = normalize(scale(camPos, -1));
            let camRight = cross(camForward, upWorld); // forward × up
            if (Math.hypot(camRight.x, camRight.y, camRight.z) < 1e-6) {
                camRight = cross(camForward, { x: 0, y: 0, z: 1 });
            }
            camRight = normalize(camRight);
            const camUp = normalize(cross(camRight, camForward)); // right × forward

            function toCam(vWorld) {
                return {
                    x: dot(vWorld, camRight),
                    y: dot(vWorld, camUp),
                    z: dot(vWorld, camForward)
                };
            }
            function projectPoint(pWorld) {
                const rel = sub(pWorld, camPos);
                const c = toCam(rel);
                if (c.z <= 0.05) return null;
                return {
                    x: cx + (c.x * focal) / c.z,
                    y: cy - (c.y * focal) / c.z,
                    z: c.z
                };
            }
            function projectRadius(centerWorld, radiusWorld) {
                const rel = sub(centerWorld, camPos);
                const dist = Math.hypot(rel.x, rel.y, rel.z);
                if (dist <= radiusWorld + 1e-6) return null;
                const denom = Math.sqrt(Math.max(1e-9, dist * dist - radiusWorld * radiusWorld));
                return (focal * radiusWorld) / denom;
            }
            function drawProjectedEarthTexture(centerWorld, radiusWorld, cp, rp, spinTurns) {
                if (!earthTex.ready || !earthTex.data || !cp || !Number.isFinite(rp) || rp < 1.1) return false;

                const centerCam = toCam(sub(centerWorld, camPos));
                const centerCamLen2 = centerCam.x * centerCam.x + centerCam.y * centerCam.y + centerCam.z * centerCam.z;
                const radius2 = radiusWorld * radiusWorld;
                if (centerCamLen2 <= radius2 + 1e-6) return false;

                const px0 = Math.max(0, Math.floor(cp.x - rp - 1));
                const py0 = Math.max(0, Math.floor(cp.y - rp - 1));
                const px1 = Math.min(w, Math.ceil(cp.x + rp + 1));
                const py1 = Math.min(h, Math.ceil(cp.y + rp + 1));
                const iw = Math.max(1, px1 - px0);
                const ih = Math.max(1, py1 - py0);
                const image = ctx.getImageData(px0, py0, iw, ih);
                const data = image.data;

                for (let iy = 0; iy < ih; iy++) {
                    const sy = py0 + iy + 0.5;
                    for (let ix = 0; ix < iw; ix++) {
                        const sx = px0 + ix + 0.5;
                        const dx = (sx - cx) / focal;
                        const dy = (cy - sy) / focal;
                        const invLen = 1 / Math.hypot(dx, dy, 1);
                        const dirCam = { x: dx * invLen, y: dy * invLen, z: invLen };

                        const rayToCenter = dirCam.x * centerCam.x + dirCam.y * centerCam.y + dirCam.z * centerCam.z;
                        const disc = rayToCenter * rayToCenter - (centerCamLen2 - radius2);
                        if (disc <= 0) continue;
                        const t = rayToCenter - Math.sqrt(disc);
                        if (t <= 0) continue;

                        const hitCam = { x: dirCam.x * t, y: dirCam.y * t, z: dirCam.z * t };
                        const nCam = normalize({
                            x: hitCam.x - centerCam.x,
                            y: hitCam.y - centerCam.y,
                            z: hitCam.z - centerCam.z
                        });
                        const nWorld = normalize({
                            x: camRight.x * nCam.x + camUp.x * nCam.y + camForward.x * nCam.z,
                            y: camRight.y * nCam.x + camUp.y * nCam.y + camForward.y * nCam.z,
                            z: camRight.z * nCam.x + camUp.z * nCam.y + camForward.z * nCam.z
                        });

                        // Texture lookup frame: un-tilt Earth axis back to ecliptic Y, then apply spin phase.
                        const nTex = rotateAroundAxis(nWorld, sunAxis, -AXIS_REF.earthTiltRad);
                        const tex = sampleEquirectTex(earthTex, nTex.x, nTex.y, nTex.z, spinTurns);
                        if (!tex) continue;

                        const lambert = Math.max(0, -nWorld.x);
                        const ambient = 0.16;
                        const light = ambient + (1 - ambient) * Math.pow(lambert, 0.9);

                        const o = (iy * iw + ix) * 4;
                        data[o] = Math.round(clamp(tex.r * light, 0, 255));
                        data[o + 1] = Math.round(clamp(tex.g * light, 0, 255));
                        data[o + 2] = Math.round(clamp(tex.b * light, 0, 255));
                        data[o + 3] = 255;
                    }
                }

                ctx.putImageData(image, px0, py0);
                return true;
            }

            // ---- shadow cone/cylinder solid in WORLD ----
            function drawRingPath(ring) {
                if (!ring || !ring.length) return;
                ctx.beginPath();
                ctx.moveTo(ring[0].x, ring[0].y);
                for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
                ctx.closePath();
            }
            function drawShadowSolid(opts) {
                const seg = opts.segments || 28;
                const nearRing = [];
                const farRing = [];
                const useTip = opts.r1 <= 0.03;
                const nearCenter = projectPoint({ x: opts.x0, y: 0, z: 0 });
                const opaque = !!opts.opaque;

                function mulRgb(rgb, s) {
                    return [
                        Math.max(0, Math.min(255, Math.round(rgb[0] * s))),
                        Math.max(0, Math.min(255, Math.round(rgb[1] * s))),
                        Math.max(0, Math.min(255, Math.round(rgb[2] * s)))
                    ];
                }

                for (let i = 0; i < seg; i++) {
                    const a = (i / seg) * Math.PI * 2;
                    const near = projectPoint({ x: opts.x0, y: Math.cos(a) * opts.r0, z: Math.sin(a) * opts.r0 });
                    if (!near) return;
                    nearRing.push(near);
                    if (!useTip) {
                        const far = projectPoint({ x: opts.x1, y: Math.cos(a) * opts.r1, z: Math.sin(a) * opts.r1 });
                        if (!far) return;
                        farRing.push(far);
                    }
                }

                const tip = useTip ? projectPoint({ x: opts.x1, y: 0, z: 0 }) : null;
                if (useTip && !tip) return;
                const farCenter = useTip ? tip : projectPoint({ x: opts.x1, y: 0, z: 0 });

                const faces = [];
                for (let i = 0; i < seg; i++) {
                    const j = (i + 1) % seg;
                    const midA = ((i + 0.5) / seg) * Math.PI * 2;
                    const shade = 0.45 + 0.55 * Math.abs(Math.sin(midA - sim.view.yaw * 0.25));
                    const alpha = opaque ? 1 : (opts.alphaMin + (opts.alphaMax - opts.alphaMin) * shade);
                    const brightness = (typeof opts.brightnessMin === 'number' && typeof opts.brightnessMax === 'number')
                        ? (opts.brightnessMin + (opts.brightnessMax - opts.brightnessMin) * shade)
                        : 1;
                    const rgb = mulRgb(opts.rgb, brightness);
                    if (useTip) {
                        const p0 = nearRing[i];
                        const p1 = nearRing[j];
                        const p2 = tip;
                        const depth = (p0.z + p1.z + p2.z) / 3;
                        faces.push({ points: [p0, p1, p2], depth: depth, alpha: alpha, rgb: rgb });
                    } else {
                        const p0 = nearRing[i];
                        const p1 = nearRing[j];
                        const p2 = farRing[j];
                        const p3 = farRing[i];
                        const depth = (p0.z + p1.z + p2.z + p3.z) * 0.25;
                        faces.push({ points: [p0, p1, p2, p3], depth: depth, alpha: alpha, rgb: rgb });
                    }
                }

                if (opts.capNear && nearCenter) {
                    faces.push({
                        points: nearRing.slice(),
                        depth: nearCenter.z + 0.001,
                        alpha: (typeof opts.capNearAlpha === 'number') ? opts.capNearAlpha : (opaque ? 1 : opts.alphaMax),
                        rgb: opts.capRgb || opts.rgb
                    });
                }
                if (opts.capFar && !useTip && farCenter) {
                    faces.push({
                        points: farRing.slice(),
                        depth: farCenter.z - 0.001,
                        alpha: (typeof opts.capFarAlpha === 'number') ? opts.capFarAlpha : (opaque ? 1 : opts.alphaMax),
                        rgb: opts.capRgb || opts.rgb
                    });
                }

                faces.sort((a, b) => b.depth - a.depth);
                faces.forEach((face) => {
                    ctx.beginPath();
                    ctx.moveTo(face.points[0].x, face.points[0].y);
                    for (let i = 1; i < face.points.length; i++) ctx.lineTo(face.points[i].x, face.points[i].y);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(' + face.rgb[0] + ',' + face.rgb[1] + ',' + face.rgb[2] + ',' + face.alpha.toFixed(3) + ')';
                    ctx.fill();
                });

                ctx.strokeStyle = opts.edge;
                ctx.lineWidth = Math.max(0.8, w * 0.0018);
                drawRingPath(nearRing);
                ctx.stroke();
                if (!useTip) {
                    drawRingPath(farRing);
                    ctx.stroke();
                }

                const guideCount = Math.max(0, Math.floor(opts.guides || 0));
                if (guideCount > 0) {
                    const guideAlpha = clamp(
                        Number.isFinite(opts.guideAlpha) ? opts.guideAlpha : 0.6,
                        0,
                        1
                    );
                    ctx.strokeStyle = opts.guide || opts.edge;
                    ctx.globalAlpha = guideAlpha;
                    ctx.lineWidth = Math.max(0.7, w * 0.0015);
                    for (let k = 0; k < guideCount; k++) {
                        const idx = Math.floor((k / guideCount) * seg) % seg;
                        const a = nearRing[idx];
                        const b = useTip ? tip : farRing[idx];
                        if (!a || !b) continue;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                }
            }
            function drawProjectedRing(xEr, rEr, strokeStyle, lineWidth, dash) {
                const seg = 64;
                const ring = [];
                for (let i = 0; i < seg; i++) {
                    const a = (i / seg) * Math.PI * 2;
                    const q = projectPoint({ x: xEr, y: Math.cos(a) * rEr, z: Math.sin(a) * rEr });
                    if (!q) return;
                    ring.push(q);
                }
                if (dash && typeof ctx.setLineDash === 'function') ctx.setLineDash(dash);
                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = lineWidth;
                drawRingPath(ring);
                ctx.stroke();
                if (dash && typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
            }
            function drawShadowText(xEr, rEr, angleRad, text, color) {
                const p = projectPoint({
                    x: xEr,
                    y: Math.cos(angleRad) * rEr,
                    z: Math.sin(angleRad) * rEr
                });
                if (!p) return;
                ctx.fillStyle = color;
                ctx.font = Math.max(10, Math.floor(w * 0.016)) + 'px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(text, p.x + 8, p.y - 6);
            }

            const penumbraEndX = Math.min(CFG.shadowLenEr + 20, SHADOW_GEOM.umbraLengthEr * 0.65);
            const penumbraEndR = 1 + penumbraEndX * SHADOW_GEOM.penumbraSlopeEr;
            const umbraCylinderEndX = 14;
            const umbraConeEndX = penumbraEndX;
            const umbraConeEndR = Math.max(0.03, 1 - umbraConeEndX * SHADOW_GEOM.umbraSlopeEr);

            drawShadowSolid({
                x0: 0.2, r0: 1.0,
                x1: penumbraEndX, r1: penumbraEndR,
                segments: 30,
                rgb: [14, 16, 20],
                alphaMin: 0.014,
                alphaMax: 0.052,
                edge: 'rgba(72,76,88,0.42)',
                guides: 10,
                guide: 'rgba(90,96,112,0.50)',
                guideAlpha: 0.48
            });

            drawShadowSolid({
                x0: 0.2, r0: 1.0,
                x1: umbraCylinderEndX, r1: 1.0,
                segments: 26,
                rgb: [56, 14, 14],
                opaque: true,
                brightnessMin: 0.54,
                brightnessMax: 0.80,
                alphaMin: 1,
                alphaMax: 1,
                edge: 'rgba(152,62,58,0.72)',
                capNear: true,
                capFar: true,
                capNearAlpha: 1,
                capFarAlpha: 1,
                capRgb: [42, 10, 10],
                guides: 8,
                guide: 'rgba(176,84,78,0.58)',
                guideAlpha: 0.56
            });

            drawShadowSolid({
                x0: umbraCylinderEndX, r0: 1.0,
                x1: umbraConeEndX, r1: umbraConeEndR,
                segments: 26,
                rgb: [68, 18, 14],
                opaque: true,
                brightnessMin: 0.52,
                brightnessMax: 0.78,
                alphaMin: 1,
                alphaMax: 1,
                edge: 'rgba(170,74,62,0.74)',
                capNear: true,
                capNearAlpha: 1,
                capRgb: [48, 12, 10],
                guides: 8,
                guide: 'rgba(192,92,76,0.60)',
                guideAlpha: 0.58
            });

            const shadowNowX = st.p.x;
            drawProjectedRing(
                shadowNowX,
                st.sh.penumbra,
                'rgba(96,102,118,0.90)',
                Math.max(1.2, w * 0.002),
                [Math.max(4, w * 0.006), Math.max(3, w * 0.0045)]
            );
            drawProjectedRing(
                shadowNowX,
                st.sh.umbra,
                'rgba(188,102,90,0.96)',
                Math.max(1.3, w * 0.0022),
                null
            );
            drawShadowText(shadowNowX, st.sh.penumbra, Math.PI * 0.14, 'Penumbra', 'rgba(122,130,148,0.90)');
            drawShadowText(shadowNowX, st.sh.umbra, Math.PI * 0.34, 'Umbra', 'rgba(212,126,112,0.94)');

            const axisNow = projectPoint({ x: shadowNowX, y: 0, z: 0 });
            const moonNow = projectPoint(st.p);
            if (axisNow && moonNow) {
                if (typeof ctx.setLineDash === 'function') {
                    ctx.setLineDash([Math.max(3, w * 0.005), Math.max(3, w * 0.005)]);
                }
                ctx.strokeStyle = st.inU
                    ? 'rgba(196,108,94,0.62)'
                    : (st.inP ? 'rgba(114,122,138,0.58)' : 'rgba(132,140,156,0.50)');
                ctx.lineWidth = Math.max(0.9, w * 0.00155);
                ctx.beginPath();
                ctx.moveTo(axisNow.x, axisNow.y);
                ctx.lineTo(moonNow.x, moonNow.y);
                ctx.stroke();
                if (typeof ctx.setLineDash === 'function') {
                    ctx.setLineDash([]);
                }
            }

            // Sun direction line (Sun is at WORLD -X)
            const sunFar = projectPoint({ x: -12, y: 0, z: 0 });
            const earth2 = projectPoint({ x: 0, y: 0, z: 0 });
            if (sunFar && earth2) {
                ctx.strokeStyle = 'rgba(255,208,110,0.65)';
                ctx.lineWidth = Math.max(1.0, w * 0.0022);
                ctx.beginPath();
                ctx.moveTo(sunFar.x, sunFar.y);
                ctx.lineTo(earth2.x, earth2.y);
                ctx.stroke();
            }

            // ---- orbit path (Moon trajectory) ----
            ctx.strokeStyle = 'rgba(125,198,255,0.44)';
            ctx.lineWidth = Math.max(1.0, w * 0.0022);
            ctx.beginPath();
            let started = false;
            for (let i = 0; i <= 72; i++) {
                const pos = moonPos(mapDisplayToModelMinute((i / 72) * CFG.durationMin));
                const q = projectPoint(pos);
                if (!q) continue;
                if (!started) { ctx.moveTo(q.x, q.y); started = true; }
                else ctx.lineTo(q.x, q.y);
            }
            if (started) ctx.stroke();

            // ---- bodies (Earth & Moon) ----
            const earthCenter = { x: 0, y: 0, z: 0 };
            const moonCenter = st.p;     // WORLD
            const moonRadius = moonRer;  // Earth radii

            function drawBodyDisc(centerWorld, radiusWorld, img, spinTurns, fallback, label, tintAlpha) {
                const cp = projectPoint(centerWorld);
                const rp = projectRadius(centerWorld, radiusWorld);
                if (!cp || !rp || rp < 1.1) return null;

                // glow
                const glow = ctx.createRadialGradient(cp.x, cp.y, rp * 0.7, cp.x, cp.y, rp * 3.0);
                glow.addColorStop(0, 'rgba(112,178,246,0.14)');
                glow.addColorStop(1, 'rgba(112,178,246,0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, rp * 3.0, 0, Math.PI * 2);
                ctx.fill();

                const textured = (img === earthColorImg)
                    ? drawProjectedEarthTexture(centerWorld, radiusWorld, cp, rp, spinTurns)
                    : drawTexturedDisc(ctx, img, cp.x, cp.y, rp, spinTurns);
                if (!textured) {
                    const g = ctx.createRadialGradient(cp.x - rp * 0.22, cp.y - rp * 0.2, rp * 0.12, cp.x, cp.y, rp);
                    g.addColorStop(0, fallback[0]);
                    g.addColorStop(0.62, fallback[1]);
                    g.addColorStop(1, fallback[2]);
                    ctx.fillStyle = g;
                    circle(ctx, cp.x, cp.y, rp);
                    ctx.fill();
                }

                // limb shading + eclipse tint
                ctx.save();
                circle(ctx, cp.x, cp.y, rp);
                ctx.clip();

                const shade = ctx.createLinearGradient(cp.x - rp, cp.y - rp, cp.x + rp, cp.y + rp);
                shade.addColorStop(0, 'rgba(255,255,255,0.18)');
                shade.addColorStop(0.52, 'rgba(0,0,0,0)');
                shade.addColorStop(1, 'rgba(0,0,0,0.45)');
                ctx.fillStyle = shade;
                circle(ctx, cp.x, cp.y, rp);
                ctx.fill();

                if (tintAlpha > 0.001) {
                    ctx.fillStyle = 'rgba(166,62,42,' + tintAlpha.toFixed(3) + ')';
                    circle(ctx, cp.x, cp.y, rp);
                    ctx.fill();
                }
                ctx.restore();

                ctx.strokeStyle = fallback[3];
                ctx.lineWidth = Math.max(1, rp * 0.04);
                circle(ctx, cp.x, cp.y, rp);
                ctx.stroke();

                ctx.fillStyle = 'rgba(226,238,255,0.92)';
                ctx.font = Math.max(10, Math.floor(w * 0.018)) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(label, cp.x, cp.y - rp - 7);

                return { z: cp.z };
            }

            const earthP = projectPoint(earthCenter);
            const moonP = projectPoint(moonCenter);

            const moonTone = smoothstep(0.18, 0.95, st.umC);
            const moonTint = lerp(0.0, 0.24, moonTone);
            const moonTexImg = (moonColorImg.complete && moonColorImg.naturalWidth > 0) ? moonColorImg : moonImg;

            const drawOrder = [
                { key: 'earth', z: earthP ? earthP.z : 0 },
                { key: 'moon', z: moonP ? moonP.z : 0 }
            ].sort((a, b) => b.z - a.z);

            for (const it of drawOrder) {
                if (it.key === 'earth') {
                    drawBodyDisc(
                        earthCenter,
                        1.0,
                        earthColorImg,
                        earthSpinTurns(st.m),
                        ['#cde7ff', '#6ea8df', '#244778', 'rgba(203,232,255,0.85)'],
                        'Earth',
                        0
                    );
                } else {
                    drawBodyDisc(
                        moonCenter,
                        moonRadius,
                        moonTexImg,
                        0,
                        ['#f0f0f0', '#9ea4ad', '#3e434b', 'rgba(242,245,255,0.58)'],
                        'Moon',
                        moonTint
                    );
                }
            }
        }


        function renderMoonCentric(st) {
            if (!moonCentricCanvas) return;
            const { w, h } = sizeCanvas(moonCentricCanvas);
            const ctx = moonCentricCanvas.getContext('2d');
            if (!ctx || w < 3 || h < 3) return;

            const cx = w * 0.5;
            const cy = h * 0.54;
            const focal = Math.min(w, h) * MOON_VIEW.focalScale;
            const degToRad = Math.PI / 180;

            const bg = ctx.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, '#070d18');
            bg.addColorStop(1, '#02050a');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);
            sim.stars3d.forEach((s) => {
                ctx.fillStyle = 'rgba(190,215,255,' + (s.a * 0.55).toFixed(3) + ')';
                ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
            });

            const camDist = ensureViewDistance('moon');
            const camPos = rotateMoonLocal({ x: 0, y: 0, z: camDist }, sim.moonView.yaw, sim.moonView.pitch);
            const camToMoon = normalize({ x: -camPos.x, y: -camPos.y, z: -camPos.z });
            const moonToCam = normalize(camPos);
            let worldUp = { x: 0, y: 1, z: 0 };
            let camRight = cross(worldUp, camToMoon);
            if (Math.hypot(camRight.x, camRight.y, camRight.z) < 1e-6) {
                worldUp = { x: 0, y: 0, z: 1 };
                camRight = cross(worldUp, camToMoon);
            }
            camRight = normalize(camRight);
            const camUp = normalize(cross(camToMoon, camRight));

            function toCamVec(v) {
                return { x: dot(v, camRight), y: dot(v, camUp), z: dot(v, camToMoon) };
            }
            function projectPoint(p) {
                const rel = { x: p.x - camPos.x, y: p.y - camPos.y, z: p.z - camPos.z };
                const c = toCamVec(rel);
                if (c.z <= 0.04) return null;
                return { x: cx + (c.x * focal) / c.z, y: cy - (c.y * focal) / c.z, z: c.z };
            }
            function projectRadius(center, radius) {
                const cp = projectPoint(center);
                if (!cp) return null;
                // Use apparent angular radius (exact for perspective), not small-angle r/z.
                const rel = { x: center.x - camPos.x, y: center.y - camPos.y, z: center.z - camPos.z };
                const dist = Math.hypot(rel.x, rel.y, rel.z);
                if (dist <= radius + 1e-6) return null;
                const denom = Math.sqrt(Math.max(1e-9, dist * dist - radius * radius));
                return (focal * radius) / denom;
            }
            function projectSurface(v) {
                const p = projectPoint(v);
                if (!p) return null;
                return { x: p.x, y: p.y, visible: dot(v, moonToCam) > 0 };
            }
            function drawGeoCurve(pointAt, segments, color, width) {
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.beginPath();
                let drawing = false;
                for (let i = 0; i <= segments; i++) {
                    const p = projectSurface(pointAt(i / segments));
                    if (p && p.visible) {
                        if (!drawing) {
                            ctx.moveTo(p.x, p.y);
                            drawing = true;
                        } else {
                            ctx.lineTo(p.x, p.y);
                        }
                    } else {
                        drawing = false;
                    }
                }
                ctx.stroke();
            }
            function drawSkyBody(center, radius3d, palette, label, textureImg, spinTurns) {
                const cp = projectPoint(center);
                const rp = projectRadius(center, radius3d);
                if (!cp || !rp || rp < 0.8) return;

                const glow = ctx.createRadialGradient(cp.x, cp.y, rp * 0.8, cp.x, cp.y, rp * 4.4);
                glow.addColorStop(0, palette.glowInner);
                glow.addColorStop(1, palette.glowOuter);
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, rp * 4.4, 0, Math.PI * 2);
                ctx.fill();

                const textured = drawTexturedDisc(ctx, textureImg, cp.x, cp.y, rp, spinTurns);
                if (!textured) {
                    const g = ctx.createRadialGradient(cp.x - rp * 0.2, cp.y - rp * 0.22, rp * 0.15, cp.x, cp.y, rp);
                    g.addColorStop(0, palette.core);
                    g.addColorStop(0.62, palette.mid);
                    g.addColorStop(1, palette.edge);
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(cp.x, cp.y, rp, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.save();
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, rp, 0, Math.PI * 2);
                ctx.clip();
                const shade = ctx.createLinearGradient(cp.x - rp, cp.y - rp, cp.x + rp, cp.y + rp);
                shade.addColorStop(0, 'rgba(255,255,255,0.18)');
                shade.addColorStop(0.52, 'rgba(0,0,0,0)');
                shade.addColorStop(1, 'rgba(0,0,0,0.42)');
                ctx.fillStyle = shade;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, rp, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                ctx.strokeStyle = palette.ring;
                ctx.lineWidth = Math.max(0.8, rp * 0.11);
                ctx.stroke();

                ctx.fillStyle = palette.label;
                ctx.font = Math.max(10, Math.floor(w * 0.019)) + 'px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(label, cp.x + Math.max(4, rp * 0.9), cp.y - Math.max(4, rp * 0.75));
            }

            const earthLocal = moonLocalFromWorld(normalize({ x: -st.p.x, y: -st.p.y, z: -st.p.z }));
            const sunLocal = moonLocalFromWorld(normalize({ x: -1, y: 0, z: 0 }));
            const erToMoonR = 1 / moonRer;
            const moonDistEr = Math.hypot(st.p.x, st.p.y, st.p.z);
            const earthDistMoonR = moonDistEr * erToMoonR;
            const earthCenter = {
                x: earthLocal.x * earthDistMoonR,
                y: earthLocal.y * earthDistMoonR,
                z: earthLocal.z * earthDistMoonR
            };
            const sunDistMoonR = SHADOW_GEOM.earthSunDistanceEr * erToMoonR;
            const sunCenter = {
                x: sunLocal.x * sunDistMoonR,
                y: sunLocal.y * sunDistMoonR,
                z: sunLocal.z * sunDistMoonR
            };
            const earthRadius3d = erToMoonR;
            const sunRadius3d = SHADOW_GEOM.sunRer * erToMoonR;

            drawSkyBody(sunCenter, sunRadius3d, {
                core: 'rgba(255,245,210,0.98)',
                mid: 'rgba(255,214,132,0.95)',
                edge: 'rgba(255,168,78,0.9)',
                ring: 'rgba(255,228,178,0.92)',
                glowInner: 'rgba(255,205,112,0.24)',
                glowOuter: 'rgba(255,180,90,0.0)',
                label: 'rgba(255,236,190,0.92)'
            }, 'Sun');
            drawSkyBody(earthCenter, earthRadius3d, {
                core: 'rgba(205,236,255,0.98)',
                mid: 'rgba(120,186,240,0.96)',
                edge: 'rgba(46,92,148,0.94)',
                ring: 'rgba(198,232,255,0.9)',
                glowInner: 'rgba(98,164,240,0.18)',
                glowOuter: 'rgba(98,164,240,0.0)',
                label: 'rgba(214,236,255,0.92)'
            }, 'Earth', earthColorImg, earthSpinTurns(st.m));

            // Draw Earth shadow in moon-radii coordinates (isotropic physical scale).
            const shadowAxisLocal = normalize(moonLocalFromWorld(sunAxis));
            let shadowRadialU = cross(shadowAxisLocal, { x: 0, y: 1, z: 0 });
            if (Math.hypot(shadowRadialU.x, shadowRadialU.y, shadowRadialU.z) < 1e-6) {
                shadowRadialU = cross(shadowAxisLocal, { x: 0, y: 0, z: 1 });
            }
            shadowRadialU = normalize(shadowRadialU);
            const shadowRadialV = normalize(cross(shadowRadialU, shadowAxisLocal));
            const shadowNearClipZ = 0.03;

            const localPerEr = 1 / moonRer;
            const localPerErX = localPerEr;
            const localPerErR = localPerEr;

            function shadowPointAt(xEr, rEr, angleRad) {
                const c = add(earthCenter, scale(shadowAxisLocal, xEr * localPerErX));
                return add(
                    c,
                    add(
                        scale(shadowRadialU, Math.cos(angleRad) * rEr * localPerErR),
                        scale(shadowRadialV, Math.sin(angleRad) * rEr * localPerErR)
                    )
                );
            }
            function camFromLocalPoint(p) {
                return toCamVec({ x: p.x - camPos.x, y: p.y - camPos.y, z: p.z - camPos.z });
            }
            function projectCamPoint(c) {
                return { x: cx + (c.x * focal) / c.z, y: cy - (c.y * focal) / c.z, z: c.z };
            }
            function clipPolygonNear(camPts, nearZ) {
                if (!camPts || camPts.length < 3) return [];
                const out = [];
                for (let i = 0; i < camPts.length; i++) {
                    const a = camPts[i];
                    const b = camPts[(i + 1) % camPts.length];
                    const aIn = a.z >= nearZ;
                    const bIn = b.z >= nearZ;
                    if (aIn && bIn) {
                        out.push(b);
                    } else if (aIn && !bIn) {
                        const t = (nearZ - a.z) / (b.z - a.z);
                        out.push({
                            x: a.x + (b.x - a.x) * t,
                            y: a.y + (b.y - a.y) * t,
                            z: nearZ
                        });
                    } else if (!aIn && bIn) {
                        const t = (nearZ - a.z) / (b.z - a.z);
                        out.push({
                            x: a.x + (b.x - a.x) * t,
                            y: a.y + (b.y - a.y) * t,
                            z: nearZ
                        });
                        out.push(b);
                    }
                }
                return out;
            }
            function clipSegmentNear(a, b, nearZ) {
                const aIn = a.z >= nearZ;
                const bIn = b.z >= nearZ;
                if (aIn && bIn) return [a, b];
                if (!aIn && !bIn) return null;
                const t = (nearZ - a.z) / (b.z - a.z);
                const c = {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                    z: nearZ
                };
                return aIn ? [a, c] : [c, b];
            }
            function drawClippedLoop(localPoints, strokeStyle, lineWidth) {
                if (!localPoints || localPoints.length < 3) return;
                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = lineWidth;
                for (let i = 0; i < localPoints.length; i++) {
                    const aCam = camFromLocalPoint(localPoints[i]);
                    const bCam = camFromLocalPoint(localPoints[(i + 1) % localPoints.length]);
                    const clipped = clipSegmentNear(aCam, bCam, shadowNearClipZ);
                    if (!clipped) continue;
                    const a2 = projectCamPoint(clipped[0]);
                    const b2 = projectCamPoint(clipped[1]);
                    ctx.beginPath();
                    ctx.moveTo(a2.x, a2.y);
                    ctx.lineTo(b2.x, b2.y);
                    ctx.stroke();
                }
            }
            function drawShadowConeVolume(opts) {
                const seg = opts.segments || 28;
                const nearRing = [];
                const farRing = [];
                const useTip = opts.r1 <= 0.003;
                for (let i = 0; i < seg; i++) {
                    const a = (i / seg) * Math.PI * 2;
                    nearRing.push(shadowPointAt(opts.x0, opts.r0, a));
                    if (!useTip) farRing.push(shadowPointAt(opts.x1, opts.r1, a));
                }
                const tip = useTip ? shadowPointAt(opts.x1, 0, 0) : null;

                const faces = [];
                for (let i = 0; i < seg; i++) {
                    const j = (i + 1) % seg;
                    const faceLocal = useTip
                        ? [nearRing[i], nearRing[j], tip]
                        : [nearRing[i], nearRing[j], farRing[j], farRing[i]];
                    const faceCam = faceLocal.map(camFromLocalPoint);
                    const clippedCam = clipPolygonNear(faceCam, shadowNearClipZ);
                    if (clippedCam.length < 3) continue;
                    const shade = 0.45 + 0.55 * Math.abs(Math.sin(((i + 0.5) / seg) * Math.PI * 2 - sim.moonView.yaw * 0.18));
                    const alpha = opts.alphaMin + (opts.alphaMax - opts.alphaMin) * shade;
                    faces.push({
                        points: clippedCam.map(projectCamPoint),
                        depth: clippedCam.reduce((acc, p) => acc + p.z, 0) / clippedCam.length,
                        alpha: alpha
                    });
                }

                faces.sort((a, b) => b.depth - a.depth);
                faces.forEach((face) => {
                    ctx.beginPath();
                    ctx.moveTo(face.points[0].x, face.points[0].y);
                    for (let i = 1; i < face.points.length; i++) ctx.lineTo(face.points[i].x, face.points[i].y);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(' + opts.rgb[0] + ',' + opts.rgb[1] + ',' + opts.rgb[2] + ',' + face.alpha.toFixed(3) + ')';
                    ctx.fill();
                });

                drawClippedLoop(nearRing, opts.edge, Math.max(0.8, w * 0.0015));
                if (!useTip) drawClippedLoop(farRing, opts.edge, Math.max(0.8, w * 0.0015));

                const guideCount = Math.max(0, Math.floor(opts.guides || 0));
                if (guideCount > 0) {
                    ctx.strokeStyle = opts.guide || opts.edge;
                    ctx.globalAlpha = clamp(opts.guideAlpha || 0.4, 0, 1);
                    ctx.lineWidth = Math.max(0.65, w * 0.0013);
                    for (let k = 0; k < guideCount; k++) {
                        const idx = Math.floor((k / guideCount) * seg) % seg;
                        const aCam = camFromLocalPoint(nearRing[idx]);
                        const bCam = camFromLocalPoint(useTip ? tip : farRing[idx]);
                        const clipped = clipSegmentNear(aCam, bCam, shadowNearClipZ);
                        if (!clipped) continue;
                        const a2 = projectCamPoint(clipped[0]);
                        const b2 = projectCamPoint(clipped[1]);
                        ctx.beginPath();
                        ctx.moveTo(a2.x, a2.y);
                        ctx.lineTo(b2.x, b2.y);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                }
            }
            function projectShadowLabelPoint(pLocal) {
                const c = camFromLocalPoint(pLocal);
                const z = Math.max(shadowNearClipZ, c.z);
                return projectCamPoint({ x: c.x, y: c.y, z: z });
            }

            const x0Er = 0.2;
            const x1Er = clamp(Math.max(st.p.x + 16, 36), 36, CFG.shadowLenEr + 20);
            const penR0Er = shadowAt(x0Er).penumbra;
            const penR1Er = shadowAt(x1Er).penumbra;
            const umbraCylEndEr = Math.min(14, x1Er * 0.42);
            const umbraConeR1Er = Math.max(0.03, shadowAt(x1Er).umbra);

            drawShadowConeVolume({
                x0: x0Er,
                r0: penR0Er,
                x1: x1Er,
                r1: penR1Er,
                segments: 28,
                rgb: [12, 14, 18],
                alphaMin: 0.018,
                alphaMax: 0.062,
                edge: 'rgba(82,90,106,0.32)',
                guides: 8,
                guide: 'rgba(104,112,130,0.44)',
                guideAlpha: 0.36
            });
            drawShadowConeVolume({
                x0: x0Er,
                r0: shadowAt(x0Er).umbra,
                x1: umbraCylEndEr,
                r1: shadowAt(umbraCylEndEr).umbra,
                segments: 24,
                rgb: [62, 16, 12],
                alphaMin: 0.19,
                alphaMax: 0.30,
                edge: 'rgba(154,70,62,0.46)',
                guides: 6,
                guide: 'rgba(176,88,76,0.56)',
                guideAlpha: 0.44
            });
            drawShadowConeVolume({
                x0: umbraCylEndEr,
                r0: shadowAt(umbraCylEndEr).umbra,
                x1: x1Er,
                r1: umbraConeR1Er,
                segments: 24,
                rgb: [78, 20, 14],
                alphaMin: 0.21,
                alphaMax: 0.34,
                edge: 'rgba(176,84,68,0.50)',
                guides: 6,
                guide: 'rgba(198,98,82,0.60)',
                guideAlpha: 0.46
            });

            const penLabel = projectShadowLabelPoint(shadowPointAt(x1Er * 0.88, penR1Er * 0.8, Math.PI * 0.14));
            ctx.fillStyle = 'rgba(124,132,148,0.9)';
            ctx.font = Math.max(10, Math.floor(w * 0.016)) + 'px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Penumbra Cone', penLabel.x + 8, penLabel.y - 6);

            const umbLabel = projectShadowLabelPoint(shadowPointAt(x1Er * 0.78, Math.max(umbraConeR1Er, 0.28), Math.PI * 0.28));
            ctx.fillStyle = 'rgba(214,126,110,0.95)';
            ctx.font = Math.max(10, Math.floor(w * 0.016)) + 'px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Umbra Cone', umbLabel.x + 8, umbLabel.y - 6);

            const moonCenter = { x: 0, y: 0, z: 0 };
            const moonProj = projectPoint(moonCenter);
            const moonR = projectRadius(moonCenter, 1);
            if (!moonProj || !moonR || moonR < 2) return;

            const halo = ctx.createRadialGradient(moonProj.x, moonProj.y, moonR * 0.52, moonProj.x, moonProj.y, moonR * 1.7);
            halo.addColorStop(0, 'rgba(130,180,255,0.14)');
            halo.addColorStop(1, 'rgba(10,20,35,0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(moonProj.x, moonProj.y, moonR * 1.7, 0, Math.PI * 2);
            ctx.fill();

            const moonTone = smoothstep(0.18, 0.95, st.umC);
            const litAlbedo = mixRgbHex('#d9dfe8', '#be8a74', moonTone);
            const darkAlbedo = mixRgbHex('#6e7682', '#402219', moonTone);
            const copperAlbedo = mixRgbHex('#af5130', '#6a1b12', moonTone);
            const edgeStroke = rgbaCss(mixRgbHex('#dbe6fa', '#f8be9e', moonTone), lerp(0.45, 0.65, moonTone));
            const gridColor = rgbaCss(mixRgbHex('#95aecf', '#d4aa96', moonTone), lerp(0.08, 0.17, moonTone));
            const shadowEdgeEr = Math.max(0.003, moonRer * 0.018);
            const umbraDepthScale = Math.max(0.05, moonRer * 0.45);
            const penumbraSpanFloor = Math.max(0.02, moonRer * 0.22);

            ctx.save();
            ctx.beginPath();
            ctx.arc(moonProj.x, moonProj.y, moonR, 0, Math.PI * 2);
            ctx.clip();

            ctx.fillStyle = rgbCss(darkAlbedo);
            ctx.beginPath();
            ctx.arc(moonProj.x, moonProj.y, moonR, 0, Math.PI * 2);
            ctx.fill();

            const latStep = 15 * degToRad;
            const lonStep = 15 * degToRad;
            const gridWidth = Math.max(0.5, moonR * 0.0048);
            // テクスチャが未ロードのときだけ簡易グリッドを描画（デバッグ用）
            if (!moonTex.ready) {
                for (let lat = -75 * degToRad; lat <= 75 * degToRad + 1e-6; lat += latStep) {
                    drawGeoCurve((t) => spherePoint(lat, -Math.PI + t * Math.PI * 2), 120, gridColor, gridWidth);
                }
                for (let lon = -165 * degToRad; lon <= 165 * degToRad + 1e-6; lon += lonStep) {
                    drawGeoCurve((t) => spherePoint(-Math.PI * 0.5 + t * Math.PI, lon), 96, gridColor, gridWidth);
                }
            }

            const px0 = Math.max(0, Math.floor(moonProj.x - moonR - 1));
            const py0 = Math.max(0, Math.floor(moonProj.y - moonR - 1));
            const px1 = Math.min(w, Math.ceil(moonProj.x + moonR + 1));
            const py1 = Math.min(h, Math.ceil(moonProj.y + moonR + 1));
            const iw = Math.max(1, px1 - px0);
            const ih = Math.max(1, py1 - py0);
            const image = ctx.getImageData(px0, py0, iw, ih);
            const data = image.data;
            const d = camDist;

            // テクスチャサンプル（等距円筒図法/equirectangular）
            function sampleMoonTex(vLocal) {
                // vLocal: 月中心からの単位ベクトル（月ローカル座標）
                if (!moonTex.ready || !moonTex.data) return null;
                // Shift 180 deg so the Earth-facing hemisphere aligns with the map center.
                const lon = Math.atan2(vLocal.x, vLocal.z) + Math.PI;
                const lat = Math.asin(clamp(vLocal.y, -1, 1));  // [-pi/2, pi/2]
                let u = lon / (Math.PI * 2) + 0.5;             // [0,1)
                let v = 0.5 - lat / Math.PI;                   // [0,1]
                // wrap u
                u = u - Math.floor(u);
                v = clamp(v, 0, 1);
                const x = Math.min(moonTex.w - 1, Math.max(0, Math.floor(u * (moonTex.w - 1))));
                const y = Math.min(moonTex.h - 1, Math.max(0, Math.floor(v * (moonTex.h - 1))));
                const o = (y * moonTex.w + x) * 4;
                const td = moonTex.data;
                return { r: td[o], g: td[o + 1], b: td[o + 2] };
            }

            for (let iy = 0; iy < ih; iy++) {
                const sy = py0 + iy + 0.5;
                for (let ix = 0; ix < iw; ix++) {
                    const sx = px0 + ix + 0.5;
                    const dx = (sx - cx) / focal;
                    const dy = (cy - sy) / focal;
                    const invLen = 1 / Math.hypot(dx, dy, 1);
                    const dir = { x: dx * invLen, y: dy * invLen, z: invLen };

                    const dotDC = dir.z * d;
                    const disc = dotDC * dotDC - (d * d - 1);
                    if (disc <= 0) continue;
                    const t = dotDC - Math.sqrt(disc);
                    if (t <= 0) continue;

                    const pz = dir.z * t;
                    const nx = dir.x * t;
                    const ny = dir.y * t;
                    const nz = pz - d;

                    // camera-space normal -> moon-local normal (unit)
                    const vLocal = normalize({
                        x: camRight.x * nx + camUp.x * ny + camToMoon.x * nz,
                        y: camRight.y * nx + camUp.y * ny + camToMoon.y * nz,
                        z: camRight.z * nx + camUp.z * ny + camToMoon.z * nz
                    });
                    const nWorld = moonLocalToWorld(vLocal);
                    const lambert = Math.max(0, -nWorld.x);

                    // Project this surface point back to world coordinates and test it against
                    // the umbra/penumbra radius at that x-position.
                    const pointWorld = {
                        x: st.p.x + nWorld.x * moonRer,
                        y: st.p.y + nWorld.y * moonRer,
                        z: st.p.z + nWorld.z * moonRer
                    };
                    const pointShadow = shadowAt(pointWorld.x);
                    const axisDistEr = Math.hypot(pointWorld.y, pointWorld.z);
                    const umbraEdge0 = Math.max(0, pointShadow.umbra - shadowEdgeEr);
                    const umbraEdge1 = pointShadow.umbra + shadowEdgeEr;
                    const penEdge0 = Math.max(umbraEdge1 + 1e-6, pointShadow.penumbra - shadowEdgeEr);
                    const penEdge1 = pointShadow.penumbra + shadowEdgeEr;

                    // Earth-facing hemisphere gate:
                    // backside (far side) should not receive Earth's shadow.
                    const earthFacing = smoothstep(-0.03, 0.04, dot(vLocal, earthLocal));
                    const umbraRaw = 1 - smoothstep(umbraEdge0, umbraEdge1, axisDistEr);
                    const outsidePen = smoothstep(penEdge0, penEdge1, axisDistEr);
                    const penOnlyRaw = clamp(1 - outsidePen - umbraRaw, 0, 1);
                    const umbra = umbraRaw * earthFacing;
                    const penOnly = penOnlyRaw * earthFacing;
                    const span = Math.max(penumbraSpanFloor, pointShadow.penumbra - pointShadow.umbra);
                    const transRaw = clamp((axisDistEr - pointShadow.umbra) / span, 0, 1);
                    const transShadow = smoothstep(0, 1, transRaw);
                    const trans = lerp(1, transShadow, earthFacing);
                    const umbraDepth = clamp((pointShadow.umbra - axisDistEr) / umbraDepthScale, 0, 1) * earthFacing;

                    // ベース色: テクスチャが使えるならそれを優先。未ロード時は既存の疑似アルベド。
                    const tex = sampleMoonTex(vLocal);
                    let baseR = tex ? tex.r : lerp(darkAlbedo.r, litAlbedo.r, 0.65);
                    let baseG = tex ? tex.g : lerp(darkAlbedo.g, litAlbedo.g, 0.65);
                    let baseB = tex ? tex.b : lerp(darkAlbedo.b, litAlbedo.b, 0.65);

                    // 皆既に入るほど赤銅色へ（半影では弱めに）
                    const copper = clamp(umbra * (0.30 + 0.62 * umbraDepth) + penOnly * 0.10, 0, 1);

                    // ライティング:
                    // - 日向面は Lambert (少しガンマ)
                    // - 夜側は完全黒にせず微弱アンビエント
                    // - 地球影の進入で trans により減光
                    const ambient = lerp(0.05, 0.012, umbra);
                    const direct = Math.pow(lambert, 0.9) * trans;
                    let light = ambient + (1 - ambient) * direct;
                    // Refracted red lift in umbra: keep it subtle so umbra stays darker than penumbra.
                    light += (0.01 + 0.045 * umbraDepth) * umbra;
                    // Extra attenuation to maintain contrast between penumbra and umbra.
                    light *= (1 - 0.28 * umbra);
                    light = clamp(light, 0.01, 1.08);

                    // 赤銅色のティント（テクスチャの上に重ねる）
                    const copperTint = (0.54 + 0.10 * umbra) * copper;
                    const deepUmbra = umbra * (0.35 + 0.65 * umbraDepth);
                    let outR = lerp(baseR, copperAlbedo.r, copperTint) * light;
                    let outG = lerp(baseG, copperAlbedo.g, copperTint) * light;
                    let outB = lerp(baseB, copperAlbedo.b, copperTint) * light;
                    // Refracted sunlight in deep umbra: keep overall dark, but shift toward red.
                    outR += 18 * deepUmbra;
                    outG += 5 * deepUmbra;
                    outB += 2.5 * deepUmbra;
                    outB *= (1 - 0.18 * deepUmbra);

                    const o = (iy * iw + ix) * 4;
                    data[o] = Math.round(clamp(outR, 0, 255));
                    data[o + 1] = Math.round(clamp(outG, 0, 255));
                    data[o + 2] = Math.round(clamp(outB, 0, 255));
                    data[o + 3] = 255;
                }
            }
            ctx.putImageData(image, px0, py0);

            const limb = ctx.createRadialGradient(moonProj.x, moonProj.y, moonR * 0.76, moonProj.x, moonProj.y, moonR * 1.02);
            limb.addColorStop(0, 'rgba(0,0,0,0)');
            limb.addColorStop(1, 'rgba(0,0,0,0.34)');
            ctx.fillStyle = limb;
            ctx.beginPath();
            ctx.arc(moonProj.x, moonProj.y, moonR * 1.02, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.strokeStyle = edgeStroke;
            ctx.lineWidth = Math.max(1.1, moonR * 0.02);
            ctx.beginPath();
            ctx.arc(moonProj.x, moonProj.y, moonR, 0, Math.PI * 2);
            ctx.stroke();

            const earthSunSep = Math.acos(clamp(dot(earthLocal, sunLocal), -1, 1)) * 180 / Math.PI;
            const altitudeKm = (camDist - 1) * CFG.moonRkm;
            ctx.fillStyle = 'rgba(208,224,245,0.86)';
            ctx.font = Math.max(10, Math.floor(w * 0.018)) + 'px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Satellite Alt ' + fmtNum(altitudeKm, 0) + ' km', 10, 18);
            ctx.fillText('Earth-Sun Sep ' + fmtNum(earthSunSep, 2) + '°', 10, 34);
        }

        function syncBtn() {
            playBtn.textContent = sim.play ? '停止' : '再生';
            playBtn.setAttribute('aria-pressed', sim.play ? 'true' : 'false');
            rotateBtn.textContent = sim.auto ? '自動回転: ON' : '自動回転: OFF';
            rotateBtn.setAttribute('aria-pressed', sim.auto ? 'true' : 'false');
            syncCenterToggle();
        }

        function render() {
            const st = state(sim.m);
            if (dom.time) dom.time.textContent = 'JST ' + fmtJst.format(new Date(startMs + st.m * 60000));
            if (dom.min) dom.min.textContent = '+' + String(Math.round(st.m)).padStart(3, '0') + ' min';
            if (dom.stage) dom.stage.textContent = st.stage;
            if (dom.umbra) dom.umbra.textContent = fmtNum(st.umC * 100, 1) + '%';
            if (dom.penumbra) dom.penumbra.textContent = fmtNum(st.peC * 100, 1) + '%';
            if (dom.axis) dom.axis.textContent = fmtNum(st.d * CFG.earthRkm, 0) + ' km';
            if (dom.dist) dom.dist.textContent = fmtNum(st.p.x * CFG.earthRkm, 0) + ' km';
            if (dom.speed) dom.speed.textContent = fmtNum(speed(st.m), 2) + ' km/s';
            if (dom.cam) {
                const active = sim.center === 'earth' ? sim.view : sim.moonView;
                const modeLabel = sim.center === 'earth' ? 'Earth Center' : 'Moon Center';
                const zoom = zoomInfoByMode(sim.center);
                const d = ensureViewDistance(sim.center);
                const distText = ' / Dist ' + d.toFixed(2) + zoom.unit;
                dom.cam.textContent = modeLabel
                    + ' / Yaw ' + (active.yaw * 180 / Math.PI).toFixed(1) + '°'
                    + ' / Pitch ' + (active.pitch * 180 / Math.PI).toFixed(1) + '°'
                    + distText;
            }
            renderFace(st);
            if (sim.center === 'earth') {
                renderEarthCentric(st);
            } else {
                renderMoonCentric(st);
            }
        }

        function buildEvents() {
            const rows = [
                ['P1', '半影食開始', OFFICIAL_EVENT_MIN.P1], ['U1', '部分食開始', OFFICIAL_EVENT_MIN.U1], ['U2', '皆既食開始', OFFICIAL_EVENT_MIN.U2],
                ['MAX', '食最大', OFFICIAL_EVENT_MIN.MAX], ['U3', '皆既食終了', OFFICIAL_EVENT_MIN.U3], ['U4', '部分食終了', OFFICIAL_EVENT_MIN.U4],
                ['P4', '半影食終了', OFFICIAL_EVENT_MIN.P4]
            ];
            eventList.innerHTML = rows.map((r) => {
                const t = fmtJst.format(new Date(startMs + r[2] * 60000));
                return '<li><b>' + r[0] + '</b> ' + r[1] + ': ' + t + '</li>';
            }).join('');
        }

        slider.addEventListener('input', function () {
            sim.m = clamp(Number(slider.value) || 0, 0, CFG.durationMin);
            sim.play = false; syncBtn(); if (liveActive()) render();
        });
        playBtn.addEventListener('click', function () { sim.play = !sim.play; syncBtn(); });
        rotateBtn.addEventListener('click', function () { sim.auto = !sim.auto; syncBtn(); if (liveActive()) render(); });
        if (centerEarthBtn) {
            centerEarthBtn.addEventListener('click', function () { setCenterMode('earth'); });
        }
        if (centerMoonBtn) {
            centerMoonBtn.addEventListener('click', function () { setCenterMode('moon'); });
        }
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', function () { zoomBy(-1); });
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', function () { zoomBy(1); });
        }

        function stopDrag(e) {
            if (!sim.dragMode) return;
            const active = viewStateByMode(sim.dragMode);
            active.drag = false;
            active.pid = null;
            sim.dragMode = null;
            orbitCanvas.classList.remove('is-dragging');
            if (e && e.pointerId !== undefined) {
                try { orbitCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
            }
        }
        orbitCanvas.addEventListener('pointerdown', function (e) {
            const mode = sim.center === 'earth' ? 'earth' : 'moon';
            const active = viewStateByMode(mode);
            sim.dragMode = mode;
            active.drag = true;
            active.pid = e.pointerId;
            active.x = e.clientX;
            active.y = e.clientY;
            orbitCanvas.classList.add('is-dragging');
            try { orbitCanvas.setPointerCapture(e.pointerId); } catch (err) {}
        });
        orbitCanvas.addEventListener('pointermove', function (e) {
            if (!sim.dragMode) return;
            const active = viewStateByMode(sim.dragMode);
            if (!active.drag || (active.pid !== null && active.pid !== e.pointerId)) return;
            const dx = e.clientX - active.x;
            const dy = e.clientY - active.y;
            active.x = e.clientX;
            active.y = e.clientY;
            const rect = orbitCanvas.getBoundingClientRect();
            const w = Math.max(220, rect.width);
            const h = Math.max(180, rect.height);
            const yawDelta = (-(dx / w) * VIEW_CTRL.yawTurnPerCanvas);
            const pitchDelta = (-(dy / h) * VIEW_CTRL.pitchTurnPerCanvas);

            active.targetYaw = wrapAngle(active.targetYaw + yawDelta);
            active.targetPitch = clamp(active.targetPitch + pitchDelta, VIEW_CTRL.pitchMin, VIEW_CTRL.pitchMax);
            active.yaw = lerpAngle(active.yaw, active.targetYaw, 0.72);
            active.pitch = lerp(active.pitch, active.targetPitch, 0.72);
            if (sim.auto) { sim.auto = false; syncBtn(); }
            if (liveActive()) render();
        });
        orbitCanvas.addEventListener('pointerup', stopDrag);
        orbitCanvas.addEventListener('pointercancel', stopDrag);
        orbitCanvas.addEventListener('pointerleave', function () {
            if (sim.dragMode) stopDrag();
        });
        orbitCanvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            const raw = clamp(e.deltaY / 120, -4, 4);
            if (Math.abs(raw) < 0.01) return;
            zoomBy(raw);
        }, { passive: false });

        window.addEventListener('resize', function () { if (liveActive()) render(); });

        function tick(ts) {
            if (!sim.last) sim.last = ts;
            if (ts - sim.last >= CFG.frameMs) {
                if (liveActive()) {
                    if (sim.play) { sim.m = (sim.m + 1) % (CFG.durationMin + 1); slider.value = String(sim.m); }
                    if (sim.center === 'earth') {
                        if (sim.auto && !sim.view.drag) {
                            sim.view.targetYaw = wrapAngle(sim.view.targetYaw + 0.0045);
                        }
                        sim.view.yaw = lerpAngle(sim.view.yaw, sim.view.targetYaw, VIEW_CTRL.followLerp);
                        sim.view.pitch = lerp(sim.view.pitch, sim.view.targetPitch, VIEW_CTRL.followLerp);
                    } else {
                        if (sim.auto && !sim.moonView.drag) {
                            sim.moonView.targetYaw = wrapAngle(sim.moonView.targetYaw + 0.0032);
                            sim.moonView.targetPitch = clamp(
                                0.16 + Math.sin(sim.moonView.targetYaw * 0.58) * 0.22,
                                VIEW_CTRL.pitchMin,
                                VIEW_CTRL.pitchMax
                            );
                        }
                        sim.moonView.yaw = lerpAngle(sim.moonView.yaw, sim.moonView.targetYaw, VIEW_CTRL.followLerp);
                        sim.moonView.pitch = lerp(sim.moonView.pitch, sim.moonView.targetPitch, VIEW_CTRL.followLerp);
                    }
                    render();
                }
                sim.last = ts;
            }
            requestAnimationFrame(tick);
        }

        buildEvents();
        syncBtn();
        if (liveActive()) render();
        requestAnimationFrame(tick);
    };
})();
