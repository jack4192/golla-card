package com.paymate.backend.schedule.repository;

import com.paymate.backend.schedule.entity.Schedule;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ScheduleRepository extends JpaRepository<Schedule, Long> {

    Optional<Schedule> findByIdAndUserId(Long id, Long userId);

    @Query("""
            select s from Schedule s
             where s.userId = :userId
             order by s.scheduleDate asc, s.startTime asc nulls first, s.id asc
            """)
    List<Schedule> findAllByUser(@Param("userId") Long userId);

    @Query("""
            select s from Schedule s
             where s.userId = :userId and s.scheduleDate >= :fromDate
             order by s.scheduleDate asc, s.startTime asc nulls first, s.id asc
            """)
    List<Schedule> findFromDate(@Param("userId") Long userId, @Param("fromDate") LocalDate fromDate);


    @Query(value = "SELECT EXISTS (SELECT 1 FROM categories WHERE category = :category)", nativeQuery = true)
    boolean existsCategory(@Param("category") String category);

    @Query(value = """
            SELECT category      AS "category",
                   category_name AS "categoryName"
              FROM categories
             WHERE category IN (:codes)
            """, nativeQuery = true)
    List<CategoryNameRow> findCategoryNames(@Param("codes") Collection<String> codes);
}
