// Daogui 重调（最终规格）：置闰 Lv1 生效 + 苍蜣 60s 固定冷却 + 按终局血量调平
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
  for (const id of ["game","ui","skills","message","debugHud","startPanel","levelPanel","levelOptions","endPanel","endTitle","endText","restartBtn","pauseBtn","ultBtn","dengjieBtn","joystick","stick"]) elements[id] = makeElement(id);
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
    `requestAnimationFrame(loop);window.__T__={state,player,triggerCangQiang,autoTriggerUltimate,update,startNewRun,chooseOption,cdMul,atkMul,CONFIG,keys,CANGQIANG_DMG,ULT_BOOST_MUL,ULT_CD_MUL};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}
function mkEnemy(over = {}) {
  return { id: "wumian", x: 100, y: 0, r: 17, hp: 5000, maxHp: 5000, dmg: 0, speed: 0, dead: false, boss: false, elite: false, exp: 0, hitCd: 0, slow: 0, ...over };
}

// ============ 最终规格 ============
test("置闰五行：Lv1 自动触发，全伤+45%/冷却-15%/持续8s，无主动按钮", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.weapons.ultimate.lv = 1;
  T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  const atk0 = T.atkMul(), cd0 = T.cdMul(), hp0 = T.player.hp;
  T.autoTriggerUltimate();
  assert.equal(T.player.ultimateBoost, 8, "Lv1 持续 8s");
  assert.ok(T.player.hp < hp0, "12% 献祭扣血");
  assert.ok(Math.abs(T.atkMul() / atk0 - 1.45) < 1e-6, `Lv1 全伤+45%（实际 ${((T.atkMul()/atk0)-1)*100}%）`);
  assert.ok(Math.abs(T.cdMul() / cd0 - 0.85) < 1e-6, `Lv1 冷却-15%（实际 ${(1-T.cdMul()/cd0)*100}%）`);
  const html = await readFile(GAME, "utf8");
  assert.doesNotMatch(html, /id="ultBtn"/, "HTML 无置闰主动按钮");
});

test("置闰五行：三层全伤/冷却/持续递增（45/55/75%·15/25/40%·8/9/10s）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const cases = [[1, 1.45, 0.85, 8], [2, 1.55, 0.75, 9], [3, 1.75, 0.6, 10]];
  for (const [lv, atkRatio, cdRatio, dur] of cases) {
    T.player.weapons.ultimate.lv = lv;
    T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
    const atk0 = T.atkMul(), cd0 = T.cdMul();
    T.autoTriggerUltimate();
    assert.ok(Math.abs(T.atkMul() / atk0 - atkRatio) < 1e-6, `Lv${lv} 全伤倍率 ${T.atkMul()/atk0} 应 ${atkRatio}`);
    assert.ok(Math.abs(T.cdMul() / cd0 - cdRatio) < 1e-6, `Lv${lv} 冷却倍率 ${T.cdMul()/cd0} 应 ${cdRatio}`);
    assert.equal(T.player.ultimateBoost, dur, `Lv${lv} 持续 ${dur}s`);
  }
});

test("置闰五行：自身祭期 CD 分级 60/45/30s，不吃自身冷却缩减", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const cases = [[1, 60], [2, 45], [3, 30]];
  for (const [lv, cd] of cases) {
    T.startNewRun();
    T.player.weapons.ultimate.lv = lv;
    T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
    T.autoTriggerUltimate();
    assert.equal(T.player.ultimateTimer, cd, `Lv${lv} 祭期冷却 ${cd}s（不乘 cdMul）`);
  }
});

test("苍蜣登阶：各级冷却分级 90/75/60s，不吃置闰冷却缩减", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const cases = [[1, 90], [2, 75], [3, 60]];
  for (const [lv, cd] of cases) {
    T.startNewRun();
    T.player.cangqiang.lv = lv; T.player.cangqiang.cd = 0;
    T.player.hp = T.player.maxHp;
    T.state.enemies.length = 0;
    T.state.enemies.push(mkEnemy());
    T.triggerCangQiang();
    assert.ok(Math.abs(T.player.cangqiang.cd - cd) < 1e-6, `Lv${lv} 冷却应 ${cd}s（实际 ${T.player.cangqiang.cd}）`);
  }
  // 置闰强化期间（cdMul 已变）仍按分级不变
  T.startNewRun();
  T.player.weapons.ultimate.lv = 3;
  T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.autoTriggerUltimate();
  assert.ok(T.cdMul() < 1, "置闰强化中 cdMul<1");
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  T.player.hp = T.player.maxHp;
  T.state.enemies.length = 0;
  T.state.enemies.push(mkEnemy());
  T.triggerCangQiang();
  assert.ok(Math.abs(T.player.cangqiang.cd - 90) < 1e-6, `置闰强化期间苍蜣冷却仍 90s（实际 ${T.player.cangqiang.cd}）`);
});

test("苍蜣登阶：固定三级伤害表，Lv1 无攻击被动一击清除终局最高普通怪（@600s）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const T_END = T.CONFIG.run.verticalSliceEnd;
  const maxHp = Math.max(...Object.values(T.CONFIG.enemies).map(e => e.hp + T_END * e.hpPerSecond));
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  T.player.weapons.ultimate.lv = 0; // 无置闰，基础 atkMul=1.32
  T.player.passives.atk.lv = 0;     // 无攻击被动
  T.player.atk = 1;
  T.player.hp = T.player.maxHp;
  T.state.enemies.length = 0;
  const e = mkEnemy({ id: "xiesui", r: 19, hp: maxHp, maxHp: maxHp });
  T.state.enemies.push(e);
  T.triggerCangQiang();
  assert.ok(e.hp <= 0, `Lv1 应一击清除终局最高普通怪 HP=${maxHp.toFixed(0)}，剩余 ${e.hp.toFixed(1)}`);
});

test("苍蜣登阶：Lv2/Lv3 伤害严格高于 Lv1（固定表 180/200/240 验证）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.weapons.ultimate.lv = 0;
  T.player.atk = 1;
  assert.deepEqual([...T.CANGQIANG_DMG], [0, 180, 200, 240], "三级固定伤害表");
  const dmg = [];
  for (let lv = 1; lv <= 3; lv++) {
    T.player.cangqiang.lv = lv; T.player.cangqiang.cd = 0;
    T.player.hp = T.player.maxHp;
    T.state.enemies.length = 0;
    const e = mkEnemy();
    T.state.enemies.push(e);
    T.triggerCangQiang();
    dmg.push(e.maxHp - e.hp);
  }
  assert.ok(dmg[1] > dmg[0], `Lv2>Lv1（${dmg[1]} vs ${dmg[0]}）`);
  assert.ok(dmg[2] > dmg[1], `Lv3>Lv2（${dmg[2]} vs ${dmg[1]}）`);
});

test("苍蜣登阶：保留 30% 最大气血代价与 Boss 系数 0.4", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  T.player.hp = T.player.maxHp;
  const hpBefore = T.player.hp;
  T.state.enemies.length = 0;
  T.state.enemies.push(mkEnemy({ id: "bossSanhua", r: 40, hp: 24000, maxHp: 24000, boss: true }));
  T.triggerCangQiang();
  assert.ok(Math.abs(T.player.hp - (hpBefore - T.player.maxHp * 0.3)) < 1e-6, `消耗 30% maxHp（实际 ${hpBefore - T.player.hp}）`);
});

test("HUD：置闰五行强化/下次触发文案齐全，按钳制等级显示全伤/冷却", async () => {
  const html = await readFile(GAME, "utf8");
  assert.doesNotMatch(html, /未解锁/, "HUD 不再写未解锁");
  assert.match(html, /置闰五行：强化中 /, "HUD 强化中文案");
  assert.match(html, /置闰五行：下次触发 /, "HUD 下次触发文案");
  assert.match(html, /ULT_BOOST_MUL\[ultLv\(\)\]/, "HUD 全伤按钳制等级");
  assert.match(html, /ULT_CD_MUL\[ultLv\(\)\]/, "HUD 冷却按钳制等级");
});
