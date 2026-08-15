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
        ['carboxylate', 'カルボン酸の塩'],
        ['ester', 'エステル'],
        // アミドはアルデヒドより先に見る。**findFunctionalGroups が アミド を返すようになる前は
        // アミドが aldehyde として拾われ、この表でも「アルデヒド」に入っていた**（§9.6-2）
        ['amide', 'アミド'],
        ['aldehyde', 'アルデヒド'],
        ['ketone', 'ケトン'],
        ['phenol', 'フェノール類'],
        ['enol', 'エノール（不安定）'],
        ['alcohol3', 'アルコール'],
        ['alcohol2', 'アルコール'],
        ['alcohol1', 'アルコール'],
        ['alcohol0', 'アルコール'],
        ['ether', 'エーテル'],
        ['sulfo', 'スルホン酸'],
        ['sulfonate', 'スルホン酸の塩'],
        ['nitro', 'ニトロ化合物'],
        ['nitrile', 'ニトリル'],
        // アミンは級数ごとに型が分かれている（§9.6-7。3級アミンは以前どの型にも入らず
        // 「分類できない構造」へ落ちていた）。カテゴリの表示は3つとも「アミン」で同じ
        ['amine3', 'アミン'],
        ['amine2', 'アミン'],
        ['amine1', 'アミン'],
        ['aromatic', '芳香族炭化水素'],
        ['cc_triple', 'アルキン（三重結合）'],
        ['cc_double', 'アルケン（二重結合）'],
        // ハロゲン化物はいちばん後ろ。他の官能基があればそちらの名前で呼ぶのが教科書の流儀
        // （クロロ酢酸は「カルボン酸」、クロロシクロヘキサンは「ハロゲン化物」）
        ['halide', 'ハロゲン化物']
    ];
    for (const [type, label] of order) {
        if (types.has(type)) return label;
    }
    // 官能基なし: 環の有無で分ける（環の数 = 結合数 - 原子数 + 1）
    const rings = mol.bonds.length - mol.atoms.length + 1;
    return rings > 0 ? '環式炭化水素' : '鎖式炭化水素';
}

// 標準の分類に載らない構造をまとめる先の見出し（レビュー項目12）
const OUT_OF_SCOPE_LABEL = '分類できない構造（高校範囲外・不安定）';

// 分子を「高校で習う分類」か「そこに載せられない構造」かに分けて返す（レビュー項目12）。
// scope: 'standard' … カルボン酸・エステルなど教科書の分類に当てはまる
//        'outside'  … 過酸化物・エノール形など。理由を reason に入れて折りたたんで見せる
function classifyMolecule(mol) {
    const motifs = findOutOfScopeMotifs(mol);
    if (motifs.length > 0) {
        return { label: OUT_OF_SCOPE_LABEL, scope: 'outside', reason: motifs.map(m => m.label).join('・') };
    }
    return { label: categorizeMolecule(mol), scope: 'standard', reason: '' };
}

// 名称ライブラリの分子をサムネイルに使うための複製。
// **原本をそのまま渡してはいけない**——`layoutMolecule` は座標を書き換えるので、
// 名称照合に使い回されているライブラリの分子の見た目が壊れる。
// 原子IDは複製で振り直されるため、結合は元IDの対応表で張り直す（IDの順序に頼らない）
function copyMoleculeForThumbnail(src) {
    const copy = new Molecule();
    const map = new Map();
    src.atoms.forEach(a => map.set(a.id, copy.addAtom(a.element, a.x, a.y).id));
    src.bonds.forEach(b => copy.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type));
    return copy;
}

// ===== 辞書引き（📚 同じ分子式の異性体を調べる）の門番（DEVELOPMENT.md §7-1h） =====
// 重原子の上限。列挙器は7個から桁が変わる（C₇H₈ で1031種・ブラウザ11秒）
const DICT_MAX_HEAVY = 6;
// **不飽和度の帯は練習側（IP_DOU_GATE_HEAVY / IP_DOU_GATE）と同じものを使う。**
// ただし**同じ根拠ではない**。練習側の根拠は「20種以下に収まる式が1つも無い ＝ 失う式が無い」
// だが、辞書引きに20種上限（IP_MAX_ISOMERS）は無い。こちらの根拠は実測（Node・v982 で計測）:
//   C₆H₁₄(不飽和0) 255ms/5種 ・ C₆H₁₂(1) 810ms/25種 …… 開く
//   C₆H₁₀(2) 2398ms/77種 ・ C₆H₈(3) 5467ms/159種 ・ C₆H₆(4) 7951ms/217種 …… 断る
//   ヘテロ原子入りも同じ帯で跳ねる（C₅H₉N(2) 3115ms/313種・C₄H₅NO(3) 1882ms/1069種）
// ＝ 不飽和度2以上の帯は、数秒待たせたうえ 40〜1000種のサムネイルを描くことになり、
// 「読める答え」にならない。不飽和度1以下はそのまま開く ＝ **練習側が20種超で断る
// C₆H₁₂（25種）も C₅H₁₀O（74種）も、辞書引きでは今までどおり開く**
class LearnView {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('learn-modal');
        this.bodyEl = document.getElementById('learn-body');
        this.titleEl = document.getElementById('learn-title');

        // 分子モーダルの「📚 同じ分子式の異性体を調べる」。**見出しで選んでいる分子**を渡す
        // （分子モーダルを経由せず ?open=isomer から押されたときは、分析対象＝①が返る）
        const btn = document.getElementById('btn-isomers');
        if (btn) btn.addEventListener('click', () =>
            this.showIsomers(this.game.moleculeModalPart ? this.game.moleculeModalPart() : null));
        const close = document.getElementById('btn-learn-close');
        if (close) close.addEventListener('click', () => this.modal.classList.add('hidden'));
    }

    /**
     * 現在の分子と同じ分子式の構造異性体を列挙して表示する。
     *
     * `target`（連結成分1つ）を渡すと**その分子だけ**を調べる。分子モーダルの見出しで
     * 選んだ分子がここへ来る。**これで「分子が複数あります」の門前払いが要らなくなった**
     * （DESIGN_molecule_modal.md §2-3・§5-2。調べる道具が分子を選べなかったのが元の欠陥）。
     * **列挙のロジックは何も変えていない**——見る分子が1つに決まるだけ。
     */
    showIsomers(target) {
        const g = this.game;
        const mol = target || g.userMolecule;
        const heavy = mol.atoms.filter(a => a.element !== 'H');
        if (heavy.length === 0) {
            g.showToast('先に分子を作図するか、名称から呼び出してください。');
            return;
        }
        if (!target && g.countMolecules() > 1) {
            g.showToast('分子が複数あります。1つだけにしてから調べてください。');
            return;
        }
        const elements = heavy.map(a => a.element);
        const hCount = heavy.reduce((s, a) => s + mol.getFreeValency(a.id), 0);
        const formula = g.computeMolecularFormula(mol);

        // ===== 数える前に断る（DEVELOPMENT.md §7-1h） =====
        // ⚠ **列挙に入る前の算術だけで決める。** ここを通してから断ると
        // 「7秒固まったうえで『多すぎるので打ち切りました』」になる（§7-1e と同じアンチパターン）。
        // 断りは**モーダルの中身として**出す（renderCannotCount）——押した先に画面が開く
        // 約束のボタンなので、トーストにすると「押しても何も起きない」に見える
        if (heavy.length > DICT_MAX_HEAVY) {
            this.renderCannotCount(mol, formula,
                `${formula} は水素以外の原子が${heavy.length}個あります。` +
                '骨格の組み合わせは原子が1個増えるごとに跳ね上がるため、数え上げは' +
                `${DICT_MAX_HEAVY}個までを対象にしています` +
                '（7個の C₇H₈ でも1031種あり、数えるだけで10秒以上かかります）。');
            return;
        }
        const dou = ipUnsaturation(elements, hCount);
        if (heavy.length >= IP_DOU_GATE_HEAVY && dou >= IP_DOU_GATE) {
            const satH = ipSaturatedH(elements);
            this.renderCannotCount(mol, formula,
                `${formula} は不飽和度${dou}（飽和形 ${ipFormulaLabel(elements, satH)} より水素が` +
                `${satH - hCount}個少ない）。足りない水素の分だけ環や二重結合を置く場所が要るので、` +
                '分子式だけから作れる骨格は数十〜数百種にふくらみます（C₆H₆ なら217種）。' +
                'そのほとんどは高校化学で名前を扱わない構造で、数え上げにも数秒かかるため、' +
                `水素以外が${IP_DOU_GATE_HEAVY}個以上で不飽和度${IP_DOU_GATE}以上の式は数える前にお断りしています。`);
            return;
        }

        // 列挙は分子式によっては数秒かかる（不飽和度が高いほど組み合わせが増える）。
        // 先にモーダルを開いて「計算中」を出し、描画を1フレーム譲ってから実行する
        this.titleEl.textContent = `${formula} の構造異性体`;
        this.bodyEl.innerHTML = '';
        this.bodyEl.appendChild(this.para('計算中です…', 'font-size:13px; color:var(--text-secondary);'));
        this.modal.classList.remove('hidden');
        setTimeout(() => this.renderIsomers(elements, hCount, mol), 0);
    }

    /**
     * 数えずに断る（辞書引き側の断り方。DEVELOPMENT.md §7-1h）。
     *
     * **練習側（startFromFormula）の断り方は使い回さない。** 帯（重原子6個・不飽和度2）は
     * 同じものを使うが、断り方は入口の性格が違うので別に作ってある:
     *
     * ① **出す場所** …… 練習はトーストでよい（入力欄がその場にあり、別の式を打ち直せる）。
     *    こちらは押せばモーダルが開く約束のボタンなので、断りも**そのモーダルの中身**にする。
     * ② **代替の示し方** …… 練習の「まず水素の多い式で試してください」は**ここでは言えない**。
     *    ユーザーは分子式を選んでいるのではなく、**目の前の分子について聞いている**ので、
     *    式を変えろ＝質問を変えろ、になってしまう。代わりに、列挙せずとも 0ms で出せる
     *    「辞書の在庫」——同じ分子式で名前が登録されている化合物——を並べる。
     *    C₆H₁₂O₆ で グルコース／フルクトース／ガラクトース が出るように、**数え上げの代わりに
     *    なるのは網羅ではなく「名前のついているものだけ」**という線引きを文でも明示する。
     * ③ 練習の20種上限（IP_MAX_ISOMERS）はこちらには持ち込まない（種類が多いこと自体は断る理由にしない）。
     */
    renderCannotCount(mol, formula, reason) {
        this.titleEl.textContent = `${formula} の構造異性体`;
        this.bodyEl.innerHTML = '';
        this.bodyEl.appendChild(this.para(
            'この分子式は、構造異性体の数え上げをしていません。',
            'font-size:14px; color:#fff; font-weight:bold; line-height:1.6;'));
        this.bodyEl.appendChild(this.para(reason,
            'font-size:12px; line-height:1.7; color:var(--text-secondary); margin-top:6px;'));

        // 代わりに出す「辞書の在庫」。1件も無ければ節ごと出さない（空の枠は情報にならない）
        const known = this.sameFormulaCompounds(formula, mol);
        if (known.length > 0) {
            const box = document.createElement('div');
            box.style.cssText = 'background:rgba(255,255,255,0.05); border-radius:6px; padding:8px 10px; margin:10px 0;';
            const head = document.createElement('div');
            head.style.cssText = 'font-size:13px; color:var(--color-cyan); margin-bottom:3px;';
            head.textContent = `同じ分子式で名前が登録されている化合物 … ${known.length} 種類`;
            box.appendChild(head);
            box.appendChild(this.para(
                '数え上げた結果ではありません。このアプリの名称ライブラリに載っているものだけで、' +
                '同じ分子式で書ける構造のすべてではない点に注意してください。',
                'font-size:11px; color:var(--text-secondary); line-height:1.6; margin:4px 0 2px;'));
            box.appendChild(this.isomerGallery(known));
            this.bodyEl.appendChild(box);
        }

        const notes = this.buildNotes(mol);
        if (notes) {
            this.bodyEl.appendChild(this.para('【この分子の学習ポイント】\n' + notes,
                'white-space:pre-line; font-size:12px; line-height:1.7; color:var(--text-secondary); margin-top:8px;'));
        }
        this.drawThumbnails(known);
        this.modal.classList.remove('hidden');
    }

    /**
     * 同じ分子式で名称ライブラリ（stages.json + compounds.json）に登録されている化合物を引く。
     * 分子式→エントリの索引は初回だけ作る（ライブラリは1000件近くあるため）。
     *
     * ⚠ **ここが数えているのは「構造」であって「登録名」ではない。** 正準コード（立体を見ない）で
     * 畳むので、**立体異性体どうしは1つの枠にまとまる**——C₆H₁₂O₆ のピラノース型は
     * グルコース／ガラクトース／マンノースなど10件が同じ構造式に畳まれる。
     * ここは見出しが「構造異性体」である以上それが正しいが、**畳んだ組に「（この分子）」を
     * 付けるときは代表名に付けてはいけない**: α-D-グルコースを描いたのに
     * 「β-D-ガラクトース（この分子）」と出た（ライブラリは立体つきエントリを先に並べるので、
     * 先頭は描いた分子とは限らない）。畳んだ組では「この分子もこの中」と**組への所属**として言い、
     * 名前そのものは代表1件＋件数の注記にとどめる（全部の名前は title に入れて hover で読める）。
     */
    sameFormulaCompounds(formula, mol) {
        const g = this.game;
        if (!this._formulaIndex) {
            this._formulaIndex = new Map();
            g.getCompoundLibrary().forEach(e => {
                if (!e.mol) return;
                const f = g.computeMolecularFormula(e.mol);
                if (!this._formulaIndex.has(f)) this._formulaIndex.set(f, []);
                this._formulaIndex.get(f).push(e);
            });
        }
        const selfCode = canonicalCode(mol);
        const groups = new Map();
        (this._formulaIndex.get(formula) || []).forEach(e => {
            if (!groups.has(e.code)) groups.set(e.code, { names: [], mol: e.mol });
            groups.get(e.code).names.push(e.name);
        });
        const out = [];
        groups.forEach((grp, code) => {
            const isSelf = code === selfCode;
            const collapsed = grp.names.length > 1;
            out.push({
                name: grp.names[0],
                // 畳んだ組は名前に「（この分子）」を付けない（代表名＝描いた分子とは限らない）
                label: collapsed ? grp.names[0] : undefined,
                isSelf,
                reason: '',
                note: collapsed
                    ? `ほか${grp.names.length - 1}件と同じ構造式${isSelf ? '（この分子もこの中）' : ''}`
                    : '',
                title: grp.names.join(' / '),
                mol: copyMoleculeForThumbnail(grp.mol)
            });
        });
        // いま見ている分子を先頭に置く（自分がどこにいるかを探させない）
        out.sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0));
        return out;
    }

    // ギャラリーのサムネイルを描く。**DOMに入った後**に呼ぶこと
    // （renderMoleculeIntoSvg は getElementById で svg を探す）
    drawThumbnails(items) {
        const g = this.game;
        items.forEach(item => {
            layoutMolecule(item.mol);
            const idx = new Map(item.mol.atoms.map((a, i) => [a.id, i]));
            const data = {
                atoms: item.mol.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
                bonds: item.mol.bonds.map(b => ({
                    atom1Index: idx.get(b.atomId1),
                    atom2Index: idx.get(b.atomId2),
                    type: b.type
                }))
            };
            renderMoleculeIntoSvg(g, item.svgId, data);
        });
    }

    renderIsomers(elements, hCount, mol) {
        const g = this.game;
        // ⚠ **節点上限は練習側と同じ IP_ENUM_LIMIT を渡す。** 既定値（60万）のままだと
        // **C₆H₁₄ も C₆H₁₂ も overflow を立てて「打ち切りました」になる**（v982 実測: 既定では
        // ヘキサン 5種・シクロヘキサン類 25種を全部見つけているのに overflow=true で捨てていた）。
        // ＝ 門番の下でも「待たせてから断る」が残っていた。門番があるので、ここへ来るのは
        // 重原子6個・不飽和度1以下（最悪 C₆H₁₂ の441ms・C₅H₁₁N の577ms）だけ
        const { isomers, overflow } = enumerateConstitutionalIsomers(elements, hCount, IP_ENUM_LIMIT);
        this.bodyEl.innerHTML = '';
        // 門番を通ったうえでの打ち切りは、いまの上限では起きない想定の保険。
        // 断り方は数える前に断るときと揃える（同じボタンで断り方が2通りにならないように）
        if (overflow) {
            this.renderCannotCount(mol, g.computeMolecularFormula(mol),
                'この分子式は骨格の組み合わせが多く、全列挙を途中で打ち切りました。' +
                '二重結合や環を含む（水素の少ない）分子式では、異性体の数が急激に増えます。');
            return;
        }

        // 分類ごとに集計し、ライブラリに登録がある異性体は名前を出す。
        // 高校の分類に載らない構造（過酸化物・エノール形など）は別に取り分けて折りたたむ（項目12）
        const byCategory = new Map();
        const outside = [];
        const selfCode = canonicalCode(mol);
        isomers.forEach(iso => {
            const cls = classifyMolecule(iso);
            const item = {
                name: g.lookupCompoundName(iso),
                isSelf: canonicalCode(iso) === selfCode,
                reason: cls.reason,
                mol: iso
            };
            if (cls.scope === 'outside') { outside.push(item); return; }
            if (!byCategory.has(cls.label)) byCategory.set(cls.label, []);
            byCategory.get(cls.label).push(item);
        });

        this.bodyEl.appendChild(this.para(
            `構造異性体は全部で ${isomers.length} 種類です（立体異性体・シス/トランスは数えていません）。` +
            (outside.length
                ? `\nこのうち高校化学の分類に当てはまるのは ${isomers.length - outside.length} 種類で、` +
                  `残り ${outside.length} 種類は不安定・範囲外の構造です（下に分けてあります）。`
                : ''),
            'white-space:pre-line; font-size:14px; color:#fff; font-weight:bold; line-height:1.6;'));

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
                row.appendChild(this.isomerGallery(items));
                list.appendChild(row);
            });
        this.bodyEl.appendChild(list);

        // 分類できない構造は既定でたたんでおく（開くと理由つきで見られる）
        if (outside.length > 0) {
            const det = document.createElement('details');
            det.style.cssText = 'background:rgba(255,159,67,0.07); border:1px solid var(--neon-orange); border-radius:6px; padding:8px 10px; margin-bottom:10px;';
            const sum = document.createElement('summary');
            sum.style.cssText = 'font-size:13px; color:var(--neon-orange); cursor:pointer;';
            sum.textContent = `${OUT_OF_SCOPE_LABEL} … ${outside.length} 種類`;
            det.appendChild(sum);
            det.appendChild(this.para(
                '分子式と価標（結合の手の数）だけを見れば作れますが、高校化学で習う官能基の形に' +
                'あてはまらないか、そのままでは存在しにくい構造です。異性体を数える問題では、ふつうこれらは答えに入れません。',
                'font-size:11px; color:var(--text-secondary); line-height:1.6; margin:6px 0;'));
            det.appendChild(this.isomerGallery(outside, true));
            this.bodyEl.appendChild(det);
        }

        // サムネイルはDOMに入った後に描画する（renderMoleculeIntoSvg は getElementById を使うため）
        this.drawThumbnails([...byCategory.values()].flat().concat(outside));

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

    // 構造式のギャラリー（P9-3b）: 各異性体を自動レイアウトしてサムネイル表示。
    // いま描いている分子はシアンの枠で示す。withReason=true なら分類できない理由も添える（項目12）
    isomerGallery(items, withReason = false) {
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
            // label が指定されていればそれを使う（畳んだ組は「（この分子）」を名前に付けない。
            // 代表名は組の1件目であって、描いた分子そのものとは限らないため）
            label.textContent = item.label !== undefined
                ? item.label
                : (item.name
                    ? item.name + (item.isSelf ? '（この分子）' : '')
                    : (item.isSelf ? '（この分子）' : '（名称未登録）'));
            cell.appendChild(label);
            // 畳んだ件数の注記（辞書引きの断り側で使う。正準コードで畳まれた立体異性体の数）。
            // 全部の名前は title に入れて、はみ出させずに読めるようにする
            if (item.note) {
                const note = document.createElement('div');
                note.style.cssText = 'font-size:9px; color:var(--text-secondary); opacity:0.8; line-height:1.3; padding:0 2px;';
                note.textContent = item.note;
                cell.appendChild(note);
                if (item.title) cell.title = item.title;
            }
            if (withReason && item.reason) {
                const why = document.createElement('div');
                why.style.cssText = 'font-size:10px; color:var(--neon-orange); line-height:1.3; padding:0 2px;';
                why.textContent = item.reason;
                cell.appendChild(why);
            }
            gallery.appendChild(cell);
        });
        return gallery;
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
// **数える前に断るための門番**（DEVELOPMENT.md §7-1d）。
// 列挙の費用を決めるのは重原子の数ではなく **不飽和度（水素の少なさ）**。
// 同じ重原子6個でも C₆H₁₄（不飽和度0）は 49ms・5種で開くのに、
// C₆H₆（不飽和度4）は **2.8秒画面が固まってから**「217種 > 20」で断られていた。
// ベンゼンの分子式は生徒が真っ先に打つので、重い帯は列挙に入る前に弾く。
// 帯の決め方（実測）: 重原子6個・不飽和度2以上は最少でも 77種（C₆H₁₀）で、
// **20種以下に収まる式が無い ＝ いま開ける式を1つも失わない**。重原子5個までは
// 不飽和度4（C₅H₄）でも 40種・130ms なので、そのまま列挙させて数で断る。
const IP_DOU_GATE_HEAVY = 6; // この個数以上の重原子で
const IP_DOU_GATE = 2;       // この不飽和度以上なら、数える前に断る
// **門番の唯一の抜け道**（DEVELOPMENT.md §7-1f・2026-08-07）。
// ベンゼン環を種として置ける式だけは、総当たりを使わない別経路（`enumerateBenzeneRingIsomers`）
// で数えられるので門を通す。**門を緩めるのではなく、門の外に別の道を1本足す**のが要点:
//   ・通る条件は「不飽和度4以上（＝環が入る余地がある）」かつ「種つき列挙が2種以上を返した」
//   ・返らなかった式は**そのまま従来の道へ落ちる**ので、重い式は今までどおり門が断る
// 不飽和度4はベンゼン環そのものの不飽和度（π3本＋環1）。これ未満の式に環は入り得ないので、
// 種つき列挙を呼ぶまでもなく捨てられる（C₆H₁₄ などがここで 0ms で抜ける）
const IP_BENZENE_MIN_DOU = 4;
// 1種しか出ない式（C₇H₈ ＝ トルエンだけ・C₈H₈ ＝ スチレンだけ）は練習にならないので開かない。
// 2種以上あって初めて「書き出して見比べる」練習が成立する
const IP_BENZENE_MIN_ISOMERS = 2;
const IP_HSTEP = 46; // 標準レイアウトの結合長（横方向）
// 不飽和度（環＋π結合の本数）= (2C + 2 + N − H − X)/2。O・S は骨格の自由度を増やさないので数に入らない。
// **列挙する前に費用を見積もれる唯一の材料**（DEVELOPMENT.md §7-1d）
function ipUnsaturation(heavy, h) {
    let c = 0, n = 0, x = 0;
    heavy.forEach(el => {
        if (el === 'C') c++;
        else if (el === 'N') n++;
        else if (el === 'Cl' || el === 'Br') x++;
    });
    return (2 * c + 2 + n - h - x) / 2;
}
// 同じ重原子の並びで不飽和度0になる水素の数（＝飽和形）。断り文で「代わりにこれを試して」と示すのに使う
function ipSaturatedH(heavy) {
    let c = 0, n = 0, x = 0;
    heavy.forEach(el => {
        if (el === 'C') c++;
        else if (el === 'N') n++;
        else if (el === 'Cl' || el === 'Br') x++;
    });
    return 2 * c + 2 + n - x;
}
// 重原子の並び＋水素数 → 表示用の分子式（C,C,C,C,C,C + 6 → C₆H₆）。分子を作らずに書けるのが要点
function ipFormulaLabel(heavy, h) {
    const counts = {};
    heavy.forEach(el => { counts[el] = (counts[el] || 0) + 1; });
    if (h > 0) counts['H'] = h;
    const order = [];
    if (counts['C']) order.push('C');
    if (counts['H']) order.push('H');
    Object.keys(counts).filter(e => e !== 'C' && e !== 'H').sort().forEach(e => order.push(e));
    const sub = (n) => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
    return order.map(e => counts[e] === 1 ? e : e + sub(counts[e])).join('');
}

// **飽和形（不飽和度0）なのに異性体が多すぎる式の断り方**（v951・DEVELOPMENT.md §7-1g）。
// 既定の断り文は「水素の多い式にすると種類は減ります」だが、不飽和度0の式に**それは言えない**
// （C₄H₁₀S₂ はこれ以上水素が増やせない飽和形。実機で嘘の助言が出ていた）。
// 飽和形で多い理由は水素の少なさではなく、**鎖の途中にも端にも入れるヘテロ原子の個数**なので、
// 減らすべきは水素ではなく O・S・N の数。
//
// 減らす1個は下の優先順で選ぶ。**この規則で「必ず種類が減る」ことは全数で確かめてある**
// （不飽和度0・重原子6個以下で20種を超える式は271件あり、271件すべてで減る）。
// ただし**20種以下に収まるとは限らない**ので、断り文は「減ります」までにして開けるとは言わない
const IP_HETERO_DROP_ORDER = ['O', 'N', 'S', 'Cl', 'Br'];
const IP_ELEMENT_NAMES = { O: '酸素', N: '窒素', S: '硫黄', Cl: '塩素', Br: '臭素' };
// 鎖の「途中」に入れる（＝置き場所を増やす）ヘテロ原子と、その見せ方
const IP_INCHAIN_HETERO = { O: ['酸素', '-O-', '-OH'], N: ['窒素', '-NH-', '-NH₂'], S: ['硫黄', '-S-', '-SH'] };

// 丸数字（①②…）。1〜20は Unicode、それ以上は (n) で表す
function ipMaru(n) {
    return (n >= 1 && n <= 20) ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
}
// 答え合わせで「同じもの」グループを色分けする枠色
const IP_DUP_COLORS = ['#ffb454', '#59d0ff', '#b98cff', '#7CFC98', '#ff8ab0'];
// 答え合わせ／進行確認オーバーレイの図サイズ（小・中・大）。col=列の最小幅, h=SVGの高さ
// rowH … **2列対応表（答え合わせ）の1行の高さ**（発注書 C）。左右に並べると縦に伸びる
// （C₄H₁₀O は7行）ので、ギャラリー用の h より詰める。図は viewBox で内容に合わせるため、
// 高さを下げても切れずに小さくなるだけ
const IP_REVIEW_SCALES = {
    sm: { col: 118, h: 92, rowH: 56 },
    md: { col: 172, h: 128, rowH: 104 },
    lg: { col: 244, h: 182, rowH: 168 }
};
// ★ 答え合わせの表の**結果列**の幅（発注書 D・§12-7a）。左端に固定幅で置く ＝
//   一列を上から下へ舐めるだけで出来が分かる。図の大きさ（小/中/大）では変えない
const IP_RESULT_COL = 62;
// ★ 化合物名の文字サイズ（発注書 D の 4）。v1370 は 10px で、**図の中の炭素番号（13px）より
//   小さいという逆転**が起きていた。名前はこの表の主役なので大きくする。
//   ⚠ **小/中/大で変えない** —— 変わるのは「図の大きさ」であって、名前は小でも読めること
const IP_NAME_FONT = { size: '14px', weight: '600' };

// 段階ヒントの段数（W2・DESIGN_isomer_practice.md §13-2）。
// 1=残り数とダブりの組数 / 2=系列の内訳 / 3=書き出しの手順 / 4=重複の組の名指し。
// **1 → 4 の一方向（ラチェット）**で戻らない。段4のあとは答え合わせしか押せない（§15-5）
const IP_HINT_MAX = 4;

/**
 * 主鎖を横一直線に、側鎖を上下に配した座標を返す。
 * 返り値 { order:[主鎖の原子IDを番号順に], pos:Map<id,{x,y}> }。表示専用（座標＝見た目のみ）。
 *
 * ★ **主鎖と番号は `iupacNameDetail(mol).mainChain` だけから取る**（DESIGN_iupac_check.md §3 の場所2）。
 *
 * v147〜v1340 はここが `findLongestCarbonChain` ＋ 独自の向き決め（`ipChooseDirection`）で
 * **3つ目の番号づけ経路**になっていた。「最長の炭素鎖」は IUPAC の主鎖ではない
 * （-OH・多重結合・置換基数の規則が先に来る）ので、**同じ図に出す名前と黙って食い違う**。
 * 実測（標準6問の25異性体）で **2件が別の原子に番号を振っていた** ——
 * `2-メチル-1-プロパノール` と `2-メチルプロペン`。どちらも炭素数は同じなので、
 * 炭素数を突き合わせる検査では1件も捕まらない（IN2 が原子集合で見張っている理由）。
 *
 * 門番（§N-4）: **`iupacNameDetail` が非 null かつ `kind === 'chain'` のときだけ番号を描く。**
 * エーテル（主鎖に番号をつけないのが規則）・環・カルボニル等は null を返し、
 * 呼ぶ側が `layoutMolecule` へ落ちる ＝ 番号なしの標準図になる。
 *
 * ⚠ `mainChain` は**そのまま添字で番号にする**。並べ替えない・逆にしない・最小化し直さない
 */
function ipNumberedLayout(mol) {
    const detail = iupacNameDetail(mol);
    if (!detail || detail.kind !== 'chain' || !detail.mainChain || !detail.mainChain.length) return null;
    const order = detail.mainChain.slice();
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

/**
 * 異性体の書き出し練習（P12-1 → W1 でキャンバス答案用紙化 → W2 でヒント4段とスコア）。
 *
 * ★ **キャンバスそのものが答案用紙**（DESIGN_isomer_practice.md §12）。
 * 「1つ描いて登録」は複数分子を扱えなかった時代の器で、W1 で捨てた。
 * 答案は `game.userMolecule` の**連結成分の集まり**しかなく、登録トレイも
 * スナップショット配列も持たない ＝ **答案の在りかが1つ**。
 *
 * したがって:
 *   - 採点は `grade()` が**答え合わせのたびにゼロから作り直す**（§12-4・§15-5）。
 *     ①②③ は「いま画面に見えている並び」であって答案の identity ではないので、
 *     記録を番号で持つと、先に描いた分子を消した瞬間に採点が入れ替わる
 *   - 断りは「登録の門」ではなく「**採点表**」に出る（§12-2）。書き出しの最中に
 *     キャンバスへ出すのは**個数だけ**で、判定は1つも出さない
 *   - 名前は `game.captionForPart()` の門番が伏せる（§12-3。`IW4`）
 *   - `stop()` はキャンバスに触らない（§12-6）＝ やめても答案は残る
 *
 * ★ W2（§13・§15-5）で進行が**一方向**になった:
 *
 *     ヒント段1 → 段2 → 段3 → 段4 → 答え合わせ（＝ 問題の終わり）
 *
 *   - 段は戻らない・ループしない。段4 のあとはヒントが打ち止めになり、
 *     ボタンが「答え合わせ」に置き換わる（押せないボタンを残さない・§15-5a-3）
 *   - **押した回数 ＝ 到達した段**（§15-5a）。ヒントの中身はキャンバスが変わるたびに
 *     数え直すが、**再表示のために押し直させない**。押し直しが要る作りは
 *     「読み返すだけで減点」＝ ヒントの使用量ではなく記憶力を測ることになる
 *   - ヒントは**積み上がる**（段Nに到達したら 1〜N が並ぶ・§15-5a-2）
 *   - 答え合わせは **1問1回**。押した瞬間の採点表とスコアを凍結する
 *     （`スコア = 正しく描けた種類数 − ヒント到達段数`。下限0・§15-5b）
 */
class IsomerPractice {
    constructor(game) {
        this.game = game;
        this.body = document.getElementById('ip-body');
        this.overlay = document.getElementById('ip-review-overlay'); // 答え合わせ（並べて比較）
        this.active = false;
        this.problem = null;       // { index, elements, hCount, formula, total }
        this.targets = null;       // Map<canonicalCode, isomerMolecule>
        this._cache = new Map();   // index -> { isomers, overflow, formula }
        this._pending = [];        // サムネイル描画の遅延キュー
        // ヒントの状態（W2・§15-5）。**進むのは `nextHint()` だけ**で、表示の開閉では動かない
        this._hintLevel = 0;       // 到達した段（0〜IP_HINT_MAX）。押した回数と必ず一致する
        this._hintOpen = false;    // ヒント欄を開いているか（無料。段は進まない）
        this._finished = false;    // 答え合わせ済み ＝ この問題は終了（1問1回）
        this._finalSheet = null;   // 答え合わせを押した瞬間の採点表（凍結）
        this._finalScore = null;   // 同じ瞬間のスコア（凍結）
        this._reviewing = false;
        this._reviewMode = 'answer';   // 'answer'=答え合わせ / 'progress'=書き出しの確認（答えは伏せる）
        this._reviewScale = 'md';      // 図サイズ 'sm'|'md'|'lg'

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
        // お題選びに戻った ＝ 作業帯の出番は終わり（第3段。stop() もここを通る）
        if (this.game.setPracticeStrip) this.game.setPracticeStrip(null);
        this._pending = [];
        this.body.innerHTML = '';

        const lead = document.createElement('div');
        lead.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.5; margin-bottom:6px;';
        lead.textContent = '分子式を選ぶと、キャンバスが答案用紙になります。構造異性体を並べて描き、「答え合わせ」で採点します。';
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
        // ===== ベンゼン環を種にできる式は、総当たりに入る前にこちらで数える（§7-1f） =====
        // **重原子の上限と不飽和度の門番より前**に置く。C₈H₁₀ は重原子8個・不飽和度4で、
        // どちらの門にも引っかかるが、種つき列挙なら 8ms で4種（エチルベンゼン＋o/m/p-キシレン）
        const seedDou = ipUnsaturation(parsed.heavy, parsed.h);
        if (seedDou >= IP_BENZENE_MIN_DOU) {
            const seed = enumerateBenzeneRingIsomers(parsed.heavy, parsed.h);
            if (seed.applicable && !seed.overflow &&
                seed.isomers.length >= IP_BENZENE_MIN_ISOMERS &&
                seed.isomers.length <= IP_MAX_ISOMERS) {
                const f = g.computeMolecularFormula(seed.isomers[0]);
                // ⚠ aromaticOnly ＝ **全異性体ではなくベンゼン環をもつものだけ**の出題。
                //    見出し・断り書き・登録時の弾き方がこの旗を見て変わる（設計 §11-4）
                this.beginSession(
                    { index: -1, elements: parsed.heavy, hCount: parsed.h, formula: f, aromaticOnly: true },
                    seed.isomers);
                return;
            }
            // 2種未満／多すぎ／打ち切り ＝ 種つきでは扱えない。**従来の道へ落とす**
        }
        if (parsed.heavy.length > 6) {
            g.showToast('重原子が多すぎます。水素を除いて6個までが練習の対象です。');
            return;
        }
        // ⚠ **数える前の門番**（§7-1d）。ここを通すと C₆H₆ で 2.8 秒画面が固まる。
        // 上限（重原子6個）の中でも、不飽和度が高い式は骨格の数が桁違いに増える
        const dou = ipUnsaturation(parsed.heavy, parsed.h);
        if (parsed.heavy.length >= IP_DOU_GATE_HEAVY && dou >= IP_DOU_GATE) {
            const satH = ipSaturatedH(parsed.heavy);
            const here = ipFormulaLabel(parsed.heavy, parsed.h);
            const sat = ipFormulaLabel(parsed.heavy, satH);
            g.showToast(
                `${here} は不飽和度${dou}（飽和形 ${sat} より水素が${satH - parsed.h}個少ない）。` +
                '足りない水素の分だけ環や二重結合を置く場所が要るので、骨格の数が数十〜数百種に跳ね上がります。' +
                `数え上げだけで数秒かかるため、重原子${IP_DOU_GATE_HEAVY}個で不飽和度${IP_DOU_GATE}以上の式は数える前にお断りしています。` +
                `まず ${sat} のように水素の多い式で試してください。`, 9000);
            return;
        }
        const { isomers, overflow } = enumerateConstitutionalIsomers(parsed.heavy, parsed.h, IP_ENUM_LIMIT);
        if (overflow) {
            g.showToast('この分子式は骨格の種類が多すぎて、数え上げを途中で打ち切りました。いまの練習では扱えません。', 6000);
            return;
        }
        if (isomers.length === 0) {
            g.showToast('その分子式に当てはまる構造がありません（原子価が合いません）。');
            return;
        }
        if (isomers.length > IP_MAX_ISOMERS) {
            const here = ipFormulaLabel(parsed.heavy, parsed.h);
            // **飽和形には「水素を増やせ」と言えない**（増やせないので嘘になる）。
            // 不飽和度0の式で多いのは O・S・N の個数のせいなので、そちらを名指しする
            const drop = dou === 0 ? IP_HETERO_DROP_ORDER.find(el => parsed.heavy.includes(el)) : null;
            if (drop) {
                const rest = parsed.heavy.slice();
                rest.splice(rest.indexOf(drop), 1);
                const hint = ipFormulaLabel(rest, ipSaturatedH(rest));
                // 途中に入れるヘテロ（O・N・S）が居ればそれを例に出す。Cl・Br しか無いなら例は出さない
                const inChain = IP_INCHAIN_HETERO[drop];
                g.showToast(
                    `${here} は構造異性体が${isomers.length}種（練習で扱うのは${IP_MAX_ISOMERS}種まで）。` +
                    'この式は不飽和度0 ＝ すでに水素で埋まった飽和形なので、多いのは二重結合や環のせいではありません。' +
                    (inChain
                        ? `${inChain[0]}は鎖の途中（${inChain[1]}）にも端（${inChain[2]}）にも置けるので、その数が増えるほど骨格の置き方が跳ね上がります。`
                        : `${IP_ELEMENT_NAMES[drop]}を付ける位置が増えるほど、骨格の置き方が跳ね上がります。`) +
                    `${hint} のように${IP_ELEMENT_NAMES[drop]}を1つ減らした式で試してください。`, 9000);
                return;
            }
            g.showToast(
                `${here} は構造異性体が${isomers.length}種（練習で扱うのは${IP_MAX_ISOMERS}種まで）。` +
                '水素が少ない式ほど環や二重結合の置き方が増え、教科書では扱わない骨格も混ざります。' +
                '水素の多い式にすると種類は減ります。', 8000);
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
        if (window.alkylPractice && window.alkylPractice.active) window.alkylPractice.stop(); // 同時に1つだけ
        if (window.stereoPractice && window.stereoPractice.active) window.stereoPractice.stop();
        this.problem = { ...meta, total: isomers.length };
        this.targets = new Map(isomers.map(m => [canonicalCode(m), m]));
        this.resetProgress();
        this.closeReview();
        this.active = true;

        // 答案用紙を白紙で配る（元の作図は ↩ で戻せる）。
        // ⚠ 白紙にするのは**始めるとき**だけ。`stop()` は触らない（§12-6）
        if (g.userMolecule.atoms.length > 0) g.saveState();
        g.userMolecule = new Molecule();
        g.updateDrawing();

        this.renderSession();
    }

    // 分子（連結成分）を表示用ターゲット（元素＋座標）に変換する。
    // ⚠ **保存はしない。** 呼ぶたびに「そのときのキャンバス」から作る（§12・W1 の完了条件）
    figureOf(mol) {
        const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
        return {
            atoms: mol.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
            bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
        };
    }

    /**
     * ★ いまのキャンバスを**採点表**にする（設計 §12-2）。**毎回ゼロから作り直す**（§12-4・§15-5）。
     *
     * 返す `rows` の並びと番号は `game.markedMolecules()` が図に振ったものと同じ ＝
     * 「④は C₃H₈O です」と言われた生徒が、図の ④ を見て直せる。
     * ただし**番号は答案の identity ではない**（原子を消すと入れ替わる）ので、
     * 採点の記録はどこにも残さず、呼ばれるたびに `canonicalCode` から組み直す。
     *
     * status:
     *   'ok'      … 正解集合にある（`dup` が true なら既出の描き直し）
     *   'formula' … 分子式が違う（**描きかけもここに入る。責めない文言にする**）
     *   'scope'   … 分子式は合うが対象外（芳香族回。§11-4）
     *   'unknown' … 分子式・価標は合うのに正解集合に無い（列挙エンジンの欠落として記録）
     */
    grade() {
        const g = this.game;
        const { parts, marks } = g.markedMolecules(null);
        const rows = [];
        const seen = new Set();
        parts.forEach(part => {
            if (!part.atoms.some(a => a.element !== 'H')) return; // 水素だけの欠片は数えない
            const mark = marks.get(part) || ipMaru(rows.length + 1);
            const formula = g.computeMolecularFormula(part);
            const row = { part, mark, formula, code: null, status: 'formula', dup: false };
            if (formula === this.problem.formula) {
                row.code = canonicalCode(part);
                if (this.targets.has(row.code)) {
                    row.status = 'ok';
                    row.dup = seen.has(row.code);
                    seen.add(row.code);
                } else if (this.problem.aromaticOnly) {
                    row.status = 'scope';
                } else {
                    // 分子式・価標を満たすなら原理的に列挙集合に含まれるはず。
                    // 万一の欠落は記録する（設計 5章。監査と同じ思想）
                    row.status = 'unknown';
                    console.error('[IsomerPractice] 分子式は一致するが列挙集合に無い構造:', formula, row.code);
                }
            }
            rows.push(row);
        });

        const found = new Set(rows.filter(r => r.status === 'ok').map(r => r.code));
        const dupGroups = [];
        found.forEach(code => {
            const marksOf = rows.filter(r => r.code === code && r.status === 'ok').map(r => r.mark);
            if (marksOf.length > 1) dupGroups.push({ code, marks: marksOf });
        });
        const missing = [...this.targets.keys()].filter(code => !found.has(code));

        // クリア記録は静かに残す（達成の告知＝同一判定になるので答え合わせまで出さない）。
        // ⚠ 鍵は `chemIsomerPractice.<分子式>` のまま**引き継ぐ**（§15-5。基準は変わっていない）。
        //    芳香族回だけは**同じ分子式でも別の出題**なので鍵を分ける
        if (found.size === this.problem.total) {
            const key = 'chemIsomerPractice.' + this.problem.formula + (this.problem.aromaticOnly ? '@ar' : '');
            try { localStorage.setItem(key, '1'); } catch (e) { /* noop */ }
        }
        return { rows, found, dupGroups, missing };
    }

    /** 採点表の1行を人の言葉にする（§12-2 の表。**責めない文言**を守る場所） */
    verdictOf(row) {
        switch (row.status) {
            case 'ok':
                return row.dup ? '同じものをもう一度' : '✓';
            case 'scope':
                // 芳香族回は「分子式は合うが対象外」が**正常に起こる**。
                // 開発者向けの断り文にすると、正しく描けた生徒に不具合の顔を見せてしまう（§11-4）
                return `分子式は合っていますが、この回はベンゼン環をもつ構造だけが対象です`;
            case 'unknown':
                return 'この構造は判定できませんでした（開発ログに記録しました）';
            default:
                return `${row.formula} です（お題は ${this.problem.formula}）`;
        }
    }

    // これまでに描いた図のうち、正解集合に含まれる「ちがう種類」の正準コード集合
    uniqueCorrectCodes() {
        return this.grade().found;
    }

    /** ヒントの段・スコア・終了状態を白紙に戻す（開始とやり直しで共用。取りこぼすと前問の段が残る） */
    resetProgress() {
        this._hintLevel = 0;
        this._hintOpen = false;
        this._finished = false;
        this._finalSheet = null;
        this._finalScore = null;
    }

    stop() {
        this.closeReview();
        this.active = false;
        this.problem = null;
        this.targets = null;
        this.resetProgress();
        // ⚠ **キャンバスに触らない**（§12-6）。答案用紙ではキャンバスが成果物なので、
        //    やめても・学習モードを離れても図は残る ＝ 自由モードで続きを描ける
        this.renderList();
    }

    // ===== 練習中の描画（右パネル）=====
    renderSession() {
        if (!this.body || !this.active) return;
        this._pending = [];
        this.body.innerHTML = '';

        const head = document.createElement('div');
        head.style.cssText = 'font-size:14px; color:#fff; font-weight:bold; margin-bottom:2px;';
        // 書き出し中は「ちがう種類」を出さない（命名・同一判定は答え合わせで）
        // aromaticOnly の回は**出題そのものが違う**（全異性体ではない）ので見出しで必ず断る（設計 §11-4）
        head.textContent = this.problem.aromaticOnly
            ? `✏️ ${this.problem.formula} の芳香族異性体（全 ${this.problem.total} 種）`
            : `✏️ ${this.problem.formula} の異性体（全 ${this.problem.total} 種）`;
        this.body.appendChild(head);

        if (this.problem.aromaticOnly) {
            const scope = document.createElement('div');
            scope.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px;';
            scope.textContent = '※ ベンゼン環をもつ構造だけを数えます（環をもたない異性体は対象外）。';
            this.body.appendChild(scope);
        }

        const drawn = this.drawnCount();
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:6px;';
        // ⚠ **判定は1つも出さない**（§12-2）。書き出しの最中にキャンバスへ出すのは個数だけ
        note.textContent = this._finished
            ? 'この問題は答え合わせを済ませました（採点は1問1回）。同じお題をもう一度解くか、別のお題を選べます。'
            : (drawn > 0
                ? `キャンバスが答案用紙です。いま ${drawn}個 描いてあります（シス/トランス・鏡像は数えません）。`
                : 'キャンバスが答案用紙です。思いつく構造を並べて描き、「答え合わせ」で採点します（シス/トランス・鏡像は数えません）。');
        this.body.appendChild(note);

        if (this._finished) this.body.appendChild(this.scoreBox());

        // 操作ボタン
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';

        if (this._finished) {
            // 終了後に押せるのは「見る」「やり直す」「やめる」だけ。
            // ★ 答え合わせをもう一度採点し直させない（それができるなら答えを見てから直せる）
            const show = document.createElement('button');
            show.className = 'primary-btn';
            show.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px; background:var(--color-cyan); color:#04121a;';
            show.textContent = '🔍 採点結果をもう一度見る';
            show.addEventListener('click', () => this.openReview('answer'));
            btnRow.appendChild(show);

            const again = document.createElement('button');
            again.className = 'view-btn';
            again.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
            again.textContent = '↻ このお題をもう一度';
            again.title = '白紙の答案用紙に戻します（ヒントの段も0に戻ります）';
            again.addEventListener('click', () => this.restartProblem());
            btnRow.appendChild(again);
        } else {
            const review = document.createElement('button');
            review.className = 'primary-btn';
            review.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px; background:var(--color-cyan); color:#04121a;' +
                (drawn === 0 ? ' opacity:0.5;' : '');
            // ★ 代償を押す前に見せる（§15-5a-3）。答え合わせは**問題の終わり**なので、
            //   「名前・同一判定」だけを名乗ると、覗いたつもりで終わらせてしまう
            review.textContent = '🔍 答え合わせ（採点して終了・1問1回）';
            review.disabled = drawn === 0;
            review.title = '押すとその時点の答案を採点し、スコアを出してこの問題を終わります';
            review.addEventListener('click', () => this.finishAnswer());
            btnRow.appendChild(review);

            // ★ **0個でも押せる**（A・v1368）。この面がヒントの置き場所になったので、
            //   「まだ1つも描けなくて行き詰まっている」人こそ開ける必要がある
            const check = document.createElement('button');
            check.className = 'view-btn';
            check.style.cssText = 'flex:1 1 100%; font-size:12px; padding:6px;';
            check.textContent = '🔎 確認・ヒント（自分の図を大きく並べる）';
            check.title = '名前も同一判定も出しません。自分の答案を見比べ、💡ヒントを押す面です（終了しません）';
            check.addEventListener('click', () => this.toggleReview('progress'));
            btnRow.appendChild(check);

            if (this.carriesHintControl('panel')) btnRow.appendChild(this.hintButton());
        }

        const quit = document.createElement('button');
        quit.className = 'view-btn';
        quit.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        quit.textContent = '練習をやめる';
        quit.addEventListener('click', () => this.stop());
        btnRow.appendChild(quit);
        this.body.appendChild(btnRow);

        if (this._hintLevel > 0) {
            if (this._hintOpen) this.renderHintBlock();
            else this.body.appendChild(this.hintReopenButton());
        }

        this.flushThumbs();
        this.renderStrip();
    }

    /**
     * 作業帯（キャンバス下の帯）の1面を張り替える（DESIGN_ribbon_consolidation.md 第3段）。
     * **書き出し練習はキャンバスで手を動かす作業**なので、進み具合と押しものは
     * モーダルの中ではなくキャンバスの上に居る必要がある（同書 §2-3）。
     */
    renderStrip() {
        // ⚠ **`active` は「お題がある」ことを意味しない。** `tests.js` の leaveGuard 検査は
        // 書きかけを偽装するために `ip.active = true` だけを立てる（problem は null のまま）。
        // ここで落ちると、その検査が復元（`ip.active = savedActive`）に到達できず、
        // **以降の全テストが壊れた状態を引き継ぐ**（v679 で実際にそうなった）。
        // 帯を描く条件は「お題があること」で判定する
        if (!this.active || !this.problem) { this.game.setPracticeStrip(null); return; }
        // ⚠ 確認／答え合わせを開いている間は帯を組み直さない（帯は z-index 30 でオーバーレイより上）。
        //   ヒントを確認モードに置いた（A・v1368）ことで、**オーバーレイを開いたまま
        //   `renderSession()` が走る経路**ができた。ここで帯を出すと図の上に居座る。
        //   閉じるときは `closeReview()` が `_reviewing` を下ろしてから呼び直す
        if (this._reviewing) return;
        const drawn = this.drawnCount();
        this._stripDrawn = drawn;
        if (this._finished) {
            // 終了後の帯。**個数ではなくスコア**を出す（数え続けても点は動かない）
            this.game.setPracticeStrip({
                live: this.stripLiveHtml(),
                progress: `${this._finalScore.score}点`,
                actions: [
                    { label: '🔍 結果を見る', primary: true,
                      title: '採点結果（名前・同一判定・未発見・スコア）をもう一度開きます',
                      onClick: () => this.openReview('answer') },
                    { label: '↻ もう一度', title: 'このお題を白紙からもう一度解きます',
                      onClick: () => this.restartProblem() },
                    { label: 'やめる', title: '練習をやめてお題選びに戻ります（図は消えません）',
                      onClick: () => this.stop() }
                ]
            });
            return;
        }
        this.game.setPracticeStrip({
            live: this.stripLiveHtml(),
            // ⚠ **`n/総数` にしない**（§12-2）。分母を出すと「いくつ正解したか」に見えるが、
            //    ここが数えているのは**描いてある図の個数**で、正誤は1つも見ていない
            progress: `${drawn}個`,
            actions: [
                { label: '🔍 答え合わせ', primary: true, disabled: drawn === 0,
                  title: '答案用紙を採点してスコアを出し、この問題を終わります（1問1回）',
                  onClick: () => this.finishAnswer() },
                // ★ **ここがヒントへの入口**（A・v1368・§13-1）。作業帯から1手で確認モードへ入り、
                //   その面の中で 💡 を押す。0個でも押せる ＝ 1つも描けずに行き詰まっている人こそ要る
                { label: '🔎 確認・ヒント',
                  title: '自分の図を大きく並べ、💡ヒントもここで押せます（名前・同一判定は出しません）',
                  onClick: () => this.toggleReview('progress') },
                { label: 'やめる', title: '練習をやめてお題選びに戻ります（図は消えません）',
                  onClick: () => this.stop() }
            ]
        });
    }

    /**
     * キャンバスに描いてある成分（＝答案）の個数。
     * ⚠ **判定を1つもしない**ので `canonicalCode` も名前引きも通らない ＝ 作図のたびに呼んで軽い
     */
    drawnCount() {
        return this.game.splitMolecules()
            .filter(p => p.atoms.some(a => a.element !== 'H')).length;
    }

    /**
     * 帯の左側。**お題と、いま描いてある個数だけ**（§12-2・§13-1「番号のみ・個数のみ。判定はゼロ」）。
     *
     * ⚠ v151 までは「いま: C₄H₁₀　ブタン」と**名前を出していた**。1分子ずつ登録する器では
     * 「いま描いている分子」が1つに決まっていたので成り立っていたが、答案用紙では
     * 指すものが無いうえ、`captionForPart` の門番で伏せた名前を帯から漏らすことになる
     */
    stripLiveHtml() {
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        if (this._finished) {
            const s = this._finalScore;
            return `お題 <b>${esc(this.problem.formula)}</b> — 採点しました ／ ` +
                `<span class="ws-live-ok">スコア ${s.score}点</span> / ${s.total}点満点` +
                `（正しく描けた ${s.raw}種 − ヒント ${s.hints}段）`;
        }
        const n = this.drawnCount();
        return `お題 <b>${esc(this.problem.formula)}</b>${this.problem.aromaticOnly ? '（芳香族）' : ''} の異性体 ` +
            `全 ${this.problem.total} 種 ／ いま <span class="ws-live-ok">${n}個</span> 描いてあります`;
    }

    /**
     * ★ ヒントの段を1つ進める（**この関数だけが減点する**）。
     *
     * 「押した回数 ＝ 到達した段」を保つのが肝（§15-5a）。表示を出し直すために
     * 押させる作りにすると、**読み返すだけで減点**され、「ヒントを使った量」ではなく
     * 記憶力を測ることになる。だから中身の更新は `renderHintBlock` が毎回やり直し、
     * ここは段を上げるときにしか通らない。
     */
    nextHint() {
        if (!this.active || this._finished || this._hintLevel >= IP_HINT_MAX) return;
        this._hintLevel++;
        this._hintOpen = true;
        this.renderHintViews();
    }

    /** ★ **表示のオンオフは段を進めない**（§15-5a-3）。ここに `_hintLevel++` を足してはいけない */
    toggleHintPanel() {
        if (this._hintLevel === 0) return;
        this._hintOpen = !this._hintOpen;
        this.renderHintViews();
    }

    /**
     * ヒントを出している面を全部描き直す（A・v1368）。
     *
     * ヒントは**2つの面に出る**（§13-1）: 確認モードのオーバーレイと、📚学習パネルのカード。
     * 段は `_hintLevel` の1つしか無いので中身は自動的に揃うが、**押した面だけ描き直すと
     * もう一方が古い残り段数を出したまま**になる（受け入れ条件「表示が食い違わない」）。
     * ⚠ 描き直しは**無料**（`nextHint()` だけが段を進める）。ここに `_hintLevel++` を足さないこと
     */
    renderHintViews() {
        this.renderSession();                        // 学習パネル側（閉じていても状態は保つ）
        if (this._reviewing) this.renderReview();    // 確認モードで押したとき
    }

    /**
     * ★ この面にヒントの操作（💡 次のヒント）を置くか（§13-1）。
     *
     * `'progress'`（確認モード）＝ **設計どおりの置き場所**。作業帯から1手で入れるので、
     * 行き詰まっている画面＝キャンバスから 📚学習 を開き直さずに届く。
     * `'panel'`（📚学習 のカード）＝ 同じものを鏡写しに置く（お題選びの流れで押せる）。
     * `'answer'` には置かない —— 答えが出ている面でヒントを売る意味が無い。
     * 終了後（採点済み）はどの面にも置かない（`nextHint()` も同じ門番を持つ）。
     *
     * ⚠ ここを false 固定にすると「ヒントが画面から消える」＝ 直す前の症状に戻る。IW9 が赤くする
     */
    carriesHintControl(face) {
        return this.active && !this._finished && (face === 'panel' || face === 'progress');
    }

    /**
     * ヒントのボタン。★ **押す前に代償を見せる**（§15-5a-3）。
     * 「💡ヒント」とだけ書いてあると、いまの状態を見たいつもりで押して減点される。
     * 段4 まで来たら**押せないボタンを残さず**「答え合わせ」に置き換える。
     */
    hintButton() {
        const b = document.createElement('button');
        b.className = 'view-btn';
        b.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        if (this._hintLevel >= IP_HINT_MAX) {
            b.style.cssText += ' border-color:var(--color-cyan); color:var(--color-cyan);';
            b.textContent = '🔍 答え合わせ（ヒントは打ち止め）';
            b.title = 'ヒントは4段すべて使いました。あとは答え合わせだけです';
            b.addEventListener('click', () => this.finishAnswer());
        } else {
            b.textContent = `💡 次のヒント（あと ${IP_HINT_MAX - this._hintLevel}段・−1点）`;
            b.title = 'ヒントは1→4段の一方向です。段は戻りません。到達した段の数だけスコアが減ります';
            b.addEventListener('click', () => this.nextHint());
        }
        return b;
    }

    /** 閉じたヒント欄を開き直すボタン。**無料**であることを文言で明言する（§15-5a-3） */
    hintReopenButton() {
        const b = document.createElement('button');
        b.className = 'view-btn';
        b.style.cssText = 'width:100%; font-size:12px; padding:6px; margin-top:8px;';
        b.textContent = `💡 ヒント（段1〜${this._hintLevel}）をもう一度開く（無料）`;
        b.title = '開き直しても段は進みません。減点されるのは「次のヒント」を押したときだけです';
        b.addEventListener('click', () => this.toggleHintPanel());
        return b;
    }

    /**
     * ★ ヒントで**重複の組を名指し**してよいか ＝ 最終段に到達したときだけ（§13-3）。
     *
     * 「①と④は同じ」は同一性の判定を1件ぶんタダで渡す行為で、この練習の学習価値の半分は
     * そこを自分で見抜くこと（§1）。**数（段1）と組（段4）を分ける**のが折り合い点なので、
     * ここを true 固定に「親切にした」直しは IW6 が赤くする
     */
    revealsDupPairs() { return this._hintLevel >= IP_HINT_MAX; }

    /**
     * ★ この面が判定（名前・同一判定・未発見の内訳）を出してよいか（§13-1・v402 の線）。
     * 確認モードは**開いただけでは答えが割れない**面。ここを true 固定にする直しも IW6 が赤くする
     */
    showsJudgments() { return this._reviewMode === 'answer'; }

    /** スコア（§15-5b）。**百分率にしない**（難しい問題ほど取りこぼしが軽く見えるため） */
    scoreOf(sheet) {
        const raw = sheet.found.size;   // 正しく描けた**種類数**（ダブりは1種類 ＝ 二重に罰さない）
        return { raw, hints: this._hintLevel, score: Math.max(0, raw - this._hintLevel), total: this.problem.total };
    }

    /** 採点表の出どころ。終了後は**凍結したもの**を返す（答えを見たあとの描き足しで点が動かない） */
    sheetForView() {
        return this._finished && this._finalSheet ? this._finalSheet : this.grade();
    }

    /**
     * ★ 答え合わせの2列対応表の骨格（発注書 C・§12-7）。**行＝1つの異性体**を返す。
     *
     * 返す各行: `{ code, mol, name, key, mine[], result }`
     *   - `mine` … その正解を指した**自分の図の採点行**。0個＝未発見・2個以上＝ダブり
     *   - `result` … **結果列に出す1語**（`'ok'|'dup'|'missing'`。発注書 D・§12-7a）。
     *     ⚠ **画面に出す3つの数はここを数えて作る**（`answerTally`）。別計算にすると
     *     サマリーと行が食い違い、どちらかが古くなっても画面は平然と出る（IW13 の否定対照）
     *
     * ⚠ **対応づけは `canonicalCode` の一致だけで行う。並び順で突き合わせない。**
     *   自分の図の並び（①②③…）はキャンバスの原子順で決まる（§12-4）ので、
     *   未発見が1つ混じるだけで正解の並びとずれる ＝ **左右が別の異性体を指したまま
     *   見た目だけ揃う**という、この表でいちばん危ない壊れ方になる。
     *   `IW11`（否定対照）が、添字で突き合わせる実装に差し替えると赤くなることを見張っている。
     *
     * 描画から切り出してあるのは、この対応づけだけを検査できるようにするため。
     */
    answerPairs(sheet) {
        const rows = [...this.targets.entries()].map(([code, mol]) => ({
            code, mol, name: this.game.lookupCompoundName(mol), key: isomerSeriesKey(mol), mine: []
        }));
        // 系統順（既存の並び方をそのまま踏襲する）
        rows.sort((a, b) => {
            for (let i = 0; i < a.key.cmp.length; i++) {
                if (a.key.cmp[i] !== b.key.cmp[i]) return a.key.cmp[i] - b.key.cmp[i];
            }
            return (a.name || '').localeCompare(b.name || '', 'ja');
        });
        const byCode = new Map(rows.map(r => [r.code, r]));
        sheet.rows.forEach(r => {
            if (r.status !== 'ok' || !r.code) return;   // お題外は表に載せない（表の下の別枠へ）
            const row = byCode.get(r.code);
            if (row) row.mine.push(r);
        });
        // ★ 結果は `mine` の数だけで決まる。**「重複」は間違いではない**（§12-7a）——
        //   その異性体は見つけている（スコアでも1種として数える）ので、赤や✗の側へ寄せない
        rows.forEach(r => { r.result = r.mine.length === 0 ? 'missing' : (r.mine.length > 1 ? 'dup' : 'ok'); });
        return rows;
    }

    /**
     * ★ 表の見出しに出す**結果列の合計**（発注書 D の 5・§12-7a）。
     *
     * ⚠ **引数は `answerPairs()` が返した配列そのもの**で、そこを数える以外のことをしない。
     *   サマリーを別の材料（`sheet.found.size` など）から作ると、行と食い違ったまま
     *   画面は平然と出る ——「重複した1種」を 〇 に数えるかどうかだけで数がずれる。
     *   `IW13`（否定対照）が、`sheet` から作り直す実装に差し替えると赤くなることを見張っている。
     *
     * `ok + dup + missing = total` が**必ず成り立つ**（1行の結果は1つ）。
     */
    answerTally(pairs) {
        const t = { ok: 0, dup: 0, missing: 0, total: pairs.length };
        pairs.forEach(p => { t[p.result]++; });
        t.found = t.ok + t.dup;   // 見つけた種類数（重複も1種として見つけている）
        return t;
    }

    /**
     * お題に数えなかった図（分子式違い・描きかけ・対象外）。**表の下の別枠**に出す。
     * ⚠ 左列が空の行にしてはいけない ——「正解が無い正解」に見える（発注書 C）
     */
    answerExtras(sheet) {
        return sheet.rows.filter(r => r.status !== 'ok');
    }

    /**
     * ★ 答え合わせ ＝ **問題の終わり**（§15-5。1問1回）。
     * 押した瞬間の採点表とスコアを凍結してから開く。
     */
    finishAnswer() {
        if (!this.active || !this.problem) return;
        if (!this._finished) {
            if (this.drawnCount() === 0) return;
            this._finalSheet = this.grade();
            this._finalScore = this.scoreOf(this._finalSheet);
            this._finished = true;
        }
        this.openReview('answer');
    }

    /** 同じお題を白紙からやり直す（終了後の唯一の続き方）。ヒントの段も0に戻る */
    restartProblem() {
        if (!this.problem) return;
        const meta = { ...this.problem };
        delete meta.total;
        this.beginSession(meta, [...this.targets.values()]);
    }

    /** スコアの内訳を出す箱（式をそのまま見せる。§15-5b） */
    scoreBox() {
        const s = this._finalScore;
        const box = document.createElement('div');
        box.style.cssText = 'border:1px solid var(--color-cyan); border-radius:8px; padding:8px 10px; margin-bottom:8px; background:rgba(0,229,255,0.07);';
        const h = document.createElement('div');
        h.style.cssText = 'font-size:15px; color:var(--color-cyan); font-weight:bold;';
        h.textContent = `スコア ${s.score}点 / ${s.total}点満点`;
        box.appendChild(h);
        const d = document.createElement('div');
        d.style.cssText = 'font-size:11px; color:var(--text-secondary); line-height:1.6;';
        d.textContent = `正しく描けた ${s.raw}種 − ヒント ${s.hints}段 ＝ ${s.score}点` +
            `（満点はこのお題の異性体の総数 ${s.total}種。同じものを2回描いても減点はしません）`;
        box.appendChild(d);
        return box;
    }

    // 作図が変わるたびに game.updateDrawing から呼ばれる。
    // ⚠ **作業帯の個数は常時更新する**（第3段）。キャンバスの上にいて常に見える所なので、
    // ここを止めると「進んでいるのか分からない」状態に戻る
    onDrawingChange() {
        // 終了後は数え直さない。**凍結したスコアの表示を、個数のライブ更新で上書きしない**
        if (!this.active || !this.problem || this._reviewing || this._finished) return;
        const n = this.drawnCount();
        // 0個 ⇄ 1個以上をまたぐと「答え合わせ」の押せる／押せないが変わる ＝ 帯ごと組み直す。
        // ⚠ ここを文字の張り替えだけで済ませると、**1つ目を描いてもボタンが灰色のまま**になる
        const study = document.getElementById('study-modal');
        // ★ ヒントを1段でも払っていたら、モーダルが閉じていても組み直す（§15-5a）。
        //   表示中の段は**貼り付いたまま自動更新**でなければならない —— 更新のために
        //   押し直させる作りは「読み返すだけで減点」になる
        if ((study && !study.classList.contains('hidden')) || this._hintLevel > 0) { this.renderSession(); return; }
        if ((n === 0) !== (this._stripDrawn === 0)) { this.renderStrip(); return; }
        this._stripDrawn = n;
        const live = document.getElementById('ws-practice-live');
        if (live) live.innerHTML = this.stripLiveHtml();
        const prog = document.getElementById('ws-practice-progress');
        if (prog) prog.textContent = `${n}個`;
    }

    /**
     * 段階ヒント（W2・§13-2）。**段Nに到達したら 1〜N を並べて出す**（積み上がる・§15-5a-2）。
     *
     * 「いま到達した段だけ」にすると穴が開く: 段4（重複の名指し）まで進んだあとに
     * 重複を直すと、段4 が言うことを失って**画面が空になる** ＝ 払ったものが消える。
     *
     * ⚠ 中身は**そのときのキャンバス**から数え直す（§15-5a。描き進めれば「あと2種」は減る）。
     *   数え直しは無料で、段が進むのは `nextHint()` を押したときだけ
     */
    renderHintBlock() {
        this.body.appendChild(this.buildHintBlock());
    }

    /** ヒントの中身そのもの。**確認モードのオーバーレイと学習パネルが同じものを使う**（A・v1368） */
    buildHintBlock() {
        const sheet = this.sheetForView();
        const uc = sheet.found;
        const undiscovered = [...this.targets.entries()]
            .filter(([code]) => !uc.has(code))
            .map(([, mol]) => ({ mol, key: isomerSeriesKey(mol) }));

        const wrap = document.createElement('div');
        wrap.style.cssText = 'border:1px solid var(--neon-purple); border-radius:8px; padding:8px; margin-top:8px; background:rgba(224,176,255,0.06);';

        // 見出し（到達した段と、無料で畳める閉じるボタン）
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:4px;';
        const cap = document.createElement('div');
        cap.style.cssText = 'font-size:12px; color:#e0b0ff; font-weight:bold;';
        cap.textContent = `💡 ヒント 段${this._hintLevel} / ${IP_HINT_MAX}`;
        bar.appendChild(cap);
        const close = document.createElement('button');
        close.className = 'view-btn';
        close.style.cssText = 'font-size:11px; padding:2px 8px;';
        close.textContent = '閉じる';
        close.title = '閉じても段は戻りません。開き直すのは無料です';
        close.addEventListener('click', () => this.toggleHintPanel());
        bar.appendChild(close);
        wrap.appendChild(bar);

        const line = (text, style) => {
            const row = document.createElement('div');
            row.style.cssText = style || 'font-size:12px; color:var(--text-secondary); line-height:1.6;';
            row.textContent = text;
            wrap.appendChild(row);
            return row;
        };
        const stageHead = (text) => line(text, 'font-size:12px; color:#e0b0ff; font-weight:bold; margin:8px 0 4px;');

        // 段1: あといくつ ＋ **ダブりが何組あるか（数だけ）**。
        // ⚠ どの図とどの図が同じかは段4 まで明かさない（§13-3。「探せ」の合図までが段1の仕事）
        const dupCount = sheet.dupGroups.length;
        line(`あと ${undiscovered.length}種 あります。` +
            (dupCount > 0
                ? `そして、同じものを2回以上描いた組が ${dupCount}組 あります（どれとどれかは言いません）。`
                : 'いまのところ、同じものを2回描いてはいません。'),
            'font-size:12px; color:var(--text-secondary); line-height:1.6;');

        // 段2: どの系列が足りないか
        if (this._hintLevel >= 2) {
            stageHead(`未発見 ${undiscovered.length}種の内訳（骨格の系列ごと）`);
            const bySeries = new Map();
            undiscovered.forEach(u => {
                const label = u.key.seriesLabel;
                bySeries.set(label, (bySeries.get(label) || 0) + 1);
            });
            [...bySeries.entries()].forEach(([label, n]) => line(`・${label} … あと ${n}`));
        }

        // 段3: 書き出し手順（未発見に含まれる系列の種別ごと）
        if (this._hintLevel >= 3) {
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

        // 段4: 重複の**組を名指し**する（最終段）。
        // ⚠ **名前は出さない**（名前まで出すのは答え合わせの面の仕事）。ここで渡すのは
        //   「①と④を見比べろ」まで。同一性を見抜くのはこの練習の芯なので、丸ごとは渡さない
        if (this.revealsDupPairs()) {
            stageHead('同じものを2回描いている組');
            if (sheet.dupGroups.length === 0) {
                line('・いまキャンバスに同じ組はありません。');
            } else {
                sheet.dupGroups.forEach(d => line(`・${d.marks.join('と')} は同じものです（つながり方が同じ ＝ 同じ化合物）。`));
            }
        }

        return wrap;
    }

    // ===== 答え合わせ／書き出しの確認: キャンバス領域に大きく重ねて表示 =====
    // mode: 'answer'=答えも並べる / 'progress'=自分の書き出しだけ（答えは伏せる）
    openReview(mode = 'answer') {
        // ⚠ 「開けるか」を**そのときのキャンバス**で決める（§12。登録トレイはもう無い）
        // 終了後は凍結した結果を開き直せる（キャンバスを消してあっても見られる）
        if (!this.overlay || !this.active || !this.problem) return;
        // ★ 確認モードは**0個でも開く**（A・v1368）。この面がヒントの置き場所（§13-1）なので、
        //   1つも描けずに行き詰まっている人を締め出すと、ヒントへの道がふさがる。
        //   答え合わせ（＝採点して終了）のほうは従来どおり、白紙では開かせない
        if (mode !== 'progress' && !this._finished && this.drawnCount() === 0) return;
        this._reviewMode = mode;
        this._reviewing = true;
        this.overlay.classList.remove('hidden');
        this.overlay.scrollTop = 0;
        // ⚠ 作業帯は答え合わせオーバーレイ（z-index 20）より上（30）にいるので、
        // 畳まないと図の上に帯が居座る。答え合わせ中はキャンバスで手を動かさない ＝ 帯の出番も無い
        this.game.setWorkPane('ws-practice', false);
        this.renderReview();
    }

    closeReview() {
        if (this.overlay) this.overlay.classList.add('hidden');
        this._reviewing = false;
        if (this.active) this.renderStrip();
    }

    // 同じモードのレビューを開いている状態でもう一度呼ばれたら作図に戻る（サムネ再クリック）
    toggleReview(mode) {
        if (this._reviewing && this._reviewMode === mode) {
            this.closeReview();
            this.renderSession();
        } else {
            this.openReview(mode);
        }
    }

    setReviewScale(scale) {
        this._reviewScale = scale;
        this.renderReview();
    }

    renderReview() {
        if (!this.overlay) return;
        const g = this.game;
        const answerMode = this.showsJudgments();
        const sc = IP_REVIEW_SCALES[this._reviewScale] || IP_REVIEW_SCALES.md;
        this._pending = [];
        this.overlay.innerHTML = '';

        // ★ **そのときのキャンバスから作る**（W1 の完了条件）。保存したスナップショットは無い
        //   —— ただし答え合わせで終了したあとだけは、その瞬間に凍結したものを見せる（§15-5）
        const sheet = this.sheetForView();

        // ヘッダー行: タイトル ＋ 図サイズ切替（小/中/大）
        const headRow = document.createElement('div');
        headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; flex-wrap:wrap;';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:16px; color:#fff; font-weight:bold;';
        title.textContent = (answerMode ? '答え合わせ' : '書き出しの確認') +
            ` — ${this.problem.formula}${this.problem.aromaticOnly ? ' の芳香族異性体' : ''}`;
        headRow.appendChild(title);
        const sizeWrap = document.createElement('div');
        sizeWrap.style.cssText = 'display:flex; gap:4px; align-items:center;';
        const sizeLabel = document.createElement('span');
        sizeLabel.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        sizeLabel.textContent = '図の大きさ:';
        sizeWrap.appendChild(sizeLabel);
        [['sm', '小'], ['md', '中'], ['lg', '大']].forEach(([key, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            const on = this._reviewScale === key;
            b.style.cssText = 'font-size:12px; padding:4px 10px;' +
                (on ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => this.setReviewScale(key));
            sizeWrap.appendChild(b);
        });
        headRow.appendChild(sizeWrap);
        this.overlay.appendChild(headRow);

        // モード切替（常時・上部に目立たせる）: 確認 ⇄ 答え合わせ
        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:10px; flex-wrap:wrap;';
        const mLab = document.createElement('span');
        mLab.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        mLab.textContent = '表示:';
        modeRow.appendChild(mLab);
        [['progress', '確認（自分の図だけ）'], ['answer', '答え合わせ（名前・同一判定）']].forEach(([key, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            const on = this._reviewMode === key;
            b.style.cssText = 'font-size:12px; padding:6px 12px;' +
                (on ? ' background:var(--color-cyan); color:#04121a; border-color:var(--color-cyan);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => {
                if (this._reviewMode === key) return;
                this._reviewMode = key;
                this.overlay.scrollTop = 0;
                this.renderReview();
            });
            modeRow.appendChild(b);
        });
        this.overlay.appendChild(modeRow);

        // ★ 集計とスコアは**表の見出し行**に畳んだ（発注書 D の 5・§12-7a）。
        //   別の箱にすると**サマリーと行が食い違える**（片方だけ直して矛盾する事故が起きる）ので、
        //   結果列を数えた値をその列の真上に置く。ここには答え合わせ用の箱をもう置かない
        if (!answerMode) {
            const summary = document.createElement('div');
            summary.style.cssText = 'font-size:13px; color:var(--text-secondary); margin-bottom:10px; line-height:1.6;';
            // 確認モードは図の枚数だけ（自己判断の材料）。命名・同一判定は答え合わせでのみ
            summary.textContent = `あなたが描いた図 ${sheet.rows.length}個（全 ${this.problem.total} 種）。図をクリックすると作図に戻ります。同じかどうか・名前は「答えを見る」で確認できます。`;
            this.overlay.appendChild(summary);
        }

        // ★ 💡ヒント（A・v1368・§13-1「💡ヒントはここに置く」）。
        //   作業帯の `🔎 確認・ヒント` から1手で来られる面なので、**行き詰まった画面から届く**。
        //   図より上に置くのは、スクロールしないと押せないと「無い」のと同じになるため
        if (!answerMode && this.carriesHintControl('progress')) {
            const hintWrap = document.createElement('div');
            hintWrap.id = 'ip-review-hint';
            hintWrap.style.cssText = 'margin-bottom:10px;';
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
            const hb = this.hintButton();
            hb.style.cssText = 'flex:1 1 220px; font-size:13px; padding:8px;';
            row.appendChild(hb);
            hintWrap.appendChild(row);
            if (this._hintLevel > 0) {
                if (this._hintOpen) hintWrap.appendChild(this.buildHintBlock());
                else hintWrap.appendChild(this.hintReopenButton());
            }
            this.overlay.appendChild(hintWrap);
        }

        // ★ 表の上の2つの箱（**未作成の異性体の内訳** ／ **同じもの**）は消した（発注書 D の 1・§12-7a）。
        //   どちらも行の中で同じことを言うので重複していて、合わせて 128px ＝ 画面に入る行が
        //   1つ減っていた。**ダブりの色分けは残す**（表の中で行と図を結ぶのに使う）
        const dupColorOf = new Map();
        if (answerMode) sheet.dupGroups.forEach((d, i) => dupColorOf.set(d.code, IP_DUP_COLORS[i % IP_DUP_COLORS.length]));

        // ★ 答え合わせは **3列の対応表**（発注書 D・§12-7a）、確認モードは自分の図だけのギャラリー。
        //   「表にするのは答え合わせだけ」＝ 確認モードには並べる相手（正解）がそもそも無い
        if (answerMode) {
            this.overlay.appendChild(this.buildAnswerGrid(sheet, sc, dupColorOf));
            // お題に数えなかった図（§12-2 の採点表）は**表の下の別枠**。
            // 左列が空の行にすると「正解が無い正解」に見えるので、表の中には入れない
            const extras = this.answerExtras(sheet);
            if (extras.length) this.overlay.appendChild(this.buildExtrasBox(extras, sc));
        } else {
            // セクションA: あなたの書き出し（番号順・自分の作図をそのまま表示）
            const secA = document.createElement('div');
            secA.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
            secA.textContent = 'あなたの書き出し';
            this.overlay.appendChild(secA);

            const galA = document.createElement('div');
            galA.style.cssText = `display:grid; grid-template-columns:repeat(auto-fill, minmax(${sc.col}px,1fr)); gap:8px; margin-bottom:14px;`;
            sheet.rows.forEach(r => {
                // 名前も同一判定も出さない（確認モードの分担・§13-1）。見出しは番号だけ
                const cell = this.makeCell(r.mark,
                    { h: sc.h, border: 'rgba(255,255,255,0.14)' },
                    id => renderMoleculeIntoSvg(g, id, this.figureOf(r.part)));
                cell.style.cursor = 'pointer';
                cell.title = 'クリックで作図に戻る';
                cell.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
                galA.appendChild(cell);
            });
            this.overlay.appendChild(galA);
        }

        // 操作ボタン
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'position:sticky; bottom:0; display:flex; gap:8px; padding:8px 0 2px; background:linear-gradient(transparent, rgba(6,10,20,0.92) 35%);';
        const back = document.createElement('button');
        back.className = 'primary-btn';
        back.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px;';
        back.textContent = '← 描画に戻る';
        back.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
        btnRow.appendChild(back);
        if (this._finished) {
            const again = document.createElement('button');
            again.className = 'view-btn';
            again.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px;';
            again.textContent = '↻ このお題をもう一度';
            again.title = '白紙の答案用紙に戻します（ヒントの段も0に戻ります）';
            again.addEventListener('click', () => { this.closeReview(); this.restartProblem(); });
            btnRow.appendChild(again);
        }
        const quit = document.createElement('button');
        quit.className = 'view-btn';
        quit.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px;';
        quit.textContent = '練習をやめる';
        quit.addEventListener('click', () => this.stop());
        btnRow.appendChild(quit);
        this.overlay.appendChild(btnRow);

        this.flushThumbs();
    }

    /**
     * ★ 答え合わせの**3列対応表**（発注書 D・§12-7a。もとは2列＝発注書 C・§12-7）。
     *   **1行＝1つの異性体**で、`結果｜正解（標準の書き方・系統順）｜あなたの答え`。
     *
     * - **結果列は左端**。読みの流れ（正解→自分→結果）を採るなら右端だが、この画面で
     *   欲しいのは**走査** ＝ 一列を上から下へ舐めるだけで出来が分かること
     * - 行は flex で `align-items:stretch` ＝ **3つのセルは必ず同じ高さ**になる
     *   （高さを1か所にしか書かない。片方だけ直して崩れる余地を作らない）
     * - **未発見** … 自分の列を「未発見」の枠で空ける（行そのものは消さない）
     * - **ダブり** … 自分の列に ①④ と**並べる**（行の中で「同じものを2つ描いた」と言う）
     * - 対応づけは `answerPairs()` が正準コードで行う（**並び順で突き合わせない**）
     *
     * ⚠ **「重複」は間違いではない**（§12-7a）。スコアはその異性体を1種として数えており、
     *   「同じものを2回描いても減点はしません」と明記している。だから **✗ や赤にしない** ——
     *   誤りに見せると、正しく見つけた人を叱ることになる。`IW12` が色と文言を見張っている。
     *
     * ⚠ 見出しの合計は `answerTally()` が**この配列を数えて**作る。別計算にしない（`IW13`）
     */
    buildAnswerGrid(sheet, sc, dupColorOf) {
        const g = this.game;
        const wrap = document.createElement('div');
        wrap.id = 'ip-answer-grid';
        wrap.style.cssText = 'margin-bottom:12px;';

        // ★ 表とサマリーが同じ配列から出ることを、この2行で担保する
        const pairs = this.answerPairs(sheet);
        wrap.appendChild(this.buildAnswerSummary(this.answerTally(pairs), sheet));

        // 列の見出し（どの列が何かを、表の中で1回だけ言う）
        const head = document.createElement('div');
        head.style.cssText = 'display:flex; gap:6px; margin-bottom:4px;';
        [['結果', `flex:0 0 ${IP_RESULT_COL}px; text-align:center;`],
         ['正解（標準の書き方と答え・系統順）', 'flex:1 1 0; min-width:0;'],
         ['あなたの答え', 'flex:1 1 0; min-width:0;']].forEach(([t, flex]) => {
            const c = document.createElement('div');
            c.style.cssText = flex + ' font-size:12px; color:var(--color-cyan); font-weight:bold;';
            c.textContent = t;
            head.appendChild(c);
        });
        wrap.appendChild(head);

        pairs.forEach((p, i) => {
            const found = p.mine.length > 0;
            const dupColor = p.result === 'dup' ? (dupColorOf.get(p.code) || IP_DUP_COLORS[0]) : null;

            const row = document.createElement('div');
            row.className = 'ip-answer-row';
            // ★ 検査用の手がかり（IW10・IW11 が「左右が同じ異性体を指しているか」・
            //   IW12・IW13 が「結果列とサマリーが合っているか」を読む）
            row.dataset.ipRow = String(i);
            row.dataset.ipCode = p.code;
            row.dataset.ipMarks = p.mine.map(r => r.mark).join('');
            row.dataset.ipResult = p.result;
            row.style.cssText = 'display:flex; gap:6px; align-items:stretch; margin-bottom:6px;';

            row.appendChild(this.resultCell(p.result, dupColor));

            // ★ 名前だけを出す（発注書 D の 3）。`✓` も `（未発見）` も**結果列が言う**ので落とす
            const left = this.makeCell(p.name || '（名称未登録）',
                { h: sc.rowH, border: found ? 'var(--color-cyan)' : 'var(--neon-orange)',
                  labelColor: found ? '#dff9ff' : 'var(--neon-orange)',
                  labelSize: IP_NAME_FONT.size, labelWeight: IP_NAME_FONT.weight },
                id => this.renderStandardFigure(id, p.mol));
            left.style.flex = '1 1 0';
            left.style.minWidth = '0';
            left.dataset.ipSide = 'answer';
            left.dataset.ipName = p.name || '';
            row.appendChild(left);

            const mine = document.createElement('div');
            mine.dataset.ipSide = 'mine';
            mine.style.cssText = 'flex:1 1 0; min-width:0; display:flex; gap:4px; align-items:stretch;';
            if (!found) {
                const empty = document.createElement('div');
                empty.dataset.ipMissing = '1';
                empty.style.cssText = 'flex:1 1 0; display:flex; align-items:center; justify-content:center;' +
                    ' border:1px dashed var(--neon-orange); border-radius:8px; background:rgba(255,159,67,0.06);' +
                    ' color:var(--neon-orange); font-size:12px;';
                empty.textContent = '—';
                mine.appendChild(empty);
            } else {
                p.mine.forEach(r => {
                    // 番号だけ（「（同じ）」は結果列と重複するので落とした）。ダブりは枠の色で結ぶ
                    const cell = this.makeCell(r.mark,
                        { h: sc.rowH, border: dupColor || 'rgba(255,255,255,0.14)',
                          borderWidth: dupColor ? '2px' : '1px', labelSize: '12px' },
                        id => renderMoleculeIntoSvg(g, id, this.figureOf(r.part)));
                    cell.style.flex = '1 1 0';
                    cell.style.minWidth = '0';
                    cell.style.cursor = 'pointer';
                    cell.dataset.ipMark = r.mark;
                    cell.title = 'クリックで作図に戻る';
                    cell.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
                    mine.appendChild(cell);
                });
            }
            row.appendChild(mine);
            wrap.appendChild(row);
        });
        return wrap;
    }

    /**
     * 結果列の1セル（発注書 D の 2）。**〇 / 重複 / 未発見** の3語しか出さない。
     *
     * ⚠ **重複は 〇 と同じシアン系**にする（✗ でも赤でもない）。行の色分けは枠だけに乗せて、
     *   「どの図とどの図が同じか」を表の中で結ぶ役だけをさせる。§12-7a の決定
     */
    resultCell(result, dupColor) {
        const spec = {
            ok:      { text: '〇',     color: 'var(--color-cyan)',   bg: 'rgba(0,229,255,0.12)',   size: '18px', dash: false },
            dup:     { text: '重複',   color: 'var(--color-cyan)',   bg: 'rgba(0,229,255,0.08)',   size: '12px', dash: false },
            missing: { text: '未発見', color: 'var(--neon-orange)',  bg: 'rgba(255,159,67,0.06)',  size: '12px', dash: true }
        }[result];
        const c = document.createElement('div');
        c.dataset.ipResultCell = result;
        c.style.cssText = `flex:0 0 ${IP_RESULT_COL}px; display:flex; align-items:center; justify-content:center;` +
            ` border:${result === 'dup' ? '2px' : '1px'} ${spec.dash ? 'dashed' : 'solid'} ${result === 'dup' ? (dupColor || IP_DUP_COLORS[0]) : spec.color};` +
            ` border-radius:8px; background:${spec.bg}; color:${spec.color};` +
            ` font-size:${spec.size}; font-weight:bold; line-height:1.2; text-align:center;`;
        c.textContent = spec.text;
        return c;
    }

    /**
     * ★ 表の見出しに畳んだサマリー（発注書 D の 5・§12-7a）。**別の箱にしない。**
     *
     * `tally` は `answerTally()` が**結果列を数えて**作ったもの ＝ サマリーと行は
     * 食い違いようがない。ここで `sheet` から数え直すと、その保証がその場で消える。
     *
     * スコアの式（`正しく描けた種数 − ヒント段数`）と満点の説明は**残す** ——
     * 畳んだせいで「なぜその点数か」が読めなくなってはいけない。
     */
    buildAnswerSummary(tally, sheet) {
        const box = document.createElement('div');
        box.id = 'ip-answer-summary';
        box.style.cssText = 'border:1px solid var(--color-cyan); border-radius:8px; padding:6px 10px; margin-bottom:8px; background:rgba(0,229,255,0.07);';

        const top = document.createElement('div');
        top.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap;';
        const counts = document.createElement('div');
        counts.style.cssText = 'font-size:14px; font-weight:bold; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;';
        const head = document.createElement('span');
        head.style.cssText = 'color:var(--text-secondary); font-size:12px; font-weight:normal;';
        head.textContent = `全 ${tally.total}種中`;
        counts.appendChild(head);
        [['ok', `〇 ${tally.ok}種`, 'var(--color-cyan)'],
         ['dup', `重複 ${tally.dup}種`, 'var(--color-cyan)'],
         ['missing', `未発見 ${tally.missing}種`, 'var(--neon-orange)']].forEach(([k, t, col]) => {
            const s = document.createElement('span');
            s.dataset.ipTally = k;      // ★ IW12 がここを読み、結果列を数えた値と突き合わせる
            s.style.color = col;
            s.textContent = t;
            counts.appendChild(s);
        });
        top.appendChild(counts);
        if (this._finished && this._finalScore) {
            const sc = document.createElement('div');
            sc.style.cssText = 'font-size:15px; font-weight:bold; color:var(--color-cyan);';
            sc.textContent = `スコア ${this._finalScore.score}点 / ${this._finalScore.total}点満点`;
            top.appendChild(sc);
        }
        box.appendChild(top);

        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; color:var(--text-secondary); line-height:1.6; margin-top:2px;';
        // 「見つけた種類 ＝ 〇 ＋ 重複」を明示する。**重複も見つけている**ことを数の上で言い切る場所
        const foundLine = `描いた図 ${sheet.rows.length}個 → 見つけた ${tally.found}種（〇 ${tally.ok} ＋ 重複 ${tally.dup}）`;
        note.textContent = (this._finished && this._finalScore)
            ? `${foundLine}。正しく描けた ${this._finalScore.raw}種 − ヒント ${this._finalScore.hints}段 ＝ ${this._finalScore.score}点` +
              `（満点はこのお題の異性体の総数 ${this._finalScore.total}種。同じものを2回描いても減点はしません）`
            : `${foundLine}。同じものを2回描いても減点はしません。`;
        box.appendChild(note);
        return box;
    }

    /**
     * お題に数えなかった図（§12-2 の採点表）＝ **表の下の別枠**。
     * 文言は従来どおり `・③ は C₂H₆O です（お題は C₃H₈O）`（**責めない文言**を守る場所）。
     * 図も一緒に出す ——「どの図のことか」を番号だけで探させない
     */
    buildExtrasBox(extras, sc) {
        const g = this.game;
        const box = document.createElement('div');
        box.id = 'ip-answer-extras';
        box.style.cssText = 'border:1px solid var(--neon-purple); background:rgba(224,176,255,0.08); border-radius:8px; padding:8px 10px; margin-bottom:12px; font-size:13px; line-height:1.7;';
        const h = document.createElement('div');
        h.style.cssText = 'color:#e0b0ff; font-weight:bold; margin-bottom:2px;';
        h.textContent = 'お題に数えなかった図（描きかけもここに入ります）:';
        box.appendChild(h);
        extras.forEach(r => {
            const line = document.createElement('div');
            line.style.color = 'var(--text-secondary)';
            line.textContent = `・${r.mark} は ${this.verdictOf(r)}`;
            box.appendChild(line);
        });
        const gal = document.createElement('div');
        gal.style.cssText = `display:grid; grid-template-columns:repeat(auto-fill, minmax(${sc.col}px,1fr)); gap:8px; margin-top:6px;`;
        extras.forEach(r => {
            const cell = this.makeCell(`${r.mark} ${r.formula}`,
                { h: sc.rowH, border: 'var(--neon-purple)', labelColor: '#e0b0ff' },
                id => renderMoleculeIntoSvg(g, id, this.figureOf(r.part)));
            cell.style.cursor = 'pointer';
            cell.dataset.ipMark = r.mark;
            cell.title = 'クリックで作図に戻る';
            cell.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
            gal.appendChild(cell);
        });
        box.appendChild(gal);
        return box;
    }

    // ⚠ `missingHintBox()`（未作成の異性体を官能基で分けた内訳の箱）は **v1372 で消した**（§12-7a）。
    //    3列表の**結果列**が「未発見」を行ごとに指すので、表の上で同じことをもう一度言っていた。
    //    「まだ描けていないものを分類で束ねて見せる」役はヒントの段2（骨格の系列ごとの内訳）が
    //    持っている ＝ 答え合わせの前に欲しい要約はそちらに残っている

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
        // ★ `labelSize` / `labelWeight` は**図の大きさ（小/中/大）と無関係**に呼び出し側が決める。
        //   3列表の化合物名は 14px/600 固定（IP_NAME_FONT）＝「小」でも名前は読める（§12-7a）
        label.style.cssText = 'font-size:' + (opts.labelSize || '10px') +
            '; font-weight:' + (opts.labelWeight || '400') +
            '; line-height:1.3; padding:0 2px; color:' + (opts.labelColor || 'var(--text-secondary)') + ';';
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

// ===== アルキル基の書き出し練習（P12-3 → W3 でキャンバス答案用紙化）=====
// 「アルキル基 CnH(2n+1)– ＝ 付け根マーカー R を1個付けた分子」として扱い、
// 正準コードで一意判定・列挙し、iupacAlkylNameFromR で命名する。
//
// ★ **キャンバスそのものが答案用紙**（DESIGN_isomer_practice.md §14）。異性体側（W1）と同じ流儀で、
//   「1つ描いて登録」の器は捨てた。答案は `game.userMolecule` の連結成分の集まりしかない。
//
//   - 付け根（C1–R のロック済みペア）は**アプリが置く**（§14-1）。ユーザーには足させない。
//     ユーザーが引くと、R を置き忘れた図が「ただの分子」として答案に混ざる
//   - **最初は1組だけ**。「＋ 答案をもう1つ」で1組ずつ増やす（上限 AK_MAX_SLOTS）。
//     ★ **最初から N 組並べてはいけない** —— 盤面に N 個の枠を置いた時点で
//     「答えは N 個」と教えてしまう。`AK3` がこれを見張っている
//   - 検査の粒度は**成分ごと**（§14-2）。「R がちょうど1個・余分な原子なし・炭素数が目標どおり」を
//     分子全体ではなく答案1枚ごとに見る。`AK4` がこれを見張っている
//   - 名前は `game.captionForPart()` の門番が伏せる（§12-3）。旗は `worksheetActive()` の1つだけ
const AK_MAX_SLOTS = 20;      // 付け根の上限（§14-1。押した回数から答えが漏れないよう十分大きく取る）
const AK_SLOT_COLS = 3;       // 付け根を並べる列数
const AK_SLOT_X0 = 168, AK_SLOT_Y0 = 174, AK_SLOT_DX = 252, AK_SLOT_DY = 168;
const AK_SLOT_FREE = 96;      // この距離以内に既存の原子があるスロットは「埋まっている」とみなす

class AlkylPractice {
    constructor(game) {
        this.game = game;
        this.body = document.getElementById('ak-body');
        this.overlay = document.getElementById('ak-review-overlay');
        this.active = false;
        this.problem = null;   // { n, formula, total }
        this.targets = null;   // Map<canonicalCode, Molecule>
        this._pending = [];
        this._reviewScale = 'md';
        this._reviewing = false;
        this._reviewMode = 'answer';
        this.carbonCounts = [3, 4, 5]; // 2種以上あるものを出題（C3=2, C4=4, C5=8）
        this._cache = new Map();
        if (this.body) setTimeout(() => { if (!this.active) this.renderList(); }, 0);
    }

    enumerate(n) {
        if (!this._cache.has(n)) {
            const els = Array(n).fill('C').concat(['R']);
            const { isomers, overflow } = enumerateConstitutionalIsomers(els, 2 * n + 1, IP_ENUM_LIMIT);
            this._cache.set(n, { isomers, overflow });
        }
        return this._cache.get(n);
    }

    /**
     * 成分の見出し（§14-3）。**`C₄H₉–`** ＝ R を「–」と読ませる。
     * ⚠ これを「分子式」と呼ばない。分子ではなく分子の一部（基）なので、
     *   呼び方を1か所でも間違えると「C₄H₉ という分子がある」と教えることになる
     */
    formulaLabel(n) {
        const sub = v => String(v).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        return `C${sub(n)}H${sub(2 * n + 1)}–`;
    }

    isCleared(n) {
        try { return localStorage.getItem('chemAlkylPractice.C' + n) === '1'; }
        catch (e) { return false; }
    }

    renderList() {
        if (!this.body) return;
        this.active = false;
        // お題選びに戻った ＝ 作業帯の出番は終わり（第3段。stop() もここを通る）
        if (this.game.setPracticeStrip) this.game.setPracticeStrip(null);
        this.problem = null;
        this._pending = [];
        this.closeReview();
        this.body.innerHTML = '';
        const lead = document.createElement('div');
        lead.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.5; margin-bottom:6px;';
        lead.textContent = '炭素数を選ぶと、キャンバスが答案用紙になります。付け根（C1 と結合手 R）はアプリが置くので、そこから炭素を伸ばして基を並べ、「答え合わせ」で採点します。';
        this.body.appendChild(lead);
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:6px;';
        this.carbonCounts.forEach(n => {
            const data = this.enumerate(n);
            const cleared = this.isCleared(n);
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.style.cssText = 'font-size:12px; padding:7px 6px; text-align:center;' +
                (cleared ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
            btn.textContent = `${this.formulaLabel(n)}（${data.isomers.length}種）${cleared ? ' ✓' : ''}`;
            btn.disabled = data.overflow || data.isomers.length === 0;
            btn.addEventListener('click', () => this.start(n));
            grid.appendChild(btn);
        });
        this.body.appendChild(grid);
    }

    start(n) {
        const data = this.enumerate(n);
        if (data.overflow || !data.isomers.length) { this.game.showToast('この炭素数は練習に対応していません。'); return; }
        if (window.isomerPractice && window.isomerPractice.active) window.isomerPractice.stop();
        if (window.stereoPractice && window.stereoPractice.active) window.stereoPractice.stop();
        this.problem = { n, formula: this.formulaLabel(n), total: data.isomers.length };
        this.targets = new Map(data.isomers.map(m => [canonicalCode(m), m]));
        this.active = true;
        this.closeReview();
        const g = this.game;
        // 答案用紙を白紙で配る（元の作図は ↩ で戻せる）。⚠ 白紙にするのは**始めるとき**だけ
        if (g.userMolecule.atoms.length > 0) g.saveState();
        g.userMolecule = new Molecule();
        this.addSlot(true);   // ★ 最初は1組だけ（§14-1）
        this.renderSession();
    }

    // ===== 付け根（答案の枠）=====

    /** スロット i（0 起点）の付け根の置き場所。C1 の座標を返す（R はその 1マス左） */
    slotPos(i) {
        return {
            x: AK_SLOT_X0 + (i % AK_SLOT_COLS) * AK_SLOT_DX,
            y: AK_SLOT_Y0 + Math.floor(i / AK_SLOT_COLS) * AK_SLOT_DY
        };
    }

    /** キャンバスに置いてある付け根（ロックされた R）の個数 ＝ 答案の枠の数 */
    slotCount() {
        return this.game.userMolecule.atoms.filter(a => a.element === 'R' && a.isLocked).length;
    }

    /**
     * ★ 付け根を1組だけ置く（§14-1）。**空いているスロットを探して置く**ので、
     * 先に描いた答案の上に重ねない。置けたら true。
     * @param silent 開始時など、トーストを出さずに置くとき
     */
    addSlot(silent) {
        const g = this.game;
        if (!this.problem) return false;
        if (this.slotCount() >= AK_MAX_SLOTS) {
            if (!silent) g.showToast(`答案の枠は ${AK_MAX_SLOTS} 組までです。`);
            return false;
        }
        const heavy = g.userMolecule.atoms.filter(a => a.element !== 'H');
        let spot = null;
        for (let i = 0; i < AK_MAX_SLOTS * 2 && !spot; i++) {
            const p = this.slotPos(i);
            const clash = heavy.some(a =>
                Math.hypot(a.x - p.x, a.y - p.y) < AK_SLOT_FREE ||
                Math.hypot(a.x - (p.x - GRID_SIZE), a.y - p.y) < AK_SLOT_FREE);
            if (!clash) spot = p;
        }
        if (!spot) {
            if (!silent) g.showToast('答案を置く場所が見つかりませんでした。図を動かして空きを作ってください。');
            return false;
        }
        if (!silent) g.saveState();
        const c1 = g.userMolecule.addAtom('C', spot.x, spot.y);
        const r = g.userMolecule.addAtom('R', spot.x - GRID_SIZE, spot.y);
        c1.isLocked = true;
        r.isLocked = true;
        g.userMolecule.addBond(c1.id, r.id, 1);
        this.scrollSlotIntoView(spot);
        g.updateDrawing();
        if (!silent) {
            this.renderSession();
            g.showToast('答案の枠を1つ増やしました。C1 から炭素を伸ばしてください。', 2200, 'success');
        }
        return true;
    }

    /**
     * 置いたばかりの枠が画面の外なら、そこが見えるところまで**平行移動だけ**する。
     *
     * 枠は行が下へ伸びる（C₅ は8種 ＝ 4行）ので、放っておくと
     * 「＋ 答案をもう1つ」を押しても**何も起きていないように見える**。
     * ⚠ 拡大率は変えない（縮尺を触ると見出しの大きさが焼き直しになる）。
     *   ユーザーが指でパンしたのと同じことをするだけ
     */
    scrollSlotIntoView(spot) {
        const svg = this.game.svg;
        if (!svg || !svg.viewBox || !svg.viewBox.baseVal) return;
        const vb = svg.viewBox.baseVal;
        if (!vb.width || !vb.height) return;
        const pad = 60;
        const x1 = spot.x - GRID_SIZE - pad, x2 = spot.x + pad;
        const y1 = spot.y - pad, y2 = spot.y + pad;
        let moved = false;
        if (x1 < vb.x) { vb.x = x1; moved = true; }
        else if (x2 > vb.x + vb.width) { vb.x = x2 - vb.width; moved = true; }
        if (y1 < vb.y) { vb.y = y1; moved = true; }
        else if (y2 > vb.y + vb.height) { vb.y = y2 - vb.height; moved = true; }
        // 見えている範囲が動いた ＝ 見出しの引き戻しをやり直す（§13-2）
        if (moved && this.game.scheduleLabelResync) this.game.scheduleLabelResync();
    }

    stop() {
        this.closeReview();
        this.active = false;
        this.problem = null;
        this.targets = null;
        // ⚠ **キャンバスに触らない**（§12-6）。やめても答案は残る ＝ 自由モードで続きを描ける
        this.renderList();
    }

    /** 白紙の答案用紙に戻す（枠1つから）。異性体側の「↻ このお題をもう一度」に相当 */
    restartProblem() {
        if (!this.problem) return;
        const g = this.game;
        if (g.userMolecule.atoms.length > 0) g.saveState();
        g.userMolecule = new Molecule();
        this.closeReview();
        this.addSlot(true);
        this.renderSession();
    }

    // 分子（連結成分）を表示用ターゲット（元素＋座標）に変換する。
    // ⚠ **保存はしない。** 呼ぶたびに「そのときのキャンバス」から作る
    figureOf(mol) {
        const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
        return {
            atoms: mol.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
            bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
        };
    }

    /**
     * ★ いまのキャンバスを**採点表**にする（§14-2）。**成分ごとに**見るのが要点。
     *
     * v163〜v1365 の `register()` は同じ4条件を**分子全体**に対して見ていた
     * （`mol.atoms.filter(a => a.element === 'R').length !== 1` ＝ キャンバス全体で R が1個）。
     * 答案用紙では枠が N 組あるので、その物差しでは**2枚目を置いた瞬間に全部落ちる**。
     * ここが W3 の実体で、`AK4` が「分子全体に戻したら赤くする」形で見張っている。
     *
     * status:
     *   'ok'      … 正解集合にある（`dup` が true なら既出の描き直し）
     *   'noroot'  … 付け根（R）が無い／2つ以上ある
     *   'extra'   … 炭素と水素以外の原子が混ざっている
     *   'formula' … 炭素数が目標と違う（**描きかけもここに入る。責めない文言にする**）
     *   'unknown' … 条件は満たすのに正解集合に無い（列挙エンジンの欠落として記録）
     */
    grade() {
        const g = this.game;
        const { parts, marks } = g.markedMolecules(null);
        const rows = [];
        const seen = new Set();
        parts.forEach(part => {
            if (!part.atoms.some(a => a.element !== 'H')) return; // 水素だけの欠片は数えない
            const mark = marks.get(part) || ipMaru(rows.length + 1);
            const rs = part.atoms.filter(a => a.element === 'R');
            const cs = part.atoms.filter(a => a.element === 'C');
            const others = part.atoms.filter(a => a.element !== 'C' && a.element !== 'R' && a.element !== 'H');
            const row = { part, mark, carbons: cs.length, roots: rs.length, code: null, status: 'ok', dup: false };
            if (rs.length !== 1) row.status = 'noroot';
            else if (others.length) row.status = 'extra';
            else if (cs.length !== this.problem.n) row.status = 'formula';
            else {
                row.code = canonicalCode(part);
                if (this.targets.has(row.code)) {
                    row.dup = seen.has(row.code);
                    seen.add(row.code);
                } else {
                    row.status = 'unknown';
                    console.error('[AlkylPractice] 条件は満たすが列挙集合に無い構造:', row.code);
                }
            }
            rows.push(row);
        });

        const found = new Set(rows.filter(r => r.status === 'ok').map(r => r.code));
        const dupGroups = [];
        found.forEach(code => {
            const marksOf = rows.filter(r => r.code === code && r.status === 'ok').map(r => r.mark);
            if (marksOf.length > 1) dupGroups.push({ code, marks: marksOf });
        });
        const missing = [...this.targets.keys()].filter(code => !found.has(code));

        // クリア記録は静かに残す（達成の告知＝同一判定になるので答え合わせまで出さない）
        if (found.size === this.problem.total) {
            try { localStorage.setItem('chemAlkylPractice.C' + this.problem.n, '1'); } catch (e) { /* noop */ }
        }
        return { rows, found, dupGroups, missing };
    }

    /** 採点表の1行を人の言葉にする。**責めない文言**を守る場所 */
    verdictOf(row) {
        switch (row.status) {
            case 'ok':
                return row.dup ? '同じものをもう一度' : '✓';
            case 'noroot':
                // ★ `AK4` が見る文言。付け根が無い成分**だけ**をここで指す
                return row.roots === 0
                    ? '付け根がありません（アルキル基は結合手 R が1つ要ります）'
                    : `付け根（R）が ${row.roots}個 あります（1つにしてください）`;
            case 'extra':
                return 'アルキル基は炭素と水素だけです（ほかの原子が混ざっています）';
            case 'unknown':
                return 'この構造は判定できませんでした（開発ログに記録しました）';
            default:
                return `炭素が ${row.carbons}個 です（お題は ${this.problem.formula} ＝ 炭素${this.problem.n}個）`;
        }
    }

    uniqueCorrectCodes() {
        return this.grade().found;
    }

    /**
     * 手を入れた答案の枚数。**判定を1つもしない**（正誤も同一性も見ない）ので作図のたびに呼んで軽い。
     * 付け根だけの枠（炭素1個）は「まだ手を入れていない」ので数えない
     */
    drawnCount() {
        return this.game.splitMolecules()
            .filter(p => p.atoms.filter(a => a.element === 'C').length >= 2).length;
    }

    // ===== 練習中の描画（右パネル）=====
    renderSession() {
        if (!this.body || !this.active) return;
        this._pending = [];
        this.body.innerHTML = '';

        const head = document.createElement('div');
        head.style.cssText = 'font-size:14px; color:#fff; font-weight:bold; margin-bottom:2px;';
        head.textContent = `✏️ アルキル基 ${this.problem.formula}（全 ${this.problem.total} 種）`;
        this.body.appendChild(head);

        // ★ §14-3: 「これは分子ではない」は**問題カードに常設**する。
        //   トーストで毎回言うと、正しく操作している人を毎回叱ることになる
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--neon-purple); background:rgba(224,176,255,0.08); border-radius:8px; ' +
            'padding:6px 8px; margin:4px 0 6px; font-size:11px; color:var(--text-secondary); line-height:1.6;';
        card.textContent = 'これは分子ではなく、分子の一部（基）です。R は他の原子とつながる手を表します（見出しの「–」がその手）。';
        this.body.appendChild(card);

        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:6px; line-height:1.5;';
        const drawn = this.drawnCount();
        // ⚠ **判定は1つも出さない**。書き出しの最中にキャンバスへ出すのは個数だけ
        note.textContent = drawn > 0
            ? `キャンバスが答案用紙です。いま ${drawn}枠 に炭素を伸ばしてあります。別の基を描くときは「＋ 答案をもう1つ」で枠を増やします。`
            : 'キャンバスが答案用紙です。枠の C1 から炭素を伸ばして基を1つ描き、別の基を描くときは「＋ 答案をもう1つ」で枠を増やします。';
        this.body.appendChild(note);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';

        const add = document.createElement('button');
        add.className = 'primary-btn';
        add.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px;';
        add.textContent = '＋ 答案をもう1つ';
        add.title = '付け根（C1–R）の枠を1組ふやします。何組でも増やせます';
        add.addEventListener('click', () => this.addSlot(false));
        btnRow.appendChild(add);

        const review = document.createElement('button');
        review.className = 'primary-btn';
        review.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px; background:var(--color-cyan); color:#04121a;' +
            (drawn === 0 ? ' opacity:0.5;' : '');
        review.textContent = '🔍 答え合わせ（名前・同一判定）';
        review.disabled = drawn === 0;
        review.addEventListener('click', () => this.openReview('answer'));
        btnRow.appendChild(review);

        const check = document.createElement('button');
        check.className = 'view-btn';
        check.style.cssText = 'flex:1 1 100%; font-size:12px; padding:6px;' + (drawn === 0 ? ' opacity:0.5;' : '');
        check.textContent = '🔎 確認（自分の図を大きく並べる）';
        check.disabled = drawn === 0;
        check.title = '名前も同一判定も出しません。自分の答案を見比べるだけの面です';
        check.addEventListener('click', () => this.toggleReview('progress'));
        btnRow.appendChild(check);

        const reset = document.createElement('button');
        reset.className = 'view-btn';
        reset.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        reset.textContent = '↻ 白紙に戻す';
        reset.title = '答案用紙を白紙にして、枠1つから描き直します';
        reset.addEventListener('click', () => this.restartProblem());
        btnRow.appendChild(reset);

        const quit = document.createElement('button');
        quit.className = 'view-btn';
        quit.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        quit.textContent = '練習をやめる';
        quit.addEventListener('click', () => this.stop());
        btnRow.appendChild(quit);
        this.body.appendChild(btnRow);

        this.flushThumbs();
        this.renderStrip();
    }

    /** 作業帯の1面（第3段）。異性体練習と同じ器を使う ＝ 帯は1つ（§4-2） */
    renderStrip() {
        if (!this.active || !this.problem) { this.game.setPracticeStrip(null); return; }
        const drawn = this.drawnCount();
        this._stripDrawn = drawn;
        this.game.setPracticeStrip({
            live: this.stripLiveHtml(),
            // ⚠ **`n/総数` にしない**。ここが数えているのは手を入れた枠の数で、正誤は1つも見ていない
            progress: `${drawn}枠`,
            actions: [
                { label: '＋ 答案', primary: true, title: '付け根（C1–R）の枠を1組ふやします',
                  onClick: () => this.addSlot(false) },
                { label: '🔍 答え合わせ', disabled: drawn === 0,
                  title: '書いた図を並べて名前と同一判定を見ます',
                  onClick: () => this.openReview('answer') },
                { label: '🔎 確認', disabled: drawn === 0,
                  title: '自分の図を大きく並べます（名前・同一判定は出しません）',
                  onClick: () => this.toggleReview('progress') },
                { label: 'やめる', title: '練習をやめてお題選びに戻ります（図は消えません）',
                  onClick: () => this.stop() }
            ]
        });
    }

    /** 帯の左側。**お題と、手を入れた枠の数だけ**（判定はゼロ） */
    stripLiveHtml() {
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `お題 <b>${esc(this.problem.formula)}</b>（分子ではなく基）全 ${this.problem.total} 種 ／ ` +
            `いま <span class="ws-live-ok">${this.drawnCount()}枠</span> に描いてあります`;
    }

    // 作図が変わるたびに game.updateDrawing から呼ばれる
    onDrawingChange() {
        if (!this.active || !this.problem || this._reviewing) return;
        const n = this.drawnCount();
        const study = document.getElementById('study-modal');
        if (study && !study.classList.contains('hidden')) { this.renderSession(); return; }
        // 0枠 ⇄ 1枠以上をまたぐと「答え合わせ」の押せる／押せないが変わる ＝ 帯ごと組み直す
        if ((n === 0) !== (this._stripDrawn === 0)) { this.renderStrip(); return; }
        this._stripDrawn = n;
        const live = document.getElementById('ws-practice-live');
        if (live) live.innerHTML = this.stripLiveHtml();
        const prog = document.getElementById('ws-practice-progress');
        if (prog) prog.textContent = `${n}枠`;
    }

    // ===== 答え合わせ／確認 =====
    /** この面が判定（名前・同一判定・未発見の内訳）を出してよいか（§13-1・v402 の線） */
    showsJudgments() { return this._reviewMode === 'answer'; }

    openReview(mode = 'answer') {
        if (!this.overlay || !this.active || !this.problem) return;
        if (this.drawnCount() === 0) return;
        this._reviewMode = mode;
        this._reviewing = true;
        this.overlay.classList.remove('hidden');
        this.overlay.scrollTop = 0;
        // 作業帯（z-index 30）は答え合わせオーバーレイ（20）より上なので畳む（第3段）
        this.game.setWorkPane('ws-practice', false);
        this.renderReview();
    }

    closeReview() {
        if (this.overlay) this.overlay.classList.add('hidden');
        this._reviewing = false;
        if (this.active) this.renderStrip();
    }

    toggleReview(mode) {
        if (this._reviewing && this._reviewMode === mode) {
            this.closeReview();
            this.renderSession();
        } else {
            this.openReview(mode);
        }
    }

    setReviewScale(s) { this._reviewScale = s; this.renderReview(); }

    // 列挙分子を表示用ターゲット（座標付き）に変換（layoutMolecule でグリッド整列）
    molToTarget(mol) {
        layoutMolecule(mol);
        const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
        return {
            atoms: mol.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
            bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
        };
    }

    /**
     * 答えの図（§4・場所3）。`renderMoleculeIntoSvg` で描いたあと、
     * **同じ target** を `drawAlkylNumberingIntoSvg` に渡して付け根 C1 からの番号を重ねる。
     * ⚠ 名前（`iupacAlkylNameFromR`）と番号（`iupacAlkylDetailFromR`）は同じ計算から出る（N-6）
     */
    renderAnswerFigure(svgId, target) {
        renderMoleculeIntoSvg(this.game, svgId, target);
        if (this.game.drawAlkylNumberingIntoSvg) this.game.drawAlkylNumberingIntoSvg(svgId, target);
    }

    renderReview() {
        if (!this.overlay || !this.active) return;
        const g = this.game;
        const answerMode = this.showsJudgments();
        const sc = IP_REVIEW_SCALES[this._reviewScale] || IP_REVIEW_SCALES.md;
        this._pending = [];
        this.overlay.innerHTML = '';

        // ★ **そのときのキャンバスから作る**。保存したスナップショットは無い
        const sheet = this.grade();
        const uc = sheet.found;
        const dupCount = sheet.rows.filter(r => r.status === 'ok' && r.dup).length;
        const missing = sheet.missing.length;

        const headRow = document.createElement('div');
        headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; flex-wrap:wrap;';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:16px; color:#fff; font-weight:bold;';
        title.textContent = (answerMode ? '答え合わせ' : '書き出しの確認') + ` — アルキル基 ${this.problem.formula}`;
        headRow.appendChild(title);
        const sizeWrap = document.createElement('div');
        sizeWrap.style.cssText = 'display:flex; gap:4px; align-items:center;';
        [['sm', '小'], ['md', '中'], ['lg', '大']].forEach(([k, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            b.style.cssText = 'font-size:12px; padding:4px 10px;' + (this._reviewScale === k ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => this.setReviewScale(k));
            sizeWrap.appendChild(b);
        });
        headRow.appendChild(sizeWrap);
        this.overlay.appendChild(headRow);

        // モード切替（確認 ⇄ 答え合わせ）
        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:10px; flex-wrap:wrap;';
        const mLab = document.createElement('span');
        mLab.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        mLab.textContent = '表示:';
        modeRow.appendChild(mLab);
        [['progress', '確認（自分の図だけ）'], ['answer', '答え合わせ（名前・同一判定）']].forEach(([key, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            const on = this._reviewMode === key;
            b.style.cssText = 'font-size:12px; padding:6px 12px;' +
                (on ? ' background:var(--color-cyan); color:#04121a; border-color:var(--color-cyan);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => {
                if (this._reviewMode === key) return;
                this._reviewMode = key;
                this.overlay.scrollTop = 0;
                this.renderReview();
            });
            modeRow.appendChild(b);
        });
        this.overlay.appendChild(modeRow);

        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:13px; color:var(--text-secondary); margin-bottom:10px; line-height:1.6;';
        summary.textContent = answerMode
            ? `あなたが描いた図 ${sheet.rows.length}枠 → ちがう種類 ${uc.size} ／ 全 ${this.problem.total} 種。ダブり ${dupCount}個・未発見 ${missing}種。`
            : `あなたが描いた図 ${sheet.rows.length}枠（全 ${this.problem.total} 種）。同じかどうか・名前は「答え合わせ」で確認できます。`;
        this.overlay.appendChild(summary);

        const dupColorOf = new Map();
        if (answerMode) sheet.dupGroups.forEach((d, i) => dupColorOf.set(d.code, IP_DUP_COLORS[i % IP_DUP_COLORS.length]));
        if (answerMode && sheet.dupGroups.length) {
            const dupBox = document.createElement('div');
            dupBox.style.cssText = 'border:1px solid var(--neon-orange); background:rgba(255,159,67,0.08); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; color:var(--neon-orange); line-height:1.7;';
            const h = document.createElement('div');
            h.style.cssText = 'font-weight:bold; margin-bottom:2px;';
            h.textContent = '同じもの（描き方が違っても、つながり方が同じなら同一）:';
            dupBox.appendChild(h);
            sheet.dupGroups.forEach(d => {
                const name = iupacAlkylNameFromR(this.targets.get(d.code)) || '（名称未登録）';
                const row = document.createElement('div');
                row.textContent = `・${d.marks.join('と')} は同じ ＝ ${name}`;
                dupBox.appendChild(row);
            });
            this.overlay.appendChild(dupBox);
        }

        // ★ 採点表（§14-2）: 昔「登録の門」で断っていたものは全部ここに来る。
        //   **成分ごとの検査**なので、付け根の無い1枠だけを指せる（`AK4`）
        const flagged = sheet.rows.filter(r => r.status !== 'ok');
        if (answerMode && flagged.length) {
            const box = document.createElement('div');
            box.style.cssText = 'border:1px solid var(--neon-purple); background:rgba(224,176,255,0.08); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; line-height:1.7;';
            const h = document.createElement('div');
            h.style.cssText = 'color:#e0b0ff; font-weight:bold; margin-bottom:2px;';
            h.textContent = 'お題に数えなかった図（描きかけもここに入ります）:';
            box.appendChild(h);
            flagged.forEach(r => {
                const row = document.createElement('div');
                row.style.color = 'var(--text-secondary)';
                row.textContent = `・${r.mark} は ${this.verdictOf(r)}`;
                box.appendChild(row);
            });
            this.overlay.appendChild(box);
        }

        const secA = document.createElement('div');
        secA.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
        secA.textContent = 'あなたの書き出し';
        this.overlay.appendChild(secA);
        const galA = document.createElement('div');
        galA.style.cssText = `display:grid; grid-template-columns:repeat(auto-fill, minmax(${sc.col}px,1fr)); gap:8px; margin-bottom:14px;`;
        sheet.rows.forEach(r => {
            const dupColor = dupColorOf.get(r.code);
            const border = dupColor || (answerMode && r.status !== 'ok' ? 'var(--neon-purple)' : 'rgba(255,255,255,0.14)');
            // 名前は答え合わせモードのみ（確認モードは番号だけ ＝ §13-1 の面の分担）
            let label = r.mark;
            if (answerMode) {
                label += ' ' + (r.status === 'ok'
                    ? (iupacAlkylNameFromR(r.part) || '（名称未登録）')
                    : this.verdictOf(r));
            }
            const fig = this.figureOf(r.part);
            const cell = this.makeCell(label, { h: sc.h, border, borderWidth: dupColor ? '2px' : '1px' },
                id => renderMoleculeIntoSvg(g, id, fig));
            cell.style.cursor = 'pointer';
            cell.title = 'クリックで作図に戻る';
            cell.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
            galA.appendChild(cell);
        });
        this.overlay.appendChild(galA);

        if (answerMode) {
            const secB = document.createElement('div');
            secB.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
            secB.textContent = '全アルキル基と答え（付け根 C1 から番号）';
            this.overlay.appendChild(secB);
            const items = [...this.targets.values()].map(m => ({ mol: m, code: canonicalCode(m), name: iupacAlkylNameFromR(m) }));
            items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
            const galB = document.createElement('div');
            galB.style.cssText = `display:grid; grid-template-columns:repeat(auto-fill, minmax(${sc.col}px,1fr)); gap:8px; margin-bottom:14px;`;
            items.forEach(it => {
                const found = uc.has(it.code);
                const label = (it.name || '（名称未登録）') + (found ? ' ✓' : '（未発見）');
                const target = this.molToTarget(it.mol);
                const cell = this.makeCell(label,
                    { h: sc.h, border: found ? 'var(--color-cyan)' : 'var(--neon-orange)',
                      labelColor: found ? 'var(--color-cyan)' : 'var(--neon-orange)' },
                    id => this.renderAnswerFigure(id, target));
                galB.appendChild(cell);
            });
            this.overlay.appendChild(galB);
        }

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

    makeCell(labelText, opts, renderFn) {
        const cell = document.createElement('div');
        cell.style.cssText = 'background:rgba(10,14,24,0.85); border:' + (opts.borderWidth || '1px') + ' solid ' +
            (opts.border || 'rgba(255,255,255,0.14)') + '; border-radius:8px; padding:3px 3px 5px; text-align:center;';
        const svg = document.createElementNS(IP_SVGNS, 'svg');
        svg.id = 'ak-svg-' + (AlkylPractice._seq = (AlkylPractice._seq || 0) + 1);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', String(opts.h || 78));
        const bondsG = document.createElementNS(IP_SVGNS, 'g'); bondsG.setAttribute('class', 'quiz-bonds');
        const atomsG = document.createElementNS(IP_SVGNS, 'g'); atomsG.setAttribute('class', 'quiz-atoms');
        svg.appendChild(bondsG); svg.appendChild(atomsG);
        cell.appendChild(svg);
        const label = document.createElement('div');
        label.style.cssText = 'font-size:10px; line-height:1.3; padding:0 2px; color:' + (opts.labelColor || 'var(--text-secondary)') + ';';
        label.textContent = labelText;
        cell.appendChild(label);
        this._pending.push({ svgId: svg.id, render: renderFn });
        return cell;
    }

    flushThumbs() {
        this._pending.forEach(p => { try { p.render(p.svgId); } catch (e) { console.error('[AlkylPractice] 図の描画に失敗:', e); } });
        this._pending = [];
    }
}

// ===== 🪞 立体異性体の書き出し練習（P12-8 M2.5 その4の残り）=====
// 構造式（つながり方）は固定のまま、立体だけがちがう異性体をすべて描いて登録する練習。
// 総数当て（v218・4択）の次の段階＝自分の手で埋める形。
//   - 目標数は countStereoisomers（自己同型で最小化するので、メソ体も環の回転対称も畳み込まれる）
//   - 重複の判定は canonicalStereoCode の一致だけ（座標や描き方には依存しない）
//   - 立体はフィッシャー投影・環（ハース流の上下）・C=C の同側/反対側の「実際に描かれた図」から読む。
//     読めない図（斜めに描いた不斉炭素など）は理由を出して受け付けない
// 答えの図は、お題の図に「1単位だけ反転する操作」を組み合わせて機械生成する。
// 操作後は毎回図から立体を読み直して検証する（生成側の意図を信用しない、の方針どおり）。

// 図データ（atoms/bonds）の隣接リスト
function spAdjOf(target) {
    const adj = target.atoms.map(() => []);
    target.bonds.forEach(b => { adj[b.atom1Index].push(b.atom2Index); adj[b.atom2Index].push(b.atom1Index); });
    return adj;
}

// rootIdx から centerIndex を通らずに届く原子集合（枝サブツリー）
function spBranchOf(adj, centerIndex, rootIdx) {
    const seen = new Set([centerIndex, rootIdx]);
    const stack = [rootIdx], branch = [rootIdx];
    while (stack.length) {
        adj[stack.pop()].forEach(n => { if (!seen.has(n)) { seen.add(n); branch.push(n); stack.push(n); } });
    }
    return branch;
}

// 図を分子にして立体を読み、記述子を「原子の添字」に写して返す（図どうしの比較用）。
// 添字なら createTargetFromData が毎回新しい原子IDを振っても対応が取れる
function spReadByIndex(game, target) {
    const mol = game.createTargetFromData({ target });
    const read = readStereoOf(mol);
    if (!read) return null;
    const idxOf = new Map(mol.atoms.map((a, i) => [a.id, i]));
    const parity = {};
    Object.keys(read.stereo.atomParity).forEach(id => { parity[idxOf.get(id)] = read.stereo.atomParity[id]; });
    const geo = {};
    mol.bonds.forEach(b => {
        const gval = read.stereo.bondGeo[`${b.atomId1}_${b.atomId2}`];
        if (!gval) return;
        const i = idxOf.get(b.atomId1), j = idxOf.get(b.atomId2);
        geo[`${Math.min(i, j)}_${Math.max(i, j)}`] = gval;
    });
    return { mol, read, parity, geo };
}

// 候補図の原子が重なっていないか（fischerOpSwap と同じ 21px 基準）
function spNoOverlap(target) {
    for (let i = 0; i < target.atoms.length; i++) {
        for (let j = i + 1; j < target.atoms.length; j++) {
            if (Math.hypot(target.atoms[i].x - target.atoms[j].x,
                           target.atoms[i].y - target.atoms[j].y) < 21) return false;
        }
    }
    return true;
}

// ni–center の辺を除いても ni から center へ戻れるか（戻れる＝環内の隣接）
function spReturnsToCenter(adj, centerIndex, ni) {
    const seen = new Set([ni]);
    const stack = [ni];
    while (stack.length) {
        const cur = stack.pop();
        for (const nx of adj[cur]) {
            if (cur === ni && nx === centerIndex) continue; // 直接の辺は使わない
            if (nx === centerIndex) return true;
            if (!seen.has(nx)) { seen.add(nx); stack.push(nx); }
        }
    }
    return false;
}

/**
 * 環上の不斉炭素の環外置換基（枝ごと）を上下に反転する（ハース流の面の反転）。
 * その中心のパリティだけが反転した図を返す。検証に失敗したら null。
 */
function spFlipRingSub(game, target, centerIndex) {
    const before = spReadByIndex(game, target);
    if (!before || before.parity[centerIndex] === undefined) return null;
    const adj = spAdjOf(target);
    const center = target.atoms[centerIndex];
    const roots = adj[centerIndex].filter(ni => !spReturnsToCenter(adj, centerIndex, ni));
    if (roots.length !== 1) return null; // 標準的な環立体中心（環外の枝が1本）のみ
    const branch = spBranchOf(adj, centerIndex, roots[0]);
    const atoms = target.atoms.map(a => Object.assign({}, a));
    branch.forEach(idx => {
        atoms[idx].y = Math.round(2 * center.y - target.atoms[idx].y);
        // 面マークがある図は、マークの方が縦位置より優先して読まれるので一緒に裏返す
        if (atoms[idx].haworthFace === 1 || atoms[idx].haworthFace === -1) {
            atoms[idx].haworthFace = -atoms[idx].haworthFace;
        }
    });
    const cand = { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
    if (!spNoOverlap(cand)) return null;
    const after = spReadByIndex(game, cand);
    if (!after || after.read.code !== before.read.code) return null;
    // 反転するのは選んだ中心だけ。他の中心・C=C は不変であること
    const keys = Object.keys(before.parity);
    if (Object.keys(after.parity).length !== keys.length) return null;
    for (const k of keys) {
        const want = (+k === centerIndex) ? -before.parity[k] : before.parity[k];
        if (after.parity[k] !== want) return null;
    }
    if (JSON.stringify(after.geo) !== JSON.stringify(before.geo)) return null;
    return cand;
}

/**
 * C=C の片端の置換基の枝を、二重結合の軸（両端を通る直線）で鏡映する
 * （シス⇄トランスの反転）。その結合の幾何だけが反転した図を返す。検証に失敗したら null。
 */
function spFlipGeoEnd(game, target, i, j) {
    const before = spReadByIndex(game, target);
    const key = `${Math.min(i, j)}_${Math.max(i, j)}`;
    if (!before || before.geo[key] === undefined) return null;
    const A = target.atoms[i], B = target.atoms[j];
    const dx = B.x - A.x, dy = B.y - A.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-6) return null;
    const adj = spAdjOf(target);
    const atoms = target.atoms.map(a => Object.assign({}, a));
    const moved = new Set();
    for (const r of adj[j].filter(n => n !== i)) {
        for (const idx of spBranchOf(adj, j, r)) {
            if (idx === i || moved.has(idx)) return null; // 軸をまたぐ（環）＝対象外
            moved.add(idx);
            const vx = target.atoms[idx].x - A.x, vy = target.atoms[idx].y - A.y;
            const t = (vx * dx + vy * dy) / L2;
            atoms[idx].x = Math.round(2 * (A.x + t * dx) - target.atoms[idx].x);
            atoms[idx].y = Math.round(2 * (A.y + t * dy) - target.atoms[idx].y);
        }
    }
    const cand = { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
    if (!spNoOverlap(cand)) return null;
    const after = spReadByIndex(game, cand);
    if (!after || after.read.code !== before.read.code) return null;
    // 反転するのはこの結合の幾何だけ。不斉中心・他の C=C は不変であること
    if (JSON.stringify(after.parity) !== JSON.stringify(before.parity)) return null;
    const gKeys = Object.keys(before.geo);
    if (Object.keys(after.geo).length !== gKeys.length) return null;
    for (const k of gKeys) {
        const same = after.geo[k] === before.geo[k];
        if (k === key ? same : !same) return null;
    }
    return cand;
}

// 立体の1単位を反転した図を返す（フィッシャー中心は quiz.js の fischerOpSwap を流用）
function spApplyFlip(game, target, unit) {
    if (unit.kind === 'fischer') return fischerOpSwap(game, target, unit.index);
    if (unit.kind === 'ring') return spFlipRingSub(game, target, unit.index);
    return spFlipGeoEnd(game, target, unit.i, unit.j);
}

/**
 * お題の図の立体単位（不斉炭素・C=C）を列挙する。すべての単位が図から読めることを要求し、
 * 読めない単位があれば null（お題の資格なし）。中心はフィッシャーか環かも判別して返す。
 */
function spDetectUnits(game, target) {
    const r = spReadByIndex(game, target);
    if (!r) return null;
    const mol = r.mol;
    const su = stereoUnitsOf(mol);
    const idxOf = new Map(mol.atoms.map((a, i) => [a.id, i]));
    const ringPar = readRingParityFromHaworth(mol);
    const units = [];
    for (const id of su.centers) {
        const ci = idxOf.get(id);
        if (r.parity[ci] === undefined) return null;
        units.push({ kind: ringPar[id] !== undefined ? 'ring' : 'fischer', index: ci });
    }
    for (const [a1, a2] of su.bonds) {
        const i = idxOf.get(a1), j = idxOf.get(a2);
        if (r.geo[`${Math.min(i, j)}_${Math.max(i, j)}`] === undefined) return null;
        units.push({ kind: 'geo', i, j });
    }
    return units;
}

// 乳酸3分子の環状エステル（9員環 [-O-CH(CH₃)-C(=O)-]×3）のお題図。
// ライブラリ未収録のためここで持つ。不斉炭素の -CH₃ は縦（±25°以内）に描き、
// ハース流の面（上=手前/下=奥）として読めるようにする。=O は環の外向き（中心の読みに関与しない）
const SP_LACTIDE_TARGET = (() => {
    const atoms = [], bonds = [];
    const cx = 400, cy = 300, R = 120;
    const angleOf = i => (-130 + i * 40) * Math.PI / 180; // i=1 が真上に来る回し方
    for (let i = 0; i < 9; i++) {
        atoms.push({ element: i % 3 === 0 ? 'O' : 'C',
            x: Math.round(cx + R * Math.cos(angleOf(i))),
            y: Math.round(cy + R * Math.sin(angleOf(i))) });
        bonds.push({ atom1Index: i, atom2Index: (i + 1) % 9, type: 1 });
    }
    // 不斉炭素の -CH₃（縦）。お題は3つとも上（手前）＝ホモキラル体から始める。
    // ここから1中心だけ反転した図は、環の3回回転対称により**どの中心を選んでも同じ分子**になる
    [1, 4, 7].forEach(i => {
        atoms.push({ element: 'C', x: atoms[i].x, y: atoms[i].y - 42 });
        bonds.push({ atom1Index: i, atom2Index: atoms.length - 1, type: 1 });
    });
    [2, 5, 8].forEach(i => { // カルボニルの =O（環の外向き・放射方向）
        atoms.push({ element: 'O',
            x: Math.round(cx + (R + 42) * Math.cos(angleOf(i))),
            y: Math.round(cy + (R + 42) * Math.sin(angleOf(i))) });
        bonds.push({ atom1Index: i, atom2Index: atoms.length - 1, type: 2 });
    });
    return { atoms, bonds };
})();

class StereoIsomerPractice {
    constructor(game) {
        this.game = game;
        this.body = document.getElementById('sp-body');
        this.overlay = document.getElementById('sp-review-overlay');
        this.active = false;
        this.problem = null;    // { index, key, label, target, code, formula, units, info, variants, byCode, total }
        this.entries = [];      // { code, name, target, order }
        this._cache = new Map();
        this._pending = [];
        this._reviewing = false;
        this._reviewMode = 'answer';
        this._reviewScale = 'md';
        this._firstToastShown = false;

        // お題（HANDOFF: 2ⁿ ではない題材＝メソ体と環の回転対称を必ず混ぜる）
        this.problems = [
            { key: 'butene', label: '2-ブテン', compound: 'シス-2-ブテン', foldNote: null },
            { key: 'lactic', label: '乳酸', compound: 'D-乳酸', foldNote: null },
            { key: 'tartaric', label: '酒石酸', compound: '酒石酸',
              foldNote: '2つの中心を同時に反転した分子は、回すと元の図に重なる同じ分子（メソ体）だからです。' },
            { key: 'lactide', label: '乳酸3分子の環状エステル', target: SP_LACTIDE_TARGET,
              foldNote: '環に3回回転対称があり、数え始めの位置がちがうだけの組（RRS・RSR・SRR など）が同じ分子にまとまるからです。' }
        ];

        if (this.body) setTimeout(() => { if (!this.active) this.renderList(); }, 0);
    }

    // ライブラリ（compounds.json / stages.json）から名称で図データを引く
    libraryTarget(name) {
        const source = (window.COMPOUNDS || []).concat(window.STAGES || []);
        const e = source.find(x => x.name === name && x.target);
        return e ? e.target : null;
    }

    /**
     * お題を準備する（キャッシュ）。お題の図から立体単位を検出し、
     * 「1単位ずつ反転」の全組み合わせ（2ⁿ通り）から答えの図を機械生成する。
     * 生成した図は毎回立体を読み直し、種類数が countStereoisomers と一致することまで確かめる。
     * 一致しなければそのお題は無効（UIに出さない）
     */
    prepare(index) {
        if (this._cache.has(index)) return this._cache.get(index);
        const g = this.game;
        const p = this.problems[index];
        const out = { disabled: true };
        try {
            const target = p.target || this.libraryTarget(p.compound);
            if (target) {
                const mol = g.createTargetFromData({ target });
                const info = countStereoisomers(mol);
                const units = spDetectUnits(g, target);
                if (units && !info.overflow && info.count >= 2) {
                    const variants = [];      // 出現順（お題の図が先頭）
                    const byCode = new Map(); // stereoCode -> variant
                    let ok = true;
                    for (let mask = 0; mask < (1 << units.length) && ok; mask++) {
                        let t = target;
                        for (let k = 0; k < units.length && t; k++) {
                            if (mask >> k & 1) t = spApplyFlip(g, t, units[k]);
                        }
                        const r = t && spReadByIndex(g, t);
                        if (!r) { ok = false; break; }
                        if (!byCode.has(r.read.stereoCode)) {
                            const v = { target: t, code: r.read.stereoCode, mirrorCode: r.read.mirrorCode };
                            byCode.set(r.read.stereoCode, v);
                            variants.push(v);
                        }
                    }
                    if (ok && byCode.size === info.count) {
                        Object.assign(out, {
                            disabled: false, target, code: canonicalCode(mol),
                            formula: g.computeMolecularFormula(mol),
                            info, units, variants, byCode
                        });
                    }
                }
            }
        } catch (e) { console.error('[StereoPractice] 題材の準備に失敗:', p.label, e); }
        if (out.disabled) console.error('[StereoPractice] 題材を無効化:', p.label);
        this._cache.set(index, out);
        return out;
    }

    isCleared(key) {
        try { return localStorage.getItem('chemStereoPractice.' + key) === '1'; }
        catch (e) { return false; }
    }

    // ===== 問題選択 =====
    renderList() {
        if (!this.body) return;
        this.active = false;
        // お題選びに戻った ＝ 作業帯の出番は終わり（第3段。stop() もここを通る）
        if (this.game.setPracticeStrip) this.game.setPracticeStrip(null);
        this.problem = null;
        this._pending = [];
        this.closeReview();
        this.body.innerHTML = '';

        const lead = document.createElement('div');
        lead.style.cssText = 'font-size:12px; color:var(--text-secondary); line-height:1.5; margin-bottom:6px;';
        lead.textContent = 'お題を選ぶとキャンバスに図が置かれます。つながり方は変えずに置換基の付き方だけを動かして、' +
            '立体異性体をすべて登録します。何種類あるかは単純な計算どおりとは限りません。';
        this.body.appendChild(lead);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:6px;';
        this.problems.forEach((p, i) => {
            const data = this.prepare(i);
            const cleared = this.isCleared(p.key);
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.style.cssText = 'font-size:12px; padding:7px 6px; text-align:center;' +
                (cleared ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
            btn.textContent = data.disabled
                ? `${p.label}（準備できません）`
                : `${p.label}（${data.info.count}種）${cleared ? ' ✓' : ''}`;
            btn.disabled = data.disabled;
            btn.addEventListener('click', () => this.start(i));
            grid.appendChild(btn);
        });
        this.body.appendChild(grid);
    }

    // ===== 練習開始 =====
    start(index) {
        const data = this.prepare(index);
        if (data.disabled) {
            this.game.showToast('このお題はいまの環境では準備できませんでした。');
            return;
        }
        if (window.isomerPractice && window.isomerPractice.active) window.isomerPractice.stop();
        if (window.alkylPractice && window.alkylPractice.active) window.alkylPractice.stop();
        const p = this.problems[index];
        this.problem = { index, key: p.key, label: p.label, foldNote: p.foldNote,
            total: data.info.count, ...data };
        this.entries = [];
        this._firstToastShown = false;
        this.closeReview();
        this.active = true;
        this.loadBase();
        this.renderSession();
    }

    // お題の図をキャンバスへ置く（元の作図は ↩ で戻せる）
    loadBase() {
        const g = this.game;
        if (g.userMolecule.atoms.length > 0) g.saveState();
        g.userMolecule = g.createTargetFromData({ target: this.problem.target });
        g.updateDrawing();
        g.fitCanvasToMolecule(g.userMolecule);
    }

    stop() {
        this.closeReview();
        this.active = false;
        this.problem = null;
        this.entries = [];
        this._firstToastShown = false;
        this.renderList();
    }

    // 現在の作図を表示用の図データとしてスナップショットする（面マークも保持）
    snapshotTarget(mol) {
        const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
        return {
            atoms: mol.atoms.map(a => (a.haworthFace === 1 || a.haworthFace === -1)
                ? { element: a.element, x: a.x, y: a.y, haworthFace: a.haworthFace }
                : { element: a.element, x: a.x, y: a.y }),
            bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
        };
    }

    // 書いた図のうち正解集合に含まれる「ちがう立体」の正準立体コード集合
    uniqueCorrectCodes() {
        return new Set(this.entries.map(e => e.code).filter(code => this.problem.byCode.has(code)));
    }

    // 立体コードに対応する名称（D-乳酸など）。立体指定エントリ→総称の順で引く
    stereoNameOf(stereoCode) {
        const g = this.game;
        g.getCompoundLibrary();
        const cands = g._compoundCodeMap.get(this.problem.code) || [];
        const hit = cands.find(e => e.stereoCode === stereoCode);
        if (hit) return hit.name;
        const generic = cands.find(e => !e.stereoCode);
        return generic ? generic.name : null;
    }

    // ===== 登録 =====
    // 重複は弾かずに保持する（「①と③は同じ立体」と答え合わせで見せるのが練習の肝）
    register() {
        if (!this.active) return;
        const g = this.game;
        const m = g.userMolecule;
        if (m.atoms.filter(a => a.element !== 'H').length === 0) {
            g.showToast('キャンバスに分子を描いてから登録してください。');
            return;
        }
        if (g.countMolecules() > 1) {
            g.showToast('分子が複数あります。1分子ずつ登録してください。');
            return;
        }
        if (canonicalCode(m) !== this.problem.code) {
            const f = g.computeMolecularFormula();
            g.showToast(f !== this.problem.formula
                ? `分子式が違います（いま: ${f} / お題: ${this.problem.formula}）。この練習ではつながり方は変えず、立体だけを変えます。`
                : 'つながり方（構造異性体）が変わっています。この練習で変えるのは立体だけです。「🔄 お題の図に戻す」で戻せます。');
            return;
        }
        // 立体の単位がすべて図から読めるか（読めない図は理由を出して受け付けない）
        const su = stereoUnitsOf(m);
        const read = readStereoOf(m);
        const missC = su.centers.length - (read ? read.centers : 0);
        const missB = su.bonds.length - (read ? read.geoms : 0);
        if (missC > 0 || missB > 0) {
            const parts = [];
            if (missC > 0) parts.push(`立体の読めない不斉炭素原子が${missC}個あります（フィッシャー投影の十字＝縦横に、環の置換基は縦に描く）`);
            if (missB > 0) parts.push(`向きの読めない C=C が${missB}本あります（置換基を軸の上下に描く）`);
            g.showToast('この図は立体として読めないため登録できません。' + parts.join('。') + '。');
            return;
        }
        if (!this.problem.byCode.has(read.stereoCode)) {
            // つながり方が同じなら原理的に変種集合に含まれるはず。万一の欠落は記録して断る
            console.error('[StereoPractice] 構造は一致するが変種集合に無い立体コード:', read.stereoCode);
            g.showToast('この立体は判定できませんでした（開発ログに記録しました）。');
            return;
        }

        this.entries.push({ code: read.stereoCode, name: this.stereoNameOf(read.stereoCode),
            target: this.snapshotTarget(m), order: this.entries.length + 1 });

        // クリア記録は静かに残す（同一判定の答えになるので告知は答え合わせまで出さない）
        if (this.uniqueCorrectCodes().size === this.problem.total) {
            try { localStorage.setItem('chemStereoPractice.' + this.problem.key, '1'); } catch (e) { /* noop */ }
        }
        // 図は消さずに残す（置換基を動かして次の立体を作る流れ）
        if (!this._firstToastShown) {
            this._firstToastShown = true;
            g.showToast('登録しました。図はそのまま残るので、置換基の付き方を動かして次の立体異性体を作りましょう。', 4500, 'success');
        } else {
            g.showToast(`登録しました（${this.entries.length}個目）。`, 1800, 'success');
        }
        this.renderSession();
    }

    // ===== 練習中の描画（右パネル）=====
    renderSession() {
        if (!this.body || !this.active) return;
        this._pending = [];
        this.body.innerHTML = '';

        const head = document.createElement('div');
        head.style.cssText = 'font-size:14px; color:#fff; font-weight:bold; margin-bottom:2px;';
        head.textContent = `🪞 ${this.problem.label} の立体異性体（全 ${this.problem.total} 種）`;
        this.body.appendChild(head);

        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:6px;';
        note.textContent = this.entries.length > 0
            ? `書いた図 ${this.entries.length}個。同じかどうか・名前は「答え合わせ」で確認します。`
            : 'キャンバスの図がお題の1つ目です。そのまま登録し、置換基の付き方（フィッシャーの左右・環の上下・C=C の同側/反対側）を動かして残りを作りましょう。';
        this.body.appendChild(note);

        if (this.entries.length > 0) {
            const tray = document.createElement('div');
            tray.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(88px,1fr)); gap:6px; margin-bottom:8px;';
            this.entries.forEach(e => {
                const cell = this.makeCell(`${ipMaru(e.order)}`,
                    { h: 62 }, id => renderMoleculeIntoSvg(this.game, id, e.target));
                cell.style.cursor = 'pointer';
                cell.title = 'クリックで大きく確認 / もう一度クリックで作図に戻る';
                cell.addEventListener('click', () => this.toggleReview('progress'));
                tray.appendChild(cell);
            });
            this.body.appendChild(tray);
        }

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
        const reg = document.createElement('button');
        reg.className = 'primary-btn';
        reg.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px;';
        reg.textContent = '＋この立体を登録';
        reg.addEventListener('click', () => this.register());
        btnRow.appendChild(reg);

        const review = document.createElement('button');
        review.className = 'primary-btn';
        review.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px; background:var(--color-cyan); color:#04121a;' +
            (this.entries.length === 0 ? ' opacity:0.5;' : '');
        review.textContent = '🔍 答え合わせ（同一判定・鏡像の組）';
        review.disabled = this.entries.length === 0;
        review.addEventListener('click', () => this.openReview('answer'));
        btnRow.appendChild(review);

        const reset = document.createElement('button');
        reset.className = 'view-btn';
        reset.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        reset.textContent = '🔄 お題の図に戻す';
        reset.addEventListener('click', () => { this.loadBase(); this.game.showToast('お題の図に戻しました。'); });
        btnRow.appendChild(reset);

        const quit = document.createElement('button');
        quit.className = 'view-btn';
        quit.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        quit.textContent = '練習をやめる';
        quit.addEventListener('click', () => this.stop());
        btnRow.appendChild(quit);
        this.body.appendChild(btnRow);

        this.flushThumbs();
        this.renderStrip();
    }

    /** 作業帯の1面（第3段）。異性体練習・アルキル基練習と同じ器を使う ＝ 帯は1つ（§4-2） */
    renderStrip() {
        if (!this.active || !this.problem) { this.game.setPracticeStrip(null); return; }
        this.game.setPracticeStrip({
            live: `お題 <b>${this.problem.label}</b> の立体異性体`,
            progress: `${this.entries.length}/${this.problem.total}`,
            actions: [
                { label: '＋登録', primary: true, title: 'いま描いている立体を書き出しに加えます',
                  onClick: () => this.register() },
                { label: '🔍 答え合わせ', disabled: this.entries.length === 0,
                  title: '書いた図を並べて同一判定と鏡像の組を見ます',
                  onClick: () => this.openReview('answer') },
                { label: 'やめる', title: '練習をやめてお題選びに戻ります',
                  onClick: () => this.stop() }
            ]
        });
    }

    // ===== 答え合わせ／書き出しの確認 =====
    openReview(mode = 'answer') {
        if (!this.overlay || !this.active || this.entries.length === 0) return;
        this._reviewMode = mode;
        this._reviewing = true;
        this.overlay.classList.remove('hidden');
        this.overlay.scrollTop = 0;
        // 作業帯（z-index 30）は答え合わせオーバーレイ（20）より上なので畳む（第3段）
        this.game.setWorkPane('ws-practice', false);
        this.renderReview();
    }

    closeReview() {
        if (this.overlay) this.overlay.classList.add('hidden');
        this._reviewing = false;
        if (this.active) this.renderStrip();
    }

    toggleReview(mode) {
        if (this._reviewing && this._reviewMode === mode) {
            this.closeReview();
            this.renderSession();
        } else {
            this.openReview(mode);
        }
    }

    setReviewScale(scale) {
        this._reviewScale = scale;
        this.renderReview();
    }

    // 変種の呼び名（答え合わせの図Bの見出し）: A・B・C…
    variantAlpha(i) { return String.fromCharCode(65 + i); }

    renderReview() {
        if (!this.overlay) return;
        const g = this.game;
        const answerMode = this._reviewMode === 'answer';
        const sc = IP_REVIEW_SCALES[this._reviewScale] || IP_REVIEW_SCALES.md;
        this._pending = [];
        this.overlay.innerHTML = '';

        const uc = this.uniqueCorrectCodes();
        const byCode = new Map();
        this.entries.forEach(e => {
            if (!byCode.has(e.code)) byCode.set(e.code, []);
            byCode.get(e.code).push(e.order);
        });
        const dupCount = this.entries.length - byCode.size;
        const missing = this.problem.total - uc.size;

        const headRow = document.createElement('div');
        headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; flex-wrap:wrap;';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:16px; color:#fff; font-weight:bold;';
        title.textContent = (answerMode ? '答え合わせ' : '書き出しの確認') + ` — ${this.problem.label}の立体異性体`;
        headRow.appendChild(title);
        const sizeWrap = document.createElement('div');
        sizeWrap.style.cssText = 'display:flex; gap:4px; align-items:center;';
        const sizeLabel = document.createElement('span');
        sizeLabel.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        sizeLabel.textContent = '図の大きさ:';
        sizeWrap.appendChild(sizeLabel);
        [['sm', '小'], ['md', '中'], ['lg', '大']].forEach(([key, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            const on = this._reviewScale === key;
            b.style.cssText = 'font-size:12px; padding:4px 10px;' +
                (on ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => this.setReviewScale(key));
            sizeWrap.appendChild(b);
        });
        headRow.appendChild(sizeWrap);
        this.overlay.appendChild(headRow);

        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:10px; flex-wrap:wrap;';
        const mLab = document.createElement('span');
        mLab.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        mLab.textContent = '表示:';
        modeRow.appendChild(mLab);
        [['progress', '確認（自分の図だけ）'], ['answer', '答え合わせ（同一判定・答え）']].forEach(([key, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            const on = this._reviewMode === key;
            b.style.cssText = 'font-size:12px; padding:6px 12px;' +
                (on ? ' background:var(--color-cyan); color:#04121a; border-color:var(--color-cyan);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => {
                if (this._reviewMode === key) return;
                this._reviewMode = key;
                this.overlay.scrollTop = 0;
                this.renderReview();
            });
            modeRow.appendChild(b);
        });
        this.overlay.appendChild(modeRow);

        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:13px; color:var(--text-secondary); margin-bottom:10px; line-height:1.6;';
        summary.textContent = answerMode
            ? `あなたが書いた図 ${this.entries.length}個 → ちがう立体 ${uc.size} ／ 全 ${this.problem.total} 種。ダブり ${dupCount}個・未発見 ${missing}種。`
            : `あなたが書いた図 ${this.entries.length}個（全 ${this.problem.total} 種）。図をクリックすると作図に戻ります。同じかどうかは「答え合わせ」で確認できます。`;
        this.overlay.appendChild(summary);

        // 2ⁿ が崩れる理由（このお題の畳み込み）は答え合わせでだけ説明する
        if (answerMode && this.problem.info.folded && this.problem.foldNote) {
            const fold = document.createElement('div');
            fold.style.cssText = 'border:1px solid var(--neon-purple); background:rgba(224,176,255,0.06); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; color:#e0b0ff; line-height:1.7;';
            fold.textContent = `立体の単位は ${this.problem.info.centers + this.problem.info.bonds} 個なので単純には 2ⁿ＝${this.problem.info.naive} 通りですが、実際は ${this.problem.total} 種類です。` +
                this.problem.foldNote;
            this.overlay.appendChild(fold);
        }

        // 同じ立体どうしの指摘（同一判定なので答え合わせモードのみ）
        const dupGroups = [...byCode.entries()].filter(([, orders]) => orders.length > 1);
        const dupColorOf = new Map();
        if (answerMode) dupGroups.forEach(([code], i) => dupColorOf.set(code, IP_DUP_COLORS[i % IP_DUP_COLORS.length]));
        if (answerMode && dupGroups.length) {
            const dupBox = document.createElement('div');
            dupBox.style.cssText = 'border:1px solid var(--neon-orange); background:rgba(255,159,67,0.08); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; color:var(--neon-orange); line-height:1.7;';
            const h = document.createElement('div');
            h.style.cssText = 'font-weight:bold; margin-bottom:2px;';
            h.textContent = '同じ立体（描き方がちがっても、読み取れる立体が同じなら同一）:';
            dupBox.appendChild(h);
            dupGroups.forEach(([code, orders]) => {
                const name = this.entries.find(e => e.code === code).name;
                const row = document.createElement('div');
                row.textContent = `・${orders.map(o => ipMaru(o)).join('と')} は同じ${name ? ' ＝ ' + name : ''}`;
                dupBox.appendChild(row);
            });
            this.overlay.appendChild(dupBox);
        }

        // セクションA: あなたの書き出し
        const secA = document.createElement('div');
        secA.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
        secA.textContent = 'あなたの書き出し';
        this.overlay.appendChild(secA);

        const galA = document.createElement('div');
        galA.style.cssText = `display:grid; grid-template-columns:repeat(auto-fill, minmax(${sc.col}px,1fr)); gap:8px; margin-bottom:14px;`;
        this.entries.forEach(e => {
            const border = dupColorOf.get(e.code) || 'rgba(255,255,255,0.14)';
            const label = answerMode ? `${ipMaru(e.order)}${e.name ? ' ' + e.name : ''}` : `${ipMaru(e.order)}`;
            const cell = this.makeCell(label,
                { h: sc.h, border, borderWidth: dupColorOf.has(e.code) ? '2px' : '1px' },
                id => renderMoleculeIntoSvg(g, id, e.target));
            cell.style.cursor = 'pointer';
            cell.title = 'クリックで作図に戻る';
            cell.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
            galA.appendChild(cell);
        });
        this.overlay.appendChild(galA);

        // セクションB: 答え（機械生成した全変種）。鏡像の組・メソ体を注記する
        if (answerMode) {
            const secB = document.createElement('div');
            secB.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
            secB.textContent = '答え（鏡像の組は互いに重ならない対）';
            this.overlay.appendChild(secB);

            const galB = document.createElement('div');
            galB.style.cssText = `display:grid; grid-template-columns:repeat(auto-fill, minmax(${sc.col}px,1fr)); gap:8px; margin-bottom:14px;`;
            this.problem.variants.forEach((v, i) => {
                const found = uc.has(v.code);
                const name = this.stereoNameOf(v.code);
                let rel;
                if (v.mirrorCode === v.code) {
                    rel = '鏡像＝自分自身（アキラル）';
                } else {
                    const partner = this.problem.variants.findIndex(w => w.code === v.mirrorCode);
                    rel = partner >= 0 ? `鏡像＝${this.variantAlpha(partner)}` : '';
                }
                const label = `${this.variantAlpha(i)}${found ? ' ✓' : '（未発見）'}${name ? ' ' + name : ''}${rel ? ' — ' + rel : ''}`;
                const cell = this.makeCell(label,
                    { h: sc.h, border: found ? 'var(--color-cyan)' : 'var(--neon-orange)',
                      labelColor: found ? 'var(--color-cyan)' : 'var(--neon-orange)' },
                    id => renderMoleculeIntoSvg(g, id, v.target));
                galB.appendChild(cell);
            });
            this.overlay.appendChild(galB);
        }

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

    // ===== 図セル描画ヘルパー =====
    makeCell(labelText, opts, renderFn) {
        const cell = document.createElement('div');
        cell.style.cssText = 'background:rgba(10,14,24,0.85); border:' + (opts.borderWidth || '1px') + ' solid ' +
            (opts.border || 'rgba(255,255,255,0.14)') +
            '; border-radius:8px; padding:3px 3px 5px; text-align:center;';
        const svg = document.createElementNS(IP_SVGNS, 'svg');
        svg.id = 'sp-svg-' + (StereoIsomerPractice._seq = (StereoIsomerPractice._seq || 0) + 1);
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
            catch (e) { console.error('[StereoPractice] 図の描画に失敗:', e); }
        });
        this._pending = [];
    }
}
