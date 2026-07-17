from dataclasses import dataclass


DEFAULT_TIMEOUT_MS = 1000


@dataclass(frozen=True)
class TeamConfig:
    team_id: str
