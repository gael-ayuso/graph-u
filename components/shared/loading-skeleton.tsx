import React from "react";
import styles from "./loading-skeleton.module.css";

export type SkeletonVariant = "songs" | "favorites" | "playlists" | "profile" | "playlist-detail" | "graph";

/** Decorative only: the containing loading state supplies the accessible message. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`${styles.block} ${className}`} />;
}

function SongRows({ rows }: { rows: number }) {
  return <div className={styles.rows}>
    {Array.from({ length: rows }, (_, index) => <div className={styles.row} key={index}>
      <Skeleton className={styles.cover} />
      <div className={styles.text}>
        <Skeleton className={index % 2 ? styles.medium : styles.long} />
        <Skeleton className={styles.short} />
      </div>
      <Skeleton className={styles.action} />
    </div>)}
  </div>;
}

export function LoadingSkeleton({ variant = "songs", rows = 4 }: { variant?: SkeletonVariant; rows?: number }) {
  return <div aria-hidden="true" className={styles.content} data-skeleton={variant}>
    {variant === "favorites" && <div className={styles.toolbar}>
      <div className={styles.actions}><Skeleton className={styles.tab} /><Skeleton className={styles.tab} /></div>
      <Skeleton className={styles.filter} />
    </div>}
    {variant === "playlist-detail" && <div className={styles.toolbar}>
      <Skeleton className={styles.medium} />
      <div className={styles.actions}><Skeleton className={styles.action} /><Skeleton className={styles.action} /></div>
    </div>}
    {variant === "profile" ? <div className={styles.profileGrid}>
      {[0, 1].map((column) => <div key={column} className={styles.profilePanel}>
        <div className={styles.panelHeading}><Skeleton className={styles.long} /></div>
        {[0, 1, 2, 3].map((field) => <div key={field} className={styles.field}>
          <Skeleton className={styles.short} /><Skeleton className={styles.input} />
        </div>)}
        <Skeleton className={styles.submit} />
      </div>)}
    </div> : variant === "playlists" ? <div className={styles.playlistGrid}>
      {Array.from({ length: rows }, (_, index) => <div key={index} className={styles.playlistCard}>
        <div className={styles.cardHeading}><Skeleton className={styles.playlistCover} />
          <div className={styles.text}><Skeleton className={styles.short} /><Skeleton className={styles.long} /><Skeleton className={styles.medium} /></div>
        </div>
        <div className={styles.cardFooter}><Skeleton className={styles.action} /><Skeleton className={styles.action} /></div>
      </div>)}
    </div> : variant === "graph" ? <div className={styles.graphFrame}>
      <div className={styles.graphNodes}>
        {[0, 1, 2, 3, 4, 5].map((node) => <Skeleton key={node} className={styles.graphNode} />)}
      </div>
    </div> : <SongRows rows={rows} />}
  </div>;
}
