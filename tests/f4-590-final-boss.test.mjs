// 测试 590→600 F4跳关最终Boss不卡死
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gamePath = new URL("../index.html", import.meta.url);

test("590→600跳点：debugJumps配置包含590", async () => {
  const html = await readFile(gamePath, "utf8");
  assert.match(html, /590/, "debugJumps 包含 590 节点");
});

test("590→600跳点：debugJump重置 hitstop/shake/paused/leveling/manualPause", async () => {
  const html = await readFile(gamePath, "utf8");
  const funcMatch = html.match(/function debugJumpToNextNode\(\)\{([\s\S]*?)\n\}/);
  assert.ok(funcMatch, "debugJumpToNextNode 函数存在");
  const body = funcMatch[1];
  
  assert.match(body, /hitstop\s*=\s*0/, "hitstop 归零");
  assert.match(body, /shakeX\s*=\s*0/, "shakeX 归零");
  assert.match(body, /shakeY\s*=\s*0/, "shakeY 归零");
  assert.match(body, /leveling\s*=\s*false/, "leveling 重置");
  assert.match(body, /paused\s*=\s*false/, "paused 重置");
  assert.match(body, /manualPause\s*=\s*false/, "manualPause 重置");
});

test("590→600跳点：Boss生成逻辑存在且不报错", async () => {
  const html = await readFile(gamePath, "utf8");
  // 验证三花Boss生成
  assert.match(html, /kind\s*===\s*['"]sanhua['"]/, "三花Boss生成入口");
  assert.match(html, /CONFIG\.bossSanhua/, "三花Boss配置引用");
  // 验证结束逻辑：仅三花丹阳子触发通关（丹阳子精英/腊月十八 miniboss 不触发）
  assert.match(html, /bossSanhua[\s\S]*?endGame\(true/, "仅 bossSanhua 触发通关");
  assert.doesNotMatch(html, /bossDanyangzi[\s\S]*?endGame\(true/, "无旧 bossDanyangzi 早期通关路径");
});

test("590→600跳点：手动暂停不被安全网解除", async () => {
  const html = await readFile(gamePath, "utf8");
  // 安全网只解除非手动暂停
  assert.match(html, /!state\.manualPause\)state\.paused=false/, "安全网排除手动暂停");
  // togglePause 设置 manualPause
  assert.match(html, /state\.manualPause\s*=\s*state\.paused/, "手动暂停标记同步");
});

test("590→600跳点：腊月十八/喜神特效无旧喜神路径", async () => {
  const html = await readFile(gamePath, "utf8");
  // 300s 腊月十八用专属 layueGhost（冷蓝怨影），不使用旧 xishenShadow/lane
  assert.match(html, /type:'layueGhost'/, "layueGhost 怨影存在");
  assert.doesNotMatch(html, /xishenShadow\./, "无旧 xishenShadow 调用");
  assert.doesNotMatch(html, /type:'xishenShadow'/, "无旧喜神 shadow 特效");
});

test("590→600跳点：390s 喜神为漆红/古铜/黑对称庙偶程序绘制（橙胸核+青绿攻击）", async () => {
  const html = await readFile(gamePath, "utf8");
  // 漆红主体 + 黑描边 + 古铜饰边 + 橙色胸核
  assert.match(html, /#8e1f1f/, "漆红主体");
  assert.match(html, /#6b5a3a/, "古铜饰边");
  assert.match(html, /#1a1412/, "黑色宽袖/描边");
  assert.match(html, /#d06030/, "橙色胸核");
  assert.match(html, /#5a8a7a/, "青绿（眼/攻击）");
  // 不加载腊月十八原图
  assert.doesNotMatch(html, /BOSS_SPRITES\.xishen\.image;/, "喜神不加载腊月十八原图");
});
