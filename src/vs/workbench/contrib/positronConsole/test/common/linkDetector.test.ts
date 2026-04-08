/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import assert from 'assert';
import { detectHyperlinks } from '../../common/linkDetector.js';

/**
 * Suite of tests for link detector
 */
suite('Output Run with Links', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('basic links correctly extracted', () => {
		const text = "This is a link to https://www.example.com";
		const links = detectHyperlinks(text);

		assert.equal(links.length, 1);
		assert.equal(links[0], 'https://www.example.com');
	});

	test('multiple links extracted', () => {
		const text = "This is a link to http://localhost:8080/ and another to http://localhost:8081/";
		const links = detectHyperlinks(text);

		assert.equal(links.length, 2);
		assert.equal(links[0], 'http://localhost:8080/');
		assert.equal(links[1], 'http://localhost:8081/');
	});

	test('quotes ignored', () => {
		const text = `There's no place like "http://127.0.0.1/"`;
		const links = detectHyperlinks(text);

		assert.equal(links.length, 1);
		assert.equal(links[0], 'http://127.0.0.1/');
	});

	test('angle brackets ignored', () => {
		const text = `See more about numbers at <http://localhost:1234>`;
		const links = detectHyperlinks(text);

		assert.equal(links.length, 1);
		assert.equal(links[0], 'http://localhost:1234');
	});
});
