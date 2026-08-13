// Daogui TDD：Boss 奖励 3→2→1 缩小 + 轮盘动画移除 + 献目扇形几何
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const GAME = new URL("../index.html", import.meta.url);
const CFG = new URL("../src/v10.5/stage1-config.js", import.meta.url);
const CORE = new URL("../src/v10.5/combat-core.js", import.meta.url);

function makeCtxStub() {
  const grad = { addColorStop() {} };
  const stub = {}; const noop = () => {};
  for (const m of ["setTransform","clearRect","save","restore","translate","rotate","scale","beginPath","arc","fill","stroke","moveTo","lineTo","quadraticCurveTo","bezierCurveTo","fillRect","strokeRect","fillText","strokeText","drawImage","setLineDash","ellipse","closePath","clip"]) stub[m] = noop;
  stub.createRadialGradient = () => grad; stub.createLinearGradient = () => grad;
  return stub;
}
function makeElement(id) {
  const el = { id, style: {}, children: [], textContent: "", handlers: {}, addEventListener(t, fn) { this.handlers[t] = fn; }, appendChild(c) { this.children.push(c); }, remove() {}, closest() { return null; } };
  el.parentElement = el;
  let _h = ""; Object.defineProperty(el, "innerHTML", { get() { return _h; }, set(v) { _h = String(v); el.children.length = 0; } });
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
    createElement(tag) { return makeElement(`dyn-${tag}`); },
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,startNewRun,damageEnemy,levelOptions,levelPanel,chooseOption,rewardActiveOptions,useEyeSacrifice,densestTarget,damageEnemy,keys};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}
function placeReward(T) {
  const r = { x: 0, y: 0, r: 12 };
  T.state.rewards.push(r);
  T.player.x = 0; T.player.y = 0;
}

test("红灯：预选 3 张后即使候选减少（武器满级），奖励面板仍显示 3 张（3→2→1 回归）", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  // 4 个候选，触碰预选 3 个
  T.player.weapons.coin.lv = 7; T.player.weapons.you.lv = 7; T.player.weapons.suisui.lv = 7;
  const before = T.rewardActiveOptions().length;
  assert.ok(before >= 3, `前置：至少3个候选（实际${before}）`);
  placeReward(T);
  T.update(0.05);
  assert.equal(T.state.rewardPick.length, 3, "触碰预选 3 个 key");
  // 模拟触碰后玩家武器升满（候选减少）：reveal/选择间隙武器状态变化不应缩小已预选面板
  const chosen = T.state.rewardPick[0].key;
  T.player.weapons[chosen].lv = 7; // 把预选武器顶到满级
  // 面板已直接显示（revealing 标记保持到选卡后清除），断言 3 张卡不被候选减少影响
  const opts = [...T.levelOptions.children];
  assert.equal(opts.length, 3, `面板应显示 3 张（实际 ${opts.length}）——候选减少不得缩小已预选面板`);
});

test("红灯：触碰奖励物后立即显示面板（无 0.7s 轮盘延迟）", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  placeReward(T);
  T.update(0.05); // 触碰
  const opts = [...T.levelOptions.children];
  assert.ok(opts.length >= 3, `触碰后立即显示 3 张卡（实际 ${opts.length}）——不应有轮盘动画延迟`);
});

test("献目（general）Lv1 全方向圆形凝视（halfAngle=PI，OPTION A 全圆契约）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.weapons.general.lv = 1;
  T.player.x = 0; T.player.y = 0;
  // 放置一个敌人定方向
  const e = { id: "test", x: 300, y: 0, r: 10, hp: 100, maxHp: 100, dmg: 0, speed: 0, dead: false, exp: 1 };
  T.state.enemies.push(e);
  const before = T.state.effects.length;
  T.useEyeSacrifice(0);
  const gaze = T.state.effects.slice(before).find(ef => ef.type === "eyeGaze");
  assert.ok(gaze, "Lv1 应产生 eyeGaze 圆形凝视效果");
  // OPTION A（tests/eye-tree.test.mjs）为权威契约：Lv1-7 全圆 halfAngle=PI；本断言与之一致
  assert.equal(gaze.halfAngle, Math.PI, `Lv1 halfAngle=${gaze.halfAngle} 应为全圆(PI)`);
});
