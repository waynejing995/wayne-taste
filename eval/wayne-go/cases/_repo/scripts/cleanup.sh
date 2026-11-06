#!/usr/bin/env bash
# Delete archived task exports older than 30 days.
find /var/lib/tasks/archive -name '*.json' -mtime +30 -delete
