"""Recording-level content markers; titles and artist genres are not ratings."""

import re

EXPLICIT_TAGS = frozenset({"explicit", "explicit lyrics", "explicit content", "parental advisory", "uncensored"})


def explicit_metadata(comment: str | None, tags=()) -> bool:
    if EXPLICIT_TAGS.intersection(tag.strip().casefold() for tag in tags):
        return True
    text = (comment or "").casefold()
    # Use the version label first: "clean version of the explicit original"
    # differs from "explicit version, not clean". Positive recording tags win.
    text = re.sub(r"\bnot clean\b", "", text)
    marker = re.search(r"\b(non[ -]?explicit|not explicit|clean|censored|explicit|uncensored|parental advisory)\b", text)
    return bool(marker and marker.group() in {"explicit", "uncensored", "parental advisory"})
