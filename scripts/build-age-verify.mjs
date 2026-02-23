import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const ageVerifyDir = path.join(repoRoot, "age-verification", "frontend");
const outDir = path.join(repoRoot, "frontend-vite", "website-front", "dist-age-verify");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const env = {
  ...process.env,
  VITE_VERIFY_OUT_DIR: outDir,
  VITE_VERIFY_BASE_PATH: process.env.VITE_VERIFY_BASE_PATH || "/age-verify",
};

const result = spawnSync(npmCmd, ["run", "build"], {
  cwd: ageVerifyDir,
  stdio: "inherit",
  env,
});

if (result.status && result.status !== 0) {
  process.exit(result.status);
}
