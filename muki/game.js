const canvas = document.getElementById('game-board');
const ctx = canvas.getContext('2d');
const headCanvas = document.getElementById('head-preview');
const headCtx = headCanvas.getContext('2d');
const nextHeadCanvas = document.getElementById('next-head-preview');
const nextHeadCtx = nextHeadCanvas.getContext('2d');

const COLS = 15;
const ROWS = 15;
let BLOCK_SIZE = 40; // 可変：fitBoard() で画面サイズに合わせて再計算（描画は毎フレームこの値から）

let GAME_MODE = 'CLASSIC'; // 'CLASSIC' or 'SULFIDE'
let DIFFICULTY = 'EASY'; 
let PLAYER_POLARITY = 'CATION';
let FIELD_PH = 'ACIDIC'; // 'ACIDIC' or 'BASIC'
let phTimer = 0;

document.getElementById('btn-mode-classic').addEventListener('click', (e) => {
    if(gameState === 'PLAYING') return;
    GAME_MODE = 'CLASSIC'; 
    e.currentTarget.classList.add('active'); 
    document.getElementById('btn-mode-sulfide').classList.remove('active'); 
    init();
});
document.getElementById('btn-mode-sulfide').addEventListener('click', (e) => {
    if(gameState === 'PLAYING') return;
    GAME_MODE = 'SULFIDE'; 
    e.currentTarget.classList.add('active'); 
    document.getElementById('btn-mode-classic').classList.remove('active'); 
    init();
});

document.getElementById('btn-easy').addEventListener('click', (e) => {
    if(gameState === 'PLAYING') return;
    DIFFICULTY = 'EASY'; e.currentTarget.classList.add('active'); document.getElementById('btn-expert').classList.remove('active'); init();
});
document.getElementById('btn-expert').addEventListener('click', (e) => {
    if(gameState === 'PLAYING') return;
    DIFFICULTY = 'EXPERT'; e.currentTarget.classList.add('active'); document.getElementById('btn-easy').classList.remove('active'); init();
});
document.getElementById('btn-cation').addEventListener('click', (e) => {
    if(gameState === 'PLAYING' || GAME_MODE === 'SULFIDE') return;
    PLAYER_POLARITY = 'CATION'; e.currentTarget.classList.add('active'); document.getElementById('btn-anion').classList.remove('active'); init();
});
document.getElementById('btn-anion').addEventListener('click', (e) => {
    if(gameState === 'PLAYING' || GAME_MODE === 'SULFIDE') return;
    PLAYER_POLARITY = 'ANION'; e.currentTarget.classList.add('active'); document.getElementById('btn-cation').classList.remove('active'); init();
});

function populateDict() {
    let content = document.getElementById('dict-content');
    let html = '';
    
    html += '<div class="dict-section"><h3>陽イオン (Cations)</h3>';
    for (let k in CATIONS) {
        let c = CATIONS[k];
        html += `<div class="dict-item" style="color:${c.textColor}; background:${c.baseColor}; border:none;">${c.name}</div>`;
    }
    html += '</div>';
    
    html += '<div class="dict-section"><h3>陰イオン (Anions)</h3>';
    for (let k in ANIONS) {
        let a = ANIONS[k];
        html += `<div class="dict-item" style="color:${a.textColor}; background:${a.baseColor}; border:none;">${a.name}</div>`;
    }
    html += '</div>';
    
    html += '<div class="dict-section"><h3>全沈殿リスト (Precipitates)</h3><ul style="list-style-type:none; padding:0;">';
    for (let p of PRECIPITATES) {
        let c = CATIONS[p.c];
        let a = ANIONS[p.a];
        let pCondition = p.ph === 'BASIC' ? '&nbsp;<span style="font-size:12px; color:#e74c3c; border:1px solid #e74c3c; padding:2px 5px; border-radius:3px;">※塩基性のみ</span>' : '';
        html += `<li style="margin-bottom:10px; background:rgba(0,0,0,0.4); padding:12px; border-radius:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <span style="color:${c.baseColor || '#fff'}; font-weight:bold; font-size:20px;">${c.name}</span> 
            <span style="color:#bdc3c7;">+</span> 
            <span style="color:${a.baseColor || '#fff'}; font-weight:bold; font-size:20px;">${a.name}</span> 
            <span style="color:#bdc3c7; margin: 0 10px;">⇒</span>
            <strong style="color:${p.color}; text-shadow:0 0 5px rgba(255,255,255,0.3); font-size:24px;">${p.formula}</strong> 
            <span style="color:#bdc3c7; font-size:14px; margin-left:5px;">(${p.name})${pCondition}</span>
        </li>`;
    }
    html += '</ul></div>';
    
    content.innerHTML = html;
}

document.getElementById('btn-dict').addEventListener('click', () => {
    if (gameState === 'PLAYING') return; 
    populateDict();
    document.getElementById('dict-modal').classList.remove('hidden');
});

document.getElementById('btn-dict-close').addEventListener('click', () => {
    document.getElementById('dict-modal').classList.add('hidden');
});

let snake = [];
let oldSnake = [];
let dirQueue = [];
let foods = []; 
let snakeDir = {x: 1, y: 0};
let currentHeadIon = null;
let nextHeadIon = null;
let lastTime = 0;
let moveCounter = 0;
let totalMoves = 0;
let eatenItems = 0;
let score = 0;
let gameState = 'READY'; // READY, PLAYING, GAMEOVER
let animTime = 0;
let timeSinceLastSpawn = 0;

function getRandomKey(obj) {
    let keys = Object.keys(obj);
    return keys[Math.floor(Math.random() * keys.length)];
}

function updateUIState() {
    let btns = document.querySelectorAll('.mode-select button, #btn-dict');
    btns.forEach(b => {
        if(gameState === 'PLAYING') {
            b.style.opacity = '0.5';
            b.style.cursor = 'not-allowed';
            b.disabled = true;
        } else {
            b.style.opacity = '1';
            b.style.cursor = 'pointer';
            b.disabled = false;
        }
    });

    let cationBtn = document.getElementById('btn-cation');
    let anionBtn = document.getElementById('btn-anion');
    if (GAME_MODE === 'SULFIDE') {
        cationBtn.disabled = true;
        anionBtn.disabled = true;
        cationBtn.classList.remove('active');
        anionBtn.classList.remove('active');
        if(gameState !== 'PLAYING') {
            cationBtn.style.opacity = '0.3';
            anionBtn.style.opacity = '0.3';
        }
    } else {
        if(gameState !== 'PLAYING') {
            if(PLAYER_POLARITY === 'CATION') cationBtn.classList.add('active'); 
            else anionBtn.classList.add('active');
        }
    }
}

function init() {
    snake = [
        {x: 7, y: 7},
        {x: 6, y: 7},
        {x: 5, y: 7}
    ];
    oldSnake = JSON.parse(JSON.stringify(snake));
    snakeDir = {x: 1, y: 0};
    dirQueue = [];
    totalMoves = 0;
    eatenItems = 0;
    score = 0;
    gameState = 'READY';
    moveCounter = 0;
    timeSinceLastSpawn = 0;

    if (GAME_MODE === 'SULFIDE') {
        PLAYER_POLARITY = 'ANION';
        currentHeadIon = ANIONS['S'];
        nextHeadIon = ANIONS['S'];
        FIELD_PH = 'ACIDIC';
        phTimer = 0;
    } else {
        let { headPool } = getPools();
        currentHeadIon = headPool[getRandomKey(headPool)];
        nextHeadIon = headPool[getRandomKey(headPool)];
    }
    
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('score').innerText = score;
    document.getElementById('length').innerText = snake.length;

    updateHeadUI();

    foods = [];
    spawnSingleFood(); 
    spawnSingleFood(); 
    spawnSingleFood(); 

    updateUIState();
    updatePHUI();
    requestAnimationFrame(update);
}

function updatePHUI() {
    const phDisplay = document.getElementById('ph-display');
    const phValue = document.getElementById('ph-value');
    const phCountdown = document.getElementById('ph-countdown');
    if (!phDisplay || !phValue) return;

    if (GAME_MODE === 'SULFIDE') {
        phDisplay.style.display = 'inline';
        if (FIELD_PH === 'ACIDIC') {
            phValue.innerText = '酸性 (ACID)';
            phValue.style.color = '#e74c3c';
        } else {
            phValue.innerText = '塩基性 (BASIC)';
            phValue.style.color = '#3498db';
        }

        if (phCountdown) {
            let remainingSec = Math.ceil((7000 - phTimer) / 1000);
            phCountdown.innerText = `(変化まで: ${remainingSec}秒)`;
        }
    } else {
        phDisplay.style.display = 'none';
        if (phCountdown) phCountdown.innerText = '';
    }
}

function getPools() {
    if (GAME_MODE === 'SULFIDE') {
        let sFoodPool = {
            'Na': CATIONS['Na'], 'Ba': CATIONS['Ba'], 'Ca': CATIONS['Ca'], 
            'Cu': CATIONS['Cu'], 'Ag': CATIONS['Ag'], 'Pb': CATIONS['Pb'], 
            'Fe': CATIONS['Fe'], 'Zn': CATIONS['Zn']
        };
        return { headPool: {'S': ANIONS['S']}, foodPool: sFoodPool };
    }
    let classicCations = { 'Ag': CATIONS['Ag'], 'Ba': CATIONS['Ba'], 'Cu': CATIONS['Cu'], 'Na': CATIONS['Na'], 'Ca': CATIONS['Ca'] };
    let classicAnions = { 'Cl': ANIONS['Cl'], 'SO4': ANIONS['SO4'], 'S': ANIONS['S'], 'OH': ANIONS['OH'], 'NO3': ANIONS['NO3'], 'CO3': ANIONS['CO3'] };
    return PLAYER_POLARITY === 'CATION' ? { headPool: classicCations, foodPool: classicAnions } : { headPool: classicAnions, foodPool: classicCations };
}

function updateHeadUI() {
    document.getElementById('head-name').innerText = currentHeadIon.name;
    document.getElementById('head-name').style.color = currentHeadIon.color || currentHeadIon.baseColor || '#fff';
    
    document.getElementById('next-head-name').innerText = nextHeadIon.name;
    document.getElementById('next-head-name').style.color = nextHeadIon.color || nextHeadIon.baseColor || '#fff';
    
    drawHeadPreview(headCtx, headCanvas.width, headCanvas.height, currentHeadIon, 30);
    drawHeadPreview(nextHeadCtx, nextHeadCanvas.width, nextHeadCanvas.height, nextHeadIon, 20);
}

function changeHeadIon() {
    if (GAME_MODE === 'SULFIDE') return; // Fixed head
    let { headPool } = getPools();
    currentHeadIon = nextHeadIon;
    nextHeadIon = headPool[getRandomKey(headPool)];
    updateHeadUI();
}

function spawnSingleFood() {
    if (foods.length >= 60) return;

    let { foodPool } = getPools();
    let currentPh = GAME_MODE === 'SULFIDE' ? FIELD_PH : 'ALL';
    
    let safeKeys = Object.keys(foodPool).filter(k => {
        let cid = PLAYER_POLARITY === 'CATION' ? currentHeadIon.id : k;
        let aid = PLAYER_POLARITY === 'CATION' ? k : currentHeadIon.id;
        return !getPrecipitate(cid, aid, currentPh);
    });

    let allKeys = Object.keys(foodPool);
    let isThereSafe = foods.some(f => {
        let cid = PLAYER_POLARITY === 'CATION' ? currentHeadIon.id : f.ion.id;
        let aid = PLAYER_POLARITY === 'CATION' ? f.ion.id : currentHeadIon.id;
        return !getPrecipitate(cid, aid, currentPh);
    });
    
    let chosenKey;
    if (DIFFICULTY === 'EASY' && !isThereSafe && safeKeys.length > 0 && Math.random() < 0.8) {
        chosenKey = safeKeys[Math.floor(Math.random() * safeKeys.length)];
    } else {
        chosenKey = allKeys[Math.floor(Math.random() * allKeys.length)];
    }

    let bestCandidate = null;
    let maxIsolationScore = -1;

    for (let i = 0; i < 40; i++) {
        let x = Math.floor(Math.random() * COLS);
        let y = Math.floor(Math.random() * ROWS);
        
        let hitSnake = snake.some(s => s.x === x && s.y === y);
        let hitFood = foods.some(f => f.x === x && f.y === y);
        if (hitSnake || hitFood) continue;
        
        let head = snake[0];
        let inPath = false;
        let dx = x - head.x;
        let dy = y - head.y;
        if (snakeDir.x === 1 && dy >= -1 && dy <= 1 && dx > 0 && dx <= 4) inPath = true;
        if (snakeDir.x === -1 && dy >= -1 && dy <= 1 && dx < 0 && dx >= -4) inPath = true;
        if (snakeDir.y === 1 && dx >= -1 && dx <= 1 && dy > 0 && dy <= 4) inPath = true;
        if (snakeDir.y === -1 && dx >= -1 && dx <= 1 && dy < 0 && dy >= -4) inPath = true;
        if (inPath) continue; 

        let minDist = 999;
        for (let s of snake) {
            let dist = Math.abs(s.x - x) + Math.abs(s.y - y);
            if (dist < minDist) minDist = dist;
        }
        for (let f of foods) {
            let dist = Math.abs(f.x - x) + Math.abs(f.y - y);
            if (dist < minDist) minDist = dist;
        }

        if (minDist > maxIsolationScore) {
            maxIsolationScore = minDist;
            bestCandidate = {x, y};
        }
    }
    
    if (!bestCandidate) {
        for(let i=0; i<100; i++) {
            let x = Math.floor(Math.random() * COLS);
            let y = Math.floor(Math.random() * ROWS);
            let hitSnake = snake.some(s => s.x === x && s.y === y);
            let hitFood = foods.some(f => f.x === x && f.y === y);
            if (!hitSnake && !hitFood) {
                bestCandidate = {x, y};
                break;
            }
        }
    }
    
    if (bestCandidate) {
        foods.push({x: bestCandidate.x, y: bestCandidate.y, ion: foodPool[chosenKey]});
    }
}

function getSpeed() {
    let base = 250; 
    return Math.max(60, base - (snake.length - 3) * 4);
}

function getSpawnInterval() {
    return 2500; 
}

function updateScore() {
    let itemPoints = DIFFICULTY === 'EXPERT' ? 200 : 100;
    if (GAME_MODE === 'SULFIDE') itemPoints = 150; // Special mode bonus
    score = (totalMoves * 1) + (eatenItems * itemPoints);
    document.getElementById('score').innerText = score;
}

function showFloodEffect(newPH) {
    let el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.top = '0'; el.style.left = '0'; el.style.width = '100%'; el.style.height = '100%';
    el.style.background = newPH === 'ACIDIC' ? 'rgba(231, 76, 60, 0.4)' : 'rgba(52, 152, 219, 0.4)';
    el.style.transition = 'opacity 0.4s';
    el.style.pointerEvents = 'none';
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    el.style.alignItems = 'center';
    el.style.fontSize = '32px';
    el.style.fontWeight = 'bold';
    el.style.color = '#fff';
    el.innerText = newPH === 'ACIDIC' ? '🔥 洪水：酸性 (ACID) 🔥' : '💧 洪水：塩基性 (BASIC) 💧';
    el.style.textShadow = '0 0 10px #000';
    el.style.zIndex = '100';
    
    document.getElementById('board-container').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 800);
    setTimeout(() => { if(el.parentElement) el.parentElement.removeChild(el); }, 1200);
}

/* 横持ちで盤を隠しているあいだかどうか。**style.css の
   @media (orientation: landscape) and (max-height: 500px) と同じ条件**。
   片方だけ動かすと、案内が出ているのに裏でヘビが動いて見えない所で死ぬ */
function isTooShortForBoard() {
    return window.innerHeight <= 500 && window.innerWidth > window.innerHeight;
}

function update(time = 0) {
    if (gameState === 'GAMEOVER') return;

    // 盤が見えないあいだは時間を進めない。lastTime だけ進めておかないと、
    // 縦に戻した瞬間に溜まった dt が一気に流れてヘビが飛ぶ
    if (isTooShortForBoard()) {
        lastTime = time;
        requestAnimationFrame(update);
        return;
    }
    
    let dt = time - lastTime;
    lastTime = time;
    animTime += dt;
    
    if (gameState === 'PLAYING') {
        moveCounter += dt;
        timeSinceLastSpawn += dt;
        
        if (timeSinceLastSpawn > getSpawnInterval()) {
            timeSinceLastSpawn = 0;
            spawnSingleFood();
        }
        
        if (GAME_MODE === 'SULFIDE') {
            phTimer += dt;
            if (phTimer > 7000) { // 7秒ごとに液性変化
                phTimer = 0;
                FIELD_PH = FIELD_PH === 'ACIDIC' ? 'BASIC' : 'ACIDIC';
                showFloodEffect(FIELD_PH);
                // 画面上のエサの再評価は、描画や次の一歩で自動的に判定される
            }
            updatePHUI();
        }
        
        if (moveCounter > getSpeed()) {
            moveCounter = 0;
            oldSnake = JSON.parse(JSON.stringify(snake)); 
            
            if (dirQueue.length > 0) {
                let nextDir = dirQueue.shift();
                if (snakeDir.x !== -nextDir.x || snakeDir.y !== -nextDir.y) {
                    snakeDir = nextDir;
                }
            }
            
            let newX = snake[0].x + snakeDir.x;
            let newY = snake[0].y + snakeDir.y;
            
            if (newX < 0 || newX >= COLS || newY < 0 || newY >= ROWS) {
                die("壁に激突しました", "");
                return;
            }
            
            if (snake.some(s => s.x === newX && s.y === newY)) {
                die("自分の尻尾を食べてしまいました", "");
                return;
            }

            let headObj = {x: newX, y: newY};
            snake.unshift(headObj);
            totalMoves++;
            
            let ateFoodIndex = foods.findIndex(f => f.x === newX && f.y === newY);
            let grew = false;

            if (ateFoodIndex !== -1) {
                let food = foods[ateFoodIndex];
                
                let cid = PLAYER_POLARITY === 'CATION' ? currentHeadIon.id : food.ion.id;
                let aid = PLAYER_POLARITY === 'CATION' ? food.ion.id : currentHeadIon.id;
                let currentPh = GAME_MODE === 'SULFIDE' ? FIELD_PH : 'ALL';
                let precipitate = getPrecipitate(cid, aid, currentPh);

                if (precipitate) {
                    let formulaStr = precipitate.formula;
                    die(`${currentHeadIon.name} と ${food.ion.name} が結合！`, precipitate.name, formulaStr, precipitate, food.ion);
                    drawBoard(); 
                    return;
                } else {
                    grew = true;
                    eatenItems++;
                    updateScore();
                    document.getElementById('length').innerText = snake.length;
                    
                    foods.splice(ateFoodIndex, 1);
                    changeHeadIon();
                    showSafeEffect(newX, newY);
                }
            }
            
            if (!grew) {
                snake.pop(); 
                updateScore(); 
            }
        }
    }
    
    drawBoard();
    requestAnimationFrame(update);
}

function showSafeEffect(x, y) {
    let el = document.createElement('div');
    el.className = 'floating-text';
    el.style.left = (x * BLOCK_SIZE + BLOCK_SIZE/2) + 'px';
    el.style.top = (y * BLOCK_SIZE + BLOCK_SIZE/2) + 'px';
    el.style.color = '#2ecc71';
    el.style.textShadow = '0 0 10px #2ecc71';
    el.innerText = '水溶OK!';
    document.getElementById('effect-layer').appendChild(el);
    setTimeout(() => {
        let l = document.getElementById('effect-layer');
        if (l.contains(el)) l.removeChild(el);
    }, 1000);
}

function die(reason, precipName, formula="", precipitateObj=null, diedFoodIon=null) {
    gameState = 'GAMEOVER';
    updateUIState();
    let ov = document.getElementById('game-over');
    ov.classList.remove('hidden');
    document.getElementById('final-score').innerText = score;
    document.getElementById('death-reason').innerText = reason;
    
    let formulaEl = document.getElementById('death-formula');
    if (formula && precipitateObj) {
        formulaEl.innerText = `${formula} (${precipName})`;
        formulaEl.style.color = precipitateObj.color;
        if (precipitateObj.color === '#ffffff') {
            formulaEl.style.textShadow = '0 0 10px rgba(255,255,255,1), 0 0 20px rgba(255,255,255,0.8), 0 0 5px #000';
        } else if (precipitateObj.color === '#2c3e50') {
            formulaEl.style.textShadow = '0 0 5px #fff, 0 0 15px rgba(255,255,255,0.8)';
        } else {
            formulaEl.style.textShadow = `0 0 10px ${precipitateObj.color}, 0 0 20px ${precipitateObj.color}`;
        }
    } else {
        formulaEl.innerText = '';
    }
    
    let knowledgeEl = document.getElementById('death-knowledge');
    if (diedFoodIon) {
        let precipList = PRECIPITATES.filter(p => p.c === diedFoodIon.id || p.a === diedFoodIon.id);
        if (precipList.length > 0) {
            let listArr = precipList.map(p => {
                let partnerId = (p.c === diedFoodIon.id) ? p.a : p.c;
                let partnerIon = CATIONS[partnerId] || ANIONS[partnerId];
                let pCondition = p.ph === 'BASIC' ? ' (塩基性のみ)' : '';
                return `<span style="color:${partnerIon.baseColor || '#fff'}; font-weight:bold; white-space:nowrap;">${partnerIon.name}</span> <span style="font-size:12px; color:#bdc3c7;">(${p.formula}: ${p.name}${pCondition})</span>`;
            });
            let pronounStr = PLAYER_POLARITY === 'CATION' || GAME_MODE === 'SULFIDE' ? '陽イオン' : '陰イオン';
            if (GAME_MODE === 'SULFIDE') pronounStr = '硫化物(S²⁻)'; 
            knowledgeEl.innerHTML = `<span style="color:#f1c40f; font-weight:bold;">【復習】今回食べたエサ（<span style="color:${diedFoodIon.baseColor || '#fff'}">${diedFoodIon.name}</span>）と沈殿する相手：</span><br><div style="margin-top: 8px;">${listArr.join(' / ')}</div>`;
            knowledgeEl.style.display = 'block';
        } else {
            knowledgeEl.style.display = 'none';
        }
    } else {
        knowledgeEl.style.display = 'none';
    }
    
    let envStr = GAME_MODE === 'SULFIDE' ? `  |  Died in: ${FIELD_PH}` : '';
    document.getElementById('death-settings').innerText = `Mode: ${GAME_MODE}  |  Difficulty: ${DIFFICULTY}${envStr}`;
}

function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (GAME_MODE === 'SULFIDE') {
        if (FIELD_PH === 'ACIDIC') {
            ctx.fillStyle = "rgba(231, 76, 60, 0.15)";
        } else {
            ctx.fillStyle = "rgba(52, 152, 219, 0.15)";
        }
        ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for(let x=0; x<=COLS; x++) { ctx.beginPath(); ctx.moveTo(x*BLOCK_SIZE, 0); ctx.lineTo(x*BLOCK_SIZE, ROWS*BLOCK_SIZE); ctx.stroke(); }
    for(let y=0; y<=ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y*BLOCK_SIZE); ctx.lineTo(COLS*BLOCK_SIZE, y*BLOCK_SIZE); ctx.stroke(); }

    if (gameState === 'READY') {
        renderStaticSnake();
        renderFoods();
        
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "#f1c40f";
        ctx.font = "bold 28px 'Orbitron', 'Noto Sans JP'";
        ctx.textAlign = "center";
        
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.strokeText("PRESS ARROW KEY TO START", canvas.width/2, canvas.height/2);
        ctx.fillText("PRESS ARROW KEY TO START", canvas.width/2, canvas.height/2);

        let alpha = (Math.sin(Date.now() / 200) + 1) / 2 * 0.5 + 0.3;
        ctx.fillStyle = `rgba(241, 196, 15, ${alpha})`;
        ctx.font = "bold 20px 'Noto Sans JP'";
        ctx.fillText("矢印キーを押してスタート", canvas.width/2, canvas.height/2 + 40);
        return;
    }

    let p = moveCounter / Math.max(1, getSpeed());
    if (p > 1) p = 1;
    if (gameState === 'GAMEOVER') p = 1;

    for (let i = snake.length - 1; i >= 0; i--) {
        let target = snake[i];
        let oldPos = oldSnake[i];
        
        if (!oldPos) {
            oldPos = (i > 0) ? oldSnake[i-1] : target;
        }

        let vx = oldPos.x + (target.x - oldPos.x) * p;
        let vy = oldPos.y + (target.y - oldPos.y) * p;

        if (i === 0) {
            ctx.fillStyle = currentHeadIon.baseColor || '#fff';
            ctx.shadowColor = currentHeadIon.baseColor || '#fff';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.roundRect(vx * BLOCK_SIZE + 2, vy * BLOCK_SIZE + 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4, 8);
            ctx.fill();
            ctx.shadowBlur = 0;
            
            ctx.fillStyle = currentHeadIon.textColor || '#fff';
            ctx.font = "bold 16px 'Noto Sans JP'";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(currentHeadIon.display || currentHeadIon.name, vx * BLOCK_SIZE + BLOCK_SIZE/2, vy * BLOCK_SIZE + BLOCK_SIZE/2);
        } else {
            let factor = 1 - (i / snake.length);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + factor*0.5})`;
            ctx.beginPath();
            ctx.roundRect(vx * BLOCK_SIZE + 2, vy * BLOCK_SIZE + 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4, 8);
            ctx.fill();
        }
    }

    renderFoods();
}

function renderStaticSnake() {
    for (let i = snake.length - 1; i >= 0; i--) {
        let s = snake[i];
        if (i === 0) {
            ctx.fillStyle = currentHeadIon.baseColor || '#fff';
            ctx.shadowColor = currentHeadIon.baseColor || '#fff';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.roundRect(s.x * BLOCK_SIZE + 2, s.y * BLOCK_SIZE + 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4, 8);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = currentHeadIon.textColor || '#fff';
            ctx.font = "bold 16px 'Noto Sans JP'";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(currentHeadIon.display || currentHeadIon.name, s.x * BLOCK_SIZE + BLOCK_SIZE/2, s.y * BLOCK_SIZE + BLOCK_SIZE/2);
        } else {
            let factor = 1 - (i / snake.length);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + factor*0.5})`;
            ctx.beginPath();
            ctx.roundRect(s.x * BLOCK_SIZE + 2, s.y * BLOCK_SIZE + 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4, 8);
            ctx.fill();
        }
    }
}

function renderFoods() {
    let pulse = Math.abs(Math.sin(animTime / 300));
    for (let f of foods) {
        let fx = f.x * BLOCK_SIZE;
        let fy = f.y * BLOCK_SIZE;
        
        ctx.fillStyle = f.ion.baseColor || '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(fx + BLOCK_SIZE/2, fy + BLOCK_SIZE/2, BLOCK_SIZE/2 - 4, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (DIFFICULTY === 'EASY') {
            let cid = PLAYER_POLARITY === 'CATION' ? currentHeadIon.id : f.ion.id;
            let aid = PLAYER_POLARITY === 'CATION' ? f.ion.id : currentHeadIon.id;
            let currentPh = GAME_MODE === 'SULFIDE' ? FIELD_PH : 'ALL';
            let precip = getPrecipitate(cid, aid, currentPh);

            ctx.lineWidth = 3;
            if (precip) {
                ctx.strokeStyle = `rgba(231, 76, 60, ${0.4 + pulse*0.6})`;
                ctx.shadowColor = '#e74c3c';
                ctx.shadowBlur = 10;
            } else {
                ctx.strokeStyle = `rgba(46, 204, 113, ${0.4 + pulse*0.6})`;
                ctx.shadowColor = '#2ecc71';
                ctx.shadowBlur = 10;
            }
            ctx.beginPath();
            ctx.arc(fx + BLOCK_SIZE/2, fy + BLOCK_SIZE/2, BLOCK_SIZE/2 - 1, 0, Math.PI*2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.fillStyle = f.ion.textColor || '#fff';
        ctx.font = "bold 14px 'Noto Sans JP'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(f.ion.display || f.ion.name, fx + BLOCK_SIZE/2, fy + BLOCK_SIZE/2);
    }
}

function drawHeadPreview(ctxCanvas, cw, ch, ion, padding) {
    if(!ion) return;
    ctxCanvas.clearRect(0, 0, cw, ch);
    let cx = cw / 2;
    let cy = ch / 2 - 5;
    
    let size = cw - padding * 2;

    ctxCanvas.fillStyle = ion.baseColor || '#fff';
    ctxCanvas.shadowColor = ion.baseColor || '#fff';
    ctxCanvas.shadowBlur = 20;
    ctxCanvas.beginPath();
    ctxCanvas.roundRect(cx - size/2, cy - size/2, size, size, 12);
    ctxCanvas.fill();
    ctxCanvas.shadowBlur = 0;
    
    ctxCanvas.fillStyle = ion.textColor || '#fff';
    ctxCanvas.font = `bold ${Math.floor(size/2.2)}px 'Noto Sans JP'`;
    ctxCanvas.textAlign = "center";
    ctxCanvas.textBaseline = "middle";
    ctxCanvas.fillText(ion.name, cx, cy);
}

document.addEventListener('keydown', (e) => {
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.key) > -1) {
        // 図鑑（縦長でスクロールに矢印を使うのが自然）や死亡画面が開いているあいだは
        // ゲームを始めない。preventDefault もしない＝矢印はブラウザ既定のスクロールに譲る
        if (!document.getElementById('dict-modal').classList.contains('hidden') ||
            !document.getElementById('game-over').classList.contains('hidden')) return;
        e.preventDefault();

        if (gameState === 'READY') {
            gameState = 'PLAYING';
            updateUIState();
        }
        
        if (gameState === 'PLAYING') {
            if (e.key === 'ArrowLeft') dirQueue.push({x:-1, y:0});
            else if (e.key === 'ArrowRight') dirQueue.push({x:1, y:0});
            else if (e.key === 'ArrowUp') dirQueue.push({x:0, y:-1});
            else if (e.key === 'ArrowDown') dirQueue.push({x:0, y:1});
            
            if (dirQueue.length > 3) dirQueue.shift();
        }
    }
}, {passive: false});

document.getElementById('restart-btn').addEventListener('click', init);

// --- 盤面を画面サイズにフィット（座標はグリッド単位のままなので実行中でも安全） ---
function fitBoard() {
    // 盤の入る実測の横幅（容器のパディング込み）を基準にする。innerWidth 基準だとはみ出す
    const main = document.getElementById('main-area');
    let availW = (main && main.clientWidth > 50) ? main.clientWidth : (window.innerWidth - 24);
    let avail = Math.min(availW, 600);
    if (window.innerWidth <= 1200) {
        // 縦積みになる幅：下に積まれるコントロールのぶんの余白を確保する。
        // **この 1200 は style.css の @media (max-width: 1200px) と同じ閾値**。
        // 片方だけ動かすと、縦積みなのに盤が画面の高さを超える
        avail = Math.min(avail, window.innerHeight - 180);
    }
    if (avail < 140) avail = 140;
    BLOCK_SIZE = Math.max(12, Math.floor(avail / COLS));
    const px = BLOCK_SIZE * COLS;
    // 同じ大きさなら何もしない。canvas.width への代入は中身を消すので毎回やらない
    // （下の ResizeObserver が自分の書き換えでまた呼ばれる、の防止も兼ねる）
    if (canvas.width === px) return;
    canvas.width = px;
    canvas.height = px;
    const layer = document.getElementById('effect-layer');
    if (layer) { layer.style.width = px + 'px'; layer.style.height = px + 'px'; }
}
window.addEventListener('resize', fitBoard);
window.addEventListener('orientationchange', () => setTimeout(fitBoard, 120));

// イベントではなく実測で追随する。window の resize は、環境によっては配られない、
// またはレイアウトが確定する前に配られることがあり、そのとき盤だけが古い大きさで残る。
// #board-container は overflow:hidden なので、はみ出しは見えず**盤の右下が黙って
// 切り落とされる**（見えない場所にヘビが入って死ぬ）。ResizeObserver なら原因を問わず
// 「実際に大きさが変わったあと」に呼ばれるので、この穴が塞がる。
if (typeof ResizeObserver !== 'undefined') {
    const mainArea = document.getElementById('main-area');
    if (mainArea) {
        let busy = false;
        new ResizeObserver(() => {
            // **requestAnimationFrame で遅らせない**。裏タブや非表示のウィンドウでは
            // フレームが出ず rAF が永久に来ないため、そこだけ追随しなくなる
            // （このバグを実際に踏んだ）。fitBoard は同じ大きさなら何もしないので、
            // 同期で呼んでも observer が自分の書き換えで回り続けることはない。
            if (busy) return;
            busy = true;
            try { fitBoard(); } finally { busy = false; }
        }).observe(mainArea);
    }
}

// --- タッチ操作：盤面のスワイプで方向、タップで開始（キー操作と同じロジック） ---
(function initTouch() {
    const bc = document.getElementById('board-container');
    if (!bc) return;
    let sx = 0, sy = 0, tracking = false;
    bc.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; tracking = true;
    }, { passive: true });
    bc.addEventListener('touchmove', (e) => {
        // 盤面上のスワイプでページがスクロールしないように
        if (tracking) e.preventDefault();
    }, { passive: false });
    bc.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        const THRESH = 22;
        if (gameState === 'READY') { gameState = 'PLAYING'; updateUIState(); }
        if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return; // タップ＝開始のみ
        if (gameState !== 'PLAYING') return;
        let dir;
        if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
        else dir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
        dirQueue.push(dir);
        if (dirQueue.length > 3) dirQueue.shift();
    }, { passive: false });
})();

fitBoard();
setTimeout(init, 100);
