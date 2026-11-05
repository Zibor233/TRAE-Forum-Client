# 0.1.0Beta

TRAE社区第三方客户端（TRAE Forum Client）首个公开测试版，MIT 开源。

- 优化页面切换动画，切换内容时平滑淡入。
- 优化卡片入场动画，新增内容轻微上浮、依次显示。
- 优化图片加载动画，增加加载提示及图片淡入效果。
- 优化话题详情弹层动画。
- 优化桌面标题栏，默认隐藏菜单栏，保留窗口拖动和控制按钮。
- 优化分类导航，简化视觉样式，将标签与排序整合到筛选入口。
- 支持系统减少动态效果设置。

## 下载选择

| 系统 | 文件 |
| --- | --- |
| Windows x64 | win-x64.exe 安装版 / win-x64-portable.exe 便携版 |
| macOS Intel | mac-x64.dmg / zip |
| macOS Apple Silicon（M 系列） | mac-arm64.dmg / zip |
| Linux x64 | linux-x64.deb / AppImage / tar.gz |
| Linux ARM64（麒麟 V10 适配目标） | linux-arm64.deb / AppImage / tar.gz |

包内版本号为 `0.1.0-beta.1`，发布名称为 `0.1.0Beta`。`SHA256SUMS.txt` 提供文件校验值。

Windows 包未签名，macOS 包未签名及公证。Linux ARM64 已提供构建；麒麟 V10 的不同 SP 与驱动环境仍需目标机器实测，不能视为已通过国产系统认证。Linux 使用图形桌面环境，优先选择系统支持的 DEB 或 tar.gz。

客户端使用官方 User API Key 授权，密钥保存在本机。测试版遇到问题请提交 Issue，勿附上密钥或授权 payload。

作者：[@小博同学](https://forum.trae.cn/u/%E5%B0%8F%E5%8D%9A%E5%90%8C%E5%AD%A6)。本项目为社区第三方客户端，与 TRAE 官方无隶属关系。
