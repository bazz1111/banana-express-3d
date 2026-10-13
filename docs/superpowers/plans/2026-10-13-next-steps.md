# Next Steps 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for integration and superpowers:dispatching-parallel-agents for independent modules. Steps use checkbox syntax for tracking.

**Goal:** 基于已合并 PR #1 的 main，落实用户提供的改进建议，交付可运行、可重建且有对应验证证据的 Blender + Three.js 游戏。

**Architecture:** Blender 保留规范导出，Meshopt 生成运行资产；环境使用按几何分组的实例和远景 LOD。角色独立源文件提供对象模式回退及蒙皮动作，AnimationMixer 与接触点 IK 共存。玩法状态与奖励仍由原固定步长规则负责。

**Tech Stack:** 本地 Blender 5.2.2、Node 24、pnpm、Three.js 0.186.1、Rapier 0.21.0、Vite、Playwright。

**Spec:** `docs/NEXT-STEPS.md` 为改进建议；用户会话中已确认的无尽拾取、自由横移、可切换坐站姿和图 A 优先于其中历史假设。

## Global Constraints

- 所有三维网格由本地 Blender 创建并保存原生源；图 A 保持主参考。
- 保留已合入的 E 冲刺、Q 踢车、自由横移与自动车速；100 为货架显示容量，不限制拾取和得分。
- 不改道路中心线、路面、标线、护栏与路面物理坐标；改变环境仍须验证支撑和周期。
- 单图未覆盖的参考板只能标为草稿或待确认，不能替用户宣布确认；真实设备验收只报告实际可用机器。
- 不采购付费素材、不新建付费设备服务、不自动合并 PR 或宣称所有真机通过。
- 规范 GLB 与运行 GLB 分离；优先无损 Meshopt，保留 extras、节点层级、颜色、动画和物理位置精度。

## Review Focus

- 货量超过100和重开后的实例显示保持正确；4变体按全局束序显示。
- 暂停/恢复/重开冻结及清空动画、相机、音频、零件，不重复奖励。
- 竖屏左右踢车0.6s至少半车可见，骑手始终入镜；减少动态效果设置生效。
- 压缩后的法线/颜色/原生矩阵/碰撞顶点仍正确，原生校验读取规范文件。
- 不以渲染夹具、软件GPU或预期设备代替自然跑局、硬件帧时或最终美术认可。

### Task 1: 基线、性能与交接
**Files:** `verification/next-steps-*`, `docs/device-checklist.md`, `docs/BLOCKERS.md`。
**Interfaces:** main `9d6d128daa95aaecea2dc0e8c2c7f0c346434068`；报告注明 GPU、浏览器、尺寸、真实时钟。
- [x] 同步135文件，内容与远端 main 的 Git blob 全部相同；保留旧版本备份。
- [x] 重建准确 Git 浅克隆基线，工作分支 `codex/next-steps`；63测试通过。
- [x] 生产版本改前截图与可用本机帧时；改后同环境重复采样。

### Task 2: 规范资产、压缩与 CI
**Files:** `scripts/compress-assets.mjs`, `scripts/check-compressed.mjs`, `scripts/asset-fingerprint.mjs`, `.github/workflows/assets.yml`, `.github/workflows/ci.yml`, `scripts/check-assets.mjs`, `package.json`, `pnpm-lock.yaml`。
**Interfaces:** `assets/export/` 规范 GLB；`public/assets/` 解码后等价运行 GLB；Loader 注册 Three 自带 MeshoptDecoder。指纹含几何、颜色、节点矩阵/extras、动画/蒙皮。
- [x] 写规范/压缩对比检查，先证明当前无压缩路径不能满足压缩要求。
- [x] 实现无损 Meshopt、压缩一致性及重建指纹；保留脚本颜色/支撑验证。
- [x] 增加固定 Blender 版本与校验和下载的资产 CI，浏览器选择及兼容清单。

### Task 3: Blender 场景、LOD 与香蕉
**Files:** `scripts/build-assets.py`, `scripts/build-environment.py`, `assets/blender/rock-kit.blend`, `assets/blender/valley-layout.blend`, `src/view.js`, 原生环境检查。
**Interfaces:** 4–6红岩模板、3景深带山云变体、开阔海湾/核心镇；森林LOD1约40面/LOD2约12面；20蕉束4几何变体，4实例批次。
- [x] 记录改前规范资产不变项；先建立LOD、几何组、支撑与蕉束显示断言。
- [x] 在本地 Blender 建模，保持路面相关数据完全不变；保存源与导出。
- [x] 更新运行批次与检查，三尺寸/转弯/周期实际截图审视画面。

### Task 4: 角色独立源、骨骼与动作
**Files:** `scripts/build-hero.py`, `assets/blender/rider-hero.blend`, `src/riderAnimation.js`, `tests/rider-animation.test.js`, 原生/浏览器主角检查。
**Interfaces:** 角色8k–12k面，<=70变形骨，每顶点<=4权重；独立Actions和 `riderSkinned.glb`，`RiderAnimator(root, clips)`；对象模式回退。保留脚踏/车把/车座支撑与冲击星跟脚。
- [x] 新角色独立源、导出层级和实际蒙皮/动作检查，不用旧生成器叠加代替源。
- [x] 状态/暂停/重开测试先失败，再接 AnimationMixer 与 IK；采样全过程动作净空。
- [x] 渲染并保留角色转面和动作证据，新增素材标注草稿。

### Task 5: 窄屏取景、音频与卡车零件
**Files:** `src/kickCamera.js`, `src/physics.ts`, `src/audio.js`, `public/audio/`, `scripts/kick-camera-check.mjs`, 独立单元测试；根代理接 `src/view.js` 与 Blender 卡车分件。
**Interfaces:** `TruckPart_*` + `{breakaway,mass,halfExtents}`；零件最多12、寿命3s、不参与规则；相机只影响取景；免费可再分发音效和来源表，缺文件回退合成。
- [x] 回归测试竖屏投影、零件寿命/暂停/30-120fps、音效并发/缺样本。
- [x] 实现相机、声音加载/缓存/并发限制和 Rapier 零件；Blender分件与近景光晕。
- [x] 实际两窄屏、左右踢车、暂停重开、0页面错误验证。

### Task 6: 集成验证、状态报告与提交
**Files:** 主角/环境/货物校验、`verification/next-steps-*`、README、BLOCKERS。
- [x] 所有单元测试、类型检查、规范资产检查、压缩检查、生产构建。
- [x] Blender源和运行GLB对应，实际完整跑局/取景/动画/触控/资源有界检查。
- [ ] 更新每个建议状态：完成、部分完成、待真实设备或参考确认；提交可审查 PR，附改前后图。

## Rulings

- 建议写“14个动作”，其表格实际列出16个命名片段，按表格逐一交付并记录。
- 背景单图不能证明12项参考都已确认；由模型渲染补充制作规格和草稿板，保留用户确认状态。
- 缺少GTX1650/IrisXe不阻止本机测量和代码优化；不得把本机数据冒充这两台验收。
- 默认先无损Meshopt，减少量化对原生逐顶点颜色、物理与动画检查的风险；按实测收益决定追加量化。

## Integration evidence

See `docs/NEXT-STEPS-RESULTS.md` and `verification/next-*`. Full native repeat and strict fingerprints pass;94unit tests and production build pass.2rig ×3viewport,48Qwindows/2736frames,876cargo samples and4actual truck framing sweeps pass. Original art pixel thresholds remain RED in some27samples and are reported, not loosened; marking implementation/checking steps does not mark overall image-A fidelity achieved. Performance comparison completed: peak1.398M/0.795M triangles and183/123 GL calls;180Hz M6 results, long stalls retained. Publication remains pending.
