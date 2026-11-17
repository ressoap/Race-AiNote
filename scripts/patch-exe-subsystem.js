#!/usr/bin/env node
/* ============================================================
   patch-exe-subsystem.js — 把单文件 exe 从控制台程序改成 GUI 程序
   为什么：
   Node 官方 node.exe 本身是 console 子系统，SEA 复制出来双击时会
   先弹一个黑色控制台窗口，即使应用本身是网页界面。
   把 PE Optional Header 的 Subsystem 字段改成 2（WINDOWS_GUI）
   后，双击直接开应用窗口，不再显示控制台。
   ============================================================ */
const fs = require('node:fs');

const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;
const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;

/**
 * @param {string} filePath Windows PE 文件
 * @returns {{changed:boolean, subsystem:number, from?:number}}
 */
function setGuiSubsystem(filePath) {
  const fd = fs.openSync(filePath, 'r+');
  try {
    const stat = fs.fstatSync(fd);
    if (stat.size < 0x100) throw new Error('文件太小，不是有效 PE');

    const dos = Buffer.alloc(0x40);
    if (fs.readSync(fd, dos, 0, dos.length, 0) !== dos.length) throw new Error('读取 DOS 头失败');
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error('不是 MZ / PE 文件');

    const peOffset = dos.readUInt32LE(0x3c);
    const signature = Buffer.alloc(4);
    fs.readSync(fd, signature, 0, 4, peOffset);
    if (signature.readUInt32LE(0) !== 0x00004550) throw new Error('缺少 PE 签名');

    const optionalOffset = peOffset + 4 + 20;
    const magicBuf = Buffer.alloc(2);
    fs.readSync(fd, magicBuf, 0, 2, optionalOffset);
    const magic = magicBuf.readUInt16LE(0);
    if (magic !== PE32_MAGIC && magic !== PE32_PLUS_MAGIC) throw new Error('未知 PE Optional Header');

    // PE32 与 PE32+ 的 Subsystem 都在 Optional Header 偏移 68
    const subsystemOffset = optionalOffset + 68;
    const currentBuf = Buffer.alloc(2);
    fs.readSync(fd, currentBuf, 0, 2, subsystemOffset);
    const current = currentBuf.readUInt16LE(0);
    if (current === IMAGE_SUBSYSTEM_WINDOWS_GUI) {
      return { changed: false, subsystem: current };
    }
    if (current !== IMAGE_SUBSYSTEM_WINDOWS_CUI) {
      throw new Error('不是预期的控制台程序（Subsystem=' + current + '）');
    }
    const next = Buffer.alloc(2);
    next.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, 0);
    fs.writeSync(fd, next, 0, 2, subsystemOffset);
    return { changed: true, from: current, subsystem: IMAGE_SUBSYSTEM_WINDOWS_GUI };
  } finally {
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('用法: node scripts/patch-exe-subsystem.js <exe路径>');
    process.exit(1);
  }
  try {
    const result = setGuiSubsystem(target);
    console.log(result.changed
      ? '已切换为 GUI 子系统：双击不再弹控制台窗口'
      : '已经是 GUI 子系统，无需修改');
  } catch (err) {
    console.error('修改失败：' + (err && err.message ? err.message : err));
    process.exit(1);
  }
}

module.exports = { setGuiSubsystem };
