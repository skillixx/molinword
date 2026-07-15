import assert from "node:assert/strict";
import JSZip from "jszip";
import { createDocxBuffer, parseImportedDocument } from "../server/index.js";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lT3g6wAAAABJRU5ErkJggg==";
const defaultPageTextStyle = { alignment: "center", fontFamily: "Microsoft YaHei", fontSizePt: 9, color: "#6B7280", bold: false, italic: false };
const emptyPageVariant = { headerText: "", headerStyle: defaultPageTextStyle, headerImages: [], footerText: "", footerStyle: defaultPageTextStyle, footerImages: [], headerPageNumberTemplate: "", footerPageNumberTemplate: "", headerPageNumberSeparate: false, footerPageNumberSeparate: false, pageNumberEnabled: false, pageNumberPosition: "footer" };

async function buildFormattedDocxFixture() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder("word").folder("_rels").file(
    "document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`
  );
  zip.folder("word").file("header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="24"/><w:color w:val="1F4E79"/><w:b/><w:i/></w:rPr><w:t>导入页眉</w:t></w:r></w:p></w:hdr>`);
  zip.folder("word").file("footer1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="SimSun"/><w:sz w:val="21"/><w:color w:val="C00000"/></w:rPr><w:t>导入页脚 · 第 </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="end"/><w:t> 页 / 共 </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText><w:fldChar w:fldCharType="end"/><w:t> 页</w:t></w:r></w:p></w:ftr>`);
  zip.folder("word").folder("media").file("image1.png", tinyPngBase64, { base64: true });
  zip.folder("word").file(
    "numbering.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="10">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="11">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="7"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="8"><w:abstractNumId w:val="11"/></w:num>
  <w:num w:numId="9">
    <w:abstractNumId w:val="11"/>
    <w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:lvlOverride>
  </w:num>
  <w:num w:numId="10"><w:abstractNumId w:val="10"/></w:num>
</w:numbering>`
  );
  zip.folder("word").file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:before="120"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BodyBased">
    <w:name w:val="Body Based"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
      <w:b/>
      <w:color w:val="1F4E79"/>
      <w:sz w:val="48"/>
    </w:rPr>
  </w:style>
</w:styles>`
  );
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r><w:t>格式恢复测试标题</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:jc w:val="both"/><w:ind w:firstLine="480"/><w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/></w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
          <w:sz w:val="28"/>
        </w:rPr>
        <w:t>这一段应该保留首行缩进和微软雅黑字号。</w:t>
      </w:r>
      <w:r>
        <w:rPr><w:b/><w:color w:val="C00000"/></w:rPr>
        <w:t>红色加粗文本</w:t>
      </w:r>
      <w:r>
        <w:rPr><w:i/><w:u w:val="single"/><w:strike/></w:rPr>
        <w:t>斜体下划线删除线文本</w:t>
      </w:r>
      <w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Highlighted text</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>Superscript text</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>Subscript text</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:pStyle w:val="BodyBased"/></w:pPr><w:r><w:t>Inherited spacing</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:line="360" w:lineRule="atLeast"/></w:pPr><w:r><w:t>At least spacing</w:t></w:r></w:p>
    <w:p><w:pPr><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:widowControl/></w:pPr><w:r><w:t>Pagination controlled paragraph</w:t></w:r></w:p>
    <w:p><w:pPr><w:widowControl w:val="false"/></w:pPr><w:r><w:t>Widow control disabled paragraph</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/><w:tab w:val="right" w:pos="5760"/></w:tabs></w:pPr>
      <w:r><w:t>Tab project</w:t><w:tab/><w:t>Tab amount</w:t><w:tab/><w:t>100.00</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:type="dxa" w:w="6000"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:right w:w="200" w:type="dxa"/><w:bottom w:w="300" w:type="dxa"/><w:left w:w="400" w:type="dxa"/></w:tblCellMar></w:tblPr>
      <w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="4200"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1800"/><w:tcMar><w:right w:w="600" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/><w:shd w:val="clear" w:fill="D9EAD3"/></w:tcPr><w:p><w:r><w:t>Geometry A</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="4200"/></w:tcPr><w:p><w:r><w:t>Geometry B</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Header A</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Header B</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>Import Cell 1</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Table ordered item</w:t></w:r></w:p>
        </w:tc>
        <w:tc><w:p><w:r><w:t>Import Cell 2</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Merged approval</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Approved</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc>
        <w:tc><w:p><w:r><w:t>Archived</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p>
      <w:r><w:t>分页符前</w:t></w:r>
      <w:r><w:br w:type="page"/></w:r>
      <w:r><w:t>分页符后</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Ordered item 1</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Nested ordered item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Ordered item 2</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="8"/></w:numPr></w:pPr><w:r><w:t>Bullet item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="9"/></w:numPr></w:pPr><w:r><w:t>Override ordered item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr><w:r><w:t>Restart ordered item</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:extent cx="11430000" cy="7620000"/>
          <a:graphic>
            <a:graphicData>
              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:blipFill><a:blip r:embed="rIdImage1"/></pic:blipFill>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </w:drawing>
      </w:r>
    </w:p>
    <w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="360" w:footer="900"/></w:sectPr>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

const buffer = await buildFormattedDocxFixture();
const imported = await parseImportedDocument({
  originalname: "format-fixture.docx",
  buffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: buffer.length
});

const inheritedStyleZip = await JSZip.loadAsync(buffer);
const inheritedStylesXml = await inheritedStyleZip.file("word/styles.xml")?.async("string") || "";
inheritedStyleZip.file("word/styles.xml", inheritedStylesXml.replace("</w:styles>", `
  <w:style w:type="paragraph" w:styleId="HeaderBase"><w:name w:val="Header Base"/><w:pPr><w:jc w:val="left"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="26"/><w:color w:themeColor="accent2" w:themeTint="80"/><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Header"><w:name w:val="Header"/><w:basedOn w:val="HeaderBase"/><w:pPr><w:jc w:val="right"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`));
inheritedStyleZip.folder("word").folder("theme").file("theme1.xml", `<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface=""/><a:font script="Hans" typeface="Major Hans"/><a:font script="Hant" typeface="Major Hant"/><a:font script="Jpan" typeface="Major Jpan"/><a:font script="Hang" typeface="Major Hang"/></a:majorFont><a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface=""/><a:font script="Hans" typeface="Minor Hans"/><a:font script="Hant" typeface="Minor Hant"/><a:font script="Jpan" typeface="Minor Jpan"/><a:font script="Hang" typeface="Minor Hang"/></a:minorFont></a:fontScheme><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="112233"/></a:dk1><a:accent2><a:srgbClr val="7030A0"/></a:accent2></a:clrScheme></a:themeElements></a:theme>`);
inheritedStyleZip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>继承页眉</w:t></w:r></w:p></w:hdr>`);
const inheritedStyleBuffer = await inheritedStyleZip.generateAsync({ type: "nodebuffer" });
const inheritedStyleImported = await parseImportedDocument({ originalname: "inherited-header.docx", buffer: inheritedStyleBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: inheritedStyleBuffer.length });
// 中文注解：真实 Word 页眉通常依赖段落样式、basedOn 和主题字体，不能只解析直接写在文本上的格式。
assert.equal(inheritedStyleImported.pageLayout.headerText, "继承页眉");
assert.deepEqual(inheritedStyleImported.pageLayout.headerStyle, { alignment: "right", fontFamily: "Minor Hans", fontSizePt: 13, color: "#B898D0", bold: true, italic: true });

const inheritedEnglishZip = await JSZip.loadAsync(inheritedStyleBuffer);
const inheritedEnglishHeaderXml = await inheritedEnglishZip.file("word/header1.xml")?.async("string") || "";
inheritedEnglishZip.file("word/header1.xml", inheritedEnglishHeaderXml.replace("继承页眉", "English header"));
const inheritedEnglishBuffer = await inheritedEnglishZip.generateAsync({ type: "nodebuffer" });
const inheritedEnglishImported = await parseImportedDocument({ originalname: "english-themed-header.docx", buffer: inheritedEnglishBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: inheritedEnglishBuffer.length });
assert.equal(inheritedEnglishImported.pageLayout.headerStyle.fontFamily, "Minor Latin");

for (const [text, expectedFont] of [["繁體頁眉", "Minor Hant"], ["日本語かな", "Minor Jpan"], ["한국어 머리글", "Minor Hang"]]) {
  const scriptZip = await JSZip.loadAsync(inheritedStyleBuffer);
  const scriptHeaderXml = await scriptZip.file("word/header1.xml")?.async("string") || "";
  scriptZip.file("word/header1.xml", scriptHeaderXml.replace("继承页眉", text));
  const scriptBuffer = await scriptZip.generateAsync({ type: "nodebuffer" });
  const scriptImported = await parseImportedDocument({ originalname: `${expectedFont}.docx`, buffer: scriptBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: scriptBuffer.length });
  assert.equal(scriptImported.pageLayout.headerStyle.fontFamily, expectedFont);
}

const bodyThemeZip = await JSZip.loadAsync(inheritedStyleBuffer);
const bodyThemeStylesXml = await bodyThemeZip.file("word/styles.xml")?.async("string") || "";
bodyThemeZip.file("word/styles.xml", bodyThemeStylesXml.replace("</w:styles>", '<w:style w:type="character" w:styleId="AccentChar"><w:name w:val="Accent Char"/><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:color w:themeColor="accent2" w:themeTint="80"/><w:i/></w:rPr></w:style></w:styles>'));
const bodyThemeDocumentXml = await bodyThemeZip.file("word/document.xml")?.async("string") || "";
bodyThemeZip.file("word/document.xml", bodyThemeDocumentXml.replace("<w:sectPr>", '<w:p><w:r><w:rPr><w:rStyle w:val="AccentChar"/></w:rPr><w:t>主题正文</w:t></w:r><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:color w:themeColor="dk1"/></w:rPr><w:t>Direct theme</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:lang w:eastAsia="zh-CN"/></w:rPr><w:t>AI Word 2026 项目</w:t></w:r></w:p><w:sectPr>'));
const bodyThemeBuffer = await bodyThemeZip.generateAsync({ type: "nodebuffer" });
const bodyThemeImported = await parseImportedDocument({ originalname: "body-theme-style.docx", buffer: bodyThemeBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bodyThemeBuffer.length });
// 中文注解：正文直接主题格式和字符样式链必须与页眉页脚共用主题上下文，避免只修页面部件而正文继续丢格式。
assert.match(bodyThemeImported.content, /font-family:\s*&quot;Minor Hans&quot;[^>]*color:\s*#B898D0[^>]*font-style:\s*italic[^>]*><em>主题正文<\/em>/);
assert.match(bodyThemeImported.content, /font-family:\s*&quot;Minor Latin&quot;[^>]*color:\s*#112233[^>]*>Direct theme/);
assert.match(bodyThemeImported.content, /font-family:\s*&quot;Minor Latin&quot;[^>]*>AI Word 2026 <\/span><span[^>]*font-family:\s*&quot;Minor Hans&quot;[^>]*>项目<\/span>/);

const systemColorZip = await JSZip.loadAsync(inheritedStyleBuffer);
const systemColorStylesXml = await systemColorZip.file("word/styles.xml")?.async("string") || "";
systemColorZip.file("word/styles.xml", systemColorStylesXml.replace('w:themeColor="accent2" w:themeTint="80"', 'w:themeColor="dk1"'));
const systemColorBuffer = await systemColorZip.generateAsync({ type: "nodebuffer" });
const systemColorImported = await parseImportedDocument({ originalname: "system-theme-color.docx", buffer: systemColorBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: systemColorBuffer.length });
assert.equal(systemColorImported.pageLayout.headerStyle.color, "#112233");

const cachedFieldZip = await JSZip.loadAsync(buffer);
const cachedFooterXml = await cachedFieldZip.file("word/footer1.xml")?.async("string") || "";
cachedFieldZip.file("word/footer1.xml", cachedFooterXml
  .replace("<w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType=\"end\"/>", "<w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType=\"separate\"/><w:t>3</w:t><w:fldChar w:fldCharType=\"end\"/>")
  .replace("<w:instrText>NUMPAGES</w:instrText><w:fldChar w:fldCharType=\"end\"/>", "<w:instrText>NUMPAGES</w:instrText><w:fldChar w:fldCharType=\"separate\"/><w:t>12</w:t><w:fldChar w:fldCharType=\"end\"/>"));
const cachedFieldBuffer = await cachedFieldZip.generateAsync({ type: "nodebuffer" });
const cachedFieldImported = await parseImportedDocument({ originalname: "cached-page-field.docx", buffer: cachedFieldBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: cachedFieldBuffer.length });
// 中文注解：域缓存数字不是页脚正文，导入后必须只保留动态页码开关，避免再次导出时出现两套页码。
assert.equal(cachedFieldImported.pageLayout.footerText, "导入页脚");
assert.equal(cachedFieldImported.pageLayout.pageNumberEnabled, true);
assert.equal(cachedFieldImported.pageLayout.pageNumberPosition, "footer");
assert.equal(cachedFieldImported.pageLayout.footerPageNumberTemplate, "第 {PAGE} 页 / 共 {NUMPAGES} 页");

const dateFieldZip = await JSZip.loadAsync(buffer);
dateFieldZip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>日期：</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>2026-07-15</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`);
const dateFieldBuffer = await dateFieldZip.generateAsync({ type: "nodebuffer" });
const dateFieldImported = await parseImportedDocument({ originalname: "date-field.docx", buffer: dateFieldBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: dateFieldBuffer.length });
assert.equal(dateFieldImported.pageLayout.footerText, "日期：2026-07-15");
assert.equal(dateFieldImported.pageLayout.pageNumberEnabled, false);
assert.match(dateFieldImported.warnings.join(" "), /动态域.*显示值/);

const pageRefFieldZip = await JSZip.loadAsync(buffer);
pageRefFieldZip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGEREF target</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>8</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`);
const pageRefFieldBuffer = await pageRefFieldZip.generateAsync({ type: "nodebuffer" });
const pageRefFieldImported = await parseImportedDocument({ originalname: "pageref-field.docx", buffer: pageRefFieldBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: pageRefFieldBuffer.length });
assert.equal(pageRefFieldImported.pageLayout.footerText, "8");
assert.equal(pageRefFieldImported.pageLayout.pageNumberEnabled, false);

const headerPageZip = await JSZip.loadAsync(buffer);
headerPageZip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>页眉页码 · 第 </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="end"/><w:t> 页 / 共 </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText><w:fldChar w:fldCharType="end"/><w:t> 页</w:t></w:r></w:p></w:hdr>`);
headerPageZip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>普通页脚</w:t></w:r></w:p></w:ftr>`);
const headerPageBuffer = await headerPageZip.generateAsync({ type: "nodebuffer" });
const headerPageImported = await parseImportedDocument({ originalname: "header-page-number.docx", buffer: headerPageBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: headerPageBuffer.length });
assert.equal(headerPageImported.pageLayout.headerText, "页眉页码");
assert.equal(headerPageImported.pageLayout.pageNumberEnabled, true);
assert.equal(headerPageImported.pageLayout.pageNumberPosition, "header");
assert.equal(headerPageImported.pageLayout.headerPageNumberTemplate, "第 {PAGE} 页 / 共 {NUMPAGES} 页");

const splitPageFieldZip = await JSZip.loadAsync(buffer);
splitPageFieldZip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>分片页码 · 第 </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PA</w:instrText></w:r><w:r><w:instrText>GE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>4</w:t><w:fldChar w:fldCharType="end"/><w:t> 页 / 共 </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>NUM</w:instrText></w:r><w:r><w:instrText>PAGES</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>20</w:t><w:fldChar w:fldCharType="end"/><w:t> 页</w:t></w:r></w:p></w:ftr>`);
const splitPageFieldBuffer = await splitPageFieldZip.generateAsync({ type: "nodebuffer" });
const splitPageFieldImported = await parseImportedDocument({ originalname: "split-page-field.docx", buffer: splitPageFieldBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: splitPageFieldBuffer.length });
// 中文注解：字段命令可跨多个 run 拆分，必须按 begin/separate/end 聚合后再识别 PAGE 与 NUMPAGES。
assert.equal(splitPageFieldImported.pageLayout.footerText, "分片页码");
assert.equal(splitPageFieldImported.pageLayout.pageNumberEnabled, true);
assert.equal(splitPageFieldImported.pageLayout.footerPageNumberTemplate, "第 {PAGE} 页 / 共 {NUMPAGES} 页");

const dualTemplateZip = await JSZip.loadAsync(buffer);
dualTemplateZip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Project Atlas</w:t></w:r></w:p><w:p><w:r><w:t>Page </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE \\* ROMAN</w:instrText><w:fldChar w:fldCharType="end"/><w:t> of </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`);
dualTemplateZip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Total </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`);
const dualTemplateBuffer = await dualTemplateZip.generateAsync({ type: "nodebuffer" });
const dualTemplateImported = await parseImportedDocument({ originalname: "dual-page-template.docx", buffer: dualTemplateBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: dualTemplateBuffer.length });
assert.equal(dualTemplateImported.pageLayout.headerPageNumberTemplate, "Page {PAGE:upperRoman} of {NUMPAGES}");
assert.equal(dualTemplateImported.pageLayout.footerPageNumberTemplate, "Total {NUMPAGES}");
assert.equal(dualTemplateImported.pageLayout.headerText, "Project Atlas");
assert.equal(dualTemplateImported.pageLayout.headerPageNumberSeparate, true);
assert.equal(dualTemplateImported.pageLayout.footerPageNumberSeparate, false);
const dualTemplateRoundTripBuffer = await createDocxBuffer({ title: "Dual template round trip", content: "<p>Body</p>", pageLayout: dualTemplateImported.pageLayout });
const dualTemplateRoundTripImported = await parseImportedDocument({ originalname: "dual-page-template-round-trip.docx", buffer: dualTemplateRoundTripBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: dualTemplateRoundTripBuffer.length });
assert.equal(dualTemplateRoundTripImported.pageLayout.headerText, "Project Atlas");
assert.equal(dualTemplateRoundTripImported.pageLayout.headerPageNumberTemplate, "Page {PAGE:upperRoman} of {NUMPAGES}");
assert.equal(dualTemplateRoundTripImported.pageLayout.headerPageNumberSeparate, true);

const restartedNumberingZip = await JSZip.loadAsync(buffer);
const restartedNumberingXml = await restartedNumberingZip.file("word/document.xml")?.async("string") || "";
restartedNumberingZip.file("word/document.xml", restartedNumberingXml.replace("<w:sectPr>", '<w:sectPr><w:pgNumType w:start="0" w:fmt="lowerRoman"/>'));
const restartedNumberingBuffer = await restartedNumberingZip.generateAsync({ type: "nodebuffer" });
const restartedNumberingImported = await parseImportedDocument({ originalname: "restarted-page-numbering.docx", buffer: restartedNumberingBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: restartedNumberingBuffer.length });
assert.equal(restartedNumberingImported.pageLayout.pageNumberStart, 0);
assert.equal(restartedNumberingImported.pageLayout.pageNumberFormat, "lowerRoman");

const multiParagraphHeaderZip = await JSZip.loadAsync(buffer);
multiParagraphHeaderZip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="SimSun"/><w:sz w:val="21"/><w:color w:val="345678"/></w:rPr><w:t>项目名称：智慧办公平台</w:t></w:r></w:p><w:p/><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="SimSun"/><w:sz w:val="21"/><w:color w:val="345678"/></w:rPr><w:t>文档状态：内部评审</w:t></w:r></w:p></w:hdr>`);
const multiParagraphHeaderBuffer = await multiParagraphHeaderZip.generateAsync({ type: "nodebuffer" });
const multiParagraphHeaderImported = await parseImportedDocument({ originalname: "multi-paragraph-header.docx", buffer: multiParagraphHeaderBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: multiParagraphHeaderBuffer.length });
// 中文注解：相同样式的多个页眉段落是可完整承载的办公格式，不应再被压平或产生降级警告。
assert.equal(multiParagraphHeaderImported.pageLayout.headerText, "\n项目名称：智慧办公平台\n\n文档状态：内部评审");
assert.deepEqual(multiParagraphHeaderImported.pageLayout.headerStyle, { alignment: "right", fontFamily: "SimSun", fontSizePt: 10.5, color: "#345678", bold: false, italic: false });
assert.doesNotMatch(multiParagraphHeaderImported.warnings.join(" "), /多段落.*暂未完整恢复/);
const multiParagraphRoundTripBuffer = await createDocxBuffer({ title: "Multi paragraph round trip", content: "<p>Body</p>", pageLayout: multiParagraphHeaderImported.pageLayout });
const multiParagraphRoundTripImported = await parseImportedDocument({ originalname: "multi-paragraph-round-trip.docx", buffer: multiParagraphRoundTripBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: multiParagraphRoundTripBuffer.length });
assert.equal(multiParagraphRoundTripImported.pageLayout.headerText, multiParagraphHeaderImported.pageLayout.headerText);
assert.deepEqual(multiParagraphRoundTripImported.pageLayout.headerStyle, multiParagraphHeaderImported.pageLayout.headerStyle);

const headerImageZip = await JSZip.loadAsync(buffer);
headerImageZip.folder("word").folder("_rels").file("header1.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/header-logo.png"/></Relationships>`);
headerImageZip.folder("word").folder("media").file("header-logo.png", tinyPngBase64, { base64: true });
headerImageZip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="1143000" cy="571500"/><wp:docPr id="1" name="Header Logo" descr="企业标识"/><a:graphic><a:graphicData><a:blip r:embed="rIdLogo"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t>项目页眉</w:t></w:r></w:p></w:hdr>`);
const headerImageBuffer = await headerImageZip.generateAsync({ type: "nodebuffer" });
const headerImageImported = await parseImportedDocument({ originalname: "header-image.docx", buffer: headerImageBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: headerImageBuffer.length });
assert.equal(headerImageImported.pageLayout.headerImages.length, 1);
assert.match(headerImageImported.pageLayout.headerImages[0].src, /^data:image\/png;base64,/);
assert.deepEqual({ widthPx: headerImageImported.pageLayout.headerImages[0].widthPx, heightPx: headerImageImported.pageLayout.headerImages[0].heightPx, paragraphIndex: headerImageImported.pageLayout.headerImages[0].paragraphIndex, placement: headerImageImported.pageLayout.headerImages[0].placement, alignment: headerImageImported.pageLayout.headerImages[0].alignment }, { widthPx: 120, heightPx: 60, paragraphIndex: 0, placement: "beforeText", alignment: "left" });
assert.doesNotMatch(headerImageImported.warnings.join(" "), /图片.*暂未完整恢复/);
const headerImageRoundTripBuffer = await createDocxBuffer({ title: "Header image round trip", content: "<p>Body</p>", pageLayout: headerImageImported.pageLayout });
const headerImageRoundTrip = await parseImportedDocument({ originalname: "header-image-round-trip.docx", buffer: headerImageRoundTripBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: headerImageRoundTripBuffer.length });
assert.equal(headerImageRoundTrip.pageLayout.headerImages.length, 1);
assert.deepEqual({ widthPx: headerImageRoundTrip.pageLayout.headerImages[0].widthPx, heightPx: headerImageRoundTrip.pageLayout.headerImages[0].heightPx, placement: headerImageRoundTrip.pageLayout.headerImages[0].placement }, { widthPx: 120, heightPx: 60, placement: "beforeText" });

const complexLayoutZip = await JSZip.loadAsync(buffer);
const complexHeaderXml = await complexLayoutZip.file("word/header1.xml")?.async("string") || "";
complexLayoutZip.file("word/header1.xml", complexHeaderXml.replace("<w:b/>", "<w:b/><w:u w:val=\"single\"/>"));
const complexLayoutBuffer = await complexLayoutZip.generateAsync({ type: "nodebuffer" });
const complexLayoutImported = await parseImportedDocument({
  originalname: "complex-header-fixture.docx",
  buffer: complexLayoutBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: complexLayoutBuffer.length
});
// 中文注解：下划线等尚未承载的高级页眉格式必须明确提示，不能静默宣称完全恢复。
assert.match(complexLayoutImported.warnings.join(" "), /高级格式/);

const mixedStyleZip = await JSZip.loadAsync(buffer);
const mixedStyleHeaderXml = await mixedStyleZip.file("word/header1.xml")?.async("string") || "";
mixedStyleZip.file("word/header1.xml", mixedStyleHeaderXml.replace("</w:p>", '<w:r><w:rPr><w:color w:val="00AA00"/></w:rPr><w:t>混合样式</w:t></w:r></w:p>'));
const mixedStyleBuffer = await mixedStyleZip.generateAsync({ type: "nodebuffer" });
const mixedStyleImported = await parseImportedDocument({
  originalname: "mixed-header-style.docx",
  buffer: mixedStyleBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: mixedStyleBuffer.length
});
// 中文注解：同一页眉内存在多套字符样式时当前模型只能采用首套格式，导入结果必须向用户说明限制。
assert.match(mixedStyleImported.warnings.join(" "), /混合字符样式/);

// 中文注解：Word 页眉页脚的常用格式应恢复到页面模型，供在线预览、编辑和再次导出共同使用。
assert.deepEqual(imported.pageLayout.headerStyle, { alignment: "right", fontFamily: "Microsoft YaHei", fontSizePt: 12, color: "#1F4E79", bold: true, italic: true });
assert.deepEqual(imported.pageLayout.footerStyle, { alignment: "left", fontFamily: "SimSun", fontSizePt: 10.5, color: "#C00000", bold: false, italic: false });

// 中文注解：这个检查覆盖用户反馈的核心症状，导入后段落、字体、表格和图片不能被洗掉。
assert.match(imported.content, /text-align:\s*center/);
assert.match(imported.content, /font-family:\s*(?:&quot;Microsoft YaHei&quot;|"Microsoft YaHei")/);
assert.match(imported.content, /font-size:\s*24pt/);
assert.match(imported.content, /text-align:\s*justify/);
assert.match(imported.content, /text-indent:\s*24pt/);
assert.match(imported.content, /line-height:\s*1\.5/);
assert.match(imported.content, /margin-top:\s*6pt/);
assert.match(imported.content, /margin-bottom:\s*12pt/);
assert.match(imported.content, /color:\s*#C00000/i);
assert.match(imported.content, /<strong>/);
assert.match(imported.content, /<s><em><u>斜体下划线删除线文本<\/u><\/em><\/s>/);
assert.match(imported.content, /<mark data-highlight="yellow" style="background-color:\s*#FFFF00">Highlighted text<\/mark>/);
assert.match(imported.content, /<sup>Superscript text<\/sup>/);
assert.match(imported.content, /<sub>Subscript text<\/sub>/);
assert.match(imported.content, /<p[^>]+data-keep-next="true"[^>]+data-keep-lines="true"[^>]+data-page-break-before="true"[^>]+data-widow-control="true"[^>]*>Pagination controlled paragraph<\/p>/);
assert.match(imported.content, /<p[^>]+data-widow-control="false"[^>]*>Widow control disabled paragraph<\/p>/);
const importedTabParagraph = (imported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || [])
  .find((paragraph) => paragraph.includes("Tab project") && paragraph.includes("100.00")) || "";
assert.match(importedTabParagraph, /data-tab-stops="[^\"]*1440[^\"]*5760[^\"]*"/);
assert.equal((importedTabParagraph.match(/data-docx-tab="true"/g) || []).length, 2);
assert.match(importedTabParagraph, /data-tab-position="1440"[^>]+data-tab-alignment="left"/);
assert.match(importedTabParagraph, /data-tab-position="5760"[^>]+data-tab-alignment="right"/);
const importedGeometryTable = (imported.content.match(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/g) || []).find((table) => table.includes("Geometry A")) || "";
assert.match(importedGeometryTable, /data-table-width-type="dxa"/);
assert.match(importedGeometryTable, /data-table-width-value="6000"/);
assert.match(importedGeometryTable, /data-table-grid-width="6000"/);
assert.match(importedGeometryTable, /data-table-layout="fixed"/);
assert.match(importedGeometryTable, /style="width:\s*400px;\s*table-layout:\s*fixed"/);
assert.match(importedGeometryTable, /colwidth="120"/);
assert.match(importedGeometryTable, /colwidth="280"/);
const importedGeometryCell = importedGeometryTable.match(/<th[^>]*>[^<]*<p[^>]*>Geometry A<\/p><\/th>/)?.[0] || "";
assert.match(importedGeometryCell, /data-docx-cell="true"/);
assert.match(importedGeometryCell, /data-cell-margins="[^\"]*100[^\"]*600[^\"]*300[^\"]*400[^\"]*"/);
assert.match(importedGeometryCell, /data-cell-vertical-align="center"/);
assert.match(importedGeometryCell, /data-cell-shading="#D9EAD3"/);
assert.match(importedGeometryCell, /padding-top:\s*6\.67px/);
assert.match(importedGeometryCell, /padding-right:\s*40px/);
assert.match(importedGeometryCell, /padding-bottom:\s*20px/);
assert.match(importedGeometryCell, /padding-left:\s*26\.67px/);
assert.match(importedGeometryCell, /vertical-align:\s*middle/);
assert.match(importedGeometryCell, /background-color:\s*#D9EAD3/);
assert.match(imported.content, /<table(?:\s|>)/);
assert.match(imported.content, /<th(?:\s|>)/);
assert.match(imported.content, /<td(?:\s|>)/);
assert.match(imported.content, /Import Cell 1/);
assert.match(imported.content, /data-page-break="true"/);
assert.match(imported.content, /<img[^>]+src="data:image\/png;base64,/);
// 中文注解：超出 A4 内容区的大图在导入时即等比缩放，避免浏览器与导出端分别限制宽高后产生占位差。
assert.match(imported.content, /<img[^>]+style="[^"]*width:\s*602px;\s*height:\s*401\.33px;/);
// 中文注解：读取 numbering.xml 后应恢复编号类型和嵌套层级，供 Tiptap 继续编辑。
assert.match(imported.content, /<ol><li>Ordered item 1<ol><li>Nested ordered item<\/li><\/ol><\/li><li>Ordered item 2<\/li><\/ol>/);
assert.match(imported.content, /<ul><li>Bullet item<\/li><\/ul>/);
assert.match(imported.content, /<ol><li>Override ordered item<\/li><\/ol><ol><li>Restart ordered item<\/li><\/ol>/);
assert.match(imported.content, /<td[^>]*><p[^>]*>Import Cell 1<\/p><ol><li>Table ordered item<\/li><\/ol><\/td>/);
assert.match(imported.content, /<td colspan="2" rowspan="2"[^>]*><p[^>]*>Merged approval<\/p><\/td><td[^>]*><p[^>]*>Approved<\/p><\/td>/);
assert.deepEqual(imported.pageLayout, {
  headerText: "导入页眉",
  headerStyle: { alignment: "right", fontFamily: "Microsoft YaHei", fontSizePt: 12, color: "#1F4E79", bold: true, italic: true },
  headerImages: [],
  footerText: "导入页脚",
  footerStyle: { alignment: "left", fontFamily: "SimSun", fontSizePt: 10.5, color: "#C00000", bold: false, italic: false },
  footerImages: [],
  headerPageNumberTemplate: "",
  footerPageNumberTemplate: "第 {PAGE} 页 / 共 {NUMPAGES} 页",
  headerPageNumberSeparate: false,
  footerPageNumberSeparate: false,
  pageNumberEnabled: true,
  pageNumberPosition: "footer",
  firstPageDifferent: false,
  firstPage: emptyPageVariant,
  oddEvenDifferent: false,
  evenPage: emptyPageVariant,
  orientation: "portrait",
  pageNumberFormat: "decimal",
  pageNumberStart: null,
  headerDistance: 360,
  footerDistance: 900,
  margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
});

const inheritedParagraph = imported.content.match(/<p[^>]*>Inherited spacing<\/p>/)?.[0] || "";
assert.match(inheritedParagraph, /line-height:\s*1\.15/);
assert.match(inheritedParagraph, /margin-top:\s*6pt/);
assert.match(inheritedParagraph, /margin-bottom:\s*12pt/);
const atLeastParagraph = imported.content.match(/<p[^>]*>At least spacing<\/p>/)?.[0] || "";
assert.match(atLeastParagraph, /line-height:\s*18pt/);
assert.match(atLeastParagraph, /--word-line-rule:\s*atLeast/);

const roundTripBuffer = await createDocxBuffer({ title: "Spacing round trip", content: imported.content, pageLayout: imported.pageLayout });
const roundTripZip = await JSZip.loadAsync(roundTripBuffer);
const roundTripXml = await roundTripZip.file("word/document.xml")?.async("string") || "";
const decoratedRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || [])
  .find((run) => run.includes(">斜体下划线删除线文本</w:t>")) || "";
assert.match(decoratedRoundTripXml, /<w:i\/>/);
assert.match(decoratedRoundTripXml, /<w:u(?:\s+w:val="single")?\/>/);
assert.match(decoratedRoundTripXml, /<w:strike\/>/);
assert.match(roundTripXml, /<w:gridSpan w:val="2"\/>/);
assert.match(roundTripXml, /<w:vMerge w:val="restart"\/>/);
assert.match(roundTripXml, /<w:vMerge w:val="continue"\/>/);
// 中文注解：高级字符格式必须在导入后再次导出为 Word 原生属性，不能只停留为浏览器视觉样式。
assert.match(roundTripXml, /<w:highlight w:val="yellow"\/>/);
assert.match(roundTripXml, /<w:vertAlign w:val="superscript"\/>/);
assert.match(roundTripXml, /<w:vertAlign w:val="subscript"\/>/);
const paginationControlledRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Pagination controlled paragraph")) || "";
assert.match(paginationControlledRoundTripXml, /<w:keepNext\/>/);
assert.match(paginationControlledRoundTripXml, /<w:keepLines\/>/);
assert.match(paginationControlledRoundTripXml, /<w:pageBreakBefore\/>/);
assert.match(paginationControlledRoundTripXml, /<w:widowControl\/>/);
const widowDisabledRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Widow control disabled paragraph")) || "";
assert.match(widowDisabledRoundTripXml, /<w:widowControl w:val="false"\/>/);
const tabRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Tab project")) || "";
assert.match(tabRoundTripXml, /<w:tabs><w:tab w:val="left" w:pos="1440"\/><w:tab w:val="right" w:pos="5760"\/><\/w:tabs>/);
assert.equal((tabRoundTripXml.match(/<w:tab\/>/g) || []).length, 2);
const geometryRoundTripXml = (roundTripXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((table) => table.includes("Geometry A")) || "";
assert.match(geometryRoundTripXml, /<w:tblW w:type="dxa" w:w="6000"\/>/);
assert.match(geometryRoundTripXml, /<w:tblLayout w:type="fixed"\/>/);
assert.match(geometryRoundTripXml, /<w:tblGrid><w:gridCol w:w="1800"\/><w:gridCol w:w="4200"\/><\/w:tblGrid>/);
assert.match(geometryRoundTripXml, /<w:tcW w:type="dxa" w:w="1800"\/>/);
assert.match(geometryRoundTripXml, /<w:tcW w:type="dxa" w:w="4200"\/>/);
const geometryCellRoundTripXml = (geometryRoundTripXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).find((cell) => cell.includes("Geometry A")) || "";
assert.match(geometryCellRoundTripXml, /<w:tcMar>/);
for (const [side, width] of [["top", 100], ["right", 600], ["bottom", 300], ["left", 400]]) assert.match(geometryCellRoundTripXml, new RegExp(`<w:${side} w:type="dxa" w:w="${width}"\\/>`));
assert.match(geometryCellRoundTripXml, /<w:shd w:fill="D9EAD3"\/>/);
assert.match(geometryCellRoundTripXml, /<w:vAlign w:val="center"\/>/);
const roundTripImported = await parseImportedDocument({
  originalname: "round-trip-format.docx",
  buffer: roundTripBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: roundTripBuffer.length
});
// 中文注解：docx 会写出 b=false 等显式关闭标记，再导入时不能把未加粗文本误判成粗体。
assert.match(roundTripImported.content, /<s><em><u>斜体下划线删除线文本<\/u><\/em><\/s>/);
assert.match(roundTripImported.content, /<mark data-highlight="yellow"[^>]*>Highlighted text<\/mark>/);
assert.match(roundTripImported.content, /<sup>Superscript text<\/sup>/);
assert.match(roundTripImported.content, /<sub>Subscript text<\/sub>/);
assert.match(roundTripImported.content, /<p[^>]+data-keep-next="true"[^>]+data-keep-lines="true"[^>]+data-page-break-before="true"[^>]+data-widow-control="true"[^>]*>[\s\S]*?Pagination controlled paragraph[\s\S]*?<\/p>/);
assert.match(roundTripImported.content, /<p[^>]+data-widow-control="false"[^>]*>[\s\S]*?Widow control disabled paragraph[\s\S]*?<\/p>/);
const roundTripImportedTabParagraph = (roundTripImported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || [])
  .find((paragraph) => paragraph.includes("Tab project") && paragraph.includes("100.00")) || "";
assert.equal((roundTripImportedTabParagraph.match(/data-docx-tab="true"/g) || []).length, 2);
assert.match(roundTripImportedTabParagraph, /data-tab-position="1440"[^>]+data-tab-alignment="left"/);
assert.match(roundTripImportedTabParagraph, /data-tab-position="5760"[^>]+data-tab-alignment="right"/);
const roundTripImportedGeometryTable = (roundTripImported.content.match(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/g) || []).find((table) => table.includes("Geometry A")) || "";
assert.match(roundTripImportedGeometryTable, /style="width:\s*400px;\s*table-layout:\s*fixed"/);
assert.match(roundTripImportedGeometryTable, /colwidth="120"/);
assert.match(roundTripImportedGeometryTable, /colwidth="280"/);
assert.match(roundTripImportedGeometryTable, /data-cell-vertical-align="center"/);
assert.match(roundTripImportedGeometryTable, /data-cell-shading="#D9EAD3"/);
assert.match(roundTripImportedGeometryTable, /padding-right:\s*40px/);
assert.deepEqual(roundTripImported.pageLayout, imported.pageLayout);
const atLeastRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
  .find((paragraph) => paragraph.includes(">At least spacing</w:t>")) || "";
// 中文注解：最小行距往返后仍必须是 atLeast，避免大字号文字被固定行高裁切并改变分页。
assert.match(atLeastRoundTripXml, /<w:spacing[^>]+w:line="360"/);
assert.match(atLeastRoundTripXml, /<w:spacing[^>]+w:lineRule="atLeast"/);

const variantPageLayout = {
  headerText: "奇数页页眉",
  headerStyle: defaultPageTextStyle,
  headerImages: [],
  footerText: "奇数页页脚",
  footerStyle: defaultPageTextStyle,
  footerImages: [],
  headerPageNumberTemplate: "",
  footerPageNumberTemplate: "第 {PAGE} 页 / 共 {NUMPAGES} 页",
  headerPageNumberSeparate: false,
  footerPageNumberSeparate: false,
  pageNumberEnabled: true,
  pageNumberPosition: "footer",
  firstPageDifferent: true,
  firstPage: { ...emptyPageVariant, headerText: "首页页眉", footerText: "首页页脚" },
  oddEvenDifferent: true,
  evenPage: { ...emptyPageVariant, headerText: "偶数页页眉", footerText: "偶数页页脚", footerPageNumberTemplate: "第 {PAGE} 页 / 共 {NUMPAGES} 页", pageNumberEnabled: true },
  orientation: "portrait",
  pageNumberFormat: "decimal",
  pageNumberStart: null,
  headerDistance: 708,
  footerDistance: 708,
  margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
};
const variantRoundTripBuffer = await createDocxBuffer({ title: "页面类型往返", content: "<p>正文</p>", pageLayout: variantPageLayout });
const variantRoundTripImported = await parseImportedDocument({
  originalname: "variant-page-layout.docx",
  buffer: variantRoundTripBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: variantRoundTripBuffer.length
});
// 中文注解：Word 的 first/default/even 三套部件必须往返保留，不能再次折叠成一组全局页眉页脚。
assert.deepEqual(variantRoundTripImported.pageLayout, variantPageLayout);

const importedSecondSectionLayout = {
  headerText: "Imported landscape header",
  footerText: "Imported landscape footer",
  pageNumberEnabled: true,
  firstPageDifferent: false,
  firstPage: { headerText: "", footerText: "", pageNumberEnabled: false },
  oddEvenDifferent: false,
  evenPage: { headerText: "", footerText: "", pageNumberEnabled: false },
  orientation: "landscape",
  margins: { top: 720, right: 900, bottom: 720, left: 900 }
};
const importedSectionAttribute = JSON.stringify(importedSecondSectionLayout)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const multiSectionBuffer = await createDocxBuffer({
  title: "Multi section import",
  content: `<p>First section</p><div data-section-break="nextPage" data-section-layout="${importedSectionAttribute}"></div><p>Second section</p>`,
  pageLayout: {
    headerText: "Imported portrait header",
    footerText: "Imported portrait footer",
    pageNumberEnabled: false,
    orientation: "portrait",
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
  }
});
const multiSectionImported = await parseImportedDocument({
  originalname: "multi-section.docx",
  buffer: multiSectionBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: multiSectionBuffer.length
});
// 中文注解：导入多节 DOCX 时节边界必须回到可编辑正文，首节和后续节的方向、页边距及页眉页脚才能再次导出。
assert.match(multiSectionImported.content, /data-section-break="nextPage"/);
assert.equal(multiSectionImported.pageLayout.orientation, "portrait");
assert.deepEqual(multiSectionImported.pageLayout.margins, { top: 1440, right: 1440, bottom: 1440, left: 1440 });
assert.doesNotMatch(multiSectionImported.warnings.join(" "), /后续分节.*暂未恢复/);
const multiSectionRoundTripBuffer = await createDocxBuffer({
  title: "Multi section import",
  content: multiSectionImported.content,
  pageLayout: multiSectionImported.pageLayout
});
const multiSectionRoundTripZip = await JSZip.loadAsync(multiSectionRoundTripBuffer);
const multiSectionRoundTripXml = await multiSectionRoundTripZip.file("word/document.xml")?.async("string") || "";
assert.equal((multiSectionRoundTripXml.match(/<w:sectPr(?:\s|>)/g) || []).length, 2);
assert.match(multiSectionRoundTripXml, /<w:pgSz[^>]+w:orient="landscape"/);

const oddSectionBuffer = await createDocxBuffer({
  title: "Odd section type",
  content: `<p>First</p><div data-section-break="oddPage" data-section-layout="${importedSectionAttribute}"></div><p>Odd page section</p>`,
  pageLayout: { headerText: "First", footerText: "", pageNumberEnabled: false }
});
const oddSectionImported = await parseImportedDocument({
  originalname: "odd-section.docx",
  buffer: oddSectionBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: oddSectionBuffer.length
});
// 中文注解：原生奇数页分节符必须在导入正文中保留类型，再次导出不能静默改成下一页。
assert.match(oddSectionImported.content, /data-section-break="oddPage"/);
const oddSectionRoundTripBuffer = await createDocxBuffer({ title: "Odd section type", content: oddSectionImported.content, pageLayout: oddSectionImported.pageLayout });
const oddSectionRoundTripZip = await JSZip.loadAsync(oddSectionRoundTripBuffer);
const oddSectionRoundTripXml = await oddSectionRoundTripZip.file("word/document.xml")?.async("string") || "";
assert.match(oddSectionRoundTripXml, /<w:type w:val="oddPage"\/>/);

const continuousSectionSourceBuffer = await createDocxBuffer({
  title: "Continuous section compatibility",
  content: `<p>First</p><div data-section-break="nextPage" data-section-layout="${importedSectionAttribute}"></div><p>Second</p>`,
  pageLayout: { headerText: "First", footerText: "", pageNumberEnabled: false }
});
// 中文注解：导出器会主动规整连续分节，因此直接修改 OOXML，模拟由 Microsoft Word 创建的外部连续分节文件。
const continuousSourceZip = await JSZip.loadAsync(continuousSectionSourceBuffer);
const continuousSourceXml = await continuousSourceZip.file("word/document.xml")?.async("string") || "";
continuousSourceZip.file("word/document.xml", continuousSourceXml.replace('<w:type w:val="nextPage"/>', '<w:type w:val="continuous"/>'));
const continuousSectionBuffer = await continuousSourceZip.generateAsync({ type: "nodebuffer" });
const continuousSectionImported = await parseImportedDocument({
  originalname: "continuous-section.docx",
  buffer: continuousSectionBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: continuousSectionBuffer.length
});
// 中文注解：当前在线画布不能等价显示同页连续分节，导入时必须显式降级，确保在线分页和再次导出采用同一边界。
assert.match(continuousSectionImported.content, /data-section-break="nextPage"/);
assert.match(continuousSectionImported.warnings.join(" "), /连续分节符.*下一页分节符/);
const continuousRoundTripBuffer = await createDocxBuffer({
  title: "Continuous section compatibility",
  content: continuousSectionImported.content,
  pageLayout: continuousSectionImported.pageLayout
});
const continuousRoundTripZip = await JSZip.loadAsync(continuousRoundTripBuffer);
const continuousRoundTripXml = await continuousRoundTripZip.file("word/document.xml")?.async("string") || "";
assert.match(continuousRoundTripXml, /<w:type w:val="nextPage"\/>/);
assert.doesNotMatch(continuousRoundTripXml, /<w:type w:val="continuous"\/>/);

console.log("DOCX import format check passed");
