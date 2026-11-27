// 敵を読む（M4）・編成のカバー判定（M5）・需要の集計（H6）の純粋関数群。
// 材料は生成データだけ: 手段の索引（means-index）、対策クラス
// （counter-classes）、階ごとの敵の事実（enemies/floor-XX）。
// 索引は本体能力・専用霊宝・オーブ・マスエフェクト（ME）由来を含む。
// ME 由来の手段は保持者（megidoMe）に分けて持ち、候補では媒体
// 「マスエフェクト（リーダー必須）」として出す。カバー判定では、
// 保持者が編成のリーダーである場合にだけ数える。
// DOM・保存には触れない。

// 耐性表の略記 → 正式名（表示と脅威の対応づけに使う範囲だけ）。
const POLE_ALIASES = {
  '煉獄': '煉獄の炎',
  'ねずみ': 'ねずみ化',
  'F壊': 'フォトン破壊',
  'F奪': 'フォトン奪取',
  'F転': 'フォトン変換',
  'F容↓': 'フォトン容量低下',
  'F劣': 'フォトン劣化',
  '覚醒↓': '覚醒ゲージ低下',
  '覚醒+↓': '覚醒ゲージ上昇量低下',
  '位置': '位置の変更（ノックバック・引き寄せ）',
  '弱体': '弱体全般',
};

export function normalizePoleName(name) {
  return POLE_ALIASES[name] || name;
}

// ---- 敵の耐性と、付与系の答えの適格（相談 5-16・導出監査 型5） ----
// 付与系の手段は、敵の耐性表（symbolTable）に通りやすさの段階がある。
// 演算上は ◎・○・ー を答えとして有効とし、△・×・無効 は無効と同等に
// 扱う（候補・カバー・需要の全て）。耐性表に項目が無い効果は判定材料が
// 無いため有効として扱う（例: 煉獄の炎は全敵で通常耐性と確定済み）。
// ピッカーの表示では細かい段階も併記する（resistGradeOf を使う）。

// inflict:* 以外で、耐性表に対応項目がある効果。
const EFFECT_RESIST_NAME = {
  'photon:destroy': 'フォトン破壊',
  'photon:steal': 'フォトン奪取',
  'photon:convert': 'フォトン変換',
  'photon:degrade': 'フォトン劣化',
  'photon:capacity-down': 'フォトン容量低下',
  'gauge:down': '覚醒ゲージ低下',
  'gauge:up-down': '覚醒ゲージ上昇量低下',
};

// 効果が「敵に通す」種類なら、耐性表で引く名前を返す。対象外は null。
export function effectResistName(effectId) {
  if (!effectId) return null;
  if (effectId.startsWith('inflict:')) return effectId.slice('inflict:'.length);
  return EFFECT_RESIST_NAME[effectId] || null;
}

// 敵の耐性表（VH の列）から、その効果の記号を返す。項目が無い・
// 効果が対象外なら null。
// 敵の耐性データの出所（SW95 便1）: 'tower' = 塔版で実地確認
// された値（ユーザー提供の実地素材由来は35Fの3種だけ）、
// 'main' = メインクエスト版の検証値（塔版と同一とは限らない）、
// null = 耐性データ自体が無い。生成データの
// resistances.provenance をそのまま返す。塔版で検証できない種の
// 耐性を断定しないための材料で、導出の結果（threatsForEnemy の
// resistanceProvenance）にも付けて運ぶ。なお型5・状態特効の
// 演算は、相談 5-16 と積1 の確定した物差しどおり、この区分では
// 止めない（区分は表示側で「塔版未検証」と添えるためのもの）。
export function resistanceProvenanceOf(enemyFact) {
  if (!enemyFact || !enemyFact.resistances) return null;
  return enemyFact.resistances.provenance || null;
}

export function resistGradeOf(enemyFact, effectId) {
  const name = effectResistName(effectId);
  if (!name || !enemyFact) return null;
  const table = (enemyFact.resistances && enemyFact.resistances.symbolTable) || {};
  let partial = null;
  for (const [key, grades] of Object.entries(table)) {
    const keyName = normalizePoleName(key);
    const vh = grades && grades[2];
    if (typeof vh !== 'string' || !vh) continue;
    if (keyName === name) return vh;
    // 「位置の変更（ノックバック・引き寄せ）」のように、正式名の中に
    // 異常名を含む項目は部分一致でも引く（完全一致を優先）。
    if (partial === null && keyName.includes(name)) partial = vh;
  }
  return partial;
}

// その効果が、この敵には演算上無効か（△・×・無効）。
export function effectInvalidAgainst(enemyFact, effectId) {
  const grade = resistGradeOf(enemyFact, effectId);
  return grade === '△' || grade === '×' || grade === '無効';
}

// 索引を使いやすい形に組む。byMegido は本体・専用霊宝由来、
// byMegidoMe はマスエフェクト由来（保持者は ME の持ち主）。
export function buildIndex(meansData) {
  const byEffect = new Map();
  const byMegido = new Map();
  const byMegidoMe = new Map();
  const byOrb = new Map();
  for (const effect of (meansData && meansData.effects) || []) {
    byEffect.set(effect.id, effect);
    for (const h of effect.megido || []) {
      if (!byMegido.has(h.id)) byMegido.set(h.id, []);
      byMegido.get(h.id).push({ effectId: effect.id, effectName: effect.name, via: h.via });
    }
    for (const h of effect.megidoMe || []) {
      if (!byMegidoMe.has(h.id)) byMegidoMe.set(h.id, []);
      byMegidoMe.get(h.id).push({ effectId: effect.id, effectName: effect.name, via: h.via });
    }
    for (const h of effect.orbs || []) {
      if (!byOrb.has(h.orbId)) byOrb.set(h.orbId, []);
      byOrb.get(h.orbId).push({ effectId: effect.id, effectName: effect.name, via: h.via });
    }
  }
  return { byEffect, byMegido, byMegidoMe, byOrb, coverage: meansData ? meansData.coverage : null };
}

// ---- 凸（シンギュラリティ）の解禁と、耐性の数値 ----
// 索引の via には、＋＋形・第二特性から導出した手段に needLevel
// （解禁に要る凸）が入る。保持者の現在の凸（levelOf が返す値）と
// 突き合わせ、足りない手段は「凸Nで解禁」として区別する。
export function viaNeedLevel(v) {
  return v && typeof v.needLevel === 'number' ? v.needLevel : 0;
}

// その via が、現在の凸で使える分だけを返す（level が不明なら全部）。
export function usableVias(via, level) {
  const vs = via || [];
  if (typeof level !== 'number') return vs;
  return vs.filter((v) => viaNeedLevel(v) <= level);
}

// 全ての via が凸不足なら、解禁に要る最小の凸を返す。使える via が
// 1つでもあれば null。
export function lockedLevel(via, level) {
  const vs = via || [];
  if (typeof level !== 'number' || vs.length === 0) return null;
  if (vs.some((v) => viaNeedLevel(v) <= level)) return null;
  return Math.min(...vs.map(viaNeedLevel));
}

// 手段1件の数値（耐性率など）。via の数値の最大を取る。数値が
// 読み取れない via しか無い場合は null。
export function meansValue(via) {
  let best = null;
  for (const v of via || []) {
    if (typeof v.value === 'number') best = best === null ? v.value : Math.max(best, v.value);
  }
  return best;
}

// ---- 進化度・レベル制限（制限マス一般） ----
// 正本: corpus-status/育成解放.json（解放表と確定解釈）と
// research/floor31-restriction-prep.md の相談の記録（2026-11-20）。
// 制限の段階（星・Lv）はマスごとに違う（31階=星2.5/Lv23、
// 33階=星5.5/Lv65、35階=星3.5/Lv45）。使える形は、そのマスの
// 段階から解放表で機械的に導く:
//   第1特性=星2 / 覚醒スキル=星3 / スキル+=星4 /
//   覚醒スキル+・第3ME（サブME）=星5 / 奥義+・秘奥義=星6。
//   専用霊宝が条件の形と、媒体が専用霊宝自身の形は、専用霊宝の
//   要件（星3・Lv30以上）を満たす段階でのみ使える。霊宝の匣は
//   星3で解放される。
//   ++形と凸の解放分（needLevel）は、制限下では段階によらず
//   使えない（正本 singularityUnderRestriction: 進化の制限が
//   かかっている時、凸で解放される分は解放されない）。
//   マスエフェクト（第1・第2ME）とオーブは制限の対象外。
// 表示はホワイトリスト方式（ユーザー確定）: ステータス（Lv）に
// 依存しない機構だけを答えとして出し、それ以外は印も付けず隠す。
// 機構がどの敵に通るかは、付与系については既存の耐性の適格
// （型5: ◎・○・ー を有効、△・×・無効 を無効）が敵ごとに分ける。

export const RESTRICTION_RULE_MARK = '進化度・レベル制限';

// 31階の制限（正本 tower31F）。段階が省略された呼び出しの既定と、
// マーカーはあるが数値が読めないルール文への当てはめに使う。
export const RESTRICTION_31F = { star: 2.5, level: 23 };

// マスのルール文から制限の段階（星・Lv）を読み取る。制限の無い
// マスでは null。書式は「進化度・レベル制限：⭐︎2.5/Lv23」。
// マーカーはあるが数値が読めない場合は、既知で最も厳しい31階の
// 段階として扱う（使える形は広げるより狭める側が安全なため）。
export function restrictionOf(def) {
  if (!def || !Array.isArray(def.rules)) return null;
  const rule = def.rules.find((r) => String(r).includes(RESTRICTION_RULE_MARK));
  if (rule === undefined) return null;
  const text = String(rule);
  // 書式は「⭐︎2.5/Lv23」（星の字は異体字セレクタ付きのため、星の
  // 字そのものではなく「数値/Lv数値」の並びで読む）。
  const m = text.match(/(\d+(?:\.\d+)?)\s*[/／]\s*Lv\s*(\d+)/);
  if (!m) return { ...RESTRICTION_31F };
  return { star: Number(m[1]), level: Number(m[2]) };
}

// マスのルール文に制限が付いているか。戦闘マス側の判定の正は
// これ（prep §3）。31階の戦闘マス15マス全てに付き、ボスマス
// （マモン）と探索マスには付かない。
export function isRestrictedDef(def) {
  return restrictionOf(def) !== null;
}

// 呼び出し側の restricted 引数を段階へ正規化する: 偽値は制限なし
// （null）、true は31階の段階（従来の呼び出しとの互換）、段階の
// オブジェクトはそのまま。
export function normalizeRestriction(restricted) {
  if (!restricted) return null;
  if (restricted === true) return RESTRICTION_31F;
  return restricted;
}

// 解放表の閾値（corpus-status/育成解放.json の table）。
const UNLOCK_STAR = {
  trait: 2, // 特性
  awakenedSkill: 3, // 覚醒スキル
  skillPlus: 4, // スキル+
  awakenedPlus: 5, // 覚醒スキル+
  subMe: 5, // 第3ME
  ougiPlus: 6, // 奥義+
  secretOugi: 6, // 秘奥義
};
// 専用霊宝の要件（正本 exclusiveReishou: ☆3・Lv30以上）。
const DEDICATED_REISHOU_STAR = 3;
const DEDICATED_REISHOU_LEVEL = 30;

// ラベルの「形の位置」にある ＋ の連続数の最大（0/1/2）。+形の
// 判定はラベル（技能名）への依存になる（prep 1-1。専用霊宝の
// 判定と同じ流儀）: 技能名の末尾か、注記（「（…）」「 Lv…」）の
// 直前に付く ＋/＋＋/+ を形の印とする。「（巨大化+かばう」の
// ような条件文中の + は形ではないため、後ろが 」・）・（・空白・
// 末尾 の場合だけを数える。1つなら+形、2つ以上なら++形。
function plusFormCount(label) {
  const runs = String(label || '').match(/[＋+]+(?=[」）\s（]|$)/g);
  if (!runs) return 0;
  return Math.max(...runs.map((r) => r.length));
}

// via 1件が、その制限（段階）下で使えるか。段階を省略した場合と
// true の場合は31階の段階で判定する（従来の呼び出しとの互換）。
export function viaUsableRestricted(v, restriction) {
  if (!v) return false;
  const prof = normalizeRestriction(restriction) || RESTRICTION_31F;
  // 凸の解放分は、制限下では段階によらず使えない（正本）。
  if (viaNeedLevel(v) > 0) return false;
  const label = v.label || '';
  // オーブとマスエフェクトは制限の対象外。オーブの via は索引では
  // src が skill/trait でラベルが「オーブスキル」「オーブ特性」。
  if (v.src === 'orb_skill' || v.src === 'orb_trait'
    || label === 'オーブスキル' || label === 'オーブ特性') return true;
  if (v.src === 'me') return true;
  const star = prof.star;
  // 媒体そのものが専用霊宝の形と、専用霊宝が条件の形は、専用
  // 霊宝を装備できる段階（星とレベルの両方）でのみ使える。
  const dedicatedOk = star >= DEDICATED_REISHOU_STAR
    && prof.level >= DEDICATED_REISHOU_LEVEL;
  if (v.src === 'reishou') return dedicatedOk;
  if (/専用霊宝「[^」]*」装備時/.test(label)) return dedicatedOk;
  if (v.src === 'subme') return star >= UNLOCK_STAR.subMe;
  if (v.src === 'secret_ougi') return star >= UNLOCK_STAR.secretOugi;
  const plusCount = plusFormCount(label);
  // ++形（スキル++・覚醒スキル++・奥義++）は凸の解放分。
  if (plusCount >= 2) return false;
  const plus = plusCount === 1;
  if (v.src === 'trait') return star >= UNLOCK_STAR.trait;
  if (v.src === 'skill') return plus ? star >= UNLOCK_STAR.skillPlus : true;
  if (v.src === 'awakened_skill') {
    return plus ? star >= UNLOCK_STAR.awakenedPlus : star >= UNLOCK_STAR.awakenedSkill;
  }
  if (v.src === 'ougi') return plus ? star >= UNLOCK_STAR.ougiPlus : true;
  return true;
}

// 制限下で使える via だけを返す（元の配列は書き換えない）。
export function restrictedVias(via, restriction) {
  const prof = normalizeRestriction(restriction) || RESTRICTION_31F;
  return (via || []).filter((v) => viaUsableRestricted(v, prof));
}

// ホワイトリスト: 法則集（research/floor31-laws.md）の機構を
// 手段索引の効果IDへ写したもの。
// - 蘇生・自動蘇生（蘇生の循環）、かばう、バリア系（回数無効化。
//   カミハカリの全体無効化も barrier 系に索引されている）、
//   耐性（無効化）、予防、解除（都度回復）、フォトン破壊・奪取・
//   ゲージ削減（法則4）、弱体（debuff）、付与系（inflict。睡眠・
//   即死・煉獄を含む）、地形（terrain。割合・累積ダメージ）。
// - 特効（bonus:）は攻撃力に掛かる倍率で、機構ではない（需要で
//   数えない型4の方針とも一致）。回復（heal）は量がステータス
//   依存。強化解除（dispel:buff）は法則に無い。点穴・エレキ・
//   ハイドロボムの付与は、ダメージが Lv 依存の数値機構のため
//   機構の側に入れない。
const RESTRICTED_EFFECTS_EXACT = new Set([
  'revive', 'revive:auto', 'kabau',
  'barrier', 'barrier:block', 'barrier:count',
  'cure:ailment', 'cure:debuff', 'prevent:ailment',
  'photon:destroy', 'photon:steal', 'photon:destroy-resist', 'gauge:down',
  'debuff:atk', 'debuff:def', 'debuff:spd',
]);
const RESTRICTED_INFLICT_EXCLUDED = new Set(['inflict:点穴', 'inflict:エレキ', 'inflict:ハイドロボム']);

export function effectAllowedRestricted(effectId) {
  if (!effectId) return false;
  if (RESTRICTED_EFFECTS_EXACT.has(effectId)) return true;
  if (effectId.startsWith('resist:')) return true;
  if (effectId.startsWith('terrain:')) return true;
  if (effectId.startsWith('inflict:')) return !RESTRICTED_INFLICT_EXCLUDED.has(effectId);
  return false;
}

// フォトン破壊・奪取・覚醒ゲージ低下の3効果は、制限下では媒体で
// 数え方を分ける（2026-11-26 マスター決定。調査:
// hidden_files/restricted-whitelist-scope-work/investigation.md）。
// 法則4で裏づけがあるのは「干渉のためにアクションを払わない形」
// （エンジンや受動に相乗りする形）だけで、スキル・奥義・覚醒スキル
// で単体干渉をする専用の形は、31階では防御機構の維持で手数が
// 埋まるため根拠が無い。そのため、この3効果に限っては、制限下で
// 使える形（restrictedVias）の中でも ME（src が me）と特性（src が
// trait。オーブ特性も索引では src が trait）の via だけを数える。
// 絞り込みは保持者単位ではなく via 単位: 同じ保持者が特性の形と
// スキルの形を併せ持つ場合は、特性の形だけが残る。
// 例外: クロケルR のフォトン破壊は残す。正本のスキル文では破壊句は
// 大協奏形にのみあり、協奏エンジンの副次（法則4の代表例）だが、
// 手段索引の via の文は生成器が効果句だけを切り取るため、状態の
// 接頭辞（「大協奏:」）が索引に残らず、ラベルにも状態名が無い。
// 構造化フィールドでは判別できないため、保持者名の例外表で残す。
const RESTRICTED_MEDIUM_LIMITED_EFFECTS = new Set([
  'photon:destroy', 'photon:steal', 'gauge:down',
]);
const RESTRICTED_MEDIUM_EXCEPTIONS = new Set([
  'クロケルR|photon:destroy',
]);

// 制限下で使える via を、効果×媒体の許可まで含めて返す。媒体の
// 絞り込みの対象でない効果では restrictedVias と同じ結果になる。
export function restrictedViasForEffect(effectId, holderName, via, restriction) {
  const prof = normalizeRestriction(restriction) || RESTRICTION_31F;
  const base = restrictedVias(via, prof);
  if (!RESTRICTED_MEDIUM_LIMITED_EFFECTS.has(effectId)) return base;
  if (holderName && RESTRICTED_MEDIUM_EXCEPTIONS.has(`${holderName}|${effectId}`)) return base;
  return base.filter((v) => v.src === 'me' || v.src === 'trait' || v.src === 'orb_trait');
}

export function classesById(classesData) {
  const map = new Map();
  for (const t of (classesData && classesData.threats) || []) map.set(t.id, t);
  return map;
}

const METHOD_LABEL = { trait: '特性', skill: 'スキル', awakened: '覚醒スキル', ougi: '奥義' };

// 敵1種の事実から、脅威と耐性の両極を取り出す。
// 材料: 構成員の能力文（ある敵だけ）、特性の注記（全種）、種族、耐性表。
// 脅威には発生源（どの構成員が出すか）も付ける（敵シートの発生源別
// 表示のため、2026-11-20 相談 5-13）。本体は party の leader の構成員、
// それ以外は取り巻き。発生源が特定できない脅威（特性の注記由来など）は
// sources が空で、表示側は敵全体の脅威として扱う。
export function threatsForEnemy(enemyFact, clsById) {
  const threats = [];
  const seen = new Set();
  const ailmentNames = [...clsById.values()].filter((t) => t.kind === 'ailment').map((t) => t.name);
  const add = (threatId, method, evidence, origin) => {
    if (!clsById.has(threatId)) return;
    const key = threatId;
    let t = threats.find((x) => x.threatId === key);
    if (!t) {
      t = { threatId, name: clsById.get(threatId).name, methods: [], evidence: '', sources: [] };
      threats.push(t);
      seen.add(key);
    }
    if (method && !t.methods.includes(method)) t.methods.push(method);
    if (evidence && !t.evidence) t.evidence = evidence;
    if (origin) {
      let src = t.sources.find((x) => x.member === origin.member);
      if (!src) {
        src = { member: origin.member, leader: !!origin.leader, methods: [] };
        t.sources.push(src);
      }
      if (method && !src.methods.includes(method)) src.methods.push(method);
    }
  };
  const scan = (text, method, origin) => {
    if (!text) return;
    for (const raw of String(text).split(/[。／\n]/)) {
      const s = raw.trim();
      if (!s) continue;
      // 「Xが有効」「弱点」など、その敵への対策を述べた文は脅威ではない。
      if (/が有効|弱点|想定解/.test(s)) continue;
      for (const x of ailmentNames) {
        if (x === '即死') {
          if (/即死させる/.test(s) || (/即死/.test(s) && method !== 'trait' && !s.includes('耐性'))) {
            add('ailment:即死', method, s, origin);
          }
        } else if (x === '引き寄せ') {
          if (s.includes('引き寄せ')) add('ailment:引き寄せ', method, s, origin);
        } else if (
          s.includes(`${x}状態に`) || s.includes(`${x}を付与`) || s.includes(`${x}付与`) ||
          (s.includes('状態にする') && new RegExp(`(^|[、。を])${x}、`).test(s)) ||
          // 敵の能力文の略記（「めまい/呪い(3T)」のような並列表記）。
          new RegExp(`(^|[+＋/／、])${x}([/／、(（]|$)`).test(s)
        ) {
          if (!s.includes('耐性')) add(`ailment:${x}`, method, s, origin);
        }
      }
      // かばう: 「かばう効果を無視する」は、かばう側ではなく
      // かばうをすり抜ける攻撃側の性質なので、かばうの脅威には
      // しない（SW95 便1、SW85 走査の残り3件: アナーケン・
      // 死霊葬操人・ドゥーエ）。
      if (/受け持|かばう/.test(s) && !/かばう(の効果|効果)?を無視/.test(s)) add('tactic:kabau', method, s, origin);
      if (/フォトン/.test(s) && /破壊/.test(s) && !s.includes('耐性')) add('tactic:photon-destroy', method, s, origin);
      // 敵のフォトン奪取はフォトン破壊（敵）に分類する（著述側の
      // 対応と同じ: レイガンベレットの脅威「フォトン奪取」の
      // counterThreatId は tactic:photon-destroy。SW95 便1 で
      // チャージ干渉から振り替え）。チャージ干渉は、チャージ
      // フォトンへの干渉だけに残す。
      if (/フォトンを\d*つ?奪/.test(s) && !/チャージ/.test(s)) add('tactic:photon-destroy', method, s, origin);
      if (/チャージフォトン.*(奪|破壊)|チャージ.*奪/.test(s)) add('tactic:charge-interference', method, s, origin);
      // 呪い増幅: 「呪い状態の相手が受けるダメージが増える」組み合わせ
      // （正本 counter-classes の定義）。単なる共起では拾わない: 攻撃力
      // の倍率（「攻撃力1.8倍+呪い」の倍）まで増幅と誤読するため、増幅
      // の対象がダメージで、その条件が呪い状態である文だけを拾う。
      // 状態条件つき増幅の定型は「対象がX状態の場合、ダメージがN倍に
      // なる」「X状態の敵に与えるダメージが増加」の形（監査E）。
      if (/呪い増幅/.test(s)
        || (/呪い状態/.test(s) && /ダメージ/.test(s) && /(倍|増加|上昇|増幅)/.test(s))) {
        add('combo:curse-amplify', method, s, origin);
      }
      // バリア: 「回数バリアの効果を無視する」は、バリアを張る
      // 側ではなくバリアをすり抜ける攻撃側の性質なので、バリア
      // の脅威にはしない（SW95 便1、SW85 走査の残り8件）。
      if (/回数バリア|バリアを(付与|張る)|バリア状態/.test(s) && !/(バリアの効果|バリア)を無視/.test(s)) add('tactic:barrier', method, s, origin);
      // 死亡強化: 「強化」が解除の対象になっている文（アムドゥ
      // スキアスのデスギフト）と、「受けるダメージが上昇」を
      // 強くなると読む文（グジグランズのシフト3）は、死亡で
      // 強くなる性質ではないので拾わない（SW95 便1）。
      if (/(倒れる|死亡|戦闘不能)/.test(s) && /(強化|上昇|強く)/.test(s)
        && !/強化を(全て)?解除/.test(s)
        && !/(受けるダメージ|被ダメージ)が?\d+%?(上昇|増加)/.test(s)) {
        add('tactic:death-buff', method, s, origin);
      }
    }
  };
  const party = (enemyFact.party || []).filter(Boolean);
  for (const member of party) {
    const origin = { member: member.name, leader: !!member.leader };
    scan(member.trait, 'trait', origin);
    const skills = member.skills || {};
    scan(skills.skill, 'skill', origin);
    scan(skills.awakened, 'awakened', origin);
    scan(skills.ultimate, 'ougi', origin);
  }
  // 特性の注記（全種にある。方法の特定はできないため method は null、
  // 発生源も特定できない）。
  scan(enemyFact.traitNote ? enemyFact.traitNote.value : '', null, null);

  const races = (enemyFact.race && enemyFact.race.values) || [];
  for (const r of races) add(`race:${r}`, null, '');
  // 取り巻き自身の種族も種族特効の対象にする（2026-11-20）。本体種の
  // 種族と重なるものは二重に出さない。表示側の races（種の種族）は
  // 従来どおり本体種のみ。
  const raceSeen = new Set(races);
  for (const member of party) {
    for (const r of member.race || []) {
      if (!raceSeen.has(r)) { raceSeen.add(r); add(`race:${r}`, null, ''); }
    }
  }

  const poles = (enemyFact.resistances && enemyFact.resistances.poles) || {};
  let weak = [];
  let immune = [];
  for (const [key, list] of Object.entries(poles)) {
    if (key.startsWith('◎')) weak = list.map(normalizePoleName);
    if (key.startsWith('無効')) immune = list.map(normalizePoleName);
  }
  return {
    name: enemyFact.name,
    races,
    weak,
    immune,
    resistanceProvenance: resistanceProvenanceOf(enemyFact),
    hasTexts: party.length > 0,
    threats,
  };
}

// 脅威の発生源の素早さ（基礎値、マス倍率なし）。導出の脅威は発生源
// （本体／取り巻き）を sources に持つ。速さ判定は種のリーダー個体
// ではなく発生源の個体で行う（監査G: ゴウケツ本体600に対し、束縛の
// 発生源フレイムリリィは705）。発生源が fact の party に名前で引けた
// 場合だけ、その基礎素早さの配列を返す。引けない・発生源の記録が
// 無い場合は null（呼び出し側が種の値へ落とす）。
export function threatSourceSpds(fact, threat) {
  if (!fact || !threat || !Array.isArray(threat.sources) || threat.sources.length === 0) return null;
  const party = (fact.party || []).filter(Boolean);
  const spds = [];
  for (const s of threat.sources) {
    const m = party.find((p) => p.name === s.member);
    if (m && typeof m.spd === 'number' && !spds.includes(m.spd)) spds.push(m.spd);
  }
  return spds.length > 0 ? spds : null;
}

// 戦闘マス1つ分の脅威（敵ごとに分け、対策クラスを付けた形）。
export function threatsForSquare({ def, floorEnemies, clsById }) {
  if (!floorEnemies || !floorEnemies.enemies) return null;
  const enemies = [];
  const threats = [];
  for (const name of def.enemies || []) {
    const fact = floorEnemies.enemies[name];
    if (!fact) continue;
    const info = threatsForEnemy(fact, clsById);
    enemies.push(info);
    for (const t of info.threats) {
      threats.push({ ...t, enemyName: name });
    }
  }
  return { enemies, threats };
}

// 対策クラスが、敵の発動方法に対して有効か。
// methods が 'all' なら常時有効。脅威側の方法が不明（空）なら落とさない。
export function classApplies(classDef, threatMethods) {
  if (!classDef.methods || classDef.methods === 'all') return true;
  if (!threatMethods || threatMethods.length === 0) return true;
  return threatMethods.some((m) => classDef.methods.includes(m));
}

// ---- 候補の注記（方法・媒体・運用条件・速さ） ----
// 候補は名前だけでは「その人の何が効くのか」が分からない（2026-11-19
// ユーザー指摘）。索引の via（出典ユニット）から、方法（どの対策か）と
// 媒体（特性／スキル／覚醒スキル／奥義／秘奥義／専用霊宝／マスエフェクト
// のどれで持つか）を機械的に付ける。運用条件は媒体に付随するものだけを
// 媒体側へ畳む: 覚醒スキル・奥義・秘奥義はゲージが必要、専用霊宝は
// 付けた時だけ、マスエフェクトは保持者をリーダーに置いた時だけ。
const MEDIUM_ORDER = ['trait', 'skill', 'awakened_skill', 'ougi', 'secret_ougi', 'reishou', 'me', 'subme'];
const MEDIUM_LABEL = {
  trait: '特性', skill: 'スキル', awakened_skill: '覚醒スキル',
  ougi: '奥義', secret_ougi: '秘奥義', reishou: '専用霊宝',
  me: 'マスエフェクト', subme: 'マスエフェクト',
};
const MEDIUM_CONDITION = {
  awakened_skill: 'ゲージが必要', ougi: 'ゲージが必要',
  secret_ougi: 'ゲージが必要', reishou: '付けた時',
  me: 'リーダー必須', subme: 'リーダー必須',
};
const ACTION_SRCS = new Set(['skill', 'awakened_skill', 'ougi', 'secret_ougi']);

export function mediaListForVia(via) {
  const srcs = [...new Set((via || []).map((v) => v.src))];
  srcs.sort((a, b) => MEDIUM_ORDER.indexOf(a) - MEDIUM_ORDER.indexOf(b));
  const out = [];
  for (const s of srcs) {
    const label = MEDIUM_LABEL[s];
    if (!label) continue;
    if (out.some((m) => m.label === label)) continue;
    out.push({ src: s, label, condition: MEDIUM_CONDITION[s] || null });
  }
  return out;
}

// 媒体の表示（運用条件つき）: 「奥義（ゲージが必要）」の形を '・' で並べる。
export function mediaTextForVia(via) {
  return mediaListForVia(via)
    .map((m) => (m.condition ? `${m.label}（${m.condition}）` : m.label))
    .join('・');
}

// 媒体の短い表示（条件なし。M5 のカバー行など狭い場所用）。
export function mediaShortForVia(via) {
  return mediaListForVia(via).map((m) => m.label).join('・');
}

// カバー内訳（対策の行）専用の効果名。methodShortLabel の機械生成は
// resist:any を「any耐性」にしてしまうため、内訳の表示では汎用耐性を
// ゲームの言葉（全状態異常耐性）に直す。他の効果は methodShortLabel
// のまま（この関数を使うのは内訳の組み立てだけ。他の表示は変えない）。
export function detailEffectLabel(effectId, effectName) {
  if (effectId === 'resist:any') return '全状態異常耐性';
  return methodShortLabel(effectId, effectName);
}

// 方法の短い言葉（効果IDから機械的に作る。無ければ効果名そのまま）。
export function methodShortLabel(effectId, effectName) {
  if (!effectId) return effectName || '';
  if (effectId.startsWith('resist:')) return `${effectId.slice('resist:'.length)}耐性`;
  if (effectId.startsWith('inflict:')) return `${effectId.slice('inflict:'.length)}付与`;
  if (effectId.startsWith('bonus:race:')) return `${effectId.slice('bonus:race:'.length)}特効`;
  if (effectId.startsWith('bonus:state:')) return `${effectId.slice('bonus:state:'.length)}特効`;
  const MAP = {
    revive: '蘇生', 'cure:ailment': '状態異常の解除', 'cure:debuff': '弱体の解除',
    kabau: 'かばう', 'kabau:ignore': 'かばう無視',
    'barrier:block': 'ダメージブロック', 'barrier:count': '回数バリア',
    'gauge:down': '覚醒ゲージ低下', 'photon:destroy': 'フォトン破壊',
    'photon:steal': 'フォトン奪取', 'photon:destroy-resist': 'フォトン破壊耐性',
    'photon:convert': 'フォトン変換', 'photon:degrade': 'フォトン劣化',
    'photon:capacity-down': 'フォトン容量低下', 'gauge:up-down': '覚醒ゲージ上昇量低下',
    'dispel:buff': '強化解除', heal: '回復',
    'debuff:atk': '攻撃力低下', 'debuff:def': '防御力低下', 'debuff:spd': '素早さ低下',
  };
  return MAP[effectId] || effectName || effectId;
}

export function viaHasAction(via) {
  return (via || []).some((v) => ACTION_SRCS.has(v.src));
}

// 時間依存の手段か: 付与型の耐性・解除・バリアは「敵の付与や攻撃より
// 先に動けるか」が勝負になる。それ以外（蘇生・回復・フォトン干渉等）は
// 速さの勝負ではないため、速さ判定の対象にしない。
export function isTimingMeans(effectId) {
  return Boolean(effectId) && (
    effectId.startsWith('resist:')
    || effectId === 'cure:ailment' || effectId === 'cure:debuff'
    || effectId === 'barrier:block' || effectId === 'barrier:count');
}

// 素早さの比較。どちらか不明か同値なら断定しない（null）。
export function speedVerdictOf(spd, enemySpd) {
  if (typeof spd !== 'number' || typeof enemySpd !== 'number' || spd === enemySpd) return null;
  return spd > enemySpd ? '勝てる' : '負ける';
}

// コンディションを反映した素早さ。定義済みの補正は絶不調の -50% だけ
// （requirements §6 の実効スペックの範囲）。stage は段階の添字
// （0=絶好調 … 4=絶不調、5=気絶）。
export function effectiveSpd(baseSpd, stage) {
  if (typeof baseSpd !== 'number') return null;
  return stage === 4 ? Math.floor(baseSpd * 0.5) : baseSpd;
}

// 候補1件の表示文を組む。means は [{effectId, effectName, via, value?,
// locked?}]。速さ判定は、時間依存の手段を行動で持つ候補にだけ、両方の
// 素早さが分かる場合に付ける。オーブは担い手の素早さが決まらないため
// 付けない。
// resistTotal が数値なら、その候補の耐性の合計（個別の異常耐性＋
// 全ての状態異常への耐性の合算）を併記する。resistBonus は絶好調の
// +50% のような、索引の外から来る上乗せ。100% で無効化できる。
// locked（凸が足りず未解禁）の手段がある候補には、その旨を添える。
export function candidateText({ name, means, spd = null, enemySpd = null, orb = false, resistTotal = null, resistBonus = 0 }) {
  const media = [];
  const methods = [];
  let verdict = null;
  let lockedMin = null;
  for (const m of means || []) {
    if (!orb) {
      for (const med of mediaListForVia(m.via)) {
        const t = med.condition ? `${med.label}（${med.condition}）` : med.label;
        if (!media.includes(t)) media.push(t);
      }
    }
    const s = methodShortLabel(m.effectId, m.effectName);
    if (s && !methods.includes(s)) methods.push(s);
    if (!verdict && !orb && isTimingMeans(m.effectId) && viaHasAction(m.via)) {
      verdict = speedVerdictOf(spd, enemySpd);
    }
    if (typeof m.locked === 'number') {
      lockedMin = lockedMin === null ? m.locked : Math.min(lockedMin, m.locked);
    }
  }
  const inner = [...(orb ? ['オーブ'] : media), ...methods].filter(Boolean).join('・');
  let text = inner ? `${name}（${inner}）` : name;
  if (typeof resistTotal === 'number') {
    const total = Math.min(100, resistTotal + (resistBonus || 0));
    const tail = total >= 100 ? '無効化できる' : `あと${100 - total}%`;
    text += resistBonus
      ? ` 耐性${total}%（絶好調込み・${tail}）`
      : ` 耐性${total}%（${tail}）`;
  }
  if (lockedMin !== null) text += ` 凸${lockedMin}で解禁する手段を含む`;
  if (verdict) text += ` 素早さでは${verdict}（${spd}対${enemySpd}）`;
  // 速さ判定の付かない候補にも、実効素早さの数値そのものを出す
  // （2026-11-19 ユーザー指摘「そもそも素早さが知りたい」。判定が
  // ある場合は対比の中に両方の数値が出ているため重ねない）。
  // オーブは担い手の素早さが決まらないため出さない。
  else if (!orb && typeof spd === 'number') text += ` 素早さ${spd}`;
  return text;
}

// 著述の戦術の候補例（名前だけの列挙）に、索引から方法・媒体・運用
// 条件・速さ判定を付ける。マスエフェクト由来の例は保持者（ME の
// 持ち主）から引く。索引で引けない例は、その旨が分かる形にする。
// spdById: Map(megidoId -> 星6素早さ)、conditionOf: id -> 段階の添字、
// levelOf: id -> 現在の凸（不明なら null）。
export function annotateAuthoredTactic({ tactic, index, spdById = null, conditionOf = null, enemySpd = null, levelOf = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const megido = new Map();
  const orbs = new Map();
  const blank = () => ({ means: [], spd: null, unknown: true, onlyRestricted: false });
  for (const m of tactic.means || []) {
    // 制限下では、ホワイトリストの機構でない手段は注記の材料に
    // しない（候補として出さない）。
    if (prof && !effectAllowedRestricted(m.effect)) continue;
    const effect = index ? index.byEffect.get(m.effect) : null;
    for (const name of m.megidoExamples || []) {
      if (!megido.has(name)) megido.set(name, blank());
      const e = megido.get(name);
      const holder = effect ? (effect.megido || []).find((h) => h.name === name) : null;
      const meHolder = !holder && effect ? (effect.megidoMe || []).find((h) => h.name === name) : null;
      const found = holder || meHolder;
      if (found) {
        const via = prof ? restrictedViasForEffect(m.effect, found.name, found.via || [], prof) : (found.via || []);
        // 制限下で使える形が1つも無い例は、候補として出さない
        // （「未収録」とも書かない。使えない手段は出さない原則）。
        if (prof && via.length === 0) { e.onlyRestricted = true; continue; }
        e.unknown = false;
        const level = levelOf ? levelOf(found.id) : null;
        const locked = lockedLevel(via, level);
        e.means.push({
          effectId: m.effect,
          effectName: m.effectName || (effect && effect.name) || '',
          via,
          value: meansValue(usableVias(via, level)),
          ...(locked !== null ? { locked } : {}),
        });
        const base = spdById ? spdById.get(found.id) : null;
        e.spd = effectiveSpd(base, conditionOf ? conditionOf(found.id) : null);
      }
    }
    for (const name of m.orbExamples || []) {
      if (!orbs.has(name)) orbs.set(name, blank());
      const e = orbs.get(name);
      const holder = effect ? (effect.orbs || []).find((h) => h.name === name) : null;
      if (holder) {
        const via = prof ? restrictedViasForEffect(m.effect, holder.name, holder.via || [], prof) : (holder.via || []);
        if (prof && via.length === 0) { e.onlyRestricted = true; continue; }
        e.unknown = false;
        e.means.push({ effectId: m.effect, effectName: m.effectName || (effect && effect.name) || '', via });
      }
    }
  }
  const render = (e, name, orb) => (e.unknown
    ? `${name}（手段の出所は未収録）`
    : candidateText({
      name, means: e.means, spd: e.spd, enemySpd, orb,
      resistTotal: resistTotalOf(e.means),
    }));
  // 制限下で使える形が無い例だけの行は、行ごと出さない。
  const visible = ([, e]) => !(prof && e.unknown && e.onlyRestricted);
  return {
    megidoTexts: [...megido.entries()].filter(visible).map(([name, e]) => render(e, name, false)),
    orbTexts: [...orbs.entries()].filter(visible).map(([name, e]) => render(e, name, true)),
  };
}

// 候補の手段が全て耐性（resist:）のとき、その候補の耐性の合計を返す。
// 合算は「個別の異常への耐性＋全ての状態異常への耐性」をメンバーごとに
// 足す決まり（2026-11-19 確定の数値レイヤー）。数値の読み取れる手段が
// 1つも無い場合は null（合計を断定しない）。
export function resistTotalOf(means) {
  const ms = means || [];
  if (ms.length === 0 || !ms.every((m) => m.effectId && m.effectId.startsWith('resist:'))) return null;
  let total = 0;
  let any = false;
  for (const m of ms) {
    if (typeof m.value === 'number') { total += m.value; any = true; }
  }
  return any ? Math.min(100, total) : null;
}

// 編成メンバーのうち、ある異常への耐性合計が一番高い者を返す
// （編成エディタの不足行の％用、案A・2026-11-25 マスター決定）。
// 合計の計算は候補文（candidateText）の耐性表示と同一にする:
// - 合算は resistTotalOf と同じ（個別の異常への耐性＋全ての状態異常
//   への耐性を、手段の数値で足す。数値の読み取れる手段が1つも無い
//   メンバーは合計を断定しない）。
// - 手段の数値は candidatesForClass と同じ取り方（本人の手段は
//   usableVias の最大値、オーブは装備者の分として via の最大値）。
// - ME 由来は、リーダーの ME がそのメンバーの枠に実際に届く分だけ
//   数える（届き方は formationCoverageDetail と同じ）。
// - 絶好調のメンバーには候補文の resistBonus と同じ +50% を足し、
//   合計は100%で止める。
// 戻り値: { id, total } | null（合計の付くメンバーがいない場合）。
export function bestResistMember({ formation, ailment, index, levelOf = null, conditionOf = null, styleClassOf = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const slots = formation.slots || [];
  const effectIds = [`resist:${ailment}`, 'resist:any'];
  let best = null;
  slots.forEach((slot, i) => {
    if (!slot || !slot.megidoId) return;
    const means = [];
    for (const effectId of effectIds) {
      if (prof && !effectAllowedRestricted(effectId)) continue;
      const effect = index.byEffect.get(effectId);
      if (!effect) continue;
      for (const h of effect.megido || []) {
        if (h.id !== slot.megidoId) continue;
        const via = prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || []);
        if (prof && via.length === 0) continue;
        means.push({ effectId, value: meansValue(usableVias(via, levelOf ? levelOf(h.id) : null)) });
      }
      for (const h of effect.megidoMe || []) {
        if (!meHolderWorks({ holder: h, formation, styleClassOf })) continue;
        const via = prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || []);
        if (via.length === 0) continue;
        const reaches = via.some((v) => {
          if (v.leader || v.slot === 'leader') return i === 2;
          const pos = ME_SLOT_KEYS.indexOf(v.slot);
          return pos === i && meViaReachesSlot(v, slot, styleClassOf);
        });
        if (reaches) {
          means.push({ effectId, value: meansValue(usableVias(via, levelOf ? levelOf(h.id) : null)) });
        }
      }
      for (const h of effect.orbs || []) {
        if (!slot.orbId || h.orbId !== slot.orbId) continue;
        const via = prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || []);
        if (prof && via.length === 0) continue;
        means.push({ effectId, value: meansValue(via) });
      }
    }
    const base = resistTotalOf(means);
    if (base === null) return;
    const total = Math.min(100, base + (conditionOf && conditionOf(slot.megidoId) === 0 ? 50 : 0));
    if (!best || total > best.total) best = { id: slot.megidoId, total };
  });
  return best;
}

// 対策クラスの候補（索引から。メギドは所持で絞る。オーブは所持の概念が
// 無いため絞らない）。マスエフェクト由来の保持者も候補に入り、媒体は
// via の src で区別できる（マスエフェクトはリーダー必須）。
// 候補が手段ではなく方針だけのクラスは noteOnly。
// 各候補には手段の内訳（means: 効果ごとの出典ユニット・数値・凸の
// 解禁状態）を持たせ、表示側で方法・媒体・運用条件を付けられるように
// する。levelOf（id -> 現在の凸）を渡すと、凸が足りない手段には
// locked（解禁に要る凸）が付く。
export function candidatesForClass(classDef, index, owned, levelOf = null, { enemyFact = null, restricted = false } = {}) {
  const prof = normalizeRestriction(restricted);
  const megido = new Map();
  const orbs = new Map();
  // 制限下では、保持者の via を制限下で使える分だけに絞ってから
  // 従来の判定（凸）へ渡す。使える via が1つも無い保持者は、その
  // 効果の候補に入らない。絞り込みは効果×媒体まで含める
  // （restrictedViasForEffect）。
  const viaFor = (h, effectId) => (prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || []));
  const pushMeans = (entry, effect, effectId, h, fromMe) => {
    const via = viaFor(h, effectId);
    const level = levelOf ? levelOf(h.id) : null;
    const locked = lockedLevel(via, level);
    entry.effectNames.push(effect.name);
    entry.means.push({
      effectId,
      effectName: effect.name,
      via,
      value: meansValue(usableVias(via, level)),
      fromMe,
      ...(locked !== null ? { locked } : {}),
    });
    if (fromMe) entry.fromMe = true;
  };
  for (const effectId of classDef.effects || []) {
    // 敵の耐性で演算上無効な付与系の効果は、答えとして数えない
    // （相談 5-16・型5）。enemyFact を渡さない呼び出しは従来どおり。
    if (enemyFact && effectInvalidAgainst(enemyFact, effectId)) continue;
    // 制限下では、ホワイトリストの機構だけを答えとして数える。
    if (prof && !effectAllowedRestricted(effectId)) continue;
    const effect = index.byEffect.get(effectId);
    if (!effect) continue;
    for (const h of effect.megido || []) {
      if (owned && !owned.has(h.id)) continue;
      if (prof && viaFor(h, effectId).length === 0) continue;
      if (!megido.has(h.id)) megido.set(h.id, { id: h.id, name: h.name, style: h.style, effectNames: [], means: [], fromMe: false });
      pushMeans(megido.get(h.id), effect, effectId, h, false);
    }
    for (const h of effect.megidoMe || []) {
      if (owned && !owned.has(h.id)) continue;
      if (prof && viaFor(h, effectId).length === 0) continue;
      if (!megido.has(h.id)) megido.set(h.id, { id: h.id, name: h.name, style: h.style, effectNames: [], means: [], fromMe: false });
      pushMeans(megido.get(h.id), effect, effectId, h, true);
    }
    for (const h of effect.orbs || []) {
      if (prof && viaFor(h, effectId).length === 0) continue;
      if (!orbs.has(h.orbId)) orbs.set(h.orbId, { orbId: h.orbId, name: h.name, style: h.style, effectNames: [], means: [], fromMe: false });
      const e = orbs.get(h.orbId);
      e.effectNames.push(effect.name);
      e.means.push({ effectId, effectName: effect.name, via: viaFor(h, effectId), value: meansValue(viaFor(h, effectId)), fromMe: false });
    }
  }
  for (const e of [...megido.values(), ...orbs.values()]) {
    e.resistTotal = resistTotalOf(e.means);
  }
  return {
    megido: [...megido.values()],
    orbs: [...orbs.values()],
    noteOnly: (classDef.effects || []).length === 0,
  };
}

// 敵パーティの種族への特効の候補（ピッカーの有効印用）。
// 種族特効は「その種族がパーティに居る」という機械的な事実だけで
// 効く・効かないが決まるため、著述の戦術に拾われているかどうかや
// 脅威の導出とは独立に、敵の fact（本体種の種族＋取り巻き全員の
// 種族）から引く。ラベルは「どの種族に・誰へ効くか」まで含める
// （例: 「植物特効（フレイムリリィ）」）。保持者の媒体は索引の
// 引き方に揃える: 本体能力・ME 由来（candidatesForClass と同じく
// ME 保持者も候補に入れる）・オーブ。メギドは所持で絞る
// （オーブに所持の概念は無いため絞らない）。
// 戻り値: { megido: Map<id, ラベル[]>, orbs: Map<orbId, ラベル[]>,
//           reasons: { megido: Map<id, 理由[]>, orbs: Map<orbId, 理由[]> } }
// reasons は印の理由表示用に、ラベルと同じ保持者へ根拠（種族・対象・
// 手段）を記録したもの。判定（ラベルの付き方）は従来どおり。
export function raceBonusAnswers({ fact, index, owned = null }) {
  const megido = new Map();
  const orbs = new Map();
  const reasons = { megido: new Map(), orbs: new Map() };
  if (!fact || !index || !index.byEffect) return { megido, orbs, reasons };
  const byRace = new Map();
  const addName = (race, name) => {
    if (!race || !name) return;
    if (!byRace.has(race)) byRace.set(race, []);
    const list = byRace.get(race);
    if (!list.includes(name)) list.push(name);
  };
  for (const r of (fact.race && fact.race.values) || []) addName(r, fact.name);
  for (const member of fact.party || []) {
    if (!member) continue;
    for (const r of member.race || []) addName(r, member.name);
  }
  const push = (map, key, label) => {
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.includes(label)) list.push(label);
  };
  const pushReason = (map, key, reason) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(reason);
  };
  for (const [race, names] of byRace) {
    const effect = index.byEffect.get(`bonus:race:${race}`);
    if (!effect) continue;
    const label = `${race}特効（${names.join('、')}）`;
    const reasonBase = {
      kind: 'race', enemyName: fact.name, race, targets: names,
      effectId: `bonus:race:${race}`, effectName: effect.name,
    };
    for (const h of effect.megido || []) {
      if (owned && !owned.has(h.id)) continue;
      push(megido, h.id, label);
      pushReason(reasons.megido, h.id, { ...reasonBase, via: h.via || [] });
    }
    for (const h of effect.megidoMe || []) {
      if (owned && !owned.has(h.id)) continue;
      push(megido, h.id, label);
      pushReason(reasons.megido, h.id, { ...reasonBase, via: h.via || [] });
    }
    for (const h of effect.orbs || []) {
      push(orbs, h.orbId, label);
      pushReason(reasons.orbs, h.orbId, { ...reasonBase, via: h.via || [] });
    }
  }
  return { megido, orbs, reasons };
}

// ---- 状態特効の印（最終チェック 積1、2026-11-20） ----
// 状態特効（bonus:state）は10件あり、個別に分類する:
// - 付けられる状態系（9件）: その状態を付与する手段（inflict:<状態>）が
//   編成にある時だけ印を出す。
// - 弱体: 状態異常の総称カテゴリで、inflict: の対応物が索引に無い。
//   記号表の「弱体」列は能力低下への耐性に対応するため、手段は
//   能力低下系（debuff:atk/def/spd）の保持で判定する。
// - 状況系（HP割合・行動回数などの条件倍率）は bonus:state としては
//   索引に存在しないため、この分類には現れない（「常に手段がある」
//   ものとして扱う対象は今回の10件には弱体だけになる）。
// symbol は敵の記号表（resistances.symbolTable）のキー。煉獄の炎だけ
// 短縮名「煉獄」で載っている。記号表の値は [N, H, VH] の順で、
// このツールの敵データは VH 基準のため VH 列が ◎ の時だけ弱点とする。
export const STATE_BONUS_KINDS = [
  { state: 'めまい', symbol: 'めまい', means: 'inflict' },
  { state: '凍結', symbol: '凍結', means: 'inflict' },
  { state: '執心', symbol: '執心', means: 'inflict' },
  { state: '弱体', symbol: '弱体', means: 'debuff' },
  { state: '感電', symbol: '感電', means: 'inflict' },
  { state: '暗闇', symbol: '暗闇', means: 'inflict' },
  { state: '束縛', symbol: '束縛', means: 'inflict' },
  { state: '毒', symbol: '毒', means: 'inflict' },
  { state: '煉獄の炎', symbol: '煉獄', means: 'inflict' },
  { state: '睡眠', symbol: '睡眠', means: 'inflict' },
];

// 状態特効・付与の via が、その保持者の現況（凸・専用霊宝の装備）で
// 使えるか。専用霊宝が要る形は、via の src が reishou のものと、
// ラベルに「専用霊宝「…」装備時」と明記された形。
function stateViaUsable(v, level, hasSpecial) {
  if (viaNeedLevel(v) > level) return false;
  const needsSpecial = v.src === 'reishou'
    || /専用霊宝「[^」]*」装備時/.test(v.label || '');
  if (needsSpecial && !hasSpecial) return false;
  return true;
}

// 状態特効の候補（ピッカーの有効印用）: 対象の敵がその状態に弱く
// （記号表 VH 列が ◎）、かつ編成（候補自身を含む）にその状態を
// 付けられる手段がある時だけ、特効の保持者に印を付ける。
// memberIds / orbIds は現在の編成のメンバーと装備オーブ。候補自身が
// 付与手段でもある場合は、その候補にも印が付く（自己完結を数える）。
// ME 由来の付与は、保持者がリーダーの時だけ手段として数える。
// 戻り値: { megido: Map<id, ラベル[]>, orbs: Map<orbId, ラベル[]>,
//           reasons: { megido: Map<id, 理由[]>, orbs: Map<orbId, 理由[]> } }
// reasons は印の理由表示用（raceBonusAnswers と同じ形）。
export function stateBonusAnswers({
  fact, index, owned = null, memberIds = [], orbIds = [],
  leaderId = null, levelOf = null, hasSpecial = null,
}) {
  const megido = new Map();
  const orbs = new Map();
  const reasons = { megido: new Map(), orbs: new Map() };
  if (!fact || !index || !index.byEffect) return { megido, orbs, reasons };
  const table = fact.resistances && fact.resistances.symbolTable;
  if (!table) return { megido, orbs, reasons };
  const members = new Set(memberIds || []);
  const equippedOrbs = new Set(orbIds || []);
  const lvl = (id) => (levelOf ? levelOf(id) : 0);
  const spec = (id) => (hasSpecial ? Boolean(hasSpecial(id)) : false);
  const holderUsable = (h) => (h.via || [])
    .some((v) => stateViaUsable(v, lvl(h.id), spec(h.id)));
  const push = (map, key, label) => {
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.includes(label)) list.push(label);
  };
  for (const kind of STATE_BONUS_KINDS) {
    const sym = table[kind.symbol];
    if (!sym || sym[2] !== '◎') continue;
    const bonus = index.byEffect.get(`bonus:state:${kind.state}`);
    if (!bonus) continue;
    // その状態を付けられる手段の保持者（メギドとオーブ）。
    const inflicterMegido = new Set();
    const inflicterOrbs = new Set();
    const effectIds = kind.means === 'debuff'
      ? ['debuff:atk', 'debuff:def', 'debuff:spd']
      : [`inflict:${kind.state}`];
    for (const eid of effectIds) {
      const eff = index.byEffect.get(eid);
      if (!eff) continue;
      for (const h of eff.megido || []) {
        if (holderUsable(h)) inflicterMegido.add(h.id);
      }
      for (const h of eff.megidoMe || []) {
        if (h.id === leaderId && holderUsable(h)) inflicterMegido.add(h.id);
      }
      for (const h of eff.orbs || []) inflicterOrbs.add(h.orbId);
    }
    const meansWith = (extraMegido, extraOrb) => (
      [...inflicterMegido].some((id) => members.has(id) || id === extraMegido)
      || [...inflicterOrbs].some((id) => equippedOrbs.has(id) || id === extraOrb)
    );
    const label = `${kind.state}特効`;
    const reasonBase = {
      kind: 'state', enemyName: fact.name, state: kind.state,
      effectId: `bonus:state:${kind.state}`, effectName: bonus.name,
    };
    for (const h of bonus.megido || []) {
      if (owned && !owned.has(h.id)) continue;
      if (!holderUsable(h)) continue;
      if (meansWith(h.id, null)) {
        push(megido, h.id, label);
        if (!reasons.megido.has(h.id)) reasons.megido.set(h.id, []);
        reasons.megido.get(h.id).push({ ...reasonBase, via: h.via || [] });
      }
    }
    for (const h of bonus.orbs || []) {
      if (meansWith(null, h.orbId)) {
        push(orbs, h.orbId, label);
        if (!reasons.orbs.has(h.orbId)) reasons.orbs.set(h.orbId, []);
        reasons.orbs.get(h.orbId).push({ ...reasonBase, via: h.via || [] });
      }
    }
  }
  return { megido, orbs, reasons };
}

// ME 由来の保持者が、その編成で実際に手段として働くか。
// マスエフェクトは編成のリーダーのものだけが発動する。保持者が
// リーダーでない場合は働かない。リーダーの場合、枠の効果は:
// リーダー枠の効果はリーダー本人に、他の枠の効果はその枠にいる
// メンバーに効く。枠の条件（スタイル・クラス・性別）は、
// styleClassOf が引ける場合は突き合わせる。性別は基礎データ
// （性別表が正本）から引く。styleClassOf の戻りに gender が無い
// 場合だけ、性別条件は判定せず通す（従来の扱い）。
export function meHolderWorks({ holder, formation, styleClassOf = null }) {
  const slots = formation.slots || [];
  const leaderId = slots[2] ? slots[2].megidoId : null;
  if (!leaderId || holder.id !== leaderId) return false;
  for (const v of holder.via || []) {
    if (v.leader || v.slot === 'leader') return true;
    const pos = ME_SLOT_KEYS.indexOf(v.slot);
    if (pos < 0) continue;
    const occupant = slots[pos];
    if (!occupant || !occupant.megidoId) continue;
    if (!styleClassOf) return true;
    const sc = styleClassOf(occupant.megidoId);
    if (!sc) return true;
    const parts = String(v.condition || '').split(/[+＋]/).map((s) => s.trim()).filter(Boolean);
    const genders = parts
      .map((p) => (p === '男性' || p === '男' ? '男性' : p === '女性' || p === '女' ? '女性' : null))
      .filter(Boolean);
    const known = parts.filter((p) => p !== '男性' && p !== '女性' && p !== '男' && p !== '女' && p !== '-');
    const genderOk = !sc.gender || genders.every((g) => g === sc.gender);
    if (known.every((p) => p === sc.style || p === sc.className) && genderOk) return true;
  }
  return false;
}

// 編成がそのマスの脅威をカバーできているか（M5）。
// カバー = 脅威の対策クラスのどれかに、この編成のメンバー（または装備
// オーブ）が候補として入っていること。方針だけのクラスは数えない。
// マスエフェクト由来の手段は、保持者がリーダーで枠の条件が合う場合
// だけ数える。凸が足りない手段（levelOf で判定）は数えない。
// conditionOf を渡すと、耐性（resist:）の手段でカバーしているメンバーの
// うち絶好調の者を greatResist に添える（M4 の注記と同じ事実。実効
// スペック検証の案2: 薄い層は判定を変えず、留保として添えるだけ）。
export function formationCoverage({ formation, threats, clsById, index, conditionOf = null, levelOf = null, styleClassOf = null, enemyFact = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const memberIds = new Set();
  const orbIds = new Set();
  for (const slot of formation.slots || []) {
    if (slot.megidoId) memberIds.add(slot.megidoId);
    if (slot.orbId) orbIds.add(slot.orbId);
  }
  return (threats || []).map((t) => {
    const threatDef = clsById.get(t.threatId);
    const coveredBy = [];
    const greatResist = [];
    if (threatDef) {
      for (const classDef of threatDef.classes) {
        if (!classApplies(classDef, t.methods)) continue;
        for (const effectId of classDef.effects || []) {
          // 敵の耐性で演算上無効な付与系の効果はカバーに数えない
          // （相談 5-16・型5。enemyFact を渡さない呼び出しは従来どおり）。
          if (enemyFact && effectInvalidAgainst(enemyFact, effectId)) continue;
          // 制限下では、ホワイトリストの機構だけをカバーとして数え、
          // 保持者も制限下で使える via を持つ場合だけ数える。
          if (prof && !effectAllowedRestricted(effectId)) continue;
          const effect = index.byEffect.get(effectId);
          if (!effect) continue;
          for (const h of effect.megido || []) {
            if (memberIds.has(h.id)) {
              if (lockedLevel(h.via || [], levelOf ? levelOf(h.id) : null) !== null) continue;
              if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
              const viaText = [mediaShortForVia(prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || [])), methodShortLabel(effectId, effect.name)]
                .filter(Boolean).join('・');
              coveredBy.push(viaText ? `${h.name}（${viaText}）` : h.name);
              if (effectId.startsWith('resist:') && conditionOf && conditionOf(h.id) === 0
                && !greatResist.includes(h.name)) {
                greatResist.push(h.name);
              }
            }
          }
          for (const h of effect.megidoMe || []) {
            if (!meHolderWorks({ holder: h, formation, styleClassOf })) continue;
            if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
            const viaText = [mediaShortForVia(prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || [])), methodShortLabel(effectId, effect.name)]
              .filter(Boolean).join('・');
            coveredBy.push(viaText ? `${h.name}（${viaText}）` : h.name);
          }
          for (const h of effect.orbs || []) {
            if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
            if (orbIds.has(h.orbId)) coveredBy.push(`オーブ「${h.name}」（${methodShortLabel(effectId, effect.name)}）`);
          }
        }
      }
    }
    return {
      threatId: t.threatId,
      name: t.name,
      enemyName: t.enemyName,
      covered: coveredBy.length > 0,
      coveredBy: [...new Set(coveredBy)],
      ailment: Boolean(threatDef && threatDef.kind === 'ailment'),
      greatResist,
    };
  });
}

// ME 由来の手段が、ある枠の今の住人に届くか（meHolderWorks の枠単位の
// 内訳）。条件の照合規則は meHolderWorks と同じ（スタイル／クラス／
// 性別の複合条件、判定材料が無ければ通す）。
function meViaReachesSlot(v, occupant, styleClassOf) {
  if (!occupant || !occupant.megidoId) return false;
  if (!styleClassOf) return true;
  const sc = styleClassOf(occupant.megidoId);
  if (!sc) return true;
  const parts = String(v.condition || '').split(/[+＋]/).map((s) => s.trim()).filter(Boolean);
  const genders = parts
    .map((p) => (p === '男性' || p === '男' ? '男性' : p === '女性' || p === '女' ? '女性' : null))
    .filter(Boolean);
  const known = parts.filter((p) => p !== '男性' && p !== '女性' && p !== '男' && p !== '女' && p !== '-');
  const genderOk = !sc.gender || genders.every((g) => g === sc.gender);
  return known.every((p) => p === sc.style || p === sc.className) && genderOk;
}

// カバーの内訳（SW92、問題Eの実装材料）: formationCoverage と同じ判定で、
// 脅威ごとに「誰の・どの媒体の手段が、どの範囲をカバーしているか」を
// 分解して返す。計算そのものは変えず、言い方と範囲の明示のためだけに
// 使う。戻り値（脅威ごと）:
//   direct: 本人の手段でカバーする保持者の名前（重複なし）
//   meCovers: [{ name, positions, missed }] — ME 由来の保持者（リーダー）
//     について、効果が届く枠番号（1始まり、3=リーダー）と、メンバーが
//     いるのに届かない枠番号。空き枠はどちらにも入れない。
//   orbs: 装備オーブの名前（重複なし）
//   effects: 効果ごとの内訳（寄与のある効果だけ、走査順）:
//     [{ effectId, name, holders: [名前], me: [{ name, positions, missed }],
//        orbs: [名前] }]。行の文章（どの効果が・誰によって有効か）を
//     効果単位で組むための材料で、判定は変えない。
//   answerMeans: その脅威への答えになる手段の名前（クラスが適用でき、
//     敵の耐性で無効でなく、制限下でも使える効果の名前。保持者の有無は
//     見ない）。答えが無い行で「どの手段が編成に無いか」の根拠に使う。
//   answerEffects: answerMeans と同じ並びの効果IDつき内訳
//     （[{ effectId, name }]、効果IDで重複を除く）。不足行の％（耐性系
//     だけに付ける）の対象を文章側が判別するための材料。
// カバー有無の結論は formationCoverage の covered と一致する
// （direct・meCovers・orbs のどれかが非空 ⇔ covered）。
export function formationCoverageDetail({ formation, threats, clsById, index, levelOf = null, styleClassOf = null, enemyFact = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const slots = formation.slots || [];
  const memberIds = new Set();
  const orbIds = new Set();
  for (const slot of slots) {
    if (slot.megidoId) memberIds.add(slot.megidoId);
    if (slot.orbId) orbIds.add(slot.orbId);
  }
  const leaderId = slots[2] ? slots[2].megidoId : null;
  const filledPositions = [];
  slots.forEach((s, i) => { if (s && s.megidoId) filledPositions.push(i + 1); });
  return (threats || []).map((t) => {
    const threatDef = clsById.get(t.threatId);
    const direct = [];
    const meByName = new Map();
    const orbs = [];
    const effectRecs = new Map();
    const answerMeans = [];
    const answerEffects = [];
    if (threatDef) {
      for (const classDef of threatDef.classes) {
        if (!classApplies(classDef, t.methods)) continue;
        for (const effectId of classDef.effects || []) {
          if (enemyFact && effectInvalidAgainst(enemyFact, effectId)) continue;
          if (prof && !effectAllowedRestricted(effectId)) continue;
          const effect = index.byEffect.get(effectId);
          if (!effect) continue;
          const eName = detailEffectLabel(effectId, effect.name);
          if (!answerMeans.includes(eName)) answerMeans.push(eName);
          if (!answerEffects.some((a) => a.effectId === effectId)) {
            answerEffects.push({ effectId, name: eName });
          }
          let eRec = effectRecs.get(effectId);
          if (!eRec) {
            eRec = { effectId, name: eName, holders: [], meByName: new Map(), orbs: [] };
            effectRecs.set(effectId, eRec);
          }
          for (const h of effect.megido || []) {
            if (!memberIds.has(h.id)) continue;
            if (lockedLevel(h.via || [], levelOf ? levelOf(h.id) : null) !== null) continue;
            if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
            if (!direct.includes(h.name)) direct.push(h.name);
            if (!eRec.holders.includes(h.name)) eRec.holders.push(h.name);
          }
          for (const h of effect.megidoMe || []) {
            if (!meHolderWorks({ holder: h, formation, styleClassOf })) continue;
            const vias = prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || []);
            if (vias.length === 0) continue;
            let rec = meByName.get(h.name);
            if (!rec) {
              rec = { name: h.name, positions: new Set() };
              meByName.set(h.name, rec);
            }
            let eMeRec = eRec.meByName.get(h.name);
            if (!eMeRec) {
              eMeRec = { name: h.name, positions: new Set() };
              eRec.meByName.set(h.name, eMeRec);
            }
            for (const v of vias) {
              if (v.leader || v.slot === 'leader') {
                rec.positions.add(3);
                eMeRec.positions.add(3);
                continue;
              }
              const pos = ME_SLOT_KEYS.indexOf(v.slot);
              if (pos < 0) continue;
              if (meViaReachesSlot(v, slots[pos], styleClassOf)) {
                rec.positions.add(pos + 1);
                eMeRec.positions.add(pos + 1);
              }
            }
          }
          for (const h of effect.orbs || []) {
            if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
            if (orbIds.has(h.orbId) && !orbs.includes(h.name)) orbs.push(h.name);
            if (orbIds.has(h.orbId) && !eRec.orbs.includes(h.name)) eRec.orbs.push(h.name);
          }
        }
      }
    }
    const meCovers = [...meByName.values()].map((rec) => {
      const positions = [...rec.positions].sort((a, b) => a - b);
      const missed = filledPositions.filter((p) => !rec.positions.has(p));
      return { name: rec.name, positions, missed };
    });
    const effects = [...effectRecs.values()]
      .filter((r) => r.holders.length > 0 || r.meByName.size > 0 || r.orbs.length > 0)
      .map((r) => ({
        effectId: r.effectId, name: r.name, holders: r.holders,
        me: [...r.meByName.values()].map((rec) => {
          const positions = [...rec.positions].sort((a, b) => a - b);
          const missed = filledPositions.filter((p) => !rec.positions.has(p));
          return { name: rec.name, positions, missed };
        }),
        orbs: r.orbs,
      }));
    return {
      threatId: t.threatId, name: t.name, enemyName: t.enemyName,
      direct, meCovers, orbs, effects, answerMeans, answerEffects,
    };
  });
}

// 著述の戦術のカバーの内訳（SW92）: authoredCoverage と同じ判定で、
// 戦術ごとに「構成する効果のうち、どれが・誰で編成に入っているか」
// まで分解して返す。合体した脅威への戦術（例: めまい・呪いへの耐性）
// で、入っているのが一部の効果だけの時に、その範囲をそのまま書く
// ための材料。ME 由来の効果は届く枠・届かない枠も持つ。
// 戻り値: [{ label, covered: boolean | null,
//           effects: [{ effectId, name, holders: [表記], me: [{ name, positions, missed }] }] }]
// covered の判定は authoredCoverage と一致する（どれか1つの効果でも
// 担い手がいれば true）。判定できない戦術は covered: null。
export function authoredCoverageDetail({ authored, formation, index, levelOf = null, styleClassOf = null, enemyFact = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const slots = formation.slots || [];
  const memberIds = new Set();
  const orbIds = new Set();
  for (const slot of slots) {
    if (slot.megidoId) memberIds.add(slot.megidoId);
    if (slot.orbId) orbIds.add(slot.orbId);
  }
  if (!authored || authored.kind === 'boss') return [];
  const filledPositions = [];
  slots.forEach((s, i) => { if (s && s.megidoId) filledPositions.push(i + 1); });
  return (authored.entry.effectiveTactics || []).map((t) => {
    const effects = [];
    let known = false;
    for (const effectId of t.meansEffects || []) {
      if (enemyFact && effectInvalidAgainst(enemyFact, effectId)) continue;
      if (prof && !effectAllowedRestricted(effectId)) continue;
      const effect = index.byEffect.get(effectId);
      if (!effect) continue;
      known = true;
      const holders = [];
      const me = [];
      for (const h of effect.megido || []) {
        if (!memberIds.has(h.id)) continue;
        if (lockedLevel(h.via || [], levelOf ? levelOf(h.id) : null) !== null) continue;
        if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
        const viaText = [mediaShortForVia(prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || [])), methodShortLabel(effectId, effect.name)]
          .filter(Boolean).join('・');
        holders.push(viaText ? `${h.name}（${viaText}）` : h.name);
      }
      for (const h of effect.megidoMe || []) {
        if (!meHolderWorks({ holder: h, formation, styleClassOf })) continue;
        const vias = prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || []);
        if (vias.length === 0) continue;
        const positions = new Set();
        for (const v of vias) {
          if (v.leader || v.slot === 'leader') {
            positions.add(3);
            continue;
          }
          const pos = ME_SLOT_KEYS.indexOf(v.slot);
          if (pos < 0) continue;
          if (meViaReachesSlot(v, slots[pos], styleClassOf)) positions.add(pos + 1);
        }
        const posArr = [...positions].sort((a, b) => a - b);
        me.push({
          name: h.name, positions: posArr,
          missed: filledPositions.filter((p) => !positions.has(p)),
        });
      }
      for (const h of effect.orbs || []) {
        if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
        if (orbIds.has(h.orbId)) holders.push(`オーブ「${h.name}」（${methodShortLabel(effectId, effect.name)}）`);
      }
      effects.push({
        effectId, name: detailEffectLabel(effectId, effect.name), holders, me,
      });
    }
    if ((t.meansEffects || []).length === 0 || !known) {
      return { label: t.label, covered: null, effects: [] };
    }
    const covered = effects.some((e) => e.holders.length > 0 || e.me.length > 0);
    return { label: t.label, covered, effects };
  });
}

// 著述の対のカバーの内訳（SW92）: authoredPairCoverage と同じ判定で、
// 対ごとに「応じた戦術のうち編成に入っているもの（入り）」と「判定
// できるのに編成に入っていないもの（外れ）」を分解して返す。
// 入りの戦術は構成効果の内訳（authoredCoverageDetail）も持つ。
// 判定できない対は返さない（authoredPairCoverage と同じ）。
// 戻り値: [{ label, kind,
//           hits: [{ label, effects, missedEffects, judgedCount }],
//           misses: [label],
//           missDetails: [{ label, effects: [名前], effectIds: [効果ID] }] }]
export function authoredPairCoverageDetail({ authored, formation, index, levelOf = null, styleClassOf = null, enemyFact = null, restricted = false }) {
  if (!authored || authored.kind === 'boss') return [];
  const entry = authored.entry;
  const lines = authoredCoverageDetail({ authored, formation, index, levelOf, styleClassOf, enemyFact, restricted });
  const pairs = Array.isArray(entry.pairs) ? entry.pairs : null;
  const toHit = (r) => ({
    label: r.label,
    effects: r.effects.filter((e) => e.holders.length > 0 || e.me.length > 0),
    // 入っている戦術のうち、担い手のいない構成効果（行の文章で
    // 「何が不足か」の材料。判定は変えない）。
    missedEffects: r.effects
      .filter((e) => e.holders.length === 0 && e.me.length === 0)
      .map((e) => ({ effectId: e.effectId, name: e.name })),
    judgedCount: r.effects.length,
  });
  // 入っていない戦術の内訳（戦術名＋構成効果の名前）。行の文章で
  // 「どの手段が編成に無いか」の根拠に使う（misses の文字列は従来
  // どおり併せて返す）。effectIds は名前と同順の効果IDで、不足行の
  // ％（耐性系だけに付ける）の対象を文章側が判別するための材料。
  const toMiss = (r) => ({
    label: r.label,
    effects: r.effects.map((e) => e.name),
    effectIds: r.effects.map((e) => e.effectId),
  });
  if (!pairs) {
    return lines
      .filter((l) => l.label && l.covered !== null)
      .map((l) => ({
        label: l.label, kind: null,
        hits: l.covered ? [toHit(l)] : [],
        misses: l.covered ? [] : [l.label],
        missDetails: l.covered ? [] : [toMiss(l)],
      }));
  }
  const byLabel = new Map(lines.map((l) => [l.label, l]));
  const kindByName = new Map((entry.threats || []).map((t) => [t.name, t.kind || null]));
  const out = [];
  for (const p of pairs) {
    const responses = (p.responses || []).map((label) => byLabel.get(label)).filter(Boolean);
    if (responses.length === 0) continue;
    const judged = responses.filter((r) => r.covered !== null);
    if (judged.length === 0) continue;
    out.push({
      label: p.threat, kind: kindByName.get(p.threat) || null,
      hits: judged.filter((r) => r.covered).map(toHit),
      misses: judged.filter((r) => !r.covered).map((r) => r.label),
      missDetails: judged.filter((r) => !r.covered).map(toMiss),
    });
  }
  return out;
}

// 著述データの索引（ボス著述・通常敵著述）。main.js の読み込み側と
// テストで同じ組み立てを使うための純粋関数。
// ボスは名前引きと、30Fラッシュ等のマス引き（本拠階の項への参照）の
// 両方を持つ。
export function buildTacticsIndex(bossData, enemyData) {
  const bossByName = new Map(Object.entries((bossData && bossData.bosses) || {}));
  const bossBySquare = new Map();
  for (const entry of bossByName.values()) {
    if (entry.squareId) bossBySquare.set(entry.squareId, entry);
    for (const a of entry.alsoAppears || []) bossBySquare.set(a.squareId, entry);
  }
  for (const s of ((bossData && bossData.rush30F && bossData.rush30F.squares) || [])) {
    const home = bossByName.get(s.enemy);
    if (home) bossBySquare.set(s.squareId, home);
  }
  return {
    bossByName,
    bossBySquare,
    enemyByName: new Map(Object.entries((enemyData && enemyData.enemies) || {})),
  };
}

// その敵に著述があるか（M4 の扱いが正本）: ボスマスではボス著述
// （マス引き→名前引き）、それ以外は通常敵著述→ボス著述の名前引き。
// 戻り値: { kind: 'boss' | 'enemy', entry } | null。
// M4・M5・H6 で同じ引き方を使い、画面ごとに結論が食い違わないように
// する（実効スペック検証の案1）。
export function authoredEntryFor(tactics, name, def, squareId) {
  if (!tactics) return null;
  if (def && def.type === 'boss') {
    const entry = (squareId ? tactics.bossBySquare.get(squareId) : null)
      || tactics.bossByName.get(name);
    if (entry) return { kind: 'boss', entry };
  }
  const e = tactics.enemyByName.get(name);
  if (e) return { kind: 'enemy', entry: e };
  const b = tactics.bossByName.get(name);
  if (b) return { kind: 'boss', entry: b };
  return null;
}

// 著述の「有効な戦術」を根拠にしたカバー判定（M5、案1）。
// 通常敵の著述は戦術ごとに手段の効果IDを持つため、索引で担い手を引いて
// 編成と照らせる。手段の効果が索引に無い戦術と、文章だけのボス著述は
// 判定せず、参照として返す（covered: null）。
// resistUncovered は、耐性の戦術が編成に入っていない場合に立つ
// （案2の留保行の対象を、表示側が判断するための印）。
export function authoredCoverage({ authored, formation, index, levelOf = null, styleClassOf = null, enemyFact = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const memberIds = new Set();
  const orbIds = new Set();
  for (const slot of formation.slots || []) {
    if (slot.megidoId) memberIds.add(slot.megidoId);
    if (slot.orbId) orbIds.add(slot.orbId);
  }
  if (!authored || authored.kind === 'boss') {
    return [{ label: null, covered: null, coveredBy: [], resistUncovered: false }];
  }
  return (authored.entry.effectiveTactics || []).map((t) => {
    const effects = t.meansEffects || [];
    const coveredBy = [];
    let resist = false;
    let known = false;
    for (const effectId of effects) {
      if (effectId.startsWith('resist:')) resist = true;
      // 敵の耐性で演算上無効な付与系の効果はカバーに数えない
      // （相談 5-16・型5。enemyFact を渡さない呼び出しは従来どおり）。
      if (enemyFact && effectInvalidAgainst(enemyFact, effectId)) continue;
      // 制限下では、ホワイトリストの機構だけをカバーとして数え、
      // 保持者も制限下で使える via を持つ場合だけ数える。機構でない
      // 手段だけの戦術は、判定材料が無いものとして参照に留まる。
      if (prof && !effectAllowedRestricted(effectId)) continue;
      const effect = index.byEffect.get(effectId);
      if (!effect) continue;
      known = true;
      for (const h of effect.megido || []) {
        if (memberIds.has(h.id)) {
          if (lockedLevel(h.via || [], levelOf ? levelOf(h.id) : null) !== null) continue;
          if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
          const viaText = [mediaShortForVia(prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || [])), methodShortLabel(effectId, effect.name)]
            .filter(Boolean).join('・');
          coveredBy.push(viaText ? `${h.name}（${viaText}）` : h.name);
        }
      }
      for (const h of effect.megidoMe || []) {
        if (!meHolderWorks({ holder: h, formation, styleClassOf })) continue;
        if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
        const viaText = [mediaShortForVia(prof ? restrictedViasForEffect(effectId, h.name, h.via || [], prof) : (h.via || [])), methodShortLabel(effectId, effect.name)]
          .filter(Boolean).join('・');
        coveredBy.push(viaText ? `${h.name}（${viaText}）` : h.name);
      }
      for (const h of effect.orbs || []) {
        if (prof && restrictedViasForEffect(effectId, h.name, h.via || [], prof).length === 0) continue;
        if (orbIds.has(h.orbId)) coveredBy.push(`オーブ「${h.name}」（${methodShortLabel(effectId, effect.name)}）`);
      }
    }
    if (effects.length === 0 || !known) {
      return { label: t.label, covered: null, coveredBy: [], resistUncovered: false };
    }
    const covered = coveredBy.length > 0;
    return {
      label: t.label,
      covered,
      coveredBy: [...new Set(coveredBy)],
      resistUncovered: resist && !covered,
    };
  });
}

// ---- ギミックの圧縮表示（編成中、2026-11-19） ----
// 編成中に敵のギミックと対策の状態だけを短く出すための材料。
// 判定そのものは既存の formationCoverage / authoredCoverage が正で、
// ここでは「対（脅威↔対策）」単位への集約と、印・色の機械的な
// 割り当てだけを行う。長い説明文は持たない（詳細は敵シート側）。

// 著述の対（pairs）単位のカバー判定。通常敵の著述は「脅威に、
// 対策の戦術が応じる」対で書かれているため、戦術ごとの
// authoredCoverage の結果を対へ集約する: 応じる戦術のどれか1つ
// でも編成に入っていれば対策済み、判定できる戦術があってどれも
// 入っていなければ未対策。応じる戦術が無い対と、戦術が全て
// 判定できない（文章だけ）対は、断定できないため返さない。
// ボス著述は authoredCoverage と同じく判定しない（空を返す）。
// 戻り値: [{ label, kind, covered, coveredBy }]
export function authoredPairCoverage({ authored, formation, index, levelOf = null, styleClassOf = null, enemyFact = null, restricted = false }) {
  if (!authored || authored.kind === 'boss') return [];
  const entry = authored.entry;
  const lines = authoredCoverage({ authored, formation, index, levelOf, styleClassOf, enemyFact, restricted });
  const pairs = Array.isArray(entry.pairs) ? entry.pairs : null;
  if (!pairs) {
    // 対データが無い著述では、戦術そのものを単位にする（M5 の行と
    // 同じ形。判定できない戦術は落とす）。
    return lines
      .filter((l) => l.label && l.covered !== null)
      .map((l) => ({ label: l.label, kind: null, covered: l.covered, coveredBy: l.coveredBy }));
  }
  const byLabel = new Map(lines.map((l) => [l.label, l]));
  const kindByName = new Map((entry.threats || []).map((t) => [t.name, t.kind || null]));
  const out = [];
  for (const p of pairs) {
    const responses = (p.responses || []).map((label) => byLabel.get(label)).filter(Boolean);
    if (responses.length === 0) continue;
    const hit = responses.find((r) => r.covered === true);
    if (hit) {
      out.push({ label: p.threat, kind: kindByName.get(p.threat) || null, covered: true, coveredBy: hit.coveredBy });
    } else if (responses.some((r) => r.covered === false)) {
      out.push({ label: p.threat, kind: kindByName.get(p.threat) || null, covered: false, coveredBy: [] });
    }
  }
  return out;
}

// カバー行の担い手表記（「名前（媒体・方法）」「オーブ「名前」（方法）」）
// から、短い名前だけを取り出す（圧縮表示で担い手を添えるため）。
export function coveredByShortName(text) {
  const s = String(text || '');
  const orb = s.match(/^オーブ「([^」]+)」/);
  if (orb) return `オーブ「${orb[1]}」`;
  const i = s.indexOf('（');
  return i >= 0 ? s.slice(0, i) : s;
}

// ギミックの印（1文字）と色の割り当て。脅威の種類と名前から機械的に
// 決める（敵ごとに手書きはしない）。印は、読み替え表にある名前は
// その文字（感電=雷・束縛=縛・フォトン破壊=壊・かばう=守。見た目
// 予想のモックと同じ割り当て）、種族は種族名の頭文字、それ以外は
// 名前の頭文字。色は種類ごとの色板から、名前のハッシュで決める
// （同じ脅威は常に同じ色になる）。
const GIMMICK_MARK_BY_NAME = { '感電': '雷', '束縛': '縛', 'フォトン破壊': '壊', 'かばう': '守' };
const GIMMICK_PALETTES = {
  ailment: ['#c9860a', '#7a4fa8', '#b3541e', '#8e44ad', '#946b00', '#a03d63'],
  tactic: ['#2f5da8', '#c0392b', '#1f7a6d', '#5b6abf'],
  combo: ['#7a4fa8', '#c0392b', '#2f5da8'],
  race: ['#4a7a3a', '#6b7a2f', '#3a6b7a', '#7a5a2f'],
};
const GIMMICK_PALETTE_DEFAULT = ['#666f7a', '#7a6a53', '#4f615e'];

export function gimmickBadge(name, kind) {
  const raw = String(name || '');
  const raceMatch = raw.match(/^種族「(.+)」$/);
  const base = raceMatch ? raceMatch[1] : raw.replace(/（敵）$/, '');
  const mark = GIMMICK_MARK_BY_NAME[base] || base.charAt(0) || '?';
  const palette = GIMMICK_PALETTES[kind] || GIMMICK_PALETTE_DEFAULT;
  let h = 0;
  for (let i = 0; i < base.length; i += 1) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return { mark, color: palette[h % palette.length] };
}

// ---- マスエフェクトの要約（M6） ----
// ME の枠ごとの条件と効果をそのまま並べると、ゲームの文章の羅列に
// なって読めない（2026-11-19 ユーザー指摘）。編成画面では、その編成で
// 実際に効いている効果だけを、効果文ごとにまとめて枠位置つきで渡す。
// 条件の判定は従来の適合判定と同じ規則: 条件を '+' で割り、各部分が
// メンバーのスタイル・クラス・性別に合えば効いている。性別は基礎
// データ（性別表が正本）から引く。member に gender が無い場合だけ、
// 性別条件は判定できないものとして印を付けて分け、効いているとは
// 断定しない。条件の表記ゆれ（全角の '＋' 区切りと、性別の短縮形
// '男'/'女'）は、コーパスに実在するため読み替えして判定する
// （meSpeedPct・meHolderWorks も同じ規則）。
export const ME_SLOT_KEYS = ['1', '2', 'leader', '4', '5'];
export const ME_SLOT_LABELS = { 1: '枠1', 2: '枠2', leader: 'リーダー', 4: '枠4', 5: '枠5' };

// me: { slots: { '1': [{condition, effect}], ... } }
// members: ME_SLOT_KEYS と同順の { style, className, gender? } | null（空き枠は null）
// 戻り値: [{ effect, positions: [枠ラベル], genderUnknown }]
export function summarizeMeEffects(me, members) {
  const groups = new Map();
  ME_SLOT_KEYS.forEach((key, i) => {
    const member = members ? members[i] : null;
    if (!member) return;
    for (const e of (me && me.slots && me.slots[key]) || []) {
      if (!e || typeof e.effect !== 'string' || !e.effect) continue;
      const parts = String(e.condition || '').split(/[+＋]/).map((s) => s.trim()).filter(Boolean);
      const genders = parts
        .map((p) => (p === '男性' || p === '男' ? '男性' : p === '女性' || p === '女' ? '女性' : null))
        .filter(Boolean);
      const known = parts.filter((p) => p !== '男性' && p !== '女性' && p !== '男' && p !== '女' && p !== '-');
      const matches = known.every((p) => p === member.style || p === member.className);
      if (!matches) continue;
      let genderUnknown = false;
      if (genders.length > 0) {
        if (member.gender) {
          if (!genders.every((g) => g === member.gender)) continue;
        } else {
          genderUnknown = true;
        }
      }
      const gk = `${e.effect}${genderUnknown ? 'g' : ''}`;
      if (!groups.has(gk)) groups.set(gk, { effect: e.effect, genderUnknown, positions: [] });
      const g = groups.get(gk);
      const label = ME_SLOT_LABELS[key];
      if (!g.positions.includes(label)) g.positions.push(label);
    }
  });
  return [...groups.values()];
}

// ---- ME の枠条件のヒント（M6、2026-11-19） ----
// 編成作成のヒントとして、リーダーの ME の枠条件を空き枠に出し、
// 枠の候補と埋まった枠には条件に合う印を付けるための材料。
// 照合の規則は summarizeMeEffects と同じ: 条件を [+＋] で割り、
// 性別トークンを読み替え（男性/男・女性/女）、各部分がメンバーの
// スタイル・クラス・性別に合えば適合。対象は主のマスエフェクト
// だけ（サブは要約側で別に出る）。性別条件があり、メンバーの
// 性別が引けない場合は判定できない（'unknown'）として扱い、
// 印は付けない（推測で付けない）。

// 条件1件とメンバーの照合。戻り値: 'match' | 'nomatch' | 'unknown'
export function meConditionVerdict(condition, member) {
  if (!member) return 'unknown';
  const parts = String(condition || '').split(/[+＋]/).map((s) => s.trim()).filter(Boolean);
  const genders = parts
    .map((p) => (p === '男性' || p === '男' ? '男性' : p === '女性' || p === '女' ? '女性' : null))
    .filter(Boolean);
  const known = parts.filter((p) => p !== '男性' && p !== '女性' && p !== '男' && p !== '女' && p !== '-');
  if (!known.every((p) => p === member.style || p === member.className)) return 'nomatch';
  if (genders.length > 0) {
    if (!member.gender) return 'unknown';
    return genders.every((g) => g === member.gender) ? 'match' : 'nomatch';
  }
  return 'match';
}

// 枠の表示用条件: その枠の効果の条件を、データの並びのまま重複を
// 除いて返す。条件が空の効果（置いたメンバー全員に効く）は表示
// する文字列が無いため除く（適合判定では meConditionVerdict が
// match を返す）。枠に効果が無ければ null。
export function meSlotConditions(me, slotKey) {
  const entries = (me && me.slots && me.slots[slotKey]) || null;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const seen = [];
  for (const e of entries) {
    if (!e || typeof e.condition !== 'string') continue;
    const c = e.condition.trim();
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen;
}

// その枠にメンバーを置くと、ME の効果が1件でも効くか。'match' の
// 効果が1件でもあれば true。判定できない効果しか無い場合は false。
export function meSlotMatches(me, slotKey, member) {
  const entries = (me && me.slots && me.slots[slotKey]) || null;
  if (!Array.isArray(entries) || !member) return false;
  return entries.some((e) => e && meConditionVerdict(e.condition, member) === 'match');
}

// ピッカーの ME 行表示（2026-11-19 訂正）: 今選んでいる編成枠に
// ついてだけ、リーダーの主 ME の条件行のうちメンバーが満たす行と、
// その枠・その行の効果（正本表記）を返す。
// 戻り値: [{ row, effect }]（row は1始まりの行番号 = ME1・ME2・…）
// - ME の表は「枠×条件行」の行列で、各枠リストの並び順がそのまま
//   条件1・条件2・条件3…の行に対応する。行の揃い（全枠で行数が
//   一致すること）はパイプラインの検証 means-me-rows が全272体で
//   担保する。SW44 の「条件のある枠すべてを出す」表示は、同じ条件
//   が行列の複数枠に現れて候補の行が枠の数だけ膨らんだため廃止し、
//   この行単位の表示に置き換えた（ユーザー訂正、スクショ付き）。
// - 行とみなすのは実条件（空でも '-' でもない条件文字列）を持つ
//   効果だけ。'-' はリーダー本人のための表記で条件としては実在
//   しない。無条件の効果は「条件を満たして受ける効果」ではない
//   ため出さない（実データではアバラムC 枠5の1行目が該当し、その
//   場合も番号は行の位置どおりになる）。
// - 満たす = meConditionVerdict が 'match'。判定できない
//   （'unknown'）行は数えない（推測で付けない）。
export function meRowFits(me, slotKey, member) {
  if (!me || !me.slots || !member) return [];
  const entries = me.slots[slotKey];
  if (!Array.isArray(entries)) return [];
  const fits = [];
  entries.forEach((e, i) => {
    if (!e || typeof e.condition !== 'string') return;
    const c = e.condition.trim();
    if (c === '' || c === '-') return;
    if (meConditionVerdict(e.condition, member) !== 'match') return;
    if (typeof e.effect === 'string' && e.effect) fits.push({ row: i + 1, effect: e.effect });
  });
  return fits;
}

// ---- 戦旗の条件チェック（2026-11-20） ----
// 正本: corpus-status/戦旗.json（保持者一覧）／ corpus-elements/
// 戦旗.json（ルール）。戦旗はバトル中に覚醒スキルで味方の第3MEへ
// 付与する効果で、編成時点では存在しない。ここで扱うのは、保持者が
// 編成にいる場合に「付与先のメンバーが発揮条件をみたしているか」の
// 確認だけ（第3MEの上書きの再現はしない。ユーザー確定スコープ）。
// 発揮条件は通常の ME と同じ作法で、保持者データ（flag.v1.json）の
// tokens（スタイル／クラスの単一条件）が材料。複数トークンは OR
// （どちらか一方でよい）、トークン空は「条件なし」で常に成立。
// 付与先は左陣=枠1・2・3／右陣=枠3・4・5（枠番号は1始まり、
// 3=リーダー。枠3は両陣に重なる）。

// 受け手1人が発揮条件をみたすか。member は { style, className }。
export function flagConditionMet(holder, member) {
  if (!holder || !member) return false;
  const tokens = holder.tokens || [];
  if (tokens.length === 0) return true;
  return tokens.some((t) => (t.kind === 'style'
    ? member.style === t.value
    : member.className === t.value));
}

// 付与先の各枠について、誰が条件をみたしているか。
// members は編成5枠の { style, className } | null（空き枠は null）。
// 戻り値: { met: [枠番号], filled: [枠番号] }
//   filled は付与先の範囲でメンバーがいる枠、met はそのうち条件を
//   みたした枠。空き枠は判定しない（いないメンバーは受け手でない）。
export function flagCheckFor(holder, members) {
  const met = [];
  const filled = [];
  for (const pos of (holder && holder.slots) || []) {
    const member = members ? members[pos - 1] : null;
    if (!member) continue;
    filled.push(pos);
    if (flagConditionMet(holder, member)) met.push(pos);
  }
  return { met, filled };
}

// ---- サブマスエフェクト（第3ME）の発生判定と上書き ----
// 正本: corpus-status/サブマスエフェクト.json（ユーザー提供の定義文）。
// 規則:
//   - 持ち主は4体（リヴァイアサン／ベルフェゴール／マモン／ルシファー。
//     データ上は subMassEffect を持つ体として識別する）。
//   - 発生条件: 持ち主がリーダー以外（メンバー）として編成され、
//     かつ「サブマスエフェクトを発生させる」効果のある専用霊宝を
//     渡していること。
//   - 消滅: 持ちうるメギドを2人以上メンバーに入れると、専用霊宝の
//     有無に関わらず、いずれも発生しない。ゲームのバグとして、
//     アスモデウスRも「持ちうるメギド」として数える（本人は発生
//     させないが、メンバーにいるだけで消滅側に数える）。
//   - 発生した場合、リーダーの ME の第3の効果（条件行の3行目）と
//     条件が、サブMEの効果と条件で上書きされる。
//   - 効果は受け手の枠で決まる（枠1・3・5が1行目、枠2・4が2行目。
//     データの格納形式どおり）。
// 従来のアプリはリーダー本人のサブMEを集約しており、配置が逆転
// していた（発生しない配置で表示し、発生する配置で表示しない）。
export const SUB_ME_BUG_HOLDER_ID = '祖32_アスモデウスR';

// 発生判定。meById は ME データの megido 辞書、memberIds は
// リーダー以外の枠にいるメギドIDの配列、specialReishouOf(id) は
// そのメギドの専用霊宝の所持（あり=true）を返す関数。
// 戻り値: { status, holderId, countedIds }
//   status: 'active'（発生）| 'vanished'（2人以上で消滅）|
//           'inactive'（持ち主はいるが専用霊宝が無く発生しない）|
//           'none'（持ち主がメンバーにいない。アスモデウスRだけが
//           いる場合も、本人は発生させないため 'none'）
//   countedIds: メンバー内の「持ちうるメギド」全員（バグ込み）。
export function subMeOccurrence({ meById, memberIds, specialReishouOf }) {
  const countedIds = (memberIds || []).filter((id) => {
    const rec = meById ? meById[id] : null;
    return Boolean((rec && rec.subMassEffect) || id === SUB_ME_BUG_HOLDER_ID);
  });
  if (countedIds.length >= 2) return { status: 'vanished', holderId: null, countedIds };
  if (countedIds.length === 0) return { status: 'none', holderId: null, countedIds };
  const holderId = countedIds[0];
  if (holderId === SUB_ME_BUG_HOLDER_ID) return { status: 'none', holderId: null, countedIds };
  if (typeof specialReishouOf === 'function' && specialReishouOf(holderId)) {
    return { status: 'active', holderId, countedIds };
  }
  return { status: 'inactive', holderId, countedIds };
}

// リーダーの ME にサブMEの上書きを適用した新しい ME を返す
// （元のデータは書き換えない）。各枠について、条件行の3行目を
// サブMEのその枠の効果・条件に差し替える。リーダーの ME に
// 3行目が無い場合（2行のみの ME が大半）は、サブMEが3行目として
// 立つ（第3の効果の層が新たに立つ形。正本の「上書き」は第3層の
// 効果と条件がサブ側になることであり、層が空ならサブが入る）。
export function meWithSubOverwrite(massEffect, subMassEffect) {
  if (!massEffect || !massEffect.slots) return massEffect;
  if (!subMassEffect || !subMassEffect.slots) return massEffect;
  const slots = {};
  for (const key of ME_SLOT_KEYS) {
    const entries = [...(massEffect.slots[key] || [])];
    const subEntry = (subMassEffect.slots[key] || [])[0] || null;
    if (subEntry) {
      while (entries.length < 2) entries.push(null);
      if (entries.length === 2) entries.push(subEntry);
      else entries[2] = subEntry;
    }
    slots[key] = entries;
  }
  return { ...massEffect, slots };
}

// 表示用: 上書きされる3行目を除いた ME。サブMEが発生している
// とき、本体側の要約は1・2行目だけを出し、3行目はサブ側の
// 要約が担う（二重に出さない）。
export function meWithoutThirdRow(me) {
  if (!me || !me.slots) return me;
  const slots = {};
  for (const key of ME_SLOT_KEYS) {
    slots[key] = (me.slots[key] || []).slice(0, 2);
  }
  return { ...me, slots };
}

// 需要の集計（H6）: 未処理の戦闘マス全体について、対策の候補になる
// メギドを数える。候補が所持者のうち2体以下しかいない脅威では、その
// 候補を「必須級」として数える。
// isAuthored(name, def, squareId) を渡すと、著述のある敵の脅威は集計から
// 外す（M4 の扱いに揃える。実効スペック検証の案1: 著述のある敵について
// は著述が正であり、生の導出で数えた需要は M4 の結論と食い違う）。
// 戻り値: Map(megidoId -> { total, essential, spots: [{floor, squareId, threatName, enemyName, essential}] })
// ---- 演算の一本化（敵シート作り直し、相談 5-14・導出監査 型1/2/4/5/7/8） ----
// 対策の結論は入口ごとに食い違わないよう、ここで1つに決める:
// - 脅威の列挙は enemyThreatsUnified（著述を主とし、著述に対応しない
//   導出の脅威だけを足す）。
// - 脅威への答えは threatAnswerBlocks（導出の対策クラスと、著述の
//   対に応じる戦術の保持者を、同じ戦略タイプの軸に載せる）。
// - ピッカーの印・需要は、この2つから引く（pickerAnswersForEnemy /
//   aggregateDemand）。入口側は詳しさの成型だけを変える。
// 耐性の適格（型5）と凸の判定（型7）は、この演算の中で一元化する。

// 著述の脅威・戦術が応じている導出脅威のIDの集合。
// 材料: 著述の脅威の counterThreatId と、戦術の classRef（脅威ID）。
export function authoredLinkedThreatIds(authored) {
  const ids = new Set();
  if (!authored) return ids;
  for (const t of authored.entry.threats || []) {
    if (t.counterThreatId) ids.add(t.counterThreatId);
  }
  for (const tac of authored.entry.effectiveTactics || []) {
    if (tac.classRef) ids.add(tac.classRef);
  }
  return ids;
}

// 敵1種の脅威を、著述と導出で1つのリストにする。
// - 通常敵の著述がある場合: 対（pairs）の脅威を主の項目とし、
//   対応する導出脅威は別項目として出さない。著述に対応しない導出
//   脅威は導出項目として足す（監査 型1・型2 の解消）。
//   対応付けは counterThreatId / classRef を主にし、状態異常だけは
//   脅威名が著述の脅威名・文面に含まれる場合も対応とみなす。
// - ボス著述: 文章が正の確定規則を維持し、導出の脅威は足さない。
// - 著述なし: 導出の脅威だけ（種族は脅威ではないため除く）。
// threatLevels（生成データ threat-levels.v1.json）を渡すと、各項目に
// 下書きの段階（level: 'S'|'A'|'B'）が付く。段階の決め方はデータ側に
// あり、ここでは引くだけ。
// 項目: { key, source: 'authored'|'derived', label, detail,
//         threatId（導出のID。著述項目では対応する導出脅威のID）,
//         derived（対応する導出脅威オブジェクト or null）,
//         derivedAlso（著述項目だけ: 応答戦術の classRef で結び
//         ついた追加の導出脅威。SW95 便1）,
//         authoredThreat（著述の脅威オブジェクト or null）,
//         pair（著述の対 or null）, level }
export function enemyThreatsUnified({ fact, authored, clsById, threatLevels = null }) {
  const enemyName = fact ? fact.name : (authored ? authored.entry.name : null);
  const info = fact ? threatsForEnemy(fact, clsById) : { threats: [] };
  const derivedById = new Map(info.threats.map((t) => [t.threatId, t]));
  const authoredLevel = (label) => {
    const per = threatLevels && threatLevels.authored ? threatLevels.authored[enemyName] : null;
    const hit = per ? per[label] : null;
    return hit ? hit.level : null;
  };
  const derivedLevel = (threatId) => {
    const per = threatLevels && threatLevels.derived ? threatLevels.derived[enemyName] : null;
    const hit = per ? per[threatId] : null;
    return hit ? hit.level : null;
  };
  const out = [];
  if (authored && authored.kind === 'boss') {
    for (const t of authored.entry.threats || []) {
      out.push({
        key: `authored:${t.label}`, source: 'authored', label: t.label,
        detail: t.detail || '', threatId: null, derived: null,
        authoredThreat: t, pair: null, level: authoredLevel(t.label),
      });
    }
    return out;
  }
  const consumed = new Set();
  if (authored && authored.kind === 'enemy') {
    const entry = authored.entry;
    const threatsByName = new Map((entry.threats || []).map((t) => [t.name, t]));
    const tacticsByLabel = new Map((entry.effectiveTactics || []).map((t) => [t.label, t]));
    const pairs = Array.isArray(entry.pairs) ? entry.pairs : [];
    const labels = pairs.length > 0
      ? pairs.map((p) => p.threat).filter(Boolean)
      : (entry.threats || []).map((t) => t.name);
    for (const label of labels) {
      const at = threatsByName.get(label) || null;
      const pair = pairs.find((p) => p.threat === label) || null;
      let derived = null;
      if (at && at.counterThreatId && derivedById.has(at.counterThreatId)) {
        derived = derivedById.get(at.counterThreatId);
      }
      if (!derived) {
        // 状態異常だけ、名前の包含でも対応付ける。
        const text = `${label} ${at ? (at.basis || '') : ''}`;
        for (const t of info.threats) {
          if (!t.threatId.startsWith('ailment:')) continue;
          if (consumed.has(t.threatId)) continue;
          if (text.includes(t.name)) { derived = t; break; }
        }
      }
      if (derived) consumed.add(derived.threatId);
      // 対の応答戦術が classRef で指す導出脅威は、この項目に
      // 副次的な導出（derivedAlso）として付ける（SW95 便1・
      // 3段目の統合）。付けずに消費だけすると、その脅威への
      // 導出の答えが計算の材料から落ちる（監査 型2 の残り）。
      // どの対にも付かなかった導出脅威は、下のループで導出
      // 項目としてそのまま出す（消費で消さない）。
      const derivedAlso = [];
      if (pair) {
        for (const resp of pair.responses || []) {
          const tac = tacticsByLabel.get(resp);
          const ref = tac ? tac.classRef : null;
          if (!ref || !derivedById.has(ref)) continue;
          if (derived && derived.threatId === ref) continue;
          if (consumed.has(ref)) continue;
          derivedAlso.push(derivedById.get(ref));
          consumed.add(ref);
        }
      }
      out.push({
        key: `authored:${label}`, source: 'authored', label,
        detail: at ? (at.basis || '') : '', threatId: derived ? derived.threatId : null,
        derived, derivedAlso, authoredThreat: at, pair,
        level: authoredLevel(label) || (derived ? derivedLevel(derived.threatId) : null),
      });
    }
  }
  for (const t of info.threats) {
    if (t.threatId.startsWith('race:')) continue;
    if (consumed.has(t.threatId)) continue;
    out.push({
      key: `derived:${t.threatId}`, source: 'derived', label: t.name,
      detail: t.evidence || '', threatId: t.threatId, derived: t,
      authoredThreat: null, pair: null, level: derivedLevel(t.threatId),
    });
  }
  return out;
}

// 敵単位の修飾軸の注記（SW95 便3）: 生成データの units（段階の
// 物差しには混ぜない敵単位の材料）を、敵シートに併記する短い
// 注記行に組み立てる。出現は段階にせず出現範囲の注記として出し、
// 取り巻きはその脅威の最大段階を併記する。素早さは上位帯の種
// だけ（数値はステータス行に出ているため、ここでは帯だけ）。
// 自己強化（selfBuff）は、マスルール分はステータスの内訳に、
// 能力分は特性の文に既に出るため、ここでは重ねない。
// levelFloor（速さの下限）は現行データでは付いた種が無い。
export function threatUnitNotes(threatLevels, name) {
  const u = threatLevels && threatLevels.units ? threatLevels.units[name] : null;
  if (!u) return [];
  const notes = [];
  const floors = (u.appearance && u.appearance.floors) || [];
  if (floors.length > 0) {
    const ranges = [];
    let start = floors[0];
    let prev = floors[0];
    for (const f of floors.slice(1)) {
      if (f === prev + 1) { prev = f; continue; }
      ranges.push(start === prev ? `${start}F` : `${start}〜${prev}F`);
      start = f; prev = f;
    }
    ranges.push(start === prev ? `${start}F` : `${start}〜${prev}F`);
    notes.push(`出現: ${ranges.join('・')}${u.appearance.boss ? '（ボスとしても出現）' : ''}`);
  }
  if (u.minion && u.minion.maxLevel) {
    const from = (u.minion.from || []).join('・');
    notes.push(`取り巻きの脅威: 最大${u.minion.maxLevel}${from ? `（${from}）` : ''}`);
  }
  if (u.speed) notes.push('素早さ: 全種の上位帯');
  return notes;
}

// 階の一番の脅威（全体構成の決定 問題5・案1、2026-11-26）: 階全体
// ページの階の行に出す1行の材料。その階の戦闘・ボスマスに現れる種の
// 脅威のうち、脅威レベル（threatLevels の derived／authored の段階）
// が付いたものだけを候補にし、最高段階の1つを返す。段階の付いた
// 脅威が1つも無い階は null（根拠が無い階では無理に出さない）。
// 同段階の決定順: ①その階のボス種の脅威 ②導出（derived。対策クラス
// の短い名前で1行に収まる）を著述より先 ③その階で現れるマスが多い
// 種 ④出現順・データ順の先勝ち。
const THREAT_LEVEL_RANK = { S: 3, A: 2, B: 1 };
export function floorTopThreatLabel(threatLevels, clsById, floorDef) {
  if (!threatLevels || !floorDef) return null;
  const speciesOrder = [];
  const sqCount = new Map();
  for (const def of Object.values(floorDef.squares || {})) {
    if (!def || (def.type !== 'battle' && def.type !== 'boss')) continue;
    for (const name of def.enemies || []) {
      if (!sqCount.has(name)) { sqCount.set(name, 0); speciesOrder.push(name); }
      sqCount.set(name, sqCount.get(name) + 1);
    }
  }
  let best = null;
  const consider = (cand) => {
    if (!best) { best = cand; return; }
    if (cand.rank !== best.rank) { if (cand.rank > best.rank) best = cand; return; }
    if (cand.isBoss !== best.isBoss) { if (cand.isBoss) best = cand; return; }
    if (cand.derived !== best.derived) { if (cand.derived) best = cand; return; }
    if (cand.sq !== best.sq) { if (cand.sq > best.sq) best = cand; return; }
  };
  for (const name of speciesOrder) {
    const base = { isBoss: name === floorDef.boss, sq: sqCount.get(name) };
    const perDerived = threatLevels.derived ? threatLevels.derived[name] : null;
    if (perDerived) {
      for (const [threatId, info] of Object.entries(perDerived)) {
        const rank = THREAT_LEVEL_RANK[info && info.level];
        if (!rank) continue;
        const cls = clsById ? clsById.get(threatId) : null;
        consider({ ...base, rank, derived: true, label: cls ? cls.name : threatId });
      }
    }
    const perAuthored = threatLevels.authored ? threatLevels.authored[name] : null;
    if (perAuthored) {
      for (const [label, info] of Object.entries(perAuthored)) {
        const rank = THREAT_LEVEL_RANK[info && info.level];
        if (!rank) continue;
        consider({ ...base, rank, derived: false, label });
      }
    }
  }
  return best ? best.label : null;
}

// 著述の戦術1件の候補を構造で返す（annotateAuthoredTactic と同じ
// 引き方: 戦術の手段の例を索引で引き、保持者と手段の内訳を返す）。
// 凸が足りない手段には locked が付く。索引で引けない例は unknown。
export function authoredTacticCandidates({ tactic, index, owned = null, levelOf = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const megido = new Map();
  const orbs = new Map();
  for (const m of tactic.means || []) {
    // 制限下では、ホワイトリストの機構でない手段は候補にしない。
    if (prof && !effectAllowedRestricted(m.effect)) continue;
    const effect = index ? index.byEffect.get(m.effect) : null;
    for (const name of m.megidoExamples || []) {
      if (!megido.has(name)) megido.set(name, { id: null, name, means: [], unknown: true });
      const e = megido.get(name);
      const holder = effect ? (effect.megido || []).find((h) => h.name === name) : null;
      const meHolder = !holder && effect ? (effect.megidoMe || []).find((h) => h.name === name) : null;
      const found = holder || meHolder;
      if (found) {
        if (owned && !owned.has(found.id)) continue;
        const via = prof ? restrictedViasForEffect(m.effect, found.name, found.via || [], prof) : (found.via || []);
        // 制限下で使える形が1つも無い例は候補に入れない（id を
        // 持たないままにし、呼び出し側の候補から落ちる）。
        if (prof && via.length === 0) continue;
        e.id = found.id;
        e.unknown = false;
        const level = levelOf ? levelOf(found.id) : null;
        const locked = lockedLevel(via, level);
        e.means.push({
          effectId: m.effect,
          effectName: m.effectName || (effect && effect.name) || '',
          via,
          value: meansValue(usableVias(via, level)),
          fromMe: Boolean(meHolder),
          ...(locked !== null ? { locked } : {}),
        });
      }
    }
    for (const name of m.orbExamples || []) {
      if (!orbs.has(name)) orbs.set(name, { orbId: null, name, means: [], unknown: true });
      const e = orbs.get(name);
      const holder = effect ? (effect.orbs || []).find((h) => h.name === name) : null;
      if (holder) {
        const via = prof ? restrictedViasForEffect(m.effect, holder.name, holder.via || [], prof) : (holder.via || []);
        if (prof && via.length === 0) continue;
        e.orbId = holder.orbId;
        e.unknown = false;
        e.means.push({ effectId: m.effect, effectName: m.effectName || (effect && effect.name) || '', via });
      }
    }
  }
  return { megido: [...megido.values()], orbs: [...orbs.values()] };
}

// 候補が現在の凸で使えるか（全ての手段が凸不足なら使えない。型7）。
export function candidateUsable(candidate) {
  const means = candidate.means || [];
  if (means.length === 0) return true;
  return means.some((m) => typeof m.locked !== 'number');
}

// 脅威1件への答えを、戦略タイプ（対策クラス）別のブロックで返す。
// - 導出の答え: 対応する導出脅威の対策クラスの候補。候補の演算は
//   candidatesForClass（耐性適格は enemyFact 経由、凸は levelOf 経由）。
// - 著述の答え: 対に応じる戦術のうち手段を持つものの保持者。戦術は
//   classRef（脅威ID）の対策クラスごとに手段を分けて寄せ、どの
//   クラスにも収まらない手段は戦術ラベル自体をブロックにする
//   （authoredTacticBlocks）。
// ブロック: { classId, label, how, methodNote, noteOnly, authored,
//             tacticLabel, megido: [候補], orbs: [候補] }
export function threatAnswerBlocks({ threat, fact, authored, clsById, index, owned = null, levelOf = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const blocks = [];
  const byClass = new Map();
  const pushBlock = (b) => {
    // tacticLabels は、ブロックに寄せられた著述の戦術ラベルの和集合
    // （表示側が「対の戦術がブロックに載ったか」を判定するための
    // 付帯情報。候補の計算には影響しない）。
    b.tacticLabels = b.tacticLabel ? [b.tacticLabel] : [];
    if (b.classId && byClass.has(b.classId)) {
      const base = byClass.get(b.classId);
      const seenM = new Set(base.megido.map((c) => c.id || c.name));
      for (const c of b.megido) if (!seenM.has(c.id || c.name)) base.megido.push(c);
      const seenO = new Set(base.orbs.map((c) => c.orbId || c.name));
      for (const c of b.orbs) if (!seenO.has(c.orbId || c.name)) base.orbs.push(c);
      base.authored = base.authored || b.authored;
      if (!base.tacticLabel && b.tacticLabel) base.tacticLabel = b.tacticLabel;
      for (const l of b.tacticLabels) {
        if (!base.tacticLabels.includes(l)) base.tacticLabels.push(l);
      }
      return base;
    }
    blocks.push(b);
    if (b.classId) byClass.set(b.classId, b);
    return b;
  };
  // 導出の答え。主の導出脅威に、著述項目へ副次的に結びついた
  // 導出脅威（derivedAlso）も同じ物差しで足す（SW95 便1）。
  // ブロックは classId で寄せられるため、同じ対策クラスの答えは
  // 1つのブロックにまとまる。
  for (const derived of [threat.derived, ...(threat.derivedAlso || [])]) {
    if (!derived) continue;
    const threatDef = clsById.get(derived.threatId);
    if (threatDef) {
      for (const classDef of threatDef.classes) {
        if (!classApplies(classDef, derived.methods)) continue;
        const cands = candidatesForClass(classDef, index, owned, levelOf, { enemyFact: fact, restricted: prof });
        // 制限下では、候補の残らないブロックは出さない（速攻の
        // ような方針だけのクラスも含む。ホワイトリスト方式）。
        if (prof && cands.megido.length === 0 && cands.orbs.length === 0) continue;
        pushBlock({
          classId: classDef.id, label: classDef.label, how: classDef.how || '',
          methodNote: classDef.methodNote || '', noteOnly: cands.noteOnly,
          authored: false, tacticLabel: null,
          megido: cands.megido, orbs: cands.orbs,
        });
      }
    }
  }
  // 著述の答え（対に応じる戦術）。
  if (authored && authored.kind === 'enemy' && threat.pair) {
    const byLabel = new Map((authored.entry.effectiveTactics || []).map((t) => [t.label, t]));
    for (const resp of threat.pair.responses || []) {
      const tactic = byLabel.get(resp);
      if (!tactic || !(tactic.meansEffects || []).length) continue;
      for (const b of authoredTacticBlocks({ tactic, clsById, index, owned, levelOf, restricted: prof })) {
        pushBlock(b);
      }
    }
  }
  return blocks;
}

// 著述の戦術1件（手段を持つもの）を答えブロックにする。対の応答と
// 全体の進め方で同じ組み立てを使う（SW95 便2）。
// 看板と候補の一致（2026-11-25）: 戦術の手段を classRef の脅威の
// 対策クラスごとに分け、クラスに収まる手段はそのクラスの看板の
// ブロックに、どのクラスにも収まらない手段は戦術ラベル自体の
// ブロックに分ける。従来は最初に手段が1つでも重なるクラスの看板に
// 手段全体の候補を載せており、看板と候補が食い違っていた（例:
// 死をあやす者の「束縛・弱体を入れる／死者特効で削る」が死者特効の
// 看板で束縛・弱体の候補を並べた）。同じ classRef の別クラスに
// 収まる手段は、そのクラスの看板で別ブロックになる。
// 手段の内訳（means）が無い戦術と、classRef の寄せ先が無い戦術は
// 分けようがないため、従来どおり1ブロックにする（寄せられる
// クラスがあればその看板、無ければ戦術ラベル）。
// 制限下では、機構の候補が1つも残らない部分はブロックにしない
// （戦術の文章自体は「どう倒すか」側に残る）。
// 戻り値: ブロックの配列（候補が残らない場合は空配列）。
export function authoredTacticBlocks({ tactic, clsById, index, owned = null, levelOf = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const means = tactic.means || [];
  const refDef = tactic.classRef && clsById.has(tactic.classRef)
    ? clsById.get(tactic.classRef) : null;
  const build = (classDef, subMeans) => {
    const cands = authoredTacticCandidates({
      tactic: { ...tactic, means: subMeans }, index, owned, levelOf, restricted: prof,
    });
    if (prof
      && !cands.megido.some((c) => c.id) && !cands.orbs.some((c) => c.orbId)) return null;
    return {
      classId: classDef ? classDef.id : null,
      label: classDef ? classDef.label : tactic.label,
      how: classDef ? (classDef.how || '') : '',
      methodNote: classDef ? (classDef.methodNote || '') : '',
      noteOnly: false, authored: true, tacticLabel: tactic.label,
      megido: cands.megido.filter((c) => c.id),
      orbs: cands.orbs.filter((c) => c.orbId),
    };
  };
  if (!refDef || means.length === 0) {
    const classDef = refDef
      ? (refDef.classes || []).find((c) =>
        (c.effects || []).some((e) => (tactic.meansEffects || []).includes(e))) || null
      : null;
    const b = build(classDef, means);
    return b ? [b] : [];
  }
  const blocks = [];
  const used = new Set();
  for (const classDef of refDef.classes || []) {
    const effs = classDef.effects || [];
    if (!effs.length) continue;
    const sub = means.filter((m) => !used.has(m) && effs.includes(m.effect));
    if (!sub.length) continue;
    for (const m of sub) used.add(m);
    const b = build(classDef, sub);
    if (b) blocks.push(b);
  }
  const rest = means.filter((m) => !used.has(m));
  if (rest.length) {
    const b = build(null, rest);
    if (b) blocks.push(b);
  }
  return blocks;
}

// 全体の進め方（overallTactics）の戦術のうち、手段を持つものの
// 答えブロック（SW95 便2、監査C の解消）。全体の進め方は特定の
// 脅威への対ではないため、従来は対の responses と導出クラスだけを
// 使う演算（カルーセル・ピッカー・需要）に一切届かず、手段の
// 保持者に印も需要も付かなかった（完殺がその最大例: 弱点◎の種が
// 多いのに、状態特効の対象10種にも入っていないため、編成文脈の
// ピッカーでも保持者が無印だった）。脅威に紐づかないブロック
// として、対の応答と同じ組み立てで返す。文章だけの戦術は対象外
// （「どう倒すか」の文章として残る）。
export function authoredOverallBlocks({ authored, clsById, index, owned = null, levelOf = null, restricted = false }) {
  if (!authored || authored.kind !== 'enemy') return [];
  const byLabel = new Map((authored.entry.effectiveTactics || []).map((t) => [t.label, t]));
  const blocks = [];
  for (const label of authored.entry.overallTactics || []) {
    const tactic = byLabel.get(label);
    if (!tactic || !(tactic.meansEffects || []).length) continue;
    blocks.push(...authoredTacticBlocks({ tactic, clsById, index, owned, levelOf, restricted }));
  }
  return blocks;
}

// ---- 需要の警告文（全体の進め方の戦術分、2026-11-25 形式変更） ----
// 戦術ラベルが「／」で複数の手を並べている場合、候補の注記を
// 戦術全体に付けると、どの手への注記か分からない（ユーザー指摘:
// 死をあやす者の「束縛・弱体を入れる／死者特効で削る」で、候補が
// 1体だけなのは死者特効の方なのに、文全体がそう読めた）。
// そのため、ラベルを番号（①②…）で分け、候補が2体以下しか
// いない手にだけ、その手の後ろへ注記を付ける形にする。
// 手とブロックの対応付け: ブロックの手段（対策クラスが担う効果、
// クラスに収まらない残りの手段）から手がかり語を引き、ラベルの
// 断片と照合する。一意に決まらない場合は、割当ての消去法
// （残りのブロックと残りの断片が1つずつなら対応付ける）までで
// 止め、それでも決まらないブロックの注記は、ブロック自身の看板
// （対策クラスのラベル）を名指しして文末に足す（推測で断片に
// 結びつけない）。
const DEMAND_PART_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// 効果IDから、ラベルの断片に対応付けるための手がかり語を引く。
function demandEffectKeywords(effect) {
  if (effect.startsWith('bonus:race:')) return [effect.slice('bonus:race:'.length), '特効'];
  if (effect.startsWith('inflict:')) {
    const n = effect.slice('inflict:'.length);
    return n === '煉獄の炎' ? ['煉獄の炎', '煉獄'] : [n];
  }
  if (effect.startsWith('resist:')) return [effect.slice('resist:'.length), '耐性'];
  if (effect.startsWith('barrier')) return ['バリア'];
  switch (effect) {
    case 'debuff:atk': return ['攻撃力', '弱体'];
    case 'debuff:def': return ['防御力', '弱体'];
    case 'debuff:spd': return ['素早さ', '弱体'];
    case 'debuff:all': return ['弱体'];
    case 'photon:destroy': return ['フォトン破壊', 'フォトン干渉', 'フォトン操作', 'フォトン'];
    case 'photon:steal': return ['フォトン奪取', 'フォトンを奪う', 'フォトン干渉', 'フォトン操作', 'フォトン'];
    case 'photon:convert': return ['フォトン変換', 'フォトン転換', 'フォトンを転換', '転換', '変換', 'フォトン干渉', 'フォトン操作', 'フォトン'];
    case 'photon:degrade': return ['フォトン劣化', '劣化', 'フォトン干渉', 'フォトン操作', 'フォトン'];
    case 'photon:capacity-down': return ['フォトン容量低下', 'フォトン容量', '容量低下', '容量を下げる', 'フォトン干渉', 'フォトン操作', 'フォトン'];
    case 'gauge:up-down': return ['覚醒ゲージ上昇量低下', '覚醒増加量低下', '上昇量低下', '覚醒ゲージ', '覚醒操作', 'ゲージ', 'フォトン干渉', 'フォトン操作'];
    case 'gauge:down': return ['覚醒ゲージ', '覚醒操作', 'ゲージ', 'フォトン干渉', 'フォトン操作'];
    case 'dispel:buff': return ['強化解除', '解除'];
    case 'heal': return ['回復', '増強'];
    case 'revive':
    case 'revive:auto': return ['蘇生'];
    default: return [effect.split(':').pop()];
  }
}

// ブロックが担う効果の一覧。対策クラスのブロックはそのクラスの
// 効果、クラスに収まらない残りのブロックは、戦術の手段のうち
// どのクラスにも収まらないもの。
function demandBlockEffects(block, tactic, clsById) {
  if (!tactic) return [];
  const refDef = tactic.classRef && clsById ? clsById.get(tactic.classRef) : null;
  if (block.classId) {
    const classDef = refDef && (refDef.classes || []).find((c) => c.id === block.classId);
    return classDef ? (classDef.effects || []) : [];
  }
  const covered = new Set();
  for (const c of (refDef && refDef.classes) || []) {
    for (const e of c.effects || []) covered.add(e);
  }
  const all = (tactic.means && tactic.means.length)
    ? tactic.means.map((m) => m.effect) : (tactic.meansEffects || []);
  return all.filter((e) => !covered.has(e));
}

// ブロック→断片の対応付け（対応付けできないブロックは -1）。
function demandAssignBlocks(blocks, parts, tactic, clsById) {
  const matches = blocks.map((b) => {
    const kws = [...new Set(demandBlockEffects(b, tactic, clsById).flatMap(demandEffectKeywords))];
    const hits = [];
    parts.forEach((p, i) => {
      if (kws.some((k) => k && p.includes(k))) hits.push(i);
    });
    return hits;
  });
  const assign = new Array(blocks.length).fill(-1);
  const order = blocks.map((_, i) => i)
    .sort((a, b) => matches[a].length - matches[b].length);
  for (const i of order) {
    if (matches[i].length === 1) assign[i] = matches[i][0];
  }
  for (const i of order) {
    if (assign[i] >= 0) continue;
    const taken = new Set(assign.filter((a) => a >= 0));
    const free = matches[i].filter((p) => !taken.has(p));
    if (free.length === 1) assign[i] = free[0];
  }
  const rest = blocks.map((_, i) => i).filter((i) => assign[i] < 0);
  const taken = new Set(assign.filter((a) => a >= 0));
  const freeParts = parts.map((_, i) => i).filter((i) => !taken.has(i));
  if (rest.length === 1 && freeParts.length === 1) assign[rest[0]] = freeParts[0];
  return assign;
}

// 全体の進め方の戦術1件についての需要の警告文（0件以上）。
// tactic は著述の戦術そのもの、blocks は authoredTacticBlocks が
// その戦術から作ったブロック（戦術単位で寄せたもの）。
// nameOf は候補ID→表示名。
export function authoredTacticDemandWarnings({ tactic, blocks, clsById, enemyName, nameOf }) {
  const usableIds = (b) => {
    const ids = new Set();
    for (const c of b.megido || []) if (candidateUsable(c)) ids.add(c.id);
    return ids;
  };
  const noteFor = (ids) => `対策候補は ${[...ids].map(nameOf).join('、')} だけです`;
  const label = tactic ? tactic.label
    : ((blocks[0] && blocks[0].tacticLabel) || '');
  const parts = label.split('／').map((s) => s.trim()).filter(Boolean);
  // 断片が1つだけの戦術と、ブロックが1つだけ（戦術全体を担う）
  // 場合は、従来どおりブロックごとに戦術全体への注記にする。
  if (!tactic || parts.length < 2 || blocks.length < 2) {
    const warnings = [];
    for (const b of blocks) {
      const ids = usableIds(b);
      if (ids.size > 0 && ids.size <= 2) {
        warnings.push(
          `後の階で出番がある可能性あり: ${label}（${enemyName}）の${noteFor(ids)}。`);
      }
    }
    return warnings;
  }
  const assign = demandAssignBlocks(blocks, parts, tactic, clsById);
  const partIds = parts.map(() => new Set());
  const loose = [];
  blocks.forEach((b, i) => {
    const ids = usableIds(b);
    if (assign[i] >= 0) {
      for (const id of ids) partIds[assign[i]].add(id);
    } else if (ids.size > 0) {
      loose.push({ block: b, ids });
    }
  });
  const scarce = (ids) => ids.size > 0 && ids.size <= 2;
  const scarceLoose = loose.filter((l) => scarce(l.ids));
  if (!partIds.some(scarce) && scarceLoose.length === 0) return [];
  const numbered = parts.map((p, i) => {
    const mark = DEMAND_PART_MARKS[i] || `(${i + 1})`;
    return `${mark}${p}${scarce(partIds[i]) ? `（${noteFor(partIds[i])}）` : ''}`;
  }).join(' ');
  let sentence = `後の階で出番がある可能性あり: ${numbered}（${enemyName}）`;
  for (const l of scarceLoose) {
    sentence += `。${l.block.label}の${noteFor(l.ids)}`;
  }
  sentence += '。';
  return [sentence];
}

// ---- 敵シート表示のための答えブロックの統合（2026-11-23） ----
// 脅威×答えの種類でブロックを作ると、同じ結論の汎用ブロックが
// 状態異常ごとに繰り返され、ポイントが読めない量になる（ユーザー
// 指摘: 死をあやす者で11項目、うち汎用3種が重複）。シート表示では
// 「同じ結論（答えの種類）のブロックは敵ごとに1つ」に統合する。
// これは表示層の成型だけであり、判定の材料は変えない: ピッカーの
// 印・需要・エディタの対策の行は threatAnswerBlocks /
// authoredOverallBlocks の脅威ごとのブロックを直接使う（この関数を
// 通さない）。
// 入力: 脅威ごとのブロック（threatAnswerBlocks の戻り値と
// authoredOverallBlocks の戻り値を、脅威の順に平らに並べたもの）。
// 各ブロックに threatLabel（その脅威の統合項目ラベル。全体の進め方
// 由来は null）と level（脅威レベル 'S'|'A'|'B'|null）を付け足して
// 渡す。呼び出し側の付帯フィールド（enemySpd 等）は最初の寄与者の
// ものが残る。
// 統合のキー（結論の同一性）:
// - 状態異常への耐性（クラス resist で、ラベルが「Xへの耐性・無効を
//   持つ」形）: 異常の種類を問わず1つに寄せる。対象の異常が2種以上
//   ならタイトルは「状態異常への耐性・無効を持つ」にし、1種だけ
//   なら「Xへの耐性・無効を持つ」のままにする。フォトン破壊への
//   耐性（文面も効果も別）はこの形に当たらないため寄せない。
// - 付与を止める（クラス stop で、ラベルが「（フォトン干渉）」で
//   終わる）: 1つに寄せる。
// - 直す（クラス cure で、ラベルに「直す」を含む）: 1つに寄せる。
// - 速攻（クラス rush）: 1つに寄せる。
// - それ以外はクラスID＋ラベルの組が同じものだけを寄せる（例:
//   endure は「蘇生で立て直す」と「回復で相殺する」が同じクラス
//   でも別の結論なので、ラベルが違えば寄せない）。
// 候補（メギド・オーブ）は和集合にし、脅威ラベルと戦術ラベルも
// 和集合にする。並びは、脅威レベルの高い順を主とし、同段階では
// 「その段階の脅威への答えが最初に現れる位置」で決める（統合前の
// 平らな並びに対する安定ソートと一致する）。
const SHEET_LEVEL_RANK = (l) => (l === 'S' ? 0 : l === 'A' ? 1 : l === 'B' ? 2 : 3);
export function mergeSheetAnswerBlocks(entries) {
  const groups = new Map();
  const order = [];
  const keyOf = (b) => {
    if (b.classId === 'resist' && /^.+への耐性・無効を持つ$/.test(b.label || '')) return 'family:resist';
    if (b.classId === 'stop' && /（フォトン干渉）$/.test(b.label || '')) return 'family:stop';
    if (b.classId === 'cure' && /直す/.test(b.label || '')) return 'family:cure';
    if (b.classId === 'rush') return 'family:rush';
    if (b.classId) return `class:${b.classId}|${b.label}`;
    return `tactic:${b.label}`;
  };
  entries.forEach((entry, idx) => {
    const key = keyOf(entry);
    let g = groups.get(key);
    if (!g) {
      g = {
        base: entry, contributors: 0, threatLabels: [], tacticLabels: [],
        megido: [], orbs: [], level: null, rank: 3, bestPos: idx, firstPos: idx,
        ailmentNames: [], authoredOr: false,
      };
      groups.set(key, g);
      order.push(g);
    }
    g.contributors += 1;
    g.authoredOr = g.authoredOr || Boolean(entry.authored);
    if (entry.threatLabel && !g.threatLabels.includes(entry.threatLabel)) {
      g.threatLabels.push(entry.threatLabel);
    }
    for (const l of entry.tacticLabels || (entry.tacticLabel ? [entry.tacticLabel] : [])) {
      if (!g.tacticLabels.includes(l)) g.tacticLabels.push(l);
    }
    const seenM = new Set(g.megido.map((c) => c.id || c.name));
    for (const c of entry.megido || []) if (!seenM.has(c.id || c.name)) g.megido.push(c);
    const seenO = new Set(g.orbs.map((c) => c.orbId || c.name));
    for (const c of entry.orbs || []) if (!seenO.has(c.orbId || c.name)) g.orbs.push(c);
    const r = SHEET_LEVEL_RANK(entry.level);
    if (r < g.rank) { g.rank = r; g.level = entry.level; g.bestPos = idx; }
    if (key === 'family:resist') {
      const m = /^(.+)への耐性・無効を持つ$/.exec(entry.label || '');
      if (m && !g.ailmentNames.includes(m[1])) g.ailmentNames.push(m[1]);
    }
  });
  const merged = order.map((g) => {
    const out = {
      ...g.base,
      megido: g.megido, orbs: g.orbs,
      tacticLabels: g.tacticLabels,
      threatLabels: g.threatLabels,
      level: g.level,
      // 著述由来が1つでも混ざれば authored として扱う
      // （threatAnswerBlocks 内の寄せ方と同じ）。
      authored: g.authoredOr,
    };
    delete out.threatLabel;
    if (g.contributors > 1) {
      if (g.ailmentNames.length >= 2) out.label = '状態異常への耐性・無効を持つ';
      else if (g.ailmentNames.length === 1) out.label = `${g.ailmentNames[0]}への耐性・無効を持つ`;
      else if (out.classId === 'stop') out.label = '付与される前に止める（フォトン干渉）';
      else if (out.classId === 'cure') out.label = '付与されたら直す';
    }
    out._rank = g.rank;
    out._bestPos = g.bestPos;
    out._firstPos = g.firstPos;
    return out;
  });
  merged.sort((a, b) => (a._rank - b._rank) || (a._bestPos - b._bestPos) || (a._firstPos - b._firstPos));
  for (const m of merged) { delete m._rank; delete m._bestPos; delete m._firstPos; }
  return merged;
}

// ---- 攻略のポイントの3役再構成（2026-11-26） ----
// マスターの言語化（2026-11-25）: 編成はコンボ型でない限り3役で組む
// （①ディーラー=倒す ②サポート=ディーラーが機能するように助ける
// ③ジャマー=敵の行動を邪魔する）。敵も同じ3役で読み、ポイントは
// 役ごとに寄せて既定3件に収める。ゴールは「倒せる」ことなので、
// 種族特効・倒し切る・取り巻きの処理・かばうの迂回と、脅威に
// 紐づかない全体の進め方は「倒す」側の1件に寄せる（発想2=各役が
// 機能する前に倒す、で答えになる役には専用ポイントを立てない）。
// 役の度合いは生成データ enemy-roles.v1.json（生成器
// pipeline/generate-enemy-roles.mjs が正本 corpus-enemies/ から
// 付けたもの）を読むだけ。ここでは分類しない。
// 候補・手段の集合と判定（ピッカーの印・需要・カバー）は一切
// 変えない。変えるのはシート表示の寄せ方だけ。例外は特性かばうの
// 「かばう役を行動不能にする」で、マスター確定（2026-11-25:
// 特性かばうは付与ではなく常時。敵には行動不能の手は基本的に
// 通らないため標準の手として提示しない）により提示から外す。
const SHEET_KILL_CLASS_IDS = new Set(['bonus', 'state-bonus', 'rush', 'order', 'ignore', 'area']);

function sheetRolePrimary(deg, threatId) {
  if (!deg) return null;
  if (threatId === 'ailment:即死') return 'dealer';
  if (threatId === 'tactic:kabau') return 'jammer';
  if (threatId === 'ailment:毒' && (deg.j || 0) > 0) return 'jammer';
  const order = [['jammer', deg.j || 0], ['dealer', deg.d || 0], ['support', deg.s || 0]];
  let best = null;
  let bestVal = 0;
  for (const [role, v] of order) if (v > bestVal) { best = role; bestVal = v; }
  return best;
}

function sheetRoleFallback(threatId) {
  if (threatId === 'ailment:即死') return { degrees: { d: 5, s: 0, j: 0 }, primary: 'dealer' };
  if (threatId.startsWith('combo:')) return { degrees: { d: 3, s: 0, j: 0 }, primary: 'dealer' };
  if (threatId.startsWith('ailment:') || threatId.startsWith('tactic:')) {
    return { degrees: { d: 0, s: 0, j: 3 }, primary: 'jammer' };
  }
  return null;
}

// 敵シートの脅威1件の3役。生成データの脅威表 → 生む行動の印 →
// 系統の既定、の順に引く。種族特効（race:）は敵の役ではないため null。
export function sheetThreatRole({ threat, fact, roles } = {}) {
  if (!threat || !threat.threatId) return null;
  const tid = threat.threatId;
  if (tid.startsWith('race:')) return null;
  if (!roles || !roles.species) return sheetRoleFallback(tid);
  const memberNames = [];
  for (const s of threat.sources || []) {
    if (s.member && !memberNames.includes(s.member)) memberNames.push(s.member);
  }
  for (const m of (fact && fact.party) || []) {
    if (m && m.name && !memberNames.includes(m.name)) memberNames.push(m.name);
  }
  const tableEntries = [];
  for (const name of memberNames) {
    const sp = roles.species[name];
    if (sp && sp.threats && sp.threats[tid]) tableEntries.push(sp.threats[tid]);
  }
  if (tableEntries.length > 0) {
    const deg = { d: 0, s: 0, j: 0 };
    let primary = null;
    let bestVal = -1;
    for (const e of tableEntries) {
      deg.d = Math.max(deg.d, e.degrees.d || 0);
      deg.s = Math.max(deg.s, e.degrees.s || 0);
      deg.j = Math.max(deg.j, e.degrees.j || 0);
      const mx = Math.max(e.degrees.d || 0, e.degrees.s || 0, e.degrees.j || 0);
      if (mx > bestVal) { bestVal = mx; primary = e.primary; }
    }
    return { degrees: deg, primary, threatId: tid };
  }
  const producers = [];
  for (const name of memberNames) {
    const sp = roles.species[name];
    if (!sp) continue;
    for (const a of sp.actions || []) {
      const flags = a.flags || [];
      let hit = false;
      if (tid.startsWith('ailment:')) hit = (a.ailments || []).includes(tid.slice('ailment:'.length));
      else if (tid === 'tactic:kabau') hit = flags.includes('kabau');
      else if (tid === 'combo:curse-amplify') hit = flags.includes('cursePayoff');
      else if (tid === 'tactic:death-buff') hit = flags.includes('deathBuff');
      else if (tid === 'tactic:photon-destroy') hit = flags.includes('photonDestroy') || flags.includes('photonSteal');
      else if (tid === 'tactic:barrier') hit = flags.includes('barrier');
      else if (tid === 'tactic:charge-interference') hit = flags.includes('charge');
      if (hit) producers.push(a);
    }
  }
  if (producers.length > 0) {
    const deg = { d: 0, s: 0, j: 0 };
    for (const a of producers) {
      deg.d = Math.max(deg.d, a.degrees.d || 0);
      deg.s = Math.max(deg.s, a.degrees.s || 0);
      deg.j = Math.max(deg.j, a.degrees.j || 0);
    }
    const preNoDmg = producers.some((a) => (a.flags || []).includes('prerequisite'))
      && producers.every((a) => !(a.flags || []).includes('prerequisite') || (a.degrees.d || 0) === 0);
    const primary = preNoDmg && deg.s >= deg.j && deg.s > 0
      ? 'support' : sheetRolePrimary(deg, tid);
    return { degrees: deg, primary, threatId: tid };
  }
  const fb = sheetRoleFallback(tid);
  return fb ? { ...fb, threatId: tid } : null;
}

// 脅威のかばうが、発生源の全員について「特性かばう」かどうか。
function sheetKabauIsTrait(threat, fact, roles) {
  if (!roles || !roles.species) return false;
  const names = [];
  for (const s of threat.sources || []) {
    if (s.member && !names.includes(s.member)) names.push(s.member);
  }
  if (names.length === 0) {
    for (const m of (fact && fact.party) || []) if (m && m.name) names.push(m.name);
  }
  let found = false;
  for (const n of names) {
    const sp = roles.species[n];
    if (sp && sp.kabauKind) {
      found = true;
      if (sp.kabauKind !== 'trait') return false;
    }
  }
  return found;
}

// シート表示用に、答えブロックの材料へ寄せ先（groupKey）と
// 提示除外（suppress）を付ける。判定には使わない表示専用の加工。
// 戻り値の threatRoles は脅威ラベル → 役で、著述の文章ポイントの
// 寄せ先を決める材料にする。
export function prepareSheetEntries(entries, { fact, roles, clsById } = {}) {
  const threatRoles = new Map();
  const ailmentNames = clsById
    ? [...clsById.values()].filter((t) => t.kind === 'ailment').map((t) => t.name)
    : [];
  // 同じ戦術が対の応答と全体の進め方の両方に載る場合は、脅威に
  // 紐づく側を残す（材料は同一で、旧統合でも1ブロックに寄って
  // いた。例: ベインチェイサーの「覚醒ゲージを下げて…」）。
  const attachedKeys = new Set();
  for (const e of entries || []) {
    if (e.threat && e.tacticLabel) {
      attachedKeys.add(`${e.tacticLabel}|${e.classId || ''}|${e.label || ''}`);
    }
  }
  const out = [];
  for (const e of entries || []) {
    const entry = { ...e };
    if (!e.threat) {
      if (e.tacticLabel
        && attachedKeys.has(`${e.tacticLabel}|${e.classId || ''}|${e.label || ''}`)) {
        continue;
      }
      entry.groupKey = 'kill';
      out.push(entry);
      continue;
    }
    // 著述だけの脅威は、著述の counterThreatId が役解決の鍵になる
    // （統合項目の threatId は導出と一致した場合だけ付く）。
    let threat = e.threat;
    if (!threat.threatId) {
      const ct = e.threat.authoredThreat ? e.threat.authoredThreat.counterThreatId : null;
      let pseudo = ct || null;
      if (!pseudo && ailmentNames.length > 0) {
        const label = e.threat.label || '';
        const special = /(.+?)状態への特効/.exec(label);
        if (special && ailmentNames.includes(special[1])) {
          pseudo = special[1] === '呪い' ? 'combo:curse-amplify' : `ailment:${special[1]}`;
        } else {
          const hit = ailmentNames.find((a) => label.includes(a));
          if (hit) pseudo = `ailment:${hit}`;
        }
      }
      if (pseudo) threat = { ...threat, threatId: pseudo };
    }
    const role0 = sheetThreatRole({ threat, fact, roles });
    // 役が引けない著述の脅威は、脅威名の語から寄せ先を推定する
    // （例: 「全体の弱体（攻防低下）」は弱体=ジャマー）。
    let role = role0;
    if (!role && e.threat.label) {
      const g = sheetPairGroupKey({ label: e.threat.label, threatRoles: null });
      if (g.startsWith('role:')) {
        role = { primary: g.slice('role:'.length), degrees: null, threatId: null };
      }
    }
    if (role && e.threat.label && !threatRoles.has(e.threat.label)) {
      threatRoles.set(e.threat.label, role);
    }
    if (threat.threatId === 'tactic:kabau' && e.classId === 'stop-holder'
      && sheetKabauIsTrait(threat, fact, roles)) {
      entry.suppress = true;
    }
    // 集約して受ける（funnel）は、倒す計画側の受けとして「倒す」へ
    // 寄せる（同じ脅威の order と同じ計画の両輪のため）。
    // クラスに収まらない著述戦術（classId なし）は、脅威の役が
    // 引ける場合はその役へ、引けない場合は「倒す」へ寄せる
    // （完殺・執心・束縛・弱体の型は倒す側の手）。
    if (e.classId === 'funnel' || SHEET_KILL_CLASS_IDS.has(e.classId)) {
      entry.groupKey = 'kill';
    } else if (e.classId == null && !role) {
      entry.groupKey = 'kill';
    } else if (role) {
      entry.groupKey = `role:${role.primary}`;
    } else {
      entry.groupKey = `other:${e.threatLabel || e.threat.label || ''}`;
    }
    out.push(entry);
  }
  return { entries: out, threatRoles };
}

const SHEET_FAMILY_TESTS = [
  ['resist', (b) => b.classId === 'resist'],
  ['stop', (b) => b.classId === 'stop'],
  ['gauge-stop', (b) => b.classId === 'gauge-stop'],
  ['cure', (b) => b.classId === 'cure'],
  ['endure', (b) => b.classId === 'endure'],
];
const SHEET_RECEIVE_FAMILIES = new Set(['resist', 'cure', 'endure', 'funnel']);
const SHEET_STOP_FAMILIES = new Set(['stop', 'gauge-stop', 'dispel', 'multi-hit', 'preempt', 'spread', 'independence', 'stop-holder', 'use-funnel']);
const SHEET_KILL_LEAD_ORDER = ['order', 'fixed-damage', 'bonus', 'ignore', 'area', 'state-bonus', 'rush'];

// 答えブロックを役の寄せ先ごとに再構成する（表示専用）。
// 寄せ先の中では従来どおり家族（耐性・止める等）で寄せ、最後に
// 寄せ先ごとに1ブロックへ畳む。'shape'（配置・トランス）は軸が
// 違うため素通しする。suppress の材料は落とす。
export function recomposeSheetAnswerBlocks(entries) {
  const live = (entries || []).filter((e) => !e.suppress);
  const shapeBlocks = [];
  const groups = new Map();
  const groupOf = (key) => {
    if (!groups.has(key)) groups.set(key, { key, accs: [], firstPos: Infinity });
    return groups.get(key);
  };
  live.forEach((e, idx) => {
    if (e.groupKey === 'shape') {
      shapeBlocks.push({ ...e, _rank: SHEET_LEVEL_RANK(e.level), _firstPos: idx });
      return;
    }
    const key = e.groupKey || `other:${e.threatLabel || ''}`;
    const g = groupOf(key);
    g.firstPos = Math.min(g.firstPos, idx);
    const famTest = SHEET_FAMILY_TESTS.find(([, t]) => t(e));
    const famKey = famTest ? `family:${famTest[0]}` : `id:${e.classId || ''}|${e.label || ''}`;
    let acc = g.accs.find((a) => a.famKey === famKey);
    if (!acc) {
      acc = {
        famKey, family: famTest ? famTest[0] : null, base: e,
        megido: [], orbs: [], tacticLabels: [], threatLabels: [],
        hows: [], details: [], rank: 99, level: null, firstPos: idx,
        contributors: 0, authoredOr: false, classIds: [], ailmentNames: [],
      };
      g.accs.push(acc);
    }
    acc.contributors += 1;
    if (e.authored) acc.authoredOr = true;
    if (e.classId && !acc.classIds.includes(e.classId)) acc.classIds.push(e.classId);
    for (const l of e.threatLabels || (e.threatLabel ? [e.threatLabel] : [])) {
      if (!acc.threatLabels.includes(l)) acc.threatLabels.push(l);
    }
    for (const l of e.tacticLabels || (e.tacticLabel ? [e.tacticLabel] : [])) {
      if (!acc.tacticLabels.includes(l)) acc.tacticLabels.push(l);
    }
    const seenM = new Set(acc.megido.map((c) => c.id || c.name));
    for (const c of e.megido || []) if (!seenM.has(c.id || c.name)) acc.megido.push(c);
    const seenO = new Set(acc.orbs.map((c) => c.orbId || c.name));
    for (const c of e.orbs || []) if (!seenO.has(c.orbId || c.name)) acc.orbs.push(c);
    if (e.how && !acc.hows.includes(e.how)) acc.hows.push(e.how);
    if (e.detail && !acc.details.includes(e.detail)) acc.details.push(e.detail);
    const r = SHEET_KILL_CLASS_IDS.has(e.classId) && e.classId !== 'order'
      ? Math.max(SHEET_LEVEL_RANK(e.level), 2) : SHEET_LEVEL_RANK(e.level);
    if (r < acc.rank) { acc.rank = r; acc.level = e.level; }
    if (famTest && famTest[0] === 'resist') {
      const m = /^(.+)への耐性・無効を持つ$/.exec(e.label || '');
      if (m && !acc.ailmentNames.includes(m[1])) acc.ailmentNames.push(m[1]);
    }
  });
  const materialize = (acc) => {
    const out = {
      ...acc.base,
      megido: acc.megido, orbs: acc.orbs,
      tacticLabels: acc.tacticLabels, threatLabels: acc.threatLabels,
      level: acc.level, authored: acc.authoredOr,
      how: acc.hows.join('\n'),
      detail: acc.details.join('\n'),
      _family: acc.family, _rank: acc.rank, _firstPos: acc.firstPos,
      _classIds: acc.classIds,
    };
    if (acc.contributors > 1) {
      if (acc.family === 'resist') {
        if (acc.ailmentNames.length >= 2) out.label = '状態異常への耐性・無効を持つ';
        else if (acc.ailmentNames.length === 1) out.label = `${acc.ailmentNames[0]}への耐性・無効を持つ`;
      } else if (acc.family === 'stop') out.label = '付与される前に止める（フォトン干渉）';
      else if (acc.family === 'gauge-stop') out.label = '覚醒ゲージを下げて遅らせる';
      else if (acc.family === 'cure') out.label = '付与されたら直す';
    }
    return out;
  };
  const out = [];
  for (const g of groups.values()) {
    const blocks = g.accs.map(materialize);
    if (blocks.length === 1) {
      out.push({ ...blocks[0], groupKey: g.key });
      continue;
    }
    const megido = [];
    const orbs = [];
    const tacticLabels = [];
    const threatLabels = [];
    const hows = [];
    const details = [];
    let methodNote = '';
    let rank = 99;
    let level = null;
    for (const b of blocks) {
      const seenM = new Set(megido.map((c) => c.id || c.name));
      for (const c of b.megido || []) if (!seenM.has(c.id || c.name)) megido.push(c);
      const seenO = new Set(orbs.map((c) => c.orbId || c.name));
      for (const c of b.orbs || []) if (!seenO.has(c.orbId || c.name)) orbs.push(c);
      for (const l of b.tacticLabels || []) if (!tacticLabels.includes(l)) tacticLabels.push(l);
      for (const l of b.threatLabels || []) if (!threatLabels.includes(l)) threatLabels.push(l);
      if (b.how && !hows.includes(b.how)) hows.push(b.how);
      if (b.detail) for (const d of b.detail.split('\n')) if (!details.includes(d)) details.push(d);
      if (!methodNote && b.methodNote) methodNote = b.methodNote;
      if (b._rank < rank) { rank = b._rank; level = b.level; }
    }
    let label;
    let subLabels = [];
    if (g.key === 'kill') {
      let lead = null;
      for (const cid of SHEET_KILL_LEAD_ORDER) {
        lead = blocks.find((b) => (b._classIds || []).includes(cid));
        if (lead) break;
      }
      if (!lead) lead = blocks.find((b) => (b.tacticLabels || []).length > 0) || blocks[0];
      label = lead.label;
      subLabels = blocks.filter((b) => b !== lead).map((b) => b.label);
    } else {
      // タイトルは「脅威ラベル（群）＋結論の動詞」だけにする（2026-11-26
      // マスター許可）。対策クラスの列挙はタイトルに載せない: クラス
      // ごとの効き方は本文（how）に全部出ており、列挙するとタイトルが
      // 機械的な連結になって結論として読めなくなる（検品:
      // hidden_files/points-title-audit/。全ポイントの26.4%が該当）。
      const names = threatLabels.slice(0, 3);
      const nameText = names.join('・') + (threatLabels.length > 3 ? 'ほか' : '');
      const fams = blocks.map((b) => b._family || b.classId);
      const verb = fams.every((f) => SHEET_RECEIVE_FAMILIES.has(f)) ? '受ける'
        : fams.every((f) => SHEET_STOP_FAMILIES.has(f)) ? '止める' : '受ける・止める';
      label = nameText ? `${nameText}を${verb}` : blocks[0].label;
    }
    out.push({
      ...blocks[0],
      label,
      megido, orbs, tacticLabels, threatLabels,
      // 本文の効き方はクラスごとに1行に分ける（2026-11-26 マスター
      // 許可）。空白で連結すると別クラスの説明文同士が地続きになって
      // 文として読めない。表示側（sheet.js）は行ごとに段落を分ける。
      how: hows.join('\n'),
      methodNote,
      detail: [...subLabels, ...details].join(' '),
      level, authored: blocks.some((b) => b.authored),
      classId: blocks[0].classId,
      groupKey: g.key,
      _rank: rank, _firstPos: g.firstPos,
    });
  }
  const all = [...out, ...shapeBlocks];
  all.sort((a, b) => (a._rank - b._rank) || (a._firstPos - b._firstPos));
  for (const m of all) { delete m._rank; delete m._firstPos; delete m._family; delete m._classIds; }
  return all;
}

// 著述の対（脅威 → 応答）の寄せ先。脅威の役が引ける場合はその役、
// 引けない場合は脅威名の語から決める（表示の寄せ先だけの話で、
// 判定には使わない）。
export function sheetPairGroupKey({ label, threatRoles } = {}) {
  if (!label) return 'kill';
  if (threatRoles && threatRoles.has(label)) {
    return `role:${threatRoles.get(label).primary}`;
  }
  if (/即死/.test(label)) return 'role:dealer';
  if (/かばう/.test(label)) return 'role:jammer';
  if (threatRoles) {
    for (const [tid, role] of sheetThreatRoleEntries(threatRoles)) {
      if (tid && tid.startsWith('ailment:') && label.includes(tid.slice('ailment:'.length))) {
        return `role:${role.primary}`;
      }
    }
  }
  if (/弱体|フォトン|ゲージ|チャージ|眠|毒|呪い|異常|強化解除/.test(label)) return 'role:jammer';
  if (/上昇|回復|蘇生|バリアを|無敵/.test(label)) return 'role:support';
  return `other:${label}`;
}

function sheetThreatRoleEntries(threatRoles) {
  const out = [];
  for (const role of threatRoles.values()) {
    if (role && role.threatId) out.push([role.threatId, role]);
  }
  return out;
}

// 著述の全体の進め方（文章ポイント）の寄せ先。
export function sheetOverallGroupKey({ label } = {}) {
  if (!label) return 'kill';
  if (/配置|ワントップ|ワンボトム|トランス/.test(label)) return 'shape';
  return 'kill';
}

function foldSheetPointInto(target, src) {
  const lines = [];
  if (src.title && src.title !== target.title) lines.push(src.title);
  if (src.how) lines.push(src.how);
  if (src.detail) lines.push(src.detail);
  if (src.detailText) lines.push(src.detailText);
  target.detailText = [target.detailText, ...lines].filter(Boolean).join('\n');
  const tt = new Set((target.threatText || '').split('、').filter(Boolean));
  for (const t of (src.threatText || '').split('、').filter(Boolean)) tt.add(t);
  target.threatText = [...tt].join('、');
  for (const f of ['candidatesText', 'orbsText', 'startersText']) {
    if (!src[f]) continue;
    if (!target[f]) { target[f] = src[f]; continue; }
    const seen = new Set(target[f].split('、'));
    target[f] = [...seen, ...src[f].split('、').filter((s) => !seen.has(s))].join('、');
  }
  if (!target.methodNote && src.methodNote) target.methodNote = src.methodNote;
  target.noteOnly = Boolean(target.noteOnly && src.noteOnly);
}

// ポイント列の仕上げ: 文章ポイントを同じ寄せ先のブロックポイントへ
// 畳み、寄せ先ごとに寄せ、最後に「倒す」を除く優先度の低い側から
// 畳んで既定3件に収める（shape は軸が違うため数えない）。
export function mergeSheetPoints(points) {
  const out = [];
  const prose = [];
  for (const p of points || []) (p.prose ? prose : out).push(p);
  for (const p of prose) {
    let target = null;
    if (p.groupKey && p.groupKey !== 'shape') {
      // 脅威を共有するブロックポイントを、寄せ先（役）より優先して
      // 畳む（2026-11-26 ペルソナ検品）: 寄せ先だけで畳むと、対の
      // 応答の結論が別の脅威のポイントの本文へ紛れる（例: スカル
      // ワイバーンの「本体から先に倒す（取り巻きを残す）」が、同じ
      // ジャマー/ディーラー寄せ先の呪い特効のポイントに入った）。
      // 脅威の一致は寄せ先より材料に近い。
      const pThreats = (p.threatText || '').split('、').filter(Boolean);
      if (pThreats.length > 0) {
        target = out.find((q) => !q.prose
          && pThreats.some((t) => (q.threatText || '').split('、').includes(t))) || null;
      }
      if (!target) target = out.find((q) => !q.prose && q.groupKey === p.groupKey) || null;
    }
    if (target) { foldSheetPointInto(target, p); continue; }
    const sib = out.find((q) => q.prose && q.groupKey === p.groupKey);
    if (sib) { foldSheetPointInto(sib, p); continue; }
    out.push(p);
  }
  const prio = (p) => (p.groupKey === 'kill' ? 3
    : (p.groupKey || '').startsWith('role:') ? 2 : 1);
  for (;;) {
    const countable = out.filter((p) => p.groupKey !== 'shape');
    if (countable.length <= 3) break;
    const sorted = countable
      .map((p) => ({ p, i: out.indexOf(p) }))
      .sort((a, b) => (prio(a.p) - prio(b.p)) || (b.i - a.i));
    const loser = sorted[0].p;
    const winner = sorted[1].p;
    foldSheetPointInto(winner, loser);
    out.splice(out.indexOf(loser), 1);
  }
  return out;
}

// ---- 高防御の敵への固定ダメージの別解（2026-11-26 追加指示） ----
// 点穴: ダメージ = 点穴² × Lv ÷ 35（固定、上限100点）。
//   Lv70・100点で 1発 20,000 点。
// エレキ: 放出ダメージ = 最初の付与者の Lv × 20 × レベル
//   （上限レベル50）。Lv70・レベル50で 1回 70,000 点。
// どちらも防御を引かない固定ダメージのため、防御の高い敵では
// 通常攻撃（攻撃力×倍率 − 防御）より通る。物差しは防御 2,000 以上
// （攻撃力 2,000 級の攻撃がほぼ通らなくなる帯）。
// 候補は手段索引に持ち主がいる分だけ、敵の耐性で付与が無効な分は
// 数えない（candidatesForClass に敵の事実を渡す）。数値は Lv70・
// 上限まで積んだ場合の目安として、敵HPと引き合わせて出す。
// シート表示専用の材料で、ピッカーの印・需要・カバー判定には
// 一切届かない。
export const FIXED_DAMAGE_DEF_LINE = 2000;
export function fixedDamageBlocks({ fact, index, owned = null, levelOf = null } = {}) {
  const stats = (fact && fact.stats) || {};
  const def = typeof stats.def === 'number' ? stats.def : null;
  const hp = typeof stats.hp === 'number' ? stats.hp : null;
  if (def === null || hp === null || def < FIXED_DAMAGE_DEF_LINE || !index) return [];
  const plans = [
    { effect: 'inflict:点穴', name: '点穴', per: 20000, unit: '発', note: 'Lv70・点穴100点（上限）で1発20,000点' },
    { effect: 'inflict:エレキ', name: 'エレキ', per: 70000, unit: '回', note: 'Lv70・エレキレベル50（上限）の放出で1回70,000点' },
  ];
  const blocks = [];
  for (const p of plans) {
    const cands = candidatesForClass(
      { id: `fixed:${p.effect}`, effects: [p.effect] }, index, owned, levelOf, { enemyFact: fact },
    );
    if ((cands.megido || []).length === 0 && (cands.orbs || []).length === 0) continue;
    const count = Math.ceil(hp / p.per);
    blocks.push({
      classId: 'fixed-damage',
      label: `${p.name}の固定ダメージで削る`,
      how: `${p.note}。固定ダメージは防御を引かないため、防御${def}のこの敵にもそのまま通る。HP${hp}なら${count}${p.unit}で倒せる計算`,
      methodNote: '', noteOnly: false, authored: false, tacticLabel: null,
      megido: cands.megido, orbs: cands.orbs,
    });
  }
  return blocks;
}

// 著述の脅威から組み立てる簡単な説明（SW95 便2）。導出の脅威が
// 種族しか拾えない種（能力がダメージ・強化中心で、状態異常・
// 戦術・コンボの型に当たらない）では、導出だけでは説明が作れ
// なかった（SW91 で 55 種）。統合後の材料である著述の脅威は、
// その種について収集済みの事実（脅威名と発動方法）なので、
// 導出と同じ形（方法ごとに脅威名をまとめた1〜2行）に組む。
// 材料が無い種には作らない（発明しない）。
// - 通常敵の著述: 脅威は name と method を持つため、方法ごとに
//   まとめる（導出の組み立てと同形）。
// - ボス著述: 脅威は label（短い見出し）だけを持つため、先頭の
//   3件をそのまま並べる。
export function authoredSummaryText(authored) {
  if (!authored || !authored.entry) return '';
  if (authored.kind === 'enemy') {
    const byMethod = new Map();
    for (const t of authored.entry.threats || []) {
      if (!t.name || !t.method || !METHOD_LABEL[t.method]) continue;
      if (!byMethod.has(t.method)) byMethod.set(t.method, []);
      const list = byMethod.get(t.method);
      if (!list.includes(t.name)) list.push(t.name);
    }
    const parts = [];
    for (const m of ['trait', 'skill', 'awakened', 'ougi']) {
      const list = byMethod.get(m);
      if (list && list.length) parts.push(`${METHOD_LABEL[m]}で${list.join('・')}`);
    }
    return parts.length ? `${parts.join('、')}。` : '';
  }
  if (authored.kind === 'boss') {
    const labels = (authored.entry.threats || [])
      .map((t) => t.label || '').filter(Boolean).slice(0, 3);
    return labels.length ? `${labels.join('、')}。` : '';
  }
  return '';
}

// 導出の脅威だけを、統合リストと同じ項目の形にして返す。ボス
// 著述のある敵の「答え」側の演算（ピッカーの印・需要）に使う
// （SW95 便2）。ボスのシートの脅威リストは著述の文章が正で、
// 導出は足さない（enemyThreatsUnified の確定規則は変えない）。
// ただし印と需要までゼロになるのは導出の穴であり、仕様では
// ない（2026-11-21 定義の層の姿勢修正: 導出の穴は埋める対象）。
// そのため答えの計算だけは、塔の事実データからの導出で埋める。
export function derivedThreatsAsItems(fact, clsById) {
  if (!fact) return [];
  const info = threatsForEnemy(fact, clsById);
  return info.threats
    .filter((t) => !t.threatId.startsWith('race:'))
    .map((t) => ({
      key: `derived:${t.threatId}`, source: 'derived', label: t.name,
      detail: t.evidence || '', threatId: t.threatId, derived: t,
      derivedAlso: [], authoredThreat: null, pair: null, level: null,
    }));
}

// 敵1種について、ピッカーの有効印の材料を1つの演算で返す（型8）。
// 統合脅威リストの答え候補（導出クラス＋著述戦術＋全体の進め方の
// 戦術）＋種族特効＋状態特効。凸が足りない候補は落とす（型7）。
// ボス著述のある敵は、シートの脅威リストこそ文章が正だが、印まで
// ゼロになるのは導出の穴として埋める（SW95 便2）: 導出の脅威への
// 答えだけを機械候補にする（種族特効はボスは対象外のまま。状態
// 特効は従来どおり対象に含める）。
// stateCtx: stateBonusAnswers の編成材料（{ memberIds, orbIds,
// leaderId, levelOf, hasSpecial }）。編成の文脈が無い入口（マスの
// 編成ピッカー）では渡さず、状態特効は付けない（手段の有無が
// 判定できないため。従来のマス側の扱いと同じ）。
// 戻り値: { megido: Map<id, ラベル[]>, orbs: Map<orbId, ラベル[]>,
//           reasons: { megido: Map<id, 理由[]>, orbs: Map<orbId, 理由[]> } }
// reasons は印の理由表示用に、ラベルを付けた同じ場所で根拠（敵・
// 脅威・候補の手段）を記録したもの。判定（ラベルの付き方）は
// 従来どおりで、理由は表示だけに使う。
export function pickerAnswersForEnemy({ fact, authored, clsById, index, owned = null, levelOf = null, threatLevels = null, stateCtx = null, restricted = false }) {
  const prof = normalizeRestriction(restricted);
  const megido = new Map();
  const orbs = new Map();
  const reasons = { megido: new Map(), orbs: new Map() };
  const push = (map, key, label) => {
    if (!key || !label) return;
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.includes(label)) list.push(label);
  };
  const pushReason = (map, key, reason) => {
    if (!key || !reason) return;
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    const sig = reasonSignature(reason);
    if (!list.some((r) => reasonSignature(r) === sig)) list.push(reason);
  };
  const mergeReasons = (src) => {
    if (!src) return;
    for (const [id, list] of src.megido || []) {
      for (const r of list) pushReason(reasons.megido, id, r);
    }
    for (const [id, list] of src.orbs || []) {
      for (const r of list) pushReason(reasons.orbs, id, r);
    }
  };
  const isBoss = Boolean(authored && authored.kind === 'boss');
  if (fact) {
    // ボス著述の敵は導出の脅威だけから答えを引く（シートの脅威
    // リストには導出を足さない。derivedThreatsAsItems の注記参照）。
    const threats = isBoss
      ? derivedThreatsAsItems(fact, clsById)
      : enemyThreatsUnified({ fact, authored, clsById, threatLevels });
    for (const t of threats) {
      const blocks = threatAnswerBlocks({ threat: t, fact, authored, clsById, index, owned, levelOf, restricted: prof });
      for (const b of blocks) {
        for (const c of b.megido) {
          if (!candidateUsable(c)) continue;
          push(megido, c.id, b.tacticLabel || t.label);
          pushReason(reasons.megido, c.id, {
            kind: 'threat', enemyName: fact.name, threatLabel: t.label,
            means: c.means || [],
          });
        }
        for (const c of b.orbs) {
          push(orbs, c.orbId, b.tacticLabel || t.label);
          pushReason(reasons.orbs, c.orbId, {
            kind: 'threat', enemyName: fact.name, threatLabel: t.label,
            means: c.means || [],
          });
        }
      }
    }
    // 全体の進め方の戦術（手段を持つもの）の保持者にも印を付ける
    // （SW95 便2、監査C）。ラベルは戦術名そのもの。
    for (const b of authoredOverallBlocks({ authored, clsById, index, owned, levelOf, restricted: prof })) {
      for (const c of b.megido) {
        if (!candidateUsable(c)) continue;
        push(megido, c.id, b.tacticLabel);
        pushReason(reasons.megido, c.id, {
          kind: 'overall', enemyName: fact.name,
          answerLabel: b.label || b.tacticLabel, means: c.means || [],
        });
      }
      for (const c of b.orbs) {
        push(orbs, c.orbId, b.tacticLabel);
        pushReason(reasons.orbs, c.orbId, {
          kind: 'overall', enemyName: fact.name,
          answerLabel: b.label || b.tacticLabel, means: c.means || [],
        });
      }
    }
    // 種族特効はボス対象外。制限下では、種族特効・状態特効
    // （攻撃力に掛かる倍率＝効く手）の印は付けない
    // （ホワイトリストは機構だけ）。
    if (!isBoss && !prof) {
      const race = raceBonusAnswers({ fact, index, owned });
      for (const [id, labels] of race.megido) for (const l of labels) push(megido, id, l);
      for (const [id, labels] of race.orbs) for (const l of labels) push(orbs, id, l);
      mergeReasons(race.reasons);
    }
  }
  if (stateCtx && fact && !prof) {
    const state = stateBonusAnswers({ fact, index, owned, ...stateCtx });
    for (const [id, labels] of state.megido) for (const l of labels) push(megido, id, l);
    for (const [id, labels] of state.orbs) for (const l of labels) push(orbs, id, l);
    mergeReasons(state.reasons);
  }
  return { megido, orbs, reasons };
}

// 理由の同一性（重複を1件に寄せるための署名）。敵・種類・脅威／
// 対策・手段の効果IDと媒体の出所の組で見る（同じ特効でも特性
// 由来とマスエフェクト由来は別の理由として残す）。
function reasonSignature(reason) {
  const means = (reason.means || [])
    .map((m) => `${m.effectId || ''}@${(m.via || []).map((v) => v.src).join('+')}`)
    .join(',');
  const via = (reason.via || []).map((v) => v.src).join(',');
  return [reason.kind, reason.enemyName, reason.threatLabel || '',
    reason.answerLabel || '', reason.race || '', reason.state || '',
    reason.effectId || '', means, via].join('|');
}

// ---- 印の理由の組み立て（表示用、純粋関数） ----
// pickerAnswersForEnemy が記録した理由（敵・脅威・手段の構造）を、
// 画面に出す短い行にする。根拠は計算時点で揃っているものだけを
// 使い、無い部分は行に出さない（推測で作らない）。
// 理由の形:
// - threat:  { kind, enemyName, threatLabel, means }
// - overall: { kind, enemyName, answerLabel, means }（全体の進め方）
// - race:    { kind, enemyName, race, targets, effectId, effectName, via }
// - state:   { kind, enemyName, state, effectId, effectName, via }
// means は候補の手段 [{ effectId, effectName, via }]。媒体はメギド
// 候補だけに付け、オーブ候補では付けない（candidateText と同じ作法）。
function reasonMeansText(means, orb) {
  const parts = [];
  for (const m of means || []) {
    const method = methodShortLabel(m.effectId, m.effectName);
    let s = method;
    if (!orb) {
      const media = mediaShortForVia(m.via);
      if (media) s = method ? `${method}（${media}）` : media;
    }
    if (s && !parts.includes(s)) parts.push(s);
  }
  return parts.join('・');
}

export function answerReasonLine(reason, { orb = false } = {}) {
  if (!reason) return '';
  if (reason.kind === 'race') {
    const targets = (reason.targets || []).join('、');
    const media = orb ? '' : mediaShortForVia(reason.via);
    return `${targets}（${reason.race}）への特効${media ? `（${media}）` : ''}`;
  }
  if (reason.kind === 'state') {
    const media = orb ? '' : mediaShortForVia(reason.via);
    return `${reason.enemyName}は${reason.state}が弱点: ${reason.state}特効${media ? `（${media}）` : ''}`;
  }
  const meansText = reasonMeansText(reason.means, orb);
  const head = reason.kind === 'overall'
    ? `${reason.enemyName}への対策「${reason.answerLabel}」`
    : `${reason.enemyName}の脅威「${reason.threatLabel}」への答え`;
  return meansText ? `${head}: ${meansText}` : head;
}

// 理由の配列を行の配列にする（同じ行は1つに寄せる）。
export function answerReasonLines(reasons, opts = {}) {
  const lines = [];
  for (const r of reasons || []) {
    const line = answerReasonLine(r, opts);
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

// 印の短い具体名（ピッカーの「✓○○が有効」の○○、2026-11-27
// マスター指示で集約表示「✓有効」から具体名入りへ）: 理由の
// 先頭から、その候補が効く具体名を1つだけ取る。残りの根拠は
// 行の中の理由行が担う。
// - 状態特効: 弱点の状態そのもの（例: めまい →「✓めまいが有効」）
// - 種族特効: 「{種族}特効」
// - 脅威への答え・全体の進め方: 先頭の手段の短い名前
//   （methodShortLabel）。汎用の状態異常耐性（resist:any）だけは
//   短縮形が「any耐性」になってしまうため、能力文の言い方
//   「全状態異常耐性」にする。
// 具体名が取れない理由しか無い場合は null（呼び出し側は印自体を
// 出さない。ME 適合だけの候補がこれに当たる）。
export function answerMarkLabel(reasons) {
  for (const r of reasons || []) {
    if (!r) continue;
    if (r.kind === 'state' && r.state) return r.state;
    if (r.kind === 'race' && r.race) return `${r.race}特効`;
    if (r.kind === 'threat' || r.kind === 'overall') {
      for (const m of r.means || []) {
        if (!m) continue;
        if (m.effectId === 'resist:any') return '全状態異常耐性';
        const label = methodShortLabel(m.effectId, m.effectName);
        if (label) return label;
      }
    }
  }
  return null;
}

// ME の条件行を満たすことの理由行（ピッカーの✓有効の材料の1つ）。
// meFits は [{ label: 'ME1', effectText }]（main 側の組み立て）。
export function meFitReasonLines(meFits) {
  return (meFits || []).map((f) => `リーダーの${f.label}をみたす（${f.effectText}）`);
}

// 需要の理由行（ピッカーの「後の階で出番あり」の材料）: 需要の
// 集計（aggregateDemand）が候補ごとに持つマス情報（spots: 階・
// 敵名・脅威名）から組む。fromFloor の扱いは demandWeight と同じ
// （floor >= fromFloor）。同じ階・敵・脅威は1行に寄せ、階の昇順。
// 上限を超えた分は「ほかN件」に畳む（targetMarkText と同じ作法）。
export function demandReasonLines(demand, megidoId, fromFloor, limit = 6) {
  const d = demand ? demand.get(megidoId) : null;
  if (!d) return [];
  const seen = new Set();
  const lines = [];
  const spots = [...(d.spots || [])]
    .filter((s) => s.floor >= fromFloor)
    .sort((a, b) => a.floor - b.floor);
  for (const s of spots) {
    const key = `${s.floor}:${s.enemyName}:${s.threatName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${s.floor}F ${s.enemyName}の脅威「${s.threatName}」への答え`);
  }
  if (lines.length > limit) {
    return [...lines.slice(0, limit), `ほか${lines.length - limit}件`];
  }
  return lines;
}

// ---- 文章だけの戦術の分類（導出監査 型3） ----
// 手段を持たない著述の戦術のうち、機械的につなげるもの:
// - 配置・編成の形（ワントップ／ワンボトム）: 対策の型として提示する。
// - トランスの始動: 系統名を含む戦術は、始動役の保持者を候補として
//   つなげる（保持者の引き方は呼び出し側が mechanicNotes で行う）。
// それ以外（倒す順番・手順など）は「どう倒すか」に残す文章として扱う。
// トランスの系統名（mechanicNotes.tranceStarters の値域）と、
// 著述の文面での表記の対応。
const TRANCE_FAMILY_PATTERNS = [
  { pattern: /大協奏|協奏|重奏/, family: '協奏・重奏' },
  { pattern: /バレットアーツ/, family: 'バレットアーツ' },
  { pattern: /Fインパルス|インパルス/, family: 'Fインパルス' },
  { pattern: /コロッセオ/, family: 'コロッセオ' },
  { pattern: /ネクロ/, family: 'ネクロ' },
  { pattern: /怒闘/, family: '怒闘' },
];

export function classifyProseTactic(tactic) {
  const text = `${tactic.label || ''} ${tactic.basis || tactic.detail || ''}`;
  if (/ワントップ|ワンボトム/.test(text)) {
    return { kind: 'placement', label: /ワントップ/.test(text) && /ワンボトム/.test(text)
      ? 'ワントップ／ワンボトム' : (/ワントップ/.test(text) ? 'ワントップ' : 'ワンボトム') };
  }
  // ハイトランスは相手のトランスの上書き（潰す側）で、始動の話では
  // ないため、始動役の接続の対象にしない。
  if (!/ハイトランス/.test(text)) {
    for (const { pattern, family } of TRANCE_FAMILY_PATTERNS) {
      if (pattern.test(text) && /始動|シフト|で戦う|を使う|に任せ|で削る|で攻める/.test(text)) {
        return { kind: 'trance', family };
      }
    }
  }
  return null;
}

// 需要の範囲の終わりの階（相談 5-15・型4）: fromFloor 以降で、
// 未処理の回復マスを含む最初の階。回復マスがもう無ければ最終階。
// 階単位の近似: ランの現在位置はマス単位では持たないため、回復マス
// のある階までを1つの範囲とする。
export function demandRangeEndFloor(structure, cleared, fromFloor) {
  const floors = [...(structure.floors || [])].sort((a, b) => a.floor - b.floor);
  for (const fd of floors) {
    if (fd.floor < fromFloor) continue;
    for (const [squareId, def] of Object.entries(fd.squares || {})) {
      // 回復マスは探索マスの一種（type: explore / subType: recovery）。
      if (def.type === 'explore' && def.subType === 'recovery'
        && !(cleared && cleared.has(squareId))) return fd.floor;
    }
  }
  return floors.length ? floors[floors.length - 1].floor : fromFloor;
}

// 需要の集計（H6、型4 の判断で組み直し）: 数えるのは脅威への答えだけ
// （統合脅威リストの答え候補。種族特効・状態特効のような「効く手」は
// 数えない）。範囲は現在地の階から、次のコンディション回復マスの
// ある階まで（rangeEndFloor を渡さない場合は全階）。
// 著述のある敵も数える（従来は著述の有無で丸ごと除外していたため、
// 著述のある敵しか出ない範囲では需要が常に空だった）。
// ボス著述の敵は導出の脅威への答えを数え、全体の進め方の戦術の
// 保持者も数える（SW95 便2）。
export function aggregateDemand({ structure, enemiesByFloor, clsById, index, owned, cleared, tactics = null, levelOf = null, rangeEndFloor = null }) {
  const demand = new Map();
  const bump = (id, spot) => {
    if (!demand.has(id)) demand.set(id, { total: 0, essential: 0, spots: [] });
    const d = demand.get(id);
    d.total += 1;
    if (spot.essential) d.essential += 1;
    if (d.spots.length < 60) d.spots.push(spot);
  };
  for (const fd of structure.floors) {
    if (rangeEndFloor !== null && fd.floor > rangeEndFloor) continue;
    const floorEnemies = enemiesByFloor.get(fd.floor);
    if (!floorEnemies) continue;
    for (const [squareId, def] of Object.entries(fd.squares)) {
      if (def.type !== 'battle' && def.type !== 'boss') continue;
      if (cleared && cleared.has(squareId)) continue;
      const fullDef = { floor: fd.floor, ...def };
      const countedHere = new Set();
      for (const name of def.enemies || []) {
        const fact = floorEnemies.enemies ? floorEnemies.enemies[name] : null;
        if (!fact) continue;
        const authored = tactics ? authoredEntryFor(tactics, name, fullDef, squareId) : null;
        // ボス著述の敵も、導出の脅威への答えは需要に数える
        // （SW95 便2。従来は著述がボスというだけで丸ごと除外され、
        // ボスしか出ない範囲では需要が常に空だった）。
        const isBoss = Boolean(authored && authored.kind === 'boss');
        const threats = isBoss
          ? derivedThreatsAsItems(fact, clsById)
          : enemyThreatsUnified({ fact, authored, clsById });
        // 制限マスでは、制限下で使える機構の候補だけを需要に数える。
        // 段階はマスごとに違うため、ルール文から読んだ段階で数える。
        const restricted = restrictionOf(def);
        const countBlocks = (blocks, threatName) => {
          const candidateIds = new Set();
          for (const b of blocks) {
            for (const c of b.megido) if (candidateUsable(c)) candidateIds.add(c.id);
          }
          if (candidateIds.size === 0) return;
          const essential = candidateIds.size <= 2;
          for (const id of candidateIds) {
            const key = `${squareId}:${id}`;
            if (countedHere.has(key)) continue;
            countedHere.add(key);
            bump(id, { floor: fd.floor, squareId, threatName, enemyName: name, essential });
          }
        };
        for (const t of threats) {
          const blocks = threatAnswerBlocks({ threat: t, fact, authored, clsById, index, owned, levelOf, restricted });
          countBlocks(blocks, t.label);
        }
        // 全体の進め方の戦術（手段を持つもの）の保持者も需要に
        // 数える（SW95 便2、監査C）。
        for (const b of authoredOverallBlocks({ authored, clsById, index, owned, levelOf, restricted })) {
          countBlocks([b], b.tacticLabel);
        }
      }
    }
  }
  return demand;
}

// 需要の重み（M7 の候補生成での回避に使う）。必須級を重く数える。
export function demandWeight(demand, megidoId, fromFloor) {
  const d = demand ? demand.get(megidoId) : null;
  if (!d) return 0;
  let w = 0;
  for (const s of d.spots) {
    if (s.floor >= fromFloor) w += s.essential ? 3 : 1;
  }
  return w;
}

// 需要の件数（M7 のメンバーごとの事情の表示用）: fromFloor 以降のマスで
// 対策の候補になる回数と、そのうち必須級（候補が2体以下）の回数。
// demandWeight と同じ範囲（floor >= fromFloor）で数える。
export function demandCounts(demand, megidoId, fromFloor) {
  const d = demand ? demand.get(megidoId) : null;
  if (!d) return { total: 0, essential: 0 };
  let total = 0;
  let essential = 0;
  for (const s of d.spots) {
    if (s.floor < fromFloor) continue;
    total += 1;
    if (s.essential) essential += 1;
  }
  return { total, essential };
}

// 需要の最初の階（M7 の需要の印用）: fromFloor 以降で、その者が対策の
// 候補になる最初のマスの階。候補になるマスが無ければ null。件数では
// なく「何階か」を返す（需要の表示は件数から人ごとの印へ、2026-11-21）。
// 数える範囲は demandCounts と同じ（floor >= fromFloor）。
export function demandEarliestFloor(demand, megidoId, fromFloor) {
  const d = demand ? demand.get(megidoId) : null;
  if (!d) return null;
  let first = null;
  for (const s of d.spots) {
    if (s.floor < fromFloor) continue;
    if (first === null || s.floor < first) first = s.floor;
  }
  return first;
}

export { METHOD_LABEL };
