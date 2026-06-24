"use strict";
/* ===== board.js =====
 * 盤面データモデルと基本ヘルパー。
 * 駒: { t, o, pr }
 *   t  … 種類 'P'歩 'L'香 'N'桂 'S'銀 'G'金 'B'角 'R'飛 'K'玉（常に基本種、成りは pr で表現）
 *   o  … 陣営 SENTE(0,下) / GOTE(1,上)
 *   pr … 成りフラグ
 * 盤: board[row][col]  row0..8（row0=上=後手側, row8=下=先手側）, col0..8
 */

const SENTE = 0; // 先手（盤の下）
const GOTE  = 1; // 後手（盤の上）

const PROMOTABLE = ["P", "L", "N", "S", "B", "R"]; // 成れる駒種
const PTYPES = ["P", "L", "N", "S", "G", "B", "R", "K"]; // 全駒種
const TYPE_INDEX = { P: 0, L: 1, N: 2, S: 3, G: 4, B: 5, R: 6, K: 7 };
const HAND_KINDS = ["P", "L", "N", "S", "G", "B", "R"];
const HAND_IDX = { P: 0, L: 1, N: 2, S: 3, G: 4, B: 5, R: 6 };

function makePiece(t, o, pr) {
  return { t: t, o: o, pr: !!pr };
}

function emptyHand() {
  return { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 };
}

function inBoard(r, c) {
  return r >= 0 && r < 9 && c >= 0 && c < 9;
}

/* ---- Zobrist ハッシュ ----
 * Z_PIECE[owner][promo(0/1)][typeIndex(0..7)][square(0..80)]
 * Z_HAND[owner][handIndex(0..6)][count(0..18)]
 * Z_TURN は後手番のときに XOR する。
 * 32bit 符号なし整数として扱う（XOR のみ使用するので衝突確率は実用上十分低い）。 */
let Z_PIECE = null, Z_HAND = null, Z_TURN = 0;

function rand32() {
  // 決定的な乱数（再現性のため固定シードの xorshift）
  rand32._s = (rand32._s ^ (rand32._s << 13)) >>> 0;
  rand32._s = (rand32._s ^ (rand32._s >>> 17)) >>> 0;
  rand32._s = (rand32._s ^ (rand32._s << 5)) >>> 0;
  return rand32._s >>> 0;
}
rand32._s = 0x9e3779b9;

function initZobrist() {
  if (Z_PIECE) return;
  rand32._s = 0x9e3779b9;
  Z_PIECE = [];
  for (let o = 0; o < 2; o++) {
    Z_PIECE[o] = [];
    for (let pr = 0; pr < 2; pr++) {
      Z_PIECE[o][pr] = [];
      for (let t = 0; t < 8; t++) {
        Z_PIECE[o][pr][t] = [];
        for (let sq = 0; sq < 81; sq++) Z_PIECE[o][pr][t][sq] = rand32();
      }
    }
  }
  Z_HAND = [];
  for (let o = 0; o < 2; o++) {
    Z_HAND[o] = [];
    for (let h = 0; h < 7; h++) {
      Z_HAND[o][h] = [];
      for (let n = 0; n < 19; n++) Z_HAND[o][h][n] = rand32();
    }
  }
  Z_TURN = rand32();
}

/* 局面のハッシュを全走査で計算（make/unmake は差分更新する） */
function computeHash(state) {
  initZobrist();
  let h = 0;
  const b = state.board;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p) continue;
      h ^= Z_PIECE[p.o][p.pr ? 1 : 0][TYPE_INDEX[p.t]][r * 9 + c];
    }
  for (let o = 0; o < 2; o++)
    for (let hi = 0; hi < 7; hi++) {
      const cnt = state.hands[o][HAND_KINDS[hi]];
      h ^= Z_HAND[o][hi][cnt];
    }
  if (state.turn === GOTE) h ^= Z_TURN;
  return h >>> 0;
}

function initialBoard() {
  const b = Array.from({ length: 9 }, () => Array(9).fill(null));
  const back = ["L", "N", "S", "G", "K", "G", "S", "N", "L"];

  // 後手（上）
  for (let c = 0; c < 9; c++) b[0][c] = makePiece(back[c], GOTE);
  b[1][1] = makePiece("R", GOTE);
  b[1][7] = makePiece("B", GOTE);
  for (let c = 0; c < 9; c++) b[2][c] = makePiece("P", GOTE);

  // 先手（下）
  for (let c = 0; c < 9; c++) b[6][c] = makePiece("P", SENTE);
  b[7][1] = makePiece("B", SENTE);
  b[7][7] = makePiece("R", SENTE);
  for (let c = 0; c < 9; c++) b[8][c] = makePiece(back[c], SENTE);

  return b;
}

function newState() {
  initZobrist();
  const state = {
    board: initialBoard(),
    hands: [emptyHand(), emptyHand()], // hands[SENTE], hands[GOTE]
    turn: SENTE,
    hash: 0,
    history: [],   // 局面キーの履歴（千日手判定）
    moveLog: [],   // 棋譜（表示用）
    result: null,  // null or {type, winner?}
  };
  state.hash = computeHash(state);
  state.history.push(positionKey(state));
  return state;
}

/* 局面の一意キー（盤＋持ち駒＋手番）。千日手判定に使用 */
function positionKey(state) {
  let s = "";
  const b = state.board;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      s += p ? (p.o === SENTE ? "+" : "-") + p.t + (p.pr ? "*" : "") : ".";
    }
  }
  s += "|";
  for (const side of [SENTE, GOTE]) {
    const h = state.hands[side];
    s += side + ":" + HAND_KINDS.map((k) => h[k]).join(",") + ";";
  }
  s += "|" + state.turn;
  return s;
}
