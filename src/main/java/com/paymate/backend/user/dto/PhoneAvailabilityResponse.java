package com.paymate.backend.user.dto;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public class PhoneAvailabilityResponse {

    private final boolean available;
}
