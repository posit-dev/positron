/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as OTPAuth from 'otpauth';

/**
 * Generate a Time-based One-Time Password (TOTP) code
 *
 * @param secret - The base32-encoded secret key
 * @returns A 6-digit TOTP code valid for 30 seconds
 *
 * @example
 * const secret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET;
 * const code = generateTOTP(secret);
 * await page.fill('[name="otp"]', code);
 */
export function generateTOTP(secret: string): string {
	if (!secret) {
		throw new Error('TOTP secret is required');
	}

	// Extract the secret from otpauth:// URI if provided in that format
	// Format: otpauth://totp/issuer:account?secret=SECRETKEY&issuer=issuer
	let secretKey = secret;
	if (secret.startsWith('otpauth://')) {
		const url = new URL(secret);
		const secretParam = url.searchParams.get('secret');
		if (!secretParam) {
			throw new Error('Invalid otpauth URI: missing secret parameter');
		}
		secretKey = secretParam;
	}

	// Create a TOTP object
	const totp = new OTPAuth.TOTP({
		secret: secretKey,
		digits: 6,
		period: 30,
	});

	return totp.generate();
}
