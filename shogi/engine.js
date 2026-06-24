"use strict";
/* ===== engine.js =====
 * 本格将棋エンジン「やねうら王(WASM)」との橋渡し。
 *  - 盤面 STATE → SFEN 文字列（エンジンへ渡す局面表記）
 *  - エンジンの bestmove(USI) → 盤面の指し手オブジェクトへ変換
 *  - 難易度別の思考時間でエンジンに思考させ、最善手を返す
 *
 * 盤座標: row0=上(後手側)/row8=下(先手側), col0=9筋 .. col8=1筋
 * SFEN  : 1段目(row0)から9段目(row8)、各段は9筋→1筋(=col0→col8)
 * USIマス: 筋(1-9)+段(a-i)。 筋=9-col, 段=row+'a'
 */

const ENGINE_MOVETIME = { weak: 100, normal: 500, strong: 2000 }; // 1手あたりms

/* --- 駒 → SFEN文字 --- */
function pieceToSfen(p) {
  let ch = p.t; // P L N S G B R K（大文字）
  if (p.o === GOTE) ch = ch.toLowerCase();
  return (p.pr ? "+" : "") + ch;
}

/* 盤面状態 → SFEN（手数は引数 moveNo） */
function stateToSfen(state) {
  const b = state.board;
  const rows = [];
  for (let r = 0; r < 9; r++) {
    let line = "", empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p) { empty++; continue; }
      if (empty) { line += empty; empty = 0; }
      line += pieceToSfen(p);
    }
    if (empty) line += empty;
    rows.push(line);
  }
  const boardStr = rows.join("/");
  const turn = state.turn === SENTE ? "b" : "w";

  // 持ち駒：先手(大文字)→後手(小文字)。多い順の決まりは緩いが R,B,G,S,N,L,P 順で出す。
  const order = ["R", "B", "G", "S", "N", "L", "P"];
  let hand = "";
  for (const side of [SENTE, GOTE]) {
    const h = state.hands[side];
    for (const t of order) {
      const n = h[t];
      if (n > 0) {
        let ch = side === SENTE ? t : t.toLowerCase();
        hand += (n > 1 ? n : "") + ch;
      }
    }
  }
  if (!hand) hand = "-";

  const moveNo = (state.moveLog ? state.moveLog.length : 0) + 1;
  return `${boardStr} ${turn} ${hand} ${moveNo}`;
}

/* USIマス("7f"等) → {r,c} */
function usiSquareToRC(sq) {
  const file = parseInt(sq[0], 10);   // 1-9
  const rank = sq.charCodeAt(1) - 97; // 'a'->0 .. 'i'->8
  return { r: rank, c: 9 - file };
}

/* {r,c} → USIマス */
function rcToUsiSquare(r, c) {
  const file = 9 - c;
  const rank = String.fromCharCode(97 + r);
  return `${file}${rank}`;
}

/* エンジンの指し手(USI) → 盤面の指し手オブジェクト。
 * 例: "7g7f" 移動 / "8h2b+" 成り / "P*5e" 打ち */
function usiToMove(usi) {
  if (usi === "resign" || usi === "win" || usi === "none" || !usi) return null;
  if (usi[1] === "*") {
    // 打ち
    const drop = usi[0].toUpperCase();
    return { drop, to: usiSquareToRC(usi.slice(2, 4)) };
  }
  const from = usiSquareToRC(usi.slice(0, 2));
  const to = usiSquareToRC(usi.slice(2, 4));
  const promote = usi.length >= 5 && usi[4] === "+";
  return { from, to, promote };
}

/* 盤面の指し手 → USI（検証・送信用） */
function moveToUsi(m) {
  if (m.drop) return `${m.drop}*${rcToUsiSquare(m.to.r, m.to.c)}`;
  return rcToUsiSquare(m.from.r, m.from.c) + rcToUsiSquare(m.to.r, m.to.c) + (m.promote ? "+" : "");
}

/* エンジンが返した指し手を、合法手リストの中の同一手に一致させて返す。
 * （forced promotion など盤側の正規形に合わせるため。一致が無ければ usiToMove の結果をそのまま返す） */
function matchLegalMove(state, usi) {
  const want = usiToMove(usi);
  if (!want) return null;
  const legals = legalMoves(state, state.turn);
  for (const m of legals) {
    if (want.drop) {
      if (m.drop === want.drop && m.to.r === want.to.r && m.to.c === want.to.c) return m;
    } else if (m.from && want.from) {
      if (m.from.r === want.from.r && m.from.c === want.from.c &&
          m.to.r === want.to.r && m.to.c === want.to.c && !!m.promote === !!want.promote) return m;
    }
  }
  // 成り指定だけ食い違うケースの保険（強制成り等）
  for (const m of legals) {
    if (!want.drop && m.from && want.from &&
        m.from.r === want.from.r && m.from.c === want.from.c &&
        m.to.r === want.to.r && m.to.c === want.to.c) return m;
  }
  return want;
}

/* ===== ブラウザ用：やねうら王エンジンの管理 =====
 * 使い方: ShogiEngine.init() で起動 → ShogiEngine.bestMove(state, difficulty) が
 * Promise<move> を返す。エンジンは内部 Worker で動くので UI は固まらない。 */
const ShogiEngine = (function () {
  let yn = null;          // エンジンインスタンス
  let ready = false;      // usi/isready 完了
  let initPromise = null; // 初期化の単一化
  let listeners = [];     // bestmove 等を待つ一時リスナー

  function handleLine(line) {
    for (const fn of listeners.slice()) fn(line);
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = new Promise((resolve, reject) => {
      if (typeof YaneuraOu !== "function") {
        reject(new Error("YaneuraOu 未ロード"));
        return;
      }
      YaneuraOu().then((instance) => {
        yn = instance;
        yn.addMessageListener(handleLine);
        // usi → usiok、isready → readyok を待つ
        let gotUsiOk = false;
        const onLine = (line) => {
          if (line === "usiok") { gotUsiOk = true; yn.postMessage("isready"); }
          else if (line === "readyok") {
            listeners = listeners.filter((f) => f !== onLine);
            ready = true;
            yn.postMessage("usinewgame");
            resolve();
          }
        };
        listeners.push(onLine);
        yn.postMessage("usi");
        // 保険：15秒で初期化失敗とみなす
        setTimeout(() => { if (!ready) { listeners = listeners.filter((f) => f !== onLine); reject(new Error("エンジン初期化タイムアウト")); } }, 15000);
      }).catch(reject);
    });
    return initPromise;
  }

  /* 現局面の最善手を Promise で返す（move オブジェクト or null=投了/詰み） */
  function bestMove(state, difficulty) {
    return init().then(() => new Promise((resolve) => {
      const movetime = ENGINE_MOVETIME[difficulty] || 500;
      const sfen = stateToSfen(state);
      let settled = false;
      const onLine = (line) => {
        if (line.indexOf("bestmove") === 0) {
          if (settled) return;
          settled = true;
          listeners = listeners.filter((f) => f !== onLine);
          const tok = line.split(/\s+/)[1];
          if (!tok || tok === "resign" || tok === "win" || tok === "none") { resolve(null); return; }
          resolve(matchLegalMove(state, tok));
        }
      };
      listeners.push(onLine);
      yn.postMessage("position sfen " + sfen);
      yn.postMessage("go movetime " + movetime);
      // 保険：思考時間＋10秒で打ち切り
      setTimeout(() => {
        if (!settled) { settled = true; listeners = listeners.filter((f) => f !== onLine); resolve(null); }
      }, movetime + 10000);
    }));
  }

  return { init, bestMove, isReady: () => ready };
})();

// Node 検証用エクスポート（ブラウザでは無視される）
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    stateToSfen, usiToMove, moveToUsi, usiSquareToRC, rcToUsiSquare,
    matchLegalMove, ENGINE_MOVETIME,
  };
}
