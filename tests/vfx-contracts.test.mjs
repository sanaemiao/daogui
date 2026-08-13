// Daogui TDD：游老爷波浪长条表现、黑太岁触手生长挥动、三花丹阳子/李穗随从 Canvas 兜底契约
// 聚焦契约：行为数值不得回归（伤害/索敌/数量/冷却/命中公式），绘制层补不依赖图片的兜底。
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
  for (const id of ["game","ui","skills","message","debugHud","startPanel","levelPanel","levelOptions","endPanel","endTitle","endText","restartBtn","pauseBtn","ultBtn","joystick","stick","rewardPanel","rewardOptions"]) elements[id] = makeElement(id);
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
    `requestAnimationFrame(loop);window.__T__={state,player,useYouLaoYe,useSuisui,startNewRun};})();`,
  );
  const { sandbox } = buildSandbox();
  const ctx = vm.createContext(sandbox);
  vm.runInContext(cfg, ctx);
  vm.runInContext(core, ctx);
  vm.runInContext(script, ctx);
  return { T: sandbox.window.__T__ };
}

// ---------- 源码契约（防回归） ----------

test("游老爷行为契约不回归：数量/索敌/伤害/命中冷却", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /count=2\+\(lv>=3\?1:0\)\+\(lv>=6\?1:0\)\+\(w\.evolved\?1:0\)/);
  assert.match(html, /nearest\(620\*senseMul\(\)/);
  assert.match(html, /\(7\+\(lv>=2\?3:0\)\+\(lv>=7\?5:0\)\)\*atkMul\(\)/);
  assert.match(html, /hitCd=\.28/);
});

test("黑太岁触手行为契约不回归：次数/伤害/长度/宽度/命中公式/特效字段", async () => {
  const html = await readFile(GAME, "utf8");
  assert.match(html, /lashes=1\+\(w\.lv>=3\?1:0\)\+\(w\.lv>=4\?1:0\)\+\(w\.lv>=6\?1:0\)/);
  assert.match(html, /\(34\+\(w\.lv>=2\?12:0\)\+\(w\.lv>=4\?10:0\)\+\(w\.lv>=5\?18:0\)\+\(w\.lv>=6\?12:0\)\)\*atkMul\(\)/);
  assert.match(html, /forward>0&&forward<length&&side<width\+e\.r/);
  assert.match(html, /type:'tentacle',x:player\.x,y:player\.y,angle,r:length,width,life:[^,]+\.42:[^,]+,maxLife:/);
});

test("游老爷绘制契约：细长波浪长条 + 保留金色系配色", async () => {
  const html = await readFile(GAME, "utf8");
  // 金色辉光与丝带（恢复原配色：金色，非青金/铜绿建议）
  assert.match(html, /rgba\(255,214,120/);
  // 细长波浪：逐段正弦弯曲（i/segs 归一 + 相位波）+ 长条延伸
  assert.match(html, /for\(let i=0;i<=segs;i\+\+\)/);
  assert.match(html, /Math\.sin\(i\*\.62/);
  assert.match(html, /yOff=|Math\.sin\(i\*\.62/);
  // 长条半长参数（细长，非短拖尾）
  assert.match(html, /len=52/);
});

test("触手绘制契约：生长 + 挥动（不能突兀满长出现）", async () => {
  const html = await readFile(GAME, "utf8");
  // 生长进度（伸→挥→淡出）：prog 与 reach 与 sweep 同在 tentacle 分支
  const tentacle = html.slice(html.indexOf("ef.type==='tentacle'"), html.indexOf("ef.type==='daqian'"));
  assert.ok(tentacle.includes("prog="), "tentacle 分支应有生长进度变量 prog");
  assert.ok(tentacle.includes("reach"), "tentacle 分支应有伸长量 reach");
  assert.ok(tentacle.includes("sweep"), "tentacle 分支应有挥扫量 sweep");
  assert.ok(!tentacle.includes("ef.r,0)"), "触手末端不再直接以满长 ef.r 绘制（须经 reach 生长）");
});

test("三花丹阳子 Canvas 兜底：图片缺失时仍有可读形象（保留图片优先）", async () => {
  const html = await readFile(GAME, "utf8");
  const branch = html.slice(html.lastIndexOf("e.id==='bossSanhua'"), html.lastIndexOf("e.id==='eliteXishen'") + 40);
  assert.ok(branch.includes("img.complete&&img.naturalWidth"), "保留图片优先路径");
  assert.ok(branch.includes("#a03028"), "无图时红衣道士 Canvas 兜底");
  assert.match(branch, /三花聚顶/);
});

test("李穗随从 Canvas 兜底：图片缺失时白毛萝莉/黑豚仍可见（保留图片优先）", async () => {
  const html = await readFile(GAME, "utf8");
  const fn = html.slice(html.indexOf("function drawLiSuiCompanion"), html.indexOf("function drawEnemySprite"));
  assert.ok(fn.includes("image.complete"), "保留图片优先路径");
  assert.ok(fn.includes("#e8e4da"), "无图时白发李穗 Canvas 兜底");
  assert.ok(fn.includes("xuanpin"), "黑豚形态兜底分支存在");
});

// ---------- 行为运行断言（vm 沙箱） ----------

test("游老爷生成数量公式随等级生效（vm）", async () => {
  const { T } = await loadGame();
  const w = T.player.weapons.you;
  for (const [lv, evolved, expected] of [[1,false,2],[3,false,3],[6,false,4],[6,true,5]]) {
    w.lv = lv; w.evolved = evolved; w.cd = 0;
    T.state.youLaoYe.length = 0;
    T.useYouLaoYe(0.016);
    assert.equal(T.state.youLaoYe.length, expected, `lv=${lv} evolved=${evolved} 应生成 ${expected} 缕`);
    // 生成环绕玩家约 28px
    for (const y of T.state.youLaoYe) {
      const d = Math.hypot(y.x - T.player.x, y.y - T.player.y);
      assert.ok(d > 20 && d < 36, `生成半径应约 28px，实际 ${d.toFixed(1)}`);
    }
  }
});

test("游老爷召唤冷却契约不回归（vm）", async () => {
  const { T } = await loadGame();
  const w = T.player.weapons.you;
  w.lv = 1; w.evolved = false; w.cd = 0;
  T.state.youLaoYe.length = 0;
  T.useYouLaoYe(0.016); // 触发生成并重置 cd
  const cdAfter = w.cd;
  assert.ok(cdAfter > 4.5 && cdAfter <= 5.2, `Lv1 冷却应约 5.2，实际 ${cdAfter}`);
  T.useYouLaoYe(0.016); // 冷却未到，不应重复生成
  assert.equal(T.state.youLaoYe.length, 2);
});
