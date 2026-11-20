'use strict';
// 清理目标定义。
// level:
//   safe    可清理：缓存类，可自动重建，一键清理默认勾选
//   caution 谨慎：可清理，但需要先退出相关应用 / 可能需重新下载，默认不勾选
//   keep    建议保留：用户数据（会话记录、聊天记录等），只展示和浏览
//   review  手动检查：工作成果、下载、模型等，只展示大小，请点开逐项检查
//   info    概览：仅用于统计，不参与清理
// mode:
//   contents 清空目录内的内容（保留目录本身）
//   whole    删除匹配到的路径本身（文件或目录）
// paths 支持 ~、%ENV%、以及单段通配符 *（例如 */Cache、*.dmg）

const CAT = {
  ai: 'AI 工具',
  sys: '系统',
  browser: '浏览器',
  dev: '开发工具',
  media: '设计 / 媒体',
  apps: '通讯 / 应用',
  dynCache: '应用缓存（自动发现）',
  dynBig: '大目录（自动发现）',
  home: '主目录概览',
  space: '全盘空间去向',
  vm: '虚拟机 / 模拟器 / SDK',
  media2: '照片 / 音乐 / iCloud',
};

function T(cat, name, paths, level, note, extra = {}) {
  return { cat, name, paths: Array.isArray(paths) ? paths : [paths], level, note, mode: 'contents', ...extra };
}

// ---------------------------------------------------------------- 共用（跨平台路径相同）
function common() {
  return [
    // Codex
    T(CAT.ai, 'Codex 缓存', '~/.codex/cache', 'safe', '可在退出 Codex 后清理，收益较小。', { apps: ['codex', 'Codex'] }),
    T(CAT.ai, 'Codex 临时文件', '~/.codex/.tmp', 'caution', '临时文件。等桌面和终端里的 Codex 任务都结束后再清理。', { apps: ['codex', 'Codex'] }),
    T(CAT.ai, 'Codex 日志', ['~/.codex/log', '~/.codex/logs'], 'safe', '运行日志，可清理。', { apps: ['codex', 'Codex'] }),
    T(CAT.ai, 'Codex 会话记录', ['~/.codex/sessions'], 'keep', '本地会话记录，建议保留（恢复/续聊依赖它）。可按日期目录手动删除很旧的。'),
    T(CAT.ai, 'Codex 归档会话', ['~/.codex/archived_sessions'], 'keep', '已归档会话，建议保留。'),
    T(CAT.ai, 'Codex 生成的图片', '~/.codex/generated_images', 'review', '生成的图片。点开预览，只删确认不要的图。'),
    T(CAT.ai, 'Codex 工作目录', '~/Documents/Codex', 'review', '工作成果优先检查这里：按大小排序，逐项检查旧任务里的重复导出和临时素材。'),
    // Claude Code / CLI
    T(CAT.ai, 'Claude Code 会话记录', '~/.claude/projects', 'keep', 'Claude Code 的项目会话记录（/resume 依赖），建议保留。'),
    T(CAT.ai, 'Claude Code 快照/临时', ['~/.claude/shell-snapshots', '~/.claude/todos', '~/.claude/statsig', '~/.claude/debug'], 'safe', '临时快照、调试与统计文件，可清理。'),
    T(CAT.ai, 'Claude Code 文件历史', '~/.claude/file-history', 'caution', '用于回退编辑的历史副本。不再需要回退时可清理。'),
    // Gemini / 其他 CLI
    T(CAT.ai, 'Gemini CLI 临时', '~/.gemini/tmp', 'safe', '临时文件与检查点。'),
    // 模型
    T(CAT.ai, 'Ollama 模型', '~/.ollama/models', 'review', '本地大模型文件，删除后需重新下载。建议用 `ollama rm <模型>` 删除不用的模型。'),
    T(CAT.ai, 'LM Studio 模型', ['~/.lmstudio/models', '~/.cache/lm-studio/models'], 'review', '本地模型文件，在 LM Studio 内管理更安全。'),
    T(CAT.ai, 'Hugging Face 缓存', '~/.cache/huggingface', 'caution', '模型/数据集缓存，可重新下载，但可能很大、下载很慢。'),
    T(CAT.ai, 'PyTorch / Torch Hub', '~/.cache/torch', 'caution', '模型权重缓存，可重新下载。'),
    T(CAT.ai, 'Whisper 模型', '~/.cache/whisper', 'caution', '语音模型缓存，可重新下载。'),

    // 开发工具（跨平台）
    T(CAT.dev, 'Gradle 缓存', ['~/.gradle/caches', '~/.gradle/wrapper/dists'], 'safe', '构建缓存与 wrapper，下次构建自动重新下载。', { apps: ['java', 'studio'] }),
    T(CAT.dev, 'Maven 本地仓库', '~/.m2/repository', 'caution', '依赖包，下次构建会重新下载。'),
    T(CAT.dev, 'Cargo 下载缓存', ['~/.cargo/registry/cache', '~/.cargo/registry/src', '~/.cargo/git/checkouts'], 'safe', 'Rust 依赖下载缓存，可重建。'),
    T(CAT.dev, 'Go 模块缓存', '~/go/pkg/mod', 'caution', '建议用 `go clean -modcache` 清理（文件为只读）。'),
    T(CAT.dev, 'Bun 安装缓存', '~/.bun/install/cache', 'safe', '可重建。'),
    T(CAT.dev, 'Dart / Flutter Pub 缓存', '~/.pub-cache', 'caution', 'Pub 依赖缓存，可重新下载。'),
    T(CAT.dev, 'uv / pip / pre-commit 缓存', ['~/.cache/uv', '~/.cache/pip', '~/.cache/pre-commit', '~/.cache/pypoetry'], 'safe', 'Python 包缓存，可重建。'),
    T(CAT.dev, 'Android 模拟器 (AVD)', '~/.android/avd', 'review', '模拟器镜像，建议在 Android Studio 的 Device Manager 中删除不用的。'),
    T(CAT.dev, 'Android 构建缓存', '~/.android/cache', 'safe', '可重建。'),
    T(CAT.dev, 'NuGet 包缓存', '~/.nuget/packages', 'caution', '.NET 依赖包，可用 `dotnet nuget locals all --clear`。'),
    T(CAT.dev, 'Conda 包缓存', ['~/miniconda3/pkgs', '~/anaconda3/pkgs', '~/miniforge3/pkgs', '~/opt/anaconda3/pkgs'], 'caution', '建议使用 `conda clean --all`。'),
  ];
}

// ---------------------------------------------------------------- macOS
function mac() {
  const L = '~/Library';
  const AS = `${L}/Application Support`;
  const C = `${L}/Caches`;
  const chromium = (name, base, apps) => [
    T(CAT.browser, `${name} 缓存`, [`${C}/${base}`], 'safe', '网页缓存，可重建。退出浏览器后清理更彻底。', { apps }),
    T(CAT.browser, `${name} 代码/GPU 缓存`, [`${AS}/${base}/*/Code Cache`, `${AS}/${base}/*/GPUCache`, `${AS}/${base}/*/DawnGraphiteCache`, `${AS}/${base}/*/DawnWebGPUCache`, `${AS}/${base}/GrShaderCache`, `${AS}/${base}/ShaderCache`], 'safe', 'JS 字节码和着色器缓存，可重建。', { apps }),
    T(CAT.browser, `${name} Service Worker 缓存`, [`${AS}/${base}/*/Service Worker/CacheStorage`], 'caution', '网站离线缓存，清除后部分网站需重新加载。', { apps }),
  ];
  const electronApp = (cat, name, dir, apps) => T(cat, `${name} 缓存`, [`${AS}/${dir}/Cache`, `${AS}/${dir}/Code Cache`, `${AS}/${dir}/GPUCache`, `${AS}/${dir}/CachedData`, `${AS}/${dir}/DawnGraphiteCache`, `${AS}/${dir}/DawnWebGPUCache`, `${AS}/${dir}/Service Worker/CacheStorage`], 'safe', '应用内网页缓存，可重建。退出应用后清理。', { apps });

  return [
    ...common(),
    // AI 应用
    electronApp(CAT.ai, 'Claude 桌面版', 'Claude', ['Claude']),
    T(CAT.ai, 'Claude 桌面版虚拟机镜像', [`${AS}/Claude/vm_bundles`], 'caution', 'Cowork 等功能使用的虚拟机镜像，删除后首次使用会重新下载。', { apps: ['Claude'] }),
    T(CAT.ai, 'Claude Code CLI 缓存', [`${C}/claude-cli-nodejs`], 'safe', 'CLI 日志与缓存。'),
    T(CAT.ai, 'ChatGPT 缓存', [`${C}/com.openai.chat`, `${C}/com.openai.codex`], 'safe', '应用缓存，可重建。', { apps: ['ChatGPT', 'Codex'] }),
    electronApp(CAT.ai, 'Codex 桌面版', 'Codex', ['Codex']),
    electronApp(CAT.ai, 'Cursor', 'Cursor', ['Cursor']),
    T(CAT.ai, 'Cursor 扩展安装包', [`${AS}/Cursor/CachedExtensionVSIXs`, `${AS}/Cursor/logs`], 'safe', '扩展安装包缓存与日志。', { apps: ['Cursor'] }),
    electronApp(CAT.ai, 'Windsurf', 'Windsurf', ['Windsurf']),

    // 全盘空间去向（只统计，不清理；用于解释磁盘被谁占了）
    T(CAT.space, '应用程序 /Applications', ['/Applications'], 'info', '已安装的应用。点开按大小排序，卸载不用的大应用（如旧版 Xcode、游戏）。', { space: 'data' }),
    T(CAT.space, '系统资源库 /Library', ['/Library'], 'info', '所有用户共享的资源：模拟器运行时、Logic/GarageBand 音色库、打印机驱动等。', { space: 'data' }),
    T(CAT.space, 'Homebrew / 命令行工具', ['/opt/homebrew', '/usr/local'], 'info', 'Homebrew 安装的软件。可在系统工具里运行 brew cleanup。', { space: 'data' }),
    T(CAT.space, '共享目录 /Users/Shared', ['/Users/Shared'], 'info', '所有用户共享的文件，部分软件（如 Adobe、游戏）会把数据放在这里。', { space: 'data' }),
    T(CAT.space, '系统临时与缓存 /private/var', ['/private/var/folders', '/private/var/log', '/private/var/db/diagnostics', '/private/var/tmp'], 'info', '系统级临时文件与日志，大部分需要管理员权限，重启后系统会自动清理一部分。', { space: 'data' }),

    // 虚拟机 / 模拟器 / SDK
    T(CAT.vm, 'Parallels 虚拟机', ['~/Parallels', '~/Documents/Parallels', '~/Library/Parallels'], 'review', '虚拟机磁盘。在 Parallels 中：虚拟机设置 → 回收磁盘空间；或删除不再使用的虚拟机/快照。'),
    T(CAT.vm, 'VMware / VirtualBox 虚拟机', ['~/Virtual Machines.localized', '~/Virtual Machines', '~/VirtualBox VMs'], 'review', '虚拟机磁盘，在对应软件中删除不用的虚拟机或快照。'),
    T(CAT.vm, 'UTM 虚拟机', ['~/Library/Containers/com.utmapp.UTM/Data/Documents'], 'review', '虚拟机磁盘，在 UTM 中删除不用的虚拟机。'),
    T(CAT.vm, 'OrbStack / Colima / Podman', ['~/.orbstack', '~/Library/Group Containers/HUAJUAN9QZ.dev.orbstack', '~/.colima', '~/.local/share/containers'], 'review', '容器虚拟磁盘，请用对应工具的 prune / 清理命令。'),
    T(CAT.vm, 'iOS 模拟器运行时', ['/Library/Developer/CoreSimulator/Volumes', '/Library/Developer/CoreSimulator/Images', '/Library/Developer/CoreSimulator/Cryptex'], 'review', '每个 iOS 版本的模拟器约 7–10 GiB。在 Xcode → 设置 → Components（平台）中删除不用的版本，或用系统工具“查看模拟器运行时”。'),
    T(CAT.vm, 'Xcode 安装包残留', ['~/Downloads/Xcode*.xip', '~/Library/Developer/Xcode/UserData/IB Support'], 'caution', '下载的 Xcode 安装包、IB 渲染缓存。', { mode: 'whole' }),
    T(CAT.vm, 'Android SDK', ['~/Library/Android/sdk/system-images', '~/Library/Android/sdk/ndk', '~/Library/Android/sdk/sources'], 'review', '模拟器系统镜像 / NDK / 源码。在 Android Studio → SDK Manager 中卸载不用的版本。'),
    T(CAT.vm, 'Flutter / Unity / Unreal 引擎', ['~/development/flutter/bin/cache', '/Applications/Unity/Hub/Editor', '/Users/Shared/Epic Games'], 'review', '引擎与 SDK 本体，在各自的 Hub/启动器中卸载不用的版本。'),
    T(CAT.vm, '设备固件缓存', ['~/Library/Containers/com.apple.AMPDevicesAgent/Data/Library/Caches', '~/Library/Group Containers/K36BKF7T3D.group.com.apple.configurator'], 'safe', '设备恢复/更新固件缓存，可重新下载。'),

    // 照片 / 音乐 / iCloud
    T(CAT.media2, '照片图库', ['~/Pictures/*.photoslibrary'], 'review', '不要直接删除里面的文件。可在 照片 → 设置 → iCloud 打开“优化 Mac 储存空间”。', { mode: 'whole' }),
    T(CAT.media2, 'iCloud 云盘本地副本', ['~/Library/Mobile Documents'], 'review', '在 Finder 中对不常用的文件夹右键 →“移除下载项”，文件仍在 iCloud。'),
    T(CAT.media2, '邮件数据', ['~/Library/Mail'], 'review', '邮件和附件，需要完全磁盘访问权限。可在“邮件”中删除带大附件的旧邮件。', { fda: true }),
    T(CAT.media2, '信息附件', ['~/Library/Messages/Attachments'], 'review', 'iMessage 图片/视频。可在 系统设置 → 通用 → 储存空间 → 信息 中按大小删除。', { fda: true }),
    T(CAT.media2, '音乐 / 播客 / Apple TV 下载', ['~/Music/Music/Media.localized', '~/Music/iTunes/iTunes Media', '~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts', '~/Movies/TV/Media.localized'], 'review', '已下载的媒体，可在对应应用中“移除下载项”。'),
    T(CAT.media2, 'GarageBand / Logic 音色库', ['/Library/Application Support/GarageBand', '/Library/Application Support/Logic', '/Library/Audio/Apple Loops', '/Library/Application Support/MainStage'], 'review', '乐器与循环乐段。不用 GarageBand/Logic 时可在应用内的“声音资源库”中删除。'),
    T(CAT.media2, '下载过的 macOS 安装器', ['/Applications/Install macOS*.app'], 'caution', '系统安装器，升级完成后可删除。', { mode: 'whole' }),
    T(CAT.media2, '桌面 / 影片 / 图片', ['~/Desktop', '~/Movies', '~/Pictures'], 'review', '个人文件，点开按大小排序检查。'),
    // 系统
    T(CAT.sys, '废纸篓', '~/.Trash', 'safe', '清空废纸篓（不可恢复）。', { action: 'emptyTrash' }),
    T(CAT.sys, '用户日志', [`${L}/Logs`], 'safe', '应用日志与崩溃报告，可清理。'),
    T(CAT.sys, '用户临时目录 $TMPDIR', ['%TMPDIR%'], 'caution', '系统分配给你的临时目录（/private/var/folders/…/T），正在运行的应用可能在用，建议退出大部分应用后再清理，重启也会清理一部分。'),
    T(CAT.sys, '用户级系统缓存', ['%TMPDIR%/../C'], 'caution', '/private/var/folders/…/C，系统与应用的缓存（含 Metal 着色器、字体缓存等），可重建。'),
    T(CAT.sys, '保存的应用状态', [`${L}/Saved Application State`], 'caution', '应用重新打开时恢复窗口用，清理后窗口不会自动恢复。'),
    T(CAT.sys, 'iOS 软件更新包', [`${L}/iTunes/iPhone Software Updates`, `${L}/iTunes/iPad Software Updates`], 'safe', '已下载的 iOS 固件，可删除。'),
    T(CAT.sys, 'iPhone/iPad 备份', [`${AS}/MobileSync/Backup`], 'review', '设备备份。请在 Finder → 设备 → 管理备份 中删除旧备份。', { fda: true }),
    T(CAT.sys, '邮件附件下载', [`${L}/Containers/com.apple.mail/Data/Library/Mail Downloads`], 'safe', '在邮件中打开过的附件副本。', { fda: true }),
    T(CAT.sys, 'QuickLook 缩略图', [`${C}/com.apple.QuickLook.thumbnailcache`], 'safe', '预览缩略图缓存。'),
    T(CAT.sys, '下载文件夹里的安装包', ['~/Downloads/*.dmg', '~/Downloads/*.pkg', '~/Downloads/*.iso', '~/Downloads/*.xip', '~/Downloads/*.exe', '~/Downloads/*.msi'], 'caution', '已下载的安装镜像，软件装好后通常可删除。', { mode: 'whole' }),
    T(CAT.sys, '下载文件夹', '~/Downloads', 'review', '点开按大小排序，删除不需要的文件。'),
    T(CAT.sys, '系统级缓存 /Library/Caches', ['/Library/Caches'], 'review', '系统级缓存，需要管理员权限，仅供查看。'),

    // 浏览器
    ...chromium('Chrome', 'Google/Chrome', ['Google Chrome']),
    T(CAT.browser, 'Google 其他缓存', [`${C}/Google`], 'safe', 'Google 系应用缓存（包含 Chrome 磁盘缓存），可重建。', { apps: ['Google Chrome'], dedupe: true }),
    ...chromium('Edge', 'Microsoft Edge', ['Microsoft Edge']),
    ...chromium('Brave', 'BraveSoftware/Brave-Browser', ['Brave Browser']),
    T(CAT.browser, 'Arc 缓存', [`${C}/Arc`, `${C}/company.thebrowser.Browser`, `${AS}/Arc/User Data/*/Code Cache`, `${AS}/Arc/User Data/*/GPUCache`], 'safe', '可重建。', { apps: ['Arc'] }),
    T(CAT.browser, 'Firefox 缓存', [`${C}/Firefox/Profiles`, `${C}/Mozilla`], 'safe', '可重建。', { apps: ['firefox'] }),
    T(CAT.browser, 'Safari 缓存', [`${C}/com.apple.Safari`, `${L}/Containers/com.apple.Safari/Data/Library/Caches`], 'safe', '可重建，需要“完全磁盘访问权限”。', { apps: ['Safari'], fda: true }),

    // 开发工具
    T(CAT.dev, 'Xcode DerivedData', [`${L}/Developer/Xcode/DerivedData`], 'safe', '编译中间产物，可重建。', { apps: ['Xcode'] }),
    T(CAT.dev, '测试用模拟器', [`${L}/Developer/XCTestDevices`], 'safe', '跑测试时复制出来的模拟器，自动重建。', { apps: ['Xcode', 'Simulator'] }),
    T(CAT.dev, 'Playground 模拟器', [`${L}/Developer/XCPGDevices`], 'safe', 'Playground 用的模拟器，自动重建。', { apps: ['Xcode', 'Simulator'] }),
    T(CAT.dev, 'Xcode 预览 / 模块缓存', [`${L}/Developer/Xcode/UserData/Previews`, `${C}/com.apple.dt.Xcode`], 'safe', 'SwiftUI 预览与 Xcode 缓存。', { apps: ['Xcode'] }),
    T(CAT.dev, 'iOS DeviceSupport', [`${L}/Developer/Xcode/iOS DeviceSupport`, `${L}/Developer/Xcode/watchOS DeviceSupport`, `${L}/Developer/Xcode/tvOS DeviceSupport`, `${L}/Developer/Xcode/visionOS DeviceSupport`], 'caution', '真机调试符号，旧系统版本的可删除，连接设备时会重新生成。', { apps: ['Xcode'] }),
    T(CAT.dev, 'Xcode Archives', [`${L}/Developer/Xcode/Archives`], 'review', '归档的发布包（含 dSYM），已上架版本的崩溃符号化需要它。'),
    T(CAT.dev, '模拟器设备', [`${L}/Developer/CoreSimulator/Devices`], 'review', '建议在下方“系统工具”里用“删除不可用模拟器”。'),
    T(CAT.dev, '模拟器缓存', [`${L}/Developer/CoreSimulator/Caches`, `${C}/com.apple.CoreSimulator.SimulatorTrampoline`], 'safe', '可重建。'),
    T(CAT.dev, 'npm 缓存', ['~/.npm/_cacache', '~/.npm/_npx', '~/.npm/_logs'], 'safe', '可重建（等价于 npm cache clean --force）。'),
    T(CAT.dev, 'Yarn 缓存', [`${C}/Yarn`, '~/.yarn/berry/cache'], 'safe', '可重建。'),
    T(CAT.dev, 'pnpm Store', [`${L}/pnpm/store`], 'caution', '项目通过硬链接使用它，建议用 `pnpm store prune`。'),
    T(CAT.dev, 'Homebrew 下载缓存', [`${C}/Homebrew`], 'safe', '已下载的安装包（等价于 brew cleanup）。'),
    T(CAT.dev, 'pip / Poetry 缓存', [`${C}/pip`, `${C}/pypoetry`, `${C}/pip-tools`], 'safe', '可重建。'),
    T(CAT.dev, 'CocoaPods / Carthage 缓存', [`${C}/CocoaPods`, `${C}/org.carthage.CarthageKit`], 'safe', '可重建。'),
    T(CAT.dev, 'Go 编译缓存', [`${C}/go-build`, `${C}/golangci-lint`], 'safe', '可重建。'),
    T(CAT.dev, 'JetBrains 缓存', [`${C}/JetBrains`, `${C}/Google/AndroidStudio*`], 'safe', 'IDE 索引缓存，下次打开会重建索引。', { apps: ['idea', 'studio', 'pycharm', 'webstorm', 'goland', 'clion'] }),
    T(CAT.dev, 'VS Code 缓存', [`${AS}/Code/Cache`, `${AS}/Code/CachedData`, `${AS}/Code/CachedExtensionVSIXs`, `${AS}/Code/Code Cache`, `${AS}/Code/GPUCache`, `${AS}/Code/logs`], 'safe', '可重建。', { apps: ['Code', 'Electron'] }),
    T(CAT.dev, 'Electron / node-gyp / Playwright 下载缓存', [`${C}/electron`, `${C}/electron-builder`, `${C}/node-gyp`, `${C}/ms-playwright-go`], 'safe', '下载缓存，可重建。'),
    T(CAT.dev, 'Playwright 浏览器', [`${C}/ms-playwright`], 'caution', '测试用浏览器，删除后需 `npx playwright install`。'),
    T(CAT.dev, 'Deno / TypeScript 缓存', [`${C}/deno`, `${C}/typescript`], 'safe', '可重建。'),
    T(CAT.dev, 'Docker 数据', [`${L}/Containers/com.docker.docker/Data`], 'review', '镜像与容器数据，请用下方“Docker 清理”或 Docker Desktop 内的清理功能。'),
    T(CAT.dev, 'Unity 缓存', [`${L}/Unity/cache`, `${C}/com.unity3d.UnityEditor5.x`, `${L}/Application Support/Unity/Asset Store-5.x`], 'caution', 'Unity 包缓存 / Asset Store 下载，可重新下载。'),

    // 设计 / 媒体
    T(CAT.media, 'Adobe Camera Raw 缓存', [`${C}/Adobe Camera Raw`, `${C}/Adobe Camera Raw 2`], 'safe', 'RAW 预览缓存，可重建（也可在 Camera Raw 首选项中清除）。', { apps: ['Adobe Photoshop', 'Adobe Lightroom', 'Adobe Bridge'] }),
    T(CAT.media, 'Adobe 媒体缓存', [`${AS}/Adobe/Common/Media Cache Files`, `${AS}/Adobe/Common/Media Cache`, `${AS}/Adobe/Common/Peak Files`], 'safe', 'Premiere / After Effects 媒体缓存，可重建。', { apps: ['Adobe Premiere Pro', 'After Effects'] }),
    T(CAT.media, 'Adobe 其他缓存', [`${C}/Adobe`, `${AS}/Adobe/CoreSync/plugins/livetype`], 'safe', '可重建。'),
    T(CAT.media, 'Lightroom 预览', ['~/Pictures/*/*Previews.lrdata', '~/Pictures/*/*Smart Previews.lrdata'], 'caution', 'Lightroom 预览，可在 Lightroom 中重建。', { mode: 'whole', apps: ['Adobe Lightroom Classic'] }),
    T(CAT.media, 'Final Cut / Motion 渲染缓存', ['~/Movies/*.fcpbundle/*/Render Files', '~/Movies/*.fcpbundle/*/Transcoded Media'], 'caution', '渲染与转码文件，可在 FCP 中重新生成。', { apps: ['Final Cut Pro'] }),
    T(CAT.media, 'Figma / Sketch 缓存', [`${AS}/Figma/Desktop/Cache`, `${AS}/Figma/Code Cache`, `${C}/com.figma.Desktop`, `${C}/com.bohemiancoding.sketch3`], 'safe', '可重建。', { apps: ['Figma', 'Sketch'] }),
    T(CAT.media, 'Spotify / 网易云 / QQ 音乐缓存', [`${C}/com.spotify.client`, `${AS}/Spotify/PersistentCache`, `${L}/Containers/com.netease.163music/Data/Caches`, `${L}/Containers/com.tencent.QQMusicMac/Data/Library/Caches`], 'safe', '离线播放缓存（不是下载的歌曲）。', { apps: ['Spotify', 'NeteaseMusic', 'QQMusic'] }),
    T(CAT.media, '影视/播放器缓存', [`${C}/com.apple.Music`, `${C}/com.apple.TV`, `${C}/com.colliderli.iina`], 'safe', '可重建。'),

    // 通讯 / 应用
    electronApp(CAT.apps, 'Slack', 'Slack', ['Slack']),
    electronApp(CAT.apps, 'Discord', 'discord', ['Discord']),
    electronApp(CAT.apps, 'Notion', 'Notion', ['Notion']),
    electronApp(CAT.apps, 'Microsoft Teams', 'Microsoft/Teams', ['Microsoft Teams']),
    electronApp(CAT.apps, '飞书', 'LarkShell', ['Lark', 'Feishu']),
    T(CAT.apps, 'Telegram 媒体缓存', [`${L}/Group Containers/*.ru.keepcoder.Telegram/appstore/account-*/postbox/media`, `${L}/Group Containers/*.ru.keepcoder.Telegram/stable/account-*/postbox/media`], 'caution', '已浏览过的图片/视频缓存，可在 Telegram 设置 → 数据与存储 中清理。', { apps: ['Telegram'] }),
    T(CAT.apps, '微信聊天数据', [`${L}/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat`, `${L}/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files`], 'keep', '聊天记录和文件。请在 微信 → 设置 → 通用 → 存储空间 中管理。', { fda: true }),
    T(CAT.apps, '微信缓存', [`${L}/Containers/com.tencent.xinWeChat/Data/Library/Caches`], 'safe', '微信缓存，退出微信后清理。', { apps: ['WeChat'], fda: true }),
    T(CAT.apps, 'QQ / 企业微信 / 钉钉缓存', [`${L}/Containers/com.tencent.qq/Data/Library/Caches`, `${L}/Containers/com.tencent.WeWorkMac/Data/Library/Caches`, `${L}/Containers/com.alibaba.DingTalkMac/Data/Library/Caches`], 'safe', '退出应用后清理。', { apps: ['QQ', '企业微信', 'WeWork', 'DingTalk'], fda: true }),
    T(CAT.apps, 'Zoom / 腾讯会议缓存', [`${C}/us.zoom.xos`, `${L}/Containers/com.tencent.meeting/Data/Library/Caches`], 'safe', '可重建。', { apps: ['zoom.us', 'TencentMeeting'] }),
    T(CAT.apps, 'Steam 游戏', [`${AS}/Steam/steamapps/common`], 'review', '已安装的游戏，请在 Steam 中卸载不玩的游戏。'),
    T(CAT.apps, 'Steam 网页缓存', [`${AS}/Steam/appcache/httpcache`, `${AS}/Steam/config/htmlcache`, `${AS}/Steam/logs`], 'safe', '可重建。', { apps: ['steam_osx'] }),
  ];
}

// ---------------------------------------------------------------- Windows
function win() {
  const LA = '%LOCALAPPDATA%';
  const RA = '%APPDATA%';
  const PD = '%ProgramData%';
  const W = '%SystemRoot%';
  const chromium = (name, base, apps) => [
    T(CAT.browser, `${name} 缓存`, [`${LA}\\${base}\\User Data\\*\\Cache`, `${LA}\\${base}\\User Data\\*\\Code Cache`, `${LA}\\${base}\\User Data\\*\\GPUCache`, `${LA}\\${base}\\User Data\\*\\DawnGraphiteCache`, `${LA}\\${base}\\User Data\\*\\DawnWebGPUCache`, `${LA}\\${base}\\User Data\\GrShaderCache`, `${LA}\\${base}\\User Data\\ShaderCache`], 'safe', '网页缓存，可重建。关闭浏览器后清理更彻底。', { apps }),
    T(CAT.browser, `${name} Service Worker 缓存`, [`${LA}\\${base}\\User Data\\*\\Service Worker\\CacheStorage`], 'caution', '网站离线缓存。', { apps }),
  ];
  const electronApp = (cat, name, dir, apps, root = RA) => T(cat, `${name} 缓存`, [`${root}\\${dir}\\Cache`, `${root}\\${dir}\\Code Cache`, `${root}\\${dir}\\GPUCache`, `${root}\\${dir}\\CachedData`, `${root}\\${dir}\\DawnGraphiteCache`, `${root}\\${dir}\\DawnWebGPUCache`, `${root}\\${dir}\\Service Worker\\CacheStorage`], 'safe', '应用内网页缓存，可重建。退出应用后清理。', { apps });

  return [
    ...common(),
    // AI 应用
    electronApp(CAT.ai, 'Claude 桌面版', 'Claude', ['claude']),
    T(CAT.ai, 'Claude 桌面版虚拟机镜像', [`${RA}\\Claude\\vm_bundles`], 'caution', 'Cowork 等功能使用的虚拟机镜像，删除后首次使用会重新下载。', { apps: ['claude'] }),
    electronApp(CAT.ai, 'Codex 桌面版', 'Codex', ['codex']),
    electronApp(CAT.ai, 'Cursor', 'Cursor', ['cursor']),
    T(CAT.ai, 'Cursor 扩展安装包 / 日志', [`${RA}\\Cursor\\CachedExtensionVSIXs`, `${RA}\\Cursor\\logs`], 'safe', '可清理。', { apps: ['cursor'] }),
    electronApp(CAT.ai, 'ChatGPT', 'OpenAI\\ChatGPT', ['chatgpt']),

    // 系统（含原“Windows 清理助手”的常用项目）
    // 全盘空间去向
    T(CAT.space, 'Windows 系统目录', ['%SystemRoot%'], 'info', 'Windows 本身（含 WinSxS）。可在系统工具里运行 DISM 组件清理。', { space: 'data' }),
    T(CAT.space, '程序 Program Files', ['%ProgramFiles%', '%ProgramFiles(x86)%'], 'info', '已安装的软件，在“设置 → 应用”中卸载不用的大软件。', { space: 'data' }),
    T(CAT.space, '程序数据 ProgramData', ['%ProgramData%'], 'info', '所有用户共享的程序数据。', { space: 'data' }),
    T(CAT.space, '页面文件 / 休眠 / 交换', ['C:\\pagefile.sys', 'C:\\hiberfil.sys', 'C:\\swapfile.sys'], 'info', '虚拟内存与休眠文件。关闭休眠可释放 hiberfil.sys。', { space: 'data', mode: 'whole' }),
    T(CAT.space, '公用目录', ['C:\\Users\\Public'], 'info', '所有用户共享的文件。', { space: 'data' }),
    T(CAT.space, '还原点 System Volume Information', ['C:\\System Volume Information'], 'info', '系统还原点，需要管理员权限才能统计。用系统工具里的“查看还原点占用”。', { space: 'data', admin: true }),
    // 虚拟机 / SDK
    T(CAT.vm, 'VMware / VirtualBox / Hyper-V 虚拟机', ['~\\Documents\\Virtual Machines', '~\\VirtualBox VMs', '%ProgramData%\\Microsoft\\Windows\\Virtual Hard Disks'], 'review', '虚拟机磁盘，在对应软件中删除不用的虚拟机或快照。'),
    T(CAT.vm, 'Android SDK / 模拟器', ['%LOCALAPPDATA%\\Android\\Sdk\\system-images', '~\\.android\\avd'], 'review', '在 Android Studio 中卸载不用的镜像/模拟器。'),
    T(CAT.vm, 'Unity / Unreal 引擎', ['%ProgramFiles%\\Unity\\Hub\\Editor', '%ProgramFiles%\\Epic Games'], 'review', '在各自的 Hub/启动器中卸载不用的版本。'),
    T(CAT.media2, 'OneDrive 本地副本', ['~\\OneDrive'], 'review', '对不常用的文件夹右键 →“释放空间”，文件仍在云端。'),
    T(CAT.media2, '桌面 / 视频 / 图片', ['~\\Desktop', '~\\Videos', '~\\Pictures'], 'review', '个人文件，点开按大小排序检查。'),
    T(CAT.sys, '回收站', 'C:\\$Recycle.Bin', 'safe', '清空所有磁盘的回收站（不可恢复）。', { action: 'emptyTrash' }),
    T(CAT.sys, '用户临时文件 %TEMP%', ['%TEMP%'], 'safe', '临时文件。正在使用的文件会自动跳过。'),
    T(CAT.sys, '系统临时文件', [`${W}\\Temp`], 'safe', '需要管理员权限。', { admin: true }),
    T(CAT.sys, 'Windows 更新下载缓存', [`${W}\\SoftwareDistribution\\Download`], 'caution', '已安装更新的安装包。请确保没有正在进行的更新，需要管理员权限。', { admin: true }),
    T(CAT.sys, '传递优化缓存', [`${W}\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache`, `${W}\\SoftwareDistribution\\DeliveryOptimization`], 'safe', '用于给其它电脑分享更新的缓存，需要管理员权限。', { admin: true }),
    T(CAT.sys, '错误报告 / 崩溃转储', [`${PD}\\Microsoft\\Windows\\WER\\ReportArchive`, `${PD}\\Microsoft\\Windows\\WER\\ReportQueue`, `${LA}\\Microsoft\\Windows\\WER`, `${LA}\\CrashDumps`, `${W}\\Minidump`, `${W}\\LiveKernelReports`], 'safe', 'Windows 错误报告和崩溃转储。'),
    T(CAT.sys, '内存转储 MEMORY.DMP', [`${W}\\MEMORY.DMP`], 'safe', '蓝屏时生成的完整内存转储，需要管理员权限。', { mode: 'whole', admin: true }),
    T(CAT.sys, '系统日志 (CBS/DISM/Panther)', [`${W}\\Logs\\CBS`, `${W}\\Logs\\DISM`, `${W}\\Panther`, `${W}\\Logs\\MeasuredBoot`], 'caution', '更新与安装日志，需要管理员权限。', { admin: true }),
    T(CAT.sys, '预读取 Prefetch', [`${W}\\Prefetch`], 'caution', '加快程序启动的缓存，清理后首次启动略慢，会自动重建。', { admin: true }),
    T(CAT.sys, '缩略图缓存', [`${LA}\\Microsoft\\Windows\\Explorer\\thumbcache_*.db`, `${LA}\\Microsoft\\Windows\\Explorer\\iconcache_*.db`], 'safe', '资源管理器缩略图，正在使用的会跳过。', { mode: 'whole' }),
    T(CAT.sys, 'IE / WebView 缓存', [`${LA}\\Microsoft\\Windows\\INetCache`, `${LA}\\Microsoft\\Windows\\WebCache.old`], 'safe', '可重建。'),
    T(CAT.sys, 'DirectX / 显卡着色器缓存', [`${LA}\\D3DSCache`, `${LA}\\NVIDIA\\DXCache`, `${LA}\\NVIDIA\\GLCache`, `${LA}\\NVIDIA Corporation\\NV_Cache`, `${LA}\\AMD\\DxCache`, `${LA}\\AMD\\DxcCache`, `${LA}\\AMD\\GLCache`, `${LA}\\AMD\\VkCache`, `${LA}\\Intel\\ShaderCache`], 'safe', '着色器缓存，游戏首次运行会重建。'),
    T(CAT.sys, '显卡驱动安装包', [`${PD}\\NVIDIA Corporation\\Downloader`, 'C:\\NVIDIA', 'C:\\AMD', `${PD}\\Package Cache`], 'caution', '驱动/运行库安装残留。Package Cache 用于修复/卸载程序，删除需谨慎。', { admin: true }),
    T(CAT.sys, 'Windows 安装补丁缓存', [`${W}\\Installer\\$PatchCache$`], 'caution', '补丁卸载用的缓存，需要管理员权限。', { admin: true }),
    T(CAT.sys, '旧系统 Windows.old', ['C:\\Windows.old', 'C:\\$Windows.~BT', 'C:\\$Windows.~WS', 'C:\\$WINDOWS.~Q'], 'review', '升级后保留的旧系统，请用下方“磁盘清理”工具删除。', { admin: true }),
    T(CAT.sys, 'Microsoft Store 应用缓存', [`${LA}\\Packages\\*\\AC\\INetCache`, `${LA}\\Packages\\*\\LocalCache`, `${LA}\\Packages\\*\\AC\\Temp`], 'caution', 'UWP 应用缓存，退出应用后清理。'),
    T(CAT.sys, '下载文件夹里的安装包', ['~\\Downloads\\*.exe', '~\\Downloads\\*.msi', '~\\Downloads\\*.iso', '~\\Downloads\\*.zip', '~\\Downloads\\*.dmg'], 'caution', '安装包与压缩包，装好/解压后通常可删除。', { mode: 'whole' }),
    T(CAT.sys, '下载文件夹', '~\\Downloads', 'review', '点开按大小排序，删除不需要的文件。'),
    T(CAT.sys, '休眠文件 hiberfil.sys', ['C:\\hiberfil.sys'], 'info', '如不使用休眠，可在“系统工具”里关闭休眠以释放此空间。'),

    // 浏览器
    ...chromium('Chrome', 'Google\\Chrome', ['chrome']),
    ...chromium('Edge', 'Microsoft\\Edge', ['msedge']),
    ...chromium('Brave', 'BraveSoftware\\Brave-Browser', ['brave']),
    T(CAT.browser, 'Firefox 缓存', [`${LA}\\Mozilla\\Firefox\\Profiles\\*\\cache2`, `${LA}\\Mozilla\\Firefox\\Profiles\\*\\startupCache`], 'safe', '可重建。', { apps: ['firefox'] }),
    T(CAT.browser, 'Opera 缓存', [`${LA}\\Opera Software\\*\\Cache`, `${RA}\\Opera Software\\*\\Code Cache`], 'safe', '可重建。', { apps: ['opera'] }),
    T(CAT.browser, '360 / QQ 浏览器缓存', [`${LA}\\360Chrome\\Chrome\\User Data\\*\\Cache`, `${LA}\\Tencent\\QQBrowser\\User Data\\*\\Cache`], 'safe', '可重建。', { apps: ['360chrome', 'qqbrowser'] }),

    // 开发
    T(CAT.dev, 'npm 缓存', [`${LA}\\npm-cache\\_cacache`, `${LA}\\npm-cache\\_npx`, `${LA}\\npm-cache\\_logs`], 'safe', '可重建。'),
    T(CAT.dev, 'Yarn / pnpm 缓存', [`${LA}\\Yarn\\Cache`, `${LA}\\pnpm-cache`], 'safe', '可重建。'),
    T(CAT.dev, 'pnpm Store', [`${LA}\\pnpm\\store`], 'caution', '建议用 `pnpm store prune`。'),
    T(CAT.dev, 'pip / uv / Poetry 缓存', [`${LA}\\pip\\Cache`, `${LA}\\uv\\cache`, `${LA}\\pypoetry\\Cache`], 'safe', '可重建。'),
    T(CAT.dev, 'Go 编译缓存', [`${LA}\\go-build`], 'safe', '可重建。'),
    T(CAT.dev, 'NuGet HTTP 缓存', [`${LA}\\NuGet\\v3-cache`, `${LA}\\NuGet\\plugins-cache`, `${LA}\\Temp\\NuGetScratch`], 'safe', '可重建。'),
    T(CAT.dev, 'JetBrains 缓存', [`${LA}\\JetBrains\\*\\caches`, `${LA}\\JetBrains\\*\\log`, `${LA}\\Google\\AndroidStudio*\\caches`], 'safe', 'IDE 索引缓存，会重建。', { apps: ['idea64', 'studio64', 'pycharm64', 'webstorm64', 'rider64'] }),
    T(CAT.dev, 'VS Code 缓存', [`${RA}\\Code\\Cache`, `${RA}\\Code\\CachedData`, `${RA}\\Code\\CachedExtensionVSIXs`, `${RA}\\Code\\Code Cache`, `${RA}\\Code\\GPUCache`, `${RA}\\Code\\logs`], 'safe', '可重建。', { apps: ['code'] }),
    T(CAT.dev, 'Visual Studio 组件缓存', [`${LA}\\Microsoft\\VisualStudio\\*\\ComponentModelCache`, `${LA}\\Temp\\VSFeedbackIntelliCodeLogs`], 'safe', '可重建。', { apps: ['devenv'] }),
    T(CAT.dev, 'Electron / Playwright 下载缓存', [`${LA}\\electron\\Cache`, `${LA}\\electron-builder\\Cache`, `${LA}\\node-gyp\\Cache`], 'safe', '可重建。'),
    T(CAT.dev, 'Playwright 浏览器', [`${LA}\\ms-playwright`], 'caution', '删除后需 `npx playwright install`。'),
    T(CAT.dev, 'Docker / WSL 磁盘', [`${LA}\\Docker\\wsl`, `${LA}\\Packages\\CanonicalGroupLimited.*\\LocalState`], 'review', 'WSL / Docker 虚拟磁盘（ext4.vhdx），请在 Docker 内清理后用 diskpart 压缩。'),
    T(CAT.dev, 'Unity 缓存', [`${LA}\\Unity\\cache`, `${RA}\\Unity\\Asset Store-5.x`], 'caution', '可重新下载。'),

    // 媒体
    T(CAT.media, 'Adobe 媒体缓存', [`${RA}\\Adobe\\Common\\Media Cache Files`, `${RA}\\Adobe\\Common\\Media Cache`, `${RA}\\Adobe\\Common\\Peak Files`], 'safe', 'Premiere / After Effects 媒体缓存，可重建。', { apps: ['adobe premiere pro', 'afterfx'] }),
    T(CAT.media, 'Adobe Camera Raw 缓存', [`${LA}\\Adobe\\CameraRaw\\Cache`, `${LA}\\Adobe\\CameraRaw\\GPU`], 'safe', 'RAW 预览缓存，可重建。', { apps: ['photoshop', 'lightroom'] }),
    T(CAT.media, 'Spotify / 网易云音乐缓存', [`${LA}\\Spotify\\Data`, `${LA}\\Netease\\CloudMusic\\Cache`], 'safe', '离线播放缓存（不是下载的歌曲）。', { apps: ['spotify', 'cloudmusic'] }),
    T(CAT.media, 'Figma 缓存', [`${RA}\\Figma\\DesktopProfile\\*\\Cache`, `${LA}\\Figma\\packages`], 'safe', '可重建。', { apps: ['figma'] }),

    // 通讯 / 应用
    T(CAT.apps, '微信聊天文件', ['~\\Documents\\WeChat Files', '~\\Documents\\xwechat_files', '%USERPROFILE%\\xwechat_files'], 'keep', '聊天记录与文件，请在 微信 → 设置 → 存储空间 中管理。'),
    T(CAT.apps, '微信缓存', ['~\\Documents\\WeChat Files\\*\\FileStorage\\Cache', `${RA}\\Tencent\\WeChat\\radium\\web\\profiles`, '~\\Documents\\xwechat_files\\*\\cache'], 'safe', '退出微信后清理。', { apps: ['wechat', 'weixin'] }),
    T(CAT.apps, 'QQ 聊天文件', ['~\\Documents\\Tencent Files'], 'keep', '聊天记录与文件，请在 QQ 设置中管理。'),
    T(CAT.apps, '企业微信 / 钉钉缓存', [`${RA}\\Tencent\\WXWork\\Cache`, `${RA}\\DingTalk\\*\\ImageFiles`, `${RA}\\DingTalk\\*\\resource_cache`], 'safe', '退出应用后清理。', { apps: ['wxwork', 'dingtalk'] }),
    electronApp(CAT.apps, 'Slack', 'Slack', ['slack']),
    electronApp(CAT.apps, 'Discord', 'discord', ['discord']),
    electronApp(CAT.apps, 'Teams (经典版)', 'Microsoft\\Teams', ['teams']),
    T(CAT.apps, '新版 Teams 缓存', [`${LA}\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\*\\Cache`], 'safe', '退出 Teams 后清理。', { apps: ['ms-teams'] }),
    electronApp(CAT.apps, 'Notion', 'Notion', ['notion']),
    electronApp(CAT.apps, '飞书', 'LarkShell', ['lark', 'feishu']),
    T(CAT.apps, 'Steam 网页缓存 / 日志', ['%ProgramFiles(x86)%\\Steam\\appcache\\httpcache', `${LA}\\Steam\\htmlcache`, '%ProgramFiles(x86)%\\Steam\\logs', '%ProgramFiles(x86)%\\Steam\\dumps'], 'safe', '可重建。', { apps: ['steam'] }),
    T(CAT.apps, 'Steam Shader 缓存', ['%ProgramFiles(x86)%\\Steam\\steamapps\\shadercache'], 'caution', '游戏着色器缓存，删除后游戏首次运行会重建。', { apps: ['steam'] }),
    T(CAT.apps, 'Epic / 战网 缓存', [`${LA}\\EpicGamesLauncher\\Saved\\webcache*`, `${LA}\\EpicGamesLauncher\\Saved\\Logs`, `${PD}\\Battle.net\\Agent\\data\\cache`], 'safe', '可重建。', { apps: ['epicgameslauncher', 'battle.net'] }),
  ];
}

// 自动发现：列出这些目录下的直接子目录，显示超过阈值的项
function discoverySources(platform) {
  if (platform === 'darwin') {
    return [
      { dir: '~/Library/Caches', cat: CAT.dynCache, level: 'caution', min: 50 * 2 ** 20, note: '应用缓存。我只核实了大小，没有确认内容是可重建的预览、模型还是离线资源。建议先点开看子目录，优先使用应用自带的缓存清理功能。' },
      { dir: '~/Library/Application Support', cat: CAT.dynBig, level: 'review', min: 500 * 2 ** 20, note: '应用数据目录，可能包含重要数据，请点开查看。' },
      { dir: '~/Library/Containers', cat: CAT.dynBig, level: 'review', min: 500 * 2 ** 20, note: '沙盒应用数据，可能包含重要数据，请点开查看。' },
      { dir: '~/Library/Group Containers', cat: CAT.dynBig, level: 'review', min: 500 * 2 ** 20, note: '应用组共享数据，可能包含重要数据。' },
      { dir: '~/Documents', cat: CAT.dynBig, level: 'review', min: 1024 * 2 ** 20, note: '文稿中的大目录，按大小排序逐项检查。' },
      { dir: '~/Movies', cat: CAT.dynBig, level: 'review', min: 1024 * 2 ** 20, note: '影片中的大项。' },
      { dir: '~', cat: CAT.home, level: 'info', min: 100 * 2 ** 20, note: '主目录下的一级目录占用（含隐藏目录），仅用于定位空间。', includeHidden: true, totalName: '主目录（全部）' },
      { dir: '/Applications', cat: CAT.dynBig, level: 'review', min: 2 * 1024 * 2 ** 20, note: '体积很大的应用，不用的话可以卸载。' },
      { dir: '~/Library', cat: CAT.dynBig, level: 'review', min: 2 * 1024 * 2 ** 20, note: '资源库里的大目录。', exclude: ['Caches', 'Application Support', 'Containers', 'Group Containers', 'Logs', 'Developer'] },
      // 命令行 xcodebuild -derivedDataPath 生成的自建编译目录：整个目录删除
      { dir: '~/Library/Developer', cat: CAT.dev, level: 'safe', mode: 'whole', min: 0, apps: ['Xcode', 'xcodebuild'], note: '命令行编译时用 -derivedDataPath 生成的目录（如 FilmMeterBuild、JPTransCheck），可重建。', exclude: ['CoreDevice', 'CoreSimulator', 'DVTDownloads', 'Toolchains', 'Xcode', 'XCPGDevices', 'XCTestDevices', 'Shared', 'PrivateFrameworks'] },
    ];
  }
  return [
    { dir: '%LOCALAPPDATA%', cat: CAT.dynBig, level: 'review', min: 500 * 2 ** 20, note: '应用本地数据，可能包含缓存也可能包含重要数据，请点开查看。' },
    { dir: '%APPDATA%', cat: CAT.dynBig, level: 'review', min: 500 * 2 ** 20, note: '应用漫游数据，可能包含重要数据。' },
    { dir: '%ProgramData%', cat: CAT.dynBig, level: 'review', min: 1024 * 2 ** 20, note: '所有用户共享的程序数据。' },
    { dir: '~\\Documents', cat: CAT.dynBig, level: 'review', min: 1024 * 2 ** 20, note: '文档中的大目录，按大小排序逐项检查。' },
    { dir: '~', cat: CAT.home, level: 'info', min: 100 * 2 ** 20, note: '用户目录下的一级目录占用（含隐藏目录），仅用于定位空间。', includeHidden: true, totalName: '用户目录（全部）' },
  ];
}

// 系统工具（一键执行系统自带的清理命令）
function tools(platform) {
  if (platform === 'darwin') {
    return [
      { id: 'brew', name: 'Homebrew 清理', desc: 'brew cleanup -s --prune=all：删除旧版本和下载缓存', cmd: 'PATH=/opt/homebrew/bin:/usr/local/bin:$PATH brew cleanup -s --prune=all' },
      { id: 'simctl', name: '删除不可用模拟器', desc: 'xcrun simctl delete unavailable：删除已不支持的 iOS 模拟器', cmd: 'xcrun simctl delete unavailable' },
      { id: 'simrt', name: '查看模拟器运行时', desc: 'xcrun simctl runtime list：列出已安装的 iOS 模拟器运行时及大小，再到 Xcode → 设置 → Components 删除', cmd: 'xcrun simctl runtime list -v 2>/dev/null || xcrun simctl runtime list' },
      { id: 'snaplist', name: '查看 Time Machine 本地快照', desc: 'tmutil listlocalsnapshots /：本地快照会占用“系统数据”', cmd: 'tmutil listlocalsnapshots / ; echo; diskutil apfs list | grep -E \"Capacity|Snapshot|Name:\" | head -40' },
      { id: 'docker', name: 'Docker 清理', desc: 'docker system prune -f：删除停止的容器、悬空镜像和构建缓存', cmd: 'PATH=/usr/local/bin:/opt/homebrew/bin:$PATH docker system prune -f && docker builder prune -f' },
      { id: 'npm', name: 'npm 缓存清理', desc: 'npm cache clean --force', cmd: 'PATH=/opt/homebrew/bin:/usr/local/bin:$PATH npm cache clean --force' },
      { id: 'pnpm', name: 'pnpm store prune', desc: '删除未被任何项目引用的包', cmd: 'PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:$PATH pnpm store prune' },
      { id: 'gomod', name: 'Go 模块缓存清理', desc: 'go clean -modcache', cmd: 'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/local/go/bin:$PATH go clean -modcache' },
      { id: 'snap', name: '清理 Time Machine 本地快照', desc: 'tmutil thinlocalsnapshots：释放“可清除”空间', cmd: 'tmutil thinlocalsnapshots / 999999999999 4' },
      { id: 'storage', name: '打开系统“储存空间”', desc: '系统设置 → 通用 → 储存空间', open: 'x-apple.systempreferences:com.apple.settings.Storage' },
      { id: 'fda', name: '授予完全磁盘访问权限', desc: '让本工具能读取 Safari、邮件、微信等受保护目录', open: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles' },
    ];
  }
  return [
    { id: 'cleanmgr', name: '磁盘清理 (cleanmgr)', desc: '系统自带磁盘清理，可删除 Windows.old、更新残留', cmd: 'cleanmgr.exe /d C:', detached: true },
    { id: 'dism', name: '组件存储清理 (DISM)', desc: 'DISM /StartComponentCleanup：清理 WinSxS 旧组件（需管理员，耗时较长）', admin: 'Dism.exe /Online /Cleanup-Image /StartComponentCleanup' },
    { id: 'do', name: '清理传递优化缓存', desc: 'Delete-DeliveryOptimizationCache（需管理员）', admin: 'powershell -NoProfile -Command Delete-DeliveryOptimizationCache -Force' },
    { id: 'vss', name: '查看还原点占用', desc: 'vssadmin list shadowstorage：查看系统还原点（System Volume Information）占了多少空间（需管理员）', admin: 'vssadmin list shadowstorage & vssadmin list shadows' },
    { id: 'vssold', name: '删除最旧的还原点', desc: 'vssadmin delete shadows /for=C: /oldest：每次删除最旧的一个还原点（需管理员）', admin: 'vssadmin delete shadows /for=C: /oldest' },
    { id: 'sysprot', name: '打开“系统保护”', desc: '调整还原点最大使用量，或删除全部还原点', cmd: 'SystemPropertiesProtection.exe', detached: true },
    { id: 'dismscan', name: '分析组件存储 (WinSxS)', desc: 'DISM /AnalyzeComponentStore：查看 WinSxS 实际大小和可回收空间（需管理员）', admin: 'Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore' },
    { id: 'hiber', name: '关闭休眠（删除 hiberfil.sys）', desc: 'powercfg -h off，可释放与内存大小相当的空间（需管理员）', admin: 'powercfg.exe -h off' },
    { id: 'npm', name: 'npm 缓存清理', desc: 'npm cache clean --force', cmd: 'npm cache clean --force' },
    { id: 'docker', name: 'Docker 清理', desc: 'docker system prune -f', cmd: 'docker system prune -f' },
    { id: 'wsl', name: '关闭 WSL', desc: 'wsl --shutdown（压缩 vhdx 前需要先关闭）', cmd: 'wsl --shutdown' },
    { id: 'storage', name: '打开“存储感知”', desc: '设置 → 系统 → 存储', open: 'ms-settings:storagesense' },
  ];
}

function getTargets(platform) {
  const list = platform === 'darwin' ? mac() : platform === 'win32' ? win() : common();
  return list.map((t, i) => ({ id: `t${i}`, ...t }));
}

module.exports = { getTargets, discoverySources, tools, CAT };
