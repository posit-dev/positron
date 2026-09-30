/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, SessionStartReasonId } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeSessionCard } from '../../browser/components/runtimeSessionCard.js';

describe('RuntimeSessionCard', () => {
	const rtl = setupRTLRenderer();

	function renderCard(detail: string, id?: SessionStartReasonId) {
		const session = stubInterface<ILanguageRuntimeSession>({
			metadata: {
				sessionId: 'python-1',
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: detail,
				startReasonId: id,
			},
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				runtimeName: 'Python 3.12',
				runtimeId: 'python-runtime-1',
				runtimeDisplayPath: '/usr/bin/python3',
				extensionId: new ExtensionIdentifier('positron.positron-python'),
				base64EncodedIconSvg: undefined,
			}),
			clientInstances: [],
			getRuntimeState: () => RuntimeState.Idle,
			onDidChangeRuntimeState: Event.None,
		});

		// The card renders a table row.
		rtl.render(
			<table>
				<tbody>
					<RuntimeSessionCard session={session} />
				</tbody>
			</table>
		);
	}

	it('shows the start reason detail and ID', () => {
		renderCard('This workspace\'s last used interpreter was started when Positron started (language: python)', SessionStartReasonId.AffiliatedRuntime);

		// The detail already starts with the English label, so the label is
		// not shown separately.
		expect(screen.getAllByText(/Start Reason/).map(el => el.textContent)).toEqual([
			'Start Reason: This workspace\'s last used interpreter was started when Positron started (language: python)',
			'Start Reason ID: affiliatedRuntime',
		]);
	});

	it('shows only the detail when the session has no start reason ID', () => {
		renderCard('Affiliated Python runtime for workspace');

		expect(screen.getAllByText(/Start Reason/).map(el => el.textContent)).toEqual([
			'Start Reason: Affiliated Python runtime for workspace',
		]);
	});
});
