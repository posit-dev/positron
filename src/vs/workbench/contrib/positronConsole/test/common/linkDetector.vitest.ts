/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { detectHyperlinks } from '../../common/linkDetector.js';

/**
 * Suite of tests for link detector
 */
describe('Output Run with Links', () => {
	ensureNoLeakedDisposables();

	it('basic links correctly extracted', () => {
		const text = "This is a link to https://www.example.com";
		const links = detectHyperlinks(text);

		expect(links).toEqual([{ text: 'https://www.example.com', index: 18 }]);
	});

	it('multiple links extracted', () => {
		const text = "This is a link to http://localhost:8080/ and another to http://localhost:8081/";
		const links = detectHyperlinks(text);

		expect(links).toEqual([
			{ text: 'http://localhost:8080/', index: 18 },
			{ text: 'http://localhost:8081/', index: 56 },
		]);
	});

	it('quotes ignored', () => {
		const text = `There's no place like "http://127.0.0.1/"`;
		const links = detectHyperlinks(text);

		expect(links).toEqual([{ text: 'http://127.0.0.1/', index: 23 }]);
	});

	it('angle brackets ignored', () => {
		const text = `See more about numbers at <http://localhost:1234>`;
		const links = detectHyperlinks(text);

		expect(links).toEqual([{ text: 'http://localhost:1234', index: 27 }]);
	});

	it('no links returns an empty array', () => {
		expect(detectHyperlinks('nothing to see here')).toEqual([]);
	});

	// https://github.com/posit-dev/positron/issues/11627
	it('repeated URLs report the index of each occurrence', () => {
		const text = `"https://xkcd.comFoo https://xkcd.com"`;
		const links = detectHyperlinks(text);

		expect(links).toEqual([
			{ text: 'https://xkcd.comFoo', index: 1 },
			{ text: 'https://xkcd.com', index: 21 },
		]);
	});
});
