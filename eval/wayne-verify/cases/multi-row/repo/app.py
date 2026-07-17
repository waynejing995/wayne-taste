import sys


mode = sys.argv[1]
if mode == "fail":
    print("FIRST_BROKEN")
elif mode == "pass":
    print("SECOND_OK")
else:
    raise SystemExit(2)
