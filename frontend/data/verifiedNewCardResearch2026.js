// 2026-11-18 issuer-official research for cards 23,25,26,27,28 in cardImageRegistry40.js.
// Research is STAGED ONLY: the existing 22-card catalog/recommendation/payment logic remains unchanged.
// Do not feed these records directly to the existing calculator: parent/category caps, add-on discounts,
// cashback, Hana Money and Samsung Wallet Points require explicit support before numerical estimates.
// Sources are per-card sourceUrl; benefits and issuance can change. No image substitutes are added.
export const VERIFIED_NEW_CARD_RESEARCH = [
  {
    "registryCardId": 23,
    "code": "BC_BALANCE",
    "issuer": "BC카드",
    "name": "BC 밸런스 카드",
    "type": "신용",
    "annualFee": 10000,
    "annualFeeVariants": [
      {
        "brand": "국내전용",
        "amount": 10000
      },
      {
        "brand": "VISA",
        "amount": 12000
      }
    ],
    "description": "Social/Personal/Always 서비스별 통합 할인한도가 적용되는 카드",
    "tags": [
      "교통",
      "편의점",
      "배달",
      "스타벅스",
      "온라인쇼핑",
      "통신",
      "주유"
    ],
    "benefitGroups": [
      {
        "id": "SOCIAL",
        "minPrevSpend": 400000,
        "tiers": [
          {
            "minPrevSpend": 400000,
            "monthlyCap": 10000
          },
          {
            "minPrevSpend": 700000,
            "monthlyCap": 15000
          },
          {
            "minPrevSpend": 1000000,
            "monthlyCap": 20000
          }
        ],
        "benefits": [
          {
            "name": "이동통신 자동납부",
            "rate": 0.07,
            "maxPerTx": 3000,
            "note": "KT/SKT/LGU+"
          },
          {
            "name": "대중교통·카카오T",
            "rate": 0.07,
            "maxPerTx": 5000,
            "note": "버스·지하철 및 카카오T 앱 자동결제"
          },
          {
            "name": "골프",
            "rate": 0.07,
            "maxPerTx": 10000,
            "note": "오프라인 골프연습장·스크린골프·골프경기장"
          },
          {
            "name": "편의점",
            "rate": 0.07,
            "maxPerTx": 5000,
            "note": "GS25/CU/이마트24 오프라인"
          }
        ]
      },
      {
        "id": "PERSONAL",
        "minPrevSpend": 400000,
        "tiers": [
          {
            "minPrevSpend": 400000,
            "monthlyCap": 10000
          },
          {
            "minPrevSpend": 700000,
            "monthlyCap": 15000
          },
          {
            "minPrevSpend": 1000000,
            "monthlyCap": 20000
          }
        ],
        "benefits": [
          {
            "name": "배달 앱",
            "rate": 0.1,
            "maxPerTx": 5000,
            "note": "배달의민족/쿠팡이츠 공식 앱·웹"
          },
          {
            "name": "주유소",
            "rate": 0.07,
            "maxPerTx": 5000,
            "note": "GS칼텍스/SK/S-Oil, LPG 제외"
          },
          {
            "name": "헬스클럽",
            "rate": 0.07,
            "maxPerTx": 10000,
            "note": "헬스클럽 업종, 온라인 제외"
          },
          {
            "name": "넷플릭스·유튜브 프리미엄",
            "rate": 0.07,
            "maxPerTx": 5000,
            "note": "공식 앱·웹 직접 구독"
          }
        ]
      },
      {
        "id": "ALWAYS",
        "minPrevSpend": 400000,
        "tiers": [
          {
            "minPrevSpend": 400000,
            "monthlyCap": 3000
          },
          {
            "minPrevSpend": 700000,
            "monthlyCap": 6000
          },
          {
            "minPrevSpend": 1000000,
            "monthlyCap": 10000
          }
        ],
        "benefits": [
          {
            "name": "스타벅스 사이렌오더",
            "rate": 0.5,
            "maxPerTx": null,
            "note": "스타벅스 공식 앱 사이렌오더"
          },
          {
            "name": "온라인몰",
            "rate": 0.07,
            "maxPerTx": 2000,
            "note": "쿠팡/마켓컬리/SSG닷컴"
          }
        ]
      }
    ],
    "sourceUrl": "https://m.bccard.com/app/mobileweb/CardDetail.do?cardGdsNo=101507&exec=cardDetail",
    "sourceType": "issuer_official",
    "reviewedAt": "2026-11-18",
    "integrationStatus": "staged_not_connected"
  },
  {
    "registryCardId": 25,
    "code": "BC_K_FIRST",
    "issuer": "BC카드",
    "name": "BC 케이퍼스트 카드",
    "officialProductName": "BC 바로카드 K-FIRST (모바일전용)",
    "type": "신용",
    "annualFee": 5000,
    "annualFeeVariants": [
      {
        "brand": "UnionPay",
        "amount": 5000
      },
      {
        "brand": "VISA",
        "amount": 10000
      }
    ],
    "description": "국내외 가맹점 1% 할인 및 생활편의업종 0.5% 추가 할인",
    "tags": [
      "전 가맹점",
      "음식점",
      "편의점",
      "커피",
      "쇼핑",
      "교통"
    ],
    "benefitGroups": [
      {
        "id": "GENERAL",
        "minPrevSpend": 0,
        "tiers": [],
        "benefits": [
          {
            "name": "국내외 가맹점",
            "rate": 0.01,
            "maxPerTx": null,
            "note": "전월실적 및 할인한도 없음; 제외 업종 확인"
          }
        ]
      },
      {
        "id": "LIFESTYLE_EXTRA",
        "minPrevSpend": 0,
        "tiers": [],
        "benefits": [
          {
            "name": "생활편의업종 추가할인",
            "rate": 0.005,
            "maxPerTx": null,
            "minAmountPerTx": 10000,
            "note": "음식점·편의점·커피·대형할인점·백화점·버스·지하철, 기본 1%에 추가 적용"
          }
        ]
      },
      {
        "id": "PAYBOOC_SHOPPING",
        "minPrevSpend": null,
        "tiers": [
          {
            "minPrevSpend": 0,
            "monthlyCap": 10000
          }
        ],
        "benefits": [
          {
            "name": "페이북 쇼핑",
            "rate": 0.05,
            "maxPerTx": null,
            "note": "페이북 쇼핑 5% 청구할인, 월 최대 1만원"
          }
        ]
      }
    ],
    "sourceUrl": "https://www.bccard.com/app/card/CreditCardMain.do?gdsno=503099",
    "sourceType": "issuer_official",
    "reviewedAt": "2026-11-18",
    "integrationStatus": "staged_not_connected"
  },
  {
    "registryCardId": 26,
    "code": "HANA_HERO_CHECK",
    "issuer": "하나카드",
    "name": "HERO 체크카드",
    "type": "체크",
    "annualFee": 0,
    "issuanceFee": 2000,
    "issuanceFeeRefundCondition": "카드 수령 다음 달 말까지 1만원 이상 사용 시 발급수수료 반환",
    "description": "구독·건강·생활비·쇼핑 등 하나머니 적립, 전월 30만/70만원 구간",
    "tags": [
      "구독",
      "건강",
      "통신",
      "마트",
      "슈퍼마켓",
      "백화점",
      "병원"
    ],
    "benefitGroups": [
      {
        "id": "HERO_UNIFIED",
        "minPrevSpend": 300000,
        "tiers": [
          {
            "minPrevSpend": 300000,
            "monthlyCap": 10000
          },
          {
            "minPrevSpend": 700000,
            "monthlyCap": 20000
          }
        ],
        "rewardUnit": "HANA_MONEY",
        "benefits": [
          {
            "name": "구독",
            "rate": 0.1,
            "categoryMonthlyCap": 2000,
            "note": "멜론·유튜브 프리미엄·넷플릭스·디즈니+·Wavve·쿠팡로켓와우"
          },
          {
            "name": "건강",
            "rate": 0.05,
            "categoryMonthlyCap": 2000,
            "note": "헬스·골프연습장·카카오골프, 해당 오프라인 제한 확인"
          },
          {
            "name": "생활비",
            "rate": 0.05,
            "categoryMonthlyCap": 2000,
            "note": "SKT/KT/LGU+ 통신·관리비·전기·가스 등"
          },
          {
            "name": "대형마트",
            "rate": 0.05,
            "categoryMonthlyCap": 4000,
            "note": "이마트·홈플러스·롯데마트, 오프라인"
          },
          {
            "name": "슈퍼마켓",
            "rate": 0.05,
            "categoryMonthlyCap": 4000,
            "note": "GS THE FRESH 등, 오프라인"
          },
          {
            "name": "백화점",
            "rate": 0.05,
            "categoryMonthlyCap": 3000,
            "note": "신세계·현대·롯데백화점, 오프라인"
          },
          {
            "name": "병원",
            "rate": 0.02,
            "categoryMonthlyCap": 2000,
            "note": "종합병원·일반병원·치과·한방병원·한의원, 오프라인"
          }
        ]
      },
      {
        "id": "HERO_GENERAL",
        "minPrevSpend": null,
        "tiers": [],
        "rewardUnit": "HANA_MONEY",
        "benefits": [
          {
            "name": "국내외 가맹점",
            "rate": 0.002,
            "categoryMonthlyCap": null,
            "note": "0.2% 기본 적립; 전월실적 적용 범위는 계산기 연동 전에 재확인"
          }
        ]
      }
    ],
    "sourceUrl": "https://www.hanacard.co.kr/OPI41000000D.web?CARD_CDOE=15449&CD_PD_SEQ=18643&title=STEP0",
    "sourceType": "issuer_official",
    "reviewedAt": "2026-11-18",
    "integrationStatus": "staged_not_connected"
  },
  {
    "registryCardId": 27,
    "code": "HANA_PBA_CHECK",
    "issuer": "하나카드",
    "name": "PBA 하나 체크카드",
    "type": "체크",
    "annualFee": 0,
    "description": "당구장 50%, 음식점·편의점·택시·주유·병원 5% 캐시백",
    "tags": [
      "당구",
      "음식점",
      "편의점",
      "택시",
      "주유",
      "병원"
    ],
    "benefitGroups": [
      {
        "id": "PBA_TOTAL",
        "minPrevSpend": 300000,
        "tiers": [
          {
            "minPrevSpend": 300000,
            "monthlyCap": 10000
          },
          {
            "minPrevSpend": 700000,
            "monthlyCap": 20000
          }
        ],
        "benefits": [
          {
            "name": "당구장",
            "rate": 0.5,
            "categoryCaps": [
              {
                "minPrevSpend": 300000,
                "monthlyCap": 5000
              },
              {
                "minPrevSpend": 700000,
                "monthlyCap": 10000
              }
            ],
            "note": "오프라인 당구장 업종"
          },
          {
            "name": "음식점",
            "rate": 0.05,
            "categoryCaps": [
              {
                "minPrevSpend": 300000,
                "monthlyCap": 2000
              },
              {
                "minPrevSpend": 700000,
                "monthlyCap": 4000
              }
            ],
            "note": "오프라인 음식점, 배달앱·예약앱 선결제 제외"
          },
          {
            "name": "편의점",
            "rate": 0.05,
            "categoryCaps": [
              {
                "minPrevSpend": 300000,
                "monthlyCap": 2000
              },
              {
                "minPrevSpend": 700000,
                "monthlyCap": 4000
              }
            ],
            "note": "GS25·CU·이마트24·세븐일레븐 오프라인"
          },
          {
            "name": "택시",
            "rate": 0.05,
            "categoryCaps": [
              {
                "minPrevSpend": 300000,
                "monthlyCap": 2000
              },
              {
                "minPrevSpend": 700000,
                "monthlyCap": 4000
              }
            ],
            "note": "택시 업종·카카오T 택시"
          },
          {
            "name": "주유/LPG충전",
            "rate": 0.05,
            "categoryCaps": [
              {
                "minPrevSpend": 300000,
                "monthlyCap": 2000
              },
              {
                "minPrevSpend": 700000,
                "monthlyCap": 4000
              }
            ],
            "note": "SK·GS칼텍스·S-Oil·HD현대오일뱅크·알뜰주유소 오프라인"
          },
          {
            "name": "병원/약국",
            "rate": 0.05,
            "categoryCaps": [
              {
                "minPrevSpend": 300000,
                "monthlyCap": 2000
              },
              {
                "minPrevSpend": 700000,
                "monthlyCap": 4000
              }
            ],
            "note": "병·의원·약국 오프라인, 보건소·동물병원 제외"
          }
        ]
      }
    ],
    "sourceUrl": "https://www.hanacard.co.kr/OPI41000000D.web?CD_PD_SEQ=19522",
    "sourceType": "issuer_official",
    "reviewedAt": "2026-11-18",
    "integrationStatus": "staged_not_connected"
  },
  {
    "registryCardId": 28,
    "code": "HANA_SAMSUNG_WALLET_TRAVELOG_CHECK",
    "issuer": "하나카드",
    "name": "삼성월렛 하나 트래블로그 체크카드",
    "type": "체크",
    "annualFee": 0,
    "description": "삼성페이 해외 오프라인 10%, 국내 0.5%, 국내 일반가맹점 0.3% 삼성월렛 포인트 및 해외수수료 면제",
    "tags": [
      "삼성월렛",
      "삼성페이",
      "해외여행",
      "해외결제",
      "국내"
    ],
    "benefitGroups": [
      {
        "id": "SAMSUNG_WALLET_POINT",
        "minPrevSpend": 200000,
        "tiers": [
          {
            "minPrevSpend": 200000,
            "monthlyCap": 10000
          }
        ],
        "rewardUnit": "SAMSUNG_WALLET_POINT",
        "benefits": [
          {
            "name": "삼성페이 해외 오프라인",
            "rate": 0.1,
            "note": "해외 비접촉식 단말기 결제; 국내 적립과 한도 공유"
          },
          {
            "name": "삼성페이 국내",
            "rate": 0.005,
            "note": "삼성월렛 카드 등록 결제; 해외 10%와 한도 공유"
          }
        ]
      },
      {
        "id": "SAMSUNG_WALLET_DOMESTIC",
        "minPrevSpend": 0,
        "tiers": [],
        "rewardUnit": "SAMSUNG_WALLET_POINT",
        "benefits": [
          {
            "name": "국내 가맹점 결제",
            "rate": 0.003,
            "note": "전월 실적·적립 한도 없음. 중복 시 높은 적립 적용, 월렛 국내 한도 소진 시 기본률 적용"
          }
        ]
      },
      {
        "id": "FOREIGN_FEE_WAIVER",
        "minPrevSpend": 0,
        "tiers": [],
        "benefits": [
          {
            "name": "해외 가맹점 수수료 면제",
            "rate": null,
            "note": "해외서비스 수수료 US$0.5/건 및 국제브랜드 수수료 1% 면제"
          },
          {
            "name": "해외 ATM 인출 수수료 면제",
            "rate": null,
            "note": "해외서비스 수수료 US$3/건 및 국제브랜드 수수료 1% 면제. 현지 ATM 수수료는 별도"
          }
        ]
      }
    ],
    "sourceUrl": "https://m.hanacard.co.kr/MKCDCM1010M.web?CD_PD_SEQ=18928",
    "sourceType": "issuer_official",
    "reviewedAt": "2026-11-18",
    "integrationStatus": "staged_not_connected"
  }
];

export const getVerifiedNewCardResearch = code =>
  VERIFIED_NEW_CARD_RESEARCH.find(card => card.code === code) || null;
