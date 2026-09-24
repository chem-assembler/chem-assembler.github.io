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
  // 「同定」は structure 単元（構造決定・旧 clue ＝手がかりから物質に当たりを付ける）の横串。
  // ⚠ 「検出」とは別物にする。検出は試薬を作用させて陽性・陰性を見る操作で、
  // 同定は与えられた測定値・見た目から物質を名指しする読みのほう
  "同定",
  // 反応種
  "付加", "置換", "脱水", "酸化", "重合", "縮合", "加水分解",
  // 化合物（TAXONOMY §2.5「以降の単元で拡張」）
  "アルカン", "アルケン", "アルキン", "シクロアルカン"
];
/* ★ 2026-09-23 に無機・理論（inorg.*・theo.*）を収録したので広げた（以前は org.* だけ）。
 *   unit の部分にハイフンを許す ＝ `theo.acid-base.*`・`theo.ionic-eq.*`（TAXONOMY §1 の予約済みの綴り）。
 *   ⚠ calc.* は領域跨ぎの前提（req）としてだけ現れ、項目のコードにはまだ無い */
var CODE_RE = /^(org|inorg|theo)\.[a-zA-Z][a-zA-Z-]*\.[a-z0-9-]+$/;

// ★ 飛び道具の札で使ってはいけない「組む」系の動詞（2026-09-10）。
//
// ⚠ `?summon=` は **着地した瞬間に分子を組み上げる**（app.js の linkQuery）。
//   つまり押した人が着いたとき、**組む作業はもう残っていない**。
//   それなのに札が「〜を組み立てる」と言っていると、**約束と画面が食い違う**
//   ——「組め」と言われて着いたら、もうできている。
//   2026-09-10 の数え直しでは summon 81件のうち **60件**がこれだった
//   （「〜を組み立てる」42件・「〜を組んで〜を見る」18件）。
//
// ★ 新しく足すときは「見る／数える／確かめる／探す／比べる」の側で書く。
// ⚠ **本当に組ませたいカードは、札ではなく `summon` のほうを外すのが正しい。**
//   札だけ「組め」に戻すと、この検査ではなく**画面のほう**が嘘になる。
// ⚠ `reaction` は対象にしない —— あちらは分子を出したうえで**試薬を実行させる**ので、
//   「試す」「反応させる」が画面と合っている。
var BUILD_VERB = /組み立て|組んで|組む|組み上げ|くみたて|つくる|作る|作っ|つくっ/;

// ★ 「問い＋選択肢1個」の組で読めるか（2026-09-15・ユーザー提案）。
//
// ⚠ 選択肢は **毎回並べ替えられ**（app.js の renderChoice が shuffle する）、
//   学習者は「問い＋その肢」を1つずつ真偽判定する。**並び全体を読む前提で書いた肢は崩れる。**
//   ユーザーの校正で続けて見つかった型（REVIEW_CRITERIA.md C17）のうち、形で見分けられる2つを機械で見る:
//
//   (1) 指示語（この・その・どちら・どれ・これ・それ・次の・上の…）の**指す先が、その肢の中にも問いの中にも無い**
//       ——「この混合物を転化糖という」（混合物は別の肢）／「生成物はどちらもジカルボン酸である」（2つは別の肢）
//   (2) 問いが「〜ときについて正しいものをすべて選べ」の硬い形
//
// ⚠ 見ているのは**形だけ**。「指す先がある」の判定は近似で、次の3つで決めている:
//   - 読点「、」より後ろの指示語は、同じ肢の前半を受けていると見なす（「…異なれば、その炭素は」）
//   - 「この／その＋名詞」は、その名詞が問いにあれば問いを受けていると見なす
//   - 「どちら／どれ」は、2つの候補（「AとB」「A・B」「左右」「両」）が肢の前半か問いにあれば受けていると見なす。
//     ただし「どちらの＋名詞」は、その名詞も問いか肢の前半に要る（「どちらの酸素原子」は候補が分子なので決まらない）
// ⚠ 軸のずれ・段階の抜け・文として不自然、は**機械では見られない**。pair_review.js で書き出して読む（C17）
var PAIR_DEMONSTRATIVE_SKIP = /(そのまま|そのもの|それぞれ|それ以上|それ以外|これ以上|同じ)/g;
function pairContextHitsOf(q, text) {
  var hits = [];
  var s = String(text).replace(PAIR_DEMONSTRATIVE_SKIP, function (m) { return new Array(m.length + 1).join("＿"); });
  var NOUN = /^[一-龥々ァ-ヶーA-Za-z0-9₀-₉α-ωΑ-Ω]+/;
  // 2つの候補の印。「ナイロンが絹に似るのは、どちらも」のような比べる言い方も候補を2つ立てている
  var PAIR = /[^、。\s]と[一-龥ァ-ヶA-Za-z0-9]|・|左右|両|に似|より/;
  var re = /(この|その|あの|どちら|どれ|これ|それ|こちら|そちら|前者|後者|次の|前の|上の|下の|上記|以下の)/g, m;
  while ((m = re.exec(s))) {
    var w = m[1], at = m.index, before = s.slice(0, at), after = s.slice(at + w.length);
    var afterComma = before.indexOf("、") >= 0;
    var prev = before.slice(-1);
    if (/^(次の|前の|上の|下の|以下の)$/.test(w)) {
      // 「紫外線下の」「2種類以上の」「アセタール化する前の」のような語の一部は拾わない
      if (before === "" || /[、はがもをに]/.test(prev)) hits.push("指示語「" + w + "」が別の肢や並びを指している");
      continue;
    }
    if (w === "上記" || w === "前者" || w === "後者") { hits.push("指示語「" + w + "」が別の肢や並びを指している"); continue; }
    if (w === "この" || w === "その" || w === "あの") {
      if (afterComma) continue;
      var noun = (after.match(NOUN) || [""])[0];
      if (noun && (String(q).indexOf(noun) >= 0 || before.indexOf(noun) >= 0)) continue;
      hits.push("「" + w + noun + "」の指す先が問いにも肢の中にも無い");
      continue;
    }
    if (w === "どちら" || w === "どれ") {
      var pairBefore = PAIR.test(before), pairQ = PAIR.test(String(q));
      if (!pairBefore && !pairQ) { hits.push("「" + w + "」の候補が問いにも肢の中にも無い"); continue; }
      if (!pairBefore && after.charAt(0) === "の") {
        var n2 = (after.slice(1).match(NOUN) || [""])[0];
        if (n2 && String(q).indexOf(n2) < 0 && before.indexOf(n2) < 0) {
          hits.push("「" + w + "の" + n2 + "」の候補が問いにも肢の中にも無い");
        }
      }
      continue;
    }
    // これ・それ・こちら・そちら
    if (!afterComma) hits.push("「" + w + "」の指す先が肢の中に無い");
  }
  return hits;
}
// 「〜ときについて」「〜ときの話として」＝ 何を答えるか（変化・生成物・理由…）を言っていない問い（v114 で「話」も足した）
var PAIR_STIFF_Q = /とき(について|の話)/;
// 全 choice の組を見て、引っかかったものを { key: "code#肢番号" または "code#q", why, text } で返す
function pairContextHits(patterns) {
  var out = [];
  patterns.forEach(function (p) {
    (p.variants || []).filter(function (v) { return v.mode === "choice"; }).forEach(function (v) {
      if (PAIR_STIFF_Q.test(v.q || "")) {
        out.push({ key: p.code + "#q", why: "問いが「〜ときについて／〜ときの話として正しいものを選べ」の硬い形", text: v.q });
      }
      (v.options || []).forEach(function (o, i) {
        pairContextHitsOf(v.q || "", o).forEach(function (why) {
          out.push({ key: p.code + "#" + i, why: why, text: o });
        });
      });
    });
  });
  return out;
}
// ⚠ **機械の近似で赤になるが、読むと通るものだけ**を名指しで通している。
//   2026-09-15 の既知16件（指示語8・「〜ときについて」8）は v114 で直したので外した。
//   新しく足す問題には効く。**直したら、ここからも外す**（外し忘れは下の検査が赤で知らせる）
var PAIR_CONTEXT_KNOWN = {
  "org.bio.isoelectric-point#1": "「どちらの電極」＝問いの「ろ紙の両端に直流電圧」を電極と読めば決まる"
};

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

  // ★ 単元の並びはユーザーが決めた順（2026-09-19・v145 で 11 → 17 単元に割り直し）。
  //   ホームのカードも習得マップの行もこの配列の順に出るので、配列の順＝画面の順。
  //   ⚠ 旧 id（carbonyl・aroN・bio・clue）は消した。項目コード（org.carbonyl.* など）は学習記録の
  //   キーなので変えていない ＝ コードの接頭辞と単元の id は一致しない
  // ★ 2026-09-23 無機4・理論11 を収録して 17 → 32 単元に。**有機の17単元の並び（ユーザー決定）は崩さず、
  //   その後ろに足した**。無機・理論の並びは**参考書の ORDER.txt の順**（無機 → 理論）にそろえた
  //   ＝ 参考書でページを読む順と、一問一答の単元の順が同じになる
  //   ★ theoLife（化学と人間生活・2026-09-23）は理論の先頭。参考書でも序章が理論の先頭にあるため
  // ★★ 2026-09-23 夜: 単元を**教科書の章立て**に組み直した（ユーザー「化学基礎・化学の区別を明確に」
  //   「無機と有機で粒度が異なる・無機の単元が少なすぎる」「無機の土台という単元が不適」）。
  //   無機・理論の単元 ＝ 参考書の目次（reference-src/TOC.txt）の節。id は「sec-<節の本体の先頭ページ id>」。
  //   並びは教科書順（化学基礎 → 化学）。有機の17単元（ユーザー決定の並び）は第4編・第5編の位置にそのまま入る。
  //   ★ 組み直しの道具は scratchpad の qa-units.js（統合セッション）。項目コードは学習記録のキーなので変えていない
  t("単元: 教科書の章立て（科目・編つき）で、有機の単元の並びが崩れず、旧 id が残っていない", function () {
    var ORG = ["anal", "alcohol", "aldketone", "carboxyl", "fat", "aro", "phenol",
      "aroAcid", "aroNitrogen", "aroSep", "structure", "sugar", "aminoAcid", "protein", "nucleic", "poly"];
    var got = units.map(function (u) { return u.id; });
    assert(got.filter(function (id) { return ORG.indexOf(id) >= 0; }).join(",") === ORG.join(","),
      "有機の単元の並びが違う: " + got.filter(function (id) { return ORG.indexOf(id) >= 0; }).join(","));
    units.forEach(function (u) {
      assert(u.course === "basic" || u.course === "adv", u.id + ": course（科目）が basic / adv でない");
      assert(u.part, u.id + ": part（編）が無い");
      assert(ORG.indexOf(u.id) >= 0 || /^sec-[a-z0-9-]+$/.test(u.id), u.id + ": 無機・理論の単元 id が sec-… でない");
    });
    // 科目は化学基礎 → 化学の順に1回ずつ（行ったり来たりしない）
    var cs = []; units.forEach(function (u) { if (cs[cs.length - 1] !== u.course) cs.push(u.course); });
    assert(cs.join(",") === "basic,adv", "科目の並びが 化学基礎 → 化学 でない: " + cs.join(","));
    // 同じ編は連続する
    var ps = []; units.forEach(function (u) { var k = u.course + "/" + u.part; if (ps[ps.length - 1] !== k) ps.push(k); });
    var dup = ps.filter(function (k, i) { return ps.indexOf(k) !== i; });
    assert(!dup.length, "同じ編が離れて2回出る: " + dup.join(","));
    ["aliphatic", "carbonyl", "aroN", "bio", "clue", "inorgBasis", "inorgNonmetal", "inorgMetal", "inorgQual", "theoLife",
      "theoStructure", "theoMole", "theoAcidBase", "theoRedox", "theoElectro", "theoState",
      "theoSolution", "theoThermo", "theoKinetics", "theoEquilibrium", "theoIonicEq"].forEach(function (old) {
      assert(!patterns.some(function (p) { return p.unit === old; }), "旧 id が項目に残っている: " + old);
    });
  });

  // ★ 2026-09-24 ユーザー「脂肪族炭化水素の分割：参考書のページと粒度を揃えたほうがよい／かわりに、分類階層を設けたい」。
  //   88項目の1単元を参考書の節（TOC.txt）7つに分け、編と単元の間に「分類」（category）を1段足した
  t("単元: 脂肪族炭化水素を参考書の節7つに分け、分類（category）は同じ編の中で続けて並び、2単元以上を束ねる", function () {
    var SPLIT = { "sec-organic-features": 7, "sec-hydrocarbon-classes": 12, "sec-organic-formulas": 6,
      "sec-alkane-isomers": 5, "sec-stereoisomers": 11, "sec-alkane": 17, "sec-alkene": 30 };
    var ali = patterns.filter(function (p) { return /^org\.ali\./.test(p.code); });
    assert(ali.length === 88, "org.ali の項目が 88 件でない: " + ali.length + "（分けるときに項目が増減した）");
    Object.keys(SPLIT).forEach(function (id) {
      var n = patterns.filter(function (p) { return p.unit === id; }).length;
      assert(n === SPLIT[id], id + ": 項目 " + n + " 件（" + SPLIT[id] + " 件のはず）");
    });
    var ids = units.map(function (u) { return u.id; });
    patterns.forEach(function (p) { assert(ids.indexOf(p.unit) >= 0, p.code + ": 単元 " + p.unit + " が units に無い"); });
    var seen = [], last = null;
    units.forEach(function (u) {
      var c = u.category || null;
      if (c && c !== last) {
        assert(seen.indexOf(c) < 0, "分類「" + c + "」が離れて2回出る");
        seen.push(c);
      }
      last = c;
    });
    seen.forEach(function (c) {
      var ms = units.filter(function (u) { return u.category === c; });
      assert(ms.length >= 2, "分類「" + c + "」が1単元しか束ねていない（段を増やすだけ）");
      assert(ms.every(function (u) { return u.part === ms[0].part && u.course === ms[0].course; }), "分類「" + c + "」が編をまたぐ");
    });
    assert(seen.indexOf("脂肪族炭化水素") >= 0, "分類「脂肪族炭化水素」が無い");
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

  // 領域を跨ぐ前提（`calc.*` / `theo.*` など）は、まだ実体の無いコードを先に書いてよい
  // （TAXONOMY §2.5）。ただし**書いたまま忘れる**のと、**相手が実体化したのに気づかない**の
  // 両方が起きるので、既知の集合と一致するかを見る。増えても鳴り、**実体化しても鳴る**。
  //
  // なぜ実体化で鳴らすか: 理論や計算の単元を収録したら、
  // **そちらの単元からこの項目へ辿れるようにする**必要がある（2026-08-10 ユーザー決定）。
  // 収録単元は多数派に合わせるが、**他方の単元から置き場が分かる**ようにしないと、
  // 探した人が「無い」と思ってしまう。その仕掛けを張る合図がここ。
  var KNOWN_FORWARD = {
    "calc.ratio": "比の計算（元素分析の計算で使う）",
    "theo.ionic-eq.polyprotic": "多段階の電離平衡（酸性・塩基性アミノ酸で使う）",
    "theo.solution.colligative": "希薄溶液の性質（浸透圧・凝固点降下。構造決定で分子量を出すのに使う）"
  };
  // ★ 実体化を**見届けた**もの（2026-09-23 に理論を収録して中身が入った）。
  //   合図どおり「そちらの単元からこちらの項目へ辿れる仕掛け」を張る宿題は **I-0101** に置いた
  //   （qa の画面 app.js はまだ req をどこにも使っていない ＝ 仕掛けは画面の新機能として作る）。
  //   ⚠ ここに無いコードが実体化したら、下の検査は**引き続き鳴る**（合図そのものは黙らせていない）
  var MATERIALIZED_ACK = {
    "theo.ionic-eq.polyprotic": "I-0101",
    "theo.solution.colligative": "I-0101"
  };
  t("req: 領域を跨ぐ前提が既知のものだけで、まだ実体化していない", function () {
    var seen = {};
    patterns.forEach(function (p) {
      (p.req || []).forEach(function (r) {
        if (r.indexOf("org.") === 0) return;
        (seen[r] = seen[r] || []).push(p.code);
      });
    });
    var now = Object.keys(seen).sort();
    var added = now.filter(function (r) { return !KNOWN_FORWARD[r]; });
    var gone = Object.keys(KNOWN_FORWARD).filter(function (r) { return now.indexOf(r) < 0; });
    assert(!added.length, "領域跨ぎの前提が増えた: " + added.join(" / ") +
      "（何のためのコードか KNOWN_FORWARD に書く）");
    assert(!gone.length, "★領域跨ぎの前提が使われなくなった: " + gone.join(" / ") +
      " → KNOWN_FORWARD から外す");
    // 実体化したら鳴らす（相互参照を張る合図）
    var real = now.filter(function (r) { return codes.indexOf(r) >= 0 && !MATERIALIZED_ACK[r]; });
    assert(!real.length, "★" + real.join(" / ") + " が実体化した（" +
      real.map(function (r) { return KNOWN_FORWARD[r]; }).join(" / ") +
      "）。**その単元からこちらの項目へ辿れる仕掛けを張る**（" +
      real.map(function (r) { return seen[r].join(","); }).join(" / ") + "）");
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

  // 選択肢は **毎回並べ替えられる**（app.js の renderChoice が shuffle(options) する）。
  // なので「〜だから起こる」「〜ためである」のように **理由だけを言って、何が起こるのかを
  // 言わない肢**は、指し先の肢が上にあるとは限らず、単独では何の話か決まらない。
  //
  // なぜここだけを見るか: 「主語が落ちているか」の一般判定は日本語では機械で無理だった。
  // 設問が「A・B について」と主語を並べているときに全肢が A か B を含むか、という案は
  // 実データで12件中7件が誤検出（「C・H・O・N だけからなる化合物」「酵素の反応速度と
  // 温度・pH」など、中黒が主語ではなく観点や元素の並びを表す）で、使いものにならなかった。
  // 理由だけの肢は形が決まっているので、これだけは機械で見張れる。
  // 直し方は主題を立てること —— 「〜のは、…ためである」「脱色は、…して起こる」。
  // 見ているのは「文末が理由の形なのに、主題を表す **は** が1つも無い」という一点だけ。
  var DANGLING_REASON = /(だから起こる|ために起こる|によって起こる|して起こる|ためである|からである)$/;
  t("選択肢: 理由だけを言って結果を言わない肢がない（並べ替えで指し先が消える）", function () {
    patterns.forEach(function (p) {
      p.variants.filter(function (v) { return v.mode === "choice"; }).forEach(function (v) {
        v.options.forEach(function (o, i) {
          if (!DANGLING_REASON.test(o)) return;
          assert(o.indexOf("は") >= 0,
            p.code + " #" + i + ": 何が起こるのかを言っていない肢「" + o +
            "」（選択肢は並べ替えられるので、上の肢を受ける書き方は成立しない）");
        });
      });
    });
  });

  // ★ 問い＋肢1個の組（C17）。定義と理由は冒頭の pairContextHitsOf の注記を読むこと
  t("組: 肢の指示語が別の肢を指していない・問いが「〜ときについて」でない（C17）", function () {
    var hits = pairContextHits(patterns);
    var fresh = hits.filter(function (h) { return !PAIR_CONTEXT_KNOWN[h.key]; });
    assert(!fresh.length, fresh.slice(0, 4).map(function (h) {
      return h.key + ": " + h.why + "「" + h.text + "」";
    }).join(" / ") + "（選択肢は並べ替えられ、問いと1個ずつ組で読まれる。指す先を肢の中に書く）");
    var hitKeys = {};
    hits.forEach(function (h) { hitKeys[h.key] = 1; });
    var stale = Object.keys(PAIR_CONTEXT_KNOWN).filter(function (k) { return !hitKeys[k]; });
    assert(!stale.length, "★直った（または項目が消えた）ので PAIR_CONTEXT_KNOWN から外す: " + stale.join(" / "));
    // ★否定対照 —— 見分けそのものが働いていることを、その場で確かめる
    assert(pairContextHitsOf("スクロースを加水分解したあとの溶液について正しいものをすべて選べ。", "この混合物を転化糖という").length === 1,
      "「この混合物」を拾えていない（この検査は何も守っていない）");
    assert(pairContextHitsOf("キシレンを酸化したときの生成物について正しいものをすべて選べ。", "生成物はどちらもジカルボン酸である").length === 1,
      "候補の無い「どちら」を拾えていない");
    assert(!pairContextHitsOf("不斉炭素原子の判定について正しいものをすべて選べ。", "4つの手がすべて異なれば、その炭素は不斉炭素原子である").length &&
      !pairContextHitsOf("ポリアミド系の繊維について正しいものをすべて選べ。", "ナイロン66とナイロン6はどちらもポリアミドである").length &&
      !pairContextHitsOf("凝固点降下について正しいものをすべて選べ。", "電離する物質では粒子の数が増えるので、そのままでは正しい分子量が出ない").length,
      "肢の中に指す先がある指示語まで赤にしている（見分けが広すぎる）");
    assert(PAIR_STIFF_Q.test("酢酸エチルに水酸化ナトリウム水溶液を加えて加熱したときについて正しいものをすべて選べ。") &&
      !PAIR_STIFF_Q.test("酢酸エチルに水酸化ナトリウム水溶液を加えて加熱したときの変化について正しいものをすべて選べ。"),
      "「〜ときについて」の見分けが働いていない");
    assert(PAIR_STIFF_Q.test("高吸水性樹脂を水に入れたときの話として、正しいものをすべて選べ。") &&
      !PAIR_STIFF_Q.test("高吸水性樹脂のつくりと、水に入れたときの変化について、正しいものをすべて選べ。"),
      "「〜ときの話として」の見分けが働いていない（または変化を言った問いまで赤にしている）");
  });

  // 課程改訂で変わった用語（KNOWLEDGE_CAVEATS J-4 の表）。
  // **旧語を単独で使わない**（J-7）。併記形「新語（旧語）」は許す —— 教科書もそうしている。
  //
  // なぜ検査するか: 旧語を単独で誤答肢に置くと、**旧課程で学んだ人には正しく見え、
  // 新課程の人には未知の語に見える**ので、正誤を分ける点にならない（C11 の排反肢と同じ型）。
  // 答えに旧語を単独で書くと、覚える対象がぼやける。
  var RENAMED = {
    "ヒドロキシル基": "ヒドロキシ基", "カルボキシル基": "カルボキシ基", "スルホン基": "スルホ基",
    "アルデヒド基": "ホルミル基", "ケトン基": "カルボニル基", "光学異性体": "鏡像異性体",
    "希ガス": "貴ガス", "イオン式": "イオンを表す化学式", "共有結晶": "共有結合の結晶",
    "六方最密充填": "六方最密構造", "活性化状態": "遷移状態",
    "質量作用の法則": "化学平衡の法則", "アクリル系繊維": "モダクリル繊維"
  };
  t("用語: 旧語は補足だけに置く（設問・答え・選択肢では新語のみ・J-7）", function () {
    // **併記もしない**（2026-08-08 ユーザー決定で強めた）。理由は媒体の違い:
    // 教科書は前から順に読むので「初出で併記、以後は新語」が機能するが、
    // **qa は間隔反復でランダムな順に出るので「初出」という概念が無い**。
    // 「最初だけ併記」は意味を持たない。
    // また qa は一から全ての知識を教える道具ではなく、**既に習ったことの確認・測定**なので、
    // 旧語は補足で一言触れれば足りる。
    var bad = [];
    patterns.forEach(function (p) {
      p.variants.forEach(function (v) {
        var fields = [];
        ["q", "a"].forEach(function (k) { if (v[k]) fields.push([k, v[k]]); });
        (v.options || []).forEach(function (o, i) { fields.push(["肢" + i, o]); });
        fields.forEach(function (pair) {
          Object.keys(RENAMED).forEach(function (old) {
            if (pair[1].indexOf(old) < 0) return;
            bad.push(p.code + "#" + v.mode + "." + pair[0] + ": 旧語「" + old +
              "」がある（新語「" + RENAMED[old] + "」だけを使い、旧語は supplement に移す）");
          });
        });
      });
    });
    assert(!bad.length, bad.slice(0, 4).join(" / "));
  });

  // 英単語の混入。**日本語で書くべきところに英語が残っていないか**を見る。
  //
  // なぜ検査するか: 実際に混入していた（org.aroN.separation-order の補足に
  // 「これでカルボン酸だけを先に **water 層**へ移せる」。v73 で修正）。
  // 推敲の途中で残った語なので、目で追うと読み飛ばす。
  //
  // 化学では正当なラテン文字が多い（元素記号・化学式・命名法の綴り・単位）ので、
  // **既知の許可語だけを通し、それ以外が出たら鳴らす**形にする（「直ったら鳴る」方式）。
  // 許可語を増やすときは、それが本当に日本語で書けないものかを確かめること。
  var LATIN_OK = [
    // 命名法の綴りそのものを示すために要るもの（接頭辞・語尾・アルファベット順の根拠）
    "cyclo", "ethyl", "methyl", "bromo", "chloro", "sec", "tert", "cis", "trans",
    "ane", "ene", "yne", "anol", "ol", "al",
    // 略号・単位
    "PLUS", "DNA", "RNA", "PET", "PVC", "TNT", "ppm", "pH", "mol", "mL", "Lv",
    // ★ 2026-09-23 理論を収録して足した。log は pH の定義そのもの（常用対数）で、言い換えると
    //   与件が読みにくくなる（qa-b・qa-e の便が「2 ＝ 10⁰·³⁰」などに書き換えていた）。
    //   min は反応速度の単位 mol/(L·min)（参考書のページの単位のまま）
    "log", "min"
  ];
  t("整形: 日本語の中に英単語が残っていない（元素記号・命名法の綴りは除く）", function () {
    var bad = [];
    patterns.forEach(function (p) {
      p.variants.forEach(function (v) {
        var fields = [];
        ["q", "a", "supplement"].forEach(function (k) { if (v[k]) fields.push([k, v[k]]); });
        (v.options || []).forEach(function (o, i) { fields.push(["肢" + i, o]); });
        fields.forEach(function (pair) {
          // 化学式（元素記号＋下付き数字）と、ハイフンで囲まれた接頭辞を先に落とす
          var s = String(pair[1]).replace(/[A-Z][a-z]?[₀-₉0-9]*/g, " ").replace(/[-−–][a-z]+[-−–]/g, " ");
          (s.match(/[a-zA-Z]{3,}/g) || []).forEach(function (w) {
            if (LATIN_OK.indexOf(w) >= 0) return;
            bad.push(p.code + "#" + v.mode + "." + pair[0] + ": 英単語「" + w + "」が残っている");
          });
        });
      });
    });
    assert(!bad.length, bad.slice(0, 4).join(" / "));
  });

  // 旧語の注記は**その項目が実際にその新語を扱っているときだけ**置く。
  //
  // なぜ検査するか: 実際に貼り間違えていた（org.bio.glucose-structure の補足に
  // 「旧課程では『ケトン基』とよばれた」が、**主語のないまま**入っていた。
  // グルコースはアルドースで、この項目はホルミル基の話。読む人は何が「ケトン基」なのか
  // 分からないうえ、**グルコースがケトン基をもつと誤解しかねない**。v70 で削除）。
  // 注記を一括で貼ると起こる型なので、貼り先が本文と噛み合っているかを見る。
  t("用語: 旧語の注記は、その項目が新語を扱っているときだけ置く", function () {
    var bad = [];
    patterns.forEach(function (p) {
      p.variants.forEach(function (v) {
        if (!v.supplement) return;
        Object.keys(RENAMED).forEach(function (old) {
          if (v.supplement.indexOf(old) < 0) return;
          var body = [v.q, v.a].concat(v.options || []).join(" ");
          if (body.indexOf(RENAMED[old]) >= 0) return;      // 本文で新語を扱っている＝注記の置き場として妥当
          if (v.supplement.indexOf(RENAMED[old]) >= 0) return; // 補足の中で新語と対にしている形も許す
          bad.push(p.code + "#" + v.mode + ": 補足の旧語「" + old + "」に対応する新語「" +
            RENAMED[old] + "」が、この項目のどこにも出てこない（貼り先が違う）");
        });
      });
    });
    assert(!bad.length, bad.slice(0, 4).join(" / "));
  });

  // 表記の揺れ。旧語ではなく**同じものの別の書き方**なので RENAMED とは分けて見る。
  // アルコールの級は**教科書表記の「第一級アルコール」を正**とする。
  //
  // なぜ検査するか: 実際に混在していた（v69 の時点で org.carbonyl.reduction だけが
  // 「第一級」形で12回、他10項目46回は「1級」形）。**別のものだと思われる**のが害で、
  // 「級＝ヒドロキシ基の付いた炭素につく炭素の数」という同一の概念が2つの名前で出てくる。
  //
  // どちらへそろえるか（v74 でユーザー判断により反転）:
  // v69 ではアプリ内の多数派だった「1級」形にそろえたが、**教科書は「第一級」形36回・
  // 「1級」形0回**（R5 化学 4〜7編の実測）で完全に一方的だった。
  // 生徒が教科書・問題集で目にする語と一致していないと照合できないので、教科書側に寄せた。
  // 略記のほうは org.alcohol.class の補足で「同じものを指す」と伝えている（J-7 と同じ形）。
  t("表記: アルコールの級は教科書表記の「第一級」形でそろえる（設問・答え・選択肢。補足では略記に触れてよい）", function () {
    var bad = [];
    patterns.forEach(function (p) {
      p.variants.forEach(function (v) {
        var fields = [];
        ["q", "a"].forEach(function (k) { if (v[k]) fields.push([k, v[k]]); });
        (v.options || []).forEach(function (o, i) { fields.push(["肢" + i, o]); });
        fields.forEach(function (pair) {
          // 「第」が付いていない「1級」「2級」「3級」を拾う（炭素数など他の数字は巻き込まない）
          var m = pair[1].match(/(?:^|[^第])([123]級)/);
          if (!m) return;
          var num = m[1].charAt(0);
          var kanji = { "1": "第一級", "2": "第二級", "3": "第三級" }[num];
          bad.push(p.code + "#" + v.mode + "." + pair[0] + ": 「" + m[1] + "」がある（「" + kanji + "」に直す）");
        });
      });
    });
    assert(!bad.length, bad.slice(0, 4).join(" / "));
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
    // `reference` … 📖 資料（2026-09-04）。**必須の引数は無い**（label だけ）——
    // 着地するページは assembler の `reference.json` の `codes` が決めるので、
    // こちらは `?open=reference` と、`linkHtml` が必ず付ける `?code=` しか送らない
    var NEED = {
      summon: [], isomer: ["formula"], mechanism: ["id"],
      reaction: ["reagent"], practice: ["open"], none: [], reference: [], ion: []
    };
    var POINTS_AT_MOLECULE = { summon: 1, reaction: 1 };
    // `practice` は行き先しだい。`?open=stereo` はキャンバスの分子を見る画面なので、
    // 分子を添えないと押しても**トーストだけ**で終わる（2026-08-21 実測。棚卸し側にも同じ検査）
    var OPEN_NEEDS_MOLECULE = { stereo: 1, isomer: 1 };
    patterns.forEach(function (p) {
      if (!p.link) return;
      if (p.link.kind === "practice" && OPEN_NEEDS_MOLECULE[p.link.open]) {
        assert(p.link.summon || p.link.name,
          p.code + ": open=" + p.link.open + " に分子の指し方（summon の ID か name）が無い" +
          "（キャンバスが空のまま立体ビューを開くことになる）");
      }
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

  // ★ 札の**動詞**と、着いたときの**画面の状態**を合わせる（2026-09-10。BUILD_VERB の注記を読むこと）
  t("飛び道具: summon の札が「組む」と言っていない（着いた時にはもう組み上がっている）", function () {
    patterns.forEach(function (p) {
      if (!p.link || p.link.kind !== "summon") return;
      assert(!BUILD_VERB.test(p.link.label),
        p.code + ": summon の札が「組む」系の動詞になっている（" + p.link.label + "）。" +
        "?summon= は着地した瞬間に分子を組み上げるので、押した人に組む作業は残っていない。" +
        "「見る／数える／確かめる／探す／比べる」の側で書くか、" +
        "本当に組ませたいなら summon のほうを外す");
    });
    // ★否定対照 —— 見分けそのものが働いていることを、その場で確かめる
    assert(BUILD_VERB.test("メタンを組み立てる") && BUILD_VERB.test("酢酸を組んでカルボキシ基を見る"),
      "「組む」の見分けが働いていない（この検査は何も守っていない）");
    assert(!BUILD_VERB.test("メタンの4本の C−H を見る"),
      "「組む」の見分けが広すぎる（直した札まで赤にしている）");
  });

  // ---- 確度（structure 単元＝構造決定・旧 clue・2026-08-12）----
  // ⚠ この単元だけは「確実に正しい知識」ではなく「たぶんこれだろう」を扱う。
  // 印が付いていない項目が紛れると、**断定と推測の区別が消える**のが一番こわい事故なので、
  // 「structure なら必ず付いている」と「structure 以外には付いていない」を両側から締める。
  var CERTAINTY = ["確実", "ほぼ確実", "たぶん"];
  t("確度: 構造決定（structure）単元の全項目に付いており、他の単元には付いていない", function () {
    patterns.forEach(function (p) {
      if (p.unit === "structure") {
        assert(p.certainty, p.code + ": 構造決定（structure）単元なのに確度が無い");
        assert(CERTAINTY.indexOf(p.certainty) >= 0, p.code + ": 未知の確度「" + p.certainty + "」");
      } else {
        assert(!p.certainty, p.code + ": 構造決定（structure）以外に確度が付いている（断定と推測が混ざる）");
      }
    });
  });

  t("確度: 語の意味が meta.certainty に書いてある", function () {
    var def = DATA.meta && DATA.meta.certainty;
    assert(def, "meta.certainty が無い（画面に出す説明文の出どころが消える）");
    CERTAINTY.forEach(function (k) {
      assert(def[k] && def[k].length > 10, "確度「" + k + "」の説明が無い");
    });
  });

  t("確度: どの項目にも根拠（basis）があり、確実以外は破れる条件を言っている", function () {
    // ⚠ ユーザー指摘（2026-08-12）:「注意を要する項目は一覧にして根拠とともにまとめる」。
    // supplement は学習者向けの言い方しか書けないので、**作問側が見る根拠**を別に持つ。
    // `確実` 以外は「どこで破れるか」が書けて初めて項目にしてよい ＝ 書けないものは載せない
    patterns.filter(function (p) { return p.certainty; }).forEach(function (p) {
      assert(p.basis && p.basis.length > 20, p.code + ": 確度の根拠（basis）が無いか短すぎる");
      if (p.certainty === "確実") return;
      assert(/破れ/.test(p.basis),
        p.code + ": 確度が「" + p.certainty + "」なのに、どこで破れるかが basis に無い");
    });
  });

  t("確度: 「たぶん」には言い切らない断りが書いてある", function () {
    // ⚠ ユーザー指摘（2026-08-11）:「注で厳密には…という補足を加えれば実質的に真と扱える」。
    // 逆に言えば**断りの無い「たぶん」は書いてはいけない**。supplement のどこかで
    // 限界に触れているかを見る（決まらない・他にもある、の類）
    var re = /決ま(らない|り)|限らない|他にも|とは限|であって断定ではない|残る/;
    patterns.filter(function (p) { return p.certainty === "たぶん"; }).forEach(function (p) {
      var texts = p.variants.map(function (v) { return v.supplement || ""; }).join(" ");
      assert(re.test(texts), p.code + ": 確度「たぶん」なのに、どこまでで止まるかの断りが supplement に無い");
    });
  });

  // ---- 聞き方の直し（ユーザー指摘・2026-08-28）----
  // ⚠ ここは「間違い」ではなく**聞き方が悪い／触れていない**として直した5件を見張る。
  // どれも文面を戻すと元の欠点がそのまま戻るので、**戻したら鳴る**形で釘を打つ。
  // 出典はすべて R5 化学（第一学習社）。ページ番号はコミットメッセージ側に書いてある。
  function variantOf(code, mode) {
    var p = patterns.filter(function (x) { return x.code === code; })[0];
    if (!p) throw new Error("項目が無い: " + code);
    var v = p.variants.filter(function (x) { return x.mode === mode; })[0];
    if (!v) throw new Error(code + ": " + mode + " が無い");
    v._p = p;
    return v;
  }

  t("QW1: 2価エステルの向きは「何が変わるか」を問う（書き出す作業のほうを聞かない）", function () {
    var v = variantOf("org.carbonyl.diester-arrangement", "flip");
    assert(v.q.indexOf("書き出す") < 0,
      "問いが「書き出すと何が分かる？」に戻っている ＝ 作業のほうを聞いていて、" +
      "こたえ（向きで加水分解の生成物が変わる）と噛み合わない: " + v.q);
    assert(/向き[^。]*(変わる|変化)/.test(v.q),
      "問いが「向きが違うと何が変わる？」を聞いていない: " + v.q);
  });

  t("QW2: エステル化の水は O の由来だけを問う（H は2分子から1個ずつ来る）", function () {
    var v = variantOf("org.carbonyl.ester-water-origin", "flip");
    // 教科書 p.162:「エステル化はカルボン酸のOHとアルコールのHから水を生じる反応」
    // ＝ 水の H はカルボン酸の −OH の H と、アルコールの H の2個。
    // だから「H はどちらの分子に由来するか」は答えが1つに決まらない
    assert(v.q.indexOf("O と H") < 0,
      "問いが「O と H は、それぞれどちらの分子に由来する？」に戻っている。" +
      "水の H は2個あってカルボン酸とアルコールから1個ずつ来るので、H では由来が決まらない: " + v.q);
    assert(/水の\s*O/.test(v.q), "問いが水の O の由来を聞いていない: " + v.q);
    assert(/カルボン酸/.test(v.a) && /アルコール[^。]*(渡さ|水素原子だけ)/.test(v.a),
      "こたえが「O はカルボン酸・アルコールは水素原子だけ」を言っていない: " + v.a);
    assert(/H[^。]*2個|2個[^。]*H/.test(v.supplement || ""),
      "補足が「水の H は2個ある」ことに触れていない ＝ なぜ H で問わないのかが分からない");
  });

  t("QW3: ギ酸の性質に還元性がある（フェーリングは陽性例に挙げない）", function () {
    var v = variantOf("org.carbonyl.formic", "flip");
    // 教科書 p.156:「ギ酸はホルミル基をもつので，還元性があり，銀鏡反応を示す」
    assert(v.a.indexOf("還元性") >= 0, "こたえが還元性に触れていない: " + v.a);
    assert(v.a.indexOf("銀鏡反応") >= 0, "こたえが銀鏡反応に触れていない: " + v.a);
    // KNOWLEDGE_CAVEATS A-5: ギ酸はフェーリング液では錯体をつくって実質陰性。
    // 「フェーリング陽性の物質」の例にギ酸を置かない
    assert((v.a + (v.supplement || "")).indexOf("フェーリング") < 0,
      "ギ酸の陽性例にフェーリング液を挙げている（A-5: 強塩基性のフェーリング液中では" +
      "ギ酸イオンが銅(II)と錯体をつくり、実際には沈殿が出ない）");
  });

  t("QW4: カルボニルの還元に「入試ではこの対応でよい」の断りがある（試薬名は書かない）", function () {
    var v = variantOf("org.carbonyl.reduction", "flip");
    var s = v.supplement || "";
    assert(s.indexOf("還元剤") >= 0 && /入試|高校/.test(s),
      "補足が「どこまで還元されるかは還元剤で決まるが、入試ではこの対応で答えてよい」を" +
      "言っていない ＝ ユーザー指摘（方法によって生成物が異なる）に応えていない: " + s);
    // KNOWLEDGE_CAVEATS I-4:「設問側では試薬を明示しないままにしておく
    // （明示すると範囲外に踏み込む）」。踏み越えたら鳴らす
    var OUT_OF_SCOPE = ["水素化ホウ素", "水素化アルミニウム", "クレメンゼン", "ウォルフ",
      "亜鉛アマルガム", "ヒドラジン"];
    var body = [v.q, v.a, s].concat(v.options || []).join(" ");
    OUT_OF_SCOPE.forEach(function (w) {
      assert(body.indexOf(w) < 0,
        "還元剤「" + w + "」を名指ししている（I-4: 明示すると高校の範囲外に踏み込む）");
    });
  });

  t("QW5: フェーリング液の還元がアルデヒド限定になっていない", function () {
    var v = variantOf("org.carbonyl.fehling", "flip");
    var p = v._p;
    // 教科書 p.218:「還元性を示す糖類をフェーリング液に加えて加熱すると，
    // 酸化銅（Ⅰ）Cu2O の赤色沈殿を生じる」／p.219 フルクトースも還元性を示す
    assert(/還元性を示す物質/.test(v.a),
      "こたえが「アルデヒドを加えて加熱すると」のままで、陽性になる相手を" +
      "アルデヒドに限定している: " + v.a);
    assert(/還元性を示す物質/.test(p.knowledge),
      "knowledge がアルデヒド限定のまま残っている: " + p.knowledge);
    assert((v.supplement || "").indexOf("還元糖") >= 0,
      "補足がアルデヒド以外の陽性例（還元糖）に触れていない");
    // A-5: 「陽性なら必ずホルミル基」という逆を書かない、を明示しているか
    assert(/逆向き|とは限|だけではな/.test(v.supplement || ""),
      "補足が「陽性だからホルミル基がある、と逆に読まない」という断りを置いていない");
    // A-5: ギ酸は実質陰性なので陽性例に混ぜない
    assert((v.a + (v.supplement || "")).indexOf("ギ酸") < 0,
      "フェーリングの陽性例にギ酸を挙げている（A-5 で実質陰性）");
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

  t("飛び道具: kind は summon / isomer / mechanism / reaction / practice / reference / none のいずれか", function () {
    var OK = { summon: 1, isomer: 1, mechanism: 1, reaction: 1, practice: 1, reference: 1, ion: 1, none: 1 };
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

/**
 * assembler のクイズの語彙（出題範囲のレベルと分野）を **quiz.js を評価して**読む。
 *
 * ⚠ **テキスト走査でも書き写しでもやらない。** reactorInventory と同じ理由 ——
 * 書き写すと相手が名前を変えたときに「合っているつもり」で緑のまま通り、
 * assembler 側は知らない値を**黙って無視する**（＝分野を問わないに戻るだけ）ので、
 * 誰も気づかないまま入口が効かなくなる。
 * quiz.js のトップレベルは const と function だけなので new Function で通る。
 */
var _quizVocabCache = { src: null, val: null };
function quizVocabulary(src) {
  if (!src) return null;
  if (_quizVocabCache.src === src) return _quizVocabCache.val;
  var val;
  try {
    val = new Function(src + "\n;return {" +
      "levels: typeof QUIZ_SCOPE_LEVELS !== 'undefined' ? QUIZ_SCOPE_LEVELS : null," +
      "fields: typeof QUIZ_FIELDS !== 'undefined' ? QUIZ_FIELDS : null };")();
    if (!val.levels || !val.fields) {
      val = { error: "QUIZ_SCOPE_LEVELS / QUIZ_FIELDS が見つからない（assembler が変数名を変えた？）" };
    }
  } catch (e) {
    val = { error: "assembler/quiz.js を評価できない: " + String(e && e.message || e) };
  }
  _quizVocabCache = { src: src, val: val };
  return val;
}

function runInventoryTests(DATA, LINKS, COMPOUNDS, STAGES, REACTOR_JS, REACTIONS, QUIZ_JS, ASM_HTML, REF_PAGES) {
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
  // `narrowing` … 🔍 実験カードで絞り込む（2026-09-01・assembler v1494 の受け口⑦）。
  // これで有機の**計算**（元素分析）と「手がかりを使う順番」が繋がる。
  // ⚠ 分子は要らない（絞り込みモードは分子式から候補を立てる画面で、キャンバスを見ない）
  var OPEN = ["naming", "countquiz", "stereo", "fischer", "practice", "narrowing"];
  // `open` の行き先のうち、**キャンバスに載っている分子**を見る画面。
  // ここへ飛ばすときは代表分子を添えないと空振りする（下の検査で鳴らす）。
  // `naming` / `countquiz` / `fischer` / `practice` は assembler が自前で題材を出すので不要
  // （実測済み: naming → naming-modal、countquiz → count-quiz-modal、
  //   fischer → fischer-practice-modal、practice → study-modal。2026-08-21）
  var OPEN_NEEDS_MOLECULE = { stereo: 1, isomer: 1 };
  // `panel` を渡せる行き先（2026-09-01）。**`scope` / `field` と同じ立場**＝「行き先の中のつまみ」。
  // ⚠ `panel` を `kind` にしないのは、`kind` が「リンクの形（何を添えるか）」の軸で、
  //   `open` が「行き先」の軸だから。`narrowing` は assembler の `OPEN_TARGETS` の1値なので
  //   `naming` と同じ層に置く（DESIGN_organic_calc.md §3-1）
  var OPEN_HAS_PANEL = { narrowing: 1 };
  // `reference` … 📖 資料（assembler の参考書。2026-09-04）。
  // ⚠ **必須は label だけ**。ページ id を持たせない ＝ どのページに着地するかは
  //   向こうの `reference.json` の `codes` が決める（app.js の linkQuery の注記）。
  var NEED = {
    summon: ["label", "name"], isomer: ["label", "formula"], mechanism: ["label", "id"],
    reaction: ["label", "name", "reagent"], practice: ["label", "open"], none: ["why"],
    reference: ["label"], ion: ["label"]
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
      // CF1: `panel` は「行き先の中のつまみ」なので、つまみを持つ行き先にしか付けられない
      if (o.panel) {
        assert(o.kind === "practice",
          o.code + ": panel は kind=practice でしか渡せない（kind=" + o.kind + "）");
        assert(OPEN_HAS_PANEL[o.open],
          o.code + ": open=" + o.open + " にはタブが無い（panel を渡しても assembler が無視する）");
      }
      // ⚠ **キャンバスの分子を見る行き先には代表分子が要る**（2026-08-21・ユーザー報告 → 実測）。
      //   `?open=stereo` だけで飛ばすと assembler は `btn-stereo` を押し、キャンバスが空なので
      //   `openAuto(null)` が「立体を見られる sp3炭素がありません」の**トーストを数秒出して終わる**。
      //   モーダルは開かず、来た道の帯も `miss` にならない（`miss` の条件は `?summon=` が
      //   付いていること ＝ 分子を頼んでいない以上「出せなかった」とすら言えない）。
      //   つまり **assembler 側の見張りが原理的に届かない空振り**で、
      //   気づけるのはリンクを組み立てている**こちら側だけ**。だからここで鳴らす
      if (o.kind === "practice" && OPEN_NEEDS_MOLECULE[o.open]) {
        assert(o.name && String(o.name).trim(),
          o.code + ": open=" + o.open + " はキャンバスの分子を見る画面なのに代表分子（name）が無い" +
          "（分子を添えないとトーストだけで終わり、画面には何も残らない）");
      }
      if (o.kind === "isomer") assert(!/[₀-₉]/.test(o.formula), o.code + ": formula に下付き文字（URL に載るので ASCII 数字で書く）");
      assert(!/\*\*/.test(JSON.stringify(o)), o.code + ": Markdown の ** が混入している");
    });
  });

  // CF2: ⚠ **タブ名（panel）も assembler の語彙**（2026-09-01）。
  //   `scope` / `field` とまったく同じ壊れ方をする —— assembler の受け口⑦は
  //   `.nw-mode-tab[data-panel="…"]` を DOM に聞き、**見つからなければ何もしない**
  //   （既定の enum のまま開く）。つまり綴りを間違えても**エラーも出ず、画面も開く**ので、
  //   「元素分析から」を頼んだのに「構造を数える」が出ていることに誰も気づけない。
  //   だから assembler/index.html の実物からタブ名を読んで突き合わせる。
  t("棚卸し: タブ名（panel）が assembler の実在のタブと一致している", function () {
    if (!ASM_HTML) return;   // assembler/index.html を読めない環境ではスキップ
    var tabs = {};
    var re = /class="[^"]*nw-mode-tab[^"]*"[^>]*data-panel="([a-z]+)"/g, m;
    while ((m = re.exec(ASM_HTML))) tabs[m[1]] = true;
    assert(Object.keys(tabs).length > 0,
      "assembler/index.html に .nw-mode-tab[data-panel] が1つも無い（相手が作りを変えた？ この検査を直す）");
    rows.forEach(function (o) {
      if (!o.panel) return;
      assert(tabs[o.panel], o.code + ": 知らない panel「" + o.panel +
        "」（assembler の実在のタブは " + Object.keys(tabs).join(" / ") + "）");
    });
  });

  // ⚠ **出題範囲（scope / field）は assembler の語彙**（2026-08-22・ユーザー申し立て
  //   「qa アルカンの命名を練習する → 命名クイズ分野を問わない に飛ばされる」への手当て）。
  //   assembler は**知らない値を黙って無視する**（前方互換の約束）ので、綴りを間違えても
  //   エラーにならず「分野を問わない」に戻るだけ ＝ **画面では気づけない壊れ方**。
  //   だから実データ（quiz.js の QUIZ_SCOPE_LEVELS / QUIZ_FIELDS）と突き合わせる。
  t("棚卸し: 出題範囲（scope / field）が assembler の語彙と一致している", function () {
    var voc = quizVocabulary(QUIZ_JS);
    if (voc && voc.error) throw new Error(voc.error);
    if (!voc) return;   // quiz.js を読めない環境（file:// 直開き等）ではスキップ
    var okScope = {}, okField = {};
    voc.levels.forEach(function (s) { okScope[s.value] = true; });
    voc.fields.forEach(function (f) { okField[f] = true; });
    // つまみを持つのは命名クイズと「同じ化合物はどれ？」だけ（assembler の OPEN_TARGETS）
    var HAS_KNOBS = { naming: 1, quiz: 1 };
    rows.forEach(function (o) {
      if (!o.scope && !o.field) return;
      assert(o.kind === "practice",
        o.code + ": scope / field は kind=practice でしか渡せない（kind=" + o.kind + "）");
      assert(HAS_KNOBS[o.open],
        o.code + ": open=" + o.open + " には出題範囲のつまみが無い（渡しても無視される）");
      if (o.scope) assert(okScope[o.scope], o.code + ": 知らない scope「" + o.scope +
        "」（assembler の値は " + Object.keys(okScope).join(" / ") + "）");
      if (o.field) assert(okField[o.field], o.code + ": 知らない field「" + o.field +
        "」（assembler の値は " + Object.keys(okField).join(" / ") + "）");
    });
  });

  // ★「ラベルが約束したより広い所へ着く」を止める見張り。
  // ユーザー申し立ての本体はここ ——「アルカンの命名」を押して 1-ナフトール が出た。
  t("棚卸し: 分野を名指しする命名リンクが、分野を渡している", function () {
    // ⚠ エステルは**脂肪族と芳香族にまたがる**（酢酸エチル／安息香酸メチル）ので、
    //    分野では絞れない。除外を名指しで持ち、黙って増えないようにする
    var EXEMPT = { "org.carbonyl.ester-naming": "エステルは脂肪族と芳香族にまたがる" };
    var bad = rows.filter(function (o) {
      return o.kind === "practice" && o.open === "naming" && !o.field && !EXEMPT[o.code];
    }).map(function (o) { return o.code; });
    assert(!bad.length, "命名クイズへ飛ばすのに分野を渡していない: " + bad.join(" / ") +
      "（分野を問わない・1059件 に着地して、アルカンを頼んだのに芳香族が出る）");
    // 除外の側も見張る（消えたら EXEMPT から外す）
    Object.keys(EXEMPT).forEach(function (code) {
      var o = byCode[code];
      assert(o && o.kind === "practice" && o.open === "naming",
        "★ " + code + " が命名リンクでなくなった → EXEMPT から外す");
      assert(!o.field, "★ " + code + " に分野が入った（" + EXEMPT[code] + " のはずだった）→ EXEMPT から外す");
    });
  });

  /* CF4: 📖 資料へのリンクが、向こうに実在するページに着くか（2026-09-04）。
   *
   * ★★ **突き合わせるのは code だけ**。こちらはページ id を持たない（app.js の linkQuery）ので、
   *   壊れ方は「その code を `codes` に持つページが1枚も無い」の一択になる。
   *   ⚠ そのとき assembler は**既定のページ（1枚目）を開く**（前方互換の約束）ので、
   *   **画面はふつうに開いてしまい、誰も気づけない** —— 「アルカンの一般式」を頼んだのに
   *   別のページが出る、という `?panel=` とまったく同じ壊れ方。だからここで鳴らす。
   * ⚠ **`reference.json` を読めない環境（file:// 直開き等）ではスキップ**する。 */
  t("棚卸し: 📖 資料へのリンクが、その code を持つページに実際に当たる", function () {
    var refs = rows.filter(function (o) { return o.kind === "reference"; });
    if (!REF_PAGES || !REF_PAGES.length) return;   // assembler/reference.json を読めない環境
    var byRefCode = {};
    REF_PAGES.forEach(function (p) {
      (p.codes || []).forEach(function (c) { byRefCode[c] = p.id; });
    });
    assert(Object.keys(byRefCode).length > 0,
      "assembler/reference.json のどのページにも codes が無い（相手が作りを変えた？ この検査を直す）");
    refs.forEach(function (o) {
      assert(byRefCode[o.code],
        o.code + ": この code を codes に持つ資料のページが assembler に無い" +
        "（着地は既定のページになり、画面は開くので気づけない）。" +
        "いま codes を持つのは " + Object.keys(byRefCode).length + " 件");
      // ページ id をこちらに持っていないこと（持つと2か所で同じことを決めることになる）
      assert(!o.page && !o.id,
        o.code + ": 資料のリンクにページ id を持たせている（着地先を決めるのは向こうの reference.json）");
    });
    // ★否定対照 —— 実在しない code なら、この検査が見つけること
    assert(!byRefCode["org.__ghost__"],
      "突き合わせが働いていない（存在しない code でもページが見つかると言っている）");
  });

  // ★ 配信データ（questions.json）は**この棚卸しから生成される**ので、向こうだけ塞いでも
  //   `gen_links.js` を回し直した瞬間に古い言い方が戻ってくる。生成元の側も同じ規則で見る
  //   （BUILD_VERB の注記に、なぜ「組む」が禁じ手かを書いてある）
  t("棚卸し: summon の札が「組む」と言っていない（生成元の側も塞ぐ）", function () {
    assert(rows.length > 0, "assembler_links.jsonl を読めていない（テストの前提が崩れている）");
    rows.forEach(function (o) {
      if (o.kind !== "summon") return;
      assert(!BUILD_VERB.test(o.label || ""),
        o.code + ": 棚卸しの札が「組む」系の動詞になっている（" + o.label + "）。" +
        "?summon= は着地した瞬間に分子を組み上げるので、押した人に組む作業は残っていない");
    });
    // ★否定対照 —— 見分けそのものが働いていることを、その場で確かめる
    assert(BUILD_VERB.test("ベンゼンを組み立てる"),
      "「組む」の見分けが働いていない（この検査は何も守っていない）");
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
      // CF3: ⚠ **`open` と `panel` は配信データにも載っていないと URL に付かない**（2026-09-01）。
      //   `kind` と `label` だけを見ていると、`?open=narrowing` は付いたのに `?panel=ea` が
      //   落ちている状態を**「繋がった1件」として数えてしまう** ＝ 押すと既定のタブ
      //   （構造を数える）が開き、元素分析の画面には着かない。件数では見えない壊れ方なので、
      //   運ぶ欄そのものを1つずつ突き合わせる
      ["open", "panel"].forEach(function (k) {
        assert((p.link[k] || null) === (o[k] || null),
          p.code + ": " + k + " がずれている（表 " + (o[k] || "なし") +
          " / 配信 " + (p.link[k] || "なし") + "）。gen_links.js を回し直す");
      });
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
    // C2H4O2 は 2026-08-12 に実機で確認（`?open=isomer&formula=C2H4O2` が開き、全10種）。
    // 組成式 CH₂O だけでは物質が決まらないことを手で確かめさせる入口（org.clue.ch2o-ratio）
    var VERIFIED = ["C2H4O2", "C3H6O", "C3H8O", "C4H8", "C4H10", "C5H12"].sort();
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
    // ⚠ 2026-08-22 に 21→22 本へ。assembler v1428 が**酸化剤の瓶を KMnO₄ と K₂Cr₂O₇ に分けた**
    //   （`DESIGN_reagent_palette.md` §12）。★見直し候補7件を実際に見直した結果、
    //   **拾い直せるものは1件も無い** —— 7件が待っているのは
    //   異性体列挙の上限（1件）・CO₂ の瓶（1件）・イオンを扱えること（4件）・
    //   分子内エステル化（1件）で、**どれも酸化とは無関係**。
    //   ルールも 40→41（`oxidize_primary_vigorous` ＝ 1級アルコールを一気にカルボン酸まで）。
    // ⚠ 2026-08-28 に 22→23 本・41→47 種へ。assembler v1477 が**入試頻度の調査（§10.11）から
    //   7件を実装した** —— 環内/末端の酸化開裂・単発のアミド化・分子内脱水→酸無水物・
    //   ワッカー法・ニトロ還元ほか。増えた瓶は `o2_pdcl2`（酸素・PdCl₂/CuCl₂）の1本だけ。
    //   ★見直し候補7件を1件ずつ突き合わせた結果、**拾い直せるものは今回も1件も無い**:
    //     - `org.aro.c8h10-isomers` … 列挙器の上限。反応とは無関係
    //     - `org.phenol.phenoxide-co2` … CO₂ の瓶が要る。増えたのは o2_pdcl2 で別物
    //     - `org.aroN.aniline-base` / `diazonium-decomp` / `bio.amino-acid-amphoteric` /
    //       `bio.amino-acid-polyprotic` … 4件ともイオン（対イオンの持ち方）待ち。
    //       ⚠ `reduce_nitro` が入ってアニリンは**作れる**ようになったが、壁は生成物ではなく
    //       **結合を持たない対イオンをモデルとキャンバスがどう持つか**なので動いていない
    //     - `org.carbonyl.lactone` … 分子内エステル化待ち。★ ただし**一歩近づいた** ——
    //       `dehydration_anhydride`（分子内脱水→酸無水物）が入り、「同じ分子の中で環を閉じる」
    //       仕掛けは**もう在る**。足りないのは COOH+COOH ではなく **OH+COOH に当てること**だけ。
    //       ⚠ 次に assembler が分子内エステル化を足したら、この1件は本当に繋がる
    // ⚠ 2026-09-01 に 47→49 種へ。assembler v1488 が**ビニロン**（`acetalization_pva`）、
    //   v1491 が**開環重合**（ε-カプロラクタム → ナイロン6）を足した。瓶は 23 のまま
    //   （ビニロンの -CH₂- は瓶ではなく**キャンバスの HCHO** から来る）。
    //   ★見直し候補7件を1件ずつ突き合わせた結果、**拾い直せるものは今回も1件も無い**
    //   ——2本とも重合で、列挙器の上限・CO₂ の瓶・対イオン・分子内エステル化のどれにも当たらない。
    // ★★ ただし**4件の待っている相手が変わった**（2026-09-01 ユーザー決定）:
    //   > **反応式を書く際には ion-equ というのが基本的な使い分け**
    //   ＝ `org.aroN.aniline-base` / `diazonium-decomp` / `bio.amino-acid-amphoteric` /
    //   `bio.amino-acid-polyprotic` の4件は、**assembler が対イオンを持てるようになるのを
    //   待つ必要が無くなった**。⚠ 待つ相手は「ion-equation にその物質が収録されること」に移った。
    //   ⚠ 実測（2026-09-01）: ion-equation に**酢酸とエタノールは在る**が、
    //   **アニリン・グリシン・フェノール・サリチル酸・ジアゾニウムは1件も無い**
    //   （監査ログに名前が出るだけ）。★ だから今はまだ繋がらないが、
    //   **壁はモデルの作り直しではなくデータの追加**に下がった。
    //   ⚠⚠ この検査は v1488 から6版ぶん赤いまま見逃されていた（統合セッションが
    //   assembler を触ったときに qa の全走を回していなかった。`DEVELOPMENT.md` に記録）。
    // ★ 2026-09-02（v1501）: 系統樹の辺を埋める反応を4本足したので 49 → 53。
    //   無水酢酸（酢酸2分子）／ベンゼンの水素化／クメン／酢酸ビニル。
    //   ⚠ **瓶は1本も増えていない**（4本とも既存の瓶に相乗り）ので KNOWN_BOTTLES は 23 のまま。
    //   ★見直し候補7件はこの4本でも1件も繋がらない（別レーンが1件ずつ突き合わせ済み）。
    // ★ 2026-09-03（v1511）: 塩素・光の瓶を1本足し、実行ルールを3本足した
    //   （アルカンの光塩素化／アルカリ融解／クロロベンゼンの加水分解）。瓶 23→24・ルール 53→56。
    //   ⚠ ★見直し候補7件はこの3本でも1件も繋がらない（org.phenol.phenoxide-co2 は CO₂ の瓶待ちで、
    //   足したのは Cl₂ の瓶なので別物。ただしフェノキシドへの行きが2本増えたので、
    //   CO₂ の瓶が入れば一気に繋がる位置に来た）。
    // ★ 2026-09-07（v1520）: ジアゾニウムが入った。亜硝酸ナトリウム＋塩酸の試薬を1本、
    //   実行ルールを3本（ジアゾ化／ジアゾニウム塩の加熱分解／ジアゾカップリング）。
    //   瓶 25→26・ルール 61→64。
    //   ★見直し候補は**残り2件**（4件は 2026-09-06 に `kind:"ion"` へ移した）で、
    //   **今回も1件も繋がらない** —— 1件ずつ突き合わせた結果:
    //     - `org.aro.c8h10-isomers` … 異性体列挙器の上限。反応とは無関係
    //     - `org.carbonyl.lactone` … 分子内エステル化待ち。足したのは N₂ まわりで別物
    //   ⚠⚠ **ただし別の宿題が動いた**（この検査の担当外なので、ここでは直さない）:
    //   `org.aroN.aniline-base` / `org.aroN.diazonium-decomp` の2件は 2026-09-01 に
    //   「ion-equation に収録されるのを待つ」として `kind:"ion"` へ移したが、
    //   **assembler が対イオンを持てるようになり、ジアゾニウム塩も本物の塩として描けるようになった**
    //   ＝ **assembler へ戻す道が開いた**。★ とくに `diazonium-decomp` は
    //   「行き先が2つある（フェノール／アゾ化合物）」という積み残しがあるので、
    //   行き先を決める作業と一緒に見直すこと。
    // ★ 2026-09-15（qa v111・assembler v1541〜v1563 を追って）: 燃焼の瓶 `o2_flame` が1本（c0abd446）、
    //   ルールが10本（combustion / add_cl2 / add_cl2_benzene_ring / hydrolysis_amide / copolymerization /
    //   dehydrohalogenation / ring_opening_addition / alkyne_trimerization / naphthalene_air_oxidation /
    //   williamson_ether）。瓶 26→27・ルール 64→74・機構は 14 のまま。
    //   ⚠ v1541 から赤いまま（瓶の assert が先に落ちるので、ルールのずれは見えていなかった）。
    //   ★見直し候補の残り2件は**今回も繋がらない**:
    //     - `org.aro.c8h10-isomers` … 異性体列挙器の上限。反応とは無関係
    //     - `org.carbonyl.lactone` … エステル化は今も分子間だけ（reactor.js の esterification の detect が
    //       同じ分子の -OH を飛ばしている）。足されたルールに分子内エステル化は無い
    //   ⚠⚠ **★の付いていない none のうち4件は、新しいルールで繋がりうる**（v111 の便では繋いでいない）:
    //   `org.ali.alkane-combustion`（combustion）・`org.ali.acetylene-benzene`（alkyne_trimerization）・
    //   `org.poly.copolymer` / `org.poly.sbr-copolymer`（copolymerization）。
    //   ★ **2026-09-17（qa v115）に4件とも kind:"reaction" で繋いだ**（ユーザー決定「つなげる」）。実機で確認:
    //     - 燃焼 … `?summon=methane&reagent=combustion` で札が選ばれた状態で着き、押すと CO₂ ＋ 2H₂O
    //     - 三量化・共重合 … ⚠ **札は複数分子が並んだときだけ出る**（三量化はちょうど3分子・共重合は2種類以上）が、
    //       `?summon=` は1分子しか置けない。着地のあと「名称から呼び出す」で足すと、選んだ札が印つきで出て
    //       ベンゼン／スチレン-ブタジエンの鎖ができる。札（label）が「並べて」と言い、足す分子は note に書いた
    //   ★ 2026-09-19（assembler v1583）: 75本目は diene_cis_trans（ポリイソプレンのシス形⇄トランス形）。
    //     none の行は増えない。org.poly.rubber-cis-trans の note を「入れ替える」札に合わせて直した
    //   ⚠ 次にルールが増えたときも、**none の why が「reactor に無い」と言っている行**を拾い直すこと
    var KNOWN_BOTTLES = 27, KNOWN_RULES = 75, KNOWN_MECHANISMS = 14;   // 瓶は transform 17 ＋ detect 6
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

  t("版: app.js が読む資産の版がすべて index.html と一致する（verify-release の死角）", function () {
    // ⚠ **questions.json だけを見ていて取りこぼした**（2026-08-12）。
    // app.js は data/exam_usage.jsonl も読んでおり、そちらは v58 のまま置き去りになっていた。
    // 実績のデータを差し替えても古い JSON が配られる状態で、しかも
    // 「読めなくても本体は動く」設計なので**静かに古いまま**になる。
    // 名指しで1つずつ書くのをやめ、**app.js に出てくる ?v= を全部見る**
    var asset = (indexHtml.match(/\?v=(\d+)/) || [])[1];
    var refs = appJs.match(/[\w./-]+\?v=\d+/g) || [];
    assert(refs.length, "app.js に ?v= が1つも見つからない（読み込みの書き方が変わった？）");
    var bad = refs.filter(function (r) { return r.split("?v=")[1] !== asset; });
    assert(!bad.length,
      "index.html は v" + asset + " なのに app.js が " + bad.join(" / ") +
      " を読んでいる。差し替えても古い実体がキャッシュから配られる");
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
      // ⚠ 2026-09-23 から #unit-list には編の見出し（h3.part-head）も並ぶ ＝ カードは .unit だけ
      return Array.prototype.slice.call(d.querySelectorAll("#unit-list > .unit"));
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

    // 2026-09-23: 33単元が1列に続き、無機・理論が有機の下にぶらさがって見えた → タブで分ける。
    //   同じ日のうちに、タブは科目（化学基礎・化学）・単元は教科書の節に（ユーザー「区別を明確に」「粒度が異なる」）
    t("ホーム: 科目のタブ（化学基礎・化学）で、その科目の単元カードだけが見え、編の見出しで区切られる", function () {
      var tabs = Array.prototype.slice.call(d.querySelectorAll("#domain-tabs button[data-domain]"));
      var names = tabs.map(function (b) { return b.getAttribute("data-domain"); });
      assert(names.join(",") === "化学基礎,化学", "タブの並びが違う: " + names.join(","));
      var COURSE = { "化学基礎": "basic", "化学": "adv" };
      var KEY = "slz-qa-domain", saved = null;
      try { saved = d.defaultView.localStorage.getItem(KEY); } catch (e) {}
      try {
        names.forEach(function (name) {
          d.querySelector('#domain-tabs button[data-domain="' + name + '"]').click();
          var shown = unitCards().filter(function (c) { return !c.classList.contains("hidden"); });
          var want = DATA.units.filter(function (u) { return u.course === COURSE[name]; }).length;
          assert(want > 0 && shown.length === want, name + ": 見えるカード " + shown.length + "枚 ≠ " + want);
          assert(shown.every(function (c) { return c.getAttribute("data-domain") === name; }),
            name + ": 別の分野のカードが見えている");
          var on = d.querySelector("#domain-tabs .is-on");
          assert(on && on.getAttribute("data-domain") === name, name + ": 選んだタブが塗られていない");
          var heads = Array.prototype.slice.call(d.querySelectorAll("#unit-list > .part-head:not(.hidden)")).map(function (h) { return h.textContent; });
          var wantHeads = [];
          DATA.units.forEach(function (u) { if (u.course === COURSE[name] && wantHeads.indexOf(u.part) < 0) wantHeads.push(u.part); });
          assert(heads.join(",") === wantHeads.join(","), name + ": 編の見出しが違う: " + heads.join(","));
        });
        // 習得マップ: 科目 ／ 編 の見出し（編の数だけ）
        d.getElementById("btn-map").click();
        var gd = Array.prototype.slice.call(d.querySelectorAll("#map-host .gd")).map(function (e) { return e.textContent; });
        var wantGd = [];
        DATA.units.forEach(function (u) { var k = (u.course === "basic" ? "化学基礎" : "化学") + " ／ " + u.part; if (wantGd.indexOf(k) < 0) wantGd.push(k); });
        assert(gd.join(",") === wantGd.join(","), "習得マップの見出しが違う: " + gd.join(","));
        d.getElementById("btn-map-back").click();
      } finally {
        try {
          if (saved === null) d.defaultView.localStorage.removeItem(KEY); else d.defaultView.localStorage.setItem(KEY, saved);
        } catch (e) {}
        var first = d.querySelector('#domain-tabs button[data-domain="' + (saved || "化学基礎") + '"]');
        if (first) first.click();
      }
    });

    t("ホーム: 分類の見出しが分類の数だけ並び、項目数は束ねた単元の合計・「まとめて」の回はその全単元から出る", function () {
      var cats = [];
      DATA.units.forEach(function (u) { if (u.category && cats.indexOf(u.category) < 0) cats.push(u.category); });
      var heads = Array.prototype.slice.call(d.querySelectorAll("#unit-list > .cat-head"));
      assert(heads.length === cats.length, "分類の見出し " + heads.length + " 個 ≠ 分類 " + cats.length + " 個");
      heads.forEach(function (h, i) {
        var name = h.querySelector("h4").textContent;
        assert(name === cats[i], "分類の見出しの並びが違う: " + name + " ≠ " + cats[i]);
        var ms = DATA.units.filter(function (u) { return u.category === name; }).map(function (u) { return u.id; });
        var want = DATA.patterns.filter(function (p) { return ms.indexOf(p.unit) >= 0; }).length;
        var m = h.textContent.match(/知識項目\s*(\d+)/);
        assert(m && Number(m[1]) === want, name + ": 項目数の表示 " + (m && m[1]) + " ≠ " + want);
        // 見出しのすぐ後ろのカードが、その分類の単元（in-cat）
        var next = h.nextElementSibling;
        assert(next && next.classList.contains("unit") && next.classList.contains("in-cat"), name + ": 見出しの直後が分類の単元カードでない");
      });
      assert(d.querySelectorAll("#unit-list > .unit.in-cat").length === DATA.units.filter(function (u) { return u.category; }).length,
        "分類に入る単元カード（.in-cat）の数が違う");
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

    t("選択問題: 正解だけを選ぶと「正解」になる", function () {
      var card = unitCards()[0];
      btnIn(card, "選択問題").click();
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

    t("選択問題: 正解を1つ落とすと不正解になる（完全一致採点）", function () {
      var card = unitCards()[0];
      btnIn(card, "選択問題").click();
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

    // ---- 習得マップの4状態（2026-09-19・qa-map4） ----
    // 未着手 / 着手中（めくり・選択問題の一方だけ正解）/ 間違えた（やり直しが残っている）/ どちらも正解。
    // 判定の芯（記録 → 状態）を直接叩く。UI 経由だと何回もクリックが要る
    var QE = frame.contentWindow.QaEngine || {};
    var stOf = QE.stateOfRecord, mig = QE.migrateRecord, apply = QE.applyResult, flipKind = QE.flipKind;
    var needs = QE.needsOf, needsLabel = QE.needsLabel;
    function blank() {
      return { box: 0, right: 0, wrong: 0, seen: 0, last: 0, cRight: 0, cWrong: 0,
               fRight: 0, fWrong: 0, missF: false, missC: false };
    }
    function play(steps) {   // steps: [["flip"|"choice", true|false], ...]
      var r = blank();
      steps.forEach(function (s) { apply(r, s[1], s[0]); });
      return r;
    }

    t("4状態: 露出している口がそろっている", function () {
      ["stateOfRecord", "migrateRecord", "applyResult", "flipKind", "needsOf", "needsLabel", "STATE_NAME", "STATES"]
        .forEach(function (k) { assert(QE[k], "QaEngine." + k + " が無い"); });
      assert(QE.STATES.length === 4, "状態が " + QE.STATES.length + " 個（4つにする）");
      ["new", "wip", "miss", "done"].forEach(function (k) {
        assert(QE.STATES.indexOf(k) >= 0, "状態 " + k + " が無い");
      });
    });

    t("4状態: 一度も出していなければ未着手", function () {
      assert(stOf(null) === "new", "記録なしが未着手にならない");
      assert(stOf(blank()) === "new", "seen=0 が未着手にならない");
      assert(stOf({ seen: 0, box: 0, cRight: 3 }) === "new", "seen=0 で cRight だけ立った記録が未着手にならない");
    });

    t("4状態: めくり・選択問題の一方だけ正解なら着手中", function () {
      assert(stOf(play([["flip", true]])) === "wip", "めくりだけ正解が着手中にならない");
      assert(stOf(play([["choice", true]])) === "wip", "選択問題だけ正解が着手中にならない");
      assert(stOf(play([["flip", true], ["flip", true], ["flip", true], ["flip", true]])) === "wip",
        "めくりを何回わかったにしても、選択問題の正解が無ければ緑にしない");
    });

    t("4状態: 両方で正解すればどちらも正解（回数は要らない）", function () {
      assert(stOf(play([["flip", true], ["choice", true]])) === "done", "めくり1回＋選択問題1回で緑にならない");
    });

    t("4状態: 「あやしい」「不正解」で間違えたになり、同じモードの正解で解除される", function () {
      var a = play([["flip", false]]);
      assert(stOf(a) === "miss", "めくりの「あやしい」が間違えたにならない");
      apply(a, true, "choice");
      assert(stOf(a) === "miss", "めくりの間違いが選択問題の正解で解除された（同じモードでやり直す）");
      apply(a, true, "flip");
      assert(stOf(a) === "done", "めくりでわかったにしたら解除され、両方そろって緑になるはず（" + stOf(a) + "）");
      var b = play([["choice", false]]);
      assert(stOf(b) === "miss", "選択問題の不正解が間違えたにならない");
      apply(b, true, "choice");
      assert(stOf(b) === "wip", "選択問題で正解したら解除されて着手中になるはず（" + stOf(b) + "）");
    });

    t("4状態: どちらも正解のあとに間違えると間違えたに戻る", function () {
      var r = play([["flip", true], ["choice", true]]);
      assert(stOf(r) === "done", "前提が崩れている");
      apply(r, false, "choice");
      assert(stOf(r) === "miss", "緑のあとの不正解が間違えたにならない（" + stOf(r) + "）");
    });

    t("裏返し: 「間違えた」⇄「どちらも正解」のときだけ裏返す（両向き）", function () {
      assert(flipKind("done", "miss") === "to-miss", "緑→赤が裏返らない");
      assert(flipKind("miss", "done") === "to-done", "赤→緑が裏返らない");
      [["new", "wip"], ["wip", "done"], ["wip", "miss"], ["miss", "wip"], ["done", "done"],
       ["miss", "miss"], [undefined, "done"], [undefined, "miss"], ["done", "wip"]].forEach(function (p) {
        assert(flipKind(p[0], p[1]) === "", p[0] + "→" + p[1] + " で裏返ってしまう");
      });
    });

    // ---- 旧状態からの読み替え（既存の記録を消さない） ----
    t("読み替え: 旧「測定で未確認」（めくりだけで box≥4）は着手中", function () {
      var old = { seen: 4, box: 4, right: 4, wrong: 0, cRight: 0, cWrong: 0, last: 100 };
      var m = mig(old);
      assert(m.fRight === 4 && m.fWrong === 0, "めくりの正解数が差し引きで出ていない");
      assert(stOf(old) === "wip", "旧の測定で未確認が " + stOf(old) + " になった");
    });

    t("読み替え: 旧「定着」はめくりにも正解があればどちらも正解、選択問題だけなら着手中", function () {
      assert(stOf({ seen: 5, box: 4, right: 5, wrong: 0, cRight: 1, cWrong: 0 }) === "done",
        "めくり4＋選択問題1 の旧定着が緑にならない");
      assert(stOf({ seen: 4, box: 4, right: 4, wrong: 0, cRight: 4, cWrong: 0 }) === "wip",
        "選択問題だけの旧定着が着手中にならない（めくりの正解が無い）");
    });

    t("読み替え: 最後の1回が不正解（box=1）の記録は、そのモードで間違えた", function () {
      var f = mig({ seen: 2, box: 1, right: 1, wrong: 1, cRight: 1, cWrong: 0 });
      assert(f.missF === true && f.missC === false, "めくりの不正解がめくりの旗にならない");
      var c = mig({ seen: 2, box: 1, right: 1, wrong: 1, cRight: 0, cWrong: 1 });
      assert(c.missC === true && c.missF === false, "選択問題の不正解が選択問題の旗にならない");
      var both = mig({ seen: 3, box: 1, right: 1, wrong: 2, cRight: 1, cWrong: 1 });
      assert(both.missF && both.missC, "どちらが最後か分からない記録は両方に旗を立てる");
    });

    t("読み替え: 最後が正解の記録は、それより前の不正解を解けたものとして扱う", function () {
      var r = mig({ seen: 3, box: 2, right: 2, wrong: 1, cRight: 1, cWrong: 1 });
      assert(!r.missF && !r.missC, "最後が正解なのに旗が立っている");
      assert(stOf(r) === "done", "めくり1＋選択問題1 の正解があるのに " + stOf(r));
    });

    t("読み替え: 元の欄は1つも書き換えない（足すだけ）", function () {
      var old = { seen: 7, box: 3, right: 5, wrong: 2, cRight: 2, cWrong: 1, last: 12345 };
      var copy = JSON.parse(JSON.stringify(old));
      var m = mig(old);
      Object.keys(copy).forEach(function (k) {
        assert(m[k] === copy[k], "欄 " + k + " が " + copy[k] + " → " + m[k] + " に変わった");
        assert(old[k] === copy[k], "読み替えが元の記録を書き換えた（" + k + "）");
      });
    });

    // ---- 次にやること（needsLabel は stateOfRecord と同じ記録から作る） ----
    t("残り: 未着手には「両方で正解しよう」と言う", function () {
      var s = needsLabel(blank());
      assert(s.indexOf("めくり") >= 0 && s.indexOf("選択問題") >= 0, "未着手の一言: " + s);
    });

    t("残り: 着手中には足りないほうのモードだけを言う", function () {
      var s1 = needsLabel(play([["flip", true]]));
      assert(s1.indexOf("選択問題") >= 0 && s1.indexOf("めくり") < 0, "めくりだけ正解の一言: " + s1);
      var s2 = needsLabel(play([["choice", true]]));
      assert(s2.indexOf("めくり") >= 0 && s2.indexOf("選択問題") < 0, "選択問題だけ正解の一言: " + s2);
    });

    t("残り: 間違えたには「もう一度」とやり直すモードを言う", function () {
      var s = needsLabel(play([["flip", true], ["choice", true], ["choice", false]]));
      assert(s.indexOf("もう一度") >= 0 && s.indexOf("選択問題") >= 0, "選択問題で間違えた一言: " + s);
    });

    t("残り: 残りが空になるのは stateOfRecord が「どちらも正解」と言うときだけ", function () {
      var bad = [];
      [0, 1, 2].forEach(function (fR) { [0, 1].forEach(function (cR) {
        [false, true].forEach(function (mF) { [false, true].forEach(function (mC) {
          var r = blank();
          r.seen = fR + cR + (mF ? 1 : 0) + (mC ? 1 : 0);
          r.fRight = fR; r.cRight = cR; r.missF = mF; r.missC = mC;
          if ((needsLabel(r) === "") !== (stOf(r) === "done")) {
            bad.push("fR=" + fR + " cR=" + cR + " missF=" + mF + " missC=" + mC + " → " + stOf(r) + "「" + needsLabel(r) + "」");
          }
          var n = needs(r);
          if ((!n.flip && !n.choice) !== (stOf(r) === "done")) bad.push("needsOf が食い違う: " + JSON.stringify(n));
        }); });
      }); });
      assert(!bad.length, bad.slice(0, 3).join(" / "));
    });

    t("定着: 記録の器が変わったので保存キーを上げている（古い記録を読まない）", function () {
      // v1 の記録は mode を持たないので、読むと根拠のない緑が残る。
      // **消してはいない**（読まなくなるだけ。学習履歴は取り戻せる）
      var key = QE.STORE_KEY;
      assert(key && key !== "slz-qa-v1",
        "保存キーが " + key + " のまま（mode を持たない古い記録を読み込んでしまう）");
    });

    // ---- 画面: 凡例・注記・一覧・文言 ----
    t("マップ: 凡例は4つだけで、合計が総数になる", function () {
      d.getElementById("btn-map").click();
      var items = [].slice.call(d.querySelectorAll(".legend span")).filter(function (e) {
        return !e.classList.contains("tot");
      });
      assert(items.length === 4, "凡例が " + items.length + " 個");
      var names = items.map(function (e) { return e.textContent.replace(/[\d\s]/g, ""); });
      ["どちらも正解", "着手中", "間違えた", "未着手"].forEach(function (want) {
        assert(names.indexOf(want) >= 0, "凡例に「" + want + "」が無い（" + names.join("/") + "）");
      });
      var sum = items.reduce(function (a, e) { return a + Number(e.querySelector("b").textContent); }, 0);
      assert(sum === DATA.patterns.length, "凡例の合計 " + sum + " が知識項目 " + DATA.patterns.length + " 件と合わない");
      d.getElementById("btn-map-back").click();
    });

    t("マップ: 注記は1行で、めくりと選択問題の両方を言う", function () {
      d.getElementById("btn-map").click();
      var note = d.querySelector(".map-note");
      assert(note, "習得マップに注記が無い");
      var text = note.innerText;
      assert(text.indexOf("めくり") >= 0 && text.indexOf("選択問題") >= 0, "注記: " + text);
      assert(text.length <= 60, "注記が長い（" + text.length + " 字）。小さい字の説明は読まれない");
      d.getElementById("btn-map-back").click();
    });

    t("マップ: 緑でない項目にだけ「次にやること」が出る", function () {
      d.getElementById("btn-map").click();
      var first = d.querySelector(".gc[data-unit][data-lv]");
      var uid = first.getAttribute("data-unit"), lv = first.getAttribute("data-lv");
      first.click();
      var rows = Array.prototype.slice.call(d.querySelectorAll("#map-detail .mi"));
      assert(rows.length, "マスを開いても項目が出ない");
      var bad = rows.filter(function (li) {
        var 緑 = li.classList.contains("done");
        var 残りあり = !!li.querySelector(".mi-next");
        return 緑 ? 残りあり : !残りあり;
      });
      assert(!bad.length, bad.length + " 行で「次にやること」の出し方が状態と食い違う");
      d.querySelector('.gc[data-unit="' + uid + '"][data-lv="' + lv + '"]').click();
      d.getElementById("btn-map-back").click();
    });

    t("文言: 画面に「測定」「帯」が残っていない（ホーム・マップ・明細・meta）", function () {
      var found = [];
      function scan(where, el) {
        var s = (el.innerText || "");
        ["測定", "帯"].forEach(function (w) { if (s.indexOf(w) >= 0) found.push(where + " に「" + w + "」"); });
      }
      scan("ホーム", d.getElementById("view-home"));
      d.getElementById("btn-map").click();
      var c = d.querySelector(".gc[data-unit][data-lv]");
      if (!c.classList.contains("is-sel")) c.click();
      scan("習得マップ", d.getElementById("view-map"));
      d.querySelector(".gc.is-sel").click();
      d.getElementById("btn-map-back").click();
      assert(btnIn(unitCards()[0], "選択問題"), "単元カードに「選択問題」のボタンが無い");
      assert(!btnIn(unitCards()[0], "測" + "定"), "単元カードに「測定」のボタンが残っている");
      var md = d.querySelector('meta[name="description"]').getAttribute("content");
      var og = d.querySelector('meta[property="og:description"]').getAttribute("content");
      if (/測定|帯/.test(md)) found.push("meta description");
      if (/測定|帯/.test(og)) found.push("og:description");
      assert(!found.length, found.join(" / "));
    });

    // ---- 裏返し（オセロ）が画面で起きるか ----
    // 記録を仕込んで、マップを開いたときに1つだけ裏返ることを見る。
    // ⚠ 利用者の記録を汚さないよう、前後で2つのキーを戻す
    function withSeeded(code, shownState, record, fn) {
      var W = frame.contentWindow, K = QE.STORE_KEY, SK = QE.SHOWN_KEY;
      var saved = W.localStorage.getItem(K), savedShown = W.localStorage.getItem(SK);
      try {
        var pr = {}; try { pr = JSON.parse(saved) || {}; } catch (e) {}
        pr[code] = record;
        W.localStorage.setItem(K, JSON.stringify(pr));
        var sh = {}; sh[code] = shownState;
        W.localStorage.setItem(SK, JSON.stringify(sh));
        QE.reload();
        fn();
      } finally {
        if (saved === null) W.localStorage.removeItem(K); else W.localStorage.setItem(K, saved);
        if (savedShown === null) W.localStorage.removeItem(SK); else W.localStorage.setItem(SK, savedShown);
        QE.reload();
        if (!d.getElementById("view-map").classList.contains("hidden")) d.getElementById("btn-map-back").click();
      }
    }

    t("裏返し: 緑だった項目を間違えると、マップを開いたとき赤へ裏返る（1回だけ）", function () {
      var code = DATA.patterns[0].code;
      withSeeded(code, "done", play([["flip", true], ["choice", true], ["choice", false]]), function () {
        d.getElementById("btn-map").click();
        var f = d.querySelectorAll(".gc .dot.flip");
        assert(f.length === 1, "裏返る点が " + f.length + " 個（1個のはず）");
        assert(f[0].classList.contains("to-miss") && f[0].classList.contains("miss"), "赤への裏返しになっていない: " + f[0].className);
        // 描き直し（マスを押す）でもう一度は回らない
        d.querySelector(".gc[data-unit]").click();
        d.querySelector(".gc[data-unit]").click();
        assert(d.querySelectorAll(".gc .dot.flip").length === 0, "描き直すたびに裏返っている");
      });
    });

    t("裏返し: 赤だった項目をやり直して両方そろうと、緑へ裏返る", function () {
      var code = DATA.patterns[0].code;
      withSeeded(code, "miss", play([["flip", true], ["choice", false], ["choice", true]]), function () {
        d.getElementById("btn-map").click();
        var f = d.querySelectorAll(".gc .dot.flip");
        assert(f.length === 1 && f[0].classList.contains("to-done") && f[0].classList.contains("done"),
          "緑への裏返しになっていない（" + f.length + " 個）");
      });
    });

    t("裏返し: 赤→着手中（まだ片方だけ）は裏返さない", function () {
      var code = DATA.patterns[0].code;
      withSeeded(code, "miss", play([["choice", false], ["choice", true]]), function () {
        d.getElementById("btn-map").click();
        assert(d.querySelectorAll(".gc .dot.flip").length === 0, "緑になっていないのに裏返った");
      });
    });

    t("やり直し: 間違えたがあると、マップにやり直しのボタンが出て、そのモードで始まる", function () {
      var code = DATA.patterns[0].code;
      withSeeded(code, "miss", play([["flip", true], ["choice", false]]), function () {
        d.getElementById("btn-map").click();
        var b = d.getElementById("btn-retry-choice");
        assert(b, "選択問題のやり直しボタンが無い");
        b.click();
        assert(!d.getElementById("view-study").classList.contains("hidden"), "やり直しの回に入らない");
        assert(d.querySelectorAll("#card-host .opt").length > 0, "選択問題で始まっていない");
        d.getElementById("btn-quit").click();
        assert(!d.getElementById("view-map").classList.contains("hidden"), "やめたらマップへ戻るはず");
      });
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

    // ---- ヘッダーの戻り道（2026-09-15・ユーザー指摘） ----
    // ⚠ 指摘:「ハブにもどるボタンはあるのですが、qaに戻るボタンが無いように見えます」
    //   「ハブ、という表現は伝わりにくい」。
    // ★ ヘッダーに2段を常に置く: 外＝「🏠 化学レンズ」（ほかのアプリと同じ表記）／中＝「一問一答」（単元一覧）。
    //   実測（v110）では、習得マップのマスから始めた回の「やめる」と、その結果画面の
    //   「単元にもどる」がマップへ着地し、単元一覧まで2手かかっていた。
    var NAV_KEY = frame.contentWindow.QaEngine && frame.contentWindow.QaEngine.STORE_KEY;
    function visibleView() {
      return ["view-home", "view-map", "view-study", "view-result"].filter(function (v) {
        return !d.getElementById(v).classList.contains("hidden");
      });
    }
    // ヘッダーの「一問一答」を**本物のクリック**で押す。既定の遷移を止めたか（＝ページを開き直していないか）も返す
    function pressHeaderHome() {
      var a = d.getElementById("nav-home");
      assert(a, "ヘッダーに「一問一答」のリンク（#nav-home）が無い");
      var ev = new frame.contentWindow.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      return !a.dispatchEvent(ev);   // true ＝ 既定の遷移を止めた
    }
    function assertLandedHome(where) {
      var v = visibleView();
      assert(v.length === 1 && v[0] === "view-home",
        where + " でヘッダーの「一問一答」を押しても単元一覧に着かない（見えている画面: " + v.join(",") + "）");
    }
    function flipThrough() {
      // めくり回を最後まで進める（答えを見る → わかった）
      for (var k = 0; k < 80 && !d.getElementById("view-study").classList.contains("hidden"); k++) {
        var r = d.getElementById("btn-reveal"); if (r) r.click();
        var g = d.getElementById("btn-good-q"); if (g) g.click();
      }
    }

    t("ヘッダー: 戻り道は「🏠 化学レンズ」と「一問一答」の2本だけ", function () {
      var links = Array.prototype.slice.call(d.querySelectorAll(".top a"));
      assert(links.length === 2, "ヘッダーの横並びのリンクが " + links.length + " 本（2本まで）");
      var out = d.querySelector('.top a[href="../"]');
      assert(out && /🏠\s*化学レンズ/.test(out.textContent),
        "化学レンズのトップへ戻るリンクが「🏠 化学レンズ」になっていない（" + (out && out.textContent.trim()) + "）");
      var home = d.getElementById("nav-home");
      assert(home && home.getAttribute("href") === "./" && home.textContent.indexOf("一問一答") >= 0,
        "「一問一答」が単元一覧へのリンクになっていない");
    });

    t("ヘッダー: 画面の文字・aria-label・title に「ハブ」が無い（伝わりにくい語）", function () {
      var bad = [];
      var w = d.createTreeWalker(d.body, frame.contentWindow.NodeFilter.SHOW_TEXT, null);
      for (var n = w.nextNode(); n; n = w.nextNode()) {
        var tag = n.parentNode && n.parentNode.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE") continue;
        if (n.nodeValue.indexOf("ハブ") >= 0) bad.push("文字「" + n.nodeValue.trim().slice(0, 20) + "」");
      }
      Array.prototype.forEach.call(d.querySelectorAll("[aria-label],[title],[alt]"), function (el) {
        ["aria-label", "title", "alt"].forEach(function (k) {
          var s = el.getAttribute(k);
          if (s && s.indexOf("ハブ") >= 0) bad.push(k + "「" + s + "」");
        });
      });
      if (d.title.indexOf("ハブ") >= 0) bad.push("<title>");
      assert(!bad.length, "「ハブ」が画面に残っている: " + bad.slice(0, 4).join(" / "));
    });

    t("ヘッダー: どの画面からも「一問一答」の1手で単元一覧に着く（ページは開き直さない）", function () {
      var saved = NAV_KEY ? frame.contentWindow.localStorage.getItem(NAV_KEY) : null;
      var visited = [];
      function check(where, setup) {
        setup();
        var v = visibleView()[0];
        assert(pressHeaderHome(), where + " で「一問一答」がページを開き直している（既定の遷移を止めていない）");
        assertLandedHome(where + "（" + v + "）");
        visited.push(where);
      }
      try {
        check("単元一覧", function () {});
        check("習得マップ", function () { d.getElementById("btn-map").click(); });
        check("習得マップ（マスを開いた）", function () {
          d.getElementById("btn-map").click();
          if (!d.getElementById("btn-map-flip")) mapCells()[0].click();
        });
        check("暗記（答えを見る前）", function () { btnIn(unitCards()[0], "暗記").click(); });
        check("暗記（答えを開いた）", function () {
          btnIn(unitCards()[0], "暗記").click(); d.getElementById("btn-reveal").click();
        });
        check("測定（採点後）", function () {
          btnIn(unitCards()[0], "選択問題").click();
          d.querySelector("#opts input").click(); d.getElementById("btn-grade").click();
        });
        check("マスから始めた暗記", function () {
          d.getElementById("btn-map").click();
          if (!d.getElementById("btn-map-flip")) mapCells()[0].click();
          d.getElementById("btn-map-flip").click();
        });
        check("マスから始めた回の結果", function () {
          d.getElementById("btn-map").click();
          var one = mapCells().filter(function (c) { return Number(c.querySelector(".gc-n").textContent) === 1; })[0] ||
            mapCells()[0];
          if (!one.classList.contains("is-sel")) one.click();
          d.getElementById("btn-map-flip").click();
          flipThrough();
          assert(!d.getElementById("view-result").classList.contains("hidden"), "結果画面まで進めない（テストの前提）");
        });
      } finally {
        // めくりで付けた記録を元に戻す（テスト用の iframe でも、利用者の記録と同じ置き場なので汚さない）
        if (NAV_KEY) {
          if (saved === null) frame.contentWindow.localStorage.removeItem(NAV_KEY);
          else frame.contentWindow.localStorage.setItem(NAV_KEY, saved);
        }
        var sel = d.querySelector(".gc.is-sel");
        if (sel) { d.getElementById("btn-map").click(); d.querySelector(".gc.is-sel").click(); d.getElementById("btn-map-back").click(); }
      }
      assert(visited.length === 8, "回れた画面が " + visited.length + " / 8");
    });

    t("ヘッダー: 演習の途中で「一問一答」を押しても「やめる」と同じ扱い（記録も控えも動かさない）", function () {
      var W = frame.contentWindow;
      var RK = "qa.resume.v1";
      function snap() { return [NAV_KEY ? W.localStorage.getItem(NAV_KEY) : "", W.sessionStorage.getItem(RK)]; }
      function midway() {
        btnIn(unitCards()[0], "選択問題").click();
        d.querySelector("#opts input").click();          // 選んだが、まだ採点していない
      }
      midway();
      var before = snap();
      assert(pressHeaderHome(), "既定の遷移を止めていない");
      assertLandedHome("測定の途中");
      var byHeader = snap();
      midway();
      d.getElementById("btn-quit").click();
      var byQuit = snap();
      assert(byHeader[0] === before[0] && byHeader[1] === before[1],
        "「一問一答」で出たら記録か控えが動いた（答えていない1問を記録した？）");
      assert(byQuit[0] === byHeader[0] && byQuit[1] === byHeader[1],
        "「やめる」と「一問一答」で、出たあとの記録・控えが食い違う");
    });

    t("ヘッダー: マスから始めた回は「やめる」がマップ・「一問一答」が単元一覧（来た道とはじめを分ける）", function () {
      d.getElementById("btn-map").click();
      if (!d.getElementById("btn-map-flip")) mapCells()[0].click();
      d.getElementById("btn-map-flip").click();
      d.getElementById("btn-quit").click();
      assert(!d.getElementById("view-map").classList.contains("hidden"), "マスから始めた回の「やめる」がマップへ戻らない");
      d.getElementById("btn-map-flip").click();
      pressHeaderHome();
      assertLandedHome("マスから始めた暗記");
      d.getElementById("btn-map").click();
      var sel = d.querySelector(".gc.is-sel"); if (sel) sel.click();
      d.getElementById("btn-map-back").click();
    });

    t("結果: マスから始めた回の戻るボタンは「マップにもどる」と書く（押した先と札を合わせる）", function () {
      var W = frame.contentWindow;
      var saved = NAV_KEY ? W.localStorage.getItem(NAV_KEY) : null;
      try {
        d.getElementById("btn-map").click();
        var one = mapCells().filter(function (c) { return Number(c.querySelector(".gc-n").textContent) === 1; })[0] ||
          mapCells()[0];
        if (!one.classList.contains("is-sel")) one.click();
        d.getElementById("btn-map-flip").click();
        flipThrough();
        var b = d.getElementById("btn-home");
        assert(b.textContent.indexOf("マップ") >= 0, "札が「" + b.textContent + "」のまま");
        b.click();
        assert(!d.getElementById("view-map").classList.contains("hidden"), "押してもマップに戻らない");
        d.querySelector(".gc.is-sel").click();
        d.getElementById("btn-map-back").click();
      } finally {
        if (NAV_KEY) { if (saved === null) W.localStorage.removeItem(NAV_KEY); else W.localStorage.setItem(NAV_KEY, saved); }
      }
    });

    t("報告: 版が固定値でなく、ヘッダー表示の版を拾う", function () {
      var ctx = frame.contentWindow.__reportContext();
      assert(ctx && ctx.version, "報告の文脈に version がない");
      assert(ctx.version !== "v1" || d.querySelector(".version").textContent.trim() === "v1",
        "版が 'v1' に固定されている（どの版への報告か判別できない）");
      assert(ctx.version === d.querySelector(".version").textContent.trim(),
        "報告の版 " + ctx.version + " がヘッダー表示と食い違う");
    });

    // ---- 来た道（アプリ横断の戻り道・v44） ----
    // assembler の帯は `../qa/?code=<コード>&from=assembler` を指している。
    // **`?code=` を受けるのはこちらの仕事**なので、ここを外したり綴りを変えたりすると
    // 相手の戻り道が黙って死ぬ。相手の test.html は輪が閉じるかを見ているが、
    // **壊す手が動くのはこちら**なので、こちらの緑でも鳴るようにしておく。
    //
    // 別の iframe を立てる（`#app` は素の起動を検査する側なので、URL を汚さない）
    var ta = function (name, fn) {
      return fn().then(function () { results.push({ name: name, ok: true }); },
        function (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); });
    };
    function openWith(query) {
      return new Promise(function (res, rej) {
        var f = doc.createElement("iframe");
        f.style.cssText = "position:absolute; left:-9999px; width:960px; height:640px;";
        f.src = "index.html?nocache=" + Date.now() + query;
        doc.body.appendChild(f);
        var tries = 0;
        (function poll() {
          var w = f.contentWindow, dd = f.contentDocument;
          if (w && w.QaEngine && w.QaEngine.backFrom && dd && dd.getElementById("unit-list")) {
            // 着地（landOnCode）は questions.json の読み込み後なので、1拍待つ
            return setTimeout(function () { res({ W: w, D: dd, kill: function () { f.remove(); } }); }, 60);
          }
          if (++tries > 150) { f.remove(); return rej(new Error("qa が起動しない")); }
          setTimeout(poll, 100);
        })();
      });
    }

    var sample = DATA.patterns.filter(function (p) { return p.link && p.link.kind !== "none"; })[0];

    return ta("来た道: ?code= で来ると、その項目そのものに着地する（戻り道の着地点）", function () {
      return openWith("&code=" + encodeURIComponent(sample.code) + "&from=assembler").then(function (a) {
        try {
          assert(!a.D.getElementById("view-study").classList.contains("hidden"),
            "?code=" + sample.code + " で演習画面に着地しない（相手の戻り道が単元一覧に落ちる）");
          var bf = a.W.QaEngine.backFrom();
          assert(bf && bf.code === sample.code && bf.found,
            "着地した項目が違う（" + (bf && bf.code) + " ≠ " + sample.code + "）");
          assert(a.D.getElementById("q-of").textContent.replace(/\s/g, "") === "1/1",
            "1項目だけの回になっていない（" + a.D.getElementById("q-of").textContent + "）");
          var bb = a.D.getElementById("back-band");
          assert(bb && !bb.classList.contains("hidden"), "来た道の帯が出ない（片道になっている）");
          assert(bb.textContent.indexOf("パズルでみる有機化学") >= 0,
            "帯が相手の名前を言っていない（" + bb.textContent.trim() + "）");
          // 送り出しの口も同じ画面から生きている ＝ 往復が閉じる
          a.D.getElementById("btn-reveal").click();
          var link = a.D.querySelector(".a-link");
          assert(link && link.getAttribute("href").indexOf("from=qa") > 0,
            "戻ってきた項目から相手へ行き直せない（?from=qa が無い）");
        } finally { a.kill(); }
      });
    }).then(function () {
      return ta("来た道: 知らない ?code= は黙って白紙にせず、帯が理由を言う", function () {
        return openWith("&code=org.no.such.item&from=assembler").then(function (a) {
          try {
            assert(!a.D.getElementById("view-home").classList.contains("hidden"),
              "見つからないのに単元一覧を出していない（どこにも居ない状態になる）");
            var bb = a.D.getElementById("back-band");
            assert(bb && !bb.classList.contains("hidden"), "見つからないときこそ帯が要る");
            assert(bb.textContent.indexOf("org.no.such.item") >= 0,
              "帯がどのコードを引けなかったのか言っていない（" + bb.textContent.trim() + "）");
            assert(a.D.querySelector("#back-band .bb-miss"), "見つからなかった見た目になっていない");
          } finally { a.kill(); }
        });
      });
    }).then(function () {
      // ---- 往復で演習の続きが残る（ユーザー申し立て 2026-08-28）----
      // ⚠ 申し立て:「qa → assembler に飛ぶ → qa に戻る とその問題のみ表示、
      // 答えを見たら終了（遷移前の状態が保存されていない）」。実測でも 2/10 → 1/1 だった。
      //
      // 上の「?code= で来ると1項目だけの回」は**控えが無いとき**の姿で、そこは変えていない。
      // ここで見るのは**控えがあるときに続きへ返るか**。両方を並べて置くことで、
      // 片方を直したつもりでもう片方を壊したら鳴る。
      var RESUME_KEY = "qa.resume.v1";
      function clearResume() { try { sessionStorage.removeItem(RESUME_KEY); } catch (e) {} }

      // 演習を1つ始めて、飛び道具のある問題まで進み、そのリンクを押す（遷移はさせない）。
      // ⚠ **進めるのに ○ を押すので localStorage の学習記録が動く**。テストが人の記録を
      // 汚さないよう、前後で退避して戻す（キーは app.js の露出から取る）
      function walkToLinkAndClick(a) {
        var KEY = a.W.QaEngine.STORE_KEY;
        var saved = a.W.localStorage.getItem(KEY);
        try {
          var start = a.D.querySelector('#unit-list button[data-unit="carboxyl"][data-mode="flip"]');
          assert(start, "カルボン酸・エステルの単元カードに暗記モードのボタンが無い");
          start.click();
          var link = null, seen = 0;
          for (var i = 0; i < 40 && !link; i++) {
            var rev = a.D.getElementById("btn-reveal");
            if (!rev) break;                       // 回が尽きた（結果画面）
            rev.click();
            link = a.D.querySelector("#card-host a.a-link");
            if (link) break;
            seen++;
            var good = a.D.getElementById("btn-good-q");
            if (!good) break;
            good.click();
          }
          assert(link, "カルボン酸・エステルの回に飛び道具のある問題が1つも出なかった（回が短すぎる）");
          var qof = a.D.getElementById("q-of").textContent.replace(/\s/g, "");
          var qtext = a.D.querySelector(".q-text").textContent;
          var href = link.getAttribute("href");
          var code = decodeURIComponent((href.match(/[?&]code=([^&]+)/) || [])[1] || "");
          // 押した瞬間に控える口を通したいが、iframe を assembler へ飛ばしたくないので
          // 既定の遷移だけ止める。app.js の控えは capture で先に走るので影響しない
          a.D.addEventListener("click", function (e) { e.preventDefault(); }, true);
          link.click();
          return { qof: qof, qtext: qtext, code: code, walked: seen };
        } finally {
          if (saved === null) a.W.localStorage.removeItem(KEY);
          else a.W.localStorage.setItem(KEY, saved);
        }
      }

      var trip = null;
      return ta("QW6: 往復して戻ると演習の続きに返る（1問に潰れない）", function () {
        clearResume();
        return openWith("").then(function (a) {
          try { trip = walkToLinkAndClick(a); } finally { a.kill(); }
          var raw = sessionStorage.getItem(RESUME_KEY);
          assert(raw, "飛び道具を押しても控えが残っていない（出て行くときに何も控えていない）");
          var snap = JSON.parse(raw);
          assert(snap.code === trip.code,
            "控えている項目が押したリンクと違う（" + snap.code + " ≠ " + trip.code + "）");
          assert(snap.queue.length > 1,
            "控えの回が1問しかない（続きが残らないので往復の意味がない）");
          // 戻ってくる
          return openWith("&code=" + encodeURIComponent(trip.code) + "&from=assembler").then(function (b) {
            try {
              assert(!b.D.getElementById("view-study").classList.contains("hidden"),
                "戻ってきて演習画面に着地しない");
              var qof = b.D.getElementById("q-of").textContent.replace(/\s/g, "");
              assert(qof === trip.qof,
                "戻ったら回の位置が変わった（出るとき " + trip.qof + " → 戻って " + qof +
                "）＝ 遷移前の状態が保存されていない");
              assert(b.D.querySelector(".q-text").textContent === trip.qtext,
                "戻ってきた問題が違う");
              var bb = b.D.getElementById("back-band");
              assert(bb.textContent.indexOf("続きから") >= 0,
                "帯が続きへ返したことを言っていない（" + bb.textContent.trim() + "）");
              // めくりは**こたえを開いた状態でしか飛び道具が出ない**ので、開いて返す
              assert(b.D.querySelector("#card-host .answer"),
                "こたえを閉じた状態で返している（押した飛び道具がもう画面に無い）");
            } finally { b.kill(); clearResume(); }
          });
        });
      }).then(function () {
        return ta("QW7: 控えが無い／別の項目の控えなら、従来どおり1問だけの回に落ちる", function () {
          clearResume();
          var other = DATA.patterns.filter(function (p) { return p.code !== trip.code; })[0];
          // まず控えが無い状態
          return openWith("&code=" + encodeURIComponent(trip.code) + "&from=assembler").then(function (a) {
            try {
              assert(a.D.getElementById("q-of").textContent.replace(/\s/g, "") === "1/1",
                "控えが無いのに続きを名乗っている（どこから来た続きか説明できない）");
              assert(a.D.getElementById("back-band").textContent.indexOf("続きから") < 0,
                "控えが無いのに帯が「続きから」と言っている");
            } finally { a.kill(); }
          }).then(function () {
            // 次に**別の項目の**控えがある状態（噛み合わない控えを使い回さない）
            sessionStorage.setItem(RESUME_KEY, JSON.stringify({
              code: other.code, unitId: other.unit, mode: "flip", scope: "daily", lv: null,
              idx: 0, right: 0, wrong: 0, queue: [[other.code, 0], [other.code, 0]], revealed: false
            }));
            return openWith("&code=" + encodeURIComponent(trip.code) + "&from=assembler").then(function (a) {
              try {
                assert(a.D.getElementById("q-of").textContent.replace(/\s/g, "") === "1/1",
                  "別の項目の控えで復元してしまった（押したのと違う問題の続きが出る）");
              } finally { a.kill(); clearResume(); }
            });
          });
        });
      }).then(function () {
        return ta("QW8: 項目が消えた古い控えは捨てて、1問だけの回に落ちる", function () {
          // ⚠ 控えはコードで持っているので、**データを直した後に古い控えが残りうる**。
          // 引き当てられないものが1つでもあれば復元しない（別の問題を出すほうが害が大きい）
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({
            code: trip.code, unitId: "carboxyl", mode: "flip", scope: "daily", lv: null,
            idx: 0, right: 0, wrong: 0,
            queue: [[trip.code, 0], ["org.gone.removed-item", 0]], revealed: false
          }));
          return openWith("&code=" + encodeURIComponent(trip.code) + "&from=assembler").then(function (a) {
            try {
              assert(a.D.getElementById("q-of").textContent.replace(/\s/g, "") === "1/1",
                "消えた項目を含む控えで復元してしまった（引き当てられない問題が回に混ざる）");
            } finally { a.kill(); clearResume(); }
          });
        });
      }).then(function () {
        return ta("QW8b: 単元の割り直し（v145）より前の控えでも「もう一度」が0問の回にならない", function () {
          // ⚠ v145 で carbonyl・aroN・bio・clue の id が消えた。割り直しの前に控えた続きは
          //   消えた id を持っていて、そのまま戻すと「もう一度」が startSession('carbonyl') ＝ 0問になる。
          //   いま居る項目の単元に読み替えていることを、実際に「もう一度」を押して確かめる
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({
            code: trip.code, unitId: "carbonyl", mode: "flip", scope: "all", lv: null,
            idx: 0, right: 0, wrong: 0, queue: [[trip.code, 0]], revealed: true
          }));
          return openWith("&code=" + encodeURIComponent(trip.code) + "&from=assembler").then(function (a) {
            var KEY = a.W.QaEngine.STORE_KEY;
            var saved = a.W.localStorage.getItem(KEY);
            try {
              assert(a.D.getElementById("back-band").textContent.indexOf("続きから") >= 0,
                "控えから戻していない（検査の前提が崩れている）");
              a.D.getElementById("btn-good-q").click();
              assert(!a.D.getElementById("view-result").classList.contains("hidden"), "結果画面に進まない");
              a.D.getElementById("btn-again").click();
              var m = a.D.getElementById("q-of").textContent.replace(/\s/g, "").match(/^1\/(\d+)$/);
              var unit = DATA.patterns.filter(function (p) { return p.code === trip.code; })[0].unit;
              var n = DATA.patterns.filter(function (p) { return p.unit === unit; }).length;
              assert(m && +m[1] === n, "「もう一度」の回が " + a.D.getElementById("q-of").textContent +
                "（期待 1 / " + n + " ＝ " + unit + " の全項目）");
            } finally {
              if (saved === null) a.W.localStorage.removeItem(KEY); else a.W.localStorage.setItem(KEY, saved);
              a.kill(); clearResume();
            }
          });
        });
      }).then(function () {
        /* ---- 測定モードの往復（ユーザー申し立て 2026-09-09）----
         *
         * ⚠ 申し立て:「qa から assembler に飛んだ時、もどってくるともう一度問題を解くことになる」。
         * ★ **測定モードの飛び道具は「採点したあと」の画面にしか出ない**ので、
         *   採点済みが復元されないと**押した人は必ず解き直しになる**（v102 で実測・再現した）。
         *   上の QW6 はめくり（flip）だけを見ていて、**測定（choice）は素通りだった**
         *   ＝ 片側だけ直っている状態が3週間残った。両方を並べて置く。
         *
         * ⚠ 解き直しは手間だけの問題ではない。2回目にうっかり外すと markResult が
         *   box を 1 に落とすので、**習得マップの緑が点いたり消えたりする**
         *   （同時に出たもう1件の申し立て「正解しても緑になるときとそうでないときがある」）。
         */
        // いま出ている問題の pattern / variant を引く。**コードは __reportContext から取る**
        // （問題文で引くと、同じ文面の variant を持つ別項目に当たりうる）
        function curChoice(a) {
          var code = String(a.W.__reportContext().locus).split("（")[0].trim();
          var p = DATA.patterns.filter(function (x) { return x.code === code; })[0];
          if (!p) return null;
          var qt = a.D.querySelector(".q-text").textContent;
          var v = (p.variants || []).filter(function (x) { return x.q === qt; })[0];
          return v ? { p: p, v: v } : null;
        }
        function gradeCorrect(a) {
          var f = curChoice(a);
          assert(f, "いまの測定モードの問題を引き当てられない");
          Array.prototype.forEach.call(a.D.querySelectorAll("#opts input[type=checkbox]"), function (b) {
            if (f.v.correct.indexOf(+b.value) >= 0 && !b.checked) b.click();
          });
          a.D.getElementById("btn-grade").click();
          return f;
        }
        // 測定モードの回を始め、飛び道具のある問題まで進んで**採点し**、そのリンクを押す
        function walkChoiceToLinkAndClick(a) {
          var KEY = a.W.QaEngine.STORE_KEY;
          var saved = a.W.localStorage.getItem(KEY);
          try {
            var start = a.D.querySelector('#unit-list button[data-unit="carboxyl"][data-mode="choice"]');
            assert(start, "カルボン酸・エステルの単元カードに測定モードのボタンが無い");
            start.click();
            var f = null;
            for (var i = 0; i < 12; i++) {
              f = curChoice(a);
              if (f && f.p.link && f.p.link.kind !== "none") break;
              gradeCorrect(a);
              var nx = a.D.getElementById("btn-next");
              if (!nx) { f = null; break; }
              nx.click();
            }
            assert(f && f.p.link && f.p.link.kind !== "none",
              "測定モードの回に飛び道具のある問題が1つも出なかった（回が短すぎる）");
            var qof = a.D.getElementById("q-of").textContent.replace(/\s/g, "");
            gradeCorrect(a);
            var link = a.D.querySelector("#choice-foot a.a-link");
            assert(link, "測定モードで採点しても飛び道具が出ない（テストの前提が崩れている）");
            var order = Array.prototype.map.call(a.D.querySelectorAll("#opts .opt"),
              function (l) { return +l.getAttribute("data-i"); });
            var chosenText = Array.prototype.map.call(a.D.querySelectorAll("#opts input:checked"),
              function (b) { return b.parentNode.textContent.trim(); });
            a.D.addEventListener("click", function (e) { e.preventDefault(); }, true);
            link.click();
            return { code: f.p.code, qof: qof, order: order, chosenText: chosenText };
          } finally {
            // ⚠ 進めるのに採点するので学習記録が動く。人の記録を汚さないよう戻す
            if (saved === null) a.W.localStorage.removeItem(KEY);
            else a.W.localStorage.setItem(KEY, saved);
          }
        }

        var ctrip = null;
        return ta("QW9: 測定モードで採点したあと往復すると、採点済みの画面に戻る", function () {
          clearResume();
          return openWith("").then(function (a) {
            try { ctrip = walkChoiceToLinkAndClick(a); } finally { a.kill(); }
            var snap = JSON.parse(sessionStorage.getItem(RESUME_KEY) || "null");
            assert(snap, "測定モードで飛び道具を押しても控えが残っていない");
            assert(snap.graded === true,
              "控えが「採点済み」を持っていない（開いたか閉じたかしか控えていない）");
            assert(snap.chosen && snap.chosen.length,
              "控えが「何を選んだか」を持っていない（戻ると選択が消える）");
            assert(snap.order && snap.order.length,
              "控えが「選択肢の並び」を持っていない（混ぜ直されて自分の答えが動く）");
            return openWith("&code=" + encodeURIComponent(ctrip.code) + "&from=assembler").then(function (b) {
              try {
                var qof = b.D.getElementById("q-of").textContent.replace(/\s/g, "");
                assert(qof === ctrip.qof,
                  "戻ったら回の位置が変わった（出るとき " + ctrip.qof + " → 戻って " + qof + "）");
                assert(b.D.querySelectorAll("#opts .opt.locked").length,
                  "採点済みが復元されていない ＝ もう一度解かされる（申し立ての症状そのもの）");
                assert(b.D.getElementById("btn-next"),
                  "「つぎへ」が無い（採点後の画面に戻っていない）");
                assert(!b.D.getElementById("btn-grade"),
                  "「採点する」がまだ出ている（未回答の画面に戻している）");
                assert(b.D.querySelector("#choice-foot a.a-link"),
                  "押した飛び道具がもう画面に無い（往復の入口が消える）");
              } finally { b.kill(); clearResume(); }
            });
          });
        }).then(function () {
          return ta("QW9b: 復元しても「自分が選んだもの」が同じ選択肢を指す（並びごと控える）", function () {
            /* ★ 選択肢は毎回 shuffle される。**添字だけ控えると、混ぜ直された並びの
             *   同じ位置＝別の選択肢**を選んだことにされる。
             * ⚠ 実物の往復では並びがたまたま一致してしまうことがあるので、
             *   ここは**わざと逆順の並び**を控えに入れて、混ぜ直しでは再現しない形にする。 */
            var p = DATA.patterns.filter(function (x) {
              return (x.variants || []).some(function (v) {
                return v.mode === "choice" && v.options && v.options.length >= 4 && v.correct.length;
              });
            })[0];
            assert(p, "選択肢4つ以上の測定モードの項目が無い（テストの前提が崩れている）");
            var v = p.variants.filter(function (x) { return x.mode === "choice"; })[0];
            var vi = p.variants.indexOf(v);
            var order = v.options.map(function (_o, i) { return i; }).reverse();
            var chosen = [v.correct[0]];
            var other = DATA.patterns.filter(function (x) { return x.code !== p.code; })[0];
            sessionStorage.setItem(RESUME_KEY, JSON.stringify({
              code: p.code, unitId: p.unit, mode: "choice", scope: "daily", lv: null,
              idx: 0, right: 0, wrong: 0,
              queue: [[p.code, vi], [other.code, 0]],
              order: order, chosen: chosen, graded: true
            }));
            return openWith("&code=" + encodeURIComponent(p.code) + "&from=assembler").then(function (a) {
              try {
                var shown = Array.prototype.map.call(a.D.querySelectorAll("#opts .opt"),
                  function (l) { return +l.getAttribute("data-i"); });
                assert(shown.join(",") === order.join(","),
                  "控えた並びで出ていない（" + shown.join(",") + " ≠ " + order.join(",") +
                  "）＝ 戻ってきた画面が出て行ったときと違う並びになる");
                var checked = Array.prototype.map.call(a.D.querySelectorAll("#opts input:checked"),
                  function (b) { return b.parentNode.textContent.trim(); });
                assert(checked.length === chosen.length,
                  "選んだ数が違う（" + checked.length + " ≠ " + chosen.length + "）");
                assert(checked[0] === v.options[chosen[0]].trim(),
                  "復元した選択が別の選択肢を指している（「" + checked[0] + "」≠「" +
                  v.options[chosen[0]] + "」）＝ 自分の答えが勝手に書き換わる");
                assert(a.D.querySelectorAll("#opts .opt.locked").length,
                  "採点済みが復元されていない");
              } finally { a.kill(); clearResume(); }
            });
          });
        }).then(function () {
          return ta("QW9c: 並びが噛み合わない古い控えは黙って混ぜ直す（白紙にしない）", function () {
            // ⚠ 否定対照。選択肢を増減させた後に古い控えが残っても、
            //   控えた並びを無理に使って**無い選択肢**を指したり落ちたりしてはいけない
            var p = DATA.patterns.filter(function (x) {
              return (x.variants || []).some(function (v) { return v.mode === "choice" && v.options; });
            })[0];
            var v = p.variants.filter(function (x) { return x.mode === "choice"; })[0];
            var other = DATA.patterns.filter(function (x) { return x.code !== p.code; })[0];
            sessionStorage.setItem(RESUME_KEY, JSON.stringify({
              code: p.code, unitId: p.unit, mode: "choice", scope: "daily", lv: null,
              idx: 0, right: 0, wrong: 0,
              queue: [[p.code, p.variants.indexOf(v)], [other.code, 0]],
              order: [0, 0, 99], chosen: [999], graded: true      // 壊れた控え
            }));
            return openWith("&code=" + encodeURIComponent(p.code) + "&from=assembler").then(function (a) {
              try {
                var shown = Array.prototype.map.call(a.D.querySelectorAll("#opts .opt"),
                  function (l) { return +l.getAttribute("data-i"); });
                assert(shown.length === v.options.length,
                  "壊れた控えで選択肢の数が変わった（" + shown.length + " ≠ " + v.options.length + "）");
                assert(shown.slice().sort(function (x, y) { return x - y; }).join(",") ===
                  v.options.map(function (_o, i) { return i; }).join(","),
                  "壊れた控えを使ってしまい、選択肢が重複／欠落した（" + shown.join(",") + "）");
                assert(!a.D.querySelectorAll("#opts input:checked").length,
                  "無い選択肢を選んだことにしている");
              } finally { a.kill(); clearResume(); }
            });
          });
        }).then(function () {
          return ta("QW10: 往復を2回しても、その項目の記録は1回しか動かない", function () {
            /* ★★ **記録の数を数える。**
             *
             * ⚠ `markResult` は正解で box を1つ上げ、**誤答で box を 1 に落とす**。
             *   同じ解答が2回数えられると box が上下し、**習得マップの緑が点いたり消えたりする**
             *   （ユーザー申し立て「正解しても緑になるときとそうでないときがある」）。
             *
             * ★ **戻る道は1つではない。** QW9 の復元で解き直しは無くなるが、
             *   ブラウザの戻る・帯のリンクをもう一度押す・タブの復元では
             *   **同じ控えがもう一度使われる**。v103 で実測すると
             *   seen 1→2・box 1→2・cRight 1→2 と、1回の解答が2回数えられた。
             *   だから復元だけに頼らず、記録そのものを冪等にしてある。 */
            clearResume();
            var KEY = null, saved = null, code = null;
            function recOf(a, c) {
              var pr = {};
              try { pr = JSON.parse(a.W.localStorage.getItem(KEY)) || {}; } catch (e) {}
              return pr[c] || { seen: 0, box: 0, cRight: 0, right: 0, wrong: 0 };
            }
            return openWith("").then(function (a) {
              KEY = a.W.QaEngine.STORE_KEY;
              saved = a.W.localStorage.getItem(KEY);
              try { code = walkChoiceToLinkAndClick(a).code; } finally { a.kill(); }
              // 1回目の帰還 —— 復元された採点済みから「つぎへ」＝ ここで1回だけ記録される
              return openWith("&code=" + encodeURIComponent(code) + "&from=assembler").then(function (b) {
                var before, n1;
                try {
                  before = recOf(b, code);
                  var nx = b.D.getElementById("btn-next");
                  assert(nx, "採点済みが復元されていない（QW9 と同じ症状）");
                  nx.click();
                  n1 = recOf(b, code);
                } finally { b.kill(); }
                assert(n1.seen === before.seen + 1,
                  "1回目の帰還で記録が1回ぶん増えていない（seen " + before.seen + " → " + n1.seen + "）");
                var snap = JSON.parse(sessionStorage.getItem(RESUME_KEY) || "null");
                assert(snap && snap.marked && snap.marked.indexOf(code) >= 0,
                  "控えが「もう記録した」を覚えていない ＝ 次に戻ったときにまた数える");
                // 2回目の帰還（ブラウザの戻る等で同じ控えがもう一度使われる）＝ 増えてはいけない
                return openWith("&code=" + encodeURIComponent(code) + "&from=assembler").then(function (c) {
                  var n2;
                  try {
                    var nx2 = c.D.getElementById("btn-next");
                    assert(nx2, "2回目の帰還で採点済みが復元されていない");
                    nx2.click();
                    n2 = recOf(c, code);
                  } finally { c.kill(); }
                  assert(n2.seen === n1.seen && n2.box === n1.box && n2.cRight === n1.cRight,
                    "往復をもう一度したら記録がまた動いた（seen " + n1.seen + "→" + n2.seen +
                    " / box " + n1.box + "→" + n2.box + " / cRight " + n1.cRight + "→" + n2.cRight +
                    "）＝ 1回の解答が2回数えられ、定着の緑が点いたり消えたりする");
                });
              });
            }).then(function (r) {
              if (saved === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, saved);
              clearResume();
              return r;
            }, function (e) {
              if (KEY) { if (saved === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, saved); }
              clearResume();
              throw e;
            });
          });
        });
      });
    }).then(function () {
      // ⚠ **確度は答えより先に目に入る位置に無いと意味がない**（2026-08-12）。
      // 「たぶん」の項目を、他の300項目と同じ顔で読ませてしまうのが避けたい事故。
      // データ側の検査（runDataTests）は印が付いているかまでしか見ないので、
      // **実際に画面へ出ているか**はここで見る
      var clue = DATA.patterns.filter(function (p) { return p.certainty === "たぶん"; })[0];
      return ta("確度: 構造決定（structure）単元はこたえより先に確度の印が出る", function () {
        return openWith("&code=" + encodeURIComponent(clue.code)).then(function (a) {
          try {
            a.D.getElementById("btn-reveal").click();
            var badge = a.D.querySelector(".a-certainty");
            assert(badge, clue.code + ": 確度の印が出ていない");
            assert(badge.textContent.indexOf(clue.certainty) >= 0,
              "印が確度を言っていない（" + badge.textContent.trim() + "）");
            assert(badge.textContent.length > clue.certainty.length + 4,
              "確度の語だけで、意味の説明が付いていない");
            // 位置: こたえの本文より前にある
            var ans = a.D.querySelector(".a-text");
            assert(ans && (badge.compareDocumentPosition(ans) & 4),
              "確度の印がこたえより後ろにある（読む順が逆）");
            // 他の単元には出ない
            var other = DATA.patterns.filter(function (p) { return !p.certainty; })[0];
            assert(other, "確度の無い項目が1つも無い（テストの前提が崩れている）");
          } finally { a.kill(); }
        });
      });
    }).then(function () {
      // ⚠ **分子を見る行き先には、URL に分子が載っていないと意味がない**（2026-08-21）。
      //
      // データ側（runDataTests）は `link.summon` があるかまでしか見ない。
      // URL を組み立てているのは **app.js の `linkQuery()`** なので、そこで
      // `case 'practice'` から summon を落とすと**データは正しいまま入口だけが死ぬ**。
      // 実測した症状: `?open=stereo` だけで着くと assembler はキャンバスが空のまま
      // 立体ビューを開こうとし、「sp3炭素がありません」のトーストが数秒出て終わる。
      // モーダルは開かず、相手側の miss 帯も（分子を頼んでいないので）出ない
      // ＝ **向こうの見張りが届かない**。だから壊す手が動くこちらで鳴らす。
      var molOpen = DATA.patterns.filter(function (p) {
        return p.link && p.link.kind === "practice" && (p.link.open === "stereo" || p.link.open === "isomer");
      });
      return ta("飛び道具: 分子を見る練習（open=stereo）のリンクに ?summon= が載っている", function () {
        assert(molOpen.length, "open=stereo の項目が1つも無い（テストの前提が崩れている）");
        return openWith("&code=" + encodeURIComponent(molOpen[0].code)).then(function (a) {
          try {
            a.D.getElementById("btn-reveal").click();
            var link = a.D.querySelector(".a-link");
            assert(link, molOpen[0].code + ": 飛び道具のリンクが出ていない");
            var href = link.getAttribute("href");
            assert(href.indexOf("open=stereo") > 0 || href.indexOf("open=isomer") > 0,
              "行き先が URL に載っていない（" + href + "）");
            assert(/[?&]summon=[^&]+/.test(href),
              molOpen[0].code + ": URL に ?summon= が無い（" + href + "）。" +
              "キャンバスが空のまま立体ビューを開くことになり、トーストだけで終わる");
          } finally { a.kill(); }
        });
      });
    }).then(function () {
      /* ⚠ **📖 資料へのリンクは「行き先」と「code」の2つだけで成り立つ**（2026-09-04）。
       *
       * データ側（棚卸し）は kind と label しか見ない。URL を組み立てるのは
       * **app.js の `linkQuery()` / `linkHtml()`** なので、`case 'reference'` を落とすと
       * `?open=` が付かず、**押しても assembler がふつうに起動するだけ**になる
       * ＝ 死んだ入口を配る。しかも画面はちゃんと開くので誰も気づけない
       * （`?panel=` とまったく同じ壊れ方。CF3 の理由書きと同じ）。
       * ★ `?code=` が落ちた場合も同じで、**既定のページ（1枚目）が開く**ので気づけない。
       * ⚠ さらに **ページ id を URL に載せていないこと**まで見る ——
       *   載せた瞬間、着地先を決める場所が qa と assembler の2か所になる。 */
      var refs = DATA.patterns.filter(function (p) { return p.link && p.link.kind === "reference"; });
      return ta("飛び道具: 📖 資料のリンクが ?open=reference と ?code= だけを載せている", function () {
        assert(refs.length, "kind=reference の項目が1つも無い（テストの前提が崩れている）");
        return openWith("&code=" + encodeURIComponent(refs[0].code)).then(function (a) {
          try {
            a.D.getElementById("btn-reveal").click();
            var link = a.D.querySelector(".a-link");
            assert(link, refs[0].code + ": 飛び道具のリンクが出ていない");
            var href = link.getAttribute("href");
            assert(href.indexOf("open=reference") > 0,
              refs[0].code + ": URL に ?open=reference が無い（" + href + "）。" +
              "押しても assembler がふつうに起動するだけになり、画面は開くので気づけない");
            assert(href.indexOf("code=" + encodeURIComponent(refs[0].code)) > 0,
              refs[0].code + ": URL に ?code= が無い（" + href + "）。" +
              "どのページに着くかを決めているのは code なので、落ちると既定のページが開く");
            assert(!/[?&](page|refpage)=/.test(href),
              refs[0].code + ": URL にページ id を載せている（" + href + "）。" +
              "着地先を決める場所は assembler の reference.json の codes だけにする");
          } finally { a.kill(); }
        });
      });
    }).then(function () {
      /* ---- 範囲を指定して解く（`?codes=` ・v100） ----
       *
       * ★ 参考書の面A（`/reference/`）が **1ページぶんの知識コードをまとめて**送ってくる受け口。
       *   設計は `DESIGN_reference_book.md` §17-4。ユーザー決定
       *   「**一問一答は実際に試せる（解ける）形で埋める**」。
       *
       * ⚠⚠ **壊す手が動くのはこちら**（app.js）なので、こちらの緑で鳴るようにしておく ——
       *   相手（参考書）は焼いた静的ページなので、受け口を外しても相手側は無傷に見える。
       * ⚠ 見るのは4つ: ①まとめて解ける ②測定モードで来る ③知らないコードは黙って落とす
       *   ④1件も引けなければ白紙にせず帯が理由を言う。 */
      var many = DATA.patterns.slice(0, 3).map(function (p) { return p.code; });
      return ta("範囲: ?codes= で来ると、その項目だけの回になる（参考書の埋め込み）", function () {
        return openWith("&codes=" + many.map(encodeURIComponent).join(",") + "&from=reference").then(function (a) {
          try {
            assert(!a.D.getElementById("view-study").classList.contains("hidden"),
              "?codes= で演習画面に着地しない（参考書の埋め込みが単元一覧に落ちる）");
            assert(a.D.getElementById("q-of").textContent.replace(/\s/g, "") === "1/" + many.length,
              many.length + " 項目の回になっていない（" + a.D.getElementById("q-of").textContent + "）");
            var bf = a.W.QaEngine.backFrom();
            assert(bf && bf.codes && bf.codes.length === many.length && bf.picked === many.length,
              "受け取った件数が合わない（" + (bf && bf.picked) + " / " + many.length + "）");
            // ★ 既定は**測定モード**（解ける形。めくりは自己申告なので「解く」にあたらない）
            assert(bf.mode === "choice", "既定が測定モードでない（" + bf.mode + "）");
            assert(a.D.querySelector("#card-host #opts .opt") && a.D.getElementById("btn-grade"),
              "複数選択の選択肢と採点ボタンが出ていない＝その場で解ける形になっていない");
            var bb = a.D.getElementById("back-band");
            assert(bb && !bb.classList.contains("hidden"), "来た道の帯が出ない（片道になっている）");
            assert(bb.textContent.indexOf("参考書から来ました") >= 0,
              "帯が「参考書から来ました」と言っていない（" + bb.textContent.trim() + "）。" +
              "⚠ 「戻りました」はこちらが送り出した相手（assembler / ion）だけの言い方");
            // 往復（CLAUDE.md）。⚠ 埋め込まれているので `_top` でタブごと戻す
            var back = a.D.querySelector("#back-band .bb-back");
            assert(back && back.getAttribute("href") === "../reference/",
              "参考書への戻り道が無い（片道になっている）");
            assert(back.getAttribute("target") === "_top",
              "戻り道が _top でない（iframe の中だけが参考書に変わって、参考書の中に参考書が入る）");
          } finally { a.kill(); }
        });
      });
    }).then(function () {
      var mixed = DATA.patterns[0].code + ",org.no.such.item";
      return ta("範囲: 知らないコードは黙って落とし、引けたぶんで解ける", function () {
        return openWith("&codes=" + encodeURIComponent(DATA.patterns[0].code) + ",org.no.such.item&from=reference")
          .then(function (a) {
            try {
              assert(!a.D.getElementById("view-study").classList.contains("hidden"),
                "1件でも引ければ解ける回になるはず（" + mixed + "）");
              assert(a.D.getElementById("q-of").textContent.replace(/\s/g, "") === "1/1",
                "引けた1件だけの回になっていない（" + a.D.getElementById("q-of").textContent + "）");
              var bb = a.D.getElementById("back-band");
              assert(/1\s*\/\s*2/.test(bb.textContent),
                "帯が「2件のうち1件」を言っていない（" + bb.textContent.trim() + "）");
            } finally { a.kill(); }
          });
      });
    }).then(function () {
      return ta("範囲: 1件も引けなければ白紙にせず、帯が理由を言う", function () {
        return openWith("&codes=org.no.such.item,org.no.such.other&from=reference").then(function (a) {
          try {
            assert(!a.D.getElementById("view-home").classList.contains("hidden"),
              "1件も引けないのに単元一覧を出していない（どこにも居ない状態になる）");
            assert(a.D.querySelector("#back-band .bb-miss"), "見つからなかった見た目になっていない");
          } finally { a.kill(); }
        });
      });
    }).then(function () {
      // ★ 別のアプリから着地した回（1項目のめくり・参考書の範囲）からも、ヘッダーの1手で単元一覧へ（2026-09-15）
      return ta("ヘッダー: ?code= / ?codes= で着地した回からも「一問一答」の1手で単元一覧に着く", function () {
        function one(query, where) {
          return openWith(query).then(function (a) {
            try {
              assert(!a.D.getElementById("view-study").classList.contains("hidden"), where + " で演習に着地しない（テストの前提）");
              var ev = new a.W.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
              assert(!a.D.getElementById("nav-home").dispatchEvent(ev), where + " で「一問一答」がページを開き直している");
              assert(!a.D.getElementById("view-home").classList.contains("hidden") &&
                a.D.getElementById("view-study").classList.contains("hidden"),
                where + " でヘッダーの「一問一答」を押しても単元一覧に着かない");
            } finally { a.kill(); }
          });
        }
        return one("&code=" + encodeURIComponent(sample.code) + "&from=assembler", "assembler から戻った1項目の回")
          .then(function () { return one("&codes=" + encodeURIComponent(sample.code) + "&from=reference", "参考書から来た範囲の回"); });
      });
    }).then(function () { resolve(results); });
  });
}


/**
 * 出題実績（data/exam_usage.jsonl）の検査。
 *
 * ⚠ **著作権がいちばん漏れやすい場所**。ここに入ってよいのは大学名・年・設問の印字番号・
 * 難易度・手筋の名前だけで、問題文も解答の文章も入らない（集計結果であって元データではない）。
 * 生成器は _解析/tools/build-exam-usage.js。
 */
function runUsageTests(DATA, USAGE_TEXT) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (c, m) { if (!c) throw new Error(m || "assertion failed"); };

  var lines = String(USAGE_TEXT || "").trim().split(String.fromCharCode(10)).filter(function (x) { return x.trim(); });
  var head = null, rows = [];
  lines.forEach(function (l) {
    var o = JSON.parse(l);
    if (o._readme) head = o; else rows.push(o);
  });

  t("出題実績: 先頭に出どころと母集団が書いてある", function () {
    assert(head, "_readme の行が無い");
    assert(head._problems > 0, "母集団の問題数が入っていない（数が独り歩きする）");
    assert(/問題文も解答の文章も含まない/.test(head._readme), "何を含まないかが書かれていない");
  });

  t("出題実績: コードが qa に実在する", function () {
    var codes = {};
    DATA.patterns.forEach(function (p) { codes[p.code] = 1; });
    var bad = rows.filter(function (r) { return !codes[r.code]; }).map(function (r) { return r.code; });
    assert(!bad.length, "qa に無いコードがある: " + bad.slice(0, 5).join(", "));
  });

  t("出題実績: 同じコードが2行に分かれていない", function () {
    var seen = {}, dup = [];
    rows.forEach(function (r) { if (seen[r.code]) dup.push(r.code); seen[r.code] = 1; });
    assert(!dup.length, "重複: " + dup.slice(0, 5).join(", "));
  });

  t("出題実績: count と problems の数が合う", function () {
    var bad = rows.filter(function (r) { return r.count !== (r.problems || []).length; });
    assert(!bad.length, (bad[0] || {}).code + " で count と件数が食い違う");
  });

  // ⚠ **ここが本丸**。問題文・解答の文章が混ざっていないか
  t("出題実績: 問題文・解答の文章が混ざっていない（著作権）", function () {
    // printed は書籍の索引に印字された固有名（「秋田大3問2」）なので検査から外す
    var stripped = rows.map(function (r) {
      return { code: r.code, difficulty: r.difficulty, problems: (r.problems || []).map(function (p) {
        return { university: p.university, year: p.year, difficulty: p.difficulty, via: p.via, moves: p.moves };
      }) };
    });
    var raw = JSON.stringify(stripped);
    var m = raw.match(/[「」『』]|問\s*\d|下線部|答えよ|求めよ|書け|次の(文|図|表)/);
    assert(!m, "問題文らしき文字列「" + (m && m[0]) + "」が混ざっている");
  });

  t("出題実績: via は 手筋 か 題材 のどちらか", function () {
    var bad = [];
    rows.forEach(function (r) {
      (r.problems || []).forEach(function (p) {
        (p.via || []).forEach(function (v) { if (v !== "手筋" && v !== "題材") bad.push(r.code + ":" + v); });
      });
    });
    assert(!bad.length, "知らない via: " + bad.slice(0, 3).join(", "));
  });

  /* ★ 2026-09-23 無機・理論（385項目）を収録したので、母数を**有機だけ**にした。
   *   入試の出題実績は**有機の入試問題の分析から作っている**（無機・理論の入試の索引はまだ無い ＝ I-0016）。
   *   無機・理論を母数に入れると、生成器が正しく動いていても半分を割る（実測 276 / 704）。
   *   ⚠ 狙い（生成器が黙って空振りしていないか）は変えていない ——有機の中で半分を割れば今までどおり鳴る。
   *   ⏭ 無機・理論の索引ができたら、母数を全項目に戻す（I-0016） */
  t("出題実績: 実績のある項目が有機の qa の半分以上ある（生成が空振りしていない）", function () {
    var org = DATA.patterns.filter(function (p) { return p.code.indexOf("org.") === 0; }).length;
    var orgRows = rows.filter(function (r) { return String(r.code || "").indexOf("org.") === 0; }).length;
    assert(orgRows > org / 2,
      "有機で実績のある項目が " + orgRows + " / " + org + " しかない（全体 " + rows.length + " / " + DATA.patterns.length + "）");
  });

  return results;
}

// ------------------------------------------------------------------ node 実行用
/**
 * 確度の一覧（CERTAINTY_LEDGER.md）が questions.json とずれていないか。
 *
 * ⚠ **一覧は手書きにしない**（`qa/tools/gen_certainty_ledger.js` が生成する）。
 * 手書きにすると、項目を足したときに片方だけ直って
 * **「根拠つきでまとめてある」という見た目だけが残る**。それが一番あぶない状態なので、
 * 全項目が載っていること・確度が一致していることを機械で見る。
 * 読めなかった環境（file:// 直開きなど）ではスキップする。
 */
function runLedgerTests(DATA, LEDGER) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (c, m) { if (!c) throw new Error(m || "assertion failed"); };
  var text = String(LEDGER || "");
  var items = DATA.patterns.filter(function (p) { return p.certainty; });

  t("一覧: 生成物であることが本文に書いてある（手で直させない）", function () {
    assert(text, "CERTAINTY_LEDGER.md を読めていない（テストの前提が崩れている）");
    assert(text.indexOf("gen_certainty_ledger.js") >= 0, "生成器の名前が書かれていない");
    assert(text.indexOf("手で直さない") >= 0, "手で直さない、と書かれていない");
  });

  t("一覧: 確度の付いた項目が1つ残らず載っている", function () {
    var lack = items.filter(function (p) { return text.indexOf("`" + p.code + "`") < 0; })
      .map(function (p) { return p.code; });
    assert(!lack.length, "一覧に無い項目が " + lack.length + " 件: " + lack.slice(0, 4).join(" ") +
      "（node qa/tools/gen_certainty_ledger.js --write を走らせる）");
  });

  t("一覧: 項目が正しい確度の節に置かれている", function () {
    // 節の見出しで本文を割って、どの節にコードが現れるかを見る
    var parts = text.split(/^## /m).slice(1);
    var where = {};
    parts.forEach(function (block) {
      var level = block.split(/[（(\r\n]/)[0].trim();
      (block.match(/`org\.clue\.[a-z0-9-]+`/g) || []).forEach(function (c) {
        where[c.replace(/`/g, "")] = level;
      });
    });
    var bad = items.filter(function (p) { return where[p.code] !== p.certainty; })
      .map(function (p) { return p.code + "（一覧では " + where[p.code] + " / データは " + p.certainty + "）"; });
    assert(!bad.length, "確度がずれている: " + bad.slice(0, 3).join(" / "));
  });

  t("一覧: 根拠の文章がデータの basis と同じ", function () {
    // 表の区切りとぶつかるので、生成器は縦棒を `\|` に逃がしている。同じ形にしてから探す
    var bad = items.filter(function (p) { return text.indexOf(p.basis.replace(/\|/g, "\\|")) < 0; })
      .map(function (p) { return p.code; });
    assert(!bad.length, "根拠の文章がずれている: " + bad.slice(0, 3).join(" ") +
      "（生成し直す）");
  });

  return results;
}

/* ---------------------------------------------------------------- グループ台帳（2026-09-19・便0a）
 * `GROUPS.tsv` ＝ 無機・理論の「unit → group → 参考書のページ」を**問いより先に**決めた台帳
 * （参考書の設計 ref-inorg-design §1-3 の案C）。qa と参考書の両方がこの綴りに従う。
 *
 * ⚠ なぜ要るか: 無機・理論の参考書は `codes:` なしで先に書く。後で qa が項目を作るとき、
 *   group の綴りが台帳と1字でも違うと「同じグループ ＝ 同じページ」にならず、参考書に `codes:` を足せない。
 * ★ 読み方の正は `tools/reference-md.js` の parseGroups（assembler の REF28 がそちらで読む）。
 *   ここは qa の側から見る2つだけ（形と、項目の group が台帳に在るか）。
 */
function runGroupTests(DATA, TEXT) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (c, m) { if (!c) throw new Error(m || "assertion failed"); };
  var rows = [];
  String(TEXT || "").replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
    if (!line.trim() || /^\s*#/.test(line)) return;
    var c = line.split("\t");
    rows.push({ unit: c[0], unitLabel: c[1], group: c[2], page: c[3], order: c[4], course: c.length === 6 ? c[5].trim() : "", n: c.length });
  });

  // ★ 6列目 `課程`（basic ＝ 化学基礎／adv ＝ 化学）は 2026-09-19 理論の便0 で足した（ref-theory-design §1-4）。
  //   5列の行・空欄は「未設定」として通す（読み方の正は tools/reference-md.js の parseGroups と同じ）
  t("台帳: GROUPS.tsv が読めて、1行5列か6列（unit・unitLabel・group・ページid・並び・課程）", function () {
    assert(rows.length >= 44, "台帳が " + rows.length + " 行しか読めない（無機23・理論21 のはず。読めていない？）");
    var bad = rows.filter(function (r) { return r.n !== 5 && r.n !== 6; });
    assert(!bad.length, "5列か6列でない行: " + bad.slice(0, 3).map(function (r) { return r.page; }).join(" "));
    var badC = rows.filter(function (r) { return r.course && r.course !== "basic" && r.course !== "adv"; });
    assert(!badC.length, "課程が basic / adv でない行: " + badC.slice(0, 3).map(function (r) { return r.page + "（" + r.course + "）"; }).join(" "));
  });

  t("台帳: unit は inorg.* / theo.* で、1グループ＝1ページ（group もページも重ならない）", function () {
    var seenG = {}, seenP = {};
    rows.forEach(function (r) {
      assert(/^(inorg|theo)\.[a-z0-9-]+$/.test(r.unit), "unit の形が違う: " + r.unit);
      var g = r.unit + "/" + r.group;
      assert(!seenG[g], "group が2回: " + g);
      assert(!seenP[r.page], "ページが2回: " + r.page);
      seenG[g] = seenP[r.page] = true;
    });
  });

  /* ★ 別の単元のページへ移した項目（2026-09-23 便 life-draft）。**コードは学習記録の主キーなので変えない**ため、
   *   コードの頭（inorg.metal）と、いま居るグループの unit（theo.life）が食い違う。その食い違いを名簿で1件ずつ許す。
   *   ⚠ 名簿に無い項目は今までどおり「コードの頭の unit」に group が在ること（黙って何でも通す形にはしない） */
  var MOVED_UNIT = {
    "inorg.metal.alloy-def": "theo.life", "inorg.metal.alloy-examples": "theo.life",
    "inorg.metal.alloy-functional": "theo.life", "inorg.metal.alloy-mixture": "theo.life",
    "inorg.metal.stainless": "theo.life", "inorg.metal.nichrome": "theo.life",
    "inorg.metal.plating-not-alloy": "theo.life"
  };
  t("台帳: inorg.* / theo.* の項目の group は、台帳の同じ unit に在る", function () {
    var known = {};
    rows.forEach(function (r) { known[r.unit + "/" + r.group] = true; });
    var bad = DATA.patterns.filter(function (p) {
      var m = /^((inorg|theo)\.[a-z0-9-]+)\./.exec(p.code || "");
      return m && !known[(MOVED_UNIT[p.code] || m[1]) + "/" + p.group];
    }).map(function (p) { return p.code + "（group: " + p.group + "）"; });
    assert(!bad.length, "台帳に無い group の項目が " + bad.length + " 件: " + bad.slice(0, 3).join(" / ") +
      "（束ね方は GROUPS.tsv が決める。綴りを合わせるか、台帳に行を足す）");
  });

  return results;
}

/* ---------------------------------------------------------------- Lv の根拠の表（2026-09-17）
 * `data/level_matrix.jsonl`（正・手で書くのは override 欄だけ）と `LEVEL_MATRIX.md`（生成物）が、
 * questions.json と食い違っていないか。そして **Lv を書き換える道具が上書きを守るか**。
 *
 * ⚠ なぜ要るか: `apply_seminar_levels.js` / `build_evidence.js` は「いまの Lv が規則から外れていたら動かす」。
 *   ユーザーが根拠を読んで決めた Lv（ピクリン酸 3→2）を、**回すだけで黙って元に戻していた**（v112 の便の報告）。
 * ★ 規則と関所は `tools/level_rules.js` に1つだけ置き、道具とこのテストが同じものを使う。
 * ⚠ 読めなかった環境（file:// 直開きなど）では「読めていない」で落とす（黙って合格にしない）。
 */
function runLevelMatrixTests(DATA, ROWS, MD, RULES, TOOL_SRC, USAGE_TEXT) {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: String(e && e.message || e) }); }
  };
  var assert = function (c, m) { if (!c) throw new Error(m || "assertion failed"); };
  var rows = ROWS || [];
  var text = String(MD || "");
  var byCode = {};
  rows.forEach(function (r) { byCode[r.code] = r; });
  var HOW = "（node qa/tools/gen_level_matrix.js --write）";

  t("表: 行数が項目数と同じで、全項目が1行ずつある", function () {
    assert(rows.length, "data/level_matrix.jsonl を読めていない（テストの前提が崩れている）");
    assert(rows.length === DATA.patterns.length,
      "表 " + rows.length + " 行 / 項目 " + DATA.patterns.length + " 件" + HOW);
    var lack = DATA.patterns.filter(function (p) { return !byCode[p.code]; }).map(function (p) { return p.code; });
    assert(!lack.length, "表に無い項目: " + lack.slice(0, 4).join(" ") + HOW);
  });

  t("表: 現在の Lv（questions.json）が表の現在・最終の Lv と一致する", function () {
    var bad = DATA.patterns.filter(function (p) {
      var r = byCode[p.code];
      return r && (r.lv !== p.difficulty || r.final !== p.difficulty);
    }).map(function (p) {
      var r = byCode[p.code];
      return p.code + "（difficulty " + p.difficulty + " / 表 現在 " + r.lv + "・最終 " + r.final + "）";
    });
    assert(!bad.length, "ずれている " + bad.length + " 件: " + bad.slice(0, 3).join(" / ") +
      "。上書きを足したなら difficulty も直す。difficulty を直したなら表を作り直す" + HOW);
  });

  t("表: 根拠の欄が questions.json の evidence と一致する（表が古くない）", function () {
    var bad = DATA.patterns.filter(function (p) {
      var r = byCode[p.code], ev = p.evidence || {};
      if (!r) return false;
      return r.textbook !== ev.textbook || (r.textbookWeak === true) !== (ev.textbookWeak === true) ||
        r.seminar !== ev.seminar || JSON.stringify(r.exam || null) !== JSON.stringify(ev.exam || null);
    }).map(function (p) { return p.code; });
    assert(!bad.length, "根拠の欄が古い " + bad.length + " 件: " + bad.slice(0, 4).join(" ") + HOW);
  });

  t("表: 機械の目安の欄が規則（tools/level_rules.js）で計算し直した値と一致する", function () {
    assert(RULES && RULES.seminarRule, "tools/level_rules.js を読めていない");
    var bad = rows.filter(function (r) {
      var range = RULES.tableRange(r.textbook, r.textbookWeak === true, r.seminar);
      return r.ruleSeminar !== RULES.seminarRule(r.lv, r.seminarMap, r.seminar === "プロセス") ||
        JSON.stringify(r.tableRange) !== JSON.stringify(range) || r.ruleTable !== RULES.clamp(r.lv, range);
    }).map(function (r) { return r.code; });
    assert(!bad.length, "目安の欄が規則と違う " + bad.length + " 件: " + bad.slice(0, 4).join(" ") + HOW);
  });

  t("表: 上書きには値・元の値・日付・理由がそろっている", function () {
    var ov = rows.filter(function (r) { return r.override; });
    var bad = ov.filter(function (r) {
      var o = r.override;
      return !(o.lv >= 1 && o.lv <= 4) || !(o.from >= 1 && o.from <= 4) || o.from === o.lv ||
        !/^\d{4}-\d{2}-\d{2}$/.test(o.date || "") || !String(o.reason || "").trim();
    }).map(function (r) { return r.code; });
    assert(!bad.length, "上書きの記録が欠けている: " + bad.join(" "));
  });

  // 上書き9件。v115 で2件、2026-09-17 のユーザー決定「記録してください」で過去の3件
  // （git の履歴に「ユーザーの判断」と残っていたのに表に無かったもの）を足した。
  // ⚠ **件数を固定する**: 黙って1件消えても、機械の目安と一致する項目（下の3件はどれも一致）は
  //   「記録の無い食い違い」の検査に掛からない ＝ ここでしか気づけない
  // v119 で1件（等電点。2026-09-18 のユーザー指摘「Lv1 ではない」）。⚠ 新しい上書きは末尾に足す（下の slice(2, 5) が過去の3件を指す）
  // v139 で2件（フルクトースを「還元性を示す」Lv1 と「なぜ」Lv3 に割った。2026-09-18 のユーザー決定）
  // v141 で1件（グルコースの鎖状構造を「形」Lv1 と「不斉炭素の数」Lv2 に割った。新設側は機械の値と同じ Lv2 なので上書きなし）
  var OVERRIDES = [
    ["org.aro.naphthalene-oxidation", 4, 3, "2026-09-15", /v112/],
    ["org.phenol.picric", 3, 2, "2026-09-15", /v112/],
    ["org.anal.detect-s", 3, 2, "2026-09-11", /v108（8d6065e7）/],
    ["org.fat.saponification-value", 4, 3, "2026-09-11", /v110（c75fdc9e）/],
    ["org.fat.iodine-value", 4, 3, "2026-09-11", /v110（c75fdc9e）/],
    ["org.bio.isoelectric-point", 1, 2, "2026-09-19", /v119/],
    ["org.bio.fructose", 2, 1, "2026-09-19", /v139/],
    ["org.bio.fructose-reducing", 2, 3, "2026-09-19", /v139/],
    ["org.bio.glucose-structure", 2, 1, "2026-09-19", /v141/],
    // qa v151 で1件（NO₂ と水。2026-09-23 のユーザー指摘「後半は難易度2ではない」）
    ["inorg.basis.oxide-water", 2, 3, "2026-09-23", /qa v151/]
  ];
  /** 上書きの記録を OVERRIDES と突き合わせ、問題点の一覧を返す（否定対照でも同じ関数を使う） */
  function overrideProblems(rs) {
    var by = {}, errs = [];
    rs.forEach(function (r) { by[r.code] = r; });
    var ov = rs.filter(function (r) { return r.override; }).map(function (r) { return r.code; });
    if (ov.length !== OVERRIDES.length) errs.push("上書きが " + ov.length + " 件（期待 " + OVERRIDES.length + " 件）: " + ov.join(" ") +
      "。増やしたならこの表にも足す");
    OVERRIDES.forEach(function (x) {
      var r = by[x[0]], o = r && r.override;
      if (!o) { errs.push(x[0] + " に上書きの記録が無い"); return; }
      if (o.from !== x[1] || o.lv !== x[2]) errs.push(x[0] + " の上書きが " + o.from + "→" + o.lv + "（期待 " + x[1] + "→" + x[2] + "）");
      if (o.date !== x[3]) errs.push(x[0] + " の日付が " + o.date + "（期待 " + x[3] + " ＝ 判断したコミットの日）");
      if (!/ユーザー判断/.test(o.reason || "")) errs.push(x[0] + " の理由に「ユーザー判断」が無い");
      if (!x[4].test(o.ref || "")) errs.push(x[0] + " の記録（ref）が判断したコミットを指していない: " + o.ref);
      var p = DATA.patterns.filter(function (q) { return q.code === x[0]; })[0];
      if (!p || p.difficulty !== x[2]) errs.push(x[0] + " の difficulty が上書きの値 " + x[2] + " になっていない");
    });
    return errs;
  }
  t("表: 上書き8件（ナフタレンの空気酸化・ピクリン酸・硫黄の検出・けん化価・ヨウ素価・等電点・フルクトースの2件・グルコースの鎖状構造）が理由つきで記録されている", function () {
    var errs = overrideProblems(rows);
    assert(!errs.length, errs.slice(0, 3).join(" / "));
    // 否定対照: 1件（硫黄の検出）の上書きを外した写し・日付をずらした写しでは、この検査が赤になる
    var minus = rows.map(function (r) {
      return r.code === "org.anal.detect-s" ? { code: r.code, override: null } : r;
    });
    assert(overrideProblems(minus).length >= 2, "否定対照が成立しない（上書きを1件外しても検査が赤にならない）");
    var shifted = rows.map(function (r) {
      if (r.code !== "org.fat.iodine-value") return r;
      var o = {}; for (var k in r.override) o[k] = r.override[k];
      o.date = "2026-09-17";
      return { code: r.code, override: o };
    });
    assert(overrideProblems(shifted).length === 1, "否定対照が成立しない（日付をずらしても検査が赤にならない）");
  });
  // 過去の3件は「git 履歴にだけ残っていた」ので、記録した日を理由に残す
  t("表: 過去の上書き3件の理由に、記録した日（2026-09-17 記録）が添えてある", function () {
    OVERRIDES.slice(2, 5).forEach(function (x) {
      var r = byCode[x[0]];
      assert(r && r.override && /（2026-09-17 記録）/.test(r.override.reason), x[0] + " の理由に「（2026-09-17 記録）」が無い");
    });
  });

  t("表: 機械の目安と食い違う Lv には、必ず上書きの記録がある（根拠の無い手直しを残さない）", function () {
    var loose = rows.filter(function (r) {
      return !r.override && (r.ruleSeminar !== r.lv || r.ruleTable !== r.lv);
    }).map(function (r) { return r.code + "（Lv" + r.lv + " / §3-2→" + r.ruleSeminar + " / §7-2→" + r.ruleTable + "）"; });
    assert(!loose.length, "記録の無い食い違い " + loose.length + " 件: " + loose.slice(0, 3).join(" / ") +
      "。ユーザーの判断なら data/level_matrix.jsonl の override に書く。そうでなければ Lv を目安に戻す");
  });

  t("関所: 上書きのある項目は、どちらの規則を当てても上書きの値のまま（否定対照: 上書きを外すと機械の値に戻る）", function () {
    var ov = rows.filter(function (r) { return r.override; });
    assert(ov.length, "上書きが1件も無い（この検査が空回りする）");
    var kept = ov.filter(function (r) {
      return RULES.finalLv(r.ruleSeminar, r.override) === r.override.lv &&
        RULES.finalLv(r.ruleTable, r.override) === r.override.lv;
    });
    assert(kept.length === ov.length, "上書きを守れていない: " +
      ov.filter(function (r) { return kept.indexOf(r) < 0; }).map(function (r) { return r.code; }).join(" "));
    // 否定対照: 上書きを外したら機械の値が出る。しかも少なくとも1件は上書きと違う値になる
    // （全件で機械と上書きが同じなら、関所が効いているかをこの検査では確かめられない）
    var reverted = ov.filter(function (r) {
      assert(RULES.finalLv(r.ruleSeminar, null) === r.ruleSeminar, r.code + ": 上書きが無いのに機械の値が出ない");
      assert(RULES.finalLv(r.ruleTable, null) === r.ruleTable, r.code + ": 上書きが無いのに機械の値が出ない");
      return r.ruleSeminar !== r.override.lv || r.ruleTable !== r.override.lv;
    });
    assert(reverted.length >= 1, "上書きを外しても戻る項目が無い（否定対照が成立しない）");
    assert(byCode["org.phenol.picric"].ruleSeminar === 3 && byCode["org.phenol.picric"].ruleTable === 3,
      "ピクリン酸は上書きを外すと Lv3 に戻るはず（否定対照の実例）");
  });

  t("関所: Lv を書き換える道具（apply_seminar_levels.js・build_evidence.js）が関所を通っている", function () {
    var src = TOOL_SRC || {};
    ["apply_seminar_levels.js", "build_evidence.js"].forEach(function (f) {
      var s = String(src[f] || "");
      assert(s, "tools/" + f + " を読めていない");
      assert(/require\(['"]\.\/level_rules['"]\)/.test(s), f + " が level_rules.js を読んでいない");
      assert(/readOverrides\(/.test(s), f + " が上書き（readOverrides）を読んでいない");
      assert(/finalLv\(/.test(s), f + " が関所（finalLv）を通していない");
    });
  });

  t("一覧: LEVEL_MATRIX.md が生成物であることと、全項目の最終の Lv を載せている", function () {
    assert(text, "LEVEL_MATRIX.md を読めていない");
    assert(text.indexOf("gen_level_matrix.js") >= 0 && text.indexOf("手で直さない") >= 0, "生成物である旨が書かれていない");
    var lines = {};
    text.split(/\r?\n/).forEach(function (l) {
      // ★ 2026-09-23 無機・理論（inorg.*・theo.*）も拾う。unit の部分のハイフン（acid-base・ionic-eq）も許す
      var m = l.match(/^\| `((?:org|inorg|theo)\.[a-zA-Z][a-zA-Z-]*\.[a-z0-9-]+)` \| .* \| (\d) \|$/);
      if (m && l.split(" | ").length >= 10) lines[m[1]] = +m[2];
    });
    var bad = DATA.patterns.filter(function (p) { return lines[p.code] !== p.difficulty; })
      .map(function (p) { return p.code + "（一覧 " + lines[p.code] + " / difficulty " + p.difficulty + "）"; });
    assert(!bad.length, "一覧と食い違う " + bad.length + " 件: " + bad.slice(0, 3).join(" / ") + HOW);
  });

  /* ---- 根拠ごとの Lv（2026-09-17・ユーザー決定「根拠ごとのレベルも記録しておいてください」）----
   * 表の `lvBy` = { textbook: [下限, 上限], seminar: [下限, 上限], exam: null（規則なし） }。
   * 規則は tools/level_rules.js の BY_TEXTBOOK・BY_SEMINAR・BY_EXAM の1か所。 */
  var isRange = function (g) {
    return Object.prototype.toString.call(g) === "[object Array]" && g.length === 2 &&
      g[0] >= 1 && g[1] <= 4 && g[0] <= g[1] && g[0] === Math.floor(g[0]) && g[1] === Math.floor(g[1]);
  };
  /** 表の lvBy を、questions.json の evidence から規則で計算し直した値と突き合わせる（否定対照でも使う） */
  function lvByProblems(rs) {
    var byP = {};
    DATA.patterns.forEach(function (p) { byP[p.code] = p; });
    return rs.filter(function (r) {
      var p = byP[r.code];
      return !p || JSON.stringify(r.lvBy) !== JSON.stringify(RULES.evidenceLv(p.evidence));
    }).map(function (r) { return r.code; });
  }

  t("根拠ごとの Lv: 全行に教科書・セミナー・入試の3欄がある（区間は 1〜4 の [下限, 上限]・入試は規則なし＝null）", function () {
    assert(rows.length, "data/level_matrix.jsonl を読めていない");
    var bad = rows.filter(function (r) {
      var b = r.lvBy;
      return !b || !("textbook" in b) || !("seminar" in b) || !("exam" in b) ||
        !isRange(b.textbook) || !isRange(b.seminar) || b.exam !== null;
    }).map(function (r) { return r.code; });
    assert(!bad.length, "根拠ごとの Lv の欄が欠けている・形が違う " + bad.length + " 件: " + bad.slice(0, 4).join(" ") + HOW);
  });

  t("根拠ごとの Lv: 規則（level_rules.js の evidenceLv）で questions.json の evidence から計算し直した値と一致する（否定対照: 1件書き換えると赤）", function () {
    assert(RULES && RULES.evidenceLv, "tools/level_rules.js の evidenceLv を読めていない");
    var bad = lvByProblems(rows);
    assert(!bad.length, "根拠ごとの Lv が規則と違う " + bad.length + " 件: " + bad.slice(0, 4).join(" ") + HOW);
    // 否定対照: ピクリン酸のセミナーから見た Lv を [1,2] に書き換えた写し → 1件だけ赤
    var tampered = rows.map(function (r) {
      if (r.code !== "org.phenol.picric") return r;
      return { code: r.code, lvBy: { textbook: r.lvBy.textbook, seminar: [1, 2], exam: null } };
    });
    var neg = lvByProblems(tampered);
    assert(neg.length === 1 && neg[0] === "org.phenol.picric", "否定対照が成立しない（書き換えた行を検出できない）: " + neg.join(" "));
  });

  t("根拠ごとの Lv: 変換の規則が設計書 §7-2 の片側の論法の表どおり（本文≤3・発展欄≥2・プロセス1・基本≤2・発展≥3・入試は規則なし）", function () {
    var J = function (x) { return JSON.stringify(x); };
    assert(J(RULES.BY_TEXTBOOK) === J({ "本文": [1, 3], "発展欄": [2, 4], "見あたらない": [1, 4] }),
      "教科書の規則が §7-2 と違う: " + J(RULES.BY_TEXTBOOK));
    assert(J(RULES.BY_SEMINAR) === J({ "プロセス": [1, 1], "基本": [1, 2], "発展": [3, 4], "未登場": [1, 4] }),
      "セミナーの規則が §7-2 と違う: " + J(RULES.BY_SEMINAR));
    assert(RULES.BY_EXAM === null, "入試に Lv の規則が入っている（§7-2「出題頻度は混ぜない」・§7-3「閾値は先に決めない」）");
    // 弱い教科書の判定は Lv を言わない（§7-2 の表も弱いときはセミナー側だけで挟む ＝ SEMINAR_ONLY と同じ扱い）
    assert(J(RULES.evidenceLv({ textbook: "本文", textbookWeak: true, seminar: "基本" }).textbook) === "[1,4]",
      "（弱）の教科書から Lv が出ている");
    assert(RULES.SEMINAR_ONLY === RULES.BY_SEMINAR, "弱いときの区間（SEMINAR_ONLY）がセミナーの規則と別物になっている");
    assert(RULES.push(2, [3, 4]) === "up" && RULES.push(4, [1, 3]) === "down" && RULES.push(2, [1, 3]) === "" && RULES.push(2, null) === "",
      "押している向き（push）の判定が違う");
  });

  t("根拠ごとの Lv: 目安 §7-2 の区間は「教科書 ∩ セミナー」。違う欄は理由のある3つ（本文×未登場・発展欄×プロセス・発展欄×基本）だけ", function () {
    var odd = [];
    Object.keys(RULES.TABLE).forEach(function (tb) {
      Object.keys(RULES.TABLE[tb]).forEach(function (sem) {
        var a = RULES.BY_TEXTBOOK[tb], b = RULES.BY_SEMINAR[sem];
        var lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
        var cellRange = RULES.TABLE[tb][sem];
        if (lo > hi || cellRange[0] !== lo || cellRange[1] !== hi) odd.push(tb + "×" + sem);
      });
    });
    assert(JSON.stringify(odd.sort()) === JSON.stringify(RULES.NOT_INTERSECTION.slice().sort()),
      "共通部分にならない欄が " + odd.join("・") + "（記録は " + RULES.NOT_INTERSECTION.join("・") + "）。表か規則を変えたなら理由を level_rules.js に書く");
  });

  t("入試: 手筋の数が古い行には今の値（asToolNow）が並び、questions.json の値はそのまま（否定対照: 今の値を外すと赤）", function () {
    var text = String(USAGE_TEXT || "");
    assert(text, "data/exam_usage.jsonl を読めていない");
    assert(RULES.asToolOf, "tools/level_rules.js の asToolOf を読めていない");
    var now = {};
    text.split(/\r?\n/).forEach(function (l) {
      if (!l.trim()) return;
      var o = JSON.parse(l);
      if (!o._readme) now[o.code] = RULES.asToolOf(o.problems);
    });
    var check = function (rs) {
      var byP = {};
      DATA.patterns.forEach(function (p) { byP[p.code] = p; });
      return rs.filter(function (r) {
        var ev = (byP[r.code] || {}).evidence || {};
        var old = (ev.exam && ev.exam.asTool) || 0, n = now[r.code] || 0;
        return n === old ? r.asToolNow !== undefined : r.asToolNow !== n;
      }).map(function (r) { return r.code + "（evidence " + (((byP[r.code] || {}).evidence || {}).exam || {}).asTool + " / 今 " + now[r.code] + " / 表 " + r.asToolNow + "）"; });
    };
    var bad = check(rows);
    assert(!bad.length, "今の値の欄がずれている " + bad.length + " 件: " + bad.slice(0, 3).join(" / ") + HOW);
    var stale = rows.filter(function (r) { return r.asToolNow !== undefined; });
    assert(byCode["org.ali.class-chain-ring"] && byCode["org.ali.class-chain-ring"].exam.asTool === 44,
      "questions.json の asTool（org.ali.class-chain-ring は 44）が変わっている。この表の便では変えない約束");
    // 否定対照: 古い行から今の値を外した写し → その行が赤
    if (stale.length) {
      var cut = rows.map(function (r) {
        if (r !== stale[0]) return r;
        var c = {}; for (var k in r) if (k !== "asToolNow") c[k] = r[k];
        return c;
      });
      assert(check(cut).length === 1, "否定対照が成立しない（今の値を外しても検出できない）");
    }
  });

  t("一覧: LEVEL_MATRIX.md の全項目の表に、根拠ごとの Lv と押している向き（↑↓）が規則どおり載っている（否定対照: 矢印を消すと赤）", function () {
    assert(text, "LEVEL_MATRIX.md を読めていない");
    var HEAD = "| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv |";
    assert(text.indexOf(HEAD) >= 0, "全項目の表の見出しに根拠ごとの Lv の欄が無い");
    var short = function (g) {
      if (!g) return "";
      return g[0] === g[1] ? String(g[0]) : (g[0] === 1 && g[1] === 4 ? "—" : (g[0] === 1 ? "≤" + g[1] : (g[1] === 4 ? "≥" + g[0] : g[0] + "〜" + g[1])));
    };
    var expect = function (r, k) {
      var g = r.lvBy && r.lvBy[k];
      if (!g) return "";
      var d = RULES.push(r.final, g);
      return short(g) + (d === "up" ? " **↑**" : d === "down" ? " **↓**" : "");
    };
    var scan = function (md) {
      var seen = {}, errs = [];
      md.split(/\r?\n/).forEach(function (l) {
        var m = l.match(/^\| `((?:org|inorg|theo)\.[a-zA-Z][a-zA-Z-]*\.[a-z0-9-]+)` \| /);   // ★ 2026-09-23 無機・理論も
        if (!m) return;
        var cells = l.split(" | ");
        if (cells.length < 13) return;   // 全項目の表だけ（13欄）
        var r = byCode[m[1]];
        if (!r) return;
        seen[m[1]] = true;
        if (cells[4] !== expect(r, "textbook") || cells[6] !== expect(r, "seminar") || cells[8] !== expect(r, "exam"))
          errs.push(m[1] + "（一覧 " + cells[4] + " / " + cells[6] + " / " + cells[8] + "）");
      });
      rows.forEach(function (r) { if (!seen[r.code]) errs.push(r.code + " が全項目の表に無い"); });
      return errs;
    };
    var errs = scan(text);
    assert(!errs.length, "一覧の根拠ごとの Lv が規則と違う " + errs.length + " 件: " + errs.slice(0, 3).join(" / ") + HOW);
    var arrows = rows.filter(function (r) { return RULES.push(r.final, r.lvBy.textbook) || RULES.push(r.final, r.lvBy.seminar); });
    assert(arrows.some(function (r) { return r.code === "org.phenol.picric"; }),
      "ピクリン酸（上書き 3→2・セミナーは発展 ≥3）がセミナーに押し上げられている項目に入っていない");
    // 否定対照: ピクリン酸の行の矢印を消した md → 赤
    var cutMd = text.split(/\r?\n/).map(function (l) {
      return l.indexOf("| `org.phenol.picric` |") === 0 ? l.replace(" **↑**", "") : l;
    }).join("\n");
    assert(scan(cutMd).length >= 1, "否定対照が成立しない（矢印を消しても検出できない）");
  });

  return results;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    runLevelMatrixTests: runLevelMatrixTests,
    runDataTests: runDataTests,
    pairContextHits: pairContextHits,
    pairContextHitsOf: pairContextHitsOf,
    PAIR_CONTEXT_KNOWN: PAIR_CONTEXT_KNOWN,
    runVersionTests: runVersionTests,
    runLinkTargetTests: runLinkTargetTests,
    runInventoryTests: runInventoryTests,
    runUsageTests: runUsageTests,
    runLedgerTests: runLedgerTests,
    runGroupTests: runGroupTests
  };
}
