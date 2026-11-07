"""평가 전용 위치 모의값. 매장 앞에서 앱을 연다고 가정하고 오차와 실패를 넣는다.

오차와 실패율은 가정값이며 실제 매장에서 잰 값이 아니다.
"""

from engine.catalog import Catalog


def simulate(catalog: Catalog, merchant_id: int | None, rng, error_m: float, fail: float):
    """(위도, 경도, 정확도) 또는 위치를 얻지 못하면 None."""
    failed = rng.random() < fail
    north, east = rng.normal(0, error_m), rng.normal(0, error_m)
    merchant = catalog.merchants.get(merchant_id)
    if failed or merchant is None or merchant.is_online or merchant.lat is None:
        return None
    return merchant.lat + north / 111_000, merchant.lng + east / 88_000, error_m
