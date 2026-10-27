import { afterEach, describe, expect, it, vi } from "vitest";
import { padButtons } from "../src/lib/remote/touch";
import { bindControls } from "../src/lib/remote/controls";
const rect = { left: 10, top: 20, width: 150, height: 150 };
afterEach(() => vi.unstubAllGlobals());
describe("direcional de toque", () => {
  it("resolve oito direções, centro neutro, espaços e arraste fora dos limites", () => {
    for (const [x, y, buttons] of [
      [35, 45, [4, 6]],
      [85, 45, [4]],
      [135, 45, [4, 7]],
      [35, 95, [6]],
      [135, 95, [7]],
      [35, 145, [5, 6]],
      [85, 145, [5]],
      [135, 145, [5, 7]],
      [85, 95, []],
      [83, 96, []],
      [180, 95, [7]],
    ] as [number, number, number[]][])
      expect(padButtons(x, y, rect)).toEqual(buttons);
  });
});
describe("entrada sem espera pelo quadro de animação", () => {
  function setup() {
    const win = new EventTarget(),
      doc = Object.assign(new EventTarget(), { hidden: false });
    const raf = vi.fn(() => 1),
      cancel = vi.fn(),
      send = vi.fn(),
      touch = new Set<number>();
    let pads: any[] = [];
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { getGamepads: () => pads });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const cleanup = bindControls(send, undefined, touch);
    const key = (type: string, code: string) =>
      win.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), { code }),
      );
    return {
      win,
      doc,
      raf,
      send,
      touch,
      cleanup,
      key,
      setPads: (p: any[]) => {
        pads = p;
      },
    };
  }
  it("envia combinações e solturas de teclado/toque imediatamente sem polling ocioso", () => {
    const h = setup();
    expect(h.raf).not.toHaveBeenCalled();
    h.key("keydown", "ArrowRight");
    expect(h.send).toHaveBeenLastCalledWith([7]);
    h.touch.add(0);
    h.win.dispatchEvent(new Event("bomber-touch"));
    expect(h.send).toHaveBeenLastCalledWith([0, 7]);
    h.key("keyup", "ArrowRight");
    expect(h.send).toHaveBeenLastCalledWith([0]);
    const calls = h.send.mock.calls.length;
    h.win.dispatchEvent(new Event("bomber-touch"));
    expect(h.send).toHaveBeenCalledTimes(calls);
    h.touch.clear();
    h.win.dispatchEvent(new Event("bomber-touch"));
    expect(h.send).toHaveBeenLastCalledWith([]);
    expect(h.raf).not.toHaveBeenCalled();
    h.cleanup();
  });
  it("libera em perda de foco/visibilidade e remove os listeners no descarte", () => {
    const h = setup();
    h.key("keydown", "KeyX");
    h.win.dispatchEvent(new Event("blur"));
    expect(h.send).toHaveBeenLastCalledWith([]);
    h.touch.add(4);
    h.win.dispatchEvent(new Event("bomber-touch"));
    expect(h.send).toHaveBeenLastCalledWith([4]);
    h.doc.hidden = true;
    h.doc.dispatchEvent(new Event("visibilitychange"));
    expect(h.send).toHaveBeenLastCalledWith([]);
    h.cleanup();
    const count = h.send.mock.calls.length;
    h.key("keydown", "KeyX");
    expect(h.send).toHaveBeenCalledTimes(count);
  });
  it("ativa a leitura por quadro somente ao conectar um controle físico", () => {
    const h = setup();
    h.setPads([
      {
        buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 1 })),
        axes: [1, 0],
      },
    ]);
    h.win.dispatchEvent(new Event("gamepadconnected"));
    expect(h.raf).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenLastCalledWith([7, 8]);
    h.setPads([]);
    h.win.dispatchEvent(new Event("gamepaddisconnected"));
    expect(h.send).toHaveBeenLastCalledWith([]);
    h.cleanup();
  });
});
