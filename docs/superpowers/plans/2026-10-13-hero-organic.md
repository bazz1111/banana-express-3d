# 图 A 香蕉果实与自然货堆改进

> REQUIRED SUB-SKILL: superpowers:executing-plans，当前会话直接实施，最终一次 fresh-context 只读复核。

沿用已授权的完整图 A 高保真目标、无尽规则、本地 Blender 全模型制作和默认坐姿/C 或按钮切站姿。上一目标轮为进展：远坡布景和最终生产验证完成；整体画面仍未达到严格 1:1。

本轮继续现有主角美术计划的未完成项。实际当前图中，同形扇状蕉束反复叠加，黄色环圈过于密集；A 中果实有较宽的纵向折面、弯曲和饱满的尖端，货堆的蕉束朝向不规则，外层明显下垂。目标是修改真实原生几何和作者布局，提高这些轮廓的可读性，保留骑手背部、头部、两轮与车架构图。

技术与接口：仅修改 scripts/build-assets.py 中 banana()/cargo()，继续导出 banana、looseBanana、bananaRack 三个 GLB；20 个 CargoBundle 仍共享唯一五蕉网格和原生作者矩阵。单蕉为同一造型语言的独立模型。沿用标准 COLOR_0、顶点 AO 与 Three.js InstancedMesh，不改镜头、玩法、UI、道路、场景和输入。可编辑四个 .blend 和运行导出都需更新。

## Tasks

- [x] 保存前资产/源码/画面并读取实际状态；核对图 A 和现有蕉束形状。
- [x] 本地 Blender 调整弯曲、五棱折面、连接蒂和不规则分层货堆；逐次看实际代表画面，不以网格数量证明视觉还原。
- [x] 原生货架接触、坐站/9 动作、当前源和全部导出 COLOR_0/AO 验证；其余 38 GLB 的解码渲染数据、course 字节及 9 源码文件不变。
- [x] 最终生产 58 tests/tsc/build、英雄完整动作及横竖屏输入、骑姿恢复/触控/上下文恢复、百万米稳定与自然拾取完整跑局。已有未改环境由实际非修改证据覆盖，必要时扩大检查。
- [x] 一次 fresh-context 只读最终复核，发现问题一次修复；保存当版证据和指纹，整图目标保持 active，除非完整客观验收证明完成。

## Ledger

Pre-flight: 检索全部实际调用后确认 banana()/banana(1) 仅生成 banana/looseBanana，cargo 共享 banana 数据；卡车及摊位货物有独立几何。预期只有这三个 GLB 渲染数据改变，其余38个逐项解码比较。货堆原生布局被 Three.js 直接消费，不能在引擎里重新摆造型。

Ruling: 本轮是已授权主角美术的延续，沿用图 A 和既有交互，不重复设计批准。可逆几何/颜色修改以实际前后画面、原生结构/接触和已有动态验证验收，不增加只检查设计常数或源码文本的测试。功能变化若有则先写真实失败测试。整体 1:1 与中端设备 60FPS 仍待完整证据。

Task1 baseline: 已保存43实际资产、生成器、view源码和自然拾取截图。开发服务PID49690经实际进程核实存活；另用真实GLTFLoader/Three.js渲染5/100根货量夹具，hero-organic-before-{first,full}.png。原图与满载图对照显示重复扇圈，本次视觉缺口实际可见；夹具货量不是玩家成绩，截图HUD来自前一RAF。

Task1 first: 本地Blender第一版完整重建exit0、四源保存。13纵环/五宽折面/较暖果色与20共享布置，原生接触、源/导出颜色及38非修改GLB解码检查均exit0。实际hero-organic-first-full.png仍出现大扇状开张和中央空洞，所以结构通过不代表视觉通过，继续调整束内间距和货架底层。

Ruling: 不新增模型加载或Three.js网格，二版在同一香蕉数据中收紧五指、加厚果腹；第一层三束平放并以真实 rack BVH 校正接触，其余束以小倾角交错，保留外侧四束下垂。成本：更紧密的几何可能局部互相遮挡，须实际满载与两骑姿/飞踢画面核对。38其他GLB、9源文件及既有动作不改。

Task1 second verified: 二版完整本地Blender重建exit0、四可编辑源保存；1532面五蕉束/332面单蕉，20货堆实例共享一份几何。现有原生英雄检查通过，首束真实货架距离0.4453mm，GLB矩阵最大误差约3.52微米。全部41导出标准COLOR0逐三角形匹配源（375488顶点/161465面），131当前AO网格/9原生姿态不变。38非修改GLB位置/法线/颜色/UV/材质/内嵌图片/实例矩阵/有向三角形集合通过，course字节和9生产源码SHA不变。8个桌面/390px少量/满载/站姿/飞踢真实渲染夹具0页面错误；人工对照A，二版堆叠更紧密、外侧下垂并露出背部和车架，但未声称达到整图1:1。58规则/物理/动作测试和tsc/资产检查exit0。

Task2 production: 构建完成，dist25511768字节（25.51MB）、GLB20410276字节（20.41MB），bundle仍index-C_YyJ7o2.js；Vite大包提示保留。hero/riding/fidelity/context/lighting/streaming及随后独占browser实际exit0。24满载姿态、24真实输入、24完整Q窗口1368帧通过，最差闪光边距7.61764px。390px长数字/触控、坐站连续性/恢复、WebGL恢复及预热20种路段后的百万米GPU132几何/6纹理稳定。距百万米仍是注入夹具。源码及38非修改模板实际一致，未重复改造路段/环境或降低旧画面门槛；本轮没有把旧27环境报告冒称重新跑过。

Ruling: 无Git/.superpowers工作区，沿用现有独立项目目录与已保存生成器/43资产快照作为评审差异基准，保留plan ledger与原始报告，不虚构commit或删除唯一记录。成本：无Git历史，回退依赖实际保存文件及本地重建。

Final review: 唯一fresh-context只读复核，无Critical/Minor。重要残余为坐姿CargoBundle09穿人物StandingBody，实际43三角形相交；同姿态旧货堆168，改善但没有消除。站姿包括两鞋0相交。源码差异限定banana/cargo，实际服务HTML/JS/CSS/三GLB与dist匹配，9源码SHA不变、共享COLOR0/作者矩阵最大误差2.91e-8，真实C/跳跃恢复通过。图A对照确认更紧密/低矮/少重复圈/背部更露出，整体严格1:1仍Important未完成。reviewer全部Chrome关闭。

Final RED: 根新增实际GLTFLoader/Three.js世界坐标三角形双向边相交检查，6个满载坐/站/跳顶/踢击姿态；生产旧版exit1，坐姿普通/跳顶/踢击均为Bundle09相交44～45对，站姿0，0页面错误。不是源码文本或造型常数测试。原红日志hero-organic-clearance-red.log和cargo-clearance-organic-red.json保留。

Final fix pass: Bundle09原生作者Y向后移200mm，不改其他19束/共享几何/镜头/关节/玩法。必须当前本地重建、同一相交检查GREEN、已有完整套件GREEN、实际图核对；无二次review。

Final: Ruling: reviewer未判断目标硬件60FPS、全部动画中间态的完整身体净空、每个果实/蒂的严谨流形连接 — 保留为未证明，不用6姿态或目视外观代替全称保证。坐/站/跳/Q主体已有完整入镜/输入检查；流形模型对当前渲染并无封闭体积物理需求，后续如加货物物理必须进一步核验。成本：未覆盖姿态或更严格实体网格要求仍可能发现新缺口，原整体目标保持active。

Final fix verified: 完整本地Blender第三版重建exit0，原生接触/当前源COLOR0/AO与38不变项再验exit0；同一6姿态三角形相交测试GREEN，全部0相交，0页面错误。58tests、资源、build及生产hero/riding/fidelity/context/lighting/streaming/browser全部实际exit0，24完整Q窗口1368帧仍通过。前fix的23日志/报告/跑图已存hero-organic-before-clearance-fix，唯一review针对fix前版本，fix后由根独立RED→GREEN及全回归验证，没有二次review。最终单独真实键盘自动跑局2502.2083m、128香蕉、4958.14分、153.9833s、2重卡动态起飞，三道具/跳障/坐站/暂停/主动与碰撞结束/重开均通过；0页面/资源错误，整帧峰值153调用/2595965面。132几何/6纹理保持稳定；约25.51MB dist与20.41MB GLB。中端硬件60FPS和整体1:1仍未证明。

用户本轮指出“为什么停滞了”：当前确有生产检查活跃cell608，并继续同一handle至8项全部exit0，没有重启。推进慢的实际表现是三次香蕉美术重建和最后穿插修正，局部变化远小于整场景差距；已在commentary说明并承诺下一轮优先处理岩壁、远景和人物质感，减少过细迭代。原整体目标不能由局部通过代替。

Goal state correction: 随后实际get_goal返回status=blocked，updatedAt=1791872252，接口没有阻塞原因；此前“active”是执行意图/旧上下文，不能代表当前系统状态。本轮没有调用update_goal设置阻塞，也没有技术阻止继续实现的条件。已据真实返回更正fingerprint，完整目标仍未达成；现有工具没有resume操作，只能由用户/系统恢复，官方文档命令为 `/goal resume`。最终dev5173与新bananaRack的HTTP字节验证正常，所有Chrome关闭，临时preview4173已关闭。
