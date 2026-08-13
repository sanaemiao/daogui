// Daogui 重构回归：Boss 流程顺序 / 无提前通关 / 分阶段攻击 / 李岁 Lv5 / 火衣节点
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,updateWeaponName,useFire,useBlood,startNewRun,useSuisui,damageEnemy,keys,spawnEnemy,spawnElite,spawnBoss,updateEnemyBehavior};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}

// ============ Boss 流程 ============
test("Boss 顺序：150丹阳子精英/300腊月十八miniboss/390喜神精英/600三花终局", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  const ev = cfgSrc.match(/events:\s*\[([\s\S]*?)\n\s*\],/)[1];
  const parse = ev.matchAll(/\{ at: (\d+), type: "(elite|boss)", kind: "([a-z]+)", label: "([^"]+)" \}/g);
  const nodes = [...parse].map(m => ({ at: +m[1], type: m[2], kind: m[3], label: m[4] }));
  const flow = nodes.filter(n => n.type === "elite" || n.type === "boss");
  assert.deepEqual(flow.map(n => `${n.at}:${n.kind}`), ["150:danyangzi", "300:layue", "390:xishen", "600:sanhua"], "四节点顺序/身份正确（390=喜神）");
  assert.equal(new Set(flow.map(n => n.kind)).size, 4);
  // debugJumps 不变
  assert.match(cfgSrc, /debugJumps:\s*\[145, 295, 385, 590\]/);
  // 不允许残留旧引用：无 boss 型丹阳子；390s 喜神为当前正式 kind
  assert.doesNotMatch(cfgSrc, /type: "boss"[^\n]*kind: "danyangzi"/, "无旧 boss 型丹阳子");
});

test("无提前通关：击杀丹阳子精英/腊月十八/人魈道人均不触发 endGame，仅三花触发", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.needExp = 1e9; // 隔离升级，防止箱子/散炁触发 levelUp 暂停
  T.state.lastSpawn = Infinity; T.state.nextFlowEvent = 999;
  const mk = (id) => ({ id, x: 50, y: 0, r: 16, hp: 1, maxHp: 1, dmg: 1, speed: 0, dead: false, boss: false, elite: false, exp: 1 });
  const cases = [
    { id: "eliteDanyangzi", expectEnd: false },
    { id: "bossLayue", expectEnd: false },
    { id: "eliteRenxiao", expectEnd: false },
    { id: "bossSanhua", expectEnd: true },
  ];
  for (const c of cases) {
    const e = mk(c.id);
    e.boss = c.id.startsWith("boss");
    e.elite = c.id.startsWith("elite");
    T.state.enemies.push(e);
    T.damageEnemy(e, 99999);
    if (!c.expectEnd) T.state.tasks.length = 0; // 非终局清除延迟任务
    T.state.gems.length = 0; // 防止拾取触发升级
    if (c.expectEnd) {
      // 三花死亡 → 1.8s 后 endGame(true)
      T.update(2.0);
      assert.equal(T.state.gameOver, true, `${c.id} 应触发通关`);
      T.startNewRun(); // 复位
    } else {
      assert.equal(T.state.gameOver, false, `${c.id} 不应触发通关`);
      // 推进 > 2s 确认无延迟 endGame
      T.update(2.5);
      assert.equal(T.state.gameOver, false, `${c.id} 延迟后仍无通关`);
    }
    T.state.enemies.length = 0;
  }
});

// ============ 分阶段攻击 ============
test("丹阳子精英：无半血变身，铃铛散射可触发", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.spawnElite("danyangzi");
  const e = T.state.enemies[0];
  // 压到半血以下
  e.hp = e.maxHp * 0.3;
  T.state.enemyBullets.length = 0;
  e.bellCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.ok(T.state.enemyBullets.length >= 1, "铃铛散射发射");
  assert.equal(e.phase, undefined, "无 phase 字段（无变身状态机）");
  // 半血不触发三花变身文案
  assert.doesNotMatch(e.id + "", /bossSanhua/);
});

test("腊月十八 miniboss：专属 updateLayueBoss，弃用喜神技能路径", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.spawnBoss("layue");
  const e = T.state.enemies[0];
  assert.equal(e.boss, true, "腊月十八为 boss 级（全局血条）");
  e.hp = e.maxHp * 0.4;
  T.state.enemyBullets.length = 0;
  T.state.effects.length = 0;
  e.shadowCd = 0; e.laneCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.equal(e.phase2, true, "半血切二阶段");
  // 必须产生新怨影特效，绝不产生旧喜神特效
  assert.ok(T.state.effects.some(ef => ef.type === "layueGhost"), "产生 layueGhost 怨影");
  assert.ok(!T.state.effects.some(ef => ef.type === "xishenShadow" || ef.type === "xishenLane"), "无旧喜神特效");
  // 冷箭怨弹
  assert.ok(T.state.enemyBullets.some(b => b.text === "怨"), "冷箭发射");
  // 二阶段推进：唯一冷色投射物
  T.state.enemyBullets.length = 0;
  e.fakeCoinCd = 0.01;
  T.updateEnemyBehavior(e, 0.016);
  assert.ok(T.state.enemyBullets.some(b => b.color === "#b8d8f0"), "二阶段冷色投射物");
});

test("人魈道人：配置保留但流程不使用（390s 已由喜神接管）", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  // 配置保留（防御）
  assert.match(cfgSrc, /eliteRenxiao:/, "人魈配置保留");
  // 但 events 无 renxiao 引用
  assert.doesNotMatch(cfgSrc, /kind: "renxiao"/, "流程不使用 renxiao");
  const html = await readFile(GAME, "utf8");
  assert.doesNotMatch(html, /kind==='renxiao'/, "spawnElite 无 renxiao 分支调用（人魈退出流程）");
});

// ============ 李岁 Lv5 ============
test("黑太岁→李岁：Lv5 触发，Lv4 仍黑太岁，无玄牝", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.weapons.suisui.lv = 4;
  T.updateWeaponName("suisui");
  assert.equal(T.player.weapons.suisui.name, "黑太岁");
  assert.equal(T.player.weapons.suisui.form, "black");
  T.player.weapons.suisui.lv = 5;
  T.updateWeaponName("suisui");
  assert.equal(T.player.weapons.suisui.name, "李岁");
  assert.equal(T.player.weapons.suisui.form, "lisui");
  assert.equal(T.player.weapons.suisui.evolved, true);
  // 无玄牝名/配置
  assert.notEqual(T.player.weapons.suisui.name, "玄牝");
  const cfgSrc = await readFile(CFG, "utf8");
  assert.doesNotMatch(cfgSrc, /finalName: "玄牝"/, "config 无玄牝 finalName");
  assert.match(cfgSrc, /suisui: \{ choiceAt: 5/, "config choiceAt=5");
});

// ============ 火衣 ============
function spawnEnemyAt(T, x, y) {
  const e = { x, y, r: 8, hp: 99999, maxHp: 99999, dmg: 1, dead: false, boss: false, elite: false, exp: 0, hitCd: 0, slow: 0, animOffset: 0, driftPhase: 0 };
  T.state.enemies.push(e);
  return e;
}
test("火衣：Lv1 大爆燃半径≥110 + 双层可见环 + DOT，无地面圈", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const e = spawnEnemyAt(T, 90, 0);
  const w = T.player.weapons.fire;
  w.lv = 1; w.evolved = false; w.cd = 0;
  T.useFire(0.016);
  assert.ok(e.hp < 99999, "范围内瞬伤");
  assert.ok(e.burn, "命中获得灼烧DOT");
  const ignites = T.state.effects.filter(ef => ef.type === "skinIgnite");
  assert.ok(ignites.length >= 1, "存在爆燃环");
  assert.ok(ignites[0].r >= 110, `Lv1 爆燃半径≥110（实际 ${ignites[0].r}）`);
  const rings = T.state.effects.filter(ef => ef.type === "ring");
  assert.ok(rings.length >= 2, "双层可见环");
  assert.ok(!T.state.effects.some(ef => ef.type === "skinFire"), "无地面圈");
  // DOT 随时间跳伤
  T.state.lastSpawn = Infinity; T.state.nextFlowEvent = 999;
  for (const en of T.state.enemies) { en.dmg = 0; en.speed = 0; }
  const hp0 = e.hp;
  for (let i = 0; i < 6; i++) T.update(0.5);
  assert.ok(e.hp < hp0, "DOT 跳伤生效");
});

test("火衣：level-tree 节点文案含范围/DOT时长/跳伤/二段", async () => {
  const src = await readFile(GAME, "utf8");
  const desc = src.match(/fire:\[[^\]]*\]/)[0];
  assert.match(desc, /大爆燃AOE/, "Lv1 大爆燃");
  assert.match(desc, /爆燃范围提升/, "范围节点");
  assert.match(desc, /灼烧更久\/跳伤更频/, "DOT 时长/跳伤节点");
  assert.match(desc, /火袄蜒行（延迟二段爆燃刷新DOT）/);
});

// ============ 领导追加反馈 ============
test("白边清除：技能特效绘制无纯白描边", async () => {
  const src = await readFile(GAME, "utf8");
  // 特效绘制区（drawEffect）不应有纯白描边
  const drawEffect = src.match(/function drawEffect\(ef\)\{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(drawEffect, /rgba\(255,255,255/, "drawEffect 无纯白 rgba");
  assert.doesNotMatch(drawEffect, /rgba\(2[3-9][0-9],2[3-9][0-9],2[3-9][0-9]/, "无近白描边（≥230 三通道）");
  // 旧浅色描边（腊月十八/喜神浅金、皮肤爆燃浅褐、bewilderedBurn 浅色）已去除
  assert.doesNotMatch(drawEffect, /rgba\(2[0-9][0-9],2[0-9][0-9],17[0-9]|rgba\(24[0-9],2[0-9][0-9],2[0-9][0-9]/, "无旧浅金/浅褐描边");
  // liSuiGrab 外圈已去浅色
  assert.doesNotMatch(drawEffect, /rgba\(218,207,188/, "liSuiGrab 无浅色外圈");
  // 黑太岁/李岁触手外层保持深暗
  assert.match(drawEffect, /rgba\(60,50,45,/, "触手外层深暗");
});

test("游老爷：金色辉光/金色拖尾/命中闪光（非 muted 铃铛）", async () => {
  const src = await readFile(GAME, "utf8");
  const drawY = src.match(/function drawYouLaoYe\(y\)\{[\s\S]*?\n\}/)[0];
  assert.match(drawY, /rgba\(255,214,120/, "金色主体拖尾");
  assert.match(drawY, /rgba\(255,200,90,\.9/, "金色辉光");
  assert.match(drawY, /rgba\(255,225,150/, "金色核心光点");
  // 命中：金色铃铛 + 火花
  assert.match(src, /rgba\(255,200,80,\.95\)[\s\S]*?killSpark/, "命中金色闪光+火花");
  // 无旧 muted 铃铛
  assert.doesNotMatch(src, /rgba\(190,145,65,\.5\)/, "无 muted 命中铃铛");
});

test("大千录运行时：Lv1-Lv7 伤害提升 + 数量不变 + 命中火花", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const ATK = 1.32;
  const fireOnce = lv => {
    T.player.weapons.blood.lv = lv;
    T.player.weapons.blood.cd = 0;
    T.state.bullets.length = 0;
    T.state.enemies.length = 0;
    T.state.enemies.push({ x: 120, y: 0, r: 8, hp: 99999, maxHp: 99999, dead: false, boss: false, elite: false, exp: 0 });
    T.useBlood(0.016);
    const b = T.state.bullets.map(x => ({ type: x.type, dmg: x.dmg }));
    T.state.bullets.length = 0;
    return b;
  };
  const countBy = (b, t) => b.filter(x => x.type === t).length;
  let b = fireOnce(1);
  assert.equal(countBy(b, "daqianNail"), 2, "Lv1 甲钉×2");
  assert.ok(Math.abs(b[0].dmg - 58 * ATK) < 0.01, `Lv1 甲钉伤害 ${b[0].dmg}（提升后≥58*ATK）`);
  b = fireOnce(3);
  assert.equal(countBy(b, "daqianTooth"), 4, "Lv3 血牙×4");
  assert.ok(Math.abs(b[0].dmg - 54 * ATK) < 0.01, `Lv3 血牙伤害 ${b[0].dmg}`);
  b = fireOnce(6);
  assert.equal(countBy(b, "daqianFinger"), 6, "Lv6 指骨×6");
  assert.ok(Math.abs(b[0].dmg - 56 * ATK) < 0.01, `Lv6 指骨伤害 ${b[0].dmg}`);
  b = fireOnce(7);
  assert.equal(countBy(b, "daqianNail"), 3, "Lv7 甲钉×3");
  assert.equal(countBy(b, "daqianTooth"), 4, "Lv7 血牙×4");
  assert.equal(countBy(b, "daqianFinger"), 7, "Lv7 指骨×7");
  // 命中火花：代码含 daqian 命中 killSpark
  const src = await readFile(GAME, "utf8");
  assert.match(src, /b\.type==='daqianNail'[^\n]*killSpark/, "daqian 命中火花存在");
});

test("李岁 Lv5 协战：缠取范围/数量/伤害/收束增强（运行时）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.player.weapons.suisui.lv = 5;
  T.updateWeaponName("suisui");
  // 布置 9 个敌人于缠取范围
  for (let i = 0; i < 9; i++) T.state.enemies.push({ x: 60 + i * 30, y: 0, r: 8, hp: 99999, maxHp: 99999, dmg: 0, dead: false, boss: false, elite: false, exp: 0 });
  const w = T.player.weapons.suisui;
  w.cd = 0;
  T.useSuisui(0.016);
  // 缠取后 enemies 中至少多数被命中（伤害减少）
  const hurtCount = T.state.enemies.filter(e => e.hp < 99999).length;
  assert.ok(hurtCount >= 6, `李岁缠取命中 ≥6（实际 ${hurtCount}）`);
  // 收束任务已调度
  assert.ok(T.state.tasks.length >= 1, "收束延迟任务已调度");
});

// ============ 三花丹阳子两阶段 ============
test("三花丹阳子：初始 phase=1，HP≤50% 切 phase=2，阶段攻击数值不同", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.spawnBoss("sanhua");
  const e = T.state.enemies[0];
  assert.equal(e.phase, 1, "三花初始 phase=1");
  const r0 = e.r, dmg0 = e.dmg;
  // 阶段1：压到 60% 血，触发铃铛=定向扇形（3枚）
  e.hp = e.maxHp * 0.6;
  T.state.enemyBullets.length = 0;
  e.bellCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.equal(e.phase, 1, "60% 血仍阶段1");
  assert.ok(T.state.enemyBullets.length === 3, "阶段1定向铜铃3枚");
  // 压到 40% → 切阶段2 + 震屏 + 三花聚顶环
  e.hp = e.maxHp * 0.4;
  T.state.effects.length = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.equal(e.phase, 2, "40% 血切阶段2");
  assert.ok(T.state.hitstop > 0, "阶段切换震屏/顿帧");
  assert.ok(e.r > r0, `阶段2体型变大（${r0}→${e.r}）`);
  assert.ok(e.dmg > dmg0, `阶段2伤害提升（${dmg0}→${e.dmg}）`);
  assert.ok(T.state.effects.some(ef => ef.type === "ring" && ef.text === "三花聚顶"), "三花聚顶切换环");
  // 阶段2：环形铜铃8枚
  T.state.enemyBullets.length = 0;
  e.bellCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.ok(T.state.enemyBullets.length === 8, "阶段2环形铜铃8枚");
  // 阶段2专属扇击
  T.state.effects.length = 0;
  e.wingCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.ok(T.state.effects.some(ef => ef.type === "eliteSweep"), "阶段2扇击触发");
});

test("旧路径确认：eliteXishen/bossDanyangzi 不被新流程调用", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  // 流程中喜神为 390s 精英（kind:xishen），无旧 kind:renxiao 引用；丹阳子仅作 elite
  assert.match(cfgSrc, /kind: "xishen"[^\n]*390|at: 390[^\n]*kind: "xishen"/, "390s=喜神 xishen");
  assert.doesNotMatch(cfgSrc, /kind: "renxiao"/, "events 无旧人魈道人 renxiao");
  assert.doesNotMatch(cfgSrc, /type: "boss"[^\n]*kind: "danyangzi"/, "无旧 boss 型丹阳子");
  const html = await readFile(GAME, "utf8");
  // 分派不调旧 bossDanyangzi 行为/击杀
  assert.doesNotMatch(html, /bossDanyangzi'\).*updateDanyangziBoss/, "分派不调 bossDanyangzi");
  assert.doesNotMatch(html, /e\.id==='bossDanyangzi'/, "无旧 bossDanyangzi 击杀/变身分支");
  // 旧 eliteXishen 半血路径（updateXishenElite）仅防御保留，无事件生成
  assert.match(cfgSrc, /kind: "sanhua"[^\n]*600|kind: "layue"/, "新流程仅 layue/sanhua/renxiao/danyangzi-elite");
});

test("封面说明：含当前流程时间线，无旧时间线/旧占位", async () => {
  const html = await readFile(GAME, "utf8");
  const cover = html.match(/第一关 0—10 分钟构筑版[^<]*/)[0];
  // 当前流程
  assert.match(cover, /2:30 丹阳子精英/, "封面 2:30 丹阳子精英");
  assert.match(cover, /5:00 腊月十八小Boss/, "封面 5:00 腊月十八小Boss");
  assert.match(cover, /6:30 喜神精英/, "封面 6:30 喜神精英");
  assert.match(cover, /10:00 三花丹阳子/, "封面 10:00 三花丹阳子");
  // 无旧时间线/旧占位
  assert.doesNotMatch(cover, /人魈道人（黑太岁图占位）/, "无黑太岁图占位表述");
  assert.doesNotMatch(cover, /2:30 人魈道人/, "无旧 2:30 人魈道人");
  assert.doesNotMatch(cover, /6:30 人魈道人/, "无旧 6:30 人魈道人");
  assert.doesNotMatch(cover, /5:00 丹阳子/, "无旧 5:00 丹阳子");
});

// ============ 390s 喜神精英（散签/牵线/引偶）============
test("390s 喜神：events kind=xishen，F4 385 可触发", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  assert.match(cfgSrc, /at: 390, type: "elite", kind: "xishen"/, "390s 事件=喜神 xishen");
  assert.match(cfgSrc, /debugJumps:\s*\[145, 295, 385, 590\]/, "debugJumps 含 385");
  const html = await readFile(GAME, "utf8");
  assert.match(html, /kind==='xishen'/, "spawnElite 有 xishen 分支");
});

test("喜神：散签3枚(22伤)/牵线预警(28伤)/引偶2纸偶(15伤)，无旧shadow/lane", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  T.spawnElite("xishen");
  const e = T.state.enemies[0];
  assert.equal(e.text, "喜神", "喜神名字");
  // 散签：3 枚青绿签弹（预警0.6s后发射）
  T.state.enemyBullets.length = 0;
  e.signCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  T.state.lastSpawn = Infinity; T.state.nextFlowEvent = 999;
  T.update(0.7); // 推进让 600ms 延迟任务触发
  const signs = T.state.enemyBullets.filter(b => b.text === "签");
  assert.equal(signs.length, 3, "散签3枚");
  assert.ok(signs.every(b => Math.abs(b.dmg - 22) < 0.01), "散签伤害22");
  // 牵线：青绿预警线
  T.state.effects.length = 0;
  e.threadCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.ok(T.state.effects.some(ef => ef.type === "xishenLane"), "牵线预警线");
  // 引偶：召唤纸偶
  const before = T.state.enemies.length;
  e.puppetCd = 0;
  T.updateEnemyBehavior(e, 0.016);
  assert.ok(T.state.enemies.length >= before + 1, "引偶召纸偶");
  // 无旧 shadow 特效
  assert.ok(!T.state.effects.some(ef => ef.type === "xishenShadow"), "无旧 xishenShadow");
});

// ============ 纸偶自爆契约 ============
function isolateDirector(T) { T.player.needExp = 1e9; T.state.lastSpawn = Infinity; T.state.nextFlowEvent = 999; T.player.invuln = 0; T.state.time = 600; T.state.phaseIndex = 6; }

test("纸偶：真实召唤两纸偶，各自 fuse 自爆 15 伤，移除后无重复，爆燃出现", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolateDirector(T);
  T.spawnElite("xishen");
  const xishen = T.state.enemies[0];
  xishen.puppetCd = 0;
  T.updateEnemyBehavior(xishen, 0.016);
  const puppets = T.state.enemies.filter(en => en.id === "xishenPuppet");
  assert.equal(puppets.length, 2, "引偶召出两个纸偶");
  T.state.enemies.length = 0;
  puppets.forEach((p, i) => { p.fuse = 0.5 + i * 2.0; T.state.enemies.push(p); }); // 错开 fuse 避免无敌帧吞第二次爆炸
  const hp0 = T.player.hp;
  let burstCount = 0;
  for (let i = 0; i < 20; i++) {
    T.update(0.2);
    burstCount += T.state.effects.filter(ef => ef.type === "ring" && String(ef.color).includes("90,138,122")).length;
  }
  assert.ok(T.player.hp <= hp0 - 30 + 0.01, `两纸偶共 30 伤（${hp0}->${T.player.hp}）`);
  assert.ok(!T.state.enemies.some(en => en.id === "xishenPuppet"), "两纸偶均移除");
  assert.ok(burstCount >= 2, "至少两次纸偶爆燃");
  const hp1 = T.player.hp;
  for (let i = 0; i < 8; i++) T.update(0.5);
  assert.ok(T.player.hp >= hp1 - 1, "无重复自爆伤害");
});

test("纸偶：隔离个体 fuse 自爆一次（爆燃/15伤/移除/无重复）", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolateDirector(T);
  const puppet = { id: "xishenPuppet", text: "纸偶", x: 30, y: 0, r: 12, hp: 260, maxHp: 260, dmg: 12, speed: 70, exp: 6, size: 12, boss: false, elite: false, hitCd: 0, slow: 0, animOffset: 0, driftPhase: 0, explode: true };
  T.state.enemies.push(puppet);
  const hp0 = T.player.hp; let sawBurst = false;
  for (let i = 0; i < 40; i++) { T.update(0.2); if (T.state.effects.some(ef => ef.type === "ring" && String(ef.color).includes("90,138,122"))) sawBurst = true; if (T.player.hp <= hp0 - 15 + 0.01) break; }
  assert.ok(T.player.hp <= hp0 - 15 + 0.01, `玩家受 15 伤（${hp0}->${T.player.hp}）`);
  assert.ok(!T.state.enemies.includes(puppet), "自爆纸偶已移除");
  assert.ok(sawBurst, "纸偶爆燃 ring 出现");
  const hp1 = T.player.hp;
  for (let i = 0; i < 10; i++) T.update(0.5);
  assert.ok(T.player.hp >= hp1 - 1, "无重复自爆伤害");
});

test("纸偶：被击杀后不能爆炸（无 15 伤/无爆燃/已移除）", async () => {
  const { T } = await loadGame();
  T.startNewRun(); isolateDirector(T);
  const puppet = { id: "xishenPuppet", text: "纸偶", x: 30, y: 0, r: 12, hp: 260, maxHp: 260, dmg: 12, speed: 70, exp: 6, size: 12, boss: false, elite: false, hitCd: 0, slow: 0, animOffset: 0, driftPhase: 0, explode: true };
  T.state.enemies.push(puppet);
  T.damageEnemy(puppet, 9999);
  assert.ok(!T.state.enemies.includes(puppet), "被击杀纸偶已移除");
  const hp0 = T.player.hp;
  for (let i = 0; i < 20; i++) T.update(0.5);
  assert.equal(T.player.hp, hp0, "击杀纸偶不给玩家造成爆炸伤害");
  assert.ok(!T.state.enemies.some(en => en.id === "xishenPuppet"), "无残余纸偶");
});
