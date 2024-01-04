/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { matchRunnable } from '../hyperlink';

suite('Hyperlink', () => {
	test('Runnable R code regex enforces safety rules', async () => {
		const matchSimple = matchRunnable("pkg::fun()");
		assert.strictEqual(matchSimple?.groups?.package, "pkg");
		assert.strictEqual(matchSimple?.groups?.function, "fun");

		const matchArgs = matchRunnable("pkg::fun(1 + 1, 2:5)");
		assert.strictEqual(matchArgs?.groups?.package, "pkg");
		assert.strictEqual(matchArgs?.groups?.function, "fun");

		const matchUnsafeInnerFunction = matchRunnable("pkg::fun(fun())");
		assert.strictEqual(matchUnsafeInnerFunction, null);

		const matchUnsafeSemicolon = matchRunnable("pkg::fun({1 + 2; 3 + 4})");
		assert.strictEqual(matchUnsafeSemicolon, null);

		const matchUnsafeTripleColon = matchRunnable("pkg:::fun()");
		assert.strictEqual(matchUnsafeTripleColon, null);
	});
});
