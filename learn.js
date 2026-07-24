/**
 * 学習ビュー（P9-3）
 * 「⚗ この分子の反応」カードから呼び出し、いま描いている分子の分子式について
 * 構造異性体を全列挙して分類・件数・登録名を提示し、書き出し方のコツを解説する。
 * 列挙エンジンは chemistry.js の enumerateConstitutionalIsomers（純粋関数）。
 */

// 分子を代表的な官能基でひとつのカテゴリに分類する（優先度の高いものを採用）
function categorizeMolecule(mol) {
    const types = new Set(findFunctionalGroups(mol).map(g => g.type));
    const order = [
        ['carboxyl', 'カルボン酸'],
        ['ester', 'エステル'],
        ['aldehyde', 'アルデヒド'],
        ['ketone', 'ケトン'],
        ['phenol', 'フェノール類'],
        ['enol', 'エノール（不安定）'],
        ['alcohol3', 'アルコール'],
        ['alcohol2', 'アルコール'],
        ['alcohol1', 'アルコール'],
        ['alcohol0', 'アルコール'],
        ['ether', 'エーテル'],
        ['nitro', 'ニトロ化合物'],
        ['amino', 'アミン'],
        ['aromatic', '芳香族炭化水素'],
        ['cc_triple', 'アルキン（三重結合）'],
        ['cc_double', 'アルケン（二重結合）']
    ];
    for (const [type, label] of order) {
        if (types.has(type)) return label;
    }
    // 官能基なし: 環の有無で分ける（環の数 = 結合数 - 原子数 + 1）
    const rings = mol.bonds.length - mol.atoms.length + 1;
    return rings > 0 ? '環式炭化水素' : '鎖式炭化水素';
}

class LearnView {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('learn-modal');
        this.bodyEl = document.getElementById('learn-body');
        this.titleEl = document.getElementById('learn-title');

        const btn = document.getElementById('btn-isomers');
        if (btn) btn.addEventListener('click', () => this.showIsomers());
        const close = document.getElementById('btn-learn-close');
        if (close) close.addEventListener('click', () => this.modal.classList.add('hidden'));
    }

    // 現在の分子と同じ分子式の構造異性体を列挙して表示する
    showIsomers() {
        const g = this.game;
        const mol = g.userMolecule;
        const heavy = mol.atoms.filter(a => a.element !== 'H');
        if (heavy.length === 0) {
            g.showToast('先に分子を作図するか、名称から呼び出してください。');
            return;
        }
        if (g.countMolecules() > 1) {
            g.showToast('分子が複数あります。1つだけにしてから調べてください。');
            return;
        }
        if (heavy.length > 6) {
            g.showToast('炭素などの原子が多すぎるため、異性体の全列挙は省略します（水素を除いて6個までが対象です）。');
            return;
        }

        const elements = heavy.map(a => a.element);
        const hCount = heavy.reduce((s, a) => s + mol.getFreeValency(a.id), 0);
        const formula = g.computeMolecularFormula();

        // 列挙は分子式によっては数秒かかる（不飽和度が高いほど組み合わせが増える）。
        // 先にモーダルを開いて「計算中」を出し、描画を1フレーム譲ってから実行する
        this.titleEl.textContent = `${formula} の構造異性体`;
        this.bodyEl.innerHTML = '';
        this.bodyEl.appendChild(this.para('計算中です…', 'font-size:13px; color:var(--text-secondary);'));
        this.modal.classList.remove('hidden');
        setTimeout(() => this.renderIsomers(elements, hCount, mol), 0);
    }

    renderIsomers(elements, hCount, mol) {
        const g = this.game;
        const { isomers, overflow } = enumerateConstitutionalIsomers(elements, hCount);
        this.bodyEl.innerHTML = '';
        if (overflow) {
            this.bodyEl.appendChild(this.para(
                'この分子式は異性体が非常に多いため、全列挙を打ち切りました。' +
                '二重結合や環を含む（水素の少ない）分子式では、異性体の数が急激に増えます。'));
            this.modal.classList.remove('hidden');
            return;
        }

        // 分類ごとに集計し、ライブラリに登録がある異性体は名前を出す
        const byCategory = new Map();
        const selfCode = canonicalCode(mol);
        isomers.forEach(iso => {
            const cat = categorizeMolecule(iso);
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat).push({
                name: g.lookupCompoundName(iso),
                isSelf: canonicalCode(iso) === selfCode,
                mol: iso
            });
        });

        this.bodyEl.appendChild(this.para(
            `構造異性体は全部で ${isomers.length} 種類です（立体異性体・シス/トランスは数えていません）。`,
            'font-size:14px; color:#fff; font-weight:bold;'));

        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin:10px 0;';
        [...byCategory.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .forEach(([cat, items]) => {
                const row = document.createElement('div');
                row.style.cssText = 'background:rgba(255,255,255,0.05); border-radius:6px; padding:8px 10px;';
                const head = document.createElement('div');
                head.style.cssText = 'font-size:13px; color:var(--color-cyan); margin-bottom:3px;';
                head.textContent = `${cat} … ${items.length} 種類`;
                row.appendChild(head);

                // 構造式のギャラリー（P9-3b）: 各異性体を自動レイアウトしてサムネイル表示。
                // いま描いている分子はシアンの枠で示す
                const gallery = document.createElement('div');
                gallery.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:6px; margin-top:6px;';
                items.forEach(item => {
                    const cell = document.createElement('div');
                    cell.style.cssText = 'background:rgba(10,14,24,0.85); border:1px solid ' +
                        (item.isSelf ? 'var(--color-cyan)' : 'rgba(255,255,255,0.14)') +
                        '; border-radius:8px; padding:3px 3px 5px; text-align:center;';
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.id = 'iso-svg-' + (LearnView._svgSeq = (LearnView._svgSeq || 0) + 1);
                    item.svgId = svg.id;
                    svg.setAttribute('width', '100%');
                    svg.setAttribute('height', '86');
                    const bondsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    bondsG.setAttribute('class', 'quiz-bonds');
                    const atomsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    atomsG.setAttribute('class', 'quiz-atoms');
                    svg.appendChild(bondsG);
                    svg.appendChild(atomsG);
                    cell.appendChild(svg);
                    const label = document.createElement('div');
                    label.style.cssText = 'font-size:10px; color:var(--text-secondary); line-height:1.3; padding:0 2px;';
                    label.textContent = item.name
                        ? item.name + (item.isSelf ? '（この分子）' : '')
                        : (item.isSelf ? '（この分子）' : '（名称未登録）');
                    cell.appendChild(label);
                    gallery.appendChild(cell);
                });
                row.appendChild(gallery);
                list.appendChild(row);
            });
        this.bodyEl.appendChild(list);

        // サムネイルはDOMに入った後に描画する（renderMoleculeIntoSvg は getElementById を使うため）
        [...byCategory.values()].flat().forEach(item => {
            layoutMolecule(item.mol);
            const idx = new Map(item.mol.atoms.map((a, i) => [a.id, i]));
            const target = {
                atoms: item.mol.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
                bonds: item.mol.bonds.map(b => ({
                    atom1Index: idx.get(b.atomId1),
                    atom2Index: idx.get(b.atomId2),
                    type: b.type
                }))
            };
            renderMoleculeIntoSvg(g, item.svgId, target);
        });

        this.bodyEl.appendChild(this.para(
            '【書き出し方のコツ】\n' +
            '① まず炭素骨格を、直鎖 → 枝分かれの順にすべて書き出す（C₄なら直鎖1種と枝分かれ1種）。\n' +
            '② 次に官能基（-OH やエーテルの -O-）の位置を、骨格の端から順に動かしていく。\n' +
            '③ 回転・裏返しで重なるものは同じ分子なので除く（例: 1-プロパノールと3-プロパノールは同じ）。\n' +
            '④ 官能基の種類を変えて同じ手順を繰り返す（アルコールを数え終えたらエーテルへ）。',
            'white-space:pre-line; font-size:12px; line-height:1.7; color:var(--text-secondary);'));

        // いまの分子の官能基に応じた学習メモ
        const notes = this.buildNotes(mol);
        if (notes) {
            this.bodyEl.appendChild(this.para('【この分子の学習ポイント】\n' + notes,
                'white-space:pre-line; font-size:12px; line-height:1.7; color:var(--text-secondary); margin-top:8px;'));
        }
        this.modal.classList.remove('hidden');
    }

    // 検出された官能基に応じた学習メモを組み立てる
    buildNotes(mol) {
        const types = new Set(findFunctionalGroups(mol).map(g => g.type));
        const notes = [];
        if (types.has('alcohol1')) notes.push('・1級アルコール: 酸化するとアルデヒド、さらに酸化するとカルボン酸になります。');
        if (types.has('alcohol2')) notes.push('・2級アルコール: 酸化するとケトンになり、それ以上は酸化されにくくなります。');
        if (types.has('alcohol3')) notes.push('・3級アルコール: -OH のついた炭素に水素がないため酸化されにくい構造です。');
        if (types.has('alcohol1') || types.has('alcohol2') || types.has('alcohol3')) {
            notes.push('・級の見分け方: -OH がついた炭素に、ほかの炭素が何個結合しているかを数えます（1個なら1級、2個なら2級、3個なら3級）。');
            notes.push('・アルコールは分子内脱水でアルケン、分子間脱水でエーテルになります（温度で作り分け）。');
        }
        if (types.has('enol')) notes.push('・エノール（C=C-OH）: 不安定で、ただちにケト形（C=O、アルデヒドやケトン）へ変化します（ケト・エノール互変異性）。アルキンへの水付加で一時的に現れる構造です。');
        if (types.has('phenol')) notes.push('・フェノール性-OH: 弱酸性を示します。カルボン酸との直接エステル化は進行しにくいため、反応性の高い無水酢酸でアセチル化します（サリチル酸→アセチルサリチル酸）。');
        if (types.has('ether')) notes.push('・エーテル: 同じ分子式のアルコールと比べて沸点が低く、ナトリウムと反応しません（-OH がないため）。');
        if (types.has('aldehyde')) notes.push('・アルデヒド: 還元性があり、銀鏡反応やフェーリング液の還元を示します。');
        if (types.has('ketone')) notes.push('・ケトン: アルデヒドと同じカルボニル基を持ちますが、還元性は示しません。');
        if (types.has('carboxyl')) notes.push('・カルボン酸: 弱酸性を示し、アルコールと縮合してエステルになります。');
        if (types.has('ester')) notes.push('・エステル: 加水分解でカルボン酸とアルコールに戻ります（塩基を使う場合がけん化）。');
        if (types.has('cc_double')) notes.push('・C=C 二重結合: 付加反応（Br₂・H₂・HBr・H₂O）を起こします。臭素水の脱色で検出できます。');
        if (types.has('cc_triple')) notes.push('・C≡C 三重結合: 付加反応が2段階で進みます。');
        if (types.has('aromatic')) notes.push('・ベンゼン環: 付加より置換が起こりやすい（芳香族性を保つ方が安定）。ニトロ化・スルホン化・ハロゲン化が代表例です。');
        return notes.join('\n');
    }

    para(text, style = '') {
        const p = document.createElement('div');
        p.textContent = text;
        p.style.cssText = style || 'font-size:12px; line-height:1.6;';
        return p;
    }
}

// ===== ✏️ 異性体の書き出し練習（P12-1 M1。DESIGN_isomer_practice.md） =====
// 分子式を提示し、ユーザーが構造異性体を1つずつ描いて登録していく練習。
// 正解集合は列挙エンジン（enumerateConstitutionalIsomers）から起動時に生成し、
// 登録済み／正解集合との照合は canonicalCode（トポロジー同型）だけで行う。
// 状態はこのインスタンスに閉じ、chemistry.js には手を入れない（設計 7章）。

const IP_SVGNS = 'http://www.w3.org/2000/svg';
// C6H14 は既定の列挙ノード上限（60万）を超えるため、練習の正解集合生成には
// 十分大きな上限を渡して打ち切りを防ぐ（6問はすべて数百ms以内で完了する）
const IP_ENUM_LIMIT = 4000000;
// 任意分子式（M3）で受け付ける異性体数の上限。これを超える分子式（不飽和度の高い式など）は
// 教科書範囲を外れた構造を多数含み練習に不向きなので断る（設計 9章の分類フィルタ相当の暫定措置）
const IP_MAX_ISOMERS = 20;
const IP_HSTEP = 46; // 標準レイアウトの結合長（横方向）
// 丸数字（①②…）。1〜20は Unicode、それ以上は (n) で表す
function ipMaru(n) {
    return (n >= 1 && n <= 20) ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
}
// 答え合わせで「同じもの」グループを色分けする枠色
const IP_DUP_COLORS = ['#ffb454', '#59d0ff', '#b98cff', '#7CFC98', '#ff8ab0'];

// 主鎖の番号付けの向きを決める（低い位置番号＝IUPAC風。表示用）。0=そのまま / 1=反転
function ipChooseDirection(mol, chain) {
    const chainSet = new Set(chain);
    const score = (order) => {
        const posMap = new Map(order.map((id, i) => [id, i + 1]));
        let func = Infinity;
        for (const id of order) {
            const isOH = mol.getNeighbors(id).some(nn => nn.atom.element === 'O' && nn.type === 1 &&
                mol.getFreeValency(nn.atom.id) >= 1 &&
                mol.getNeighbors(nn.atom.id).filter(x => x.atom.element !== 'H').length === 1);
            if (isOH) func = Math.min(func, posMap.get(id));
        }
        let mult = Infinity;
        mol.bonds.forEach(b => {
            if ((b.type === 2 || b.type === 3) && posMap.has(b.atomId1) && posMap.has(b.atomId2)) {
                mult = Math.min(mult, posMap.get(b.atomId1), posMap.get(b.atomId2));
            }
        });
        let sub = Infinity;
        order.forEach(id => {
            if (mol.getNeighbors(id).some(nn => nn.atom.element !== 'H' && !chainSet.has(nn.atom.id))) {
                sub = Math.min(sub, posMap.get(id));
            }
        });
        return [Math.min(func, mult), sub];
    };
    const f = score(chain), r = score(chain.slice().reverse());
    for (let i = 0; i < f.length; i++) { if (f[i] !== r[i]) return f[i] < r[i] ? 0 : 1; }
    return 0;
}

// 主鎖を横一直線に、側鎖を上下に配した座標を返す。環を含む分子は null（layoutMolecule にフォールバック）
// 返り値 { order:[主鎖の原子IDを番号順に], pos:Map<id,{x,y}> }。表示専用（座標＝見た目のみ）
function ipNumberedLayout(mol) {
    if (findAnyCycle(mol)) return null;
    const chain = findLongestCarbonChain(mol);
    if (chain.length < 1) return null;
    const dir = ipChooseDirection(mol, chain);
    const order = dir ? chain.slice().reverse() : chain.slice();
    const chainSet = new Set(order);
    const pos = new Map();
    order.forEach((id, i) => pos.set(id, { x: i * IP_HSTEP, y: 0 }));
    order.forEach(anchorId => {
        const anchor = pos.get(anchorId);
        const roots = mol.getNeighbors(anchorId)
            .filter(nn => nn.atom.element !== 'H' && !chainSet.has(nn.atom.id))
            .map(nn => nn.atom.id);
        roots.forEach((rootId, ri) => {
            const sign = (ri % 2 === 0) ? -1 : 1; // 最初は上、次は下（gem-ジメチル対応）
            const seen = new Set(chainSet);
            const dfs = (id, x, depth) => {
                pos.set(id, { x, y: sign * depth * IP_HSTEP });
                seen.add(id);
                const kids = mol.getNeighbors(id)
                    .filter(nn => nn.atom.element !== 'H' && !seen.has(nn.atom.id))
                    .map(nn => nn.atom.id);
                kids.forEach((kid, ki) => dfs(kid, x + (ki - (kids.length - 1) / 2) * IP_HSTEP, depth + 1));
            };
            dfs(rootId, anchor.x, 1);
        });
    });
    return { order, pos };
}

class IsomerPractice {
    constructor(game) {
        this.game = game;
        this.body = document.getElementById('ip-body');
        this.overlay = document.getElementById('ip-review-overlay'); // 答え合わせ（並べて比較）
        this.active = false;
        this.problem = null;       // { index, elements, hCount, formula, total }
        this.targets = null;       // Map<canonicalCode, isomerMolecule>
        this.entries = [];         // ユーザーが書いた図の順序付きリスト（重複も保持）: { code, name, target, order }
        this._cache = new Map();   // index -> { isomers, overflow, formula }
        this._pending = [];        // サムネイル描画の遅延キュー
        this._hintLevel = 0;
        this._reviewing = false;
        this._firstToastShown = false;

        // M1 の固定問題リスト（設計 4.1）。異性体数はデータに持たず列挙エンジンから求める
        this.problems = [
            { elements: ['C', 'C', 'C', 'C'], hCount: 10 },
            { elements: ['C', 'C', 'C', 'C', 'C'], hCount: 12 },
            { elements: ['C', 'C', 'C', 'O'], hCount: 8 },
            { elements: ['C', 'C', 'C', 'C', 'C', 'C'], hCount: 14 },
            { elements: ['C', 'C', 'C', 'C'], hCount: 8 },
            { elements: ['C', 'C', 'C', 'C', 'O'], hCount: 10 }
        ];

        if (this.body) {
            // 初回描画は列挙（最大 ~150ms）で初期ロードを妨げないよう次フレームに回す
            setTimeout(() => { if (!this.active) this.renderList(); }, 0);
        }
    }

    // 指定問題の異性体を列挙してキャッシュする。formula は列挙結果から求めて表記を一意にする
    enumerate(index) {
        if (!this._cache.has(index)) {
            const p = this.problems[index];
            const { isomers, overflow } = enumerateConstitutionalIsomers(p.elements, p.hCount, IP_ENUM_LIMIT);
            const formula = isomers.length ? this.game.computeMolecularFormula(isomers[0]) : '';
            this._cache.set(index, { isomers, overflow, formula });
        }
        return this._cache.get(index);
    }

    isCleared(formula) {
        try { return localStorage.getItem('chemIsomerPractice.' + formula) === '1'; }
        catch (e) { return false; }
    }

    // ===== 問題選択 =====
    renderList() {
        if (!this.body) return;
        this.active = false;
        this._pending = [];
        this.body.innerHTML = '';

        const lead = document.createElement('div');
        lead.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.5; margin-bottom:6px;';
        lead.textContent = '分子式を選び、構造異性体を1つずつ描いて登録します。全種そろえたらクリアです。';
        this.body.appendChild(lead);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:6px;';
        this.problems.forEach((p, i) => {
            const data = this.enumerate(i);
            const cleared = this.isCleared(data.formula);
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.style.cssText = 'font-size:12px; padding:7px 6px; text-align:center;' +
                (cleared ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
            btn.textContent = `${data.formula}（${data.isomers.length}種）${cleared ? ' ✓' : ''}`;
            btn.disabled = data.overflow || data.isomers.length === 0;
            btn.addEventListener('click', () => this.start(i));
            grid.appendChild(btn);
        });
        this.body.appendChild(grid);

        // M3: 任意の分子式で練習
        const custom = document.createElement('div');
        custom.style.cssText = 'margin-top:10px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;';
        const clabel = document.createElement('div');
        clabel.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px;';
        clabel.textContent = '任意の分子式で練習（水素以外6個まで）:';
        custom.appendChild(clabel);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:6px;';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '例: C5H10';
        input.style.cssText = 'flex:1 1 0; min-width:0; padding:5px; background:rgba(0,0,0,0.3); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;';
        const go = document.createElement('button');
        go.className = 'view-btn';
        go.style.cssText = 'font-size:12px; padding:6px 10px; white-space:nowrap;';
        go.textContent = '練習する';
        const submit = () => this.startFromFormula(input.value);
        go.addEventListener('click', submit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        row.appendChild(input);
        row.appendChild(go);
        custom.appendChild(row);
        this.body.appendChild(custom);
    }

    // ===== 練習開始 =====
    // 固定問題リストから開始
    start(index) {
        const data = this.enumerate(index);
        if (data.overflow || data.isomers.length === 0) {
            this.game.showToast('この分子式は練習に対応していません。');
            return;
        }
        const p = this.problems[index];
        this.beginSession({ index, elements: p.elements, hCount: p.hCount, formula: data.formula }, data.isomers);
    }

    // 任意の分子式から開始（M3）
    startFromFormula(str) {
        const g = this.game;
        const parsed = this.parseFormula(str);
        if (!parsed) {
            g.showToast('分子式を「C4H10O」のように入力してください（対応: C・H・O・N・Cl・Br・S）。');
            return;
        }
        if (parsed.heavy.length === 0) {
            g.showToast('炭素などの重原子（水素以外）を含む分子式を入力してください。');
            return;
        }
        if (parsed.heavy.length > 6) {
            g.showToast('重原子が多すぎます。水素を除いて6個までが練習の対象です。');
            return;
        }
        const { isomers, overflow } = enumerateConstitutionalIsomers(parsed.heavy, parsed.h, IP_ENUM_LIMIT);
        if (overflow) {
            g.showToast('この分子式は異性体が多すぎて、いまの練習では扱えません。');
            return;
        }
        if (isomers.length === 0) {
            g.showToast('その分子式に当てはまる構造がありません（原子価が合いません）。');
            return;
        }
        if (isomers.length > IP_MAX_ISOMERS) {
            g.showToast(`この分子式は異性体が${isomers.length}種と多すぎて練習に向きません（不飽和度の高い分子式は教科書外の構造も多く含みます）。`);
            return;
        }
        const formula = g.computeMolecularFormula(isomers[0]);
        this.beginSession({ index: -1, elements: parsed.heavy, hCount: parsed.h, formula }, isomers);
    }

    // 分子式文字列を { heavy:[元素…], h:水素数 } に解析する。不正なら null（M3）
    parseFormula(str) {
        if (!str) return null;
        const s = String(str).replace(/\s+/g, '');
        if (!s) return null;
        const supported = new Set(['C', 'H', 'O', 'N', 'Cl', 'Br', 'S']);
        const re = /([A-Z][a-z]?)(\d*)/g;
        const counts = {};
        let m, consumed = 0;
        while ((m = re.exec(s)) !== null) {
            if (m.index !== consumed) return null; // 連続していない＝不正な文字
            consumed += m[0].length;
            const el = m[1];
            const n = m[2] === '' ? 1 : parseInt(m[2], 10);
            if (!supported.has(el)) return null;
            counts[el] = (counts[el] || 0) + n;
        }
        if (consumed !== s.length) return null;
        const heavy = [];
        Object.keys(counts).forEach(el => {
            if (el !== 'H') for (let i = 0; i < counts[el]; i++) heavy.push(el);
        });
        return { heavy, h: counts['H'] || 0 };
    }

    // 問題の異性体集合でセッションを初期化して描画する（固定問題・任意分子式で共用）
    beginSession(meta, isomers) {
        const g = this.game;
        this.problem = { ...meta, total: isomers.length };
        this.targets = new Map(isomers.map(m => [canonicalCode(m), m]));
        this.entries = [];         // 書いた図を順序付きで保持（重複も残す）
        this._hintLevel = 0;       // 段階ヒント（0=非表示, 1=系列内訳, 2=手順）
        this._firstToastShown = false;
        this.closeReview();
        this.active = true;

        // キャンバスを白紙にして描き始められるようにする（元の作図は ↩ で戻せる）
        if (g.userMolecule.atoms.length > 0) g.saveState();
        g.userMolecule = new Molecule();
        g.updateDrawing();

        this.renderSession();
    }

    // 現在の作図を表示用ターゲット（元素＋座標）としてスナップショットする
    snapshotTarget(mol) {
        const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
        return {
            atoms: mol.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
            bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
        };
    }

    // これまでに書いた図のうち、正解集合に含まれる「ちがう種類」の正準コード集合
    uniqueCorrectCodes() {
        return new Set(this.entries.map(e => e.code).filter(code => this.targets.has(code)));
    }

    // ===== 登録 =====
    // 重複も弾かずに保持する（同一性は答え合わせで「①と④は同じ」と見せる＝比較レビューの肝）
    register() {
        if (!this.active) return;
        const g = this.game;
        const heavy = g.userMolecule.atoms.filter(a => a.element !== 'H');
        if (heavy.length === 0) {
            g.showToast('キャンバスに分子を描いてから登録してください。');
            return;
        }
        if (g.countMolecules() > 1) {
            g.showToast('分子が複数あります。1分子ずつ登録してください。');
            return;
        }
        const formula = g.computeMolecularFormula();
        if (formula !== this.problem.formula) {
            g.showToast(`分子式が違います（いまの分子式: ${formula}）。目標は ${this.problem.formula} です。`);
            return;
        }
        const code = canonicalCode(g.userMolecule);
        if (!this.targets.has(code)) {
            // 分子式・価標を満たすなら原理的に列挙集合に含まれるはず。万一の欠落は記録して断る（設計 5章）
            console.error('[IsomerPractice] 分子式は一致するが列挙集合に無い構造:', formula, code);
            g.showToast('この構造は判定できませんでした（開発ログに記録しました）。');
            return;
        }

        const name = g.lookupCompoundName(g.userMolecule);
        this.entries.push({ code, name, target: this.snapshotTarget(g.userMolecule), order: this.entries.length + 1 });

        // キャンバスを消して次の入力へ（↩ で直前の作図に戻せるよう先に saveState）
        g.saveState();
        g.userMolecule = new Molecule();
        g.updateDrawing();

        const unique = this.uniqueCorrectCodes().size;
        if (unique === this.problem.total) {
            try { localStorage.setItem('chemIsomerPractice.' + this.problem.formula, '1'); } catch (e) { /* noop */ }
        }
        if (!this._firstToastShown) {
            this._firstToastShown = true;
            g.showToast('登録しました。キャンバスは消えます（↩で戻せます）。書き終えたら「答え合わせ」で見比べましょう。', 4500, 'success');
        } else if (unique === this.problem.total) {
            g.showToast(`ちがう種類が全 ${this.problem.total} 種そろいました！「答え合わせ」で確認しましょう。`, 3500, 'success');
        } else {
            g.showToast(`登録（${this.entries.length}個目）。ちがう種類はあと ${this.problem.total - unique}。`, 2200, 'success');
        }
        this.renderSession();
    }

    stop() {
        this.closeReview();
        this.active = false;
        this.problem = null;
        this.targets = null;
        this.entries = [];
        this._hintLevel = 0;
        this._firstToastShown = false;
        this.renderList();
    }

    // ===== 練習中の描画（右パネル）=====
    renderSession() {
        if (!this.body || !this.active) return;
        this._pending = [];
        this.body.innerHTML = '';
        const unique = this.uniqueCorrectCodes().size;
        const done = unique === this.problem.total;

        const head = document.createElement('div');
        head.style.cssText = 'font-size:14px; color:#fff; font-weight:bold; margin-bottom:2px;';
        head.textContent = `✏️ ${this.problem.formula} の異性体　ちがう種類 ${unique}/${this.problem.total}`;
        this.body.appendChild(head);

        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:6px;';
        note.textContent = `書いた図 ${this.entries.length}個。同じ形は答え合わせでまとめて確認できます（シス/トランス・鏡像は数えません）。`;
        this.body.appendChild(note);

        // 書き出した図（自分の作図・番号付き）
        if (this.entries.length > 0) {
            const tray = document.createElement('div');
            tray.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(96px,1fr)); gap:6px; margin-bottom:8px;';
            this.entries.forEach(e => {
                const cell = this.makeCell(`${ipMaru(e.order)} ${e.name || '（名称未登録）'}`,
                    { h: 64 }, id => renderMoleculeIntoSvg(this.game, id, e.target));
                tray.appendChild(cell);
            });
            this.body.appendChild(tray);
        } else {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:12px; color:var(--text-secondary); margin-bottom:8px;';
            empty.textContent = 'キャンバスに異性体を1つ描いて「＋この分子を登録」。全部書けたら「答え合わせ」で見比べます。';
            this.body.appendChild(empty);
        }

        // 操作ボタン
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
        const reg = document.createElement('button');
        reg.className = 'primary-btn';
        reg.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px;';
        reg.textContent = '＋この分子を登録';
        reg.addEventListener('click', () => this.register());
        btnRow.appendChild(reg);

        const review = document.createElement('button');
        review.className = 'primary-btn';
        review.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px; background:var(--color-cyan); color:#04121a;' +
            (this.entries.length === 0 ? ' opacity:0.5;' : '');
        review.textContent = done ? '🔍 答え合わせ（全種そろいました）' : '🔍 答え合わせ（並べて比較）';
        review.disabled = this.entries.length === 0;
        review.addEventListener('click', () => this.openReview());
        btnRow.appendChild(review);

        const hint = document.createElement('button');
        hint.className = 'view-btn';
        hint.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        hint.textContent = this._hintLevel >= 2 ? '💡 ヒント（最大）' :
            ['💡 ヒント', '💡 次のヒント（手順）'][this._hintLevel];
        hint.disabled = this._hintLevel >= 2;
        hint.addEventListener('click', () => this.showHint());
        btnRow.appendChild(hint);

        const quit = document.createElement('button');
        quit.className = 'view-btn';
        quit.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        quit.textContent = '練習をやめる';
        quit.addEventListener('click', () => this.stop());
        btnRow.appendChild(quit);
        this.body.appendChild(btnRow);

        if (this._hintLevel > 0) this.renderHintBlock();

        this.flushThumbs();
    }

    // 段階ヒント: 押すたびに1段階進める（1=系列内訳 → 2=書き出し手順。答えは「答え合わせ」で）
    showHint() {
        if (this._hintLevel < 2) this._hintLevel++;
        this.renderSession();
    }

    // 段階ヒント: 1=未発見の系列内訳 / 2=書き出し手順（答え合わせはユーザーが自分で開く）
    renderHintBlock() {
        const uc = this.uniqueCorrectCodes();
        const undiscovered = [...this.targets.entries()]
            .filter(([code]) => !uc.has(code))
            .map(([, mol]) => ({ mol, key: isomerSeriesKey(mol) }));

        const wrap = document.createElement('div');
        wrap.style.cssText = 'border:1px solid var(--neon-purple); border-radius:8px; padding:8px; margin-top:8px; background:rgba(224,176,255,0.06);';

        // レベル1: 系列の内訳
        const head1 = document.createElement('div');
        head1.style.cssText = 'font-size:12px; color:#e0b0ff; font-weight:bold; margin-bottom:4px;';
        head1.textContent = `未発見 ${undiscovered.length}種の内訳（骨格の系列ごと）`;
        wrap.appendChild(head1);

        const bySeries = new Map();
        undiscovered.forEach(u => {
            const label = u.key.seriesLabel;
            bySeries.set(label, (bySeries.get(label) || 0) + 1);
        });
        const list = document.createElement('div');
        list.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.6;';
        [...bySeries.entries()].forEach(([label, n]) => {
            const row = document.createElement('div');
            row.textContent = `・${label} … あと ${n}`;
            list.appendChild(row);
        });
        wrap.appendChild(list);

        // レベル2: 書き出し手順（未発見に含まれる系列の種別ごと）
        if (this._hintLevel >= 2) {
            const cats = new Set(undiscovered.map(u => u.key.category));
            const proc = {
                position: '同じ骨格のまま、-OH やエーテルの -O-（や置換基）の付く位置を、鎖の端から順に一通りずらしてみましょう（対称な位置どうしは同じ分子になります）。',
                sidechain2: '側鎖に炭素を2個使う置き方は3通りあります — ①エチル基を1つ ②メチル基2つを同じ炭素に ③メチル基2つを別の炭素に。',
                unsat_ring: '二重結合の位置ずらしと、環にする案の両方を数えましたか（鎖と環は別の分子です）。',
                branch: '枝（メチル基）の付く位置を、主鎖の端から順にずらしてみましょう（対称な位置は同じ分子）。',
                straight: 'まず炭素をすべて一列につないだ直鎖から書き始めましょう。'
            };
            const head2 = document.createElement('div');
            head2.style.cssText = 'font-size:12px; color:#e0b0ff; font-weight:bold; margin:8px 0 4px;';
            head2.textContent = '書き出しの手順';
            wrap.appendChild(head2);
            const order = ['straight', 'branch', 'sidechain2', 'position', 'unsat_ring'];
            order.filter(c => cats.has(c)).forEach(c => {
                const row = document.createElement('div');
                row.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.6; margin-bottom:4px;';
                row.textContent = '・' + proc[c];
                wrap.appendChild(row);
            });
        }

        this.body.appendChild(wrap);
    }

    // ===== 答え合わせ（並べて比較）: キャンバス領域に大きく重ねて表示 =====
    openReview() {
        if (!this.overlay || !this.active || this.entries.length === 0) return;
        this._reviewing = true;
        this.overlay.classList.remove('hidden');
        this.renderReview();
    }

    closeReview() {
        if (this.overlay) this.overlay.classList.add('hidden');
        this._reviewing = false;
    }

    renderReview() {
        if (!this.overlay) return;
        const g = this.game;
        this._pending = [];
        this.overlay.innerHTML = '';

        const uc = this.uniqueCorrectCodes();
        const byCode = new Map();
        this.entries.forEach(e => {
            if (!byCode.has(e.code)) byCode.set(e.code, []);
            byCode.get(e.code).push(e.order);
        });
        const dupCount = this.entries.length - byCode.size;
        const missing = [...this.targets.keys()].filter(c => !uc.has(c)).length;

        const title = document.createElement('div');
        title.style.cssText = 'font-size:16px; color:#fff; font-weight:bold; margin-bottom:4px;';
        title.textContent = `答え合わせ — ${this.problem.formula} の異性体`;
        this.overlay.appendChild(title);

        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:13px; color:var(--text-secondary); margin-bottom:10px; line-height:1.6;';
        summary.textContent = `あなたが書いた図 ${this.entries.length}個 → ちがう種類 ${uc.size} ／ 全 ${this.problem.total} 種。` +
            `ダブり ${dupCount}個・未発見 ${missing}種。`;
        this.overlay.appendChild(summary);

        // 同じもの同士の指摘（①と④は同じ …）
        const dupGroups = [...byCode.entries()].filter(([, orders]) => orders.length > 1);
        const dupColorOf = new Map();
        dupGroups.forEach(([code], i) => dupColorOf.set(code, IP_DUP_COLORS[i % IP_DUP_COLORS.length]));
        if (dupGroups.length) {
            const dupBox = document.createElement('div');
            dupBox.style.cssText = 'border:1px solid var(--neon-orange); background:rgba(255,159,67,0.08); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; color:var(--neon-orange); line-height:1.7;';
            const h = document.createElement('div');
            h.style.cssText = 'font-weight:bold; margin-bottom:2px;';
            h.textContent = '同じもの（描き方が違っても、つながり方が同じなら同一）:';
            dupBox.appendChild(h);
            dupGroups.forEach(([code, orders]) => {
                const name = this.entries.find(e => e.code === code).name || '（名称未登録）';
                const row = document.createElement('div');
                row.textContent = `・${orders.map(o => ipMaru(o)).join('と')} は同じ ＝ ${name}`;
                dupBox.appendChild(row);
            });
            this.overlay.appendChild(dupBox);
        }

        // セクションA: あなたの書き出し（番号順・自分の作図をそのまま表示）
        const secA = document.createElement('div');
        secA.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
        secA.textContent = 'あなたの書き出し';
        this.overlay.appendChild(secA);

        const galA = document.createElement('div');
        galA.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:8px; margin-bottom:14px;';
        this.entries.forEach(e => {
            const border = dupColorOf.get(e.code) || 'rgba(255,255,255,0.14)';
            const cell = this.makeCell(`${ipMaru(e.order)} ${e.name || '（名称未登録）'}`,
                { h: 108, border, borderWidth: dupColorOf.has(e.code) ? '2px' : '1px' },
                id => renderMoleculeIntoSvg(g, id, e.target));
            galA.appendChild(cell);
        });
        this.overlay.appendChild(galA);

        // セクションB: 標準の書き方と答え（主鎖に番号・系統順）
        const secB = document.createElement('div');
        secB.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
        secB.textContent = '標準の書き方と答え（主鎖に番号・系統順）';
        this.overlay.appendChild(secB);

        const items = [...this.targets.values()].map(m => ({
            mol: m, code: canonicalCode(m), name: this.game.lookupCompoundName(m), key: isomerSeriesKey(m)
        }));
        items.sort((a, b) => {
            for (let i = 0; i < a.key.cmp.length; i++) {
                if (a.key.cmp[i] !== b.key.cmp[i]) return a.key.cmp[i] - b.key.cmp[i];
            }
            return (a.name || '').localeCompare(b.name || '', 'ja');
        });
        const galB = document.createElement('div');
        galB.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(160px,1fr)); gap:8px; margin-bottom:14px;';
        items.forEach(it => {
            const found = uc.has(it.code);
            const label = (it.name || '（名称未登録）') + (found ? ' ✓' : '（未発見）');
            const cell = this.makeCell(label,
                { h: 116, border: found ? 'var(--color-cyan)' : 'var(--neon-orange)',
                  labelColor: found ? 'var(--color-cyan)' : 'var(--neon-orange)' },
                id => this.renderStandardFigure(id, it.mol));
            galB.appendChild(cell);
        });
        this.overlay.appendChild(galB);

        // 操作ボタン
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'position:sticky; bottom:0; display:flex; gap:8px; padding:8px 0 2px; background:linear-gradient(transparent, rgba(6,10,20,0.92) 35%);';
        const back = document.createElement('button');
        back.className = 'primary-btn';
        back.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px;';
        back.textContent = '← 描画に戻る';
        back.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
        btnRow.appendChild(back);
        const quit = document.createElement('button');
        quit.className = 'view-btn';
        quit.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px;';
        quit.textContent = '練習をやめる';
        quit.addEventListener('click', () => this.stop());
        btnRow.appendChild(quit);
        this.overlay.appendChild(btnRow);

        this.flushThumbs();
    }

    // 標準の書き方の図: 主鎖を横一直線にし、主鎖の炭素へ位置番号を振る（環は layoutMolecule）
    renderStandardFigure(svgId, mol) {
        const g = this.game;
        const numbered = ipNumberedLayout(mol);
        let target, order = null, pos = null;
        if (numbered) {
            pos = numbered.pos; order = numbered.order;
            const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
            target = {
                atoms: mol.atoms.map(a => ({ element: a.element, x: pos.get(a.id).x, y: pos.get(a.id).y })),
                bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
            };
        } else {
            layoutMolecule(mol);
            const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
            target = {
                atoms: mol.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
                bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
            };
        }
        renderMoleculeIntoSvg(g, svgId, target);
        if (order) {
            const svg = document.getElementById(svgId);
            const atomsG = svg && svg.querySelector('.quiz-atoms');
            if (atomsG) {
                order.forEach((id, i) => {
                    const p = pos.get(id);
                    const t = document.createElementNS(IP_SVGNS, 'text');
                    t.setAttribute('x', p.x - 3);
                    t.setAttribute('y', p.y + 27);
                    t.setAttribute('fill', 'var(--color-cyan)');
                    t.setAttribute('font-size', '13');
                    t.setAttribute('font-weight', 'bold');
                    t.textContent = String(i + 1);
                    atomsG.appendChild(t);
                });
            }
        }
    }

    // ===== 図セル描画ヘルパー（renderFn は svgId を受け取り自由に描く）=====
    makeCell(labelText, opts, renderFn) {
        const cell = document.createElement('div');
        cell.style.cssText = 'background:rgba(10,14,24,0.85); border:' + (opts.borderWidth || '1px') + ' solid ' +
            (opts.border || 'rgba(255,255,255,0.14)') +
            '; border-radius:8px; padding:3px 3px 5px; text-align:center;';
        const svg = document.createElementNS(IP_SVGNS, 'svg');
        svg.id = 'ip-svg-' + (IsomerPractice._seq = (IsomerPractice._seq || 0) + 1);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', String(opts.h || 78));
        const bondsG = document.createElementNS(IP_SVGNS, 'g');
        bondsG.setAttribute('class', 'quiz-bonds');
        const atomsG = document.createElementNS(IP_SVGNS, 'g');
        atomsG.setAttribute('class', 'quiz-atoms');
        svg.appendChild(bondsG);
        svg.appendChild(atomsG);
        cell.appendChild(svg);
        const label = document.createElement('div');
        label.style.cssText = 'font-size:10px; line-height:1.3; padding:0 2px; color:' + (opts.labelColor || 'var(--text-secondary)') + ';';
        label.textContent = labelText;
        cell.appendChild(label);
        this._pending.push({ svgId: svg.id, render: renderFn });
        return cell;
    }

    flushThumbs() {
        this._pending.forEach(p => {
            try { p.render(p.svgId); }
            catch (e) { console.error('[IsomerPractice] 図の描画に失敗:', e); }
        });
        this._pending = [];
    }
}
