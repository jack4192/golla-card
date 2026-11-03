"""① 기준 정보: 발급사, 업종, 가상 카드.

카드는 발급사·종류·태그만 내보낸다. 혜택·한도는 실제 카드 상품을 매칭할 때 따로 만든다.
"""

import pandas as pd

from .benefit import Card
from .common import load_config


def build_masters(cards: list[Card]) -> dict[str, pd.DataFrame]:
    issuers = pd.DataFrame(load_config("issuers")["issuers"]).rename(
        columns={"code": "issuer_code", "name": "issuer_name"})
    categories = pd.DataFrame(load_config("categories")["categories"]).rename(
        columns={"code": "category_code", "name": "category_name",
                 "channel": "default_channel", "placement_target": "is_placement_target"})
    catalog = pd.DataFrame([{
        "card_id": c.card_id, "card_code": c.code, "issuer_code": c.issuer, "card_name": c.name,
        "card_type": c.card_type, "tags": ",".join(c.tags), "annual_fee": c.annual_fee,
        "is_placeholder_name": True, "data_origin": "synthetic",
    } for c in cards])
    return {"issuers": issuers, "merchant_categories": categories, "card_catalog": catalog}
