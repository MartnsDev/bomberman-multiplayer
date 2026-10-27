// Private game-only investigation. No ROM, credentials, or states are logged.
// JSON lines: [{frames:120},{player:0,button:3,frames:8}].
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
const baseURL = process.env.PROBE_BASE_URL || "http://localhost:3001";
await mkdir(".private/multitap", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding"] });
const context = await browser.newContext({ viewport: {width:256,height:224} });
const page = await context.newPage();
page.on("pageerror", e => console.log("PAGE_ERROR",e.message));
const res = await context.request.post(`${baseURL}/api/auth`, { headers: {Origin:baseURL}, data:{password:await readFile(".private/local-owner-password","utf8")} });
if(!res.ok()) throw Error("Login de diagnóstico recusado");
await page.goto(`${baseURL}/emulator.html`);
await page.waitForFunction(() => !!window.__bomber, {}, {timeout:60000});
await page.evaluate(() => EJS_emulator.gameManager.toggleMainLoop(0));
async function runFrames(count) {
  const before = await page.evaluate(() => __bomber.frame());
  await page.evaluate(() => EJS_emulator.gameManager.toggleMainLoop(1));
  await page.waitForTimeout(count * 1000 / 60);
  await page.waitForFunction(({before,count}) => __bomber.frame() >= before+count, {before,count}, {timeout:60000,polling:10});
  await page.evaluate(() => EJS_emulator.gameManager.toggleMainLoop(0));
}
async function shot() {
  await page.evaluate(() => EJS_emulator.gameManager.toggleMainLoop(1));
  await writeFile(".private/multitap/current.png", Buffer.from(await page.evaluate(async () => Array.from(await (async()=>{ try{EJS_emulator.gameManager.FS.unlink('/screenshot.png')}catch{} return await EJS_emulator.gameManager.screenshot(); })()))));
  await page.evaluate(() => EJS_emulator.gameManager.toggleMainLoop(0));

  console.log("CAPTURE",await page.evaluate(() => ({frame:__bomber.frame(), core:EJS_emulator.getCore(), version:EJS_emulator.ejs_version})));
}
if (process.env.PROBE_STATE) { const saved = await readFile(`.private/multitap/${process.env.PROBE_STATE}.state`); await page.evaluate(data => __bomber.load(new Uint8Array(data)), [...saved]); }
else await runFrames(180);
await shot();
console.log("READY");
for await (const line of createInterface({input:process.stdin})) {
  try {
    const commands = JSON.parse(line);
    for(const c of commands) {
      if(c.load) { const state=await readFile(`.private/multitap/${c.load}.state`); await page.evaluate(data=>__bomber.load(new Uint8Array(data)), [...state]); await runFrames(2); }
      else if(c.restart) { await page.evaluate(()=>__bomber.restart()); await runFrames(180); }
      else if(c.live) { await page.evaluate(()=>EJS_emulator.gameManager.toggleMainLoop(1)); await page.waitForTimeout(c.live*1000); }
      else if(c.js) console.log("DEBUG",await page.evaluate(c.js));
      else if(c.info) console.log("INFO",await page.evaluate(() => {
        const m = EJS_emulator.Module;
        const cfg = EJS_emulator.gameManager.FS.readFile('/home/web_user/.config/retroarch/retroarch.cfg',{encoding:'utf8'});
        return {paused:EJS_emulator.paused, hidden:document.hidden, focused:document.hasFocus(),functions:Object.keys(EJS_emulator.gameManager.functions).filter(k=>/pause|play|speed|run|screen|frame/i.test(k)),keys:Object.keys(m).filter(k=>/asm|wasm|input|Table|Function/.test(k)),asmKeys:m.asm?Object.keys(m.asm):[],simulateName:m._simulate_input.name,config:cfg.split('\n').filter(l=>/input_(max_users|libretro_device|player[1-5]_joypad_index)/.test(l))};
      }));
      else { if(c.button !== undefined) await page.evaluate(c=>__bomber.input(c.player??0,c.button,1),c); await runFrames(c.frames??8); if(c.button !== undefined){await page.evaluate(c=>__bomber.input(c.player??0,c.button,0),c);await runFrames(8);} }
      if(c.save) {await writeFile(`.private/multitap/${c.save}.state`,Buffer.from(await page.evaluate(()=>Array.from(__bomber.save()))));}
    }
    await shot();
  } catch(e) { console.log("PROBE_ERROR",e.message); }
}
await browser.close();
