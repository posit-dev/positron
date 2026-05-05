/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildParamsRCode, extractFrontMatter, toRLiteral } from '../params';

suite('extractFrontMatter', () => {
	test('returns the YAML body for a standard --- delimited block', () => {
		const text = '---\ntitle: Hello\nparams:\n  x: 1\n---\n\n# Body\n';
		assert.strictEqual(extractFrontMatter(text), 'title: Hello\nparams:\n  x: 1');
	});

	test('handles CRLF line endings', () => {
		const text = '---\r\ntitle: Hello\r\n---\r\n\r\nbody';
		assert.strictEqual(extractFrontMatter(text), 'title: Hello');
	});

	test('accepts ... as a closing marker', () => {
		const text = '---\nparams:\n  x: 1\n...\n\nbody';
		assert.strictEqual(extractFrontMatter(text), 'params:\n  x: 1');
	});

	test('strips a leading BOM', () => {
		const text = '\uFEFF---\ntitle: Hello\n---\n';
		assert.strictEqual(extractFrontMatter(text), 'title: Hello');
	});

	test('returns undefined when there is no front matter', () => {
		assert.strictEqual(extractFrontMatter('# Just a body\n'), undefined);
	});

	test('returns undefined when the closing delimiter is missing', () => {
		assert.strictEqual(extractFrontMatter('---\ntitle: Hello\n# body\n'), undefined);
	});
});

suite('toRLiteral', () => {
	test('renders primitives', () => {
		assert.strictEqual(toRLiteral(null), 'NULL');
		assert.strictEqual(toRLiteral(undefined), 'NULL');
		assert.strictEqual(toRLiteral(true), 'TRUE');
		assert.strictEqual(toRLiteral(false), 'FALSE');
		assert.strictEqual(toRLiteral(42), '42');
		assert.strictEqual(toRLiteral(3.14), '3.14');
		assert.strictEqual(toRLiteral('hi'), '"hi"');
	});

	test('escapes strings', () => {
		assert.strictEqual(toRLiteral('say "hi"\n'), '"say \\"hi\\"\\n"');
		assert.strictEqual(toRLiteral('back\\slash'), '"back\\\\slash"');
	});

	test('renders Inf, -Inf, NaN', () => {
		assert.strictEqual(toRLiteral(Number.POSITIVE_INFINITY), 'Inf');
		assert.strictEqual(toRLiteral(Number.NEGATIVE_INFINITY), '-Inf');
		assert.strictEqual(toRLiteral(Number.NaN), 'NaN');
	});

	test('renders date-only Date as as.Date', () => {
		assert.strictEqual(toRLiteral(new Date('2024-01-15T00:00:00.000Z')), 'as.Date("2024-01-15")');
	});

	test('renders timestamps as as.POSIXct', () => {
		assert.strictEqual(
			toRLiteral(new Date('2024-01-15T12:34:56.000Z')),
			'as.POSIXct("2024-01-15 12:34:56", tz = "UTC")',
		);
	});

	test('renders homogeneous primitive arrays as c()', () => {
		assert.strictEqual(toRLiteral([1, 2, 3]), 'c(1, 2, 3)');
		assert.strictEqual(toRLiteral(['a', 'b']), 'c("a", "b")');
		assert.strictEqual(toRLiteral([true, false]), 'c(TRUE, FALSE)');
	});

	test('renders mixed or non-primitive arrays as list()', () => {
		assert.strictEqual(toRLiteral([1, 'a']), 'list(1, "a")');
		assert.strictEqual(toRLiteral([1, null, 2]), 'list(1, NULL, 2)');
		assert.strictEqual(toRLiteral([]), 'list()');
		assert.strictEqual(toRLiteral([{ a: 1 }, { a: 2 }]), 'list(list(a = 1), list(a = 2))');
	});

	test('renders objects as named list()', () => {
		assert.strictEqual(toRLiteral({ a: 1, b: 'x' }), 'list(a = 1, b = "x")');
	});

	test('quotes non-syntactic names with backticks', () => {
		assert.strictEqual(toRLiteral({ '1bad': 1 }), 'list(`1bad` = 1)');
		assert.strictEqual(toRLiteral({ 'has space': 1 }), 'list(`has space` = 1)');
		assert.strictEqual(toRLiteral({ 'TRUE': 1 }), 'list(`TRUE` = 1)');
	});
});

suite('buildParamsRCode', () => {
	test('returns undefined for missing front matter', () => {
		assert.strictEqual(buildParamsRCode(undefined), undefined);
	});

	test('returns undefined when YAML has no params key', () => {
		assert.strictEqual(buildParamsRCode('title: Hello'), undefined);
	});

	test('returns undefined when params is null or empty', () => {
		assert.strictEqual(buildParamsRCode('params:'), undefined);
	});

	test('builds a simple params list', () => {
		const code = buildParamsRCode('params:\n  alpha: 0.1\n  region: east');
		assert.strictEqual(
			code,
			'assign("params", list(alpha = 0.1, region = "east"), envir = globalenv())',
		);
	});

	test('unwraps the structured {value, label, ...} form', () => {
		const yaml = [
			'params:',
			'  region:',
			'    label: "Region:"',
			'    value: east',
			'    input: select',
			'    choices: [east, west]',
		].join('\n');
		assert.strictEqual(
			buildParamsRCode(yaml),
			'assign("params", list(region = "east"), envir = globalenv())',
		);
	});

	test('leaves nested objects without a value key intact', () => {
		const yaml = [
			'params:',
			'  thing:',
			'    a: 1',
			'    b: 2',
		].join('\n');
		assert.strictEqual(
			buildParamsRCode(yaml),
			'assign("params", list(thing = list(a = 1, b = 2)), envir = globalenv())',
		);
	});

	test('inlines !r and !expr tagged values as raw R code', () => {
		const yaml = [
			'params:',
			'  today: !r Sys.Date()',
			'  tomorrow: !expr Sys.Date() + 1',
		].join('\n');
		assert.strictEqual(
			buildParamsRCode(yaml),
			'assign("params", list(today = (Sys.Date()), tomorrow = (Sys.Date() + 1)), envir = globalenv())',
		);
	});

	test('inlines !r in the structured form', () => {
		const yaml = [
			'params:',
			'  today:',
			'    label: "Date"',
			'    value: !r Sys.Date()',
		].join('\n');
		assert.strictEqual(
			buildParamsRCode(yaml),
			'assign("params", list(today = (Sys.Date())), envir = globalenv())',
		);
	});

	test('returns undefined for malformed YAML', () => {
		assert.strictEqual(buildParamsRCode('params:\n  : : :'), undefined);
	});

	test('renders YAML date scalars as as.Date()', () => {
		const yaml = 'params:\n  start: 2024-01-15';
		assert.strictEqual(
			buildParamsRCode(yaml),
			'assign("params", list(start = as.Date("2024-01-15")), envir = globalenv())',
		);
	});

	test('renders array of strings as c()', () => {
		const yaml = 'params:\n  regions: [east, west, north]';
		assert.strictEqual(
			buildParamsRCode(yaml),
			'assign("params", list(regions = c("east", "west", "north")), envir = globalenv())',
		);
	});

	test('unwraps a full mixed structured-form params block', () => {
		// Mirrors the example at https://yihui.org/rmarkdown/params-knit
		const yaml = [
			'title: My Document',
			'output: html_document',
			'params:',
			'  year:',
			'    label: "Year"',
			'    value: 2017',
			'    input: slider',
			'    min: 2010',
			'    max: 2018',
			'    step: 1',
			'    sep: ""',
			'  region:',
			'    label: "Region:"',
			'    value: Europe',
			'    input: select',
			'    choices: [North America, Europe, Asia, Africa]',
			'  printcode:',
			'    label: "Display Code:"',
			'    value: TRUE',
			'  data:',
			'    label: "Input dataset:"',
			'    value: results.csv',
			'    input: file',
		].join('\n');
		assert.strictEqual(
			buildParamsRCode(yaml),
			'assign("params", list(year = 2017, region = "Europe", printcode = TRUE, data = "results.csv"), envir = globalenv())',
		);
	});
});
