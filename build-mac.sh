#!/bin/bash
# 在 Mac 上运行。默认生成 Apple 芯片版：dist/OneClickCleaner-<版本>-mac-arm64.dmg
# 需要 Intel 版时运行：./build-mac.sh all
set -e
cd "$(dirname "$0")"
command -v npm >/dev/null || { echo "请先安装 Node.js：https://nodejs.org 或 brew install node"; exit 1; }
npm install
if [ "$1" = "all" ]; then ARCH="--arm64 --x64"; else ARCH="--arm64"; fi
npx electron-builder --mac dmg $ARCH
open dist
