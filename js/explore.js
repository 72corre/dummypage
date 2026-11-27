// 探索に出すメンバー（M7）の計算（純粋関数群）
// 探索力の式は requirements.md M7 と megido-basics.v1.json の併記仕様が正:
//   探索力 = （攻撃力×素早さ/1000 ＋ HP×防御力/10000）
//            ×（1 ＋ 現在の奥義レベル×0.05）× コンディション補正 × おすすめ補正
// おすすめの対象（スタイル・クラス）は挑戦ごとにランダムで、ツール側では
// 導出できない。そのためシートで利用者にゲーム画面の表示を転記してもらい
// （導出できない入力の1つ。ui-flow.md の横断の前提）、選ばれた場合だけ
// 補正を含めて計算する。選ばれていない場合は補正なしで計算し、その前提を
// 数字の近くに明示する（過小評価側に倒す）。
// 探索のパーティは最大3体（research/tower-system-wiki.md）。
// DOM・保存には触れない。

import { CONDITION_STAGES, STAGE_FAINTED, BUFF_SUBTYPES, BUFF_STAT_BY_SUBTYPE, BUFF_STAT_LABEL, STYLE_ORDER, STYLE_NAME, DMG_TYPE_LABEL, DMG_TYPE_ORDER } from './derive.js';
import { resolveMegidoStats, savedLevelOf } from './stats.js';

export const EXPLORE_PARTY_MAX = 3;
// 期待度3のしきい値（推奨探索力×1.4）。
export const EXPECTATION3_FACTOR = 1.4;
// 育成値が無い場合の奥義レベルの既定（移行の正規化デフォルトと同じ）。
export const DEFAULT_OUGI_LEVEL = 3;

// ---- おすすめ補正の規則（この節に閉じ込める） ----
// 合致条件は 2026-11-18 にユーザーが確定したゲーム事実:
//   スタイルかクラスのどちらか一方が一致すれば、そのメンバーは1.8倍。
//   両方一致しても1.8倍のまま（側ごとに重ねない）。
// osusume はシートで転記された選択 { style, className }（どちらも null
// なら未選択＝補正なし）。member は { style, className } を持つ相手。
export const OSUSUME_BONUS = 1.8;

export function osusumeMatches(member, osusume) {
  if (!osusume || (!osusume.style && !osusume.className)) return false;
  if (!member) return false;
  if (osusume.style && member.style === osusume.style) return true;
  if (osusume.className && member.className === osusume.className) return true;
  return false;
}

export function osusumeFactor(member, osusume) {
  return osusumeMatches(member, osusume) ? OSUSUME_BONUS : 1;
}

// 合致の内訳（表示用: 「合致」だけでなく、スタイルとクラスのどちらが
// 合ったかまで言うための材料）。
export function osusumeMatchKinds(member, osusume) {
  if (!osusume || !member) return { style: false, className: false };
  return {
    style: Boolean(osusume.style && member.style === osusume.style),
    className: Boolean(osusume.className && member.className === osusume.className),
  };
}

function osusumeMatchSpread(member, osusume) {
  const k = osusumeMatchKinds(member, osusume);
  return { matchedStyle: k.style, matchedClass: k.className };
}

// おすすめの選択が有効か（スタイルかクラスのどちらかが選ばれているか）。
export function osusumeActive(osusume) {
  return Boolean(osusume && (osusume.style || osusume.className));
}

// おすすめ転記の次の状態（2026-11-19 ユーザー補正で単一選択に確定）。
// ゲームのおすすめ表示はスタイルかクラスのどちらか一方だけで、両方
// 同時ということはない。したがって転記も、スタイル群とクラス群を
// 通じた単一選択にする: スタイルを選べばクラスは解除され、クラスを
// 選べばスタイルは解除される。同じ値をもう一度選ぶと未選択に戻る。
// 状態は「未選択」か「スタイル1つ」か「クラス1つ」の三通りだけ。
// pick は { style } か { className }。戻り値は新しい転記値（未選択は null）。
export function nextOsusume(current, pick) {
  if (pick && pick.style != null) {
    return current && current.style === pick.style
      ? null
      : { style: pick.style, className: null };
  }
  if (pick && pick.className != null) {
    return current && current.className === pick.className
      ? null
      : { style: null, className: pick.className };
  }
  return current || null;
}

// そのメギドの現在の奥義レベル（利用者の育成値から取る）。
export function ougiLevelOf(megidoDetails, megidoId) {
  const entry = megidoDetails && megidoDetails[megidoId];
  return entry && typeof entry.ougiLevel === 'number' ? entry.ougiLevel : DEFAULT_OUGI_LEVEL;
}

// 装備中の霊宝のステータス修正値の合計（2026-11-19）。
// 装備の正はメギド側（megidoDetails の reishou = 霊宝IDの配列）。
// reishouStatsById は霊宝ID → {hp, atk, def, spd}（各値は数値か null）の
// Map（通常のオブジェクトでも可）。装備が無い・マスタが無い場合は null。
// 修正値の収録が無い霊宝（stats 自体が無い）は 0 として扱わず、合計には
// 入れない（呼び出し側は「収録のある分だけ込み」であることを前提にする）。
export function reishouStatMods(megidoDetails, megidoId, reishouStatsById) {
  if (!reishouStatsById) return null;
  const entry = megidoDetails && megidoDetails[megidoId];
  const ids = entry && Array.isArray(entry.reishou) ? entry.reishou : [];
  if (ids.length === 0) return null;
  const get = typeof reishouStatsById.get === 'function'
    ? (id) => reishouStatsById.get(id)
    : (id) => reishouStatsById[id];
  const mods = { hp: 0, atk: 0, def: 0, spd: 0 };
  let any = false;
  for (const id of ids) {
    const s = get(id);
    if (!s) continue;
    for (const k of ['hp', 'atk', 'def', 'spd']) {
      if (typeof s[k] === 'number') { mods[k] += s[k]; any = true; }
    }
  }
  return any ? mods : null;
}

// 1体の探索力。stage は段階インデックス（derive.js の conditionOf の値）。
// 気絶は送り出せないため 0 とする。bonusFactor はおすすめ補正（合致で
// OSUSUME_BONUS、通常は1）。補正の判定は osusumeFactor に閉じ込める。
// statMods は装備中の霊宝の修正値の合計（reishouStatMods）で、基礎
// ステータスに加算してから式に入れる（Wiki: 探索力は霊宝のステータス
// 補正の影響を受ける）。基礎ステータスは stats.js の解決を通す
// （保存レベルに応じた魔重解放の上昇分が乗る。Lv70 は従来と一致）。
export function explorationPower(megidoBasics, megido, ougiLevel, stage, bonusFactor = 1, statMods = null, savedLevel = 70) {
  if (stage >= STAGE_FAINTED) return 0;
  const s = resolveMegidoStats(megido, savedLevel);
  if (!s) return 0;
  const atk = s.atk + (statMods ? statMods.atk : 0);
  const spd = s.spd + (statMods ? statMods.spd : 0);
  const hp = s.hp + (statMods ? statMods.hp : 0);
  const def = s.def + (statMods ? statMods.def : 0);
  const base = (atk * spd) / 1000 + (hp * def) / 10000;
  const factors = megidoBasics.explorationPower.factors;
  const condFactor = factors.condition[CONDITION_STAGES[stage]] ?? 1;
  return base * (1 + ougiLevel * 0.05) * condFactor * bonusFactor;
}

// 探索に出すとコンディションが2段階下がった後の段階（導出の規則どおり）。
// 表示用（メンバーごとの事情）に使う。
export function exploreAfterStage(stage) {
  return Math.min(stage + 2, STAGE_FAINTED);
}

// 利用者が選んだ任意の組み合わせを評価する（M7 の組み替え）。
// 合計探索力と、到達できる期待度をそのまま返す。到達できる期待度が下がる
// 組み替えも利用者の判断として許し、現在の期待度を正直に返す。
// memberIds の並びは表示順として保つ。基礎データに無い id は無視する。
export function evaluateCombo({ megidoBasics, megidoDetails, conditionOf, memberIds, recommendedPower, osusume = null, reishouStatsById = null }) {
  const byId = new Map(megidoBasics.megido.map((m) => [m.id, m]));
  const members = [];
  let total = 0;
  for (const id of memberIds) {
    const m = byId.get(id);
    if (!m) continue;
    const stage = conditionOf(id);
    const probe = { style: m.style, className: m.class };
    const power = explorationPower(megidoBasics, m, ougiLevelOf(megidoDetails, id), stage, osusumeFactor(probe, osusume), reishouStatMods(megidoDetails, id, reishouStatsById), savedLevelOf(megidoDetails, id));
    members.push({
      id: m.id, no: m.no, name: m.name, style: m.style, className: m.class, stage, power,
      matched: osusumeMatches(probe, osusume), ...osusumeMatchSpread(probe, osusume),
    });
    total += power;
  }
  const target = recommendedPower * EXPECTATION3_FACTOR;
  const expectation = total >= target ? 3 : total >= recommendedPower ? 2 : 1;
  return { members, total, target, recommendedPower, expectation, reached: total >= target };
}

// 組み替えの候補（M7）: 所持していて、気絶でなく、組み合わせに入っていない者。
// excludeNos は同一キャラクター（番号が同じ別スタイル）の重なり防止、
// excludeIds は本人（入れ替え元など）の除外に使う。
// 並びは探索力の高い順（同点は ID 順で決定的に）。
export function exploreCandidates({ megidoBasics, megidoDetails, owned, conditionOf, excludeNos, excludeIds, osusume = null, reishouStatsById = null }) {
  const noSet = new Set(excludeNos || []);
  const idSet = new Set(excludeIds || []);
  const rows = [];
  for (const m of megidoBasics.megido) {
    if (!owned.has(m.id)) continue;
    if (idSet.has(m.id)) continue;
    if (noSet.has(m.no)) continue;
    const stage = conditionOf(m.id);
    if (stage >= STAGE_FAINTED) continue;
    const probe = { style: m.style, className: m.class };
    rows.push({
      id: m.id,
      no: m.no,
      name: m.name,
      style: m.style,
      className: m.class,
      stage,
      matched: osusumeMatches(probe, osusume), ...osusumeMatchSpread(probe, osusume),
      power: explorationPower(megidoBasics, m, ougiLevelOf(megidoDetails, m.id), stage, osusumeFactor(probe, osusume), reishouStatMods(megidoDetails, m.id, reishouStatsById), savedLevelOf(megidoDetails, m.id)),
    });
  }
  rows.sort((a, b) => (b.power - a.power) || (a.id < b.id ? -1 : 1));
  return rows;
}

// ---- 報酬の見込み（期待度への換算） ----
// 箱色は探索した後に分かる結果で、利用者が操作できるのは探索力（期待度）の方。
// そのため「この期待度なら何が出る所か」を見込みとして出す（ui-flow.md M7）。
// 箱色ごとの規模表は、見込みと同じ情報の二重表示になるため出さない
// （2026-11-19 のユーザー判断で撤去）。
// 見込みは構造データの箱効果表から導出できる範囲だけを返し、
// 表に無い部分は作らない（null を返す）。

// 期待度から出る箱（構造データの boxByExpectation と同じ法則）。
export const BOXES_BY_EXPECTATION = { 1: ['緑'], 2: ['青'], 3: ['赤', '虹'] };

function recoveryEffectText(entry) {
  if (!entry) return null;
  const one = (e) => `${e.count}体×${e.stages}段階`;
  return Array.isArray(entry) ? entry.map(one).join('、または') : one(entry);
}

function powerEffectText(value) {
  if (value == null) return null;
  return Array.isArray(value) ? `${value[0]}〜${value[1]}` : String(value);
}

// バフの箱効果（生文字列 "5%+ダメージ上昇5%" など）を、数値と追加効果に分ける。
function parseBuffRaw(raw) {
  const parts = String(raw).split('+');
  return { pct: Number.parseFloat(parts[0]), extras: parts.slice(1) };
}

// バフ量の表示の確定形（2026-11-19 ユーザー指定）: 離散値は範囲に
// まとめ、「か」で選択肢をつながない。追加効果（ランダムのボーナス）の
// 目は、数値入りの列挙にせず注記の文で出す（数値は注記に入れない）。
export const BUFF_BONUS_NOTE = '期待度3の場合、まれにランダムにボーナス（単体・範囲ダメージ上昇や塔破力回復）';

// 1つの箱のバフ効果を「主上昇量の範囲」と「ボーナスの目の有無」に分ける。
function buffBoxRange(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return null;
  const parsed = rawList.map(parseBuffRaw);
  if (parsed.some((p) => !Number.isFinite(p.pct))) return null;
  return {
    min: Math.min(...parsed.map((p) => p.pct)),
    max: Math.max(...parsed.map((p) => p.pct)),
    hasBonus: parsed.some((p) => p.extras.length > 0),
  };
}

function buffRangeText(range) {
  return range.min === range.max ? `+${range.min}%` : `+${range.min}%～${range.max}%`;
}

// 期待度の箱の並びから、主表示に出す範囲を決める。ボーナスの目を持た
// ない箱（標準の結果）が主で、ボーナス付きの箱の量は主表示に出さず
// 注記に回す（期待度3: 主は赤の範囲、虹は注記）。
function buffMainRange(ranges) {
  const plain = ranges.filter((r) => !r.hasBonus);
  const src = plain.length > 0 ? plain : ranges;
  return {
    min: Math.min(...src.map((r) => r.min)),
    max: Math.max(...src.map((r) => r.max)),
  };
}

function buffStatLabelFor(def) {
  if (def.subType === 'status_buff') return 'いずれかのステータス';
  return BUFF_STAT_LABEL[BUFF_STAT_BY_SUBTYPE[def.subType]];
}

// 期待度に換算した見込み（予測報酬）。def は探索マスの定義
// （subType / recommendedPower）。導出できない場合は null。
export function expectationOutlook({ explorationModel, def, expectation }) {
  const model = explorationModel || {};
  const boxes = BOXES_BY_EXPECTATION[expectation] || [];
  if (def.subType === 'recovery') {
    const table = model.conditionRecovery[String(def.recommendedPower)] || {};
    const parts = boxes
      .map((box) => {
        const text = recoveryEffectText(table[box]);
        return text ? `${box}の箱で${text}の回復` : null;
      })
      .filter(Boolean);
    return parts.length > 0 ? `見込み: ${parts.join('か、')}が出る所です` : null;
  }
  if (def.subType === 'tower_power') {
    const table = model.towerPowerRecovery[String(def.recommendedPower)] || {};
    const parts = boxes
      .map((box) => {
        const text = powerEffectText(table[box]);
        return text ? `${text}（${box}）` : null;
      })
      .filter(Boolean);
    return parts.length > 0 ? `見込み: 塔破力が${parts.join('、または')}回復する所です` : null;
  }
  if (BUFF_SUBTYPES.has(def.subType)) {
    // 見込み行の確定形（2026-11-19 ユーザー指定）: ラベル「見込み：」＋
    // ステータス名＋範囲だけ。「か」でつながず、「緑で」「上がる所です」
    // のような地の文を付けない。ボーナスの目は注記（expectationOutlookNote）。
    const table = model.buffBoxEffects || {};
    const statLabel = buffStatLabelFor(def);
    if (!statLabel) return null;
    const ranges = boxes.map((box) => buffBoxRange(table[box])).filter(Boolean);
    if (ranges.length === 0) return null;
    return `見込み：${statLabel}${buffRangeText(buffMainRange(ranges))}`;
  }
  return null;
}

// 見込みの注記（バフマスでボーナスの目がある期待度だけ、主行とは別に
// 出す）。回復・塔破力には注記は無い。
export function expectationOutlookNote({ explorationModel, def, expectation }) {
  if (!BUFF_SUBTYPES.has(def.subType)) return null;
  const model = explorationModel || {};
  const table = model.buffBoxEffects || {};
  const boxes = BOXES_BY_EXPECTATION[expectation] || [];
  const hasBonus = boxes.some((box) => {
    const range = buffBoxRange(table[box]);
    return range && range.hasBonus;
  });
  return hasBonus ? BUFF_BONUS_NOTE : null;
}

// 期待度ごとの報酬の要約（ストリップ表示用に短くした形）。
// expectationOutlook と同じ表から導き、表に無い規模は作らない（null）。
// 箱の名前は出さず、効果そのもので表す（色はゲーム側の見た目の名前であり、
// ツールが扱うのは効果の方 — ui-flow.md M7 の確定形と同じ考え方）。
// 戻り値は { main, note }: バフマスでは main が「ステータス名：範囲」の
// 確定形になり、ボーナスの目は note（字下げの別行）になる。
export function expectationRewardParts({ explorationModel, def, expectation }) {
  const model = explorationModel || {};
  const boxes = BOXES_BY_EXPECTATION[expectation] || [];
  if (def.subType === 'recovery') {
    const table = model.conditionRecovery[String(def.recommendedPower)] || {};
    const texts = boxes
      .map((box) => recoveryEffectText(table[box]))
      .filter(Boolean);
    return { main: texts.length > 0 ? `${texts.join(' か ')} の回復` : null, note: null };
  }
  if (def.subType === 'tower_power') {
    const table = model.towerPowerRecovery[String(def.recommendedPower)] || {};
    const texts = boxes
      .map((box) => powerEffectText(table[box]))
      .filter(Boolean);
    return { main: texts.length > 0 ? `塔破力 ${texts.join(' か ')} 回復` : null, note: null };
  }
  if (BUFF_SUBTYPES.has(def.subType)) {
    const table = model.buffBoxEffects || {};
    const statLabel = buffStatLabelFor(def);
    if (!statLabel) return { main: null, note: null };
    const ranges = boxes.map((box) => buffBoxRange(table[box])).filter(Boolean);
    if (ranges.length === 0) return { main: null, note: null };
    return {
      main: `${statLabel}：${buffRangeText(buffMainRange(ranges))}`,
      note: ranges.some((r) => r.hasBonus) ? BUFF_BONUS_NOTE : null,
    };
  }
  return { main: null, note: null };
}

// 期待度ストリップの材料（期待度3・2・1 の順）:
// 各期待度に必要な合計探索力と、その期待度で出る報酬の要約。
// 戻り値: [{ expectation, needText, rewardText, rewardNote }]
export function expectationStrip({ explorationModel, def }) {
  const rec = def.recommendedPower;
  const needs = {
    3: String(Math.round(rec * EXPECTATION3_FACTOR)),
    2: String(rec),
    1: `${rec}未満`,
  };
  return [3, 2, 1].map((expectation) => {
    const parts = expectationRewardParts({ explorationModel, def, expectation });
    return {
      expectation,
      needText: needs[expectation],
      rewardText: parts.main,
      rewardNote: parts.note,
    };
  });
}

// ---- 探索の結果の入力（ゲームの結果画面の写し取り形） ----
// 2026-11-19 のユーザー確定形: 結果の入力は、ゲームの結果画面に出た
// 行をそのまま写す形にする。結果画面は「探索結果」の見出しの下に
// 箇条書きの文で結果を一括表示する（例: 「・塔破力が17回復した」。
// バフマスでは「・ラッシュの攻撃力が6%上昇」「・塔破力が2回復した」が
// 並ぶ）。行の文形は 2026-11-19 13:01 に届いた結果画面のスクリーン
// ショットで確定した: 回復は「・{スタイル}のメギド{体数}体の
// コンディションが{段階}段階回復した。」（句点あり）、バフは
// 「・{スタイル}の{ステータス}が{数}%上昇」（句点なし、「上がった」
// ではなく「上昇」）、塔破力は「・塔破力が{数}回復した」（句点なし）。
// 行の値は、到達した期待度で
// 起こりうる固定の候補（箱ごとの実量表から生成）から選ぶのが基本で、
// 候補に無い値が画面に出た場合の保険として数入力も用意する。
// ランダムボーナスはステータス上昇の代替ではなく追加の行であり、
// 出た時だけ行を足す。足さなければ「出なかった」として記録される
// （未選択＝不明にはしない）。
// ここは純粋関数群: フォーム状態（下記 emptyResultForm の形）を受け、
// 行の表示材料と、揃った記録材料（commit）を返す。DOM には触れない。

// 箱の実量（数または幅 [min, max]）を、起こりうる値の列に展開する。
function expandBoxValues(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    const out = [];
    for (let v = raw[0]; v <= raw[1]; v += 1) out.push(v);
    return out;
  }
  return [raw];
}

// 指定した箱の並びで起こりうる結果の候補（実量表から生成）。
// 戻り値は subType で形が違う:
//   tower_power: { kind, values: [{ num, box }] }
//   recovery:    { kind, scales: [{ box, variant, count, stages }] }
//   buff:        { kind, main: [{ num, boxes }], dmgPcts: [num], powerAmounts: [num] }
export function resultCandidates({ explorationModel, def, boxes }) {
  const model = explorationModel || {};
  if (def.subType === 'tower_power') {
    const table = model.towerPowerRecovery[String(def.recommendedPower)] || {};
    const values = [];
    for (const box of boxes) {
      for (const num of expandBoxValues(table[box])) values.push({ num, box });
    }
    return { kind: 'tower_power', values };
  }
  if (def.subType === 'recovery') {
    const table = model.conditionRecovery[String(def.recommendedPower)] || {};
    const scales = [];
    for (const box of boxes) {
      const entry = table[box];
      if (entry == null) continue;
      if (Array.isArray(entry)) {
        entry.forEach((e, i) => scales.push({ box, variant: i, count: e.count, stages: e.stages }));
      } else {
        scales.push({ box, variant: null, count: entry.count, stages: entry.stages });
      }
    }
    return { kind: 'recovery', scales };
  }
  if (BUFF_SUBTYPES.has(def.subType)) {
    const table = model.buffBoxEffects || {};
    const mainByPct = new Map();
    const dmg = new Set();
    const power = new Set();
    for (const box of boxes) {
      for (const raw of table[box] || []) {
        const parsed = parseBuffRaw(raw);
        if (!Number.isFinite(parsed.pct)) continue;
        if (!mainByPct.has(parsed.pct)) mainByPct.set(parsed.pct, []);
        mainByPct.get(parsed.pct).push(box);
        for (const extra of parsed.extras) {
          const d = String(extra).match(/^ダメージ上昇(\d+)%$/);
          const p = String(extra).match(/^塔破力(\d+)$/);
          if (d) dmg.add(Number(d[1]));
          if (p) power.add(Number(p[1]));
        }
      }
    }
    return {
      kind: 'buff',
      main: [...mainByPct.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([num, bs]) => ({ num, boxes: bs })),
      dmgPcts: [...dmg].sort((a, b) => a - b),
      powerAmounts: [...power].sort((a, b) => a - b),
    };
  }
  return { kind: 'none' };
}

// 結果フォームの初期状態（入力の途中状態。保存はしない）。
export function emptyResultForm() {
  return {
    powerKey: null, powerCustom: false, powerValue: '',
    scaleKey: null, scaleCustom: false, scaleCount: '', scaleStages: '',
    style: null,
    buffStat: null, buffPctKey: null, buffCustom: false, buffValue: '',
    bonusDmg: null, bonusPower: null,
  };
}

const parseFormNum = (s) => {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// 候補が1つしかない場合は、それが画面に出た結果として preselect 扱いに
// する（結果が1通りに決まる期待度では、選ぶ操作自体が要らない）。
function effFromCandidates(cands, key, keyOf) {
  if (key != null) return cands.find((c) => keyOf(c) === key) || null;
  return cands.length === 1 ? cands[0] : null;
}

// 塔破力: 候補に無い値（フォールバック入力）から箱を推定する。箱は
// 履歴の表記（標準／多め）のための内部表現で、量そのものは powerGain
// として実値が記録されるため、推定が外れても量は壊れない。
function inferPowerBox(cands, boxes, value) {
  const hit = cands.find((c) => c.num === value);
  if (hit) return hit.box;
  if (boxes.length === 1) return boxes[0];
  const redNums = cands.filter((c) => c.box === '赤').map((c) => c.num);
  if (redNums.length > 0 && value > Math.max(...redNums)) return '虹';
  return boxes[0];
}

// バフ: 主上昇量とボーナスの有無から箱を推定する（同上）。
function inferBuffBox(cands, boxes, pct, hasBonus) {
  if (hasBonus) return '虹';
  if (boxes.length === 1) return boxes[0];
  const hit = cands.find((c) => c.num === pct);
  if (hit) {
    // 赤と虹の両方に同じ量がある場合、虹のその量はボーナス付きの形で
    // のみ表にある。ボーナス行が無い結果は赤として扱う。
    if (hit.boxes.includes('虹') && !hit.boxes.includes('赤')) return '虹';
    return '赤';
  }
  return pct >= 10 ? '虹' : '赤';
}

// ボーナス行1本分の実効値（候補が1つなら preselect。候補が無い場合は
// 数入力として読む）。
function effBonusValue(lineState, nums) {
  if (!lineState) return null;
  if (lineState.custom || nums.length === 0) return parseFormNum(lineState.value);
  const sel = effFromCandidates(
    nums.map((num) => ({ num })),
    lineState.key,
    (c) => `n${c.num}`,
  );
  return sel ? sel.num : null;
}

// 結果フォームの表示材料と記録材料を組み立てる。
// 戻り値: { lines, bonusAdd, canRecord, missingText, commit }
// commit は記録材料（box / style / recoveryVariant / recoveryCount /
// recoveryStages / powerGain / buffGains / buffPower / buffBonus）。
// 揃っていない間は null で、missingText が最初に欠けている項目を言う。
export function resultFormVm({ explorationModel, def, boxes, form }) {
  const cands = resultCandidates({ explorationModel, def, boxes });
  const styleName = def.styleKind === 'fixed' ? STYLE_NAME[def.style] : null;

  if (cands.kind === 'tower_power') {
    const keyOf = (c) => `v${c.num}`;
    // 候補が無い帯（実量表でその箱が null）では、数入力が唯一の経路。
    const noCands = cands.values.length === 0;
    const useCustom = form.powerCustom || noCands;
    let eff = null;
    if (useCustom) {
      const v = parseFormNum(form.powerValue);
      if (v != null) eff = { num: v, box: inferPowerBox(cands.values, boxes, v) };
    } else {
      eff = effFromCandidates(cands.values, form.powerKey, keyOf);
    }
    const missingText = eff ? null
      : useCustom ? '画面に出た数を入れてください' : 'どれだけ回復したか選んでください';
    return {
      lines: [{
        kind: 'power',
        candidates: cands.values.map((c) => ({
          key: keyOf(c), label: String(c.num),
          selected: !useCustom && eff != null && eff.num === c.num,
        })),
        customActive: useCustom, customValue: form.powerValue, noCandidates: noCands,
      }],
      bonusAdd: null,
      canRecord: Boolean(eff),
      missingText,
      commit: eff ? { box: eff.box, style: null, recoveryVariant: null, powerGain: eff.num } : null,
    };
  }

  if (cands.kind === 'recovery') {
    const keyOf = (c) => `${c.box}:${c.variant == null ? 's' : c.variant}`;
    const noCands = cands.scales.length === 0;
    const useCustom = form.scaleCustom || noCands;
    let eff = null;
    if (useCustom) {
      const count = parseFormNum(form.scaleCount);
      const stages = parseFormNum(form.scaleStages);
      if (count != null && stages != null) {
        const hit = cands.scales.find((s) => s.count === count && s.stages === stages);
        eff = hit
          ? { ...hit, override: false }
          : { box: boxes[0], variant: null, count, stages, override: true };
      }
    } else {
      eff = effFromCandidates(cands.scales, form.scaleKey, keyOf);
    }
    const needStyle = def.styleKind === 'random';
    let missingText = null;
    if (!eff) {
      missingText = useCustom
        ? '回復した体数と段階を入れてください'
        : 'どれだけ回復したか選んでください';
    } else if (needStyle && !form.style) {
      missingText = '回復したスタイルを選んでください';
    }
    const commit = eff && !missingText ? {
      box: eff.box,
      style: needStyle ? form.style : null,
      recoveryVariant: eff.override ? null : eff.variant,
      ...(eff.override ? { recoveryCount: eff.count, recoveryStages: eff.stages } : {}),
    } : null;
    return {
      lines: [{
        kind: 'recovery',
        styleName,
        styleChips: needStyle ? STYLE_ORDER.map((code) => ({
          code, label: STYLE_NAME[code], selected: form.style === code,
        })) : null,
        candidates: cands.scales.map((c) => ({
          // 候補の表記は、文の中に置かれた時にゲームの結果文
          // （「…のメギド○体の コンディションが○段階回復した。」）
          // になる断片の形にする。
          key: keyOf(c), label: `${c.count}体の コンディションが${c.stages}段階`,
          selected: !useCustom && eff != null && keyOf(c) === keyOf(eff),
        })),
        customActive: useCustom, noCandidates: noCands,
        countValue: form.scaleCount, stagesValue: form.scaleStages,
      }],
      bonusAdd: null,
      canRecord: Boolean(commit),
      missingText,
      commit,
    };
  }

  if (cands.kind === 'buff') {
    const stat = def.subType === 'status_buff'
      ? form.buffStat
      : BUFF_STAT_BY_SUBTYPE[def.subType];
    const keyOf = (c) => `p${c.num}`;
    const noCands = cands.main.length === 0;
    const useCustom = form.buffCustom || noCands;
    let effPct = null;
    if (useCustom) {
      effPct = parseFormNum(form.buffValue);
    } else {
      const sel = effFromCandidates(cands.main, form.buffPctKey, keyOf);
      if (sel) effPct = sel.num;
    }
    const dmgEff = effBonusValue(form.bonusDmg, cands.dmgPcts);
    const powerEff = effBonusValue(form.bonusPower, cands.powerAmounts);
    const bonusIncomplete = (form.bonusDmg && dmgEff == null) || (form.bonusPower && powerEff == null);
    const hasBonus = dmgEff != null || powerEff != null;
    // ダメージ上昇ボーナスの種別（単体・範囲・列・全体）。結果画面に
    // 出た種別を写し取る。未指定（旧い途中状態）は単体として扱う。
    const dmgType = form.bonusDmg && DMG_TYPE_ORDER.includes(form.bonusDmg.dmgType)
      ? form.bonusDmg.dmgType : 'single';
    let missingText = null;
    if (!stat) missingText = '上がったステータスを選んでください';
    else if (effPct == null) {
      missingText = useCustom ? '画面に出た数を入れてください' : 'どれだけ上がったか選んでください';
    } else if (bonusIncomplete) {
      const ls = form.bonusDmg && dmgEff == null ? form.bonusDmg : form.bonusPower;
      const lsNums = ls === form.bonusDmg ? cands.dmgPcts : cands.powerAmounts;
      missingText = ls.custom || lsNums.length === 0
        ? 'ボーナスの数を入れてください' : 'ボーナスの数を選んでください';
    }
    let commit = null;
    if (stat && effPct != null && !bonusIncomplete) {
      const gains = [{ stat, pct: effPct }];
      if (dmgEff != null) gains.push({ stat: 'dmg', pct: dmgEff, dmgType });
      commit = {
        box: inferBuffBox(cands.main, boxes, effPct, hasBonus),
        style: null, recoveryVariant: null,
        buffGains: gains,
        buffPower: powerEff != null ? powerEff : 0,
        buffBonus: hasBonus,
      };
    }
    const lines = [{
      kind: 'buffMain',
      styleName,
      statName: stat ? BUFF_STAT_LABEL[stat] : null,
      statChips: def.subType === 'status_buff' ? [
        { code: 'hp', label: 'HP' }, { code: 'atk', label: '攻撃力' }, { code: 'def', label: '防御力' },
      ].map((s) => ({ ...s, selected: form.buffStat === s.code })) : null,
      candidates: cands.main.map((c) => ({
        key: keyOf(c), label: String(c.num),
        selected: !useCustom && effPct != null && effPct === c.num,
      })),
      customActive: useCustom, customValue: form.buffValue, noCandidates: noCands,
    }];
    const bonusLine = (kind, lineState, nums) => ({
      kind,
      styleName,
      candidates: nums.map((num) => ({
        key: `n${num}`, label: String(num),
        selected: !lineState.custom && effBonusValue(lineState, nums) === num,
      })),
      customActive: lineState.custom || nums.length === 0,
      customValue: lineState.value,
      noCandidates: nums.length === 0,
      // ダメージ上昇の行だけ、種別の選択肢（単体・範囲・列・全体）と
      // 選択中の種別名を持つ。結果の文はこの種別で組み立てる。
      ...(kind === 'bonusDmg' ? {
        dmgTypeChips: DMG_TYPE_ORDER.map((code) => ({
          code, label: DMG_TYPE_LABEL[code], selected: dmgType === code,
        })),
        dmgTypeLabel: DMG_TYPE_LABEL[dmgType],
      } : {}),
    });
    if (form.bonusDmg) lines.push(bonusLine('bonusDmg', form.bonusDmg, cands.dmgPcts));
    if (form.bonusPower) lines.push(bonusLine('bonusPower', form.bonusPower, cands.powerAmounts));
    return {
      lines,
      bonusAdd: {
        dmg: cands.dmgPcts.length > 0 && !form.bonusDmg,
        power: cands.powerAmounts.length > 0 && !form.bonusPower,
      },
      canRecord: Boolean(commit),
      missingText,
      commit,
    };
  }

  return { lines: [], bonusAdd: null, canRecord: false, missingText: null, commit: null };
}

// 記録済みの操作から、結果フォームの初期状態を復元する（結果を直す
// H2 で、現在の記録を出発点として付け直せるようにするため）。
export function resultFormFromOp({ explorationModel, def, boxes, op }) {
  const form = emptyResultForm();
  if (!op) return form;
  const cands = resultCandidates({ explorationModel, def, boxes });
  if (cands.kind === 'tower_power') {
    const v = typeof op.powerGain === 'number'
      ? op.powerGain
      : (() => {
        const table = (explorationModel || {}).towerPowerRecovery[String(def.recommendedPower)] || {};
        return typeof table[op.box] === 'number' ? table[op.box] : null;
      })();
    if (v != null) {
      if (cands.values.some((c) => c.num === v)) form.powerKey = `v${v}`;
      else { form.powerCustom = true; form.powerValue = String(v); }
    }
    return form;
  }
  if (cands.kind === 'recovery') {
    form.style = op.style || null;
    if (typeof op.recoveryCount === 'number' && typeof op.recoveryStages === 'number') {
      form.scaleCustom = true;
      form.scaleCount = String(op.recoveryCount);
      form.scaleStages = String(op.recoveryStages);
    } else {
      const hit = cands.scales.find(
        (s) => s.box === op.box && (s.variant == null ? op.recoveryVariant == null : s.variant === op.recoveryVariant),
      );
      if (hit) form.scaleKey = `${hit.box}:${hit.variant == null ? 's' : hit.variant}`;
    }
    return form;
  }
  if (cands.kind === 'buff') {
    const gains = Array.isArray(op.buffGains) ? op.buffGains : [];
    const main = gains.find((g) => g.stat !== 'dmg');
    if (main) {
      if (def.subType === 'status_buff') form.buffStat = main.stat;
      if (cands.main.some((c) => c.num === main.pct)) form.buffPctKey = `p${main.pct}`;
      else { form.buffCustom = true; form.buffValue = String(main.pct); }
    }
    const dmg = gains.find((g) => g.stat === 'dmg');
    if (dmg) {
      const dmgType = DMG_TYPE_ORDER.includes(dmg.dmgType) ? dmg.dmgType : 'single';
      form.bonusDmg = cands.dmgPcts.includes(dmg.pct)
        ? { key: `n${dmg.pct}`, custom: false, value: '', dmgType }
        : { key: null, custom: true, value: String(dmg.pct), dmgType };
    }
    if (typeof op.buffPower === 'number' && op.buffPower > 0) {
      form.bonusPower = cands.powerAmounts.includes(op.buffPower)
        ? { key: `n${op.buffPower}`, custom: false, value: '' }
        : { key: null, custom: true, value: String(op.buffPower) };
    }
    return form;
  }
  return form;
}

// スタイル別の疲労の偏り（ランダム回復など、対象スタイルが結果で決まるマスの
// 賭けの中身）。tired は絶好調より悪い（回復の対象になる）人数、fainted は気絶。
export function styleFatigueSkew({ megidoBasics, owned, conditionOf }) {
  const order = ['ラッシュ', 'カウンター', 'バースト'];
  const rows = new Map(order.map((style) => [style, { style, tired: 0, fainted: 0 }]));
  for (const m of megidoBasics.megido) {
    if (!owned.has(m.id)) continue;
    const row = rows.get(m.style);
    if (!row) continue;
    const stage = conditionOf(m.id);
    if (stage >= STAGE_FAINTED) { row.tired += 1; row.fainted += 1; }
    else if (stage >= 1) row.tired += 1;
  }
  return order.map((style) => rows.get(style));
}

// 探索に送れる候補の一覧（探索力の昇順、同値はID順で決定的）。
// planExploration と alternativeCombos で共用する。osusume が選ばれて
// いれば、合致する者の探索力に補正を掛けたラインで並べる。
function explorePool({ megidoBasics, megidoDetails, owned, conditionOf, osusume = null, reishouStatsById = null }) {
  const byId = new Map(megidoBasics.megido.map((m) => [m.id, m]));
  const candidates = [];
  for (const id of owned) {
    const m = byId.get(id);
    if (!m) continue;
    const stage = conditionOf(id);
    if (stage >= STAGE_FAINTED) continue;
    const probe = { style: m.style, className: m.class };
    const power = explorationPower(megidoBasics, m, ougiLevelOf(megidoDetails, id), stage, osusumeFactor(probe, osusume), reishouStatMods(megidoDetails, id, reishouStatsById), savedLevelOf(megidoDetails, id));
    if (power > 0) {
      candidates.push({
        id, no: m.no, name: m.name, style: m.style, className: m.class, stage, power,
        matched: osusumeMatches(probe, osusume), ...osusumeMatchSpread(probe, osusume),
      });
    }
  }
  candidates.sort((a, b) => (a.power - b.power) || (a.id < b.id ? -1 : 1));
  return candidates;
}

// ちょうど size 体で、合計が target 以上になる最小合計の組み合わせ。
// findMinCombo の探索順（i<j<k の辞書順、同点は先勝ち）を size ごとに切り出したもの。
function findComboOfSize(candidates, target, size) {
  const n = candidates.length;
  const eps = 1e-9;
  if (size === 1) {
    for (const c of candidates) {
      if (c.power >= target - eps) return { members: [c], total: c.power };
    }
    return null;
  }
  if (size === 2) {
    let best = null;
    for (let i = 0; i < n; i += 1) {
      const need = target - candidates[i].power;
      let j = lowerBound(candidates, i + 1, need);
      while (j < n && candidates[j].no === candidates[i].no) j += 1;
      if (j < n) {
        const total = candidates[i].power + candidates[j].power;
        if (!best || total < best.total - eps) {
          best = { members: [candidates[i], candidates[j]], total };
        }
      }
    }
    return best;
  }
  if (size === 3) {
    let best = null;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (candidates[j].no === candidates[i].no) continue;
        const need = target - candidates[i].power - candidates[j].power;
        let k = lowerBound(candidates, j + 1, need);
        while (k < n && (candidates[k].no === candidates[i].no || candidates[k].no === candidates[j].no)) k += 1;
        if (k < n) {
          const total = candidates[i].power + candidates[j].power + candidates[k].power;
          if (!best || total < best.total - eps) {
            best = { members: [candidates[i], candidates[j], candidates[k]], total };
          }
        }
      }
    }
    return best;
  }
  return null;
}

// 【旧形】答えと同じ期待度に届く別の組み合わせ（M7 の別案併記）。
// 「答え1件＋別案」の形は 2026-11-18 のマスター決定で廃止され、
// planExplorationCandidates（未選択から候補を選ぶ形）に置き換わった。
// この関数は互換のために残すが、アプリからは呼ばれない。
// 合計値の焼き直しではなく、構成の違いが見えるものを返す:
//   1. 答えのメンバーを1人ずつ外した組み合わせ（誰を温存できるかが分かる）
//   2. 人数を1人増やした組み合わせ（強い1体への依存を下げる）
//   3. コンディションの軽い順に貪欲に集めた組み合わせ（疲労を避ける）
// 戻り値: [{ ids, members, total, spared: [id], added: [id] }]（最大 limit 件）。
// 答えの期待度が1の場合は、意味のある別案が作れないため空を返す。
export function alternativeCombos({
  megidoBasics, megidoDetails, owned, conditionOf, recommendedPower, answerIds, limit = 3, osusume = null, reishouStatsById = null,
}) {
  const pool = explorePool({ megidoBasics, megidoDetails, owned, conditionOf, osusume, reishouStatsById });
  const byIdPool = new Map(pool.map((c) => [c.id, c]));
  const answer = (answerIds || []).map((id) => byIdPool.get(id)).filter(Boolean);
  if (answer.length === 0) return [];
  const answerTotal = answer.reduce((sum, c) => sum + c.power, 0);
  const target3 = recommendedPower * EXPECTATION3_FACTOR;
  const expectation = answerTotal >= target3 ? 3 : answerTotal >= recommendedPower ? 2 : 1;
  if (expectation === 1) return [];
  const target = expectation === 3 ? target3 : recommendedPower;

  const answerKey = [...answerIds].sort().join(',');
  const seen = new Set([answerKey]);
  const alts = [];
  const push = (combo) => {
    if (!combo || alts.length >= limit) return;
    const ids = combo.members.map((m) => m.id);
    const key = [...ids].sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const idSet = new Set(ids);
    alts.push({
      ids,
      members: presentOrder(combo.members),
      total: combo.total,
      spared: answer.filter((m) => !idSet.has(m.id)).map((m) => m.id),
      added: combo.members.filter((m) => !answerIds.includes(m.id)).map((m) => m.id),
    });
  };

  // 1. 答えのメンバーを1人ずつ外す。
  for (const m of answer) {
    if (alts.length >= limit) break;
    const sub = pool.filter((c) => c.id !== m.id);
    push(findMinCombo(sub, target));
  }
  // 2. 人数を1人増やす（答えが最大人数でない場合）。
  if (alts.length < limit && answer.length < EXPLORE_PARTY_MAX) {
    push(findComboOfSize(pool, target, answer.length + 1));
  }
  // 3. コンディションの軽い順（同段階は探索力の大きい順）に貪欲に集める。
  if (alts.length < limit) {
    const fresh = [...pool].sort((a, b) =>
      (a.stage - b.stage) || (b.power - a.power) || (a.id < b.id ? -1 : 1));
    const picked = [];
    const usedNo = new Set();
    let total = 0;
    for (const c of fresh) {
      if (picked.length >= EXPLORE_PARTY_MAX) break;
      if (usedNo.has(c.no)) continue;
      usedNo.add(c.no);
      picked.push(c);
      total += c.power;
      if (total >= target) break;
    }
    if (total >= target) push({ members: picked, total });
  }
  return alts;
}

// 期待度3になる組み合わせを「答え」として1つ返す。
// 選び方: 人数が最小 → 合計が目標に最も近い（過剰が最小）。同点はID順で決定的にする。
// 同一キャラクター（番号が同じ別スタイル）は同じパーティに入れない。
// 届かない場合は、最も合計が大きい最大3体と、到達できる期待度を返す。
export function planExploration({ megidoBasics, megidoDetails, owned, conditionOf, recommendedPower, osusume = null, reishouStatsById = null }) {
  const target = recommendedPower * EXPECTATION3_FACTOR;
  const byId = new Map(megidoBasics.megido.map((m) => [m.id, m]));
  const candidates = [];
  for (const id of owned) {
    const m = byId.get(id);
    if (!m) continue;
    const stage = conditionOf(id);
    if (stage >= STAGE_FAINTED) continue;
    const probe = { style: m.style, className: m.class };
    const power = explorationPower(megidoBasics, m, ougiLevelOf(megidoDetails, id), stage, osusumeFactor(probe, osusume), reishouStatMods(megidoDetails, id, reishouStatsById), savedLevelOf(megidoDetails, id));
    if (power > 0) {
      candidates.push({
        id, no: m.no, name: m.name, style: m.style, className: m.class, stage, power,
        matched: osusumeMatches(probe, osusume), ...osusumeMatchSpread(probe, osusume),
      });
    }
  }
  // 昇順（同値はID順）。最小合計の探索に使う。
  candidates.sort((a, b) => (a.power - b.power) || (a.id < b.id ? -1 : 1));

  const combo = findMinCombo(candidates, target);
  if (combo) {
    return {
      reached: true,
      expectation: 3,
      target,
      recommendedPower,
      total: combo.total,
      members: presentOrder(combo.members),
    };
  }
  // 届かない場合の最善（合計が最大の最大3体、同一キャラクターを除く）。
  const desc = [...candidates].sort((a, b) => (b.power - a.power) || (a.id < b.id ? -1 : 1));
  const best = [];
  const usedNo = new Set();
  for (const c of desc) {
    if (best.length >= EXPLORE_PARTY_MAX) break;
    if (usedNo.has(c.no)) continue;
    usedNo.add(c.no);
    best.push(c);
  }
  const total = best.reduce((sum, c) => sum + c.power, 0);
  return {
    reached: false,
    expectation: total >= recommendedPower ? 2 : 1,
    target,
    recommendedPower,
    total,
    members: best,
  };
}

// 探索の候補を複数自動生成する（M7 の補助、2026-11-18 のマスター決定）。
// 入口は空の枠に自分で入れる形であり（23:43 の転換）、この生成は
// おまかせボタンから到達できる補助として使う。1件だけを初期状態に
// 埋める形は「それが推奨だ」と取られるため採らない（現行アプリの
// おまかせが複数候補を並べる理由）。
// 生成の軸:
//   1. 人数最小・合計最小（最も軽い組み合わせ）
//   2. 1.のメンバーを需要の高い順に1人ずつ外した組み合わせ（誰を温存できるか）
//   3. コンディションの軽い順に集めた組み合わせ（疲労を避ける）
//   4. 需要のある者を全員外しても届く組み合わせ（需要の回避）
//   5. 人数を1人増やした組み合わせ（強い1体への依存を下げる）
// demandOf は需要の重み（H6 の集計。0 なら需要なし）。届く期待度は
// 期待度3を先に試し、無ければ期待度2、それも無ければ最善の1件だけを返す。
// 戻り値: { expectation, target, reached, candidates:
//           [{ ids, members, total, spared, demandTotal }] }
export function planExplorationCandidates({
  megidoBasics, megidoDetails, owned, conditionOf, recommendedPower,
  demandOf = () => 0, limit = 5, osusume = null, reishouStatsById = null,
}) {
  const pool = explorePool({ megidoBasics, megidoDetails, owned, conditionOf, osusume, reishouStatsById });
  const target3 = recommendedPower * EXPECTATION3_FACTOR;
  let target = target3;
  let expectation = 3;
  let first = findMinCombo(pool, target);
  if (!first) {
    target = recommendedPower;
    expectation = 2;
    first = findMinCombo(pool, target);
  }
  if (!first) {
    // 期待度2にも届かない: 最善（合計最大の最大3体）を1件だけ返す。
    const desc = [...pool].sort((a, b) => (b.power - a.power) || (a.id < b.id ? -1 : 1));
    const best = [];
    const usedNo = new Set();
    for (const c of desc) {
      if (best.length >= EXPLORE_PARTY_MAX) break;
      if (usedNo.has(c.no)) continue;
      usedNo.add(c.no);
      best.push(c);
    }
    const total = best.reduce((sum, c) => sum + c.power, 0);
    return {
      expectation: total >= recommendedPower ? 2 : 1,
      target: target3,
      reached: false,
      candidates: [{
        ids: best.map((c) => c.id),
        members: best,
        total,
        spared: [],
        demandTotal: best.reduce((sum, c) => sum + demandOf(c.id), 0),
      }],
    };
  }

  const firstIds = first.members.map((m) => m.id);
  const seen = new Set();
  const candidates = [];
  const push = (combo) => {
    if (!combo || candidates.length >= limit) return;
    const ids = combo.members.map((m) => m.id);
    const key = [...ids].sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const idSet = new Set(ids);
    candidates.push({
      ids: presentOrder(combo.members).map((m) => m.id),
      members: presentOrder(combo.members),
      total: combo.total,
      spared: firstIds.filter((id) => !idSet.has(id)),
      demandTotal: combo.members.reduce((sum, m) => sum + demandOf(m.id), 0),
    });
  };

  push(first);
  // 2. 需要の高いメンバーから順に外す（需要が同点なら後のメンバーから）。
  const byDemand = [...first.members]
    .sort((a, b) => (demandOf(b.id) - demandOf(a.id)) || (a.id < b.id ? 1 : -1));
  for (const m of byDemand) {
    if (candidates.length >= limit) break;
    push(findMinCombo(pool.filter((c) => c.id !== m.id), target));
  }
  // 3. コンディションの軽い順に貪欲に集める。
  if (candidates.length < limit) {
    const fresh = [...pool].sort((a, b) =>
      (a.stage - b.stage) || (b.power - a.power) || (a.id < b.id ? -1 : 1));
    const picked = [];
    const usedNo = new Set();
    let total = 0;
    for (const c of fresh) {
      if (picked.length >= EXPLORE_PARTY_MAX) break;
      if (usedNo.has(c.no)) continue;
      usedNo.add(c.no);
      picked.push(c);
      total += c.power;
      if (total >= target) break;
    }
    if (total >= target) push({ members: picked, total });
  }
  // 4. 需要のある者を全員外す。
  if (candidates.length < limit && pool.some((c) => demandOf(c.id) > 0)) {
    push(findMinCombo(pool.filter((c) => demandOf(c.id) <= 0), target));
  }
  // 5. 人数を1人増やす。
  if (candidates.length < limit && first.members.length < EXPLORE_PARTY_MAX) {
    push(findComboOfSize(pool, target, first.members.length + 1));
  }
  return { expectation, target, reached: true, candidates };
}

// 表示順（探索力の大きい順、同値はID順）。
function presentOrder(members) {
  return [...members].sort((a, b) => (b.power - a.power) || (a.id < b.id ? -1 : 1));
}

// 人数最小・合計最小の組み合わせを探す。candidates は探索力の昇順。
function findMinCombo(candidates, target) {
  const n = candidates.length;
  const eps = 1e-9;
  // 1体
  for (const c of candidates) {
    if (c.power >= target - eps) return { members: [c], total: c.power };
  }
  // 2体: i を固定し、不足分を満たす最小の j（>i）を二分探索する。
  let best2 = null;
  for (let i = 0; i < n; i += 1) {
    const need = target - candidates[i].power;
    let j = lowerBound(candidates, i + 1, need);
    while (j < n && candidates[j].no === candidates[i].no) j += 1;
    if (j < n) {
      const total = candidates[i].power + candidates[j].power;
      if (!best2 || total < best2.total - eps) {
        best2 = { members: [candidates[i], candidates[j]], total };
      }
    }
  }
  if (best2) return best2;
  // 3体: i<j を固定し、不足分を満たす最小の k（>j）を二分探索する。
  let best3 = null;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (candidates[j].no === candidates[i].no) continue;
      const need = target - candidates[i].power - candidates[j].power;
      let k = lowerBound(candidates, j + 1, need);
      while (k < n && (candidates[k].no === candidates[i].no || candidates[k].no === candidates[j].no)) k += 1;
      if (k < n) {
        const total = candidates[i].power + candidates[j].power + candidates[k].power;
        if (!best3 || total < best3.total - eps) {
          best3 = { members: [candidates[i], candidates[j], candidates[k]], total };
        }
      }
    }
  }
  return best3;
}

// 昇順配列から、from 以降で power が need 以上になる最初の位置。
function lowerBound(candidates, from, need) {
  let lo = from;
  let hi = candidates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candidates[mid].power < need - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
