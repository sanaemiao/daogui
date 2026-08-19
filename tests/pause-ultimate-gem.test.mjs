// Daogui TDD：自动暂停保持 / 置闰五行主动触发 / 经验点吸收无残留
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,autoPause,autoTriggerUltimate,collectGems,startNewRun,togglePause,keys};})();`,
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
  // 预置 phaseIndex 避免首次 update 阶段切换把 lastSpawn 重置为 min(Infinity,.18)=.18 触发刷怪
  T.state.phaseIndex = 0;
}

// ============ 自动暂停保持 ============
test("自动暂停：失焦后保持暂停，不被安全网复位，手动恢复", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  assert.equal(T.state.paused, false, "开局不暂停");
  T.autoPause("测试失焦");
  assert.equal(T.state.paused, true, "自动暂停置位");
  assert.equal(T.state.manualPause, true, "自动暂停标记 manualPause");
  T.update(0.016);
  assert.equal(T.state.paused, true, "下一帧安全网不得复位自动暂停");
  T.update(0.016);
  assert.equal(T.state.paused, true, "持续保持暂停");
  T.togglePause();
  assert.equal(T.state.paused, false, "点击暂停按钮后恢复");
  assert.equal(T.state.manualPause, false, "manualPause 复位");
});

// ============ 置闰五行自动循环 ============
test("置闰五行：自动触发——Lv1 强化+45%/-15%/8s，Lv3 更高数值，强化中不重复触发", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  const w = T.player.weapons.ultimate;
  const hp0 = T.player.hp;
  // Lv1：自动触发（+45%/-15%/8s）
  w.lv = 1; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.update(0.016);
  assert.equal(T.player.ultimateBoost, 8, "Lv1 持续 8s");
  assert.ok(T.player.hp < hp0, "Lv1 自动献祭扣血");
  // Lv3：自动触发（+75%/-40%/10s）
  w.lv = 3; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  const hp1 = T.player.hp;
  T.update(0.016);
  assert.equal(T.player.ultimateBoost, 10, "Lv3 持续 10s");
  assert.equal(T.player.ultimateTimer, 30, "Lv3 进入 30s 祭期冷却");
  assert.ok(T.player.hp < hp1, "自动触发献祭扣血");
  // 强化期间 update 不重复触发（boost 不清零不重复献祭）
  const hp2 = T.player.hp;
  T.update(0.016);
  assert.equal(T.player.hp, hp2, "强化期间不重复献祭");
  assert.ok(Math.abs(T.player.ultimateBoost - (10 - 0.016)) < 1e-9, "强化期间 boost 正常递减不重置");
});

test("置闰五行：update 自动献祭并自动触发强化（被动循环）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  const w = T.player.weapons.ultimate;
  w.lv = 3; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  const hp0 = T.player.hp;
  T.update(0.016);
  assert.ok(T.player.ultimateBoost > 0, "update 自动触发强化");
  assert.ok(T.player.hp < hp0, "自动触发伴随 12% 献祭扣血");
});

// ============ 经验点吸收无残留 ============
test("经验点：吸收即移除，无残留", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.exp = 0;
  T.state.gems.push({ x: 20, y: 0, value: 3, r: 5 });
  T.collectGems(0.016);
  assert.equal(T.state.gems.length, 0, "吸收后无残留宝石");
  assert.equal(T.player.exp, 3, "经验到账");
});

test("经验点：pickup 半径内拉取跨吸收阈值后同帧移除", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.exp = 0;
  // 距离 40：pickup=82 内（会拉取），吸收半径 r+14=29 外（尚未吸收）
  T.state.gems.push({ x: 40, y: 0, value: 3, r: 5 });
  T.collectGems(0.033); // 拉取 440*0.033≈14.5 → 到 ~25.5，跨过 29 阈值
  assert.equal(T.state.gems.length, 0, "拉取跨阈值后同帧吸收，无残留");
  assert.equal(T.player.exp, 3, "经验到账");
});
