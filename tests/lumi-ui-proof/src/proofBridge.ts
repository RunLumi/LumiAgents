import type { LumiAccountBridge, LumiAccountCommand, LumiAccountResult } from "@zcode/shared";

/** A response the fixture can give without the test settling it: a result, or hold until settled. */
export type AutoResponse = LumiAccountResult | "hold";
export type AutoTable = Record<string, AutoResponse | AutoResponse[]>;

export interface RecordedCall {
  n: number;
  key: string;
  command: LumiAccountCommand;
  state: "pending" | "resolved" | "rejected";
}

interface HeldCall extends RecordedCall {
  resolve: (result: LumiAccountResult) => void;
  reject: (error: Error) => void;
}

/** Everything the runner can observe or drive. Synthetic only: no token, no network, no host. */
export interface ProofController {
  calls: () => RecordedCall[];
  settle: (n: number, result: LumiAccountResult) => void;
  rejectCall: (n: number) => void;
  setAuto: (table: AutoTable) => void;
  externalOpens: string[];
  signedIn: number;
  /** Formats a real message through the real Intl provider at the active locale. */
  t: (id: string, values?: Record<string, string>) => string;
  setWorkspacePath: (path: string) => void;
}

export function commandKey(command: LumiAccountCommand): string {
  return typeof command === "string" ? command : command.action;
}

/**
 * Synthetic `platform.lumiAccount`. Each request is recorded and answered from the auto table, or
 * held as an unresolved promise the runner settles later, which is how late/stale/dropped replies
 * are produced deterministically. It holds no credential and cannot reach a real control plane.
 */
export function createProofBridge(initialAuto: AutoTable): {
  bridge: LumiAccountBridge;
  controller: Omit<ProofController, "t" | "setWorkspacePath" | "externalOpens" | "signedIn">;
} {
  const calls: HeldCall[] = [];
  let auto: AutoTable = { ...initialAuto };

  const nextAuto = (key: string): AutoResponse | undefined => {
    const entry = auto[key];
    if (Array.isArray(entry)) {
      const [head, ...rest] = entry;
      auto = { ...auto, [key]: rest };
      return head;
    }
    return entry;
  };

  const bridge: LumiAccountBridge = {
    request(command) {
      const key = commandKey(command);
      return new Promise<LumiAccountResult>((resolve, reject) => {
        const call: HeldCall = {
          n: calls.length,
          key,
          command: structuredClone(command),
          state: "pending",
          resolve: (result) => {
            call.state = "resolved";
            resolve(result);
          },
          reject: (error) => {
            call.state = "rejected";
            reject(error);
          },
        };
        calls.push(call);
        const response = nextAuto(key);
        if (response && response !== "hold") call.resolve(response);
      });
    },
  };

  return {
    bridge,
    controller: {
      calls: () => calls.map(({ n, key, command, state }) => ({ n, key, command, state })),
      settle: (n, result) => calls[n]?.resolve(result),
      rejectCall: (n) => calls[n]?.reject(new Error("proof_ipc_dropped")),
      setAuto: (table) => {
        auto = { ...auto, ...table };
      },
    },
  };
}
