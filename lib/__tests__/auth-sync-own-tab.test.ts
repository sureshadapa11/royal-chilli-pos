import { announceAuthChange, freshStart, isFromAnotherTab, onAuthChange } from "@/lib/auth-sync";

const tick = () => new Promise((r) => setTimeout(r, 20));
const replace = jest.fn();
// The tests run outside a browser: a stand-in for the bits of window used.
(globalThis as unknown as { window: unknown }).window = { location: { replace }, addEventListener: () => {}, removeEventListener: () => {} };

describe("a tab never reloads itself on its own sign-in", () => {
  it("ignores its own message, acts on another tab's", async () => {
    const heard: string[] = [];
    const stop = onAuthChange((area) => heard.push(area));

    announceAuthChange("staff");                   // this tab signed in
    await tick();
    expect(heard).toEqual([]);

    const other = new BroadcastChannel("rc-auth");  // another tab signed in
    other.postMessage({ area: "customer", at: Date.now(), from: "another-tab" });
    await tick();
    expect(heard).toEqual(["customer"]);
    other.close();
    stop();
  });

  it("once leaving for the next page, nothing reloads it", async () => {
    const heard: string[] = [];
    const stop = onAuthChange((area) => heard.push(area));
    freshStart("/staff");
    expect(replace).toHaveBeenCalledWith("/staff");
    const other = new BroadcastChannel("rc-auth");
    other.postMessage({ area: "staff", at: Date.now(), from: "another-tab" });
    await tick();
    expect(heard).toEqual([]);
    expect(isFromAnotherTab({ from: "another-tab" })).toBe(false);
    other.close();
    stop();
  });
});
