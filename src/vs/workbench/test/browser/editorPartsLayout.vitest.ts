/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { holdStoredEditorLayout, isStoredEditorLayoutHeld } from '../../browser/positronEditorPartsLayout.js';

describe('holdStoredEditorLayout', () => {
	it('holds until every holder releases', () => {
		expect(isStoredEditorLayoutHeld()).toBe(false);
		const first = holdStoredEditorLayout();
		const second = holdStoredEditorLayout();
		first.dispose();
		expect(isStoredEditorLayoutHeld()).toBe(true);
		second.dispose();
		expect(isStoredEditorLayoutHeld()).toBe(false);
	});
});
