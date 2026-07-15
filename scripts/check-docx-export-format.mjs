import assert from "node:assert/strict";
import JSZip from "jszip";
import { createDocxBuffer } from "../server/index.js";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lT3g6wAAAABJRU5ErkJggg==";

const content = `
  <h1>Heading one parity</h1>
  <h2 style="text-align:center"><span style="font-family:&quot;SimSun&quot;;font-size:18pt;color:#1F4E79">在线标题格式</span></h2>
  <p style="text-align:center;text-indent:24pt">
    <span style="font-family:&quot;Microsoft YaHei&quot;;font-size:14pt;color:#C00000;font-weight:bold">红色加粗字号</span>
    <u>下划线文字</u>
    <em>斜体文字</em>
  </p>
  <table>
    <tbody>
      <tr><th><p>表头 A</p></th><th><p>表头 B</p></th></tr>
      <tr>
        <td><p><strong>单元格 1</strong></p><ol><li>Table list A</li></ol></td>
        <td><p>单元格 2</p><ol><li>Table list B</li></ol></td>
      </tr>
    </tbody>
  </table>
  <div data-page-break="true" class="page-break-marker"></div>
  <p>分页符后的内容</p>
  <p style="line-height:1.5;margin-top:6pt;margin-bottom:12pt">Spacing paragraph</p>
  <p style="line-height:18pt;--word-line-rule:exact">Exact spacing paragraph</p>
  <p style="margin-top:0pt;margin-bottom:0pt">Zero spacing paragraph</p>
  <ol>
    <li>Ordered item 1<ol><li>Nested ordered item</li></ol></li>
    <li>Ordered item 2</li>
  </ol>
  <ul><li>Bullet item</li></ul>
  <p>图片导出测试</p>
  <img src="data:image/png;base64,${tinyPngBase64}" style="width:120px;max-width:100%;height:auto" alt="export image" />
`;

const buffer = await createDocxBuffer({ title: "导出格式保持测试", content });
const zip = await JSZip.loadAsync(buffer);
const documentXml = await zip.file("word/document.xml")?.async("string");
const relationshipsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
const numberingXml = await zip.file("word/numbering.xml")?.async("string");
const mediaFiles = zip.file(/^word\/media\/.+\.(?:png|jpe?g|gif|webp)$/i);

assert.ok(documentXml, "document.xml should exist");
assert.ok(relationshipsXml, "document relationships should exist");
assert.ok(numberingXml, "numbering.xml should exist");

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
// 中文注解：在线纸张固定使用 A4 和 1 英寸页边距，导出结构必须保持同一可用内容区域。
assert.match(documentXml, /<w:pgSz[^>]+w:w="11906"[^>]+w:h="16838"/);
assert.match(documentXml, /<w:pgMar[^>]+w:top="1440"[^>]+w:right="1440"[^>]+w:bottom="1440"[^>]+w:left="1440"/);

function paragraphXmlForText(text) {
  return (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
    .find((paragraph) => paragraph.includes(`>${text}</w:t>`));
}

const headingOneXml = paragraphXmlForText("Heading one parity");
assert.ok(headingOneXml, "heading one should exist");
assert.match(headingOneXml, /<w:spacing[^>]+w:after="120"/);

const spacingParagraphXml = paragraphXmlForText("Spacing paragraph");
assert.ok(spacingParagraphXml, "spacing paragraph should exist");
// 中文注解：段前、段后和 1.5 倍行距会改变分页位置，必须写入同一个 Word 段落属性。
assert.match(spacingParagraphXml, /<w:spacing[^>]+w:before="120"/);
assert.match(spacingParagraphXml, /<w:spacing[^>]+w:after="240"/);
assert.match(spacingParagraphXml, /<w:spacing[^>]+w:line="360"/);
assert.match(spacingParagraphXml, /<w:spacing[^>]+w:lineRule="auto"/);

const exactSpacingParagraphXml = paragraphXmlForText("Exact spacing paragraph");
assert.ok(exactSpacingParagraphXml, "exact spacing paragraph should exist");
assert.match(exactSpacingParagraphXml, /<w:spacing[^>]+w:line="360"/);
assert.match(exactSpacingParagraphXml, /<w:spacing[^>]+w:lineRule="exact"/);

const zeroSpacingParagraphXml = paragraphXmlForText("Zero spacing paragraph");
assert.ok(zeroSpacingParagraphXml, "zero spacing paragraph should exist");
assert.match(zeroSpacingParagraphXml, /<w:spacing[^>]+w:before="0"/);
assert.match(zeroSpacingParagraphXml, /<w:spacing[^>]+w:after="0"/);

// 中文注解：编号列表、嵌套层级和项目符号必须保留各自语义，不能统一退化为一级圆点。
assert.match(documentXml, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
assert.match(documentXml, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
assert.match(numberingXml, /<w:numFmt w:val="decimal"\/>/);
assert.match(numberingXml, /<w:numFmt w:val="bullet"\/>/);

function listInfoForText(text) {
  const paragraphXml = paragraphXmlForText(text);
  assert.ok(paragraphXml, `list paragraph should exist: ${text}`);
  return {
    level: Number(paragraphXml.match(/<w:ilvl w:val="(\d+)"\/>/)?.[1]),
    numberId: paragraphXml.match(/<w:numId w:val="(\d+)"\/>/)?.[1]
  };
}

function numberFormatForList({ numberId, level }) {
  const numberXml = [...numberingXml.matchAll(/<w:num w:numId="(\d+)">([\s\S]*?)<\/w:num>/g)]
    .find((match) => match[1] === numberId)?.[2] || "";
  const abstractId = numberXml.match(/<w:abstractNumId w:val="(\d+)"\/>/)?.[1];
  const abstractXml = [...numberingXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)]
    .find((match) => match[1] === abstractId)?.[2] || "";
  const levelXml = [...abstractXml.matchAll(/<w:lvl w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)]
    .find((match) => Number(match[1]) === level)?.[2] || "";
  return levelXml.match(/<w:numFmt w:val="([^"]+)"\/>/)?.[1];
}

const orderedItem = listInfoForText("Ordered item 1");
const nestedOrderedItem = listInfoForText("Nested ordered item");
const bulletItem = listInfoForText("Bullet item");
const tableListA = listInfoForText("Table list A");
const tableListB = listInfoForText("Table list B");
assert.equal(orderedItem.level, 0);
assert.equal(nestedOrderedItem.level, 1);
assert.equal(orderedItem.numberId, nestedOrderedItem.numberId);
assert.notEqual(orderedItem.numberId, bulletItem.numberId);
assert.notEqual(tableListA.numberId, tableListB.numberId);
assert.notEqual(tableListA.numberId, orderedItem.numberId);
assert.notEqual(tableListB.numberId, orderedItem.numberId);
// 中文注解：把具体段落的 numId 追溯到抽象编号定义，防止 decimal 与 bullet 被对调后测试仍误通过。
assert.equal(numberFormatForList(orderedItem), "decimal");
assert.equal(numberFormatForList(nestedOrderedItem), "decimal");
assert.equal(numberFormatForList(bulletItem), "bullet");

// 中文注解：图片必须进入 DOCX 媒体目录并建立 image relationship，避免导出文件只剩占位文本。
assert.match(documentXml, /<w:drawing>/);
assert.match(relationshipsXml, /relationships\/image/);
assert.ok(mediaFiles.length > 0, "exported DOCX should contain image media");
// 中文注解：方形图片必须按真实比例写入 DrawingML，不能退化为固定的 0.62 假比例。
assert.match(documentXml, /<wp:extent cx="1143000" cy="1143000"\/>/);

console.log("DOCX export format check passed");
