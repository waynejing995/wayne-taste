CALLS = []


def expensive(n):
    CALLS.append(n)
    return n * n
