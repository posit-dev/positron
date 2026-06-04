/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../../../base/common/cancellation.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService, NullLogService } from '../../../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { IPositronLMService, StreamResult } from '../../../../../../services/positronLM/common/positronLMService.js';
import { IPositronVariablesService } from '../../../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { CellKind, INotebookTextModel } from '../../../../../notebook/common/notebookCommon.js';
import { GhostCellGenerator } from '../../../../browser/contrib/ghostCell/generation/generator.js';

// A notebook with a single executed Python cell -- enough for buildNotebookLMContext.
function singleCellNotebook(): INotebookTextModel {
	const cell = { cellKind: CellKind.Code, language: 'python', getValue: () => 'x = 1', outputs: [] };
	// eslint-disable-next-line local/code-no-dangerous-type-assertions -- partial mock; only `cells` is read.
	return { cells: [cell] } as unknown as INotebookTextModel;
}

async function* streamOf(...chunks: string[]): AsyncIterable<string> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

describe('GhostCellGenerator', () => {
	const uri = URI.parse('file:///test.ipynb');

	// Per-test streamText behavior; the stub below delegates here so the container
	// can be built once at describe scope while each test supplies its own result.
	let streamTextImpl: (params: unknown) => Promise<StreamResult>;
	const ctx = createTestContainer()
		.stub(ILogService, new NullLogService())
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(IPositronVariablesService, stubInterface<IPositronVariablesService>({ activePositronVariablesInstance: undefined }))
		.stub(IPositronLMService, stubInterface<IPositronLMService>({ streamText: params => streamTextImpl(params) }))
		.build();

	function makeGenerator(streamText: (params: unknown) => Promise<StreamResult>): GhostCellGenerator {
		streamTextImpl = streamText;
		return ctx.instantiationService.createInstance(GhostCellGenerator);
	}

	it.each(['no-providers', 'no-match', 'auth-required'] as const)(
		'returns unavailable with a message when streamText fails with %s',
		async (failure) => {
			const generator = makeGenerator(async () => ({ failure }));
			const outcome = await generator.generate(singleCellNotebook(), uri, 0, CancellationToken.None);
			expect(outcome).toEqual({ kind: 'unavailable', message: expect.any(String) });
		}
	);

	it('returns a suggestion when the stream yields valid XML', async () => {
		const xml = '<suggestion><explanation>Inspect the data</explanation><code>df.head()</code></suggestion>';
		const generator = makeGenerator(async () => ({ stream: streamOf(xml), modelName: 'test-model' }));
		const outcome = await generator.generate(singleCellNotebook(), uri, 0, CancellationToken.None);
		expect(outcome).toMatchObject({
			kind: 'suggestion',
			result: { code: 'df.head()', explanation: 'Inspect the data', language: 'python', modelName: 'test-model' },
		});
	});

	it('stays silent when the model returns no code', async () => {
		const xml = '<suggestion><explanation>Nothing to add</explanation></suggestion>';
		const generator = makeGenerator(async () => ({ stream: streamOf(xml), modelName: 'test-model' }));
		const outcome = await generator.generate(singleCellNotebook(), uri, 0, CancellationToken.None);
		expect(outcome).toEqual({ kind: 'silent' });
	});
});
