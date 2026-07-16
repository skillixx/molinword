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
    <mark data-highlight="yellow" style="background-color:#FFFF00">突出显示文字</mark>
    <mark data-highlight="darkCyan" style="background-color:#008080">深青色突出显示</mark>
    <sup>上标文字</sup>
    <sub>下标文字</sub>
    <span style="letter-spacing:2pt;vertical-align:3pt">Advanced character spacing</span>
    <span style="text-decoration-line:underline;text-decoration-style:double;text-decoration-color:#00AA00;--word-underline-type:double">Advanced double underline</span>
    <span style="text-transform:uppercase">All caps export source</span>
    <span style="font-variant-caps:small-caps">Small caps export source</span>
    <span data-double-strike="true" style="text-decoration-line:line-through;text-decoration-style:double">Double strike export source</span>
    <span style="border-top:2px double #C00000;border-right:2px double #C00000;border-bottom:2px double #C00000;border-left:2px double #C00000;padding-top:2.67px;padding-right:2.67px;padding-bottom:2.67px;padding-left:2.67px;--word-text-border:double,12,C00000,2">Run border export source</span>
  </p>
  <table data-table-alignment="left" data-table-indent="720" style="margin-left:48px;margin-right:auto">
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
  <p>Column break before</p>
  <div data-column-break="true" class="column-break-marker"></div>
  <p>Column break after</p>
  <p style="line-height:1.5;margin-top:6pt;margin-bottom:12pt">Spacing paragraph</p>
  <h4 data-outline-level="3">Fourth-level heading</h4>
  <p data-outline-level="7">Eighth-level outline paragraph</p>
  <p style="line-height:18pt;--word-line-rule:exact">Exact spacing paragraph</p>
  <p style="margin-left:36pt;text-indent:-18pt">Hanging indent export</p>
  <p style="margin-left:24pt;margin-right:18pt">Side indents export</p>
  <p style="margin-top:0pt;margin-bottom:0pt">Zero spacing paragraph</p>
  <p data-keep-next="true" data-keep-lines="true" data-page-break-before="true" data-widow-control="true">Pagination controlled paragraph</p>
  <p data-widow-control="false">Widow control disabled paragraph</p>
  <p data-bidirectional="true" style="direction:rtl">RTL paragraph export</p>
  <p>Export inter\u00ADnational code\u20112026</p>
  <p>Manual line one<br>Manual line two</p>
  <p>Footnote export source<span class="footnote-reference" data-footnote-id="7" data-footnote-text="Exported footnote detail">7</span></p>
  <p>Endnote export source<span class="endnote-reference" data-endnote-id="8" data-endnote-text="Exported endnote detail">8</span></p>
  <p>Comment export <span class="comment-mark" data-comment-id="9" data-comment-text="Exported review note" data-comment-author="Review User" data-comment-initials="RU" data-comment-date="2026-07-16T02:00:00.000Z">reviewed text</span></p>
  <p data-paragraph-shading='{"fill":"#DDEBF7","color":"#000000","type":"clear"}' data-paragraph-borders='{"top":{"style":"single","size":8,"color":"#FF0000","space":4},"right":{"style":"dashed","size":6,"color":"#00AA00","space":3},"bottom":{"style":"double","size":12,"color":"#0000FF","space":2},"left":{"style":"nil","size":0,"color":"#000000","space":0},"between":{"style":"dotted","size":4,"color":"#888888","space":1}}' style="background-color:#DDEBF7;border-top:1.33px solid #FF0000;padding-top:5.33px">Paragraph appearance export</p>
  <p data-tab-stops='[{"alignment":"left","position":1440},{"alignment":"right","position":5760}]'>Tab project<span class="docx-tab" data-docx-tab="true" data-tab-position="1440" data-tab-alignment="left"></span>Tab amount<span class="docx-tab" data-docx-tab="true" data-tab-position="5760" data-tab-alignment="right"></span>100.00</p>
  <p>查看 <a href="https://example.com/report?from=editor" target="_blank" rel="noopener noreferrer">Linked report</a></p>
  <table data-table-width-type="dxa" data-table-width-value="6000" data-table-grid-width="6000" data-table-layout="fixed" data-table-alignment="right" data-table-cell-spacing="120" data-table-borders='{"top":{"style":"single","size":8,"color":"#FF0000"},"right":{"style":"dashed","size":6,"color":"#00AA00"},"bottom":{"style":"double","size":12,"color":"#0000FF"},"left":{"style":"nil","size":0,"color":"#000000"},"insideHorizontal":{"style":"dotted","size":4,"color":"#888888"},"insideVertical":{"style":"single","size":4,"color":"#000000"}}' style="width:400px;margin-left:auto;margin-right:0px;table-layout:fixed;border-collapse:separate;border-spacing:8px"><tbody><tr data-row-height="720" data-row-height-rule="exact" data-row-cant-split="true" data-row-repeat-header="true" style="height:48px"><th colwidth="120" data-docx-cell="true" data-cell-margins='{"top":100,"right":600,"bottom":300,"left":400}' data-cell-vertical-align="center" data-cell-text-direction="tbRl" data-cell-shading="#D9EAD3" data-cell-borders='{"top":{"style":"single","size":8,"color":"#FF0000"},"right":{"style":"double","size":16,"color":"#800080"},"bottom":{"style":"dotted","size":4,"color":"#888888"},"left":{"style":"nil","size":0,"color":"#000000"}}' style="padding-top:6.67px;padding-right:40px;padding-bottom:20px;padding-left:26.67px;vertical-align:middle;writing-mode:sideways-rl;background-color:#D9EAD3;border-top:1.33px solid #FF0000;border-right:2.67px double #800080;border-bottom:0.67px dotted #888888;border-left:none"><p>Geometry A</p></th><th colwidth="280" data-docx-cell="true" data-cell-text-direction="btLr" style="writing-mode:sideways-lr"><p>Geometry B</p></th></tr><tr><td colwidth="120"><p>Short</p></td><td colwidth="280"><p>Wide content</p></td></tr></tbody></table>
  <ol>
    <li>Ordered item 1<ol><li>Nested ordered item</li></ol></li>
    <li>Ordered item 2</li>
  </ol>
  <ol data-list-format="upperRoman" style="list-style-type:upper-roman"><li>Roman item 1</li><li>Roman item 2</li></ol>
  <ol start="5" data-list-format="upperLetter" style="list-style-type:upper-alpha"><li>Started letter item</li></ol>
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
    footerDistance: 840,
    gutter: 360,
    paperSize: { width: 12240, height: 15840 },
    columns: {
      count: 2,
      space: 720,
      separate: true,
      equalWidth: false,
      items: [{ width: 3000, space: 720 }, { width: 5306, space: 0 }]
    },
    verticalAlign: "bottom",
    pageBorders: {
      display: "notFirstPage",
      offsetFrom: "text",
      zOrder: "back",
      top: { style: "dashed", size: 8, color: "#C00000", space: 12 },
      right: { style: "dashed", size: 8, color: "#C00000", space: 12 },
      bottom: { style: "dashed", size: 8, color: "#C00000", space: 12 },
      left: { style: "dashed", size: 8, color: "#C00000", space: 12 }
    }
  }
});
const zip = await JSZip.loadAsync(buffer);
const documentXml = await zip.file("word/document.xml")?.async("string");
const relationshipsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
const numberingXml = await zip.file("word/numbering.xml")?.async("string");
const settingsXml = await zip.file("word/settings.xml")?.async("string");
const headerXmlParts = await Promise.all(zip.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")));
const footerXmlParts = await Promise.all(zip.file(/^word\/footer\d+\.xml$/).map((file) => file.async("string")));
const footnotesXml = await zip.file("word/footnotes.xml")?.async("string") || "";
const endnotesXml = await zip.file("word/endnotes.xml")?.async("string") || "";
const commentsXml = await zip.file("word/comments.xml")?.async("string") || "";
const mediaFiles = zip.file(/^word\/media\/.+\.(?:png|jpe?g|gif|webp)$/i);

assert.ok(documentXml, "document.xml should exist");
assert.ok(relationshipsXml, "document relationships should exist");
assert.ok(numberingXml, "numbering.xml should exist");
assert.match(documentXml, /<w:footnoteReference w:id="7"\/>/);
assert.match(relationshipsXml, /relationships\/footnotes" Target="footnotes\.xml"/);
assert.match(footnotesXml, /<w:footnote w:id="7">[\s\S]*Exported footnote detail[\s\S]*<\/w:footnote>/);
assert.match(documentXml, /<w:endnoteReference w:id="8"\/>/);
assert.match(relationshipsXml, /relationships\/endnotes" Target="endnotes\.xml"/);
assert.match(endnotesXml, /<w:endnote w:id="8">[\s\S]*Exported endnote detail[\s\S]*<\/w:endnote>/);
assert.match(documentXml, /<w:commentRangeStart w:id="9"\/>[\s\S]*reviewed text[\s\S]*<w:commentRangeEnd w:id="9"\/>[\s\S]*<w:commentReference w:id="9"\/>/);
assert.match(relationshipsXml, /relationships\/comments" Target="comments\.xml"/);
assert.match(commentsXml, /<w:comment(?=[^>]+w:id="9")(?=[^>]+w:author="Review User")(?=[^>]+w:initials="RU")[^>]*>[\s\S]*Exported review note[\s\S]*<\/w:comment>/);
// 中文注解：在线链接必须写入原生 DOCX hyperlink 关系，不能退化成仅有蓝色下划线的普通文字。
assert.match(documentXml, /<w:hyperlink[^>]+r:id="[^"]+"[^>]*>[\s\S]*Linked report[\s\S]*<\/w:hyperlink>/);
assert.match(relationshipsXml, /Target="https:\/\/example\.com\/report\?from=editor" TargetMode="External"/);
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
assert.match(documentXml, /<w:highlight w:val="yellow"\/>/);
const darkCyanHighlightXml = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("深青色突出显示")) || "";
assert.match(darkCyanHighlightXml, /<w:highlight w:val="darkCyan"\/>/);
assert.match(documentXml, /<w:vertAlign w:val="superscript"\/>/);
assert.match(documentXml, /<w:vertAlign w:val="subscript"\/>/);
assert.match(documentXml, /<w:ind[^>]+w:firstLine="480"\/>/);
assert.match(documentXml, /<w:tbl>/);
assert.match(documentXml, /<w:tr>/);
assert.match(documentXml, /<w:tc>/);
assert.match(documentXml, /表头 A/);
assert.match(documentXml, /单元格 1/);
assert.match(documentXml, /<w:br w:type="page"\/>/);
assert.match(documentXml, /<w:br w:type="column"\/>/);
// 中文注解：在线选择的 Letter 纸张必须原样写入分节属性，不能在导出时退回 A4。
assert.match(documentXml, /<w:pgSz[^>]+w:w="12240"[^>]+w:h="15840"/);
assert.match(documentXml, /<w:pgMar[^>]+w:top="1440"[^>]+w:right="1440"[^>]+w:bottom="1440"[^>]+w:left="1440"/);
assert.match(documentXml, /<w:pgMar[^>]+w:header="480"[^>]+w:footer="840"/);
assert.match(documentXml, /<w:pgMar[^>]+w:gutter="360"/);
assert.match(documentXml, /<w:cols[^>]+w:num="2"[^>]+w:sep="true"[^>]+w:equalWidth="false"/);
assert.match(documentXml, /<w:col w:w="2991" w:space="720"\/><w:col w:w="5289"\/>/);
assert.match(documentXml, /<w:pgBorders[^>]+w:display="notFirstPage"[^>]+w:offsetFrom="text"[^>]+w:zOrder="back"/);
assert.match(documentXml, /<w:top w:val="dashed" w:color="C00000" w:sz="8" w:space="12"\/>/);
assert.match(documentXml, /<w:vAlign w:val="bottom"\/>/);
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
const advancedCharacterXml = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Advanced character spacing")) || "";
assert.match(advancedCharacterXml, /<w:spacing w:val="40"\/>/);
assert.match(advancedCharacterXml, /<w:position w:val="6"\/>/);
const advancedUnderlineXml = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Advanced double underline")) || "";
assert.match(advancedUnderlineXml, /<w:u w:val="double" w:color="00AA00"\/>/);
const allCapsXml = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("All caps export source")) || "";
const smallCapsXml = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Small caps export source")) || "";
assert.match(allCapsXml, /<w:caps\/>/);
assert.match(smallCapsXml, /<w:smallCaps\/>/);
const doubleStrikeXml = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Double strike export source")) || "";
assert.match(doubleStrikeXml, /<w:dstrike\/>/);
assert.doesNotMatch(doubleStrikeXml, /<w:strike(?:\s|\/|>)/);
const runBorderXml = (documentXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Run border export source")) || "";
assert.match(runBorderXml, /<w:bdr[^>]+w:val="double"[^>]+w:color="C00000"[^>]+w:sz="12"[^>]+w:space="2"\/>/);

const spacingParagraphXml = paragraphXmlForText("Spacing paragraph");
assert.ok(spacingParagraphXml, "spacing paragraph should exist");
// 中文注解：段前、段后和 1.5 倍行距会改变分页位置，必须写入同一个 Word 段落属性。
assert.match(spacingParagraphXml, /<w:spacing[^>]+w:before="120"/);
const hangingIndentXml = paragraphXmlForText("Hanging indent export");
assert.match(hangingIndentXml, /<w:ind(?=[^>]+w:left="720")(?=[^>]+w:hanging="360")[^>]*\/>/);
const sideIndentsXml = paragraphXmlForText("Side indents export");
assert.match(sideIndentsXml, /<w:ind(?=[^>]+w:left="480")(?=[^>]+w:right="360")[^>]*\/>/);
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
const paginationControlledParagraphXml = paragraphXmlForText("Pagination controlled paragraph");
assert.match(paginationControlledParagraphXml, /<w:keepNext\/>/);
assert.match(paginationControlledParagraphXml, /<w:keepLines\/>/);
assert.match(paginationControlledParagraphXml, /<w:pageBreakBefore\/>/);
assert.match(paginationControlledParagraphXml, /<w:widowControl\/>/);
const widowDisabledParagraphXml = paragraphXmlForText("Widow control disabled paragraph");
assert.match(widowDisabledParagraphXml, /<w:widowControl w:val="false"\/>/);
const rtlParagraphXml = paragraphXmlForText("RTL paragraph export");
assert.match(rtlParagraphXml, /<w:bidi\/>/);
const specialHyphenParagraphXml = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Export inter") && paragraph.includes("2026")) || "";
assert.match(specialHyphenParagraphXml, /inter[\s\S]*?<w:softHyphen\/>[\s\S]*?national code[\s\S]*?<w:noBreakHyphen\/>[\s\S]*?2026/);
const manualLineBreakParagraphXml = (documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Manual line one") && paragraph.includes("Manual line two")) || "";
// 中文注解：编辑器内的 Shift+Enter 必须导出为 Word 原生换行，不能丢失或拆成两个段落。
assert.match(manualLineBreakParagraphXml, /Manual line one[\s\S]*?<w:br\/>[\s\S]*?Manual line two/);
const appearanceParagraphXml = paragraphXmlForText("Paragraph appearance export");
assert.match(appearanceParagraphXml, /<w:shd[^>]+w:fill="DDEBF7"/);
assert.match(appearanceParagraphXml, /<w:pBdr>[\s\S]*<w:top[^>]+w:val="single"[^>]+w:color="FF0000"[^>]+w:sz="8"[^>]+w:space="4"/);
assert.match(appearanceParagraphXml, /<w:between[^>]+w:val="dotted"[^>]+w:color="888888"[^>]+w:sz="4"[^>]+w:space="1"/);
const tabParagraphXml = paragraphXmlForText("Tab project");
assert.match(tabParagraphXml, /<w:tabs><w:tab w:val="left" w:pos="1440"\/><w:tab w:val="right" w:pos="5760"\/><\/w:tabs>/);
assert.equal((tabParagraphXml.match(/<w:tab\/>/g) || []).length, 2);
const geometryTableXml = (documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((table) => table.includes("Geometry A")) || "";
assert.match(geometryTableXml, /<w:jc w:val="right"\/>/);
assert.match(geometryTableXml, /<w:tblW w:type="dxa" w:w="6000"\/>/);
assert.match(geometryTableXml, /<w:tblLayout w:type="fixed"\/>/);
assert.match(geometryTableXml, /<w:tblCellSpacing(?=[^>]+w:type="dxa")(?=[^>]+w:w="120")[^>]*\/>/);
const indentedTableXml = (documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((table) => table.includes("Table list A")) || "";
assert.match(indentedTableXml, /<w:jc w:val="left"\/>/);
assert.match(indentedTableXml, /<w:tblInd w:type="dxa" w:w="720"\/>/);
const geometryTableBordersXml = geometryTableXml.match(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/)?.[0] || "";
assert.match(geometryTableBordersXml, /<w:top w:val="single" w:color="FF0000" w:sz="8"\/>/);
assert.match(geometryTableBordersXml, /<w:insideH w:val="dotted" w:color="888888" w:sz="4"\/>/);
assert.match(geometryTableXml, /<w:tblGrid><w:gridCol w:w="1800"\/><w:gridCol w:w="4200"\/><\/w:tblGrid>/);
assert.match(geometryTableXml, /<w:tcW w:type="dxa" w:w="1800"\/>/);
assert.match(geometryTableXml, /<w:tcW w:type="dxa" w:w="4200"\/>/);
const geometryRowXml = geometryTableXml.match(/<w:tr>[\s\S]*?<\/w:tr>/)?.[0] || "";
assert.match(geometryRowXml, /<w:tblHeader\/>/);
assert.match(geometryRowXml, /<w:cantSplit\/>/);
assert.match(geometryRowXml, /<w:trHeight w:val="720" w:hRule="exact"\/>/);
const geometryCellXml = (geometryTableXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).find((cell) => cell.includes("Geometry A")) || "";
for (const [side, width] of [["top", 100], ["right", 600], ["bottom", 300], ["left", 400]]) assert.match(geometryCellXml, new RegExp(`<w:${side} w:type="dxa" w:w="${width}"\\/>`));
assert.match(geometryCellXml, /<w:shd w:fill="D9EAD3"\/>/);
assert.match(geometryCellXml, /<w:vAlign w:val="center"\/>/);
assert.match(geometryCellXml, /<w:textDirection w:val="tbRl"\/>/);
const reverseGeometryCellXml = (geometryTableXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).find((cell) => cell.includes("Geometry B")) || "";
assert.match(reverseGeometryCellXml, /<w:textDirection w:val="btLr"\/>/);
const geometryCellBordersXml = geometryCellXml.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/)?.[0] || "";
assert.match(geometryCellBordersXml, /<w:right w:val="double" w:color="800080" w:sz="16"\/>/);
assert.match(geometryCellBordersXml, /<w:left w:val="nil" w:color="000000" w:sz="0"\/>/);

// 中文注解：编号列表、嵌套层级和项目符号必须保留各自语义，不能统一退化为一级圆点。
assert.match(documentXml, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
assert.match(documentXml, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
const fourthLevelHeadingXml = paragraphXmlForText("Fourth-level heading");
const eighthLevelOutlineXml = paragraphXmlForText("Eighth-level outline paragraph");
assert.match(fourthLevelHeadingXml, /<w:pStyle w:val="Heading4"\/>/);
assert.match(fourthLevelHeadingXml, /<w:outlineLvl w:val="3"\/>/);
assert.match(eighthLevelOutlineXml, /<w:outlineLvl w:val="7"\/>/);
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

function numberingLevelXml({ numberId, level }) {
  const numberXml = [...numberingXml.matchAll(/<w:num w:numId="(\d+)">([\s\S]*?)<\/w:num>/g)]
    .find((match) => match[1] === numberId)?.[2] || "";
  const abstractId = numberXml.match(/<w:abstractNumId w:val="(\d+)"\/>/)?.[1];
  const abstractXml = [...numberingXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)]
    .find((match) => match[1] === abstractId)?.[2] || "";
  const levelXml = [...abstractXml.matchAll(/<w:lvl w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)]
    .find((match) => Number(match[1]) === level)?.[2] || "";
  return levelXml;
}

function numberFormatForList(list) {
  return numberingLevelXml(list).match(/<w:numFmt w:val="([^"]+)"\/>/)?.[1];
}

function numberStartForList(list) {
  return Number(numberingLevelXml(list).match(/<w:start w:val="(\d+)"\/>/)?.[1] || 1);
}

const orderedItem = listInfoForText("Ordered item 1");
const nestedOrderedItem = listInfoForText("Nested ordered item");
const bulletItem = listInfoForText("Bullet item");
const romanItem = listInfoForText("Roman item 1");
const startedLetterItem = listInfoForText("Started letter item");
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
assert.equal(numberFormatForList(romanItem), "upperRoman");
assert.equal(numberFormatForList(startedLetterItem), "upperLetter");
// 中文注解：起始值必须写入该列表实际引用的抽象编号层级，不能只保留在网页样式里。
assert.equal(numberStartForList(startedLetterItem), 5);

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
  columns: { count: 3, space: 360, separate: true },
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
const landscapeSectionXml = (sectionDocumentXml.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g) || []).find((section) => /w:orient="landscape"/.test(section)) || "";
assert.match(landscapeSectionXml, /<w:cols[^>]+w:space="360"[^>]+w:num="3"[^>]+w:sep="true"[^>]+w:equalWidth="true"/);
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

const pageImageBuffer = await createDocxBuffer({
  title: "Header and footer images",
  content: "<p>Body</p>",
  pageLayout: {
    headerText: "项目页眉",
    headerImages: [{ id: "header-logo", fileId: null, src: `data:image/png;base64,${tinyPngBase64}`, alt: "企业标识", widthPx: 120, heightPx: 60, paragraphIndex: 0, placement: "beforeText", alignment: "left" }],
    footerImages: [{ id: "footer-mark", fileId: null, src: `data:image/png;base64,${tinyPngBase64}`, alt: "页脚标识", widthPx: 40, heightPx: 20, paragraphIndex: 0, placement: "afterText", alignment: "right" }]
  }
});
const pageImageZip = await JSZip.loadAsync(pageImageBuffer);
const pageImageHeaders = await Promise.all(pageImageZip.file(/^word\/header\d+\.xml$/).map((file) => file.async("string")));
const pageImageFooters = await Promise.all(pageImageZip.file(/^word\/footer\d+\.xml$/).map((file) => file.async("string")));
const pageImageRelationships = await Promise.all(pageImageZip.file(/^word\/_rels\/(?:header|footer)\d+\.xml\.rels$/).map((file) => file.async("string")));
assert.ok(pageImageHeaders.some((xml) => /<w:drawing>/.test(xml) && /<wp:extent cx="1143000" cy="571500"/.test(xml) && xml.indexOf("<w:drawing>") < xml.indexOf("项目页眉")));
assert.ok(pageImageFooters.some((xml) => /<w:drawing>/.test(xml) && /<wp:extent cx="381000" cy="190500"/.test(xml)));
assert.ok(pageImageRelationships.some((xml) => /relationships\/image/.test(xml)));
assert.ok(pageImageZip.file(/^word\/media\/.+\.png$/).length >= 1);

const mergedTableBuffer = await createDocxBuffer({
  title: "Merged table cells",
  content: `<table><tbody><tr><th colspan="2">审批事项</th><th>状态</th></tr><tr><td rowspan="2" colspan="2">跨行结论</td><td>已批准</td></tr><tr><td>已归档</td></tr></tbody></table>`
});
const mergedTableZip = await JSZip.loadAsync(mergedTableBuffer);
const mergedTableXml = await mergedTableZip.file("word/document.xml")?.async("string") || "";
assert.ok((mergedTableXml.match(/<w:gridSpan w:val="2"\/>/g) || []).length >= 3);
assert.match(mergedTableXml, /<w:vMerge w:val="restart"\/>/);
assert.match(mergedTableXml, /<w:vMerge w:val="continue"\/>/);
assert.match(mergedTableXml, /跨行结论/);

console.log("DOCX export format check passed");
