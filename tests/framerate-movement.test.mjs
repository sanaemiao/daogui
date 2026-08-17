// Daogui TDD：低帧率移速粘滞修复（固定步长累加器）
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const GAME = new URL("../index.html", import.meta.url);
const CFG = new URL("../src/v10.5/stage1-config.js", import.meta.url);
const CORE = new URL("../src/v10.5/combat-core.js", import.meta.url);

function makeCtxStub() {
  const grad = { addColorStop() {} };
  const stub = {};
  const noop = () => {};
  for (const m of ["setTransform","clearRect","save","restore","translate","rotate","scale","beginPath","arc","fill","stroke","moveTo","lineTo","quadraticCurveTo","bezierCurveTo","fillRect","strokeRect","fillText","strokeText","drawImage","setLineDash","ellipse","closePath","clip"]) stub[m] = noop;
  stub.createRadialGradient = () => grad;
  stub.createLinearGradient = () => grad;
  return stub;
}
function makeElement(id) {
  const el = { id, style: {}, children: [], textContent: "", handlers: {}, addEventListener(t, fn) { this.handlers[t] = fn; }, appendChild(c) { this.children.push(c); }, remove() {}, closest() { return null; } };
  el.parentElement = el;
  let _html = "";
  Object.defineProperty(el, "innerHTML", { get() { return _html; }, set(v) { _html = String(v); el.children.length = 0; } });
  return el;
}
function buildSandbox() {
  const elements = {};
  for (const id of ["game","ui","skills","message","debugHud","startPanel","levelPanel","levelOptions","endPanel","endTitle","endText","restartBtn","pauseBtn","ultBtn","joystick","stick"]) elements[id] = makeElement(id);
  elements.game.getContext = () => makeCtxStub();
  const document = {
    getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
    querySelector(sel) { if (sel === "#levelPanel h2") return elements["levelPanel-h2"] || (elements["levelPanel-h2"] = makeElement("levelPanel-h2")); return null; },
    querySelectorAll() { return { forEach() {} }; },
    createElement(tag) { return makeElement(`dyn-${tag}-${Math.random()}`); },
    addEventListener() {},
  };
  const window = { innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, matchMedia: () => ({ matches: false }), addEventListener() {}, Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } } };
  window.window = window;
  const sandbox = { window, document, innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, addEventListener() {}, Image: window.Image, Math, setTimeout, clearTimeout, performance: { now: () => 0 }, requestAnimationFrame(cb) {}, console };
  sandbox.globalThis = sandbox;
  return { sandbox, elements };
}
async function loadGame() {
  const [html, cfg, core] = await Promise.all([readFile(GAME, "utf8"), readFile(CFG, "utf8"), readFile(CORE, "utf8")]);
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace(
    /requestAnimationFrame\(loop\);\s*\}\)\(\);\s*$/,
    `requestAnimationFrame(loop);window.__T__={state,player,update,loop,startNewRun,collectGems,togglePause,keys};})();`,
  );
  const { sandbox } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__ };
}
function isolate(T) {
  T.player.needExp = 1e9;
  T.state.lastSpawn = Infinity;
  T.state.nextFlowEvent = 999;
  T.state.phaseIndex = 0;
}

test("20FPS 下一秒位移等于目标速度时间（修复前约 0.66×）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.x = 0; T.player.y = 0;
  const speed = T.player.speed;
  T.keys.add("d");
  for (let f = 1; f <= 20; f++) T.loop(f * 50); // 20 帧 × 50ms = 1 秒
  T.keys.delete("d");
  const moved = T.player.x;
  assert.ok(moved >= speed * 0.9, `20FPS 下 1 秒应移动 ≈ ${speed}，实际 ${moved.toFixed(1)}（修复前约 ${(speed * 0.66).toFixed(0)}）`);
});

test("60FPS 下一秒位移等于目标速度时间（无回归）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.x = 0; T.player.y = 0;
  const speed = T.player.speed;
  T.keys.add("d");
  for (let f = 1; f <= 60; f++) T.loop(f * (1000 / 60));
  T.keys.delete("d");
  const moved = T.player.x;
  assert.ok(moved >= speed * 0.9 && moved <= speed * 1.05, `60FPS 下 1 秒应移动 ≈ ${speed}，实际 ${moved.toFixed(1)}`);
});

test("手动暂停：固定步长下时间冻结，恢复后推进", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.togglePause();
  const t0 = T.state.time;
  T.keys.add("d");
  for (let f = 1; f <= 10; f++) T.loop(f * 50);
  T.keys.delete("d");
  assert.equal(T.state.time, t0, "暂停期间时间不推进");
  assert.equal(T.player.x, 0, "暂停期间不移动");
  T.togglePause();
  const t1 = T.state.time;
  T.keys.add("d");
  for (let f = 1; f <= 10; f++) T.loop(500 + f * 50);
  T.keys.delete("d");
  assert.ok(T.state.time > t1, "恢复后时间推进");
});

test("升级/面板暂停：固定步长下时间冻结", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.state.leveling = true; T.state.paused = true;
  const t0 = T.state.time;
  T.keys.add("d");
  for (let f = 1; f <= 10; f++) T.loop(f * 50);
  T.keys.delete("d");
  assert.equal(T.state.time, t0, "升级面板期间时间冻结");
  assert.equal(T.player.x, 0, "升级面板期间不移动");
});

test("hitstop 冻结：固定步长下不提前解除、不移动", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.state.hitstop = 0.2;
  T.keys.add("d");
  const x0 = T.player.x;
  T.loop(50); // 3 步，hitstop 0.2→0.15，全程冻结
  T.keys.delete("d");
  assert.equal(T.player.x, x0, "hitstop 期间不移动");
  assert.ok(T.state.hitstop > 0, "hitstop 未被一次性清空（按步长递减）");
});
