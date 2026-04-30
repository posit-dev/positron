/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ILocalExtension } from '../../../../../platform/extensionManagement/common/extensionManagement.js';
import { IExtension as IPlatformExtension } from '../../../../../platform/extensions/common/extensions.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IWorkbenchExtensionEnablementService } from '../../../../services/extensionManagement/common/extensionManagement.js';
import { IExtension, IExtensionsWorkbenchService } from '../../../extensions/common/extensions.js';
import { PositAssistantContextKeyContribution } from '../../browser/positAssistant.contribution.js';
import { POSIT_ASSISTANT_AVAILABLE, POSIT_ASSISTANT_EXTENSION_ID } from '../../common/positAssistantContextKeys.js';

describe('PositAssistantContextKeyContribution', () => {
	const disposables = ensureNoLeakedDisposables();

	function makeExtension(id: string, isInstalled: boolean): IExtension {
		return stubInterface<IExtension>({
			identifier: { id },
			local: isInstalled ? stubInterface<ILocalExtension>() : undefined,
		});
	}

	interface SetupOptions {
		installedExtensions?: IExtension[];
		isEnabled?: (extension: IPlatformExtension) => boolean;
	}

	function setup({ installedExtensions = [], isEnabled = () => true }: SetupOptions = {}) {
		const contextKeyService = new MockContextKeyService();
		// `localExtensions` is shared with the stub via reference identity:
		// `extensionsWorkbenchService.local` returns the same array the test
		// pushes/splices to simulate installs and uninstalls.
		const localExtensions: IExtension[] = [...installedExtensions];
		const onChange = disposables.add(new Emitter<IExtension | undefined>());
		const onEnablementChanged = disposables.add(new Emitter<readonly IExtension[]>());

		const extensionsWorkbenchService = stubInterface<IExtensionsWorkbenchService>({
			queryLocal: async () => localExtensions,
			onChange: onChange.event,
			local: localExtensions,
		});
		const extensionEnablementService = stubInterface<IWorkbenchExtensionEnablementService>({
			onEnablementChanged: onEnablementChanged.event,
			isEnabled,
		});

		const contribution = disposables.add(new PositAssistantContextKeyContribution(
			contextKeyService,
			extensionsWorkbenchService,
			extensionEnablementService,
			new NullLogService(),
		));

		return {
			contribution,
			localExtensions,
			onChange,
			onEnablementChanged,
			getValue: () => contextKeyService.getContextKeyValue<boolean>(POSIT_ASSISTANT_AVAILABLE.key),
		};
	}

	it('is unavailable when posit.assistant is not installed', async () => {
		const { contribution, getValue } = setup();
		await contribution.whenInitialized;

		expect(getValue()).toBe(false);
	});

	it('is available when posit.assistant is installed and enabled', async () => {
		const { contribution, getValue } = setup({
			installedExtensions: [makeExtension(POSIT_ASSISTANT_EXTENSION_ID, true)],
			isEnabled: () => true,
		});
		await contribution.whenInitialized;

		expect(getValue()).toBe(true);
	});

	it('is unavailable when posit.assistant is installed but disabled', async () => {
		const { contribution, getValue } = setup({
			installedExtensions: [makeExtension(POSIT_ASSISTANT_EXTENSION_ID, true)],
			isEnabled: () => false,
		});
		await contribution.whenInitialized;

		expect(getValue()).toBe(false);
	});

	it('flips when extension enablement state changes', async () => {
		let enabled = true;
		const { contribution, onEnablementChanged, getValue } = setup({
			installedExtensions: [makeExtension(POSIT_ASSISTANT_EXTENSION_ID, true)],
			isEnabled: () => enabled,
		});
		await contribution.whenInitialized;
		expect(getValue()).toBe(true);

		enabled = false;
		onEnablementChanged.fire([]);
		expect(getValue()).toBe(false);

		enabled = true;
		onEnablementChanged.fire([]);
		expect(getValue()).toBe(true);
	});

	it('updates when posit.assistant is added via onChange', async () => {
		const { contribution, localExtensions, onChange, getValue } = setup();
		await contribution.whenInitialized;
		expect(getValue()).toBe(false);

		const positExtension = makeExtension(POSIT_ASSISTANT_EXTENSION_ID, true);
		localExtensions.push(positExtension);
		onChange.fire(positExtension);

		expect(getValue()).toBe(true);
	});

	it('ignores onChange events for unrelated extensions', async () => {
		const { contribution, localExtensions, onChange, getValue } = setup();
		await contribution.whenInitialized;

		// Add posit.assistant to local but only fire onChange for an unrelated extension.
		// The filter should skip the update; the value should stay false.
		localExtensions.push(makeExtension(POSIT_ASSISTANT_EXTENSION_ID, true));
		onChange.fire(makeExtension('some.other.extension', true));
		expect(getValue()).toBe(false);

		// Sanity: firing onChange for posit.assistant does run the update.
		onChange.fire(makeExtension(POSIT_ASSISTANT_EXTENSION_ID, true));
		expect(getValue()).toBe(true);
	});
});
