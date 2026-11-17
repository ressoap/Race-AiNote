#!/usr/bin/env node
/* 把 assets/wenmo-icon.ico 写进 Windows exe 的资源图标。
   仅构建期使用；resedit 是纯 JS，不引入运行时依赖。 */
const fs = require('node:fs');

function patchExeIcon(exePath, iconPath) {
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) return false;
  let ResEdit;
  try { ResEdit = require('resedit'); } catch (_) { return false; }
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups.find(g => g.id === 1) || groups[0];
  if (!target) return false;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    target.id,
    target.lang,
    iconFile.icons.map(item => item.data)
  );
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  return true;
}

if (require.main === module) {
  const [exe, icon] = process.argv.slice(2);
  if (!exe || !icon) {
    console.error('用法: node scripts/patch-exe-icon.js <exe> <ico>');
    process.exit(1);
  }
  const ok = patchExeIcon(exe, icon);
  console.log(ok ? '图标已写入: ' + exe : '跳过图标写入（缺少 exe/ico 或 resedit）');
  process.exit(ok ? 0 : 1);
}

module.exports = { patchExeIcon };
