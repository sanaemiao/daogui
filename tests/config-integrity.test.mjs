// Daogui v10.6 P0：配置完整性 + 普通升级 100 次确定性循环
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
  // 与浏览器一致：innerHTML 赋值即清空 children（防假绿：旧卡片必须被清除）
  let _html = "";
  Object.defineProperty(el, "innerHTML", {
    get() { return _html; },
    set(v) { _html = String(v); el.children.length = 0; },
  });
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,levelUp,collectGems,finishLevelChoice,chooseOption,getLevelOptions,randomNormalOptions,updateWeaponName,startNewRun,createInitialPlayerState,useBlood,weapons:player.weapons,keys};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}

test("配置完整性：activeWeaponKeys 与运行时 weapons 键完全一致", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  const m = cfgSrc.match(/activeWeaponKeys:\s*\[([^\]]*)\]/);
  assert.ok(m, "config 存在 activeWeaponKeys");
  const keys = [...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]);
  assert.ok(keys.length >= 6, `至少6个武器键（实际${keys.length}）`);
  const { T } = await loadGame();
  for (const k of keys) {
    assert.ok(T.player.weapons[k], `运行时应有武器键 ${k}`);
    assert.equal(typeof T.player.weapons[k].lv, "number", `${k}.lv 应为数字`);
  }
  assert.deepEqual(Object.keys(T.player.weapons).sort(), [...keys].sort(), "weapons 键与 config 完全一致（无缺/无多）");
});

test("配置完整性：weaponTrees 键 ⊆ activeWeaponKeys", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  const k = cfgSrc.match(/activeWeaponKeys:\s*\[([^\]]*)\]/)[1];
  const keys = [...k.matchAll(/"([a-z_]+)"/g)].map(x => x[1]);
  const treeBlock = cfgSrc.match(/weaponTrees:\s*\{([\s\S]*?)\n\s*\}/)[1];
  const treeKeys = [...treeBlock.matchAll(/^\s{6}([a-z_]+):/gm)].map(x => x[1]);
  for (const tk of treeKeys) assert.ok(keys.includes(tk), `weaponTrees 键 ${tk} 应在 activeWeaponKeys 中`);
});

test("不变量：删除某武器键时 createInitialPlayerState 抛可诊断错误", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  const tampered = cfgSrc.replace(
    /activeWeaponKeys:\s*\["coin", "you", "suisui", "fire", "blood", "general", "ultimate"\]/,
    `activeWeaponKeys: ["coin","you","suisui","fire","blood","general","ultimate","ghost"]`,
  );
  const [html, core] = await Promise.all([readFile(GAME, "utf8"), readFile(CORE, "utf8")]);
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace(/requestAnimationFrame\(loop\);\s*\}\)\(\);\s*$/, `requestAnimationFrame(loop);window.__T__={state,player};})();`);
  const { sandbox } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(tampered, ctx);
  vm.runInContext(core, ctx);
  let threw = null;
  try { vm.runInContext(script, ctx); } catch (e) { threw = e.message; }
  assert.ok(threw && threw.includes("DAOGUI-INVARIANT"), `篡改配置后应抛不变量错误（实际: ${threw}）`);
});

test("普通升级 100 次确定性循环：每轮新卡片且选卡后恢复", async () => {
  const { T, elements } = await loadGame();
  let recovered = 0;
  const seenNodes = new Set();
  for (let i = 0; i < 100; i++) {
    T.startNewRun();
    T.player.level = 1 + (i % 12);
    T.player.exp = T.player.needExp - 1;
    T.state.gems.push({ x: T.player.x, y: T.player.y, value: 3, r: 5 });
    T.collectGems(0.016);
    assert.equal(T.state.leveling, true, `第${i}次升级面板应弹出`);
    const opts = elements.levelOptions.children;
    assert.ok(opts.length >= 1, `第${i}次面板至少一个选项（实际${opts.length}）`);
    assert.equal(typeof opts[0].onclick, "function", `第${i}次选项可点击`);
    // 假绿防线：本轮首选项必须是本轮新建节点（innerHTML='' 已清空上一轮残留）
    assert.ok(!seenNodes.has(opts[0]), `第${i}次首选项为本轮新节点`);
    seenNodes.add(opts[0]);
    opts[0].onclick();
    assert.equal(T.state.paused, false, `第${i}次选卡后解除暂停`);
    const x0 = T.player.x;
    T.keys.add("d"); T.update(0.1); T.keys.delete("d");
    if (T.player.x > x0) recovered++;
  }
  assert.equal(recovered, 100, `100 次全部恢复移动（实际 ${recovered}）`);
});

function fireBloodOnce(T, lv) {
  T.player.weapons.blood.lv = lv;
  T.player.weapons.blood.cd = 0; // 冷却跨轮重置，否则连续调用被 cd 阻塞
  T.state.bullets.length = 0;
  T.state.enemies.length = 0;
  T.state.enemies.push({ x: 120, y: 0, r: 8, hp: 9999, maxHp: 9999, dead: false, boss: false, elite: false, exp: 0 });
  T.useBlood(0.016);
  const bullets = T.state.bullets.map(b => ({ type: b.type, dmg: b.dmg, speed: Math.hypot(b.vx, b.vy), pierce: b.pierce, knockback: b.knockback }));
  T.state.bullets.length = 0;
  return bullets;
}
const countByType = (b, t) => b.filter(x => x.type === t).length;

test("大千录 Lv1-Lv7 运行时断言：实际 bullet 类型/数量/伤害/速度/穿透/击退", async () => {
  const { T } = await loadGame();
  const ATK = 1.32; // atkMul() 默认 = player.atk(1)*1.32
  // Lv1 甲钉×2
  let b = fireBloodOnce(T, 1);
  assert.equal(countByType(b, "daqianNail"), 2, "Lv1 甲钉×2");
  assert.ok(Math.abs(b[0].dmg - 58 * ATK) < 0.01, `Lv1 甲钉伤害 ${b[0].dmg}`);
  assert.ok(Math.abs(b[0].speed - 310) < 0.01, `Lv1 甲钉速度 ${b[0].speed}`);
  assert.equal(b[0].pierce, 2, "Lv1 甲钉穿透 2");
  // Lv2 甲钉×3
  b = fireBloodOnce(T, 2);
  assert.equal(countByType(b, "daqianNail"), 3, "Lv2 甲钉×3");
  assert.ok(Math.abs(b[0].dmg - 66 * ATK) < 0.01, `Lv2 甲钉伤害 ${b[0].dmg}`);
  assert.ok(Math.abs(b[0].speed - 320) < 0.01, `Lv2 甲钉速度 ${b[0].speed}`);
  // Lv3 血牙×4
  b = fireBloodOnce(T, 3);
  assert.equal(countByType(b, "daqianTooth"), 4, "Lv3 血牙×4");
  assert.ok(Math.abs(b[0].dmg - 54 * ATK) < 0.01, `Lv3 血牙伤害 ${b[0].dmg}`);
  assert.ok(Math.abs(b[0].speed - 420) < 0.01, `Lv3 血牙速度 ${b[0].speed}`);
  assert.equal(b[0].pierce, 2, "Lv3 血牙穿透 2");
  // Lv4 血牙×5
  b = fireBloodOnce(T, 4);
  assert.equal(countByType(b, "daqianTooth"), 5, "Lv4 血牙×5");
  assert.ok(Math.abs(b[0].dmg - 66 * ATK) < 0.01, `Lv4 血牙伤害 ${b[0].dmg}`);
  assert.equal(b[0].pierce, 3, "Lv4 血牙穿透 3");
  // Lv5 血牙×5（速度射程提升）
  b = fireBloodOnce(T, 5);
  assert.equal(countByType(b, "daqianTooth"), 5, "Lv5 血牙×5");
  assert.ok(Math.abs(b[0].speed - 460) < 0.01, `Lv5 血牙速度 460（实际 ${b[0].speed}）`);
  assert.equal(b[0].pierce, 3, "Lv5 血牙穿透 3");
  // Lv6 指骨×6（击退）
  b = fireBloodOnce(T, 6);
  assert.equal(countByType(b, "daqianFinger"), 6, "Lv6 指骨×6");
  assert.ok(Math.abs(b[0].dmg - 56 * ATK) < 0.01, `Lv6 指骨伤害 ${b[0].dmg}`);
  assert.equal(b[0].knockback, 26, "Lv6 指骨击退 26");
  // Lv7 三祭合流 3+4+7
  b = fireBloodOnce(T, 7);
  assert.equal(countByType(b, "daqianNail"), 3, "Lv7 三祭甲钉×3");
  assert.equal(countByType(b, "daqianTooth"), 4, "Lv7 三祭血牙×4");
  assert.equal(countByType(b, "daqianFinger"), 7, "Lv7 三祭指骨×7");
  const nail = b.find(x => x.type === "daqianNail");
  const tooth = b.find(x => x.type === "daqianTooth");
  const finger = b.find(x => x.type === "daqianFinger");
  assert.equal(nail.pierce, 2, "Lv7 甲钉穿透 2");
  assert.equal(tooth.pierce, 3, "Lv7 血牙穿透 3");
  assert.equal(finger.knockback, 30, "Lv7 指骨击退 30");
});

test("大千录源码结构辅助断言（非主断言）", async () => {
  const src = await readFile(GAME, "utf8");
  const useBlood = src.match(/function useBlood\(dt\)\{[\s\S]*?\n\}/)[0];
  assert.match(useBlood, /lv===2\)\s*\{/, "Lv2 显式分支存在");
  assert.match(useBlood, /lv===4\)\s*\{/, "Lv4 显式分支存在");
  assert.doesNotMatch(useBlood, /if\(lv<3\)/, "不再有 lv<3 吞并 Lv2");
  assert.doesNotMatch(useBlood, /if\(lv<6\)/, "不再有 lv<6 吞并 Lv4");
});
