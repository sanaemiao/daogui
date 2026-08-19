// Daogui P0：非有限伤害/敌 HP 污染防御——普通怪与 Boss 异常输入不污染 HP，正常致死走 kill/endgame
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
  for (const id of ["game","ui","skills","message","debugHud","startPanel","levelPanel","levelOptions","endPanel","endTitle","endText","restartBtn","toTitleBtn","startBtn","invincibleBtn","restartNowBtn","pauseBtn","dengjieBtn","joystick","stick"]) elements[id] = makeElement(id);
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
    `requestAnimationFrame(loop);window.__T__={state,player,damageEnemy,killEnemy,triggerCangQiang,autoTriggerUltimate,startNewRun,endGame,keys};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}
function mkEnemy(over = {}) {
  return { id: "wumian", x: 100, y: 0, r: 17, hp: 500, maxHp: 500, dmg: 0, speed: 0, dead: false, boss: false, elite: false, exp: 0, hitCd: 0, slow: 0, flashTimer: 0, ...over };
}

test("P0：damageEnemy 入口防御非有限伤害（NaN/Infinity/负值/0 均不污染 HP 不致死）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = mkEnemy();
  T.state.enemies.push(e);
  const hp0 = e.hp;
  for (const dmg of [NaN, Infinity, -50, 0, "x"]) {
    T.damageEnemy(e, dmg);
    assert.equal(e.hp, hp0, `伤害 ${dmg} 不改变 HP`);
    assert.equal(e.dead, false, `伤害 ${dmg} 不致死`);
  }
  assert.ok(!Number.isNaN(e.hp), "HP 保持有限");
});

test("P0：敌 HP 已被污染（NaN）时修复为有限且可正常致死", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = mkEnemy(); e.hp = NaN; e.maxHp = NaN;
  T.state.enemies.push(e);
  T.damageEnemy(e, 10);
  assert.ok(Number.isFinite(e.hp), "HP 被修复为有限");
  assert.equal(e.hp, 90, "修复为兜底 maxHp 后正常扣 10");
  T.damageEnemy(e, 99999);
  assert.equal(e.dead, true, "修复后可正常致死");
});

test("P0：普通怪正常致死走 kill 路径（计数+移除）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = mkEnemy();
  T.state.enemies.push(e);
  const k0 = T.state.kill;
  T.damageEnemy(e, 99999);
  assert.equal(e.dead, true, "致死");
  assert.equal(T.state.kill, k0 + 1, "kill 计数 +1");
  assert.ok(!T.state.enemies.includes(e), "从敌人列表移除");
});

test("P0：Boss（三花）正常致死走 milestone 路径，不因污染卡死", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const boss = mkEnemy({ id: "bossSanhua", boss: true, r: 34, hp: 13000, maxHp: 13000 });
  T.state.enemies.push(boss);
  T.damageEnemy(boss, NaN); // 先打非有限伤害不污染
  assert.equal(boss.hp, 13000, "NaN 不污染 Boss HP");
  T.damageEnemy(boss, 99999);
  assert.equal(boss.dead, true, "Boss 致死");
  assert.equal(T.state.milestoneComplete, true, "三花击杀标记 milestone");
  assert.ok(T.state.tasks.length >= 1, "通关任务已排入（endgame 路径保留）");
});

test("P0：置闰 Lv4 异常联动苍蜣——伤害表钳制后不再产生 NaN 伤害", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.weapons.ultimate.lv = 4; // 异常档（根因已封顶，防御仍生效）
  T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.autoTriggerUltimate(); // 钳制为 Lv3 boost
  T.player.cangqiang.lv = 3; T.player.cangqiang.cd = 0;
  T.player.hp = T.player.maxHp;
  const a = mkEnemy({ hp: 5000, maxHp: 5000 }); T.state.enemies.push(a);
  T.triggerCangQiang();
  assert.ok(Number.isFinite(a.hp) && a.hp < 5000, "苍蜣对异常档敌人造成有限伤害");
  T.player.cangqiang.cd = 0; T.player.hp = T.player.maxHp;
  const b = mkEnemy({ id: "bossSanhua", boss: true, r: 34, hp: 13000, maxHp: 13000 });
  T.state.enemies.push(b);
  const hpB = b.hp;
  T.triggerCangQiang();
  assert.ok(Number.isFinite(b.hp) && b.hp < hpB, "Boss 受有限伤害，无 NaN");
});
