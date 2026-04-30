/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import {
	POSITRON_RUNTIME_LANGUAGE_IDS,
	PositronRuntimeLanguagesContextKeyContribution,
} from '../../browser/languageRuntimeContextKeys.js';

// Minimal stub for ILanguageRuntimeMetadata; full surface isn't exercised here.
/* eslint-disable local/code-no-dangerous-type-assertions */
const makeRuntime = (languageId: string, runtimeId = `${languageId}-1`): ILanguageRuntimeMetadata =>
	({ runtimeId, languageId } as unknown as ILanguageRuntimeMetadata);
/* eslint-enable local/code-no-dangerous-type-assertions */

describe('PositronRuntimeLanguagesContextKeyContribution', () => {
	const disposables = ensureNoLeakedDisposables();

	let registeredRuntimes: ILanguageRuntimeMetadata[];
	let onDidRegisterRuntime: Emitter<ILanguageRuntimeMetadata>;
	let contextKeyService: MockContextKeyService;

	beforeEach(() => {
		registeredRuntimes = [];
		onDidRegisterRuntime = disposables.add(new Emitter<ILanguageRuntimeMetadata>());
		contextKeyService = new MockContextKeyService();
	});

	const makeContribution = () => {
		const runtimeService: Partial<ILanguageRuntimeService> = {
			get registeredRuntimes() { return registeredRuntimes; },
			onDidRegisterRuntime: onDidRegisterRuntime.event,
		};
		return disposables.add(new PositronRuntimeLanguagesContextKeyContribution(
			contextKeyService,
			runtimeService as ILanguageRuntimeService,
		));
	};

	const readKey = (): string[] | undefined =>
		contextKeyService.getContextKeyValue(POSITRON_RUNTIME_LANGUAGE_IDS.key);

	it('initializes the context key from registered runtimes', () => {
		registeredRuntimes = [makeRuntime('r'), makeRuntime('python')];

		makeContribution();

		expect(readKey()?.slice().sort()).toEqual(['python', 'r']);
	});

	it('updates the context key when a new runtime registers', () => {
		registeredRuntimes = [makeRuntime('r')];

		makeContribution();
		expect(readKey()).toEqual(['r']);

		const pythonRuntime = makeRuntime('python');
		registeredRuntimes = [...registeredRuntimes, pythonRuntime];
		onDidRegisterRuntime.fire(pythonRuntime);

		expect(readKey()?.slice().sort()).toEqual(['python', 'r']);
	});
});
