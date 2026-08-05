// 【baseColor と aqueous の役割はまったく別物】
//
// baseColor … **ゲームで見分けるための色**。盤の上で 14 種のイオンが一目で区別
//   できることだけを狙って割り振っている（1族=黄/橙, 銅=青, 水酸化物=シアン,
//   硫黄=赤, ハロゲン=緑, 重金属=銀/白/灰系）。実際の水溶液の色ではない。
//   —— 水溶液の色に寄せると Cu²⁺ と Fe²⁺ 以外が全部「無色」になり、
//   ゲームとして成立しないため、この割り切りは意図的（v12・検品 J-5）。
//
// aqueous … **実際の水溶液の色**を表す言葉。図鑑だけが読む。
//   「無色」は色コードで表せないので、色コードではなく日本語で持つ。
//   ブランドが「色でみる無機化学」である以上、生徒がタイルの色を水溶液の色として
//   覚えてしまう導線を放置できない。図鑑で本当の色を並べ、注意書きを添えて打ち消す。
//   （炎色反応の色はここでは扱わない。ハブの単元表でも「準備中」）

const CATIONS = {
    'Ag': { id: 'Ag', name: 'Ag⁺', charge: 1, baseColor: '#bdc3c7', textColor: '#000', aqueous: '無色' },
    'Ba': { id: 'Ba', name: 'Ba²⁺', charge: 2, baseColor: '#badc58', textColor: '#000', aqueous: '無色' },
    'Cu': { id: 'Cu', name: 'Cu²⁺', charge: 2, baseColor: '#3498db', textColor: '#fff', aqueous: '青色' },
    'Na': { id: 'Na', name: 'Na⁺', charge: 1, baseColor: '#f1c40f', textColor: '#000', aqueous: '無色' },
    'Ca': { id: 'Ca', name: 'Ca²⁺', charge: 2, baseColor: '#e67e22', textColor: '#fff', aqueous: '無色' },
    // SULFIDE MODE SPECIFIC
    'Pb': { id: 'Pb', name: 'Pb²⁺', charge: 2, baseColor: '#7f8c8d', textColor: '#fff', aqueous: '無色' },
    'Fe': { id: 'Fe', name: 'Fe²⁺', charge: 2, baseColor: '#535c68', textColor: '#fff', aqueous: '淡緑色' },
    'Zn': { id: 'Zn', name: 'Zn²⁺', charge: 2, baseColor: '#dff9fb', textColor: '#000', aqueous: '無色' }
};

const ANIONS = {
    'Cl': { id: 'Cl', name: 'Cl⁻', charge: -1, baseColor: '#2ecc71', textColor: '#000', aqueous: '無色' },
    'SO4': { id: 'SO4', name: 'SO₄²⁻', charge: -2, baseColor: '#9b59b6', textColor: '#fff', aqueous: '無色' },
    'S': { id: 'S', name: 'S²⁻', charge: -2, baseColor: '#e74c3c', textColor: '#fff', aqueous: '無色' },
    'OH': { id: 'OH', name: 'OH⁻', charge: -1, baseColor: '#1abc9c', textColor: '#000', aqueous: '無色' },
    'NO3': { id: 'NO3', name: 'NO₃⁻', charge: -1, baseColor: '#34495e', textColor: '#fff', aqueous: '無色' },
    'CO3': { id: 'CO3', name: 'CO₃²⁻', charge: -2, baseColor: '#d35400', textColor: '#fff', aqueous: '無色' }
};

const PRECIPITATES = [
    // --- CLASSIC PRECIPITATES ---
    { c: 'Ag', a: 'Cl', formula: 'AgCl', name: '白色沈殿', color: '#ffffff', ph: 'ALL' },
    { c: 'Ag', a: 'OH', formula: 'Ag₂O', name: '褐色沈殿', color: '#795548', ph: 'ALL' },
    // Ag₂CO₃ は文献が白色〜淡黄色で割れている（英語圏は pale yellow、国内の資料集は
    // 白色表記も多い）。入試での登場も少ないので **白を主**とし、BaCO₃・CaCO₃ と同じ扱いに
    // そろえた（v14）。淡黄色という記述もあることは note で図鑑の行に併記する。
    // —— 以前は '淡黄色沈殿' / #f1c40f（Na⁺ タイルと同じ鮮やかな黄）で、
    //    「淡黄」と名乗って AgI 級の鮮黄という名乗りとの乖離があった
    { c: 'Ag', a: 'CO3', formula: 'Ag₂CO₃', name: '白色沈殿', color: '#ffffff', ph: 'ALL', note: '資料により淡黄色とも' },
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
