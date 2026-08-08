# 开源依赖商业使用说明

## 一、边界

`molinword` 当前 `package.json` 标记为 `private: true`，项目自身未在仓库中授予对外再分发许可证。该设置适合内部或专有商业部署；如果未来要公开源代码或向客户授予源码再分发权，需要由项目所有者另行选择项目许可证。

第三方依赖继续适用各自许可证。本项目不修改、不替代第三方许可证，也不把“依赖允许商用”等同于“项目自身已经开源”。

## 二、自动门禁

执行：

```bash
npm run check:open-source-licenses
npm audit --omit=dev --audit-level=high
```

许可证检查直接读取锁定后的 `package-lock.json`，发现缺失或未审核许可证即失败。依赖升级后必须重新执行，不允许仅检查 `package.json` 中的直接依赖。

需要重点署名的精确包版本还必须登记到 `public/THIRD_PARTY_NOTICES.md`；Vite 构建会复制这份索引，并在构建结束后根据 `package-lock.json` 与 `ops/release-target.json` 声明的生产目标生成 `dist/THIRD_PARTY_LICENSES.txt`。当前基线固定为 Linux x64 glibc，即使在 Windows 构建也必须纳入该目标会安装的可选原生包，不能用构建机平台替代生产平台。完整发布包逐项保留包内 LICENSE、COPYING、COPYRIGHT 和 NOTICE 原文；esbuild、Rollup 的原生平台包未携带许可证文件时，只允许复用经“同版本、同许可证、同上游仓库或锁定归档完整性”校验的主包原文，其他包只能使用受控 SPDX 标准文本并附带目标包元数据署名。门禁在版本变化、许可证缺失、共享上游不一致或无法生成正文时直接失败。

目标服务器切换候选版本前必须通过 `npm run check:release-target`。仓库商业门禁执行的是不依赖构建机平台的 `check:release-target-contract`；它不能替代目标服务器上的真实运行时检查。

当前允许集合包括 MIT、Apache-2.0、BSD、ISC、CC-BY-4.0、BlueOak-1.0.0，以及明确包含 MIT 选项的双许可证表达式。`jszip` 的 `(MIT OR GPL-3.0-or-later)` 在本项目中选择 MIT 选项。

`busboy@1.6.0` 与 `streamsearch@1.1.0` 的锁文件未带 `license` 字段，但包内元数据声明 MIT；检查脚本只为这两个精确版本保留覆盖，版本变化会重新触发人工复核。

## 三、发布责任

- 发布物中必须包含构建生成的 `THIRD_PARTY_LICENSES.txt`，保留生产依赖自带的 LICENSE、NOTICE 和版权信息。
- 对 Apache-2.0、CC-BY-4.0 等要求署名或 NOTICE 的内容保留对应说明。
- 不复制第三方商标、示例素材或模板图片作为自有品牌资产。
- 模板正文、封面、字体和用户上传素材需要单独确认版权与商业授权，代码依赖检查不能替代内容授权检查。
- 每次正式发布都保存许可证检查与 `npm audit` 结果，作为版本审计证据。

本文是工程合规边界说明，不构成法律意见；面向特定国家、行业或客户发布前仍应完成法务复核。
