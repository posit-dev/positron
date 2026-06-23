/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { IVisibleEditorPane } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { BackendState } from '../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { DataExplorerClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { PositronDataExplorerEditorInput } from '../../browser/positronDataExplorerEditorInput.js';
import { PositronDataExplorerSheetSelector } from '../../browser/positronDataExplorerSheetSelector.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

describe('PositronDataExplorerSheetSelector', () => {
	const editorChange = new Emitter<void>();
	const backendStateChange = new Emitter<BackendState>();

	// Mutable worksheet state, read through the instance stub's getters and reset
	// before each test so a test can simulate worksheet selection changes.
	let availableSheets: string[];
	let selectedSheet: string | undefined;
	let hasHeaderRow: boolean;

	const instanceStub = stubInterface<IPositronDataExplorerInstance>({
		get fileAvailableSheets() { return availableSheets; },
		get fileSelectedSheet() { return selectedSheet; },
		get fileHasHeaderRow() { return hasHeaderRow; },
		applyFileOptions: vi.fn(),
		dataExplorerClientInstance: stubInterface<DataExplorerClientInstance>({
			onDidUpdateBackendState: backendStateChange.event,
		}),
	});

	// The data explorer editor exposes an `identifier` on its control, which the
	// component reads via getPositronDataExplorerEditorFromEditorPane.
	const editorControl = { identifier: 'instance-1' };
	const activeEditorPane = stubInterface<IVisibleEditorPane>({
		getId: () => PositronDataExplorerEditorInput.EditorID,
		getControl: () => editorControl,
	});

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IEditorService, {
			activeEditorPane,
			onDidActiveEditorChange: editorChange.event,
		})
		.stub(IPositronDataExplorerService, {
			getInstance: () => instanceStub,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		availableSheets = ['Total', 'Sales'];
		selectedSheet = 'Total';
		hasHeaderRow = true;
	});

	it('shows the selected worksheet in the label', () => {
		rtl.render(<PositronDataExplorerSheetSelector accessor={ctx.instantiationService} />);
		expect(screen.getByText('Total')).toBeInTheDocument();
	});

	it('renders nothing when the workbook has no worksheets', () => {
		availableSheets = [];
		selectedSheet = undefined;
		rtl.render(<PositronDataExplorerSheetSelector accessor={ctx.instantiationService} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('renders nothing when the workbook has only one worksheet', () => {
		availableSheets = ['Total'];
		selectedSheet = 'Total';
		rtl.render(<PositronDataExplorerSheetSelector accessor={ctx.instantiationService} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('updates the label when the backend state reports a new worksheet', () => {
		rtl.render(<PositronDataExplorerSheetSelector accessor={ctx.instantiationService} />);
		expect(screen.getByText('Total')).toBeInTheDocument();

		selectedSheet = 'Sales';
		act(() => backendStateChange.fire(stubInterface<BackendState>({})));
		expect(screen.getByText('Sales')).toBeInTheDocument();
	});
});
