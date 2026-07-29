/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionCodeVariant, IDataConnectionDriver, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { ConnectDataConnectionWith } from '../../browser/dialogs/connectDataConnectionWith.js';

describe('ConnectDataConnectionWith', () => {
	const ctx = createTestContainer()
		.withReactServices()
		// The variant selector renders a real Monaco code editor (DataConnectionCodeEditor), whose
		// view needs IUserInteractionService to create its DOM focus tracker. Use the real
		// implementation so it wires up to genuine jsdom focus/blur events.
		.stub(IUserInteractionService, new UserInteractionService())
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderer = stubInterface<PositronModalDialogReactRenderer>({ onResize: Event.None });

	const driver = stubInterface<IDataConnectionDriver>({
		id: 'test-driver',
		metadata: {
			id: 'test-driver',
			name: 'Test Driver',
			description: '',
			iconSvg: '',
			mechanisms: [{ id: 'test-mechanism', label: 'Test Mechanism', description: '', parameters: [] }],
			supportedLanguageIds: ['python'],
		},
	});

	const variants: IDataConnectionCodeVariant[] = [
		{ id: 'default', label: 'Default', code: 'conn = connect()\n' },
		{ id: 'sqlalchemy', label: 'SQLAlchemy', code: 'engine = create_engine("x")\n' },
	];

	function createProfile(preferredCodeVariants?: Record<string, string>): IDataConnectionProfile {
		return {
			id: 'conn-1',
			driverMetadata: {
				id: 'test-driver',
				name: 'Test Driver',
				iconSvg: '',
				supportedLanguageIds: ['python'],
			},
			connectionName: 'My Connection',
			mechanismId: 'test-mechanism',
			parameterValues: {},
			preferredCodeVariants,
		};
	}

	function stubDataConnectionsService(profile?: IDataConnectionProfile) {
		const setPreferredCodeVariant = vi.fn();
		ctx.instantiationService.stub(IPositronDataConnectionsService, stubInterface<IPositronDataConnectionsService>({
			getProfile: () => profile,
			setPreferredCodeVariant,
		}));
		return { setPreferredCodeVariant };
	}

	function renderDialog() {
		rtl.render(
			<ConnectDataConnectionWith
				connectionName='My Connection'
				driver={driver}
				generateSecretVariants={async () => []}
				languageId='python'
				mechanismId='test-mechanism'
				profileId='conn-1'
				renderer={renderer}
				variants={variants}
			/>
		);
	}

	it('defaults to the first variant when the profile has no stored preference', () => {
		stubDataConnectionsService(undefined);
		renderDialog();

		expect(screen.getByRole('option', { name: 'Default' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('option', { name: 'SQLAlchemy' })).toHaveAttribute('aria-selected', 'false');
	});

	it('initializes the selected variant from the profile stored preference', () => {
		stubDataConnectionsService(createProfile({ python: 'sqlalchemy' }));
		renderDialog();

		expect(screen.getByRole('option', { name: 'SQLAlchemy' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('option', { name: 'Default' })).toHaveAttribute('aria-selected', 'false');
	});

	it('falls back to the first variant when the stored preference is stale', () => {
		stubDataConnectionsService(createProfile({ python: 'no-longer-offered' }));
		renderDialog();

		expect(screen.getByRole('option', { name: 'Default' })).toHaveAttribute('aria-selected', 'true');
	});

	it('persists the selection when the user picks a different variant', async () => {
		const user = userEvent.setup();
		const { setPreferredCodeVariant } = stubDataConnectionsService(undefined);
		renderDialog();

		await user.click(screen.getByRole('option', { name: 'SQLAlchemy' }));

		expect(screen.getByRole('option', { name: 'SQLAlchemy' })).toHaveAttribute('aria-selected', 'true');
		expect(setPreferredCodeVariant).toHaveBeenCalledWith('conn-1', 'python', 'sqlalchemy');
	});
});
