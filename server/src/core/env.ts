/**
 * 极简 `.env` 加载（**零依赖**）：仅补齐**尚未设置**的键，`server/.env` 不存在就跳过。
 * 已存在的环境变量优先级更高，不会被文件覆盖。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = process.env.AD_ENV_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
if (existsSync(file)) {
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
