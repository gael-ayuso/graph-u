import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSync } from "@/components/profile-sync";

const { useAuth, useEffect } = vi.hoisted(() => ({
  useAuth: vi.fn(), useEffect: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({ useAuth }));
vi.mock("react", () => ({ useEffect }));

function mount() {
  ProfileSync();
  return useEffect.mock.calls[0][0]() as (() => void) | undefined;
}

describe("automatic profile synchronization", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    useAuth.mockReturnValue({ isLoaded: true, userId: "user_existing", sessionId: "session_1" });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("synchronizes an already active session without requiring a new login", async () => {
    const cleanup = mount();
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/me", expect.objectContaining({
      credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal),
    }));
    cleanup?.();
  });

  it.each([
    { isLoaded: false, userId: undefined },
    { isLoaded: true, userId: null },
  ])("does not synchronize before authentication: %j", (auth) => {
    useAuth.mockReturnValue(auth);
    mount();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries temporary failures and stops after recovery", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const cleanup = mount();
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    cleanup?.();
  });

  it("stops retries and aborts the request on sign-out or unmount", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const cleanup = mount();
    await Promise.resolve();
    cleanup?.();
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does not retry an unauthorized session", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const cleanup = mount();
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanup?.();
  });
});
