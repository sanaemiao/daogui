// Daogui TDD：精英与 Boss 画面顶部全局血条（可并列）回归
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
    `requestAnimationFrame(loop);window.__T__={state,player,startNewRun,activeThreats,spawnElite,spawnBoss,damageEnemy};})();`,
  );
  const { sandbox } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__ };
}

function mk(id, flags = {}) {
  return { id, text: flags.text || id, x: 50, y: 0, r: 16, hp: 1000, maxHp: 1000, dmg: 1, speed: 0, dead: false, boss: !!flags.boss, elite: !!flags.elite, exp: 1 };
}

// ============ 运行时：全局血条候选筛选 ============
test("activeThreats：仅统计存活精英与 Boss，普通怪不计入", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  assert.equal(T.activeThreats().length, 0, "空场无血条候选");
  T.state.enemies.push(mk("wumian")); // 普通怪
  assert.equal(T.activeThreats().length, 0, "普通怪不计入");
  T.state.enemies.push(mk("eliteDanyangzi", { elite: true }));
  assert.equal(T.activeThreats().length, 1, "精英计入");
  T.state.enemies.push(mk("bossLayue", { boss: true }));
  assert.equal(T.activeThreats().length, 2, "精英+到场Boss 并列显示两个血条");
});

test("activeThreats：死亡精英/Boss 从血条剔除", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = mk("eliteXishen", { elite: true });
  T.state.enemies.push(e);
  assert.equal(T.activeThreats().length, 1, "存活精英在榜");
  T.damageEnemy(e, 999999);
  assert.equal(T.activeThreats().length, 0, "死亡精英从榜剔除");
});

test("activeThreats：真实 spawn 的精英/Boss 携带正确标志", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.state.enemies.length = 0;
  T.spawnElite("danyangzi");
  T.spawnBoss("layue");
  const threats = T.activeThreats();
  assert.equal(threats.length, 2, "丹阳子精英 + 腊月十八 Boss 并列");
  assert.ok(threats.some(e => e.elite && e.id === "eliteDanyangzi"), "丹阳子为精英");
  assert.ok(threats.some(e => e.boss && e.id === "bossLayue"), "腊月十八为 Boss");
});

// ============ 源码契约：顶部绘制与并列 ============
test("drawThreatBars：顶部全局定位、并列堆叠、Boss/精英配色区分", async () => {
  const src = await readFile(GAME, "utf8");
  const fn = src.match(/function drawThreatBars\(\)\{[\s\S]*?\n\}/)[0];
  // 候选来源为可测纯函数
  assert.match(src, /function activeThreats\(\)\{/, "activeThreats 已抽出");
  assert.match(src, /const threats=activeThreats\(\);/, "drawThreatBars 复用 activeThreats");
  assert.match(src, /drawThreatBars\(\);/, "draw() 每帧调用 drawThreatBars");
  // 顶部全局（屏幕坐标，居中，逐条 y 堆叠实现并列）
  assert.match(fn, /const width=Math\.min\(innerWidth/, "宽度相对视口");
  assert.match(fn, /const y=10\+i\*28/, "逐条垂直并列堆叠");
  // Boss 与精英配色区分
  assert.match(fn, /e\.boss\?'#cf4c3f':'#b9794f'/, "Boss 红 / 精英铜 配色区分");
  // 血条填充按 hp/maxHp 比例
  assert.match(fn, /width\*clamp\(e\.hp\/e\.maxHp,0,1\)/, "填充与血量比例一致");
});
