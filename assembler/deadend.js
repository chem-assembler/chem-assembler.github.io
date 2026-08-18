/**
 * 行き止まりの報告（v1415・発注書 ORDER_review_2026-08-17 A-4 に付随）
 *
 * **なぜ要るか**: 「押したのに何も起きない」は今日だけで4件出た（相手の呼び出し・全体表示・
 * モーダル・選ぶモード）。**行き止まりで黙る**のはこのアプリの慢性の壊れ方で、そのたびに
 * ユーザーが実機で見つけて口頭で伝えるところからしか直せていない。ここは
 * 「うまくいかなかった」を**その場で拾って持ち帰れる形にする**汎用の仕組みで、
 * 最初の設置場所が「＋ ◯◯ を呼び出す → 反応」の失敗（`reactor.stopPartnerHint`）。
 *
 * **受け皿はクリップボードだけ**（2026-08-18 ユーザー決定）。貼り先（フォーム・SNS・メール）は
 * まだ決めていないので、⚠ **案内文は下の定数1つに閉じ込めてある** —— 決まったらここだけ直す。
 *
 * **GA4 も入れる**（`gtag` は index.html が読み込み済み・G-403BPCLQ0D）。
 * 報告ボタンは押されないのが普通なので、これが無いと**起きていること自体に気づけない**。
 * ⚠ 送るのは `where` / `stage` / `rule_id` の**種類の数が限られる3つだけ**。
 *   正準コードのような無数にあるものを送ると、GA4 の集計で1件ずつバラけて何も読めなくなる。
 *   くわしい中身は**コピー側**に回す（人が読むのはそちら）。
 * ⚠ `gtag` は**広告ブロッカーで読み込まれないことがある**。無いときに例外を投げない
 *   （ここで落ちるとアプリが止まる ＝ 行き止まりを直しに来て行き止まりを増やす）。
 */

/**
 * ⚠ **貼り先が決まったら、直すのはこの1行だけ。**
 * いまは「どこへ貼るか」を言い切れないので、貼り先を指定しない言い方にしてある。
 */
const DEADEND_PASTE_HINT =
    'コピーしたメモを、作者に届く場所（お問い合わせ・SNS のリプライなど）へ貼ってください。';

// コピーされる文の見出し。**会話の文脈が無い所へ貼られる**ので、それだけ読んで意味が通ること
const DEADEND_TITLE = '【パズルでみる有機化学】うまくいかなかったことの報告';

// 止まった段の言い換え（機械の語のままでは貼られた先で読めない）。
// ⚠ キーは GA4 へ送る `stage` そのもの ＝ **種類の数はこの表の大きさで頭打ち**
const DEADEND_STAGES = {
    rule: '反応の定義が見つからなかった',
    summon: '相手の分子を呼び出せなかった',
    detect: '呼び出せたが、反応する箇所が見つからなかった',
    select: '呼び出せたが、2つを選んでも反応が押せなかった',
    apply: '反応を実行したところで失敗した'
};

// 起きた場所の言い換え（設置場所が増えたらここに足す。ここも**種類の数が限られる**）
const DEADEND_PLACES = {
    'partner-hint': '相手の分子を呼び出す（⚗ 反応させる・調べる）'
};

const DeadEnd = {

    /** 画面に出ている版（`<div class="version">`）。読めなければ嘘の版を書かない */
    version() {
        const el = document.querySelector('.version');
        const t = el ? el.textContent.trim() : '';
        return /^v\d+$/.test(t) ? t : '（不明）';
    },

    /**
     * キャンバスに載っているものを人が読める形にする。
     * **登録名で引けたものは名前**、引けなければ**分子式と正準コード**
     * （名前が無いものこそ再現に要るので、コード自体は落とさない）。
     * ⚠ この正準コードは**コピー側にだけ**出す（GA4 へは送らない。§冒頭）。
     */
    canvasSummary(game) {
        const g = game || window.game;
        if (!g || !g.userMolecule) return '（読み取れませんでした）';
        const parts = (g.splitMolecules ? g.splitMolecules() : [])
            .filter(p => p.atoms.some(a => a.element !== 'H'));
        if (!parts.length) return '（空）';
        return parts.map((p, i) => {
            let name = '';
            try { name = g.lookupCompoundName ? (g.lookupCompoundName(p) || '') : ''; } catch (e) { name = ''; }
            if (name) return `${i + 1}. ${name}`;
            let formula = '', code = '';
            try { formula = g.computeMolecularFormula ? g.computeMolecularFormula(p) : ''; } catch (e) { /* noop */ }
            try { code = (typeof canonicalCode === 'function') ? canonicalCode(p) : ''; } catch (e) { /* noop */ }
            return `${i + 1}. （登録名なし）${formula} ${code}`.trim();
        }).join('\n');
    },

    /**
     * 貼られる本文を組み立てる。**それだけ読んで意味が通ること**（会話の文脈が無い所へ貼られる）。
     * `info` = { where, stage, tried, ruleId, detail }
     */
    buildText(info, game) {
        const i = info || {};
        return [
            DEADEND_TITLE,
            '',
            `版: ${this.version()}`,
            `起きた場所: ${DEADEND_PLACES[i.where] || i.where || '（不明）'}`,
            `やろうとしたこと: ${i.tried || '（不明）'}`,
            `どこで止まったか: ${DEADEND_STAGES[i.stage] || i.stage || '（不明）'}`,
            `アプリの説明: ${i.detail || '（なし）'}`,
            i.ruleId ? `反応ルール: ${i.ruleId}` : '',
            '',
            'キャンバスの中身:',
            this.canvasSummary(game),
            '',
            `画面: ${window.innerWidth}×${window.innerHeight}（表示倍率 ${window.devicePixelRatio || 1}）`,
            `ブラウザ: ${navigator.userAgent}`,
            `日時: ${new Date().toISOString()}`
        ].filter(l => l !== '').join('\n');
    },

    /**
     * GA4 へ1件送る。**送るのは種類の数が限られる3つだけ**（`where` / `stage` / `rule_id`）。
     * ⚠ `tried` の自由文・正準コード・分子式は**送らない**（1件ずつバラけて集計が読めなくなる）。
     * 戻り値は送れたかどうか（送れなくても本体は止めない）。
     */
    track(info, name) {
        try {
            if (typeof window.gtag !== 'function') return false;
            const i = info || {};
            window.gtag('event', name || 'dead_end', {
                app: 'assembler',
                where: String(i.where || ''),
                stage: String(i.stage || ''),
                rule_id: String(i.ruleId || '')
            });
            return true;
        } catch (e) {
            return false; // 計測のために本体を止めない
        }
    },

    /**
     * クリップボードへ書く1本道。**テストと逃げ道はここだけを差し替える**。
     * ⚠ クリップボードは**安全な文脈（https / localhost）でしか使えない**
     */
    writeText(text) {
        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return Promise.reject(new Error('この画面ではクリップボードが使えません'));
    },

    /**
     * コピーする。失敗したら**選べる形で画面に出す**
     * （逃げ道が無いと、報告そのものが行き止まりになる）。戻り値は Promise<boolean>。
     */
    copy(text, fallbackEl) {
        const showFallback = () => {
            if (!fallbackEl) return false;
            fallbackEl.classList.remove('hidden');
            fallbackEl.value = text;
            try { fallbackEl.focus(); fallbackEl.select(); } catch (e) { /* noop */ }
            return false;
        };
        return Promise.resolve()
            .then(() => this.writeText(text))
            .then(() => true, showFallback);
    },

    /**
     * 掲示板（器）に「止まった説明 ＋ 知らせるボタン ＋ 逃げ道の欄」を組む。
     * ⚠ 器の中身は毎回作り直す（前の行き止まりの文が残らない）。
     */
    attach(el, info, game) {
        if (!el) return null;
        el.innerHTML = '';
        const g = game || window.game;

        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--neon-pink);';
        p.textContent = info.detail || DEADEND_STAGES[info.stage] || 'ここで止まりました。';
        el.appendChild(p);

        const area = document.createElement('textarea');
        area.className = 'hidden';
        area.id = 'deadend-fallback';
        area.readOnly = true;
        area.rows = 6;
        area.style.cssText = 'width:100%; font-size:11px; line-height:1.4;';

        const note = document.createElement('div');
        note.id = 'deadend-note';
        note.style.cssText = 'font-size:11px; line-height:1.5; color:var(--text-secondary);';
        note.textContent = DEADEND_PASTE_HINT;

        const btn = document.createElement('button');
        btn.className = 'view-btn';
        btn.id = 'btn-deadend-report';
        btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
            'border-color:var(--neon-pink); color:var(--neon-pink);';
        btn.textContent = '📋 うまくいかない、と知らせる（内容をコピー）';
        btn.title = DEADEND_PASTE_HINT;
        btn.addEventListener('click', () => {
            const text = DeadEnd.buildText(info, g);
            DeadEnd.track(info, 'dead_end_report');
            return DeadEnd.copy(text, area).then(ok => {
                const msg = ok
                    ? 'コピーしました。' + DEADEND_PASTE_HINT
                    : 'コピーできなかったので、下の欄に出しました（選んでコピーしてください）。' +
                      DEADEND_PASTE_HINT;
                if (g && g.showToast) g.showToast(msg, 8000, ok ? 'success' : 'error');
                note.textContent = msg;
                return ok;
            });
        });

        el.appendChild(btn);
        el.appendChild(note);
        el.appendChild(area);

        // **止まったこと自体**も1件送る（ボタンは押されないのが普通なので、
        // これが無いと「起きていること自体」に気づけない）
        DeadEnd.track(info, 'dead_end');
        return btn;
    }
};

// テスト（test.html）・コンソールデバッグ用にグローバル公開する
if (typeof window !== 'undefined') {
    window.DeadEnd = DeadEnd;
    window.DEADEND_PASTE_HINT = DEADEND_PASTE_HINT;   // 貼り先の案内は**この1つ**（DE2 が見張る）
    window.DEADEND_TITLE = DEADEND_TITLE;
    window.DEADEND_STAGES = DEADEND_STAGES;
    window.DEADEND_PLACES = DEADEND_PLACES;
}
