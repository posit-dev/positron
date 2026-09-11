/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { DATA_IMPORTER_ACTIVATION_EVENT, IDataImporter, IDataImportRequest, IDataImportResult } from '../../common/positronDataImporterRegistry.js';
import { PositronDataImporterRegistry } from '../../browser/positronDataImporterRegistry.js';

/** Records which activation events were fired, so activation can be asserted on. */
const activatedEvents: string[] = [];

function makeImporter(overrides: Partial<IDataImporter> = {}): IDataImporter {
	return {
		languageId: 'python',
		displayName: 'Python (pandas)',
		fileExtensions: ['csv', 'tsv'],
		reservedNames: ['class', 'import'],
		generateCode: async (request: IDataImportRequest): Promise<IDataImportResult | undefined> =>
			({ code: `${request.variableName} = load(${request.fileUri.fsPath})` }),
		...overrides
	};
}

describe('PositronDataImporterRegistry', () => {
	const ctx = createTestContainer()
		.stub(IExtensionService, {
			activateByEvent: async (event: string) => { activatedEvents.push(event); }
		})
		.build();

	beforeEach(() => {
		activatedEvents.length = 0;
	});

	function createRegistry(): PositronDataImporterRegistry {
		return ctx.disposables.add(ctx.instantiationService.createInstance(PositronDataImporterRegistry));
	}

	it('returns a registered importer for a matching file extension', async () => {
		const registry = createRegistry();
		const importer = makeImporter();
		ctx.disposables.add(registry.registerImporter(importer));

		expect(await registry.getImporters('csv')).toEqual([importer]);
	});

	it('matches a file extension regardless of leading dot or case', async () => {
		const registry = createRegistry();
		const importer = makeImporter({ fileExtensions: ['CSV'] });
		ctx.disposables.add(registry.registerImporter(importer));

		expect(await registry.getImporters('.csv')).toEqual([importer]);
		expect(await registry.getImporters('Csv')).toEqual([importer]);
	});

	it('returns nothing for an unmatched file extension', async () => {
		const registry = createRegistry();
		ctx.disposables.add(registry.registerImporter(makeImporter({ fileExtensions: ['csv'] })));

		expect(await registry.getImporters('xlsx')).toEqual([]);
	});

	it('returns every matching importer sorted by display name', async () => {
		const registry = createRegistry();
		// Registered in reverse alphabetical order, so registration order cannot pass this by chance.
		for (const displayName of ['R (readr)', 'Python (polars)', 'Python (pandas)']) {
			ctx.disposables.add(registry.registerImporter(makeImporter({ displayName })));
		}

		expect((await registry.getImporters('csv')).map(i => i.displayName))
			.toEqual(['Python (pandas)', 'Python (polars)', 'R (readr)']);
	});

	it('drops an importer once its registration is disposed', async () => {
		const registry = createRegistry();
		const registration = registry.registerImporter(makeImporter());
		registration.dispose();

		expect(await registry.getImporters('csv')).toEqual([]);
	});

	it('fires the import activation event before answering a query', async () => {
		const registry = createRegistry();

		await registry.getImporters('csv');

		expect(activatedEvents).toEqual([DATA_IMPORTER_ACTIVATION_EVENT]);
	});

	it('keeps a registered generateCode reachable through the registry', async () => {
		const registry = createRegistry();
		ctx.disposables.add(registry.registerImporter(makeImporter()));

		const [importer] = await registry.getImporters('csv');
		const result = await importer.generateCode({
			fileUri: URI.file('/data/flights.csv'),
			variableName: 'flights',
			options: { hasHeaderRow: true }
		});

		expect(result?.code).toBe('flights = load(/data/flights.csv)');
	});

	it('exposes the importer reserved names to callers, so the dialog can derive a default', async () => {
		const registry = createRegistry();
		ctx.disposables.add(registry.registerImporter(makeImporter()));

		const [importer] = await registry.getImporters('csv');
		expect(importer.reservedNames).toEqual(['class', 'import']);
	});

	it('accepts an importer that declares no reserved names', async () => {
		const registry = createRegistry();
		ctx.disposables.add(registry.registerImporter(makeImporter({ reservedNames: undefined })));

		const [importer] = await registry.getImporters('csv');
		expect(importer.reservedNames).toBeUndefined();
	});
});
