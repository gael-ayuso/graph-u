import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSongs, snapshot, subscribe, writeSongs } from "@/lib/saved-song-list";
import {
  createMemoryStorage,
  createWindowEventMock,
} from "./helpers/recommendation-library-harness";
import { makeSong } from "./fixtures/recommendation-exploration";

const STORAGE_KEY = "graphu.demo.songs.v1";
const CHANGE_EVENT = "graphu-song-list-change";

describe("T3 saved-song-list storage contract", () => {
  let memoryStorage: ReturnType<typeof createMemoryStorage>;
  let windowMock: ReturnType<typeof createWindowEventMock>;
  let dispatchedEvents: string[];

  beforeEach(() => {
    memoryStorage = createMemoryStorage();
    windowMock = createWindowEventMock();
    dispatchedEvents = [];
    const windowObj = Object.assign(windowMock.window, {
      localStorage: memoryStorage.storage,
      dispatchEvent(event: { type: string }) {
        dispatchedEvents.push(event.type);
        return true;
      },
    });
    vi.stubGlobal("window", windowObj);
    vi.stubGlobal("Event", class FakeEvent {
      constructor(public type: string) {}
    });
  });

  afterEach(() => {
    // Reset module-level temporaryList via a successful write + delete.
    writeSongs([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads, validates, and deduplicates saved songs while preserving key and change event", () => {
    const songA = makeSong(1, { comment: "remaster" });
    const songB = makeSong(2, { release: null, duration: null });

    expect(snapshot()).toBe("[]");
    expect(writeSongs([songA, songB])).toBe(true);
    expect(dispatchedEvents).toEqual([CHANGE_EVENT]);
    expect(memoryStorage.store.get(STORAGE_KEY)).toBe(JSON.stringify([songA, songB]));
    expect(readSongs(snapshot())).toEqual([songA, songB]);

    // Invalid entries, bad UUIDs, non-finite durations, and duplicate IDs are filtered out.
    const parsed = readSongs(
      JSON.stringify([
        songA,
        songA,
        { ...songB, id: "bad-id" },
        { ...songB, duration: Number.NaN },
        { ...songB, release: 123 },
        null,
        songB,
      ]),
    );
    expect(parsed).toEqual([songA, songB]);
    expect(readSongs("not-json")).toEqual([]);
    expect(readSongs("{}")).toEqual([]);
  });

  it("falls back to temporary in-memory list when localStorage throws and reacts to storage events", () => {
    const songA = makeSong(1);
    const songB = makeSong(2);

    Object.assign(window, {
      localStorage: {
        ...memoryStorage.storage,
        getItem() {
          throw new Error("SecurityError");
        },
        setItem() {
          throw new Error("QuotaExceededError");
        },
      },
    });

    expect(snapshot()).toBe("[]");
    expect(writeSongs([songA])).toBe(false);
    expect(dispatchedEvents).toEqual([CHANGE_EVENT]);
    expect(readSongs(snapshot())).toEqual([songA]);

    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    expect(windowMock.listenerCount("storage")).toBe(1);
    expect(windowMock.listenerCount(CHANGE_EVENT)).toBe(1);

    // Unrelated storage key does not clear temporaryList or notify listener.
    windowMock.window.dispatchStorageEvent("other.key");
    expect(listener).not.toHaveBeenCalled();
    expect(readSongs(snapshot())).toEqual([songA]);

    // Restoring localStorage + matching storage event clears temporaryList and reloads storage.
    memoryStorage.store.set(STORAGE_KEY, JSON.stringify([songB]));
    Object.assign(window, { localStorage: memoryStorage.storage });
    windowMock.window.dispatchStorageEvent(STORAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readSongs(snapshot())).toEqual([songB]);

    // key === null (storage.clear) also resets and notifies.
    memoryStorage.store.delete(STORAGE_KEY);
    windowMock.window.dispatchStorageEvent(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readSongs(snapshot())).toEqual([]);

    unsubscribe();
    expect(windowMock.listenerCount("storage")).toBe(0);
    expect(windowMock.listenerCount(CHANGE_EVENT)).toBe(0);
  });
});
