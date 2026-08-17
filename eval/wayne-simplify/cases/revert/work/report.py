def fmt(label, value):
    return "{}: {}".format(label.strip().upper(), round(float(value), 2))


def report(rows):
    return "\n".join(fmt(label, value) for label, value in rows)
