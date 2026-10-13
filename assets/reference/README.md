# 视觉参考与实现草稿

用户已选定的 [图 A](style-a.png) 是总基准。以下补充资料只说明当前 Blender 实现及待完善的内容；没有将模型截图自行标为用户确认的设计。

| 编号 | 内容 | 文件或当前证据 | 状态 |
|---|---|---|---|
| 0 | 整体低多边形街机方向 | `style-a.png` | 用户已选定；整体画面仍有差距 |
| 1 | 骑手正交转面、坐姿侧面 | `ref_char_rider-turnaround_v01_*.png` 六张 | 实现草稿，1536×2048、10cm网格与1m尺；当前绑定姿势，**不是 A-pose** |
| 2 | 头、手、鞋细节板 | `rider-hero.blend` 可查看原生网格 | 待独立参考及细节板 |
| 3 | 二八大杠四面图与接触尺寸 | `asset-library.blend` 中 Bicycle；原生接触校验 | 实现规格已有，四面设计板待补 |
| 4 | 四种蕉束及分阶段货堆 | `banana/bananaB/bananaC/bananaD.glb`、`bananaRack.glb`；运行净空报告 | 模型已有，独立设计板待补 |
| 5 | 卡车四面、爆炸与变形图 | `asset-library.blend` 中 Truck 的16个命名部件 | 分件模型已有，设计板待补 |
| 6 | 海湾和城镇俯视规划 | [原生布局草稿](ref_env_coastal-layout_v01.svg) | 可编辑 SVG 草稿；视线与构图尚待调整 |
| 7 | 环境颜色 | [颜色规格草稿](ref_env_palette_v01.svg) | 草稿；区分原生实际颜色、目标色与照明后的像素 |
| 8 | 六种红岩模块剪影 | `rock-kit.blend` 中 RockModuleA–F | 原生套件已有，正侧剪影板待补 |
| 9 | 光照、雾和景深层次 | [光照规格](ref_env_lighting_v01.svg) | 当前实现规格草稿 |
| 10 | 动作关键帧/视频 | `rider-hero.blend` 的16个 Action；`assets/export/hero-metadata.json` | 动作已实现，独立表演参考未确认 |
| 11 | 特效帧板 | 原生 BurstMesh、BurstGlowMesh、Dust、Spark、Rock | 特效已有，独立视觉帧板待补 |
| 12 | 桌面/竖屏完整 UI 状态板 | `verification/` 中真实游戏截图；HTML/CSS/SVG 源 | 功能状态已验证，独立设计板待补 |

PNG 转面由本地 Blender 渲染，来源是不可变模型快照；不能用这些当前实现渲染，反过来宣称图 A 已严格还原。草稿保留统一正交比例、尺度与“未确认”的画面标注。`prototype.png` 为早期原型参考，不能替代图 A。

生成技术 SVG：在 Blender 执行 `scripts/reference-specs.py`。重现角色转面：执行 `scripts/render-hero-drafts.py -- --turnaround`；`--snapshot` 用于本机已有的冻结源快照。两者均不修改游戏模型源。
