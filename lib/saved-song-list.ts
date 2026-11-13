import type { Song } from "@/lib/musicbrainz-types";

const STORAGE_KEY = "graphu.demo.songs.v1";
const CHANGE_EVENT = "graphu-song-list-change";
let temporaryList: string | null = null;

export function snapshot() {
  if (temporaryList !== null) return temporaryList;
  try { return window.localStorage.getItem(STORAGE_KEY) || "[]"; }
  catch { return "[]"; }
}

export function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) { temporaryList = null; callback(); }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function readSongs(raw: string): Song[] {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter((song): song is Song => {
      if (!song || typeof song.id !== "string" || !/^[a-f0-9-]{36}$/i.test(song.id)
        || typeof song.title !== "string" || typeof song.artist !== "string"
        || !(song.release === null || typeof song.release === "string")
        || !(song.comment === null || typeof song.comment === "string")
        || !(song.duration === null || (typeof song.duration === "number" && Number.isFinite(song.duration)))
        || seen.has(song.id)) return false;
      seen.add(song.id);
      return true;
    });
  } catch { return []; }
}

export function writeSongs(songs: Song[]) {
  const raw = JSON.stringify(songs);
  let persisted = true;
  try { window.localStorage.setItem(STORAGE_KEY, raw); temporaryList = null; }
  catch { temporaryList = raw; persisted = false; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return persisted;
}
