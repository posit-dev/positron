/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { isNavigableSourceUri } from '../../browser/plotUtils.js';

describe('isNavigableSourceUri', () => {
	it('is navigable for text documents (scripts and Quarto)', () => {
		expect(isNavigableSourceUri(URI.parse('file:///work/analysis.py'))).toBe(true);
		expect(isNavigableSourceUri(URI.parse('file:///work/analysis.R'))).toBe(true);
		expect(isNavigableSourceUri(URI.parse('file:///work/report.qmd'))).toBe(true);
		expect(isNavigableSourceUri(URI.parse('file:///work/report.rmd'))).toBe(true);
	});

	it('is not navigable for notebook documents', () => {
		expect(isNavigableSourceUri(URI.parse('file:///work/report.ipynb'))).toBe(false);
	});

	it('is not navigable for notebook cell URIs', () => {
		expect(isNavigableSourceUri(URI.parse('vscode-notebook-cell:///work/report.ipynb#ch0000001'))).toBe(false);
	});
});
