// 相对导入（而非 @/ 别名）让本模块可被 node:test + tsx 直接加载，保证品牌覆盖层有单测覆盖。
import { PRODUCT_NAME } from "../lib/productBrand.js";

/**
 * Lumi Agents 产品名覆盖层（单一集成点）。
 *
 * 上游 locale 文件（en-US / zh-CN）里有 80+ 处把产品名写进文案。逐条改写这些
 * 上游文件会让每次 upstream 同步都产生大量文案冲突，违反「最小化上游改动」。
 * 这里改在唯一的 `formatMessage` 出口做一次受控替换：
 *
 * - 只替换用户可见的独立产品名 token `ZCode`（大小写敏感，因此不碰 `ZCODE_*`
 *   环境变量、`@zcode/*`、`zcode://`、`~/.zcode` 等内部标识）。
 * - 保护 agent / 基础设施品牌（`ZCode Agent`、`ZCode CDN`、`ZCode CLI`），
 *   它们指代运行时而非本产品名，保持上游一致以免破坏协议与文档语义。
 *
 * 新增需要保护的上游术语时，加进 PROTECTED_PHRASES，而不是改 locale 文件。
 */
const PROTECTED_PHRASES = ["ZCode Agent", "ZCode CDN", "ZCode CLI"] as const;

const PRODUCT_NAME_TOKEN = "ZCode";

export function applyLumiBranding(message: string): string {
  if (!message.includes(PRODUCT_NAME_TOKEN)) {
    return message;
  }

  const placeholders = new Map<string, string>();
  let working = message;
  PROTECTED_PHRASES.forEach((phrase, index) => {
    if (!working.includes(phrase)) {
      return;
    }
    const placeholder = `\u0000LUMI_KEEP_${index}\u0000`;
    placeholders.set(placeholder, phrase);
    working = working.replaceAll(phrase, placeholder);
  });

  working = working.replaceAll(PRODUCT_NAME_TOKEN, PRODUCT_NAME);

  for (const [placeholder, phrase] of placeholders) {
    working = working.replaceAll(placeholder, phrase);
  }

  return working;
}
