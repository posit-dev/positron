/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isLocalHostHeader } from '../../node/positronMcpServer.js';

describe('isLocalHostHeader (DNS-rebinding guard)', () => {
	it('allows local hosts, with or without a port', () => {
		expect(isLocalHostHeader('localhost')).toBe(true);
		expect(isLocalHostHeader('localhost:43123')).toBe(true);
		expect(isLocalHostHeader('127.0.0.1:43123')).toBe(true);
		expect(isLocalHostHeader('LocalHost:43123')).toBe(true);
		expect(isLocalHostHeader('[::1]:43123')).toBe(true);
		expect(isLocalHostHeader('[::1]')).toBe(true);
	});

	it('allows an absent Host header (socket is bound to 127.0.0.1 anyway)', () => {
		expect(isLocalHostHeader(undefined)).toBe(true);
		expect(isLocalHostHeader('')).toBe(true);
	});

	it('rejects non-local hosts (a rebinding page keeps its own domain in Host)', () => {
		expect(isLocalHostHeader('evil.example.com')).toBe(false);
		expect(isLocalHostHeader('evil.example.com:43123')).toBe(false);
		expect(isLocalHostHeader('localhost.evil.example.com')).toBe(false);
		expect(isLocalHostHeader('192.168.1.10:43123')).toBe(false);
	});
});
