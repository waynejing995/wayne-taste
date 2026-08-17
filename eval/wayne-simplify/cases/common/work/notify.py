from abc import ABC, abstractmethod


class NotifierBackend(ABC):
    @abstractmethod
    def deliver(self, user, subject, body):
        ...


class EmailBackend(NotifierBackend):
    def deliver(self, user, subject, body):
        return ("email", user["email"], subject, body)


class NotifierFactory:
    def __init__(self, config=None):
        self.config = config or {}

    def create(self, kind="email"):
        if kind == "email":
            return EmailBackend()
        raise ValueError(kind)


def send_email(user, subject, body):
    return NotifierFactory().create("email").deliver(user, subject, body)
