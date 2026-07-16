import assert from "node:assert/strict";
import { legacyDocTextToHtml } from "../server/index.js";

const importedHtml = legacyDocTextToHtml("一、黑色标题\n正文内容");

// 中文注解：旧版 DOC 只能提取纯文本，标题必须显式保留 Word 默认黑色，不能继承在线编辑器的模板主题色。
assert.match(importedHtml, /^<h2><span style="color: #000000">一、黑色标题<\/span><\/h2>/);
assert.match(importedHtml, /<p>正文内容<\/p>$/);

console.log("旧版 DOC 标题颜色检查通过。", { importedHtml });
