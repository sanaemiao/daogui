// Daogui：首页封面回归——标题 + 开始游戏/无敌模式两按钮，无 checkbox/说明/Boss图/按键提示
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GAME = new URL("../index.html", import.meta.url);

test("首页封面：仅标题 + 开始游戏/无敌模式两按钮，无旧 checkbox/说明/Boss图/按键提示", async () => {
  const html = await readFile(GAME, "utf8");
  const sp = html.match(/<div id="startPanel">([\s\S]*?)<\/div>/)?.[1] || "";
  // startPanel 块内
  assert.match(sp, /coverTitle/, "封面标题（游戏名）保留");
  assert.match(sp, /id="startBtn"/, "开始游戏按钮保留");
  assert.match(sp, /id="invincibleBtn"/, "无敌模式按钮保留");
  assert.doesNotMatch(sp, /invincibleChk/, "旧无敌 checkbox 移除");
  assert.doesNotMatch(sp, /class="hint"/, "玩法说明移除");
  assert.doesNotMatch(sp, /bossRefs/, "Boss 参考图移除");
  // 全局：按键提示/旧网格 CSS/checkbox 语义移除；无敌语义保留
  assert.doesNotMatch(html, /id="controlsHint"/, "按键提示移除");
  assert.doesNotMatch(html, /bossRefGrid/, "Boss 图网格 CSS 移除");
  assert.doesNotMatch(html, /invincibleChk/, "全局无旧 checkbox");
  assert.match(html, /player\.invincible/, "无敌语义保留");
});
