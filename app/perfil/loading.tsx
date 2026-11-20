import { AppShell } from "@/components/shared/app-shell";
import { LoadingState } from "@/components/shared/status-states";

export default function LoadingProfile() {
  return <AppShell title="Perfil y preferencias" subtitle="Administra tu identidad en GraphU y ajusta cómo se generan tus recomendaciones.">
    <LoadingState variant="profile" message="Cargando configuración de cuenta..." />
  </AppShell>;
}
