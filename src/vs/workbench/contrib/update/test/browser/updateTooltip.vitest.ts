/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IMeteredConnectionService } from '../../../../../platform/meteredConnection/common/meteredConnection.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { State, UpdateType } from '../../../../../platform/update/common/update.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestProductService } from '../../../../test/common/workbenchTestServices.js';
import { UpdateTooltip } from '../../browser/updateTooltip.js';
import { ShowCurrentReleaseNotesActionId } from '../../common/update.js';

describe('UpdateTooltip', () => {
	const executeCommand = vi.fn<(command: string, ...args: unknown[]) => Promise<unknown>>();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IProductService, {
			...TestProductService,
			positronVersion: '2026.07.0',
			version: '1.118.0',
			commit: 'abc1234deadbeef0',
		})
		.stub(ICommandService, { executeCommand })
		.stub(IClipboardService, { writeText: vi.fn() })
		.stub(IMeteredConnectionService, stubInterface<IMeteredConnectionService>({ isConnectionMetered: false }))
		.build();

	function setChannel(value: 'releases' | 'dailies'): void {
		const config = ctx.get(IConfigurationService) as TestConfigurationService;
		config.setUserConfiguration('update.positron.channel', value);
	}

	function fireChannelChange(): void {
		const config = ctx.get(IConfigurationService) as TestConfigurationService;
		config.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({
			affectsConfiguration: key => key === 'update.positron.channel',
		}));
	}

	function createTooltip(): UpdateTooltip {
		const tooltip = ctx.instantiationService.createInstance(UpdateTooltip);
		ctx.disposables.add(tooltip);
		// `toBeVisible()` requires the node to be in the document.
		document.body.appendChild(tooltip.domNode);
		ctx.disposables.add({ dispose: () => tooltip.domNode.remove() });
		return tooltip;
	}

	function getReleaseNotesButton(tooltip: UpdateTooltip): HTMLButtonElement {
		// eslint-disable-next-line no-restricted-syntax -- UpdateTooltip is built with dom.$; CSS class names are its only structural contract.
		const el = tooltip.domNode.querySelector('button.release-notes-button');
		if (!(el instanceof HTMLButtonElement)) {
			throw new Error('release-notes-button not found');
		}
		return el;
	}

	function getActionButton(tooltip: UpdateTooltip): HTMLButtonElement {
		// eslint-disable-next-line no-restricted-syntax -- see getReleaseNotesButton.
		const el = tooltip.domNode.querySelector('button.action-button');
		if (!(el instanceof HTMLButtonElement)) {
			throw new Error('action-button not found');
		}
		return el;
	}

	function getButtonBar(tooltip: UpdateTooltip): HTMLElement {
		// eslint-disable-next-line no-restricted-syntax -- see getReleaseNotesButton.
		const el = tooltip.domNode.querySelector('.button-bar');
		if (!(el instanceof HTMLElement)) {
			throw new Error('button-bar not found');
		}
		return el;
	}

	function getCurrentVersionText(tooltip: UpdateTooltip): string {
		// eslint-disable-next-line no-restricted-syntax -- see getReleaseNotesButton.
		const row = tooltip.domNode.querySelector('.product-version');
		return row?.textContent ?? '';
	}

	beforeEach(() => {
		executeCommand.mockResolvedValue(undefined);
	});

	describe('current version label', () => {
		it('shows the Positron calver, not the Code-OSS base version', () => {
			const tooltip = createTooltip();

			const text = getCurrentVersionText(tooltip);
			expect(text).toContain('2026.07.0');
			expect(text).not.toContain('1.118.0');
			expect(text).toContain('abc1234');
		});
	});

	describe('Release Notes button visibility', () => {
		it('is hidden when the channel is not "releases"', () => {
			setChannel('dailies');
			const tooltip = createTooltip();

			tooltip.renderState(State.Idle(UpdateType.Archive));

			expect(getReleaseNotesButton(tooltip)).not.toBeVisible();
		});

		it('is visible when the channel is "releases" and a version is known', () => {
			setChannel('releases');
			const tooltip = createTooltip();

			tooltip.renderState(State.Idle(UpdateType.Archive));

			expect(getReleaseNotesButton(tooltip)).toBeVisible();
		});

		it('flips visibility when the channel setting changes', () => {
			setChannel('dailies');
			const tooltip = createTooltip();
			tooltip.renderState(State.Idle(UpdateType.Archive));
			expect(getReleaseNotesButton(tooltip)).not.toBeVisible();

			setChannel('releases');
			fireChannelChange();

			expect(getReleaseNotesButton(tooltip)).toBeVisible();
		});
	});

	describe('Release Notes click', () => {
		it('forwards the Positron calver to the release notes command', () => {
			setChannel('releases');
			const tooltip = createTooltip();
			tooltip.renderState(State.Idle(UpdateType.Archive));

			getReleaseNotesButton(tooltip).click();

			expect(executeCommand).toHaveBeenCalledWith(ShowCurrentReleaseNotesActionId, '2026.07.0');
		});
	});

	describe('button bar layout', () => {
		it('stays visible when only the action button is shown', () => {
			setChannel('dailies');
			const tooltip = createTooltip();

			tooltip.renderState(State.AvailableForDownload({ version: '2026.08.0', productVersion: '2026.08.0' }));

			expect(getReleaseNotesButton(tooltip)).not.toBeVisible();
			expect(getActionButton(tooltip)).toBeVisible();
			expect(getButtonBar(tooltip)).toBeVisible();
		});
	});
});
