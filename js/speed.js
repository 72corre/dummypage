// 実効素早さ（ラウンドB、2026-11-19）
// ゲームの編成画面には補正後の素早さが出ないため、基礎値に補正を
// 加えた実効値をツールが計算する。計算に入れるのは、編成時点で
// 確定する分だけ:
//   - 霊宝の固定値（reishou.v1.json の stats。装備はメギド側が正）と
//     割合%（speed-corrections の reishou 節。stats に載らない分を
//     原文から機械検出。装備の個数分だけ合算する）
//   - 特性の無条件の割合（speed-corrections。原文への機械検出で、
//     状態や蓄積で変わる分は数えない）
//   - オーブの割合（同上。オーブのレベルはツールが持たないため、
//     「オーブは基本育っている方で計算する」というユーザー裁定
//     （2026-11-19）により最大強化時の値で数え、内訳には
//     最大強化前提である旨を併記する）
//   - マスエフェクトの割合（リーダーの枠効果のうち、その枠の
//     メンバーに効く「素早さがX%上昇する」。下記 meSpeedPct）
//   - コンディションの補正（counter.js の effectiveSpd と同じ範囲:
//     絶不調のときだけ半分。それ以外の段階の補正は要件の範囲外）
// 合成の順序: （基礎＋霊宝）を割合の合計で割り増しし、最後に
// コンディション。割合は特性・オーブ・マスエフェクトを合算する
// （ゲーム内の割合補正の合算と同じ前提。原文に合算の例外はない）。
// 数えられない補正（条件つきの特性やオーブ、徐々に上がる分等）は、
// 無いものとして扱い、内訳の併記で分かる形にする。推測で補正は
// しない。性別条件のマスエフェクトは、基礎データに性別が入った
// ため（2026-11-19、性別表が正本）メンバーの性別で判定する。

import { ME_SLOT_KEYS } from './counter.js';

// マスエフェクトの枠効果から、その枠のメンバーに効く素早さの
// 割合を読む。me は「その編成で実際に効く ME」単体（{ slots }）:
// サブマスエフェクトが発生する編成では、呼び出し側が3行目を
// サブMEで上書きした ME を渡す（counter.js の subMeOccurrence /
// meWithSubOverwrite）。リーダー本人のサブMEは発生しないため、
// ここで主MEと並べて読むことはしない。照合の規則は counter.js
// の summarizeMeEffects と同じ: 条件を '+' で割り、各部分が
// メンバーのスタイル・クラス・性別に合えば効いている。効果文が
// 「素早さがX%上昇する」の形に一致する分だけを数えるため、
// 「徐々に」等の変動する分と、敵への低下は入らない。性別は
// 基礎データ（性別表が正本）から引く。member に gender が無い
// 場合だけ、性別条件は照合できず、効くものとして数えた上で
// 印を返す（呼び出し側が内訳に併記する）。
export function meSpeedPct(me, member, slotIndex) {
  if (!me || !member) return null;
  const slotKey = ME_SLOT_KEYS[slotIndex];
  if (!slotKey) return null;
  let pct = 0;
  let genderUnverified = false;
  let found = false;
  const entries = me.slots ? me.slots[slotKey] : null;
  if (!Array.isArray(entries)) return null;
  for (const e of entries) {
    if (!e || typeof e.effect !== 'string') continue;
    const m = e.effect.match(/^素早さが(\d+)%上昇する。?$/);
    if (!m) continue;
    const parts = String(e.condition || '').split(/[+＋]/).map((s) => s.trim()).filter(Boolean);
    const genders = parts
      .map((p) => (p === '男性' || p === '男' ? '男性' : p === '女性' || p === '女' ? '女性' : null))
      .filter(Boolean);
    const known = parts.filter((p) => p !== '男性' && p !== '女性' && p !== '男' && p !== '女' && p !== '-');
    if (!known.every((p) => p === member.style || p === member.className)) continue;
    if (genders.length > 0) {
      if (member.gender) {
        if (!genders.every((g) => g === member.gender)) continue;
      } else {
        genderUnverified = true;
      }
    }
    pct += parseInt(m[1], 10);
    found = true;
  }
  if (!found) return null;
  return { pct, genderUnverified };
}

// 装備中の霊宝の素早さ割合%の合計。equippedIds は装備の正（メギド
// 側の霊宝IDの配列）で、同じ霊宝を複数枠に付けていれば個数分だけ
// 数える（固定値の合算＝reishouStatMods と同じ作法）。reishouCorr は
// speed-corrections の reishou 節（霊宝ID → { pct, source }）。
// 材料が無い・装備が無ければ 0。
export function reishouSpdPct(equippedIds, reishouCorr) {
  if (!Array.isArray(equippedIds) || !reishouCorr) return 0;
  let pct = 0;
  for (const id of equippedIds) {
    const rec = reishouCorr[id];
    if (rec && typeof rec.pct === 'number') pct += rec.pct;
  }
  return pct;
}

// 素早さの敵比較（2026-11-19）: 味方の実効素早さと敵の素早さ
// （マスルール適用後）から、敵最速と味方各人の関係を出す純関数。
// 「敵との素早さを見てオーブを変えたい」というニーズの材料で、
// 編成エディタのオーブ選択と、戦闘マスの開始前確認（最終チェック）
// で同じ物差しを使う。同速は先手に数えない（厳密に速い場合だけを
// 「抜いている」とする）。
// allies / enemies は [{ name, spd }]（spd が数値でない行は除く）。
// 敵にも味方にも数値が無ければ null。
export function compareSpeeds({ allies = [], enemies = [] } = {}) {
  const es = enemies.filter((e) => e && typeof e.spd === 'number');
  const as = allies.filter((a) => a && typeof a.spd === 'number');
  if (es.length === 0 || as.length === 0) return null;
  const fastest = es.reduce((m, e) => (e.spd > m.spd ? e : m), es[0]);
  return {
    fastestName: fastest.name,
    fastestSpd: fastest.spd,
    ahead: as.filter((a) => a.spd > fastest.spd).map((a) => a.name),
    tied: as.filter((a) => a.spd === fastest.spd).map((a) => a.name),
    behind: as.filter((a) => a.spd < fastest.spd).map((a) => a.name),
  };
}

// 「敵最速」の行の文（開始前確認とオーブピッカーで同じ文を出す。
// fastest は { fastestName, fastestSpd } を持つ材料）。
export function enemyFastestText(fastest) {
  return `敵最速: ${fastest.fastestName}（素早さ${fastest.fastestSpd}）`;
}

// 実効素早さの合成。pctParts は [{ label, pct, note? }]（ラベルは
// 内訳の併記用）。戻り値は { value, lines, parts, pctSum }、基礎値が
// 数値でなければ null。parts は lines と同じ並びの構造化した内訳で、
// 各要素に変化の向き（dir: 'up' | 'down' | null）を持つ。表示側は
// これを使って補正ごとに↑↓と色を付ける（基礎は向きなし、割合0の
// 補正も向きなし）。
export function effectiveSpeed({ base, stage = 0, reishouFlat = 0, pctParts = [] }) {
  if (typeof base !== 'number') return null;
  const pctSum = pctParts.reduce((s, p) => s + (p.pct || 0), 0);
  let value = Math.floor((base + reishouFlat) * (1 + pctSum / 100));
  const lines = [`基礎${base}`];
  const parts = [{ text: lines[0], dir: null }];
  if (reishouFlat) {
    const text = `霊宝${reishouFlat > 0 ? '+' : ''}${reishouFlat}`;
    lines.push(text);
    parts.push({ text, dir: reishouFlat > 0 ? 'up' : 'down' });
  }
  for (const p of pctParts) {
    const text = `${p.label}${p.pct >= 0 ? '+' : ''}${p.pct}%${p.note ? `（${p.note}）` : ''}`;
    lines.push(text);
    parts.push({ text, dir: p.pct > 0 ? 'up' : p.pct < 0 ? 'down' : null });
  }
  if (stage === 4) {
    value = Math.floor(value * 0.5);
    lines.push('絶不調で半分');
    parts.push({ text: '絶不調で半分', dir: 'down' });
  }
  return { value, lines, parts, pctSum };
}
