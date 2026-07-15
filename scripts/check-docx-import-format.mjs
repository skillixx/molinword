import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseImportedDocument } from "../server/index.js";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lT3g6wAAAABJRU5ErkJggg==";

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
</Relationships>`
  );
  zip.folder("word").folder("media").file("image1.png", tinyPngBase64, { base64: true });
  zip.folder("word").file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
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
      <w:pPr><w:jc w:val="both"/><w:ind w:firstLine="480"/></w:pPr>
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
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Header A</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Header B</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Import Cell 1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Import Cell 2</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p>
      <w:r><w:t>分页符前</w:t></w:r>
      <w:r><w:br w:type="page"/></w:r>
      <w:r><w:t>分页符后</w:t></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
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

// 中文注解：这个检查覆盖用户反馈的核心症状，导入后段落、字体、表格和图片不能被洗掉。
assert.match(imported.content, /text-align:\s*center/);
assert.match(imported.content, /font-family:\s*(?:&quot;Microsoft YaHei&quot;|"Microsoft YaHei")/);
assert.match(imported.content, /font-size:\s*24pt/);
assert.match(imported.content, /text-align:\s*justify/);
assert.match(imported.content, /text-indent:\s*24pt/);
assert.match(imported.content, /color:\s*#C00000/i);
assert.match(imported.content, /<strong>/);
assert.match(imported.content, /<table>/);
assert.match(imported.content, /<th>/);
assert.match(imported.content, /<td>/);
assert.match(imported.content, /Import Cell 1/);
assert.match(imported.content, /data-page-break="true"/);
assert.match(imported.content, /<img[^>]+src="data:image\/png;base64,/);

console.log("DOCX import format check passed");
