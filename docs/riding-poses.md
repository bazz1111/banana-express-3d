# 骑姿切换：用户补充，2026-10-13

站立是人物动作之一，不应强制一直站立。默认坐姿蹬踏；C 或顶部“骑姿 · 坐姿/站姿”按钮切换。ready/countdown/racing 可切换，paused/finished 或 WebGL 中断时禁用。重开恢复默认坐姿。姿势不改变速度、左右输入、跳跃判定、奖励、道具或 Q 冷却。

规则合同新增 `GameState.stance:'seated'|'standing'`、`toggleStance(g):void`。该函数只在 ready/countdown/racing 翻转 stance；无奖励或事件。UI button `#stance`，C 非重复 keydown 调用；点击按钮后回到 canvas 焦点。paused 下输入不得排队，重开标签须复位。main debug getter照旧。

视图使用同一 Blender 对象关节网格，以 ~0.3 秒过渡坐/站；ready 预览立即切换，暂停冻结动作。坐姿双脚跟随 Crank 下的两个实际脚踏（鞋底保持水平）、躯干前倾、两手扶把；站姿双脚继续落在车把与车座，摆臂平衡。跳跃、蓄力和飞踢叠加在当前骑姿上，不修改逻辑结果。

Blender 新增可动 Elbow_L/R、Hand_L/R，与现有 Arm、Leg/Knee/Foot 层级一起提供对象关节；保存同场自行车与角色的坐姿踩踏、切换、站立、跳跃/落地、飞踢动作时间轴。不引入外部模型或下载动画。

验收：规则默认/切换/暂停禁用/重开；实际 GLB 坐姿脚踏与手把接触、站姿脚底支撑、过渡可达；真实 C 和按钮、触控窄屏、暂停与重开；完整无尽回归。美术材质改进仍接续执行，不恢复装货/配送。

完成证据：43 项规则/物理/视图测试、tsc 和生产构建通过。实际 Chrome 中默认坐姿、C/按钮双向切换、过渡、暂停禁用和重开复位通过；390 px 窄屏骑姿按钮可见且可操作。Q 动作从本帧腿部姿态混合并缓动，蓄力首帧脚部移动 15.1 mm、释放首帧 19.0 mm（含脚踏运动），随后恢复脚踏接触。独立复核关闭了旧站姿 rest 导致的瞬移问题。

本地 Blender 动作源逐帧检查了坐姿五个踩踏关键帧的手把/脚踏接触，以及第 48 帧站姿支撑；Crank/Pedal 明确使用 XYZ 旋转模式，确保 Blender 时间轴实际生效。运行时仍采用对象关节 IK，未宣称有 Rigify 或 GLB 动画播放。

生产版真实键盘跑局在 450 m 后切站姿、900 m 后切回坐姿，持续到 2501 m、拾取 164 根香蕉、踢飞 2 辆重卡，完成跳跃、三种道具、暂停、主动结束、碰撞结束和重开，0 浏览器/资源错误。另通过 WebGL 冻结恢复和百万米资源窗口检查。原始记录为 artifacts/riding-browser.log、riding-fidelity.log、riding-context.log、riding-endless-browser.log、riding-report.json、riding-art-blender.log；截图为 riding-seated.png 和 riding-standing.png。
