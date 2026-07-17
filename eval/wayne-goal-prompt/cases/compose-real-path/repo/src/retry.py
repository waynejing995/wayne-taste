class TransientError(RuntimeError):
    pass


def retry(operation, max_attempts: int = 3):
    return operation()
