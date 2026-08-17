#!/usr/bin/env python3
"""Log every open/read of the watched files, with a monotonic wall-clock stamp.

Pure-ctypes inotify: no third-party dependency, works on a local filesystem
(trial workspaces are placed under /tmp for exactly this reason).

usage: watch_reads.py <logfile> <file-to-watch> [<file-to-watch> ...]
"""

import ctypes
import ctypes.util
import os
import struct
import sys
import time

IN_OPEN = 0x20
IN_ACCESS = 0x01
EVENT_HDR = struct.Struct("iIII")


def main():
    log_path, watched = sys.argv[1], sys.argv[2:]
    libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
    fd = libc.inotify_init()
    if fd < 0:
        raise OSError(ctypes.get_errno(), "inotify_init failed")

    names = {}
    for path in watched:
        wd = libc.inotify_add_watch(fd, path.encode(), IN_OPEN | IN_ACCESS)
        if wd < 0:
            raise OSError(ctypes.get_errno(), f"inotify_add_watch failed for {path}")
        names[wd] = path

    with open(log_path, "a", buffering=1) as log:
        log.write(f"{time.time():.3f} watching {' '.join(watched)}\n")
        while True:
            data = os.read(fd, 4096)
            offset = 0
            while offset < len(data):
                wd, mask, _cookie, length = EVENT_HDR.unpack_from(data, offset)
                offset += EVENT_HDR.size + length
                kind = "open" if mask & IN_OPEN else "access"
                log.write(f"{time.time():.3f} {kind} {names.get(wd, wd)}\n")


if __name__ == "__main__":
    main()
