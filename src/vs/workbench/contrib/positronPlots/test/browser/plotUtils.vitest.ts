/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isPlotOriginNavigable } from '../../browser/plotUtils.js';

describe('isPlotOriginNavigable', () => {
	it('returns false when there is no origin or uri', () => {
		expect(isPlotOriginNavigable(undefined)).toBe(false);
		expect(isPlotOriginNavigable({ uri: '' })).toBe(false);
	});

	it('is navigable for text documents (scripts and Quarto)', () => {
		expect(isPlotOriginNavigable({ uri: 'file:///work/analysis.py' })).toBe(true);
		expect(isPlotOriginNavigable({ uri: 'file:///work/analysis.R' })).toBe(true);
		expect(isPlotOriginNavigable({ uri: 'file:///work/report.qmd' })).toBe(true);
		expect(isPlotOriginNavigable({ uri: 'file:///work/report.rmd' })).toBe(true);
	});

	it('is not navigable for notebook documents', () => {
		expect(isPlotOriginNavigable({ uri: 'file:///work/report.ipynb' })).toBe(false);
	});

	it('is not navigable for notebook cell URIs', () => {
		expect(isPlotOriginNavigable({ uri: 'vscode-notebook-cell:///work/report.ipynb#ch0000001' })).toBe(false);
	});
});
