/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { MenuId, MenuRegistry, isIMenuItem } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { ClearPackageMetadataCacheAction } from '../../browser/positronPackagesDeveloperActions.js';
import { IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

describe('clear package metadata cache action', () => {
	const ctx = createTestContainer().build();

	let info: ReturnType<typeof vi.fn<(message: string) => void>>;

	/** Wires the services the action reads, with `instances` as what is running. */
	function stubServices(instances: IPositronPackagesInstance[]): void {
		info = vi.fn<(message: string) => void>();
		ctx.instantiationService.stub(IPositronPackagesService, stubInterface<IPositronPackagesService>({
			getInstances: () => instances,
		}));
		ctx.instantiationService.stub(INotificationService, stubInterface<INotificationService>({
			info: info as unknown as INotificationService['info'],
		}));
	}

	/** A packages instance that records whether its metadata was cleared. */
	function createInstance(): IPositronPackagesInstance {
		return stubInterface<IPositronPackagesInstance>({ clearMetadata: vi.fn() });
	}

	async function runAction(): Promise<void> {
		await ctx.instantiationService.invokeFunction(accessor => new ClearPackageMetadataCacheAction().run(accessor));
	}

	it('clears every running session, not just the foreground one', async () => {
		// A tester with an R and a Python session running would otherwise clear
		// one and be puzzled by the other still showing indicators.
		const instances = [createInstance(), createInstance()];
		stubServices(instances);

		await runAction();

		for (const instance of instances) {
			expect(instance.clearMetadata).toHaveBeenCalledTimes(1);
		}
	});

	it('confirms it ran, since clearing a cache shows nothing by itself', async () => {
		stubServices([createInstance()]);

		await runAction();

		expect(info).toHaveBeenCalledWith(expect.stringContaining('Cleared cached package metadata'));
	});

	it('says so rather than silently doing nothing when no session is running', async () => {
		// The cache is per-session, so with none running there is nothing to
		// clear -- which looks identical to the command having failed.
		stubServices([]);

		await runAction();

		expect(info).toHaveBeenCalledWith(expect.stringContaining('No interpreter sessions are running'));
	});

	it('is not advertised to AI agents', () => {
		// It throws away a cache and posts a notification -- a debugging act, not
		// something an agent should be able to reach for. Discovery keys off
		// metadata.agentCompatible, which registerAction2 never sets on its own.
		expect(CommandsRegistry.getCommand('positronPackages.clearMetadataCache')?.metadata?.agentCompatible).toBeFalsy();
	});

	it('is offered in the Command Palette under Developer while the Packages pane is enabled', () => {
		const item = MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.find(menuItem => menuItem.command.id === 'positronPackages.clearMetadataCache');

		// Developer category: it costs the next refresh a network round trip, so
		// it shouldn't sit next to the ordinary Packages commands.
		expect(item?.command.category).toMatchObject({ original: 'Developer' });
		expect(item?.command.precondition?.serialize())
			.toBe('config.packages.enabled && config.positron.packages.enable');
	});
});
