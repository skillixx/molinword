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
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
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
  <Relationship Id="rIdHyperlink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://platform.openai.com/docs" TargetMode="External"/>
  <Relationship Id="rIdFootnotes1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
  <Relationship Id="rIdEndnotes1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>
  <Relationship Id="rIdComments1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>`
  );
  zip.folder("word").file("footnotes.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  <w:footnote w:id="2"><w:p><w:r><w:footnoteRef/><w:t xml:space="preserve"> Imported footnote detail</w:t></w:r></w:p></w:footnote>
</w:footnotes>`);
  zip.folder("word").file("endnotes.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>
  <w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>
  <w:endnote w:id="3"><w:p><w:r><w:endnoteRef/><w:t xml:space="preserve"> Imported endnote detail</w:t></w:r></w:p></w:endnote>
</w:endnotes>`);
  zip.folder("word").file("comments.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="4" w:author="Imported Reviewer" w:initials="IR" w:date="2026-07-16T03:00:00Z"><w:p><w:r><w:t>Imported review note</w:t></w:r></w:p></w:comment>
  <w:comment w:id="5" w:author="Cross Reviewer" w:initials="CR" w:date="2026-07-16T04:00:00Z"><w:p><w:r><w:t>Cross paragraph review</w:t></w:r></w:p></w:comment>
</w:comments>`);
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
  <w:abstractNum w:abstractNumId="12">
    <w:lvl w:ilvl="0"><w:start w:val="5"/><w:numFmt w:val="upperRoman"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="7"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="8"><w:abstractNumId w:val="11"/></w:num>
  <w:num w:numId="9">
    <w:abstractNumId w:val="11"/>
    <w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:lvlOverride>
  </w:num>
  <w:num w:numId="10"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="11">
    <w:abstractNumId w:val="12"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride>
  </w:num>
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
  <w:style w:type="paragraph" w:styleId="CustomOutline4">
    <w:name w:val="Bid Section"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/></w:rPr>
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
      <w:r><w:rPr><w:highlight w:val="darkCyan"/></w:rPr><w:t>Dark cyan highlight</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>Superscript text</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>Subscript text</w:t></w:r>
      <w:r><w:rPr><w:spacing w:val="40"/><w:position w:val="6"/></w:rPr><w:t>Expanded raised text</w:t></w:r>
      <w:r><w:rPr><w:u w:val="double" w:color="00AA00"/></w:rPr><w:t>Double green underline</w:t></w:r>
      <w:r><w:rPr><w:caps/></w:rPr><w:t>All caps source</w:t></w:r>
      <w:r><w:rPr><w:smallCaps/></w:rPr><w:t>Small caps source</w:t></w:r>
      <w:r><w:rPr><w:dstrike/></w:rPr><w:t>Double strike source</w:t></w:r>
      <w:r><w:rPr><w:bdr w:val="double" w:sz="12" w:space="2" w:color="C00000"/></w:rPr><w:t>Run border source</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>链接前 </w:t></w:r><w:hyperlink r:id="rIdHyperlink1"><w:r><w:rPr><w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr><w:t>OpenAI documentation</w:t></w:r></w:hyperlink><w:r><w:t> 链接后</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="BodyBased"/></w:pPr><w:r><w:t>Inherited spacing</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="CustomOutline4"/></w:pPr><w:r><w:t>Custom outline level 4</w:t></w:r></w:p>
    <w:p><w:pPr><w:outlineLvl w:val="7"/></w:pPr><w:r><w:t>Direct outline level 8</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t>Hanging indent source</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:start="480" w:end="360"/></w:pPr><w:r><w:t>Side indents source</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:line="360" w:lineRule="atLeast"/></w:pPr><w:r><w:t>At least spacing</w:t></w:r></w:p>
    <w:p><w:pPr><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:widowControl/></w:pPr><w:r><w:t>Pagination controlled paragraph</w:t></w:r></w:p>
    <w:p><w:pPr><w:widowControl w:val="false"/></w:pPr><w:r><w:t>Widow control disabled paragraph</w:t></w:r></w:p>
    <w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>RTL paragraph source</w:t></w:r></w:p>
    <w:p><w:r><w:t>inter</w:t><w:softHyphen/><w:t>national code</w:t><w:noBreakHyphen/><w:t>2026</w:t></w:r></w:p>
    <w:p><w:r><w:t>Manual line one</w:t><w:br/><w:t>Manual line two</w:t></w:r></w:p>
    <w:p><w:r><w:t>Footnote source</w:t><w:footnoteReference w:id="2"/></w:r></w:p>
    <w:p><w:r><w:t>Endnote source</w:t><w:endnoteReference w:id="3"/></w:r></w:p>
    <w:p><w:r><w:t>Comment before </w:t></w:r><w:commentRangeStart w:id="4"/><w:r><w:t>commented source</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r><w:r><w:t> after</w:t></w:r></w:p>
    <w:p><w:commentRangeStart w:id="5"/><w:r><w:t>Cross comment first paragraph</w:t></w:r></w:p>
    <w:p><w:r><w:t>Cross comment second paragraph</w:t></w:r><w:commentRangeEnd w:id="5"/><w:r><w:commentReference w:id="5"/></w:r></w:p>
    <w:p><w:pPr><w:shd w:val="clear" w:color="000000" w:fill="FFF2CC"/><w:pBdr><w:top w:val="single" w:sz="8" w:space="4" w:color="FF0000"/><w:right w:val="dashed" w:sz="6" w:space="3" w:color="00AA00"/><w:bottom w:val="double" w:sz="12" w:space="2" w:color="0000FF"/><w:left w:val="nil" w:sz="0" w:space="0" w:color="000000"/><w:between w:val="dotted" w:sz="4" w:space="1" w:color="888888"/></w:pBdr></w:pPr><w:r><w:t>Paragraph appearance</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/><w:tab w:val="right" w:pos="5760"/></w:tabs></w:pPr>
      <w:r><w:t>Tab project</w:t><w:tab/><w:t>Tab amount</w:t><w:tab/><w:t>100.00</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:type="dxa" w:w="6000"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellSpacing w:w="120" w:type="dxa"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:right w:w="200" w:type="dxa"/><w:bottom w:w="300" w:type="dxa"/><w:left w:w="400" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="8" w:color="FF0000"/><w:right w:val="dashed" w:sz="6" w:color="00AA00"/><w:bottom w:val="double" w:sz="12" w:color="0000FF"/><w:left w:val="nil" w:sz="0" w:color="auto"/><w:insideH w:val="dotted" w:sz="4" w:color="888888"/><w:insideV w:val="single" w:sz="4" w:color="000000"/></w:tblBorders></w:tblPr>
      <w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="4200"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/><w:cantSplit/><w:trHeight w:val="720" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1800"/><w:tcMar><w:right w:w="600" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/><w:textDirection w:val="tbRl"/><w:shd w:val="clear" w:fill="D9EAD3"/><w:tcBorders><w:right w:val="double" w:sz="16" w:color="800080"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>Geometry A</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="4200"/><w:textDirection w:val="btLr"/></w:tcPr><w:p><w:r><w:t>Geometry B</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:tbl>
      <w:tblPr><w:jc w:val="left"/><w:tblInd w:w="720" w:type="dxa"/></w:tblPr>
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
    <w:p>
      <w:r><w:t>分栏符前</w:t><w:br w:type="column"/><w:t>分栏符后</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Ordered item 1</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Nested ordered item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Ordered item 2</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="8"/></w:numPr></w:pPr><w:r><w:t>Bullet item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="9"/></w:numPr></w:pPr><w:r><w:t>Override ordered item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr><w:r><w:t>Restart ordered item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="11"/></w:numPr></w:pPr><w:r><w:t>Started Roman item 1</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="11"/></w:numPr></w:pPr><w:r><w:t>Started Roman item 2</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:extent cx="11430000" cy="7620000"/>
          <wp:docPr id="1" name="正文流程图" descr="正文流程图"/>
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
    <w:p><w:r><w:t>图片前文字</w:t></w:r><w:r><w:drawing><wp:anchor distT="95250" distR="190500" distB="285750" distL="381000" relativeHeight="7" behindDoc="0" locked="1" layoutInCell="1" allowOverlap="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>190500</wp:posOffset></wp:positionV><wp:extent cx="952500" cy="952500"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="2" name="混排图标" descr="混排图标"/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdImage1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>图片后文字</w:t></w:r></w:p>
    <w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="360" w:footer="900" w:gutter="720"/><w:pgBorders w:display="firstPage" w:offsetFrom="page" w:zOrder="front"><w:top w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/><w:right w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/><w:bottom w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/><w:left w:val="double" w:sz="12" w:space="24" w:color="1F4E79"/></w:pgBorders><w:cols w:num="2" w:space="720" w:sep="1"/><w:vAlign w:val="center"/></w:sectPr>
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

const unequalColumnsZip = await JSZip.loadAsync(buffer);
const unequalColumnsXml = await unequalColumnsZip.file("word/document.xml")?.async("string") || "";
unequalColumnsZip.file("word/document.xml", unequalColumnsXml.replace(
  '<w:cols w:num="2" w:space="720" w:sep="1"/>',
  '<w:cols w:num="2" w:space="720" w:sep="1" w:equalWidth="0"><w:col w:w="3000" w:space="720"/><w:col w:w="5000"/></w:cols>'
));
const unequalColumnsBuffer = await unequalColumnsZip.generateAsync({ type: "nodebuffer" });
const unequalColumnsImported = await parseImportedDocument({ originalname: "unequal-columns.docx", buffer: unequalColumnsBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: unequalColumnsBuffer.length });
assert.deepEqual(unequalColumnsImported.pageLayout.columns, {
  count: 2,
  space: 720,
  separate: true,
  equalWidth: false,
  items: [{ width: 2845, space: 720 }, { width: 4741, space: 0 }]
});
assert.doesNotMatch(unequalColumnsImported.warnings.join(" "), /不等宽自定义分栏/);
const unequalColumnsRoundTrip = await createDocxBuffer({ title: "Unequal columns", content: unequalColumnsImported.content, pageLayout: unequalColumnsImported.pageLayout });
const unequalColumnsRoundTripZip = await JSZip.loadAsync(unequalColumnsRoundTrip);
const unequalColumnsRoundTripXml = await unequalColumnsRoundTripZip.file("word/document.xml")?.async("string") || "";
assert.match(unequalColumnsRoundTripXml, /<w:cols[^>]+w:num="2"[^>]+w:sep="true"[^>]+w:equalWidth="false"/);
assert.match(unequalColumnsRoundTripXml, /<w:col w:w="2845" w:space="720"\/><w:col w:w="4741"\/>/);

const letterPaperZip = await JSZip.loadAsync(buffer);
const letterPaperXml = await letterPaperZip.file("word/document.xml")?.async("string") || "";
letterPaperZip.file("word/document.xml", letterPaperXml.replace("<w:pgMar", '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar'));
const letterPaperBuffer = await letterPaperZip.generateAsync({ type: "nodebuffer" });
const letterPaperImported = await parseImportedDocument({ originalname: "letter-paper.docx", buffer: letterPaperBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: letterPaperBuffer.length });
assert.deepEqual(letterPaperImported.pageLayout.paperSize, { width: 12240, height: 15840 });
const letterPaperRoundTrip = await createDocxBuffer({ title: "Letter paper", content: letterPaperImported.content, pageLayout: letterPaperImported.pageLayout });
const letterPaperRoundTripZip = await JSZip.loadAsync(letterPaperRoundTrip);
const letterPaperRoundTripXml = await letterPaperRoundTripZip.file("word/document.xml")?.async("string") || "";
assert.match(letterPaperRoundTripXml, /<w:pgSz[^>]+w:w="12240"[^>]+w:h="15840"/);

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
assert.match(imported.content, /<mark data-highlight="darkCyan" style="background-color:\s*#008080">Dark cyan highlight<\/mark>/);
assert.match(imported.content, /<sup>Superscript text<\/sup>/);
assert.match(imported.content, /<sub>Subscript text<\/sub>/);
assert.match(imported.content, /<span[^>]+style="[^"]*letter-spacing:\s*2pt[^"]*vertical-align:\s*3pt[^"]*"[^>]*>Expanded raised text<\/span>/);
assert.match(imported.content, /<span[^>]+style="[^"]*text-decoration-line:\s*underline[^"]*text-decoration-style:\s*double[^"]*--word-underline-type:\s*double[^"]*text-decoration-color:\s*#00AA00[^"]*"[^>]*>Double green underline<\/span>/i);
assert.match(imported.content, /<span[^>]+style="[^"]*text-transform:\s*uppercase[^"]*"[^>]*>All caps source<\/span>/);
assert.match(imported.content, /<span[^>]+style="[^"]*font-variant-caps:\s*small-caps[^"]*"[^>]*>Small caps source<\/span>/);
assert.match(imported.content, /<span[^>]+data-double-strike="true"[^>]+style="[^"]*text-decoration-line:\s*line-through[^"]*text-decoration-style:\s*double[^"]*"[^>]*>Double strike source<\/span>/);
assert.match(imported.content, /<span[^>]+style="[^"]*--word-text-border:\s*double,12,C00000,2[^"]*border-top:\s*2px double #C00000[^"]*padding-top:\s*2\.67px[^"]*"[^>]*>Run border source<\/span>/i);
assert.match(imported.content, /data-paragraph-shading="[^\"]*(?:&quot;fill&quot;|fill)[^\"]*FFF2CC[^\"]*"/);
assert.match(imported.content, /data-paragraph-borders="[^\"]*(?:&quot;top&quot;|top)[^\"]*FF0000[^\"]*"/);
assert.match(imported.content, /background-color:\s*#FFF2CC/i);
assert.match(imported.content, /border-top:\s*1\.33px solid #FF0000/i);
assert.match(imported.content, /padding-top:\s*5\.33px/i);
assert.match(imported.content, /链接前 <a href="https:\/\/platform\.openai\.com\/docs" target="_blank" rel="noopener noreferrer">[\s\S]*OpenAI documentation[\s\S]*<\/a> 链接后/);
// 中文注解：链接不仅要在导入时可见，再次导出和重开也必须保留外部关系及文字顺序。
const hyperlinkRoundTripBuffer = await createDocxBuffer({ title: "Hyperlink round trip", content: imported.content, pageLayout: imported.pageLayout });
const hyperlinkRoundTripZip = await JSZip.loadAsync(hyperlinkRoundTripBuffer);
const hyperlinkRoundTripXml = await hyperlinkRoundTripZip.file("word/document.xml")?.async("string") || "";
const hyperlinkRoundTripRels = await hyperlinkRoundTripZip.file("word/_rels/document.xml.rels")?.async("string") || "";
assert.match(hyperlinkRoundTripXml, /<w:hyperlink[^>]+r:id="[^"]+"[^>]*>[\s\S]*OpenAI documentation[\s\S]*<\/w:hyperlink>/);
assert.match(hyperlinkRoundTripRels, /Target="https:\/\/platform\.openai\.com\/docs" TargetMode="External"/);
const appearanceRoundTripParagraph = (hyperlinkRoundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Paragraph appearance")) || "";
assert.match(appearanceRoundTripParagraph, /<w:shd[^>]+w:fill="FFF2CC"/);
assert.match(appearanceRoundTripParagraph, /<w:pBdr>[\s\S]*<w:top[^>]+w:val="single"[^>]+w:color="FF0000"[^>]+w:sz="8"[^>]+w:space="4"/);
assert.match(appearanceRoundTripParagraph, /<w:between[^>]+w:val="dotted"[^>]+w:color="888888"[^>]+w:sz="4"[^>]+w:space="1"/);
assert.match(hyperlinkRoundTripXml, /<w:drawing>/);
assert.ok(hyperlinkRoundTripZip.file(/^word\/media\/.+\.png$/).length > 0, "正文图片再次导出后必须保留媒体文件");
assert.ok((hyperlinkRoundTripXml.match(/<w:drawing>/g) || []).length >= 2, "纯图片段落和图文混排中的图片都必须再次导出");
const roundTripMixedImageParagraph = (hyperlinkRoundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("图片前文字")) || "";
assert.ok(roundTripMixedImageParagraph.indexOf("图片前文字") < roundTripMixedImageParagraph.indexOf("<w:drawing>"));
assert.ok(roundTripMixedImageParagraph.indexOf("<w:drawing>") < roundTripMixedImageParagraph.indexOf("图片后文字"));
assert.match(roundTripMixedImageParagraph, /<wp:anchor[^>]+distT="95250"[^>]+distB="285750"[^>]+distL="381000"[^>]+distR="190500"[^>]+allowOverlap="0"[^>]+behindDoc="0"[^>]+locked="1"/);
assert.match(roundTripMixedImageParagraph, /<wp:positionH relativeFrom="column"><wp:align>right<\/wp:align><\/wp:positionH>/);
assert.match(roundTripMixedImageParagraph, /<wp:positionV relativeFrom="paragraph"><wp:posOffset>190500<\/wp:posOffset><\/wp:positionV>/);
assert.match(roundTripMixedImageParagraph, /<wp:wrapSquare wrapText="bothSides"/);
const hyperlinkReimported = await parseImportedDocument({ originalname: "hyperlink-round-trip.docx", buffer: hyperlinkRoundTripBuffer, mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: hyperlinkRoundTripBuffer.length });
assert.match(hyperlinkReimported.content, /<a href="https:\/\/platform\.openai\.com\/docs"[^>]*>[\s\S]*OpenAI documentation[\s\S]*<\/a>/);
assert.match(hyperlinkReimported.content, /data-paragraph-shading="[^\"]*(?:&quot;fill&quot;|fill)[^\"]*FFF2CC[^\"]*"/);
assert.match(hyperlinkReimported.content, /data-paragraph-borders="[^\"]*(?:&quot;between&quot;|between)[^\"]*888888[^\"]*"/);
const roundTripBodyImage = hyperlinkReimported.content.match(/<img[^>]+src="data:image\/png;base64,[^>]*>/)?.[0] || "";
assert.ok(roundTripBodyImage, "正文图片再次导入后必须恢复为可编辑图片");
assert.match(roundTripBodyImage, /alt="正文流程图"/);
assert.match(hyperlinkReimported.content, /图片前文字[\s\S]*<img[^>]+alt="混排图标"[\s\S]*图片后文字/);
assert.match(hyperlinkReimported.content, /<img[^>]+data-docx-wrap="square"[^>]+data-docx-float-align="right"/);
assert.match(imported.content, /<p[^>]+data-keep-next="true"[^>]+data-keep-lines="true"[^>]+data-page-break-before="true"[^>]+data-widow-control="true"[^>]*>Pagination controlled paragraph<\/p>/);
assert.match(imported.content, /<p[^>]+data-widow-control="false"[^>]*>Widow control disabled paragraph<\/p>/);
const importedRtlParagraph = (imported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || []).find((paragraph) => paragraph.includes("RTL paragraph source")) || "";
assert.match(importedRtlParagraph, /data-bidirectional="true"/);
assert.match(importedRtlParagraph, /direction:\s*rtl/);
const importedSpecialHyphenParagraph = (imported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || []).find((paragraph) => paragraph.includes("inter") && paragraph.includes("2026")) || "";
assert.equal(importedSpecialHyphenParagraph.replace(/<[^>]+>/g, ""), "inter\u00ADnational code\u20112026");
const importedManualLineBreakParagraph = (imported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || []).find((paragraph) => paragraph.includes("Manual line one") && paragraph.includes("Manual line two")) || "";
assert.match(importedManualLineBreakParagraph, /Manual line one[\s\S]*?<br\s*\/?\s*>[\s\S]*?Manual line two/);
assert.match(imported.content, /Footnote source[\s\S]*?<span[^>]+class="footnote-reference"[^>]+data-footnote-id="2"[^>]+data-footnote-text="Imported footnote detail"[^>]*>2<\/span>/);
assert.match(imported.content, /Endnote source[\s\S]*?<span[^>]+class="endnote-reference"[^>]+data-endnote-id="3"[^>]+data-endnote-text="Imported endnote detail"[^>]*>3<\/span>/);
assert.match(imported.content, /Comment before [\s\S]*?<span[^>]+class="comment-mark"[^>]+data-comment-id="4"[^>]+data-comment-text="Imported review note"[^>]+data-comment-author="Imported Reviewer"[^>]+data-comment-initials="IR"[^>]*>commented source<\/span>[\s\S]*? after/);
assert.match(imported.content, /<p[^>]*><span[^>]+data-comment-id="5"[^>]+data-comment-text="Cross paragraph review"[^>]*>Cross comment first paragraph<\/span><\/p>[\s\S]*?<p[^>]*><span[^>]+data-comment-id="5"[^>]+data-comment-text="Cross paragraph review"[^>]*>Cross comment second paragraph<\/span><\/p>/);
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
assert.match(importedGeometryTable, /data-table-alignment="center"/);
assert.match(importedGeometryTable, /data-table-cell-spacing="120"/);
assert.match(importedGeometryTable, /data-table-borders="[^"]*&quot;top&quot;[^"]*FF0000[^"]*insideVertical[^"]*"/);
assert.match(importedGeometryTable, /style="(?=[^"]*width:\s*400px)(?=[^"]*margin-left:\s*auto)(?=[^"]*margin-right:\s*auto)(?=[^"]*table-layout:\s*fixed)[^"]*"/);
assert.match(importedGeometryTable, /border-collapse:\s*separate/);
assert.match(importedGeometryTable, /border-spacing:\s*8px/);
assert.match(importedGeometryTable, /colwidth="120"/);
assert.match(importedGeometryTable, /colwidth="280"/);
const importedGeometryRow = importedGeometryTable.match(/<tr[^>]*>/)?.[0] || "";
assert.match(importedGeometryRow, /data-row-height="720"/);
assert.match(importedGeometryRow, /data-row-height-rule="exact"/);
assert.match(importedGeometryRow, /data-row-cant-split="true"/);
assert.match(importedGeometryRow, /data-row-repeat-header="true"/);
assert.match(importedGeometryRow, /style="height:\s*48px"/);
const importedGeometryCell = importedGeometryTable.match(/<th[^>]*>[^<]*<p[^>]*>Geometry A<\/p><\/th>/)?.[0] || "";
assert.match(importedGeometryCell, /data-docx-cell="true"/);
assert.match(importedGeometryCell, /data-cell-margins="[^\"]*100[^\"]*600[^\"]*300[^\"]*400[^\"]*"/);
assert.match(importedGeometryCell, /data-cell-vertical-align="center"/);
assert.match(importedGeometryCell, /data-cell-text-direction="tbRl"/);
assert.match(importedGeometryCell, /data-cell-shading="#D9EAD3"/);
assert.match(importedGeometryCell, /data-cell-borders="[^"]*&quot;top&quot;[^"]*FF0000[^"]*&quot;right&quot;[^"]*800080[^"]*&quot;bottom&quot;[^"]*0000FF[^"]*&quot;left&quot;[^"]*nil[^"]*"/);
assert.match(importedGeometryCell, /padding-top:\s*6\.67px/);
assert.match(importedGeometryCell, /padding-right:\s*40px/);
assert.match(importedGeometryCell, /padding-bottom:\s*20px/);
assert.match(importedGeometryCell, /padding-left:\s*26\.67px/);
assert.match(importedGeometryCell, /vertical-align:\s*middle/);
assert.match(importedGeometryCell, /writing-mode:\s*sideways-rl/);
assert.match(importedGeometryCell, /background-color:\s*#D9EAD3/);
assert.match(importedGeometryCell, /border-top:\s*1\.33px solid #FF0000/);
assert.match(importedGeometryCell, /border-right:\s*2\.67px double #800080/);
assert.match(importedGeometryCell, /border-bottom:\s*2px double #0000FF/);
assert.match(importedGeometryCell, /border-left:\s*none/);
assert.match(imported.content, /<table(?:\s|>)/);
assert.match(imported.content, /<th(?:\s|>)/);
assert.match(imported.content, /<td(?:\s|>)/);
assert.match(imported.content, /Import Cell 1/);
assert.match(imported.content, /data-page-break="true"/);
assert.match(imported.content, /分栏符前[\s\S]*?<\/p><div data-column-break="true" class="column-break-marker"><\/div><p[^>]*>[\s\S]*?分栏符后/);
assert.match(imported.content, /<img[^>]+src="data:image\/png;base64,/);
assert.match(imported.content, /<img[^>]+alt="正文流程图"/);
assert.match(imported.content, /图片前文字[\s\S]*<img[^>]+alt="混排图标"[\s\S]*图片后文字/);
assert.match(imported.content, /<img[^>]+data-docx-wrap="square"[^>]+data-docx-float-align="right"[^>]+style="[^"]*float:\s*right/);
// 中文注解：超出 A4 内容区的大图在导入时即等比缩放，避免浏览器与导出端分别限制宽高后产生占位差。
assert.match(imported.content, /<img[^>]+style="[^"]*width:\s*602px;\s*height:\s*401\.33px;/);
// 中文注解：读取 numbering.xml 后应恢复编号类型和嵌套层级，供 Tiptap 继续编辑。
assert.match(imported.content, /<ol data-list-format="decimal" style="list-style-type:\s*decimal"><li>Ordered item 1<ol data-list-format="lowerLetter" style="list-style-type:\s*lower-alpha"><li>Nested ordered item<\/li><\/ol><\/li><li>Ordered item 2<\/li><\/ol>/);
assert.match(imported.content, /<ul><li>Bullet item<\/li><\/ul>/);
assert.match(imported.content, /<ol data-list-format="decimal"[^>]*><li>Override ordered item<\/li><\/ol><ol data-list-format="decimal"[^>]*><li>Restart ordered item<\/li><\/ol>/);
// 中文注解：具体编号实例的 startOverride 必须覆盖抽象层级的 start=5，并进入在线 ol 的标准 start 属性。
assert.match(imported.content, /<ol start="7" data-list-format="upperRoman" style="list-style-type:\s*upper-roman"><li>Started Roman item 1<\/li><li>Started Roman item 2<\/li><\/ol>/);
assert.match(imported.content, /<td[^>]*><p[^>]*>Import Cell 1<\/p><ol data-list-format="decimal"[^>]*><li>Table ordered item<\/li><\/ol><\/td>/);
const importedIndentedTable = (imported.content.match(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/g) || []).find((table) => table.includes("Import Cell 1")) || "";
assert.match(importedIndentedTable, /data-table-alignment="left"/);
assert.match(importedIndentedTable, /data-table-indent="720"/);
assert.match(importedIndentedTable, /margin-left:\s*48px/);
assert.match(imported.content, /<td colspan="2" rowspan="2"[^>]*><p[^>]*>Merged approval<\/p><\/td><td[^>]*><p[^>]*>Approved<\/p><\/td>/);
// 中文注解：标题识别必须以 Word 的 outlineLvl 为准，不能依赖英文 Heading 或中文“标题”样式名称。
assert.match(imported.content, /<h4[^>]+data-outline-level="3"[^>]*>[\s\S]*?Custom outline level 4[\s\S]*?<\/h4>/);
assert.match(imported.content, /<p[^>]+data-outline-level="7"[^>]*>[\s\S]*?Direct outline level 8[\s\S]*?<\/p>/);
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
  paperSize: { width: 11906, height: 16838 },
  pageNumberFormat: "decimal",
  pageNumberStart: null,
  headerDistance: 360,
  footerDistance: 900,
  columns: { count: 2, space: 720, separate: true },
  verticalAlign: "center",
  pageBorders: {
    display: "firstPage",
    offsetFrom: "page",
    zOrder: "front",
    top: { style: "double", size: 12, color: "#1F4E79", space: 24 },
    right: { style: "double", size: 12, color: "#1F4E79", space: 24 },
    bottom: { style: "double", size: 12, color: "#1F4E79", space: 24 },
    left: { style: "double", size: 12, color: "#1F4E79", space: 24 }
  },
  gutter: 720,
  margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
});

const inheritedParagraph = imported.content.match(/<p[^>]*>Inherited spacing<\/p>/)?.[0] || "";
assert.match(inheritedParagraph, /line-height:\s*1\.15/);
assert.match(inheritedParagraph, /margin-top:\s*6pt/);
assert.match(inheritedParagraph, /margin-bottom:\s*12pt/);
const atLeastParagraph = imported.content.match(/<p[^>]*>At least spacing<\/p>/)?.[0] || "";
assert.match(atLeastParagraph, /line-height:\s*18pt/);
assert.match(atLeastParagraph, /--word-line-rule:\s*atLeast/);
const hangingIndentParagraph = imported.content.match(/<p[^>]*>Hanging indent source<\/p>/)?.[0] || "";
assert.match(hangingIndentParagraph, /margin-left:\s*36pt/);
assert.match(hangingIndentParagraph, /text-indent:\s*-18pt/);
const sideIndentsParagraph = imported.content.match(/<p[^>]*>Side indents source<\/p>/)?.[0] || "";
assert.match(sideIndentsParagraph, /margin-left:\s*24pt/);
assert.match(sideIndentsParagraph, /margin-right:\s*18pt/);

const roundTripBuffer = await createDocxBuffer({ title: "Spacing round trip", content: imported.content, pageLayout: imported.pageLayout });
const roundTripColumnsZip = await JSZip.loadAsync(roundTripBuffer);
const roundTripColumnsXml = await roundTripColumnsZip.file("word/document.xml")?.async("string") || "";
assert.match(roundTripColumnsXml, /<w:cols[^>]+w:space="720"[^>]+w:num="2"[^>]+w:sep="true"[^>]+w:equalWidth="true"/);
assert.match(roundTripColumnsXml, /<w:pgBorders[^>]+w:display="firstPage"[^>]+w:offsetFrom="page"[^>]+w:zOrder="front"/);
assert.match(roundTripColumnsXml, /<w:top w:val="double" w:color="1F4E79" w:sz="12" w:space="24"\/>/);
assert.match(roundTripColumnsXml, /<w:vAlign w:val="center"\/>/);
const roundTripZip = await JSZip.loadAsync(roundTripBuffer);
const roundTripXml = await roundTripZip.file("word/document.xml")?.async("string") || "";
const roundTripNumberingXml = await roundTripZip.file("word/numbering.xml")?.async("string") || "";
const roundTripFootnotesXml = await roundTripZip.file("word/footnotes.xml")?.async("string") || "";
const roundTripEndnotesXml = await roundTripZip.file("word/endnotes.xml")?.async("string") || "";
const roundTripCommentsXml = await roundTripZip.file("word/comments.xml")?.async("string") || "";
const decoratedRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || [])
  .find((run) => run.includes(">斜体下划线删除线文本</w:t>")) || "";
assert.match(decoratedRoundTripXml, /<w:i\/>/);
assert.match(decoratedRoundTripXml, /<w:u(?:\s+w:val="single")?\/>/);
assert.match(decoratedRoundTripXml, /<w:strike\/>/);
assert.match(roundTripXml, /<w:gridSpan w:val="2"\/>/);
assert.match(roundTripXml, /<w:br w:type="column"\/>/);
assert.match(roundTripXml, /<w:vMerge w:val="restart"\/>/);
assert.match(roundTripXml, /<w:vMerge w:val="continue"\/>/);
assert.match(roundTripNumberingXml, /<w:start w:val="7"\/>/);
assert.match(roundTripNumberingXml, /<w:numFmt w:val="upperRoman"\/>/);
// 中文注解：高级字符格式必须在导入后再次导出为 Word 原生属性，不能只停留为浏览器视觉样式。
assert.match(roundTripXml, /<w:highlight w:val="yellow"\/>/);
const darkCyanHighlightRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Dark cyan highlight")) || "";
assert.match(darkCyanHighlightRoundTripXml, /<w:highlight w:val="darkCyan"\/>/);
assert.match(roundTripXml, /<w:vertAlign w:val="superscript"\/>/);
assert.match(roundTripXml, /<w:vertAlign w:val="subscript"\/>/);
const advancedCharacterRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Expanded raised text")) || "";
assert.match(advancedCharacterRoundTripXml, /<w:spacing w:val="40"\/>/);
assert.match(advancedCharacterRoundTripXml, /<w:position w:val="6"\/>/);
const advancedUnderlineRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Double green underline")) || "";
assert.match(advancedUnderlineRoundTripXml, /<w:u w:val="double" w:color="00AA00"\/>/);
const allCapsRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("All caps source")) || "";
const smallCapsRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Small caps source")) || "";
assert.match(allCapsRoundTripXml, /<w:caps\/>/);
assert.match(smallCapsRoundTripXml, /<w:smallCaps\/>/);
const doubleStrikeRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Double strike source")) || "";
assert.match(doubleStrikeRoundTripXml, /<w:dstrike\/>/);
assert.doesNotMatch(doubleStrikeRoundTripXml, /<w:strike(?:\s|\/|>)/);
const runBorderRoundTripXml = (roundTripXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || []).find((run) => run.includes("Run border source")) || "";
assert.match(runBorderRoundTripXml, /<w:bdr[^>]+w:val="double"[^>]+w:color="C00000"[^>]+w:sz="12"[^>]+w:space="2"\/>/);
const paginationControlledRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Pagination controlled paragraph")) || "";
assert.match(paginationControlledRoundTripXml, /<w:keepNext\/>/);
assert.match(paginationControlledRoundTripXml, /<w:keepLines\/>/);
assert.match(paginationControlledRoundTripXml, /<w:pageBreakBefore\/>/);
assert.match(paginationControlledRoundTripXml, /<w:widowControl\/>/);
const widowDisabledRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Widow control disabled paragraph")) || "";
assert.match(widowDisabledRoundTripXml, /<w:widowControl w:val="false"\/>/);
const rtlRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("RTL paragraph source")) || "";
assert.match(rtlRoundTripXml, /<w:bidi\/>/);
const specialHyphenRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("inter") && paragraph.includes("2026")) || "";
assert.match(specialHyphenRoundTripXml, /inter[\s\S]*?<w:softHyphen\/>[\s\S]*?national code[\s\S]*?<w:noBreakHyphen\/>[\s\S]*?2026/);
const manualLineBreakRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Manual line one") && paragraph.includes("Manual line two")) || "";
// 中文注解：导入的手动换行需在再次导出时继续保持同一段落内的 w:br。
assert.match(manualLineBreakRoundTripXml, /Manual line one[\s\S]*?<w:br\/>[\s\S]*?Manual line two/);
assert.match(roundTripXml, /Footnote source[\s\S]*?<w:footnoteReference w:id="2"\/>/);
assert.match(roundTripFootnotesXml, /<w:footnote w:id="2">[\s\S]*Imported footnote detail[\s\S]*<\/w:footnote>/);
assert.match(roundTripXml, /Endnote source[\s\S]*?<w:endnoteReference w:id="3"\/>/);
assert.match(roundTripEndnotesXml, /<w:endnote w:id="3">[\s\S]*Imported endnote detail[\s\S]*<\/w:endnote>/);
assert.match(roundTripXml, /<w:commentRangeStart w:id="4"\/>[\s\S]*commented source[\s\S]*<w:commentRangeEnd w:id="4"\/>[\s\S]*<w:commentReference w:id="4"\/>/);
assert.match(roundTripCommentsXml, /<w:comment(?=[^>]+w:id="4")(?=[^>]+w:author="Imported Reviewer")(?=[^>]+w:initials="IR")[^>]*>[\s\S]*Imported review note[\s\S]*<\/w:comment>/);
assert.equal((roundTripXml.match(/<w:commentRangeStart w:id="5"\/>/g) || []).length, 1);
assert.equal((roundTripXml.match(/<w:commentRangeEnd w:id="5"\/>/g) || []).length, 1);
assert.match(roundTripXml, /<w:commentRangeStart w:id="5"\/>[\s\S]*Cross comment first paragraph[\s\S]*Cross comment second paragraph[\s\S]*<w:commentRangeEnd w:id="5"\/>/);
assert.match(roundTripCommentsXml, /<w:comment(?=[^>]+w:id="5")(?=[^>]+w:author="Cross Reviewer")(?=[^>]+w:initials="CR")[^>]*>[\s\S]*Cross paragraph review[\s\S]*<\/w:comment>/);
const customOutlineRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Custom outline level 4")) || "";
const directOutlineRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Direct outline level 8")) || "";
assert.match(customOutlineRoundTripXml, /<w:outlineLvl w:val="3"\/>/);
assert.match(directOutlineRoundTripXml, /<w:outlineLvl w:val="7"\/>/);
const tabRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || []).find((paragraph) => paragraph.includes("Tab project")) || "";
assert.match(tabRoundTripXml, /<w:tabs><w:tab w:val="left" w:pos="1440"\/><w:tab w:val="right" w:pos="5760"\/><\/w:tabs>/);
assert.equal((tabRoundTripXml.match(/<w:tab\/>/g) || []).length, 2);
const geometryRoundTripXml = (roundTripXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((table) => table.includes("Geometry A")) || "";
assert.match(geometryRoundTripXml, /<w:tblW w:type="dxa" w:w="6000"\/>/);
assert.match(geometryRoundTripXml, /<w:tblLayout w:type="fixed"\/>/);
assert.match(geometryRoundTripXml, /<w:jc w:val="center"\/>/);
assert.match(geometryRoundTripXml, /<w:tblCellSpacing(?=[^>]+w:type="dxa")(?=[^>]+w:w="120")[^>]*\/>/);
const geometryTableBordersRoundTripXml = geometryRoundTripXml.match(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/)?.[0] || "";
assert.match(geometryTableBordersRoundTripXml, /<w:top w:val="single" w:color="FF0000" w:sz="8"\/>/);
assert.match(geometryTableBordersRoundTripXml, /<w:right w:val="dashed" w:color="00AA00" w:sz="6"\/>/);
assert.match(geometryTableBordersRoundTripXml, /<w:bottom w:val="double" w:color="0000FF" w:sz="12"\/>/);
assert.match(geometryTableBordersRoundTripXml, /<w:left w:val="nil" w:color="000000" w:sz="0"\/>/);
assert.match(geometryRoundTripXml, /<w:tblGrid><w:gridCol w:w="1800"\/><w:gridCol w:w="4200"\/><\/w:tblGrid>/);
assert.match(geometryRoundTripXml, /<w:tcW w:type="dxa" w:w="1800"\/>/);
assert.match(geometryRoundTripXml, /<w:tcW w:type="dxa" w:w="4200"\/>/);
const geometryRowRoundTripXml = geometryRoundTripXml.match(/<w:tr>[\s\S]*?<\/w:tr>/)?.[0] || "";
assert.match(geometryRowRoundTripXml, /<w:tblHeader\/>/);
assert.match(geometryRowRoundTripXml, /<w:cantSplit\/>/);
assert.match(geometryRowRoundTripXml, /<w:trHeight w:val="720" w:hRule="exact"\/>/);
const geometryCellRoundTripXml = (geometryRoundTripXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).find((cell) => cell.includes("Geometry A")) || "";
assert.match(geometryCellRoundTripXml, /<w:tcMar>/);
for (const [side, width] of [["top", 100], ["right", 600], ["bottom", 300], ["left", 400]]) assert.match(geometryCellRoundTripXml, new RegExp(`<w:${side} w:type="dxa" w:w="${width}"\\/>`));
assert.match(geometryCellRoundTripXml, /<w:shd w:fill="D9EAD3"\/>/);
assert.match(geometryCellRoundTripXml, /<w:vAlign w:val="center"\/>/);
assert.match(geometryCellRoundTripXml, /<w:textDirection w:val="tbRl"\/>/);
const reverseGeometryCellRoundTripXml = (geometryRoundTripXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).find((cell) => cell.includes("Geometry B")) || "";
assert.match(reverseGeometryCellRoundTripXml, /<w:textDirection w:val="btLr"\/>/);
const geometryCellBordersRoundTripXml = geometryCellRoundTripXml.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/)?.[0] || "";
assert.match(geometryCellBordersRoundTripXml, /<w:top w:val="single" w:color="FF0000" w:sz="8"\/>/);
assert.match(geometryCellBordersRoundTripXml, /<w:right w:val="double" w:color="800080" w:sz="16"\/>/);
assert.match(geometryCellBordersRoundTripXml, /<w:bottom w:val="double" w:color="0000FF" w:sz="12"\/>/);
assert.match(geometryCellBordersRoundTripXml, /<w:left w:val="nil" w:color="000000" w:sz="0"\/>/);
const indentedTableRoundTripXml = (roundTripXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((table) => table.includes("Import Cell 1")) || "";
assert.match(indentedTableRoundTripXml, /<w:jc w:val="left"\/>/);
assert.match(indentedTableRoundTripXml, /<w:tblInd w:type="dxa" w:w="720"\/>/);
const roundTripImported = await parseImportedDocument({
  originalname: "round-trip-format.docx",
  buffer: roundTripBuffer,
  mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: roundTripBuffer.length
});
// 中文注解：docx 会写出 b=false 等显式关闭标记，再导入时不能把未加粗文本误判成粗体。
assert.match(roundTripImported.content, /<s><em><u>斜体下划线删除线文本<\/u><\/em><\/s>/);
assert.match(roundTripImported.content, /<mark data-highlight="yellow"[^>]*>Highlighted text<\/mark>/);
assert.match(roundTripImported.content, /<mark data-highlight="darkCyan"[^>]*>Dark cyan highlight<\/mark>/);
assert.match(roundTripImported.content, /<sup>Superscript text<\/sup>/);
assert.match(roundTripImported.content, /<sub>Subscript text<\/sub>/);
assert.match(roundTripImported.content, /<span[^>]+style="[^"]*letter-spacing:\s*2pt[^"]*vertical-align:\s*3pt[^"]*"[^>]*>Expanded raised text<\/span>/);
assert.match(roundTripImported.content, /text-decoration-style:\s*double/);
assert.match(roundTripImported.content, /text-decoration-color:\s*#00AA00/i);
assert.match(roundTripImported.content, /text-transform:\s*uppercase/);
assert.match(roundTripImported.content, /font-variant-caps:\s*small-caps/);
assert.match(roundTripImported.content, /--word-text-border:\s*double,12,C00000,2/i);
assert.match(roundTripImported.content, /<ol data-list-format="decimal"[^>]*>[\s\S]*?<ol data-list-format="lowerLetter" style="list-style-type:\s*lower-alpha">[\s\S]*?Nested ordered item/);
assert.match(roundTripImported.content, /<ol start="7" data-list-format="upperRoman"[^>]*>[\s\S]*?Started Roman item 1/);
assert.match(roundTripImported.content, /<p[^>]+data-keep-next="true"[^>]+data-keep-lines="true"[^>]+data-page-break-before="true"[^>]+data-widow-control="true"[^>]*>[\s\S]*?Pagination controlled paragraph[\s\S]*?<\/p>/);
assert.match(roundTripImported.content, /<p[^>]+data-widow-control="false"[^>]*>[\s\S]*?Widow control disabled paragraph[\s\S]*?<\/p>/);
const roundTripRtlParagraph = (roundTripImported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || []).find((paragraph) => paragraph.includes("RTL paragraph source")) || "";
assert.match(roundTripRtlParagraph, /data-bidirectional="true"/);
assert.match(roundTripRtlParagraph, /direction:\s*rtl/);
const roundTripSpecialHyphenParagraph = (roundTripImported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || []).find((paragraph) => paragraph.includes("inter") && paragraph.includes("2026")) || "";
assert.equal(roundTripSpecialHyphenParagraph.replace(/<[^>]+>/g, ""), "inter\u00ADnational code\u20112026");
assert.match(roundTripImported.content, /<span[^>]+data-double-strike="true"[^>]+style="[^"]*text-decoration-line:\s*line-through[^"]*text-decoration-style:\s*double[^"]*"[^>]*>Double strike source<\/span>/);
const roundTripManualLineBreakParagraph = (roundTripImported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || []).find((paragraph) => paragraph.includes("Manual line one") && paragraph.includes("Manual line two")) || "";
assert.match(roundTripManualLineBreakParagraph, /Manual line one[\s\S]*?<br\s*\/?\s*>[\s\S]*?Manual line two/);
assert.match(roundTripImported.content, /Footnote source[\s\S]*?data-footnote-id="2"[^>]+data-footnote-text="Imported footnote detail"/);
assert.match(roundTripImported.content, /Endnote source[\s\S]*?data-endnote-id="3"[^>]+data-endnote-text="Imported endnote detail"/);
assert.match(roundTripImported.content, /<span(?=[^>]+data-comment-id="4")(?=[^>]+data-comment-text="Imported review note")(?=[^>]+data-comment-author="Imported Reviewer")(?=[^>]+data-comment-initials="IR")[^>]*>[\s\S]*?commented source[\s\S]*?<\/span>/);
assert.equal((roundTripImported.content.match(/data-comment-id="5"/g) || []).length, 2);
assert.match(roundTripImported.content, /data-comment-id="5"[^>]+data-comment-text="Cross paragraph review"[^>]*>[\s\S]*?Cross comment first paragraph/);
assert.match(roundTripImported.content, /data-comment-id="5"[^>]+data-comment-text="Cross paragraph review"[^>]*>[\s\S]*?Cross comment second paragraph/);
assert.match(roundTripImported.content, /<h4[^>]+data-outline-level="3"[^>]*>[\s\S]*?Custom outline level 4/);
assert.match(roundTripImported.content, /<p[^>]+data-outline-level="7"[^>]*>[\s\S]*?Direct outline level 8/);
assert.match(roundTripImported.content, /分栏符前[\s\S]*?<\/p><div data-column-break="true" class="column-break-marker"><\/div><p[^>]*>[\s\S]*?分栏符后/);
const roundTripImportedTabParagraph = (roundTripImported.content.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g) || [])
  .find((paragraph) => paragraph.includes("Tab project") && paragraph.includes("100.00")) || "";
assert.equal((roundTripImportedTabParagraph.match(/data-docx-tab="true"/g) || []).length, 2);
assert.match(roundTripImportedTabParagraph, /data-tab-position="1440"[^>]+data-tab-alignment="left"/);
assert.match(roundTripImportedTabParagraph, /data-tab-position="5760"[^>]+data-tab-alignment="right"/);
const roundTripImportedGeometryTable = (roundTripImported.content.match(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/g) || []).find((table) => table.includes("Geometry A")) || "";
assert.match(roundTripImportedGeometryTable, /data-table-alignment="center"/);
assert.match(roundTripImportedGeometryTable, /data-table-cell-spacing="120"/);
assert.match(roundTripImportedGeometryTable, /border-collapse:\s*separate/);
assert.match(roundTripImportedGeometryTable, /border-spacing:\s*8px/);
assert.match(roundTripImportedGeometryTable, /margin-left:\s*auto/);
assert.match(roundTripImportedGeometryTable, /margin-right:\s*auto/);
assert.match(roundTripImportedGeometryTable, /style="(?=[^"]*width:\s*400px)(?=[^"]*margin-left:\s*auto)(?=[^"]*margin-right:\s*auto)(?=[^"]*table-layout:\s*fixed)[^"]*"/);
assert.match(roundTripImportedGeometryTable, /colwidth="120"/);
assert.match(roundTripImportedGeometryTable, /colwidth="280"/);
const roundTripImportedIndentedTable = (roundTripImported.content.match(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/g) || []).find((table) => table.includes("Import Cell 1")) || "";
assert.match(roundTripImportedIndentedTable, /data-table-indent="720"/);
assert.match(roundTripImportedIndentedTable, /margin-left:\s*48px/);
assert.match(roundTripImportedGeometryTable, /data-cell-vertical-align="center"/);
assert.match(roundTripImportedGeometryTable, /data-cell-text-direction="tbRl"/);
assert.match(roundTripImportedGeometryTable, /data-cell-text-direction="btLr"/);
assert.match(roundTripImportedGeometryTable, /writing-mode:\s*sideways-rl/);
assert.match(roundTripImportedGeometryTable, /writing-mode:\s*sideways-lr/);
assert.match(roundTripImportedGeometryTable, /data-cell-shading="#D9EAD3"/);
assert.match(roundTripImportedGeometryTable, /padding-right:\s*40px/);
assert.match(roundTripImportedGeometryTable, /data-row-height="720"/);
assert.match(roundTripImportedGeometryTable, /data-row-height-rule="exact"/);
assert.match(roundTripImportedGeometryTable, /data-row-cant-split="true"/);
assert.match(roundTripImportedGeometryTable, /data-row-repeat-header="true"/);
assert.match(roundTripImportedGeometryTable, /data-table-borders=/);
assert.match(roundTripImportedGeometryTable, /data-cell-borders=/);
assert.match(roundTripImportedGeometryTable, /border-right:\s*2\.67px double #800080/);
assert.deepEqual(roundTripImported.pageLayout, imported.pageLayout);
const atLeastRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
  .find((paragraph) => paragraph.includes(">At least spacing</w:t>")) || "";
// 中文注解：最小行距往返后仍必须是 atLeast，避免大字号文字被固定行高裁切并改变分页。
assert.match(atLeastRoundTripXml, /<w:spacing[^>]+w:line="360"/);
assert.match(atLeastRoundTripXml, /<w:spacing[^>]+w:lineRule="atLeast"/);
const hangingIndentRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
  .find((paragraph) => paragraph.includes(">Hanging indent source</w:t>")) || "";
assert.match(hangingIndentRoundTripXml, /<w:ind(?=[^>]+w:left="720")(?=[^>]+w:hanging="360")[^>]*\/>/);
const sideIndentsRoundTripXml = (roundTripXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
  .find((paragraph) => paragraph.includes(">Side indents source</w:t>")) || "";
assert.match(sideIndentsRoundTripXml, /<w:ind(?=[^>]+w:left="480")(?=[^>]+w:right="360")[^>]*\/>/);

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
  paperSize: { width: 11906, height: 16838 },
  pageNumberFormat: "decimal",
  pageNumberStart: null,
  headerDistance: 708,
  footerDistance: 708,
  columns: { count: 1, space: 720, separate: false },
  verticalAlign: "top",
  pageBorders: null,
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
  columns: { count: 1, space: 720, separate: false },
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
    columns: { count: 2, space: 720, separate: true, equalWidth: false, items: [{ width: 3000, space: 720 }, { width: 5000, space: 0 }] },
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
assert.equal(multiSectionImported.pageLayout.columns.equalWidth, false);
assert.deepEqual(multiSectionImported.pageLayout.margins, { top: 1440, right: 1440, bottom: 1440, left: 1440 });
const importedSecondSectionAttribute = multiSectionImported.content.match(/data-section-layout="([^"]+)"/)?.[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&") || "{}";
assert.deepEqual(JSON.parse(importedSecondSectionAttribute).columns, { count: 1, space: 720, separate: false });
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
