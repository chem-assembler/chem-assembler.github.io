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
