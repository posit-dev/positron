/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IPositronNotebookService } from '../../../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance } from '../../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCodeCell, NotebookCellOutputs } from '../../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { MainThreadNotebookFeatures } from '../../../browser/positron/mainThreadNotebookFeatures.js';

const { mockRasterizeSvgToPng } = vi.hoisted(() => ({ mockRasterizeSvgToPng: vi.fn() }));
vi.mock('../../../../contrib/positronNotebook/browser/svgToPng.js', () => ({
	rasterizeSvgToPng: mockRasterizeSvgToPng,
}));

const NOTEBOOK_URI = 'file:///test/notebook.ipynb';
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><circle r="50" /></svg>';
const PNG_BASE64 = 'bW9jay1wbmctZGF0YQ==';

/**
 * Builds a MainThreadNotebookFeatures whose single notebook has one code cell
 * with the given output items.
 */
function createFeatures(outputItems: { mime: string; data: VSBuffer }[]): MainThreadNotebookFeatures {
	const cellOutputs: NotebookCellOutputs[] = [stubInterface<NotebookCellOutputs>({
		outputId: 'output-1',
		outputs: outputItems,
	})];
	const cell = stubInterface<IPositronNotebookCodeCell>({
		// 'this is' type predicates can't be expressed in an object literal; cast the stub method.
		isCodeCell: (() => true) as IPositronNotebookCodeCell['isCodeCell'],
		outputs: constObservable(cellOutputs),
	});
	const instance = stubInterface<IPositronNotebookInstance>({
		cells: constObservable([cell]),
	});
	const notebookService = stubInterface<IPositronNotebookService>({
		listInstances: () => [instance],
	});
	return new MainThreadNotebookFeatures(
		stubInterface<IExtHostContext>(),
		stubInterface<IEditorService>(),
		notebookService,
		stubInterface<ILogService>({ warn: vi.fn() }),
		stubInterface<IConfigurationService>(),
		stubInterface<IRuntimeSessionService>(),
	);
}

describe('MainThreadNotebookFeatures $getCellOutputs SVG handling', () => {
	createTestContainer().build();

	it('rasterizes image/svg+xml outputs to a base64 png DTO', async () => {
		mockRasterizeSvgToPng.mockResolvedValue(PNG_BASE64);
		const features = createFeatures([{ mime: 'image/svg+xml', data: VSBuffer.fromString(SVG_TEXT) }]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(mockRasterizeSvgToPng).toHaveBeenCalledWith(SVG_TEXT);
		expect(outputs).toEqual([{ mimeType: 'image/png', data: PNG_BASE64 }]);
		features.dispose();
	});

	it('rasterizes SVG outputs whose MIME type carries parameters', async () => {
		mockRasterizeSvgToPng.mockResolvedValue(PNG_BASE64);
		const features = createFeatures([{ mime: 'image/svg+xml; charset=utf-8', data: VSBuffer.fromString(SVG_TEXT) }]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(outputs).toEqual([{ mimeType: 'image/png', data: PNG_BASE64 }]);
		features.dispose();
	});

	it('does not rasterize an SVG that has a raster image sibling in the same output', async () => {
		// Both items represent the same plot; rasterizing the SVG too would send
		// the model two identical images.
		const features = createFeatures([
			{ mime: 'image/png', data: VSBuffer.fromString('rawpngbytes') },
			{ mime: 'image/svg+xml', data: VSBuffer.fromString(SVG_TEXT) },
		]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(mockRasterizeSvgToPng).not.toHaveBeenCalled();
		expect(outputs).toEqual([
			{ mimeType: 'image/png', data: encodeBase64(VSBuffer.fromString('rawpngbytes')) },
			{ mimeType: 'image/svg+xml', data: SVG_TEXT },
		]);
		features.dispose();
	});

	it('falls back to raw SVG text when rasterization fails', async () => {
		mockRasterizeSvgToPng.mockResolvedValue(undefined);
		const features = createFeatures([{ mime: 'image/svg+xml', data: VSBuffer.fromString(SVG_TEXT) }]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(outputs).toEqual([{ mimeType: 'image/svg+xml', data: SVG_TEXT }]);
		features.dispose();
	});
});
