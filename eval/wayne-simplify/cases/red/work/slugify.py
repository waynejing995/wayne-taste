def slugify(text):
    return text.strip().lower().replace(" ", "-")


def slugify_title(text):
    cleaned = text.strip().lower().replace(" ", "-")
    return cleaned


def slugify_tag(text):
    cleaned = text.strip().lower().replace(" ", "-")
    return cleaned
