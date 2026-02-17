
const METEOR_API_BASE = "https://ypvqc7yisg.execute-api.ap-northeast-1.amazonaws.com";

const SHOW_METEOR_TIME_LABELS = true;
const MAX_METEOR_TIME_LABELS = 80;
// --- Meteor marker icon assets (relative paths for web) ---
// (Provided paths in your environment)
//   start: C:\my_program\orbit-canvas\assets\img\ss_start.png
//   end  : C:\my_program\orbit-canvas\assets\img\ss_end.png
// In browser we reference them by URL relative to the served root.
const METEOR_START_ICON_URL = "assets/img/ss_start.png";
const METEOR_END_ICON_URL   = "assets/img/ss_end.png";
const METEOR_MARK_ICON_URL  = "assets/img/ss_mark.png";
const LIFELOG_CAPTURE_STORAGE_KEY = 'starry_pending_lifelog_capture';
const LIFELOG_BUTTON_ICON_URL = 'assets/img/lifelog_mark_white.jpg';





// --- Remote (all-users) meteor display ---
let remoteMeteorGroup = null;
let remoteMeteorPollTimer = null;
let remoteMeteorLastKey = "";
let remoteMeteorCache = [];
let remoteMeteorLastStateKey = "";
let remoteMeteorLastRerenderAt = 0;
let remoteMeteorSmooth = { dateMs: null, lat: null, lon: null };

// If the backend doesn't echo brightness yet, keep a local override for *my* records.
// Keyed by recordedAt returned from POST /records.
let meteorBrightnessOverrideByRecordedAt = new Map();
// stars.js

// --- 設定定数 ---
const CONFIG = {
    radius: 500, 
    bgColor: 0x050a14, 
    
    // --- 画角設定 ---
    cameraFov: 50,  
    minFov: 10,     
    maxFov: 75,     
    
    categories: {
        SolarSystem: { label: '太陽系', color: '#ffd700', type: 'solar_body' }, 
        star: { label: '恒星', color: '#ffffff', type: 'point' }, 
        
        // --- カテゴリ定義 ---
        StarLabels: { label: '恒星名', color: '#eeeeee', type: 'label_only', isLabelGroup: true },

        ConstellationLines: { label: '星座線', color: '#e0f0ff', type: 'line', isConstellationGroup: true },
        ConstellationLabels: { label: '星座名', color: '#a0d9ff', type: 'label_only', isConstellationGroup: true },

        // DSO（星雲・星団など）はラベルグループに含める（マークごと消す対象）
        MultipleStar: { label: '重星', color: '#dcd0ff', type: 'double_circle', isLabelGroup: true },
        Galaxy: { label: '銀河', color: '#ffffdd', type: 'ellipse', isLabelGroup: true },
        GlobularCluster: { label: '球状星団', color: '#ffcc66', type: 'circle_plus', isLabelGroup: true },
        OpenCluster: { label: '散開星団', color: '#aaccff', type: 'circle_dotted', isLabelGroup: true },
        EmissionNebula: { label: '散光星雲', color: '#ff9999', type: 'square', isLabelGroup: true },
        ReflectionNebula: { label: '反射星雲', color: '#99ccff', type: 'square_stroke', isLabelGroup: true },
        PlanetaryNebula: { label: '惑星状星雲', color: '#88ffcc', type: 'circle_cross', isLabelGroup: true },
        SupernovaRemnant: { label: '超新星残骸', color: '#cc99ff', type: 'diamond', isLabelGroup: true },
        Comets: { label: '彗星', color: '#a0e0ff', type: 'comet' }
    },

    starColors: {
        O: new THREE.Color('#99b3ff'),
        B: new THREE.Color('#aaccff'),
        A: new THREE.Color('#ddeeff'),
        F: new THREE.Color('#ffffff'),
        G: new THREE.Color('#ffeebb'),
        K: new THREE.Color('#ffcc99'),
        M: new THREE.Color('#f78888'),
        default: new THREE.Color('#ffffff')
    }
};

// --- 物理定数と倍率設定（日食再現用） ---
const SOLAR_CONSTANTS = {
    AU_KM: 149597871,       // 1天文単位 (km)
    SUN_DIAMETER_KM: 1392700, // 太陽の直径 (km)
    MOON_DIAMETER_KM: 3474.8, // 月の直径 (km)
    
    // 【重要】拡大倍率
    // 1.0 にすると「現実の視直径（豆粒サイズ）」になります。
    // 10.0 程度にすると、迫力を保ちつつ比率が正しい状態になります。
    MAGNIFICATION: 10.0 
};

// --- 彗星 API (NASA/JPL Horizons を AWS 経由で利用) ---
// API Gateway の Invoke URL をここに設定
const COMET_API_BASE = "https://erd043r1x3.execute-api.ap-northeast-1.amazonaws.com";


// --- 空の色設定 (高度に応じたベースカラー) ---
const SKY_GRADIENT = [
    { alt: -18, color: new THREE.Color('#050a14') }, 
    { alt: -6,  color: new THREE.Color('#0a1320') }, 
    { alt: 0,   color: new THREE.Color('#0f2035') }, 
    { alt: 6,   color: new THREE.Color('#142840') }, 
    { alt: 90,  color: new THREE.Color('#0a1a2a') }  
];

const CATALOG_FILES = [
    { type: 'star', file: 'stars_fulldata.json' },
    { type: 'ConstellationLines', file: 'constellation_lines.json' },
    { type: 'ConstellationLabels', file: 'constellation_labels.json' },

    { type: 'MultipleStar', file: 'Multiple_Star_list1.json' },
    { type: 'Galaxy', file: 'Galaxy_list1.json' },
    { type: 'GlobularCluster', file: 'Globular_Cluster_list1.json' },
    { type: 'OpenCluster', file: 'Open_Cluster_list1.json' },
    { type: 'EmissionNebula', file: 'Emission_Nebula_list1.json' },
    { type: 'ReflectionNebula', file: 'Reflection_Nebula_list1.json' },
    { type: 'PlanetaryNebula', file: 'Planetary_Nebula_list1.json' },
    { type: 'SupernovaRemnant', file: 'Supernova_Remnant_list1.json' }
];

let scene, camera, renderer, controls;
let groundMesh, gridHelper, compassGroup, skyMesh;
// 天の川用変数
let milkyWayGroup, milkyWayMesh;

let raycaster, mouse;
let layers = {}; 
let allCelestialObjects = []; 

// UIボタン管理用
let filterButtons = {};



// ---- 流星記録（追加） ----
let meteorUi = {
    container: null,
    btn: null,
    lifelogBtn: null,
    modeBanner: null,
    modal: null,
    modalOk: null,
    modalCancel: null,
    saveModal: null,
    saveModalInput: null,
        saveModalBrightness: null,
    saveModalStars: null,
    saveModalBrightnessLabel: null,
saveModalOk: null,
    saveModalCancel: null,
    hint: null,
    hintText: null,
    btnSave: null,
    btnReset: null,
};
let meteorTrackGroup = null; // sceneに追加する
let meteorPreviewLine = null; // 選択中のプレビュー
let meteorMarkSprite = null; // プレビュー先頭を流れる星マーク
let meteorMarkTextureLoader = null;
let meteorMarkHideTimeout = null;
let meteorPreviewAnimRaf = null;
let meteorPreviewAnimToken = 0;
let meteorStartMarker = null; // 1点目のピン
let meteorEndGlow = null;     // 2点目のピン（互換のため変数名は維持）
let meteorPinTextureLoader = null; // THREE.TextureLoader (lazy)
let meteorSavedTracks = [];   // { createdAt, lat, lon, dateIso, startAltAz, endAltAz, brightness }

const state = {
    lat: 35.6895, 
    lon: 139.6917,
    date: new Date(),
    gridVisible: true,
    sunlightVisible: true,
    magLimit: 4.5,
    shuttleValue: 0,
    selectedStarIndex: -1,
    selectedObject: null, 
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    
    clickCandidates: [],
    clickCandidateIndex: 0,
    lastClickTime: 0,

    // ピンチズーム用
    pinchStartDist: 0,
    pinchStartFov: 0,
    // --- 視点操作モード ---
    viewControlMode: 'touch',   // 'touch' | 'gyro'
    gyroEnabled: false,
    gyroPermissionGranted: false,
    gyroPreferAbsolute: true,   // 可能なら北基準（absolute）を優先
    gyroIsAbsolute: false,      // 現在のイベントが北基準を提供できているか
    gyroFallbackWarned: false,  // 相対フォールバック警告の多重表示防止

    // ジャイロ用スムージング
    gyroSlerp: 0.15,

    // 相対フォールバック用（absoluteが取れない端末向け）
    gyroOffset: new THREE.Quaternion(),
    gyroHasOffset: false,


    // コンパス（北基準）のオフセットを「ONした瞬間だけ」取得して以後固定（ジッタ低減）
    gyroCompassLocked: false,
    gyroCompassOffsetDeg: 0,



    // ---- 流星記録（追加） ----
    meteor: {
                displayEnabled: true,
mode: 'idle', // 'idle' | 'confirm' | 'selectStart' | 'selectEnd' | 'review'
        locked: false,
        lockedQuat: new THREE.Quaternion(),
        // 記録対象の時刻（state.date のスナップショット）
        lockedDate: null,


        // 明るさ（1〜5）
        lockedBrightness: 3,
        // 画面クリック位置（px）
        startScreen: null, // {x,y}
        endScreen: null,   // {x,y}

        // 天球上の点（Three.js座標、半径CONFIG.radius上）
        startWorld: null, // THREE.Vector3
        endWorld: null,   // THREE.Vector3

        // alt/az（度）…将来サーバ保存用
        startAltAz: null, // {altDeg, azDeg}
        endAltAz: null,   // {altDeg, azDeg}
    },
};

function init() {
    createStarNameDisplay();
    injectCustomStyles();

    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.bgColor);
    scene.fog = new THREE.FogExp2(CONFIG.bgColor, 0.0008);

    // 流星記録UI（scene生成後に初期化）
    initMeteorUi();
 

    // ---- Comets layer (added) ----
    layers.Comets = { data: [], mesh: new THREE.Group(), visible: false };
    layers.Comets.mesh.name = "Comets";
    layers.Comets.mesh.visible = false;
    scene.add(layers.Comets.mesh);
 

    camera = new THREE.PerspectiveCamera(CONFIG.maxFov, window.innerWidth / window.innerHeight, 1, 20000);
    
    const initialAlt = 15 * (Math.PI / 180);
    const dist = 1.0;
    camera.position.set(0, -Math.sin(initialAlt) * dist, -Math.cos(initialAlt) * dist);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false; 
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = -0.5;
    controls.target.set(0, 0, 0);
    controls.update();

    controls.addEventListener('start', () => { state.isDragging = true; });
    controls.addEventListener('end', () => { state.isDragging = false; });

    createSkyDome();
    createMilkyWay(); // 天の川の生成
    createGround();
    createGrid();
    createCompass();

    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 15; 
    
    mouse = new THREE.Vector2();

    setupUI();
    fetchAllData();

    createLayer('SolarSystem', []);
    updateSolarSystemData(); 

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointermove', onPointerMove);
    
    window.addEventListener('pointerdown', (e) => {
        if (e.isPrimary) {
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
        }
    });
    
    window.addEventListener('pointerup', onPointerUp);

    container.addEventListener('wheel', onMouseWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });

    // レイアウト調整関数の実行（初期化時）
    setTimeout(updateStarNameLayout, 100);
    setTimeout(updateStarNameLayout, 1000); // ロード完了後の念押し

    animate();
}

// --- ピンチズーム関連の関数 ---
function onTouchStart(e) {
    if (e.touches.length === 2) {
        const dx = e.touches[0].pageX - e.touches[1].pageX;
        const dy = e.touches[0].pageY - e.touches[1].pageY;
        state.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
        state.pinchStartFov = camera.fov;
    }
}

function onTouchMove(e) {
    if (e.touches.length === 2 && state.pinchStartDist > 0) {
        e.preventDefault();
        e.stopPropagation();

        const dx = e.touches[0].pageX - e.touches[1].pageX;
        const dy = e.touches[0].pageY - e.touches[1].pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const scale = state.pinchStartDist / dist;
        let newFov = state.pinchStartFov * scale;
        newFov = Math.max(CONFIG.minFov, Math.min(CONFIG.maxFov, newFov));
        
        camera.fov = newFov;
        camera.updateProjectionMatrix();
    }
}

function onTouchEnd(e) {
    if (e.touches.length < 2) {
        state.pinchStartDist = 0;
    }
}


// ------------------------------------------------------------
// ジャイロ（端末の向き＝視点の向き）制御
// - 可能なら北基準（absolute / webkitCompassHeading）で「実際に向けている方向」を反映
// - 取得できない端末では、相対（ON時基準）にフォールバック（仕様制約）
// ------------------------------------------------------------

function isMobileDevice() {
    return window.innerWidth <= 900;
}

let _onDeviceOrientation = null;
let _lastDeviceEvent = null;

// DeviceOrientationControls（three.js）由来の変換を最小実装
const _zee = new THREE.Vector3(0, 0, 1);
const _eulerDO = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X

function _getScreenOrientationRad() {
    const angle =
        (screen.orientation && typeof screen.orientation.angle === 'number')
            ? screen.orientation.angle
            : (typeof window.orientation === 'number' ? window.orientation : 0);
    return THREE.MathUtils.degToRad(angle);
}

// iOS Safari: webkitCompassHeading (0=N, 90=E...) が取れる場合はこれを優先。
// alpha は定義上の向きが異なるため、iOSは 360 - heading へ変換する。
function _getHeadingDegFromEvent(e) {
    if (typeof e.webkitCompassHeading === 'number') {
        return 360 - e.webkitCompassHeading; // iOS向け補正
    }
    if (e.absolute === true && typeof e.alpha === 'number') {
        return e.alpha; // absolute true の alpha は北基準になり得る
    }
    return null;
}

function _hasAbsoluteHeading(e) {
    return (typeof e?.webkitCompassHeading === 'number') || (e?.absolute === true);
}


function _normalizeDeg360(d) {
    let x = d % 360;
    if (x < 0) x += 360;
    return x;
}

// コンパス値（webkitCompassHeading）を使って、alpha（ジャイロ）に対する北基準オフセットを1回だけ決める。
// 以後は alpha + offset で北基準の見かけ方位を作り、webkitCompassHeadingは参照しない（ジッタ低減）。
function lockCompassOffsetOnce(e) {
    if (state.gyroCompassLocked) return false;
    if (typeof e?.webkitCompassHeading !== 'number') return false;
    if (typeof e?.alpha !== 'number') return false;

    const headingDeg = 360 - e.webkitCompassHeading; // iOS補正（0=N）
    const alphaDeg = e.alpha;

    state.gyroCompassOffsetDeg = _normalizeDeg360(headingDeg - alphaDeg);
    state.gyroCompassLocked = true;
    return true;
}

function setObjectQuaternionFromDevice(quaternion, alphaRad, betaRad, gammaRad, orientRad) {
    // Z-X'-Y''（YXZ）で組む
    _eulerDO.set(betaRad, alphaRad, -gammaRad, 'YXZ');
    quaternion.setFromEuler(_eulerDO);
    quaternion.multiply(_q1);
    quaternion.multiply(_q0.setFromAxisAngle(_zee, -orientRad));
    return quaternion.normalize();
}

function deviceEventToQuaternion(e) {
    if (!e || e.alpha == null || e.beta == null || e.gamma == null) return null;

    const orient = _getScreenOrientationRad();

    // 方位（ヨー）の決め方：
    // 1) コンパスON直後にロックしたオフセットがあれば alpha + offset で北基準にする（以後コンパス参照しない）
    // 2) まだロックしておらず webkitCompassHeading が取れるなら、それを一度だけロックして同様に扱う
    // 3) e.absolute === true の場合は alpha を北基準として扱う
    // 4) それ以外は alpha（相対）をそのまま使う（フォールバック）
    let alphaDeg;
    if (state.gyroCompassLocked) {
        alphaDeg = _normalizeDeg360(e.alpha + state.gyroCompassOffsetDeg);
    } else if (typeof e.webkitCompassHeading === 'number') {
        lockCompassOffsetOnce(e);
        if (state.gyroCompassLocked) {
            alphaDeg = _normalizeDeg360(e.alpha + state.gyroCompassOffsetDeg);
        } else {
            alphaDeg = 360 - e.webkitCompassHeading;
        }
    } else if (e.absolute === true && typeof e.alpha === 'number') {
        alphaDeg = e.alpha;
    } else {
        alphaDeg = e.alpha;
    }

    const alphaRad = THREE.MathUtils.degToRad(alphaDeg);
    const betaRad = THREE.MathUtils.degToRad(e.beta);
    const gammaRad = THREE.MathUtils.degToRad(e.gamma);

    const q = new THREE.Quaternion();
    setObjectQuaternionFromDevice(q, alphaRad, betaRad, gammaRad, orient);
    return q;
}

async function requestGyroPermissionIfNeeded() {
    // iOS 13+ Safari
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') throw new Error('permission denied');
    }
    return true;
}

function startGyro() {
    if (_onDeviceOrientation) return;

    _onDeviceOrientation = (e) => {
        if (e.alpha == null || e.beta == null || e.gamma == null) return;
        _lastDeviceEvent = e;
    };

    window.addEventListener('deviceorientation', _onDeviceOrientation, true);
}

function stopGyro() {
    if (!_onDeviceOrientation) return;
    window.removeEventListener('deviceorientation', _onDeviceOrientation, true);
    _onDeviceOrientation = null;
    _lastDeviceEvent = null;
}

// 絶対方位が取れない端末向け：ON時の向きを基準にするフォールバック
async function calibrateGyroToCurrentView() {
    if (!_lastDeviceEvent) return false;

    const qGyro0 = deviceEventToQuaternion(_lastDeviceEvent);
    if (!qGyro0) return false;

    const qCam0 = camera.quaternion.clone();
    const invGyro0 = qGyro0.clone().invert();

    state.gyroOffset = qCam0.multiply(invGyro0).normalize();
    state.gyroHasOffset = true;
    return true;
}

function applyGyroToCamera() {
    if (!_lastDeviceEvent) return;

    const qGyro = deviceEventToQuaternion(_lastDeviceEvent);
    if (!qGyro) return;

    // 絶対方位が取れるなら、そのまま端末向き＝視点向きにする（時間に依存しない）
    if (state.gyroIsAbsolute) {
        camera.quaternion.slerp(qGyro, state.gyroSlerp);
        return;
    }

    // 取れない場合は相対にフォールバック
    if (!state.gyroHasOffset) return;
    const qTarget = state.gyroOffset.clone().multiply(qGyro).normalize();
    camera.quaternion.slerp(qTarget, state.gyroSlerp);
}

function setControlsEnabledForCurrentMode() {
    if (!controls) return;

    // メニューが開いているときは常に無効
    const navOverlay = document.getElementById('nav-overlay');
    const menuOpen = navOverlay && navOverlay.classList.contains('open');
    if (menuOpen) {
        setControlsEnabledForCurrentMode();
        return;
    }

    // ジャイロ中は OrbitControls を無効、それ以外は有効
    controls.enabled = (state.viewControlMode !== 'gyro');
}


function updateGyroUI() {
    const btnMobileGyro = document.getElementById('btn-mobile-gyro');
    const btnMobileComets = document.getElementById('btn-mobile-comets');

    const gyroIconBtn = document.getElementById('gyro-icon-btn');
    const gyroIconImg = document.getElementById('gyro-icon-img');
    const iconBtn = document.getElementById('gyro-icon-btn');
    const iconImg = document.getElementById('gyro-icon-img');

    const isOn = (state.viewControlMode === 'gyro' && state.gyroEnabled);

    if (btnMobileGyro) btnMobileGyro.classList.toggle('active', isOn);

    if (iconBtn) {
        iconBtn.classList.toggle('on', isOn);
        iconBtn.classList.toggle('off', !isOn);
        iconBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    }

    if (iconImg) {
        // ※実際の画像パスは運用側に合わせてください
        iconImg.src = isOn ? 'assets/img/on_icon.png' : 'assets/img/off_icon.png';
    }
}

async function setViewControlMode(mode) {
    state.viewControlMode = mode;

    const btnMobileGyro = document.getElementById('btn-mobile-gyro');

    if (mode === 'gyro') {
        try {
            if (!isMobileDevice()) throw new Error('not mobile');

            await requestGyroPermissionIfNeeded();
            state.gyroPermissionGranted = true;

            startGyro();
            state.gyroEnabled = true;

            
            // 毎回ONするたびに「その瞬間だけ」方位（コンパス）を再取得する
            state.gyroCompassLocked = false;
            state.gyroCompassOffsetDeg = 0;
// タッチ回転は止める（ピンチズーム等の既存タッチ処理は独立のため影響なし）
            if (controls) setControlsEnabledForCurrentMode();

            // 最初のイベントを待って absolute か判定
            state.gyroIsAbsolute = false;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 16));
                if (_lastDeviceEvent) {
                    if (typeof _lastDeviceEvent.webkitCompassHeading === 'number') {
                        lockCompassOffsetOnce(_lastDeviceEvent);
                    }
                    state.gyroIsAbsolute = _hasAbsoluteHeading(_lastDeviceEvent) || state.gyroCompassLocked;
                    break;
                }
            }

            // absolute が取れない場合のみ相対フォールバック
            state.gyroHasOffset = false;
            if (!state.gyroIsAbsolute) {
                for (let i = 0; i < 20; i++) {
                    await new Promise(r => setTimeout(r, 16));
                    if (await calibrateGyroToCurrentView()) break;
                }
                if (!state.gyroFallbackWarned) {
                    state.gyroFallbackWarned = true;
                    alert('この端末/ブラウザでは「北基準の方位（コンパス）」が取得できないため、ジャイロは相対モード（ON時基準）で動作します。端末のコンパス許可/設定、HTTPS配信をご確認ください。');
                }
            }
            updateGyroUI();
        } catch (e) {
            state.gyroEnabled = false;
            state.gyroHasOffset = false;
            state.gyroIsAbsolute = false;
            stopGyro();
            if (controls) setControlsEnabledForCurrentMode();
            updateGyroUI();

            alert('ジャイロを有効化できませんでした（ブラウザ設定/HTTPS/許可をご確認ください）');
            state.viewControlMode = 'touch';
        }
    } else {
        // touch
        state.gyroEnabled = false;
        state.gyroHasOffset = false;
        state.gyroIsAbsolute = false;
        stopGyro();
        if (controls) setControlsEnabledForCurrentMode();
            updateGyroUI();
    }

    setControlsEnabledForCurrentMode();
}

function createStarNameDisplay() {
    if (document.getElementById('selected-star-name-display')) return;
    const container = document.createElement('div');
    container.id = 'selected-star-name-display';
    const textSpan = document.createElement('span');
    textSpan.id = 'display-star-name-text';
    container.appendChild(textSpan);
    document.body.appendChild(container);
}

function injectCustomStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        #selected-star-name-display {
            position: fixed;
            bottom: 70px; 
            left: 50%;
            transform: translateX(-50%);
            width: auto;
            min-width: 300px;
            text-align: center;
            pointer-events: none;
            z-index: 5;
            padding: 15px 50px;
            background: radial-gradient(ellipse at center, rgba(5, 10, 20, 0.9) 0%, rgba(5, 10, 20, 0.5) 40%, rgba(5, 10, 20, 0) 80%);
            font-family: 'Shippori Mincho', serif;
            font-size: 1.1rem;
            color: #fff;
            text-shadow: 0 0 5px rgba(0,0,0,1), 0 0 8px var(--accent-gold);
            letter-spacing: 0.1em;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        #selected-star-name-display.visible { opacity: 1; }
        #star-reticle {
            position: fixed; z-index: 1000; display: none; pointer-events: none !important;
        }
        #star-reticle.visible { display: block; }
        #reticle-name { display: none !important; }
        #btn-more {
            display: block; font-family: 'Shippori Mincho', serif; font-size: 0.85rem !important;
            padding: 6px 14px !important; color: #d4af37 !important;
            border: 1px solid rgba(212, 175, 55, 0.8) !important;
            background: rgba(5, 10, 20, 0.85) !important;
            border-radius: 20px; cursor: pointer;
            pointer-events: auto;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            backdrop-filter: blur(4px); white-space: nowrap; transition: all 0.2s;
            pointer-events: auto !important;
            transform: translate(25px, 25px); 
        }
        #btn-more:active {
            background: rgba(212, 175, 55, 0.3) !important;
            transform: translate(25px, 25px) scale(0.95);
        }
        #side-dock { z-index: 5000 !important; }
        @media (max-width: 900px) {
            #selected-star-name-display {
                /* JS制御になるためCSSでの固定値は補助的なもの */
                bottom: 200px; 
                font-size: 1.0rem; padding: 10px 40px;
                background: radial-gradient(ellipse at center, rgba(5, 10, 20, 0.95) 0%, rgba(5, 10, 20, 0.6) 30%, rgba(5, 10, 20, 0) 70%);
            }
        }

        /* --- ジャイロ切替アイコン（上部） --- */
        #gyro-icon-btn {
            position: fixed;
            z-index: 6000;
            left: 16px;
            top: calc(env(safe-area-inset-top, 0px) + 60px);
            width: 46px;
            height: 46px;
            padding: 0;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 999px;
            background: rgba(5, 10, 20, 0.55);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            display: none; /* PCは非表示、スマホのみ */
            align-items: center;
            justify-content: center;
            cursor: pointer;
            pointer-events: auto;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            transition: transform 0.12s ease, opacity 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        #gyro-icon-btn img {
            width: 28px;
            height: 28px;
            display: block;
            pointer-events: none;
            transition: filter 0.25s ease, opacity 0.25s ease;
        }
        #gyro-icon-btn::before {
            content: "";
            position: fixed;
            inset: -10px;
            border-radius: 999px;
            opacity: 0;
            transition: opacity 0.25s ease;
            pointer-events: none;
            background: radial-gradient(circle, rgba(120, 190, 255, 0.55) 0%, rgba(120, 190, 255, 0.18) 35%, rgba(120, 190, 255, 0.0) 70%);
        }
        #gyro-icon-btn.on {
            border-color: rgba(120, 190, 255, 0.65);
            box-shadow: 0 0 16px rgba(120, 190, 255, 0.35), inset 0 0 12px rgba(120, 190, 255, 0.12);
        }
        #gyro-icon-btn.on::before { opacity: 1; }
        #gyro-icon-btn.on img {
            filter: drop-shadow(0 0 8px rgba(120, 190, 255, 0.9)) drop-shadow(0 0 14px rgba(120, 190, 255, 0.55));
            opacity: 1;
        }
        #gyro-icon-btn.off img {
            filter: grayscale(1) brightness(0.85);
            opacity: 0.7;
        }
        #gyro-icon-btn:active { transform: scale(0.94); }

        /* 既存の画面下「ジャイロ」ボタンは非表示（ロジックは残す） */
        @media (max-width: 900px) {
            #btn-mobile-gyro { display: none !important; }
            #gyro-icon-btn { display: flex; }
        }
    
        /* ---- 流星記録 UI（追加） ---- */
        #meteor-icon-btn {
            position: fixed;
            width: 44px;
            height: 44px;
            top: 14px;
            left: 14px;
            z-index: 30000;
            pointer-events: auto;
            border: 1px solid rgba(255,255,255,0.25);
            background: rgba(10, 14, 20, 0.55);
            border-radius: 999px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }
        #meteor-icon-btn:active { transform: scale(0.98); }
        #meteor-icon-btn img {
            width: 80%;
            height: 80%;
            object-fit: contain;
            pointer-events: none;
            display: block;
            filter: drop-shadow(0 0 6px rgba(255,255,255,0.25));
        }

        /* off/on states (meteor icon) */
        #meteor-icon-btn.off {
            background: rgba(40, 40, 45, 0.45);
            border-color: rgba(255,255,255,0.18);
        }
        #meteor-icon-btn.off img {
            filter:
                grayscale(1)
                brightness(0.85)
                contrast(0.95)
                drop-shadow(0 0 4px rgba(0,0,0,0.25));
            opacity: 0.9;
        }

        #meteor-icon-btn.on {
            background: rgba(10, 14, 20, 0.55);
            border-color: rgba(255,255,255,0.28);
        }
        #meteor-icon-btn.on img {
            opacity: 1;
            filter:
                drop-shadow(0 0 6px rgba(255,255,255,0.30))
                drop-shadow(0 0 10px rgba(120, 180, 255, 0.20));
        }

        /* glow when recording */
        #meteor-icon-btn.on.recording {
            box-shadow:
                0 0 10px rgba(120, 180, 255, 0.95),
                0 0 20px rgba(120, 180, 255, 0.55),
                0 0 34px rgba(120, 180, 255, 0.32);
            border-color: rgba(120, 180, 255, 0.95);
            background: rgba(30, 60, 95, 0.55);
        }
        #meteor-icon-btn.on.recording img {
            filter:
                drop-shadow(0 0 8px rgba(255,255,255,0.40))
                drop-shadow(0 0 14px rgba(120, 180, 255, 0.55));
        }

#meteor-hint {
            position: fixed;
            top: 62px;
            left: 14px;
            z-index: 30000;
            pointer-events: none;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(10, 14, 20, 0.55);
            border: 1px solid rgba(255,255,255,0.18);
            color: rgba(255,255,255,0.9);
            font-size: 13px;
            line-height: 1.35;
            max-width: min(360px, calc(100vw - 28px));
            opacity: 0;
            transform: translateY(-6px);
            transition: opacity 0.18s ease, transform 0.18s ease;
        }

            /* レビュー中の「保存 / やり直し」ボタンはヒントの直下にまとめて表示 */
            #meteor-actions {
                position: fixed !important;
                left: 50% !important;
                right: auto !important;
                top: auto !important;
                bottom: calc(env(safe-area-inset-bottom) + 150px) !important;
                transform: translateX(-50%) !important;
                display: flex;
                gap: 10px;
                padding: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                z-index: 42060;
                pointer-events: auto;
            }
            #meteor-actions button {
                min-width: 96px;
            }
        #meteor-hint.visible {
            opacity: 1;
            transform: translateY(0px);
        }



        /* ---- 流星記録モード 表示（追加） ---- */
        #meteor-mode-banner {
            position: fixed;
            top: calc(env(safe-area-inset-top, 0px) + 14px);
            left: 50%;
            transform: translateX(-50%) translateY(-10px);
            z-index: 35000;
            pointer-events: none;
            padding: 10px 18px;
            border-radius: 999px;

            /* 少し目立つように */
            background: rgba(10, 14, 20, 0.70);
            border: 1px solid rgba(210, 255, 230, 0.55);
            box-shadow: 0 0 14px rgba(120, 255, 200, 0.28), 0 6px 18px rgba(0,0,0,0.35);
            -webkit-backdrop-filter: blur(6px);
            backdrop-filter: blur(6px);

            color: rgba(220, 255, 238, 0.98); /* 白っぽい緑 */
            font-size: 18px;
            font-weight: 800;
            letter-spacing: 0.10em;
            text-shadow: 0 0 14px rgba(120, 255, 200, 0.55), 0 0 6px rgba(120, 255, 200, 0.25), 0 0 3px rgba(0,0,0,0.75);

            opacity: 0;
            transition: opacity 0.18s ease, transform 0.18s ease;
        }
        #meteor-mode-banner.visible {
            opacity: 1;
            transform: translateX(-50%) translateY(0px);
        }

        #meteor-modal {
            position: fixed;
            inset: 0;
            z-index: 40000;
            display: none;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            background: rgba(0,0,0,0.45);
        }
        #meteor-modal .panel {
            width: min(420px, calc(100vw - 32px));
            background: rgba(10, 14, 20, 0.92);
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 16px;
            padding: 16px;
            color: rgba(255,255,255,0.92);
            box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }
        #meteor-modal .title {
            font-size: 15px;
            margin-bottom: 10px;
        }
        #meteor-modal .desc {
            font-size: 13px;
            opacity: 0.85;
            margin-bottom: 14px;
        }
        #meteor-modal .row {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }

        /* ---- 流星 保存確認モーダル（スタイル調整・v3） ---- */
#meteor-save-modal {
    position: fixed;
    inset: 0;
    z-index: 41000;
    display: none;
    align-items: center;
    justify-content: center;
    pointer-events: auto;

    /* darker overlay + subtle blur for "glass" feel */
    background: rgba(0,0,0,0.56);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
}
#meteor-save-modal .panel {
    width: min(480px, calc(100vw - 32px));
    padding: 18px 18px 16px;
    border-radius: 18px;

    /* glassmorphism */
    background: linear-gradient(180deg, rgba(18, 22, 30, 0.92), rgba(10, 14, 20, 0.86));
    border: 1px solid rgba(255,255,255,0.20);
    box-shadow:
        0 18px 50px rgba(0,0,0,0.55),
        0 0 0 1px rgba(255,255,255,0.04) inset;

    color: rgba(255,255,255,0.92);
}
#meteor-save-modal .title {
    display: flex;
    align-items: center;
    gap: 10px;

    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
}
#meteor-save-modal .title::before {
    content: "";
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(120, 190, 255, 0.85);
    box-shadow: 0 0 0 3px rgba(120, 190, 255, 0.14);
    flex: 0 0 auto;
}
#meteor-save-modal .desc {
    font-size: 13px;
    line-height: 1.55;
    color: rgba(255,255,255,0.78);
    margin-bottom: 14px;
}

#meteor-save-modal .section {
    margin-top: 12px;
    padding: 12px;
    border-radius: 14px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12);
}
#meteor-save-modal .field-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.88);
    margin-bottom: 4px;
}
#meteor-save-modal .helper {
    font-size: 12px;
    line-height: 1.45;
    color: rgba(255,255,255,0.68);
}

#meteor-save-modal .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
    margin-bottom: 0;
}

#meteor-save-modal input[type="datetime-local"] {
    border-radius: 12px;
    padding: 11px 12px;
    font-size: 14px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.92);
    outline: none;
}
#meteor-save-modal input[type="datetime-local"]:focus {
    border-color: rgba(120, 190, 255, 0.55);
    box-shadow: 0 0 0 3px rgba(120, 190, 255, 0.16);
}

@media (hover: none) and (pointer: coarse) {
    /* スマートフォンでは datetime-local のカレンダー（ピッカー）アイコン領域ごと消して、横幅が伸びるのを防ぐ */
    #meteor-save-modal input[type="datetime-local"] {
        -webkit-appearance: none;
        appearance: none;
        padding-right: 12px !important; /* アイコン用の余白を作らない */
        min-width: 0;
        max-width: 100%;
    }
    /* アイコン自体 + その予約領域（indicator）を非表示 */
    #meteor-save-modal input[type="datetime-local"]::-webkit-calendar-picker-indicator {
        display: none !important;
        -webkit-appearance: none !important;
        width: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
    }
    /* 一部ブラウザの余計なUIを抑制 */
    #meteor-save-modal input[type="datetime-local"]::-webkit-inner-spin-button,
    #meteor-save-modal input[type="datetime-local"]::-webkit-clear-button {
        display: none !important;
    }
}

 /* star selector container */
#meteor-save-modal .meteor-stars {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    width: fit-content;
}
#meteor-save-modal .meteor-star {
    background: transparent;
    border: none;
    padding: 0 3px;
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
    color: rgba(255,255,255,0.33);
    text-shadow: 0 0 8px rgba(255,255,255,0.10);
    transition: transform 0.12s ease, color 0.12s ease, text-shadow 0.12s ease;
}
#meteor-save-modal .meteor-star.active {
    color: rgba(255, 215, 120, 0.95);
    text-shadow: 0 0 10px rgba(255, 215, 120, 0.28);
}
#meteor-save-modal .meteor-star:active {
    transform: scale(0.92);
}
#meteor-save-modal .meteor-brightness-label {
    margin-top: 8px;
    font-size: 12px;
    color: rgba(255,255,255,0.78);
}

#meteor-save-modal .row {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 16px;
}
#meteor-save-modal .row button {
    min-width: 120px;
}
#meteor-save-modal button {
    border-radius: 12px;
    padding: 11px 14px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;

    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.92);
}
#meteor-save-modal button.primary {
    background: rgba(120, 190, 255, 0.20);
    border-color: rgba(120, 190, 255, 0.42);
}

@media (max-width: 420px) {
    #meteor-save-modal .row {
        flex-direction: column;
        align-items: stretch;
    }
    #meteor-save-modal .row button {
        width: 100%;
    }
}
        #meteor-modal button {
            border-radius: 10px;
            padding: 10px 12px;
            font-size: 13px;
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.18);
            background: rgba(255,255,255,0.08);
            color: rgba(255,255,255,0.92);
        }
        #meteor-modal button.primary {
            background: rgba(120, 190, 255, 0.18);
            border-color: rgba(120, 190, 255, 0.35);
        }

        #meteor-actions {
            position: fixed;
            top: 118px;
            left: 14px;
            z-index: 30000;
            display: none;
            gap: 8px;
            pointer-events: auto;
        }

        #meteor-icon-btn.recording {
            box-shadow:
                0 0 8px rgba(120, 180, 255, 0.9),
                0 0 16px rgba(120, 180, 255, 0.6),
                0 0 28px rgba(120, 180, 255, 0.35);
            border-color: rgba(120, 180, 255, 0.9);
            background: rgba(40, 80, 120, 0.55);
        }

        #meteor-actions button {
            border-radius: 12px;
            padding: 9px 10px;
            font-size: 13px;
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.18);
            background: rgba(10, 14, 20, 0.55);
            color: rgba(255,255,255,0.92);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }
        /* ボタン色分け（更新）
           - 常時の背景色で区別（ホバー/タップ(:active)でも変えない）
           - 外部CSSの:hover/:active/:focusで上書きされても負けないように !important を付与
           - 発光（box-shadow）はなし
        */
        #meteor-actions #meteor-save-btn,
        #meteor-actions #meteor-save-btn:hover,
        #meteor-actions #meteor-save-btn:active,
        #meteor-actions #meteor-save-btn:focus,
        #meteor-actions #meteor-save-btn:focus-visible {
            /* 保存：やや青っぽい */
            background: rgba(120, 190, 255, 0.22) !important;
            border-color: rgba(120, 190, 255, 0.45) !important;
            box-shadow: none !important;
            outline: none;
        }
        #meteor-actions #meteor-reset-btn,
        #meteor-actions #meteor-reset-btn:hover,
        #meteor-actions #meteor-reset-btn:active,
        #meteor-actions #meteor-reset-btn:focus,
        #meteor-actions #meteor-reset-btn:focus-visible {
            /* やり直し：わずかにグレー */
            background: rgba(255, 255, 255, 0.10) !important;
            border-color: rgba(255, 255, 255, 0.22) !important;
            box-shadow: none !important;
            outline: none;
        }

/* ---- 流星 明るさ★セレクタ（追加） ---- */
        #meteor-save-modal .meteor-stars {
            display: flex;
            gap: 6px;
            align-items: center;
            justify-content: flex-start;
            user-select: none;
        }
        #meteor-save-modal .meteor-star {
            appearance: none;
            border: none;
            background: transparent;
            padding: 0 2px;
            cursor: pointer;
            font-size: 22px;
            line-height: 1;
            color: rgba(255,255,255,0.35);
            text-shadow: 0 0 8px rgba(255,255,255,0.12);
            transition: transform 0.12s ease, color 0.12s ease, text-shadow 0.12s ease;
        }
        #meteor-save-modal .meteor-star.active {
            color: rgba(255, 215, 120, 0.95);
            text-shadow: 0 0 10px rgba(255, 215, 120, 0.28);
        }
        #meteor-save-modal .meteor-star:active {
            transform: scale(0.92);
        }
        #meteor-save-modal .meteor-brightness-label {
            margin-top: 6px;
            font-size: 12px;
            opacity: 0.9;
        }



/* =========================
   UI refresh (v2)
   - visually modernize windows & buttons
   - keep existing IDs/classes and behavior intact
   ========================= */

:root {
    --ui-bg: rgba(10, 14, 20, 0.78);
    --ui-bg-strong: rgba(10, 14, 20, 0.92);
    --ui-border: rgba(255,255,255,0.18);
    --ui-border-strong: rgba(255,255,255,0.28);
    --ui-text: rgba(255,255,255,0.92);
    --ui-text-dim: rgba(255,255,255,0.72);
    --ui-accent: rgba(120, 190, 255, 0.92);
    --ui-accent-soft: rgba(120, 190, 255, 0.22);
    --ui-warn: rgba(255, 120, 120, 0.88);
    --ui-shadow: 0 18px 55px rgba(0,0,0,0.46);
    --ui-radius: 18px;
    --ui-radius-sm: 12px;
    --ui-pad: 16px;
}

/* Give UI a consistent type feel without touching the whole page */
#meteor-modal, #meteor-save-modal, #meteor-actions, #meteor-icon-btn, #lifelog-icon-btn, #gyro-icon-btn, #meteor-hint, #selected-star-name-display {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
    letter-spacing: 0.01em;
}

/* --- Modals backdrop --- */
#meteor-modal {
    background: radial-gradient(1200px 800px at 50% 30%, rgba(10,14,20,0.45) 0%, rgba(0,0,0,0.62) 55%, rgba(0,0,0,0.78) 100%);
    /* NOTE: 「流星が流れた方向を向いていますか？」のウィンドウでは背景をぼかさない */
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}
#meteor-save-modal {
    background: radial-gradient(1200px 800px at 50% 30%, rgba(10,14,20,0.45) 0%, rgba(0,0,0,0.62) 55%, rgba(0,0,0,0.78) 100%);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
}

/* --- Mobile emphasis & placement (meteor guidance) --- */
@media (max-width: 600px) {
    /* 方向確認モーダルは、画面下の時刻表示の少し上に寄せる */
    #meteor-modal {
        align-items: flex-end;
        padding: 0 14px calc(env(safe-area-inset-bottom) + 160px); /* bottom: time labels の上あたり */
    }
    #meteor-modal .panel {
        width: min(520px, calc(100vw - 28px));
        border-radius: 18px;
        box-shadow:
            0 18px 55px rgba(0,0,0,0.55),
            0 0 0 1px rgba(255,255,255,0.14) inset;
    }
    #meteor-modal .desc {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.02em;
        opacity: 0.95;
        line-height: 1.5;
    }
    #meteor-modal .title {
        font-size: 13px;
        opacity: 0.80;
        margin-bottom: 8px;
    }
    #meteor-modal .row button {
        height: 46px;
        font-size: 15px;
        border-radius: 12px;
    }

    /* 「始点/終点をタップしてください」を下寄せ＆強調（JSのleft/top追従はCSSで上書き） */
    #meteor-hint {
        left: 50% !important;
        top: auto !important;
        bottom: calc(env(safe-area-inset-bottom) + 200px);
        transform: translateX(-50%);
        width: min(520px, calc(100vw - 28px));
        text-align: center;
        padding: 14px 16px;
        border-radius: 16px;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.02em;
        background: rgba(255,255,255,0.10);
        border: 1px solid rgba(255,255,255,0.20);
        box-shadow:
            0 18px 55px rgba(0,0,0,0.45),
            0 0 0 1px rgba(255,255,255,0.10) inset,
            0 0 18px rgba(120, 180, 255, 0.18);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
    }
    #meteor-hint.visible {
        animation: meteorHintPulse 1.35s ease-in-out infinite;
    }
}
@keyframes meteorHintPulse {
    0%, 100% { transform: translateX(-50%) scale(1.0); }
    50%      { transform: translateX(-50%) scale(1.02); }
}

/* --- Panels --- */
#meteor-modal .panel,
#meteor-save-modal .panel {
    background: linear-gradient(180deg, rgba(18,24,35,0.92) 0%, rgba(10,14,20,0.88) 100%);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius);
    box-shadow: var(--ui-shadow);
    padding: calc(var(--ui-pad) + 2px);
    position: relative;
    overflow: hidden;
}

/* subtle highlight line */
#meteor-modal .panel::before,
#meteor-save-modal .panel::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(900px 420px at 30% 0%, rgba(120,190,255,0.16), rgba(0,0,0,0) 60%),
      radial-gradient(600px 360px at 90% 10%, rgba(255,216,74,0.10), rgba(0,0,0,0) 55%);
    opacity: 0.95;
}

#meteor-modal .title,
#meteor-save-modal .title {
    font-size: 15px;
    font-weight: 650;
    margin-bottom: 8px;
}
#meteor-modal .desc,
#meteor-save-modal .desc {
    color: var(--ui-text-dim);
    line-height: 1.55;
}

/* --- Fields / Inputs --- */
#meteor-save-modal label,
#meteor-modal label {
    color: rgba(255,255,255,0.82);
    font-weight: 600;
}

#meteor-save-modal input[type="text"],
#meteor-save-modal input[type="datetime-local"],
#meteor-modal input[type="text"] {
    width: 100%;
    box-sizing: border-box;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text);
    padding: 11px 12px;
    outline: none;
    transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
#meteor-save-modal input[type="text"]::placeholder {
    color: rgba(255,255,255,0.42);
}
#meteor-save-modal input[type="text"]:focus,
#meteor-save-modal input[type="datetime-local"]:focus,
#meteor-modal input[type="text"]:focus {
    border-color: rgba(120,190,255,0.55);
    box-shadow: 0 0 0 3px rgba(120,190,255,0.18);
    background: rgba(255,255,255,0.08);
}

/* --- Buttons --- */
#meteor-modal button,
#meteor-save-modal button {
    border-radius: 999px;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.08);
    color: var(--ui-text);
    transition: transform 0.12s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
    -webkit-tap-highlight-color: transparent;
}
#meteor-modal button:hover,
#meteor-save-modal button:hover { background: rgba(255,255,255,0.11); }
#meteor-modal button:active,
#meteor-save-modal button:active { transform: translateY(1px) scale(0.99); }

#meteor-modal button.primary,
#meteor-save-modal button.primary {
    background: linear-gradient(180deg, rgba(120,190,255,0.28) 0%, rgba(120,190,255,0.18) 100%);
    border-color: rgba(120,190,255,0.42);
    box-shadow: 0 0 0 0 rgba(120,190,255,0.0);
}
#meteor-modal button.primary:hover,
#meteor-save-modal button.primary:hover {
    border-color: rgba(120,190,255,0.62);
    background: linear-gradient(180deg, rgba(120,190,255,0.34) 0%, rgba(120,190,255,0.22) 100%);
    box-shadow: 0 10px 26px rgba(120,190,255,0.18);
}

#meteor-modal button.danger,
#meteor-save-modal button.danger {
    border-color: rgba(255,120,120,0.35);
    background: rgba(255,120,120,0.10);
}

#meteor-modal button:focus-visible,
#meteor-save-modal button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(120,190,255,0.22);
    border-color: rgba(120,190,255,0.6);
}

/* --- Star rating polish --- */
#meteor-save-modal .meteor-stars {
    padding: 10px 12px;
    border-radius: var(--ui-radius-sm);
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06);
}
#meteor-save-modal .meteor-star {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    transition: transform 0.12s ease, background 0.18s ease, filter 0.18s ease, opacity 0.18s ease;
}
#meteor-save-modal .meteor-star:hover { transform: translateY(-1px) scale(1.04); background: transparent !important; }

/* --- Icon buttons (meteor + gyro) slightly refined --- */
#meteor-icon-btn, #gyro-icon-btn {
    box-shadow: 0 12px 26px rgba(0,0,0,0.28);
    border-color: rgba(255,255,255,0.22);
}
#meteor-icon-btn:hover, #gyro-icon-btn:hover {
    border-color: rgba(255,255,255,0.34);
    box-shadow: 0 16px 34px rgba(0,0,0,0.34);
}

/* Mobile: a bit more breathing room in panels */
@media (max-width: 600px) {
    #meteor-modal .panel,
    #meteor-save-modal .panel {
        padding: 16px;
    }
}


/* --- Meteor recording: blur only the bottom operation area (mobile controls / clock / location) --- */
body.meteor-recording-active #mobile-controls,
body.meteor-recording-active #mobile-clock-display,
body.meteor-recording-active #mobile-location-display,
body.meteor-recording-active #mobile-time-shuttle,
body.meteor-recording-active #mobile-mag-slider,
body.meteor-recording-active #mobile-mag-value {
    filter: blur(6px);
    opacity: 0.35;
    pointer-events: none;
    transition: filter 0.18s ease, opacity 0.18s ease;
}

body.meteor-recording-active #mobile-controls * {
    pointer-events: none;
}


/* =========================
   Meteor save modal: final polish overrides (v3)
   - keep behavior intact
   - ensure styles win over global/UI refresh rules
   ========================= */
#meteor-save-modal { 
    background: rgba(0,0,0,0.56) !important;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
}
#meteor-save-modal .panel {
    width: min(480px, calc(100vw - 32px)) !important;
    padding: 18px 18px 16px !important;
    border-radius: 18px !important;
    background: linear-gradient(180deg, rgba(18, 22, 30, 0.92), rgba(10, 14, 20, 0.86)) !important;
    border: 1px solid rgba(255,255,255,0.20) !important;
    box-shadow:
        0 18px 50px rgba(0,0,0,0.55),
        0 0 0 1px rgba(255,255,255,0.04) inset !important;
}

#meteor-save-modal .section { margin-top: 14px !important; }

#meteor-save-modal .field-label {
    font-size: 16px !important;
    font-weight: 700 !important;
    letter-spacing: 0.02em !important;
    margin-bottom: 8px !important;
}

/* datetime input: centered + larger text */
#meteor-save-modal #meteor-save-datetime {
    display: block !important;
    width: 100% !important;
    max-width: 360px !important;
    margin: 0 auto !important;
    text-align: center !important;
    font-size: 16px !important;
    padding: 10px 12px !important;
    border-radius: 12px !important;
}

/* stars: bigger, centered, evenly spaced */
#meteor-save-modal .meteor-stars {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 0 !important;
    width: 100% !important;
    max-width: 360px !important;
    margin: 0 auto !important;
    padding: 10px 14px !important;
    border-radius: 999px !important;
}

#meteor-save-modal .meteor-star {
    flex: 1 1 0 !important;
    text-align: center !important;
    font-size: 34px !important;
    line-height: 1 !important;
    padding: 0 !important;
}

@media (max-width: 520px) {
    #meteor-save-modal .panel { padding: 16px 14px 14px !important; }
    #meteor-save-modal .field-label { font-size: 17px !important; }
    #meteor-save-modal #meteor-save-datetime { font-size: 17px !important; }
    #meteor-save-modal .meteor-star { font-size: 38px !important; }
}

#meteor-save-modal .title {
    font-size: 17px !important;
    font-weight: 800 !important;
    letter-spacing: 0.04em !important;
    margin-bottom: 6px !important;
}
#meteor-save-modal .desc {
    color: rgba(255,255,255,0.78) !important;
    line-height: 1.55 !important;
    margin-bottom: 14px !important;
}
#meteor-save-modal .section {
    background: rgba(255,255,255,0.05) !important;
    border: 1px solid rgba(255,255,255,0.12) !important;
    border-radius: 14px !important;
    padding: 12px !important;
}
#meteor-save-modal input[type="datetime-local"] {
    border-radius: 12px !important;
    background: rgba(255,255,255,0.07) !important;
}
#meteor-save-modal .row button {
    border-radius: 12px !important;
    font-weight: 700 !important;
}
#meteor-save-modal button.primary {
    background: rgba(120, 190, 255, 0.20) !important;
    border-color: rgba(120, 190, 255, 0.42) !important;
}

/* --- Meteor brightness stars: hollow/filled & no background (requested) --- */
#meteor-save-modal .meteor-star,
#meteor-save-modal .meteor-star:hover,
#meteor-save-modal .meteor-star:active,
#meteor-save-modal .meteor-star:focus,
#meteor-save-modal .meteor-star:focus-visible {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    outline: none;
}

#meteor-save-modal .meteor-star {
    /* hollow star (☆) will use this color */
    color: rgba(212, 175, 55, 0.55) !important;
    text-shadow: 0 0 10px rgba(212, 175, 55, 0.18);
}

#meteor-save-modal .meteor-star.active {
    /* filled star (★) uses a deeper yellow */
    color: #d4af37 !important;
    text-shadow: 0 0 12px rgba(212, 175, 55, 0.28);
}

`;
    document.head.appendChild(style);
}

function onMouseWheel(event) {
    event.preventDefault();
    const speed = 0.05;
    camera.fov += event.deltaY * speed;
    camera.fov = Math.max(CONFIG.minFov, Math.min(CONFIG.maxFov, camera.fov));
    camera.updateProjectionMatrix();
}

function toDateInputValue(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
}

function toDateTimeLabel(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}/${pad(dateObj.getMonth() + 1)}/${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
}

function normalizeCaptureDataUrl(sourceCanvas, maxSide, quality) {
    const srcW = sourceCanvas?.width || 0;
    const srcH = sourceCanvas?.height || 0;
    if (!srcW || !srcH) return null;

    const safeMaxSide = Math.max(320, Math.min(2200, Math.round(Number(maxSide) || 1400)));
    const safeQuality = Math.max(0.55, Math.min(0.92, Number(quality) || 0.8));

    let outW = srcW;
    let outH = srcH;
    const longest = Math.max(srcW, srcH);
    if (longest > safeMaxSide) {
        const scale = safeMaxSide / longest;
        outW = Math.max(1, Math.round(srcW * scale));
        outH = Math.max(1, Math.round(srcH * scale));
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.drawImage(sourceCanvas, 0, 0, outW, outH);
    return outCanvas.toDataURL('image/jpeg', safeQuality);
}

function captureSkyDataUrlWithFallback(targetMaxChars = 1900000) {
    if (!renderer || !renderer.domElement) return null;
    renderer.render(scene, camera);

    const srcCanvas = renderer.domElement;
    const presets = [
        { maxSide: 1800, quality: 0.85 },
        { maxSide: 1400, quality: 0.78 },
        { maxSide: 1100, quality: 0.72 }
    ];

    let fallback = null;
    for (const p of presets) {
        const dataUrl = normalizeCaptureDataUrl(srcCanvas, p.maxSide, p.quality);
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
            fallback = dataUrl;
            if (!targetMaxChars || dataUrl.length <= targetMaxChars) return dataUrl;
        }
    }
    return fallback;
}

function isStorageQuotaError(err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('QuotaExceededError') || msg.includes('quota') || msg.includes('storage')) {
        return true;
    }
    if (typeof err?.code === 'number' && err.code === 22) return true;
    return false;
}

function persistLifelogCapturePayload() {
    const tryLimits = [1900000, 1400000, 1000000];
    let lastError = null;

    for (const limit of tryLimits) {
        const imageBase64 = captureSkyDataUrlWithFallback(limit);
        if (!imageBase64) continue;
        const payload = buildLifelogCapturePayload(imageBase64);

        try {
            localStorage.setItem(LIFELOG_CAPTURE_STORAGE_KEY, JSON.stringify(payload));
            return true;
        } catch (e) {
            lastError = e;
            if (!isStorageQuotaError(e)) throw e;
        }
    }

    if (lastError) throw lastError;
    return null;
}

function openLifelogPopupShell() {
    const w = Math.max(420, Math.min(620, Math.round(window.innerWidth * 0.92)));
    const h = Math.max(620, Math.min(920, Math.round(window.innerHeight * 0.94)));
    const left = Math.max(0, Math.round((window.screen.width - w) / 2));
    const top = Math.max(0, Math.round((window.screen.height - h) / 2));
    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`;
    return window.open('about:blank', 'starry_lifelog_compose', features);
}

function saveSkyCaptureForLifelog() {
    const popup = openLifelogPopupShell();
    if (!popup) {
        alert('ポップアップがブロックされました。ポップアップを許可して再試行してください。');
        return;
    }

    try {
        const payload = persistLifelogCapturePayload();
        if (!payload) {
            alert('スクリーンショットの取得に失敗しました。もう一度お試しください。');
            try { popup.close(); } catch (e) {}
            return;
        }
        popup.location.href = '/lifelog?compose=1&from=stars';
        try { popup.focus(); } catch (e) {}
    } catch (e) {
        console.error(e);
        try { popup.close(); } catch (closeErr) {}
        alert('ライフログへの受け渡しに失敗しました。端末の空き容量をご確認のうえ再試行してください。');
    }
}

function buildLifelogCapturePayload(imageBase64) {
    const shotDate = (state?.date instanceof Date && !isNaN(state.date.getTime())) ? new Date(state.date.getTime()) : new Date();

    let target = '';
    try {
        if (state?.selectedObject) target = String(getObjectName(state.selectedObject) || '').trim();
    } catch (e) {}
    if (target === 'Unknown Object') target = '';

    return {
        v: 1,
        source: 'stars',
        createdAt: new Date().toISOString(),
        observedDateIso: shotDate.toISOString(),
        dateForInput: toDateInputValue(shotDate),
        observedText: toDateTimeLabel(shotDate),
        lat: Number.isFinite(state?.lat) ? Number(state.lat) : null,
        lon: Number.isFinite(state?.lon) ? Number(state.lon) : null,
        target: target,
        imageBase64: imageBase64
    };
}

function setupUI() {
    const btnMobileComets = document.getElementById('btn-mobile-comets');

    const isMobile = window.innerWidth <= 900;

    const btnMore = document.getElementById('btn-more');
    if (btnMore) btnMore.textContent = '詳細≫';

    const dateInput = document.getElementById('date-picker');
    
    const sideDock = document.getElementById('side-dock');
    const btnDockToggle = document.getElementById('btn-dock-toggle');
    const tabBtnSettings = document.getElementById('tab-btn-settings');
    const tabBtnInfo = document.getElementById('tab-btn-info');
    const paneSettings = document.getElementById('pane-settings');
    const paneInfo = document.getElementById('pane-info');

    const screenClock = document.getElementById('screen-clock'); 
    
    const magSlider = document.getElementById('mag-slider');
    const timeShuttle = document.getElementById('time-shuttle');
    
    const inputLat = document.getElementById('input-lat');
    const inputLon = document.getElementById('input-lon');
    const sliderLat = document.getElementById('slider-lat');
    const sliderLon = document.getElementById('slider-lon');
    const filterContainer = document.getElementById('filter-container');

    const mobileTimeShuttle = document.getElementById('mobile-time-shuttle');
    const mobileMagSlider = document.getElementById('mobile-mag-slider');
    const mobileMagValue = document.getElementById('mobile-mag-value');
    const mobileClockDisplay = document.getElementById('mobile-clock-display');
    const mobileLocationDisplay = document.getElementById('mobile-location-display');
    
    const btnMobileConstellation = document.getElementById('btn-mobile-constellation');
    const btnMobileLabels = document.getElementById('btn-mobile-labels');
    const btnMobileGrid = document.getElementById('btn-mobile-grid');
    const btnMobileSunlight = document.getElementById('btn-mobile-sunlight'); 
    const btnMobileMeteors = document.getElementById('btn-mobile-meteors');
    const btnMobileNow = document.getElementById('btn-mobile-now');
    const btnMobileTonight = document.getElementById('btn-mobile-tonight');
    const btnMobileLocation = document.getElementById('btn-mobile-location'); 

    const btnMobileGyro = document.getElementById('btn-mobile-gyro');

    if (magSlider) magSlider.value = state.magLimit;
    if (mobileMagSlider) mobileMagSlider.value = state.magLimit;

    // --- バーガーメニュー制御 ---
    const menuToggle = document.getElementById('menu-toggle');
    const navOverlay = document.getElementById('nav-overlay');
    
    if (menuToggle && navOverlay) {
        menuToggle.addEventListener('click', () => {
            menuToggle.classList.toggle('active');
            navOverlay.classList.toggle('open');
            if (navOverlay.classList.contains('open')) {
                setControlsEnabledForCurrentMode();
            } else {
                setControlsEnabledForCurrentMode();
            }
        });
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                menuToggle.classList.remove('active');
                navOverlay.classList.remove('open');
                setControlsEnabledForCurrentMode();
            });
        });
    }

    if (isMobile) {
        sideDock.classList.remove('open');
        btnDockToggle.textContent = '≪';
        document.body.classList.remove('dock-open');
    } else {
        sideDock.classList.add('open');
        btnDockToggle.textContent = '≫';
        document.body.classList.add('dock-open');
    }

    btnDockToggle.addEventListener('click', () => {
        sideDock.classList.toggle('open');
        const isOpen = sideDock.classList.contains('open');
        btnDockToggle.textContent = isOpen ? '≫' : '≪';
        if (isOpen) {
            document.body.classList.add('dock-open');
        } else {
            document.body.classList.remove('dock-open');
        }
        updateReticle();
    });

    window.switchTab = (tabName) => {
        tabBtnSettings.classList.remove('active');
        tabBtnInfo.classList.remove('active');
        paneSettings.classList.remove('active');
        paneInfo.classList.remove('active');

        if (tabName === 'settings') {
            tabBtnSettings.classList.add('active');
            paneSettings.classList.add('active');
        } else if (tabName === 'info') {
            tabBtnInfo.classList.add('active');
            paneInfo.classList.add('active');
        }
        if (!sideDock.classList.contains('open')) {
            sideDock.classList.add('open');
            btnDockToggle.textContent = '≫';
            document.body.classList.add('dock-open');
        }
        updateReticle();
    };

    tabBtnSettings.addEventListener('click', () => window.switchTab('settings'));
    tabBtnInfo.addEventListener('click', () => window.switchTab('info'));

    inputLat.value = state.lat.toFixed(2);
    inputLon.value = state.lon.toFixed(2);
    sliderLat.value = state.lat;
    sliderLon.value = state.lon;

const updateDateInput = () => {
        const d = state.date;
        const local = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
        dateInput.value = local.toISOString().slice(0, 16);

        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        const hour = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');

        // ▼ 変更：末尾に (JST) を追加
        const dateStr = `${year}/${month}/${day} ${hour}:${min} (日本時間)`;
        
        if(screenClock) screenClock.textContent = dateStr;
        if(mobileClockDisplay) mobileClockDisplay.textContent = dateStr;
    };
    updateDateInput();

    const onTimeChange = () => {
        updatePositions(); 
        updateSolarSystemData(); 
        updateDateInput(); 
    };

    dateInput.addEventListener('change', (e) => { 
        state.date = new Date(e.target.value); 
        onTimeChange();
    });
    
    const syncShuttle = (val) => {
        state.shuttleValue = parseInt(val);
        timeShuttle.value = val;
        mobileTimeShuttle.value = val;
        updateSliderBackground(timeShuttle, 'center');
        updateSliderBackground(mobileTimeShuttle, 'center');
    };
    timeShuttle.addEventListener('input', (e) => syncShuttle(e.target.value));
    mobileTimeShuttle.addEventListener('input', (e) => syncShuttle(e.target.value));

    const resetShuttle = () => { 
        syncShuttle(0);
        updateDateInput(); 
        updateSolarSystemData(); 
    };
    timeShuttle.addEventListener('mouseup', resetShuttle); 
    timeShuttle.addEventListener('touchend', resetShuttle);
    mobileTimeShuttle.addEventListener('mouseup', resetShuttle); 
    mobileTimeShuttle.addEventListener('touchend', resetShuttle);

    const syncMag = (val) => {
        state.magLimit = parseFloat(val);
        magSlider.value = val;
        mobileMagSlider.value = val;
        const text = `${state.magLimit.toFixed(1)}等`;
        document.getElementById('mag-label').textContent = text + 'まで';
        if(mobileMagValue) mobileMagValue.textContent = text; 
        if (layers['star']) {
            layers['star'].mesh.children[0].material.uniforms.magLimit.value = state.magLimit;
        }
        updatePositions();
        updateSliderBackground(magSlider, 'left');
        updateSliderBackground(mobileMagSlider, 'left');
        
        // 天の川の濃さも即座に更新する
        updateSolarSystemData();
    };
    magSlider.addEventListener('input', (e) => syncMag(e.target.value));
    mobileMagSlider.addEventListener('input', (e) => syncMag(e.target.value));

    sliderLat.addEventListener('input', () => {
        updateLocation(parseFloat(sliderLat.value), parseFloat(sliderLon.value));
        updateSliderBackground(sliderLat, 'center');
    });
    sliderLon.addEventListener('input', () => {
        updateLocation(parseFloat(sliderLat.value), parseFloat(sliderLon.value));
        updateSliderBackground(sliderLon, 'center');
    });

    const addTime = (hours) => { 
        state.date.setTime(state.date.getTime() + hours * 60 * 60 * 1000); 
        updateDateInput(); 
        onTimeChange();
    };
    document.getElementById('btn-prev-h').addEventListener('click', () => addTime(-1));
    document.getElementById('btn-next-h').addEventListener('click', () => addTime(1));
    document.getElementById('btn-prev-d').addEventListener('click', () => addTime(-24));
    document.getElementById('btn-next-d').addEventListener('click', () => addTime(24));

    const setTonight = () => {
        const d = new Date(); d.setHours(21, 0, 0, 0); state.date = d; 
        resetShuttle(); 
        onTimeChange();
        state.selectedObject = null;
        document.getElementById('star-reticle').classList.remove('visible');
    };
    
    const setNow = () => {
        state.date = new Date(); 
        resetShuttle(); 
        onTimeChange();
        state.selectedObject = null;
        document.getElementById('star-reticle').classList.remove('visible');
    };

    document.getElementById('btn-tonight').addEventListener('click', setTonight);
    document.getElementById('btn-now').addEventListener('click', setNow);
    btnMobileTonight.addEventListener('click', setTonight);
    btnMobileNow.addEventListener('click', setNow);

    const btnMeteors = document.getElementById('btn-meteors');

    const btnGrid = document.getElementById('btn-grid');
    const toggleGrid = () => {
        state.gridVisible = !state.gridVisible;
        if (gridHelper) gridHelper.visible = state.gridVisible;
        btnGrid.classList.toggle('active', state.gridVisible);
        if (btnMobileGrid) btnMobileGrid.classList.toggle('active', state.gridVisible);
    };
    btnGrid.addEventListener('click', toggleGrid);
    if (btnMobileGrid) {
        btnMobileGrid.addEventListener('click', toggleGrid);
        btnMobileGrid.classList.add('active');
    }



    // --- みんなの流星 表示ON/OFF ---
    // storage -> state default
    const storedMeteorOn = loadMeteorDisplayEnabledFromStorage();
    if (storedMeteorOn !== null && state?.meteor) state.meteor.displayEnabled = storedMeteorOn;

    if (btnMeteors) {
        btnMeteors.addEventListener('click', () => {
            applyMeteorDisplayEnabled(!(state?.meteor?.displayEnabled !== false));
        });
    }
    if (btnMobileMeteors) {
        btnMobileMeteors.addEventListener('click', () => {
            applyMeteorDisplayEnabled(!(state?.meteor?.displayEnabled !== false));
        });
    }

    // Apply once to sync UI + polling/group visibility
    applyMeteorDisplayEnabled(state?.meteor?.displayEnabled !== false);
    // --- ヘルパー関数: ボタンスタイルの適用 ---
    const setButtonStyle = (btn, color, isActive) => {
        if (isActive) {
            btn.style.background = hexToRgba(color, 0.3);
            btn.style.border = `1px solid ${color}`;
            btn.style.color = color;
            btn.style.boxShadow = `0 0 8px ${color}, inset 0 0 5px ${hexToRgba(color, 0.2)}`;
            btn.style.textShadow = `0 0 3px ${color}`;
            btn.style.opacity = '1.0';
        } else {
            btn.style.background = 'transparent';
            btn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
            btn.style.color = 'rgba(255, 255, 255, 0.4)';
            btn.style.boxShadow = 'none';
            btn.style.textShadow = 'none';
            btn.style.opacity = '0.7';
        }
    };

    // --- カテゴリフィルターボタンの生成とイベント登録 ---
    Object.keys(CONFIG.categories).forEach(key => {
        if (key === 'star' || key === 'SolarSystem') return; // 個別ボタンなし

        const cat = CONFIG.categories[key];
        const btn = document.createElement('button');
        btn.textContent = cat.label;
        btn.style.padding = '5px 4px';
        btn.style.fontSize = '0.75rem';
        btn.style.cursor = 'pointer';
        btn.style.borderRadius = '4px';
        btn.style.transition = 'all 0.3s ease';
        btn.style.fontFamily = "'Shippori Mincho', serif";
        btn.style.width = '100%'; 

        // 初期状態：レイヤーの visible に合わせる（彗星は初期OFFなど）
        const initialActive = (layers[key] && typeof layers[key].visible === 'boolean') ? layers[key].visible : true;
        btn.classList.toggle('active', initialActive);
        setButtonStyle(btn, cat.color, initialActive);
        
        // ボタン管理用オブジェクトに保存
        filterButtons[key] = btn;

        btn.addEventListener('click', () => {
            const isActive = btn.classList.toggle('active');
            if (layers[key]) {
                layers[key].visible = isActive;
                layers[key].mesh.visible = isActive;
            }
            setButtonStyle(btn, cat.color, isActive);


            // 彗星はONにした瞬間に最新を取得（OFF時は何もしない）
            if (key === 'Comets' && isActive) {
                try {
                    lastCometFetchKey = null;
                    refreshCometsIfNeeded();
                } catch (e) {
                    console.warn('refreshCometsIfNeeded failed:', e);
                }
            }
            
            // 個別ボタン操作時にスマホボタンの状態を更新
            updateMobileButtonStates();
            updatePositions(); // ラベル再描画(SolarSystem連動のため)
        });
        
        filterContainer.appendChild(btn);
    });

    // --- スマホ「星座」ボタン (一括制御) ---
    const toggleMobileConstellation = () => {
        // 現在の状態（両方ONならONとみなす）
        const isCurrentlyActive = btnMobileConstellation.classList.contains('active');
        const newState = !isCurrentlyActive; // トグル

        // 対象カテゴリ: 星座線、星座名
        const targets = ['ConstellationLines', 'ConstellationLabels'];
        
        targets.forEach(key => {
            if(layers[key]) {
                layers[key].visible = newState;
                layers[key].mesh.visible = newState;
                // 個別ボタンの見た目も更新
                if(filterButtons[key]) {
                    if(newState) filterButtons[key].classList.add('active');
                    else filterButtons[key].classList.remove('active');
                    setButtonStyle(filterButtons[key], CONFIG.categories[key].color, newState);
                }
            }
        });
        
        btnMobileConstellation.classList.toggle('active', newState);
    };
    btnMobileConstellation.addEventListener('click', toggleMobileConstellation);
    btnMobileConstellation.classList.add('active');

    // --- スマホ「天体名」ボタン (一括制御) ---
    const toggleMobileLabels = () => {
        const isCurrentlyActive = btnMobileLabels.classList.contains('active');
        const newState = !isCurrentlyActive;

        // 対象: ラベルグループに属するもの全て (StarLabels, DSO全般)
        Object.keys(CONFIG.categories).forEach(key => {
            if(CONFIG.categories[key].isLabelGroup) {
                if(layers[key]) {
                    layers[key].visible = newState;
                    layers[key].mesh.visible = newState;
                    // 個別ボタン更新
                    if(filterButtons[key]) {
                        if(newState) filterButtons[key].classList.add('active');
                        else filterButtons[key].classList.remove('active');
                        setButtonStyle(filterButtons[key], CONFIG.categories[key].color, newState);
                    }
                }
            }
        });
        
        btnMobileLabels.classList.toggle('active', newState);
        updatePositions(); // 太陽系のラベル連動のため
    };
    btnMobileLabels.addEventListener('click', toggleMobileLabels);
    btnMobileLabels.classList.add('active');

    // --- 個別操作があった時にスマホボタンの状態を整合させる関数 ---
    function updateMobileButtonStates() {
        // 1. 星座ボタンのチェック
        // 星座線と星座名の両方がONなら点灯、そうでなければ消灯
        const cLines = layers['ConstellationLines']?.visible;
        const cLabels = layers['ConstellationLabels']?.visible;
        if(cLines && cLabels) {
            btnMobileConstellation.classList.add('active');
        } else {
            btnMobileConstellation.classList.remove('active');
        }

        // 2. 天体名ボタンのチェック
        // ラベルグループのすべてがONなら点灯、一つでもOFFなら消灯
        let allLabelsOn = true;
        Object.keys(CONFIG.categories).forEach(key => {
            if(CONFIG.categories[key].isLabelGroup) {
                if(layers[key] && !layers[key].visible) {
                    allLabelsOn = false;
                }
            }
        });

        if(allLabelsOn) {
            btnMobileLabels.classList.add('active');
        } else {
            btnMobileLabels.classList.remove('active');
        }
    }

    const pcSunlightBtn = document.getElementById('btn-sunlight');
    const toggleSunlight = () => {
        state.sunlightVisible = !state.sunlightVisible;
        if(pcSunlightBtn) pcSunlightBtn.classList.toggle('active', state.sunlightVisible);
        btnMobileSunlight.classList.toggle('active', state.sunlightVisible);
        updateSolarSystemData();
    };
    if(pcSunlightBtn) pcSunlightBtn.addEventListener('click', toggleSunlight);
    btnMobileSunlight.addEventListener('click', toggleSunlight);
    btnMobileSunlight.classList.add('active');

    // --- ジャイロ切替（タッチ/ジャイロ） ---
    const toggleGyro = async () => {
        const next = (state.viewControlMode === 'gyro') ? 'touch' : 'gyro';
        await setViewControlMode(next);
        updateGyroUI();
    };

    // 既存のスマホ下部ボタン（非表示だがロジックは残す）
    if (btnMobileGyro) {
        btnMobileGyro.addEventListener('click', toggleGyro);
    }


    // --- 彗星表示切替 ---
    const toggleComets = () => {
    const btnDockComets = document.getElementById('btn-toggle-comets'); // もしPC側にも追加していれば同期
    const syncCometsBtnState = () => {
        const isOn = !!(layers.Comets && layers.Comets.visible);
        if (btnMobileComets) btnMobileComets.classList.toggle('active', isOn);
        if (btnDockComets) btnDockComets.classList.toggle('active', isOn);
    };

        if (!layers.Comets) return;
        layers.Comets.visible = !layers.Comets.visible;
        layers.Comets.mesh.visible = layers.Comets.visible;
        syncCometsBtnState();
        if (layers.Comets.visible) {
            lastCometFetchKey = null;
            refreshCometsIfNeeded();
        
        try { updatePositions(); } catch (e) {}
}

    };
    if (btnMobileComets) {
        btnMobileComets.addEventListener('click', toggleComets);
    }
    // 初期状態を反映
    try { (document.getElementById('btn-mobile-comets')) && (document.getElementById('btn-mobile-comets').classList.toggle('active', !!(layers.Comets && layers.Comets.visible))); } catch(e) {}

    // 追加：上部アイコンボタン
    const gyroIconBtn = document.getElementById('gyro-icon-btn');
    if (gyroIconBtn) {
        // キャンバス側のドラッグ/タップ判定に吸われないようにイベントを止める
        gyroIconBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, { passive: true });
        gyroIconBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
        gyroIconBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleGyro(); });

    }

    // 初期表示の整合
    updateGyroUI();


    const updateLocation = (rawLat, rawLon) => {
        let displayLat = Math.max(-90, Math.min(90, rawLat));
        let displayLon = Math.max(-180, Math.min(180, rawLon));
        let calcLat = displayLat;
        if (calcLat >= 90) calcLat = 89.999;
        if (calcLat <= -90) calcLat = -89.999;
        state.lat = calcLat;
        state.lon = displayLon;
        inputLat.value = displayLat;
        sliderLat.value = displayLat;
        inputLon.value = displayLon;
        sliderLon.value = displayLon;
        
        const mobileLocationDisplay = document.getElementById('mobile-location-display');
        if(mobileLocationDisplay) {
            mobileLocationDisplay.textContent = `N ${state.lat.toFixed(2)}° / E ${state.lon.toFixed(2)}°`;
        }
        updatePositions();
        updateSolarSystemData(); 
    };
    
    const mobileLocationDisplayInit = document.getElementById('mobile-location-display');
    if(mobileLocationDisplayInit) {
        mobileLocationDisplayInit.textContent = `N ${state.lat.toFixed(2)}° / E ${state.lon.toFixed(2)}°`;
    }

    inputLat.addEventListener('change', () => {
        updateLocation(parseFloat(inputLat.value), parseFloat(inputLon.value));
        updateSliderBackground(sliderLat, 'center');
        updateSliderBackground(sliderLon, 'center');
    });
    inputLon.addEventListener('change', () => {
        updateLocation(parseFloat(inputLat.value), parseFloat(inputLon.value));
        updateSliderBackground(sliderLat, 'center');
        updateSliderBackground(sliderLon, 'center');
    });

    const getLocation = (btn) => {
        if (!navigator.geolocation) return alert("Geolocation not supported");
        const originalText = btn.textContent;
        btn.textContent = "取得中...";
        navigator.geolocation.getCurrentPosition(pos => {
            updateLocation(pos.coords.latitude, pos.coords.longitude);
            updateSliderBackground(sliderLat, 'center');
            updateSliderBackground(sliderLon, 'center');
            btn.textContent = originalText;
        }, () => { 
            alert("位置情報を取得できませんでした。"); 
            btn.textContent = originalText; 
        });
    };

    document.getElementById('btn-location').addEventListener('click', function() { getLocation(this); });
    btnMobileLocation.addEventListener('click', function() { getLocation(this); });

    btnMore.addEventListener('click', (e) => {
        e.stopPropagation(); 
        if (state.selectedObject) {
            showSidePanel(state.selectedObject);
            window.switchTab('info');
            updateReticle();
        }
    });

    updateSliderBackground(magSlider, 'left');
    updateSliderBackground(mobileMagSlider, 'left');
    updateSliderBackground(timeShuttle, 'center');
    updateSliderBackground(mobileTimeShuttle, 'center');
    updateSliderBackground(sliderLat, 'center');
    updateSliderBackground(sliderLon, 'center');
}

function updateSliderBackground(slider, type) {
    if (!slider) return;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const percent = ((val - min) / (max - min)) * 100;
    const baseColor = 'rgba(255, 255, 255, 0.1)';
    const activeColor = '#d4af37'; 
    if (type === 'left') {
        slider.style.background = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${percent}%, ${baseColor} ${percent}%, ${baseColor} 100%)`;
    } else if (type === 'center') {
        let zeroPercent = 50;
        if (min <= 0 && max >= 0) zeroPercent = ((0 - min) / (max - min)) * 100;
        if (val >= 0) {
            slider.style.background = `linear-gradient(to right, ${baseColor} 0%, ${baseColor} ${zeroPercent}%, ${activeColor} ${zeroPercent}%, ${activeColor} ${percent}%, ${baseColor} ${percent}%, ${baseColor} 100%)`;
        } else {
            slider.style.background = `linear-gradient(to right, ${baseColor} 0%, ${baseColor} ${percent}%, ${activeColor} ${percent}%, ${activeColor} ${zeroPercent}%, ${baseColor} ${zeroPercent}%, ${baseColor} 100%)`;
        }
    }
}

function updateSolarSystemData() {
    if (!layers['SolarSystem']) return;
    if (typeof Astronomy === 'undefined') {
        console.warn("Astronomy Engine not loaded yet.");
        return;
    }
    try {
        const date = state.date;
        const observer = new Astronomy.Observer(state.lat, state.lon, 0);
        
        // --- [既存] 日食による空の明るさ計算 ---
        const sunEquPre = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
        const sunHorPre = Astronomy.Horizon(date, observer, sunEquPre.ra, sunEquPre.dec, Astronomy.Refraction.Normal);
        const moonEquPre = Astronomy.Equator(Astronomy.Body.Moon, date, observer, true, true);
        const moonHorPre = Astronomy.Horizon(date, observer, moonEquPre.ra, moonEquPre.dec, Astronomy.Refraction.Normal);

        const sDist = sunEquPre.dist * SOLAR_CONSTANTS.AU_KM;
        const mDist = moonEquPre.dist * SOLAR_CONSTANTS.AU_KM;
        const sRadRad = Math.atan(SOLAR_CONSTANTS.SUN_DIAMETER_KM / sDist) / 2;
        const mRadRad = Math.atan(SOLAR_CONSTANTS.MOON_DIAMETER_KM / mDist) / 2;
        const azDiff = (moonHorPre.azimuth - sunHorPre.azimuth) * (Math.PI / 180);
        const altDiff = (moonHorPre.altitude - sunHorPre.altitude) * (Math.PI / 180);
        const sepRad = Math.sqrt(Math.pow(azDiff * Math.cos(sunHorPre.altitude * (Math.PI/180)), 2) + Math.pow(altDiff, 2));
        let eclipseFactor = 0.0;
        const contactRad = sRadRad + mRadRad; 
        if (sepRad < contactRad) {
            const linearFactor = 1.0 - (sepRad / contactRad);
            eclipseFactor = Math.pow(linearFactor, 4.0); 
        }
        updateSky(sunHorPre.altitude, sunHorPre.azimuth, eclipseFactor);
        // -------------------------------------------


        // --- 月食情報の計算（地球中心座標を使用） ---
        const sunGeoVec = Astronomy.GeoVector(Astronomy.Body.Sun, date, true);
        const moonGeoVec = Astronomy.GeoVector(Astronomy.Body.Moon, date, true);
        
        const sunGeoState = Astronomy.EquatorFromVector(sunGeoVec);
        const moonGeoState = Astronomy.EquatorFromVector(moonGeoVec);

        let shadowRA = sunGeoState.ra + 12.0;
        if (shadowRA >= 24.0) shadowRA -= 24.0;
        const shadowDec = -sunGeoState.dec;

        const moonRadiusDeg = 0.26; 
        const shadowRadiusDeg = moonRadiusDeg * 2.65;

        let raDiffHours = shadowRA - moonGeoState.ra;
        while (raDiffHours > 12.0) raDiffHours -= 24.0;
        while (raDiffHours < -12.0) raDiffHours += 24.0;

        const raDiffDeg = raDiffHours * 15.0;
        const decDiffDeg = shadowDec - moonGeoState.dec;

        const xAngDeg = raDiffDeg * Math.cos(moonGeoState.dec * (Math.PI / 180));
        const yAngDeg = decDiffDeg;
        
        const distDeg = Math.sqrt(xAngDeg * xAngDeg + yAngDeg * yAngDeg);

        const globalLunarEclipseInfo = {
            isEclipsing: distDeg < (moonRadiusDeg + shadowRadiusDeg),
            xOffset: -xAngDeg / moonRadiusDeg, 
            yOffset: yAngDeg / moonRadiusDeg,
            shadowRatio: 2.65
        };

        const bodies = [
            { id: Astronomy.Body.Sun, name: '太陽' },
            { id: Astronomy.Body.Moon, name: '月' },
            { id: Astronomy.Body.Mercury, name: '水星' },
            { id: Astronomy.Body.Venus, name: '金星' },
            { id: Astronomy.Body.Mars, name: '火星' },
            { id: Astronomy.Body.Jupiter, name: '木星' },
            { id: Astronomy.Body.Saturn, name: '土星' },
            { id: Astronomy.Body.Uranus, name: '天王星' },
            { id: Astronomy.Body.Neptune, name: '海王星' }
        ];

        const results = [];
        
        bodies.forEach(body => {
            const equ = Astronomy.Equator(body.id, date, observer, true, true);
            const hor = Astronomy.Horizon(date, observer, equ.ra, equ.dec, Astronomy.Refraction.Normal);
            const illum = Astronomy.Illumination(body.id, date);
            
            // データオブジェクトを作成
            const objData = {
                name: body.name, 
                alt: hor.altitude, 
                az: hor.azimuth, 
                distance_au: equ.dist,
                mag: illum.mag, 
                phase_frac: illum.phase_fraction, 
                type: 'SolarSystem',
                sunAz: sunHorPre.azimuth, 
                sunAlt: sunHorPre.altitude,
                
                // ★★★ ここを追加：パララクティックアングル計算用に赤経・赤緯を保存 ★★★
                ra: equ.ra,   // 時 (Hours)
                dec: equ.dec, // 度 (Degrees)
                
                lunarEclipseData: (body.name === '月') ? globalLunarEclipseInfo : null
            };
            results.push(objData);
        });

        const group = layers['SolarSystem'].mesh;
        while(group.children.length > 0){ group.remove(group.children[0]); }
        layers['SolarSystem'].data = results;
        createSolarSystemSprites(results, group);
    } catch (e) {
        console.warn("Solar System Calculation Error:", e);
    }
}

// --- 太陽用の新テクスチャ生成関数（日食対応版） ---
// eclipseInfo がある場合は、その情報に基づいて太陽の一部を黒く塗りつぶします
function createSunDiscTexture(eclipseInfo = null) {
    const canvas = document.createElement('canvas');
    const size = 256; 
    canvas.width = size; 
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // 背景透明
    ctx.clearRect(0, 0, size, size);
    
    const center = size / 2;
    const radius = size * 0.4; // 太陽の描画半径

    // 1. 太陽本体（光球）を描画
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcf70';
    ctx.fill();

    // 2. 日食がある場合、重なっている部分を「黒く」塗りつぶす（シルエット）
    if (eclipseInfo && eclipseInfo.isEclipsing) {
        
        // Use source-atop to restrict drawing to the existing sun shape
        ctx.globalCompositeOperation = 'source-atop';

        // 太陽の中心から見た月の相対位置（ピクセル単位）
        const dx = eclipseInfo.xOffset * radius; 
        const dy = -eclipseInfo.yOffset * radius; // 座標系のY軸反転に対応
        
        // 月の見た目の半径（太陽半径に対する比率から計算）
        const moonRadius = radius * eclipseInfo.radiusRatio;

        ctx.beginPath();
        ctx.arc(center + dx, center + dy, moonRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#000000'; // 黒（シルエット）
        ctx.fill();

        // Reset composite operation
        ctx.globalCompositeOperation = 'source-over';
    }

    // 3. 縁取り（アンチエイリアス用）
    if (!eclipseInfo || !eclipseInfo.isEclipsing) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.5)';
        ctx.stroke();
    }

    return new THREE.CanvasTexture(canvas);
}

function createSolarSystemSprites(data, parentGroup) {
    const r = CONFIG.radius;
    const TEXTURE_RATIO = 0.8; 

    // ★ パララクティックアングル計算用の共通変数
    const lstRad = calculateLST(state.date, state.lon);
    const latRad = state.lat * (Math.PI / 180);

    // --- [Step 1] 日食（太陽と月）の判定とフェード値計算 ---
    let sunObj = data.find(o => o.name === '太陽');
    let moonObj = data.find(o => o.name === '月');
    
    // 物理的な日食情報（太陽のテクスチャ生成用）
    let solarEclipseInfo = { isEclipsing: false };
    
    // 月の不透明度（初期値 1.0 = 不透明）
    let moonOpacity = 1.0;
    
    let lunarEclipseInfo = { isEclipsing: false, opacity: 1.0 };
    if (moonObj && moonObj.lunarEclipseData) {
        lunarEclipseInfo = moonObj.lunarEclipseData;
    }

    if (sunObj && moonObj) {
        // --- 距離と視直径の計算 ---
        const sunDistKm = sunObj.distance_au * SOLAR_CONSTANTS.AU_KM;
        const moonDistKm = moonObj.distance_au * SOLAR_CONSTANTS.AU_KM;
        
        const sunAngRad = Math.atan(SOLAR_CONSTANTS.SUN_DIAMETER_KM / sunDistKm);
        const moonAngRad = Math.atan(SOLAR_CONSTANTS.MOON_DIAMETER_KM / moonDistKm);

        let azDiff = (moonObj.az - sunObj.az) * (Math.PI / 180);
        let altDiff = (moonObj.alt - sunObj.alt) * (Math.PI / 180);
        while (azDiff <= -Math.PI) azDiff += Math.PI * 2;
        while (azDiff > Math.PI) azDiff -= Math.PI * 2;

        const xAng = azDiff * Math.cos(sunObj.alt * (Math.PI / 180));
        const yAng = altDiff;
        
        // 中心間の角距離
        const angularDistance = Math.sqrt(xAng * xAng + yAng * yAng);

        const sunRadiusRad = sunAngRad / 2;
        const moonRadiusRad = moonAngRad / 2;
        
        // 1. 物理的な日食判定（太陽の欠け具合用 - 変更なし）
        if (angularDistance < (sunRadiusRad + moonRadiusRad)) {
            solarEclipseInfo = {
                isEclipsing: true,
                xOffset: xAng / sunRadiusRad,
                yOffset: yAng / sunRadiusRad,
                radiusRatio: moonRadiusRad / sunRadiusRad
            };
        }

        // 2. 月のフェード計算（拡大倍率を考慮）
        // 接触開始距離（係数 1.0）：ここから薄くなり始める
        const fadeStartDist = (sunRadiusRad + moonRadiusRad) * SOLAR_CONSTANTS.MAGNIFICATION * 0.8;
        
        // 完全に消える距離（係数 0.5）：ここまで近づいたら完全に透明
        const fadeEndDist = (sunRadiusRad + moonRadiusRad) * SOLAR_CONSTANTS.MAGNIFICATION * 0.5;

        // 地平線より上にある場合のみ計算
        if (sunObj.alt > -5 && moonObj.alt > -5) {
            if (angularDistance < fadeEndDist) {
                // 完全に重なった（指定範囲内）なら透明
                moonOpacity = 0.0;
            } else if (angularDistance < fadeStartDist) {
                // 接触開始から消える位置までの間で滑らかにフェード (1.0 -> 0.0)
                moonOpacity = (angularDistance - fadeEndDist) / (fadeStartDist - fadeEndDist);
            }
        }
    }

    // --- [Step 2] 各天体の描画 ---
    data.forEach(obj => {
        if(obj.alt < -5) return;
        let texture, scale, rotation = 0;
        let renderOrder = 0; 
        
        // その天体の不透明度（デフォルト 1.0）
        let currentOpacity = 1.0;

        if (obj.name === '月') {
            currentOpacity = moonOpacity; // 計算したフェード値を適用

            if (lunarEclipseInfo.isEclipsing) {
                // ★ 月食描画モード
                texture = createLunarEclipseTexture(
                    lunarEclipseInfo.shadowRatio, 
                    lunarEclipseInfo.xOffset, 
                    lunarEclipseInfo.yOffset
                );
                
                const raRad = obj.ra * 15 * (Math.PI / 180);
                const decRad = obj.dec * (Math.PI / 180);
                
                let haRad = lstRad - raRad;
                while (haRad > Math.PI) haRad -= 2 * Math.PI;
                while (haRad < -Math.PI) haRad += 2 * Math.PI;

                const y = Math.sin(haRad);
                const x = Math.tan(latRad) * Math.cos(decRad) - Math.sin(decRad) * Math.cos(haRad);
                const q = Math.atan2(y, x);

                rotation = -q; 
                // 月食時は日食（太陽との重なり）は起き得ないので opacity は 1.0 のままでOK
            } else {
                // 通常モード
                texture = createMoonPhaseTexture(obj.phase_frac);
                const azDiff = (obj.sunAz - obj.az) * (Math.PI/180);
                const altDiff = (obj.sunAlt - obj.alt) * (Math.PI/180);
                const dx = azDiff * Math.cos(obj.alt * (Math.PI/180));
                const dy = altDiff;
                rotation = Math.atan2(dy, dx); 
            }
            
            const distKm = obj.distance_au * SOLAR_CONSTANTS.AU_KM;
            const angularSizeRad = SOLAR_CONSTANTS.MOON_DIAMETER_KM / distKm;
            const objectSizeOnSphere = r * angularSizeRad;
            scale = (objectSizeOnSphere / TEXTURE_RATIO) * SOLAR_CONSTANTS.MAGNIFICATION;
            renderOrder = 998; 

        } else if (obj.name === '太陽') {
           // 太陽
           texture = createSunDiscTexture(solarEclipseInfo);
           const distKm = obj.distance_au * SOLAR_CONSTANTS.AU_KM;
           const angularSizeRad = SOLAR_CONSTANTS.SUN_DIAMETER_KM / distKm;
           const objectSizeOnSphere = r * angularSizeRad;
           scale = (objectSizeOnSphere / TEXTURE_RATIO) * SOLAR_CONSTANTS.MAGNIFICATION;
           renderOrder = 999;
        } else {
           // 惑星
            let color = '#ffffff';
            if (obj.name === '火星') color = '#ff5555';
            else if (obj.name === '金星') color = '#eeeeaa';
            else if (obj.name === '木星') color = '#ffcc99';
            else if (obj.name === '土星') color = '#ddcc88';
            else if (obj.name === '水星') color = '#aaaaaa';
            else if (obj.name === '天王星') color = '#aaeeff';
            else if (obj.name === '海王星') color = '#5588ff';
            
            texture = createPlanetTexture(color, true, false); 
            scale = Math.max(2, (8.0 - obj.mag) * 2.5);
            renderOrder = 900;
        }

        // スプライト生成（不透明度を適用）
        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            depthTest: false, 
            rotation: rotation, 
            fog: false,
            opacity: currentOpacity, // ★ここが変わりました
            transparent: true
        });
        
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(scale, scale, 1);
        sprite.renderOrder = renderOrder;

        const altRad = obj.alt * (Math.PI / 180);
        const azRad = obj.az * (Math.PI / 180);
        const x = r * Math.cos(altRad) * Math.sin(azRad);
        const y = r * Math.sin(altRad);
        const z = -r * Math.cos(altRad) * Math.cos(azRad);
        sprite.position.set(x, y, z);

        // ラベル生成
        const labelMap = createLabelTexture(obj.name, obj.name==='太陽'?'#ffaa00':'#ffffff', 32);
        const labelMat = new THREE.SpriteMaterial({ 
            map: labelMap, 
            depthTest: false, 
            transparent: true, 
            fog: false,
            // ★追加: 月の場合、ラベルも同じようにフェードさせる
            opacity: (obj.name === '月') ? currentOpacity : 1.0 
        });
        const labelSprite = new THREE.Sprite(labelMat);
        labelSprite.renderOrder = 9999; 

        const aspect = labelMap.image.width / labelMap.image.height;
        const baseH = 12; 
        const baseW = baseH * aspect;
        labelSprite.scale.set(baseW, baseH, 1);
        
        if (obj.name === '太陽') labelSprite.position.set(scale/2 + 10, 0, 0); 
        else labelSprite.position.set(scale/2 + 5, -scale/2, 0);
        
        const wrapper = new THREE.Group();
        wrapper.add(sprite);
        wrapper.add(labelSprite);
        wrapper.position.set(x, y, z);
        
        wrapper.userData = {
            name: obj.name, alt: obj.alt, az: obj.az, dist: obj.distance_au, mag: obj.mag,
            objType: 'SolarSystem', typeLabel: '太陽系天体', meshReference: wrapper, hasLabel: true
        };
        labelSprite.userData.baseScale = { x: baseW, y: baseH };
        labelSprite.userData.isLabel = true;
        wrapper.userData.meshReference = wrapper;
        parentGroup.add(wrapper);
    });
}

// --- 月食再現用テクスチャ生成関数 ---
function createLunarEclipseTexture(shadowRatio, xOffset, yOffset) {
    const canvas = document.createElement('canvas');
    const size = 256; 
    canvas.width = size; 
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    const cx = size / 2;
    const cy = size / 2;
    const moonRadius = size * 0.4; // 月の描画半径
    const shadowRadiusPixels = moonRadius * shadowRatio;

    // 1. 満月の描画（ベース）
    ctx.beginPath();
    ctx.arc(cx, cy, moonRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffee'; // 明るい満月色
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ffffaa';
    ctx.fill();
    ctx.shadowBlur = 0;

    // 2. 地球の影（本影）を描画
    // xOffset, yOffset は月半径を1としたときのズレ量。
    // キャンバス座標系では右がX正、下がY正だが、
    // 地平座標系(Az, Alt)からの変換により、Az増分(右)=X正、Alt増分(上)=Y正 となるようにマッピングする必要がある。
    // CanvasのY軸は下向きなので、yOffsetの符号を反転させる。
    const shadowX = cx + (xOffset * moonRadius);
    const shadowY = cy - (yOffset * moonRadius);

    ctx.globalCompositeOperation = 'source-atop'; // 月の上にだけ描画

    ctx.beginPath();
    ctx.arc(shadowX, shadowY, shadowRadiusPixels, 0, Math.PI * 2);
    
    // 影の色（皆既月食中の赤銅色を再現）
    // 中心に近いほど暗く、縁は少し明るい赤
    const grad = ctx.createRadialGradient(shadowX, shadowY, 0, shadowX, shadowY, shadowRadiusPixels);
    grad.addColorStop(0.0, 'rgba(40, 10, 5, 0.95)');   // 中心：濃い赤黒
    grad.addColorStop(0.6, 'rgba(80, 20, 10, 0.9)');   // 中間：赤銅色
    grad.addColorStop(1.0, 'rgba(100, 40, 20, 0.6)');  // 縁：薄い影

    ctx.fillStyle = grad;
    ctx.fill();

    // 3. 通常合成に戻して輪郭線（オプション）
    ctx.globalCompositeOperation = 'source-over';
    /*
    ctx.beginPath();
    ctx.arc(cx, cy, moonRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    */

    return new THREE.CanvasTexture(canvas);
}

function createPlanetTexture(colorStr, hasSpikes, isSun = false) {
    const canvas = document.createElement('canvas');
    const size = 150; canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    ctx.clearRect(0, 0, size, size);

    if (!isSun) {
        const grd = ctx.createRadialGradient(center, center, size/20, center, center, size/2);
        grd.addColorStop(0, colorStr); grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(center, center, size/2, 0, Math.PI*2); ctx.fill();
    }
    if (hasSpikes) {
        ctx.strokeStyle = colorStr; ctx.lineWidth = 1.5; ctx.globalAlpha = 1.5;
        ctx.beginPath(); ctx.moveTo(center, 15); ctx.lineTo(center, size - 15);
        ctx.moveTo(15, center); ctx.lineTo(size - 15, center); ctx.stroke();
    }
    ctx.globalAlpha = 1.0; ctx.fillStyle = '#ffffff'; 
    ctx.beginPath(); ctx.arc(center, center, size/16, 0, Math.PI*2); ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

function createMoonPhaseTexture(fraction) {
    const canvas = document.createElement('canvas');
    const size = 128; canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2; const radius = size * 0.4;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#111111'; ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 15; ctx.shadowColor = '#ffffaa'; 
    ctx.beginPath(); ctx.arc(center, center, radius, -Math.PI / 2, Math.PI / 2, false);
    const ellipseWidth = Math.abs((2 * fraction - 1) * radius);
    const isCrescent = fraction < 0.5;
    try { ctx.ellipse(center, center, ellipseWidth, radius, 0, Math.PI/2, -Math.PI/2, isCrescent); } 
    catch(e) { ctx.lineTo(center, center - radius); }
    ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    return new THREE.CanvasTexture(canvas);
}

function hexToRgba(hex, alpha) {
    const c = new THREE.Color(hex);
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

function createSymbolTexture(type, colorStr) {
    const canvas = document.createElement('canvas');
    const size = 64; canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const center = size / 2; const radius = size / 3;
    ctx.strokeStyle = colorStr; ctx.fillStyle = colorStr; ctx.lineWidth = 3;

    switch (type) {
        case 'solar_body': ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.fill(); break;
        case 'ellipse': ctx.beginPath(); ctx.ellipse(center, center, radius, radius * 0.6, Math.PI / 4, 0, Math.PI * 2); ctx.stroke(); break;
        case 'circle_plus':
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(center - radius, center); ctx.lineTo(center + radius, center);
            ctx.moveTo(center, center - radius); ctx.lineTo(center, center + radius); ctx.stroke(); break;
        case 'circle_dotted': ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); break;
        case 'square':
            ctx.globalAlpha = 0.3; ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);
            ctx.globalAlpha = 1.0; ctx.strokeRect(center - radius, center - radius, radius * 2, radius * 2); break;
        case 'square_stroke': ctx.strokeRect(center - radius, center - radius, radius * 2, radius * 2); break;
        case 'circle_cross':
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(center - radius - 5, center); ctx.lineTo(center + radius + 5, center); ctx.stroke(); break;
        case 'diamond':
            ctx.beginPath(); ctx.moveTo(center, center - radius); ctx.lineTo(center + radius, center); ctx.lineTo(center, center + radius); ctx.lineTo(center - radius, center); ctx.closePath(); ctx.stroke(); break;
        case 'double_circle':
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(center, center, 2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.moveTo(center - radius - 5, center); ctx.lineTo(center + radius + 5, center); ctx.stroke(); break;
        default: ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
    }
    return new THREE.CanvasTexture(canvas);
}

function createLabelTexture(text, colorStr, fontSize = 32) {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    ctx.font = `Bold ${fontSize}px sans-serif`;
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width) + 10; const h = fontSize + 10;
    canvas.width = w; canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `Bold ${fontSize}px sans-serif`; ctx.fillStyle = colorStr;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(text, 5, h / 2);
    return new THREE.CanvasTexture(canvas);
}

async function fetchAllData() {
    const loader = document.getElementById('loader');
    const promises = CATALOG_FILES.map(item => 
        fetch(`assets/catalogs/${item.file}`)
            .then(res => { if (!res.ok) throw new Error(`${item.file}: ${res.status}`); return res.json(); })
            .then(data => ({ type: item.type, data: data }))
            .catch(err => { console.warn(`Skipping ${item.file}:`, err); return null; })
    );

    try {
        const results = await Promise.all(promises);
        let loadedCount = 0;
        results.forEach(res => {
            if (!res) return;
            createLayer(res.type, res.data);
            loadedCount++;
        });
        if (loadedCount === 0) throw new Error("No data loaded.");

        allCelestialObjects = [];
        Object.keys(layers).forEach(type => {
            if (type !== 'ConstellationLines' && type !== 'ConstellationLabels' && type !== 'SolarSystem') {
                allCelestialObjects = allCelestialObjects.concat(layers[type].data.map(d => ({...d, objType: type})));
            }
        });
        updatePositions();
        loader.style.display = 'none';
    } catch (error) { 
        console.error(error);
        loader.innerHTML = `Load Error<br><span style="font-size:0.7em">${error.message}</span>`;
    }
}

function createLayer(type, dataList) {
    const config = CONFIG.categories[type] || { label: type, color: '#ffffff', type: 'point' };
    layers[type] = { data: dataList, mesh: new THREE.Group(), visible: true };

    if (type === 'ConstellationLines') {
        createConstellationLines(dataList, config, layers[type].mesh);
    } else if (type === 'ConstellationLabels') {
        createConstellationLabels(dataList, config, layers[type].mesh);
    } else if (type === 'star') { 
        createStarPoints(type, dataList, layers[type].mesh); 
        // 恒星名は独立レイヤー
        if (!layers['StarLabels']) {
            layers['StarLabels'] = { data: dataList, mesh: new THREE.Group(), visible: true };
            scene.add(layers['StarLabels'].mesh);
            createStarLabels(dataList, layers['StarLabels'].mesh);
        }
    } else if (type === 'SolarSystem') {
    } else { 
        createDSOSprites(type, dataList, config, layers[type].mesh); 
    }
    scene.add(layers[type].mesh);
}

function createConstellationLines(data, config, parentGroup) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(data.length * 6); 
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: config.color, transparent: true, opacity: 0.6, depthTest: false });
    const lineSegments = new THREE.LineSegments(geometry, material);
    lineSegments.frustumCulled = false; 
    parentGroup.add(lineSegments);
}

function createConstellationLabels(data, config, parentGroup) {
    data.forEach(obj => {
        const labelMap = createLabelTexture(obj.name, config.color, 32);
        const material = new THREE.SpriteMaterial({ map: labelMap, transparent: true, depthTest: false, depthWrite: false, opacity: 0.7 });
        const sprite = new THREE.Sprite(material);
        const aspect = labelMap.image.width / labelMap.image.height;
        const baseH = 12; const baseW = baseH * aspect;
        sprite.scale.set(baseW, baseH, 1);
        sprite.userData = { ra: obj.ra, dec: obj.dec, isLabelOnly: true, baseScale: {x:baseW, y:baseH}, isLabel: true };
        parentGroup.add(sprite);
    });
}

function createStarPoints(type, data, parentGroup) {
    const geometry = new THREE.BufferGeometry();
    const count = data.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const magnitudes = new Float32Array(count);
    const isMobile = window.innerWidth <= 900;
    const sizeBase = isMobile ? 6.0 : 3.5; 
    const minSize = isMobile ? 12.0 : 6.0; 

    data.forEach((obj, i) => {
        const spectFirst = obj.spect_type ? obj.spect_type.charAt(0).toUpperCase() : 'A';
        const color = CONFIG.starColors[spectFirst] || CONFIG.starColors.default;
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
        let mag = parseFloat(obj.vmag || obj.mag || 6.0); if (isNaN(mag)) mag = 6.0;
        let rawSize = Math.max(minSize, (8.0 - mag) * sizeBase);
        sizes[i] = Math.min(rawSize, isMobile ? 40.0 : 25.0); 
        magnitudes[i] = mag;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aMagnitude', new THREE.BufferAttribute(magnitudes, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            pointTexture: { value: new THREE.TextureLoader().load('https://threejs.org/examples/textures/sprites/spark1.png') },
            magLimit: { value: state.magLimit }, 
            uTime: { value: 0.0 }, uFov: { value: (camera ? camera.fov : CONFIG.cameraFov) } 
        },
        vertexShader: `
            attribute float size; attribute vec3 color; attribute float aMagnitude;
            varying vec3 vColor; varying float vMag;
            uniform float magLimit; uniform float uTime; uniform float uFov; 
            float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
            void main() {
                vMag = aMagnitude; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float seed = random(position.xy); float speed = 2.0 + seed * 3.0; 
                float twinkle = 1.0 + 0.3 * sin(uTime * speed + seed * 100.0);
                float altitudeFactor = 1.0 - smoothstep(0.0, 500.0, abs(position.y));
                twinkle += altitudeFactor * 0.2 * sin(uTime * speed * 2.0);
                vColor = color * twinkle;
                float exposureScale = 0.5 + max(0.0, magLimit) * 0.15; 
                float fovFactor = 50.0 / uFov;
                gl_PointSize = size * exposureScale * fovFactor * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor; varying float vMag; uniform float magLimit;
            void main() {
                float fadeRange = 1.0; float delta = magLimit - vMag;
                float opacity = clamp(delta / fadeRange, 0.0, 1.0);
                if (opacity <= 0.0) discard;
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord) * 2.0; 
                if (dist > 1.0) discard;
                float core = exp(-dist * dist * 10.0);
                float glow = exp(-dist * 2.5);
                float intensity = core * 1.8 + glow * 0.4;
                gl_FragColor = vec4(vColor, intensity * opacity);
            }
        `,
        transparent: true, depthTest: false, blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geometry, material);
    parentGroup.add(points);
}

function createStarLabels(data, parentGroup) {
    data.forEach((obj) => {
        if (!obj.proper_name) return; 
        const labelMap = createLabelTexture(obj.proper_name, '#ffffff', 32);
        const labelMat = new THREE.SpriteMaterial({ map: labelMap, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
        const labelSprite = new THREE.Sprite(labelMat);
        const aspect = labelMap.image.width / labelMap.image.height;
        const baseH = 8; const baseW = baseH * aspect;
        labelSprite.scale.set(baseW, baseH, 1);
        const wrapper = new THREE.Group();
        wrapper.add(labelSprite);
        labelSprite.position.set((baseW) / 2 + 2, 2, 0);
        labelSprite.userData.baseScale = { x: baseW, y: baseH };
        labelSprite.userData.isLabel = true;
        wrapper.userData = { 
            ra: obj.ra_deg !== undefined ? obj.ra_deg : (obj.ra !== undefined ? obj.ra : 0),
            dec: obj.dec_deg !== undefined ? obj.dec_deg : (obj.dec !== undefined ? obj.dec : 0),
            mag: parseFloat(obj.vmag || obj.mag || 6.0), isLabel: true, meshReference: wrapper 
        };
        parentGroup.add(wrapper);
    });
}

function createDSOSprites(type, data, config, parentGroup) {
    const symbolMap = createSymbolTexture(config.type, config.color);
    const materialBase = new THREE.SpriteMaterial({ map: symbolMap, color: 0xffd84a, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    data.forEach((obj) => {
        const wrapper = new THREE.Group();
        const sprite = new THREE.Sprite(materialBase.clone());
        sprite.scale.set(15, 15, 1); wrapper.add(sprite);
        const name = getObjectName(obj);
        if (name !== "Unknown Object") {
            const labelMap = createLabelTexture(name, config.color, 32);
            const labelMat = new THREE.SpriteMaterial({ map: labelMap, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
            const labelSprite = new THREE.Sprite(labelMat);
            const aspect = labelMap.image.width / labelMap.image.height;
            const baseH = 10; const baseW = baseH * aspect;
            labelSprite.scale.set(baseW, baseH, 1);
            labelSprite.userData.baseScale = { x: baseW, y: baseH };
            labelSprite.userData.isLabel = true;
            labelSprite.position.set(baseW / 2 + 8, 0, 0); wrapper.add(labelSprite);
        }
        wrapper.userData = { 
            ra: obj.ra_deg !== undefined ? obj.ra_deg : (obj.ra !== undefined ? obj.ra : 0),
            dec: obj.dec_deg !== undefined ? obj.dec_deg : (obj.dec !== undefined ? obj.dec : 0),
            mag: parseFloat(obj.vmag || obj.mag || 6.0),
            originalData: { ...obj, objType: type, typeLabel: config.label },
            meshReference: wrapper, hasLabel: true
        };
        parentGroup.add(wrapper);
    });
}

function updatePositions() {
    const r = CONFIG.radius;
    const lstRad = calculateLST(state.date, state.lon);
    const latRad = state.lat * Math.PI / 180;
    const sinLat = Math.sin(latRad); const cosLat = Math.cos(latRad);

    if (layers['star'] && layers['star'].mesh.children.length > 0) {
        const points = layers['star'].mesh.children.find(c => c.isPoints);
        if (points) {
            const positions = points.geometry.attributes.position.array;
            const starData = layers['star'].data;
            starData.forEach((star, i) => {
                const coord = calcHorizontalCoord(star.ra_deg, star.dec_deg, lstRad, sinLat, cosLat, r);
                positions[i * 3] = coord.x; positions[i * 3 + 1] = coord.y; positions[i * 3 + 2] = coord.z;
            });
            points.geometry.attributes.position.needsUpdate = true;
        }
    }

    if (layers['ConstellationLines'] && layers['ConstellationLines'].visible) {
        const lineSeg = layers['ConstellationLines'].mesh.children[0];
        if (lineSeg) {
            const positions = lineSeg.geometry.attributes.position.array;
            const data = layers['ConstellationLines'].data;
            data.forEach((d, i) => {
                const p1 = calcHorizontalCoord(d.ra1, d.dec1, lstRad, sinLat, cosLat, r);
                const p2 = calcHorizontalCoord(d.ra2, d.dec2, lstRad, sinLat, cosLat, r);
                positions[i * 6 + 0] = p1.x; positions[i * 6 + 1] = p1.y; positions[i * 6 + 2] = p1.z;
                positions[i * 6 + 3] = p2.x; positions[i * 6 + 4] = p2.y; positions[i * 6 + 5] = p2.z;
            });
            lineSeg.geometry.attributes.position.needsUpdate = true;
        }
    }

    Object.keys(layers).forEach(type => {
        if (type === 'ConstellationLines' || type === 'SolarSystem') return;
        const group = layers[type].mesh; 
        if (!layers[type].visible) return;
        group.children.forEach(child => {
            if (child.isPoints) return; 
            const d = child.userData;
            let ra, dec;
            if (d.isLabelOnly) { ra = d.ra; dec = d.dec; } 
            else if (d.ra !== undefined) { ra = d.ra; dec = d.dec; } 
            else { return; }
            const coord = calcHorizontalCoord(ra, dec, lstRad, sinLat, cosLat, r);
            child.position.set(coord.x, coord.y, coord.z);
            if (!d.isLabelOnly && d.mag !== undefined) {
                 // StarLabelsレイヤー内の制御など
                 // ここではレイヤーのvisibleがtrueの場合のみ来るので、等級判定のみ
                 child.visible = (d.mag <= state.magLimit);
            }
        });
    });
    
    // SolarSystemのラベル制御（恒星名の表示状態と連動）
    // 太陽系レイヤー自体は常に表示されているが、ラベルだけ制御する
    if(layers['SolarSystem']) {
        const showSolarLabels = layers['StarLabels'] ? layers['StarLabels'].visible : true;
        
        layers['SolarSystem'].mesh.children.forEach(wrapper => {
            if(wrapper.children.length >= 2) {
                const label = wrapper.children[1];
                if(label.userData.isLabel) {
                    label.visible = showSolarLabels;
                }
            }
        });
    }

    // --- 彗星の位置更新（表示中のみ） ---
    updateCometObjectsPosition(r, lstRad, sinLat, cosLat);


    // --- 天の川の回転制御 ---
    if (milkyWayGroup && milkyWayMesh) {
        // 1. 緯度に合わせてコンテナを傾ける (天の北極を合わせる)
        milkyWayGroup.rotation.x = latRad - (Math.PI / 2);

        // 2. 時間(LST)に合わせてメッシュ自体を回転させる
        milkyWayMesh.rotation.y = -lstRad - (Math.PI / 2);
    }

    if(state.shuttleValue !== 0) {
        updateSolarSystemData();
    }


    // --- 彗星データ更新（表示中のみ、分単位でキャッシュ） ---
    refreshCometsIfNeeded();
}

function calcHorizontalCoord(raDeg, decDeg, lstRad, sinLat, cosLat, radius) {
    const raRad = raDeg * (Math.PI / 180);
    const decRad = decDeg * (Math.PI / 180);
    const ha = lstRad - raRad;
    const sinDec = Math.sin(decRad); const cosDec = Math.cos(decRad);
    const cosHa = Math.cos(ha); const sinHa = Math.sin(ha);
    const sinAlt = sinDec * sinLat + cosDec * cosLat * cosHa;
    const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const cosAlt = Math.cos(altRad);
    let azRad = 0;
    if (Math.abs(cosAlt) > 0.001) {
        const azCos = (sinDec - sinAlt * sinLat) / (cosAlt * cosLat);
        const clampedAzCos = Math.max(-1, Math.min(1, azCos));
        azRad = Math.acos(clampedAzCos);
        if (sinHa > 0) azRad = Math.PI * 2 - azRad;
    }
    return { x: radius * cosAlt * Math.sin(azRad), y: radius * sinAlt, z: -radius * cosAlt * Math.cos(azRad) };
}

function calculateLST(date, longitude) {
    const nowTime = date.getTime();
    const julianDay = (nowTime / 86400000) + 2440587.5;
    const D = julianDay - 2451545.0;
    const GMST = 280.46061837 + 360.98564736629 * D;
    const LST = GMST + longitude;
    return (LST % 360) * (Math.PI / 180);
}

function createSkyDome() {
    const geometry = new THREE.SphereGeometry(900, 64, 64);
    const vertexShader = `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `;
    const fragmentShader = `
        uniform vec3 baseColor; uniform vec3 sunDirection; uniform float sunAlt; uniform float uSunlightEnabled; 
        varying vec3 vWorldPosition;
        void main() {
            vec3 viewDir = normalize(vWorldPosition);
            vec3 color = baseColor;
            float dotP = dot(viewDir, normalize(sunDirection));
            if (dotP > 0.0) {
                float glowSize = 14.0; float glowIntensity = pow(dotP, glowSize);
                vec3 sunsetColor = vec3(1.0, 0.35, 0.05); vec3 dayColor = vec3(0.8, 0.9, 1.0);     
                float dayStrength = smoothstep(0.0, 25.0, sunAlt);
                float totalPower = smoothstep(-20.0, -5.0, sunAlt);
                vec3 glowColor = mix(sunsetColor, dayColor, dayStrength);
                float brightness = mix(0.8, 0.4, dayStrength);
                color += glowColor * glowIntensity * totalPower * brightness * uSunlightEnabled;
            }
            float horizon = 1.0 - abs(viewDir.y);
            float horizonGlow = pow(horizon, 5.0);
            color += vec3(0.1, 0.15, 0.25) * horizonGlow * 0.25;
            gl_FragColor = vec4(color, 1.0);
        }
    `;
    const material = new THREE.ShaderMaterial({
        uniforms: {
            baseColor: { value: new THREE.Color(0x050a14) },
            sunDirection: { value: new THREE.Vector3(0, 1, 0) },
            sunAlt: { value: 0 },
            uSunlightEnabled: { value: 1.0 }
        },
        vertexShader: vertexShader, fragmentShader: fragmentShader, side: THREE.BackSide, depthWrite: false
    });
    skyMesh = new THREE.Mesh(geometry, material);
    skyMesh.renderOrder = -100; scene.add(skyMesh);
}

// --- 天の川作成関数 ---
function createMilkyWay() {
    // 緯度による傾きを制御するグループ
    milkyWayGroup = new THREE.Group();
    scene.add(milkyWayGroup);

    const loader = new THREE.TextureLoader();
    // ユーザー指定のパスから画像をロード
    const texture = loader.load('assets/img/equirectangular.jpg');
    
    // 星(500)より遠く、空(900)より手前
    const geometry = new THREE.SphereGeometry(850, 64, 64); 
    
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide, // 内側から見る
        transparent: true,
        opacity: 0.0, // 初期値は0（updateSkyで制御）
        depthWrite: false, // 星を隠さない
        blending: THREE.AdditiveBlending // 星空になじむように加算合成
    });

    milkyWayMesh = new THREE.Mesh(geometry, material);
    
    // 内側から見るため左右反転が必要な場合が多い
    milkyWayMesh.scale.x = -1;
    
    milkyWayGroup.add(milkyWayMesh);
}

function updateSky(sunAlt, sunAz, eclipseFactor = 0.0) {
    if (!skyMesh) return;
    let targetColor;
    
    // 昼の強さを計算 (0.0:夜 〜 1.0:昼)
    const dayStrength = Math.min(1.0, Math.max(0.0, sunAlt / 25.0));

    if (state.sunlightVisible) {
        if (sunAlt <= SKY_GRADIENT[0].alt) targetColor = SKY_GRADIENT[0].color.clone();
        else if (sunAlt >= SKY_GRADIENT[SKY_GRADIENT.length - 1].alt) targetColor = SKY_GRADIENT[SKY_GRADIENT.length - 1].color.clone();
        else {
            for (let i = 0; i < SKY_GRADIENT.length - 1; i++) {
                const lower = SKY_GRADIENT[i]; const upper = SKY_GRADIENT[i + 1];
                if (sunAlt >= lower.alt && sunAlt < upper.alt) {
                    const t = (sunAlt - lower.alt) / (upper.alt - lower.alt);
                    targetColor = lower.color.clone().lerp(upper.color, t); break;
                }
            }
        }
    } else {
        targetColor = new THREE.Color(0x050a14);
    }

    if (targetColor) {
        // --- [追加] 日食による減光処理 ---
        if (eclipseFactor > 0.001) {
            // 夜の色（真っ黒ではなく深い青）
            const nightColor = new THREE.Color(0x020408);
            
            // 最大でも完全な真っ暗(1.0)にはせず、0.95くらいにして薄明かりを残す
            const darkness = Math.min(0.95, eclipseFactor * 1.5); // 係数1.5で早めに暗くする
            
            targetColor.lerp(nightColor, darkness);
        }
        
        skyMesh.material.uniforms.baseColor.value.copy(targetColor);
        scene.fog.color.copy(targetColor);
    }

    const altRad = sunAlt * (Math.PI / 180);
    const azRad = sunAz * (Math.PI / 180);
    const x = Math.cos(altRad) * Math.sin(azRad);
    const y = Math.sin(altRad);
    const z = -Math.cos(altRad) * Math.cos(azRad);
    skyMesh.material.uniforms.sunDirection.value.set(x, y, z);
    skyMesh.material.uniforms.sunAlt.value = sunAlt;
    
    // 太陽光の強さ（グレア）も日食に合わせて弱める
    // 日食率が高いほど 0 に近づける
    const eclipseDimming = Math.max(0, 1.0 - eclipseFactor * 3.0); // グレアは早めに消す
    skyMesh.material.uniforms.uSunlightEnabled.value = state.sunlightVisible ? eclipseDimming : 0.0;

    // --- 天の川の透明度制御 ---
    if (milkyWayMesh) {
        let dayFactor = 1.0;
        if (state.sunlightVisible) {
            // 通常の昼の明るさに、日食による「暗さ」を加味する
            // eclipseFactorが大きい(暗い)ほど、dayStrengthの影響を無効化して夜に近づける
            const effectiveDayStrength = dayStrength * (1.0 - eclipseFactor); 
            dayFactor = 1.0 - effectiveDayStrength;
        }

        const magFadeThreshold = 3.0;
        const magFullThreshold = 7.5; 
        let magFactor = (state.magLimit - magFadeThreshold) / (magFullThreshold - magFadeThreshold);
        magFactor = Math.max(0, Math.min(1, magFactor)); 

        const maxOpacity = 0.85; 
        const targetOpacity = maxOpacity * dayFactor * magFactor;
        
        milkyWayMesh.material.opacity = targetOpacity;
        milkyWayMesh.visible = targetOpacity > 0.01;
    }
}

function createGround() {
    // 地面（半球）の生成
    const geometry = new THREE.SphereGeometry(CONFIG.radius - 10, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x020408, side: THREE.BackSide, transparent: true, opacity: 0.75 });
    groundMesh = new THREE.Mesh(geometry, material);
    
    // ★追加：描画順序を最前面にする
    // 天体ラベルが 9999 なので、それより大きい値を設定して上から被せる
    groundMesh.renderOrder = 20000; 

    scene.add(groundMesh);

    // 地平線のライン
    const lineGeo = new THREE.RingGeometry(CONFIG.radius - 12, CONFIG.radius - 10, 64);
    const lineMat = new THREE.MeshBasicMaterial({ color: CONFIG.starColors.default, opacity: 0.2, transparent: true, side: THREE.DoubleSide });
    const horizonLine = new THREE.Mesh(lineGeo, lineMat);
    horizonLine.rotation.x = Math.PI / 2;

    // ★追加：地平線ラインも最前面へ
    horizonLine.renderOrder = 20001;

    scene.add(horizonLine);
}

function createCompass() {
    compassGroup = new THREE.Group();
    const dirs = [{text:'N',x:0,z:-1},{text:'S',x:0,z:1},{text:'E',x:1,z:0},{text:'W',x:-1,z:0}];
    dirs.forEach(d => {
        const sprite = createTextSprite(d.text);
        sprite.position.set(d.x * (CONFIG.radius - 50), 20, d.z * (CONFIG.radius - 50));
        compassGroup.add(sprite);
    });
    scene.add(compassGroup);
}

function createTextSprite(message) {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    canvas.width = 256; canvas.height = 256;
    ctx.clearRect(0, 0, 256, 256); 
    ctx.font = "Bold 100px 'Shippori Mincho', serif"; ctx.fillStyle = "#d4af37";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(message, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material); sprite.scale.set(40, 40, 1); return sprite;
}

function createGrid() {
    if (gridHelper) { 
        scene.remove(gridHelper); 
        gridHelper.traverse(c => { if(c.geometry)c.geometry.dispose(); if(c.material)c.material.dispose(); }); 
    }
    gridHelper = new THREE.Group();
    const material = new THREE.LineBasicMaterial({ color: 0x708090, transparent: true, opacity: 0.5 });
    
    for (let i = 0; i < 12; i++) {
        const theta = (i / 12) * Math.PI * 2; const pts = [];
        for (let j = 0; j <= 20; j++) {
            const phi = (j / 40) * Math.PI;
            pts.push(new THREE.Vector3(Math.sin(phi)*Math.cos(theta)*CONFIG.radius, Math.cos(phi)*CONFIG.radius, Math.sin(phi)*Math.sin(theta)*CONFIG.radius));
        }
        gridHelper.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material));
    }
    for (let deg = 15; deg < 90; deg += 15) {
        const phi = (90 - deg) * (Math.PI / 180); const pts = [];
        for (let i = 0; i <= 64; i++) {
            const theta = (i / 64) * Math.PI * 2; 
            const r = CONFIG.radius * Math.sin(phi); const y = CONFIG.radius * Math.cos(phi);
            pts.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
        }
        gridHelper.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material));
    }
    gridHelper.visible = state.gridVisible; 
    scene.add(gridHelper);
}

function getObjectName(obj) {
    const names = [];
    if (obj.name) names.push(obj.name); 
    if (obj.proper_name) names.push(obj.proper_name);
    if (obj.bayer_name) names.push(obj.bayer_name);
    if (names.length === 0) return "Unknown Object";
    return names.join(' / ');
}

function onPointerUp(event) {
    if (event.target.closest('.ui-layer') || 
        event.target.closest('#mobile-controls') || 
        event.target.closest('#star-reticle') ||
        event.target.closest('.menu-container')) {
        return; 
    }

    // ---- 流星記録モード中は優先処理（追加） ----
    if (handleMeteorPointerUp(event)) return;

    const diffX = Math.abs(event.clientX - state.dragStartX);
    const diffY = Math.abs(event.clientY - state.dragStartY);
    const isMobile = window.innerWidth <= 900;
    const dragThreshold = isMobile ? 20 : 5; 

    if (diffX > dragThreshold || diffY > dragThreshold) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.params.Points.threshold = isMobile ? 30 : 15;

    let intersectTargets = [];
    if (layers['star'] && layers['star'].visible) {
        const points = layers['star'].mesh.children.find(c => c.isPoints);
        if (points) intersectTargets.push(points);
    }
    
    Object.keys(layers).forEach(type => {
        if (type === 'ConstellationLines' || type === 'ConstellationLabels') return;
        if (layers[type].visible) {
            layers[type].mesh.children.forEach(child => {
                if (child.visible && child.isGroup) { 
                    if (child.children.length > 0) intersectTargets.push(child.children[0]);
                }
            });
        }
    });

    if (intersectTargets.length === 0) return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(intersectTargets);

    if (intersects.length > 0) {
        const candidates = [];
        intersects.forEach(hit => {
            let candidateObj = null;
            let distToRay = 0; 
            if (hit.object.isPoints) {
                const data = layers['star'].data[hit.index];
                if (data) {
                    candidateObj = { ...data, index: hit.index, isStarPoint: true };
                    distToRay = hit.distanceToRay;
                }
            } else if (hit.object.isSprite) {
                const userData = hit.object.parent.userData;
                if(!userData.name && userData.originalData) {
                    candidateObj = { ...userData.originalData, meshReference: userData.meshReference };
                } else {
                    candidateObj = userData;
                }
                if (hit.object.position) {
                    const worldPos = new THREE.Vector3();
                    hit.object.getWorldPosition(worldPos);
                    distToRay = raycaster.ray.distanceToPoint(worldPos);
                }
            }
            let mag = 6.0;
            if (candidateObj.mag !== undefined) mag = parseFloat(candidateObj.mag);
            else if (candidateObj.vmag !== undefined) mag = parseFloat(candidateObj.vmag);
            
            if (mag <= state.magLimit) {
                candidateObj.distToRay = distToRay;
                candidates.push(candidateObj);
            }
        });

        if (candidates.length > 0) {
            candidates.sort((a, b) => a.distToRay - b.distToRay);
            const now = Date.now();
            let newIndex = 0;
            if (state.clickCandidates.length > 0 && 
                candidates.length > 0 &&
                candidates[0].name === state.clickCandidates[0].name && 
                (now - state.lastClickTime < 2000)) {
                newIndex = (state.clickCandidateIndex + 1) % candidates.length;
            }
            state.clickCandidates = candidates;
            state.clickCandidateIndex = newIndex;
            state.lastClickTime = now;

            const targetObj = candidates[newIndex];
            state.selectedObject = targetObj;
            
            const nameDisplay = document.getElementById('selected-star-name-display');
            if (nameDisplay) {
                document.getElementById('display-star-name-text').textContent = '選択天体：' + getObjectName(targetObj);
                nameDisplay.classList.add('visible');
            }
            
            showSidePanel(targetObj);
            updateReticle(); 
            if (!isMobile) window.switchTab('info');
        } else {
            resetSelectionHelper();
        }
    } else {
        resetSelectionHelper();
    }
}

function resetSelectionHelper() {
    state.selectedObject = null;
    const reticle = document.getElementById('star-reticle');
    reticle.classList.remove('visible');
    reticle.style.display = 'none'; 
    const nameDisplay = document.getElementById('selected-star-name-display');
    if (nameDisplay) {
        nameDisplay.classList.remove('visible');
        setTimeout(() => {
            if(!nameDisplay.classList.contains('visible')) {
                document.getElementById('display-star-name-text').textContent = '';
            }
        }, 300);
    }
}

function showSidePanel(obj) {
    let magText = "-";
    if (obj.vmag !== undefined) magText = parseFloat(obj.vmag).toFixed(2);
    else if (obj.mag !== undefined) magText = parseFloat(obj.mag).toFixed(2);
    
    let distText = "-"; let distUnit = "";
    if (obj.distance_au !== undefined) { distText = parseFloat(obj.distance_au).toFixed(3); distUnit = " AU"; }
    else if (obj.distance_pc) { distText = (obj.distance_pc * 3.26156).toFixed(1); distUnit = " 光年"; }

    let altAzText = "-";
    if (obj.alt !== undefined && obj.az !== undefined) {
        altAzText = `H:${obj.alt.toFixed(1)}° A:${obj.az.toFixed(1)}°`;
    }
    document.getElementById('star-name').textContent = getObjectName(obj);
    document.getElementById('star-altaz').textContent = altAzText; 
    const distEl = document.getElementById('star-dist');
    distEl.textContent = distText;
    if (distEl.nextSibling && distEl.nextSibling.nodeType === 3) distEl.nextSibling.textContent = distUnit; 
    let typeText = obj.spect_type || obj.typeLabel || "Unknown";
    document.getElementById('star-type').textContent = typeText;
}

function onPointerMove(event) {
    document.body.style.cursor = 'default';
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const isMobile = window.innerWidth <= 900;
    raycaster.params.Points.threshold = isMobile ? 30 : 15;
    
    // レイアウト調整関数の呼び出し
    updateStarNameLayout();
}

function updateReticle() {
    const reticle = document.getElementById('star-reticle');
    const sideDock = document.getElementById('side-dock');
    const isMobile = window.innerWidth <= 900;

    if (isMobile && sideDock && sideDock.classList.contains('open')) {
        reticle.classList.remove('visible'); reticle.style.display = 'none'; return;
    }
    if (!state.selectedObject || state.shuttleValue !== 0 || state.isDragging) {
        reticle.classList.remove('visible'); reticle.style.display = 'none'; return;
    }

    camera.updateMatrixWorld();
    let targetVec = new THREE.Vector3();

    if (state.selectedObject.isStarPoint) {
        const points = layers['star'].mesh.children.find(c => c.isPoints);
        if (points && points.geometry.attributes.position) {
            const index = state.selectedObject.index;
            targetVec.fromBufferAttribute(points.geometry.attributes.position, index);
            targetVec.applyMatrix4(points.matrixWorld);
        } else { return; }
    } else if (state.selectedObject.meshReference) {
        state.selectedObject.meshReference.updateMatrixWorld();
        targetVec.setFromMatrixPosition(state.selectedObject.meshReference.matrixWorld);
    } else {
        const r = CONFIG.radius;
        let ra = state.selectedObject.ra_deg || state.selectedObject.ra || 0;
        let dec = state.selectedObject.dec_deg || state.selectedObject.dec || 0;
        
        if (state.selectedObject.objType === 'SolarSystem') {
             const altRad = state.selectedObject.alt * (Math.PI / 180);
             const azRad = state.selectedObject.az * (Math.PI / 180);
             targetVec.set(r * Math.cos(altRad) * Math.sin(azRad), r * Math.sin(altRad), -r * Math.cos(altRad) * Math.cos(azRad));
        } else {
             const lstRad = calculateLST(state.date, state.lon);
             const latRad = state.lat * Math.PI / 180;
             const sinLat = Math.sin(latRad); const cosLat = Math.cos(latRad);
             const coord = calcHorizontalCoord(ra, dec, lstRad, sinLat, cosLat, r);
             targetVec.set(coord.x, coord.y, coord.z);
        }
    }
    
    targetVec.project(camera);
    if (targetVec.z > 1 || Math.abs(targetVec.x) > 1 || Math.abs(targetVec.y) > 1) {
        reticle.classList.remove('visible'); reticle.style.display = 'none'; return;
    }
    const sx = (targetVec.x + 1) * window.innerWidth / 2;
    const sy = -(targetVec.y - 1) * window.innerHeight / 2;
    reticle.style.display = 'block';
    reticle.style.left = sx + 'px'; reticle.style.top = sy + 'px';
    reticle.style.transform = '';

    const reticleInfo = document.querySelector('.reticle-info');
    if (reticleInfo) {
        if (targetVec.x > 0) { reticleInfo.classList.add('style-left'); reticleInfo.classList.remove('style-right'); }
        else { reticleInfo.classList.add('style-right'); reticleInfo.classList.remove('style-left'); }
    }
    reticle.classList.add('visible');
}

function updateLabelSizes() {
    const fovFactor = camera.fov / 50.0;
    if (layers['ConstellationLabels']) {
        layers['ConstellationLabels'].mesh.children.forEach(sprite => {
            if (sprite.userData.baseScale) {
                sprite.scale.set(sprite.userData.baseScale.x * fovFactor, sprite.userData.baseScale.y * fovFactor, 1);
            }
        });
    }
    if (layers['StarLabels']) {
        layers['StarLabels'].mesh.children.forEach(child => {
            if (child.isGroup && child.children.length > 0) {
                const label = child.children[0];
                if (label.userData.isLabel && label.userData.baseScale) {
                    label.scale.set(label.userData.baseScale.x * fovFactor, label.userData.baseScale.y * fovFactor, 1);
                }
            }
        });
    }
    Object.keys(layers).forEach(key => {
        if (key === 'star' || key === 'ConstellationLines' || key === 'ConstellationLabels' || key === 'StarLabels') return;
        const group = layers[key].mesh;
        group.children.forEach(wrapper => {
            if (wrapper.children.length >= 2) {
                const label = wrapper.children[1];
                if (label.userData.isLabel && label.userData.baseScale) {
                    label.scale.set(label.userData.baseScale.x * fovFactor, label.userData.baseScale.y * fovFactor, 1);
                }
            }
        });
    });
}

// 天体名表示の位置をコントロールパネルの高さに合わせて調整する関数
function updateStarNameLayout() {
    const display = document.getElementById('selected-star-name-display');
    const controls = document.getElementById('mobile-controls');
    
    if (!display) return;

    // モバイル表示（幅900px以下）かつコントロールパネルが存在する場合
    if (window.innerWidth <= 900 && controls) {
        const panelHeight = controls.offsetHeight;
        // パネルの高さ + 10px の位置に設定
        display.style.bottom = (panelHeight + 10) + 'px';
    } else {
        // PCの場合は元の位置（70px）に戻す
        display.style.bottom = '70px';
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (layers['star']) {
        const points = layers['star'].mesh.children.find(c => c.isPoints);
        if (points) {
            points.material.uniforms.uTime.value += 0.005;
            if (points.material.uniforms.uFov) points.material.uniforms.uFov.value = camera.fov;
        }
    }
    
    updateLabelSizes();

    if (state.shuttleValue !== 0) {
        const speed = Math.pow(state.shuttleValue, 3) * 0.2; 
        state.date.setTime(state.date.getTime() + speed);
        updatePositions(); 
        const d = state.date;
        const local = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
        document.getElementById('date-picker').value = local.toISOString().slice(0, 16);
        const screenClock = document.getElementById('screen-clock');
        const mobileClockDisplay = document.getElementById('mobile-clock-display');
        if(screenClock || mobileClockDisplay){
            const year = d.getFullYear();
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            const hour = d.getHours().toString().padStart(2, '0');
            const min = d.getMinutes().toString().padStart(2, '0');
            
            // ▼ 変更：ここも末尾に (JST) を追加
            const dateStr = `${year}/${month}/${day} ${hour}:${min} (日本時間)`;
            
            if(screenClock) screenClock.textContent = dateStr;
            if(mobileClockDisplay) mobileClockDisplay.textContent = dateStr;
        }
    }
    if (state.viewControlMode === 'gyro' && state.gyroEnabled) {
        applyGyroToCamera();
    } else {
        controls.update();
    }

    // ---- 流星記録中は視点を固定（追加） ----
    if (state.meteor && state.meteor.locked) {
        camera.quaternion.copy(state.meteor.lockedQuat);
        if (controls) controls.enabled = false;
    }

        
// ---- Remote meteors follow current time/location (RA/Dec) ----
if (remoteMeteorGroup && state?.date && Number.isFinite(state?.lat) && Number.isFinite(state?.lon)) {
    // Smoothly ease the "display" time/location toward the current state to avoid choppy motion.

    if (state?.meteor?.displayEnabled !== false) {
    const targetT = state.date.getTime();
    const targetLat = state.lat;
    const targetLon = state.lon;

    if (!Number.isFinite(remoteMeteorSmooth.dateMs)) {
        remoteMeteorSmooth.dateMs = targetT;
        remoteMeteorSmooth.lat = targetLat;
        remoteMeteorSmooth.lon = targetLon;
    } else {
        const a = 0.18; // smoothing factor (0..1). Larger = snappier.
        remoteMeteorSmooth.dateMs += (targetT - remoteMeteorSmooth.dateMs) * a;
        remoteMeteorSmooth.lat += (targetLat - remoteMeteorSmooth.lat) * a;
        remoteMeteorSmooth.lon += (targetLon - remoteMeteorSmooth.lon) * a;
    }

    maybeRerenderRemoteMeteorsForState();
}

    // Keep meteor time labels aligned with the meteor line in screen space
    updateMeteorTimeLabelsAlignment();
    }

renderer.render(scene, camera);
    updateReticle();
}


// ============================
// Comets (NASA/JPL Horizons via AWS) 追加機能
// 既存機能に影響を与えないよう、彗星表示は明示的にONにした時だけ通信します。
// ============================

let lastCometFetchKey = null;
let cometObjects = []; // { group, sprite, data }
let cometTexture = null;

function initCometTexture() {
    if (cometTexture) return cometTexture;

    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");

    // nucleus
    const cx = size * 0.60;
    const cy = size * 0.50;
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.22);
    core.addColorStop(0.0, "rgba(255,255,255,1.0)");
    core.addColorStop(1.0, "rgba(255,255,255,0.0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // tail (to left)
    const tail = ctx.createLinearGradient(size * 0.05, cy, cx, cy);
    tail.addColorStop(0.0, "rgba(200,255,240,0.0)");
    tail.addColorStop(0.6, "rgba(200,255,240,0.18)");
    tail.addColorStop(1.0, "rgba(200,255,240,0.0)");
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.ellipse(size * 0.25, cy, size * 0.42, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    cometTexture = new THREE.CanvasTexture(canvas);
    cometTexture.needsUpdate = true;
    return cometTexture;
}

async function fetchCometsFromApi(lat, lon, dateObj, signal) {
    const timeIso = dateObj.toISOString();
    const url = new URL(COMET_API_BASE + "/comets");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("time", timeIso);

    const res = await fetch(url.toString(), { method: "GET", signal });
    if (!res.ok) throw new Error("Comet API error: " + res.status);
    const json = await res.json();
    return json.comets || [];
}

function clearComets() {
    if (!layers.Comets) return;

    for (const obj of cometObjects) {
        layers.Comets.mesh.remove(obj.group);
        // テクスチャは共有なので dispose しない
        obj.sprite.material?.dispose?.();
    }
    cometObjects = [];
    layers.Comets.data = [];
}


function createCometLabelSprite(text) {
    // 他の天体名ラベルと揃える（背景なしのシンプル表示）
    // 既存の createLabelTexture を使い、Constellation/SolarSystem のラベルと同じ作りにする
    const labelMap = createLabelTexture(text, '#7CFF7C', 32);
    const material = new THREE.SpriteMaterial({
        map: labelMap,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        fog: false
    });
    const sprite = new THREE.Sprite(material);

    const aspect = labelMap.image.width / labelMap.image.height;
    const baseH = 12; // 他のラベルと合わせる
    const baseW = baseH * aspect;

    sprite.scale.set(baseW, baseH, 1);

    // updatePositions のラベル拡大縮小ロジックに乗せる
    sprite.userData.baseScale = { x: baseW, y: baseH };
    sprite.userData.isLabel = true;
    sprite.userData.labelType = "comet";
    return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function addCometObject(cometData) {
    if (!layers.Comets) return;

    const tex = initCometTexture();
    const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false
    });

    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(18, 18, 1);

    // 既存のクリック判定ロジックは「子を持つGroup」をターゲットにする設計なので、
    // 彗星も Group に userData を載せ、子に Sprite を入れる形に合わせます。
    const group = new THREE.Group();
    // 初期位置は未確定なので、1フレームでもカメラ原点に重なって白くならないよう非表示
    group.visible = false;

    // 既存UIに馴染むため、name / ra / dec / distance_au など既存のキーに寄せる
    group.userData = {
        type: "comet",
        objType: "Comet",
        name: cometData.name,
        cometId: cometData.cometId,
        ra: cometData.raDeg,
        dec: cometData.decDeg,
        distance_au: cometData.distanceAu
    };

    group.add(sprite);

    // 彗星名ラベル（彗星ONの間は常時表示）
    try {
        const label = createCometLabelSprite(cometData.name || cometData.cometId || 'Comet');
        label.position.set(14, -10, 0); // 他の天体名ラベルと揃える（右下寄せ）
        group.add(label);
    } catch (e) {
        // ラベル生成に失敗しても既存機能は止めない
        console.warn('Comet label create failed:', e);
    }

    layers.Comets.mesh.add(group);

    cometObjects.push({ group, sprite, data: cometData });
}

function updateCometObjectsPosition(r, lstRad, sinLat, cosLat) {
    if (!layers.Comets || !layers.Comets.visible) return;
    if (!cometObjects || cometObjects.length === 0) return;

    for (const obj of cometObjects) {
        const raDeg = obj.data.raDeg;
        const decDeg = obj.data.decDeg;
        const coord = calcHorizontalCoord(raDeg, decDeg, lstRad, sinLat, cosLat, r);

        if (!Number.isFinite(coord.x) || !Number.isFinite(coord.y) || !Number.isFinite(coord.z)) {
            // 座標計算に失敗したら表示しない（既存描画への影響を避ける）
            obj.group.visible = false;
            continue;
        }

        obj.group.position.set(coord.x, coord.y, coord.z);
        obj.group.visible = true;

        // 地平線下は薄く（完全非表示にしたければ 0 に）
        obj.sprite.material.opacity = (coord.y < 0) ? 0.25 : 1.0;
    }
}

// 分単位で時刻を丸める（キャッシュと整合）
function floorToMinuteDate(d) {
    const t = new Date(d);
    t.setSeconds(0, 0);
    return t;
}

async function refreshCometsIfNeeded() {
    // 彗星表示がOFFなら何もしない（既存機能への影響を避ける）
    if (!layers.Comets || !layers.Comets.visible) return;

    // Debounce + throttle: 時間シャトル等で連続更新されても API を連打しない
    const t = floorToMinuteDate(state.date);
    const key = `${state.lat.toFixed(3)}:${state.lon.toFixed(3)}:${t.toISOString()}`;
    if (key === lastCometFetchKey) return;

    // “取得対象が変わった” ことだけ記録し、取得はまとめて行う
    lastCometFetchKey = key;

    scheduleCometFetch(t);
}

// ---- fetch control (added) ----
let cometFetchInProgress = false;
let cometLastFetchAt = 0;
let cometFetchTimer = null;
let cometAbortController = null;

// 取得の最小間隔（ms）: 時間移動中の 500/レート制限を防ぐ
const COMET_MIN_FETCH_INTERVAL_MS = 1500;
// 連続操作の“落ち着き待ち”
const COMET_DEBOUNCE_MS = 350;

function scheduleCometFetch(timeObj) {
    if (cometFetchTimer) {
        clearTimeout(cometFetchTimer);
        cometFetchTimer = null;
    }

    const now = Date.now();
    const since = now - cometLastFetchAt;
    const waitThrottle = Math.max(0, COMET_MIN_FETCH_INTERVAL_MS - since);
    const wait = Math.max(COMET_DEBOUNCE_MS, waitThrottle);

    cometFetchTimer = setTimeout(() => {
        cometFetchTimer = null;
        runCometFetch(timeObj);
    }, wait);
}

async function runCometFetch(timeObj) {
    if (!layers.Comets || !layers.Comets.visible) return;

    // すでに取得中なら、次の schedule が発火するのを待つ（連打しない）
    if (cometFetchInProgress) return;

    cometFetchInProgress = true;
    cometLastFetchAt = Date.now();

    // 前回が残っていれば中断（最新の操作を優先）
    if (cometAbortController) {
        try { cometAbortController.abort(); } catch (e) {}
    }
    cometAbortController = new AbortController();

    try {
        const comets = await fetchCometsFromApi(state.lat, state.lon, timeObj, cometAbortController.signal);
        layers.Comets.data = comets;

        clearComets();
        for (const c of comets) addCometObject(c);

        // 取得直後に1回だけ再配置して、他UI操作なしでも即表示されるようにする
        try { updatePositions(); } catch (e) {}

    } catch (e) {
        // Abort は想定内（時間移動中に前の通信を切る）
        if (e && (e.name === "AbortError" || String(e).includes("AbortError"))) {
            // no-op
        } else {
            console.warn("Comet refresh failed:", e);
        }
    } finally {
        cometFetchInProgress = false;
    }
}


init();


// =====================================================================================
// 流星記録モード（追加）
// =====================================================================================

function getDeviceId() {
  const KEY = "meteorDeviceId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now());
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function postMeteorRecord(rec) {
  const body = {
    deviceId: getDeviceId(),
    observedAt: new Date(rec.dateIso).getTime(),
    lat: rec.lat,
    lon: rec.lon,
    startAltAz: rec.startAltAz,
    endAltAz: rec.endAltAz,
    brightness: (Number.isFinite(rec.brightness) ? rec.brightness : undefined),
  };
  if (body.brightness === undefined) delete body.brightness;


  const res = await fetch(`${METEOR_API_BASE}/records`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /records failed: ${res.status} ${text}`);
  }
  return res.json();
}


async function fetchRecentMeteorRecords(windowSec = 3600) {
  const res = await fetch(`${METEOR_API_BASE}/records?window=${encodeURIComponent(windowSec)}`, {
    method: "GET",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET /records failed: ${res.status} ${text}`);
  }
  return res.json(); // { items: [...] }
}

function altAzDegToWorld(altDeg, azDeg, radius = CONFIG.radius) {
  const alt = altDeg * Math.PI / 180;
  const az = azDeg * Math.PI / 180;
  const cosAlt = Math.cos(alt);
  const x = radius * cosAlt * Math.sin(az);
  const y = radius * Math.sin(alt);
  const z = -radius * cosAlt * Math.cos(az);
  return new THREE.Vector3(x, y, z);
}

// --- Astronomy helpers (RA/Dec <-> Alt/Az) ---
// Azimuth convention: degrees from North towards East (0=N, 90=E), matching altAzDegToWorld.
function normalizeRad0To2Pi(x) {
  const twoPi = Math.PI * 2;
  x = x % twoPi;
  if (x < 0) x += twoPi;
  return x;
}
function jdFromUnixMs(ms) {
  return ms / 86400000 + 2440587.5;
}
function gmstRadFromJd(jd) {
  // Approximate GMST (sufficient for visualization)
  const T = (jd - 2451545.0) / 36525.0;
  let gmstDeg =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000.0;
  gmstDeg = ((gmstDeg % 360) + 360) % 360;
  return gmstDeg * Math.PI / 180;
}
function lstRad(dateMs, lonDeg) {
  const jd = jdFromUnixMs(dateMs);
  const gmst = gmstRadFromJd(jd);
  const lon = lonDeg * Math.PI / 180; // east positive
  return normalizeRad0To2Pi(gmst + lon);
}

function altAzDegToRaDecDeg(altDeg, azDeg, latDeg, lonDeg, dateMs) {
  const alt = altDeg * Math.PI / 180;
  const az = azDeg * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;

  const LST = lstRad(dateMs, lonDeg);

  const sinDec = Math.sin(alt) * Math.sin(lat) + Math.cos(alt) * Math.cos(lat) * Math.cos(az);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

  // Hour angle H
  const sinH = (-Math.sin(az) * Math.cos(alt)) / Math.cos(dec);
  const cosH = (Math.sin(alt) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  const H = Math.atan2(sinH, cosH);

  const ra = normalizeRad0To2Pi(LST - H);

  return { raDeg: ra * 180 / Math.PI, decDeg: dec * 180 / Math.PI };
}

function raDecDegToAltAzDeg(raDeg, decDeg, latDeg, lonDeg, dateMs) {
  const ra = raDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;

  const LST = lstRad(dateMs, lonDeg);
  const H = normalizeRad0To2Pi(LST - ra);

  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const y = -Math.sin(H) * Math.cos(dec);
  const x = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
  let az = Math.atan2(y, x);
  az = normalizeRad0To2Pi(az);

  return { altDeg: alt * 180 / Math.PI, azDeg: az * 180 / Math.PI };
}

function raDecDegToWorld(raDeg, decDeg, radius = CONFIG.radius) {
  // Use smoothed "display" time/location for fluid motion while user drags sliders.
  const hasSmooth = remoteMeteorSmooth && Number.isFinite(remoteMeteorSmooth.dateMs) &&
    Number.isFinite(remoteMeteorSmooth.lat) && Number.isFinite(remoteMeteorSmooth.lon);

  const dateMs = hasSmooth ? remoteMeteorSmooth.dateMs : (state?.date ? state.date.getTime() : null);
  const lat = hasSmooth ? remoteMeteorSmooth.lat : state?.lat;
  const lon = hasSmooth ? remoteMeteorSmooth.lon : state?.lon;

  if (!Number.isFinite(dateMs) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const aa = raDecDegToAltAzDeg(raDeg, decDeg, lat, lon, dateMs);
  return altAzDegToWorld(aa.altDeg, aa.azDeg, radius);
}




// 明るさ（1〜5）から流星線の太さを決める（既存の見た目= brightness 3 を基準）
function meteorTubeRadiusFromBrightness(brightness, base = 1.4) {
  const b = Number(brightness);
  const bb = (Number.isFinite(b) && b >= 1 && b <= 5) ? Math.round(b) : 3;
  // 1:細い〜5:太い（極端になりすぎない範囲）
  const scaleByB = { 1: 0.70, 2: 0.85, 3: 1.00, 4: 1.25, 5: 1.60 };
  return base * (scaleByB[bb] || 1.0);
}

function createMeteorTubeMesh(p1, p2, colorStartHex, colorEndHex, tubeRadius = 1.4) {
  const radius = CONFIG.radius;
  const segments = 64;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(slerpOnSphere(p1, p2, t, radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tubeGeom = new THREE.TubeGeometry(curve, segments, tubeRadius, 10, false);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColorStart: { value: new THREE.Color(colorStartHex) },
      uColorEnd:   { value: new THREE.Color(colorEndHex) },

      // --- taper (spear-like tip) ---
      uTubeRadius: { value: tubeRadius },
      uTipStart:   { value: 0.78 },
      uTipPower:   { value: 1.6 },
    },
    vertexShader: `
      uniform float uTubeRadius;
      uniform float uTipStart;
      uniform float uTipPower;

      varying vec2 vUv;
      void main() {
        vUv = uv;

        float t = clamp(uv.x, 0.0, 1.0);
        float tip = smoothstep(uTipStart, 1.0, t);
        float s = 1.0 - pow(tip, uTipPower);

        vec3 p = position - normal * uTubeRadius * (1.0 - s);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColorStart;
      uniform vec3 uColorEnd;
      varying vec2 vUv;

      void main() {
        float t = clamp(vUv.x, 0.0, 1.0);
        float alpha = pow(t, 1.6) * 0.85;

        float ring = 1.0 - abs(vUv.y - 0.5) * 1.2;
        ring = clamp(ring, 0.0, 1.0);
        alpha *= mix(0.55, 1.0, ring);

        vec3 col = mix(uColorStart, uColorEnd, t);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(tubeGeom, mat);
  return mesh;
}

// --- Time label helpers ---
function formatObservedTime(ms) {
  try {
    // Display in Japan time with explicit JST label.
    const d = new Date(ms);
    const dateStr = d.toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const timeStr = d.toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    return `${dateStr} ${timeStr} JST`;
  } catch (e) {
    return "";
  }
}

function createTimeLabelSprite(text, isMine) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const fontSize = 86;
  const padX = 26;
  const padY = 18;

  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const textW = Math.ceil(metrics.width);

  canvas.width = textW + padX * 2;
  canvas.height = fontSize + padY * 2;

  // Re-apply font after resizing
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = "top";

  // Background
  ctx.fillStyle = isMine ? "rgba(0, 0, 0, 0.55)" : "rgba(0, 0, 0, 0.40)";
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 10);
  ctx.fill();

  // Border
  ctx.lineWidth = 3;
  ctx.strokeStyle = isMine ? "rgba(255, 216, 74, 0.9)" : "rgba(160, 200, 255, 0.8)";
  roundRect(ctx, 1.5, 1.5, canvas.width - 3, canvas.height - 3, 10);
  ctx.stroke();

  // Text
  ctx.fillStyle = isMine ? "rgba(255, 255, 255, 0.95)" : "rgba(235, 245, 255, 0.95)";
  ctx.fillText(text, padX, padY);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(mat);

  // Scale: adjust so it's readable but not huge
  const scale = 1.9; // tweakable (larger for readability)
  sprite.scale.set(canvas.width * scale * 0.045, canvas.height * scale * 0.045, 1);

  // for cleanup
  sprite.userData.__labelTexture = tex;
  return sprite;
}


// Time label as a 3D plane (instead of Sprite).
// This is more stable for "embedded into the line" rendering because orientation can be derived
// from meteor tangent + camera direction without relying on screen-space sprite rotation.
function createTimeLabelPlaneMesh(text, isMine) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const fontSize = 86;
  const padX = 26;
  const padY = 18;

  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const textW = Math.ceil(metrics.width);

  canvas.width = textW + padX * 2;
  canvas.height = fontSize + padY * 2;

  // Re-apply font after resizing
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = "top";

  // Background
  ctx.fillStyle = isMine ? "rgba(0, 0, 0, 0.55)" : "rgba(0, 0, 0, 0.40)";
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 10);
  ctx.fill();

  // Border
  ctx.lineWidth = 3;
  ctx.strokeStyle = isMine ? "rgba(255, 216, 74, 0.9)" : "rgba(160, 200, 255, 0.8)";
  roundRect(ctx, 1.5, 1.5, canvas.width - 3, canvas.height - 3, 10);
  ctx.stroke();

  // Text
  ctx.fillStyle = isMine ? "rgba(255, 255, 255, 0.95)" : "rgba(235, 245, 255, 0.95)";
  ctx.fillText(text, padX, padY);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const geom = new THREE.PlaneGeometry(1, 1);

  const mesh = new THREE.Mesh(geom, mat);

  // Match the same approximate on-screen size as createTimeLabelSprite
  const scale = 1.9;
  const worldW = canvas.width * scale * 0.045;
  const worldH = canvas.height * scale * 0.045;
  mesh.scale.set(worldW, worldH, 1);

  // for cleanup
  mesh.userData = mesh.userData || {};
  mesh.userData.__labelTexture = tex;
  mesh.userData.labelWorldW = worldW;
  mesh.userData.labelWorldH = worldH;

  return mesh;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}



function renderRecentMeteorRecords(items) {
  if (!remoteMeteorGroup) return;

  const myId = getDeviceId();
  // 簡易ハッシュ（同じ結果なら再計算しない）
  const key = (items || []).map(it => `${it.recordedAt}:${it.deviceId}`).join("|");
  if (key && key === remoteMeteorLastKey) {
    // ただし、時刻/観測地が変わった場合は描画し直す必要がある
    maybeRerenderRemoteMeteorsForState();
    return;
  }
  remoteMeteorLastKey = key;

  // まずは “観測時点/観測地のAlt/Az” を RA/Dec に変換してキャッシュ化
  remoteMeteorCache = [];
  const list = Array.isArray(items) ? items : [];
  const max = Math.min(list.length, 200);

  for (let i = 0; i < max; i++) {
    const it = list[i];
    if (!it?.startAltAz || !it?.endAltAz) continue;

    const obsLat = Number(it.lat);
    const obsLon = Number(it.lon);
    const observedAt = Number(it.observedAt);

    if (!Number.isFinite(obsLat) || !Number.isFinite(obsLon) || !Number.isFinite(observedAt)) continue;

    const sAlt = Number(it.startAltAz.altDeg);
    const sAz  = Number(it.startAltAz.azDeg);
    const eAlt = Number(it.endAltAz.altDeg);
    const eAz  = Number(it.endAltAz.azDeg);
    if (![sAlt, sAz, eAlt, eAz].every(Number.isFinite)) continue;

    const startRaDec = altAzDegToRaDecDeg(sAlt, sAz, obsLat, obsLon, observedAt);
    const endRaDec   = altAzDegToRaDecDeg(eAlt, eAz, obsLat, obsLon, observedAt);

    const isMine = (it.deviceId && it.deviceId === myId);

    remoteMeteorCache.push({
      recordedAt: it.recordedAt,
      deviceId: it.deviceId,
      mine: isMine,
      observedAt,
      // 明るさ（1〜5）。未設定の場合は 3。自分の記録で backend が未対応ならローカルoverrideを使う
      brightness: (() => {
        const b = Number(it.brightness);
        if (Number.isFinite(b) && b >= 1 && b <= 5) return Math.round(b);

        if (isMine && it.recordedAt && meteorBrightnessOverrideByRecordedAt?.has?.(it.recordedAt)) {
          const ob = Number(meteorBrightnessOverrideByRecordedAt.get(it.recordedAt));
          if (Number.isFinite(ob) && ob >= 1 && ob <= 5) return Math.round(ob);
        }
        return 3;
      })(),
      startRaDec,
      endRaDec
    });
  }

  // 現在の時刻/観測地（state.date, state.lat/lon）で描画
  rerenderRemoteMeteorsForState();
}

function getRemoteMeteorStateKey() {
  const hasSmooth = remoteMeteorSmooth && Number.isFinite(remoteMeteorSmooth.dateMs) &&
    Number.isFinite(remoteMeteorSmooth.lat) && Number.isFinite(remoteMeteorSmooth.lon);

  const t = hasSmooth ? remoteMeteorSmooth.dateMs : (state?.date ? state.date.getTime() : 0);
  const lat = hasSmooth ? remoteMeteorSmooth.lat : (typeof state?.lat === "number" ? state.lat : NaN);
  const lon = hasSmooth ? remoteMeteorSmooth.lon : (typeof state?.lon === "number" ? state.lon : NaN);

  // Reduce sensitivity: round time to 100ms, lat/lon to 1e-5 deg to avoid tiny jitter.
  const tQ = Math.round(t / 100) * 100;
  const latQ = Math.round(lat * 1e5) / 1e5;
  const lonQ = Math.round(lon * 1e5) / 1e5;
  return `${tQ}|${latQ}|${lonQ}`;
}



function loadMeteorDisplayEnabledFromStorage() {
  try {
    const v = localStorage.getItem('meteorDisplayEnabled');
    if (v === null) return null;
    return v === '1' || v === 'true';
  } catch (e) {
    return null;
  }
}

function setMeteorToggleButtonsActive(isOn) {
  const pcBtn = document.getElementById('btn-meteors');
  const mobileBtn = document.getElementById('btn-mobile-meteors');
  if (pcBtn) pcBtn.classList.toggle('active', !!isOn);
  if (mobileBtn) mobileBtn.classList.toggle('active', !!isOn);
}

function applyMeteorDisplayEnabled(enabled) {
  const isOn = enabled !== false;
  if (state?.meteor) state.meteor.displayEnabled = isOn;

  try { localStorage.setItem('meteorDisplayEnabled', isOn ? '1' : '0'); } catch (e) {}

  if (remoteMeteorGroup) {
    remoteMeteorGroup.visible = isOn;
    if (!isOn) {
      clearRemoteMeteorGroup();
      stopRemoteMeteorPolling();
    } else {
      startRemoteMeteorPolling();
      rerenderRemoteMeteorsForState();
    }
  }

  setMeteorToggleButtonsActive(isOn);
}
function clearRemoteMeteorGroup() {
  if (!remoteMeteorGroup) return;
  while (remoteMeteorGroup.children.length) {
    const obj = remoteMeteorGroup.children.pop();
    if (obj.geometry) obj.geometry.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
      else obj.material.dispose?.();
    }
  }
}

function rerenderRemoteMeteorsForState() {
  if (!remoteMeteorGroup) return;

  // stateが未初期化なら何もしない
  if (!state?.date || !Number.isFinite(state?.lat) || !Number.isFinite(state?.lon)) return;

  clearRemoteMeteorGroup();

  let meteorLabelCount = 0;

  for (const it of remoteMeteorCache) {
    const p1 = raDecDegToWorld(it.startRaDec.raDeg, it.startRaDec.decDeg);
    const p2 = raDecDegToWorld(it.endRaDec.raDeg, it.endRaDec.decDeg);
    if (!p1 || !p2) continue;

    // --- Meteor line (split to create a gap for the time label) ---
    // Keep the original look by reusing createMeteorTubeMesh; only geometry is split.
    const baseColorStart = it.mine ? 0xffd84a : 0x666666;
    const baseColorEnd   = it.mine ? 0x7ad7ff : 0x88aaff;

    // Default: single segment (fallback when label is disabled / cannot be placed)
    let meteorMeshes = [];

    // Build the same sampled curve points used by createMeteorTubeMesh (slerp + CatmullRom)
    const radius = CONFIG.radius;
    const segments = 64;
    const pts = [];
    for (let ii = 0; ii <= segments; ii++) {
      const tt = ii / segments;
      pts.push(slerpOnSphere(p1, p2, tt, radius));
    }

    // Helper: compute cumulative arc lengths along the sampled polyline
    const cum = [0];
    for (let ii = 1; ii < pts.length; ii++) {
      cum[ii] = cum[ii - 1] + pts[ii].distanceTo(pts[ii - 1]);
    }
    const totalLen = cum[cum.length - 1] || 0;

    // Choose a mid point for the label (same midT as before for consistency)
    const midT = 0.6;
    const midIdx = Math.max(1, Math.min(segments - 1, Math.round(midT * segments)));
    const mid = pts[midIdx].clone();

    // Fallback meshes: full meteor as one tube
    const fullMesh = createMeteorTubeMesh(p1, p2, baseColorStart, baseColorEnd, meteorTubeRadiusFromBrightness(it.brightness, 1.4));
    fullMesh.userData = { recordedAt: it.recordedAt, deviceId: it.deviceId, mine: it.mine };
    meteorMeshes.push(fullMesh);

    // --- Time label placed along the line (no gap): keep the meteor continuous and place a plane label right beside it ---
    // This avoids readability issues from splitting the line, while still keeping the label stable in 3D.
    if (SHOW_METEOR_TIME_LABELS && Number.isFinite(it.observedAt) && meteorLabelCount < MAX_METEOR_TIME_LABELS) {
      const labelText = formatObservedTime(it.observedAt);
      if (labelText && totalLen > 0) {
        const labelMesh = createTimeLabelPlaneMesh(labelText, it.mine);

        // Choose a midpoint and local tangent from the sampled curve (matches the drawn meteor)
        const midLen = cum[midIdx];

        // Helper: interpolate a point on the sampled polyline by arc length
        const pointAtLen = (targetLen) => {
          const L = Math.max(0, Math.min(totalLen, targetLen));
          let hi = 1;
          while (hi < cum.length && cum[hi] < L) hi++;
          const lo = Math.max(0, hi - 1);
          if (hi >= cum.length) return pts[pts.length - 1].clone();
          const segLen = Math.max(1e-6, cum[hi] - cum[lo]);
          const alpha = (L - cum[lo]) / segLen;
          return pts[lo].clone().lerp(pts[hi], alpha);
        };

        const pPrev = pointAtLen(Math.max(0, midLen - 1.0));
        const pNext = pointAtLen(Math.min(totalLen, midLen + 1.0));

        // Store sampled points for per-frame alignment/positioning
        labelMesh.userData = labelMesh.userData || {};
        labelMesh.userData.isMeteorTimeLabelMesh = true;
        labelMesh.userData.pPrev = pPrev.clone();
        labelMesh.userData.pMid  = mid.clone();
        labelMesh.userData.pNext = pNext.clone();

        // Offset in "screen-ish" direction (computed each frame) by a pixel-based amount converted to world units.
        // This keeps the label snug along the line without splitting it.
        const viewH = (renderer?.domElement?.clientHeight || renderer?.domElement?.height || window.innerHeight || 800);
        const fovRad = THREE.MathUtils.degToRad(camera.fov || 50);
        const depth = Math.max(1e-3, camera.position.distanceTo(mid));
        const worldPerPixel = (2 * depth * Math.tan(fovRad * 0.5)) / viewH;

        const desiredOffsetPx = 8; // closer to the meteor line
        const desiredLiftPx   = 2;   // small lift to avoid z-fighting/blending artifacts

        labelMesh.userData.offsetWorld = worldPerPixel * desiredOffsetPx;
        labelMesh.userData.liftWorld   = worldPerPixel * desiredLiftPx;

        // Initial position (will be refined each frame in updateMeteorTimeLabelsAlignment)
        labelMesh.position.copy(mid);

        remoteMeteorGroup.add(labelMesh);
        meteorLabelCount++;
      }
    }

    // Add meteor meshes

    for (const mm of meteorMeshes) remoteMeteorGroup.add(mm);
  }

  remoteMeteorLastStateKey = getRemoteMeteorStateKey();
  remoteMeteorLastRerenderAt = Date.now();
}

function maybeRerenderRemoteMeteorsForState() {
  // While user drags the time/location controls, update frequently but still throttle.
  const key = getRemoteMeteorStateKey();
  const now = Date.now();
  const minIntervalMs = 33; // ~30fps
  if (key !== remoteMeteorLastStateKey && now - remoteMeteorLastRerenderAt > minIntervalMs) {
    rerenderRemoteMeteorsForState();
  }
}

function normalizeAngleUpright(rad) {
  // Keep within [-90°, +90°] so text is never upside down.
  while (rad > Math.PI / 2) rad -= Math.PI;
  while (rad < -Math.PI / 2) rad += Math.PI;
  return rad;
}

function updateMeteorTimeLabelsAlignment() {
  if (!remoteMeteorGroup || !camera) return;

  const upWorld = new THREE.Vector3(0, 1, 0);

  // Ensure camera matrices are up-to-date before projections / alignment
  camera.updateMatrixWorld?.(true);

  for (const obj of remoteMeteorGroup.children) {
    // Legacy sprite-based labels (kept for backward compatibility)
    if (obj?.isSprite && obj.userData?.isMeteorTimeLabel && obj.material) {
      const pPrev = obj.userData.pPrev;
      const pMid  = obj.userData.pMid;
      const pNext = obj.userData.pNext;
      if (!pPrev || !pMid || !pNext) continue;

      const offset = Number(obj.userData.offset ?? 14);

      // Tangent from the same sampled curve points (matches the drawn meteor)
      const tangent = pNext.clone().sub(pPrev).normalize();

      // Zenith side in world space
      const radial = pMid.clone().normalize();
      const upT = upWorld.clone().sub(radial.clone().multiplyScalar(upWorld.dot(radial))).normalize();
      let side = new THREE.Vector3().crossVectors(tangent, radial).normalize();
      if (side.dot(upT) < 0) side.multiplyScalar(-1);

      // Position next to the line
      obj.position.copy(pMid.clone().add(side.multiplyScalar(offset)));

      // Rotation: align with projected tangent direction in screen space (then keep upright)
      const a = pMid.clone().project(camera);
      const b = pMid.clone().add(tangent.clone().multiplyScalar(10)).project(camera);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) + Math.abs(dy) < 1e-6) continue;

      const angle = Math.atan2(dy, dx);
      obj.material.rotation = normalizeAngleUpright(angle);
      continue;
    }

    // New plane-mesh labels embedded into the meteor line
    if (!obj?.isMesh || !obj.userData?.isMeteorTimeLabelMesh) continue;

    const pPrev = obj.userData.pPrev;
    const pMid  = obj.userData.pMid;
    const pNext = obj.userData.pNext;
    if (!pPrev || !pMid || !pNext) continue;

    // X axis: meteor tangent (world)
let xAxis = pNext.clone().sub(pPrev).normalize();
if (xAxis.lengthSq() < 1e-12) continue;

// Keep text from mirroring: ensure X points toward the screen's right direction.
// If the tangent points toward screen-left, the plane's texture would appear mirrored.
const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
if (xAxis.dot(camRight) < 0) xAxis.multiplyScalar(-1);

    // Build a basis that keeps X fixed but makes the label face the camera as much as possible.
    // Z axis: camera direction projected onto the plane perpendicular to X.
    const camDir = camera.position.clone().sub(pMid).normalize();
    let zAxis = camDir.clone().sub(xAxis.clone().multiplyScalar(camDir.dot(xAxis)));
    if (zAxis.lengthSq() < 1e-12) {
      // Degenerate (camera aligned with tangent): fall back to radial direction
      zAxis = pMid.clone().normalize().sub(xAxis.clone().multiplyScalar(pMid.clone().normalize().dot(xAxis)));
    }
    zAxis.normalize();

    // Y axis: completes right-handed basis
    let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    if (yAxis.lengthSq() < 1e-12) continue;

    // Keep text upright-ish in the world: prefer Y pointing toward world up
    if (yAxis.dot(upWorld) < 0) {
      yAxis.multiplyScalar(-1);
      zAxis.multiplyScalar(-1);
    }

    const mtx = new THREE.Matrix4();
    mtx.makeBasis(xAxis, yAxis, zAxis);
    obj.quaternion.setFromRotationMatrix(mtx);


    // Position the label right beside the meteor line (no gap).
    const offsetWorld = Number(obj.userData.offsetWorld ?? 0);
    const liftWorld = Number(obj.userData.liftWorld ?? 0);
    const radial = pMid.clone().normalize();
    obj.position.copy(
      pMid.clone()
        .add(yAxis.clone().multiplyScalar(offsetWorld))
        .add(radial.multiplyScalar(liftWorld))
    );
  }
}



function stopRemoteMeteorPolling() {
  if (remoteMeteorPollTimer) {
    clearInterval(remoteMeteorPollTimer);
    remoteMeteorPollTimer = null;
  }
}


function startRemoteMeteorPolling() {
  if (remoteMeteorPollTimer) return;
  // まず1回即時取得
  (async () => {
    try {
      const data = await fetchRecentMeteorRecords(3600);
      renderRecentMeteorRecords(data.items || []);
    } catch (e) {
      console.warn("Initial meteor fetch failed:", e);
    }
  })();

  remoteMeteorPollTimer = setInterval(async () => {
    try {
      const data = await fetchRecentMeteorRecords(3600);
      renderRecentMeteorRecords(data.items || []);
    } catch (e) {
      console.warn("Meteor refresh failed:", e);
    }
  }, 30000);
}


function initMeteorUi() {
    if (meteorUi.container) return;

    // ---- 流星記録ボタン（ジャイロの下に同サイズで配置） ----
    const btn = document.createElement('button');
    btn.id = 'meteor-icon-btn';
    btn.setAttribute('aria-label', '流星を記録');
    btn.type = 'button';
    btn.innerHTML = `<img src="assets/img/shooting_icon.png" alt="shooting star">`;
    // 状態クラス（オフ/オン）
    btn.classList.add('off');

    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, { passive: true });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();

        // 既に流星記録モード中なら、このボタンで終了（通常モードへ戻る）
        if (state.meteor && state.meteor.mode && state.meteor.mode !== 'idle') {
            resetMeteorSelection(true); // モード解除
            return;
        }

        // まだ開始していない場合は確認→開始
        openMeteorConfirm();
    });

    const lifelogBtn = document.createElement('button');
    lifelogBtn.id = 'lifelog-icon-btn';
    lifelogBtn.setAttribute('aria-label', '星空ライフログへ記録');
    lifelogBtn.type = 'button';
    lifelogBtn.innerHTML = `<img src="${LIFELOG_BUTTON_ICON_URL}" alt="lifelog">`;
    lifelogBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, { passive: true });
    lifelogBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
    lifelogBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveSkyCaptureForLifelog();
    });

    // ヒント
    const hint = document.createElement('div');
    hint.id = 'meteor-hint';
    hint.innerHTML = `<div id="meteor-hint-text"></div>`;



    // ---- 画面上部のモード表示（追加） ----
    const modeBanner = document.createElement('div');
    modeBanner.id = 'meteor-mode-banner';
    modeBanner.textContent = '流星記録モード';

    // モーダル
    const modal = document.createElement('div');
    modal.id = 'meteor-modal';
    modal.innerHTML = `
        <div class="panel">
<style>
/* --- Override: remove border/background for observation datetime & brightness sections --- */
#meteor-save-modal .section {
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
}
</style>

            <div class="title">流星記録モード</div>
            <div class="desc">流星が流れた方向を向いていますか？</div>
            <div class="row">
                <button id="meteor-modal-cancel">キャンセル</button>
                <button id="meteor-modal-ok" class="primary">OK</button>
            </div>
        </div>
    `;


    // 保存確認モーダル（時刻調整）
    const saveModal = document.createElement('div');
    saveModal.id = 'meteor-save-modal';
    saveModal.innerHTML = `
        <div class="panel">
            <div class="title">流星の記録を保存</div>
            
            <div class="section">
                <label for="meteor-save-datetime" class="field-label">★観測日時</label>
                <div class="field" style="margin-top:8px;">
                    <input type="datetime-local" id="meteor-save-datetime" />
                </div>
            </div>

            <div class="section">
                <label class="field-label">★明るさ5段階評価(星が多いほど明るい)</label>
                <div class="field" style="margin-top:8px;">
                    <div id="meteor-brightness-stars" class="meteor-stars" role="radiogroup" aria-label="明るさ（5段階）">
                        <button type="button" class="meteor-star" data-value="1" role="radio" aria-checked="false" aria-label="明るさ 1">★</button>
                        <button type="button" class="meteor-star" data-value="2" role="radio" aria-checked="false" aria-label="明るさ 2">★</button>
                        <button type="button" class="meteor-star" data-value="3" role="radio" aria-checked="false" aria-label="明るさ 3">★</button>
                        <button type="button" class="meteor-star" data-value="4" role="radio" aria-checked="false" aria-label="明るさ 4">★</button>
                        <button type="button" class="meteor-star" data-value="5" role="radio" aria-checked="false" aria-label="明るさ 5">★</button>
                    </div>
                    <div id="meteor-brightness-label" class="meteor-brightness-label"></div>
                    <input type="hidden" id="meteor-save-brightness" value="3" />
                </div>
            </div>

            <div class="row" style="margin-top:16px;">
            <button id="meteor-save-ok" class="primary">保存する</button>
            <button id="meteor-save-cancel">戻る</button>
            </div>
        </div>
    `;

    // アクション（保存/やり直し）
    const actions = document.createElement('div');
    actions.id = 'meteor-actions';
    actions.innerHTML = `
        <button id="meteor-save-btn">保存</button>
        <button id="meteor-reset-btn">やり直し</button>
    `;

    // 追加先：ジャイロボタンが居ればその直後。居なければ body。
    const gyroBtn = document.getElementById('gyro-icon-btn');
    if (gyroBtn && gyroBtn.parentNode) {
        gyroBtn.parentNode.insertBefore(btn, gyroBtn.nextSibling);
        gyroBtn.parentNode.insertBefore(lifelogBtn, btn.nextSibling);
    } else {
        document.body.appendChild(btn);
        document.body.appendChild(lifelogBtn);
    }
    document.body.appendChild(hint);
    document.body.appendChild(modeBanner);
    document.body.appendChild(modal);
    document.body.appendChild(saveModal);
    document.body.appendChild(actions);

    meteorUi.container = document.body;
    meteorUi.btn = btn;
    meteorUi.lifelogBtn = lifelogBtn;
    meteorUi.hint = hint;
    meteorUi.hintText = document.getElementById('meteor-hint-text');


    meteorUi.modeBanner = modeBanner;
    meteorUi.modal = modal;
    meteorUi.modalOk = document.getElementById('meteor-modal-ok');
    meteorUi.modalCancel = document.getElementById('meteor-modal-cancel');

    meteorUi.saveModal = saveModal;
    meteorUi.saveModalInput = document.getElementById('meteor-save-datetime');
    meteorUi.saveModalBrightness = document.getElementById('meteor-save-brightness');

    // 明るさ★UI（5段階）
    meteorUi.saveModalStars = document.getElementById('meteor-brightness-stars');
    meteorUi.saveModalBrightnessLabel = document.getElementById('meteor-brightness-label');

    const brightnessLabelText = (v) => {
        const b = Number(v);
        switch (b) {
            case 1: return 'ほとんどの星より暗い';
            case 2: return '他の星よりやや暗い';
            case 3: return '他の星と同じくらい';
            case 4: return 'ほとんどの星より明るい';
            case 5: return '1番明るい星より明るい';
            default: return '';
        }
    };

    const setBrightnessUi = (v) => {
        const b = Math.max(1, Math.min(5, Math.round(Number(v) || 3)));
        if (meteorUi.saveModalBrightness) meteorUi.saveModalBrightness.value = String(b);
        if (meteorUi.saveModalBrightnessLabel) meteorUi.saveModalBrightnessLabel.textContent = '明るさの基準：' + brightnessLabelText(b);
        meteorUi.saveModalBrightnessLabel.style.fontSize = '1.1em';

        if (meteorUi.saveModalStars) {
            const stars = Array.from(meteorUi.saveModalStars.querySelectorAll('.meteor-star'));
            stars.forEach((el) => {
                const val = Number(el.getAttribute('data-value'));
                const active = val <= b;

                // Requested behavior:
                // - Selected stars: filled (★) with deep yellow
                // - Unselected stars: hollow (☆)
                el.textContent = active ? '★' : '☆';

                el.classList.toggle('active', active);
                el.setAttribute('aria-checked', (val === b) ? 'true' : 'false');
            });
        }
    };
    meteorUi.setBrightnessUi = setBrightnessUi;

    if (meteorUi.saveModalStars) {
        meteorUi.saveModalStars.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            const btn = t.closest('.meteor-star');
            if (!btn) return;
            const v = Number(btn.getAttribute('data-value'));
            if (Number.isFinite(v)) setBrightnessUi(v);
        });

        // キーボード操作（左右で変更）
        meteorUi.saveModalStars.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const cur = Number(meteorUi.saveModalBrightness?.value) || 3;
            const next = e.key === 'ArrowRight' ? cur + 1 : cur - 1;
            setBrightnessUi(next);
        });
        meteorUi.saveModalStars.tabIndex = 0;
    }

    // 初期値
    setBrightnessUi(3);
    meteorUi.saveModalOk = document.getElementById('meteor-save-ok');
    meteorUi.saveModalCancel = document.getElementById('meteor-save-cancel');

    meteorUi.btnSave = document.getElementById('meteor-save-btn');
    meteorUi.btnReset = document.getElementById('meteor-reset-btn');

    // モーダル操作
    meteorUi.modalCancel.onclick = () => closeMeteorConfirm();
    meteorUi.modalOk.onclick = () => {
        closeMeteorConfirm();
        beginMeteorSelection();
    }; 
    modal.addEventListener('click', (e) => {
        // 背景クリックで閉じる
        if (e.target === modal) closeMeteorConfirm();

    // 保存確認モーダル操作
    meteorUi.saveModalCancel.onclick = () => closeMeteorSaveModal();
    meteorUi.saveModalOk.onclick = () => confirmMeteorSave();
    saveModal.addEventListener('click', (e) => {
        if (e.target === saveModal) closeMeteorSaveModal();
    });
    });

    // アクション操作
    meteorUi.btnSave.onclick = () => openMeteorSaveModal();
    meteorUi.btnReset.onclick = () => resetMeteorSelection(false);

    setMeteorHint('');
    setMeteorActionsVisible(false);

    // 3D側のグループ（scene が準備できてから呼ばれる想定）
    if (!meteorTrackGroup) {
        meteorTrackGroup = new THREE.Group();
        meteorTrackGroup.name = 'MeteorTracks';
        scene.add(meteorTrackGroup);
    }

    // ボタン位置をジャイロボタンと揃える（PCでも必ず表示）
    updateMeteorButtonPosition();
    window.addEventListener('resize', updateMeteorButtonPosition);

    // --- みんなの流星（直近1時間）表示 ---
    if (!remoteMeteorGroup) {
        remoteMeteorGroup = new THREE.Group();
        remoteMeteorGroup.name = 'RemoteMeteorTracks';
        if (typeof scene !== 'undefined' && scene) scene.add(remoteMeteorGroup);
    }
    // 表示がOFFならポーリングしない（無駄な通信を抑制）
    if (state?.meteor?.displayEnabled !== false) {
        remoteMeteorGroup.visible = true;
        startRemoteMeteorPolling();
    } else {
        remoteMeteorGroup.visible = false;
    }

}


function updateMeteorButtonPosition() {
    const btn = document.getElementById('meteor-icon-btn');
    if (!btn) return;
    const lifelogBtn = document.getElementById('lifelog-icon-btn');

    const fallbackLeft = 14;
    const fallbackTop = 14;

    const gyroBtn = document.getElementById('gyro-icon-btn');

    // サイズはジャイロと揃える（取れなければ44px）
    let size = 44;
    let left = fallbackLeft;
    let top = fallbackTop;

    if (gyroBtn) {
        const rect = gyroBtn.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(gyroBtn).display !== 'none' && window.getComputedStyle(gyroBtn).visibility !== 'hidden';
        if (visible) {
            size = Math.round(Math.max(rect.width, rect.height)) || size;
            left = Math.round(rect.left);
            top = Math.round(rect.bottom + 10); // 下に並べる
        }
    }

    const applyRoundIconButtonStyle = (el, topPx) => {
        if (!el) return;
        el.style.position = 'fixed';
        el.style.left = `${left}px`;
        el.style.top = `${topPx}px`;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.borderRadius = '999px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.zIndex = '30000';
        el.style.background = 'rgba(10, 14, 20, 0.55)';
        el.style.border = '1px solid rgba(255,255,255,0.25)';
        el.style.backdropFilter = 'blur(8px)';
        el.style.webkitBackdropFilter = 'blur(8px)';
        el.style.padding = '0';
        el.style.overflow = 'hidden';

        const img = el.querySelector('img');
        if (img) {
            img.style.width = '68%';
            img.style.height = '68%';
            img.style.objectFit = (el.id === 'lifelog-icon-btn') ? 'cover' : 'contain';
            if (el.id === 'lifelog-icon-btn') img.style.borderRadius = '999px';
            img.style.pointerEvents = 'none';
            img.style.display = 'block';
            img.style.filter = 'drop-shadow(0 0 6px rgba(255,255,255,0.25))';
        }
    };

    applyRoundIconButtonStyle(btn, top);
    const lifelogTop = top + size + 10;
    applyRoundIconButtonStyle(lifelogBtn, lifelogTop);
    const infoAnchorTop = lifelogBtn ? (lifelogTop + size) : (top + size);

    // ヒントの位置も追従
    const hint = document.getElementById('meteor-hint');
    if (hint) {
        hint.style.left = `${left}px`;
        hint.style.top = `${infoAnchorTop + 8}px`;
    }

    const actions = document.getElementById('meteor-actions');
    if (actions) {
        actions.style.left = `${left}px`;
        actions.style.top = `${infoAnchorTop + 64}px`;
    }
}


function openMeteorConfirm() {
    // 12時間制限（「今」から見て state.date が過去12h以内＆未来でない）
    const now = Date.now();
    const t = state.date?.getTime?.() ?? now;
    const diffMs = now - t;
    const withinPast12h = (diffMs >= 0 && diffMs <= 12 * 60 * 60 * 1000);
    if (!withinPast12h) {
        alert('流星の記録は「現在〜過去12時間以内」の表示時刻のときだけ可能です。');
        return;
    }

    // 既に選択中なら
    if (state.meteor.mode !== 'idle') {
        alert('流星記録モード中です。「やり直し」または「保存」をしてください。');
        return;
    }

    meteorUi.modal.style.display = 'flex';
    setMeteorBottomUiBlur(true);
}

function closeMeteorConfirm() {
    meteorUi.modal.style.display = 'none';
    // まだ流星記録モードに入っていない（キャンセルなど）場合は下部UIのぼかしを解除
    if (state && state.meteor && state.meteor.mode === 'idle') {
        setMeteorBottomUiBlur(false);
    }
}



function setMeteorBottomUiBlur(on) {
    try {
        document.body.classList.toggle('meteor-recording-active', !!on);
    } catch (e) {}
}

function setMeteorHint(text) {
    if (!meteorUi.hint || !meteorUi.hintText) return;
    meteorUi.hintText.textContent = text || '';
    meteorUi.hint.classList.toggle('visible', !!text);
}



function setMeteorModeBannerVisible(visible) {
    const el = meteorUi?.modeBanner || document.getElementById('meteor-mode-banner');
    if (!el) return;
    el.classList.toggle('visible', !!visible);
}

function setMeteorActionsVisible(visible) {
    const el = document.getElementById('meteor-actions');
    if (!el) return;
    el.style.display = visible ? 'flex' : 'none';
}

function beginMeteorSelection() {
    setMeteorBottomUiBlur(true);
    meteorUi.btn.classList.remove('off');
    meteorUi.btn.classList.add('on');
    meteorUi.btn.classList.add('recording');
    setMeteorModeBannerVisible(true);
    // 視点を固定する（その瞬間の向き）
    state.meteor.locked = true;
    state.meteor.lockedQuat.copy(camera.quaternion);
    state.meteor.lockedDate = new Date(state.date.getTime()); // スナップショット

    // 既存の天体選択ヘルパ等を邪魔しないように消しておく
    try { resetSelectionHelper(); } catch (e) {}

    state.meteor.mode = 'selectStart';
    state.meteor.startScreen = null;
    state.meteor.endScreen = null;
    state.meteor.startWorld = null;
    state.meteor.endWorld = null;
    state.meteor.startAltAz = null;
    state.meteor.endAltAz = null;

    clearMeteorPreviewLine();

    setMeteorHint('始点をタップしてください（1点目）');
    setMeteorActionsVisible(false);
}

function resetMeteorSelection(exitMode) {
    try { closeMeteorSaveModal(); } catch (e) {}
    state.meteor.startScreen = null;
    state.meteor.endScreen = null;
    state.meteor.startWorld = null;
    state.meteor.endWorld = null;
    state.meteor.startAltAz = null;
    state.meteor.endAltAz = null;

    clearMeteorPreviewLine();

    if (exitMode) {
        setMeteorBottomUiBlur(false);
        if (meteorUi && meteorUi.btn) {
            meteorUi.btn.classList.remove('recording');
            meteorUi.btn.classList.remove('on');
            meteorUi.btn.classList.add('off');
        }
        state.meteor.mode = 'idle';
        setMeteorModeBannerVisible(false);
        try { setMeteorButtonState('off'); } catch (e) {}
        state.meteor.locked = false;
        state.meteor.lockedDate = null;
        setMeteorHint('');
        setMeteorActionsVisible(false);
        // controlsの有効/無効は既存ロジックに戻す
        try { setControlsEnabledForCurrentMode(); } catch (e) {}
    } else {
        state.meteor.mode = 'selectStart';
        setMeteorHint('始点をタップしてください（1点目）');
        setMeteorActionsVisible(false);
    }
}


function toDatetimeLocalValue(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = dateObj.getFullYear();
    const m = pad(dateObj.getMonth() + 1);
    const d = pad(dateObj.getDate());
    const hh = pad(dateObj.getHours());
    const mm = pad(dateObj.getMinutes());
    return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatJa(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = dateObj.getFullYear();
    const m = pad(dateObj.getMonth() + 1);
    const d = pad(dateObj.getDate());
    const hh = pad(dateObj.getHours());
    const mm = pad(dateObj.getMinutes());
    return `${y}/${m}/${d} ${hh}:${mm}`;
}

function parseDatetimeLocalValue(val) {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d;
}

function openMeteorSaveModal() {
    if (state.meteor.mode !== 'review' || !state.meteor.startAltAz || !state.meteor.endAltAz) {
        alert('保存するために、始点と終点を指定してください。');
        return;
    }
    const baseDate = state.meteor.lockedDate ? new Date(state.meteor.lockedDate.getTime()) : new Date(state.date.getTime());

    if (meteorUi.saveModalInput) {
        meteorUi.saveModalInput.value = toDatetimeLocalValue(baseDate);
    }


    if (meteorUi.saveModalBrightness) {
        const b = Number(state.meteor.lockedBrightness);
        const v = (b >= 1 && b <= 5) ? b : 3;
        meteorUi.saveModalBrightness.value = String(v);
        if (typeof meteorUi.setBrightnessUi === 'function') meteorUi.setBrightnessUi(v);
    }
    meteorUi.saveModal.style.display = 'flex';
}

function closeMeteorSaveModal() {
    if (!meteorUi.saveModal) return;
    meteorUi.saveModal.style.display = 'none';
}

function confirmMeteorSave() {
    const chosen = parseDatetimeLocalValue(meteorUi.saveModalInput?.value);
    if (!chosen) {
        alert('日時の形式が正しくありません。');
        return;
    }

    const now = Date.now();
    const t = chosen.getTime();
    const diffMs = now - t;
    const withinPast12h = (diffMs >= 0 && diffMs <= 12 * 60 * 60 * 1000);
    if (!withinPast12h) {
        alert('保存できるのは「現在〜過去12時間以内」の時刻のみです。');
        return;
    }

    // 明るさ（1〜5）
    const bRaw = Number(meteorUi.saveModalBrightness?.value);
    const b = (Number.isFinite(bRaw) && bRaw >= 1 && bRaw <= 5) ? Math.round(bRaw) : 3;
    state.meteor.lockedBrightness = b;

    state.meteor.lockedDate = chosen;

    closeMeteorSaveModal();
    saveMeteorTrack(true);
}

async function saveMeteorTrack(skipCheck = false) {
    if (!skipCheck) {
    if (state.meteor.mode !== 'review' || !state.meteor.startAltAz || !state.meteor.endAltAz) {
        alert('保存するために、始点と終点を指定してください。');
        return;
    }
    }

    const rec = {
        createdAt: new Date().toISOString(),
        lat: state.lat,
        lon: state.lon,
        dateIso: state.meteor.lockedDate ? state.meteor.lockedDate.toISOString() : state.date.toISOString(),
        startAltAz: state.meteor.startAltAz,
        endAltAz: state.meteor.endAltAz,
        brightness: (Number.isFinite(state.meteor.lockedBrightness) ? state.meteor.lockedBrightness : 3),
    };

    try {
      const postRes = await postMeteorRecord(rec);
      // Keep local brightness mapping in case GET /records doesn't return brightness yet.
      try {
        const key = postRes?.recordedAt || postRes?.item?.recordedAt || null;
        if (key) meteorBrightnessOverrideByRecordedAt.set(key, rec.brightness);
      } catch (e) {}

    
    meteorSavedTracks.push(rec);

    alert('★保存完了★\n1分程度で画面に表示されます');

    // 次の記録へ
    resetMeteorSelection(true);

    } catch (e) {
      console.error(e);
      alert('保存に失敗しました（通信エラーの可能性があります）');
      return;
    }

}

function clearMeteorPreviewLine() {
    cancelMeteorPreviewAnimation();
    if (meteorPreviewLine && meteorTrackGroup) {
        meteorTrackGroup.remove(meteorPreviewLine);
        meteorPreviewLine.geometry?.dispose?.();
        if (Array.isArray(meteorPreviewLine.material)) {
            meteorPreviewLine.material.forEach(m => m?.dispose?.());
        } else {
            meteorPreviewLine.material?.dispose?.();
        }
    }
    meteorPreviewLine = null;

    if (meteorStartMarker && meteorTrackGroup) {
        meteorTrackGroup.remove(meteorStartMarker);
        meteorStartMarker.material?.map?.dispose?.();
        meteorStartMarker.material?.dispose?.();
    }
    meteorStartMarker = null;

    if (meteorEndGlow && meteorTrackGroup) {
        meteorTrackGroup.remove(meteorEndGlow);
        meteorEndGlow.material?.map?.dispose?.();
        meteorEndGlow.material?.dispose?.();
    }
    meteorEndGlow = null;
}

function cancelMeteorPreviewAnimation() {
    try {
        if (meteorPreviewAnimRaf != null) {
            cancelAnimationFrame(meteorPreviewAnimRaf);
        }
    } catch (e) {}
    meteorPreviewAnimRaf = null;
    meteorPreviewAnimToken++;
    try {
        if (meteorMarkHideTimeout != null) {
            clearTimeout(meteorMarkHideTimeout);
        }
    } catch (e) {}
    meteorMarkHideTimeout = null;
    setMeteorMarkVisible(false);

}

function animateMeteorPreviewLine(durationMs = 520) {
    if (!meteorPreviewLine || !meteorPreviewLine.material || !meteorPreviewLine.material.uniforms || !meteorPreviewLine.material.uniforms.uProgress) return;

    cancelMeteorPreviewAnimation();

    const token = meteorPreviewAnimToken;
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // Star head runs first, the line follows behind slightly.
    const headLead = 0.14; // 0..1 portion of time where the head leads before the line begins to appear

    // Start from 0 so it draws from the beginning
    meteorPreviewLine.material.uniforms.uProgress.value = 0.0;

    const mark = ensureMeteorMarkSprite();
    if (mark && state && state.meteor && state.meteor.startWorld && state.meteor.endWorld) {
        mark.visible = true;
        mark.scale.set(30, 30, 1);
        mark.material.opacity = 1.0;
    }

    const step = (now) => {
        if (token !== meteorPreviewAnimToken) return;
        const tNow = (typeof now === 'number') ? now : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
        const t = Math.max(0, Math.min(1, (tNow - start) / durationMs));

        // Move the star head
        if (mark && state && state.meteor && state.meteor.startWorld && state.meteor.endWorld) {
            const p = state.meteor.startWorld.clone().lerp(state.meteor.endWorld, t).normalize().multiplyScalar(CONFIG.radius);
            mark.position.copy(p);
        }

        // Line progress follows the head with a delay
        let lineT = 0;
        if (t <= headLead) {
            lineT = 0;
        } else {
            lineT = (t - headLead) / (1 - headLead);
        }
        lineT = Math.max(0, Math.min(1, lineT));
        meteorPreviewLine.material.uniforms.uProgress.value = lineT;

        if (t < 1.0) {
            meteorPreviewAnimRaf = requestAnimationFrame(step);
        } else {
            meteorPreviewAnimRaf = null;

            // Fade out the head mark quickly after it arrives
            if (mark && mark.material) {
                const fadeStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const fadeDur = 180;

                const fadeStep = () => {
                    if (token !== meteorPreviewAnimToken) return;
                    const n = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
                    const ft = Math.max(0, Math.min(1, (n - fadeStart) / fadeDur));
                    mark.material.opacity = 1.0 - ft;
                    if (ft < 1) {
                        requestAnimationFrame(fadeStep);
                    } else {
                        setMeteorMarkVisible(false);
                    }
                };
                requestAnimationFrame(fadeStep);
            } else {
                setMeteorMarkVisible(false);
            }
        }
    };

    meteorPreviewAnimRaf = requestAnimationFrame(step);
}

function createRadialTexture(innerAlpha, outerAlpha) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, `rgba(255,255,255,${innerAlpha})`);
    g.addColorStop(1, `rgba(255,255,255,${outerAlpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

function ensureMeteorStartMarker(p) {
    if (!meteorTrackGroup) return;

    if (!meteorStartMarker) {
        if (!meteorPinTextureLoader) meteorPinTextureLoader = new THREE.TextureLoader();
        const tex = meteorPinTextureLoader.load(METEOR_START_ICON_URL);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            color: 0xffffff,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            opacity: 1.0,
        });
        const spr = new THREE.Sprite(mat);

        // Anchor the sprite so the *tip* of the pin is at the selected point.
        // Sprite center: (0.5, 0.0) = bottom-center
        spr.center.set(0.5, 0.0);

        spr.renderOrder = 15010;
        meteorStartMarker = spr;
        meteorTrackGroup.add(meteorStartMarker);
    }
    meteorStartMarker.position.copy(p);
    meteorStartMarker.scale.set(34, 34, 1);
}

function ensureMeteorEndGlow(p) {
    if (!meteorTrackGroup) return;

    if (!meteorEndGlow) {
        if (!meteorPinTextureLoader) meteorPinTextureLoader = new THREE.TextureLoader();
        const tex = meteorPinTextureLoader.load(METEOR_END_ICON_URL);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            color: 0xffffff,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            opacity: 1.0,
        });
        const spr = new THREE.Sprite(mat);

        // Anchor so the tip is at the selected end point.
        spr.center.set(0.5, 0.0);

        spr.renderOrder = 15020;
        meteorEndGlow = spr;
        meteorTrackGroup.add(meteorEndGlow);
    }
    meteorEndGlow.position.copy(p);
    meteorEndGlow.scale.set(34, 34, 1);
}


function slerpOnSphere(p1, p2, t, radius) {
    const v1 = p1.clone().normalize();
    const v2 = p2.clone().normalize();
    const dot = Math.max(-1, Math.min(1, v1.dot(v2)));
    const omega = Math.acos(dot);

    if (omega < 1e-6) {
        return v1.multiplyScalar(radius);
    }
    const sinOmega = Math.sin(omega);
    const k1 = Math.sin((1 - t) * omega) / sinOmega;
    const k2 = Math.sin(t * omega) / sinOmega;

    const v = v1.multiplyScalar(k1).add(v2.multiplyScalar(k2)).normalize().multiplyScalar(radius);
    return v;
}


function ensureMeteorMarkSprite() {
    if (!meteorTrackGroup) return null;

    if (!meteorMarkSprite) {
        if (!meteorMarkTextureLoader) meteorMarkTextureLoader = new THREE.TextureLoader();
        const tex = meteorMarkTextureLoader.load(METEOR_MARK_ICON_URL);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            color: 0xffffff,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            opacity: 1.0,
        });
        const spr = new THREE.Sprite(mat);
        // Center the star mark on its position
        spr.center.set(0.5, 0.5);
        spr.renderOrder = 15020;
        spr.visible = false;
        meteorMarkSprite = spr;
        meteorTrackGroup.add(meteorMarkSprite);
    }

    return meteorMarkSprite;
}

function setMeteorMarkVisible(v) {
    if (!meteorMarkSprite) return;
    meteorMarkSprite.visible = !!v;
    if (!v && meteorMarkSprite.material) {
        meteorMarkSprite.material.opacity = 1.0;
    }
}

function buildMeteorTrailGeometry(p1, p2) {
    const r = CONFIG.radius;
    const segments = 64;

    const positions = new Float32Array((segments + 1) * 3);
    const alphas = new Float32Array(segments + 1);

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const p = slerpOnSphere(p1, p2, t, r);
        positions[i*3 + 0] = p.x;
        positions[i*3 + 1] = p.y;
        positions[i*3 + 2] = p.z;

        // 始点は薄く、終点に向けて濃く
        const a = 0.10 + 0.90 * t;
        alphas[i] = a;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    return geom;
}

function createMeteorTrailMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
            uColor: { value: new THREE.Color(0xffffff) },
        },
        vertexShader: `
            attribute float aAlpha;
            varying float vAlpha;
            void main() {
                vAlpha = aAlpha;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            varying float vAlpha;
            void main() {
                gl_FragColor = vec4(uColor, vAlpha);
            }
        `,
    });
}

function ensureMeteorPreviewLine(p1, p2) {
    if (!meteorTrackGroup) return;

    // 球面上の大円弧っぽい軌跡を点列で作る
    const radius = CONFIG.radius;
    const segments = 64;
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        pts.push(slerpOnSphere(p1, p2, t, radius));
    }

    // 太さのある軌跡：TubeGeometry
    const curve = new THREE.CatmullRomCurve3(pts);
    // Preview thickness reflects selected brightness (default 3)
    const previewRadius = meteorTubeRadiusFromBrightness(state?.meteor?.lockedBrightness, 1.6);
    const tubeGeom = new THREE.TubeGeometry(curve, segments, previewRadius, 10, false);

    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            uColorStart: { value: new THREE.Color(0xffd84a) }, // 始点：黄
            uColorEnd:   { value: new THREE.Color(0x7ad7ff) }, // 終点：シアン

            // --- taper (spear-like tip) ---
            uTubeRadius: { value: previewRadius },
            uTipStart:   { value: 0.78 },
            uTipPower:   { value: 1.6 },

            // drawing animation progress (0..1)
            uProgress:  { value: 1.0 },
        },
        vertexShader: `
            uniform float uTubeRadius;
            uniform float uTipStart;
            uniform float uTipPower;

            varying vec2 vUv;
            void main() {
                vUv = uv;

                // uv.x: 始点→終点
                float t = clamp(uv.x, 0.0, 1.0);

                // 終端だけ半径を 0 に向けて縮める
                float tip = smoothstep(uTipStart, 1.0, t);     // 0..1
                float s = 1.0 - pow(tip, uTipPower);           // 1..0

                // TubeGeometry の法線方向に押し戻して半径を縮める
                vec3 p = position - normal * uTubeRadius * (1.0 - s);

                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColorStart;
            uniform vec3 uColorEnd;
            uniform float uProgress;
            varying vec2 vUv;

            void main() {
                // TubeGeometry の uv.x は「始点→終点」
                float t = clamp(vUv.x, 0.0, 1.0);

                // --- draw animation: show only 0..uProgress ---
                float prog = clamp(uProgress, 0.0, 1.0);
                // soften the leading edge a bit
                float edge = 0.02;
                float vis = 1.0 - smoothstep(prog - edge, prog, t);
                if (vis <= 0.0) discard;

                // 先端（終点）ほど濃く＆明るく
                float alpha = pow(t, 1.6) * 0.95;

                // 中心が明るく見えるように、周方向(vUv.y)でわずかに落とす
                float ring = 1.0 - abs(vUv.y - 0.5) * 1.2;
                ring = clamp(ring, 0.0, 1.0);
                alpha *= (0.65 + 0.35 * ring);

                alpha *= vis;

                vec3 col = mix(uColorStart, uColorEnd, t);

                gl_FragColor = vec4(col, alpha);
            }
        `,
    });

    if (!meteorPreviewLine) {
        meteorPreviewLine = new THREE.Mesh(tubeGeom, mat);
        meteorPreviewLine.frustumCulled = false;
        meteorPreviewLine.renderOrder = 15000; // 星より前、地面(20000)より後
        meteorTrackGroup.add(meteorPreviewLine);
    } else {
        // 既存を差し替え
        meteorPreviewLine.geometry?.dispose?.();
        meteorPreviewLine.geometry = tubeGeom;

        // materialは使い回す（色調整するならここで）
        if (meteorPreviewLine.material && meteorPreviewLine.material.uniforms) {
            meteorPreviewLine.material.uniforms.uColorStart.value.set(0xffd84a);
            meteorPreviewLine.material.uniforms.uColorEnd.value.set(0x7ad7ff);
            if (meteorPreviewLine.material.uniforms.uTubeRadius) meteorPreviewLine.material.uniforms.uTubeRadius.value = previewRadius;
            if (meteorPreviewLine.material.uniforms.uProgress && typeof meteorPreviewLine.material.uniforms.uProgress.value !== 'number') {
                meteorPreviewLine.material.uniforms.uProgress.value = 1.0;
            }
        } else {
            meteorPreviewLine.material?.dispose?.();
            meteorPreviewLine.material = mat;
        }
    }
}


function screenToSkyPoint(clientX, clientY) {
    // 画面座標 -> NDC
    const ndc = new THREE.Vector2(
        (clientX / window.innerWidth) * 2 - 1,
        -(clientY / window.innerHeight) * 2 + 1
    );

    // Raycasterのrayを使って「天球(半径r)」との交点を取る
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);

    const r = CONFIG.radius;
    const origin = raycaster.ray.origin.clone();
    const dir = raycaster.ray.direction.clone().normalize();

    // 解：|origin + t*dir| = r
    // t^2 + 2*(o·d)t + (o·o - r^2) = 0
    const od = origin.dot(dir);
    const oo = origin.dot(origin);
    const disc = od * od - (oo - r * r);
    if (disc < 0) return null;

    // 天球は外側にあるので大きい方のtを優先
    const sqrtDisc = Math.sqrt(disc);
    const t1 = -od - sqrtDisc;
    const t2 = -od + sqrtDisc;
    const t = (t2 > 0) ? t2 : (t1 > 0 ? t1 : null);
    if (t == null) return null;

    const p = origin.add(dir.multiplyScalar(t));
    return p;
}

function worldToAltAzDeg(pWorld) {
    const r = CONFIG.radius;
    const y = pWorld.y;
    const altRad = Math.asin(Math.max(-1, Math.min(1, y / r)));

    // x = r cosAlt sinAz, z = -r cosAlt cosAz より az = atan2(x, -z)
    const azRad = Math.atan2(pWorld.x, -pWorld.z);

    let az = azRad * 180 / Math.PI;
    if (az < 0) az += 360;
    const alt = altRad * 180 / Math.PI;

    return { altDeg: alt, azDeg: az };
}

function handleMeteorPointerUp(event) {
    const m = state.meteor;
    if (!m || m.mode === 'idle') return false;

    // UI上のタップは無視（既存と同様の意図）
    if (event.target.closest('.ui-layer') ||
        event.target.closest('#mobile-controls') ||
        event.target.closest('#star-reticle') ||
        event.target.closest('.menu-container')) {
        return true;
    }

    // 選択モード中のみ処理
    if (m.mode !== 'selectStart' && m.mode !== 'selectEnd') return true;

    const p = screenToSkyPoint(event.clientX, event.clientY);
    if (!p) {
        alert('天球上の点を取得できませんでした。もう一度タップしてください。');
        return true;
    }

    if (m.mode === 'selectStart') {
        m.startScreen = { x: event.clientX, y: event.clientY };
        m.startWorld = p;
        m.startAltAz = worldToAltAzDeg(p);

        // 1点目にマークを表示
        ensureMeteorStartMarker(p);

        m.mode = 'selectEnd';
        setMeteorHint('終点をタップしてください（2点目）');

        // ひとまず始点だけでも短い線を表示（見やすさのため）
        const p2 = p.clone().multiplyScalar(0.999); // 少しだけ差をつける
        ensureMeteorPreviewLine(p, p2);
        return true;
    }

    // selectEnd
    m.endScreen = { x: event.clientX, y: event.clientY };
    m.endWorld = p;
    m.endAltAz = worldToAltAzDeg(p);
    ensureMeteorEndGlow(p);

    ensureMeteorPreviewLine(m.startWorld, m.endWorld);
    // 終点の光（流星の先端）
    ensureMeteorEndGlow(m.endWorld);

    // Animate drawing from start -> end
    animateMeteorPreviewLine(520);

    m.mode = 'review';
    setMeteorHint('流星の軌道がOKなら「保存」へ');
    setMeteorActionsVisible(true);

    return true;
}
