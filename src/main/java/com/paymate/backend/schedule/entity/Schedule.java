package com.paymate.backend.schedule.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@Entity
@Table(name = "schedules")
public class Schedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "schedule_id")
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "schedule_date", nullable = false)
    private LocalDate scheduleDate;

    @Column(name = "kind", nullable = false, length = 10)
    private String kind;           // SITUATION / PLACE

    @Column(name = "types", length = 100)
    private String types;          // 상황 일정 종류(쉼표 구분). 장소 일정은 null

    @Column(name = "category", length = 30)
    private String category;       // 장소 일정 업종 코드. 상황 일정은 null

    @Column(name = "title", length = 40)
    private String title;          // 장소 일정 '직접 입력' 이름

    @Column(name = "start_time", length = 5)
    private String startTime;      // "HH:mm". 상황 일정은 null = 하루 종일

    @Column(name = "end_time", length = 5)
    private String endTime;        // "HH:mm" (24:00 허용)

    @Column(name = "memo", length = 80)
    private String memo;

    // DB가 자동으로 채우는 값
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    public Schedule(Long userId, LocalDate scheduleDate, String kind, String types, String category,
                    String title, String startTime, String endTime, String memo) {
        this.userId = userId;
        update(scheduleDate, kind, types, category, title, startTime, endTime, memo);
    }


    public void update(LocalDate scheduleDate, String kind, String types, String category,
                       String title, String startTime, String endTime, String memo) {
        this.scheduleDate = scheduleDate;
        this.kind = kind;
        this.types = types;
        this.category = category;
        this.title = title;
        this.startTime = startTime;
        this.endTime = endTime;
        this.memo = memo;
    }
}
