// 味方メギドのステータス解決（単一の入口）
// 基礎データ（megido-basics.v1.json）の statsStar6 は星6・Lv70 の値。
// 保存レベルが 75/77/79/80 の人には、魔重解放の段階表の上昇分を
// ここで加算する。味方のステータスを参照する画面・計算はすべて
// この解決を通す（素早さ・攻撃力・探索力・受けダメージ見積もり等）。
// レベルを参照する「計算式」（点穴・ハイドロボム等）の Lv は
// ここではなく mechanics.js の formulaLevel（70固定）が担う。
// 解禁判定のような「保存レベルそのもの」を見る用途もここは関与しない。

// 魔重解放の段階表（2026-11-20 ユーザー提示）: 段階ごとの上限レベルと、
// その段階での追加分。列はゲームの標準ステータス順
// HP／攻撃力／防御力／素早さ（素早さは加算なし）。
// 各段階の数値は「その段階での追加分」で、到達した段階までの累積で
// 適用する（Lv75=段階1、Lv77=段階1+2、Lv79=段階1+2+3、
// Lv80=全部で HP+600／攻撃+70／防御+70／素早さ+0）。
export const MAJUU_STAGE_BONUS = [
  { level: 75, hp: 210, atk: 25, def: 25, spd: 0 },
  { level: 77, hp: 170, atk: 18, def: 18, spd: 0 },
  { level: 79, hp: 130, atk: 16, def: 16, spd: 0 },
  { level: 80, hp: 90, atk: 11, def: 11, spd: 0 },
];

// 保存レベルまでに到達した魔重段階の上昇分の累積。Lv70 以下は加算なし
// （従来と完全一致）。到達の判定は「保存レベルがその段階の上限以上」。
export function majuuBonusForLevel(savedLevel) {
  const total = { hp: 0, atk: 0, def: 0, spd: 0 };
  if (typeof savedLevel !== 'number' || !Number.isFinite(savedLevel)) return total;
  for (const stage of MAJUU_STAGE_BONUS) {
    if (savedLevel >= stage.level) {
      total.hp += stage.hp;
      total.atk += stage.atk;
      total.def += stage.def;
      total.spd += stage.spd;
    }
  }
  return total;
}

// そのメギドの保存レベル（megidoDetails の level）。未設定は 70。
export function savedLevelOf(megidoDetails, megidoId) {
  const entry = megidoDetails && megidoDetails[megidoId];
  return entry && typeof entry.level === 'number' ? entry.level : 70;
}

// 基礎ステータス（Lv70）に魔重の上昇分を足した実効ステータス。
// 基礎データにステータスが無い場合は null。
export function resolveMegidoStats(basicsEntry, savedLevel) {
  if (!basicsEntry || !basicsEntry.statsStar6) return null;
  const base = basicsEntry.statsStar6;
  const bonus = majuuBonusForLevel(savedLevel);
  return {
    hp: base.hp + bonus.hp,
    atk: base.atk + bonus.atk,
    def: base.def + bonus.def,
    spd: base.spd + bonus.spd,
  };
}
