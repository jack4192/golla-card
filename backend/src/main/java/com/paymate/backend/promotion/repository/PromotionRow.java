package com.paymate.backend.promotion.repository;

/** promotions 표 한 행 (혜택 탭에 쓰는 칸). 날짜는 'yyyy-MM-dd' 글자. 화면용 칸은 마이그레이션 전이면 비어 있을 수 있다. */
public interface PromotionRow {

    Long getPromotionId();

    String getKind();            // event / myshop

    String getDisplayName();     // 화면 이름 (없으면 merchant_name)

    String getMerchantName();    // 가맹점 찾기 이름

    String getPromoName();

    String getBenefitType();     // point / cashback / discount

    String getBenefitText();

    Integer getMinAmount();

    Integer getMaxAmount();

    String getDisplayStart();    // 실제 행사 기간

    String getDisplayEnd();

    String getStartDate();       // 점수 기간 (가상 1년 결제용)

    String getEndDate();

    String getPayout();

    String getPayMethod();

    String getNote();

    Boolean getNeedsCheck();

    String getLogoUrl();
}
