// マスのシート（M3〜M11）と編成を選ぶ全画面ビュー（M5）の描画。
// ui-flow.md v3 の決定に対応する:
//   - シートの先頭に、過去の結果の手渡しと、報酬とコストの並置を置く（M3）。
//   - 決定系のボタンはシート下部の固定バーに置く（スクロールなしに押せる）。
//   - 戦闘の流れは1経路: 編成を選ぶ → 行タップ → M8 の確認表示 → 結果ボタン。
//   - 探索は、空の枠に自分で入れる入口（M7）→ 結果ボタン（シート内）。
//   - 回復の境界確認（M9）はシートの中で完結する。
// このモジュールは DOM の組み立てだけを行い、状態の計算は main.js が
// ビューモデル（vm）として渡す。コールバックは cb 経由で main.js に戻る。

import { bindSearchInput, styleChip, faceIconImg, faceWithStyle, faceWithStyleClassBadge, styleIconImg, classIconImg, styleClassIconImg } from './views.js';
import { enemyFastestText } from './speed.js';
import { attachCandidateSwipe, isSwipeSuppressed } from './swipe.js';
import { hbombSectionNode, kyoenSectionNode, flagSectionNode } from './builder.js';

// 候補の出典注記（M4 の対策節と編成エディタのターゲット節で同じ文を
// 出す。文言を変える時はここ1箇所だけを直す）。
export const CANDIDATE_SOURCE_NOTE = '候補は本体の能力・専用霊宝・オーブ・マスエフェクト由来です（マスエフェクトはリーダーに置いた場合）。';

// 編成管理画面の説明文（空状態と通常状態で同じ文を出す）。
const FORMATION_MANAGE_NOTE = 'ここで編成を管理・保存できます。';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// 候補の列挙文（「名前（媒体・方法） 素早さ…」を '、' でつないだ1文字列）
// を、1候補ずつに割る。区切りは括弧の深さ0にある '、' だけを見る
// （媒体・条件の括弧の中の '、' で候補を割らないため）。末尾の
// 「ほかN体／N件」は独立した項目として返る。
export function splitCandidateText(joined) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(joined || '')) {
    if (ch === '（') depth += 1;
    else if (ch === '）') depth = Math.max(0, depth - 1);
    if (ch === '、' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// 候補の列挙を「1候補1行」で出す部品（見た目の段、2026-11-20）。
// 従来は名前＋注記を '、' でつないだ単一段落で、15行を超える壁に
// なっていた。情報は落とさず、名前を太字で立て、注記（媒体・方法・
// 耐性・素早さ）は一段小さい字で右に続ける。builder.js のターゲット
// 節でも同じ部品を使う。
// 候補ラベルの枠付け（2026-11-26 判断確定・案1）: 列挙が「全部が
// 必要」ではなく「どれか1つでよい」と読める形にする。件数・名前・
// 並びは変えない。対象はこの部品を通る候補列挙のラベルすべて
// （メギド候補・オーブ候補・始動できる人。著述の詳細文中の
// 「候補:」「オーブ:」の行もこの部品を通るため同じ枠付けになる）。
const CANDIDATE_FRAMING_LABELS = new Set(['候補', 'オーブ', '始動できる人']);
export function candidateLabelText(label) {
  return CANDIDATE_FRAMING_LABELS.has(label) ? `${label}（どれか1つでよい）` : label;
}

export function candidateListNode(label, joinedText) {
  const wrap = el('div', 'cand-lines');
  wrap.append(el('div', 'cand-lines-label', `${candidateLabelText(label)}:`));
  for (const item of splitCandidateText(joinedText)) {
    if (item.startsWith('ほか')) {
      wrap.append(el('div', 'cand-line-more', item));
      continue;
    }
    const row = el('div', 'cand-line');
    const idx = item.indexOf('（');
    if (idx > 0) {
      row.append(el('span', 'cand-line-name', item.slice(0, idx)));
      row.append(el('span', 'cand-line-rest', item.slice(idx)));
    } else {
      row.append(el('span', 'cand-line-name', item));
    }
    wrap.append(row);
  }
  return wrap;
}

// 敵ステータスの表示（2026-11-25、マスター指示）: 1項目ずつ行を
// 分ける。マスのルールで変わった値は、変化の文法で出す: 矢印も
// 色も方向（上がる = ↑ + 赤 --up／下がる = ↓ + 青 --down）。
// 敵の値でも味方と同じ対応にする（版128 は色を評価で付けたが、
// マスター訂正で方向へ付け替えた）。矢印は値の直後に置く
// （2026-11-26、案Bで統一）。
// lines: [{ label, appliedText, detailText, dir }]
function enemyStatLinesNode(lines) {
  const wrap = el('div', 'enemy-stats');
  for (const line of lines || []) {
    const row = el('div', 'enemy-stat-line');
    row.append(el('span', 'enemy-stat-label', line.label));
    if (line.dir === 'up' || line.dir === 'down') {
      const arrow = line.dir === 'up' ? '↑' : '↓';
      const cls = line.dir === 'up' ? 'enemy-stat-val enemy-stat-up' : 'enemy-stat-val enemy-stat-down';
      row.append(el('span', cls, ` ${line.appliedText}${arrow}`));
    } else {
      row.append(el('span', 'enemy-stat-val', ` ${line.appliedText}`));
    }
    if (line.detailText) row.append(el('span', 'enemy-stat-detail', line.detailText));
    wrap.append(row);
  }
  return wrap;
}

// 素早さの内訳を補正ごとの span で出す（builder.js と同じ統一
// 表記: 上昇は ↑ + 赤（--up）、低下は ↓ + 青（--down）。parts: [{ text, dir }]）。
// 受けダメージの見積もり（積4）の、落ちる攻撃1件の行。
// builder.js の編成エディタでも同じ形で出す。
function damageEstimateHitText(hit) {
  const name = hit.skillName ? `『${hit.skillName}』` : '';
  const hits = hit.hits > 1 ? `（${hit.hits}連続の合計）` : '';
  const cond = hit.conditionNote ? `（${hit.conditionNote}）` : '';
  return `${hit.attackerName}の${hit.kindLabel}${name}で約${hit.total}点${hits}${cond}`;
}

// 攻撃の見積もり（A5 改訂、2026-11-26）の、攻撃1件の行。
// 受けダメージ側の行（damageEstimateHitText）と同じ形に揃える。
// 技名は持ち主つきで書く（全体構成 問題14 追記、2026-11-27）:
// 技名だけでは誰の技か分からないため、選んだ味方の名前を省かない。
function outgoingEstimateLineText(line, targetHp, ownerName) {
  const name = line.skillName ? `『${line.skillName}』` : '';
  const hits = line.hits > 1 ? `（${line.hits}連続の合計）` : '';
  // レベル段階のある能力は、段違いの行を区別できるよう Lv を出す。
  const lv = typeof line.lvStage === 'number' ? `（Lv${line.lvStage}）` : '';
  const cond = line.conditionNote ? `（${line.conditionNote}）` : '';
  const kill = typeof targetHp === 'number' && line.total >= targetHp ? '。倒せる見込み' : '';
  const owner = ownerName ? `${ownerName}の` : '';
  return `${owner}${line.kindLabel}${name}で約${line.total}点${hits}${lv}${cond}${kill}`;
}

// 見積もりの見た目（全体構成 問題14の残り・見た目分、2026-11-27）:
// 文面は版164のまま変えず、形だけを変える部品。材料の行の中で、
// ダメージ・残りHPの数字（「N点」の数字部分）だけを大きな字の
// span に切り分ける。文の内容・並びは変えない。
function estimateMaterialNode(text) {
  const node = el('p', 'sheet-note');
  const re = /(\d[\d,]*)(?=点)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) node.append(el('span', '', text.slice(last, m.index)));
    node.append(el('span', 'est-num', m[1]));
    last = m.index + m[1].length;
  }
  if (last < text.length) node.append(el('span', '', text.slice(last)));
  return node;
}

// 攻撃の見積もりの行の形（同）: 味方名／技名を左に、ダメージを
// 右に揃える行にする。文面は outgoingEstimateLineText の出力を
// 「…で／約…」の境で割るだけ（文の内容・並びは変えない）。
function outgoingEstimateRowNode(line, targetHp, ownerName) {
  const text = outgoingEstimateLineText(line, targetHp, ownerName);
  const row = el('div', 'est-row');
  const idx = text.indexOf('で約');
  if (idx < 0) {
    row.append(el('span', 'est-row-main', text));
    return row;
  }
  row.append(el('span', 'est-row-main', text.slice(0, idx + 1)));
  const rest = text.slice(idx + 1); // 「約N点…」
  const dmg = el('span', 'est-row-dmg');
  const m = /^約(\d[\d,]*)(点)/.exec(rest);
  if (m) {
    // 「約N点」はひとかたまり（途中で割らない）。後ろの注記
    // （連続の合計・条件・倒せる見込み）は別のかたまりで続ける。
    const core = el('span', 'est-row-dmg-core');
    core.append(el('span', '', '約'));
    core.append(el('span', 'est-num', m[1]));
    core.append(el('span', '', '点'));
    dmg.append(core);
    const notes = rest.slice(m[0].length);
    if (notes) dmg.append(el('span', '', notes));
  } else {
    dmg.append(el('span', '', rest));
  }
  row.append(dmg);
  return row;
}

// 落ちる味方がいない場合の理由の行（2026-11-25、マスター指示）:
// どの行動への見積もりかと、耐える理由（落ちるのに一番近い攻撃を
// 受けてもHPがどれだけ残るか）を出す。材料は estimateFalls の
// closest（計算側で根拠のある組だけが返る）。
function damageEstimateSafeLines(est) {
  if (!est || !est.closest) return [];
  const c = est.closest;
  return [
    `一番危ない攻撃: ${damageEstimateHitText(c)}`,
    // 受け手は「一番脆い」（落ちるのに一番近い）味方であることを
    // 明示する（全体構成 問題14 追記、2026-11-27）。
    `一番脆い${c.allyName}が受けてもHPが${c.allyHp - c.total}点残る`,
  ];
}

// builder.js の spdDirText と同じ対応（矢印は値の直後、末尾の
// （注記）がある場合はその前）。
function spdDirText(text, dir) {
  if (dir !== 'up' && dir !== 'down') return text;
  const arrow = dir === 'up' ? '↑' : '↓';
  const note = /（[^）]*）$/.exec(text);
  if (note) return `${text.slice(0, note.index)}${arrow}${note[0]}`;
  return `${text}${arrow}`;
}

// 枠の中の内訳（5枠グリッド用）: 補正ごとに自分の行へ置く
// （2026-11-26 ペルソナ検品。builder.js の slotSpdDetailNode と同じ）。
function slotSpdDetailNode(parts) {
  const wrap = el('span', 'slot-spd-detail');
  for (const p of parts || []) {
    const line = el('span', 'slot-spd-detail-line fit-x');
    if (p.dir === 'up') line.append(el('span', 'spd-part spd-up', spdDirText(p.text, p.dir)));
    else if (p.dir === 'down') line.append(el('span', 'spd-part spd-down', spdDirText(p.text, p.dir)));
    else line.append(el('span', '', p.text));
    wrap.append(line);
  }
  return wrap;
}

// 枠の霊宝の圧縮表示（2026-11-19、ユーザー合意。builder.js の
// エディタ枠と同じ形）: 「霊宝 n/4」＋専用霊宝・絆霊宝の所持印＋
// 素早さに効く霊宝だけの名前つき注記。名前の全列挙はしない。
// 絆の印は状態異常耐性が付くため（2026-11-20 ユーザー訂正）。
// summary: { count, max, special, bond, spdNotes: [{ name,
// segments: [{ text, dir }] }] }。数値は合算済み、向きは ↑↓＋色。
function spdSegSpan(seg) {
  if (seg.dir === 'up') return el('span', 'spd-part spd-up', spdDirText(seg.text, seg.dir));
  if (seg.dir === 'down') return el('span', 'spd-part spd-down', spdDirText(seg.text, seg.dir));
  return el('span', '', seg.text);
}
// 確認表示の枠用（縦に積む形）。印は builder.js と同じく「霊宝
// n/4」の下の決まった行に出す（全体構成 問題12、2026-11-27）。
function reishouSummaryNode(summary) {
  const s = summary || { count: 0, max: 4, special: false, bond: false, spdNotes: [] };
  const wrap = el('div', 'slot-reishou');
  const head = el('span', 'reishou-summary-head', `霊宝 ${s.count}/${s.max || 4}`);
  wrap.append(head);
  if (s.special || s.bond) {
    const marks = el('span', 'reishou-marks');
    if (s.special) marks.append(el('span', 'reishou-mark', '専'));
    if (s.bond) marks.append(el('span', 'reishou-mark', '絆'));
    wrap.append(marks);
  }
  for (const note of s.spdNotes || []) {
    // 狭い枠では数値（色つき）が先に目に入る並び（builder.js と同じ）。
    const line = el('span', 'reishou-spd-note');
    (note.segments || []).forEach((seg, i) => {
      if (i > 0) line.append(el('span', '', ' '));
      line.append(spdSegSpan(seg));
    });
    if ((note.segments || []).length > 0) line.append(el('span', '', ' '));
    line.append(el('span', 'reishou-spd-note-name fit-x', note.name));
    wrap.append(line);
  }
  return wrap;
}
// 編成一覧のメンバー行用（横に流す形）。
function reishouSummaryInline(summary) {
  const s = summary || { count: 0, max: 4, special: false, bond: false, spdNotes: [] };
  const wrap = el('span', 'formation-member-reishou', `／霊宝 ${s.count}/${s.max || 4}`);
  if (s.special) wrap.append(el('span', 'reishou-mark', '専'));
  if (s.bond) wrap.append(el('span', 'reishou-mark', '絆'));
  (s.spdNotes || []).forEach((note, i) => {
    const line = el('span', 'reishou-spd-note inline');
    line.append(el('span', '', i === 0 && !s.special && !s.bond ? ' ' : '・'));
    line.append(el('span', 'reishou-spd-note-name', note.name));
    for (const seg of note.segments || []) {
      line.append(el('span', '', ' '));
      line.append(spdSegSpan(seg));
    }
    wrap.append(line);
  });
  return wrap;
}

function section(title) {
  const wrap = el('div', 'sheet-section');
  wrap.append(el('h3', 'sheet-section-title', title));
  return wrap;
}

// 著述の表示（M4）: 単位は「この脅威には、これで受ける」の対
// （2026-11-19 構造変更）。脅威と対策を別々の羅列で出すと、どれが
// どれに効くかの照合が読み手の作業になるため、対策は脅威の下に
// ぶら下げて出す。どの対にも入らない戦術は「全体の進め方」に分ける。
// 要約ピルは要注意ギミックと非効率的な手段だけ（戦術のピル列は
// 対と重なるため置かない）。
// authored: { title, threatPills: [], ineffectivePills: [],
//             pairs: [{label, detail, responses: [{label, detail}]}],
//             overall: [{label, detail}],
//             ineffectiveItems: [{label, detail}], note }
// 編成構築のターゲット節でも同じ著述表示を再利用するため export する。
//
// 著述は2つに分けて出す部品:
// - authoredSourceContent: 原資料（ピル＝予告、対、非効率的な手段）。
//   脅威の側は痛い所として赤字で出す。
// - authoredOverallContent: 「どう倒すか」（全体の進め方）。
// authoredContent は両方を続けて出す形（編成エディタのターゲット
// 節用）。マスのシートには SW91 から著述の原文は出さず、統合の
// 計算を「攻略のポイント」の形で描く（main.js の enemyPointsVm）。
// 詳細文を親要素へ割り付ける: 「候補: …」「オーブ: …」の行は
// 段落のままでは壁になるため、1候補1行の部品に割り直して出す
// （文面そのものは変えない）。それ以外の行は pre-line の文章で出す。
function appendDetailLines(parent, detail) {
  const buf = [];
  const flush = () => {
    if (buf.length > 0) parent.append(el('div', 'authored-item-detail', buf.join('\n')));
    buf.length = 0;
  };
  for (const line of String(detail).split('\n')) {
    const m = line.match(/^(候補|オーブ): (.+)$/);
    if (m) { flush(); parent.append(candidateListNode(m[1], m[2])); }
    else buf.push(line);
  }
  flush();
}

function authoredItem(label, detail, cls) {
  const it = el('div', cls);
  it.append(el('div', 'authored-item-label', label));
  if (detail) appendDetailLines(it, detail);
  return it;
}

export function authoredSourceContent(authored) {
  const wrap = el('div', 'authored-wrap');
  const pillRow = (label, pills, cls) => {
    if (!pills || pills.length === 0) return;
    const row = el('div', 'pill-row');
    row.append(el('span', 'pill-label', label));
    for (const p of pills) row.append(el('span', `pill ${cls}`, p));
    wrap.append(row);
  };
  pillRow('要注意ギミック', authored.threatPills, 'pill-threat');
  pillRow('非効率的な手段', authored.ineffectivePills, 'pill-ineffective');
  const hasBody = (authored.pairs && authored.pairs.length > 0)
    || (authored.ineffectiveItems && authored.ineffectiveItems.length > 0)
    || authored.note;
  if (hasBody) {
    const block = el('div', 'authored-block');
    block.append(el('div', 'authored-title', authored.title || '攻略情報'));
    if (authored.pairs && authored.pairs.length > 0) {
      block.append(el('div', 'authored-title', '脅威と対策'));
      for (const pair of authored.pairs) {
        const pairEl = el('div', 'authored-pair');
        pairEl.append(authoredItem(pair.label, pair.detail, 'authored-item authored-pair-threat authored-threat-text'));
        for (const r of pair.responses || []) {
          pairEl.append(authoredItem(r.label, r.detail, 'authored-item authored-response'));
        }
        block.append(pairEl);
      }
    }
    if (authored.ineffectiveItems && authored.ineffectiveItems.length > 0) {
      block.append(el('div', 'authored-title', '非効率的な手段'));
      for (const t of authored.ineffectiveItems) block.append(authoredItem(t.label, t.detail, 'authored-item'));
    }
    if (authored.note) block.append(el('p', 'authored-note', authored.note));
    wrap.append(block);
  }
  return wrap;
}

export function authoredOverallContent(authored) {
  if (!authored.overall || authored.overall.length === 0) return null;
  const block = el('div', 'authored-block');
  block.append(el('div', 'authored-title', '全体の進め方'));
  for (const t of authored.overall) block.append(authoredItem(t.label, t.detail, 'authored-item'));
  return block;
}

export function authoredContent(authored) {
  const wrap = el('div', 'authored-wrap');
  wrap.append(authoredSourceContent(authored));
  const overall = authoredOverallContent(authored);
  if (overall) wrap.append(overall);
  return wrap;
}

// 攻略のポイント1件の本文（SW91）: 根拠と具体名。ブロック由来は
// 対象・効き方・条件・候補の列、著述由来は対／全体の文（候補行は
// 1候補1行に割り直す。文面は変えない）。
function pointBodyNode(p) {
  const body = el('div', 'point-body');
  if (p.threatText) body.append(el('p', 'point-threat', `対象: ${p.threatText}`));
  // 効き方は対策クラスごとに1行で来る（counter.js の再構成で改行
  // 区切り）。行ごとに段落を分けて出す。
  if (p.how) {
    for (const line of String(p.how).split('\n')) {
      if (line) body.append(el('p', 'sheet-note', line));
    }
  }
  if (p.methodNote) body.append(el('p', 'sheet-note', `条件: ${p.methodNote}`));
  if (p.detail) body.append(el('p', 'sheet-note', p.detail));
  if (p.detailText) appendDetailLines(body, p.detailText);
  if (p.startersText) body.append(candidateListNode('始動できる人', p.startersText));
  if (p.candidatesText) body.append(candidateListNode('候補', p.candidatesText));
  if (p.orbsText) body.append(candidateListNode('オーブ', p.orbsText));
  if (!p.candidatesText && !p.orbsText && !p.startersText && !p.noteOnly) {
    body.append(el('p', 'counter-candidates', '候補: 所持している人の中にはいません'));
  }
  if (p.noteOnly && !p.candidatesText && !p.orbsText && !p.startersText) {
    body.append(el('p', 'sheet-note', '編成の形で答える対策です（候補の列挙はありません）'));
  }
  return body;
}

// タイムライン（SW91）: 編成の味方とそのマスの敵を実効速度順に
// 並べた帯。表示だけ（チェインの組み立てはエディタ側）。
function sheetTimelineNode(rows) {
  const sec = section('タイムライン');
  const strip = el('div', 'sheet-timeline');
  for (const r of rows) {
    const chip = el('div', `tl-chip ${r.kind === 'enemy' ? 'tl-enemy' : 'tl-ally'}`);
    chip.append(el('span', 'tl-chip-name', r.name));
    chip.append(el('span', 'tl-chip-spd',
      typeof r.spd === 'number' ? `素早さ${r.spd}` : '素早さ不明'));
    strip.append(chip);
  }
  sec.append(strip);
  return sec;
}

// シミュレーターのチップ（SW91、SW95で本体化）: 対応するものだけ
// を出し、押すとその場で下に開く。パネルの中身は編成エディタと
// 同じシミュレーター本体（builder.js の区画そのもの）で、操作は
// cb（onHbomb* / onKyoen*）経由で main.js の共用ハンドラへ戻る。
// 戦旗はエディタと同じ条件チェックの区画を出す。
function sheetSimsNode(sims, cb) {
  const sec = section('シミュレーター');
  const chips = el('div', 'sim-chips');
  for (const s of sims) {
    const btn = el('button', `sim-chip${s.open ? ' open' : ''}`, s.label);
    btn.addEventListener('click', () => { if (cb.onSimToggle) cb.onSimToggle(s.key); });
    chips.append(btn);
  }
  sec.append(chips);
  for (const s of sims) {
    if (!s.open) continue;
    if (s.key === 'hbomb' && s.hbomb) sec.append(hbombSectionNode(s.hbomb, cb));
    else if (s.key === 'kyoen' && s.kyoen) sec.append(kyoenSectionNode(s.kyoen, cb));
    else if (s.key === 'flag' && s.flagRows) sec.append(flagSectionNode(s.flagRows));
  }
  return sec;
}

// 探索の結果は、色を選ばせない（ui-flow.md M7 の確定形）: 結果の入力は
// ゲームの結果画面の行を写す形で、色の名前はどの画面にも出さない。
// 内部表現として箱色のキーは main 側に残る。記録の実行は下部バーの
// 「これで探索を記録する」だけ。

// ---- マスのシート ----
// 戻り値: { content, actionBar }（actionBar は無い場合は null）
// オススメ合致の印: 「合致」だけでなく、スタイルとクラスのどちらが
// 合ったかまで言う（2026-11-19 ユーザー指定）。両方合えば両方出す。
function appendOsusumeMarks(line, m, leadingSpace = false) {
  const p = leadingSpace ? ' ' : '';
  if (m.matchedStyle) line.append(el('span', 'osu-mark', `${p}オススメスタイルが合致`));
  if (m.matchedClass) line.append(el('span', 'osu-mark', `${p}オススメクラスが合致`));
}

// 需要の印（2026-11-21、需要の印の便）: 件数ではなく人ごとの印。
// ！（赤）=その階で使う予定／△（黄）=後の階のギミックに有効。
// 階を併記したバッジで出し、意味はシート内の凡例が担う。
const DEMAND_MARK_LEGEND = '！: その階で使う予定　△: 後の階で出番がある可能性あり';
function demandMarkBadge(mark) {
  const badge = el('span', `demand-mark demand-mark-${mark.kind}`, mark.text);
  badge.title = mark.label;
  return badge;
}

// ---- 探索の結果の行（ゲームの結果画面の写し取り形） ----
// 結果画面は「探索結果」の見出しの下に箇条書きの文で結果を一括表示
// する。入力も同じ形の行で受け、行の中の数がタップで選べる候補に
// なっている。候補に無い値が画面に出た場合の保険として、行ごとに
// 数入力へ切り替えられる（「別の数」）。ランダムボーナスは追加の行
// として出る／出ないものなので、出た時だけ行を足す形にする。
// hooks.onValidity は数入力の途中（再描画しない間）に、記録ボタンの
// 有効・無効をその場で切り替えるために呼ばれる。
function resultChipRow(line, cb) {
  const row = el('span', 'result-chips');
  for (const c of line.candidates) {
    const btn = el('button', `result-chip${c.selected ? ' selected' : ''}`, c.label);
    btn.dataset.key = c.key;
    btn.addEventListener('click', () => cb.onLineChip(line.kind, c.key));
    row.append(btn);
  }
  return row;
}

function resultNumInput(line, field, value, cb, hooks) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'result-num-input';
  inp.inputMode = 'numeric';
  inp.min = '0';
  if (value != null && value !== '') inp.value = value;
  inp.placeholder = '画面の数';
  inp.addEventListener('input', () => {
    const can = cb.onLineCustomInput(line.kind, field, inp.value, 'input');
    if (hooks && hooks.onValidity) hooks.onValidity(Boolean(can));
  });
  inp.addEventListener('change', () => {
    cb.onLineCustomInput(line.kind, field, inp.value, 'change');
  });
  return inp;
}

// 行の中の数の部分: 候補の並び、または数入力（フォールバック）。
function resultValuePart(line, cb, hooks) {
  const wrap = el('span', 'result-value');
  if (line.customActive) {
    if (line.kind === 'recovery') {
      wrap.append(resultNumInput(line, 'count', line.countValue, cb, hooks));
      wrap.append(el('span', 'result-unit', '体の コンディションが'));
      wrap.append(resultNumInput(line, 'stages', line.stagesValue, cb, hooks));
      wrap.append(el('span', 'result-unit', '段階'));
    } else {
      wrap.append(resultNumInput(line, 'value', line.customValue, cb, hooks));
    }
  } else {
    wrap.append(resultChipRow(line, cb));
  }
  // 候補が無い行（実量表でその箱が null の帯）では、戻る先の候補が
  // 無いため切り替え自体を置かない。
  if (!line.noCandidates) {
    const toggle = el('button', 'result-custom-toggle', line.customActive ? '候補に戻す' : '別の数');
    toggle.addEventListener('click', () => cb.onLineCustomToggle(line.kind));
    wrap.append(toggle);
  }
  return wrap;
}

function resultPickRow(label, chips, onPick) {
  const row = el('div', 'result-pick-row');
  row.append(el('span', 'result-pick-label', label));
  const wrap = el('span', 'result-chips');
  for (const c of chips) {
    const btn = el('button', `result-chip${c.selected ? ' selected' : ''}`, c.label);
    btn.addEventListener('click', () => onPick(c.code));
    wrap.append(btn);
  }
  row.append(wrap);
  return row;
}

function resultLineNode(line, cb, hooks) {
  const node = el('div', `result-line kind-${line.kind}`);
  if (line.kind === 'recovery' && line.styleChips) {
    node.append(resultPickRow('回復したスタイル', line.styleChips, (code) => cb.onLineStyle(code)));
  }
  if (line.kind === 'buffMain' && line.statChips) {
    node.append(resultPickRow('上がったステータス', line.statChips, (code) => cb.onLineStat(code)));
  }
  if (line.kind === 'bonusDmg' && line.dmgTypeChips && typeof cb.onLineDmgType === 'function') {
    node.append(resultPickRow('ダメージの種別', line.dmgTypeChips, (code) => cb.onLineDmgType(code)));
  }
  const sentence = el('p', 'result-sentence');
  sentence.append(el('span', 'result-bullet', '・'));
  if (line.kind === 'power') {
    sentence.append(el('span', null, '塔破力が'));
    sentence.append(resultValuePart(line, cb, hooks));
    sentence.append(el('span', null, '回復した'));
  } else if (line.kind === 'recovery') {
    // ゲームの結果文の形（2026-11-19 13:01 のスクリーンショットで
    // 確定）: 「・{スタイル}のメギド{体数}体の コンディションが
    // {段階}段階回復した。」（句点あり）。
    sentence.append(el('span', null, line.styleName ? `${line.styleName}のメギド` : 'メギド'));
    sentence.append(resultValuePart(line, cb, hooks));
    sentence.append(el('span', null, '回復した。'));
  } else if (line.kind === 'buffMain') {
    // ゲームの結果文の形: 「・{スタイル}の{ステータス}が{数}%上昇」
    // （句点なし、「上がった」ではなく「上昇」）。
    sentence.append(el('span', null, `${line.styleName}の${line.statName || '　'}が`));
    sentence.append(resultValuePart(line, cb, hooks));
    sentence.append(el('span', null, '%上昇'));
  } else if (line.kind === 'bonusDmg') {
    sentence.append(el('span', null, `${line.styleName}の${line.dmgTypeLabel || '単体'}ダメージが`));
    sentence.append(resultValuePart(line, cb, hooks));
    sentence.append(el('span', null, '%上昇'));
  } else if (line.kind === 'bonusPower') {
    sentence.append(el('span', null, '塔破力が'));
    sentence.append(resultValuePart(line, cb, hooks));
    sentence.append(el('span', null, '回復した'));
  }
  node.append(sentence);
  if (line.kind === 'bonusDmg' || line.kind === 'bonusPower') {
    const rm = el('button', 'result-line-remove', 'キャンセル');
    rm.addEventListener('click', () => cb.onBonusRemove(line.kind === 'bonusDmg' ? 'dmg' : 'power'));
    node.append(rm);
  }
  return node;
}

function resultLinesSection(spec, cb, hooks) {
  const sec = section('探索結果');
  const list = el('div', 'result-lines');
  for (const line of spec.lines) list.append(resultLineNode(line, cb, hooks));
  sec.append(list);
  if (spec.bonusAdd && (spec.bonusAdd.dmg || spec.bonusAdd.power)) {
    const row = el('div', 'bonus-add-row');
    if (spec.bonusAdd.dmg) {
      const b = el('button', 'bonus-add-btn', '＋ ダメージ上昇のボーナスが出た');
      b.addEventListener('click', () => cb.onBonusAdd('dmg'));
      row.append(b);
    }
    if (spec.bonusAdd.power) {
      const b = el('button', 'bonus-add-btn', '＋ 塔破力回復のボーナスが出た');
      b.addEventListener('click', () => cb.onBonusAdd('power'));
      row.append(b);
    }
    sec.append(row);
  }
  if (spec.missingText) {
    sec.append(el('p', 'sheet-note result-missing', spec.missingText));
  }
  return sec;
}

export function buildSquareSheet(vm, cb) {
  const content = el('div', 'square-sheet');
  // 数入力の途中で記録系ボタンの有効・無効を切り替えるための参照
  // （内容の組み立てが先、ボタンの組み立てが後になるため、クロージャ
  // 経由で後から結ぶ）。
  let recordBtn = null;
  let fixBtn = null;
  const recordValidity = (can) => { if (recordBtn) recordBtn.disabled = !can; };
  const fixValidity = (can) => { if (fixBtn) fixBtn.disabled = !can; };

  // 結果を直すサブビュー（H2。結果ボタンと同じ形で付け直す）
  if (vm.subView === 'fix' && vm.fix) {
    content.append(el('h2', 'sheet-title', `${vm.title} の結果を直す`));
    content.append(el('p', 'sheet-note', `現在の記録: ${vm.fix.currentText}。実際の結果に合わせて付け直してください。`));
    if (vm.fix.kind === 'battle') {
      const row = el('div', 'box-row');
      for (const [result, label] of [['win', '勝利'], ['lose', '敗北'], ['retreat', 'リタイア']]) {
        const btn = el('button', 'fix-result-btn', label);
        btn.dataset.result = result;
        btn.addEventListener('click', () => cb.onFixResult(result));
        row.append(btn);
      }
      content.append(row);
    } else if (vm.fix.kind === 'explore' && vm.fixSpec) {
      // 付け直しも記録と同じ写し取りの行で聞く（箱の色も標準／多めの
      // ボタンも置かない）。バフマスも同じ形で付け直せる。
      content.append(resultLinesSection(vm.fixSpec, cb, { onValidity: fixValidity }));
      fixBtn = el('button', 'btn-fix-apply', 'この内容で付け直す');
      if (!vm.fixSpec.canRecord) fixBtn.disabled = true;
      fixBtn.addEventListener('click', () => cb.onFixApply());
      content.append(fixBtn);
    }
    const back = el('button', 'btn-back', '戻る');
    back.addEventListener('click', cb.onBack);
    content.append(back);
    return { content, actionBar: null };
  }

  // 履歴のサブビュー（先頭ブロックの「履歴」から開く）
  if (vm.subView === 'history') {
    content.append(el('h2', 'sheet-title', `${vm.title} の履歴`));
    const list = el('div', 'history-list');
    for (const entry of vm.historyEntries) {
      list.append(el('div', `history-row${entry.tone ? ` tone-${entry.tone}` : ''}`, entry.text));
    }
    content.append(list);
    const back = el('button', 'btn-back', '戻る');
    back.addEventListener('click', cb.onBack);
    content.append(back);
    return { content, actionBar: null };
  }

  // 探索マスでは、状態（○F ／ 解放可能など）を見出しの横に置く
  // （2026-11-25 マスター指示。それ以外は従来どおり見出しの下の行）。
  if (vm.mode === 'explore' && vm.stateText) {
    const titleEl = el('h2', 'sheet-title', vm.title);
    titleEl.append(el('span', 'sheet-state-inline', vm.stateText));
    content.append(titleEl);
  } else {
    content.append(el('h2', 'sheet-title', vm.title));
    content.append(el('p', 'sheet-state', vm.stateText));
  }

  // 先頭ブロック: 過去の結果の手渡し（M3。判断の前に出す）
  if (vm.pastSummary) {
    const row = el('div', 'sheet-past');
    row.append(el('span', 'sheet-past-text', vm.pastSummary));
    // 過去編成の再選択（棚卸し 4-14）: 前回そのままの編成が残っていれば、
    // 手渡しの場面からそのまま選び直せる導線を付ける。
    if (vm.pastFormationId && typeof cb.onPastReselect === 'function') {
      const reBtn = el('button', 'btn-past-reselect', '前回の編成で始める');
      reBtn.addEventListener('click', () => cb.onPastReselect(vm.pastFormationId));
      row.append(reBtn);
    }
    if (vm.hasHistory) {
      const histBtn = el('button', 'btn-history', '履歴');
      histBtn.addEventListener('click', cb.onShowHistory);
      row.append(histBtn);
    }
    content.append(row);
  }

  // 未解放のマスの案内（M2）: 事実より先に「どうすれば解放されるか」を出す。
  // 解放に必要な隣接マスはタップでそのマスのシートへ移れる導線にする。
  // 置き場所は冒頭のまま、1行のアコーディオンに畳む（2026-11-26
  // 判断確定・案B）: 既定は閉で見出し行だけが見え、タップで従来の
  // マスボタン群と注記が開く。中身の文面・条件は従来どおり。
  if (vm.unlockGuide) {
    const guide = el('div', 'unlock-guide');
    const guideOpen = Boolean(vm.unlockGuide.open);
    const guideToggle = el('button', `unlock-guide-toggle${guideOpen ? ' open' : ''}`,
      '解放するには、下のマスを解放する');
    guideToggle.addEventListener('click', () => {
      if (typeof cb.onUnlockGuideToggle === 'function') cb.onUnlockGuideToggle();
    });
    guide.append(guideToggle);
    if (guideOpen) {
      for (const step of vm.unlockGuide.steps) {
        const btn = el('button', 'unlock-guide-row', step.text);
        btn.dataset.squareId = step.squareId;
        if (typeof cb.onOpenSquareGuide === 'function') {
          btn.addEventListener('click', () => cb.onOpenSquareGuide(step.squareId));
        }
        guide.append(btn);
      }
      if (vm.unlockGuide.bossPathText) {
        guide.append(el('p', 'unlock-guide-note', vm.unlockGuide.bossPathText));
      }
    }
    content.append(guide);
  }

  // 先頭ブロック: 探索マスは「結果の言葉」を1文大きく出す（仕様の
  // ラベル表は頭に置かない）。それ以外は報酬とコストの並置（M3）。
  if (vm.headResult) {
    content.append(el('p', 'sheet-head-result', vm.headResult));
  }
  if (vm.headRows && vm.headRows.length > 0) {
    const head = el('div', 'sheet-head');
    for (const row of vm.headRows) {
      const line = el('div', 'sheet-head-row');
      line.append(el('span', 'sheet-head-label', row.label));
      line.append(el('span', 'sheet-head-text', row.text));
      head.append(line);
    }
    content.append(head);
  }
  for (const note of vm.notes) content.append(el('p', 'sheet-note', note));

  // 塔効果の蓄積（バフマス）: 蓄積が多ければ「ここは踏まない」が選択に
  // なるため、蓄積状況は踏む／踏まないの判断材料として頭の判断領域に
  // 置く（2026-11-19 ユーザー指摘）。上限への近さが分かる形で出し、
  // 空の状態でも位置は同じ。
  if (vm.buff) {
    const sec = section(`既に付与されている塔効果（${vm.buff.styleLabel}）`);
    for (const line of vm.buff.gainLines) sec.append(el('p', 'plan-member', line));
    if (vm.buff.bonusLine) sec.append(el('p', 'plan-member', vm.buff.bonusLine));
    for (const line of vm.buff.totalLines) sec.append(el('p', 'plan-total', line));
    for (const note of vm.buff.cappedNotes) sec.append(el('p', 'sheet-note', note));
    if (vm.buff.gainLines.length === 0 && vm.buff.totalLines.length === 0) {
      sec.append(el('p', 'sheet-note', 'まだ付いていません。'));
    }
    content.append(sec);
  }

  // 値打ちの判定（M3・拡張1）: 取得量の見込み（能力上昇マス）と
  // 判断材料を置き、割に合わないと導出できる場合だけ判定文を出す。
  // 戦闘マスでは「勝つと開く能力上昇マス」の材料行が来る。
  if (vm.worth) {
    const sec = section('期待度と効果の関係');
    for (const line of vm.worth.outlookLines) sec.append(el('p', 'worth-outlook', line));
    for (const line of vm.worth.noteLines) sec.append(el('p', 'sheet-note', line));
    if (vm.worth.verdict) sec.append(el('p', 'worth-verdict', vm.worth.verdict));
    content.append(sec);
  }

  // 結果を直す入口（H2）: 結果のあるマスに出す
  if (vm.canFix) {
    const fixBtn = el('button', 'btn-fix', '結果を直す');
    fixBtn.addEventListener('click', cb.onShowFix);
    content.append(fixBtn);
  }

  // 敵自身の情報（M2）: 対策の材料（counter）が揃っている戦闘マス
  // では、下の「敵」節（SW91 の積み順）にステータス系として畳む。
  // 材料が無い場合だけ、従来の全文の形で出す（並びはゲームの敵
  // 詳細に揃える: 名前 → ステータス → 特性 → 種族 → 技能）。
  if (vm.enemyDetails && !vm.counter) {
    const sec = section('敵の情報');
    for (const rule of vm.enemyDetails.rules) {
      sec.append(el('p', 'sheet-note', `ルール: ${rule}`));
    }
    for (const e of vm.enemyDetails.enemies) {
      const block = el('div', 'enemy-block');
      block.append(el('div', 'enemy-name', e.style ? `${e.name}（${e.style}／${e.className}）` : e.name));
      if (e.statLines && e.statLines.length > 0) block.append(enemyStatLinesNode(e.statLines));
      else if (e.statsText) block.append(el('p', 'enemy-stats', e.statsText));
      if (e.trait) block.append(el('p', 'sheet-note', `特性: ${e.trait}`));
      if (e.raceText) block.append(el('p', 'sheet-note', `種族: ${e.raceText}`));
      for (const s of e.skills || []) {
        block.append(el('p', 'sheet-note', `${s.label}: ${s.text}`));
      }
      if (!e.hasInfo) block.append(el('p', 'sheet-note', 'この敵の情報はデータにありません。'));
      sec.append(block);
    }
    content.append(sec);
  }

  // 敵（SW91 の積み順）: 敵の名前（主役）→ ステータス系 → 簡単な
  // 説明 → 攻略のポイント → 耐性（アコーディオン）。攻略情報の
  // 本文（原文）はシートに出さない: ポイントの本文が、統合の
  // 答えブロックと著述の対・全体をこの形に描いたものになる。
  // 1マスに複数種が出る場合は種タブで切り替え、選択中の敵だけを
  // 出す。候補は本体能力・専用霊宝・オーブ・マスエフェクト由来。
  // 導出の材料はポイントの節の末尾に必ず出す。
  if (vm.counter) {
    const sec = section('敵');
    for (const rule of (vm.enemyDetails ? vm.enemyDetails.rules : [])) {
      sec.append(el('p', 'sheet-note', `ルール: ${rule}`));
    }
    const enemies = vm.counter.enemies || [];
    const activeName = vm.counter.enemyTab
      || (enemies.length > 0 ? enemies[0].name : null);
    if (enemies.length > 1) {
      const tabs = el('div', 'enemy-tabs');
      for (const e of enemies) {
        const btn = el('button', `enemy-tab${e.name === activeName ? ' selected' : ''}`, e.name);
        btn.addEventListener('click', () => { if (cb.onEnemyTab) cb.onEnemyTab(e.name); });
        tabs.append(btn);
      }
      sec.append(tabs);
    }
    const detailsBySpecies = new Map(
      ((vm.enemyDetails && vm.enemyDetails.bySpecies) || []).map((g) => [g.name, g.members]));
    for (const e of enemies) {
      if (enemies.length > 1 && e.name !== activeName) continue;
      const block = el('div', 'enemy-block');
      block.append(el('div', 'enemy-name sheet-enemy-name', e.name));
      // ステータス系: 構成員ごとに、名前・スタイル／クラス・
      // ステータス・種族。特性と技能の全文は、簡単な説明と
      // ポイントに畳んだためここには出さない。
      const members = detailsBySpecies.get(e.name) || [];
      for (const m of members) {
        if (members.length > 1 || m.name !== e.name) {
          block.append(el('div', 'enemy-member-name',
            m.style ? `${m.name}（${m.style}／${m.className}）` : m.name));
        }
        if (m.statLines && m.statLines.length > 0) block.append(enemyStatLinesNode(m.statLines));
        else if (m.statsText) block.append(el('p', 'enemy-stats', m.statsText));
        if (m.raceText) block.append(el('p', 'sheet-note', `種族: ${m.raceText}`));
        if (!m.hasInfo) block.append(el('p', 'sheet-note', 'この敵の情報はデータにありません。'));
      }
      if (members.length === 0 && e.raceText) {
        block.append(el('p', 'sheet-note', `種族: ${e.raceText}`));
      }
      // 簡単な説明（導出の脅威から組み立てた1〜2行）。
      if (e.summary) block.append(el('p', 'sheet-enemy-summary', e.summary));
      // 敵単位の修飾軸の注記（SW95 便3）: 出現・取り巻き・素早さ。
      for (const note of e.unitNotes || []) {
        block.append(el('p', 'sheet-note', note));
      }
      // 敵が持つ仕組み・著述に載る仕組みへの1行（著述の側に寄せる）。
      for (const note of e.mechanicNotes || []) {
        block.append(el('p', 'mech-note', note));
      }
      // かばう／執心の受け方の対応（敵の攻撃構成から計算した行）。
      for (const note of e.receivingNotes || []) {
        block.append(el('p', 'mech-note', note));
      }
      if (!e.hasTexts) {
        block.append(el('p', 'sheet-note', 'この敵の能力はデータにないため、種族と耐性から分かる範囲だけを表示しています。'));
      }
      // 攻略のポイント: ◇＋短い小タイトルを行ラベルにした
      // アコーディオン（既定は閉。開閉はシートを閉じるまで保つ）。
      if ((e.points || []).length > 0) {
        // 構成員が複数いる種（本体＋取り巻き）では、ポイントが種
        // 全体のものであることを見出しで示す（2026-11-26 ペルソナ
        // 検品）: 付けないと、直前の構成員（取り巻き）のステータス
        // ブロックの続きに見え、その取り巻きのポイントと取り違える。
        block.append(el('div', 'authored-title',
          members.length > 1 ? `攻略のポイント（${e.name}）` : '攻略のポイント'));
        if (e.pointsNote) block.append(el('p', 'sheet-note', e.pointsNote));
        e.points.forEach((p, i) => {
          const row = el('div', 'point-row');
          const open = Boolean(e.pointsOpen && e.pointsOpen[i]);
          const toggle = el('button', `point-toggle${open ? ' open' : ''}`,
            `◇${p.title}`);
          toggle.addEventListener('click', () => {
            if (cb.onPointToggle) cb.onPointToggle(e.name, i);
          });
          row.append(toggle);
          if (open) row.append(pointBodyNode(p));
          block.append(row);
        });
      }
      // 弱点・無効の要約（種ごと）。色は評価の役割で付ける:
      // 弱点 = こちらに良い = 赤、無効 = こちらに悪い = 青
      // （2026-11-26 判断。旧: 弱点は期待度1の緑、無効はグレーで、
      // どちらも役割とずれていた）。出所の添え書きと記号の
      // 読み方の行は同判断で廃止した。
      if (e.weakText) block.append(el('p', 'counter-weak', `弱点（◎）: ${e.weakText}`));
      if (e.immuneText) block.append(el('p', 'counter-immune', `無効: ${e.immuneText}`));
      sec.append(block);
    }
    // 耐性一覧（2026-11-26 判断）: マス単位で1つの表。行 = 状態
    // 異常・効果の項目、列 = 敵（本体＋取り巻き）。セルは記号
    // だけ（段階の名前は画面に出さない）。記号の色は要約行と
    // 同じ役割: ◎ = 赤、△・×・無効 = 青、○ = 無色。アコーディ
    // オンの既定は閉、開閉はシート単位で保持する。
    if (vm.counter.resistTable) {
      const rt = vm.counter.resistTable;
      const toggle = el('button', `resist-toggle${rt.open ? ' open' : ''}`, '耐性一覧');
      toggle.addEventListener('click', () => { if (cb.onResistTableToggle) cb.onResistTableToggle(); });
      sec.append(toggle);
      if (rt.open) {
        const table = el('table', 'resist-table');
        const thead = el('thead');
        const htr = el('tr');
        htr.append(el('th', 'resist-corner', ''));
        for (const name of rt.columns) htr.append(el('th', 'resist-col-name', name));
        thead.append(htr);
        table.append(thead);
        const tbody = el('tbody');
        for (const row of rt.rows) {
          const tr = el('tr');
          tr.append(el('th', 'resist-row-name', row.name));
          for (const cellText of row.cells) {
            const cls = cellText === '◎' ? 'resist-sym resist-sym-weak'
              : (cellText === '△' || cellText === '×' || cellText === '無効')
                ? 'resist-sym resist-sym-bad' : 'resist-sym';
            tr.append(el('td', cls, cellText));
          }
          tbody.append(tr);
        }
        table.append(tbody);
        sec.append(table);
      }
    }
    for (const w of vm.counter.demandWarnings || []) {
      sec.append(el('p', 'demand-warn', w));
    }
    sec.append(el('p', 'sheet-note', CANDIDATE_SOURCE_NOTE));
    content.append(sec);
  }

  // 開始前の確認（M8）: 5枠を位置どおりに描く。確認のタップは置かない。
  if (vm.confirmation) {
    const sec = section(`開始前の確認: ${vm.confirmation.formationName}`);
    const grid = el('div', 'slot-grid');
    for (const slot of vm.confirmation.slots) {
      const cell = el('div', `slot-cell${slot.isLeader ? ' leader' : ''}`);
      cell.append(el('div', 'slot-pos', slot.label));
      // 顔アイコンは「ゲームと一緒」の確信の材料（棚卸し 10-6）。
      // スタイル×クラスの複合アイコンは顔の右下のバッジに重ねる
      // （5体横一列の枠ではアイコンの行を取れない。2026-11-20。
      // 確認枠ではクラスはこのアイコンが担うため、必ず残す）。
      if (slot.name) cell.append(faceWithStyleClassBadge(slot.name, slot.style, slot.className));
      cell.append(el('div', 'slot-name fit-x', slot.name || '（空き）'));
      if (slot.style) {
        const styleLine = el('div', 'slot-style');
        styleLine.append(styleChip(slot.style));
        cell.append(styleLine);
      }
      // 実効素早さの数値（補正込み・内訳つき。編成エディタの枠と
      // 同じ形。2026-11-19 調整フライトで追加）。
      if (slot.spdText) {
        const spdLine = el('div', 'slot-spd', slot.spdText);
        if (Array.isArray(slot.spdParts) && slot.spdParts.length > 0) {
          spdLine.append(slotSpdDetailNode(slot.spdParts));
        } else if (slot.spdDetail) {
          spdLine.append(el('span', 'slot-spd-detail', slot.spdDetail));
        }
        cell.append(spdLine);
      }
      cell.append(el('div', 'slot-orb fit-x', slot.orbText));
      // 塔効果バフの反映（M8）: このメンバーのスタイルに効いている
      // 蓄積を枠の中に出す。蓄積が無いスタイルでは行自体が無い。
      if (slot.buffText) cell.append(el('div', 'slot-buff fit-x', `塔効果: ${slot.buffText}`));
      // 霊宝の表示（2026-11-19 圧縮形）: 個数＋専用印＋素早さ分
      // だけ。名前の全列挙はしない（編成エディタの枠と同じ形）。
      if (slot.reishouSummary) cell.append(reishouSummaryNode(slot.reishouSummary));
      grid.append(cell);
    }
    sec.append(grid);
    // リーダーの ME の要約（M8）。全272体分が収録済み。
    if (vm.confirmation.meName) {
      sec.append(el('p', 'confirm-me', `マスエフェクト: ${vm.confirmation.meName}`));
      if (vm.confirmation.meSummary) {
        sec.append(el('p', 'sheet-note', vm.confirmation.meSummary));
      }
    } else if (vm.confirmation.meMissing) {
      sec.append(el('p', 'sheet-note', 'マスエフェクト: 未収録'));
    }
    // 素早さの敵比較（最終チェック、2026-11-19）: そのマスの敵最速と
    // 比べて、先手を取れる味方と同速の味方を出す。詳しい付け替えの
    // 判断は編成エディタ側（オーブ選択）で行う前提の、最小限の要約。
    // 結論を先に置く（全体構成 問題14、2026-11-27）: 先手を取れる
    // 味方が主役で、敵最速の数値は材料として後ろに添える。
    // 見た目（問題14の残り・見た目分）: 節見出しは帯、結論行は
    // 見出し段で太く大きく、敵最速の数値は材料として一段落とす。
    if (vm.confirmation.spdSummary) {
      const s = vm.confirmation.spdSummary;
      sec.append(el('h4', 'est-heading', '素早さ'));
      sec.append(el('p', 'confirm-spd-line est-conclusion', s.aheadNames.length > 0
        ? `先手: ${s.aheadNames.join('・')}（${s.aheadNames.length}人）`
        : '先手を取れる味方はいない'));
      if (s.tiedNames.length > 0) {
        sec.append(el('p', 'confirm-spd-line', `同速: ${s.tiedNames.join('・')}`));
      }
      sec.append(el('p', 'confirm-spd-line est-material', enemyFastestText(s)));
    }
    // 受けダメージの見積もり（積4、2026-11-20）: 選んだ編成の
    // 下に、候補の敵ごとに、素で受けて落ちる味方だけを出す。
    // 結論（落ちる味方／一撃で落ちる味方はいない）を先に置き、
    // 「対象:」の反復は消す（全体構成 問題14、2026-11-27）。敵が
    // 複数いる時だけ、帰属のために敵名を1回だけ静かに出す。前提は
    // 両見積もり節の末尾に統合して1回だけ置く（この節の後ろ）。
    if (vm.confirmation.damageEstimate) {
      const est = vm.confirmation.damageEstimate;
      sec.append(el('h4', 'est-heading', '危険行動に対する見積もり'));
      for (const block of est.blocks) {
        if (est.blocks.length > 1) {
          sec.append(el('p', 'sheet-note', block.enemyName));
        }
        if (!block.attacksRead) {
          sec.append(el('p', 'sheet-note', '敵の攻撃が文面から読めなかったため、この見積もりは出せない'));
        } else if (block.falls.length === 0) {
          sec.append(el('p', 'confirm-spd-line est-conclusion', '一撃で落ちる味方はいない（見込み）'));
          for (const line of damageEstimateSafeLines(block)) {
            sec.append(estimateMaterialNode(line));
          }
        } else {
          for (const fall of block.falls) {
            sec.append(el('p', 'confirm-spd-line est-conclusion', `${fall.allyName}が落ちる見込み（HP${fall.hp}）`));
            for (const hit of fall.hits) {
              sec.append(estimateMaterialNode(damageEstimateHitText(hit)));
            }
          }
        }
      }
    }
    // 攻撃の見積もり（A5 改訂、2026-11-26）: 選んだ編成の味方が
    // 敵にどれだけ通るか。表示は選択式で、選んだ1人分だけを出す
    // （初期表示は見積もりが一番大きい味方。VM 側で選ばれる）。
    // 「対象:」の反復と、対象ごとの防御・HP（敵の節で出す値）の
    // 反復は消す（全体構成 問題14、2026-11-27）。前提は両見積もり
    // 節の末尾に統合して1回だけ置く（この節の後ろ）。
    if (vm.confirmation.outgoingEstimate) {
      const oe = vm.confirmation.outgoingEstimate;
      sec.append(el('h4', 'est-heading', '攻撃の見積もり'));
      const chips = el('div', 'outgoing-chips');
      for (const m of oe.members) {
        const btn = el('button', `outgoing-chip${oe.selected && m.id === oe.selected.id ? ' selected' : ''}`, m.name);
        btn.addEventListener('click', () => {
          if (cb.onOutgoingSelect) cb.onOutgoingSelect(m.id);
        });
        chips.append(btn);
      }
      sec.append(chips);
      const sel = oe.selected;
      if (sel) {
        if (sel.noDamageAbility) {
          sec.append(el('p', 'sheet-note', 'ダメージのある技が無い'));
        } else if (!sel.attacksRead) {
          sec.append(el('p', 'sheet-note', '計算できる攻撃が文面から読めなかったため、この味方の見積もりは出せない'));
        } else {
          for (const section of sel.sections) {
            for (const t of section.targets) {
              sec.append(el('p', 'est-target', t.enemyName));
              for (const line of t.lines) {
                sec.append(outgoingEstimateRowNode(line, t.hp, sel.name));
              }
            }
          }
        }
      }
    }
    // 見積もりの前提（全体構成 問題14、2026-11-27）: 危険行動・
    // 攻撃の両節を通した前提を、末尾に1回だけ置く（統合文は
    // main.js の sheetEstimatePremise が両節の有無に応じて組む）。
    // 見た目は注記の格（ラベル段）に落とす（問題14の残り・見た目分）。
    if (vm.confirmation.estimatePremise) {
      sec.append(el('p', 'sheet-note est-premise', vm.confirmation.estimatePremise));
    }
    const actions = el('div', 'confirm-actions');
    const reselect = el('button', 'btn-reselect', '選び直す');
    reselect.addEventListener('click', cb.onReselect);
    actions.append(reselect);
    // 選び直すの横に、その編成のエディタを直接開く操作を置く
    // （2026-11-19 ユーザー要望）。
    const editBtn = el('button', 'btn-edit-formation', '編成を編集する');
    if (typeof cb.onEditFormation === 'function') {
      editBtn.addEventListener('click', cb.onEditFormation);
    }
    actions.append(editBtn);
    sec.append(actions);
    content.append(sec);
  }

  // タイムライン（SW91）: 選んだ編成の下に常時表示。
  if (vm.timeline) {
    content.append(sheetTimelineNode(vm.timeline));
  }

  // シミュレーターのチップ（SW91）: 対応するものだけ。
  if (vm.sims && vm.sims.length > 0) {
    content.append(sheetSimsNode(vm.sims, cb));
  }

  // 諦める・戦い直す（M11）: 過去の結果とコストの差
  if (vm.m11) {
    const sec = section('これまでの結果と、戦い直すコスト');
    for (const line of vm.m11.pastLines) sec.append(el('p', '', line));
    for (const line of vm.m11.costLines) sec.append(el('p', 'sheet-note', line));
    content.append(sec);
  }

  // 探索の目安（M7）: 並びは現行ツールの順に統合する（2026-11-18
  // 23:52–23:54、2つのエミュレーションの対照による目標形）。
  //   目標（大きな色つき数字＋報酬）→ おすすめ転記（1入力）→
  //   大きなおまかせボタン → 候補は「ユーザーが頼んだ結果」として出す →
  //   手動の枠はその下の例外路。
  // 候補が唐突でなくなるのは、並びが「頼む→返ってくる」の順だから。
  // 一覧を入口に出さない（情報の雪崩）。1節に主役は1つ: 主役の操作は
  // 大きく彩度の高いボタン、それ以外は静かに落とす。生成の中身は
  // 新ツール側（需要・予定の回避、コンディション、おすすめ補正込み）。
  if (vm.explorePlan) {
    const plan = vm.explorePlan;
    const sec = section('探索の目安');

    // 1. 目標: 期待度ごとの「必要な合計（大きな色付き数字）→ 報酬」。
    // 現在の期待度の段だけを強調する。
    if (Array.isArray(plan.strip) && plan.strip.length > 0) {
      const strip = el('div', 'plan-strip');
      for (const cell of plan.strip) {
        const cellEl = el('div', `plan-exp exp-${cell.expectation}${cell.expectation === plan.expectation ? ' current' : ''}`);
        cellEl.append(el('div', 'plan-exp-label', `期待度${cell.expectation}`));
        // 結論数字は40px（問題7・9）。接尾辞（未満）は数字ではない
        // ので見出し段（24px）に落とす（版155: 40pxのままでは
        // セルの中で接尾辞だけが大きい2行目になっていた）。
        const numEl = el('div', 'plan-exp-num');
        const needMatch = /^(\d+)(.*)$/.exec(cell.needText || '');
        if (needMatch && needMatch[2]) {
          numEl.append(el('span', null, needMatch[1]));
          numEl.append(el('span', 'plan-exp-suffix', needMatch[2]));
        } else {
          numEl.textContent = cell.needText;
        }
        cellEl.append(numEl);
        if (cell.rewardText) {
          cellEl.append(el('div', `plan-exp-reward${cell.expectation === plan.expectation ? ' plan-outlook' : ''}`, cell.rewardText));
        }
        if (cell.rewardNote) {
          cellEl.append(el('div', 'plan-exp-reward-note', cell.rewardNote));
        }
        strip.append(cellEl);
      }
      sec.append(strip);
    }
    // 2. オススメの転記（1入力）: ゲーム画面の表示を写す機械的な入力。
    // 前提ラベルは「計算中」の言い方ではなく、現在の転記値の提示＋
    // 操作の言葉で出す（2026-11-19 ユーザー指定）。
    if (plan.osusume) {
      const osu = el('div', 'osusume-block');
      osu.append(el('div', 'osusume-title',
        'ゲーム内に表示されているオススメスタイルまたはクラスを選択してください'));
      const styleRow = el('div', 'osusume-row');
      styleRow.append(el('span', 'osusume-row-label', 'スタイル'));
      for (const s of ['ラッシュ', 'カウンター', 'バースト']) {
        const chip = el('button', `osu-chip${plan.osusume.style === s ? ' active' : ''}`);
        // スタイル図形のアイコンを主役に添える。文字は従来どおり残し、
        // 選択状態の見せ方（金の地）も変えない（ファン素材の試し入れ）。
        const sIcon = styleIconImg(s, 'ui-icon osu-chip-icon');
        if (sIcon) chip.append(sIcon);
        chip.append(el('span', 'osu-chip-label', s));
        chip.dataset.osusumeStyle = s;
        if (typeof cb.onOsusumeStyle === 'function') {
          chip.addEventListener('click', () => cb.onOsusumeStyle(s));
        }
        styleRow.append(chip);
      }
      osu.append(styleRow);
      const classRow = el('div', 'osusume-row');
      classRow.append(el('span', 'osusume-row-label', 'クラス'));
      for (const c of ['ファイター', 'トルーパー', 'スナイパー']) {
        const chip = el('button', `osu-chip${plan.osusume.className === c ? ' active' : ''}`);
        // クラスの武器アイコンを添える（スタイルチップと同じ形）。
        const cIcon = classIconImg(c, 'ui-icon osu-chip-icon');
        if (cIcon) chip.append(cIcon);
        chip.append(el('span', 'osu-chip-label', c));
        chip.dataset.osusumeClass = c;
        if (typeof cb.onOsusumeClass === 'function') {
          chip.addEventListener('click', () => cb.onOsusumeClass(c));
        }
        classRow.append(chip);
      }
      osu.append(classRow);
      // 状態の表示と解除の操作（2026-11-19 ユーザー補正）: 「選ばない」
      // という能動的な選択肢チップは置かない。初期状態は状態表示の
      // 「未選択」。何か選ばれている間は、値1つだけを文で出し（「です」
      // で終わる）、解除は「キャンセル」の操作でニュートラルに戻す。
      // 戻れば表示は「未選択」に戻る。
      const stateRow = el('div', 'osusume-state');
      if (plan.osusume.active) {
        const value = plan.osusume.style || plan.osusume.className;
        stateRow.append(el('span', 'osusume-value', `オススメメギドは『${value}』です`));
        const cancelBtn = el('button', 'osu-cancel', 'キャンセル');
        cancelBtn.dataset.osusumeCancel = '1';
        if (typeof cb.onOsusumeCancel === 'function') {
          cancelBtn.addEventListener('click', () => cb.onOsusumeCancel());
        }
        stateRow.append(cancelBtn);
      } else {
        stateRow.append(el('span', 'osusume-value osusume-unselected', '未選択'));
      }
      osu.append(stateRow);
      sec.append(osu);
    }

    // 候補（おまかせを頼んだ結果として出す）: 開いた時だけ並ぶ。
    // 需要の印の凡例は、印が出た場所（候補か枠か）で1回だけ出す。
    let demandLegendShown = false;
    const renderFillCandidates = () => {
      const wrap = el('div', 'plan-fill');
      const fillExp = (plan.candidates && plan.candidates[0] && plan.candidates[0].expectation)
        || plan.expectation;
      const fillExpFw = String(fillExp).replace(/[0-9]/g, (d) => '０１２３４５６７８９'[Number(d)]);
      wrap.append(el('p', 'sheet-note',
        `期待度${fillExpFw}になる組み合わせの一部を自動で算出しました。タップで選択してください。`));
      for (const cand of plan.candidates || []) {
        const btn = el('button', 'plan-cand-btn');
        btn.dataset.candidate = cand.ids.join(',');
        const head = el('span', 'plan-cand-head',
          `合計 ${cand.totalText}／期待度${cand.expectation}`);
        btn.append(head);
        for (const m of cand.members) {
          const line = el('span', 'plan-cand-member');
          line.append(faceIconImg(m.name));
          line.append(styleChip(m.style));
          line.append(el('span', 'plan-cand-name', ` ${m.name}`));
          if (m.demandMark) line.append(demandMarkBadge(m.demandMark));
          appendOsusumeMarks(line, m);
          btn.append(line);
          if (m.powerText) {
            btn.append(el('span', 'plan-member-facts',
              `探索力 ${m.powerText}／${m.stageLabel}→探索後 ${m.afterStageLabel}`));
          }
          if (m.reishouText) btn.append(el('span', 'plan-member-facts', m.reishouText));
          if (m.planText) btn.append(el('span', 'plan-member-facts', m.planText));
        }
        if (cand.metaText) btn.append(el('span', 'plan-cand-meta', cand.metaText));
        btn.addEventListener('click', () => cb.onExplorePickCandidate(cand.ids));
        wrap.append(btn);
      }
      // 凡例: 印が1つでも出たら、その場で意味が分かるように付ける。
      if ((plan.candidates || []).some((c) => (c.members || []).some((m) => m.demandMark))) {
        wrap.append(el('p', 'plan-demand-legend', DEMAND_MARK_LEGEND));
        demandLegendShown = true;
      }
      const closeBtn = el('button', 'btn-explore-fill-close', '候補を閉じる');
      if (typeof cb.onExploreFillClose === 'function') {
        closeBtn.addEventListener('click', cb.onExploreFillClose);
      }
      wrap.append(closeBtn);
      return wrap;
    };

    // 3. 大きなおまかせボタン（この節の主役）。押した結果として候補が出る。
    if (Array.isArray(plan.slots) || Array.isArray(plan.members)) {
      if (plan.hasCandidates && !plan.fillOpen && typeof cb.onExploreFillOpen === 'function') {
        const omakase = el('button', 'btn-omakase', '探索パーティを自動編成');
        omakase.addEventListener('click', cb.onExploreFillOpen);
        sec.append(omakase);
      }
      if (plan.fillOpen) sec.append(renderFillCandidates());
    }

    // 4. 手動の枠（例外路）: 今の合計と期待度がその場で反応する。
    if (plan.heroTotal != null) {
      const hero = el('div', 'plan-total-big plan-hero');
      hero.append(el('span', 'plan-hero-label', '合計探索力'));
      hero.append(el('span', `plan-hero-num expc-${plan.expectation}`, String(plan.heroTotal)));
      hero.append(el('span', `plan-hero-exp expc-${plan.expectation}`, `期待度${plan.expectation}`));
      if (!plan.reached && plan.heroTarget != null) {
        hero.append(el('span', 'plan-hero-need', `期待度3には ${plan.heroTarget} が必要`));
      }
      sec.append(hero);
      if (plan.outlookText) sec.append(el('p', 'plan-outlook', plan.outlookText));
      if (plan.outlookNote) sec.append(el('p', 'plan-outlook-note', plan.outlookNote));
    } else if (plan.totalText) {
      sec.append(el('p', 'plan-total-big', plan.totalText));
      if (plan.outlookText) sec.append(el('p', 'plan-outlook', plan.outlookText));
      if (plan.outlookNote) sec.append(el('p', 'plan-outlook-note', plan.outlookNote));
    }

    // 前回の探索メンバー: メンバーを選ぶ場所（枠）のすぐ上に返す。
    // 同じメンバーをもう一度出す判断にも、「出して苦戦した」という
    // 思い出しのヒントにもなる。頭の手渡しとはメンバー名を二重に
    // 出さない（main 側で頭を名前なしに整理済み）。
    if (plan.pastMembers && plan.pastMembers.members.length > 0) {
      const past = plan.pastMembers;
      const wrap = el('div', 'plan-past');
      const when = past.runLabel ? `前回（${past.runLabel}）` : '前回';
      wrap.append(el('div', 'plan-past-label', past.sameSquare
        ? `${when}このマスに出したメンバー（${past.effectLabel}）`
        : `${when}の探索で出したメンバー（別のマス・${past.effectLabel}）`));
      const row = el('div', 'plan-past-row');
      for (const m of past.members) {
        const chip = el('span', 'plan-past-member');
        chip.append(faceIconImg(m.name));
        if (m.style) chip.append(styleChip(m.style));
        chip.append(el('span', 'plan-past-name', m.name));
        row.append(chip);
      }
      wrap.append(row);
      sec.append(wrap);
    }

    if (Array.isArray(plan.slots)) {
      // 枠の並び: 入っている枠はメンバーの事情、空の枠は入れる操作。
      const slotsWrap = el('div', 'plan-slots');
      plan.slots.forEach((slot, i) => {
        if (slot.filled && slot.member) {
          const m = slot.member;
          const btn = el('button', 'plan-slot-btn filled plan-member-btn');
          btn.dataset.megidoId = m.id;
          btn.dataset.slotIndex = String(i);
          btn.append(faceIconImg(m.name));
          btn.append(styleChip(m.style));
          const line = el('span', 'plan-member-line');
          line.append(el('span', 'plan-member-name', m.name));
          if (m.demandMark) line.append(demandMarkBadge(m.demandMark));
          appendOsusumeMarks(line, m, true);
          if (m.powerText) {
            const meta = el('span', 'plan-member-meta',
              `探索力 ${m.powerText}／`);
            meta.append(el('span', `sc-${m.stage}`, `${m.stageLabel}→探索後 ${m.afterStageLabel}`));
            line.append(meta);
          }
          if (m.reishouText) line.append(el('span', 'plan-member-facts', m.reishouText));
          if (m.planText) line.append(el('span', 'plan-member-facts', m.planText));
          btn.append(line);
          btn.append(el('span', 'plan-member-hint', '入れ替え ›'));
          btn.addEventListener('click', () => cb.onExploreMemberTap(m.id));
          slotsWrap.append(btn);
        } else {
          const btn = el('button', 'plan-slot-btn empty');
          btn.dataset.slotIndex = String(i);
          btn.append(el('span', 'plan-slot-empty-text', '＋ メンバーを入れる'));
          if (typeof cb.onExploreAdd === 'function') {
            btn.addEventListener('click', cb.onExploreAdd);
          }
          slotsWrap.append(btn);
        }
      });
      sec.append(slotsWrap);
      // 並走の警告: 入れたメンバーがこの先で必要になる者なら、その場で出す。
      for (const w of plan.warnings || []) {
        sec.append(el('p', 'plan-warn', w));
      }
      // 需要の印の凡例: 候補側で出ていない場合だけ、枠の印の分を出す。
      if (!demandLegendShown
        && plan.slots.some((s) => s.filled && s.member && s.member.demandMark)) {
        sec.append(el('p', 'plan-demand-legend', DEMAND_MARK_LEGEND));
      }
      const changeRow = el('div', 'plan-change-row');
      if (plan.customized && typeof cb.onExploreReset === 'function') {
        const resetBtn = el('button', 'btn-explore-reset', '選んだ候補に戻す');
        resetBtn.addEventListener('click', cb.onExploreReset);
        changeRow.append(resetBtn);
      }
      if (plan.memberCount > 0 && typeof cb.onExploreClear === 'function') {
        const clearBtn = el('button', 'btn-explore-reset', '枠を空にする');
        clearBtn.addEventListener('click', cb.onExploreClear);
        changeRow.append(clearBtn);
      }
      if (changeRow.children.length > 0) sec.append(changeRow);
    } else if (Array.isArray(plan.members)) {
      // 枠情報を持たないビューモデル（テスト等）向けの従来形。
      if (plan.members.length === 0) {
        sec.append(el('p', 'sheet-note', 'メンバーがいません。下の「メンバーを追加」から選んでください。'));
      }
      for (const m of plan.members) {
        const btn = el('button', 'plan-member-btn');
        btn.dataset.megidoId = m.id;
        if (m.name) {
          btn.append(styleChip(m.style));
          const line = el('span', 'plan-member-line');
          line.append(el('span', 'plan-member-name', m.name));
          const meta = el('span', 'plan-member-meta', `探索力 ${m.powerText}／`);
          meta.append(el('span', `sc-${m.stage}`, m.stageLabel));
          line.append(meta);
          btn.append(line);
        } else {
          btn.append(el('span', 'plan-member-line', m.line));
        }
        btn.append(el('span', 'plan-member-hint', '入れ替え ›'));
        btn.addEventListener('click', () => cb.onExploreMemberTap(m.id));
        sec.append(btn);
      }
      const changeRow = el('div', 'plan-change-row');
      if (plan.canAdd) {
        const addBtn = el('button', 'btn-explore-add', 'メンバーを追加');
        addBtn.addEventListener('click', cb.onExploreAdd);
        changeRow.append(addBtn);
      }
      if (plan.customized) {
        const resetBtn = el('button', 'btn-explore-reset', '選んだ候補に戻す');
        resetBtn.addEventListener('click', cb.onExploreReset);
        changeRow.append(resetBtn);
      }
      if (changeRow.children.length > 0) sec.append(changeRow);
      sec.append(el('p', 'sheet-note', 'メンバーをタップすると入れ替えできます。'));
    } else {
      for (const line of plan.memberLines) sec.append(el('p', 'plan-member', line));
    }
    if (plan.note) sec.append(el('p', 'sheet-note', plan.note));
    content.append(sec);
  }

  // 探索の結果の入力（ゲームの結果画面の写し取り形）: 結果画面に
  // 出た行を、ゲームの文の形のまま写す。行の中の数は候補から選ぶのが
  // 基本で、選ぶだけでは記録しない（記録は下部バーの「これで探索を
  // 記録する」だけ）。
  if (vm.resultSpec) {
    content.append(resultLinesSection(vm.resultSpec, cb, { onValidity: recordValidity }));
  }


  // 回復の結果と境界の確認（M9）
  if (vm.recovery) {
    const sec = section('回復の結果');
    for (const line of vm.recovery.recoveredLines) sec.append(el('p', 'recovered-row', line));
    if (vm.recovery.recoveredLines.length === 0 && !vm.recovery.pending) {
      sec.append(el('p', 'sheet-note', '回復した相手はいませんでした。'));
    }
    const pending = vm.recovery.pending;
    if (pending) {
      sec.append(el('p', 'sheet-note',
        `${pending.stageText}の並びから、あと ${pending.need} 人が回復します。回復した ${pending.need} 人を選んでください（選択中 ${pending.pickedCount} 人）。`));
      const list = el('div', 'pick-list');
      for (const cand of pending.candidates) {
        const btn = el('button', `pick-btn${cand.picked ? ' picked' : ''}`, cand.name);
        btn.dataset.megidoId = cand.id;
        btn.addEventListener('click', () => cb.onTogglePick(cand.id));
        list.append(btn);
      }
      sec.append(list);
    }
    content.append(sec);
  }

  // 探索の結果（記録後の返し）: 誰が何段階下がったかを名指しで返す
  // （棚卸し 3-11。回復マス以外でも返す）。ここは返し専用で、結果の
  // 入力は置かない（記録は写し取りとして、記録の時点で完結している）。
  if (vm.postExplore) {
    const sec = section('探索の結果');
    const lines = el('div', 'post-explore-lines');
    for (const line of vm.postExplore.lines) {
      lines.append(el('div', 'post-explore-line', line));
    }
    sec.append(lines);
    content.append(sec);
  }

  // 戦いの後の材料（M10）: 敗北・リタイアの直後にシート内で出す。敗因の断定は置かない。
  if (vm.postResult) {
    const sec = section(vm.postResult.resultLabel);
    for (const line of vm.postResult.lines) sec.append(el('p', '', line));
    sec.append(el('p', 'sheet-note', '付け間違えた場合は、上部バーのメニューから「元に戻す」で戻せます。'));
    content.append(sec);
  }

  // ---- 下部バー（固定） ----
  let actionBar = null;
  const bar = el('div', 'sheet-actionbar');
  const addBtn = (className, label, fn) => {
    const btn = el('button', `sheet-action-btn ${className}`, label);
    btn.addEventListener('click', fn);
    bar.append(btn);
  };
  if (vm.postResult) {
    addBtn('act-close-sheet', '閉じる', cb.onCloseSheet);
    actionBar = bar;
  } else if (vm.postExplore) {
    // 探索の記録の後は、結果の返し（名指しコールアウト）を見せるため
    // シートを開いたままにし、閉じるは明示のボタンにする。
    addBtn('act-close-sheet', '閉じる', cb.onCloseSheet);
    actionBar = bar;
  } else if (vm.powerShort) {
    // 塔破力が足りず記録できない状態は、押せない理由をボタンの文言自体に
    // 出す（W1 の再点検: 無効なボタンが理由を言わない、を残さない）。
    const btn = el('button', 'sheet-action-btn act-blocked',
      vm.powerShortText || '塔破力が足りないため記録できません');
    btn.disabled = true;
    bar.append(btn);
    actionBar = bar;
  } else if (vm.canAct && vm.mode === 'battle') {
    if (!vm.hasFormation) {
      addBtn('act-open-formations', '編成を選ぶ', cb.onOpenFormations);
    } else {
      addBtn('act-result-win', '勝利', () => cb.onResult('win'));
      addBtn('act-result-lose', '敗北', () => cb.onResult('lose'));
      addBtn('act-result-retreat', 'リタイア', () => cb.onResult('retreat'));
    }
    actionBar = bar;
  } else if (vm.canAct && vm.mode === 'explore'
    && !(vm.explorePlan && vm.explorePlan.memberCount === 0)) {
    if (vm.resultSpec) {
      // 記録の実行はこのボタン1つに統一（2026-11-19 の作り直し）。
      // 選択肢タップ＝即記録はやめ、シート内で結果を選んでから、
      // このボタンで確定する。選択が揃うまでは押せず、欠けている
      // 項目はシート内に言葉（missingText）で出ている。結果が1通り
      // しかない期待度では、選択肢が無くボタンだけで記録できる。
      const btn = el('button', 'sheet-action-btn act-explore-record primary', 'これで探索を記録する');
      if (!vm.resultSpec.canRecord) btn.disabled = true;
      btn.addEventListener('click', cb.onRecordExplore);
      recordBtn = btn;
      bar.append(btn);
      actionBar = bar;
    }
  }
  return { content, actionBar };
}

// ---- 編成を選ぶ（M5）／編成管理画面: 全画面ビュー・区画ビュー ----
// 戻り値: { top, content, searchInput, bottom }（top は検索と絞り込みの固定部、
// bottom は「編成を作成」の固定バー。どちらも無い場合は null）
// 並びは使う時の思考順（2026-11-19 ユーザー指示）: まず画面の説明
// （ここで編成を管理・保存できます）を出し、その後に状態（保存されて
// いる編成はまだありません）を出す。空状態では検索と絞り込みを前面に
// 出さず、作る導線を画面の中心に大きく出す（原則8）。1件以上ある通常
// 状態では検索・絞り込みを前に置く（2026-11-27 問題11で、絞り込み
// アコーディオンに畳む形に変更。詳細は下の固定ヘッダー行の注記）。
export function buildFormationList(vm, cb) {
  if (vm.totalCount === 0) {
    const content = el('div', 'formation-empty');
    content.append(el('h2', 'sheet-title', '編成管理画面'));
    content.append(el('p', 'sheet-note', FORMATION_MANAGE_NOTE));
    content.append(el('p', 'sheet-note', '保存されている編成はまだありません。'));
    if (typeof cb.onCreateNew === 'function') {
      const createBtn = el('button', 'btn-create-big', '編成を作成');
      createBtn.addEventListener('click', cb.onCreateNew);
      content.append(createBtn);
    }
    return { top: null, content, searchInput: null, bottom: null };
  }

  const top = el('div', 'formation-tools');
  // 固定ヘッダー行（全体構成の決定 問題11・13、2026-11-27）: 検索と
  // スタイル等の絞り込みは、メギドピッカーと同じ作法の「絞り込み」
  // アコーディオンに畳む（既定は閉。全部むき出しで第一画面を食う形は
  // やめる）。絞り込み中は閉じていてもボタン側に状態（点）が出る。
  // その横に「有効な編成」の切り替えを置く（問題13）: 開いたマスの
  // 文脈（対象の敵・階・タグの照合）に合う編成だけを出す切り替えで、
  // 従来のバナー＋「すべて表示」は廃止した。文脈が無い場面（管理
  // モード等、vm.context が無い時）は切り替え自体を出さない。
  // アコーディオンの開閉は vm.filterOpen で受け、切り替えは
  // cb.onToggleFilter に返す（再描画で状態を保つため）。onToggleFilter
  // が無い呼び出し（従来形）ではアコーディオンを常時開いた形にする。
  const head = el('div', 'formation-tools-head');
  const filterActive = Boolean(vm.query || vm.styleFilter || vm.usableOnly
    || (vm.floorFilterFloor != null && vm.floorFilterOn === false));
  if (typeof cb.onToggleFilter === 'function') {
    const filterBtn = el('button', `picker-filter-btn${filterActive ? ' has-filter' : ''}`);
    filterBtn.append(el('span', '', '絞り込み'));
    if (filterActive) filterBtn.append(el('span', 'picker-filter-dot', '●'));
    filterBtn.append(el('span', 'picker-filter-chev', vm.filterOpen ? '⌃' : '⌄'));
    filterBtn.addEventListener('click', () => cb.onToggleFilter());
    head.append(filterBtn);
  }
  if (vm.context && typeof cb.onToggleContextValid === 'function') {
    const validBtn = el('button', `btn-context-valid${vm.context.validOnly ? ' active' : ''}`, '有効な編成');
    validBtn.addEventListener('click', () => cb.onToggleContextValid());
    head.append(validBtn);
  }
  top.append(head);

  const filterOpen = vm.filterOpen || typeof cb.onToggleFilter !== 'function';
  const filterBox = el('div', `picker-filter${filterOpen ? ' open' : ''}`);
  const search = document.createElement('input');
  search.className = 'formation-search';
  search.type = 'text';
  search.value = vm.query;
  search.setAttribute('placeholder', '編成名・タグ・メンバー名で検索');
  bindSearchInput(search, (value) => cb.onQuery(value));
  filterBox.append(search);

  const filters = el('div', 'formation-filters');
  const styles = [null, 'ラッシュ', 'カウンター', 'バースト'];
  for (const s of styles) {
    const label = s === null ? 'スタイル: すべて' : s;
    const btn = el('button', `filter-chip${vm.styleFilter === s ? ' active' : ''}`, label);
    btn.dataset.style = s === null ? '' : s;
    btn.addEventListener('click', () => cb.onStyleFilter(s));
    filters.append(btn);
  }
  const usableBtn = el('button', `filter-chip${vm.usableOnly ? ' active' : ''}`, '使える編成のみ');
  usableBtn.addEventListener('click', cb.onToggleUsableOnly);
  filters.append(usableBtn);
  // 「今いる階」フィルタ（SW94、編成区画だけ: vm.floorFilterFloor が
  // ある時だけ出す）。ON は既定で、今いる階の編成だけに絞る。OFF に
  // すると全件が階ごとの見出し区切りで出る（content 側の groups）。
  if (vm.floorFilterFloor != null && typeof cb.onToggleFloorFilter === 'function') {
    const floorBtn = el('button', `filter-chip${vm.floorFilterOn ? ' active' : ''}`,
      `今いる階（${vm.floorFilterFloor}F）`);
    floorBtn.addEventListener('click', cb.onToggleFloorFilter);
    filters.append(floorBtn);
  }
  filterBox.append(filters);
  filterBox.append(el('div', 'formation-count', `${vm.shownCount} 件（全 ${vm.totalCount} 件）`));
  top.append(filterBox);

  const content = el('div', 'formation-list');
  // 管理モード（編成区画）では、画面の名前と説明を先頭に出す（空状態と
  // 同じ形。選択モードはマスの文脈が頭にあるため出さない）。
  if (vm.mode === 'manage') {
    content.append(el('h2', 'sheet-title', '編成管理画面'));
    content.append(el('p', 'sheet-note', FORMATION_MANAGE_NOTE));
  }
  const canManage = typeof cb.onEdit === 'function' && typeof cb.onDelete === 'function';
  const canMemo = typeof cb.onMemo === 'function';
  const canCopy = typeof cb.onCopy === 'function';
  const renderRow = (row) => {
    const btn = el('button', `formation-row${row.usable ? '' : ' unusable'}${row.blockedFlash ? ' flash' : ''}`);
    btn.dataset.formationId = row.id;
    // 行は2段組（全体構成の決定 問題2・案2、2026-11-26）: 上段 =
    // 対象＋勝敗、下段 = 名前＋メンバー。「何のための編成か」と
    // 「勝てたか」が行の頭で読める並びにする。対象も勝敗も無い
    // 行では上段自体を出さない。
    if (row.targetText || row.recordText) {
      const top = el('div', 'formation-row-top');
      if (row.targetText) top.append(el('span', 'formation-target', row.targetText));
      if (row.recordText) top.append(el('span', 'formation-record', row.recordText));
      btn.append(top);
    }
    const head = el('div', 'formation-row-head');
    head.append(el('span', 'formation-name', row.name || '（名前なし）'));
    head.append(el('span', 'formation-composition', row.composition));
    btn.append(head);
    if (Array.isArray(row.members)) {
      // メギドは文字の行のままにせず、顔アイコン・スタイル色のチップと
      // 段階の色を視覚的な担い手として持たせる（文字の裏付けは常に併記）。
      for (const m of row.members) {
        const line = el('div', 'formation-member');
        line.append(el('span', 'formation-member-label', `${m.label}: `));
        line.append(faceIconImg(m.name));
        if (m.style) line.append(styleChip(m.style));
        line.append(el('span', 'formation-member-name', ` ${m.name}`));
        line.append(el('span', `formation-member-stage sc-${m.stage}`, `（${m.stageLabel}）`));
        line.append(el('span', 'formation-member-orb', `／オーブ${m.orbText}`));
        if (m.reishouSummary) line.append(reishouSummaryInline(m.reishouSummary));
        btn.append(line);
      }
    } else {
      for (const line of row.memberLines) btn.append(el('div', 'formation-member', line));
    }
    // タグのチップ（カテゴリ別の色。検索の対象でもある）。
    if (Array.isArray(row.tags) && row.tags.length > 0) {
      const tagRow = el('div', 'tag-row');
      for (const t of row.tags) {
        tagRow.append(el('span', `tag-chip tag-${t.category}`, t.text));
      }
      btn.append(tagRow);
    }
    // 戦術メモは、選ぶ場面で読めることが仕事（棚卸し 4-9）。
    if (row.notes) btn.append(el('div', 'formation-notes', row.notes));
    if (row.worstText) btn.append(el('div', 'formation-worst', row.worstText));
    for (const reason of row.reasons) {
      btn.append(el('div', 'formation-reason', reason));
    }
    // 編成同士の重複（調査 A3）: 他の保存済み編成でも使っている
    // メンバーの事実だけを出す。警告にも評価にもしないため、
    // 色も太字も付けない通常の行として並べる。
    for (const line of row.overlapLines || []) {
      btn.append(el('div', 'formation-overlap', line));
    }
    // そのマスの脅威へのカバー（M5）: 索引で判定した対応／未対応。
    for (const cov of row.coverageLines || []) {
      const cls = cov.covered === null ? ' note' : cov.covered ? ' covered' : ' uncovered';
      btn.append(el('div', `formation-coverage${cls}`, cov.text));
    }
    btn.addEventListener('click', () => {
      // 管理モード（マップ下部の「編成」から開いた場合）は、戦闘の文脈が
      // 無いため、行タップは選択ではなく編集側に進む。選択モードは従来どおり。
      if (vm.mode === 'manage' && typeof cb.onEdit === 'function') {
        cb.onEdit(row.id);
      } else if (row.usable) {
        cb.onSelect(row.id);
      } else {
        cb.onBlocked(row.id);
      }
    });
    if (!canManage && !canMemo && !canCopy) {
      return btn;
    }
    // 操作（メモ・編集・コピー・削除）は選択の行とは分けて置く
    // （ボタンの中にボタンを入れない）。
    const entry = el('div', 'formation-entry');
    entry.append(btn);
    const actions = el('div', 'formation-actions');
    if (canMemo) {
      const memoBtn = el('button', 'btn-formation-memo', 'メモ');
      memoBtn.dataset.formationId = row.id;
      memoBtn.addEventListener('click', () => cb.onMemo(row.id));
      actions.append(memoBtn);
    }
    if (canManage) {
      const editBtn = el('button', 'btn-formation-edit', '編集');
      editBtn.dataset.formationId = row.id;
      editBtn.addEventListener('click', () => cb.onEdit(row.id));
      actions.append(editBtn);
    }
    if (canCopy) {
      const copyBtn = el('button', 'btn-formation-copy', 'コピー');
      copyBtn.dataset.formationId = row.id;
      copyBtn.addEventListener('click', () => cb.onCopy(row.id));
      actions.append(copyBtn);
    }
    if (canManage) {
      // 削除はその場の2タップ確定にしない（原則9）: このボタンは確認の
      // シートを開くだけで、確定は別の場所の編成名つきボタンで行う。
      const deleteBtn = el('button', 'btn-formation-delete', '削除');
      deleteBtn.dataset.formationId = row.id;
      deleteBtn.addEventListener('click', () => cb.onDelete(row.id));
      actions.append(deleteBtn);
    }
    entry.append(actions);
    return entry;
  };

  // 並べ方: vm.groups がある時（編成区画で「今いる階」フィルタ OFF）は
  // 階ごとの見出し区切りで出し、対象なしは最後のグループ。無い時は
  // 従来どおり平らな一覧。
  if (Array.isArray(vm.groups)) {
    if (vm.groups.length === 0) {
      content.append(el('p', 'sheet-note', vm.emptyText || '条件に合う編成がありません。'));
    }
    for (const group of vm.groups) {
      if (group.label) content.append(el('div', 'formation-floor-head', group.label));
      for (const row of group.rows) content.append(renderRow(row));
    }
  } else if (vm.rows.length === 0) {
    content.append(el('p', 'sheet-note', vm.emptyText || '条件に合う編成がありません。'));
  } else {
    for (const row of vm.rows) content.append(renderRow(row));
  }

  let bottom = null;
  if (typeof cb.onCreateNew === 'function') {
    bottom = el('div', 'sheet-actionbar');
    const createBtn = el('button', 'sheet-action-btn act-create-formation', '編成を作成');
    createBtn.addEventListener('click', cb.onCreateNew);
    bottom.append(createBtn);
  }
  return { top, content, searchInput: search, bottom };
}

// ---- 探索の組み替え（M7）: 候補の全画面ビュー ----
// vm: { title, targetLine, summaryText, rows: [{id, name, meta}], showRemove }
// summaryText は現在の組み合わせの合計と期待度（次の判断そのもの）なので大きく出す。
// 候補の細目（スタイル・段階・探索力）は各行の中に収める。
export function buildExploreCandidates(vm, cb) {
  const content = el('div', 'explore-candidates');
  content.append(el('h2', 'sheet-title', vm.title));
  if (vm.targetLine) content.append(el('p', 'sheet-note', vm.targetLine));
  content.append(el('p', 'cand-summary', vm.summaryText));
  if (vm.showRemove) {
    const removeBtn = el('button', 'btn-remove-member', 'このメンバーを外す');
    removeBtn.addEventListener('click', cb.onRemove);
    content.append(removeBtn);
  }
  const list = el('div', 'cand-list');
  if (vm.swipeHint && typeof cb.onDismissSwipeHint === 'function') {
    const hint = el('div', 'swipe-hint');
    hint.append(el('span', 'swipe-hint-text',
      '左スワイプで候補から外す／右スワイプで詳細'));
    const hintClose = el('button', 'swipe-hint-close', '閉じる');
    hintClose.addEventListener('click', () => cb.onDismissSwipeHint());
    hint.append(hintClose);
    list.append(hint);
  }
  if (vm.rows.length === 0) {
    list.append(el('p', 'sheet-note', '入れ替えできる候補がいません（所持していて、気絶しておらず、編成にも入っていない人がいません）。'));
  }
  for (const row of vm.rows) {
    const btn = el('button', 'cand-row');
    btn.dataset.megidoId = row.id;
    if (row.style) {
      const nameLine = el('div', 'cand-name');
      nameLine.append(faceIconImg(row.name));
      nameLine.append(styleChip(row.style));
      nameLine.append(el('span', 'cand-name-text', ` ${row.name}`));
      appendOsusumeMarks(nameLine, row, true);
      btn.append(nameLine);
      const meta = el('div', 'cand-meta', `${row.meta}／`);
      meta.append(el('span', `sc-${row.stage}`, row.stageLabel));
      btn.append(meta);
      if (row.sub) btn.append(el('div', 'cand-sub', row.sub));
    } else {
      btn.append(el('div', 'cand-name', row.name));
      btn.append(el('div', 'cand-meta', row.meta));
    }
    btn.addEventListener('click', () => {
      if (isSwipeSuppressed(btn)) return;
      cb.onPick(row.id);
    });
    if (typeof cb.onSwipeHide === 'function' && typeof cb.onSwipeDetail === 'function') {
      const wrap = el('div', 'cand-wrap');
      const revL = el('div', 'swipe-reveal swipe-reveal-l', '詳細');
      const revR = el('div', 'swipe-reveal swipe-reveal-r', '候補から外す');
      wrap.append(revL, revR, btn);
      attachCandidateSwipe(btn, {
        onSwipeLeft: () => cb.onSwipeHide(row.id),
        onSwipeRight: () => cb.onSwipeDetail(row.id),
      });
      list.append(wrap);
    } else {
      list.append(btn);
    }
  }
  content.append(list);
  const back = el('button', 'btn-back', '戻る');
  back.addEventListener('click', cb.onBack);
  content.append(back);
  return { content };
}

// ---- 戦術メモの編集（棚卸し 4-9） ----
// 編成を選ぶ場面から、その場でメモだけを書き換える（現行ツールの
// handleSaveFormationMemo と同じく、メモだけを更新する経路）。
// placeholder の例文が「何を書くか」の教え方を担う（現行ツールと同じ例文）。
// cb: { onSave(text), onCancel }
export function buildMemoEditor(vm, cb) {
  const wrap = el('div', 'memo-editor');
  wrap.append(el('h2', 'sheet-title', `戦術メモ: ${vm.name}`));
  const input = document.createElement('textarea');
  input.className = 'memo-input';
  input.value = vm.notes || '';
  input.setAttribute('placeholder', '戦術メモを入力... (例: 1T目にスキルが取れなければリタイア)');
  wrap.append(input);
  const saveBtn = el('button', 'btn-memo-save', 'メモを保存する');
  saveBtn.addEventListener('click', () => cb.onSave(input.value));
  wrap.append(saveBtn);
  const cancelBtn = el('button', 'btn-memo-cancel', 'やめる');
  cancelBtn.addEventListener('click', cb.onCancel);
  wrap.append(cancelBtn);
  return wrap;
}

// ---- 編成の削除の確認（原則9） ----
// 一覧の「削除」とは別の場所（確認のシート）に、編成名を明示した確定
// ボタンを置く。連打では消えない形にする。
// cb: { onConfirm, onCancel }
export function buildDeleteFormationConfirm(name, cb) {
  const wrap = el('div', 'delete-confirm');
  wrap.append(el('h2', 'sheet-title', '編成の削除'));
  wrap.append(el('p', 'sheet-note',
    `『${name}』を削除します。削除した編成は元に戻せません。`));
  const confirmBtn = el('button', 'btn-delete-confirm', `『${name}』を削除する`);
  confirmBtn.addEventListener('click', cb.onConfirm);
  wrap.append(confirmBtn);
  const cancelBtn = el('button', 'btn-delete-cancel', 'やめる');
  cancelBtn.addEventListener('click', cb.onCancel);
  wrap.append(cancelBtn);
  return wrap;
}
