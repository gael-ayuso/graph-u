import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Playlist | GraphU",
};

export default function PlaylistDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
