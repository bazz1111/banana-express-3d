# 更新技能后的复审证据

基线 `ae954381075cef195dd56837f31bd425c8eac098`；修改后的运行/测试文件SHA256及环境在 [environment.json](environment.json)。完整说明见 [复审报告](../../docs/banana-reaudit-20261028.md)。本轮复用现有Tripo/Blender资产，没有新增生成费用。

| 文件 | 实际证明的范围 |
|---|---|
| [input-before.json](input-before.json) / [input-first-fix.json](input-first-fix.json) | 实际键盘，显式空路、冻结模拟时间再恢复。第一版修复使Space/E短按和画质按钮焦点正常；之后物理边沿/触控竞态以最终单元与smoke回归为准 |
| [course.json](course.json) | 12种子×3里程的36个局部12秒窗口，搜索连续转向并生产重放；无跳跃/Q/盾/无敌，加速与入口是夹具，保留完整输入。非全种子/真人难度证明 |
| [smoke-high.json](smoke-high.json) | Chrome156/Apple M6，桌面及两个竖屏尺寸、高档、真实键盘/CDP持续触控与取消；按需暂停0绘制、resize仍重绘 |
| [smoke-software.json](smoke-software.json) | 强制SwiftShader软件GL、低档、桌面/竖屏的同一功能回归；实际软件渲染器已记录，不是GPU性能验收 |
| [gameplay.json](gameplay.json) | 本轮最终构建键盘自动游玩3602.925m，自然158蕉、3辆卡车；三道具、坐站、跳/E、暂停、两种结束和重开。虚拟时钟，仅验功能 |
| [context.json](context.json) | 实际WebGL丢失与恢复、暂停不推进、显式继续恢复；虚拟时钟，仅验功能 |
| [shader-diagnosis.json](shader-diagnosis.json) | 首击CPU诊断的长动画帧与调用采样、低档3个新basic变体；Profiler有额外开销，不用其帧时当FPS结果 |
| [performance-before-shader-warmup.json](performance-before-shader-warmup.json) | 本轮加入完整首次draw预热前的真实两档60秒采样，保留55.5/94.3ms首击长帧；不删除失败基线 |
| [performance.json](performance.json) | 最终Apple M6有头Chrome、两档各60秒、最高速/满货/6次真实Q压力采样；完整rAF，踢车最长22.3/17.6ms，保留10个最差帧。含护盾等明确夹具，不推断实体中端设备 |
| [desktop-kick.png](desktop-kick.png) / [small-touch-kick.png](small-touch-kick.png) | 上述真实游戏中的临时卡车与85蕉演示夹具，未用概念图替代；不是自然玩家成绩 |

冒烟先自然开局到30m，再清空交通隔离输入检查；临时卡车在真实松手协议操作前冻结，恢复后必须由生产规则命中。`msPerFrame`只是短时协议/功能记录，不用于FPS结论。持续性能摘要另行记录真实rAF窗口，保留最长帧与压力夹具说明。

首击检查记录0新增色彩program及0次监测的shader日志、uniform和attrib首次查询；不以program数代替帧时。加载预热使用独立相机覆盖两层，四种阴影组合均实际绘制，避免编译遍历了网格却被远景相机过滤掉首次draw。

本地 `artifacts/reaudit-20261028/` 保存原始帧样本、失败/通过日志和全部截图；该目录被Git忽略。仓库保留精简统计、输入重放及代表截图。源模型、正式美术与其他设备未在此轮重新验收的部分沿用原证据并注明边界。
