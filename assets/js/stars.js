// stars.js

// --- 設定定数 ---
const CONFIG = {
    radius: 500, 
    bgColor: 0x050a14, 
    
    // --- 画角設定 ---
    cameraFov: 50,  // 初期値
    minFov: 10,     // ズームイン最大（望遠）
    maxFov: 75,     // ズームアウト最大（広角）
    
    categories: {
        SolarSystem: { label: '太陽系', color: '#ffd700', type: 'solar_body' }, 
        star: { label: '恒星', color: '#ffffff', type: 'point' }, 
        
        // 星座線と星座名
        ConstellationLines: { label: '星座線', color: '#a0d9ff', type: 'line' },
        ConstellationLabels: { label: '星座名', color: '#a0d9ff', type: 'label_only' },

        MultipleStar: { label: '重星', color: '#dcd0ff', type: 'double_circle' },
        Galaxy: { label: '銀河', color: '#ffffdd', type: 'ellipse' },
        GlobularCluster: { label: '球状星団', color: '#ffcc66', type: 'circle_plus' },
        OpenCluster: { label: '散開星団', color: '#aaccff', type: 'circle_dotted' },
        EmissionNebula: { label: '散光星雲', color: '#ff9999', type: 'square' },
        ReflectionNebula: { label: '反射星雲', color: '#99ccff', type: 'square_stroke' },
        PlanetaryNebula: { label: '惑星状星雲', color: '#88ffcc', type: 'circle_cross' },
        SupernovaRemnant: { label: '超新星残骸', color: '#cc99ff', type: 'diamond' }
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

// --- 空の色設定 (高度に応じたベースカラー: 青～紺のみ) ---
const SKY_GRADIENT = [
    { alt: -18, color: new THREE.Color('#050a14') }, // 完全な夜
    { alt: -6,  color: new THREE.Color('#0a1320') }, // 薄明
    { alt: 0,   color: new THREE.Color('#0f2035') }, // 日の出・日の入りベース
    { alt: 6,   color: new THREE.Color('#142840') }, // 昼間への移行
    { alt: 90,  color: new THREE.Color('#0a1a2a') }  // 昼間
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
let raycaster, mouse;
let layers = {}; 
let allCelestialObjects = []; 

const state = {
    lat: 35.6895, 
    lon: 139.6917,
    date: new Date(),
    gridVisible: true,
    sunlightVisible: true, // 太陽光の影響ON/OFF
    magLimit: 4.5,
    shuttleValue: 0,
    selectedStarIndex: -1,
    selectedObject: null, 
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    
    // 選択サイクル用
    clickCandidates: [],
    clickCandidateIndex: 0,
    lastClickTime: 0
};

function init() {
    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.bgColor);
    scene.fog = new THREE.FogExp2(CONFIG.bgColor, 0.0008); 

    camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, window.innerWidth / window.innerHeight, 1, 20000);
    const initialAlt = 15 * (Math.PI / 180);
    const dist = 1.0;
    camera.position.set(0, -Math.sin(initialAlt) * dist, -Math.cos(initialAlt) * dist);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false; // OrbitControls標準ズームは無効化
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = -0.5;
    controls.target.set(0, 0, 0);
    controls.update();

    controls.addEventListener('start', () => { state.isDragging = true; });
    controls.addEventListener('end', () => { state.isDragging = false; });

    createSkyDome();
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
        state.dragStartX = e.clientX;
        state.dragStartY = e.clientY;
    });
    window.addEventListener('click', onClick);

    // ズーム（ホイール）イベント
    container.addEventListener('wheel', onMouseWheel, { passive: false });

    animate();
}

function onMouseWheel(event) {
    event.preventDefault();
    const speed = 0.05;
    camera.fov += event.deltaY * speed;
    camera.fov = Math.max(CONFIG.minFov, Math.min(CONFIG.maxFov, camera.fov));
    camera.updateProjectionMatrix();
}

function setupUI() {
    const dateInput = document.getElementById('date-picker');
    const settingsDock = document.getElementById('settings-dock');
    const infoDock = document.getElementById('info-dock');
    const btnSettingsToggle = document.getElementById('btn-settings-toggle');
    const btnInfoToggle = document.getElementById('btn-info-toggle');
    const toggleSettingsStrip = document.getElementById('toggle-settings-strip');
    const toggleInfoStrip = document.getElementById('toggle-info-strip');
    const screenClock = document.getElementById('screen-clock'); 
    
    const magSlider = document.getElementById('mag-slider');
    const timeShuttle = document.getElementById('time-shuttle');
    const btnMore = document.getElementById('btn-more');
    const inputLat = document.getElementById('input-lat');
    const inputLon = document.getElementById('input-lon');
    const sliderLat = document.getElementById('slider-lat');
    const sliderLon = document.getElementById('slider-lon');
    const filterContainer = document.getElementById('filter-container');

    toggleSettingsStrip.addEventListener('click', () => {
        settingsDock.classList.toggle('open');
        const isOpen = settingsDock.classList.contains('open');
        btnSettingsToggle.textContent = isOpen ? '≫' : '≪';
    });

    toggleInfoStrip.addEventListener('click', () => {
        infoDock.classList.toggle('open');
        const isOpen = infoDock.classList.contains('open');
        if (isOpen) {
            btnInfoToggle.classList.remove('closed');
            btnInfoToggle.classList.add('opened');
        } else {
            btnInfoToggle.classList.remove('opened');
            btnInfoToggle.classList.add('closed');
        }
    });

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
        screenClock.textContent = `${year}/${month}/${day} ${hour}:${min}`;
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
    
    const addTime = (hours) => { 
        state.date.setTime(state.date.getTime() + hours * 60 * 60 * 1000); 
        updateDateInput(); 
        onTimeChange();
    };
    document.getElementById('btn-prev-h').addEventListener('click', () => addTime(-1));
    document.getElementById('btn-next-h').addEventListener('click', () => addTime(1));
    document.getElementById('btn-prev-d').addEventListener('click', () => addTime(-24));
    document.getElementById('btn-next-d').addEventListener('click', () => addTime(24));

    timeShuttle.addEventListener('input', (e) => { state.shuttleValue = parseInt(e.target.value); });
    const resetShuttle = () => { 
        state.shuttleValue = 0; 
        timeShuttle.value = 0; 
        updateDateInput(); 
        updateSolarSystemData(); 
    };
    timeShuttle.addEventListener('mouseup', resetShuttle); 
    timeShuttle.addEventListener('touchend', resetShuttle);

    document.getElementById('btn-tonight').addEventListener('click', () => {
        const d = new Date(); d.setHours(21, 0, 0, 0); state.date = d; 
        resetShuttle(); 
        onTimeChange();
        state.selectedObject = null;
        document.getElementById('star-reticle').classList.remove('visible');
    });
    document.getElementById('btn-now').addEventListener('click', () => {
        state.date = new Date(); 
        resetShuttle(); 
        onTimeChange();
        state.selectedObject = null;
        document.getElementById('star-reticle').classList.remove('visible');
    });

    magSlider.addEventListener('input', (e) => {
        state.magLimit = parseFloat(e.target.value);
        document.getElementById('mag-label').textContent = `${state.magLimit.toFixed(1)}等まで`;
        if (layers['star']) {
            layers['star'].mesh.children[0].material.uniforms.magLimit.value = state.magLimit;
        }
        updatePositions();
    });

    // --- ボタン: 座標線 ---
    const btnGrid = document.getElementById('btn-grid');
    btnGrid.addEventListener('click', (e) => {
        state.gridVisible = !state.gridVisible; 
        if (gridHelper) gridHelper.visible = state.gridVisible; 
        e.target.classList.toggle('active');
    });

    // --- ボタン: 太陽光の影響 ---
    const btnSunlight = document.createElement('button');
    btnSunlight.textContent = '☀ 太陽光の影響';
    btnSunlight.className = 'btn-gold active'; 
    btnSunlight.style.width = '100%';
    btnSunlight.style.marginBottom = '5px';
    btnGrid.parentNode.insertBefore(btnSunlight, btnGrid);

    btnSunlight.addEventListener('click', () => {
        state.sunlightVisible = !state.sunlightVisible;
        btnSunlight.classList.toggle('active');
        // シェーダーと背景色更新のために再描画
        updateSolarSystemData();
    });

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
        updatePositions();
        updateSolarSystemData(); 
    };

    inputLat.addEventListener('change', () => updateLocation(parseFloat(inputLat.value), parseFloat(inputLon.value)));
    inputLon.addEventListener('change', () => updateLocation(parseFloat(inputLat.value), parseFloat(inputLon.value)));
    sliderLat.addEventListener('input', () => updateLocation(parseFloat(sliderLat.value), parseFloat(sliderLon.value)));
    sliderLon.addEventListener('input', () => updateLocation(parseFloat(sliderLat.value), parseFloat(sliderLon.value)));

    document.getElementById('btn-location').addEventListener('click', () => {
        if (!navigator.geolocation) return alert("Geolocation not supported");
        const btn = document.getElementById('btn-location');
        const txt = btn.textContent;
        btn.textContent = "取得中...";
        navigator.geolocation.getCurrentPosition(pos => {
            updateLocation(pos.coords.latitude, pos.coords.longitude);
            btn.textContent = txt;
        }, () => { alert("位置情報を取得できませんでした。"); btn.textContent = txt; });
    });

    btnMore.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.selectedObject) {
            showSidePanel(state.selectedObject);
            const infoDock = document.getElementById('info-dock');
            infoDock.classList.add('open');
            const btnInfo = document.getElementById('btn-info-toggle');
            btnInfo.classList.remove('closed');
            btnInfo.classList.add('opened');
        }
    });

    // --- フィルターボタン生成 ---
    Object.keys(CONFIG.categories).forEach(key => {
        if (key === 'star' || key === 'SolarSystem') return;

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

        const setButtonStyle = (isActive) => {
            if (isActive) {
                btn.style.background = hexToRgba(cat.color, 0.3);
                btn.style.border = `1px solid ${cat.color}`;
                btn.style.color = cat.color;
                btn.style.boxShadow = `0 0 8px ${cat.color}, inset 0 0 5px ${hexToRgba(cat.color, 0.2)}`;
                btn.style.textShadow = `0 0 3px ${cat.color}`;
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

        btn.classList.add('active');
        setButtonStyle(true);

        btn.addEventListener('click', () => {
            const isActive = btn.classList.toggle('active');
            if (layers[key]) {
                layers[key].visible = isActive;
                layers[key].mesh.visible = isActive;
            }
            setButtonStyle(isActive);
        });
        
        filterContainer.appendChild(btn);
    });
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
        let sunAz, sunAlt;

        const sunEqu = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
        const sunHor = Astronomy.Horizon(date, observer, sunEqu.ra, sunEqu.dec, Astronomy.Refraction.Normal);
        sunAz = sunHor.azimuth;
        sunAlt = sunHor.altitude;

        updateSky(sunAlt, sunAz);

        bodies.forEach(body => {
            const equ = Astronomy.Equator(body.id, date, observer, true, true);
            const hor = Astronomy.Horizon(date, observer, equ.ra, equ.dec, Astronomy.Refraction.Normal);
            
            const illum = Astronomy.Illumination(body.id, date);

            results.push({
                name: body.name,
                alt: hor.altitude,
                az: hor.azimuth,
                distance_au: equ.dist,
                mag: illum.mag,           
                phase_frac: illum.phase_fraction, 
                type: 'SolarSystem',
                sunAz: sunAz,   
                sunAlt: sunAlt
            });
        });

        const group = layers['SolarSystem'].mesh;
        while(group.children.length > 0){ 
            group.remove(group.children[0]); 
        }
        
        layers['SolarSystem'].data = results;
        createSolarSystemSprites(results, group);

    } catch (e) {
        console.warn("Solar System Calculation Error:", e);
    }
}

function createSolarSystemSprites(data, parentGroup) {
    const r = CONFIG.radius;

    data.forEach(obj => {
        if(obj.alt < -5) return;

        let texture;
        let scale;
        let rotation = 0;

        if (obj.name === '月') {
            texture = createMoonPhaseTexture(obj.phase_frac);
            scale = 45 
            const azDiff = (obj.sunAz - obj.az) * (Math.PI/180);
            const altDiff = (obj.sunAlt - obj.alt) * (Math.PI/180);
            const dx = azDiff * Math.cos(obj.alt * (Math.PI/180));
            const dy = altDiff;
            rotation = Math.atan2(dy, dx); 
        } else if (obj.name === '太陽') {
            texture = createPlanetTexture('#ffaa00', false, true); 
            scale = 250; 
        } else {
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
        }

        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            depthTest: false,
            rotation: rotation,
            fog: false 
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(scale, scale, 1);

        const altRad = obj.alt * (Math.PI / 180);
        const azRad = obj.az * (Math.PI / 180);
        const x = r * Math.cos(altRad) * Math.sin(azRad);
        const y = r * Math.sin(altRad);
        const z = -r * Math.cos(altRad) * Math.cos(azRad);
        
        sprite.position.set(x, y, z);

        const labelMap = createLabelTexture(obj.name, obj.name==='太陽'?'#ffaa00':'#ffffff', 32);
        const labelMat = new THREE.SpriteMaterial({ 
            map: labelMap, 
            depthTest: false, 
            transparent: true,
            fog: false
        });
        const labelSprite = new THREE.Sprite(labelMat);
        const aspect = labelMap.image.width / labelMap.image.height;
        
        // --- 修正箇所: ラベルサイズを少し小さく ---
        const baseH = 12; // 15 -> 12
        const baseW = baseH * aspect;
        labelSprite.scale.set(baseW, baseH, 1);
        
        if (obj.name === '太陽') {
            labelSprite.position.set(40, 0, 0); 
        } else {
            labelSprite.position.set(scale/2 + 5, -scale/2, 0);
        }
        
        const wrapper = new THREE.Group();
        wrapper.add(sprite);
        wrapper.add(labelSprite);
        wrapper.position.set(x, y, z);
        
        wrapper.userData = {
            name: obj.name,
            alt: obj.alt,
            az: obj.az,
            dist: obj.distance_au,
            mag: obj.mag,
            objType: 'SolarSystem',
            typeLabel: '太陽系天体',
            meshReference: wrapper,
            hasLabel: true
        };
        labelSprite.userData.baseScale = { x: baseW, y: baseH };
        labelSprite.userData.isLabel = true;
        
        wrapper.userData.meshReference = wrapper;

        parentGroup.add(wrapper);
    });
}

function createPlanetTexture(colorStr, hasSpikes, isSun = false) {
    const canvas = document.createElement('canvas');
    const size = 150; 
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;

    ctx.clearRect(0, 0, size, size);

    if (!isSun) {
        const grd = ctx.createRadialGradient(center, center, size/20, center, center, size/2);
        grd.addColorStop(0, colorStr); 
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(center, center, size/2, 0, Math.PI*2);
        ctx.fill();
    }

    if (hasSpikes) {
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = 1.5; 
        ctx.globalAlpha = 1.5;
        ctx.beginPath();
        ctx.moveTo(center, 15);
        ctx.lineTo(center, size - 15);
        ctx.moveTo(15, center);
        ctx.lineTo(size - 15, center);
        ctx.stroke();
    }

    ctx.globalAlpha = 1.0; 
    ctx.fillStyle = '#ffffff'; 
    ctx.beginPath();
    ctx.arc(center, center, size/16, 0, Math.PI*2); 
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

function createMoonPhaseTexture(fraction) {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const radius = size * 0.4;

    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff'; 
    ctx.shadowBlur = 15; 
    ctx.shadowColor = '#ffffaa'; 
    ctx.beginPath();
    ctx.arc(center, center, radius, -Math.PI / 2, Math.PI / 2, false);

    const ellipseWidth = Math.abs((2 * fraction - 1) * radius);
    const isCrescent = fraction < 0.5;
    try {
        ctx.ellipse(center, center, ellipseWidth, radius, 0, Math.PI/2, -Math.PI/2, isCrescent);
    } catch(e) {
        ctx.lineTo(center, center - radius);
    }
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
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
        case 'solar_body': 
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.fill(); break;
        case 'ellipse':
            ctx.beginPath(); ctx.ellipse(center, center, radius, radius * 0.6, Math.PI / 4, 0, Math.PI * 2); ctx.stroke(); break;
        case 'circle_plus':
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(center - radius, center); ctx.lineTo(center + radius, center);
            ctx.moveTo(center, center - radius); ctx.lineTo(center, center + radius); ctx.stroke(); break;
        case 'circle_dotted':
            ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); break;
        case 'square':
            ctx.globalAlpha = 0.3; ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);
            ctx.globalAlpha = 1.0; ctx.strokeRect(center - radius, center - radius, radius * 2, radius * 2); break;
        case 'square_stroke':
            ctx.strokeRect(center - radius, center - radius, radius * 2, radius * 2); break;
        case 'circle_cross':
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(center - radius - 5, center); ctx.lineTo(center + radius + 5, center); ctx.stroke(); break;
        case 'diamond':
            ctx.beginPath(); ctx.moveTo(center, center - radius); ctx.lineTo(center + radius, center); ctx.lineTo(center, center + radius); ctx.lineTo(center - radius, center); ctx.closePath(); ctx.stroke(); break;
        case 'double_circle':
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(center, center, 2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.moveTo(center - radius - 5, center); ctx.lineTo(center + radius + 5, center); ctx.stroke(); break;
        default:
            ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
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
        // ---------------------------------------------------------------------------
        // 修正箇所: カタログファイルのパスを 'catalogs/' から 'assets/catalogs/' に変更
        // ---------------------------------------------------------------------------
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
        createStarLabels(dataList, layers[type].mesh);
    } else if (type === 'SolarSystem') {
        // 初期状態は空
    } else { 
        createDSOSprites(type, dataList, config, layers[type].mesh); 
    }
    scene.add(layers[type].mesh);
}

function createConstellationLines(data, config, parentGroup) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(data.length * 6); 
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: config.color, transparent: true, opacity: 0.4, depthTest: false });
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
        
        // --- 修正箇所: ラベルサイズを少し小さく ---
        const baseH = 12; 
        const baseW = baseH * aspect;
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

    data.forEach((obj, i) => {
        const spectFirst = obj.spect_type ? obj.spect_type.charAt(0).toUpperCase() : 'A';
        const color = CONFIG.starColors[spectFirst] || CONFIG.starColors.default;
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
        let mag = parseFloat(obj.vmag || obj.mag || 6.0); if (isNaN(mag)) mag = 6.0;
        sizes[i] = Math.max(0.5, (8.0 - mag) * 1.5);
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
            uTime: { value: 0.0 },
            // --- 修正箇所: FOV情報を受け取る ---
            uFov: { value: CONFIG.cameraFov } 
        },
        vertexShader: `
            attribute float size; attribute vec3 color; attribute float aMagnitude;
            varying vec3 vColor; varying float vMag;
            uniform float magLimit; uniform float uTime;
            uniform float uFov; // FOV Uniform
            float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
            void main() {
                vMag = aMagnitude; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float seed = random(position.xy); float speed = 2.0 + seed * 3.0; 
                float twinkle = 1.0 + 0.3 * sin(uTime * speed + seed * 100.0);
                float altitudeFactor = 1.0 - smoothstep(0.0, 500.0, abs(position.y));
                twinkle += altitudeFactor * 0.2 * sin(uTime * speed * 2.0);
                vColor = color * twinkle;
                float exposureScale = 0.5 + max(0.0, magLimit) * 0.4; 
                
                // --- 修正箇所: ズームイン(FOV小)のとき星を大きくする ---
                // 基準FOV=50.0 とし、現在のuFovとの比率で補正
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
                float d = distance(gl_PointCoord, vec2(0.5)); if (d > 0.5) discard;
                float intensity = pow(1.0 - d * 2.0, 3.0) * 1.5;
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
        
        // --- 修正箇所: ラベルサイズを少し小さく ---
        const baseH = 8; // 11 -> 8
        const baseW = baseH * aspect;
        labelSprite.scale.set(baseW, baseH, 1);
        
        const wrapper = new THREE.Group();
        wrapper.add(labelSprite);
        labelSprite.position.set((baseW) / 2 + 2, 2, 0);
        
        labelSprite.userData.baseScale = { x: baseW, y: baseH };
        labelSprite.userData.isLabel = true;

        wrapper.userData = { 
            ra: obj.ra_deg !== undefined ? obj.ra_deg : (obj.ra !== undefined ? obj.ra : 0),
            dec: obj.dec_deg !== undefined ? obj.dec_deg : (obj.dec !== undefined ? obj.dec : 0),
            mag: parseFloat(obj.vmag || obj.mag || 6.0),
            isLabel: true,
            meshReference: wrapper 
        };
        parentGroup.add(wrapper);
    });
}

function createDSOSprites(type, data, config, parentGroup) {
    const symbolMap = createSymbolTexture(config.type, config.color);
    const materialBase = new THREE.SpriteMaterial({ map: symbolMap, color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
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
            
            // --- 修正箇所: ラベルサイズを少し小さく ---
            const baseH = 10; // 14 -> 10
            const baseW = baseH * aspect;
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
            meshReference: wrapper,
            hasLabel: true
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
                child.visible = (d.mag <= state.magLimit);
            }
        });
    });
    
    if(state.shuttleValue !== 0) {
        updateSolarSystemData();
    }
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

// --- スカイドームとシェーダー (修正版: ON/OFF対応) ---
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
        uniform vec3 baseColor;
        uniform vec3 sunDirection;
        uniform float sunAlt;
        uniform float uSunlightEnabled; // 1.0 or 0.0

        varying vec3 vWorldPosition;

        float inverseLerp(float a, float b, float v) {
            return clamp((v - a) / (b - a), 0.0, 1.0);
        }

        void main() {
            vec3 viewDir = normalize(vWorldPosition);
            vec3 sunDir = normalize(sunDirection);
            
            vec3 color = baseColor;
            
            float dotP = dot(viewDir, sunDir);
            
            if (dotP > 0.0) {
                float glowSize = 14.0;
                float glowIntensity = pow(dotP, glowSize);
                
                vec3 sunsetColor = vec3(1.0, 0.35, 0.05); // 濃いオレンジ
                vec3 dayColor = vec3(0.8, 0.9, 1.0);     // 青白い白
                
                float tSunsetRise = smoothstep(-20.0, -5.0, sunAlt);
                float tSunsetFall = 1.0 - smoothstep(5.0, 25.0, sunAlt);
                float sunsetStrength = tSunsetRise * tSunsetFall;
                
                float dayStrength = smoothstep(0.0, 25.0, sunAlt);
                
                float totalPower = smoothstep(-20.0, -5.0, sunAlt);

                vec3 glowColor = mix(sunsetColor, dayColor, dayStrength);
                float brightness = mix(0.8, 0.4, dayStrength);

                // uSunlightEnabled を掛けてON/OFF制御
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
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        side: THREE.BackSide,
        depthWrite: false
    });

    skyMesh = new THREE.Mesh(geometry, material);
    skyMesh.renderOrder = -100; 
    scene.add(skyMesh);
}

function updateSky(sunAlt, sunAz) {
    if (!skyMesh) return;

    let targetColor;

    // 太陽光の影響がONのときだけ、高度に応じた色計算を行う
    if (state.sunlightVisible) {
        if (sunAlt <= SKY_GRADIENT[0].alt) {
            targetColor = SKY_GRADIENT[0].color;
        } else if (sunAlt >= SKY_GRADIENT[SKY_GRADIENT.length - 1].alt) {
            targetColor = SKY_GRADIENT[SKY_GRADIENT.length - 1].color;
        } else {
            for (let i = 0; i < SKY_GRADIENT.length - 1; i++) {
                const lower = SKY_GRADIENT[i];
                const upper = SKY_GRADIENT[i + 1];
                if (sunAlt >= lower.alt && sunAlt < upper.alt) {
                    const t = (sunAlt - lower.alt) / (upper.alt - lower.alt);
                    targetColor = lower.color.clone().lerp(upper.color, t);
                    break;
                }
            }
        }
    } else {
        // OFFのときは固定の夜空色
        targetColor = new THREE.Color(0x050a14);
    }

    if (targetColor) {
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
    skyMesh.material.uniforms.uSunlightEnabled.value = state.sunlightVisible ? 1.0 : 0.0;
}

function createGround() {
    const geometry = new THREE.SphereGeometry(CONFIG.radius - 10, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x020408, side: THREE.BackSide, transparent: true, opacity: 0.95 });
    groundMesh = new THREE.Mesh(geometry, material);
    scene.add(groundMesh);
    const lineGeo = new THREE.RingGeometry(CONFIG.radius - 12, CONFIG.radius - 10, 64);
    const lineMat = new THREE.MeshBasicMaterial({ color: CONFIG.starColors.default, opacity: 0.2, transparent: true, side: THREE.DoubleSide });
    const horizonLine = new THREE.Mesh(lineGeo, lineMat);
    horizonLine.rotation.x = Math.PI / 2;
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
    const material = new THREE.LineBasicMaterial({ color: 0x445566, transparent: true, opacity: 0.3 });
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

function onClick(event) {
    if (event.target.closest('.ui-layer') && !event.target.classList.contains('ui-layer')) return;
    if (event.target.closest('div[style*="position: absolute"]')) return; 

    const diffX = Math.abs(event.clientX - state.dragStartX);
    const diffY = Math.abs(event.clientY - state.dragStartY);
    if (diffX > 5 || diffY > 5) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

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

            if (hit.object.isPoints) {
                const data = layers['star'].data[hit.index];
                if (data) {
                    candidateObj = { 
                        ...data, 
                        index: hit.index, 
                        isStarPoint: true 
                    };
                }
            } else if (hit.object.isSprite) {
                const userData = hit.object.parent.userData;
                if(!userData.name && userData.originalData) {
                    candidateObj = { ...userData.originalData, meshReference: userData.meshReference };
                } else {
                    candidateObj = userData;
                }
            }
            
            let mag = 6.0;
            if (candidateObj.mag !== undefined) mag = parseFloat(candidateObj.mag);
            else if (candidateObj.vmag !== undefined) mag = parseFloat(candidateObj.vmag);
            
            if (mag <= state.magLimit) {
                candidates.push(candidateObj);
            }
        });

        if (candidates.length > 0) {
            candidates.sort((a, b) => {
                const magA = (a.mag !== undefined ? a.mag : (a.vmag || 6));
                const magB = (b.mag !== undefined ? b.mag : (b.vmag || 6));
                return magA - magB;
            });

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
            
            const reticle = document.getElementById('star-reticle');
            document.getElementById('reticle-name').textContent = getObjectName(targetObj);
            reticle.classList.add('visible');
            
            showSidePanel(targetObj);
            
            updateReticle(); 
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
    
    const infoDock = document.getElementById('info-dock');
    if (infoDock.classList.contains('open')) {
        infoDock.classList.remove('open');
        const btnInfo = document.getElementById('btn-info-toggle');
        btnInfo.classList.remove('opened');
        btnInfo.classList.add('closed');
    }
}

function showSidePanel(obj) {
    let magText = "-";
    if (obj.vmag !== undefined) magText = parseFloat(obj.vmag).toFixed(2);
    else if (obj.mag !== undefined) magText = parseFloat(obj.mag).toFixed(2);
    
    let distText = "-";
    let distUnit = "";
    if (obj.distance_au !== undefined) { 
        distText = parseFloat(obj.distance_au).toFixed(3);
        distUnit = " AU";
    } else if (obj.distance_pc) { 
        distText = (obj.distance_pc * 3.26156).toFixed(1);
        distUnit = " 光年";
    }

    let altAzText = "-";
    if (obj.alt !== undefined && obj.az !== undefined) {
        altAzText = `H:${obj.alt.toFixed(1)}° A:${obj.az.toFixed(1)}°`;
    }
    
    document.getElementById('star-name').textContent = getObjectName(obj);
    document.getElementById('star-altaz').textContent = altAzText; 
    
    const distEl = document.getElementById('star-dist');
    distEl.textContent = distText;
    if (distEl.nextSibling && distEl.nextSibling.nodeType === 3) {
        distEl.nextSibling.textContent = distUnit; 
    }
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
}

function updateReticle() {
    const reticle = document.getElementById('star-reticle');
    
    if (!state.selectedObject || state.shuttleValue !== 0 || state.isDragging) {
        reticle.classList.remove('visible');
        reticle.style.display = 'none'; 
        return;
    }

    camera.updateMatrixWorld();

    let targetVec = new THREE.Vector3();

    if (state.selectedObject.isStarPoint) {
        const points = layers['star'].mesh.children.find(c => c.isPoints);
        if (points && points.geometry.attributes.position) {
            const index = state.selectedObject.index;
            targetVec.fromBufferAttribute(points.geometry.attributes.position, index);
            targetVec.applyMatrix4(points.matrixWorld);
        } else {
            return;
        }
    } 
    else if (state.selectedObject.meshReference) {
        state.selectedObject.meshReference.updateMatrixWorld();
        targetVec.setFromMatrixPosition(state.selectedObject.meshReference.matrixWorld);
    }
    else {
        const r = CONFIG.radius;
        let ra = state.selectedObject.ra_deg || state.selectedObject.ra || 0;
        let dec = state.selectedObject.dec_deg || state.selectedObject.dec || 0;
        
        if (state.selectedObject.objType === 'SolarSystem') {
             const altRad = state.selectedObject.alt * (Math.PI / 180);
             const azRad = state.selectedObject.az * (Math.PI / 180);
             targetVec.set(
                 r * Math.cos(altRad) * Math.sin(azRad),
                 r * Math.sin(altRad),
                 -r * Math.cos(altRad) * Math.cos(azRad)
             );
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
        reticle.classList.remove('visible');
        reticle.style.display = 'none'; 
        return;
    }

    const sx = (targetVec.x + 1) * window.innerWidth / 2;
    const sy = -(targetVec.y - 1) * window.innerHeight / 2;
    
    reticle.style.display = 'block';
    reticle.style.transform = `translate(${sx}px, ${sy}px)`;
    reticle.classList.add('visible');
}

function updateLabelSizes() {
    const fovFactor = camera.fov / 50.0;

    if (layers['ConstellationLabels']) {
        layers['ConstellationLabels'].mesh.children.forEach(sprite => {
            if (sprite.userData.baseScale) {
                sprite.scale.set(
                    sprite.userData.baseScale.x * fovFactor,
                    sprite.userData.baseScale.y * fovFactor,
                    1
                );
            }
        });
    }

    if (layers['star']) {
        layers['star'].mesh.children.forEach(child => {
            if (child.isGroup && child.children.length > 0) {
                const label = child.children[0];
                if (label.userData.isLabel && label.userData.baseScale) {
                    label.scale.set(
                        label.userData.baseScale.x * fovFactor,
                        label.userData.baseScale.y * fovFactor,
                        1
                    );
                }
            }
        });
    }

    Object.keys(layers).forEach(key => {
        if (key === 'star' || key === 'ConstellationLines' || key === 'ConstellationLabels') return;
        const group = layers[key].mesh;
        group.children.forEach(wrapper => {
            if (wrapper.children.length >= 2) {
                const label = wrapper.children[1];
                if (label.userData.isLabel && label.userData.baseScale) {
                    label.scale.set(
                        label.userData.baseScale.x * fovFactor,
                        label.userData.baseScale.y * fovFactor,
                        1
                    );
                }
            }
        });
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (layers['star']) {
        const points = layers['star'].mesh.children.find(c => c.isPoints);
        if (points) {
            points.material.uniforms.uTime.value += 0.005;
            // --- 修正箇所: FOVをシェーダーへ送る ---
            if (points.material.uniforms.uFov) {
                points.material.uniforms.uFov.value = camera.fov;
            }
        }
    }
    
    updateLabelSizes();

    if (state.shuttleValue !== 0) {
        const speed = Math.pow(state.shuttleValue, 3) * 10; 
        state.date.setTime(state.date.getTime() + speed);
        updatePositions(); 
        const d = state.date;
        const local = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
        document.getElementById('date-picker').value = local.toISOString().slice(0, 16);
        
        const screenClock = document.getElementById('screen-clock');
        if(screenClock){
            const year = d.getFullYear();
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            const hour = d.getHours().toString().padStart(2, '0');
            const min = d.getMinutes().toString().padStart(2, '0');
            screenClock.textContent = `${year}/${month}/${day} ${hour}:${min}`;
        }
    }
    controls.update();
    renderer.render(scene, camera);
    updateReticle();
}

init();