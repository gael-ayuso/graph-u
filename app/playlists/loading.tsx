import { AppShell } from "@/components/shared/app-shell";
import { LoadingState } from "@/components/shared/status-states";

export default function LoadingPlaylists() {
  return <AppShell title="Playlists" subtitle="Crea, organiza y reordena colecciones con las canciones que descubres en GraphU.">
    <LoadingState variant="playlists" rows={6} message="Cargando tus playlists..." />
  </AppShell>;
}
