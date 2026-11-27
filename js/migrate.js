// 旧ツール（localStorage）からの移行
// tech-foundation.md 第4節と research/old-localstorage-inventory.md（実コードでの確認を含む）に対応する。
// 読み取りのみ: このモジュールは getItem しか受け取らないので、旧データを書き換える経路が無い。
// 引き継ぐのは編成（formations）と所持・育成（megidoDetails）だけ。
// ラン進行中の状態（コンディション、塔破力、解放）は引き継がない。

export const OLD_KEY_FORMATIONS = 'formations';
export const OLD_KEY_MEGIDO_DETAILS = 'megidoDetails';

const SLOT_COUNT = 5;

function emptySlot() {
  return { megidoId: null, orbId: null, reishouIds: [], leaderSkill: '' };
}

// 旧・辞書形式の枠 {megidoId, orbId, reishouIds, leaderSkill, ...} を新形式へ。
// 表示用の非正規化フィールド（megidoName 等）は落とす（表示時に基礎データから引く）。
function normalizeDictSlot(slot) {
  if (!slot || typeof slot !== 'object' || !slot.megidoId) return emptySlot();
  return {
    megidoId: slot.megidoId,
    orbId: slot.orbId ?? null,
    reishouIds: Array.isArray(slot.reishouIds) ? [...slot.reishouIds] : [],
    leaderSkill: typeof slot.leaderSkill === 'string' ? slot.leaderSkill : '',
  };
}

// 旧・配列形式の枠 {id, orb:{id,...}, reishou:[{id,...}]} を新形式へ。
function normalizeArraySlot(slot) {
  if (!slot || typeof slot !== 'object' || !slot.id) return emptySlot();
  return {
    megidoId: slot.id,
    orbId: slot.orb && slot.orb.id != null ? slot.orb.id : null,
    reishouIds: Array.isArray(slot.reishou) ? slot.reishou.map((r) => (r && typeof r === 'object' ? r.id : r)) : [],
    leaderSkill: '',
  };
}

function normalizeFormation(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null;
  // タグは {text, category} の形で保つ（検索とチップ表示がカテゴリを使う。
  // 文字列だけの旧形式は custom として受ける）。
  const TAG_CATEGORIES = ['megido', 'enemy', 'floor', 'rule', 'custom'];
  const tags = [];
  const seenTags = new Set();
  for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
    let text = '';
    let category = 'custom';
    if (typeof t === 'string') text = t;
    else if (t && typeof t.text === 'string') {
      text = t.text;
      if (TAG_CATEGORIES.includes(t.category)) category = t.category;
    }
    text = text.trim();
    if (!text || seenTags.has(text)) continue;
    seenTags.add(text);
    tags.push({ text, category });
  }
  let rawSlots = null;
  let normalize = normalizeDictSlot;
  if (Array.isArray(raw.megidoSlots)) {
    rawSlots = raw.megidoSlots;
  } else if (Array.isArray(raw.megido)) {
    rawSlots = raw.megido;
    normalize = normalizeArraySlot;
  }
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    slots.push(rawSlots && rawSlots[i] ? normalize(rawSlots[i]) : emptySlot());
  }
  const floors = Array.isArray(raw.floors)
    ? raw.floors
    : raw.floor != null
      ? [raw.floor]
      : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallbackId,
    name: typeof raw.name === 'string' ? raw.name : '',
    tags,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    enemyName: typeof raw.enemyName === 'string' ? raw.enemyName : '',
    floors,
    reishouReminder: raw.reishou_reminder ?? null,
    slots,
  };
}

// 霊宝は1体に最大4つ（旧ツールの編成枠の上限と同じゲームの規則）。
export const REISHOU_PER_MEGIDO = 4;

// 霊宝の装備の正はメギド側（megidoDetails の reishou）に置く（2026-11-19）。
// 旧ツールでは編成の枠ごとに reishouIds が付いていたため、移行と初回
// 起動時の種付けとして、編成の枠からメギドの装備へ移す。規則:
//   - 編成の並び順に走査し、そのメギドについて最初に非空の reishouIds を
//     持つ枠の組を採用する（先勝ち）。編成ごとに違う組が付いていた場合は
//     最初の編成の組が残り、他の編成の組は装備にはならない（どの編成の
//     組も実在した組であり、混ぜ合わせはしない）。
//   - 既に装備が入っているメギドは触らない。
//   - 重複は除き、上限（REISHOU_PER_MEGIDO）で切る。
//   - megidoDetails に項目の無いメギドには作らない（所持・育成の正は
//     megidoDetails 側にあり、装備だけの項目を生やすと所持扱いの誤読を招く）。
// 戻り値: { megidoDetails, seededCount }
export function seedReishouFromFormations(formations, megidoDetails) {
  if (!megidoDetails || typeof megidoDetails !== 'object') {
    return { megidoDetails, seededCount: 0 };
  }
  const details = {};
  for (const [id, entry] of Object.entries(megidoDetails)) {
    details[id] = { ...entry, reishou: [...(Array.isArray(entry.reishou) ? entry.reishou : [])] };
  }
  const decided = new Set();
  let seededCount = 0;
  for (const f of formations || []) {
    for (const slot of (f && f.slots) || []) {
      if (!slot || !slot.megidoId) continue;
      if (!Array.isArray(slot.reishouIds) || slot.reishouIds.length === 0) continue;
      const id = slot.megidoId;
      if (decided.has(id)) continue;
      const current = details[id];
      if (!current) continue;
      decided.add(id);
      if (current.reishou.length > 0) continue;
      const ids = [];
      for (const rid of slot.reishouIds) {
        if (typeof rid === 'string' && rid && !ids.includes(rid)) ids.push(rid);
        if (ids.length >= REISHOU_PER_MEGIDO) break;
      }
      if (ids.length === 0) continue;
      details[id] = { ...current, reishou: ids };
      seededCount += 1;
    }
  }
  return { megidoDetails: details, seededCount };
}

// 育成値の掃除（移行規則、2026-11-19）: 専用霊宝・絆霊宝・シンギュラリティは
// 一部のメギドにしか実装されていない（実装有無は基礎データのフラグが正。
// 現行ツールの megido.json 由来）。旧ツールでは全メギドで操作できたため、
// 移行済みの megidoDetails には「実装の無いメギドに値が入っている」ケースが
// ありうる。その値は表示・導出で効かせず、保存値もここで標準値に戻す。
// 戻り値: { megidoDetails, cleanedCount }（cleanedCount は値を戻した件数）
export function sanitizeDetailsByFlags(megidoDetails, megidoBasics) {
  if (!megidoDetails || typeof megidoDetails !== 'object' || !megidoBasics) {
    return { megidoDetails, cleanedCount: 0 };
  }
  const byId = new Map((megidoBasics.megido || []).map((m) => [m.id, m]));
  const details = {};
  let cleanedCount = 0;
  for (const [id, entry] of Object.entries(megidoDetails)) {
    const m = byId.get(id);
    if (!m || !entry || typeof entry !== 'object') {
      details[id] = entry;
      continue;
    }
    const next = { ...entry };
    let changed = false;
    if (!m.specialReishou && next.special_reishou) { next.special_reishou = false; changed = true; }
    // 絆霊宝（4枠）: 掃除の役割は「実装の無いメギドの値を標準値に
    // 戻す」ことだけ。枠の実体化（旧単一値→第1枠）は読みの解決
    // （resolveBondSlots）が担うため、ここでは行わない。
    {
      const slots = normalizeBondSlots(next);
      const mirror = bondMirrorOf(slots);
      if (!m.bondReishou) {
        if (mirror !== 0) {
          next.bond_reishou_slots = [0, 0, 0, 0];
          next.bond_reishou = 0;
          changed = true;
        }
      } else if (Array.isArray(next.bond_reishou_slots)) {
        // 枠の範囲外の値だけを丸める（実体化はしない）。
        const raw = next.bond_reishou_slots;
        const clamped = raw.slice(0, BOND_SLOT_COUNT).map(clampBondValue);
        while (clamped.length < BOND_SLOT_COUNT) clamped.push(0);
        if (JSON.stringify(raw) !== JSON.stringify(clamped)) {
          next.bond_reishou_slots = clamped;
          next.bond_reishou = bondMirrorOf(clamped);
          changed = true;
        }
      }
    }
    if (!m.singularity && next.singularity_level) { next.singularity_level = 0; changed = true; }
    // 凸の範囲は0〜4（段階定義: 凸1スキル++、凸2覚醒スキル++、凸3奥義++、
    // 凸4第2特性解禁）。範囲外の移行値は上限に丸める。
    if (m.singularity && typeof next.singularity_level === 'number' && next.singularity_level > 4) {
      next.singularity_level = 4; changed = true;
    }
    if (changed) cleanedCount += 1;
    details[id] = next;
  }
  return { megidoDetails: details, cleanedCount };
}

// 専用霊宝の標準変更（2026-11-20、メギド登録まわりの再設計）に伴う
// 解決規則。標準は旧「なし」から新「あり」に変わった。保存値の読みは
// 必ずこの関数を通す（保存値を書き換える移行はしない。読みの規則で
// 旧データと新データを両立させる）:
//   - 実装の無いメギド（基礎データのフラグが false）: 常に「なし」。
//   - special_set === true のエントリ: 利用者が新標準の下で明示的に
//     選んだ値（special_reishou）をそのまま使う。「なし」を明示した
//     人を「あり」に戻すことは決してない。
//   - それ以外（エントリが無い／special_set が無い旧データ）: 新標準
//     の「あり」として扱う。旧標準は「なし」だったため、旧データの
//     special_reishou === true は明示的に「あり」にした結果でしか
//     ありえず、この規則でも「あり」になる（一致）。旧データの
//     false は「未設定のまま実体化された値」と「一度ありにしてから
//     なしに戻した値」を保存形式上区別できないため、未設定として
//     扱い新標準（あり）を適用する（移行規則の既知の限界として、
//     後者は新画面で「なし」を選び直せば special_set が付いて固定
//     される）。
export function resolveSpecialReishou(entry, hasSpecialReishou) {
  if (!hasSpecialReishou) return false;
  if (entry && typeof entry === 'object' && entry.special_set === true) {
    return entry.special_reishou === true;
  }
  return true;
}

// 絆霊宝は専用の匣が4枠あり、各枠に真・剛・絆のいずれか1つを付ける
// （2026-11-20 ユーザー確定のゲーム事実）。保存は bond_reishou_slots
// （各枠 0〜3 の配列。0=なし、1〜3=真・剛・絆）に置く。
// 旧モデルは1人につき単一値（bond_reishou、0〜3）だったため、読みの
// 解決はここに一本化する（専用霊宝と同じく、保存値を書き換える移行
// はせず、読みの規則で両立させる）:
//   - bond_reishou_slots が配列のエントリ: 先頭4枠を 0〜3 に丸めて使う。
//   - それ以外（旧単一値だけのエントリ）: 単一値 v（1〜3）を第1枠に
//     入れ、残りを「なし」として扱う。v=0 は全枠なし。
// 絆霊宝の数値効果（型ごとの耐性量など）は正本に無いため、導出では
// 使わない。使うのは「いずれかの枠が埋まっているか」だけ（印の判定）。
export const BOND_SLOT_COUNT = 4;

function clampBondValue(v) {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(0, Math.min(3, Math.trunc(v))) : 0;
}

export function normalizeBondSlots(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  if (Array.isArray(e.bond_reishou_slots)) {
    const slots = e.bond_reishou_slots.slice(0, BOND_SLOT_COUNT).map(clampBondValue);
    while (slots.length < BOND_SLOT_COUNT) slots.push(0);
    if (slots.some((v) => v !== 0)) return slots;
    // 枠が全て空で旧単一値だけが残っている形（旧データが既定値の
    // 正規化を経た場合に生じる）は、単一値を第1枠として扱う。
    // 枠を明示的に全て外した場合は単一値の鏡も 0 になるため、
    // この規則で復活することはない。
    const legacy = clampBondValue(e.bond_reishou);
    if (legacy !== 0) return [legacy, 0, 0, 0];
    return slots;
  }
  const slots = [0, 0, 0, 0];
  slots[0] = clampBondValue(e.bond_reishou);
  return slots;
}

// 旧単一値の読みとの互換のための鏡: 最初に埋まっている枠の値
// （全枠なしなら 0）。「その型を持っている」という旧来の判定は、
// この値が 0 でないことと等価になる。
export function bondMirrorOf(slots) {
  if (!Array.isArray(slots)) return 0;
  for (const v of slots) if (v) return v;
  return 0;
}

export function resolveBondSlots(entry, hasBondReishou) {
  if (!hasBondReishou) return [0, 0, 0, 0];
  return normalizeBondSlots(entry);
}

// megidoDetails の1件を、確定したフィールドとデフォルトで正規化する。
// special_reishou の生値は旧標準（なし）で補完するが、意味の解決は
// resolveSpecialReishou が担う（生値 false は「未設定」を含むため、
// この関数の補完値だけで判断してはいけない）。special_set は新標準の
// 下で利用者が明示的に専用霊宝を選んだ印で、往復で保持する。
// 絆霊宝は bond_reishou_slots（4枠）が正で、bond_reishou は旧単一値
// の読みとの互換のための鏡（最初に埋まっている枠の値）として
// 枠から作り直す。旧単一値だけのエントリは第1枠へ移行する。
export function normalizeMegidoDetail(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const bondSlots = normalizeBondSlots(e);
  return {
    owned: e.owned === true,
    level: typeof e.level === 'number' ? e.level : 70,
    ougiLevel: typeof e.ougiLevel === 'number' ? e.ougiLevel : 3,
    special_reishou: e.special_reishou === true,
    special_set: e.special_set === true,
    bond_reishou: bondMirrorOf(bondSlots),
    bond_reishou_slots: bondSlots,
    singularity_level: typeof e.singularity_level === 'number' ? e.singularity_level : 0,
    reishou: Array.isArray(e.reishou) ? [...e.reishou] : [],
  };
}

// 育成フィールド1件の書き込み（純粋関数）: エントリを受けて、項目を
// 検証・丸めて反映した新しいエントリを返す。受け付けない書き込み
// （実装の無い項目・範囲外）は null を返す。専用霊宝の書き込みでは
// special_set（明示の印）も同時に立てる。基礎データのフラグ判定は
// 呼び出し側ではなく basicsEntry で渡す（このモジュールは基礎データ
// の形に依存しない）。
export function withMegidoField(entry, field, value, basicsEntry) {
  const next = { ...(entry && typeof entry === 'object' ? entry : {}) };
  if (field === 'level') {
    if (![70, 75, 77, 79, 80].includes(value)) return null;
    next.level = value;
  } else if (field === 'ougiLevel') {
    if (!Number.isFinite(value)) return null;
    next.ougiLevel = Math.max(1, Math.min(99, Math.trunc(value)));
  } else if (field === 'special_reishou') {
    if (!basicsEntry || !basicsEntry.specialReishou) return null;
    next.special_reishou = value === true;
    next.special_set = true;
  } else if (field === 'bond_reishou') {
    if (!basicsEntry || !basicsEntry.bondReishou) return null;
    // 値は4枠の配列（各 0〜3）が正。旧来の単一値（数値）で来た場合は
    // 第1枠への移行として受ける（移行マトリクスと同じ規則）。
    if (Array.isArray(value)) {
      next.bond_reishou_slots = normalizeBondSlots({ bond_reishou_slots: value });
    } else if (Number.isFinite(value)) {
      next.bond_reishou_slots = normalizeBondSlots({ bond_reishou: value });
    } else {
      return null;
    }
    next.bond_reishou = bondMirrorOf(next.bond_reishou_slots);
  } else if (field === 'singularity_level') {
    if (!basicsEntry || !basicsEntry.singularity) return null;
    if (!Number.isFinite(value)) return null;
    // 凸は0〜4（再召喚4回目で第2特性の解禁が最後）。
    next.singularity_level = Math.max(0, Math.min(4, Math.trunc(value)));
  } else {
    return null;
  }
  return next;
}

// 絆霊宝の一括割り振り（純粋関数）: 型（1〜3）を「選んだ枠」に
// 上書きする（2026-11-21 ユーザー指示。当初の「最初の空き枠へ」→
// 「4枠すべて」→「枠を選んで上書き」の順で確定）。targetSlots は
// 4要素の真偽（省略時は4枠すべて）。値 0 は選んだ枠を「なし」に
// 戻すクリア。戻り値の status:
//   'applied'  … 変更が入った
//   'unchanged'… 変更が無かった（選んだ枠が既に同じ型／クリア済み等）
//   null       … 絆霊宝の実装が無い／値が不正で受け付けない
export function withBondBulk(entry, value, basicsEntry, targetSlots = null) {
  if (!basicsEntry || !basicsEntry.bondReishou) return null;
  if (!Number.isFinite(value)) return null;
  const v = Math.max(0, Math.min(3, Math.trunc(value)));
  const slots = normalizeBondSlots(entry && typeof entry === 'object' ? entry : {});
  const targets = Array.isArray(targetSlots) && targetSlots.length === 4
    ? targetSlots.map(Boolean)
    : [true, true, true, true];
  if (!targets.some(Boolean)) return { entry, status: 'unchanged' };
  const nextSlots = slots.map((s, i) => (targets[i] ? v : s));
  if (nextSlots.every((s, i) => s === slots[i])) return { entry, status: 'unchanged' };
  const next = {
    ...(entry || {}),
    bond_reishou_slots: nextSlots,
    bond_reishou: bondMirrorOf(nextSlots),
  };
  return { entry: next, status: 'applied' };
}

// getItem: (key) => string | null（localStorage.getItem 相当。読み取り専用）
// 戻り値: { found, formations, megidoDetails, summary }
//   found: 旧キーが1つでも存在したか
//   summary: { formations: 件数, megidoEntries: 件数, owned: 所持数, failed: [キー名] }
export function migrateFromOldStorage(getItem) {
  const summary = { formations: 0, megidoEntries: 0, owned: 0, failed: [], reishouSeeded: 0 };
  let formations = [];
  let megidoDetails = null;
  let found = false;

  const rawFormations = safeGet(getItem, OLD_KEY_FORMATIONS);
  if (rawFormations != null) {
    found = true;
    const parsed = safeParse(rawFormations);
    if (parsed === undefined) {
      summary.failed.push(OLD_KEY_FORMATIONS);
    } else if (Array.isArray(parsed)) {
      formations = parsed.map((f, i) => normalizeFormation(f, `migrated-${i + 1}`)).filter(Boolean);
    } else if (parsed && typeof parsed === 'object') {
      formations = Object.entries(parsed)
        .map(([key, f], i) => normalizeFormation(f && typeof f === 'object' ? { id: key, ...f } : f, `migrated-${i + 1}`))
        .filter(Boolean);
    }
    summary.formations = formations.length;
  }

  const rawDetails = safeGet(getItem, OLD_KEY_MEGIDO_DETAILS);
  if (rawDetails != null) {
    found = true;
    const parsed = safeParse(rawDetails);
    if (parsed === undefined) {
      summary.failed.push(OLD_KEY_MEGIDO_DETAILS);
    } else if (parsed && typeof parsed === 'object') {
      megidoDetails = {};
      for (const [id, entry] of Object.entries(parsed)) {
        megidoDetails[id] = normalizeMegidoDetail(entry);
      }
      summary.megidoEntries = Object.keys(megidoDetails).length;
      summary.owned = Object.values(megidoDetails).filter((d) => d.owned).length;
    }
  }

  // 霊宝の装備はメギド側が正: 編成の枠の reishouIds から種付けする。
  if (megidoDetails) {
    const seeded = seedReishouFromFormations(formations, megidoDetails);
    megidoDetails = seeded.megidoDetails;
    summary.reishouSeeded = seeded.seededCount;
  }

  return { found, formations, megidoDetails, summary };
}

function safeGet(getItem, key) {
  try {
    return getItem(key);
  } catch {
    return null;
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
