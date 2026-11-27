// 画面の描画（マップ・上の帯・状態フッター・タブバー・シート／全画面ビューの土台）
// 配置と殻の再設計（ui-flow.md 追記9・10、棚卸し§1・§2・§10）と、
// フッター2段型の確定（2026-11-20）に対応する:
//   - ナビゲーションはフッター2段型: 一番下にタブバー（四角5つ＝
//     マップ／編成／メギド／記録／検索、＋≡メニュー）、その上に状態
//     フッターの常駐行。上部は検索だけの細い帯。シート／モーダルは
//     フッター2段に被らないため、開いた状態でも選択中の四角（現在地）
//     と状態が見えたままになる。
//   - 状態の常駐表示はフッター。粒度は現行ツールに合わせ、閉じた状態では
//     塔破力・予測（見通しの結論）・予測リタイア許容数・スタイル別使用数だけを
//     置き、詳細（次の回復・スタイル別カード・見通しの内訳）は展開部に出す。
//   - 編成・メギド・記録はタブで切り替える区画ビュー（main の中身の差し替え）。
//     マスのシートと、区画の上に重なる全画面ビュー（編成を選ぶ・組む等）は
//     オーバーレイのままで、上の帯の下からフッター2段の上までの範囲に開く。
//   - マスの種別と状態は、色＋アイコンを主、文字を従として区別する
//     （処理済みはグレーに沈め、次に処理できるマスは点滅させる）。

import { CONDITION_STAGES, STYLE_NAME } from './derive.js';

// ---- 色の担い手（スタイルチップ） ----
// 色の割り当ては css/app.css の変数が正。スタイル色はゲーム自身の色
// （ラッシュ=赤、カウンター=青、バースト=黄）で、チップには必ずスタイル名の
// 文字を併記し、色のみで意味を伝えない（要件§7）。
export const STYLE_CHIP_CLASS = { ラッシュ: 'st-rush', カウンター: 'st-counter', バースト: 'st-burst' };

export function styleChip(styleName) {
  const cls = STYLE_CHIP_CLASS[styleName];
  return el('span', `style-chip${cls ? ` ${cls}` : ''}`, styleName);
}

// ---- 顔アイコン（棚卸し 10-6） ----
// 出典は現行ツールの asset/メギド/（research/face-icons.md）。ファイル名は
// メギドのデータ名＋.png で、新側の基礎データの名前と全件一致する。
// 丸く切り抜き、枠はスタイル色（現行ツールの流儀）。読み込みは遅延
// （loading=lazy）で、表示する場面の分だけが読まれる（272枚の一括
// 読み込みはしない）。Service Worker 側は表示した分だけ実行時キャッシュ。
export function faceIconImg(name, className = 'face-icon') {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.loading = 'lazy';
  img.dataset.faceName = name;
  img.src = `asset/メギド/${encodeURIComponent(name)}.png`;
  return img;
}

// スタイル色の枠つき顔（枠の色は css の変数が正）。
// （2026-11-20 見た目の段で発見・修正: 従来は 'face-st-*' という
// CSS に存在しないクラスを出しており、枠は常に --border 色だった。
// CSS の .face-wrap.st-* に合わせて 'st-*' を出す。）
export function faceWithStyle(name, styleName) {
  const wrap = el('span', `face-wrap${styleName ? ` ${STYLE_CHIP_CLASS[styleName] || ''}` : ''}`);
  wrap.append(faceIconImg(name));
  return wrap;
}

// 枠の中の顔（2026-11-20）: スタイル×クラスの複合アイコンを顔の
// 右下のバッジに重ねる。5体横一列の狭い枠ではアイコンの行を別に
// 取れないため。文字のチップとクラス名は呼び出し側が従来どおり
// 併記する（アイコンは文字の添えであり置き換えではない）。
export function faceWithStyleClassBadge(name, styleName, className) {
  const box = el('span', 'slot-face-box');
  box.append(faceWithStyle(name, styleName));
  const icon = styleClassIconImg(styleName, className, 'slot-sc-badge-img');
  if (icon) {
    const badge = el('span', 'slot-sc-badge');
    badge.append(icon);
    box.append(badge);
  }
  return box;
}

// ---- スタイル／クラスのアイコン（ファン素材の試し入れ、2026-11-19） ----
// 出典はユーザーが提供したファンメイド素材（棚卸しは
// research/fan-assets-inventory.md）。利用条件は「AIの学習に使わない」。
// 置き場は asset/ui/（64×64 に縮小・圧縮したコピー）で、顔アイコンと
// 同じく表示する分だけ遅延読み込みし、SW が実行時キャッシュする。
// 対応の根拠: スタイル図形はゲーム内の対応（ラッシュ=赤い六角形、
// カウンター=青系の形、バースト=濃紺の三角形）、クラスの武器は
// ファイター=剣／トルーパー=槍／スナイパー=銃。
// アイコンは文字の添えであり置き換えではない。併記する文字（スタイル
// チップやクラス名）は呼び出し側が従来どおり持つ。
const STYLE_ICON_FILE = { ラッシュ: 'style-rush', カウンター: 'style-counter', バースト: 'style-burst' };
const CLASS_ICON_FILE = { ファイター: 'class-fighter', トルーパー: 'class-trooper', スナイパー: 'class-sniper' };
const STYLE_ICON_SLUG = { ラッシュ: 'rush', カウンター: 'counter', バースト: 'burst' };
const CLASS_ICON_SLUG = { ファイター: 'fighter', トルーパー: 'trooper', スナイパー: 'sniper' };

function uiIconImg(file, className) {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.loading = 'lazy';
  img.src = `asset/ui/${file}.png`;
  return img;
}

// スタイル図形のアイコン。対応の無いスタイル名では null（推測で出さない）。
export function styleIconImg(styleName, className = 'ui-icon') {
  const file = STYLE_ICON_FILE[styleName];
  return file ? uiIconImg(file, className) : null;
}

// クラスの武器アイコン。対応の無いクラス名では null。
export function classIconImg(className, iconClass = 'ui-icon') {
  const file = CLASS_ICON_FILE[className];
  return file ? uiIconImg(file, iconClass) : null;
}

// スタイル×クラスの複合アイコン。どちらか欠ければ null。
export function styleClassIconImg(styleName, className, iconClass = 'ui-icon') {
  const s = STYLE_ICON_SLUG[styleName];
  const c = CLASS_ICON_SLUG[className];
  return s && c ? uiIconImg(`${s}-${c}`, iconClass) : null;
}

// フォトンのアイコン（ファン素材、2026-11-19 収録の5種）。
// フォトンの種別を出す箇所で、文字に添えて使う。
const PHOTON_ICON_FILE = {
  アタック: 'photon-attack',
  スキル: 'photon-skill',
  チャージ: 'photon-charge',
  覚醒: 'photon-awakening',
  奥義: 'photon-ougi',
};

export function photonIconImg(photonName, className = 'ui-icon') {
  const file = PHOTON_ICON_FILE[photonName];
  return file ? uiIconImg(file, className) : null;
}

export const EXPLORE_LABEL = {
  recovery: '回復',
  tower_power: '塔破力',
  attack_buff: '攻撃バフ',
  defense_buff: '防御バフ',
  hp_buff: 'HPバフ',
  status_buff: 'バフ',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clear(root) {
  root.textContent = '';
}

// ---- タブバー（フッター2段型の下段） ----
// ナビゲーションはフッター2段型（2026-11-20 確定。research/
// final-check-audit.md の「ナビゲーション確定」）: 一番下にタブバー、
// その上に状態フッターの常駐行。シート／モーダルはフッター2段に
// 被らない（css 側で下端をずらす）ため、開いている間も選択中の
// 四角の色（現在地）と状態が見えたままになる。区画は「マップ／
// 編成／メギド／記録」で、四角は現在地の表示を兼ねる（棚卸し 1-1）。
// SW89（2026-11-21、research/implementation-list-2026-11-21.md）で
// 再編: タブバーは四角4つ＋≡にし、検索の四角とマップ上部の検索帯は
// 廃止した。検索の入口は≡メニューの先頭の行だけになり、データの
// 書き出し／読み込みは記録画面の中だけに置く（メニューからは外した）。
// 原則3（改訂）: 「元に戻す」「やり直し」は常設せず、タブバー右端の
// ≡ボタンから上向きに開くメニューの中の文字の行にする。履歴から
// 全状態を導出する以上、誤タップで静かに巻き戻る事故は置き場所その
// もので断つ。メニューの並びは: 検索 → 元に戻す・やり直し →
// 不具合・要望を報告する。検索と報告の行は、コールバックがある時
// だけ出す。
// アイコン: 四角／≡／メニュー内の行には Material Symbols のアイコン
// をラベル併記で付ける。描画は CSS の ::before（コードポイント）が
// 担い、ここの DOM はラベルの文字だけを持つ。四角の出し分けは
// data-section、メニュー行は row-search/row-undo/row-redo/row-report
// の印で CSS 側がグリフを選ぶ。
// 塔破力はタブバーに置かない（フッターの状態行が持つ）。階の切り替え
// はマップ区画の階スイッチが持つ。
export const SECTIONS = [
  { id: 'map', label: 'マップ' },
  { id: 'formations', label: '編成' },
  { id: 'megido', label: 'メギド' },
  { id: 'records', label: '記録' },
];

// タブバー（フッター2段の下段）: 四角4つ（区画）＋≡。
// vm: { section, searchActive, menuOpen, canUndo, canRedo }
// 検索ビューを開いている間（searchActive）は、検索が区画の上に
// 重なる一時的なビューであることを示すため、四角の現在地色は
// 付けない（SW89 以前は検索の四角が現在地になった）。
// メニューはタブバーの中身として描き、CSS でフッター2段の上に
// 上向きに開く（.tabbar-menu は .footbar 基準の absolute）。
export function renderTabBar(root, { section, searchActive, menuOpen, canUndo, canRedo }, { onSelectSection, onToggleMenu, onUndo, onRedo, onSearch, onReport }) {
  clear(root);
  const squares = el('div', 'tab-squares');
  squares.setAttribute('role', 'navigation');
  squares.setAttribute('aria-label', '画面の切り替え');
  for (const s of SECTIONS) {
    const on = !searchActive && section === s.id;
    const btn = el('button', `tab-btn${on ? ' tab-on' : ''}`, s.label);
    btn.dataset.section = s.id;
    if (on) btn.setAttribute('aria-current', 'page');
    btn.addEventListener('click', () => onSelectSection(s.id));
    squares.append(btn);
  }
  const menuBtn = el('button', 'tabbar-menu-btn', 'メニュー');
  menuBtn.setAttribute('aria-label', 'メニューを開く');
  menuBtn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  menuBtn.addEventListener('click', onToggleMenu);
  root.append(squares, menuBtn);
  if (menuOpen) {
    const menu = el('div', 'tabbar-menu');
    // 検索（SW89）: 区画ではなく検索ビュー（オーバーレイ全画面）を
    // 開く行。メニューの先頭に置き、操作の行とは区切りで分ける。
    if (typeof onSearch === 'function') {
      const searchBtn = el('button', 'tabbar-menu-row row-search', '検索');
      searchBtn.addEventListener('click', onSearch);
      menu.append(searchBtn);
      menu.append(el('div', 'tabbar-menu-sep'));
    }
    const undoBtn = el('button', 'tabbar-menu-row row-undo', '元に戻す');
    undoBtn.disabled = !canUndo;
    undoBtn.addEventListener('click', onUndo);
    const redoBtn = el('button', 'tabbar-menu-row row-redo', 'やり直し');
    redoBtn.disabled = !canRedo;
    redoBtn.addEventListener('click', onRedo);
    menu.append(undoBtn, redoBtn);
    // 「元に戻す・やり直し」の下に報告の入口を置く（最終チェックの決定）。
    if (typeof onReport === 'function') {
      const reportBtn = el('button', 'tabbar-menu-row row-report', '不具合・要望を報告する');
      reportBtn.addEventListener('click', onReport);
      menu.append(reportBtn);
    }
    root.append(menu);
  }
}

// ---- 状態フッター（M1 の常駐表示） ----
// vm: { notice, state, towerPower, nextTowerFloor,
//       fatigue: { fainted, veryBad },
//       styleUsage: [{style, label, used, capacity}], expanded,
//       styleCards: [{style, label, nextFloor, members: [{name, stage}]}],
//       randomRecovery: {nextFloor} | null, buffText }
// 危険の伝達は点滅ではなく静的な色の状態（dataset の state）で行う
// （最終チェック K5、2026-11-20）: 数値だけでは危険に気づけない人の
// ための非テキスト信号であり、アニメーションは持たない。展開部の形は
// V5 の指定どおり: 「塔破力: X（次の塔破力マスは○F）」→ スタイル別
// ボックス×3（スタイル名／次の回復マスは○F／疲労したメギド）→ 塔効果。
// 精度・ズレの類は出さない（コンディションや塔破力が不明な状況は
// 存在しないため）。
// 常駐の粒度（全体構成の決定 問題1・案2、2026-11-26。版157で実装）:
// フッターは「今の状態」だけに絞る — 塔破力・スタイル別使用数と、
// 悪い状態の人数の先見せ（問題4）だけを置く。見通しの結論（予測・
// 許容・展開部の判定文）はフッターから外し、結論はマップ側の階見出し
// 帯へ移した。見通しの内訳は記録画面の「今のラン」が持つ。旧・上の帯
// にあった長い文章（見通しの説明文、次の回復の一行羅列、初回ガイド
// 文）は常駐に置かない。
// 問題4（案1、2026-11-26。版157で実装）: コンディション表へは主行の
// 右端のボタンから1タップで届く。ボタンには気絶・絶不調の人数を
// 段階色の塗りチップで先見せする（色はコンディション表・候補行と
// 同じ段階色の塗り: 気絶 = --stage-5、絶不調 = --stage-4-fill。
// 人数が0の側は塗りを外し、枠とグレーの文字だけの静かなチップに
// なる）。展開部のスタイル別カードも同じくタップでコンディション
// 表へ行く。
// 問題15（2026-11-27。版167で実装）: A: 展開中はアコーディオンと
// フッター以外を黒20%の覆い（.statebar-scrim）でグレーアウトし、
// 覆いのタップで閉じられる。B: コンディション画面の行の中央寄せは
// conditionContent 側。C: 開閉のタップ領域は主行全体（小さい▲だけ
// の設計は誤り。▲は目印としてだけ置く）。コンディションは
// 「コンディション確認」ボタンとして独立させ、人数は小さく添える
// （版157のチップ縦積みはこのボタンの中の1行に置き換えた。到達性
// ＝1タップは問題4のまま維持）。主行にハンドラを足す都合、内側の
// ボタンのハンドラは伝播を止める（実ブラウザでの二重発火防止。
// スタブ DOM は伝播しないのでテストでは素通りする）。
// フッター展開部のスクロール保持: 展開したまま再描画が走る（記録の追加
// など）たびに展開部の先頭へ戻らないよう、開いている間の位置を控える。
// 閉じたら控えは捨て、次に開く時は先頭から。
let statebarDetailTop = 0;
let statebarDetailWasOpen = false;

export function renderStateFooter(root, vm, { onToggleExpand, onOpenConditions }) {
  clear(root);
  // 状態に応じた静的な色（K5）: コンディションのリスクが高い間は
  // フッター全体が赤系に染まり、回復が推奨される状態では緑系に染まる。
  // 色の種別は data-state 属性で持ち、css 側が属性で切り替える。
  if (vm.state) root.dataset.state = vm.state;
  else delete root.dataset.state;

  // 展開中の覆い（問題15A）: フッター（.footbar のスタッキング
  // コンテキスト）の中に z-index -1 で置くため、フッターの地の上・
  // フッター以外（本文やシート）の上に描かれる。タップで閉じる。
  if (vm.expanded) {
    const scrim = el('div', 'statebar-scrim');
    scrim.addEventListener('click', onToggleExpand);
    root.append(scrim);
  }

  // 元に戻す／やり直しの知らせ（何を取り消した・進めたかを短く出す）
  if (vm.notice) {
    root.append(el('div', 'statebar-notice', vm.notice));
  }

  // 展開部は主行の上に置く（フッターは下端に固定され、上へ伸びる）。
  if (vm.expanded) {
    const detail = stateFooterDetail(vm, onOpenConditions);
    detail.addEventListener('scroll', () => {
      statebarDetailTop = detail.scrollTop || 0;
    }, { passive: true });
    root.append(detail);
    // 復元は append の後に（切り離された要素への scrollTop は破棄される）。
    if (statebarDetailWasOpen) detail.scrollTop = statebarDetailTop;
  } else {
    statebarDetailTop = 0;
  }
  statebarDetailWasOpen = Boolean(vm.expanded);

  // 主行は div（展開ボタンとコンディション表へのボタンの2つの
  // 操作を持つため、ボタンの中にボタンを入れない形にする）。
  // 開閉のタップ領域は主行全体（問題15C）: 主行自体にもハンドラを
  // 付け、内側のボタンのハンドラは伝播を止めて二重発火を防ぐ。
  const main = el('div', 'statebar-main');
  main.addEventListener('click', onToggleExpand);
  const stop = (fn) => (ev) => {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    fn();
  };
  const expand = el('button', 'sb-expand');
  expand.setAttribute('aria-expanded', vm.expanded ? 'true' : 'false');
  expand.setAttribute('aria-label', '塔の状態（タップで詳細を開閉）');
  const power = el('span', 'sb-power');
  power.append(el('span', 'sb-label', '塔破力'));
  power.append(el('span', 'sb-power-num', String(vm.towerPower)));
  expand.append(power);
  const usage = el('span', 'sb-usage');
  for (const u of vm.styleUsage) {
    const chip = el('span', `sb-usage-chip su-${u.style.toLowerCase()}`);
    chip.append(el('span', 'sb-usage-style', u.style));
    chip.append(el('span', 'sb-usage-num',
      u.capacity == null ? `${u.used}` : `${u.used}/${u.capacity}`));
    usage.append(chip);
  }
  expand.append(usage);
  expand.append(el('span', 'sb-chevron', vm.expanded ? '▼' : '▲'));
  expand.addEventListener('click', stop(onToggleExpand));
  main.append(expand);

  // コンディション確認ボタン（問題15Cで独立したボタンに置き換え。
  // 問題4の1タップ到達は維持）: ラベルの下に、気絶・絶不調の人数を
  // 段階色の塗りチップで小さく添える（色はコンディション表・候補行
  // と同じ段階色の塗り: 気絶 = --stage-5、絶不調 = --stage-4-fill。
  // 人数は常時出す（今の状態の表示として形を保ち、0の側は塗りを
  // 外して静かにする）。気絶が左（悪い順）。タップしてもアコーディ
  // オンは開かず、コンディション表が開く（伝播を止める）。
  const fatigue = vm.fatigue || { fainted: 0, veryBad: 0 };
  const cond = el('button', 'sb-cond');
  cond.setAttribute('aria-label', 'コンディション表を開く');
  const condLabel = el('span', 'sb-cond-label');
  condLabel.append(el('span', 'sb-cond-label-line', 'コンディション'));
  condLabel.append(el('span', 'sb-cond-label-line', '確認'));
  cond.append(condLabel);
  const condCounts = el('span', 'sb-cond-counts');
  condCounts.append(el('span',
    `sb-cond-chip cond-5${fatigue.fainted > 0 ? '' : ' is-zero'}`,
    `気絶 ${fatigue.fainted}`));
  condCounts.append(el('span',
    `sb-cond-chip cond-4${fatigue.veryBad > 0 ? '' : ' is-zero'}`,
    `絶不調 ${fatigue.veryBad}`));
  cond.append(condCounts);
  if (typeof onOpenConditions === 'function') {
    cond.addEventListener('click', stop(onOpenConditions));
  }
  main.append(cond);
  root.append(main);
}

// フッターの展開部: 次の回復（ランダム／スタイル別）、スタイル別
// カード（疲労の人数と、段階の下がったメンバー名と段階）。見通しの
// 判定文は置かない（全体構成の決定 問題1: 結論はマップ側、内訳は
// 記録画面）。カードのタップはコンディション画面へ（問題4の導線と
// 同じ行き先）。
// 次の回復の案内の「（残り◯回・次が最後）」の部分。コンディション
// 画面（main.js）と状態バーの詳細で同じ形を出すため、ここに寄せる。
export function recoveryRemainingText(remaining, isLast) {
  return `（残り${remaining}回${isLast ? '・次が最後' : ''}）`;
}

function stateFooterDetail(vm, onOpenConditions) {
  const detail = el('div', 'statebar-detail');

  // (1) 塔破力と次の塔破力マス（V5 の指定形）。
  const power = el('div', 'sb-detail-line sb-power-line',
    vm.nextTowerFloor != null
      ? `塔破力: ${vm.towerPower}（次の塔破力マスは${vm.nextTowerFloor}F）`
      : `塔破力: ${vm.towerPower}（この先に塔破力マスはない）`);
  detail.append(power);

  // (2) スタイル別ボックス×3: スタイル名／次の回復マスは○F／
  // 疲労したメギド。ランダム回復はボックスの外に1行だけ添える。
  if (vm.styleCards && vm.styleCards.length > 0) {
    const cards = el('div', 'sb-cards');
    for (const card of vm.styleCards) {
      const box = el('button', 'sb-card');
      const head = el('div', 'sb-card-head');
      head.append(styleChip(card.label));
      box.append(head);
      box.append(el('div', 'sb-card-next',
        card.nextFloor != null
          ? `次の回復マスは${card.nextFloor}F`
          : `この先に${card.label}の回復マスはない`));
      if (!card.members || card.members.length === 0) {
        box.append(el('div', 'sb-card-none', '全員絶好調'));
      } else {
        for (const m of card.members) {
          const row = el('div', 'sb-card-row');
          row.append(faceIconImg(m.name, 'face-icon face-mini'));
          row.append(el('span', 'sb-card-name', m.name));
          row.append(el('span', `sb-card-stage sc-${m.stage}`, CONDITION_STAGES[m.stage]));
          box.append(row);
        }
      }
      if (typeof onOpenConditions === 'function') {
        box.setAttribute('aria-label', `${card.label}のコンディション表を開く`);
        box.addEventListener('click', onOpenConditions);
      }
      cards.append(box);
    }
    detail.append(cards);
  }
  if (vm.randomRecovery && vm.randomRecovery.nextFloor != null) {
    detail.append(el('div', 'sb-detail-line',
      `ランダム回復: 次のマスは${vm.randomRecovery.nextFloor}F`));
  }

  // (3) 塔効果の蓄積（取得がある場合だけ）
  if (vm.buffText) {
    detail.append(el('div', 'sb-detail-line', vm.buffText));
  }
  return detail;
}

// 予測の短い形: 見通しの結論だけを値にする。事実モード（戦績不足）
// の間は結論が無いので ― 。版157でフッター常駐からは外れたが、
// 他の面（探索の自動編成など）の材料として残す。
export function outlookShort(outlook) {
  if (!outlook || outlook.mode === 'facts') return '―';
  if (outlook.verdict === 'enough') return '35F到達';
  return `${outlook.runOutFloor}Fで不足`;
}

export function outlookText(outlook, hasRecords = false) {
  if (!outlook) return '';
  if (outlook.mode === 'facts') {
    const next = outlook.nextTower
      ? `次の塔破力マスは${outlook.nextTower.floor}F`
      : 'この先に塔破力マスはない';
    // 戦績が付いたら、変わらない事実の説明は畳み、現在の値と次のマスだけを残す。
    if (hasRecords) return `塔破力 ${outlook.currentPower}（${next}）`;
    return `塔破力 ${outlook.currentPower}。最短の進み方では塔破力マスを通らない（${next}）。塔破力の回復はクリアに必須で、踏める塔破力マスを踏んでいけば余る`;
  }
  if (outlook.verdict === 'enough') {
    return `塔破力 ${outlook.currentPower}。このペースなら最後まで足りる`;
  }
  return `塔破力 ${outlook.currentPower}。このペースだと${outlook.runOutFloor}Fで尽きる`;
}

// ---- マップ（M1） ----
// floorEntry: tower-structure の階データ。states: Map squareId -> 'done'|'open'|'locked'
// nextId: 次に処理できるマス（点滅させる）。無ければ null。
export function squareLabel(def) {
  if (!def) return '';
  switch (def.type) {
    case 'start': return '開始';
    case 'boss': return 'ボス';
    case 'battle': return '戦闘';
    // 探索マスは「探索」として名乗る（2026-11-18 のエミュレーション所見:
    // 報酬の名前だけでは、それが探索マスだと分かるのは知っている人だけ）。
    // 報酬の名前はサブラベル側に出す。
    case 'explore': return '探索';
    default: return def.type;
  }
}

export function squareSubLabel(def) {
  if (!def) return '';
  if (def.type === 'boss' || def.type === 'battle') {
    return (def.enemies && def.enemies[0]) || '';
  }
  if (def.type === 'explore') {
    const reward = EXPLORE_LABEL[def.subType] || '';
    if (def.styleKind === 'fixed') return `${reward}・${STYLE_NAME[def.style]}固定`;
    if (def.styleKind === 'random') return `${reward}・ランダム`;
    return reward;
  }
  return '';
}

// マスに出すサブ（文字は従）: 標準セルの階（6列以下）で、かつ敵名が
// マス幅（68px）に収まる長さの時だけ小さく添える。列の多い階では
// セルが細くなり、どうせ切り捨てになる名前は出さない（切り捨てた
// 名前は誤読のもとになる。種類の判別はアイコンと色が担う）。
// 探索のサブは報酬とスタイル（固定スタイルは色でも分かる）。
function squareSubText(def, showSub) {
  if (!def || !showSub) return '';
  if (def.type === 'battle' || def.type === 'boss') {
    const name = (def.enemies && def.enemies[0]) || '';
    return name.length <= 8 ? name : '';
  }
  return squareSubLabel(def);
}

// ---- マスのアイコン（色＋アイコンを主とするノード形） ----
// 種類の判別はアイコンの形が担い、色は決着済みの対応表（css の変数）が
// 担う。文字を消しても種類が読めることが受け入れ条件（追記6）。
// 探索の細目はアイコンで分ける: 回復=十字、塔破力=稲妻、バフ=上矢印、
// その他=きらめき。開始=旗、戦闘=交差した剣、ボス=冠。
const ICON_SHAPES = {
  flag: [['path', { d: 'M6 2h2v20H6zM8 4h10.2L15.4 8l2.8 4H8z' }]],
  swords: [
    ['path', { d: 'M6.4 3.1 16.8 13.5a1.9 1.9 0 0 1-2.7 2.7L3.7 5.8a1.9 1.9 0 0 1 2.7-2.7z' }],
    ['path', { d: 'M17.6 3.1 7.2 13.5a1.9 1.9 0 0 0 2.7 2.7L20.3 5.8a1.9 1.9 0 0 0-2.7-2.7z' }],
    ['circle', { cx: '4.6', cy: '19.4', r: '1.8' }],
    ['circle', { cx: '19.4', cy: '19.4', r: '1.8' }],
  ],
  crown: [
    ['path', { d: 'M12 4.6 15.7 9.2 20.6 5.6 19.4 15a2 2 0 0 1-2 1.7H6.6a2 2 0 0 1-2-1.7L3.4 5.6 8.3 9.2z' }],
    ['rect', { x: '5.4', y: '18.6', width: '13.2', height: '2.1', rx: '1' }],
  ],
  cross: [['path', { d: 'M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z' }]],
  bolt: [['path', { d: 'M13.2 2 5 13.8h5.6L9.4 22 19 10h-5.8z' }]],
  up: [['path', { d: 'M12 3l7.5 8.5h-4.3V21h-6.4v-9.5H4.5z' }]],
  sparkle: [['path', { d: 'M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3z' }]],
};

export function squareIconName(def) {
  if (!def) return 'sparkle';
  if (def.type === 'start') return 'flag';
  if (def.type === 'battle') return 'swords';
  if (def.type === 'boss') return 'crown';
  if (def.type === 'explore') {
    if (def.subType === 'recovery') return 'cross';
    if (def.subType === 'tower_power') return 'bolt';
    if (def.subType) return 'up'; // バフ系（攻撃・防御・HP・ステータス）
    return 'sparkle';
  }
  return 'sparkle';
}

export function squareIcon(def) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sq-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICON_SHAPES[squareIconName(def)]) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

// マップの横スクロール位置の保持（再描画をまたいで1階分だけ覚える）。
// 画面全体は操作のたびに描き直されるため、同じ階の再描画では利用者
// が動かした位置を復元し、階が変わった時だけ初期位置（開始マスと
// 次のマスが見える位置）へ置く。
let mapScrollMem = { floor: null, left: 0 };

function positionMapScroll(scroller, floorEntry, startCell, nextCell) {
  const floorKey = floorEntry && floorEntry.floor != null
    ? floorEntry.floor
    : (startCell ? startCell.dataset.squareId : null);
  scroller.addEventListener('scroll', () => {
    if (mapScrollMem.floor === floorKey) mapScrollMem.left = scroller.scrollLeft;
  }, { passive: true });
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    if (!scroller.isConnected) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    if (max <= 0) {
      mapScrollMem = { floor: floorKey, left: 0 };
      return;
    }
    // マスの中心（スクロール量を含めたコンテンツ座標）。レイアウトに
    // 依存しないよう、画面座標と現在のスクロール量から求める。
    const centerOf = (cell) => {
      const r = cell.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return (r.left - s.left) + scroller.scrollLeft + r.width / 2;
    };
    let left;
    if (mapScrollMem.floor !== floorKey) {
      // 初期位置: 開始マスと次のマスの中点が領域の中央に来る位置。
      // 片方しか無い階（閲覧中の先の階など）は開始マスを中央に置く。
      const points = [];
      if (startCell) points.push(centerOf(startCell));
      if (nextCell) points.push(centerOf(nextCell));
      const target = points.length > 0
        ? points.reduce((a, b) => a + b, 0) / points.length
        : 0;
      left = target - scroller.clientWidth / 2;
    } else {
      left = mapScrollMem.left;
      // 復元した位置で次のマスが見切れる場合は、見える所までだけ寄せる。
      if (nextCell) {
        const r = nextCell.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        const cellLeft = (r.left - s.left) + scroller.scrollLeft;
        const cellRight = cellLeft + r.width;
        if (cellLeft < left) left = cellLeft - 4;
        else if (cellRight > left + scroller.clientWidth) left = cellRight - scroller.clientWidth + 4;
      }
    }
    left = Math.max(0, Math.min(max, left));
    scroller.scrollLeft = left;
    mapScrollMem = { floor: floorKey, left };
  });
}

export function renderMap(root, { floorEntry, adjacency, states, viewOnly, onTapSquare, nextId = null }) {
  clear(root);
  const wrap = el('div', 'map-wrap');
  const grid = floorEntry.layoutGrid;
  // 外周の空行・空列は落とす（データの相対配置は保つ）。セルの大きさ
  // は固定で、グリッドは画面幅に合わせて伸縮しない（下のコメント）。
  let minRow = Infinity; let maxRow = -1; let minCol = Infinity; let maxCol = -1;
  grid.forEach((row, ri) => {
    row.forEach((id, ci) => {
      if (!id) return;
      if (ri < minRow) minRow = ri;
      if (ri > maxRow) maxRow = ri;
      if (ci < minCol) minCol = ci;
      if (ci > maxCol) maxCol = ci;
    });
  });
  if (maxRow < 0) { minRow = 0; maxRow = 0; minCol = 0; maxCol = 0; }
  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;
  const pos = new Map();
  grid.forEach((row, ri) => {
    row.forEach((id, ci) => {
      if (id) pos.set(id, { row: ri - minRow, col: ci - minCol });
    });
  });

  // 接続線（SVG を下に敷く）。線とマスで座標系を1つにそろえるため、
  // 列・行とも均等トラックにし、間隔は gap ではなくマスの margin で
  // 取る（margin はトラックの中心を動かさない）。SVG はグリッドと
  // 同寸のステージ内にだけ敷くので、端点（セル中心の割合）が実中心と
  // 一致する。
  //
  // セルの大きさは全階固定する: 列トラック 74px、行 56px（マスは
  // margin 3px を引いた 68×50）。基準は中間の階（5列、11〜19F。6列
  // の階は無い）が幅390px（内容幅374px）で描く実寸で、トラックは
  // 374/5 ≒ 74.8px、マスは約68.8×50px。
  // 収まりの問題はマスを伸縮させず地図側で吸収する（ui-flow 追記12
  // の決定）: 列の少ない階はグリッドがコンテナより細くなり、ステー
  // ジごと中央に寄る。列の多い階（7列・9列）はステージがコンテナ
  // より広くなり、.map-scroll の中で横スクロールする。ページ全体は
  // 横にはみ出さない。初期のスクロール位置は、開始マスと次のマスが
  // 見える位置に置く（この関数の末尾）。
  // 旧対処の記録: 列を 1fr のみにすると、長いサブラベル（nowrap）の
  // 最小コンテンツ幅で列が膨張し、グリッドがコンテナを超えてはみ
  // 出した。また列の少ない階でマスと間隔を広げる（sparse）対処は、
  // 1列の階でマスが画面幅いっぱいの巨大な板になるため廃止した。
  // minmax(0, 74px) で広い階のトラックを均等に圧縮する対処も、マス
  // 寸法の固定化（本便）で廃止した。
  const scroller = el('div', 'map-scroll');
  const stage = el('div', 'map-stage');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'map-lines');
  svg.setAttribute('viewBox', `0 0 ${cols * 10} ${rows * 10}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const drawn = new Set();
  for (const [id, p] of pos) {
    for (const n of adjacency[id] || []) {
      const q = pos.get(n);
      if (!q) continue;
      const key = [id, n].sort().join('|');
      if (drawn.has(key)) continue;
      drawn.add(key);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(p.col * 10 + 5));
      line.setAttribute('y1', String(p.row * 10 + 5));
      line.setAttribute('x2', String(q.col * 10 + 5));
      line.setAttribute('y2', String(q.row * 10 + 5));
      svg.appendChild(line);
    }
  }
  stage.append(svg);

  const gridEl = el('div', 'map-grid');
  gridEl.style.gridTemplateColumns = `repeat(${cols}, 74px)`;
  gridEl.style.gridTemplateRows = `repeat(${rows}, 56px)`;
  let startCell = null;
  let nextCell = null;
  for (const [id, p] of pos) {
    const def = floorEntry.squares[id];
    const state = states.get(id) || 'locked';
    let subCls = def.type === 'explore' && def.subType ? ` sqx-${def.subType}` : '';
    // 固定スタイルの探索マス（回復・バフとも）の色は、対象スタイルの色
    // （現行ツールの規則。完遂便で確定）。バフマスに自作色（旧 #e08a4c）は
    // 使わない。ランダム回復は無印（白）になる。
    if (def.styleKind === 'fixed' && def.style) {
      const styleCls = { R: ' sqr-rush', C: ' sqr-counter', B: ' sqr-burst' }[def.style];
      if (styleCls) subCls += styleCls;
    }
    const isNext = nextId != null && id === nextId && state === 'open';
    const cell = el('button', `square sq-${def.type}${subCls} state-${state}${viewOnly ? ' view-only' : ''}${isNext ? ' sq-next' : ''}`);
    cell.style.gridColumn = String(p.col + 1);
    cell.style.gridRow = String(p.row + 1);
    cell.dataset.squareId = id;
    // ノード形: アイコン（主）＋種類ラベル＋収まる場合だけのサブ（従）。
    // 処理済みの「済」ピルは廃止し、済はグレーアウトそのもので表す。
    cell.append(squareIcon(def));
    cell.append(el('span', 'sq-label', squareLabel(def)));
    const subText = squareSubText(def, cols <= 6);
    if (subText) cell.append(el('span', 'sq-sub', subText));
    cell.addEventListener('click', () => onTapSquare(id));
    if (def.type === 'start') startCell = cell;
    if (isNext) nextCell = cell;
    gridEl.append(cell);
  }
  stage.append(gridEl);
  scroller.append(stage);
  wrap.append(scroller);
  positionMapScroll(scroller, floorEntry, startCell, nextCell);
  // 注記はステージの外に出す（中にあると SVG が注記の高さまで引き
  // 伸ばされ、閲覧専用階だけ縦に線がずれる）。
  if (viewOnly) wrap.append(el('div', 'map-viewonly', '閲覧専用（まだ到達していない階）'));
  root.append(wrap);
}

// ---- 階スイッチ（マップ区画の先頭） ----
// 階の切り替えはマップ区画側に残す（状態フッターには混ぜない）。
// 中央の階名タップで階一覧シートを開く。区画の移動（編成・メギド・
// 記録）はタブバーの四角が担うため、ここには置かない。
export function renderFloorSwitch(root, { viewFloor }, { onPrevFloor, onNextFloor, onOpenFloorList }) {
  clear(root);
  const wrap = el('div', 'floor-switch');
  const prev = el('button', 'floor-switch-btn', '‹ 前の階');
  prev.disabled = viewFloor <= 1;
  prev.addEventListener('click', onPrevFloor);
  const title = el('button', 'floor-switch-title', `${viewFloor}F`);
  title.setAttribute('aria-label', '階を選ぶ');
  title.addEventListener('click', onOpenFloorList);
  const next = el('button', 'floor-switch-btn', '次の階 ›');
  next.disabled = viewFloor >= 35;
  next.addEventListener('click', onNextFloor);
  wrap.append(prev, title, next);
  root.append(wrap);
}

// ---- 枠の文字の横フィット（2026-11-20、仕組みの修理 2026-11-27） ----
// 5体横一列の枠では最長名（9文字）などが枠幅を超える。割っては
// いけない文字（.fit-x）は、表示時に実測し、横方向だけ縮めて
// 1行に収める（単語の途中で割らないための手当て。縮むのは枠幅を
// 超えた要素だけ）。実ブラウザ以外（テストの DOM スタブ等）では
// 寸法が取れないため何もしない。
//
// 修理の記録（全体構成 問題17）: 従来は scaleX(w/sw) を
// transform-origin: center で掛けていたが、これは「はみ出した
// 文字列が要素の中央に置かれている」前提の計算で、前提が崩れて
// いた。実測すると、nowrap の文字列が要素幅を超えた時、ブラウザは
// text-align: center でも文字列を要素の左端から置く（Range 矩形の
// 左端 = 要素矩形の左端）。そのため中央起点で縮めると、文字列は
// 右へ (w/2)(1-k) だけずれて右端が枠外へ出ていた（名前・素早さ
// 内訳行・塔効果の行など fit-x 全体で同じ症状: 右へ約7〜14px）。
// 直し方: 文字列の実描画位置（Range 矩形と要素矩形の左端の差）を
// 実測し、左端起点の scaleX に translateX の補正を重ねて、縮めた
// 文字列の左端が要素の左端に、右端が要素の右端に一致するよう
// にする。ブラウザのはみ出しの置き方（左端起点でも中央でも）に
// 依らず、実測値から決まるのでずれない。
export function fitSlotText(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  let nodes;
  try { nodes = scope.querySelectorAll('.slot-grid .fit-x'); } catch (e) { return; }
  if (!nodes || typeof nodes.forEach !== 'function') return;
  nodes.forEach((node) => {
    if (!node.style) return;
    node.style.transform = '';
    node.style.transformOrigin = '';
    const w = node.clientWidth || 0;
    let sw = node.scrollWidth || 0;
    if (!(w > 0 && sw > w)) return;
    // 文字列の実描画幅と、要素の左端からのずれを実測する。
    // 取れない環境（スタブ等）では従来どおり左端起点とみなす。
    let shift = 0;
    if (typeof document !== 'undefined' && typeof document.createRange === 'function') {
      try {
        const range = document.createRange();
        range.selectNodeContents(node);
        const tr = range.getBoundingClientRect();
        const nr = node.getBoundingClientRect();
        if (tr && nr && tr.width > 0) {
          sw = tr.width;
          shift = tr.left - nr.left;
        }
      } catch (e) { /* 実測できない場合は shift=0 のまま進む */ }
    }
    if (!(sw > w)) return;
    const k = w / sw;
    node.style.transformOrigin = 'left center';
    node.style.transform = `translateX(${(-shift * k).toFixed(2)}px) scaleX(${k.toFixed(4)})`;
  });
}

// ---- シート／全画面ビューの土台 ----
// 戻り値: { openSheet(content, extras), openFull(content, extras), closeFull(), close() }
// content は DOM 要素。閉じる操作（×、シート外タップ）で下の区画へ戻る。
// オーバーレイは上の帯の下からフッター2段の上までの範囲に開く
// （css 側で上下端をずらす）ため、開いた状態でもタブバーの四角
// （現在地）と状態行が見える（追記10、フッター2段型の確定）。
// 第2引数の onClose は任意: 開いていたものが全部閉じた時に呼ばれる。
// openSheet は中身の付け替えで一度全部閉じるため、その瞬間にも
// 呼ばれる（検索ビューのように「検索が閉じたら文脈を落とす」用途
// では、シートが開く＝検索は閉じる、で意味が一致する）。
// extras は { top, bottom } の任意要素: top はスクロールしない固定部として本文の前に、
// bottom は固定バーとして本文の後に置かれる（シートの下部バー、全画面ビューの上部固定など）。
// extras.onCloseRequest / closeLabel: 下位ビュー（ピッカー等）では、バー右上の
// ボタンとシート外タップを「全部閉じる」でなくそのビューだけを閉じる操作に
// 振り分けるための申告。ラベルは既定で「戻る」になる（「閉じる」と紛らわしくしない）。
// 全画面ビューはシートの上に重ねられる（編成を選ぶ M5）。closeFull は全画面だけを閉じ、
// 下のシートは残る。close は全部閉じる。
export function createOverlay(root, { onClose } = {}) {
  clear(root);
  const backdrop = el('div', 'overlay-backdrop');
  backdrop.hidden = true;
  const sheet = el('div', 'overlay-sheet');
  sheet.hidden = true;
  const full = el('div', 'overlay-full');
  full.hidden = true;
  root.append(backdrop, sheet, full);
  let wasOpen = false;
  // 画面幅が変わったら、枠の文字の横フィットをやり直す。
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', () => { fitSlotText(sheet); fitSlotText(full); });
  }

  // スクロール位置の保持: 再描画のたびに本文を作り直すため、そのままだと
  // scrollTop が毎回 0 に戻る。呼び出し側が extras.scrollKey で「同じ文脈」
  // と申告した表示では、本文のスクロールを随時控えておき、次の描画で
  // 戻す。キーが変われば別の文脈として先頭から。キーを渡さない表示
  // （確認・候補の提示など）は常に従来どおり先頭から開く。
  // 線引きの全体は build/app/README.md のスクロール保持の記録に置く。
  const scrollMem = { 'sheet-body': new Map(), 'full-body': new Map() };

  // 開閉状態の同期: バックドロップはシートか全画面のどちらかが開いて
  // いる間だけ出す（全画面ビューは不透明な地で覆うため、狭い画面では
  // バックドロップが見えることはなく、従来の見た目は変わらない）。
  // あわせて body に ov-open を付け、広い画面のレイアウト（マップペインの
  // 幅の切り替え）が開閉に追随できるようにする。DOM スタブ等の
  // document.body が無い環境では何もしない。
  const sync = () => {
    backdrop.hidden = sheet.hidden && full.hidden;
    const open = !sheet.hidden || !full.hidden;
    const b = typeof document !== 'undefined' ? document.body : null;
    if (b && b.classList && typeof b.classList.toggle === 'function') {
      b.classList.toggle('ov-open', open);
    }
    // 全部閉じた瞬間に知らせる（openSheet の付け替えの途中でも発火
    // する。呼び出し側は「閉じた前提」の後始末だけに使うこと）。
    if (wasOpen && !open && typeof onClose === 'function') onClose();
    wasOpen = open;
  };
  // 最前面のビューの「閉じる」の振り分け先（extras.onCloseRequest）。
  // 下位ビュー（編成構築のピッカー等）では、見出し横のボタンとシート外
  // タップは「全部閉じる」ではなく、そのビューだけを閉じる操作（戻る）
  // にならなければならない（2026-11-19 ユーザー指摘: メギド選択中に
  // 閉じるを押すと編成全体が閉じてしまう）。申告が無いビューは従来
  // どおり全部閉じる。
  let closeRequest = null;
  const closeFull = () => {
    full.hidden = true;
    clear(full);
    closeRequest = null;
    sync();
  };
  const close = () => {
    sheet.hidden = true;
    clear(sheet);
    closeFull();
  };
  backdrop.addEventListener('click', () => {
    if (closeRequest) closeRequest();
    else close();
  });

  // 閉じるボタンの置き場（SW92、ユーザー指示）: 全オーバーレイ共通の
  // 閉じる帯は廃止し、ボタンは各画面の中に寄せる。本文の最初の見出し
  // があればその横に付け、見出しの無い画面（ポップアップ等は見出しを
  // 持つため対象外。顔見せカード等）では本文の先頭に細い行を作って
  // 右端に置く。ボタンの振る舞い（全部閉じる／下位ビューだけ閉じる
  // ＝「戻る」）は従来どおり extras で決まる。
  const TITLE_CLASSES = ['sheet-title', 'hbomb-popup-title'];
  const findTitle = (node) => {
    for (const child of node.children || []) {
      const classes = String(child.className || '').split(' ');
      if (TITLE_CLASSES.some((c) => classes.includes(c))) return child;
      const found = findTitle(child);
      if (found) return found;
    }
    return null;
  };

  const withClose = (container, content, className, extras) => {
    clear(container);
    const onCloseRequest = extras && typeof extras.onCloseRequest === 'function'
      ? extras.onCloseRequest : null;
    const closeBtn = el('button', 'overlay-close',
      (extras && extras.closeLabel) || (onCloseRequest ? '戻る' : '閉じる'));
    closeBtn.addEventListener('click', () => {
      if (onCloseRequest) onCloseRequest();
      else close();
    });
    if (extras && extras.top) container.append(extras.top);
    const body = el('div', className);
    // 見出しは本文側を正とし、無ければ固定部（top）側も探す
    // （ピッカー再設計 2026-11-25: 見出し行を固定ヘッダーに置く画面では、
    // 閉じるボタンもその見出しの横に寄せる）。
    const title = findTitle(content)
      || (extras && extras.top ? findTitle(extras.top) : null);
    if (title) {
      title.classList.add('overlay-title');
      title.append(closeBtn);
    } else {
      const head = el('div', 'overlay-head');
      head.append(closeBtn);
      body.append(head);
    }
    body.append(content);
    container.append(body);
    const scrollKey = extras && extras.scrollKey != null ? extras.scrollKey : null;
    if (scrollKey != null && scrollMem[className]) {
      const saved = scrollMem[className].get(scrollKey);
      if (typeof saved === 'number') body.scrollTop = saved;
      body.addEventListener('scroll', () => {
        scrollMem[className].set(scrollKey, body.scrollTop || 0);
      }, { passive: true });
    }
    if (extras && extras.bottom) container.append(extras.bottom);
    // 枠の文字の横フィット（表示状態で実測する。フォント等の
    // 後読みで幅が変わる場合に備え、次のフレームでもう一度）。
    fitSlotText(container);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => fitSlotText(container));
    }
  };

  return {
    close,
    closeFull,
    isOpen: () => !sheet.hidden || !full.hidden,
    isFullOpen: () => !full.hidden,
    openSheet(content, extras) {
      close();
      // 表示してから本文を作る: 非表示（display:none）の要素へ入れた
      // scrollTop はレイアウトが無く破棄されるため、スクロール復元は
      // 表示状態でなければならない。
      sheet.hidden = false;
      withClose(sheet, content, 'sheet-body', extras);
      closeRequest = extras && typeof extras.onCloseRequest === 'function'
        ? extras.onCloseRequest : null;
      sync();
    },
    openFull(content, extras) {
      full.hidden = false;
      withClose(full, content, 'full-body', extras);
      closeRequest = extras && typeof extras.onCloseRequest === 'function'
        ? extras.onCloseRequest : null;
      sync();
    },
  };
}

// ---- 階一覧シートの内容 ----
// 定義は page-definitions.md #17（階全体ページ）。行の構成: 階番号＋
// 現在階／閲覧中の印＋王冠とボス名＋その階の回復・塔破力マスの記号
// （記号は固定5スロット: 塔破力・R回復・C回復・B回復・ランダム回復）。
// 「ボス:」「閲覧専用」の文字は出さない（ユーザー 2026-11-21）。
// clearedFloors（任意）: ボス勝利済みの階の集合。その階には済の印を付ける。
// topThreatByFloor（任意、全体構成の決定 問題5・案1）: 階→「一番の
// 脅威」のラベル（counter.js の floorTopThreatLabel で機械的に決めた
// もの）。ラベルのある階だけ、行の下段に1行で出す。
export function floorListContent(structure, currentFloor, viewFloor, onSelect, clearedFloors, topThreatByFloor = null) {
  const wrap = el('div', 'floor-list');
  wrap.append(el('h2', 'sheet-title', '階を選ぶ'));
  for (const f of structure.floors) {
    const row = el('button', 'floor-row');
    const main = el('span', 'floor-row-main');
    main.append(el('span', 'floor-row-num', `${f.floor}F`));
    // 現在階と閲覧中の印。両方の場所を全行に予約し、印の有無で
    // 行の文字がずれないようにする（定義 #17）。印そのものは
    // Material Symbols のグリフ（CSS の ::before）で描く。
    const marks = el('span', 'floor-row-marks');
    const hereMark = el('span', 'floor-mark floor-mark-here');
    if (f.floor === currentFloor) {
      hereMark.classList.add('on');
      hereMark.title = '現在階';
      row.classList.add('here');
    }
    const viewMark = el('span', 'floor-mark floor-mark-view');
    if (f.floor === viewFloor) {
      viewMark.classList.add('on');
      viewMark.title = '閲覧中';
      row.classList.add('current');
    }
    marks.append(hereMark, viewMark);
    main.append(marks);
    // ボス: マップのボスマスと同じ王冠の記号＋ボス名。
    const boss = el('span', 'floor-row-boss');
    boss.append(squareIcon({ type: 'boss' }));
    boss.append(el('span', 'floor-row-boss-name', f.boss || 'なし'));
    main.append(boss);
    // その階の回復マスと塔破力マスを、マップと同じ記号で出す
    // （回復=十字をスタイル色で、ランダムは白。塔破力=稲妻。
    // バフマスは出さない）。色はマップのマスのアイコン色に揃える。
    // 並びは固定の5スロット（塔破力・ラッシュ回復・カウンター
    // 回復・バースト回復・ランダム回復）: その種類のマスがある
    // 階だけ、その場所に記号を出す。無い場所は空白のままにし、
    // 種類の意味は色ではなく場所が担う（ラッシュの淡灰とランダム
    // の白は色だけでは見分けにくいため。ユーザー 2026-11-21）。
    // 同じ種類のマスが2つある階は、その場所の記号に ×2 を付ける。
    const symbols = el('span', 'floor-row-symbols');
    const defs = Object.values(f.squares || {});
    const recDefs = defs.filter((d) => d.type === 'explore' && d.subType === 'recovery');
    const recFixed = (style) => recDefs
      .filter((d) => d.styleKind === 'fixed' && d.style === style);
    const slotDefs = [
      {
        cls: 'fl-slot-power',
        list: defs.filter((d) => d.type === 'explore' && d.subType === 'tower_power'),
        symCls: 'fl-sym fl-sym-bolt fl-sym-power', title: '塔破力マス',
      },
      {
        cls: 'fl-slot-r', list: recFixed('R'),
        symCls: 'fl-sym fl-sym-cross fl-sym-r', title: `回復マス（${STYLE_NAME.R}）`,
      },
      {
        cls: 'fl-slot-c', list: recFixed('C'),
        symCls: 'fl-sym fl-sym-cross fl-sym-c', title: `回復マス（${STYLE_NAME.C}）`,
      },
      {
        cls: 'fl-slot-b', list: recFixed('B'),
        symCls: 'fl-sym fl-sym-cross fl-sym-b', title: `回復マス（${STYLE_NAME.B}）`,
      },
      {
        cls: 'fl-slot-random',
        list: recDefs.filter((d) => !(d.styleKind === 'fixed' && d.style)),
        symCls: 'fl-sym fl-sym-cross fl-sym-random', title: '回復マス（ランダム）',
      },
    ];
    for (const slotDef of slotDefs) {
      const slot = el('span', `fl-slot ${slotDef.cls}`);
      if (slotDef.list.length) {
        const sym = el('span', slotDef.symCls);
        sym.title = slotDef.title;
        sym.append(squareIcon(slotDef.list[0]));
        if (slotDef.list.length > 1) {
          sym.append(el('span', 'fl-sym-count', `×${slotDef.list.length}`));
        }
        slot.append(sym);
      }
      symbols.append(slot);
    }
    main.append(symbols);
    if (clearedFloors && clearedFloors.has(f.floor)) {
      main.append(el('span', 'floor-row-done', '済'));
    }
    row.append(main);
    // 一番の脅威（全体構成の決定 問題5・案1）: その階の一番の脅威を
    // 行の下段に1行で出す。材料のある階だけ（topThreatByFloor に
    // ラベルがある階だけ）出し、無い階では行は従来の1段のまま。
    const topThreat = topThreatByFloor ? topThreatByFloor.get(f.floor) : null;
    if (topThreat) {
      row.append(el('span', 'floor-row-threat', `一番の脅威: ${topThreat}`));
    }
    row.addEventListener('click', () => onSelect(f.floor));
    wrap.append(row);
  }
  return wrap;
}

// ---- 検索入力の配線（IME 変換を壊さない） ----
// 再描画で入力欄を作り直す画面では、変換中（composition 中）に入力欄が
// 差し替わると IME の変換セッションが壊れて、それ以上打てなくなる。
// そのため変換中はコールバックを呼ばず（＝再描画させず）、変換が確定した
// 時点でだけ絞り込みを走らせる。フォーカスとキャレットの復元は、
// 確定後の再描画に対して main 側の既存の仕組みが担う。
export function bindSearchInput(input, onQuery) {
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    onQuery(input.value);
  });
  input.addEventListener('input', (e) => {
    if (composing || (e && e.isComposing)) return;
    onQuery(input.value);
  });
}

// ---- 段階ピッカーの固定パネル（コンディションの直し・途中開始で共通） ----
// 顔をタップした瞬間に画面下部へ固定表示されるパネル。中身は対象の名前と
// 段階のボタン（includeUnknown の場合は「不明」も）。グリッドの中に差し込む
// 形は、タップした顔とピッカーが離れて原則2に反するため採らない。
// opts: { name, currentStage（null は不明）, unknownLabel, onPick(stage|null), onClose }
export function stagePickerPanel(opts) {
  const panel = el('div', 'stage-panel');
  const currentText = opts.currentStage == null
    ? '不明'
    : CONDITION_STAGES[opts.currentStage];
  panel.append(el('div', 'stage-panel-title', `${opts.name} の段階（現在: ${currentText}）`));
  const row = el('div', 'box-row stage-panel-row');
  CONDITION_STAGES.forEach((name, stage) => {
    const btn = el('button', `stage-btn${opts.currentStage === stage ? ' on' : ''}`, name);
    btn.dataset.stage = String(stage);
    btn.addEventListener('click', () => opts.onPick(stage));
    row.append(btn);
  });
  if (opts.includeUnknown) {
    const btn = el('button', `stage-btn${opts.currentStage == null ? ' on' : ''}`,
      opts.unknownLabel || '不明');
    btn.dataset.stage = 'unknown';
    btn.addEventListener('click', () => opts.onPick(null));
    row.append(btn);
  }
  panel.append(row);
  if (typeof opts.onClose === 'function') {
    const closeBtn = el('button', 'stage-panel-close', '閉じる');
    closeBtn.addEventListener('click', opts.onClose);
    panel.append(closeBtn);
  }
  return panel;
}

// ---- コンディション画面の内容（全画面ビュー） ----
// 既定の表示（summary）: 段階ごとの体数と、絶好調未満の人を悪い順に並べた
// 一覧（誰もいなければ「全員絶好調」の1行）。全員の顔グリッド（grid）は、
// ズレの直しのために開く道具として別に持つ。どちらのモードでも、顔や行を
// タップすると段階ピッカーが画面下部の固定パネルとして開く（stagePickerPanel）。
// vm: { mode: 'summary'|'grid'（未指定は grid）,
//       summary: { counts: [{stage, label, count}],
//                  belowRows: [{id, name, styleLabel, stage}],
//                  allGreat, nextRecoveryLines: [string] },
//       groups: [{styleLabel, headerText, entries: [{id, name, stage}]}],
//       pickId, pickName, pickStage, paceLines: [string] | null }
// cb: { onPick(id), onPickStage(id, stage), onOpenGrid(), onCloseGrid(),
//       onClosePanel() }（省略時は表示のみ）
export function conditionContent(vm, cb) {
  const wrap = el('div', 'condition-view');
  const mode = vm.mode || 'grid';
  wrap.append(el('h2', 'sheet-title', 'コンディション'));

  if (mode === 'summary' && vm.summary) {
    const s = vm.summary;
    for (const line of s.nextRecoveryLines || []) {
      wrap.append(el('p', 'condition-head', line));
    }
    const counts = el('div', 'cond-counts');
    for (const c of s.counts) {
      counts.append(el('span', `cond-count${c.count === 0 ? ' zero' : ` sc-${c.stage}`}`, `${c.label} ${c.count}`));
    }
    wrap.append(counts);
    if (s.allGreat) {
      wrap.append(el('p', 'cond-allgreat', '全員絶好調です。'));
    } else {
      wrap.append(el('h3', 'condition-style', '絶好調より悪い人（悪い順）'));
      for (const e of s.belowRows) {
        const row = el('button', `cond-row${vm.pickId === e.id ? ' picking' : ''}`);
        row.dataset.megidoId = e.id;
        // 問題15B: 行は顔アイコン・名前・段階の3つをひとかたまりに
        // して中央寄せ（従来はスタイルチップの flex:1 で横いっぱいに
        // 散っていた）。スタイルは顔の枠色が担う。アイコンの左端が
        // 行ごとに揃わないのは確定の上で受け入れた形。
        row.append(faceWithStyle(e.name, e.styleLabel));
        row.append(el('span', 'cond-row-name', e.name));
        row.append(el('span', `condition-stage stage-${e.stage}`, CONDITION_STAGES[e.stage]));
        if (cb) row.addEventListener('click', () => cb.onPick(e.id));
        wrap.append(row);
      }
    }
    if (cb && typeof cb.onOpenGrid === 'function') {
      const gridBtn = el('button', 'btn-open-grid', '全員の顔一覧を開く（ズレの直し）');
      gridBtn.addEventListener('click', cb.onOpenGrid);
      wrap.append(gridBtn);
    }
  } else {
    wrap.append(el('p', 'sheet-note', '顔をタップすると、実際の段階に直せます（ズレの直し）。'));
    if (cb && typeof cb.onCloseGrid === 'function') {
      const backBtn = el('button', 'btn-close-grid', '一覧に戻る');
      backBtn.addEventListener('click', cb.onCloseGrid);
      wrap.append(backBtn);
    }
    for (const group of vm.groups || []) {
      wrap.append(el('h3', 'condition-style', group.styleLabel));
      if (group.headerText) wrap.append(el('p', 'condition-head', group.headerText));
      const grid = el('div', 'cond-grid');
      for (const e of group.entries) {
        const cell = el('button', `cond-cell${vm.pickId === e.id ? ' picking' : ''}`);
        cell.dataset.megidoId = e.id;
        cell.append(faceWithStyle(e.name, group.styleLabel));
        cell.append(el('span', 'cond-name', e.name));
        cell.append(el('span', `condition-stage stage-${e.stage}`, CONDITION_STAGES[e.stage]));
        if (cb) cell.addEventListener('click', () => cb.onPick(e.id));
        grid.append(cell);
      }
      wrap.append(grid);
    }
  }

  if (vm.paceLines && vm.paceLines.length > 0) {
    const sec = el('div', 'sheet-section');
    sec.append(el('h3', 'sheet-section-title', '自分のペースの内訳'));
    for (const line of vm.paceLines) sec.append(el('p', '', line));
    wrap.append(sec);
  }

  // 段階ピッカーはグリッドの中に差し込まず、画面下部の固定パネルで出す。
  if (vm.pickId && cb) {
    wrap.classList.add('has-panel');
    wrap.append(stagePickerPanel({
      name: vm.pickName,
      currentStage: vm.pickStage,
      includeUnknown: false,
      onPick: (stage) => cb.onPickStage(vm.pickId, stage),
      onClose: typeof cb.onClosePanel === 'function' ? cb.onClosePanel : null,
    }));
  }
  return wrap;
}

// マスのシート本体（M3〜M11）は sheet.js が担う。
