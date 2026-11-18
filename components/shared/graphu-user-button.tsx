"use client";

import { UserButton } from "@clerk/nextjs";

function ProfileIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.75 13.75c.6-2.5 2.65-3.75 5.25-3.75s4.65 1.25 5.25 3.75" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 13.5S2.25 9.75 2.25 5.65A3.15 3.15 0 0 1 8 3.8a3.15 3.15 0 0 1 5.75 1.85C13.75 9.75 8 13.5 8 13.5Z" />
    </svg>
  );
}

function PlaylistIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.75" />
      <circle cx="12.5" cy="4" r="1.75" />
      <circle cx="12.5" cy="12" r="1.75" />
      <path d="M5.1 7.3 10.9 4.7M5.1 8.7l5.8 2.6" />
    </svg>
  );
}

export function GraphUUserButton() {
  return (
    <UserButton
      appearance={{
        elements: {
          rootBox: "graphu-user-root",
          userButtonBox: "graphu-user-box",
          userButtonTrigger: "graphu-user-trigger",
          avatarBox: "graphu-user-avatar",
          userButtonPopoverCard: "graphu-user-popover",
          userButtonPopoverActionButton: "graphu-user-action",
        },
      }}
    >
      <UserButton.MenuItems>
        <UserButton.Link label="Mi perfil" labelIcon={<ProfileIcon />} href="/perfil" />
        <UserButton.Link label="Explorar grafo" labelIcon={<GraphIcon />} href="/explorar" />
        <UserButton.Link label="Favoritos" labelIcon={<HeartIcon />} href="/favoritos" />
        <UserButton.Link label="Playlists" labelIcon={<PlaylistIcon />} href="/playlists" />
      </UserButton.MenuItems>
    </UserButton>
  );
}
