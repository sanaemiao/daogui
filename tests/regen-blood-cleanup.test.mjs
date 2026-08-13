// Daogui TDD：火袄箴经（再生）增强 + 大千录分支死数据清理
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
    `requestAnimationFrame(loop);window.__T__={state,player,update,startNewRun,applyPassive,updateWeaponName,keys};})();`,
  );
  const { sandbox } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__ };
}
function isolate(T) {
  T.player.needExp = 1e9;
  T.state.lastSpawn = Infinity;
  T.state.nextFlowEvent = 999;
}

// ============ 大千录分支死数据清理 ============
test("大千录分支死数据已清理（无 branchAt/branches/血祭分支名）", async () => {
  const cfgSrc = await readFile(CFG, "utf8");
  assert.doesNotMatch(cfgSrc, /branchAt/, "config 无 branchAt");
  assert.doesNotMatch(cfgSrc, /branches:\s*\{/, "config 无 branches 块");
  assert.doesNotMatch(cfgSrc, /牙祭|甲祭|指祭|齿雨贯阵|十甲血轮|裂指成林/, "config 无血祭分支名/进化名");
});

test("大千录清理后仍为线性 Lv1-7（不回归）", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const names = [];
  for (let lv = 1; lv <= 7; lv++) {
    T.player.weapons.blood.lv = lv;
    T.updateWeaponName("blood");
    names.push(T.player.weapons.blood.name);
  }
  assert.deepEqual(names, ["大千录·甲钉", "大千录·甲钉", "大千录·血牙", "大千录·血牙", "大千录·血牙", "大千录·指骨", "大千录·三祭"], "线性命名不回归");
});

// ============ 火袄箴经（再生）增强 ============
test("火袄箴经 Lv1-5 regenPercent 为增强后的值", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  const expected = [0, 0.0015, 0.003, 0.0045, 0.006, 0.0075];
  for (let lv = 1; lv <= 5; lv++) {
    T.player.passives.regen.lv = lv - 1;
    T.applyPassive("regen");
    assert.equal(T.player.passives.regen.lv, lv, `Lv${lv} 标记置位`);
    assert.equal(T.player.regenPercent, expected[lv], `Lv${lv} regenPercent=${expected[lv]}（增强后）`);
  }
});

test("火袄箴经 Lv1 实际回血速率 0.15%/s", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  T.applyPassive("regen"); // Lv1 → regenPercent=0.0015
  T.player.hp = 1;
  const maxHp = T.player.maxHp;
  for (let f = 0; f < 60; f++) T.update(1 / 60); // 1 秒
  const gained = T.player.hp - 1;
  assert.ok(Math.abs(gained - maxHp * 0.0015) < 0.01, `Lv1 1 秒应回血 ≈ ${(maxHp * 0.0015).toFixed(3)}，实际 ${gained.toFixed(3)}`);
});

test("火袄箴经 Lv5 实际回血速率 0.75%/s", async () => {
  const { T } = await loadGame();
  T.startNewRun();
  isolate(T);
  for (let i = 0; i < 5; i++) T.applyPassive("regen"); // 连升到 Lv5
  assert.equal(T.player.passives.regen.lv, 5);
  T.player.hp = 1;
  const maxHp = T.player.maxHp;
  for (let f = 0; f < 60; f++) T.update(1 / 60); // 1 秒
  const gained = T.player.hp - 1;
  assert.ok(Math.abs(gained - maxHp * 0.0075) < 0.01, `Lv5 1 秒应回血 ≈ ${(maxHp * 0.0075).toFixed(3)}，实际 ${gained.toFixed(3)}`);
});
