import { favoriteRecordings } from "@/lib/app-queries";
export { removeSavedRecording as DELETE } from "@/lib/recommendation-actions";

export const GET = favoriteRecordings;
