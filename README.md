# 一键清理助手（macOS / Windows）

扫描并清理缓存、日志、浏览器、AI 工具、开发工具、设计/聊天软件的占用空间。每一项都实测大小，点击可展开目录逐层查看。

## 功能
- **一键清理**：只默认勾选「可清理」（可自动重建的缓存）。「谨慎」需要手动勾选；「建议保留」「手动检查」只展示，绝不会被一键清理。
- **实测占用**：macOS 用 `du`（实际磁盘块），Windows 逐文件统计。
- **目录浏览**：点任意项展开，按大小排序、逐层进入，单个文件/文件夹可「移到废纸篓/回收站」或在 Finder/资源管理器中显示。
- **自动发现**：`~/Library/Caches` 里所有 ≥50 MiB 的应用缓存（例如 `com.hanze.spektralab`）、Application Support / Containers / AppData 里的大目录、主目录一级目录概览。
- **深度扫描**：主目录里 ≥500 MiB 的大文件，以及 node_modules、.next、target、Pods、.venv 等项目依赖/构建产物。
- **分析报告**：扫描完自动生成类似“你的 ~/.codex 总计 5.1 GiB，最大的部分是会话记录……”的摘要表格。
- **运行中检测**：相关应用还在运行时会标红提醒先退出。
- **系统工具**：mac：brew cleanup、删除不可用模拟器、Docker prune、Time Machine 本地快照、完全磁盘访问权限；Windows：磁盘清理、DISM 组件清理、传递优化、关闭休眠等（原 Windows 清理助手的项目都合并在“系统”分类里：%TEMP%、Windows\Temp、更新缓存、Prefetch、WER、缩略图、着色器缓存、回收站……）。

覆盖的目录定义全部在 `src/targets.js`，想加新目录直接加一行。

## 打包
- **macOS DMG**（必须在 Mac 上，用到系统的 hdiutil/codesign）：`./build-mac.sh` → `dist/OneClickCleaner-1.0.0-mac-arm64.dmg`（Apple 芯片）；`./build-mac.sh all` 额外生成 Intel 版 `-x64.dmg`。
- **Windows**：在 Windows 上双击 `build-win.bat`，或在 Linux 上（需要 wine）`npm run dist:win` → 安装版 `-win-setup.exe` + 免安装版 `-win-portable.exe`。
- **GitHub Actions**：推到 GitHub 后，在 Actions 页手动运行 `build`（或推送 `v*` 标签），会同时产出 DMG 和 EXE。

## 首次打开
- **mac**：没有开发者证书签名，第一次请右键 →「打开」；若提示“已损坏”，执行 `xattr -cr /Applications/一键清理助手.app`。想统计 Safari、邮件、微信等受保护目录，在「系统工具」里授予“完全磁盘访问权限”后重新扫描。
- **Windows**：SmartScreen 提示时点「更多信息 → 仍要运行」。清理 Windows\Temp、更新缓存等系统目录需要点横幅里的「以管理员身份重新启动」。

## 开发
```
npm install
npm start
```
