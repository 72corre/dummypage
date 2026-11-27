// 静的データの読み込み（tech-foundation.md 第5節）
// 起動時に読むのは、塔の構造とメギド基礎と、今いる階の敵の事実まで。
// 階ごとの敵データは、その階を表示する時に読む（キャッシュする）。

export const DATA_VERSION = 1;

export function createDataLoader(baseUrl, fetchFn) {
  const doFetch = fetchFn || ((url) => fetch(url));
  const cache = new Map();
  const load = (path) => {
    if (!cache.has(path)) {
      cache.set(
        path,
        doFetch(`${baseUrl}${path}`).then((res) => {
          if (!res.ok) throw new Error(`データの読み込みに失敗しました: ${path} (${res.status})`);
          return res.json();
        }),
      );
    }
    return cache.get(path);
  };
  return {
    // 起動時に読む一式。
    async loadCore() {
      const [structure, megidoBasics] = await Promise.all([
        load(`tower-structure.v${DATA_VERSION}.json`),
        load(`megido-basics.v${DATA_VERSION}.json`),
      ]);
      return { structure, megidoBasics };
    },
    // 階ごとの敵の事実（その階を開いた時に読む）。
    loadFloorEnemies(floor) {
      const name = `enemies/floor-${String(floor).padStart(2, '0')}.v${DATA_VERSION}.json`;
      return load(name);
    },
    // メギド詳細の原文（詳細を開いた時にだけ読む）。
    loadAbility(megidoId) {
      return load(`abilities/${encodeURIComponent(megidoId)}.v${DATA_VERSION}.json`);
    },
    // オーブマスタ（orbId → 名前。編成の確認表示で使う）。
    loadOrbs() {
      return load(`orbs.v${DATA_VERSION}.json`);
    },
    // 横断検索の効果文索引（検索ビューを開く時にだけ読む。生成は
    // pipeline/generate-search-index.mjs、照合は js/search.js）。
    loadSearchIndex() {
      return load(`search-index.v${DATA_VERSION}.json`);
    },
    // 手段の索引（M4〜M7・H6。シートや編成の画面を開く時にだけ読む）。
    loadMeansIndex() {
      return load(`means-index.v${DATA_VERSION}.json`);
    },
    // 対策クラスの知識データ（M4）。
    loadCounterClasses() {
      return load(`counter-classes.v${DATA_VERSION}.json`);
    },
    // マスエフェクト全272体分（M6 の適合表示・M8 の要約）。
    loadMeData() {
      return load(`me.v${DATA_VERSION}.json`);
    },
    // 非直観的な仕組みの注記の検出結果（M6 の候補注記。能力原文への
    // キーワード検出で生成した、メギドID → 注記キーの対応）。
    loadMechanicNotes() {
      return load(`mechanic-notes.v${DATA_VERSION}.json`);
    },
    // 実効素早さの補正材料（ラウンドB。特性とオーブの無条件の補正。
    // 生成は pipeline/generate-speed.mjs、原文への機械検出）。
    loadSpeedCorrections() {
      return load(`speed-corrections.v${DATA_VERSION}.json`);
    },
    // チェインの材料（ラウンドB。始動・中継・回数チェイン付与・
    // 自身チェイン・倍率役と条件。生成は pipeline/generate-chain.mjs）。
    loadChain() {
      return load(`chain.v${DATA_VERSION}.json`);
    },
    // フォトンの供給材料（2026-11-19 調整フライト。種別の特定できる
    // フォトン追加とフォトン容量の上昇。生成は
    // pipeline/generate-photon.mjs、原文への機械検出）。
    loadPhotonSupply() {
      return load(`photon-supply.v${DATA_VERSION}.json`);
    },
    // Hボムプランナーのボム行動の索引（2026-11-19 実装フライト。
    // 生成は pipeline/generate-hbomb.mjs、コーパスへの機械検出）。
    loadHbomb() {
      return load(`hbomb.v${DATA_VERSION}.json`);
    },
    // 狂炎シミュレーターの材料の索引（2026-11-19 実装フライト。
    // 生成は pipeline/generate-kyoen.mjs、コーパスへの機械検出）。
    loadKyoen() {
      return load(`kyoen.v${DATA_VERSION}.json`);
    },
    // 戦旗の保持者一覧（2026-11-20 実装フライト。生成は
    // pipeline/generate-flag.mjs、正本は corpus-status/戦旗.json）。
    loadFlag() {
      return load(`flag.v${DATA_VERSION}.json`);
    },
    // 受けダメージ見積もりの軽減材料（2026-11-20 積4。特性と
    // オーブの無条件の割合軽減だけを原文から抽出。生成は
    // pipeline/generate-damage-reduction.mjs）。
    loadDamageReduction() {
      return load(`damage-reduction.v${DATA_VERSION}.json`);
    },
    // 脅威レベルの下書き段階づけ（2026-11-20 敵シート作り直し。
    // 基準はアンケート後に差し替える前提で、決め方は生成器
    // pipeline/generate-threat-levels.mjs にだけある。アプリは
    // 段階を読むだけ）。
    loadThreatLevels() {
      return load(`threat-levels.v${DATA_VERSION}.json`);
    },
    // 敵の行動の3役分類（2026-11-26 攻略のポイント再構成。決め方は
    // 生成器 pipeline/generate-enemy-roles.mjs にだけある。アプリは
    // 度合いと主役を読むだけ）。
    loadEnemyRoles() {
      return load(`enemy-roles.v${DATA_VERSION}.json`);
    },
    // 霊宝マスタ（reishouId → 名前・系譜・効果・ステータス修正値・大きさ。
    // 装備の表示と選択、探索力の計算で使う）。
    loadReishou() {
      return load(`reishou.v${DATA_VERSION}.json`);
    },
    // 著述データ（M4。ボスは著述＋Wiki照合済み、通常敵も同形式）。
    // 著述のある敵では導出より著述を正とする。
    loadBossTactics() {
      return load(`boss-tactics.v${DATA_VERSION}.json`);
    },
    loadEnemyTactics() {
      return load(`enemy-tactics.v${DATA_VERSION}.json`);
    },
  };
}
