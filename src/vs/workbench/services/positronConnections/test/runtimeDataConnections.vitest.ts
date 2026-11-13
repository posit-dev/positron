/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataConnectionNodeKind } from '../../positronDataConnections/common/interfaces/dataConnectionDriver.js';
import {
	isRuntimeConnectionLanguage,
	isRuntimeDataConnectionDriverId,
	nextRuntimeConnectionHandle,
	runtimeDataConnectionDriverId,
	toDataConnectionNodeKind,
} from '../common/runtimeDataConnections.js';

describe('runtimeDataConnections', () => {
	it('maps contract kinds case-insensitively', () => {
		expect(['catalog', 'Schema', 'database', 'table', 'VIEW', 'field'].map(toDataConnectionNodeKind)).toEqual([
			DataConnectionNodeKind.Catalog, DataConnectionNodeKind.Schema, DataConnectionNodeKind.Database,
			DataConnectionNodeKind.Table, DataConnectionNodeKind.View, DataConnectionNodeKind.Field,
		]);
	});
	it('maps unknown kinds to schema', () => {
		expect(['dataset', 'folder', ''].map(toDataConnectionNodeKind)).toEqual([
			DataConnectionNodeKind.Schema, DataConnectionNodeKind.Schema, DataConnectionNodeKind.Schema,
		]);
	});
	it('recognizes runtime driver ids', () => {
		expect([runtimeDataConnectionDriverId('r'), 'runtime-python', 'sqlite', 'runtime-ggsql'].map(isRuntimeDataConnectionDriverId))
			.toEqual([true, true, false, false]);
	});
	it('keeps only R and Python', () => {
		expect(['r', 'python', 'ggsql', 'test', undefined].map(isRuntimeConnectionLanguage)).toEqual([true, true, false, false, false]);
	});
	it('hands out distinct negative handles', () => {
		const [a, b] = [nextRuntimeConnectionHandle(), nextRuntimeConnectionHandle()];
		expect([a < 0, b < 0, a !== b]).toEqual([true, true, true]);
	});
});
