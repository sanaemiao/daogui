// Daogui：首页 startPanel 精简回归——仅保留开始按钮与无敌模式控件
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GAME = new URL("../index.html", import.meta.url);

test("首页 startPanel 精简：仅保留开始游戏按钮与无敌模式控件", async () => {
  const html = await readFile(GAME, "utf8");
  const sp = html.match(/<div id="startPanel">([\s\S]*?)<\/div>/)?.[1] || "";
  // startPanel 块内
  assert.match(sp, /id="invincibleChk"/, "无敌模式控件保留");
  assert.match(sp, /id="startBtn"/, "开始游戏按钮保留");
  assert.doesNotMatch(sp, /<h1>/, "标题移除");
  assert.doesNotMatch(sp, /class="hint"/, "玩法说明移除");
  assert.doesNotMatch(sp, /bossRefs/, "Boss 参考图移除");
  // 全局：按键提示/旧网格 CSS 移除；无敌语义保留
  assert.doesNotMatch(html, /id="controlsHint"/, "按键提示移除");
  assert.doesNotMatch(html, /bossRefGrid/, "Boss 图网格 CSS 移除");
  assert.match(html, /player\.invincible/, "无敌语义保留");
});
