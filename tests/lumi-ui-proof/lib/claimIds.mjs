import { CREDENTIAL_BEHAVIORS } from "./credentialBehaviors.mjs";
import { ENTRY_BEHAVIORS } from "./entryBehaviors.mjs";
import { KEYBOARD_CLAIM_IDS } from "./keyboard.mjs";
import { STARTUP_BEHAVIORS } from "./startupBehaviors.mjs";
import { STATES } from "./states.mjs";
import { WORKSPACE_BEHAVIORS } from "./workspaceBehaviors.mjs";

export const MOTION_STATE_IDS = ["entry-restoring", "workspace-loading"];

/** Every claim id the runner can execute; the single source for selection checks and coverage checks. */
export const ALL_CLAIM_IDS = [
  ...ENTRY_BEHAVIORS.map((b) => b.id),
  ...WORKSPACE_BEHAVIORS.map((b) => b.id),
  ...CREDENTIAL_BEHAVIORS.map((b) => b.id),
  ...STARTUP_BEHAVIORS.map((b) => b.id),
  ...KEYBOARD_CLAIM_IDS,
  ...MOTION_STATE_IDS.map((id) => `motion.${id}`),
  ...STATES.map((state) => `matrix.${state.id}`),
];
