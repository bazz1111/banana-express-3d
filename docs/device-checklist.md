# 设备验收清单

每个报告对应真实硬件、实际浏览器及完整自然跑局。Linux CI 的软件 WebGL 冒烟只验证载入、流程和触控回归，不能作为 GPU 性能或手机兼容性通过证据。WebGL2 不可用时，冒烟必须记录 `skipped` 及原因，不能写 `passed`。

| 平台 | 浏览器 | 设备 / GPU | 输入 | 级别 | 验收状态 |
|---|---|---|---|---|---|
| Windows 11 | Chrome 稳定版 | GTX 1650 | 键盘 | P0 | 待真机 |
| Windows 11 | Edge 稳定版 | Intel Iris Xe | 键盘 | P0 | 待真机 |
| Windows 11 | Firefox 稳定版 | GTX 1650 / Iris Xe | 键盘 | P1 | 待真机 |
| macOS 14+ | Safari 17+ | Apple M1 | 键盘、触控板 | P0 | 待真机 |
| macOS | Chrome | Apple M1 | 键盘 | P1 | 待真机 |
| iOS 17+ | Safari | iPhone 12 级 | 触控，竖屏和横屏 | P0 | 待真机 |
| Android 13+ | Chrome | Adreno 6xx / Mali-G7x 级 | 触控 | P0 | 待真机 |
| iPadOS | Safari | A13+ iPad | 触控 | P1 | 待真机 |
| ChromeOS / 低端笔记本 | Chrome | UHD 600 级 | 键盘，低画质 | P1 | 待真机 |

验收者逐项记录 `pass`、`fail` 或 `pending`，失败附复现和截图；P0 发布门槛要求所有项目通过且报告来自当前提交。

- [ ] 载入成功，无错误面板。WebGL2 不可用时显示可理解的错误。
- [ ] 开始、倒计时、骑行、结束、重开；A/D 或触控左右、跳跃、Q 点按及蓄力、E 冲刺、C 姿态、Esc 暂停全部可用。
- [ ] 首次点击后有声；切到后台暂停且声音停止；回来仍需正确恢复。
- [ ] 旋转屏幕和调整窗口后 HUD 无溢出，触控按钮可点击。
- [ ] 模拟 `WEBGL_lose_context` 后正确恢复或提示，状态不损坏。
- [ ] 自然骑行至少 60 秒，记录 `perf()` 的帧时 p50 / p95（毫秒）、帧数、分辨率、画质及真实 GPU renderer。
- [ ] 低端设备持续慢帧约 240 帧后自动降级并显示提示；非低端也记录是否触发。
- [ ] 左右踢车、暂停/恢复、重开后动画和声音正常，货量超过 100 后继续计分。

将 JSON 保存到 `verification/devices/<平台>-<浏览器>-<设备>.json`。复制以下结构并填写实测值，`null` 和 `pending` 不视为通过：

```json
{
  "commit": "填写 Git SHA",
  "testedAt": "填写 ISO 时间",
  "platform": "操作系统和版本",
  "browser": "浏览器和版本",
  "device": "设备型号",
  "gpu": "真实 GPU renderer",
  "viewport": {"width": null, "height": null, "dpr": null},
  "input": "keyboard|touch",
  "orientation": ["portrait", "landscape"],
  "tier": "P0",
  "status": "pending",
  "checks": {
    "load": "pending", "controls": "pending", "audioBackground": "pending",
    "resizeHUD": "pending", "contextRecovery": "pending",
    "naturalRide60s": "pending", "qualityDowngrade": "pending",
    "kickPauseRestart": "pending"
  },
  "performance": {"seconds": null, "frames": null, "p50Ms": null, "p95Ms": null, "quality": null},
  "issues": [],
  "evidence": []
}
```

当前未启用收费的真机云服务。P1 已知问题写入报告 `issues`；P0 未完成时保留“待真机”状态。

## 资产交付验证

Blender 导出规范文件到 `assets/export/`。执行 `pnpm check:assets`、`pnpm assets:fingerprint`、`pnpm assets:compress`、`pnpm build`。更新建模内容后，确认审查结果，再用 `pnpm assets:fingerprint:update` 更新指纹；不要为了绕过 CI 差异直接更新夹具。

所有资产采用无损 Meshopt，逐顶点顺序、索引、颜色、法线、矩阵、extras、内嵌图片、动画与蒙皮均保持原值。KTX2 和量化仍延后。构建会用 Node 标准 `zlib` 生成 `.glb`、`.json`、`.js`、`.css` 和音频的 `.br` / `.gz` 文件，只有节省至少 5% 且 128 字节才保留。`pnpm preview` 现在使用 `scripts/serve.mjs`，按 `Accept-Encoding` 协商压缩，GLB 使用 `model/gltf-binary`；还支持 ETag、HEAD 和音频/资产的字节范围。默认只绑定 `127.0.0.1:4173`，可指定 `--host`、`--port`，端口占用会失败。服务仅开放 `dist/`，缺失资产返回 404。`deploy/nginx.conf` 是外部部署示例，使用 [Nginx 官方 gzip 规则](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)；预压缩静态 gzip 需要其[可选模块](https://nginx.org/en/docs/http/ngx_http_gzip_static_module.html)，未宣称该示例已经部署。

固定版本和校验和来源：[Blender 5.2 官方目录](https://download.blender.org/release/Blender5.2/)与 [5.2.2 SHA256](https://download.blender.org/release/Blender5.2/blender-5.2.2.sha256)。编码格式依据 [Khronos Meshopt 规范](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_meshopt_compression)。

## 性能报告范围

`pnpm perf` 默认每档画质预热 5 秒，再连续采样 60 秒。`PERF_SECONDS`、`PERF_WARMUP_SECONDS`、`PERF_REPEATS`、`PERF_SIZE` 和 `PERF_REPORT` 可调整范围。报告保存整个测量窗口的 rAF 时间、阴影等全部 WebGL 绘制调用和实例三角形数、实际 GPU renderer、浏览器与系统信息，以及网络编码/解码字节数。长停顿计入分位数，不使用应用内 600 帧滚动窗口替代整段测量。

该脚本持续刷新护盾以保证采样，报告明确标记 `naturalGameplay: false`；它不能替代自然跑局或目标设备验收。Apple M6 实测只属于该机器，不能用于填写 GTX 1650 或 Iris Xe 的验收格。
