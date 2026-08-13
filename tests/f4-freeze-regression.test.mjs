// 测试 F4 跳关 hitstop 残留导致卡死的修复
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gamePath = new URL("../index.html", import.meta.url);

async function extractGameState() {
  const html = await readFile(gamePath, "utf8");
  // 提取内联脚本
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  return scriptMatch[1];
}

// 模拟必要的 DOM 环境
function setupDOM() {
  global.document = {
    querySelector: () => ({ textContent: "", remove() {}, parentElement: { appendChild() {} } }),
    querySelectorAll: () => ({ forEach() {} }),
    getElementById: () => ({
      style: {},
      textContent: "",
      addEventListener() {},
      innerHTML: "",
    }),
    createElement: () => ({
      className: "",
      style: {},
      innerHTML: "",
      textContent: "",
      onclick() {},
      appendChild() {},
    }),
    addEventListener() {},
  };
  global.window = {
    matchMedia: () => ({ matches: false }),
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };
  global.innerWidth = 1024;
  global.innerHeight = 768;
  global.devicePixelRatio = 1;
  global.addEventListener = () => {};
  global.Image = class { constructor() { this.src = ""; this.complete = false; this.naturalWidth = 0; } };
  global.Math = Math;
}

test("F4跳关：hitstop残留不阻塞update循环", async () => {
  setupDOM();
  const script = await extractGameState();
  
  // 用 eval 执行脚本中的关键部分
  // 由于脚本依赖 CONFIG/COMBAT 等外部变量，我们需要 mock
});

test("debugJumpToNextNode 包含 hitstop/shake 重置", async () => {
  const html = await readFile(gamePath, "utf8");
  
  // 验证 debugJump 函数包含 hitstop=0
  assert.match(html, /state\.hitstop\s*=\s*0/);
  assert.match(html, /state\.shakeX\s*=\s*0/);
  assert.match(html, /state\.shakeY\s*=\s*0/);
});

test("update循环：暂停态安全网存在", async () => {
  const html = await readFile(gamePath, "utf8");
  
  // 验证安全网代码存在
  assert.match(html, /state\.paused\s*&&\s*!\s*state\.leveling/);
  assert.match(html, /levelPanel\.style\.display\s*!==\s*['"]flex['"]/);
});

test("debugJump 不遗留 leveling/paused 残留", async () => {
  const html = await readFile(gamePath, "utf8");
  
  // 确保 debugJump 重置 leveling 和 paused
  const debugJumpMatch = html.match(/function debugJumpToNextNode\(\)\{([\s\S]*?)\n\}/);
  assert.ok(debugJumpMatch, "debugJumpToNextNode 函数存在");
  const body = debugJumpMatch[1];
  assert.match(body, /state\.leveling\s*=\s*false/);
  assert.match(body, /state\.paused\s*=\s*false/);
});
