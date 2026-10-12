import { describe, expect, it } from "vitest";
import { createComputerUseRuntime } from "@zcode/zcode-cua";

// DE2E-CLI-02: computer use is NOT_APPLICABLE on this product build. The node_repl host builds its
// Computer Use runtime from this package (node-repl-host/src/server.ts), and the package shipped
// here is the fail-closed placeholder: every action reports "unavailable" and touches nothing.
describe("Computer Use runtime on this build", () => {
  it("every action is refused by the placeholder runtime", async () => {
    const runtime = createComputerUseRuntime({ brokerSocketPath: "/nonexistent" } as never);
    const result = (await runtime.execute({} as never)) as {
      isError: boolean;
      content: { type: string; text: string }[];
    };
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Computer Use is not available in this build." }],
    });
    await runtime.dispose();
  });
});
