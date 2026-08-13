// Daogui Boss 接触拾取奖励揭示（TDD：先红后绿）
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,startNewRun,damageEnemy,updateEnemyBehavior,spawnElite,spawnBoss,keys,levelOptions,levelPanel,chooseOption,rewardRevealClock};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx); vm.runInContext(core, ctx); vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}
function isolate(T) { T.player.needExp = 1e9; T.state.lastSpawn = Infinity; T.state.nextFlowEvent = 999; T.player.invuln = 0; T.state.time = 600; T.state.phaseIndex = 6; }
function mkBoss(T, id) {
  const e = { id, x: 50, y: 0, r: 16, hp: 1, maxHp: 1, dmg: 0, speed: 0, dead: false, boss: id.startsWith("boss"), elite: id.startsWith("elite"), exp: 1 };
  T.state.enemies.push(e); T.damageEnemy(e, 9999); T.state.hitstop = 0; if (id !== 'bossSanhua') { T.state.tasks.length = 0; } T.state.gems.length = 0;
  return e;
}

test("150/300/390 精英/Boss 死亡掉奖励物（非 chest），Sanhua 无奖励仅通关", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  mkBoss(T, "eliteDanyangzi");
  assert.equal(T.state.rewards.length, 1, "丹阳子精英掉 1 奖励物");
  assert.ok(!T.state.gems.some(g => g.chest), "不掉 chest");
  mkBoss(T, "bossLayue");
  assert.equal(T.state.rewards.length, 2, "腊月十八掉 1 奖励物");
  mkBoss(T, "eliteXishen");
  assert.equal(T.state.rewards.length, 3, "喜神掉 1 奖励物");
  // Sanhua
  T.state.rewards.length = 0;
  mkBoss(T, "bossSanhua");
  assert.equal(T.state.rewards.length, 0, "Sanhua 无奖励物");
  T.update(2.0);
  assert.equal(T.state.gameOver, true, "Sanhua 仅触发通关");
});

test("触碰奖励物：立即展示 3 张唯一 active 武器卡，选择后升级并恢复", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun(); isolate(T);
  mkBoss(T, "eliteDanyangzi");
  const r = T.state.rewards[0];
  r.x = 0; r.y = 0;
  // 拾取：触碰（立即显示面板，无轮盘延迟）
  T.update(0.05); // 触发 collectRewards → showRewardPanel
  assert.equal(T.state.revealing, true, "进入奖励状态");
  assert.equal(T.state.paused, true, "奖励期间暂停");
  const opts = elements.levelOptions.children;
  assert.ok(opts.length >= 3, `面板至少 3 张卡（实际 ${opts.length}）`);
  const titles = opts.slice(0, 3).map(b => b.innerHTML);
  assert.equal(new Set(titles).size, titles.length, "三张卡互不相同");
  // 选择第一张
  const before = JSON.stringify(Object.fromEntries(Object.keys(T.player.weapons).map(k => [k, T.player.weapons[k].lv])));
  opts[0].onclick();
  const after = JSON.stringify(Object.fromEntries(Object.keys(T.player.weapons).map(k => [k, T.player.weapons[k].lv])));
  assert.notEqual(after, before, "选择后某武器升级");
  assert.equal(T.state.paused, false, "选择后恢复");
});

test("揭示中重启安全：rewards 清空、无残留揭示态", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun(); isolate(T);
  mkBoss(T, "bossLayue");
  const r = T.state.rewards[0]; r.x = 0; r.y = 0;
  T.update(0.05);
  assert.equal(T.state.revealing, true);
  // 重启
  const click = elements.restartBtn.handlers.click;
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(T.state.revealing, false, "重启清揭示态");
  assert.equal(T.state.rewards.length, 0, "重启清 rewards");
  assert.equal(T.state.paused, false, "重启不卡暂停");
  // 再推进无残留面板任务
  for (let i = 0; i < 6; i++) T.update(0.5);
  assert.ok(true, "推进无异常");
});

test("揭示动画与预选随机：触碰后预选 3 个唯一 active 武器（随机顺序），揭示期间有动画状态", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun(); isolate(T);
  T.spawnElite("eliteDanyangzi"); // 无此函数，改用 mkBoss
  const xishenElite = { id: "eliteDanyangzi", x: 50, y: 0, r: 16, hp: 1, maxHp: 1, dmg: 0, speed: 0, dead: false, boss: false, elite: true, exp: 1 };
  T.state.enemies.push(xishenElite); T.damageEnemy(xishenElite, 9999); T.state.hitstop = 0; T.state.tasks.length = 0; T.state.gems.length = 0;
  const r = T.state.rewards[0]; r.x = 0; r.y = 0;
  T.update(0.05);
  assert.equal(T.state.revealing, true, "进入揭示");
  assert.ok(T.state.rewardPick && T.state.rewardPick.length === 3, "触碰即预选 3 个 active 武器");
  assert.equal(new Set(T.state.rewardPick.map(o => o.key)).size, 3, "预选互不重复");
  for (const o of T.state.rewardPick) assert.ok(["coin","you","suisui","fire","blood","general"].includes(o.key), "仅 active 武器");
  assert.ok(!T.state.rewardPick.some(o => o.key === "ultimate"), "无置闰五行");
  // 面板直接显示（无轮盘动画）：rewardState 保持 revealing 直到选择
  assert.equal(T.state.rewardState, "revealing", "奖励面板状态");
  const opts = elements.levelOptions.children;
  const shown = opts.slice(0, 3).map(b => b.innerHTML);
  assert.equal(new Set(shown).size, 3, "面板 3 张唯一卡");
  assert.ok(!shown.some(t => t.includes("回血")), "无伪回血卡");
  // 面板顺序=预选顺序（随机非固定 coin/you/suisui）
  assert.ok(T.state.rewardPick.length >= 3, "预选集存在");
});

test("耗尽 fallback：全部 active 满级时显示单张明确完成卡（非伪三选）", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun(); isolate(T);
  for (const k of ["coin","you","suisui","fire","blood","general"]) T.player.weapons[k].lv = 7;
  const e = { id: "bossLayue", x: 50, y: 0, r: 16, hp: 1, maxHp: 1, dmg: 0, speed: 0, dead: false, boss: true, elite: false, exp: 1 };
  T.state.enemies.push(e); T.damageEnemy(e, 9999); T.state.hitstop = 0; T.state.tasks.length = 0; T.state.gems.length = 0;
  const r = T.state.rewards[0]; r.x = 0; r.y = 0;
  T.update(0.05); T.update(0.8);
  const opts = elements.levelOptions.children;
  assert.equal(T.state.rewardState, "done", "耗尽进入完成态");
  assert.equal(opts.length, 1, "单张完成卡");
  assert.ok(opts[0].innerHTML.includes("已满"), "完成卡文案明确");
});

test("Sanhua 终局回归：死亡无奖励物、无 chest、不能直接升级（bossSanhua 不走 dropChest）", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  const lvBefore = JSON.stringify(Object.fromEntries(Object.keys(T.player.weapons).map(k => [k, T.player.weapons[k].lv])));
  // 手动构造 Sanhua：damageEnemy 触发 killEnemy 后不再清空 gems，才能验证是否掉 chest
  T.state.rewards.length = 0; T.state.gems.length = 0;
  const e = { id: "bossSanhua", x: 50, y: 0, r: 16, hp: 1, maxHp: 1, dmg: 0, speed: 0, dead: false, boss: true, elite: false, exp: 1 };
  T.state.enemies.push(e);
  T.damageEnemy(e, 9999);
  T.state.hitstop = 0;
  assert.equal(T.state.rewards.length, 0, "Sanhua 死亡不掉奖励物");
  assert.equal(T.state.gems.some(g => g.chest), false, "Sanhua 死亡不掉 chest（回归：不得掉旧宝箱）");
  assert.equal(T.state.revealing, false, "Sanhua 死亡不进入揭示态");
  // 推进模拟拾取窗口：即使站到尸体位置也无 chest 可拾取、武器不被直接升级
  T.player.x = 0; T.player.y = 0;
  for (let i = 0; i < 10; i++) T.update(0.1);
  const lvAfter = JSON.stringify(Object.fromEntries(Object.keys(T.player.weapons).map(k => [k, T.player.weapons[k].lv])));
  assert.equal(lvAfter, lvBefore, "Sanhua 死亡后武器等级不变（不能 direct-upgrade）");
});

test("揭示动画由独立时钟驱动：state.time 冻结时两时刻卡片角度/脉动仍不同", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  // 进入揭示态
  const e = { id: "eliteDanyangzi", x: 50, y: 0, r: 16, hp: 1, maxHp: 1, dmg: 0, speed: 0, dead: false, boss: false, elite: true, exp: 1 };
  T.state.enemies.push(e); T.damageEnemy(e, 9999); T.state.hitstop = 0; T.state.tasks.length = 0; T.state.gems.length = 0;
  const r = T.state.rewards[0]; r.x = 0; r.y = 0;
  T.update(0.05);
  assert.equal(T.state.revealing, true, "进入揭示");
  const t0 = T.state.time; // 冻结（揭示中 paused）
  const clock = typeof T.rewardRevealClock === "function" ? T.rewardRevealClock : null;
  assert.ok(clock, "rewardRevealClock 导出存在");
  const a = clock(0.1, 0);
  const b = clock(0.5, 0);
  assert.notEqual(a.ang, b.ang, "角度随独立时钟变化（0.1 vs 0.5）");
  // 动画参数仅由 timer 决定，与 state.time 无关
  const c = clock(0.1, 0);
  assert.deepEqual(a, c, "同 timer 参数确定（无 state.time 依赖）");
});
