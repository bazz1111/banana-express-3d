# 图 A 连续红岩山坡与环绕远景 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. 在已授权的持续实现中执行，不重复请求美术方向批准。当前目录非Git，保存实际源/导出/证据，不虚构commit或worktree。

**Goal:** 让实际山道具有图A的连续右侧红岩、左侧河谷和转弯时仍可见的蓝色远山/绿色丘陵/云层，继续推进原完整高保真目标。
**Architecture:** 现有Blender路面模板的右岸高度/颜色与岩块轮廓改造；Blender在valley内作者360度山环与云层。Three.js只实例化作者矩阵，保留现有道路/原点/物理/玩法合同。
**Tech Stack:** 本地Blender5.2.2 LTS、Vite/TypeScript/Three.js/Rapier，现有对象池与GLB流程。
**Spec:** `docs/endless-design.md`、`assets/reference/style-a.png`；原目标附图B用于补充核对，最新用户图A/无尽规则/默认坐姿可C切换优先。

## Global Constraints

- 全部可见模型与新场景布局在本地Blender制作；保存四个可编辑.blend和GLB，资源<30MB、整帧调用<300。
- 12m/s起步、每250m+1、26封顶，连续A/D、Space、Q、三道具、得分/失败/重开不改；默认坐姿，C/按钮切站姿。
- 不改`game.ts/main.js/audio.js/physics.ts/route.ts/style.css/reference.css/index.html`及上一轮5个主角模板。道路中心、柏油UV、标线/护栏与course.json保持原样。
- 唯一允许改造模板`cliff/roadTile/roadCourse/valley`；37个其余GLB解码几何/色彩/材质/矩阵继续匹配本轮前快照。历史hero-before基线属于上轮，不假称新环境符合旧形状。
- 参考图和实际游戏截图分开，注入距离是隔离测试；不能用结构检查宣布整图1:1或中端60FPS。

## Review Focus

- 红岩上坡不挤入10.4m柏油：原生路面/护栏不变，导入后车轮/角色/车辆碰撞仍贴路。
- 新地形20段/1600m接缝、植物根、房屋整占地、岩块底圈都有原生支撑证据。
- 路线方向改变/百万米后环绕远山仍可见，远景不是把原图贴在背景。
- 背景新增组用作者矩阵/共享几何，区块复用不复制几何或泄漏实例buffer。
- 场景变化不能遮主角/拾取路线或破坏坐站/边缘跳跃/两侧飞踢构图。

### Task 1: 本地Blender场景改造与源验收

**Files:** `scripts/build-assets.py`；新`scripts/test-landscape-assets.py`；现有`test-curved-road.py/test-lighting-assets.py/test-hero-assets.py`。
**Interfaces:** 现有20个CourseChunk仍有terrain/road/guard；17列terrain与固定路线保持。`EndlessValley`新增`ValleyFoothills`和`ValleyClouds`，保留`ValleyMountains`。每组直接网格子对象，共享该组一个源几何。山环24、丘陵18、云24，作者位置/缩放/旋转均米制。

- [x] 捕获当前GLB/源不变项并运行新地形/山环验收red。
- [x] 右侧负X岸做近路红岩高坡，左岸保持下坡；独立岩块缩成宽矮出露，首12底圈与封底保留。
- [x] valley作者24远山、18丘陵、24云的环形布局；山/丘使用正缩放和切向旋转，模板原形不变。
- [x] 全部重建/导出完成，原生接缝/根/支撑、COLOR_0、主角关节/接触及37不变模板验证。

### Task 2: Three.js环绕远景接入与渲染验收

**Files:** `src/view.js`；新`scripts/landscape-art-check.mjs`。
**Interfaces:** `valleyBatches`新增`ValleyFoothills`与`ValleyClouds`，与Mountains一样在`farPanorama`下；实际河谷六个组继续两区块复用。背景总共9种原生批次，不在JS制造/重新摆放山与云。

- [x] 在旧游戏用转弯距离与实际像素/projection证明远山带显著变薄，保存red与旧截图。旧最薄7025像素，未假称完全为0。
- [x] 等原生新GLB齐全后再修改`buildScene`，避免在仍是旧GLB时要求不存在的节点。三个远景组全部使用`authoredBatch`及source.matrixWorld。
- [x] 三尺寸、坐/站、路线转向/周期/百万米样本核对源矩阵、屏幕真实山体/红岩与人物构图，单独保存新旧截图。

### Task 3: 生产玩法、资源与独立复核

**Files:** 现有规则/骑姿/光影/路面/河谷/恢复/流式/长跑脚本，README/endless-design/progress与新场景指纹。

- [x] 58测试、tsc/build/资产检查，最终生产桌面/竖屏、完整Q窗口、接地与百万米验证。
- [x] 测试Chrome关闭后单独跑2500m真实输入，证明全部玩法及整帧<300；统计新模板/GLB/dist体积。
- [x] 独立复核当前图A和实际生产画面/源码，无本轮新增Important/Critical功能回归；更新证据与源/构建指纹。总体高保真不足仍为Important，原目标继续active。

验收补充：初次画面检查的`runFor(17)`使1599.99m样本跨过周期，报告中的`renderDistance`已有实录。后续`production-exact`在更新HUD后恢复指定距离再绘制，27个场景的实际距离全部精确匹配，包括1599.99/1600.01两侧。HUD数字来自前一RAF，货量为100根隔离夹具，不能当作真实跑局或整图UI还原证明。

独立复核用完整三角形裁切检查126座基础全部占地、10块岩体100个封底三角形；新增环绕布景只使用Blender原生共享几何和作者矩阵。真实按键长跑2501.84m、111根香蕉、2次踢车，0页面/资源错误，整帧绘制峰值146。证据与当前指纹见`artifacts/landscape-build-fingerprint.json`。

本轮是现有场景流程中的局部改造，已获持续实现授权。范围完成并不缩减原严格高保真目标。
