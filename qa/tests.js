"use strict";
/* tests.js — 一問一答（qa）の回帰テスト。
   前半: questions.json の構造・作問規約の検査（データだけを見るので node でも実行可）。
   後半: iframe で実アプリを駆動する UI テスト（ブラウザのみ）。

   なぜ必要か: qa は「データが正しいか」がそのまま学習の質になるアプリで、
   コードのバグより **データの事故**（重複コード・正解添字のずれ・整形記号の混入・版の
   上げ忘れ）のほうが起きやすい。実際に bio 44件の Markdown 混入と、
   app.js 内 `questions.json?v=NN` の上げ忘れが無検査のまま公開まで届いた。
   規約の出所は qa/TAXONOMY.md（コード体系・二面構成）と qa/REVIEW_CRITERIA.md（C1〜C16）。 */

// ---------------------------------------------------------------- 規約の定数
var TAGS = [
  // 観点
  "分類", "一般式", "官能基", "分子の形", "命名", "異性体", "反応", "検出", "製法", "性質",
  "身のまわり", "実験", "計算",
  // 反応種
  "付加", "置換", "脱水", "酸化", "重合", "縮合", "加水分解",
  // 化合物（TAXONOMY §2.5「以降の単元で拡張」）
  "アルカン", "アルケン", "アルキン", "シクロアルカン"
];
var CODE_RE = /^org\.[a-zA-Z]+\.[a-z0-9-]+$/;

// ------------------------------------------------------ データテスト（純検査）
function runDataTests(DATA) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); };
  var patterns = DATA.patterns, units = DATA.units;
  var codes = patterns.map(function (p) { return p.code; });

  t("メタ: units と patterns が存在し、空でない", function () {
    assert(Array.isArray(units) && units.length > 0, "units が空");
    assert(Array.isArray(patterns) && patterns.length > 0, "patterns が空");
    assert(DATA.meta && DATA.meta.schemaVersion, "meta.schemaVersion がない");
  });

  t("コード: 書式が org.<unit>.<slug> で、重複がない", function () {
    var seen = {};
    patterns.forEach(function (p) {
      assert(CODE_RE.test(p.code), "書式違反: " + p.code);
      assert(!seen[p.code], "重複コード: " + p.code);
      seen[p.code] = true;
    });
  });

  t("単元: すべての pattern.unit が units に実在し、空の単元がない", function () {
    var ids = units.map(function (u) { return u.id; });
    patterns.forEach(function (p) {
      assert(ids.indexOf(p.unit) >= 0, p.code + ": 未登録の unit " + p.unit);
    });
    ids.forEach(function (id) {
      var n = patterns.filter(function (p) { return p.unit === id; }).length;
      assert(n > 0, "項目が1つもない単元: " + id);
    });
  });

  t("単元: id・name・summary が揃っている", function () {
    units.forEach(function (u) {
      assert(u.id && u.name && u.summary, "単元の情報が欠けている: " + u.id);
    });
  });

  t("必須項目: group・knowledge・difficulty(1-4) が揃っている", function () {
    patterns.forEach(function (p) {
      assert(p.group, p.code + ": group がない");
      assert(p.knowledge, p.code + ": knowledge がない");
      assert([1, 2, 3, 4].indexOf(p.difficulty) >= 0, p.code + ": difficulty が不正 " + p.difficulty);
    });
  });

  t("tags: 統制語彙（TAXONOMY §2.5）の範囲に収まっている", function () {
    patterns.forEach(function (p) {
      (p.tags || []).forEach(function (tag) {
        assert(TAGS.indexOf(tag) >= 0, p.code + ": 語彙外のタグ " + tag);
      });
    });
  });

  t("req: 有機の前提コードが実在し、自分自身を指さない", function () {
    // TAXONOMY §2.5: req は領域を跨いでよく、未作成のコードを先に書いてよい。
    // よって実在を求めるのは自領域（org.*）だけにする。
    patterns.forEach(function (p) {
      (p.req || []).forEach(function (r) {
        assert(r !== p.code, p.code + ": 自分自身を前提にしている");
        if (r.indexOf("org.") !== 0) return;   // calc.* / theo.* / inorg.* は将来の実体化を許す
        assert(codes.indexOf(r) >= 0, p.code + ": 存在しない有機コードを前提にしている " + r);
      });
    });
  });

  t("req: 前提の依存に循環がない（DAG である）", function () {
    var byCode = {};
    patterns.forEach(function (p) { byCode[p.code] = p.req || []; });
    var state = {};   // 0=未訪問 1=訪問中 2=完了
    var path = [];
    function visit(code) {
      if (state[code] === 2) return;
      assert(state[code] !== 1, "循環参照: " + path.concat(code).join(" → "));
      state[code] = 1; path.push(code);
      (byCode[code] || []).forEach(visit);
      path.pop(); state[code] = 2;
    }
    Object.keys(byCode).forEach(visit);
  });

  t("二面構成: どの項目にも flip と choice が1つ以上ある（TAXONOMY §3）", function () {
    patterns.forEach(function (p) {
      assert(Array.isArray(p.variants) && p.variants.length, p.code + ": variants がない");
      var modes = p.variants.map(function (v) { return v.mode; });
      assert(modes.indexOf("flip") >= 0, p.code + ": flip がない");
      assert(modes.indexOf("choice") >= 0, p.code + ": choice がない");
      p.variants.forEach(function (v) {
        assert(v.mode === "flip" || v.mode === "choice", p.code + ": 未知の mode " + v.mode);
      });
    });
  });

  t("めくり: q と a が埋まっている", function () {
    patterns.forEach(function (p) {
      p.variants.filter(function (v) { return v.mode === "flip"; }).forEach(function (v) {
        assert(v.q && v.a, p.code + ": めくりの q または a が空");
      });
    });
  });

  t("複数選択: 肢が4〜6個・重複なし", function () {
    patterns.forEach(function (p) {
      p.variants.filter(function (v) { return v.mode === "choice"; }).forEach(function (v) {
        assert(Array.isArray(v.options), p.code + ": options がない");
        assert(v.options.length >= 4 && v.options.length <= 6,
          p.code + ": 肢が " + v.options.length + "個（4〜6にする）");
        var uniq = v.options.filter(function (o, i) { return v.options.indexOf(o) === i; });
        assert(uniq.length === v.options.length, p.code + ": 同じ文言の肢がある");
        assert(v.q, p.code + ": 問が空");
      });
    });
  });

  t("複数選択: 正解が2〜4個・添字が範囲内・重複なし・全肢正解でない（C11）", function () {
    patterns.forEach(function (p) {
      p.variants.filter(function (v) { return v.mode === "choice"; }).forEach(function (v) {
        assert(Array.isArray(v.correct), p.code + ": correct がない");
        assert(v.correct.length >= 2 && v.correct.length <= 4,
          p.code + ": 正解が " + v.correct.length + "個（2〜4にする）");
        v.correct.forEach(function (i) {
          assert(typeof i === "number" && i >= 0 && i < v.options.length,
            p.code + ": correct の添字が範囲外 " + i);
        });
        var uniq = v.correct.filter(function (x, i) { return v.correct.indexOf(x) === i; });
        assert(uniq.length === v.correct.length, p.code + ": correct に重複がある");
        assert(v.correct.length < v.options.length, p.code + ": 全部の肢が正解になっている");
      });
    });
  });

  t("整形: Markdown 記法が混入していない（アプリは解釈せずそのまま表示する）", function () {
    patterns.forEach(function (p) {
      var s = JSON.stringify(p);
      assert(s.indexOf("**") < 0, p.code + ": ** が残っている");
      assert(s.indexOf("\\n") < 0, p.code + ": 改行が埋め込まれている");
    });
  });

  t("整形: 化学式の下付き文字が Unicode で書かれている（CO2 のような書き方がない）", function () {
    // 炭素数の範囲表記（C1〜10・C5〜17）は化学式ではないので拾わない。
    // 化学式らしい並び＝「元素記号＋数字＋元素記号」と、よく出る分子式だけを見る。
    var EL = "(?:H|C|N|O|S|P|Na|K|Ca|Mg|Cl|Br|I|Fe|Cu|Ag|Zn|Al|Si|Pb|Mn|Cr)";
    var MOL = "CO2|H2O|NH3|SO2|SO3|NO2|NO3|CH4|O2|H2|N2|Cl2|Br2|H2SO4|HNO3|CaCO3|Cu2O|CHI3|C2H2|C2H4|C6H6";
    //  は日本語に隣接すると期待どおり働かないので、境界は明示する
    var BAD = new RegExp("(?:" + EL + "[0-9]+" + EL + ")|(?:^|[^A-Za-z0-9])(?:" + MOL + ")(?![A-Za-z0-9])");
    function check(where, text) {
      var m = BAD.exec(text);
      assert(!m, where + ": 下付き文字が ASCII 数字のまま（" + m + "） → " + text);
    }
    patterns.forEach(function (p) {
      if (p.knowledge) check(p.code + ".knowledge", p.knowledge);
      p.variants.forEach(function (v) {
        ["q", "a", "supplement"].forEach(function (k) {
          if (v[k]) check(p.code + "#" + v.mode + "." + k, v[k]);
        });
        (v.options || []).forEach(function (o) {
          check(p.code + "#" + v.mode + ".options", o);
        });
      });
    });
  });

  // 旧形式は {label, build} で分子式を渡していたが、assembler は build を知らないため
  // 押しても何も起きなかった（DESIGN_assembler_bridge.md §1）。**kind で渡すものを変える**形に改めた。
  t("飛び道具: link は kind と label を持ち、kind ごとの引数が揃っている", function () {
    // `summon` / `reaction` は**分子の指し方**が要る。ID（`summon`）でも表示名（`name`）でもよいが
     // どちらか一方は必ずある（無いと `?summon=` が空で飛び、押しても何も起きない）
    var NEED = {
      summon: [], isomer: ["formula"], mechanism: ["id"],
      reaction: ["reagent"], practice: ["open"], none: []
    };
    var POINTS_AT_MOLECULE = { summon: 1, reaction: 1 };
    patterns.forEach(function (p) {
      if (!p.link) return;
      assert(!p.link.build, p.code + ": 旧形式の build が残っている（assembler は build を受けない）");
      assert(p.link.kind, p.code + ": link に kind が無い");
      var need = NEED[p.link.kind];
      assert(need, p.code + ": 未知の kind「" + p.link.kind + "」");
      if (p.link.kind !== "none") assert(p.link.label, p.code + ": link の label が空");
      if (POINTS_AT_MOLECULE[p.link.kind]) {
        assert(p.link.summon || p.link.name,
          p.code + ": kind=" + p.link.kind + " に分子の指し方（summon の ID か name）が無い");
      }
      need.forEach(function (k) {
        assert(p.link[k], p.code + ": kind=" + p.link.kind + " に必須の「" + k + "」が無い");
      });
    });
  });

  return results;
}

// ------------------------------- 飛び道具の指す先が assembler に実在するか（壊れを鳴らす）
// qa は assembler の分子を **名称の完全一致**で指している（ID が入るまでの暫定。
// DESIGN_assembler_bridge.md §3）。相手が表示名を変えると黙って壊れるので、ここで鳴らす。
// COMPOUNDS / STAGES を渡せなかった環境（node 単体など）ではスキップする。
function runLinkTargetTests(DATA, COMPOUNDS, STAGES) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); };

  // ライブラリの名称集合（compounds.json ＋ stages.json）
  var names = {};
  (COMPOUNDS || []).forEach(function (c) { if (c && c.name) names[c.name] = true; });
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (typeof node.name === "string") names[node.name] = true;
    Object.keys(node).forEach(function (k) { walk(node[k]); });
  })(STAGES);
  var nameList = Object.keys(names);

  // ライブラリの ID 集合（2026-08-06 に assembler が compounds 889 + stages 117 に不変 ID を振った）。
  // **`?summon=` に渡すのは ID** なので、実在検査もこちらが本番。
  //
  // ⚠ **同じ ID が2ファイルに載ることがある**（`naphthalene` は compounds と stages の両方にあり、
  // **stages 側には `formula` が無い**）。あとから読んだ側で上書きすると、
  // 「formula が消えた」という嘘の失敗が出る。assembler の `getCompoundLibrary()` は
  // そもそも formula を運んでいない（`{id, name, target, stereo}` だけ・game.js:2210）ので、
  // ここでは**足りない欄を補い合う**形にして「ライブラリがこの ID について知っていること」を見る。
  //
  // 「欄が無い」には**キーが無い**と**値が空文字列**の2通りがある。
  // ナフタレンの stages 側は `"formula": ""` だった（キーはある）。
  // `undefined` だけを空きとみなすと、**空文字列が中身のある値を締め出す**ので、
  // 空文字列も空きとして扱う（2026-08-06・assembler レーンの検査もここで1度すり抜けた）
  var ids = {};
  function blank(v) { return v === undefined || v === null || v === ""; }
  function remember(e) {
    if (!e || typeof e.id !== "string" || typeof e.name !== "string") return;
    var cur = ids[e.id] || (ids[e.id] = {});
    Object.keys(e).forEach(function (k) { if (blank(cur[k]) && !blank(e[k])) cur[k] = e[k]; });
  }
  (COMPOUNDS || []).forEach(remember);
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    remember(node);
    Object.keys(node).forEach(function (k) { walk(node[k]); });
  })(STAGES);

  t("飛び道具: link の summon（ID）が assembler のライブラリに実在する", function () {
    var used = DATA.patterns.filter(function (p) { return p.link && p.link.summon; });
    assert(Object.keys(ids).length > 0, "ライブラリの ID を取得できていない（テストの前提が崩れている）");
    assert(used.length > 0, "summon に ID を使っている項目が1つも無い（生成器が name のまま出している？）");
    used.forEach(function (p) {
      assert(ids[p.link.summon],
        p.code + ": ID「" + p.link.summon + "」が assembler のライブラリに無い" +
        "（ID は不変の約束なので、消えたら相手に報告する）");
    });
  });

  // ID に移る前は表示名を渡していた。**混在は許すが、両方持つのは生成器の壊れ**
  // （`?summon=` に何を載せるかが2通りになり、片方を直しても直らない状態になる）。
  // stages 側にも ID が入ったので name 経由は0件のはずだが、
  // 「名前でしか引けない分子」が将来出ても動くように混在は許してある
  t("飛び道具: link は summon（ID）と name のどちらか一方だけを持つ", function () {
    DATA.patterns.forEach(function (p) {
      if (!p.link) return;
      assert(!(p.link.summon && p.link.name),
        p.code + ": summon（ID）と name の両方がある（gen_links.js の分岐が壊れている）");
      if (p.link.name) {
        assert(names[p.link.name],
          p.code + ": 「" + p.link.name + "」が assembler のライブラリに無い。" +
          "相手が表示名を変えた可能性がある（compounds.json / stages.json を確認）");
      }
    });
  });

  // ライブラリ側に formula が無い件があった（ナフタレン。2026-08-06 に assembler レーンが埋めた）。
  // formula を読む処理を挟むと undefined を踏むので、指している先に formula があるかを鳴らしておく。
  // 「直るまで赤いまま」にすると全合格という合図が死ぬので、**既知の集合と一致するか**を見る。
  // 増えたら鳴り、**直っても鳴る**（この期待値から外せという合図。実際にそう鳴って空になった）
  //
  // ⚠ **重合体が入るとここが鳴りうる**（申し送り・2026-08-06）。assembler は
  // ポリアセチレン・ポリビニルアルコール・ナイロン66 を「何単位ぶんを1エントリとして描くか」の
  // 規約から決めている最中で、単位数が変わると分子式も変わる。
  // **こちらは formula でライブラリを照合していない**（照合は id・異性体の分子式は qa 側の値）ので、
  // 鳴ったら「相手の規約がまだ固まっていない」の合図であって、こちらの壊れではない。
  t("飛び道具: 指す先に formula がある（既知の欠落は無し）", function () {
    var KNOWN = [];
    var lack = {};
    DATA.patterns.forEach(function (p) {
      if (!p.link) return;
      var entry = p.link.summon ? ids[p.link.summon] : null;
      if (!entry && p.link.name) {
        (COMPOUNDS || []).forEach(function (c) { if (c && c.name === p.link.name) entry = c; });
      }
      if (!entry) return;   // 実在しないことは上のテストが鳴らす
      if (!entry.formula) lack[entry.name || p.link.summon] = true;
    });
    var now = Object.keys(lack).sort();
    var added = now.filter(function (n) { return KNOWN.indexOf(n) < 0; });
    var fixed = KNOWN.filter(function (n) { return now.indexOf(n) < 0; });
    assert(!added.length, "formula の無い分子を指し始めた: " + added.join(" / ") +
      "（分子式を読む処理を入れると undefined を踏む。assembler 側に報告する）");
    assert(!fixed.length, "★formula が入った: " + fixed.join(" / ") +
      " → このテストの KNOWN から外す");
  });

  t("飛び道具: kind は summon / isomer / mechanism / reaction / practice / none のいずれか", function () {
    var OK = { summon: 1, isomer: 1, mechanism: 1, reaction: 1, practice: 1, none: 1 };
    DATA.patterns.forEach(function (p) {
      if (!p.link || !p.link.kind) return;   // kind 未導入のものは既存テストが見る
      assert(OK[p.link.kind], p.code + ": 未知の kind " + p.link.kind);
      if (p.link.kind === "none") {
        assert(p.link.why, p.code + ": kind=none には why（見せない理由）が必要");
      }
    });
  });

  return results;
}

// -------------------------------------------------- 棚卸し表のテスト（data/assembler_links.jsonl）
// 283項目に「assembler で何を見せるか」を1つずつ決めた表。**これが正**で、
// questions.json の link は qa/tools/gen_links.js が生成する（DESIGN_assembler_bridge.md §4）。
// 表と配信データがずれると「押しても何も出ない入口」を配ることになるので、両方を突き合わせる。
// LINKS を渡せなかった環境ではスキップする。
// reactor.js の在庫は**テキスト走査では読めない**（2026-08-06 実発生）。
// H–X 付加は `HYDROGEN_HALIDES` という表から `id: 'add_' + key` で生成されるので、
// ソースに `id: 'add_hbr'` という文字列は存在しない。走査すると
//   (a) 生成された id を「消えた」と誤って鳴らし、
//   (b) 瓶とルールの `id:` を混ぜて数えるので在庫数そのものを偽る（51 と出たが実体は 20 + 36）
// の2つを同時にやる。**評価して実体を読む**のが正しい。
// reactor.js は上に何も要求しない（トップレベルは const 宣言だけ）ので new Function で通る。
var _invCache = { src: null, val: null };
function reactorInventory(src) {
  if (!src) return null;
  if (_invCache.src === src) return _invCache.val;
  var val;
  try {
    val = new Function(src + "\n;return {" +
      "bottles: typeof REAGENTS !== 'undefined' ? REAGENTS : null," +
      "rules: typeof REACTION_RULES !== 'undefined' ? REACTION_RULES : null };")();
    if (!val.bottles || !val.rules) val = { error: "REAGENTS / REACTION_RULES が見つからない（変数名が変わった？）" };
  } catch (e) {
    val = { error: "reactor.js を評価できない: " + String(e && e.message || e) };
  }
  _invCache = { src: src, val: val };
  return val;
}

function runInventoryTests(DATA, LINKS, COMPOUNDS, STAGES, REACTOR_JS, REACTIONS) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); };

  var MECH = ["ethene_br2", "methane_chlorination", "esterification", "benzene_nitration",
    "ethene_h2o", "ethanol_e1", "saponification", "benzene_sulfonation", "benzene_chlorination",
    "ethanol_ether", "ethanol_oxidation", "propanol2_oxidation", "aniline_diazotization",
    "diazo_coupling"];
  var OPEN = ["naming", "countquiz", "stereo", "fischer"];
  var NEED = {
    summon: ["label", "name"], isomer: ["label", "formula"], mechanism: ["label", "id"],
    reaction: ["label", "name", "reagent"], practice: ["label", "open"], none: ["why"]
  };

  var rows = LINKS || [];
  var byCode = {};
  rows.forEach(function (o) { if (o && o.code) byCode[o.code] = o; });

  t("棚卸し: 283項目すべてに行があり、余りも重複もない", function () {
    assert(rows.length > 0, "assembler_links.jsonl を読めていない（テストの前提が崩れている）");
    var seen = {};
    rows.forEach(function (o) {
      assert(o.code, "code の無い行がある");
      assert(!seen[o.code], o.code + ": 重複している");
      seen[o.code] = true;
    });
    var known = {};
    DATA.patterns.forEach(function (p) { known[p.code] = true; });
    var extra = rows.filter(function (o) { return !known[o.code]; }).map(function (o) { return o.code; });
    assert(!extra.length, "questions.json に無いコードがある: " + extra.slice(0, 5).join(" "));
    var lack = DATA.patterns.filter(function (p) { return !seen[p.code]; }).map(function (p) { return p.code; });
    assert(!lack.length, "棚卸しが済んでいない項目が " + lack.length + " 件: " + lack.slice(0, 5).join(" ") +
      "（新しい項目を足したら『何を見せるか』も決める）");
  });

  t("棚卸し: kind ごとの必須フィールドが揃い、id / reagent / open が実在の値", function () {
    var inv = reactorInventory(REACTOR_JS);
    if (inv && inv.error) throw new Error(inv.error);
    var reagentIds = {};
    if (inv) {
      inv.bottles.forEach(function (b) { reagentIds[b.id] = true; });
      inv.rules.forEach(function (r) { reagentIds[r.id] = true; });
    }
    rows.forEach(function (o) {
      var need = NEED[o.kind];
      assert(need, o.code + ": 未知の kind「" + o.kind + "」");
      need.forEach(function (k) {
        assert(o[k] && String(o[k]).trim(), o.code + ": kind=" + o.kind + " に必須の「" + k + "」が無い");
      });
      if (o.kind === "mechanism") assert(MECH.indexOf(o.id) >= 0, o.code + ": 未登録の機構 id「" + o.id + "」");
      // 試薬 id は**瓶（画面で押すもの）と実行ルールの2空間**があり、assembler の
      // `?reagent=` は「瓶 → ルール」の順で両方を受ける（2026-08-06・assembler レーン）。
      // どちらにも無い id は綴り間違いなので、reactor.js を読めるときは実データで照合する
      if (o.kind === "reaction" && inv) {
        assert(reagentIds[o.reagent],
          o.code + ": 試薬 id「" + o.reagent + "」が reactor.js に無い（瓶にもルールにも見つからない）");
      }
      if (o.kind === "practice") assert(OPEN.indexOf(o.open) >= 0, o.code + ": 未登録の open 値「" + o.open + "」");
      if (o.kind === "isomer") assert(!/[₀-₉]/.test(o.formula), o.code + ": formula に下付き文字（URL に載るので ASCII 数字で書く）");
      assert(!/\*\*/.test(JSON.stringify(o)), o.code + ": Markdown の ** が混入している");
    });
  });

  t("棚卸し: 見せないと決めた項目の why が具体的に書かれている", function () {
    rows.filter(function (o) { return o.kind === "none"; }).forEach(function (o) {
      assert((o.why || "").length >= 12,
        o.code + ": why が短すぎる（「何が見えないのか」を書く。後から再検討するときの手がかりになる）");
    });
  });

  t("棚卸し: questions.json の link が棚卸し表と食い違っていない", function () {
    DATA.patterns.forEach(function (p) {
      var o = byCode[p.code];
      if (!o) return;   // 上のテストが鳴らす
      if (o.kind === "none") {
        assert(!p.link, p.code + ": 見せないと決めた項目に link がある（gen_links.js を回し直す）");
        return;
      }
      if (!p.link) return;   // 受け口が未整備で繋いでいないものは正常
      assert(p.link.kind === o.kind,
        p.code + ": kind がずれている（表 " + o.kind + " / 配信 " + p.link.kind + "）。gen_links.js を回し直す");
      assert(p.link.label === o.label, p.code + ": label がずれている。gen_links.js を回し直す");
    });
  });

  // ★「直ったら鳴る」テスト。ライブラリに無いために繋げていない分子を数え上げ、
  // 増えたら壊れ、**減ったら「繋げるようになったので作り直せ」**と知らせる。
  // ナフタレンの formula と同じ方式（静かに直って気づかないより、鳴るほうが安全）
  t("棚卸し: ライブラリ待ちの分子が想定どおり（増えたら壊れ・減ったら繋ぎ直し）", function () {
    // **2026-08-06 に空になった。** assembler が7件を登録し（重合体3件も繰り返し単位1つの
    // `[CH2-CH(OH)]n` 形で入った）、id も同じコミットで振られたので全部引ける。
    // 塩化ベンゼンジアゾニウムは同日この一覧から外した ——
    // **登録待ちではなくイオン待ち**（N≡N⁺ の価標と、結合を持たない対イオン Cl⁻）。
    // 登録要望として送り続けると相手が作れないものを作ろうとするので、
    // `kind: none` に移して org.aroN.aniline-base・org.bio.amino-acid-amphoteric と
    // 同じ★見直し候補にまとめた（イオンが入れば3件同時に拾い直せる）。
    //
    // 空のままが正しい状態。**新しく指したい分子を棚卸しに足して、それが無ければ鳴る**
    var EXPECTED = [];
    var lib = {};
    (COMPOUNDS || []).forEach(function (c) { if (c && c.name) lib[c.name] = true; });
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      if (typeof node.name === "string") lib[node.name] = true;
      Object.keys(node).forEach(function (k) { walk(node[k]); });
    })(STAGES);
    var libNames = Object.keys(lib);
    assert(libNames.length > 0, "ライブラリを読めていない（テストの前提が崩れている）");

    // 別名を抱き込んだ表記（「エチレン」→「エチレン（エテン）」）は gen_links.js が解決するので、
    // ここでも同じ規則で解決してから「無い」と判定する
    function reachable(n) {
      if (lib[n]) return true;
      return libNames.filter(function (L) { return L.indexOf(n + "（") === 0; }).length === 1;
    }
    // 判定は「表にあるのに配信データで繋がれていない summon/reaction」を数える形にする。
    // 解決の規則（別名・手で決めた対応）を再実装すると gen_links.js と二重管理になるので、
    // **解決できたかどうかは questions.json に link があるかで読む**
    var linked = {};
    DATA.patterns.forEach(function (p) { if (p.link) linked[p.code] = true; });
    var unlinked = {};
    rows.forEach(function (o) {
      if (o.kind !== "summon" && o.kind !== "reaction") return;
      if (!linked[o.code]) unlinked[o.name] = true;
    });
    var now = Object.keys(unlinked).sort();
    var nowOk = now.filter(reachable);
    assert(!nowOk.length, "★引けるようになった: " + nowOk.join(" / ") +
      " → node qa/tools/gen_links.js --write で繋ぎ直す");
    var added = now.filter(function (n) { return EXPECTED.indexOf(n) < 0; });
    var gone = EXPECTED.filter(function (n) { return now.indexOf(n) < 0; });
    assert(!added.length, "繋げない分子が増えた: " + added.join(" / ") +
      "（相手が表記を変えたか、棚卸しに新しい分子を足した）");
    assert(!gone.length, "★繋がった分子が EXPECTED に残っている: " + gone.join(" / ") +
      " → このテストの EXPECTED から外す");
  });

  // 異性体の書き出しは**実機で開くと確かめた分子式だけ**を繋いでいる（gen_links.js の ISOMER_VERIFIED）。
  // 開かない式を渡すと**トーストも出ずに無反応**なので、推測で足すと死んだ入口を配ることになる。
  // ⚠ **重原子の数で判定できない**（`C6H6` は6個で上限内なのに217種で断られ、
  //   `C8H18` は8個でも 0.2秒で通る。assembler の実測・DEVELOPMENT.md §7-1d）。
  // ここは「繋いだ式」と「見送った式」の両方が想定どおりかを見る ＝ どちらに動いても鳴る
  t("棚卸し: 異性体の書き出しは実機で確かめた分子式だけを繋いでいる", function () {
    // 比較は文字列ソートで揃える（`C4H10` は `C4H8` より前に来る。分子式の大小ではない）
    var VERIFIED = ["C3H6O", "C3H8O", "C4H8", "C4H10", "C5H12"].sort();
    var HELD = ["C8H10"].sort();   // 列挙が3523種になり上限20種で断られる（別の列挙器待ち）
    var linkedF = {}, heldF = {};
    var linked = {};
    DATA.patterns.forEach(function (p) {
      if (p.link && p.link.kind === "isomer") linkedF[p.link.formula] = true;
      if (p.link) linked[p.code] = true;
    });
    rows.forEach(function (o) {
      if (o.kind === "isomer" && !linked[o.code]) heldF[o.formula] = true;
    });
    var nowOn = Object.keys(linkedF).sort(), nowOff = Object.keys(heldF).sort();
    assert(nowOn.join() === VERIFIED.join(),
      "繋いでいる分子式が変わった（" + nowOn.join(" ") + "）。**実機で開くことを確かめてから** " +
      "gen_links.js の ISOMER_VERIFIED とこのテストを直す");
    assert(nowOff.join() === HELD.join(),
      "見送っている分子式が変わった（" + nowOff.join(" ") + "）。" +
      "★開けるようになったなら実機で確かめて繋ぎ、このテストの HELD から外す");
  });

  // ★assembler が反応を足したら鳴る。none のうち「反応が無いから」で見送ったものは、
  // reactor に反応が入れば拾い直せる（note に ★見直し候補 と書いてある）。
  // 分子の穴と違い、**こちらは黙って増えるので気づけない**ため在庫の数を見張る。
  // reactor.js を渡せなかった環境ではスキップする。
  t("棚卸し: assembler の反応の在庫が変わっていない（増えたら ★見直し候補 を拾い直す）", function () {
    var inv = reactorInventory(REACTOR_JS);
    if (!inv) return;              // 読めない環境ではスキップ
    if (inv.error) throw new Error(inv.error);
    // 瓶（ユーザーが押すもの）と、内部の反応ルールの両方を見る。
    // 瓶が増えなくてもルールが増えれば（既存の酸化剤の瓶に酸化開裂が足される等）
    // 見直しの余地が生まれるため。
    var bottles = inv.bottles.length;
    var uniq = inv.rules.map(function (r) { return r.id; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    var KNOWN_BOTTLES = 20, KNOWN_RULES = 36, KNOWN_MECHANISMS = 14;   // 瓶は transform 15 ＋ detect 5
    var revisit = rows.filter(function (o) { return /★見直し候補/.test(o.note || ""); })
      .map(function (o) { return o.code; });
    var hint = "★見直し候補の " + revisit.length + " 件（" + revisit.slice(0, 4).join(" ") +
      " …）が繋がるようになっていないか確かめる";
    assert(bottles === KNOWN_BOTTLES,
      "試薬瓶が " + KNOWN_BOTTLES + " → " + bottles + " 本に変わった。" + hint +
      "。このテストの KNOWN_BOTTLES も直す");
    assert(uniq.length === KNOWN_RULES,
      "reactor の反応ルールが " + KNOWN_RULES + " → " + uniq.length + " 種に変わった。" + hint +
      "。このテストの KNOWN_RULES も直す");
    if (REACTIONS) {
      var n = Array.isArray(REACTIONS) ? REACTIONS.length : (REACTIONS.mechanisms || []).length;
      assert(n === KNOWN_MECHANISMS,
        "機構が " + KNOWN_MECHANISMS + " → " + n + " 件に変わった。" +
        "対応する項目を mechanism に振り直せないか確かめ、KNOWN_MECHANISMS も直す");
    }
  });

  return results;
}

// -------------------------------------------------- 版の同期テスト（キャッシュ事故）
// verify-release.js は .html しか見ないので、app.js 内の
// fetch('questions.json?v=NN') が死角になる。ここで塞ぐ。
function runVersionTests(indexHtml, appJs) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); };

  t("版: index.html のキャッシュバスターが全て同じ版を指している", function () {
    var vs = (indexHtml.match(/\?v=(\d+)/g) || []).map(function (s) { return s.slice(3); });
    assert(vs.length > 0, "index.html に ?v= が見つからない");
    var uniq = vs.filter(function (v, i) { return vs.indexOf(v) === i; });
    assert(uniq.length === 1, "index.html の版がそろっていない: " + uniq.join(", "));
  });

  t("版: ヘッダー表示の版番号がキャッシュバスターと一致する", function () {
    var asset = (indexHtml.match(/\?v=(\d+)/) || [])[1];
    var shown = (indexHtml.match(/<span class="version">v(\d+)<\/span>/) || [])[1];
    assert(shown, "ヘッダーに版表示が見つからない");
    assert(asset === shown, "資産の版 v" + asset + " と表示 v" + shown + " が食い違う");
  });

  t("版: app.js が読む questions.json の版が index.html と一致する（verify-release の死角）", function () {
    var asset = (indexHtml.match(/\?v=(\d+)/) || [])[1];
    var data = (appJs.match(/questions\.json\?v=(\d+)/) || [])[1];
    assert(data, "app.js に questions.json?v= が見つからない");
    assert(asset === data,
      "index.html は v" + asset + " なのに app.js は questions.json?v=" + data +
      " を読んでいる。データを差し替えても古い JSON がキャッシュから配られる");
  });

  return results;
}

// ------------------------------------------------------------ UI テスト（実アプリ）
function runUiTests(doc, DATA) {
  return new Promise(function (resolve) {
    var results = [];
    var t = function (name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
    };
    var assert = function (cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); };

    var frame = doc.getElementById("app");
    var d = frame.contentDocument;

    // ⚠ **UI テストの画面幅を固定する**（2026-08-06）。
    // test.html の iframe は `width:960px; max-width:100%` なので、**実効幅がテスターの
    // ブラウザ窓に依存していた** —— 窓を狭めて開くと 960px より狭い版を検査することになり、
    // 同じコードでも結果が変わる。ここで明示的に固定して再現性を持たせる。
    // （幅を変えて見る検査は下の「画面幅」節で、そこだけ意図的に動かす）
    var BASE_W = 960;
    function setWidth(px) {
      frame.style.width = px + "px";
      frame.style.maxWidth = "none";
      // 読み取りを1つ挟んでリフローを確定させる
      return frame.contentWindow.innerWidth;
    }
    setWidth(BASE_W);

    function unitCards() {
      return Array.prototype.slice.call(d.getElementById("unit-list").children);
    }
    function btnIn(card, label) {
      return Array.prototype.slice.call(card.querySelectorAll("button")).filter(function (b) {
        return b.textContent.indexOf(label) >= 0;
      })[0];
    }
    function cardText() { return d.getElementById("card-host").innerText; }
    function leafOptions() {
      var host = d.getElementById("card-host");
      var all = Array.prototype.slice.call(host.querySelectorAll("button, label, li, .opt"))
        .filter(function (e) { return e.textContent.indexOf("採点") < 0; });
      return all.filter(function (e) {
        return !all.some(function (o) { return o !== e && e.contains(o); });
      });
    }

    t("ホーム: 単元カードが questions.json の単元数だけ並ぶ", function () {
      assert(unitCards().length === DATA.units.length,
        "単元カード " + unitCards().length + "枚 ≠ データの単元数 " + DATA.units.length);
    });

    t("ホーム: 各カードに知識項目数が表示され、0件のカードがない", function () {
      unitCards().forEach(function (c) {
        var m = c.textContent.match(/知識項目\s*(\d+)/);
        assert(m, "知識項目の件数表示がないカードがある");
        assert(Number(m[1]) > 0, "項目数が0のカードがある");
      });
    });

    // ---- 習得マップ（単元 × 難易度） ----
    // 網羅（項目が存在する）と習得（できた）を同時に見せる画面なので、
    // **点の総数がデータの項目数と一致する**ことが要（1つ落ちると網羅が嘘になる）。
    function mapCells() {
      return Array.prototype.slice.call(d.querySelectorAll(".gc[data-unit]"));
    }
    function backHome() {
      var b = d.getElementById("btn-map-back");
      if (b && !d.getElementById("view-map").classList.contains("hidden")) b.click();
    }

    t("習得マップ: 開くと 単元 × 難易度4 のマスが並ぶ", function () {
      d.getElementById("btn-map").click();
      assert(!d.getElementById("view-map").classList.contains("hidden"), "習得マップに切り替わらない");
      var cells = mapCells().length + d.querySelectorAll(".gc.empty").length;
      assert(cells === DATA.units.length * 4,
        "マスが " + cells + " 個。単元 " + DATA.units.length + " × 難易度4 = " +
        (DATA.units.length * 4) + " にならない");
      backHome();
    });

    t("習得マップ: 点の総数が知識項目の総数と一致する（網羅の表示が漏れていない）", function () {
      d.getElementById("btn-map").click();
      var dots = d.querySelectorAll(".gc .dot").length;
      assert(dots === DATA.patterns.length,
        "点 " + dots + " 個 ≠ 知識項目 " + DATA.patterns.length + " 個。" +
        "難易度が 1〜4 の外にある項目があると、その項目がマップから消える");
      backHome();
    });

    // 状態を1つ足したら、**点・凡例・帯・明細の全部**に行き渡っていないと数が合わなくなる。
    // 凡例だけ古いままだと「全283項目」の内訳が合わず、読む側が黙って誤解する
    t("習得マップ: 凡例に4状態（定着・測定で未確認・学習中・未着手）が揃い、合計が総数になる", function () {
      d.getElementById("btn-map").click();
      var items = [].slice.call(d.querySelectorAll(".legend span")).filter(function (e) {
        return !e.classList.contains("tot");
      });
      var names = items.map(function (e) { return e.textContent.replace(/[\d\s]/g, ""); });
      ["定着", "測定で未確認", "学習中", "未着手"].forEach(function (want) {
        assert(names.indexOf(want) >= 0, "凡例に「" + want + "」が無い（" + names.join("/") + "）");
      });
      var sum = items.reduce(function (a, e) { return a + Number(e.querySelector("b").textContent); }, 0);
      assert(sum === DATA.patterns.length,
        "凡例の合計 " + sum + " が知識項目 " + DATA.patterns.length + " 件と合わない" +
        "（状態を足したのに凡例へ行き渡っていない）");
      backHome();
    });

    t("習得マップ: マスを押すと、その帯の項目だけが明細に並ぶ", function () {
      d.getElementById("btn-map").click();
      var cell = mapCells()[0];
      var n = Number(cell.querySelector(".gc-n").textContent);
      cell.click();
      var det = d.querySelector(".detail");
      assert(det, "明細が開かない");
      assert(det.querySelectorAll(".mi").length === n,
        "明細の項目数 " + det.querySelectorAll(".mi").length + " がマスの件数 " + n + " と合わない");
      assert(d.querySelectorAll(".gc.is-sel").length === 1, "選択中のマスが1つに印されていない");
      backHome();
    });

    t("習得マップ: マスから始めた演習は、その帯の項目数だけ出題される", function () {
      d.getElementById("btn-map").click();
      // 件数が2以上のマスを選ぶ（1件だと「絞れている」ことの証拠が弱い）。
      // **すでに開いているマスは避ける** —— マップは選択を覚えているので、
      // 同じマスを押すと閉じる仕様（前のテストが開いたままにしている）
      var cell = mapCells().filter(function (c) {
        return Number(c.querySelector(".gc-n").textContent) >= 2 && !c.classList.contains("is-sel");
      })[0];
      var n = Number(cell.querySelector(".gc-n").textContent);
      cell.click();
      d.getElementById("btn-map-flip").click();
      assert(!d.getElementById("view-study").classList.contains("hidden"), "演習に入らない");
      var shown = (d.getElementById("q-of").textContent.match(/\/\s*(\d+)/) || [])[1];
      assert(Number(shown) === n,
        "出題数 " + shown + " がその帯の項目数 " + n + " と合わない（難易度で絞れていない）");
      // 来た道に戻る＝マップへ（単元一覧へ飛ばすと、埋めていた帯を見失う）
      d.getElementById("btn-quit").click();
      assert(!d.getElementById("view-map").classList.contains("hidden"),
        "マスから始めた演習をやめたら習得マップに戻るべき");
      backHome();
    });

    t("暗記モード: 起動して「答えを見る」で答えが現れる", function () {
      var card = unitCards()[0];
      btnIn(card, "暗記").click();
      assert(!d.getElementById("view-study").classList.contains("hidden"), "演習画面に切り替わらない");
      var before = cardText();
      assert(before.indexOf("答えを見る") >= 0, "「答えを見る」が出ていない");
      Array.prototype.slice.call(d.getElementById("card-host").querySelectorAll("button"))
        .filter(function (b) { return /答え/.test(b.textContent); })[0].click();
      assert(cardText().indexOf("こたえ") >= 0, "答えが表示されない");
      d.getElementById("btn-quit").click();
    });

    t("暗記モード: 答えに整形記号（**）がそのまま出ていない", function () {
      var card = unitCards()[0];
      btnIn(card, "暗記").click();
      Array.prototype.slice.call(d.getElementById("card-host").querySelectorAll("button"))
        .filter(function (b) { return /答え/.test(b.textContent); })[0].click();
      assert(cardText().indexOf("**") < 0, "答えに ** がそのまま表示されている");
      d.getElementById("btn-quit").click();
    });

    t("測定モード: 正解だけを選ぶと「正解」になる", function () {
      var card = unitCards()[0];
      btnIn(card, "測定").click();
      // 出題された設問を DATA から引き当て、正解の文言を得る
      var qText = (cardText().split("\n").filter(function (s) { return /選べ/.test(s); })[0] || "").trim();
      var pat = null, va = null;
      DATA.patterns.forEach(function (p) {
        p.variants.forEach(function (v) {
          if (v.mode === "choice" && v.q === qText) { pat = p; va = v; }
        });
      });
      assert(va, "出題された設問をデータから引き当てられない: " + qText);
      var want = va.correct.map(function (i) { return va.options[i]; });
      var opts = leafOptions();
      want.forEach(function (label) {
        var el = opts.filter(function (e) { return e.textContent.trim() === label; })[0];
        assert(el, "選択肢が見つからない: " + label);
        el.click();
      });
      Array.prototype.slice.call(d.getElementById("card-host").querySelectorAll("button"))
        .filter(function (b) { return b.textContent.indexOf("採点") >= 0; })[0].click();
      assert(cardText().indexOf("正解") >= 0, "正解を選んだのに正解にならない");
      d.getElementById("btn-quit").click();
    });

    t("測定モード: 正解を1つ落とすと不正解になる（完全一致採点）", function () {
      var card = unitCards()[0];
      btnIn(card, "測定").click();
      var qText = (cardText().split("\n").filter(function (s) { return /選べ/.test(s); })[0] || "").trim();
      var va = null;
      DATA.patterns.forEach(function (p) {
        p.variants.forEach(function (v) { if (v.mode === "choice" && v.q === qText) va = v; });
      });
      assert(va, "出題された設問をデータから引き当てられない");
      var want = va.correct.slice(0, va.correct.length - 1)
        .map(function (i) { return va.options[i]; });
      var opts = leafOptions();
      want.forEach(function (label) {
        var el = opts.filter(function (e) { return e.textContent.trim() === label; })[0];
        if (el) el.click();
      });
      Array.prototype.slice.call(d.getElementById("card-host").querySelectorAll("button"))
        .filter(function (b) { return b.textContent.indexOf("採点") >= 0; })[0].click();
      assert(cardText().indexOf("正解") < 0 || cardText().indexOf("おしい") >= 0 || cardText().indexOf("不正解") >= 0,
        "正解を1つ落としたのに正解と判定された");
      d.getElementById("btn-quit").click();
    });

    // ---- 出題順（間隔反復の要）。app.js が露出する priority を直接検査する ----
    var pri = frame.contentWindow.QaEngine && frame.contentWindow.QaEngine.priority;

    t("出題順: 間違えた項目が未着手より先に出る", function () {
      assert(pri, "app.js が QaEngine.priority を露出していない");
      var 誤答 = { seen: 1, box: 1, right: 0, wrong: 1, last: 100 };
      var 未着手 = { seen: 0, box: 0, right: 0, wrong: 0, last: 0 };
      assert(pri(誤答) < pri(未着手),
        "誤答(" + pri(誤答) + ") が未着手(" + pri(未着手) + ") より後回しになっている");
    });

    t("出題順: 未着手が、定着しつつある項目より先に出る", function () {
      assert(pri, "QaEngine.priority がない");
      var 未着手 = { seen: 0, box: 0, right: 0, wrong: 0, last: 0 };
      var 定着中 = { seen: 3, box: 3, right: 3, wrong: 0, last: 100 };
      assert(pri(未着手) < pri(定着中), "未着手より定着中が先に出ている");
    });

    t("出題順: 定着度が高いほど後ろに回る", function () {
      assert(pri, "QaEngine.priority がない");
      var a = { seen: 3, box: 2, right: 2, wrong: 1, last: 100 };
      var b = { seen: 5, box: 5, right: 5, wrong: 0, last: 100 };
      assert(pri(a) < pri(b), "定着度の高い項目が先に出ている");
    });

    // ---- 定着の認定（TAXONOMY §4 の本則。2026-08-06 実装） ----
    // **めくりの自己採点だけでは定着にしない。** ここが緩むと習得マップの数字が
    // 「練習量」に戻り、到達度として読めなくなる。
    // 判定の芯（記録 → 状態）を直接叩く。UI 経由だと4回クリックが要る
    var stOf = frame.contentWindow.QaEngine && frame.contentWindow.QaEngine.stateOfRecord;
    var MB = frame.contentWindow.QaEngine && frame.contentWindow.QaEngine.MASTER_BOX;

    t("定着: めくりだけで box を満たしても「定着」にならない（測定で未確認）", function () {
      assert(stOf, "app.js が QaEngine.stateOfRecord を露出していない");
      var めくりだけ = { seen: 4, box: MB, right: 4, wrong: 0, cRight: 0, cWrong: 0, last: 100 };
      assert(stOf(めくりだけ) === "unconfirmed",
        "めくり4回で " + stOf(めくりだけ) + " になった（自己採点が到達度として数えられている）");
    });

    t("定着: 測定で1回正解すれば「定着」になる（回復が軽い）", function () {
      var 確認済み = { seen: 5, box: MB, right: 5, wrong: 0, cRight: 1, cWrong: 0, last: 100 };
      assert(stOf(確認済み) === "done", "測定で正解しても " + stOf(確認済み) + " のまま");
    });

    t("定着: 測定で正解しても box が足りなければ「学習中」", function () {
      // 認定は「測定で確かめた」かつ「繰り返せている」の両方が要る。
      // 片方だけで done にすると、1回まぐれで通ったものが定着になる
      var 一回だけ = { seen: 1, box: 1, right: 1, wrong: 0, cRight: 1, cWrong: 0, last: 100 };
      assert(stOf(一回だけ) === "wip", "box=1 なのに " + stOf(一回だけ) + " になった");
    });

    t("定着: 未着手は cRight があっても「未着手」", function () {
      // seen=0 は出題していない状態。記録が壊れて cRight だけ立っても未着手を守る
      assert(stOf({ seen: 0, box: 0, cRight: 3 }) === "new", "seen=0 が未着手にならない");
      assert(stOf(null) === "new", "記録なしが未着手にならない");
    });

    t("定着: 記録の器が変わったので保存キーを上げている（古い記録を読まない）", function () {
      // v1 の記録は mode を持たないので、読むと根拠のない「定着」が残る。
      // **消してはいない**（読まなくなるだけ。学習履歴は取り戻せる）
      var key = frame.contentWindow.QaEngine && frame.contentWindow.QaEngine.STORE_KEY;
      assert(key && key !== "slz-qa-v1",
        "保存キーが " + key + " のまま（mode を持たない古い記録を読み込んでしまう）");
    });

    // ---- 画面幅（2026-08-06 新設） ----
    // **きっかけは assembler の退行。** あちらは PC で作業帯が画面の下にはみ出し、
    // 縦スクロールも出ないので**名称からの呼び出しが一切できない**状態が続いていた。
    // 素通りした原因は検査が**モバイル20端末しか見ていなかった**こと。
    //
    // こちらを点検したら**同じ型の穴があった**: UI テストは 960×640 の1サイズだけで、
    // **幅を変える検査が0件**。qa は `position:fixed` も幅のメディアクエリも持たない
    // 素直な縦並びなので「到達不能」は起きにくいが、**起きないことを検査していなかった**。
    //
    // 見るのは2点だけにする（レイアウトの見た目を固定すると、直すたびに赤くなって邪魔になる）:
    //   (a) 本文が横に溢れない ＝ 横スクロールは内側の器だけが持つ
    //   (b) 押せるはずのものが画面の外に出ていない ＝ 操作不能な入口を作らない
    var WIDTHS = [
      { w: 375, name: "モバイル" },
      { w: 768, name: "タブレット" },
      { w: 1280, name: "PC" }
    ];

    t("画面幅: どの幅でも本文が横に溢れない（横スクロールは内側の器だけ）", function () {
      var bad = [];
      WIDTHS.forEach(function (v) {
        setWidth(v.w);
        d.getElementById("btn-map").click();          // 一番横に広い画面（習得マップ）で見る
        var html = d.documentElement;
        if (html.scrollWidth > html.clientWidth + 1) {
          bad.push(v.name + "(" + v.w + "px): 本文が " + html.scrollWidth + "px に伸びている");
        }
        // 内側の器はスクロールしてよい（グリッドは min-width:560px を持つ）
        d.getElementById("btn-map-back").click();
      });
      setWidth(BASE_W);
      assert(!bad.length, bad.join(" / ") + "。横に溢れると、狭い画面で本文が読めなくなる");
    });

    t("画面幅: どの幅でも押せるものが画面の外に出ていない（到達不能な入口を作らない）", function () {
      // **横スクロールする器の中の要素は除く。** 習得マップのマスは
      // `.map-scroll{overflow-x:auto}` の中にあり、狭い画面では意図的に画面幅を超えて並ぶ
      // （スクロールすれば届く）。**「はみ出してよい理由」で除くのが正しく**、
      // 「ラベルが数字だから」のような見かけで除くと、本物の不具合も一緒に消える
      function inScroller(el) {
        for (var p = el.parentElement; p; p = p.parentElement) {
          var ov = frame.contentWindow.getComputedStyle(p).overflowX;
          if (ov === "auto" || ov === "scroll") return true;
        }
        return false;
      }
      var bad = [];
      WIDTHS.forEach(function (v) {
        setWidth(v.w);
        ["home", "map"].forEach(function (where) {
          if (where === "map") d.getElementById("btn-map").click();
          var vw = frame.contentWindow.innerWidth;
          Array.prototype.slice.call(d.querySelectorAll("button")).forEach(function (b) {
            if (!b.offsetParent) return;             // 隠れている画面の中は見ない
            var r = b.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            if (inScroller(b)) return;
            // 横方向だけを見る。縦は本文が伸びるのでスクロールで届く
            if (r.left < -1 || r.right > vw + 1) {
              bad.push(v.name + "(" + v.w + "px) " + where + ": 「" +
                b.textContent.trim().slice(0, 12) + "」が " +
                Math.round(r.left) + "〜" + Math.round(r.right) + "px（画面幅 " + vw + "）");
            }
          });
          if (where === "map") d.getElementById("btn-map-back").click();
        });
      });
      setWidth(BASE_W);
      assert(!bad.length, bad.slice(0, 4).join(" / ") +
        "。押せない入口は、機能そのものが無いのと同じになる");
    });

    t("報告: 版が固定値でなく、ヘッダー表示の版を拾う", function () {
      var ctx = frame.contentWindow.__reportContext();
      assert(ctx && ctx.version, "報告の文脈に version がない");
      assert(ctx.version !== "v1" || d.querySelector(".version").textContent.trim() === "v1",
        "版が 'v1' に固定されている（どの版への報告か判別できない）");
      assert(ctx.version === d.querySelector(".version").textContent.trim(),
        "報告の版 " + ctx.version + " がヘッダー表示と食い違う");
    });

    resolve(results);
  });
}

// ------------------------------------------------------------------ node 実行用
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    runDataTests: runDataTests,
    runVersionTests: runVersionTests,
    runLinkTargetTests: runLinkTargetTests,
    runInventoryTests: runInventoryTests
  };
}
