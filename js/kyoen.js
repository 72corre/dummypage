// 狂炎シミュレーターの計算エンジン（2026-11-19 実装フライト。
// 2026-11-20 地形の実体化で作り替え）。
// 「狂炎を付けた時点」の状態を再現し、編成の実際の行動で火ダメージ
// 回数を積み、ターン終了で地形ダメージを精算する。目的は「今の
// 伸び方で、あと何ターンで全員倒せるか」を出すこと。乱数は平均
// （1倍）で固定する（ユーザーの確定事項）。
//
// 正本（corpus-elements/狂炎.json、Wiki 由来の推定式）:
//   地形ダメージ = （炎上発生者の攻撃力 ＋ 狂炎付与者Lv×10×火ダメージ回数）
//                  × 地形倍率 × 地形ダメージ補正
// - 地形倍率は元の炎上のものが引き継がれる（どの炎上を敷くかで決まる）。
// - 狂炎では地形ダメージ補正に +100%（補正 = 1 + 1 + 発生者が ME 等で
//   持つ地形ダメージ補正。補正の ME 分は VM 側で合算して渡す）。
// - 火ダメージ回数の上昇は累計50回が上限。
// - 効果ターンの延長は1ターンに3回まで。狂炎にした瞬間は延長されない。
//   ただし延長は2系統あり、この上限は「炎ダメージによる延長」だけの
//   もの。「地形の延長」効果（フィロタヌスの専用霊宝つき奥義の
//   extend）は別処理で上限の枠外（2026-11-20 ユーザー確定）。
// - 狂炎自体のダメージは火ダメージ回数に数えない。
// - 飛行の敵には地形が効かない（対象に含めない）。撃墜（モレクの
//   覚醒スキル）で落としている間だけ、地形の範囲内なら対象になる。
// - 地形効果を無効化する特性を持つ敵も地形の対象にならない（飛行と
//   同じ土台。VM が特性文の現在の形の部分から判定し、terrainNull で
//   渡す）。
// - 戦闘不能時に蘇生する敵（2026-11-21）: 敵が revive（VM が特性文
//   から導いた { times, hpPct, shift }）を持つ場合、戦闘不能に
//   なっても蘇生回数が残っていれば hpPct 分の HP で蘇生し、シフトが
//   あれば形が移る。シフト後の形では、その形の地形無効化・列無効化
//   （攻撃側の列はクラスで決まる）・被ダメージの扱いに切り替わる。
//   前列/後列からのダメージ無効化と「受ける単体/範囲ダメージが
//   N%上昇」は、シフト前の形でもここで判定する。列の無効化で
//   ダメージが0になった火も、地形の火ダメージ回数には数える
//   （2026-11-21 ユーザー裁定。ダメージだけが0になる）。
//   35Fの3体のシフト後のHP依存の軽減は直線で確定したため
//   （2026-11-21 ユーザー裁定: 軽減率 = 最大70% × 現在HP/最大HP）、
//   shift.reductionMax として計算に入れる。それ以外の数値化
//   できない被ダメージ（shift.unknownDamage。グジグランズの
//   覚醒ゲージ条件の軽減）は計算に入れず、見通しはその敵に
//   ついてシフトする時点で止める。
// - 上書き（2026-11-19 ユーザー仕様）: 狂炎に炎上が再設置された時、
//   (a) 後からの範囲が大きい（全体＞列＞単体）か、(b) 範囲が同じで
//   後からの倍率が高い場合に「範囲・地形倍率・持続ターン」の3つ
//   だけが差し替わる。狂炎であることと地形の火回数（狂炎レベル）
//   は引き継がれ、発生者の攻撃力は上書きされない。再設置の行動
//   自体のダメージは火回数に数えない。
// - リザーブ（フルーレティBのスキル）: 使用すると予約として積み、
//   ターン終了時処理の後の方（地形ダメージの精算と持続の減少・
//   消滅判定より後）で自動発動する。地形が消滅した後なら、その
//   火は回数にも延長にも入らない（2026-11-20 ユーザー確定）。
// - レベル制の行動（使うたびにレベルが上がる）: 索引に levels を
//   持つ行動は、シミュレーター内のどこで使っても（準備フェーズの
//   地形決定でも、開始後の敷き直し・火行動でも）使用のたびに
//   その行動のレベルが上がり（上限は最大 Lv）、数値は現在 Lv の
//   ものを使う。レベルは sim の状態（levels）に持ち、ターン
//   巻き戻しでは精算前のスナップショットの値に戻る。対象は索引の
//   4件だけ: フィロタヌスの覚醒スキル「対岸の火事＋」（炎上。
//   地形倍率が Lv1 1.25 / Lv2 1.5 / Lv3 1.75 と上がるため、敷き
//   直しが上書き条件 (b)「同範囲で倍率が高い」を満たすようになる）、
//   カイムBの覚醒スキル「インフェルノ＋」（炎上。地形倍率は全 Lv
//   共通で、Lv で変わるのはランダム反復回数の範囲だけ。その範囲
//   は allocMin / allocMax として levels にも載り、使う時に
//   使う人が敵ごとに割り振る（割り振りは VM 側。エンジンは
//   敵ごとのヒット数で受ける））、アイムのスキル「強火クッキング＋」（火。倍率が Lv で
//   上がり、専用霊宝版の Lv4 は地形のある対象への terrainBonus
//   を持つ）。見通し（forecast）は今のターンの伸び方を繰り返す
//   前提のため、レベル進行は投影しない（タップ時点のレベルの
//   伸び方で繰り返す）。
// - 武器の形のシフト（タムス）: 索引に form を持つ行動は、行動者
//   の現在の形（'separated' 分離武器時 / 'linked' 連結武器時）に
//   合うものだけが使える。初期の形は分離。shiftTo を持つ行動を
//   使うと、その行動者の形が shiftTo の形に移る: 分離時の奥義
//   「焦熱リーサルフレア」は使うと連結になり、連結時の覚醒
//   スキル「フルブラストフレイム」は使うと分離に戻る（どちらも
//   コーパスの文面どおり）。連結時の奥義は炎上を付与するが
//   シフトしない。狂炎化の「熱狂フューエル！」は分離時の形に
//   しか無いため、連結中は狂炎化できない。形は sim の状態
//   （forms）に行動者ごとに持ち、ターン巻き戻しでは精算前の
//   スナップショットの値に戻る。準備フェーズで形を移す行動を
//   地形決定に使った場合も、使用として形が移った状態で開始
//   する（レベル制の「地形決定の使用も数える」と同じ扱い）。
// - 遅延行動（ナベリウスBの覚醒スキル「エクステンドカラー」）:
//   正本（corpus-status/遅延行動.json と能力原文）どおり、発動は
//   「1ターン後」＝次のターンの行動開始時。反復回数は直前ターン
//   （予約したターン）の火ダメージ回数で決まる: 2回以上ならその
//   回数分（最大10回）、0〜1回なら1回。数える範囲は通常版が
//   自身の火、専用霊宝版は味方全員の火。実装ではターン終了処理
//   の最後に、反復回数を確定させてからターンの数えをリセットし、
//   新しいターンの最初の出来事として発動させる（地形の精算と
//   リザーブは予約ターンの側で終わっている）。この置き方では、
//   発動の火による延長は新しいターンの炎ダメージ延長の枠を
//   使い、発動自体は火回数の数え（turnFireByActor）に入らない
//   （自動発動を数えない従来の扱いと同じ）。対象は予約した
//   時点の相手のまま（対象が戦闘不能なら発動しない）。予約は
//   ターン巻き戻しで精算前の状態に戻る。SW56 の圧縮（予約
//   ターンの終了時に発動し、そのターンの火を数える）は
//   2026-11-20 の確定でこの形に置き換えた。
// - スキルのシフト（バティンB）: 覚醒スキル「ウォームアップ」を
//   使うとスキルがシフトし、シフト後のスキルは火ではなくなる
//   （原文にシフトのまま使う形と戻り方の記載は無い）。状態は
//   sim の shifted（行動者ごと）に持ち、巻き戻しで戻る。
//   切り替えの操作は VM 側（覚醒スキルの引き金チップ）。
// - 反撃の火（フェニックスCの覚醒スキル）: 即時の火ではなく、
//   攻撃を受けた相手への反撃。VM 側で相手を選んで単体の火行動
//   として適用する（エンジン側は通常の火行動と区別しない）。
// 直接ダメージは corpus-status/ダメージ計算.json の式で再現する:
//   基礎 = 攻撃力×技倍率 − 敵防御、補正後はクラス補正のみを掛け、
//   乱数は1（平均）。基礎・補正後が1未満なら原則1ダメージ。
// 数え方の解釈（2026-11-20 ユーザー確定で作り替え。正本
// corpus-elements/狂炎.json の notes が確定記録）:
// - 地形は範囲で1つの実体として管理する。火ダメージ回数・持続・
//   延長の使用数は地形が持ち、敵は「その地形の対象かどうか」
//   だけを持つ。全体・列の地形では回数は範囲内で共有され、地形
//   ダメージは範囲内の全員に同じ値になる。単体地形はその対象
//   だけの地形になる。旧解釈（敵ごとに回数を数え、敵ごとに
//   ダメージが変わる）は誤りのため廃止した。敵ごとの count /
//   remaining は表示互換のための鏡（対象なら地形の値、対象外
//   なら0）で、実体は常に地形側にある。
// - 火行動で範囲内の誰かが火ダメージを受けたら、その地形の回数
//   が行動のヒット数ぶん伸びる。範囲攻撃で複数体に同時に当たっ
//   ても、地形ごとに1回として扱う（対象の数では増えない）。
//   割り振り対象の行動は VM が敵ごとに単体で当てるため、地形
//   の回数は割り振られた合計ぶん伸びる。
// - かばうによる回数の付け替えは再現しない（敵のかばう自体を
//   シミュレーターが再現していないため。行動は対象を直接選ぶ）。

export const CONVERTER_LEVEL = 70; // 狂炎付与者Lvは星6・Lv70を基準にする（Hボムの付与者Lvと同じ）
export const COUNT_CAP = 50;
export const EXTEND_PER_TURN = 3;
export const KYOEN_CORRECTION = 2; // 地形ダメージ補正: 基礎1 + 狂炎の+100%
const FORECAST_MAX_TURNS = 60;

// 地形ダメージ（1回の精算分）。回数は上限50で止める。
export function terrainDamage({ applierAtk, converterLv = CONVERTER_LEVEL, count, mult, correction }) {
  const c = Math.max(0, Math.min(count, COUNT_CAP));
  return Math.floor((applierAtk + converterLv * 10 * c) * mult * correction);
}

// クラス補正（位置に対してかかる。ダメージ計算の正本どおり）。
export function classFactor(attackerClass, targetRow) {
  if (attackerClass === 'ファイター') return targetRow === 'front' ? 1.25 : 1;
  if (attackerClass === 'トルーパー') return targetRow === 'back' ? 1.5 : 1;
  if (attackerClass === 'スナイパー') return targetRow === 'front' ? 1.25 : 1;
  return 1;
}

// 直接ダメージ（1ヒット分）。terrainBonus は地形が存在する対象への
// 特効（ベリアルB奥義など）で、対象が地形の上にある時だけ掛かる。
export function directHitDamage({ atk, mult, def, attackerClass, targetRow, terrainBonus = 1 }) {
  const base = atk * mult - (typeof def === 'number' ? def : 0);
  const dmg = Math.floor(base * classFactor(attackerClass, targetRow) * terrainBonus);
  return Math.max(1, dmg);
}

// 敵の現在の形での被ダメージの修飾（列の無効化と被ダメージ上昇）。
// props は { nullRow, takenUpSingle, takenUpRange } を持つ対象（敵の
// 状態そのもの、または見通し側の形の写し）:
// - 攻撃側の列（クラスで決まる）が nullRow と一致する攻撃は 0。
// - 「受ける単体ダメージがN%上昇」は range が single の時、
//   「受ける範囲ダメージがN%上昇」はそれ以外の時に倍率が掛かる
//   （VM が特性文から倍率にして渡す。200%上昇 = 3倍）。
// 地形ダメージには列も単体/範囲の区別も無いので通らない。
export function directDamageAgainst(props, dmg, attackerClass, range) {
  if (!(dmg > 0)) return 0;
  if (props.nullRow && attackerClass && rowOfClass(attackerClass) === props.nullRow) return 0;
  const up = range === 'single' ? props.takenUpSingle : props.takenUpRange;
  return Math.floor(dmg * (up || 1));
}

// HP依存のダメージ軽減（シフト後の形。2026-11-21 ユーザー裁定で
// 直線に確定: 軽減率 = reductionMax × 現在HP/最大HP。HP100%で
// 最大、HP0%で0）。props は reductionMax を持つ対象（敵の状態
// そのもの、または見通し側の形の写し）。ダメージを受ける時点の
// HP割合で軽減し、小数点以下は切り捨てる（他の計算と同じ作法）。
export function hpScaledReduction(props, hpNow, maxHp, dmg) {
  if (!(dmg > 0) || !props || !(props.reductionMax > 0) || !(maxHp > 0)) return dmg;
  const rate = props.reductionMax * Math.max(0, hpNow) / maxHp;
  return Math.floor(dmg * (1 - rate));
}

// 戦闘不能の処理: 蘇生が残っていれば蘇生し（シフトがあれば形が
// 移り、その形の地形無効化・列無効化・被ダメージの扱いに切り
// 替わる）、無ければ戦闘不能にする。戻り値: 'revived' | 'died'。
function incapacitate(state, e) {
  const spec = e.reviveSpec;
  if (spec && e.revivesLeft > 0) {
    e.revivesLeft -= 1;
    e.reviveCount = (e.reviveCount || 0) + 1;
    e.lastReviveTurn = state.turn;
    e.hpNow = Math.max(1, Math.floor(e.maxHp * spec.hpPct / 100));
    let shifted = false;
    if (spec.shift && e.form === 0) {
      e.form = 1;
      shifted = true;
      e.terrainNull = Boolean(spec.shift.terrainNull);
      e.nullRow = spec.shift.nullRow || null;
      e.takenUpSingle = 1;
      e.takenUpRange = 1;
      e.reductionMax = spec.shift.reductionMax || 0;
      e.unknownDamage = Boolean(spec.shift.unknownDamage);
      if (e.terrainNull) e.covered = false;
      else if (e.inRange && state.terrain && state.terrain.remaining > 0
        && (!e.flying || e.shot > 0)) e.covered = true;
    }
    state.lastRevive = { name: e.name, shifted, turn: state.turn };
    return 'revived';
  }
  e.dead = true;
  e.killTurn = state.turn;
  return 'died';
}

// ダメージを実際に受ける（戦闘不能になれば蘇生の処理まで）。
// 全てのダメージ経路（火行動・準備・撃墜・地形の精算・リザーブ・
// 遅延）はこの受け口を通る。シフト後のHP依存の軽減は、受ける
// 時点のHP割合でここで適用する（火ダメージ・地形ダメージとも）。
// 戻り値: 'revived' | 'died' | 'none'。
function settleDamage(state, e, dmg) {
  if (!(dmg > 0)) return 'none';
  const d = hpScaledReduction(e, e.hpNow, e.maxHp, dmg);
  if (!(d > 0)) return 'none';
  e.hpNow = Math.max(0, e.hpNow - d);
  if (e.hpNow > 0) return 'none';
  return incapacitate(state, e);
}

// 列の決まり（Hボムと同じ）: スナイパーは後列、それ以外は前列。
// 攻撃側の列もこの決まりで決まる。
export function rowOfClass(cls) {
  return cls === 'スナイパー' ? 'back' : 'front';
}

// 敵の列: 明示があればそれ、無ければクラスで決まる。
// 行動範囲の「横一列」とクラス補正の位置はこれで決まる。
export function rowOfEnemy(e) {
  if (e && (e.row === 'front' || e.row === 'back')) return e.row;
  return rowOfClass(e && e.cls);
}

// 行動の届く敵（生存している敵だけ）。range: single | row | all
export function resolveTargets(enemies, range, targetIdx) {
  const alive = (i) => enemies[i] && !enemies[i].dead;
  if (range === 'all') return enemies.map((_, i) => i).filter(alive);
  if (range === 'row') {
    if (!alive(targetIdx)) return [];
    const row = rowOfEnemy(enemies[targetIdx]);
    return enemies.map((_, i) => i).filter((i) => alive(i) && rowOfEnemy(enemies[i]) === row);
  }
  return alive(targetIdx) ? [targetIdx] : [];
}

// 敵ごとの count / remaining は地形の値の鏡（表示・テスト互換の
// ため）。対象の敵には地形の回数・残りを写し、対象外は0にする。
// 地形自体の残り（terrainClock）も地形の残りに合わせる。
function syncMirrors(state) {
  const t = state.terrain;
  if (!t) return;
  state.terrainClock = t.remaining;
  for (const e of state.enemies) {
    if (e.covered) {
      e.count = t.count;
      e.remaining = t.remaining;
    } else {
      e.count = 0;
      e.remaining = 0;
    }
  }
}

// 地形の回数と持続を伸ばす。炎ダメージによる延長は1ターン3回
// まで（地形ごとに数える）、「地形の延長」効果（extend）は上限
// の枠外。pace の時は見通しの材料（地形の伸び方）にも積む。
function growTerrain(state, hits, extend, pace) {
  const t = state.terrain;
  if (!t || t.remaining <= 0) return;
  t.count = Math.min(COUNT_CAP, t.count + hits);
  const add = Math.min(hits, Math.max(0, EXTEND_PER_TURN - t.extUsed));
  t.remaining += add;
  t.extUsed += add;
  if (extend > 0) t.remaining += extend;
  if (pace) {
    state.turnTerrainPace = state.turnTerrainPace || { hits: 0, extend: 0 };
    state.turnTerrainPace.hits += hits;
    state.turnTerrainPace.extend += extend || 0;
  }
}

// 地形の持続を「地形の延長」効果で伸ばす（上限の枠外。狂炎化の
// 行動に付く延長は、準備フェーズで VM から呼ばれる）。
export function extendTerrain(state, turns) {
  const t = state.terrain;
  if (!t || !(turns > 0)) return;
  t.remaining += turns;
  syncMirrors(state);
}

// シミュレーションの初期状態を作る。
// enemies: [{ name, hp, def, cls, slot, flying, terrainNull,
//   revive, nullRow, takenUpSingle, takenUpRange }]
//   terrainNull は地形効果を無効化する特性を持つ敵（地形の対象に
//   ならない。飛行と同じ扱い）。revive は戦闘不能時の蘇生
//   （{ times, hpPct, shift }。VM が特性文から導く）。nullRow /
//   takenUpSingle / takenUpRange は現在の形の列無効化と被ダメージ
//   上昇の倍率（revive の同名フィールドの写し）。
// terrain: { mult, applierAtk, converterLv, correction, duration, range }
//   地形はこの1つが実体で、回数・持続・延長の使用数はここに持つ。
// covered: [bool]（炎上の範囲に入り、飛行でも無効化でもない敵）
// inRange: [bool]（飛行・無効化を除く前の、範囲だけでの入り。
// 撃墜で落とした敵が地形の対象になるかの判定に使う。省略時は
// covered と同じ）
export function createSim({ enemies, terrain, covered, inRange }) {
  const rangeSet = inRange || covered;
  const t = {
    ...terrain,
    count: 0,
    remaining: terrain.duration,
    extUsed: 0,
  };
  const state = {
    turn: 1,
    terrain: t,
    // 地形自体の残り（地形の残りの鏡。撃墜で後から対象に入る敵
    // の持続も地形の残りに合わせる）。
    terrainClock: t.remaining,
    enemies: enemies.map((e, i) => ({
      ...e,
      maxHp: e.hp,
      hpNow: e.hp,
      terrainNull: Boolean(e.terrainNull),
      covered: Boolean(covered[i]) && !e.flying && !e.terrainNull,
      inRange: Boolean(rangeSet[i]),
      count: 0,
      remaining: 0,
      shot: 0, // 撃墜の残りターン（0 = 撃墜されていない）
      dead: false,
      killTurn: null,
      // 蘇生とシフト（現在の形の状態。シフトで書き換わる）。
      reviveSpec: e.revive || null,
      revivesLeft: e.revive ? e.revive.times : 0,
      reviveCount: 0,
      lastReviveTurn: null,
      form: 0,
      nullRow: e.nullRow || null,
      takenUpSingle: e.takenUpSingle || 1,
      takenUpRange: e.takenUpRange || 1,
      reductionMax: 0,
      unknownDamage: false,
    })),
    history: [],
    reserves: [],
    levels: {}, // レベル制の行動の現在レベル（levelKey -> Lv。未使用は Lv1）
    forms: {}, // 武器の形（actorId -> 'separated' | 'linked'。未使用は分離）
    shifted: {}, // スキルのシフト（actorId -> true。バティンB）
    delayed: null, // 遅延行動の予約（armDelayed で積む）
    delayedReport: null, // 直近のターン終了で発動した遅延行動（表示用の一時情報）
    lastRevive: null, // 直近に起きた蘇生（表示用の一時情報。スナップショットには入れない）
    turnFireByActor: {}, // このターンに各行動者が与えた火ダメージ回数
    turnPace: enemies.map(() => ({ hits: 0, direct: 0, extend: 0 })),
    lastPace: null,
    turnTerrainPace: { hits: 0, extend: 0 }, // このターンの地形の伸び方（見通しの材料）
    lastTerrainPace: null,
  };
  syncMirrors(state);
  return state;
}

function snapshot(state) {
  return JSON.parse(JSON.stringify({
    turn: state.turn,
    terrain: state.terrain,
    terrainClock: state.terrainClock,
    enemies: state.enemies,
    reserves: state.reserves,
    levels: state.levels || {},
    forms: state.forms || {},
    shifted: state.shifted || {},
    delayed: state.delayed || null,
    turnFireByActor: state.turnFireByActor || {},
    turnPace: state.turnPace,
    lastPace: state.lastPace,
    turnTerrainPace: state.turnTerrainPace || { hits: 0, extend: 0 },
    lastTerrainPace: state.lastTerrainPace || null,
  }));
}

// レベル制の行動（索引に levels を持つもの）の現在レベル。
// levelKey は呼び出し側が決める行動の識別子（VM では選択肢の uid）。
export function actionLevel(state, levelKey) {
  if (!levelKey) return 1;
  return (state.levels && state.levels[levelKey]) || 1;
}

// 行動を指定レベルの数値で解決したものを返す（純粋・状態を
// 変えない）。levels を持たない行動はそのまま返す。指定が最大 Lv
// を超えたら最大 Lv の数値になる。
const LEVEL_RESOLVE_FIELDS = ['mult', 'duration', 'dmgMult', 'dmgHits', 'hits', 'terrainBonus', 'turns', 'allocMin', 'allocMax'];
export function leveledAction(action, lv) {
  if (!action || !Array.isArray(action.levels) || !action.levels.length) return action;
  const sorted = [...action.levels].sort((a, b) => a.lv - b.lv);
  const entry = sorted.filter((e) => e.lv <= lv).pop() || sorted[0];
  const out = { ...action };
  delete out.levels;
  for (const f of LEVEL_RESOLVE_FIELDS) {
    if (entry[f] !== undefined) out[f] = entry[f];
  }
  out.lv = entry.lv;
  return out;
}

// レベルを1つ上げる（上限は maxLv）。使用の記録だけを行う
// （準備フェーズで地形が決まった時点の使用はこちらで数える）。
export function bumpLevel(state, levelKey, maxLv) {
  if (!levelKey || !maxLv) return;
  state.levels = state.levels || {};
  state.levels[levelKey] = Math.min(maxLv, actionLevel(state, levelKey) + 1);
}

// レベル制の行動を1回使う: 現在レベルの数値で解決して返し、
// レベルを上げる。action.levelKey が必要。levels を持たない
// 行動はそのまま返す（レベルも動かない）。
export function useLeveledAction(state, action) {
  if (!action || !Array.isArray(action.levels) || !action.levels.length || !action.levelKey) {
    return action;
  }
  const resolved = leveledAction(action, actionLevel(state, action.levelKey));
  bumpLevel(state, action.levelKey, Math.max(...action.levels.map((e) => e.lv)));
  return resolved;
}

// 武器の形（タムス）の現在形。持っていない行動者は初期の形
// （分離武器時 'separated'）。
export function formOf(state, actorId) {
  if (!actorId) return 'separated';
  return (state.forms && state.forms[actorId]) || 'separated';
}

// 武器の形を移す（shiftTo を持つ行動を使った時に呼ぶ）。
export function applyShift(state, actorId, to) {
  if (!actorId || (to !== 'separated' && to !== 'linked')) return;
  state.forms = state.forms || {};
  state.forms[actorId] = to;
}

// スキルのシフト（バティンB）: その行動者のスキルがシフト後の
// 形（火ではない）になっているか。
export function skillShifted(state, actorId) {
  if (!actorId) return false;
  return Boolean(state.shifted && state.shifted[actorId]);
}

// スキルをシフトさせる（覚醒スキルの引き金を使った時に呼ぶ）。
// 戻す手段は原文に無いため、シフトは一方通行。
export function applySkillShift(state, actorId) {
  if (!actorId) return;
  state.shifted = state.shifted || {};
  state.shifted[actorId] = true;
}

// 火行動を1回使う。対象に直接ダメージを与え、地形の対象の誰かが
// 火を受けたら、その地形の回数と持続が伸びる（延長は地形ごとに
// 1ターン3回まで）。行動に extend（「地形の延長」効果）があれば、
// 地形の持続へ上限の枠外で加算する。
// opts.pace=false の時は見通しの材料（turnPace）に数えない
// （リザーブの自動発動用）。
// action.actorId があれば、その行動者がこのターンに与えた火
// ダメージ回数として対象ごとに数える（遅延行動の反復回数の
// 材料。数えるのはプレイヤーがタップした行動だけで、リザーブや
// 遅延行動自身の自動発動は pace=false のため数えない）。
// 戻り値: 対象ごとの { direct, hits }（hits はその対象が受けた
// 火の回数。地形の回数は別に地形側で数える）
export function applyFireAction(state, action, targetIdx, opts = {}) {
  const pace = opts.pace !== false;
  const targets = resolveTargets(state.enemies, action.range, targetIdx);
  const out = [];
  let terrainTouched = false;
  for (const i of targets) {
    const e = state.enemies[i];
    if (pace && action.actorId && action.hits > 0) {
      state.turnFireByActor = state.turnFireByActor || {};
      state.turnFireByActor[action.actorId] = (state.turnFireByActor[action.actorId] || 0) + action.hits;
    }
    const raw = action.dmgMult > 0
      ? directHitDamage({
        atk: action.atk, mult: action.dmgMult, def: e.def,
        attackerClass: action.attackerClass, targetRow: rowOfEnemy(e),
        terrainBonus: e.covered && action.terrainBonus ? action.terrainBonus : 1,
      }) * action.hits
      : 0;
    // 現在の形の被ダメージの修飾（列の無効化・被ダメージ上昇）を
    // 通す。列で無効化された火はダメージだけが0になり、地形の
    // 回数には通常どおり入る（2026-11-21 ユーザー裁定）。
    const per = raw > 0 ? directDamageAgainst(e, raw, action.attackerClass, action.range) : 0;
    if (per > 0) {
      if (pace) state.turnPace[i].direct += per;
      settleDamage(state, e, per);
    }
    let hits = 0;
    if (e.covered && !e.dead) {
      hits = action.hits;
      terrainTouched = true;
      if (pace) state.turnPace[i].hits += hits;
    }
    out.push({ index: i, direct: per, hits });
  }
  // 地形は範囲で1つ: 対象の誰かが火を受けたら、地形の回数が
  // 行動のヒット数ぶん伸びる。範囲攻撃で複数体に同時に当たって
  // も、地形ごとに1回として扱う（対象の数では増えない）。
  if (terrainTouched) growTerrain(state, action.hits, action.extend || 0, pace);
  syncMirrors(state);
  return out;
}

// 準備フェーズの行動（炎上の付与・狂炎化）のダメージだけを適用する。
// 地形が付く前・狂炎になる前のダメージなので、火ダメージ回数には
// 数えない（狂炎にした瞬間は延長もされない）。
export function applySetupAction(state, action, targetIdx) {
  const targets = resolveTargets(state.enemies, action.range, targetIdx);
  for (const i of targets) {
    const e = state.enemies[i];
    if (!(action.dmgMult > 0)) continue;
    const raw = directHitDamage({
      atk: action.atk, mult: action.dmgMult, def: e.def,
      attackerClass: action.attackerClass, targetRow: rowOfEnemy(e),
    }) * action.hits;
    const per = directDamageAgainst(e, raw, action.attackerClass, action.range);
    if (per > 0) settleDamage(state, e, per);
  }
}

// リザーブを登録する（フルーレティBのスキル）。同じ uid の予約が
// あれば差し替える。entry: { uid, label, turns, action, targetIdx }
// action は applyFireAction に渡せる形（range / hits / dmgMult / atk /
// attackerClass / terrainBonus）。発動は endTurn の最後（地形の
// 精算・持続の減少・消滅判定より後）。
export function registerReserve(state, entry) {
  const kept = (state.reserves || []).filter((r) => r.uid !== entry.uid);
  kept.push({ ...entry, turnsLeft: entry.turns });
  state.reserves = kept;
  return state.reserves;
}

// 遅延行動の予約（ナベリウスBの覚醒スキル）。entry: { uid, actorId,
// label, mult, atk, attackerClass, targetIdx, countSource, maxReps }。
// 同じ遅延行動は上書きされて最後のものだけが有効（正本の規則）
// なので、予約は1件だけ持つ。発動は次のターンの行動開始時
// （endTurn の最後に、新しいターンの最初の出来事として処理する）。
export function armDelayed(state, entry) {
  state.delayed = { ...entry };
  return state.delayed;
}

export function disarmDelayed(state) {
  state.delayed = null;
}

// 予約中の遅延行動が数える、このターンの火ダメージ回数。
// countSource: 'self' は予約した行動者自身の火、'ally' は味方全員。
export function delayedCountNow(state) {
  const d = state.delayed;
  if (!d) return 0;
  const byActor = state.turnFireByActor || {};
  if (d.countSource === 'ally') {
    return Object.values(byActor).reduce((s, n) => s + n, 0);
  }
  return byActor[d.actorId] || 0;
}

// 反復回数（原文どおり: 2回以上ならその回数分・最大 maxReps 回、
// 0〜1回なら基本の1回）。
export function delayedReps(count, maxReps) {
  return count >= 2 ? Math.min(count, maxReps || 10) : 1;
}

// 炎上の敷き直し（上書き）。enjou: { range, mult, duration, dmgMult,
// dmgHits, atk, attackerClass }。行動自体のダメージは準備と同じく
// 火回数に数えない。範囲の大きさは 全体＞列＞単体。
// opts.hitsByEnemy（{ 敵index: ヒット数 }）を渡すと、行動自体の
// ダメージは敵ごとのヒット数で当てる（割り振り対象の炎上用。
// 範囲・倍率・持続の上書き判定は従来どおり enjou の値で行う）。
// 戻り値: { overwritten, reason }
const RANGE_RANK = { single: 1, row: 2, all: 3 };
export function applyOverwrite(state, enjou, targetIdx, opts = {}) {
  if (opts.hitsByEnemy) {
    for (const [idxText, hits] of Object.entries(opts.hitsByEnemy)) {
      if (!(hits > 0)) continue;
      applySetupAction(state, {
        range: 'single', hits, dmgMult: enjou.dmgMult || 0,
        atk: enjou.atk, attackerClass: enjou.attackerClass,
      }, Number(idxText));
    }
  } else {
    applySetupAction(state, {
      range: enjou.range, hits: enjou.dmgHits || 0, dmgMult: enjou.dmgMult || 0,
      atk: enjou.atk, attackerClass: enjou.attackerClass,
    }, targetIdx);
  }
  const cur = state.terrain;
  const newRank = RANGE_RANK[enjou.range] || 1;
  const curRank = RANGE_RANK[cur.range] || 1;
  let reason = null;
  if (newRank > curRank) reason = '範囲が広い';
  else if (newRank === curRank && enjou.mult > cur.mult) reason = '倍率が高い';
  if (!reason) return { overwritten: false, reason: '範囲も倍率も今の地形以下' };
  const targets = new Set(resolveTargets(state.enemies, enjou.range, targetIdx));
  // 上書きされるのは範囲・倍率・持続だけ。地形の火回数（狂炎
  // レベル）は引き継ぎ、発生者の攻撃力も地形には残る。範囲が
  // 広がって新たに入る敵は、同じ地形（共有の回数・持続）の
  // 対象になる。
  cur.mult = enjou.mult;
  cur.range = enjou.range;
  cur.anchor = targetIdx;
  cur.duration = enjou.duration;
  cur.remaining = enjou.duration;
  for (let i = 0; i < state.enemies.length; i += 1) {
    const e = state.enemies[i];
    e.inRange = targets.has(i);
    if (e.dead) continue;
    e.covered = targets.has(i) && (!e.flying || e.shot > 0) && !e.terrainNull;
  }
  syncMirrors(state);
  return { overwritten: true, reason };
}

// 撃墜の付与（モレクの覚醒スキル）。action: { turns, dmgMult, dmgHits,
// atk, attackerClass }。火ダメージではないので回数には数えない。
// 対象が飛行なら撃墜状態にし、地形の範囲内かつ地形がまだ生きて
// いれば（持続は地形の残りに合わせる）対象に含める。地形効果を
// 無効化する特性の敵は、撃墜しても地形の対象にはならない。
// 戻り値: { damaged, grounded, targetFlying }
export function applyGroundAction(state, action, targetIdx) {
  const e = state.enemies[targetIdx];
  if (!e || e.dead) return { damaged: false, grounded: false, targetFlying: false };
  let damaged = false;
  if (action.dmgMult > 0) {
    const raw = directHitDamage({
      atk: action.atk, mult: action.dmgMult, def: e.def,
      attackerClass: action.attackerClass, targetRow: rowOfEnemy(e),
    }) * (action.dmgHits || 1);
    const per = directDamageAgainst(e, raw, action.attackerClass, 'single');
    if (per > 0) {
      damaged = true;
      settleDamage(state, e, per);
    }
  }
  if (!e.flying || e.dead) return { damaged, grounded: false, targetFlying: Boolean(e.flying) };
  e.shot = action.turns;
  let grounded = false;
  if (e.inRange && state.terrain.remaining > 0 && !e.terrainNull) {
    e.covered = true;
    grounded = true;
  }
  syncMirrors(state);
  return { damaged, grounded, targetFlying: true };
}

// ターン終了: 地形ダメージを精算し、ターンを進める。処理順は
// ゲームに合わせる: 地形ダメージの精算 → 持続の減少・消滅判定 →
// 状態（撃墜）のカウント → リザーブの発動 → 遅延行動の確定
// （反復回数はこのターンの火回数で決まる）→ ターンを進め、
// 遅延行動を新しいターンの行動開始時に発動。精算前の状態を
// 履歴に積む（巻き戻しはここへ戻る）。
export function endTurn(state) {
  state.history.push(snapshot(state));
  state.lastRevive = null;
  const t = state.terrain;
  // 地形ダメージの精算: 地形ごとに1回だけ計算し、範囲内の全員に
  // 同じ値を当てる。持続は地形ごとに1減り、0になったら地形は
  // 消える（対象全員が外れる）。
  if (t && t.remaining > 0) {
    const dmg = terrainDamage({
      applierAtk: t.applierAtk,
      converterLv: t.converterLv,
      count: t.count, mult: t.mult, correction: t.correction,
    });
    for (const e of state.enemies) {
      if (e.dead || !e.covered) continue;
      // 地形ダメージに列・単体/範囲の修飾は無い（HP依存の軽減は
      // settleDamage の中で敵ごとに適用される）。戦闘不能になれば
      // 蘇生が挟まる（シフトで地形無効化になる敵はここで外れる）。
      settleDamage(state, e, dmg);
    }
    t.remaining -= 1;
    if (t.remaining <= 0) {
      t.remaining = 0;
      for (const e of state.enemies) e.covered = false;
    }
  }
  // 撃墜のカウント: 切れたら飛行に戻り、地形の対象から外れる。
  for (const e of state.enemies) {
    if (e.shot > 0) {
      e.shot -= 1;
      if (e.shot <= 0 && e.flying) e.covered = false;
    }
  }
  // リザーブの発動: 地形が消滅した後の火は回数に入らない
  // （applyFireAction は地形の対象にだけ回数を足す）。
  // 延長はこのターンの炎ダメージ延長の残り枠を共有する。
  if (state.reserves && state.reserves.length) {
    for (const r of state.reserves) {
      if (r.turnsLeft > 0) applyFireAction(state, r.action, r.targetIdx, { pace: false });
      r.turnsLeft -= 1;
    }
    state.reserves = state.reserves.filter((r) => r.turnsLeft > 0);
  }
  // 遅延行動の発動（正本どおり「1ターン後」＝次のターンの行動
  // 開始時）: 反復回数は直前ターン（いま終わるターン）の火
  // ダメージ回数で決まるため、ここで確定させて持ち越し、ターン
  // の数えをリセットした後に、新しいターンの最初の出来事として
  // 発動させる。発動の火による延長は新しいターンの枠を使い、
  // 発動自体は火回数の数えに入らない。発動の結果は表示用に
  // delayedReport へ残す（スナップショットには含めない一時情報）。
  let delayedDue = null;
  if (state.delayed) {
    const d = state.delayed;
    delayedDue = { ...d, reps: delayedReps(delayedCountNow(state), d.maxReps) };
    state.delayed = null;
  }
  state.turnFireByActor = {};
  state.lastPace = state.turnPace;
  state.turnPace = state.enemies.map(() => ({ hits: 0, direct: 0, extend: 0 }));
  state.lastTerrainPace = state.turnTerrainPace || { hits: 0, extend: 0 };
  state.turnTerrainPace = { hits: 0, extend: 0 };
  if (t) t.extUsed = 0;
  state.turn += 1;
  state.delayedReport = null;
  if (delayedDue) {
    applyFireAction(state, {
      range: 'single', hits: delayedDue.reps, dmgMult: delayedDue.mult,
      atk: delayedDue.atk, attackerClass: delayedDue.attackerClass,
    }, delayedDue.targetIdx, { pace: false });
    state.delayedReport = {
      label: delayedDue.label, reps: delayedDue.reps, targetIdx: delayedDue.targetIdx,
    };
  }
  syncMirrors(state);
  return state;
}

// 1ターン巻き戻す。戻せたら true。
export function undoTurn(state) {
  const snap = state.history.pop();
  if (!snap) return false;
  state.turn = snap.turn;
  state.terrain = snap.terrain;
  state.terrainClock = snap.terrainClock;
  state.enemies = snap.enemies;
  state.reserves = snap.reserves || [];
  state.levels = snap.levels || {};
  state.forms = snap.forms || {};
  state.shifted = snap.shifted || {};
  state.delayedReport = null;
  state.lastRevive = null;
  state.delayed = snap.delayed || null;
  state.turnFireByActor = snap.turnFireByActor || {};
  state.turnPace = snap.turnPace;
  state.lastPace = snap.lastPace;
  state.turnTerrainPace = snap.turnTerrainPace || { hits: 0, extend: 0 };
  state.lastTerrainPace = snap.lastTerrainPace || null;
  syncMirrors(state);
  return true;
}

// 次の精算での地形ダメージ（敵ごと。地形の精算値そのものは
// 対象全員で同じ値だが、HP依存の軽減を持つ敵は自分のHP割合で
// 軽減した分だけを受けるため、その分を差し引いて返す）。
export function nextTerrainDamage(state, enemyIdx) {
  const e = state.enemies[enemyIdx];
  const t = state.terrain;
  if (!e || e.dead || !e.covered || !t || t.remaining <= 0) return 0;
  return hpScaledReduction(e, e.hpNow, e.maxHp, terrainDamage({
    applierAtk: t.applierAtk,
    converterLv: t.converterLv,
    count: t.count, mult: t.mult, correction: t.correction,
  }));
}

function paceOf(state) {
  const cur = state.turnPace;
  if (cur && cur.some((p) => p.hits > 0 || p.direct > 0)) return cur;
  if (state.lastPace && state.lastPace.some((p) => p.hits > 0 || p.direct > 0)) return state.lastPace;
  return state.enemies.map(() => ({ hits: 0, direct: 0, extend: 0 }));
}

// 見通し: 今のターンの伸び方（このターンに積んだ火回数と直接
// ダメージ。無ければ直前のターン）と同じ行動を毎ターン繰り返す
// 前提で、地形ダメージの列と撃破ターンを敵ごとに投影する。
// 地形は範囲で1つの実体として投影する: 回数と持続は地形が持ち、
// 地形ダメージは範囲内の全員に同じ値が入る（帯も同じ値になる）。
// 戻り値: { perEnemy: [{ bands: [地形ダメージ...], killTurn }],
//           allKillTurn, lastToFall }
export function forecast(state) {
  const pace = paceOf(state);
  // 地形の伸び方も、敵ごとの伸び方と同じターン（今のターン／
  // 直前のターン）から取る。
  const useCur = pace === state.turnPace;
  const tPace = (useCur ? state.turnTerrainPace : state.lastTerrainPace) || { hits: 0, extend: 0 };
  const tApplied = state.turnTerrainPace || { hits: 0, extend: 0 };
  const t = state.terrain;
  let tCount = t.count;
  let tRemaining = t.remaining;
  const hp = state.enemies.map((e) => e.hpNow);
  const coveredP = state.enemies.map((e) => e.covered);
  const shotP = state.enemies.map((e) => e.shot || 0);
  const bands = state.enemies.map(() => []);
  const killTurnP = state.enemies.map((e) => (e.dead ? e.killTurn : null));
  // この敵へのリザーブ（単体のみ。登録済みのものが残りターンぶん
  // ターン終了時に自動で続く）。
  const resBy = state.enemies.map((_, i) => (state.reserves || [])
    .filter((r) => r.targetIdx === i && r.turnsLeft > 0)
    .map((r) => ({ left: r.turnsLeft, action: r.action })));
  const aliveP = (i) => !state.enemies[i].dead && killTurnP[i] == null;
  // 蘇生とシフトの投影: 形（form）・残り蘇生回数・現在の形の
  // 被ダメージの扱いを敵ごとに写して進める。シフトで被ダメージの
  // 扱いが pace を記録した時の形と変わる敵は、数値で追えないため
  // その敵の投影をシフトの時点で止める（stoppedP）。地形無効化
  // だけが変わる場合は、地形の対象から外して投影を続ける。
  // HP依存の軽減（reductionMax）は数値化できるため、それだけが
  // 増えるシフトでは止めず、投影のダメージに軽減を適用する。
  // 止めた理由は stopUnknownP で分ける（数値化できない軽減か、
  // 列無効化・被ダメージ上昇の変化か）。
  const formP = state.enemies.map((e) => e.form || 0);
  const revivesP = state.enemies.map((e) => e.revivesLeft || 0);
  const propsP = state.enemies.map((e) => ({
    terrainNull: Boolean(e.terrainNull),
    nullRow: e.nullRow || null,
    takenUpSingle: e.takenUpSingle || 1,
    takenUpRange: e.takenUpRange || 1,
    reductionMax: e.reductionMax || 0,
    unknownDamage: Boolean(e.unknownDamage),
  }));
  const stoppedP = state.enemies.map(() => false);
  const stopUnknownP = state.enemies.map(() => false);
  const incapacitateP = (i, turnNo) => {
    const e = state.enemies[i];
    const spec = e.reviveSpec;
    if (spec && revivesP[i] > 0) {
      revivesP[i] -= 1;
      hp[i] = Math.max(1, Math.floor(e.maxHp * spec.hpPct / 100));
      if (spec.shift && formP[i] === 0) {
        formP[i] = 1;
        const before = propsP[i];
        const after = {
          terrainNull: Boolean(spec.shift.terrainNull),
          nullRow: spec.shift.nullRow || null,
          takenUpSingle: 1,
          takenUpRange: 1,
          reductionMax: spec.shift.reductionMax || 0,
          unknownDamage: Boolean(spec.shift.unknownDamage),
        };
        propsP[i] = after;
        if (after.terrainNull) coveredP[i] = false;
        else if (e.inRange && tRemaining > 0 && (!e.flying || shotP[i] > 0)) coveredP[i] = true;
        if (after.unknownDamage) {
          stoppedP[i] = true;
          stopUnknownP[i] = true;
        } else if (after.nullRow !== before.nullRow
          || after.takenUpSingle !== before.takenUpSingle
          || after.takenUpRange !== before.takenUpRange) {
          stoppedP[i] = true;
        }
      }
      return;
    }
    killTurnP[i] = turnNo;
  };

  for (let k = 1; k <= FORECAST_MAX_TURNS; k += 1) {
    const turnNo = state.turn + k - 1;
    // 1ターン目（今のターン）は、タップ済みの分が既に状態へ入って
    // いる。そのターンの合計が pace と同じになるよう、残りの分
    // だけを足す（2ターン目以降は pace をそのまま繰り返す）。
    const tHits = k === 1 ? Math.max(0, tPace.hits - tApplied.hits) : tPace.hits;
    const tExtend = k === 1
      ? Math.max(0, (tPace.extend || 0) - (tApplied.extend || 0))
      : (tPace.extend || 0);
    // 遅延行動（予約済みのものは次のターンの行動開始時に発動
    // する＝投影では2ターン目の先頭）。反復回数は直前ターン
    // （予約したターン＝投影の1ターン目）の火回数で決まる。
    if (k === 2 && state.delayed) {
      const d = state.delayed;
      const i = d.targetIdx;
      if (state.enemies[i] && aliveP(i) && !stoppedP[i]) {
        const byActor = state.turnFireByActor || {};
        const cnt = d.countSource === 'ally'
          ? Object.values(byActor).reduce((s, n) => s + n, 0)
          : (byActor[d.actorId] || 0);
        const reps = delayedReps(cnt, d.maxReps);
        if (d.mult > 0) {
          const raw = directHitDamage({
            atk: d.atk, mult: d.mult, def: state.enemies[i].def,
            attackerClass: d.attackerClass, targetRow: rowOfEnemy(state.enemies[i]),
          }) * reps;
          const per = hpScaledReduction(propsP[i], hp[i], state.enemies[i].maxHp,
            directDamageAgainst(propsP[i], raw, d.attackerClass, 'single'));
          if (per > 0) {
            hp[i] -= per;
            if (hp[i] <= 0) incapacitateP(i, turnNo);
          }
        }
        // 列で無効化された火も地形の回数には入る（実機と同じ作法）。
        if (killTurnP[i] == null && !stoppedP[i] && coveredP[i] && tRemaining > 0) {
          tCount = Math.min(COUNT_CAP, tCount + reps);
          tRemaining += Math.min(reps, EXTEND_PER_TURN);
        }
      }
    }
    // 直接ダメージの伸び方（敵ごと）。pace の直接ダメージは、
    // その敵の現在の形での値として記録されている。シフトで形が
    // 変わった敵は stoppedP で止まっているので、ここでは形が
    // 変わらない前提でそのまま当てる。
    for (let i = 0; i < state.enemies.length; i += 1) {
      if (!aliveP(i) || stoppedP[i]) continue;
      const base = pace[i] || { hits: 0, direct: 0, extend: 0 };
      const applied = state.turnPace[i] || { hits: 0, direct: 0, extend: 0 };
      const pDirect = k === 1 ? Math.max(0, base.direct - applied.direct) : base.direct;
      if (pDirect > 0) {
        // pace の直接ダメージは軽減前の値で記録されているため、
        // 現在の形に軽減があれば投影側で適用する。
        const eff = hpScaledReduction(propsP[i], hp[i], state.enemies[i].maxHp, pDirect);
        if (eff > 0) {
          hp[i] -= eff;
          if (hp[i] <= 0) incapacitateP(i, turnNo);
        }
      }
    }
    // 地形の伸びと精算（地形ごとに1回。範囲内の全員に同じ値）。
    if (tRemaining > 0) {
      tCount = Math.min(COUNT_CAP, tCount + tHits);
      tRemaining += Math.min(tHits, EXTEND_PER_TURN) + tExtend;
      const dmg = terrainDamage({
        applierAtk: t.applierAtk,
        converterLv: t.converterLv,
        count: tCount, mult: t.mult, correction: t.correction,
      });
      for (let i = 0; i < state.enemies.length; i += 1) {
        if (!coveredP[i] || !aliveP(i) || stoppedP[i]) continue;
        // 精算値そのものは全員同じだが、受ける量は敵ごとの
        // HP依存の軽減で変わる（帯は実際に減るHPの分を出す）。
        const eff = hpScaledReduction(propsP[i], hp[i], state.enemies[i].maxHp, dmg);
        bands[i].push(eff);
        hp[i] -= eff;
        if (hp[i] <= 0) incapacitateP(i, turnNo);
      }
      tRemaining -= 1;
      if (tRemaining <= 0) tRemaining = 0;
    }
    // 撃墜のカウント（切れたら地形の対象から外れる）。
    for (let i = 0; i < state.enemies.length; i += 1) {
      if (shotP[i] > 0) {
        shotP[i] -= 1;
        if (shotP[i] <= 0 && state.enemies[i].flying) coveredP[i] = false;
      }
    }
    // リザーブの発動（地形の精算より後。地形が残っている時だけ
    // 回数が伸び、直接ダメージは常に入る）。
    for (let i = 0; i < state.enemies.length; i += 1) {
      for (const r of resBy[i]) {
        if (r.left <= 0) continue;
        r.left -= 1;
        if (!aliveP(i) || stoppedP[i]) continue;
        const a = r.action;
        if (a.dmgMult > 0) {
          const raw = directHitDamage({
            atk: a.atk, mult: a.dmgMult, def: state.enemies[i].def,
            attackerClass: a.attackerClass, targetRow: rowOfEnemy(state.enemies[i]),
            terrainBonus: coveredP[i] && tRemaining > 0 && a.terrainBonus ? a.terrainBonus : 1,
          }) * a.hits;
          const per = hpScaledReduction(propsP[i], hp[i], state.enemies[i].maxHp,
            directDamageAgainst(propsP[i], raw, a.attackerClass, 'single'));
          if (per > 0) {
            hp[i] -= per;
            if (hp[i] <= 0) incapacitateP(i, turnNo);
            if (killTurnP[i] != null || stoppedP[i]) continue;
          }
        }
        // 列で無効化された火も地形の回数には入る（実機と同じ作法）。
        if (coveredP[i] && tRemaining > 0) {
          tCount = Math.min(COUNT_CAP, tCount + a.hits);
          tRemaining += Math.min(a.hits, EXTEND_PER_TURN);
        }
      }
    }
    // 終了判定: 全員が落ちたか、誰にもこれ以上ダメージが入らない
    // 見込みになったら打ち切る。
    if (state.enemies.every((_, i) => killTurnP[i] != null)) break;
    const delayedPending = k === 1 && state.delayed && state.delayed.mult > 0
      && state.enemies[state.delayed.targetIdx] && aliveP(state.delayed.targetIdx);
    const anyHope = state.enemies.some((_, i) => {
      if (!aliveP(i) || stoppedP[i]) return false;
      if ((pace[i] && pace[i].direct > 0)) return true;
      if (coveredP[i] && tRemaining > 0) return true;
      if (delayedPending && state.delayed.targetIdx === i) return true;
      return resBy[i].some((r) => r.left > 0 && r.action.dmgMult > 0);
    });
    if (!anyHope) break;
  }

  const perEnemy = state.enemies.map((e, i) => (e.dead
    ? { bands: [], killTurn: e.killTurn }
    : {
      bands: bands[i], killTurn: killTurnP[i],
      stoppedAtShift: stoppedP[i], stopUnknown: stopUnknownP[i],
    }));
  let allKillTurn = null;
  let lastToFall = null;
  if (perEnemy.every((f) => f.killTurn != null)) {
    allKillTurn = Math.max(...perEnemy.map((f) => f.killTurn));
    const idx = perEnemy.findIndex((f) => f.killTurn === allKillTurn);
    lastToFall = state.enemies[idx] ? state.enemies[idx].name : null;
  }
  return { perEnemy, allKillTurn, lastToFall };
}

// 結論文（モックで承認された形）。全員が投影で落ちる時だけ
// 「あと◯ターンで全員倒せる。最後に落ちるのは◯◯（ターン◯）」。
export function conclusionText(state, fc) {
  if (state.enemies.every((e) => e.dead)) {
    let last = null;
    let lastTurn = 0;
    for (const e of state.enemies) {
      if (typeof e.killTurn === 'number' && e.killTurn >= lastTurn) {
        lastTurn = e.killTurn;
        last = e.name;
      }
    }
    return `全員倒せた。最後に落ちたのは${last}（ターン${lastTurn}）`;
  }
  if (fc && fc.allKillTurn != null) {
    const n = fc.allKillTurn - state.turn + 1;
    return `あと${n}ターンで全員倒せる。最後に落ちるのは${fc.lastToFall}（ターン${fc.allKillTurn}）`;
  }
  return '今の伸び方では倒し切れない';
}
