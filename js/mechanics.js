// 非直観的な仕組みの注記（research/mechanics-display-proposals.md、
// ユーザー決定 2026-11-19「表示して」）。最終形は同書の「確定記録
// （2026-11-19 午後のレビュー）」であり、ラウンドA（2026-11-19）で
// 提案形から確定形へ作り直した。
// 前提: ツールは戦闘中に開かれないため、戦闘中の現在値（現在の
// ボルテージ等）は全件対象外。出すのは編成時点の性質と、敵ごとに
// 計算できる数だけ。文面は「どこで、どうやって準備して、どう使う
// のか」に答える形にし、ゲーム内に無い言い換え（例: コロッセオの
// 状態を「開いている」と言う類）は使わず、ゲームの言葉をそのまま
// 使う。効かない手段は注意文ではなく表示自体をしない（例: 飛行の
// 敵への地形手段は、導出と表示の段階で除外する側の規則）。
// 置き場所は既存の部品だけ:
//   - M6: 編成候補の注記行（キー検出は生成データ mechanic-notes が
//     担う。検出は本体＋専用霊宝の能力原文へのキーワード含有のみで、
//     マスエフェクト分は含まない）。
//   - M6: かばう役を2人以上置いた時だけ、エディタに1行。
//   - M6: 編成内に複数のトランス始動が含まれる時、保存の直上の
//     警告枠に確定済みの注意文（検出は生成データの tranceStarters／
//     tranceStartersMe。ME 由来はリーダーの時だけ数える）。
//   - M4: 敵が持つ仕組みと、著述に載る仕組みへの1行（著述の側）。
//   - M4: 敵の攻撃構成から計算する、かばう／執心の受け方の対応と
//     1トップ・1ボトムの形（enemyReceivingNotes）。
//   - M4: 点穴・エレキの、敵のHPに対する数（必要点数・必要レベル）
//     と、ハイドロボムの敵別の目安（著述＋裏の計算）。
// 出さないと決めた仕組み（オーラ、対臨界戦術、フォトン強化の1.5倍、
// バフ・デバフの重ねがけ計算、バレットアーツの合算、舞闘）と、
// 保留のもの（オーバーチャージの効果量の式＝推定式）には、ここにも
// 文面を持たない。コルソンRの「満足度」の蓄積規則は 2026-11-19 に
// ユーザー提供素材で確定したため、注記に含める（corsonr）。
// DOM・保存には触れない純粋関数群。

import { meConditionVerdict, ME_SLOT_KEYS } from './counter.js';

// 生成データのキー → 注記の文面（行の配列）。
// 文面は確定記録の形に沿い、数値は確定した閾値と上限だけを出す。
export const MEGIDO_MECHANIC_NOTES = {
  ereki: [
    'エレキ: 雷ダメージが当たるたびにエレキレベルが上がり、解除でレベル分の固定ダメージ（防御無視）',
    '育てるのは雷の多段ヒット。オーブならケラヴノス（3回）が実用。無敵と回数バリアには止められる',
  ],
  music: [
    '音符は音楽系の行動で増える（奥義で2個、その他で1個、上限10個）。5個以上で大協奏',
    '音符は寿命（協奏2ターン・重奏3ターン）や弾撃での消費、トランスの上書きで消える',
  ],
  dangeki: [
    '弾撃: 重奏中、攻撃を受けると音符1個を消費して反撃する（行動ごとに1回）',
    'ダメージは攻撃した敵の攻撃力で決まる。多段攻撃をあえて受けると、大きな1発になる',
  ],
  // 音符を縮める技（候補8）: 計算には入れず、その技を持つ本人の
  // 注釈としてだけ出す。文面は正本の技能文の言い回しに沿わせる。
  verdre: [
    '音符: スキル「ベンダバール」は、味方の2ターン音符の継続ターンを最大3個まで-1する（使うと音符が減る側の効果）',
  ],
  abaram: [
    '音符: 覚醒スキル「ビートショット」は、味方の全ての2ターン音符の継続ターンを-1する（使うと音符が減る側の効果）',
  ],
  voltage: [
    'ボルテージ: 攻撃するたびにバーサークの人数分上がる（上限70）。攻撃力は最大+420%まで上がり、下がることはない',
    '自傷はボルテージが上がるほど階段式に増え、最大で最大HPの30%まで',
  ],
  berserk: [
    'バーサーク: HPの減少は火力のためのコスト。解除されても、溜めた上昇分は残る',
    '備えは、かばう・回復やドレイン・アーマー',
  ],
  necro: [
    'ネクロ: ダメージ軽減はソウル10（戦闘不能 約4回）で頭打ち、能力上昇はソウル15（約5回）まで伸びる',
    '準備は、始動できる人・蘇生できる人・生き死にを繰り返す人の3点セット',
  ],
  fimpulse: [
    'Fインパルス: エネルギーはダメージの回数で、編成合計で溜まる（上限999）',
    '2ターンごとに、最も溜めた人がリリースで全体攻撃する。使った人は消耗が3ターン続く',
  ],
  halphasR: [
    'ハルファスR: リリースが単体化し、与えた人のダメージが増える。強化版ではエネルギーが全て戻る',
  ],
  grimalkinR: [
    'グリマルキンR: 始動できる。リリースで、与えたダメージの一部を味方全体が吸収する',
  ],
  lucifer: [
    'ルシファー: 始動できる。ターン開始時にエネルギーが増え、マスエフェクトで消耗にならない',
    '覚醒スキルの解放で、他の全員の強化を解除して自分の攻撃力を上げ、リリースする人を自分に変える',
  ],
  furiaeR: [
    'フリアエR: 奥義で回復とアーマーのリリース効果を付け、エネルギーを足す',
  ],
  hadan: [
    '破断は地割れ中なら更に大ダメージ。地割れを付与できる人と一緒に編成すると使える',
    '使う前に、地形が地割れかどうかを確認する。防御無視と併用できる',
  ],
  jiware: [
    '防御を半減する地形。破断持ちがいると更に大ダメージが与えられる。',
  ],
  gouken: [
    '剛剣: 専用霊宝で、戦闘開始時に剛剣状態になる。フォトンを与えられなかったターンの終わりにも付く',
    '剛剣中の攻撃は1回だけ、ダメージが200%上がり、防御を貫通して、ダメージ軽減も無効化する',
  ],
  kyousen: [
    'モレク: 浸食を強染に変えられる唯一の人。味方は強染で回復し、敵は行動するほど地形ダメージが伸びる',
    '地形ダメージがフォトン充填になり、奥義の燃料になる',
  ],
  toudo: [
    '凍土: 氷結を凍土に変える。単体ならガギゾン1人で完結する（単体への氷結も置ける）',
    '全体を変えるなら、全体に氷結を置ける人と組む',
  ],
  amazeroB: [
    '氷結・凍土の地形にいる敵へ、1.5倍のダメージ',
  ],
  colosseo: [
    'コロッセオ: 与ダメージの総量で勝っている間、単体ダメージが伸びる。勝てる時だけ開く',
    'トランスで戦う敵には、ハイトランスの上書きで土台を潰せる',
  ],
  coloBri: ['コロッセオ中は自身の素早さが上がる。奥義で味方全体の素早さも上げる'],
  coloBal: ['コロッセオ中は、攻撃を受けると反撃する'],
  coloGai: ['覚醒スキルでコロッセオを始め、自身を幻影状態にする'],
  coloBot: ['コロッセオ中は、ターン終了時に自身のHPが回復する'],
  coloGar: ['スキルと覚醒スキルは、コロッセオ中・優勢時で段階的に強くなる'],
  coloAlo: ['劣勢の時は、奥義がHPが少ないほど威力の高い攻撃に変わる'],
  coloZag: ['コロッセオ中は、奥義が味方全体の攻撃力と素早さの上昇に変わる'],
  corsonr: [
    'おかえし中は点穴の上限が200になり、溜めた全部を一撃に使う。満足度30／60で技が一段ずつ強くなる',
    '満足度は、おねだり中に要求フォトンを渡すと+15、それ以外は+5（上限60）',
    '進め方: おねだりで点穴を溜めながら満足度60を目指し、覚醒スキルでおかえしに移ってから撃つ',
  ],
  tenana: [
    '点穴は単体・単発の攻撃でだけ発動する。多段や列・全体の攻撃でも消費されて0になる',
  ],
  belial: [
    '連射型: 固定砲台の間は全ての行動が単体攻撃になり、1発で10点だけ消費する',
    '120点以上を貯めてから砲台に入ると、フォトン容量が+1される',
    '点穴10ごとに被ダメージ軽減（最大40%）',
  ],
  strassR: [
    '再生型: 140点まで貯めて、奥義→スキルで同じ大きさの射撃を繰り返せる',
  ],
  lerajeR: [
    '75点まで貯めて撃つ、を繰り返す形。69点以下では、攻撃で発動も消費もしない',
  ],
  purufurasu: [
    '攻撃しながら貯める速さは最速級。放出は通常の上限（100点）どおり',
  ],
  baphomet: [
    '仕組み側: 点穴還元を敵に付けておくと、点穴を消費する攻撃が当たった時に、全ての敵へ点穴が配られる',
  ],
  satanakiaB: ['チェイン数で攻撃力が階段状に跳ぶ（最大130%）'],
  chain: [
    'チェイン: 順番の外から味方を行動させる。相手より先に動けることが強さで、支援も妨害も順番を無視して届く',
  ],
  salugatanasu: [
    'フォトンやオーブを使うたびにチェインする特性は、専用霊宝を付けた時だけ',
  ],
  baalzephon: [
    'チェインは、チャージフォトンの使用時に始まる（覚醒ゲージが最大の60%以上。専用霊宝でゲージの条件が消える）',
  ],
  hbomb: [
    'ハイドロボム: 基本は3ターン起爆。速を先に置き、倍率を上げてから弾けさせる',
    '稼ぎの中心は、重を畳んで錬の倍率を上げることと、同じターンに弾ける数（同時爆破補正）',
  ],
};

// 候補1体の注記行。材料が無い場合は空（注記自体を出さない）。
export function mechanicNoteLines(notesData, megidoId) {
  const keys = (notesData && notesData.notes && notesData.notes[megidoId]) || [];
  const lines = [];
  for (const key of keys) {
    for (const line of MEGIDO_MECHANIC_NOTES[key] || []) lines.push(line);
  }
  return lines;
}

// かばうの発動者決定（M6）: かばう役を2人以上置いた時だけ意味を
// 持つため、その時だけの1行。確率の加算そのものは出さない。
// 事実（2026-11-19 ユーザー訂正）: かばう状態の者が複数いる場合、
// 誰がかばうかはランダムで決まる（敵のターゲットの取り方でも
// 挙動が微妙に変わる）。旧文面「残りHPが一番大きい人」は誤認で、
// そのような仕様は存在しない。
export function kabauPartyNotes(kabauCount) {
  return kabauCount >= 2 ? ['かばう持ちが複数いる時、実際にかばうのはランダムで決まります'] : [];
}

// ---- トランス競合の注意（M6、検出機構込み） ----
// 検出材料は生成データ（generate-mechanic-notes.mjs）:
//   tranceStarters: 行動（スキル・覚醒スキル・奥義）で「味方編成を
//     X状態にする」者 → 系統の配列。
//   tranceStartersMe: マスエフェクトの効果文に始動が含まれる保持者。
//     ME は保持者がリーダーの編成でだけ働くため、リーダーの分だけ
//     数える。
// 判定は「異なる系統が2つ以上」。同じ系統の始動が複数あっても、
// 上書きで資源が消える問題は起きない（協奏と重奏は同じ系統として
// 生成側でまとめてある）。文面は確定済みの原文そのまま。黄色・
// 小さく・保存は妨げない（警告枠の既存の流儀に載せる）。
export const TRANCE_CONFLICT_TEXT = '複数のトランスを始動する行動が編成に含まれています。トランスを上書きする可能性があるので注意してください';

export function tranceFamiliesInFormation(notesData, memberIds, leaderId) {
  if (!notesData) return [];
  const families = new Set();
  for (const id of memberIds || []) {
    for (const f of (notesData.tranceStarters || {})[id] || []) families.add(f);
  }
  if (leaderId) {
    for (const f of (notesData.tranceStartersMe || {})[leaderId] || []) families.add(f);
  }
  return [...families];
}

export function tranceConflictLines(families) {
  return (families || []).length >= 2 ? [TRANCE_CONFLICT_TEXT] : [];
}

// ---- ピッカーの文脈注記（2026-11-20） ----
// オーラ対応: オーラ持ちのメギドのオーブピッカーで、そのオーラが
// 指定する種族に合うオーブへ印を付ける。指定種族の材料は生成
// データ（auraOrbRaces）。専用霊宝の所持で対象が変わる者は、
// 所持している時だけ reishouRaces を使う（所持の判定は呼び出し側
// が既存の作法で行う）。対象が空（専用霊宝版で初めてオーラが付く
// 者が未所持）の場合は印を付けないため、空配列をそのまま返す。
export function auraOrbRacesFor(notesData, megidoId, specialReishouOwned) {
  if (!notesData || !notesData.auraOrbRaces) return null;
  const rec = notesData.auraOrbRaces[megidoId];
  if (!rec) return null;
  if (specialReishouOwned && Array.isArray(rec.reishouRaces)) return rec.reishouRaces;
  return Array.isArray(rec.races) ? rec.races : null;
}

// 音符発生の注記は、編成に協奏・重奏の始動役がいる場合に限る
// （始動役がいない編成では音符は意味を持たないため、注記自体を
// 出さない）。始動の判定はトランス競合検出と同じ材料を使う
// （本体の始動行動は常時、マスエフェクトの始動はリーダーの時だけ）。
export function kyousouStarterInFormation(notesData, memberIds, leaderId) {
  return tranceFamiliesInFormation(notesData, memberIds, leaderId)
    .includes('協奏・重奏');
}

// 音符を発生させる候補か（生成データ noteMakers: 能力文面の
// 「音符を◯つ蓄積／付与」からの機械抽出。消費・短縮だけの者は
// 含まれない）。
export function isNoteMakerMegido(notesData, megidoId) {
  return Boolean(notesData && notesData.noteMakers
    && (notesData.noteMakers.megido || []).includes(megidoId));
}

export function isNoteMakerOrb(notesData, orbId) {
  return Boolean(notesData && notesData.noteMakers
    && (notesData.noteMakers.orbs || []).includes(orbId));
}

// ---- 点穴・エレキの数（M4・ターゲット時のピッカー） ----
// 式は corpus-status の定義が正本:
//   点穴ダメージ = 点穴レベル^2 × メギドLv ÷ 35（固定ダメージ。
//   自分の攻撃力・敵の防御力は無関係）。
//   エレキの解除ダメージ = 最初の付与者のLv × 20 × エレキレベル
//   （レベルは雷ヒットで +1、上限50）。
// 表示の問いは「いくら出るか」ではなく「この敵を倒すのにどれだけ
// 要るか」に倒す（確定記録）。Lv は星6の標準である70を基準にし、
// 文面で明示する。
export const SYSTEM_BASE_LEVEL = 70;

// 式用レベル（2026-11-20 ユーザー確定の分け方）: レベルを参照する
// 計算式（点穴・ハイドロボム・狂炎など）では、味方メギドのレベルは
// 魔重で上限を上げていても 70 固定で処理する。保存レベル（75〜80）
// から式用の Lv を作る時は必ずここを通す。ステータスへの魔重加算
// （stats.js）と、解禁判定など保存レベルそのものを見る用途は、
// ここでは扱わない。
export function formulaLevel(savedLevel) {
  return typeof savedLevel === 'number' && Number.isFinite(savedLevel)
    ? Math.min(savedLevel, SYSTEM_BASE_LEVEL)
    : SYSTEM_BASE_LEVEL;
}

export function tenanaDamage(points, lv = SYSTEM_BASE_LEVEL) {
  return Math.floor((points * points * lv) / 35);
}

export function tenanaRequiredPoints(enemyHp, lv = SYSTEM_BASE_LEVEL) {
  if (typeof enemyHp !== 'number' || enemyHp <= 0) return null;
  return Math.ceil(Math.sqrt((enemyHp * 35) / lv));
}

// 点穴でこの敵に届くかの行。1発で倒すのに要る点数と、上限100点の
// 射撃が何発要るかを併記する（チームで分けて用意する形も、確定
// 記録の形）。上限を超える場合は、その旨も足す。
export function tenanaVsEnemyLines(enemyHp, lv = SYSTEM_BASE_LEVEL) {
  const req = tenanaRequiredPoints(enemyHp, lv);
  if (req === null) return [];
  const shots100 = Math.ceil(enemyHp / tenanaDamage(100, lv));
  let line = `点穴: この敵を1発で倒すには${req}点必要（Lv${lv}で計算）。100点の射撃なら${shots100}発`;
  if (req > 100 && req <= 140) line += '。100点を超える分は、系譜「一心」の霊宝が必要';
  else if (req > 140 && req <= 240) line += '。届くのはコルソンRのおかえし（上限200、一心で240）だけ';
  else if (req > 240) line += '。1発では届かないため、分けて用意する';
  return [line];
}

export function erekiReleaseDamage(level, lv = SYSTEM_BASE_LEVEL) {
  return lv * 20 * level;
}

// エレキでこの敵に届くかの行。必要レベル（＝雷ヒットの回数）と、
// 上限50レベルでも届かない場合の正直な形。
export function erekiVsEnemyLines(enemyHp, lv = SYSTEM_BASE_LEVEL) {
  if (typeof enemyHp !== 'number' || enemyHp <= 0) return [];
  const needed = Math.ceil(enemyHp / erekiReleaseDamage(1, lv));
  if (needed > 50) {
    return [`エレキ: 最大50レベルでも、解除ダメージは${erekiReleaseDamage(50, lv)}まで。この敵には1回の解除では届かない`];
  }
  return [`エレキ: この敵には${needed}レベルで届く（雷ヒット${needed}回分。解除ダメージ${erekiReleaseDamage(needed, lv)}）`];
}

// ---- かばう／執心の受け方の対応（M4） ----
// 敵の攻撃構成（スキル・覚醒スキル・奥義の文面から読む範囲・倍率・
// ヒット数と、構成員のクラス）を敵データから読み、受ける役との
// 対応を組み立てて渡す（確定記録「かばう/執心」。汎用のヒント文は
// 出さない）。判定の閾値は、塔の敵の単体倍率の分布（大半が1.8倍
// 以下、2.5倍以上は最上位の数件）に合わせた較正:
//   スキル（スキルフォトン）の単体 1.5倍以上 → ロノウェ
//     （スキルフォトンからのダメージを50%軽減できる）。
//   単体・単発の 2.5倍以上 → ボティス／ラウムC（致死級の1撃）。
//   1ヒット1倍以下の多段 → ブニ／ザガン（小さいダメージの無効化）。
// 通常攻撃は全ての敵が単体であるため、「単体が無い」の判定は
// スキル等の中心になる攻撃だけを見る。通常攻撃しか届かない列は、
// 1トップの判定（クラス）で扱う。
const SHISHIN_APPLIERS = 'ロノウェR・ウヴァルC・ゲイボルグ・オロバスC・ウァラクC・オレイ・アガシオン';

function parseEnemyActions(fact) {
  const actions = [];
  for (const m of (fact.party || []).filter(Boolean)) {
    const skills = m.skills || {};
    for (const kind of ['skill', 'awakened', 'ultimate']) {
      const txt = skills[kind];
      if (!txt) continue;
      for (const seg of String(txt).split(/[。／]/)) {
        if (!seg.includes('ダメージ')) continue;
        if (/地形|継続ダメージ/.test(seg)) continue;
        const range = /ランダム|無作為/.test(seg) ? 'random'
          : /全体/.test(seg) ? 'all'
          : /一列|列に|列の/.test(seg) ? 'row'
          : /単体/.test(seg) ? 'single' : null;
        if (!range) continue;
        const multM = seg.match(/攻撃力([\d.]+)倍/) || seg.match(/([\d.]+)倍のダメージ/);
        const hitsM = seg.match(/(\d+)連続/) || seg.match(/(\d+)連撃/);
        actions.push({
          kind,
          range,
          mult: multM ? parseFloat(multM[1]) : null,
          hits: hitsM ? parseInt(hitsM[1], 10) : 1,
          backRow: /後列/.test(seg),
          frontRow: /前列/.test(seg),
        });
      }
    }
  }
  return actions;
}

// 敵1種の受け方の行。材料（構成員の能力文）が無い敵には出さない。
export function enemyReceivingNotes(fact) {
  if (!fact || !Array.isArray(fact.party)) return [];
  const party = fact.party.filter(Boolean);
  if (party.length === 0) return [];
  const actions = parseEnemyActions(fact);
  const lines = [];
  const hasRandom = actions.some((a) => a.range === 'random');
  const hasSingle = actions.some((a) => a.range === 'single');
  if (hasRandom) {
    lines.push(`ランダムに狙う単体攻撃は、かばうでは受けられない。執心で狙いを固定する手がある（付ける人: ${SHISHIN_APPLIERS}）`);
  }
  if (actions.length > 0 && !hasSingle && !hasRandom) {
    lines.push('攻撃の中心は列・全体で、かばうが受けられるのは通常攻撃だけ。巨大化したネフィリムの全域かばうなら、列・全体も受けられる');
  }
  if (actions.some((a) => a.kind === 'skill' && a.range === 'single'
    && a.mult !== null && a.mult >= 1.5)) {
    lines.push('スキルフォトンの単体攻撃が大きい。ロノウェなら、受け持ちながらスキルフォトンのダメージを半分にできる');
  }
  if (actions.some((a) => a.range === 'single' && a.hits === 1
    && a.mult !== null && a.mult >= 2.5)) {
    lines.push('一撃が大きい単体攻撃がある。ボティスなら攻撃を1回無効化でき、ラウムCは致死ダメージで一度踏み止まる');
  }
  if (actions.some((a) => a.hits >= 2 && a.mult !== null && a.mult <= 1.0)) {
    lines.push('1ヒットが小さい多段攻撃がある。小さいダメージを無効化できるブニ（最大HPの15%以下）やザガン（20%以下）で受けると消せる');
  }
  // 1トップ・1ボトム: 攻撃の届く列が片方だけなら、その列を
  // 1体に絞れる（確定記録）。届く列はクラスで決まる: ファイターと
  // スナイパーは前列にしか攻撃が届かず、トルーパーは後列に届く
  // （バーストはどちらにも届く）。全体攻撃や逆の列を狙う攻撃が
  // あると、絞った1体以外にも攻撃が届くので出さない。
  const classes = party.map((m) => m.class);
  if (actions.length > 0 && classes.length > 0
    && classes.every((c) => c === 'ファイター' || c === 'スナイパー')
    && !actions.some((a) => a.backRow)
    && !actions.some((a) => a.range === 'all')) {
    lines.push('攻撃は前列にしか届かない。前に出る人数を1体に絞る形（ワントップ）が使え、その1体には攻撃が集中するほど得をする特性（アスモデウスRの第2特性など）が合う');
  }
  if (actions.length > 0 && classes.length > 0
    && classes.every((c) => c === 'トルーパー')
    && !actions.some((a) => a.frontRow)
    && !actions.some((a) => a.range === 'all')) {
    lines.push('攻撃は後列にしか届かない。後ろに置く人数を1体に絞る形（ワンボトム）が使え、その1体には攻撃が集中するほど得をする特性が合う');
  }
  return lines.slice(0, 3);
}

// ---- ハイドロボムの敵別の目安（M4） ----
// 著述（ボス・通常敵の攻略情報）に載る敵について、確定記録の4変数
// （起爆ターン／重を畳む回数と錬倍率／ボム強化込みか／同時爆破
// 補正）の目安を用意する。錬の倍率と同時爆破補正はツールが裏で
// 計算する:
//   錬の倍率 = 0.1 + 錬成で解除したボムの倍率の合計（上限50）。
//     1回の錬成で畳めるのは、対象に付いた3個まで。重ねて錬成すると
//     前の錬も含めて積み上がる。cycles は錬成ごとの重の倍率の配列で、
//     値は索引の保持者の原文（ウェパルBの重: スキル3倍・奥義6倍、
//     シトリーRの覚醒4倍、フラウロスBの覚醒3.25倍）が正本。
//   同時爆破補正 = 1 + 同じターンに弾けるボムの総数 × 0.1
//     （corpus-status/ハイドロボム.json の式）。
// 起爆ターンの基本形は3ターン（実戦知見の確定形）。著述に別の形が
// ある敵は、著述の形を優先する。ボム強化は著述に指定のある場合
// だけ書く。
export const HBOMB_HEAVY_TOTAL = (cycles) => (cycles || []).reduce(
  (n, cyc) => n + cyc.length, 0);

export function renMultiplierFromCycles(cycles) {
  let ren = 0;
  for (const cyc of cycles || []) {
    ren = 0.1 + ren + cyc.reduce((a, b) => a + b, 0);
    if (ren > 50) ren = 50;
  }
  return ren;
}

export function simultaneousFactor(bombCount) {
  if (!bombCount || bombCount <= 1) return 1;
  return Math.round((1 + 0.1 * bombCount) * 10) / 10;
}

export const HBOMB_CALIBRATION = {
  アスモデウス: {
    turnText: '3ターン（基本形）',
    cycles: [[6, 4, 3.25], [3.25, 3]],
    simulBombs: 2,
    note: '倍率20前後まで練った錬ボムに、速ボムを足す形が攻略情報の形',
  },
  セーバーグランド: {
    turnText: '3ターン（基本形）',
    cycles: [[6, 4, 3.25], [6, 4], [3.25, 3]],
    simulBombs: 2,
    note: 'ウェパルBの重から錬成する形。攻略情報では25〜30倍でボスも倒しきれるとされる',
  },
  ゴウギ: {
    turnText: '3ターン（基本形）',
    cycles: [[6, 4, 3.25], [6, 4], [6, 3.25], [6, 4], [6, 3.25]],
    simulBombs: 2,
    note: '錬成できるのはリヴァイアサン、アイムR、ジニマルR、ウァプラR（専用霊宝）。攻略情報では最大50倍で基礎約26万とされる',
  },
  マモン: {
    turnText: '3ターン（基本形）',
    cycles: [[6, 4, 3.25], [3]],
    simulBombs: 2,
    note: 'メイン版ベリーハードのHP52560に対して錬ボム約16倍、という攻略情報の値',
  },
  デメタス: {
    turnText: '3ターン（基本形）',
    cycles: null,
    simulBombs: 2,
    note: '18万級のダメージまで練れば、カガニンの自動回復を無視でき、タントンの反撃も受けにくい（攻略情報）',
  },
  ロクス: {
    turnText: 'シフト3以降',
    cycles: null,
    simulBombs: null,
    note: '高倍率のハイドロボム錬を、シフト3以降で起爆させる（攻略情報）',
  },
  執行者ラミアン: {
    turnText: '3ターン（基本形）',
    cycles: null,
    simulBombs: 5,
    note: 'かばうと回復を無視して、5体まとめて処理する形が攻略情報の理想',
  },
  グリードベア: {
    turnText: '3ターン（基本形）',
    cycles: null,
    simulBombs: 2,
    note: '2体を同時に倒せば、死亡時効果を無視できる（攻略情報）',
  },
  愛玩幻獣アイニャ: {
    turnText: '3ターン（基本形）',
    cycles: null,
    simulBombs: null,
    note: 'かばうを無視して付けられ、ダメージに攻撃力が影響しないことが要点（攻略情報の主軸）',
  },
  契りのドゥーエ: {
    turnText: '3ターン（基本形）',
    cycles: null,
    simulBombs: null,
    note: '残った2体（終りのトロワ・断りのアインツ）への選択肢として、錬ボムでも可（攻略情報）',
  },
};

// 敵1種の著述の目安そのもの（プランナーの初期状態の材料）。
export function hbombCalibrationOf(enemyName) {
  return HBOMB_CALIBRATION[enemyName] || null;
}

// 敵1種の目安の行。著述に目安を用意していない敵には出さない。
export function hbombCalibrationLines(enemyName) {
  const cal = HBOMB_CALIBRATION[enemyName];
  if (!cal) return [];
  const lines = [`ハイドロボムの目安: 起爆は${cal.turnText}`];
  if (cal.cycles) {
    const ren = renMultiplierFromCycles(cal.cycles);
    const renText = ren >= 49.5 ? '上限の50倍' : `約${Math.round(ren)}倍`;
    lines.push(`重を${HBOMB_HEAVY_TOTAL(cal.cycles)}回畳んで、錬の倍率を${renText}まで上げる`);
  }
  if (cal.simulBombs) {
    lines.push(`同じターンに弾けるボムが${cal.simulBombs}個で、同時爆破補正は×${simultaneousFactor(cal.simulBombs)}`);
  }
  if (cal.note) lines.push(cal.note);
  return lines;
}

// M4 の敵1種への注記。材料は、その敵の導出の脅威、その敵自身の
// 能力文、著述の脅威文・戦術文。著述の側に寄せる決めに従い、
// 狂炎は著述の戦術に載る場合だけ出す。
// input: { enemyName, threatIds: [], factTexts: string,
//          authoredThreatTexts: string, authoredTacticTexts: string }
export function enemyMechanicNotes(input) {
  const lines = [];
  const threatIds = input.threatIds || [];
  const factTexts = input.factTexts || '';
  const threatTexts = input.authoredThreatTexts || '';
  const tacticTexts = input.authoredTacticTexts || '';
  if (threatIds.includes('ailment:煉獄の炎')
    || threatTexts.includes('煉獄の炎')
    || factTexts.includes('煉獄の炎')) {
    lines.push('煉獄の炎は永続で、ターンごとに増える割合ダメージ');
  }
  // 消費順の注記は「回数バリア」そのものが対象の時だけ（通常の
  // バリアへの言及にまで広げると、敵の文脈でない所にも出てしまう）。
  if (threatIds.includes('tactic:barrier') || threatTexts.includes('回数バリア')) {
    lines.push('無敵で防いでも、バリアは減る');
  }
  if (tacticTexts.includes('狂炎')) {
    lines.push('狂炎は、殴るほど育つ地形');
  }
  if (input.enemyName === 'ジニマル'
    || factTexts.includes('ハイドロアンカー')
    || threatTexts.includes('ハイドロアンカー')
    || tacticTexts.includes('ハイドロアンカー')) {
    lines.push('ハイドロアンカー: ボムが消えても能力低下は残る');
  }
  return lines;
}

// ---- 編成時のメギド側の数（2026-11-20） ----
// 点穴・エレキ・破断・剛剣・割合軽減について、敵側の必要数（M4）
// だけでなく「編成する側の数」を出す（ユーザー確定: 敵側と重なって
// よく、目的は編成中に「ここでも使える」を発見すること）。
// 計算の前提は各所に明示する: 味方のステータスは基礎（星6）と
// 霊宝の固定値まで（オーブや特性の割合補正・コンディションは
// 数えない）。Lv は点穴・エレキと同じく星6の標準の70。

// 系譜のレベル: 装備中の同系譜ポイントの合計が10以上でLv1、
// 20以上でLv2。ポイントは霊宝マスタの lineagePoints（corpus-
// reishou の各レコードが正本）。
export function lineageLevel(totalPoints) {
  if (typeof totalPoints !== 'number' || totalPoints < 10) return 0;
  return totalPoints >= 20 ? 2 : 1;
}

// 装備中の霊宝から、系譜の効果量を引くための材料。
// equipped: [{ lineage, lineagePoints }]（霊宝マスタの行）。
// 一心は点穴の上限への加算（Lv1: +20、Lv2: +40。_lineages.json）、
// 地裂は破断ダメージの上昇率（Lv1: +20%、Lv2: +40%）。
export function lineageBonusOf(equipped, lineageName) {
  let points = 0;
  let found = false;
  for (const r of equipped || []) {
    if (!r || r.lineage !== lineageName) continue;
    found = true;
    if (typeof r.lineagePoints === 'number') points += r.lineagePoints;
  }
  if (!found) return { level: 0, points: 0 };
  return { level: lineageLevel(points), points };
}

export function isshinCapBonus(equipped) {
  const { level } = lineageBonusOf(equipped, '一心');
  return level === 2 ? 40 : level === 1 ? 20 : 0;
}

export function chiretsuDamagePct(equipped) {
  const { level } = lineageBonusOf(equipped, '地裂');
  return level === 2 ? 40 : level === 1 ? 20 : 0;
}

// 点穴の上限: 基本100。一心の加算と、個人の形を足す。
//   ベリアル: 専用霊宝で +20（点穴の正本）。
//   コルソンR: おかえし中は上限が +100 される（200。おねだり・
//     おかえしの正本）。通常時の上限とは別に okaeriCap で返す。
export function tenanaCaps({ megidoId, isshinBonus = 0, specialReishouOwned = false }) {
  let cap = 100 + isshinBonus;
  if (megidoId === '祖68_ベリアル' && specialReishouOwned) cap += 20;
  const okaeriCap = megidoId === '真11_コルソンR' ? 200 + isshinBonus : null;
  return { cap, okaeriCap };
}

// 固定砲台の連射列（ベリアル）。砲台中は全ての行動が結晶矢
// （単体・単発）になり、1発ごとに点穴を10だけ消費し、その時点の
// 点穴でダメージを計算する（固定砲台・点穴の正本）。開始点数から
// maxShots 発ぶんの列と合計、残り点数を返す。
// 正本の検算例: Lv70・140点から6発で
// 39200+33800+28800+24200+20000+16200 = 162200。
export function belialTurretSequence(startPoints, lv = SYSTEM_BASE_LEVEL, maxShots = 6) {
  const shots = [];
  let points = startPoints;
  let total = 0;
  while (points > 0 && shots.length < maxShots) {
    const damage = tenanaDamage(points, lv);
    shots.push({ points, damage });
    total += damage;
    points -= 10;
  }
  return { shots, total, remaining: Math.max(0, points) };
}

// 点穴の保持者への行（ピッカー）。上限と、上限まで溜めた1発の
// 大きさを出す。形が個人で違う者は、その形の数も足す:
//   コルソンR: おかえしの上限と1発。
//   ベリアル: 連射型。砲台からの連射が基本形のため、上限からの
//     連射列（各発の点数とダメージ、合計）で出す（2026-11-20
//     ユーザー訂正。連射回数はフォトン運ではなく点数の消費で
//     決まる）。長さは正本の検算例の範囲（6発）に収める。
//   レラジェR: 75点で撃つ形の1発。
export function tenanaHolderLines({ megidoId, isshinBonus = 0, specialReishouOwned = false, lv = SYSTEM_BASE_LEVEL }) {
  const { cap, okaeriCap } = tenanaCaps({ megidoId, isshinBonus, specialReishouOwned });
  const bonusText = isshinBonus > 0 ? `（系譜「一心」で+${isshinBonus}）` : '';
  const lines = [`点穴: 上限は${cap}点${bonusText}。上限まで溜めると1発で${tenanaDamage(cap, lv)}（Lv${lv}で計算）`];
  if (okaeriCap !== null) {
    lines.push(`おかえし中は上限が${okaeriCap}点になり、1発で${tenanaDamage(okaeriCap, lv)}`);
  }
  if (megidoId === '祖68_ベリアル') {
    const seq = belialTurretSequence(cap, lv);
    const seqText = seq.shots.map((s) => `${s.points}点→${s.damage}`).join('、');
    lines.push(`固定砲台の連射: ${seqText}。${seq.shots.length}発で合計${seq.total}（残り${seq.remaining}点）`);
  }
  if (megidoId === '祖14_レラジェR') {
    lines.push(`75点まで溜めて撃つと${tenanaDamage(75, lv)}`);
  }
  return lines;
}

// エレキの付与者への行（ピッカー）。解除ダメージは最初の付与者の
// Lvで決まるため、付与者側の数を出す。
export function erekiApplierLines(lv = SYSTEM_BASE_LEVEL) {
  return [`エレキ: 解除ダメージは、最初に付けた側のLv×20×レベル。Lv${lv}なら1レベルで${erekiReleaseDamage(1, lv)}、最大50レベルで${erekiReleaseDamage(50, lv)}`];
}

const EREKI_KIND_LABEL = { skill: 'スキル', awakenedSkill: '覚醒スキル', ougi: '奥義' };

// エレキを育てる役への行（ピッカー）。grower は生成データ
// erekiGrowers の記録（{ kind, min, max, needsReishou }）。
export function erekiGrowerLine(grower) {
  if (!grower) return null;
  const hits = grower.min === grower.max ? `${grower.max}回` : `${grower.min}〜${grower.max}回`;
  const kind = grower.kind ? `${EREKI_KIND_LABEL[grower.kind] || ''}で` : '';
  const reishou = grower.needsReishou ? '（専用霊宝）' : '';
  return `エレキを育てる雷: ${kind}${hits}当たる${reishou}`;
}

// オーブの育て役への行（オーブピッカーの効果文へ足す）。
export function erekiGrowerOrbLine(grower) {
  if (!grower) return null;
  const hits = grower.min === grower.max ? `${grower.max}回` : `${grower.min}〜${grower.max}回`;
  return `エレキを育てる雷: ${hits}当たる`;
}

// ---- 破断と地割れ（2026-11-20） ----
// 正本（corpus-elements/地割れ.json）: 地割れは防御力を50%低下
// させ、破断攻撃のダメージ補正(%) = 100 + log2(敵防御/750)×20
// （敵防御は地割れ後の値。補正が50未満なら50）。目安との照合:
// 地割れ前 265以下 → ×1.5、1500 → ×2.0、5000 → ×2.35（約2.4）。
export function hadanFactor(defAfterJiware) {
  if (typeof defAfterJiware !== 'number' || defAfterJiware <= 0) return 1.5;
  const pct = 100 + 20 * Math.log2(defAfterJiware / 750);
  return 1 + Math.max(50, pct) / 100;
}

// クラス補正（ダメージ計算の正本）: ファイターは敵前列に1.25倍、
// トルーパーは敵後列に1.5倍、スナイパーは敵前列に1.25倍。
export function classFactorFor(attackerClass, targetRow) {
  if (attackerClass === 'ファイター') return targetRow === 'front' ? 1.25 : 1;
  if (attackerClass === 'トルーパー') return targetRow === 'back' ? 1.5 : 1;
  if (attackerClass === 'スナイパー') return targetRow === 'front' ? 1.25 : 1;
  return 1;
}

// 破断1発の推定。基礎 = 攻撃力×倍率 − 地割れ後の防御（半減）。
// 敵の列はクラスで決まる（スナイパーは後列、それ以外は前列。
// 狂炎シミュレーターの直接ダメージと同じ規則）。基礎が0以下なら
// 原則1点（ダメージ計算の正本）で、届かない印を返す。
export function hadanDamage({ atk, mult, attackerClass, enemyDef, enemyClassName, chiretsuPct = 0 }) {
  const defAfter = Math.floor((typeof enemyDef === 'number' ? enemyDef : 0) / 2);
  const factor = hadanFactor(defAfter);
  const base = atk * mult - defAfter;
  if (base <= 0) return { defAfter, factor, damage: 1, blocked: true };
  const targetRow = enemyClassName === 'スナイパー' ? 'back' : 'front';
  const damage = Math.floor(base * classFactorFor(attackerClass, targetRow)
    * factor * (1 + chiretsuPct / 100));
  return { defAfter, factor, damage, blocked: false };
}

// ---- 剛剣（2026-11-20） ----
// ブネの専用霊宝の状態: 1回だけ、フォトンによる攻撃にダメージ
// +200%・防御貫通・ダメージ軽減無効（用語集とダメージ計算の
// 正本）。バフなしの到達点は、最も大きい単発の倍率（生成データ
// goukenReach）で出す。到達点 = 攻撃力 × 倍率 × 3.0（防御は
// 貫通するため引かない。クラス補正と奥義レベルは数えない）。
export function goukenDamage(atk, mult) {
  return Math.floor(atk * mult * 3);
}

export function goukenLines({ atk, reach }) {
  if (!reach || typeof atk !== 'number') return [];
  const kind = EREKI_KIND_LABEL[reach.kind] || '攻撃';
  return [`剛剣: 剛剣中の${kind}（${reach.mult}倍）は、バフなしで約${goukenDamage(atk, reach.mult)}。防御を貫通し、軽減も無効化する（クラス補正と奥義レベルは数えていません）`];
}

// ---- 割合軽減の「受ける量」（2026-11-20） ----
// 敵の攻撃の1発分の見積もり。材料は敵パーティ各員のスキル・
// 覚醒スキル・奥義の文面（M4の受け方注記と同じ機械読み）で、
// 1発分 = 敵の攻撃力（マスルール適用後）× 倍率 − 受け手の防御。
// 防御無視の攻撃は防御を引かない。地形・継続ダメージの文節と、
// 倍率の読めない文節は数えない。通常攻撃は文面の材料が無いため
// 数えない（前提として表示側で明示する）。
export function enemyAttackEstimates(fact, mults, targetDef) {
  if (!fact || !Array.isArray(fact.party)) return [];
  const atkMult = mults && typeof mults.atk === 'number' ? mults.atk : 1;
  const out = [];
  for (const m of fact.party.filter(Boolean)) {
    if (typeof m.atk !== 'number') continue;
    const atk = Math.floor(m.atk * atkMult);
    const skills = m.skills || {};
    const perHits = [];
    for (const kind of ['skill', 'awakened', 'ultimate']) {
      const txt = skills[kind];
      if (!txt) continue;
      for (const seg of String(txt).split(/[。／]/)) {
        if (!seg.includes('ダメージ')) continue;
        if (/地形|継続ダメージ/.test(seg)) continue;
        const multM = seg.match(/攻撃力([\d.]+)倍/) || seg.match(/([\d.]+)倍のダメージ/);
        if (!multM) continue;
        const mult = parseFloat(multM[1]);
        const hitsM = seg.match(/(\d+)連続/) || seg.match(/(\d+)連撃/);
        const hits = hitsM ? parseInt(hitsM[1], 10) : 1;
        const def = /防御無視/.test(seg) ? 0 : (typeof targetDef === 'number' ? targetDef : 0);
        const perHit = Math.max(1, Math.floor(atk * mult - def));
        perHits.push({ kind, mult, hits, perHit });
      }
    }
    if (perHits.length === 0) continue;
    const values = perHits.map((h) => h.perHit);
    out.push({
      name: m.name,
      perHits,
      minPerHit: Math.min(...values),
      maxPerHit: Math.max(...values),
    });
  }
  return out;
}

// アスモデウスRの第2特性: 最大HPの20%以下のダメージを無効化
// （専用霊宝以外の霊宝を4つ装備している時。corpus 原文）。
export function asmodeusThreshold(maxHp) {
  return Math.floor(maxHp * 0.2);
}

// ---- 霊宝4つ装備が条件の第2特性（未検証の仕組み 候補2、2026-11-20
// 実装決定） ----
// 対象は7体（八魔星の第2特性）。文面は正本（能力原文）で確認した:
//   リリス「狭間の干渉者」: 専用霊宝を除く霊宝を4つ装備している場合
//   バールベリト「ド真面目ギャップ」／エウリノーム「父性の体現者」／
//   ベルゼブフ「超克、起死回生」／サタン「８魔星の二大巨頭」／
//   モレク「「力」の８魔星」: 専用霊宝や絆霊宝を除く霊宝を4つ装備
//   アスモデウスR「強固なる不遜」: 専用霊宝以外の霊宝を4つ装備
// このツールの装備モデルでは、通常霊宝はメギドの装備（最大4・重複可）
// として持ち、専用霊宝と絆霊宝は別の所持管理になっている。霊宝マスタ
// に専用霊宝は含まれないため、文面の3種の言い回しはすべて
// 「通常霊宝が4つ装備されている」と一致する。
// 判定は2段: 凸が4以上（第2特性の解禁）かつ装備が4つ。
export const REISHOU4_TRAITS = {
  '宵01_リリス': '狭間の干渉者',
  '宵02_バールベリト': 'ド真面目ギャップ',
  '宵03_エウリノーム': '父性の体現者',
  '宵04_ベルゼブフ': '超克、起死回生',
  '宵05_サタン': '８魔星の二大巨頭',
  '宵06_モレク': '「力」の８魔星',
  '祖32_アスモデウスR': '強固なる不遜',
};

export function reishou4TraitName(megidoId) {
  return REISHOU4_TRAITS[megidoId] || null;
}

// 発動中か: 対象の特性を持ち、凸が解禁（4以上）で、通常霊宝が
// 4つ装備されている時だけ true。
export function reishou4Active(megidoId, level, equippedCount) {
  if (!REISHOU4_TRAITS[megidoId]) return false;
  return level >= 4 && equippedCount === 4;
}

// 伝説のオーラのダメージブロック: 1個で最大HPの2%までの
// ダメージを0にする（伝説のオーラ・ダメージブロックの正本）。
// 累積の上限は20個（オーラ共通ルール）。
export const DENSETSU_MAX = 20;
export function densetsuThreshold(maxHp, count) {
  return Math.floor((maxHp * 2 * count) / 100);
}

// この1発を無効化するのに要る伝説の個数（上限を超える場合は
// そのまま大きな数を返し、届かない判定は表示側で行う）。
export function densetsuNeeded(maxHp, damage) {
  if (typeof maxHp !== 'number' || maxHp <= 0 || typeof damage !== 'number') return null;
  return Math.ceil((damage * 100) / (maxHp * 2));
}

// ---- 受けダメージの見積もり（積4、2026-11-20 実装決定） ----
// 敵の攻撃を味方が素で受けた時に「落ちる味方」がいるかを、戦闘の
// 前に見積もる。計算はダメージ計算の正本（corpus-status/
// ダメージ計算.json）: 基礎 = 敵の攻撃力×技倍率 − 味方の防御、
// 補正はすべて乗算（クラス補正・組み合わせの補正・軽減補正）。
// 乱数は平均で固定（補正1）。戦闘中に出る強化・弱体は含めない。
// かばうは含めない（単体・ランダムは全員が対象になりうるものと
// して判定する）。材料は敵パーティ各員のスキル・覚醒スキル・
// 奥義の文面（enemyAttackEstimates と同じ機械読み）で、通常攻撃
// は文面の材料が無いため数えない。倍率が文面で固定できない攻撃
// （HPで威力の変わる類）も数えない。
// 軽減は編成時点で固定のものだけ: 特性とオーブは生成データ
// （damage-reduction.v1.json、無条件の分だけを抽出済み）、ME は
// meDamageReductions が枠効果の文面から実行時に読む。軽減補正は
// 正本どおり全て乗算し、基礎が0以下なら1点、軽減で0にはしない。

export const ENEMY_ATTACK_KIND_LABEL = { skill: 'スキル', awakened: '覚醒スキル', ultimate: '奥義' };

// コンディションのステータス補正（要件の正本）: 絶好調は
// HP+15%・防御+25%、不調は戦闘開始時のHPが50%、絶不調は25%。
// stage は CONDITION_STAGES の添字（0=絶好調、3=不調、4=絶不調、
// 5=気絶。気絶は戦えないため呼び出し側で外す）。
export function conditionAdjustedStats(stats, stage) {
  if (!stats) return null;
  let { hp, def } = stats;
  if (stage === 0) {
    hp = Math.floor(hp * 1.15);
    def = Math.floor(def * 1.25);
  } else if (stage === 3) {
    hp = Math.floor(hp * 0.5);
  } else if (stage === 4) {
    hp = Math.floor(hp * 0.25);
  }
  return { hp, def };
}

// 状態の名前（組み合わせ条件の照合用。「○状態」の形で文面に
// 現れるものだけを数える）。
const COMBO_STATE_NAMES = [
  '毒', 'めまい', '束縛', '混乱', '睡眠', '感電', '呪い', '病気',
  '凍結', '石化', 'ゾンビ', '暗闇', '煉獄の炎',
];

// 敵パーティの文面から、見積もりに使う攻撃の一覧を組み立てる。
// 組み合わせ（地形・状態・チェイン数・戦闘不能時）は、要素が
// 同じパーティに揃っている時だけ補正・条件を付ける:
//   - 地形: 「対象の位置に○○地形が存在する場合、ダメージがN倍」
//     の節が直前の攻撃に続き、パーティの誰かがその地形を置ける。
//   - 状態: 「敵が○状態の場合、ダメージがN倍」の節が直前の
//     攻撃に続き、パーティの誰かがその状態を付けられる。
//   - チェイン数: 【ChN】の形は、パーティにチェインの手段が
//     ある時だけ、条件つきの形として数える。
//   - 戦闘不能時: 「戦闘不能時、…ダメージ」は条件つきで数える。
// 防御力依存の攻撃（防御力N倍）は、攻撃力の代わりに防御力を
// 材料にする（ダメージ計算の正本「ステータス依存」）。
export function parseEnemyAttackList(fact, mults) {
  if (!fact || !Array.isArray(fact.party)) return [];
  const atkMult = mults && typeof mults.atk === 'number' ? mults.atk : 1;
  const defMult = mults && typeof mults.def === 'number' ? mults.def : 1;
  const party = fact.party.filter(Boolean);
  const allTexts = [];
  for (const m of party) {
    if (m.trait) allTexts.push(String(m.trait));
    const skills = m.skills || {};
    for (const kind of ['skill', 'awakened', 'ultimate']) {
      if (skills[kind]) allTexts.push(String(skills[kind]));
    }
  }
  const placedTerrains = new Set();
  for (const t of allTexts) {
    for (const mm of t.matchAll(/([一-龯ァ-ヶー・]{1,10})の地形効果/g)) placedTerrains.add(mm[1]);
    if (/炎上地形を/.test(t)) placedTerrains.add('炎上');
  }
  // 狂炎は炎上地形を変換して作る（炎上を置ける手と変換の手が
  // 揃っている時だけ置けるものとして数える）。
  if (placedTerrains.has('炎上') && allTexts.some((t) => /狂炎地形にする/.test(t))) {
    placedTerrains.add('狂炎');
  }
  const inflictedStates = new Set();
  for (const t of allTexts) {
    for (const seg of t.split(/[。／]/)) {
      // 組み合わせの参照文（「○状態の場合」「○状態の敵」）は、
      // その状態を付けられることの根拠にはならない。
      if (/状態の場合|状態の敵|ダメージが[\d.]+倍/.test(seg)) continue;
      for (const s of COMBO_STATE_NAMES) {
        if (seg.includes(`${s}状態`)) inflictedStates.add(s);
      }
    }
  }
  const partyHasChain = allTexts.some((t) => /チェインする|にチェイン|チェインし/.test(t));

  const attacks = [];
  for (const m of party) {
    const skills = m.skills || {};
    for (const kind of ['skill', 'awakened', 'ultimate']) {
      const txt = skills[kind];
      if (!txt) continue;
      const text = String(txt);
      const nameM = text.match(/^「([^」]+)」/) || text.match(/^([^：:]{1,24})[：:]/);
      const skillName = nameM ? nameM[1] : null;
      let lastAttack = null;
      // レベル段階のある能力（「Lv1: …／Lv2: …」と1つの原文に
      // 段違いが同居する形）は、文節の頭の Lv をその段の攻撃の
      // 区別として記録する（値の計算には使わない）。
      let lvStage = null;
      // 【ChN】の形は文節の途中から始まるため、先に切り分ける。
      const segments = [];
      for (const piece of text.split(/[。／]/)) {
        for (const sub of piece.split(/(?=【Ch\d+】)/)) {
          if (sub) segments.push(sub);
        }
      }
      for (const seg of segments) {
        const lvM = seg.match(/^\s*Lv(\d+)\s*[:：]/);
        if (lvM) lvStage = parseInt(lvM[1], 10);
        // 組み合わせの倍率節（直前の攻撃に付く）。
        const comboM = seg.match(/対象の位置に(.+?)地形が存在する場合、ダメージが([\d.]+)倍/)
          || seg.match(/敵が(.+?)状態の場合、ダメージが([\d.]+)倍/);
        if (comboM && lastAttack
          && !/攻撃力[\d.]+倍|[\d.]+倍のダメージ|防御力[\d.]+倍/.test(seg)) {
          if (seg.includes('地形が存在する場合')) {
            const names = comboM[1].split('・');
            if (names.some((n) => placedTerrains.has(n))) {
              lastAttack.comboFactor = parseFloat(comboM[2]);
              lastAttack.conditionNote = `${names.join('・')}地形がある時`;
            }
          } else if (inflictedStates.has(comboM[1])) {
            lastAttack.comboFactor = parseFloat(comboM[2]);
            lastAttack.conditionNote = `${comboM[1]}状態の時`;
          }
          continue;
        }
        if (/地形|継続ダメージ/.test(seg)) continue;
        // 味方を対象にする文節（自分たちの側への攻撃）は、受ける
        // 側の見積もりには入れない。
        if (/味方(単体|全体|前列|後列)に[^。／]*ダメージ/.test(seg)
          && !/敵(単体|全体|一列|横一列)/.test(seg)) continue;
        // 範囲の読み: 「前列の覚醒ゲージ」のような言い回しの
        // 「列の」で列攻撃と誤読しないよう、単体が明記され一列の
        // 言い回しが無い文節は単体を優先する。
        const range = /ランダム|無作為/.test(seg) ? 'random'
          : /全体/.test(seg) ? 'all'
          : /単体/.test(seg) && !/一列|横一列/.test(seg) ? 'single'
          : /一列|列に|列の/.test(seg) ? 'row'
          : /単体/.test(seg) ? 'single' : null;
        if (!range) continue;
        let statKey = 'atk';
        let mult = null;
        const defM = seg.match(/防御力([\d.]+)倍/);
        const atkM = seg.match(/攻撃力([\d.]+)倍/) || seg.match(/([\d.]+)倍のダメージ/);
        if (defM && seg.includes('ダメージ') && !atkM) {
          statKey = 'def';
          mult = parseFloat(defM[1]);
        } else if (atkM) {
          mult = parseFloat(atkM[1]);
        }
        if (mult === null) continue;
        const chM = seg.match(/【Ch(\d+)】/);
        if (chM && !partyHasChain) continue;
        const hitsM = seg.match(/(\d+)連続/) || seg.match(/(\d+)連撃/);
        const attack = {
          attackerName: m.name,
          attackerClass: m.class || null,
          attackerRace: Array.isArray(m.race) ? m.race : [],
          statKey,
          stat: Math.floor((statKey === 'def'
            ? (typeof m.def === 'number' ? m.def : 0)
            : (typeof m.atk === 'number' ? m.atk : 0)) * (statKey === 'def' ? defMult : atkMult)),
          kind,
          skillName,
          range,
          mult,
          hits: hitsM ? parseInt(hitsM[1], 10) : 1,
          ignoreDef: /防御無視/.test(seg),
          element: /火ダメージ/.test(seg) ? '火' : /雷ダメージ/.test(seg) ? '雷' : null,
          frontRow: /前列/.test(seg),
          backRow: /後列/.test(seg),
          comboFactor: 1,
          conditionNote: null,
          lvStage,
        };
        if (chM) attack.conditionNote = `チェイン数が${chM[1]}以上の時`;
        if (/戦闘不能時/.test(seg)) attack.conditionNote = '戦闘不能になった時';
        attacks.push(attack);
        lastAttack = attack;
      }
    }
  }
  return attacks;
}

// ME の枠効果から、そのメンバーに効く編成時固定の軽減を読む。
// 実効素早さの ME 補正（speed.js の meSpeedPct）と同じ歩き方:
// 枠の効果のうち、条件がそのメンバーに合う（match）ものだけ。
// 文全体が無条件の軽減だけを数える（全快時・大協奏中などの
// 状態つき、「ほど」系、状態の敵から・地形がある敵から等は、
// 文の形が一致しないため自然に外れる）。種族の範囲は、攻撃側の
// 種族と突き合わせて初めて効く（男性から等、種族でない範囲は
// 敵の種族に一致しないため効かない）。
export function meDamageReductions(me, member, slotIndex) {
  if (!me || !me.slots || !member) return [];
  const entries = me.slots[ME_SLOT_KEYS[slotIndex]];
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const e of entries) {
    if (!e || typeof e.effect !== 'string') continue;
    if (meConditionVerdict(e.condition || '', member) !== 'match') continue;
    const effect = e.effect.replace(/％/g, '%').trim();
    let m = effect.match(/^受けるダメージを(\d+)%軽減する。?$/) || effect.match(/^受けるダメージを(\d+)%軽減。?$/);
    if (m) {
      out.push({ pct: parseInt(m[1], 10), scope: 'all' });
      continue;
    }
    m = effect.match(/^受ける(火|雷)ダメージを(\d+)%軽減する。?$/);
    if (m) {
      out.push({ pct: parseInt(m[2], 10), element: m[1] });
      continue;
    }
    m = effect.match(/^([一-龯ァ-ヶー]{1,10})モンスターからのダメージを(\d+)%軽減する。?$/)
      || effect.match(/^([一-龯ァ-ヶー]{1,10})からのダメージを(\d+)%軽減する。?$/);
    if (m) out.push({ pct: parseInt(m[2], 10), race: m[1].replace(/系$/, '') });
  }
  return out;
}

// 軽減の合成（正本: 軽減補正は全て乗算）。範囲が攻撃に合う
// 軽減だけを掛ける。reductions の各要素は生成データと
// meDamageReductions の共通の形: { pct, scope:'all' } |
// { pct, kind } | { pct, element } | { pct, race }。
export function damageReductionFactor(reductions, attack) {
  let factor = 1;
  for (const r of reductions || []) {
    const hit = r.scope === 'all'
      || (r.kind && attack.kind === r.kind)
      || (r.element && attack.element === r.element)
      || (r.race && (attack.attackerRace || []).includes(r.race));
    if (hit) factor *= 1 - r.pct / 100;
  }
  return factor;
}

// 落ちる味方の見積もり。allies は表示側が組み立てた受け手:
// { id, name, hp, def, row: 'front'|'back', reductions }。
// hp はコンディション補正後の戦闘開始時のHP、def は補正後の
// 防御。戻り値: { attacksRead, falls: [{ allyId, allyName, hp,
// hits: [{ attackerName, kind, kindLabel, skillName, total,
// hits, conditionNote }] }], closest }（落ちる味方だけ、味方の並び順）。
// closest は「落ちるのに一番近い」攻撃と受け手の組（被ダメージの
// HP 比が最大のもの）で、落ちる味方がいない場合に「どの行動への
// 見積もりで、なぜ耐えるのか」を表示側が出すための材料。攻撃が
// 誰にも届かない場合は null。
export function estimateFalls({ fact, mults, allies }) {
  const attacks = parseEnemyAttackList(fact, mults);
  const byAlly = new Map();
  let closest = null;
  let closestRatio = -1;
  for (const attack of attacks) {
    for (const ally of allies || []) {
      const targeted = attack.range === 'all' || attack.range === 'single' || attack.range === 'random'
        || (attack.range === 'row'
          && ((attack.frontRow && ally.row === 'front')
            || (attack.backRow && ally.row === 'back')
            || (!attack.frontRow && !attack.backRow)));
      if (!targeted) continue;
      const base = attack.stat * attack.mult - (attack.ignoreDef ? 0 : ally.def);
      const perHit = base <= 0 ? 1
        : Math.max(1, Math.floor(Math.floor(base)
          * classFactorFor(attack.attackerClass, ally.row)
          * attack.comboFactor
          * damageReductionFactor(ally.reductions, attack)));
      const total = perHit * attack.hits;
      const ratio = ally.hp > 0 ? total / ally.hp : 0;
      if (ratio > closestRatio || (ratio === closestRatio && closest && total > closest.total)) {
        closestRatio = ratio;
        closest = {
          attackerName: attack.attackerName,
          kind: attack.kind,
          kindLabel: ENEMY_ATTACK_KIND_LABEL[attack.kind] || '攻撃',
          skillName: attack.skillName,
          total,
          hits: attack.hits,
          conditionNote: attack.conditionNote,
          allyName: ally.name,
          allyHp: ally.hp,
        };
      }
      if (total < ally.hp) continue;
      if (!byAlly.has(ally.id)) {
        byAlly.set(ally.id, { allyId: ally.id, allyName: ally.name, hp: ally.hp, hits: [] });
      }
      // 同じ取り巻きが複数いる編成では同じ攻撃が人数分並ぶ。
      // 見積もりの行は代表の1件で足りるため、同一の行は重ねない。
      const entry = byAlly.get(ally.id);
      const dup = entry.hits.some((h) => h.attackerName === attack.attackerName
        && h.kind === attack.kind && h.skillName === attack.skillName
        && h.total === total && h.conditionNote === attack.conditionNote);
      if (dup) continue;
      entry.hits.push({
        attackerName: attack.attackerName,
        kind: attack.kind,
        kindLabel: ENEMY_ATTACK_KIND_LABEL[attack.kind] || '攻撃',
        skillName: attack.skillName,
        total,
        hits: attack.hits,
        conditionNote: attack.conditionNote,
      });
    }
  }
  const falls = [];
  for (const ally of allies || []) {
    const f = byAlly.get(ally.id);
    if (!f) continue;
    f.hits.sort((a, b) => b.total - a.total);
    falls.push(f);
  }
  return { attacksRead: attacks.length > 0, falls, closest };
}

// ---- 攻撃の見積もり（A5 改訂、2026-11-26） ----
// そのマスに置いた編成の味方が、そのマスの敵にどれだけ通るかを
// 見積もる（受けダメージの見積もり estimateFalls の対）。計算は
// ダメージ計算の正本: 基礎 = 攻撃力 × 技倍率 − 敵防御、補正は
// すべて乗算（クラス補正・組み合わせ補正・特効補正）。乱数は平均
// で固定。戦闘中に出る強化・弱体は含めない。
// 材料は味方の能力原文（スキル・覚醒スキル・奥義）で、倍率の
// 機械読みは parseEnemyAttackList と同じものを使う（呼び出し側が
// 味方を敵パーティと同じ形に組んで渡す）。通常攻撃は文面の材料
// が無いため数えない。倍率が文面で固定できない攻撃も数えない。
// 特効は編成時点で固定のものだけ: 本人の特性・装備オーブの特性・
// リーダーの ME の枠効果（手段索引の bonus:race / bonus:state の
// via のうち常時効く分）から、呼び出し側が係数化して渡す。種族
// 特効の同系統は加算（正本の特効補正の規則: 同系統は加算、別系統
// は乗算）。状態特効は、その状態を編成が付けられる時だけ、条件
// つきの行として分けて出す。

// 能力名の「形の位置」にある ＋ の連続数の最大（0/1/2）。
// counter.js の plusFormCount と同じ読み方（ラベルの末尾か注記の
// 直前に付く ＋ だけを形の印とする）。
export function abilityFormRank(name) {
  const runs = String(name || '').match(/[＋+]+(?=[」）\s（]|$)/g);
  if (!runs) return 0;
  return Math.max(...runs.map((r) => r.length));
}

// 能力1種（スキル等）の候補から、使う形を1件選ぶ。専用霊宝の形
// （名前に「専用霊宝」を含む）は選ばない。形の段位は maxRank まで
// （呼び出し側が凸から決める）。奥義の Lv 違い（名前に「 LvN」が
// 付く）は ougiLevel に一番近い段を選ぶ（届かない時は一番小さい
// 段）。戻り値は元の entry に displayName（Lv 表記を除いた名前）
// を付けたもの。候補が無ければ null。
export function pickAbilityForm(entries, { maxRank = 1, ougiLevel = null } = {}) {
  const usable = (entries || []).filter((e) => e && typeof e.name === 'string'
    && !e.name.includes('専用霊宝'));
  if (usable.length === 0) return null;
  const parsed = usable.map((e) => {
    const lvM = e.name.match(/ Lv(\d+)\s*$/);
    const base = lvM ? e.name.slice(0, lvM.index) : e.name;
    return { entry: e, base, lv: lvM ? parseInt(lvM[1], 10) : null, rank: abilityFormRank(base) };
  });
  const ranks = [...new Set(parsed.map((p) => p.rank))].filter((r) => r <= maxRank);
  if (ranks.length === 0) return null;
  const rank = Math.max(...ranks);
  const group = parsed.filter((p) => p.rank === rank);
  let chosen = group[0];
  if (group.some((p) => p.lv !== null) && typeof ougiLevel === 'number') {
    const withLv = group.filter((p) => p.lv !== null);
    const under = withLv.filter((p) => p.lv <= ougiLevel);
    chosen = under.length > 0
      ? under.reduce((a, b) => (b.lv > a.lv ? b : a))
      : withLv.reduce((a, b) => (b.lv < a.lv ? b : a));
  }
  return { ...chosen.entry, displayName: chosen.base };
}

// 味方1体の能力データから、見積もりに使う形の一式を選ぶ。
// 形の段位の上限（2026-11-26、マスター確認の事実で確定）:
// +形は全メギド共通で星の解禁（スキル+＝星4、覚醒スキル+＝
// 星5、奥義+＝星6）。標準状態は星6なので、通常は全員が +形
// まで使える。++形はシンギュラリティメギドだけに出るもので、
// 凸（再入手回数）と星の両方が条件になる: スキル++＝凸1以上、
// 覚醒スキル++＝凸2以上、奥義++＝凸3以上（星の条件は標準
// 状態で満たす）。シンギュラリティでない体に ++形は出ない。
// 第2特性もシンギュラリティの解放分（凸4以上）でのみ数える
// （組み合わせ補正の材料検出にだけ使う）。
// 戻り値: { skill, awakenedSkill, ougi, traitText }（形は
// pickAbilityForm の戻り値。無い種目は null）。
export function pickAbilityForms(ability, { singularity = false, singularityLevel = 0, ougiLevel = 3 } = {}) {
  const ab = ability || {};
  const lv = singularity ? singularityLevel : 0;
  const rankCap = (minLv) => (lv >= minLv ? 2 : 1);
  const traits = (ab.trait || []).filter((t) => t && typeof t.text === 'string'
    && !String(t.name || '').includes('専用霊宝')
    && (t.slot !== '第二特性' || (singularity && singularityLevel >= 4)));
  return {
    skill: pickAbilityForm(ab.skill, { maxRank: rankCap(1) }),
    awakenedSkill: pickAbilityForm(ab.awakenedSkill, { maxRank: rankCap(2) }),
    ougi: pickAbilityForm(ab.ougi, { maxRank: rankCap(3), ougiLevel }),
    traitText: traits.map((t) => t.text).join('。'),
  };
}

// 霊宝の装備数が条件の文面（「（専用霊宝や絆霊宝を除く）霊宝を
// Nつ装備している場合、…」）から、要る装備数を読む。条件の無い
// 文面では null。
export function reishouCountRequirement(sentence) {
  const m = String(sentence || '').match(/霊宝を(\d+)つ装備している/);
  return m ? parseInt(m[1], 10) : null;
}

// 特効の via の文面から、ダメージの係数を読む。読める形は4つ:
// 「…にN倍のダメージ」「ダメージがN倍になる」（倍率そのもの）、
// 「ダメージがN%上昇する」（割合）、オーブの「ダメージが
// N%(M%)上昇する」（最大強化時の M を使う。オーブは最大強化
// 前提で計算する既存の裁定と同じ）。
// 霊宝の装備数が条件の文面は、reishouCount（その味方の通常霊宝
// の装備数）が条件を満たす時だけ読む。専用霊宝と絆霊宝は別の
// 所持管理のため、この数には含まれない（文面の3種の言い回しは
// すべて「通常霊宝がNつ」と一致する。霊宝4つ装備の第2特性の
// 判定 reishou4Active と同じ数え方）。装備数が分からない・
// 足りない場合は読まない（過大に見積もらない側に倒す）。
// 読めなければ null（推測で埋めない）。
export function tokkoFactorFromSentence(sentence, reishouCount) {
  const s = String(sentence || '').replace(/％/g, '%');
  const req = reishouCountRequirement(s);
  if (req !== null && (typeof reishouCount !== 'number' || reishouCount < req)) return null;
  let m = s.match(/ダメージが([\d.]+)%\(([\d.]+)%\)上昇/);
  if (m) return 1 + parseFloat(m[2]) / 100;
  m = s.match(/ダメージが([\d.]+)%上昇/);
  if (m) return 1 + parseFloat(m[1]) / 100;
  m = s.match(/([\d.]+)倍のダメージ/);
  if (m) return parseFloat(m[1]);
  m = s.match(/ダメージが([\d.]+)倍になる/);
  if (m) return parseFloat(m[1]);
  return null;
}

// 与えられた文面の集まりが付けられる状態異常の集合。
// parseEnemyAttackList の組み合わせ検出と同じ読み方（組み合わせ
// の参照文は根拠にしない）。
export function inflictableStates(texts) {
  const out = new Set();
  for (const t of texts || []) {
    if (!t) continue;
    for (const seg of String(t).split(/[。／]/)) {
      if (/状態の場合|状態の敵|ダメージが[\d.]+倍/.test(seg)) continue;
      for (const s of COMBO_STATE_NAMES) {
        if (seg.includes(`${s}状態`)) out.add(s);
      }
    }
  }
  return out;
}

// 攻撃の見積もり本体。fact は敵の事実（party に防御・HP・
// クラス・種族を持つ敵が並ぶ）、mults はマスのルール倍率。
// allies は表示側が組み立てた攻撃側: { id, name, className,
// attacks, raceTokko, stateTokko, hasDamageText }。attacks は parseEnemyAttackList
// の戻り値の形（stat は攻撃側のステータス適用済み）。
// raceTokko / stateTokko は { race|state, factor } の配列で、
// stateTokko は編成がその状態を付けられる分だけを渡すこと。
// 戻り値: { members: [{ id, name, attacksRead, maxTotal,
// noDamageAbility, targets: [{ enemyName, def, hp, lines:
// [{ kind, kindLabel, skillName, mult, hits, total,
// conditionNote, lvStage }] }] }] }
// （味方の並び順。行は対象ごとに合計の大きい順）。
export function estimateOutgoing({ fact, mults, allies }) {
  const defMult = mults && typeof mults.def === 'number' ? mults.def : 1;
  const hpMult = mults && typeof mults.hp === 'number' ? mults.hp : 1;
  const party = fact && Array.isArray(fact.party) ? fact.party.filter(Boolean) : [];
  const members = [];
  for (const ally of allies || []) {
    const attacks = ally.attacks || [];
    const targets = [];
    let maxTotal = 0;
    for (const e of party) {
      if (typeof e.def !== 'number') continue;
      const targetDef = Math.floor(e.def * defMult);
      const targetHp = typeof e.hp === 'number' ? Math.floor(e.hp * hpMult) : null;
      const targetRow = e.class === 'スナイパー' ? 'back' : 'front';
      const races = Array.isArray(e.race) ? e.race : [];
      // 種族特効（同系統は加算）: 対象の種族に合う係数の増分を
      // 合算して1つの係数にする。
      let raceIncrease = 0;
      for (const t of ally.raceTokko || []) {
        if (races.includes(t.race)) raceIncrease += t.factor - 1;
      }
      const raceFactor = 1 + raceIncrease;
      const lines = [];
      for (const attack of attacks) {
        const targeted = attack.range === 'all' || attack.range === 'single'
          || attack.range === 'random'
          || (attack.range === 'row'
            && ((attack.frontRow && targetRow === 'front')
              || (attack.backRow && targetRow === 'back')
              || (!attack.frontRow && !attack.backRow)));
        if (!targeted) continue;
        const variants = [{ factor: raceFactor, note: attack.conditionNote || null }];
        for (const t of ally.stateTokko || []) {
          const note = `${t.state}状態の時`;
          variants.push({
            factor: raceFactor * t.factor,
            note: attack.conditionNote && attack.conditionNote !== note
              ? `${attack.conditionNote}・${note}` : note,
          });
        }
        for (const v of variants) {
          const base = attack.stat * attack.mult - (attack.ignoreDef ? 0 : targetDef);
          const perHit = base <= 0 ? 1
            : Math.max(1, Math.floor(Math.floor(base)
              * classFactorFor(ally.className, targetRow)
              * attack.comboFactor
              * v.factor));
          const total = perHit * attack.hits;
          if (total > maxTotal) maxTotal = total;
          lines.push({
            kind: attack.kind,
            kindLabel: ENEMY_ATTACK_KIND_LABEL[attack.kind] || '攻撃',
            skillName: attack.skillName || null,
            mult: attack.mult,
            hits: attack.hits,
            total,
            conditionNote: v.note,
            lvStage: typeof attack.lvStage === 'number' ? attack.lvStage : null,
          });
        }
      }
      if (lines.length === 0) continue;
      lines.sort((a, b) => b.total - a.total);
      targets.push({ enemyName: e.name, def: targetDef, hp: targetHp, lines });
    }
    members.push({
      id: ally.id, name: ally.name,
      attacksRead: attacks.length > 0, maxTotal, targets,
      // ダメージのある技そのものが無い味方（文面のどこにも
      // ダメージが無い）。「読めなかった」とは区別して出す。
      noDamageAbility: attacks.length === 0 && ally.hasDamageText === false,
    });
  }
  return { members };
}
