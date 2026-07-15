import assert from "node:assert/strict";
import JSZip from "jszip";
import { createDocxBuffer } from "../server/index.js";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lT3g6wAAAABJRU5ErkJggg==";

const content = `
  <h2 style="text-align:center"><span style="font-family:&quot;SimSun&quot;;font-size:18pt;color:#1F4E79">在线标题格式</span></h2>
  <p style="text-align:center;text-indent:24pt">
    <span style="font-family:&quot;Microsoft YaHei&quot;;font-size:14pt;color:#C00000;font-weight:bold">红色加粗字号</span>
    <u>下划线文字</u>
    <em>斜体文字</em>
  </p>
  <table>
    <tbody>
      <tr><th><p>表头 A</p></th><th><p>表头 B</p></th></tr>
      <tr><td><p><strong>单元格 1</strong></p></td><td><p>单元格 2</p></td></tr>
    </tbody>
  </table>
  <div data-page-break="true" class="page-break-marker"></div>
  <p>分页符后的内容</p>
  <p>图片导出测试</p>
  <img src="data:image/png;base64,${tinyPngBase64}" style="width:120px;max-width:100%;height:auto" alt="export image" />
`;

const buffer = await createDocxBuffer({ title: "导出格式保持测试", content });
const zip = await JSZip.loadAsync(buffer);
const documentXml = await zip.file("word/document.xml")?.async("string");
const relationshipsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
const mediaFiles = zip.file(/^word\/media\/.+\.(?:png|jpe?g|gif|webp)$/i);

assert.ok(documentXml, "document.xml should exist");
assert.ok(relationshipsXml, "document relationships should exist");

// 中文注解：直接检查 DOCX XML，确保在线编辑样式没有在 HTML -> Word 转换中被抹掉。
assert.match(documentXml, /<w:jc w:val="center"\/>/);
assert.match(documentXml, /<w:color w:val="C00000"\/>/);
assert.match(documentXml, /<w:sz w:val="28"\/>/);
assert.match(documentXml, /<w:rFonts[^>]+Microsoft YaHei/);
assert.match(documentXml, /<w:b\/>/);
assert.match(documentXml, /<w:u(?:\s+w:val="single")?\/>/);
assert.match(documentXml, /<w:i\/>/);
assert.match(documentXml, /<w:ind[^>]+w:firstLine="480"\/>/);
assert.match(documentXml, /<w:tbl>/);
assert.match(documentXml, /<w:tr>/);
assert.match(documentXml, /<w:tc>/);
assert.match(documentXml, /表头 A/);
assert.match(documentXml, /单元格 1/);
assert.match(documentXml, /<w:br w:type="page"\/>/);

// 中文注解：图片必须进入 DOCX 媒体目录并建立 image relationship，避免导出文件只剩占位文本。
assert.match(documentXml, /<w:drawing>/);
assert.match(relationshipsXml, /relationships\/image/);
assert.ok(mediaFiles.length > 0, "exported DOCX should contain image media");

console.log("DOCX export format check passed");
