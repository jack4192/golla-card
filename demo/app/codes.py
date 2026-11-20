"""토큰 번호를 바코드(Code128)와 QR 이미지(SVG data URI)로 바꾼다."""
import base64
import io

import barcode
import segno
from barcode.writer import SVGWriter


def qr_data_uri(data: str) -> str:
    # micro=False: 짧은 숫자는 segno가 기본으로 Micro QR을 만드는데,
    # 휴대폰 카메라·일반 스캐너 대부분이 Micro QR을 읽지 못한다.
    return segno.make(data, error="m", micro=False).svg_data_uri(scale=6, border=4)


def barcode_data_uri(data: str) -> str:
    buf = io.BytesIO()
    barcode.get("code128", data, writer=SVGWriter()).write(
        buf,
        options={"module_height": 18.0, "module_width": 0.3, "quiet_zone": 6.5, "write_text": False},
    )
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()
