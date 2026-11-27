// 候補ピッカーの行スワイプ（2026-11-20、メギド登録まわりの再設計）。
// タイプA（単純スワイプ）を採用: 左スワイプ＝候補から外す、右スワイプ＝
// 詳細シート。試作（mock/swipe-prototype.html）を実機 iPhone で確認済み
// の操作感が正。B（少し長押し→スワイプ）は不採用（再検討候補）。
//
// 技術要件（設計メモ research/megido-registration-redesign.md）:
//   - 行は touch-action: pan-y（CSS 側）。縦スクロールはブラウザに渡し、
//     横の動きだけをここで取る。方向ロック: 横と判定するまでは行を
//     動かさず、縦と判定したら（pointercancel が来る）何もしない。
//   - スワイプ中の描画は transform のみ。再描画は入れない。
//   - 閾値（THRESHOLD px）未満で離したらバネ（transition）で戻る。
//   - 背景の色面（「詳細」「候補から外す」）は行のラッパ側に置かれ、
//     進み具合で不透明度だけを変える。
//   - スワイプ確定直後の click（タップ選択）は抑止する。
//
// 使い方: ラッパ要素（position: relative; overflow: hidden）の中に、
// 背景色面 .swipe-reveal-l / .swipe-reveal-r と行要素を入れ、行要素に
// attachCandidateSwipe(row, { onSwipeLeft, onSwipeRight }) を呼ぶ。
// 行要素自身がタップ選択の click を持つ前提（ここでは click を登録
// しない。確定時のみ抑止する）。

export const SWIPE_THRESHOLD = 72;
const LOCK_DISTANCE = 10;
const CLICK_SUPPRESS_MS = 400;

function setClass(el, name, on) {
  // classList の無い環境（テストの DOM スタブ）でも動くよう、文字列で
  // 付け外しする。
  const parts = String(el.className || '').split(' ').filter(Boolean);
  const has = parts.includes(name);
  if (on && !has) el.className = [...parts, name].join(' ');
  else if (!on && has) el.className = parts.filter((p) => p !== name).join(' ');
}

// 行の click ハンドラ側で、スワイプ直後の click かどうかを判定する
// （捕捉フェーズの抑止だけに頼らない確実な経路）。
export function isSwipeSuppressed(row) {
  return Boolean(row && typeof row.__swipeSuppressUntil === 'number'
    && Date.now() < row.__swipeSuppressUntil);
}

export function attachCandidateSwipe(row, handlers) {
  if (!row || typeof row.addEventListener !== 'function') return;
  const wrap = row.parentElement || null;
  const revL = wrap && typeof wrap.querySelector === 'function'
    ? wrap.querySelector('.swipe-reveal-l') : null;
  const revR = wrap && typeof wrap.querySelector === 'function'
    ? wrap.querySelector('.swipe-reveal-r') : null;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let locked = false;
  let active = false;
  let suppressUntil = 0;

  const paint = () => {
    row.style.transform = `translateX(${dx}px)`;
    if (revL) revL.style.opacity = dx > 8 ? String(Math.min(1, dx / SWIPE_THRESHOLD)) : '0';
    if (revR) revR.style.opacity = dx < -8 ? String(Math.min(1, -dx / SWIPE_THRESHOLD)) : '0';
  };
  const reset = (anim) => {
    row.style.transition = anim ? 'transform .2s ease' : 'none';
    dx = 0;
    row.style.transform = 'translateX(0px)';
    if (revL) revL.style.opacity = '0';
    if (revR) revR.style.opacity = '0';
    if (anim) {
      setTimeout(() => { row.style.transition = 'none'; }, 210);
    }
  };

  row.addEventListener('pointerdown', (e) => {
    // 行の中に操作部品（セレクト・ボタン等）を持つ行向けの任意の
    // 抑止: handlers.shouldIgnoreStart(e) が真を返したら、その
    // pointerdown からはスワイプを始めない（部品側の操作を優先）。
    // 指定が無ければ従来どおり全域で受ける（ピッカーの行が前提）。
    if (handlers && typeof handlers.shouldIgnoreStart === 'function'
      && handlers.shouldIgnoreStart(e)) {
      active = false;
      return;
    }
    sx = e.clientX; sy = e.clientY; dx = 0; locked = false; active = true;
    if (typeof row.setPointerCapture === 'function' && e.pointerId != null) {
      try { row.setPointerCapture(e.pointerId); } catch { /* 環境により失敗する */ }
    }
  });
  row.addEventListener('pointermove', (e) => {
    if (!active) return;
    const mx = e.clientX - sx;
    const my = e.clientY - sy;
    if (!locked) {
      if (Math.abs(mx) > LOCK_DISTANCE && Math.abs(mx) > Math.abs(my)) locked = true;
      else return;
    }
    dx = Math.max(-140, Math.min(140, mx));
    row.style.transition = 'none';
    paint();
  });
  const finish = (commit) => {
    if (!active) return;
    active = false;
    if (locked && commit && dx <= -SWIPE_THRESHOLD) {
      suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
      row.__swipeSuppressUntil = suppressUntil;
      reset(false);
      if (handlers && typeof handlers.onSwipeLeft === 'function') handlers.onSwipeLeft();
      return;
    }
    if (locked && commit && dx >= SWIPE_THRESHOLD) {
      suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
      row.__swipeSuppressUntil = suppressUntil;
      reset(true);
      if (handlers && typeof handlers.onSwipeRight === 'function') handlers.onSwipeRight();
      return;
    }
    if (locked) { suppressUntil = Date.now() + CLICK_SUPPRESS_MS; row.__swipeSuppressUntil = suppressUntil; }
    reset(true);
  };
  row.addEventListener('pointerup', () => finish(true));
  row.addEventListener('pointercancel', () => finish(false));
  // スワイプ直後の click は選択として扱わない（捕捉フェーズで止める）。
  row.addEventListener('click', (e) => {
    if (!e || typeof e.stopPropagation !== 'function') return;
    if (Date.now() < suppressUntil) {
      e.stopPropagation();
      if (typeof e.preventDefault === 'function') e.preventDefault();
    }
  }, true);
  setClass(row, 'swipe-row', true);
}
