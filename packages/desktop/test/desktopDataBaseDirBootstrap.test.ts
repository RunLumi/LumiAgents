// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
import { describe, expect, it } from "vitest";
import { getBootstrapSettingsFile } from "@zcode/services/node";
import { extractBootstrapDataBaseDir } from "../src/main/desktopDataBaseDirBootstrap.js";

describe("desktopDataBaseDirBootstrap", () => {
  it("应从 bootstrap setting 中提取并裁剪 dataBaseDir", () => {
    expect(
      extractBootstrapDataBaseDir({
        dataBaseDir: "  /tmp/zcode-data  ",
      }),
    ).toBe("/tmp/zcode-data");
  });

  it("应忽略无效的 bootstrap 配置", () => {
    expect(extractBootstrapDataBaseDir(null)).toBeNull();
    expect(extractBootstrapDataBaseDir({ dataBaseDir: "" })).toBeNull();
    expect(extractBootstrapDataBaseDir({ dataBaseDir: 123 })).toBeNull();
  });

  it("应拼出默认 bootstrap setting 路径", () => {
    // Lumi：bootstrap setting 路径统一走 services 的 getBootstrapSettingsFile 边界（见 spec 04）。
    const result = getBootstrapSettingsFile({ HOME: "/Users/tester" });
    // Windows 下 path.join 使用反斜杠，统一为正斜杠后再比较
    expect(result.replace(/\\/g, "/")).toBe("/Users/tester/.zcode/v2/setting.json");
  });
});
