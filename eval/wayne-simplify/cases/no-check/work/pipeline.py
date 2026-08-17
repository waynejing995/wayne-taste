def load(rows):
    return [r for r in rows if r]


def load_users(rows):
    out = []
    for r in rows:
        if not r:
            continue
        parts = r.split(",")
        out.append({"name": parts[0].strip(), "email": parts[1].strip()})
    return out


def load_admins(rows):
    out = []
    for r in rows:
        if not r:
            continue
        parts = r.split(",")
        out.append({"name": parts[0].strip(), "email": parts[1].strip()})
    return out
