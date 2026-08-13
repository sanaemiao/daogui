// Restart hitstop freeze regression: 死亡时 hitstop 残留 → 重开 → 不冻结
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
  let rafCb = null;
  const window = { innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, matchMedia: () => ({ matches: false }), addEventListener() {}, Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } } };
  window.window = window;
  const sandbox = { window, document, innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, addEventListener() {}, Image: window.Image, Math, setTimeout, clearTimeout, performance: { now: () => 0 }, requestAnimationFrame(cb) { rafCb = cb; }, console };
  sandbox.globalThis = sandbox;
  return { sandbox, elements, rafCb: () => rafCb };
}
async function loadGame() {
  const [html, cfg, core] = await Promise.all([readFile(GAME, "utf8"), readFile(CFG, "utf8"), readFile(CORE, "utf8")]);
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace(
    /requestAnimationFrame\(loop\);\s*\}\)\(\);\s*$/,
    `requestAnimationFrame(loop);window.__T__={state,player,update,takePlayerHit,startNewRun,keys};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}

test("死亡时 hitstop 残留 → 重开 → 60帧不冻结、时间推进、shake归零", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  // 模拟死亡瞬间 hitstop 仍在飞行（如 Boss 击杀 hitstop=0.12 未消耗）
  T.player.hp = 3;
  T.takePlayerHit(999);
  assert.equal(T.state.gameOver, true);
  T.state.hitstop = 0.5; // 死亡后残留
  T.state.shakeX = 6; T.state.shakeY = -4;
  // 点击 restartBtn 真实监听器重开
  const click = elements.restartBtn.handlers.click;
  assert.equal(typeof click, "function", "restartBtn 有真实监听器");
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(T.state.gameOver, false, "重开后 gameOver=false");
  // 60 帧 update：hitstop 若未重置会全部 return → state.time 不推进（冻结）
  for (let i = 0; i < 60; i++) T.update(0.016);
  assert.ok(T.state.time > 0, `60帧后游戏时间应推进（实际 ${T.state.time}）——修复前 hitstop 残留导致冻结`);
  assert.equal(T.state.hitstop, 0, "重开后 hitstop 归零");
  assert.equal(T.state.shakeX, 0, "重开后 shakeX 归零");
  assert.equal(T.state.shakeY, 0, "重开后 shakeY 归零");
  // 移动恢复
  const x0 = T.player.x;
  T.keys.add("d"); T.update(0.1); T.keys.delete("d");
  assert.ok(T.player.x > x0, "重开后移动恢复");
});

test("重开不残留 playerTrail 且无玩家闪避控制路径", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.state.playerTrail.push({ x: 1, y: 2, life: 0.2 });
  const click = elements.restartBtn.handlers.click;
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(T.state.playerTrail.length, 0, "重开后 playerTrail 清空");
});

test("玩家闪避已移除：无 triggerDodge 导出/无 dodgeBtn/无键盘触发", async () => {
  const { T, elements } = await loadGame();
  assert.equal(typeof T.triggerDodge, "undefined", "无 triggerDodge 可调用路径");
  const html = await readFile(GAME, "utf8");
  assert.doesNotMatch(html, /triggerDodge|dodgeBtn|Shift 闪避/, "代码无玩家闪避");
});
