"""Exporta la biblioteca de eSound (solo lectura) a esound_library.json y .csv."""
import csv, json, os, sqlite3, sys

DB = os.path.expanduser("~/.config/eSound Music/sql-data/esound_main.db")
TRACKS_DIR = os.path.expanduser("~/.config/eSound Music/tracks")

SQL = """
select s.id, coalesce(s.display_name, s.name) title,
       group_concat(a.name, ', ') artists,
       -- eSound deja is_main en 0 siempre; usamos el primer artista ligado a la canción
       (select a2.provider_id from song_authors sa2 join authors a2 on a2.id = sa2.artist_id
        where sa2.track_id = s.id and a2.provider_type = 2 order by sa2.rowid limit 1) main_artist_deezer_id,
       r.name album, s.source_id youtube_id, s.provider_id deezer_id, s.isrc,
       s.duration, s.play_count, s.is_saved, s.thumbnail_large_url cover
from songs s
left join song_authors sa on sa.track_id = s.id and sa._status != 'deleted'
left join authors a on a.id = sa.artist_id
left join releases r on r.id = s.album_id
where s._status != 'deleted'
group by s.id
"""


def export(db_path):
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)  # nunca escribe en la BD de eSound
    c.row_factory = sqlite3.Row
    songs = {r["id"]: dict(r) for r in c.execute(SQL)}
    playlists = []
    for p in c.execute("select id, name from collections where type = 1 and _status != 'deleted'"):
        ids = [r[0] for r in c.execute(
            "select track_id from collection_items where playlist_id = ? and track_id is not null "
            "and _status != 'deleted' order by position", (p["id"],))]
        playlists.append({"name": p["name"], "track_ids": [i for i in ids if i in songs]})
    for s in songs.values():
        s["cached_audio"] = os.path.exists(os.path.join(TRACKS_DIR, s["id"] + ".mp4"))
        s["playlists"] = [p["name"] for p in playlists if s["id"] in p["track_ids"]]
    return list(songs.values()), playlists


if __name__ == "__main__":
    songs, playlists = export(sys.argv[1] if len(sys.argv) > 1 else DB)
    assert songs and all(s["title"] for s in songs), "exportación vacía o sin títulos"
    with open("esound_library.json", "w", encoding="utf-8") as f:
        json.dump({"songs": songs, "playlists": playlists}, f, ensure_ascii=False, indent=2)
    with open("esound_library.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[k for k in songs[0] if k != "cover"], extrasaction="ignore")
        w.writeheader()
        for s in songs:
            w.writerow({**s, "playlists": " | ".join(s["playlists"])})
    print(f"{len(songs)} canciones, {sum(s['cached_audio'] for s in songs)} con audio en caché")
    for p in playlists:
        print(f"  {p['name']}: {len(p['track_ids'])}")
