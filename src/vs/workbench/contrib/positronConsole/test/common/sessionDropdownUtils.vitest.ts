/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { buildSessionDropdownRuntimes } from '../../common/sessionDropdownUtils.js';

function makeSession(runtimeId: string, lastUsed: number): ILanguageRuntimeSession {
	return stubInterface<ILanguageRuntimeSession>({
		lastUsed,
		runtimeMetadata: makeRuntime(runtimeId),
	});
}

function makeRuntime(runtimeId: string): ILanguageRuntimeMetadata {
	return stubInterface<ILanguageRuntimeMetadata>({ runtimeId, runtimeName: runtimeId });
}

function ids(runtimes: ILanguageRuntimeMetadata[]): string[] {
	return runtimes.map(r => r.runtimeId);
}

describe('buildSessionDropdownRuntimes', () => {
	it('returns only the foreground runtime when activeSessions is empty', () => {
		const foreground = makeRuntime('r-1');
		expect(ids(buildSessionDropdownRuntimes(foreground, []))).toEqual(['r-1']);
	});

	it('sorts remaining sessions by lastUsed descending after the foreground', () => {
		const foreground = makeRuntime('r-foreground');
		const sessions = [
			makeSession('r-oldest', 10),
			makeSession('r-newest', 300),
			makeSession('r-middle', 100),
		];
		expect(ids(buildSessionDropdownRuntimes(foreground, sessions))).toEqual([
			'r-foreground', 'r-newest', 'r-middle', 'r-oldest',
		]);
	});

	it('deduplicates by runtimeId, keeping the most recently used occurrence', () => {
		const sessions = [
			makeSession('py', 100),
			makeSession('py', 200),
		];
		expect(ids(buildSessionDropdownRuntimes(undefined, sessions))).toEqual(['py']);
	});

	it('excludes the foreground runtimeId from remaining sessions before prepending it', () => {
		const foreground = makeRuntime('r-1');
		const sessions = [
			makeSession('r-1', 500),
			makeSession('r-2', 100),
		];
		expect(ids(buildSessionDropdownRuntimes(foreground, sessions))).toEqual(['r-1', 'r-2']);
	});
});
