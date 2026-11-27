// 横断検索の効果文照合（純関数。索引は pipeline/generate-search-index.mjs
// が生成する search-index.v1.json）。
// 照合の正規化は既存の検索と揃える（normalizeSearchText: NFKC＋
// ひらがな→カタカナ）。索引は読み込み時に prepareSearchIndex で
// 正規化済みの影を1回だけ作り、キー入力ごとの再正規化を避ける。
import { normalizeSearchText } from './formations.js';

export const SEARCH_GROUP_LIMIT = 20;

export function prepareSearchIndex(index) {
  if (!index) return null;
  const abilities = (index.abilities || []).map(([id, label, name, text]) => ({
    id, label, name, text,
    nName: normalizeSearchText(name),
    nText: normalizeSearchText(text),
  }));
  const orbs = (index.orbs || []).map(([id, name, meta, trait, skill]) => ({
    id, name, meta, trait, skill,
    nName: normalizeSearchText(name),
    nTrait: normalizeSearchText(trait),
    nSkill: normalizeSearchText(skill),
  }));
  const me = (index.me || []).map(([id, sub, slots, effect]) => ({
    id, sub: sub === 1, slots, effect,
    nEffect: normalizeSearchText(effect),
  }));
  return { abilities, orbs, me };
}

// 抜粋: ヒットした語の前後を、元の文面から短く切り出す。
// 正規化（NFKC等）で位置がずれる場合に備え、文字単位に正規化した
// 対応表で元の位置へ戻す。位置が特定できない時は文頭から出す。
export function excerptAround(text, rawQuery, before = 18, after = 42) {
  const s = String(text ?? '');
  if (s.length <= before + after + 8) return s;
  const q = normalizeSearchText(String(rawQuery ?? '').trim());
  if (!q) return `${s.slice(0, before + after)}…`;
  // 文字単位の正規化と、元の文字位置への対応表。
  let normalized = '';
  const map = []; // 正規化後の各文字 → 元の文字位置
  let oi = 0;
  for (const ch of s) {
    const n = normalizeSearchText(ch);
    for (let i = 0; i < n.length; i += 1) map.push(oi);
    normalized += n;
    oi += ch.length;
  }
  const hit = normalized.indexOf(q);
  if (hit < 0) return `${s.slice(0, before + after)}…`;
  const startOrig = map[hit] ?? 0;
  const endOrig = (map[hit + q.length - 1] ?? startOrig) + 1;
  const from = Math.max(0, startOrig - before);
  const to = Math.min(s.length, endOrig + after);
  return `${from > 0 ? '…' : ''}${s.slice(from, to)}${to < s.length ? '…' : ''}`;
}

// ＋／＋＋／Lv違いは同じ能力の段階違いとして、基本形の名前に畳む
// （行が段階違いで氾濫しないように。当たった形のうち最初に出てくる
// ものを代表にする）。
function abilityFamilyKey(name) {
  return String(name || '')
    .replace(/＋+$/u, '')
    .replace(/\s*Lv\d+$/u, '')
    .replace(/＋+$/u, '');
}

// 能力（メギドの特性・スキル・覚醒スキル・奥義・秘奥義）の効果文。
// nameOf は megidoId → 表示名の解決（呼び出し側の基礎データから）。
export function searchAbilityRows(prepared, rawQuery, nameOf, limit = SEARCH_GROUP_LIMIT) {
  if (!prepared) return [];
  const q = normalizeSearchText(String(rawQuery ?? '').trim());
  if (!q) return [];
  const rows = [];
  const seen = new Set();
  for (const a of prepared.abilities) {
    if (!a.nName.includes(q) && !a.nText.includes(q)) continue;
    const family = `${a.id}|${a.label}|${abilityFamilyKey(a.name)}`;
    if (seen.has(family)) continue;
    seen.add(family);
    rows.push({
      kind: 'ability',
      id: a.id,
      main: `${nameOf(a.id)} ${a.label}「${abilityFamilyKey(a.name)}」`,
      sub: excerptAround(a.text, rawQuery),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

// オーブ: 名前が当たれば名前の行だけ（詳細で全文が読める）。
// 当たらなければ、特性・スキルの当たった方を行にする。
export function searchOrbRows(prepared, rawQuery, limit = SEARCH_GROUP_LIMIT) {
  if (!prepared) return [];
  const q = normalizeSearchText(String(rawQuery ?? '').trim());
  if (!q) return [];
  const rows = [];
  for (const o of prepared.orbs) {
    if (o.nName.includes(q)) {
      rows.push({ kind: 'orb', id: o.id, main: o.name, sub: o.meta });
    } else {
      if (o.nTrait.includes(q)) {
        rows.push({ kind: 'orb', id: o.id, main: `${o.name} 特性`, sub: excerptAround(o.trait, rawQuery) });
      }
      if (o.nSkill.includes(q)) {
        rows.push({ kind: 'orb', id: o.id, main: `${o.name} スキル`, sub: excerptAround(o.skill, rawQuery) });
      }
    }
    if (rows.length >= limit) break;
  }
  return rows.slice(0, limit);
}

// マスエフェクト／サブマスエフェクトの効果文。
export function searchMeRows(prepared, rawQuery, nameOf, limit = SEARCH_GROUP_LIMIT) {
  if (!prepared) return [];
  const q = normalizeSearchText(String(rawQuery ?? '').trim());
  if (!q) return [];
  const rows = [];
  for (const m of prepared.me) {
    if (!m.nEffect.includes(q)) continue;
    rows.push({
      kind: 'me',
      id: m.id,
      main: `${nameOf(m.id)} ${m.sub ? 'サブマスエフェクト' : 'マスエフェクト'}（${m.slots}）`,
      sub: excerptAround(m.effect, rawQuery),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}
