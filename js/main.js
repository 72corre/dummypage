// 起動と配線（土台スライス）
// 流れ: 永続化の要求 → 保存の読み込み →（初回なら）旧データの移行 →
//       静的データ（構造・基礎・今いる階の敵）→ 導出 → 描画。
// 状態は操作履歴から都度導出し、履歴が変わるたびに保存して描き直す。

import { createDataLoader } from './data.js';
import { slotShortName } from './shortnames.js';
import {
  idbBackend, memoryBackend, requestPersist,
  loadRun, saveRun, loadFormationsData, saveFormationsData,
  loadRecords, saveRecords,
  loadSettings, saveSettings, loadMeta, saveMeta,
  exportAll, importAll, exportFileName, STORE_NAMES,
} from './store.js';
import { createHistory, currentOps, applyOp, undo, redo, canUndo, canRedo } from './model.js';
import {
  deriveRun, floorData, floorBattleRule, squareState, floorReached,
  nextRecoveries, towerOutlook, styleUsage, nextSquareId, squareHistory, recoveryOutcomeFor, squareDef,
  validateOps, buffOutcomeFor, unlockGuidance,
  PACE_MIN_CLEARED_FLOORS,
  BUFF_SUBTYPES, BUFF_STAT_BY_SUBTYPE, BUFF_STAT_LABEL, BUFF_CAPS,
  CONDITION_STAGES, STYLE_ORDER, STYLE_NAME, STYLE_CODE, STAGE_FAINTED,
  dmgTypeBreakdown,
} from './derive.js';
import {
  runEntries, archiveRun, aggregateRecords, paceBreakdown, closedDayText,
  formationBattleCounts, inclusiveDays, reachedFloorOf, megidoUsage,
} from './records.js';
import {
  buildRecordsView, buildMegidoView, buildMegidoDetailSheet, buildMidRunView,
  buildImportConfirmView, buildCloseMonthConfirmView,
  buildResetConfirmView,
  buildSearchView, buildFaceCardView, buildOrbDetailSheet,
} from './panels.js';
import {
  prepareSearchIndex, searchAbilityRows, searchOrbRows, searchMeRows,
} from './search.js';
import { normalizeMegidoDetail, resolveSpecialReishou, withMegidoField } from './migrate.js';
import {
  migrateFromOldStorage, seedReishouFromFormations, sanitizeDetailsByFlags,
  REISHOU_PER_MEGIDO, resolveBondSlots, withBondBulk,
} from './migrate.js';
import { resolveMegidoStats, savedLevelOf } from './stats.js';
import {
  renderTabBar, renderStateFooter, renderMap, renderFloorSwitch, createOverlay,
  floorListContent, conditionContent, squareLabel, EXPLORE_LABEL,
  recoveryRemainingText,
} from './views.js';
import {
  planExploration, evaluateCombo, exploreCandidates, EXPLORE_PARTY_MAX,
  expectationOutlook, expectationOutlookNote, styleFatigueSkew, BOXES_BY_EXPECTATION,
  planExplorationCandidates, expectationStrip, osusumeActive, nextOsusume, exploreAfterStage,
  reishouStatMods, resultFormVm, emptyResultForm, resultFormFromOp, ougiLevelOf,
} from './explore.js';
import {
  buildIndex, classesById, threatsForSquare, candidatesForClass, classApplies,
  formationCoverage, aggregateDemand, demandWeight, demandEarliestFloor, METHOD_LABEL,
  buildTacticsIndex, authoredEntryFor, authoredCoverage, authoredPairCoverage,
  formationCoverageDetail, authoredPairCoverageDetail, bestResistMember,
  coveredByShortName, gimmickBadge,
  candidateText, annotateAuthoredTactic, mediaShortForVia, effectiveSpd,
  threatsForEnemy,
  enemyThreatsUnified, threatAnswerBlocks, pickerAnswersForEnemy, threatSourceSpds, threatUnitNotes,
  floorTopThreatLabel,
  answerReasonLines, answerMarkLabel, meFitReasonLines, demandReasonLines,
  authoredOverallBlocks, authoredTacticDemandWarnings, derivedThreatsAsItems, resistanceProvenanceOf, authoredSummaryText,
  prepareSheetEntries, recomposeSheetAnswerBlocks, mergeSheetPoints,
  sheetPairGroupKey, sheetOverallGroupKey, fixedDamageBlocks,
  candidateUsable, isRestrictedDef, restrictionOf, RESTRICTION_31F, viaNeedLevel,
  classifyProseTactic, demandRangeEndFloor, normalizePoleName,
  summarizeMeEffects, ME_SLOT_KEYS, meSlotConditions, meSlotMatches, meRowFits,
  meConditionVerdict, subMeOccurrence, meWithSubOverwrite, meWithoutThirdRow,
  flagCheckFor,
} from './counter.js';
import {
  mechanicNoteLines, kabauPartyNotes, enemyMechanicNotes,
  tranceFamiliesInFormation, tranceConflictLines,
  tenanaVsEnemyLines, erekiVsEnemyLines, enemyReceivingNotes,
  hbombCalibrationLines, hbombCalibrationOf,
  auraOrbRacesFor, kyousouStarterInFormation,
  isNoteMakerMegido, isNoteMakerOrb,
  tenanaHolderLines, erekiApplierLines, erekiGrowerLine, erekiGrowerOrbLine,
  formulaLevel,
  isshinCapBonus, chiretsuDamagePct,
  hadanDamage, hadanFactor, goukenLines,
  enemyAttackEstimates, asmodeusThreshold,
  densetsuThreshold, densetsuNeeded, DENSETSU_MAX,
  reishou4TraitName, reishou4Active,
  estimateFalls, conditionAdjustedStats, meDamageReductions,
  parseEnemyAttackList, pickAbilityForms, tokkoFactorFromSentence,
  inflictableStates, estimateOutgoing,
} from './mechanics.js';
import { meSpeedPct, effectiveSpeed, compareSpeeds, reishouSpdPct, enemyFastestText } from './speed.js';
import {
  hasChainRole, partyHasChainGrant, chainOriginEligibility, simulateChain,
  buildTimeline, chainCutInTarget,
  chainWayKey, chainActionOptions, isGrantLinkKind,
} from './chain.js';
import { buffWorth, battleWorth, remainingRoute, styleBuffText } from './worth.js';
import {
  formationHasBombActions, formationHasWeakAction, isTypesOnlyOverall,
  memberActions, emptyField, checkAction, applyAction, effectiveAction,
  actionHasEffectAtAnyLevel,
  removeBomb, removeDebuff, previewDetonation, solveComposition, buildReplayCtx, replayHands,
  probeHand, solveSequence, formationLayout, bombKindLabel, targetsOf,
} from './hbomb.js';
import {
  createSim as kyoenCreateSim, applyFireAction as kyoenApplyFire,
  applySetupAction as kyoenApplySetup, extendTerrain as kyoenExtend,
  endTurn as kyoenEndTurn,
  undoTurn as kyoenUndo, forecast as kyoenForecast,
  conclusionText as kyoenConclusion, nextTerrainDamage as kyoenNextDamage,
  registerReserve as kyoenRegisterReserve, applyOverwrite as kyoenApplyOverwrite,
  applyGroundAction as kyoenApplyGround,
  armDelayed as kyoenArmDelayed, disarmDelayed as kyoenDisarmDelayed,
  delayedCountNow as kyoenDelayedCount, delayedReps as kyoenDelayedReps,
  actionLevel as kyoenLevelOf, leveledAction as kyoenLeveled,
  bumpLevel as kyoenBump, useLeveledAction as kyoenUse,
  formOf as kyoenFormOf, applyShift as kyoenShift,
  skillShifted as kyoenSkillShifted, applySkillShift as kyoenApplySkillShift,
  directHitDamage as kyoenDirectHit,
  rowOfEnemy as kyoenRowOf, KYOEN_CORRECTION, CONVERTER_LEVEL as KYOEN_LEVEL,
} from './kyoen.js';
import {
  basicsById, formationMembers, styleComposition, worstStageOf,
  formationUsability, compareFormationRows, orbEquippableBy, normalizeSearchText,
  emptySlots, canSaveFormation, slotCandidates, SLOT_LABELS,
  formationPlans, PLAN_AVOID_WEIGHT, formationOverlaps,
  normalizeTags, customTagTexts, parseCustomTags, buildFormationTags,
  buildAutoTags,
  autoFormationName, copyFormationRecord, formationMatchesQuery,
  floorsForEnemy, allEnemyNames, formationTargetFloors,
} from './formations.js';
import {
  buildSquareSheet, buildFormationList, buildExploreCandidates,
  buildDeleteFormationConfirm, buildMemoEditor,
} from './sheet.js';
import {
  buildFormationEditor, buildFormationNameStep, buildSlotCandidates, buildOrbPicker,
  buildEnemyPicker, buildReishouPicker, buildHbombDebuffPopup,
  buildKyoenAllocPopup, buildKyoenCounterPopup, buildChainPhotonPopup,
} from './builder.js';

const DATA_BASE = './data/';

// ローカル日付の年月キー（月の締めと月替わりの検出用）。
function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function boot() {
  const viewEl = document.getElementById('view');
  const stateEl = document.getElementById('statebar');
  const tabbarEl = document.getElementById('tabbar');
  const panesEl = document.getElementById('panes');
  const mapPaneEl = document.getElementById('mappane');
  // 検索ビューが × やシート外タップで閉じられた時にも、検索の文脈を
  // 落としてタブバーの現在地（区画の四角の色）を戻すための口。
  const overlay = createOverlay(document.getElementById('overlay-root'), {
    onClose: () => {
      if (searchCtx) searchCtx = null;
      renderNav();
    },
  });

  // デスクトップ対応（1024px 以上で2ペイン）: 判定はレイアウト専用で、
  // 機能の分岐には使わない。matchMedia の無い環境（検証スタブ等）では
  // 常に狭い画面として扱い、従来の描画経路のままにする。
  const desktopMQ = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia('(min-width: 1024px)')
    : null;
  const isDesktop = () => Boolean(desktopMQ && desktopMQ.matches);

  // ---- スクロール位置の保持（再描画で上に戻される問題への対処） ----
  // 区画ビューは再描画で #view の中身を作り直すため、スクロール位置が
  // 毎回失われていた。表示中の文脈キーごとに位置を随時控え、描画後に
  // 戻す。線引き: 同じ文脈のままの再描画では保持し、文脈が変わる操作
  // （タブ切り替え・階切り替え・別の表示を開く）では先頭に戻す。
  // シート／全画面ビューの本文は views.js の createOverlay が
  // extras.scrollKey で同じ仕組みを持つ。全体の線引きは
  // build/app/README.md のスクロール保持の記録に置く。
  let ctxSeq = 0; // 文脈の世代カウンタ（開くたびに新しい文脈）
  const viewScrollMem = new Map(); // #view／ウィンドウの文脈キー → scrollTop
  const paneScrollMem = new Map(); // マップペインの階 → scrollTop
  let viewScrollKey = null; // いま #view（狭い画面ではウィンドウ）に表示中の文脈キー
  let paneScrollFloor = null; // いまマップペインに表示中の階
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('scroll', () => {
      if (viewScrollKey != null) viewScrollMem.set(viewScrollKey, window.scrollY || 0);
    }, { passive: true });
  }
  viewEl.addEventListener('scroll', () => {
    if (viewScrollKey != null) viewScrollMem.set(viewScrollKey, viewEl.scrollTop || 0);
  }, { passive: true });
  if (mapPaneEl) {
    mapPaneEl.addEventListener('scroll', () => {
      if (paneScrollFloor != null) paneScrollMem.set(paneScrollFloor, mapPaneEl.scrollTop || 0);
    }, { passive: true });
  }
  // #view（狭い画面ではウィンドウ全体）の表示文脈を key に切り替え、
  // 控えた位置があれば戻し、無ければ先頭に戻す（新しい文脈は先頭から）。
  const applyViewScroll = (key) => {
    viewScrollKey = key;
    const saved = key != null ? viewScrollMem.get(key) : null;
    const top = typeof saved === 'number' ? saved : 0;
    viewEl.scrollTop = top;
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, top);
    }
  };

  await requestPersist();

  let backend;
  try {
    backend = typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend();
    // 実際に開けるか確認する（開けない環境ではメモリへ落とす）。
    await backend.keys('state');
  } catch {
    backend = memoryBackend();
  }

  const loader = createDataLoader(DATA_BASE);
  const { structure, megidoBasics } = await loader.loadCore();

  const savedRun = await loadRun(backend);
  let history = savedRun ? createHistory(savedRun.ops, savedRun.cursor) : createHistory();
  // 顔見せカードの表示済みの階（SW90）: ランの付帯として保存し、
  // ランが替わる（締め・途中開始・読み込み・リセット）たびに付け替える。
  let faceShownFloors = new Set(
    savedRun && Array.isArray(savedRun.faceShownFloors) ? savedRun.faceShownFloors : [],
  );
  // マスに残す編成（SW91）: シートで編成を選ぶとここに残り、シートを
  // 開き直しても（再読み込み後も）その編成が表示され、勝敗の記録は
  // その編成に結びつく。顔見せと同じくランの付帯として保存する
  // （操作履歴には含めない）。
  // 保持単位（全体構成 問題16、2026-11-27）: 複数種が同居するマスでは
  // 敵グループ（種）ごとに保持する。保存形はマスID → { legacy, groups }。
  // legacy は版165までの保存形（マスID → 編成ID の文字列）から引き
  // 継いだ「マスの編成」で、グループ別の指定が無い種ではこれが効く
  // （移行で旧データの編成は失われない）。groups は種名 → 編成IDで、
  // null は「その種では編成を外した」の明示（legacy へは戻らない）。
  function normalizeKeptEntry(value) {
    if (typeof value === 'string' && value) return { legacy: value, groups: {} };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const groups = {};
      if (value.groups && typeof value.groups === 'object') {
        for (const [k, v] of Object.entries(value.groups)) {
          if (typeof v === 'string' && v) groups[k] = v;
          else if (v === null) groups[k] = null;
        }
      }
      return {
        legacy: typeof value.legacy === 'string' && value.legacy ? value.legacy : null,
        groups,
      };
    }
    return { legacy: null, groups: {} };
  }
  function keptMapFrom(saved) {
    const map = new Map();
    for (const [sq, v] of Object.entries(saved || {})) {
      map.set(sq, normalizeKeptEntry(v));
    }
    return map;
  }
  // そのマス・その種で効く編成ID: 種の指定（null の明示を含む）が
  // あればそれ、無ければ legacy。種が無い文脈では legacy。
  function keptFormationId(squareId, species) {
    const entry = squareFormations.get(squareId);
    if (!entry) return null;
    if (species && Object.prototype.hasOwnProperty.call(entry.groups, species)) {
      return entry.groups[species];
    }
    return entry.legacy;
  }
  function setKeptFormation(squareId, species, formationId) {
    let entry = squareFormations.get(squareId);
    if (!entry) {
      entry = { legacy: null, groups: {} };
      squareFormations.set(squareId, entry);
    }
    if (species) entry.groups[species] = formationId || null;
    else entry.legacy = formationId || null;
    // 中身が空になった対応は落とす（保存形を汚さない）。種の null の
    // 明示は意味があるため、キーが残っている間は対応を残す。
    if (!entry.legacy && Object.keys(entry.groups).length === 0) {
      squareFormations.delete(squareId);
    }
  }
  // 編成の削除に合わせて、その編成を指す保持（legacy・各種）を落とす。
  // 戻り値は「保持が変わったか」。
  function dropKeptFormationRefs(formationId) {
    let changed = false;
    for (const [sq, entry] of [...squareFormations]) {
      let touched = false;
      if (entry.legacy === formationId) { entry.legacy = null; touched = true; }
      for (const [sp, fid] of Object.entries(entry.groups)) {
        if (fid === formationId) { delete entry.groups[sp]; touched = true; }
      }
      if (touched) {
        changed = true;
        if (!entry.legacy && Object.keys(entry.groups).length === 0) {
          squareFormations.delete(sq);
        }
      }
    }
    return changed;
  }
  let squareFormations = keptMapFrom(savedRun && savedRun.squareFormations);
  const persistRun = async () => {
    await saveRun(backend, history, [...faceShownFloors], Object.fromEntries(squareFormations));
  };
  let formationsData = await loadFormationsData(backend);
  let records = await loadRecords(backend);
  let settings = await loadSettings(backend);
  let meta = await loadMeta(backend);

  // ランの開始日（SW94、記録画面の「自分の記録」の日数の材料）:
  // 開始日が無く、今のランにまだ記録が無い時だけ今日を押す。記録の
  // あるラン（SW94 より前に始まったラン）は開始日が分からないため
  // 押さない（そのランの日数は出さず、階の事実だけを返す）。締め・
  // 途中開始・リセットでは、それぞれの開始処理が開始日を付け替える。
  if (!(meta && meta.runStartedAt) && currentOps(history).length === 0) {
    meta = { ...(meta || {}), runStartedAt: new Date().toISOString() };
    await saveMeta(backend, meta);
  }

  // 初回起動時の移行（旧 localStorage は読み取りのみ）。
  // 注意: sandbox 属性つき iframe のような不透明なオリジンでは、localStorage への
  // 参照自体が SecurityError になる（typeof では防げない）。取得は try の中で行い、
  // 失敗したら移行なしとして起動を続ける。
  let migrationSummary = null;
  if (!formationsData && !(meta && meta.migratedAt)) {
    let oldGetItem = null;
    // 不透明なオリジン（sandbox iframe 等）では、localStorage への参照
    // 自体がコンソールに SecurityError を残すため、触る前に避ける。
    if (window.origin && window.origin !== 'null') {
      try {
        const ls = window.localStorage;
        if (ls) oldGetItem = (key) => ls.getItem(key);
      } catch {
        oldGetItem = null;
      }
    }
    if (oldGetItem) {
      const result = migrateFromOldStorage(oldGetItem);
      if (result.found) {
        formationsData = { formations: result.formations, megidoDetails: result.megidoDetails };
        await saveFormationsData(backend, formationsData);
        migrationSummary = result.summary;
      }
    }
    meta = { ...(meta || {}), migratedAt: new Date().toISOString(), migrationSummary };
    await saveMeta(backend, meta);
  }
  if (!formationsData) formationsData = { formations: [], megidoDetails: null };
  // タグの保存形を {text, category} にそろえる（文字列だけの旧形式で
  // 保存された編成が残っている場合の読み替え。検索・チップ表示の前提）。
  formationsData = {
    ...formationsData,
    formations: formationsData.formations.map((f) => ({ ...f, tags: normalizeTags(f.tags) })),
  };
  // 育成値の掃除（移行規則）: 実装の無いメギドに入っている専用霊宝・
  // 絆霊宝・凸の値を標準値に戻す（実装有無は基礎データのフラグが正）。
  // 霊宝の装備の種付け（初回のみ）: 装備の正はメギド側。既に移行済みの
  // 端末では編成の枠の reishouIds から移す（規則は migrate.js）。
  {
    let dirty = false;
    const cleaned = sanitizeDetailsByFlags(formationsData.megidoDetails, megidoBasics);
    if (cleaned.cleanedCount > 0) {
      formationsData = { ...formationsData, megidoDetails: cleaned.megidoDetails };
      dirty = true;
    }
    if (!(meta && meta.reishouSeededV1)) {
      const seeded = seedReishouFromFormations(formationsData.formations, formationsData.megidoDetails);
      if (seeded.seededCount > 0) {
        formationsData = { ...formationsData, megidoDetails: seeded.megidoDetails };
        dirty = true;
      }
      meta = { ...(meta || {}), reishouSeededV1: true };
      await saveMeta(backend, meta);
    }
    if (dirty) await saveFormationsData(backend, formationsData);
  }

  let viewFloor = settings.lastFloor || null;
  let floorEnemies = null; // 閲覧中の階の敵データ（第5節の読み込み単位）

  const derive = () => deriveRun({
    structure,
    megidoBasics,
    megidoDetails: formationsData.megidoDetails,
    ops: currentOps(history),
  });

  // ---- マスのシート（M3〜M11）と編成を選ぶ（M5）の配線 ----
  const byId = basicsById(megidoBasics);
  const RESULT_TEXT = { win: '勝利', lose: '敗北', retreat: 'リタイア' };

  // 凸（シンギュラリティ）の現在値。手段の解禁判定（counter.js の
  // levelOf）に使う。詳細が無い・未入力の場合は 0。
  const levelOf = (id) => {
    const d = formationsData && formationsData.megidoDetails
      ? formationsData.megidoDetails[id] : null;
    return d && typeof d.singularity_level === 'number' ? d.singularity_level : 0;
  };
  // マスエフェクトの枠条件の照合用（スタイル・クラス・性別）。
  const styleClassOf = (id) => {
    const b = byId.get(id);
    return b ? { style: b.style, className: b.class, gender: b.gender } : null;
  };

  // オーブマスタはシートを開く時にだけ読む（起動時の読み込みには含めない）。
  let orbsById = null;
  let orbsKindOrder = [];
  let orbsPromise = null;
  const ensureOrbs = async () => {
    if (!orbsPromise) {
      orbsPromise = loader.loadOrbs().catch(() => null);
    }
    const orbsData = await orbsPromise;
    if (orbsData && !orbsById) {
      orbsById = new Map(orbsData.orbs.map((o) => [o.id, o]));
      orbsKindOrder = orbsData.kindOrder || [];
    }
  };
  const orbNameText = (orbId) => {
    if (!orbsById) return 'オーブあり（名称不明）';
    const orb = orbsById.get(orbId);
    return orb ? orb.name : 'オーブあり（名称不明）';
  };

  // 横断検索の効果文索引は、検索ビューを開く時にだけ読む（起動時の
  // 読み込みには含めない）。読み込みに失敗しても検索ビュー自体は
  // 開けるよう、失敗は null として抱える（効果文の結果が出ないだけ）。
  let searchIndex = null; // prepareSearchIndex 済みの索引
  let searchIndexPromise = null;
  const ensureSearchIndex = async () => {
    if (!searchIndexPromise) {
      searchIndexPromise = loader.loadSearchIndex()
        .then((data) => { if (data && !searchIndex) searchIndex = prepareSearchIndex(data); })
        .catch(() => null);
    }
    await searchIndexPromise;
    return searchIndex;
  };

  // 対策の材料（手段の索引・対策クラス・ME）は、シートや編成の画面を
  // 開く時にだけ読む（起動時の読み込みには含めない）。読み込みに失敗
  // しても画面は開けるよう、失敗は null として抱える。
  let counterData = null; // { index, clsById, meData, mechanicNotes, speedCorr, chainData, photonSupply, hbombData, kyoenData, flagData, dmgReduction, threatLevels }
  let counterPromise = null;
  const ensureCounter = async () => {
    if (!counterPromise) {
      counterPromise = (async () => {
        try {
          const [means, classes, me, mechanicNotes, speedCorr, chainData, photonSupply, hbombData, kyoenData, flagData, dmgReduction, threatLevels, enemyRoles] = await Promise.all([
            loader.loadMeansIndex(), loader.loadCounterClasses(), loader.loadMeData(),
            // 仕組みの注記は材料が無くても他を巻き込まない（注記が
            // 出ないだけにする）。
            loader.loadMechanicNotes().catch(() => null),
            // 実効素早さの補正材料とチェインの材料も同じ扱い（無い
            // 場合は補正なし・区画なしに落ちる）。
            loader.loadSpeedCorrections().catch(() => null),
            loader.loadChain().catch(() => null),
            // フォトンの供給材料も同じ扱い（無い場合はフォトン条件の
            // 注記が従来の形に落ちる）。
            loader.loadPhotonSupply().catch(() => null),
            // Hボムプランナーのボム行動の索引も同じ扱い（無い場合は
            // 編成エディタの道具が出ないだけ）。
            loader.loadHbomb().catch(() => null),
            // 狂炎シミュレーターの材料の索引も同じ扱い（無い場合は
            // 編成エディタの道具が出ないだけ）。
            loader.loadKyoen().catch(() => null),
            // 戦旗の保持者一覧も同じ扱い（無い場合は条件チェックの
            // 区画が出ないだけ）。
            loader.loadFlag().catch(() => null),
            // 受けダメージ見積もりの軽減材料も同じ扱い（無い場合は
            // 軽減なしの見積もりに落ちる）。
            loader.loadDamageReduction().catch(() => null),
            // 脅威レベルの下書き段階づけも同じ扱い（無い場合は
            // 段階の表示とカルーセルの出し分けが無いだけ）。
            loader.loadThreatLevels().catch(() => null),
            // 敵の3役分類も同じ扱い（無い場合は系統の既定で寄せる）。
            loader.loadEnemyRoles().catch(() => null),
          ]);
          counterData = {
            index: buildIndex(means), clsById: classesById(classes), meData: me, mechanicNotes,
            speedCorr, chainData, photonSupply, hbombData, kyoenData, flagData, dmgReduction, threatLevels,
            roles: enemyRoles,
          };
        } catch {
          counterData = null;
        }
        return counterData;
      })();
    }
    return counterPromise;
  };

  // 霊宝マスタは編成まわりを開く時にだけ読む。
  let reishouById = null;
  let reishouPromise = null;
  const ensureReishou = async () => {
    if (!reishouPromise) {
      reishouPromise = loader.loadReishou().catch(() => null);
    }
    const data = await reishouPromise;
    if (data && !reishouById) {
      reishouById = new Map(data.reishou.map((r) => [r.id, r]));
    }
    return reishouById;
  };
  const reishouNameText = (ids) => {
    const names = (ids || []).map((id) => {
      if (!reishouById) return '名称不明';
      const r = reishouById.get(id);
      return r ? r.name : '名称不明';
    });
    return names.join('、');
  };

  // 霊宝の装備の正はメギド側（megidoDetails の reishou、2026-11-19）。
  // 編成の枠の reishouIds は保存時のスナップショットとして残るだけで、
  // 表示と計算は常にこちらから引く。どの画面で付け替えても同じ装備が
  // 変わり、編成を変えても付いたままになる（ゲームのモデルどおり）。
  const equipmentOf = (megidoId) => {
    const d = formationsData && formationsData.megidoDetails
      ? formationsData.megidoDetails[megidoId]
      : null;
    return d && Array.isArray(d.reishou) ? [...d.reishou] : [];
  };
  // formationMembers の戻り値に、装備（メギド側）で reishouIds を差し替える。
  const membersWithEquipment = (members) => members.map((m) => ({
    ...m,
    reishouIds: m.megidoId ? equipmentOf(m.megidoId) : [],
  }));
  // 探索力計算に渡す霊宝の修正値表（ID → stats）。マスタ未読込なら null。
  const reishouStatsMap = () => {
    if (!reishouById) return null;
    const map = new Map();
    for (const [id, r] of reishouById) {
      if (r.stats) map.set(id, r.stats);
    }
    return map;
  };
  // 装備中の霊宝の修正値の合計を短い文にする（例: 攻撃+60・HP+208）。
  const REISHOU_STAT_LABEL = { hp: 'HP', atk: '攻撃', def: '防御', spd: '素早さ' };
  const reishouStatsText = (megidoId) => {
    const mods = reishouStatMods(formationsData.megidoDetails, megidoId, reishouStatsMap());
    if (!mods) return null;
    const parts = ['hp', 'atk', 'def', 'spd']
      .filter((k) => mods[k] !== 0)
      .map((k) => `${REISHOU_STAT_LABEL[k]}+${mods[k]}`);
    return parts.length > 0 ? parts.join('・') : null;
  };
  // 編成時の数値表示（2026-11-20）の材料。味方の実効ステータスは
  // 基礎（星6）＋霊宝の固定値までとする（オーブや特性の割合補正・
  // コンディションは生成データに無いため数えない。前提は表示側の
  // 文面に明示する）。霊宝マスタ未読込なら基礎だけになる。
  // 基礎ステータスは stats.js の解決を通す（保存レベルに応じた
  // 魔重解放の上昇分が乗る。Lv70 は従来と一致）。
  const memberStatsOf = (megidoId) => {
    const b = byId.get(megidoId);
    if (!b || !b.statsStar6) return null;
    const base = resolveMegidoStats(b, savedLevelOf(
      formationsData ? formationsData.megidoDetails : null, megidoId));
    if (!base) return null;
    const mods = reishouStatMods(
      formationsData ? formationsData.megidoDetails : null, megidoId, reishouStatsMap());
    return {
      hp: base.hp + (mods ? mods.hp : 0),
      atk: base.atk + (mods ? mods.atk : 0),
      def: base.def + (mods ? mods.def : 0),
    };
  };
  // 専用霊宝の所持（基礎データに専用霊宝があり、本人の所持が
  // 「あり」）。既存の各判定と同じ引き方。
  const specialOwnedOf = (megidoId) => {
    const b = byId.get(megidoId);
    const d = formationsData && formationsData.megidoDetails
      ? formationsData.megidoDetails[megidoId] : null;
    return resolveSpecialReishou(d, Boolean(b && b.specialReishou));
  };
  // 装備中の霊宝のマスタ行（系譜ポイント等の判定用）。
  const equippedReishouRows = (megidoId) => equipmentOf(megidoId)
    .map((rid) => (reishouById ? reishouById.get(rid) : null))
    .filter(Boolean);

  // 霊宝1個ぶんの修正値の短い文（例: 攻撃+60・HP+208）。マスタ
  // 未読込・修正値の収録なしは null。
  const reishouOneStatsText = (reishouId) => {
    const r = reishouById ? reishouById.get(reishouId) : null;
    if (!r || !r.stats) return null;
    const parts = ['hp', 'atk', 'def', 'spd']
      .filter((k) => typeof r.stats[k] === 'number' && r.stats[k] !== 0)
      .map((k) => `${REISHOU_STAT_LABEL[k]}+${r.stats[k]}`);
    return parts.length > 0 ? parts.join('・') : null;
  };
  // メギド詳細に出す装備の枠（REISHOU_PER_MEGIDO 枠ぶん。空きは null）。
  const reishouSlotsVm = (megidoId) => {
    const picked = equipmentOf(megidoId);
    const slots = [];
    for (let i = 0; i < REISHOU_PER_MEGIDO; i += 1) {
      const rid = picked[i];
      if (!rid) { slots.push(null); continue; }
      const r = reishouById ? reishouById.get(rid) : null;
      slots.push({ name: r ? r.name : '名称不明', statsText: reishouOneStatsText(rid) });
    }
    return slots;
  };
  // 枠表示用の霊宝の要約（2026-11-19、ユーザー合意の圧縮形）: 枠は
  // 見通し専用にし、名前の全列挙はしない（確認と付け替えは霊宝
  // ピッカーとメギド画面で行う）。返すのは装備の個数、専用霊宝と
  // 絆霊宝の印、素早さに効く霊宝だけの名前つき注記（同じ霊宝は
  // 個数分を合算して1件に畳む。固定値と割合%は要素を分けて持つ）。
  // 専用霊宝に印を付けるのは、その所持が枠の周辺の判定の前提に
  // なるため（サブMEの発生、チェインの条件、Hボムの専用霊宝版への
  // 差し替え、手段索引の専用霊宝由来）。絆霊宝にも印を付ける
  // （2026-11-20 ユーザー訂正: 絆霊宝は状態異常耐性が付くため、
  // 編成枠で付いているか知りたい場面がある。「判定の前提に
  // ならないので印なし」とした SW51 の判断は誤りだった）。絆霊宝は
  // 専用の匣が4枠あり（2026-11-20 ユーザー確定）、いずれかの枠が
  // 埋まっていれば印を出す。内訳はメギド画面と候補の差分
  // 表示で扱う。
  const reishouSlotSummary = (megidoId) => {
    const ids = equipmentOf(megidoId);
    const corr = counterData && counterData.speedCorr ? counterData.speedCorr.reishou : null;
    const byName = new Map();
    for (const rid of ids) {
      const r = reishouById ? reishouById.get(rid) : null;
      const flat = r && r.stats && typeof r.stats.spd === 'number' ? r.stats.spd : 0;
      const c = corr ? corr[rid] : null;
      const pct = c && typeof c.pct === 'number' ? c.pct : 0;
      if (!flat && !pct) continue;
      const name = r ? r.name : '名称不明';
      const cur = byName.get(name) || { name, flat: 0, pct: 0 };
      cur.flat += flat;
      cur.pct += pct;
      byName.set(name, cur);
    }
    const spdNotes = [...byName.values()].map((n) => {
      const segments = [];
      if (n.flat) {
        segments.push({ text: `${n.flat > 0 ? '+' : ''}${n.flat}`, dir: n.flat > 0 ? 'up' : 'down' });
      }
      if (n.pct) {
        segments.push({ text: `${n.pct > 0 ? '+' : ''}${n.pct}%`, dir: n.pct > 0 ? 'up' : 'down' });
      }
      return { name: n.name, segments };
    });
    const b = byId.get(megidoId);
    const d = formationsData && formationsData.megidoDetails
      ? formationsData.megidoDetails[megidoId] : null;
    return {
      count: ids.length,
      max: REISHOU_PER_MEGIDO,
      special: resolveSpecialReishou(d, Boolean(b && b.specialReishou)),
      bond: resolveBondSlots(d, Boolean(b && b.bondReishou)).some((v) => v !== 0),
      spdNotes,
    };
  };
  // 装備の書き込み（メギド画面・構築画面の共通経路）。
  async function setMegidoReishou(megidoId, ids) {
    ensureDetailsMaterialized();
    const details = { ...formationsData.megidoDetails };
    const current = details[megidoId] || normalizeMegidoDetail({});
    details[megidoId] = { ...current, reishou: [...ids].slice(0, REISHOU_PER_MEGIDO) };
    formationsData = { ...formationsData, megidoDetails: details };
    await saveFormationsData(backend, formationsData);
  }

  // 著述データ（M4）は戦闘マスのシートを開く時にだけ読む。ボスは
  // 名前引きと、30Fラッシュのマス引き（本拠階の項への参照）の両方を持つ。
  let tacticsData = null; // { bossByName, bossBySquare, enemyByName }
  let tacticsPromise = null;
  const ensureTactics = async () => {
    if (!tacticsPromise) {
      tacticsPromise = (async () => {
        try {
          const [boss, enemy] = await Promise.all([
            loader.loadBossTactics(), loader.loadEnemyTactics(),
          ]);
          tacticsData = buildTacticsIndex(boss, enemy);
        } catch {
          tacticsData = null;
        }
        return tacticsData;
      })();
    }
    return tacticsPromise;
  };

  // 需要の集計（H6）は全階の敵データが要る。初回のマス表示の裏で読み始め、
  // 揃った時点から候補生成と警告に使う（揃うまでは需要なしとして扱う）。
  let allFloorsEnemies = null; // Map(floor -> 敵データ)
  let allFloorsPromise = null;
  const ensureAllFloors = () => {
    if (!allFloorsPromise) {
      allFloorsPromise = (async () => {
        try {
          const map = new Map();
          await Promise.all(structure.floors.map(async (fd) => {
            map.set(fd.floor, await loader.loadFloorEnemies(fd.floor));
          }));
          allFloorsEnemies = map;
        } catch {
          allFloorsEnemies = null;
        }
        return allFloorsEnemies;
      })();
    }
    return allFloorsPromise;
  };

  // 需要の集計結果（導出のたびに作り直すと重いため、履歴と材料が
  // 変わらない間はキャッシュする）。
  // 数えるのは脅威への答えだけ（統合演算。種族特効・状態特効のような
  // 「効く手」は数えない）。範囲は現在地の階から、次のコンディション
  // 回復マスのある階まで（相談 5-15・導出監査 型4、2026-11-20）。
  // 著述データの到着前後と現在階で結果が変わるため、キャッシュの
  // キーには到着状態と現在階も含める。
  let demandCache = null;
  const currentDemand = (derived) => {
    if (!counterData || !allFloorsEnemies) return null;
    const rangeEndFloor = demandRangeEndFloor(structure, derived.cleared, derived.currentFloor);
    const key = `${currentOps(history).length}:${derived.owned.size}:${tacticsData ? 'T' : '-'}:${derived.currentFloor}:${rangeEndFloor}`;
    if (demandCache && demandCache.key === key) return demandCache.demand;
    const demand = aggregateDemand({
      structure,
      enemiesByFloor: allFloorsEnemies,
      clsById: counterData.clsById,
      index: counterData.index,
      owned: derived.owned,
      cleared: derived.cleared,
      tactics: tacticsData,
      levelOf,
      rangeEndFloor,
    });
    demandCache = { key, demand };
    return demand;
  };

  let sheetCtx = null;
  let listCtx = null;

  // タブバーの≡メニュー（原則3改訂: 元に戻す・やり直しはメニューの中）と、
  // 実行後にフッターの上へ短く出す知らせ。
  let menuOpen = false;
  let noticeText = null;
  let noticeTimer = null;

  // 区画（タブバーの四角で切り替える。追記9・10）と、状態フッターの展開。
  // マスのシートはマップ区画の上に開く。区画を切り替えると、その区画の
  // 上に開いていたシート／全画面ビューは閉じる（現在地と中身を一致させる）。
  let section = 'map';
  let footerExpanded = false;

  const nameOf = (id) => (byId.get(id) ? byId.get(id).name : id);

  // 元に戻す・やり直しの対象を、知らせに出す短い言葉で表す。
  function describeOp(op) {
    if (!op) return '操作';
    if (op.type === 'battle') {
      return `${op.floor}Fの戦闘${op.formationName ? `（「${op.formationName}」で${RESULT_TEXT[op.result]}）` : ''}`;
    }
    if (op.type === 'explore') return `${op.floor}Fの探索（${exploreEffectLabel(op)}）`;
    if (op.type === 'conditionFix') return `${nameOf(op.megidoId)}のコンディションの直し`;
    if (op.type === 'startRun') return `${op.floor}Fからの途中開始`;
    return '操作';
  }

  function setNotice(text) {
    noticeText = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    if (text) {
      noticeTimer = setTimeout(() => {
        noticeText = null;
        noticeTimer = null;
        update();
      }, 5000);
    }
  }

  // 探索の記録は効果で表す（標準の効果か、効果大か）。色の名前は
  // 出さない。文言は結果の言葉にそろえる（追記7）。
  const exploreEffectLabel = (e) => (e.box === '虹' ? '効果大' : '標準の効果');

  function historyLine(e) {
    if (e.kind === 'battle') {
      return `${e.formationName ? `${e.formationName}で` : '編成の記録なしで'}${RESULT_TEXT[e.result]}`;
    }
    // 探索の記録にはメンバー名も手渡す（誰を出したかが翌月の判断材料）。
    const names = e.members.map((id) => nameOf(id)).join('、');
    let line = `探索（${exploreEffectLabel(e)}）: ${names || `メンバー ${e.members.length}体`}`;
    // バフマスで「ボーナスは出なかった」と明示された記録は、履歴でも
    // その事実が読める形にする（不明の旧い記録では付けない）。
    if (e.buffBonus === false && (e.box === '赤' || e.box === '虹')) {
      line += '／ランダムのボーナスは出なかった';
    }
    return line;
  }

  // 記録の行の色（左端の帯）。文字が常に正で、色は補助。
  function entryTone(e) {
    if (e.kind === 'explore') return 'explore';
    return e.result === 'win' ? 'win' : e.result === 'lose' ? 'lose' : 'retreat';
  }

  function pastSummaryText(entries) {
    if (entries.length === 0) return null;
    const battles = entries.filter((e) => e.kind === 'battle');
    const last = entries[entries.length - 1];
    let head = last.kind === 'battle'
      ? `前回 ${last.formationName ? `${last.formationName}で` : ''}${RESULT_TEXT[last.result]}`
      : `前回 探索（${exploreEffectLabel(last)}）`;
    if (entries.length > 1) {
      const counts = { win: 0, lose: 0, retreat: 0 };
      for (const b of battles) counts[b.result] += 1;
      const parts = [];
      if (counts.win) parts.push(`勝利${counts.win}`);
      if (counts.lose) parts.push(`敗北${counts.lose}`);
      if (counts.retreat) parts.push(`リタイア${counts.retreat}`);
      const explores = entries.length - battles.length;
      if (explores) parts.push(`探索${explores}`);
      if (parts.length > 0) head += `（これまで ${parts.join('・')}）`;
    }
    return head;
  }

  function costLinesFor(formation, derived) {
    const lines = [
      '敗北: 出撃メンバー全員のコンディションが2段階ダウン（塔破力は消費済み）',
      'リタイア: コンディションは不変（塔破力は消費済み）',
    ];
    if (formation) {
      const faint = [];
      const veryBad = [];
      for (const slot of formation.slots) {
        if (!slot.megidoId) continue;
        const after = Math.min(5, derived.conditionOf(slot.megidoId) + 2);
        if (after >= 5) faint.push(nameOf(slot.megidoId));
        else if (after === 4) veryBad.push(nameOf(slot.megidoId));
      }
      if (faint.length > 0) lines.push(`この編成で敗北すると気絶するメンバー: ${faint.join('、')}`);
      if (veryBad.length > 0) lines.push(`この編成で敗北すると絶不調になるメンバー: ${veryBad.join('、')}`);
    }
    return lines;
  }

  // 先頭の報酬表示は短くする。内訳は、期待度に換算した見込み
  // （メンバーの節）が担う（ui-flow.md M7。箱色は結果であり、
  // 利用者が操作できるのは探索力の方）。
  function exploreRewardShort(def) {
    if (def.subType === 'recovery') {
      const styleText = def.styleKind === 'fixed' ? `${STYLE_NAME[def.style]}固定` : 'ランダム（スタイルは結果で決まる）';
      return `${styleText}のコンディション回復（回復する人数と段階は期待度で決まる）`;
    }
    if (def.subType === 'tower_power') {
      return '塔破力の回復（量は期待度で決まる）';
    }
    const label = {
      attack_buff: '攻撃力上昇', defense_buff: '防御力上昇', hp_buff: 'HP上昇', status_buff: 'ステータス上昇',
    }[def.subType] || 'ステータス上昇';
    const styleText = def.styleKind === 'fixed' ? `${STYLE_NAME[def.style]}固定` : '';
    return `${styleText ? `${styleText}の` : ''}${label}（上がる幅は期待度で決まる）`;
  }

  // ランダム回復の賭けの中身: 現在のスタイル別の疲労の偏り。
  function fatigueSkewText(derived) {
    const rows = styleFatigueSkew({
      megidoBasics, owned: derived.owned, conditionOf: derived.conditionOf,
    });
    const parts = rows.map((r) =>
      `${r.style} ${r.tired}体${r.fainted > 0 ? `（うち気絶${r.fainted}）` : ''}`);
    return `${parts.join('／')}（絶好調より悪い人数）`;
  }

  // 探索シートの第一画面は「結果の言葉」で話す（2026-11-18 の
  // エミュレーション受け入れ基準）: 報酬／コスト／推奨探索力の
  // ラベル表は頭に置かず、起きることを1文で大きく出す。
  // ゲームの「予測: ○○が回復する」に相当する文。
  // バフマスは「上昇する」で言い、結果を付けた後（done）は過去形
  // 「上昇した」にする（2026-11-25 マスター指示）。
  function exploreHeadResult(def, done = false) {
    if (def.subType === 'recovery') {
      return def.styleKind === 'fixed'
        ? `${STYLE_NAME[def.style]}の疲れた仲間が回復する`
        : '疲れた仲間が回復する（どのスタイルかは結果で決まる）';
    }
    if (def.subType === 'tower_power') return '塔破力が戻る';
    const label = {
      attack_buff: '攻撃力', defense_buff: '防御力', hp_buff: 'HP', status_buff: 'ステータス',
    }[def.subType] || 'ステータス';
    const styleText = def.styleKind === 'fixed' ? `${STYLE_NAME[def.style]}の` : '';
    return `${styleText}${label}が${done ? '上昇した' : '上昇する'}`;
  }

  function headRowsFor(def, derived, squareId) {
    const rows = [];
    if (def.type === 'battle' || def.type === 'boss') {
      rows.push({ label: '敵', text: (def.enemies || []).join('、') });
      for (const rule of def.rules || []) {
        if (rule && rule !== 'なし') rows.push({ label: 'ルール', text: rule });
      }
      if (def.type === 'boss') {
        const attempts = derived.attempts.get(squareId) || 0;
        rows.push({
          label: 'コスト',
          text: attempts === 0
            ? '塔破力0（初回）＋編成メンバーは、勝利でコンディションが1段階ダウン、敗北で2段階ダウン（リタイアによってコンディションは変動しない）'
            : '塔破力1＋編成メンバーは、勝利でコンディションが1段階ダウン、敗北で2段階ダウン（リタイアによってコンディションは変動しない）',
        });
      } else {
        rows.push({ label: 'コスト', text: '塔破力1＋編成メンバーは、勝利でコンディションが1段階ダウン、敗北で2段階ダウン（リタイアによってコンディションは変動しない）' });
      }
    } else if (def.type === 'explore') {
      rows.push({ label: '報酬', text: exploreRewardShort(def) });
      if (def.subType === 'recovery' && def.styleKind === 'random') {
        rows.push({ label: '疲れた人の偏り', text: fatigueSkewText(derived) });
      }
      rows.push({ label: 'コスト', text: '塔破力1＋探索に参加したメギドはコンディションが2段階ダウン' });
      rows.push({ label: '推奨探索力', text: String(def.recommendedPower) });
    } else if (def.type === 'start') {
      rows.push({ label: '報酬', text: 'なし（開始マス）' });
    }
    return rows;
  }

  function squareTitle(def) {
    if (def.type === 'battle' || def.type === 'boss') {
      return `${squareLabel(def)}: ${(def.enemies || []).join('、')}`;
    }
    if (def.type === 'explore') {
      const styleText = def.styleKind === 'fixed'
        ? `${STYLE_NAME[def.style]}固定`
        : def.styleKind === 'random' ? 'ランダム' : '';
      const reward = EXPLORE_LABEL[def.subType] || '';
      return `探索: ${reward}${styleText ? `（${styleText}）` : ''}`;
    }
    return squareLabel(def);
  }

  function enemyDetailsVm(def) {
    if (!floorEnemies || !floorEnemies.enemies) return null;
    const enemies = [];
    // 種ごとのグループ（SW91 のシートのステータス系用。平らな
    // enemies と同じ行オブジェクトを種ごとに束ねたもの）。
    const bySpecies = [];
    // マスのルールは敵ステータスに適用し、内訳つきで出す
    // （例: 素早さ 528（352×1.5））。
    const mult = squareStatMultipliers(def.rules);
    // ステータス1項目の材料: 表示文（text）に加え、ルールで変わった
    // 値の向き（dir: 'up'|'down'|null）を分けて持つ。シート側は
    // 1項目ずつ行を分け、変わった値に色と矢印を付けて出す
    // （2026-11-25、マスター指示）。覚醒ゲージはルールの倍率の
    // 対象ではないため、そのままの値を足す。
    const statPartsOf = (src) => {
      const parts = [['HP', 'hp'], ['攻撃力', 'atk'], ['防御力', 'def'], ['素早さ', 'spd']]
        .filter(([, k]) => typeof src[k] === 'number')
        .map(([label, k]) => {
          const base = src[k];
          const applied = applyMult(base, mult[k]);
          return {
            label,
            text: mult[k] !== 1 ? `${label} ${applied}（${base}×${multText(mult[k])}）` : `${label} ${base}`,
            appliedText: String(applied),
            detailText: mult[k] !== 1 ? `（${base}×${multText(mult[k])}）` : '',
            dir: applied !== base ? (applied > base ? 'up' : 'down') : null,
          };
        });
      if (typeof src.gauge === 'number') {
        parts.push({
          label: '覚醒ゲージ',
          text: `覚醒ゲージ ${src.gauge}`,
          appliedText: String(src.gauge),
          detailText: '',
          dir: null,
        });
      }
      return parts;
    };
    for (const name of def.enemies || []) {
      const fact = floorEnemies.enemies[name];
      const speciesRows = [];
      bySpecies.push({ name, members: speciesRows });
      const party = fact && Array.isArray(fact.party) ? fact.party.filter(Boolean) : [];
      if (party.length === 0) {
        // party の材料が無くても、種の代表値（基礎値）があればそれを出す。
        const st = fact && fact.stats ? fact.stats : null;
        const statParts = st ? statPartsOf(st) : [];
        const row = {
          name, style: '', className: '', trait: '',
          statsText: statParts.map((p) => p.text).join('／'),
          statLines: statParts,
          raceText: fact && fact.race && Array.isArray(fact.race.values) ? fact.race.values.join('・') : '',
          skills: [], hasInfo: statParts.length > 0,
        };
        enemies.push(row);
        speciesRows.push(row);
      } else {
        for (const p of party) {
          // 敵自身の情報はゲームの敵詳細の順に揃える（2026-11-19 ユーザー指示）:
          // 名前 → ステータス（HP・攻撃力・防御力・素早さ）→ 特性 → 種族 →
          // 技能（スキル → 覚醒スキル → 奥義）。データに無い項目は出さない
          // （Lv は出典データに無いため表示しない。捏造しない）。
          const statParts = statPartsOf(p);
          const skills = [];
          const sk = p.skills || {};
          if (sk.skill) skills.push({ label: 'スキル', text: String(sk.skill).trim() });
          if (sk.awakened) skills.push({ label: '覚醒スキル', text: String(sk.awakened).trim() });
          if (sk.ultimate) skills.push({ label: '奥義', text: String(sk.ultimate).trim() });
          // 種族はメンバー自身のものを出す（2026-11-20 是正: 本体種の
          // 種族を全員に出していた）。メンバー側に無ければ、本体メンバー
          // に限り種の race.values に fallback する。どちらにも無い
          // メンバーは種族を出さない（推測で埋めない）。
          const ownRace = Array.isArray(p.race) && p.race.length ? p.race : null;
          const raceValues = ownRace || ((p.leader || p.name === name) && fact && fact.race && Array.isArray(fact.race.values) ? fact.race.values : []);
          const row = {
            name: p.name, style: p.style || '', className: p.class || '',
            trait: (p.trait || '').trim(),
            statsText: statParts.map((pt) => pt.text).join('／'),
            statLines: statParts,
            raceText: raceValues.join('・'),
            skills,
            hasInfo: statParts.length > 0 || !!(p.trait || '').trim() || skills.length > 0,
          };
          enemies.push(row);
          speciesRows.push(row);
        }
      }
    }
    const rules = (def.rules || []).filter((r) => r && r !== 'なし');
    return { rules, enemies, bySpecies };
  }

  // restricted（31階の制限マス）では、素早さの敵比較の結論
  // （先手・同速）を出さない（味方は Lv23 で先手は基本取れず、
  // Lv70 前提の対比は意味を持たない）。味方自身のステータス表示は
  // 編成仕様として従来どおり残す。
  function confirmationVm(formation, derived, fastestEnemy = null, restricted = false) {
    const members = membersWithEquipment(formationMembers(formation, byId));
    // リーダーの ME の要約（M8）。全272体分が収録済みで、実データで出す。
    const leader = members.find((m) => m.isLeader);
    let meName = null;
    let meSummary = null;
    let meMissing = false;
    if (leader && leader.megidoId && counterData && counterData.meData) {
      const rec = counterData.meData.megido[leader.megidoId];
      if (rec && rec.massEffect) {
        meName = rec.massEffect.name;
        meSummary = rec.massEffect.summary || null;
      } else {
        meMissing = true;
      }
    }
    // 実効素早さの計算に使う、その編成の枠（オーブとリーダーの
    // 枠効果まで含めるため、編成エディタと同じ形に揃える）。
    const pseudoSlots = members.map((m) => ({ megidoId: m.megidoId, orbId: m.orbId }));
    const spdValues = [];
    const slotVms = members.map((m) => {
        const spdR = m.megidoId
          ? effSpdInFormation(m.megidoId, m.index, pseudoSlots, derived.conditionOf(m.megidoId))
          : null;
        spdValues.push(spdR ? spdR.value : null);
        return {
          label: m.label,
          isLeader: m.isLeader,
          name: m.name,
          style: m.style,
          className: m.className || null,
          // 実効素早さの数値（補正込み・内訳つき。編成エディタの
          // 枠と同じ形。2026-11-19 調整フライトで追加）。
          ...spdDisplayOf(spdR),
          orbText: !m.megidoId ? '—' : m.orbId ? orbNameText(m.orbId) : 'オーブなし',
          // 霊宝は枠では個数＋専用印＋素早さ分だけに畳む（2026-11-19）。
          reishouSummary: m.megidoId && m.reishouIds.length > 0
            ? reishouSlotSummary(m.megidoId) : null,
          // 塔効果バフの反映（M8）: このメンバーのスタイルに効いている
          // 蓄積（上限適用後）を枠ごとに事実として出す。蓄積が無い
          // スタイルでは行自体を出さない。
          buffText: m.megidoId && derived ? styleBuffText(derived.buffs, STYLE_CODE[m.style]) : null,
        };
    });
    // 素早さの敵比較（最終チェック、2026-11-19）: そのマスの敵最速と
    // 比べて、先手を取れる味方と同速の味方を出す。敵の素早さが
    // 引けないマス、味方の数値が無い編成では出さない。
    let spdSummary = null;
    if (fastestEnemy && !restricted) {
      const cmp = compareSpeeds({
        allies: members.map((m, i) => ({ name: m.name, spd: spdValues[i] })),
        enemies: [fastestEnemy],
      });
      if (cmp) {
        spdSummary = {
          fastestName: cmp.fastestName,
          fastestSpd: cmp.fastestSpd,
          aheadNames: cmp.ahead,
          tiedNames: cmp.tied,
        };
      }
    }
    return {
      formationName: formation.name || '（名前なし）',
      slots: slotVms,
      spdSummary,
      meName,
      meSummary,
      meMissing,
    };
  }

  // 素早さの材料（速さ判定）: メギドは stats.js の解決を通した
  // ステータス（魔重の素早さ加算は無いため値は Lv70 と一致）、
  // 敵は出現データ。
  const spdById = new Map([...byId.entries()]
    .map(([id, b]) => {
      const s = b ? resolveMegidoStats(b, savedLevelOf(
        formationsData ? formationsData.megidoDetails : null, id)) : null;
      return [id, s ? s.spd : null];
    }));

  // 実効素早さ（ラウンドB）: 基礎値に、編成時点で確定する補正を
  // 加えた値（speed.js が合成）。補正の材料が読めていない場合は
  // 基礎値のまま（推測で足さない）。霊宝の修正は装備（メギド側）
  // から引く。
  const traitSpdPctOf = (id) => {
    const rec = counterData && counterData.speedCorr ? counterData.speedCorr.megido[id] : null;
    return rec ? rec.pct : 0;
  };
  // equipIds を渡すと、その装備配列で試算する（霊宝ピッカーの
  // 「付けると素早さ○○」プレビュー用。装備の正は書き換えない）。
  const reishouSpdFlatOf = (id, equipIds) => {
    const details = Array.isArray(equipIds)
      ? { [id]: { reishou: equipIds } }
      : (formationsData ? formationsData.megidoDetails : null);
    const mods = reishouStatMods(details, id, reishouStatsMap());
    return mods && typeof mods.spd === 'number' ? mods.spd : 0;
  };
  // 霊宝の割合%（speed-corrections の reishou 節）: stats の固定値に
  // 載らない分。装備（メギド側の配列）の個数分だけ合算する。
  const reishouSpdPctOf = (id, equipIds) => {
    const entry = formationsData && formationsData.megidoDetails
      ? formationsData.megidoDetails[id] : null;
    const ids = Array.isArray(equipIds)
      ? equipIds
      : (entry && Array.isArray(entry.reishou) ? entry.reishou : []);
    const corr = counterData && counterData.speedCorr ? counterData.speedCorr.reishou : null;
    return reishouSpdPct(ids, corr);
  };
  // 霊宝の割合%があれば pctParts の先頭に積む（内訳で固定値の
  // 「霊宝±N」の隣に「霊宝±N%」が並ぶ形にする）。
  const pushReishouPct = (parts, id, equipIds) => {
    const rp = reishouSpdPctOf(id, equipIds);
    if (rp) parts.push({ label: '霊宝', pct: rp });
  };
  // 編成に属さない場面（M4 の候補の速さ判定）: 特性と霊宝まで。
  // オーブとマスエフェクトは編成が決まらないと付けられないため
  // 数えない。
  const effSpdStandalone = (id, stage, equipIds) => {
    const base = spdById.get(id);
    if (typeof base !== 'number') return null;
    const parts = [];
    pushReishouPct(parts, id, equipIds);
    const tp = traitSpdPctOf(id);
    if (tp) parts.push({ label: '特性', pct: tp });
    const r = effectiveSpeed({
      base, stage: stage || 0, reishouFlat: reishouSpdFlatOf(id, equipIds), pctParts: parts,
    });
    return r ? r.value : null;
  };
  // 著述の注記（annotateAuthoredTactic）に渡す、補正済みの基礎値表。
  // コンディションの補正は向こう側（counter.js）が付ける。
  const correctedSpdById = () => new Map([...byId.entries()].map(([id, b]) => {
    const resolved = b ? resolveMegidoStats(b, savedLevelOf(
      formationsData ? formationsData.megidoDetails : null, id)) : null;
    const base = resolved ? resolved.spd : null;
    if (typeof base !== 'number') return [id, null];
    const parts = [];
    pushReishouPct(parts, id);
    const tp = traitSpdPctOf(id);
    if (tp) parts.push({ label: '特性', pct: tp });
    const r = effectiveSpeed({ base, reishouFlat: reishouSpdFlatOf(id), pctParts: parts });
    return [id, r ? r.value : base];
  }));
  // サブマスエフェクト（第3ME）の発生判定（正本: corpus-status/
  // サブマスエフェクト.json）。枠の配列（リーダーは index 2）から、
  // メンバー（リーダー以外）にいる持ち主を数える。ME 要約と
  // 実効素早さで同じ判定を使う。専用霊宝の有無は
  // chainSpecialReishouOf と同じ作法（基礎データに専用霊宝が
  // あり、本人の所持が「あり」）。
  const subMeOccurrenceFor = (slots) => {
    if (!counterData || !counterData.meData) return { status: 'none', holderId: null, countedIds: [] };
    return subMeOccurrence({
      meById: counterData.meData.megido,
      memberIds: (slots || []).filter((s, i) => i !== 2 && s && s.megidoId).map((s) => s.megidoId),
      specialReishouOf: (id) => {
        const b = byId.get(id);
        const d = formationsData && formationsData.megidoDetails
          ? formationsData.megidoDetails[id] : null;
        return resolveSpecialReishou(d, Boolean(b && b.specialReishou));
      },
    });
  };
  // その編成で実際に効くリーダーの ME: サブMEが発生していれば
  // 3行目がサブMEで上書きされたもの、発生していなければ主ME
  // そのもの。リーダー本人のサブMEは発生しない（持ち主が
  // メンバーであることが条件）ため、主MEと並べては読まない。
  const effectiveLeaderMe = (leaderId, slots) => {
    if (!counterData || !counterData.meData) return null;
    const rec = counterData.meData.megido[leaderId];
    if (!rec || !rec.massEffect) return null;
    const occ = subMeOccurrenceFor(slots);
    if (occ.status !== 'active') return rec.massEffect;
    const holderRec = counterData.meData.megido[occ.holderId];
    return meWithSubOverwrite(rec.massEffect, holderRec ? holderRec.subMassEffect : null);
  };

  // 編成の中のメンバー: オーブとマスエフェクト（リーダーの枠効果）
  // まで含める。内訳つきで返す（チェインの経路確認で使う）。
  // equipIds を渡すと、そのメンバーの装備だけ試算の配列に差し替える
  // （霊宝ピッカーのプレビュー用）。
  const effSpdInFormation = (id, slotIndex, slots, stage, equipIds) => {
    const base = spdById.get(id);
    if (typeof base !== 'number') return null;
    const parts = [];
    pushReishouPct(parts, id, equipIds);
    const tp = traitSpdPctOf(id);
    if (tp) parts.push({ label: '特性', pct: tp });
    const orbId = slots[slotIndex] ? slots[slotIndex].orbId : null;
    const orbRec = orbId && counterData && counterData.speedCorr
      ? counterData.speedCorr.orbs[orbId] : null;
    if (orbRec) {
      // オーブは最大強化時の値で計算する（ユーザー裁定 2026-11-19:
      // オーブは基本育っている方で計算したい）。Lv1 と最大で値が
      // 違う場合だけ、前提が分かるよう内訳に併記する。
      parts.push({
        label: 'オーブ', pct: orbRec.pctMax,
        note: orbRec.pctMax !== orbRec.pct ? '最大強化前提' : null,
      });
    }
    const leaderId = slots[2] ? slots[2].megidoId : null;
    if (leaderId && counterData && counterData.meData) {
      const effMe = effectiveLeaderMe(leaderId, slots);
      const b = byId.get(id);
      const mePct = meSpeedPct(effMe, b ? { style: b.style, className: b.class, gender: b.gender } : null, slotIndex);
      if (mePct) {
        parts.push({
          label: 'マスエフェクト', pct: mePct.pct,
          note: mePct.genderUnverified ? '性別の条件は判定できない' : null,
        });
      }
    }
    return effectiveSpeed({
      base, stage: stage || 0, reishouFlat: reishouSpdFlatOf(id, equipIds), pctParts: parts,
    });
  };
  // 実効素早さの表示形（2026-11-19 調整フライト）: 補正込みの値を
  // 主に、補正がある場合だけ内訳（基礎・霊宝・特性・オーブ・ME・
  // コンディション）を detail に分ける。編成エディタの枠と開始前の
  // 確認で同じ形を使う。spdParts は内訳の構造化した形（各補正の
  // 向きつき）で、表示側が補正ごとに↑↓と色を付けるために使う。
  const spdDisplayOf = (r) => {
    if (!r) return { spdText: '', spdDetail: '', spdParts: [] };
    return {
      spdText: `素早さ${r.value}`,
      spdDetail: r.lines.length > 1 ? r.lines.join('・') : '',
      spdParts: r.lines.length > 1 && Array.isArray(r.parts) ? r.parts : [],
    };
  };
  // プレビューの変化の向き（2026-11-19）: 付け替え後の値と現在の
  // 値の比較。上がれば 'up'、下がれば 'down'、変わらなければ null
  // （矢印も色も付けない）。
  const spdDirOf = (after, before) => {
    if (typeof after !== 'number' || typeof before !== 'number') return null;
    if (after > before) return 'up';
    if (after < before) return 'down';
    return null;
  };
  // 矢印の差し込み（builder.js / sheet.js の spdDirText と同じ対応:
  // 矢印は値の直後、末尾に（注記）がある場合はその前）。
  const spdDirText = (text, dir) => {
    if (dir !== 'up' && dir !== 'down') return text;
    const arrow = dir === 'up' ? '↑' : '↓';
    const note = /（[^）]*）$/.exec(text);
    if (note) return `${text.slice(0, note.index)}${arrow}${note[0]}`;
    return `${text}${arrow}`;
  };
  // 敵の素早さの表示材料（2026-11-26、変化表記の統一 #5）: 適用後の
  // 値＋内訳（基礎値×倍率）。基礎値から変わった値には、敵シートと
  // 同じ付け方で矢印（値の直後、内訳の前）と方向色の向き（dir）を
  // 付ける。基礎値と等しい場合は矢印も色も付けない。オーブ文脈と
  // チェインのタイムラインで同じ形を使う。
  const enemySpdTextOf = (spd, baseSpd, mult) => {
    if (typeof spd !== 'number') return { text: '', dir: null };
    const dir = typeof baseSpd === 'number' ? spdDirOf(spd, baseSpd) : null;
    const text = typeof baseSpd === 'number' && mult !== 1
      ? `素早さ${spd}（${baseSpd}×${multText(mult)}）`
      : `素早さ${spd}`;
    return { text: dir ? spdDirText(text, dir) : text, dir };
  };
  // 攻撃力（基礎＋霊宝）。基礎は stats.js の解決を通す（魔重の上昇分
  // が乗る）。チェインの対象の縛りの照合に使う。
  const effAtkOf = (id) => {
    const b = byId.get(id);
    const resolved = b ? resolveMegidoStats(b, savedLevelOf(
      formationsData ? formationsData.megidoDetails : null, id)) : null;
    const base = resolved ? resolved.atk : null;
    if (typeof base !== 'number') return null;
    const mods = reishouStatMods(
      formationsData ? formationsData.megidoDetails : null, id, reishouStatsMap());
    return base + (mods && typeof mods.atk === 'number' ? mods.atk : 0);
  };

  // マスのルールから敵ステータスの倍率を作る（2026-11-19）。
  // データに実在する表記だけを機械的に読む: 全能力+X%／攻撃力・攻+X%／
  // 防御力・防+X%／素早さ・早+X%／HP+X%／素早さ100%低下。
  // 「（幻獣）」等の対象注記は付けても全敵に適用する（ユーザーの検証
  // ケース: 獣人の残党兵長にも 全能力+50%（幻獣） が掛かり 352×1.5=528）。
  // それ以外のルール（回復・バリア・フォトン発生など）はステータス
  // 倍率ではないため、ここでは扱わない。
  function squareStatMultipliers(rules) {
    const mult = { hp: 1, atk: 1, def: 1, spd: 1 };
    for (const r of rules || []) {
      if (typeof r !== 'string') continue;
      let m;
      if ((m = r.match(/全能力\+(\d+)%/))) {
        const f = 1 + Number(m[1]) / 100;
        mult.hp *= f; mult.atk *= f; mult.def *= f; mult.spd *= f;
      } else if ((m = r.match(/(?:攻撃力|攻)\+(\d+)%/))) {
        mult.atk *= 1 + Number(m[1]) / 100;
      } else if ((m = r.match(/(?:防御力|防)\+(\d+)%/))) {
        mult.def *= 1 + Number(m[1]) / 100;
      } else if ((m = r.match(/(?:素早さ|早)\+(\d+)%/))) {
        mult.spd *= 1 + Number(m[1]) / 100;
      } else if ((m = r.match(/HP\+(\d+)%/))) {
        mult.hp *= 1 + Number(m[1]) / 100;
      } else if (/素早さ100%低下/.test(r)) {
        mult.spd = 0;
      }
    }
    return mult;
  }

  // 倍率の表示形（1.5／1.2／0 など、末尾の 0 を落とす）。
  function multText(f) {
    return String(Math.round(f * 100) / 100);
  }

  // ルール適用後の値（端数は切り捨て。実効素早さの計算と同じ流儀）。
  function applyMult(value, f) {
    return typeof value === 'number' ? Math.floor(value * f) : value;
  }

  // 敵の素早さ: その敵自身の値があればそれを、無ければ構成員の最大値
  // （先に動けるかの判定は、速い相手に合わせて見る）。fe は敵データの
  // 階を指定する（既定は表示中の階。編成構築のターゲット側では、その敵が
  // 出る階のデータを使う）。rules を渡すと、そのマスのルールを適用する。
  function enemySpdOf(name, fe = floorEnemies, rules = null) {
    if (!fe || !fe.enemies) return null;
    const fact = fe.enemies[name];
    if (!fact) return null;
    const party = (fact.party || []).filter(Boolean);
    const self = party.find((p) => p.name === name);
    let base = null;
    if (self && typeof self.spd === 'number') base = self.spd;
    else if (fact.stats && typeof fact.stats.spd === 'number') base = fact.stats.spd;
    else {
      const spds = party.map((p) => p.spd).filter((v) => typeof v === 'number');
      base = spds.length > 0 ? Math.max(...spds) : null;
    }
    if (base === null || !rules) return base;
    return applyMult(base, squareStatMultipliers(rules).spd);
  }

  // 脅威単位の素早さ: 発生源が取り巻きの脅威では、種のリーダー個体
  // ではなく発生源の個体の素早さで判定する（監査G: ゴウケツ本体600に
  // 対し、束縛の発生源フレイムリリィは705）。発生源が引けない脅威は
  // 種の値（enemySpdOf）に落とす。マス倍率は発生源の基礎値にも同じ
  // 倍率を掛ける。
  function enemySpdForThreat(name, fe, rules, threat) {
    const fact = fe && fe.enemies ? fe.enemies[name] : null;
    const spds = fact ? threatSourceSpds(fact, threat) : null;
    if (spds && spds.length > 0) {
      const base = Math.max(...spds);
      return rules ? applyMult(base, squareStatMultipliers(rules).spd) : base;
    }
    return enemySpdOf(name, fe, rules);
  }

  // 敵のHP（点穴・エレキの「この敵に届くか」の計算材料）。
  // 素早さと同じ引き方: その敵自身の値があればそれを、無ければ
  // 構成員の最大値（届くかの判定は、硬い相手に合わせて見る）。
  function enemyHpOf(name, fe = floorEnemies, rules = null) {
    if (!fe || !fe.enemies) return null;
    const fact = fe.enemies[name];
    if (!fact) return null;
    const party = (fact.party || []).filter(Boolean);
    const self = party.find((p) => p.name === name);
    let base = null;
    if (self && typeof self.hp === 'number') base = self.hp;
    else if (fact.stats && typeof fact.stats.hp === 'number') base = fact.stats.hp;
    else {
      const hps = party.map((p) => p.hp).filter((v) => typeof v === 'number');
      base = hps.length > 0 ? Math.max(...hps) : null;
    }
    if (base === null || !rules) return base;
    return applyMult(base, squareStatMultipliers(rules).hp);
  }

  // ターゲットに決まった敵のHP（ピッカーの注記用）。その敵が出る
  // 階のデータから引く。ボスは階データにHPを持たないため、著述の
  // ステータス注記から塔版の値だけを引く（下記）。
  function targetEnemyHp() {
    if (!buildCtx || !buildCtx.targetEnemy) return null;
    for (const { fe, def } of targetSquares()) {
      const hp = enemyHpOf(buildCtx.targetEnemy, fe, def ? def.rules : null);
      if (typeof hp === 'number') return hp;
    }
    const boss = tacticsData ? tacticsData.bossByName.get(buildCtx.targetEnemy) : null;
    return boss ? bossHpFromEntry(boss) : null;
  }

  // ターゲットに決まった敵の素早さ（チェインの割り込み表示用）。
  // その敵が出る階のデータから引く。
  function targetEnemySpd() {
    if (!buildCtx || !buildCtx.targetEnemy) return null;
    for (const { fe, def } of targetSquares()) {
      const spd = enemySpdOf(buildCtx.targetEnemy, fe, def ? def.rules : null);
      if (typeof spd === 'number') return spd;
    }
    return null;
  }

  // ターゲットの敵の取り巻き編成の全員（チェインのテストの
  // タイムテーブル用）。マスの enemies は「敵グループの候補一覧」で
  // あって編成ではない（2026-11-19 ユーザー訂正）ため、候補を編成の
  // ように並べることはしない。出すのは選択中の敵自身の party の
  // 構成員全員（多部位の敵は部位ごとに1行、同名が複数いれば複数行）。
  // 素早さにはそのマスのルールを適用し、基礎値と倍率も返す（表示で
  // 内訳を出すため）。party の材料が無ければ種の代表値で1行だけ出す。
  function targetSquareEnemies() {
    if (!buildCtx || !buildCtx.targetEnemy) return [];
    for (const { fe, def } of targetSquares()) {
      const fact = fe && fe.enemies ? fe.enemies[buildCtx.targetEnemy] : null;
      if (!fact) continue;
      const mult = squareStatMultipliers(def ? def.rules : null);
      const rowOf = (name, baseSpd) => ({
        name,
        spd: typeof baseSpd === 'number' ? applyMult(baseSpd, mult.spd) : null,
        baseSpd: typeof baseSpd === 'number' ? baseSpd : null,
        mult: mult.spd,
      });
      const party = (fact.party || []).filter(Boolean);
      if (party.length) {
        return party.map((p) => rowOf(p.name, typeof p.spd === 'number' ? p.spd : null));
      }
      if (fact.stats && typeof fact.stats.spd === 'number') {
        return [rowOf(buildCtx.targetEnemy, fact.stats.spd)];
      }
      return [rowOf(buildCtx.targetEnemy, null)];
    }
    return [];
  }

  // ボスの塔版HP: 著述のステータス注記（statsNote）に「塔版」と
  // 明記された完全な桁のHPだけを拾う。メイン版・討伐版の値や
  // 「10万超」のような概数からは作らない（推測で足さない）。
  // 拾えるのは 9 体（Ωアバドン、アスモデウス、デメタス、
  // 魔喰機・無限、恐幻蜘蛛、魂なき黒き半身、アムドゥスキアス、
  // ロクス、契りのドゥーエ）。残りは注記を付けない。
  function bossHpFromEntry(entry) {
    const note = (entry && entry.statsNote) || '';
    const m = note.match(/(?:最大)?HP\s*([\d,]{4,})/);
    if (!m) return null;
    const before = note.slice(0, m.index);
    if (!before.includes('塔版')) return null;
    if (before.includes('メイン版') || before.includes('討伐版')) return null;
    const hp = parseInt(m[1].replace(/,/g, ''), 10);
    return Number.isFinite(hp) ? hp : null;
  }

  // 対の重複解消（2026-11-19）: 同じ対策の組が複数の脅威の下に丸ごと
  // 繰り返されると、初心者には二重表示のバグに見える。受け方が完全に
  // 同じ脅威は頭をまとめて対策を1回だけ出し、一部だけ重なる対策は
  // 2回目以降を「同じ対策」の参照にする。情報は落とさない。
  function mergeSharedPairs(pairs) {
    const merged = [];
    for (const p of pairs) {
      const key = p.responses.map((r) => r.label).join('\u0000');
      const found = key ? merged.find((m) => m.key === key) : null;
      if (found) {
        found.label = `${found.label}／${p.label}`;
        if (p.detail) found.detail = [found.detail, p.detail].filter(Boolean).join('\n');
      } else {
        merged.push({ ...p, key });
      }
    }
    const seen = new Map();
    for (const m of merged) {
      m.responses = m.responses.map((r) => {
        if (seen.has(r.label)) {
          return { label: r.label, detail: `（「${seen.get(r.label)}」と同じ対策）`, ref: true };
        }
        seen.set(r.label, m.label.split('／')[0]);
        return r;
      });
    }
    return merged.map(({ key, ...rest }) => rest);
  }

  // 著述のビューモデル（M4）: 著述のある敵では著述を正とする。
  // 単位は「この脅威には、これで受ける」の対（2026-11-19 構造変更）。
  // 脅威の羅列と対策の羅列を別々に並べると、どれがどれに効くかの照合が
  // 読み手の作業になるため、対の形で渡す。どの対にも入らない戦術は
  // 全体の進め方として分ける。要約ピルは要注意ギミックと非効率的な
  // 手段だけ（戦術のピル列は対と重なるため置かない）。
  // 対データが無い著述（移行前の形）では、脅威を対の頭に立てて戦術を
  // 全体の進め方へ落とす（表示が壊れないための受け皿）。
  function authoredPairsVm(entry, threatLabelOf, threatDetailOf, tacticDetailOf) {
    const threats = entry.threats || [];
    const tactics = entry.effectiveTactics || [];
    const byLabel = new Map(tactics.map((t) => [t.label, t]));
    const resolve = (label) => {
      const t = byLabel.get(label);
      return t ? { label: t.label, detail: tacticDetailOf(t) } : null;
    };
    if (Array.isArray(entry.pairs)) {
      const rawPairs = entry.pairs.map((p) => {
        const t = threats.find((x) => threatLabelOf(x) === p.threat);
        return {
          label: p.threat,
          detail: t ? threatDetailOf(t) : '',
          responses: (p.responses || []).map(resolve).filter(Boolean),
        };
      });
      const pairs = mergeSharedPairs(rawPairs);
      const overall = (entry.overallTactics || []).map(resolve).filter(Boolean);
      return { pairs, overall };
    }
    return {
      pairs: threats.map((t) => ({ label: threatLabelOf(t), detail: threatDetailOf(t), responses: [] })),
      overall: tactics.map((t) => ({ label: t.label, detail: tacticDetailOf(t) })),
    };
  }

  function bossAuthoredVm(entry, opts = {}) {
    // 点穴・エレキが主役の戦術には、この敵のHPに対する数を付ける
    // （必要点数・必要レベル。mechanics.js の計算）。ハイドロボムに
    // 触れる戦術には、敵別の目安（著述＋裏の計算）を付ける。材料が
    // 無い場合はどちらも出ない。
    const hp = typeof opts.enemyHp === 'number' ? opts.enemyHp : bossHpFromEntry(entry);
    const tacticDetailOf = (t) => {
      const parts = [t.detail || ''];
      const label = t.label || '';
      // 制限下では、Lv70 前提の目安行（点穴・エレキ・ハイドロボム）
      // は付けない。
      if (opts.restricted) return parts.filter(Boolean).join('\n');
      if (label.includes('点穴')) parts.push(...tenanaVsEnemyLines(hp));
      if (label.includes('エレキ')) parts.push(...erekiVsEnemyLines(hp));
      if (label.includes('ハイドロボム') || label.includes('錬ボム')
        || (t.detail || '').includes('ハイドロボム')) {
        parts.push(...hbombCalibrationLines(opts.name));
      }
      return parts.filter(Boolean).join('\n');
    };
    const { pairs, overall } = authoredPairsVm(
      entry, (t) => t.label, (t) => t.detail || '', tacticDetailOf);
    // 照合の状態（crossCheck）は記録側の情報で、画面には出さない
    // （2026-11-19: 作り手の言葉を画面から外す）。
    const notes = [];
    if (entry.versionNote) notes.push(entry.versionNote);
    return {
      title: 'ボス攻略',
      threatPills: (entry.threats || []).map((t) => t.label),
      ineffectivePills: (entry.ineffective || []).map((t) => t.item),
      pairs,
      overall,
      ineffectiveItems: (entry.ineffective || []).map((t) => ({ label: t.item, detail: t.reason || '' })),
      note: notes.join('\n') || null,
    };
  }

  function enemyAuthoredVm(entry, opts = {}) {
    // 候補は名前の羅列にしない: 索引から方法・媒体・運用条件を引き、
    // 時間依存の手段には速さ判定を付ける（counter.js の
    // annotateAuthoredTactic）。照合の状態（verification）は記録側の
    // 情報で、画面には出さない（2026-11-19）。
    // 戦術がどの対（脅威）に属するか。速さ判定は対の脅威の発生源で
    // 行う（監査G）。全体の進め方の戦術は対に属さず、種の値を使う。
    const pairThreatOf = new Map();
    for (const p of entry.pairs || []) {
      for (const label of p.responses || []) pairThreatOf.set(label, p.threat);
    }
    const tacticDetailOf = (t) => {
      // 制限下では、候補の注記を制限下で使える機構・形だけにし、
      // 速さ判定（Lv70 前提の対比）は付けない。点穴・ハイドロボムの
      // 目安行も Lv70 前提の数値のため付けない。
      const restricted = Boolean(opts.restricted);
      const pairSpd = !restricted && opts.threatSpdByLabel && pairThreatOf.has(t.label)
        ? opts.threatSpdByLabel.get(pairThreatOf.get(t.label)) : undefined;
      const ann = annotateAuthoredTactic({
        tactic: t,
        index: counterData ? counterData.index : null,
        spdById: restricted ? null : correctedSpdById(),
        conditionOf: opts.conditionOf || null,
        levelOf: opts.levelOf || null,
        enemySpd: restricted ? null
          : (typeof pairSpd === 'number' ? pairSpd
            : (typeof opts.enemySpd === 'number' ? opts.enemySpd : enemySpdOf(entry.name))),
        // 形の可否はマスごとの段階で決まるため、真偽ではなく
        // 段階そのものを演算へ渡す（counter.js が正規化する）。
        restricted: opts.restricted,
      });
      const parts = [t.basis || ''];
      if (ann.megidoTexts.length > 0) parts.push(`候補: ${ann.megidoTexts.slice(0, 8).join('、')}`);
      if (ann.orbTexts.length > 0) parts.push(`オーブ: ${ann.orbTexts.slice(0, 6).join('、')}`);
      // 点穴が主役の戦術には、この敵のHPに対する必要点数を付ける。
      // ハイドロボムの戦術には、敵別の目安を付ける（ボス著述と同じ）。
      const label = t.label || '';
      if (!restricted && label.includes('点穴')) parts.push(...tenanaVsEnemyLines(opts.enemyHp));
      if (!restricted && (label.includes('ハイドロボム') || label.includes('錬ボム'))) {
        parts.push(...hbombCalibrationLines(entry.name));
      }
      return parts.filter(Boolean).join('\n');
    };
    const { pairs, overall } = authoredPairsVm(
      entry, (t) => t.name, (t) => t.basis || '', tacticDetailOf);
    return {
      title: '攻略情報',
      threatPills: (entry.threats || []).map((t) => t.name),
      ineffectivePills: (entry.ineffective || []).map((t) => t.label),
      pairs,
      overall,
      ineffectiveItems: (entry.ineffective || []).map((t) => ({ label: t.label, detail: t.basis || '' })),
      note: null,
    };
  }

  // その敵の著述を引く。引き方そのものは counter.js の authoredEntryFor
  // が正本（M4・M5・H6 で同じ引き方を使い、結論を揃えるため）。
  function authoredFor(name, def, opts = {}) {
    const found = authoredEntryFor(
      tacticsData, name, def, sheetCtx ? sheetCtx.squareId : null);
    if (!found) return null;
    const rules = def ? def.rules : null;
    const restricted = restrictionOf(def);
    const enemyHp = typeof opts.enemyHp === 'number' ? opts.enemyHp : enemyHpOf(name, floorEnemies, rules);
    const enemySpd = typeof opts.enemySpd === 'number' ? opts.enemySpd : enemySpdOf(name, floorEnemies, rules);
    // 著述の対ごとの速さ判定の基準（監査G）: 統合脅威のラベルから、
    // その脅威の発生源の素早さを引けるようにしておく。
    let threatSpdByLabel = null;
    if (found.kind === 'enemy' && !restricted && counterData && floorEnemies) {
      const fact = floorEnemies.enemies ? floorEnemies.enemies[name] : null;
      if (fact) {
        const unified = enemyThreatsUnified({
          fact, authored: found, clsById: counterData.clsById, threatLevels: counterData.threatLevels,
        });
        threatSpdByLabel = new Map();
        for (const u of unified) {
          if (u.derived) {
            threatSpdByLabel.set(u.label, enemySpdForThreat(name, floorEnemies, rules, u.derived));
          }
        }
      }
    }
    return found.kind === 'boss'
      ? bossAuthoredVm(found.entry, { name, enemyHp, restricted })
      : enemyAuthoredVm(found.entry, { ...opts, enemyHp, enemySpd, restricted, threatSpdByLabel });
  }

  // 導出の脅威1件のビューモデル（M4 の敵読みと、編成構築のターゲット節の
  // ギミック表示で同じ形を使う）。fe は敵データの階（速さ判定の材料）。
  function threatVm(t, derived, fe = floorEnemies, rules = null, restricted = false) {
    const threatDef = counterData.clsById.get(t.threatId);
    // 敵の耐性で演算上無効な付与系の効果は候補に数えない（型5）。
    const enemyFact = fe && fe.enemies ? fe.enemies[t.enemyName] : null;
    // 速さ判定は脅威の発生源の個体で行う（監査G）。制限下では付けない。
    const eSpd = restricted ? null : enemySpdForThreat(t.enemyName, fe, rules, t);
    const classes = (threatDef ? threatDef.classes : [])
      .filter((c) => classApplies(c, t.methods))
      .map((c) => {
        const cand = candidatesForClass(c, counterData.index, derived.owned, levelOf, { enemyFact, restricted });
        // 候補は名前の羅列にしない: 方法・媒体・運用条件を付け、
        // 時間依存の手段には速さ判定を付ける（counter.js）。
        // 耐性の候補には、その人の耐性の合計（個別＋汎用の合算）を
        // 併記する。絶好調の者はゲームの仕様で +50% が上乗せされる
        // ため、合計にも含めて出す。
        const candText = (h, orb) => candidateText({
          name: h.name, means: h.means, orb,
          spd: orb || restricted ? null : effSpdStandalone(h.id, derived.conditionOf(h.id)),
          enemySpd: eSpd,
          resistTotal: typeof h.resistTotal === 'number' ? h.resistTotal : null,
          resistBonus: !orb && derived.conditionOf(h.id) === 0 ? 50 : 0,
        });
        const megidoText = cand.megido.slice(0, 8).map((h) => candText(h, false)).join('、')
          + (cand.megido.length > 8 ? `、ほか${cand.megido.length - 8}体` : '');
        const orbsText = cand.orbs.slice(0, 6).map((h) => candText(h, true)).join('、')
          + (cand.orbs.length > 6 ? `、ほか${cand.orbs.length - 6}件` : '');
        return {
          label: c.label,
          how: c.how || '',
          methodNote: c.methodNote || '',
          noteOnly: cand.noteOnly,
          candidatesText: megidoText,
          orbsText,
        };
      });
    return {
      name: t.name,
      enemyName: t.enemyName,
      methodText: t.methods.length > 0 ? t.methods.map((m) => METHOD_LABEL[m] || m).join('・') : '',
      summary: threatDef ? threatDef.summary || '' : '',
      evidence: t.evidence ? t.evidence.slice(0, 70) : '',
      classes,
    };
  }

  // 敵シートの追加材料（敵シート作り直し、2026-11-20）: 統合脅威
  // リストから、発生源別の脅威（導出分）と、答えカルーセルと、耐性
  // アコーディオンの材料を敵ごとに組む。著述の脅威は原資料（対）側に
  // 出るため、発生源別には導出の脅威だけを入れる（二重に出さない）。
  function enemySheetExtras({ name, fact, raw, def, derived }) {
    const clsByIdL = counterData.clsById;
    // 31階の制限マスでは、答え・候補を制限下の演算に寄せ、速さ判定
    // （Lv70 前提の対比）は付けない。段階はマスのルールから読む。
    const restricted = restrictionOf(def);
    const unified = enemyThreatsUnified({
      fact, authored: raw, clsById: clsByIdL, threatLevels: counterData.threatLevels,
    });
    // 答えのブロック: 脅威ごとの答え（対策クラス）を集め、シート
    // 表示用に敵の3役（ディーラー／サポート／ジャマー）と「倒す」
    // へ寄せて再構成する（2026-11-26、counter.js の
    // prepareSheetEntries / recomposeSheetAnswerBlocks。脅威×答えで
    // 並べると汎用ブロックが状態異常ごとに重複し、ポイントが
    // 読めない量になるというユーザー指摘への対応）。これは表示の
    // 成型だけで、判定（ピッカーの印・需要・対策の行）は脅威ごと
    // のブロックを直接使う側に残る。需要の印は、必須級の需要が
    // ある候補にだけ付ける（相談 5-15: 全員には付けない）。
    const demand = currentDemand(derived);
    const essentialIds = new Set();
    if (demand) for (const [id, d] of demand) if (d.essential > 0) essentialIds.add(id);
    const candText = (enemySpd, h, orb) => {
      const text = candidateText({
        name: h.name, means: h.means, orb,
        spd: orb || restricted ? null : effSpdStandalone(h.id, derived.conditionOf(h.id)),
        enemySpd,
        resistTotal: typeof h.resistTotal === 'number' ? h.resistTotal : null,
        resistBonus: !orb && h.id && derived.conditionOf(h.id) === 0 ? 50 : 0,
      });
      return !orb && h.id && essentialIds.has(h.id) ? `${text}（後の階で出番がある可能性あり）` : text;
    };
    const levelRank = (l) => (l === 'S' ? 0 : l === 'A' ? 1 : l === 'B' ? 2 : 3);
    // 脅威ごとのブロックを平らに集める（全体の進め方の戦術も含む。
    // SW95 便2、監査C）。全体の戦術は脅威に紐づかないため脅威
    // ラベルは付けない。ブロックに寄った戦術は、ポイント側で
    // 文章のポイントと二重に出さない（enemyPointsVm の
    // coveredTactics）。
    const sheetEntries = [];
    for (const t of unified) {
      // 速さ判定は脅威の発生源の個体で行う（監査G）。
      const tSpd = restricted ? null : enemySpdForThreat(name, floorEnemies, def.rules, t.derived);
      for (const b of threatAnswerBlocks({
        threat: t, fact, authored: raw, clsById: clsByIdL,
        index: counterData.index, owned: derived.owned, levelOf, restricted,
      })) {
        sheetEntries.push({ ...b, threatLabel: t.label, level: t.level, enemySpd: tSpd, threat: t });
      }
    }
    if (raw && raw.kind === 'enemy') {
      for (const b of authoredOverallBlocks({
        authored: raw, clsById: clsByIdL,
        index: counterData.index, owned: derived.owned, levelOf, restricted,
      })) {
        sheetEntries.push({ ...b, threatLabel: null, level: null, enemySpd: null });
      }
    }
    // 高防御の敵への固定ダメージの別解（2026-11-26 追加指示、
    // A5「必要火力の目安」）。著述の有無によらない材料のため、
    // 事実と索引だけで組む。材料は counter.js の fixedDamageBlocks
    // （防御の物差し・式・候補はそちらが正）。制限マスでは出さない。
    if (!restricted) {
      for (const b of fixedDamageBlocks({
        fact, index: counterData.index, owned: derived.owned, levelOf,
      })) {
        sheetEntries.push({ ...b, threatLabel: null, level: null, enemySpd: null });
      }
    }
    // 文章だけの戦術の機械接続（型3）: 配置・編成の形と、トランスの
    // 始動役を、対策の型として材料に足す。役の軸とは別枠
    // （groupKey 'shape'）で、再構成では素通しする。
    if (raw && raw.kind === 'enemy') {
      const notes = counterData.mechanicNotes;
      for (const tac of raw.entry.effectiveTactics || []) {
        if ((tac.meansEffects || []).length > 0) continue;
        const cls = classifyProseTactic(tac);
        if (!cls) continue;
        if (cls.kind === 'placement') {
          sheetEntries.push({
            classId: null, label: `配置で答える（${cls.label}）`,
            how: '', methodNote: '', noteOnly: true, authored: false, tacticLabel: null,
            megido: [], orbs: [], threatLabel: null, level: null, enemySpd: null,
            groupKey: 'shape', shapeKind: 'placement',
            detail: tac.basis || '', startersText: '',
          });
        } else if (cls.kind === 'trance' && notes && notes.tranceStarters) {
          const starters = [];
          for (const [id, fams] of Object.entries(notes.tranceStarters)) {
            if (!(fams || []).includes(cls.family)) continue;
            if (derived.owned && !derived.owned.has(id)) continue;
            starters.push(nameOf(id));
          }
          if (starters.length > 0) {
            sheetEntries.push({
              classId: null, label: `${cls.family}を始動できる人を入れる`,
              how: '', methodNote: '', noteOnly: false, authored: false, tacticLabel: null,
              megido: [], orbs: [], threatLabel: null, level: null, enemySpd: null,
              groupKey: 'shape', shapeKind: 'trance',
              detail: tac.basis || '', startersText: starters.join('、'),
            });
          }
        }
      }
    }
    // 脅威レベルが全て S の敵では、速攻の答えは出さず理由を出す
    // （下書き段階づけの使い方。段階はデータ側にあり差し替え可能）。
    // 材料の段階で外す（ブロックは脅威ごとに分かれているため、
    // 速攻の材料は脅威の数だけある。全て外す）。
    const allS = unified.length > 0 && unified.every((t) => t.level === 'S');
    let rushNote = null;
    let liveEntries = sheetEntries;
    if (allS) {
      const before = liveEntries.length;
      liveEntries = liveEntries.filter((e) => e.classId !== 'rush');
      if (liveEntries.length !== before) {
        rushNote = '速攻で倒し切る相手ではありません。';
      }
    }
    // 3役の寄せ先を付け、寄せ先ごとに1ブロックへ再構成する。
    const prepared = prepareSheetEntries(liveEntries, { fact, roles: counterData.roles, clsById: clsByIdL });
    const rawBlocks = recomposeSheetAnswerBlocks(prepared.entries).map((b) => ({
      kind: b.shapeKind || (b.authored ? 'authored' : 'class'),
      classId: b.classId || null, label: b.label, how: b.how || '',
      methodNote: b.methodNote || '', noteOnly: Boolean(b.noteOnly),
      threatLabels: b.threatLabels || [],
      tacticLabels: b.tacticLabels || [],
      groupKey: b.groupKey || null,
      maxRank: levelRank(b.level),
      megidoList: b.megido, orbsList: b.orbs,
      detail: b.detail || '', startersText: b.startersText || '', enemySpd: b.enemySpd,
    }));
    rawBlocks.sort((a, b) => a.maxRank - b.maxRank);
    const blocks = rawBlocks.map((b) => ({
      kind: b.kind, label: b.label, how: b.how, methodNote: b.methodNote,
      noteOnly: b.noteOnly, threatLabels: b.threatLabels, tacticLabels: b.tacticLabels || [],
      groupKey: b.groupKey,
      detail: b.detail,
      startersText: b.startersText,
      candidatesText: b.megidoList.slice(0, 8).map((h) => candText(b.enemySpd, h, false)).join('、')
        + (b.megidoList.length > 8 ? `、ほか${b.megidoList.length - 8}体` : ''),
      orbsText: b.orbsList.slice(0, 6).map((h) => candText(b.enemySpd, h, true)).join('、')
        + (b.orbsList.length > 6 ? `、ほか${b.orbsList.length - 6}件` : ''),
    }));
    return {
      carousel: blocks.length > 0 || rushNote ? { blocks, rushNote } : null,
      // 文章ポイントの寄せ先を決める材料（脅威ラベル → 3役）。
      threatRoles: prepared.threatRoles,
      // 耐性の値の出所（SW95 便1 で材料化）: 'main' の種は塔版で
      // 未検証、という区分そのものは材料として残す。表示側の
      // 添え書きは 2026-11-26 の判断で廃止した（判断の記録は
      // hidden_files/resistance-table-work/judgment.md）。
      resistanceProvenance: resistanceProvenanceOf(fact),
    };
  }

  // 敵の簡単な説明（SW91）: 導出の脅威（種族特効を除く）を、手段
  // （特性／スキル／覚醒スキル／奥義）ごとにまとめた1〜2行。
  // 材料は脅威導出が既に拾っている範囲だけ（付与する状態異常・
  // 即死・戦術系）。導出で拾える脅威が無い種は、統合後の材料
  // （著述の脅威）から同じ形で組む（SW95 便2、counter.js の
  // authoredSummaryText）。どちらの材料も無い種には作らない
  // （無理に作らない）。
  function enemySummaryText(fact, raw = null) {
    if (!fact || !counterData) return '';
    const { threats } = threatsForEnemy(fact, counterData.clsById);
    const byMethod = new Map();
    const bare = [];
    for (const t of threats) {
      if (t.threatId.startsWith('race:')) continue;
      const label = String(t.name || '').replace(/（敵）$/, '');
      if (!label) continue;
      const methods = (t.methods || []).filter((m) => METHOD_LABEL[m]);
      if (methods.length === 0) {
        if (!bare.includes(label)) bare.push(label);
        continue;
      }
      for (const m of methods) {
        if (!byMethod.has(m)) byMethod.set(m, []);
        const list = byMethod.get(m);
        if (!list.includes(label)) list.push(label);
      }
    }
    const parts = [];
    for (const m of ['trait', 'skill', 'awakened', 'ougi']) {
      const list = byMethod.get(m);
      if (list && list.length) parts.push(`${METHOD_LABEL[m]}で${list.join('・')}`);
    }
    if (bare.length) parts.push(bare.join('・'));
    if (parts.length) return `${parts.join('、')}。`;
    return authoredSummaryText(raw);
  }

  // 攻略のポイント（SW91）: 統合の答えブロックと著述の対・全体を、
  // ◇＋短い小タイトル（行ラベル）＋本文（根拠と具体名）の形に
  // 並べ替えたもの。新しい導出は足さない: ブロックに寄せられた
  // 著述の戦術はブロック側に出し、寄せられなかった対の応答と
  // 全体の進め方だけを、著述の文のままポイントにする。ボスは
  // 機械のブロックが無いため、対と全体がそのままポイントになる。
  // 2026-11-26: ポイントは敵の3役の寄せ先ごとに畳み、既定3件に
  // 収める（counter.js の mergeSheetPoints）。文章ポイントは同じ
  // 寄せ先のブロックポイントへ畳まれる。
  function enemyPointsVm(extras, authoredVm, raw) {
    const points = [];
    const blocks = extras.carousel ? extras.carousel.blocks : [];
    const blank = {
      threatText: '', how: '', methodNote: '', detail: '', detailText: '',
      startersText: '', candidatesText: '', orbsText: '', noteOnly: false,
      groupKey: null, prose: false,
    };
    for (const b of blocks) {
      points.push({
        ...blank,
        title: b.label,
        threatText: (b.threatLabels || []).join('、'),
        how: b.how, methodNote: b.methodNote, detail: b.detail,
        startersText: b.startersText, candidatesText: b.candidatesText,
        orbsText: b.orbsText, noteOnly: b.noteOnly,
        groupKey: b.groupKey || null,
      });
    }
    if (authoredVm) {
      const coveredTactics = new Set();
      const coveredThreats = new Set();
      for (const b of blocks) {
        for (const l of b.tacticLabels || []) coveredTactics.add(l);
        for (const l of b.threatLabels || []) coveredThreats.add(l);
      }
      const isBoss = Boolean(raw && raw.kind === 'boss');
      const threatRoles = extras.threatRoles || null;
      for (const pair of authoredVm.pairs) {
        const pairGroup = sheetPairGroupKey({ label: pair.label, threatRoles });
        if (pair.responses.length === 0) {
          if (!isBoss && coveredThreats.has(pair.label)) continue;
          points.push({
            ...blank, title: pair.label, detailText: pair.detail,
            groupKey: pairGroup, prose: true,
          });
          continue;
        }
        for (const r of pair.responses) {
          if (!isBoss && coveredTactics.has(r.label)) continue;
          points.push({
            ...blank,
            title: r.label,
            threatText: pair.label,
            detailText: isBoss
              ? [pair.detail, r.detail].filter(Boolean).join('\n')
              : r.detail,
            groupKey: pairGroup, prose: true,
          });
        }
      }
      for (const t of authoredVm.overall) {
        // ブロックに寄った全体の戦術は、ブロック側のポイントで
        // 候補つきで出ているため、文章のポイントは重ねない
        // （SW95 便2。対の応答と同じ扱い）。
        if (!isBoss && coveredTactics.has(t.label)) continue;
        points.push({
          ...blank, title: t.label, detailText: t.detail,
          groupKey: sheetOverallGroupKey({ label: t.label }), prose: true,
        });
      }
    }
    return mergeSheetPoints(points);
  }

  // 敵を読む（M4）のビューモデル: 脅威 → 対策クラス → 候補（所持で絞る）。
  // 材料が読めていない場合は null（節自体を出さない）。
  // 著述のある敵は著述を正とし、その敵の導出の脅威は出さない（著述が
  // 脅威の切り分けを担う。追記15: 導出は同マスの別種の能力文を混ぜる
  // ことがあるため、種別ごとの著述で置き換える）。
  // 耐性一覧の表（2026-11-26 判断、resistance-table-work）:
  // マス単位で1つ。行 = 状態異常・効果の項目（そのマスの全構成員の
  // 記号表の和集合）、列 = 敵（本体＋取り巻き、編成の並び順）。
  // セルは VH の記号だけ（画面に「VH」の表記は出さない）。
  // 本体の表は種の symbolTable、取り巻きは生成データの
  // minionTables を使う。取り巻きに固有の表が無ければ、その列は
  // 全て「ー」（データ無しを埋めない）。同じ名前・同じ表の列は
  // 1列に寄せる（地縛霊×4 のような同名反復を4列にしない）。
  // 行の並びは本体の表の順を先にし、取り巻きだけの項目を後ろに足す。
  function resistTableVm(def) {
    if (!floorEnemies || !floorEnemies.enemies) return null;
    const columns = [];
    const seen = new Set();
    const bodyTables = [];
    for (const speciesName of def.enemies || []) {
      const fact = floorEnemies.enemies[speciesName];
      if (!fact) continue;
      const res = fact.resistances || {};
      const bodyTable = res.symbolTable || null;
      if (bodyTable) bodyTables.push(bodyTable);
      const party = Array.isArray(fact.party) ? fact.party.filter(Boolean) : [];
      const members = party.length > 0 ? party : [{ name: speciesName, leader: true }];
      for (const p of members) {
        const isBody = Boolean(p.leader) || p.name === speciesName
          || p.name === speciesName.replace(/（31階）$/, '');
        const table = isBody ? bodyTable : ((res.minionTables || {})[p.name] || null);
        const sig = `${p.name}${JSON.stringify(table)}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        const cells = new Map();
        if (table) {
          for (const [key, grades] of Object.entries(table)) {
            const nm = normalizePoleName(key);
            const vh = grades && grades[2] ? grades[2] : '';
            if (vh && !cells.has(nm)) cells.set(nm, vh);
          }
        }
        columns.push({ name: p.name, cells });
      }
    }
    if (columns.length === 0) return null;
    const rowNames = [];
    const addRow = (nm) => { if (!rowNames.includes(nm)) rowNames.push(nm); };
    for (const t of bodyTables) for (const key of Object.keys(t)) addRow(normalizePoleName(key));
    for (const c of columns) for (const nm of c.cells.keys()) addRow(nm);
    const rows = rowNames
      .map((nm) => ({ name: nm, cells: columns.map((c) => c.cells.get(nm) || 'ー') }))
      .filter((r) => r.cells.some((v) => v !== 'ー'));
    if (rows.length === 0) return null;
    return {
      columns: columns.map((c) => c.name),
      rows,
      open: Boolean(sheetCtx && sheetCtx.resistTableOpen),
    };
  }

  function counterVm(def, derived) {
    if (!counterData || !floorEnemies) return null;
    const found = threatsForSquare({ def, floorEnemies, clsById: counterData.clsById });
    if (!found) return null;
    const authoredByEnemy = new Map();
    for (const name of def.enemies || []) {
      authoredByEnemy.set(name, authoredFor(name, def, { conditionOf: derived.conditionOf, levelOf }));
    }
    const enemies = found.enemies.map((e) => {
      // 非直観的な仕組みの注記（M4）: 敵が持つ仕組みと、著述に載る
      // 仕組みへの1行。材料は導出の脅威・敵自身の能力文・著述の文。
      const fact = floorEnemies.enemies[e.name];
      const factParts = [];
      for (const p of (fact && fact.party) || []) {
        if (!p) continue;
        if (p.trait) factParts.push(p.trait);
        for (const v of Object.values(p.skills || {})) if (v) factParts.push(String(v));
      }
      const raw = authoredEntryFor(
        tacticsData, e.name, def, sheetCtx ? sheetCtx.squareId : null);
      const threatTexts = [];
      const tacticTexts = [];
      if (raw) {
        const isBoss = raw.kind === 'boss';
        for (const t of raw.entry.threats || []) {
          threatTexts.push(isBoss ? `${t.label || ''} ${t.detail || ''}` : `${t.name || ''} ${t.basis || ''}`);
        }
        for (const t of raw.entry.effectiveTactics || []) {
          tacticTexts.push(isBoss ? `${t.label || ''} ${t.detail || ''}` : `${t.label || ''} ${t.basis || ''}`);
        }
      }
      const extras = enemySheetExtras({ name: e.name, fact, raw, def, derived });
      const authoredVm = authoredByEnemy.get(e.name) || null;
      const points = enemyPointsVm(extras, authoredVm, raw);
      const pointsOpenSet = sheetCtx && sheetCtx.pointsOpen
        ? sheetCtx.pointsOpen.get(e.name) : null;
      return {
        name: e.name,
        raceText: e.races.join('・'),
        races: e.races,
        weakText: e.weak.join('、'),
        immuneText: e.immune.join('、'),
        hasTexts: e.hasTexts,
        // 簡単な説明と攻略のポイント（SW91）。著述の原文そのものは
        // シートに出さない（ポイントの本文は、対・全体の文と
        // ブロックの候補で組み立てる）。
        summary: enemySummaryText(fact, raw),
        // 敵単位の修飾軸の注記（SW95 便3）: 出現・取り巻き・素早さ。
        unitNotes: threatUnitNotes(counterData.threatLevels, e.name),
        points,
        pointsNote: extras.carousel ? extras.carousel.rushNote : null,
        pointsOpen: points.map((_, i) => Boolean(pointsOpenSet && pointsOpenSet.has(i))),
        mechanicNotes: enemyMechanicNotes({
          enemyName: e.name,
          threatIds: found.threats.filter((t) => t.enemyName === e.name).map((t) => t.threatId),
          factTexts: factParts.join('\n'),
          authoredThreatTexts: threatTexts.join('\n'),
          authoredTacticTexts: tacticTexts.join('\n'),
        }),
        // かばう／執心の受け方の対応: 敵の攻撃構成（範囲・倍率・
        // ヒット数・クラス）から計算して組み立てる（確定記録）。
        // 構成員の能力文が無い敵には出ない。
        receivingNotes: enemyReceivingNotes(fact),
      };
    });
    // 需要の警告（M2）: このマスで、対策の候補が所持者のうち2体以下しか
    // いない脅威を出す（その者を他で使うと、ここが解けなくなる）。
    // 材料は統合演算（著述のある敵も、著述に対応しない導出の脅威は
    // 対象に含める。ボス著述の敵は導出の脅威への答えで数え、全体の
    // 進め方の戦術の保持者も対象に含める。SW95 便2）。
    const demandWarnings = [];
    for (const e of found.enemies) {
      const fact = floorEnemies.enemies[e.name];
      const raw = authoredEntryFor(
        tacticsData, e.name, def, sheetCtx ? sheetCtx.squareId : null);
      const isBoss = Boolean(raw && raw.kind === 'boss');
      const unified = isBoss
        ? derivedThreatsAsItems(fact, counterData.clsById)
        : enemyThreatsUnified({
          fact, authored: raw, clsById: counterData.clsById,
          threatLevels: counterData.threatLevels,
        });
      const groups = unified.map((t) => ({
        label: t.label,
        blocks: threatAnswerBlocks({
          threat: t, fact, authored: raw, clsById: counterData.clsById,
          index: counterData.index, owned: derived.owned, levelOf,
          restricted: restrictionOf(def),
        }),
      }));
      for (const g of groups) {
        const ids = new Set();
        for (const b of g.blocks) {
          for (const c of b.megido) if (candidateUsable(c)) ids.add(c.id);
        }
        if (ids.size > 0 && ids.size <= 2) {
          demandWarnings.push(
            `後の階で出番がある可能性あり: ${g.label}（${e.name}）の対策候補は ${[...ids].map(nameOf).join('、')} だけです。`);
        }
      }
      // 全体の進め方の戦術は、戦術単位で寄せて警告文を作る
      // （2026-11-25: ラベルが複数の手を並べる場合、注記は対応する
      // 手に付ける。組み立ては counter.js の
      // authoredTacticDemandWarnings）。
      const overallBlocks = authoredOverallBlocks({
        authored: raw, clsById: counterData.clsById,
        index: counterData.index, owned: derived.owned, levelOf,
        restricted: restrictionOf(def),
      });
      const tacticByLabel = new Map(
        (raw && raw.entry && raw.entry.effectiveTactics || []).map((t) => [t.label, t]));
      const blocksByTactic = new Map();
      for (const b of overallBlocks) {
        if (!blocksByTactic.has(b.tacticLabel)) blocksByTactic.set(b.tacticLabel, []);
        blocksByTactic.get(b.tacticLabel).push(b);
      }
      for (const [label, blocks] of blocksByTactic) {
        demandWarnings.push(...authoredTacticDemandWarnings({
          tactic: tacticByLabel.get(label) || null, blocks,
          clsById: counterData.clsById, enemyName: e.name, nameOf,
        }));
      }
    }
    // 種タブの選択（複数種のマスだけ意味を持つ）。選択が敵の列に
    // 無ければ先頭の敵にする。
    const enemyTab = sheetCtx && enemies.some((e) => e.name === sheetCtx.enemyTab)
      ? sheetCtx.enemyTab
      : (enemies.length > 0 ? enemies[0].name : null);
    return { enemies, enemyTab, demandWarnings, resistTable: resistTableVm(def) };
  }

  // 編成構築のターゲットが制限下か。判定の正はマスのルール
  // （counter.js の restrictionOf）。バリアント9種は制限マスにしか
  // 出ないため、敵名の「（31階）」末尾でも一致する（材料が揃わ
  // ない場面の補助に使う）。制限の効かせ方は
  // floor31-restriction-prep.md の相談の記録が正本: 候補・印・
  // カバー・需要は counter.js の restricted 演算に寄せ、シミュ
  // レーター類と Lv70 前提の数値判定は制限マスでは出さない。
  // ターゲットの制限の段階（星・Lv）。マスのルールから読むのが正で、
  // 段階はマスごとに違う（31階=星2.5/Lv23 等）。バリアントは制限
  // マスにしか出ないため、敵名の「（31階）」末尾だけが材料の場面
  // では31階の段階を返す。制限が無ければ null。
  function targetRestriction() {
    if (!buildCtx || !buildCtx.targetEnemy) return null;
    for (const { def } of targetSquares()) {
      const r = restrictionOf(def);
      if (r) return r;
    }
    if (/（31階）$/.test(buildCtx.targetEnemy)) return RESTRICTION_31F;
    return null;
  }

  function targetRestricted() {
    return targetRestriction() !== null;
  }

  // 対象の表示名（階＋敵名）。エディタの対象チップとピッカーの案内で
  // 同じ形を使う。
  function targetTextOf() {
    if (!buildCtx || !buildCtx.targetEnemy) return null;
    const floors = targetFloorsOf();
    return floors.length > 0
      ? `${floors.map((f) => `${f}F`).join('・')} ${buildCtx.targetEnemy}`
      : buildCtx.targetEnemy;
  }

  // 敵の小帯（SW92）: 対象の敵の簡単な説明1行と、攻略のポイントの
  // ◇タイトルだけを返す。枠より前に敵情報を何画面も置かず、枠の
  // そばで判断材料を足りる分だけ見せるための帯。説明とポイントは
  // マスシートと同じ組み立て（enemySummaryText / enemyPointsVm）で
  // 作り、画面ごとに食い違わないようにする。材料が引けない敵では
  // 説明・タイトルは空（帯の対象チップだけが出る）。
  function targetBandVm(derived) {
    if (!buildCtx || !buildCtx.targetEnemy) return null;
    const band = { summary: '', pointTitles: [] };
    if (!counterData || !allFloorsEnemies) return band;
    for (const { fe, squareId, def } of targetSquares()) {
      const fact = fe && fe.enemies ? fe.enemies[buildCtx.targetEnemy] : null;
      if (!fact) continue;
      const raw = tacticsData
        ? authoredEntryFor(tacticsData, buildCtx.targetEnemy, def, squareId) : null;
      band.summary = enemySummaryText(fact, raw);
      const extras = enemySheetExtras({
        name: buildCtx.targetEnemy, fact, raw, def, derived,
      });
      const authoredVm = authoredFor(buildCtx.targetEnemy, def, {
        conditionOf: derived.conditionOf, levelOf,
      });
      band.pointTitles = enemyPointsVm(extras, authoredVm, raw).map((p) => p.title);
      break;
    }
    return band;
  }

  // 編成構築のターゲットの階: 階を選んでいればその階、無ければその敵が
  // 出る全階（ターゲット選択の階チップと同じ材料）。
  function targetFloorsOf() {
    if (!buildCtx || !buildCtx.targetEnemy) return [];
    if (buildCtx.targetFloors.length > 0) return [...buildCtx.targetFloors].sort((a, b) => a - b);
    return floorsForEnemy(structure, buildCtx.targetEnemy);
  }

  // ターゲットに出る戦闘・ボスマスを、階ごとに歩く（ギミック表示と
  // ピッカーのヒントで同じ歩き方を使う）。
  function* targetSquares() {
    for (const floor of targetFloorsOf()) {
      const fe = allFloorsEnemies ? allFloorsEnemies.get(floor) : null;
      const fd = floorData(structure, floor);
      if (!fe || !fd) continue;
      for (const [squareId, def] of Object.entries(fd.squares)) {
        if (!def || (def.type !== 'battle' && def.type !== 'boss')) continue;
        if (!(def.enemies || []).includes(buildCtx.targetEnemy)) continue;
        yield { floor, fe, squareId, def };
      }
    }
  }


  // 対策の行（SW92、問題Eの実装形。見出しと行の文の形式は 2026-11-25
  // マスター決定で「編成が満たしているギミック」＋具体形に変更）:
  // 脅威ごとに行を作り、判定の範囲をそのまま文章にする。「対策済み」の
  // 一括り断定はしない。判定材料は従来と同じ既存の判定（著述の対は
  // authoredPairCoverage、導出の脅威は formationCoverage）で、ここでは
  // その内訳（counter.js の Detail 関数）から文章に組み立てるだけ。
  // 行の文の形式（マスター決定）:
  //   - 満たしている分は「{効果}が{担い手}によって有効」。ME 由来は
  //     届く枠も書く（届かない枠がある行は「一部」として色を弱める）。
  //   - 足りない分は「{戦術・効果}が不足（{どの手段}の手段が編成に
  //     無い）」。
  //   - 耐性系の不足には％を付ける（案A、2026-11-25 マスター決定）:
  //     「{効果}が不足（編成で一番高い{名前}が{合計}%で、あと{不足}%）」。
  //     物差しは編成内でその異常への耐性合計が一番高いメンバーで、
  //     合計の計算は候補文と同一（counter.js の bestResistMember）。
  //     合計が付かない・0%・100%の分と、耐性以外の不足には付けない。
  //   - 即死への答えが蘇生1人だけの時は、その人が落ちると切れる
  //     ことを書く（単独依存）。
  // 判定できない対（応じる戦術が無い・文章だけ）とボス（著述が正で
  // 機械判定の材料が無い）は行にしない。材料が読めていない場合と、
  // 行が1件も無い場合は null（区画自体を出さない）。
  const counterSlotList = (positions) => positions.map((p) => `枠${p}`).join('・');
  // 効果1件分の「有効」の句。holders は担い手の表記（本人・オーブ）の
  // 並び、me は ME 由来の届く範囲。ME が一部の枠にしか届かない時は
  // onMePartial を呼ぶ（行の状態を「一部」にする従来の条件そのまま）。
  const counterEffectClauses = (e, onMePartial) => {
    const clauses = [];
    if (e.holders.length > 0) {
      clauses.push(`${e.name}が${e.holders.join('、')}によって有効`);
    }
    for (const mc of e.me) {
      if (mc.positions.length > 0 && mc.missed.length > 0) {
        onMePartial();
        clauses.push(`${e.name}が${mc.name}のMEによって有効（届くのは${counterSlotList(mc.positions)}だけ）`);
      } else {
        clauses.push(`${e.name}が${mc.name}のMEによって有効`);
      }
    }
    return clauses;
  };
  // 入っていない戦術1件分の「不足」の句（根拠＝その戦術の手段の不在）。
  const counterMissClause = (m) => (m.effects.length > 0
    ? `${m.label}が不足（${m.effects.join('・')}の手段が編成に無い）`
    : `${m.label}が不足（編成に手段が無い）`);
  function targetCountersVm(derived) {
    if (!buildCtx || !buildCtx.targetEnemy || !counterData || !structure) return null;
    const formation = { slots: buildCtx.slots };
    // 耐性系の不足1件分の％つきの句（案A）。対象は effectId が
    // resist:{異常} の分だけ（汎用耐性そのものは、特定の異常への
    // 合計に直せないため付けない）。合計は候補文と同一の計算
    // （bestResistMember）で、合計が付かない・0%・100%の場合は
    // 不足分として意味を持たないため null（％なしで出す）。
    const resistPercentClause = (effectId, effectName, restricted) => {
      if (!effectId || !effectId.startsWith('resist:') || effectId === 'resist:any') return null;
      const best = bestResistMember({
        formation, ailment: effectId.slice('resist:'.length),
        index: counterData.index, levelOf,
        conditionOf: derived && typeof derived.conditionOf === 'function' ? derived.conditionOf : null,
        styleClassOf, restricted,
      });
      if (!best || best.total <= 0 || best.total >= 100) return null;
      return `${effectName}が不足（編成で一番高い${nameOf(best.id)}が${best.total}%で、あと${100 - best.total}%）`;
    };
    // 不足した効果の並び（[{ effectId, name }]）を、％の付く耐性の句と
    // 残りの効果名に分ける（どちらも元の順序を保つ）。
    const partitionMissedEffects = (effects, restricted) => {
      const pctClauses = [];
      const restNames = [];
      for (const e of effects || []) {
        const pc = resistPercentClause(e.effectId, e.name, restricted);
        if (pc) pctClauses.push(pc);
        else if (!restNames.includes(e.name)) restNames.push(e.name);
      }
      return { pctClauses, restNames };
    };
    const rows = [];
    const seenEntries = new Set();
    const derivedThreats = [];
    const seenThreats = new Set();
    let statusFact = null;
    let firstRaw = null;
    for (const { fe, squareId, def } of targetSquares()) {
      const raw = tacticsData
        ? authoredEntryFor(tacticsData, buildCtx.targetEnemy, def, squareId) : null;
      const fact = fe && fe.enemies ? fe.enemies[buildCtx.targetEnemy] : null;
      if (!statusFact && fact) { statusFact = fact; firstRaw = raw; }
      if (raw) {
        if (seenEntries.has(raw.entry)) continue;
        seenEntries.add(raw.entry);
        if (raw.kind === 'enemy') {
          for (const p of authoredPairCoverageDetail({
            authored: raw, formation, index: counterData.index, levelOf, styleClassOf,
            enemyFact: fact, restricted: restrictionOf(def),
          })) {
            if (p.hits.length === 0) {
              // 答えが1つも入っていない行: 入っていない戦術ごとに、
              // その手段が編成に無いことを根拠として書く。耐性系の
              // 不足には％の句を分けて付ける（案A）。
              const clauses = (p.missDetails || []).flatMap((m) => {
                if (!m.effectIds || m.effects.length === 0) return [counterMissClause(m)];
                const { pctClauses, restNames } = partitionMissedEffects(
                  m.effects.map((name, i) => ({ effectId: m.effectIds[i], name })),
                  restrictionOf(def),
                );
                if (pctClauses.length === 0) return [counterMissClause(m)];
                const out = [];
                if (restNames.length > 0) out.push(counterMissClause({ label: m.label, effects: restNames }));
                out.push(...pctClauses);
                return out;
              });
              rows.push({
                label: p.label, kind: p.kind, state: 'none',
                text: clauses.length > 0 ? clauses.join('。') : '答えが不足（編成に手段が無い）',
              });
              continue;
            }
            // 満たしている分は効果ごとに「{効果}が{担い手}によって
            // 有効」と書く（合体した脅威で片方の効果しか入っていない
            // 時に、戦術名だけで言い切らない）。足りない分は、戦術内の
            // 効果単位と戦術単位で「不足（手段が編成に無い）」と書く。
            // 範囲が戦術の全幅より狭い行は「一部」として色を弱める
            // （一部になる条件は従来どおり: 効果の一部欠け・ME の
            // 届かない枠）。
            const clauses = [];
            let partial = false;
            for (const h of p.hits) {
              for (const e of h.effects) {
                clauses.push(...counterEffectClauses({
                  name: e.name,
                  holders: e.holders.map(coveredByShortName),
                  me: e.me,
                }, () => { partial = true; }));
              }
              if (h.missedEffects && h.missedEffects.length > 0) {
                partial = true;
                const { pctClauses, restNames } = partitionMissedEffects(h.missedEffects, restrictionOf(def));
                if (restNames.length > 0) {
                  clauses.push(`${restNames.join('・')}が不足（編成に手段が無い）`);
                }
                clauses.push(...pctClauses);
              }
            }
            for (const m of p.missDetails || []) clauses.push(counterMissClause(m));
            rows.push({
              label: p.label, kind: p.kind,
              state: partial ? 'partial' : 'covered',
              text: [...new Set(clauses)].join('。'),
            });
          }
        }
        continue;
      }
    }
    // 統合リストの導出脅威（著述に対応しないもの）も行に出す
    // （敵シート作り直し、2026-11-20）。対応付けは最初に当たった
    // マスの著述で行い、種単位で1回だけ数える。
    if (statusFact) {
      if (!(firstRaw && firstRaw.kind === 'boss')) {
        const unified = enemyThreatsUnified({
          fact: statusFact, authored: firstRaw, clsById: counterData.clsById,
          threatLevels: counterData.threatLevels,
        });
        for (const t of unified) {
          if (t.source !== 'derived') continue;
          if (seenThreats.has(t.threatId)) continue;
          seenThreats.add(t.threatId);
          derivedThreats.push({ ...t.derived, enemyName: buildCtx.targetEnemy });
        }
      }
    }
    if (derivedThreats.length > 0) {
      const details = formationCoverageDetail({
        formation, threats: derivedThreats,
        clsById: counterData.clsById, index: counterData.index,
        levelOf, styleClassOf,
        enemyFact: statusFact, restricted: targetRestriction(),
      });
      for (const d of details) {
        const threatDef = counterData.clsById.get(d.threatId);
        const kind = threatDef ? threatDef.kind : null;
        if (d.direct.length === 0 && d.meCovers.length === 0 && d.orbs.length === 0) {
          // 答えが無い行: その脅威への答えになる手段（answerMeans）が
          // どれも編成に無いことを根拠として書く。耐性系の不足には
          // ％の句を分けて付ける（案A）。
          const { pctClauses, restNames } = partitionMissedEffects(d.answerEffects || [], targetRestriction());
          const clauses = [];
          if (restNames.length > 0) {
            clauses.push(`答えが不足（${restNames.join('・')}の手段が編成に無い）`);
          }
          clauses.push(...pctClauses);
          rows.push({
            label: d.name, kind, state: 'none',
            text: clauses.length > 0 ? clauses.join('。') : '答えが不足（編成に手段が無い）',
          });
          continue;
        }
        // 満たしている分は効果ごとに「{効果}が{担い手}によって有効」
        // と書く。ME の届く範囲は保持者単位の合算（meCovers）で見る
        // （従来の行の範囲の言い方と状態の条件を変えないため）。
        const unionByName = new Map(d.meCovers.map((mc) => [mc.name, mc]));
        const clauses = [];
        let partial = false;
        for (const e of d.effects || []) {
          clauses.push(...counterEffectClauses({
            name: e.name,
            holders: [...e.holders, ...e.orbs.map((o) => `オーブ「${o}」`)],
            me: e.me.map((mc) => unionByName.get(mc.name) || mc),
          }, () => { partial = true; }));
        }
        rows.push({
          label: d.name, kind, state: partial ? 'partial' : 'covered',
          text: [...new Set(clauses)].join('。'),
        });
      }
    }
    // 単独依存（即死）: 対象に即死があり、編成の蘇生が1人だけで、
    // 即死そのものを防ぐ手段が無い時は、その人が落ちると答えが
    // 切れることを即死の行に足す。蘇生・耐性の有無は手段索引で
    // 機械的に数える（推測で書かない）。
    const sokushiRow = rows.find((r) => r.label.includes('即死') && r.state !== 'none');
    if (sokushiRow) {
      const memberIds = buildCtx.slots.map((s) => s.megidoId).filter(Boolean);
      const hasMeans = (pred) => memberIds.some((id) =>
        (counterData.index.byMegido.get(id) || []).some((m) => pred(m.effectId)));
      const revivers = memberIds.filter((id) =>
        (counterData.index.byMegido.get(id) || [])
          .some((m) => m.effectId === 'revive' || m.effectId.startsWith('revive:')));
      const prevented = hasMeans((e) => e === 'resist:即死')
        || buildCtx.slots.some((s) => s.orbId
          && (counterData.index.byOrb.get(s.orbId) || []).some((m) => m.effectId === 'resist:即死'));
      if (revivers.length === 1 && !prevented) {
        const name = nameOf(revivers[0]);
        sokushiRow.text += `。蘇生は${name}のみ。${name}が落ちると切れる`;
        sokushiRow.state = 'partial';
      }
    }
    if (rows.length === 0) return null;
    for (const r of rows) {
      const badge = gimmickBadge(r.label, r.kind);
      r.mark = badge.mark;
      r.color = badge.color;
    }
    return { rows };
  }

  // ターゲットへの対応（ピッカーのヒント）: ターゲットに決まった敵への
  // 対策の候補を、候補メギドの id → ラベルの対応と、候補オーブの
  // orbId → ラベルの対応で返す。演算は counter.js の
  // pickerAnswersForEnemy（統合演算）に一本化した（敵シート作り直し、
  // 2026-11-20）: 統合脅威リストの答え候補（導出の対策クラス＋著述の
  // 対に応じる戦術・全体の進め方の戦術の保持者）＋種族特効＋状態
  // 特効を、耐性の適格（型5）と本人の凸（型7）込みで引く。ボス
  // 著述の敵は、シートの脅威リストは文章が正だが、印は導出の
  // 脅威への答えで引く（SW95 便2）。
  function targetAnswersBoth(derived) {
    const megido = new Map();
    const orbs = new Map();
    // 印の理由（2026-11-25）: ラベルと同じ演算が記録した根拠を、
    // ラベルと並行して候補ごとに寄せる（表示だけに使う）。
    const megidoReasons = new Map();
    const orbReasons = new Map();
    if (!buildCtx || !buildCtx.targetEnemy || !counterData || !structure) {
      return { megido, orbs, megidoReasons, orbReasons };
    }
    const merge = (src) => {
      for (const [id, labels] of src.megido) {
        if (!megido.has(id)) megido.set(id, []);
        for (const l of labels) if (!megido.get(id).includes(l)) megido.get(id).push(l);
      }
      for (const [id, labels] of src.orbs) {
        if (!orbs.has(id)) orbs.set(id, []);
        for (const l of labels) if (!orbs.get(id).includes(l)) orbs.get(id).push(l);
      }
      if (src.reasons) {
        for (const [id, list] of src.reasons.megido) {
          if (!megidoReasons.has(id)) megidoReasons.set(id, []);
          megidoReasons.get(id).push(...list);
        }
        for (const [id, list] of src.reasons.orbs) {
          if (!orbReasons.has(id)) orbReasons.set(id, []);
          orbReasons.get(id).push(...list);
        }
      }
    };
    const stateCtx = {
      memberIds: buildCtx.slots.filter((s) => s.megidoId).map((s) => s.megidoId),
      orbIds: buildCtx.slots.filter((s) => s.orbId).map((s) => s.orbId),
      leaderId: buildCtx.slots[2] ? buildCtx.slots[2].megidoId : null,
      levelOf, hasSpecial: specialOwnedOf,
    };
    for (const { fe, squareId, def } of targetSquares()) {
      const raw = tacticsData
        ? authoredEntryFor(tacticsData, buildCtx.targetEnemy, def, squareId) : null;
      const fact = fe && fe.enemies ? fe.enemies[buildCtx.targetEnemy] : null;
      merge(pickerAnswersForEnemy({
        fact, authored: raw, clsById: counterData.clsById,
        index: counterData.index, owned: derived.owned, levelOf,
        threatLevels: counterData.threatLevels, stateCtx,
        restricted: restrictionOf(def),
      }));
    }
    return { megido, orbs, megidoReasons, orbReasons };
  }

  function targetAnswersById(derived) {
    return targetAnswersBoth(derived).megido;
  }

  function targetOrbAnswersById(derived) {
    return targetAnswersBoth(derived).orbs;
  }

  function targetMegidoReasonsById(derived) {
    return targetAnswersBoth(derived).megidoReasons;
  }

  function targetOrbReasonsById(derived) {
    return targetAnswersBoth(derived).orbReasons;
  }

  // 印の文面（メギド・オーブ共通）: 根拠は先頭2件まで＋残り件数。
  function targetMarkText(labels) {
    const shown = labels.slice(0, 2).join('、');
    return `有効: ${shown}${labels.length > 2 ? ` ほか${labels.length - 2}件` : ''}`;
  }

  // メンバーごとの事情（M7）: 探索力の寄与、探索後のコンディション、
  // この先の需要（H6、人ごとの印）、保存済み編成での予定。候補の
  // メンバーと選択後のメンバーの両方で同じ形を使う。
  function exploreMemberFacts(m, demand, plans) {
    const planList = plans.get(m.id) || [];
    const equip = equipmentOf(m.id);
    // 需要の印（2026-11-21、需要の印の便）: 件数ではなく人ごとの印で
    // 出す。保存済み編成で使う予定があれば赤い「！」、無ければ需要
    // （範囲内のギミックへの答えの候補）の最初の階で黄色い「△」。
    // どちらも階を併記し、何階のことかその場で分かる形にする。需要の
    // 範囲と集計そのものは従来どおり（currentDemand／aggregateDemand）。
    let demandMark = null;
    if (planList.length > 0) {
      const floor = Math.min(...planList.map((p) => p.floor));
      demandMark = { kind: 'plan', floor, text: `！${floor}F`, label: `${floor}Fで使う予定` };
    } else {
      const floor = demandEarliestFloor(demand, m.id, sheetCtx.floor);
      if (floor !== null) {
        demandMark = { kind: 'gimmick', floor, text: `△${floor}F`, label: `${floor}Fで出番がある可能性あり` };
      }
    }
    return {
      id: m.id, name: m.name, style: m.style, className: m.className,
      stage: m.stage, stageLabel: CONDITION_STAGES[m.stage],
      afterStageLabel: CONDITION_STAGES[exploreAfterStage(m.stage)],
      powerText: String(Math.round(m.power)),
      matched: Boolean(m.matched),
      matchedStyle: Boolean(m.matchedStyle),
      matchedClass: Boolean(m.matchedClass),
      // 探索力は装備中の霊宝の修正値込みで計算している。その前提を
      // メンバーごとに名指しで出す（込みであることを黙らない）。
      reishouText: equip.length > 0 ? `霊宝: ${reishouNameText(equip)}` : null,
      demandMark,
      planText: planList.length > 0
        ? `予定: ${planList.slice(0, 2).map((p) => `${p.floor}F『${p.formationName}』`).join('、')}${planList.length > 2 ? ` ほか${planList.length - 2}件` : ''}`
        : null,
    };
  }

  function explorePlanVm(def, derived, pastExplore = null) {
    const ctx = sheetCtx;
    const demand = currentDemand(derived);
    // 予定の可視化（M7）: 保存済み編成のタグが指す未処理の戦闘マスから
    // 導く。タグの無い編成には付けない。需要の回避計算にも、タグが
    // 確実なこの範囲だけを加味する（必須級の需要と同じ重さ）。
    const plans = formationPlans({
      formations: formationsData.formations, structure,
      cleared: derived.cleared, fromFloor: ctx.floor,
    });
    // 入口はゲームと同じ文法にする（M7 の転換、2026-11-18 23:43）:
    // 空の枠（最大3）＋推奨探索力＋期待度の枠組みが先にあり、利用者が
    // 枠をタップしてメンバーを自分で入れると、合計と期待度がその場で
    // 反応する。候補一覧を入口にすると、初見の利用者は「候補とは何か」
    // の前提自体を理解しない。自動生成の組み合わせは入口から降ろし、
    // おまかせボタンから到達できる補助として置く（生成規則は従来
    // どおり planExplorationCandidates）。開いた時点では枠は空で、
    // 何も埋めない（1つ埋めた形は推奨と誤読される）。
    // 候補の生成には需要の集計（H6）と予定を使い、需要の高い者を
    // 避けた候補も混ぜる。おすすめが選ばれていれば、候補も補正込みの
    // ラインで生成する。
    if (!ctx.planCandidates) {
      ctx.planCandidates = planExplorationCandidates({
        megidoBasics,
        megidoDetails: formationsData.megidoDetails,
        owned: derived.owned,
        conditionOf: derived.conditionOf,
        recommendedPower: def.recommendedPower,
        demandOf: (id) => demandWeight(demand, id, ctx.floor)
          + (plans.has(id) ? PLAN_AVOID_WEIGHT : 0),
        osusume: ctx.osusume,
        reishouStatsById: reishouStatsMap(),
      });
    }
    const plan = ctx.planCandidates;
    const strip = expectationStrip({ explorationModel: structure.explorationModel, def });
    const osuVm = {
      style: ctx.osusume ? ctx.osusume.style : null,
      className: ctx.osusume ? ctx.osusume.className : null,
      active: osusumeActive(ctx.osusume),
    };
    // 計算の前提（オススメ補正の有無）は、「計算中」のラベルではなく
    // 転記ブロック側で現在の転記値の提示として出す（2026-11-19
    // ユーザー指定: 形は「オススメメギドは『ラッシュ』です」の文で、
    // 値は常に1つだけ＝単一選択。未選択の間は状態表示「未選択」）。
    const ev = evaluateCombo({
      megidoBasics,
      megidoDetails: formationsData.megidoDetails,
      conditionOf: derived.conditionOf,
      memberIds: ctx.planMembers,
      recommendedPower: def.recommendedPower,
      osusume: ctx.osusume,
      reishouStatsById: reishouStatsMap(),
    });
    const customized = Boolean(ctx.planSelectedIds)
      && ctx.planMembers.join(',') !== ctx.planSelectedIds.join(',');
    const members = ev.members.map((m) => ({
      ...exploreMemberFacts(m, demand, plans),
      line: `・${m.name}（${m.style}／探索力 ${Math.round(m.power)}／${CONDITION_STAGES[m.stage]}）`,
    }));
    // 枠（最大3）: 入っている枠はメンバーの事情、空の枠は「入れる」操作。
    const slots = [];
    for (let i = 0; i < EXPLORE_PARTY_MAX; i += 1) {
      slots.push(members[i] ? { filled: true, member: members[i] } : { filled: false, member: null });
    }
    // 並走の警告: 入れたメンバーが、この先で必要になる者である場合は
    // その場で出す（需要の印／保存済み編成での予定）。
    const warnings = [];
    for (const m of members) {
      const reasons = [];
      if (m.demandMark && m.demandMark.kind === 'gimmick') {
        reasons.push(`${m.demandMark.floor}Fで出番がある可能性のある手段を持っている`);
      }
      if (m.planText) reasons.push(m.planText);
      if (reasons.length > 0) {
        warnings.push(`${m.name}はこの先で必要な可能性があるメンバーです（${reasons.join('／')}）`);
      }
    }
    const totalText = ev.members.length === 0
      ? `合計探索力 0 ／ 期待度3には ${Math.round(ev.target)} が必要`
      : ev.reached
        ? `合計探索力 ${Math.round(ev.total)} ／ 期待度3に必要な ${Math.round(ev.target)}（推奨 ${def.recommendedPower} ×1.4）に到達`
        : `合計探索力 ${Math.round(ev.total)} ／ 期待度${ev.expectation}（期待度3には ${Math.round(ev.target)} が必要）`;
    const notes = [];
    if (ev.members.length > 0 && !ev.reached) notes.push(`この組み合わせで到達できるのは期待度${ev.expectation}まで。`);
    if (customized) notes.push('自動編成の候補から変えています。記録されるのは今の組み合わせです。');
    return {
      selected: ev.members.length > 0,
      reached: ev.reached, expectation: ev.expectation,
      osusume: osuVm,
      members, memberLines: members.map((m) => m.line), memberCount: ev.members.length,
      slots,
      warnings,
      totalText, note: notes.join(' '),
      // 見込みは現在の組み合わせの期待度から導く。入れるにつれて連動する。
      outlookText: expectationOutlook({
        explorationModel: structure.explorationModel, def, expectation: ev.expectation,
      }),
      // 見込みの注記（バフマスのボーナスの目がある時だけ、主行の次に
      // 字下げで出す）。
      outlookNote: expectationOutlookNote({
        explorationModel: structure.explorationModel, def, expectation: ev.expectation,
      }),
      // 見込みの格上げ表示（色付き大数字）: 合計のヒーローと期待度ストリップ。
      heroTotal: Math.round(ev.total), heroTarget: Math.round(ev.target),
      strip,
      // 前回の探索メンバー（枠の近くに出す。buildSquareVm で用意）。
      pastMembers: pastExplore,
      // 補助の候補（「候補で埋める」から開く）。入口には並べない。
      fillOpen: Boolean(ctx.fillOpen),
      candidates: plan.candidates.map((cand) => {
        const parts = [];
        for (const id of cand.spared) parts.push(`${nameOf(id)}を使わない`);
        if (cand.demandTotal > 0) parts.push('後の階で出番がある可能性のある者を含む');
        return {
          ids: cand.ids,
          members: cand.members.map((m) => exploreMemberFacts(m, demand, plans)),
          totalText: String(Math.round(cand.total)),
          expectation: plan.expectation,
          metaText: parts.join('・'),
        };
      }),
      hasCandidates: plan.candidates.length > 0,
      customized, canAdd: ctx.planMembers.length < EXPLORE_PARTY_MAX,
    };
  }

  // 探索の結果の入力（ゲームの結果画面の写し取り形。2026-11-19 の
  // ユーザー確定形）: 結果画面に出た行を、ゲームの文の形のまま写す。
  // 値の入力は、到達した期待度で起こりうる固定の候補（箱ごとの実量表
  // から生成）が基本で、候補に無い値の保険として数入力も用意する。
  // 記録の実行は下部バーの「これで探索を記録する」1つ。行が揃うまで
  // 押せず、欠けている項目はシート内に言葉で出る。フォームの途中状態
  // は ctx.resultForm、揃った記録材料は ctx.resultCommit に置く。
  // 候補・記録材料の計算は explore.js の純粋関数（resultFormVm）が担う。
  function resultSpecVm(def, expectation) {
    const ctx = sheetCtx;
    if (!ctx.resultForm || ctx.resultFormExpectation !== expectation) {
      ctx.resultForm = emptyResultForm();
      ctx.resultFormExpectation = expectation;
    }
    const vm = resultFormVm({
      explorationModel: structure.explorationModel, def,
      boxes: BOXES_BY_EXPECTATION[expectation] || [],
      form: ctx.resultForm,
    });
    ctx.resultCommit = vm.commit;
    return vm;
  }

  // 結果フォームの途中状態を変えた後、記録材料だけを組み立て直す
  // （数入力の途中では再描画せず、記録ボタンの有効・無効だけを
  // その場で切り替えるために使う）。戻り値は記録できるかどうか。
  function refreshResultCommit(def, expectation) {
    const ctx = sheetCtx;
    if (!ctx || !ctx.resultForm) return false;
    const vm = resultFormVm({
      explorationModel: structure.explorationModel, def,
      boxes: BOXES_BY_EXPECTATION[expectation] || [],
      form: ctx.resultForm,
    });
    ctx.resultCommit = vm.commit;
    return vm.canRecord;
  }

  // 結果を直す（H2）側のフォーム組み立て: 候補の範囲は到達した期待度
  // ではなく全ての箱にする。付け直しは別の期待度の結果への直しも
  // ありうるため。
  const RESULT_FIX_BOXES = ['緑', '青', '赤', '虹'];
  function fixSpecVm(def) {
    const ctx = sheetCtx;
    if (!ctx.fixForm) return null;
    const vm = resultFormVm({
      explorationModel: structure.explorationModel, def,
      boxes: RESULT_FIX_BOXES,
      form: ctx.fixForm,
    });
    ctx.fixCommit = vm.commit;
    return vm;
  }

  function refreshFixCommit(def) {
    const ctx = sheetCtx;
    if (!ctx || !ctx.fixForm) return false;
    const vm = resultFormVm({
      explorationModel: structure.explorationModel, def,
      boxes: RESULT_FIX_BOXES,
      form: ctx.fixForm,
    });
    ctx.fixCommit = vm.commit;
    return vm.canRecord;
  }

  // 結果フォームの操作対象（記録側は resultForm、直し側は fixForm）と、
  // その文脈での記録材料の組み立て直しを解決する。
  function resultFormTarget() {
    const ctx = sheetCtx;
    if (!ctx) return null;
    const fd = floorData(structure, ctx.floor);
    const def = fd ? fd.squares[ctx.squareId] : null;
    if (!def) return null;
    if (ctx.subView === 'fix' && ctx.fixForm) {
      return { form: ctx.fixForm, refresh: () => refreshFixCommit(def) };
    }
    if (ctx.resultForm) {
      const expectation = ctx.resultFormExpectation;
      return { form: ctx.resultForm, refresh: () => refreshResultCommit(def, expectation) };
    }
    return null;
  }


  // 探索の結果の返し（棚卸し 3-11）: そのマスへの最後の探索操作の前後で
  // 導出し直し、出したメンバー全員の段階の変化を名指しで返す。
  // ここは返し専用で、結果の入力は置かない（記録は写し取りとして
  // 記録の時点で完結している）。
  function exploreOutcomeVm() {
    const ctx = sheetCtx;
    if (!ctx) return null;
    const ops = currentOps(history);
    let idx = -1;
    ops.forEach((op, i) => {
      if (op.type === 'explore' && op.squareId === ctx.squareId) idx = i;
    });
    if (idx < 0) return null;
    const op = ops[idx];
    const env = { structure, megidoBasics, megidoDetails: formationsData.megidoDetails };
    const before = deriveRun({ ...env, ops: ops.slice(0, idx) });
    const after = deriveRun({ ...env, ops: ops.slice(0, idx + 1) });
    const lines = [];
    for (const id of op.members || []) {
      lines.push(`${nameOf(id)}: ${CONDITION_STAGES[before.conditionOf(id)]} → ${CONDITION_STAGES[after.conditionOf(id)]}`);
    }
    const fd = floorData(structure, ctx.floor);
    const def = fd.squares[ctx.squareId];
    if (def.subType === 'tower_power') {
      const gain = after.towerPower - before.towerPower + 1;
      lines.push(`塔破力 +${gain}（現在 ${after.towerPower}）`);
    }
    return { lines };
  }

  // 探索の組み替え（M7）: 候補の全画面ビューを開く。
  function renderExploreCandidates() {
    const ctx = sheetCtx;
    if (!ctx || !ctx.explorePick) return;
    const derived = derive();
    const fd = floorData(structure, ctx.floor);
    const def = fd.squares[ctx.squareId];
    const pick = ctx.explorePick;
    const others = pick.mode === 'swap'
      ? ctx.planMembers.filter((id) => id !== pick.targetId)
      : [...ctx.planMembers];
    const rows = exploreCandidates({
      megidoBasics,
      megidoDetails: formationsData.megidoDetails,
      owned: derived.owned,
      conditionOf: derived.conditionOf,
      excludeNos: others.map((id) => (byId.get(id) || {}).no).filter((no) => no != null),
      excludeIds: pick.mode === 'swap' ? [pick.targetId] : [],
      osusume: ctx.osusume,
      reishouStatsById: reishouStatsMap(),
    });
    const ev = evaluateCombo({
      megidoBasics,
      megidoDetails: formationsData.megidoDetails,
      conditionOf: derived.conditionOf,
      memberIds: ctx.planMembers,
      recommendedPower: def.recommendedPower,
      osusume: ctx.osusume,
      reishouStatsById: reishouStatsMap(),
    });
    const demand = currentDemand(derived);
    const plans = formationPlans({
      formations: formationsData.formations, structure,
      cleared: derived.cleared, fromFloor: ctx.floor,
    });
    const target = pick.targetId ? byId.get(pick.targetId) : null;
    const vm = {
      swipeHint: !settings.swipeHintSeen,
      title: pick.mode === 'swap' ? 'メンバーを入れ替える' : 'メンバーを追加する',
      targetLine: target ? `入れ替え元: ${target.name}（${target.style}）` : null,
      summaryText: `現在の組み合わせ: 合計探索力 ${Math.round(ev.total)}／期待度${ev.expectation}`,
      rows: rows.map((r) => {
        const facts = exploreMemberFacts(r, demand, plans);
        const sub = [];
        if (facts.reishouText) sub.push(facts.reishouText);
        // 需要の印（△の分だけ。！の分は予定の行がそのまま担う）。
        if (facts.demandMark && facts.demandMark.kind === 'gimmick') {
          sub.push(facts.demandMark.label);
        }
        if (facts.planText) sub.push(facts.planText);
        return {
          id: r.id,
          name: r.name,
          style: r.style, stage: r.stage, stageLabel: CONDITION_STAGES[r.stage],
          matched: facts.matched,
          matchedStyle: facts.matchedStyle,
          matchedClass: facts.matchedClass,
          meta: `探索力 ${Math.round(r.power)}／${CONDITION_STAGES[r.stage]}→探索後 ${CONDITION_STAGES[exploreAfterStage(r.stage)]}`,
          sub: sub.join('／') || null,
        };
      }),
      showRemove: pick.mode === 'swap',
    };
    const { content } = buildExploreCandidates(vm, explorePickCallbacks);
    // 候補一覧の提示は新しい文脈: scrollKey を渡さず、常に先頭から見せる
    // （選ぶと閉じてシートへ戻り、シート側の位置はシートのキーで戻る）。
    overlay.openFull(content);
  }

  const explorePickCallbacks = {
    onPick: (id) => {
      const ctx = sheetCtx;
      if (!ctx || !ctx.explorePick) return;
      if (ctx.explorePick.mode === 'swap') {
        const i = ctx.planMembers.indexOf(ctx.explorePick.targetId);
        if (i >= 0) ctx.planMembers[i] = id;
      } else if (ctx.planMembers.length < EXPLORE_PARTY_MAX) {
        ctx.planMembers.push(id);
      }
      ctx.explorePick = null;
      overlay.closeFull();
      renderSquareSheet();
    },
    onRemove: () => {
      const ctx = sheetCtx;
      if (!ctx || !ctx.explorePick) return;
      ctx.planMembers = ctx.planMembers.filter((id) => id !== ctx.explorePick.targetId);
      ctx.explorePick = null;
      overlay.closeFull();
      renderSquareSheet();
    },
    onBack: () => {
      if (!sheetCtx) return;
      sheetCtx.explorePick = null;
      overlay.closeFull();
      renderSquareSheet();
    },
    // スワイプ（タイプA）: 左＝候補から外す、右＝詳細シート。
    onSwipeHide: async (id) => {
      const reopen = () => { if (sheetCtx && sheetCtx.explorePick) renderExploreCandidates(); };
      await hideCandidateFromPicker(id, reopen);
      reopen();
    },
    onSwipeDetail: (id) => {
      openPickerDetailSheet(id, () => {
        if (sheetCtx && sheetCtx.explorePick) renderExploreCandidates();
      });
    },
    onDismissSwipeHint: async () => {
      await markSwipeHintSeen();
      if (sheetCtx && sheetCtx.explorePick) renderExploreCandidates();
    },
  };

  function recoveryVm(squareId) {
    const outcome = recoveryOutcomeFor({
      structure, megidoBasics, megidoDetails: formationsData.megidoDetails,
      ops: currentOps(history),
    }, squareId);
    if (!outcome) return null;
    const recoveredLines = outcome.recovered.map((r) =>
      `${nameOf(r.id)}: ${CONDITION_STAGES[r.from]} → ${CONDITION_STAGES[r.to]}`);
    let pending = null;
    if (outcome.pending) {
      sheetCtx.currentPending = outcome.pending;
      pending = {
        stageText: CONDITION_STAGES[outcome.pending.stage],
        need: outcome.pending.need,
        pickedCount: sheetCtx.boundaryPicks.size,
        candidates: outcome.pending.candidates.map((id) => ({
          id, name: nameOf(id), picked: sheetCtx.boundaryPicks.has(id),
        })),
      };
    } else {
      sheetCtx.currentPending = null;
    }
    return { recoveredLines, pending };
  }

  function m11Vm(entries, formation, derived) {
    const battles = entries.filter((e) => e.kind === 'battle');
    if (!battles.some((e) => e.result === 'lose' || e.result === 'retreat')) return null;
    return {
      pastLines: battles.map((e) => historyLine(e)),
      costLines: costLinesFor(formation, derived),
    };
  }

  // タイムライン（SW91）: 選んだ編成の味方とそのマスの敵を実効
  // 速度順に並べた表示だけの材料。並びの計算は chain.js の
  // buildTimeline（エディタのチェインと同じ物差し）に寄せる。
  // チェインの組み立てはエディタ側の担当で、ここでは組まない。
  function sheetTimelineVm(def, formation, derived) {
    if (!formation) return null;
    const pseudoSlots = formation.slots.map((s) => ({
      megidoId: s.megidoId || null, orbId: s.orbId || null,
    }));
    const allies = [];
    formation.slots.forEach((s, i) => {
      if (!s.megidoId) return;
      const basic = byId.get(s.megidoId);
      const spdR = effSpdInFormation(
        s.megidoId, i, pseudoSlots, derived.conditionOf(s.megidoId));
      allies.push({
        id: s.megidoId,
        name: basic ? basic.name : s.megidoId,
        spd: spdR ? spdR.value : null,
      });
    });
    const mult = squareStatMultipliers(def.rules);
    const enemies = [];
    for (const name of def.enemies || []) {
      const fact = floorEnemies && floorEnemies.enemies
        ? floorEnemies.enemies[name] : null;
      if (!fact) continue;
      const party = (fact.party || []).filter(Boolean);
      if (party.length > 0) {
        for (const p of party) {
          enemies.push({
            name: p.name,
            spd: typeof p.spd === 'number' ? applyMult(p.spd, mult.spd) : null,
            baseSpd: typeof p.spd === 'number' ? p.spd : null,
            mult: mult.spd,
          });
        }
      } else if (fact.stats && typeof fact.stats.spd === 'number') {
        enemies.push({
          name, spd: applyMult(fact.stats.spd, mult.spd),
          baseSpd: fact.stats.spd, mult: mult.spd,
        });
      }
    }
    const rows = buildTimeline({ allies, enemies });
    return rows.length > 0 ? rows : null;
  }

  // シミュレーターのチップ（SW91、SW95で本体化）: 選んだ編成に
  // 手段があるものだけを出し、押すとその場で下に開く。パネルの
  // 中身は編成エディタと同じシミュレーター本体（操作できるもの）
  // で、対象の編成はこのマスに保持された編成、対象の敵はシート
  // で選択中の種（種タブ）。表示条件はエディタ側と揃える（Hボム=
  // 編成にボム行動がある、狂炎=炎上と狂炎化の両方がある、戦旗=
  // 保持者がいる。材料の解決は env の context が担う）。
  // 状態はシートだけの一時状態（sheetCtx.hbomb / sheetCtx.kyoen）
  // に持ち、保存済みの編成そのものは書き換えない。編成が未選択
  // の間は対象が無いためチップ自体を出さない（編成を選ぶ導線は
  // シート上部の編成節が担う）。制限マスでは出さない（SW79 の
  // 決着どおり）。
  function sheetSimsVm(def, formation, restricted) {
    if (!formation || restricted || !counterData) return [];
    const sims = [];
    const isOpen = (key) => Boolean(sheetCtx && sheetCtx.simOpen
      && sheetCtx.simOpen.has(key));
    if (sheetHbombEnv.context()) {
      sims.push({
        key: 'hbomb', label: 'ハイドロボム', open: isOpen('hbomb'),
        hbomb: isOpen('hbomb') ? hbombSectionVmFor(sheetHbombEnv) : null,
      });
    }
    if (sheetKyoenEnv.context()) {
      sims.push({
        key: 'kyoen', label: '狂炎', open: isOpen('kyoen'),
        kyoen: isOpen('kyoen') ? kyoenSectionVmFor(sheetKyoenEnv) : null,
      });
    }
    const flagRows = flagRowsForSlots(formation.slots);
    if (flagRows) {
      sims.push({
        key: 'flag', label: '戦旗', open: isOpen('flag'), flagRows,
      });
    }
    return sims;
  }

  // マスシートのシミュレーターの材料（SW95）: 対象の編成はその
  // マスに保持された編成、対象の敵はシートのマス自身の敵で、
  // 種はシートの種タブの選択（対策節と同じ解決: 選択が無ければ
  // 先頭の種）。
  function sheetSimFormation() {
    if (!sheetCtx || !sheetCtx.formationId || !formationsData) return null;
    return formationsData.formations.find((f) => f.id === sheetCtx.formationId) || null;
  }

  function sheetSimDef() {
    if (!sheetCtx || !structure) return null;
    const fd = floorData(structure, sheetCtx.floor);
    return fd ? fd.squares[sheetCtx.squareId] || null : null;
  }

  // シートで選択中の敵グループ（種）: 種タブの選択がそのマスの敵に
  // あればそれ、無ければ先頭の種。対策節・シミュレーター・見積もり・
  // 編成の保持（問題16）で同じ解決を使う。
  function sheetActiveSpecies(def) {
    const names = (def && def.enemies) || [];
    if (!names.length) return null;
    return sheetCtx && names.includes(sheetCtx.enemyTab)
      ? sheetCtx.enemyTab : names[0];
  }

  function sheetSimSpecies() {
    return sheetActiveSpecies(sheetSimDef());
  }

  function sheetSimSquares() {
    const def = sheetSimDef();
    return def ? [{ fe: floorEnemies, def }] : [];
  }

  // シミュレーターの実行環境（SW95）: エディタとマスシートで
  // 同じ VM・操作ハンドラ・ポップアップを使うための文脈の束。
  // state: 状態（hbomb / kyoen）を持つ文脈オブジェクトを返す。
  // context: 材料（編成のメンバーと対象の敵パーティ）を解決する。
  // sigParts: 状態の署名の材料（対象が替われば状態を作り直す）。
  // slots: 対象の編成の枠（狂炎の ME 補正の解決に使う）。
  // rerender: 操作後の再描画。
  const sheetHbombEnv = {
    state: () => sheetCtx,
    context: () => {
      const f = sheetSimFormation();
      return f ? hbombContextFor(f.slots, sheetSimSquares(), sheetSimSpecies()) : null;
    },
    sigParts: () => (sheetCtx
      ? ['sheet', sheetCtx.floor, sheetCtx.squareId, sheetCtx.formationId, sheetSimSpecies()]
      : []),
    rerender: () => renderSquareSheet(),
  };

  const sheetKyoenEnv = {
    state: () => sheetCtx,
    context: () => {
      const f = sheetSimFormation();
      return f ? kyoenContextFor(f.slots, sheetSimSquares(), sheetSimSpecies()) : null;
    },
    slots: () => {
      const f = sheetSimFormation();
      return f ? f.slots : [];
    },
    sigParts: () => (sheetCtx
      ? ['sheet', sheetCtx.floor, sheetCtx.squareId, sheetCtx.formationId, sheetSimSpecies()]
      : []),
    rerender: () => renderSquareSheet(),
  };

  function buildSquareVm() {
    const ctx = sheetCtx;
    const derived = derive();
    const fd = floorData(structure, ctx.floor);
    const def = { floor: ctx.floor, ...fd.squares[ctx.squareId] };
    const state = squareState(structure, derived.cleared, ctx.squareId);
    const viewOnly = !floorReached(derived, ctx.floor);
    const entries = squareHistory(currentOps(history), ctx.squareId);
    const isBattle = def.type === 'battle' || def.type === 'boss';
    const isExplore = def.type === 'explore';
    const canAct = !viewOnly && state === 'open' && (isBattle || isExplore);
    const formation = ctx.formationId
      ? formationsData.formations.find((f) => f.id === ctx.formationId) || null
      : null;

    // 解放不可のマスの案内（M2）: 事実より先に「解放にはこのマスを処理する」
    // を出す。解放可能な隣接マスがあればそれを（そこを処理すれば解放される）、
    // 無ければ解放不可の隣接マスを段階として出す。解放不可と出す箇所では
    // 理由（どの隣接マスか）を必ず添えるため、閲覧専用の階でも案内を出す。
    let unlockGuide = null;
    if (state === 'locked') {
      const g = unlockGuidance(structure, derived.cleared, ctx.squareId);
      const stepText = (s) => {
        const sd = { floor: ctx.floor, ...fd.squares[s.id] };
        let detail = '';
        if (sd.type === 'battle' || sd.type === 'boss') {
          const names = (sd.enemyIds || []).map((eid) => (
            floorEnemies && floorEnemies.enemies[eid] ? floorEnemies.enemies[eid].name : eid
          ));
          if (names.length > 0) detail = `: ${names.join('、')}`;
        }
        return `${squareLabel(sd)}${detail}（${s.state === 'open' ? '解放可能' : '解放不可'}）`;
      };
      unlockGuide = {
        open: Boolean(ctx && ctx.unlockGuideOpen),
        steps: g.steps.map((s) => ({ squareId: s.id, text: stepText(s) })),
        bossPathText: g.isBoss
          ? 'この階のボスです。'
          : g.onBossPath === true
            ? 'ボスへの道の途中です。'
            : g.onBossPath === false
              ? 'ボスへの道から外れたマスです。'
              : null,
      };
    }

    const notes = [];
    if (viewOnly) notes.push('閲覧専用（まだ到達していない階）。結果は付けられない。');
    else if (state === 'locked' && !unlockGuide) notes.push('解放不可。隣接するマスを解放すると開きます。');
    else if (state === 'done') notes.push('解放済み。このマスは再利用できない。');
    if (def.type === 'boss' && fd.hpCarryoverForbidden) notes.push('この階はHP引き継ぎ禁止。');
    if (isExplore) notes.push('コスト：塔破力1＋探索に参加したメギドはコンディションが2段階ダウン');
    // マス自体の注記（SW90: 旧ガイドから移した、そのマスへの警告）。
    if (Array.isArray(def.notes)) notes.push(...def.notes);

    // 過去の結果の手渡し: 今のランに無ければ、閉じたラン（アーカイブ）から出す（M10/H3）。
    let pastSummary = pastSummaryText(entries);
    if (!pastSummary) {
      for (let i = records.runs.length - 1; i >= 0; i -= 1) {
        const past = squareHistory(records.runs[i].ops, ctx.squareId);
        if (past.length > 0) {
          pastSummary = `前回（${records.runs[i].label}）: ${historyLine(past[past.length - 1])}`;
          break;
        }
      }
    }

    // 前回の探索メンバー（M7）: メンバーを選ぶ場所（枠の近く）で返す。
    // このマスの記録が無ければ、同種の探索の直近の記録で代える。
    // 同じメンバーをもう一度出す判断にも、「出して苦戦した」という
    // 思い出しのヒントにもなるのが、この置き場の役目。
    let pastExplore = null;
    if (isExplore) {
      const lastExploreIn = (list) => {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].kind === 'explore') return list[i];
        }
        return null;
      };
      let hit = lastExploreIn(entries);
      let runLabel = null;
      let sameSquare = Boolean(hit);
      if (!hit) {
        for (let i = records.runs.length - 1; i >= 0 && !hit; i -= 1) {
          hit = lastExploreIn(squareHistory(records.runs[i].ops, ctx.squareId));
          if (hit) { runLabel = records.runs[i].label; sameSquare = true; }
        }
      }
      if (!hit) {
        // 同種の探索（別マス）の直近: 今のラン→過去のランの順に新しい方から。
        const scanOps = (ops) => {
          const list = runEntries(structure, ops)
            .filter((e) => e.kind === 'explore' && e.squareId !== ctx.squareId);
          for (let i = list.length - 1; i >= 0; i -= 1) {
            const d2 = squareDef(structure, list[i].squareId);
            if (d2 && d2.subType === def.subType) return list[i];
          }
          return null;
        };
        hit = scanOps(currentOps(history));
        if (!hit) {
          for (let i = records.runs.length - 1; i >= 0 && !hit; i -= 1) {
            hit = scanOps(records.runs[i].ops);
            if (hit) runLabel = records.runs[i].label;
          }
        }
      }
      if (hit) {
        pastExplore = {
          runLabel,
          sameSquare,
          effectLabel: exploreEffectLabel(hit),
          members: (hit.members || []).map((id) => ({
            id, name: nameOf(id), style: byId.get(id) ? byId.get(id).style : null,
          })),
        };
        // 頭との二重表示の整理: 枠の近くにメンバー名を出す場合、
        // アーカイブ由来の頭（名前を含む形）は名前なしに置き換える。
        // 今のランの頭はもともと名前を含まない。枠が出ない状態
        // （閲覧専用・処理済み）では頭に名前を残し、情報を落とさない。
        if (canAct && sameSquare && runLabel && pastSummary) {
          pastSummary = `前回（${runLabel}）: 探索（${pastExplore.effectLabel}）`;
        }
      }
    }

    // 過去編成の再選択（棚卸し 4-14）: 直近の戦闘で使った編成が今も
    // 残っていれば、そのまま選び直せる対象として手渡す。
    let pastFormationId = null;
    if (isBattle) {
      const findPast = (list) => {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const e = list[i];
          if (e.kind === 'battle' && e.formationId
            && formationsData.formations.some((f) => f.id === e.formationId)) {
            return e.formationId;
          }
        }
        return null;
      };
      pastFormationId = findPast(entries);
      if (!pastFormationId) {
        for (let i = records.runs.length - 1; i >= 0 && !pastFormationId; i -= 1) {
          pastFormationId = findPast(squareHistory(records.runs[i].ops, ctx.squareId));
        }
      }
    }

    // 塔効果（能力上昇マス）: 対象スタイルの蓄積と、今回の結果の内訳。
    let buff = null;
    if (BUFF_SUBTYPES.has(def.subType)) {
      const style = def.style;
      const outcome = state === 'done'
        ? buffOutcomeFor({
          structure, megidoBasics, megidoDetails: formationsData.megidoDetails,
          ops: currentOps(history),
        }, ctx.squareId)
        : null;
      const totals = outcome ? outcome.totalsAfter : derived.buffs[style];
      const raw = outcome ? outcome.rawAfter : derived.buffRaw[style];
      const totalLines = [];
      for (const k of ['hp', 'atk', 'def', 'dmg']) {
        if (raw[k] > 0) {
          // ダメージ上昇に単体以外の種別の蓄積がある場合は種別ごとに言う。
          if (k === 'dmg') {
            const breakdown = dmgTypeBreakdown(totals);
            if (breakdown) {
              for (const b of breakdown) {
                totalLines.push(`${STYLE_NAME[style]} ${b.label} +${b.value}%`);
              }
              continue;
            }
          }
          const cap = BUFF_CAPS[k];
          const capText = raw[k] > totals[k]
            ? `（実${raw[k]}%、上限${cap}%で頭打ち）`
            : (cap ? `（上限${cap}%）` : '');
          totalLines.push(`${STYLE_NAME[style]} ${BUFF_STAT_LABEL[k]} +${totals[k]}%${capText}`);
        }
      }
      const gainLines = outcome
        ? outcome.gains.map((g) => `今回の探索: ${BUFF_STAT_LABEL[g.stat]} +${g.pct}%`)
        : [];
      // ランダムのボーナスで塔破力が増えた分も、今回の結果として出す。
      if (outcome && outcome.power > 0) {
        gainLines.push(`今回の探索: 塔破力 +${outcome.power}`);
      }
      // ボーナスが出なかった事実は、明示された記録（buffBonus === false）
      // の時だけ言葉にする。旧い記録（不明）では言わない。ボーナスが
      // ありうるのは期待度3の結果（赤・虹）の時だけ。
      const bonusLine = outcome && outcome.bonus === false
        && (outcome.box === '赤' || outcome.box === '虹')
        ? '今回の探索: ランダムのボーナスは出なかった'
        : null;
      const capStats = outcome
        ? outcome.capped
        : ['hp', 'atk', 'def'].filter((k) => raw[k] > BUFF_CAPS[k]);
      const cappedNotes = capStats.map(
        (k) => `${BUFF_STAT_LABEL[k]}は上限（${BUFF_CAPS[k]}%）に達しています。これ以上取っても増えません。`,
      );
      buff = { styleLabel: STYLE_NAME[style], gainLines, totalLines, cappedNotes, bonusLine };
    }

    // 値打ちの判定（M3・拡張1）: 能力上昇マスでは取得量の見込み・
    // 蓄積・残り進路から、戦闘マスでは「勝つと開く能力上昇マス」から
    // 組み立てる（worth.js）。割に合わないと導出できる場合だけ
    // 判定文（verdict）を出す。
    let worth = null;
    if (BUFF_SUBTYPES.has(def.subType) && state !== 'done') {
      const w = buffWorth({
        explorationModel: structure.explorationModel, def,
        totals: derived.buffs[def.style], raw: derived.buffRaw[def.style],
        route: remainingRoute(structure, derived.cleared, Math.max(ctx.floor, derived.currentFloor)),
      });
      worth = { outlookLines: w.outlookLines, noteLines: w.noteLines, verdict: w.verdict };
    } else if (def.type === 'battle' && state === 'open') {
      const w = battleWorth({
        structure, explorationModel: structure.explorationModel,
        cleared: derived.cleared, squareId: ctx.squareId, buffRaw: derived.buffRaw,
      });
      if (w) worth = { outlookLines: [], noteLines: w.lines, verdict: w.verdict };
    }

    // 結果を直す（H2）: 結果のあるマスに出す。
    const lastEntry = entries[entries.length - 1];
    const canFix = !viewOnly && entries.length > 0;
    let fix = null;
    let fixSpec = null;
    if (canFix && lastEntry) {
      if (lastEntry.kind === 'battle') {
        fix = { kind: 'battle', currentText: RESULT_TEXT[lastEntry.result] };
      } else {
        // 探索の付け直しも、記録と同じ写し取りの行で聞く（箱の色も
        // 標準／多めのボタンも置かない）。フォームの出発点は現在の
        // 記録で、候補の範囲は全ての箱にする（付け直しは別の期待度の
        // 結果への直しもありうるため）。
        const fixOps = currentOps(history);
        let lastOp = null;
        fixOps.forEach((op) => {
          if (op.type === 'explore' && op.squareId === ctx.squareId) lastOp = op;
        });
        if (!ctx.fixForm || ctx.fixFormSquareId !== ctx.squareId || ctx.fixFormOp !== lastOp) {
          ctx.fixForm = resultFormFromOp({
            explorationModel: structure.explorationModel, def,
            boxes: RESULT_FIX_BOXES, op: lastOp,
          });
          ctx.fixFormSquareId = ctx.squareId;
          ctx.fixFormOp = lastOp;
        }
        fixSpec = fixSpecVm(def);
        fix = {
          kind: 'explore',
          currentText: `探索（${exploreEffectLabel(lastEntry)}）`,
        };
      }
    }

    const planVm = isExplore && canAct ? explorePlanVm(def, derived, pastExplore) : null;
    const resultSpec = planVm ? resultSpecVm(def, planVm.expectation) : null;

    // 塔破力不足で記録できない状態（W1 の再点検）: ボスの初回挑戦は
    // 塔破力0でも記録できる。それ以外は塔破力1が要る。足りない時は
    // 理由を出した無効ボタンにする（黙って押せない状態を作らない）。
    let powerShort = false;
    let powerShortText = null;
    if (canAct && !ctx.postResult) {
      const firstBossAttempt = def.type === 'boss'
        && entries.filter((e) => e.kind === 'battle').length === 0;
      const cost = firstBossAttempt ? 0 : 1;
      if (derived.towerPower < cost) {
        powerShort = true;
        powerShortText = `塔破力が足りないため記録できません（現在 ${derived.towerPower}）`;
      }
    }

    // 選択中の敵グループ（種）: 種タブの選択、無ければ先頭の種。
    // 見積もりと素早さの結論は、このグループの分だけを出す（全体
    // 構成 問題16、2026-11-27。耐性表の「選択したグループだけ」と
    // 同じ原則）。単一種のマスでは従来と同一になる。
    const activeSpecies = isBattle ? sheetActiveSpecies(def) : null;

    // 敵最速（開始前確認の素早さ比較用、2026-11-19）: 選択中の
    // 敵グループの値（マスルール適用後）を引く。素早さの節も
    // グループに追随させる（問題16）: 確認の結論は「これから戦う
    // 相手」へのもので、敵情報・攻略のポイントが既に選択種だけを
    // 出していることと揃える。数値が引けない敵では出さない。
    let fastestEnemy = null;
    if (isBattle && activeSpecies) {
      const spd = enemySpdOf(activeSpecies, floorEnemies, def.rules);
      if (typeof spd === 'number') fastestEnemy = { name: activeSpecies, spd };
    }

    // 受けダメージの見積もり（積4、2026-11-20）: 編成が選ばれた
    // 戦闘マスでは、候補の敵ごとに見積もって開始前確認の編成の
    // 下へ出す（V8 の両置き決定）。31階の制限マスでは、Lv70 前提の
    // 数値になるため見積もり自体を出さず、素早さの敵比較の結論も
    // 出さない（制限下の扱いは floor31-restriction-prep.md が正本）。
    const squareRestricted = isRestrictedDef(def);
    const confirmation = isBattle && formation
      ? confirmationVm(formation, derived, fastestEnemy, squareRestricted) : null;
    if (confirmation && !squareRestricted) {
      const slotsLike = formation.slots.map((s) => ({
        megidoId: s.megidoId || null, orbId: s.orbId || null,
      }));
      // 危険行動に対する見積もりは選択中の敵グループの分だけ
      // （問題16。従来は全敵分を並べていた）。
      const blocks = [];
      if (activeSpecies) {
        const fact = floorEnemies && floorEnemies.enemies
          ? floorEnemies.enemies[activeSpecies] : null;
        if (fact) {
          const est = damageEstimateFor(fact, squareStatMultipliers(def.rules), slotsLike, derived);
          if (est) blocks.push({ enemyName: activeSpecies, ...est });
        }
      }
      if (blocks.length > 0) {
        confirmation.damageEstimate = { blocks };
      }
      // 攻撃の見積もり（A5 改訂、2026-11-26）: 同じ編成で、敵に
      // どれだけ通るかを味方ごとに見積もる。表示は選択式（選んだ
      // 1人分だけ）で、初期表示は見積もりが一番大きい味方。
      // 対象は選択中の敵グループだけ（問題16）。
      const outByMember = new Map();
      for (const name of (activeSpecies ? [activeSpecies] : [])) {
        const fact = floorEnemies && floorEnemies.enemies ? floorEnemies.enemies[name] : null;
        if (!fact) continue;
        const est = outgoingEstimateFor(fact, squareStatMultipliers(def.rules), slotsLike, derived);
        if (!est) continue;
        for (const m of est.members) {
          if (!outByMember.has(m.id)) {
            outByMember.set(m.id, {
              id: m.id, name: m.name, attacksRead: false, maxTotal: 0, sections: [],
              noDamageAbility: false,
            });
          }
          const rec = outByMember.get(m.id);
          rec.attacksRead = rec.attacksRead || m.attacksRead;
          rec.noDamageAbility = rec.noDamageAbility || m.noDamageAbility;
          if (m.maxTotal > rec.maxTotal) rec.maxTotal = m.maxTotal;
          if (m.targets.length > 0) rec.sections.push({ enemyName: name, targets: m.targets });
        }
      }
      // チップは編成の全員分を出す（ダメージの技が無い味方も
      // 消さずに残し、選ぶとその旨を出す）。初期表示の候補は
      // 従来どおり見積もりの行がある味方だけ。
      const outMembers = [];
      for (const s of slotsLike) {
        if (!s || !s.megidoId) continue;
        const rec = outByMember.get(s.megidoId);
        if (rec) outMembers.push(rec);
      }
      if (outMembers.length > 0) {
        const wanted = sheetCtx ? sheetCtx.outgoingSel : null;
        const withLines = outMembers.filter((m) => m.sections.length > 0);
        const pool = withLines.length > 0 ? withLines : outMembers;
        const selected = outMembers.find((m) => m.id === wanted)
          || pool.reduce((a, b) => (b.maxTotal > a.maxTotal ? b : a));
        confirmation.outgoingEstimate = {
          members: outMembers.map((m) => ({ id: m.id, name: m.name })),
          selected: {
            id: selected.id, name: selected.name,
            attacksRead: selected.attacksRead, sections: selected.sections,
            noDamageAbility: selected.noDamageAbility,
          },
        };
      }
      // 見積もりの前提（全体構成 問題14、2026-11-27）: 危険行動・
      // 攻撃の両節を通した前提を、節ごとの頭ではなく末尾に1回だけ
      // 置く。VM には両節の有無に応じた統合文を1つだけ持たせる。
      if (confirmation.damageEstimate || confirmation.outgoingEstimate) {
        confirmation.estimatePremise = sheetEstimatePremise(
          Boolean(confirmation.damageEstimate),
          Boolean(confirmation.outgoingEstimate));
      }
    }

    // タイムラインとシミュレーターのチップ（SW91）。どちらも
    // 選んだ編成があって初めて意味を持つ。制限マスでは、Lv70
    // 前提の速度の並びもシミュレーターも出さない（SW79 の決着）。
    const timeline = isBattle && formation && !squareRestricted
      ? sheetTimelineVm(def, formation, derived) : null;
    const sims = isBattle ? sheetSimsVm(def, formation, squareRestricted) : [];

    return {
      title: squareTitle(def),
      stateText: `${ctx.floor}F ／ ${state === 'done' ? '解放済み' : state === 'open' ? '解放可能' : '解放不可（隣接するマスを解放してください）'}${viewOnly ? '（閲覧専用）' : ''}`,
      unlockGuide,
      pastSummary,
      pastFormationId,
      hasHistory: entries.length > 0,
      subView: ctx.subView,
      historyEntries: entries.map((e) => ({ text: historyLine(e), tone: entryTone(e) })),
      powerShort,
      powerShortText,
      headResult: isExplore ? exploreHeadResult(def, state === 'done') : null,
      headRows: isExplore ? [] : headRowsFor(def, derived, ctx.squareId),
      notes,
      // 敵自身の情報は、到達済みの階のシートでも出す（2026-11-19）。
      // 対（M4）は敵情報ブロックの後に続けるのが背骨であり、戦う相手の
      // ステータス・特性・技能は戦うマスのシートでこそ要る。以前は
      // 未到達階の閲覧専用（M2）でだけ出していた。
      enemyDetails: isBattle ? enemyDetailsVm(def) : null,
      counter: isBattle ? counterVm(def, derived) : null,
      timeline,
      sims,
      m11: !ctx.postResult ? m11Vm(entries, formation, derived) : null,
      confirmation,
      explorePlan: planVm,
      resultSpec,
      recovery: def.subType === 'recovery' ? recoveryVm(ctx.squareId) : null,
      buff,
      worth,
      postExplore: isExplore && state === 'done' ? exploreOutcomeVm() : null,
      canFix,
      fix,
      fixSpec,
      postResult: ctx.postResult
        ? {
          resultLabel: `${RESULT_TEXT[ctx.postResult]}を付けました`,
          lines: [
            ...entries.filter((e) => e.kind === 'battle').map((e) => historyLine(e)),
            ...costLinesFor(formation, derived),
          ],
        }
        : null,
      mode: isBattle ? 'battle' : isExplore ? 'explore' : 'none',
      hasFormation: Boolean(formation),
      canAct,
    };
  }

  function renderSquareSheet() {
    if (!sheetCtx) return;
    kickSheetAbilities();
    const vm = buildSquareVm();
    const { content, actionBar } = buildSquareSheet(vm, sheetCallbacks);
    // スクロール保持の文脈: 開いたマス（世代）×サブビュー。履歴・修正の
    // サブビューへ移ると先頭から、その中で操作しても位置は保たれ、
    // 戻れば本文の位置も戻る。シート内のおまかせ候補の展開は同じ文脈。
    overlay.openSheet(content, {
      ...(actionBar ? { bottom: actionBar } : {}),
      scrollKey: `sq:${sheetCtx.gen}:${sheetCtx.subView || 'main'}`,
    });
  }

  function closeSquareSheet() {
    sheetCtx = null;
    overlay.close();
  }

  // シートで選んだ編成をマスに残す（SW91）。編成の選択が変わる
  // たびにここを通し、ランの付帯（squareFormations）へ書き込む。
  // 保持は選択中の敵グループ（種）ごと（問題16）: 戦闘マスでは
  // アクティブな種の欄へ書き、それ以外の文脈では legacy へ書く。
  async function setSheetFormation(formationId) {
    if (!sheetCtx) return;
    sheetCtx.formationId = formationId;
    sheetCtx.outgoingSel = null;
    const fd = floorData(structure, sheetCtx.floor);
    const def = fd ? fd.squares[sheetCtx.squareId] : null;
    const species = def && (def.type === 'battle' || def.type === 'boss')
      ? sheetActiveSpecies(def) : null;
    setKeptFormation(sheetCtx.squareId, species, formationId);
    await persistRun();
  }

  async function openSquare(squareId) {
    // マスに残っている編成があれば、それを選んだ状態で開く（SW91）。
    // 複数種のマスでは、開いた直後の敵グループ（先頭の種）用の編成を
    // 選んだ状態にする（問題16）。編成が削除されていたら、その編成を
    // 指す保持だけを落とす。
    const fd0 = floorData(structure, viewFloor);
    const def0 = fd0 ? fd0.squares[squareId] : null;
    const species0 = def0 && (def0.type === 'battle' || def0.type === 'boss')
      ? ((def0.enemies || [])[0] || null) : null;
    const keptId = keptFormationId(squareId, species0);
    const keptFormation = keptId && formationsData
      ? formationsData.formations.find((f) => f.id === keptId) : null;
    if (keptId && !keptFormation) {
      dropKeptFormationRefs(keptId);
      await persistRun();
    }
    sheetCtx = {
      gen: ++ctxSeq,
      squareId,
      floor: viewFloor,
      formationId: keptFormation ? keptId : null,
      subView: null,
      // 探索の結果の入力の途中状態（resultSpecVm が管理する）。
      resultForm: null,
      resultFormExpectation: null,
      resultCommit: null,
      // 結果を直す（H2）側のフォームの途中状態。
      fixForm: null,
      fixFormSquareId: null,
      fixFormOp: null,
      fixCommit: null,
      boundaryPicks: new Set(),
      currentPending: null,
      postResult: null,
      // 敵シートの種タブの選択と、耐性一覧・攻略のポイントの
      // アコーディオンの開閉、シミュレーターのチップの開閉（その
      // マスのシートだけの途中状態。保存しない）。
      enemyTab: null,
      resistTableOpen: false,
      unlockGuideOpen: false,
      pointsOpen: new Map(),
      simOpen: new Set(),
      // 攻撃の見積もり（A5 改訂）の選択中の味方。null の間は
      // 見積もりが一番大きい味方が初期表示になる。
      outgoingSel: null,
      // シミュレーター本体の一時状態（SW95）: エディタの buildCtx
      // と同じ形でシート側が持つ。保存済みの編成は書き換えない。
      hbomb: null,
      kyoen: null,
      planMembers: [],
      planCandidates: null,
      planSelectedIds: null,
      explorePick: null,
      fillOpen: false,
      // ゲームのおすすめの転記（M7）: そのマス・その挑戦だけのものとして
      // 保存しない。シートを開くたびに未選択から始める。
      osusume: null,
    };
    listCtx = null;
    await ensureOrbs();
    await ensureCounter();
    await ensureReishou();
    await ensureTactics();
    ensureAllFloors();
    renderSquareSheet();
  }

  async function commitBattle(result) {
    const ctx = sheetCtx;
    if (!ctx) return;
    const formation = formationsData.formations.find((f) => f.id === ctx.formationId);
    if (!formation) return;
    const members = formation.slots.filter((s) => s.megidoId).map((s) => s.megidoId);
    const fd = floorData(structure, ctx.floor);
    const isBoss = fd && fd.squares[ctx.squareId] && fd.squares[ctx.squareId].type === 'boss';
    history = applyOp(history, {
      type: 'battle', squareId: ctx.squareId, floor: ctx.floor, result, members,
      formationId: formation.id, formationName: formation.name || '',
    });
    await persistRun();
    if (result === 'win') {
      const bossWon = isBoss && ctx.floor < 35;
      closeSquareSheet();
      // ボス勝利時の自動進行（棚卸し 2-7）: 次の階の表示へ自動で移り、
      // 次の階の顔見せカードを提示する（SW90。旧・階頭ビューの後継）。
      if (bossWon) viewFloor = ctx.floor + 1;
      await update();
      if (bossWon) await maybeShowFaceCard();
    } else {
      ctx.postResult = result;
      await update();
      renderSquareSheet();
    }
  }

  // 顔見せカードの提示（SW90）: テーマ・バトルルール・ボス名・要注意の敵・一行ヒント・注記の1枚。
  // 階見出し帯の「？」からの再表示もここを通る（表示済みには触らない）。
  function openFaceCard(floor) {
    const fd = floorData(structure, floor);
    if (!fd) return;
    overlay.openSheet(buildFaceCardView({
      floor,
      themeText: fd.theme && fd.theme !== 'なし' ? fd.theme : null,
      ruleText: floorBattleRule(fd),
      bossName: fd.boss || null,
      notableEnemy: fd.notableEnemy || null,
      floorHint: fd.floorHint || null,
      notes: fd.notes || [],
    }, {
      onClose: () => overlay.close(),
    }));
  }

  // 到着時の自動表示: 今いる階の顔見せカードを、そのランでまだ
  // 出していなければ1回だけ出す。出したら表示済みに記録して保存する
  // （ランが替われば記録ごとリセットされる）。マップ区画で何も
  // 開いていない時だけ出す（他のシートやビューの最中には割り込まない）。
  async function maybeShowFaceCard() {
    if (section !== 'map' || sheetCtx || overlay.isOpen()) return;
    const floor = derive().currentFloor;
    if (faceShownFloors.has(floor)) return;
    faceShownFloors.add(floor);
    await persistRun();
    openFaceCard(floor);
  }

  async function commitExplore(box, style, extra = {}) {
    const ctx = sheetCtx;
    if (!ctx) return;
    if (ctx.planMembers.length === 0) return; // メンバーなしでは記録しない
    const fd = floorData(structure, ctx.floor);
    const def = fd.squares[ctx.squareId];
    const op = {
      type: 'explore', squareId: ctx.squareId, floor: ctx.floor,
      members: [...ctx.planMembers], box,
    };
    if (style) op.style = style;
    if (extra.recoveryVariant != null) op.recoveryVariant = extra.recoveryVariant;
    // 記録された実値（画面に出た数・規模）。導出は実値を優先して消費し、
    // 無い場合だけ箱の実量表に落とす（旧い記録との互換）。
    if (typeof extra.powerGain === 'number') op.powerGain = extra.powerGain;
    if (typeof extra.recoveryCount === 'number') op.recoveryCount = extra.recoveryCount;
    if (typeof extra.recoveryStages === 'number') op.recoveryStages = extra.recoveryStages;
    if (extra.buffGains) op.buffGains = extra.buffGains;
    if (extra.buffPower) op.buffPower = extra.buffPower;
    // ランダムのボーナスの有無は、バフマスの記録では常に明示する
    // （出なかった = false という確定した事実。未入力・不明とは違う）。
    if (extra.buffBonus != null) op.buffBonus = extra.buffBonus;
    history = applyOp(history, op);
    await persistRun();
    ctx.resultForm = null;
    ctx.resultFormExpectation = null;
    ctx.resultCommit = null;
    await update();
    if (def.subType === 'recovery') {
      // 回復マスはシートの中で結果（自動反映と境界の確認）まで見せる（M9）。
      ctx.boundaryPicks = new Set();
    }
    // どの探索マスでも、記録の後は結果の返し（誰が何段階下がったかの
    // 名指し。棚卸し 3-11）をシートの中で見せる。閉じるは明示の操作。
    renderSquareSheet();
  }

  // 結果を直す（H2）: そのマスの最後の操作を、履歴の中で書き換える。
  function rewriteLatestOp(predicate, patch) {
    const ops = currentOps(history);
    let idx = -1;
    ops.forEach((op, i) => {
      if (predicate(op)) idx = i;
    });
    if (idx < 0) return false;
    const newOps = [...ops];
    newOps[idx] = { ...ops[idx], ...patch };
    history = createHistory(newOps);
    return true;
  }

  async function fixLatestBattle(result) {
    const ctx = sheetCtx;
    if (!ctx) return;
    const ok = rewriteLatestOp(
      (op) => op.type === 'battle' && op.squareId === ctx.squareId,
      { result },
    );
    if (!ok) return;
    await persistRun();
    ctx.subView = null;
    ctx.postResult = null;
    await update();
    renderSquareSheet();
  }

  // 結果を直す（H2）・探索: フォームで揃った記録材料で、そのマスの
  // 最後の探索操作の結果フィールドを全て付け直す。対象外のフィールドは
  // 消す（undefined を patch に含めると、書き換え後の操作から消える）。
  async function fixLatestExplore() {
    const ctx = sheetCtx;
    if (!ctx || !ctx.fixCommit) return;
    const c = ctx.fixCommit;
    const ok = rewriteLatestOp(
      (op) => op.type === 'explore' && op.squareId === ctx.squareId,
      {
        box: c.box,
        style: c.style || undefined,
        recoveryVariant: c.recoveryVariant != null ? c.recoveryVariant : undefined,
        recoveryCount: typeof c.recoveryCount === 'number' ? c.recoveryCount : undefined,
        recoveryStages: typeof c.recoveryStages === 'number' ? c.recoveryStages : undefined,
        powerGain: typeof c.powerGain === 'number' ? c.powerGain : undefined,
        buffGains: c.buffGains || undefined,
        buffPower: typeof c.buffPower === 'number' && c.buffPower > 0 ? c.buffPower : undefined,
        buffBonus: c.buffBonus != null ? c.buffBonus : undefined,
      },
    );
    if (!ok) return;
    await persistRun();
    ctx.subView = null;
    ctx.fixForm = null;
    ctx.fixFormSquareId = null;
    ctx.fixFormOp = null;
    ctx.fixCommit = null;
    await update();
    renderSquareSheet();
  }

  async function togglePick(id) {
    const ctx = sheetCtx;
    if (!ctx || !ctx.currentPending) return;
    const pending = ctx.currentPending;
    if (ctx.boundaryPicks.has(id)) {
      ctx.boundaryPicks.delete(id);
    } else {
      if (!pending.candidates.includes(id)) return;
      ctx.boundaryPicks.add(id);
    }
    if (ctx.boundaryPicks.size < pending.need) {
      renderSquareSheet();
      return;
    }
    // 必要数が揃った時点で確定する: 探索の操作に boundaryPicks を書き足す。
    const ops = currentOps(history);
    let idx = -1;
    ops.forEach((op, i) => {
      if (op.type === 'explore' && op.squareId === ctx.squareId) idx = i;
    });
    if (idx >= 0) {
      const op = ops[idx];
      const merged = [...new Set([...(op.boundaryPicks || []), ...ctx.boundaryPicks])];
      const newOps = [...ops];
      newOps[idx] = { ...op, boundaryPicks: merged };
      history = createHistory(newOps);
      await persistRun();
    }
    ctx.boundaryPicks = new Set();
    await update();
    renderSquareSheet();
  }

  const sheetCallbacks = {
    onOpenFormations: () => openFormationList('select'),
    onReselect: () => openFormationList('select'),
    // 敵シートの種タブと耐性アコーディオン（途中状態を変えて
    // 組み直すだけ。記録はしない）。
    onEnemyTab: (name) => {
      if (!sheetCtx) return;
      sheetCtx.enemyTab = name;
      // 編成の保持は敵グループごと（問題16）: 切り替えた先のグループ用に
      // 選んだ編成へ、確認・見積もり・シミュレーターの対象も切り替える。
      const keptId = keptFormationId(sheetCtx.squareId, name);
      const kept = keptId && formationsData
        ? formationsData.formations.find((f) => f.id === keptId) : null;
      sheetCtx.formationId = kept ? keptId : null;
      sheetCtx.outgoingSel = null;
      renderSquareSheet();
    },
    // 耐性一覧はマス単位で1つの表になったため、開閉はシート単位で
    // 1つだけ持つ（旧: 種ごとの resistOpenEnemies）。
    onResistTableToggle: () => {
      if (!sheetCtx) return;
      sheetCtx.resistTableOpen = !sheetCtx.resistTableOpen;
      renderSquareSheet();
    },
    // 未解放マスの案内のアコーディオン（案B）: 開閉はシート単位で
    // 1つだけ持つ。シートだけの途中状態で、記録はしない。
    onUnlockGuideToggle: () => {
      if (!sheetCtx) return;
      sheetCtx.unlockGuideOpen = !sheetCtx.unlockGuideOpen;
      renderSquareSheet();
    },
    // 攻略のポイントのアコーディオン（敵名×ポイント番号で持つ）と、
    // シミュレーターのチップの開閉（SW91）。どちらもシートだけの
    // 途中状態で、記録はしない。
    onPointToggle: (name, index) => {
      if (!sheetCtx) return;
      if (!sheetCtx.pointsOpen) sheetCtx.pointsOpen = new Map();
      const set = sheetCtx.pointsOpen.get(name) || new Set();
      if (set.has(index)) set.delete(index); else set.add(index);
      sheetCtx.pointsOpen.set(name, set);
      renderSquareSheet();
    },
    onSimToggle: (key) => {
      if (!sheetCtx) return;
      if (!sheetCtx.simOpen) sheetCtx.simOpen = new Set();
      if (sheetCtx.simOpen.has(key)) sheetCtx.simOpen.delete(key);
      else sheetCtx.simOpen.add(key);
      renderSquareSheet();
    },
    // 攻撃の見積もり（A5 改訂）の味方の切り替え。シートだけの
    // 途中状態で、記録はしない。
    onOutgoingSelect: (id) => {
      if (!sheetCtx) return;
      sheetCtx.outgoingSel = id;
      renderSquareSheet();
    },
    // シミュレーター本体の操作（SW95）: エディタと共用のハンドラを
    // シート側の env で束ねる。状態は sheetCtx の一時状態に置く。
    ...makeHbombHandlers(sheetHbombEnv),
    ...makeKyoenHandlers(sheetKyoenEnv),
    // 開始前確認から、その編成のエディタを直接開く（2026-11-19
    // ユーザー要望）。保存・キャンセルとも returnToSheet でマスの
    // シートへ戻り、確認表示が編集後の内容で組み直される。
    onEditFormation: () => {
      if (!sheetCtx || !sheetCtx.formationId) return;
      openFormationBuilder(sheetCtx.formationId, { returnToSheet: true });
    },
    onPastReselect: (id) => {
      if (!sheetCtx) return;
      setSheetFormation(id);
      sheetCtx.postResult = null;
      renderSquareSheet();
    },
    onCreateFormationFor: (enemyName) => {
      if (!sheetCtx) return;
      const floor = sheetCtx.floor;
      openFormationBuilder(null, { enemyName, floors: [floor], returnToSheet: true });
    },
    onOpenSquareGuide: (squareId) => openSquare(squareId),
    onResult: (result) => commitBattle(result),
    onCloseSheet: () => closeSquareSheet(),
    // 探索の結果の入力（写し取り形）: 行の候補を選ぶ・行を足す等の
    // 操作は途中状態（ctx.resultForm / ctx.fixForm）を変えるだけで、
    // 記録はしない。記録の実行は onRecordExplore（下部バーの
    // 「これで探索を記録する」）だけ。数入力は再描画せず、記録ボタン
    // の有効・無効だけをその場で切り替える（戻り値で渡す）。
    onLineChip: (lineKind, key) => {
      const t = resultFormTarget();
      if (!t) return;
      const f = t.form;
      if (lineKind === 'power') f.powerKey = key;
      else if (lineKind === 'recovery') f.scaleKey = key;
      else if (lineKind === 'buffMain') f.buffPctKey = key;
      else if (lineKind === 'bonusDmg' && f.bonusDmg) f.bonusDmg.key = key;
      else if (lineKind === 'bonusPower' && f.bonusPower) f.bonusPower.key = key;
      renderSquareSheet();
    },
    onLineCustomToggle: (lineKind) => {
      const t = resultFormTarget();
      if (!t) return;
      const f = t.form;
      const flip = (obj, prop) => { obj[prop] = !obj[prop]; };
      if (lineKind === 'power') flip(f, 'powerCustom');
      else if (lineKind === 'recovery') flip(f, 'scaleCustom');
      else if (lineKind === 'buffMain') flip(f, 'buffCustom');
      else if (lineKind === 'bonusDmg' && f.bonusDmg) f.bonusDmg.custom = !f.bonusDmg.custom;
      else if (lineKind === 'bonusPower' && f.bonusPower) f.bonusPower.custom = !f.bonusPower.custom;
      renderSquareSheet();
    },
    // 数入力は 'input' の間も確定（change）でも再描画しない。材料の
    // 組み立て直しと記録ボタンの有効・無効の切り替え（戻り値）だけを
    // 行う。再描画すると、入力からボタンへ移るタップの途中でボタンが
    // 差し替わり、タップが飲まれるため。
    onLineCustomInput: (lineKind, field, value) => {
      const t = resultFormTarget();
      if (!t) return false;
      const f = t.form;
      if (lineKind === 'power') f.powerValue = value;
      else if (lineKind === 'recovery' && field === 'count') f.scaleCount = value;
      else if (lineKind === 'recovery' && field === 'stages') f.scaleStages = value;
      else if (lineKind === 'buffMain') f.buffValue = value;
      else if (lineKind === 'bonusDmg' && f.bonusDmg) f.bonusDmg.value = value;
      else if (lineKind === 'bonusPower' && f.bonusPower) f.bonusPower.value = value;
      return t.refresh();
    },
    onLineStat: (code) => {
      const t = resultFormTarget();
      if (!t) return;
      t.form.buffStat = code;
      renderSquareSheet();
    },
    onLineStyle: (code) => {
      const t = resultFormTarget();
      if (!t) return;
      t.form.style = code;
      renderSquareSheet();
    },
    onLineDmgType: (code) => {
      const t = resultFormTarget();
      if (!t || !t.form.bonusDmg) return;
      t.form.bonusDmg.dmgType = code;
      renderSquareSheet();
    },
    onBonusAdd: (kind) => {
      const t = resultFormTarget();
      if (!t) return;
      if (kind === 'dmg' && !t.form.bonusDmg) t.form.bonusDmg = { key: null, custom: false, value: '', dmgType: 'single' };
      if (kind === 'power' && !t.form.bonusPower) t.form.bonusPower = { key: null, custom: false, value: '' };
      renderSquareSheet();
    },
    onBonusRemove: (kind) => {
      const t = resultFormTarget();
      if (!t) return;
      if (kind === 'dmg') t.form.bonusDmg = null;
      if (kind === 'power') t.form.bonusPower = null;
      renderSquareSheet();
    },
    onRecordExplore: () => {
      const ctx = sheetCtx;
      if (!ctx || !ctx.resultCommit) return;
      const c = ctx.resultCommit;
      commitExplore(c.box, c.style, {
        recoveryVariant: c.recoveryVariant,
        powerGain: c.powerGain,
        recoveryCount: c.recoveryCount, recoveryStages: c.recoveryStages,
        buffGains: c.buffGains, buffPower: c.buffPower, buffBonus: c.buffBonus,
      });
    },
    onExploreMemberTap: (id) => {
      sheetCtx.explorePick = { mode: 'swap', targetId: id };
      renderExploreCandidates();
    },
    onExploreAdd: () => {
      sheetCtx.explorePick = { mode: 'add', targetId: null };
      renderExploreCandidates();
    },
    onExploreReset: () => {
      if (!sheetCtx || !sheetCtx.planSelectedIds) return;
      sheetCtx.planMembers = [...sheetCtx.planSelectedIds];
      renderSquareSheet();
    },
    // おすすめの転記（M7）: ゲーム画面に出ているおすすめを写す機械的な
    // 入力（判断のタップではない）。変えたら、そのラインで候補を生成
    // し直し、枠は空に戻す（古いラインで入れた顔ぶれは残さない）。
    // 選択はそのマス・その挑戦だけのもので、保存しない。
    // おすすめは常に1つだけ（2026-11-19 ユーザー補正）: スタイル群と
    // クラス群を通じた単一選択（nextOsusume）。解除は「選ばない」と
    // いう選択肢ではなく「キャンセル」の操作で、戻れば表示は「未選択」。
    onOsusumeStyle: (style) => {
      if (!sheetCtx) return;
      sheetCtx.osusume = nextOsusume(sheetCtx.osusume, { style });
      sheetCtx.planCandidates = null;
      sheetCtx.planMembers = [];
      sheetCtx.planSelectedIds = null;
      sheetCtx.fillOpen = false;
      renderSquareSheet();
    },
    onOsusumeClass: (className) => {
      if (!sheetCtx) return;
      sheetCtx.osusume = nextOsusume(sheetCtx.osusume, { className });
      sheetCtx.planCandidates = null;
      sheetCtx.planMembers = [];
      sheetCtx.planSelectedIds = null;
      sheetCtx.fillOpen = false;
      renderSquareSheet();
    },
    onOsusumeCancel: () => {
      if (!sheetCtx) return;
      sheetCtx.osusume = null;
      sheetCtx.planCandidates = null;
      sheetCtx.planMembers = [];
      sheetCtx.planSelectedIds = null;
      sheetCtx.fillOpen = false;
      renderSquareSheet();
    },
    // 補助の候補（「候補で埋める」）: 入口ではなく、開いてから選ぶ。
    onExploreFillOpen: () => {
      if (!sheetCtx) return;
      sheetCtx.fillOpen = true;
      renderSquareSheet();
    },
    onExploreFillClose: () => {
      if (!sheetCtx) return;
      sheetCtx.fillOpen = false;
      renderSquareSheet();
    },
    // 候補で埋める: 候補を1件タップすると、その組み合わせが枠に入る。
    // このタップは判断のタップとして数える（タップ数の設計は ui-flow.md）。
    // 選んだ候補のメンバー構成は結果記録まで持ち越される（再入力は無い）。
    onExplorePickCandidate: (ids) => {
      if (!sheetCtx || !Array.isArray(ids)) return;
      sheetCtx.planSelectedIds = [...ids];
      sheetCtx.planMembers = [...ids];
      sheetCtx.fillOpen = false;
      renderSquareSheet();
    },
    // 枠を空に戻す: 手で入れ直すための操作（判断ではない）。
    onExploreClear: () => {
      if (!sheetCtx) return;
      sheetCtx.planSelectedIds = null;
      sheetCtx.planMembers = [];
      renderSquareSheet();
    },
    onTogglePick: (id) => togglePick(id),
    onShowFix: () => {
      sheetCtx.subView = 'fix';
      renderSquareSheet();
    },
    onFixResult: (result) => fixLatestBattle(result),
    onFixApply: () => fixLatestExplore(),
    onShowHistory: () => {
      sheetCtx.subView = 'history';
      renderSquareSheet();
    },
    onBack: () => {
      sheetCtx.subView = null;
      renderSquareSheet();
    },
  };

  // ---- 編成を選ぶ（M5）／編成の管理 ----
  // 同じ一覧・同じデータを、2つのモードで開く:
  //   select: 戦闘マスのシートから（行タップで選んでシートに戻る）。
  //   manage: マップ下部の「編成」から（戦闘の文脈なしに作成・編集・削除）。
  // モードの違いは一覧側で吸収する（builder は vm.mode を見る）。
  function openFormationList(mode = 'select') {
    if (!listCtx || listCtx.mode !== mode) {
      listCtx = {
        gen: ++ctxSeq,
        mode,
        query: '', styleFilter: null, usableOnly: false, blockedId: null,
        focusSearch: false, deleteConfirmId: null,
        context: null, contextFilter: true,
        // 絞り込みアコーディオンの開閉（問題11、2026-11-27）: 既定は閉。
        filterOpen: false,
        // 「今いる階」フィルタ（SW94、編成区画のみ）: 既定は ON。
        floorFilter: true,
      };
      // 選択モードでは、開いているマスの文脈（敵・階）で先に絞って
      // 手渡す（棚卸し 5-6）。管理モードには文脈が無い。
      if (mode === 'select' && sheetCtx) {
        const fd = floorData(structure, sheetCtx.floor);
        const def = fd ? fd.squares[sheetCtx.squareId] : null;
        if (def && (def.type === 'battle' || def.type === 'boss')) {
          // 「有効な編成」の文脈は選択中の敵グループに合わせる
          // （問題16: 編成の保持がグループごとになったため、他の
          // 種に向けた編成まで「有効」に数えない）。
          const active = sheetActiveSpecies(def);
          listCtx.context = {
            floor: sheetCtx.floor,
            enemyNames: active ? [active] : [...(def.enemies || [])],
          };
        }
      }
    }
    renderFormationList();
  }

  // 文脈（敵・階）にタグが合う編成か: 対象の敵・対象の階・タグの文言で判定。
  function matchesContext(f, context) {
    if (!context) return false;
    if (f.enemyName && context.enemyNames.includes(f.enemyName)) return true;
    if ((f.floors || []).includes(context.floor)) return true;
    for (const t of normalizeTags(f.tags)) {
      if (context.enemyNames.includes(t.text)) return true;
      if (t.text === `${context.floor}F`) return true;
    }
    return false;
  }

  // 対象の1行（SW94）: 「対象: 1F・3F 死をあやす者」。対象が無ければ null。
  function formationTargetText(f, targetFloors) {
    const parts = [];
    if (targetFloors.length > 0) parts.push(targetFloors.map((n) => `${n}F`).join('・'));
    if (f.enemyName) parts.push(f.enemyName);
    return parts.length > 0 ? `対象: ${parts.join(' ')}` : null;
  }

  // その編成自身の勝敗の1行（SW94）: ID で数えた分と、ID の無い旧
  // 記録（名前で数えた分）を合わせる。戦績が無ければ「まだ戦っていない」。
  function formationRecordText(f, counts) {
    const byIdCount = counts.get(`id:${f.id}`);
    const byNameCount = f.name ? counts.get(`name:${f.name}`) : null;
    const sum = (k) => (byIdCount ? byIdCount[k] : 0) + (byNameCount ? byNameCount[k] : 0);
    const battles = sum('battles');
    if (battles === 0) return 'まだ戦っていない';
    const retreats = sum('retreats');
    return `${sum('wins')}勝${sum('losses')}敗${retreats > 0 ? `・${retreats}リタイア` : ''}`;
  }

  function renderFormationList() {
    const derived = derive();
    // そのマスの脅威へのカバー（M5）: 戦闘マスのシートから開いた時だけ、
    // 索引で判定した対応／未対応を編成ごとに用意する。
    // 著述のある敵は導出の対象から外し（M4 と同じ扱い。案1）、その敵の
    // カバーは著述の「有効な戦術」を根拠に用意する。
    let coverageByFormation = null;
    if (listCtx.mode === 'select' && sheetCtx && counterData && floorEnemies) {
      const fd = floorData(structure, sheetCtx.floor);
      const def = { floor: sheetCtx.floor, ...fd.squares[sheetCtx.squareId] };
      if (def.type === 'battle' || def.type === 'boss') {
        const found = threatsForSquare({ def, floorEnemies, clsById: counterData.clsById });
        const authoredByEnemy = new Map();
        for (const name of def.enemies || []) {
          const a = authoredEntryFor(tacticsData, name, def, sheetCtx.squareId);
          if (a) authoredByEnemy.set(name, a);
        }
        if (found && (found.threats.length > 0 || authoredByEnemy.size > 0)) {
          // 導出側は統合演算の導出項目だけにする（敵シート作り直し、
          // 2026-11-20: 著述のある敵でも、著述に対応しない導出の脅威は
          // カバー判定に出す。ボス著述の敵は文章が正で対象外）。
          // 耐性の適格（型5）は敵ごとに効くため、formationCoverage は
          // 敵ごとに呼んで enemyFact を渡す。
          const derivedByEnemy = [];
          for (const e of found.enemies) {
            const a = authoredByEnemy.get(e.name) || null;
            if (a && a.kind === 'boss') continue;
            const fact = floorEnemies.enemies[e.name];
            const unified = enemyThreatsUnified({
              fact, authored: a, clsById: counterData.clsById,
              threatLevels: counterData.threatLevels,
            });
            const ts = unified
              .filter((t) => t.source === 'derived')
              .map((t) => ({ ...t.derived, enemyName: e.name }));
            if (ts.length > 0) derivedByEnemy.push({ fact, threats: ts });
          }
          coverageByFormation = new Map(formationsData.formations.map((f) => [
            f.id,
            {
              derived: derivedByEnemy.flatMap(({ fact, threats: ts }) => formationCoverage({
                formation: f, threats: ts,
                clsById: counterData.clsById, index: counterData.index,
                conditionOf: derived.conditionOf,
                levelOf, styleClassOf, enemyFact: fact,
                restricted: restrictionOf(def),
              })),
              authored: [...authoredByEnemy.entries()].map(([enemyName, a]) => ({
                enemyName,
                kind: a.kind,
                lines: authoredCoverage({
                  authored: a, formation: f, index: counterData.index,
                  levelOf, styleClassOf,
                  enemyFact: floorEnemies.enemies[enemyName] || null,
                  restricted: restrictionOf(def),
                }),
              })),
            },
          ]));
        }
      }
    }
    // その編成自身の勝敗（SW94）: 全ランの戦闘 op から、勝率集計と
    // 同じキー（ID 優先、ID の無い旧記録は名前）で数える。しきい値は
    // 無い（記録タブの勝率の集計そのものは変えない）。
    const battleCounts = formationBattleCounts(structure, [
      currentOps(history), ...records.runs.map((r) => r.ops),
    ]);
    // 編成同士の重複（調査 A3）: 保存済み編成の間で同じメギドが
    // 入っている事実。行には事実の文だけを付け、評価はしない。
    const overlapsByFormation = formationOverlaps(formationsData.formations, byId);
    const rowsAll = formationsData.formations.map((f) => {
      const usability = formationUsability(f, {
        owned: derived.owned, conditionOf: derived.conditionOf, byId,
      });
      return {
        formation: f,
        usable: usability.usable,
        reasons: usability.reasons,
        worstStage: worstStageOf(f, derived.conditionOf),
        members: membersWithEquipment(formationMembers(f, byId)),
        targetFloors: formationTargetFloors(f, structure),
      };
    });
    rowsAll.sort(compareFormationRows);
    // 文脈の先行絞り込み: 合う編成が1件でもある時だけ絞る（0件で絞ると
    // 行き止まりになるため、その場合は全件＋注記に切り替える）。
    const context = listCtx.context;
    const contextHasMatches = context
      ? rowsAll.some((r) => matchesContext(r.formation, context))
      : false;
    const contextFiltered = Boolean(context && contextHasMatches && listCtx.contextFilter);
    const q = normalizeSearchText(listCtx.query.trim());
    const rows = rowsAll.filter((r) => {
      if (contextFiltered && !matchesContext(r.formation, context)) return false;
      // 「今いる階」フィルタ（SW94、編成区画のみ）: 対象の階に今いる
      // 階を含む編成だけを出す。対象なしの編成はここでは出ない。
      if (listCtx.mode === 'manage' && listCtx.floorFilter
        && !r.targetFloors.includes(derived.currentFloor)) return false;
      if (listCtx.usableOnly && !r.usable) return false;
      if (listCtx.styleFilter && !r.members.some((m) => m.style === listCtx.styleFilter)) return false;
      if (q && !formationMatchesQuery(r.formation, byId, listCtx.query)) return false;
      return true;
    }).map((r) => {
      let worstText = null;
      if (r.worstStage !== null) {
        const worstMember = r.members.find(
          (m) => m.megidoId && derived.conditionOf(m.megidoId) === r.worstStage,
        );
        worstText = `最も悪いコンディション: ${worstMember ? worstMember.name : ''}（${CONDITION_STAGES[r.worstStage]}）`;
      }
      let coverageLines = null;
      if (coverageByFormation && coverageByFormation.has(r.formation.id)) {
        const covSet = coverageByFormation.get(r.formation.id);
        coverageLines = [];
        // 状態異常が「未対応」と出た場合の留保（案2）: 霊宝と絶好調の
        // 耐性は導出に入っていないため、断定せず一行だけ添える。
        let ailmentUncovered = false;
        for (const c of covSet.derived) {
          coverageLines.push({
            covered: c.covered,
            text: c.covered
              ? `対策済み: ${c.name}（${c.coveredBy[0]}${c.coveredBy.length > 1 ? ' ほか' : ''}）`
              : `未対策: ${c.name}`,
          });
          // M4 の絶好調の注記をカバー行にも出す（案2）。
          if (c.covered && c.greatResist.length > 0) {
            coverageLines.push({
              covered: null,
              text: `絶好調で耐性+50%の上乗せがある候補: ${c.greatResist.slice(0, 4).join('、')}`,
            });
          }
          if (!c.covered && c.ailment) ailmentUncovered = true;
        }
        // 著述のある敵のカバーは、著述の「有効な戦術」が根拠（案1）。
        for (const a of covSet.authored) {
          if (a.kind === 'boss') {
            coverageLines.push({
              covered: null,
              text: `${a.enemyName}: 対策は攻略情報のとおりです（有効な戦術は「敵の弱点と対策」にあります）`,
            });
            continue;
          }
          for (const line of a.lines) {
            if (line.covered === null) {
              coverageLines.push({
                covered: null,
                text: `攻略情報: ${line.label}（${a.enemyName}）`,
              });
            } else {
              coverageLines.push({
                covered: line.covered,
                text: line.covered
                  ? `対策済み: ${line.label}（${line.coveredBy[0]}${line.coveredBy.length > 1 ? ' ほか' : ''}）`
                  : `未対策: ${line.label}`,
              });
              if (line.resistUncovered) ailmentUncovered = true;
            }
          }
        }
        if (ailmentUncovered) {
          coverageLines.push({
            covered: null,
            text: '霊宝や絶好調の耐性（+50%）で足りている場合があります',
          });
        }
      }
      return {
        id: r.formation.id,
        name: r.formation.name,
        targetText: formationTargetText(r.formation, r.targetFloors),
        recordText: formationRecordText(r.formation, battleCounts),
        targetFloors: r.targetFloors,
        composition: styleComposition(r.formation, byId),
        usable: r.usable,
        reasons: r.reasons,
        blockedFlash: listCtx.blockedId === r.formation.id,
        worstText,
        overlapLines: (overlapsByFormation.get(r.formation.id) || [])
          .map((o) => `${o.name}は${o.others.join('、')}でも使っている`),
        coverageLines,
        tags: normalizeTags(r.formation.tags),
        notes: r.formation.notes || '',
        memberLines: r.members.filter((m) => m.megidoId).map((m) =>
          `${m.label}: ${m.name}（${m.style}・${CONDITION_STAGES[derived.conditionOf(m.megidoId)]}）／オーブ${m.orbId ? 'あり' : 'なし'}`),
        members: r.members.filter((m) => m.megidoId).map((m) => ({
          label: m.label, name: m.name, style: m.style,
          stage: derived.conditionOf(m.megidoId),
          stageLabel: CONDITION_STAGES[derived.conditionOf(m.megidoId)],
          orbText: m.orbId ? orbNameText(m.orbId) : 'なし',
          reishouSummary: m.reishouIds.length > 0 ? reishouSlotSummary(m.megidoId) : null,
        })),
      };
    });
    // 「今いる階」フィルタ OFF（編成区画）: 全件を階ごとの見出しで
    // 区切る（SW94。編成は100件規模の前提）。対象の階が複数ある編成
    // は、それぞれの階の区切りに出る（対象の意味論どおり）。対象なし
    // は最後。件数表示は編成の実数（重複して出る分は数えない）。
    let groups = null;
    if (listCtx.mode === 'manage' && !listCtx.floorFilter) {
      const byFloor = new Map();
      const noTarget = [];
      for (const row of rows) {
        if (row.targetFloors.length === 0) {
          noTarget.push(row);
          continue;
        }
        for (const fl of row.targetFloors) {
          if (!byFloor.has(fl)) byFloor.set(fl, []);
          byFloor.get(fl).push(row);
        }
      }
      groups = [...byFloor.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([floor, rs]) => ({ label: `${floor}F`, rows: rs }));
      if (noTarget.length > 0) groups.push({ label: '対象なし', rows: noTarget });
    }
    const vm = {
      mode: listCtx.mode,
      query: listCtx.query,
      styleFilter: listCtx.styleFilter,
      usableOnly: listCtx.usableOnly,
      floorFilterOn: listCtx.mode === 'manage' ? listCtx.floorFilter : null,
      floorFilterFloor: listCtx.mode === 'manage' ? derived.currentFloor : null,
      groups,
      emptyText: listCtx.mode === 'manage' && listCtx.floorFilter
        ? `今いる階（${derived.currentFloor}F）向けの編成はまだありません`
        : null,
      rows,
      totalCount: rowsAll.length,
      shownCount: rows.length,
      deleteConfirmId: listCtx.deleteConfirmId,
      filterOpen: Boolean(listCtx.filterOpen),
      // 「有効な編成」の切り替え（問題13、2026-11-27）: バナー＋
      // 「すべて表示」は廃止し、切り替えボタンだけを渡す。合う編成が
      // 1件も無い文脈では、切り替えても何も変わらないため切り替え
      // 自体を出さない（vm.context を null にする）。照合と、先行
      // 絞り込みの効き方（合う編成がある時だけ絞る）は従来のまま。
      context: context && contextHasMatches
        ? { validOnly: listCtx.contextFilter }
        : null,
    };
    const { top, content, searchInput, bottom } = buildFormationList(vm, listCallbacks);
    if (listCtx.mode === 'manage') {
      // 管理モードは編成区画そのもの。構築などの全画面が開いていれば畳み、
      // 区画へ描く（区画が編成でない間に呼ばれた場合は次の切り替えで描かれる）。
      overlay.closeFull();
      if (section === 'formations') mountSection(top, content, bottom);
    } else {
      // 選択モードはマスのシートの上に重なる全画面のまま。
      // スクロール保持の文脈は一覧を開いた世代（絞り込みや検索の再描画で
      // 保持し、開き直せば先頭から）。
      overlay.openFull(content, { top, bottom, scrollKey: `list:${listCtx.gen}` });
    }
    if (listCtx.focusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    listCtx.focusSearch = false;
  }

  const listCallbacks = {
    onQuery: (text) => {
      listCtx.query = text;
      listCtx.focusSearch = true;
      listCtx.deleteConfirmId = null;
      renderFormationList();
    },
    onStyleFilter: (s) => {
      listCtx.styleFilter = s;
      listCtx.deleteConfirmId = null;
      renderFormationList();
    },
    onToggleUsableOnly: () => {
      listCtx.usableOnly = !listCtx.usableOnly;
      listCtx.deleteConfirmId = null;
      renderFormationList();
    },
    onToggleFloorFilter: () => {
      listCtx.floorFilter = !listCtx.floorFilter;
      listCtx.deleteConfirmId = null;
      renderFormationList();
    },
    onToggleFilter: () => {
      listCtx.filterOpen = !listCtx.filterOpen;
      renderFormationList();
    },
    // 「有効な編成」の切り替え（問題13）: ON の時だけ文脈に合う
    // 編成だけを出す。照合（matchesContext）は従来のまま。
    onToggleContextValid: () => {
      listCtx.contextFilter = !listCtx.contextFilter;
      listCtx.deleteConfirmId = null;
      renderFormationList();
    },
    // 戦術メモの編集（棚卸し 4-9）: メモだけを更新する経路（現行ツールの
    // handleSaveFormationMemo と同じ）。選ぶ場面・管理の両方から開ける。
    onMemo: (id) => {
      const target = formationsData.formations.find((f) => f.id === id);
      if (!target) return;
      overlay.openSheet(buildMemoEditor({
        name: target.name || '（名前なし）',
        notes: target.notes || '',
      }, {
        onSave: async (text) => {
          formationsData = {
            ...formationsData,
            formations: formationsData.formations.map((f) => (
              f.id === id ? { ...f, notes: text } : f
            )),
          };
          await saveFormationsData(backend, formationsData);
          overlay.close();
          renderFormationList();
        },
        onCancel: () => {
          overlay.close();
          renderFormationList();
        },
      }));
    },
    // 編成のコピー（棚卸し 5-11）: カードの操作として実装する。
    onCopy: async (id) => {
      const target = formationsData.formations.find((f) => f.id === id);
      if (!target) return;
      const copy = copyFormationRecord(target, newFormationId(), byId);
      formationsData = {
        ...formationsData,
        formations: [...formationsData.formations, copy],
      };
      await saveFormationsData(backend, formationsData);
      setNotice(`編成をコピーしました: ${copy.name}`);
      renderFormationList();
    },
    onSelect: (id) => {
      if (!sheetCtx) return;
      if (listCtx && listCtx.mode === 'manage') return; // 管理モードでは選択しない
      setSheetFormation(id);
      sheetCtx.postResult = null;
      overlay.closeFull();
      renderSquareSheet();
    },
    onBlocked: (id) => {
      listCtx.blockedId = id;
      renderFormationList();
    },
    // 編成を組む（M6）への導線と、一覧での管理（編集・削除）。
    // 選択モード（マスのシートから開いた一覧）での新規作成は、
    // 見ていたマスの敵を対象に入れた状態で始める（SW92、入口の
    // 文脈を落とさない）。対象はシートで見ていた種（種タブの選択、
    // 無ければ先頭の種）。保存後の戻りは従来どおり選択モードの
    // 経路（シートへ戻って新しい編成が選ばれた状態で確認表示）。
    onCreateNew: () => {
      if (listCtx && listCtx.mode === 'select' && sheetCtx
        && listCtx.context && listCtx.context.enemyNames.length > 0) {
        const names = listCtx.context.enemyNames;
        const enemyName = names.includes(sheetCtx.enemyTab)
          ? sheetCtx.enemyTab : names[0];
        openFormationBuilder(null, {
          enemyName, floors: [listCtx.context.floor],
        });
        return;
      }
      openFormationBuilder(null);
    },
    onEdit: (id) => openFormationBuilder(id),
    // 削除は、その場の連打では確定しない（原則9）: 一覧のボタンは確認の
    // シートを開くだけで、確定は別の場所の編成名つきボタンで行う。
    onDelete: (id) => {
      const target = formationsData.formations.find((f) => f.id === id);
      if (!target) return;
      overlay.openSheet(buildDeleteFormationConfirm(target.name || '（名前なし）', {
        onConfirm: async () => {
          formationsData = {
            ...formationsData,
            formations: formationsData.formations.filter((f) => f.id !== id),
          };
          await saveFormationsData(backend, formationsData);
          if (sheetCtx && sheetCtx.formationId === id) sheetCtx.formationId = null;
          // マスに残した対応も、削除された編成を指すものは落とす
          // （legacy・敵グループ別どちらも。問題16）。
          if (dropKeptFormationRefs(id)) await persistRun();
          overlay.close();
          renderFormationList();
        },
        onCancel: () => {
          overlay.close();
          renderFormationList();
        },
      }));
    },
  };

  // ---- 編成を組む（M6・核） ----
  // 状態は buildCtx に持つ。枠タップ → 候補ビュー、オーブボタン → オーブ選択、
  // 保存 → formations ストアへ書き、M5 の一覧に即座に現れる。
  // ME の適合表示と対策での候補の絞り込みは、ME データ待ちのため作らない。
  let buildCtx = null;

  function newFormationId() {
    return `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  async function openFormationBuilder(formationId, preset = null) {
    await ensureOrbs();
    await ensureCounter();
    await ensureReishou();
    ensureAllFloors();
    const existing = formationId
      ? formationsData.formations.find((f) => f.id === formationId) || null
      : null;
    buildCtx = {
      gen: ++ctxSeq,
      mode: existing ? 'edit' : 'new',
      id: existing ? existing.id : null,
      name: existing ? (existing.name || '') : '',
      slots: existing
        ? existing.slots.map((s) => ({
          megidoId: s.megidoId || null,
          orbId: s.orbId || null,
          reishouIds: [...(s.reishouIds || [])],
          leaderSkill: s.leaderSkill || '',
        }))
        : emptySlots(),
      slotIndex: null,
      query: '',
      styleFilter: null,
      classFilter: null,
      focusSearch: false,
      orbQuery: '',
      orbFocusSearch: false,
      orbRace: null,
      orbCt: null,
      orbKind: null,
      // ターゲット選択（敵・階）とカスタムタグとメモ（棚卸し 5-4・5-6・4-9）。
      // preset はスタートマスの階概要からの初期値（敵・階）。
      targetEnemy: existing
        ? (existing.enemyName || null)
        : (preset && preset.enemyName) || null,
      targetFloors: existing
        ? [...(existing.floors || [])]
        : (preset && preset.floors) || [],
      customTags: existing ? customTagTexts(existing.tags).join(', ') : '',
      notes: existing ? (existing.notes || '') : '',
      // チェインのテストの状態（起点のメギドIDと、外した行動の
      // キー列。保存はしない、その場の確認だけの状態）。
      chainTest: newChainTest(),
      // Hボムプランナーの状態（保存しない、その場の確認だけ。
      // hbombSectionVm が署名で初期化する）。
      hbomb: null,
      kyoen: null,
      enemyQuery: '',
      enemyFocusSearch: false,
      pickingEnemy: false,
      view: 'main', // 表示中の下位ビュー（main/slot/orb/enemy）。再描画の振り分けに使う
      returnToSheet: Boolean(preset && preset.returnToSheet),
    };
    renderBuilder();
    // ターゲットのギミックとピッカーのヒントは、全階の敵データと著述が
    // 材料。読み込みが終わった時点で表示中のビューを作り直す（メギド
    // 画面の再描画と同じ流儀）。
    const gen = buildCtx.gen;
    Promise.all([ensureAllFloors(), ensureTactics()]).then(() => {
      if (buildCtx && buildCtx.gen === gen) rerenderBuildView();
    }).catch(() => {});
  }

  // 表示中の構築ビューを作り直す（材料の読み込み完了時）。
  function rerenderBuildView() {
    if (!buildCtx) return;
    if (buildCtx.view === 'slot') renderSlotCandidates();
    else if (buildCtx.view === 'orb') renderOrbPicker();
    else if (buildCtx.view === 'enemy') renderEnemyPicker();
    else renderBuilder();
  }

  // フォトンの供給（2026-11-19 調整フライト）: そのメンバーが、
  // その種別のフォトンを「追加」でまかなえるかを編成全体から引く。
  // 材料は photon-supply.v1.json（能力・オーブ・マスエフェクトの
  // 原文への機械検出）。保証の優先順位は、自分の能力 → 装備オーブ
  // → リーダーのマスエフェクト（その枠に効く分）→ 味方（自分を
  // 含む）の能力 → 味方のオーブ。確率の追加しか無い場合は、確定の
  // 保証が編成のどこにも無い時だけ 'prob' として返す。
  // 味方への追加の範囲（scope）の解決: all は全員、others /
  // othersAll は付与者以外、single は任意の味方（自身も選べる）、
  // neighbors は隣の枠だけ。前列／後列は、列の決まりが基礎データ
  // に無いため、範囲を出典に併記した上でまかなえる側に数える
  // （ME の性別条件と同じ扱い）。追加を使う順序（味方が先に動く
  // 等）は判定しない。
  const photonGuaranteeInFormation = (memberId, photonType) => {
    const supply = counterData ? counterData.photonSupply : null;
    if (!supply || !buildCtx) return null;
    const slots = buildCtx.slots;
    const memberIdx = slots.findIndex((s) => s.megidoId === memberId);
    if (memberIdx < 0) return null;
    const nameOf = (id) => {
      const b = byId.get(id);
      return b ? b.name : id;
    };
    const findIn = (list) => (list || []).find((a) => a.photon === photonType);
    for (const probTier of [false, true]) {
      const selfKey = probTier ? 'selfProb' : 'self';
      const allyKey = probTier ? 'allyProb' : 'ally';
      const level = probTier ? 'prob' : 'guaranteed';
      // 自分の能力。
      const own = supply.megido[memberId];
      const ownHit = own ? findIn(own[selfKey]) : null;
      if (ownHit) return { level, source: `自分の${ownHit.medium}` };
      // 自分のオーブ（装備者への追加）。
      const orbId = slots[memberIdx].orbId;
      const orbRec = orbId ? supply.orbs[orbId] : null;
      const orbHit = orbRec ? findIn(orbRec[selfKey]) : null;
      if (orbHit) return { level, source: `オーブの${orbHit.medium}` };
      // リーダーのマスエフェクト（その枠に効く分だけ。確率の概念は
      // 無いため確定の段でだけ見る）。
      if (!probTier) {
        const leaderId = slots[2] ? slots[2].megidoId : null;
        const meEntries = leaderId ? supply.me[leaderId] : null;
        if (meEntries) {
          const b = byId.get(memberId);
          const hit = meEntries.find((e) => {
            if (e.photon !== photonType) return false;
            if (e.slot !== ME_SLOT_KEYS[memberIdx]) return false;
            const parts = String(e.condition || '').split(/[+＋]/)
              .map((s) => s.trim()).filter(Boolean);
            const genders = parts
              .map((p) => (p === '男性' || p === '男' ? '男性' : p === '女性' || p === '女' ? '女性' : null))
              .filter(Boolean);
            const known = parts.filter((p) => p !== '男性' && p !== '女性' && p !== '男' && p !== '女' && p !== '-');
            return b && known.every((p) => p === b.style || p === b.class)
              && (!b.gender || genders.every((g) => g === b.gender));
          });
          if (hit) {
            return {
              level,
              source: `リーダーのマスエフェクト${hit.condText ? `（${hit.condText}）` : ''}`,
            };
          }
        }
      }
      // 味方（自分を含む）の能力とオーブの、味方への追加。
      for (let gi = 0; gi < slots.length; gi += 1) {
        const g = slots[gi];
        if (!g.megidoId) continue;
        const isSelf = g.megidoId === memberId;
        const covers = (scope) => {
          if (scope === 'all' || scope === 'single') return true;
          if (scope === 'others' || scope === 'othersAll') return !isSelf;
          if (scope === 'neighbors') return Math.abs(gi - memberIdx) === 1;
          if (scope === 'front' || scope === 'back') return true;
          return false;
        };
        const gRec = supply.megido[g.megidoId];
        const gHit = gRec
          ? (gRec[allyKey] || []).find((a) => a.photon === photonType && covers(a.scope))
          : null;
        if (gHit) {
          const scopeNote = gHit.scope === 'front' ? '（味方前列への追加）'
            : gHit.scope === 'back' ? '（味方後列への追加）' : '';
          return {
            level,
            source: isSelf
              ? `自分の${gHit.medium}${scopeNote}`
              : `${nameOf(g.megidoId)}の${gHit.medium}${scopeNote}`,
          };
        }
        const gOrb = g.orbId ? supply.orbs[g.orbId] : null;
        const gOrbHit = gOrb
          ? (gOrb[allyKey] || []).find((a) => a.photon === photonType && covers(a.scope))
          : null;
        if (gOrbHit) {
          return {
            level,
            source: isSelf
              ? `オーブの${gOrbHit.medium}`
              : `${nameOf(g.megidoId)}のオーブの${gOrbHit.medium}`,
          };
        }
      }
    }
    return null;
  };

  // メンバーがまかなえるフォトンと容量の上昇（チェイン区画の
  // チップに出す短い材料表示）。保証できる種別を「〜追加」とし、
  // 自分にかかる容量の上昇を「容量+N」とする。
  const memberSupplyText = (memberId) => {
    const parts = [];
    for (const t of ['アタック', 'スキル', 'チャージ']) {
      const g = photonGuaranteeInFormation(memberId, t);
      if (g && g.level === 'guaranteed') parts.push(`${t}追加`);
    }
    const supply = counterData ? counterData.photonSupply : null;
    if (supply && buildCtx) {
      const idx = buildCtx.slots.findIndex((s) => s.megidoId === memberId);
      const caps = [];
      const own = supply.megido[memberId];
      if (own) {
        for (const c of own.capacityUp || []) {
          if (c.scope === 'self' || c.scope === 'all') caps.push(c.amount);
        }
      }
      const orbId = idx >= 0 ? buildCtx.slots[idx].orbId : null;
      const orbRec = orbId ? supply.orbs[orbId] : null;
      if (orbRec) {
        for (const c of orbRec.capacityUp || []) caps.push(c.amount);
      }
      if (caps.length) parts.push(`容量+${Math.max(...caps)}`);
    }
    return parts.join('・');
  };

  // チェインのテスト道具が使う、専用霊宝の装備有無（メギド側の
  // 装備が正。フラグの無いメギドは対象外）。
  const chainSpecialReishouOf = (id) => {
    const b = byId.get(id);
    const d = formationsData && formationsData.megidoDetails
      ? formationsData.megidoDetails[id] : null;
    return resolveSpecialReishou(d, Boolean(b && b.specialReishou));
  };

  // チェインのテストの状態の初期形（保存しない、その場の確認
  // だけの状態）。overrides は手組みの指定（"メギドID#回数" →
  // { wayKey } | { stopPhoton }）、ignoredProb は無視している
  // 確率の形のキー列。
  const newChainTest = () => ({
    originId: null, skipped: [], error: null, lastActions: [],
    overrides: {}, ignoredProb: [],
  });

  // チェインの材料をメンバーごとに組み立てる: 本体の記録へ、
  // 装備オーブのチェイン（via: 'orb'）と、リーダーのマスエフェクト
  // がその枠・そのメンバーに付けている始動（via: 'me'）を混ぜる。
  // ME の枠と条件の照合は ME 要約と同じ規則（counter.js の
  // meConditionVerdict。'match' の時だけ付く）。ME の始動は条件行
  // 1・2行目にしか無いため、サブマスエフェクトの3行目上書きとは
  // 交わらない。
  function chainRecordOf(slot) {
    if (!slot || !slot.megidoId || !buildCtx || !counterData || !counterData.chainData) return null;
    const cd = counterData.chainData;
    const rec = { start: [], relay: [], grant: [], selfChain: [], scaler: false };
    let any = false;
    const base = cd.megido[slot.megidoId] || null;
    if (base) {
      any = true;
      for (const k of ['start', 'relay', 'grant', 'selfChain']) {
        for (const w of base[k] || []) rec[k].push(w);
      }
      if (base.scaler) rec.scaler = true;
    }
    const orbRec = slot.orbId && cd.orbs ? cd.orbs[slot.orbId] : null;
    if (orbRec) {
      any = true;
      for (const k of ['start', 'relay', 'grant', 'selfChain']) {
        for (const w of orbRec[k] || []) rec[k].push({ ...w, via: 'orb' });
      }
      if (orbRec.scaler) rec.scaler = true;
    }
    const leaderSlot = buildCtx.slots[2];
    const leaderId = leaderSlot && leaderSlot.megidoId;
    const meRec = leaderId && cd.me ? cd.me[leaderId] : null;
    if (meRec) {
      const slotIndex = buildCtx.slots.indexOf(slot);
      const b = byId.get(slot.megidoId);
      if (slotIndex >= 0 && b) {
        const member = { style: b.style, className: b.class, gender: b.gender };
        for (const w of meRec.ways || []) {
          if (w.slot !== ME_SLOT_KEYS[slotIndex]) continue;
          if (meConditionVerdict(w.condition, member) !== 'match') continue;
          rec.start.push({ medium: w.medium, conditions: w.conditions || [], via: 'me' });
          any = true;
        }
      }
    }
    return any ? rec : null;
  }

  // 編成に回数チェイン付与の持ち主がいるか（チェインの例外処理
  // の判定。chain.js の partyHasChainGrant に材料を渡す）。
  function chainPartyGrant() {
    if (!buildCtx || !counterData || !counterData.chainData) return false;
    const members = buildCtx.slots.filter((s) => s.megidoId).map((s) => ({
      rec: chainRecordOf(s),
      specialReishou: chainSpecialReishouOf(s.megidoId),
    }));
    return partyHasChainGrant(members);
  }

  // チェインのテスト道具のビューモデル（2026-11-19、ユーザー
  // 承認済みの方式）。タイムテーブルは編成の味方とターゲット
  // のマスの敵全員を実効素早さ順に並べ、起点が決まれば
  // simulateChain がチェインテーブルを組み立てる。
  // 表示の条件（2026-11-19 追加）: 使うステージを選んだら、
  // チェイン持ちの有無にかかわらずタイムテーブルを出す。
  // 起点になれる味方が1人もいない編成では操作は成立しない
  // ため、区画は「見るだけ」の表（viewOnly）になる（押せない
  // ものを押せる見た目にしない）。
  function chainSectionVm(derived) {
    if (!buildCtx || !counterData || !counterData.chainData) return null;
    const filled = buildCtx.slots.filter((s) => s.megidoId);
    const recById = new Map(filled.map((s) => [s.megidoId, chainRecordOf(s)]));
    const chainOf = (id) => recById.get(id) || null;
    const enemies = targetSquareEnemies();
    const grant = chainPartyGrant();
    const test = buildCtx.chainTest || (buildCtx.chainTest = newChainTest());
    const anyEligible = filled.some((s) => chainOriginEligibility(chainOf(s.megidoId), {
      partyHasGrant: grant,
      specialReishou: chainSpecialReishouOf(s.megidoId),
      ignoredProb: test.ignoredProb || [],
    }).ok);
    const anyRole = filled.some((s) => hasChainRole(chainOf(s.megidoId)));
    if (!anyRole && enemies.length === 0) return null;
    const interactive = anyEligible;
    if (test.originId && !filled.some((s) => s.megidoId === test.originId)) {
      test.originId = null;
      test.skipped = [];
      test.overrides = {};
      test.error = null;
    }
    const effCache = new Map();
    const effOf = (id) => {
      if (!effCache.has(id)) {
        const idx = buildCtx.slots.findIndex((s) => s.megidoId === id);
        const r = idx >= 0
          ? effSpdInFormation(id, idx, buildCtx.slots, derived.conditionOf(id)) : null;
        effCache.set(id, r ? r.value : null);
      }
      return effCache.get(id);
    };
    const nameOf = (id) => {
      const b = byId.get(id);
      return b ? b.name : id;
    };
    const allies = filled.map((s) => ({
      id: s.megidoId, name: nameOf(s.megidoId), spd: effOf(s.megidoId), atk: effAtkOf(s.megidoId),
    }));
    const timeline = buildTimeline({ allies, enemies });

    let sim = null;
    if (interactive && test.originId) {
      sim = simulateChain({
        originId: test.originId,
        allies,
        skipped: test.skipped || [],
        chainOf,
        specialReishouOf: chainSpecialReishouOf,
        photonGuaranteeOf: (id, photonType) => photonGuaranteeInFormation(id, photonType),
        partyGrant: grant,
        overrides: test.overrides || {},
        ignoredProb: test.ignoredProb || [],
      });
    }
    test.lastActions = sim ? sim.actions : [];

    const inChainCount = new Map();
    if (sim) {
      for (const a of sim.actions) inChainCount.set(a.id, (inChainCount.get(a.id) || 0) + 1);
    }
    const spdTextOf = (v) => (typeof v === 'number' ? `素早さ${v}` : '');
    const timelineRows = timeline.map((r) => {
      if (r.kind === 'enemy') {
        // マスのルールを適用した敵は内訳つきで出す（例: 素早さ528
        // （352×1.5））。基礎値から変わった値には、敵シートと同じく
        // 矢印＋方向色を付ける（2026-11-26、変化表記の統一 #5）。
        const es = enemySpdTextOf(r.spd, r.baseSpd, r.mult);
        return { ...r, spdText: es.text, spdDir: es.dir, supplyText: '' };
      }
      const isOrigin = interactive && test.originId === r.id;
      return {
        ...r,
        spdText: spdTextOf(r.spd),
        supplyText: memberSupplyText(r.id),
        isOrigin,
        hidden: !isOrigin && (inChainCount.get(r.id) || 0) > 0,
      };
    });
    const actionRows = sim ? sim.actions.map((a) => ({
      id: a.id,
      name: nameOf(a.id),
      occ: a.occ,
      fixed: a.fixed,
      // 回数チェイン付与で引っ張られた手は色を変える（2026-11-21
      // ユーザー決定。通常のチェインと見分けが付かず混乱の元に
      // なるため）。
      grantLink: isGrantLinkKind(a.linkKind),
      // その行動が消費するフォトン（渡す形から特定できたもの。
      // 特定できない行動はアタックとして出す）。
      photon: a.photon || 'アタック',
      // 確率の形で渡している行動には「？」の印（タップで無視）。
      prob: typeof a.prob === 'number' ? a.prob : null,
      spdText: spdTextOf(effOf(a.id)),
      supplyText: memberSupplyText(a.id),
    })) : [];
    // 無視している確率の形の一覧（戻せるように出す）。編成から
    // 外れたメンバーの分は掃除する。
    const ignoredProbLines = [];
    if (Array.isArray(test.ignoredProb)) {
      const kept = [];
      for (const key of test.ignoredProb) {
        let found = null;
        for (const s of filled) {
          const rec = chainOf(s.megidoId);
          if (!rec) continue;
          for (const list of [rec.start, rec.relay, rec.grant, rec.selfChain]) {
            const w = (list || []).find((x) => chainWayKey(x) === key);
            if (w) { found = { memberId: s.megidoId, way: w }; break; }
          }
          if (found) break;
        }
        if (!found) continue;
        kept.push(key);
        const pct = (found.way.conditions || []).find((c) => c.type === 'prob');
        // 媒体名そのものが出所を含む形（マスエフェクト／オーブ）
        // では付け足さない。本体の形だけ媒体名で出す。
        ignoredProbLines.push({
          key,
          text: `${nameOf(found.memberId)}の${found.way.medium}（${pct ? pct.pct : ''}%の確率）`,
        });
      }
      if (kept.length !== test.ignoredProb.length) test.ignoredProb = kept;
    }
    const actionNotes = [];
    if (sim) {
      sim.actions.forEach((a, i) => {
        if (i === 0 || !a.notes || !a.notes.length) return;
        actionNotes.push({
          from: nameOf(sim.actions[i - 1].id), to: nameOf(a.id), notes: a.notes,
          grantLink: isGrantLinkKind(a.linkKind),
        });
      });
    }
    const resultLines = [];
    if (sim) {
      const names = sim.actions
        .map((a) => nameOf(a.id) + (a.occ >= 2 ? `（${a.occ}回目）` : '')).join(' → ');
      const cut = chainCutInTarget(timeline, test.originId);
      if (cut.before && typeof cut.before.spd === 'number') {
        resultLines.push(`割り込み成立: ${names} の順に、敵の${cut.before.name}（素早さ${cut.before.spd}）より先に ${sim.actions.length} 回の行動が入ります。`);
      } else if (cut.after && typeof cut.after.spd === 'number' && !cut.before) {
        const origin = allies.find((a) => a.id === test.originId);
        resultLines.push(`起点の${nameOf(test.originId)}（素早さ${origin ? origin.spd : ''}）は敵の${cut.after.name}（素早さ${cut.after.spd}）より遅いため、この割り込みは${cut.after.name}の行動の後に入ります。敵より先に動かしたい場合は、その敵より速い味方を起点にしてください。`);
      } else {
        resultLines.push(`割り込み: ${names} の順に ${sim.actions.length} 回の行動が入ります。`);
      }
      // 分母は実際の予算（フォトン追加で増える。固定値ではない）。
      resultLines.push(`フォトンは ${sim.actions.length}／${sim.photonBudget} 個使用。`
        + (sim.stopReason === 'photon' ? 'フォトンを使い切ったため、チェインはここまでです。' : ''));
      if (sim.stopReason === 'no-pass' && sim.stopId) {
        resultLines.push(`${nameOf(sim.stopId)}はチェインを渡す形を持たないため、チェインはここまでです。`);
      }
      if (sim.stopReason === 'reishou' && sim.stopId) {
        resultLines.push(`${nameOf(sim.stopId)}は専用霊宝が付いていないため、チェインはここまでです。`);
      }
      if (sim.stopReason === 'no-candidate') {
        resultLines.push('次の候補がいないため、チェインはここまでです。');
      }
      if (sim.stopReason === 'stopped' && sim.stopId) {
        resultLines.push(`${nameOf(sim.stopId)}の行動はチェインしない形に変えられているため、チェインはここまでです。`);
      }
      const fixedIdx = sim.actions.findIndex((a) => a.fixed);
      if (fixedIdx > 0) {
        const a = sim.actions[fixedIdx];
        const label = a.restrict === 'minSpd' ? '最も素早さが低い味方' : '最も攻撃力が高い味方';
        resultLines.push(`※ ${nameOf(a.id)}は${nameOf(sim.actions[fixedIdx - 1].id)}の条件（${label}）で固定で入っています。素早さ順の候補ではありません。`);
      }
    }
    const notes = [];
    if (grant) {
      notes.push('この編成には回数チェイン付与の持ち主がいるため、チェインを持たない味方も起点・中継になれます。');
    }
    return {
      viewOnly: !interactive,
      timeline: timelineRows,
      actions: actionRows,
      actionNotes,
      // 経路に回数チェイン付与由来の手があるか（色の凡例を出す判定）。
      hasGrantLink: sim ? sim.actions.some((a) => isGrantLinkKind(a.linkKind)) : false,
      ignoredProbLines,
      resultLines,
      notes,
      errorText: interactive ? (test.error || null) : null,
      // 件数の分母は実際の予算（フォトン追加で増える）。使い切りの
      // 注記は、実際にフォトン切れで終わった場合だけ出す（監査外の
      // 実測: 予算切れ以外でも「使い切りました」と出ていた）。
      photonText: sim ? `フォトン ${sim.actions.length}/${sim.photonBudget}` : '',
      photonFull: sim ? sim.stopReason === 'photon' : false,
      hasOrigin: Boolean(sim),
    };
  }


  // ---- Hボムプランナー（2026-11-19 実装フライト） ----
  // 置き場所は編成エディタと戦闘マスのシート（SW95）。表示条件は「編成にHボム技を持つ
  // メギドが1人以上いること」（装備オーブで持つ場合も含む）。
  // 敵は選択中ステージの敵の取り巻き編成全員（マスのルールで
  // ステータスを補正した値）。初期状態は空で、「おまかせ」で
  // ツールが出した最適解が入る。計算は js/hbomb.js が正本。
  function hbombMembers(slots) {
    if (!slots) return [];
    return slots.map((slot, index) => {
      if (!slot.megidoId) return null;
      const b = byId.get(slot.megidoId);
      const d = formationsData && formationsData.megidoDetails
        ? formationsData.megidoDetails[slot.megidoId] : null;
      const rec = counterData && counterData.hbombData
        ? counterData.hbombData.megido[slot.megidoId] : null;
      return {
        id: slot.megidoId,
        name: b ? b.name : slot.megidoId,
        style: b ? b.style : null,
        slotIndex: index,
        orbId: slot.orbId || null,
        specialReishou: resolveSpecialReishou(d, Boolean(b && b.specialReishou)),
        // 装備霊宝（正はメギド側）: ハイドロボムのダメージ上昇の
        // 霊宝が付いていると、その分が本人のボムに乗る。
        reishouIds: equipmentOf(slot.megidoId),
        gaugeMax: rec && typeof rec.gauge === 'number' ? rec.gauge : 0,
      };
    }).filter(Boolean);
  }

  // 選択中ステージの敵の取り巻き編成（HP・防御にマスのルールを
  // 適用した値）。party 配列の位置（スロット）とクラスも渡す:
  // スロットは速の届き方（左右に最も近い敵）と表示の並びに、
  // クラスは前列／後列（横一列の届き方）に使う。空きマス（null）
  // は敵として出さないが、スロット番号は元の位置のまま残す。
  // 材料が無ければ種の代表値で1体だけ出す。
  function hbombTargetPartyIn(squares, enemyName) {
    for (const { fe, def } of squares) {
      const fact = fe && fe.enemies ? fe.enemies[enemyName] : null;
      if (!fact) continue;
      const mult = squareStatMultipliers(def ? def.rules : null);
      // 種族自身の行は種の特性文（シフトの詳細まで書かれた全文）を
      // 使う（パーティ行の短い形ではシフト部が落ちるため）。
      const speciesTrait = fact.traitNote && typeof fact.traitNote === 'object'
        ? fact.traitNote.value : fact.traitNote;
      const rowOf = (name, hp, de, traitText) => ({
        name,
        hp: typeof hp === 'number' ? applyMult(hp, mult.hp) : null,
        def: typeof de === 'number' ? applyMult(de, mult.def) : null,
        revive: enemyReviveOf(traitText),
      });
      const present = [];
      (fact.party || []).forEach((m, idx) => {
        if (m) present.push({
          ...rowOf(m.name, m.hp, m.def, m.name === fact.name && speciesTrait ? speciesTrait : m.trait),
          slot: idx, cls: m.class || null,
        });
      });
      if (present.length) return present;
      if (fact.stats) return [{ ...rowOf(enemyName, fact.stats.hp, fact.stats.def, speciesTrait), slot: 0, cls: null }];
      return [{ ...rowOf(enemyName, null, null, speciesTrait), slot: 0, cls: null }];
    }
    return [];
  }

  function hbombContext() {
    if (!buildCtx) return null;
    return hbombContextFor(buildCtx.slots, targetSquares(), buildCtx.targetEnemy);
  }

  function hbombContextFor(slots, squares, enemyName) {
    if (!counterData || !counterData.hbombData) return null;
    const data = counterData.hbombData;
    const members = hbombMembers(slots);
    if (!formationHasBombActions(data, members)) return null;
    const enemies = hbombTargetPartyIn(squares, enemyName);
    if (!enemies.length) return null;
    return { data, members, enemies };
  }

  // リヴァイアサンがリーダーの時、対象枠のバーストメンバーが
  // Hボム付与で覚醒+1になる（ME原文から生成した索引で判定）。
  function hbombMeGaugeMembers(members) {
    const data = counterData ? counterData.hbombData : null;
    const leader = members.find((m) => m.slotIndex === 2);
    if (!data || !leader || !data.me) return new Set();
    const set = new Set();
    for (const e of data.me.gaugeOnBomb || []) {
      if (e.leaderId !== leader.id) continue;
      const slotIdx = ME_SLOT_KEYS.indexOf(e.slot);
      const m = members.find((mm) => mm.slotIndex === slotIdx);
      if (!m) continue;
      const styleCond = String(e.condition || '').split('+').map((s) => s.trim())
        .find((s) => ['ラッシュ', 'カウンター', 'バースト'].includes(s));
      if (styleCond && m.style !== styleCond) continue;
      set.add(m.id);
    }
    return set;
  }

  function hbombSecretGauges(members) {
    const data = counterData ? counterData.hbombData : null;
    const map = new Map();
    if (!data) return map;
    for (const m of members) {
      const rec = data.megido[m.id];
      if (rec && rec.actions.some((a) => a.secret) && typeof rec.gauge === 'number') {
        map.set(m.id, rec.gauge);
      }
    }
    return map;
  }

  function hbombActionParts(ctx, field, turnHint) {
    // Lv段階のある行動は、現在のLvで解決した形を表示する
    // （Lvの表示も付ける）。field が無い場合は索引のまま。
    const a = field ? effectiveAction(field, ctx, turnHint || 0) : ctx.action;
    if (a.buttonText) {
      // 特性の手（シャミハザR）は、指定のボタン文面そのまま。
      return { label: ctx.member.name, sub: a.buttonText };
    }
    const parts = [];
    if (typeof a.level === 'number') parts.push(`Lv${a.level}`);
    if (a.place) {
      const ps = Array.isArray(a.place) ? a.place : [a.place];
      for (const pl of ps) parts.push(`${bombKindLabel(pl.kind)}${pl.mult}倍`);
    }
    if (a.ren) {
      // 状態分岐（ウァプラR奥義の専用霊宝版）は、重の付与と錬成が
      // 同時ではなく対象の状態で切り替わることを文面どおりに出す。
      parts.push(a.branchOnHeavy ? '重があれば錬成'
        : a.secret ? `錬${a.ren.base}倍` : '錬成');
    }
    if (a.enhance) parts.push(`ボム強化+${Math.round(a.enhance.pct * 100)}%`);
    if (a.debuff) {
      if (a.debuff.defDown) {
        parts.push(`防御力低下${Math.round(a.debuff.defDown.pct * 100)}%・${a.debuff.defDown.turns}ターン`);
      }
      if (a.debuff.weak) parts.push(`虚弱${a.debuff.weak.turns}ターン`);
      for (const t of a.debuff.types || []) {
        parts.push(t.turns >= 99
          ? `${t.type}・永続`
          : `${t.type}${t.pct ? `${Math.round(t.pct * 100)}%・` : ''}${t.turns}ターン`);
      }
    }
    if (a.steal) parts.push('覚醒ゲージを奪う');
    if (a.setsAwakened) parts.push('覚醒状態にする');
    if (a.grantsPhoton) parts.push(`フォトン+${a.grantsPhoton}`);
    // 形の条件（ヴィネRの全体形など）と重複付与の注記は原文どおり。
    if (a.formCondition) parts.push(a.formCondition);
    if (a.stacks) parts.push('重複して付与される');
    return {
      label: ctx.member.name,
      sub: `${a.medium}「${a.name}」${parts.length ? ` ${parts.join('・')}` : ''}`,
    };
  }

  // 起爆の瞬間に有効な弱体の表示（防御力低下の合計と虚弱）。
  // どちらも無いのに付着がある場合（種類だけの付着）は、付着
  // 一覧（ポップアップ）への入口として種類数のチップを出す
  // （入口が無いと確認も取り除きもできないため）。
  function hbombDebuffChips(pv, attachments) {
    const out = [];
    if (pv.defDownPct > 0) out.push(`防御力低下${Math.round(pv.defDownPct * 100)}%`);
    if (pv.weakActive) {
      out.push(pv.weakTypes > 0 ? `虚弱（弱体・状態異常${pv.weakTypes}種）` : '虚弱');
    }
    if (!out.length && attachments && attachments.length) {
      const act = attachments.filter((a) => a.active);
      const pool = act.length ? act : attachments;
      out.push(`弱体・状態異常${new Set(pool.map((a) => a.label)).size}種`);
    }
    return out;
  }

  function hbombSectionVm() {
    return hbombSectionVmFor(editorHbombEnv);
  }

  function hbombSectionVmFor(env) {
    const ctx = env.context();
    if (!ctx) return null;
    const { data, members, enemies } = ctx;
    const holder = env.state();
    if (!holder) return null;
    const sig = JSON.stringify([
      ...env.sigParts(),
      members.map((m) => [m.id, m.orbId, m.specialReishou]),
      enemies.map((e) => [e.name, e.hp, e.def, e.slot, e.cls,
        e.revive ? [e.revive.times, e.revive.hpPct] : null]),
    ]);
    if (!holder.hbomb || holder.hbomb.sig !== sig) {
      holder.hbomb = {
        sig, mode: 'ren', target: 0, field: null, hands: [], detonateTurn: 3,
      };
    }
    const st = holder.hbomb;
    if (st.target >= enemies.length) st.target = 0;
    if (!st.field) st.field = emptyField(enemies);
    // 種類だけの弱体行動は、編成に虚弱の手がある時だけ候補に出す
    // （虚弱の数えにしか効かないため。エンジンの探索と同じ方針）。
    const hasWeakAction = formationHasWeakAction(data, members);
    const layout = formationLayout(enemies);
    const fmt = (n) => n.toLocaleString('ja-JP');
    const notes = [];
    // シャミハザRのME（確率のアタック追加）は注記のみ。
    const leader = members.find((m) => m.slotIndex === 2);
    if (leader && data.me && (data.me.probNote || []).some((e) => e.leaderId === leader.id)) {
      notes.push('マスエフェクト: 敵ハイドロボム数に応じた確率で行動開始時アタック追加（最大20%）');
    }
    // 霊宝のダメージ上昇は装備者本人のボムにだけ乗る（注記で出す）。
    for (const m of members) {
      const ctxs = memberActions(data, m);
      const bb = ctxs.length ? (ctxs[0].bombBoost || 0) : 0;
      if (bb > 0) notes.push(`霊宝: ${m.name}のハイドロボムのダメージ+${Math.round(bb * 100)}%`);
    }
    // 蘇生する敵: 倒すには蘇生分まで必要で、判定はその分を含めて
    // 行っていることを出す。シフト後に数値化できない軽減がある
    // 敵は、その軽減を判定に反映していないことも明示する。
    for (const e of enemies) {
      if (!e.revive) continue;
      notes.push(`${e.name}: 戦闘不能時にHP${e.revive.hpPct}%で蘇生（${e.revive.times}回）。倒せるかの判定は蘇生分も含む`);
      if (e.revive.shift && e.revive.shift.unknownDamage) {
        notes.push(`${e.name}: シフト後の軽減は起爆の判定に反映していない`);
      }
    }

    // 付着の一覧（ポップアップ用）: 敵に付いている弱体・状態異常を
    // 発生源つきで並べる。ref は取り除きの指定子（錬モードは場の
    // 付着の位置、ターン数モードは発生源の手の番号）。ターン数
    // モードでは起爆ターンに有効かどうかも持つ。
    const hbombAttachmentsOf = (e) => (
      (e.debuffs || []).map((d, di) => {
        const turnsText = d.turns >= 99 ? '永続' : `${d.turns}ターン`;
        if (st.mode === 'turn') {
          const active = d.appliedTurn <= st.detonateTurn
            && st.detonateTurn < d.appliedTurn + d.turns;
          return {
            ref: typeof d.hand === 'number' ? d.hand : -1,
            label: d.type === '防御力低下'
              ? `防御力低下${Math.round((d.pct || 0) * 100)}%` : d.type,
            source: [d.byName, d.medium && d.actionName ? `${d.medium}「${d.actionName}」` : '']
              .filter(Boolean).join(' '),
            meta: `${d.appliedTurn}ターン目に付与・${turnsText}`
              + (typeof d.hand === 'number' ? `・${d.hand + 1}手目` : '')
              + (active ? '' : '・起爆時は切れています'),
            active,
          };
        }
        return {
          ref: di,
          label: d.type === '防御力低下'
            ? `防御力低下${Math.round((d.pct || 0) * 100)}%` : d.type,
          source: [d.byName, d.medium && d.actionName ? `${d.medium}「${d.actionName}」` : '']
            .filter(Boolean).join(' '),
          meta: turnsText,
          active: true,
        };
      })
    );

    // 敵ごとの結果行（錬モードとターン数モードで同じ形。ボムの
    // 材料だけが違う: 錬は現在の場、ターン数は再生した場）。
    const hbombEnemyVms = (preview, bombEnemies) => enemies.map((e, i) => {
      const pv = preview.perEnemy[i];
      // 蘇生する敵は、蘇生分まで含めたHPで表示し、判定もその分で
      // 行う（preview 側で実効HPに直してある）。
      const effHp = typeof pv.effHp === 'number' ? pv.effHp : e.hp;
      return {
        index: i,
        name: e.name,
        hpText: typeof e.hp === 'number'
          ? (e.revive ? `HP ${fmt(effHp)}（蘇生込み）` : `HP ${fmt(e.hp)}`) : 'HP —',
        barPct: typeof effHp === 'number' && effHp > 0
          ? Math.max(0, (effHp - Math.min(pv.total, effHp)) / effHp * 100) : 100,
        resultText: pv.total > 0
          ? (pv.kills
            ? (pv.uncertain ? '倒せる（シフト後の軽減は未反映）' : '倒せる')
            : `あと ${fmt(pv.shortfall || 0)}`) : '',
        kills: pv.kills,
        attachments: hbombAttachmentsOf(bombEnemies[i]),
        debuffs: hbombDebuffChips(pv, hbombAttachmentsOf(bombEnemies[i])),
        bombs: bombEnemies[i].bombs.map((b) => ({
          kind: b.kind,
          boosted: (b.boost || 0) > 0,
          label: `${bombKindLabel(b.kind)}${Math.round(b.mult * 10) / 10}${b.kind === 'ren' ? `・素材${Math.min(b.count || 0, 30)}` : ''}${(b.boost || 0) > 0 ? '↑' : ''}`,
        })),
      };
    });

    if (st.mode === 'ren') {
      const field = st.field;
      const preview = previewDetonation(field);
      const enemyVms = hbombEnemyVms(preview, field.enemies);
      const actions = [];
      for (const m of members) {
        for (const actx of memberActions(data, m)) {
          if (!actionHasEffectAtAnyLevel(actx.action)) continue;
          if (!hasWeakAction && isTypesOnlyOverall(actx.action)) continue;
          const chk = checkAction(field, actx, st.target, { secretUsed: field.secretUsed });
          actions.push({
            memberId: m.id, actionKey: actx.action.key,
            ...hbombActionParts(actx, field, 0), ok: chk.ok, reason: chk.reason,
          });
        }
      }
      // 秘奥義が場に出ていたら、使えるターンを注記する。
      const secretBomb = field.enemies.flatMap((e) => e.bombs).find((b) => b.medium === '秘奥義');
      if (secretBomb) {
        const holder = members.find((m) => m.name === secretBomb.byName);
        const g = holder ? hbombSecretGauges(members).get(holder.id) : null;
        if (typeof g === 'number') notes.push(`秘奥義は${g}ターン目から使えます`);
      }
      return {
        mode: 'ren',
        rows: layout.rows,
        enemies: enemyVms,
        selectedTarget: st.target,
        factorText: preview.simulCount >= 2
          ? `同時爆破補正 ×${Math.round(preview.factor * 10) / 10}（ボム${preview.simulCount}個）` : null,
        actions,
        detonateTurn: st.detonateTurn,
        steps: [],
        clockText: null,
        clockOk: true,
        notes,
      };
    }

    // ターン数モード: 状態は手の並びから再生計算する。
    const rctx = buildReplayCtx(data, members, enemies, {
      meGaugeMembers: hbombMeGaugeMembers(members),
      secretGaugeOf: hbombSecretGauges(members),
    });
    const replay = replayHands(rctx, st.hands, st.detonateTurn);
    const preview = replay.preview;
    const enemyVms = hbombEnemyVms(preview, replay.field.enemies);
    const steps = replay.steps.map((s, i) => ({
      index: i,
      turn: s.turn,
      label: `${s.memberName} ${s.medium}「${s.actionName}」${s.targetName ? ` → ${s.targetName}` : ''}`,
      note: s.note,
      ok: s.ok,
      reason: s.reason,
    }));
    const actions = [];
    for (const m of members) {
      for (const actx of memberActions(data, m)) {
        if (!hasWeakAction && isTypesOnlyOverall(actx.action)) continue;
        const probe = probeHand(rctx, replay, {
          memberId: m.id, actionKey: actx.action.key, target: st.target,
        });
        actions.push({
          memberId: m.id, actionKey: actx.action.key,
          ...hbombActionParts(actx, replay.field, Math.max(1, replay.turnsUsed)),
          ok: probe.ok, reason: probe.reason,
        });
      }
    }
    return {
      mode: 'turn',
      rows: layout.rows,
      enemies: enemyVms,
      selectedTarget: st.target,
      factorText: preview.simulCount >= 2
        ? `同時爆破補正 ×${Math.round(preview.factor * 10) / 10}（ボム${preview.simulCount}個）` : null,
      actions,
      detonateTurn: st.detonateTurn,
      steps,
      clockText: st.hands.length
        ? (replay.clockError || `${replay.clockTurn}ターン目に爆発します`) : null,
      clockOk: !replay.clockError && replay.steps.every((s) => s.ok),
      notes,
    };
  }

  // 付着一覧のポップアップ: 敵の弱体・虚弱チップのタップで開く
  // シート。項目のタップで付着を取り除き（錬モードは場の付着を
  // 1件、ターン数モードは発生源の手を1つ）、一覧を開き直す。
  // 残りが無くなれば閉じてエディタへ戻る。取り除きは場・並びの
  // 状態そのものを変えるため、プレビュー・弱体済みの判定・
  // おまかせの前提も全て新しい状態で計算される。
  // チェインの手組み: 行動のフォトンをタップした時に開く、
  // その手で使う行動の選択ポップアップ。選ぶと overrides に
  // 記録して組み直す（その手より後ろの指定は組み直しで意味が
  // 変わるため落とす）。
  function openChainPhotonPopup(index) {
    if (!buildCtx || !buildCtx.chainTest) return;
    const test = buildCtx.chainTest;
    const action = (test.lastActions || [])[index];
    if (!action) return;
    const slot = buildCtx.slots.find((s) => s.megidoId === action.id);
    const rec = slot ? chainRecordOf(slot) : null;
    const options = chainActionOptions(rec, {
      isOrigin: index === 0,
      specialReishou: chainSpecialReishouOf(action.id),
      ignoredProb: test.ignoredProb || [],
      photonOf: (t) => photonGuaranteeInFormation(action.id, t),
      // その手のチェイン数（起点の手が0）。範囲で形が変わる
      // 能力（プルフラスBの奥義）は、その手で使える形だけを出す。
      chainCount: index,
    });
    const key = `${action.id}#${action.occ}`;
    const ov = (test.overrides || {})[key];
    let currentKey = null;
    if (ov && ov.stopPhoton) currentKey = `stop:${ov.stopPhoton}`;
    else if (ov && ov.wayKey) currentKey = ov.wayKey;
    else if (action.way) currentKey = chainWayKey(action.way);
    const b = byId.get(action.id);
    const closePopup = () => { overlay.close(); renderBuilder(); };
    const content = buildChainPhotonPopup({
      title: `${b ? b.name : action.id}${action.occ >= 2 ? `（${action.occ}回目）` : ''}の行動`,
      note: '使う行動を選ぶと、その結果でチェインが止まるかどうかを含めて組み直します。',
      options: options.map((o) => (o.type === 'way'
        ? {
          key: o.key, photon: o.photon || 'アタック',
          label: `${o.medium}${o.via === 'me' ? '（マスエフェクト）' : o.via === 'orb' ? '（オーブ）' : ''}でチェイン${o.kind === 'self' ? '（自身へ）' : ''}`,
          notes: o.notes || [], prob: o.prob, current: o.key === currentKey,
        }
        : {
          key: o.key, photon: o.photon,
          label: `${o.photon}フォトン（チェインしない）`,
          notes: [], prob: null, current: o.key === currentKey,
        })),
    }, {
      onChoose: (optKey) => {
        const chosen = options.find((o) => o.key === optKey);
        if (!chosen) { closePopup(); return; }
        test.overrides = test.overrides || {};
        if (chosen.type === 'way') test.overrides[key] = { wayKey: chosen.key };
        else test.overrides[key] = { stopPhoton: chosen.photon };
        // この手より後ろの指定は、組み直しで対象が変わるため落とす。
        (test.lastActions || []).slice(index + 1).forEach((a) => {
          delete test.overrides[`${a.id}#${a.occ}`];
        });
        test.error = null;
        closePopup();
      },
      onCancel: closePopup,
    });
    overlay.openSheet(content, { onCloseRequest: closePopup });
  }

  function openHbombDebuffPopup(env, enemyIdx) {
    const holder = env.state();
    if (!holder || !holder.hbomb) return;
    const st = holder.hbomb;
    const vm = hbombSectionVmFor(env);
    const e = vm && vm.enemies[enemyIdx];
    if (!e) return;
    const content = buildHbombDebuffPopup({
      enemyName: e.name,
      note: st.mode === 'turn'
        ? 'タップすると、その弱体・状態異常を付けた手を取り除きます（その手で付けたボムも一緒に外れます）。'
        : 'タップすると、その弱体・状態異常を取り除きます。',
      items: (e.attachments || []).map((a) => ({
        ref: a.ref, label: a.label, source: a.source, meta: a.meta,
      })),
    }, {
      onRemove: (ref) => {
        if (st.mode === 'turn') {
          if (typeof ref === 'number' && ref >= 0) {
            st.hands = st.hands.filter((_, i) => i !== ref);
          }
        } else if (st.field) {
          st.field = removeDebuff(st.field, enemyIdx, ref);
        }
        const next = hbombSectionVmFor(env);
        const left = next && next.enemies[enemyIdx]
          ? (next.enemies[enemyIdx].attachments || []).length : 0;
        if (left > 0) openHbombDebuffPopup(env, enemyIdx);
        else { overlay.close(); env.rerender(); }
      },
    });
    overlay.openSheet(content, {
      onCloseRequest: () => { overlay.close(); env.rerender(); },
    });
  }

  // ---- 狂炎シミュレーター（2026-11-19 実装フライト） ----
  // 置き場所は編成エディタ（Hボムプランナーの隣）と戦闘マスの
  // シート（SW95）。表示条件は
  // 「使うステージを選んでいる」「編成に狂炎化の手段と炎上の手段が
  // ある」こと。準備フェーズで炎上と狂炎化を選ぶと、狂炎を付けた
  // 時点の状態を再現し、以降は編成の火行動のチップで回数を積んで
  // ターン終了で精算する。計算は js/kyoen.js が正本。
  const KYOEN_RANGE_LABEL = { single: '単体', row: '列', all: '全体' };
  const KYOEN_BAND_COLORS = ['#f6ad55', '#e53e3e', '#b794f4', '#4299e1'];

  function kyoenMembers(slots) {
    if (!slots) return [];
    return slots.map((slot, index) => {
      if (!slot.megidoId) return null;
      const b = byId.get(slot.megidoId);
      const d = formationsData && formationsData.megidoDetails
        ? formationsData.megidoDetails[slot.megidoId] : null;
      return {
        id: slot.megidoId,
        name: b ? b.name : slot.megidoId,
        style: b ? b.style : null,
        className: b ? b.class : null,
        gender: b ? b.gender : null,
        atk: (() => {
          const s = b ? resolveMegidoStats(b, savedLevelOf(
            formationsData ? formationsData.megidoDetails : null, slot.megidoId)) : null;
          return s ? s.atk : 0;
        })(),
        slotIndex: index,
        orbId: slot.orbId || null,
        specialReishou: resolveSpecialReishou(d, Boolean(b && b.specialReishou)),
      };
    }).filter(Boolean);
  }

  // そのメンバーの狂炎まわりの選択肢（メギドの能力＋装備オーブ）。
  // 専用霊宝版は所持している時だけ、通常版に差し替えて出す
  // （Hボムの memberActions と同じ作法）。
  function kyoenChoicesFor(data, member) {
    const out = { enjou: [], convert: [], fire: [], ground: [], delayed: [], shift: [] };
    const push = (source, action) => {
      const uid = `${member.id}|${source}|${action.type}|${action.key}|${action.needsReishou ? 'r' : 'n'}${action.form ? `|${action.form}` : ''}`;
      out[action.type].push({
        uid, member, action, source,
        fireHits: action.type === 'fire' ? action.hits : (action.dmgHits || 0),
      });
    };
    const rec = data && data.megido ? data.megido[member.id] : null;
    if (rec) {
      for (const type of ['enjou', 'convert', 'fire', 'ground', 'delayed', 'shift']) {
        // 専用霊宝版への差し替えは、武器の形（form）ごとに行う
        // （タムスは分離・連結で同じ key の行動が別々に存在する）。
        const byKey = new Map();
        for (const a of rec[type] || []) {
          const k = `${a.key}|${a.form || ''}`;
          if (a.needsReishou) {
            if (member.specialReishou) byKey.set(k, a);
          } else if (!byKey.has(k)) byKey.set(k, a);
        }
        for (const a of byKey.values()) push('megido', a);
      }
    }
    const orb = member.orbId && data && data.orbs ? data.orbs[member.orbId] : null;
    if (orb) {
      for (const type of ['enjou', 'convert', 'fire', 'ground', 'delayed', 'shift']) {
        for (const a of orb[type] || []) push('orb', a);
      }
    }
    return out;
  }

  let kyoenRaceByName = null; // 種の名前 → 種族の配列（飛行の判定用）
  function kyoenFlyingOf(name, tags, memberRace) {
    if (Array.isArray(memberRace) && memberRace.includes('飛行')) return true;
    if (Array.isArray(tags) && tags.includes('飛行')) return true;
    if (!allFloorsEnemies) return false;
    if (!kyoenRaceByName) {
      kyoenRaceByName = new Map();
      for (const fe of allFloorsEnemies.values()) {
        for (const rec of Object.values((fe && fe.enemies) || {})) {
          if (rec && rec.name && rec.race && Array.isArray(rec.race.values)) {
            kyoenRaceByName.set(rec.name, rec.race.values);
          }
        }
      }
    }
    const races = kyoenRaceByName.get(name);
    return Array.isArray(races) && races.includes('飛行');
  }

  // 特性文の現在の形（シフト表記より前）に「地形効果を無効化」を
  // 持つ敵は、地形の対象にならない（飛行と同じ扱い）。シフト後の
  // 側にだけ無効化がある敵（魔喰機・無限のシフト2など）は、蘇生を
  // 挟んでシフトした時点で対象から外れる（下の enemyReviveOf と
  // 狂炎エンジン側の形の管理）。
  function kyoenTerrainNullOf(traitText) {
    if (typeof traitText !== 'string') return false;
    return traitText.split('【シフト')[0].includes('地形効果を無効化');
  }

  // 特性文から「戦闘不能時に蘇生する」敵の蘇生とシフトを読む。
  // 戻り値: null | { times, hpPct, nullRow, takenUpSingle,
  //   takenUpRange, shift }。shift は null | { terrainNull,
  //   nullRow, reductionMax, unknownDamage } で、シフト後の形の
  //   うち文面から機械的に判定できるものだけを持つ。HP依存の
  //   軽減（「HPが高いほど…最大N%」）は直線で確定したため
  //   reductionMax（最大値の割合）として数値化し（2026-11-21
  //   ユーザー裁定: 軽減率 = 最大値 × 現在HP/最大HP）、それ以外
  //   の数値化できない被ダメージは unknownDamage として持つ。
  // - 蘇生の文が「戦闘不能時、」で始まる文の中にある敵だけを対象
  //   にする（味方を蘇生する敵や、ターン終了時などにシフトする
  //   だけの敵は対象外）。
  // - 回数は「一度だけ」=1回。複数回の敵（成り損ない）は VH の
  //   回数を読む（塔の数値は VH 統一）。
  // - 被ダメージ上昇は倍率に直す（200%上昇 = 3倍）。
  // - シフト部は、蘇生の文以降に現れる最も早いシフト表記から後ろ。
  //   現在の形の判定はそれより前で行う。
  function enemyReviveOf(traitText) {
    if (typeof traitText !== 'string') return null;
    const head = traitText.match(/戦闘不能時[、に][^。]*蘇生[^。]*/);
    if (!head) return null;
    const num = (s) => Number(String(s).replace(/[０-９]/g,
      (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    let hpPct = null;
    const hm = traitText.match(/最大HP(?:の)?([0-9０-９]+)[%％]/)
      || traitText.match(/HP([0-9０-９]+)[%％]で蘇生/);
    if (hm) hpPct = num(hm[1]);
    if (hpPct == null) return null;
    let times = 1;
    const vm = traitText.match(/VH([0-9０-９]+)回/);
    if (vm) times = num(vm[1]);
    let shiftIdx = -1;
    for (const marker of ['【シフト', 'シフト2', 'シフト3', 'シフト後']) {
      const idx = traitText.indexOf(marker, head.index);
      if (idx >= 0 && (shiftIdx < 0 || idx < shiftIdx)) shiftIdx = idx;
    }
    const baseText = shiftIdx >= 0 ? traitText.slice(0, shiftIdx) : traitText;
    const rowNullOf = (t) => (t.includes('敵前列からのダメージを無効化') ? 'front'
      : t.includes('敵後列からのダメージを無効化') ? 'back' : null);
    const upOf = (t, re) => {
      const m = t.match(re);
      return m ? 1 + num(m[1]) / 100 : 1;
    };
    let shift = null;
    if (traitText.includes('シフト')) {
      const st = shiftIdx >= 0 ? traitText.slice(shiftIdx) : '';
      const rm = st.match(/HPが高いほど[^。]*最大([0-9０-９]+)%/);
      const reductionMax = rm ? num(rm[1]) / 100 : 0;
      shift = {
        terrainNull: st.includes('地形効果を無効化'),
        nullRow: rowNullOf(st),
        reductionMax,
        unknownDamage: !reductionMax && st.includes('軽減'),
      };
    }
    return {
      times, hpPct,
      nullRow: rowNullOf(baseText),
      takenUpSingle: upOf(baseText, /受ける単体ダメージが([0-9０-９]+)%上昇/),
      takenUpRange: upOf(baseText, /受ける範囲ダメージが([0-9０-９]+)%上昇/),
      shift,
    };
  }

  // 選択中ステージの敵の取り巻き編成（Hボムと同じ材料・同じ補正に、
  // 飛行と地形無効化の判定を足したもの）。
  // 敵がかばう持ちか（特性・技能の文から読む）。物差しは
  // counter.js の脅威導出と同じ: 「かばう効果を無視する」は
  // かばう側ではなく、すり抜ける攻撃側の性質なので数えない。
  // 狂炎シミュレーターはかばうを再現しないため、持ち主がいる
  // 編成では注記を出す材料にする（2026-11-21 ユーザー裁定、
  // 正本 corpus-elements/狂炎.json）。
  function enemyKabauOf(texts) {
    for (const s of texts) {
      if (!s) continue;
      for (const raw of String(s).split(/[。／\n]/)) {
        if (/受け持|かばう/.test(raw) && !/かばう(の効果|効果)?を無視/.test(raw)) return true;
      }
    }
    return false;
  }

  function kyoenTargetPartyIn(squares, enemyName) {
    for (const { fe, def } of squares) {
      const fact = fe && fe.enemies ? fe.enemies[enemyName] : null;
      if (!fact) continue;
      const mult = squareStatMultipliers(def ? def.rules : null);
      const rowOf = (name, hp, de, tags, memberRace, traitText) => {
        const revive = enemyReviveOf(traitText);
        return {
          name,
          hp: typeof hp === 'number' ? applyMult(hp, mult.hp) : null,
          def: typeof de === 'number' ? applyMult(de, mult.def) : null,
          flying: kyoenFlyingOf(name, tags, memberRace),
          terrainNull: kyoenTerrainNullOf(traitText),
          revive,
          nullRow: revive ? revive.nullRow : null,
          takenUpSingle: revive ? revive.takenUpSingle : 1,
          takenUpRange: revive ? revive.takenUpRange : 1,
        };
      };
      const speciesTrait = fact.traitNote && typeof fact.traitNote === 'object'
        ? fact.traitNote.value : fact.traitNote;
      const present = [];
      (fact.party || []).forEach((m, idx) => {
        // 種族自身の行は種の特性文（シフトの詳細まで書かれた全文）
        // を使う（パーティ行の短い形ではシフト部が落ちるため）。
        if (m) {
          const traitText = m.name === fact.name && speciesTrait ? speciesTrait : m.trait;
          present.push({
            ...rowOf(m.name, m.hp, m.def, m.tags, m.race, traitText),
            slot: idx, cls: m.class || null,
            kabau: enemyKabauOf([traitText, ...Object.values(m.skills || {})]),
          });
        }
      });
      if (present.length) return present;
      if (fact.stats) return [{ ...rowOf(enemyName, fact.stats.hp, fact.stats.def, null, null, speciesTrait), slot: 0, cls: null, kabau: enemyKabauOf([speciesTrait]) }];
      return [{ ...rowOf(enemyName, null, null, null, null, speciesTrait), slot: 0, cls: null, kabau: enemyKabauOf([speciesTrait]) }];
    }
    return [];
  }

  function kyoenContext() {
    if (!buildCtx) return null;
    return kyoenContextFor(buildCtx.slots, targetSquares(), buildCtx.targetEnemy);
  }

  function kyoenContextFor(slots, squares, enemyName) {
    if (!counterData || !counterData.kyoenData) return null;
    const data = counterData.kyoenData;
    const members = kyoenMembers(slots);
    const choices = new Map(); // uid -> choice
    let hasEnjou = false;
    let hasConvert = false;
    for (const m of members) {
      const c = kyoenChoicesFor(data, m);
      if (c.enjou.length) hasEnjou = true;
      if (c.convert.length) hasConvert = true;
      for (const type of ['enjou', 'convert', 'fire', 'ground', 'delayed', 'shift']) {
        for (const ch of c[type]) choices.set(ch.uid, ch);
      }
    }
    if (!hasEnjou || !hasConvert) return null;
    const enemies = kyoenTargetPartyIn(squares, enemyName);
    if (!enemies.length || enemies.some((e) => typeof e.hp !== 'number')) return null;
    return { data, members, choices, enemies };
  }

  // 炎上発生者がリーダーの ME で受ける地形ダメージ補正（「地形による
  // ダメージが◯%上昇する」等）。照合は ME 要約と同じ規則。
  function kyoenMeTerrainCorrection(slots, applier) {
    if (!counterData || !counterData.meData) return 0;
    const leaderSlot = slots ? slots[2] : null;
    if (!leaderSlot || !leaderSlot.megidoId) return 0;
    const rec = counterData.meData.megido[leaderSlot.megidoId];
    const me = rec && rec.massEffect;
    if (!me || !me.slots) return 0;
    const entries = me.slots[ME_SLOT_KEYS[applier.slotIndex]] || [];
    let sum = 0;
    for (const e of entries) {
      if (!e || typeof e.effect !== 'string') continue;
      const m = e.effect.match(/地形(?:による)?ダメージが([0-9]+(?:\.[0-9]+)?)%上昇/);
      if (!m) continue;
      if (meConditionVerdict(e.condition, applier) === 'match') sum += Number(m[1]) / 100;
    }
    return sum;
  }

  function kyoenSectionVm() {
    return kyoenSectionVmFor(editorKyoenEnv);
  }

  function kyoenSectionVmFor(env) {
    const ctx = env.context();
    if (!ctx) return null;
    const { choices, enemies } = ctx;
    const holder = env.state();
    if (!holder) return null;
    const sig = JSON.stringify([
      ...env.sigParts(),
      ctx.members.map((m) => [m.id, m.orbId, m.specialReishou]),
      enemies.map((e) => [e.name, e.hp, e.def, e.slot, e.cls, e.flying, e.terrainNull,
        e.revive ? [e.revive.times, e.revive.hpPct, e.revive.shift ? 1 : 0] : null,
        e.nullRow, e.takenUpSingle, e.takenUpRange]),
    ]);
    if (!holder.kyoen || holder.kyoen.sig !== sig) {
      holder.kyoen = {
        sig, enjouUid: null, convertUid: null, target: 0, sim: null, lastEvent: null,
        setupAlloc: null, // 地形決定で使う炎上の割り振り（{ uid, hits }）
        allocPopup: null, // 割り振りポップアップの開いている状態
      };
    }
    const st = holder.kyoen;
    if (st.target >= enemies.length) st.target = 0;
    const fmt = (n) => n.toLocaleString('ja-JP');
    const choiceLabel = (ch) => `${ch.member.name} ${ch.action.medium}「${ch.action.name}」`;
    // レベル制の行動（使うたびにレベルが上がる）は、現在の
    // レベルの数値で選択肢を出す。開始前は Lv1、開始後は sim の
    // 状態（使用回数で進んだレベル）を読む。
    const levelOfChoice = (ch) => (ch.action.levels && st.sim ? kyoenLevelOf(st.sim, ch.uid) : 1);
    const resolvedChoice = (ch) => (ch.action.levels ? kyoenLeveled(ch.action, levelOfChoice(ch)) : ch.action);
    // 武器の形（タムス）: 選択肢はそのメンバーの現在の形に合う
    // ものだけを出す。開始前は初期の形（分離武器時）。
    const formOfMember = (m) => (st.sim ? kyoenFormOf(st.sim, m.id) : 'separated');
    const formFits = (ch) => !ch.action.form || ch.action.form === formOfMember(ch.member);
    // 形を持つ行動の sub への注記（形・火の倍率・使うと移る形）。
    const formDecorate = (ch, sub, fireMult) => {
      if (!ch.action.form) return sub;
      let s = sub || '';
      const add = (t) => { s = s ? `${s}・${t}` : t; };
      if (typeof fireMult === 'number') add(`倍率${fireMult}`);
      add(ch.action.form === 'linked' ? '連結武器時' : '分離武器時');
      if (ch.action.shiftTo) {
        add(ch.action.shiftTo === 'linked' ? '使うと連結武器にシフト' : '使うと分離武器にシフト');
      }
      return s;
    };

    // 準備が揃ったら、狂炎を付けた時点の状態を再現する。選択肢の
    // ラベル（レベル制の行動の現在 Lv）より先に作る: 地形決定の
    // 使用を数えたレベルでラベルを出すため。
    if (st.enjouUid && st.convertUid && !st.sim) {
      const en = choices.get(st.enjouUid);
      const cv = choices.get(st.convertUid);
      if (en && cv) {
        const engineAction = (ch) => ({
          range: ch.action.range, hits: ch.fireHits, dmgMult: ch.action.dmgMult,
          atk: ch.member.atk, attackerClass: ch.member.className,
          terrainBonus: ch.action.terrainBonus || 1,
        });
        const targetRow = kyoenRowOf(enemies[st.target]);
        const inRange = enemies.map((e, i) => (
          en.action.range === 'all'
          || (en.action.range === 'row' && kyoenRowOf(e) === targetRow)
          || (en.action.range === 'single' && i === st.target)
        ));
        const covered = enemies.map((e, i) => !e.flying && !e.terrainNull && inRange[i]);
        const sim = kyoenCreateSim({
          enemies,
          terrain: {
            mult: en.action.mult,
            duration: en.action.duration,
            range: en.action.range,
            anchor: st.target,
            applierAtk: en.member.atk,
            converterLv: KYOEN_LEVEL,
            correction: KYOEN_CORRECTION + kyoenMeTerrainCorrection(env.slots(), en.member),
          },
          covered,
          inRange,
        });
        // バレット消費形の炎上（ベリアルB）は、地形決定の段階
        // だけバレットありとして、その倍率で直接ダメージを
        // 当てる（以後の敷き直しは通常形で扱う）。
        // 割り振り対象の炎上（カイムB）は、地形決定の時に決めた
        // 敵ごとのヒット数で直接ダメージを当てる（地形そのもの
        // は選んだ対象に付く）。
        const enSetup = engineAction(en);
        if (en.action.bullet) enSetup.dmgMult = en.action.bullet.dmgMult;
        if (en.action.allocMax !== undefined && st.setupAlloc && st.setupAlloc.uid === en.uid) {
          for (const [idxText, hits] of Object.entries(st.setupAlloc.hits)) {
            if (hits > 0) kyoenApplySetup(sim, { ...enSetup, hits }, Number(idxText));
          }
        } else {
          kyoenApplySetup(sim, enSetup, st.target);
        }
        kyoenApplySetup(sim, engineAction(cv), st.target);
        if (cv.action.extend) kyoenExtend(sim, cv.action.extend);
        // レベル制の行動は、準備フェーズで使った分も「使用」と
        // して数える（地形決定で選んだ炎上も、使用するたびに
        // レベルが上がる）。地形そのものは Lv1 の数値で決まる。
        for (const ch of [en, cv]) {
          if (ch.action.levels) {
            kyoenBump(sim, ch.uid, Math.max(...ch.action.levels.map((e) => e.lv)));
          }
        }
        // 武器の形を移す行動（タムスの分離時の奥義）を地形決定
        // で使った場合も、使用として形が移った状態で開始する。
        for (const ch of [en, cv]) {
          if (ch.action.shiftTo) kyoenShift(sim, ch.member.id, ch.action.shiftTo);
        }
        st.sim = sim;
        st.setupSummary = `${en.member.name}の炎上（倍率${en.action.mult}・${KYOEN_RANGE_LABEL[en.action.range]}）を${cv.member.name}が狂炎化`;
      }
    }
    const enjouChoices = [];
    const convertChoices = [];
    const fireChoices = [];
    const groundChoices = [];
    const delayedChoices = [];
    const shiftChoices = [];
    for (const ch of choices.values()) {
      // 武器の形が現在の形と合わない選択肢は出さない（タムス:
      // 連結中は狂炎化の覚醒スキルが無く、分離中は連結時の
      // 行動が無い）。
      if (!formFits(ch)) continue;
      if (ch.action.type === 'shift') {
        // スキルのシフト（バティンBの覚醒スキル）: 使うとスキルが
        // シフト後の形（火ではない）に切り替わる引き金。
        const shifted = Boolean(st.sim && kyoenSkillShifted(st.sim, ch.member.id));
        shiftChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: shifted
            ? 'シフト済み: スキルは火ではなくなった'
            : '使うとスキルがシフトする（シフト後は火ではなくなる）',
          on: shifted,
        });
      } else if (ch.action.type === 'delayed') {
        // 遅延行動（ナベリウスBの覚醒スキル）: 予約ボタンとして
        // 出し、予約中はこのターンの火回数と反復回数を出す。
        // 発動は正本どおり次のターンの行動開始時で、反復回数は
        // 直前ターン（このターン）の火回数で決まる。
        const armed = Boolean(st.sim && st.sim.delayed && st.sim.delayed.uid === ch.uid);
        let sub = '遅延行動: 次のターンの開始時に発動（直前ターンの火回数で反復）';
        if (armed) {
          const cnt = kyoenDelayedCount(st.sim);
          const reps = kyoenDelayedReps(cnt, ch.action.maxReps);
          sub = `このターンの${ch.action.countSource === 'ally' ? '味方' : '自身'}の火${cnt}回 → 次のターン開始時に${reps}回分`;
        }
        delayedChoices.push({ uid: ch.uid, label: choiceLabel(ch), sub, on: armed });
      } else if (ch.action.type === 'enjou') {
        const ra = resolvedChoice(ch);
        let sub = ch.action.levels
          ? `Lv${ra.lv} 倍率${ra.mult}・${ra.duration}ターン・${KYOEN_RANGE_LABEL[ra.range]}（使うたびにLvアップ）`
          : `倍率${ch.action.mult}・${ch.action.duration}ターン・${KYOEN_RANGE_LABEL[ch.action.range]}`;
        if (ra.allocMax !== undefined) sub += '・使う時に火の割り振り';
        if (ch.action.bullet) sub += '・地形決定はバレット消費形';
        enjouChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: formDecorate(ch, sub),
          on: st.enjouUid === ch.uid,
        });
      } else if (ch.action.type === 'convert') {
        convertChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: formDecorate(ch, ch.action.extend ? `地形を${ch.action.extend}ターン延長` : ''),
          on: st.convertUid === ch.uid,
        });
      } else if (ch.action.type === 'ground') {
        groundChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: `撃墜${ch.action.turns}ターン・飛行の敵を地形の対象にする`,
        });
      } else if (ch.action.shiftAfterText && st.sim && kyoenSkillShifted(st.sim, ch.member.id)) {
        // シフト後のスキル（バティンB）は火ではない: チップには
        // シフト後の形を示し、火として使えなくする。
        fireChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: `シフト後: ${ch.action.shiftAfterText}`,
          disabled: true,
        });
      } else if (ch.action.reserve) {
        fireChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: formDecorate(ch, `リザーブ: ターン終了時に火${ch.fireHits}回・${ch.action.reserve.turns}ターン続く`, ch.action.dmgMult),
        });
      } else if (ch.action.shoui) {
        fireChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: '火1回（フォトン1個分）・単体',
        });
      } else if (ch.action.levels) {
        const ra = resolvedChoice(ch);
        fireChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: formDecorate(ch, `火${ra.hits}回・${KYOEN_RANGE_LABEL[ra.range]}${ra.terrainBonus ? '・地形のある敵に特効' : ''}${ra.extend ? `・地形を${ra.extend}ターン延長` : ''}・Lv${ra.lv} 倍率${ra.dmgMult}（使うたびにLvアップ）`),
        });
      } else {
        let sub = `火${ch.fireHits}回・${KYOEN_RANGE_LABEL[ch.action.range]}${ch.action.terrainBonus ? '・地形のある敵に特効' : ''}${ch.action.extend ? `・地形を${ch.action.extend}ターン延長` : ''}`;
        // 反撃の火（フェニックスC）: タップで反撃した相手を選ぶ。
        if (ch.action.counter) sub += '・反撃（タップで相手を選ぶ）';
        // 割り振り対象の火（灼火蝶マヴィ）: タップで割り振り。
        if (ch.action.allocMax !== undefined) sub += `・タップで割り振り（合計${ch.action.allocMax}回）`;
        fireChoices.push({
          uid: ch.uid, label: choiceLabel(ch),
          sub: formDecorate(ch, sub, ch.action.dmgMult),
        });
      }
    }

    const sim = st.sim;
    const fc = sim ? kyoenForecast(sim) : null;
    const enemyVms = enemies.map((e, i) => {
      if (!sim) {
        return {
          index: i, name: e.name,
          hpText: `HP ${fmt(e.hp)}`,
          barPct: 100, bands: [],
          subText: [
            e.flying ? '飛行: 地形は無効' : e.terrainNull ? '地形効果を無効化: 地形は無効' : '',
            e.revive ? `戦闘不能時に蘇生（HP${e.revive.hpPct}%・${e.revive.times}回）` : '',
          ].filter(Boolean).join('・'),
          isTarget: st.target === i, dead: false,
        };
      }
      const se = sim.enemies[i];
      const bands = [];
      if (fc && !se.dead && se.hpNow > 0) {
        let cum = 0;
        for (const dmg of fc.perEnemy[i].bands) {
          if (cum >= se.hpNow) break;
          const w = Math.min(dmg, se.hpNow - cum);
          bands.push({
            leftPct: (se.hpNow - cum - w) / se.maxHp * 100,
            widthPct: w / se.maxHp * 100,
            color: KYOEN_BAND_COLORS[bands.length % KYOEN_BAND_COLORS.length],
          });
          cum += w;
        }
      }
      let subText;
      if (se.dead) subText = `倒した（ターン${se.killTurn}）`;
      else if (e.flying && se.shot > 0 && se.covered) subText = `撃墜中（あと${se.shot}ターン）・火${se.count}回・地形 あと${se.remaining}ターン・次 ${fmt(kyoenNextDamage(sim, i))}`;
      else if (e.flying && se.shot > 0) subText = `撃墜中（あと${se.shot}ターン）・地形の範囲外`;
      else if (e.flying) subText = '飛行: 地形は無効';
      else if (se.terrainNull) subText = '地形効果を無効化: 地形は無効';
      else if (se.covered) subText = `火${se.count}回・地形 あと${se.remaining}ターン・次 ${fmt(kyoenNextDamage(sim, i))}`;
      else subText = '地形の範囲外';
      // 蘇生とシフトの状態（現在の形は sim の状態側で見る）。
      if (!se.dead && se.reviveSpec) {
        const parts = [];
        if (se.form === 1) parts.push('シフト後');
        if (se.revivesLeft > 0) parts.push(`蘇生あと${se.revivesLeft}回`);
        if (se.form === 1 && se.unknownDamage) parts.push('軽減は未計算');
        if (parts.length) subText = subText ? `${subText}・${parts.join('・')}` : parts.join('・');
      }
      return {
        index: i, name: e.name,
        hpText: `HP ${fmt(se.hpNow)} / ${fmt(se.maxHp)}`,
        barPct: se.maxHp > 0 ? se.hpNow / se.maxHp * 100 : 0,
        bands, subText,
        isTarget: st.target === i, dead: se.dead,
      };
    });

    return {
      setupDone: Boolean(sim),
      turnText: sim ? `${sim.turn}ターン目` : '',
      // かばうの注記（2026-11-21 ユーザー裁定）: 敵編成に
      // かばう持ちがいる場合だけ出す。再現はしない（回数の
      // 伸びは元の対象に数える前提のため本題はズレず、直接
      // ダメージの行き先だけが実ゲームと異なる）。
      kabauNote: enemies.some((e) => e.kabau)
        ? '敵にかばう持ちがいます。かばうは再現しておらず、直接ダメージの行き先は実ゲームと異なる場合があります。'
        : '',
      setupSummary: sim ? st.setupSummary : '',
      enjouChoices, convertChoices, fireChoices, groundChoices, delayedChoices, shiftChoices,
      relayChoices: sim ? enjouChoices : [],
      eventText: sim ? (st.lastEvent || '') : '',
      reserveText: sim && sim.reserves && sim.reserves.length
        ? sim.reserves.map((r) => `リザーブ: ${r.label}（あと${r.turnsLeft}ターン・ターン終了時に発動）`).join('／')
        : '',
      enemies: enemyVms,
      conclusion: sim ? (() => {
        let c = kyoenConclusion(sim, fc);
        // シフト後に数値で追えない敵は、見通しがシフトする時点で
        // 止まっていることを結論にも残す（理由ごとに分ける:
        // 数値化できない軽減がある敵と、列無効化・被ダメージ
        // 上昇が変わるため pace を引き継げない敵）。
        const stoppedNames = (pred) => (fc ? fc.perEnemy
          .map((f, i) => (f.stoppedAtShift && pred(f) ? sim.enemies[i].name : null))
          .filter(Boolean) : []);
        const stoppedUnknown = stoppedNames((f) => f.stopUnknown);
        const stoppedForm = stoppedNames((f) => !f.stopUnknown);
        if (stoppedUnknown.length) {
          c += `（${stoppedUnknown.join('・')}はシフト後の被ダメージを数値で表せないため、見通しはシフトするまで）`;
        }
        if (stoppedForm.length) {
          c += `（${stoppedForm.join('・')}はシフトで被ダメージの扱いが変わるため、見通しはシフトするまで）`;
        }
        return c;
      })() : '',
      canEndTurn: Boolean(sim) && sim.enemies.some((e) => !e.dead),
      canUndo: Boolean(sim) && sim.history.length > 0,
    };
  }

  // 割り振りポップアップ（対象ランダム×回数系）: 合計回数（範囲の
  // あるものは範囲内で選べる）と敵ごとのヒット数を決め、「決定」で
  // 反映する。開いている状態は文脈の kyoen.allocPopup に持ち、
  // ステッパーのたびにシートを開き直す（Hボムの付着ポップアップと
  // 同じ作法）。mode は setup（地形決定の炎上）/ relay（敷き直し）/
  // fire（火行動）。
  function openKyoenAllocPopup(env, mode, uid) {
    const holder = env.state();
    if (!holder || !holder.kyoen) return;
    const ctx = env.context();
    const ch = ctx ? ctx.choices.get(uid) : null;
    if (!ch || ch.action.allocMax === undefined) return;
    // 地形決定は Lv1 の範囲、開始後は現在 Lv の範囲。
    const ra = ch.action.levels && holder.kyoen.sim
      ? kyoenLeveled(ch.action, kyoenLevelOf(holder.kyoen.sim, uid))
      : ch.action;
    holder.kyoen.allocPopup = { mode, uid, total: ra.allocMin, hits: {} };
    renderKyoenAllocPopup(env);
  }

  function renderKyoenAllocPopup(env) {
    const holder = env.state();
    const st = holder && holder.kyoen;
    const pop = st && st.allocPopup;
    if (!pop) return;
    const ctx = env.context();
    const ch = ctx ? ctx.choices.get(pop.uid) : null;
    if (!ch) { st.allocPopup = null; overlay.close(); return; }
    const ra = ch.action.levels && st.sim
      ? kyoenLeveled(ch.action, kyoenLevelOf(st.sim, pop.uid))
      : ch.action;
    const sim = st.sim;
    const sum = Object.values(pop.hits).reduce((s, n) => s + n, 0);
    const fmt = (n) => n.toLocaleString('ja-JP');
    const rows = ctx.enemies.map((e, i) => {
      const se = sim ? sim.enemies[i] : null;
      const count = pop.hits[i] || 0;
      // 1ヒット分の直接ダメージ（地形のある敵への特効は火行動の時だけ）。
      const bonus = pop.mode === 'fire' && se && se.covered && ra.terrainBonus
        ? ra.terrainBonus : 1;
      const per = ra.dmgMult > 0 ? kyoenDirectHit({
        atk: ch.member.atk, mult: ra.dmgMult, def: se ? se.def : e.def,
        attackerClass: ch.member.className, targetRow: kyoenRowOf(se || e),
        terrainBonus: bonus,
      }) : 0;
      return {
        index: i, name: e.name,
        hpText: se ? `HP ${fmt(se.hpNow)} / ${fmt(se.maxHp)}` : `HP ${fmt(e.hp)}`,
        count, dead: se ? se.dead : false,
        dmgText: count > 0 && per > 0 ? `${count}回で約${fmt(per * count)}ダメージ` : '',
        canMinus: count > 0,
        canPlus: !(se && se.dead) && sum < pop.total,
      };
    });
    const closePopup = () => { st.allocPopup = null; overlay.close(); env.rerender(); };
    const content = buildKyoenAllocPopup({
      title: `${ch.member.name} ${ch.action.medium}「${ch.action.name}」の割り振り`,
      note: pop.mode === 'setup'
        ? '対象がランダムなため、実際に当たった回数を敵ごとに割り振ってください。地形そのものは、選んでいる対象に付きます。'
        : '対象がランダムなため、実際に当たった回数を敵ごとに割り振ってください。',
      total: pop.total, minTotal: ra.allocMin, maxTotal: ra.allocMax,
      canEditTotal: ra.allocMin < ra.allocMax,
      sum, rows,
      canConfirm: sum === pop.total,
    }, {
      onTotal: (delta) => {
        pop.total = Math.min(ra.allocMax, Math.max(ra.allocMin, pop.total + delta));
        // 合計を減らしたら、割り振りも合計以下に切り詰める。
        let s = Object.values(pop.hits).reduce((a, n) => a + n, 0);
        while (s > pop.total) {
          for (const k of Object.keys(pop.hits).map(Number).sort((a, b) => b - a)) {
            if (s <= pop.total) break;
            if (pop.hits[k] > 0) { pop.hits[k] -= 1; s -= 1; }
          }
        }
        renderKyoenAllocPopup(env);
      },
      onStep: (index, delta) => {
        const next = (pop.hits[index] || 0) + delta;
        if (next < 0) return;
        if (delta > 0 && sum >= pop.total) return;
        if (next === 0) delete pop.hits[index];
        else pop.hits[index] = next;
        renderKyoenAllocPopup(env);
      },
      onConfirm: () => confirmKyoenAlloc(env),
      onCancel: closePopup,
    });
    overlay.openSheet(content, { onCloseRequest: closePopup });
  }

  function confirmKyoenAlloc(env) {
    const holder = env.state();
    const st = holder && holder.kyoen;
    const pop = st && st.allocPopup;
    if (!pop) return;
    const ctx = env.context();
    const ch = ctx ? ctx.choices.get(pop.uid) : null;
    const { mode, hits } = pop;
    st.allocPopup = null;
    overlay.close();
    if (!ch) { env.rerender(); return; }
    if (mode === 'setup') {
      // 地形決定: 割り振りを控えておき、狂炎化が揃った時点で
      // sim を作る時に敵ごとのヒット数で直接ダメージを当てる。
      st.enjouUid = pop.uid;
      st.setupAlloc = { uid: pop.uid, hits };
      st.sim = null;
      env.rerender();
      return;
    }
    const sim = st.sim;
    if (!sim) { env.rerender(); return; }
    if (ch.action.form && ch.action.form !== kyoenFormOf(sim, ch.member.id)) {
      env.rerender();
      return;
    }
    // レベル制の行動は現在 Lv の数値で使い、使用として数える。
    const ra = kyoenUse(sim, { ...ch.action, levelKey: pop.uid });
    if (mode === 'relay') {
      const res = kyoenApplyOverwrite(sim, {
        range: ra.range, mult: ra.mult, duration: ra.duration,
        dmgMult: ra.dmgMult, dmgHits: ra.dmgHits || 0,
        atk: ch.member.atk, attackerClass: ch.member.className,
      }, st.target, { hitsByEnemy: hits });
      st.lastEvent = res.overwritten
        ? `敷き直し: 上書きした（${res.reason}）。倍率${ra.mult}・持続${ra.duration}ターンになった`
        : `敷き直し: 上書きしなかった（${res.reason}）`;
      if (ra.shiftTo) kyoenShift(sim, ch.member.id, ra.shiftTo);
    } else {
      // 火行動: 敵ごとに単体の火行動として当てる。行動者が
      // 与えた火回数の数え（遅延行動の材料）は、割り振った
      // 合計ぶんが actorId 経由で入る。
      for (const [idxText, h] of Object.entries(hits)) {
        if (!(h > 0)) continue;
        kyoenApplyFire(sim, {
          range: 'single', hits: h, dmgMult: ra.dmgMult,
          atk: ch.member.atk, attackerClass: ch.member.className,
          terrainBonus: ra.terrainBonus || 1, extend: ra.extend || 0,
          actorId: ch.member.id,
        }, Number(idxText));
      }
      if (ra.shiftTo) kyoenShift(sim, ch.member.id, ra.shiftTo);
    }
    env.rerender();
  }

  // 反撃のポップアップ（フェニックスCの覚醒スキル）: 誰から攻撃
  // されたか（誰に反撃したか）を選び、その敵に火回数を反映する。
  function openKyoenCounterPopup(env, uid) {
    const holder = env.state();
    if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
    const st = holder.kyoen;
    const ctx = env.context();
    const ch = ctx ? ctx.choices.get(uid) : null;
    if (!ch) return;
    const sim = st.sim;
    const fmt = (n) => n.toLocaleString('ja-JP');
    const items = sim.enemies.map((se, i) => (se.dead ? null : {
      index: i, name: se.name, hpText: `HP ${fmt(se.hpNow)} / ${fmt(se.maxHp)}`,
    })).filter(Boolean);
    const content = buildKyoenCounterPopup({
      title: `${ch.member.name} ${ch.action.medium}「${ch.action.name}」`,
      note: '反撃した相手（攻撃してきた敵）を選んでください。その敵に火回数が入ります。',
      items,
    }, {
      onPick: (index) => {
        overlay.close();
        const ra = kyoenUse(sim, { ...ch.action, levelKey: uid });
        const hits = ra.hits !== undefined ? ra.hits : ch.fireHits;
        kyoenApplyFire(sim, {
          range: 'single', hits, dmgMult: ra.dmgMult,
          atk: ch.member.atk, attackerClass: ch.member.className,
          terrainBonus: ra.terrainBonus || 1, extend: ra.extend || 0,
          actorId: ch.member.id,
        }, index);
        if (ra.shiftTo) kyoenShift(sim, ch.member.id, ra.shiftTo);
        st.lastEvent = `反撃: ${sim.enemies[index].name}に火${hits}回`;
        env.rerender();
      },
      onCancel: () => { overlay.close(); env.rerender(); },
    });
    overlay.openSheet(content, {
      onCloseRequest: () => { overlay.close(); env.rerender(); },
    });
  }

  // ME の枠条件のヒント（M6、2026-11-19）: リーダーが決まっている
  // 時だけ、主 ME の枠条件を空き枠へ出し、埋まった枠には条件に
  // 合っている印を付ける材料を作る。リーダーの枠（中央）自身は
  // 対象外（条件は '-' で本人に効く）。ME 未収録・リーダー未選択
  // の時は何も出さない。照合は counter.js の既存の規則。
  function meHintsVm() {
    const none = [null, null, null, null, null];
    if (!buildCtx || !counterData || !counterData.meData) return none;
    const leaderSlot = buildCtx.slots[2];
    if (!leaderSlot || !leaderSlot.megidoId) return none;
    const rec = counterData.meData.megido[leaderSlot.megidoId];
    if (!rec || !rec.massEffect) return none;
    return buildCtx.slots.map((s, i) => {
      if (i === 2) return null;
      const key = ME_SLOT_KEYS[i];
      if (!s.megidoId) {
        const conds = meSlotConditions(rec.massEffect, key);
        return conds && conds.length > 0 ? { condText: conds.join('／') } : null;
      }
      const m = byId.get(s.megidoId);
      if (!m) return null;
      return {
        match: meSlotMatches(rec.massEffect, key,
          { style: m.style, className: m.class, gender: m.gender }),
      };
    });
  }

  function renderBuilder() {
    if (!buildCtx) return;
    buildCtx.view = 'main';
    const derived = derive();
    const meHints = meHintsVm();
    const leaderMissing = !canSaveFormation(buildCtx.slots);
    // 警告は保存ボタンの直上にまとめる（思考順の最後: 警告を見て保存）。
    // ただし保存できない理由（リーダーが空）は警告行に出さず、保存
    // ボタン自体の文面で示す（2026-11-20 ユーザー指示。vm の
    // saveBlockReason）。ここに残るのは保存を妨げない注意だけ
    // （かばうの発動者決定は、かばう役を2人以上置いた時だけ出す）。
    const warnings = [];
    warnings.push(...kabauPartyNotes(buildCtx.slots.filter((s) => s.megidoId
      && counterData
      && (counterData.index.byMegido.get(s.megidoId) || []).some((m) => m.effectId === 'kabau')).length));
    // トランス競合の注意: 異なる系統のトランス始動が2つ以上ある時
    // だけ。検出は生成データ（本体の行動＋リーダーのマスエフェクト）
    // で、文面は確定済みの原文。保存は妨げない。
    warnings.push(...tranceConflictLines(tranceFamiliesInFormation(
      counterData ? counterData.mechanicNotes : null,
      buildCtx.slots.filter((s) => s.megidoId).map((s) => s.megidoId),
      buildCtx.slots[2] ? buildCtx.slots[2].megidoId : null,
    )));
    // 31階の制限ターゲットでは、シミュレーター類（チェイン・
    // Hボム・狂炎）と戦旗（全員が覚醒スキル付与で制限下では成立
    // しない）、Lv70 前提の数値節（破断・地割れ／耐久／受けダメー
    // ジ見積もり）、霊宝4つ特性の印（霊宝自体が使えない）を出さ
    // ない。扱いは floor31-restriction-prep.md の相談の記録が正本。
    const restricted = targetRestricted();
    const vm = {
      // 新規の画面名は入口のボタンと同じ「編成を作成」（節の見出し
      // 「メギドを選択」と二重にしない）。
      title: buildCtx.mode === 'edit' ? '編成を編集する' : '編成を作成',
      // 保存できない理由は保存ボタンの文面に出す（2026-11-20）。
      saveBlockReason: leaderMissing ? 'リーダー（中央の枠）が空です' : null,
      slots: buildCtx.slots.map((slot, index) => {
        const m = slot.megidoId ? byId.get(slot.megidoId) : null;
        // 実効素早さの数値（補正込み。内訳つき）。速さは編成の
        // 基本情報として枠に出す（2026-11-19 ユーザー指摘）。
        const spdR = slot.megidoId
          ? effSpdInFormation(slot.megidoId, index, buildCtx.slots, derived.conditionOf(slot.megidoId))
          : null;
        return {
          index,
          label: SLOT_LABELS[index],
          isLeader: index === 2,
          filled: Boolean(slot.megidoId),
          ...spdDisplayOf(spdR),
          name: m ? m.name : slot.megidoId ? '（データに無いメギド）' : null,
          // 枠内の名前表示だけ短縮名を使う（SW93。正本
          // research/short-names.md）。name は顔アイコンの照合などに
          // フルネームのまま要るため、表示用は別に持つ。適用範囲は
          // エディタの枠だけで、他の画面の VM には足さない。
          displayName: m ? slotShortName(m.name) : null,
          styleText: m
            ? `${m.style}／${m.class}／${CONDITION_STAGES[derived.conditionOf(slot.megidoId)]}`
            : '',
          style: m ? m.style : null,
          className: m ? m.class : null,
          stage: m ? derived.conditionOf(slot.megidoId) : null,
          stageLabel: m ? CONDITION_STAGES[derived.conditionOf(slot.megidoId)] : null,
          orbText: slot.orbId ? orbNameText(slot.orbId) : 'オーブなし',
          // 霊宝はメギドの装備を表示する（枠の持ち物ではない）。
          // 枠では個数＋専用印＋素早さ分だけに畳む（2026-11-19）。
          reishouSummary: slot.megidoId ? reishouSlotSummary(slot.megidoId) : null,
          // ME の枠条件のヒント（空き枠の条件表示／埋まった枠の印）。
          meCondText: meHints[index] && meHints[index].condText
            ? meHints[index].condText : null,
          meMatch: Boolean(meHints[index] && meHints[index].match),
          // 霊宝4つ装備が条件の第2特性（候補2）: 凸の解禁と装備数
          // の両方を満たす時だけ、発動中の印を枠に出す。制限下では
          // 霊宝自体が使えないため出さない。
          reishou4Text: !restricted && slot.megidoId
            && reishou4Active(slot.megidoId, levelOf(slot.megidoId), equipmentOf(slot.megidoId).length)
            ? reishou4TraitName(slot.megidoId)
            : null,
        };
      }),
      target: {
        enemyName: buildCtx.targetEnemy,
        floors: buildCtx.targetEnemy
          ? floorsForEnemy(structure, buildCtx.targetEnemy)
            .map((floor) => ({ floor, on: buildCtx.targetFloors.includes(floor) }))
          : [],
        // 選んだら自動で付くタグ（保存のたびに作り直される側。カスタム
        // タグとは別に、付く内容を先に見せる）。
        autoTags: buildCtx.targetEnemy
          ? buildAutoTags({
            slots: buildCtx.slots, byId,
            enemyName: buildCtx.targetEnemy,
            floors: [...buildCtx.targetFloors].sort((a, b) => a - b),
            structure,
          })
          : [],
        // 敵の小帯（SW92）: 名前・簡単な説明・◇タイトルを枠のそばに
        // 置く。マスから入った場合だけ、帯タップでマスシートへ戻れる。
        band: buildCtx.targetEnemy ? targetBandVm(derived) : null,
        bandTappable: Boolean(buildCtx.returnToSheet),
        targetText: buildCtx.targetEnemy ? targetTextOf() : null,
      },
      // 対策の行（SW92、問題E）: 脅威ごとに範囲を明示した行。
      // 編成の出し入れに連動する。
      counters: buildCtx.targetEnemy ? targetCountersVm(derived) : null,
      customTags: buildCtx.customTags,
      notes: buildCtx.notes,
      chain: restricted ? null : chainSectionVm(derived),
      hbomb: restricted ? null : hbombSectionVm(),
      kyoen: restricted ? null : kyoenSectionVm(),
      warnings,
      leaderMissing,
      meFit: meFitVm(),
      flag: restricted ? null : flagVm(),
      hadanJiware: restricted ? null : hadanJiwareVm(),
      withstand: restricted ? null : withstandVm(),
      damageEstimate: restricted ? null : damageEstimateVm(),
      meNote: buildCtx.slots[2] && buildCtx.slots[2].megidoId
        ? null
        : 'リーダーを置くと、そのリーダーのマスエフェクトがここに出ます。',
    };
    const { content, actionBar } = buildFormationEditor(vm, builderCallbacks);
    // スクロール保持の文脈: 構築の世代×下位ビュー。下位ビュー（候補・
    // ピッカー）はそれぞれ別の文脈で、開けば先頭、操作では保持し、
    // 戻れば本体の位置も戻る。
    overlay.openFull(content, {
      bottom: actionBar, scrollKey: `build:${buildCtx.gen}:main`,
    });
  }

  // 編成名を決める段（2026-11-20 ユーザー指示）: 保存ボタンを押した
  // 後に挟み、ここで決めた名前で保存を完了させる。既存の編成では
  // 現在の名前が入った状態で出す。戻る（と閉じる操作）はエディタへ。
  function renderNameStep() {
    if (!buildCtx) return;
    buildCtx.view = 'name';
    const vm = {
      name: buildCtx.name,
      // プレースホルダは対策編成の名前の例（2026-11-19 ユーザー指示）。
      // 空のまま保存した時は、リーダーのメギド名などから自動で付ける
      // （saveFormation の自動命名）。
      namePlaceholder: '例: ○○対策編',
    };
    const { content, actionBar, nameInput } = buildFormationNameStep(vm, nameStepCallbacks);
    overlay.openFull(content, {
      bottom: actionBar, scrollKey: `build:${buildCtx.gen}:name`,
      onCloseRequest: () => nameStepCallbacks.onBack(),
    });
    if (nameInput && typeof nameInput.focus === 'function') {
      nameInput.focus();
      if (typeof nameInput.setSelectionRange === 'function') {
        const len = nameInput.value.length;
        nameInput.setSelectionRange(len, len);
      }
    }
  }

  const nameStepCallbacks = {
    onNameChange: (text) => { if (buildCtx) buildCtx.name = text; },
    onConfirm: () => saveFormation(),
    onBack: () => { if (buildCtx) renderBuilder(); },
  };

  // ターゲットの敵ピッカー: 塔に登場する敵から検索して選ぶ。
  function renderEnemyPicker() {
    if (!buildCtx) return;
    buildCtx.view = 'enemy';
    const all = allEnemyNames(structure);
    const q = normalizeSearchText(buildCtx.enemyQuery.trim());
    const rows = all.filter((e) => !q || normalizeSearchText(e.name).includes(q))
      .map((e) => ({
        name: e.name,
        floorsText: floorsForEnemy(structure, e.name).map((f) => `${f}F`).join('・'),
        isCurrent: buildCtx.targetEnemy === e.name,
      }));
    const vm = {
      query: buildCtx.enemyQuery,
      // トップ2行目の「現在のターゲット」（2026-11-25 再設計）:
      // 検索で絞っても現在の対象は行から引かず文脈から渡す。
      currentTarget: buildCtx.targetEnemy,
      filterOpen: Boolean(buildCtx.enemyFilterOpen),
      rows,
      shownCount: rows.length,
      totalCount: all.length,
    };
    const { top, content, searchInput } = buildEnemyPicker(vm, enemyPickerCallbacks);
    overlay.openFull(content, {
      top, scrollKey: `build:${buildCtx.gen}:enemy`,
      onCloseRequest: () => enemyPickerCallbacks.onBack(),
    });
    if (buildCtx.enemyFocusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    buildCtx.enemyFocusSearch = false;
  }

  const enemyPickerCallbacks = {
    onQuery: (text) => {
      if (!buildCtx) return;
      buildCtx.enemyQuery = text;
      buildCtx.enemyFocusSearch = true;
      renderEnemyPicker();
    },
    onToggleFilter: () => {
      if (!buildCtx) return;
      buildCtx.enemyFilterOpen = !buildCtx.enemyFilterOpen;
      renderEnemyPicker();
    },
    onPick: (name) => {
      if (!buildCtx) return;
      buildCtx.targetEnemy = name;
      // 階の選択は、その敵が登場する階の範囲で引き継ぐ（範囲外は落とす）。
      const available = floorsForEnemy(structure, name);
      buildCtx.targetFloors = buildCtx.targetFloors.filter((f) => available.includes(f));
      buildCtx.pickingEnemy = false;
      renderBuilder();
    },
    onClear: () => {
      if (!buildCtx) return;
      buildCtx.targetEnemy = null;
      buildCtx.targetFloors = [];
      buildCtx.pickingEnemy = false;
      renderBuilder();
    },
    onBack: () => {
      if (!buildCtx) return;
      buildCtx.pickingEnemy = false;
      renderBuilder();
    },
  };

  // 霊宝ピッカー（メギド画面・構築画面で共用）: 対象は編成の枠ではなく
  // メギド本人。装備できるもの（スタイルで判定）だけを出し、検索と系譜
  // フィルタで絞る。装備は1体4枠までで、同じ霊宝を複数の枠に付ける
  // こともできる。枠を選んでから行タップでその枠に付け（付け替え）、
  // 「外す」で選んでいる枠を空にする。装備（megidoDetails）を直接
  // 書き換える（編成ごとの別持ちにはしない）。
  let reishouPickCtx = null; // { megidoId, slotIndex, query, lineage, focusSearch, scrollKey, onDone, formationSlotIndex }
  function openReishouPicker(megidoId, { slotIndex, scrollKey, onDone }) {
    // 既定の編集枠は、最初に空いている枠（全部埋まっていれば枠1）。
    const picked = equipmentOf(megidoId);
    const first = typeof slotIndex === 'number'
      ? Math.max(0, Math.min(REISHOU_PER_MEGIDO - 1, slotIndex))
      : Math.min(picked.length, REISHOU_PER_MEGIDO - 1);
    // 素早さプレビューの物差し: 編成エディタから開いた場合は、その
    // メンバーが入っている編成枠を控える（描画のたびに実在を再確認
    // する）。メギド画面から開いた場合は null（単体の物差し）。
    const fIdx = buildCtx
      ? buildCtx.slots.findIndex((s) => s && s.megidoId === megidoId)
      : -1;
    reishouPickCtx = {
      megidoId, slotIndex: first, query: '', lineage: null, focusSearch: false, scrollKey, onDone,
      formationSlotIndex: fIdx >= 0 ? fIdx : null,
    };
    renderReishouPicker();
  }

  // 素早さの付け替え注記（霊宝・オーブの両ピッカーで同じ文型を
  // 使う）。spdCmp は compareSpeeds の結果（無い時は関係文を
  // 付けない）。値が null の時は注記自体を出さない。
  function spdRelText(spdCmp, v) {
    if (!spdCmp || typeof v !== 'number') return '';
    if (v > spdCmp.fastestSpd) return '（敵最速より速い）';
    if (v === spdCmp.fastestSpd) return '（敵最速と同速）';
    return '（敵最速より遅い）';
  }
  function spdSwapText(verb, value, spdCmp) {
    return value === null ? null : `${verb}素早さ${value}${spdRelText(spdCmp, value)}`;
  }

  function renderReishouPicker() {
    if (!reishouPickCtx) return;
    const member = byId.get(reishouPickCtx.megidoId);
    if (!member) { reishouPickCtx = null; return; }
    const picked = equipmentOf(member.id);
    const all = reishouById ? [...reishouById.values()] : [];
    const equippable = all.filter((r) => r.styles.includes(member.style));
    const lineages = [...new Set(equippable.map((r) => r.lineage).filter(Boolean))].sort();
    // 素早さのプレビュー（2026-11-19、オーブピッカーと同じ形）:
    // 編成から開いた場合は編成内の実効素早さ（オーブ・ME・コン
    // ディション込み）、メギド画面から開いた場合は単体（特性・
    // 霊宝まで）を物差しに、編集中の枠へ付けた後の値を試算する。
    // 装備の正は書き換えず、装備配列の差し替えで計算する。
    const spdStage = derive().conditionOf(member.id);
    const fIdx = reishouPickCtx.formationSlotIndex;
    const inFormation = typeof fIdx === 'number' && buildCtx
      && buildCtx.slots[fIdx] && buildCtx.slots[fIdx].megidoId === member.id;
    const spdWithEquip = (equipIds) => {
      if (inFormation) {
        const r = effSpdInFormation(member.id, fIdx, buildCtx.slots, spdStage, equipIds);
        return r ? r.value : null;
      }
      return effSpdStandalone(member.id, spdStage, equipIds);
    };
    const currentSpd = spdWithEquip(picked);
    // 敵最速との関係（編成で使うステージを選んでいる時だけ。
    // オーブピッカーと同じ物差し・同じ文面）。31階の制限ターゲット
    // では、Lv70 前提の対比になるため関係文は付けない（数値自体は
    // 編成仕様として従来どおり出す）。
    const spdCmp = inFormation && typeof currentSpd === 'number' && !targetRestricted()
      ? compareSpeeds({
        allies: [{ name: member.name, spd: currentSpd }],
        enemies: targetSquareEnemies(),
      })
      : null;
    // その霊宝が素早さに触れるか（固定値か割合%の補正があるか）。
    const reishouHasSpdCorr = (rid) => {
      if (!rid) return false;
      const rec = reishouById ? reishouById.get(rid) : null;
      if (rec && rec.stats && typeof rec.stats.spd === 'number' && rec.stats.spd !== 0) return true;
      const corr = counterData && counterData.speedCorr ? counterData.speedCorr.reishou : null;
      const c = corr ? corr[rid] : null;
      return Boolean(c && typeof c.pct === 'number' && c.pct !== 0);
    };
    // 編集中の枠へ付けた後の装備（onPick と同じ付け替え規則:
    // 枠が埋まっていれば差し替え、空きの先なら末尾に足す）。
    const spdAfterOf = (rid) => {
      const next = [...picked];
      const idx = Math.min(reishouPickCtx.slotIndex, next.length);
      const displaced = idx < next.length ? next[idx] : null;
      if (idx < next.length) next[idx] = rid;
      else next.push(rid);
      const unchanged = next.length === picked.length
        && next.every((v, i) => v === picked[i]);
      if (unchanged) return null;
      // 付ける側にも外れる側にも素早さ補正が無ければ値は動かない。
      if (!reishouHasSpdCorr(rid) && !reishouHasSpdCorr(displaced)) return null;
      return spdWithEquip(next);
    };
    const q = normalizeSearchText(reishouPickCtx.query.trim());
    const rows = equippable.filter((r) => {
      if (reishouPickCtx.lineage && r.lineage !== reishouPickCtx.lineage) return false;
      if (q) {
        const hit = normalizeSearchText(r.name).includes(q)
          || normalizeSearchText(r.lineage || '').includes(q)
          || normalizeSearchText(r.effects || '').includes(q);
        if (!hit) return false;
      }
      return true;
    }).map((r) => {
      const statParts = r.stats
        ? ['hp', 'atk', 'def', 'spd']
          .filter((k) => typeof r.stats[k] === 'number')
          .map((k) => `${REISHOU_STAT_LABEL[k]}+${r.stats[k]}`)
        : [];
      const meta = [
        r.lineage ? `系譜: ${r.lineage}` : '系譜: なし',
        statParts.join('・'),
        r.size ? `大きさ: ${r.size}` : '',
        r.effects || '',
      ].filter(Boolean).join('／');
      const slotIndexes = [];
      picked.forEach((pid, i) => { if (pid === r.id) slotIndexes.push(i); });
      const after = spdAfterOf(r.id);
      return {
        id: r.id, name: r.name, meta, slotIndexes,
        // 行の3行固定の材料（2026-11-25 再設計）: meta の連結文と
        // 同じ材料を、名前の横／ステータス行／効果行に分けて渡す。
        lineage: r.lineage || null,
        size: r.size || null,
        statsText: statParts.join('・'),
        effectsText: r.effects || '',
        // 素早さの結果は数値で渡し、行では「速○○→○○ ↑」の形にする。
        spdNow: currentSpd,
        spdAfter: after,
        spdAfterText: spdSwapText('付けると', after, spdCmp),
        spdAfterDir: after === null ? null : spdDirOf(after, currentSpd),
      };
    });
    rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const slots = [];
    for (let i = 0; i < REISHOU_PER_MEGIDO; i += 1) {
      const rid = picked[i];
      const r = rid && reishouById ? reishouById.get(rid) : null;
      slots.push(rid ? { name: r ? r.name : '名称不明' } : null);
    }
    // 外した後の値（編集中の枠に素早さ補正のある霊宝が付いている
    // 時だけ。オーブピッカーの「外すと素早さ○○」と同じ作法で、
    // 外すボタンのそばに出す）。
    const clearAfter = (() => {
      const idx = reishouPickCtx.slotIndex;
      if (idx < 0 || idx >= picked.length) return null;
      if (!reishouHasSpdCorr(picked[idx])) return null;
      const next = [...picked];
      next.splice(idx, 1);
      return spdWithEquip(next);
    })();
    const vm = {
      memberName: member.name,
      query: reishouPickCtx.query,
      lineages,
      lineageFilter: reishouPickCtx.lineage,
      filterOpen: Boolean(reishouPickCtx.filterOpen),
      slots,
      activeSlot: reishouPickCtx.slotIndex,
      rows,
      shownCount: rows.length,
      totalCount: equippable.length,
      clearSpdAfterText: spdSwapText('外すと', clearAfter, spdCmp),
      clearSpdAfterDir: clearAfter === null ? null : spdDirOf(clearAfter, currentSpd),
    };
    const { top, content, searchInput, bottom } = buildReishouPicker(vm, reishouPickerCallbacks);
    overlay.openFull(content, {
      top, bottom, scrollKey: reishouPickCtx.scrollKey,
      // 出口はトップ右の「完了」1つ（2026-11-25 再設計で戻ると統合）。
      // 押した時の振る舞いは従来どおり呼び出し元へ戻るだけ
      // （編成全体やメギド画面を閉じない）。
      closeLabel: '完了',
      onCloseRequest: () => reishouPickerCallbacks.onDone(),
    });
    if (reishouPickCtx.focusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    reishouPickCtx.focusSearch = false;
  }

  const reishouPickerCallbacks = {
    onQuery: (text) => {
      if (!reishouPickCtx) return;
      reishouPickCtx.query = text;
      reishouPickCtx.focusSearch = true;
      renderReishouPicker();
    },
    onLineageFilter: (lineage) => {
      if (!reishouPickCtx) return;
      reishouPickCtx.lineage = lineage;
      renderReishouPicker();
    },
    onToggleFilter: () => {
      if (!reishouPickCtx) return;
      reishouPickCtx.filterOpen = !reishouPickCtx.filterOpen;
      renderReishouPicker();
    },
    onSelectSlot: (index) => {
      if (!reishouPickCtx) return;
      reishouPickCtx.slotIndex = Math.max(0, Math.min(REISHOU_PER_MEGIDO - 1, index));
      renderReishouPicker();
    },
    onClearSlot: async () => {
      if (!reishouPickCtx) return;
      const megidoId = reishouPickCtx.megidoId;
      const picked = equipmentOf(megidoId);
      const idx = reishouPickCtx.slotIndex;
      if (idx < 0 || idx >= picked.length) { renderReishouPicker(); return; }
      const next = [...picked];
      next.splice(idx, 1);
      await setMegidoReishou(megidoId, next);
      if (reishouPickCtx) renderReishouPicker();
    },
    onPick: async (id) => {
      if (!reishouPickCtx) return;
      const megidoId = reishouPickCtx.megidoId;
      const picked = equipmentOf(megidoId);
      const next = [...picked];
      const idx = Math.min(reishouPickCtx.slotIndex, next.length);
      if (idx < next.length) next[idx] = id;
      else next.push(id);
      await setMegidoReishou(megidoId, next);
      if (!reishouPickCtx) return;
      // 次に空いている枠へ編集枠を進める（無ければそのまま）。
      const after = equipmentOf(megidoId);
      if (after.length < REISHOU_PER_MEGIDO) {
        reishouPickCtx.slotIndex = after.length;
      }
      renderReishouPicker();
    },
    onDone: () => {
      if (!reishouPickCtx) return;
      const onDone = reishouPickCtx.onDone;
      reishouPickCtx = null;
      if (onDone) onDone();
    },
  };

  // リーダーのマスエフェクト（M6）: 全272体分が収録済みで、実データで
  // 出す。表示は枠ごとの原文の羅列ではなく、その編成で実際に効いて
  // いる効果だけを効果文ごとに集約した要約（counter.js の
  // summarizeMeEffects）。
  // サブマスエフェクト（第3ME）は正本の発生規則で判定する
  // （subMeOccurrenceFor）: 発生している場合だけ、リーダーの ME の
  // 3行目をサブ側が担う形で分けて出す（本体は1・2行目、サブは
  // 発生者の見出しつき）。リーダー本人のサブMEは発生しないため、
  // 従来のようにリーダーの記録から並べることはしない。消滅・
  // 未発生（専用霊宝なし）は、編成の判断材料として ME 区画内に
  // 小さい注記を1行だけ出す（理由は flight-memo 参照）。
  // 性別の条件は基礎データの性別（性別表が正本）で判定する。
  function meFitVm() {
    if (!buildCtx) return null;
    const leaderSlot = buildCtx.slots[2];
    if (!leaderSlot || !leaderSlot.megidoId) return null;
    const leader = byId.get(leaderSlot.megidoId);
    const leaderName = leader ? leader.name : leaderSlot.megidoId;
    if (!counterData || !counterData.meData) return { leaderName, state: 'missing' };
    const rec = counterData.meData.megido[leaderSlot.megidoId];
    if (!rec || !rec.massEffect) return { leaderName, state: 'missing' };
    const members = buildCtx.slots.map((s) => {
      const m = s.megidoId ? byId.get(s.megidoId) : null;
      return m ? { style: m.style, className: m.class, gender: m.gender } : null;
    });
    // 31階の制限ターゲットではサブマスエフェクトは使えないため、
    // 発生の表示も発生しない理由の注記も出さない（ME 本体は制限の
    // 対象外で従来どおり）。
    const occ = targetRestricted()
      ? { status: 'none' }
      : subMeOccurrenceFor(buildCtx.slots);
    const nameOf = (id) => {
      const b = byId.get(id);
      return b ? b.name : id;
    };
    let lines = summarizeMeEffects(rec.massEffect, members);
    let sub = null;
    let subNote = null;
    if (occ.status === 'active') {
      const holderRec = counterData.meData.megido[occ.holderId];
      lines = summarizeMeEffects(meWithoutThirdRow(rec.massEffect), members);
      sub = {
        holderName: nameOf(occ.holderId),
        lines: holderRec && holderRec.subMassEffect
          ? summarizeMeEffects(holderRec.subMassEffect, members) : [],
      };
    } else if (occ.status === 'vanished') {
      subNote = `サブマスエフェクト: 持ち主が2人以上（${occ.countedIds.map(nameOf).join('・')}）いるため、発生しません`;
    } else if (occ.status === 'inactive') {
      subNote = `サブマスエフェクト: ${nameOf(occ.holderId)}に専用霊宝がないため、発生しません`;
    }
    return {
      leaderName,
      state: 'loaded',
      name: rec.massEffect.name,
      summary: rec.massEffect.summary || null,
      lines,
      sub,
      subNote,
    };
  }

  // 戦旗の条件チェック（2026-11-20）: 編成に戦旗持ちがいる時だけ、
  // 保持者ごとに「付与先のどの枠が発揮条件をみたしているか」を
  // ME 要約の下に出す材料を作る。戦旗はバトル中に覚醒スキルで
  // 付与するもので編成時点には存在しないため、第3MEの上書きは
  // 再現せず、条件の確認だけを行う（ユーザー確定スコープ）。
  // 枠番号は ME 枠の数え方（1始まり、3=リーダー）で統一する。
  function flagVm() {
    if (!buildCtx) return null;
    return flagRowsForSlots(buildCtx.slots);
  }

  // 戦旗の条件チェックの行（枠の並びから組み立てる。エディタの
  // buildCtx.slots と、マスシートの保存済み編成の slots で共用）。
  function flagRowsForSlots(slots) {
    if (!counterData || !counterData.flagData) return null;
    const holders = counterData.flagData.holders || [];
    if (holders.length === 0) return null;
    const byHolderId = new Map(holders.map((h) => [h.megidoId, h]));
    const members = slots.map((s) => {
      const m = s && s.megidoId ? byId.get(s.megidoId) : null;
      return m ? { style: m.style, className: m.class } : null;
    });
    // 付与先の例外（正本の脚注 *46・*47・*49）: 左陣に戦旗が
    // ある場合に右陣へ付与する保持者がいる。左陣の保持者が複数
    // いる編成では、その例外が現実に起こりうるため、該当する
    // 保持者の行にだけ注記を出す（1人だけなら例外は起こらない）。
    const leftHolderCount = slots.reduce((n, s) => {
      const h = s && s.megidoId ? byHolderId.get(s.megidoId) : null;
      return n + (h && h.target === 'left' ? 1 : 0);
    }, 0);
    const rows = [];
    for (const s of slots) {
      if (!s || !s.megidoId) continue;
      const h = byHolderId.get(s.megidoId);
      if (!h) continue;
      const { met, filled } = flagCheckFor(h, members);
      const posLabel = (list) => list.map((p) => `枠${p}`).join('・');
      let line;
      if ((h.tokens || []).length === 0) {
        line = filled.length === 0
          ? `条件はありません。${h.targetLabel}にメンバーはいません。`
          : `条件はありません。${h.targetLabel}の全員（${posLabel(met)}）が受けます。`;
      } else if (filled.length === 0) {
        line = `条件は${h.conditionLabel}。${h.targetLabel}にメンバーはいません。`;
      } else if (met.length === 0) {
        line = `条件は${h.conditionLabel}。条件をみたしているメンバーはいません。`;
      } else {
        line = `条件は${h.conditionLabel}。${posLabel(met)}が条件をみたしています。`;
      }
      rows.push({
        holderName: h.name,
        targetLabel: h.targetLabel,
        slotsLabel: posLabel(h.slots || []),
        line,
        targetNote: h.targetNote && leftHolderCount >= 2 ? h.targetNote : '',
        // 脚注 *50 のターン表（カガセオ）: 効果文の「特定ターン
        // 経過で効果変化」の中身を、生成データの段階表から
        // そのまま添える（SW95 便2）。
        effect: h.effectStages && h.effectStages.length
          ? `${h.effect}（${h.effectStages.map((s) => `${s.turn}ターン目${s.orLater ? '以降' : ''} ${s.value}`).join('、')}）`
          : (h.effect || ''),
      });
    }
    return rows.length > 0 ? rows : null;
  }

  // 選択中のステージ（ターゲットの敵）のパーティの事実と、その
  // マスのルール倍率。最初に材料の揃うマスを正とする
  // （targetSquareEnemies と同じ歩き方）。
  function targetStageFact() {
    if (!buildCtx || !buildCtx.targetEnemy) return null;
    for (const { fe, def } of targetSquares()) {
      const fact = fe && fe.enemies ? fe.enemies[buildCtx.targetEnemy] : null;
      if (!fact) continue;
      return { fact, mult: squareStatMultipliers(def ? def.rules : null) };
    }
    return null;
  }

  const ACTION_KIND_LABEL = { skill: 'スキル', awakenedSkill: '覚醒スキル', ougi: '奥義' };

  // 地割れと破断の「こうなる」（2026-11-20）: 編成に地割れ付与者と
  // 破断保持者が両方いて、使うステージが選ばれている時だけ出す。
  // 保持の判定は生成データ（mechanic-notes のキー、hadanActions、
  // jiwareReishouOnly）。専用霊宝版だけの手段は、所持している時
  // だけ数える。数値は mechanics.js の式（地割れの正本）で計算し、
  // 前提は区画の末尾に明示する。
  function hadanJiwareVm() {
    if (!buildCtx || !counterData || !counterData.mechanicNotes) return null;
    const notesData = counterData.mechanicNotes;
    const notesOf = (id) => (notesData.notes || {})[id] || [];
    const jiwareOnly = new Set(notesData.jiwareReishouOnly || []);
    const memberIds = buildCtx.slots.map((s) => (s ? s.megidoId : null)).filter(Boolean);
    const jiwareHolders = memberIds.filter((id) => notesOf(id).includes('jiware')
      && (!jiwareOnly.has(id) || specialOwnedOf(id)));
    if (jiwareHolders.length === 0) return null;
    const hadanHolders = [];
    for (const id of memberIds) {
      const actions = (notesData.hadanActions || {})[id] || [];
      const usable = actions.filter((a) => !a.needsReishou || specialOwnedOf(id));
      if (usable.length === 0) continue;
      const best = usable.reduce((a, b) => (b.mult > a.mult ? b : a));
      const basics = byId.get(id);
      const stats = memberStatsOf(id);
      if (!basics || !stats) continue;
      hadanHolders.push({
        id,
        name: basics.name,
        className: basics.class,
        atk: stats.atk,
        action: best,
        chiretsuPct: chiretsuDamagePct(equippedReishouRows(id)),
      });
    }
    if (hadanHolders.length === 0) return null;
    const stage = targetStageFact();
    if (!stage) return null;
    const party = (stage.fact.party || []).filter(Boolean);
    if (party.length === 0) return null;
    const nameOf = (id) => {
      const b = byId.get(id);
      return b ? b.name : id;
    };
    const rows = [];
    for (const e of party) {
      if (typeof e.def !== 'number' || typeof e.hp !== 'number') continue;
      const enemyDef = applyMult(e.def, stage.mult.def);
      const enemyHp = applyMult(e.hp, stage.mult.hp);
      const defAfter = Math.floor(enemyDef / 2);
      const factor = hadanFactor(defAfter);
      const factorText = `×${(Math.round(factor * 10) / 10).toFixed(1)}`;
      const lines = hadanHolders.map((h) => {
        const est = hadanDamage({
          atk: h.atk, mult: h.action.mult, attackerClass: h.className,
          enemyDef, enemyClassName: e.class, chiretsuPct: h.chiretsuPct,
        });
        const label = `${h.name}の${ACTION_KIND_LABEL[h.action.kind] || '攻撃'}（${h.action.mult}倍）`;
        if (est.blocked) return `${label}: 防御でほぼ通らない（1点）`;
        return `${label}: 約${est.damage}点（敵のHP ${enemyHp}）${est.damage >= enemyHp ? '。倒せる' : ''}`;
      });
      rows.push({
        enemyName: e.name,
        head: `防御${enemyDef} → 地割れで${defAfter}。破断のダメージは${factorText}倍`,
        lines,
      });
    }
    if (rows.length === 0) return null;
    return {
      jiwareNames: jiwareHolders.map(nameOf),
      hadanNames: hadanHolders.map((h) => h.name),
      rows,
      premise: 'バフなし・乱数1（平均）で計算。攻撃力は基礎と霊宝の固定値まで（オーブや特性の割合補正は数えていません）。地裂の系譜は装備から数えています',
    };
  }

  // 割合軽減の「受ける量」（2026-11-20）: アスモデウスRの第2特性と
  // グラシャラボラスの伝説のオーラについて、選択中のステージの
  // 敵の攻撃の1発分と突き合わせ、無効化できるか・伝説いくつから
  // 無効化できるかを出す。前提（乱数1・デバフなし、数える攻撃の
  // 範囲、味方ステータスの範囲）は区画の末尾に明示する。
  function withstandVm() {
    if (!buildCtx || !counterData || !counterData.mechanicNotes) return null;
    const stage = targetStageFact();
    if (!stage) return null;
    const memberIds = new Set(
      buildCtx.slots.map((s) => (s ? s.megidoId : null)).filter(Boolean));
    const rows = [];
    if (memberIds.has('祖32_アスモデウスR') && levelOf('祖32_アスモデウスR') >= 4) {
      const id = '祖32_アスモデウスR';
      const stats = memberStatsOf(id);
      if (stats) {
        const threshold = asmodeusThreshold(stats.hp);
        const n = equipmentOf(id).length;
        const lines = [];
        if (n < 4) {
          lines.push(`第2特性の発動には、専用霊宝以外の霊宝が4つ必要（今は${n}つ）。揃った場合の目安:`);
        }
        const ests = enemyAttackEstimates(stage.fact, stage.mult, stats.def);
        for (const e of ests) {
          if (e.maxPerHit <= threshold) {
            lines.push(`${e.name}の攻撃は、1発が最大でも${e.maxPerHit}点で、全て無効化できる`);
          } else if (e.minPerHit <= threshold) {
            lines.push(`${e.name}の攻撃は、1発${e.minPerHit}点までのものは無効化できる（一番大きい1発は${e.maxPerHit}点で通る）`);
          } else {
            lines.push(`${e.name}の攻撃は、一番小さい1発でも${e.minPerHit}点で、無効化は届かない`);
          }
        }
        if (ests.length === 0) lines.push('この敵の攻撃は、文面から1発分の大きさが読めなかった');
        rows.push({
          holderName: 'アスモデウスR',
          head: `最大HPの20%（${threshold}点）以下のダメージを無効化できる（第2特性）`,
          lines,
        });
      }
    }
    if (memberIds.has('祖25_グラシャラボラス') && specialOwnedOf('祖25_グラシャラボラス')) {
      const id = '祖25_グラシャラボラス';
      const stats = memberStatsOf(id);
      if (stats) {
        const lines = [];
        const slot = buildCtx.slots.find((s) => s && s.megidoId === id);
        const orb = slot && slot.orbId && orbsById ? orbsById.get(slot.orbId) : null;
        const auraRaces = auraOrbRacesFor(counterData.mechanicNotes, id, true) || [];
        if (!orb) {
          lines.push('オーブを付けていないため、伝説のオーラは付かない（対象は種族: 精霊・物体のオーブ）。付けた場合の目安:');
        } else if (!(orb.races || []).some((r) => auraRaces.includes(r))) {
          lines.push(`今のオーブ（種族: ${(orb.races || []).join('・') || 'なし'}）では伝説のオーラは付かない。対象は種族: 精霊・物体のオーブ。付け替えた場合の目安:`);
        }
        const ests = enemyAttackEstimates(stage.fact, stage.mult, stats.def);
        for (const e of ests) {
          const nMin = densetsuNeeded(stats.hp, e.minPerHit);
          const nMax = densetsuNeeded(stats.hp, e.maxPerHit);
          if (nMax === null || nMin === null) continue;
          if (nMax > DENSETSU_MAX) {
            lines.push(`${e.name}の攻撃は1発${e.minPerHit}〜${e.maxPerHit}点。一番大きい1発は、伝説${DENSETSU_MAX}個（上限）でも無効化できない`);
          } else if (nMin === nMax) {
            lines.push(`${e.name}の攻撃は1発${e.minPerHit}〜${e.maxPerHit}点。伝説${nMax}個で全て無効化できる`);
          } else {
            lines.push(`${e.name}の攻撃は1発${e.minPerHit}〜${e.maxPerHit}点。伝説${nMin}個で小さい攻撃まで、${nMax}個で大きい攻撃まで無効化できる`);
          }
        }
        if (ests.length === 0) lines.push('この敵の攻撃は、文面から1発分の大きさが読めなかった');
        rows.push({
          holderName: 'グラシャラボラス',
          head: `伝説のオーラ1個で${densetsuThreshold(stats.hp, 1)}点まで、${DENSETSU_MAX}個（上限）で${densetsuThreshold(stats.hp, DENSETSU_MAX)}点までのダメージを無効化できる`,
          lines,
        });
      }
    }
    if (rows.length === 0) return null;
    return {
      rows,
      premise: '乱数1・デバフなしで計算。敵の攻撃はスキル・覚醒スキル・奥義の1発分だけを数え（通常攻撃は数えていません）、味方のステータスは基礎と霊宝の固定値までです（オーブや特性の割合補正・クラス補正は数えていません）',
    };
  }

  // 受けダメージの見積もり（積4、2026-11-20）: 敵パーティと味方
  // 編成の両方が決まった時に、敵の攻撃を素で受けて落ちる味方が
  // いるかを見積もる。計算は mechanics.js の estimateFalls
  // （ダメージ計算の正本）。味方のステータスは基礎＋霊宝の固定値
  // （memberStatsOf）にコンディション補正（絶好調のHP・防御、
  // 不調・絶不調の開始HP）を掛けたもの。軽減は編成時点で固定の
  // ものだけ: 特性とオーブは生成データ（damage-reduction）の
  // 無条件の分、ME は実効ME（サブMEの上書き込み）の枠効果から
  // 無条件の軽減を読む。戦闘中に出る強化・弱体は含めない。
  const DAMAGE_ESTIMATE_PREMISE = '前提: 乱数は平均で固定。戦闘中の強化・弱体は含まず、かばうなしで素で受けた場合の見込みです（通常攻撃は材料が無いため数えていません）';

  function damageEstimateFor(fact, mult, slotsLike, derived) {
    if (!fact || !counterData) return null;
    const filled = [];
    slotsLike.forEach((s, index) => {
      if (s && s.megidoId) filled.push({ megidoId: s.megidoId, orbId: s.orbId || null, index });
    });
    if (filled.length === 0) return null;
    const leaderSlot = slotsLike[2];
    const effMe = leaderSlot && leaderSlot.megidoId
      ? effectiveLeaderMe(leaderSlot.megidoId, slotsLike) : null;
    const dr = counterData.dmgReduction;
    const allies = [];
    for (const s of filled) {
      const stage = derived.conditionOf(s.megidoId);
      if (stage >= STAGE_FAINTED) continue;
      const stats = memberStatsOf(s.megidoId);
      const b = byId.get(s.megidoId);
      if (!stats || !b) continue;
      const adj = conditionAdjustedStats(stats, stage);
      const reductions = [];
      for (const e of (dr && dr.megido ? dr.megido[s.megidoId] : null) || []) {
        if (e.needsReishou && !specialOwnedOf(s.megidoId)) continue;
        if (e.second && levelOf(s.megidoId) < 4) continue;
        reductions.push(e);
      }
      if (s.orbId && dr && dr.orbs) reductions.push(...(dr.orbs[s.orbId] || []));
      if (effMe) {
        reductions.push(...meDamageReductions(effMe,
          { style: b.style, className: b.class, gender: b.gender }, s.index));
      }
      allies.push({
        id: s.megidoId,
        name: b.name,
        hp: adj.hp,
        def: adj.def,
        row: b.class === 'スナイパー' ? 'back' : 'front',
        reductions,
      });
    }
    if (allies.length === 0) return null;
    return estimateFalls({ fact, mults: mult, allies });
  }

  // 攻撃の見積もり（A5 改訂、2026-11-26）: そのマスに置いた編成の
  // 味方が、敵にどれだけ通るかを見積もる。受けダメージの見積もり
  // と同じ前提の置き方（編成時点で固定のものだけを数え、戦闘中の
  // 強化・弱体は含めない）。味方のステータスは基礎＋霊宝の固定値
  // （memberStatsOf）。攻撃手段は能力原文から、敵の見積もりと
  // 同じ機械読み（parseEnemyAttackList）で読む: 味方全員を敵
  // パーティと同じ形に組んで渡し、地形・状態の組み合わせ補正も
  // 編成全体の文面で判定する。特効は本人の特性・装備オーブの
  // 特性・リーダーの ME の枠効果のうち編成時点で決まる分だけを、
  // 手段索引の via の文面から係数化して入れる（霊宝の装備数が
  // 条件の分は、装備が条件を満たす時だけ。戦闘中に付与される
  // 特効は含めない）。専用霊宝の形は、手段索引側の via では
  // 所持を条件に含める（軽減側の needsReishou と同じ扱い）。
  // 能力原文は loadAbility の遅延読みのため、シートを開いた時に
  // 編成の分だけ先読みしてキャッシュする（abilityCache）。
  // 前提の開示は、受けダメージ側（DAMAGE_ESTIMATE_PREMISE）の密度に
  // 揃えて短くする（2026-11-26 ペルソナ検品: 5行は長い）。中身は
  // 落とさない: 乱数の固定／攻撃力の範囲／入れる補正（クラス・特効）／
  // 含まないもの（割合補正・戦闘中の強化弱体）／数えないもの（通常
  // 攻撃・専用霊宝装備時の形・オーブの攻撃・装備数が条件を満たさ
  // ない特効＝満たす時だけ入れる、の裏返し）。
  // 敵シートでは、危険行動・攻撃の両節の前提を統合して末尾に1回
  // だけ置く（全体構成 問題14、2026-11-27）。共通要素（乱数は平均
  // で固定／戦闘中の強化・弱体は含まない）は1回にまとめ、節のある
  // 分だけを足す。要素の対応は次のとおり（欠落なし）:
  //   受け側（DAMAGE_ESTIMATE_PREMISE）: 乱数の固定→共通部／戦闘中
  //   の強化・弱体は含まず→共通部／かばうなしで素で受けた見込み→
  //   危険行動の文／通常攻撃は材料が無いため数えない→危険行動の文。
  //   攻撃側（旧 OUTGOING_ESTIMATE_PREMISE）: 乱数の固定→共通部／
  //   攻撃力は基礎と霊宝の固定値まで・クラス補正と編成時点で決まる
  //   特効は入れる・割合補正は含まない→攻撃の文／戦闘中の強化・
  //   弱体は含まない→共通部／数えないもの（通常攻撃・専用霊宝装備
  //   時の形・オーブの攻撃・装備数が条件を満たさない特効）→攻撃側
  //   で数えないもの、の文。
  function sheetEstimatePremise(hasDamage, hasOutgoing) {
    const parts = ['前提: 乱数は平均で固定し、戦闘中の強化・弱体は含みません'];
    if (hasDamage) {
      parts.push('危険行動に対する見積もりは、かばうなしで素で受けた場合の見込みです（通常攻撃は材料が無いため数えていません）');
    }
    if (hasOutgoing) {
      parts.push('攻撃の見積もりは、攻撃力を基礎と霊宝の固定値までとし、クラス補正と編成時点で決まる特効を入れています（特性やオーブの割合補正は含みません）');
      parts.push('攻撃側で数えないもの: 通常攻撃、専用霊宝装備時の形、オーブの攻撃、装備数が条件を満たさない特効');
    }
    return `${parts.join('。')}。`;
  }

  const abilityCache = new Map(); // megidoId → 能力データ（読めなければ null）
  const abilityPending = new Set();

  // シートの編成の能力原文を先読みする。届いたらシートを組み
  // 直す（キャッシュが埋まれば再読みは走らない）。
  function kickSheetAbilities() {
    const formation = sheetSimFormation();
    if (!formation) return;
    const gen = sheetCtx ? sheetCtx.gen : null;
    for (const s of formation.slots || []) {
      const id = s && s.megidoId;
      if (!id || abilityCache.has(id) || abilityPending.has(id)) continue;
      abilityPending.add(id);
      loader.loadAbility(id)
        .then((d) => { abilityCache.set(id, d || null); })
        .catch(() => { abilityCache.set(id, null); })
        .finally(() => {
          abilityPending.delete(id);
          if (sheetCtx && sheetCtx.gen === gen) renderSquareSheet();
        });
    }
  }

  function outgoingEstimateFor(fact, mult, slotsLike, derived) {
    if (!fact || !counterData || !counterData.index) return null;
    const filled = [];
    slotsLike.forEach((s, index) => {
      if (s && s.megidoId) filled.push({ megidoId: s.megidoId, orbId: s.orbId || null, index });
    });
    if (filled.length === 0) return null;
    const leaderSlot = slotsLike[2];
    const leaderId = leaderSlot && leaderSlot.megidoId ? leaderSlot.megidoId : null;
    const idx = counterData.index;
    const allies = [];
    const pseudoParty = [];
    for (const s of filled) {
      const b = byId.get(s.megidoId);
      const stats = memberStatsOf(s.megidoId);
      const ability = abilityCache.get(s.megidoId);
      if (!b || !stats || !ability || !ability.abilities) continue;
      const forms = pickAbilityForms(ability.abilities, {
        singularity: Boolean(b.singularity),
        singularityLevel: levelOf(s.megidoId),
        ougiLevel: ougiLevelOf(formationsData ? formationsData.megidoDetails : null, s.megidoId),
      });
      pseudoParty.push({
        name: s.megidoId,
        class: b.class,
        atk: stats.atk,
        def: stats.def,
        race: [],
        trait: forms.traitText,
        skills: {
          skill: forms.skill ? forms.skill.text : null,
          awakened: forms.awakenedSkill ? forms.awakenedSkill.text : null,
          ultimate: forms.ougi ? forms.ougi.text : null,
        },
      });
      allies.push({
        id: s.megidoId, name: b.name, className: b.class, index: s.index,
        orbId: s.orbId, forms, raceTokko: [], stateTokko: [],
        // 選んだ形の文面のどこかにダメージがあるか（ダメージの
        // 技そのものが無い味方と、文面から読めなかった味方を
        // 見積もりの表示で区別するため）。
        hasDamageText: [forms.skill, forms.awakenedSkill, forms.ougi]
          .some((f) => f && /ダメージ/.test(f.text || '')),
      });
    }
    if (allies.length === 0) return null;
    // 攻撃の機械読み（編成全体を1パーティとして渡すため、地形・
    // 状態の組み合わせは編成の文面全体で判定される）。
    const parsed = parseEnemyAttackList({ party: pseudoParty }, null);
    const kindKeyOf = { skill: 'skill', awakened: 'awakenedSkill', ultimate: 'ougi' };
    for (const ally of allies) {
      ally.attacks = parsed
        .filter((a) => a.attackerName === ally.id)
        .map((a) => {
          const form = ally.forms[kindKeyOf[a.kind]];
          return { ...a, skillName: form ? form.displayName : a.skillName };
        });
    }
    // 特効（編成時点で固定の分だけ）: 手段索引の bonus 系の via
    // から、本人の特性・装備オーブの特性・リーダーの ME を読む。
    const pushTokko = (ally, effectId, factor) => {
      if (effectId.startsWith('bonus:race:')) {
        ally.raceTokko.push({ race: effectId.slice('bonus:race:'.length), factor });
      } else if (effectId.startsWith('bonus:state:')) {
        ally.stateTokko.push({ state: effectId.slice('bonus:state:'.length), factor });
      }
    };
    const readTokkoEntries = (entries, ally, srcOk) => {
      // 装備数が条件の特効（「霊宝をNつ装備している場合、…」）の
      // 判定材料: その味方の通常霊宝の装備数（専用・絆は別の所持
      // 管理のため数に含まれない。reishou4Active と同じ数え方）と
      // 現在の凸（第2特性の via の解禁判定に使う）。
      const reishouCount = equipmentOf(ally.id).length;
      const level = levelOf(ally.id);
      for (const e of entries || []) {
        if (!e.effectId || !e.effectId.startsWith('bonus:')) continue;
        for (const v of e.via || []) {
          if (!srcOk(v)) continue;
          // 第2特性から導出した via は、凸で解禁されている時だけ
          // 材料にする（pickAbilityForms の第2特性の扱いに揃える）。
          if (v.form === '第二特性' && viaNeedLevel(v) > level) continue;
          const f = tokkoFactorFromSentence(v.sentence, reishouCount);
          if (typeof f === 'number') pushTokko(ally, e.effectId, f);
        }
      }
    };
    for (const ally of allies) {
      readTokkoEntries(idx.byMegido.get(ally.id), ally,
        (v) => v.src === 'trait' || (v.src === 'reishou' && specialOwnedOf(ally.id)));
      if (ally.orbId) {
        readTokkoEntries(idx.byOrb.get(ally.orbId), ally, (v) => v.src === 'trait');
      }
      if (leaderId) {
        const b = byId.get(ally.id);
        readTokkoEntries(idx.byMegidoMe.get(leaderId), ally, (v) => {
          if (v.src !== 'me') return false;
          const slotOk = v.slot === 'leader' ? ally.index === 2
            : Number(v.slot) === ally.index + 1;
          if (!slotOk) return false;
          return meConditionVerdict(v.condition || '', {
            style: b.style, className: b.class, gender: b.gender,
          }) === 'match';
        });
      }
    }
    // 状態特効は、編成がその状態を付けられる時だけ数える。
    const allTexts = [];
    for (const p of pseudoParty) {
      if (p.trait) allTexts.push(p.trait);
      for (const k of ['skill', 'awakened', 'ultimate']) {
        if (p.skills[k]) allTexts.push(p.skills[k]);
      }
    }
    const states = inflictableStates(allTexts);
    for (const ally of allies) {
      ally.stateTokko = ally.stateTokko.filter((t) => states.has(t.state));
    }
    return estimateOutgoing({ fact, mults: mult, allies });
  }

  // 編成エディタ側: 使うステージ（ターゲットの敵）が選ばれて
  // いる時だけ出す。
  function damageEstimateVm() {
    if (!buildCtx) return null;
    const stage = targetStageFact();
    if (!stage) return null;
    const slotsLike = buildCtx.slots.map((s) => (s
      ? { megidoId: s.megidoId || null, orbId: s.orbId || null } : { megidoId: null, orbId: null }));
    const est = damageEstimateFor(stage.fact, stage.mult, slotsLike, derive());
    if (!est) return null;
    return { premise: DAMAGE_ESTIMATE_PREMISE, enemyName: stage.fact.name, ...est };
  }

  // 編成に協奏・重奏の始動役がいるか（ピッカーの「音符発生」注記の
  // 前提、2026-11-20）。編集中の編成のメンバーで判定し、マス
  // エフェクトの始動はリーダー（枠3）の時だけ数える（トランス
  // 競合検出と同じ規則）。始動役がいなければ注記は一切出さない。
  function buildKyousouActive() {
    if (!counterData || !counterData.mechanicNotes || !buildCtx) return false;
    const memberIds = buildCtx.slots.map((s) => (s ? s.megidoId : null)).filter(Boolean);
    const leaderSlot = buildCtx.slots[2];
    return kyousouStarterInFormation(counterData.mechanicNotes, memberIds,
      leaderSlot ? leaderSlot.megidoId : null);
  }

  function renderSlotCandidates() {
    if (!buildCtx || buildCtx.slotIndex === null) return;
    buildCtx.view = 'slot';
    const derived = derive();
    const all = slotCandidates({
      megidoBasics,
      owned: derived.owned,
      conditionOf: derived.conditionOf,
      slots: buildCtx.slots,
      slotIndex: buildCtx.slotIndex,
    });
    const q = normalizeSearchText(buildCtx.query.trim());
    const rows = all.filter((r) => {
      if (buildCtx.styleFilter && r.style !== buildCtx.styleFilter) return false;
      if (buildCtx.classFilter && r.className !== buildCtx.classFilter) return false;
      if (q && !normalizeSearchText(r.name).includes(q)) return false;
      return true;
    });
    // 候補の注記（M6 の実質）: 索引由来の手段、このマスの脅威への対応、
    // この先の需要。材料が無い場合は注記自体を出さない。
    // このマスの脅威への対応は統合演算（pickerAnswersForEnemy）で引く
    // （敵シート作り直し、2026-11-20。従来は導出の脅威だけが材料で、
    // 著述のある敵でも導出で判定していた＝型8 の食い違い。新演算では
    // 著述の答え・種族特効も含み、耐性の適格と本人の凸も効く）。
    // 編成の文脈が無い入口のため、状態特効は付けない（従来どおり）。
    let answersById = null;
    // 印の理由（2026-11-25）: ラベルと同じ演算の根拠を候補ごとに
    // 寄せたもの（表示だけに使う。印の判定は answersById 側）。
    let answerReasonsById = null;
    if (counterData && sheetCtx && floorEnemies) {
      const fd = floorData(structure, sheetCtx.floor);
      const def = { floor: sheetCtx.floor, ...fd.squares[sheetCtx.squareId] };
      if (def.type === 'battle' || def.type === 'boss') {
        answersById = new Map();
        answerReasonsById = new Map();
        for (const name of def.enemies || []) {
          const fact = floorEnemies.enemies[name];
          if (!fact) continue;
          const raw = authoredEntryFor(tacticsData, name, def, sheetCtx.squareId);
          const ans = pickerAnswersForEnemy({
            fact, authored: raw, clsById: counterData.clsById,
            index: counterData.index, owned: null, levelOf,
            threatLevels: counterData.threatLevels,
            restricted: restrictionOf(def),
          });
          for (const [id, labels] of ans.megido) {
            if (!answersById.has(id)) answersById.set(id, new Set());
            for (const l of labels) answersById.get(id).add(l);
          }
          if (ans.reasons) {
            for (const [id, list] of ans.reasons.megido) {
              if (!answerReasonsById.has(id)) answerReasonsById.set(id, []);
              answerReasonsById.get(id).push(...list);
            }
          }
        }
      }
    }
    // ターゲットへの対応（追加要件）: ターゲットに決まった敵のギミックに
    // 対する候補を出す。SW92 からは、マスの脅威への対応と合わせて
    // ◇の印（markLabelsFor）に一本化した。
    const targetAnswers = buildCtx.targetEnemy ? targetAnswersById(derived) : null;
    const targetReasons = buildCtx.targetEnemy ? targetMegidoReasonsById(derived) : null;
    const targetHp = buildCtx.targetEnemy ? targetEnemyHp() : null;
    // ◇の印（SW92）: このマスの脅威への対応と、ターゲットへの対応の
    // ラベルを合わせたもの。行の印は先頭の根拠の具体名入り
    // （✓○○が有効、2026-11-27）で出し、理由は行の中に書く
    // （全体構成の決定 問題6、2026-11-26）。
    const markLabelsFor = (r) => {
      const labels = [];
      const hit = answersById ? answersById.get(r.id) : null;
      if (hit) for (const l of hit) if (!labels.includes(l)) labels.push(l);
      const tHit = targetAnswers ? targetAnswers.get(r.id) : null;
      if (tHit) for (const l of tHit) if (!labels.includes(l)) labels.push(l);
      return labels;
    };
    // ✓有効の理由の材料（2026-11-25）: ラベルと同じ2経路（この
    // マスの脅威への対応と、ターゲットへの対応）の根拠を合わせる。
    const markReasonsFor = (r) => {
      const list = [];
      const hit = answerReasonsById ? answerReasonsById.get(r.id) : null;
      if (hit) list.push(...hit);
      const tHit = targetReasons ? targetReasons.get(r.id) : null;
      if (tHit) list.push(...tHit);
      return list;
    };
    // 並び（全体構成の決定 問題6・案2、2026-11-26）: 候補は
    // slotCandidates の属性順（スタイル→クラス→コンディション→
    // 名前）のまま出す。印の件数で並べ替える優先表示（SW92）は
    // 廃止し、有効な候補は✓有効の印と行の中の理由で拾う形にした。
    // 候補を間引いて空の画面を作らない原則は従来どおり（全候補を
    // 出す）。
    // 案内（SW92）: 見出しの下に常時出す。「この枠に要るもの」では
    // なく、対象（敵）の脅威から要る手段を述べる形に組み直した
    // （組み直しの記録は hidden_files/editor-rework-work/completion.md）。
    // 脅威の名前は導出の脅威から引く（種族特効は除く）。
    const guideThreats = [];
    const guideEnemyNames = [];
    if (counterData) {
      const pushThreats = (fact) => {
        if (!fact) return;
        const { threats } = threatsForEnemy(fact, counterData.clsById);
        for (const t of threats) {
          if (t.threatId.startsWith('race:')) continue;
          const label = String(t.name || '').replace(/（敵）$/, '');
          if (label && !guideThreats.includes(label)) guideThreats.push(label);
        }
      };
      if (buildCtx.targetEnemy) {
        guideEnemyNames.push(buildCtx.targetEnemy);
        for (const { fe } of targetSquares()) {
          const fact = fe && fe.enemies ? fe.enemies[buildCtx.targetEnemy] : null;
          if (fact) { pushThreats(fact); break; }
        }
      } else if (sheetCtx && floorEnemies) {
        const fd = floorData(structure, sheetCtx.floor);
        const def = fd ? fd.squares[sheetCtx.squareId] : null;
        if (def && (def.type === 'battle' || def.type === 'boss')) {
          for (const name of def.enemies || []) {
            guideEnemyNames.push(name);
            pushThreats(floorEnemies.enemies[name]);
          }
        }
      }
    }
    // 音符発生の注記（2026-11-20）: 編成に協奏・重奏の始動役が
    // いる時だけ、音符を発生させる候補に付ける。始動役がいない
    // 編成では一切出さない。
    const kyousouActive = buildKyousouActive();
    const demand = currentDemand(derived);
    const noteLinesFor = (r) => {
      const lines = [];
      if (!counterData) return lines;
      const means = [
        ...(counterData.index.byMegido.get(r.id) || []),
        ...(counterData.index.byMegidoMe.get(r.id) || []),
      ];
      if (means.length > 0) {
        const meansText = means.slice(0, 4).map((m) => {
          const media = mediaShortForVia(m.via);
          return media ? `${m.effectName}（${media}）` : m.effectName;
        }).join('、');
        lines.push(`手段: ${meansText}${means.length > 4 ? `、ほか${means.length - 4}件` : ''}`);
      }
      const w = demandWeight(demand, r.id, sheetCtx ? sheetCtx.floor : derived.currentFloor);
      if (w > 0) lines.push('後の階で出番がある可能性あり: 次の回復マスまでのマスでも対策の候補になります');
      // 非直観的な仕組みの1行注記（該当する候補にだけ。検出は生成
      // データが担い、文面は mechanics.js。式は出さない）。
      lines.push(...mechanicNoteLines(counterData.mechanicNotes, r.id));
      // ターゲットが決まっている時だけ、点穴・エレキの候補に
      // 「この敵に届くか」を数で足す（M4 の著述側と同じ計算）。
      const keys = (counterData.mechanicNotes.notes || {})[r.id] || [];
      if (typeof targetHp === 'number') {
        if (keys.includes('tenana')) lines.push(...tenanaVsEnemyLines(targetHp));
        if (keys.includes('ereki')) lines.push(...erekiVsEnemyLines(targetHp));
      }
      // 編成時のメギド側の数（2026-11-20）: 点穴の上限と1発、
      // エレキ付与者の解除ダメージ、育て役のヒット数、剛剣の
      // 到達点、割合軽減の閾値。候補自身の装備・所持・凸で計算する
      // （霊宝はメギドに付くため、編成に入れる前でも同じ数になる）。
      const notesData = counterData.mechanicNotes;
      // 式用レベルは保存レベルによらず70固定（2026-11-20 ユーザー
      // 確定の分け方）。本人の保存レベルから formulaLevel を通して
      // 明示的に渡す（魔重で80にしていても式の中では70）。
      const formulaLv = formulaLevel(detailOf(formationsData.megidoDetails, r.id).level);
      if (keys.includes('tenana')) {
        lines.push(...tenanaHolderLines({
          megidoId: r.id,
          isshinBonus: isshinCapBonus(equippedReishouRows(r.id)),
          specialReishouOwned: specialOwnedOf(r.id),
          lv: formulaLv,
        }));
      }
      if (keys.includes('ereki')) lines.push(...erekiApplierLines(formulaLv));
      const grower = notesData.erekiGrowers && notesData.erekiGrowers.megido
        ? notesData.erekiGrowers.megido[r.id] : null;
      if (grower && (!grower.needsReishou || specialOwnedOf(r.id))) {
        const line = erekiGrowerLine(grower);
        if (line) lines.push(line);
      }
      if (keys.includes('gouken') && specialOwnedOf(r.id)) {
        const stats = memberStatsOf(r.id);
        const reach = (notesData.goukenReach || {})[r.id];
        if (stats && reach) lines.push(...goukenLines({ atk: stats.atk, reach }));
      }
      // アスモデウスRの第2特性（凸4で解禁される個人の仕組み）:
      // 最大HPの20%以下のダメージを無効化できる量。
      if (r.id === '祖32_アスモデウスR' && levelOf(r.id) >= 4) {
        const stats = memberStatsOf(r.id);
        if (stats) {
          const n = equipmentOf(r.id).length;
          const cond = n >= 4 ? '' : `（発動には専用霊宝以外の霊宝が4つ必要。今は${n}つ）`;
          lines.push(`第2特性: 最大HPの20%（${asmodeusThreshold(stats.hp)}点）以下のダメージを無効化できる${cond}`);
        }
      }
      // グラシャラボラスの伝説のオーラ（専用霊宝で付く個人の
      // 仕組み）: ダメージブロックの閾値を個数ごとに。
      if (r.id === '祖25_グラシャラボラス' && specialOwnedOf(r.id)) {
        const stats = memberStatsOf(r.id);
        if (stats) {
          lines.push(`伝説のオーラ: 1個で${densetsuThreshold(stats.hp, 1)}点まで、5個で${densetsuThreshold(stats.hp, 5)}点、10個で${densetsuThreshold(stats.hp, 10)}点、20個（上限）で${densetsuThreshold(stats.hp, 20)}点までのダメージを無効化できる（ダメージブロック）`);
        }
      }
      return lines;
    };
    // ME の行表示（M6、2026-11-19 訂正）: リーダーが決まっていて、
    // リーダー以外の枠の候補を見る時だけ、今選んでいる編成枠に
    // ついて、リーダーの主 ME の条件行（条件1・条件2・…）のうち
    // 候補が満たす行を「ME{n}をみたす（その枠・その行の効果）」で
    // 出す（meRowFits、照合は ME 要約と同じ規則）。他の編成枠の
    // 分は出さない（SW44 の各枠表示は、同じ条件が複数枠に現れて
    // 候補の行が膨らんだため廃止）。リーダーの枠のピッカーでは
    // 付けない（候補自身がリーダーになるため）。判定できない
    // 候補には付けない。
    const leaderMe = (() => {
      if (buildCtx.slotIndex === 2) return null;
      if (!counterData || !counterData.meData) return null;
      const leaderSlot = buildCtx.slots[2];
      if (!leaderSlot || !leaderSlot.megidoId) return null;
      const rec = counterData.meData.megido[leaderSlot.megidoId];
      return rec && rec.massEffect ? rec.massEffect : null;
    })();
    const vm = {
      swipeHint: !settings.swipeHintSeen,
      slotLabel: SLOT_LABELS[buildCtx.slotIndex] === 'リーダー'
        ? 'リーダーの枠'
        : `枠${SLOT_LABELS[buildCtx.slotIndex]}`,
      query: buildCtx.query,
      styleFilter: buildCtx.styleFilter,
      classFilter: buildCtx.classFilter,
      // 絞り込みアコーディオンの開閉（2026-11-25 再設計）: 再描画で
      // 状態を保つため文脈側に持つ。
      filterOpen: Boolean(buildCtx.slotFilterOpen),
      // 案内行（SW92）: 対象と、その敵の脅威。見出しの下に常時出す。
      guide: {
        targetText: buildCtx.targetEnemy ? targetTextOf() : null,
        enemyLabel: guideEnemyNames.join('・'),
        threats: guideThreats,
        prioritized: Boolean(answersById || targetAnswers),
      },
      rows: rows.map((r) => {
        // 候補にも実効素早さの数値を出す（編成が決まらない場面の
        // 補正範囲は M4 の候補と同じ: 特性・霊宝・コンディション）。
        const spd = effSpdStandalone(r.id, r.stage);
        const basics = byId.get(r.id);
        const marks = markLabelsFor(r);
        const answerReasons = markReasonsFor(r);
        const fits = leaderMe && basics
          ? meRowFits(leaderMe, ME_SLOT_KEYS[buildCtx.slotIndex],
            { style: r.style, className: r.className, gender: basics.gender })
            .map((f) => ({ label: `ME${f.row}`, effectText: f.effect }))
          : [];
        return {
          ...r,
          stageText: CONDITION_STAGES[r.stage],
          spdText: typeof spd === 'number' ? `素早さ${spd}` : '',
          meFits: fits,
          marks: marks.slice(0, 3),
          marksMore: Math.max(0, marks.length - 3),
          noteMark: kyousouActive && counterData
            ? isNoteMakerMegido(counterData.mechanicNotes, r.id) : false,
          noteLines: noteLinesFor(r),
          // 印の理由（2026-11-25 に材料化、2026-11-26 問題6で
          // 行の中に書く形へ）: ✓有効は ME 適合と対策の根拠、
          // 出番ありは需要のマス情報から組む（階つきで具体的に）。
          validReasons: [
            ...meFitReasonLines(fits),
            ...answerReasonLines(answerReasons),
          ],
          // 印の文言の材料（2026-11-27 マスター指示）: ✓の印は
          // 先頭の根拠の具体名入り「✓○○が有効」にし、出番の
          // チップは最も近い階入り「{N}階で出番の可能性」にする。
          // 具体名が取れない候補（ME 適合だけ等）は validMark が
          // null になり、印自体を出さない（理由行が根拠を担う）。
          validMark: answerMarkLabel(answerReasons),
          demandFloor: demand
            ? demandEarliestFloor(demand, r.id,
              sheetCtx ? sheetCtx.floor : derived.currentFloor)
            : null,
          demandReasons: demand
            ? demandReasonLines(demand, r.id,
              sheetCtx ? sheetCtx.floor : derived.currentFloor)
            : [],
        };
      }),
      shownCount: rows.length,
      totalCount: all.length,
      slotFilled: Boolean(buildCtx.slots[buildCtx.slotIndex].megidoId),
    };
    const { top, content, searchInput } = buildSlotCandidates(vm, slotCandidateCallbacks);
    overlay.openFull(content, {
      top, scrollKey: `build:${buildCtx.gen}:slot:${buildCtx.slotIndex}`,
      // ピッカー表示中の「閉じる」は、このピッカーだけを閉じて編成に
      // 戻る（編成全体は閉じない）。文言も「戻る」で区別する。
      onCloseRequest: () => { if (buildCtx) renderBuilder(); },
    });
    if (buildCtx.focusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    buildCtx.focusSearch = false;
  }

  function renderOrbPicker() {
    if (!buildCtx || buildCtx.slotIndex === null) return;
    buildCtx.view = 'orb';
    const slot = buildCtx.slots[buildCtx.slotIndex];
    const member = slot.megidoId ? byId.get(slot.megidoId) : null;
    if (!member) { renderBuilder(); return; }
    const all = orbsById ? [...orbsById.values()] : [];
    // 装備できないオーブはそもそも出さない（606件のカタログでは、付け
    // られないものを並べること自体がノイズになるというマスター判断）。
    // 装備可否の判定は orbEquippableBy（スタイル条件と専用オーブの規則）。
    const equippable = all.filter((o) => orbEquippableBy(o, member));
    // 種族チップは組み合わせ文字列ではなく個別の種族で作る
    // （オーブ側の races は生成時に分解済み。フィルタは含む判定）。
    const races = [...new Set(equippable.flatMap((o) => o.races || []))].sort();
    // 素早さの敵比較（2026-11-19）: 使うステージを選んでいる時だけ、
    // 付け替えの判断がその場でできる材料を出す。メンバーの現在の
    // 実効素早さと、対象の敵全員の素早さ（マスルール込み）。数値は
    // 編成エディタの枠・タイムテーブルと同じ実効素早さで揃える。
    const derived = derive();
    const memberStage = derived.conditionOf(slot.megidoId);
    // ターゲットへの対応（2026-11-20）: ターゲットに決まった敵に
    // 有効なオーブには、メギドのピッカーと同じ根拠つきの印を出す
    // （材料は targetAnswersBoth で共通。従来オーブ側には印の経路
    // 自体が無く、種族特効のオーブにも印が付かなかった）。
    const orbAnswers = buildCtx.targetEnemy ? targetOrbAnswersById(derived) : null;
    // 印の理由（2026-11-25 に材料化、2026-11-26 問題6で行の中に
    // 書く形へ）: ラベルと同じ演算の根拠（表示だけ）。
    const orbReasons = buildCtx.targetEnemy ? targetOrbReasonsById(derived) : null;
    // オーラ対応の印（2026-11-20）: このメンバーがオーラ持ちなら、
    // そのオーラが指定する種族に合うオーブへ印を付ける。指定種族は
    // 専用霊宝の所持で変わる者がいるため、所持は解決関数
    // （resolveSpecialReishou: 基礎データに専用霊宝があり、解決後の
    // 値が「あり」）で見る。
    const memberDetail = formationsData && formationsData.megidoDetails
      ? formationsData.megidoDetails[member.id] : null;
    const memberAuraRaces = counterData ? auraOrbRacesFor(
      counterData.mechanicNotes, member.id,
      resolveSpecialReishou(memberDetail, Boolean(member.specialReishou)),
    ) : null;
    // 音符発生の注記（2026-11-20）: メギドのピッカーと同じ前提
    // （編成に協奏・重奏の始動役がいる時だけ）。
    const kyousouActive = buildKyousouActive();
    const memberSpdR = effSpdInFormation(
      slot.megidoId, buildCtx.slotIndex, buildCtx.slots, memberStage);
    const spdEnemies = targetSquareEnemies();
    // 31階の制限ターゲットでは敵最速との関係文・文脈行を付けない
    // （Lv70 前提の対比になるため。霊宝ピッカーと同じ扱い）。
    const spdCmp = memberSpdR && !targetRestricted() ? compareSpeeds({
      allies: [{ name: member.name, spd: memberSpdR.value }],
      enemies: spdEnemies,
    }) : null;
    // 素早さ補正を持つオーブだけ、付けた後の値を計算する（補正の
    // 無いオーブは値を変えないため、行に出す意味が無い）。
    const spdAfterOf = (orbId) => {
      const rec = orbId && counterData && counterData.speedCorr
        ? counterData.speedCorr.orbs[orbId] : null;
      if (!rec || !rec.pctMax) return null;
      const trial = buildCtx.slots.map(
        (s, i) => (i === buildCtx.slotIndex ? { ...s, orbId } : s));
      const r = effSpdInFormation(slot.megidoId, buildCtx.slotIndex, trial, memberStage);
      return r ? r.value : null;
    };
    // 絞り込みの選択肢は、装備できる範囲に在るものだけを出す
    // （種族チップと同じ作法）。CT は数値の昇順、効果種類は正本の順。
    const cts = [...new Set(equippable.map((o) => o.ct).filter((v) => typeof v === 'number'))]
      .sort((a, b) => a - b);
    const kindsPresent = new Set(equippable.flatMap((o) => o.kinds || []));
    const kinds = orbsKindOrder.filter((k) => kindsPresent.has(k));
    const q = normalizeSearchText(buildCtx.orbQuery.trim());
    const rows = equippable.filter((o) => {
      if (buildCtx.orbRace && !(o.races || []).includes(buildCtx.orbRace)) return false;
      if (buildCtx.orbCt !== null && buildCtx.orbCt !== undefined && o.ct !== buildCtx.orbCt) return false;
      if (buildCtx.orbKind && !(o.kinds || []).includes(buildCtx.orbKind)) return false;
      if (q) {
        // 検索は名前・種族に加えて効果文（特性・スキル）も対象にする。
        const hit = [o.name, o.race || '', o.trait || '', o.skill || '']
          .some((t) => normalizeSearchText(t).includes(q));
        if (!hit) return false;
      }
      return true;
    }).map((o) => {
      const meta = [
        o.condition ? `装備条件: ${o.condition}` : '',
        o.race ? `種族: ${o.race}` : '',
        typeof o.ct === 'number' ? `CT${o.ct}` : '',
      ].filter(Boolean).join('／');
      const isCurrent = slot.orbId === o.id;
      const after = isCurrent ? null : spdAfterOf(o.id);
      const oHit = orbAnswers ? orbAnswers.get(o.id) : null;
      // オーラの対象に合う種族（オーブが複数種族を持つ場合は合う
      // 分だけを併記する）。対象が空・非該当なら印は付けない。
      const auraMatched = memberAuraRaces && memberAuraRaces.length > 0
        ? (o.races || []).filter((r) => memberAuraRaces.includes(r)) : [];
      // エレキを育てるオーブのヒット数（2026-11-20）: 効果文の
      // 並びに足し、雷の多段である理由がその場で分かるようにする。
      const erekiOrbLine = counterData && counterData.mechanicNotes
        && counterData.mechanicNotes.erekiGrowers
        ? erekiGrowerOrbLine(counterData.mechanicNotes.erekiGrowers.orbs[o.id])
        : null;
      return {
        id: o.id,
        name: o.name,
        meta,
        // 行の固定配置の材料（2026-11-25 再設計）: CT は右端固定、
        // 素早さの結果は現在値と付けた後の数値で「速○○→○○」にする。
        ct: typeof o.ct === 'number' ? o.ct : null,
        spdNow: memberSpdR ? memberSpdR.value : null,
        spdAfter: after,
        targetMark: oHit && oHit.length > 0 ? targetMarkText(oHit) : null,
        targetReasons: orbReasons
          ? answerReasonLines(orbReasons.get(o.id) || [], { orb: true }) : [],
        auraMark: auraMatched.length > 0
          ? `オーラの対象（種族: ${auraMatched.join('・')}）` : null,
        noteMark: kyousouActive && counterData
          ? isNoteMakerOrb(counterData.mechanicNotes, o.id) : false,
        // 効果文をそのまま出す（効果検索で当たった理由がその場で分かる）。
        effectLines: [
          o.trait ? `特性: ${o.trait}` : '',
          o.skill ? `スキル: ${o.skill}` : '',
          erekiOrbLine || '',
        ].filter(Boolean),
        isCurrent,
        spdAfterText: spdSwapText('付けると', after, spdCmp),
        spdAfterDir: after === null ? null : spdDirOf(after, memberSpdR ? memberSpdR.value : null),
      };
    });
    rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // 現在のオーブに素早さ補正がある場合だけ、外した後の値も出す。
    const spdWithoutOrb = slot.orbId ? (() => {
      const rec = counterData && counterData.speedCorr
        ? counterData.speedCorr.orbs[slot.orbId] : null;
      if (!rec || !rec.pctMax) return null;
      const trial = buildCtx.slots.map(
        (s, i) => (i === buildCtx.slotIndex ? { ...s, orbId: null } : s));
      const r = effSpdInFormation(slot.megidoId, buildCtx.slotIndex, trial, memberStage);
      return r ? r.value : null;
    })() : null;
    const vm = {
      memberName: member.name,
      memberStyle: member.style,
      query: buildCtx.orbQuery,
      races,
      raceFilter: buildCtx.orbRace,
      cts,
      ctFilter: buildCtx.orbCt,
      kinds,
      kindFilter: buildCtx.orbKind,
      filterOpen: Boolean(buildCtx.orbFilterOpen),
      // トップ2行目の「オーブを外す」の有効・無効（未装備では
      // 塗りつぶされてボタンでなくなる。2026-11-25 再設計）。
      hasOrb: Boolean(slot.orbId),
      rows,
      shownCount: rows.length,
      totalCount: equippable.length,
      spdContext: spdCmp ? {
        memberName: member.name,
        ...spdDisplayOf(memberSpdR),
        enemies: spdEnemies.filter((e) => typeof e.spd === 'number').map((e) => {
          // 敵の素早さはタイムラインと同じ形（変わった値には矢印＋
          // 方向色。2026-11-26、変化表記の統一 #5）。
          const es = enemySpdTextOf(e.spd, e.baseSpd, e.mult);
          return { name: e.name, spdText: es.text, spdDir: es.dir };
        }),
        fastestText: enemyFastestText(spdCmp),
        verdictText: memberSpdR.value > spdCmp.fastestSpd
          ? '敵最速より速い'
          : memberSpdR.value === spdCmp.fastestSpd ? '敵最速と同速' : '敵最速より遅い',
        // トップ2行目の結論1行の材料（2026-11-25 再設計）: 数値で渡す。
        fastestSpd: spdCmp.fastestSpd,
        memberSpd: memberSpdR.value,
      } : null,
      noneSpdAfterText: spdSwapText('外すと', spdWithoutOrb, spdCmp),
      noneSpdAfterDir: spdWithoutOrb === null
        ? null : spdDirOf(spdWithoutOrb, memberSpdR ? memberSpdR.value : null),
    };
    const { top, content, searchInput } = buildOrbPicker(vm, orbPickerCallbacks);
    overlay.openFull(content, {
      top, scrollKey: `build:${buildCtx.gen}:orb:${buildCtx.slotIndex}`,
      onCloseRequest: () => { if (buildCtx) renderBuilder(); },
    });
    if (buildCtx.orbFocusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    buildCtx.orbFocusSearch = false;
  }

  async function saveFormation() {
    const ctx = buildCtx;
    if (!ctx) return;
    if (!canSaveFormation(ctx.slots)) return; // 中央が空の編成は保存できない
    const slots = ctx.slots.map((s) => ({
      megidoId: s.megidoId || null,
      orbId: s.orbId || null,
      // 枠の reishouIds は保存時点の装備のスナップショット（旧形式との
      // 互換と種付け用）。読み側は常にメギドの装備を正とする。
      reishouIds: s.megidoId ? equipmentOf(s.megidoId) : [],
      leaderSkill: s.leaderSkill || '',
    }));
    // ターゲット（敵・階）とタグ: 自動タグは保存のたびに作り直し、
    // カスタムタグだけが入力として残る（現行ツールの規則。棚卸し 5-6）。
    const enemyName = ctx.targetEnemy || '';
    const floors = [...ctx.targetFloors].sort((a, b) => a - b);
    const tags = buildFormationTags({
      slots, byId, enemyName, floors, structure,
      customTexts: parseCustomTags(ctx.customTags),
    });
    // 自動命名: 名前が空で敵と階があれば「{階}F {敵名}用編成」、
    // 無ければリーダー名＋「編成」（現行ツールと同じ規則）。
    const name = ctx.name.trim() || autoFormationName({
      slots, byId, enemyName, floors,
    });
    const notes = ctx.notes;
    let savedId;
    if (ctx.mode === 'edit') {
      const old = formationsData.formations.find((f) => f.id === ctx.id);
      if (!old) return;
      const record = { ...old, name, slots, tags, notes, enemyName, floors };
      formationsData = {
        ...formationsData,
        formations: formationsData.formations.map((f) => (f.id === ctx.id ? record : f)),
      };
      savedId = ctx.id;
    } else {
      savedId = newFormationId();
      const record = {
        id: savedId, name, tags, notes, enemyName, floors,
        reishouReminder: null, slots,
      };
      formationsData = { ...formationsData, formations: [...formationsData.formations, record] };
    }
    await saveFormationsData(backend, formationsData);
    const mode = ctx.mode;
    const returnToSheet = ctx.returnToSheet;
    // 戻り先は、編成を組む画面を開いた文脈で決める: 戦闘シートから選択
    // モードの一覧を経て作った新規だけが M8 の確認表示へ戻る。管理モード
    // （下部バーの「編成」から）で作った場合は一覧へ戻る。スタートマスの
    // 階概要から作った場合は、そのマスのシートへ戻る。
    const viaSelectList = Boolean(listCtx && listCtx.mode === 'select');
    buildCtx = null;
    if (returnToSheet && sheetCtx) {
      overlay.closeFull();
      renderSquareSheet();
    } else if (mode === 'new' && sheetCtx && viaSelectList) {
      // 新規は、マスのシートへ戻ってそのまま確認表示（M8）に入る（ui-flow の M6）。
      setSheetFormation(savedId);
      sheetCtx.postResult = null;
      overlay.closeFull();
      renderSquareSheet();
    } else {
      renderFormationList();
    }
  }

  // シミュレーターの実行環境（SW95）: エディタ側。マスシート側は
  // sheetSimsVm の近くに置いてある（sheetHbombEnv / sheetKyoenEnv）。
  const editorHbombEnv = {
    state: () => buildCtx,
    context: () => hbombContext(),
    sigParts: () => (buildCtx ? [buildCtx.targetEnemy, buildCtx.targetFloors] : []),
    rerender: () => renderBuilder(),
  };

  const editorKyoenEnv = {
    state: () => buildCtx,
    context: () => kyoenContext(),
    slots: () => (buildCtx ? buildCtx.slots : []),
    sigParts: () => (buildCtx ? [buildCtx.targetEnemy, buildCtx.targetFloors] : []),
    rerender: () => renderBuilder(),
  };

  // Hボムプランナーの操作（エディタとマスシートで共用、SW95）。
  function makeHbombHandlers(env) {
    return {
      onHbombMode: (mode) => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        holder.hbomb.mode = mode;
        env.rerender();
      },
      onHbombTarget: (index) => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        holder.hbomb.target = index;
        env.rerender();
      },
      onHbombRenAction: (memberId, actionKey) => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        const ctx = env.context();
        if (!ctx) return;
        const st = holder.hbomb;
        const actx = memberActions(ctx.data, ctx.members.find((m) => m.id === memberId) || {})
          .find((c) => c.action.key === actionKey);
        if (!actx) return;
        const next = applyAction(st.field, actx, st.target, 0);
        if (next) st.field = next;
        env.rerender();
      },
      onHbombRemoveBomb: (enemyIdx, bombIdx) => {
        const holder = env.state();
        if (!holder || !holder.hbomb || !holder.hbomb.field) return;
        holder.hbomb.field = removeBomb(holder.hbomb.field, enemyIdx, bombIdx);
        env.rerender();
      },
      onHbombDebuffs: (enemyIdx) => {
        openHbombDebuffPopup(env, enemyIdx);
      },
      onHbombAddHand: (memberId, actionKey) => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        holder.hbomb.hands = [...holder.hbomb.hands, {
          memberId, actionKey, target: holder.hbomb.target,
        }];
        env.rerender();
      },
      onHbombRemoveHand: (index) => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        holder.hbomb.hands = holder.hbomb.hands.filter((_, i) => i !== index);
        env.rerender();
      },
      onHbombTurn: (turn) => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        holder.hbomb.detonateTurn = turn;
        env.rerender();
      },
      onHbombOmakase: () => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        const ctx = env.context();
        if (!ctx) return;
        const st = holder.hbomb;
        if (st.mode === 'ren') {
          const sol = solveComposition(ctx.data, ctx.members, ctx.enemies);
          st.field = sol.field;
        } else {
          const rctx = buildReplayCtx(ctx.data, ctx.members, ctx.enemies, {
            meGaugeMembers: hbombMeGaugeMembers(ctx.members),
            secretGaugeOf: hbombSecretGauges(ctx.members),
          });
          const sol = solveSequence(rctx, st.detonateTurn);
          st.hands = sol.hands;
        }
        env.rerender();
      },
      onHbombReset: () => {
        const holder = env.state();
        if (!holder || !holder.hbomb) return;
        const ctx = env.context();
        if (!ctx) return;
        holder.hbomb.field = emptyField(ctx.enemies);
        holder.hbomb.hands = [];
        env.rerender();
      },
    };
  }

  // 狂炎シミュレーターの操作（エディタとマスシートで共用、SW95）。
  function makeKyoenHandlers(env) {
    return {
      onKyoenTarget: (index) => {
        const holder = env.state();
        if (!holder || !holder.kyoen) return;
        holder.kyoen.target = index;
        env.rerender();
      },
      onKyoenEnjou: (uid) => {
        const holder = env.state();
        if (!holder || !holder.kyoen) return;
        const ctx = env.context();
        const ch = ctx ? ctx.choices.get(uid) : null;
        if (ch && ch.action.allocMax !== undefined) {
          openKyoenAllocPopup(env, 'setup', uid);
          return;
        }
        holder.kyoen.enjouUid = uid;
        holder.kyoen.setupAlloc = null;
        holder.kyoen.sim = null;
        env.rerender();
      },
      onKyoenConvert: (uid) => {
        const holder = env.state();
        if (!holder || !holder.kyoen) return;
        holder.kyoen.convertUid = uid;
        holder.kyoen.sim = null;
        env.rerender();
      },
      onKyoenFire: (uid) => {
        const holder = env.state();
        if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
        const st = holder.kyoen;
        const ctx = env.context();
        if (!ctx) return;
        const ch = ctx.choices.get(uid);
        if (!ch) return;
        if (ch.action.form && ch.action.form !== kyoenFormOf(st.sim, ch.member.id)) return;
        if (ch.action.shiftAfterText && kyoenSkillShifted(st.sim, ch.member.id)) return;
        // 反撃（フェニックスCの覚醒スキル）: 対象は攻撃してきた
        // 敵なので、ポップアップで誰に反撃したかを選ばせる。
        if (ch.action.counter) {
          openKyoenCounterPopup(env, uid);
          return;
        }
        // 対象ランダムの多段行動は、実際に当たった回数を割り
        // 振らせる（K2 の方針。チェーンの割り振りと同じ作法）。
        if (ch.action.allocMax !== undefined) {
          openKyoenAllocPopup(env, 'fire', uid);
          return;
        }
        const ra = kyoenUse(st.sim, { ...ch.action, levelKey: uid });
        const engineAction = {
          range: ra.range,
          hits: ra.hits !== undefined ? ra.hits : ch.fireHits,
          dmgMult: ra.dmgMult,
          atk: ch.member.atk,
          attackerClass: ch.member.className,
          terrainBonus: ra.terrainBonus || 1,
          extend: ra.extend || 0,
          // 遅延行動の反復回数の材料として、誰の火かを持たせる。
          actorId: ch.member.id,
        };
        if (ch.action.reserve) {
          kyoenRegisterReserve(st.sim, {
            uid: ch.uid,
            label: `${ch.member.name} ${ch.action.medium}「${ch.action.name}」`,
            turns: ch.action.reserve.turns,
            action: engineAction,
            targetIdx: st.target,
          });
        } else {
          kyoenApplyFire(st.sim, engineAction, st.target);
        }
        if (ra.shiftTo) kyoenShift(st.sim, ch.member.id, ra.shiftTo);
        env.rerender();
      },
      onKyoenRelay: (uid) => {
        const holder = env.state();
        if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
        const st = holder.kyoen;
        const ctx = env.context();
        if (!ctx) return;
        const ch = ctx.choices.get(uid);
        if (!ch || ch.action.type !== 'enjou') return;
        if (ch.action.form && ch.action.form !== kyoenFormOf(st.sim, ch.member.id)) return;
        if (ch.action.allocMax !== undefined) {
          openKyoenAllocPopup(env, 'relay', uid);
          return;
        }
        const ra = kyoenUse(st.sim, { ...ch.action, levelKey: uid });
        const res = kyoenApplyOverwrite(st.sim, {
          range: ra.range,
          mult: ra.mult,
          duration: ra.duration,
          dmgMult: ra.dmgMult,
          dmgHits: ra.dmgHits || 0,
          atk: ch.member.atk,
          attackerClass: ch.member.className,
        }, st.target);
        st.lastEvent = res.overwritten
          ? `敷き直し: 上書きした（${res.reason}）。倍率${ra.mult}・持続${ra.duration}ターンになった`
          : `敷き直し: 上書きしなかった（${res.reason}）`;
        if (ra.shiftTo) kyoenShift(st.sim, ch.member.id, ra.shiftTo);
        env.rerender();
      },
      onKyoenGround: (uid) => {
        const holder = env.state();
        if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
        const st = holder.kyoen;
        const ctx = env.context();
        if (!ctx) return;
        const ch = ctx.choices.get(uid);
        if (!ch || ch.action.type !== 'ground') return;
        const sim = st.sim;
        const targetName = sim.enemies[st.target] ? sim.enemies[st.target].name : '';
        const res = kyoenApplyGround(sim, {
          turns: ch.action.turns,
          dmgMult: ch.action.dmgMult,
          dmgHits: ch.action.dmgHits || 1,
          atk: ch.member.atk,
          attackerClass: ch.member.className,
        }, st.target);
        st.lastEvent = res.grounded
          ? `撃墜: ${targetName}は地形の対象になった（${ch.action.turns}ターン）`
          : res.targetFlying
            ? `撃墜: ${targetName}は地形の範囲外（または地形が切れている）ため地形の対象にならない`
            : `撃墜: ${targetName}は飛行していない`;
        env.rerender();
      },
      // 遅延行動（ナベリウスBの覚醒スキル）: ボタンでそのターンの
      // 予約を立て、もう一度押すと取り消す。対象は押した時点で
      // 選択中の敵（予約の立て直しで変えられる）。
      onKyoenDelayed: (uid) => {
        const holder = env.state();
        if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
        const st = holder.kyoen;
        const ctx = env.context();
        if (!ctx) return;
        const ch = ctx.choices.get(uid);
        if (!ch || ch.action.type !== 'delayed') return;
        const sim = st.sim;
        if (sim.delayed && sim.delayed.uid === uid) {
          kyoenDisarmDelayed(sim);
          st.lastEvent = `遅延行動: ${ch.action.name}の予約を取り消した`;
        } else {
          kyoenArmDelayed(sim, {
            uid,
            actorId: ch.member.id,
            label: `${ch.member.name} ${ch.action.medium}「${ch.action.name}」`,
            mult: ch.action.mult,
            atk: ch.member.atk,
            attackerClass: ch.member.className,
            targetIdx: st.target,
            countSource: ch.action.countSource,
            maxReps: ch.action.maxReps,
          });
          st.lastEvent = `遅延行動: ${ch.action.name}を予約（次のターンの開始時に発動）`;
        }
        env.rerender();
      },
      // スキルのシフト（バティンBの覚醒スキル）: 使うとその
      // メンバーのスキルがシフト後の形に切り替わり、火として
      // 使えなくなる。シフトはターン巻き戻しで戻る。
      onKyoenShift: (uid) => {
        const holder = env.state();
        if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
        const st = holder.kyoen;
        const ctx = env.context();
        if (!ctx) return;
        const ch = ctx.choices.get(uid);
        if (!ch || ch.action.type !== 'shift') return;
        const sim = st.sim;
        if (kyoenSkillShifted(sim, ch.member.id)) return;
        kyoenApplySkillShift(sim, ch.member.id);
        st.lastEvent = `シフト: ${ch.member.name}のスキルがシフトした（火ではなくなった）`;
        env.rerender();
      },
      onKyoenEndTurn: () => {
        const holder = env.state();
        if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
        const st = holder.kyoen;
        const sim = st.sim;
        kyoenEndTurn(sim);
        if (sim.lastRevive) {
          const r = sim.lastRevive;
          st.lastEvent = `蘇生: ${r.name}が蘇生した${r.shifted ? '（シフト）' : ''}`;
          sim.lastRevive = null;
        }
        if (sim.delayedReport) {
          const rep = sim.delayedReport;
          const targetName = sim.enemies[rep.targetIdx] ? sim.enemies[rep.targetIdx].name : '';
          st.lastEvent = `遅延行動: ${rep.label}が発動（${targetName}に${rep.reps}回分）`;
          sim.delayedReport = null;
        }
        env.rerender();
      },
      onKyoenUndo: () => {
        const holder = env.state();
        if (!holder || !holder.kyoen || !holder.kyoen.sim) return;
        kyoenUndo(holder.kyoen.sim);
        env.rerender();
      },
      onKyoenReset: () => {
        const holder = env.state();
        if (!holder || !holder.kyoen) return;
        const st = holder.kyoen;
        st.enjouUid = null;
        st.convertUid = null;
        st.sim = null;
        st.lastEvent = null;
        st.setupAlloc = null;
        st.allocPopup = null;
        env.rerender();
      },
    };
  }

  const builderCallbacks = {
    onCustomTagsChange: (text) => { if (buildCtx) buildCtx.customTags = text; },
    onNotesChange: (text) => { if (buildCtx) buildCtx.notes = text; },
    onOpenEnemyPicker: () => {
      if (!buildCtx) return;
      buildCtx.pickingEnemy = true;
      buildCtx.enemyQuery = '';
      renderEnemyPicker();
    },
    onToggleTargetFloor: (floor) => {
      if (!buildCtx) return;
      buildCtx.targetFloors = buildCtx.targetFloors.includes(floor)
        ? buildCtx.targetFloors.filter((f) => f !== floor)
        : [...buildCtx.targetFloors, floor];
      renderBuilder();
    },
    onSlotTap: (index) => {
      if (!buildCtx) return;
      buildCtx.slotIndex = index;
      buildCtx.query = '';
      buildCtx.styleFilter = null;
      buildCtx.classFilter = null;
      renderSlotCandidates();
    },
    onOrbTap: (index) => {
      if (!buildCtx) return;
      buildCtx.slotIndex = index;
      buildCtx.orbQuery = '';
      buildCtx.orbRace = null;
      buildCtx.orbCt = null;
      buildCtx.orbKind = null;
      renderOrbPicker();
    },
    onReishouTap: (index) => {
      if (!buildCtx) return;
      const slot = buildCtx.slots[index];
      if (!slot || !slot.megidoId) return;
      buildCtx.slotIndex = index;
      // 付け外しの対象は枠ではなく、その枠のメギドの装備。
      openReishouPicker(slot.megidoId, {
        scrollKey: `build:${buildCtx.gen}:reishou:${index}`,
        onDone: () => {
          if (!buildCtx) return;
          buildCtx.slotIndex = null;
          renderBuilder();
        },
      });
    },
    // 保存ボタンは直接保存せず、「編成名を決める」段へ進む
    // （2026-11-20 ユーザー指示）。保存の完了は段の確定で行う。
    onSave: () => { if (buildCtx) renderNameStep(); },
    onCancel: () => {
      const returnToSheet = buildCtx && buildCtx.returnToSheet;
      buildCtx = null;
      if (returnToSheet && sheetCtx) {
        overlay.closeFull();
        renderSquareSheet();
      } else {
        renderFormationList();
      }
    },
    // 敵の小帯のタップ（SW92）: マスから入った編成だけ、マスシートへ
    // 戻る。編集中の内容は「やめる」と同じく破棄される（帯はマスから
    // 入った場合だけボタンになる。vm.target.bandTappable）。
    onBandTap: () => {
      if (!buildCtx || !buildCtx.returnToSheet || !sheetCtx) return;
      buildCtx = null;
      overlay.closeFull();
      renderSquareSheet();
    },
    // チェインのテスト（2026-11-19、2026-11-20 手組み追加）:
    // タイムテーブルの味方タップで起点を決める。チェインテーブル
    // の行動は、フォトンのタップで行動を変え（ポップアップ）、
    // ×ボタンでその回を外す。確率の形には「？」の印が付き、
    // タップで無視（×）にできる。状態は保存しない。起点に
    // なれない味方は、理由を区画に出す。
    onChainOrigin: (id) => {
      if (!buildCtx || !counterData || !counterData.chainData) return;
      const test = buildCtx.chainTest || (buildCtx.chainTest = newChainTest());
      const slot = buildCtx.slots.find((s) => s.megidoId === id);
      const elig = chainOriginEligibility(slot ? chainRecordOf(slot) : null, {
        partyHasGrant: chainPartyGrant(),
        specialReishou: chainSpecialReishouOf(id),
        ignoredProb: test.ignoredProb || [],
      });
      if (elig.ok) {
        test.originId = id;
        test.skipped = [];
        test.overrides = {};
        test.error = null;
      } else {
        const b = byId.get(id);
        test.error = `${b ? b.name : id}は起点にできません（${elig.reason}）。`;
      }
      renderBuilder();
    },
    onChainRemove: (index) => {
      if (!buildCtx || !buildCtx.chainTest) return;
      const test = buildCtx.chainTest;
      const action = (test.lastActions || [])[index];
      if (!action) return;
      if (index === 0) {
        // 起点の×で、テスト自体をやめる。
        test.originId = null;
        test.skipped = [];
        test.overrides = {};
        test.error = null;
        renderBuilder();
        return;
      }
      if (action.fixed) return; // 条件で固定の行動は外せない。
      const key = `${action.id}#${action.occ}`;
      if (!test.skipped.includes(key)) test.skipped.push(key);
      // 外したメンバーの手組み指定は残しても当たらなくなるため掃除する。
      for (const k of Object.keys(test.overrides || {})) {
        if (k.startsWith(`${action.id}#`)) delete test.overrides[k];
      }
      test.error = null;
      renderBuilder();
    },
    onChainPhotonTap: (index) => {
      openChainPhotonPopup(index);
    },
    onChainProbToggle: (index) => {
      if (!buildCtx || !buildCtx.chainTest) return;
      const test = buildCtx.chainTest;
      const action = (test.lastActions || [])[index];
      if (!action || !action.way) return;
      const key = chainWayKey(action.way);
      if (!(test.ignoredProb || []).includes(key)) {
        test.ignoredProb = [...(test.ignoredProb || []), key];
      }
      test.error = null;
      renderBuilder();
    },
    onChainProbRestore: (key) => {
      if (!buildCtx || !buildCtx.chainTest) return;
      const test = buildCtx.chainTest;
      test.ignoredProb = (test.ignoredProb || []).filter((k) => k !== key);
      test.error = null;
      renderBuilder();
    },
    onChainReset: () => {
      if (!buildCtx || !buildCtx.chainTest) return;
      buildCtx.chainTest.originId = null;
      buildCtx.chainTest.skipped = [];
      buildCtx.chainTest.overrides = {};
      buildCtx.chainTest.ignoredProb = [];
      buildCtx.chainTest.error = null;
      renderBuilder();
    },
    // Hボムプランナー・狂炎シミュレーターの操作（SW95）:
    // エディタとマスシートで共用のハンドラをエディタ側の
    // env で束ねる。状態は buildCtx の一時状態に置く。
    ...makeHbombHandlers(editorHbombEnv),
    ...makeKyoenHandlers(editorKyoenEnv),
  };

  const slotCandidateCallbacks = {
    onQuery: (text) => {
      if (!buildCtx) return;
      buildCtx.query = text;
      buildCtx.focusSearch = true;
      renderSlotCandidates();
    },
    onStyleFilter: (s) => {
      if (!buildCtx) return;
      buildCtx.styleFilter = s;
      renderSlotCandidates();
    },
    onClassFilter: (c) => {
      if (!buildCtx) return;
      buildCtx.classFilter = c;
      renderSlotCandidates();
    },
    onToggleFilter: () => {
      if (!buildCtx) return;
      buildCtx.slotFilterOpen = !buildCtx.slotFilterOpen;
      renderSlotCandidates();
    },
    onPick: (id) => {
      if (!buildCtx || buildCtx.slotIndex === null) return;
      const slot = buildCtx.slots[buildCtx.slotIndex];
      slot.megidoId = id;
      // 新しいメンバーが装備できないオーブは外す（ゲームでは装備できない）。
      // 判定は装備可否の規則そのもの（スタイル条件・専用オーブ）に従う。
      if (slot.orbId && orbsById) {
        const orb = orbsById.get(slot.orbId);
        const member = byId.get(id);
        if (orb && member && !orbEquippableBy(orb, member)) slot.orbId = null;
      }
      buildCtx.slotIndex = null;
      renderBuilder();
    },
    onClearSlot: () => {
      if (!buildCtx || buildCtx.slotIndex === null) return;
      buildCtx.slots[buildCtx.slotIndex] = {
        megidoId: null, orbId: null, reishouIds: [], leaderSkill: '',
      };
      buildCtx.slotIndex = null;
      renderBuilder();
    },
    onBack: () => {
      if (!buildCtx) return;
      buildCtx.slotIndex = null;
      renderBuilder();
    },
    // スワイプ（タイプA）: 左＝候補から外す、右＝詳細シート。
    onSwipeHide: async (id) => {
      const reopen = () => { if (buildCtx) renderSlotCandidates(); };
      await hideCandidateFromPicker(id, reopen);
      reopen();
    },
    onSwipeDetail: (id) => {
      openPickerDetailSheet(id, () => { if (buildCtx) renderSlotCandidates(); });
    },
    onDismissSwipeHint: async () => {
      await markSwipeHintSeen();
      if (buildCtx) renderSlotCandidates();
    },
  };

  const orbPickerCallbacks = {
    onQuery: (text) => {
      if (!buildCtx) return;
      buildCtx.orbQuery = text;
      buildCtx.orbFocusSearch = true;
      renderOrbPicker();
    },
    onToggleFilter: () => {
      if (!buildCtx) return;
      buildCtx.orbFilterOpen = !buildCtx.orbFilterOpen;
      renderOrbPicker();
    },
    onRaceFilter: (race) => {
      if (!buildCtx) return;
      buildCtx.orbRace = race;
      renderOrbPicker();
    },
    onCtFilter: (ct) => {
      if (!buildCtx) return;
      buildCtx.orbCt = ct;
      renderOrbPicker();
    },
    onKindFilter: (kind) => {
      if (!buildCtx) return;
      buildCtx.orbKind = kind;
      renderOrbPicker();
    },
    onPick: (orbId) => {
      if (!buildCtx || buildCtx.slotIndex === null) return;
      buildCtx.slots[buildCtx.slotIndex].orbId = orbId;
      buildCtx.slotIndex = null;
      renderBuilder();
    },
    onBack: () => {
      if (!buildCtx) return;
      buildCtx.slotIndex = null;
      renderBuilder();
    },
  };

  const loadEnemiesForView = async () => {
    try {
      floorEnemies = await loader.loadFloorEnemies(viewFloor);
    } catch {
      floorEnemies = null;
    }
  };

  // 誤り報告フォーム（Google フォーム「星間の塔ツール」誤り報告。
  // 最終チェック「誤り報告先」の決定、2026-11-20。research/final-check-audit.md）。
  // タブバーの≡メニューの「不具合・要望を報告する」から外部ブラウザで開く。
  const REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSezdFqszf2kdl-3dq7lk80OpbdixwhW3BIBSoOQ30N_kRxqow/viewform';

  // タブバー（四角4つ＋≡）の描画。update() の全体再描画と、検索
  // ビューの開閉（オーバーレイの onClose）から共用する。SW89
  // （2026-11-21）で上の検索帯は廃止し、検索の入口は≡メニューの
  // 行だけにした。書き出し・読み込みは記録画面の中だけに置く。
  const renderNav = () => {
    renderTabBar(tabbarEl, {
      section,
      searchActive: Boolean(searchCtx),
      menuOpen,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
    }, {
      onSelectSection: (next) => showSection(next),
      onSearch: () => {
        menuOpen = false;
        openSearchView();
      },
      onToggleMenu: () => {
        menuOpen = !menuOpen;
        update();
      },
      onUndo: async () => {
        const ops = currentOps(history);
        const target = ops[ops.length - 1];
        menuOpen = false;
        sheetCtx = null;
        overlay.close();
        history = undo(history);
        await persistRun();
        setNotice(target ? `元に戻しました: ${describeOp(target)}` : null);
        update();
      },
      onRedo: async () => {
        const target = history.ops[history.cursor];
        menuOpen = false;
        sheetCtx = null;
        overlay.close();
        history = redo(history);
        await persistRun();
        setNotice(target ? `やり直しました: ${describeOp(target)}` : null);
        update();
      },
      onReport: () => {
        menuOpen = false;
        window.open(REPORT_FORM_URL, '_blank', 'noopener');
        update();
      },
    });
  };

  const update = async () => {
    // メギド区画は、描画済みの DOM を保持する（renderSection の分岐）。
    // 育成の保存などで全体更新が走っても、メギド画面の開閉状態や
    // スクロール・入力中の値を壊さないため。再描画が要る操作は
    // renderMegidoView を直接呼ぶ。
    const derived = derive();
    if (!viewFloor) viewFloor = derived.currentFloor;
    if (viewFloor !== settings.lastFloor) {
      settings = { ...settings, lastFloor: viewFloor };
      await saveSettings(backend, settings);
    }
    await loadEnemiesForView();

    renderNav();

    const outlook = towerOutlook(structure, derived);
    const usage = styleUsage(structure, derived, megidoBasics);
    // フッター展開部のスタイル別ボックス（V5）: 段階の下がった所持者を
    // 悪い順に並べ、そのスタイルの次の回復マスの階を添える。
    const recoveries = nextRecoveries(structure, derived.cleared, derived.currentFloor);
    const recoveryByKey = new Map(recoveries.map((r) => [r.style, r]));
    const styleCards = STYLE_ORDER.map((code) => {
      const members = [];
      for (const m of megidoBasics.megido) {
        if (STYLE_CODE[m.style] !== code) continue;
        if (!derived.owned.has(m.id)) continue;
        const stage = derived.conditionOf(m.id);
        if (stage > 0) members.push({ name: m.name, stage });
      }
      members.sort((a, b) => (b.stage - a.stage) || (a.name < b.name ? -1 : 1));
      const rec = recoveryByKey.get(code);
      return {
        style: code, label: STYLE_NAME[code],
        nextFloor: rec ? rec.nextFloor : null,
        members,
      };
    });
    const randomRec = recoveryByKey.get('RANDOM');
    // 状態に応じた静的な色（K5、色は 2026-11-25 移行）: 気絶・
    // 絶不調は危険として黄で出す（気絶あり = risk-high で濃い黄、
    // 絶不調のみ = risk で淡い黄）。今いる階に未処理の回復マスが
    // あり絶不調・気絶がいれば、回復の推奨（ツールの勧め）として
    // 菫で出す（recovery）。優先は 気絶 > 回復推奨 > 絶不調。
    // 点滅はしない（色の状態だけで伝える）。
    let footerState = null;
    {
      const { veryBad, fainted } = derived.fatigue;
      if (fainted > 0) footerState = 'risk-high';
      else if (veryBad > 0) {
        const fdNow = floorData(structure, derived.currentFloor);
        const hasRecoveryHere = fdNow
          ? Object.entries(fdNow.squares).some(([id, d]) => (
            d.type === 'explore' && d.subType === 'recovery' && !derived.cleared.has(id)
          ))
          : false;
        footerState = hasRecoveryHere ? 'recovery' : 'risk';
      }
    }
    renderStateFooter(stateEl, {
      notice: noticeText,
      state: footerState,
      towerPower: derived.towerPower,
      nextTowerFloor: outlook.nextTower ? outlook.nextTower.floor : null,
      // 悪い状態の人数の先見せ（全体構成の決定 問題4）。見通しの
      // 結論はフッターに置かない（問題1: マップ側の階見出し帯へ）。
      fatigue: derived.fatigue,
      styleUsage: usage,
      expanded: footerExpanded,
      styleCards,
      randomRecovery: randomRec ? { nextFloor: randomRec.nextFloor } : null,
      buffText: buffBandText(derived),
    }, {
      onToggleExpand: () => {
        footerExpanded = !footerExpanded;
        update();
      },
      onOpenConditions: () => openConditionView(),
    });

    renderSection(derived);
  };

  // クリア済み（ボス勝利済み）の階: 階一覧の済印用。
  function clearedFloorsSet() {
    const clearedFloors = new Set();
    for (const op of currentOps(history)) {
      if (op.type !== 'battle' || op.result !== 'win') continue;
      const fd = floorData(structure, op.floor);
      if (fd && fd.squares[op.squareId] && fd.squares[op.squareId].type === 'boss') {
        clearedFloors.add(op.floor);
      }
    }
    return clearedFloors;
  }

  // 区画の切り替え（タブバーの四角）。区画の上に開いていたシートや
  // 全画面ビューは閉じ、マスの文脈も落とす（追記9: 移動は開く→閉じる
  // ではなく切り替え。戻るはマップのタブをタップする）。
  function showSection(next) {
    overlay.close();
    sheetCtx = null;
    menuOpen = false;
    // タブ切り替えは文脈の切り替え: 区画ビューのスクロールの控えは捨て、
    // 切り替え先は先頭から見せる。デスクトップのマップペインは常駐で
    // 文脈は階なので、階の控えは残す。
    if (next !== section) viewScrollMem.clear();
    section = next;
    if (section === 'formations') openFormationList('manage');
    else if (section === 'megido') openMegidoView();
    update();
    // マップへ戻った時が到着の残りの入口（月の締め後の新しいラン等）。
    if (next === 'map') maybeShowFaceCard();
  }

  // 区画ビューの土台: 上部固定（検索など）と下部固定（実行バー）を
  // 挟んで本文を置く。全画面ビュー時代の作り（固定部＋スクロール本文）
  // を、ページスクロール＋sticky で引き継ぐ。
  function mountSection(top, content, bottom) {
    viewEl.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'section-wrap';
    if (top) {
      const t = document.createElement('div');
      t.className = 'section-top';
      t.append(top);
      wrap.append(t);
    }
    const body = document.createElement('div');
    body.className = 'section-body';
    if (content) body.append(content);
    wrap.append(body);
    if (bottom) {
      const b = document.createElement('div');
      b.className = 'section-bottom';
      b.append(bottom);
      wrap.append(b);
    }
    viewEl.append(wrap);
    applyViewScroll(`sec:${section}`);
  }

  // 現在の区画を main へ描く。広い画面（1024px 以上）ではマップ区画を
  // 左ペインに常駐させ、main（右ペイン）には現在の区画を描く。現在の
  // 区画がマップ自身のときは main を空にし、CSS 側でマップが全幅になる
  // （シートが開けば body.ov-open で左ペイン幅に戻り、右にシートが出る）。
  function renderSection(derived) {
    const desktop = isDesktop();
    if (desktop && mapPaneEl) {
      renderMapSection(mapPaneEl, derived);
    } else if (mapPaneEl && mapPaneEl.children.length > 0) {
      mapPaneEl.textContent = '';
    }
    if (panesEl && panesEl.classList && typeof panesEl.classList.toggle === 'function') {
      panesEl.classList.toggle('mode-map', desktop && section === 'map');
    }
    if (section === 'formations') {
      if (listCtx && listCtx.mode === 'manage') renderFormationList();
      return;
    }
    if (section === 'megido') {
      // 描画済みなら保持する（局所更新の設計。renderMegidoView を
      // 直接呼んだ時だけ描き直す）。未描画の時だけここで描く。
      if (megidoCtx && !megidoMounted) renderMegidoView();
      return;
    }
    if (section === 'records') {
      renderRecordsSection();
      return;
    }
    if (desktop) {
      viewEl.textContent = '';
      return;
    }
    renderMapSection(viewEl, derived);
  }

  // マップ区画: 階スイッチ＋階見出し帯＋マップ。
  // 階見出し帯（SW90）: 階の知識ページの廃止に伴い、その情報の義務は
  // ここが引き受ける。並びは「階番号 ？ テーマチップ ルールチップ」
  // ＋注記（全文）＋先月のまとめ（静かな色）。敵・探索マスの一覧は出さない
  // （マップ自体が一覧のため）。今いる階の帯には、見通しの結論も
  // 1行で出す（全体構成の決定 問題1・案2、版157）。
  // host は狭い画面では main、広い画面では左ペイン。
  function renderMapSection(host, derived) {
    host.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'map-section';
    const switchHost = document.createElement('div');
    renderFloorSwitch(switchHost, { viewFloor }, {
      onPrevFloor: () => { viewFloor = Math.max(1, viewFloor - 1); update(); },
      onNextFloor: () => { viewFloor = Math.min(35, viewFloor + 1); update(); },
      onOpenFloorList: async () => {
        // 一番の脅威（全体構成の決定 問題5・案1）: 脅威レベルの材料を
        // 揃えてから開く（対策の材料と同じ読み込み。失敗したら脅威の
        // 行なしで開く）。
        await ensureCounter();
        const topThreatByFloor = new Map();
        if (counterData && counterData.threatLevels) {
          for (const fd of structure.floors) {
            const label = floorTopThreatLabel(counterData.threatLevels, counterData.clsById, fd);
            if (label) topThreatByFloor.set(fd.floor, label);
          }
        }
        overlay.openSheet(floorListContent(structure, derived.currentFloor, viewFloor, (floor) => {
          viewFloor = floor;
          sheetCtx = null;
          overlay.close();
          update();
        }, clearedFloorsSet(), topThreatByFloor));
      },
    });
    wrap.append(switchHost);
    {
      const band = document.createElement('div');
      band.className = 'map-floor-band';
      const headRow = document.createElement('div');
      headRow.className = 'map-floor-head';
      const num = document.createElement('span');
      num.className = 'map-floor-num';
      num.textContent = `${viewFloor}F`;
      headRow.append(num);
      const helpBtn = document.createElement('button');
      helpBtn.className = 'btn-floor-help';
      helpBtn.textContent = '？';
      helpBtn.setAttribute('aria-label', `${viewFloor}Fの案内をもう一度見る`);
      helpBtn.addEventListener('click', () => openFaceCard(viewFloor));
      headRow.append(helpBtn);
      const bandFd = floorData(structure, viewFloor);
      if (bandFd && bandFd.theme && bandFd.theme !== 'なし') {
        const chip = document.createElement('span');
        chip.className = 'map-floor-theme';
        chip.textContent = bandFd.theme;
        headRow.append(chip);
      }
      // バトルルールのチップ（2026-11-21、ユーザー指示）: テーマの
      // 横に、その階の通常戦闘マスに共通するルールを1つ出す。
      // テーマが「なし」の階でも出す。ボスマスだけのルールは出さない
      // （集約は derive.js の floorBattleRule）。
      const bandRule = bandFd ? floorBattleRule(bandFd) : null;
      if (bandRule) {
        const ruleChip = document.createElement('span');
        ruleChip.className = 'map-floor-rule';
        ruleChip.textContent = bandRule;
        headRow.append(ruleChip);
      }
      band.append(headRow);
      // 見通しの結論（全体構成の決定 問題1・案2、2026-11-26。版157で
      // 実装）: 塔破力の見通しの結論文は状態フッターからここへ移した。
      // 計算は towerOutlook のまま（置き場所だけを変える）。出すのは
      // 今いる階を見ている時だけ — 結論は「今いる階から次へ」の
      // 判断材料であり、他の階の帯（その階の案内の置き場）に未来の
      // 結論を混ぜない。ペース方式の結論が出ていない間（序盤の
      // 事実モード）は何も出さない。文面は決定の記録の例文の形
      // （「このペースだと○Fで塔破力が尽きる」）。
      if (viewFloor === derived.currentFloor) {
        const mapOutlook = towerOutlook(structure, derived);
        if (mapOutlook.mode === 'pace') {
          const line = document.createElement('div');
          const isShort = mapOutlook.verdict !== 'enough';
          line.className = `map-outlook${isShort ? ' map-outlook-short' : ''}`;
          line.textContent = isShort
            ? `このペースだと${mapOutlook.runOutFloor}Fで塔破力が尽きる`
            : 'このペースなら最後まで足りる';
          band.append(line);
        }
      }
      // 注記は短い行を全部出す（現行データで注記を持つのは31階の
      // 3行だけで、いずれも判断に要る行）。
      const notes = bandFd?.notes || null;
      if (notes && notes.length > 0) {
        const notesEl = document.createElement('div');
        notesEl.className = 'map-notes';
        for (const note of notes) {
          const line = document.createElement('div');
          line.textContent = note;
          notesEl.append(line);
        }
        band.append(notesEl);
      }
      const prev = prevSummaryFor(records, viewFloor);
      if (prev) {
        const prevEl = document.createElement('div');
        prevEl.className = 'map-notes map-prev-summary';
        prevEl.textContent = prev;
        band.append(prevEl);
      }
      wrap.append(band);
    }
    const viewFd = floorData(structure, viewFloor);
    const states = new Map();
    for (const id of Object.keys(viewFd.squares)) {
      states.set(id, squareState(structure, derived.cleared, id));
    }
    const mapHost = document.createElement('div');
    renderMap(mapHost, {
      floorEntry: viewFd,
      adjacency: structure.adjacency,
      states,
      viewOnly: !floorReached(derived, viewFloor),
      // 点滅は今いる階のマップだけ（閲覧中の先の階では「次」を主張しない）。
      nextId: viewFloor === derived.currentFloor
        ? nextSquareId(structure, derived.cleared, viewFloor)
        : null,
      onTapSquare: (squareId) => openSquare(squareId),
    });
    wrap.append(mapHost);
    host.append(wrap);
    // スクロールの復元: デスクトップのペインは階ごとの位置、狭い画面の
    // マップ区画は階を文脈キーとしてウィンドウ位置を戻す。階が変われば
    // 控えは無く、先頭から（階スイッチとマップが頭から見える）。
    if (mapPaneEl && host === mapPaneEl) {
      paneScrollFloor = viewFloor;
      const savedPane = paneScrollMem.get(viewFloor);
      mapPaneEl.scrollTop = typeof savedPane === 'number' ? savedPane : 0;
    } else {
      applyViewScroll(`map:${viewFloor}`);
    }
  }

  // フッターの塔効果の1行（蓄積があるスタイルだけ）。
  function buffBandText(derived) {
    const parts = [];
    for (const code of STYLE_ORDER) {
      const totals = derived.buffs[code];
      const stats = [];
      if (totals.hp > 0) stats.push(`HP+${totals.hp}%`);
      if (totals.atk > 0) stats.push(`攻撃力+${totals.atk}%`);
      if (totals.def > 0) stats.push(`防御力+${totals.def}%`);
      if (totals.dmg > 0) {
        // ダメージ上昇に単体以外の種別の蓄積がある場合は種別ごとに言う。
        const breakdown = dmgTypeBreakdown(totals);
        if (breakdown) {
          for (const b of breakdown) stats.push(`${b.label}+${b.value}%`);
        } else {
          stats.push(`ダメージ上昇+${totals.dmg}%`);
        }
      }
      if (stats.length > 0) parts.push(`${STYLE_NAME[code]} ${stats.join('・')}`);
    }
    return parts.length > 0 ? `塔効果: ${parts.join(' / ')}` : null;
  }

  // ---- コンディション画面 ----
  // 既定は要約表示（段階ごとの体数＋絶好調未満の一覧）。全員の顔グリッドは
  // ズレの直しのための道具として開く。どちらの表示でも、段階の直しは
  // 画面下部の固定パネルで行う。
  let condCtx = { pickId: null, mode: 'summary' };

  function buildConditionVm(derived) {
    const nextRec = nextRecoveries(structure, derived.cleared, derived.currentFloor);
    const groups = STYLE_ORDER.map((code) => {
      const entries = [];
      for (const id of derived.owned) {
        const m = byId.get(id);
        if (!m || STYLE_CODE[m.style] !== code) continue;
        entries.push({ id, name: m.name, stage: derived.conditionOf(id) });
      }
      entries.sort((a, b) => (b.stage - a.stage) || (a.name < b.name ? -1 : 1));
      const rec = nextRec.find((r) => r.style === code);
      const randomRec = nextRec.find((r) => r.style === 'RANDOM');
      const falling = entries.filter((e) => e.stage >= 4).length;
      const headParts = [];
      headParts.push(rec
        ? `次の回復（${STYLE_NAME[code]}固定）: ${rec.nextFloor}F${recoveryRemainingText(rec.remaining, rec.isLast)}`
        : `次の回復（${STYLE_NAME[code]}固定）: この先にない`);
      if (randomRec) headParts.push(`ランダム回復: ${randomRec.nextFloor}F`);
      headParts.push(`絶不調・気絶: ${falling}体`);
      return { styleLabel: STYLE_NAME[code], headerText: headParts.join(' ／ '), entries };
    });
    const pace = paceBreakdown(structure, derived, currentOps(history));
    const paceLines = [];
    if (pace.battles + pace.explores > 0) {
      paceLines.push(`戦績: 戦闘${pace.battles}（勝利${pace.wins}・敗北${pace.losses}・リタイア${pace.retreats}）／探索${pace.explores}`);
      if (pace.pace !== null) {
        paceLines.push(`消費ペース: 踏破した${pace.clearedFloors}階で、1階あたり約${pace.pace.toFixed(1)}（負けとリタイアを含む）`);
      } else {
        paceLines.push('消費ペース: まだ階を踏破していないため、判定は出していません');
      }
      paceLines.push(pace.upcomingTowerFloors.length > 0
        ? `この先の塔破力マス: ${pace.upcomingTowerFloors.map((t) => `${t.floor}F`).join('、')}`
        : 'この先の塔破力マス: なし');
      paceLines.push('方針: 解放できる塔破力マスを踏んでいけば、塔破力は余る（回復は踏破の必須条件）');
    }
    // 要約表示: 段階ごとの体数、絶好調未満の人（悪い順）、次の回復。
    const counts = CONDITION_STAGES.map((label, stage) => ({ stage, label, count: 0 }));
    const belowRows = [];
    for (const id of derived.owned) {
      const m = byId.get(id);
      if (!m) continue;
      const stage = derived.conditionOf(id);
      counts[stage].count += 1;
      if (stage > 0) belowRows.push({ id, name: m.name, styleLabel: m.style, stage });
    }
    belowRows.sort((a, b) => (b.stage - a.stage) || (a.name < b.name ? -1 : 1));
    const nextRecoveryLines = [];
    for (const code of STYLE_ORDER) {
      const rec = nextRec.find((r) => r.style === code);
      nextRecoveryLines.push(rec
        ? `${STYLE_NAME[code]}の次の回復: ${rec.nextFloor}F${recoveryRemainingText(rec.remaining, rec.isLast)}`
        : `${STYLE_NAME[code]}の次の回復: この先にない`);
    }
    const randomRec = nextRec.find((r) => r.style === 'RANDOM');
    if (randomRec) {
      nextRecoveryLines.push(`ランダム回復: ${randomRec.nextFloor}F（どのスタイルが回復するかは探索の結果で決まります）`);
    }

    const pick = condCtx.pickId ? byId.get(condCtx.pickId) : null;
    return {
      mode: condCtx.mode,
      summary: {
        counts,
        belowRows,
        allGreat: belowRows.length === 0,
        nextRecoveryLines,
      },
      groups,
      pickId: condCtx.pickId,
      pickName: pick ? pick.name : '',
      pickStage: condCtx.pickId ? derived.conditionOf(condCtx.pickId) : 0,
      paceLines: paceLines.length > 0 ? paceLines : null,
    };
  }

  function openConditionView() {
    const derived = derive();
    // スクロール保持の文脈は表示モード（要約／グリッド）: モードを
    // 切り替えれば先頭から、同じモードのまま顔タップや段階の直しで
    // 再描画しても位置は保たれる。
    overlay.openFull(conditionContent(buildConditionVm(derived), {
      onPick: (id) => {
        condCtx.pickId = condCtx.pickId === id ? null : id;
        openConditionView();
      },
      onPickStage: async (id, stage) => {
        history = applyOp(history, { type: 'conditionFix', megidoId: id, stage });
        await persistRun();
        condCtx.pickId = null;
        await update();
        openConditionView();
      },
      onOpenGrid: () => {
        condCtx.mode = 'grid';
        openConditionView();
      },
      onCloseGrid: () => {
        condCtx.mode = 'summary';
        condCtx.pickId = null;
        openConditionView();
      },
      onClosePanel: () => {
        condCtx.pickId = null;
        openConditionView();
      },
    }), { scrollKey: `cond:${condCtx.mode}` });
  }

  const prevSummaryFor = (recs, floor) => {
    const runs = recs.runs || [];
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const s = runs[i].floorSummaries && runs[i].floorSummaries[floor];
      if (s) return `前回: ${s}`;
    }
    return null;
  };

  // ---- 横断検索（棚卸し 2-10） ----
  // マス（敵名・ルール）・メギド・敵（登場マス）・編成（名前・タグ・
  // メンバー・対象の敵）を横断して探す。マスの結果はタップでその階へ
  // 移ってシートまで開く（ジャンプ）。定型検索は現行ツールのプリセット。
  // 効果文（メギドの能力・オーブ・ME）も対象（2026-11-20 拡張）:
  // 候補の計算に載らない機構も言葉で探せる。索引は事前生成
  // （pipeline/generate-search-index.mjs）で、開く時にだけ読む。
  let searchCtx = null;

  const SEARCH_PRESETS = [
    { key: 'next-recovery', label: '次のコンディション回復マス' },
    { key: 'next-tower', label: '次の塔破力マス' },
    { key: 'recovery-R', label: 'ラッシュの回復マス' },
    { key: 'recovery-C', label: 'カウンターの回復マス' },
    { key: 'recovery-B', label: 'バーストの回復マス' },
  ];

  function openSearchView() {
    searchCtx = { gen: ++ctxSeq, query: '', preset: null, focusSearch: false };
    renderSearchView();
    // 検索を開いている間はタブバーの四角に現在地の色を付けない
    // （searchActive）。閉じる時はオーバーレイの onClose が戻す。
    renderNav();
    // 効果文の索引は裏で読み、揃ったら描き直す（効果文の結果が
    // 後から足される。入力中の文面とスクロールは検索の世代で保持）。
    ensureSearchIndex().then(() => { if (searchCtx) renderSearchView(); });
  }

  function searchSquareRows(derived, predicate, limit = 30) {
    const rows = [];
    for (const fd of structure.floors) {
      for (const [squareId, def] of Object.entries(fd.squares)) {
        if (!predicate(fd, squareId, def)) continue;
        const state = squareState(structure, derived.cleared, squareId);
        const sub = def.type === 'explore'
          ? squareSubTextForSearch(def)
          : (def.enemies || []).join('、');
        rows.push({
          kind: 'square',
          floor: fd.floor,
          squareId,
          main: `${fd.floor}F ${squareLabel(def)}${sub ? `: ${sub}` : ''}`,
          sub: state === 'done' ? '解放済み' : state === 'open' ? '解放可能' : '解放不可（隣接するマスを解放してください）',
        });
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  }

  function squareSubTextForSearch(def) {
    const reward = EXPLORE_LABEL[def.subType] || '';
    if (def.styleKind === 'fixed') return `${reward}・${STYLE_NAME[def.style]}固定`;
    if (def.styleKind === 'random') return `${reward}・ランダム`;
    return reward;
  }

  function renderSearchView() {
    if (!searchCtx) return;
    const derived = derive();
    const groups = [];
    const q = normalizeSearchText(searchCtx.query.trim());
    if (searchCtx.preset) {
      const from = derived.currentFloor;
      let rows = [];
      if (searchCtx.preset === 'next-recovery' || searchCtx.preset === 'next-tower') {
        const subType = searchCtx.preset === 'next-recovery' ? 'recovery' : 'tower_power';
        // 今いる階から先で、その種別のマスがある最初の階の分だけを出す
        // （現行ツールの定型検索と同じ範囲）。
        for (let f = from; f <= 35 && rows.length === 0; f += 1) {
          rows = searchSquareRows(derived, (fd, squareId, def) => (
            fd.floor === f && def.type === 'explore' && def.subType === subType
            && !derived.cleared.has(squareId)
          ));
        }
      } else if (searchCtx.preset.startsWith('recovery-')) {
        const style = searchCtx.preset.slice('recovery-'.length);
        rows = searchSquareRows(derived, (fd, squareId, def) => (
          fd.floor >= from && def.type === 'explore' && def.subType === 'recovery'
          && def.styleKind === 'fixed' && def.style === style
          && !derived.cleared.has(squareId)
        ));
      }
      groups.push({
        title: SEARCH_PRESETS.find((p) => p.key === searchCtx.preset).label,
        rows,
      });
    } else if (q) {
      const squareRows = searchSquareRows(derived, (fd, squareId, def) => {
        const enemyHit = (def.enemies || []).some((n) => normalizeSearchText(n).includes(q));
        const ruleHit = (def.rules || []).some((r) => normalizeSearchText(r).includes(q));
        return enemyHit || ruleHit;
      });
      if (squareRows.length > 0) groups.push({ title: 'マス', rows: squareRows });
      const megidoRows = megidoBasics.megido
        .filter((m) => normalizeSearchText(m.name).includes(q))
        .slice(0, 20)
        .map((m) => ({
          kind: 'megido', id: m.id,
          main: m.name,
          sub: `${m.style}／${m.class}（タップでメギド画面へ）`,
        }));
      if (megidoRows.length > 0) groups.push({ title: 'メギド', rows: megidoRows });
      // 効果文（能力・オーブ・マスエフェクト）: 候補の計算に載らない
      // 機構も言葉で探せるようにする。索引は検索を開いた時にだけ
      // 読むため、読み込み前はこの3群は出ない（揃い次第、開いている
      // 検索ビューへ描き直しで足される）。
      if (searchIndex) {
        const nameOfId = (id) => {
          const m = byId.get(id);
          return m ? m.name : id;
        };
        const abilityRows = searchAbilityRows(searchIndex, searchCtx.query, nameOfId);
        if (abilityRows.length > 0) groups.push({ title: '能力', rows: abilityRows });
        const orbRows = searchOrbRows(searchIndex, searchCtx.query);
        if (orbRows.length > 0) groups.push({ title: 'オーブ', rows: orbRows });
        const meRows = searchMeRows(searchIndex, searchCtx.query, nameOfId);
        if (meRows.length > 0) groups.push({ title: 'マスエフェクト', rows: meRows });
      }
      const formationRows = formationsData.formations
        .filter((f) => formationMatchesQuery(f, byId, searchCtx.query))
        .slice(0, 20)
        .map((f) => ({
          kind: 'formation', id: f.id,
          main: f.name || '（名前なし）',
          sub: '編成（タップで編成画面へ）',
        }));
      if (formationRows.length > 0) groups.push({ title: '編成', rows: formationRows });
    }
    const vm = {
      query: searchCtx.query,
      presets: SEARCH_PRESETS.map((p) => ({ ...p, on: searchCtx.preset === p.key })),
      groups,
      emptyText: searchCtx.preset
        ? 'この先に、該当するマスはありません。'
        : q
          ? '条件に合う結果がありません。'
          : '敵の名前・ルール・メギド・編成名のほか、能力やオーブの効果文でも探せます。下のボタンからも探せます。',
    };
    const { top, content, searchInput } = buildSearchView(vm, {
      onQuery: (text) => {
        searchCtx.query = text;
        searchCtx.preset = null;
        searchCtx.focusSearch = true;
        renderSearchView();
      },
      onPreset: (key) => {
        searchCtx.preset = searchCtx.preset === key ? null : key;
        renderSearchView();
      },
      onJumpSquare: async (floor, squareId) => {
        searchCtx = null;
        section = 'map';
        viewFloor = floor;
        overlay.close();
        await update();
        await openSquare(squareId);
      },
      onOpenFormation: () => {
        searchCtx = null;
        showSection('formations');
      },
      onOpenMegido: (id) => {
        searchCtx = null;
        const m = byId.get(id);
        showSection('megido');
        if (m && megidoCtx) {
          megidoCtx.query = m.name;
          renderMegidoView();
        }
      },
      // オーブの結果: 単体の詳細画面が無いため、検索から開く詳細
      // シートで全文を見せる。openSheet は全面ビュー（検索）を閉じて
      // から開き、その瞬間に検索の文脈は落ちるため、ここで控えて
      // おいて閉じる時に復元する（ピッカーの詳細シートと同じ作法）。
      // バーのボタンとシート外タップも onCloseRequest で同じ復元に
      // 振り分ける（バーには「戻る」が出る）。
      onOpenOrb: async (orbId) => {
        await ensureOrbs();
        const orb = orbsById ? orbsById.get(orbId) : null;
        if (!orb || !searchCtx) return;
        const savedCtx = searchCtx;
        const backToSearch = () => {
          overlay.close();
          searchCtx = savedCtx;
          renderSearchView();
          renderNav();
        };
        const content = buildOrbDetailSheet({
          name: orb.name,
          meta: `${orb.condition || ''}／${orb.race || ''}・CT${orb.ct ?? ''}`,
          trait: orb.trait || '',
          skill: orb.skill || '',
        }, { onClose: backToSearch });
        overlay.openSheet(content, { onCloseRequest: backToSearch });
      },
    });
    overlay.openFull(content, { top, scrollKey: `search:${searchCtx.gen}` });
    if (searchCtx.focusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    searchCtx.focusSearch = false;
  }

  // ---- 記録画面（戦績・傾向・ズレ・途中開始・月の締め・アーカイブ・書き出し） ----
  function entryLine(e) {
    const label = squareLabel({ type: e.kind === 'battle' ? 'battle' : 'explore', enemies: e.enemies });
    const enemyText = e.enemies.length > 0 ? `: ${e.enemies.join('、')}` : '';
    if (e.kind === 'battle') {
      return `${label}${enemyText} — ${e.formationName ? `「${e.formationName}」で` : ''}${RESULT_TEXT[e.result]}`;
    }
    // 探索の記録にはメンバー名も手渡す（誰を出したかが翌月の判断材料）。
    const names = e.members.map((id) => nameOf(id)).join('、');
    return `${label}${enemyText} — 探索（${exploreEffectLabel(e)}）: ${names || `メンバー ${e.members.length}体`}`;
  }

  // 勝率の「すべて見る」の開閉（SW94）: 記録区画の表示状態だけの
  // ものなので、保存はしない。
  let ratesShowAll = false;
  const RATE_TOP_COUNT = 5;
  // メギドの使用回数（A2・A6）の「すべて見る」の開閉も同種の表示状態。
  let usageShowAll = false;
  const USAGE_TOP_COUNT = 5;

  function buildRecordsVm() {
    const ops = currentOps(history);
    const derived = derive();
    const byFloor = new Map();
    for (const e of runEntries(structure, ops)) {
      if (!byFloor.has(e.floor)) byFloor.set(e.floor, []);
      byFloor.get(e.floor).push({ text: entryLine(e), tone: entryTone(e) });
    }
    const currentFloors = [...byFloor.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([floor, lines]) => ({ floor, lines }));

    // 今のラン（SW94）: 塔破力はツールが結論と内訳を出す（見通しの
    // 計算は towerOutlook が正で、ここは文面への置き換えだけ）。
    const maxFloor = structure.floors.reduce((m, f) => Math.max(m, f.floor), 0);
    const outlook = towerOutlook(structure, derived);
    const remainingFloors = maxFloor - derived.currentFloor;
    const recoveryText = derived.towerCollected
      ? '塔破力マスで回収した実績あり'
      : '塔破力マスの回収はまだ無い（回収するまで見通しに数えない）';
    const paceText = (pace) => (Number.isInteger(pace) ? String(pace) : pace.toFixed(1));
    let outlookVm;
    if (outlook.mode === 'pace') {
      outlookVm = {
        headline: outlook.verdict === 'enough'
          ? '塔破力は足りる見込み'
          : `塔破力は${outlook.runOutFloor}Fで不足する見込み`,
        lines: [
          { label: '塔破力の残り', value: String(outlook.currentPower) },
          { label: 'ペース', value: `1階あたり ${paceText(outlook.pace)}` },
          { label: '残りの階数', value: `${remainingFloors}階` },
          { label: '回収の見込み', value: recoveryText },
          {
            label: '許容',
            value: String(outlook.allowance),
            note: outlook.allowance > 0
              ? `あと${outlook.allowance}回余分に倒れても大丈夫`
              : '余分に倒れる余裕はない',
          },
        ],
        note: null,
      };
    } else {
      // 事実モード（踏破した階が足りない間）: 結論は出さず、現在の
      // 値と次の塔破力マスの事実だけを返す（フッターと同じ扱い）。
      outlookVm = {
        headline: null,
        lines: [
          { label: '塔破力の残り', value: String(outlook.currentPower) },
          { label: '残りの階数', value: `${remainingFloors}階` },
          outlook.nextTower
            ? { label: '次の塔破力マス', value: `${outlook.nextTower.floor}F` }
            : { label: '次の塔破力マス', value: 'この先にない' },
          { label: '回収の見込み', value: recoveryText },
        ],
        note: `見通しは、踏破した階が${PACE_MIN_CLEARED_FLOORS}階になると出ます（現在${outlook.clearedFloors}階）。`,
      };
    }

    // 自分の記録（SW94）: 日付の見込みは計算しない。今月ここまでに
    // かかった日数と到達階、前回のランの事実をそのまま返す。日数は
    // ランの開始日（meta.runStartedAt／アーカイブの startedAt）が
    // 分かる時だけ出す。
    let currentLine;
    if (ops.length === 0) {
      currentLine = '今月: まだ記録がありません';
    } else {
      const days = meta && meta.runStartedAt
        ? inclusiveDays(meta.runStartedAt, new Date())
        : null;
      currentLine = days != null
        ? `今月: ${days}日目で ${derived.currentFloor}F`
        : `今月: ${derived.currentFloor}F`;
    }
    let lastLine = null;
    const lastRun = records.runs.length > 0 ? records.runs[records.runs.length - 1] : null;
    if (lastRun) {
      const floor = reachedFloorOf(lastRun.ops || []);
      if (floor != null) {
        const days = lastRun.startedAt
          ? inclusiveDays(lastRun.startedAt, lastRun.closedAt)
          : null;
        const clearedAll = ((lastRun.stats && lastRun.stats.floorsCleared) || [])
          .includes(maxFloor);
        const floorText = clearedAll && floor === maxFloor
          ? `${floor}F 到達`
          : `${floor}Fで停止`;
        lastLine = `${lastRun.label}: ${days != null ? `${days}日で ` : ''}${floorText}`;
      }
    }
    const selfRecordVm = { currentLine, lastLine };

    const agg = aggregateRecords(structure, [ops, ...records.runs.map((r) => r.ops)]);
    const allRateRows = agg.formations.map((r) => ({
      ...r,
      rateText: `${Math.round((r.wins / r.battles) * 100)}%`,
    }));
    const tendencies = {
      enemyRows: agg.enemies,
      // 既定は戦闘数が多い順の上位だけ（集計の並びは aggregateRecords
      // が正で、ここでは件数を絞るだけ）。
      formationRows: allRateRows.slice(0, RATE_TOP_COUNT),
      note: `傾向と勝率は、同じ相手・同じ編成で3戦以上すると出ます（現在の最大: 敵 ${agg.maxEnemyBattles} 戦／編成 ${agg.maxFormationBattles} 戦）。`,
    };
    // 「すべて見る（階ごとに表示）」用: 全件を編成の対象の階で
    // 区切る。勝率の行は名前しか持たないため、保存済み編成と名前で
    // 照合する（同名が複数あれば最初の1件）。編成がもう無い・対象が
    // 無い行は最後のグループ。対象の階が複数ある編成は、それぞれの
    // 階に出る（編成一覧の区切りと同じ）。
    const formationByName = new Map();
    for (const f of formationsData.formations) {
      if (!formationByName.has(f.name)) formationByName.set(f.name, f);
    }
    const rateGroupsByFloor = new Map();
    const rateNoTarget = [];
    for (const row of allRateRows) {
      const f = formationByName.get(row.name);
      const floors = f ? formationTargetFloors(f, structure) : [];
      if (floors.length === 0) {
        rateNoTarget.push(row);
        continue;
      }
      for (const fl of floors) {
        if (!rateGroupsByFloor.has(fl)) rateGroupsByFloor.set(fl, []);
        rateGroupsByFloor.get(fl).push(row);
      }
    }
    const ratesGroups = [...rateGroupsByFloor.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([floor, rows]) => ({ label: `${floor}F`, rows }));
    if (rateNoTarget.length > 0) ratesGroups.push({ label: '対象なし・その他', rows: rateNoTarget });

    // メギドの使用回数（調査 A2・A6）: 集計の対象範囲と数え方は
    // 勝率集計と同一（全ランの戦闘記録、メンバー1人あたり1回）。
    // 既定は回数の多い順の上位だけを出し、「すべて見る」で全件に広げる。
    const usage = megidoUsage(structure, [ops, ...records.runs.map((r) => r.ops)]);
    const usageRowOf = (r) => ({
      name: nameOf(r.id),
      count: r.count,
      bands: r.bands
        .map((count, i) => ({ label: `${i * 5 + 1}–${Math.min(35, i * 5 + 5)}F`, count }))
        .filter((b) => b.count > 0),
      uses: r.uses.map((u) => ({
        floor: u.floor,
        enemiesText: u.enemies.join('、'),
        formationName: u.formationName,
        resultText: RESULT_TEXT[u.result] || null,
      })),
    });
    const usageRows = usage.slice(0, USAGE_TOP_COUNT).map(usageRowOf);
    const usageAllRows = usageShowAll ? usage.map(usageRowOf) : [];

    const anomalies = validateOps({
      structure, megidoBasics, megidoDetails: formationsData.megidoDetails, ops,
    });

    // ズレの直しの対象: 結果のあるマス（マスごとに最後の記録）。
    const fixBySquare = new Map();
    for (const e of runEntries(structure, ops)) fixBySquare.set(e.squareId, e);
    const fixTargets = [...fixBySquare.values()]
      .sort((a, b) => a.floor - b.floor || a.index - b.index)
      .map((e) => ({ squareId: e.squareId, floor: e.floor, text: `${e.floor}F: ${entryLine(e)}` }));

    const pastRuns = [...records.runs].reverse().map((run) => ({
      label: run.label,
      // 締めた日は保存ラベル（年月）ではなく closedAt から日本語の日付で
      // 補う（K6 の小物）。同月に複数閉じても日で区別できる。
      closedText: closedDayText(run.closedAt) || String(run.closedAt || '').slice(0, 10),
      statsText: `戦闘${run.stats.battles}（勝利${run.stats.wins}・敗北${run.stats.losses}・リタイア${run.stats.retreats}）／探索${run.stats.explores}／踏破${run.stats.floorsCleared.length}階／処理${run.stats.squaresProcessed}マス`,
      floors: Object.entries(run.floorSummaries || {})
        .map(([floor, text]) => ({ floor: Number(floor), text }))
        .sort((a, b) => a.floor - b.floor),
    }));

    return {
      outlook: outlookVm,
      selfRecord: selfRecordVm,
      currentFloors,
      tendencies,
      ratesTotal: allRateRows.length,
      ratesShowAll,
      ratesGroups,
      usageRows,
      usageAllRows,
      usageTotal: usage.length,
      usageShowAll,
      driftAnomalies: anomalies.map((a) => a.message),
      fixTargets,
      pastRuns,
      canCloseMonth: ops.length > 0,
    };
  }

  // 月の締め（H3）: 今のランを戦績として閉じ、新しいランを始める。
  async function closeMonth() {
    const ops = currentOps(history);
    if (ops.length === 0) return;
    const archive = archiveRun(structure, ops, new Date().toISOString(), (meta && meta.runStartedAt) || null);
    records = { runs: [...records.runs, archive] };
    await saveRecords(backend, records);
    history = createHistory();
    faceShownFloors = new Set();
    squareFormations = new Map();
    await persistRun();
    meta = {
      ...(meta || {}),
      runMonth: monthKeyOf(new Date()),
      runStartedAt: new Date().toISOString(),
    };
    await saveMeta(backend, meta);
    viewFloor = 1;
    sheetCtx = null;
  }

  // 書き出し（退避）: 記録画面の操作と、読み込み確認の「退避する」で共用。
  async function doExport() {
    const json = await exportAll(backend);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName();
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // 月の締めの確認（原則9）: 残るものとリセットされるものを示してから締める。
  function openCloseMonthConfirm(onCancel, onAfter) {
    const ops = currentOps(history);
    const battles = ops.filter((o) => o.type === 'battle');
    const statsText = `今のラン: 戦闘${battles.length}（勝利${battles.filter((o) => o.result === 'win').length}・敗北${battles.filter((o) => o.result === 'lose').length}・リタイア${battles.filter((o) => o.result === 'retreat').length}）／探索${ops.filter((o) => o.type === 'explore').length}`;
    overlay.openSheet(buildCloseMonthConfirmView({ statsText }, {
      onConfirm: async () => {
        await closeMonth();
        await update();
        overlay.close();
        if (onAfter) onAfter();
        else openRecordsView();
      },
      onCancel,
    }));
  }

  // 読み込みファイルの受け取り（記録画面の操作行から）。形式が
  // 違う場合は読み込まず、その旨のシートを出す。戻り先の申告
  // （backToRecords）は確認シート側の作法として残す。
  async function handleImportFile(file, { backToRecords = true } = {}) {
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      const wrap = document.createElement('div');
      const title = document.createElement('h2');
      title.textContent = '読み込めませんでした';
      wrap.append(title);
      const p = document.createElement('p');
      p.textContent = 'ファイルの形式が違うため、読み込みは行いませんでした。今のデータはそのままです。';
      wrap.append(p);
      const backBtn = document.createElement('button');
      backBtn.textContent = backToRecords ? '記録画面に戻る' : '閉じる';
      backBtn.addEventListener('click', () => {
        overlay.close();
        if (backToRecords) openRecordsView();
      });
      wrap.append(backBtn);
      overlay.openSheet(wrap);
      return;
    }
    openImportConfirm(json, { backToRecords });
  }

  // 読み込みの確認（原則9）: 上書きの内容と退避の案内を示し、表示された
  // 4桁の数字が正しく入力された時だけ実行する。数字は表示のたびに変える。
  function openImportConfirm(json, { backToRecords = true } = {}) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    let inputValue = '';
    overlay.openSheet(buildImportConfirmView({ code }, {
      onInput: (value) => { inputValue = value; },
      onExportFirst: () => doExport(),
      onConfirm: async () => {
        if (inputValue.trim() !== code) return; // 数字が一致しない限り実行しない
        await importAll(backend, json);
        const run = await loadRun(backend);
        history = run ? createHistory(run.ops, run.cursor) : createHistory();
        faceShownFloors = new Set(run ? run.faceShownFloors : []);
        squareFormations = keptMapFrom(run && run.squareFormations);
        formationsData = (await loadFormationsData(backend)) || { formations: [], megidoDetails: null };
        records = await loadRecords(backend);
        meta = { ...(meta || {}), runMonth: monthKeyOf(new Date()) };
        // 読み込んだランの開始日はこの端末では分からない（SW94）。
        delete meta.runStartedAt;
        await saveMeta(backend, meta);
        overlay.close();
        update();
      },
      onCancel: () => {
        overlay.close();
        if (backToRecords) openRecordsView();
      },
    }));
  }

  // 記録は区画ビュー（タブ切り替え）。openRecordsView は「記録区画へ移る」
  // の別名として残し、描画そのものは renderRecordsSection が担う。
  function openRecordsView() {
    showSection('records');
  }

  // 全データリセット（棚卸し 8-6）: アプリ内シート＋4桁コードのガード。
  function openResetConfirm() {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    let inputValue = '';
    overlay.openSheet(buildResetConfirmView({ code }, {
      onInput: (value) => { inputValue = value; },
      onExportFirst: () => doExport(),
      onConfirm: async () => {
        if (inputValue.trim() !== code) return; // 数字が一致しない限り実行しない
        for (const name of STORE_NAMES) await backend.clear(name);
        history = createHistory();
        faceShownFloors = new Set();
        squareFormations = new Map();
        formationsData = { formations: [], megidoDetails: null };
        records = { runs: [] };
        settings = { version: 1 };
        // 移行済みの印だけは残す（旧 localStorage が残っている端末で、
        // リセット直後に旧データが自動で戻ってくるのを防ぐ）。
        meta = {
          migratedAt: new Date().toISOString(),
          resetAt: new Date().toISOString(),
          runStartedAt: new Date().toISOString(),
        };
        await saveMeta(backend, meta);
        sheetCtx = null;
        listCtx = null;
        buildCtx = null;
        viewFloor = 1;
        section = 'map';
        overlay.close();
        setNotice('全データをリセットしました');
        await update();
      },
      onCancel: () => {
        overlay.close();
        openRecordsView();
      },
    }));
  }

  function renderRecordsSection() {
    mountSection(null, buildRecordsView(buildRecordsVm(), {
      onCloseMonth: () => openCloseMonthConfirm(() => {
        overlay.close();
        openRecordsView();
      }),
      onReset: () => openResetConfirm(),
      onOpenMidRun: () => openMidRunView(),
      onOpenConditions: () => openConditionView(),
      onOpenSquare: async (squareId, floor) => {
        section = 'map';
        viewFloor = floor;
        await update();
        await openSquare(squareId);
        if (sheetCtx) {
          sheetCtx.subView = 'fix';
          renderSquareSheet();
        }
      },
      onExport: () => doExport(),
      onImportFile: (file) => handleImportFile(file),
      onToggleRatesAll: (showAll) => {
        ratesShowAll = showAll;
        renderRecordsSection();
      },
      onToggleUsageAll: (showAll) => {
        usageShowAll = showAll;
        renderRecordsSection();
      },
    }), null);
  }

  // ---- ラン途中からの開始（H3） ----
  let midCtx = null;

  function openMidRunView() {
    midCtx = {
      gen: ++ctxSeq,
      floor: derive().currentFloor,
      // spec: id → 段階（数値）または null（個別に「不明」と指定）。
      // キーが無い人は「指定しない人の扱い」（defaultMode）に従う。
      spec: new Map(),
      powerText: '',
      defaultMode: 'unknown',
      query: '',
      pickerId: null,
      focusSearch: false,
    };
    renderMidRunView();
  }

  function renderMidRunView() {
    const derived = derive();
    const q = normalizeSearchText(midCtx.query.trim());
    const stageTextOf = (id) => {
      if (midCtx.spec.has(id)) {
        const s = midCtx.spec.get(id);
        return s === null ? '不明' : CONDITION_STAGES[s];
      }
      return midCtx.defaultMode === 'great' ? '絶好調（指定なし）' : '不明（指定なし）';
    };
    const groups = STYLE_ORDER.map((code) => {
      const entries = [];
      for (const id of derived.owned) {
        const m = byId.get(id);
        if (!m || STYLE_CODE[m.style] !== code) continue;
        if (q && !normalizeSearchText(m.name).includes(q)) continue;
        entries.push({
          id,
          name: m.name,
          stageText: stageTextOf(id),
          stage: midCtx.spec.has(id) ? midCtx.spec.get(id) : null,
        });
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : 1));
      return { styleLabel: STYLE_NAME[code], entries };
    });
    const pickerMember = midCtx.pickerId ? byId.get(midCtx.pickerId) : null;
    const vm = {
      floor: midCtx.floor,
      powerText: midCtx.powerText,
      defaultMode: midCtx.defaultMode,
      query: midCtx.query,
      note: '「指定しない人の扱い」を選び、分かる人だけ顔をタップして段階を指定してください。「不明」が残ると見通しの精度が下がります。',
      replaceWarning: currentOps(history).length > 0
        ? '今のランに記録があります。この開始で今の履歴は置き換わります（残す場合は、先に記録画面で月の締めをしてください）。'
        : null,
      groups,
      picker: pickerMember
        ? {
          id: midCtx.pickerId,
          name: pickerMember.name,
          stage: midCtx.spec.has(midCtx.pickerId) ? midCtx.spec.get(midCtx.pickerId) : null,
        }
        : null,
    };
    const { top, content, actionBar, searchInput } = buildMidRunView(vm, {
      onFloorChange: (floor) => { midCtx.floor = floor; },
      onPowerChange: (text) => { midCtx.powerText = text; },
      onDefaultMode: (mode) => {
        midCtx.defaultMode = mode;
        renderMidRunView();
      },
      onSearch: (text) => {
        midCtx.query = text;
        midCtx.focusSearch = true;
        renderMidRunView();
      },
      // 顔タップは巡回ではなく、固定パネルを開く（コンディションの直しと共通）。
      onCycle: (id) => {
        midCtx.pickerId = id;
        renderMidRunView();
      },
      onPickStage: (id, stage) => {
        midCtx.spec.set(id, stage);
        midCtx.pickerId = null;
        renderMidRunView();
      },
      onClosePicker: () => {
        midCtx.pickerId = null;
        renderMidRunView();
      },
      onStart: async () => {
        // startRun の意味論は変えない: conditions に入った人だけが既知で、
        // 残りは conditionsUnknown として精度警告の対象になる。
        const conditions = {};
        for (const id of derive().owned) {
          if (midCtx.spec.has(id)) {
            const s = midCtx.spec.get(id);
            if (typeof s === 'number') conditions[id] = s;
          } else if (midCtx.defaultMode === 'great') {
            conditions[id] = 0;
          }
        }
        const conditionsUnknown = [...derive().owned].some((id) => !(id in conditions));
        const op = {
          type: 'startRun', floor: midCtx.floor, conditions, conditionsUnknown,
        };
        const tp = Number.parseInt(midCtx.powerText, 10);
        if (Number.isFinite(tp) && tp >= 0) op.towerPower = tp;
        history = createHistory([op]);
        faceShownFloors = new Set();
        squareFormations = new Map();
        await persistRun();
        meta = {
          ...(meta || {}),
          runMonth: monthKeyOf(new Date()),
          runStartedAt: new Date().toISOString(),
        };
        await saveMeta(backend, meta);
        viewFloor = midCtx.floor;
        midCtx = null;
        overlay.close();
        section = 'map';
        await update();
        // 途中開始は新しいランの到着: 開始階の顔見せカードを出す。
        await maybeShowFaceCard();
      },
    });
    overlay.openFull(content, {
      top, bottom: actionBar, scrollKey: `mid:${midCtx.gen}`,
    });
    if (midCtx.focusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    midCtx.focusSearch = false;
  }

  // ---- メギド画面（候補の管理と育成の入力） ----
  // 2026-11-20 の再設計: 登録は入口に置かず、候補の管理はメギドタブの
  // 2部制（外した人リスト＋候補アコーディオン）に集約した。画面内の
  // 操作は局所更新が原則で、全面再描画は検索・絞り込みと所属の変更
  // （外す／戻す）の時だけ（その場合も開閉状態とスクロールは保持）。
  let megidoCtx = null;
  let megidoMounted = false;

  function ensureDetailsMaterialized() {
    if (formationsData.megidoDetails != null) return;
    const details = {};
    for (const m of megidoBasics.megido) {
      details[m.id] = normalizeMegidoDetail({ owned: true });
    }
    formationsData = { ...formationsData, megidoDetails: details };
  }

  function openMegidoView() {
    if (!megidoCtx) {
      megidoCtx = {
        query: '', styleFilter: null, expandedId: null, focusSearch: false,
        accordionOpen: false,
      };
    }
    megidoMounted = false;
    renderMegidoView();
    // 需要の集計の材料（索引と全階の敵、著述の有無）と霊宝マスタを
    // 裏で読み、揃ったら描き直す。
    ensureCounter()
      .then(() => ensureAllFloors())
      .then(() => ensureTactics())
      .then(() => ensureReishou())
      .then(() => { if (megidoCtx) renderMegidoView(); })
      .catch(() => {});
  }

  // 育成の標準（レベル70・奥義Lv3・専用霊宝あり・絆霊宝なし・凸0）。
  // 専用霊宝の標準は 2026-11-20 に「なし」から「あり」へ変更された。
  // 保存値の解釈は migrate.js の resolveSpecialReishou が一手に担う
  // （未設定＝新標準のあり／明示の「なし」は special_set で保持）。
  // 専用霊宝・絆霊宝・凸は実装のあるメギドにしか無い（基礎データの
  // フラグが正）。フラグが false のメギドでは、保存値があっても
  // ここで標準値に落として表示・導出に効かせない（値の掃除は起動時
  // にも行う。migrate.js の sanitizeDetailsByFlags）。
  function detailOf(details, id) {
    const d = details ? details[id] : null;
    const m = byId.get(id);
    const hasSpecial = Boolean(m && m.specialReishou);
    const hasBond = Boolean(m && m.bondReishou);
    const hasSingularity = Boolean(m && m.singularity);
    // 絆霊宝は4枠モデル（migrate.js の resolveBondSlots が読みの正）。
    // bondReishou は互換のための鏡（最初に埋まっている枠の値）。
    const bondSlots = resolveBondSlots(d, hasBond);
    return {
      level: d && typeof d.level === 'number' ? d.level : 70,
      ougiLevel: d && typeof d.ougiLevel === 'number' ? d.ougiLevel : 3,
      hasSpecialReishou: hasSpecial,
      hasBondReishou: hasBond,
      hasSingularity,
      specialReishou: resolveSpecialReishou(d, hasSpecial),
      bondSlots,
      bondReishou: bondSlots.find((v) => v !== 0) || 0,
      singularity: hasSingularity && d && typeof d.singularity_level === 'number' ? d.singularity_level : 0,
      reishouIds: d && Array.isArray(d.reishou) ? [...d.reishou] : [],
      trait: m && typeof m.trait === 'string' ? m.trait : null,
    };
  }

  const BOND_TYPE_LABELS = ['', '真', '剛', '絆'];
  function deviationTextOf(d) {
    const parts = [];
    if (d.level !== 70) parts.push(`Lv${d.level}`);
    if (d.ougiLevel !== 3) parts.push(`奥義Lv${d.ougiLevel}`);
    // 専用霊宝の標準は「あり」。標準と違うのは「なし」の側。
    if (d.hasSpecialReishou && !d.specialReishou) parts.push('専用霊宝なし');
    // 絆霊宝は内訳（型ごとの個数）で出す。例: 絆霊宝 真×2・剛×1。
    if (Array.isArray(d.bondSlots) && d.bondSlots.some((v) => v !== 0)) {
      const counts = [0, 0, 0, 0];
      for (const v of d.bondSlots) counts[v] += 1;
      const inner = [1, 2, 3]
        .filter((t) => counts[t] > 0)
        .map((t) => (counts[t] > 1 ? `${BOND_TYPE_LABELS[t]}×${counts[t]}` : BOND_TYPE_LABELS[t]))
        .join('・');
      parts.push(`絆霊宝 ${inner}`);
    }
    if (d.singularity !== 0) parts.push(`凸${d.singularity}`);
    return parts.length > 0 ? parts.join('・') : null;
  }

  // メギド詳細に出す「このメギドを使っている保存済み編成」の材料:
  // 編成ごとに1回だけ行を組み、メンバー全員へ配る。並びは編成一覧と
  // 同じ規則（compareFormationRows）、行の材料（対象・勝敗・構成・
  // メンバー）も編成一覧の行と同じ組み立てにする。対象は保存済み
  // 編成だけ（戦闘記録の逆引きは記録画面の既存機能）。
  const formationRowsByMegido = (derived) => {
    const battleCounts = formationBattleCounts(structure, [
      currentOps(history), ...records.runs.map((r) => r.ops),
    ]);
    const wrapped = formationsData.formations.map((f) => {
      const usability = formationUsability(f, {
        owned: derived.owned, conditionOf: derived.conditionOf, byId,
      });
      return {
        formation: f,
        usable: usability.usable,
        worstStage: worstStageOf(f, derived.conditionOf),
        members: membersWithEquipment(formationMembers(f, byId)),
        targetFloors: formationTargetFloors(f, structure),
      };
    });
    wrapped.sort(compareFormationRows);
    const byMegido = new Map();
    for (const r of wrapped) {
      const rowVm = {
        id: r.formation.id,
        name: r.formation.name,
        targetText: formationTargetText(r.formation, r.targetFloors),
        recordText: formationRecordText(r.formation, battleCounts),
        composition: styleComposition(r.formation, byId),
        members: r.members.filter((m) => m.megidoId).map((m) => ({
          label: m.label, name: m.name, style: m.style,
          stage: derived.conditionOf(m.megidoId),
          stageLabel: CONDITION_STAGES[derived.conditionOf(m.megidoId)],
          orbText: m.orbId ? orbNameText(m.orbId) : 'なし',
          reishouSummary: m.reishouIds.length > 0 ? reishouSlotSummary(m.megidoId) : null,
        })),
      };
      for (const m of r.members) {
        if (!m.megidoId) continue;
        if (!byMegido.has(m.megidoId)) byMegido.set(m.megidoId, []);
        byMegido.get(m.megidoId).push(rowVm);
      }
    }
    return byMegido;
  };

  function renderMegidoView() {
    const derived = derive();
    const details = formationsData.megidoDetails;
    const formationsByMegido = formationRowsByMegido(derived);
    const q = normalizeSearchText(megidoCtx.query.trim());
    const queryActive = q.length > 0;
    const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    // 需要は全行で使い回すため、ここで1回だけ集計する。
    const demand = counterData && allFloorsEnemies ? currentDemand(derived) : null;
    const demandLinesOf = (id) => {
      if (!demand) return null;
      const d = demand.get(id);
      // 詳細に出す「活躍の場面」は短く保つ（2026-11-20 ユーザー指示:
      // 長い説明は分かりづらい、「効く／要る」のような内輪の言葉は
      // 画面に出さない）。件数1行＋敵名つきの例だけ。
      if (!d || d.total === 0) return ['今の範囲では候補になるマスはありません'];
      const lines = [`候補: この先の戦闘マス ${d.total} 件（候補が2人以下のマス ${d.essential} 件）`];
      const seen = new Set();
      const examples = [];
      for (const sp of d.spots) {
        const label = `${sp.floor}F ${sp.enemyName || sp.threatName}`;
        if (seen.has(label)) continue;
        seen.add(label);
        examples.push(label);
        if (examples.length >= 3) break;
      }
      if (examples.length > 0) lines.push(`例: ${examples.join('、')}`);
      return lines;
    };
    // 外した人（常時表示のリスト）: 戻す操作だけを置く。人数・割合の
    // 集計表示は出さない。
    const removedRows = megidoBasics.megido
      .filter((m) => !derived.owned.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, style: m.style, className: m.class }))
      .sort(byName);
    // 候補アコーディオンの対象は、候補に出る人だけ（外した人は含めない）。
    const matchesFilters = (m) => {
      if (megidoCtx.styleFilter && m.style !== megidoCtx.styleFilter) return false;
      if (queryActive && !normalizeSearchText(m.name).includes(q)) return false;
      return true;
    };
    const styleNames = megidoCtx.styleFilter ? [megidoCtx.styleFilter] : STYLE_ORDER.map((c) => STYLE_NAME[c]);
    const groups = [];
    for (const styleName of styleNames) {
      const roster = megidoBasics.megido.filter(
        (m) => m.style === styleName && derived.owned.has(m.id) && matchesFilters(m));
      const deviating = [];
      const standard = [];
      for (const m of roster) {
        const d = detailOf(details, m.id);
        const row = {
          id: m.id,
          name: m.name,
          style: m.style,
          className: m.class,
          level: d.level,
          deviationText: deviationTextOf(d),
          detail: {
            ...d,
            demandLines: demandLinesOf(m.id),
            formations: formationsByMegido.get(m.id) || [],
          },
        };
        if (row.deviationText) deviating.push(row);
        else standard.push(row);
      }
      deviating.sort(byName);
      standard.sort(byName);
      groups.push({
        code: STYLE_CODE[styleName],
        label: styleName,
        rows: [...deviating, ...standard],
      });
    }
    const vm = {
      removedRows,
      swipeHint: !settings.swipeHintSeen,
      // 検索中は結果が見えるよう、アコーディオンを開いた状態で出す。
      accordionOpen: megidoCtx.accordionOpen || queryActive,
      query: megidoCtx.query,
      styleFilter: megidoCtx.styleFilter,
      expandedId: megidoCtx.expandedId,
      groups,
    };
    const { top, content, searchInput } = buildMegidoView(vm, megidoCallbacks);
    // メギドは区画ビュー。区画がメギドでない間に呼ばれた場合は描かない
    // （需要の非同期読み込み後の再描画が、他の区画を上書きしないため）。
    if (section === 'megido') {
      mountSection(top, content, null);
      megidoMounted = true;
    }
    if (megidoCtx.focusSearch && searchInput && typeof searchInput.focus === 'function') {
      searchInput.focus();
      if (typeof searchInput.setSelectionRange === 'function') {
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }
    megidoCtx.focusSearch = false;
  }

  // 育成フィールドの書き込みの核: 検証は migrate.js の withMegidoField
  // （純粋関数）に一本化し、ここでは実体化・保存・全体更新だけを行う。
  // 全体更新（update）ではメギド区画の DOM は保持されるため、画面内の
  // 表示の追随は patchMegidoRow が担う。
  const setDetailField = async (id, field, value) => {
    ensureDetailsMaterialized();
    const current = formationsData.megidoDetails[id] || normalizeMegidoDetail({});
    const next = withMegidoField(current, field, value, byId.get(id));
    if (!next) return false;
    formationsData = {
      ...formationsData,
      megidoDetails: { ...formationsData.megidoDetails, [id]: next },
    };
    await saveFormationsData(backend, formationsData);
    await update();
    return true;
  };

  // メギド画面の行の表示だけを実データへ合わせる（再描画しない）。
  // 対象: 行のメタ（標準からのズレ）と、開いている詳細・行内レベル
  // セレクトの現在値。
  const patchMegidoRow = (id) => {
    if (!viewEl || typeof viewEl.querySelector !== 'function') return;
    const block = viewEl.querySelector(`.megido-row[data-megido-id="${id}"]`);
    if (!block) return;
    const m = byId.get(id);
    const d = detailOf(formationsData.megidoDetails, id);
    const meta = block.querySelector('.megido-meta');
    if (meta && m) {
      const dev = deviationTextOf(d);
      meta.textContent = `${m.style}／${m.class}${dev ? `／${dev}` : ''}`;
    }
    const controls = block.querySelectorAll('[data-field]');
    controls.forEach((ctl) => {
      const f = ctl.dataset ? ctl.dataset.field : null;
      if (f === 'level') ctl.value = String(d.level);
      else if (f === 'bond_reishou') {
        const slot = ctl.dataset && ctl.dataset.slot != null ? Number(ctl.dataset.slot) : 0;
        ctl.value = String(d.bondSlots[slot] || 0);
      }
      else if (f === 'ougiLevel') ctl.value = String(d.ougiLevel);
      else if (f === 'singularity_level') ctl.value = String(d.singularity);
      else if (f === 'special_reishou') ctl.textContent = d.specialReishou ? 'あり' : 'なし';
    });
  };

  // 候補への所属の変更（外す／戻す）: 保存して全体更新し、メギド画面は
  // 所属が変わるため描き直す（開閉状態とスクロール位置は保持される）。
  const setCandidateOwned = async (id, owned) => {
    ensureDetailsMaterialized();
    const current = formationsData.megidoDetails[id] || normalizeMegidoDetail({});
    formationsData = {
      ...formationsData,
      megidoDetails: {
        ...formationsData.megidoDetails,
        [id]: { ...current, owned },
      },
    };
    await saveFormationsData(backend, formationsData);
    await update();
    if (section === 'megido') renderMegidoView();
  };

  const megidoCallbacks = {
    onQuery: (text) => {
      megidoCtx.query = text;
      megidoCtx.focusSearch = true;
      renderMegidoView();
    },
    onStyleFilter: (s) => {
      megidoCtx.styleFilter = s;
      renderMegidoView();
    },
    onAccordionToggle: (open) => {
      // 開閉は部品内の局所切り替えで済んでいる。ここでは状態の控え
      // だけを持つ（再描画時に復元するため）。
      megidoCtx.accordionOpen = open;
    },
    onExpandChange: (id) => {
      megidoCtx.expandedId = id;
    },
    onRestore: async (id) => { await setCandidateOwned(id, true); },
    onToggleOwned: async (id) => { await setCandidateOwned(id, false); },
    // 左スワイプ（候補から外す）: ピッカーの左スワイプと同じ安全網
    // （取り消し付きの通知）を付ける。初めて外した時だけ、戻し場所
    // の案内を添える（この画面では上の「候補から外したメギド」の
    // リストで戻せる）。
    onSwipeHide: async (id) => {
      await setCandidateOwned(id, false);
      await markSwipeHintSeen();
      const firstTime = !settings.hideToastGuided;
      if (firstTime) {
        settings = { ...settings, hideToastGuided: true };
        await persistSwipeFlags();
      }
      showUndoToast('候補から外しました',
        firstTime ? '候補から外したメギドのリストで戻せます' : null,
        async () => { await setCandidateOwned(id, true); });
    },
    onDismissSwipeHint: async () => {
      await markSwipeHintSeen();
      renderMegidoView();
    },
    // 詳細の編成行から、その編成を開く（編成を組む画面へ）。
    onOpenFormation: (id) => { openFormationBuilder(id); },
    onSetField: async (id, field, value) => {
      if (await setDetailField(id, field, value)) patchMegidoRow(id);
    },
    // 一括割り振り（絆霊宝とレベル）: 選択は部品側で完結し、ここには
    // 確定の1回だけが来る。保存は1回。適用後は行ごとの局所更新では
    // なく画面を再描画する（2026-11-21 ユーザー指示: 変化が見えないと
    // 混乱する。アコーディオン開閉と展開状態は ctx 経由で保持される）。
    // 絆霊宝の一括は4枠モデル: 型（1〜3）を、バーでチェックした枠へ
    // 上書きする（2026-11-21 ユーザー指示。slots 省略時は4枠すべて）。
    // 値 0 は選んだ枠を外すクリア。適用結果は完了の通知で知らせる
    // （migrate.js の withBondBulk が規則の正）。
    onBulkApply: async (kind, value, ids, slots = null) => {
      ensureDetailsMaterialized();
      const details = { ...formationsData.megidoDetails };
      if (kind === 'bond_reishou') {
        let applied = 0;
        for (const id of ids) {
          const current = details[id] || normalizeMegidoDetail({});
          const r = withBondBulk(current, value, byId.get(id), slots);
          if (!r) continue;
          if (r.status === 'applied') { details[id] = r.entry; applied += 1; }
        }
        if (applied > 0) {
          formationsData = { ...formationsData, megidoDetails: details };
          await saveFormationsData(backend, formationsData);
          await update();
          renderMegidoView();
        }
        if (value === 0) {
          const allSlots = !slots || slots.every(Boolean);
          showInfoToast(applied > 0
            ? `絆霊宝: ${applied}体の${allSlots ? '全枠' : '選んだ枠'}を外しました`
            : '絆霊宝: 外す対象はいませんでした');
        } else {
          const typeLabel = ['', '真', '剛', '絆'][value] || '';
          showInfoToast(`絆霊宝「${typeLabel}」: ${applied}体に割り振りました`);
        }
        return;
      }
      const field = 'level';
      let changed = false;
      for (const id of ids) {
        const current = details[id] || normalizeMegidoDetail({});
        const next = withMegidoField(current, field, value, byId.get(id));
        if (next) { details[id] = next; changed = true; }
      }
      if (!changed) return;
      formationsData = { ...formationsData, megidoDetails: details };
      await saveFormationsData(backend, formationsData);
      await update();
      renderMegidoView();
    },
  };

  // ---- ピッカーのスワイプ（候補から外す／詳細シート）と通知 ----
  // ヒントと初回案内の既読は設定（settings）に持つ。
  const persistSwipeFlags = async () => {
    await saveSettings(backend, settings);
  };
  const markSwipeHintSeen = async () => {
    if (settings.swipeHintSeen) return;
    settings = { ...settings, swipeHintSeen: true };
    await persistSwipeFlags();
  };

  let undoToastEl = null;
  let undoToastTimer = null;
  const hideUndoToast = () => {
    if (undoToastTimer) { clearTimeout(undoToastTimer); undoToastTimer = null; }
    if (undoToastEl) { undoToastEl.remove(); undoToastEl = null; }
  };
  // 取り消し付きの通知（数秒で消える）。確認ダイアログは出さない。
  const showUndoToast = (message, note, onUndo) => {
    hideUndoToast();
    const bar = document.createElement('div');
    bar.className = 'undo-toast';
    const msg = document.createElement('span');
    msg.className = 'undo-toast-msg';
    msg.textContent = note ? `${message}（${note}）` : message;
    bar.append(msg);
    const btn = document.createElement('button');
    btn.className = 'undo-toast-btn';
    btn.textContent = '元に戻す';
    btn.addEventListener('click', async () => {
      hideUndoToast();
      await onUndo();
    });
    bar.append(btn);
    document.body.append(bar);
    undoToastEl = bar;
    undoToastTimer = setTimeout(hideUndoToast, 5000);
  };
  // 完了の通知（取り消しなし）: 一括割り振りの結果など、操作の結果を
  // 件数つきで知らせるために使う。表示の仕組みは取り消し通知と共用。
  const showInfoToast = (message) => {
    hideUndoToast();
    const bar = document.createElement('div');
    bar.className = 'undo-toast';
    const msg = document.createElement('span');
    msg.className = 'undo-toast-msg';
    msg.textContent = message;
    bar.append(msg);
    document.body.append(bar);
    undoToastEl = bar;
    undoToastTimer = setTimeout(hideUndoToast, 5000);
  };

  // ピッカーで候補から外す（左スワイプ）: owned を落として保存し、
  // 呼び出し側にピッカーの描き直しを委ねる（戻り値で通知する）。
  // 初めて外した時だけ、通知に「メギドタブで戻せます」を添える。
  const hideCandidateFromPicker = async (id, reopenPicker) => {
    ensureDetailsMaterialized();
    const current = formationsData.megidoDetails[id] || normalizeMegidoDetail({});
    formationsData = {
      ...formationsData,
      megidoDetails: {
        ...formationsData.megidoDetails,
        [id]: { ...current, owned: false },
      },
    };
    await saveFormationsData(backend, formationsData);
    await markSwipeHintSeen();
    const firstTime = !settings.hideToastGuided;
    if (firstTime) {
      settings = { ...settings, hideToastGuided: true };
      await persistSwipeFlags();
    }
    showUndoToast('候補から外しました', firstTime ? 'メギドタブで戻せます' : null, async () => {
      await setCandidateOwned(id, true);
      // 全体更新でピッカーの土台が描き直されることがあるため、元に
      // 戻したら呼び出し側のピッカーを出し直す。
      if (typeof reopenPicker === 'function') reopenPicker();
    });
    await update();
  };

  // ピッカーの詳細シート（右スワイプ）: シートを閉じたら、呼び出し側
  // が渡した再表示関数で元のピッカーへ戻る（スクロール位置は
  // ピッカー側の scrollKey の控えで復元される）。
  const openPickerDetailSheet = (id, reopenPicker) => {
    const m = byId.get(id);
    if (!m) return;
    const d = detailOf(formationsData.megidoDetails, id);
    const content = buildMegidoDetailSheet({
      id, name: m.name, style: m.style, className: m.class,
      detail: {
        ...d,
        formations: formationRowsByMegido(derive()).get(id) || [],
      },
    }, {
      onSetField: async (fid, field, value) => { await setDetailField(fid, field, value); },
      // 詳細の編成行から編成を開く: シートは閉じ、ピッカーへは
      // 戻らない（編成側へ移動するのが操作の続き）。
      onOpenFormation: (fid) => {
        overlay.close();
        openFormationBuilder(fid);
      },
      onClose: () => {
        overlay.close();
        if (typeof reopenPicker === 'function') reopenPicker();
      },
    });
    markSwipeHintSeen();
    overlay.openSheet(content);
  };

  // 後続スライスと動作確認のための入口（結果の操作はここから履歴に積まれる）。
  const applyAndSave = async (op) => {
    sheetCtx = null;
    overlay.close();
    history = applyOp(history, op);
    await persistRun();
    await update();
  };
  window.__tower = { applyOp: applyAndSave, getState: () => derive(), loader, backend };

  // 画面幅がブレークポイントを跨いだら、描き先（ペイン／単一カラム）を
  // 切り替えるため再描画する。レイアウトだけの追随で、状態は変えない。
  if (desktopMQ && typeof desktopMQ.addEventListener === 'function') {
    desktopMQ.addEventListener('change', () => { update(); });
  }

  await update();

  // 移行があった初回は、結果を1枚で表示する。
  if (migrationSummary && !(meta && meta.migrationShown)) {
    const wrap = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = '旧ツールからの引き継ぎ';
    wrap.append(title);
    const p = document.createElement('p');
    const failed = migrationSummary.failed.length > 0 ? `（読み取れなかったもの: ${migrationSummary.failed.join('、')}）` : '';
    const seeded = migrationSummary.reishouSeeded > 0
      ? `霊宝は、編成に付いていたものを ${migrationSummary.reishouSeeded}体分引き継ぎました。`
      : '';
    p.textContent = `編成 ${migrationSummary.formations}件、所持・育成 ${migrationSummary.megidoEntries}件（所持 ${migrationSummary.owned}体）を引き継ぎました${failed}。${seeded}進行中のラン状態（コンディション・塔破力・解放）は引き継ぎません。`;
    wrap.append(p);
    overlay.openSheet(wrap);
    meta = { ...(meta || {}), migrationShown: true };
    await saveMeta(backend, meta);
  }

  // 月替わりの検出（H3）: 前月のランが残っていれば、締めるかどうかを1枚で出す。
  {
    const mk = monthKeyOf(new Date());
    if (currentOps(history).length > 0) {
      if (meta && meta.runMonth && meta.runMonth !== mk && !migrationSummary) {
        const wrap = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = '新しい月に入りました';
        wrap.append(title);
        const p = document.createElement('p');
        p.textContent = '前月のランが残っています。戦績として閉じて、新しいランを始めますか。';
        wrap.append(p);
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '前月のランを戦績として閉じる';
        closeBtn.addEventListener('click', () => {
          // 締める前に、残るものとリセットされるものの確認を挟む（原則9）。
          openCloseMonthConfirm(() => overlay.close(), () => overlay.close());
        });
        wrap.append(closeBtn);
        const keepBtn = document.createElement('button');
        keepBtn.textContent = 'そのまま続ける';
        keepBtn.addEventListener('click', async () => {
          meta = { ...(meta || {}), runMonth: mk };
          await saveMeta(backend, meta);
          overlay.close();
        });
        wrap.append(keepBtn);
        overlay.openSheet(wrap);
      } else if (!meta || !meta.runMonth) {
        meta = { ...(meta || {}), runMonth: mk };
        await saveMeta(backend, meta);
      }
    }
  }

  // 起動時の到着: 今いる階の顔見せカードがこのランでまだなら出す
  // （移行・月替わりのシートが出ている時は maybeShowFaceCard 側の
  // ガードで譲る）。
  await maybeShowFaceCard();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
