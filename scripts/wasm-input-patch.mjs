// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
// The five-pad patch extends three input functions. Optional netplay adds
// callbacks and a native run counter. Original instructions and game data stay intact.
export function uint(n) {
  const out = [];
  do {
    let byte = n & 127;
    n >>>= 7;
    if (n) byte |= 128;
    out.push(byte);
  } while (n);
  return Buffer.from(out);
}
function sint(n) {
  const out = [];
  for (;;) {
    let byte = n & 127;
    n >>= 7;
    const done = (n === 0 && !(byte & 64)) || (n === -1 && !!(byte & 64));
    out.push(done ? byte : byte | 128);
    if (done) return Buffer.from(out);
  }
}
function read(bytes, cursor) {
  let n = 0,
    shift = 0,
    b;
  do {
    b = bytes[cursor.at++];
    n |= (b & 127) << shift;
    shift += 7;
  } while (b & 128);
  return n >>> 0;
}
function sections(bytes) {
  const out = [],
    c = { at: 8 };
  while (c.at < bytes.length) {
    const id = bytes[c.at++],
      size = read(bytes, c);
    out.push({ id, data: bytes.subarray(c.at, c.at + size) });
    c.at += size;
  }
  return out;
}
const pack = (parts) =>
  Buffer.concat([
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
    ...parts.flatMap(({ id, data }) => [
      Buffer.from([id]),
      uint(data.length),
      data,
    ]),
  ]);
export function fiveInputPatch(
  original,
  names,
  getterIndex,
  controllerIndex,
  extraExports = {},
  netplayInput,
) {
  const parts = sections(original);
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(original));
  assert.ok(imports.every((i) => i.kind === "function"));
  const globalSection = parts.find((s) => s.id === 6),
    gc = { at: 0 };
  const globalCount = read(globalSection.data, gc),
    g = [...uint(globalCount)];
  globalSection.data = Buffer.concat([
    uint(globalCount + (netplayInput ? 6 : 1)),
    globalSection.data.subarray(gc.at),
    Buffer.from([0x7f, 1, 0x41, 0, 0x0b]),
    ...(netplayInput
      ? Array.from({ length: 5 }, () => Buffer.from([0x7f, 1, 0x41, 0, 0x0b]))
      : []),
  ]);
  const exports = parts.find((s) => s.id === 7),
    ec = { at: 0 };
  const exportCount = read(exports.data, ec);
  const exportMap = {};
  for (let i = 0; i < exportCount; i++) {
    const len = read(exports.data, ec),
      name = exports.data.subarray(ec.at, ec.at + len).toString();
    ec.at += len;
    const kind = exports.data[ec.at++],
      index = read(exports.data, ec);
    if (kind === 0) exportMap[name] = index;
  }
  // Opcodes: get/set local/global; if/else/end; i32 comparisons/bit operations.
  const setter = [
    0x20,
    0,
    0x41,
    4,
    0x46,
    0x04,
    0x40,
    0x20,
    1,
    0x41,
    24,
    0x49,
    0x04,
    0x40,
    0x20,
    2,
    0x04,
    0x40,
    0x23,
    ...g,
    0x41,
    1,
    0x20,
    1,
    0x74,
    0x72,
    0x24,
    ...g,
    0x05,
    0x23,
    ...g,
    0x41,
    1,
    0x20,
    1,
    0x74,
    0x41,
    0x7f,
    0x73,
    0x71,
    0x24,
    ...g,
    0x0b,
    0x0b,
    0x0f,
    0x0b,
  ];
  const getter = [
    0x20,
    0,
    0x41,
    4,
    0x46,
    0x04,
    0x40,
    0x20,
    1,
    0x41,
    24,
    0x49,
    0x04,
    0x40,
    0x23,
    ...g,
    0x41,
    1,
    0x20,
    1,
    0x74,
    0x71,
    0x41,
    0,
    0x47,
    0x0f,
    0x0b,
    0x41,
    0,
    0x0f,
    0x0b,
  ];
  const clear = [0x20, 0, 0x41, 1, 0x4d, 0x04, 0x40, 0x41, 0, 0x24, ...g, 0x0b];
  const prefixes = new Map([
    [exportMap[names.input], setter],
    [getterIndex, getter],
    [exportMap[names.clear], clear],
  ]);
  assert.equal(prefixes.size, 3);
  if (netplayInput)
    prefixes.set(netplayInput.runner, [
      0x23,
      ...uint(globalCount + 5),
      0x41,
      1,
      0x6a,
      0x24,
      ...uint(globalCount + 5),
    ]);
  const code = parts.find((s) => s.id === 10),
    cc = { at: 0 },
    count = read(code.data, cc),
    bodies = [uint(count)];
  for (let i = 0; i < count; i++) {
    const size = read(code.data, cc),
      body = code.data.subarray(cc.at, cc.at + size);
    cc.at += size;
    const prefix = prefixes.get(i + imports.length);
    let updated = body;
    if (prefix) {
      const lc = { at: 0 },
        declarations = read(body, lc);
      for (let d = 0; d < declarations; d++) {
        read(body, lc);
        lc.at++;
      }
      updated = Buffer.concat([
        body.subarray(0, lc.at),
        Buffer.from(prefix),
        body.subarray(lc.at),
      ]);
    }
    bodies.push(uint(updated.length), updated);
  }
  if (netplayInput) {
    const functions = parts.find((s) => s.id === 3),
      fc = { at: 0 },
      functionCount = read(functions.data, fc);
    assert.equal(functionCount, count);
    const readerIndex = imports.length + functionCount,
      binderIndex = readerIndex + 1;
    functions.data = Buffer.concat([
      uint(functionCount + 8),
      functions.data.subarray(fc.at),
      uint(netplayInput.readerType),
      uint(netplayInput.voidType),
      uint(netplayInput.videoType),
      ...Array.from({ length: 5 }, () => uint(netplayInput.sizeType)),
    ]);
    const tables = parts.find((s) => s.id === 4),
      tc = { at: 0 };
    assert.equal(read(tables.data, tc), 1);
    assert.equal(tables.data[tc.at++], 0x70);
    const flags = read(tables.data, tc);
    assert.ok(flags === 0 || flags === 1);
    const tableSlot = read(tables.data, tc),
      maximum = flags ? read(tables.data, tc) : undefined;
    assert.equal(tc.at, tables.data.length);
    tables.data = Buffer.concat([
      uint(1),
      Buffer.from([0x70]),
      uint(flags),
      uint(tableSlot + 2),
      ...(flags ? [uint(Math.max(maximum, tableSlot + 2))] : []),
    ]);
    const elements = parts.find((s) => s.id === 9),
      ec = { at: 0 },
      elementCount = read(elements.data, ec);
    elements.data = Buffer.concat([
      uint(elementCount + 1),
      elements.data.subarray(ec.at),
      Buffer.from([0, 0x41]),
      sint(tableSlot),
      Buffer.from([0x0b]),
      uint(2),
      uint(readerIndex),
      uint(readerIndex + 2),
    ]);
    // Standard libretro input_state(port,device,index,id): read the virtual pad
    // directly. RetroArch's frontend cache is not advanced by retro_run alone.
    const reader = [
      0,
      0x20,
      1,
      0x41,
      1,
      0x47,
      0x20,
      2,
      0x72,
      0x04,
      0x40,
      0x41,
      0,
      0x0f,
      0x0b,
      0x20,
      3,
      0x41,
      ...sint(256),
      0x46,
      0x04,
      0x40,
      0x41,
      0,
    ];
    for (let b = 0; b < 16; b++)
      reader.push(
        0x20,
        0,
        0x41,
        b,
        0x10,
        ...uint(getterIndex),
        0x41,
        b,
        0x74,
        0x72,
      );
    reader.push(
      0x0f,
      0x0b,
      0x20,
      3,
      0x41,
      16,
      0x49,
      0x04,
      0x40,
      0x20,
      0,
      0x20,
      3,
      0x10,
      ...uint(getterIndex),
      0x0f,
      0x0b,
      0x41,
      0,
      0x0b,
    );
    const binder = Buffer.concat([
      Buffer.from([0, 0x41]),
      sint(tableSlot),
      Buffer.from([0x10]),
      uint(netplayInput.setter),
      Buffer.from([0x41]),
      sint(tableSlot + 1),
      Buffer.from([0x10]),
      uint(netplayInput.videoSetter),
      Buffer.from([0x0b]),
    ]);
    // Software SNES video_refresh(data,w,h,pitch). Keep only metadata; the
    // frontend reads RGB565 directly into its local canvas, without streaming.
    const video = [
      0, 0x20, 0, 0x45, 0x20, 0, 0x41, 0x7f, 0x46, 0x72, 0x04, 0x40, 0x0f, 0x0b,
    ];
    for (let i = 0; i < 4; i++)
      video.push(0x20, i, 0x24, ...uint(globalCount + 1 + i));
    video.push(0x0b);
    bodies[0] = uint(count + 8);
    bodies.push(
      uint(reader.length),
      Buffer.from(reader),
      uint(binder.length),
      binder,
    );
    bodies.push(uint(video.length), Buffer.from(video));
    for (let i = 0; i < 4; i++) {
      const getter = Buffer.concat([
        Buffer.from([0, 0x23]),
        uint(globalCount + 1 + i),
        Buffer.from([0x0b]),
      ]);
      bodies.push(uint(getter.length), getter);
    }
    const nativeCounter = Buffer.concat([
      Buffer.from([0, 0x23]),
      uint(globalCount + 5),
      Buffer.from([0x0b]),
    ]);
    bodies.push(uint(nativeCounter.length), nativeCounter);
    extraExports.netplay_read_input = readerIndex;
    extraExports.netplay_bind_input = binderIndex;
    for (const [i, name] of ["pointer", "width", "height", "pitch"].entries())
      extraExports[`netplay_video_${name}`] = readerIndex + 3 + i;
    extraExports.netplay_native_frame = readerIndex + 7;
  }
  code.data = Buffer.concat(bodies);
  const exportCursor = { at: 0 };
  read(exports.data, exportCursor);
  const controllerLabel = Buffer.from("bomber_set_controller_port_device");
  const additional = Object.entries(extraExports).flatMap(([name, index]) => {
    const label = Buffer.from(name);
    return [uint(label.length), label, Buffer.from([0]), uint(index)];
  });
  const addedCount = 1 + Object.keys(extraExports).length;
  exports.data = Buffer.concat([
    uint(exportCount + addedCount),
    exports.data.subarray(exportCursor.at),
    uint(controllerLabel.length),
    controllerLabel,
    Buffer.from([0]),
    uint(controllerIndex),
    ...additional,
  ]);
  const patched = pack(parts);
  assert.ok(WebAssembly.validate(patched));
  // This extra export exists only in the test copy, never the shipped core.
  const c = { at: 0 };
  read(exports.data, c);
  const label = Buffer.from("test_input_state");
  exports.data = Buffer.concat([
    uint(exportCount + addedCount + 1),
    exports.data.subarray(c.at),
    uint(label.length),
    label,
    Buffer.from([0]),
    uint(getterIndex),
  ]);
  return { patched, testBytes: pack(parts) };
}
