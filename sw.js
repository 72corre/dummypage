// Service Worker（tech-foundation.md 第7節）
// アプリ本体と静的JSONをキャッシュし、オフラインで全機能が動くようにする。
// キャッシュは版番号単位で入れ替える。
const APP_VERSION = '171'; // 171: 公開レイアウトの平置き化（2026-11-27、マスター決定 案1）。従来はアプリ（app/）とデータ（data/）の兄弟配置で、アプリは ../data/ を読みに行くため入口が /tower_tool/app/ になっていた。データをアプリ配下（build/app/data/）へ寄せ、読み込み先を ./data/ に変えて、入口をリポジトリ直下（公開URL /tower_tool/ そのもの）にした。変更箇所: main.js の DATA_BASE と、このプリキャッシュの data 2件を ../data/ から ./data/ へ。パイプラインの出力先（lib.mjs の DATA_DIR）・プレビュー生成・テストの読み先も build/app/data/ に揃えた。判定・計算・文面は不変（測定ハーネスで版170とJSON完全一致）。本番と同じローカル配信（サブパス配下・直下が入口の新レイアウト）で、主要画面・素材・データの 404 なし、ディレクトリURLでのオフライン再読み込みが通ることを実ブラウザで確認済み。
// 170: Service Worker のオフライン不備の修正（2026-11-27、本番環境テストの問題1）。入口がディレクトリ形の URL（.../app/、本番の入口形）の時、オフライン再読み込みが net::ERR_FAILED で失敗していた。原因はプリキャッシュのキーが ./index.html で、ディレクトリ URL へのナビゲーションがキャッシュに一致せず、失敗時にキャッシュ済み index.html へ倒す処理も無かったこと。直し方: (1) プリキャッシュに './'（ディレクトリ URL のキー）を足し、(2) fetch ハンドラにナビゲーション専用の分岐を入れ、キャッシュに一致しない場合とネットワークが失敗した場合はキャッシュ済みの ./index.html を返すようにした（キーとリクエスト URL の index.html 有無の正規化）。入口が index.html 形の時の動きと、オンライン時の通常動作は従来どおり。判定・計算・文面は不変（測定ハーネスで版169とJSON完全一致）。本番と同じローカル配信（サブパス配下）で、ディレクトリ形・index.html 形の両方でオフライン再読み込みが通ることを実ブラウザで確認済み。
// 169: メギド画面の操作と詳細の拡張（2026-11-27、マスター決定。V9 のタップ方式の決めを上書き）。(1) メギド画面（管理画面）の候補行を、ピッカーと同じスワイプ文法に揃えた: 左スワイプ＝候補から外す（取り消し付き通知の安全網つき。戻し場所は同じ画面の「候補から外したメギド」のリスト）、右スワイプ＝詳細の開閉（行き先はこの画面のインライン詳細で、「詳細」ボタンのタップと同じ動き。タップ側の操作は従来どおり残す）。行内の操作部品（レベル等のセレクト・ボタン）の上からはスワイプを始めず、一括設定モード中は無効。初回ヒントもピッカーと同じ1行を出す。(2) メギドの詳細（アコーディオン内とピッカーの詳細シートの両方）で、入力欄と汎用特性の下に「このメギドを使っている編成」の節を出した: 対象は保存済み編成だけ（戦闘記録の逆引きは記録画面の既存機能で混ぜない）。行の形は編成一覧の2段組（上段=対象＋勝敗、下段=名前＋メンバー）に揃え、行タップでその編成を開く。編成が無いメギドでは節自体を出さない。件数は全件出す（畳まない）。判定・計算は不変（表示と操作のみ。測定ハーネスで版168とJSON完全一致）。
// 168: 全体構成の決定 問題17（fit-x の仕組みの修理、2026-11-27）。「開始前の確認」の枠グリッドで fit-x（横に実測して縮める仕組み）が効かず、名前・素早さ内訳行・塔効果の行・霊宝名が枠幅を超えて右にはみ出し、左が空いてズレて見えていた。原因は実測で確定: 従来は scaleX(枠幅/文字列幅) を transform-origin: center で掛けていたが、nowrap の文字列が要素幅を超えた時、ブラウザは text-align: center でも文字列を要素の左端から置くため、中央起点の縮小では文字列が右へずれて右端が枠外へ出ていた（fit-x 全種で同じ症状、右へ約7〜14px）。直し方: views.js の fitSlotText が文字列の実描画位置（Range 矩形と要素矩形の左端の差）を実測し、左端起点の scaleX に translateX の補正を重ねて、縮めた文字列の両端が要素の両端に一致するようにした。app.css の .fit-x から transform-origin: center の固定を外した。短縮名への切り替えはしない（マスター決定どおり、確認画面はフルネームのまま）。全272体名・全オーブ名・全霊宝名×代表的な補正行の機械走査ではみ出し0件を確認。判定・計算・文面は不変（表示の仕組みのみ。測定ハーネスで版167とJSON完全一致）。
const DATA_VERSION = '1';
const CACHE_NAME = `tower-tool-v${APP_VERSION}-d${DATA_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/app.css',
  './fonts/material-symbols-outlined-subset.woff2',
  './js/main.js',
  './js/shortnames.js',
  './js/data.js',
  './js/store.js',
  './js/model.js',
  './js/derive.js',
  './js/migrate.js',
  './js/views.js',
  './js/sheet.js',
  './js/explore.js',
  './js/formations.js',
  './js/records.js',
  './js/panels.js',
  './js/builder.js',
  './js/counter.js',
  './js/mechanics.js',
  './js/speed.js',
  './js/chain.js',
  './js/search.js',
  './js/hbomb.js',
  './js/kyoen.js',
  './data/tower-structure.v1.json',
  './data/megido-basics.v1.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    // ページ遷移（入口の読み込み・再読み込み）は、キャッシュ済みの
    // 入口へ倒せるようにする。本番の入口はディレクトリ形の URL
    // （.../tower_tool/）で、その URL のキーがキャッシュに無い場合や、
    // ネットワークが失敗した（オフライン）場合は、プリキャッシュ
    // 済みの ./index.html を返す。
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('./index.html'))
        .then((cached) => {
          if (cached) return cached;
          return fetch(request).catch(() => caches.match('./index.html'));
        }),
    );
    return;
  }
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // 階ごとの敵データや能力ファイルは、読んだ時にキャッシュへ足す。
        // 顔アイコン（asset/メギド/）も、表示した分だけ実行時キャッシュに
        // 入れる（272枚の一括プリキャッシュはしない）。
        const pathname = new URL(request.url).pathname;
        if (response.ok && (pathname.includes('/data/') || pathname.includes('/asset/'))) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
