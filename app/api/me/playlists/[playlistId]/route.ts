import { playlist } from "@/lib/app-queries";
import { deletePlaylistHandler, updatePlaylistHandler } from "@/lib/music-library/playlists";

export const GET = playlist;
export const PATCH = updatePlaylistHandler;
export const DELETE = deletePlaylistHandler;
