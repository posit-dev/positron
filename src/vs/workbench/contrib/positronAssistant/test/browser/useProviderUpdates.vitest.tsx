/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { useProviderUpdates } from '../../browser/useProviderUpdates.js';

function source(id: string, signedIn = false): IPositronLanguageModelSource {
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: id, settingName: id },
		supportedOptions: [],
		signedIn,
		defaults: {},
	};
}

const Probe = (props: {
	onConfigChange: (s: IPositronLanguageModelSource) => void;
	onSignedInChange: (id: string, signedIn: boolean) => void;
	onRegistrationsChange?: () => void;
}) => {
	useProviderUpdates(['posit-ai'], props.onConfigChange, props.onSignedInChange, props.onRegistrationsChange);
	return <div>probe</div>;
};

describe('useProviderUpdates', () => {
	const onChange = new Emitter<IPositronLanguageModelSource>();
	const onRegistrations = new Emitter<void>();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronAssistantConfigurationService, {
			onChangeProviderConfig: onChange.event,
			onChangeProviderRegistrations: onRegistrations.event,
		})
		.stub(IAuthenticationService, { onDidChangeSessions: () => ({ dispose() { } }), getSessions: async () => [] })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('invokes onConfigChange for a tracked provider', () => {
		const onConfigChange = vi.fn();
		rtl.render(<Probe onConfigChange={onConfigChange} onSignedInChange={vi.fn()} />);
		expect(screen.getByText('probe')).toBeInTheDocument();
		act(() => onChange.fire(source('posit-ai', true)));
		expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ signedIn: true }));
	});

	it('ignores config changes for untracked providers', () => {
		const onConfigChange = vi.fn();
		rtl.render(<Probe onConfigChange={onConfigChange} onSignedInChange={vi.fn()} />);
		act(() => onChange.fire(source('anthropic-api', true)));
		expect(onConfigChange).not.toHaveBeenCalled();
	});

	it('reports registration changes without filtering on the tracked ids', () => {
		// A provider that has just been registered is not in the tracked list
		// yet, so this signal cannot be filtered the way config changes are.
		const onRegistrationsChange = vi.fn();
		rtl.render(
			<Probe
				onConfigChange={vi.fn()}
				onRegistrationsChange={onRegistrationsChange}
				onSignedInChange={vi.fn()}
			/>
		);
		act(() => onRegistrations.fire());
		expect(onRegistrationsChange).toHaveBeenCalledTimes(1);
	});
});
