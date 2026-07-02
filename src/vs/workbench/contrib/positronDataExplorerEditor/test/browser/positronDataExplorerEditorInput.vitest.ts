/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { NullLogService } from '../../../../../platform/log/common/log.js';
import { DataExplorerClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { IPositronDataExplorerInstance } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronDataExplorerUri } from '../../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronDataExplorerEditorInput } from '../../browser/positronDataExplorerEditorInput.js';

describe('PositronDataExplorerEditorInput', () => {
	// A valid runtime comm id (UUID) so PositronDataExplorerUri.parse round-trips.
	const commId = '12345678-1234-1234-1234-1234567890ab';

	function makeInput(instance: IPositronDataExplorerInstance | undefined) {
		const service = stubInterface<IPositronDataExplorerService>({
			getInstance: () => instance,
		});
		return new PositronDataExplorerEditorInput(
			PositronDataExplorerUri.generate(commId),
			service,
			new NullLogService(),
		);
	}

	function makeInstance(isInline: boolean) {
		const dispose = vi.fn();
		const instance = stubInterface<IPositronDataExplorerInstance>({
			isInline,
			dataExplorerClientInstance: stubInterface<DataExplorerClientInstance>({ dispose }),
		});
		return { instance, dispose };
	}

	it('disposes the client when closing an editor-owned (non-inline) explorer', () => {
		const { instance, dispose } = makeInstance(false);

		makeInput(instance).dispose();

		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('does NOT dispose the client when closing an inline/embedded explorer (issue #13283)', () => {
		const { instance, dispose } = makeInstance(true);

		makeInput(instance).dispose();

		expect(dispose).not.toHaveBeenCalled();
	});

	it('is a no-op when no instance is registered for the resource', () => {
		// Disposing with no backing instance must not throw.
		expect(() => makeInput(undefined).dispose()).not.toThrow();
	});
});
