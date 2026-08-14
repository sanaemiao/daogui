# 当前游戏状态（CURRENT_GAME_STATE）

> 本文件为 Phaser 迁移前的事实冻结基准，唯一参考来源：`E:\文档\daogui-port-main @0ea57f7`（本仓库当前 HEAD 与工作树）。
> 编写日期：2026-08-13 ｜ 校验方式：抽样回读 index.html / src/v10.5/stage1-config.js / src/v10.5/combat-core.js / tests 真实代码
> 约定：凡未能从代码直接验证的条目一律标注「待确认」，绝不把计划当实现。

---

## 1. 系统结构

### 1.1 仓库布局（无构建步骤，纯静态 Canvas 游戏）

| 路径 | 作用 | 证据 |
| --- | --- | --- |
| `index.html`（约 1900 行，全 IIFE） | 游戏唯一入口：Canvas 渲染循环、玩家/敌人/子弹更新、技能实现、UI、升级奖励 | 全文 |
| `src/v10.5/stage1-config.js` | 权威配置：地图/敌人/精英/Boss/流程事件/献祭/贴图引用，挂 `window.DAOGUI_STAGE1_V105_CONFIG`，deepFreeze | config 全文 |
| `src/v10.5/combat-core.js` | 玩家状态与伤害结算核心：ensurePlayerState/tickPlayerState/setBewildered/takePlayerDamage（含 SACRIFICE minHp=1 锁血），挂 `root.DAOGUI_COMBAT_V105`，纯函数无 DOM | core 全文 |
| `src/v10.3/*` | 旧版配置/核心（v10.3），index.html 未引用（仅历史保留） | grep 无引用 |
| `tests/*.test.mjs`（20 个） | node:test + vm 沙箱回读真实 index.html 的回归测试 | tests 目录 |
| `package.json` | 测试脚本 `node --test`，无运行时依赖、无构建 | package.json |
| `assets/` | 27 个文件 = 19 png + 4 gif + 4 json（含 2 个旧版 sprite 图源等），详见 asset_manifest.json | assets 目录实测 |
| `levelup-freeze.test.mjs`（根目录） | 升级冻结回归测试 | 根目录 |

### 1.2 运行时结构（index.html 顶层）

- **入口**：`<script>` 内 IIFE；`state` 全局对象（enemies/bullets/effects/texts/gems/elites/bosses 等），`player` 全局对象（`createInitialPlayerState()`）。
- **主循环**：`requestAnimationFrame` → `loop()` → 固定步长累加器推进 `update(SIM_STEP)` + `draw()`；`SIM_STEP=1/60`（60Hz 逻辑步长），`MAX_FRAME=.25`（单帧最大累计时长，防螺旋死亡），非旧的 dt clamp 30fps。
- **关卡流程**：`getFlowPhase()` 按 `state.time` 切换敌人池；`debugJumps=[145,295,385,590]` 为流程事件触发点。
- **渲染**：Canvas2D，`resize()` 处理 DPR（上限 2），`ws()` 世界→屏幕坐标，`viewZoom()` 缩放。
- **测试机制**：tests 用 vm 沙箱 + ctx/element stub 加载真实 index.html，断言字符串模式与模拟行为（不依赖真实浏览器）。

---

## 2. 玩家与技能逐级当前效果

### 2.1 玩家基础（createInitialPlayerState）

| 属性 | 初始值 | 证据行 |
| --- | --- | --- |
| hp / maxHp | 125 / 125 | index.html:274 |
| speed | 230 | index.html:274 |
| atk | 1 | index.html:274 |
| r | 15 | index.html:274 |
| level/exp/needExp | 1 / 0 / 36（needExp=32+level×13） | index.html:274, `levelUp` |
| regenPercent | 0 | index.html:274 |
| pickup | 82 | index.html:274 |
| waxShield | 0（虚拟生命，已核验为死代码：仅初始化 1 处 index.html:274，全文件无其他读写） | index.html:274 |
| invuln | 0（受击无敌 0.55s 由 CONFIG.run.playerIFrame） | config:19 |

### 2.2 主动技能逐级（weaponDesc 原文，index.html:891-902）

**七星铜钱剑（coin）**：Lv1 远程发射铜钱短剑｜Lv2 伤害提升｜Lv3 连射+1｜Lv4 穿透+1｜Lv5 伤害提升｜Lv6 攻速和穿透提升｜Lv7 进化「铜钱悬剑」（weaponTrees.coin.evolveAt=7）。

**游老爷（you）**：Lv1 召出 2 道弧线追踪｜Lv2 伤害范围提升｜Lv3 冷却降低｜Lv4 数量 2→3 道｜Lv5 速度提升｜Lv6 冷却降低｜Lv7 数量 3→4 道｜Lv8 伤害提升（注：you 描述有 8 级文本但 maxWeaponLevel=7，Lv8 文本不可达，**待确认**）。

**黑太岁触须（suisui）**：Lv1 近身扫击｜Lv2 距离提升｜Lv3 数量+1｜Lv4 触手强化｜Lv5 进化「李岁，缠取收束协战」（choiceAt=5）｜Lv6 李岁伤害提升｜Lv7 缠取范围收束更强。

**人皮焚身（fire）**：Lv1 中心大爆燃 AOE+灼烧 DOT｜Lv2 灼烧伤害提升｜Lv3 爆燃范围提升｜Lv4 灼烧伤害提升｜Lv5 灼烧更久/跳伤更频｜Lv6 冷却降低｜Lv7 进化「火袄蜒行（延迟二段爆燃刷新 DOT）」。

**大千录（blood）**：Lv1 甲钉×2 回旋甲片｜Lv2 甲钉×3 伤害数量提升｜Lv3 血牙×4 贯穿怪群｜Lv4 血牙×5 数量穿透提升｜Lv5 血牙速度射程提升｜Lv6 指骨×6 斜向穿刺｜Lv7 三祭合流（3 甲钉+4 血牙+7 指骨齐发）。Lv7 后解锁「苍蜣登阶」（cangqiang，index.html:925）。

**献祭眼球（general）**：Lv1 全方向圆形凝视定身｜Lv2 冷却降低｜Lv3 范围增加｜Lv4 追加第二次扫视｜Lv5 定身更强·伤害提升｜Lv6 第三次扫视·范围再增｜Lv7 进化「巴虺一瞥（全图凝视）」。

**置闰五行（ultimate）**：Lv1 获得：主动献祭换 8s 全伤+75%·冷却-30%｜Lv2 祭期缩短 60s→45s｜Lv3 祭期缩短 45s→30s（**Lv3 解锁施展**，triggerUltimate 有 Lv3 门槛；**UI 按钮从不显示**——reset 后 lv=0 且 chooseOption 无显示更新，见 §6 D1）。

### 2.3 苍蜣登阶（cangqiang，随大千录解锁）

Lv1 全图伤害 40·冷却 20s｜Lv2 全图伤害 65·冷却 17s｜Lv3 全图伤害 90·冷却 14s（index.html:903-906）。

### 2.4 被动技能逐级（passiveDesc，index.html:288-297）

| 被动 | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 |
| --- | --- | --- | --- | --- | --- |
| 袄景杀性(atk) | 攻+10% | +20% | +30% | +40% | +55% |
| 护身符(hp) | 最大气血+20 | +40 | +65 | +90 | +120 |
| 火袄箴经(regen) | 回 0.15%/s | 0.30% | 0.45% | 0.60% | 0.75% |
| 心素感知(sense) | 弹速/索敌+10% | +20% | +30% | +40% | +60% |
| 行炁周天(cd) | 冷却-5% | -9% | -13% | -17% | -24% |
| 缩地符(speed) | 移速+8% | +16% | +24% | +32% | +45% |
| 阵势铺陈(area) | 范围+10% | +20% | +30% | +40% | +55% |
| 监天司封赏(luck) | 散炁+10% | +20% | +35% | +50% | +75% |

注：`atkMul` 公式 = `player.atk*1.32*(ultimateBoost?1.75:1)`；`cdMul` = `[1,.95,.91,.87,.83,.76][cd.lv]*(ultimateBoost?0.7:1)`。

### 2.5 升级保底（randomNormalOptions，index.html:913-962）

- Lv≤3 且无黑太岁 → guarantee 提供「黑太岁触须」
- Lv≤5 且无大千录 → guarantee 提供「大千录」
- Lv≥8 且无置闰五行 → guarantee 提供「置闰五行」
- 大千录 Lv≥7 且苍蜣登阶<3 → guarantee 提供「苍蜣登阶」
- 每轮 3 选 1，去重按 type+key，guarantee 优先。

---

## 3. 敌人、精英、Boss 及实际数值

### 3.1 普通敌人（CONFIG.enemies，含随时间成长：hp=base+time×hpPerSecond）

| 敌人 | 角色 | 基础HP | HP/秒 | 伤害 | 速度 | 速度/秒 | EXP | 大小 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 土匪(tufei) | chaser | 30 | 0.075 | 10 | 88 | 0.016 | 4 | 16 |
| 药人(yaoren) | tank | 70 | 0.14 | 14 | 52 | 0.01 | 7 | 18 |
| 裂面邪祟(xiesui) | sway_pouncer | 92 | 0.17 | 17 | 58 | 0.012 | 9 | 19 |
| 无面游魂(wumian) | drifter | 56 | 0.12 | 13 | 66 | 0.012 | 8 | 17 |

> 注：xiesui/wumian 数值已按 config 行 114-135 完整回读核验。

### 3.2 精英（CONFIG.enemies 下）

| 精英 | HP | 伤害 | 速度 | EXP | 技能 | 流程生成 |
| --- | --- | --- | --- | --- | --- | --- |
| 人魈道人(eliteRenxiao) | 7800 | 22 | 58 | 180 | 冲刺(dashSpeed=300, cd5.2s)、符阵(symbolCount=3, cd3.8s, 伤18) | **配置/代码存在但流程不生成** |
| 丹阳子(eliteDanyangzi) | 9000 | 24 | 50 | 220 | 火球(fireCooldown 4.5s)、铃声(bellCooldown 5.0s) | **流程 150s 生成** |
| 黑太岁(eliteBlackTaisui) | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | **配置/代码存在但流程不生成** |
| 喜神(eliteXishen) | 10000 | 26 | 52 | 200 | 符印(signCount=3, range700, cd4.0s, 伤22)、红线(threadLength640, cd5.5s, 伤28)、纸偶(puppetCount=2, cd8.0s, 伤15) | **流程 390s 生成** |

> 注：pounceCooldown/pounceWindup 字段归属 xiesui（sway_pouncer，config 114-126）；pollution 相关字段归属已核验（config 236-241 属黑太岁 eliteBlackTaisui）。

### 3.3 Boss（CONFIG.enemies 下）

| Boss | HP | 伤害 | 速度 | EXP | 技能 | 流程生成 |
| --- | --- | --- | --- | --- | --- | --- |
| 腊月十八(bossLayue) | 13000 | 26 | 46 | 260 | 影击(shadowWindup 1.0s, 伤30, cd5.8s)、影径(laneDamage 23, cd4.4s) | **流程 300s 生成** |
| 丹阳子(bossDanyangzi) | 19000 | 28 | 42 | 420 | 二阶段(phaseTwoAt=0.5)、火球(cd4.2s)、铃声(cd5.6s)、翼扫(wingSweep cd4.8s, radialDamage 30) | **配置/代码存在但流程不生成** |
| 三花丹阳子(bossSanhua) | 24000 | 32 | 46 | 500 | 二阶段(phaseTwoAt=0.5)、火球(cd3.5s)、铃声(cd4.8s)、翼扫(cd4.0s, radialDamage 35) | **流程 600s 生成（终局）** |

### 3.4 流程事件（getFlowPhase，config:140-235 已完整回读核验）

| 时间 | 事件 | 生成单位 |
| --- | --- | --- |
| 0-30s | 荒村追兵（banditPursuit，tufei 为主） | 普通敌人 |
| 30-120s | 土匪围村（banditCharge） | 普通敌人 |
| 120-240s | 药人压境 | 普通敌人 |
| 145s | 丹阳子预警 message | — |
| **150s** | **丹阳子精英（eliteDanyangzi）** | 精英 |
| 235s | 游魂预警 message | — |
| 240s | 游魂过境（soulCrossing，wumian 池） | 普通敌人 |
| 295s | 腊月十八预警 message | — |
| **300s** | **腊月十八 Boss（bossLayue）** | Boss |
| 385s | 喜神预警 message | — |
| **390s** | **喜神精英（eliteXishen）** | 精英 |
| 590s | 三花预警 message | — |
| **600s** | **三花丹阳子 Boss（bossSanhua，终局）** | Boss |

> 当前流程仅生成：150 丹阳子精英、300 腊月十八、390 喜神精英、600 三花丹阳子。eliteRenxiao/bossDanyangzi/eliteBlackTaisui 为配置/代码存在但流程不生成。

---

## 4. 完整游戏闭环

1. **开始**：`startNewRun()` 重置 state/player，初始武器 coin（Lv1）已持有，suisui 等保底引导。
2. **战斗**：边缘刷怪（edgeSpawnPosition），spawnInterval=0.78s，MAX_ENEMIES=180；敌人追/冲/巡游；玩家移动受地形障碍阻挡（positionBlocked，12 个障碍物）。
3. **成长**：击杀得 exp（luckMul 加成），`levelUp()` → 暂停 + 3 选 1（武器升级/获得/被动/进化/苍蜣登阶），guarantee 保底；needExp=32+level×13。
4. **资源**：击杀掉落血宝石（拾取 +22 固定值，pickup=82 半径）；奖励选择含回血 35% maxHp 选项。
5. **献祭**：大千录 0.067%/s 持续烧血（每 2s ledger 结算）、焚身 1%/次、祭眼 1%/次、置闰五行 12%/次（主动，需 Lv3），全部走 SACRIFICE 且 minHp=1 锁血不死；置闰触发后 8s 全伤+75%。
6. **BOSS 战**：流程时间轴触发精英/Boss（150 丹阳子精英、300 腊月十八、390 喜神精英、600 三花丹阳子）；Boss 有二阶段；**击杀三花（600s 终局）即通关获胜**（已核验：killBoss 分支 `endGame(true,'你击败了三花聚顶的丹阳子')`，index.html:648-651）。
7. **结束**：gameOver/胜利 → endGame() → 结束面板（endPanel/endText）。

---

## 5. 资产使用概览

- **地图**：`CONFIG.map.texture = "assets/pixel-prototypes/village-ground-v1-512.png"`（tileSize 512）——**该文件在 assets 中不存在（引用缺失，明确缺陷）**，运行时 MAP_TEXTURE.image.src 404，地图贴图不会显示。
- **玩家**：`assets/player-lihuowang-v8/lihuowang-v8-sheet.png`（4 帧，drawSize 82）；李岁/玄品形态用 `player-lisui-v2/lisui-girl-v2-spritesheet.png`、`xuanpin-v2-spritesheet.png`。
- **敌人**：tufei→`pixel-prototypes/bandit-v1-128.png`（1 帧）；yaoren→`enemy-rebuild-v1/yaoren-v1-sheet.png`（4 帧）；xiesui→`splitface-xiesui-v1-sheet.png`（4 帧）；wumian→`wandering-soul-v1-sheet.png`（4 帧）。
- **Boss 参考图**：`legacy-reference-v1/丹阳子三花聚顶.png`（已核验：startPanel bossRefs 概念图 + BOSS_SPRITES.danyangzi 运行时绘制，index.html:76/123/1434）、`腊月十八.png`（已核验：仅 startPanel bossRefs 概念图，index.html:80；BOSS_SPRITES 无 layue 条目）。
- 全部 27 个资产明细见 `asset_manifest.json`（19 png + 4 gif + 4 json；9 个被引用、18 个未引用、1 个引用缺失）。

---

## 6. 已知功能缺口与确定缺陷

| # | 类别 | 描述 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| D1 | UI 缺陷 | **置闰五行按钮（#ultBtn）从不显示**：CSS `#ultBtn{display:none}` 初始隐藏；`resetPlayerForNewRun()` 将 `weapons.ultimate.lv` 重置为 0，startNewRun 中显示逻辑 `if(weapons.ultimate&&lv>0)ultBtn.style.display='block'` 因 lv=0 恒不成立；`chooseOption` 升级授予置闰五行时**无任何 ultBtn 显示更新**——故按钮全程不可见，置闰五行无法通过 UI 主动施展 | index.html:15, 1860-1861, chooseOption | 确定（代码证据） |
| D2 | 功能缺失 | **音效完全未实现**：index.html 全文无 Audio/AudioContext/oscillator/mp3/ogg/wav 引用（grep=0），所有攻击/受击/Boss 无声 | grep 全文件 | 确定 |
| D3 | 资源缺失 | **地图贴图 village-ground 引用缺失**：`assets/pixel-prototypes/village-ground-v1-512.png` 被 CONFIG.map.texture 引用但文件不存在（assets 中仅 bandit-v1-128.png） | config:34 vs assets 清单 | 确定 |
| D4 | 已核验 | **置闰五行 Lv1-2 无法施展**：按钮从不显示（见 D1）＋triggerUltimate 有 Lv3 门槛（即使代码路径可达也需 Lv3）；是否改为被动触发或补 UI 待产品决策 | triggerUltimate, resetPlayerForNewRun | 已核验（随 D1） |
| D5 | 已核验 | waxShield（虚拟生命）为死代码未接线（仅 index.html:274 初始化 1 处），不影响任何流程 | index.html:274 | 已核验 |
| D6 | 待确认 | you 武器描述含 8 级文本但 maxWeaponLevel=7，Lv8 文本不可达 | index.html:894 vs config:15 | 待确认 |
| D7 | 已核验 | combat-core 纯函数无 DOM（grep=0）；完整事件时间轴已核验（§3.4）；三花获胜条件已核验（§4-6）；pounce/pollution 字段归属已核验（pounce→xiesui config:114-126，pollution→eliteBlackTaisui config:236-241） | — | 已核验 |
| D8 | 已知修复 | 低帧率移速粘滞已在 port 版修复并有回归测试（framerate-movement.test.mjs：固定步长累加器 SIM_STEP=1/60 + MAX_FRAME=.25，非旧 dt clamp 0.033） | tests/framerate-movement.test.mjs | 确定（已修复） |
| D9 | 已知修复 | hitstop 残留卡死已修复并有回归测试（f4-simulation.test.mjs 安全网） | tests/f4-simulation.test.mjs | 确定（已修复） |

---

## 7. 未在本次校验中覆盖（诚实声明）

- 未逐行核对：draw() 全绘制细节、effects/particles 全部种类、每把武器伤害/冷却/范围精确数值（weaponDesc 仅文本，实现数值在 update 内，未逐条回读）。
- 未运行浏览器实机验证；测试为 vm 沙箱级。
- 胜利/失败界面完整流程未逐行核对。
