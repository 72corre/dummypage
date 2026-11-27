// 状態の導出（純粋関数群）
// 保存済みの操作履歴（ops）から、ランの状態（塔破力・解放・コンディション・見通し）を都度計算する。
// tech-foundation.md 第8節「状態の導出は操作履歴からの都度計算」に対応する。
// DOM・保存・通信には一切触れない（Node のテストから直接呼べる）。

export const CONDITION_STAGES = ['絶好調', '好調', '普通', '不調', '絶不調', '気絶'];
export const STAGE_GREAT = 0; // 絶好調
export const STAGE_VERY_BAD = 4; // 絶不調
export const STAGE_FAINTED = 5; // 気絶

export const STYLE_NAME = { R: 'ラッシュ', C: 'カウンター', B: 'バースト' };
export const STYLE_CODE = { 'ラッシュ': 'R', 'カウンター': 'C', 'バースト': 'B' };
export const STYLE_ORDER = ['R', 'C', 'B'];

export const INITIAL_TOWER_POWER = 30;
export const LAST_FLOOR = 35;

// 塔効果バフ（能力上昇マス）。対象スタイルはマスごとに固定、上がるステータスは結果で決まる。
// 上限は HP・攻撃力30%、防御力50%（research/tower-system-wiki.md）。ダメージ上昇の上限は不明なため数えない。
export const BUFF_CAPS = { hp: 30, atk: 30, def: 50 };
export const BUFF_STAT_LABEL = { hp: 'HP', atk: '攻撃力', def: '防御力', dmg: 'ダメージ上昇' };
// ランダムボーナスのダメージ上昇の種別（ゲームの結果画面の言葉）。
// 現行の単体・範囲に列・全体を加えた4種（2026-11-25 マスター指示）。
export const DMG_TYPE_LABEL = { single: '単体', range: '範囲', row: '列', all: '全体' };
export const DMG_TYPE_ORDER = ['single', 'range', 'row', 'all'];
// ダメージ上昇の種別ごとの内訳（totals.dmgTypes から）。単体以外の
// 蓄積がある場合だけ種別ごとに出すための材料で、内訳が無い（種別を
// 記録していない材料）か単体だけの場合は null を返し、表示は従来の
// 「ダメージ上昇」にまとめる。
export function dmgTypeBreakdown(totals) {
  const t = totals && totals.dmgTypes;
  if (!t) return null;
  if (!DMG_TYPE_ORDER.some((c) => c !== 'single' && (t[c] || 0) > 0)) return null;
  return DMG_TYPE_ORDER
    .filter((c) => (t[c] || 0) > 0)
    .map((c) => ({ code: c, label: `${DMG_TYPE_LABEL[c]}ダメージ上昇`, value: t[c] }));
}
export const BUFF_STATS = ['hp', 'atk', 'def', 'dmg'];
export const BUFF_SUBTYPES = new Set(['status_buff', 'attack_buff', 'defense_buff', 'hp_buff']);
// subType から決まるステータス（status_buff はランダムのため null＝結果で選ぶ）。
export const BUFF_STAT_BY_SUBTYPE = { hp_buff: 'hp', attack_buff: 'atk', defense_buff: 'def', status_buff: null };
// 見通しの確定条件（research/tower-power-verification.md）: ペースへの余裕。
export const PACE_MARGIN = 1.15;
// 判定を出し始める戦績の目安（踏破した階数）。
export const PACE_MIN_CLEARED_FLOORS = 3;

// 階のデータを取り出す。
export function floorData(structure, floor) {
  return structure.floors.find((f) => f.floor === floor) || null;
}

// その階の通常戦闘マスに共通するバトルルール（戦闘マスの rules の
// うち最も多くのマスに付いているもの1つ。同数なら最初に現れた方）。
// ボスマスだけのルールは数えない（ボスの扱いはボスマスのシート側）。
// 戦闘マスが無い・ルールが1つも無い階は null。
export function floorBattleRule(fd) {
  if (!fd || !fd.squares) return null;
  const counts = new Map();
  for (const def of Object.values(fd.squares)) {
    if (def.type !== 'battle') continue;
    for (const rule of def.rules || []) {
      counts.set(rule, (counts.get(rule) || 0) + 1);
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [rule, n] of counts) {
    if (n > bestCount) { best = rule; bestCount = n; }
  }
  return best;
}

// マスの定義を取り出す（全階から探す）。
export function squareDef(structure, squareId) {
  const floor = Number(String(squareId).split('-')[0].slice(1));
  const fd = floorData(structure, floor);
  if (!fd) return null;
  const def = fd.squares[squareId];
  return def ? { floor, ...def } : null;
}

// スタートマスのID。
export function startSquareId(structure, floor) {
  const fd = floorData(structure, floor);
  if (!fd) return null;
  for (const [id, def] of Object.entries(fd.squares)) {
    if (def.type === 'start') return id;
  }
  return null;
}

// 所持集合。megidoDetails が null（未設定＝初回）なら全員所持として扱う
// （ui-flow.md「初回の流れ: 初期状態は全員所持として扱い、外す方式」）。
// オブジェクトが入っている場合は owned === true の明示がある者だけが所持
// （旧ツールの意味論をそのまま引き継ぐ: エントリが無い者は未所持）。
export function ownedIdSet(megidoBasics, megidoDetails) {
  const all = megidoBasics.megido.map((m) => m.id);
  if (megidoDetails == null) return new Set(all);
  const set = new Set();
  for (const id of all) {
    if (megidoDetails[id] && megidoDetails[id].owned === true) set.add(id);
  }
  return set;
}

// 回復の割り当て計画（M9 の自動反映）。
// 候補は「回復できる者（絶好調より悪い）」を悪い順に並べたもの。
// count 人ぶんを悪い順に取る。同段階のグループを途中で割る場合は境界として返し、
// その分は利用者の確認（boundaryPicks）が無ければ適用しない。
// candidates: [{id, stage}]（stage は段階インデックス、大きいほど悪い）
export function planRecovery(candidates, count) {
  const sorted = [...candidates].sort((a, b) => (b.stage - a.stage) || (a.id < b.id ? -1 : 1));
  const auto = [];
  let rest = count;
  let i = 0;
  while (rest > 0 && i < sorted.length) {
    const stage = sorted[i].stage;
    const group = [];
    while (i < sorted.length && sorted[i].stage === stage) {
      group.push(sorted[i].id);
      i += 1;
    }
    if (group.length <= rest) {
      auto.push(...group);
      rest -= group.length;
    } else {
      return { auto, boundary: { stage, candidates: group, need: rest } };
    }
  }
  return { auto, boundary: null };
}

// 塔破力マスの期待回復（期待度3・基本箱＝赤）。検証で使った実量。
export function towerPowerExpected(structure, recommendedPower) {
  const table = structure.explorationModel.towerPowerRecovery[String(recommendedPower)];
  if (!table) return 0;
  const v = table['赤'];
  return typeof v === 'number' ? v : 0;
}

// 回復マスの規模（体数×段階）。箱が虹で複数候補ある場合は variant で選ぶ。
export function recoverySpec(structure, recommendedPower, box, variant = 0) {
  const table = structure.explorationModel.conditionRecovery[String(recommendedPower)];
  if (!table) return null;
  const entry = table[box];
  if (entry == null) return null;
  if (Array.isArray(entry)) return entry[Math.min(variant, entry.length - 1)];
  return entry;
}

// 操作履歴からランの状態を導出する。
// ops の形式:
//   {type:'startRun', floor, conditions?:{megidoId:段階}, conditionsUnknown?:真偽,
//    towerPower?:数値}                              ランの開始（状態を初期化し、その階から。H3 の途中開始では初期状態を持てる）
//   {type:'battle', squareId, floor, result:'win'|'lose'|'retreat', members:[megidoId]}
//   {type:'explore', squareId, floor, members:[megidoId], box:'緑'|'青'|'赤'|'虹',
//    style?:'R'|'C'|'B'（ランダム回復の実結果）, powerGain?:数値（塔破力マスで
//    画面に出た実際の回復量。あれば箱表より優先する）,
//    recoveryVariant?:数値（虹の体数×段階の選択）,
//    recoveryCount?:数値・recoveryStages?:数値（回復マスで画面に出た実際の
//    規模。表に無い規模が記録された場合に、箱＋variant の規模より優先する）,
//    boundaryPicks?:[megidoId]（M9の境界確認）,
//    buffGains?:[{stat:'hp'|'atk'|'def'|'dmg', pct:数値}]（能力上昇マスの結果）,
//    buffPower?:数値（虹の追加効果で塔破力が増えた分）,
//    buffBonus?:真偽（ランダムのボーナスが出たか。出なかった場合は false を
//    明示して記録し、未入力・不明（旧い記録）とは区別する）}
//   {type:'conditionFix', megidoId, stage}         コンディションの直接の直し（H2。緊急回復もこの経路）
export function deriveRun({ structure, megidoBasics, megidoDetails, ops }) {
  const styleById = new Map(megidoBasics.megido.map((m) => [m.id, STYLE_CODE[m.style]]));
  const owned = ownedIdSet(megidoBasics, megidoDetails);

  const state = {
    started: false,
    baseFloor: 1,
    currentFloor: 1,
    towerPower: INITIAL_TOWER_POWER,
    cleared: new Set(),
    attemptedBosses: new Set(),
    attempts: new Map(), // squareId -> 試行回数
    conditions: new Map(), // megidoId -> 段階インデックス（触れた者だけ。既定は絶好調）
    clearedFloors: new Set(), // ボスを倒した階
    consumptionByFloor: new Map(), // floor -> 塔破力の消費合計
    towerCollected: false, // 塔破力マスを1つでも回収したか（行動一致の判定）
    recoveryPending: null, // M9 の境界確認待ち {squareId, style, stage, candidates, need, count, stages}
    runComplete: false,
    conditionsPartial: false, // H3 の途中開始で、コンディションの一部が「不明」のままか
    buffRaw: null, // スタイルごとの塔効果の蓄積（上限を掛ける前） {R:{hp,atk,def,dmg},C:{...},B:{...}}
    buffDmgTypes: null, // ダメージ上昇の種別ごとの蓄積 {R:{single,range,row,all},...}（buffRaw.dmg の内訳）
    buffGains: [], // 塔効果の取得の内訳 [{squareId, floor, style, stat, pct}]
  };

  const emptyBuffs = () => Object.fromEntries(
    STYLE_ORDER.map((s) => [s, Object.fromEntries(BUFF_STATS.map((k) => [k, 0]))]),
  );
  const emptyDmgTypes = () => Object.fromEntries(
    STYLE_ORDER.map((s) => [s, Object.fromEntries(DMG_TYPE_ORDER.map((k) => [k, 0]))]),
  );

  const resetRun = (floor) => {
    state.started = true;
    state.baseFloor = floor;
    state.currentFloor = floor;
    state.towerPower = INITIAL_TOWER_POWER;
    state.cleared = new Set();
    const startId = startSquareId(structure, floor);
    if (startId) state.cleared.add(startId);
    state.attemptedBosses = new Set();
    state.attempts = new Map();
    state.conditions = new Map();
    state.clearedFloors = new Set();
    state.consumptionByFloor = new Map();
    state.towerCollected = false;
    state.recoveryPending = null;
    state.runComplete = false;
    state.conditionsPartial = false;
    state.buffRaw = emptyBuffs();
    state.buffDmgTypes = emptyDmgTypes();
    state.buffGains = [];
  };
  resetRun(1);
  state.started = ops.some((op) => op.type === 'startRun');

  const conditionOf = (id) => state.conditions.get(id) ?? STAGE_GREAT;
  const worsen = (id, stages) => {
    state.conditions.set(id, Math.min(STAGE_FAINTED, conditionOf(id) + stages));
  };
  const improve = (id, stages) => {
    state.conditions.set(id, Math.max(STAGE_GREAT, conditionOf(id) - stages));
  };
  const spend = (floor, amount) => {
    state.towerPower -= amount;
    state.consumptionByFloor.set(floor, (state.consumptionByFloor.get(floor) || 0) + amount);
  };

  for (const op of ops) {
    if (op.type === 'startRun') {
      resetRun(op.floor || 1);
      state.started = true;
      // H3 の途中開始: 把握している範囲のコンディションと現在の塔破力を初期状態として持てる。
      if (op.conditions && typeof op.conditions === 'object') {
        for (const [id, stage] of Object.entries(op.conditions)) {
          if (typeof stage === 'number') {
            state.conditions.set(id, Math.max(STAGE_GREAT, Math.min(STAGE_FAINTED, stage)));
          }
        }
      }
      if (op.conditionsUnknown) state.conditionsPartial = true;
      if (typeof op.towerPower === 'number') state.towerPower = op.towerPower;
      continue;
    }
    if (op.type === 'conditionFix') {
      // H2 の直接の直し（実物に合わせて段階を置く。緊急回復もここを通る）。
      if (op.megidoId && typeof op.stage === 'number') {
        state.conditions.set(op.megidoId, Math.max(STAGE_GREAT, Math.min(STAGE_FAINTED, op.stage)));
      }
      continue;
    }
    if (op.type === 'battle') {
      const def = squareDef(structure, op.squareId);
      const isBoss = def && def.type === 'boss';
      const firstBossAttempt = isBoss && !state.attemptedBosses.has(op.squareId);
      const cost = firstBossAttempt ? 0 : 1;
      spend(op.floor, cost);
      state.attempts.set(op.squareId, (state.attempts.get(op.squareId) || 0) + 1);
      if (isBoss) state.attemptedBosses.add(op.squareId);
      const members = op.members || [];
      if (op.result === 'win') {
        for (const id of members) worsen(id, 1);
        state.cleared.add(op.squareId);
        if (isBoss) {
          state.clearedFloors.add(op.floor);
          if (op.floor === state.currentFloor) {
            if (op.floor >= LAST_FLOOR) state.runComplete = true;
            else {
              state.currentFloor = op.floor + 1;
              // 次の階の開始マスはクリア扱い（棚卸し 2-7。resetRun が
              // 開始階の開始マスを cleared に入れるのと同じ意味論で、
              // これが無いと次階の開始隣接マスが永遠に解放されない）。
              const nextStart = startSquareId(structure, state.currentFloor);
              if (nextStart) state.cleared.add(nextStart);
            }
          }
        }
      } else if (op.result === 'lose') {
        for (const id of members) worsen(id, 2);
      }
      // retreat: コンディション不変（ゲームの実挙動。ダイアログ文面とは異なる）
      continue;
    }
    if (op.type === 'explore') {
      const def = squareDef(structure, op.squareId);
      spend(op.floor, 1);
      state.attempts.set(op.squareId, (state.attempts.get(op.squareId) || 0) + 1);
      state.cleared.add(op.squareId);
      const members = op.members || [];
      for (const id of members) worsen(id, 2);
      if (!def) continue;
      if (def.subType === 'tower_power') {
        let gain = op.powerGain;
        if (typeof gain !== 'number') {
          const table = structure.explorationModel.towerPowerRecovery[String(def.recommendedPower)];
          const raw = table ? table[op.box] : null;
          gain = typeof raw === 'number' ? raw : Array.isArray(raw) ? raw[0] : towerPowerExpected(structure, def.recommendedPower);
        }
        state.towerPower += gain;
        state.towerCollected = true;
      }
      if (BUFF_SUBTYPES.has(def.subType) && Array.isArray(op.buffGains)) {
        // 能力上昇マス: 対象スタイルはマスごとに固定。蓄積し、上限は集計時に掛ける。
        const style = def.styleKind === 'fixed' ? def.style : op.style;
        if (style && state.buffRaw[style]) {
          for (const gain of op.buffGains) {
            if (!gain || !BUFF_STATS.includes(gain.stat) || typeof gain.pct !== 'number') continue;
            state.buffRaw[style][gain.stat] += gain.pct;
            // ダメージ上昇は種別ごとにも蓄積する（種別の無い旧い記録は
            // 単体として扱う。当時の結果行は単体で固定されていた）。
            let dmgType;
            if (gain.stat === 'dmg') {
              dmgType = DMG_TYPE_ORDER.includes(gain.dmgType) ? gain.dmgType : 'single';
              state.buffDmgTypes[style][dmgType] += gain.pct;
            }
            state.buffGains.push({
              squareId: op.squareId, floor: op.floor, style, stat: gain.stat, pct: gain.pct,
              ...(dmgType ? { dmgType } : {}),
            });
          }
        }
        // 虹の追加効果（塔破力+2 等）は、箱の結果として操作に記録された分を足す。
        if (typeof op.buffPower === 'number') state.towerPower += op.buffPower;
      }
      if (def.subType === 'recovery') {
        // 記録された実際の規模（recoveryCount/Stages）があれば、それが
        // 画面に出た事実として箱＋variant の表より優先する（写し取り形の
        // フォールバックで記録された場合）。
        const spec = (typeof op.recoveryCount === 'number' && typeof op.recoveryStages === 'number')
          ? { count: op.recoveryCount, stages: op.recoveryStages }
          : recoverySpec(structure, def.recommendedPower, op.box, op.recoveryVariant || 0);
        const style = def.styleKind === 'fixed' ? def.style : op.style;
        state.recoveryPending = null;
        if (spec && style) {
          // 探索に送った本人は回復しない。対象は同じスタイルで、絶好調より悪い者。
          const memberSet = new Set(members);
          const candidates = [];
          for (const id of owned) {
            if (memberSet.has(id)) continue;
            if (styleById.get(id) !== style) continue;
            const stage = conditionOf(id);
            if (stage > STAGE_GREAT) candidates.push({ id, stage });
          }
          const plan = planRecovery(candidates, spec.count);
          for (const id of plan.auto) improve(id, spec.stages);
          if (plan.boundary) {
            const picks = (op.boundaryPicks || []).filter((id) => plan.boundary.candidates.includes(id));
            const applied = picks.slice(0, plan.boundary.need);
            for (const id of applied) improve(id, spec.stages);
            if (applied.length < plan.boundary.need) {
              state.recoveryPending = {
                squareId: op.squareId,
                style,
                stage: plan.boundary.stage,
                candidates: plan.boundary.candidates,
                need: plan.boundary.need - applied.length,
                count: spec.count,
                stages: spec.stages,
              };
            }
          }
        }
      }
      continue;
    }
    // 未知の操作は無視する（後続スライスの操作を受けられるように）。
  }

  // 疲労の集計（所持集合のうち、現在の段階が絶不調・気絶の者）。
  let veryBad = 0;
  let fainted = 0;
  for (const id of owned) {
    const stage = conditionOf(id);
    if (stage === STAGE_FAINTED) fainted += 1;
    else if (stage === STAGE_VERY_BAD) veryBad += 1;
  }
  state.fatigue = { veryBad, fainted };
  state.owned = owned;
  state.conditionOf = conditionOf;
  // 塔効果の集計（上限を掛けた後の値）。dmg（ダメージ上昇）は上限が不明なためそのまま。
  // dmgTypes はダメージ上昇の種別ごとの内訳（合計は dmg と一致する）。
  state.buffs = Object.fromEntries(STYLE_ORDER.map((s) => [s, {
    ...Object.fromEntries(
      BUFF_STATS.map((k) => [k, k in BUFF_CAPS ? Math.min(BUFF_CAPS[k], state.buffRaw[s][k]) : state.buffRaw[s][k]]),
    ),
    dmgTypes: { ...state.buffDmgTypes[s] },
  }]));
  return state;
}

// 能力上昇マスの結果の候補（箱色とステータスから、ゲームの結果としてありうる上昇幅）。
// explorationModel.buffBoxEffects の表記（"7%"、"5%+ダメージ上昇5%"、"5%+塔破力2"）を解釈する。
// 戻り値: [{label, gains: [{stat, pct}], power}]（power は塔破力の追加分。無ければ 0）
export function buffResultOptions(structure, box, stat) {
  const table = (structure.explorationModel && structure.explorationModel.buffBoxEffects) || {};
  const list = table[box] || [];
  return list.map((raw) => {
    const parts = String(raw).split('+');
    const primary = Number.parseFloat(parts[0]);
    const gains = [{ stat, pct: primary }];
    let power = 0;
    const labelParts = [`${BUFF_STAT_LABEL[stat]}+${primary}%`];
    for (const extra of parts.slice(1)) {
      const dmg = extra.match(/^ダメージ上昇(\d+)%$/);
      const pow = extra.match(/^塔破力(\d+)$/);
      if (dmg) {
        gains.push({ stat: 'dmg', pct: Number(dmg[1]) });
        labelParts.push(`ダメージ上昇+${dmg[1]}%`);
      } else if (pow) {
        power = Number(pow[1]);
        labelParts.push(`塔破力+${pow[1]}`);
      }
    }
    return { label: labelParts.join('・'), gains, power };
  });
}

// 能力上昇マスの結果の内訳（シートでの表示用）。
// そのマスへの最後の探索操作の前後で集計し直し、そのスタイルの蓄積の変化を返す。
export function buffOutcomeFor({ structure, megidoBasics, megidoDetails, ops }, squareId) {
  let idx = -1;
  ops.forEach((op, i) => {
    if (op.type === 'explore' && op.squareId === squareId) idx = i;
  });
  if (idx < 0) return null;
  const def = squareDef(structure, squareId);
  if (!def || !BUFF_SUBTYPES.has(def.subType)) return null;
  const env = { structure, megidoBasics, megidoDetails };
  const before = deriveRun({ ...env, ops: ops.slice(0, idx) });
  const after = deriveRun({ ...env, ops: ops.slice(0, idx + 1) });
  const style = def.styleKind === 'fixed' ? def.style : ops[idx].style;
  if (!style) return null;
  const capped = BUFF_STATS.filter(
    (k) => k in BUFF_CAPS && after.buffRaw[style][k] > BUFF_CAPS[k],
  );
  return {
    style,
    box: ops[idx].box,
    gains: Array.isArray(ops[idx].buffGains) ? ops[idx].buffGains : [],
    // ランダムのボーナスの事実（2026-11-19 ユーザー補正）: 記録時に
    // 明示された有無。true = 出た、false = 出なかった（確定した事実）、
    // undefined = 旧い記録で不明（「出なかった」とは言わない）。
    bonus: ops[idx].buffBonus,
    power: typeof ops[idx].buffPower === 'number' ? ops[idx].buffPower : 0,
    totalsBefore: before.buffs[style],
    totalsAfter: after.buffs[style],
    rawAfter: after.buffRaw[style],
    capped,
  };
}

// 操作履歴の整合性の検査（H2 の報告漏れ検出の枠組み）。
// 導出の規則では説明できない記録（解放されていないマスへの結果、処理済みへの重ね付け、
// 塔破力が足りない状態での結果、最終的に塔破力がマイナス）を、疑いとして返す。
// 戻り値: [{index, squareId, floor, kind, message}]
export function validateOps({ structure, megidoBasics, megidoDetails, ops }) {
  const env = { structure, megidoBasics, megidoDetails };
  const anomalies = [];
  ops.forEach((op, index) => {
    if (op.type !== 'battle' && op.type !== 'explore') return;
    const def = squareDef(structure, op.squareId);
    if (!def) return;
    const before = deriveRun({ ...env, ops: ops.slice(0, index) });
    if (before.cleared.has(op.squareId)) {
      anomalies.push({
        index, squareId: op.squareId, floor: op.floor, kind: 'duplicate',
        message: `${op.floor}F の解放済みのマスに、結果が重ねて付いています`,
      });
      return;
    }
    if (squareState(structure, before.cleared, op.squareId) === 'locked') {
      anomalies.push({
        index, squareId: op.squareId, floor: op.floor, kind: 'locked',
        message: `${op.floor}F のマスは、その時点では解放されていません（先の結果が付いていません）`,
      });
    }
    const isBoss = def.type === 'boss';
    const cost = op.type === 'explore' ? 1 : (isBoss && !before.attemptedBosses.has(op.squareId) ? 0 : 1);
    if (before.towerPower < cost) {
      anomalies.push({
        index, squareId: op.squareId, floor: op.floor, kind: 'power',
        message: `${op.floor}F のマスは、塔破力が足りない状態で結果が付いています`,
      });
    }
  });
  const final = deriveRun({ ...env, ops });
  if (final.towerPower < 0) {
    anomalies.push({
      index: ops.length, squareId: null, floor: null, kind: 'negative',
      message: '塔破力がマイナスになっています（結果の付け間違い）',
    });
  }
  return anomalies;
}

// そのマスの自分の戦績（M3 の手渡しと M10 の履歴）。
// 操作履歴のうち、そのマスへの戦闘・探索の操作を順に返す。
// battle は結果と使った編成（記録されていれば）、explore は箱色を持つ。
export function squareHistory(ops, squareId) {
  const entries = [];
  ops.forEach((op, index) => {
    if (op.squareId !== squareId) return;
    if (op.type === 'battle') {
      entries.push({
        index, kind: 'battle', floor: op.floor, result: op.result,
        formationId: op.formationId ?? null, formationName: op.formationName ?? null,
        members: op.members || [],
      });
    } else if (op.type === 'explore') {
      entries.push({
        index, kind: 'explore', floor: op.floor, box: op.box,
        members: op.members || [],
        // バフマスの記録だけが持つ、ランダムのボーナスの有無（明示分）。
        buffBonus: op.buffBonus,
      });
    }
  });
  return entries;
}

// 回復マスの結果の内訳（M9 の表示用）。
// そのマスへの最後の探索操作の前後で状態を導出し直し、
// 段階が改善した者を「回復した相手（回復前→回復後）」として返す。
// 境界の確認待ちが残っていれば pending も返す（deriveRun の recoveryPending と同じ形）。
export function recoveryOutcomeFor({ structure, megidoBasics, megidoDetails, ops }, squareId) {
  let idx = -1;
  ops.forEach((op, i) => {
    if (op.type === 'explore' && op.squareId === squareId) idx = i;
  });
  if (idx < 0) return null;
  const def = squareDef(structure, squareId);
  if (!def || def.subType !== 'recovery') return null;
  const env = { structure, megidoBasics, megidoDetails };
  const before = deriveRun({ ...env, ops: ops.slice(0, idx) });
  const after = deriveRun({ ...env, ops: ops.slice(0, idx + 1) });
  const recovered = [];
  for (const id of after.owned) {
    const from = before.conditionOf(id);
    const to = after.conditionOf(id);
    if (to < from) recovered.push({ id, from, to });
  }
  const pending = after.recoveryPending && after.recoveryPending.squareId === squareId
    ? after.recoveryPending
    : null;
  return { recovered, pending, explorers: ops[idx].members || [] };
}

// マスの導出状態: 'done'（処理済み）| 'open'（隣接が処理され開ける）| 'locked'（未解放）
// 表示ラベルの対応（2026-11-19 のユーザー補正で確定）:
//   done → 「解放済み」、open → 「解放可能」
//   locked → 「解放不可（隣接するマスを解放してください）」＋隣接マスの案内
export function squareState(structure, cleared, squareId) {
  if (cleared.has(squareId)) return 'done';
  const neighbors = structure.adjacency[squareId] || [];
  for (const n of neighbors) {
    if (cleared.has(n)) return 'open';
  }
  return 'locked';
}

// その階が「到達済み」か（閲覧専用にしないか）。
export function floorReached(derived, floor) {
  return floor <= derived.currentFloor;
}

// 未解放マスの案内（M2）: 事実より先に「どうすれば解放されるか」を出すための材料。
// 解放は「隣接マスのどれか1つを処理する」ことで起きる。案内に出すのは、
// 今すぐ処理できる隣接マス（解放可能）があればそれだけ、無ければ解放不可の
// 隣接マス（そちらが先に解放される必要がある連鎖側）。
// あわせて、そのマスがボスへの最短路の途中にあるか（寄り道側か）を、
// 開始マスとボスからの距離で判定する。
// 戻り値: { steps: [{id, state, def}], onBossPath: true|false|null, isBoss }
export function unlockGuidance(structure, cleared, squareId) {
  const def = squareDef(structure, squareId);
  if (!def) return { steps: [], onBossPath: null, isBoss: false };
  const floor = def.floor;
  const fd = floorData(structure, floor);
  const neighbors = (structure.adjacency[squareId] || [])
    .filter((id) => fd && fd.squares[id])
    .map((id) => ({ id, state: squareState(structure, cleared, id), def: fd.squares[id] }))
    .filter((n) => n.state !== 'done');
  const openSteps = neighbors.filter((n) => n.state === 'open');
  const steps = openSteps.length > 0 ? openSteps : neighbors;

  // 同じ階の中だけで開始マスとボスへの距離を測る。
  let onBossPath = null;
  let isBoss = def.type === 'boss';
  if (fd) {
    const ids = Object.keys(fd.squares);
    const startId = ids.find((id) => fd.squares[id].type === 'start');
    const bossId = ids.find((id) => fd.squares[id].type === 'boss');
    if (startId && bossId) {
      const distFrom = (from) => {
        const dist = new Map([[from, 0]]);
        const queue = [from];
        while (queue.length > 0) {
          const cur = queue.shift();
          for (const n of structure.adjacency[cur] || []) {
            if (!fd.squares[n] || dist.has(n)) continue;
            dist.set(n, dist.get(cur) + 1);
            queue.push(n);
          }
        }
        return dist;
      };
      const fromStart = distFrom(startId);
      const fromBoss = distFrom(bossId);
      const total = fromStart.get(bossId);
      if (total != null && fromStart.has(squareId) && fromBoss.has(squareId)) {
        onBossPath = fromStart.get(squareId) + fromBoss.get(squareId) === total;
      }
    }
  }
  return { steps, onBossPath, isBoss };
}

// この階の回復配置（帯の表示用）: 回復マスの一覧。
export function floorRecoveryLayout(structure, floor) {
  const fd = floorData(structure, floor);
  if (!fd) return [];
  const list = [];
  for (const [id, def] of Object.entries(fd.squares)) {
    if (def.type === 'explore' && def.subType === 'recovery') {
      list.push({
        squareId: id,
        style: def.style,
        styleKind: def.styleKind,
        recommendedPower: def.recommendedPower,
      });
    }
  }
  return list;
}

// スタイル別の次の回復（帯の表示用）。
// fromFloor 以降で、そのスタイルの回復マスが残っている最初の階・残り回数・次が最後か。
// 現在の階については処理済みのマスを数えない。先の階は未処理として数える。
export function nextRecoveries(structure, cleared, fromFloor) {
  const result = [];
  const kinds = [
    ...STYLE_ORDER.map((s) => ({ key: s, label: STYLE_NAME[s], match: (def) => def.styleKind === 'fixed' && def.style === s })),
    { key: 'RANDOM', label: 'ランダム', match: (def) => def.styleKind === 'random' },
  ];
  for (const kind of kinds) {
    let nextFloor = null;
    let remaining = 0;
    for (let f = fromFloor; f <= LAST_FLOOR; f += 1) {
      const fd = floorData(structure, f);
      if (!fd) continue;
      for (const [id, def] of Object.entries(fd.squares)) {
        if (def.type !== 'explore' || def.subType !== 'recovery') continue;
        if (!kind.match(def)) continue;
        if (f === fromFloor && cleared.has(id)) continue;
        remaining += 1;
        if (nextFloor === null) nextFloor = f;
      }
    }
    if (nextFloor !== null) {
      result.push({ style: kind.key, label: kind.label, nextFloor, remaining, isLast: remaining === 1 });
    }
  }
  return result;
}

// 次の塔破力マス（事実の提示用）: 現在の階以降で、未回収の塔破力マスがある最初の階。
export function nextTowerPowerSquare(structure, cleared, fromFloor) {
  for (let f = fromFloor; f <= LAST_FLOOR; f += 1) {
    const fd = floorData(structure, f);
    if (!fd) continue;
    for (const [id, def] of Object.entries(fd.squares)) {
      if (def.type === 'explore' && def.subType === 'tower_power' && !cleared.has(id)) {
        return { floor: f, squareId: id };
      }
    }
  }
  return null;
}

// 塔破力の見通し（ペース方式。research/tower-power-verification.md の確定条件に従う）。
// - 戦績（踏破した階）が PACE_MIN_CLEARED_FLOORS 未満なら判定を出さず、事実だけを返す。
// - 回復の先読みは行動一致に限る: 塔破力マスを回収した実績がある場合だけ、
//   この先の塔破力マスの期待回復（赤）を収入に数える。
// - ペースは踏破した階の消費合計 ÷ 階数。×PACE_MARGIN の余裕を掛ける。
export function towerOutlook(structure, derived) {
  const facts = {
    currentPower: derived.towerPower,
    nextTower: nextTowerPowerSquare(structure, derived.cleared, derived.currentFloor),
    shortestPathHasTowerSquare: false, // 事実: 最短路上に塔破力マスは無い（検証 第1部）
  };
  const clearedCount = derived.clearedFloors.size;
  if (clearedCount < PACE_MIN_CLEARED_FLOORS) {
    // 判定材料が無い間は、予測リタイア許容数も出さない（フッターでは ― ）。
    return { mode: 'facts', ...facts, clearedFloors: clearedCount, allowance: null };
  }
  let spent = 0;
  for (const f of derived.clearedFloors) spent += derived.consumptionByFloor.get(f) || 0;
  const pace = spent / clearedCount;
  const pacedCost = pace * PACE_MARGIN;
  let balance = derived.towerPower;
  let minBalance = balance;
  let runOutFloor = null;
  for (let f = derived.currentFloor; f <= LAST_FLOOR; f += 1) {
    let recovery = 0;
    if (derived.towerCollected) {
      const fd = floorData(structure, f);
      if (fd) {
        for (const def of Object.values(fd.squares)) {
          if (def.type === 'explore' && def.subType === 'tower_power') {
            recovery += towerPowerExpected(structure, def.recommendedPower);
          }
        }
      }
    }
    balance += recovery - pacedCost;
    if (balance < minBalance) minBalance = balance;
    if (balance < 0) {
      runOutFloor = f;
      break;
    }
  }
  return {
    mode: 'pace',
    ...facts,
    clearedFloors: clearedCount,
    pace,
    verdict: runOutFloor === null ? 'enough' : 'short',
    runOutFloor,
    // 予測リタイア許容数: 同じ見通しの試算で、残りの階のどこでも残量が
    // 最も細る時点の残量（切り捨て）。追加のリタイア（塔破力1の追加消費）
    // をその回数までなら吸収できる、という現行ツールの値の意味論を、
    // ペース方式の試算の上に置き直したもの。不足の見通しでは 0。
    allowance: runOutFloor === null ? Math.max(0, Math.floor(minBalance)) : 0,
  };
}

// スタイル別使用数（フッターの常駐表示。現行ツールの粒度の引き継ぎ）:
// 分子は「段階の下がった所持者」の数（使った人数）、分母はそのスタイルの
// 次の回復マスの回復量（体数。規模は標準の効果＝赤で読む）。回復マスが
// もう残っていないスタイルは分母なし（capacity: null）。
export function styleUsage(structure, derived, megidoBasics) {
  const styleById = new Map(megidoBasics.megido.map((m) => [m.id, STYLE_CODE[m.style]]));
  return STYLE_ORDER.map((style) => {
    let used = 0;
    for (const id of derived.owned) {
      if (styleById.get(id) === style && derived.conditionOf(id) > STAGE_GREAT) used += 1;
    }
    let capacity = null;
    for (let f = derived.currentFloor; f <= LAST_FLOOR && capacity === null; f += 1) {
      const fd = floorData(structure, f);
      if (!fd) continue;
      for (const [id, def] of Object.entries(fd.squares)) {
        if (def.type !== 'explore' || def.subType !== 'recovery') continue;
        if (def.styleKind !== 'fixed' || def.style !== style) continue;
        if (f === derived.currentFloor && derived.cleared.has(id)) continue;
        const spec = recoverySpec(structure, def.recommendedPower, '赤');
        if (spec) { capacity = spec.count; break; }
      }
    }
    return { style, label: STYLE_NAME[style], used, capacity };
  });
}

// 次に処理できるマス（マップの点滅用。棚卸し 2-3 の現行挙動の引き継ぎ）:
// 解放可能で未処理のマスのうち、開始マスからボスへの最短路上にあるものを
// 優先し、その中で開始マスに最も近いもの。最短路上に候補が無ければ、
// 開始マスに最も近い解放可能なマス。候補が無ければ null。
export function nextSquareId(structure, cleared, floor) {
  const fd = floorData(structure, floor);
  if (!fd) return null;
  const ids = Object.keys(fd.squares);
  const startId = ids.find((id) => fd.squares[id].type === 'start');
  const bossId = ids.find((id) => fd.squares[id].type === 'boss');
  if (!startId) return null;
  const distFrom = (from) => {
    const dist = new Map([[from, 0]]);
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const n of structure.adjacency[cur] || []) {
        if (!fd.squares[n] || dist.has(n)) continue;
        dist.set(n, dist.get(cur) + 1);
        queue.push(n);
      }
    }
    return dist;
  };
  const fromStart = distFrom(startId);
  const fromBoss = bossId ? distFrom(bossId) : new Map();
  const total = bossId ? fromStart.get(bossId) : null;
  const candidates = ids.filter((id) => fd.squares[id].type !== 'start'
    && squareState(structure, cleared, id) === 'open');
  if (candidates.length === 0) return null;
  const rank = (id) => (fromStart.has(id) ? fromStart.get(id) : Number.MAX_SAFE_INTEGER);
  const sorted = [...candidates].sort((a, b) => (rank(a) - rank(b)) || (a < b ? -1 : 1));
  const onPath = sorted.find((id) => total != null && fromStart.has(id) && fromBoss.has(id)
    && fromStart.get(id) + fromBoss.get(id) === total);
  return onPath || sorted[0];
}
