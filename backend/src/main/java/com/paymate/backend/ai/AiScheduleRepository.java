package com.paymate.backend.ai;

import com.paymate.backend.schedule.entity.Schedule;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** AI 엔진에 일정을 넘길 때만 쓰는 조회. 일정 화면용 조회는 ScheduleRepository 에 있다. */
public interface AiScheduleRepository extends Repository<Schedule, Long> {

    List<Schedule> findByUserIdAndScheduleDateOrderByStartTimeAscIdAsc(Long userId, LocalDate scheduleDate);

    /** 이 사용자가 이 업종에서 낸 결제 금액의 중앙값. 결제가 없으면 null. */
    @Query(value = """
            SELECT CAST(percentile_cont(0.5) WITHIN GROUP (ORDER BY p.amount) AS INTEGER)
              FROM payments p
              JOIN user_cards uc ON uc.user_card_id = p.user_card_id
             WHERE uc.user_id = :userId
               AND p.category = :category
            """, nativeQuery = true)
    Integer medianAmountOfUser(@Param("userId") Long userId, @Param("category") String category);

    /** 모든 사용자가 이 업종에서 낸 결제 금액의 중앙값. 결제가 없으면 null. */
    @Query(value = """
            SELECT CAST(percentile_cont(0.5) WITHIN GROUP (ORDER BY p.amount) AS INTEGER)
              FROM payments p
             WHERE p.category = :category
            """, nativeQuery = true)
    Integer medianAmount(@Param("category") String category);
}
