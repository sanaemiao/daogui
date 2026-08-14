// Daogui TDD：黑太岁触手三段挥扫（起手伸出→横向挥扫→命中），伤害延迟到挥扫接触点
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
    `requestAnimationFrame(loop);window.__T__={state,player,useSuisui,update,startNewRun,updateWeaponName,keys};})();`,
  );
  const { sandbox } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__ };
}
function setupBlackTaisui(T) {
  T.startNewRun();
  T.player.needExp = 1e9;
  T.state.lastSpawn = Infinity;
  T.state.nextFlowEvent = 999;
  // 只留黑太岁，禁用其它武器避免干扰
  for (const k of ["coin","you","fire","blood","general","ultimate"]) T.player.weapons[k].lv = 0;
  T.player.weapons.suisui.lv = 1;
  T.player.weapons.suisui.form = "black";
  T.player.weapons.suisui.cd = 0;
}

test("黑太岁触手：起手/伸出阶段不结算伤害，挥扫接触点才结算", async () => {
  const { T } = await loadGame();
  setupBlackTaisui(T);
  const e = { id: "wumian", x: 100, y: 0, r: 17, hp: 500, maxHp: 500, dmg: 0, speed: 0, dead: false, boss: false, elite: false, exp: 0, hitCd: 0, slow: 0 };
  T.state.enemies.push(e);
  const hp0 = e.hp;
  T.useSuisui(0.016); // 调度触手（起手伸出）
  for (let i = 0; i < 4; i++) T.update(0.05); // 0.2s：触手已伸出，挥扫接触(≈0.33s)未到
  assert.ok(T.state.effects.some(ef => ef.type === "tentacle"), "触手特效已生成（三段视觉）");
  assert.equal(e.hp, hp0, "起手/伸出阶段不应造成伤害");
  for (let i = 0; i < 8; i++) T.update(0.05); // 再 0.4s，越过挥扫接触点
  assert.ok(e.hp < hp0, "挥扫接触点应结算伤害");
});

test("黑太岁触手：完整三段生命周期可见（life≈0.6s + 独立挥扫相位）", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /type:'tentacle'[^\n]*life:\.6,maxLife:\.6/, "触手生命延长到 0.6s");
  assert.match(html, /scheduleGameTask\(330,/, "伤害延迟 330ms 对齐挥扫接触点");
  const tentacle = html.slice(html.indexOf("ef.type==='tentacle'"), html.indexOf("ef.type==='daqian'"));
  assert.ok(tentacle.includes("prog="), "生长进度 prog 存在");
  assert.ok(tentacle.includes("reach"), "伸长量 reach 存在");
  assert.ok(tentacle.includes("sweepPhase"), "独立挥扫相位 sweepPhase 存在");
  assert.ok(tentacle.includes("clamp"), "挥扫相位用 clamp 限制在伸出之后的中段");
});

test("李穗协战路径不回归：仍走 liSuiGrab/liSuiConverge 即时结算，非触手挥扫", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /type:'liSuiGrab'/, "李穗抓取特效仍在");
  assert.match(html, /type:'liSuiConverge'/, "李穗收束特效仍在");
  assert.match(html, /damageEnemy\(enemy,62\*atkMul\(\)\)/, "李穗即时结算伤害不受触手延迟影响");
});
