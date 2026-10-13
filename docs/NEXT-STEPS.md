# 下一步行动指南（未解决 / 部分解决项）

基于 `docs/BLOCKERS.md` 文首「第二轮处理结果」表，本文给出每个剩余项的可执行方案：步骤、工具与设置、本仓库要改的文件、验收标准、工作量与优先级。主参考图始终是 `assets/reference/style-a.png`（下称“图 A”）。

工作量不按天数估计，而用技术范围分级：

| 级别 | 含义 |
|---|---|
| S | 只改运行时代码（1–3 个文件），不需要新资产，可用现有测试覆盖 |
| M | 多文件改动，或用现有 `scripts/build-assets.py` 程序化生成新资产，需要重跑 Blender 校验 |
| L | 需要美术在 Blender 中手工建模/雕型，并同步更新资产校验和基线 |
| XL | 新建一条生产流水线（如蒙皮动画），涉及加载、运行时、测试和资产检查的全链路 |

## 0. 总体优先级与依赖

1. **先测量，再优化**（第 3 节第 1 步）：确定基准设备，跑出真实帧时。成本低，并且决定后面的美术预算。
2. **参考素材**（第 5 节）：美术返工没有素材就无法验收，应与第 1 项并行，尽早向美术/用户提出需求。
3. **远景森林 LOD + Meshopt 压缩**（第 3 节）：给后续加美术细节腾出三角面和下载预算。
4. **代表弯道美术样本**：红岩、远景、海湾/城镇（第 1.1–1.3 节）。
5. **骑手与蕉束**（第 1.4–1.5 节），和动画流水线（第 2 节）共用同一份新角色。
6. **打击感遗留项**（第 4 节）：先做窄屏取景（S）和真实音效（M），再做零件拆解（M/L），Bloom 放最后且只在预算允许时做。
7. **CI Blender 重建与设备矩阵**（第 6 节）：可在任何阶段并行推进；做完美术项之前至少要先有 Blender 重建 CI，防止资产回归。

依赖关系：第 2 节依赖第 1.4 节的新角色；第 4.1 节依赖新的 `truck` 分件模型；第 3 节的预算会约束第 1 节的面数。

---

## 1. 美术差距（对照图 A）

通用规则（沿用 `BLOCKERS.md` 的结论）：先做**一个代表弯道的完整样本**并验收，再扩展到整条循环路线。不要靠单纯增加树的数量、放大山体或提高面数来“接近”目标。

### 1.1 红岩坡（右侧岩壁）

**现状**：路侧红岩来自 `scripts/build-assets.py` 的 `road_tile()`（`RoadsideTerrain`，24 列地形网格，`terrainGrid` 写入 extras）和 `cliff()`（`RedRockCliff`，6 层 12 边环加 7 个 ico 碎块，4 种红橙色随机涂在面上）。问题是大面积平坦橙色色带、岩层太规整、缺少图 A 中“暗红底 + 亮橙受光面 + 碎石堆”的层次。

**步骤**

1. 在 Blender 中新建 `assets/blender/rock-kit.blend`，手工制作 **4–6 个红岩模块**：
   - 2 个高崖面（3–8 m 高，前倾或垂直，带 2–3 道深槽）。
   - 2 个中等台阶块（1.5–3 m）。
   - 1–2 个碎石坡堆（岩脚，0.3–1 m 的碎块簇）。
   - 每块 300–900 三角面，Flat shading，切面角度以 20°–45° 为主，避免出现大块平面。
2. 色彩用**顶点色分区**，不要用贴图：
   - 受光面（法线朝向太阳方向，即 `view.js` 里 `sun.position (35,70,-30)`）用亮橙 `#D9763A`–`#E8894A`。
   - 侧面用中红 `#B5532A`。
   - 背光面和凹槽用暗红褐 `#7A3320`。
   - 岩脚加少量土黄 `#C8925A`，过渡到路肩。
   - 最终色值以第 5 节色板为准。可以在 `build-assets.py` 里写一个 `paint_by_normal(obj, palette, sun_dir)`，按 `face.normal · sun_dir` 分三档自动上色，再手工点修。
3. 地形网格 `RoadsideTerrain` 保留，作为物理和路肩支撑，**不改道路中心线、标线、护栏坐标**；只把它的颜色压暗为“底色”，让岩块模块盖在上面形成主轮廓。
4. 在 `roadside_course()` 的 `place()`/`instance()` 布局中增加 `kind='rockModule'`（或按模块编号用 `rockA`…`rockF`），沿路按“高崖 → 台阶 → 碎石”节奏摆放：每 80 m 路段 2–4 个，相邻模块旋转 ±25°，缩放 0.8–1.3。
5. `src/view.js` 的 `buildScene()` 里 `this.scenery` 名单加入新 kind，并在 `sceneryVariation` 中给它 `{hue:.025,sat:.12,light:.16}` 的色差（沿用第二轮的实例色差机制）。
6. 支撑与接缝必须仍然成立：复用 `scripts/test-scenery-support.py` 的“完整多边形裁切 + 埋深 150 mm”规则，并为新模块加入断言；运行 `scripts/test-rock-ridges.py` 和 `scripts/test-landscape-assets.py`。

**要改的文件**：`scripts/build-assets.py`（新增 `rock_module(i)` 并修改 `roadside_course()`）、新建 `assets/blender/rock-kit.blend`、`public/assets/manifest.json`（由脚本生成）、`scripts/check-assets.mjs`（`required` 列表和 41 资产计数）、`src/view.js`、`scripts/test-scenery-support.py`、`scripts/landscape-art-check.mjs`。

**验收**

- 用 `scripts/landscape-art-check.mjs` 的三尺寸（桌面、窄屏、竖屏）+ 转弯 + 周期两侧样本截图，与图 A 并排对照：右侧不再出现横跨画面 1/3 以上的单色平面带；能读出受光、侧光、背光三个明度层。
- 所有岩块底缘无悬空（埋深检查通过），道路与护栏不变项检查通过（`scripts/scene-baseline-check.mjs` 中除新模块外其余模板不变）。
- 整帧 GL 调用仍低于 300；新增三角面计入第 3 节预算。

**工作量**：L（需美术手工建模和调色，并更新校验）。**优先级**：高，属于第 0 节第 4 步的代表样本。

### 1.2 远景层次（山体、丘陵、云）

**现状**：`mountain()` 生成 `MountainRidges`，`valley()` 中有 24 座远山、18 座低丘、24 片云，全部共用同一几何（`check-assets.mjs` 也断言“每组共享一份几何”）。重复感明显，图 A 那种“近绿丘 → 中景蓝绿山 → 远景淡蓝峰”的三层空气透视不足。

**步骤**

1. 把远景拆成**三个明确的深度带**，每带 2–3 种轮廓变体：
   - 近丘（200–450 m）：饱和绿 `#4E9A3A`，带树冠肌理。
   - 中景山（450–900 m）：蓝绿 `#4F8A7A`，脊线清晰。
   - 远峰（900 m 以上）：淡蓝灰 `#8FB5CC`，几乎无细节、单面色。
2. 在 `build-assets.py` 中把 `mountain()` 改为 `mountain(variant, band)`，每带生成 2–3 个造型不同的网格（脊线数、峰高比、坡度不同）。导出时仍让每组内部共享几何，但组数从 1 增加到“带 × 变体”。
3. `check-assets.mjs` 中 `['ValleyMountains',24]` 一类“单一几何”断言改为“每个变体组共享几何、组数等于预期”，计数随之更新。
4. 空气透视交给雾和顶点色，不要加后期：`view.js` 中 `this.panoramaFog`（当前 `#a8d4e6`，560–2000）保持，但远峰顶点色本身就要做淡；近丘的色差沿用实例色差。
5. 云：做 3 种体量（扁长、团状、碎片），远处更扁更淡；保持 `ValleyClouds.receiveShadow=false`。

**要改的文件**：`scripts/build-assets.py`（`mountain()`、`valley()` 的 panorama 布局部分）、`assets/blender/valley-layout.blend`、`scripts/check-assets.mjs`、`scripts/test-panorama-props.py`、`scripts/valley-check.mjs`、`src/view.js` 的 `valleyBatches` 名单（新增组名）。

**验收**

- 在同一骑行镜头下，任意截图中至少能分辨出 3 个明度/色相递进的远景层。
- 在视野内，同一造型的山峰不会相邻重复出现。
- 远景层新增的 GL 调用 ≤ 6（每个变体组一个 InstancedMesh）。

**工作量**：M（可以程序化完成，美术只调轮廓参数）。**优先级**：中高，与 1.1 同属代表样本。

### 1.3 海湾与城镇布局

**现状**：`valley()` 有一条 `ValleyWater`（水位 -32 m，沿路线的河谷水面）和 6 处聚落（296 座近景建筑 + 351 座远丘村落建筑，约 76% 为宽矮房屋，5 座钟塔）。图 A 的构图是：**左侧视线越过下坡，看到一片开阔海湾，城镇沿海岸成带状分布，有红瓦屋顶和白墙，远处是岬角和群山**。当前更像河谷，而且房屋分布较均匀，缺少“城镇中心”。

**步骤**

1. 先画一张**俯视布局图**（第 5 节第 6 份素材）：标出路线、海岸线、城镇核心区、码头/钟楼位置，以及每个弯道看向海湾的视线方向。
2. 在 `valley()` 中把 `ValleyWater` 从窄带改成**宽海面**：左侧（下坡方向）延伸到 1000 m 以上，海岸线用 2–3 段贝塞尔曲线作者化，近岸做浅水色带（`#3FB6C9` → 深海 `#1F6FA8`）。浅水色带用顶点色或现有 `Valley_Water_Ripples` 贴图配合 UV 渐变实现。
3. 城镇改为**“核心区 + 沿岸带”**：
   - 核心区 1 处：40–80 座建筑，密集，有 1 座钟楼和 1 个广场空地。
   - 沿岸带：沿海岸线 30–60 m 内分布。
   - 山坡上零散分布少量建筑。
   - 屋顶色在 `#C8553D`（红瓦）和 `#D9704F` 之间做实例色差，墙面在 `#F2E8D8`（白）到 `#E9D3B0`（米黄）之间。
4. 保留现有不变项：建筑必须有石基础，且基础按完整占地贴合（`scripts/test-settlement-assets.py`、`scripts/test-scenery-support.py`）。水面周期必须与道路周期位移一致（`valleyPeriod` 和 `streamScenery()` 中的 `scale.z` 逻辑）。
5. 运行时无需新代码：`valleyBatches` 继续按组实例化；如果新增“码头/船”资产，要加入 `authoredBatch()` 的名单。

**要改的文件**：`scripts/build-assets.py`（`valley()`）、`assets/blender/valley-layout.blend`、`scripts/test-settlement-assets.py`、`scripts/settlement-check.mjs`、`scripts/valley-check.mjs`、`scripts/check-assets.mjs`（`valley` 的建筑数和节点名断言）。

**验收**

- 在代表弯道的骑行镜头中，海面占画面左上 1/4 区域的 30% 以上，城镇核心区可辨认（钟楼可见）。
- 周期接缝无断裂：`valley-check.mjs` 和 `curved-check.mjs` 通过。
- `valley.glb` gzip 后增量 ≤ 1 MB。

**工作量**：L（布局需要美术判断，代码量中等）。**优先级**：中高（代表样本的第三部分）。

### 1.4 骑手比例与服装

**现状**：`rider()` 由环形截面和 `ico/rod` 拼成（`StandingRedShirt`，16 边、8 环），共 6562 三角面，属于对象层级 + 运行时 IK（不是蒙皮）。人体比例、衣褶、皮肤和头发仍有“程序生成感”。

**步骤**

1. 拿到第 5 节第 1 份素材（角色转面图）后，在 Blender 中**手工建一个新角色** `assets/blender/rider-hero.blend`，不要继续在 `rider()` 的程序拼装上叠加修改：
   - 比例：风格化写实，约 6.5–7 头身；肩宽比当前略宽，手掌和脚略放大，便于远看可读。
   - 服装：红色短袖 T 恤 `#D8382B` 左右，袖口和下摆有 2–3 道大褶，骑行时背部有一道横向拉伸褶；蓝色牛仔裤 `#2F4F8F`，膝盖和胯部有压褶；白底运动鞋。
   - 皮肤：深棕 `#6B4329`，用顶点色做两档明暗（脸颊、鼻梁、颧骨较亮）。
   - 头发：短卷发，做成块面团簇（12–20 簇），不要用平滑球体。
   - 面数：8k–12k 三角面（第 3 节预算内），手部 ≤ 800 每只。
2. 拓扑要为第 2 节的蒙皮准备：肩、肘、腕、髋、膝、踝各留 3 圈环线，衣摆单独成环。
3. 坐标系必须与现有接触点一致：脚底支撑点（`test-blender.py` 中 `Foot_L (-.30,-.58,1.311)`、`Foot_R (.04,.21,1.233)`，即站姿踩车把/车座），以及手握车把位置（`view.js` 中 `armJoints` 的目标 `(±.36,1.20,.50)`）。新角色的绑定姿势（A-pose）可以不同，但骑姿下的接触点必须落在这些位置上。
4. 过渡期：先导出为与现有节点同名的对象层级（`BalanceBody`、`Leg_L`…`Hand_R`），这样不改运行时也能先验收外观；第 2 节完成后再切换为蒙皮版本。

**要改的文件**：新建 `assets/blender/rider-hero.blend`；`scripts/build-assets.py`（`rider()` 改为从 `rider-hero.blend` 追加导入对象，`bpy.ops.wm.append`，而不是程序生成）；`scripts/test-hero-assets.py`、`tests/fixtures/blender/hero-native-baseline.json`（重新生成基线）；`scripts/hero-check.mjs`、`scripts/cargo-clearance-check.mjs`。

**验收**

- 坐、站、跳、Q 左右踢四类姿势的真实播放截图（`hero-check.mjs`），与转面图对照：轮廓、头身比、衣褶位置一致。
- 满载净空检查 0 相交（`cargo-clearance-check.mjs`）。
- 手、脚接触误差 < 1 cm（`test-hero-assets.py`）。

**工作量**：L（角色美术为主）。**优先级**：中（在代表弯道样本之后）。

### 1.5 蕉束造型变体

**现状**：`banana(count=5)` 生成五蕉束（1532 面），`cargo()` 把 20 束共享同一网格放在货架上（`check-assets.mjs` 断言“整堆共享一份几何”）。第二轮只加了实例色差，造型仍完全重复。

**步骤**

1. 在 `banana()` 中加 `variant` 参数，生成 **4 种蕉束**：
   - A：5 指，标准弧度。
   - B：7 指，更弯，最外侧两指下垂。
   - C：4 指，短胖。
   - D：6 指，带一根散落偏转的单指。
   - 每种的弯曲度、指间张角和蒂部长度都不同；面数控制在 1000–1600。
2. `cargo()` 中 20 个 `CargoBundleNN` 按“底层平放 → 上层交错 → 外侧下垂”的规则分配变体，相邻两束不使用同一变体。
3. 运行时：`view.js` 目前用 `bundles[0].geometry` 建一个 InstancedMesh。改为按变体分组，**每个变体一个 InstancedMesh**（4 个 GL 调用）。每组记录自己的作者矩阵和“第几束显示”（`cargo.count` 的逐束逻辑改为“按全局束序号 < floor(bananas/5) 显示”，需要各组自行计算 count，或用每实例缩放为 0 来隐藏）。
4. `check-assets.mjs` 的断言改为“20 束、4 种几何、每种至少 4 束”。
5. 拾取的单根香蕉 `looseBanana` 可以同步做 2 个变体。

**要改的文件**：`scripts/build-assets.py`（`banana()`、`cargo()`）、`scripts/check-assets.mjs`（`bananaRack` 断言）、`src/view.js`（`this.cargo` 构建和 `update()` 中的 `cargo.count` 逻辑）、`scripts/cargo-clearance-check.mjs`、`scripts/hero-baseline-check.mjs`。

**验收**

- 满载（100 根，HUD 显示 `100 / 100` 或“满载”）的近景截图中，相邻蕉束轮廓不同，整体外形接近图 A 的“鼓起的蕉堆”。
- 6 种满载姿态 0 相交。
- 货架整体新增 GL 调用 ≤ 3。

**工作量**：M（程序化完成）。**优先级**：中（性价比高，可以提前做）。

---

## 2. 动画流水线（Rigify → glTF → three.js AnimationMixer）

**现状**：`assets/blender/standing-motion.blend` 中有 9 个关键时间轴姿势（对象层级关键帧，动作名 `RidingMotion_*`、`StandingBalance*`），但导出时 `export_selected()` 设置了 `export_animations=False`。运行时 `src/view.js` 的 `update()` 用 `ridingJoints`、`standingJoints`、`kickJoints`、`armJoints` 解析双腿/双臂 IK，并由 `stanceBlend`、`kickBlend` 混合。`tests/view.test.js` 中有 6 项 IK 接触测试。

目标：保留现有输入和规则（坐/站可切、Q 左右踢、跳跃），把身体变形交给蒙皮动画；**脚踏和车把接触仍由运行时 IK 后处理保证**（动画负责风格，IK 负责精确接触）。

### 2.1 Blender：Rigify 绑定

1. 在 `assets/blender/rider-hero.blend`（第 1.4 节）中添加 **Rigify Human (Meta-Rig)**，对齐关节后执行 Generate Rig。
2. 蒙皮：Ctrl+P → With Automatic Weights 绑定到生成的 rig，然后手工修正权重：衣摆跟随 `DEF-spine`；袖口跟随 `DEF-upper_arm`，但对肘部影响 ≤ 30%；裤子膝盖处做 3 圈过渡。
3. 只导出变形骨骼（`DEF-*`）。通常约 60–70 根，删掉面部骨骼后约 40–50 根。确保每个顶点受影响的骨骼数 ≤ 4（导出前执行 Limit Total = 4 并 Normalize All）。
4. 自行车（`bicycle.glb`）保持独立的刚体对象层级，不绑进角色骨架；曲柄 `Crank`、脚踏 `Pedal_L/R`、车轮 `WheelFront/WheelRear` 继续由运行时转动。

### 2.2 动作清单与命名

命名格式：`Rider_<状态>_<变体>`。帧率 60 fps（与游戏固定步长 1/60 一致）。根骨骼不做位移（in-place），根运动由游戏逻辑控制。

| 片段名 | 类型 | 时长 | 说明与对齐点 |
|---|---|---|---|
| `Rider_Idle_Ready` | 循环 | 2 s | 准备界面：坐在车上、单脚撑地或双手扶把轻微呼吸 |
| `Rider_Ride_SeatedPedal` | 循环 | 曲柄一整圈（时长任意，运行时按曲柄角驱动） | 第 0 帧对应 `crank.rotation.x = 0`；双手在车把上 |
| `Rider_Ride_StandingBalance` | 循环 | 2 s | 一脚踩车把、一脚踩车座，手臂张开平衡（对应 `armJoints` 中的 standing 分支） |
| `Rider_Trans_SitToStand` / `Rider_Trans_StandToSit` | 单次 | 0.35 s | 对应 `stanceBlend` 的过渡（当前约 1/12 s 时间常数，可放慢到 0.35 s） |
| `Rider_Jump_Takeoff` | 单次 | 0.15 s | 下蹲后伸展 |
| `Rider_Jump_Air` | 循环 | 0.5 s | 收腿、车把上提 |
| `Rider_Jump_Land` | 单次 | 0.25 s | 落地缓冲 |
| `Rider_Kick_Charge_L` / `_R` | 循环（保持） | 0.4 s | 蓄力：踢腿收起、身体反向倾，对应 `g.charge > 0` |
| `Rider_Kick_Strike_L` / `_R` | 单次 | **0.7 s（42 帧）** | 必须与 `game.ts` 中 `kickPose = .7` 一致；腿最伸展在第 21 帧（`sin((1-kickPose/.7)π)` 的峰值）；冲击星可见窗口为第 8–28 帧（`view.js` 中 `kickPose` 介于 .24 与 .56），在第 8 帧打 marker `impact` |
| `Rider_Lean_L` / `_R` | 叠加（additive） | 单帧姿势 | 转向倾身，按 `g.lateralSpeed` 加权 |
| `Rider_Hit_Shield` | 单次 | 0.4 s | 护盾抵挡碰撞 |
| `Rider_Crash` | 单次 | 1.0 s | 撞障碍结束本局（结算前播放） |

`_L/_R` 的约定：`L` 表示踢向骑手左侧，对应 `g.kickSide < 0`；`R` 对应 `g.kickSide > 0`。现有 `view.js` 中 `kickLeg = g.kickSide > 0 ? 0 : 1`，即 `kickSide > 0` 时用左腿踢向右侧，美术需按这一点决定出腿方向。

Blender 中每个片段是一个独立 Action，并用 **NLA → Push Down** 存成单独的 strip。Action 名即片段名，不要带 `.001` 一类后缀。

### 2.3 导出设置

在 `scripts/build-assets.py` 中为角色新增一个导出函数，**不要修改** `export_selected()` 的 `export_animations=False`（其他资产继续不导出动画）：

```python
bpy.ops.export_scene.gltf(
    filepath=str(OUT/'riderSkinned.glb'), export_format='GLB', use_selection=True,
    export_yup=True, export_extras=True, export_vertex_color='ACTIVE',
    export_skins=True, export_def_bones=True,          # 只导出 DEF-* 变形骨骼
    export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_frame_step=1,   # 60 fps 采样
    export_optimize_animation_size=True,
    export_anim_single_armature=True, export_reset_pose_bones=True,
)
```

参数名以项目实际使用的 Blender 5.2.2 为准。导出前可用 `print(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())` 列出当前版本支持的参数，遇到更名就在这里对应修改。

注意 three.js `GLTFLoader` 会通过 `PropertyBinding.sanitizeNodeName` 清洗节点名：`DEF-spine.001` 会变成 `DEF-spine001`（`.` 被删除）。运行时按骨骼名查找时要使用清洗后的名字，或者在 Blender 中改成不含 `.` 的名字。

### 2.4 three.js 接入（本仓库）

1. **新模块** `src/riderAnimation.js`：

   ```js
   import * as THREE from 'three';
   export function riderState(g){            // 纯函数，便于单元测试
     if(g.phase==='finished'&&g.endReason==='collision')return 'crash';
     if(g.kickPose>0)return g.kickSide>0?'kickStrikeR':'kickStrikeL';
     if(g.charge>0)return g.kickSide>0?'kickChargeR':'kickChargeL';   // 蓄力方向按最近车辆预判，或默认右
     if(g.jumpHeight>0)return g.jumpVelocity>0?'jumpTakeoff':'jumpAir';
     if(g.phase==='ready')return 'idle';
     return g.stance==='standing'?'standing':'seated';
   }
   export class RiderAnimator{
     constructor(root,clips){this.mixer=new THREE.AnimationMixer(root);this.actions=Object.fromEntries(clips.map(c=>[c.name,this.mixer.clipAction(c)]));}
     // update(g,delta,crankAngle): 选择目标动作，crossFadeTo(0.12–0.2 s)；
     // 单次片段 setLoop(THREE.LoopOnce,1)+clampWhenFinished=true；
     // SeatedPedal 不按时间推进，改为 action.time=(crankAngle/(2π))%1*clip.duration；
     // Lean 用 THREE.AnimationUtils.makeClipAdditive 生成叠加片段，权重=clamp(|lateralSpeed|/3.5,0,1)。
   }
   ```

2. **加载**：`view.js` 的 `load()` 中，`names` 加入 `riderSkinned`，保存 `gltf.animations`（目前 `load()` 只保存了 `gltf.scene`，需要把 `animations` 一并记录到 `this.assets`）。蒙皮角色**必须**用 `SkeletonUtils.clone`（`import {clone} from 'three/addons/utils/SkeletonUtils.js'`）复制，不能用 `this.clone()`（即 `Object3D.clone`），否则骨骼不会重新绑定。
3. **材质**：`load()` 中把材质转换为 `MeshToonMaterial`，three 0.186 对 SkinnedMesh 会自动启用 skinning，无需额外设置。`m.flatShading = name !== 'rider'` 的条件里要把 `riderSkinned` 也排除。
4. **更新顺序**（在 `update()` 中替换现有的 IK 段落）：
   1. `animator.update(g, delta, this.crank.rotation.x)`；暂停时 `delta` 为 0（现有 `active` 判断已保证），动画会自然冻结。
   2. **IK 后处理**：对 `DEF-foot.L/R`、`DEF-hand.L/R` 做两骨 IK（可复用现有 `kneeAt`、`legJoints` 的数学，或用 `three/addons/animation/CCDIKSolver.js`），把脚贴到脚踏或车把/车座支撑点，把手贴到车把。IK 权重：坐姿踩踏 1；踢击中出腿那一侧按 `1 - kickBlend` 衰减。
   3. 冲击星仍跟随实际踢腿脚骨骼的世界坐标（`hero-check.mjs` 要求距离脚 < 0.3 m、朝向相机）。
5. **切换开关**：增加 `?rig=skinned`。默认仍使用旧的对象层级角色，直到验收通过再切换默认，以便回退。
6. **测试**：
   - `tests/view.test.js`：新增 `riderState` 的状态表测试，覆盖坐、站、跳、左右蓄力、左右踢、结束各分支。
   - `scripts/test-hero-assets.py`：断言 `riderSkinned.glb` 存在全部片段名、骨骼数 ≤ 70、每顶点影响 ≤ 4。
   - `scripts/hero-check.mjs`：同一版 GLB 录制全段动作帧序列（坐 → 站 → 跳 → 左踢 → 右踢 → 坐），检查接触误差、冲击星位置和入镜情况。
   - `scripts/cargo-clearance-check.mjs`：从 6 个静态姿态扩展为**沿每个片段每 2 帧采样一次**，做货物与人物的三角形相交检查。
   - `scripts/check-assets.mjs`：`required` 列表中加入 `riderSkinned`，模型计数从 41 改为 42，并加入片段名断言。

**验收**

- 全部 14 个片段存在且命名正确。
- 坐、站切换 0.35 s 内无跳帧（相邻帧骨骼旋转差 < 15°）。
- 全过程净空 0 相交；脚踏和车把接触误差 < 1 cm。
- 冲击星窗口与 `impact` marker 对齐（±1 帧）。
- 暂停冻结，重开后恢复坐姿；`?rig=skinned` 与旧角色的输入行为一致（`scripts/browser-check.mjs` 完整跑局通过）。
- 性能：蒙皮角色 CPU 骨骼更新 ≤ 0.3 ms/帧（在基准设备上用 Chrome Performance 面板测量）。

**工作量**：XL（新流水线：绑定、动画、导出、运行时、测试）。**优先级**：中低，排在角色美术之后；它不是游戏能否运行的阻塞项。

---

## 3. 中端 GPU 真实 60 FPS

### 3.1 定义基准设备并测量

1. **基准设备（建议两台，覆盖独显与核显）**：
   - A：Windows 台式机，NVIDIA GTX 1650 4 GB，1920×1080 显示器。
   - B：笔记本，Intel Iris Xe 核显（i5-1135G7 级），1920×1080。
   - 可选 C：MacBook Air M1（Safari 与 Chrome 各测一次）。
   - 浏览器统一用最新稳定版 Chrome。关闭省电模式，接通电源；显示器刷新率 60 Hz（若是 120/144 Hz，按帧时判断，不按 FPS 判断）。
2. **测量命令**（已在仓库中）：

   ```sh
   pnpm build && pnpm preview          # 生产构建，127.0.0.1:4173
   HEADED=1 GAME_URL=http://127.0.0.1:4173/ PERF_SECONDS=120 PERF_SIZE=1920x1080 \
     PERF_REPORT=verification/perf-<设备>.json pnpm perf
   ```

   `scripts/perf-check.mjs` 会分别以 `?quality=high` 和 `?quality=low` 运行，输出加载时间、传输量、FPS、p50/p95/p99 帧时、几何体和纹理数量。请使用有头模式（`HEADED=1`），避免无头模式下 GPU 或垂直同步行为不同。
3. **补充工具**：
   - Chrome DevTools → Performance：录 10 s，查看 GPU 与 Main 线程中的长帧。
   - `chrome://gpu`：确认硬件加速为“Hardware accelerated”，并记录 ANGLE 后端。
   - Spector.js 扩展：抓 1 帧，核对 draw call、阴影 pass 和 overdraw。
   - 运行时可在控制台读取 `window.__bananaGame.view.renderer.info.render`（单次 render 的 calls/triangles；本项目每帧调用两次 render，需要累加）。
4. 至少跑 3 次，取中位数，把报告 JSON 提交到 `verification/`，文件名注明设备。

### 3.2 预算（验收门槛）

| 指标 | 高画质（设备 A） | 低画质（设备 B） | 现状 |
|---|---|---|---|
| p50 帧时 | ≤ 14 ms | ≤ 16 ms | 未在实机测量 |
| p95 / p99 帧时 | ≤ 16.7 / ≤ 22 ms | ≤ 20 / ≤ 28 ms | 未测 |
| 整帧 GL 调用（含两次 render 与阴影） | ≤ 300 | ≤ 220 | 约 130–153 |
| 屏幕三角面 | ≤ 1.5 M | ≤ 0.8 M | 峰值约 2.6 M（高） |
| 首屏传输（gzip/brotli） | ≤ 12 MB | 同左 | 约 20.7 MB（未压缩传输） |
| 首屏可开始（50 Mbps，冷缓存） | ≤ 6 s | ≤ 8 s | 未测 |
| JS 主包 gzip | ≤ 250 KB | — | 170 KB（第二轮后） |
| 显存（纹理 + 几何） | ≤ 350 MB | ≤ 250 MB | 未测 |

### 3.3 三角面：远景 LOD 与实例

1. **远景森林换低模（收益最大）**：`ValleyPanoramaForest`（3600 棵）和 `ValleyForest`（2400 棵，存在两个 tile，同时可见时为 4800 棵）共用 172 面的 `forestTree`。
   - 在 `build-assets.py` 新增 `forest_tree_lod(level)`：LOD1 约 40 面（八面体树冠 + 三棱柱树干），LOD2 约 12 面（两片十字面片，用顶点色）。
   - `ValleyPanoramaForest` 全部换成 LOD2（它总在 450 m 以外），节省约 3600 ×（172 − 12）≈ 0.58 M 三角面。
   - `ValleyForest` 中离路线超过 150 m 的实例拆成单独一组 `ValleyForestFar`，使用 LOD1。
   - 同步修改 `check-assets.mjs` 中 `farForest[0].mesh === nearForest[0].mesh` 的断言：改为“远景使用指定 LOD 网格，且根点位置与原布局一致”（`scripts/test-panorama-props.py` 已有根点检查，可复用）。
   - 运行时 `view.js` 的 `authoredBatch()` 无需改动，只需在 `valleyBatches` 名单中加入新组；第二轮的 `thin` 交错减半机制继续对低画质生效。
2. **近景实例**：`streamScenery()` 每帧对 8 个路段的全部摆放重写实例矩阵和颜色，并对每个批次调用 `computeBoundingSphere()`。先用 Performance 面板确认它在主线程中的耗时；如果超过 1 ms，可以改为“路段变化时才重建实例，帧间只更新整体的根变换”。这需要把实例改成以路段为单位的子批次，因为路线是相对骑手原点重定位的。属于 M 级改动，要保留 `tests/route.test.js` 的百万米坐标测试。
3. **阴影**：当前 2048² PCF、正交范围 ±22 m，近景投影器单独批次（最多 64 个实例 × 每类）。低画质已关闭阴影。可在中档增加“1024² 阴影 + 只有角色、车辆投影”，并测量阴影 pass 的 GPU 耗时。
4. **BatchedMesh**：three 0.186 提供 `THREE.BatchedMesh`，可以把多种植被合并为 1 次调用。是否支持按实例切换 LOD 几何，请先核对 0.186 的 API（`setGeometryIdAt` 等）后再决定，不要预先假设。

### 3.4 GLB 压缩：保持资产检查可用的方案

**约束（从代码中确认）**

- `scripts/check-assets.mjs` 的 `accessorValues()` 直接读取 GLB 二进制块中的原始缓冲区（`buffer.readFloatLE`、`readUInt16LE`、`readUInt8`）。一旦启用 `EXT_meshopt_compression`，缓冲区就是压缩数据，这段读取会得到错误的值。
- `src/view.js` 的 `load()` 在生成 Rapier 物理表面时，对 `roadCourse` 的几何执行 `applyMatrix4` 后用 `new Float32Array(p.array)` 取顶点。**如果位置被量化成归一化的 Int16，`p.array` 会是整数原值，物理碰撞体就错了。** 所以 `roadCourse`、`roadTile`（地形网格和物理表面）**禁止位置量化**，或者先把 `view.js` 改为通过 `getX/getY/getZ` 逐点读取反量化后的浮点值。
- 路面和地形还承担接缝与周期一致性检查（`test-curved-road.py`、`curved-check.mjs`），位置量化可能引入亚毫米误差，破坏“精确相等”类断言。

**推荐路径（Meshopt + 选择性量化，KTX2 暂缓）**

1. **保留“规范 GLB”**：Blender 仍导出未压缩的 GLB，输出目录从 `public/assets/` 改为 `assets/export/`（作为提交物，或用 Git LFS 管理）。`check-assets.mjs` 和所有 Blender 原生检查都对规范 GLB 运行，**原有校验逻辑完全不变**。
2. **新增压缩步骤** `scripts/compress-assets.mjs`：读取 `assets/export/*.glb`，写入 `public/assets/*.glb`。依赖：`@gltf-transform/core`、`@gltf-transform/extensions`、`@gltf-transform/functions`、`meshoptimizer`，作为 devDependencies。按资产设置策略：

   | 资产 | 策略 |
   |---|---|
   | `roadCourse`、`roadTile` | `reorder` + `EXT_meshopt_compression`，**不量化 POSITION**；法线可以量化为 8 bit |
   | `valley`（地形和水面）、`sky` | 同上，位置不量化 |
   | 角色、车辆、植被、建筑等其余模型 | `quantize({quantizePosition:14, quantizeNormal:10, quantizeColor:8})` + meshopt |

   在 three 运行时注册解码器：`import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'; loader.setMeshoptDecoder(MeshoptDecoder);`（修改 `src/view.js` 的 `load()`，无需新增运行时依赖）。

   是否完全无损，以实际对比为准：压缩前后用第 3 步的工具逐顶点比较。如果某资产误差超出阈值，就对它关闭量化。
3. **新增一致性检查** `scripts/check-compressed.mjs`：
   - 用 `NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder})` 读取压缩后的 GLB。
   - 对每个 primitive，比较解码后的 `accessor.getArray()` 与规范 GLB 的值：未量化的资产要求完全相等；量化的资产要求误差 ≤ 半个量化步长（例如 14 bit 时 ≤ 包围盒尺寸 / 2¹⁴ / 2）；顶点色误差 ≤ 1/255。
   - 节点名、extras（`terrainGrid`、`vertexAO`、`period`、`buildings` 等）必须逐项相等，因为 `view.js` 依赖 `userData.terrainGrid`、`surfaceRole`、`kind` 等字段。
   - 内嵌图片（`Asphalt_Painted_Grain`、`Valley_Water_Ripples`）在 KTX2 之前保持原样，原有断言（检查 `bufferView` 为整数）继续有效。
4. **`package.json`**：`"assets:compress": "node scripts/compress-assets.mjs && node scripts/check-compressed.mjs"`；`build` 之前先确认 `public/assets` 是压缩后的最新版本（CI 中执行 `assets:compress` 后 `git diff --exit-code public/assets`）。
5. **部署**：无论是否压缩，都要对 `.glb`、`.json`、`.js` 开启 brotli 或 gzip（实测 gzip 后 `roadCourse` 9.3 → 1.8 MB，`valley` 6.3 → 1.1 MB）。在部署配置（Nginx、CDN、静态托管）中显式加入 `model/gltf-binary` 的压缩规则。
6. **KTX2**：项目只有约 6 张小纹理，KTX2 节省的显存很少，**暂缓**。如果以后加入大贴图，再用 `gltf-transform uastc`（法线、细节贴图）或 `etc1s`（颜色贴图）处理，这需要安装 KTX-Software 的 `toktx`。运行时使用 `KTX2Loader`（`three/addons/loaders/KTX2Loader.js`），并把 `three/examples/jsm/libs/basis/` 中的转码器文件复制到 `public/basis/`，再执行 `detectSupport(renderer)`。此时 `check-assets.mjs` 的图片断言也要改为接受 `KHR_texture_basisu`。
7. **Draco**：不推荐。它需要额外的 wasm 解码器，解码比 meshopt 慢，而且同样会破坏原始缓冲区读取。

### 3.5 Bloom 成本与替代方案

- 本项目每帧 render 两次（远景相机 layer 1 + 前景，`autoClear=false`，中间 `clearDepth()`）。接入 `EffectComposer` 时，要把这两次渲染都放进 composer 的 render target：一个 `RenderPass` 渲染远景，第二个 `RenderPass` 设置 `clear=false`、`clearDepth=true` 渲染前景，然后再接 `UnrealBloomPass`。
- `UnrealBloomPass`（three addons）默认 5 级 mip，每级做横纵两次模糊，加上亮度提取和合成，约 12 个全屏 pass，还会多出 1–2 张全分辨率 render target。1080p 下在核显上通常要几毫秒，**这是推测，必须在设备 B 上实测**。
- **推荐顺序**：
  1. **零后期方案**：在 `burst.glb` 外层加一张加法混合（`AdditiveBlending`）的发光面片（`burstGlow`），再加上第二轮已有的 CSS 闪光 `#impact-flash`。不产生额外 pass。
  2. 只在高画质下启用 Bloom：半分辨率（`new UnrealBloomPass(new Vector2(w/2, h/2), strength .5, radius .4, threshold .9)`），只让发光材质（冲击星、道具）超过阈值。
  3. 预算：Bloom 在设备 A 上 ≤ 1.5 ms，在设备 B 上自动关闭（并入第二轮的自动降级逻辑，`src/main.js` 的 `sampleFrame()`）。

**本节要改的文件**：`scripts/build-assets.py`（LOD 网格、导出目录）、`scripts/compress-assets.mjs`（新建）、`scripts/check-compressed.mjs`（新建）、`scripts/check-assets.mjs`（森林断言、读取路径）、`src/view.js`（`setMeshoptDecoder`、新批次、可选 composer）、`package.json`、`.github/workflows/ci.yml`、`verification/perf-*.json`。

**验收**：设备 A、B 的 `perf-check` 报告同时满足第 3.2 节表格；压缩前后 `check-compressed.mjs` 通过；`scripts/browser-check.mjs` 完整跑局通过；视觉截图与压缩前差异不可察觉（同一夹具下截图，逐像素差异 ≤ 2/255 的比例 ≥ 99%）。

**工作量**：测量 S；LOD M；压缩流水线 M；Bloom 方案一 S、方案二 M。**优先级**：测量最高；LOD 和压缩高；Bloom 低。

---

## 4. 打击感遗留项

### 4.1 卡车零件拆解

**现状**：`truck()` 在导出前被 `pack()` 合并（manifest 中 `truck` 为 14104 三角面）。运行时整车是一个 Rapier 刚体（`physics.ts` 中 `cuboid(1.3,1.3,2.45)`，质量 4000），没有可以飞出的零件。

**步骤**

1. **Blender 分件**：`truck()` 不再把所有部件合并为单一网格，而是在 `Truck` 根节点下保留命名子节点：
   - `TruckPart_Cab`、`TruckPart_Bed`、`TruckPart_Tarp`
   - `TruckPart_Door_L`、`TruckPart_Door_R`、`TruckPart_Tailgate`
   - `TruckPart_Wheel_FL`、`TruckPart_Wheel_FR`、`TruckPart_Wheel_RL`、`TruckPart_Wheel_RR`
   - `TruckPart_Crate_01`…`TruckPart_Crate_06`（车斗里的货箱）

   每个子节点记录 extras `{"breakaway": true, "mass": <kg>, "halfExtents": [x,y,z]}`。只有车门、尾板、货箱和篷布标记为可拆解。顶点 AO 逐件烘焙（`bake_vertex_ao` 已支持多网格）。
2. **资产检查**：`check-assets.mjs` 加入 truck 子节点名单和 extras 断言；`manifest.json` 中 `truck.vertexAO.meshes` 的计数会变化。
3. **物理**（`src/physics.ts`）：
   - 新增 `spawnDebris(vehicleId, parts)`：重踢命中时，或该车第一次与地面接触时（`world.step(eventQueue)` 配合碰撞体 `setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)`，`eventQueue.drainCollisionEvents`），对 2–6 个可拆件各创建一个动态刚体，用 cuboid 碰撞体，尺寸取 `halfExtents`。
   - 初速度 = 母车线速度 + 随机外抛（2–5 m/s），并加一个随机角速度。
   - 上限：同屏零件刚体 ≤ 12；寿命 3 s 后移除；对象池复用。
   - 零件**只用于表现**，不参与 `game.ts` 的碰撞与得分。暂停冻结、重开清空，与现有 `sync()` 和 `reset()` 规则一致。
4. **渲染**（`src/view.js`）：踢中时把对应子网格从卡车模型上 `remove`，挂到场景根节点，由零件刚体驱动位置；整车回收进对象池时（`this.pool`）要把子网格放回原位。
5. **测试**（`tests/physics.test.js`）：
   - 零件数量有上限。
   - 3 s 后刚体被移除（`p.world.bodies.len()` 恢复）。
   - 暂停时零件位置不变。
   - 30/60/120 fps 下轨迹一致（沿用现有帧率无关测试的写法）。

**验收**：重踢命中后，卡车在 0.5 s 内飞出至少 2 个零件，零件与路面发生碰撞而不会穿透；连续踢 10 辆车，刚体数仍有上限、无内存增长（`browser-check.mjs` 的峰值统计）；GL 调用增量 ≤ 12。

**工作量**：M–L（Blender 分件 + 物理 + 测试）。**优先级**：中。

### 4.2 Bloom

见第 3.5 节：先用零后期的发光面片，再考虑只在高画质下启用的半分辨率 Bloom。验收要求同屏冲击星的视觉亮度接近图 A（白芯 + 黄边 + 外光晕），且满足第 3.2 节帧时预算。

### 4.3 真实音效：来源与授权

1. **来源（按授权清晰度排序）**：
   - Kenney.nl 音频包：CC0，可商用，无需署名。
   - Freesound.org：只筛选 “Creative Commons 0” 的素材；CC-BY 素材必须署名，CC-BY-NC 禁止商用，**不要使用**。
   - Sonniss “GDC Game Audio Bundle”：免版税，可商用；不能把原始文件单独再分发。仓库若公开，提交处理后（剪辑、混合过）的文件，并在授权表中写明来源。
   - OpenGameArt.org：按单个文件核对授权。
   - 自录或付费素材库（如 Soundsnap、Epidemic Sound）**会产生费用，需用户批准后再采购**。
2. **清单**（每类 2–3 个变体，运行时随机挑选并做 ±5% 变调）：

   | 文件名 | 用途 | 时长 |
   |---|---|---|
   | `kick_impact_heavy_01..03` | 重踢命中卡车 | ≤ 0.6 s |
   | `kick_impact_light_01..02` | 点踢命中汽车 | ≤ 0.4 s |
   | `metal_crunch_01..02` | 车身受击 | ≤ 0.8 s |
   | `truck_land_thud_01..02` | 落地 | ≤ 1 s |
   | `debris_scatter_01` | 碎石散落 | ≤ 1 s |
   | `whoosh_dash_01` | E 冲刺 | ≤ 0.5 s |
   | `whoosh_kick_01` | 出腿 | ≤ 0.3 s |
   | `banana_pickup_01..03` | 拾取香蕉 | ≤ 0.2 s |
   | `powerup_01` | 拾取道具 | ≤ 0.4 s |
   | `shield_block_01` | 护盾抵挡 | ≤ 0.5 s |
   | `crash_01` | 撞车结束 | ≤ 1.2 s |
   | `bike_chain_loop` | 链条声，循环 | 2 s |
   | `wind_loop` | 风声，循环 | 4 s |

3. **处理规范**：48 kHz，单声道（环境循环可用立体声）；用 ffmpeg 响度归一，短音效 `-af loudnorm=I=-16:TP=-1.5:LRA=7`，循环音 -20 LUFS；首尾 5 ms 淡入淡出；循环素材在过零点切割。
   - 格式：主格式 `.m4a`（AAC 128 kbps，各浏览器都能解码），可选 `.ogg`（Opus 96 kbps）作为备选。
   - 总大小 ≤ 600 KB。
4. **接入**（`src/audio.js`）：
   - 新增 `async loadSamples(manifest)`：`fetch` → `decodeAudioData`，在 `start()` 之后懒加载，不阻塞首屏。
   - `event()` 中有样本时播放样本，没有时退回第二轮的合成音（`sweep()`、`burst()`、`tone()`），保证缺文件时游戏照常运行。
   - iOS Safari 需要在第一次点击时 `resume()`，现有 `start()` 已在点击开始时调用。
5. **授权记录**：新建 `public/audio/` 存放文件，新建 `public/audio/LICENSES.md`，每个文件一行：文件名、原始来源 URL、作者、授权类型、下载日期、修改说明。在 `README.md` 中链接该文件。

**验收**：所有事件都有样本，且缺样本时可退回合成音；授权表与文件一一对应；总大小 ≤ 600 KB；连续拾取不爆音（同类音效并发 ≤ 4，超过时丢弃最旧的）。

**工作量**：M（素材筛选与处理为主，代码 S）。**优先级**：中高（体验提升明显、风险低）。

### 4.4 竖屏窄视野取景

**现状**：第二轮截图 `/opt/cursor/artifacts/after/mobile-kick.png` 中，卡车在命中后立即移出右侧画面。原因是竖屏下水平视野窄，而 `view.js` 的相机块对竖屏只是后撤（`portrait` 插值）。

**步骤**（只改相机，不改物理，保证规则与屏幕尺寸无关）

1. 在 `view.js` 相机计算处（`desired` 和 `target` 的计算之后）加入“踢击取景”：
   - 当 `g.kickPose > 0`，或被踢车辆刚体的 `flight < 1.2 s` 时，取该车辆的世界坐标 `v`，计算 `kickFrame = clamp(1 - flight/1.2, 0, 1) * portrait`（只在竖屏或窄屏下生效）。
   - 把 `target` 向 `v` 插值 `0.35 * kickFrame`，把 `desired` 沿远离车辆的方向后移 `1.5 * kickFrame` m。
   - FOV 临时 +6°（与现有速度 FOV 的上限叠加时总上限设为 62°）。
2. 保护措施：以 `1 - exp(-delta*6)` 平滑；`reduced-motion` 下关闭；暂停时冻结（`delta=0` 已保证）。
3. 冒烟断言：在 `scripts/smoke-shots.mjs` 的 `capture('kick')` 之后，计算被踢车辆位置投影到 NDC，断言竖屏下 `|x| ≤ 1.0` 且 `|y| ≤ 1.0`，并且在命中后 0.6 s 内保持在画面中（可用第二轮的 `window.__freeze` 方法逐步采样）。

**验收**：`390×844` 和 `360×780` 两种尺寸下，卡车在命中后 0.6 s 内始终有一半以上可见；骑手始终在画面内；桌面横屏截图与改动前一致（横屏下 `portrait = 0`，不触发）。

**工作量**：S。**优先级**：高（成本最低）。

---

## 5. 视觉参考素材：需要用户或美术提供的清单

**通用规范**

- 格式：PNG（sRGB，8 bit）或带分层的 PSD/Figma 链接。
- 命名：`ref_<类别>_<名称>_v<两位版本>.png`，例如 `ref_char_rider-turnaround_v01.png`。
- 存放在 `assets/reference/`，并新建 `assets/reference/README.md` 作为索引：文件、用途、版本、状态（草稿/确认），以及与图 A 有冲突时以哪个为准。
- 图 A（`style-a.png`）始终是总基准；新素材只补充图 A 看不到的部分，不能替代它。
- 正交视图使用**无透视、统一比例尺**，画面角落附 1 m 比例尺和 10 cm 网格。

| # | 素材 | 内容与规格 | 服务于 |
|---|---|---|---|
| 1 | 骑手转面图 | 正面、侧面、背面、前 3/4、后 3/4，共 5 视图；A-pose；每视图 ≥ 2048 px 高；标注头身比、肩宽、腿长；配色色块含 HEX（衬衫、裤子、皮肤、头发、鞋）；衣褶位置用红线标注；另附一张骑行姿势（坐姿侧面）用于核对手、脚接触 | 1.4、2 |
| 2 | 骑手细节板 | 头部 3 视图（含发型团簇）、手部（握把与张开）、鞋（侧面与底面）；每张 ≥ 1024 px | 1.4 |
| 3 | 二八大杠正交图 | 侧、顶、前、后 4 视图；车轮 28 英寸（直径约 0.71 m）；标注车座高、车把高、后货架尺寸与承重区域；黑色车架的高光色 | 1.4、2（接触点） |
| 4 | 蕉束与货堆 | 4–6 种蕉束（不同指数、弯曲、成熟度：青、黄、带斑）各 2 个视角；单根香蕉 2 个视角；货架装载 25%、50%、75%、100% 四个阶段的后视与侧视（对应 HUD 的 `N / 100`） | 1.5 |
| 5 | 卡车板 | 4 视图 + 爆炸图（标出可拆解零件：车门、尾板、货箱、篷布）+ 1 张受击变形参考 | 4.1 |
| 6 | 海湾、城镇俯视布局图 | 路线、海岸线、城镇核心区（钟楼、广场）、沿岸带、码头的俯视规划，标注距离（m）和从 2–3 个代表弯道看出去的视线方向 | 1.3 |
| 7 | 环境材质色板 | 红岩（受光、侧光、背光、岩脚）、植被（4–5 种绿）、海水（浅、中、深）、屋顶和墙面、柏油和标线、天空（地平线、天顶）、云；每种给 HEX 和一张小样图 | 1.1–1.3 |
| 8 | 红岩模块剪影 | 4–6 个模块的正面和侧面剪影线稿，标注高度 | 1.1 |
| 9 | 光照与色彩脚本 | 在图 A 上标注：太阳方向（方位角/高度角）、阴影颜色 HEX、雾或空气透视的起止距离、各层明度值（0–100）；1 张图即可 | 1.2、3.5 |
| 10 | 动作参考 | 每个片段（第 2.2 节表格）的关键帧草图，或参考视频（需确认版权，仅作参考）；踢击片段需提供 3 个角度：后、侧、前 3/4 | 2 |
| 11 | 特效板 | 冲击星逐帧形状（4–6 帧）、尘土和碎石形状与颜色、速度线粗细与密度、闪光颜色 | 4 |
| 12 | UI 状态板 | 1920×1080 与 390×844 两种尺寸下，所有界面状态：就绪、倒计时、骑行中、暂停、结算、错误、道具生效、Q 蓄力中/蓄满/冷却、E 冷却、货架满载；字体名称和授权、图标 SVG 源文件、颜色变量 | HUD 验收 |

**验收**：12 项素材全部进入 `assets/reference/README.md` 索引并标记“确认”。每个美术任务（第 1、2、4 节）的验收截图都要标注对照的素材编号。

**工作量**：由美术或用户完成。仓库侧只需维护索引（S）。**优先级**：最高，与第 3.1 节测量同时启动。素材 1、6、7、9 最先需要。

---

## 6. CI：Blender 资产重建与设备兼容矩阵

### 6.1 Blender 资产重建 CI

**现状**：`.github/workflows/ci.yml` 只检查预生成的 GLB（安装、测试、资产检查、构建、浏览器冒烟），没有在 CI 中用 Blender 重建资产，所以无法发现“源文件与 GLB 不一致”或“脚本已无法重建”。README 记录的本地重建版本是 Blender 5.2.2 LTS（需要 numpy；Blender 官方发行包自带 numpy，在 CI 中需验证）。

**步骤**

1. 新建 `.github/workflows/assets.yml`。触发条件：`scripts/build-assets.py`、`scripts/test-*.py`、`assets/blender/**`、`tests/fixtures/blender/**` 变更；`workflow_dispatch`；每周一次 `schedule`。
2. 安装固定版本的 Blender，并缓存：

   ```yaml
   - uses: actions/cache@v4
     with: { path: ~/blender, key: blender-5.2.2-linux-x64 }
   - run: |
       test -x ~/blender/blender || { mkdir -p ~/blender && curl -fsSL \
         https://download.blender.org/release/Blender5.2/blender-5.2.2-linux-x64.tar.xz \
         | tar -xJ -C ~/blender --strip-components=1; }
       ~/blender/blender --version
       ~/blender/blender -b --factory-startup --python-expr "import numpy;print(numpy.__version__)"
   ```

   URL 请以 download.blender.org 上的实际文件名为准，并在工作流中校验 SHA256（官方发布页提供校验和）。
3. 按依赖顺序运行（全部使用 `--background --factory-startup --python-exit-code 1`）：
   1. `scripts/test-blender.py`：会重新建模并导出。
   2. `test-curved-road.py`、`test-lighting-assets.py`、`test-hero-assets.py`、`test-landscape-assets.py`、`test-rock-ridges.py`、`test-scenery-support.py`、`test-settlement-assets.py`、`test-panorama-props.py`。
   3. `node scripts/check-assets.mjs`。
4. **可重复性检查**：重建后执行 `git status --porcelain public/assets assets/blender`。GLB 字节可能因 exporter 写入的 generator 字段或浮点格式而不完全一致，所以**不要比较字节**，而是比较几何哈希（`build-assets.py` 已有 `geometry_hash(data)`）。新增 `scripts/asset-fingerprint.py`，为每个 GLB 输出 `{name: geometry_hash, triangles, nodeNames}`，与提交的 `tests/fixtures/blender/asset-fingerprint.json` 对比，不一致就失败，并把差异报告作为 artifact 上传。
5. **不自动提交**：CI 只验证并上传重建出的 GLB 与差异报告（`actions/upload-artifact`）；由开发者确认后手动提交。
6. 运行时长：全量重建包含 AO 烘焙（BVH，纯 CPU），时间较长，设置 `timeout-minutes: 90`。如果需要压缩时长，可以按资产分组，用 matrix 并行。
7. 第 3.4 节落地后，在此工作流末尾追加 `pnpm assets:compress` 并执行 `git diff --exit-code public/assets`。

**验收**：在干净的 runner 上重建并通过全部 Blender 检查；几何指纹与仓库一致；故意改动 `build-assets.py` 中一个颜色时，工作流应报告差异并失败。

**工作量**：M。**优先级**：中高（在大规模美术改动之前完成）。

### 6.2 设备兼容矩阵

**矩阵（P0 = 每次发布前必须通过；P1 = 每个里程碑测一次）**

| 平台 | 浏览器 | GPU 或设备 | 输入 | 级别 |
|---|---|---|---|---|
| Windows 11 | Chrome 稳定版 | GTX 1650（设备 A） | 键盘 | P0 |
| Windows 11 | Edge 稳定版 | Intel Iris Xe（设备 B） | 键盘 | P0 |
| Windows 11 | Firefox 稳定版 | 设备 A 或 B | 键盘 | P1 |
| macOS 14 及以上 | Safari 17 及以上 | Apple M1 | 键盘、触控板 | P0 |
| macOS | Chrome | Apple M1 | 键盘 | P1 |
| iOS 17 及以上 | Safari | iPhone 12 级 | 触控（竖屏、横屏） | P0 |
| Android 13 及以上 | Chrome | 中端机（Adreno 6xx 或 Mali-G7x 级） | 触控 | P0 |
| iPadOS | Safari | iPad（A13 及以上） | 触控 | P1 |
| ChromeOS 或低端笔记本 | Chrome | 核显（UHD 600 级） | 键盘 | P1（只验证低画质与自动降级） |

**每格检查项**（写成清单 `docs/device-checklist.md`）：

1. 载入成功，且无错误面板（WebGL2 可用；不可用时显示友好错误，现有 `boot()` 的 catch 分支已有）。
2. 开始 → 倒计时 → 骑行；A/D 或触控左右、跳跃、Q 点按和蓄力、E 冲刺、C 骑姿、Esc 暂停、结束与重开。
3. 声音：首次点击后有声；切到后台再回来时暂停，且声音停止。
4. 旋转屏幕或调整窗口大小后，HUD 不溢出（`fidelity-check.mjs` 的 HUD 压力断言）。
5. WebGL context 丢失与恢复（可在 Chrome 中用 `WEBGL_lose_context` 扩展模拟，现有 `context-check.mjs` 已覆盖）。
6. 60 s 骑行的 `perf()` 结果（p50、p95）记录到 `verification/devices/<平台>-<浏览器>.json`。
7. 自动降级：低端设备上应在约 4 s 内（240 帧）切换为低画质并出现提示。

**自动化**

- CI 中可以加入 Playwright 的 `firefox` 和 `webkit` 项目跑冒烟。Linux 上的 WebKit/Firefox 能否提供 WebGL2，需要先实测；不支持时标记为跳过，不要误报成通过。可以在 `scripts/smoke-shots.mjs` 中通过 `PLAYWRIGHT_BROWSER=firefox|webkit` 切换 `chromium` 与 `firefox`/`webkit` 的启动器。
- 真机：BrowserStack 或 LambdaTest 的 Automate 支持 iOS/Android 真机 + Playwright 或 Appium，但**会产生费用，需用户批准**。免费替代方案是团队成员按 `docs/device-checklist.md` 手动测试并提交报告 JSON。
- 触控：在 Playwright 中用 `hasTouch: true, isMobile: true` 的设备描述（例如 `devices['iPhone 13']`）覆盖触控按钮流程。现有 `fidelity-check.mjs` 已有窄屏触控逻辑，可以并入冒烟。

**验收**：所有 P0 格子都有最新报告且全部检查项通过；P1 格子可以有已知问题，但必须记录在 `docs/device-checklist.md` 中。

**工作量**：清单与 CI 多浏览器冒烟 M；真机云测试 S（配置）加费用。**优先级**：中，在首次对外发布前完成 P0。

---

## 7. 汇总：执行顺序清单

| 顺序 | 任务 | 小节 | 工作量 | 前置 |
|---|---|---|---|---|
| 1 | 确定基准设备，跑 `pnpm perf` 并提交报告 | 3.1 | S | 无 |
| 2 | 向美术或用户提交参考素材需求（先要 1、6、7、9） | 5 | S（仓库侧） | 无 |
| 3 | 竖屏踢击取景 | 4.4 | S | 无 |
| 4 | 远景森林 LOD | 3.3 | M | 1 |
| 5 | Blender 重建 CI + 几何指纹 | 6.1 | M | 无 |
| 6 | Meshopt 压缩流水线 + `check-compressed.mjs` | 3.4 | M | 5（建议） |
| 7 | 真实音效与授权表 | 4.3 | M | 无 |
| 8 | 蕉束 4 变体 | 1.5 | M | 素材 4 |
| 9 | 代表弯道样本：红岩 + 远景 + 海湾/城镇 | 1.1–1.3 | L | 素材 6、7、8、9 |
| 10 | 新骑手模型 | 1.4 | L | 素材 1、2、3 |
| 11 | 卡车分件与零件拆解 | 4.1 | M–L | 素材 5 |
| 12 | Rigify 动画流水线 | 2 | XL | 10，素材 10 |
| 13 | 设备兼容矩阵 P0 | 6.2 | M | 1 |
| 14 | 发光面片 → 视预算决定是否加 Bloom | 3.5、4.2 | S–M | 1、4 |

每完成一项，都在 `docs/BLOCKERS.md` 文首的状态表中更新状态和证据路径，并在 PR 中附上同一夹具下的改动前后截图。