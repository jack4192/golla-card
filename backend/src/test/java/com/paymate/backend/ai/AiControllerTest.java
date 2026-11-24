package com.paymate.backend.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.paymate.backend.common.security.AuthUser;
import java.time.LocalDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class AiControllerTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 24);

    @Test
    @DisplayName("홈 하루 배치는 부르기 전에 AI 의 오늘 일정을 서버 일정과 맞춘다 (저장 때 못 넘긴 일정도 표시줄에, 2026-11-24)")
    void dayPlacementSyncsSchedulesFirst() {
        AiService ai = mock(AiService.class);
        ScheduleAiSync sync = mock(ScheduleAiSync.class);
        when(ai.today()).thenReturn(TODAY);
        when(ai.dayPlacement(7L)).thenReturn("{\"day\":\"2026-11-24\",\"segments\":[]}");
        AiController controller = new AiController(ai, sync);

        String body = controller.dayPlacement(new AuthUser(7L, "a@b.c", "USER", "j", null)).getBody();

        assertThat(body).isEqualTo("{\"day\":\"2026-11-24\",\"segments\":[]}");
        InOrder order = inOrder(sync, ai);
        order.verify(sync).ensureSynced(7L, TODAY);
        order.verify(ai).dayPlacement(7L);
    }
}
