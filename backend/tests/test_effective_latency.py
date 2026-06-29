"""Effective latency = recursionLatencyMs * (1 - cacheHitRatio/100)."""

def effective(recursion_ms: float, hit_ratio_pct: float) -> float:
    return round(recursion_ms * (1 - hit_ratio_pct / 100.0), 2)


def test_high_cache_hit_drops_effective():
    # recursion 445ms with 80.8% cache hit → ~85.44ms effective
    assert effective(445.0, 80.8) == round(445.0 * 0.192, 2)


def test_zero_cache_hit_equals_recursion():
    assert effective(120.0, 0.0) == 120.0


def test_full_cache_hit_zero_effective():
    assert effective(500.0, 100.0) == 0.0
