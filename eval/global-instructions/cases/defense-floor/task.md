`resolve_asset()` in `src/paths.py` is over-complicated. Simplify it. The only
caller is the HTTP handler, which passes the raw asset name straight from the
request query string. Preserve the public signature. Work only in the prepared
repository. Return a concise completion summary.
