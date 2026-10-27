import { cp, mkdir } from "node:fs/promises";

await mkdir(".private/multitap", { recursive: true, mode: 0o700 });
await cp("tests/fixtures/battle5.state", ".private/multitap/battle5.state", {
  force: false,
  errorOnExist: true,
});
console.log(
  "Checkpoint de cinco controles preparado em .private/multitap/battle5.state.",
);
