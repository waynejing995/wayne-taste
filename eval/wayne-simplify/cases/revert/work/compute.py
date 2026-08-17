CALLS = []

_MEMO = {}


def expensive(n):
    CALLS.append(n)
    return n * n


def compute(n):
    if n in _MEMO:
        return _MEMO[n]
    value = expensive(n)
    _MEMO[n] = value
    return value
