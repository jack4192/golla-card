package com.paymate.backend.card.dto;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class ReorderCardsRequest {

    @NotEmpty(message = "카드 순서를 보내 주세요.")
    private List<Long> userCardIds;
}
