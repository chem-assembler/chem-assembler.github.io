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
// ★ **お題の下限**（v1433・発注書 ORDER_isomer_2026-08-20 の A-5）。
//   上と同じ線を、骨格の型で絞ったお題にも引く ——「1種しか出ない出題は書き出して見比べる
//   練習にならない」。実測でこれに当たるのは **C₃H₆ を鎖式に絞ったとき（1種＝プロペンだけ）**と
//   **環式に絞ったとき（1種＝シクロプロパンだけ）**。既存のお題 C₄H₁₀ が2種で成立しているので、
//   下限は 2 で足りる（3 にすると C₄H₁₀・C₄H₈（環式）・C₂H₆O が落ちる）
const IP_MIN_ISOMERS = 2;

/**
 * ★ 出題の「範囲」（骨格の型）を**1か所で名乗る**（v1433・発注書 A-5）。
 *
 * §11-4 が芳香族の回で決めた「**宣言した出題**」の形を、鎖式・環式へそのまま広げたもの。
 * ⚠ **お題の名前で範囲が言い切れること**が要件（ユーザー判断 2026-08-20:
 *   「C₅H₈ アレンを外すのは、ユーザーに指示がしにくい」）。だから範囲は
 *   **「環をもつ / もたない / ベンゼン環をもつ」だけ**にして、
 *   正解集合から特定の骨格（アレンなど）を抜く細工は**しない**。
 *   抜くと、お題の名前だけでは何が正解か言えなくなり、但し書きに頼ることになる。
 *
 * ⚠ 見出し・注記・作業帯・答え合わせの表題・クリア記録の鍵・採点表の断り文が
 *   **すべてここから出る**。1つでも直書きすると「宣言したのに画面のどこかで隠れる」が生まれる
 *   （§11-4「宣言した以上、画面のどこでも隠さない」）。
 */
const IP_SCOPES = {
    aromatic: {
        tag: '芳香族', key: '@ar', title: 'の芳香族異性体',
        note: '※ ベンゼン環をもつ構造だけを数えます（環をもたない異性体は対象外）。',
        reject: '分子式は合っていますが、この回はベンゼン環をもつ構造だけが対象です',
        tip: 'ベンゼン環をもつ構造異性体だけを書き出す回です（環をもたない異性体は対象外）'
    },
    chain: {
        tag: '鎖式', key: '@chain', title: 'の鎖式異性体',
        note: '※ 環をもたない構造だけを数えます（環をもつ異性体は対象外）。',
        reject: '分子式は合っていますが、この回は環をもたない構造だけが対象です',
        tip: '環をもたない構造異性体だけを書き出す回です（環をもつ異性体は対象外）'
    },
    ring: {
        tag: '環式', key: '@ring', title: 'の環式異性体',
        note: '※ 環をもつ構造だけを数えます（環をもたない異性体は対象外）。',
        reject: '分子式は合っていますが、この回は環をもつ構造だけが対象です',
        tip: '環をもつ構造異性体だけを書き出す回です（環をもたない異性体は対象外）'
    }
};
// 骨格の型で正解集合をふるう。⚠ **判定は `findAnyCycle` 1本**（新しい数え方を書かない）
function ipMatchesSkeleton(mol, skeleton) {
    if (skeleton === 'chain') return !findAnyCycle(mol);
    if (skeleton === 'ring') return !!findAnyCycle(mol);
    return true;
}
// ★ お題を2つの群に分ける境目（v1433・ユーザー補足 2026-08-20:
//   「環や二重結合が複数ある化合物の書き出しは、入試問題に出される可能性は極めて低いが、
//     トレーニングとしてはやる価値がありそう」）。
// ⚠ **難易度の段ではない**（頻度の話であって難しさの話ではない）ので、群の見出しでだけ分ける。
// ⚠ **出題頻度は数えていない** —— repo の入試DB（`qa/data/exam_usage.jsonl`）は
//   「知識項目 → 大問」の逆引きで、**分子式ごと・書き出し設問ごとの件数は持っていない**。
//   だから画面の文言でも回数を名乗らない（何が正解に並ぶかだけを言う）
const IP_TRAINING_DOU = 2;
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
    return { order: detail.mainChain.slice(), pos: ipLayoutFromChain(mol, detail.mainChain) };
}

/**
 * ★ **番号を振らずに、鎖を横一直線に置くだけ**の道（v1440・発注書 ORDER_isomer_2026-08-20 §A-4 の案①）。
 *
 * > **書き出しの正解／エーテルのアルキル基の主鎖を横一直線に**（ユーザー）
 *
 * **なぜ要るか**: `ipNumberedLayout` の門番は `iupacNameDetail(mol).kind === 'chain'` で、
 * **エーテルは主鎖に番号をつけないのが規則**なので `iupacNameDetail` が null を返す
 * ＝ **必ず `layoutMolecule` へ落ちる**。落ちた先で横一直線になるかは運で、
 * 実測（10件）では **2件が途中で直角に曲がって縦へ伸びていた**
 * （sec-ブチルメチルエーテル・エチルイソプロピルエーテル）。
 *
 * ⚠ **`CLAUDE.md` の作図規約には触れない。** 直すのは**答え合わせの左列＝アプリが描く
 * 「標準の書き方」**だけで、**ユーザーの作図には1px も触らない**
 * （`ipNumberedLayout` と同じ「表示専用・座標＝見た目のみ」の道具）。
 *
 * ★★ **番号は返さない**（`order: null`）。エーテルは IUPAC で主鎖に番号を振らないので、
 * **並べるための鎖と、番号のための鎖を同じものにしない**。
 * ⚠ 次の人がここに `order` を足したくなったら、まずこの3行を読むこと ——
 * `iupacNameDetail` 以外から決めた鎖に番号を振ると、**同じ図に出す名前と黙って食い違う**
 * （§0 の失効表が `findLongestCarbonChain` について釘を刺しているのと同じ罠）。
 *
 * 環は `null` を返して `layoutMolecule`（環テンプレート）に任せる。
 */
function ipStraightLayout(mol) {
    if (findAnyCycle(mol)) return null;
    const chain = ipLongestHeavyPath(mol);
    if (!chain || chain.length < 2) return null;
    return { order: null, pos: ipLayoutFromChain(mol, chain) };
}

/**
 * 重原子だけを見た**いちばん長い道**（非環式＝木なので直径そのもの）。表示専用。
 *
 * ⚠ **原子IDの順序に頼らない**（IDは乱数。MEMORY「原子IDに順序を頼らない」）。
 * 決め方は `mol.atoms` の**並び順**（列挙器が作る順＝同じ分子なら毎回同じ）だけを使う。
 *
 * 同じ長さが並んだときは **ヘテロ原子を多く含むほうを採る** ——
 * エーテルの O を枝へ追い出すと「アルキル基の主鎖を横一直線に」の願いから外れるため。
 */
function ipLongestHeavyPath(mol) {
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    if (heavy.length < 2) return null;
    const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
    const elem = new Map(mol.atoms.map(a => [a.id, a.element]));
    const adj = new Map(heavy.map(a => [a.id,
        mol.getNeighbors(a.id).filter(nn => nn.atom.element !== 'H').map(nn => nn.atom.id)
            .sort((p, q) => idx.get(p) - idx.get(q))]));
    const hetero = (ids) => ids.reduce((s, id) => s + (elem.get(id) === 'C' ? 0 : 1), 0);
    let best = null;
    const walk = (id, seen, path) => {
        if (!best || path.length > best.length ||
            (path.length === best.length && hetero(path) > hetero(best))) best = path.slice();
        adj.get(id).forEach(nx => {
            if (seen.has(nx)) return;
            seen.add(nx); path.push(nx);
            walk(nx, seen, path);
            path.pop(); seen.delete(nx);
        });
    };
    heavy.forEach(a => walk(a.id, new Set([a.id]), [a.id]));
    return best;
}

/** 渡された鎖を横一直線（`IP_HSTEP` 刻み）に置き、枝を上下へ伸ばした座標（`ipNumberedLayout` と共用） */
function ipLayoutFromChain(mol, chain) {
    const order = chain.slice();
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
    return pos;
}

/* ===== ★ 鎖式の C=C を「別の答案」として数える（v1440・ユーザー実機報告 2026-08-21）=====
 *
 * > **C5H10 立体の書き出し／鎖式は シス・トランスを別に書き出すのが自然**
 *
 * **実測（v1439）**: シス-2-ペンテンとトランス-2-ペンテンを両方描くと、
 * 採点表は2枚目を **「同じものをもう一度」**（`dup`）と言い、種類は **1** としか数えなかった。
 * ⚠ **見分けられないのではない** —— `readStereoOf` は同じ図を
 * `…|g0-1c` と `…|g0-1t` と読み分けている。**採点だけが `canonicalCode`（構造だけ）で
 * 突き合わせていた**ので、読めている違いを捨てていた。
 *
 * ★ **分けるのは「鎖式の C=C」だけ。**不斉炭素と環の置換基は**分けない**（据え置き）。
 *   理由は化学ではなく**キャンバス**にある —— このアプリの作図は平面の直交格子で、
 *   **C=C の向きは座標から読める**（`readBondGeoFromCoords`）が、
 *   不斉炭素の R/S・環の置換基の上下は**くさび／フィッシャー／ハース図でしか描けない**
 *   ＝ `stereoPractice`（立体異性体の書き出し）の担当。
 *   ⚠ ここを揃えようとすると「描けないものを描けと言う」出題になる。
 *   不斉炭素・環のぶんは今までどおり **段1（☆ 場所を指す）と段2（総数）**で答える
 *   ＝ C₅H₁₀ は **書き出し 11種 ＋ 総数 13**（差の2は 1,2-ジメチルシクロプロパンの立体）。
 *
 * ★★ **別の答案として数えるのは「正解図を描き分けられて、しかも読み返せた」ものだけ。**
 *   図が作れない分子（C=C が2本以上・主鎖に乗らない・枝が置けない）は**分けない**。
 *   分けた瞬間に「答えは2つあるのに、正解の列に出せる図は1つ」という表ができる。
 */
// 描き分けの図を用意できる C=C の本数（1本だけ）。⚠ 増やすなら `ipGeoChainPos` の置き方を先に決めること
const IP_GEO_SPLIT_BONDS = 1;

/** 鎖式 C=C の向きだけを見た正準コード（⚠ 不斉炭素は見ない ＝ 分けない軸は入れない） */
function ipGeoCode(mol, bondGeo) {
    return canonicalStereoCode(mol, { atomParity: {}, bondGeo: bondGeo || {} });
}

/** 原子・結合はそのまま、座標だけ差し替えた写し（`pos` が null なら座標もそのまま） */
function ipCloneWithPos(mol, pos) {
    const m = new Molecule();
    const map = new Map();
    mol.atoms.forEach(a => {
        const p = pos ? pos.get(a.id) : null;
        map.set(a.id, m.addAtom(a.element, p ? p.x : a.x, p ? p.y : a.y).id);
    });
    mol.bonds.forEach(b => m.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type));
    return m;
}

/** 置いていない重原子を、空いている格子点へ置く（`ipGeoChainPos` の枝置き）。置けなければ false */
function ipPlaceBranches(mol, pos) {
    const H = IP_HSTEP;
    const free = (x, y) => [...pos.values()].every(q => Math.hypot(q.x - x, q.y - y) > H * 0.6);
    const queue = [...pos.keys()];
    while (queue.length) {
        const id = queue.shift();
        const at = pos.get(id);
        for (const n of mol.getNeighbors(id)) {
            if (n.atom.element === 'H' || pos.has(n.atom.id)) continue;
            const spot = [[0, -H], [0, H], [H, 0], [-H, 0], [0, -2 * H], [0, 2 * H]]
                .map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
                .find(q => free(q.x, q.y));
            if (!spot) return false;
            pos.set(n.atom.id, spot);
            queue.push(n.atom.id);
        }
    }
    return true;
}

/**
 * 鎖式 C=C を1本もつ分子を「**向きが読める**図」に置く（`side` ＝ C=C の前後をどちらへ折るか）。
 *
 * ```
 *   C1        C4-C5      side = [-1, -1]（前も後ろも上 ＝ シス）
 *    |         |
 *   C2 ===== C3          ← C=C は必ず水平（座標から向きを読む条件）
 * ```
 * ⚠ **`side` から シス／トランス を決め打ちしない。** 向きの基準になる置換基は
 * 断片コードで決まる（`_bondGeoRefs`）ので、主鎖の続きとは限らない。
 * 呼ぶ側が**置いた図を読み返して**（`readBondGeoFromCoords`）どちらになったかを知る。
 */
function ipGeoChainPos(mol, side) {
    const chain = ipLongestHeavyPath(mol);
    if (!chain) return null;
    const bonds = stereoUnitsOf(mol).bonds;
    if (bonds.length !== IP_GEO_SPLIT_BONDS) return null;
    const ia = chain.indexOf(bonds[0][0]), ib = chain.indexOf(bonds[0][1]);
    if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1) return null;   // 主鎖に乗らない C=C は置けない
    const p = Math.min(ia, ib);
    if (p < 1 || p + 2 > chain.length - 1) return null;             // 端が =CH₂（適格でないはずだが保険）
    const H = IP_HSTEP;
    const pos = new Map();
    pos.set(chain[p], { x: 0, y: 0 });
    pos.set(chain[p + 1], { x: H, y: 0 });
    for (let i = p - 1, k = 0; i >= 0; i--, k++) pos.set(chain[i], { x: -k * H, y: side[0] * H });
    for (let i = p + 2, k = 0; i < chain.length; i++, k++) pos.set(chain[i], { x: H + k * H, y: side[1] * H });
    return ipPlaceBranches(mol, pos) ? pos : null;
}

/**
 * その構造を「鎖式 C=C の向き」で分けた答案の一覧。⚠ **分けられないときは1件**（`pos: null`）。
 * 返り値 `[{ code, pos }]`。`code` は答案の鍵（`grade()` が描いた図から同じ式で作る）。
 */
function ipGeoVariants(mol) {
    const plain = [{ code: canonicalCode(mol), pos: null }];
    if (stereoUnitsOf(mol).bonds.length !== IP_GEO_SPLIT_BONDS) return plain;
    const out = [], seen = new Set();
    for (const a of [-1, 1]) {
        for (const b of [-1, 1]) {
            const pos = ipGeoChainPos(mol, [a, b]);
            if (!pos) return plain;
            // ★ 置いた図を**読み返す**（描き分けたつもりで読めない図を正解に据えない）
            const probe = ipCloneWithPos(mol, pos);
            const geo = readBondGeoFromCoords(probe);
            if (Object.keys(geo).length !== IP_GEO_SPLIT_BONDS) return plain;
            const code = ipGeoCode(probe, geo);
            if (seen.has(code)) continue;
            seen.add(code);
            out.push({ code, pos });
        }
    }
    return out.length === 2 ? out : plain;   // 2つに割れないなら据え置き
}

// ===== 「立体が分かれる場所」の共有部品（DESIGN_stereo_point.md §8-2・v1435）=====
//
// ★ **境界の言い方**（同書 §8-2）:
//     「どこが立体の場所か」を知っているのは `chemistry.js` だけ（`stereoUnitsOf`）。
//     「印が合っているか」を知っているのは `gradeStereoPoints` だけ。
//     `game.js` は印を集めて渡し、返ってきた結果を描くだけ。
//
// ⚠ **「見せるだけだから `stereoUnitsOf` を直接呼べばいい」としないこと。**
//   そこが2つ目の判定になり、片方だけ直る事故の種になる（このリポジトリで繰り返している罠）。
//   ORDER A-6 の段（正解図に印を重ねて見せる）も、段1（自分の図に印を付けて答える）も、
//   **この1本を通す**。

/**
 * 図（分子）に付いている印を集める。**印の在りかは図そのもの**で、別の台帳を持たない
 * （§12「答案の在りかが1つ」と同じ流儀。番号や添字で覚えると、原子を1つ消した瞬間に狂う）。
 *
 * 戻り値 `{ centers:Set<atomId>, bonds:Set<key> }`。
 * ⚠ 結合のキーは `stereoBondKey()` が作る（原子IDに `_` が入るので分解できない）。
 */
function stereoMarksOf(mol) {
    return {
        centers: new Set(mol.atoms.filter(a => a.element === 'C' && a.isAsymmetricMarked).map(a => a.id)),
        bonds: new Set(mol.bonds.filter(b => b.isStereoMarked).map(b => stereoBondKey(b.atomId1, b.atomId2)))
    };
}

/**
 * ★ 段1 の採点（DESIGN_stereo_point.md §8-2）。**判定はこの1本だけ。**
 *
 * 正解の出どころは `stereoUnitsOf(mol)` ただ1つ ——「不斉炭素」と「シス/トランスの取れる C=C」を
 * 別々に集め直さない（2か所で数えると、片方だけ直る日が必ず来る）。
 *
 * ⚠ **見るのは「場所が合っているか」だけ。** どちらがシスでどちらが R かは問わない
 *   （`DESIGN_isomer_practice.md` §15-4「立体異性の採点はやらない」の線の内側。
 *    ORDER B-2 の決めてほしいこと26 への答え: **越えていない。不斉炭素を指すのは構造の話**）。
 *
 * @param mol   採点する図（連結成分1つ）
 * @param marks `stereoMarksOf()` が返す形（`{ centers:Set, bonds:Set }`）
 * @returns { ok, expected, marked, missingCenters[], missingBonds[], extraCenters[], extraBonds[], missing, extra }
 */
function gradeStereoPoints(mol, marks) {
    const su = stereoUnitsOf(mol);
    const wantCenters = new Set(su.centers);
    const wantBonds = new Set(su.bonds.map(([a, b]) => stereoBondKey(a, b)));
    const gotCenters = new Set((marks && marks.centers) ? [...marks.centers] : []);
    const gotBonds = new Set((marks && marks.bonds) ? [...marks.bonds] : []);
    const missingCenters = [...wantCenters].filter(id => !gotCenters.has(id));
    const missingBonds = [...wantBonds].filter(k => !gotBonds.has(k));
    const extraCenters = [...gotCenters].filter(id => !wantCenters.has(id));
    const extraBonds = [...gotBonds].filter(k => !wantBonds.has(k));
    const missing = missingCenters.length + missingBonds.length;
    const extra = extraCenters.length + extraBonds.length;
    return {
        ok: missing === 0 && extra === 0,
        expected: wantCenters.size + wantBonds.size,
        marked: gotCenters.size + gotBonds.size,
        missingCenters, missingBonds, extraCenters, extraBonds, missing, extra
    };
}

/**
 * ★ 畳み込み（2ⁿ より少ない）の説明文は**ここ1か所**（DESIGN_stereo_point.md §6(c)）。
 *
 * ⚠ ORDER A-6 の「同じ数の説明が2か所に出るので文言をそろえる」への答え ——
 *   `stereoPractice`（立体の書き出し）の `foldNote` と、書き出し練習の段2 の解説が
 *   **同じ文字列を読む**。書き写すと片方だけ直る。
 */
const STEREO_FOLD_NOTES = {
    meso: '2つの中心を同時に反転した分子は、回すと元の図に重なる同じ分子（メソ体）だからです。',
    symmetry: '環に回転対称があり、数え始めの位置がちがうだけの組（RRS・RSR・SRR など）が同じ分子にまとまるからです。'
};

// その不斉炭素に付いている環外の枝が「メチル基だけ」か（メソ体の解説の言い回しを決めるだけ。
// 化学の判定はしていない ＝ 外れても文が一段だけ一般的になるだけで、数は1つも動かない）
function stereoAllMethyl(mol, centers) {
    return centers.every(id => {
        const subs = mol.getNeighbors(id).filter(n => n.atom.element === 'C' && !centers.includes(n.atom.id));
        return subs.some(n => {
            const deg = mol.getNeighbors(n.atom.id).filter(x => x.atom.element !== 'H').length;
            return deg === 1; // 末端の炭素＝メチル基
        });
    });
}

/**
 * ★ メソ体（と、その他の畳み込み）の解説（DESIGN_stereo_point.md §6(b)(c)(d)）。
 * 戻り値は行の配列（`{ text, style }`）。**画面に出るのはこの文がそのまま**。
 *
 * ⚠ 呼ぶ側は「畳み込みがあった行だけ」に絞ること。多数派（掛け算どおり）の行に
 *   長い解説を並べると、見どころが埋まる（§6(d) の1行だけにする）。
 */
function stereoFoldLines(mol, name, info, reason) {
    const label = name || '（名称未登録）';
    const places = info.centers + info.bonds;
    const out = [];
    if (!reason) {
        // (d) 畳み込みが無かったとき ＝ 多数派。1行だけ
        const what = info.bonds > 0 && info.centers === 0
            ? `C=C が ${info.bonds} 本なので ${info.count} 種（シス形とトランス形）`
            : `不斉炭素が ${info.centers} つなので ${info.count} 種`;
        out.push({ text: `${label} ―― ${what}。掛け算どおりです。` });
        return out;
    }
    out.push({ text: `${label} ―― ${places} か所あるのに ${info.count} 種`, head: true });
    if (reason === 'meso') {
        const subs = stereoAllMethyl(mol, [...stereoUnitsOf(mol).centers]) ? 'メチル基' : '置換基';
        const ring = !!findAnyCycle(mol);
        out.push({ text: `不斉炭素は ${info.centers} つです。ふつうならそれぞれ 2 通りで ` +
            `${new Array(info.centers).fill('2').join(' × ')} = ${info.naive} 種ですが、この分子は ${info.count} 種しかありません。` });
        if (ring && info.centers === 2) {
            out.push({ text: `2 つの${subs}が環の同じ側にあるとき（シス）`, sub: true });
            out.push({ text: '分子の真ん中に鏡の面ができ、鏡像が自分自身と重なります。' +
                '左右の不斉炭素が打ち消し合っていて、全体としては 1 種です。これがメソ体です。', indent: true });
            out.push({ text: `2 つの${subs}が環の反対側にあるとき（トランス）`, sub: true });
            out.push({ text: '鏡の面ができず、鏡像は自分自身と重なりません。鏡像の対で 2 種です。', indent: true });
            out.push({ text: `1（シス・メソ体） ＋ 2（トランスの対） ＝ ${info.count} 種`, formula: true });
        } else {
            out.push({ text: STEREO_FOLD_NOTES.meso, indent: true });
        }
        out.push({ text: '★ 不斉炭素の数だけでは種類数は決まりません。' +
            '数えたあとに「分子の中に鏡の面ができないか」を確かめること。', star: true });
    } else {
        out.push({ text: `不斉炭素は ${info.centers} つで、ふつうなら 2${'⁰¹²³⁴⁵⁶⁷⁸⁹'[info.centers] || ''} = ${info.naive} 種ですが、` +
            `この分子は ${info.count} 種しかありません。` });
        out.push({ text: STEREO_FOLD_NOTES.symmetry, indent: true });
    }
    return out;
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
        this._numbered = new Set();    // 表の中で 🔢 を押した行（F・§8-1。resetProgress が空にする）

        /**
         * M1 の固定問題リスト（設計 4.1）。異性体数はデータに持たず列挙エンジンから求める。
         *
         * ⚠ **添字 0〜5 は動かさない。** 回帰テストが `start(2)` のように**添字で開く**ので、
         *   並べ替えると別の問題を開いたまま緑になる。足すのは**末尾だけ**。
         *
         * `skeleton` … 骨格の型で正解集合を絞る（`'chain'` = 環をもたない / `'ring'` = 環をもつ）。
         *   省略なら全異性体。⚠ **型を分けたお題を足すのは、環をもつ正解が1件以上あるときだけ**
         *   —— C₄H₁₀ のように環が0件の式では「鎖式」の回が全部の回と同じ集合になり、
         *   同じ問題が2つ並ぶだけになる（`IW18` が機械で見張っている）。
         *
         * ★ 末尾の 13 件は v1433（発注書 ORDER_isomer_2026-08-20 の A-5・A-6 と
         *   ユーザー判断 2026-08-20「自由にテーマを選べるようになっているが、制約が大きいので、
         *   可能な問題はすべて用意したほうがよいと思います」）。
         *   **総当たり（分子式 × 骨格の型）で洗い出し、次の4条件を満たすものを全部並べた**:
         *     ① 種類数が 2〜20（`IP_MIN_ISOMERS` 〜 `IP_MAX_ISOMERS`）
         *     ② 既存の門番を破らない（重原子6個まで／重原子6個かつ不飽和度2以上は数える前に断る。
         *        ⚠ お題ボタンは**開く前に種類数を出す**ので、**19件ぶんの列挙が起動時に1回走る**
         *        （下の `setTimeout(0)` の `renderList`。以後はキャッシュ）。
         *        実測 C₆H₁₀ 2.8秒・C₆H₈ 6.5秒・C₆H₆ 10.0秒 ＝ 門番はここでも要る）
         *        ⚠ **代償の実測（v1433）**: 初回 `renderList()` は 6問の約133ms → **524ms**（PC）／
         *        **757ms**（スマホ 375×812）。起動直後の longtask は合計 888ms・最悪 406ms。
         *        **これ以上お題を足すならここが先に効く**（足す前に初回時間を測ること）
         *     ③ **正解の全部に名前が付く**（答え合わせの左列が「（名称未登録）」にならない・§11-7）。
         *        これで落ちた主なもの: C₅H₈（環式）17種は名前が **1件**しか付かない／
         *        C₄H₆（環式）5種は **0件**／C₄H₈O（鎖式）15種は 7件どまり
         *     ④ 型を分けるのは環をもつ正解が1件以上あるときだけ（上記）
         */
        this.problems = [
            { elements: ['C', 'C', 'C', 'C'], hCount: 10 },
            { elements: ['C', 'C', 'C', 'C', 'C'], hCount: 12 },
            { elements: ['C', 'C', 'C', 'O'], hCount: 8 },
            { elements: ['C', 'C', 'C', 'C', 'C', 'C'], hCount: 14 },
            { elements: ['C', 'C', 'C', 'C'], hCount: 8 },
            { elements: ['C', 'C', 'C', 'C', 'O'], hCount: 10 },
            // ── ここから v1433 ──────────────────────────────────
            { elements: ['C', 'C', 'O'], hCount: 6 },                      //  6: C₂H₆O   2種（アルコールとエーテルの入口）
            { elements: ['C', 'C', 'C'], hCount: 6 },                      //  7: C₃H₆    2種（プロペンとシクロプロパン）
            { elements: ['C', 'C', 'C', 'C', 'C'], hCount: 10 },           //  8: C₅H₁₀  10種
            { elements: ['C', 'C', 'C', 'C', 'C', 'O'], hCount: 12 },      //  9: C₅H₁₂O 14種（★不斉炭素をもつ種が4つある唯一のお題・A-6）
            { elements: ['C', 'C', 'C', 'C'], hCount: 8, skeleton: 'chain' },              // 10: C₄H₈  鎖式 3種
            { elements: ['C', 'C', 'C', 'C'], hCount: 8, skeleton: 'ring' },               // 11: C₄H₈  環式 2種
            { elements: ['C', 'C', 'C', 'C', 'C'], hCount: 10, skeleton: 'chain' },        // 12: C₅H₁₀ 鎖式 5種
            { elements: ['C', 'C', 'C', 'C', 'C'], hCount: 10, skeleton: 'ring' },         // 13: C₅H₁₀ 環式 5種
            { elements: ['C', 'C', 'C', 'C', 'C', 'C'], hCount: 12, skeleton: 'chain' },   // 14: C₆H₁₂ 鎖式 13種（★教科書のアルケン13種そのもの）
            { elements: ['C', 'C', 'C', 'C', 'C', 'C'], hCount: 12, skeleton: 'ring' },    // 15: C₆H₁₂ 環式 12種
            // ── 不飽和度2以上（群を分けて出す。IP_TRAINING_DOU）──
            { elements: ['C', 'C', 'C'], hCount: 4, skeleton: 'chain' },                   // 16: C₃H₄  鎖式 2種（プロピン・アレン）
            { elements: ['C', 'C', 'C', 'C'], hCount: 6, skeleton: 'chain' },              // 17: C₄H₆  鎖式 4種
            { elements: ['C', 'C', 'C', 'C', 'C'], hCount: 8, skeleton: 'chain' },         // 18: C₅H₈  鎖式 9種（★アレン3件は外さない・ユーザー判断）
            // ── 立体まで答える回（v1435・DESIGN_stereo_point.md）──────────────
            // ⚠ **お題ボタンに種類数を出さない**（ユーザー判断 2026-08-20「満点は採点時に示せばよい」）。
            //   ⚠ 環を含む全異性体で取ること —— 鎖式に絞ると **C₅H₁₀ のメソ体
            //   （1,2-ジメチルシクロプロパン）が消える**（§1-2b）。だから `skeleton` は付けない。
            //   ⚠ **列挙は増えない** —— どちらも上の 8 / 9 と同じ分子式で、`_rawCache` を分け合う
            { elements: ['C', 'C', 'C', 'C', 'C'], hCount: 10, stereoAsked: true },        // 19: C₅H₁₀  構造10種・場所3か所・立体込み13（★メソ体が居る）
            { elements: ['C', 'C', 'C', 'C', 'C', 'O'], hCount: 12, stereoAsked: true }    // 20: C₅H₁₂O 構造14種・場所4か所・立体込み18（畳み込み無し）
        ];
        // 生の列挙の使い回し（分子式ごとに1回だけ数える）。鎖式と環式は同じ列挙を分け合う
        this._rawCache = new Map();

        /**
         * ★ 芳香族のプリセット（B・DESIGN_practice_revision.md §4-3・§4-4）。
         *
         * ⚠ **`problems` に足してはいけない。** あちらは `enumerate(index)` →
         *   `enumerateConstitutionalIsomers` の道で、C₈H₁₀（重原子8個・不飽和度4）は
         *   **打ち切り**になる（実測: 素の列挙は 3.9 秒かけて overflow）。
         *   芳香族の回はベンゼン環を種にする `startFromFormula` の分岐が持っているので、
         *   **分子式の文字列だけを持ち、押したら `startFromFormula` を呼ぶ**別の枠にする。
         *   ここが `problems` へ移されたら `BZ7` が赤くなる。
         *
         * ⚠ クリア記録の鍵は `chemIsomerPractice.<式>@ar`（§11-4。既存のまま）。
         *   ボタンの ✓ もこの鍵で引く ＝ 入口を足しても記録の持ち主は増えない
         */
        this.aromaticPresets = ['C8H10'];
        this._arCache = new Map();

        if (this.body) {
            // 初回描画は列挙（最大 ~150ms）で初期ロードを妨げないよう次フレームに回す
            setTimeout(() => { if (!this.active) this.renderList(); }, 0);
        }
    }

    // 指定問題の異性体を列挙してキャッシュする。formula は列挙結果から求めて表記を一意にする。
    // ⚠ 骨格の型（`skeleton`）で絞るのは**列挙のあと**。生の列挙は分子式ごとに1回だけ走らせ、
    //   鎖式・環式の2つのお題で分け合う（C₆H₁₂ は 1回で 357ms。2回数えると学習パネルを
    //   開くたびに倍払うことになる）
    enumerate(index) {
        if (!this._cache.has(index)) {
            const p = this.problems[index];
            const rawKey = p.elements.join(',') + '/' + p.hCount;
            if (!this._rawCache.has(rawKey)) {
                this._rawCache.set(rawKey,
                    enumerateConstitutionalIsomers(p.elements, p.hCount, IP_ENUM_LIMIT));
            }
            const { isomers, overflow } = this._rawCache.get(rawKey);
            const picked = p.skeleton ? isomers.filter(m => ipMatchesSkeleton(m, p.skeleton)) : isomers;
            const formula = isomers.length ? this.game.computeMolecularFormula(isomers[0]) : '';
            this._cache.set(index, { isomers: picked, overflow, formula, skeleton: p.skeleton || null });
        }
        return this._cache.get(index);
    }

    /**
     * クリア記録の鍵の**しっぽ**（分子式のうしろに付く分）。
     * ⚠ **同じ分子式でも出題が違えば別の記録**（§11-4）。骨格の型（`@ar`/`@chain`/`@ring`）に
     *   立体まで答える回（`@stereo`）が加わった（v1435）。
     * ⚠ **鍵を作る場所をここ1か所にする** —— ボタンの ✓ と `grade()` の書き込みが
     *   別々に組み立てていると、片方だけ直したときに「✓ が付かない回」が黙って生まれる
     */
    clearKeyTail(p) {
        if (!p) return '';
        const scope = p.aromaticOnly ? 'aromatic' : p.skeleton;
        return (scope ? IP_SCOPES[scope].key : '') + (p.stereoAsked ? '@stereo' : '');
    }

    // クリア記録の鍵。⚠ **同じ分子式でも範囲が違えば別の出題**なので鍵を分ける（§11-4）
    // 第2引数は骨格の型の文字列（従来の呼び方）でも、お題そのもの（オブジェクト）でも受ける
    isCleared(formula, scope) {
        const tail = (scope && typeof scope === 'object')
            ? this.clearKeyTail(scope)
            : (scope ? IP_SCOPES[scope].key : '');
        try { return localStorage.getItem('chemIsomerPractice.' + formula + tail) === '1'; }
        catch (e) { return false; }
    }

    /** いまの出題の「範囲」（骨格の型）。null なら全異性体。⚠ **名乗る言葉はここからしか出さない** */
    scopeInfo(problem) {
        const p = problem || this.problem;
        if (!p) return null;
        if (p.aromaticOnly) return IP_SCOPES.aromatic;
        return p.skeleton ? IP_SCOPES[p.skeleton] : null;
    }

    /**
     * その分子式に対して用意してある「骨格の型で分けたお題」の名前を並べる。
     * ⚠ 20種を超えて断るときに**行き先を出す**ために使う（v1433）——
     *   黙って「25種です」と断ると、13種の回が用意してあることに永久に気づけない
     */
    skeletonProblemsFor(heavy, h) {
        const want = heavy.slice().sort().join(',');
        const out = [];
        this.problems.forEach((p, i) => {
            if (!p.skeleton || p.hCount !== h) return;
            if (p.elements.slice().sort().join(',') !== want) return;
            const d = this.enumerate(i);
            if (!d.overflow && d.isomers.length >= IP_MIN_ISOMERS && d.isomers.length <= IP_MAX_ISOMERS) {
                out.push(`${d.formula}（${IP_SCOPES[p.skeleton].tag}・${d.isomers.length}種）`);
            }
        });
        return out;
    }

    /**
     * 芳香族プリセット1件の下ごしらえ（ボタンの表記に要る「式」と「種類数」だけ）。
     * ★ **`startFromFormula` と同じ種つき列挙**（`enumerateBenzeneRingIsomers`）を使う ＝
     *   ボタンに出す種類数と、押して開く回の総数が**同じ計算から出る**。
     *   ここで別の数え方をすると「（4種）と書いてあるのに全 5 種で開く」が黙って生まれる。
     */
    prepareAromatic(str) {
        if (this._arCache.has(str)) return this._arCache.get(str);
        const out = { disabled: true, formula: str, count: 0 };
        try {
            const parsed = this.parseFormula(str);
            const seed = parsed && enumerateBenzeneRingIsomers(parsed.heavy, parsed.h);
            if (seed && seed.applicable && !seed.overflow && seed.isomers.length >= IP_BENZENE_MIN_ISOMERS) {
                out.disabled = false;
                out.formula = this.game.computeMolecularFormula(seed.isomers[0]);
                out.count = seed.isomers.length;
            }
        } catch (e) { console.error('[IsomerPractice] 芳香族プリセットの準備に失敗:', str, e); }
        this._arCache.set(str, out);
        return out;
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

        /**
         * ★ お題を2つの群に分けて並べる（v1433・ユーザー補足 2026-08-20）。
         *
         * > 環や二重結合が複数ある化合物の書き出しは、入試問題に出される可能性は極めて低いが、
         * > トレーニングとしてはやる価値がありそう
         *
         * ⚠ **出さない**のではなく、**同じ顔で並べない**。⚠ 難易度の段としては持たない
         *   （難しさの話ではなく、正解に並ぶ骨格の話）。
         * ⚠ 画面の文言で出題頻度を名乗らない（repo の入試DBは分子式ごとの件数を持っていない）。
         *   言うのは「何が正解に並ぶか」だけ。
         */
        const makeGrid = () => {
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:6px;';
            return grid;
        };
        const makeButton = (p, i) => {
            const data = this.enumerate(i);
            const sc = p.skeleton ? IP_SCOPES[p.skeleton] : null;
            const cleared = this.isCleared(data.formula, p);
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.dataset.ipProblem = String(i);
            btn.style.cssText = 'font-size:12px; padding:7px 6px; text-align:center;' +
                (cleared ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
            // ⚠ **お題の名前だけで範囲が言い切れること**（ユーザー判断 2026-08-20）。
            //    「（鎖式・13種）」まで読めば、開く前に何を書き出すのかが分かる
            // ★ 立体まで答える回だけは**種類数を出さない**（v1435・ユーザー判断
            //    「満点は採点時に示せばよい」）。名乗るのは分子式と「立体まで」の2つだけ
            btn.textContent = p.stereoAsked
                ? `${data.formula}（立体まで）${cleared ? ' ✓' : ''}`
                : `${data.formula}${sc ? '（' + sc.tag + '・' : '（'}${data.isomers.length}種）${cleared ? ' ✓' : ''}`;
            if (p.stereoAsked) {
                btn.title = '構造異性体を全部描き、立体が分かれる場所を指し、' +
                    '立体異性体も含めた総数まで答える回です（種類数は採点のときに出します）';
            } else if (sc) {
                btn.title = sc.tip;
            }
            btn.disabled = data.overflow || data.isomers.length < IP_MIN_ISOMERS;
            btn.addEventListener('click', () => this.start(i));
            return btn;
        };
        const basic = makeGrid(), training = makeGrid(), stereo = makeGrid();
        this.problems.forEach((p, i) => {
            if (p.stereoAsked) { stereo.appendChild(makeButton(p, i)); return; }
            const dou = ipUnsaturation(p.elements, p.hCount);
            (dou >= IP_TRAINING_DOU ? training : basic).appendChild(makeButton(p, i));
        });
        this.body.appendChild(basic);
        if (training.children.length) {
            const wrap = document.createElement('div');
            wrap.id = 'ip-training-problems';
            wrap.style.cssText = 'margin-top:8px;';
            const lab = document.createElement('div');
            lab.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px; line-height:1.5;';
            lab.textContent = 'じっくり練習する回（環や多重結合を合わせて2つもつ式。三重結合・ジエン・アレンまで数えます）:';
            wrap.appendChild(lab);
            wrap.appendChild(training);
            this.body.appendChild(wrap);
        }

        /**
         * ★ 立体まで答える回（v1435・DESIGN_stereo_point.md §3-2）。
         *
         * **なぜ「つまみ」ではなく「お題」か**: つまみ（☑ 立体まで答える）にすると、
         * 場所が0か所のお題でも段が付いて **7問中5問が空振り**する（§1-2a の実測）。
         * 芳香族の回と同じ「宣言した出題」を1行のボタンで名乗る形にそろえる。
         *
         * ⚠ **①（選ぶ前に問題の重さが分からない）への答えは、この置き場所そのもの**
         *   （`DESIGN_practice_revision.md` §2 U1 の却下理由①）——
         *   上の群に `C₅H₁₀（10種）` が並んでいるので、**重さは隣のボタンが名乗っている**。
         *   この回は「同じ書き出し ＋ 総数の1問」であって、未知の重さではない。
         *   ⚠ 裏返すと、**構造の数は隣から読める**（隠しきってはいない）。
         *   隠し通したいなら素の回を畳む必要があり、それは別の決定になる（設計書 §9-5a に書いた）
         */
        if (stereo.children.length) {
            const stWrap = document.createElement('div');
            stWrap.id = 'ip-stereo-problems';
            stWrap.style.cssText = 'margin-top:8px;';
            const stLab = document.createElement('div');
            stLab.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px; line-height:1.5;';
            stLab.textContent = '立体まで答える回（構造異性体を書き出し、立体が分かれる場所を指して、' +
                '立体異性体も含めた総数まで答えます。種類数は採点のときに出します）:';
            stWrap.appendChild(stLab);
            stWrap.appendChild(stereo);
            this.body.appendChild(stWrap);
        }

        // ★ 芳香族の回（B・§4-3）。**実装は動いているのに画面から入口が無く**、
        //   入力欄に `C8H10` と打てる人にしか届いていなかった（実測 M12）。
        //   ⚠ 上のグリッドとは**別の枠**（押すと `startFromFormula` を呼ぶ）。
        //   ⚠ 文言に「芳香族」を必ず入れる（§11-4「宣言した以上、画面のどこでも隠さない」）
        const arList = this.aromaticPresets.map(s => ({ src: s, data: this.prepareAromatic(s) }))
            .filter(x => !x.data.disabled);
        if (arList.length) {
            const arWrap = document.createElement('div');
            arWrap.id = 'ip-aromatic-presets';
            arWrap.style.cssText = 'margin-top:8px;';
            const arLabel = document.createElement('div');
            arLabel.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px;';
            arLabel.textContent = 'よく出る芳香族の回（ベンゼン環をもつ構造だけを数えます）:';
            arWrap.appendChild(arLabel);
            const arGrid = document.createElement('div');
            arGrid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:6px;';
            arList.forEach(({ src, data }) => {
                // ★ 記録の鍵は従来どおり `<式>@ar`（§11-4）。ボタンの ✓ もこれで引く
                const cleared = this.isCleared(data.formula, 'aromatic');
                const btn = document.createElement('button');
                btn.className = 'view-btn';
                btn.dataset.ipAromatic = src;
                btn.style.cssText = 'font-size:12px; padding:7px 6px; text-align:center;' +
                    (cleared ? ' border-color:var(--color-cyan); color:var(--color-cyan);' : '');
                btn.textContent = `${data.formula}（芳香族・${data.count}種）${cleared ? ' ✓' : ''}`;
                btn.title = 'ベンゼン環をもつ構造異性体だけを書き出す回です（環をもたない異性体は対象外）';
                btn.addEventListener('click', () => this.startFromFormula(src));
                arGrid.appendChild(btn);
            });
            arWrap.appendChild(arGrid);
            this.body.appendChild(arWrap);
        }

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
        this.beginSession({
            index, elements: p.elements, hCount: p.hCount, formula: data.formula,
            skeleton: p.skeleton || null, stereoAsked: !!p.stereoAsked
        }, data.isomers);
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
            // ★ 骨格の型で分けたお題が用意してあるなら、断るついでに**行き先を出す**（v1433・A-5）。
            //   ここを黙って「25種です」で終えると、13種の回があることに永久に気づけない
            //   （C₆H₁₂ ＝ 鎖式13 ＋ 環式12。どちらも上限の内側に入っている）
            const alt = this.skeletonProblemsFor(parsed.heavy, parsed.h);
            if (alt.length) {
                g.showToast(
                    `${here} は構造異性体が${isomers.length}種（練習で扱うのは${IP_MAX_ISOMERS}種まで）。` +
                    `骨格の型で分けたお題を用意しています —— ${alt.join('・')}。` +
                    'お題の一覧から選んでください。', 9000);
                return;
            }
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
        // ★ 元の構造異性体の一覧は**そのまま持つ**（v1440）。⚠ `targets` から作り直すと、
        //   シス・トランスに分けた写しをもう一度分けようとして「やり直す」で数が変わる
        this._isomers = isomers;
        // ★ 立体まで答える回だけ、**鎖式の C=C を別の答案として数える**（v1440・ユーザー報告
        //   「鎖式は シス・トランスを別に書き出すのが自然」）。⚠ 分けるのは C=C だけで、
        //   不斉炭素・環は据え置き（理由は `ipGeoVariants` の前書き）
        this.geoSplit = new Set();
        this.targets = new Map();
        isomers.forEach(m => {
            const variants = meta.stereoAsked ? ipGeoVariants(m) : [{ code: canonicalCode(m), pos: null }];
            if (variants.length > 1) this.geoSplit.add(canonicalCode(m));
            variants.forEach(v => {
                // 分けた側は**座標を焼き付けた写し**を持つ ＝ 正解の列にシス・トランスが別の図で並ぶ
                const target = v.pos ? ipCloneWithPos(m, v.pos) : m;
                if (v.pos) target._ipFixedLayout = true;
                this.targets.set(v.code, target);
            });
        });
        // ⚠ **満点も「あと何種」も `targets` を数える**（分けたぶんが混ざらない数を2つ持たない）
        this.problem.total = this.targets.size;
        this.problem.structures = isomers.length;   // 構造異性体そのものの数（文言で言い分けるため）
        // ★ 段2 の正解（立体異性体まで含めた総数）は**ここで一度だけ数える**（v1435）。
        //   出どころは `countStereoisomers` ひとつ ＝ 画面のどこで出しても同じ数になる。
        //   ⚠ 座標を1つも見ずに数えるので、図の描き方に左右されない（§1-3）
        this.problem.stereoTotal = meta.stereoAsked
            ? isomers.reduce((n, m) => {
                const info = countStereoisomers(m);
                return n + (info.overflow ? 0 : info.count);
            }, 0)
            : null;
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
     *   'unread'  … ★ シス・トランスを別に数える回で、**まだ C=C の向きが決まっていない**（v1440）。
     *               **正解でも不正解でもない**ので種類に数えず、数だけ出す（`stereoPractice` の §5-4 と同じ扱い）
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
            const row = { part, mark, formula, code: null, status: 'formula', dup: false, missBonds: 0 };
            if (formula === this.problem.formula) {
                // ★ 鍵の作り方は**答案集合を作ったときと同じ式**（v1440）。
                //   分けた構造だけ「鎖式 C=C の向きまで入れた鍵」で突き合わせる
                const cc = canonicalCode(part);
                if (this.geoSplit && this.geoSplit.has(cc)) {
                    const geo = readBondGeoFromCoords(part);
                    const need = stereoUnitsOf(part).bonds.length;
                    row.missBonds = need - Object.keys(geo).length;
                    row.code = row.missBonds > 0 ? null : ipGeoCode(part, geo);
                } else {
                    row.code = cc;
                }
                if (row.missBonds > 0) {
                    // ★ 第3の状態。**間違いだと言わない**（まだ向きが決まっていないだけ）
                    row.status = 'unread';
                } else if (this.targets.has(row.code)) {
                    row.status = 'ok';
                    row.dup = seen.has(row.code);
                    seen.add(row.code);
                } else if (this.scopeInfo()) {
                    // 範囲を宣言した回（芳香族・鎖式・環式）では「分子式は合うが対象外」が
                    // **正常に起こる**。ここを開発者向けの文言のままにすると、正しく描けた
                    // 生徒に不具合の顔を見せることになる（§11-4・BZ5）
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
        //    範囲を宣言した回（芳香族・鎖式・環式）だけは**同じ分子式でも別の出題**なので鍵を分ける
        // ★ 立体まで答える回は「全部描いた」だけでは足りない ＝ **段2 に正解して初めてクリア**
        //   （✓ の基準は「構造を全部描き、総数にも当てた」。ユーザー判断 2026-08-20）
        const cleared = found.size === this.problem.total &&
            (!this.problem.stereoAsked || this.stereoTotalCorrect());
        if (cleared) {
            const key = 'chemIsomerPractice.' + this.problem.formula + this.clearKeyTail(this.problem);
            try { localStorage.setItem(key, '1'); } catch (e) { /* noop */ }
        }
        return { rows, found, dupGroups, missing };
    }

    /** 採点表の1行を人の言葉にする（§12-2 の表。**責めない文言**を守る場所） */
    verdictOf(row) {
        switch (row.status) {
            case 'ok':
                return row.dup ? '同じものをもう一度' : '✓';
            case 'unread':
                // ★ シス・トランスを別に数える回の第3の状態（v1440）。**責めない文言**
                return 'まだシス・トランスが決まっていません' +
                    `（C=C の向きが読めません: ${row.missBonds}本。二重結合を横にして、両側の基を軸の上下に描いてください）`;
            case 'scope':
                // 範囲を宣言した回は「分子式は合うが対象外」が**正常に起こる**。
                // 開発者向けの断り文にすると、正しく描けた生徒に不具合の顔を見せてしまう（§11-4）
                return (this.scopeInfo() || IP_SCOPES.aromatic).reject;
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
        // ★ 表の中で `🔢` を押した行（F・§8-1）。**行ごと**に持つ ＝ 全行に常時は出さない
        this._numbered = new Set();
        // ★ 段1・段2 の状態（v1435）。⚠ ここで落とさないと前のお題の答えが持ち越される
        this._stereoOpened = false;    // 段1（☆ 立体の場所）を一度でも開いたか ＝ 段2 の関門（§7-3）
        this._stereoTotalInput = '';   // 段2 の答え（文字列のまま持つ。空欄と 0 を区別するため）
        if (this.game && this.game.deactivateStereoPointMode) this.game.deactivateStereoPointMode();
    }

    /**
     * ★ 満点の内訳に出す「書き出しのぶん」の言い方（v1440）。
     *
     * ⚠ **`total` を「構造異性体 N種」と呼べなくなった** —— シス・トランスを別の答案として
     * 数える回では `total`（＝答案の数）が構造異性体の数より多い（C₅H₁₀ は 11 と 10）。
     * 「構造異性体 11種」は**嘘**なので、分けた回は分けたことごと名乗る。
     */
    answerCountLabel() {
        const split = this.geoSplit && this.geoSplit.size > 0;
        return split
            ? `書き出す ${this.problem.total}種（構造異性体 ${this.problem.structures}種のうち ` +
              `${this.geoSplit.size}種はシス・トランスを別に数えます）`
            : `構造異性体 ${this.problem.total}種`;
    }

    /** 段2 の答えが当たっているか。⚠ **判定はここ1か所**（採点・クリア記録・解説が同じ答えを見る） */
    stereoTotalCorrect() {
        if (!this.problem || !this.problem.stereoAsked) return false;
        const n = parseInt(String(this._stereoTotalInput).trim(), 10);
        return Number.isFinite(n) && n === this.problem.stereoTotal;
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
        // 範囲を宣言した回（芳香族・鎖式・環式）は**出題そのものが違う**（全異性体ではない）ので
        // 見出しで必ず断る（設計 §11-4）
        const sc = this.scopeInfo();
        // ★ 立体まで答える回は**種類数を名乗らない**（v1435・ユーザー判断「満点は採点時に示せばよい」）。
        //   ⚠ 隠すのは数だけで、**何を書き出すのかは名乗る**（§11-4「宣言した以上、画面のどこでも隠さない」）
        head.textContent = this.problem.stereoAsked
            ? `✏️ ${this.problem.formula} の異性体（立体まで）`
            : (sc
                ? `✏️ ${this.problem.formula} ${sc.title}（全 ${this.problem.total} 種）`
                : `✏️ ${this.problem.formula} の異性体（全 ${this.problem.total} 種）`);
        this.body.appendChild(head);

        if (this.problem.stereoAsked) {
            const sNote = document.createElement('div');
            sNote.id = 'ip-stereo-note';
            sNote.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px; line-height:1.5;';
            // ★ 「宣言した以上、画面のどこでも隠さない」（§11-4）。数は伏せるが、
            //   **何を別々に書き出すのか**はここで言い切る（v1440）
            sNote.textContent = '※ この回は種類数を先に出しません（採点のときに満点を示します）。' +
                '鎖の C=C は シス・トランスを別々に描いてください（二重結合を横にして、両側の基を軸の上下に）。' +
                '不斉炭素と環の立体は図では描き分けず、「☆ 立体の場所」で印を付け、' +
                '最後に「立体異性体も含めた総数」を書いてください。';
            this.body.appendChild(sNote);
        }

        if (sc) {
            const scope = document.createElement('div');
            scope.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px;';
            scope.textContent = sc.note;
            this.body.appendChild(scope);
        }

        const drawn = this.drawnCount();
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:6px;';
        // ⚠ **判定は1つも出さない**（§12-2）。書き出しの最中にキャンバスへ出すのは個数だけ
        // ⚠ 立体まで答える回は **鎖の C=C だけ**シス/トランスを別々に描く（v1440）。
        //    不斉炭素・環の立体は図では描き分けられないので段1・段2 で答える
        const stereoTail = this.problem.stereoAsked
            ? '（鎖の C=C はシス/トランスを別々に。不斉炭素・環の立体は総数の欄で答えます）'
            : '（シス/トランス・鏡像は数えません）';
        note.textContent = this._finished
            ? 'この問題は答え合わせを済ませました（採点は1問1回）。同じお題をもう一度解くか、別のお題を選べます。'
            : (drawn > 0
                ? `キャンバスが答案用紙です。いま ${drawn}個 描いてあります${stereoTail}。`
                : `キャンバスが答案用紙です。思いつく構造を並べて描き、「答え合わせ」で採点します${stereoTail}。`);
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
        // ★ 段1・段2（v1435・DESIGN_stereo_point.md §3）。**作業帯に増えるのは `☆ 立体の場所` の1つだけ**。
        //   段2 の入力欄は**段1 を一度でも開いたあとにだけ**出る（§7-3 の関門。点で釣らずに順序を守らせる）
        const stereoParts = { fields: [], actions: [] };
        if (this.problem.stereoAsked) {
            const on = !!this.game.stereoPointMode;
            stereoParts.actions.push({
                label: on ? '☆ 印づけをやめる' : '☆ 立体の場所',
                active: on,
                title: on
                    ? '印を残したまま、ふつうの作図に戻ります（印は答え合わせまで消えません）'
                    : '立体が分かれる場所に印を付けます。炭素をタップ＝原子の印／結合をタップ＝結合の印',
                onClick: () => this.toggleStereoPointMode()
            });
            if (this._stereoOpened) {
                stereoParts.fields.push({
                    id: 'ip-stereo-total',
                    label: '立体異性体も含めた総数:',
                    suffix: '種',
                    value: this._stereoTotalInput,
                    placeholder: '?',
                    title: '構造異性体の数ではなく、シス/トランス・鏡像まで数え分けた総数です',
                    onInput: (v) => { this._stereoTotalInput = v; }
                });
            }
        }
        this.game.setPracticeStrip({
            live: this.stripLiveHtml(),
            // ⚠ **`n/総数` にしない**（§12-2）。分母を出すと「いくつ正解したか」に見えるが、
            //    ここが数えているのは**描いてある図の個数**で、正誤は1つも見ていない
            progress: `${drawn}個`,
            fields: stereoParts.fields,
            actions: [
                ...stereoParts.actions,
                { label: '🔍 答え合わせ', primary: true, disabled: drawn === 0,
                  title: '答案用紙を採点してスコアを出し、この問題を終わります（1問1回）',
                  onClick: () => this.finishAnswer() },
                // ★ **ここがヒントへの入口**（A・v1368・§13-1）。作業帯から1手で確認モードへ入り、
                //   その面の中で 💡 を押す。0個でも押せる ＝ 1つも描けずに行き詰まっている人こそ要る
                { label: '🔎 確認・ヒント',
                  title: '自分の図を大きく並べ、💡ヒントもここで押せます（名前・同一判定は出しません）',
                  onClick: () => this.toggleReview('progress') },
                // ★ 答案を並べ直す（W4・§12-5）。**帯に置くのは「キャンバスを見ながら押す」道具だから**
                //   ——💡ヒントを帯から1手の面へ出したのと同じ理由（A・v1368）。
                //   散らかっているのはキャンバスなので、覆う面の中に隠すと押しどきが分からない。
                //   ⚠ 2個未満では押せない ＝ 並べる相手がいないときに動かさない
                { label: '🧹 並べ直す', disabled: drawn < 2,
                  title: '答案どうしの重なりをほどいて格子に並べ直します（図の形は変わりません。↩ で戻せます）',
                  onClick: () => this.tidySheet() },
                { label: 'やめる', title: '練習をやめてお題選びに戻ります（図は消えません）',
                  onClick: () => this.stop() }
            ]
        });
    }

    /**
     * ★ 段1（☆ 立体の場所）の出入り口（v1435・§4-2）。
     *
     * ON/OFF のトグルで、**OFF にしても印は残る**。締める（＝採点する）のは
     * `🔍 答え合わせ` を押したときだけで、それは1問1回。
     * ⚠ 一度でも開いたら `_stereoOpened` が立ち、段2 の入力欄が出る（§7-3 の関門）。
     *   ⚠ **段は戻さない** —— 閉じてもう一度開いても関門は開いたまま（開き直しで罰しない）
     */
    toggleStereoPointMode() {
        if (!this.active || !this.problem || !this.problem.stereoAsked || this._finished) return;
        const g = this.game;
        if (g.stereoPointMode) {
            g.deactivateStereoPointMode();
        } else {
            // ほかの「タップに別の意味があるモード」と同居させない（一覧は tapHasOtherMeaning）
            g.setTool('select');
            g.stereoPointMode = true;
            this._stereoOpened = true;
            g.showToast('立体が分かれる場所に印を付けてください。炭素をタップ＝原子の印／結合の真ん中をタップ＝結合の印。もう一度押すと印づけをやめます。', 5000);
        }
        g.updateDrawing();
        this.renderStrip();
        this.renderSession();
    }

    /**
     * 「🧹 並べ直す」（W4・§12-5）。実体は `game.tidyAnswerSlots()` ＝ **成分ごとの平行移動だけ**。
     * ここに置くのは押しものの配線と言葉だけで、**幾何の判断は1つも持たない**
     * （立体の練習（§5-6）や芳香族（§4-2）が同じ道具を使うので、実体は game 側に1つ）。
     */
    tidySheet() {
        const r = this.game.tidyAnswerSlots();
        if (r.moved > 0) {
            this.game.showToast(`答案 ${r.total}枚を ${r.cols}×${r.rows} に並べ直しました（図の形は変えていません。↩ で戻せます）`);
            return;
        }
        if (r.reason === 'alreadyTidy') this.game.showToast('もう並んでいます。');
        else if (r.reason === 'outOfBounds') this.game.showToast('答案が多すぎて並べ直せません。いくつか消してからもう一度押してください。', 4000);
        else if (r.reason === 'clearance') this.game.showToast('うまく並べられませんでした。図を少し動かしてからもう一度押してください。', 4000);
        else this.game.showToast('並べ直す答案がありません。');
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
        const sc = this.scopeInfo();
        // ★ 立体まで答える回は帯でも種類数を出さない（v1435）。⚠ ここを直し忘れると、
        //   お題ボタンで隠した数がキャンバスの真下に出る ＝ 隠したことにならない
        if (this.problem.stereoAsked) {
            return `お題 <b>${esc(this.problem.formula)}</b>（立体まで） の異性体 ／ ` +
                `いま <span class="ws-live-ok">${n}個</span> 描いてあります`;
        }
        return `お題 <b>${esc(this.problem.formula)}</b>${sc ? '（' + sc.tag + '）' : ''} の異性体 ` +
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

    /**
     * スコア（§15-5b）。**百分率にしない**（難しい問題ほど取りこぼしが軽く見えるため）。
     *
     * ★ 立体まで答える回だけ **満点 ＝ 構造異性体の総数 N ＋ 1**（§7-2。＋1 は段2 の1問ぶん）。
     * ⚠ **段1（場所の指摘）は点にしない**（§7-3）。3通り試してどれも壊れたため:
     *     場所1つに1点 → 満点が段1の答えそのもの／構造1つに1点 → 何も指さずに 8/10 取れる／
     *     段1 全体で1点 → 部分点が無い段は「やらないほうが安い」と読まれる。
     *   代わりに**段2 の関門**にしてある（☆ を開かないと総数の欄が出ない）。
     *   ⚠ 採点表には ○△ を必ず返す（点にしないだけで、正誤は黙らない・§4-4）
     */
    scoreOf(sheet) {
        const base = sheet.found.size;   // 正しく描けた**種類数**（ダブりは1種類 ＝ 二重に罰さない）
        if (!this.problem.stereoAsked) {
            return { raw: base, hints: this._hintLevel, score: Math.max(0, base - this._hintLevel), total: this.problem.total };
        }
        const bonus = this.stereoTotalCorrect() ? 1 : 0;
        const given = String(this._stereoTotalInput).trim();
        return {
            raw: base + bonus, base, bonus, given,
            stereoTotal: this.problem.stereoTotal,
            hints: this._hintLevel,
            score: Math.max(0, base + bonus - this._hintLevel),
            total: this.problem.total + 1
        };
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
    /**
     * ★ 正解の名前は**総称**（立体を反映しない名前）で引く（v1433）。
     *
     * このお題が数えているのは**構造異性体だけ**（§4.2「シス・トランスや鏡像の区別は数えません」）。
     * ⚠ ところが `lookupCompoundName` は「立体を名前に反映する」トグルが ON のとき、
     *   ライブラリの**立体つき登録**と描かれた立体が一致しないと名前を返さない。
     *   列挙が返す正解は**座標を持たない**（立体が読めない）ので、
     *   **環の不斉をもつ種はトグル ON のとき軒並み名無しになる** ——
     *   実測（C₆H₁₂ 環式）: `1,1,2-トリメチルシクロプロパン`・`1,2-ジメチルシクロブタン`・
     *   `1-エチル-2-メチルシクロプロパン` の3件が「（名称未登録）」に落ちた。
     *   ⚠ 鎖式が無事なのは `iupacName` が拾うからで、**環には系統名が無い**ので受け皿が無い。
     *
     * → **数えていない軸（立体）のせいで名前を落とさない。** トグルの値に関わらず総称で引く。
     *   ⚠ トグルそのものは触らない（自由モードの見え方は1つも変えない）。
     *   `IP4` と `IW21` がこれを見張る。
     *
     * ⚠ **`readStereo = false` にするだけでは足りない**（2026-08-22）。
     *   OFF は「D/L・α/β を名前に出さない」という意味でしかなく、
     *   **ハース環として描かれた図は OFF でも α/β まで言い切る**ようになった
     *   （`game.js` の `lookupCompoundName` の「ハース環の例外」）。
     *   ここが欲しいのは**立体の一切入らない名前**なので、
     *   トグルの値に暗黙に頼らず `opt.noStereo` で言い切る。`HW4` がこれを見張る。
     */
    constitutionalName(mol) {
        const g = this.game;
        const keep = g.readStereo;
        try {
            g.readStereo = false;
            return g.lookupCompoundName(mol, { noStereo: true });
        } finally {
            g.readStereo = keep;
        }
    }

    answerPairs(sheet) {
        const rows = [...this.targets.entries()].map(([code, mol]) => ({
            code, mol, name: this.constitutionalName(mol), key: isomerSeriesKey(mol), mine: []
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
        // ★ 段1 の採点をこの表の上でやる（v1435・§4-4「行 ＝ 1つの構造異性体」）。
        //   ⚠ 突き合わせは `canonicalCode` の一致（上の `byCode`）＝ **並び順で突き合わせない**。
        //   ⚠ 判定は `gradeStereoPoints` 1本だけを通す（§8-2）。ここで `stereoUnitsOf` を
        //     直に呼ぶと**2つ目の判定**になり、片方だけ直る事故の種になる
        if (this.problem.stereoAsked) {
            rows.forEach(r => {
                if (!r.mine.length) { r.points = null; return; }
                // 同じ構造を2枚描いた人には**出来のよいほうを採る**（二重に罰さない・§12-7a と同じ扱い）
                r.points = r.mine
                    .map(m => gradeStereoPoints(m.part, stereoMarksOf(m.part)))
                    .reduce((best, p) => (best && (best.missing + best.extra) <= (p.missing + p.extra) ? best : p), null);
            });
        }
        return rows;
    }

    /**
     * 段1 の1行を人の言葉にする（§4-4 の表。**責めない文言**を守る場所）。
     * 戻り値 `{ mark, text }`（`mark` は '○' / '△' / '—'）
     */
    stereoPointVerdict(points) {
        if (!points) return { mark: '—', text: 'この構造を描いていないので、場所も採れていません。' };
        if (points.ok) {
            return points.expected === 0
                ? { mark: '○', text: 'この構造には立体が分かれる場所がありません。指さなかったのは正解です。' }
                : { mark: '○', text: `立体が分かれる場所は ${points.expected} か所。合っています。` };
        }
        const parts = [];
        if (points.missing > 0) {
            const why = [];
            if (points.missingCenters.length) why.push('4つの基がすべてちがう炭素があります');
            if (points.missingBonds.length) why.push('この図の C=C は、両端がちがう基なのでシス・トランスが書けます');
            parts.push(`あと ${points.missing} か所あります（${why.join('。')}）。`);
        }
        if (points.extra > 0) {
            const why = [];
            if (points.extraCenters.length) why.push('4つの基のうち 2 つが同じです');
            if (points.extraBonds.length) why.push('その結合はシス・トランスが書けません（環の中か、片側の 2 つの基が同じです）');
            parts.push(`印のうち ${points.extra} つは立体が分かれる場所ではありません（${why.join('。')}）。`);
        }
        return { mark: '△', text: parts.join(' ') };
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
            // ★ 印モードは採点で締める（§4-2「締めるのは答え合わせだけ」）。
            //   ⚠ 印そのものは消さない —— 採点した答案は自由モードでそのまま見返せる（§12-6）
            this.game.deactivateStereoPointMode();
            // ★ 採点が済んだ ＝ **この学習コンテンツはここで終わり**（v1392・ユーザー決定）。
            //   居場所を 🧪自由 へ移す ＝ タブが「学習」のまま中身だけ終わっている状態を作らない。
            //   ⚠ セッションは**生かしたまま**。`setMode` のガードに
            //     「`_finished` の練習は 🧪自由 へ持って出る」例外を入れてある（game.js）ので、
            //     「🔍 結果を見る」「↻ もう一度」の帯はこの後も残る。
            //   ⚠ キャンバスには触らない（§12-6）。採点した答案はそのまま自由モードで触れる。
            this.game.setMode('free');
        }
        this.openReview('answer');
    }

    /** 同じお題を白紙からやり直す（終了後の唯一の続き方）。ヒントの段も0に戻る */
    restartProblem() {
        if (!this.problem) return;
        // ★ 採点して終了したあとは 🧪自由 に居る（v1392）。もう一度解き始める ＝ 学習へ戻す。
        //   ここで戻さないと、`_finished` が下りた練習が自由モードに取り残され、
        //   次に `setMode` が走った瞬間に上のガードが黙って捨てる。
        if (this.game.currentMode !== 'learn') this.game.setMode('learn');
        const meta = { ...this.problem };
        delete meta.total;
        delete meta.structures;
        // ⚠ **元の構造異性体の一覧を渡す**（v1440）。`targets` にはシス・トランスへ分けた
        //   写しが入っているので、そこから作り直すと分け直しが二重に掛かる
        this.beginSession(meta, this._isomers || [...this.targets.values()]);
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
        // ★ 立体まで答える回は、**採点のこの瞬間に満点の作り方を明かす**（v1435・ユーザー判断）。
        //   先に出さない代わりに、なぜその満点なのかをここで言い切る
        d.textContent = this.problem.stereoAsked
            ? `正しく描けた ${s.base}種 ＋ 総数 ${s.bonus}点 − ヒント ${s.hints}段 ＝ ${s.score}点` +
              `（満点は ${this.answerCountLabel()} ＋ 総数の1問 ＝ ${s.total}点。同じものを2回描いても減点はしません）`
            : `正しく描けた ${s.raw}種 − ヒント ${s.hints}段 ＝ ${s.score}点` +
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
        // ★ 1個 ⇄ 2個以上も帯ごと組み直す（W4）。「🧹 並べ直す」の押せる／押せないが
        //   ここで変わる ＝ 2つ目を描いてもボタンが灰色のまま、を作らない
        if ((n === 0) !== (this._stripDrawn === 0) || (n < 2) !== (this._stripDrawn < 2)) {
            this.renderStrip(); return;
        }
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
        // ★ **🧪自由 の面も一緒に畳む**（v1392）。採点して終了すると居場所が自由モードへ移り、
        //   `#ws-free`（名称呼び出し・🔬調べる）が出たままになる ＝ 自分の面だけ畳んでも
        //   帯が消えず、オーバーレイの下端（← 描画に戻る／やめる）を覆う。
        //   畳む相手が「自分の面とは限らなくなった」のがこの追加の理由。
        if (this.game.currentMode === 'free') this.game.setWorkPane('ws-free', false);
        this.renderReview();
    }

    closeReview() {
        if (this.overlay) this.overlay.classList.add('hidden');
        this._reviewing = false;
        // 畳んだ 🧪自由 の面を戻す（上の対）。`setMode('free')` と同じ条件で出す ＝
        // どの経路で閉じても「自由モードなら #ws-free が出ている」に揃う
        if (this.game.currentMode === 'free') this.game.setWorkPane('ws-free', true);
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
        const scopeHere = this.scopeInfo();
        title.textContent = (answerMode ? '答え合わせ' : '書き出しの確認') +
            ` — ${this.problem.formula}${scopeHere ? ' ' + scopeHere.title : ''}`;
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
            // ⚠ 立体まで答える回はここでも種類数を出さない（v1435。⚠ 直し忘れると
            //   「🔎 確認」を1回開くだけで隠した数が読める ＝ 隠したことにならない）
            summary.textContent = this.problem.stereoAsked
                ? `あなたが描いた図 ${sheet.rows.length}個。図をクリックすると作図に戻ります。同じかどうか・名前は「答えを見る」で確認できます。`
                : `あなたが描いた図 ${sheet.rows.length}個（全 ${this.problem.total} 種）。図をクリックすると作図に戻ります。同じかどうか・名前は「答えを見る」で確認できます。`;
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
            const pairs = this.answerPairs(sheet);
            // ★ 段2 の結果は**表より先**（§6(a)「場所は合っていたを先に言う」と同じ理由で、
            //   総数の答えを探して10行の表を下までスクロールさせない）
            if (this.problem.stereoAsked) this.overlay.appendChild(this.buildStereoTotalBox(pairs));
            this.overlay.appendChild(this.buildAnswerGrid(sheet, sc, dupColorOf, pairs));
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
    buildAnswerGrid(sheet, sc, dupColorOf, givenPairs) {
        const g = this.game;
        const wrap = document.createElement('div');
        wrap.id = 'ip-answer-grid';
        wrap.style.cssText = 'margin-bottom:12px;';

        // ★ 表とサマリーが同じ配列から出ることを、この2行で担保する
        // ⚠ 段2 の箱も**同じ配列**を受け取る（呼ぶ側が1回だけ作る）。作り直すと、
        //    段1 の ○△ と「場所の指摘は合っていました」が別々の採点から出ることになる
        const pairs = givenPairs || this.answerPairs(sheet);
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

            // ★ この行の `🔢` が押されているか（F・§8-1）。**押した行だけ**両側に番号が出る
            const numOn = this._numbered.has(p.code);
            row.dataset.ipNumbered = numOn ? '1' : '0';

            // ★ 名前だけを出す（発注書 D の 3）。`✓` も `（未発見）` も**結果列が言う**ので落とす
            const left = this.makeCell(p.name || '（名称未登録）',
                { h: sc.rowH, border: found ? 'var(--color-cyan)' : 'var(--neon-orange)',
                  labelColor: found ? '#dff9ff' : 'var(--neon-orange)',
                  labelSize: IP_NAME_FONT.size, labelWeight: IP_NAME_FONT.weight },
                id => this.renderStandardFigure(id, p.mol, numOn));
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
                    const fig = this.figureOf(r.part);
                    const cell = this.makeCell(r.mark,
                        { h: sc.rowH, border: dupColor || 'rgba(255,255,255,0.14)',
                          borderWidth: dupColor ? '2px' : '1px', labelSize: '12px' },
                        id => {
                            renderMoleculeIntoSvg(g, id, fig);
                            // ★ 自分の図にも**同じ道具で**帯と番号を重ねる（F の受け入れ条件）
                            if (numOn && g.drawIupacNumberingIntoSvg) g.drawIupacNumberingIntoSvg(id, fig);
                        });
                    cell.style.flex = '1 1 0';
                    cell.style.minWidth = '0';
                    cell.style.cursor = 'pointer';
                    cell.dataset.ipMark = r.mark;
                    cell.title = 'クリックで作図に戻る';
                    cell.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
                    mine.appendChild(cell);
                });
            }
            // ★ トグルは**右セルの中**（§8-1）。表の外に列を増やさず、行の右端に1つだけ置く
            mine.appendChild(this.numberToggleButton(p.code));
            row.appendChild(mine);
            wrap.appendChild(row);

            // ★ 段1 の結果（v1435・§4-4）。**行の下に1行**で返す。
            //   ⚠ 4列目を作らない —— 3列は「結果｜正解｜自分」で読み方が固まっており、
            //     列を増やすと小さい図の幅がさらに削れる（§12-7 の実測）
            if (this.problem.stereoAsked) {
                const v = this.stereoPointVerdict(p.points);
                const note = document.createElement('div');
                note.className = 'ip-stereo-point-note';
                note.dataset.ipPointsMark = v.mark;
                note.dataset.ipPointsCode = p.code;
                const col = v.mark === '○' ? 'var(--color-cyan)'
                    : (v.mark === '△' ? 'var(--neon-orange)' : 'var(--text-secondary)');
                note.style.cssText = `font-size:11px; line-height:1.5; margin:-2px 0 8px ${IP_RESULT_COL + 6}px; color:${col};`;
                note.textContent = `☆ ${v.mark} ${v.text}`;
                wrap.appendChild(note);
            }
        });
        return wrap;
    }

    /**
     * ★ 段2 の結果（v1435・DESIGN_stereo_point.md §6）。**答え合わせの面にだけ出る。**
     *
     * 並べる順は §6 のとおり:
     *   (a) 総数の答え合わせ ——⚠ **「場所は合っていた」を先に言う**
     *       （段1 を正しくやった人を、段2 の誤りで丸ごと否定しない）
     *   (b)(c) 畳み込みが起きた行の解説（メソ体 / 環の回転対称）
     *   (d) 畳み込みが無かった行は**出さない**（多数派なので、並べると見どころが埋まる）
     */
    buildStereoTotalBox(pairs) {
        const want = this.problem.stereoTotal;
        const s = this._finalScore;
        const given = s ? s.given : String(this._stereoTotalInput).trim();
        const hit = s ? s.bonus === 1 : this.stereoTotalCorrect();
        const box = document.createElement('div');
        box.id = 'ip-stereo-total-box';
        box.dataset.ipStereoResult = hit ? 'ok' : 'ng';
        box.style.cssText = 'border:1px solid var(--neon-purple); border-radius:8px; padding:8px 10px; margin-bottom:12px;' +
            ' background:rgba(224,176,255,0.07); font-size:13px; line-height:1.7;';
        const h = document.createElement('div');
        h.style.cssText = 'color:#e0b0ff; font-weight:bold; margin-bottom:2px;';
        h.textContent = '立体異性体も含めた総数';
        box.appendChild(h);

        // ★ 段1 が全部合っていたか（描いた行だけを見る。描いていない構造は段1 の対象外）
        const graded = pairs.filter(p => p.points);
        const allPoints = graded.length > 0 && graded.every(p => p.points.ok);
        const line = (t, style) => {
            const d = document.createElement('div');
            d.style.cssText = style || 'color:var(--text-secondary);';
            d.textContent = t;
            box.appendChild(d);
            return d;
        };
        if (hit) {
            line(`総数は ${want} 種です。あなたの答え ${given} 種 ―― 合っています。`,
                'color:var(--color-cyan); font-weight:bold;');
        } else {
            line(`立体異性体も含めた総数は ${want} 種です` +
                (given ? `（あなたの答え: ${given} 種）` : '（総数は書かれていませんでした）') + '。',
                'color:var(--neon-orange); font-weight:bold;');
            if (allPoints) {
                line('場所の指摘は合っていました。ちがったのは掛け算のほうです。');
            }
        }

        // (b)(c) 畳み込みが起きた行の解説
        // ⚠ **構造ごとに1回だけ**（v1440）。シス・トランスに分けた行は同じ構造を2行持つので、
        //    素直に舐めると同じ畳み込みの解説が2回出る
        const seenFold = new Set();
        const folded = pairs.map(p => {
            const info = countStereoisomers(p.mol);
            return { p, info, reason: info.overflow ? null : stereoFoldReason(p.mol) };
        }).filter(x => {
            if (!x.reason) return false;
            const cc = canonicalCode(x.p.mol);
            if (seenFold.has(cc)) return false;
            seenFold.add(cc);
            return true;
        });
        folded.forEach(({ p, info, reason }) => {
            const wrap = document.createElement('div');
            wrap.className = 'ip-stereo-fold';
            wrap.dataset.ipFoldReason = reason;
            wrap.style.cssText = 'margin-top:8px; padding-top:6px; border-top:1px dashed rgba(224,176,255,0.4);';
            stereoFoldLines(p.mol, p.name, info, reason).forEach(l => {
                const d = document.createElement('div');
                d.style.cssText = l.head ? 'color:#e0b0ff; font-weight:bold; margin-bottom:2px;'
                    : l.star ? 'color:var(--color-cyan); margin-top:4px;'
                    : l.formula ? 'color:#fff; font-weight:bold; margin:4px 0 0 16px;'
                    : l.sub ? 'color:var(--text-primary); margin-top:4px;'
                    : l.indent ? 'color:var(--text-secondary); margin-left:16px;'
                    : 'color:var(--text-secondary);';
                d.textContent = l.text;
                wrap.appendChild(d);
            });
            box.appendChild(wrap);
        });
        return box;
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
        const s = this._finalScore;
        // ⚠ 立体まで答える回は式が違う（満点 ＝ 構造の総数 ＋ 総数の1問）。
        //    ここを直し忘れると「満点はこのお題の異性体の総数 11種」という**嘘**が出る（実測で出た）
        note.textContent = (this._finished && s)
            ? (this.problem.stereoAsked
                ? `${foundLine}。正しく描けた ${s.base}種 ＋ 総数 ${s.bonus}点 − ヒント ${s.hints}段 ＝ ${s.score}点` +
                  `（満点は ${this.answerCountLabel()} ＋ 総数の1問 ＝ ${s.total}点。同じものを2回描いても減点はしません）`
                : `${foundLine}。正しく描けた ${s.raw}種 − ヒント ${s.hints}段 ＝ ${s.score}点` +
                  `（満点はこのお題の異性体の総数 ${s.total}種。同じものを2回描いても減点はしません）`)
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
            // ★ **お題に数えなかった図でも `🔢` は出す**（F の受け入れ条件④）。
            //   門番は §7 と同じ（`iupacNameDetail` が非 null なら出す）ので、
            //   「数えなかった」ことと「名前や番号を出せるか」は別のまま
            const key = 'x:' + r.mark;
            const numOn = this._numbered.has(key);
            const fig = this.figureOf(r.part);
            const cell = this.makeCell(`${r.mark} ${r.formula}`,
                { h: sc.rowH, border: 'var(--neon-purple)', labelColor: '#e0b0ff' },
                id => {
                    renderMoleculeIntoSvg(g, id, fig);
                    if (numOn && g.drawIupacNumberingIntoSvg) g.drawIupacNumberingIntoSvg(id, fig);
                });
            cell.style.cursor = 'pointer';
            cell.dataset.ipMark = r.mark;
            cell.dataset.ipNumbered = numOn ? '1' : '0';
            cell.title = 'クリックで作図に戻る';
            cell.addEventListener('click', () => { this.closeReview(); this.renderSession(); });
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex; gap:4px; align-items:stretch;';
            cell.style.flex = '1 1 0';
            cell.style.minWidth = '0';
            wrap.appendChild(cell);
            wrap.appendChild(this.numberToggleButton(key));
            gal.appendChild(wrap);
        });
        box.appendChild(gal);
        return box;
    }

    // ⚠ `missingHintBox()`（未作成の異性体を官能基で分けた内訳の箱）は **v1372 で消した**（§12-7a）。
    //    3列表の**結果列**が「未発見」を行ごとに指すので、表の上で同じことをもう一度言っていた。
    //    「まだ描けていないものを分類で束ねて見せる」役はヒントの段2（骨格の系列ごとの内訳）が
    //    持っている ＝ 答え合わせの前に欲しい要約はそちらに残っている

    /**
     * ★ 表の行に置く `🔢` のトグル（F・DESIGN_practice_revision.md §8-1・§8-3）。
     *
     * **なぜ表の中に要るか**: 主鎖と番号はキャンバスの帯にもあるが、答え合わせを開いている
     * あいだは面が違う ＝ 「閉じる → `🔢` を押す → 開き直す」の往復が残る。
     * §13-1a で学んだ「**手元を覆うものは、覆われたら用を成さない**」と同じ形。
     *
     * ⚠ **全行に常時は出さない**（§8-1・案3 の害）。C₄H₁₀O は7行・1行 84px（小）で、
     *   7つの図が数字で埋まると読めない。だから**押した行だけ**（`IW12` が見張る）。
     *
     * @param key 行の識別子（正解の行は正準コード・数えなかった図は `x:①` のような文字列）
     */
    numberToggleButton(key) {
        const on = this._numbered.has(key);
        const b = document.createElement('button');
        b.className = 'view-btn';
        b.dataset.ipNumberToggle = key;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.style.cssText = 'flex:0 0 auto; align-self:center; font-size:14px; line-height:1;' +
            ' padding:6px 7px; min-width:32px; min-height:32px;' +
            (on ? ' border-color:var(--neon-orange); color:var(--neon-orange);' : '');
        b.textContent = '🔢';
        b.title = on
            ? 'この行の主鎖と炭素番号を消します'
            : 'この行の左（正解）と右（自分の図）の両方に、主鎖の帯と炭素番号を出します';
        b.addEventListener('click', (e) => {
            e.stopPropagation();   // 図のクリック（作図に戻る）と取り違えない
            if (this._numbered.has(key)) this._numbered.delete(key);
            else this._numbered.add(key);
            this.renderReview();
        });
        return b;
    }

    // 標準の書き方の図: 主鎖を横一直線にし、主鎖の炭素へ位置番号を振る（環は layoutMolecule）
    //
    // ★ `numbered` を渡すと、**素の 1・2・3 のかわりにキャンバスと同じ帯と `C₁` の添え字**を
    //   重ねる（F・§8-3）。同じ図に番号が2通り出ないよう、素の番号は**そのとき描かない**。
    //   エーテル（`ipNumberedLayout` が null）でも 2色の塗り分けが出るのはこの道のおかげ
    renderStandardFigure(svgId, mol, numbered) {
        const g = this.game;
        // ★ 2本目の道（`ipStraightLayout`・v1440）＝ **番号は振らないが鎖は横一直線**。
        //   エーテルはここへ来る（`iupacNameDetail` が null を返す ＝ 番号の道には乗れない）。
        //   ⚠ 番号を出すのは `layout.order` が非 null のときだけ ＝ 門番は N-4 のまま
        // ★ 座標を焼き付けた答案（シス・トランスに分けた正解図・v1440）は**そのまま描く**。
        //   ⚠ ここが最初でないと `ipNumberedLayout` が 2-ペンテンを主鎖一直線に描き直し、
        //     シスもトランスも同じ図（＝向きの読めない図）になる
        const layout = (mol._ipFixedLayout
            ? { order: null, pos: new Map(mol.atoms.map(a => [a.id, { x: a.x, y: a.y }])) }
            : null) || ipNumberedLayout(mol) || ipStraightLayout(mol);
        let target, order = null, pos = null;
        if (layout) {
            pos = layout.pos; order = layout.order;
            const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
            target = {
                atoms: mol.atoms.map(a => ({ element: a.element, x: pos.get(a.id).x, y: pos.get(a.id).y })),
                bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
            };
        } else {
            layoutMolecule(mol);
            // ★ **同じ表に2つの縮尺を並べない**（発注書 §A-4 の 8）。`layoutMolecule` の格子は 42px、
            //   鎖の図は `IP_HSTEP` = 46px なので、環の図だけ倍率を合わせて渡す。
            //   ⚠ **座標は表示専用**（`mol` そのものは 42px のまま ＝ 他の読み手に影響しない）
            const k = IP_HSTEP / 42;
            const idx = new Map(mol.atoms.map((a, i) => [a.id, i]));
            target = {
                atoms: mol.atoms.map(a => ({ element: a.element, x: a.x * k, y: a.y * k })),
                bonds: mol.bonds.map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
            };
        }
        renderMoleculeIntoSvg(g, svgId, target);
        // ★ `🔢` を押した行は、キャンバスと同じ帯と `C₁` の添え字を重ねて**素の番号は出さない**
        //   （同じ図に番号が2通り並ぶのを避ける。§8-3）。門番は N-4 のままで、
        //   出せない図（環・芳香族）は false が返って**何も足さない**
        if (numbered && g.drawIupacNumberingIntoSvg) {
            if (g.drawIupacNumberingIntoSvg(svgId, target)) return;
        }
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
//   - **最初は1組だけ**。増やし方は2つ（どちらも1組ずつ）:
//     ①**空いた所に孤立した炭素を置く** → その場に付け根が生える（§14-5 A1・`sproutRootFor`）
//     ②「＋ 答案をもう1つ」を押す（§14-5 A3・`addSlot`。見えている範囲の空きを先に探す）
//     ★ **最初から N 組並べてはいけない** —— 盤面に N 個の枠を置いた時点で
//     「答えは N 個」と教えてしまう。`AK3` がこれを見張っている。
//     ①でも破らない ＝ 枠は「押した回数」ではなく「**描いた回数**」ぶんしか増えない（`AK8`）
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
        lead.textContent = '炭素数を選ぶと、キャンバスが答案用紙になります。付け根（C1 と結合手 R）はアプリが置くので、そこから炭素を伸ばして基を並べ、「答え合わせ」で採点します。2つ目からは、空いている所を炭素でタップすれば付け根がその場に出ます。';
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

    /** その点に付け根（C1 と、1マス左の R）を置くと既存の重原子とぶつかるか */
    slotClash(heavy, x, y) {
        return heavy.some(a =>
            Math.hypot(a.x - x, a.y - y) < AK_SLOT_FREE ||
            Math.hypot(a.x - (x - GRID_SIZE), a.y - y) < AK_SLOT_FREE);
    }

    /**
     * ★ A3（§14-5）: **いま見えている範囲**の空き格子点を探す。見つからなければ null。
     *
     * **なぜ固定格子より先に見るか**（実測 M6・v1371）: 付け根の格子は横 168〜672 ＝ **504px** で、
     * PC 幅の viewBox（408×306）に**最初から入らない**。そのため「＋ 答案」を押すたびに
     * `scrollSlotIntoView` が働いて viewBox.x が **72 → 324 → 66 → 72 → 324** と **±258px 振れ**、
     * 3枠目で先に描いた2枠が画面の外へ出ていた ＝ ユーザーの「位置がやりづらい」の正体。
     *
     * ⚠ **見つかったら viewBox を1px も動かさない。**画面を動かさないことがこの直しの本体で、
     * `AK7` がそれを見張っている（動かすと赤くなる）。
     * ⚠ 拡大率も触らない（`scrollSlotIntoView` の注意書きと同じ）
     */
    freeSpotInView(heavy) {
        const svg = this.game.svg;
        if (!svg || !svg.viewBox || !svg.viewBox.baseVal) return null;
        const vb = svg.viewBox.baseVal;
        if (!vb.width || !vb.height) return null;
        const pad = 60; // scrollSlotIntoView と同じ余白 ＝ 枠が画面の縁に貼り付かない
        // C1 の左 1マスに R が出るので、**R まで含めて**見えている範囲に収める
        const xMin = vb.x + pad + GRID_SIZE, xMax = vb.x + vb.width - pad;
        const yMin = vb.y + pad, yMax = vb.y + vb.height - pad;
        const head = v => Math.ceil(v / GRID_SIZE) * GRID_SIZE;
        for (let y = head(yMin); y <= yMax; y += GRID_SIZE) {
            for (let x = head(xMin); x <= xMax; x += GRID_SIZE) {
                if (!this.slotClash(heavy, x, y)) return { x, y };
            }
        }
        return null;
    }

    /**
     * ★ 付け根を1組だけ置く（§14-1）。**空いているスロットを探して置く**ので、
     * 先に描いた答案の上に重ねない。置けたら true。
     *
     * 探す順は **①いま見えている範囲の空き（画面は動かさない）→ ②固定格子の次の空き（寄せる）**（§14-5 A3）。
     * @param silent 開始時など、トーストを出さずに置くとき
     */
    addSlot(silent) {
        const g = this.game;
        if (!this.problem) return false;
        if (this.slotCount() >= AK_MAX_SLOTS) {
            if (!silent) g.showToast(`答案は ${AK_MAX_SLOTS} 個までです。`);
            return false;
        }
        const heavy = g.userMolecule.atoms.filter(a => a.element !== 'H');
        // ① 見えている範囲に空きがあるなら、そこへ置いて**画面は動かさない**。
        //   ⚠ **白紙のときは従来どおり格子の1枠目**（168,174）に置く。空きを探させると
        //   1枠目が視野の左上隅へ寄り、既定の視野の真ん中に付け根が出る形が崩れる
        //   （`start()` と `restartProblem()` がここを通る）
        let spot = heavy.length ? this.freeSpotInView(heavy) : null;
        let needScroll = false;
        // ② 画面が本当に埋まったときだけ、いままでどおり固定格子の次の行へ送って寄せる
        if (!spot) {
            for (let i = 0; i < AK_MAX_SLOTS * 2 && !spot; i++) {
                const p = this.slotPos(i);
                if (!this.slotClash(heavy, p.x, p.y)) spot = p;
            }
            needScroll = true;
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
        if (needScroll) this.scrollSlotIntoView(spot);
        g.updateDrawing();
        if (!silent) {
            this.renderSession();
            g.showToast('答案を1つ増やしました。C1 から炭素を伸ばしてください。', 2200, 'success');
        }
        return true;
    }

    /**
     * ★ A1（§14-5）: **孤立した炭素を置いたら、その場に付け根が生える。**
     * 呼ぶのは `game.placeAtomOrExplain` の1か所だけ（結合相手が空だったときだけ来る）。
     *
     * **なぜ**: 「2個目以降の書き方が分からない」の答えを、手順の知識（＋ 答案を探して押す）から
     * **描く操作そのもの**へ移す。異性体側の「**描けば答案**」（§12-1）と同じ規則になる。
     *
     * **§14-1 を破らない**: 枠は「押した回数ぶん」ではなく「**描いた回数ぶん**」しか増えないので、
     * 盤面が答えの個数を先回りして名乗ることはない（`AK8` が見張る）。
     *
     * ⚠ **炭素以外では生やさない**（A2）。`O–R` に枠を与えると**盤面が間違いを肯定する**ので、
     * そのまま置かせて答え合わせ（`noroot`）で返す。`AK6` が否定対照。
     * ⚠ **4方向とも塞がっていたら炭素だけ置く**（R を無理に置くと図が重なる）。
     * その成分は `noroot` として指される ＝ 黙って変な図を作らない。
     *
     * @returns 付け根を生やしたら true
     */
    sproutRootFor(atom) {
        if (!this.active || !this.problem) return false;
        if (!atom || atom.element !== 'C' || atom.isLocked) return false;
        const g = this.game;
        if (g.userMolecule.getNeighbors(atom.id).length > 0) return false; // 孤立した炭素だけ
        if (this.slotCount() >= AK_MAX_SLOTS) {
            g.showToast(`答案は ${AK_MAX_SLOTS} 個までです。`);
            return false;
        }
        // 向きは **左 → 右 → 上 → 下**（既定は addSlot と同じ左隣）。
        // 42px 以内に重原子がある向きは飛ばす ＝ 置いた R が他の図にくっついて見えない
        const heavy = g.userMolecule.atoms.filter(a => a.element !== 'H' && a.id !== atom.id);
        const dirs = [[-GRID_SIZE, 0], [GRID_SIZE, 0], [0, -GRID_SIZE], [0, GRID_SIZE]];
        let spot = null;
        for (let i = 0; i < dirs.length && !spot; i++) {
            const x = atom.x + dirs[i][0], y = atom.y + dirs[i][1];
            if (heavy.some(a => Math.hypot(a.x - x, a.y - y) <= GRID_SIZE + 0.5)) continue;
            spot = { x, y };
        }
        if (!spot) {
            g.showToast('まわりが混んでいるので付け根（R）を置けませんでした。少し離れた所に炭素を置いてください。', 3000);
            return false;
        }
        const r = g.userMolecule.addAtom('R', spot.x, spot.y);
        atom.isLocked = true;
        r.isLocked = true;
        g.userMolecule.addBond(atom.id, r.id, 1);
        // ⚠ 描き直しは呼び出し元（placeAtomOrExplain）が1回だけやる。ここで呼ぶと二重になる
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
                // ★ `AK4` が見る文言。付け根が無い成分**だけ**をここで指す。
                // ★ A2（§14-5）: 炭素以外を置いた図はここに落ちる（`O` を1つ置くと付け根 0）。
                //   「付け根がありません」だけでは**何をすればよいか**が分からないので、
                //   **アルキル基が炭素から始まる**ことを先に言う。
                //   ⚠ `extra`（炭素と水素以外が混ざっている）と**言い分ける** ——
                //   「C–O–R を描いた」（extra）と「O だけ置いた」（noroot）は別の間違い
                return row.roots === 0
                    ? 'アルキル基は炭素から始まります（この図には炭素の付け根がありません）'
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
        // ★ A1（§14-5）: 増やし方の第一手は「＋ 答案」ではなく**空いた所を炭素でタップ**。
        //   手順の知識を1つ減らす直しなので、案内の順もそれに合わせる
        note.textContent = drawn > 0
            // ★ 答案を指す語は3つの練習でそろえる（発注書 §C）。**数えるのは「個」**
            //   ＝ 異性体・立体と同じ文（「いま N個 描いてあります」）。
            //   ⚠ ここで数えているのは**手を入れた答案**（付け根だけの枠は数えない・drawnCount）
            ? `キャンバスが答案用紙です。いま ${drawn}個 描いてあります。別の基を描くときは、空いている所を炭素でタップすると付け根（C1–R）がその場に出ます。`
            : 'キャンバスが答案用紙です。付け根の C1 から炭素を伸ばして基を1つ描きます。別の基を描くときは、空いている所を炭素でタップすると付け根（C1–R）がその場に出ます。';
        this.body.appendChild(note);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';

        const add = document.createElement('button');
        add.className = 'primary-btn';
        add.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px;';
        add.textContent = '＋ 答案をもう1つ';
        add.title = '答案（付け根 C1–R）を1つふやします（空いている所を炭素でタップしても同じことが起きます）';
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
        reset.title = '答案用紙を白紙にして、答案1つから描き直します';
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
        this._stripComps = this.game.countMolecules();   // 「並べ直す」の押せる／押せないの元（W4）
        this.game.setPracticeStrip({
            live: this.stripLiveHtml(),
            // ⚠ **`n/総数` にしない**。ここが数えているのは手を入れた答案の数で、正誤は1つも見ていない
            // ★ 単位は「個」（発注書 §C）。異性体・立体の帯と同じ語にそろえてある
            progress: `${drawn}個`,
            actions: [
                { label: '＋ 答案', primary: true, title: '答案（付け根 C1–R）を1つふやします',
                  onClick: () => this.addSlot(false) },
                { label: '🔍 答え合わせ', disabled: drawn === 0,
                  title: '書いた図を並べて名前と同一判定を見ます',
                  onClick: () => this.openReview('answer') },
                { label: '🔎 確認', disabled: drawn === 0,
                  title: '自分の図を大きく並べます（名前・同一判定は出しません）',
                  onClick: () => this.toggleReview('progress') },
                // ★ 答案を並べ直す（W4・§12-5）。異性体・立体と**同じ道具**（`game.tidyAnswerSlots()`）。
                //   付け根 C1–R の答案も 3×2 マスを食うので、散らかる度合いは異性体と変わらない。
                //   ⚠ **押せる／押せないは `drawnCount()` では決められない** ——
                //   こちらの `drawnCount()` は**手を入れた答案**しか数えない（付け根だけの枠は数えない）が、
                //   並べ直しが動かすのは**成分**なので、「＋ 答案」で枠を3つ足しただけの人は
                //   `drawnCount()===0` のままボタンが灰色になり、いちばん散らかった状態で押せなくなる。
                { label: '🧹 並べ直す', disabled: this.game.countMolecules() < 2,
                  title: '答案どうしの重なりをほどいて格子に並べ直します（図の形は変わりません。↩ で戻せます）',
                  onClick: () => this.tidySheet() },
                { label: 'やめる', title: '練習をやめてお題選びに戻ります（図は消えません）',
                  onClick: () => this.stop() }
            ]
        });
    }

    /**
     * 「🧹 並べ直す」（W4・§12-5）。異性体側 `IsomerPractice.tidySheet()` と同じ配線で、
     * **幾何の判断は1つも持たない**（`game.tidyAnswerSlots()` が剛体平行移動だけを行う）。
     */
    tidySheet() {
        const r = this.game.tidyAnswerSlots();
        if (r.moved > 0) {
            this.game.showToast(`答案 ${r.total}枚を ${r.cols}×${r.rows} に並べ直しました（図の形は変えていません。↩ で戻せます）`);
            return;
        }
        if (r.reason === 'alreadyTidy') this.game.showToast('もう並んでいます。');
        else if (r.reason === 'outOfBounds') this.game.showToast('答案が多すぎて並べ直せません。いくつか消してからもう一度押してください。', 4000);
        else if (r.reason === 'clearance') this.game.showToast('うまく並べられませんでした。図を少し動かしてからもう一度押してください。', 4000);
        else this.game.showToast('並べ直す答案がありません。');
    }

    /**
     * 帯の左側。**お題と、手を入れた答案の数だけ**（判定はゼロ）。
     * ★ 文は異性体・立体の帯と**同じ**（発注書 §C の語の統一）—— 3つの書き出し練習で
     *   答案を指す語が違うと、同じ帯が練習ごとに別のものを数えているように読める
     */
    stripLiveHtml() {
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `お題 <b>${esc(this.problem.formula)}</b>（分子ではなく基）全 ${this.problem.total} 種 ／ ` +
            `いま <span class="ws-live-ok">${this.drawnCount()}個</span> 描いてあります`;
    }

    // 作図が変わるたびに game.updateDrawing から呼ばれる
    onDrawingChange() {
        if (!this.active || !this.problem || this._reviewing) return;
        const n = this.drawnCount();
        const study = document.getElementById('study-modal');
        if (study && !study.classList.contains('hidden')) { this.renderSession(); return; }
        // 0個 ⇄ 1個以上をまたぐと「答え合わせ」の押せる／押せないが変わる ＝ 帯ごと組み直す
        if ((n === 0) !== (this._stripDrawn === 0)) { this.renderStrip(); return; }
        // ★ 成分が 1 ⇄ 2 をまたぐときも同じ（W4）。「🧹 並べ直す」の押せる／押せないがここで変わる。
        //   ⚠ 上の 0⇄1 だけを見ていると、**2枚目の枠を足してもボタンが灰色のまま**になる
        //   （枠だけでは `drawnCount()` が動かないので、上の条件は一度も真にならない）
        const comps = this.game.countMolecules();
        if ((comps < 2) !== ((this._stripComps ?? 0) < 2)) { this.renderStrip(); return; }
        this._stripComps = comps;
        this._stripDrawn = n;
        const live = document.getElementById('ws-practice-live');
        if (live) live.innerHTML = this.stripLiveHtml();
        const prog = document.getElementById('ws-practice-progress');
        if (prog) prog.textContent = `${n}個`;
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
            // ★ ここも「個」（発注書 §C）。異性体側の同じ行が `描いた図 N個` なので語をそろえる
            ? `あなたが描いた図 ${sheet.rows.length}個 → ちがう種類 ${uc.size} ／ 全 ${this.problem.total} 種。ダブり ${dupCount}個・未発見 ${missing}種。`
            : `あなたが描いた図 ${sheet.rows.length}個（全 ${this.problem.total} 種）。同じかどうか・名前は「答え合わせ」で確認できます。`;
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
 * ★ 「動かしてよい立体単位」をお題側で選ぶ軸（v1435・ユーザー判断 2026-08-20
 *   「とりあえず αβ だけでやってみては」）。
 *
 * **なぜ要るか（実測）**: α-D-グルコピラノースをそのまま出すと**不斉炭素5個 ＝ 32種**になり、
 * 32枚を並べ直すと **1998×1310px** ＝ キャンバス（800×600）に収まらない。
 * ⚠ 32 という数そのものは正しい（`countStereoisomers` の答え）ので、**数え方は変えない**。
 * 変えるのは**お題の宣言のほう** ——「アノマー位 C1 だけを動かす回」と名乗り、2種にする。
 *
 * `'anomeric'` … 環の酸素と環外の -OH の**両方**が付いた環炭素（＝アノマー位）だけを残す。
 * ⚠ これは**立体の読み取りではない**（新しい判定を書かない）。
 *   `stereoUnitsOf` が出した単位の中から1つ選ぶだけで、面の読みは
 *   `readRingParityFromHaworth` のまま（既にあるものをそのまま使う）。
 */
function spAxisFilter(mol, units, axis) {
    if (!axis) return units;
    if (axis !== 'anomeric') return units;
    const byId = new Map(mol.atoms.map(a => [a.id, a]));
    const idxOf = new Map(mol.atoms.map((a, i) => [a.id, i]));
    const anomeric = new Set();
    mol.atoms.forEach(a => {
        if (a.element !== 'C') return;
        const os = mol.getNeighbors(a.id).filter(n => n.atom.element === 'O');
        if (os.length >= 2) anomeric.add(idxOf.get(a.id));
    });
    void byId;
    return units.filter(u => u.kind !== 'geo' && anomeric.has(u.index));
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

/**
 * 立体異性体の書き出し練習（P12-8 M2.5 その4 → **SW1・SW2 で答案用紙化**。
 * 正は DESIGN_practice_revision.md §5）。
 *
 * ★ **キャンバスそのものが答案用紙**（異性体 W1・アルキル基 W3 と同じ器）。
 * `register()` と `entries[]` は SW1 で捨てた ＝ **答案の在りかは連結成分の集まりだけ**。
 * 登録が通していた5つの門（白紙・分子が1つ・つながり方・立体が読める・変種集合にある）は
 * **採点表（`grade()`）へ移した**。断りは書き出しの最中ではなく答え合わせで言う。
 *
 * ★ W1 との違い（§5-3。横展開で足りなかったところ）:
 *   - 成分の同一性は `canonicalCode` ではなく **`readStereoOf(part).stereoCode`**
 *   - お題との一致は分子式ではなく **つながり方（`canonicalCode`）**。
 *     お題は「乳酸の立体異性体」であって「C₃H₆O₃ の異性体」ではないので、
 *     W1 の `formula` 行は **`structure` 行**に読み替える
 *   - ★ **読めない図が起こる**（未整形の C=C・十字でない不斉炭素）。
 *     構造異性体では起こらなかった**第3の状態**が要る（`unread`・§5-4）——
 *     正解でも不正解でもないので**種類には数えず、数だけ出す**
 *
 * ⚠ **トーストで叱らない**（§5-4）。正しく描いている人を毎回叱ることになる。
 * ⚠ 答案を増やすのは**平行移動だけ**（`addCopy`）。回すと縦置きの規則（v446）を踏み抜いて
 *   立体そのものが変わる ＝ 答案を壊す
 */
class StereoIsomerPractice {
    constructor(game) {
        this.game = game;
        this.body = document.getElementById('sp-body');
        this.overlay = document.getElementById('sp-review-overlay');
        this.active = false;
        this.problem = null;    // { index, key, label, target, code, formula, units, info, variants, byCode, total }
        this._cache = new Map();
        this._pending = [];
        this._reviewing = false;
        this._reviewMode = 'answer';
        this._reviewScale = 'md';

        // お題（HANDOFF: 2ⁿ ではない題材＝メソ体と環の回転対称を必ず混ぜる）
        this.problems = [
            { key: 'butene', label: '2-ブテン', compound: 'シス-2-ブテン', foldNote: null },
            { key: 'lactic', label: '乳酸', compound: 'D-乳酸', foldNote: null },
            // ⚠ 畳み込みの説明文は**書き写さない**（v1435・DESIGN_stereo_point.md §6(c)）。
            //   書き出し練習の段2 の解説と**同じ文字列**（`STEREO_FOLD_NOTES`）を読む ＝
            //   同じ数の説明が2か所で食い違わない（ORDER A-6 の「文言をそろえる」への答え）
            { key: 'tartaric', label: '酒石酸', compound: '酒石酸',
              foldNote: STEREO_FOLD_NOTES.meso },
            { key: 'lactide', label: '乳酸3分子の環状エステル', target: SP_LACTIDE_TARGET,
              foldNote: STEREO_FOLD_NOTES.symmetry },
            /**
             * ★ ハース環の糖（v1435・ORDER B-2 の「ろ」・ユーザー判断「とりあえず αβ だけで」）。
             *
             * ⚠ **読み取りは既にある**（`readRingParityFromHaworth`）。新しい判定は1つも書いていない。
             * ⚠ **軸を宣言する**（`axis: 'anomeric'`）＝ 動かすのはアノマー位 C1 だけ。
             *   これを付けないと不斉炭素5個で 32種になり、並べ直しても画面に収まらない（実測 1998×1310px）。
             * ⚠ フルクトフラノースは `prepare()` が通らないので入れていない（別途）
             */
            { key: 'glucose-anomer', label: 'α/β-D-グルコピラノース',
              compound: 'α-D-グルコース（α-D-グルコピラノース）',
              axis: 'anomeric',
              axisNote: '※ この回は**アノマー位（環の酸素と -OH の両方が付いた炭素）だけ**を動かします。' +
                  'ほかの炭素の -OH は D-グルコースのまま変えません。',
              axisReject: 'つながり方も立体の読みも合っていますが、この回はアノマー位だけを動かす回です' +
                  '（ほかの炭素の -OH は D-グルコースのまま）',
              foldNote: null }
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
                // ⚠ **すべての単位が図から読めること**は軸を絞る前に確かめる（お題の資格）。
                //   絞ってから確かめると、読めない中心を「軸の外だから」と見逃す
                const allUnits = spDetectUnits(g, target);
                const units = allUnits ? spAxisFilter(mol, allUnits, p.axis) : null;
                if (units && units.length && !info.overflow && info.count >= 2) {
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
                    /**
                     * ★ 数の突き合わせ（**軸を宣言した回だけ物差しが変わる**）。
                     *
                     * 軸を絞らない回は従来どおり `countStereoisomers` と一致すること
                     * ＝ 図から作る道と、記述子だけで数える道が同じ答えを出す証明。
                     *
                     * 軸を絞った回にはその物差しが無い（32 と 2 を比べても意味がない）。
                     * 代わりに **`spApplyFlip` の不変条件**が保証を持つ ——
                     * `spFlipRingSub` / `spFlipGeoEnd` は「選んだ単位だけが反転し、
                     * ほかの中心・C=C は1つも動いていない」ことを毎回確かめてから図を返す
                     * （返せなければ null → `ok = false` でお題ごと無効）。
                     * だから `byCode` は「軸の単位だけを動かして届く種」そのものになる。
                     * ⚠ 数が 2ⁿ より減る（畳み込む）ことはあり得るので `=== 2**k` にはしない
                     */
                    const countOk = p.axis
                        ? (byCode.size >= 2 && byCode.size <= (1 << units.length))
                        : (byCode.size === info.count);
                    if (ok && countOk) {
                        Object.assign(out, {
                            disabled: false, target, code: canonicalCode(mol),
                            formula: g.computeMolecularFormula(mol),
                            info, units, variants, byCode,
                            axis: p.axis || null, count: byCode.size
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
        lead.textContent = 'お題を選ぶとキャンバスが答案用紙になり、お題の図が1つ置かれます。つながり方は変えずに' +
            '置換基の付き方だけを動かし、「＋ お題の図をもう1つ」で並べて書き出します。何種類あるかは単純な計算どおりとは限りません。';
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
            // ⚠ 数は `data.count`（＝ 実際に用意した変種の数）から出す。
            //    `info.count` は**軸を絞らないときの全種**なので、糖の回では 32 と出てしまう
            btn.textContent = data.disabled
                ? `${p.label}（準備できません）`
                : `${p.label}（${data.count}種）${cleared ? ' ✓' : ''}`;
            if (p.axisNote) btn.title = p.axisNote.replace(/\*\*/g, '');
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
            axisNote: p.axisNote || null, axisReject: p.axisReject || null,
            ...data, total: data.count };
        this.closeReview();
        this.active = true;
        this.loadBase();
        this.renderSession();
    }

    // 答案用紙を白紙にして、お題の図を1つ置く（元の作図は ↩ で戻せる）
    loadBase() {
        const g = this.game;
        if (g.userMolecule.atoms.length > 0) g.saveState();
        g.userMolecule = g.createTargetFromData({ target: this.problem.target });
        g.updateDrawing();
        g.fitCanvasToMolecule(g.userMolecule);
    }

    /**
     * ★ お題の図を**もう1つ**答案用紙に置く（SW1）。
     *
     * 登録方式では「1つ描いて登録 → その図を動かして次を作る」だったので、
     * 答案用紙にした瞬間に**2つ目を書き始める手段が無くなる**（動かすと1つ目が消える）。
     * アルキル基練習の `addSlot`（＋ 答案をもう1つ）と同じ役。
     *
     * ⚠ **平行移動しかしない。** 回すと縦置きの規則（v446 の `isFischerOriented`）に触れて
     *   置いた瞬間に立体が変わる ＝ 答案用紙が勝手に答えを書き換えることになる
     */
    addCopy(silent) {
        if (!this.active || !this.problem) return false;
        const g = this.game;
        const t = this.problem.target;
        const heavy = g.userMolecule.atoms.filter(a => a.element !== 'H');
        let dx = 0, dy = 0;
        if (heavy.length) {
            const tMinX = Math.min(...t.atoms.map(a => a.x));
            const tMinY = Math.min(...t.atoms.map(a => a.y));
            dx = Math.max(...heavy.map(a => a.x)) + GRID_SIZE * 2 - tMinX;
            dy = Math.min(...heavy.map(a => a.y)) - tMinY;   // 行の頭をそろえる（平行移動のみ）
        }
        if (!silent) g.saveState();
        const ids = t.atoms.map(a => {
            const na = g.userMolecule.addAtom(a.element, a.x + dx, a.y + dy);
            if (a.haworthFace === 1 || a.haworthFace === -1) na.haworthFace = a.haworthFace;
            return na.id;
        });
        t.bonds.forEach(b => g.userMolecule.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
        const xs = t.atoms.map(a => a.x + dx), ys = t.atoms.map(a => a.y + dy);
        this.panIntoView(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
        g.updateDrawing();
        if (!silent) {
            this.renderSession();
            g.showToast('お題の図をもう1つ置きました。置換基の付き方を動かして、ちがう立体にしましょう。', 3000, 'success');
        }
        return true;
    }

    /**
     * 置いたばかりの図が画面の外なら、見えるところまで**平行移動だけ**する
     * （アルキル基練習の `scrollSlotIntoView` と同じ流儀。拡大率は触らない）
     */
    panIntoView(x1, y1, x2, y2) {
        const svg = this.game.svg;
        if (!svg || !svg.viewBox || !svg.viewBox.baseVal) return;
        const vb = svg.viewBox.baseVal;
        if (!vb.width || !vb.height) return;
        const pad = 40;
        let moved = false;
        if (x1 - pad < vb.x) { vb.x = x1 - pad; moved = true; }
        else if (x2 + pad > vb.x + vb.width) { vb.x = x2 + pad - vb.width; moved = true; }
        if (y1 - pad < vb.y) { vb.y = y1 - pad; moved = true; }
        else if (y2 + pad > vb.y + vb.height) { vb.y = y2 + pad - vb.height; moved = true; }
        if (moved && this.game.scheduleLabelResync) this.game.scheduleLabelResync();
    }

    /**
     * ★ 未確定の図を**整形モードで決めに行く**ための1手（§5-4）。
     * ⚠ **整形の中身には触らない。** 左パレットの既存のボタンをそのまま押して、
     *   その成分が見えるところへ寄せるだけ（呼ぶ口を1つ用意する役）
     */
    focusReshape(part) {
        const g = this.game;
        this.closeReview();
        const btn = document.getElementById('btn-cistrans-reshape');
        if (btn && !g.reshapeMode) btn.click();
        if (part && part.atoms.length) {
            const xs = part.atoms.map(a => a.x), ys = part.atoms.map(a => a.y);
            this.panIntoView(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
            g.updateDrawing();
        }
        this.renderSession();
        g.showToast('整形モードにしました。C=C をタップすると向きが決まります（もう一度でシス⇄トランス）。', 4000);
    }

    stop() {
        this.closeReview();
        this.active = false;
        this.problem = null;
        // ⚠ **キャンバスに触らない**（§12-6 と同じ）。やめても答案は残る
        this.renderList();
    }

    // 分子（連結成分）を表示用の図データにする（面マークも保持）。
    // ⚠ **保存はしない。** 呼ぶたびに「そのときのキャンバス」から作る
    figureOf(mol) {
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
        return this.grade().found;
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

    // ===== 採点表（登録の門を移した先。§5-2・§5-4）=====
    /**
     * ★ いまのキャンバスを**採点表**にする。**答え合わせのたびにゼロから作り直す**
     * （番号 ①②③ は「いま見えている並び」であって答案の identity ではない）。
     *
     * status:
     *   'ok'        … 変種集合にある（`dup` が true なら既出＝「①と③は同じ立体です」）
     *   'unread'    … ★ **まだ立体が決まっていない**（未整形の C=C・十字でない不斉炭素）。
     *                 **正解でも不正解でもない**ので種類には数えず、**数だけ**出す（§5-4）
     *   'structure' … つながり方がお題と違う（**描きかけもここ。責めない文言にする**）
     *   'unknown'   … つながり方は同じなのに変種集合に無い（欠落として記録）
     */
    grade() {
        const g = this.game;
        const { parts, marks } = g.markedMolecules(null);
        const rows = [];
        const seen = new Set();
        parts.forEach(part => {
            if (!part.atoms.some(a => a.element !== 'H')) return; // 水素だけの欠片は数えない
            const mark = marks.get(part) || ipMaru(rows.length + 1);
            const row = { part, mark, formula: g.computeMolecularFormula(part),
                code: null, name: null, status: 'structure', dup: false, missCenters: 0, missBonds: 0 };
            if (canonicalCode(part) === this.problem.code) {
                const su = stereoUnitsOf(part);
                const read = readStereoOf(part);
                row.missCenters = su.centers.length - (read ? read.centers : 0);
                row.missBonds = su.bonds.length - (read ? read.geoms : 0);
                if (row.missCenters > 0 || row.missBonds > 0) {
                    row.status = 'unread';
                } else if (this.problem.byCode.has(read.stereoCode)) {
                    row.status = 'ok';
                    row.code = read.stereoCode;
                    row.name = this.stereoNameOf(read.stereoCode);
                    row.dup = seen.has(row.code);
                    seen.add(row.code);
                } else if (this.problem.axis) {
                    // ★ 軸を宣言した回（糖の α/β）では「立体は読めるが軸の外」が**正常に起こる**。
                    //   ここを 'unknown'（開発ログ行き）のままにすると、
                    //   ちゃんと読める図を描いた生徒に不具合の顔を見せることになる（§11-4・BZ5 と同型）
                    row.status = 'axis';
                } else {
                    // つながり方が同じなら原理的に変種集合に含まれるはず。万一の欠落は記録する
                    row.status = 'unknown';
                    console.error('[StereoPractice] 構造は一致するが変種集合に無い立体コード:', read.stereoCode);
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
        const missing = [...this.problem.byCode.keys()].filter(code => !found.has(code));
        const unread = rows.filter(r => r.status === 'unread');

        // クリア記録は静かに残す（達成の告知＝同一判定になるので答え合わせまで出さない）
        if (found.size === this.problem.total) {
            try { localStorage.setItem('chemStereoPractice.' + this.problem.key, '1'); } catch (e) { /* noop */ }
        }
        return { rows, found, dupGroups, missing, unread };
    }

    /** 採点表の1行を人の言葉にする（§5-4 の表。**責めない文言**を守る場所） */
    verdictOf(row) {
        switch (row.status) {
            case 'ok':
                return row.dup ? '同じ立体をもう一度' : '✓';
            case 'unread': {
                // ★ 第3の状態。**間違いだと言わない**（まだ決まっていないだけ）
                const parts = [];
                if (row.missCenters > 0) parts.push(`立体の読めない不斉炭素原子が${row.missCenters}個あります（フィッシャー投影の十字＝縦横に、環の置換基は縦に描く）`);
                if (row.missBonds > 0) parts.push(`C=C の向きが読めません（${row.missBonds}本。置換基を軸の上下に描く）`);
                return `まだ立体が決まっていません（${parts.join('。')}）`;
            }
            case 'axis':
                // 軸を宣言した回の「対象外」。**責めない文言**（正しく読める図を描いている）
                return this.problem.axisReject || 'この回の対象外の立体です';
            case 'unknown':
                return 'この立体は判定できませんでした（開発ログに記録しました）';
            default:
                return row.formula === this.problem.formula
                    ? `つながり方が違います（お題は ${this.problem.label}）`
                    : `つながり方が違います（お題は ${this.problem.label} ＝ ${this.problem.formula}／この図は ${row.formula}）`;
        }
    }

    /**
     * キャンバスに描いてある成分（＝答案）の個数。
     * ⚠ **判定を1つもしない**ので立体も正準コードも読まない ＝ 作図のたびに呼んで軽い
     */
    drawnCount() {
        return this.game.splitMolecules()
            .filter(p => p.atoms.some(a => a.element !== 'H')).length;
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

        // ★ 軸を宣言した回は**画面のどこでも隠さない**（§11-4 と同じ約束）。
        //   「なぜ 32 ではなく 2 なのか」がここに書いていないと、正しい数のほうが間違いに見える
        if (this.problem.axisNote) {
            const an = document.createElement('div');
            an.id = 'sp-axis-note';
            an.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:4px; line-height:1.5;';
            an.textContent = this.problem.axisNote.replace(/\*\*/g, '');
            this.body.appendChild(an);
        }

        const drawn = this.drawnCount();
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:6px;';
        // ⚠ **判定は1つも出さない**（§5-7）。書き出しの最中に出すのは個数だけ
        note.textContent = drawn > 0
            ? `キャンバスが答案用紙です。いま ${drawn}個 描いてあります（同じかどうか・名前は「答え合わせ」で確認します）。`
            : 'キャンバスが答案用紙です。置換基の付き方（フィッシャーの左右・環の上下・C=C の同側/反対側）を動かし、「＋ お題の図をもう1つ」で並べて書き出します。';
        this.body.appendChild(note);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
        const add = document.createElement('button');
        add.className = 'primary-btn';
        add.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px;';
        add.textContent = '＋ お題の図をもう1つ';
        add.title = 'お題の図をもう1つ答案用紙に置きます（そこから置換基を動かして別の立体にします）';
        add.addEventListener('click', () => this.addCopy(false));
        btnRow.appendChild(add);

        const review = document.createElement('button');
        review.className = 'primary-btn';
        review.style.cssText = 'flex:1 1 100%; padding:8px; font-size:13px; background:var(--color-cyan); color:#04121a;' +
            (drawn === 0 ? ' opacity:0.5;' : '');
        review.textContent = '🔍 答え合わせ（同一判定・鏡像の組）';
        review.disabled = drawn === 0;
        review.addEventListener('click', () => this.openReview('answer'));
        btnRow.appendChild(review);

        const check = document.createElement('button');
        check.className = 'view-btn';
        check.style.cssText = 'flex:1 1 100%; font-size:12px; padding:6px;';
        check.textContent = '🔎 確認（自分の図だけを大きく並べる）';
        check.title = '名前も同一判定も出しません。自分の答案を見比べる面です';
        check.addEventListener('click', () => this.toggleReview('progress'));
        btnRow.appendChild(check);

        const reset = document.createElement('button');
        reset.className = 'view-btn';
        reset.style.cssText = 'flex:1 1 0; font-size:12px; padding:6px;';
        reset.textContent = '↻ 白紙に戻す';
        reset.title = '答案用紙を白紙にして、お題の図を1つだけ置き直します（↩ で戻せます）';
        reset.addEventListener('click', () => { this.loadBase(); this.renderSession(); this.game.showToast('お題の図1つに戻しました。'); });
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
        // ⚠ 確認／答え合わせを開いている間は帯を組み直さない（帯は z-index 30 でオーバーレイより上）
        if (this._reviewing) return;
        const drawn = this.drawnCount();
        this._stripDrawn = drawn;
        this.game.setPracticeStrip({
            // ⚠ **`n/総数` にしない**（§5-7）。登録できた ＝ 門を5つ通った ＝ 正解だったので、
            //    `3/4` は実質「3種は当たり」と教えていた。数えるのは**描いてある図の個数**だけ
            live: this.stripLiveHtml(drawn),
            progress: `${drawn}個`,
            actions: [
                { label: '＋ お題の図', primary: true,
                  title: 'お題の図をもう1つ答案用紙に置きます（置換基を動かして別の立体にします）',
                  onClick: () => this.addCopy(false) },
                { label: '🔍 答え合わせ', disabled: drawn === 0,
                  title: '答案用紙を採点し、同一判定と鏡像の組を見ます',
                  onClick: () => this.openReview('answer') },
                // ★ 答案を並べ直す（W4・SW3。§5-6・§5-8 の「SW3: 並べ直し（W4 と共用）」）。
                //   実体は異性体側・アルキル基側とまったく同じ `game.tidyAnswerSlots()` ＝
                //   **成分ごとの平行移動だけ**。立体の帯にとってここが要るのは、
                //   `＋ お題の図` で置いた2つ目以降が重なりやすいため。
                //   ⚠ **回してはいけない**（`isFischerOriented` は縦置きの図だけを立体として読む）。
                //   だから並べ直しの実体を立体側で書き直さず、game 側の1つを借りる。SW6 が見張る
                { label: '🧹 並べ直す', disabled: drawn < 2,
                  title: '答案どうしの重なりをほどいて格子に並べ直します（図の形も向きも変わりません。↩ で戻せます）',
                  onClick: () => this.tidySheet() },
                { label: 'やめる', title: '練習をやめてお題選びに戻ります（図は消えません）',
                  onClick: () => this.stop() }
            ]
        });
    }

    /**
     * 「🧹 並べ直す」（W4・SW3）。異性体側 `IsomerPractice.tidySheet()` と同じ配線で、
     * **幾何の判断は1つも持たない**（`game.tidyAnswerSlots()` が剛体平行移動だけを行う）。
     * 立体の練習でここが特に効くのは、並べ直しが**向きを1度も変えない**ことが
     * `isFischerOriented`（v446・縦置きの図だけを立体として読む）の前提そのものだから。
     */
    tidySheet() {
        const r = this.game.tidyAnswerSlots();
        if (r.moved > 0) {
            this.game.showToast(`答案 ${r.total}枚を ${r.cols}×${r.rows} に並べ直しました（図の形も向きも変えていません。↩ で戻せます）`);
            return;
        }
        if (r.reason === 'alreadyTidy') this.game.showToast('もう並んでいます。');
        else if (r.reason === 'outOfBounds') this.game.showToast('答案が多すぎて並べ直せません。いくつか消してからもう一度押してください。', 4000);
        else if (r.reason === 'clearance') this.game.showToast('うまく並べられませんでした。図を少し動かしてからもう一度押してください。', 4000);
        else this.game.showToast('並べ直す答案がありません。');
    }

    /**
     * 作図が変わるたびに `game.updateDrawing` から呼ばれる（異性体・アルキル基と同じ配線）。
     * ⚠ **帯の個数は常時更新する**。キャンバスの上で常に見えている所なので、
     * 止めると「進んでいるのか分からない」＝ `3/4` を捨てた意味が半分無くなる
     */
    onDrawingChange() {
        if (!this.active || !this.problem || this._reviewing) return;
        const n = this.drawnCount();
        // 0個 ⇄ 1個以上をまたぐと「答え合わせ」の押せる／押せないが変わる ＝ 帯ごと組み直す。
        // ★ 1個 ⇄ 2個以上も同じ（W4・SW3）。「🧹 並べ直す」の押せる／押せないがここで変わる ＝
        //   2つ目を置いてもボタンが灰色のまま、を作らない（異性体側と同じ手当て）
        if ((n === 0) !== (this._stripDrawn === 0) || (n < 2) !== (this._stripDrawn < 2)) {
            this.renderStrip(); return;
        }
        this._stripDrawn = n;
        const live = document.getElementById('ws-practice-live');
        if (live) live.innerHTML = this.stripLiveHtml(n);
        const prog = document.getElementById('ws-practice-progress');
        if (prog) prog.textContent = `${n}個`;
    }

    /**
     * 帯の左側。**お題と、いま描いてある個数だけ**（§5-7）。
     * ⚠ 判定は1つも出さない ＝ 名前も「当たり」も帯には出さない
     */
    stripLiveHtml(n) {
        return `お題 <b>${this.problem.label}</b> の立体異性体 全 ${this.problem.total} 種 ／ ` +
            `いま <span class="ws-live-ok">${n}個</span> 描いてあります`;
    }

    // ===== 答え合わせ／書き出しの確認 =====
    openReview(mode = 'answer') {
        if (!this.overlay || !this.active || this.drawnCount() === 0) return;
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

        // ★ 採点表は毎回ゼロから作り直す（§5-2）。答案はキャンバスの上にしかない
        const sheet = this.grade();
        const uc = sheet.found;
        const okRows = sheet.rows.filter(r => r.status === 'ok');
        const dupCount = okRows.length - uc.size;
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
            ? `あなたが描いた図 ${sheet.rows.length}個 → ちがう立体 ${uc.size} ／ 全 ${this.problem.total} 種。ダブり ${dupCount}個・未発見 ${missing}種。`
            : `あなたが描いた図 ${sheet.rows.length}個（全 ${this.problem.total} 種）。図をクリックすると作図に戻ります。同じかどうかは「答え合わせ」で確認できます。`;
        this.overlay.appendChild(summary);

        // ★ **まだ立体が決まっていない図**（§5-4 の第3の状態）。
        //   正解でも不正解でもないので**種類には数えない**。代わりに**数を出す** ——
        //   これが無いと、正しく描けているのに「1つ足りない」に見える瞬間ができる
        if (answerMode && sheet.unread.length) {
            const box = document.createElement('div');
            box.id = 'sp-unread-box';
            box.style.cssText = 'border:1px solid var(--neon-orange); background:rgba(255,159,67,0.08); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; line-height:1.7;';
            const h = document.createElement('div');
            h.style.cssText = 'color:var(--neon-orange); font-weight:bold; margin-bottom:2px;';
            h.textContent = `まだ立体が決まっていない図: ${sheet.unread.length}つ（種類には数えていません）`;
            box.appendChild(h);
            sheet.unread.forEach(r => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; color:var(--text-secondary);';
                const txt = document.createElement('span');
                txt.textContent = `・${r.mark} は ${this.verdictOf(r)}`;
                row.appendChild(txt);
                // ★ 整形への1手（呼ぶ口を1つ用意するだけ。整形の中身には触らない）
                const jump = document.createElement('button');
                jump.className = 'view-btn';
                jump.style.cssText = 'font-size:12px; padding:3px 10px; border-color:var(--neon-orange); color:var(--neon-orange);';
                jump.textContent = '整形して決めましょう →';
                jump.addEventListener('click', () => this.focusReshape(r.part));
                row.appendChild(jump);
                box.appendChild(row);
            });
            this.overlay.appendChild(box);
        }

        // 2ⁿ が崩れる理由（このお題の畳み込み）は答え合わせでだけ説明する
        if (answerMode && this.problem.info.folded && this.problem.foldNote) {
            const fold = document.createElement('div');
            fold.style.cssText = 'border:1px solid var(--neon-purple); background:rgba(224,176,255,0.06); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; color:#e0b0ff; line-height:1.7;';
            fold.textContent = `立体の単位は ${this.problem.info.centers + this.problem.info.bonds} 個なので単純には 2ⁿ＝${this.problem.info.naive} 通りですが、実際は ${this.problem.total} 種類です。` +
                this.problem.foldNote;
            this.overlay.appendChild(fold);
        }

        // 同じ立体どうしの指摘（同一判定なので答え合わせモードのみ）
        const dupColorOf = new Map();
        if (answerMode) sheet.dupGroups.forEach((d, i) => dupColorOf.set(d.code, IP_DUP_COLORS[i % IP_DUP_COLORS.length]));
        if (answerMode && sheet.dupGroups.length) {
            const dupBox = document.createElement('div');
            dupBox.id = 'sp-dup-box';
            dupBox.style.cssText = 'border:1px solid var(--neon-orange); background:rgba(255,159,67,0.08); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; color:var(--neon-orange); line-height:1.7;';
            const h = document.createElement('div');
            h.style.cssText = 'font-weight:bold; margin-bottom:2px;';
            h.textContent = '同じ立体（描き方がちがっても、読み取れる立体が同じなら同一）:';
            dupBox.appendChild(h);
            sheet.dupGroups.forEach(d => {
                const name = (sheet.rows.find(r => r.code === d.code) || {}).name;
                const row = document.createElement('div');
                row.textContent = `・${d.marks.join('と')} は同じ立体です` + (name ? `（${name}）` : '');
                dupBox.appendChild(row);
            });
            this.overlay.appendChild(dupBox);
        }

        // お題に数えなかった図（つながり方が違う・判定できなかった）。**責めない文言**を守る場所
        const extras = answerMode ? sheet.rows.filter(r => r.status === 'structure' || r.status === 'unknown') : [];
        if (extras.length) {
            const box = document.createElement('div');
            box.id = 'sp-extras-box';
            box.style.cssText = 'border:1px solid var(--neon-purple); background:rgba(224,176,255,0.08); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:13px; line-height:1.7;';
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
            this.overlay.appendChild(box);
        }

        // セクションA: あなたの書き出し（図はそのつどキャンバスから作る＝保存しない）
        const secA = document.createElement('div');
        secA.style.cssText = 'font-size:13px; color:var(--color-cyan); font-weight:bold; margin:4px 0;';
        secA.textContent = 'あなたの書き出し';
        this.overlay.appendChild(secA);

        const galA = document.createElement('div');
        galA.style.cssText = `display:grid; grid-template-columns:repeat(auto-fill, minmax(${sc.col}px,1fr)); gap:8px; margin-bottom:14px;`;
        sheet.rows.forEach(r => {
            let border = dupColorOf.get(r.code) || 'rgba(255,255,255,0.14)';
            let labelColor = null;
            if (answerMode && r.status === 'unread') { border = 'var(--neon-orange)'; labelColor = 'var(--neon-orange)'; }
            if (answerMode && (r.status === 'structure' || r.status === 'unknown')) { border = 'var(--neon-purple)'; labelColor = '#e0b0ff'; }
            // 確認モードは番号だけ（名前も同一判定も出さない）
            let label = r.mark;
            if (answerMode) {
                if (r.status === 'ok' && r.name) label = `${r.mark} ${r.name}`;
                else if (r.status === 'unread') label = `${r.mark} まだ立体が決まっていません`;
                else if (r.status !== 'ok') label = `${r.mark} ${r.formula}`;
            }
            const cell = this.makeCell(label,
                { h: sc.h, border, labelColor, borderWidth: dupColorOf.has(r.code) ? '2px' : '1px' },
                id => renderMoleculeIntoSvg(g, id, this.figureOf(r.part)));
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

// ===== テスト（test.html）から見えるようにする =====
// `function` 宣言はトップレベルで既に window に載るが、`const` は載らない。
// ⚠ 段1 の採点（`gradeStereoPoints`）は**この1本だけが判定**なので、
//   検査からもこの名前で叩けることが要る（別経路を作らないための見張りが `IW28`）
if (typeof window !== 'undefined') {
    window.gradeStereoPoints = gradeStereoPoints;
    window.stereoMarksOf = stereoMarksOf;
    window.stereoFoldLines = stereoFoldLines;
    window.STEREO_FOLD_NOTES = STEREO_FOLD_NOTES;
}
