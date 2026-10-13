# 无尽骑行 Implementation Plan

> 执行：沿用已授权的实现范围，按游戏开发、并行开发与验证技能推进；当前目录非 Git 仓库，直接在现有工作区修改，不虚构提交或 worktree。

**Goal:** 可完整玩到拾取、跳障、侧避、道具、踢车、失败/主动结算与重开，且持续生成。
**Architecture:** 60 Hz 规则模拟 + 相对原点滚动渲染 + 本地 Blender GLB；独立规则/UI任务遵循共享合同，根代理负责资产和渲染/物理集成。
**Tech Stack:** existing Vite/TypeScript/three.js/Rapier/HTML/CSS/Blender。
**Spec:** `docs/endless-design.md`。

## 约束与重点

连续横移、全部可见模型来自 Blender、不要替换图 A 基准。检查高速扫掠、长列车重复接触、拾取高度、刷新不叠加、暂停/失焦/重开、超 2000 米后继续生成以及有界内存。

### 1. 规则与生成（独立任务）
- [x] 修改 `src/game.ts`、`tests/game.test.js`，先运行新规则失败证据。
- [x] 实现状态、速度、跳跃、障碍扫掠、拾取/道具/连击、滚动生成与结算。
- [x] 运行规则测试，报告其余尚待集成的失败。

### 2. UI、输入与声音（独立任务）
- [x] 修改 `src/main.js`、`src/audio.js`、`src/style.css`、`src/reference.css`、`index.html`。
- [x] 删除有限配送 UI，接入合同与新 HUD、暂停/主动结束/重开。
- [x] 保留键盘连续移动、移动端按钮、焦点/context 冻结和声音开关。

### 3. Blender 资产（根代理）
- [x] 在 `scripts/build-assets.py` 重建站姿、障碍、拾取物与无限路段。
- [x] 修改 `scripts/test-blender.py`、`scripts/check-assets.mjs`，验证源和导出/尺寸/层级。

### 4. 视图与物理（根代理）
- [x] 修改 `src/view.js`、`src/physics.ts` 和对应测试，验证足部支撑、跳跃和踢車。
- [x] 实现路段/场景池、拾取池、原点相对坐标；清除有限关卡依赖。

### 5. 集成验收
- [x] 完整构建、规则/动作/物理测试、浏览器玩法回归、无尽长跑有界检查。
- [x] 更新 README、规则文档、模型 manifest 与进展证据；复核实际游戏截图。

### 6. 最新骑姿补充
- [x] 默认坐姿踩踏，C/按钮切换站姿；暂停/结束禁用，重开复位。
- [x] Blender 肘/手对象关节、坐姿动作源、坐站过渡；飞踢从当前腿部姿态混合。
- [x] 实际 GLB 接触、窄屏输入、Q 连续性与含骑姿切换的 2.5 km 生产回归。
