import { LoadingState } from "@/components/shared/status-states";
import { AppShell } from "@/components/shared/app-shell";

export default function LoadingPlaylistDetail() {
  return <AppShell title="Cargando playlist..." subtitle="Obteniendo canciones de la lista.">
    <LoadingState variant="playlist-detail" message="Cargando detalle de playlist..." />
  </AppShell>;
}
