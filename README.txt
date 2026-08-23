批量重命名 - 独立便携版
========================

这是基于 uTools「批量重命名」原始插件改造成的独立 Windows 便携版工程。

目标：
- 不需要 uTools
- 不需要安装
- 配置文件 config.json 与 EXE 同目录
- 通过 Electron Builder 输出单文件 Portable EXE

构建：
1. 安装 Node.js 20+
2. 在本目录运行 npm install
3. 运行 npm run build
4. EXE 在 dist 目录

也可以直接上传到 GitHub，Actions 会在 Windows runner 上自动生成 EXE。
