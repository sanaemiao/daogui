// Daogui：封面两开局按钮、死亡/通关结算、再来一局/回到标题、局内重开按钮流程
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
    `requestAnimationFrame(loop);window.__T__={state,player,startNewRun,endGame,returnToTitle,updateUI,update,chooseOption,keys};})();`,
  );
  const { sandbox, elements } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__, elements };
}

test("封面：两个直接开局按钮，无旧 checkbox/说明/Boss图/按键提示", async () => {
  const html = await readFile(GAME, "utf8");
  const sp = html.match(/<div id="startPanel">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.match(sp, /coverTitle/, "封面标题（游戏名）保留");
  assert.match(sp, /id="startBtn"/, "开始游戏按钮");
  assert.match(sp, /id="invincibleBtn"/, "无敌模式按钮");
  assert.doesNotMatch(sp, /invincibleChk/, "无旧 checkbox");
  assert.doesNotMatch(html, /invincibleChk/, "全局无旧 checkbox 语义");
  assert.doesNotMatch(sp, /class="hint"/, "无说明段落");
  assert.doesNotMatch(sp, /bossRefs/, "无 Boss 参考图");
  assert.doesNotMatch(html, /id="controlsHint"/, "无按键提示");
});

test("封面两按钮：开始游戏=普通模式，无敌模式=直接无敌局", async () => {
  const { T, elements } = await loadGame();
  assert.equal(typeof elements.startBtn.handlers.click, "function", "startBtn 绑定点击");
  assert.equal(typeof elements.invincibleBtn.handlers.click, "function", "invincibleBtn 绑定点击");
  elements.invincibleBtn.handlers.click();
  assert.equal(T.state.mode, "invincible", "无敌模式设置 mode");
  assert.equal(T.player.invincible, true, "无敌模式开局");
  elements.startBtn.handlers.click();
  assert.equal(T.state.mode, "normal", "开始游戏设置 mode");
  assert.equal(T.player.invincible, false, "普通模式开局");
});

test("死亡结算：标题『死亡』+存活时间/击杀/等级/武器/被动清单", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.player.weapons.suisui.lv = 2; T.updateUI(); // 更新武器名→黑太岁
  T.player.passives.hp.lv = 1;
  T.state.time = 125; T.state.kill = 7; T.player.level = 4;
  T.endGame(false, "被游老爷命中");
  assert.equal(elements.endPanel.style.display, "flex", "结算页显示");
  assert.equal(elements.endTitle.textContent, "死亡", "死亡标题");
  assert.match(elements.endText.innerHTML, /本局存活时间 2分5秒/, "存活时间");
  assert.match(elements.endText.innerHTML, /击杀 7/, "击杀数");
  assert.match(elements.endText.innerHTML, /Lv 4/, "等级");
  assert.match(elements.endText.innerHTML, /黑太岁 Lv2/, "武器清单");
  assert.match(elements.endText.innerHTML, /护身符 Lv1/, "被动清单");
});

test("通关结算：标题『通关』", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.endGame(true, "十分钟试玩完成");
  assert.equal(elements.endTitle.textContent, "通关", "通关标题");
});

test("再来一局：沿用刚结束局的模式，重置时间/状态", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun("invincible");
  T.state.time = 30; T.player.weapons.suisui.lv = 3;
  T.endGame(false, "测试死亡");
  const click = elements.restartBtn.handlers.click;
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(T.state.started, true, "新局已开始");
  assert.equal(T.state.mode, "invincible", "沿用无敌模式");
  assert.equal(T.player.invincible, true, "玩家仍无敌");
  assert.equal(T.state.time, 0, "时间重置");
  assert.equal(T.player.weapons.suisui.lv, 0, "升级状态重置");
  assert.equal(elements.endPanel.style.display, "none", "结算页关闭");
});

test("回到标题：回封面且不自动开局", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun();
  T.endGame(false, "测试死亡");
  const click = elements.toTitleBtn.handlers.click;
  assert.equal(typeof click, "function", "toTitleBtn 绑定点击");
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(elements.startPanel.style.display, "flex", "回到标题封面");
  assert.equal(elements.endPanel.style.display, "none", "结算页关闭");
  assert.equal(T.state.started, false, "不自动开局");
  assert.equal(T.state.gameOver, false, "gameOver 复位");
});

test("局内重开按钮：点击立即新局，沿用本局模式，重置状态", async () => {
  const { T, elements } = await loadGame();
  T.startNewRun("invincible");
  T.state.time = 30; T.player.weapons.suisui.lv = 3; T.state.kill = 5;
  assert.equal(elements.restartNowBtn.style.display, "block", "局内重开按钮显示");
  assert.equal(typeof elements.restartNowBtn.onclick, "function", "重开绑定 onclick");
  elements.restartNowBtn.onclick();
  assert.equal(T.state.started, true, "新局已开始");
  assert.equal(T.state.mode, "invincible", "沿用本局模式");
  assert.equal(T.player.invincible, true, "玩家仍无敌");
  assert.equal(T.state.time, 0, "时间重置");
  assert.equal(T.state.kill, 0, "击杀重置");
  assert.equal(T.player.weapons.suisui.lv, 0, "升级状态重置");
  assert.equal(elements.startPanel.style.display, "none", "不回到封面");
});
