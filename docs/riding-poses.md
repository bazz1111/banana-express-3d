# 骑姿与动作规格（2026-10-28）

站立是可切换的特技姿势。默认坐姿蹬踏，C 或顶部骑姿按钮切换；一脚踩前车把、一脚踩车座。姿势不改变速度、转向、碰撞体、跳跃、技能冷却或积分。ready/countdown/racing 允许切换，paused/finished 和 WebGL 中断时禁用；重开恢复坐姿，暂停不积攒输入。

## 当前原生源

`assets/blender/tripo/hero.blend` 保存 Tripo H3.1 主角的原始 Mixamo 65 骨蒙皮、19,121 个三角面、2K 基础色、16 个独立 Action/NLA。`assets/blender/tripo/bicycle.blend` 保存同版自行车及真实接触标记。它们替换历史对象关节和15骨人物；运行入口不再切换旧 rig。`rider.glb` 是兼容导出，实际只加载 `riderSkinned.glb`。

主角自然身高1.85m，骨段长度、UV、原始皮肤权重保持；接触IK只旋转骨骼，不拉伸四肢。绑定源 `assets/sources/banana-tripo-v1/hero-rigged.glb` 随仓库保留，原始 SHA256 和逐顶点验证信息在 `assets/export/hero-metadata.json`。

16个片段：准备、坐姿蹬踏、站姿平衡、坐→站、站→坐、起跳、腾空、落地、左右蓄力、左右踢击、左右倾斜、护盾受击、失败。Blender 原生 NLA 与 GLB 都保留这些动作，Three.js 通过 AnimationMixer 播放；`src/mixamoRiderAnimation.js` 负责混合与接触IK。

## 接触与过渡

- 坐姿掌心 `Palm_L/R` 对齐自行车 `RiderGrip_L/R`，鞋底 `Sole_L/R` 跟随 `RiderPedal_L/R`。脚踏在 Crank 下随曲柄旋转。
- 站姿鞋底对齐 `RiderStand_L/R`，分别支撑在车把和车座。站姿摆臂用于平衡。
- 实际目标来自同版自行车标记，保存的 `contactConfig` 同时进入原生源与 metadata；不再沿用历史车体坐标。
- 正常切换约0.35秒。重复按C会从当前混合姿态平滑反向，不重置到旧切换端点；上身与四肢使用同一 stanceBlend。
- Q 蓄力提前选择即将进入射程的车辆，与释放时采用同一目标筛选，避免蓄力抬右腿、命中突然换左腿。挥空仍平滑恢复所选骑姿。
- 跳跃/落地/飞踢叠加在当前骑姿上；暂停冻结动画、车轮、风、粒子和镜头，重开清理所有混合与旧飞车。

## 货物与验证

`tripo-cargo.blend` 包含20束、4种真实蕉束变体，随拾取数每5根显示一束；视觉容量100不限制计分。中央首束先出现并贴实货架，上层交错、外侧下垂；80根起显示两条绑绳。原生货架标记的 Blender 坐标为 `(0, 0.676314, 0.796986)` 米。

验证必须使用实际蒙皮后的顶点与原生货物三角形，包含绑绳；不能只比较包围盒或几个对象原点。原生检查覆盖坐/站/跳跃/左右Q等9个姿势，运行时检查连续切换、倾斜及完整Q窗口。接触误差、净空、动作反转和屏幕构图分别记录，投影通过不能代替遮挡检查或整体美术验收。

```sh
pnpm test
Blender --background --factory-startup --python-exit-code 1 --python scripts/test-hero-assets.py
Blender --background --factory-startup --python-exit-code 1 --python scripts/test-skinned-hero.py
GAME_URL=http://127.0.0.1:4173/?seed=2817 node scripts/riding-check.mjs
GAME_URL=http://127.0.0.1:4173/?seed=2817 node scripts/cargo-clearance-check.mjs
GAME_URL=http://127.0.0.1:4173/?seed=2817 node scripts/hero-check.mjs
```

`Blender` 需换为本机可执行路径；浏览器检查需要 Playwright。最新实测范围与未测项见 [本轮检查报告](banana-audit-20261028.md)。2026-10-13 的对象关节方案和旧接触数字仅属于历史版本，不能作为当前资产验收依据。
