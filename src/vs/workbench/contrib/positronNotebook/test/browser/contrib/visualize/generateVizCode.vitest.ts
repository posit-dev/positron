/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	codeSnippetToCellSource,
	generateVizCode,
	isValidDataFrameExpr,
	pythonString,
	VizAnswers,
} from '../../../../browser/contrib/visualize/generateVizCode.js';

describe('generateVizCode', () => {
	describe('pythonString', () => {
		it('wraps plain text in double quotes', () => {
			expect(pythonString('price')).toBe('"price"');
		});

		it('escapes embedded double quotes', () => {
			expect(pythonString(`customer's "price"`)).toBe(`"customer's \\"price\\""`);
		});

		it('escapes backslashes, newlines, tabs, and carriage returns', () => {
			expect(pythonString('a\\b\nc\td\re')).toBe('"a\\\\b\\nc\\td\\re"');
		});
	});

	describe('isValidDataFrameExpr', () => {
		it('accepts bare identifiers', () => {
			expect(isValidDataFrameExpr('df')).toBe(true);
			expect(isValidDataFrameExpr('my_frame')).toBe(true);
			expect(isValidDataFrameExpr('_DF')).toBe(true);
		});

		it('accepts dotted attribute paths', () => {
			expect(isValidDataFrameExpr('self.data')).toBe(true);
			expect(isValidDataFrameExpr('obj.nested.frame')).toBe(true);
		});

		it('accepts bracket access with string literal', () => {
			expect(isValidDataFrameExpr('frames["main"]')).toBe(true);
			expect(isValidDataFrameExpr(`frames['main']`)).toBe(true);
		});

		it('rejects invalid expressions', () => {
			expect(isValidDataFrameExpr('1df')).toBe(false);
			expect(isValidDataFrameExpr('df; import os')).toBe(false);
			expect(isValidDataFrameExpr('df()')).toBe(false);
			expect(isValidDataFrameExpr('df + 1')).toBe(false);
			expect(isValidDataFrameExpr('')).toBe(false);
			expect(isValidDataFrameExpr('   ')).toBe(false);
			expect(isValidDataFrameExpr('df[0]')).toBe(false); // must be string literal, not int index
		});
	});

	describe('library-specific templates', () => {
		const base: VizAnswers = { library: 'plotly', chartType: 'bar', dfName: 'df', x: 'price', y: 'qty' };

		it('plotly bar with x and y', () => {
			const snippet = generateVizCode({ ...base, library: 'plotly', chartType: 'bar' });
			expect(snippet.imports).toContain('plotly.express');
			expect(snippet.body).toBe(`fig = px.bar(df, x="price", y="qty")\nfig.show()`);
		});

		it('plotly histogram includes y when provided', () => {
			const snippet = generateVizCode({ ...base, library: 'plotly', chartType: 'histogram' });
			expect(snippet.body).toBe(`fig = px.histogram(df, x="price", y="qty")\nfig.show()`);
		});

		it('seaborn uses an explicit chart-type function mapping', () => {
			const hist = generateVizCode({ ...base, library: 'seaborn', chartType: 'histogram' });
			expect(hist.body.startsWith('sns.histplot(')).toBe(true);
			const scatter = generateVizCode({ ...base, library: 'seaborn', chartType: 'scatter' });
			expect(scatter.body.startsWith('sns.scatterplot(')).toBe(true);
		});

		it('matplotlib bar with y uses explicit axes', () => {
			const snippet = generateVizCode({ ...base, library: 'matplotlib', chartType: 'bar' });
			expect(snippet.body).toContain(`plt.bar(df["price"], df["qty"])`);
			expect(snippet.body).toContain('plt.xlabel("price")');
			expect(snippet.body).toContain('plt.ylabel("qty")');
		});

		it('matplotlib bar without y uses value_counts()', () => {
			const snippet = generateVizCode({ ...base, library: 'matplotlib', chartType: 'bar', y: undefined });
			expect(snippet.body).toContain('value_counts().values');
			expect(snippet.body).toContain('value_counts().index');
		});

		it('matplotlib scatter without y falls back to the index', () => {
			const snippet = generateVizCode({ ...base, library: 'matplotlib', chartType: 'scatter', y: undefined });
			expect(snippet.body).toContain(`plt.scatter(df["price"], df.index)`);
		});

		it('matplotlib histogram uses plt.hist', () => {
			const snippet = generateVizCode({ ...base, library: 'matplotlib', chartType: 'histogram', y: undefined });
			expect(snippet.body.startsWith('plt.hist(df["price"])')).toBe(true);
		});
	});

	describe('column-name safety', () => {
		it('quotes a column with a space', () => {
			const snippet = generateVizCode({
				library: 'plotly', chartType: 'bar', dfName: 'df', x: 'total sales', y: 'region',
			});
			expect(snippet.body).toContain(`x="total sales"`);
			expect(snippet.body).toContain(`y="region"`);
		});

		it('escapes a column name with a quote', () => {
			const snippet = generateVizCode({
				library: 'matplotlib', chartType: 'histogram', dfName: 'df', x: `customer's "age"`,
			});
			expect(snippet.body).toContain(`df["customer's \\"age\\""]`);
		});

		it('supports dotted dataframe references', () => {
			const snippet = generateVizCode({
				library: 'plotly', chartType: 'bar', dfName: 'self.data', x: 'a', y: 'b',
			});
			expect(snippet.body).toContain(`px.bar(self.data, x="a", y="b")`);
		});
	});

	describe('codeSnippetToCellSource', () => {
		it('joins imports and body with a blank line and trailing newline', () => {
			const result = codeSnippetToCellSource({ imports: 'import x', body: 'x.do()' });
			expect(result).toBe('import x\n\nx.do()\n');
		});
	});
});
