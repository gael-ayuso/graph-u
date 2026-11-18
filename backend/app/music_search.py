"""Bounded typo matching shared by the local catalog and the public API.

Retrieval scores only find candidates. Acceptance checks every query word, in
order, independently for title and artist; a good title cannot hide a wrong artist.
"""

import re
import unicodedata

CANDIDATE_LIMIT = 400
RESULT_LIMIT = 20
WORD_SIMILARITY_THRESHOLD = 0.3
TITLE_ONLY_SIMILARITY_THRESHOLD = 0.4


def words(value: str) -> list[str]:
    # Only Unicode letters/numbers reach Lucene, so user input cannot inject
    # operators. Keep accents; this is not a transliteration/alias resolver.
    normalized = unicodedata.normalize("NFKC", value).casefold()
    # MusicBrainz's Lucene analyzer treats contractions as one term (dont),
    # not the separate mandatory terms "don" AND "t".
    normalized = re.sub(r"(?<=\w)['’ʼ](?=\w)", "", normalized)
    return re.findall(r"[^\W_]+", normalized)


def can_fuzz(title: str, artist: str) -> bool:
    return any(len(word) >= 4 for value in (title, artist) for word in words(value))


def _distance(left: str, right: str, budget: int) -> int:
    """Optimal string alignment distance (adjacent transpositions cost one)."""
    if abs(len(left) - len(right)) > budget:
        return budget + 1
    previous = list(range(len(right) + 1))
    older = previous
    for i, a in enumerate(left, 1):
        current = [i]
        for j, b in enumerate(right, 1):
            cost = min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (a != b))
            if i > 1 and j > 1 and a == right[j - 2] and left[i - 2] == b:
                cost = min(cost, older[j - 2] + 1)
            current.append(cost)
        older, previous = previous, current
    return previous[-1]


def _word_score(query: str, candidate: str) -> float:
    if query == candidate:
        return 1.0
    if len(query) < 4:
        return 0.0
    budget = 1 if len(query) < 8 else 2
    distance = _distance(query, candidate, budget)
    if distance > budget:
        return 0.0
    return 1 - distance / max(len(query), len(candidate))


def field_score(query: str, candidate: str) -> float:
    if not query.strip():
        return 1.0
    wanted, available = words(query), words(candidate)
    if not wanted or len(wanted) > len(available):
        return 0.0
    # Best ordered alignment. Extra candidate words (live versions, credits,
    # etc.) may be skipped, but no query word may be skipped or reused.
    previous = [0.0] * (len(available) + 1)
    for word in wanted:
        current = [-1.0] * (len(available) + 1)
        for j, other in enumerate(available, 1):
            current[j] = current[j - 1]
            score = _word_score(word, other)
            if score and previous[j - 1] >= 0:
                current[j] = max(current[j], previous[j - 1] + score)
        previous = current
    if previous[-1] < 0:
        return 0.0
    # Prefer the closest spelling, then shorter names, without rejecting
    # otherwise valid partial-title/artist-credit matches.
    return previous[-1] / len(wanted) / (1 + 0.01 * (len(available) - len(wanted)))


def rank_candidates(songs: list[dict], title: str, artist: str) -> list[dict]:
    ranked = []
    for song in songs:
        scores = [field_score(query, song[key]) for query, key in ((title, "title"), (artist, "artist")) if query]
        if not scores or min(scores) <= 0:
            continue
        ranked.append((min(scores), sum(scores) / len(scores), song))
    ranked.sort(key=lambda entry: (-entry[0], -entry[1], entry[2]["id"]))
    unique = {}
    for _, _, song in ranked:
        unique.setdefault(song["id"], song)
    return list(unique.values())[:RESULT_LIMIT]


def fuzzy_query(title: str, artist: str) -> str:
    clauses = []
    for field, value in (("recording", title), ("artist", artist)):
        if not value:
            continue
        terms = words(value)
        if not terms:
            return ""
        clauses.append(f"{field}:(" + " AND ".join(word + "~" if len(word) >= 4 else f'"{word}"' for word in terms) + ")")
    return " AND ".join(clauses)
