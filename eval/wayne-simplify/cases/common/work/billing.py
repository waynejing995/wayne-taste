def normalize_amount(raw):
    text = str(raw).strip()
    if text.startswith("$"):
        text = text[1:]
    text = text.replace(",", "")
    return round(float(text), 2)


def invoice_total(rows):
    return round(sum(normalize_amount(r) for r in rows), 2)
