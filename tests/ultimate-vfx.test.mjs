// Daogui：置闰强化特效可见性 + HUD 状态文案回归
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
  for (const m of ["setTransform","clearRect","save","restore","translate","rotate","scale","beginPath","arc","ellipse","fill","stroke","moveTo","lineTo","quadraticCurveTo","bezierCurveTo","fillRect","strokeRect","fillText","strokeText","drawImage","setLineDash","closePath","clip"]) stub[m] = noop;
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
  for (const id of ["game","ui","skills","message","debugHud","startPanel","levelPanel","levelOptions","endPanel","endTitle","endText","restartBtn","pauseBtn","ultBtn","dengjieBtn","joystick","stick","invincibleChk"]) elements[id] = makeElement(id);
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,autoTriggerUltimate,startNewRun,keys};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}
function isolate(T) {
  T.player.needExp = 1e9;
  T.state.lastSpawn = Infinity;
  T.state.nextFlowEvent = 999;
}

test("HUD：强化期显示『置闰五行：强化中 Xs』，冷却期显示『置闰五行：下次触发 Xs』", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /置闰五行：强化中 /, "强化行含 置闰五行：强化中");
  assert.match(html, /置闰五行：下次触发 /, "冷却行含 置闰五行：下次触发");
});

test("置闰强化特效：boost 期间 ultAura 半径明显（≥37）且多层绘制（可见）", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  T.player.weapons.ultimate.lv = 1; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.autoTriggerUltimate();
  T.update(0.016);
  const auras = T.state.effects.filter(ef => ef.type === "ultAura");
  assert.ok(auras.length >= 1, "boost 期间有 ultAura");
  assert.ok(auras[0].r >= 37, `ultAura 半径应≥37（实际 ${auras[0].r}）`);
  const html = await readFile(GAME, "utf8");
  const draw = html.match(/if\(ef\.type==='ultAura'\)\{[\s\S]*?\n \}/)?.[0] || "";
  assert.ok(draw.includes("setLineDash") || (draw.split("arc").length - 1) >= 3, "ultAura 为多层绘制（可见性）");
});

test("置闰强化：boost 结束后进入冷却并递减计时", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  T.player.weapons.ultimate.lv = 1; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.autoTriggerUltimate();
  assert.equal(T.player.ultimateBoost, 8, "Lv1 boost 8s（当前数值保留）");
  for (let i = 0; i < 45; i++) T.update(0.2); // 9s > 8s
  assert.equal(T.player.ultimateBoost, 0, "boost 结束");
  assert.ok(T.player.ultimateTimer > 0, "进入冷却（ultimateTimer>0）");
  const t0 = T.player.ultimateTimer;
  T.update(1);
  assert.ok(T.player.ultimateTimer < t0, "冷却计时递减");
});
