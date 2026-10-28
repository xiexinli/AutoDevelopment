/**
 * 本地「账号 + 密码」登录（`#72`）。
 *
 * 定位：**本地开发阶段的登录方式**，替代需要飞书开放平台企业主体的扫码登录。
 * 生产环境应改用企业自建应用扫码，或接入你们自己的账号体系 —— 见
 * `reviews/B5-真实上游接入验收记录.md`。
 *
 * 安全约定（不要因为「反正是本地」而放松）：
 *  - 密码**只存 scrypt 加盐哈希**，永不落明文、不进日志；
 *  - 校验用 `timingSafeEqual`；账号不存在时**照样跑一次哈希**，避免用响应时间枚举用户；
 *  - 「账号不存在」与「密码错误」返回**同一个** `UNAUTHENTICATED`，不区分。
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { get, nowIso, run, uid } from "../db/index.ts";
import { ensureUser, type User } from "./auth.ts";

/** 登录模式：`development` = 允许「任意账号 + 开发密码」自助开通（**仅本地**）；其它值 = 关闭 */
export function passwordLoginMode(): "development" | "disabled" {
  return process.env.AD_PASSWORD_LOGIN === "development" ? "development" : "disabled";
}

/** 开发密码（`development` 模式下生效）；**只从环境变量读，不写死在代码里** */
function devPassword(): string {
  return process.env.AD_DEV_PASSWORD ?? "";
}

const SCRYPT_KEYLEN = 64;

/** `scrypt$<saltHex>$<hashHex>` */
export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = String(stored).split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

/** 账号不存在时也走一次等量计算，避免用响应时间判断账号是否存在 */
function burnTime() {
  scryptSync("dummy", "0".repeat(32), SCRYPT_KEYLEN);
}

export interface AccountRow { user_id: string; username: string; password_hash: string }

export function findAccount(username: string): AccountRow | null {
  return get<AccountRow>(
    `SELECT user_id, username, password_hash FROM tbl_account WHERE username = ? COLLATE NOCASE`, username,
  ) ?? null;
}

/** 用户名规则：2~32 位，字母数字加 `_ . - @`（**不允许空格与中文**，避免与展示名混淆） */
export const USERNAME_RE = /^[A-Za-z0-9_.@-]{2,32}$/;

/** 建账号（同时建用户） */
export function createAccount(username: string, password: string, opts: { userId?: string; nickname?: string } = {}): User {
  const userId = opts.userId ?? `u_${username.toLowerCase()}`;
  ensureUser(userId, opts.nickname ?? username);
  const ts = nowIso();
  run(`INSERT INTO tbl_account (account_id, user_id, username, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    uid("acc"), userId, username, hashPassword(password), ts, ts);
  return ensureUser(userId, opts.nickname ?? username);
}

export interface LoginResult { user: User; created: boolean }

/**
 * 账号密码登录。
 * - 账号已存在 → 校验哈希；
 * - 账号不存在 → **仅 `development` 模式**下，密码等于开发密码时自助开通（本地便利）；
 * - 其余一律 `null`（调用方统一回 `UNAUTHENTICATED`）。
 */
export function loginWithPassword(username: string, password: string): LoginResult | null {
  const acc = findAccount(username);
  if (acc) {
    if (!verifyPassword(password, acc.password_hash)) return null;
    const user = get<User>(`SELECT user_id, nickname, avatar_url, role FROM tbl_user WHERE user_id = ?`, acc.user_id);
    if (!user) return null;
    return { user, created: false };
  }
  const dev = devPassword();
  if (passwordLoginMode() === "development" && dev && password === dev) {
    return { user: createAccount(username, password), created: true };
  }
  burnTime();
  return null;
}

/** 启动时播种一个管理员账号（仅 `development`；已存在则跳过）。**幂等。** */
export function seedDevAccount(): void {
  if (passwordLoginMode() !== "development") return;
  const dev = devPassword();
  if (!dev) return;
  const username = process.env.AD_DEV_USERNAME ?? "admin";
  if (findAccount(username)) return;
  // 映射到既有的演示用户，这样本机上已有的项目**立刻可见**（否则新账号什么都看不到）
  createAccount(username, dev, { userId: "ou_dev_user", nickname: "演示用户" });
  console.warn(`[auth] 已播种本地账号「${username}」（development 模式；密码仅存哈希，不落明文）`);
}
