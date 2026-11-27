// 記録画面・メギド画面・ラン途中からの開始（全画面ビュー）の描画。
// ui-flow.md v3 の横断する画面に対応する:
//   - 記録画面: データの分類ではなく用件の順に並べる。今のラン（塔破力
//     の結論と自分の記録）を先頭に大きく、出せるものの無い節は1行に
//     縮め、月の締め・途中開始・復旧は最下部の操作の行に引っ込める
//     （原則8。積み順の決着は SW94）。
//   - メギド画面: 所持は負の選択（初期状態は全員所持、外す方式）。スタイル
//     ごとに区切り、育成の入力は例外方式（標準からズレた人が先、標準のまま
//     の人は畳む。未所持には育成フォームを出さない）。
//   - ラン途中からの開始（H3）: 「指定しない人の扱い」を先に1回選ばせ、
//     個別の指定は例外にする。段階の指定は固定パネル方式（コンディション
//     の直しと共通部品）。
// このモジュールは DOM の組み立てだけを行い、状態の計算と保存は main.js が担う。

import { bindSearchInput, stagePickerPanel, STYLE_CHIP_CLASS, faceWithStyle, faceIconImg, styleChip } from './views.js';
import { attachCandidateSwipe } from './swipe.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function section(title) {
  const wrap = el('div', 'sheet-section');
  wrap.append(el('h3', 'sheet-section-title', title));
  return wrap;
}

// 出せるものの無い節を1行に縮めた表示。
function compactLine(text) {
  return el('p', 'records-compact', text);
}

// ---- 記録画面 ----
// 積み順（SW94、定義の層＋設計の層の決着）: 今のラン（塔破力の結論と
// 内訳／自分の記録）→ 今のランの戦績 → 編成の勝率 → 終わったラン →
// ズレの直し → その他の操作（書き出し・読み込みを含む）。
// vm: {
//   outlook: { headline, lines: [{label, value, note}], note } | null,
//   selfRecord: { currentLine, lastLine } | null,
//   currentFloors: [{floor, lines: [string]}],
//   tendencies: { enemyRows: [{name, battles, wins, losses, retreats}],
//                 formationRows: [{name, battles, wins, losses, retreats, rateText}], note },
//   ratesTotal: number, ratesShowAll: bool,
//   ratesGroups: [{label, rows: [formationRows と同じ行]}],
//   usageRows: [{name, count, bands: [{label, count}],
//                uses: [{floor, enemiesText, formationName, resultText}]}],
//   usageTotal: number, usageShowAll: bool,
//   driftAnomalies: [string],
//   fixTargets: [{squareId, floor, text}],
//   pastRuns: [{label, closedText, statsText, floors: [{floor, text}]}],
//   canCloseMonth: bool,
// }
// cb: { onCloseMonth, onOpenMidRun, onOpenConditions, onOpenSquare(squareId, floor),
//       onExport, onImportFile(file), onReset, onToggleRatesAll(showAll),
//       onToggleUsageAll(showAll) }
export function buildRecordsView(vm, cb) {
  const wrap = el('div', 'records-view');
  wrap.append(el('h2', 'sheet-title', '記録'));

  // 今のラン: 塔破力はツールが結論と内訳を出す。日付は計算せず、
  // 自分の記録（今月と前回のランの事実）を返す（定義の層の決着）。
  if (vm.outlook || vm.selfRecord) {
    const runSec = section('今のラン');
    if (vm.outlook) {
      if (vm.outlook.headline) {
        runSec.append(el('div', 'records-headline', vm.outlook.headline));
      }
      for (const line of vm.outlook.lines || []) {
        const kv = el('div', 'records-kv');
        kv.append(el('span', 'records-kv-label', line.label));
        kv.append(el('span', 'records-kv-value', line.value));
        if (line.note) kv.append(el('span', 'records-kv-note', `（${line.note}）`));
        runSec.append(kv);
      }
      if (vm.outlook.note) runSec.append(el('p', 'sheet-note', vm.outlook.note));
    }
    if (vm.selfRecord) {
      runSec.append(el('div', 'records-subhead', '自分の記録'));
      runSec.append(el('div', 'records-fact', vm.selfRecord.currentLine));
      if (vm.selfRecord.lastLine) {
        runSec.append(el('div', 'records-fact', vm.selfRecord.lastLine));
      }
    }
    wrap.append(runSec);
  }

  // 今のランの戦績そのもの（階ごとの記録）。
  const recSec = section('今のランの戦績');
  if (vm.currentFloors.length === 0) {
    recSec.append(el('p', 'sheet-note', '戦績はまだありません。'));
  }
  for (const f of vm.currentFloors) {
    recSec.append(el('h4', 'records-floor', `${f.floor}F`));
    for (const line of f.lines) {
      // 行は文字列でも {text, tone} でもよい。tone があれば結果の色を左端に
      // 持たせる（勝利=緑、敗北=赤、探索=ティール。文字が常に正）。
      const isObj = typeof line === 'object' && line !== null;
      recSec.append(el('div', `history-row${isObj && line.tone ? ` tone-${line.tone}` : ''}`,
        isObj ? line.text : line));
    }
  }
  wrap.append(recSec);

  // 編成の勝率（戦績から導出）: ％を主に、勝敗数を併記する。3戦から。
  // 既定は戦闘数が多い順の上位だけ（vm.tendencies.formationRows は
  // main 側で上位に絞ってある）。「すべて見る」で全件を階ごとに
  // 区切って出す（vm.ratesGroups）。出せる行が無い間は1行に縮める。
  const rateRow = (r) => {
    const row = el('div', 'rate-row');
    row.append(el('span', 'rate-name', r.name));
    const rateText = r.rateText || `${Math.round((r.wins / r.battles) * 100)}%`;
    const counts = `${r.wins}勝${r.losses}敗${r.retreats > 0 ? `・${r.retreats}リタイア` : ''}`;
    // 勝率の％はこの節の結論数字（全体構成の決定 問題7・9）:
    // 40px の例外段で出す。行のテキスト自体は従来どおり。
    const result = el('span', 'rate-result');
    result.append(el('span', null, '勝率'));
    result.append(el('span', 'rate-num', rateText));
    result.append(el('span', null, `（${counts}）`));
    row.append(result);
    return row;
  };
  const hasTendencies = vm.tendencies.enemyRows.length > 0 || vm.tendencies.formationRows.length > 0;
  if (!hasTendencies && !vm.ratesShowAll) {
    wrap.append(compactLine(`傾向: ${vm.tendencies.note}`));
  } else {
    const rateSec = section(
      vm.tendencies.formationRows.length > 0 || vm.ratesShowAll ? '編成の勝率' : '傾向（戦績から）',
    );
    if (vm.ratesShowAll && Array.isArray(vm.ratesGroups)) {
      for (const g of vm.ratesGroups) {
        rateSec.append(el('div', 'rate-floor-head', g.label));
        for (const r of g.rows) rateSec.append(rateRow(r));
      }
      if (typeof cb.onToggleRatesAll === 'function') {
        const lessBtn = el('button', 'btn-rates-all', '上位だけ見る');
        lessBtn.addEventListener('click', () => cb.onToggleRatesAll(false));
        rateSec.append(lessBtn);
      }
    } else {
      for (const r of vm.tendencies.formationRows) rateSec.append(rateRow(r));
      if (vm.tendencies.formationRows.length > 0) {
        rateSec.append(el('p', 'sheet-note', '戦闘数が多い順。3戦から表示します。'));
        if ((vm.ratesTotal || 0) > vm.tendencies.formationRows.length
          && typeof cb.onToggleRatesAll === 'function') {
          const moreBtn = el('button', 'btn-rates-all', 'すべて見る（階ごとに表示）');
          moreBtn.addEventListener('click', () => cb.onToggleRatesAll(true));
          rateSec.append(moreBtn);
        }
      }
    }
    for (const r of vm.tendencies.enemyRows) {
      rateSec.append(el('p', '',
        `苦手傾向: ${r.name} — ${r.battles}戦 ${r.wins}勝 ${r.losses}敗 ${r.retreats}リタイア`));
    }
    wrap.append(rateSec);
  }

  // メギドの使用回数（調査 A2・A6）: 戦績全体（今のラン＋終わったラン）
  // の集計で、回数の多い順。評価の色は付けない。行を開くと、その
  // メギドを使った戦闘の一覧（階・敵・編成・結果）が出る（逆引き）。
  // 開閉はこの部品の中の局所切り替えで完結させる（メギド画面の行と
  // 同じ作法）。出せる行が無い間は1行に縮める。
  if (Array.isArray(vm.usageRows)) {
    if (vm.usageRows.length === 0 && !vm.usageShowAll) {
      wrap.append(compactLine('メギドの使用回数: まだ記録がありません。'));
    } else {
      const usageSec = section('メギドの使用回数');
      const usageRow = (r) => {
        const block = el('div', 'usage-block');
        const btn = el('button', 'usage-row');
        const head = el('span', 'usage-head');
        head.append(el('span', 'usage-name', r.name));
        head.append(el('span', 'usage-count', `${r.count}回`));
        btn.append(head);
        if (r.bands && r.bands.length > 0) {
          btn.append(el('span', 'usage-bands',
            r.bands.map((b) => `${b.label}: ${b.count}回`).join('、')));
        }
        block.append(btn);
        const detail = el('div', 'usage-detail');
        detail.hidden = true;
        for (const u of r.uses || []) {
          const parts = [`${u.floor}F`];
          if (u.enemiesText) parts.push(u.enemiesText);
          let line = parts.join(': ');
          if (u.formationName) line += `（編成「${u.formationName}」）`;
          if (u.resultText) line += ` — ${u.resultText}`;
          detail.append(el('div', 'history-row', line));
        }
        block.append(detail);
        btn.addEventListener('click', () => { detail.hidden = !detail.hidden; });
        return block;
      };
      const shownRows = vm.usageShowAll && Array.isArray(vm.usageAllRows)
        ? vm.usageAllRows : vm.usageRows;
      for (const r of shownRows) usageSec.append(usageRow(r));
      usageSec.append(el('p', 'sheet-note',
        '戦闘で使った回数です。行を開くと、どの階でどの敵に使ったかが出ます。'));
      if (typeof cb.onToggleUsageAll === 'function') {
        if (!vm.usageShowAll && (vm.usageTotal || 0) > vm.usageRows.length) {
          const moreBtn = el('button', 'btn-rates-all', 'すべて見る');
          moreBtn.addEventListener('click', () => cb.onToggleUsageAll(true));
          usageSec.append(moreBtn);
        } else if (vm.usageShowAll) {
          const lessBtn = el('button', 'btn-rates-all', '上位だけ見る');
          lessBtn.addEventListener('click', () => cb.onToggleUsageAll(false));
          usageSec.append(lessBtn);
        }
      }
      wrap.append(usageSec);
    }
  }

  // 終わったラン（手渡し）。無い間は1行に縮める。
  if (vm.pastRuns.length === 0) {
    wrap.append(compactLine('終わったラン: まだありません。'));
  } else {
    const pastSec = section('終わったラン');
    for (const run of vm.pastRuns) {
      const block = el('div', 'past-run');
      block.append(el('h4', 'records-floor', `${run.label}のラン（${run.closedText}に締め）`));
      block.append(el('p', '', run.statsText));
      for (const f of run.floors) {
        block.append(el('div', 'history-row', `${f.floor}F: ${f.text}`));
      }
      pastSec.append(block);
    }
    wrap.append(pastSec);
  }

  // ズレの直し（H2）: 疑いがある時だけ節として前に出る。無い間は1行に
  // 縮め、結果の付け直しへの導線だけを残す。
  const fixTargetsBlock = () => {
    const frag = el('div', 'fix-targets');
    for (const t of vm.fixTargets) {
      const btn = el('button', 'fix-row', t.text);
      btn.dataset.squareId = t.squareId;
      btn.dataset.floor = String(t.floor);
      btn.addEventListener('click', () => cb.onOpenSquare(t.squareId, t.floor));
      frag.append(btn);
    }
    const condBtn = el('button', 'btn-open-conditions', 'コンディション画面を開く');
    condBtn.addEventListener('click', cb.onOpenConditions);
    frag.append(condBtn);
    return frag;
  };
  if (vm.driftAnomalies.length === 0) {
    wrap.append(compactLine('ズレの直し: 記録と計算のズレはありません。'));
    if (vm.fixTargets.length > 0) {
      const fixSec = section('結果の付け直し');
      fixSec.append(el('p', 'sheet-note',
        '結果のあるマスは、そのマスのシートで付け直せます。コンディションの直し（緊急回復を含む）はコンディション画面から行います。'));
      fixSec.append(fixTargetsBlock());
      wrap.append(fixSec);
    }
  } else {
    const fixSec = section('ズレの直し');
    fixSec.append(el('p', 'sheet-note', '次の記録は計算と合いません。付け忘れか付け間違いの記録です。'));
    for (const text of vm.driftAnomalies) fixSec.append(el('div', 'history-row', text));
    fixSec.append(el('p', 'sheet-note',
      '結果のあるマスは、そのマスのシートで付け直せます。コンディションの直し（緊急回復を含む）はコンディション画面から行います。'));
    fixSec.append(fixTargetsBlock());
    wrap.append(fixSec);
  }

  // 最下部: たまにしか使わない操作は、操作の行として引っ込める。
  const opsSec = section('その他の操作');

  const closeRow = el('div', 'action-row');
  closeRow.append(el('span', 'action-row-label', '月の締め'));
  const closeBtn = el('button', 'btn-close-month', '今のランを締めて新しいランを始める');
  closeBtn.disabled = !vm.canCloseMonth;
  closeBtn.addEventListener('click', cb.onCloseMonth);
  closeRow.append(closeBtn);
  if (!vm.canCloseMonth) {
    closeRow.append(el('span', 'sheet-note', '今のランにはまだ記録がありません。'));
  }
  opsSec.append(closeRow);

  const midRow = el('div', 'action-row');
  midRow.append(el('span', 'action-row-label', 'ラン途中からの開始'));
  const midBtn = el('button', 'btn-midrun', '途中から開始する');
  midBtn.addEventListener('click', cb.onOpenMidRun);
  midRow.append(midBtn);
  opsSec.append(midRow);

  const ioRow = el('div', 'action-row');
  ioRow.append(el('span', 'action-row-label', '書き出しと読み込み（復旧）'));
  const exportBtn = el('button', 'btn-export', '書き出し（JSON）');
  exportBtn.addEventListener('click', cb.onExport);
  ioRow.append(exportBtn);
  const importLabel = el('label', 'import-label', '読み込み（JSON）');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) cb.onImportFile(file);
  });
  importLabel.append(fileInput);
  ioRow.append(importLabel);
  opsSec.append(ioRow);

  // 全データリセット（棚卸し 8-6）: 確認はアプリ内シート＋4桁コードの
  // ガード（buildResetConfirmView）。ここは入口だけを置く。
  if (typeof cb.onReset === 'function') {
    const resetRow = el('div', 'action-row');
    resetRow.append(el('span', 'action-row-label', '全データリセット'));
    const resetBtn = el('button', 'btn-reset-open', 'すべてのデータを消す');
    resetBtn.addEventListener('click', cb.onReset);
    resetRow.append(resetBtn);
    opsSec.append(resetRow);
  }

  wrap.append(opsSec);
  return wrap;
}

// ---- メギド画面 ----
// 構成は2部制（2026-11-20、メギド登録まわりの再設計）:
//   1. 候補から外したメギドリスト（常時表示）: 戻すボタンだけを置く。
//      外した人数・割合の集計表示は出さない（格差を見せない原則）。
//   2. 候補アコーディオン（畳んである）: 候補に出る全員のリスト。
//      詳細設定と一括割り振りは全部この中。一般の人は開かない。
// アコーディオンの開閉と行の詳細の開閉、一括モードの入り・選択は、
// この部品の中の局所的な表示切り替えで完結させる（全面再描画を
// しない）。検索・絞り込みだけが main 側の再描画を呼ぶ（開閉状態は
// vm.accordionOpen で復元される）。
// 行の高さは固定し、メタ文字列は1行で切り詰める（折り返しで行高が
// 変わる旧画面の欠陥の再演禁止）。
// 霊宝の装備付け替えはこの画面に置かない（編成枠側の既存機能を使う。
// 装備データ自体はこの画面では触らない）。
// vm: { removedRows: [{id, name, style, className}],
//       accordionOpen, query, styleFilter, expandedId,
//       groups: [{ code, label,
//                  rows: [{id, name, style, className, level, deviationText,
//                          detail: {...}}] }] }
// cb: { onRestore(id), onToggleOwned(id), onAccordionToggle(open),
//       onQuery, onStyleFilter, onExpandChange(id|null),
//       onSetField(id, field, value),
//       onBulkApply(kind, value, ids),  （kind: 'bond_reishou'|'level'）
//       onSwipeHide(id), onDismissSwipeHint(),
//       onOpenFormation(formationId) }
// 戻り値: { top, content, searchInput }（top は常に null: 検索・絞り込みは
// アコーディオン上部に固定するため、区画の固定部は使わない）
export const MEGIDO_LEVELS = [70, 75, 77, 79, 80];
export const BOND_LABELS = ['なし', '真', '剛', '絆'];

const BULK_KINDS = [
  // 絆霊宝の一括は「選んだ型を、チェックした枠へ上書きする」
  // （枠の選択はバーの枠ボタン。初期は4枠すべて）。値 0 は選んだ
  // 枠を外すクリア（意味は main 側の適用規則が担う）。
  { kind: 'bond_reishou', label: '絆霊宝', values: BOND_LABELS.map((label, v) => ({ v, label: v === 0 ? 'なし（全枠を外す）' : label })) },
  { kind: 'level', label: 'レベル', values: MEGIDO_LEVELS.map((v) => ({ v, label: `Lv${v}` })) },
];

export function buildMegidoView(vm, cb) {
  const content = el('div', 'megido-view');

  // ---- 1. 候補から外したメギドリスト（常時表示） ----
  const removedSec = el('div', 'meg-removed');
  removedSec.append(el('h3', 'sheet-section-title', '候補から外したメギド'));
  removedSec.append(el('p', 'sheet-note',
    '編成や探索の候補に出ません。戻すと候補に戻ります。'));
  const removedList = el('div', 'meg-removed-list');
  const removedRows = vm.removedRows || [];
  if (removedRows.length === 0) {
    removedList.append(el('p', 'sheet-note meg-removed-empty', '候補から外したメギドはいません。'));
  }
  for (const row of removedRows) {
    const block = el('div', 'meg-removed-row');
    block.dataset.megidoId = row.id;
    // 人の行には顔を添える（見た目の段、2026-11-20。ピッカー・編成枠と
    // 同じ入口に揃え、名前の文字列を読み直す負担を減らす）。
    block.append(faceWithStyle(row.name, row.style));
    const name = el('span', 'meg-removed-name', row.name);
    block.append(name);
    block.append(el('span', 'megido-meta', `${row.style}／${row.className}`));
    const btn = el('button', 'meg-restore-btn', '候補に戻す');
    btn.dataset.megidoId = row.id;
    btn.addEventListener('click', () => cb.onRestore(row.id));
    block.append(btn);
    removedList.append(block);
  }
  removedSec.append(removedList);
  content.append(removedSec);

  // ---- 2. 候補アコーディオン ----
  const acc = el('div', 'meg-accordion');
  const accHead = el('button', 'meg-accordion-head');
  const accTitle = el('span', 'meg-accordion-title', '候補のメギド（詳細設定）');
  const accState = el('span', 'meg-accordion-state', vm.accordionOpen ? '閉じる' : '開く');
  accHead.append(accTitle, accState);
  acc.append(accHead);
  const accBody = el('div', 'meg-accordion-body');
  accBody.hidden = !vm.accordionOpen;
  acc.append(accBody);
  accHead.addEventListener('click', () => {
    accBody.hidden = !accBody.hidden;
    accState.textContent = accBody.hidden ? '開く' : '閉じる';
    if (typeof cb.onAccordionToggle === 'function') cb.onAccordionToggle(!accBody.hidden);
  });

  // 検索・絞り込み（アコーディオン上部に固定）。
  const tools = el('div', 'meg-acc-tools');
  const search = document.createElement('input');
  search.className = 'formation-search';
  search.type = 'text';
  search.value = vm.query || '';
  search.setAttribute('placeholder', '名前で検索');
  bindSearchInput(search, (value) => cb.onQuery(value));
  tools.append(search);
  const filters = el('div', 'formation-filters');
  for (const s of [null, 'ラッシュ', 'カウンター', 'バースト']) {
    const btn = el('button', `filter-chip${vm.styleFilter === s ? ' active' : ''}`,
      s === null ? 'スタイル: すべて' : s);
    btn.dataset.style = s === null ? '' : s;
    btn.addEventListener('click', () => cb.onStyleFilter(s));
    filters.append(btn);
  }
  tools.append(filters);
  accBody.append(tools);

  // 一括割り振り（モード切替）: 入口ボタンと、モード中のバー。
  // モードの状態と選択はこの部品の中だけで持つ（選択タップで再描画
  // しない）。適用で cb.onBulkApply を1回だけ呼び、通常モードへ戻る。
  const bulkState = { kind: null, value: null, selected: new Set(), slots: [true, true, true, true] };
  const bulkEntry = el('div', 'meg-bulk-entry');
  const bulkBar = el('div', 'meg-bulk-bar');
  bulkBar.hidden = true;
  const listWrap = el('div', 'meg-candidate-list');
  const exitBulk = () => {
    bulkState.kind = null;
    bulkState.value = null;
    bulkState.slots = [true, true, true, true];
    bulkState.selected.clear();
    bulkBar.hidden = true;
    bulkEntry.hidden = false;
    listWrap.className = 'meg-candidate-list';
    // 選択ピルの表示は容器のクラスで切り替わる（CSS）。選択中の印は
    // クラスを文字列で落とす（classList の無い環境でも動く書き方）。
    for (const pill of findByClass(listWrap, 'megido-select-pick')) {
      pill.className = 'megido-select-pick';
      pill.textContent = '選ぶ';
    }
  };
  const enterBulk = (kind) => {
    bulkState.kind = kind;
    bulkState.value = null;
    bulkState.slots = [true, true, true, true];
    bulkState.selected.clear();
    bulkBar.hidden = false;
    bulkEntry.hidden = true;
    listWrap.className = 'meg-candidate-list bulk-mode';
    renderBulkBar();
  };
  const renderBulkBar = () => {
    const def = BULK_KINDS.find((k) => k.kind === bulkState.kind);
    bulkBar.textContent = '';
    if (!def) return;
    bulkBar.append(el('span', 'bulk-count',
      `${def.label}を一括設定: ${bulkState.selected.size}体を選択中`));
    // 一括選択: 今リストに出ている全員を選ぶ（絞り込み中はその範囲）。
    // 全員選択済みなら同じボタンで選択を解除する。ピルの表示も同期
    // させる（選択タップと同じ見た目に揃える）。
    const pills = findByClass(listWrap, 'megido-select-pick');
    const renderedIds = pills.map((p) => p.dataset.megidoId).filter(Boolean);
    const allOn = renderedIds.length > 0
      && renderedIds.every((id) => bulkState.selected.has(id));
    const allBtn = el('button', 'btn-bulk-all', allOn ? '選択を解除' : '全員を選ぶ');
    allBtn.addEventListener('click', () => {
      for (const id of renderedIds) {
        if (allOn) bulkState.selected.delete(id);
        else bulkState.selected.add(id);
      }
      for (const pill of pills) {
        const on = bulkState.selected.has(pill.dataset.megidoId);
        pill.className = on ? 'megido-select-pick on' : 'megido-select-pick';
        pill.textContent = on ? '選択中' : '選ぶ';
      }
      renderBulkBar();
    });
    bulkBar.append(allBtn);
    const sel = document.createElement('select');
    sel.className = 'megido-select bulk-value';
    for (const { v, label } of def.values) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = label;
      sel.append(opt);
    }
    // 選択のタップでバーが描き直されても、選んだ値が戻らないように
    // 控えておく（値の選択→人選びの順でも消えない）。
    if (bulkState.value != null) sel.value = String(bulkState.value);
    sel.addEventListener('change', () => { bulkState.value = Number(sel.value); });
    bulkBar.append(sel);
    // 絆霊宝だけ: 上書きする枠の選択（枠1〜枠4、初期は全部入り）。
    // チェックした枠だけが選んだ型で上書きされる（2026-11-21
    // ユーザー提案: 「全員を選ぶ」と同じ作法で、どの枠が上書き
    // されるかが見て分かる形にする）。
    if (bulkState.kind === 'bond_reishou') {
      const slotWrap = el('span', 'bulk-slots');
      bulkState.slots.forEach((on, i) => {
        const b = el('button', on ? 'btn-bulk-slot on' : 'btn-bulk-slot', `枠${i + 1}`);
        b.dataset.slotIndex = String(i);
        b.addEventListener('click', () => {
          bulkState.slots[i] = !bulkState.slots[i];
          renderBulkBar();
        });
        slotWrap.append(b);
      });
      bulkBar.append(slotWrap);
    }
    const applyBtn = el('button', 'btn-bulk-apply', '割り振る');
    // 0体では押せない（押せると無言で終わり、失敗に見えるため）。
    // 絆で枠が1つも選ばれていない時も同様に押せない。
    applyBtn.disabled = bulkState.selected.size === 0
      || (bulkState.kind === 'bond_reishou' && !bulkState.slots.some(Boolean));
    applyBtn.addEventListener('click', () => {
      const ids = [...bulkState.selected];
      const value = Number(sel.value);
      const kind = bulkState.kind;
      const slots = [...bulkState.slots];
      exitBulk();
      if (ids.length > 0 && typeof cb.onBulkApply === 'function') cb.onBulkApply(kind, value, ids, slots);
    });
    bulkBar.append(applyBtn);
    const cancelBtn = el('button', 'btn-bulk-cancel', 'やめる');
    cancelBtn.addEventListener('click', exitBulk);
    bulkBar.append(cancelBtn);
  };
  for (const def of BULK_KINDS) {
    const btn = el('button', 'btn-bulk-enter', `${def.label}を一括設定`);
    btn.dataset.bulkKind = def.kind;
    btn.addEventListener('click', () => enterBulk(def.kind));
    bulkEntry.append(btn);
  }
  accBody.append(bulkEntry);
  accBody.append(bulkBar);

  // 候補の一覧（スタイル別）。対象は候補に出る人だけ。
  const groups = vm.groups || [];
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  if (totalRows === 0) {
    listWrap.append(el('p', 'sheet-note', '条件に合うメギドはいません。'));
  }
  // スワイプの初回ヒント（ピッカーと同じ1行。使うか閉じたら二度と
  // 出さない。判定と永続化は main 側、ここでは表示と通知だけ）。
  if (vm.swipeHint && typeof cb.onDismissSwipeHint === 'function' && totalRows > 0) {
    const hint = el('div', 'swipe-hint');
    hint.append(el('span', 'swipe-hint-text',
      '左スワイプで候補から外す／右スワイプで詳細'));
    const hintClose = el('button', 'swipe-hint-close', '閉じる');
    hintClose.addEventListener('click', () => cb.onDismissSwipeHint());
    hint.append(hintClose);
    listWrap.append(hint);
  }
  for (const group of groups) {
    const head = el('div', 'megido-style-head');
    head.append(el('h3', `megido-style-title ${STYLE_CHIP_CLASS[group.label] || ''}`, group.label));
    listWrap.append(head);
    for (const row of group.rows) {
      listWrap.append(buildMegidoRow(vm, row, cb, bulkState, renderBulkBar));
    }
  }
  accBody.append(listWrap);
  content.append(acc);
  return { top: null, content, searchInput: search };
}

// 子要素をクラス名で集める（querySelectorAll の無い環境向け）。
function findByClass(root, className, out = []) {
  for (const c of root.children || []) {
    if (String(c.className || '').split(' ').includes(className)) out.push(c);
    findByClass(c, className, out);
  }
  return out;
}

function buildMegidoRow(vm, row, cb, bulkState, renderBulkBar) {
  const block = el('div', 'megido-row');
  block.dataset.megidoId = row.id;
  const head = el('div', 'megido-row-head');
  // 一括モードの選択ピル（通常モードでは CSS で隠れる）。
  const selBtn = el('button', 'megido-select-pick', '選ぶ');
  selBtn.dataset.megidoId = row.id;
  selBtn.setAttribute('aria-label', '一括設定の対象に選ぶ');
  selBtn.addEventListener('click', () => {
    if (!bulkState || !bulkState.kind) return;
    if (bulkState.selected.has(row.id)) {
      bulkState.selected.delete(row.id);
      selBtn.className = 'megido-select-pick';
      selBtn.textContent = '選ぶ';
    } else {
      bulkState.selected.add(row.id);
      selBtn.className = 'megido-select-pick on';
      selBtn.textContent = '選択中';
    }
    renderBulkBar();
  });
  head.append(selBtn);
  // 人の行には顔を添える（見た目の段、2026-11-20。候補4）。
  head.append(faceWithStyle(row.name, row.style));
  head.append(el('span', 'megido-name', row.name));
  const metaText = `${row.style}／${row.className}${row.deviationText ? `／${row.deviationText}` : ''}`;
  const meta = el('span', 'megido-meta', metaText);
  head.append(meta);
  // レベルは最も触る頻度が高いため、詳細を開かずに行の上で直接変える。
  if (row.level != null && typeof cb.onSetField === 'function') {
    const lvSel = document.createElement('select');
    lvSel.className = 'megido-select megido-lv-inline';
    lvSel.dataset.megidoId = row.id;
    lvSel.dataset.field = 'level';
    for (const lv of MEGIDO_LEVELS) {
      const opt = document.createElement('option');
      opt.value = String(lv);
      opt.textContent = `Lv${lv}`;
      lvSel.append(opt);
    }
    lvSel.value = String(row.level);
    lvSel.addEventListener('change', () => cb.onSetField(row.id, 'level', Number(lvSel.value)));
    head.append(lvSel);
  }
  const expBtn = el('button', 'megido-expand', vm.expandedId === row.id ? '閉じる' : '詳細');
  head.append(expBtn);

  // スワイプ（タイプA、ピッカーと同じ文法。2026-11-27 マスター決定で
  // V9 のタップ方式に上書き）: 左＝候補から外す、右＝詳細の開閉。
  // 右スワイプの行き先は、この画面の詳細であるインライン展開
  // （「詳細」ボタンのタップと同じ動き）に揃える。需要行と
  // 「候補から外す」を含むこの画面の詳細が正で、ピッカーの詳細
  // シート（育成だけの小さいシート）とは行き先を分ける。タップ側の
  // 操作（詳細ボタン・行内レベル等）は従来どおり残す。
  // コールバック（cb.onSwipeHide）が無い呼び出しでは付けない。
  const swipeOn = typeof cb.onSwipeHide === 'function';
  if (swipeOn) {
    const wrap = el('div', 'cand-wrap meg-head-wrap');
    const revL = el('div', 'swipe-reveal swipe-reveal-l', '詳細');
    const revR = el('div', 'swipe-reveal swipe-reveal-r', '候補から外す');
    wrap.append(revL, revR, head);
    block.append(wrap);
  } else {
    block.append(head);
  }

  // 詳細の開閉は局所切り替え（再描画しない）。中身は初回に組み立てる。
  let detailEl = null;
  const ensureDetail = () => {
    if (detailEl || !row.detail) return;
    detailEl = buildMegidoDetailFields(row, cb, { withDemand: true });
    const hideBtn = el('button', 'meg-hide-btn', '候補から外す');
    hideBtn.addEventListener('click', () => cb.onToggleOwned(row.id));
    detailEl.append(hideBtn);
    block.append(detailEl);
  };
  if (vm.expandedId === row.id) {
    ensureDetail();
    if (detailEl) detailEl.hidden = false;
  }
  const toggleDetail = () => {
    ensureDetail();
    if (!detailEl) return;
    detailEl.hidden = !detailEl.hidden;
    expBtn.textContent = detailEl.hidden ? '詳細' : '閉じる';
    if (typeof cb.onExpandChange === 'function') {
      cb.onExpandChange(detailEl.hidden ? null : row.id);
    }
  };
  expBtn.addEventListener('click', toggleDetail);

  // スワイプの取り付け: 行内の操作部品（セレクト・ボタン）の上から
  // はスワイプを始めない。一括設定モード中も無効（選択ピルの操作と
  // 競合するため。モードの状態は bulkState をその場で見る）。
  if (swipeOn) {
    attachCandidateSwipe(head, {
      shouldIgnoreStart: (e) => {
        if (bulkState && bulkState.kind) return true;
        const t = e && e.target;
        return Boolean(t && typeof t.closest === 'function'
          && t.closest('select, input, button, a'));
      },
      onSwipeLeft: () => {
        if (bulkState && bulkState.kind) return;
        cb.onSwipeHide(row.id);
      },
      onSwipeRight: () => {
        if (bulkState && bulkState.kind) return;
        toggleDetail();
      },
    });
  }
  return block;
}

// 詳細の編成行に出す霊宝の要約（横に流す形。sheet.js の
// reishouSummaryInline と同じ形・同じ文言）。
// summary: { count, max, special, bond, spdNotes: [{ name,
// segments: [{ text, dir }] }] }
function detailSpdDirText(text, dir) {
  if (dir !== 'up' && dir !== 'down') return text;
  const arrow = dir === 'up' ? '↑' : '↓';
  const note = /（[^）]*）$/.exec(text);
  if (note) return `${text.slice(0, note.index)}${arrow}${note[0]}`;
  return `${text}${arrow}`;
}
function detailReishouInline(summary) {
  const s = summary || { count: 0, max: 4, special: false, bond: false, spdNotes: [] };
  const wrap = el('span', 'formation-member-reishou', `／霊宝 ${s.count}/${s.max || 4}`);
  if (s.special) wrap.append(el('span', 'reishou-mark', '専'));
  if (s.bond) wrap.append(el('span', 'reishou-mark', '絆'));
  (s.spdNotes || []).forEach((note, i) => {
    const line = el('span', 'reishou-spd-note inline');
    line.append(el('span', '', i === 0 && !s.special && !s.bond ? ' ' : '・'));
    line.append(el('span', 'reishou-spd-note-name', note.name));
    for (const seg of note.segments || []) {
      line.append(el('span', '', ' '));
      const cls = seg.dir === 'up' ? 'spd-part spd-up' : seg.dir === 'down' ? 'spd-part spd-down' : '';
      line.append(el('span', cls, detailSpdDirText(seg.text, seg.dir)));
    }
    wrap.append(line);
  });
  return wrap;
}

// 育成の入力部品（アコーディオン内の詳細と、ピッカーの詳細シートで
// 共用）。項目はレベル・奥義Lv・専用霊宝・絆霊宝・凸のみ（霊宝の装備
// 付け替えはここに置かない）。専用霊宝・絆霊宝・凸は、実装のある
// メギドにだけ部品を出す（実装の無いメギドでは項目自体が存在しない。
// フラグは基礎データが正）。
// row: { id, detail: { level, ougiLevel, hasSpecialReishou, specialReishou,
//        hasBondReishou, bondSlots（4枠の配列）, hasSingularity, singularity,
//        trait, demandLines,
//        formations: [{ id, name, targetText, recordText, composition,
//                       members: [{ label, name, style, stage, stageLabel,
//                                   orbText, reishouSummary }] }] } }
// formations は、そのメギドを使っている保存済み編成の行材料（組み立て
// は main 側）。cb.onOpenFormation がある時だけ節を出す。
export function buildMegidoDetailFields(row, cb, opts = {}) {
  const d = row.detail;
  const wrap = el('div', 'megido-detail');
  wrap.hidden = true;
  const id = row.id;

  const levelRow = el('div', 'megido-field');
  levelRow.append(el('span', 'megido-field-label', 'レベル'));
  const levelSel = document.createElement('select');
  levelSel.className = 'megido-select';
  levelSel.dataset.field = 'level';
  for (const lv of MEGIDO_LEVELS) {
    const opt = document.createElement('option');
    opt.value = String(lv);
    opt.textContent = String(lv);
    levelSel.append(opt);
  }
  levelSel.value = String(d.level);
  levelSel.addEventListener('change', () => cb.onSetField(id, 'level', Number(levelSel.value)));
  levelRow.append(levelSel);
  wrap.append(levelRow);

  const ougiRow = el('div', 'megido-field');
  ougiRow.append(el('span', 'megido-field-label', '奥義Lv（1〜99）'));
  const ougiInput = document.createElement('input');
  ougiInput.className = 'megido-number';
  ougiInput.dataset.field = 'ougiLevel';
  ougiInput.type = 'number';
  ougiInput.min = '1';
  ougiInput.max = '99';
  ougiInput.value = String(d.ougiLevel);
  ougiInput.addEventListener('change', () => cb.onSetField(id, 'ougiLevel', Number(ougiInput.value)));
  ougiRow.append(ougiInput);
  wrap.append(ougiRow);

  if (d.hasSpecialReishou) {
    const specialRow = el('div', 'megido-field');
    specialRow.append(el('span', 'megido-field-label', '専用霊宝'));
    const specialBtn = el('button', 'megido-toggle-field', d.specialReishou ? 'あり' : 'なし');
    specialBtn.dataset.field = 'special_reishou';
    let shown = d.specialReishou;
    specialBtn.addEventListener('click', () => {
      shown = !shown;
      specialBtn.textContent = shown ? 'あり' : 'なし';
      cb.onSetField(id, 'special_reishou', shown);
    });
    specialRow.append(specialBtn);
    wrap.append(specialRow);
  }

  if (d.hasBondReishou) {
    // 絆霊宝は専用の匣が4枠あり、各枠に真・剛・絆のいずれか1つを
    // 付ける（2026-11-20 ユーザー確定）。枠ごとに選択を出し、変更は
    // 4枠ぶんの配列で書き込む（値は migrate.js が正規化する）。
    const slots = Array.isArray(d.bondSlots) && d.bondSlots.length === 4
      ? [...d.bondSlots]
      : [typeof d.bondReishou === 'number' ? d.bondReishou : 0, 0, 0, 0];
    const bondSels = [];
    for (let i = 0; i < 4; i += 1) {
      const bondRow = el('div', 'megido-field');
      bondRow.append(el('span', 'megido-field-label', `絆霊宝（${i + 1}枠目）`));
      const bondSel = document.createElement('select');
      bondSel.className = 'megido-select';
      bondSel.dataset.field = 'bond_reishou';
      bondSel.dataset.slot = String(i);
      BOND_LABELS.forEach((label, v) => {
        const opt = document.createElement('option');
        opt.value = String(v);
        opt.textContent = label;
        bondSel.append(opt);
      });
      bondSel.value = String(slots[i]);
      bondSel.addEventListener('change', () => {
        const next = bondSels.map((s) => Number(s.value));
        cb.onSetField(id, 'bond_reishou', next);
      });
      bondSels.push(bondSel);
      bondRow.append(bondSel);
      wrap.append(bondRow);
    }
  }

  if (d.hasSingularity) {
    // 凸の段階定義（2026-11-19）: 凸0=スタート、再召喚1回目（凸1）で
    // スキル++、2回目（凸2）で覚醒スキル++、3回目（凸3）で奥義++、
    // 4回目（凸4）で第2特性が解禁。能力の形そのものが凸で変わる。
    const singRow = el('div', 'megido-field');
    singRow.append(el('span', 'megido-field-label', '凸（0〜4）'));
    const singInput = document.createElement('input');
    singInput.className = 'megido-number';
    singInput.dataset.field = 'singularity_level';
    singInput.type = 'number';
    singInput.min = '0';
    singInput.max = '4';
    singInput.value = String(d.singularity);
    singInput.addEventListener('change', () => cb.onSetField(id, 'singularity_level', Number(singInput.value)));
    singRow.append(singInput);
    wrap.append(singRow);
    wrap.append(el('p', 'sheet-note', '凸1: スキル++、凸2: 覚醒スキル++、凸3: 奥義++、凸4: 第2特性が解禁されます'));
  }

  // 汎用特性（基礎データの原文。表示のみ）。
  if (d.trait) {
    wrap.append(el('p', 'sheet-note', `汎用特性: ${d.trait}`));
  }

  // このメギドを使っている保存済み編成（2026-11-27 マスター決定）:
  // 入力欄と汎用特性の下に出す。対象は保存済み編成だけ（戦闘記録の
  // 逆引きは記録画面の既存機能で、ここには混ぜない）。行の形は
  // 編成一覧の2段組（上段=対象＋勝敗、下段=名前＋メンバー）に
  // 揃え、行タップでその編成を開く。編成が無いメギドでは節自体を
  // 出さない。件数は全件出す（畳まない）: 詳細は開いた人だけが
  // 見る場所で、編成の数そのものが「使われ方」の情報だから。
  if (Array.isArray(d.formations) && d.formations.length > 0
    && typeof cb.onOpenFormation === 'function') {
    const sec = el('div', 'meg-detail-formations');
    sec.append(el('h4', 'meg-detail-formations-title', 'このメギドを使っている編成'));
    for (const f of d.formations) {
      const btn = el('button', 'formation-row meg-formation-row');
      btn.dataset.formationId = f.id;
      if (f.targetText || f.recordText) {
        const top = el('div', 'formation-row-top');
        if (f.targetText) top.append(el('span', 'formation-target', f.targetText));
        if (f.recordText) top.append(el('span', 'formation-record', f.recordText));
        btn.append(top);
      }
      const head = el('div', 'formation-row-head');
      head.append(el('span', 'formation-name', f.name || '（名前なし）'));
      head.append(el('span', 'formation-composition', f.composition || ''));
      btn.append(head);
      for (const m of f.members || []) {
        const line = el('div', 'formation-member');
        line.append(el('span', 'formation-member-label', `${m.label}: `));
        line.append(faceIconImg(m.name));
        if (m.style) line.append(styleChip(m.style));
        line.append(el('span', 'formation-member-name', ` ${m.name}`));
        line.append(el('span', `formation-member-stage sc-${m.stage}`, `（${m.stageLabel}）`));
        line.append(el('span', 'formation-member-orb', `／オーブ${m.orbText}`));
        if (m.reishouSummary) line.append(detailReishouInline(m.reishouSummary));
        btn.append(line);
      }
      btn.addEventListener('click', () => cb.onOpenFormation(f.id));
      sec.append(btn);
    }
    wrap.append(sec);
  }

  // 需要（H6 の集計）: アコーディオン内の詳細だけに出す。
  if (opts.withDemand) {
    if (Array.isArray(d.demandLines) && d.demandLines.length > 0) {
      for (const line of d.demandLines) wrap.append(el('p', 'sheet-note', line));
    } else {
      wrap.append(el('p', 'sheet-note', '候補: 集計中（読み込みが終わると出ます）'));
    }
  }
  return wrap;
}

// ピッカーの詳細シート（右スワイプで開く）: その場で育成を直すための
// 小さいシート。項目はアコーディオン内の詳細と共通部品を使う。閉じたら呼び出し側がピッカーへ戻る（スクロール位置は
// 呼び出し側の責任）。
// vm: { id, name, style, className, detail }
// cb: { onSetField(id, field, value), onOpenFormation(formationId),
//       onClose() }
export function buildMegidoDetailSheet(vm, cb) {
  const wrap = el('div', 'megido-detail-sheet');
  wrap.append(el('h2', 'sheet-title', vm.name));
  wrap.append(el('p', 'sheet-note', `${vm.style}／${vm.className}`));
  const fields = buildMegidoDetailFields(
    { id: vm.id, detail: vm.detail }, cb, { withDemand: false });
  fields.hidden = false;
  wrap.append(fields);
  const closeBtn = el('button', 'btn-detail-sheet-close', '閉じる');
  closeBtn.addEventListener('click', () => cb.onClose());
  wrap.append(closeBtn);
  return wrap;
}

// ---- ラン途中からの開始（H3） ----
// vm: { floor, powerText, note, replaceWarning, defaultMode: 'great'|'unknown',
//       query,
//       groups: [{styleLabel, entries: [{id, name, stageText, stage}]}] }
//     （stageText が '不明' のものは未指定。stage は段階の数値か null）
//       picker: { id, name, stage } | null
// cb: { onFloorChange(floor), onPowerChange(text), onCycle(id)（顔タップ:
//       ピッカーを開く）, onStart(), onDefaultMode(mode), onSearch(query),
//       onPickStage(id, stage|null), onClosePicker() }
// 戻り値: { top, content, actionBar, floorSelect, powerInput, searchInput }
// 「指定しない残り全員の扱い」を先頭で1回だけ選ばせ、個別の指定は例外に
// する。段階の指定は巡回タップをやめ、コンディションの直しと共通の固定
// パネル方式にする。startRun の操作の意味論（不明の扱い、精度警告）は変えない。
export function buildMidRunView(vm, cb) {
  const top = el('div', 'formation-tools');
  const floorRow = el('div', 'megido-field');
  floorRow.append(el('span', 'megido-field-label', '現在の階'));
  const floorSel = document.createElement('select');
  floorSel.className = 'megido-select floor-select';
  for (let f = 1; f <= 35; f += 1) {
    const opt = document.createElement('option');
    opt.value = String(f);
    opt.textContent = `${f}F`;
    floorSel.append(opt);
  }
  floorSel.value = String(vm.floor);
  floorSel.addEventListener('change', () => cb.onFloorChange(Number(floorSel.value)));
  floorRow.append(floorSel);
  top.append(floorRow);

  const powerRow = el('div', 'megido-field');
  powerRow.append(el('span', 'megido-field-label', '現在の塔破力（分かる場合）'));
  const powerInput = document.createElement('input');
  powerInput.className = 'megido-number';
  powerInput.type = 'number';
  powerInput.min = '0';
  powerInput.value = vm.powerText;
  powerInput.setAttribute('placeholder', '30');
  powerInput.addEventListener('input', () => cb.onPowerChange(powerInput.value));
  powerRow.append(powerInput);
  top.append(powerRow);

  // 「指定しない人の扱い」を先頭で1回だけ選ばせる（個別の指定は例外）。
  if (typeof cb.onDefaultMode === 'function' && vm.defaultMode) {
    const modeRow = el('div', 'megido-field default-mode-row');
    modeRow.append(el('span', 'megido-field-label', '指定しない人の扱い'));
    for (const [mode, label] of [['great', '絶好調として始める'], ['unknown', '不明のまま']]) {
      const btn = el('button', `default-mode-btn${vm.defaultMode === mode ? ' active' : ''}`, label);
      btn.dataset.mode = mode;
      btn.addEventListener('click', () => cb.onDefaultMode(mode));
      modeRow.append(btn);
    }
    top.append(modeRow);
  }

  // 名前での検索（長いグリッドから探す負担の軽減）。
  let searchInput = null;
  if (typeof cb.onSearch === 'function') {
    searchInput = document.createElement('input');
    searchInput.className = 'formation-search';
    searchInput.type = 'text';
    searchInput.value = vm.query || '';
    searchInput.setAttribute('placeholder', '名前で検索');
    bindSearchInput(searchInput, (value) => cb.onSearch(value));
    top.append(searchInput);
  }

  const content = el('div', 'midrun-view');
  content.append(el('h2', 'sheet-title', 'ラン途中からの開始'));
  content.append(el('p', 'sheet-note', vm.note));
  if (vm.replaceWarning) content.append(el('p', 'sheet-note warn', vm.replaceWarning));
  for (const group of vm.groups) {
    content.append(el('h3', 'condition-style', group.styleLabel));
    const grid = el('div', 'cond-grid');
    for (const e of group.entries) {
      const picking = vm.picker && vm.picker.id === e.id;
      const cell = el('button', `cond-cell${picking ? ' picking' : ''}`);
      cell.dataset.megidoId = e.id;
      cell.append(el('span', 'cond-name', e.name));
      cell.append(el('span', `condition-stage${e.stage != null ? ` stage-${e.stage}` : ''}`, e.stageText));
      cell.addEventListener('click', () => cb.onCycle(e.id));
      grid.append(cell);
    }
    content.append(grid);
  }

  // 段階の指定は固定パネル（コンディションの直しと共通部品）。
  if (vm.picker && typeof cb.onPickStage === 'function') {
    content.classList.add('has-panel');
    content.append(stagePickerPanel({
      name: vm.picker.name,
      currentStage: vm.picker.stage,
      includeUnknown: true,
      unknownLabel: '不明',
      onPick: (stage) => cb.onPickStage(vm.picker.id, stage),
      onClose: typeof cb.onClosePicker === 'function' ? cb.onClosePicker : null,
    }));
  }

  const actionBar = el('div', 'sheet-actionbar');
  const startBtn = el('button', 'sheet-action-btn act-start-run', 'この状態で始める');
  startBtn.addEventListener('click', cb.onStart);
  actionBar.append(startBtn);
  return { top, content, actionBar, floorSelect: floorSel, powerInput, searchInput };
}

// ---- 読み込み（全体の上書き）の確認（原則9） ----
// 実行前に、何が上書きされ元に戻せないかを示し、先に書き出しで退避する
// 案内を出す。その上で、画面に表示された4桁の数字を正しく入力しないと
// 実行できない形にする（現行ツールと同じ方式）。数字は実行のたびに変わる。
// vm: { code }（表示する4桁の数字）
// cb: { onInput(value), onConfirm, onCancel, onExportFirst }
// 数字の一致で確定ボタンの有効・無効を切り替えるのは、この部品の中だけ
// で完結させる（再描画で入力欄を作り直すと入力が壊れるため）。
export function buildImportConfirmView(vm, cb) {
  const wrap = el('div', 'import-confirm');
  wrap.append(el('h2', 'sheet-title', '読み込みの確認'));
  wrap.append(el('p', 'sheet-note warn',
    '読み込むと、今のデータ（編成・所持と育成・過去のラン・今のランの履歴）はすべて読み込む内容で上書きされ、元に戻せません。'));
  wrap.append(el('p', 'sheet-note',
    '先に今のデータを書き出しておいてください。'));
  const exportBtn = el('button', 'btn-export-first', '今のデータを書き出す（JSON）');
  exportBtn.addEventListener('click', cb.onExportFirst);
  wrap.append(exportBtn);

  wrap.append(el('p', 'sheet-note', '実行するには、次の数字をそのまま入力してください。'));
  const codeEl = el('div', 'import-code', vm.code);
  wrap.append(codeEl);
  const input = document.createElement('input');
  input.className = 'import-code-input';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.setAttribute('placeholder', '4桁の数字');
  const confirmBtn = el('button', 'btn-import-confirm', '上書きして読み込む');
  confirmBtn.disabled = true;
  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value.trim() !== vm.code;
    cb.onInput(input.value);
  });
  wrap.append(input);
  confirmBtn.addEventListener('click', cb.onConfirm);
  wrap.append(confirmBtn);
  const cancelBtn = el('button', 'btn-import-cancel', 'やめる');
  cancelBtn.addEventListener('click', cb.onCancel);
  wrap.append(cancelBtn);
  return wrap;
}

// ---- 月の締めの確認（原則9） ----
// 締める前に、残るもの（過去のランとして保存される記録）とリセット
// されるものを示す確認を挟む。
// vm: { statsText }（今のランの戦績の要約）
// cb: { onConfirm, onCancel }
export function buildCloseMonthConfirmView(vm, cb) {
  const wrap = el('div', 'close-month-confirm');
  wrap.append(el('h2', 'sheet-title', '月の締めの確認'));
  if (vm.statsText) wrap.append(el('p', '', vm.statsText));
  wrap.append(el('p', 'sheet-note',
    '残るもの: 今のランの戦績は「過去のラン」として保存され、翌月、同じマスで前回の記録として出ます。'));
  wrap.append(el('p', 'sheet-note',
    'リセットされるもの: コンディション・塔破力・マスの解放状態は、新しいランで初期化されます。'));
  const confirmBtn = el('button', 'btn-close-month-confirm', '締めて新しいランを始める');
  confirmBtn.addEventListener('click', cb.onConfirm);
  wrap.append(confirmBtn);
  const cancelBtn = el('button', 'btn-close-month-cancel', 'やめる');
  cancelBtn.addEventListener('click', cb.onCancel);
  wrap.append(cancelBtn);
  return wrap;
}

// ---- 全データリセットの確認（棚卸し 8-6、原則9） ----
// 現行ツールのガードの重さを新側の流儀で: アプリ内シートで、消えるものを
// 具体的に示し、先に書き出しで退避する案内を出し、画面に表示された
// 4桁の数字を正しく入力しないと実行できない形にする（ネイティブの
// prompt は使わない）。数字は表示のたびに変わる。
// vm: { code }
// cb: { onInput(value), onConfirm, onCancel, onExportFirst }
export function buildResetConfirmView(vm, cb) {
  const wrap = el('div', 'reset-confirm');
  wrap.append(el('h2', 'sheet-title', '全データリセット'));
  wrap.append(el('p', 'sheet-note warn',
    'この端末に保存された、このツールのデータをすべて消します: 今のランの履歴、編成、所持と育成、過去のラン。消したデータは元に戻せません。'));
  wrap.append(el('p', 'sheet-note',
    '先に今のデータを書き出しておいてください。'));
  const exportBtn = el('button', 'btn-export-first', '今のデータを書き出す（JSON）');
  exportBtn.addEventListener('click', cb.onExportFirst);
  wrap.append(exportBtn);

  wrap.append(el('p', 'sheet-note', '実行するには、次の数字をそのまま入力してください。'));
  wrap.append(el('div', 'import-code', vm.code));
  const input = document.createElement('input');
  input.className = 'import-code-input';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.setAttribute('placeholder', '4桁の数字');
  const confirmBtn = el('button', 'btn-reset-confirm', 'すべてのデータを消す');
  confirmBtn.disabled = true;
  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value.trim() !== vm.code;
    cb.onInput(input.value);
  });
  wrap.append(input);
  confirmBtn.addEventListener('click', cb.onConfirm);
  wrap.append(confirmBtn);
  const cancelBtn = el('button', 'btn-reset-cancel', 'やめる');
  cancelBtn.addEventListener('click', cb.onCancel);
  wrap.append(cancelBtn);
  return wrap;
}

// ---- 横断検索（棚卸し 2-10） ----
// マス（敵名・ルール）・メギド・敵・編成を横断して探し、マスの結果は
// タップでそのマスへジャンプする（現行ツールは選択＋詳細表示までで、
// 階へのスクロールは無かった。新側はジャンプまで通す）。
// 定型検索（プリセット）も現行仕様どおり置く。
// vm: { query, presets: [{key, label, on}], groups: [{title,
//       rows: [{kind, key, main, sub}]}], emptyText }
// cb: { onQuery, onPreset(key), onJumpSquare(floor, squareId),
//       onOpenFormation(id), onOpenMegido(id) }
// 戻り値: { top, content, searchInput }
export function buildSearchView(vm, cb) {
  const top = el('div', 'formation-tools');
  const search = document.createElement('input');
  search.className = 'formation-search';
  search.type = 'text';
  search.value = vm.query;
  search.setAttribute('placeholder', '敵・メギド・編成・効果文で検索');
  bindSearchInput(search, (value) => cb.onQuery(value));
  top.append(search);
  if (Array.isArray(vm.presets) && vm.presets.length > 0) {
    const presets = el('div', 'search-presets');
    for (const p of vm.presets) {
      const btn = el('button', `search-preset${p.on ? ' on' : ''}`, p.label);
      btn.dataset.preset = p.key;
      btn.addEventListener('click', () => cb.onPreset(p.key));
      presets.append(btn);
    }
    top.append(presets);
  }

  const content = el('div', 'search-view');
  content.append(el('h2', 'sheet-title', '検索'));
  if (vm.groups.length === 0) {
    content.append(el('p', 'sheet-note', vm.emptyText || '結果がありません。'));
  }
  for (const group of vm.groups) {
    content.append(el('h3', 'search-group-title', group.title));
    for (const row of group.rows) {
      const btn = el('button', 'search-row');
      btn.dataset.kind = row.kind;
      if (row.squareId) btn.dataset.squareId = row.squareId;
      if (row.floor != null) btn.dataset.floor = String(row.floor);
      btn.append(el('span', 'search-row-main', row.main));
      if (row.sub) btn.append(el('span', 'search-row-sub', row.sub));
      btn.addEventListener('click', () => {
        if (row.kind === 'square') cb.onJumpSquare(row.floor, row.squareId);
        else if (row.kind === 'formation') cb.onOpenFormation(row.id);
        else if (row.kind === 'megido') cb.onOpenMegido(row.id);
        else if (row.kind === 'ability' || row.kind === 'me') cb.onOpenMegido(row.id);
        else if (row.kind === 'orb') cb.onOpenOrb(row.id);
      });
      content.append(btn);
    }
  }
  return { top, content, searchInput: search };
}

// ---- オーブの詳細シート（横断検索の結果から開く） ----
// オーブ単体の詳細画面はアプリに無く、オーブピッカーは編成の文脈が
// 無いと開けない。検索で見つけたオーブの全文を確認する先として、
// メギド詳細シートと同じ作法の最小のシートを用意する。
// vm: { name, meta, trait, skill }
// cb: { onClose }
export function buildOrbDetailSheet(vm, cb) {
  const wrap = el('div', 'orb-detail-sheet');
  wrap.append(el('h2', 'sheet-title', vm.name));
  if (vm.meta) wrap.append(el('p', 'sheet-note', vm.meta));
  if (vm.trait) {
    const sec = section('特性');
    sec.append(el('p', 'guide-line', vm.trait));
    wrap.append(sec);
  }
  if (vm.skill) {
    const sec = section('スキル');
    sec.append(el('p', 'guide-line', vm.skill));
    wrap.append(sec);
  }
  const closeBtn = el('button', 'btn-detail-sheet-close', '閉じる');
  closeBtn.addEventListener('click', () => cb.onClose());
  wrap.append(closeBtn);
  return wrap;
}

// ---- 顔見せカード（SW90、2026-11-21） ----
// 階に入った瞬間に出す1枚。テーマ・バトルルール・ボス名・要注意の敵・
// 一行ヒント・注記だけを顔見せし、
// 閉じたらその階のマップへ戻る。読み物ではなく顔見せのため、
// 敵・探索マスの一覧とガイド本文は持たない（マップ自体が一覧であり、
// ガイドの警告は該当マスのシートの注記へ移した）。自動表示は
// その階にそのランで初めて着いたとき1回だけ（main 側の
// maybeShowFaceCard が表示済みを管理する）。階見出し帯の「？」からは
// いつでも再表示できる。
// vm: { floor, themeText, ruleText, bossName, notableEnemy, floorHint, notes: [string] }
// cb: { onClose }
export function buildFaceCardView(vm, cb) {
  const wrap = el('div', 'face-card');
  wrap.append(el('div', 'face-card-floor', `${vm.floor}F`));
  // テーマとバトルルールは同じ行にチップで並べる（マップの階見出し
  // 帯と同じ並び。どちらか片方だけでも行を出す）。
  if (vm.themeText || vm.ruleText) {
    const themeRow = el('div', 'face-card-theme-row');
    if (vm.themeText) themeRow.append(el('span', 'face-card-theme', vm.themeText));
    if (vm.ruleText) themeRow.append(el('span', 'face-card-rule', vm.ruleText));
    wrap.append(themeRow);
  }
  if (vm.bossName) wrap.append(el('p', 'face-card-boss', `ボス: ${vm.bossName}`));
  // 要注意の敵（2026-11-21 決定）: 旧ガイドの危険メモと苦手な敵
  // アンケートを材料に、階ごとに1体だけを生成データが持つ。
  // 出典の無い階では行ごと出さない（無理に埋めない）。
  if (vm.notableEnemy) wrap.append(el('p', 'face-card-notable', `要注意: ${vm.notableEnemy}`));
  // 一行ヒント（2026-11-21 決定）: 旧ガイドの階全体テキストを
  // 1行に縮めたもの。要注意とは別の行で、生成データが持つ階だけ
  // 出す（原文に裏付けの無い階には何も出さない）。
  if (vm.floorHint) wrap.append(el('p', 'face-card-hint', `ヒント: ${vm.floorHint}`));
  if (vm.notes && vm.notes.length > 0) {
    const sec = section('この階の注意');
    for (const note of vm.notes) sec.append(el('p', 'guide-line', note));
    wrap.append(sec);
  }
  const closeBtn = el('button', 'btn-face-card-close', 'マップを見る');
  closeBtn.addEventListener('click', cb.onClose);
  wrap.append(closeBtn);
  return wrap;
}
