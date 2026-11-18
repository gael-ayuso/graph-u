"""Independent edge-case and adversarial tests for bounded fuzzy song search."""

import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.music_search import (
    RESULT_LIMIT,
    can_fuzz,
    field_score,
    fuzzy_query,
    rank_candidates,
    words,
)

from app import musicbrainz as mb
from app import musicbrainz_db as db


def _song(song_id: str, title: str, artist: str) -> dict:
    return {
        "id": song_id,
        "title": title,
        "artist": artist,
        "release": None,
        "duration": 240000,
        "comment": None,
    }


def _row(song_id: str, title: str, artist: str, release: str | None = None) -> tuple:
    return (UUID(song_id), title, artist, release, 240000, None)


# --- Unicode normalization, contractions & strict short words ---


@pytest.mark.parametrize(
    ("query", "candidate"),
    [
        ("\ufb01nally", "Finally"),                                              # ligature fi -> fi
        ("Stra\u00dfe", "Strasse"),                                              # casefold eszett -> ss
        ("\uff32\uff41\uff44\uff49\uff4f\uff48\uff45\uff41\uff44", "Radiohead"), # fullwidth
        ("Cafe\u0301", "Caf\u00e9"),                                             # NFD combining mark vs NFC
        ("rock'n'roll", "Rocknroll"),                                            # chained apostrophes
        ("rock\u2019n\u02bcroll", "Rocknroll"),                                  # curly + modifier apostrophes
    ],
)
def test_nfkc_casefold_and_contraction_equivalences(query, candidate):
    assert field_score(query, candidate) == 1.0


def test_short_words_and_contractions_stay_strict():
    assert field_score("\u00c9t\u00e9", "Ete") == 0.0
    assert field_score("U2", "U20") == 0.0
    assert field_score("abc", "abcd") == 0.0
    assert field_score("It's", "Its") == 1.0
    assert field_score("It's", "Itz") == 0.0
    # A 4-char query has edit budget 1, so deleting one char to match a 3-char word is allowed.
    assert field_score("abcd", "abc") == pytest.approx(0.75)


def test_long_accented_word_allows_single_edit():
    assert field_score("Cafeine", "Caf\u00e9ine") > 0.0


# --- OSA edit distance boundaries (4-7 -> budget 1, >=8 -> budget 2) ---


@pytest.mark.parametrize(
    ("query", "candidate", "expected_positive"),
    [
        ("abcd", "abxd", True),       # len 4: 1 substitution
        ("abcd", "abcde", True),      # len 4: 1 insertion
        ("abcd", "acbd", True),       # len 4: 1 adjacent transposition
        ("abcd", "abxy", False),      # len 4: 2 substitutions
        ("abcd", "abcdef", False),    # len 4: 2 insertions
        ("abcdefg", "abxdefg", True),   # len 7: 1 edit
        ("abcdefg", "abxdyfg", False),  # len 7: 2 edits
        ("abcdefgh", "abxdyfgh", True),   # len 8: 2 substitutions
        ("abcdefgh", "abcdefghij", True), # len 8: 2 insertions
        ("abcdefgh", "abcdef", True),     # len 8: 2 deletions
        ("abcdefgh", "badcefgh", True),   # len 8: 2 disjoint transpositions
        ("abcdefgh", "bacdefgx", True),   # len 8: 1 transposition (ab->ba) + 1 substitution (h->x)
        ("abcdefgh", "xyzdefgh", False),  # len 8: 3 substitutions
        ("abcdefgh", "abcdefghijk", False),  # len 8: 3 insertions
        # OSA forbids editing a substring twice: "ca" -> "abc" costs 3, not 2.
        ("caaaaaaa", "abcaaaaa", False),
    ],
)
def test_osa_distance_budgets_and_boundaries(query, candidate, expected_positive):
    score = field_score(query, candidate)
    if expected_positive:
        assert score > 0.0
    else:
        assert score == 0.0


# --- Ordered word alignment without reuse ---


def test_ordered_alignment_rejects_reversed_words_and_word_reuse():
    assert field_score("stop dont", "Don't Stop") == 0.0
    assert field_score("spirit teen", "Smells Like Teen Spirit") == 0.0
    assert field_score("hello hello", "Hello World") == 0.0
    assert field_score("hello hello", "Hello Big Hello") > 0.0


def test_alignment_prefers_exact_over_greedy_prefix_and_penalizes_extra_words():
    optimal_with_extra = field_score("love song", "Loves Love Song")
    expected_equal = field_score("love song", "Love X Song")
    tight = field_score("love song", "Love Song")
    loose = field_score("love song", "Smells Like Love Song Live")

    assert optimal_with_extra == pytest.approx(expected_equal)
    assert tight > loose > 0.0


def test_field_score_whitespace_vs_punctuation_only():
    assert field_score("", "Reckoner") == 1.0
    assert field_score("   ", "Reckoner") == 1.0
    assert field_score("---", "Reckoner") == 0.0
    assert field_score("Reckoner", "---") == 0.0


# --- Dual-field ranking ---


def test_rank_candidates_prioritizes_min_field_score_then_average_then_id():
    query_title, query_artist = "abcdefgh", "ijklmnop"
    # balanced: title=7/8 (0.875), artist=7/8 (0.875) -> min=0.875, avg=0.875
    balanced = _song("id-balanced", "abcdefgi", "ijklmnoq")
    # lopsided: title=1.0, artist=7/9 (~0.778) -> min=~0.778, avg=~0.889 (higher avg, lower min)
    lopsided = _song("id-lopsided", "abcdefgh", "ijklmnoqq")
    # strong_avg: title=1.0, artist=7/8 (0.875) -> min=0.875, avg=0.9375 (tied min, higher avg)
    strong_avg = _song("id-strong", "abcdefgh", "ijklmnoq")
    # tie_a / tie_b: identical scores -> deterministic sort by id
    tie_a = _song("id-a", "abcdefgi", "ijklmnoq")
    tie_b = _song("id-b", "abcdefgi", "ijklmnoq")

    ranked = rank_candidates([lopsided, tie_b, balanced, strong_avg, tie_a], query_title, query_artist)
    assert [s["id"] for s in ranked] == ["id-strong", "id-a", "id-b", "id-balanced", "id-lopsided"]


def test_rank_candidates_orders_exact_above_single_typo_and_handles_empty_query():
    exact = _song("1", "Reckoner", "Radiohead")
    one_typo = _song("2", "Reckonre", "Radiohead")
    two_fields_typo = _song("3", "Reckonre", "Radiohaed")

    assert [s["id"] for s in rank_candidates([two_fields_typo, one_typo, exact], "Reckoner", "Radiohead")] == [
        "1",
        "2",
        "3",
    ]
    assert rank_candidates([exact], "", "") == []


# --- Safe Lucene queries ---


def test_fuzzy_query_neutralizes_lucene_operators_and_field_injections():
    q = fuzzy_query('AND OR NOT TO artist:hack [a TO z] && || ! ^2 -bad +req?', "AC/DC")
    assert q == (
        'recording:("and" AND "or" AND "not" AND "to" AND artist~ AND hack~ AND "a" AND "to" AND "z" AND "2" AND "bad" AND "req") '
        'AND artist:("ac" AND "dc")'
    )
    assert words("\ufb01nally Stra\u00dfe") == ["finally", "strasse"]
    assert fuzzy_query("\ufb01nally", "Stra\u00dfe") == "recording:(finally~) AND artist:(strasse~)"


def test_fuzzy_query_rejects_empty_or_unsearchable_supplied_fields_and_mixed_lengths():
    assert fuzzy_query("Reckoner", "***") == ""
    assert fuzzy_query("Reckoner", "   ") == ""
    assert fuzzy_query("   ", "Radiohead") == ""
    assert fuzzy_query("", "") == ""
    assert can_fuzz("Reckoner", "U2") is True
    assert fuzzy_query("Reckoner", "U2") == 'recording:(reckoner~) AND artist:("u2")'


# --- Public API (_search_api) ---


def test_public_skips_fuzzy_when_artist_has_no_words(monkeypatch):
    calls = []
    monkeypatch.setattr(mb, "_get", lambda path, **params: calls.append(params) or {"recordings": []})
    assert mb._search_api("Rekoner", "***") == []
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("title", "artist", "expected_exact", "expected_fuzzy"),
    [
        ("Rekoner", "", 'recording:"Rekoner"', "recording:(rekoner~)"),
        ("", "Radiohed", 'artist:"Radiohed"', "artist:(radiohed~)"),
    ],
)
def test_public_single_field_fuzzy_query(monkeypatch, title, artist, expected_exact, expected_fuzzy):
    calls = []
    rec = {"id": "id-1", "title": "Reckoner", "artist-credit": [{"name": "Radiohead"}]}

    def fake_get(path, **params):
        calls.append(params)
        return {"recordings": [] if len(calls) == 1 else [rec]}

    monkeypatch.setattr(mb, "_get", fake_get)
    songs = mb._search_api(title, artist)
    assert [s["id"] for s in songs] == ["id-1"]
    assert calls == [
        {"query": expected_exact, "limit": 20},
        {"query": expected_fuzzy, "limit": 100},
    ]


def test_public_fuzzy_rejects_all_bad_candidates_without_retry_and_caps_at_20(monkeypatch):
    calls = []

    def fake_get_all_bad(path, **params):
        calls.append(params)
        if len(calls) == 1:
            return {"recordings": []}
        return {
            "recordings": [
                {"id": "rev", "title": "Android Paranoid", "artist-credit": [{"name": "Radiohead"}]},
                {"id": "short", "title": "Do On", "artist-credit": [{"name": "Radiohead"}]},
                {"id": "far", "title": "Paranoia", "artist-credit": [{"name": "Radiohead"}]},
            ]
        }

    monkeypatch.setattr(mb, "_get", fake_get_all_bad)
    assert mb._search_api("Paranoid Android", "Radiohead") == []
    assert len(calls) == 2

    calls.clear()
    many = [
        {"id": f"id-{i:02d}", "title": "Reckoner", "artist-credit": [{"name": "Radiohead"}]}
        for i in range(25)
    ]
    best = {"id": "00-best", "title": "Reckoner", "artist-credit": [{"name": "Radiohead"}]}

    def fake_get_many(path, **params):
        calls.append(params)
        if len(calls) == 1:
            return {"recordings": []}
        return {"recordings": [*many, best]}

    monkeypatch.setattr(mb, "_get", fake_get_many)
    results = mb._search_api("Reckoner", "Radiohed")
    assert len(results) == RESULT_LIMIT == 20
    assert results[0]["id"] == "00-best"
    assert len(calls) == 2


# --- Local DB (musicbrainz_db.search & fuzzy helpers) ---


class FakeConnection:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []
        self.transaction_depth = 0
        self.closed = False

    @contextmanager
    def cursor(self):
        yield self

    @contextmanager
    def transaction(self):
        self.transaction_depth += 1
        try:
            yield
        finally:
            self.transaction_depth -= 1

    def execute(self, sql, params=None):
        self.calls.append((sql, params, self.transaction_depth))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        self.response = response

    def fetchall(self):
        return self.response

    def fetchone(self):
        return self.response[0]


@pytest.fixture
def fake_db(monkeypatch):
    monkeypatch.setattr(db._thread_local, "fuzzy_capabilities", {}, raising=False)

    def bind(responses):
        conn = FakeConnection(responses)
        monkeypatch.setattr(db, "_connection", lambda dsn: conn)
        return conn

    return bind


def test_local_empty_title_and_artist_makes_no_db_calls(monkeypatch):
    def fail_connect(dsn):
        raise AssertionError("Should not connect on empty search")

    monkeypatch.setattr(db, "_connection", fail_connect)
    assert db.search("local", "", "") == []


def test_local_capability_cache_respects_ttl_key_and_reset(fake_db, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(db.time, "monotonic", lambda: now[0])

    # 1st search (title+artist): exact=[], capability=False -> cached for 15s
    # 2nd search (title+artist, t=110): exact=[] -> hits cache (no capability SQL!)
    # 3rd search (title only, t=110): different index tuple -> queries capability SQL
    # 4th search (title+artist, t=116): TTL expired -> re-queries capability SQL -> now True!
    sid = "d9b46ecb-5472-4dcd-8fa4-dd6723189e27"
    cand = _row(sid, "Reckoner", "Radiohead")
    enriched = _row(sid, "Reckoner", "Radiohead", "In Rainbows")
    conn = fake_db([
        [], [(False,)],                                         # search 1: exact + cap check
        [],                                                     # search 2: exact only (cached False)
        [], [(False,)],                                         # search 3: title-only cap check
        [], [(True,)], [("0.3",)], [(1, "Radiohead")], [cand], [enriched],  # search 4: TTL expired -> fuzzy runs
    ])

    assert db.search("local", "Rekoner", "Radiohed") == []
    assert len(conn.calls) == 2

    assert db.search("local", "Rekoner", "Radiohed") == []
    assert len(conn.calls) == 3  # only exact query executed

    assert db.search("local", "Rekoner", "") == []
    assert len(conn.calls) == 5  # exact + new capability key check
    assert conn.calls[4][1] == (["musicbrainz.graphu_recording_name_trgm"],)

    now[0] = 116.0
    songs = db.search("local", "Rekoner", "Radiohed")
    assert len(songs) == 1
    assert songs[0]["release"] == "In Rainbows"

    # reset_connection clears capability cache
    assert db._thread_local.fuzzy_capabilities
    db.reset_connection()
    assert db._thread_local.fuzzy_capabilities == {}


def test_local_skips_capability_check_when_one_field_has_no_words(fake_db):
    conn = fake_db([[]])
    assert db.search("local", "Rekoner", "***") == []
    assert len(conn.calls) == 1


def test_local_fuzzy_mixed_short_artist_and_long_title_with_set_config_local(fake_db):
    sid = "d9b46ecb-5472-4dcd-8fa4-dd6723189e27"
    cand = _row(sid, "Reckoner", "U2")
    enriched = _row(sid, "Reckoner", "U2", "Single")
    # U20 is filtered out by _fuzzy_artist_ids (field_score("U2", "U20") == 0)
    conn = fake_db([[], [(True,)], [("0.3",)], [(10, "U20"), (11, "U2")], [cand], [enriched]])

    songs = db.search("local", "Rekoner", "U2")
    assert len(songs) == 1

    set_sql, set_params, set_depth = conn.calls[2]
    artist_sql, artist_params, artist_depth = conn.calls[3]
    rec_sql, rec_params, rec_depth = conn.calls[4]
    assert "set_config('pg_trgm.word_similarity_threshold', %s, true)" in set_sql
    assert set_params == ("0.3",)
    assert set_depth == artist_depth == rec_depth == 1
    assert "plainto_tsquery('musicbrainz.mb_simple', musicbrainz.mb_lower(%(artist)s))" in artist_sql
    assert artist_params == {"artist": "U2", "limit": 400}
    assert "OPERATOR(public.<%%)" in rec_sql
    assert "r.artist_credit = ANY(%(artist_ids)s::integer[])" in rec_sql
    assert rec_params["artist_ids"] == [11]


def test_local_fuzzy_short_circuits_before_recording_query_when_no_artist_credit_passes(fake_db):
    conn = fake_db([[], [(True,)], [("0.3",)], [(1, "Coldplay"), (2, "RadioheadXYZ")]])

    assert db.search("local", "Reckoner", "Radiohed") == []
    # exact, capability check, set_config, artist_credit query ONLY (never touches recording!)
    assert len(conn.calls) == 4
    assert conn.transaction_depth == 0


def test_local_fuzzy_title_only_skips_artist_credit_lookup(fake_db):
    sid = "d9b46ecb-5472-4dcd-8fa4-dd6723189e27"
    cand = _row(sid, "Reckoner", "Radiohead")
    enriched = _row(sid, "Reckoner", "Radiohead", "In Rainbows")
    conn = fake_db([[], [(True,)], [("0.3",)], [cand], [enriched]])

    songs = db.search("local", "Rekoner", "")
    assert len(songs) == 1
    assert "artist_ids" not in conn.calls[3][1]
    assert conn.calls[3][2] == 1
    assert conn.calls[4][2] == 0


def test_local_fuzzy_skips_enrichment_when_all_candidates_rejected(fake_db):
    wrong_order = _row("00000000-0000-0000-0000-000000000001", "Android Paranoid", "Radiohead")
    conn = fake_db([[], [(True,)], [("0.3",)], [(1, "Radiohead")], [wrong_order]])

    assert db.search("local", "Paranoid Android", "Radiohed") == []
    assert len(conn.calls) == 5  # no enrichment query


def test_local_fuzzy_enrichment_preserves_python_ranking_order(fake_db):
    id_best = "00000000-0000-0000-0000-000000000002"
    id_typo = "00000000-0000-0000-0000-000000000001"
    id_vanished = "00000000-0000-0000-0000-000000000003"

    cand_typo = _row(id_typo, "Reckonre", "Radiohead")
    cand_best = _row(id_best, "Reckoner", "Radiohead")
    cand_vanished = _row(id_vanished, "Reckoner", "Radiohead")
    # Enrichment returns rows in reverse order and omits id_vanished
    enr_typo = _row(id_typo, "Reckonre", "Radiohead", "Album Typo")
    enr_best = _row(id_best, "Reckoner", "Radiohead", "In Rainbows")

    conn = fake_db([
        [],
        [(True,)],
        [("0.3",)],
        [(1, "Radiohead")],
        [cand_typo, cand_vanished, cand_best],
        [enr_typo, enr_best],
    ])

    songs = db.search("local", "Reckoner", "Radiohed")
    assert [s["id"] for s in songs] == [id_best, id_typo]
    assert [s["release"] for s in songs] == ["In Rainbows", "Album Typo"]
    assert conn.calls[-1][2] == 0


def test_local_fuzzy_sql_error_resets_connection_and_transaction(fake_db, monkeypatch):
    reset_calls = []
    monkeypatch.setattr(db, "reset_connection", lambda: reset_calls.append(True))
    conn = fake_db([[], [(True,)], [("0.3",)], psycopg.errors.QueryCanceled("statement timeout")])

    with pytest.raises(psycopg.errors.QueryCanceled):
        db.search("local", "Rekoner", "Radiohed")

    assert reset_calls == [True]
    assert conn.transaction_depth == 0
