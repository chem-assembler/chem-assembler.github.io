// 塗色の基準：主に炎色反応や代表単体の色、水溶液等の固有のイメージカラーに基づき分類
// 1族=黄/Orange, 銅=青, 水酸化物=シアン, 硫黄=赤褐色, ハロゲン=緑, 重金属=銀/白/灰系

const CATIONS = {
    'Ag': { id: 'Ag', name: 'Ag⁺', charge: 1, baseColor: '#bdc3c7', textColor: '#000' }, 
    'Ba': { id: 'Ba', name: 'Ba²⁺', charge: 2, baseColor: '#badc58', textColor: '#000' }, 
    'Cu': { id: 'Cu', name: 'Cu²⁺', charge: 2, baseColor: '#3498db', textColor: '#fff' }, 
    'Na': { id: 'Na', name: 'Na⁺', charge: 1, baseColor: '#f1c40f', textColor: '#000' }, 
    'Ca': { id: 'Ca', name: 'Ca²⁺', charge: 2, baseColor: '#e67e22', textColor: '#fff' },
    // SULFIDE MODE SPECIFIC
    'Pb': { id: 'Pb', name: 'Pb²⁺', charge: 2, baseColor: '#7f8c8d', textColor: '#fff' }, 
    'Fe': { id: 'Fe', name: 'Fe²⁺', charge: 2, baseColor: '#535c68', textColor: '#fff' }, 
    'Zn': { id: 'Zn', name: 'Zn²⁺', charge: 2, baseColor: '#dff9fb', textColor: '#000' }
};

const ANIONS = {
    'Cl': { id: 'Cl', name: 'Cl⁻', charge: -1, baseColor: '#2ecc71', textColor: '#000' }, 
    'SO4': { id: 'SO4', name: 'SO₄²⁻', charge: -2, baseColor: '#9b59b6', textColor: '#fff' }, 
    'S': { id: 'S', name: 'S²⁻', charge: -2, baseColor: '#e74c3c', textColor: '#fff' }, 
    'OH': { id: 'OH', name: 'OH⁻', charge: -1, baseColor: '#1abc9c', textColor: '#000' }, 
    'NO3': { id: 'NO3', name: 'NO₃⁻', charge: -1, baseColor: '#34495e', textColor: '#fff' }, 
    'CO3': { id: 'CO3', name: 'CO₃²⁻', charge: -2, baseColor: '#d35400', textColor: '#fff' }
};

const PRECIPITATES = [
    // --- CLASSIC PRECIPITATES ---
    { c: 'Ag', a: 'Cl', formula: 'AgCl', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Ag', a: 'OH', formula: 'Ag₂O', name: '褐色沈殿', color: '#795548', ph: 'ALL' },
    { c: 'Ag', a: 'CO3', formula: 'Ag₂CO₃', name: '淡黄色沈殿', color: '#f1c40f', ph: 'ALL' },
    { c: 'Ba', a: 'SO4', formula: 'BaSO₄', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Ba', a: 'CO3', formula: 'BaCO₃', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Cu', a: 'OH', formula: 'Cu(OH)₂', name: '青白色沈殿', color: '#85c1e9', ph: 'ALL' },
    { c: 'Cu', a: 'CO3', formula: 'CuCO₃', name: '青緑色沈殿', color: '#1abc9c', ph: 'ALL' },
    { c: 'Ca', a: 'SO4', formula: 'CaSO₄', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Ca', a: 'CO3', formula: 'CaCO₃', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },

    // --- SULFIDE PRECIPITATES ---
    { c: 'Ag', a: 'S', formula: 'Ag₂S', name: '黒色沈殿', color: '#2c3e50', ph: 'ALL' },
    { c: 'Cu', a: 'S', formula: 'CuS', name: '黒色沈殿', color: '#2c3e50', ph: 'ALL' },
    { c: 'Pb', a: 'S', formula: 'PbS', name: '黒色沈殿', color: '#2c3e50', ph: 'ALL' },
    { c: 'Fe', a: 'S', formula: 'FeS', name: '黒色沈殿(※塩基性のみ)', color: '#2c3e50', ph: 'BASIC' },
    { c: 'Zn', a: 'S', formula: 'ZnS', name: '白色沈殿(※塩基性のみ)', color: '#ffffff', ph: 'BASIC' },

    // --- 図鑑用（系統分離の頻出。ゲームの勝敗には影響しない） ---
    // Classic のプール（getPools）に Pb²⁺/Fe²⁺/Zn²⁺ は入らず、Sulfide は頭が S²⁻ 固定
    // なので、S 以外との組はゲーム中に出会えない。図鑑の「全沈殿リスト」と死亡画面の
    // 復習（同じ相手と沈殿する組の列挙）だけがここを読む。
    // Pb(OH)₂・Zn(OH)₂ は両性（過剰の強塩基には溶ける）が、少量の塩基での沈殿生成は
    // 高校の定番なので載せる。Fe(OH)₂ の「緑白色」は教科書の言い方
    { c: 'Pb', a: 'Cl', formula: 'PbCl₂', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Pb', a: 'SO4', formula: 'PbSO₄', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Pb', a: 'OH', formula: 'Pb(OH)₂', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Fe', a: 'OH', formula: 'Fe(OH)₂', name: '緑白色沈殿', color: '#d4e6d0', ph: 'ALL' },
    { c: 'Zn', a: 'OH', formula: 'Zn(OH)₂', name: '白色沈殿', color: '#ffffff', ph: 'ALL' }
];

function getPrecipitate(cationId, anionId, currentPh = 'ALL') {
    let p = PRECIPITATES.find(p => p.c === cationId && p.a === anionId);
    if (!p) return null;
    
    // 液性判定：酸性のときは、BASIC専用(ZnS/FeS等)の沈殿は溶けて発生しない
    if (currentPh === 'ACIDIC' && p.ph === 'BASIC') {
        return null;
    }
    return p;
}
