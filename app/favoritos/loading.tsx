import { AppShell } from "@/components/shared/app-shell";
import { LoadingState } from "@/components/shared/status-states";

export default function LoadingFavorites() {
  return <AppShell title="Favoritos" subtitle="Canciones y artistas guardados en tu cuenta.">
    <LoadingState variant="favorites" message="Cargando biblioteca de favoritos..." />
  </AppShell>;
}
