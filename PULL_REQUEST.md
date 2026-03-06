# 修复 pnpm workspace 环境下无法正确获取 Electron 版本的问题

## 问题描述

在 pnpm workspace 环境中，electron-fix 无法正确获取 Electron 版本，导致后续执行失败。主要原因包括：

1. **package.json 查找**：从当前目录加载的 package.json 可能是 workspace 根目录的，而根目录通常不直接依赖 electron
2. **版本解析**：`catalog:` 协议和 `pnpm list --json` 的输出格式解析不兼容
3. **路径解析**：pnpm 使用 `.pnpm` 存储和符号链接，传统的 `node_modules/electron` 路径可能不正确

## 修复内容

### 1. 新增 `findProjectContext` 函数
- 从当前目录向上查找包含 electron 依赖的 package.json
- 支持 pnpm workspace：解析 `pnpm-workspace.yaml`，在 workspace 包中查找 electron

### 2. 改进 `getVersion` 函数
- **优先从实际安装的 electron 获取版本**：使用 `createRequire` 从项目根目录解析 `electron/package.json`，兼容 npm/yarn/pnpm 的目录结构
- **支持 pnpm catalog**：解析 `pnpm-workspace.yaml` 中的 `catalog.electron` 获取版本
- **改进 pnpm list 解析**：兼容不同的 JSON 输出格式

### 3. 新增 `resolveElectronPath` 函数
- 使用 Node 的 `createRequire` 解析 electron 的实际安装路径
- 兼容 pnpm 的 `.pnpm` 存储结构

### 4. 更新 `index.js`
- 使用 `findProjectContext` 替代直接加载当前目录的 package.json
- 支持从 workspace 根目录或子包目录运行

### 5. 更新 README
- 添加 pnpm 安装说明
- 注明支持 pnpm workspace 和 catalog 协议

## 测试

- ✅ 普通 npm 项目：`test/` 目录
- ✅ pnpm workspace 子包：`test-pnpm-workspace/packages/app/`
- ✅ pnpm workspace 根目录：`test-pnpm-workspace/`（自动查找包含 electron 的子包）

## 向后兼容

- 保持对 npm、yarn 的完全兼容
- 无新增依赖项
