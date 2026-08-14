// Daogui TDD：献目定形 减速改为定身（定身时长随等级递增），巴虺之眼/全圆几何不回归
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
    `requestAnimationFrame(loop);window.__T__={state,player,useEyeSacrifice,update,startNewRun,keys};})();`,
  );
  const { sandbox } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__ };
}
function setupEye(T, lv) {
  T.startNewRun();
  T.player.needExp = 1e9;
  T.state.lastSpawn = Infinity;
  T.state.nextFlowEvent = 999;
  for (const k of ["coin","you","suisui","fire","blood","ultimate"]) T.player.weapons[k].lv = 0;
  T.player.weapons.general.lv = lv;
  T.player.weapons.general.cd = 0;
}
function mkEnemy(over = {}) {
  return { id: "wumian", x: 200, y: 0, r: 17, hp: 99999, maxHp: 99999, dmg: 0, speed: 60, dead: false, boss: false, elite: false, exp: 0, hitCd: 0, slow: 0, driftPhase: 0, role: "chaser", ...over };
}

test("献目：命中施加定身（1 秒内不移动），修复前仅减速仍移动", async () => {
  const { T } = await loadGame();
  setupEye(T, 1);
  const e = mkEnemy();
  T.state.enemies.push(e);
  T.useEyeSacrifice(0.016); // 半径 245，命中 x=200 敌人
  assert.ok(e.stun > 0, "敌人应被施加定身(stun)");
  const x0 = e.x;
  for (let i = 0; i < 10; i++) T.update(0.1); // 1s
  assert.equal(e.x, x0, "被定身敌人 1s 内不应移动");
});

test("献目：定身也冻结冲刺位移（dasher）", async () => {
  const { T } = await loadGame();
  setupEye(T, 1);
  const e = mkEnemy({ role: "dasher", dashState: "dashing", dashAngle: Math.PI, dashTimer: 10 });
  T.state.enemies.push(e);
  T.useEyeSacrifice(0.016);
  assert.ok(e.stun > 0, "冲刺敌人应被施加定身");
  const x0 = e.x;
  for (let i = 0; i < 10; i++) T.update(0.1); // 1s
  assert.equal(e.x, x0, "冲刺中的 dasher 被定身后不移动");
});

test("献目：定身时长随等级递增（Lv6 > Lv1）", async () => {
  const { T } = await loadGame();
  setupEye(T, 1);
  const a = mkEnemy({ x: 100, speed: 0 });
  T.state.enemies.push(a);
  T.useEyeSacrifice(0.016);
  const stun1 = a.stun || 0;
  T.state.enemies.length = 0;
  T.player.weapons.general.lv = 6;
  T.player.weapons.general.cd = 0;
  const b = mkEnemy({ x: 100, speed: 0 });
  T.state.enemies.push(b);
  T.useEyeSacrifice(0.016);
  const stun6 = b.stun || 0;
  assert.ok(stun6 > stun1, `Lv6 定身(${stun6})应长于 Lv1(${stun1})`);
});

test("献目：源码契约——stun 字段 + 全圆几何 + 巴虺之眼不回归", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /const stun=\(lv>=6\?2\.0:/, "定身时长公式随等级递增");
  assert.match(html, /e\.stun=Math\.max\(e\.stun\|\|0,stun\)/, "献目施加 stun 而非 slow");
  assert.match(html, /halfAngle:Math\.PI/, "仍全圆凝视几何");
  assert.match(html, /type:'bahuiEye'/, "巴虺之眼不回归");
});
