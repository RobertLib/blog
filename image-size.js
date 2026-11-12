// Pixel dimensions of PNG, GIF, JPEG and WebP files, read from their headers
// so <img> tags can carry width/height (no layout shift while they load)
// without an image-processing dependency.
const fs = require("fs");

function pngSize(buf) {
  // Signature, then the IHDR chunk: length, "IHDR", width, height
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf) {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function jpegSize(buf) {
  // Walk the segments up to a start-of-frame marker (SOF0-SOF15, except the
  // DHT, JPG and DAC markers that share the range)
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30) return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return {
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
    };
  }
  return null;
}

// { width, height } of an image buffer, or null for unknown formats
function imageSizeFromBuffer(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) {
    return pngSize(buf);
  }
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") {
    return gifSize(buf);
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    return jpegSize(buf);
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return webpSize(buf);
  }
  return null;
}

function imageSize(filePath) {
  return imageSizeFromBuffer(fs.readFileSync(filePath));
}

module.exports = { imageSize, imageSizeFromBuffer };
