# tasks

A small task list. `tasks.cli` is the command-line front end; `tasks.api` is imported by the team's web service.

Run the tests:

    PYTHONPATH=src uv run --no-project python -m unittest discover -s tests -v

Run the CLI:

    PYTHONPATH=src uv run --no-project python -m tasks.cli list
