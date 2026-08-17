def format_entry(label, value):
    return "{}: {}".format(label.strip().upper(), round(float(value), 2))


def summarize(rows):
    return " | ".join(format_entry(label, value) for label, value in rows)
