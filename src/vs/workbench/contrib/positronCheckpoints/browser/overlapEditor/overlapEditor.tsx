/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import '../media/positronCheckpoints.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ISyncController } from '../syncController.js';
import { OverlapSection } from './overlapChoices.js';
import { OverlapEditorInput } from './overlapEditorInput.js';

interface IOverlapEditorViewProps {
	controller: ISyncController;
	/** Closes the editor. */
	onClose(): void;
}

/**
 * The content of the overlap editor: one section per overlap, "Apply Choices", and "Back out".
 * Apply is enabled when every overlap has a choice and none needs a git tool. Back out forgets
 * the choices and closes the editor without touching the project.
 */
export const OverlapEditorView = ({ controller, onClose }: IOverlapEditorViewProps) => {
	const [, setVersion] = useState(0);
	const [applying, setApplying] = useState(false);

	useEffect(() => {
		const listener = controller.onDidChange(() => setVersion(version => version + 1));
		return () => listener.dispose();
	}, [controller]);

	const overlaps = controller.preview?.overlaps ?? [];

	const apply = async () => {
		setApplying(true);
		const result = await controller.apply();
		setApplying(false);
		if (result?.kind === 'done') {
			onClose();
		}
	};

	const backOut = () => {
		controller.backOut();
		onClose();
	};

	return (
		<div className='positron-checkpoints checkpoints-overlaps'>
			<h2 className='checkpoints-heading'>{Strings.overlaps.heading()}</h2>
			{controller.inputsChanged && (
				<p className='checkpoints-note' role='status'>{Strings.results.forOperation(controller.inputsChanged)}</p>
			)}
			<p>{overlaps.length === 0 ? Strings.overlaps.none() : Strings.overlaps.chooseEach()}</p>
			{overlaps.map(overlap => (
				<OverlapSection
					key={overlap.id}
					choice={controller.resolutions.get(overlap.id)}
					overlap={overlap}
					onChoose={choice => controller.setChoice(overlap.id, choice)}
				/>
			))}
			<div className='checkpoints-overlaps-actions'>
				<Button
					className='checkpoints-button checkpoints-button-primary'
					disabled={!controller.canApply || overlaps.length === 0 || applying}
					onPressed={apply}
				>
					{Strings.overlaps.applyChoices()}
				</Button>
				<Button className='checkpoints-button' onPressed={backOut}>{Strings.actions.backOut()}</Button>
			</div>
		</div>
	);
};

/**
 * The editor pane of `OverlapEditorInput`. It mounts `OverlapEditorView` for the window's
 * `ISyncController` with a `PositronReactRenderer`.
 */
export class OverlapEditorPane extends EditorPane {
	private readonly _container: HTMLElement;
	private readonly _renderer = this._register(new MutableDisposable<PositronReactRenderer>());

	constructor(
		group: IEditorGroup,
		@ISyncController private readonly _syncController: ISyncController,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(OverlapEditorInput.EditorID, group, telemetryService, themeService, storageService);
		this._container = DOM.$('.positron-checkpoints-overlaps-container');
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: OverlapEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}
		const renderer = new PositronReactRenderer(this._container);
		this._renderer.value = renderer;
		renderer.render(<OverlapEditorView controller={this._syncController} onClose={() => this.group.closeEditor(input)} />);
	}

	override clearInput(): void {
		this._renderer.clear();
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);
	}
}
