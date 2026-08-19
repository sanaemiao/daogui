// Daogui TDD：苍蜣登阶（大千录 Lv7 派生主动技）与置闰五行联动
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
    `requestAnimationFrame(loop);window.__T__={state,player,triggerCangQiang,autoTriggerUltimate,update,startNewRun,randomNormalOptions,chooseOption,cdMul,atkMul,keys};})();`,
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
  T.state.phaseIndex = 0;
}
function mkEnemy(over = {}) {
  return { id: "wumian", x: 100, y: 0, r: 17, hp: 500, maxHp: 500, dmg: 0, speed: 0, dead: false, boss: false, elite: false, exp: 0, hitCd: 0, slow: 0, ...over };
}

test("苍蜣登阶：大千录 Lv7 后才进升级卡池", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.level = 10;
  T.player.weapons.suisui.lv = 1;
  T.player.weapons.ultimate.lv = 3;
  T.player.cangqiang.lv = 0;
  T.player.weapons.blood.lv = 6;
  const opts6 = T.randomNormalOptions();
  assert.ok(!opts6.some(o => o.type === "cangqiang"), "blood Lv6 时不应出现苍蜣登阶");
  T.player.weapons.blood.lv = 7;
  const opts7 = T.randomNormalOptions();
  assert.ok(opts7.some(o => o.type === "cangqiang"), "blood Lv7 后应出现苍蜣登阶");
});

test("苍蜣登阶：全图命中普通/精英/Boss，Boss 用系数", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  T.player.hp = T.player.maxHp;
  const normal = mkEnemy({ x: 100 });
  const elite = mkEnemy({ id: "eliteDanyangzi", x: -100, r: 32, hp: 9000, maxHp: 9000, elite: true });
  const boss = mkEnemy({ id: "bossLayue", x: 0, y: 150, r: 34, hp: 13000, maxHp: 13000, boss: true });
  T.state.enemies.push(normal, elite, boss);
  const hpN = normal.hp, hpE = elite.hp, hpB = boss.hp;
  T.triggerCangQiang();
  assert.ok(normal.hp < hpN, "普通敌人受伤");
  assert.ok(elite.hp < hpE, "精英受伤");
  assert.ok(boss.hp < hpB, "Boss 受伤");
  const dmgN = hpN - normal.hp, dmgB = hpB - boss.hp;
  assert.ok(dmgB < dmgN, `Boss 系数应低于普通（boss ${dmgB.toFixed(1)} < 普通 ${dmgN.toFixed(1)}）`);
});

test("苍蜣登阶：血量不足不可施放（禁止锁1血白嫖）", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  T.player.hp = T.player.maxHp * 0.2; // 低于 30% 代价
  const e = mkEnemy();
  T.state.enemies.push(e);
  const hp0 = e.hp, php0 = T.player.hp;
  T.triggerCangQiang();
  assert.equal(e.hp, hp0, "血量不足时不对敌人造成伤害");
  assert.equal(T.player.hp, php0, "血量不足时不扣血");
  assert.equal(T.player.cangqiang.cd, 0, "血量不足时不进入冷却");
});

test("置闰五行：强化期间冷却缩减（Lv3 置闰 -40% → cdMul 0.6 倍）", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  T.player.weapons.ultimate.lv = 3; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  const before = T.cdMul();
  T.autoTriggerUltimate();
  assert.ok(T.player.ultimateBoost > 0, "进入强化");
  const during = T.cdMul();
  assert.ok(during < before, `强化期间 cdMul(${during})应小于平时(${before})`);
  assert.ok(Math.abs(during / before - 0.6) < 0.001, `Lv3 缩减应为 0.6 倍（实际 ${(during / before).toFixed(3)}）`);
});

test("两招联动：置闰五行强化期间苍蜣登阶伤害提升 1.75 倍", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  T.player.weapons.ultimate.lv = 3; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  T.player.hp = T.player.maxHp;
  const big = { hp: 5000, maxHp: 5000 };
  const a = mkEnemy({ hp: 5000, maxHp: 5000 });
  T.state.enemies.push(a);
  T.triggerCangQiang();
  const dmgNoBoost = 5000 - a.hp;
  T.state.enemies.length = 0;
  T.player.cangqiang.cd = 0;
  T.autoTriggerUltimate();
  const b = mkEnemy({ hp: 5000, maxHp: 5000 });
  T.state.enemies.push(b);
  T.triggerCangQiang();
  const dmgBoost = 5000 - b.hp;
  assert.ok(dmgBoost > dmgNoBoost, `强化期间伤害(${dmgBoost.toFixed(1)})应大于平时(${dmgNoBoost.toFixed(1)})`);
  assert.ok(Math.abs(dmgBoost / dmgNoBoost - 1.75) < 0.01, `应提升 1.75 倍（实际 ${(dmgBoost / dmgNoBoost).toFixed(3)}）`);
});

test("苍蜣登阶：3级数值成长（Lv3 伤害 > Lv1）", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /dmg=CANGQIANG_DMG\[lv\]\*atkMul\(\)/, "苍蜣登阶伤害走 CANGQIANG_DMG 表");
  assert.match(html, /c\.cd=CANGQIANG_CD\[lv\]/, "苍蜣登阶冷却走 CANGQIANG_CD 分级表 90/75/60s（不吃置闰缩减）");
  const { T } = await loadGame();
  T.startNewRun(); isolate(T);
  T.player.hp = T.player.maxHp;
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  const a = mkEnemy({ hp: 5000, maxHp: 5000 }); T.state.enemies.push(a); T.triggerCangQiang();
  const dmg1 = 5000 - a.hp;
  T.state.enemies.length = 0;
  T.player.cangqiang.lv = 3; T.player.cangqiang.cd = 0;
  const b = mkEnemy({ hp: 5000, maxHp: 5000 }); T.state.enemies.push(b); T.triggerCangQiang();
  const dmg3 = 5000 - b.hp;
  assert.ok(dmg3 > dmg1, `Lv3 伤害(${dmg3.toFixed(1)})应大于 Lv1(${dmg1.toFixed(1)})`);
});

test("置闰五行：无主动按钮——获得后自动进入强化（Lv1 立即 8s）", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  isolate(T);
  const html = await readFile(GAME, "utf8");
  assert.doesNotMatch(html, /id="ultBtn"/, "HTML 无置闰主动按钮");
  T.player.weapons.ultimate.lv = 0;
  T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.chooseOption({ type: "weapon", key: "ultimate", title: "获得：置闰五行" });
  assert.equal(T.player.weapons.ultimate.lv, 1, "获得后 lv=1");
  T.update(0.016); // 首帧自动触发
  assert.equal(T.player.ultimateBoost, 8, "获得后立即自动进入 8s 强化");
  assert.ok(T.player.ultimateTimer > 0, "同步进入祭期冷却");
});

test("置闰五行：自动循环——强化结束→冷却→到期自动再次触发（Lv3 10s + 冷却-40% + 献祭）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.weapons.ultimate.lv = 3; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  const cdBefore = T.cdMul();
  const hp0 = T.player.hp;
  T.update(0.016); // 自动触发
  assert.equal(T.player.ultimateBoost, 10, "Lv3 自动触发 10s 强化（规格 8/9/10）");
  assert.ok(T.player.hp < hp0, "自动触发献祭扣血");
  assert.ok(T.cdMul() < cdBefore, "强化期间冷却缩减生效");
  for (let i = 0; i < 60; i++) T.update(0.2); // 推过 10s 强化
  assert.equal(T.player.ultimateBoost, 0, "强化结束");
  assert.ok(T.player.ultimateTimer > 0, "进入祭期冷却");
  T.player.ultimateTimer = 0; // 冷却到期
  T.update(0.016);
  assert.equal(T.player.ultimateBoost, 10, "冷却到期自动再次触发");
});

test("置闰五行：升级池上限 Lv3，不再出现 Lv4；异常 lv>3 钳制无 NaN/超大特效", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  isolate(T);
  const html = await readFile(GAME, "utf8");
  assert.match(html, /ULT_MAX_LV=3/, "存在置闰最高等级常量 3");
  // 确定性场景：其余武器/被动全满、苍蜣满级，仅置闰可升级，池子唯一
  T.player.level = 10;
  for (const k of Object.keys(T.player.weapons)) T.player.weapons[k].lv = k === "ultimate" ? 3 : 7;
  for (const k of Object.keys(T.player.passives)) T.player.passives[k].lv = 5;
  T.player.cangqiang.lv = 3;
  // 升级池：Lv3 时不再出现置闰升级选项（无 Lv4）
  const opts3 = T.randomNormalOptions();
  assert.ok(!opts3.some(o => o.type === "weapon" && o.key === "ultimate"), "Lv3 后升级池不再出现置闰 Lv4");
  // Lv2 时仍可出现 Lv3
  T.player.weapons.ultimate.lv = 2;
  const opts2 = T.randomNormalOptions();
  assert.ok(opts2.some(o => o.type === "weapon" && o.key === "ultimate" && o.title.includes("Lv3")), "Lv2 时仍可出现置闰 Lv3");
  // 异常 lv=4（旧档/作弊）：干净状态下自动触发按 Lv3 钳制，无 NaN、无超大特效
  T.startNewRun(); isolate(T);
  T.player.weapons.ultimate.lv = 4; T.player.ultimateTimer = 0; T.player.ultimateBoost = 0;
  T.update(0.016);
  assert.equal(T.player.ultimateBoost, 10, "lv=4 钳制为 Lv3 持续 10s");
  assert.ok(Number.isFinite(T.atkMul()) && Number.isFinite(T.cdMul()), "atkMul/cdMul 无 NaN");
  const rings = T.state.effects.filter(ef => ef.type === "ring");
  assert.ok(rings.length >= 1 && rings.every(r => Number.isFinite(r.r) && r.r <= 200), "特效半径有限且不超大");
  assert.ok(!/NaN/.test(elements.ui.innerHTML), "HUD 无 NaN");
  assert.match(html, /r:44,life:\.5/, "自动触发环形特效半径固定 44（不随等级放大）");
});

test("苍蜣登阶：升级（获得 Lv2/Lv3）立即重置 cd=0，可立刻按新等级再施放", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.player.cangqiang.lv = 1; T.player.cangqiang.cd = 0;
  T.player.hp = T.player.maxHp;
  T.state.enemies.length = 0; T.state.enemies.push(mkEnemy());
  T.triggerCangQiang();
  assert.equal(T.player.cangqiang.cd, 90, "Lv1 使用后进入 90s 冷却");
  T.chooseOption({ type: "cangqiang", title: "苍蜣登阶 Lv2" });
  assert.equal(T.player.cangqiang.lv, 2, "升级到 Lv2");
  assert.equal(T.player.cangqiang.cd, 0, "升级后冷却重置为 0");
  T.player.hp = T.player.maxHp;
  T.state.enemies.length = 0; T.state.enemies.push(mkEnemy());
  T.triggerCangQiang();
  assert.equal(T.player.cangqiang.cd, 75, "Lv2 使用后进入 75s 冷却");
  T.chooseOption({ type: "cangqiang", title: "苍蜣登阶 Lv3" });
  assert.equal(T.player.cangqiang.cd, 0, "升级 Lv3 后再重置为 0");
  T.player.hp = T.player.maxHp;
  T.state.enemies.length = 0; T.state.enemies.push(mkEnemy());
  T.triggerCangQiang();
  assert.equal(T.player.cangqiang.cd, 60, "Lv3 使用后进入 60s 冷却");
});

test("苍蜣登阶按钮：Lv7 未学隐藏，Lv1 后显示", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  // 场景1：大千录 Lv7 但未学苍蜣登阶（cangqiang.lv=0）→ 按钮隐藏
  T.player.weapons.blood.lv = 7;
  T.player.cangqiang.lv = 0;
  assert.equal(elements.dengjieBtn.style.display, "none", "blood Lv7 未学苍蜣登阶时按钮隐藏");
  // 场景2：选择苍蜣登阶（lv→1）→ 按钮显示
  T.chooseOption({ type: "cangqiang", title: "获得：苍蜣登阶" });
  assert.equal(T.player.cangqiang.lv, 1, "获得后 cangqiang.lv=1");
  assert.equal(elements.dengjieBtn.style.display, "block", "获得后按钮显示");
  // 场景3：重开 → lv 重置，按钮隐藏
  T.startNewRun();
  assert.equal(elements.dengjieBtn.style.display, "none", "重开后按钮隐藏");
});
