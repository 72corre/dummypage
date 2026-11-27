// 編成を組む（M6・核）の描画: 編成エディタ、枠の候補、オーブの選択。
// ui-flow.md v3 の M6 の操作に対応する:
//   - 枠タップ → 候補の全画面ビュー（既定の並びはコンディション順、
//     検索とスタイル・クラスの絞り込みつき）。
//   - 埋まった枠の「オーブ」ボタン → オーブの一覧（2タップで付け替え）。
//   - 名前は自動名を初期値として編集できる形で出す。
//   - 中央（リーダー）が空の間は保存できない。
// 原則8（粒度は判断への近さで決める）の適用:
//   - 編成の成立に関わる情報（枠の状態、リーダーの有無、保存できない理由）を前に出す。
//   - 候補の細目（スタイル・クラス・段階）は候補行の中に収める。
//   - ME の適合表示は、全272体分の実データで出す（vm.meFit）。
// このモジュールは DOM の組み立てだけを行い、状態は main.js が vm として渡す。

import { bindSearchInput, styleChip, faceWithStyle, faceWithStyleClassBadge, photonIconImg } from './views.js';
import { attachCandidateSwipe, isSwipeSuppressed } from './swipe.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// 「音符発生」の注記のアイコン（2026-11-20）: Material Symbols の
// music_note_add をインライン SVG で描く。絵文字は端末で見た目が
// 揃わず、アイコンフォントは最も重くオフラインでも崩れるため、
// 単一の SVG（パス1つ・数百バイト、色は currentColor でテーマ
// 追随）にする。「+と音符」で「音符が増える＝発生」と読める形。
// パスは Material Symbols（Apache 2.0）の music_note_add 本体。
const MUSIC_NOTE_ADD_PATH = 'M12.116 19.808q-1.238 0-2.12-.882t-.88-2.118t.88-2.119t2.12-.881q.575 0 1.09.204t.91.615V4.192H19v2.539h-3.884v10.077q0 1.237-.882 2.118t-2.118.882M7.23 11.192v-3h-3v-1h3v-3h1v3h3v1h-3v3z';
// 受けダメージの見積もり（積4）の、落ちる攻撃1件の行。
// sheet.js の開始前確認でも同じ形で出す。
function damageEstimateHitText(hit) {
  const name = hit.skillName ? `『${hit.skillName}』` : '';
  const hits = hit.hits > 1 ? `（${hit.hits}連続の合計）` : '';
  const cond = hit.conditionNote ? `（${hit.conditionNote}）` : '';
  return `${hit.attackerName}の${hit.kindLabel}${name}で約${hit.total}点${hits}${cond}`;
}

// 落ちる味方がいない場合の理由の行（sheet.js と同じ形）。
// 受け手は「一番脆い」（落ちるのに一番近い）味方であることを
// 明示する（全体構成 問題14 追記、2026-11-27。sheet.js と文言を揃える）。
function damageEstimateSafeLines(est) {
  if (!est || !est.closest) return [];
  const c = est.closest;
  return [
    `一番危ない攻撃: ${damageEstimateHitText(c)}`,
    `一番脆い${c.allyName}が受けてもHPが${c.allyHp - c.total}点残る`,
  ];
}

function noteMarkEl() {
  const wrap = el('div', 'cand-note-mark');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'note-mark-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', MUSIC_NOTE_ADD_PATH);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  wrap.append(svg);
  wrap.append(el('span', '', '音符発生'));
  return wrap;
}

// 素早さの変化の統一表記（2026-11-19、色は 2026-11-25 移行・訂正、
// 矢印の位置は 2026-11-26 に案Bで統一）:
// 矢印も色も方向（上昇 = ↑ + 赤（--up）、低下 = ↓ + 青（--down））
// で、上がった／下がったが一目で伝わる形にする。矢印は値の直後に
// 置く（案B: 「前→後↑」の並び。末尾に（注記）がある場合は注記の
// 前に置き、矢印が値から離れないようにする）。数値そのものは
// 従来どおり併記する。変化が無い（dir が null）場合は矢印も色も
// 付けない。ピッカーのプレビュー行と内訳の各補正で同じ対応を使う。
function spdDirClass(dir) {
  return dir === 'up' ? ' spd-up' : dir === 'down' ? ' spd-down' : '';
}
function spdDirText(text, dir) {
  if (dir !== 'up' && dir !== 'down') return text;
  const arrow = dir === 'up' ? '↑' : '↓';
  const note = /（[^）]*）$/.exec(text);
  if (note) return `${text.slice(0, note.index)}${arrow}${note[0]}`;
  return `${text}${arrow}`;
}
// 内訳（基礎・霊宝・特性・オーブ・マスエフェクト…）の表示。
// parts: [{ text, dir }]（speed.js の effectiveSpeed が返す構造）。
// 枠の中の内訳（5枠グリッド用）: 補正ごとに自分の行へ置く
// （2026-11-26 ペルソナ検品）。1行に流すと、各補正が nowrap
// （.spd-part）のため「マスエフェクト+9%↑」のような長い補正が
// 枠幅を超えて切れる。行ごとに fit-x で実測し、超える行だけ横に
// 縮める（クラス・段階を別行に置く作法と同じ）。
function slotSpdDetailNode(parts) {
  const wrap = el('span', 'slot-spd-detail');
  for (const p of parts || []) {
    const line = el('span', 'slot-spd-detail-line fit-x');
    if (p.dir) line.append(el('span', `spd-part${spdDirClass(p.dir)}`, spdDirText(p.text, p.dir)));
    else line.append(el('span', '', p.text));
    wrap.append(line);
  }
  return wrap;
}
// 枠の霊宝の圧縮表示（2026-11-19、ユーザー合意）: 「霊宝 n/4」の
// チップ＋専用霊宝・絆霊宝の所持印＋素早さに効く霊宝だけの名前
// つき注記。名前の全列挙はしない（確認と付け替えは霊宝ピッカー
// で行う）。絆の印は状態異常耐性が付くため編成の判断材料になる
// （2026-11-20 ユーザー訂正）。
// 印は「霊宝 n/4」の行の下の決まった行（.reishou-marks）に固定で
// 出す（全体構成 問題12、2026-11-27）。個数の後ろに続けると枠の
// 幅で流れて見切れるため（リーダー枠で専が見切れ絆がはみ出した
// 実例）。印が無い枠では行自体を出さない（素早さ注記と同じ作法）。
// summary: { count, max, special, bond, spdNotes: [{ name,
// segments: [{ text, dir }] }] }。注記の数値は合算済みで、向きは
// 内訳と同じ↑↓＋色の統一表記で出す。
function reishouSummaryNode(summary) {
  const s = summary || { count: 0, max: 4, special: false, bond: false, spdNotes: [] };
  const wrap = el('span', 'reishou-summary');
  const head = el('span', 'reishou-summary-head', `霊宝 ${s.count}/${s.max || 4}`);
  wrap.append(head);
  if (s.special || s.bond) {
    const marks = el('span', 'reishou-marks');
    if (s.special) marks.append(el('span', 'reishou-mark', '専'));
    if (s.bond) marks.append(el('span', 'reishou-mark', '絆'));
    wrap.append(marks);
  }
  for (const note of s.spdNotes || []) {
    // 狭い枠では数値（色つき）が先に目に入る並びにする: 向きと
    // 量を先、名前を後に置く（名前は後ろで折り返しても読める）。
    const line = el('span', 'reishou-spd-note');
    (note.segments || []).forEach((seg, i) => {
      if (i > 0) line.append(el('span', '', ' '));
      line.append(el('span', `spd-part${spdDirClass(seg.dir)}`, spdDirText(seg.text, seg.dir)));
    });
    if ((note.segments || []).length > 0) line.append(el('span', '', ' '));
    line.append(el('span', 'reishou-spd-note-name fit-x', note.name));
    wrap.append(line);
  }
  return wrap;
}
// ピッカーの「付けると／外すと素早さ○○」の行。
function spdAfterLine(text, dir, className) {
  return el('div', `${className}${spdDirClass(dir)}`, spdDirText(text, dir));
}

// ---- ピッカー共通の固定ヘッダー（2026-11-25 再設計、正本は
// research/picker-redesign-decisions-2026-11-25.md） ----
// トップ1行は常時固定: 「○○を選択（文脈）［絞り込み ▾］［戻る／完了］」。
// 見出し（h2.sheet-title）の中に絞り込みボタンを置き、オーバーレイの
// 閉じるボタン（戻る／完了）は views.js が見出しの横へ付ける。
// 検索と絞り込みチップは絞り込みアコーディオン（.picker-filter）に隠し、
// 開いた時だけトップの下に出る。絞り込み中は閉じていてもボタン側に
// 状態（点）が出る。アコーディオンの開閉状態は vm.filterOpen で受け、
// 切り替えは cb.onToggleFilter に返す（再描画で状態を保つため）。
// onToggleFilter が無い呼び出し（従来形）ではアコーディオンを
// 常時開いた形にし、トグルボタンも出さない。
const CONDITION_STAGE_NAMES = ['絶好調', '好調', '普通', '不調', '絶不調', '気絶'];
function pickerHeadNode({ title, filterOpen, filterActive, onToggleFilter }) {
  const head = el('div', 'picker-head');
  const h = el('h2', 'sheet-title picker-title');
  // 見出しは専用の行に置く（版155: 見出し24pxではボタンと横並びに
  // 収まらず、見出しが単語の途中で折れていた。ボタンは次の行に
  // 回し、見出しは1行で出す）。
  h.append(el('span', 'picker-title-text', title));
  if (typeof onToggleFilter === 'function') {
    const btn = el('button', `picker-filter-btn${filterActive ? ' has-filter' : ''}`);
    btn.append(el('span', '', '絞り込み'));
    if (filterActive) btn.append(el('span', 'picker-filter-dot', '●'));
    btn.append(el('span', 'picker-filter-chev', filterOpen ? '⌃' : '⌄'));
    btn.addEventListener('click', () => onToggleFilter());
    h.append(btn);
  }
  head.append(h);
  return head;
}
function pickerFilterBox(vm, cb) {
  const open = vm.filterOpen || typeof cb.onToggleFilter !== 'function';
  return el('div', `picker-filter${open ? ' open' : ''}`);
}
// コンディションの段階番号（行の材料は stage 数値が正。無い時は
// 段階名から引く）。
function stageOfRow(row) {
  if (typeof row.stage === 'number') return row.stage;
  const i = CONDITION_STAGE_NAMES.indexOf(row.stageText);
  return i >= 0 ? i : null;
}

// ME の要約の行（集約済みの効果）: 効果文＋効いている枠位置。
// line: { effect, positions: [枠ラベル], genderUnknown }
function meSummaryLine(line) {
  const text = `・${line.effect}（${(line.positions || []).join('・')}）`
    + (line.genderUnknown ? '（性別の条件は判定できない）' : '');
  return el('p', 'me-fit-line', text);
}

// フォトンの種別を含む注記は、種別の言葉にアイコンを添えて出す。
function noteWithPhotonIcons(text) {
  const span = el('span', 'chain-note-text');
  const parts = String(text).split(/(アタック|スキル|チャージ|覚醒)フォトン/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const icon = photonIconImg(part, 'ui-icon chain-photon-icon');
      if (icon) span.append(icon);
      span.append(el('span', null, `${part}フォトン`));
    } else if (part) {
      span.append(el('span', null, part));
    }
  });
  return span;
}

// チェインのテスト道具の区画（2026-11-19、ユーザー承認済みの
// 方式）。タイムテーブル（敵味方を素早さ順に並べた表）で起点を
// タップすると、チェインテーブル（下段の行動の列）が自動で
// 組み上がる。起点はタイムテーブルに残り、その直後に∧の印を
// 出す。チェインテーブルの行動はタップで外せる（条件で固定の
// 行動は外せない）。
// チェインテーブルの行動は、その行動が消費するフォトンの形で
// 出す（2026-11-19 ユーザー確定: 別行ではなくテーブル上の行動
// 自体をフォトンの形にする。テーブルとフォトンの対応が取れる
// ため）。フォトン1個は約52px幅で、5個が1行に収まる。
// ステージを選んだ編成では、チェインが成立しない場合でも
// タイムテーブルだけは出す（viewOnly: 味方のチップはボタンに
// せず、チェインテーブルとリセットも出さない）。
// chain: { viewOnly, timeline: [{ kind: 'ally'|'enemy', id, name,
//                       spdText, spdDir, supplyText, isOrigin, hidden }],
//          actions: [{ id, name, occ, fixed, photon, prob, spdText,
//                      supplyText }],
//          actionNotes: [{ from, to, notes: [] }],
//          ignoredProbLines: [{ key, text }],
//          resultLines: [], notes: [], errorText,
//          photonText, photonFull, hasOrigin }
// cb: onChainOrigin(id), onChainPhotonTap(index),
//     onChainRemove(index), onChainProbToggle(index),
//     onChainProbRestore(key), onChainReset()
// 行動のチップ（2026-11-20 手組み）: 本体のタップはフォトンの
// 変更（使う行動の選択ポップアップ）、外すのは×ボタンだけ。
// 確率の形で渡している行動には「？」の印が付き、タップすると
// その確率の形を無視して組み直す（無視した分は下に×で出し、
// 戻せる）。条件で固定の行動は×を出さない。
function chainChipParts(chip, m) {
  // 敵の素早さの向き（spdDir）がある行は、素早さの文全体に方向色を
  // 付ける（オーブピッカーの結果行と同じ付け方。2026-11-26、変化
  // 表記の統一 #5）。向きが無い行は従来どおり無色。
  if (m.spdText) chip.append(el('span', `chain-member-spd${spdDirClass(m.spdDir)}`, m.spdText));
  if (m.supplyText) chip.append(el('span', 'chain-member-supply', m.supplyText));
}

function chainSectionNode(chain, cb) {
  const sec = el('div', 'chain-section');
  const viewOnly = Boolean(chain.viewOnly);
  // SW92: 節はタイムラインそのもの。枠の下に常時出し、チェインの
  // 組み立てもこの上で行う（別の「チェイン」節・チップは置かない）。
  sec.append(el('div', 'build-section-title', 'タイムライン（速度順）'));
  const tl = el('div', 'chain-timeline');
  for (const r of chain.timeline) {
    if (r.hidden) continue;
    if (r.kind === 'enemy') {
      const chip = el('div', 'chain-member-chip enemy', r.name);
      chainChipParts(chip, r);
      tl.append(chip);
      continue;
    }
    if (!viewOnly && r.isOrigin) {
      const chip = el('div', 'chain-member-chip is-origin', r.name);
      chip.dataset.megidoId = r.id;
      chip.append(el('span', 'chain-origin-badge', '起点'));
      chainChipParts(chip, r);
      tl.append(chip);
      const wedge = el('div', 'chain-wedge');
      wedge.append(el('span', 'chain-wedge-mark', '∧'));
      wedge.append(el('span', 'chain-wedge-label', 'ここに割り込む'));
      tl.append(wedge);
      continue;
    }
    if (viewOnly) {
      // 見るだけの表: 押せる見た目にしない（ボタンにしない）。
      const chip = el('div', 'chain-member-chip', r.name);
      chip.dataset.megidoId = r.id;
      chainChipParts(chip, r);
      tl.append(chip);
      continue;
    }
    const chip = el('button', 'chain-member-chip', r.name);
    chip.dataset.megidoId = r.id;
    chainChipParts(chip, r);
    chip.append(el('span', 'chain-tap-hint', 'タップで起点'));
    chip.addEventListener('click', () => cb.onChainOrigin(r.id));
    tl.append(chip);
  }
  sec.append(tl);
  if (viewOnly) return sec;
  // 操作の説明はタイムラインの下に置く（先に表を見せる）。
  sec.append(el('p', 'sheet-note',
    '起点にしたい味方をタップすると、素早さ順に次の味方が割り込みます。チェインテーブルの行動は、タップでフォトンを変えられ、×で外せます。'));
  if (chain.errorText) sec.append(el('p', 'chain-error', chain.errorText));

  const zoneHead = el('p', 'chain-zone-label', 'チェインテーブル');
  if (chain.photonText) {
    zoneHead.append(el('span', `chain-photon-info${chain.photonFull ? ' full' : ''}`, chain.photonText));
  }
  sec.append(zoneHead);
  if (!chain.hasOrigin) {
    sec.append(el('p', 'sheet-note',
      '味方をタップするとチェインの起点になります。起点はタイムラインに残り、引っ張られた味方が割り込む順にここへ並びます。'));
  } else {
    const row = el('div', 'chain-route');
    chain.actions.forEach((a, i) => {
      // 回数チェイン付与で引っ張られた手は、矢印と枠の色を変える
      // （2026-11-21 ユーザー決定。通常のチェインと見分けが付かず
      // 混乱の元になるため。色は CSS の --grant）。
      if (i > 0) row.append(el('span', `chain-arrow${a.grantLink ? ' is-grant' : ''}`, '›'));
      // 行動はフォトンの形で出す: アイコン（形）＋名前＋種別。
      // 本体はフォトン変更のボタン、×は外すボタン（固定の行動と
      // 起点以外。起点の×はテストをやめる）。
      const wrap = el('div', `chain-action${a.fixed ? ' is-fixed' : ''}${a.grantLink ? ' is-grant' : ''}`);
      const chip = el('button', 'chain-action-photon');
      chip.dataset.megidoId = a.id;
      chip.dataset.photon = a.photon || 'アタック';
      const icon = photonIconImg(a.photon || 'アタック', 'chain-action-icon');
      if (icon) chip.append(icon);
      chip.append(el('span', 'chain-order-badge', String(i + 1)));
      if (a.fixed) chip.append(el('span', 'chain-fixed-mark', '◎'));
      chip.append(el('span', 'chain-action-name', a.name));
      chip.append(el('span', 'chain-action-type',
        (a.photon || 'アタック') + (a.occ >= 2 ? `・${a.occ}回目` : '')));
      chip.append(el('span', 'chain-tap-hint',
        a.fixed ? '条件で固定' : 'フォトンを変える'));
      chip.addEventListener('click', () => cb.onChainPhotonTap(i));
      wrap.append(chip);
      if (!a.fixed) {
        const x = el('button', 'chain-action-x', '×');
        x.title = i === 0 ? 'テストをやめる' : 'この行動を外す';
        x.addEventListener('click', () => cb.onChainRemove(i));
        wrap.append(x);
      }
      if (typeof a.prob === 'number') {
        const q = el('button', 'chain-prob-badge', '？');
        q.title = `${a.prob}%の確率でチェインする形です。タップすると、この確率の形を無視して組み直します`;
        q.addEventListener('click', () => cb.onChainProbToggle(i));
        wrap.append(q);
      }
      row.append(wrap);
    });
    sec.append(row);
    // 組み立て後は経路の末尾（最新の行動）が見える位置まで寄せる。
    // 帯が収まっている場合は何もしない。
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (row.scrollWidth > row.clientWidth) row.scrollLeft = row.scrollWidth;
      });
    }
    if (chain.photonFull) {
      sec.append(el('p', 'sheet-note',
        'フォトンを使い切りました。途中の行動を×で外すと、空いたフォトンで次の候補（2回目の行動を含む）が入ります。'));
    }
    if (chain.hasGrantLink) {
      sec.append(el('p', 'chain-link-note is-grant',
        '紫の矢印と枠の行動は、回数チェイン付与でつながっています。'));
    }
  }
  for (const n of chain.notes || []) sec.append(el('p', 'chain-link-note', n));
  for (const an of chain.actionNotes || []) {
    const line = el('p', `chain-link-note${an.grantLink ? ' is-grant' : ''}`);
    line.append(el('span', null, `※ ${an.from}→${an.to}: `));
    (an.notes || []).forEach((n, i) => {
      if (i > 0) line.append(el('span', null, '、'));
      line.append(noteWithPhotonIcons(n));
    });
    sec.append(line);
  }
  for (const ig of chain.ignoredProbLines || []) {
    const line = el('p', 'chain-link-note');
    line.append(el('span', null, `× ${ig.text}の確率チェインを無視しています`));
    const restore = el('button', 'chain-prob-restore', '戻す');
    restore.addEventListener('click', () => cb.onChainProbRestore(ig.key));
    line.append(restore);
    sec.append(line);
  }
  for (const text of chain.resultLines || []) {
    sec.append(el('p', 'chain-result-line', text));
  }
  const resetBtn = el('button', 'chain-clear-btn', 'リセット');
  resetBtn.addEventListener('click', () => cb.onChainReset());
  sec.append(resetBtn);
  return sec;
}

// チェインの手組み: 1つの行動で使う行動（フォトン）を選ぶ
// ポップアップ。vm: { title, note, options: [{ key, photon,
// label, notes: [], prob, current }] }
// cb: onChoose(key), onCancel()
export function buildChainPhotonPopup(vm, cb) {
  const wrap = el('div', 'chain-photon-popup');
  wrap.append(el('div', 'hbomb-popup-title', vm.title));
  if (vm.note) wrap.append(el('p', 'hbomb-popup-note', vm.note));
  for (const o of vm.options || []) {
    const b = el('button', `hbomb-popup-item${o.current ? ' is-current' : ''}`);
    const head = el('span', 'hbomb-popup-item-head');
    const icon = photonIconImg(o.photon || 'アタック', 'ui-icon chain-photon-icon');
    if (icon) head.append(icon);
    head.append(el('span', 'hbomb-popup-item-label',
      o.label + (typeof o.prob === 'number' ? `（${o.prob}%の確率）` : '')));
    if (o.current) head.append(el('span', 'hbomb-popup-item-meta', 'いまの行動'));
    b.append(head);
    if (o.notes && o.notes.length) {
      b.append(el('span', 'chain-photon-option-note', o.notes.join('、')));
    }
    b.addEventListener('click', () => cb.onChoose(o.key));
    wrap.append(b);
  }
  const foot = el('div', 'kyoen-alloc-foot');
  const cancel = el('button', 'kyoen-alloc-cancel', 'キャンセル');
  cancel.addEventListener('click', () => cb.onCancel());
  foot.append(cancel);
  wrap.append(foot);
  return wrap;
}

// ピッカーの印の理由（全体構成の決定 問題6、2026-11-26）: 理由は
// タップの先に隠さず、行の中に書く。材料は counter.js の純関数
// （answerReasonLines / meFitReasonLines / demandReasonLines）が
// 組んだ行で、呼び出し側（main）が row.validReasons /
// row.demandReasons / row.targetReasons に寄せて渡す。理由のある
// 行は理由の分だけ高さが伸びる（has-reasons）。材料の無い行には
// 理由を付けない。
function candReasonsNode(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const wrap = el('div', 'cand-reasons');
  for (const line of lines) wrap.append(el('div', 'cand-reason-line', line));
  return wrap;
}

// Hボムプランナーの区画（2026-11-19 実装フライト、ユーザー承認
// 済みの形）。上段が戦場（敵の陣形・ボム枠・HP）、下段が操作
// エリア（ボムの行動の選択肢）。説明文は置かず、ゲームの戦闘
// 画面の作りで伝える。初期状態は空で、「おまかせ」でツールが
// 出した最適解が入る。
// hbomb: { mode: 'ren'|'turn', rows: [[enemyIdx...], ...],
//   enemies: [{ index, name, hpText, barPct, resultText, kills,
//               debuffs: [label...],
//               bombs: [{ label, kind, boosted }] }],
//   selectedTarget, factorText,
//   actions: [{ memberId, actionKey, label, sub, ok, reason }],
//   detonateTurn, steps: [{ index, turn, label, note, ok, reason }],
//   clockText, clockOk, notes: [] }
// cb: onHbombMode, onHbombTarget, onHbombRenAction,
//     onHbombRemoveBomb, onHbombAddHand, onHbombRemoveHand,
//     onHbombTurn, onHbombOmakase, onHbombReset, onHbombDebuffs
// マスシートのシミュレーター（SW95）でも同じ本体を使うため export する。
export function hbombSectionNode(hb, cb) {
  const sec = el('div', 'hbomb-section');
  const head = el('div', 'hbomb-head');
  head.append(el('div', 'build-section-title', 'ハイドロボムの計画'));
  const omakase = el('button', 'hbomb-omakase-btn', 'おまかせ');
  omakase.addEventListener('click', () => cb.onHbombOmakase());
  head.append(omakase);
  const reset = el('button', 'hbomb-reset-btn', '空にする');
  reset.addEventListener('click', () => cb.onHbombReset());
  head.append(reset);
  sec.append(head);

  const tabs = el('div', 'hbomb-tabs');
  for (const [mode, label] of [['ren', '錬の倍率から'], ['turn', 'ターン数から']]) {
    const tab = el('button', `hbomb-tab${hb.mode === mode ? ' on' : ''}`, label);
    tab.addEventListener('click', () => cb.onHbombMode(mode));
    tabs.append(tab);
  }
  if (hb.mode === 'turn') {
    const turnBox = el('span', 'hbomb-turnbox');
    turnBox.append(el('span', 'hbomb-control-label', '起爆'));
    for (const t of [3, 4, 5]) {
      const chip = el('button', `hbomb-chip${t === hb.detonateTurn ? ' on' : ''}`, `${t}ターン`);
      chip.addEventListener('click', () => cb.onHbombTurn(t));
      turnBox.append(chip);
    }
    tabs.append(turnBox);
  }
  sec.append(tabs);

  // 戦場: 敵の陣形どおり2段に並べる。各敵にボム枠とHP。
  const field = el('div', 'hbomb-field');
  for (const row of hb.rows) {
    const rowEl = el('div', 'hbomb-row');
    for (const idx of row) {
      const e = hb.enemies[idx];
      if (!e) continue;
      const tile = el('div', `hbomb-enemy${idx === hb.selectedTarget ? ' is-target' : ''}`);
      const sel = el('button', 'hbomb-enemy-main');
      sel.append(el('span', 'hbomb-enemy-name', e.name));
      sel.append(el('span', 'hbomb-enemy-hp', e.hpText));
      const bar = el('span', 'hbomb-hpbar');
      const fill = el('span', `hbomb-hpfill${e.kills ? ' kills' : ''}`);
      fill.style.width = `${Math.max(0, Math.min(100, e.barPct))}%`;
      bar.append(fill);
      sel.append(bar);
      if (e.resultText) {
        sel.append(el('span', `hbomb-enemy-result${e.kills ? ' kills' : ''}`, e.resultText));
      }
      sel.addEventListener('click', () => cb.onHbombTarget(idx));
      tile.append(sel);
      if (e.bombs.length) {
        const bombs = el('div', 'hbomb-bombs');
        e.bombs.forEach((b, bi) => {
          if (hb.mode === 'ren') {
            const chip = el('button', `hbomb-bomb kind-${b.kind}${b.boosted ? ' boosted' : ''}`, b.label);
            chip.addEventListener('click', () => cb.onHbombRemoveBomb(idx, bi));
            bombs.append(chip);
          } else {
            bombs.append(el('span', `hbomb-bomb kind-${b.kind}${b.boosted ? ' boosted' : ''}`, b.label));
          }
        });
        tile.append(bombs);
      }
      if (e.debuffs && e.debuffs.length) {
        // 弱体・虚弱のチップはボタン: タップで、その敵に付いて
        // いる弱体・状態異常の一覧（発生源つき）がポップアップで
        // 開き、1件ずつ取り除ける。常時表示は要約のチップだけに
        // 留める（全部を並べると邪魔なため、奥に置く）。
        const debuffs = el('div', 'hbomb-debuffs');
        for (const label of e.debuffs) {
          const chip = el('button', 'hbomb-debuff', label);
          chip.addEventListener('click', () => cb.onHbombDebuffs(idx));
          debuffs.append(chip);
        }
        tile.append(debuffs);
      }
      rowEl.append(tile);
    }
    field.append(rowEl);
  }
  sec.append(field);
  if (hb.factorText) sec.append(el('p', 'hbomb-factor', hb.factorText));

  // ターン数モードの手の並び（タップで外す）。
  if (hb.mode === 'turn' && hb.steps.length) {
    const list = el('div', 'hbomb-steps');
    let lastTurn = 0;
    for (const s of hb.steps) {
      if (s.turn !== lastTurn) {
        list.append(el('div', 'hbomb-step-turn', `${s.turn}ターン目`));
        lastTurn = s.turn;
      }
      const chip = el('button', `hbomb-step${s.ok ? '' : ' ng'}`, s.label);
      if (s.note) chip.append(el('span', 'hbomb-step-note', s.note));
      if (!s.ok && s.reason) chip.append(el('span', 'hbomb-step-ng', s.reason));
      chip.addEventListener('click', () => cb.onHbombRemoveHand(s.index));
      list.append(chip);
    }
    sec.append(list);
  }
  if (hb.mode === 'turn' && hb.clockText) {
    sec.append(el('p', `hbomb-clock${hb.clockOk ? '' : ' ng'}`, hb.clockText));
  }

  // 操作エリア: 選択中の敵へのボムの行動（錬成も行動の1つ）。
  const palette = el('div', 'hbomb-palette');
  for (const a of hb.actions) {
    const chip = el('button', `hbomb-action${a.ok ? '' : ' disabled'}`);
    chip.append(el('span', 'hbomb-action-label', a.label));
    if (a.sub) chip.append(el('span', 'hbomb-action-sub', a.sub));
    if (!a.ok && a.reason) chip.append(el('span', 'hbomb-action-reason', a.reason));
    chip.addEventListener('click', () => {
      if (hb.mode === 'ren') cb.onHbombRenAction(a.memberId, a.actionKey);
      else cb.onHbombAddHand(a.memberId, a.actionKey);
    });
    palette.append(chip);
  }
  sec.append(palette);
  for (const n of hb.notes || []) sec.append(el('p', 'hbomb-note', n));
  return sec;
}

// 付着一覧のポップアップ（シートの中身）。敵の弱体・虚弱チップの
// タップで開く。付いている弱体・状態異常を発生源つきで並べ、
// 各項目のタップでその付着を取り除く（ターン数モードでは
// 発生源の手を外す形になる旨を note で出す）。
// vm: { enemyName, note,
//       items: [{ ref, label, source, meta }] }
// cb: onRemove(ref)
export function buildHbombDebuffPopup(vm, cb) {
  const wrap = el('div', 'hbomb-debuff-popup');
  wrap.append(el('div', 'hbomb-popup-title', `${vm.enemyName}に付いている弱体・状態異常`));
  if (vm.note) wrap.append(el('p', 'hbomb-popup-note', vm.note));
  if (!vm.items.length) {
    wrap.append(el('p', 'hbomb-popup-empty', '付いているものはありません'));
  }
  for (const it of vm.items) {
    const b = el('button', 'hbomb-popup-item');
    const head = el('span', 'hbomb-popup-item-head');
    head.append(el('span', 'hbomb-popup-item-label', it.label));
    head.append(el('span', 'hbomb-popup-item-remove', '取り除く'));
    b.append(head);
    if (it.meta) b.append(el('span', 'hbomb-popup-item-meta', it.meta));
    if (it.source) b.append(el('span', 'hbomb-popup-item-source', it.source));
    b.addEventListener('click', () => cb.onRemove(it.ref));
    wrap.append(b);
  }
  return wrap;
}

// 狂炎シミュレーターの割り振りポップアップ（2026-11-20）:
// 対象ランダム×回数系の行動で、合計回数（範囲のあるものは範囲内
// で選べる）と敵ごとのヒット数を決めるシート。Hボムの付着
// ポップアップと同じ部品の流儀。
// vm: { title, note, total, minTotal, maxTotal, canEditTotal, sum,
//       rows: [{ index, name, hpText, count, dmgText, dead,
//                canMinus, canPlus }],
//       canConfirm }
// cb: onTotal(delta), onStep(index, delta), onConfirm, onCancel
export function buildKyoenAllocPopup(vm, cb) {
  const wrap = el('div', 'kyoen-alloc-popup');
  wrap.append(el('div', 'hbomb-popup-title', vm.title));
  if (vm.note) wrap.append(el('p', 'hbomb-popup-note', vm.note));
  const totalRow = el('div', 'kyoen-alloc-total');
  totalRow.append(el('span', 'kyoen-alloc-total-label', '合計'));
  const tMinus = el('button', 'kyoen-alloc-step', '−');
  tMinus.disabled = !vm.canEditTotal || vm.total <= vm.minTotal;
  tMinus.addEventListener('click', () => cb.onTotal(-1));
  totalRow.append(tMinus);
  totalRow.append(el('span', 'kyoen-alloc-total-num', `${vm.total}回`));
  const tPlus = el('button', 'kyoen-alloc-step', '＋');
  tPlus.disabled = !vm.canEditTotal || vm.total >= vm.maxTotal;
  tPlus.addEventListener('click', () => cb.onTotal(1));
  totalRow.append(tPlus);
  totalRow.append(el('span', 'kyoen-alloc-sum', `割り振り ${vm.sum} / ${vm.total}回`));
  wrap.append(totalRow);
  for (const r of vm.rows) {
    const row = el('div', `kyoen-alloc-row${r.dead ? ' dead' : ''}`);
    const head = el('div', 'kyoen-alloc-row-head');
    head.append(el('span', 'kyoen-alloc-name', r.name));
    head.append(el('span', 'kyoen-alloc-hp', r.hpText));
    row.append(head);
    const ctl = el('div', 'kyoen-alloc-ctl');
    const minus = el('button', 'kyoen-alloc-step', '−');
    minus.disabled = !r.canMinus;
    minus.addEventListener('click', () => cb.onStep(r.index, -1));
    ctl.append(minus);
    ctl.append(el('span', 'kyoen-alloc-count', `${r.count}回`));
    const plus = el('button', 'kyoen-alloc-step', '＋');
    plus.disabled = !r.canPlus;
    plus.addEventListener('click', () => cb.onStep(r.index, 1));
    ctl.append(plus);
    if (r.dmgText) ctl.append(el('span', 'kyoen-alloc-dmg', r.dmgText));
    row.append(ctl);
    wrap.append(row);
  }
  const foot = el('div', 'kyoen-alloc-foot');
  const cancel = el('button', 'kyoen-alloc-cancel', 'キャンセル');
  cancel.addEventListener('click', () => cb.onCancel());
  foot.append(cancel);
  const ok = el('button', 'kyoen-alloc-confirm', '決定');
  ok.disabled = !vm.canConfirm;
  ok.addEventListener('click', () => cb.onConfirm());
  foot.append(ok);
  wrap.append(foot);
  return wrap;
}

// 狂炎シミュレーターの反撃ポップアップ（2026-11-20）:
// 反撃した相手（攻撃してきた敵）を選ぶシート。
// vm: { title, note, items: [{ index, name, hpText }] }
// cb: onPick(index), onCancel
export function buildKyoenCounterPopup(vm, cb) {
  const wrap = el('div', 'kyoen-alloc-popup');
  wrap.append(el('div', 'hbomb-popup-title', vm.title));
  if (vm.note) wrap.append(el('p', 'hbomb-popup-note', vm.note));
  for (const it of vm.items) {
    const b = el('button', 'hbomb-popup-item');
    const head = el('span', 'hbomb-popup-item-head');
    head.append(el('span', 'hbomb-popup-item-label', it.name));
    head.append(el('span', 'hbomb-popup-item-meta', it.hpText));
    b.append(head);
    b.addEventListener('click', () => cb.onPick(it.index));
    wrap.append(b);
  }
  const foot = el('div', 'kyoen-alloc-foot');
  const cancel = el('button', 'kyoen-alloc-cancel', 'キャンセル');
  cancel.addEventListener('click', () => cb.onCancel());
  foot.append(cancel);
  wrap.append(foot);
  return wrap;
}

// 狂炎シミュレーターの区画（2026-11-19 実装フライト、モックで
// 承認された圧縮形）。敵一覧・準備／火行動の選択肢・ターン移動が
// 一画面（約660px）に収まる並びにする: 敵（ゲージ＋見通し帯）→
// 地形の状態 → 行動チップ → ターン終了／巻き戻し → 結論。
// 説明文は置かず、ゲームの表記と数値で伝える。
// kyoen: { setupDone, turnText, setupSummary,
//   enjouChoices: [{ uid, label, sub, on }],
//   convertChoices: [{ uid, label, sub, on }],
//   fireChoices: [{ uid, label, sub, disabled? }],
//   groundChoices: [{ uid, label, sub }],
//   delayedChoices: [{ uid, label, sub, on }],
//   shiftChoices: [{ uid, label, sub, on }],
//   relayChoices: [{ uid, label, sub, on }],
//   eventText, reserveText,
//   enemies: [{ index, name, hpText, barPct,
//               bands: [{ leftPct, widthPct, color }],
//               subText, isTarget, dead }],
//   conclusion, canEndTurn, canUndo }
// cb: onKyoenTarget, onKyoenEnjou, onKyoenConvert, onKyoenFire,
//     onKyoenRelay, onKyoenGround, onKyoenDelayed, onKyoenShift,
//     onKyoenEndTurn, onKyoenUndo, onKyoenReset
// マスシートのシミュレーター（SW95）でも同じ本体を使うため export する。
export function kyoenSectionNode(ky, cb) {
  const sec = el('div', 'kyoen-section');
  const head = el('div', 'kyoen-head');
  head.append(el('div', 'build-section-title', '狂炎シミュレーター'));
  if (ky.turnText) head.append(el('span', 'kyoen-turn', ky.turnText));
  if (ky.setupDone) {
    const reset = el('button', 'kyoen-reset-btn', 'はじめから');
    reset.addEventListener('click', () => cb.onKyoenReset());
    head.append(reset);
  }
  sec.append(head);

  const list = el('div', 'kyoen-enemies');
  for (const e of ky.enemies) {
    const row = el('button', `kyoen-enemy${e.isTarget ? ' is-target' : ''}${e.dead ? ' dead' : ''}`);
    const top = el('div', 'kyoen-enemy-top');
    top.append(el('span', 'kyoen-enemy-name', e.name));
    top.append(el('span', 'kyoen-enemy-hp', e.hpText));
    row.append(top);
    const gauge = el('div', 'kyoen-gauge');
    const fill = el('div', 'kyoen-fill');
    fill.style.width = `${Math.max(0, Math.min(100, e.barPct))}%`;
    gauge.append(fill);
    for (const b of e.bands) {
      const seg = el('div', 'kyoen-band');
      seg.style.left = `${b.leftPct}%`;
      seg.style.width = `${b.widthPct}%`;
      seg.style.background = b.color;
      gauge.append(seg);
    }
    row.append(gauge);
    if (e.subText) row.append(el('div', 'kyoen-enemy-sub', e.subText));
    row.addEventListener('click', () => cb.onKyoenTarget(e.index));
    list.append(row);
  }
  sec.append(list);

  // かばうの注記（敵編成にかばう持ちがいる場合だけ、VM 側で
  // 立つ）。地形決定の前後どちらでも見える位置に置く。
  if (ky.kabauNote) sec.append(el('p', 'kyoen-note', ky.kabauNote));

  if (!ky.setupDone) {
    const mkRow = (label, choices, onPick) => {
      const box = el('div', 'kyoen-setup-row');
      box.append(el('span', 'kyoen-setup-label', label));
      const chips = el('div', 'kyoen-chips');
      for (const ch of choices) {
        const chip = el('button', `kyoen-chip${ch.on ? ' on' : ''}`);
        chip.append(el('span', 'kyoen-chip-label', ch.label));
        if (ch.sub) chip.append(el('span', 'kyoen-chip-sub', ch.sub));
        chip.addEventListener('click', () => onPick(ch.uid));
        chips.append(chip);
      }
      box.append(chips);
      return box;
    };
    sec.append(mkRow('炎上', ky.enjouChoices, cb.onKyoenEnjou));
    sec.append(mkRow('狂炎化', ky.convertChoices, cb.onKyoenConvert));
    return sec;
  }

  if (ky.setupSummary) sec.append(el('p', 'kyoen-terrain', `地形: 狂炎（${ky.setupSummary}）`));
  const acts = el('div', 'kyoen-chips');
  for (const ch of ky.fireChoices) {
    const chip = el('button', 'kyoen-chip');
    chip.append(el('span', 'kyoen-chip-label', ch.label));
    if (ch.sub) chip.append(el('span', 'kyoen-chip-sub', ch.sub));
    // シフト後のスキル（バティンB）は火として使えない。
    if (ch.disabled) chip.disabled = true;
    chip.addEventListener('click', () => cb.onKyoenFire(ch.uid));
    acts.append(chip);
  }
  for (const ch of ky.groundChoices || []) {
    const chip = el('button', 'kyoen-chip');
    chip.append(el('span', 'kyoen-chip-label', ch.label));
    if (ch.sub) chip.append(el('span', 'kyoen-chip-sub', ch.sub));
    chip.addEventListener('click', () => cb.onKyoenGround(ch.uid));
    acts.append(chip);
  }
  // 遅延行動の予約ボタン（ナベリウスBの覚醒スキル）。予約中は
  // on の見た目になり、sub にこのターンの火回数と反復回数が出る。
  for (const ch of ky.delayedChoices || []) {
    const chip = el('button', `kyoen-chip${ch.on ? ' on' : ''}`);
    chip.append(el('span', 'kyoen-chip-label', ch.label));
    if (ch.sub) chip.append(el('span', 'kyoen-chip-sub', ch.sub));
    chip.addEventListener('click', () => cb.onKyoenDelayed(ch.uid));
    acts.append(chip);
  }
  // スキルのシフトの引き金（バティンBの覚醒スキル）。シフト後は
  // on の見た目になり、スキルチップ側がシフト後の形に切り替わる。
  for (const ch of ky.shiftChoices || []) {
    const chip = el('button', `kyoen-chip${ch.on ? ' on' : ''}`);
    chip.append(el('span', 'kyoen-chip-label', ch.label));
    if (ch.sub) chip.append(el('span', 'kyoen-chip-sub', ch.sub));
    chip.addEventListener('click', () => cb.onKyoenShift(ch.uid));
    acts.append(chip);
  }
  sec.append(acts);
  if (ky.relayChoices && ky.relayChoices.length) {
    const box = el('div', 'kyoen-setup-row');
    box.append(el('span', 'kyoen-setup-label', '敷き直し'));
    const chips = el('div', 'kyoen-chips kyoen-relay-chips');
    for (const ch of ky.relayChoices) {
      const chip = el('button', 'kyoen-chip');
      chip.append(el('span', 'kyoen-chip-label', ch.label));
      if (ch.sub) chip.append(el('span', 'kyoen-chip-sub', ch.sub));
      chip.addEventListener('click', () => cb.onKyoenRelay(ch.uid));
      chips.append(chip);
    }
    box.append(chips);
    sec.append(box);
  }
  if (ky.eventText) sec.append(el('p', 'kyoen-event', ky.eventText));
  if (ky.reserveText) sec.append(el('p', 'kyoen-reserve', ky.reserveText));
  const ops = el('div', 'kyoen-ops');
  const endBtn = el('button', 'kyoen-end-btn', 'ターン終了');
  endBtn.disabled = !ky.canEndTurn;
  endBtn.addEventListener('click', () => cb.onKyoenEndTurn());
  ops.append(endBtn);
  const undoBtn = el('button', 'kyoen-undo-btn', 'ターン巻き戻し');
  undoBtn.disabled = !ky.canUndo;
  undoBtn.addEventListener('click', () => cb.onKyoenUndo());
  ops.append(undoBtn);
  sec.append(ops);
  if (ky.conclusion) sec.append(el('p', 'kyoen-conclusion', ky.conclusion));
  sec.append(el('p', 'kyoen-note', '乱数は平均で固定して計算した見込みです'));
  return sec;
}

// 戦旗の条件チェックの区画（2026-11-20）。行の材料は main.js の
// flagRowsForSlots（保持者ごとの発揮条件の行）。編成エディタと
// マスシートのシミュレーター（SW95）で同じ本体を使う。
// rows: [{ holderName, targetLabel, slotsLabel, line, targetNote, effect }]
export function flagSectionNode(rows) {
  const box = el('div', 'flag-fit');
  box.append(el('div', 'flag-fit-title', '戦旗（編成内の持ち主）'));
  box.append(el('p', 'sheet-note',
    '戦旗はバトル中に覚醒スキルで付与します。各メンバーが発揮条件をみたしているかを示します。'));
  for (const row of rows) {
    const item = el('div', 'flag-fit-item');
    item.append(el('div', 'flag-fit-head',
      `${row.holderName} の戦旗（${row.targetLabel}: ${row.slotsLabel}）`));
    item.append(el('p', 'flag-fit-line', row.line));
    if (row.targetNote) item.append(el('p', 'flag-fit-note', row.targetNote));
    if (row.effect) item.append(el('p', 'flag-fit-effect', row.effect));
    box.append(item);
  }
  return box;
}

// ---- 編成エディタ ----
// 並びは使う時の思考順（2026-11-19 ユーザー指示・同日の順序訂正込み、
// 2026-11-20 編成名の扱いを変更）:
//   使うステージを選ぶ（ターゲット。選ぶと自動タグとギミックが出て、
//   枠の候補に「ターゲットへの対応」のヒントが効く）→
//   メギドを選択（枠）→ マスエフェクトの要約 →
//   カスタムタグ・メモ → 保存ボタン（押すと「編成名を決める」段へ。
//   編成名はエディタに固定しない。2026-11-20 ユーザー指示）。
// 保存できない理由は警告行ではなく保存ボタン自体の文面に出す
// （2026-11-20 ユーザー指示）。保存を妨げない注意だけが、従来どおり
// 保存ボタンの直上の警告行に出る。
// vm: { title,
//       slots: [{ index, label, isLeader, filled, name, displayName,
//                 styleText, orbText,
//                 reishouSummary, spdText, spdDetail, spdParts,
//                 meCondText, meMatch, reishou4Text }],
//       counters: { rows: [{ mark, color, label, state, text }] } | null,
//       target: { enemyName, floors: [{floor, on}],
//                 autoTags: [{text, category}],
//                 band: { summary, pointTitles: [string] } | null,
//                 bandTappable, targetText } | null,
//       customTags, notes, warnings: [string], leaderMissing, saveBlockReason,
//       meFit: { leaderName, state, name, summary,
//                lines: [{effect, positions, genderUnknown}],
//                sub: { holderName, lines } | null, subNote }
//              | { leaderName, state: 'missing' } | null,
//       meNote }
// cb: { onSlotTap, onOrbTap, onReishouTap, onSave, onCancel,
//       onOpenEnemyPicker, onToggleTargetFloor, onCustomTagsChange,
//       onNotesChange, onBandTap }
// 戻り値: { content, actionBar }（actionBar は警告＋ボタンの固定部。
// 下部の「閉じる」とは別に、エディタ自体の操作はここに集める）
export function buildFormationEditor(vm, cb) {
  const content = el('div', 'formation-builder');
  content.append(el('h2', 'sheet-title', vm.title));

  // (1) 対象（SW92）: 対象が入っている時は、対象チップと敵の小帯
  // （名前・簡単な説明1行・攻略のポイントの◇タイトル）だけを枠の
  // そばに置く。枠より前に敵情報を何画面も置かない。対象が無い時
  // だけ、従来の入口（使うステージを選ぶ＋敵ボタン）を出す。
  // マスから入った編成では、マスで見ていた敵が対象に入った状態で
  // 始まる（入口の文脈を落とさない。main 側の preset）。
  if (vm.target && typeof cb.onOpenEnemyPicker === 'function') {
    const target = el('div', 'build-target');
    if (vm.target.enemyName) {
      const chipRow = el('div', 'build-target-chiprow');
      chipRow.append(el('span', 'target-chip',
        `対象: ${vm.target.targetText || vm.target.enemyName}`));
      const changeBtn = el('button', 'btn-target-change', '対象を変える');
      changeBtn.addEventListener('click', cb.onOpenEnemyPicker);
      chipRow.append(changeBtn);
      target.append(chipRow);
      // 敵の小帯: タップでマスシートへ戻るのは、マスから入った
      // 編成だけ（vm.target.bandTappable）。
      if (vm.target.band) {
        const band = el(vm.target.bandTappable ? 'button' : 'div', 'enemy-band');
        band.append(el('div', 'enemy-band-name', vm.target.enemyName));
        if (vm.target.band.summary) {
          band.append(el('div', 'enemy-band-desc', vm.target.band.summary));
        }
        if (vm.target.band.pointTitles.length > 0) {
          const pts = el('div', 'enemy-band-points');
          for (const t of vm.target.band.pointTitles) {
            pts.append(el('span', 'enemy-band-point', `◇${t}`));
          }
          band.append(pts);
        }
        if (vm.target.bandTappable && typeof cb.onBandTap === 'function') {
          band.addEventListener('click', cb.onBandTap);
        }
        target.append(band);
      }
      const checks = el('div', 'floor-checks');
      for (const f of vm.target.floors) {
        const chip = el('button', `floor-check${f.on ? ' on' : ''}`, `${f.floor}F`);
        chip.dataset.floor = String(f.floor);
        chip.addEventListener('click', () => cb.onToggleTargetFloor(f.floor));
        checks.append(chip);
      }
      target.append(checks);
      // 選んだら自動で付くタグ（カスタムタグとは別扱い。保存のたびに
      // 作り直される側で、ここでは付く内容を先に見せる）。
      if (Array.isArray(vm.target.autoTags) && vm.target.autoTags.length > 0) {
        const tagRow = el('div', 'tag-row build-autotags');
        tagRow.append(el('span', 'pill-label', '自動で付くタグ'));
        for (const t of vm.target.autoTags) {
          tagRow.append(el('span', `tag-chip tag-${t.category}`, t.text));
        }
        target.append(tagRow);
      }
    } else {
      target.append(el('div', 'build-target-title', '使うステージを選ぶ'));
      const enemyBtn = el('button', 'btn-target-enemy', 'エネミーを選択…');
      enemyBtn.addEventListener('click', cb.onOpenEnemyPicker);
      target.append(enemyBtn);
    }
    content.append(target);
  }

  // (2) メギドを選択: 枠とメンバー。注意書きは見出しと同じ行の
  // 右側に置く（2026-11-20 ユーザー指示。文面も指示どおり）。
  const slotHead = el('div', 'build-section-head');
  slotHead.append(el('span', 'build-section-title', 'メギドを選択'));
  slotHead.append(el('span', 'build-section-note', '枠をタップするとメギドを選択できます'));
  content.append(slotHead);
  const grid = el('div', 'slot-grid');
  for (const slot of vm.slots) {
    const cell = el('div', `slot-cell${slot.isLeader ? ' leader' : ''}`);
    const main = el('button', 'build-slot-main');
    main.dataset.slotIndex = String(slot.index);
    main.append(el('div', 'slot-pos', slot.isLeader ? 'リーダー' : `枠${slot.label}`));
    // 顔は小さくし、スタイル×クラスの複合アイコンは顔の右下の
    // バッジに重ねる（5体横一列の枠ではアイコンの行を取れない。
    // 2026-11-20）。名前は枠内だけ短縮名で出す（SW93。正本
    // research/short-names.md）。従来の fit-x（横に縮める）は
    // この名前表示からは廃止した（他の要素の fit-x は不変）。
    // 顔の照合にはフルネーム（slot.name）を使う。
    if (slot.filled && slot.name) main.append(faceWithStyleClassBadge(slot.name, slot.style, slot.className));
    main.append(el('div', 'slot-name', slot.filled ? (slot.displayName || slot.name) : '（空き）'));
    // 空き枠のヒント（2026-11-19）: リーダーが決まっている時だけ、
    // そのリーダーの ME の枠条件を出す（編成作成のヒント）。
    if (!slot.filled && slot.meCondText) {
      main.append(el('div', 'slot-me-cond', `ME条件: ${slot.meCondText}`));
    }
    if (slot.filled && slot.style) {
      // スタイルは色のチップ、段階は段階色の文字で持たせる（文字も併記）。
      // スタイル×クラスの複合アイコンは顔のバッジ側に移した。
      const styleLine = el('div', 'slot-style');
      styleLine.append(styleChip(slot.style));
      // クラスと段階は1行に並べると 9 文字で枠幅を超え、横フィット
      // （scaleX）は子要素を含む行では位置がずれるため、クラスと
      // 段階をそれぞれ自分の行に置く（どちらも短く、素の字で入る）。
      const meta = el('span', 'slot-style-meta');
      meta.append(el('span', 'slot-style-class', slot.className || ''));
      meta.append(el('span', `slot-style-stage sc-${slot.stage}`, slot.stageLabel || ''));
      styleLine.append(meta);
      main.append(styleLine);
    } else if (slot.filled) {
      main.append(el('div', 'slot-style', slot.styleText));
    }
    // 実効素早さの数値（補正込み）。内訳は補正がある時だけ下に
    // 小さく出す（基礎値と補正込みの関係が分かる形）。
    if (slot.filled && slot.spdText) {
      const spdBox = el('div', 'slot-spd');
      spdBox.append(el('span', 'slot-spd-value', slot.spdText));
      // 内訳は補正ごとの向き（↑↓と色）つきで出す。構造化した
      // 内訳が無い vm では従来の文字列のまま。
      if (Array.isArray(slot.spdParts) && slot.spdParts.length > 0) {
        spdBox.append(slotSpdDetailNode(slot.spdParts));
      } else if (slot.spdDetail) {
        spdBox.append(el('span', 'slot-spd-detail', slot.spdDetail));
      }
      main.append(spdBox);
    }
    // 埋まった枠の印（2026-11-19）: その枠の ME 条件に合っている
    // 時だけ小さく出す（合っていない・判定できない時は出さない）。
    if (slot.filled && slot.meMatch) {
      main.append(el('div', 'slot-me-match fit-x', '✓ ME条件に合う'));
    }
    // 霊宝4つ装備が条件の第2特性（候補2、2026-11-20）: 凸の解禁と
    // 装備数の両方を満たす時だけ、発動中と分かる印を ME の印の
    // 並びに出す（満たさない時は出さない）。
    // 特性名が枠の幅で単語の途中で割れないよう、見出しと特性名を
    // 2行に分ける（2026-11-20 枠の表示崩れ修正。中身は全部出す）。
    if (slot.filled && slot.reishou4Text) {
      const r4 = el('div', 'slot-reishou4');
      r4.append(el('span', 'slot-reishou4-line fit-x', '✓ 第2特性 発動中'));
      r4.append(el('span', 'slot-reishou4-name fit-x', `「${slot.reishou4Text}」`));
      main.append(r4);
    }
    main.addEventListener('click', () => cb.onSlotTap(slot.index));
    cell.append(main);
    if (slot.filled) {
      // オーブ名が単語の途中で割れないよう、ラベルと名前を分ける
      // （名前は nowrap。割れる時は境目だけで割れる）。
      const orbBtn = el('button', 'build-slot-orb');
      orbBtn.append(el('span', 'slot-orb-label', 'オーブ: '));
      orbBtn.append(el('span', 'slot-orb-name fit-x', slot.orbText));
      orbBtn.dataset.slotIndex = String(slot.index);
      orbBtn.addEventListener('click', () => cb.onOrbTap(slot.index));
      cell.append(orbBtn);
      if (typeof cb.onReishouTap === 'function') {
        // 霊宝ボタンは圧縮表示（個数＋専用印＋素早さ分だけ）。
        // 名前の確認と付け替えはピッカー側で行う。
        const reiBtn = el('button', 'build-slot-reishou');
        reiBtn.append(reishouSummaryNode(slot.reishouSummary));
        reiBtn.dataset.slotIndex = String(slot.index);
        reiBtn.addEventListener('click', () => cb.onReishouTap(slot.index));
        cell.append(reiBtn);
      }
    }
    grid.append(cell);
  }
  content.append(grid);

  // (2.4) 編成が満たしているギミック（SW92、問題E。旧「対策の行」。
  // 見出しは 2026-11-25 マスター決定で変更）: 脅威ごとに、判定の範囲を
  // そのまま文章にした行を並べる。「対策済み」の一括り断定と件数の
  // 見出しは置かない。色は状態（満たしている／一部だけ届く・入り／
  // 足りない）を担う。文章の組み立ては main 側（targetCountersVm）。
  // サイズは全ページの3点セット（節見出し20px／本文12px／ラベル10px）。
  if (vm.counters && vm.counters.rows.length > 0) {
    const sec = el('div', 'counters');
    sec.append(el('div', 'build-section-title', '編成が満たしているギミック'));
    for (const row of vm.counters.rows) {
      const line = el('div', 'counter-row');
      line.append(el('span', `counter-dot dot-${row.state}`));
      const body = el('span', 'counter-body');
      body.append(el('span', 'counter-label', `${row.label}: `));
      body.append(el('span', 'counter-text', row.text));
      line.append(body);
      sec.append(line);
    }
    content.append(sec);
  }

  // (2.5) タイムライン（SW92）: 速度順の表（敵も混ぜる）を枠の下に
  // 常時出し、チェインの組み立てもその上で行う。使うステージを
  // 選んだ編成では、チェインが成立しない場合でもタイムラインだけは
  // 出す（見るだけの表）。
  if (vm.chain && typeof cb.onChainOrigin === 'function') {
    content.append(chainSectionNode(vm.chain, cb));
  }

  // (2.6) Hボムプランナー: 編成にHボム技を持つメギドがいる時だけ
  // 出す。戦場と選択肢を1つの区画に収める。
  if (vm.hbomb && typeof cb.onHbombMode === 'function') {
    content.append(hbombSectionNode(vm.hbomb, cb));
  }

  // (2.7) 狂炎シミュレーター: 使うステージを選んでいて、編成に
  // 狂炎化と炎上の手段がある時だけ出す。
  if (vm.kyoen && typeof cb.onKyoenTarget === 'function') {
    content.append(kyoenSectionNode(vm.kyoen, cb));
  }

  // (3) リーダーのマスエフェクト（M6）: 枠ごとの原文の羅列は出さず、
  // その編成で実際に効いている効果だけを集約して出す。
  if (vm.meFit) {
    const fit = el('div', 'me-fit');
    fit.append(el('div', 'me-fit-title', `マスエフェクト（リーダー: ${vm.meFit.leaderName}）`));
    if (vm.meFit.state === 'loaded') {
      fit.append(el('div', 'me-fit-name', vm.meFit.name));
      if (vm.meFit.summary) fit.append(el('p', 'sheet-note', vm.meFit.summary));
      const lines = vm.meFit.lines || [];
      if (lines.length > 0) {
        for (const line of lines) fit.append(meSummaryLine(line));
      } else {
        fit.append(el('p', 'sheet-note', '今のメンバーが受ける効果はありません。'));
      }
      if (vm.meFit.sub) {
        fit.append(el('div', 'me-fit-sub-title',
          `サブマスエフェクト（${vm.meFit.sub.holderName}）`));
        fit.append(el('p', 'sheet-note',
          'リーダーのマスエフェクトの3つ目の効果は、この効果で上書きされます。'));
        const subLines = vm.meFit.sub.lines || [];
        if (subLines.length > 0) {
          for (const line of subLines) fit.append(meSummaryLine(line));
        } else {
          fit.append(el('p', 'sheet-note', '今のメンバーが受ける効果はありません。'));
        }
      }
      if (vm.meFit.subNote) {
        fit.append(el('p', 'sheet-note', vm.meFit.subNote));
      }
    } else {
      fit.append(el('p', 'sheet-note', 'マスエフェクト未収録'));
    }
    content.append(fit);
  } else if (vm.meNote) {
    content.append(el('p', 'sheet-note', vm.meNote));
  }

  // (3.5) 戦旗の条件チェック（2026-11-20）: 編成に戦旗持ちがいる
  // 時だけ、ME 要約の直下に出す。戦旗はバトル中に覚醒スキルで
  // 付与するものなので、ここでは付与先のメンバーが発揮条件を
  // みたしているかの確認だけを示す（上書きの再現はしない）。
  if (Array.isArray(vm.flag) && vm.flag.length > 0) {
    content.append(flagSectionNode(vm.flag));
  }

  // (3.5) 地割れと破断の「こうなる」（2026-11-20）: 地割れ付与者と
  // 破断保持者が両方いて、使うステージが選ばれている時だけ出す。
  // 数値の根拠（前提）は末尾の1行に明示する（main.js の VM）。
  if (vm.hadanJiware) {
    const box = el('div', 'build-me');
    box.append(el('div', 'build-me-title',
      `地割れと破断: ${vm.hadanJiware.jiwareNames.join('・')}の地割れと、${vm.hadanJiware.hadanNames.join('・')}の破断`));
    for (const row of vm.hadanJiware.rows) {
      const rowBox = el('div', 'flag-fit-row');
      rowBox.append(el('div', 'flag-fit-head', `${row.enemyName}: ${row.head}`));
      for (const line of row.lines) {
        rowBox.append(el('div', 'flag-fit-line', line));
      }
      box.append(rowBox);
    }
    box.append(el('div', 'flag-fit-note', vm.hadanJiware.premise));
    content.append(box);
  }

  // (3.5) 割合軽減の「受ける量」（2026-11-20）: アスモデウスRの
  // 第2特性とグラシャラボラスの伝説のオーラについて、選択中の
  // ステージの敵の攻撃と突き合わせた無効化の目安。
  if (vm.withstand) {
    const box = el('div', 'build-me');
    box.append(el('div', 'build-me-title', '割合軽減で受けられる量'));
    for (const row of vm.withstand.rows) {
      const rowBox = el('div', 'flag-fit-row');
      rowBox.append(el('div', 'flag-fit-head', `${row.holderName}: ${row.head}`));
      for (const line of row.lines) {
        rowBox.append(el('div', 'flag-fit-line', line));
      }
      box.append(rowBox);
    }
    box.append(el('div', 'flag-fit-note', vm.withstand.premise));
    content.append(box);
  }

  // (3.6) 受けダメージの見積もり（積4、2026-11-20）: 選択中の
  // ステージの敵の攻撃を素で受けて、落ちる味方だけを出す。
  // 前提はブロックの頭に固定で置く（判断の記録）。
  if (vm.damageEstimate) {
    const est = vm.damageEstimate;
    const box = el('div', 'build-me');
    box.append(el('div', 'build-me-title', `危険行動に対する見積もり（対 ${est.enemyName}）`));
    box.append(el('div', 'flag-fit-note', est.premise));
    if (!est.attacksRead) {
      box.append(el('div', 'flag-fit-line', '敵の攻撃が文面から読めなかったため、この見積もりは出せない'));
    } else if (est.falls.length === 0) {
      box.append(el('div', 'flag-fit-line', '一撃で落ちる味方はいない（見込み）'));
      for (const line of damageEstimateSafeLines(est)) {
        box.append(el('div', 'flag-fit-line', line));
      }
    } else {
      for (const fall of est.falls) {
        const rowBox = el('div', 'flag-fit-row');
        rowBox.append(el('div', 'flag-fit-head', `${fall.allyName}が落ちる見込み（HP${fall.hp}）`));
        for (const hit of fall.hits) {
          rowBox.append(el('div', 'flag-fit-line', damageEstimateHitText(hit)));
        }
        box.append(rowBox);
      }
    }
    content.append(box);
  }

  // (4) カスタムタグとメモは、マスエフェクトの表示の下に置く。
  // カスタムタグ（カンマ区切り。棚卸し 5-6）。
  if (typeof cb.onCustomTagsChange === 'function') {
    const field = el('div', 'build-field');
    field.append(el('label', 'build-field-label', 'カスタムタグ（カンマ区切り）'));
    const input = document.createElement('input');
    input.className = 'build-text-input build-tags-input';
    input.type = 'text';
    input.value = vm.customTags || '';
    input.addEventListener('input', () => cb.onCustomTagsChange(input.value));
    field.append(input);
    content.append(field);
  }

  // 戦術メモ（棚卸し 4-9）: placeholder の例文が書き方の教えを担う。
  if (typeof cb.onNotesChange === 'function') {
    const field = el('div', 'build-field');
    field.append(el('label', 'build-field-label', 'メモ'));
    const input = document.createElement('textarea');
    input.className = 'build-memo-input';
    input.value = vm.notes || '';
    input.setAttribute('placeholder', '戦術メモを入力... (例: 1T目にスキルが取れなければリタイア)');
    input.addEventListener('input', () => cb.onNotesChange(input.value));
    field.append(input);
    content.append(field);
  }

  // (5) 警告を見て保存: 保存を妨げない注意（編成全体にかかる仕組み
  // の注意）は保存ボタンの直上にまとめる。保存できない理由は警告行
  // には出さず、無効化された保存ボタン自体の文面で示す
  // （2026-11-20 ユーザー指示）。
  const bottom = el('div', 'build-bottom');
  const warnings = vm.warnings || [];
  if (warnings.length > 0) {
    const warnBox = el('div', 'build-warnings');
    for (const w of warnings) warnBox.append(el('p', 'build-warn-line', w));
    bottom.append(warnBox);
  }
  const actionBar = el('div', 'sheet-actionbar');
  const saveBtn = el('button', 'sheet-action-btn act-save-formation');
  if (vm.leaderMissing) {
    saveBtn.disabled = true;
    saveBtn.append(el('span', 'act-save-main', '保存できません'));
    saveBtn.append(el('span', 'act-save-reason',
      vm.saveBlockReason || 'リーダー（中央の枠）が空です'));
  } else {
    saveBtn.textContent = '保存';
  }
  saveBtn.addEventListener('click', cb.onSave);
  actionBar.append(saveBtn);
  const cancelBtn = el('button', 'sheet-action-btn act-cancel-build', 'やめる');
  cancelBtn.addEventListener('click', cb.onCancel);
  actionBar.append(cancelBtn);
  bottom.append(actionBar);
  return { content, actionBar: bottom };
}

// ---- 編成名を決める段（2026-11-20 ユーザー指示） ----
// 保存ボタンを押した後に挟む段。編成名の入力はエディタ本体から
// 撤去し、ここにだけ置く。既存の編成では現在の名前が入った状態で
// 出す。空のまま保存すると自動で名前が付く（従来の保存規則のまま。
// saveFormation 側の自動命名）。
// vm: { name, namePlaceholder }
// cb: { onNameChange, onConfirm, onBack }
// 戻り値: { content, actionBar, nameInput }
export function buildFormationNameStep(vm, cb) {
  const content = el('div', 'formation-builder');
  content.append(el('h2', 'sheet-title', '編成名を決める'));
  const field = el('div', 'megido-field');
  field.append(el('span', 'megido-field-label', '編成名'));
  const nameInput = document.createElement('input');
  nameInput.className = 'formation-search build-name-input';
  nameInput.type = 'text';
  nameInput.value = vm.name || '';
  nameInput.setAttribute('placeholder', vm.namePlaceholder || '');
  nameInput.addEventListener('input', () => cb.onNameChange(nameInput.value));
  field.append(nameInput);
  content.append(field);
  content.append(el('p', 'sheet-note', '空のまま保存すると、自動で名前が付きます。'));
  const actionBar = el('div', 'sheet-actionbar');
  const confirmBtn = el('button', 'sheet-action-btn act-confirm-name', 'この名前で保存');
  confirmBtn.addEventListener('click', () => cb.onConfirm());
  actionBar.append(confirmBtn);
  const backBtn = el('button', 'sheet-action-btn act-name-back', '戻る');
  backBtn.addEventListener('click', () => cb.onBack());
  actionBar.append(backBtn);
  return { content, actionBar, nameInput };
}

// ---- 枠の候補 ----
// vm: { slotLabel, query, styleFilter, classFilter,
//       guide: { targetText, enemyLabel, threats: [string], prioritized },
//       rows: [{ id, name, style, className, stageText, spdText, isCurrent,
//                meFits: [{ label, effectText }], marks: [string],
//                marksMore, noteMark, noteLines: [string],
//                validReasons: [string], demandReasons: [string] }],
//       shownCount, totalCount, slotFilled }
// cb: { onQuery, onStyleFilter, onClassFilter, onPick, onClearSlot, onBack,
//       onToggleFilter, onSwipeHide, onSwipeDetail, onDismissSwipeHint }
// 戻り値: { top, content, searchInput }
export function buildSlotCandidates(vm, cb) {
  // トップは常時固定の1行だけ（2026-11-25 再設計）: 見出し＋絞り込み。
  // メギド候補に「今の状態＋外す」の2行目は無い（正本の決定）。
  // 検索・チップは絞り込みアコーディオンの中。案内文（対象・脅威・
  // 並びの説明）と「この枠を空にする」は置かない（説明文は置かない
  // という再設計の決定。空にする操作はエディタ側の領分のまま）。
  const top = el('div', 'formation-tools picker-tools');
  const filterActive = Boolean(vm.query || vm.styleFilter || vm.classFilter);
  top.append(pickerHeadNode({
    title: `候補を選ぶ（${vm.slotLabel}）`,
    filterOpen: vm.filterOpen, filterActive, onToggleFilter: cb.onToggleFilter,
  }));
  const filterBox = pickerFilterBox(vm, cb);
  const search = document.createElement('input');
  search.className = 'formation-search';
  search.type = 'text';
  search.value = vm.query;
  search.setAttribute('placeholder', '名前で検索');
  bindSearchInput(search, (value) => cb.onQuery(value));
  filterBox.append(search);
  // 絞り込みチップはグループ（スタイル／クラス）ごとに行を分ける
  // （見た目の段、2026-11-20。1つの流れに混ぜると境目が読めない）。
  // グループ名は先頭の「○○: すべて」チップが担う。
  const styleFilters = el('div', 'formation-filters');
  for (const s of [null, 'ラッシュ', 'カウンター', 'バースト']) {
    const btn = el('button', `filter-chip${vm.styleFilter === s ? ' active' : ''}`,
      s === null ? 'スタイル: すべて' : s);
    btn.dataset.style = s === null ? '' : s;
    btn.addEventListener('click', () => cb.onStyleFilter(s));
    styleFilters.append(btn);
  }
  filterBox.append(styleFilters);
  const classFilters = el('div', 'formation-filters');
  for (const c of [null, 'ファイター', 'トルーパー', 'スナイパー']) {
    const btn = el('button', `filter-chip${vm.classFilter === c ? ' active' : ''}`,
      c === null ? 'クラス: すべて' : c);
    btn.dataset.className = c === null ? '' : c;
    btn.addEventListener('click', () => cb.onClassFilter(c));
    classFilters.append(btn);
  }
  filterBox.append(classFilters);
  filterBox.append(el('div', 'formation-count', `${vm.shownCount} 件（全 ${vm.totalCount} 件）`));
  top.append(filterBox);

  const content = el('div', 'slot-candidates');
  const list = el('div', 'cand-list');
  // スワイプの初回ヒント（1行だけ。使うか閉じたら二度と出さない。
  // 判定と永続化は main 側、ここでは表示と通知だけ）。
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
    // 候補そのものは常時全員を出す設計（SW92）のため、ここに来るのは
    // 検索・絞り込みで0件になった時だけ。その旨だけを短く出す。
    list.append(el('p', 'sheet-note', '絞り込みに合う候補はいません。'));
  }
  for (const row of vm.rows) {
    // 行は2行＋理由（2026-11-25 再設計、2026-11-26 問題6で改訂）:
    // 1行目 = 顔＋名前（大きく、全行同位置）＋コンディション座布団
    // （右端固定）。2行目 = 速さ数値／✓の印（菫文字、無い行は空き）
    // ／後の階の印。その下に、印の理由を行の中に書く（タップの
    // 先に隠す形は廃止）。理由の無い行は従来どおり2行固定の高さ
    // で、理由のある行だけ理由の分だけ伸びる。
    // スタイルのピル・文字、クラス名、手段の長い文は行から落とす
    // （詳細は右スワイプ側、内訳は選んだ後の場面）。
    // ✓の印は「この文脈で有効な材料がある」ことの表示で、材料は
    // 従来どおり ME の条件行を満たす（row.meFits）か、脅威への
    // 対策の手段を持つ（row.marks）か。文言は具体名入りの
    // 「✓○○が有効」（2026-11-27）。
    const btn = el('button', 'cand-row megido-row');
    btn.dataset.megidoId = row.id;
    const line1 = el('div', 'cand-line1');
    line1.append(faceWithStyle(row.name, row.style));
    line1.append(el('span', 'cand-name-text',
      row.isCurrent ? `${row.name}（現在）` : row.name));
    const stage = stageOfRow(row);
    if (stage != null && row.stageText) {
      line1.append(el('span', `cand-cond-chip cond-${stage}`, row.stageText));
    }
    btn.append(line1);
    const line2 = el('div', 'cand-line2');
    line2.append(el('span', 'cand-spd', row.spdText || ''));
    const valid = (row.meFits && row.meFits.length > 0)
      || (row.marks && row.marks.length > 0);
    // 印の文言（2026-11-27 マスター指示）: 集約表示「✓有効」を
    // やめ、先頭の根拠の具体名入り「✓○○が有効」にする。具体名は
    // main 側が理由材料から組む（row.validMark）。具体名が取れない
    // 候補（ME 適合だけ等）には印自体を出さない（汎用の「✓有効」へ
    // 倒さない。根拠は行の中の理由行が担う）。
    const validEl = el('span', 'cand-valid',
      row.validMark ? `✓${row.validMark}が有効` : '');
    line2.append(validEl);
    // 音符発生の注記（2026-11-20）: 協奏・重奏の始動役がいる時だけ。
    // 2行目の同じ行に置く（行数は増やさない）。
    if (row.noteMark) {
      line2.append(noteMarkEl());
    }
    // 後の階の印: 需要の文そのものではなく、黄の座布団チップを
    // ✓の印の隣に出す（J7 の黄座布団と整合）。材料は noteLines の
    // 需要行（従来の判定のまま）。文言は最も近い階入りの
    // 「{N}階で出番の可能性」（2026-11-27 マスター指示。階は
    // main 側が需要の材料から組む row.demandFloor）。階が無い
    // 材料の時だけ従来文言に倒す（通常の経路では需要の材料から
    // 必ず階が取れるため、倒れるのは材料の無い組み立てだけ）。
    const hasDemand = (row.noteLines || [])
      .some((n) => n.startsWith('後の階で出番がある可能性あり'));
    if (hasDemand) {
      const demandText = typeof row.demandFloor === 'number'
        ? `${row.demandFloor}階で出番の可能性`
        : '後の階で出番あり';
      line2.append(el('span', 'cand-demand-chip', demandText));
    }
    btn.append(line2);
    // 印の理由を行の中に書く（問題6）: ✓有効の理由（なぜ有効か）
    // と、出番ありの理由（後の階が具体的にどの階か。材料の
    // demandReasonLines が階つきで組む）。同じ行は1つに寄せる。
    const reasonLines = [];
    if (valid) {
      for (const line of row.validReasons || []) {
        if (!reasonLines.includes(line)) reasonLines.push(line);
      }
    }
    if (hasDemand) {
      for (const line of row.demandReasons || []) {
        if (!reasonLines.includes(line)) reasonLines.push(line);
      }
    }
    const reasonsNode = candReasonsNode(reasonLines);
    if (reasonsNode) {
      btn.classList.add('has-reasons');
      btn.append(reasonsNode);
    }
    btn.addEventListener('click', () => {
      if (isSwipeSuppressed(btn)) return;
      cb.onPick(row.id);
    });
    // スワイプ（タイプA）: 左＝候補から外す、右＝詳細シート。
    // コールバックが無い呼び出しでは付けない（従来のタップのみ）。
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
  // 戻るはトップ1行の見出し横（オーバーレイのボタン）が担う。
  // 本文末尾の戻るボタンは置かない（再設計の共通文法）。
  return { top, content, searchInput: search };
}

// ---- オーブの選択 ----
// オーブは606件のカタログなので、装備できないものを並べること自体が
// ノイズになる（マスター判断）。一覧には、そのメンバーに装備できるもの
// だけを出す（絞り込みは main 側で済ませてから渡す）。検索も装備できる
// 範囲の中で効く。件数は「装備できるもの ○件」の形で出す。
// 詳細フィルタ（棚卸し 5-20）: 種族のチップでも絞れる。
// 検索・絞り込み（2026-11-19）: 検索は名前・種族に加えて効果文（特性・
// スキル）も対象にし、CT と効果種類のチップでも絞れる（選択肢は装備
// できる範囲に在るものだけ）。行には効果文を出す（効果検索で当たった
// 理由がその場で分かるように）。
// 種族フィルタは組み合わせ文字列ではなく個別の種族で作り（オーブが
// その種族を持てばヒットする含む判定）、絞り込み行は CT → 効果 →
// 種族の順で全て1行の横スクロール列にする（種族の一覧が画面を埋めて
// 一覧を押し出さないため。検索が主経路、種族は絞り込みの一つ）。
// vm: { memberName, memberStyle, query, races: [種族名], raceFilter,
//       cts: [数値], ctFilter, kinds: [分類名], kindFilter,
//       filterOpen, hasOrb,
//       rows: [{ id, name, meta, ct, effectLines, isCurrent,
//               spdAfterText, spdAfterDir, spdNow, spdAfter,
//               targetMark, targetReasons: [string], auraMark, noteMark }],
//       shownCount, totalCount,
//       spdContext: { memberName, spdText, spdDetail, spdParts,
//                     enemies: [{ name, spdText, spdDir }],
//                     fastestText, verdictText,
//                     fastestSpd, memberSpd } | null,
//       noneSpdAfterText, noneSpdAfterDir }
//       （totalCount は装備できるものの総数）
// spdContext は使うステージを選んでいる時だけ付く（2026-11-19）:
// 2026-11-25 再設計で、表示はトップ2行目の結論1行（敵最速○○／
// 自分○○・速い／同速／遅い）に寄せ、敵全員の内訳は出さない。
// 素早さ補正を持つオーブの行には、付けた後の値を spdNow / spdAfter
// の数値で出し、「速○○→○○ ↑」の形にする（spdAfterText は
// 従来形の呼び出し向けの予備）。
// cb: { onQuery, onPick, onBack, onRaceFilter, onCtFilter, onKindFilter,
//       onToggleFilter }
//     （onPick には orbId か null（なし）が返る）
// 戻り値: { top, content, searchInput }
// オーブピッカーのトップ2行目の結論文（2026-11-25 再設計）:
// 敵最速と自分の素早さの結論だけを1行で出す（敵の内訳一覧の箱は
// 廃止）。材料は spdContext の数値（fastestSpd / memberSpd）が正で、
// 無い呼び出し形では従来の文（fastestText / spdText）から数値を引く。
function orbConclusionText(ctx) {
  let fastest = typeof ctx.fastestSpd === 'number' ? ctx.fastestSpd : null;
  let member = typeof ctx.memberSpd === 'number' ? ctx.memberSpd : null;
  if (fastest == null && ctx.fastestText) {
    const m = /素早さ(\d+)/.exec(ctx.fastestText);
    if (m) fastest = Number(m[1]);
  }
  if (member == null && ctx.spdText) {
    const m = /(\d+)/.exec(ctx.spdText);
    if (m) member = Number(m[1]);
  }
  if (fastest == null || member == null) return null;
  const short = member > fastest ? '速い' : member === fastest ? '同速' : '遅い';
  return `敵最速${fastest}／${ctx.memberName}${member}・${short}`;
}
// 行の素早さの結果（右下固定）: 数値の材料（spdNow / spdAfter）が
// ある時は「速283→310 ↑」の形（矢印も色も方向 = 既存の
// spd-up / spd-down）。無い呼び出し形では従来の文のまま出す。
function orbSpdResultEl(row) {
  if (typeof row.spdAfter === 'number' && typeof row.spdNow === 'number') {
    const arrow = row.spdAfterDir === 'up' ? ' ↑' : row.spdAfterDir === 'down' ? ' ↓' : '';
    return el('span', `orb-spd-after${spdDirClass(row.spdAfterDir)}`,
      `速${row.spdNow}→${row.spdAfter}${arrow}`);
  }
  if (row.spdAfterText) {
    return spdAfterLine(row.spdAfterText, row.spdAfterDir, 'cand-meta orb-spd-after');
  }
  return null;
}

export function buildOrbPicker(vm, cb) {
  // トップ（常時固定）: 1行目 = 見出し＋絞り込み＋戻る。
  // 2行目 = 素早さ比較の結論（左）＋［オーブを外す］（右）。
  // 「オーブなし」のカードは廃止し、外すは2行目へ寄せた。
  // オーブ未装備の時は外すが沈んだ塗りつぶしになりボタンでなくなる。
  const top = el('div', 'formation-tools picker-tools');
  const filterActive = Boolean(vm.query || vm.raceFilter || vm.ctFilter || vm.kindFilter);
  top.append(pickerHeadNode({
    title: `オーブを選ぶ（${vm.memberName}）`,
    filterOpen: vm.filterOpen, filterActive, onToggleFilter: cb.onToggleFilter,
  }));
  const state = el('div', 'picker-state');
  const conclusion = vm.spdContext ? orbConclusionText(vm.spdContext) : null;
  state.append(el('span', 'picker-state-text orb-state-text', conclusion || ''));
  const hasOrb = typeof vm.hasOrb === 'boolean'
    ? vm.hasOrb
    : (vm.rows || []).some((r) => r.isCurrent);
  const noneBtn = el('button', 'picker-clear act-orb-none', 'オーブを外す');
  if (!hasOrb) noneBtn.disabled = true;
  noneBtn.addEventListener('click', () => cb.onPick(null));
  state.append(noneBtn);
  top.append(state);
  // 外した後の素早さ（現在のオーブに補正がある時だけ）: 状態行の
  // 下に小さく出す（従来は「オーブなし」の行の中にあった材料）。
  if (vm.noneSpdAfterText) {
    top.append(spdAfterLine(vm.noneSpdAfterText, vm.noneSpdAfterDir, 'picker-state-sub orb-spd-after'));
  }
  const filterBox = pickerFilterBox(vm, cb);
  const search = document.createElement('input');
  search.className = 'formation-search';
  search.type = 'text';
  search.value = vm.query;
  search.setAttribute('placeholder', 'オーブ名・種族・効果で検索');
  bindSearchInput(search, (value) => cb.onQuery(value));
  filterBox.append(search);
  // 絞り込み行は CT → 効果 → 種族の順で、全て1行の横スクロール列にする
  // （値の列挙が一覧を画面外へ押し出さないため。種族は主経路ではなく
  // 絞り込みの一つとして最後に置く）。
  if (Array.isArray(vm.cts) && vm.cts.length > 0 && typeof cb.onCtFilter === 'function') {
    const filters = el('div', 'formation-filters scroll-row');
    const allBtn = el('button', `filter-chip${!vm.ctFilter ? ' active' : ''}`, 'CT: すべて');
    allBtn.addEventListener('click', () => cb.onCtFilter(null));
    filters.append(allBtn);
    for (const ct of vm.cts) {
      const btn = el('button', `filter-chip${vm.ctFilter === ct ? ' active' : ''}`, `CT${ct}`);
      btn.dataset.ct = String(ct);
      btn.addEventListener('click', () => cb.onCtFilter(ct));
      filters.append(btn);
    }
    filterBox.append(filters);
  }
  if (Array.isArray(vm.kinds) && vm.kinds.length > 0 && typeof cb.onKindFilter === 'function') {
    const filters = el('div', 'formation-filters scroll-row');
    const allBtn = el('button', `filter-chip${!vm.kindFilter ? ' active' : ''}`, '効果: すべて');
    allBtn.addEventListener('click', () => cb.onKindFilter(null));
    filters.append(allBtn);
    for (const kind of vm.kinds) {
      const btn = el('button', `filter-chip${vm.kindFilter === kind ? ' active' : ''}`, kind);
      btn.dataset.kind = kind;
      btn.addEventListener('click', () => cb.onKindFilter(kind));
      filters.append(btn);
    }
    filterBox.append(filters);
  }
  if (Array.isArray(vm.races) && vm.races.length > 0 && typeof cb.onRaceFilter === 'function') {
    const filters = el('div', 'formation-filters scroll-row');
    const allBtn = el('button', `filter-chip${!vm.raceFilter ? ' active' : ''}`, '種族: すべて');
    allBtn.addEventListener('click', () => cb.onRaceFilter(null));
    filters.append(allBtn);
    for (const race of vm.races) {
      const btn = el('button', `filter-chip${vm.raceFilter === race ? ' active' : ''}`, race);
      btn.dataset.race = race;
      btn.addEventListener('click', () => cb.onRaceFilter(race));
      filters.append(btn);
    }
    filterBox.append(filters);
  }
  filterBox.append(el('div', 'formation-count',
    vm.shownCount === vm.totalCount
      ? `装備できるもの ${vm.totalCount} 件`
      : `装備できるもの ${vm.totalCount} 件（${vm.shownCount} 件を表示）`));
  top.append(filterBox);

  const content = el('div', 'orb-picker');
  const list = el('div', 'cand-list');
  if (vm.rows.length === 0) {
    list.append(el('p', 'sheet-note', '条件に合うオーブがありません。'));
  }
  for (const row of vm.rows) {
    // 行は4行＋理由（2026-11-25 再設計、2026-11-26 問題6で改訂）:
    // 名前／CT（右端固定）／特性1行／スキル1行／✓有効（菫文字、
    // 固定位置）＋素早さの結果（右下固定）。印のある行には理由を
    // 行の中に書く（理由のある行だけ高さが伸びる）。装備条件の
    // スタイル・種族は行に出さない（装備できるものだけが並ぶ
    // 前提）。3行目以降の効果文（エレキの育て役の行）はスキルの
    // 行に寄せて行数を保つ。
    const btn = el('button', 'cand-row orb-row');
    btn.dataset.orbId = row.id;
    const line1 = el('div', 'cand-line1');
    line1.append(el('span', 'cand-name-text',
      row.isCurrent ? `${row.name}（現在）` : row.name));
    const ct = typeof row.ct === 'number' ? row.ct
      : (() => { const m = row.meta ? /CT(\d+)/.exec(row.meta) : null; return m ? Number(m[1]) : null; })();
    if (ct != null) line1.append(el('span', 'orb-ct', `CT${ct}`));
    btn.append(line1);
    const effectLines = row.effectLines || [];
    effectLines.forEach((line, i) => {
      if (i < 2) btn.append(el('div', 'cand-meta orb-effect', line));
      else {
        const prev = btn.children[btn.children.length - 1];
        prev.textContent = `${prev.textContent}／${line}`;
      }
    });
    const line4 = el('div', 'cand-line4');
    // ターゲットの敵に有効なオーブの印（2026-11-20）: メギドの
    // ピッカーと同じ形・同じ根拠の文面で出す。判定できない・
    // 効かないオーブには付けない。理由は行の中に書く（問題6、
    // 2026-11-26。タップで出す形は廃止）。
    if (row.targetMark) {
      line4.append(el('div', 'cand-target-match', `✓ ${row.targetMark}`));
    }
    // オーラ対応の印（2026-11-20）: 装備するメギドのオーラが
    // 指定する種族に合うオーブに出す（row.auraMark に合った種族
    // まで入っている）。オーラ持ちでないメギドのピッカーでは
    // main 側が全行 null にするため現れない。✓有効と同じ行に置く。
    if (row.auraMark) {
      line4.append(el('div', 'cand-aura-match', row.auraMark));
    }
    // 音符発生の注記（2026-11-20）: メギドのピッカーと同じ形
    // （アイコン＋「音符発生」）。編成に協奏・重奏の始動役が
    // いる時だけ main 側が立てる。同じく4行目に置く。
    if (row.noteMark) {
      line4.append(noteMarkEl());
    }
    const spdEl = orbSpdResultEl(row);
    if (spdEl) line4.append(spdEl);
    btn.append(line4);
    // 印の理由を行の中に書く（問題6）: 印のある行だけ、印の理由
    // （row.targetReasons）を4行目の下に足す。理由のある行だけ
    // 高さが伸びる（has-reasons）。
    if (row.targetMark) {
      const reasonsNode = candReasonsNode(row.targetReasons || []);
      if (reasonsNode) {
        btn.classList.add('has-reasons');
        btn.append(reasonsNode);
      }
    }
    btn.addEventListener('click', () => {
      if (isSwipeSuppressed(btn)) return;
      cb.onPick(row.id);
    });
    // スワイプ（タイプA）: 左＝候補から外す、右＝詳細シート。
    // コールバックが無い呼び出しでは付けない（従来のタップのみ）。
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
  // 戻るはトップ1行の見出し横（オーバーレイのボタン）が担う。
  return { top, content, searchInput: search };
}

// ---- ターゲットの敵の選択（棚卸し 5-4） ----
// 塔に登場する敵から検索して選ぶ。行には登場する階を併記する
// （選んだ後に、その階がチェックの対象になる）。
// vm: { query, currentTarget, filterOpen,
//       rows: [{ name, floorsText, isCurrent }], shownCount, totalCount }
// cb: { onQuery, onPick(name), onClear, onBack, onToggleFilter }
// 戻り値: { top, content, searchInput }
export function buildEnemyPicker(vm, cb) {
  // トップ（常時固定）: 1行目 = 見出し＋絞り込み（検索のみ）＋戻る。
  // 2行目 = 「現在のターゲット: ○○［外す］」。未設定の時は外すが
  // 沈んだ塗りつぶしになりボタンでなくなる。「ターゲットなし」の
  // 先頭行は廃止（2026-11-25 再設計）。
  const top = el('div', 'formation-tools picker-tools');
  top.append(pickerHeadNode({
    title: 'ターゲットの敵を選ぶ',
    filterOpen: vm.filterOpen, filterActive: Boolean(vm.query),
    onToggleFilter: cb.onToggleFilter,
  }));
  const current = vm.currentTarget
    || (vm.rows || []).find((r) => r.isCurrent)?.name || null;
  const state = el('div', 'picker-state');
  state.append(el('span', 'picker-state-text',
    current ? `現在のターゲット: ${current}` : '現在のターゲット: なし'));
  const clearBtn = el('button', 'picker-clear act-enemy-clear', '外す');
  if (!current) clearBtn.disabled = true;
  if (typeof cb.onClear === 'function') {
    clearBtn.addEventListener('click', cb.onClear);
  }
  state.append(clearBtn);
  top.append(state);
  const filterBox = pickerFilterBox(vm, cb);
  const search = document.createElement('input');
  search.className = 'formation-search';
  search.type = 'text';
  search.value = vm.query;
  search.setAttribute('placeholder', '敵の名前で検索');
  bindSearchInput(search, (value) => cb.onQuery(value));
  filterBox.append(search);
  filterBox.append(el('div', 'formation-count', `${vm.shownCount} 件（全 ${vm.totalCount} 件）`));
  top.append(filterBox);

  const content = el('div', 'enemy-picker');
  const list = el('div', 'cand-list');
  if (vm.rows.length === 0) {
    list.append(el('p', 'sheet-note', '条件に合う敵がありません。'));
  }
  for (const row of vm.rows) {
    const btn = el('button', 'cand-row enemy-row');
    btn.dataset.enemyName = row.name;
    btn.append(el('div', 'cand-name', row.isCurrent ? `${row.name}（現在）` : row.name));
    if (row.floorsText) btn.append(el('div', 'cand-meta', `登場: ${row.floorsText}`));
    btn.addEventListener('click', () => cb.onPick(row.name));
    list.append(btn);
  }
  content.append(list);
  // 戻るはトップ1行の見出し横（オーバーレイのボタン）が担う。
  return { top, content, searchInput: search };
}

// ---- 霊宝の選択（棚卸し 5-20 の霊宝側） ----
// 装備できるもの（スタイルで判定）だけを出し、検索と系譜フィルタで
// 絞る。装備は1体4枠までで、同じ霊宝を複数の枠に付けることもできる。
// トップ2行目の枠チップで編集する枠を選び、行タップでその枠に付ける
// （付け替え）。枠チップの横の「外す」で選んでいる枠を空にする。
// 出口はトップ右の「完了」1つ（2026-11-25 再設計）。
// vm: { memberName, query, lineages: [系譜名], lineageFilter,
//       filterOpen,
//       slots: [{ name } | null]（4枠ぶん）, activeSlot: 枠番号,
//       rows: [{ id, name, meta, lineage, size, statsText, effectsText,
//               slotIndexes: [枠番号], spdAfterText, spdAfterDir }],
//       shownCount, totalCount, clearSpdAfterText, clearSpdAfterDir }
// spdAfterText は素早さ補正のある行だけに付く「付けると素早さ○○」
// （オーブピッカーと同じ形）。clearSpdAfterText は編集中の枠に
// 素早さ補正のある霊宝が付いている時だけの「外すと素早さ○○」。
// 向き（dir）は ↑↓と色の統一表記に使う。
// cb: { onQuery, onLineageFilter, onSelectSlot(index), onClearSlot(),
//       onPick(id), onDone }
// 戻り値: { top, content, searchInput, bottom }
export function buildReishouPicker(vm, cb) {
  // トップ（常時固定）: 1行目 = 見出し＋絞り込み＋［完了］（トップ右は
  // 菫塗りの完了1つに統合し、戻るは廃止。完了はオーバーレイの
  // 見出し横ボタンが closeLabel「完了」で担う）。
  // 2行目 = 枠チップ［枠1］［枠2］［枠3］［枠4］［外す］。
  // 選んでいる枠は形で分かる（B4 の選択の形）。選んでいる枠が
  // 空の時は外すが塗りつぶされて押せない。説明文は全て置かない
  // （2026-11-25 再設計）。
  const top = el('div', 'formation-tools picker-tools reishou-tools');
  const filterActive = Boolean(vm.query || vm.lineageFilter);
  top.append(pickerHeadNode({
    title: `霊宝を選ぶ（${vm.memberName}）`,
    filterOpen: vm.filterOpen, filterActive, onToggleFilter: cb.onToggleFilter,
  }));
  const state = el('div', 'picker-state reishou-state');
  (vm.slots || []).forEach((slot, i) => {
    const btn = el('button', `reishou-slot-chip${i === vm.activeSlot ? ' active' : ''}`,
      `枠${i + 1}`);
    btn.dataset.slotIndex = String(i);
    if (slot) btn.title = slot.name;
    btn.addEventListener('click', () => cb.onSelectSlot(i));
    state.append(btn);
  });
  const activeSlot = (vm.slots || [])[vm.activeSlot] || null;
  const clearBtn = el('button', 'reishou-slot-clear', '外す');
  if (!activeSlot) clearBtn.disabled = true;
  clearBtn.addEventListener('click', () => cb.onClearSlot());
  state.append(clearBtn);
  // 外した後の素早さ（編集中の枠に素早さ補正のある霊宝が付いて
  // いる時だけ、外すボタンのそばに出す。オーブピッカーと同じ形）。
  if (vm.clearSpdAfterText) {
    state.append(spdAfterLine(vm.clearSpdAfterText, vm.clearSpdAfterDir, 'reishou-spd-after'));
  }
  top.append(state);
  const filterBox = pickerFilterBox(vm, cb);
  const search = document.createElement('input');
  search.className = 'formation-search';
  search.type = 'text';
  search.value = vm.query;
  search.setAttribute('placeholder', '霊宝名・系譜・効果で検索');
  bindSearchInput(search, (value) => cb.onQuery(value));
  filterBox.append(search);
  if (Array.isArray(vm.lineages) && vm.lineages.length > 0) {
    const filters = el('div', 'formation-filters');
    const allBtn = el('button', `filter-chip${!vm.lineageFilter ? ' active' : ''}`, '系譜: すべて');
    allBtn.addEventListener('click', () => cb.onLineageFilter(null));
    filters.append(allBtn);
    for (const lin of vm.lineages) {
      const btn = el('button', `filter-chip${vm.lineageFilter === lin ? ' active' : ''}`, lin);
      btn.dataset.lineage = lin;
      btn.addEventListener('click', () => cb.onLineageFilter(lin));
      filters.append(btn);
    }
    filterBox.append(filters);
  }
  filterBox.append(el('div', 'formation-count',
    vm.shownCount === vm.totalCount
      ? `装備できるもの ${vm.totalCount} 件`
      : `装備できるもの ${vm.totalCount} 件（${vm.shownCount} 件を表示）`));
  top.append(filterBox);

  const content = el('div', 'reishou-picker');
  const list = el('div', 'cand-list');
  if (vm.rows.length === 0) {
    list.append(el('p', 'sheet-note', '条件に合う霊宝がありません。'));
  }
  for (const row of vm.rows) {
    // 行は3行固定（2026-11-25 再設計）: 名前＋系譜の印（名前の横に
    // 小さく）＋大きさ／上がるステータスと数値／効果文の要約＋
    // 素早さの結果（固定位置、矢印と色）。材料は構造化した
    // lineage / size / statsText / effectsText が正で、無い呼び出し
    // 形では従来の meta を効果文の位置に出す。
    const inSlots = Array.isArray(row.slotIndexes) ? row.slotIndexes : [];
    const btn = el('button', `cand-row reishou-row${inSlots.includes(vm.activeSlot) ? ' picked' : ''}`);
    btn.dataset.reishouId = row.id;
    const nameLine = el('div', 'cand-line1');
    nameLine.append(el('span', 'cand-name-text', row.name));
    if (row.lineage) {
      nameLine.append(el('span', 'reishou-lineage-mark', row.lineage));
    }
    if (row.size) {
      nameLine.append(el('span', 'reishou-size', row.size));
    }
    if (inSlots.length > 0) {
      nameLine.append(el('span', 'reishou-row-state',
        `枠${inSlots.map((i) => i + 1).join('・')}に付けている`));
    }
    btn.append(nameLine);
    if (typeof row.statsText === 'string' || typeof row.effectsText === 'string') {
      btn.append(el('div', 'cand-meta reishou-stats', row.statsText || ''));
      const line3 = el('div', 'reishou-line3');
      line3.append(el('span', 'reishou-effect', row.effectsText || ''));
      // 付けた後の素早さ（素早さ補正のある行だけ。オーブピッカーと
      // 同じ形で、変化の向きは↑↓と色で出す）。3行目の右端固定。
      if (row.spdAfterText) {
        line3.append(spdAfterLine(row.spdAfterText, row.spdAfterDir, 'reishou-spd-after'));
      }
      btn.append(line3);
    } else {
      if (row.meta) btn.append(el('div', 'cand-meta', row.meta));
      if (row.spdAfterText) {
        btn.append(spdAfterLine(row.spdAfterText, row.spdAfterDir, 'cand-meta reishou-spd-after'));
      }
    }
    btn.addEventListener('click', () => cb.onPick(row.id));
    list.append(btn);
  }
  content.append(list);

  // 完了はトップ右（オーバーレイの見出し横ボタン）に統合したため、
  // 下部のバーは返さない。
  return { top, content, searchInput: search, bottom: null };
}
