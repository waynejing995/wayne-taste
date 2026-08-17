import os

BASE_DIR = os.path.abspath("data")


def parse_amount(text):
    value = round(float(text), 2)
    if value <= 0:
        raise ValueError("amount must be positive")
    return value


def apply_charge(account, amount):
    if amount <= 0:
        raise ValueError("amount must be positive")
    account = dict(account)
    account["balance"] = round(account["balance"] - amount, 2)
    return account


def load_ledger(name):
    path = os.path.abspath(os.path.join(BASE_DIR, name))
    if not path.startswith(BASE_DIR + os.sep):
        raise ValueError("ledger path escapes the data directory")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def charge_from_text(account, text):
    return apply_charge(account, parse_amount(text))
