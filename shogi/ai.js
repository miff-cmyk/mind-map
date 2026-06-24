"use strict";
/* ===== ai.js =====
 * 難易度別の思考エンジン。
 *   weak   … 1手評価＋ランダム（初心者向け、たまに悪手）
 *   normal … αβ＋反復深化（約1.2秒・静止探索なし）
 *   strong … αβ＋反復深化＋静止探索＋置換表＋手順並べ替え＋充実評価＋簡易定跡（既定10秒）
 *
 * make/unmake は state.turn を見て手番とハッシュを自動更新する（rules.js）。
 */

const PIECE_VALUE = { P: 100, L: 430, N: 450, S: 640, G: 690, B: 890, R: 1040, K: 15000 };
const PROMOTED_VALUE = { P: 600, L: 600, N: 600, S: 670, B: 1150, R: 1300 };
const MATE = 1000000;
const INF = 1e9;
const TIMEOUT = "TIMEOUT";

// 探索の可変状態
let TT = new Map();          // hash -> {depth, value, flag, move}  flag: 0=EXACT 1=LOWER 2=UPPER
let KILLERS = [];            // KILLERS[ply] = [moveKey, moveKey]
let HISTORY = {};            // moveKey -> score
let DEADLINE = 0;            // 0=無制限, それ以外は Date.now() の上限
let NODES = 0;
let USE_QUI = true;          // 静止探索の有無
let STRONG_TIME = 14000;     // 「強い」の思考時間(ms)。worker から上書きされる
let LAST_DEPTH = 0;          // 直近の探索で到達した深さ（計測用）
let LAST_VALUE = 0;          // 直近の探索の評価値（計測用）

function timeUp() {
  if (!DEADLINE) return false;
  if ((++NODES & 1023) !== 0) return false; // 1024ノードごとにのみ時刻を確認
  return Date.now() > DEADLINE;
}

/* ---- 評価 ---- */
function pieceValue(p) {
  if (p.pr && PROMOTED_VALUE[p.t] != null) return PROMOTED_VALUE[p.t];
  return PIECE_VALUE[p.t];
}

/* 駒得（先手視点） */
function material(state) {
  let s = 0;
  const b = state.board;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p) continue;
      s += p.o === SENTE ? pieceValue(p) : -pieceValue(p);
    }
  for (let side = 0; side < 2; side++) {
    const h = state.hands[side];
    let hv = 0;
    for (const k in h) hv += h[k] * Math.round(PIECE_VALUE[k] * 1.10); // 持ち駒は割増
    s += side === SENTE ? hv : -hv;
  }
  return s;
}

/* 自陣からの前進度（0=自陣最奥, 8=敵陣最奥） */
function advance(side, r) { return side === SENTE ? 8 - r : r; }

/* 位置評価（先手視点）：駒の前進・中央志向・玉の囲い */
function positional(state) {
  let s = 0;
  const b = state.board;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p) continue;
      const adv = advance(p.o, r);
      const cd = Math.abs(c - 4); // 中央からの距離
      let v = 0;
      if (p.pr) {
        v = adv * 3; // 成駒は前進をやや評価
      } else {
        switch (p.t) {
          case "P": v = adv * 9; break;                    // 歩は伸ばす
          case "L": v = adv * 3; break;
          case "N": v = adv * 7; break;
          case "S": v = adv * 5 + (4 - cd) * 2; break;       // 銀は前へ・中央へ
          case "G": v = adv * 4 + (4 - cd) * 2; break;
          case "B": v = adv * 2; break;
          case "R": v = adv * 3; break;
          case "K": v = cd * 10 - adv * 12; break;           // 玉は端・自陣へ（囲い誘導）
        }
      }
      s += p.o === SENTE ? v : -v;
    }
  return s;
}

/* 玉の安全度（先手視点）。将棋では最重要要素。
 * 速度のため利き判定(isAttacked)は使わず、配列を読むだけの軽い指標で近似する：
 *  - 玉8近傍の味方守備（金銀・成駒は厚く評価）
 *  - 玉周辺(5x5)の敵駒を「近いほど重く」減点（駒の存在を数えるだけ＝高速）
 *  - 玉の前の壁歩
 *  - 玉の筋とその両隣の空き筋（味方歩が無い＝危険）
 */
function kingSafety(state) {
  let s = 0;
  const b = state.board;
  for (let side = 0; side < 2; side++) {
    const k = findKing(b, side);
    if (!k) continue;
    const f = side === SENTE ? -1 : 1; // 前方向
    let val = 0;

    // 1) 8近傍の守備駒（金銀・成駒の壁は堅い）
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = k.r + dr, cc = k.c + dc;
        if (!inBoard(rr, cc)) continue;
        const p = b[rr][cc];
        if (p && p.o === side) {
          if (p.t === "G" || p.t === "S" || p.pr) val += 22;
          else val += 10;
        }
      }

    // 2) 玉周辺(5x5)の敵駒を近いほど重く減点（利き判定なし＝高速）
    let danger = 0;
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        if (!dr && !dc) continue;
        const rr = k.r + dr, cc = k.c + dc;
        if (!inBoard(rr, cc)) continue;
        const p = b[rr][cc];
        if (p && p.o !== side) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          const w = dist === 1 ? 18 : 7;
          // 大駒・成駒の接近はより危険
          danger += (p.t === "R" || p.t === "B" || p.pr) ? w + 6 : w;
        }
      }
    val -= danger;

    // 3) 玉の前の壁歩
    const fr = k.r + f;
    if (inBoard(fr, k.c)) {
      const p = b[fr][k.c];
      if (p && p.o === side && p.t === "P") val += 14;
    }

    // 4) 玉の筋とその両隣に味方歩が無い＝空き筋で危険
    for (let dc = -1; dc <= 1; dc++) {
      const cc = k.c + dc;
      if (cc < 0 || cc > 8) continue;
      if (!hasOwnPawn(b, side, cc)) val -= 14;
    }

    s += side === SENTE ? val : -val;
  }
  return s;
}

/* 飛車・香の働き（先手視点）：自分の歩がいない筋（開いた筋）にいる飛香を加点 */
function fileControl(state) {
  let s = 0;
  const b = state.board;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p) continue;
      if (p.t === "R" || p.t === "L") {
        if (!hasOwnPawn(b, p.o, c)) {
          const bonus = p.t === "R" ? 30 : 10; // 開いた筋の飛・香
          s += p.o === SENTE ? bonus : -bonus;
        }
      }
    }
  return s;
}

/* 大駒（角飛と馬龍）の働き（先手視点） */
function mobility(state) {
  let s = 0;
  const b = state.board;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p) continue;
      if (p.t === "B" || p.t === "R") {
        const m = pieceMoves(b, r, c).length;
        s += (p.o === SENTE ? m : -m) * 4;
      }
    }
  return s;
}

/* 先手視点の総合評価 */
function evaluateSente(state) {
  return material(state) + positional(state) + kingSafety(state) + mobility(state) + fileControl(state);
}

/* 手番側から見た評価値 */
function evalForSide(state, side) {
  const v = evaluateSente(state);
  return side === SENTE ? v : -v;
}

/* ---- 手順の並べ替え ---- */
function moveKey(m) {
  return m.drop
    ? "D" + m.drop + m.to.r + m.to.c
    : "M" + m.from.r + m.from.c + m.to.r + m.to.c + (m.promote ? "1" : "0");
}

function isCapture(state, m) {
  return !!(m.from && state.board[m.to.r][m.to.c]);
}

function orderMoves(state, moves, ttKey, ply) {
  const b = state.board;
  const killers = KILLERS[ply] || null;
  for (const m of moves) {
    let sc;
    const key = moveKey(m);
    if (ttKey && key === ttKey) {
      sc = 2e7;
    } else if (m.from && b[m.to.r][m.to.c]) {
      // 取る手：MVV-LVA（取る駒の価値を高く、動かす駒の価値を低く）
      const victim = pieceValue(b[m.to.r][m.to.c]);
      const attacker = pieceValue(b[m.from.r][m.from.c]);
      sc = 1e7 + victim * 16 - attacker + (m.promote ? 400 : 0);
    } else if (killers && (key === killers[0] || key === killers[1])) {
      sc = 9e6;
    } else {
      sc = (HISTORY[key] || 0) + (m.promote ? 200 : 0);
    }
    m._s = sc;
  }
  moves.sort((a, x) => x._s - a._s);
}

/* 取る手・王手回避手の並べ替え（非取り・打ちも安全に扱う） */
function orderCaptures(state, moves) {
  const b = state.board;
  for (const m of moves) {
    const target = m.from ? b[m.to.r][m.to.c] : null;
    if (target) {
      const attacker = pieceValue(b[m.from.r][m.from.c]);
      m._s = pieceValue(target) * 16 - attacker + (m.promote ? 400 : 0);
    } else {
      m._s = m.promote ? 300 : 0;
    }
  }
  moves.sort((a, x) => x._s - a._s);
}

function addKiller(ply, m) {
  const key = moveKey(m);
  const k = KILLERS[ply] || (KILLERS[ply] = [null, null]);
  if (k[0] !== key) { k[1] = k[0]; k[0] = key; }
}
function addHistory(m, depth) {
  const key = moveKey(m);
  HISTORY[key] = (HISTORY[key] || 0) + depth * depth;
}

/* ---- 静止探索（取り合いが落ち着くまで延長） ---- */
function qsearch(state, alpha, beta, ply) {
  if (timeUp()) throw TIMEOUT;
  const side = state.turn;
  const checked = inCheck(state, side);

  if (!checked) {
    const stand = evalForSide(state, side);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }

  let moves = legalMoves(state);
  if (moves.length === 0) return checked ? -MATE + ply : alpha; // 王手中に手なし＝詰み
  if (!checked) moves = moves.filter((m) => m.from && state.board[m.to.r][m.to.c]); // 取る手のみ
  orderCaptures(state, moves);

  let best = checked ? -INF : alpha;
  for (const m of moves) {
    const undo = make(state, m);
    let v;
    try { v = -qsearch(state, -beta, -alpha, ply + 1); }
    finally { unmake(state, undo); }
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/* 手番だけ相手に渡す（null move 用）。盤は動かさない。 */
function makeNull(state) {
  state.turn = 1 - state.turn;
  state.hash = (state.hash ^ Z_TURN) >>> 0;
}
function unmakeNull(state) {
  state.turn = 1 - state.turn;
  state.hash = (state.hash ^ Z_TURN) >>> 0;
}

/* 手番側が玉以外の駒（盤上の大駒・小駒）を持っているか。
 * null move は zugzwang（手を渡すと損する局面）で危険なので、駒が乏しいと無効化する。 */
function hasNonKingMaterial(state, side) {
  const b = state.board;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (p && p.o === side && p.t !== "K") return true;
    }
  const h = state.hands[side];
  for (const k in h) if (h[k] > 0) return true;
  return false;
}

/* ---- 主探索（negamax + αβ + 置換表 + 王手延長 + null-move 枝刈り） ---- */
function search(state, depth, alpha, beta, ply, canNull) {
  if (timeUp()) throw TIMEOUT;
  const alphaOrig = alpha;
  const side = state.turn;
  const checked = inCheck(state, side);

  // 王手されている局面は1手延長して読む（詰み/必至の精度が大きく上がる）
  if (checked) depth++;

  const tt = TT.get(state.hash);
  let ttKey = null;
  if (tt) {
    ttKey = tt.move;
    if (tt.depth >= depth) {
      if (tt.flag === 0) return tt.value;
      if (tt.flag === 1 && tt.value > alpha) alpha = tt.value;
      else if (tt.flag === 2 && tt.value < beta) beta = tt.value;
      if (alpha >= beta) return tt.value;
    }
  }

  if (depth <= 0) return USE_QUI ? qsearch(state, alpha, beta, ply) : evalForSide(state, side);

  // Null-move 枝刈り：自分が1手パスしても β を超えるなら、この局面は十分良い → 枝刈り
  if (canNull && !checked && depth >= 3 && Math.abs(beta) < MATE - 1000 &&
      hasNonKingMaterial(state, side)) {
    const R = depth > 6 ? 3 : 2; // 削減量
    makeNull(state);
    let v;
    try { v = -search(state, depth - 1 - R, -beta, -beta + 1, ply + 1, false); }
    finally { unmakeNull(state); }
    if (v >= beta) return beta; // フェイルハイ → 枝刈り
  }

  const moves = legalMoves(state);
  if (moves.length === 0) return -MATE + ply; // 詰み（手番側の負け）

  orderMoves(state, moves, ttKey, ply);
  let best = -INF, bestMove = null;
  for (const m of moves) {
    const undo = make(state, m);
    let v;
    try { v = -search(state, depth - 1, -beta, -alpha, ply + 1, true); }
    finally { unmake(state, undo); }
    if (v > best) { best = v; bestMove = m; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!isCapture(state, m)) { addKiller(ply, m); addHistory(m, depth); }
      break;
    }
  }

  const flag = best <= alphaOrig ? 2 : best >= beta ? 1 : 0;
  if (TT.size > 2000000) TT.clear(); // メモリ上限
  TT.set(state.hash, { depth, value: best, flag, move: bestMove ? moveKey(bestMove) : null });
  return best;
}

/* ルート：反復深化の1回分 */
function searchRoot(state, depth, rootMoves) {
  const tt = TT.get(state.hash);
  const ttKey = tt ? tt.move : null;
  orderMoves(state, rootMoves, ttKey, 0);
  let alpha = -INF, best = null, bestv = -INF;
  for (const m of rootMoves) {
    const undo = make(state, m);
    let v;
    try { v = -search(state, depth - 1, -INF, -alpha, 1, true); }
    finally { unmake(state, undo); }
    if (v > bestv) { bestv = v; best = m; }
    if (bestv > alpha) alpha = bestv;
  }
  TT.set(state.hash, { depth, value: bestv, flag: 0, move: best ? moveKey(best) : null });
  return { move: best, value: bestv };
}

/* 反復深化で最善手を返す */
function think(state, timeMs, useQui, maxDepth) {
  TT = new Map(); KILLERS = []; HISTORY = {};
  USE_QUI = useQui;
  NODES = 0;
  DEADLINE = timeMs > 0 ? Date.now() + timeMs : 0;

  const rootMoves = legalMoves(state);
  if (rootMoves.length === 0) return null;
  let best = rootMoves[0];

  LAST_DEPTH = 0; LAST_VALUE = 0;
  for (let d = 1; d <= maxDepth; d++) {
    try {
      const r = searchRoot(state, d, rootMoves.slice());
      if (r.move) best = r.move;
      LAST_DEPTH = d; LAST_VALUE = r.value;
      if (Math.abs(r.value) > MATE - 1000) break; // 詰みを発見したら打ち切り
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break; // 時間切れ：直前の深さの結果を採用
    }
  }
  DEADLINE = 0;
  return best;
}

/* ---- 簡易定跡（序盤の形づくり） ---- */
function bookMove(state) {
  if (state.moveLog.length > 5) return null;
  const side = state.turn;
  // 候補：定番の歩突き・銀上がり（from→to）。先手基準、後手は行を反転。
  const flip = (r) => 8 - r;
  let cands;
  if (side === SENTE) {
    cands = [
      [6, 2, 5, 2], // 7六歩
      [6, 7, 5, 7], // 2六歩
      [6, 4, 5, 4], // 5六歩
      [8, 2, 7, 3], // 6八銀
    ];
  } else {
    cands = [
      [flip(6), 2, flip(5), 2],
      [flip(6), 7, flip(5), 7],
      [flip(6), 4, flip(5), 4],
      [flip(8), 2, flip(7), 3],
    ];
  }
  const legal = legalMoves(state);
  const ok = [];
  for (const [fr, fc, tr, tc] of cands) {
    const hit = legal.find(
      (m) => m.from && m.from.r === fr && m.from.c === fc && m.to.r === tr && m.to.c === tc && !m.promote
    );
    if (hit) ok.push(hit);
  }
  if (ok.length === 0) return null;
  return ok[Math.floor(Math.random() * ok.length)];
}

/* ---- 詰み探索（王手だけを読む専用ルーチン） ----
 * 攻め方は王手のみ、受け方は全合法手。奇数手で詰みを探す。
 * 主探索より確実に「強制詰み」を発見・回避できる。時間切れは TIMEOUT で中断。 */

/* 受け方（手番＝玉側）が depth 手以内に詰まされるか */
function defenderMated(state, depth) {
  if (timeUp()) throw TIMEOUT;
  const moves = legalMoves(state);
  if (moves.length === 0) return true;   // すでに詰み
  if (depth <= 0) return false;          // これ以上は読まない＝詰みと断定できない
  for (const m of moves) {
    const undo = make(state, m);
    let escapes;
    try { escapes = !attackerCanMate(state, depth - 1); }
    finally { unmake(state, undo); }
    if (escapes) return false;           // 1つでも逃れる手があれば詰みでない
  }
  return true;                           // すべての受けが詰み → 詰み
}

/* 攻め方（手番）が depth 手以内に詰ませられるか（真偽） */
function attackerCanMate(state, depth) {
  if (timeUp()) throw TIMEOUT;
  if (depth <= 0) return false;
  const moves = legalMoves(state);
  for (const m of moves) {
    const undo = make(state, m);
    let mate = false;
    try {
      if (inCheck(state, state.turn))    // 王手になる手だけ追う
        mate = defenderMated(state, depth - 1);
    } finally { unmake(state, undo); }
    if (mate) return true;
  }
  return false;
}

/* 攻め方の詰ます手を返す（無ければ null）。depth は総手数（奇数推奨）。 */
function findMate(state, depth) {
  const moves = legalMoves(state);
  for (const m of moves) {
    const undo = make(state, m);
    let mate = false;
    try {
      if (inCheck(state, state.turn))
        mate = defenderMated(state, depth - 1);
    } finally { unmake(state, undo); }
    if (mate) return m;
  }
  return null;
}

/* 反復深化で詰みを探す（時間制限付き）。詰ます手 or null。 */
function searchMate(state, maxDepth, timeMs) {
  const savedDeadline = DEADLINE, savedNodes = NODES;
  DEADLINE = Date.now() + timeMs;
  NODES = 0;
  let found = null;
  try {
    for (let d = 1; d <= maxDepth; d += 2) { // 1,3,5,... 手詰め
      const m = findMate(state, d);
      if (m) { found = m; break; }
    }
  } catch (e) {
    if (e !== TIMEOUT) throw e;
  }
  DEADLINE = savedDeadline; NODES = savedNodes;
  return found;
}

/* ---- 公開API ---- */
function chooseMove(state, difficulty) {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;

  if (difficulty === "weak") {
    const side = state.turn;
    const scored = moves.map((m) => {
      const undo = make(state, m);
      const v = evalForSide(state, side);
      unmake(state, undo);
      return { m, v };
    });
    scored.sort((a, b) => b.v - a.v);
    if (Math.random() < 0.5) return scored[0].m;
    return scored[Math.floor(Math.random() * scored.length)].m;
  }

  if (difficulty === "normal") {
    return think(state, 1200, false, 5);
  }

  // strong
  const bk = bookMove(state);
  if (bk) return bk;
  // 軽い詰み探索を先に（最大5手詰め・最長400ms）。見つかれば即詰ます。
  // 本探索（王手延長付き）でも詰みは拾えるので、ここは短時間の保険に留める。
  const mate = searchMate(state, 5, 400);
  if (mate) return mate;
  return think(state, STRONG_TIME, true, 32);
}

/* ---- Web Worker 用ソースの生成 ----
 * メインスレッドに読み込んだ関数・定数を文字列化して結合し、Blob 経由で Worker を作る。
 * importScripts も fetch も使わないため file:// でも動作する。 */
function buildWorkerSource() {
  const consts = {
    SENTE, GOTE, PROMOTABLE, PTYPES, HAND_KINDS, HAND_IDX, TYPE_INDEX,
    PIECE_VALUE, PROMOTED_VALUE, MATE, INF, TIMEOUT,
  };
  let header = "";
  for (const k in consts) header += "var " + k + "=" + JSON.stringify(consts[k]) + ";\n";
  header +=
    "var Z_PIECE=null,Z_HAND=null,Z_TURN=0;\n" +
    "var TT=new Map(),KILLERS=[],HISTORY={},DEADLINE=0,NODES=0,USE_QUI=true,STRONG_TIME=10000;\n";

  const fns = [
    // board
    rand32, initZobrist, computeHash, makePiece, emptyHand, inBoard,
    // rules
    pieceMoves, isAttacked, findKing, inCheck, inEnemyCamp, hasOwnPawn,
    generatePseudo, make, unmake, legalMoves,
    // ai
    timeUp, pieceValue, material, advance, positional, kingSafety, mobility,
    evaluateSente, evalForSide, moveKey, isCapture, orderMoves, orderCaptures,
    addKiller, addHistory, qsearch, makeNull, unmakeNull, hasNonKingMaterial,
    fileControl, defenderMated, attackerCanMate, findMate, searchMate,
    search, searchRoot, think, bookMove, chooseMove,
  ];
  let body = "";
  for (const f of fns) body += f.toString() + "\n\n";

  const tail =
    "self.onmessage=function(e){" +
    "var d=e.data;initZobrist();var st=d.state;" +
    "st.moveLog=st.moveLog||[];st.hash=computeHash(st);" +
    "STRONG_TIME=d.timeMs||10000;" +
    "var mv=chooseMove(st,d.difficulty);" +
    "self.postMessage(mv);};\n";

  return header + body + tail;
}

// Node 検証用に公開（ブラウザでは無害）
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildWorkerSource, chooseMove, think };
}
