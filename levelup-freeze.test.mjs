// Daogui 普通升级卡死回归测试（确定性 harness）
// 驱动真实经验跨阈值 → 断言升级面板可交互 → 选卡后 update/移动恢复
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const GAME = new URL("../public/game/index.html", import.meta.url);
const CFG = new URL("../public/game/src/v10.5/stage1-config.js", import.meta.url);
const CORE = new URL("../public/game/src/v10.5/combat-core.js", import.meta.url);

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
  const el = {
    id, style: {}, children: [], textContent: "", innerHTML: "",
    handlers: {},
    addEventListener(t, fn) { this.handlers[t] = fn; },
    appendChild(c) { this.children.push(c); },
    remove() {},
    closest() { return null; },
  };
  el.parentElement = el;
  return el;
}

function buildSandbox() {
  const elements = {};
  const keyHandlers = [];
  const els = [
    "game","ui","skills","message","debugHud","startPanel","levelPanel","levelOptions",
    "endPanel","endTitle","endText","restartBtn","pauseBtn","dodgeBtn","ultBtn","joystick","stick",
  ];
  for (const id of els) elements[id] = makeElement(id);
  const ctxStub = makeCtxStub();
  elements.game.getContext = () => ctxStub;

  const document = {
    getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
    querySelector(sel) {
      if (sel === "#levelPanel h2") return elements["levelPanel-h2"] || (elements["levelPanel-h2"] = makeElement("levelPanel-h2"));
      return null;
    },
    querySelectorAll() { return { forEach() {} }; },
    createElement(tag) { return makeElement(`dyn-${tag}-${Math.random()}`); },
    addEventListener() {},
  };

  let rafCb = null;
  const window = {
    innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } },
  };
  window.window = window;

  const sandbox = {
    window, document,
    innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1,
    addEventListener() {},
    Image: window.Image,
    Math,
    setTimeout, clearTimeout,
    performance: { now: () => 0 },
    requestAnimationFrame(cb) { rafCb = cb; },
    console,
  };
  sandbox.globalThis = sandbox;
  return { sandbox, elements, rafCb: () => rafCb };
}

async function loadGame() {
  const [html, cfg, core] = await Promise.all([readFile(GAME, "utf8"), readFile(CFG, "utf8"), readFile(CORE, "utf8")]);
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  // 注入测试导出钩子（仍在内层 IIFE 内）
  script = script.replace(
    /requestAnimationFrame\(loop\);\s*\}\)\(\);\s*$/,
    `requestAnimationFrame(loop);window.__T__={state,player,update,levelUp,collectGems,finishLevelChoice,chooseOption,getLevelOptions,randomNormalOptions,updateWeaponName,togglePause,triggerDodge,keys,startNewRun,debugJumpToNextNode,levelPanel,levelOptions};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}

test("普通升级：经验跨阈值→面板可交互→选卡后恢复移动", async () => {
  const { T, elements } = await loadGame();
  // 开局
  T.startNewRun();
  assert.equal(T.state.paused, false);
  // 造经验：Lv4，exp=needExp-1，捡一颗小宝石跨阈值
  T.player.level = 4;
  T.player.exp = T.player.needExp - 1; // needExp = 32+4*13 = 84 → exp 83
  T.state.gems.push({ x: T.player.x, y: T.player.y, value: 3, r: 5 });
  T.collectGems(0.016);
  // 面板必须弹出且可交互
  assert.equal(T.state.leveling, true, "升级中标记应置位");
  assert.equal(T.state.paused, true, "升级时应暂停");
  const opts = elements.levelOptions.children;
  assert.ok(opts.length >= 1, `升级面板至少一个选项（实际 ${opts.length}）`);
  assert.equal(typeof opts[0].onclick, "function", "选项必须可点击");
  // 选卡后恢复
  opts[0].onclick();
  assert.equal(T.state.leveling, false, "选卡后 leveling 应清除");
  assert.equal(T.state.paused, false, "选卡后应解除暂停");
  // 移动恢复：按 D 键后 update，玩家 x 应变化
  const x0 = T.player.x;
  T.keys.add("d");
  T.update(0.1);
  T.keys.delete("d");
  assert.ok(T.player.x > x0, "选卡后移动必须恢复");
});

test("批量宝石：一次收集跨多级不卡死", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.player.level = 2; // needExp = 32+2*13 = 58
  T.player.exp = 57;
  // 一批 6 颗宝石，价值足以连升 2 级
  for (let i = 0; i < 6; i++) T.state.gems.push({ x: T.player.x, y: T.player.y, value: 20, r: 5 });
  T.collectGems(0.016);
  // 应进入升级面板（可能因 finishLevelChoice 连锁再次弹出，但绝不能冻结）
  const safety = T.state.paused || T.state.leveling;
  assert.ok(safety, "批量宝石后应处于升级暂停态");
  assert.ok(elements.levelOptions.children.length >= 1, "面板有选项");
  // 反复选卡直到恢复
  let guard = 0;
  while ((T.state.leveling || T.state.paused) && guard < 20) {
    const opts = elements.levelOptions.children;
    assert.ok(opts.length >= 1, `第${guard}次升级面板有选项`);
    opts[0].onclick();
    guard++;
  }
  assert.equal(T.state.paused, false, "批量宝石连升后最终恢复");
  assert.ok(T.player.level >= 4, `应连升至少2级（实际 Lv${T.player.level}）`);
});

test("F4跳关后杀怪升级：面板可交互且选卡恢复", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  // F4 跳到 590s
  T.state.time = 0; T.state.nextFlowEvent = 0;
  T.debugJumpToNextNode();
  assert.equal(T.state.paused, false, "跳关后不暂停");
  assert.equal(T.state.hitstop, 0, "跳关后 hitstop 归零");
  // 造经验跨阈值
  T.player.level = 6;
  T.player.exp = T.player.needExp - 1;
  T.state.gems.push({ x: T.player.x, y: T.player.y, value: 5, r: 5 });
  T.collectGems(0.016);
  assert.equal(T.state.leveling, true, "F4后升级面板弹出");
  assert.ok(elements.levelOptions.children.length >= 1, "F4后面板有选项");
  elements.levelOptions.children[0].onclick();
  assert.equal(T.state.paused, false, "F4后选卡恢复");
  const x0 = T.player.x;
  T.keys.add("a"); T.update(0.1); T.keys.delete("a");
  assert.ok(T.player.x < x0, "F4后移动恢复");
});

test("Lv8升级：置闰五行卡可正常生成（原异常路径）", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.player.level = 8;
  // 原异常路径：player.weapons.ultimate 缺失时此行抛 TypeError；修复后必须零异常
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    for (const o of T.randomNormalOptions()) seen.add(o.title);
  }
  assert.ok(seen.has("获得：置闰五行"), "Lv8 选项池应包含置闰五行卡");
  // 端到端：真实跨阈值不冻结、可交互、可恢复
  T.player.exp = T.player.needExp - 1;
  T.state.gems.push({ x: T.player.x, y: T.player.y, value: 5, r: 5 });
  T.collectGems(0.016);
  assert.equal(T.state.leveling, true, "Lv8 升级面板弹出");
  assert.ok(elements.levelOptions.children.length >= 1, "Lv8 面板有选项");
  elements.levelOptions.children[0].onclick();
  assert.equal(T.state.paused, false, "Lv8 选卡后恢复");
});

test("手动暂停：P键暂停后不被自动解除", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.togglePause();
  assert.equal(T.state.paused, true, "手动暂停生效");
  assert.equal(T.state.manualPause, true, "manualPause 标记置位");
  // 多帧 update 不应自动解除
  T.update(0.016); T.update(0.016); T.update(0.016);
  assert.equal(T.state.paused, true, "手动暂停持续多帧不被解除");
  // 再按 P 恢复
  T.togglePause();
  assert.equal(T.state.paused, false, "再次 P 解除暂停");
  assert.equal(T.state.manualPause, false, "manualPause 复位");
});
