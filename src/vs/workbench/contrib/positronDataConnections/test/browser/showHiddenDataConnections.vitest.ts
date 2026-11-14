/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { showHiddenDataConnections } from '../../browser/showHiddenDataConnections.js';

describe('show hidden data connections', () => {
	function createHidden(id: string): IDataConnectionProfile {
		return {
			id,
			connectionName: `${id}-name`,
			description: `${id}-description`,
			driverMetadata: { id: 'test-driver', name: 'Test Driver', iconSvg: '', supportedLanguageIds: ['r'] },
			mechanismId: 'test-mechanism',
			parameterValues: {},
		};
	}

	function setup(hidden: IDataConnectionProfile[], pickResult: unknown) {
		const unhideDiscoveredProfiles = vi.fn();
		const pick = vi.fn(async () => pickResult);
		const info = vi.fn();
		const service = stubInterface<IPositronDataConnectionsService>({
			getHiddenDiscoveredProfiles: vi.fn(() => hidden),
			unhideDiscoveredProfiles,
		});
		const quickInput = stubInterface<IQuickInputService>({ pick: pick as unknown as IQuickInputService['pick'] });
		const notifications = stubInterface<INotificationService>({ info });
		return { service, quickInput, notifications, unhideDiscoveredProfiles, pick, info };
	}

	it('tells the user when nothing is hidden', async () => {
		const t = setup([], undefined);

		await showHiddenDataConnections(t.service, t.quickInput, t.notifications);

		expect(t.info).toHaveBeenCalledWith('No data connections are hidden.');
		expect(t.pick).not.toHaveBeenCalled();
	});

	it('offers each hidden connection and shows the ones picked', async () => {
		const hidden = [createHidden('conn-a'), createHidden('conn-b')];
		const t = setup(hidden, [{ profileId: 'conn-a' }]);

		await showHiddenDataConnections(t.service, t.quickInput, t.notifications);

		expect(t.pick).toHaveBeenCalledWith(
			[
				{ label: 'conn-a-name', description: 'Test Driver', detail: 'conn-a-description', profileId: 'conn-a' },
				{ label: 'conn-b-name', description: 'Test Driver', detail: 'conn-b-description', profileId: 'conn-b' },
			],
			{ canPickMany: true, placeHolder: 'Select the connections to show again' });
		expect(t.unhideDiscoveredProfiles).toHaveBeenCalledWith(['conn-a']);
	});

	it('changes nothing when the pick is cancelled', async () => {
		const t = setup([createHidden('conn-a')], undefined);

		await showHiddenDataConnections(t.service, t.quickInput, t.notifications);

		expect(t.unhideDiscoveredProfiles).not.toHaveBeenCalled();
	});
});
