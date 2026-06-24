/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookHelpPanel.css';
import '../../../../../../base/browser/ui/keybindingLabel/keybindingLabel.css';

// React.
import { ReactElement } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { PositronDynamicModalDialog } from '../../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { OneButtonFooter } from '../../../../../browser/positronComponents/positronDynamicModalDialog/components/oneButtonFooter.js';
import { PositronModalDialogReactRenderer } from '../../../../../../base/browser/positronModalDialogReactRenderer.js';
import { ResolvedChord, ResolvedKeybinding } from '../../../../../../base/common/keybindings.js';
import { UILabelProvider } from '../../../../../../base/common/keybindingLabels.js';
import { OS } from '../../../../../../base/common/platform.js';

interface ShortcutEntry {
	label: string;
	commandId: string;
}

interface ShortcutSection {
	title: string;
	shortcuts: ShortcutEntry[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
	{
		title: localize('positron.notebookHelp.section.execution', 'Execution'),
		shortcuts: [
			{ label: localize('positron.notebookHelp.runCell', 'Run cell'), commandId: 'positronNotebook.cell.executeOrToggleEditor' },
			{ label: localize('positron.notebookHelp.runCellAndAdvance', 'Run cell and advance'), commandId: 'positronNotebook.cell.executeAndSelectBelow' },
			{ label: localize('positron.notebookHelp.runSelection', 'Run selection or current line'), commandId: 'positronNotebook.cell.executeSelection' },
			{ label: localize('positron.notebookHelp.runAll', 'Run all cells'), commandId: 'positronNotebook.runAllCells' },
		]
	},
	{
		title: localize('positron.notebookHelp.section.navigation', 'Navigation'),
		shortcuts: [
			{ label: localize('positron.notebookHelp.selectUp', 'Select cell above'), commandId: 'positronNotebook.selectUp' },
			{ label: localize('positron.notebookHelp.selectDown', 'Select cell below'), commandId: 'positronNotebook.selectDown' },
			{ label: localize('positron.notebookHelp.enterEditMode', 'Enter edit mode'), commandId: 'positronNotebook.cell.edit' },
			{ label: localize('positron.notebookHelp.exitEditMode', 'Exit edit mode (command mode)'), commandId: 'positronNotebook.cell.quitEdit' },
		]
	},
	{
		title: localize('positron.notebookHelp.section.editing', 'Editing'),
		shortcuts: [
			{ label: localize('positron.notebookHelp.addCodeAbove', 'Insert code cell above'), commandId: 'positronNotebook.cell.insertCodeCellAboveAndFocusContainer' },
			{ label: localize('positron.notebookHelp.addCodeBelow', 'Insert code cell below'), commandId: 'positronNotebook.cell.insertCodeCellBelowAndFocusContainer' },
			{ label: localize('positron.notebookHelp.deleteCell', 'Delete cell'), commandId: 'positronNotebook.cell.delete' },
			{ label: localize('positron.notebookHelp.moveCellUp', 'Move cell up'), commandId: 'positronNotebook.cell.moveUp' },
			{ label: localize('positron.notebookHelp.moveCellDown', 'Move cell down'), commandId: 'positronNotebook.cell.moveDown' },
		]
	},
	{
		title: localize('positron.notebookHelp.section.cellType', 'Cell Type'),
		shortcuts: [
			{ label: localize('positron.notebookHelp.toCode', 'Convert to code cell'), commandId: 'positronNotebook.cell.changeToCode' },
			{ label: localize('positron.notebookHelp.toMarkdown', 'Convert to markdown cell'), commandId: 'positronNotebook.cell.changeToMarkdown' },
		]
	},
	{
		title: localize('positron.notebookHelp.section.other', 'Other'),
		shortcuts: [
			{ label: localize('positron.notebookHelp.find', 'Find'), commandId: 'positronNotebook.find.start' },
			{ label: localize('positron.notebookHelp.save', 'Save notebook'), commandId: 'workbench.action.files.save' },
			{ label: localize('positron.notebookHelp.commandPalette', 'Command palette'), commandId: 'workbench.action.showCommands' },
		]
	}
];

export type ResolvedBindingsMap = ReadonlyMap<string, ResolvedKeybinding>;

/**
 * Resolve keybindings for all shortcuts while the notebook editor context is
 * still active. Call this before opening the modal so focus changes don't
 * affect lookup results.
 */
export function resolveShortcutBindings(keybindingService: IKeybindingService): ResolvedBindingsMap {
	const map = new Map<string, ResolvedKeybinding>();
	for (const section of SHORTCUT_SECTIONS) {
		for (const shortcut of section.shortcuts) {
			const binding = keybindingService.lookupKeybinding(shortcut.commandId);
			if (binding) {
				map.set(shortcut.commandId, binding);
			}
		}
	}
	return map;
}

interface NotebookHelpPanelProps {
	renderer: PositronModalDialogReactRenderer;
	resolvedBindings: ResolvedBindingsMap;
	onOpenAllShortcuts: () => void;
	onSeeAllCommands: () => void;
}

function getChordKeys(chord: ResolvedChord): string[] {
	const modifierLabels = UILabelProvider.modifierLabels[OS];
	const keys: string[] = [];
	if (chord.ctrlKey) { keys.push(modifierLabels.ctrlKey); }
	if (chord.shiftKey) { keys.push(modifierLabels.shiftKey); }
	if (chord.altKey) { keys.push(modifierLabels.altKey); }
	if (chord.metaKey) { keys.push(modifierLabels.metaKey); }
	if (chord.keyLabel) { keys.push(chord.keyLabel); }
	return keys;
}

function renderKeybinding(keybinding: ResolvedKeybinding): ReactElement {
	const chords = keybinding.getChords();
	const separator = UILabelProvider.modifierLabels[OS].separator;
	const elements: ReactElement[] = [];
	chords.forEach((chord, chordIdx) => {
		if (chordIdx > 0) {
			elements.push(<span key={`csep-${chordIdx}`} className='monaco-keybinding-key-chord-separator'> </span>);
		}
		const keys = getChordKeys(chord);
		keys.forEach((key, keyIdx) => {
			if (keyIdx > 0 && separator) {
				elements.push(<span key={`sep-${chordIdx}-${keyIdx}`} className='monaco-keybinding-key-separator'>{separator}</span>);
			}
			elements.push(<span key={`${chordIdx}-${keyIdx}`} className='monaco-keybinding-key'>{key}</span>);
		});
	});
	const ariaLabel = keybinding.getAriaLabel() || undefined;
	return <span aria-label={ariaLabel} className='monaco-keybinding'>{elements}</span>;
}

function KeybindingDisplay({ commandId, resolvedBindings }: { commandId: string; resolvedBindings: ResolvedBindingsMap }): ReactElement {
	const keybinding = resolvedBindings.get(commandId);
	if (!keybinding) {
		return <span className='shortcut-unbound'>{localize('positron.notebookHelp.unbound', 'not bound')}</span>;
	}
	return renderKeybinding(keybinding);
}

export function NotebookHelpPanel({ renderer, resolvedBindings, onOpenAllShortcuts, onSeeAllCommands }: NotebookHelpPanelProps): ReactElement {
	return (
		<PositronDynamicModalDialog
			content={
				<div className='notebook-help-panel'>
					<div>
						<h2>{localize('positron.notebookHelp.section.commands', 'See All Commands')}</h2>
						<button className='notebook-help-command-row' onClick={() => { renderer.dispose(); onSeeAllCommands(); }}>
							{localize('positron.notebookHelp.browseCommands', 'Browse all notebook commands...')}
						</button>
					</div>
					{SHORTCUT_SECTIONS.map(section => (
						<div key={section.title}>
							<h2>{section.title}</h2>
							<div className='shortcut-grid'>
								{section.shortcuts.map(shortcut => (
									<div key={shortcut.commandId} className='shortcut-row'>
										<span className='shortcut-label'>{shortcut.label}</span>
										<span className='shortcut-keys'>
											<KeybindingDisplay commandId={shortcut.commandId} resolvedBindings={resolvedBindings} />
										</span>
									</div>
								))}
							</div>
						</div>
					))}
					<div className='notebook-help-all-shortcuts'>
						<button className='all-shortcuts-link' type='button' onClick={() => { renderer.dispose(); onOpenAllShortcuts(); }}>
							{localize('positron.notebookHelp.allShortcuts', 'View All Notebook Keyboard Shortcuts...')}
						</button>
					</div>
				</div>
			}
			contentMaxHeight={540}
			footer={
				<OneButtonFooter buttonTitle={localize('positron.notebookHelp.close', 'Close')} onButton={() => renderer.dispose()} />
			}
			renderer={renderer}
			title={localize('positron.notebookHelp.title', 'Notebook Help')}
			width={500}
			onSubmit={() => renderer.dispose()}
		/>
	);
}
