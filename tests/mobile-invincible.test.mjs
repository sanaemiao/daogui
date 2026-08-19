// Daogui：移动端登阶按钮修复、置闰强化特效、无敌模式
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,triggerCangQiang,autoTriggerUltimate,startNewRun,takePlayerHit,keys};})();`,
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

test("移动端：摇杆 pointerdown 不拦截登阶按钮（置闰主动按钮已彻底移除）", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /e\.target\.id==='dengjieBtn'/, "pointerdown 排除 dengjieBtn");
  assert.doesNotMatch(html, /ultBtn/, "置闰主动按钮已彻底移除（无 ultBtn）");
});

test("置闰强化：boost 期间玩家身上有 ultAura 特效，结束后清除", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.weapons.ultimate.lv = 1; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.autoTriggerUltimate();
  assert.equal(T.player.ultimateBoost, 8, "boost 生效");
  T.update(0.016);
  assert.ok(T.state.effects.some(ef => ef.type === "ultAura"), "boost 期间有 ultAura");
  // 推进超过 8s 让 boost 结束
  for (let i = 0; i < 50; i++) T.update(0.2);
  assert.equal(T.player.ultimateBoost, 0, "boost 结束");
  for (let i = 0; i < 5; i++) T.update(0.05);
  assert.ok(!T.state.effects.some(ef => ef.type === "ultAura"), "boost 结束后 ultAura 清除");
});

test("无敌模式：player.invincible=true 时所有伤害类型免疫，关闭后掉血", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.invincible = true;
  T.player.hp = 100;
  const hp0 = T.player.hp;
  for (const t of ["contact", "projectile", "telegraph", "pollution", "sacrifice"]) {
    T.takePlayerHit(50, t);
    assert.equal(T.player.hp, hp0, `${t} 伤害免疫`);
  }
  T.player.invincible = false;
  T.takePlayerHit(50, "contact");
  assert.ok(T.player.hp < hp0, "关闭后正常掉血");
});

test("无敌模式：startNewRun 从首页勾选读取 invincible", async () => {
  const { T, elements } = await loadGame();
  elements.invincibleChk.checked = true;
  T.startNewRun();
  assert.equal(T.player.invincible, true, "勾选后进入无敌模式");
  elements.invincibleChk.checked = false;
  T.startNewRun();
  assert.equal(T.player.invincible, false, "未勾选为普通模式");
});

test("苍蜣登阶：未习得/冷却/气血不足时给出明确反馈", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  // 未习得
  T.player.cangqiang.lv = 0;
  T.triggerCangQiang();
  assert.match(elements.message.textContent, /尚未习得/, "未习得有反馈");
  // 冷却中
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 10;
  T.triggerCangQiang();
  assert.match(elements.message.textContent, /冷却/, "冷却有反馈");
  // 气血不足
  T.player.cangqiang.cd = 0; T.player.hp = 1;
  T.triggerCangQiang();
  assert.match(elements.message.textContent, /气血不足/, "气血不足有反馈");
});
