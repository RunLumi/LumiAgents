/**
 * Lumi P05 托管策略的窄入口：只导出 Browser/Computer Use 策略判定所需的模块。
 *
 * node_repl 宿主（apps/zcode-cli/packages/node-repl-host）有 bundle 边界守卫，不能经
 * `@zcode/shared` 根入口带入整个共享包；它从这里取 P05 策略，闭包只含下列三个模块。
 */
export * from "./p05-browser-computer-policy.js";
export * from "./managed-policy-authorization.js";
export * from "./managed-policy-fingerprint.js";
