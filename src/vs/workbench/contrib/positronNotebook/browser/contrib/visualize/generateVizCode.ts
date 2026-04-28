/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export type VizLibrary = 'plotly' | 'matplotlib' | 'seaborn';
export type ChartType = 'bar' | 'line' | 'scatter' | 'histogram';

export interface VizAnswers {
	library: VizLibrary;
	chartType: ChartType;
	dfName: string;
	x: string;
	y?: string;
}

export interface CodeSnippet {
	imports: string;
	body: string;
}

const SEABORN_FN: Record<ChartType, string> = {
	bar: 'barplot',
	line: 'lineplot',
	scatter: 'scatterplot',
	histogram: 'histplot',
};

const MATPLOTLIB_IMPORT = 'import matplotlib.pyplot as plt';

/**
 * Safely quote a string as a Python literal using double quotes.
 * Escapes backslashes, double quotes, newlines, carriage returns, and tabs.
 * Keeps the output compact and side-effect-free; the caller is responsible
 * for passing a single column/value, not arbitrary untrusted text.
 */
export function pythonString(value: string): string {
	const escaped = value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
	return `"${escaped}"`;
}

/**
 * Check that a user-provided dataframe expression is safe to interpolate as a
 * Python reference. Accepts bare identifiers and conservative dotted / bracketed
 * access chains such as `df`, `self.data`, `frames["main"]`. Rejects anything
 * with statement delimiters, spaces, or other syntax that would let arbitrary
 * expressions through.
 */
export function isValidDataFrameExpr(expr: string): boolean {
	const trimmed = expr.trim();
	if (trimmed.length === 0) { return false; }
	// Allow only: ident(.ident)* with optional ["literal"] / ['literal'] segments.
	// The first segment must be a bare identifier; subsequent segments can be
	// either .ident or a bracket-with-string-literal access.
	// Identifier rules match Python: leading letter or underscore, then
	// letters / digits / underscores.
	const ident = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
	const bracket = String.raw`\["[^"\\\n]*"\]|\['[^'\\\n]*'\]`;
	const pattern = new RegExp(`^${ident}(\\.${ident}|${bracket})*$`);
	return pattern.test(trimmed);
}

export function generateVizCode(answers: VizAnswers): CodeSnippet {
	const { library, chartType, dfName, x, y } = answers;
	const xLit = pythonString(x);
	const yLit = y ? pythonString(y) : undefined;
	const xAccess = `${dfName}[${xLit}]`;
	const yAccess = yLit ? `${dfName}[${yLit}]` : undefined;

	if (library === 'plotly') {
		const fn = chartType === 'histogram' ? 'histogram' : chartType;
		const yArg = yLit ? `, y=${yLit}` : '';
		return {
			imports: `import plotly.express as px`,
			body: `fig = px.${fn}(${dfName}, x=${xLit}${yArg})\nfig.show()`,
		};
	}

	if (library === 'seaborn') {
		const fn = SEABORN_FN[chartType];
		const yArg = yLit ? `, y=${yLit}` : '';
		return {
			imports: `import seaborn as sns\n${MATPLOTLIB_IMPORT}`,
			body: `sns.${fn}(data=${dfName}, x=${xLit}${yArg})\nplt.show()`,
		};
	}

	// matplotlib
	if (chartType === 'histogram') {
		return {
			imports: MATPLOTLIB_IMPORT,
			body: `plt.hist(${xAccess})\nplt.xlabel(${xLit})\nplt.show()`,
		};
	}
	if (chartType === 'bar') {
		const yExpr = yAccess ?? `${xAccess}.value_counts().values`;
		const xExpr = yAccess ? xAccess : `${xAccess}.value_counts().index`;
		return {
			imports: MATPLOTLIB_IMPORT,
			body: `plt.bar(${xExpr}, ${yExpr})\nplt.xlabel(${xLit})${yLit ? `\nplt.ylabel(${yLit})` : ''}\nplt.show()`,
		};
	}
	const plotFn = chartType === 'line' ? 'plot' : 'scatter';
	const yExpr = yAccess ?? `${dfName}.index`;
	return {
		imports: MATPLOTLIB_IMPORT,
		body: `plt.${plotFn}(${xAccess}, ${yExpr})\nplt.xlabel(${xLit})${yLit ? `\nplt.ylabel(${yLit})` : ''}\nplt.show()`,
	};
}

export function codeSnippetToCellSource(snippet: CodeSnippet): string {
	return `${snippet.imports}\n\n${snippet.body}\n`;
}
