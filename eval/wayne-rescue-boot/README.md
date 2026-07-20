# Wayne Rescue Boot eval

This harness freezes the creation/control skill and calibrates its applicability
and disk-safety Flow without touching a machine.

```bash
uv run eval/wayne-rescue-boot/calibrate.py
```

The deterministic gate owns only static ownership and graph reachability. Real
hardware diagnosis still requires native SMART, mount, fsck, chroot, and reboot
evidence at runtime.
