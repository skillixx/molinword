import assert from "node:assert/strict";
import { readSafeImageDimensions } from "../server/index.js";

const png = Buffer.alloc(24);
Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
png.write("IHDR", 12, "ascii");
png.writeUInt32BE(1600, 16);
png.writeUInt32BE(900, 20);

const gif = Buffer.alloc(10);
gif.write("GIF89a", 0, "ascii");
gif.writeUInt16LE(640, 6);
gif.writeUInt16LE(480, 8);

const jpeg = Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  0x02, 0xd0,
  0x05, 0x00,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9
]);

const webp = Buffer.alloc(30);
webp.write("RIFF", 0, "ascii");
webp.writeUInt32LE(22, 4);
webp.write("WEBP", 8, "ascii");
webp.write("VP8X", 12, "ascii");
webp.writeUInt32LE(10, 16);
webp.writeUIntLE(799, 24, 3);
webp.writeUIntLE(599, 27, 3);

assert.deepEqual(readSafeImageDimensions(png, "image/png"), { width: 1600, height: 900 });
assert.deepEqual(readSafeImageDimensions(gif, "image/gif"), { width: 640, height: 480 });
assert.deepEqual(readSafeImageDimensions(jpeg, "image/jpeg"), { width: 1280, height: 720 });
assert.deepEqual(readSafeImageDimensions(webp, "image/webp"), { width: 800, height: 600 });

const oversizedPng = Buffer.from(png);
oversizedPng.writeUInt32BE(50000, 16);
assert.equal(readSafeImageDimensions(oversizedPng, "image/png"), null);
assert.equal(readSafeImageDimensions(Buffer.from("icns-malicious"), "image/icns"), null);
assert.equal(readSafeImageDimensions(Buffer.alloc(4), "image/png"), null);

console.log("安全图片尺寸解析检查通过。", {
  png: readSafeImageDimensions(png, "image/png"),
  jpeg: readSafeImageDimensions(jpeg, "image/jpeg"),
  gif: readSafeImageDimensions(gif, "image/gif"),
  webp: readSafeImageDimensions(webp, "image/webp")
});
