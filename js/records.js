// 戦績の集計と月の締めのアーカイブ（純粋関数群）
// 記録画面（M10）と帯の前回要約（M1）、コンディション画面のペース内訳の材料。
// DOM・保存には触れない。
// 苦手傾向と勝率は、件数が貯まるまで出さない（requirements.md M10）。
// ここでは集計そのものを行い、表示のしきい値は定数として持つ。

import { squareDef } from './derive.js';

export const TENDENCY_MIN_BATTLES = 3; // 敵ごとの苦手傾向を出す最小の戦数
export const FORMATION_RATE_MIN_BATTLES = 3; // 編成ごとの勝率を出す最小の戦数

// 1ラン分の戦績エントリ（表示用の構造）。
// 戻り値: [{index, floor, squareId, kind:'battle'|'explore', result?, box?,
//           formationName, formationId, enemies: [敵名]}]
// formationId は戦闘 op が保存している編成の ID（勝率集計のキー。
// 旧い記録の op には無いため null になり、集計は名前へ落ちる）。
export function runEntries(structure, ops) {
  const entries = [];
  ops.forEach((op, index) => {
    if (op.type !== 'battle' && op.type !== 'explore') return;
    const def = squareDef(structure, op.squareId);
    entries.push({
      index,
      floor: op.floor,
      squareId: op.squareId,
      kind: op.type,
      result: op.type === 'battle' ? op.result : null,
      box: op.type === 'explore' ? op.box : null,
      formationName: op.formationName || null,
      formationId: op.formationId || null,
      enemies: def && Array.isArray(def.enemies) ? def.enemies : [],
      members: op.members || [],
    });
  });
  return entries;
}

// 閉じた日を「YYYY年M月D日」で返す（記録画面の見出し用）。
// 保存済みのアーカイブの label は「YYYY年M月」のままで書き換えず、
// 閉じた日は closedAt から表示の時に補う（最終チェック K6 の小物、
// 2026-11-20）。日付はローカル時刻基準（archiveRun の label と同じ基準）。
// closedAt が読めなければ null を返し、呼び出し側が従来表示へ落ちる。
export function closedDayText(closedAt) {
  if (!closedAt) return null;
  const date = new Date(closedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

// 階ごとの要約文（帯の「前回:」表示と、アーカイブの floorSummaries 用）。
// 例: 「13マス処理、ボスは「編成名」編成で勝利」
export function floorSummaryText(structure, ops, floor) {
  const fd = structure.floors.find((f) => f.floor === floor);
  if (!fd) return null;
  const clearedSquares = new Set();
  let bossText = null;
  let bossAttempted = false;
  for (const op of ops) {
    if (op.floor !== floor) continue;
    const def = fd.squares[op.squareId];
    if (!def || def.type === 'start') continue;
    if (op.type === 'explore') clearedSquares.add(op.squareId);
    if (op.type === 'battle') {
      if (op.result === 'win') clearedSquares.add(op.squareId);
      if (def.type === 'boss') {
        bossAttempted = true;
        if (op.result === 'win') {
          bossText = op.formationName ? `ボスは「${op.formationName}」編成で勝利` : 'ボスに勝利';
        }
      }
    }
  }
  if (clearedSquares.size === 0 && !bossAttempted) return null;
  const parts = [`${clearedSquares.size}マス解放`];
  if (bossText) parts.push(bossText);
  else if (bossAttempted) parts.push('ボスは未勝利');
  return parts.join('、');
}

// 編成ごとの戦闘数（しきい値なし、全件。SW94）: 編成一覧の行に
// その編成自身の勝敗を軽く出すための材料。キーの作り方は
// aggregateRecords の勝率集計と完全に同じ（ID があれば ID、無ければ
// 名前）で、集計そのもの（3戦のしきい値と並び）は変えない。
// 戻り値: Map(key -> {battles, wins, losses, retreats})
// key は `id:{編成ID}` または `name:{編成名}`。
export function formationBattleCounts(structure, opsList) {
  const map = new Map();
  for (const ops of opsList) {
    for (const entry of runEntries(structure, ops)) {
      if (entry.kind !== 'battle') continue;
      const key = entry.formationId
        ? `id:${entry.formationId}`
        : (entry.formationName ? `name:${entry.formationName}` : null);
      if (!key) continue;
      const row = map.get(key) || { battles: 0, wins: 0, losses: 0, retreats: 0 };
      row.battles += 1;
      if (entry.result === 'win') row.wins += 1;
      else if (entry.result === 'lose') row.losses += 1;
      else if (entry.result === 'retreat') row.retreats += 1;
      map.set(key, row);
    }
  }
  return map;
}

// 2つの日時の間の暦日数（両端を含む。開始日を1日目と数える）。
// 「自分の記録」の日数（今月は何日目か、先月は何日かかったか）の
// 事実を返すためだけに使う。日付の見込みは計算しない（定義の層の
// 決着）。読めない・逆転している場合は null。
export function inclusiveDays(startAt, endAt) {
  const s = new Date(startAt);
  const e = new Date(endAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const sd = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const ed = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  const days = Math.round((ed - sd) / 86400000) + 1;
  return days >= 1 ? days : null;
}

// そのランの到達階（戦闘・探索の記録がある最も高い階）。記録が
// 無ければ null。「自分の記録」の事実用。
export function reachedFloorOf(ops) {
  let max = null;
  for (const op of ops || []) {
    if (op.type !== 'battle' && op.type !== 'explore') continue;
    if (typeof op.floor === 'number' && (max === null || op.floor > max)) max = op.floor;
  }
  return max;
}

// ランを戦績として閉じるためのアーカイブ（H3 の月の締め）。
// records ストアの runs に積む形: {closedAt, label, ops, floorSummaries, stats}
// startedAt はランの開始日（SW94、「自分の記録」の日数の材料）。
// 開始日が分からないラン（この便より前に始まったラン等）は null で、
// 日数は出さない（階の事実だけを返す）。
export function archiveRun(structure, ops, closedAt, startedAt = null) {
  const date = new Date(closedAt);
  const label = `${date.getFullYear()}年${date.getMonth() + 1}月`;
  const floorSummaries = {};
  for (const f of structure.floors) {
    const text = floorSummaryText(structure, ops, f.floor);
    if (text) floorSummaries[f.floor] = text;
  }
  const entries = runEntries(structure, ops);
  const battles = entries.filter((e) => e.kind === 'battle');
  const clearedSquares = new Set();
  const floorsCleared = new Set();
  for (const op of ops) {
    const def = squareDef(structure, op.squareId);
    if (!def || def.type === 'start') continue;
    if (op.type === 'explore') clearedSquares.add(op.squareId);
    if (op.type === 'battle' && op.result === 'win') {
      clearedSquares.add(op.squareId);
      if (def.type === 'boss') floorsCleared.add(op.floor);
    }
  }
  return {
    closedAt,
    startedAt: startedAt || null,
    label,
    ops: [...ops],
    floorSummaries,
    stats: {
      battles: battles.length,
      wins: battles.filter((e) => e.result === 'win').length,
      losses: battles.filter((e) => e.result === 'lose').length,
      retreats: battles.filter((e) => e.result === 'retreat').length,
      explores: entries.filter((e) => e.kind === 'explore').length,
      floorsCleared: [...floorsCleared].sort((a, b) => a - b),
      squaresProcessed: clearedSquares.size,
    },
  };
}

// 敵ごとの苦手傾向と、編成ごとの勝率の集計（複数ランの ops をまとめて数える）。
// 編成のキーは編成 ID を優先する（最終チェック K6 の小物、2026-11-20:
// 名前で数えると改名で記録が割れるため）。ID の無い旧い記録は名前で数え、
// 過去データは書き換えない。ID でまとめた行の表示名は、走査で最後に
// 現れた名前（ops は時系列順のため、改名後の名前で出る）。
// 戻り値: { enemies: [{name, battles, wins, losses, retreats}]（しきい値以上、
//           負け＋リタイアの多い順）, formations: [{name, battles, wins, losses,
//           retreats}]（しきい値以上、戦数の多い順）, maxEnemyBattles, maxFormationBattles }
export function aggregateRecords(structure, opsList) {
  const enemyMap = new Map();
  const formationMap = new Map();
  const bump = (map, key, result) => {
    if (!key) return;
    const row = map.get(key) || { name: key, battles: 0, wins: 0, losses: 0, retreats: 0 };
    row.battles += 1;
    if (result === 'win') row.wins += 1;
    else if (result === 'lose') row.losses += 1;
    else if (result === 'retreat') row.retreats += 1;
    map.set(key, row);
  };
  const bumpFormation = (entry) => {
    const key = entry.formationId
      ? `id:${entry.formationId}`
      : (entry.formationName ? `name:${entry.formationName}` : null);
    if (!key) return;
    const row = formationMap.get(key)
      || { name: entry.formationName || '', battles: 0, wins: 0, losses: 0, retreats: 0 };
    if (entry.formationName) row.name = entry.formationName;
    row.battles += 1;
    if (entry.result === 'win') row.wins += 1;
    else if (entry.result === 'lose') row.losses += 1;
    else if (entry.result === 'retreat') row.retreats += 1;
    formationMap.set(key, row);
  };
  for (const ops of opsList) {
    for (const entry of runEntries(structure, ops)) {
      if (entry.kind !== 'battle') continue;
      for (const name of entry.enemies) bump(enemyMap, name, entry.result);
      bumpFormation(entry);
    }
  }
  const enemiesAll = [...enemyMap.values()];
  const formationsAll = [...formationMap.values()];
  return {
    enemies: enemiesAll
      .filter((r) => r.battles >= TENDENCY_MIN_BATTLES)
      .sort((a, b) => (b.losses + b.retreats) - (a.losses + a.retreats) || b.battles - a.battles),
    formations: formationsAll
      .filter((r) => r.battles >= FORMATION_RATE_MIN_BATTLES)
      .sort((a, b) => b.battles - a.battles),
    maxEnemyBattles: enemiesAll.reduce((m, r) => Math.max(m, r.battles), 0),
    maxFormationBattles: formationsAll.reduce((m, r) => Math.max(m, r.battles), 0),
  };
}

// メギドごとの使用回数と、その逆引きの材料（調査 A2・A6、2026-11-26 採用）。
// 数え方は勝率集計（aggregateRecords）と揃える: 対象は渡された全ラン
// （今のラン＋終わったラン）の戦闘記録のみで、探索は数えない。単位は
// 1戦闘につき編成メンバー1人あたり1回。評価は付けない（回数の事実だけ）。
// members の無い旧い記録は数えられない（推測で埋めない）。
// 戻り値: [{ id, count, bands: [7帯の回数（1–5F、6–10F、…、31–35F）],
//           uses: [{ floor, squareId, result, formationName, enemies }] }]
// 並びは回数の多い順。同数は ID の文字列順で決定的にする。uses は
// 記録の現れた順（渡された ops の順）のまま返す。
export function megidoUsage(structure, opsList) {
  const map = new Map();
  for (const ops of opsList) {
    for (const entry of runEntries(structure, ops)) {
      if (entry.kind !== 'battle') continue;
      for (const id of entry.members) {
        if (!id) continue;
        let row = map.get(id);
        if (!row) {
          row = { id, count: 0, bands: [0, 0, 0, 0, 0, 0, 0], uses: [] };
          map.set(id, row);
        }
        row.count += 1;
        const band = Math.min(6, Math.max(0, Math.floor((entry.floor - 1) / 5)));
        row.bands[band] += 1;
        row.uses.push({
          floor: entry.floor,
          squareId: entry.squareId,
          result: entry.result,
          formationName: entry.formationName,
          enemies: entry.enemies,
        });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// 自分のペースの内訳（コンディション画面の下部。M1 の見通しの根拠）。
// derived は deriveRun の結果。消費ペースは見通しと同じ定義
// （踏破した階の消費合計 ÷ 踏破した階数）。
export function paceBreakdown(structure, derived, ops) {
  const entries = runEntries(structure, ops);
  const battles = entries.filter((e) => e.kind === 'battle');
  let spent = 0;
  for (const f of derived.clearedFloors) spent += derived.consumptionByFloor.get(f) || 0;
  const clearedCount = derived.clearedFloors.size;
  const upcomingTowerFloors = [];
  for (let f = derived.currentFloor; f <= 35; f += 1) {
    const fd = structure.floors.find((x) => x.floor === f);
    if (!fd) continue;
    let remaining = 0;
    for (const [id, def] of Object.entries(fd.squares)) {
      if (def.type === 'explore' && def.subType === 'tower_power' && !derived.cleared.has(id)) {
        remaining += 1;
      }
    }
    if (remaining > 0) upcomingTowerFloors.push({ floor: f, remaining });
  }
  return {
    battles: battles.length,
    wins: battles.filter((e) => e.result === 'win').length,
    losses: battles.filter((e) => e.result === 'lose').length,
    retreats: battles.filter((e) => e.result === 'retreat').length,
    explores: entries.filter((e) => e.kind === 'explore').length,
    clearedFloors: clearedCount,
    pace: clearedCount > 0 ? spent / clearedCount : null,
    upcomingTowerFloors,
  };
}
