/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IDataConnectionDriverMetadata, IDataConnectionMechanism, resolveDataConnectionMechanism } from '../../common/interfaces/dataConnectionDriver.js';

function mechanism(id: string): IDataConnectionMechanism {
	return { id, label: id, description: '', parameters: [] };
}

function metadata(...mechanisms: IDataConnectionMechanism[]): IDataConnectionDriverMetadata {
	return {
		id: 'test-driver',
		name: 'Test Driver',
		description: '',
		iconSvg: '',
		supportedLanguageIds: [],
		mechanisms,
	};
}

describe('resolveDataConnectionMechanism', () => {
	it('resolves an id the driver declares', () => {
		const second = mechanism('second');
		expect(resolveDataConnectionMechanism(metadata(mechanism('first'), second), 'second')).toBe(second);
	});

	it('falls back to the first mechanism for a profile saved before mechanisms existed', () => {
		const first = mechanism('first');
		expect(resolveDataConnectionMechanism(metadata(first, mechanism('second')), undefined)).toBe(first);
	});

	it('returns undefined for an id the driver no longer declares', () => {
		// The alternative -- falling back to the first mechanism -- would silently reconnect the
		// profile through a mechanism the user never chose, using whatever credentials that one
		// resolves. Callers get undefined so they can tell the user to set the connection up again.
		expect(resolveDataConnectionMechanism(metadata(mechanism('first')), 'removed')).toBeUndefined();
	});

	it('returns undefined when the driver declares no mechanisms', () => {
		expect(resolveDataConnectionMechanism(metadata(), undefined)).toBeUndefined();
		expect(resolveDataConnectionMechanism(metadata(), 'anything')).toBeUndefined();
	});
});
