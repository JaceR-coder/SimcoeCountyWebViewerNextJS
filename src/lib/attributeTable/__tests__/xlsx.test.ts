import { describe, it, expect } from "vitest";
import { buildXlsxBytes, columnName } from "../xlsx";

/** Read a stored (uncompressed) zip by walking its local file headers. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  let pos = 0;
  while (view.getUint32(pos, true) === 0x04034b50) {
    expect(view.getUint16(pos + 8, true)).toBe(0); // stored
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const start = pos + 30 + nameLen;
    files[name] = decoder.decode(bytes.subarray(start, start + size));
    pos = start + size;
  }
  expect(view.getUint32(pos, true)).toBe(0x02014b50); // central directory follows
  return files;
}

describe("xlsx writer", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("writes a valid zip with a typed sheet", () => {
    const bytes = buildXlsxBytes(["Name", "Length (m)", "Open"], [["Hwy 11 & <ramp>", 1234.5, true], ["", null, false]], "Roads: 2026/10");
    const files = unzip(bytes);
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);

    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>');
    expect(sheet).toContain("Hwy 11 &amp; &lt;ramp&gt;");
    expect(sheet).toContain('<c r="B2"><v>1234.5</v></c>');
    expect(sheet).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<row r="3"><c r="C3" t="b"><v>0</v></c></row>');
    expect(sheet).toContain('<autoFilter ref="A1:C3"/>');
    // Sheet names can't contain : or /
    expect(files["xl/workbook.xml"]).toContain('name="Roads  2026 10"');
  });
});
