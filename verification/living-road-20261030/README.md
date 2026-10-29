# 动态山路与玩法节奏：验证记录

基线 main `8443911a67880cb88b9612538c10c7101efbacdc`。改动说明见 [本轮报告](../../docs/living-road-20261030.md)，运行代码、构建哈希和环境见 [environment.json](environment.json)。没有新增生成费用、依赖或模型文件。

| 证据 | 验证内容与边界 |
|---|---|
| `tests.log` / `build.log` / `assets.log` / `fingerprints.log` | 180项自动测试、类型检查与生产构建、60运行资产及62保存源/运行文件指纹。Vite的大分块提示仍保留 |
| [browser.json](browser.json) | 1280×720、390×844、740×390，真实键盘和持续触控，动物移动/停止、起步与换侧、Q过渡、冷却、目标、暂停、重开及HUD。时钟加速、显式交通夹具，仅证明功能 |
| [camera.json](camera.json) | 24坐姿＋4站姿案例、1232个实际飞行采样；原生顶点检查人物/车/香蕉/卡车完整入镜、两轮可辨和真实中途暂停。4个极端左边缘坐姿案例沿用17%主体高度例外，其余要求18%。完整记录与连续镜头帧样本以gzip无损保存 |
| [course.json](course.json) / [shoulder-course.json](shoulder-course.json) | 36个常规窗口＋10个路肩变化窗口，含最高加速速度，无跳跃/Q/盾/无敌的连续转向搜索及生产重放。保留输入序列；有限局部存在性检查，不证明每种入口、无限种子或真人难度 |
| [gameplay.json](gameplay.json) | 最终生成规则下的实际键盘自动游玩，3602.78m、203蕉、4踢车、6目标、7险避；三道具、坐站、跳跃、E、暂停、主动/碰撞结束与重开。虚拟时钟，不作为FPS数据 |
| [autoplay-diagnosis.json](autoplay-diagnosis.json) | 测试驾驶器在3294m误判列车外侧余量；以实际生产规则连续左转确认可安全通过。只调整测试驾驶器余量，未放宽游戏碰撞 |
| [smoke.json](smoke.json) / [context.json](context.json) | 桌面键盘与360px持续触控、取消/混合输入、暂停零新增绘制及resize；首次技能零新增色彩program和零首次uniform/attribute查询；上下文丢失恢复 |
| [performance.json](performance.json) | 最终构建，Apple M6 / Chrome156，有头、1920×1080、DPR1，高低两档各60秒完整真实rAF。100蕉、最高速、6次真实Q、护盾/重置冷却/禁用交通是压力夹具。保留完整帧时gzip、最差帧及全部慢帧数量，不代表自然成绩或中端/手机性能 |
| [performance-initial.json](performance-initial.json) / [performance-repeat.json](performance-repeat.json) | 同一渲染实现较早的两档采样及针对低档长帧的复查。保留首次低档61.1ms非踢车长帧，复查未重现；不同刷新调度结果不能选择性当性能提升 |
| [performance-main-comparison.json](performance-main-comparison.json) / [performance-current-comparison.json](performance-current-comparison.json) | 帧率下降后，同依赖/资产顺序对照main与新版，高档各60秒；50.9/48.3FPS。未证明稳定60或性能提升；基线未预压缩，加载时间/字节不能横向比较 |
| [review.json](review.json) / [cleanup.json](cleanup.json) | 独立只读评审及关闭项；本次文件清理的路径、哈希和保留范围 |

飞踢/连续表现/上下文检查在最后追加路肩障碍之前完成，之后相机、渲染和输入代码未变；这些夹具禁用程序生成。完整玩法、冒烟及最终性能在路肩改动后执行。最终测试脚本和源文件SHA256保存在环境记录，不依靠当前分支名判断版本。

## 复现

使用Node24与项目锁定的pnpm；浏览器脚本需要可用的Playwright和Chrome。若Playwright不在本地依赖路径，设置 `PLAYWRIGHT_MODULE` 为已安装模块的入口。按顺序运行GPU测试，不并行争用显卡。

```sh
pnpm test
pnpm build
pnpm check:assets
pnpm assets:fingerprint
pnpm preview --port 4183
```

另一终端执行以下命令，输出到专用测试目录；服务留给试玩。

```sh
export GAME_URL='http://127.0.0.1:4183/?seed=2817'
COURSE_REPORT=artifacts/living-road/course.json pnpm check:course
CHECK_DIR=artifacts/living-road/functional node scripts/living-road-check.mjs
KICK_CAMERA_LAYOUTS='left:0:-2.6:-1,right:0:2.6:1,edge-left:-4.6:-2.4:1,edge-right:4.6:2.4:-1' SHOT_DIR=artifacts/living-road/camera node scripts/kick-camera-check.mjs
KICK_CAMERA_STANCE=standing KICK_CAMERA_SIZES='390x844,360x780' KICK_CAMERA_MOTION=normal KICK_CAMERA_LAYOUTS='edge-left:-4.6:-2.4:1,edge-right:4.6:2.4:-1' SHOT_DIR=artifacts/living-road/standing node scripts/kick-camera-check.mjs
CHECK_DIR=artifacts/living-road/autoplay node scripts/browser-check.mjs
SHOT_DIR=artifacts/living-road/smoke pnpm smoke
node scripts/context-check.mjs
HEADED=1 PERF_SECONDS=60 PERF_KICKS=6 PERF_REPORT=artifacts/living-road/performance.json pnpm perf
```

两条镜头命令分别还原24组坐姿与4组站姿检查。路线报告记录了额外10组的种子、入口和全部输入，可用 `scripts/check-course.mjs` 导出的 `replaySteeringRoute` 逐组重放。

代表截图是实际游戏渲染：[移动动物](desktop-walking.png)、[矮屏目标HUD](short-height-goal.png)、[竖屏飞踢](portrait-kick.png)、[自然长局](endless-running.png)。已提炼的重复截图与中间日志按清理账目删除；源模型、正式资源、历史验证和共享依赖缓存保留。
