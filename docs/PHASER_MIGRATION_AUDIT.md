# Phaser 迁移审计（PHASER_MIGRATION_AUDIT）

> 目标：将 `E:\文档\daogui-port-main @0ea57f7`（Canvas2D 纯静态游戏）迁移到 Phaser 的完整审计。
> 依据：用户九项要求 + 本仓库真实代码回读（index.html / src/v10.5/stage1-config.js / src/v10.5/combat-core.js / tests）。
> 原则：可直接复用 / 提取规则重写 / Phaser 必须重写 / 建议淘汰，四类；并给出 P0/P1/P2 风险、推荐迁移顺序、绝不建议照搬部分。

---

## 1. 分类总览

### 1.1 可直接复用（数据/规则/资产，零逻辑改造）

| 项 | 来源 | 说明 |
| --- | --- | --- |
| `stage1-config.js` 全量配置 | src/v10.5 | 地图 bounds/障碍物(12)、敌人/精英/Boss 数值、流程事件、献祭数值、贴图引用、weaponTrees——纯数据 deepFreeze，可直接被 Phaser 加载 |
| `combat-core.js` 伤害结算 | src/v10.5 | takePlayerDamage（含 SACRIFICE minHp=1 锁血）、弹道/状态辅助——纯函数无 DOM/Canvas 依赖（需核对：**待确认** 是否完全无 ctx 引用） |
| 所有 27 个资产文件 | assets/ | 图片精灵表直接可作 Phaser texture；manifest json 可直接用 |
| 升级保底规则（guarantee） | index.html randomNormalOptions | 逻辑规则（Lv≤3 黑太岁、Lv≤5 大千录、Lv≥8 置闰、大千录Lv7→苍蜣）可直接移植为纯函数 |
| 技能/被动逐级描述表 | index.html weaponDesc/passiveDesc | 纯文本数据，直接复用 |
| needExp=32+level×13 升级曲线 | index.html | 纯数值 |
| 测试断言目标 | tests/* | 迁移后的行为验收清单（期望值来源） |

### 1.2 提取规则重写（逻辑保留，接口改为 Phaser）

| 项 | 来源 | 需重写原因 |
| --- | --- | --- |
| 敌人行为（chaser/tank/sway_pouncer/drifter/dasher/orbiter 角色） | index.html createEnemy/update 敌人循环 | 移动/状态机逻辑可提取，但每帧遍历与命中判定改用 Phaser 场景/物理 |
| 玩家移动 + 地形碰撞 | movePlayerWithTerrain/positionBlocked/resolveTerrainCollision | 障碍物数据复用，碰撞改用 Phaser Arcade 或维持自定义 OBB/圆碰撞（数据驱动，逻辑抽取） |
| 技能发射规则（铜钱剑/游老爷/触须/焚身/大千录/献祭眼球/置闰/苍蜣） | update 内各 use* 函数 | 伤害/冷却/进化规则提取为纯函数；投射物实例化改用 Phaser |
| 升级/奖励/3 选 1 UI 逻辑 | getLevelOptions/randomNormalOptions/levelUp | 逻辑抽取，UI 层用 Phaser 重写 |
| 流程阶段事件（getFlowPhase/debugJumps） | config + index.html | 时间轴规则提取，用 Phaser 事件/定时器驱动 |
| 状态机（paused/leveling/manualPause/hitstop 安全网） | index.html update 入口 | 规则保留，事件驱动改 Phaser |
| 固定步长累加器（低帧率粘滞修复，SIM_STEP=1/60、MAX_FRAME=.25） | tests/framerate-movement | 规则保留，用 Phaser 的 fixedStep 或场景 update 时间参数 |

### 1.3 Phaser 必须重写（旧实现无法/不应搬运）

| 项 | 原因 |
| --- | --- |
| **主循环/渲染**：requestAnimationFrame + ctx.drawImage/路径绘制 + DPR + viewZoom/ws 坐标换算 | Phaser 自带 game loop、camera、scale；旧的手写渲染管线全部废弃 |
| **所有 draw 函数**：drawEnemySprite/drawPlayer/drawBoss/drawTextEntity/drawGround 等 | Canvas2D 命令序列（createRadialGradient/arc/bezier/shadowBlur）不能用 Phaser 直接执行；影子/文本/渐变需用 Phaser 的 Graphics/Text/滤镜重做 |
| **粒子/特效/飘字**：effects/texts 数组 | 用 Phaser Particles/Text/Tween 重写，行为对标但实现全换 |
| **输入**：keys 对象 + 虚拟摇杆 + matchMedia 按钮显示 | 用 Phaser 键盘/触摸输入系统 |
| **UI/HUD/升级面板/结束面板**：DOM 元素 + style.display | Phaser 不渲染 DOM 为主 UI；用 Phaser 容器/九宫格或 overlay DOM 混合方案（推荐 Phaser 内做） |
| **按钮可见性/交互**：ultBtn/dengjieBtn onclick + matchMedia | 用 Phaser 交互对象（setInteractive）重写，同时修复 D1 缺陷（置闰按钮从不显示：reset 后 lv=0 且 chooseOption 无显示更新） |
| **精灵表动画**：手写 frames/fps 切帧 | 用 Phaser Anims 配置（frames 数量已齐：玩家4帧/敌人4帧） |
| **音频**：目前 0 实现 | Phaser Sound 体系 + 需新购/授权音频（见 D2） |
| **测试 harness**：vm 沙箱 + ctx stub | Phaser 场景测试用 jest/playwright 或 Phaser headless 重写 |

### 1.4 建议淘汰（迁移时丢弃，勿带入）

| 项 | 原因 |
| --- | --- |
| `src/v10.3/*`（旧版 config/core） | index.html 未引用，纯历史保留，迁移不携带 |
| `assets/player-lisui-v2/*-v1-*`、`xuanpin-v1-*`（旧版未引用资产） | 未引用（详见 asset_manifest.json unused 类），不迁移 |
| 根目录 `levelup-freeze.test.mjs` 与 tests 中依赖字符串匹配旧实现的断言 | 迁移后代码结构全变，字符串断言失效；改按行为/数值断言 |
| `waxShield`（虚拟生命死代码） | 未接线，设计未定，不迁移（或先产品决策） |
| `legacy-reference-v1` 两张 Boss 参考图 | 仅 BOSS_SPRITES 挂载，实际绘制未确认使用；迁移前确认，若仅参考则转设计资料 |
| `debugJumps` 硬编码调试跳转 | 迁移后用正规 Boss 时间轴事件替代 |

---

## 2. 风险清单

| 优先级 | 风险 | 说明 | 缓解 |
| --- | --- | --- | --- |
| **P0** | 贴图缺失 village-ground | 地图贴图 404，迁移后必须补图或改纯色/程序化地面，否则整局观感异常 | 迁移前补齐 512×512 地面贴图（或设计新地面），资产进 manifest |
| **P0** | 渲染语义差异导致手感漂移 | Canvas 手写绘制（缩放 viewZoom、坐标 ws、阴影）与 Phaser camera 语义不同，玩家移动/命中判定换算若错，手感全变 | 先用「提取规则重写」把数值/碰撞逻辑用纯函数 + 单测锁死，再套 Phaser 壳；行为验收对照 tests 期望值 |
| **P0** | 测试资产无法直接迁移 | 20 个 vm 沙箱测试依赖 index.html 字符串，Phaser 后全部失效，迁移期无回归保护 | 迁移第一阶段先把 config/combat-core 抽成纯模块并移植测试；UI/渲染测试后置 |
| **P1** | 置闰五行按钮缺陷带入 | 若照搬 ultBtn 显示逻辑（startNewRun 中 lv=0 恒不显示 + chooseOption 无更新 + Lv3 门槛），缺陷随迁 | 用 Phaser 交互重写时一并修复（Lv<3 禁用态显示灰按钮 + 提示，或改为被动触发） |
| **P1** | 音效缺失 | 0 实现；Phaser 有 Sound 但无素材，需授权来源（用户已否电子合成） | 迁移计划中含音频采购/授权任务，先行调研（参考团队 sfx 调研结论） |
| **P1** | 敌人数值成长公式迁移精度 | hp=base+time×hpPerSecond 依赖 state.time 语义，Phaser 时间轴不同 | 抽成纯函数（输入 t 输出数值）并测试锁定 |
| **P2** | 低帧率粘滞修复回归 | 固定步长累加器在 Phaser 场景 update 需等价实现 | 用 Phaser fixedStep 配置或保留累加器纯函数 + framerate 测试 |
| **P2** | 触摸/桌面按钮差异 | matchMedia 依赖移除后需统一的 UI 适配 | Phaser Scale Manager + 响应式布局 |

---

## 3. 推荐迁移顺序（阶段化）

1. **阶段 0（准备）**：锁定当前事实（本三份文档）；补齐 P0 资产缺口清单；产品决策 D1/D4/D5/D6。
2. **阶段 1（纯模块抽取）**：把 `stage1-config.js`、`combat-core.js`、升级/保底/技能规则、敌人数值成长抽为无 DOM 纯模块；迁移并扩展 20 个测试到纯模块（最大复用旧测试资产）。
3. **阶段 2（Phaser 骨架）**：新建 Phaser 工程（npm + vite/ts），加载配置与资产，空场景跑通 camera/scale。
4. **阶段 3（核心循环）**：玩家移动+地形碰撞（规则复用）、敌人行为、技能投射物——用 Phaser 物理或数据驱动循环；每项对照阶段 1 测试。
5. **阶段 4（Boss/流程）**：精英/Boss 时间轴、二阶段、debugJumps → 正规事件。
6. **阶段 5（UI/反馈）**：HUD、升级 3 选 1、置闰/苍蜣按钮（修复 D1）、粒子特效、飘字、结束面板。
7. **阶段 6（音频与打磨）**：授权音效接入 Phaser Sound；性能验证（180 敌人）；实机回归。

---

## 4. 绝不建议照搬的部分（明确清单）

1. **手写 Canvas 渲染管线**：requestAnimationFrame、ctx 全部绘制（drawEnemySprite/drawTextEntity 的 gradient/shadowBlur 等）、DPR 手调、ws/viewZoom 手写缩放——Phaser 自带 camera/scale 体系，照搬必造成双重坐标系 bug。
2. **手写碰撞与实体循环**：positionBlocked/resolveTerrainCollision/子弹×敌人 O(n²) 遍历——迁移时按 Phaser Arcade physics 或保持数据驱动但用 Phaser 场景管理，勿照搬 DOM-free 的全局数组 + 手写 push/pop 生命周期（易漏清理）。
3. **DOM 版 UI/按钮**：levelPanel/endPanel/ultBtn 的 style.display + onclick——Phaser 内用 setInteractive/容器重做；照搬 DOM 会与 Phaser 场景割裂、双输入源冲突。
4. **手写精灵切帧**：frames/fps 手工推进——用 Phaser Anims 配置（资产帧数已齐）。
5. **vm 沙箱字符串断言测试**：照搬则迁移后全红；改为行为/数值断言。
6. **matchMedia 按钮显示 hack**（startNewRun 中 ultBtn 显示逻辑）：缺陷逻辑（reset 后 lv=0 恒不显示），直接废弃重写。
7. **旧的全局 state 数组 + 时间戳联动**：state.time 驱动流程——用 Phaser 场景时间/事件替代，避免迁移后时间语义错位。
8. **零音频现状**：直接照搬 = 无声游戏；音频必须作为独立工作包补齐。
