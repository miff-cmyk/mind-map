"use strict";
/* ===== rules.js =====
 * 将棋のルール層。
 * - 駒の利き生成 pieceMoves
 * - 攻撃判定 isAttacked / 王手判定 inCheck
 * - 擬似合法手 generatePseudo（自玉の安全は考慮しない）
 * - 合法手 legalMoves（王手放置の除外・打ち歩詰めの除外まで含む）
 * - make / unmake（探索用のインプレース適用・取り消し）
 *
 * 指し手の表現:
 *   移動: { from:{r,c}, to:{r,c}, promote:bool }
 *   打ち: { drop:'P'.., to:{r,c} }
 */

/* ある駒が到達できるマス一覧（移動と攻撃判定で共通利用） */
function pieceMoves(board, r, c) {
  const p = board[r][c];
  if (!p) return [];
  const o = p.o;
  const f = o === SENTE ? -1 : 1; // 前方向（先手は上=row減少）
  const res = [];

  const add = (rr, cc) => {
    if (!inBoard(rr, cc)) return;
    const t = board[rr][cc];
    if (t && t.o === o) return; // 自駒には進めない
    res.push({ r: rr, c: cc });
  };
  const slide = (dr, dc) => {
    let rr = r + dr, cc = c + dc;
    while (inBoard(rr, cc)) {
      const t = board[rr][cc];
      if (t) {
        if (t.o !== o) res.push({ r: rr, c: cc });
        break;
      }
      res.push({ r: rr, c: cc });
      rr += dr; cc += dc;
    }
  };
  const gold = () => {
    [[f, -1], [f, 0], [f, 1], [0, -1], [0, 1], [-f, 0]].forEach((d) => add(r + d[0], c + d[1]));
  };

  const t = p.t;

  if (p.pr) {
    if (t === "P" || t === "L" || t === "N" || t === "S") { gold(); return res; }
    if (t === "B") { // 馬 = 角 + 縦横1
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach((d) => slide(d[0], d[1]));
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach((d) => add(r + d[0], c + d[1]));
      return res;
    }
    if (t === "R") { // 龍 = 飛 + 斜め1
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach((d) => slide(d[0], d[1]));
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach((d) => add(r + d[0], c + d[1]));
      return res;
    }
  }

  switch (t) {
    case "P": add(r + f, c); break;
    case "L": slide(f, 0); break;
    case "N": add(r + 2 * f, c - 1); add(r + 2 * f, c + 1); break;
    case "S": [[f, -1], [f, 0], [f, 1], [-f, -1], [-f, 1]].forEach((d) => add(r + d[0], c + d[1])); break;
    case "G": gold(); break;
    case "B": [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach((d) => slide(d[0], d[1])); break;
    case "R": [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach((d) => slide(d[0], d[1])); break;
    case "K": [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
      .forEach((d) => add(r + d[0], c + d[1])); break;
  }
  return res;
}

/* (r,c) が byOwner の駒に攻撃されているか */
function isAttacked(board, r, c, byOwner) {
  for (let rr = 0; rr < 9; rr++) {
    for (let cc = 0; cc < 9; cc++) {
      const p = board[rr][cc];
      if (!p || p.o !== byOwner) continue;
      const ms = pieceMoves(board, rr, cc);
      for (let i = 0; i < ms.length; i++) {
        if (ms[i].r === r && ms[i].c === c) return true;
      }
    }
  }
  return false;
}

function findKing(board, side) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.t === "K" && p.o === side) return { r, c };
    }
  return null;
}

function inCheck(state, side) {
  const k = findKing(state.board, side);
  if (!k) return true; // 玉が居ない＝取られている
  return isAttacked(state.board, k.r, k.c, 1 - side);
}

/* 敵陣判定 */
function inEnemyCamp(side, r) {
  return side === SENTE ? r <= 2 : r >= 6;
}

/* 擬似合法手（自玉の安全は無視） */
function generatePseudo(state, side) {
  const b = state.board;
  const moves = [];

  // 盤上の駒の移動
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p || p.o !== side) continue;
      const dests = pieceMoves(b, r, c);
      const promotable = !p.pr && PROMOTABLE.indexOf(p.t) >= 0;
      for (const d of dests) {
        const from = { r, c }, to = { r: d.r, c: d.c };
        const canPromote = promotable && (inEnemyCamp(side, r) || inEnemyCamp(side, d.r));
        // 行き所のない駒は強制成り
        let forced = false;
        if (promotable) {
          if (p.t === "P" || p.t === "L") forced = side === SENTE ? d.r === 0 : d.r === 8;
          else if (p.t === "N") forced = side === SENTE ? d.r <= 1 : d.r >= 7;
        }
        if (canPromote && forced) {
          moves.push({ from, to, promote: true });
        } else if (canPromote) {
          moves.push({ from, to, promote: true });
          moves.push({ from, to, promote: false });
        } else {
          moves.push({ from, to, promote: false });
        }
      }
    }
  }

  // 持ち駒を打つ
  const hand = state.hands[side];
  for (const type of ["P", "L", "N", "S", "G", "B", "R"]) {
    if (hand[type] <= 0) continue;
    for (let r = 0; r < 9; r++) {
      // 行き所のない打ち先を除外
      if (type === "P" || type === "L") {
        if (side === SENTE && r === 0) continue;
        if (side === GOTE && r === 8) continue;
      }
      if (type === "N") {
        if (side === SENTE && r <= 1) continue;
        if (side === GOTE && r >= 7) continue;
      }
      for (let c = 0; c < 9; c++) {
        if (b[r][c]) continue;
        if (type === "P" && hasOwnPawn(b, side, c)) continue; // 二歩
        moves.push({ drop: type, to: { r, c } });
      }
    }
  }
  return moves;
}

/* その筋（列）に自分の不成の歩があるか（二歩判定） */
function hasOwnPawn(board, side, col) {
  for (let r = 0; r < 9; r++) {
    const p = board[r][col];
    if (p && p.o === side && p.t === "P" && !p.pr) return true;
  }
  return false;
}

/* 指し手を盤に適用する。side は state.turn から決まり、手番とハッシュも更新する。
 * 取り消し情報 undo を返す。 */
function make(state, m) {
  const side = state.turn;
  const b = state.board;
  let undo;
  if (m.drop) {
    const hi = HAND_IDX[m.drop];
    const cnt = state.hands[side][m.drop];
    state.hash ^= Z_HAND[side][hi][cnt];
    state.hands[side][m.drop] = cnt - 1;
    state.hash ^= Z_HAND[side][hi][cnt - 1];
    const np = makePiece(m.drop, side, false);
    b[m.to.r][m.to.c] = np;
    state.hash ^= Z_PIECE[side][0][TYPE_INDEX[m.drop]][m.to.r * 9 + m.to.c];
    undo = { drop: m.drop, to: m.to };
  } else {
    const p = b[m.from.r][m.from.c];
    const captured = b[m.to.r][m.to.c];
    const wasPr = p.pr;
    const fromSq = m.from.r * 9 + m.from.c;
    const toSq = m.to.r * 9 + m.to.c;
    state.hash ^= Z_PIECE[p.o][p.pr ? 1 : 0][TYPE_INDEX[p.t]][fromSq]; // 移動元から除去
    if (captured && captured.t !== "K") { // 玉は持ち駒にならない（防御的ガード）
      state.hash ^= Z_PIECE[captured.o][captured.pr ? 1 : 0][TYPE_INDEX[captured.t]][toSq];
      const hi = HAND_IDX[captured.t];
      const c0 = state.hands[side][captured.t];
      state.hash ^= Z_HAND[side][hi][c0];
      state.hands[side][captured.t] = c0 + 1; // 成駒を取っても基本種で持つ
      state.hash ^= Z_HAND[side][hi][c0 + 1];
    } else if (captured) {
      // 玉を取る手（合法手生成では到達しないが、不正局面での探索クラッシュを防ぐ）
      state.hash ^= Z_PIECE[captured.o][captured.pr ? 1 : 0][TYPE_INDEX[captured.t]][toSq];
    }
    b[m.from.r][m.from.c] = null;
    if (m.promote) p.pr = true;
    b[m.to.r][m.to.c] = p;
    state.hash ^= Z_PIECE[p.o][p.pr ? 1 : 0][TYPE_INDEX[p.t]][toSq]; // 移動先へ設置
    undo = { from: m.from, to: m.to, captured, wasPr };
  }
  state.turn = 1 - side;
  state.hash ^= Z_TURN;
  state.hash >>>= 0; // 符号なし32bitに正規化（TTキーの一貫性のため）
  return undo;
}

function unmake(state, undo) {
  state.hash ^= Z_TURN;
  state.turn = 1 - state.turn; // 手を指した側に戻す
  const side = state.turn;
  const b = state.board;
  if (undo.drop) {
    const toSq = undo.to.r * 9 + undo.to.c;
    state.hash ^= Z_PIECE[side][0][TYPE_INDEX[undo.drop]][toSq];
    b[undo.to.r][undo.to.c] = null;
    const hi = HAND_IDX[undo.drop];
    const c0 = state.hands[side][undo.drop];
    state.hash ^= Z_HAND[side][hi][c0];
    state.hands[side][undo.drop] = c0 + 1;
    state.hash ^= Z_HAND[side][hi][c0 + 1];
  } else {
    const p = b[undo.to.r][undo.to.c];
    const toSq = undo.to.r * 9 + undo.to.c;
    const fromSq = undo.from.r * 9 + undo.from.c;
    state.hash ^= Z_PIECE[p.o][p.pr ? 1 : 0][TYPE_INDEX[p.t]][toSq]; // 移動先から除去
    p.pr = undo.wasPr;
    b[undo.from.r][undo.from.c] = p;
    state.hash ^= Z_PIECE[p.o][p.pr ? 1 : 0][TYPE_INDEX[p.t]][fromSq]; // 移動元へ戻す
    b[undo.to.r][undo.to.c] = undo.captured || null;
    if (undo.captured && undo.captured.t !== "K") {
      const cap = undo.captured;
      state.hash ^= Z_PIECE[cap.o][cap.pr ? 1 : 0][TYPE_INDEX[cap.t]][toSq];
      const hi = HAND_IDX[cap.t];
      const c0 = state.hands[side][cap.t];
      state.hash ^= Z_HAND[side][hi][c0];
      state.hands[side][cap.t] = c0 - 1;
      state.hash ^= Z_HAND[side][hi][c0 - 1];
    } else if (undo.captured) {
      const cap = undo.captured;
      state.hash ^= Z_PIECE[cap.o][cap.pr ? 1 : 0][TYPE_INDEX[cap.t]][toSq];
    }
  }
  state.hash >>>= 0; // 符号なし32bitに正規化
}

/* 合法手：王手放置を除外し、打ち歩詰めも除外。
 * side 省略時は state.turn。side を指定した場合は手番を一時的に合わせる。 */
function legalMoves(state, side) {
  if (side === undefined) side = state.turn;
  let restore = false, savedTurn = state.turn;
  if (state.turn !== side) { state.turn = side; state.hash = (state.hash ^ Z_TURN) >>> 0; restore = true; }

  const pseudo = generatePseudo(state, side);
  const res = [];
  for (const m of pseudo) {
    const undo = make(state, m); // make 後 state.turn は相手番
    let ok = !inCheck(state, side);
    if (ok && m.drop === "P") {
      // 打ち歩詰め：歩を打って相手が即詰みなら非合法
      if (inCheck(state, 1 - side) && legalMoves(state).length === 0) ok = false;
    }
    unmake(state, undo);
    if (ok) res.push(m);
  }

  if (restore) { state.turn = savedTurn; state.hash = (state.hash ^ Z_TURN) >>> 0; }
  return res;
}
