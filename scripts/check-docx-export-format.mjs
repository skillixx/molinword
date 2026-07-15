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
    <s>删除线文字</s>
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

const buffer = await createDocxBuffer({
  title: "导出格式保持测试",
  content,
  pageLayout: {
    headerText: "默认奇数页眉",
    headerStyle: { alignment: "left", fontFamily: "Arial", fontSizePt: 11.5, color: "#123456", bold: true, italic: true },
    footerText: "默认奇数页脚",
    footerStyle: { alignment: "right", fontFamily: "SimSun", fontSizePt: 10, color: "#654321", bold: false, italic: false },
    pageNumberEnabled: true,
    firstPageDifferent: true,
    firstPage: { headerText: "首页页眉", footerText: "首页页脚", pageNumberEnabled: false },
    oddEvenDifferent: true,
    evenPage: { headerText: "偶数页眉", footerText: "偶数页脚", pageNumberEnabled: true },
    headerDistance: 480,
    footerDistance: 840
  }
});
const zip = await JSZip.loadAsync(buffer);
const documentXml = await zip.file("word/document.xml")?.async("string");
const relationshipsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
const numberingXml = await zip.file("word/numbering.xml")?.async("string");
const settingsXml = await zip.file("word/settings.xml")?.async("string");
const headerXmlParts = await Promise.all(zip.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")));
const footerXmlParts = await Promise.all(zip.file(/^word\/footer\d+\.xml$/).map((file) => file.async("string")));
const mediaFiles = zip.file(/^word\/media\/.+\.(?:png|jpe?g|gif|webp)$/i);

assert.ok(documentXml, "document.xml should exist");
assert.ok(relationshipsXml, "document relationships should exist");
assert.ok(numberingXml, "numbering.xml should exist");
assert.equal(headerXmlParts.length, 3, "default, first and even headers should exist");
assert.equal(footerXmlParts.length, 3, "default, first and even footers should exist");

// 中文注解：页眉页脚格式必须进入独立部件，在线设置的基础办公样式不能只停留在页面预览。
assert.ok(headerXmlParts.some((xml) => /<w:jc w:val="left"\/>/.test(xml) && /<w:rFonts[^>]+Arial/.test(xml) && /<w:sz w:val="23"\/>/.test(xml) && /<w:color w:val="123456"\/>/.test(xml) && /<w:b\/>/.test(xml) && /<w:i\/>/.test(xml)));
assert.ok(footerXmlParts.some((xml) => /<w:jc w:val="right"\/>/.test(xml) && /<w:rFonts[^>]+SimSun/.test(xml) && /<w:sz w:val="20"\/>/.test(xml) && /<w:color w:val="654321"\/>/.test(xml)));

const headerPageNumberBuffer = await createDocxBuffer({
  title: "Header page number",
  content: "<p>Body</p>",
  pageLayout: {
    headerText: "",
    footerText: "",
    headerPageNumberTemplate: "Page {PAGE:upperRoman} of {NUMPAGES}",
    footerPageNumberTemplate: "Total {NUMPAGES}",
    pageNumberFormat: "lowerRoman",
    pageNumberStart: 0
  }
});
const headerPageNumberZip = await JSZip.loadAsync(headerPageNumberBuffer);
const headerPageNumberXml = (await Promise.all(headerPageNumberZip.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")))).join("\n");
const footerWithoutPageNumberXml = (await Promise.all(headerPageNumberZip.file(/^word\/footer\d+\.xml$/).map((file) => file.async("string")))).join("\n");
// 中文注解：页码位置是在线页面模型的一部分，选择页眉后动态域只能写入页眉部件。
assert.match(headerPageNumberXml, /Page /);
assert.match(headerPageNumberXml, / of /);
assert.match(headerPageNumberXml, /<w:fldSimple[^>]+w:instr="PAGE \\[*] ROMAN"/);
assert.match(headerPageNumberXml, /<\/w:r><w:fldSimple[^>]+w:instr="PAGE \\[*] ROMAN"/);
assert.match(headerPageNumberXml, /<w:fldSimple[^>]+w:instr="PAGE \\[*] ROMAN"><w:r><w:rPr>/);
assert.match(footerWithoutPageNumberXml, /Total /);
assert.match(footerWithoutPageNumberXml, /<w:fldSimple[^>]+w:instr="NUMPAGES"/);
assert.doesNotMatch(footerWithoutPageNumberXml, /<w:fldSimple[^>]+w:instr="PAGE"/);
const headerPageNumberDocumentXml = await headerPageNumberZip.file("word/document.xml")?.async("string") || "";
assert.match(headerPageNumberDocumentXml, /<w:pgNumType[^>]+w:start="0"[^>]*w:fmt="lowerRoman"/);

const multiParagraphHeaderBuffer = await createDocxBuffer({
  title: "Multi paragraph header",
  content: "<p>Body</p>",
  pageLayout: {
    headerText: "项目名称：智慧办公平台\n\n文档状态：内部评审",
    headerPageNumberTemplate: "第 {PAGE} 页 / 共 {NUMPAGES} 页",
    headerPageNumberSeparate: true,
    headerStyle: { alignment: "right", fontFamily: "SimSun", fontSizePt: 10.5, color: "#345678", bold: false, italic: false }
  }
});
const multiParagraphHeaderZip = await JSZip.loadAsync(multiParagraphHeaderBuffer);
const multiParagraphHeaderXml = (await Promise.all(multiParagraphHeaderZip.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")))).join("\n");
const multiParagraphHeaderParagraphs = multiParagraphHeaderXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
// 中文注解：多行在线页眉必须导出为独立 Word 段落，页码保留为末段，不能写成一个含换行字符的文本 run。
assert.equal(multiParagraphHeaderParagraphs.length, 4);
assert.ok(multiParagraphHeaderParagraphs[0].includes("项目名称：智慧办公平台"));
assert.doesNotMatch(multiParagraphHeaderParagraphs[1], /<w:t/);
assert.ok(multiParagraphHeaderParagraphs[2].includes("文档状态：内部评审"));
assert.match(multiParagraphHeaderParagraphs[3], /<w:fldSimple[^>]+w:instr="PAGE"/);
assert.ok(multiParagraphHeaderParagraphs.every((paragraph) => /<w:jc w:val="right"\/>/.test(paragraph)));

const inlineLastParagraphBuffer = await createDocxBuffer({
  title: "Inline page number after multiple paragraphs",
  content: "<p>Body</p>",
  pageLayout: { footerText: "保密文件\n技术中心", footerPageNumberTemplate: "第 {PAGE} 页", footerPageNumberSeparate: false }
});
const inlineLastParagraphZip = await JSZip.loadAsync(inlineLastParagraphBuffer);
const inlineLastParagraphXml = (await Promise.all(inlineLastParagraphZip.file(/^word\/footer\d+\.xml$/).map((file) => file.async("string")))).join("\n");
const inlineLastParagraphs = inlineLastParagraphXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
// 中文注解：关闭“独立一行”时，页码应追加到最后一个文字段，而不是因前面存在换行就强制新增段落。
assert.equal(inlineLastParagraphs.length, 2);
assert.ok(inlineLastParagraphs[1].includes("技术中心") && /<w:fldSimple[^>]+w:instr="PAGE"/.test(inlineLastParagraphs[1]));

// 中文注解：直接检查 DOCX XML，确保在线编辑样式没有在 HTML -> Word 转换中被抹掉。
assert.match(documentXml, /<w:jc w:val="center"\/>/);
assert.match(documentXml, /<w:color w:val="C00000"\/>/);
assert.match(documentXml, /<w:sz w:val="28"\/>/);
assert.match(documentXml, /<w:rFonts[^>]+Microsoft YaHei/);
assert.match(documentXml, /<w:rFonts[^>]+SimSun/);
assert.match(documentXml, /<w:b\/>/);
assert.match(documentXml, /<w:u(?:\s+w:val="single")?\/>/);
assert.match(documentXml, /<w:i\/>/);
assert.match(documentXml, /<w:strike\/>/);
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
assert.match(documentXml, /<w:pgMar[^>]+w:header="480"[^>]+w:footer="840"/);
assert.match(documentXml, /<w:headerReference w:type="first"/);
assert.match(documentXml, /<w:headerReference w:type="even"/);
assert.match(documentXml, /<w:titlePg\/>/);
assert.match(settingsXml, /<w:evenAndOddHeaders\/>/);
assert.ok(headerXmlParts.some((xml) => xml.includes("默认奇数页眉")));
assert.ok(headerXmlParts.some((xml) => xml.includes("首页页眉")));
assert.ok(headerXmlParts.some((xml) => xml.includes("偶数页眉")));
assert.ok(footerXmlParts.some((xml) => xml.includes("默认奇数页脚")));
assert.ok(footerXmlParts.some((xml) => xml.includes("首页页脚")));
assert.ok(footerXmlParts.some((xml) => xml.includes("偶数页脚")));
assert.equal(footerXmlParts.filter((xml) => /<w:fldSimple[^>]+w:instr="PAGE"/.test(xml)).length, 2);
assert.equal(footerXmlParts.filter((xml) => /<w:fldSimple[^>]+w:instr="NUMPAGES"/.test(xml)).length, 2);

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

const secondSectionLayout = {
  headerText: "Landscape section header",
  footerText: "Landscape section footer",
  pageNumberEnabled: true,
  firstPageDifferent: false,
  firstPage: { headerText: "", footerText: "", pageNumberEnabled: false },
  oddEvenDifferent: false,
  evenPage: { headerText: "", footerText: "", pageNumberEnabled: false },
  orientation: "landscape",
  margins: { top: 720, right: 900, bottom: 720, left: 900 }
};
const sectionLayoutAttribute = JSON.stringify(secondSectionLayout)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const sectionBuffer = await createDocxBuffer({
  title: "Multi section export",
  content: `<p>Portrait section</p><div data-section-break="nextPage" data-section-layout="${sectionLayoutAttribute}"></div><p>Landscape section</p>`,
  pageLayout: {
    headerText: "Portrait section header",
    footerText: "Portrait section footer",
    pageNumberEnabled: false,
    oddEvenDifferent: true,
    evenPage: { headerText: "Portrait even header", footerText: "Portrait even footer", pageNumberEnabled: false },
    orientation: "portrait",
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
  }
});
const sectionZip = await JSZip.loadAsync(sectionBuffer);
const sectionDocumentXml = await sectionZip.file("word/document.xml")?.async("string") || "";
const sectionHeaders = await Promise.all(sectionZip.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")));
// 中文注解：分节符必须生成两个原生 Word 节，第二节独立使用横向纸张、页边距和页眉，不能退化成普通分页符。
assert.equal((sectionDocumentXml.match(/<w:sectPr(?:\s|>)/g) || []).length, 2);
assert.match(sectionDocumentXml, /<w:type w:val="nextPage"\/>/);
assert.match(sectionDocumentXml, /<w:pgSz[^>]+w:w="16838"[^>]+w:h="11906"[^>]+w:orient="landscape"/);
assert.match(sectionDocumentXml, /<w:pgMar[^>]+w:top="720"[^>]+w:right="900"[^>]+w:bottom="720"[^>]+w:left="900"/);
assert.ok(sectionHeaders.some((xml) => xml.includes("Portrait section header")));
assert.ok(sectionHeaders.some((xml) => xml.includes("Landscape section header")));
// 中文注解：奇偶页开关是文档级，第二节关闭差异时仍需显式生成与默认页相同的偶数页部件，阻断前节继承。
assert.equal(sectionHeaders.filter((xml) => xml.includes("Landscape section header")).length, 2);

const constrainedMarginBuffer = await createDocxBuffer({
  title: "Constrained margins",
  content: "<p>Body</p>",
  pageLayout: { orientation: "portrait", margins: { top: 7200, right: 7200, bottom: 7200, left: 7200 } }
});
const constrainedMarginZip = await JSZip.loadAsync(constrainedMarginBuffer);
const constrainedMarginXml = await constrainedMarginZip.file("word/document.xml")?.async("string") || "";
const constrainedMarginMatch = constrainedMarginXml.match(/<w:pgMar[^>]+w:top="(\d+)"[^>]+w:right="(\d+)"[^>]+w:bottom="(\d+)"[^>]+w:left="(\d+)"/);
assert.ok(constrainedMarginMatch);
const [, constrainedTop, constrainedRight, constrainedBottom, constrainedLeft] = constrainedMarginMatch.map(Number);
assert.ok(constrainedLeft + constrainedRight <= 11906 - 720);
assert.ok(constrainedTop + constrainedBottom <= 16838 - 720);

console.log("DOCX export format check passed");
