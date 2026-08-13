// Daogui TDD：升级选择池按武器 key 去重（黑太岁重复卡回归）
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
  return { sandbox, elements };
}
async function loadGame() {
  const [html, cfg, core] = await Promise.all([readFile(GAME, "utf8"), readFile(CFG, "utf8"), readFile(CORE, "utf8")]);
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace(
    /requestAnimationFrame\(loop\);\s*\}\)\(\);\s*$/,
    `requestAnimationFrame(loop);window.__T__={state,player,update,levelUp,collectGems,finishLevelChoice,chooseOption,getLevelOptions,randomNormalOptions,updateWeaponName,startNewRun,createInitialPlayerState,useBlood,keys,levelOptions,levelPanel};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}

test("红灯：升级选择池同一武器 key 不重复出现（黑太岁重复卡回归）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  // 截图场景：level<=3 且 suisui 未拥有（保底"获得黑太岁触须" + 循环"获得黑太岁" 同时进池）
  assert.ok(T.player.level <= 3, "前置：level<=3 触发保底");
  assert.equal(T.player.weapons.suisui.lv, 0, "前置：suisui 未拥有");
  // 多轮采样（覆盖随机排序），每轮选项内武器 key 不得重复
  for (let round = 0; round < 200; round++) {
    const opts = T.randomNormalOptions();
    const keys = opts.filter(o => o.type === "weapon").map(o => o.key);
    assert.equal(new Set(keys).size, keys.length, `第${round}轮武器 key 重复：${JSON.stringify(keys)}`);
  }
});

test("红灯：未拥有黑太岁只以\"获得\"出现，绝不与\"升级\"同轮共存", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  assert.equal(T.player.weapons.suisui.lv, 0);
  for (let round = 0; round < 200; round++) {
    const opts = T.randomNormalOptions();
    const suisuiOpts = opts.filter(o => o.type === "weapon" && o.key === "suisui");
    assert.ok(suisuiOpts.length <= 1, `第${round}轮 suisui 选项数=${suisuiOpts.length}（应≤1）`);
    for (const o of suisuiOpts) assert.ok(o.title.startsWith("获得"), `未拥有的黑太岁只能\"获得\"，实际 title=${o.title}`);
  }
});

test("红灯：已拥有黑太岁只以\"升级\"出现，不同时出现\"获得\"", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.weapons.suisui.lv = 2; // 已拥有（升级候选）
  for (let round = 0; round < 200; round++) {
    const opts = T.randomNormalOptions();
    const suisuiOpts = opts.filter(o => o.type === "weapon" && o.key === "suisui");
    assert.ok(suisuiOpts.length <= 1, `第${round}轮 suisui 选项数=${suisuiOpts.length}（应≤1）`);
    for (const o of suisuiOpts) assert.ok(o.title.startsWith("黑太岁") || o.title.startsWith("李岁"), `已拥有的黑太岁只能\"升级\"，实际 title=${o.title}`);
  }
});

test("红灯：getLevelOptions 返回的最终三选无重复武器 key", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  for (let round = 0; round < 100; round++) {
    const opts = T.getLevelOptions();
    const keys = opts.filter(o => o.type === "weapon").map(o => o.key);
    assert.equal(new Set(keys).size, keys.length, `第${round}轮 getLevelOptions 武器 key 重复：${JSON.stringify(keys)}`);
  }
});
