/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { isCopyJsonMenuArg, serializeJsonOutput } from '../../browser/copyJsonUtils.js';

describe('copyJsonUtils', () => {
	createTestContainer().build();

	describe('serializeJsonOutput', () => {
		it('pretty-prints JSON data with two-space indentation', () => {
			const result = serializeJsonOutput({ name: 'test', values: [1, true, null] });

			expect(result).toBe('{\n  "name": "test",\n  "values": [\n    1,\n    true,\n    null\n  ]\n}');
		});

		it('serializes primitive JSON values', () => {
			expect(serializeJsonOutput(null)).toBe('null');
			expect(serializeJsonOutput(true)).toBe('true');
			expect(serializeJsonOutput('text')).toBe('"text"');
		});
	});

	describe('isCopyJsonMenuArg', () => {
		it('returns true for valid arg', () => {
			expect(isCopyJsonMenuArg({ jsonText: '{"x":1}' })).toBe(true);
		});

		it('returns false for null', () => {
			expect(isCopyJsonMenuArg(null)).toBe(false);
		});

		it('returns false for missing jsonText', () => {
			expect(isCopyJsonMenuArg({ other: 'value' })).toBe(false);
		});

		it('returns false for non-string jsonText', () => {
			expect(isCopyJsonMenuArg({ jsonText: 123 })).toBe(false);
		});
	});
});
