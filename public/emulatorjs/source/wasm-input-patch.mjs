import assert from "node:assert/strict";
// Edit only three function prefixes and append one frontend-owned i32 global.
// All original instructions, memory/data sections, imports and ABI stay intact.
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
export function fiveInputPatch(original, names, getterIndex, controllerIndex) {
  const parts = sections(original);
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(original));
  assert.ok(imports.every((i) => i.kind === "function"));
  const globalSection = parts.find((s) => s.id === 6),
    gc = { at: 0 };
  const globalCount = read(globalSection.data, gc),
    g = [...uint(globalCount)];
  globalSection.data = Buffer.concat([
    uint(globalCount + 1),
    globalSection.data.subarray(gc.at),
    Buffer.from([0x7f, 1, 0x41, 0, 0x0b]),
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
  code.data = Buffer.concat(bodies);
  const exportCursor = { at: 0 };
  read(exports.data, exportCursor);
  const controllerLabel = Buffer.from("bomber_set_controller_port_device");
  exports.data = Buffer.concat([
    uint(exportCount + 1),
    exports.data.subarray(exportCursor.at),
    uint(controllerLabel.length),
    controllerLabel,
    Buffer.from([0]),
    uint(controllerIndex),
  ]);
  const patched = pack(parts);
  assert.ok(WebAssembly.validate(patched));
  // This extra export exists only in the test copy, never the shipped core.
  const c = { at: 0 };
  read(exports.data, c);
  const label = Buffer.from("test_input_state");
  exports.data = Buffer.concat([
    uint(exportCount + 2),
    exports.data.subarray(c.at),
    uint(label.length),
    label,
    Buffer.from([0]),
    uint(getterIndex),
  ]);
  return { patched, testBytes: pack(parts) };
}
