// Hボムプランナーの計算エンジン（2026-11-19 実装フライト）。
// 場の状態（各敵のボム）と手の並びだけを入力にし、表示される数値は
// すべてここから再生計算する。ダメージ式は公式の要素で組み、
// 素材ボム数の効きだけ Wiki 由来の式を使う（検証ケース:
// Lv70・素材16・倍率50・同時補正1.2・敵防御9999・補正なし
// → 225,001。外部の計算ツールと一致）。
//
// 公式（バトルヘルプ「ハイドロボム」、正本）:
// - 速は対象と左右に最も近い敵、重は対象のみ、錬は敵全体
//   （対象以外は威力減少=ダメージ補正に0.5倍）。
// - 同じ能力のボムは同じ対象に同時に1個まで。1体に3個まで。
//   それ以外の使用回数の制限はない（奥義・覚醒スキルも、別対象や
//   錬成で消費された後の再使用は可。1回のみなのは秘奥義だけ）。
// - 錬成: 対象のボムを全て解除し、解除した倍率の合計+錬成能力の
//   倍率の錬を付ける（上限50倍）。導火線はリセットされる。
//   対象に何が付いているかで錬成の可否は変わらない（速だけでも、
//   何も付いていなくても錬成できる。公式どおり）。
// - 状態分岐の行動（branchOnHeavy、ウァプラR奥義の専用霊宝版）:
//   原文「対象の状態に応じてさらに効果が発生」どおり、対象ごとに
//   分岐する。重が付与されていなければ重を付与し、重が付与されて
//   いれば錬成する（両方を同時には行わない。2026-11-20
//   ユーザー確定）。錬が付いていても重が無ければ付与の側になる。
//   錬成で重が消費された後は、対象に自分の錬だけが残っていても
//   次の使用で重を付け直せる（付け直した重は錬と併存し、さらに
//   次の使用で両方を素材に錬成できる。2026-11-20 ユーザー指摘で
//   修正: 「同じ能力は同時に1個まで」の数えは、その能力が付与
//   する種類のボムだけを対象にし、錬成でできた錬は数えない。
//   錬成だけの行動に再使用の制限が無いこととも揃う）。
// - ダメージ上昇状態はボム単位。上昇状態のボムを錬成すると、
//   できた錬も上昇状態になる。
// ダメージ上昇の演算（2026-11-19 ユーザー決定で確定）:
//   上昇値 = 状態系の値（ボムの boost。錬成では素材の最大値を継承）
//          + 付与者（錬では錬成者）の装備分（ボムの equipBoost）。
//   装備分はそのキャラの装備合計（該当霊宝を複数付けていれば
//   その合計、同じ霊宝の重複も個数分）で、ボム1個につき1度
//   だけ適用され、継承されない
//   （錬成のたびに錬成者本人の装備で付け直す。例: 専用霊宝つき
//   ヒュトギン奥義の強化+70%に修羅の仮面+3%で合計73%。仮面持ち
//   が何回錬成しても73%のまま）。
//   装備分は霊宝（修羅の仮面+3%・慈愛と安寧の香炉+4%、索引の
//   reishouBoost）とオーブ特性（氷龍帝オロチの重+20%、selfBoost
//   として乗り錬成で失われる）の2系統。
// Wiki 由来の式（特殊状態ページ）:
// - 速・重: ((100+付与者Lv×15)×倍率-敵防御力)×同時爆破補正×ダメージ補正
// - 錬: ((100+付与者Lv×15+錬成補正)×倍率-敵防御力)×同時爆破補正
//   ×ダメージ補正、錬成補正=(解除した速・重の総数+錬成回数)
//   ×付与者Lv×2.5（材料の合計は30で上限）
// - 同時爆破補正 = 1+0.1×同時に爆発するボムの総数（1個なら1）
// 弱体（2026-11-19 追加フライト）:
// - 編成が自分で付ける防御力低下と虚弱を、強化の手と同じ扱いで
//   起爆計算に入れる。外付けの前提トグルは作らない。
// - 防御力低下は敵ごとに発生源（能力）単位で持ち、異なる発生源は
//   加算、同じ発生源は上書き（_common-rules.json「デバフの重ね
//   がけ」）。実効防御力は防御×(1-合計)で小数点以下切り捨て、
//   0未満にはならない。
// - 虚弱は特殊状態。付いている敵に弱体・状態異常の種類が付いて
//   いるほど被ダメージが上がる（corpus-status/虚弱.json）。上昇
//   率は1種につき30%（Wiki バラム page の専用霊宝解説。12種・
//   360%まで確認、上限は不明）。分類は「与ダメージ増加補正」の
//   枠で、同枠とは加算（corpus-status/ダメージ計算.json）。
//   そのため起爆ダメージのダメージ補正へ、ボムの上昇分と加算で
//   入れる（錬の波及では枠ごと0.5倍）。
// - 弱体は起爆の瞬間に有効なものだけを数える。ターン数モード
//   では適用ターンと持続から有効範囲を判定し、切れたものは
//   数えない。錬モード（構成）には時計が無いため、構成に含まれ
//   る弱体は全て有効として扱う。
// - 弱体の1回ルール（ユーザー決定）: 独立した弱体付与の行動
//   （ボム行動に付随しないもの）は、対象の敵にその種類が既に
//   付いていれば付け直せない（checkAction が「弱体済み」を返す。
//   手動パレットのグレーアウトと、おまかせ探索の分岐削減は
//   この同じ判定で揃える）。種類が違えば別々に付けられる。
//   持続が切れれば再び付けられる。ボム行動に付随する弱体
//   （秘奥義の防御力低下など）は行動の一部として対象外。
// - 付着の状態（2026-11-20）: 敵の debuffs が「付いている弱体・
//   状態異常の集合」そのもので、1件ごとに発生源（誰の・どの
//   行動か）を刻む。逐次条件（前段が条件の状態を付ける行動の
//   後段）は生成時に索引へ含めてあるため、エンジンは付着を
//   そのまま集合として数える（虚弱の種類数は集合の種類数）。
//   付着は removeDebuff で1件ずつ取り除ける（錬モードの場が
//   対象。ターン数モードでは発生源の手を取り除くことで消える）。
// - 種類だけの行動（攻撃力低下・状態異常など、防御力低下でも
//   虚弱でもないもの）は、虚弱の数えにしか効かないため、編成に
//   虚弱の手が無い場合はおまかせ・パレットの候補から外す。
// Lv段階（2026-11-20）: 索引の levels を持つ行動は、現在のLvで
// 解決した形で判定・適用する。Lvの上がり方は levelMode で、
// 'use' は発生源ごとの使用回数（場の useCounts）、'turn' は
// 適用ターンの番号（アガリアレプトの覚醒スキルだけ。コーパスの
// 注記「ターン経過でLv上昇」）。錬モードは時計が無いため、
// 'turn' 型は到達しうる最大Lvで解決する（構成は例示のため）。
// 重複付与（stacks、サルガタナスのスキル専用霊宝版）: 原文
// 「この効果は重複して付与される」に従い、同じ発生源でも
// 上書きせず付け足す（弱体済みの1回ルールも適用しない）。
// 特性の手（free、シャミハザRの特性ボム）: 誰かのアタックに
// 付随する発生のため、ターン数モードで手数も覚醒ゲージも
// 消費しない。

export const PLACER_LEVEL = 70; // 付与者Lvは星6・Lv70を基準にする
export const MAX_BOMBS_PER_ENEMY = 3;
export const REN_MULT_CAP = 50;
export const REN_COUNT_CAP = 30;
export const HANDS_PER_TURN = 5;

const KIND_LABEL = { fast: '速', heavy: '重', ren: '錬' };
export const bombKindLabel = (kind) => KIND_LABEL[kind] || kind;

// 敵の陣形の決まり（2026-11-19 ユーザー訂正で確定）:
// - 左右の位置は編成データのスロット順（party 配列の位置）。
//   空きマス（null）は位置だけが残り、敵はいない。
// - 前列／後列はクラスで決まる（ファイター・トルーパーは前列、
//   スナイパーは後列）。クラス不明の敵は前列として扱う（データに
//   無い敵の列を捏造しないための便宜上の置き方）。
// - 「横一列」の行動は、対象と同じ列（前列なら前列の全員、後列
//   なら後列の全員）に届く。列に3体いれば3体、1体なら1体。
// - 速の巻き込みは列と無関係に、スロット順で左右に最も近い敵に
//   届く（空きマスは飛ばす）。
export function rowOfEnemy(e) {
  if (e && (e.row === 'front' || e.row === 'back')) return e.row;
  return e && e.cls === 'スナイパー' ? 'back' : 'front';
}

export function formationLayout(enemies) {
  const slots = enemies.map((e, i) => (e && typeof e.slot === 'number' ? e.slot : i));
  const rowOf = enemies.map((e) => rowOfEnemy(e));
  const back = [];
  const front = [];
  enemies.forEach((_, i) => (rowOf[i] === 'back' ? back : front).push(i));
  const bySlot = (a, b) => slots[a] - slots[b];
  back.sort(bySlot);
  front.sort(bySlot);
  const rows = [back, front].filter((r) => r.length);
  return { rows, slots, rowOf };
}

// 編成メンバー1人分のボム行動（メギドの能力+装備オーブ）。
// member: { id, orbId, specialReishou, reishouIds }
// 専用霊宝のバリエーションがある能力は、装備時にそちらへ差し替える。
// 装備まわりの上昇はどちらも「装備者本人のボムにだけ乗る」:
// - heavyBoost: オーブの特性（氷龍帝オロチの重+20%）。本人が置く
//   重全てに乗り、ボムの selfBoost として持つ。錬成では落ちる。
// - bombBoost: 霊宝の特性（修羅の仮面+3%・慈愛と安寧の香炉+4%）。
//   そのキャラの装備合計（同じ霊宝の重複も個数分を合計）を、
//   ボムの equipBoost として持つ。装備分はボム1個につき1度だけ
//   付き、他キャラの分とは合算されない。錬では素材の分は引き
//   継がず、錬成者本人の装備合計だけが付き直す。
export function memberActions(data, member) {
  const out = [];
  const orb = member.orbId && data && data.orbs ? data.orbs[member.orbId] : null;
  const heavyBoost = orb ? (orb.traitHeavyBoost || 0) : 0;
  const table = (data && data.reishouBoost) || {};
  const bombBoost = (member.reishouIds || [])
    .reduce((sum, id) => sum + (table[id] || 0), 0);
  const rec = data && data.megido ? data.megido[member.id] : null;
  if (rec) {
    const byKey = new Map();
    for (const a of rec.actions) {
      if (a.needsReishou) {
        if (member.specialReishou) byKey.set(a.key, a);
      } else if (!byKey.has(a.key)) byKey.set(a.key, a);
    }
    for (const a of byKey.values()) out.push({ member, action: a, heavyBoost, bombBoost });
  }
  if (orb) {
    for (const a of orb.actions) {
      out.push({ member, action: a, heavyBoost, bombBoost, orbCt: orb.ct });
    }
  }
  return out;
}

// 編成にHボム技（付与・錬成・強化）を持つメンバーがいるか。
// フォトン追加だけのオーブでは道具を出さない。弱体だけの手でも
// 出さない（表示条件はHボム技の有無。2026-11-19 ユーザー決定）。
export function formationHasBombActions(data, members) {
  return members.some((m) => memberActions(data, m)
    .some((c) => c.action.place || c.action.ren || c.action.enhance));
}

// 編成に虚弱の手があるか（種類だけの行動を候補に入れる条件）。
export function formationHasWeakAction(data, members) {
  return members.some((m) => memberActions(data, m)
    .some((c) => c.action.debuff && c.action.debuff.weak));
}

// その行動が付ける弱体の種類（防御力低下・虚弱・その他の種類）。
export function debuffTypesOf(action) {
  const d = action && action.debuff;
  if (!d) return [];
  const out = [];
  if (d.defDown) out.push('防御力低下');
  if (d.weak) out.push('虚弱');
  for (const t of d.types || []) out.push(t.type);
  return out;
}

// ボム行動に付随しない、弱体だけの行動か（1回ルールの対象）。
export function isDebuffOnlyAction(action) {
  return Boolean(action && action.debuff && !action.place && !action.ren
    && !action.enhance && !action.steal && !action.grantsPhoton
    && !action.setsAwakened);
}

// 防御力低下でも虚弱でもない、種類だけの行動か（虚弱の数え専用）。
export function isTypesOnlyAction(action) {
  return Boolean(action && action.debuff && !action.debuff.defDown
    && !action.debuff.weak && !action.place && !action.ren
    && !action.enhance && !action.steal && !action.grantsPhoton
    && !action.setsAwakened);
}

// 全てのLvで種類だけの行動か（候補の絞り込み用。後のLvで
// 防御力低下や虚弱が付く行動は、種類だけとはみなさない）。
export function isTypesOnlyOverall(action) {
  if (!action) return false;
  return actionSnapshots(action).every((s) => isTypesOnlyAction({
    ...action,
    place: s ? s.place : undefined,
    ren: s ? s.ren : undefined,
    enhance: s ? s.enhance : undefined,
    debuff: s ? s.debuff : undefined,
  }));
}

export function actionKeyOf(ctx) {
  return ctx.action.medium === 'オーブ'
    ? `orb:${ctx.member.orbId}` : `${ctx.member.id}:${ctx.action.key}`;
}

// 戦闘不能時に蘇生する敵の、倒し切るのに要る実効HP: 本体のHPに、
// 蘇生のたびに戻る分（最大HP×hpPct）を回数ぶん足したもの。
// 蘇生が無ければ通常のHPそのもの。revive は VM が特性文から導く
// { times, hpPct, shift }。
// シフト後のHP依存の軽減（shift.reductionMax。直線で確定:
// 軽減率 = 最大値 × 現在HP/最大HP、2026-11-21 ユーザー裁定）が
// ある敵は、蘇生分の区間を軽減込みで数える。区間のHP x における
// 軽減率は reductionMax × x/最大HP なので、区間を削り切るのに
// 要るダメージは ∫dx/(1 - reductionMax×x/最大HP) を 0..蘇生分 で
// 積分した (最大HP/reductionMax) × -ln(1 - reductionMax×蘇生分/最大HP)。
// シフトは最初の蘇生で起き、以降の蘇生もシフト後の形で戻るため、
// 軽減は全ての蘇生分に掛かる。同時爆破の判定はこの実効HPとの
// 比較で一貫させる（爆発の中で形が移る過程も、この閾値に畳む）。
export function effectiveHpOf(e) {
  if (!e || typeof e.hp !== 'number') return e ? e.hp : null;
  const r = e.revive;
  if (!r) return e.hp;
  const portion = Math.floor(e.hp * r.hpPct / 100);
  const red = r.shift && r.shift.reductionMax > 0 ? r.shift.reductionMax : 0;
  if (!red) return e.hp + r.times * portion;
  const term = Math.min(red * portion / e.hp, 1 - 1e-9);
  const reducedPortion = Math.floor((e.hp / red) * -Math.log(1 - term));
  return e.hp + r.times * reducedPortion;
}

export function emptyField(enemies) {
  return {
    enemies: enemies.map((e, i) => ({
      name: e.name, hp: e.hp, def: e.def, bombs: [], debuffs: [],
      slot: typeof e.slot === 'number' ? e.slot : i,
      cls: e.cls || null,
      row: e.row || null,
      revive: e.revive || null,
    })),
    secretUsed: false,
    useCounts: {},
  };
}

function cloneField(field) {
  return {
    enemies: field.enemies.map((e) => ({
      ...e,
      bombs: e.bombs.map((b) => ({ ...b })),
      debuffs: (e.debuffs || []).map((d) => ({ ...d })),
    })),
    secretUsed: field.secretUsed,
    useCounts: { ...(field.useCounts || {}) },
  };
}

// 発生源キー（付着の発生源と使用回数の数えで共用）。
export function sourceKeyOf(ctx) {
  return `${actionKeyOf(ctx)}|${ctx.member.id}`;
}

// 行動の Lv ごとのスナップショット（levels が無ければ行動自身）。
export function actionSnapshots(action) {
  return action && Array.isArray(action.levels) && action.levels.length
    ? action.levels : [action];
}

// どのLvでもよいので、ボム・錬成・強化・弱体のどれかを持つか
// （候補の絞り込みの物差し。Lv1では効果が無く後のLvで付く
// 行動＝アイムのスキル等を候補から落とさないため）。
export function actionHasEffectAtAnyLevel(action) {
  return actionSnapshots(action)
    .some((s) => s && (s.place || s.ren || s.enhance || s.debuff));
}

// 現在のLvで解決した行動を返す（levels が無ければ行動自身）。
// 戻り値には解決した Lv（snap.lv）を level として持つ。
export function effectiveAction(field, ctx, turn = 0) {
  const a = ctx.action;
  if (!a || !Array.isArray(a.levels) || !a.levels.length) return a;
  let idx;
  if (a.levelMode === 'turn') {
    idx = (typeof turn === 'number' && turn >= 1)
      ? Math.min(turn, a.levels.length) - 1
      : a.levels.length - 1;
  } else {
    const used = (field && field.useCounts && field.useCounts[sourceKeyOf(ctx)]) || 0;
    idx = Math.min(used, a.levels.length - 1);
  }
  const snap = a.levels[idx];
  const out = { ...a };
  delete out.place;
  delete out.ren;
  delete out.enhance;
  delete out.debuff;
  if (snap.place) out.place = snap.place;
  if (snap.ren) out.ren = snap.ren;
  if (snap.enhance) out.enhance = snap.enhance;
  if (snap.debuff) out.debuff = snap.debuff;
  if (snap.range) out.range = snap.range;
  out.level = snap.lv;
  return out;
}

// ---- 弱体の状態 ----
// 敵の debuffs: [{ key, type, pct, appliedTurn, turns, byName,
//   medium, actionName, hand? }]
// key は発生源（能力×使用者）。同じ発生源の同じ種類は上書き、
// 異なる発生源は共存する（防御力低下は合計が効く）。byName・
// medium・actionName は発生源の表示用（ポップアップの一覧）。
// hand はターン数モードの再生で付けた手の番号（発生源の手を
// 特定するため。錬モードの場には無い）。
// atTurn が数値なら、そのターンに有効なものだけを返す
// （適用ターンから持続ターンの間）。null なら全て有効
// （錬モードの構成に時計は無いため）。
export function activeDebuffs(enemy, atTurn = null) {
  const list = enemy.debuffs || [];
  if (typeof atTurn !== 'number') return list;
  return list.filter((d) => d.appliedTurn <= atTurn && atTurn < d.appliedTurn + d.turns);
}

export function defDownTotal(enemy, atTurn = null) {
  return activeDebuffs(enemy, atTurn)
    .filter((d) => d.type === '防御力低下')
    .reduce((s, d) => s + (d.pct || 0), 0);
}

export function effectiveDef(enemy, atTurn = null) {
  if (typeof enemy.def !== 'number') return enemy.def;
  const total = defDownTotal(enemy, atTurn);
  if (!total) return enemy.def;
  return Math.max(0, Math.floor(enemy.def * (1 - total)));
}

// 虚弱の上昇率（1種あたり）。根拠は Wiki バラム page の専用霊宝
// 解説（12種・360%まで確認、上限不明）。
export const WEAK_PER_TYPE = 0.3;

// 虚弱が付いている敵に付いている、弱体・状態異常の種類数
// （虚弱自身は数えない）。虚弱が無ければ 0。
export function weakTypeCount(enemy, atTurn = null) {
  const act = activeDebuffs(enemy, atTurn);
  if (!act.some((d) => d.type === '虚弱')) return 0;
  return new Set(act.filter((d) => d.type !== '虚弱').map((d) => d.type)).size;
}

export function weakBonusOf(enemy, atTurn = null) {
  return WEAK_PER_TYPE * weakTypeCount(enemy, atTurn);
}

function debuffOn(field, ctx, targetIdx, turn) {
  const d = ctx.action.debuff;
  if (!d) return;
  const src = sourceKeyOf(ctx);
  for (const i of targetsOf(field, ctx.action, targetIdx)) {
    const e = field.enemies[i];
    // 重複付与（stacks）: 同じ発生源でも上書きせず、回数分の
    // サフィックスを付けた別キーで付け足す（防御力低下は
    // 付着の合計が効くため、付けた分だけ重なる）。
    let key = src;
    if (ctx.action.stacks) {
      let maxN = -1;
      for (const x of e.debuffs || []) {
        if (x.key === src) maxN = Math.max(maxN, 0);
        else if (x.key.startsWith(`${src}#`)) {
          const v = Number(x.key.slice(src.length + 1));
          if (Number.isFinite(v)) maxN = Math.max(maxN, v);
        }
      }
      key = `${src}#${maxN + 1}`;
    }
    const put = (type, pct, turns) => {
      e.debuffs = (e.debuffs || []).filter((x) => !(x.key === key && x.type === type));
      e.debuffs.push({
        key, type, pct: pct || 0, appliedTurn: turn || 0, turns,
        byName: ctx.member.name, medium: ctx.action.medium,
        actionName: ctx.action.name,
      });
    };
    if (d.defDown) put('防御力低下', d.defDown.pct, d.defDown.turns);
    if (d.weak) put('虚弱', 0, d.weak.turns);
    for (const t of d.types || []) put(t.type, t.pct || 0, t.turns);
  }
}

export function targetsOf(field, action, targetIdx) {
  if (action.range === 'all') return field.enemies.map((_, i) => i);
  if (action.range === 'row') {
    // 横一列: 対象と同じ列（前列／後列）の全員。
    const { rowOf } = formationLayout(field.enemies);
    return field.enemies.map((_, i) => i).filter((i) => rowOf[i] === rowOf[targetIdx]);
  }
  return [targetIdx];
}

// 「同じ能力のボムは同じ対象に同時に1個まで」の判定。数えるのは
// その能力が付与する種類のボムだけにする: 錬成でできた錬は素材を
// 消費した結果であって、その能力が「付与したボム」ではない。
// 同じ能力のキーを持つ錬が残っていても付け直しは妨げない
// （状態分岐の行動が自分の錬成の後に重を付け直す場合）。
export function hasOwnPlacedBomb(enemy, ctx) {
  const places = Array.isArray(ctx.action.place) ? ctx.action.place : [ctx.action.place];
  const kinds = new Set(places.filter(Boolean).map((p) => p.kind));
  const key = actionKeyOf(ctx);
  return (enemy.bombs || []).some((b) => b.key === key && kinds.has(b.kind));
}

function placeOn(field, ctx, enemyIdx, turn) {
  const enemy = field.enemies[enemyIdx];
  const places = Array.isArray(ctx.action.place) ? ctx.action.place : [ctx.action.place];
  if (hasOwnPlacedBomb(enemy, ctx)) return false;
  for (const p of places) {
    if (!p) continue;
    if (enemy.bombs.length >= MAX_BOMBS_PER_ENEMY) return false;
    enemy.bombs.push({
      key: actionKeyOf(ctx),
      kind: p.kind,
      mult: p.mult,
      lv: PLACER_LEVEL,
      count: 0,
      boost: 0,
      selfBoost: p.kind === 'heavy' ? (ctx.heavyBoost || 0) : 0,
      equipBoost: ctx.bombBoost || 0,
      fuse: p.fuse,
      placedTurn: turn || 0,
      byName: ctx.member.name,
      medium: ctx.action.medium,
      actionName: ctx.action.name,
    });
  }
  return true;
}

function renOn(field, ctx, enemyIdx, turn) {
  const enemy = field.enemies[enemyIdx];
  const consumed = enemy.bombs;
  const multSum = consumed.reduce((s, b) => s + b.mult, 0);
  const prevRen = consumed.find((b) => b.kind === 'ren');
  const fastHeavyCount = consumed.filter((b) => b.kind !== 'ren').length;
  const boost = consumed.reduce((mx, b) => Math.max(mx, b.boost || 0), 0);
  enemy.bombs = [{
    key: actionKeyOf(ctx),
    kind: 'ren',
    mult: Math.min(REN_MULT_CAP, ctx.action.ren.base + multSum),
    lv: PLACER_LEVEL,
    count: (prevRen ? prevRen.count : 0) + fastHeavyCount + 1,
    boost,
    // 付与者本人の上昇（オロチ特性の selfBoost）は錬成で失われる。
    // 霊宝の上昇も素材からは引き継がず、錬成者本人の装備分だけ。
    selfBoost: 0,
    equipBoost: ctx.bombBoost || 0,
    fuse: ctx.action.ren.fuse,
    placedTurn: turn || 0,
    byName: ctx.member.name,
    medium: ctx.action.medium,
    actionName: ctx.action.name,
  }];
}

function enhanceOn(field, ctx, targetIdx) {
  const { pct, scope } = ctx.action.enhance;
  const idxs = scope === 'all' ? field.enemies.map((_, i) => i) : [targetIdx];
  for (const i of idxs) {
    for (const b of field.enemies[i].bombs) b.boost = Math.max(b.boost || 0, pct);
  }
}

// 対象に重が付与されているか（状態分岐の条件）。
export function hasHeavyBomb(enemy) {
  return Boolean(enemy && (enemy.bombs || []).some((b) => b.kind === 'heavy'));
}

// 行動の可否と理由（選択肢の使用中表示に使う）。
// ctx: { member, action }, opts: { secretUsed }
export function checkAction(field, ctx, targetIdx, opts = {}) {
  // Lv段階のある行動は、現在のLvで解決した形で判定する。
  const effCtx = {
    ...ctx,
    action: effectiveAction(field, ctx, typeof opts.atTurn === 'number' ? opts.atTurn : 0),
  };
  const a = effCtx.action;
  if (a.secret && (opts.secretUsed || field.secretUsed)) {
    return { ok: false, reason: '秘奥義は1回のみ' };
  }
  const targets = targetsOf(field, a, targetIdx);
  // 弱体の1回ルール: 独立した弱体付与の行動（ボム行動に付随
  // しないもの）は、付ける種類の全てが対象の敵に既に付いて
  // いる間は付け直せない。種類が1つでも新しく付く対象がいれば
  // 使える。持続が切れた種類は再び付けられる（atTurn で判定）。
  // 重複付与（stacks）の行動はこのルールの対象外（付け足せる）。
  if (isDebuffOnlyAction(a) && !a.stacks) {
    const want = debuffTypesOf(a);
    const atTurn = typeof opts.atTurn === 'number' ? opts.atTurn : null;
    const gains = targets.some((i) => want.some(
      (t) => !activeDebuffs(field.enemies[i], atTurn).some((d) => d.type === t)));
    if (!gains) return { ok: false, reason: '弱体済み' };
  }
  if (a.place && a.branchOnHeavy && a.ren) {
    // 状態分岐: 重がある対象は錬成になるため常に使える。重が無い
    // 対象は付与の可否（同じ能力が付与した重が既にある・3個まで）
    // で決まる。自分の錬成でできた錬だけが残る対象は、重が無い
    // ため付け直せる（錬は「使用中」の数えに入らない）。
    // 対象のどれか1つでも受けられれば使える。
    let anyRoom = false;
    let usedReason = null;
    for (const i of targets) {
      const e = field.enemies[i];
      if (hasHeavyBomb(e)) { anyRoom = true; continue; }
      if (hasOwnPlacedBomb(e, effCtx)) { usedReason = '使用中'; continue; }
      if (e.bombs.length >= MAX_BOMBS_PER_ENEMY) { usedReason = usedReason || 'ボムは3つまで'; continue; }
      anyRoom = true;
    }
    if (!anyRoom) return { ok: false, reason: usedReason || 'ボムは3つまで' };
  } else if (a.place) {
    let anyRoom = false;
    let usedReason = null;
    for (const i of targets) {
      const e = field.enemies[i];
      if (hasOwnPlacedBomb(e, effCtx)) { usedReason = '使用中'; continue; }
      if (e.bombs.length >= MAX_BOMBS_PER_ENEMY) { usedReason = usedReason || 'ボムは3つまで'; continue; }
      anyRoom = true;
    }
    if (!anyRoom) return { ok: false, reason: usedReason || 'ボムは3つまで' };
  }
  // 錬成は対象に何が付いているかで可否が変わらない（速だけでも、
  // 何も付いていなくても錬成できる。公式どおり）。そのため錬成の
  // 行動には付着物の有無による検査を置かない。
  if (a.enhance && !a.place && !a.ren) {
    const anyBombs = field.enemies.some((e) => e.bombs.length > 0);
    if (!anyBombs) return { ok: false, reason: 'ボムがありません' };
  }
  if (a.steal) {
    const anyBombs = targets.some((i) => field.enemies[i].bombs.length > 0);
    if (!anyBombs) return { ok: false, reason: 'ボムがある敵に使う' };
  }
  return { ok: true, reason: null };
}

// 場へ行動を適用する。適用できなければ null。
export function applyAction(field, ctx, targetIdx, turn = 0) {
  const check = checkAction(field, ctx, targetIdx, { atTurn: turn });
  if (!check.ok) return null;
  const next = cloneField(field);
  // Lv段階のある行動は、現在のLvで解決した形を適用する。
  const effCtx = { ...ctx, action: effectiveAction(field, ctx, turn) };
  const a = effCtx.action;
  const targets = targetsOf(next, a, targetIdx);
  if (a.place && a.branchOnHeavy && a.ren) {
    // 状態分岐: 対象ごとに、重が付与されていれば錬成、無ければ
    // 重の付与。どちらも起きなければ手は不発（null）。
    let acted = false;
    for (const i of targets) {
      if (hasHeavyBomb(next.enemies[i])) {
        renOn(next, effCtx, i, turn);
        acted = true;
      } else if (placeOn(next, effCtx, i, turn)) {
        acted = true;
      }
    }
    if (!acted) return null;
  } else {
    if (a.place) {
      let placed = false;
      for (const i of targets) {
        if (placeOn(next, effCtx, i, turn)) placed = true;
      }
      if (!placed) return null;
    }
    if (a.ren) {
      for (const i of targets) {
        // 錬成は対象のボムを全て材料にする。ボムが無い対象にも
        // 錬成できる（錬成能力自体の倍率だけで錬ができる。公式どおり）。
        renOn(next, effCtx, i, turn);
      }
    }
  }
  if (a.enhance) enhanceOn(next, effCtx, targetIdx);
  if (a.debuff) debuffOn(next, effCtx, targetIdx, turn);
  if (a.secret) next.secretUsed = true;
  // 使用回数で上がるLvは、適用できた使用を1回として数える。
  if (ctx.action.levels && ctx.action.levelMode !== 'turn') {
    const k = sourceKeyOf(ctx);
    next.useCounts[k] = (next.useCounts[k] || 0) + 1;
  }
  return next;
}

export function removeBomb(field, enemyIdx, bombIdx) {
  const next = cloneField(field);
  const e = next.enemies[enemyIdx];
  if (!e || !e.bombs[bombIdx]) return field;
  e.bombs.splice(bombIdx, 1);
  return next;
}

// 付着（弱体・状態異常）を1件取り除く。錬モードの場が対象で、
// 取り除いた結果は起爆プレビュー・弱体済みの判定・虚弱の種類数
// の全てに反映される。該当が無ければ場をそのまま返す。
export function removeDebuff(field, enemyIdx, debuffIdx) {
  const next = cloneField(field);
  const e = next.enemies[enemyIdx];
  if (!e || !(e.debuffs || [])[debuffIdx]) return field;
  e.debuffs.splice(debuffIdx, 1);
  return next;
}

// 「このまま全部爆発したら」のライブ計算。全ボムが同時に爆発し、
// 誘爆で連鎖する前提。同時爆破補正は場のボム総数で決まる。
// opts.atTurn を渡すと、そのターンに有効な弱体だけを数える
// （ターン数モードの起爆判定）。渡さなければ構成にある弱体を
// 全て有効として扱う（錬モード）。
// 敵の防御力は防御力低下を差し引いた実効値。虚弱が付いている
// 敵には、弱体・状態異常の種類数×30%がダメージ補正の枠に
// 加算される（錬の波及では枠ごと0.5倍）。
export function previewDetonation(field, opts = {}) {
  const atTurn = opts && typeof opts.atTurn === 'number' ? opts.atTurn : null;
  const simulCount = field.enemies.reduce((s, e) => s + e.bombs.length, 0);
  const factor = simulCount <= 1 ? 1 : 1 + 0.1 * simulCount;
  const per = field.enemies.map(() => ({ own: 0, ring: 0, splash: 0, total: 0 }));
  const dmg = (bomb, targetIdx, boostPart, frameScale) => {
    const te = field.enemies[targetIdx];
    const def = effectiveDef(te, atTurn);
    const defVal = typeof def === 'number' ? def : 0;
    const corr = (boostPart + weakBonusOf(te, atTurn)) * frameScale;
    const renCorr = bomb.kind === 'ren'
      ? Math.min(bomb.count || 0, REN_COUNT_CAP) * bomb.lv * 2.5 : 0;
    const base = 100 + bomb.lv * 15 + renCorr;
    return Math.max(0, Math.floor((base * bomb.mult - defVal) * factor * corr));
  };
  const { slots } = formationLayout(field.enemies);
  field.enemies.forEach((e, i) => {
    for (const b of e.bombs) {
      const boostMul = 1 + (b.boost || 0) + (b.selfBoost || 0) + (b.equipBoost || 0);
      if (b.kind === 'fast') {
        // 速の巻き込みは列と無関係に、スロット順で左右に最も近い
        // 敵に届く（空きマスは飛ばす）。誘爆の連鎖も同じ届き方。
        let left = -1;
        let right = -1;
        field.enemies.forEach((_, t) => {
          if (t === i) return;
          if (slots[t] < slots[i] && (left < 0 || slots[t] > slots[left])) left = t;
          if (slots[t] > slots[i] && (right < 0 || slots[t] < slots[right])) right = t;
        });
        for (const t of [left, i, right]) {
          if (t < 0) continue;
          const d = dmg(b, t, boostMul, 1);
          if (t === i) per[t].own += d; else per[t].ring += d;
        }
      } else if (b.kind === 'heavy') {
        per[i].own += dmg(b, i, boostMul, 1);
      } else if (b.kind === 'ren') {
        per[i].own += dmg(b, i, boostMul, 1);
        field.enemies.forEach((o, t) => {
          if (t === i) return;
          per[t].splash += dmg(b, t, 1 + (b.boost || 0) + (b.equipBoost || 0), 0.5);
        });
      }
    }
  });
  const perEnemy = per.map((p, i) => {
    const total = p.own + p.ring + p.splash;
    // 撃破判定は蘇生込みの実効HPで見る（一度の爆発で蘇生分まで
    // 削り切らなければ倒せない）。シフト後に数値化できない軽減が
    // ある敵は、軽減を反映していない判定であることを uncertain で
    // 伝える（表示側で明示する）。
    const effHp = effectiveHpOf(field.enemies[i]);
    const hp = field.enemies[i].hp;
    return {
      ...p, total,
      kills: typeof effHp === 'number' && total >= effHp,
      shortfall: typeof effHp === 'number' ? Math.max(0, effHp - total) : null,
      effHp,
      reviveHp: typeof effHp === 'number' && typeof hp === 'number' ? effHp - hp : 0,
      uncertain: Boolean(field.enemies[i].revive && field.enemies[i].revive.shift
        && field.enemies[i].revive.shift.unknownDamage),
      defDownPct: defDownTotal(field.enemies[i], atTurn),
      weakActive: activeDebuffs(field.enemies[i], atTurn).some((d) => d.type === '虚弱'),
      weakTypes: weakTypeCount(field.enemies[i], atTurn),
      effDef: effectiveDef(field.enemies[i], atTurn),
    };
  });
  return {
    simulCount,
    factor,
    perEnemy,
    allKilled: perEnemy.every((p) => p.kills),
    totalDamage: perEnemy.reduce((s, p) => s + p.total, 0),
  };
}

function fieldSignature(field) {
  return JSON.stringify(field.enemies.map((e) => [
    e.bombs.map((b) => [
      b.key, b.kind, b.mult, b.count, b.boost, b.selfBoost, b.equipBoost,
    ]),
    (e.debuffs || []).map((d) => [d.key, d.type, d.pct, d.appliedTurn, d.turns]),
  ])) + (field.secretUsed ? '|S' : '')
    + `|U${JSON.stringify(field.useCounts || {})}`;
}

// ---- おまかせ探索の物差し ----
// 材料の見込み: 防御の高い敵では序盤の実ダメージが全て0になり、
// ダメージだけでは手を比べられない。ボム1個の見込みは、起爆
// ダメージの素（(100+Lv×15) の 1150 を 100 で割った値）を単価に
// 数える。速・重は倍率×11.5、錬は素材が1つ増えるごとに単価が
// 1.75 ずつ上がる（錬成補正 Lv70×2.5=175 の 1/100）。
function bombPotential(b) {
  const boostMul = 1 + (b.boost || 0) + (b.selfBoost || 0) + (b.equipBoost || 0);
  return (b.kind === 'ren'
    ? (11.5 + 1.75 * Math.min(b.count || 0, REN_COUNT_CAP)) * b.mult
    : b.mult * 11.5) * boostMul;
}

function enemyMaterial(e) {
  return e.bombs.reduce((s, b) => s + bombPotential(b), 0);
}

// 場の評価（錬モード）: 敵ごとの実ダメージ（HPで頭打ち）+
// 材料の見込み。まだ倒せていない敵の材料は×0.05、倒し切った
// 敵の材料も波及の素になるため×0.025で数える（1体に畳み
// 続ける線を貶めないため）。
function compositionScore(field, preview) {
  let s = 0;
  field.enemies.forEach((e, i) => {
    const p = preview.perEnemy[i];
    const hp = typeof e.hp === 'number' ? effectiveHpOf(e) : p.total;
    s += Math.min(p.total, hp);
    s += enemyMaterial(e) * (p.total < hp ? 0.05 : 0.025);
  });
  return s;
}

// 並びの状態の署名（ターン数モードの探索で使う）。
function replaySigOf(st) {
  return JSON.stringify([
    st.field.enemies.map((e) => [
      e.bombs.map((b) => [b.key, b.kind, b.mult, b.count, b.boost, b.equipBoost, b.placedTurn]),
      (e.debuffs || []).map((d) => [d.key, d.type, d.pct, d.appliedTurn, d.turns]),
    ]),
    [...st.gauges.entries()].map(([k, v]) => [k, Math.min(v, 9)]),
    st.turn, st.pool, st.secretUsed,
    [...st.orbLastUsed.entries()],
    st.field.useCounts || {},
  ]);
}

// 最も早く弾けるボムの起爆ターン（ボムが無ければ null）。
function clockTurnOf(field) {
  let min = null;
  for (const e of field.enemies) {
    for (const b of e.bombs) {
      const t = b.placedTurn + b.fuse;
      if (min === null || t < min) min = t;
    }
  }
  return min;
}

// ビーム探索（フォールバック）の評価。実ダメージ+材料の見込み
// +起爆の時計になるボムの有無+ゲージが満ちたメンバーの数。
function sequencePotential(ctx, st, preview, detonateTurn) {
  let p = preview.totalDamage;
  for (const e of st.field.enemies) {
    for (const b of e.bombs) {
      p += b.kind === 'ren'
        ? (1150 + Math.min(b.count || 0, REN_COUNT_CAP) * 175) * b.mult * 0.01
        : b.mult * 11.5;
    }
  }
  const hasClock = st.field.enemies.some((e) => e.bombs
    .some((b) => b.placedTurn + b.fuse === detonateTurn));
  if (hasClock) p += 1e9;
  for (const m of ctx.members) {
    if ((st.gauges.get(m.id) || 0) >= (m.gaugeMax || Infinity)) p += 1000;
  }
  return p;
}

// ---- 錬の倍率から（構成の最適解） ----
// 場の状態だけを見る。手数最小で全敵を倒せる構成を探し、無ければ
// 最大ダメージの構成を返す。ターン・ゲージ・CTは見ない（構成の
// 例示）。秘奥義は計画全体で1回まで、使えるターンは注記で返す。
// 探索の主軸（2026-11-19 作り替え）: 実プレイの解は「同じ手を
// 繰り返す」単純な線なので、まず貪欲に（その時点で最も撃破に
// 近づく手を繰り返し選ぶ）深く潜って到達可能な解を早期に得て、
// その手数を上限に、それより短い線だけを深さ限定のビーム探索で
// 探す。貪欲で届かなかった場合のみ、従来のビーム探索に落とす。
// 打ち切り: 全段階で展開回数の予算（budget）を共有し、超えたら
// その時点の最大ダメージの構成を返す。錬成だけを持つ編成の
// ように状態が際限なく増え続ける相手でも必ず返るための保証。
export function solveComposition(data, members, enemies, opts = {}) {
  const maxDepth = opts.maxDepth || 24;
  const beamWidth = opts.beamWidth || 300;
  const budget = opts.budget || 200000;
  const staleLimit = opts.staleLimit || 5;
  const shortenBudget = opts.shortenBudget || 80000;
  const allCtxs = members.flatMap((m) => memberActions(data, m))
    .filter((c) => actionHasEffectAtAnyLevel(c.action));
  // 種類だけの行動は虚弱の数えにしか効かない。編成に虚弱の手が
  // 無ければ候補から外す（分岐の無駄と、効かない手の提示の防止）。
  const hasWeak = allCtxs.some((c) => actionSnapshots(c.action)
    .some((s) => s && s.debuff && s.debuff.weak));
  const ctxs = hasWeak ? allCtxs : allCtxs.filter((c) => !isTypesOnlyOverall(c.action));
  const stats = { expansions: 0, budgetHit: false };
  const spend = () => {
    stats.expansions += 1;
    if (stats.expansions > budget) { stats.budgetHit = true; return false; }
    return true;
  };
  const start = emptyField(enemies);
  const startNode = { field: start, hands: [], preview: previewDetonation(start) };
  let best = startNode;
  const finish = (node, solved) => ({
    field: node.field, hands: node.hands, preview: node.preview, solved, stats,
  });
  if (startNode.preview.allKilled) return finish(startNode, true);
  // 列範囲の行動は、同じ列のどの敵を対象にしても結果が同じになる。
  // 展開は列の代表（最初の敵）だけに絞る（結果は変わらない）。
  const { rowOf } = formationLayout(enemies);
  const targetsFor = (ctx) => {
    if (ctx.action.range === 'all') return [0];
    if (ctx.action.range === 'row') {
      const reps = [];
      const seenRows = new Set();
      enemies.forEach((_, i) => {
        if (!seenRows.has(rowOf[i])) { seenRows.add(rowOf[i]); reps.push(i); }
      });
      return reps;
    }
    return enemies.map((_, i) => i);
  };
  // 候補の生成: 適用できる手を評価の高い順に並べる。場が変わら
  // ない手（同じ強化の重ね掛け等）は候補にしない。生成した候補は
  // 最大ダメージの記録（best）の更新にも使う。予算切れは null。
  const candidatesOf = (node) => {
    const out = [];
    const curSig = fieldSignature(node.field);
    for (const ctx of ctxs) {
      for (const t of targetsFor(ctx)) {
        if (!spend()) return null;
        const next = applyAction(node.field, ctx, t, 0);
        if (!next) continue;
        if (fieldSignature(next) === curSig) continue;
        const preview = previewDetonation(next);
        const cand = {
          field: next,
          hands: [...node.hands, {
            memberId: ctx.member.id, memberName: ctx.member.name,
            actionKey: ctx.action.key, medium: ctx.action.medium,
            name: ctx.action.name, target: t, secret: Boolean(ctx.action.secret),
          }],
          preview,
          score: compositionScore(next, preview),
        };
        if (preview.totalDamage > best.preview.totalDamage) best = cand;
        out.push(cand);
      }
      if (stats.budgetHit) return null;
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };

  // 第1段階: 貪欲な深掘り。評価が伸びる限り最良の手を選び続け、
  // 実プレイの線を先に得る。
  let greedy = startNode;
  {
    let node = startNode;
    let nodeScore = compositionScore(node.field, node.preview);
    while (node.hands.length < maxDepth && !node.preview.allKilled) {
      const cands = candidatesOf(node);
      if (!cands || !cands.length) break;
      const top = cands[0];
      if (top.score <= nodeScore + 1e-9) break;
      node = top;
      nodeScore = top.score;
    }
    greedy = node;
  }

  if (greedy.preview.allKilled) {
    if (stats.budgetHit) return finish(greedy, true);
    // 第2段階: 解の手数を上限に、それより短い線だけを探す。
    // 深さ限定のビーム探索（上限=解の手数-1）で、最初に全滅が
    // 出た深さが最小手数になる。分枝限定の深さ優先も試したが、
    // 勝ち線の途中経過（範囲の速をばらまく手など）は評価順の
    // 上位に残らず刈られてしまったため、層で残す方式にした。
    // 短縮の探索には専用の展開枠（shortenBudget）を置き、
    // 尽きたら貪欲解を返す。
    const phaseStart = stats.expansions;
    const beamed = beamComposition(ctxs, targetsFor, startNode, stats, spend, {
      maxDepth: greedy.hands.length - 1,
      beamWidth: opts.shortenBeamWidth || 120,
      staleLimit: Number.POSITIVE_INFINITY,
      cap: phaseStart + shortenBudget,
    });
    if (beamed.preview.allKilled) return finish(beamed, true);
    return finish(greedy, true);
  }

  // 貪欲で届かなかった場合のフォールバック: 従来のビーム探索。
  // ビームは自前の最大ダメージで回し（停滞の判定を貪欲解に
  // 引きずられないため）、最後に貪欲側の記録と比べて良い方を
  // 返す。予算は全段階で共有する。
  const beamed = beamComposition(ctxs, targetsFor, startNode, stats, spend, {
    maxDepth, beamWidth, staleLimit,
  });
  if (beamed.preview.allKilled) return finish(beamed, true);
  return finish(beamed.preview.totalDamage > best.preview.totalDamage ? beamed : best, false);
}

// ビーム探索（フォールバック用）。深さごとに層を広げ、ダメージ
// 順と同時爆破の個数順の両方で候補を残す。最大ダメージが
// staleLimit 深さの間伸びなければ打ち切る。best は自前で持ち、
// 呼び出し側が貪欲側の記録とマージする。
function beamComposition(ctxs, targetsFor, startNode, stats, spend, opts) {
  const { maxDepth, beamWidth, staleLimit } = opts;
  const cap = typeof opts.cap === 'number' ? opts.cap : Number.POSITIVE_INFINITY;
  const over = () => stats.budgetHit || stats.expansions >= cap;
  let best = startNode;
  let layer = [startNode];
  let lastImproveDepth = 0;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const seen = new Map();
    for (const node of layer) {
      if (over()) break;
      for (const ctx of ctxs) {
        if (over()) break;
        // 使用回数の一律制限は置かない。制限は「同じ能力のボムは
        // 同じ対象に同時に1個まで」と「1体に3個まで」だけ（場の
        // 判定が担保する）。別対象への再使用や、錬成で消費された
        // 後の再使用は当然にできる。1回のみなのは秘奥義だけ。
        for (const t of targetsFor(ctx)) {
          if (!spend()) break;
          const next = applyAction(node.field, ctx, t, 0);
          if (!next) continue;
          const sig = fieldSignature(next);
          if (seen.has(sig)) continue;
          const hands = [...node.hands, {
            memberId: ctx.member.id, memberName: ctx.member.name,
            actionKey: ctx.action.key, medium: ctx.action.medium,
            name: ctx.action.name, target: t, secret: Boolean(ctx.action.secret),
          }];
          const cand = { field: next, hands, preview: previewDetonation(next) };
          seen.set(sig, cand);
          if (cand.preview.totalDamage > best.preview.totalDamage) {
            best = cand;
            lastImproveDepth = depth;
          }
        }
      }
    }
    const nextLayer = [...seen.values()];
    if (!nextLayer.length) break;
    const solved = nextLayer.filter((n) => n.preview.allKilled);
    if (solved.length) {
      solved.sort((a, b) => b.preview.totalDamage - a.preview.totalDamage);
      return solved[0];
    }
    if (over()) break;
    // 停滞の打ち切り: 最大ダメージが staleLimit 深さの間まったく
    // 伸びていないなら、それ以上手を重ねても届かないとみなす。
    if (depth - lastImproveDepth >= staleLimit) break;
    // ビームはダメージ順だけにしない。範囲の速・重を複数敵へ
    // ばらまいて同時爆破の個数を稼ぐ構成は、途中経過のダメージが
    // 低くても少ない手数で全滅に届くことがあるため、個数順の
    // 上位も残して候補の多様性を保つ。
    const keep = new Map();
    const byDamage = [...nextLayer]
      .sort((a, b) => b.preview.totalDamage - a.preview.totalDamage);
    for (const n of byDamage.slice(0, beamWidth)) keep.set(fieldSignature(n.field), n);
    const byCount = [...nextLayer].sort((a, b) => (b.preview.simulCount - a.preview.simulCount)
      || (b.preview.totalDamage - a.preview.totalDamage));
    for (const n of byCount.slice(0, Math.floor(beamWidth / 2))) {
      keep.set(fieldSignature(n.field), n);
    }
    layer = [...keep.values()];
  }
  return best;
}

// ---- ターン数から（手の並びの最適解と再生計算） ----
// hands: [{ memberId, actionKey, target }]（actionKey は action.key、
// オーブは 'orb'）。ターンは並びから流し込みで決まる: 1ターンの
// 予算は5手+そのターンに使ったフォトン追加の手が足す分。
// meGaugeMembers: リヴァイアサンMEで「Hボム付与で覚醒+1」が
// 効く memberId の集合。secretGaugeOf: memberId -> 秘奥義の
// ゲージ数（経過ターン条件に使う）。
export function buildReplayCtx(data, members, enemies, opts = {}) {
  const ctxByMember = new Map();
  for (const m of members) {
    const map = new Map();
    for (const ctx of memberActions(data, m)) map.set(ctx.action.key, ctx);
    ctxByMember.set(m.id, map);
  }
  return {
    members,
    enemies,
    ctxByMember,
    meGaugeMembers: opts.meGaugeMembers || new Set(),
    secretGaugeOf: opts.secretGaugeOf || new Map(),
    memberById: new Map(members.map((m) => [m.id, m])),
  };
}

function newReplayState(ctx) {
  return {
    field: emptyField(ctx.enemies),
    gauges: new Map(ctx.members.map((m) => [m.id, 0])),
    orbLastUsed: new Map(),
    secretUsed: false,
    turn: 1,
    pool: HANDS_PER_TURN,
  };
}

function cloneReplayState(st) {
  return {
    field: st.field, // 場は applyAction が複製して返すため共有でよい
    gauges: new Map(st.gauges),
    orbLastUsed: new Map(st.orbLastUsed),
    secretUsed: st.secretUsed,
    turn: st.turn,
    pool: st.pool,
  };
}

// 1手を再生状態へ適用する。st は書き換えず、新しい状態と
// その手の記録（成否・理由・注記）を返す。
function stepHand(ctx, st, hand) {
  const member = ctx.memberById.get(hand.memberId);
  const actx = member && ctx.ctxByMember.get(member.id)
    ? ctx.ctxByMember.get(member.id).get(hand.actionKey) : null;
  const base = {
    hand,
    memberName: member ? member.name : '',
    medium: actx ? actx.action.medium : '',
    actionName: actx ? actx.action.name : '',
    targetName: typeof hand.target === 'number' && ctx.enemies[hand.target]
      ? ctx.enemies[hand.target].name : null,
  };
  if (!member || !actx) {
    return { st, step: { ...base, turn: st.turn, ok: false, reason: '行動が引けません', note: '' } };
  }
  const a = actx.action;
  const isFree = Boolean(a.free);
  const next = cloneReplayState(st);
  // 特性の手（free）は手数を消費しないため、プールが空でも
  // ターンを進めない（誰かのアタックに付随する発生）。
  if (!isFree && next.pool <= 0) { next.turn += 1; next.pool = HANDS_PER_TURN; }
  const turn = next.turn;
  // Lv段階のある行動は、この手で効く形（現在のLv）で見る。
  const effA = effectiveAction(next.field, actx, turn);
  let ok = true;
  let reason = null;
  let note = '';
  // オーブのCT: 使ったターンから CT 分のターンが空く。
  if (a.medium === 'オーブ' && actx.orbCt) {
    const last = next.orbLastUsed.get(member.id);
    if (typeof last === 'number' && turn - last <= actx.orbCt) {
      ok = false; reason = 'オーブはCT中';
    }
  }
  if (ok && a.secret) {
    const need = ctx.secretGaugeOf.get(member.id);
    if (next.secretUsed) { ok = false; reason = '秘奥義は1回のみ'; }
    else if (typeof need === 'number' && turn < need) {
      ok = false; reason = `秘奥義は${need}ターン目から`;
    }
  }
  if (ok && a.gaugeUse) {
    const max = member.gaugeMax || 0;
    if ((next.gauges.get(member.id) || 0) < max) {
      ok = false; reason = '覚醒ゲージが足りません';
    }
  }
  if (ok && (effA.place || effA.ren || effA.enhance || effA.debuff)) {
    const applied = applyAction(next.field, actx, hand.target || 0, turn);
    if (applied) {
      next.field = applied;
      if (applied.secretUsed) next.secretUsed = true;
    } else {
      const chk = checkAction(next.field, actx, hand.target || 0, { secretUsed: next.secretUsed, atTurn: turn });
      ok = false; reason = chk.reason || '使えません';
    }
  }
  if (ok && effA.debuff) {
    const parts = [];
    if (effA.debuff.defDown) parts.push(`防御力低下${Math.round(effA.debuff.defDown.pct * 100)}%`);
    if (effA.debuff.weak) parts.push('虚弱');
    if (parts.length) note = parts.join('・');
  }
  if (ok && a.steal) {
    const targets = targetsOf(next.field, a, hand.target || 0);
    const anyBombs = targets.some((i) => next.field.enemies[i].bombs.length > 0);
    if (!anyBombs) { ok = false; reason = 'ボムがある敵に使う'; }
    else {
      const gain = targets.length;
      next.gauges.set(member.id, (next.gauges.get(member.id) || 0) + gain);
      note = `覚醒ゲージ+${gain}`;
    }
  }
  if (!ok) return { st, step: { ...base, turn, ok, reason, note } };
  if (!isFree) {
    next.pool -= 1;
    if (a.grantsPhoton) { next.pool += a.grantsPhoton; note = `フォトン+${a.grantsPhoton}`; }
    if (a.medium === 'オーブ' && actx.orbCt) next.orbLastUsed.set(member.id, turn);
    if (a.setsAwakened) next.gauges.set(member.id, member.gaugeMax || 0);
    else if (a.gaugeUse) next.gauges.set(member.id, 0);
    else next.gauges.set(member.id, (next.gauges.get(member.id) || 0) + 1);
  }
  // リヴァイアサンME: Hボムを付与したとき覚醒+1。
  if ((effA.place || effA.ren) && ctx.meGaugeMembers.has(member.id)) {
    next.gauges.set(member.id, (next.gauges.get(member.id) || 0) + 1);
    note = note ? `${note}・覚醒ゲージ+1` : '覚醒ゲージ+1（マスエフェクト）';
  }
  if (a.secret) next.secretUsed = true;
  return { st: next, step: { ...base, turn, ok, reason, note } };
}

function finishReplay(ctx, st, steps, detonateTurn) {
  const field = st.field;
  // 起爆の判定: 最も早く弾けるボムが起爆ターンちょうどに来ること。
  const expiries = [];
  field.enemies.forEach((e) => e.bombs.forEach((b) => expiries.push(b.placedTurn + b.fuse)));
  const clockTurn = expiries.length ? Math.min(...expiries) : null;
  let clockError = null;
  if (!expiries.length) clockError = 'ボムがありません';
  else if (clockTurn < detonateTurn) clockError = `${clockTurn}ターン目に爆発してしまいます`;
  else if (clockTurn > detonateTurn) clockError = `${detonateTurn}ターン目では爆発しません`;
  const preview = previewDetonation(field, { atTurn: detonateTurn });
  const allOk = steps.every((s) => s.ok);
  return {
    steps, field, gauges: st.gauges, preview, clockTurn, clockError,
    valid: allOk && !clockError,
    turnsUsed: steps.length ? steps[steps.length - 1].turn : 0,
    layout: formationLayout(ctx.enemies),
    finalState: st,
  };
}

// 並びの末尾に1手を足せるか（追加候補の使用可否表示に使う）。
// replay は replayHands の戻り値、その手の成否と理由を返す。
export function probeHand(ctx, replay, hand) {
  if (!replay || !replay.finalState) return { ok: false, reason: '材料がありません' };
  return stepHand(ctx, replay.finalState, hand).step;
}

export function replayHands(ctx, hands, detonateTurn) {
  let st = newReplayState(ctx);
  const steps = [];
  hands.forEach((hand, hi) => {
    const r = stepHand(ctx, st, hand);
    st = r.st;
    // 成功した手が新しく付けた付着には、その手の番号を刻む
    // （付着の発生源の手を特定するため。同じ発生源の上書きで
    // 作り直された付着は、付け直した手の番号になる）。
    if (r.step.ok) {
      for (const e of st.field.enemies) {
        for (const d of e.debuffs || []) {
          if (typeof d.hand !== 'number') d.hand = hi;
        }
      }
    }
    steps.push(r.step);
  });
  return finishReplay(ctx, st, steps, detonateTurn);
}

// ターン数モードの最適解。起爆ターンに全敵を倒せる最小の並びを
// 探し、無ければ最大ダメージの並びを返す。評価は「実際の
// ダメージ+材料の見込み+起爆の時計になるボムの有無」で、防御
// 9999級の敵では序盤の実ダメージが全て0になるため、材料の
// 見込みが無いと探索が進まない。速も通常のボムとして数える
// （起爆の時計は導火線の結果であって、速だけの役目ではない）。
// 奥義・覚醒スキルの再使用はゲージの再生計算が許す範囲で可
// （stepHand の判定どおり）。
// 探索の主軸（2026-11-19 作り替え）: 錬モードと同じく、まず
// 貪欲に深く潜って到達可能な並びを早期に得て、その手数を上限に
// それより短い並びだけを深さ限定のビーム探索で探す。貪欲で
// 全滅に届かなかった場合は深さ優先で全滅の並びを探し（最良
// ダメージが伸びない展開が続いたら打ち切る）、最後に従来の
// ビーム探索にも落として結果をマージする。
// 打ち切り: 全段階で展開回数の予算（budget）を共有し、超えたら
// その時点の最大ダメージの並びを返す（錬モードと同じ保証）。
export function solveSequence(ctx, detonateTurn, opts = {}) {
  const beamWidth = opts.beamWidth || 250;
  const budget = opts.budget || 200000;
  const branchLimit = opts.branchLimit || 6;
  const shortenBudget = opts.shortenBudget || 40000;
  const seekStale = opts.seekStale || 25000;
  const maxHands = HANDS_PER_TURN * detonateTurn + 12;
  const allCtxs = ctx.members.flatMap((m) => memberActionsForSolve(ctx, m));
  // 種類だけの行動は虚弱の数えにしか効かない。編成に虚弱の手が
  // 無ければ候補から外す（錬モードの探索と同じ方針）。
  const hasWeak = allCtxs.some((c) => actionSnapshots(c.action)
    .some((s) => s && s.debuff && s.debuff.weak));
  const ctxs = hasWeak ? allCtxs : allCtxs.filter((c) => !isTypesOnlyOverall(c.action));
  const stats = { expansions: 0, budgetHit: false };
  const spend = () => {
    stats.expansions += 1;
    if (stats.expansions > budget) { stats.budgetHit = true; return false; }
    return true;
  };
  // 列範囲の行動は、同じ列のどの敵を対象にしても結果が同じになる。
  // 展開は列の代表（最初の敵）だけに絞る（結果は変わらない）。
  const { rowOf } = formationLayout(ctx.enemies);
  const rowReps = [];
  {
    const seenRows = new Set();
    ctx.enemies.forEach((_, i) => {
      if (!seenRows.has(rowOf[i])) { seenRows.add(rowOf[i]); rowReps.push(i); }
    });
  }
  const targetListFor = (c) => (!(actionHasEffectAtAnyLevel(c.action) || c.action.steal)
    ? [0]
    : c.action.range === 'all' ? [0]
      : c.action.range === 'row' ? rowReps
        : ctx.enemies.map((_, i) => i));

  // 並びの評価: 敵ごとの実ダメージ（HPで頭打ち）+まだ倒せて
  // いない敵の材料の見込み×0.05+起爆の時計が作れていること
  // +ゲージの進み。時計の有無が支配的になるよう大きく置く。
  const scoreOf = (st, preview) => {
    let s = 0;
    ctx.enemies.forEach((e, i) => {
      const p = preview.perEnemy[i];
      const hp = typeof e.hp === 'number' ? effectiveHpOf(e) : p.total;
      s += Math.min(p.total, hp);
      s += enemyMaterial(st.field.enemies[i]) * (p.total < hp ? 0.05 : 0.025);
    });
    if (clockTurnOf(st.field) === detonateTurn) s += 1e6;
    for (const m of ctx.members) {
      const max = m.gaugeMax || 0;
      if (max > 0) s += 200 * (Math.min(st.gauges.get(m.id) || 0, max) / max);
    }
    return s;
  };
  const cappedDamageOf = (preview) => preview.perEnemy.reduce((sum, p, i) => {
    const hp = typeof ctx.enemies[i].hp === 'number' ? effectiveHpOf(ctx.enemies[i]) : p.total;
    return sum + Math.min(p.total, hp);
  }, 0);

  // 返却候補の記録: 成立（時計が合う）並びを優先し、その中では
  // 実ダメージの大きいもの。成立する並びが無ければ最大ダメージ。
  let bestValid = null; // { hands, dmg, capped }
  let bestAny = { hands: [], dmg: 0, capped: 0 };
  let staleMark = 0; // 最良（頭打ち）ダメージが意味のある伸びをした時点の展開数
  const consider = (node) => {
    const dmg = node.preview.totalDamage;
    const capped = cappedDamageOf(node.preview);
    if (clockTurnOf(node.st.field) === detonateTurn) {
      if (!bestValid || dmg > bestValid.dmg) bestValid = { hands: node.hands, dmg, capped };
    }
    if (dmg > bestAny.dmg) bestAny = { hands: node.hands, dmg, capped };
    const curBestCapped = bestValid ? bestValid.capped : bestAny.capped;
    if (curBestCapped > (consider.bestCapped || 0) * 1.001 + 100) {
      consider.bestCapped = curBestCapped;
      staleMark = stats.expansions;
    }
  };

  // 1手進めた候補の生成: stepHand が通り、起爆ターンより前に
  // 弾けるボムができないものだけを、評価の高い順に並べる。
  // 予算切れは null。
  const stepCandidates = (node) => {
    const out = [];
    for (const c of ctxs) {
      for (const t of targetListFor(c)) {
        if (!spend()) return null;
        const hand = { memberId: c.member.id, actionKey: c.action.key, target: t };
        const { st, step } = stepHand(ctx, node.st, hand);
        if (!step.ok) continue;
        if (st.turn > detonateTurn) continue;
        // 起爆ターンより前に弾けるボムができた並びは捨てる。
        const early = st.field.enemies.some((e) => e.bombs
          .some((b) => b.placedTurn + b.fuse < detonateTurn));
        if (early) continue;
        const hands = [...node.hands, hand];
        const preview = previewDetonation(st.field, { atTurn: detonateTurn });
        const cand = { hands, st, preview, score: scoreOf(st, preview) };
        consider(cand);
        out.push(cand);
      }
      if (stats.budgetHit) return null;
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };

  const startNode = {
    hands: [],
    st: newReplayState(ctx),
    preview: previewDetonation(emptyField(ctx.enemies), { atTurn: detonateTurn }),
  };
  const killsNow = (node) => node.preview.allKilled
    && clockTurnOf(node.st.field) === detonateTurn;

  // 第1段階: 貪欲な深掘り。その時点で最も撃破に近づく手を
  // 繰り返し選び、実プレイの線を先に得る。
  let greedyKill = null;
  {
    let node = startNode;
    while (node.hands.length < maxHands) {
      const cands = stepCandidates(node);
      if (!cands || !cands.length) break;
      node = cands[0];
      if (killsNow(node)) { greedyKill = node; break; }
    }
  }

  // 分枝限定の深さ優先探索（短縮と未達時の探索で共用）。
  // stopWhen が真を返したら探索全体を打ち切る（理由は呼び出し側
  // のフラグで持ち、尽きて終わったのかを区別する）。
  const dfsSequence = (limit, stopWhen) => {
    const memo = new Map();
    const rec = (node, depth) => {
      if (stats.budgetHit || (stopWhen && stopWhen())) return null;
      if (killsNow(node)) return node;
      if (depth >= limit) return null;
      const sig = replaySigOf(node.st);
      if (memo.has(sig) && memo.get(sig) <= depth) return null;
      memo.set(sig, depth);
      const cands = stepCandidates(node);
      if (!cands) return null;
      for (const cand of cands.slice(0, branchLimit)) {
        const r = rec(cand, depth + 1);
        if (r) return r;
      }
      return null;
    };
    return rec(startNode, 0);
  };

  const finishWith = (hands) => {
    const replay = replayHands(ctx, hands, detonateTurn);
    return {
      hands, replay,
      solved: Boolean(replay.valid && replay.preview.allKilled),
      stats,
    };
  };

  if (greedyKill) {
    // 第2段階: 解の手数を上限に、それより短い並びだけを探す。
    // 深さ限定のビーム探索（上限=解の手数-1）で、最初に全滅が
    // 出た深さが最小手数になる。短縮の探索には専用の展開枠
    // （shortenBudget）を置き、尽きたら貪欲解を返す。
    const phaseStart = stats.expansions;
    const beamed = beamSequence(ctx, ctxs, targetListFor, detonateTurn, {
      hands: [], replay: replayHands(ctx, [], detonateTurn),
    }, stats, spend, {
      beamWidth: opts.shortenBeamWidth || 120,
      maxHands: greedyKill.hands.length - 1,
      cap: phaseStart + shortenBudget,
    });
    if (beamed.killed) return finishWith(beamed.hands);
    return finishWith(greedyKill.hands);
  }

  // 貪欲で全滅に届かなかった場合: 深さ優先で全滅の並びを探す。
  // 最良ダメージが伸びない展開が seekStale だけ続いたら打ち切る。
  staleMark = stats.expansions;
  consider.bestCapped = bestValid ? bestValid.capped : bestAny.capped;
  let staleHit = false;
  const seekFound = dfsSequence(maxHands, () => {
    if (stats.expansions - staleMark > seekStale) { staleHit = true; return true; }
    return false;
  });
  if (seekFound) return finishWith(seekFound.hands);

  // 深さ優先で届かなかった場合は従来のビーム探索にも落とし、
  // 結果をマージする: 全滅＞時計の成立＞実ダメージの順で選ぶ。
  // ビームは自前の最大ダメージで回し、予算は共有する。
  const beamed = beamSequence(ctx, ctxs, targetListFor, detonateTurn, {
    hands: [], replay: replayHands(ctx, [], detonateTurn),
  }, stats, spend, { beamWidth, maxHands });
  if (beamed.killed) return finishWith(beamed.hands);
  const beamValid = Boolean(beamed.replay.valid);
  const beamDmg = beamed.replay.preview.totalDamage;
  const incumbent = bestValid
    ? { hands: bestValid.hands, dmg: bestValid.dmg, valid: true }
    : { hands: bestAny.hands, dmg: bestAny.dmg, valid: false };
  if (beamValid !== incumbent.valid) {
    return finishWith(beamValid ? beamed.hands : incumbent.hands);
  }
  return finishWith(beamDmg > incumbent.dmg ? beamed.hands : incumbent.hands);
}

// ビーム探索（フォールバック用）。深さごとに層を広げ、評価順と
// 同時爆破の個数順の両方で候補を残す。
function beamSequence(ctx, ctxs, targetListFor, detonateTurn, initBest, stats, spend, opts) {
  const { beamWidth, maxHands } = opts;
  const cap = typeof opts.cap === 'number' ? opts.cap : Number.POSITIVE_INFINITY;
  const over = () => stats.budgetHit || stats.expansions >= cap;
  let best = initBest;
  let layer = [{ hands: [], st: newReplayState(ctx), steps: [] }];
  for (let depth = 1; depth <= maxHands; depth += 1) {
    const seen = new Map();
    const found = [];
    for (const node of layer) {
      if (over()) break;
      for (const c of ctxs) {
        if (over()) break;
        for (const t of targetListFor(c)) {
          if (!spend()) break;
          const hand = { memberId: c.member.id, actionKey: c.action.key, target: t };
          const { st, step } = stepHand(ctx, node.st, hand);
          if (!step.ok) continue;
          if (st.turn > detonateTurn) continue;
          // 起爆ターンより前に弾けるボムができた並びは捨てる。
          const early = st.field.enemies.some((e) => e.bombs
            .some((b) => b.placedTurn + b.fuse < detonateTurn));
          if (early) continue;
          const sig = replaySigOf(st);
          if (seen.has(sig)) continue;
          const hands = [...node.hands, hand];
          const steps = [...node.steps, step];
          const replay = finishReplay(ctx, st, steps, detonateTurn);
          seen.set(sig, {
            hands, st, steps, replay,
            score: sequencePotential(ctx, st, replay.preview, detonateTurn),
          });
          if (replay.valid && replay.preview.allKilled) found.push({ hands, replay });
          if (replay.preview.totalDamage > best.replay.preview.totalDamage) {
            best = { hands, replay };
          }
        }
      }
    }
    if (found.length) {
      // 同じ手数で成立する並びが複数あれば、使うターンが少なく
      // 余りの大きいものを選ぶ。
      found.sort((a, b) => (a.replay.turnsUsed - b.replay.turnsUsed)
        || (b.replay.preview.totalDamage - a.replay.preview.totalDamage));
      return { ...found[0], killed: true };
    }
    if (over()) break;
    const nextLayer = [...seen.values()];
    if (!nextLayer.length) break;
    // ビームは評価順だけにしない。同時爆破の個数を稼ぐばらまき型
    // の途中経過も残す（錬モードの探索と同じ方針）。
    const keep = new Map();
    const byScore = [...nextLayer].sort((a, b) => b.score - a.score);
    for (const n of byScore.slice(0, beamWidth)) keep.set(replaySigOf(n.st), n);
    const byCount = [...nextLayer].sort((a, b) => (b.replay.preview.simulCount - a.replay.preview.simulCount)
      || (b.score - a.score));
    for (const n of byCount.slice(0, Math.floor(beamWidth / 2))) keep.set(replaySigOf(n.st), n);
    layer = [...keep.values()];
  }
  return { ...best, killed: Boolean(best.replay.valid && best.replay.preview.allKilled) };
}

function memberActionsForSolve(ctx, member) {
  const map = ctx.ctxByMember.get(member.id);
  return map ? [...map.values()] : [];
}
