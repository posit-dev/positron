/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstanceItems.css';

// React.
import { flushSync } from 'react-dom';
import React, { Component } from 'react';

// Other dependencies.
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { ConsoleInput } from './consoleInput.js';
import { RuntimeTrace } from './runtimeTrace.js';
import { RuntimeStartup } from './runtimeStartup.js';
import { RuntimeStarted } from './runtimeStarted.js';
import { RuntimeOffline } from './runtimeOffline.js';
import { RuntimeExited } from './runtimeExited.js';
import { RuntimeItemTrace } from '../../../../services/positronConsole/browser/classes/runtimeItemTrace.js';
import { RuntimeStarting } from './runtimeStarting.js';
import { RuntimeActivity } from './runtimeActivity.js';
import { RuntimeItemExited } from '../../../../services/positronConsole/browser/classes/runtimeItemExited.js';
import { RuntimeItemStartup } from '../../../../services/positronConsole/browser/classes/runtimeItemStartup.js';
import { RuntimeItemStarted } from '../../../../services/positronConsole/browser/classes/runtimeItemStarted.js';
import { RuntimeItemOffline } from '../../../../services/positronConsole/browser/classes/runtimeItemOffline.js';
import { RuntimeItemStarting } from '../../../../services/positronConsole/browser/classes/runtimeItemStarting.js';
import { RuntimeItemActivity } from '../../../../services/positronConsole/browser/classes/runtimeItemActivity.js';
import { RuntimePendingInput } from './runtimePendingInput.js';
import { RuntimeRestartButton } from './runtimeRestartButton.js';
import { RuntimeItemReconnected } from '../../../../services/positronConsole/browser/classes/runtimeItemReconnected.js';
import { RuntimeStartupFailure } from './runtimeStartupFailure.js';
import { RuntimeItemPendingInput } from '../../../../services/positronConsole/browser/classes/runtimeItemPendingInput.js';
import { RuntimeItemRestartButton } from '../../../../services/positronConsole/browser/classes/runtimeItemRestartButton.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { RuntimeItemStartupFailure } from '../../../../services/positronConsole/browser/classes/runtimeItemStartupFailure.js';
import { localize } from '../../../../../nls.js';

/**
 * ConsoleInstanceItemsProps interface.
 */
interface ConsoleInstanceItemsProps {
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly editorFontInfo: FontInfo;
	readonly trace: boolean;
	readonly runtimeAttached: boolean;
	readonly consoleInputWidth: number;
	readonly onSelectAll: () => void;
}
/**
 * ConsoleInstanceItems component.
 */
export class ConsoleInstanceItems extends Component<ConsoleInstanceItemsProps> {
	/**
	 * Constructor.
	 * @param props
	 */
	constructor(props: ConsoleInstanceItemsProps) {
		super(props);
	}

	/**
	 * Renders the component.
	 * @returns The rendered component.
	 */
	override render() {

		let extensionHostDisconnected = false;

		return (
			<>
				<div className='top-spacer' />
				{this.props.positronConsoleInstance.runtimeItems.map(runtimeItem => {
					if (runtimeItem instanceof RuntimeItemActivity) {
						return <RuntimeActivity key={runtimeItem.id} fontInfo={this.props.editorFontInfo} positronConsoleInstance={this.props.positronConsoleInstance} runtimeItemActivity={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemPendingInput) {
						return <RuntimePendingInput key={runtimeItem.id} fontInfo={this.props.editorFontInfo} runtimeItemPendingInput={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStartup) {
						extensionHostDisconnected = false;
						return <RuntimeStartup key={runtimeItem.id} runtimeItemStartup={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemReconnected) {
						extensionHostDisconnected = false;
						return null;
					} else if (runtimeItem instanceof RuntimeItemStarting) {
						return <RuntimeStarting key={runtimeItem.id} runtimeItemStarting={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStarted) {
						return <RuntimeStarted key={runtimeItem.id} runtimeItemStarted={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemOffline) {
						return <RuntimeOffline key={runtimeItem.id} runtimeItemOffline={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemExited) {
						if (runtimeItem.reason === 'extensionHost') {
							extensionHostDisconnected = true;
							return null;
						}
						return <RuntimeExited key={runtimeItem.id} runtimeItemExited={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemRestartButton) {
						return <RuntimeRestartButton key={runtimeItem.id} positronConsoleInstance={this.props.positronConsoleInstance} runtimeItemRestartButton={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStartupFailure) {
						return <RuntimeStartupFailure key={runtimeItem.id} runtimeItemStartupFailure={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemTrace) {
						return this.props.trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
					} else {
						// This indicates a bug.
						return null;
					}
				})}
				{extensionHostDisconnected ?
					(<div className='console-item-reconnecting'>
						<span className='codicon codicon-loading codicon-modifier-spin'></span>
						<span>{localize(
							"positron.console.extensionsRestarting",
							"Extensions restarting..."
						)}</span>
					</div>) :
					null
				}

				<ConsoleInput
					hidden={this.props.positronConsoleInstance.promptActive || !this.props.runtimeAttached}
					positronConsoleInstance={this.props.positronConsoleInstance}
					width={this.props.consoleInputWidth}
					onCodeExecuted={() =>
						// Update the component to eliminate flickering.
						flushSync(() => this.forceUpdate()
						)}
					onSelectAll={this.props.onSelectAll}
				/>
			</>
		);
	}
}
