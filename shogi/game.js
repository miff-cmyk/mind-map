"use strict";
/* ===== game.js =====
 * 対局進行の制御。手を確定し、手番交代・勝敗・千日手を判定する。
 */

const PIECE_KANJI = {
  P: "歩", L: "香", N: "桂", S: "銀", G: "金", B: "角", R: "飛", K: "玉",
};
const PROMOTED_KANJI = {
  P: "と", L: "杏", N: "圭", S: "全", B: "馬", R: "龍",
};

function pieceKanji(p) {
  if (p.pr && PROMOTED_KANJI[p.t]) return PROMOTED_KANJI[p.t];
  if (p.t === "K") return p.o === SENTE ? "玉" : "王";
  return PIECE_KANJI[p.t];
}

/* 棋譜表記（簡易） */
function moveToText(state, m, side) {
  const colChar = (c) => "９８７６５４３２１"[c];
  const rowChar = (r) => "一二三四五六七八九"[r];
  const mark = side === SENTE ? "▲" : "△";
  const to = colChar(m.to.c) + rowChar(m.to.r);
  if (m.drop) return mark + to + PIECE_KANJI[m.drop] + "打";
  const p = state.board[m.from.r][m.from.c];
  return mark + to + pieceKanji(p) + (m.promote ? "成" : "");
}

/* 手を確定して状態を進める */
function makeGameMove(state, m) {
  const side = state.turn;
  const text = moveToText(state, m, side);
  make(state, m); // 手番とハッシュも更新される
  state.moveLog.push(text);

  const key = positionKey(state);
  state.history.push(key);

  const legal = legalMoves(state, state.turn);
  if (legal.length === 0) {
    // 手番側に合法手なし → 直前に指した側の勝ち
    state.result = { type: "checkmate", winner: side };
    return;
  }
  // 千日手（同一局面4回）。連続王手の千日手は今回は通常の引き分け扱い。
  let reps = 0;
  for (const k of state.history) if (k === key) reps++;
  if (reps >= 4) {
    state.result = { type: "sennichite" };
  }
}
