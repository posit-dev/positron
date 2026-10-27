/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Node modules are fine here: this guard reads source files, it doesn't run in a browser.
// eslint-disable-next-line local/code-import-patterns
import * as fs from 'fs';
// eslint-disable-next-line local/code-import-patterns
import * as path from 'path';
import { ILanguageRuntimeService } from '../../workbench/services/languageRuntime/common/languageRuntimeService.js';
import { createLightTestContainer } from './lightTestContainer.js';

describe('lightTestContainer', () => {

	describe('bare', () => {
		const ctx = createLightTestContainer()
			.stub(ILanguageRuntimeService, { registeredRuntimes: [] })
			.build();

		it('registers only user stubs', () => {
			expect(ctx.get(ILanguageRuntimeService).registeredRuntimes).toEqual([]);
		});
	});

	describe('withRuntimeServices', () => {
		const ctx = createLightTestContainer().withRuntimeServices().build();

		it('wires the runtime services', () => {
			expect(ctx.get(ILanguageRuntimeService).registeredRuntimes).toEqual([]);
		});
	});
});

describe('positronTestContainer importers', () => {
	const HEAVY_PRESET = /\.with(Workbench|Notebook|NotebookEditor|React|Contribution)Services\(/;

	it('use a heavy preset, or import lightTestContainer instead', () => {
		const srcVs = path.resolve(__dirname, '../..');
		const offenders = (fs.readdirSync(srcVs, { recursive: true }) as string[])
			.filter(file => /\.vitest\.tsx?$/.test(file))
			.filter(file => {
				const text = fs.readFileSync(path.join(srcVs, file), 'utf8');
				return text.includes('/positronTestContainer.js\'') && !HEAVY_PRESET.test(text);
			});

		// The full builder imports the Notebook and Workbench presets (~7s per
		// file); a file that only needs Bare or Runtime should not pay for them.
		expect(offenders, 'Use createLightTestContainer() from lightTestContainer.ts in these files').toEqual([]);
	});
});
