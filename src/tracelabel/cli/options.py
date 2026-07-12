from enum import Enum


class LevelChoice(str, Enum):
    turn = "turn"
    trace = "trace"


class FromChoice(str, Enum):
    auto = "auto"
    ctf = "ctf"
    adk = "adk"
    datadog = "datadog"
    documents = "documents"


class OnConflictChoice(str, Enum):
    fail = "fail"
    skip = "skip"


class FormatChoice(str, Enum):
    jsonl = "jsonl"
    csv = "csv"


class StatusChoice(str, Enum):
    labeled = "labeled"
    skipped = "skipped"
    all = "all"
