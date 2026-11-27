// 値打ちの判定（M3・拡張1、2026-11-19）
// マスを開いた時点の「踏む価値があるか」への材料と、割に合わないと
// 導出できる場合の明示（ui-flow.md M3「値打ちの判定（拡張1）」）。
// 材料は既存データから導出できる範囲だけに限る:
//   - 能力上昇マス: 取得量の見込み（期待度ごとの範囲。表示形は
//     explore.js の見込み・ストリップと同じ範囲表記）、蓄積の上限への
//     近さ、この先に残っている戦闘の数（自分の残りの進路との対応）。
//   - 戦闘マス: この戦闘で新しく開く能力上昇マスと、その見込み
//     （スカルワイバーン事例の構造: 戦闘そのものの報酬ではなく、
//     解放されるバフマスの小ささとコストの対応が判断になる）。
// 判定文（「踏む価値は低い」）は、導出で言い切れる場合だけ出す:
//   - 得られるステータスが上限に達していて、得ても増えない。
//   - この先に戦うマスが残っていない（バフを使う場面が無い）。
//   - 戦闘マスで、新しく開くマスが無い／開くのが上限に達した
//     能力上昇マスだけ。
// 敵の強さそのものの評価は機械では行わない（著述＝M4 が担う）。
// DOM・保存には触れない（Node のテストから直接呼べる）。

import {
  BUFF_CAPS, BUFF_STAT_LABEL, BUFF_STATS, BUFF_SUBTYPES, BUFF_STAT_BY_SUBTYPE,
  STYLE_NAME, squareDef, squareState, dmgTypeBreakdown,
} from './derive.js';
import { expectationRewardParts, expectationOutlookNote } from './explore.js';

const BUFF_REWARD_LABEL = {
  attack_buff: '攻撃力上昇', defense_buff: '防御力上昇', hp_buff: 'HP上昇', status_buff: 'ステータス上昇',
};

// この先の進路: fromFloor 以降の階について、寄り道せずに進む場合
// （最短路）で残っている戦闘・ボスのマスの数。ボスは階の関門として
// 分けて数える（2026-11-25 マスター指示で全数えから最短路へ変更）。
export function remainingRoute(structure, cleared, fromFloor) {
  let battles = 0;
  let bosses = 0;
  for (const fd of (structure && structure.floors) || []) {
    if (!fd || fd.floor < fromFloor) continue;
    const r = floorShortestRoute(structure, cleared, fd);
    battles += r.battles;
    bosses += r.bosses;
  }
  return { battles, bosses, total: battles + bosses };
}

// 1つの階の最短路: 開始マスと処理済みのマスから出発し、隣接をたどって
// ボスに届くまでに処理が残る戦闘・ボスマスの数。未処理のマスは処理
// して進む前提で、戦闘・ボスは未処理なら1つと数え、探索マスは数に
// 入れない（通過はできる）。戦闘数が同点なら歩数の少ない路を選ぶ。
// ボスが処理済みなら0。ボスに届かない場合は、その階の未処理の
// 戦闘・ボスを全部数える（届かない事態への保険）。
function floorShortestRoute(structure, cleared, fd) {
  const squares = fd.squares || {};
  const ids = Object.keys(squares);
  const startId = ids.find((id) => squares[id].type === 'start');
  const bossId = ids.find((id) => squares[id].type === 'boss');
  if (!startId || !bossId) return { battles: 0, bosses: 0 };
  const isCleared = (id) => Boolean(cleared && cleared.has(id));
  if (isCleared(bossId)) return { battles: 0, bosses: 0 };
  const cost = (id) => {
    const t = squares[id].type;
    return (t === 'battle' || t === 'boss') && !isCleared(id) ? 1 : 0;
  };
  // Dijkstra（コストは [戦闘数, 歩数] の辞書順）。階のマス数は
  // 最大でも二十程度のため、優先度付き待ち行列は線形走査で足りる。
  const dist = new Map();
  const settled = new Set();
  const offer = (id, fights, steps) => {
    const cur = dist.get(id);
    if (!cur || fights < cur[0] || (fights === cur[0] && steps < cur[1])) {
      dist.set(id, [fights, steps]);
    }
  };
  offer(startId, 0, 0);
  for (const id of ids) if (isCleared(id)) offer(id, 0, 0);
  for (;;) {
    let bestId = null;
    let best = null;
    for (const [id, c] of dist) {
      if (settled.has(id)) continue;
      if (!best || c[0] < best[0] || (c[0] === best[0] && c[1] < best[1])) {
        best = c; bestId = id;
      }
    }
    if (bestId === null) break;
    settled.add(bestId);
    if (bestId === bossId) break;
    for (const n of (structure.adjacency && structure.adjacency[bestId]) || []) {
      if (!squares[n] || settled.has(n)) continue;
      offer(n, best[0] + cost(n), best[1] + 1);
    }
  }
  const atBoss = dist.get(bossId);
  if (!atBoss) {
    let battles = 0;
    let bosses = 0;
    for (const id of ids) {
      if (isCleared(id)) continue;
      if (squares[id].type === 'battle') battles += 1;
      else if (squares[id].type === 'boss') bosses += 1;
    }
    return { battles, bosses };
  }
  // ボスは必ず路の終点に1つ含まれる（未処理のため cost に入っている）。
  return { battles: atBoss[0] - 1, bosses: 1 };
}

// このマスを処理すると新しく開くマス（現在は解放不可の隣接マス）。
// 解放は「隣接のどれか1つを処理する」ことで起きるため、処理前の
// 時点で解放不可の隣接マスは、このマスを処理すれば解放可能になる。
export function newlyUnlockedSquares(structure, cleared, squareId) {
  const out = [];
  for (const id of (structure && structure.adjacency && structure.adjacency[squareId]) || []) {
    if (squareState(structure, cleared, id) !== 'locked') continue;
    const def = squareDef(structure, id);
    if (def) out.push({ id, def });
  }
  return out;
}

// スタイルごとの塔効果の表示文（M8 の枠表示用）:
// 「攻撃力+6%・HP+10%」。蓄積が無いスタイルは null。
export function styleBuffText(buffs, styleCode) {
  const totals = buffs ? buffs[styleCode] : null;
  if (!totals) return null;
  const parts = [];
  for (const k of BUFF_STATS) {
    if (!(totals[k] > 0)) continue;
    // ダメージ上昇に単体以外の種別の蓄積がある場合は、種別ごとに言う。
    if (k === 'dmg') {
      const breakdown = dmgTypeBreakdown(totals);
      if (breakdown) {
        for (const b of breakdown) parts.push(`${b.label}+${b.value}%`);
        continue;
      }
    }
    parts.push(`${BUFF_STAT_LABEL[k]}+${totals[k]}%`);
  }
  return parts.length > 0 ? parts.join('・') : null;
}

// そのマスで得られるステータスが、蓄積の上限に照らしてどうなって
// いるか。fixedStat が null（status_buff）なら hp/atk/def の全体で見る。
// 戻り値: { targetStats, cappedStats, allCapped }
function capStateOf(def, raw) {
  const fixedStat = BUFF_STAT_BY_SUBTYPE[def.subType];
  const targetStats = fixedStat ? [fixedStat] : ['hp', 'atk', 'def'];
  const cappedStats = targetStats.filter((k) => raw && raw[k] >= BUFF_CAPS[k]);
  return { targetStats, cappedStats, allCapped: cappedStats.length === targetStats.length };
}

// 能力上昇マスの値打ち材料。
// def: マスの定義（subType / style）。totals / raw: 対象スタイルの
// 蓄積（上限適用後／適用前）。route: remainingRoute の結果。
// 戻り値: { outlookLines, noteLines, verdict }
export function buffWorth({ explorationModel, def, totals, raw, route }) {
  // 取得量の見込み: 期待度ごとの範囲（ストリップと同じ表・同じ形）。
  const outlookLines = [];
  for (const e of [3, 2, 1]) {
    const parts = expectationRewardParts({ explorationModel, def, expectation: e });
    if (parts && parts.main) outlookLines.push(`期待度${e}の見込み: ${parts.main}`);
  }
  const fixedStat = BUFF_STAT_BY_SUBTYPE[def.subType];
  const { cappedStats, allCapped } = capStateOf(def, raw);

  const noteLines = [];
  // 虹のボーナスの注記は、ストリップと同じく見込みの直下に小さく出す。
  const bonusNote = expectationOutlookNote({ explorationModel, def, expectation: 3 });
  if (bonusNote && outlookLines.length > 0) noteLines.push(bonusNote);
  if (!allCapped) {
    // 一部のステータスだけが上限に達している場合は事実として出す
    // （得たステータスがそれだと増えない、という判断材料）。
    for (const k of cappedStats) {
      noteLines.push(`${BUFF_STAT_LABEL[k]}は上限（${BUFF_CAPS[k]}%）に達しています`);
    }
    // 固定ステータスで蓄積がある場合は、上限までの残りを出す。
    if (fixedStat && cappedStats.length === 0 && totals && totals[fixedStat] > 0) {
      const headroom = BUFF_CAPS[fixedStat] - (raw ? raw[fixedStat] : 0);
      if (headroom > 0) {
        noteLines.push(`${BUFF_STAT_LABEL[fixedStat]}は上限（${BUFF_CAPS[fixedStat]}%）まであと${headroom}%`);
      }
    }
  }
  if (route && route.total > 0) {
    noteLines.push(`今後、戦闘マスは最短で${route.total}マス（うちボス${route.bosses}マス）残っています`);
  }

  let verdict = null;
  if (allCapped) {
    verdict = fixedStat
      ? `${BUFF_STAT_LABEL[fixedStat]}は上限（${BUFF_CAPS[fixedStat]}%）に達していて、ここで得ても増えません`
      : 'どのステータスも上限に達していて、ここで得ても増えません';
  } else if (route && route.total === 0) {
    verdict = 'この先に戦うマスが残っていないため、このバフを使う場面がありません';
  }
  return { outlookLines, noteLines, verdict };
}

// 戦闘マスの値打ち材料: この戦闘で新しく開くマスのうち、能力上昇
// マスだけを材料にする（進路そのものはマップと未解放マスの案内が
// 担うため、他の種別はここでは扱わない）。
// 戻り値: { lines, verdict } または null（言うことが無い場合）。
export function battleWorth({ structure, explorationModel, cleared, squareId, buffRaw }) {
  const newly = newlyUnlockedSquares(structure, cleared, squareId);
  if (newly.length === 0) {
    return { lines: [], verdict: 'この戦闘で新しく開くマスはありません' };
  }
  const buffSquares = newly.filter(
    (n) => n.def.type === 'explore' && BUFF_SUBTYPES.has(n.def.subType),
  );
  if (buffSquares.length === 0) return null;
  const lines = buffSquares.map((n) => {
    const parts = expectationRewardParts({ explorationModel, def: n.def, expectation: 3 });
    const gain = parts && parts.main ? `（期待度3の見込み: ${parts.main}）` : '';
    return `勝つと開くマス: ${STYLE_NAME[n.def.style]}の${BUFF_REWARD_LABEL[n.def.subType] || 'ステータス上昇'}${gain}`;
  });
  let verdict = null;
  if (newly.length === buffSquares.length) {
    const allCapped = buffSquares.every((n) => {
      const raw = buffRaw ? buffRaw[n.def.style] : null;
      if (!raw) return false;
      return capStateOf(n.def, raw).allCapped;
    });
    if (allCapped) {
      verdict = '開くのは、上限に達していて得ても増えない能力上昇マスだけです';
    }
  }
  return { lines, verdict };
}
