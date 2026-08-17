def clean_amount(raw):
    text = str(raw).strip()
    if text.startswith("$"):
        text = text[1:]
    text = text.replace(",", "")
    return round(float(text), 2)


def report_line(label, raw):
    return f"{label}: {clean_amount(raw):.2f}"
