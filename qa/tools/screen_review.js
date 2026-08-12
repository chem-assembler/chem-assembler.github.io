#!/usr/bin/env node
/**
 * 検収の下見。**目録（KNOWLEDGE_CAVEATS.md）が明示している禁止事項**を機械で検査し、
 * 人が読むべき項目を絞る。
 *
 *   node qa/tools/screen_review.js            … 全件を検査して一覧を出す
 *   node qa/tools/screen_review.js --md       … qa/data/review_screen.md に書き出す
 *
 * ## なぜ要るか
 *
 * `REVIEW_*.md`（検収シート）はチェックボックスが566個あり、**1件も埋まっていない**。
 * 全部を人が読むのは現実的でないので、**事故る型で絞る**。
 *
 * 目録は「作問でうっかり書かないこと」を34節ぶん積んできたが、
 * **守られているかを機械で見ていなかった**。ここがいちばん大きな穴だった ——
 * 台帳に書いてあるのに、書いたことを検査していない。
 *
 * ## この道具の限界
 *
 * - **語の一致で見ているので、当たりも外れもある。** 出たものは「読む価値がある」であって
 *   「誤り」ではない。**人が読んで判断する前提**
 * - ⚠ **「補足が誤答肢と同じことを言っている」型は、文字の一致では絞れなかった。**
 *   実際に事故った org.anal.apparatus-absorb（真の記述を誤答肢にしていた）を捕まえる検査を書いたが、
 *   **誤検出14件・本物1件**になり使えなかった。理由は構造が同じだから ——
 *   補足の仕事は「正しいことを述べる」なので、**誤答肢と高く重なるのが普通**。
 *   「テレフタル酸は p-キシレンの酸化で得られる」（肢は o-）のように、
 *   **正しい側を書いて訂正する**形と、**誤答肢と同じことを書いてしまった**形は、
 *   語の一致では見分けられない。意味を読む必要がある。**この型は通読で見つける**。
 * - **見つけられないものがある。** 化学として誤っているが禁止語を含まない誤り
 *   （例: マレイン酸の融点差の理由が教科書と違っていた件）はここに出ない。
 *   そういうものは目録に新しい節を足し、検査を1つ増やして初めて捕まる
 */
'use strict';

var fs = require('fs');
var path = require('path');

var QA = path.resolve(__dirname, '..');
var D = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));

// 検査の1つ1つは「目録のどの節が言っているか」を持つ。根拠の無い検査は置かない
var RULES = [
  {
    id: 'A-1 フェニルアラニン',
    why: 'キサントプロテイン反応で個々のアミノ酸名を陽性・陰性の判定点にしない。フェニルアラニンは正解肢にも誤答肢にも使わない',
    hit: function (p) {
      if (!/キサントプロテイン/.test(all(p))) return null;
      var f = fields(p).filter(function (x) { return /フェニルアラニン/.test(x.text) && /^(肢|a)/.test(x.where); });
      return f.length ? f.map(function (x) { return x.where + ': ' + x.text; }) : null;
    }
  },
  {
    id: 'A-2 臭素水の脱色',
    why: '「脱色するのはどれか」にアルデヒドやフェノールを混ぜない（どちらも脱色するので誤答肢にならない）',
    hit: function (p) {
      if (!/臭素水/.test(all(p))) return null;
      var bad = [];
      opts(p).forEach(function (o) {
        if (/脱色/.test(o.q) && /(アルデヒド|フェノール|アセトアルデヒド)/.test(o.text)) bad.push(o.where + ': ' + o.text);
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'A-5 フェーリング陽性にギ酸',
    why: 'ギ酸は錯体をつくって実質陰性になるので、フェーリング陽性の正解肢にしない（銀鏡反応の例に使う）',
    hit: function (p) {
      if (!/フェーリング/.test(all(p))) return null;
      var bad = [];
      opts(p).forEach(function (o) { if (o.correct && /ギ酸/.test(o.text)) bad.push(o.where + '（正解肢）: ' + o.text); });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'A-5 液性で還元性を対比',
    why: 'フェーリング液も銀鏡反応も塩基性でしか使えないので、「中性・酸性では還元性を示さない」という比較は実験として成り立たない',
    hit: function (p) {
      var bad = [];
      fields(p).forEach(function (x) {
        if (/還元性/.test(x.text) && /(中性|酸性)(では|だと|の条件)/.test(x.text) && /示さない|陰性/.test(x.text)) {
          bad.push(x.where + ': ' + x.text);
        }
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'C-1 エーテルを無極性と書く',
    why: 'エーテルは無極性ではない（折れ線なので双極子が打ち消されない）。沸点や溶解度は水素結合で説明する',
    hit: function (p) {
      var bad = [];
      fields(p).forEach(function (x) {
        if (/エーテル/.test(x.text) && /無極性/.test(x.text)) bad.push(x.where + ': ' + x.text);
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'D-8 エーテルは反応しないと断定',
    why: '強酸で C−O が切れ、空気酸化で過酸化物をつくる。「いかなる試薬とも反応しない」型の断定は作らない',
    hit: function (p) {
      if (!/エーテル/.test(all(p))) return null;
      var bad = [];
      fields(p).forEach(function (x) {
        if (/(いかなる|どんな試薬|まったく|全く)[^。]{0,20}反応しない/.test(x.text)) bad.push(x.where + ': ' + x.text);
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'D-9 アセチル化に酢酸を誤答肢',
    why: 'フェノール性ヒドロキシ基は酢酸ではエステル化が進まない。誤りだと気づける材料が高校範囲に無いので誤答肢に混ぜない',
    hit: function (p) {
      if (!/(アセチルサリチル酸|アスピリン|無水酢酸)/.test(all(p))) return null;
      var bad = [];
      opts(p).forEach(function (o) {
        // 設問が「何を作用させるか」を問うているときだけ見る。
        // 無水酢酸そのものの定義を問う項目（org.carbonyl.acid-anhydride）は対象外
        if (!/(作用させる|試薬|加えると|用いる)/.test(o.q)) return;
        if (!o.correct && /酢酸(?![ビナメエ無])/.test(o.text) && !/無水酢酸/.test(o.text)) {
          bad.push(o.where + '（誤答肢）: ' + o.text);
        }
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'I-1 ヨードホルム陽性に酢酸・酢酸エステル',
    why: '強塩基でカルボキシラートになり反応が進まない。**陽性（正解肢）に入れない**。陰性の例として誤答肢に置き、理由を補足に書くのは正しい扱い（org.carbonyl.iodoform-carbonyl がその形）',
    hit: function (p) {
      if (!/ヨードホルム/.test(all(p))) return null;
      var bad = [];
      opts(p).forEach(function (o) {
        if (!o.correct) return;   // 誤答肢に置くのは正しい（陰性の例）
        if (/ヨードホルム|黄色沈殿/.test(o.q) && /(酢酸エチル|酢酸(?![ビナメエ]))/.test(o.text)) bad.push(o.where + '（正解肢）: ' + o.text);
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'I-4 カルボン酸は還元できないと断定',
    why: 'LiAlH₄ を使えば還元できる。「カルボン酸は還元できない」という断定を選択肢に入れない',
    hit: function (p) {
      var bad = [];
      fields(p).forEach(function (x) {
        if (/カルボン酸[^。]{0,12}(還元(され|でき)ない|還元されない)/.test(x.text)) bad.push(x.where + ': ' + x.text);
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'D-6 シス・トランスを選択肢で問う（油脂）',
    why: '天然の油脂はほぼシス型なので結論は正しいが、シス・トランスの区別を選択肢では問わない',
    hit: function (p) {
      if (p.unit !== 'fat') return null;
      var bad = [];
      opts(p).forEach(function (o) { if (/(シス|トランス)(形|型)/.test(o.text)) bad.push(o.where + ': ' + o.text); });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'E表 ヘミアセタールという語を問う',
    why: '糖の環化は「環状と鎖状が平衡で共存する」までを問い、ヘミアセタールという語は問わない（発展欄の語）',
    hit: function (p) {
      var bad = [];
      fields(p).forEach(function (x) {
        if (/ヘミアセタール/.test(x.text) && /^(q|肢)/.test(x.where)) bad.push(x.where + ': ' + x.text);
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'E表 理由を問う設問（機械的に教えるもの）',
    why: 'マルコフニコフ則・ザイツェフ則・フェノールの酸性・ベンゼンの結合・ヨウ素デンプンの呈色・フェノールと臭素水・アニリンの塩基性・シス/トランスの融点差 は、結論だけ覚えるのが正しい。理由を問う設問を作らない',
    hit: function (p) {
      var T = (p.variants || []).map(function (v) { return v.q || ''; }).join(' ');   // 設問文だけで話題を判定（誤答肢や補足の語で拾うと誤検出になる）
      var topics = [
        [/マルコフニコフ/, 'マルコフニコフ則'], [/ザイツェフ/, 'ザイツェフ則'],
        [/ヨウ素デンプン/, 'ヨウ素デンプン反応の呈色'],
        [/アニリン[^。]{0,20}(弱い|弱塩基)/, 'アニリンの塩基性']
      ];
      var t = topics.filter(function (x) { return x[0].test(T); });
      if (!t.length) return null;
      var bad = [];
      p.variants.forEach(function (v) {
        if (v.q && /(なぜ|理由|どうして)/.test(v.q)) bad.push(v.mode + '.q（' + t[0][1] + 'の理由を問うている）: ' + v.q);
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: 'C11 排反肢（互いの否定を両方置いている）',
    why: '片方が正しければもう片方は自動的に誤りなので、**判定として働かない**（REVIEW_CRITERIA C11）。'
      + '実際に事故った ―― org.anal.apparatus-absorb は「二酸化炭素を吸収する」と'
      + '「二酸化炭素を吸収せず通過させる」を両方置き、**真のほうを誤答扱いにしていた**（v68 で修正）',
    hit: function (p) {
      var bad = [];
      (p.variants || []).forEach(function (v) {
        var os = v.options || [];
        os.forEach(function (a, i) {
          os.forEach(function (b, j) {
            if (j <= i) return;
            var neg = /(ない|せず|しない|ぬ$)/;
            if (neg.test(a) === neg.test(b)) return;   // 否定の有無が同じなら対ではない
            // ⚠ C11 の例外を3つ入れる（入れないと誤検出だけが並んで役に立たない）
            // (1) **両方が正解**なら排反ではない。排反なら両方○はありえないので、別物の証拠になる
            //     （例: 「グリシンには鏡像異性体が存在しない」と「アラニンには存在する」）
            if (v.correct.indexOf(i) >= 0 && v.correct.indexOf(j) >= 0) return;
            // (2) **多値属性は並列してよい**（C11 が明記）。数を含む対は補集合があるので自明化しない
            //     （例: 「炭素数3は2種類」と「1種類しかない」は 3種類もありうるので当てられない）
            if (/[0-9０-９一二三四五六七八九十]/.test(a) && /[0-9０-９一二三四五六七八九十]/.test(b)) return;
            // (3) **全称の否定**（どの〜も／すべての〜／いずれも）は自明化しない。
            //     「フェノールは水層に移る」と「どの酸も水層に移らない」は、前者を知っても
            //     後者が他の酸まで含めて誤りかは別に考える必要があるので、判定として働く
            if (/(どの|すべての|全ての|いずれ|あらゆる)/.test(a) || /(どの|すべての|全ての|いずれ|あらゆる)/.test(b)) return;
            if (overlap(stem(a), stem(b)) < 0.6) return;
            bad.push('肢' + i + (v.correct.indexOf(i) >= 0 ? '○' : '×') + '「' + a + '」 ⇔ '
              + '肢' + j + (v.correct.indexOf(j) >= 0 ? '○' : '×') + '「' + b + '」');
          });
        });
      });
      return bad.length ? bad : null;
    }
  },
  {
    id: '絶対語の断定',
    why: '「必ず」「すべて」「常に」「決して」は成立条件が落ちやすい。とくに正解肢にあると、条件つきの事実を無条件の断定にしてしまう',
    hit: function (p) {
      var bad = [];
      opts(p).forEach(function (o) {
        if (!o.correct) return;   // 誤答肢の絶対語は「わざと極端にした肢」なので許す
        // 「すべての原子が同一平面上」のように**1つの分子の中を全部指す**言い方は正しい記述。
        // 危ないのは**種類をまたいで一般化**する言い方（すべてのアルコールは、など）
        if (/すべての(原子|炭素|水素|結合|頂点)/.test(o.text)) return;
        // 設問が特定の物質1つに限定されているなら、条件は設問側にあるので許す
        if (/^[^、。]{0,18}(（[^）]*）)?\s*(C[₀-₉A-Za-z0-9]*)?\s*(について|の性質|の構造|の形)/.test(o.q)) return;
        var m = o.text.match(/(必ず|すべての|全ての|常に|決して|例外なく|いかなる)/);
        if (m) bad.push(o.where + '（正解肢）: ' + o.text);
      });
      return bad.length ? bad : null;
    }
  }
];

// ---- 補助 ----
// 文字の2連ねの重なり具合（小さいほうを基準にした割合）。
// 部分文字列の包含だと「塩化カルシウムは」と「塩化カルシウム管は」のように
// 途中に語が挟まると当たらない。実際にそれで検出できなかったので、この形にした
function overlap(a, b) {
  function grams(s) { var g = {}; for (var i = 0; i + 1 < s.length; i++) g[s.substr(i, 2)] = 1; return g; }
  var ga = grams(a), gb = grams(b);
  var ka = Object.keys(ga), kb = Object.keys(gb);
  if (!ka.length || !kb.length) return 0;
  var shared = ka.filter(function (k) { return gb[k]; }).length;
  return shared / Math.min(ka.length, kb.length);
}

// 否定と細かい修飾を落として、肢の「骨」を取り出す。排反肢の検出に使う
function stem(s) {
  return String(s)
    .replace(/(ない|せず|しない|ぬ)/g, '')
    .replace(/[はがをにでともやのな。、（）()]/g, '')
    .replace(/s+/g, '');
}
function all(p) { return JSON.stringify(p.variants) + (p.knowledge || ''); }
function fields(p) {
  var out = [];
  (p.variants || []).forEach(function (v) {
    ['q', 'a', 'supplement'].forEach(function (k) {
      if (v[k]) out.push({ where: k === 'q' ? 'q' : (k === 'a' ? 'a' : 'supp'), text: v[k], mode: v.mode });
    });
    (v.options || []).forEach(function (o, i) {
      out.push({ where: '肢' + i, text: o, mode: v.mode, correct: (v.correct || []).indexOf(i) >= 0 });
    });
  });
  return out;
}
function opts(p) {
  var out = [];
  (p.variants || []).forEach(function (v) {
    (v.options || []).forEach(function (o, i) {
      out.push({ where: '肢' + i, text: o, q: v.q || '', correct: (v.correct || []).indexOf(i) >= 0 });
    });
  });
  return out;
}

// ---- 実行 ----
var flagged = [];
D.patterns.forEach(function (p) {
  RULES.forEach(function (r) {
    var h = r.hit(p);
    if (h) flagged.push({ code: p.code, unit: p.unit, lv: p.difficulty, rule: r.id, why: r.why, detail: h });
  });
});

var byRule = {};
flagged.forEach(function (f) { (byRule[f.rule] = byRule[f.rule] || []).push(f); });

var lines = [];
function say(s) { lines.push(s); console.log(s); }

say('検収の下見: 全 ' + D.patterns.length + '項目を目録の禁止事項 ' + RULES.length + '件で検査');
say('引っかかった項目: ' + flagged.length + '件（' + Object.keys(byRule).length + '種の規則）');
say('');
say('⚠ 出たものは「読む価値がある」であって「誤り」ではない。**人が読んで判断する**。');
say('');
RULES.forEach(function (r) {
  var fs2 = byRule[r.id];
  if (!fs2) return;
  say('## ' + r.id + '（' + fs2.length + '件）');
  say('');
  say('> ' + r.why);
  say('');
  fs2.forEach(function (f) {
    say('- **' + f.code + '**（' + f.unit + '・Lv' + f.lv + '）');
    f.detail.forEach(function (d) { say('  - ' + d); });
  });
  say('');
});
var clean = RULES.filter(function (r) { return !byRule[r.id]; });
if (clean.length) {
  say('## 引っかからなかった規則（' + clean.length + '件）');
  say('');
  clean.forEach(function (r) { say('- ' + r.id); });
  say('');
}

if (process.argv.indexOf('--md') >= 0) {
  fs.writeFileSync(path.join(QA, 'data', 'review_screen.md'),
    '# 検収の下見（機械の絞り込み）\n\n`node qa/tools/screen_review.js --md` が生成する。**手で編集しない。**\n\n' +
    lines.join('\n') + '\n', 'utf8');
  console.log('→ qa/data/review_screen.md に書き出した');
}
