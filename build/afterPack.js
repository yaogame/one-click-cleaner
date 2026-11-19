// Linux 上交叉编译 Windows 时，用 64 位 rcedit 写入图标和版本信息（electron-builder 默认用 32 位版本，需要 32 位 wine）
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
exports.default = async (ctx) => {
  // 在 Mac 上打包时：没有开发者证书就做 ad-hoc 签名，Apple 芯片才能正常启动
  if (ctx.electronPlatformName === 'darwin') {
    if (process.platform !== 'darwin') return;
    const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    return;
  }
  if (ctx.electronPlatformName !== 'win32' || process.platform === 'win32') return;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.executableName || "OneClickCleaner"}.exe`);
  const base = path.join(os.homedir(), '.cache', 'electron-builder', 'winCodeSign');
  const dir = fs.existsSync(base) && fs.readdirSync(base).find((d) => fs.existsSync(path.join(base, d, 'rcedit-x64.exe')));
  if (!dir) { console.warn('rcedit-x64.exe 未找到，跳过写入图标'); return; }
  const ico = path.join(ctx.packager.info.projectDir, 'build', 'icon.ico');
  const v = ctx.packager.appInfo.version;
  try {
  execFileSync('wine', [path.join(base, dir, 'rcedit-x64.exe'), exe, '--set-icon', ico,
    '--set-version-string', 'FileDescription', 'OneClickCleaner', '--set-version-string', 'ProductName', 'OneClickCleaner',
    '--set-version-string', 'CompanyName', 'yaogame', '--set-file-version', v, '--set-product-version', v], { stdio: 'inherit', env: { ...process.env, WINEDEBUG: '-all' } });
  } catch (e) {
    console.warn('wine 运行 rcedit 失败，exe 将使用默认图标：', e.message.split('\n')[0]);
  }
};
