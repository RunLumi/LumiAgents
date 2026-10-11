import test from "node:test";
import assert from "node:assert/strict";
import { terminalKindFromSessionPhase } from "./zcodeTaskIndexSyncer.js";

test("managed-run terminal distinguishes stop from successful completion", () => {
  assert.equal(terminalKindFromSessionPhase("completedSuccess"), "turn.completed");
  assert.equal(terminalKindFromSessionPhase("completedInterrupted"), "turn.interrupted");
  assert.equal(terminalKindFromSessionPhase("error"), "turn.failed");
});
