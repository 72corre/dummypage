// 操作履歴のモデル（元に戻す／やり直し）
// 状態は「履歴のうち cursor までの操作」から導出する（derive.js）。
// 新しい操作を cursor の手前で加えると、それより先の履歴は捨てる（一般的な undo の意味論）。

export function createHistory(ops = [], cursor = ops.length) {
  return { ops: [...ops], cursor: Math.max(0, Math.min(cursor, ops.length)) };
}

export function currentOps(history) {
  return history.ops.slice(0, history.cursor);
}

export function canUndo(history) {
  return history.cursor > 0;
}

export function canRedo(history) {
  return history.cursor < history.ops.length;
}

export function applyOp(history, op) {
  const ops = history.ops.slice(0, history.cursor);
  ops.push(op);
  return { ops, cursor: ops.length };
}

export function undo(history) {
  if (!canUndo(history)) return history;
  return { ops: history.ops, cursor: history.cursor - 1 };
}

export function redo(history) {
  if (!canRedo(history)) return history;
  return { ops: history.ops, cursor: history.cursor + 1 };
}
