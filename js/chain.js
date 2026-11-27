// チェインのテスト道具（2026-11-19、ユーザー承認済みの方式に
// 作り替え。旧「経路チェッカー」はタップした順に経路を宣言させて
// つなぎ目を判定する形だったが、擦り合わせで方式ごと置き換えた）。
// 目的は「敵の行動を割り込めるか」を試すこと:
//   - タイムテーブル: 編成の味方と対象の敵全員を実効素早さ順に
//     並べる。起点の味方はタイムテーブルに残る（どこを割り込んで
//     いるかの目印）。
//   - 起点をタップすると、「次の素早さの味方」がタイムテーブル
//     からチェインテーブル（行動の列）へ自動で移動する。その
//     味方が次へ渡せる間、繰り返す。
//   - チェインテーブルは人の列ではなく行動の列: 一度乗った味方
//     も、フォトンがあればもう一度行動できる（2回目・3回目の
//     行動としてもう一度並ぶ。1人は3回まで）。上限はパーティ
//     のフォトン基本5個（起点の分を含む。自身へのフォトン追加
//     つきの形で渡すと、その分だけ増える）。上限に達したら
//     候補はそれ以上出さない。
//   - 行動をタップで外すと（その回のフォトンを乗せなかった扱い）、
//     次の候補が代わりに入る。外した回の行動は候補に戻らない。
// 判定の材料と考え方（旧チェッカーから引き継いだもの）:
//   - 起点は「始動」の形（チェインの外から味方へチェインする
//     行動）か、回数チェイン付与で始められる。中継だけの者は
//     始動にならない。渡す側は始動・中継のどちらの形でもよい。
//   - 条件: 専用霊宝は装備の有無で判定する（足りなければ、その
//     形は使えない）。覚醒ゲージ・確率は戦闘中の条件で、繋がる
//     かどうかには数えず注記に回す。
//   - フォトン種別の条件は、供給の材料（photon-supply.v1.json）
//     で、そのメンバーがそのフォトンを実際にまかなえるかで注記
//     を分ける: 「（〜で追加できる）」／「（追加は確率次第・
//     ドラフト次第）」／「（ドラフト次第）」。繋がるかどうかには
//     数えず、形の候補が複数ある場合は保証のある形を優先する。
//   - 例外処理（対象の縛り）: 「最も攻撃力が高い味方」等の縛り
//     しかない形で渡す場合は、素早さ順ではなく条件の相手を
//     引っ張る。その行動は条件で固定（タップしても変えられ
//     ない）。縛りの無い形も持つ者は、縛りの無い形を優先する。
//   - 例外処理（回数チェイン付与）: 編成に回数チェイン付与の
//     持ち主（味方へ渡す形が使える者）がいる場合、チェインを
//     持たない味方も起点・中継になれる。判定は「編成に付与
//     持ちがいるか」だけ（誰が受けたかは追わない。ユーザー
//     裁定 2026-11-19）。
// 材料は chain.v1.json（能力原文への機械検出。generate-chain.mjs）。
// 2026-11-20 追加（再現度監査 C1・C2・C3 と手組み、ユーザー決定）:
//   - ME 由来の始動とオーブ由来のチェインも材料に含む。呼び出し側
//     （main.js）が、そのメンバーに実際に付いている分を via
//     （'me' | 'orb'）を付けた形として記録へ混ぜて渡す。
//   - 確率の形は「？」の印で提示し、ユーザーが無視（×）を選んだ
//     形は ignoredProb（形のキーの列）として判定から外す。実行時
//     条件（確率・ゲージ・フォトン種別）は成立には効かせず、
//     ※注記で伝える（C3）。
//   - 手組み: 行動ごとに overrides（"メギドID#回数" → 形のキー
//     または止めるフォトン）で使う行動を指定できる。指定した形が
//     渡さなければ経路はそこで止まり、自身へのチェインの形を
//     指定すれば本人が次に来る。自動の組み立ては初期状態として
//     残り、そこから手で直す。
// 2026-11-20 追加（チェイン判定の修正、ユーザー決定。追加判断）:
//   - 1人の行動は3回まで（3巡目までテストできる形に変更）。
//   - 自動の組み立ても自身へのチェインを渡しの候補に入れる
//     （始動・中継と同じ土俵で、摩擦の軽い順に選ぶ）。
//   - 形の条件に「チェイン数の範囲」（chainMin / chainMax）と
//     「専用霊宝があると使えない」（noReishou、専用霊宝で特性
//     が差し替わるマルコシアスB）が加わった。どちらも装備・位置
//     で決まる条件として判定に使い、摩擦には数えない。チェイン
//     数は起点の行動を0（チェインなし）とし、繋がれるごとに+1。
//   - 自身へのフォトン追加つきの自身チェイン（プルフラスBの
//     奥義の Ch4 以降）: 追加フォトンが次の自分の行動を払う
//     ため、1人3回の上限を超えて続けてよく、フォトンの合計
//     予算も追加の分だけ増える。確率つきの追加は、他の確率の
//     形と同じく「？」の印と無視（×）で扱う。

// パーティのフォトンは基本5個（起点の分を含む）。自身への
// フォトン追加つきの形で渡すと、その分だけ予算が増える。
export const CHAIN_PHOTON_MAX = 5;
// 1人が並べる行動は3回まで（通常、1人がつめるのは3回まで。
// フォトン追加つきの自身チェインで来る行動だけは例外）。
const MAX_ACTIONS_PER_MEMBER = 3;

// 形の同一性（無視の指定と手組みの指定で使う安定したキー）。
export function chainWayKey(way) {
  if (!way) return '';
  const conds = (way.conditions || [])
    .map((c) => `${c.type}:${c.min ?? c.max ?? c.pct ?? c.photon ?? ''}`).sort().join('|');
  const add = way.addsPhoton ? `add:${way.addsPhoton}` : '';
  return [way.via || 'self', way.medium || '', way.restrict || '', way.scope || '', conds, add].join('|');
}

function probOf(way) {
  const c = (way && way.conditions || []).find((x) => x.type === 'prob');
  return c ? c.pct : null;
}

// そのメギドがチェインに関わる力を持つか（区画を出すかの判定）。
export function hasChainRole(rec) {
  if (!rec) return false;
  return Boolean(
    (rec.start && rec.start.length) || (rec.relay && rec.relay.length)
    || (rec.grant && rec.grant.length) || (rec.selfChain && rec.selfChain.length)
    || rec.scaler,
  );
}

function hasReishouCondition(way) {
  return (way.conditions || []).some((c) => c.type === 'reishou');
}

function hasNoReishouCondition(way) {
  return (way.conditions || []).some((c) => c.type === 'noReishou');
}

// 専用霊宝の装備で塞がれるか（要る形は未装備で、差し替えで消
// える形は装備で塞がれる）。
function reishouBlocked(way, specialReishou) {
  if (hasReishouCondition(way) && !specialReishou) return true;
  if (hasNoReishouCondition(way) && specialReishou) return true;
  return false;
}

// チェイン数の範囲の条件に合うか。chainCount はその行動の
// チェイン数（起点の行動が0）。数が渡されなければ判定しない。
function chainCountOk(way, chainCount) {
  if (typeof chainCount !== 'number') return true;
  for (const c of way.conditions || []) {
    if (c.type === 'chainMin' && chainCount < c.min) return false;
    if (c.type === 'chainMax' && chainCount > c.max) return false;
  }
  return true;
}

// 渡しの種類が回数チェイン付与由来か（'grant' は手組みで指定した
// 付与の形、'grantAlly'/'grantSelf' は本人の付与、'partyGrant' は
// 編成に付与持ちがいることによる例外処理）。表示側が付与由来の
// 手だけ色を変える判定に使う（2026-11-21 ユーザー決定）。
export function isGrantLinkKind(kind) {
  return kind === 'grant' || kind === 'grantAlly'
    || kind === 'grantSelf' || kind === 'partyGrant';
}

// 編成に回数チェイン付与の持ち主がいるか。members は
// [{ rec, specialReishou }]（rec は chain.v1.json の記録）。
// 味方へ渡す形（scope が ally か all）で、専用霊宝の条件が
// 装備で解けているものだけを数える（自身への付与は、持ち主
// 本人の中継にだけ効くので、編成全体の例外には数えない）。
export function partyHasChainGrant(members) {
  return (members || []).some(({ rec, specialReishou }) => rec
    && (rec.grant || []).some((g) => (g.scope === 'ally' || g.scope === 'all')
      && !reishouBlocked(g, specialReishou)));
}

// 起点になれるか。戻り値 { ok, reason }（reason はなれない理由）。
// ignoredProb にある確率の形は、使えないものとして数える。
export function chainOriginEligibility(rec, { partyHasGrant = false, specialReishou = false, ignoredProb = [] } = {}) {
  if (partyHasGrant) return { ok: true, reason: null };
  if (!rec || !hasChainRole(rec)) return { ok: false, reason: 'チェインを持っていない' };
  const ignored = new Set(ignoredProb || []);
  const usable = (list) => (list || []).filter((w) => !reishouBlocked(w, specialReishou)
    && !ignored.has(chainWayKey(w)));
  if (usable(rec.start).length) return { ok: true, reason: null };
  if (usable(rec.grant).length) return { ok: true, reason: null };
  if ((rec.start || []).length || (rec.grant || []).length) {
    if (specialReishou
      && [...(rec.start || []), ...(rec.grant || [])].some((w) => hasNoReishouCondition(w))) {
      return { ok: false, reason: '専用霊宝で特性が変わっている' };
    }
    return { ok: false, reason: '専用霊宝が付いていない' };
  }
  if ((rec.relay || []).length) {
    return { ok: false, reason: 'チェイン中しか繋げない（始動にはならない）' };
  }
  if ((rec.selfChain || []).length) return { ok: false, reason: '自身へのチェインしかない' };
  return { ok: false, reason: 'チェインを始められない' };
}

// photonOf: フォトン種別 → { level: 'guaranteed'|'prob', source }
// | null（供給の材料が無い・まかなえない）| undefined（材料自体が
// 渡されていない。注記は従来の形になる）。
function conditionNotes(way, photonOf) {
  const notes = [];
  for (const c of way.conditions || []) {
    if (c.type === 'gauge') notes.push(`覚醒ゲージ${c.min}%以上が必要`);
    else if (c.type === 'photon') {
      if (typeof photonOf === 'function') {
        const g = photonOf(c.photon);
        if (g && g.level === 'guaranteed') {
          notes.push(`${c.photon}フォトンを使うとき（${g.source}で追加できる）`);
        } else if (g) {
          notes.push(`${c.photon}フォトンを使うとき（追加は確率次第・ドラフト次第）`);
        } else {
          notes.push(`${c.photon}フォトンを使うとき（ドラフト次第）`);
        }
      } else {
        notes.push(`${c.photon}フォトンを使うとき`);
      }
    } else if (c.type === 'prob') notes.push(`${c.pct}%の確率`);
  }
  return notes;
}

// フォトン条件のまかなえ具合（形の候補の優先付け用）: 条件が無い
// か保証がある形を上位に、確率だけの形、ドラフト次第の形の順。
function photonRank(way, photonOf) {
  const c = (way.conditions || []).find((x) => x.type === 'photon');
  if (!c || typeof photonOf !== 'function') return 0;
  const g = photonOf(c.photon);
  if (!g) return 2;
  return g.level === 'guaranteed' ? 0 : 1;
}

// 形の「重さ」（候補の優先付け）: フォトン条件は保証があれば
// 軽く、ドラフト次第なら重く数える。覚醒スキル・奥義の形は、
// 媒体そのものに覚醒ゲージが要る分を上乗せする（counter.js の
// 媒体条件と同じ線引き）。専用霊宝の条件とチェイン数の範囲は
// 装備・位置で解決済みのため数えない。その他の条件（ゲージ・
// 確率）は1つにつき1。
function wayFriction(way, photonOf) {
  let f = photonRank(way, photonOf) * 2;
  f += (way.conditions || [])
    .filter((c) => c.type !== 'photon' && c.type !== 'reishou' && c.type !== 'noReishou'
      && c.type !== 'chainMin' && c.type !== 'chainMax').length;
  if (way.medium === '覚醒スキル' || way.medium === '奥義') f += 1;
  return f;
}

// 味方への渡しの形の注記（条件の注記＋縛り＋媒体）。
function passWayNotes(way, photonOf) {
  const notes = conditionNotes(way, photonOf);
  if (way.restrict === 'maxAtk') notes.push('最も攻撃力が高い味方へのチェイン');
  if (way.restrict === 'minSpd') notes.push('最も素早さが低い味方へのチェイン');
  notes.push(`${way.medium}でチェイン`);
  return notes;
}

// 渡す形の候補から使うものを選ぶ。候補は味方への形（kind:
// 'way'）と自身への形（kind: 'self'）を同じ土俵で混ぜた列。
// 縛りの無い形を優先し、次に重さの軽い形。同点なら材料の
// 並び（検出順）を保つ。無視された確率の形（ctx.ignoredProb）
// と、装備で塞がれた形と、チェイン数の範囲外の形は候補に入れ
// ない。
// 戻り値: { kind, way, notes } | { blocked: 'reishou' } | null
function pickPassCandidate(cands, ctx) {
  let blocked = false;
  const usable = [];
  for (const cand of cands) {
    if (ctx.ignoredProb && ctx.ignoredProb.has(chainWayKey(cand.way))) continue;
    if (reishouBlocked(cand.way, ctx.specialReishou)) {
      blocked = true;
      continue;
    }
    if (!chainCountOk(cand.way, ctx.chainCount)) continue;
    usable.push(cand);
  }
  if (!usable.length) return blocked ? { blocked: 'reishou' } : null;
  usable.sort((a, b) => {
    const ra = a.way.restrict ? 1 : 0;
    const rb = b.way.restrict ? 1 : 0;
    if (ra !== rb) return ra - rb;
    const df = wayFriction(a.way, ctx.photonOf) - wayFriction(b.way, ctx.photonOf);
    if (df !== 0) return df;
    // 同じ軽さなら自身への形を優先する（本人が続けて動く形が
    // その持ち主の本筋。マルコシアスBの霊宝ありで、覚醒スキル
    // の味方渡しと奥義の自身チェインが同点になる）。
    if (a.kind !== b.kind) return a.kind === 'self' ? -1 : 1;
    return 0;
  });
  const { kind, way } = usable[0];
  const notes = kind === 'self' ? wayNotes(way, 'self', ctx.photonOf) : passWayNotes(way, ctx.photonOf);
  return { kind, way, notes };
}

// 渡す形が消費するフォトン: 媒体そのものがフォトンを決める
// （スキル→スキルフォトン、覚醒スキル→覚醒フォトン、奥義→
// 奥義フォトン）。特性の形は、フォトンの条件が付いていれば
// そのフォトン（バールゼフォンのチャージ、マルコシアスBの
// アタック）。条件の無い特性（どのフォトンでもよい形）は
// 特定できないため null。
function photonForWay(way) {
  if (!way) return null;
  if (way.medium === 'スキル') return 'スキル';
  if (way.medium === '覚醒スキル') return '覚醒';
  if (way.medium === '奥義') return '奥義';
  if (way.medium === '特性' || way.medium === 'マスエフェクト') {
    const c = (way.conditions || []).find((x) => x.type === 'photon');
    return c ? c.photon : null;
  }
  return null;
}

// 形1件の注記（自動で選んだ時と、手組みの選択肢で出す時とで
// 同じ形にする）。kind は 'way' | 'grant' | 'self'。
function wayNotes(way, kind, photonOf) {
  if (kind === 'grant') {
    return way.scope === 'self' ? ['回数チェインで繋ぐ'] : ['回数チェインを付与して繋ぐ'];
  }
  const notes = conditionNotes(way, photonOf);
  if (kind === 'self') {
    if (way.addsPhoton) notes.push(`自身に${way.addsPhoton}フォトンを追加`);
    notes.push('自身にチェイン');
    return notes;
  }
  if (way.restrict === 'maxAtk') notes.push('最も攻撃力が高い味方へのチェイン');
  if (way.restrict === 'minSpd') notes.push('最も素早さが低い味方へのチェイン');
  notes.push(`${way.medium}でチェイン`);
  return notes;
}

// そのメンバーが次の行動へ渡せるか。
// 戻り値: { kind: 'way'|'self'|'grantAlly'|'grantSelf'|'partyGrant', way?, notes, photon }
//       | { blocked: 'reishou' } | null（渡す形が無い）
// photon は、その行動が消費するフォトンの種別（特定できな
// い場合は null。表示側でアタックとして出す）。
// chainCount は、そのメンバーの今の行動のチェイン数（起点の
// 行動が0）。範囲の条件つきの形は、その数で使える時だけ候補
// になる。自身への形も、味方への形と同じ土俵で候補に入る。
function resolvePass(rec, { isOrigin, specialReishou, partyGrant, photonOf, ignoredProb = null, chainCount = null }) {
  if (rec) {
    const cands = [];
    const ways = isOrigin
      ? [...(rec.start || [])]
      : [...(rec.start || []), ...(rec.relay || [])];
    for (const w of ways) cands.push({ kind: 'way', way: w });
    for (const w of rec.selfChain || []) cands.push({ kind: 'self', way: w });
    const picked = pickPassCandidate(cands, { specialReishou, photonOf, ignoredProb, chainCount });
    if (picked && picked.way) {
      return { kind: picked.kind, way: picked.way, notes: picked.notes, photon: photonForWay(picked.way) };
    }
    const grants = rec.grant || [];
    const usableGrants = grants.filter((g) => !reishouBlocked(g, specialReishou)
      && !(ignoredProb && ignoredProb.has(chainWayKey(g))));
    const allyGrant = usableGrants.find((g) => g.scope !== 'self');
    if (allyGrant) {
      return { kind: 'grantAlly', way: allyGrant, notes: ['回数チェインを付与して繋ぐ'], photon: photonForWay(allyGrant) };
    }
    const selfGrant = usableGrants.find((g) => g.scope === 'self');
    if (selfGrant) {
      return { kind: 'grantSelf', way: selfGrant, notes: ['回数チェインで繋ぐ'], photon: photonForWay(selfGrant) };
    }
    if (partyGrant) return { kind: 'partyGrant', notes: ['回数チェイン付与で繋ぐ'], photon: null };
    if (picked && picked.blocked) return { blocked: 'reishou' };
    if (grants.length && !usableGrants.length) return { blocked: 'reishou' };
    return null;
  }
  if (partyGrant) return { kind: 'partyGrant', notes: ['回数チェイン付与で繋ぐ'], photon: null };
  return null;
}

// 手組みで指定された形を、そのメンバーの使える形から探す。
// 起点の手では中継の形は使えない。装備で塞がれた形と、チェ
// イン数の範囲外の形は指定しても使えない（自動の組み立てに
// 落ちる）。戻り値: { kind, way } | null
// （kind は 'way' | 'grant' | 'self'）。
function findForcedWay(rec, key, { isOrigin, specialReishou, ignoredProb, chainCount = null }) {
  if (!rec || !key) return null;
  const lists = isOrigin
    ? [['way', rec.start], ['grant', rec.grant], ['self', rec.selfChain]]
    : [['way', rec.start], ['way', rec.relay], ['grant', rec.grant], ['self', rec.selfChain]];
  for (const [kind, list] of lists) {
    for (const way of list || []) {
      if (chainWayKey(way) !== key) continue;
      if (reishouBlocked(way, specialReishou)) return null;
      if (!chainCountOk(way, chainCount)) return null;
      if (ignoredProb && ignoredProb.has(key)) return null;
      return { kind, way };
    }
  }
  return null;
}

// 手組みの選択肢: その手で選べる行動の一覧。チェインの形
// （始動・中継・付与・自身。起点の手では中継は出ない）と、
// チェインしない行動（形で使われていないフォトンの種別）。
// chainCount（その手のチェイン数）が渡されれば、範囲外の形
// は選択肢に出さない。
// 戻り値: [{ type: 'way', key, kind, medium, via, photon, prob,
//           notes } | { type: 'stop', key, photon }]
export function chainActionOptions(rec, {
  isOrigin = false, specialReishou = false, ignoredProb = [], photonOf = null, chainCount = null,
} = {}) {
  const ignored = new Set(ignoredProb || []);
  const options = [];
  const seen = new Set();
  if (rec) {
    const lists = isOrigin
      ? [['way', rec.start], ['grant', rec.grant], ['self', rec.selfChain]]
      : [['way', rec.start], ['way', rec.relay], ['grant', rec.grant], ['self', rec.selfChain]];
    for (const [kind, list] of lists) {
      for (const way of list || []) {
        if (reishouBlocked(way, specialReishou)) continue;
        if (!chainCountOk(way, chainCount)) continue;
        const key = chainWayKey(way);
        if (ignored.has(key) || seen.has(key)) continue;
        seen.add(key);
        options.push({
          type: 'way', key, kind,
          medium: way.medium || '', via: way.via || 'self',
          photon: photonForWay(way), prob: probOf(way),
          notes: wayNotes(way, kind, photonOf),
        });
      }
    }
  }
  const covered = new Set(options.map((o) => o.photon).filter(Boolean));
  for (const p of ['アタック', 'スキル', 'チャージ', '覚醒', '奥義']) {
    if (!covered.has(p)) options.push({ type: 'stop', key: `stop:${p}`, photon: p });
  }
  return options;
}

// 縛りの相手: 条件を満たす味方（渡す本人は除く。同点は編成の
// 並びで先の者。条件を満たすのは基本1人という前提）。
function conditionedTarget(restrict, allies, excludeId) {
  const others = allies.filter((a) => a.id !== excludeId);
  let best = null;
  for (const a of others) {
    if (restrict === 'maxAtk') {
      if (typeof a.atk === 'number' && (best === null || a.atk > best.atk)) best = a;
    } else if (typeof a.spd === 'number' && (best === null || a.spd < best.spd)) {
      best = a;
    }
  }
  return best;
}

function spdKey(v) {
  return typeof v === 'number' ? v : -Infinity;
}

// タイムテーブル: 味方と敵を実効素早さ順に混ぜた行の列。
// allies: [{ id, name, spd }]、enemies: [{ name, spd }]
// （spd が数値でない行は末尾。同速は投入順を保つ）。
export function buildTimeline({ allies = [], enemies = [] }) {
  const rows = [];
  for (const a of allies) {
    rows.push({ kind: 'ally', id: a.id, name: a.name, spd: typeof a.spd === 'number' ? a.spd : null });
  }
  enemies.forEach((e, i) => {
    rows.push({
      kind: 'enemy', key: `enemy-${i}`, name: e.name,
      spd: typeof e.spd === 'number' ? e.spd : null,
      // マスルール適用の内訳（基礎値と倍率。表示側で使う）
      baseSpd: typeof e.baseSpd === 'number' ? e.baseSpd : null,
      mult: typeof e.mult === 'number' ? e.mult : 1,
    });
  });
  rows.sort((a, b) => spdKey(b.spd) - spdKey(a.spd));
  return rows;
}

// 起点を挟む敵: before は起点より後ろ（遅い側）の最初の敵、
// after は起点より前（速い側）の最後の敵。
export function chainCutInTarget(timeline, originId) {
  const oi = timeline.findIndex((r) => r.kind === 'ally' && r.id === originId);
  if (oi < 0) return { before: null, after: null };
  let before = null;
  let after = null;
  timeline.forEach((r, i) => {
    if (r.kind !== 'enemy') return;
    if (i > oi && !before) before = r;
    if (i < oi) after = r;
  });
  return { before, after };
}

// チェインの組み立て（起点からの自動の引っ張り＋手組みの指定）。
// originId: 起点のメギドID（起点になれることは呼び出し側が
//   chainOriginEligibility で確認済みの前提）。
// allies: [{ id, spd, atk }]（編成の全味方。並びは編成順）。
// skipped: 外された行動のキー列（"メギドID#回数"）。
// overrides: 手組みの指定（"メギドID#回数" → { wayKey } |
//   { stopPhoton }）。wayKey の形で渡す／止めるフォトンで止める。
//   指定が無い手は自動で組む。
// ignoredProb: 無視する確率の形のキー列（chainWayKey）。
// chainOf(id) → chain.v1.json の記録 | null
// specialReishouOf(id) → 専用霊宝の装備有無
// photonGuaranteeOf(id, photonType) → { level, source } | null（任意）
// partyGrant: 編成に回数チェイン付与の持ち主がいるか
// 戻り値: { actions: [{ id, occ, via, fixed, restrict, notes, photon, way, prob, linkKind }],
//           stopReason: 'photon'|'no-pass'|'reishou'|'no-candidate'|'stopped'|null,
//           stopId, photonBudget }
//   linkKind は、その行動がどの渡しで引っ張られたか（起点は null。
//   'way'|'self' は通常のチェイン、'grant'|'grantAlly'|'grantSelf'|
//   'partyGrant' は回数チェイン付与由来。表示側が付与由来の手だけ
//   色を変えるために使う。2026-11-21 ユーザー決定）。
//   photonBudget は最終的なフォトンの予算（基本5。自身へのフォトン
//   追加で渡すたびに増える。件数表示の分母はこれを使う）。
//   via は 'origin'（起点）|'speed'（素早さ順）|'restrict'（条件で固定）
//   |'self'（自身へのチェインで本人が次に来た）。
//   notes は、その行動を引っ張った形の注記（起点は空）。
//   photon は、その行動が次へ渡すときに消費するフォトンの種別
//   （渡す形から特定できる場合）。次へ渡さない最後の行動と、
//   形から特定できない行動は null（表示側でアタックとして出す:
//   引っ張られた味方の追加の行動はアタックが基本の形）。
//   way は、その行動が次へ渡すのに使った形（確率の印と手組みの
//   現在値の材料。渡さない行動は null）。prob は way の確率（%）。
export function simulateChain({
  originId, allies, skipped = [], chainOf, specialReishouOf,
  photonGuaranteeOf = null, partyGrant = false,
  overrides = {}, ignoredProb = [],
}) {
  const order = [...allies].sort((a, b) => spdKey(b.spd) - spdKey(a.spd));
  const skippedSet = new Set(skipped);
  const ignoredSet = new Set(ignoredProb || []);
  const actions = [{
    id: originId, occ: 1, via: 'origin', fixed: false, restrict: null, notes: [], photon: null, way: null, prob: null, linkKind: null,
  }];
  const countOcc = (id) => actions.reduce((n, a) => n + (a.id === id ? 1 : 0), 0);
  let stopReason = null;
  let stopId = null;
  // フォトンの予算（基本は CHAIN_PHOTON_MAX。自身へのフォトン
  // 追加つきの形で渡すたびに、その分だけ増える）。
  let photonBudget = CHAIN_PHOTON_MAX;

  for (;;) {
    const last = actions[actions.length - 1];
    const isOrigin = actions.length === 1;
    // その行動のチェイン数（起点の行動が0、繋がれるごとに+1）。
    const chainCount = actions.length - 1;
    const photonOf = photonGuaranteeOf ? (t) => photonGuaranteeOf(last.id, t) : null;
    const ov = (overrides || {})[`${last.id}#${last.occ}`] || null;
    if (ov && ov.stopPhoton) {
      // 手組みで「チェインしない」を選んだ手: そのフォトンで
      // 行動して、経路はここで止まる。
      last.photon = ov.stopPhoton;
      stopReason = 'stopped';
      stopId = last.id;
      break;
    }
    let pass = null;
    if (ov && ov.wayKey) {
      const forced = findForcedWay(chainOf(last.id), ov.wayKey, {
        isOrigin, specialReishou: specialReishouOf(last.id), ignoredProb: ignoredSet, chainCount,
      });
      if (forced) {
        pass = {
          kind: forced.kind, way: forced.way,
          notes: wayNotes(forced.way, forced.kind, photonOf),
          photon: photonForWay(forced.way),
        };
      }
    }
    if (!pass) {
      pass = resolvePass(chainOf(last.id), {
        isOrigin,
        specialReishou: specialReishouOf(last.id),
        partyGrant,
        photonOf,
        ignoredProb: ignoredSet,
        chainCount,
      });
    }
    if (!pass) { stopReason = 'no-pass'; stopId = last.id; break; }
    if (pass.blocked) { stopReason = 'reishou'; stopId = last.id; break; }
    // 予算の判定は、渡しを記録する前に行う（使い切っていれば
    // 最後の行動は渡さないため、フォトンは null のまま）。
    // フォトン追加つきの渡しは、追加分が次の行動を払うため
    // 予算を1増やしてから判定する。
    const adds = pass.way && pass.way.addsPhoton ? 1 : 0;
    if (actions.length >= photonBudget + adds) { stopReason = 'photon'; break; }
    if (adds) photonBudget += 1;
    // 渡せることが分かった時点で、その行動が消費するフォトンを
    // 行動自身に記録する（最後の行動は渡さないため null のまま）。
    last.photon = pass.photon || null;
    last.way = pass.way || null;
    last.prob = probOf(pass.way);

    if (pass.kind === 'self') {
      // 自身へのチェイン: 素早さを無視して本人が次に来る。
      // フォトン追加つきの形は追加分が次の行動を払うため、
      // 1人3回の上限を超えてよい。
      const occ = countOcc(last.id) + 1;
      if ((occ > MAX_ACTIONS_PER_MEMBER && !adds) || skippedSet.has(`${last.id}#${occ}`)) {
        stopReason = 'no-candidate';
        stopId = last.id;
        break;
      }
      actions.push({
        id: last.id, occ, via: 'self', fixed: false,
        restrict: null, notes: pass.notes || [], photon: null, way: null, prob: null,
        linkKind: pass.kind || null,
      });
      continue;
    }

    if (pass.way && pass.way.restrict) {
      // 例外処理: 条件の相手を引っ張る（固定）。
      const target = conditionedTarget(pass.way.restrict, allies, last.id);
      const occ = target ? countOcc(target.id) + 1 : 0;
      if (!target || occ > MAX_ACTIONS_PER_MEMBER || skippedSet.has(`${target.id}#${occ}`)) {
        stopReason = 'no-candidate';
        stopId = last.id;
        break;
      }
      actions.push({
        id: target.id, occ, via: 'restrict', fixed: true,
        restrict: pass.way.restrict, notes: pass.notes || [], photon: null, way: null, prob: null,
        linkKind: pass.kind || null,
      });
      continue;
    }

    // 素早さ順: 今のメンバーの次から輪になって探す（末尾まで
    // 行ったら先頭に戻り、2回目の行動として候補になる）。
    const idx = order.findIndex((a) => a.id === last.id);
    let cand = null;
    for (let step = 1; step <= order.length; step += 1) {
      const c = order[(idx + step) % order.length];
      const occ = countOcc(c.id) + 1;
      if (occ > MAX_ACTIONS_PER_MEMBER) continue;
      if (skippedSet.has(`${c.id}#${occ}`)) continue;
      cand = { id: c.id, occ };
      break;
    }
    if (!cand) { stopReason = 'no-candidate'; stopId = last.id; break; }
    actions.push({
      id: cand.id, occ: cand.occ, via: 'speed', fixed: false,
      restrict: null, notes: pass.notes || [], photon: null, way: null, prob: null,
      linkKind: pass.kind || null,
    });
  }
  return { actions, stopReason, stopId, photonBudget };
}
