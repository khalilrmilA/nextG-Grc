"""Self-test for app/core/shared_state.py — both storage paths.

There is no Redis in the dev/prod box this runs on (the app falls back to
in-process storage there), so the Redis branch would otherwise ship
unexercised and only wake up inside the on-prem Docker stack. This drives it
with a stub client that records the calls, alongside the fallback path.

Run:  venv/bin/python scripts/selftest_shared_state.py
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import shared_state  # noqa: E402

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")


# ── stub redis ────────────────────────────────────────────────────────────────

class _StubPipeline:
    def __init__(self, store):
        self._store = store
        self._ops = []

    def incrby(self, key, amount):
        self._ops.append(("incrby", key, amount))

    def expire(self, key, ttl, nx=False):
        self._ops.append(("expire", key, ttl, nx))

    async def execute(self):
        results = []
        for op in self._ops:
            if op[0] == "incrby":
                _, key, amount = op
                value, exp = self._store.get(key, (0, None))
                value = int(value) + amount
                self._store[key] = (value, exp)
                results.append(value)
            else:
                _, key, ttl, nx = op
                value, exp = self._store.get(key, (0, None))
                # nx=True must NOT extend a window that already has a TTL
                if nx and exp is not None:
                    results.append(False)
                else:
                    self._store[key] = (value, time.time() + ttl)
                    results.append(True)
        self._ops = []
        return results


class StubRedis:
    """Minimal stand-in for redis.asyncio covering only what we call."""

    def __init__(self):
        self.store: dict[str, tuple] = {}
        self.calls: list[str] = []

    async def ping(self):
        return True

    async def set(self, key, value, ex=None):
        self.calls.append("set")
        self.store[key] = (value, time.time() + ex if ex else None)

    async def exists(self, key):
        self.calls.append("exists")
        entry = self.store.get(key)
        if entry is None:
            return 0
        if entry[1] is not None and entry[1] <= time.time():
            del self.store[key]
            return 0
        return 1

    async def get(self, key):
        self.calls.append("get")
        entry = self.store.get(key)
        if entry is None:
            return None
        if entry[1] is not None and entry[1] <= time.time():
            del self.store[key]
            return None
        return str(entry[0])

    def pipeline(self):
        self.calls.append("pipeline")
        return _StubPipeline(self.store)


class BrokenRedis(StubRedis):
    """Connected, then every operation blows up — the 'Redis died mid-flight'
    case, which must degrade rather than 500."""

    async def set(self, key, value, ex=None):
        raise RuntimeError("redis went away")

    async def exists(self, key):
        raise RuntimeError("redis went away")

    async def get(self, key):
        raise RuntimeError("redis went away")

    def pipeline(self):
        raise RuntimeError("redis went away")


async def main() -> None:
    # ── 1. fallback path (no redis) ──────────────────────────────────────────
    print("\nfallback path (no Redis reachable)")
    shared_state.reset_for_tests()
    shared_state._retry_after = float("inf")  # skip the connection attempt

    check("unmarked key is not marked", await shared_state.is_marked("a"), False)
    await shared_state.mark("a", 60)
    check("marked key is marked", await shared_state.is_marked("a"), True)

    await shared_state.mark("expiring", 1)
    shared_state._LOCAL["expiring"] = (1, time.time() - 1)  # force expiry
    check("expired mark reads as unset", await shared_state.is_marked("expiring"), False)
    check("expired mark is purged", "expiring" in shared_state._LOCAL, False)

    check("first incr returns amount", await shared_state.incr("c", 3, 60), 3)
    check("second incr accumulates", await shared_state.incr("c", 4, 60), 7)
    check("get_count reads counter", await shared_state.get_count("c"), 7)
    check("get_count of unset key is 0", await shared_state.get_count("nope"), 0)

    shared_state._LOCAL["c"] = (7, time.time() - 1)  # force window expiry
    check("counter resets after window", await shared_state.incr("c", 1, 60), 1)

    # ── 2. redis path ────────────────────────────────────────────────────────
    print("\nRedis path (stub client)")
    shared_state.reset_for_tests()
    stub = StubRedis()
    shared_state._client = stub

    check("unmarked key is not marked", await shared_state.is_marked("x"), False)
    await shared_state.mark("x", 60)
    check("marked key is marked", await shared_state.is_marked("x"), True)
    check("key is namespaced", "grceye:revoked" in str(list(stub.store)) or
          any(k.startswith("grceye:") for k in stub.store), True)

    check("first incr returns amount", await shared_state.incr("q", 5, 60), 5)
    check("second incr accumulates", await shared_state.incr("q", 2, 60), 7)
    check("get_count reads counter", await shared_state.get_count("q"), 7)

    # The window must not slide: expire(nx=True) on an already-TTL'd key is a
    # no-op, so a caller hammering incr() can't push its own limit out forever.
    _, first_exp = stub.store["grceye:q"]
    await shared_state.incr("q", 1, 600)
    _, second_exp = stub.store["grceye:q"]
    check("incr does not extend an open window", first_exp == second_exp, True)

    # Nothing wrote to the local fallback while Redis was healthy.
    check("fallback untouched while Redis healthy", len(shared_state._LOCAL), 0)

    # ── 3. redis fails mid-flight ────────────────────────────────────────────
    print("\nRedis fails after connecting (must degrade, not raise)")
    shared_state.reset_for_tests()
    shared_state._client = BrokenRedis()

    await shared_state.mark("boom", 60)                      # must not raise
    check("mark degraded to fallback", shared_state._LOCAL.get("boom", (0,))[0], 1)
    check("is_marked degraded to fallback", await shared_state.is_marked("boom"), True)
    check("incr degraded to fallback", await shared_state.incr("bc", 2, 60), 2)
    check("get_count degraded to fallback", await shared_state.get_count("bc"), 2)

    shared_state.reset_for_tests()

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("all shared_state self-tests passed")


if __name__ == "__main__":
    asyncio.run(main())
