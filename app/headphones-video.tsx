"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const poster = "/ascii/recorrido-headphones-poster.png";

export default function HeadphonesVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      if (preference.matches) {
        video.pause();
        video.currentTime = 0;
      } else {
        void video.play().catch(() => {});
      }
    };
    syncMotion();
    preference.addEventListener("change", syncMotion);
    return () => {
      preference.removeEventListener("change", syncMotion);
      video.pause();
    };
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }

  return (
    <div className={styles.heroStage}>
      <div className={styles.heroVisual} aria-hidden="true">
        <div className={styles.headphonesCanvas}>
          {failed ? (
            <Image src={poster} alt="" width={512} height={512} className={styles.headphonesImage} unoptimized />
          ) : (
            <video
              ref={videoRef}
              id="headphones-rotation"
              className={styles.headphonesImage}
              src="/ascii/recorrido-headphones-rotation.mp4"
              poster={poster}
              width={512}
              height={512}
              muted
              loop
              playsInline
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setFailed(true)}
            />
          )}
        </div>
        <p className={styles.visualCaption}>De lo que escuchas<br /><span>a lo que está por descubrir.</span></p>
      </div>
      {!failed && (
        <button
          type="button"
          className={styles.motionButton}
          aria-controls="headphones-rotation"
          aria-label={playing ? "Pausar rotación de auriculares" : "Reanudar rotación de auriculares"}
          onClick={togglePlayback}
        >
          <span aria-hidden="true">{playing ? "[ II ]" : "[ > ]"}</span> {playing ? "Pausar" : "Reanudar"}
        </button>
      )}
    </div>
  );
}
