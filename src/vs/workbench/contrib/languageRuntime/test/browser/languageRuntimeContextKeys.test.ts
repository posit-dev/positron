/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import {
	POSITRON_RUNTIME_LANGUAGE_IDS,
	PositronRuntimeLanguagesContextKeyContribution,
} from '../../browser/languageRuntimeContextKeys.js';

const makeRuntime = (languageId: string, runtimeId = `${languageId}-1`): ILanguageRuntimeMetadata =>
	({ runtimeId, languageId } as unknown as ILanguageRuntimeMetadata);

suite('PositronRuntimeLanguagesContextKeyContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let registeredRuntimes: ILanguageRuntimeMetadata[];
	let onDidRegisterRuntime: Emitter<ILanguageRuntimeMetadata>;
	let contextKeyService: MockContextKeyService;

	setup(() => {
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

	test('initializes the context key from registered runtimes', () => {
		registeredRuntimes = [makeRuntime('r'), makeRuntime('python')];

		makeContribution();

		assert.deepStrictEqual(readKey()?.slice().sort(), ['python', 'r']);
	});

	test('updates the context key when a new runtime registers', () => {
		registeredRuntimes = [makeRuntime('r')];

		makeContribution();
		assert.deepStrictEqual(readKey(), ['r']);

		const pythonRuntime = makeRuntime('python');
		registeredRuntimes = [...registeredRuntimes, pythonRuntime];
		onDidRegisterRuntime.fire(pythonRuntime);

		assert.deepStrictEqual(readKey()?.slice().sort(), ['python', 'r']);
	});
});
