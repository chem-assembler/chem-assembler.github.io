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

  t("飛び道具: link は label と build が揃っている（TAXONOMY §2.6）", function () {
    patterns.forEach(function (p) {
      if (!p.link) return;
      assert(p.link.label && p.link.build, p.code + ": link の label または build が空");
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

  t("飛び道具: link が name を持つなら、その名称が assembler のライブラリに実在する", function () {
    assert(nameList.length > 0, "ライブラリの名称を取得できていない（テストの前提が崩れている）");
    DATA.patterns.forEach(function (p) {
      if (!p.link || !p.link.name) return;
      assert(names[p.link.name],
        p.code + ": 「" + p.link.name + "」が assembler のライブラリに無い。" +
        "相手が表示名を変えた可能性がある（compounds.json / stages.json を確認）");
    });
  });

  t("飛び道具: kind は summon / isomer / mechanism / reaction / none のいずれか", function () {
    var OK = { summon: 1, isomer: 1, mechanism: 1, reaction: 1, none: 1 };
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
    runLinkTargetTests: runLinkTargetTests
  };
}
