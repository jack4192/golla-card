"""설정 겹쳐 쓰기 (v2, 2026-11-22)."""

from generate.common import deep_merge, load_config


def test_deep_merge_사전은_합치고_목록은_바꾼다():
    base = {"a": {"x": 1, "y": [1, 2]}, "b": 1}
    out = deep_merge(base, {"a": {"y": [9]}, "c": 3})
    assert out == {"a": {"x": 1, "y": [9]}, "b": 1, "c": 3}
    assert base == {"a": {"x": 1, "y": [1, 2]}, "b": 1}


def test_v1_설정은_v2_파일을_읽지_않는다():
    assert load_config("settings", "v1")["n_background_users"] == 300


def test_v2_설정은_겹쳐_쓴다():
    v2 = load_config("settings", "v2")
    assert v2["n_background_users"] == 1000 and v2["seed"] == 20261127


def test_v2_1_설정은_v2_위에_한_번_더_겹쳐_쓴다():
    """v2.1(2026-11-23): 점이 있는 판은 큰 판(v2) 설정 위에 자기 설정을 겹친다."""
    assert load_config("settings", "v2.1")["n_background_users"] == 1000
    d = load_config("distributions", "v2.1")
    assert "HOMEMAKER" in d["archetypes"] and d["routines"]["share"] == 0.5
    assert "routines" not in load_config("distributions", "v2")
    assert "routines" not in load_config("distributions", "v1")
