import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Perfil y preferencias | GraphU",
};

export default function PerfilLayout({ children }: { children: ReactNode }) {
  return children;
}
