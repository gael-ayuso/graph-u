"use client";

import React, { useState } from "react";

export interface CoverArtProps {
  src: string | null | undefined;
  alt: string;
  size?: number;
  entityType?: "recording" | "artist";
  label?: string;
  className?: string;
}

function getInitials(label?: string): string {
  const clean = (label || "").trim();
  if (!clean) return "";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function CoverArt({
  src,
  alt,
  size = 48,
  entityType = "recording",
  label,
  className = "",
}: CoverArtProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const normalizedSrc = typeof src === "string" && src.trim() ? src.trim() : null;
  const showImage = Boolean(normalizedSrc && failedSrc !== normalizedSrc);
  const initials = getInitials(label);
  const accent = entityType === "artist" ? "#fe8019" : "#fabd2f";

  return (
    <div
      className={`cover-frame ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={normalizedSrc!}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="cover-frame-img"
          onError={() => setFailedSrc(normalizedSrc)}
        />
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          width={size}
          height={size}
          role="img"
          aria-label={alt}
          className="cover-frame-fallback"
        >
          <rect width="64" height="64" fill="#282828" />
          <rect
            x="4"
            y="4"
            width="56"
            height="56"
            fill="#32302f"
            stroke="#665c54"
            strokeWidth="1"
          />
          {initials ? (
            <>
              <rect x="4" y="4" width="56" height="3" fill={accent} />
              <text
                x="32"
                y="38"
                textAnchor="middle"
                fill="#ebdbb2"
                fontSize="18"
                fontWeight="700"
                fontFamily="monospace"
                letterSpacing="1"
              >
                {initials}
              </text>
            </>
          ) : entityType === "artist" ? (
            <>
              <circle cx="32" cy="26" r="7" fill="none" stroke={accent} strokeWidth="1.6" />
              <path
                d="M19 46c0-6.8 5.8-11 13-11s13 4.2 13 11"
                fill="none"
                stroke={accent}
                strokeWidth="1.6"
              />
            </>
          ) : (
            <>
              <circle cx="32" cy="32" r="13" fill="none" stroke="#665c54" strokeWidth="1.2" />
              <circle cx="32" cy="32" r="6" fill="none" stroke={accent} strokeWidth="1.6" />
              <rect x="30" y="30" width="4" height="4" fill={accent} />
            </>
          )}
        </svg>
      )}
    </div>
  );
}

export interface PlaylistCoverMosaicProps {
  covers?: string[];
  name: string;
  size?: number;
}

export function PlaylistCoverMosaic({
  covers = [],
  name,
  size = 68,
}: PlaylistCoverMosaicProps) {
  const uniqueCovers = covers.filter((url) => typeof url === "string" && url.trim()).slice(0, 4);

  if (uniqueCovers.length <= 1) {
    return (
      <CoverArt
        src={uniqueCovers[0] ?? null}
        alt={`Portada de la playlist ${name}`}
        size={size}
        label={name}
      />
    );
  }

  const tileSize = Math.floor((size - 2) / 2);
  const slots = [0, 1, 2, 3].map((idx) => uniqueCovers[idx] ?? null);

  return (
    <div
      className="cover-mosaic"
      style={{ width: size, height: size }}
      aria-label={`Portadas de la playlist ${name}`}
    >
      {slots.map((url, idx) => (
        <CoverArt
          key={url ? `${url}:${idx}` : `empty:${idx}`}
          src={url}
          alt={url ? `Portada ${idx + 1} de ${name}` : `Espacio vacío de ${name}`}
          size={tileSize}
          className="cover-mosaic-tile"
        />
      ))}
    </div>
  );
}
