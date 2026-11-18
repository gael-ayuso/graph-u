import { playlists } from "@/lib/app-queries";
import { createPlaylistHandler } from "@/lib/music-library/playlists";

export const GET = playlists;
export const POST = createPlaylistHandler;
