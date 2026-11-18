"""Search behavior: quality gates, provider fallback, and unchanged responses."""

import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.music_search import can_fuzz, field_score, fuzzy_query, rank_candidates

from app import musicbrainz as mb
from app import musicbrainz_db as db

SONG_ID = "d9b46ecb-5472-4dcd-8fa4-dd6723189e27"
ROW = (UUID(SONG_ID), "Reckoner", "Radiohead", None, 290000, None)
SONG = dict(zip(("id", "title", "artist", "release", "duration", "comment"), (SONG_ID, *ROW[1:])))
RECORDING = {"id": SONG_ID, "title": "Reckoner", "artist-credit": [{"name": "Radiohead"}]}


@pytest.mark.parametrize("title,artist", [
    ("Rekoner", "Radiohead"),       # omission
    ("Reckonner", "Radiohead"),     # insertion
    ("Reckoner", "Radiohed"),
    ("Reckoner", "Radiphead"),      # substitution
    ("Recknoer", "Radiohaed"),      # adjacent transpositions
    ("Rekoner", "Radiohed"),        # both fields
    ("Rekoner", ""),
    ("", "Radiohed"),
])
def test_accepts_bounded_typos_in_each_supplied_field(title, artist):
    assert rank_candidates([SONG], title, artist) == [SONG]


@pytest.mark.parametrize("query,candidate", [
    ("Smels like teen sprit", "Smells Like Teen Spirit"),
    ("Don't stop", "Don't Stop Me Now"),
    ("Björk", "Björk"),
    ("Bjork", "Björk"),
    ("AC/DC", "AC/DC"),
    ("BEYONCÉ", "Beyoncé"),
])
def test_multitoken_and_unicode_names(query, candidate):
    assert field_score(query, candidate) > 0


@pytest.mark.parametrize("query,candidate", [
    ("abc", "abd"),                # short words stay strict
    ("go go", "go"),              # cannot reuse a word
    ("go go", "go now"),
    ("Rekoner", "Paranoid Android"),
    ("***", "Reckoner"),
    ("Radiohed", "Muse"),
    ("Bjoork", "Björk"),          # two edits exceed the short-name budget
])
def test_rejects_unrelated_names_and_short_word_corrections(query, candidate):
    assert field_score(query, candidate) == 0


def test_title_cannot_compensate_for_wrong_artist():
    assert rank_candidates([SONG], "Reckoner", "Coldplay") == []
    assert rank_candidates([SONG], "Yellow", "Radiohead") == []


def test_ranking_is_stable_deduplicates_and_caps_results():
    songs = [{**SONG, "id": f"{i:036d}"} for i in range(25)]
    typo = {**SONG, "id": "000", "title": "Reckoners"}
    results = rank_candidates([typo, *reversed(songs), songs[0]], "Rekoner", "Radiohed")
    assert results == songs[:20]


def test_lucene_query_uses_only_words_and_controlled_operators():
    assert fuzzy_query("Rekoner", "Radiohed") == "recording:(rekoner~) AND artist:(radiohed~)"
    assert fuzzy_query("go on", "") == 'recording:("go" AND "on")'
    query = fuzzy_query('Rekoner\" OR artist:* +foo~ (bar) \\baz', "AC/DC")
    assert query == 'recording:(rekoner~ AND "or" AND artist~ AND "foo" AND "bar" AND "baz") AND artist:("ac" AND "dc")'
    assert fuzzy_query("***", "Radiohead") == ""
    assert not can_fuzz("go on", "U2")


@pytest.mark.parametrize("title", ["Don't Stpo Me Now", "Don’t Stpo Me Now", "Dont Stpo Me Now"])
def test_lucene_contractions_match_the_analyzer(title):
    assert fuzzy_query(title, "Queen") == 'recording:(dont~ AND stpo~ AND "me" AND "now") AND artist:(queen~)'
    assert field_score(title, "Don't Stop Me Now") > 0


def test_public_exact_results_are_unchanged(monkeypatch):
    calls = []

    def get(path, **params):
        calls.append(params)
        return {"recordings": [RECORDING]}

    monkeypatch.setattr(mb, "_get", get)
    assert mb._search_api("Reckoner", "Radiohead")[0]["id"] == SONG_ID
    assert calls == [{"query": 'recording:"Reckoner" AND artist:"Radiohead"', "limit": 20}]


def test_public_fuzzy_search_runs_once_and_filters_candidates(monkeypatch):
    calls = []

    def get(path, **params):
        calls.append(params)
        if len(calls) == 1:
            return {"recordings": []}
        return {"recordings": [
            {**RECORDING, "id": "wrong-artist", "artist-credit": [{"name": "Coldplay"}]},
            RECORDING, RECORDING,
        ]}

    monkeypatch.setattr(mb, "_get", get)
    assert [song["id"] for song in mb._search_api("Rekoner", "Radiohed")] == [SONG_ID]
    assert len(calls) == 2
    assert calls[1] == {"query": "recording:(rekoner~) AND artist:(radiohed~)", "limit": 100}


def test_public_empty_fuzzy_results_do_not_cascade(monkeypatch):
    calls = []
    monkeypatch.setattr(mb, "_get", lambda path, **params: calls.append(params) or {"recordings": []})
    assert mb._search_api("Rekoner", "Radiohed") == []
    assert len(calls) == 2


@pytest.mark.parametrize("title,artist", [("go", "U2"), ("***", "Radiohead")])
def test_public_skips_fuzzy_when_no_safe_eligible_query(monkeypatch, title, artist):
    calls = []
    monkeypatch.setattr(mb, "_get", lambda path, **params: calls.append(params) or {"recordings": []})
    assert mb._search_api(title, artist) == []
    assert len(calls) == 1


def test_public_fuzzy_failure_is_not_disguised_as_empty(monkeypatch):
    calls = []

    def get(path, **params):
        calls.append(params)
        if len(calls) == 1:
            return {"recordings": []}
        raise mb.MusicBrainzError("MusicBrainz no respondió correctamente.")

    monkeypatch.setattr(mb, "_get", get)
    with pytest.raises(mb.MusicBrainzError):
        mb._search_api("Rekoner", "Radiohed")


class Connection:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []
        self.transaction_depth = 0

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
        self.response = next(self.responses)
        if isinstance(self.response, Exception):
            raise self.response

    def fetchall(self):
        return self.response

    def fetchone(self):
        return self.response[0]


@pytest.fixture
def local_connection(monkeypatch):
    monkeypatch.setattr(db._thread_local, "fuzzy_capabilities", {}, raising=False)

    def connect(responses):
        conn = Connection(responses)
        monkeypatch.setattr(db, "_connection", lambda dsn: conn)
        return conn
    return connect


def test_local_exact_does_not_check_or_run_fuzzy(local_connection):
    conn = local_connection([[ROW]])
    assert db.search("local", "Reckoner", "Radiohead") == [SONG]
    assert len(conn.calls) == 1


def test_missing_extension_or_indexes_keeps_local_source(local_connection, monkeypatch):
    conn = local_connection([[], [(False,)]])
    monkeypatch.setattr(mb, "_env", lambda name: "local")
    monkeypatch.setattr(mb, "is_local_db_active", lambda: True)

    def fail_api(*args, **kwargs):
        raise AssertionError("Missing fuzzy capability must not disable the local catalog")

    monkeypatch.setattr(mb, "_get", fail_api)
    assert mb.search("Rekoner", "Radiohed") == []
    assert len(conn.calls) == 2


def test_local_fuzzy_enriches_only_accepted_results_and_scopes_threshold(local_connection):
    wrong = (UUID(int=1), "Reckoner", "Coldplay", None, 290000, None)
    enriched = (*ROW[:3], "In Rainbows", *ROW[4:])
    conn = local_connection([[], [(True,)], [("0.3",)], [(1, "Radiohead"), (2, "Coldplay")], [wrong, ROW], [enriched]])
    songs = db.search("local", "Rekoner", "Radiohed")
    assert songs == [{**SONG, "release": "In Rainbows"}]
    assert conn.calls[-1][1] == ([SONG_ID],)
    assert conn.calls[-1][2] == 0
    assert conn.calls[2][2] == conn.calls[3][2] == conn.calls[4][2] == 1
    assert conn.calls[4][1]["artist_ids"] == [1]
    assert conn.transaction_depth == 0


def test_local_short_search_does_not_attempt_fuzzy(local_connection):
    conn = local_connection([[]])
    assert db.search("local", "go", "U2") == []
    assert len(conn.calls) == 1


def test_local_fuzzy_database_errors_still_use_public_fallback(local_connection, monkeypatch):
    local_connection([[], [(True,)], [("0.3",)], psycopg.OperationalError("connection lost")])
    monkeypatch.setattr(mb, "_env", lambda name: "local")
    monkeypatch.setattr(mb, "is_local_db_active", lambda: True)
    monkeypatch.setattr(db, "reset_connection", lambda: None)
    monkeypatch.setattr(mb, "_mark_local_db_inactive", lambda dsn: None)
    monkeypatch.setattr(mb, "_search_api", lambda title, artist: [SONG])
    assert mb.search("Rekoner", "Radiohed") == [SONG]
