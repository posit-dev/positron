/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { buildQuartoCellInsertion } from '../../browser/quartoInsertion.js';

describe('buildQuartoCellInsertion', () => {
	it('wraps code with blank lines on both sides when surrounded by prose', () => {
		expect(buildQuartoCellInsertion('df <- 1', 'r', false, false))
			.toMatchInlineSnapshot(`
				"

				\`\`\`{r}
				df <- 1
				\`\`\`

				"
			`);
	});

	it('omits leading blank line when the cursor is on an empty line', () => {
		expect(buildQuartoCellInsertion('df <- 1', 'r', true, false))
			.toMatchInlineSnapshot(`
				"
				\`\`\`{r}
				df <- 1
				\`\`\`

				"
			`);
	});

	it('omits trailing blank line when the next line is empty or EOF', () => {
		expect(buildQuartoCellInsertion('df <- 1', 'r', false, true))
			.toMatchInlineSnapshot(`
				"

				\`\`\`{r}
				df <- 1
				\`\`\`
				"
			`);
	});
});
