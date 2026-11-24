package com.paymate.backend.payment.repository;

import com.paymate.backend.payment.entity.PaymentCode;
import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PaymentCodeRepository extends JpaRepository<PaymentCode, Long> {

    @Query("""
            select pc from PaymentCode pc
             where pc.id = :id
               and pc.userCardId in (select uc.id from UserCard uc where uc.userId = :userId)
            """)
    Optional<PaymentCode> findMine(@Param("id") Long id, @Param("userId") Long userId);

    @Modifying
    @Query(value = """
            UPDATE payment_codes
               SET status = 'VOID'
             WHERE status = 'ISSUED'
               AND expires_at > :now
               AND user_card_id IN (SELECT user_card_id FROM user_cards WHERE user_id = :userId)
            """, nativeQuery = true)
    int voidIssued(@Param("userId") Long userId, @Param("now") LocalDateTime now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<PaymentCode> findByCodeHash(String codeHash);
}
