// Daogui TDD：献目完整技能树（OPTION A 全圆）+ 视觉反馈回归
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,startNewRun,damageEnemy,useEyeSacrifice,densestTarget,keys,weaponDesc,updateWeaponName};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}
function fireEye(T, lv) {
  T.player.weapons.general.lv = lv;
  T.updateWeaponName("general"); // 模拟升级路径：同步 evolved/name
  T.player.x = 0; T.player.y = 0;
  const e = { id: "test", x: 100, y: 0, r: 10, hp: 10000, maxHp: 10000, dmg: 0, speed: 0, dead: false, exp: 1 };
  T.state.enemies.push(e);
  T.player.weapons.general.cd = 0;
  const before = T.state.effects.length;
  T.useEyeSacrifice(0);
  // 手动推进时间触发延迟扫视（Lv4/Lv6 多波），不重复调用 useEyeSacrifice
  const t0 = T.state.time;
  for (let i = 0; i < 10; i++) {
    T.state.time += 0.1;
    for (let j = T.state.tasks.length - 1; j >= 0; j--) {
      const task = T.state.tasks[j];
      if (task.runId !== T.state.runId) { T.state.tasks.splice(j, 1); continue; }
      if (task.due <= T.state.time) { T.state.tasks.splice(j, 1); task.fn(); }
    }
  }
  const gaze = T.state.effects.slice(before).filter(ef => ef.type === "eyeGaze");
  const bahui = T.state.effects.slice(before).filter(ef => ef.type === "bahuiEye");
  T.state.enemies.length = 0;
  T.state.tasks.length = 0;
  return { gaze, bahui, e };
}

test("献目 Lv1：全方向圆形凝视（halfAngle=PI 全圆，非扇形）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const { gaze, e } = fireEye(T, 1);
  assert.ok(gaze.length >= 1, "Lv1 应产生 eyeGaze");
  for (const g of gaze) assert.equal(g.halfAngle, Math.PI, `Lv1 halfAngle=${g.halfAngle} 应全圆(PI)`);
  assert.ok(e.hp < 10000, "Lv1 全圆凝视命中敌人造成伤害");
});

test("献目 Lv1-6 全为圆形几何（无扇形 halfAngle<PI）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  for (let lv = 1; lv <= 6; lv++) {
    const { gaze } = fireEye(T, lv);
    assert.ok(gaze.length >= 1, `Lv${lv} 应产生 eyeGaze`);
    for (const g of gaze) assert.equal(g.halfAngle, Math.PI, `Lv${lv} halfAngle=${g.halfAngle} 应全圆，不允许扇形`);
  }
});

test("献目递进：Lv3 范围≥Lv1、Lv4 双波、Lv6 三波、Lv5 伤害≥Lv1", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const l1 = fireEye(T, 1), l3 = fireEye(T, 3), l4 = fireEye(T, 4), l5 = fireEye(T, 5), l6 = fireEye(T, 6);
  assert.ok(l3.gaze[0].r >= l1.gaze[0].r, `Lv3 范围(${l3.gaze[0].r})应≥Lv1(${l1.gaze[0].r})`);
  assert.equal(l4.gaze.length, 2, "Lv4 追加扫视=2 波");
  assert.equal(l6.gaze.length, 3, "Lv6 三次扫视=3 波");
  // 伤害：Lv5 命中敌人掉血 ≥ Lv1
  const { e: e1 } = fireEye(T, 1); const { e: e5 } = fireEye(T, 5);
  const dmg1 = 10000 - e1.hp, dmg5 = 10000 - e5.hp;
  assert.ok(dmg5 >= dmg1, `Lv5 伤害(${dmg5})应≥Lv1(${dmg1})`);
});

test("献目 Lv7：进化巴虺之眼，触发全图表现（bahuiEye 全屏效果）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const { gaze, bahui } = fireEye(T, 7);
  assert.equal(T.player.weapons.general.evolved, true, "Lv7 应进化");
  assert.ok(bahui.length >= 1, "Lv7 应产生 bahuiEye 全图效果");
  for (const b of bahui) assert.ok(b.r >= 1024, `bahuiEye 覆盖全图(r=${b.r})`);
  // Lv7 仍保留圆形凝视
  for (const g of gaze) assert.equal(g.halfAngle, Math.PI, "Lv7 凝视仍全圆");
});

test("weaponDesc 献目 Lv1-7 描述与实际效果一致（无\"扇形\"措辞）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  for (let lv = 1; lv <= 7; lv++) {
    const d = T.weaponDesc("general", lv);
    assert.ok(typeof d === "string" && d.length > 0, `Lv${lv} 有描述`);
    assert.ok(!d.includes("扇形"), `Lv${lv} 描述不得含\"扇形\"（全圆几何）：${d}`);
  }
});
