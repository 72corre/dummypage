// 編成の見方（M5 の一覧と M8 の確認表示のための純粋関数群）
// 編成は migrate.js の正規化形式: { id, name, tags, notes, enemyName, floors,
//   reishouReminder, slots: [{ megidoId, orbId, reishouIds, leaderSkill }] ×5 }
// 枠の位置は 1・2・リーダー・4・5（リーダーは中央 index 2）。
// DOM・保存には触れない。

import { STAGE_FAINTED } from './derive.js';

export const SLOT_LABELS = ['1', '2', 'リーダー', '4', '5'];
export const LEADER_INDEX = 2;

export function basicsById(megidoBasics) {
  return new Map(megidoBasics.megido.map((m) => [m.id, m]));
}

// 5枠の並び（空き枠は megidoId が null）。
export function formationMembers(formation, byId) {
  return formation.slots.map((slot, index) => {
    const m = slot.megidoId ? byId.get(slot.megidoId) : null;
    return {
      index,
      label: SLOT_LABELS[index],
      isLeader: index === LEADER_INDEX,
      megidoId: slot.megidoId || null,
      name: m ? m.name : slot.megidoId ? '（データに無いメギド）' : null,
      style: m ? m.style : null,
      className: m ? m.class : null,
      orbId: slot.orbId || null,
      reishouIds: slot.reishouIds || [],
      leaderSkill: slot.leaderSkill || '',
      known: Boolean(m),
    };
  });
}

// メンバーから展開したスタイル構成（例: ラッシュ2・カウンター1・バースト2）。
export function styleComposition(formation, byId) {
  const counts = new Map();
  for (const slot of formation.slots) {
    if (!slot.megidoId) continue;
    const m = byId.get(slot.megidoId);
    if (!m) continue;
    counts.set(m.style, (counts.get(m.style) || 0) + 1);
  }
  const order = ['ラッシュ', 'カウンター', 'バースト'];
  const parts = order.filter((s) => counts.has(s)).map((s) => `${s}${counts.get(s)}`);
  return parts.length > 0 ? parts.join('・') : 'メンバーなし';
}

// メンバーのうち最も悪いコンディション段階（メンバーがいなければ null）。
export function worstStageOf(formation, conditionOf) {
  let worst = null;
  for (const slot of formation.slots) {
    if (!slot.megidoId) continue;
    const stage = conditionOf(slot.megidoId);
    if (worst === null || stage > worst) worst = stage;
  }
  return worst;
}

// そのマスで使える編成かと、使えない理由（導出で判定できる範囲のみ）。
// 脅威への対応（カバー）は手段の索引が未生成のため、ここでは判定しない。
export function formationUsability(formation, { owned, conditionOf, byId }) {
  const reasons = [];
  const members = formation.slots.filter((s) => s.megidoId);
  if (members.length === 0) {
    return { usable: false, reasons: ['メンバーがいない'] };
  }
  const unknown = [];
  const notOwned = [];
  const fainted = [];
  for (const slot of members) {
    const m = byId.get(slot.megidoId);
    if (!m) {
      unknown.push(slot.megidoId);
      continue;
    }
    if (!owned.has(slot.megidoId)) notOwned.push(m.name);
    if (conditionOf(slot.megidoId) >= STAGE_FAINTED) fainted.push(m.name);
  }
  if (unknown.length > 0) reasons.push('データにないメンバーがいる');
  if (notOwned.length > 0) reasons.push(`未所持のメンバーがいる: ${notOwned.join('、')}`);
  if (fainted.length > 0) reasons.push(`気絶しているメンバーがいる: ${fainted.join('、')}`);
  return { usable: reasons.length === 0, reasons };
}

// ---- 編成を組む（M6）のための純粋関数 ----

// 空の枠（正規化形式と同じ形）。
export function emptySlot() {
  return { megidoId: null, orbId: null, reishouIds: [], leaderSkill: '' };
}

export function emptySlots() {
  return Array.from({ length: 5 }, () => emptySlot());
}

// 保存できるか: 中央（リーダー、index 2）が埋まっていること（現行ツールの規則と同じ）。
export function canSaveFormation(slots) {
  return Boolean(slots[LEADER_INDEX] && slots[LEADER_INDEX].megidoId);
}

// 名前が空のときの既定名（リーダー名＋「編成」）。
export function defaultFormationName(slots, byId) {
  const leader = slots[LEADER_INDEX];
  const m = leader && leader.megidoId ? byId.get(leader.megidoId) : null;
  return m ? `${m.name}編成` : '（名前なし）';
}

// 属性順の順序キー（全体構成の決定 問題6・案2、2026-11-26）:
// スタイルとクラスの並びは、基礎データの表記と絞り込みチップの
// 並び（スタイル: ラッシュ→カウンター→バースト、クラス:
// ファイター→トルーパー→スナイパー）に合わせる。
export const STYLE_ORDER = ['ラッシュ', 'カウンター', 'バースト'];
export const CLASS_ORDER = ['ファイター', 'トルーパー', 'スナイパー'];
const orderIndex = (order, value) => {
  const i = order.indexOf(value);
  return i >= 0 ? i : order.length;
};

// 枠の候補（M6）: 所持している者から出す。他の枠に入っている者と、
// 他の枠に入っている者と同一キャラクター（no が同じ）の者は出さない。
// その枠の現在のメンバーは含める（選び直しの起点として出す）。
// 既定の並びは属性順（問題6・案2）: スタイル→クラス→コンディション
// （段階の軽い順）→名前。対策の材料の多さで並べ替える「答えの順」は
// 廃止し、有効な候補は✓有効の印と行の中の理由で拾う形にした。
export function slotCandidates({ megidoBasics, owned, conditionOf, slots, slotIndex }) {
  const byId = basicsById(megidoBasics);
  const usedIds = new Set();
  const usedNos = new Set();
  slots.forEach((slot, i) => {
    if (i === slotIndex || !slot.megidoId) return;
    usedIds.add(slot.megidoId);
    const m = byId.get(slot.megidoId);
    if (m) usedNos.add(m.no);
  });
  const currentId = slots[slotIndex] ? slots[slotIndex].megidoId : null;
  const rows = [];
  for (const m of megidoBasics.megido) {
    if (!owned.has(m.id)) continue;
    if (usedIds.has(m.id)) continue;
    if (usedNos.has(m.no)) continue;
    rows.push({
      id: m.id,
      no: m.no,
      name: m.name,
      style: m.style,
      className: m.class,
      stage: conditionOf(m.id),
      isCurrent: m.id === currentId,
    });
  }
  rows.sort((a, b) => (orderIndex(STYLE_ORDER, a.style) - orderIndex(STYLE_ORDER, b.style))
    || (orderIndex(CLASS_ORDER, a.className) - orderIndex(CLASS_ORDER, b.className))
    || (a.stage - b.stage)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

// ---- オーブの装備可否 ----
// 旧データ（orbs.json と旧ツールの判定）の意味論:
//   - 装備条件（condition）は「使用できるスタイルの条件」であり、種族は
//     装備可否に入らない（種族はオーブ自体の種族であり、種族特効の対象）。
//     旧ツールの判定も m.style === orb.conditions のみだった。
//   - 条件がメギド名のものは専用オーブで、そのメギドだけが装備できる。
//     表記は3通り: そのままの名前（ウェパル）、スタイル付きの名前
//     （ウェパルB)、「名前（スタイル）」（リヴァイアサン(バースト)）。
// orb: { condition }、member: { name, style }（基礎データの形）。
const ORB_STYLE_CONDITIONS = new Set(['ラッシュ', 'カウンター', 'バースト']);
export function orbEquippableBy(orb, member) {
  if (!orb || !member) return false;
  const c = orb.condition;
  if (!c) return true;
  if (ORB_STYLE_CONDITIONS.has(c)) return member.style === c;
  const m = /^(.+?)[(（](ラッシュ|カウンター|バースト)[)）]$/.exec(c);
  if (m) return member.name === m[1] && member.style === m[2];
  return member.name === c;
}

// ---- 検索の正規化 ----
// 照合の前に、クエリと対象の両方へ適用する: 全角・半角の揺れは NFKC で吸収し、
// ひらがなはカタカナにそろえる（「あいむ」で「アイム」に当たる）。
export function normalizeSearchText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

// ---- 保存済み編成からの「予定」の導出（M7） ----
// 利用者の頭の中の予定はツールには見えない。ツールが知り得る予定は、
// 保存済み編成のタグ（floors / enemyName）が指す、未処理の戦闘マスだけ。
// タグの無い編成には予定を付けない（推測で付けない）。タグが片方だけの
// 編成は、そのタグだけで照合する（floors があればその階の未処理の戦闘
// マス全般、enemyName だけなら fromFloor 以降の同名の敵のマス）。
// 戻り値: Map(megidoId -> [{ formationName, floor, enemyName }])
// （enemyName は照合したマスの敵名。編成のタグ由来とは限らない）
export function formationPlans({ formations, structure, cleared, fromFloor }) {
  const plans = new Map();
  const add = (id, entry) => {
    if (!plans.has(id)) plans.set(id, []);
    const list = plans.get(id);
    const dup = list.some((e) => e.formationName === entry.formationName
      && e.floor === entry.floor && e.enemyName === entry.enemyName);
    if (!dup) list.push(entry);
  };
  for (const f of formations || []) {
    const floors = Array.isArray(f.floors) ? f.floors : [];
    const enemyName = typeof f.enemyName === 'string' ? f.enemyName : '';
    if (floors.length === 0 && !enemyName) continue; // タグが無ければ予定は付けない
    const memberIds = (f.slots || []).map((s) => s.megidoId).filter(Boolean);
    if (memberIds.length === 0) continue;
    for (const fd of (structure && structure.floors) || []) {
      if (fd.floor < fromFloor) continue;
      if (floors.length > 0 && !floors.includes(fd.floor)) continue;
      for (const [squareId, def] of Object.entries(fd.squares || {})) {
        if (def.type !== 'battle' && def.type !== 'boss') continue;
        if (cleared && cleared.has(squareId)) continue;
        const enemies = def.enemies || [];
        if (enemyName && !enemies.includes(enemyName)) continue;
        const entry = {
          formationName: f.name || '（名前なし）',
          floor: fd.floor,
          enemyName: enemyName || enemies.join('・'),
        };
        for (const id of memberIds) add(id, entry);
      }
    }
  }
  return plans;
}

// 予定のあるメンバーを、需要の回避計算でどれだけ重く見るか（必須級の
// 需要と同じ重さ。ui-flow.md M7 に記録した扱い）。
export const PLAN_AVOID_WEIGHT = 3;

// ---- 編成同士の重複（調査 A3、2026-11-26） ----
// 保存済み編成の間で、同じメギド（体単位の megidoId）が複数の編成に
// 入っている事実を、編成ごとに集める。出すのは事実だけで、重複の
// 良し悪しは判定しない。戻り値: Map(formationId ->
//   [{ megidoId, name, others: [編成名, ...] }])
// 重複の無い編成はキー自体を持たない。並びは決定的にする:
// メンバーは枠の順、others は編成名の順（同名は ID 順）。
// 同じ編成の中で同じメギドが複数枠に入っていても、自分自身との
// 重複には数えず、行も1件にまとめる。
export function formationOverlaps(formations, byId) {
  const list = Array.isArray(formations) ? formations : [];
  const nameOf = (f) => f.name || '（名前なし）';
  // megidoId -> そのメギドが入っている編成の位置（list の添字）の並び。
  const homes = new Map();
  list.forEach((f, fi) => {
    const seen = new Set();
    for (const slot of f.slots || []) {
      if (!slot.megidoId || seen.has(slot.megidoId)) continue;
      seen.add(slot.megidoId);
      if (!homes.has(slot.megidoId)) homes.set(slot.megidoId, []);
      homes.get(slot.megidoId).push(fi);
    }
  });
  const overlaps = new Map();
  list.forEach((f, fi) => {
    const rows = [];
    const seen = new Set();
    for (const slot of f.slots || []) {
      if (!slot.megidoId || seen.has(slot.megidoId)) continue;
      seen.add(slot.megidoId);
      const others = (homes.get(slot.megidoId) || [])
        .filter((oi) => oi !== fi)
        .map((oi) => list[oi]);
      if (others.length === 0) continue;
      others.sort((a, b) => {
        const na = nameOf(a);
        const nb = nameOf(b);
        if (na !== nb) return na < nb ? -1 : 1;
        const ia = String(a.id);
        const ib = String(b.id);
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      });
      const m = byId ? byId.get(slot.megidoId) : null;
      rows.push({
        megidoId: slot.megidoId,
        name: m ? m.name : '（データに無いメギド）',
        others: others.map(nameOf),
      });
    }
    if (rows.length > 0) overlaps.set(f.id, rows);
  });
  return overlaps;
}

// ---- タグ（棚卸し 5-6） ----
// 現行ツールの仕様どおり: 自動タグは4カテゴリ（megido=メンバー名、
// enemy=対象の敵、floor=対象の階、rule=その敵のいるマスのルール）で、
// 保存のたびに作り直す。カスタムタグだけが利用者の入力として残り、
// 編集・コピーでも引き継がれる。タグの保存形は {text, category}。
// 旧移行の初期便では文字列の配列で保存されたものがあるため、読み側は
// どちらの形も受けて {text, category} にそろえる（文字列は custom 扱い。
// カテゴリの情報は移行元にしか無いので、移行側はオブジェクトを保つ）。
export const TAG_CATEGORIES = ['megido', 'enemy', 'floor', 'rule', 'custom'];
export const TAG_CATEGORY_LABEL = {
  megido: 'メンバー', enemy: '敵', floor: '階', rule: 'ルール', custom: 'カスタム',
};

export function normalizeTags(tags) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(tags) ? tags : []) {
    let text = '';
    let category = 'custom';
    if (typeof t === 'string') {
      text = t;
    } else if (t && typeof t.text === 'string') {
      text = t.text;
      if (TAG_CATEGORIES.includes(t.category)) category = t.category;
    }
    text = text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, category });
  }
  return out;
}

export function customTagTexts(tags) {
  return normalizeTags(tags).filter((t) => t.category === 'custom').map((t) => t.text);
}

// カスタムタグの入力（カンマ区切り）をテキストの配列にする。
// 日本語入力の区切り（読点・全角カンマ）も区切りとして扱う。
export function parseCustomTags(input) {
  const out = [];
  const seen = new Set();
  for (const part of String(input ?? '').split(/[,、，]/)) {
    const text = part.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

// 編成の対象の階（SW94）: 保存された floors があればそれが正。
// floors が空で対象の敵だけがある編成は、ターゲット選択の決着
// （階を選ばなければ、その敵が出る階すべてが対象）に従い、敵の
// 登場階を対象とする。対象が無ければ空。
export function formationTargetFloors(formation, structure) {
  const floors = Array.isArray(formation.floors)
    ? formation.floors.filter((n) => Number.isFinite(n))
    : [];
  if (floors.length > 0) return [...new Set(floors)].sort((a, b) => a - b);
  if (formation.enemyName) return floorsForEnemy(structure, formation.enemyName);
  return [];
}

// その敵が登場する階（塔の構造から。ターゲット選択の階チェックボックス用）。
export function floorsForEnemy(structure, enemyName) {
  const floors = [];
  for (const fd of (structure && structure.floors) || []) {
    const hit = Object.values(fd.squares || {}).some(
      (def) => Array.isArray(def.enemies) && def.enemies.includes(enemyName),
    );
    if (hit) floors.push(fd.floor);
  }
  return floors;
}

// 塔に登場する敵の名前すべて（ターゲット選択の敵ピッカー用）。
// 並びは初登場の階の昇順、同階では名前順。
export function allEnemyNames(structure) {
  const firstFloor = new Map();
  for (const fd of (structure && structure.floors) || []) {
    for (const def of Object.values(fd.squares || {})) {
      for (const name of def.enemies || []) {
        if (!firstFloor.has(name)) firstFloor.set(name, fd.floor);
      }
    }
  }
  return [...firstFloor.entries()]
    .map(([name, floor]) => ({ name, floor }))
    .sort((a, b) => (a.floor - b.floor) || (a.name < b.name ? -1 : 1));
}

// 自動タグの生成（現行ツールの handleSave と同じ規則）。
// ルールは「選択した階のうち、その敵がいるマスのルール」から取る。
export function buildAutoTags({ slots, byId, enemyName, floors, structure }) {
  const tags = [];
  const seen = new Set();
  const add = (text, category) => {
    const t = String(text || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    tags.push({ text: t, category });
  };
  for (const slot of slots || []) {
    if (!slot.megidoId) continue;
    const m = byId.get(slot.megidoId);
    if (m) add(m.name, 'megido');
  }
  const enemy = typeof enemyName === 'string' ? enemyName.trim() : '';
  if (enemy) add(enemy, 'enemy');
  const floorList = Array.isArray(floors) ? floors : [];
  for (const f of floorList) add(`${f}F`, 'floor');
  if (enemy && structure) {
    for (const f of floorList) {
      const fd = (structure.floors || []).find((x) => x.floor === f);
      if (!fd) continue;
      for (const def of Object.values(fd.squares || {})) {
        if (!Array.isArray(def.enemies) || !def.enemies.includes(enemy)) continue;
        for (const rule of def.rules || []) {
          if (rule && rule !== 'なし') add(rule, 'rule');
        }
      }
    }
  }
  return tags;
}

// 保存時のタグ一式: 自動タグを作り直し、カスタムタグを後ろに足す
// （同文のものは自動側を優先して1つだけ残す。現行ツールと同じ）。
export function buildFormationTags({ slots, byId, enemyName, floors, structure, customTexts }) {
  const tags = buildAutoTags({ slots, byId, enemyName, floors, structure });
  const seen = new Set(tags.map((t) => t.text));
  for (const text of customTexts || []) {
    const t = String(text || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tags.push({ text: t, category: 'custom' });
  }
  return tags;
}

// 編成名の自動命名（現行ツールと同じ規則）: 敵と階があれば
// 「{階}F {敵名}用編成」、無ければリーダー名＋「編成」。
export function autoFormationName({ slots, byId, enemyName, floors }) {
  const enemy = typeof enemyName === 'string' ? enemyName.trim() : '';
  const floorList = Array.isArray(floors) ? floors : [];
  if (enemy && floorList.length > 0) return `${floorList.join(',')}F ${enemy}用編成`;
  return defaultFormationName(slots, byId);
}

// 編成のコピー（棚卸し 5-11。現行ツールの handleCopyFormation と同じ規則）:
// 名前は「{元の名前} (コピー)」。タグはメンバー・敵・階を作り直し、
// ルールは作り直さず（コピーでは落ちる）、カスタムだけを引き継ぐ。
export function copyFormationRecord(formation, newId, byId) {
  const tags = [];
  const seen = new Set();
  const add = (text, category) => {
    const t = String(text || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    tags.push({ text: t, category });
  };
  for (const slot of formation.slots || []) {
    if (!slot.megidoId) continue;
    const m = byId.get(slot.megidoId);
    if (m) add(m.name, 'megido');
  }
  if (formation.enemyName) add(formation.enemyName, 'enemy');
  for (const f of formation.floors || []) add(`${f}F`, 'floor');
  for (const text of customTagTexts(formation.tags)) add(text, 'custom');
  return {
    ...formation,
    id: newId,
    name: `${formation.name || '（名前なし）'} (コピー)`,
    tags,
    slots: (formation.slots || []).map((s) => ({
      megidoId: s.megidoId || null,
      orbId: s.orbId || null,
      reishouIds: [...(s.reishouIds || [])],
      leaderSkill: s.leaderSkill || '',
    })),
  };
}

// 一覧と横断検索の照合: 編成名・メンバー名・タグ・対象の敵に当てる
// （移行してきたタグも、保存形がそろっていれば同じく対象になる）。
export function formationMatchesQuery(formation, byId, query) {
  const q = normalizeSearchText(String(query || '').trim());
  if (!q) return true;
  if (normalizeSearchText(formation.name || '').includes(q)) return true;
  if (formation.enemyName && normalizeSearchText(formation.enemyName).includes(q)) return true;
  for (const t of normalizeTags(formation.tags)) {
    if (normalizeSearchText(t.text).includes(q)) return true;
  }
  for (const slot of formation.slots || []) {
    if (!slot.megidoId) continue;
    const m = byId.get(slot.megidoId);
    if (m && normalizeSearchText(m.name).includes(q)) return true;
  }
  return false;
}

// M5 の一覧の並び: 使える編成を先に、その中では最も悪いメンバーの段階が軽い順、
// 最後に名前順（決定的にするため）。
export function compareFormationRows(a, b) {
  if (a.usable !== b.usable) return a.usable ? -1 : 1;
  const wa = a.worstStage === null ? -1 : a.worstStage;
  const wb = b.worstStage === null ? -1 : b.worstStage;
  if (wa !== wb) return wa - wb;
  return a.formation.name < b.formation.name ? -1 : a.formation.name > b.formation.name ? 1 : 0;
}
