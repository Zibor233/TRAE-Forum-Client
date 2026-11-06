# 0.1.1Beta

- 软件安装名称、快捷方式和窗口标题统一为“TRAE社区”，优化品牌标识及应用图标。
- 优化全宽自适应布局、侧栏字号、瀑布流列数和卡片间距。
- 新增通知一键已读，同步论坛未读状态。
- 新增文章详情和首页卡片收藏按钮，支持收藏、取消收藏和状态联动。
- 优化图片清晰度，优先加载原图；点击正文图片同步切换左侧大图。
- 优化自己的帖子和评论的点赞交互，点击查看点赞列表，无赞时隐藏图标。
- 修复点赞用户浮层定位偏移、收藏错误提示被遮挡的问题。
- 移除未开放的设置入口，新增手动检测更新，保留后台更新提示。
- 改善麒麟 V10 SP1 ARM64 启动兼容性，无 DRI 且有 XWayland 时自动回退 X11，增加窗口显示兜底。
- 内置离线 emoji 字体，补齐 Linux 标准多尺寸图标、窗口关联及图标缓存刷新。

## 下载选择

| 系统 | 文件 |
| --- | --- |
| Windows x64 | win-x64.exe 安装版 / win-x64-portable.exe 便携版 |
| macOS Intel | mac-x64.dmg / zip |
| macOS Apple Silicon（M 系列） | mac-arm64.dmg / zip |
| Linux x64 | linux-x64.deb / AppImage / tar.gz |
| Linux ARM64（麒麟 V10 适配目标） | linux-arm64.deb / AppImage / tar.gz |

包内版本号为 `0.1.1-beta.1`，发布名称为 `0.1.1Beta`。`SHA256SUMS.txt` 提供文件校验值。

Windows 包未签名，macOS 包未签名及公证。Linux ARM64 已提供构建；麒麟 V10 的不同 SP 与驱动环境仍需目标机器实测，不能视为已通过国产系统认证。Linux 使用图形桌面环境，优先选择系统支持的 DEB 或 tar.gz。

客户端使用官方 User API Key 授权，密钥保存在本机。测试版遇到问题请提交 Issue，勿附上密钥或授权 payload。

作者：[@小博同学](https://forum.trae.cn/u/%E5%B0%8F%E5%8D%9A%E5%90%8C%E5%AD%A6)。本项目为社区第三方客户端，与 TRAE 官方无隶属关系。
