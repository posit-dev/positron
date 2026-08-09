/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createLazyDriverLogger, IDriverLogChannel } from '../../../common/positron/extHostDataConnectionsLogging.js';

/**
 * Builds a fake channel plus a factory that records how many channels were created and under
 * what names, so the tests can assert on creation without an extension host.
 */
function createRecordingFactory() {
	const names: string[] = [];
	const messages: string[] = [];
	let disposed = 0;
	const factory = (name: string): IDriverLogChannel => {
		names.push(name);
		return {
			trace: message => messages.push(`trace: ${message}`),
			debug: message => messages.push(`debug: ${message}`),
			info: message => messages.push(`info: ${message}`),
			warn: message => messages.push(`warn: ${message}`),
			error: message => messages.push(`error: ${message}`),
			dispose: () => { disposed++; },
		};
	};
	return { factory, names, messages, disposeCount: () => disposed };
}

describe('createLazyDriverLogger', () => {
	it('creates no channel until something is logged', () => {
		const { factory, names } = createRecordingFactory();
		createLazyDriverLogger('Snowflake', factory);
		expect(names).toEqual([]);
	});

	it('creates the channel on the first info call, with the composed name', () => {
		const { factory, names, messages } = createRecordingFactory();
		const logger = createLazyDriverLogger('Snowflake', factory);
		logger.info('Connecting');
		expect({ names, messages }).toEqual({
			names: ['Data Connections: Snowflake'],
			messages: ['info: Connecting'],
		});
	});

	it('creates the channel on warn and on error as well', () => {
		const warnFactory = createRecordingFactory();
		createLazyDriverLogger('DuckDB', warnFactory.factory).warn('Careful');
		const errorFactory = createRecordingFactory();
		createLazyDriverLogger('DuckDB', errorFactory.factory).error('Broken');
		expect([warnFactory.names, errorFactory.names]).toEqual([
			['Data Connections: DuckDB'],
			['Data Connections: DuckDB'],
		]);
	});

	it('reuses one channel across many calls', () => {
		const { factory, names } = createRecordingFactory();
		const logger = createLazyDriverLogger('SQLite', factory);
		logger.info('One');
		logger.info('Two');
		logger.error('Three');
		expect(names).toEqual(['Data Connections: SQLite']);
	});

	it('drops trace and debug before the channel exists, and creates nothing', () => {
		const { factory, names, messages } = createRecordingFactory();
		const logger = createLazyDriverLogger('PostgreSQL', factory);
		logger.trace('GET /one');
		// eslint-disable-next-line testing-library/no-debugging-utils -- this is DataConnectionLogger.debug, not screen.debug()
		logger.debug('Something');
		expect({ names, messages }).toEqual({ names: [], messages: [] });
	});

	it('writes trace to the channel once info has created it', () => {
		const { factory, names, messages } = createRecordingFactory();
		const logger = createLazyDriverLogger('PostgreSQL', factory);
		logger.info('Connecting');
		logger.trace('SELECT 1');
		expect({ names, messages }).toEqual({
			names: ['Data Connections: PostgreSQL'],
			messages: ['info: Connecting', 'trace: SELECT 1'],
		});
	});

	it('disposing before creation is a no-op and disposing after creation disposes the channel', () => {
		const never = createRecordingFactory();
		createLazyDriverLogger('Databricks', never.factory).dispose();

		const created = createRecordingFactory();
		const logger = createLazyDriverLogger('Databricks', created.factory);
		logger.info('Connecting');
		logger.dispose();

		expect([never.disposeCount(), created.disposeCount()]).toEqual([0, 1]);
	});
});
