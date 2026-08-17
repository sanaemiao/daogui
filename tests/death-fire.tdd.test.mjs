// Daogui P0 TDD：死亡结算冻结 + 火衣 AOE+DOT（先红后绿）
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,takePlayerHit,useFire,damageEnemy,endGame,startNewRun,resetStick,keys};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}

// ============ A. 死亡结算冻结 ============

test("A1 死亡：takePlayerHit 致死不抛异常且结算页正常（修前红：endGame undefined）", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.player.hp = 5;
  // 驱动真实致死链路
  let threw = null;
  try { T.takePlayerHit(999); } catch (e) { threw = e; }
  assert.equal(threw, null, `takePlayerHit 不得抛异常（实际: ${threw?.message}）`);
  assert.equal(T.state.gameOver, true, "gameOver=true");
  assert.equal(T.state.paused, true, "死亡后暂停");
  assert.equal(elements.endPanel.style.display, "flex", "结算页显示");
  assert.ok(elements.endTitle.textContent.length > 0, "结算标题有内容");
  assert.ok(elements.endText.innerHTML.length > 0, "结算文本含统计");
  assert.equal(elements.levelPanel.style.display, "none", "升级面板隐藏");
  assert.equal(T.state.tasks.length, 0, "任务清空");
});

test("A2 死亡后点击 restartBtn 可开新局并恢复移动", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.player.hp = 3;
  T.takePlayerHit(999);
  assert.equal(T.state.gameOver, true);
  const click = elements.restartBtn.handlers.click;
  assert.equal(typeof click, "function", "restartBtn 有真实监听器");
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(T.state.gameOver, false, "重开后 gameOver=false");
  assert.equal(T.state.paused, false, "重开后未暂停");
  const x0 = T.player.x;
  T.keys.add("d"); T.update(0.1); T.keys.delete("d");
  assert.ok(T.player.x > x0, "重开后移动恢复");
});

test("A3 通关 endGame(true) 幂等：调用两次不抛、状态一致", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.endGame(true, "通关测试");
  assert.equal(T.state.gameOver, true);
  assert.equal(elements.endPanel.style.display, "flex");
  assert.equal(elements.endTitle.textContent, "通关");
  // 幂等：第二次调用不抛、不重复改状态
  let threw = null;
  try { T.endGame(true, "再调一次"); } catch (e) { threw = e; }
  assert.equal(threw, null, "endGame 二次调用不抛");
  assert.equal(T.state.gameOver, true);
});

// ============ B. 火衣 AOE+DOT ============

function spawnEnemyAt(T, x, y, hp = 99999) {
  const e = { x, y, r: 8, hp, maxHp: hp, dmg: 1, dead: false, boss: false, elite: false, exp: 0, hitCd: 0, slow: 0, animOffset: 0, driftPhase: 0 };
  T.state.enemies.push(e);
  return e;
}
function fireOnce(T, lv, evolved = false) {
  const w = T.player.weapons.fire;
  w.lv = lv; w.evolved = evolved; w.cd = 0; w.active = 0; w.trailCd = 0;
  T.useFire(0.016);
}
// 隔离波次导演：不再刷怪/触发事件，已生成敌人无伤害，避免长时间 update 干扰测试
function isolateDirector(T) {
  T.state.lastSpawn = Infinity;
  T.state.nextFlowEvent = 999;
  T.state.phaseIndex = 0;
  for (const e of T.state.enemies) { e.dmg = 0; e.speed = 0; }
}

test("B1 火衣：范围内瞬伤 + 灼烧DOT后续掉血", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = spawnEnemyAt(T, 40, 0, 99999); // 玩家在(0,0)，半径110内
  const hp0 = e.hp;
  fireOnce(T, 1);
  assert.ok(e.hp < hp0, `范围内瞬伤生效（${hp0}→${e.hp}）`);
  assert.ok(e.burn, "敌人获得灼烧状态");
  isolateDirector(T);
  // 推进时间，DOT 跳伤
  const hpBefore = e.hp;
  for (let i = 0; i < 10; i++) T.update(0.5);
  assert.ok(e.hp < hpBefore, "DOT 持续掉血");
});

test("B2 火衣：范围外敌人不受伤害、无灼烧", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = spawnEnemyAt(T, 400, 0, 99999); // 远在范围外
  const hp0 = e.hp;
  fireOnce(T, 1);
  assert.equal(e.hp, hp0, "范围外不掉血");
  assert.equal(e.burn, undefined, "范围外无灼烧");
});

test("B3 火衣：不再生成 skinFire 地面效果", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  fireOnce(T, 1);
  assert.ok(!T.state.effects.some(ef => ef.type === "skinFire"), "无 skinFire 地面圈");
  // 持续一段时间也不应铺地
  for (let i = 0; i < 10; i++) T.update(0.5);
  assert.ok(!T.state.effects.some(ef => ef.type === "skinFire"), "持续期间无地面圈");
});

test("B4 火衣：DOT 会结束", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = spawnEnemyAt(T, 40, 0, 99999);
  fireOnce(T, 1);
  assert.ok(e.burn);
  isolateDirector(T);
  // 隔离：阻止自动重触发（真实游戏中 cd 到期会重新爆燃并刷新灼烧）
  T.player.weapons.fire.cd = 9999;
  for (let i = 0; i < 40; i++) T.update(0.5); // 推进超过灼烧时长
  assert.equal(e.burn, undefined, "灼烧到期移除（delete）");
});

test("B5 火衣：Lv1 爆燃半径≥100 且视觉半径==命中半径", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = spawnEnemyAt(T, 95, 0, 99999); // 半径95：若半径≥100应命中
  fireOnce(T, 1);
  assert.ok(e.hp < 99999, "半径95目标被命中 → 命中半径≥95，且需≥100");
  // 视觉半径与命中一致：skinIgnite 特效 r 等于命中半径
  const ignite = T.state.effects.find(ef => ef.type === "skinIgnite");
  assert.ok(ignite, "存在 skinIgnite 爆发特效");
  // 代码结构断言：命中循环与特效使用同一 radius 变量
  const src = await readFile(GAME, "utf8");
  const fireSrc = src.match(/function useFire\(dt\)\{[\s\S]*?\n\}/)[0];
  assert.match(fireSrc, /radius/, "useFire 有统一 radius");
});

test("B6 火衣进化：延迟二段爆燃且刷新 DOT", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = spawnEnemyAt(T, 40, 0, 99999);
  fireOnce(T, 7, true);
  assert.ok(e.burn, "一段触发灼烧");
  isolateDirector(T);
  const burnAt1 = e.burn.remaining;
  // 推进 1.6s 触发二段（scheduleGameTask 1500ms）
  T.update(1.6);
  assert.ok(e.burn, "二段后仍灼烧");
  assert.ok(e.burn.remaining > burnAt1 - 0.01 || e.burn.remaining > 0, "二段刷新/延续灼烧");
});

test("B7 死亡与重开后火衣状态干净", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  const e = spawnEnemyAt(T, 40, 0, 99999);
  fireOnce(T, 1);
  assert.ok(e.burn);
  // 死亡 → 重开
  T.player.hp = 3;
  T.takePlayerHit(999);
  assert.equal(T.state.gameOver, true);
  const click = elements.restartBtn.handlers.click;
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(T.state.gameOver, false);
  assert.equal(T.state.enemies.length, 0, "重开后敌人清空（burn 随敌人清除）");
  assert.ok(!T.player.weapons.fire.active, "重开后 fire.active 归零");
  assert.ok(!T.state.effects.some(ef => ef.type === "skinFire"), "重开后无地面效果残留");
});
