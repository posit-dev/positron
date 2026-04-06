/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { matchRunnable } from '../hyperlink';

describe('Hyperlink', () => {
	it('Runnable R code regex enforces safety rules', async () => {
		const matchSimple = matchRunnable("pkg::fun()");
		expect(matchSimple?.groups?.package).toBe("pkg");
		expect(matchSimple?.groups?.function).toBe("fun");

		const matchArgs = matchRunnable("pkg::fun(1 + 1, 2:5)");
		expect(matchArgs?.groups?.package).toBe("pkg");
		expect(matchArgs?.groups?.function).toBe("fun");

		const matchUnsafeInnerFunction = matchRunnable("pkg::fun(fun())");
		expect(matchUnsafeInnerFunction).toBe(null);

		const matchUnsafeSemicolon = matchRunnable("pkg::fun({1 + 2; 3 + 4})");
		expect(matchUnsafeSemicolon).toBe(null);

		const matchUnsafeTripleColon = matchRunnable("pkg:::fun()");
		expect(matchUnsafeTripleColon).toBe(null);
	});
});
