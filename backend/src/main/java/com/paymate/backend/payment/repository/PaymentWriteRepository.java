package com.paymate.backend.payment.repository;

import com.paymate.backend.payment.entity.Payment;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 앱 결제(가상 POS)로 생긴 결제를 저장한다 (2026-11-24).
 * 결제 내역 조회는 읽기 전용 {@link PaymentRepository} 가 따로 맡는다.
 */
public interface PaymentWriteRepository extends JpaRepository<Payment, Long> {
}
