import Image from "next/image";

const artists = [
  { name: "Radiohead", album: "In Rainbows", song: "Reckoner", cover: "/music/in-rainbows.jpg" },
  { name: "Daft Punk", album: "Discovery", song: "Digital Love", cover: "/music/discovery.jpg" },
];

export function MusicPreview() {
  return (
    <figure className="music-preview" aria-labelledby="preview-title">
      <figcaption className="preview-bar">
        <span id="preview-title">conexiones</span>
        <span>Vista ilustrativa</span>
      </figcaption>
      <div className="music-map">
        <svg className="map-connection" viewBox="0 0 600 30" aria-hidden="true" preserveAspectRatio="none">
          <path d="M 0 20 H 600" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="7 7" />
          <circle cx="12" cy="20" r="7" fill="var(--forest)" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="588" cy="20" r="7" fill="var(--forest)" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="map-example">ejemplo</span>
        {artists.map((artist) => (
          <div className="artist-node" key={artist.name}>
            <Image src={artist.cover} alt={`Portada de ${artist.album}, de ${artist.name}`} width={180} height={180} priority className="album-cover" />
            <span className="artist-name">{artist.name}</span>
            <svg className="song-connection" viewBox="0 0 40 54" aria-hidden="true">
              <path d="M20 0V54" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="20" cy="27" r="7" fill="var(--forest)" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="song-node">{artist.song}</span>
          </div>
        ))}
      </div>
      <div className="preview-footer">Artistas <span>·</span> Canciones <span>·</span> Conexiones inesperadas</div>
    </figure>
  );
}
