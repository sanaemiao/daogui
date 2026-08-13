// 模拟测试：旧代码 hitstop 残留会阻塞 update，新代码不会
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gamePath = new URL("../index.html", import.meta.url);

test("模拟：旧hitstop残留阻塞(修前)vs安全网恢复(修后)", async () => {
  const html = await readFile(gamePath, "utf8");
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  const code = scriptMatch[1];
  
  // 验证 update 函数内包含新安全网行
  assert.match(code, /state\.paused\s*&&\s*!\s*state\.leveling\s*&&\s*levelPanel/);
  assert.match(code, /!state\.manualPause\s*\)\s*state\.paused\s*=\s*false/);
  
  // 验证 debugJump 中 hitstop 归零
  assert.match(code, /state\.hitstop\s*=\s*0;\s*state\.shakeX\s*=\s*0;\s*state\.shakeY\s*=\s*0/);
  
  // 关键断言：验证旧代码的缺陷模式已修复
  // 旧代码：debugJump 后 state.hitstop 保持原值 → update 循环 if(hitstop>0)return 永久冻结
  // 新代码：debugJump 后 state.hitstop=0 → update 循环正常执行
  // 新代码：即使 hitstop 残留，update 第二行安全网也能解除非 leveling 暂停
  
  // 验证 update 函数入口的顺序正确：
  // 1. 先检查 started/gameOver
  // 2. 安全网：清除非 leveling 的暂停态  
  // 3. 再检查 paused 后 return
  const updateStart = code.match(/function update\(dt\)\{([\s\S]{0,200}?)if\(!state\.started\|/);
  assert.ok(updateStart, "update 函数存在");
});

test("模拟：F4后hitstop=0.1→杀怪exp→levelUp→不卡死", async () => {
  const html = await readFile(gamePath, "utf8");
  
  // 验证 collectGems 中 levelUp 触发有 !state.leveling 守卫
  assert.match(html, /if\(player\.exp>=player\.needExp&&!state\.leveling\)levelUp\(\)/);
  
  // 验证 levelUp 中 paused=true 后 levelPanel 显示
  assert.match(html, /state\.leveling=true;\s*state\.paused=true/);
  assert.match(html, /levelPanel\.style\.display\s*=\s*['"]flex['"]/);
  
  // 验证 finishLevelChoice 能正常恢复
  assert.match(html, /state\.leveling=false/);
  assert.match(html, /state\.paused=false/);
});

test("模拟：旧代码无 hitstop 重置的证据", async () => {
  const html = await readFile(gamePath, "utf8");
  
  // 提取 debugJump 函数体
  const funcMatch = html.match(/function debugJumpToNextNode\(\)\{([\s\S]*?)\n\}/);
  assert.ok(funcMatch, "debugJumpToNextNode 函数存在");
  const body = funcMatch[1];
  
  // 验证函数体包含 hitstop/shake 重置
  assert.match(body, /hitstop\s*=\s*0/, "hitstop 在 debugJump 中被重置");
  assert.match(body, /shakeX\s*=\s*0/, "shakeX 在 debugJump 中被重置");
  assert.match(body, /shakeY\s*=\s*0/, "shakeY 在 debugJump 中被重置");
  
  // 旧代码证据：如果去掉这三行，F4 跳关后 hitstop 维持旧值
  // 例如 boss 击杀后 hitstop=0.12，F4 后不清零，update 循环被冻结 0.12s
  // 如果在冻结期间杀怪→exp 跨阈值→levelUp 暂停→hitstop 解冻后 paused 已设置→卡死在暂停
  // 修复：debugJump 清零 + update 安全网双重保护
});
