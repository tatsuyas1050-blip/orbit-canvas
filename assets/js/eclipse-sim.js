(function () {
    'use strict';

    const CFG = Object.freeze({
        startTimeJst: '2026-03-03T18:00:00+09:00',
        durationMin: 360,
        initialMin: 180,
        frameMs: 120,
        earthRkm: 6371,
        moonRkm: 1737.4,
        moonDistanceEr: 60.3,
        umbraLengthEr: 216,
        penumbraSlope: 0.0045,
        pathY0: 1.9,
        pathY1: -1.9,
        pathZBase: 0.18,
        pathZAmp: 0.08,
        scaleX: 0.18,
        scaleYZ: 1.8,
        shadowLenEr: 90
    });
    const VIEW_CTRL = Object.freeze({
        yawTurnPerCanvas: Math.PI * 1.15,
        pitchTurnPerCanvas: Math.PI * 0.55,
        pitchMin: -0.62,
        pitchMax: 0.62,
        followLerp: 0.35
    });
    const ORBIT_REF = Object.freeze({
        // 地球公転軸（黄道面法線）を簡易モデルとして 23.44° 傾ける
        tiltRad: 23.44 * Math.PI / 180
    });

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
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

    window.initLunarEclipseSim = function initLunarEclipseSim() {
        const panel = document.getElementById('eclipse-sim-panel');
        if (!panel || panel.dataset.ready === '1') return;
        panel.dataset.ready = '1';

        const slider = document.getElementById('eclipse-time-slider');
        const playBtn = document.getElementById('eclipse-play-toggle');
        const rotateBtn = document.getElementById('eclipse-autorotate-toggle');
        const faceCanvas = document.getElementById('eclipse-face-canvas');
        const viewCanvas = document.getElementById('eclipse-3d-canvas');
        const eventList = document.getElementById('eclipse-event-list');
        if (!slider || !playBtn || !rotateBtn || !faceCanvas || !viewCanvas || !eventList) return;

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
        const startMs = new Date(CFG.startTimeJst).getTime();
        const fmtJst = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const sunAxis = Object.freeze({ x: 1, y: 0, z: 0 });
        const orbitAxis = Object.freeze(normalize({
            x: 0,
            y: Math.cos(ORBIT_REF.tiltRad),
            z: Math.sin(ORBIT_REF.tiltRad)
        }));
        const orbitPerpAxis = Object.freeze(normalize(cross(orbitAxis, sunAxis)));

        const sim = {
            m: CFG.initialMin,
            play: false,
            auto: true,
            last: 0,
            starsFace: makeStars(140, 901),
            stars3d: makeStars(90, 2203),
            view: {
                yaw: -0.92,
                pitch: 0.34,
                targetYaw: -0.92,
                targetPitch: 0.34,
                dist: 30,
                scale: 320,
                cx: 0,
                cy: 0,
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

        function moonPos(minute) {
            const p = clamp(minute / CFG.durationMin, 0, 1);
            // 回転軸（orbitAxis）に対して見たときに縦へ流れないよう、
            // 月の移動方向は orbitAxis に直交する基底で定義する。
            const sweep = lerp(CFG.pathY0, CFG.pathY1, p);
            const axisOffset = CFG.pathZBase; // 軸方向オフセットは固定値
            return {
                x: CFG.moonDistanceEr + 0.35 * Math.sin(p * Math.PI * 2),
                y: orbitPerpAxis.y * sweep + orbitAxis.y * axisOffset,
                z: orbitPerpAxis.z * sweep + orbitAxis.z * axisOffset
            };
        }

        function shadowAt(xEr) {
            return { umbra: Math.max(0.02, 1 - xEr / CFG.umbraLengthEr), penumbra: 1 + xEr * CFG.penumbraSlope };
        }

        function speed(minute) {
            const m0 = clamp(minute - 0.5, 0, CFG.durationMin);
            const m1 = clamp(minute + 0.5, 0, CFG.durationMin);
            const a = moonPos(m0);
            const b = moonPos(m1);
            return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * CFG.earthRkm / 60;
        }

        function state(minute) {
            const m = clamp(minute, 0, CFG.durationMin);
            const p = moonPos(m);
            const sh = shadowAt(p.x);
            const d = Math.hypot(p.y, p.z);
            const inP = d < sh.penumbra + moonRer;
            const inU = d < sh.umbra + moonRer;
            const total = d < Math.max(0, sh.umbra - moonRer);
            let stage = '半影外';
            if (total) stage = '皆既月食';
            else if (inU) stage = '部分月食';
            else if (inP) stage = '半影月食';
            const moonArea = Math.PI * moonRer * moonRer;
            return {
                m, p, sh, d, inP, inU, total, stage,
                umC: clamp(overlapArea(moonRer, sh.umbra, d) / moonArea, 0, 1),
                peC: clamp(overlapArea(moonRer, sh.penumbra, d) / moonArea, 0, 1)
            };
        }

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

        function renderFace(st) {
            const { w, h } = sizeCanvas(faceCanvas);
            const ctx = faceCanvas.getContext('2d');
            if (!ctx || w < 3 || h < 3) return;

            const bg = ctx.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, '#0b1320'); bg.addColorStop(1, '#03060b');
            ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
            sim.starsFace.forEach((s) => {
                ctx.fillStyle = 'rgba(220,235,255,' + (s.a * 0.7).toFixed(3) + ')';
                ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
            });

            const cx = w * 0.5, cy = h * 0.5, r = Math.min(w, h) * 0.28;
            const moon = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.24, r * 0.16, cx, cy, r);
            moon.addColorStop(0, '#fffef7'); moon.addColorStop(0.55, '#d6d5cc'); moon.addColorStop(1, '#91939d');
            ctx.fillStyle = moon; circle(ctx, cx, cy, r); ctx.fill();

            // 月面ビューは「上=天頂側」を固定するため、
            // orbitAxis を画面の上方向、orbitPerpAxis を左右方向として投影する。
            const offRight = st.p.y * orbitPerpAxis.y + st.p.z * orbitPerpAxis.z;
            const offUp = st.p.y * orbitAxis.y + st.p.z * orbitAxis.z;
            const sx = cx - (offRight / moonRer) * r;
            const sy = cy - (offUp / moonRer) * r;
            const pR = r * (st.sh.penumbra / moonRer);
            const uR = r * (st.sh.umbra / moonRer);
            ctx.save(); circle(ctx, cx, cy, r); ctx.clip();
            ctx.fillStyle = 'rgba(24,28,44,0.38)'; circle(ctx, sx, sy, pR); ctx.fill();
            const ug = ctx.createRadialGradient(sx + uR * 0.24, sy - uR * 0.22, uR * 0.08, sx, sy, uR);
            ug.addColorStop(0, 'rgba(66,12,16,0.24)'); ug.addColorStop(0.56, 'rgba(22,8,16,0.74)'); ug.addColorStop(1, 'rgba(0,0,0,0.9)');
            ctx.fillStyle = ug; circle(ctx, sx, sy, uR); ctx.fill();
            if (st.umC > 0.55) {
                const a = clamp((st.umC - 0.55) / 0.45, 0, 1) * 0.55;
                const rg = ctx.createRadialGradient(cx, cy, r * 0.22, cx, cy, r);
                rg.addColorStop(0, 'rgba(170,56,26,' + (0.28 + a * 0.25).toFixed(3) + ')');
                rg.addColorStop(1, 'rgba(80,14,11,' + (0.44 + a * 0.3).toFixed(3) + ')');
                ctx.fillStyle = rg; circle(ctx, cx, cy, r); ctx.fill();
            }
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,240,210,0.62)'; ctx.lineWidth = Math.max(1.1, r * 0.02); circle(ctx, cx, cy, r); ctx.stroke();
            ctx.fillStyle = 'rgba(240,248,255,0.92)'; ctx.font = Math.max(12, Math.floor(w * 0.032)) + 'px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(st.stage, cx, h - Math.max(14, h * 0.05));
        }

        function render3D(st) {
            const { w, h } = sizeCanvas(viewCanvas);
            const ctx = viewCanvas.getContext('2d');
            if (!ctx || w < 3 || h < 3) return;
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

            const penumbraEndX = Math.min(CFG.shadowLenEr + 20, CFG.umbraLengthEr * 0.65);
            const penumbraEndR = 1 + penumbraEndX * CFG.penumbraSlope;
            const umbraCylinderEndX = 14;
            // 要望: 本影円錐の長さを半影と同じ長さにする
            const umbraConeEndX = penumbraEndX;
            const umbraConeEndR = Math.max(0.03, 1 - umbraConeEndX / CFG.umbraLengthEr);

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
                const q = proj(rot(disp(moonPos((i / 64) * CFG.durationMin))));
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

            const moonColors = (st.umC > 0.64)
                ? ['#deab86', '#8f4a36', '#2f1713', 'rgba(255,166,132,0.55)']
                : ['#f0f0f0', '#9ea4ad', '#3e434b', 'rgba(242,245,255,0.45)'];
            const items = [
                sphere({ x: 0, y: 0, z: 0 }, 1, ['#8bc0ff', '#3568a3', '#102848', 'rgba(165,208,255,0.65)'], 'Earth'),
                sphere(st.p, moonRer, moonColors, 'Moon')
            ].filter(Boolean).sort((a, b) => b.z - a.z);
            items.forEach((it) => it.draw());
        }

        function syncBtn() {
            playBtn.textContent = sim.play ? '停止' : '再生';
            playBtn.setAttribute('aria-pressed', sim.play ? 'true' : 'false');
            rotateBtn.textContent = sim.auto ? '自動回転: ON' : '自動回転: OFF';
            rotateBtn.setAttribute('aria-pressed', sim.auto ? 'true' : 'false');
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
            if (dom.cam) dom.cam.textContent = 'Yaw ' + (sim.view.yaw * 180 / Math.PI).toFixed(1) + '° / Pitch ' + (sim.view.pitch * 180 / Math.PI).toFixed(1) + '°';
            renderFace(st);
            render3D(st);
        }

        function buildEvents() {
            const marks = { P1: null, U1: null, U2: null, MAX: 0, U3: null, U4: null, P4: null };
            let prev = state(0), minD = prev.d;
            marks.P1 = prev.inP ? 0 : null; marks.U1 = prev.inU ? 0 : null; marks.U2 = prev.total ? 0 : null;
            for (let m = 1; m <= CFG.durationMin; m++) {
                const cur = state(m);
                if (cur.d < minD) { minD = cur.d; marks.MAX = m; }
                if (marks.P1 === null && !prev.inP && cur.inP) marks.P1 = m;
                if (marks.U1 === null && !prev.inU && cur.inU) marks.U1 = m;
                if (marks.U2 === null && !prev.total && cur.total) marks.U2 = m;
                if (marks.U3 === null && prev.total && !cur.total) marks.U3 = m;
                if (marks.U4 === null && prev.inU && !cur.inU) marks.U4 = m;
                if (marks.P4 === null && prev.inP && !cur.inP) marks.P4 = m;
                prev = cur;
            }
            const rows = [
                ['P1', '半影食開始', marks.P1], ['U1', '部分食開始', marks.U1], ['U2', '皆既食開始', marks.U2],
                ['MAX', '食最大', marks.MAX], ['U3', '皆既食終了', marks.U3], ['U4', '部分食終了', marks.U4], ['P4', '半影食終了', marks.P4]
            ];
            eventList.innerHTML = rows.map((r) => {
                const t = (r[2] === null) ? '---' : fmtJst.format(new Date(startMs + r[2] * 60000));
                return '<li><b>' + r[0] + '</b> ' + r[1] + ': ' + t + '</li>';
            }).join('');
        }

        slider.addEventListener('input', function () {
            sim.m = clamp(Number(slider.value) || 0, 0, CFG.durationMin);
            sim.play = false; syncBtn(); if (liveActive()) render();
        });
        playBtn.addEventListener('click', function () { sim.play = !sim.play; syncBtn(); });
        rotateBtn.addEventListener('click', function () { sim.auto = !sim.auto; syncBtn(); if (liveActive()) render(); });

        viewCanvas.addEventListener('pointerdown', function (e) {
            sim.view.drag = true; sim.view.pid = e.pointerId; sim.view.x = e.clientX; sim.view.y = e.clientY;
            viewCanvas.classList.add('is-dragging');
            try { viewCanvas.setPointerCapture(e.pointerId); } catch (err) {}
        });
        viewCanvas.addEventListener('pointermove', function (e) {
            if (!sim.view.drag || (sim.view.pid !== null && sim.view.pid !== e.pointerId)) return;
            const dx = e.clientX - sim.view.x, dy = e.clientY - sim.view.y;
            sim.view.x = e.clientX; sim.view.y = e.clientY;
            const rect = viewCanvas.getBoundingClientRect();
            const w = Math.max(220, rect.width);
            const h = Math.max(180, rect.height);
            const yawDelta = (dx / w) * VIEW_CTRL.yawTurnPerCanvas;
            const pitchDelta = (dy / h) * VIEW_CTRL.pitchTurnPerCanvas;

            sim.view.targetYaw = wrapAngle(sim.view.targetYaw + yawDelta);
            sim.view.targetPitch = clamp(sim.view.targetPitch + pitchDelta, VIEW_CTRL.pitchMin, VIEW_CTRL.pitchMax);
            sim.view.yaw = lerpAngle(sim.view.yaw, sim.view.targetYaw, 0.72);
            sim.view.pitch = lerp(sim.view.pitch, sim.view.targetPitch, 0.72);
            if (sim.auto) { sim.auto = false; syncBtn(); }
            if (liveActive()) render();
        });
        function stopDrag(e) {
            sim.view.drag = false; sim.view.pid = null; viewCanvas.classList.remove('is-dragging');
            if (e && e.pointerId !== undefined) { try { viewCanvas.releasePointerCapture(e.pointerId); } catch (err) {} }
        }
        viewCanvas.addEventListener('pointerup', stopDrag);
        viewCanvas.addEventListener('pointercancel', stopDrag);
        viewCanvas.addEventListener('pointerleave', function () { if (sim.view.drag) stopDrag(); });

        window.addEventListener('resize', function () { if (liveActive()) render(); });

        function tick(ts) {
            if (!sim.last) sim.last = ts;
            if (ts - sim.last >= CFG.frameMs) {
                if (liveActive()) {
                    if (sim.play) { sim.m = (sim.m + 1) % (CFG.durationMin + 1); slider.value = String(sim.m); }
                    if (sim.auto && !sim.view.drag) {
                        sim.view.targetYaw = wrapAngle(sim.view.targetYaw + 0.0045);
                    }
                    sim.view.yaw = lerpAngle(sim.view.yaw, sim.view.targetYaw, VIEW_CTRL.followLerp);
                    sim.view.pitch = lerp(sim.view.pitch, sim.view.targetPitch, VIEW_CTRL.followLerp);
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
