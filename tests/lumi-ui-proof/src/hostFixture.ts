import type { IPlatformService } from "@zcode/shared";

export interface HostCall {
  n: number;
  target: string;
  method: string;
  args: unknown[];
  /** First <h1> text when the call was made, so ordering against what the user could see is provable. */
  heading: string;
}

/** Names that would change credentials, provider state or account/workspace ownership if called. */
const WRITE_METHOD =
  /^(save|set|update|delete|clear|remove|write|put|login|logout|start|cancel|handle|connect|refresh|reset|upsert|create|add|apply|bind|enroll|adopt|sign)/i;

/**
 * Subscriptions come in three host shapes: `onX(cb)` returning a cleanup function, `onX()(cb)`
 * returning an event, and `{ dispose() }`. One value satisfies all three and never fires.
 */
function disposer(): any {
  const fn: any = () => disposer();
  fn.dispose = () => undefined;
  return fn;
}

export interface HostFixtureOptions {
  /** `service.method` -> value, or function producing one. Anything else resolves to undefined. */
  overrides?: Record<string, unknown | ((...args: unknown[]) => unknown)>;
}

export interface HostFixture {
  services: any;
  platform: IPlatformService;
  calls: () => HostCall[];
  externalOpens: string[];
}

/**
 * Recording stand-in for the Electron host's service accessor and platform. Every member the real
 * component reaches for is logged (`calls`) so the proof can assert what was and was *not* called.
 * Members default to a promise resolving to undefined; `on*` members return a disposable. It holds no
 * credential and reaches no network. It is a fixture: it proves renderer behaviour only.
 */
export function createHostFixture(
  options: HostFixtureOptions,
  lumiAccount: unknown | undefined,
): HostFixture {
  const calls: HostCall[] = [];
  const externalOpens: string[] = [];
  const overrides = options.overrides ?? {};
  const record = (target: string, method: string, args: unknown[]) =>
    calls.push({
      n: calls.length,
      target,
      method,
      args: structuredCloneSafe(args),
      heading: document.querySelector("h1")?.textContent ?? "",
    });

  const member = (target: string, method: string) => {
    return (...args: unknown[]) => {
      record(target, method, args);
      const key = `${target}.${method}`;
      if (key in overrides) {
        const value = overrides[key];
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown)(...args)
          : Promise.resolve(value);
      }
      if (/^on[A-Z]/.test(method) || /^subscribe/i.test(method)) return disposer();
      return Promise.resolve(undefined);
    };
  };

  // Real code keys WeakMaps on service identity, so each service must be one stable object.
  const serviceCache = new Map<string, unknown>();
  const services = new Proxy(
    {},
    {
      get(_t, name) {
        if (typeof name !== "string" || name === "then") return undefined;
        const cached = serviceCache.get(name);
        if (cached) return cached;
        const created = new Proxy(
          {},
          {
            get(_s, method) {
              if (typeof method !== "string" || method === "then") return undefined;
              return member(name, method);
            },
          },
        );
        serviceCache.set(name, created);
        return created;
      },
    },
  );

  const platform = new Proxy(
    {
      lumiAccount,
      openExternal: async (url: string) => {
        externalOpens.push(url);
        record("platform", "openExternal", [url]);
      },
    } as Record<string, unknown>,
    {
      get(target, name) {
        if (typeof name !== "string" || name === "then") return undefined;
        if (name in target) return target[name];
        if (/^on[A-Z]/.test(name)) return member("platform", name);
        return member("platform", name);
      },
    },
  ) as unknown as IPlatformService;

  return { services, platform, calls: () => calls.slice(), externalOpens };
}

/** Calls whose names read as writes (credential/provider/account/workspace mutation). */
export function writeCalls(calls: HostCall[], ignore: RegExp[] = []): HostCall[] {
  return calls.filter(
    (call) =>
      WRITE_METHOD.test(call.method) &&
      !ignore.some((re) => re.test(`${call.target}.${call.method}`)),
  );
}

function structuredCloneSafe(args: unknown[]): unknown[] {
  try {
    return structuredClone(args);
  } catch {
    return args.map(String);
  }
}
