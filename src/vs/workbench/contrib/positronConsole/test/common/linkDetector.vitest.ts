/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { detectHyperlinks } from '../../common/linkDetector.js';

/**
 * Suite of tests for link detector
 */
describe('Output Run with Links', () => {
	it('basic links correctly extracted', () => {
		const text = "This is a link to https://www.example.com";
		const links = detectHyperlinks(text);

		expect(links.length).toBe(1);
		expect(links[0]).toBe('https://www.example.com');
	});

	it('multiple links extracted', () => {
		const text = "This is a link to http://localhost:8080/ and another to http://localhost:8081/";
		const links = detectHyperlinks(text);

		expect(links.length).toBe(2);
		expect(links[0]).toBe('http://localhost:8080/');
		expect(links[1]).toBe('http://localhost:8081/');
	});

	it('quotes ignored', () => {
		const text = `There's no place like "http://127.0.0.1/"`;
		const links = detectHyperlinks(text);

		expect(links.length).toBe(1);
		expect(links[0]).toBe('http://127.0.0.1/');
	});

	it('angle brackets ignored', () => {
		const text = `See more about numbers at <http://localhost:1234>`;
		const links = detectHyperlinks(text);

		expect(links.length).toBe(1);
		expect(links[0]).toBe('http://localhost:1234');
	});
});
