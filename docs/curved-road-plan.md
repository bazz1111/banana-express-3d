# 连续下坡山路，2026-10-13

上一目标轮是进展：新增 Blender 河谷与滚动视差、改 HUD、修正主光并验证生产跑局。本轮对照图 A 的弯折下坡，保留最新无尽规则、连续横移和骑姿切换。

路线由 Blender 作者化：1600 m 周期，2 m 采样，坡度 y=-0.04s；朝向为 `0.9*sin(2πs/800)+0.15*sin(2πs/400)`，按弧长积分 x/z。生成并导出 20 个 80 m 真弯路模块、分段柏油/标线/石栏、路侧地形及真实路边对象布局；Three.js 不生成道路网格。

course.json 新增 `points`（s,x,y,z,yaw）、`step:2`、`road:{period:1600,advance:{x,y,z}}`。无尽周期延伸，与规则的 s/lane 相互独立；姿态和障碍只按同一条作者路线显示。

局部世界：以当前路线中心为原点，并旋转到骑手当前朝向。`roadPosition(course,s,lane,lift,origin)` 和 `roadQuaternion(course,s,origin)` 共用于模型和物理。绝对作者模型用 `framePosition(course,xyz,origin)` 转换；区块周期位移后再转换。动态车辆随原点变化重定位/转向，线速度及角速度只旋转，保持真正 Rapier 飞行。

物理导入 20×3 原生网格表面，两个固定根刚体重复这些碰撞形状；每帧按周期/局部原点直接变换固定根，不让原点重定位产生地面运动冲量。无路表数据的测试夹具保持原来的直路行为。

- [x] 路线函数/姿态/周期/重定位测试先失败后通过；保留全部旧规则。
- [x] Blender 源、柏油 UV、接缝、脚轮接地、路边/基础实际地形支撑与布局。
- [x] 8 个渲染路段复用源几何、物件/拾取/粒子/相机坐标统一；物理路面和模型一致。
- [x] 原型画面、完整跑局/技能/暂停/重开、百万米、WebGL 和绘制/资源预算；中端硬件 60FPS 与整图 1:1 仍未验收。

技术合同：route.ts 导出 roadAt、roadPosition、roadQuaternion、framePosition、frameQuaternion、cyclePosition、rebasePosition、rebaseVector、rebaseQuaternion；均为普通 XYZ/XYZW 数据，不依赖 Three.js。RoadPoint.yaw 可选以保持旧夹具。CollisionSurface 新增可选 segment，用于作者道路；未带 segment 的旧平面不受周期变换。源与输出：assets/blender/endless-course.blend、public/assets/roadCourse.glb、public/assets/course.json。

结果：57 项规则/路线/物理/动作测试、tsc、生产构建、原生 Blender 和真实导入检查通过。独立复核修正悬空岩壁（封底并埋入150mm）和逆向车释放180°掉头（车身朝向与踢击道路方向分别保存）。实际原生脚轮9576个采样最大误差约2.02mm；20段网格接缝为0。河谷跟随同一64m周期下降，避免背景接缝。图A地貌对应河谷左侧/红岩上坡右侧。

生产 Chrome 真实键盘输入跑到2501.92m、144根香蕉、2辆重卡起飞，包含坐站切换/跳障/三种道具/暂停/主动与碰撞结算/重开，0页面或资源错误。整帧峰值126次GL调用、约1.35M屏幕三角面；39个GLB约12.40MB，静态dist17.49MB。百万米隔离资源检查在预热所有原生曲路形状后保持129个GPU几何、6张纹理；注入距离不代表玩家成绩。

证据见 artifacts/curved-*.log、curved-road-report.json、endless-browser-report.json、endless-streaming-report.json。整图人物占比、阴影/烘焙、轮廓、踢击镜头与原图细节仍需完善，原高保真目标保持active。
