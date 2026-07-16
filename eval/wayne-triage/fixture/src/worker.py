from src.config import service_region


def worker_region() -> str:
    return service_region()
