"use strict";
/* ===== ui.js =====
 * 盤面描画・クリック操作・AI呼び出し。
 */

let STATE = null;
let HUMAN_SIDE = SENTE;        // 人間の手番
let DIFFICULTY = "normal";
let selectedFrom = null;       // {r,c}
let selectedDrop = null;       // 駒種
let legalCache = [];           // 現手番の全合法手
let busy = false;              // AI思考中

// 思考時間(ms)
const STRONG_TIME_MS = 14000;
const NORMAL_TIME_MS = 1200;

// Web Worker（思考をUIから切り離す）
let WORKER = null;
let WORKER_BROKEN = false; // 生成に失敗したら sync にフォールバック

function getWorker() {
  if (WORKER || WORKER_BROKEN) return WORKER;
  try {
    const src = buildWorkerSource();
    const blob = new Blob([src], { type: "application/javascript" });
    WORKER = new Worker(URL.createObjectURL(blob));
  } catch (e) {
    WORKER_BROKEN = true;
    WORKER = null;
  }
  return WORKER;
}

const boardEl = () => document.getElementById("board");
const HAND_TYPES = ["R", "B", "G", "S", "N", "L", "P"];

function isHumanTurn() {
  return STATE && !STATE.result && STATE.turn === HUMAN_SIDE && !busy;
}

function newGame() {
  // 進行中のAI思考を確実に止める（古い手が新しい局面に適用されるのを防ぐ）
  if (typeof turnTokenRef !== "undefined") turnTokenRef.v++; // 飛んでくる古い結果を無効化
  if (WORKER) { WORKER.terminate(); WORKER = null; WORKER_BROKEN = false; }
  STATE = newState();
  HUMAN_SIDE = document.getElementById("side").value === "gote" ? GOTE : SENTE;
  DIFFICULTY = document.getElementById("difficulty").value;
  selectedFrom = null;
  selectedDrop = null;
  busy = false;
  refreshLegal();
  render();
  if (STATE.turn !== HUMAN_SIDE) scheduleAI();
}

function refreshLegal() {
  legalCache = STATE.result ? [] : legalMoves(STATE, STATE.turn);
}

/* ---- 描画 ---- */
function render() {
  renderBoard();
  renderHands();
  renderStatus();
  renderLog();
}

function renderBoard() {
  const el = boardEl();
  el.innerHTML = "";
  // 上が後手。盤は常に先手＝下で描画。
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const p = STATE.board[r][c];
      if (p) {
        const span = document.createElement("span");
        span.className = "piece" + (p.o === GOTE ? " gote" : "") + (p.pr ? " promoted" : "");
        span.textContent = pieceKanji(p);
        cell.appendChild(span);
      }
      // ハイライト
      if (selectedFrom && selectedFrom.r === r && selectedFrom.c === c) cell.classList.add("selected");
      if (isTargetSquare(r, c)) cell.classList.add("target");
      cell.addEventListener("click", () => onCellClick(r, c));
      el.appendChild(cell);
    }
  }
}

function isTargetSquare(r, c) {
  if (!isHumanTurn()) return false;
  if (selectedDrop) {
    return legalCache.some((m) => m.drop === selectedDrop && m.to.r === r && m.to.c === c);
  }
  if (selectedFrom) {
    return legalCache.some(
      (m) => m.from && m.from.r === selectedFrom.r && m.from.c === selectedFrom.c && m.to.r === r && m.to.c === c
    );
  }
  return false;
}

function renderHands() {
  for (const side of [SENTE, GOTE]) {
    const el = document.getElementById(side === SENTE ? "hand-sente" : "hand-gote");
    el.innerHTML = "";
    const h = STATE.hands[side];
    for (const t of HAND_TYPES) {
      if (h[t] <= 0) continue;
      const d = document.createElement("div");
      d.className = "hand-piece" + (side === GOTE ? " gote" : "");
      if (selectedDrop === t && STATE.turn === side && side === HUMAN_SIDE) d.classList.add("selected");
      d.textContent = PIECE_KANJI[t] + (h[t] > 1 ? h[t] : "");
      d.addEventListener("click", () => onHandClick(side, t));
      el.appendChild(d);
    }
  }
}

function renderStatus() {
  const el = document.getElementById("status");
  if (STATE.result) {
    if (STATE.result.type === "checkmate") {
      const w = STATE.result.winner === SENTE ? "先手" : "後手";
      const who = STATE.result.winner === HUMAN_SIDE ? "あなたの勝ち！" : "AIの勝ち";
      el.textContent = `詰み — ${w}の勝ち（${who}）`;
    } else if (STATE.result.type === "sennichite") {
      el.textContent = "千日手 — 引き分け";
    } else if (STATE.result.type === "resign") {
      const w = STATE.result.winner === SENTE ? "先手" : "後手";
      el.textContent = `投了 — ${w}の勝ち`;
    }
    el.className = "status over";
    return;
  }
  const t = STATE.turn === SENTE ? "先手" : "後手";
  const check = inCheck(STATE, STATE.turn) ? "（王手！）" : "";
  const who = busy ? "AI思考中…" : STATE.turn === HUMAN_SIDE ? "あなたの番" : "AIの番";
  el.textContent = `${t}番 — ${who}${check}`;
  el.className = "status";
}

function renderLog() {
  const el = document.getElementById("log");
  if (!el) return;
  el.innerHTML = "";
  STATE.moveLog.forEach((t, i) => {
    const d = document.createElement("div");
    d.textContent = `${i + 1}. ${t}`;
    el.appendChild(d);
  });
  el.scrollTop = el.scrollHeight;
}

/* ---- 操作 ---- */
function onCellClick(r, c) {
  if (!isHumanTurn()) return;

  if (selectedDrop) {
    const m = legalCache.find((x) => x.drop === selectedDrop && x.to.r === r && x.to.c === c);
    if (m) { applyHumanMove(m); return; }
    selectedDrop = null; render(); return;
  }

  if (selectedFrom) {
    const matches = legalCache.filter(
      (x) => x.from && x.from.r === selectedFrom.r && x.from.c === selectedFrom.c && x.to.r === r && x.to.c === c
    );
    if (matches.length > 0) {
      let m = matches[0];
      if (matches.length > 1) {
        // 成り／不成の選択
        const yes = window.confirm("成りますか？（キャンセルで不成）");
        m = matches.find((x) => x.promote === yes) || matches[0];
      }
      applyHumanMove(m);
      return;
    }
    // 別の自駒を選び直し
    const p = STATE.board[r][c];
    if (p && p.o === HUMAN_SIDE) { selectedFrom = { r, c }; render(); return; }
    selectedFrom = null; render(); return;
  }

  const p = STATE.board[r][c];
  if (p && p.o === HUMAN_SIDE) { selectedFrom = { r, c }; render(); }
}

function onHandClick(side, t) {
  if (!isHumanTurn()) return;
  if (side !== HUMAN_SIDE) return;
  selectedFrom = null;
  selectedDrop = selectedDrop === t ? null : t;
  render();
}

function applyHumanMove(m) {
  selectedFrom = null;
  selectedDrop = null;
  makeGameMove(STATE, m);
  refreshLegal();
  render();
  if (!STATE.result && STATE.turn !== HUMAN_SIDE) scheduleAI();
}

function timeForDifficulty() {
  if (DIFFICULTY === "strong") return STRONG_TIME_MS;
  if (DIFFICULTY === "normal") return NORMAL_TIME_MS;
  return 0;
}

function onAIMove(m) {
  busy = false;
  if (!STATE || STATE.result) return; // 対局リセット等が挟まった場合
  if (!m) { refreshLegal(); render(); return; }
  makeGameMove(STATE, m);
  refreshLegal();
  render();
  if (!STATE.result && STATE.turn !== HUMAN_SIDE) scheduleAI();
}

// エンジンが使えるか（読み込み済みか）。一度失敗したら自作AIに切り替える。
let ENGINE_DISABLED = (typeof ShogiEngine === "undefined" || typeof YaneuraOu === "undefined");
const turnTokenRef = { v: 0 }; // 古い思考結果の混入を防ぐトークン

function fallbackToBuiltin(token) {
  // 自作AI（Worker）で思考。エンジン不調時のみ。
  const w = getWorker();
  if (w) {
    const payload = {
      state: { board: STATE.board, hands: STATE.hands, turn: STATE.turn, moveLog: STATE.moveLog },
      difficulty: DIFFICULTY,
      timeMs: timeForDifficulty(),
    };
    w.onmessage = (e) => { if (token === turnTokenRef.v) onAIMove(e.data); };
    w.onerror = () => { WORKER_BROKEN = true; WORKER = null; if (token === turnTokenRef.v) setTimeout(() => onAIMove(chooseMove(STATE, DIFFICULTY)), 10); };
    w.postMessage(JSON.parse(JSON.stringify(payload)));
  } else {
    if (DIFFICULTY === "strong") STRONG_TIME = STRONG_TIME_MS;
    setTimeout(() => { if (token === turnTokenRef.v) onAIMove(chooseMove(STATE, DIFFICULTY)); }, 30);
  }
}

function scheduleAI() {
  busy = true;
  renderStatus();
  const token = ++turnTokenRef.v;

  if (!ENGINE_DISABLED) {
    // 本格エンジンに思考させる
    ShogiEngine.bestMove(STATE, DIFFICULTY).then((m) => {
      if (token !== turnTokenRef.v) return; // 局面が変わっていたら破棄
      onAIMove(m);
    }).catch(() => {
      // エンジン不調 → 以降は自作AIに切り替え
      ENGINE_DISABLED = true;
      if (token === turnTokenRef.v) fallbackToBuiltin(token);
    });
  } else {
    fallbackToBuiltin(token);
  }
}

function resign() {
  if (!STATE || STATE.result) return;
  turnTokenRef.v++; // 進行中のエンジン思考結果を無効化
  if (WORKER) { WORKER.terminate(); WORKER = null; }
  busy = false;
  STATE.result = { type: "resign", winner: 1 - HUMAN_SIDE };
  render();
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("newgame").addEventListener("click", newGame);
  document.getElementById("resign").addEventListener("click", resign);
  // エンジンを先読み起動（読めなければ自作AIに自動フォールバック）
  if (!ENGINE_DISABLED && typeof ShogiEngine !== "undefined") {
    ShogiEngine.init().catch(() => { ENGINE_DISABLED = true; });
  }
  newGame();
});
