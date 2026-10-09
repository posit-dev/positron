/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DefaultGutterClickAction } from '../../common/configuration.js';
import { resolveGutterClickGroups } from '../../common/positronGutterClickAction.js';
import { TestRunProfileBitset } from '../../common/testTypes.js';

const groupNames: Record<number, string> = {
	[TestRunProfileBitset.Run]: 'run',
	[TestRunProfileBitset.Debug]: 'debug',
	[TestRunProfileBitset.Coverage]: 'coverage',
};

/**
 * Resolves the click groups for every gutter click setting, using readable group names.
 * With `contextMenu`, a click opens the menu, so its row only decides the Alt icon.
 */
function resolveAll(capabilities: number) {
	const actions = [
		DefaultGutterClickAction.Run,
		DefaultGutterClickAction.Debug,
		DefaultGutterClickAction.Coverage,
		DefaultGutterClickAction.ContextMenu,
	];
	return Object.fromEntries(actions.map(action => {
		const { primary, alternate } = resolveGutterClickGroups(action, capabilities);
		return [action, `${groupNames[primary]} / alt: ${groupNames[alternate]}`];
	}));
}

describe('resolveGutterClickGroups', () => {
	it('keeps the upstream mapping when the controller supports run, debug, and coverage', () => {
		expect(resolveAll(TestRunProfileBitset.Run | TestRunProfileBitset.Debug | TestRunProfileBitset.Coverage)).toMatchInlineSnapshot(`
			{
			  "contextMenu": "run / alt: debug",
			  "debug": "debug / alt: run",
			  "run": "run / alt: debug",
			  "runWithCoverage": "coverage / alt: debug",
			}
		`);
	});

	it('resolves every click to run when the controller only supports run', () => {
		// capabilitiesForTest also reports flag bits alongside the groups
		expect(resolveAll(TestRunProfileBitset.Run | TestRunProfileBitset.HasConfigurable | TestRunProfileBitset.SupportsContinuousRun)).toMatchInlineSnapshot(`
			{
			  "contextMenu": "run / alt: run",
			  "debug": "run / alt: run",
			  "run": "run / alt: run",
			  "runWithCoverage": "run / alt: run",
			}
		`);
	});

	it('keeps coverage and drops the debug alternate when debug is unsupported', () => {
		expect(resolveAll(TestRunProfileBitset.Run | TestRunProfileBitset.Coverage)).toMatchInlineSnapshot(`
			{
			  "contextMenu": "run / alt: run",
			  "debug": "run / alt: run",
			  "run": "run / alt: run",
			  "runWithCoverage": "coverage / alt: coverage",
			}
		`);
	});

	it('falls back from coverage to run but keeps the debug alternate when coverage is unsupported', () => {
		expect(resolveAll(TestRunProfileBitset.Run | TestRunProfileBitset.Debug)).toMatchInlineSnapshot(`
			{
			  "contextMenu": "run / alt: debug",
			  "debug": "debug / alt: run",
			  "run": "run / alt: debug",
			  "runWithCoverage": "run / alt: debug",
			}
		`);
	});
});
