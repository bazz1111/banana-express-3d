# Banana Express 全面核查与实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 当前已获用户明确实现授权；复用既有设计，不逐阶段重新审批。

**Goal:** 在 main 9f1689f 的无尽骑行原型上，修复可复现缺陷、改善主角/香蕉/海湾构图，并交付真实可玩的同版本构建与分层验收记录。

**Architecture:** Tripo H3.1 母版经本地 Blender 精修、绑定、动作与LOD优化，再由 Three.js 展示；保持60Hz规则/扫掠碰撞与Rapier飞车。保存的.blend为导出权威，CI只读重导，不重跑旧几何生成器。

**Tech Stack:** Node24 / pnpm11.25 / Three.js0.186.1 / Rapier0.21 / 本地 Blender5.2.2 LTS。

**Spec:** docs/endless-design.md；docs/riding-poses.md 的用户规则；docs/NEXT-STEPS-RESULTS.md 的当前实现；本轮附图保存为 assets/reference/style-a-2026-10-28.png。旧文档过期的资产与动画描述以 README/实际源为准。

## Global Constraints

- 无尽拾取、连续自由横移、自动提速、默认坐姿/C切换站姿保持；不恢复装货/终点/100根胜负门槛。
- 2026-10-28 最新要求覆盖旧 Blender-only 限制：整套3D资产通过 Tripo 生成，Blender负责精修、拆分、绑定、专属动作、LOD/优化和导出；Imagegen制作独立建模参考。
- 不操作原工作区 pole-vault / garden / cut-rope 的修改；本轮仅在独立 worktree 修改香蕉骑行。
- 模型原生米制与道路/护栏基线保持，新增形体须验证接触、货物净空、动画和实际镜头。
- 以可见改善验收美术，不用资产数量或实现截图自证严格1:1；缺真实硬件/真人样本写未测。
- 不修改 GitHub main、不发布公网、不购买服务；有授权的开发、建模、测试连续执行。

## Review Focus

- 同帧/高速跳障、横穿、拾取与结束优先级不能因新会话/表现变化重复奖励。
- 随机正式局与固定种子重放明确区分；固定教学布局与来源 course.json 不被原地污染。
- localStorage 损坏、禁用或写失败不阻止开局；设置和当前画质、声音一致。
- 原生形体修改后坐/站/跳/Q及暂停净空、骨段、相机与皮肤连续性保持。
- 资产重建因条件跳过、失败、取消与路径列表差异必须正确传到始终生成的合并门禁。

## Task 1: 基线与资产准入核查

**Files:** docs/banana-audit-20261028.md；assets/reference/style-a-2026-10-28.png；artifacts/audit-20261028/。
**Interfaces:** 复用正式入口与现有 QA 脚本，输出版本、截图和明确缺口。
- [x] 创建并使用隔离 worktree，安装锁定依赖。
- [x] 基线94/94规则/资产/物理等单元测试通过。
- [x] 当前构建、资产校验、真实入口及代表视觉截图；历史基线图保留在verification/next-game.png。
- [x] 按技能阶段记录需求→资产→实现→证据，不把历史未完成项照抄成当前缺陷。

## Task 2: 会话、操控边界与高速度规则

**Files:** src/game.ts、src/main.js、src/session.js（如确有需要）、index.html、对应 tests。
**Interfaces:** createGame/advance 与现有 view 不变；会话通过 course 副本传入可记录种子。
- [x] 先用生产规则复现并测试确认的碰撞/跳障/暂停边界缺陷。
- [x] 正式局新种子、显式 ?seed 重放；种子结果可查，教学保持可学。
- [x] 画质与音效偏好持久化，损坏/禁用存储可正常开局；保留 URL 画质优先级。
- [x] 必要 RED→GREEN 回归、全套测试及真实输入验证。

## Task 3: 资产门禁与可编辑源保护

**Files:** .github/workflows/assets.yml、scripts/asset-change-scope.mjs 或等价最小工具、scripts/test-blender.py、scripts/export-saved-assets.py（按核查决定）、tests。
**Interfaces:** 合并总检查每个 PR 产生结果；原生重建只在资产变更时运行；失败/取消不放行。
- [x] 先测路径分类、失败/取消和普通代码 PR 的门禁结果。
- [x] 增加始终报告的资产总检查，保留严格指纹与官方 Blender 平台校验。
- [x] 审计保存源→导出链；只读验证和显式重导均不覆盖保存源，已用真实皮肤/纹理/16Actions夹具复验。
- [x] 不更新远端保护规则，交付所需新增必需检查名称及有效验证范围。

## Task 4: Blender 美术与 Three.js 整合

**Files:** scripts/banana-tripo/、scripts/export-saved-assets.py、src/view.js、src/reference.css；相应 .blend /规范导出/压缩导出/元数据。
**Interfaces:** 迁移到真实65骨与新车接触标记；course采样/道路护栏受保护指纹不变，货架使用新作者矩阵；材质/实例/LOD和相机使用已有接口。
- [x] 对照新附图与基线，记录人物、香蕉、海湾、远山、岩壁的具体差异。
- [x] 使用 Imagegen 单体参考→Tripo 重建全部资产类别，先核验角色/自行车/蕉束/卡车样本，再批量；Blender统一尺寸/材质/动作/性能预算并替换所有运行资产。
- [x] 打开代表弯道海湾视线、调整远山层次/聚落可读性和岩块色面；不破坏路面支撑。
- [x] 按需要增加成本可控的主体描边/色彩和效果节奏，继续使用实例化和原生模型。
- [x] 重建/源检查、导出、无损压缩、指纹及动作/净空/取景检查；同机位改前后证据。

## Task 5: 完整回归与可玩交付

**Files:** docs/banana-audit-20261028.md、README.md、docs/endless-design.md、docs/riding-poses.md、docs/BLOCKERS.md、verification/audit-20261028/。
**Interfaces:** 源码、模型与实际 HTTP 构建同版本；已有其他游戏不受影响。
- [x] 更新过期41模型/对象关节说法与明确源/生成器权威。
- [x] 全套测试、类型检查、生产构建、资产检查、桌面与真实持续触控流程、坐站/跳/Q/E/暂停/结束/重开。
- [x] 最高速度段、资源回收/上下文恢复、长数字 HUD、冷启动和实时时钟性能抽测；夹具和硬件范围写清。
- [x] 一次独立全分支审查，修复重要发现并复验影响范围。
- [x] 留下可恢复代码/源/构建、可玩入口和详细报告；可用与美术/真机未验项分别交付。

## Decisions / progress

- Ruling: 现有设计与本轮 game-development 明确授权连续实现，复用已选方向，不重新做选型/逐阶段审批。
- Ruling: 新工作区从 main 创建，既有其他游戏工作保留；preview 使用5183/4183避免占用原5173。
- Ruling: 本轮不新增联网排名/商业化/完整轮胎物理，当前用户核心要求为无尽骑行及视觉和技术完善。

- Scope update: 用户要求整套资产重制与替换，明确使用Tripo，原本局部精修不再构成本轮视觉交付。
- Budget approval: 用户原话“不限制，用就行”；可使用现有Tripo积分，当前开工余额25175，不购买订阅/新积分包；逐任务记录显示成本与实际余额变动。
- Ruling: Task2高速度扫掠跳障丢奖复现，保留空中安全接触再在完全通过时发一次奖；新种子复制course顶层，不深拷贝不可变points/road。

- Model lock: Tripo Studio 当前列表H3.1最高质量/H3.0快速均衡/H2.5经典，已明确选择H3.1最高质量；不因快或便宜切低档。
- Sources complete: 29类母版均已实际下载并校验GLB长度与SHA；生成1885积分、主角重拓扑40/绑定20，实际总1945，余额23230。复用母版，本地优化追加0积分。
- Tier decision: 后续主体Ultra4K/PBR、复杂环境Ultra2K/baseColor、简单远景标准2K/baseColor，均H3.1；这次已生成8K母版不重复生成，运行时分别2K/1K/512与真实几何LOD。
- Native safety: 原始8K母版保留本地，不塞入Git；仓库保存可编辑且已打包纹理的Blender源、任务地址/hash账本与规范/压缩导出。

## 最终验收边界

- 本地149项测试、最终生产构建、60资产/62指纹、保存源只读重导、真实输入和完整动作通过；详细记录见docs/banana-audit-20261028.md。
- 游戏可玩交付完成；美术并非逐像素图A复刻。原蓝山像素门槛22/27过、5/27未过；四个极端竖屏边缘人物大小按已审看17%例外，严格18%未过。两项均如实保留，不计作原门槛全部通过。
- M6真实时钟高低各90秒（满货/最高速/6次Q）约120FPS，全部长帧保留；中端显卡和手机真机仍未测。
- 后续使用已生成母版与本地精修，本轮整合新增0积分；累计1945。
