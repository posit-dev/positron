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
	readonly disconnected: boolean;
	readonly onSelectAll: () => void;
}
/**
 * ConsoleInstanceItems component.
 *
 * PLEASE READ:
 * This component is a class component ON PURPOSE!
 * This needs to be a class component to fix https://github.com/posit-dev/positron/issues/705.
 * Without `forceUpdate()`, there will be a regression for issue #705.
 *
 * This is the only class component in Positron Core for this reason.
 * Other workarounds do not work, including the offical suggestion in the React FAQ:
 * https://legacy.reactjs.org/docs/hooks-faq.html#is-there-something-like-forceupdate
 *
 * See commit: https://github.com/posit-dev/positron/commit/1e125e96bdc128a5c2dc2a9df7cdb52ba9ea5aaf
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
		return (
			<>
				<div className='top-spacer' />
				{this.props.positronConsoleInstance.runtimeItems.filter(runtimeItem => !runtimeItem.isHidden).map(runtimeItem => {
					if (runtimeItem instanceof RuntimeItemActivity) {
						return <RuntimeActivity key={runtimeItem.id} fontInfo={this.props.editorFontInfo} positronConsoleInstance={this.props.positronConsoleInstance} runtimeItemActivity={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemPendingInput) {
						return <RuntimePendingInput key={runtimeItem.id} fontInfo={this.props.editorFontInfo} runtimeItemPendingInput={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStartup) {
						return <RuntimeStartup key={runtimeItem.id} runtimeItemStartup={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemReconnected) {
						return null;
					} else if (runtimeItem instanceof RuntimeItemStarting) {
						return <RuntimeStarting key={runtimeItem.id} runtimeItemStarting={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStarted) {
						return <RuntimeStarted key={runtimeItem.id} runtimeItemStarted={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemOffline) {
						return <RuntimeOffline key={runtimeItem.id} runtimeItemOffline={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemExited) {
						return <RuntimeExited key={runtimeItem.id} runtimeItemExited={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemRestartButton) {
						return <RuntimeRestartButton key={runtimeItem.id} positronConsoleInstance={this.props.positronConsoleInstance} runtimeItemRestartButton={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStartupFailure) {
						return <RuntimeStartupFailure key={runtimeItem.id} runtimeItemStartupFailure={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemTrace) {
						return this.props.trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
					} else {
						// This indicates a bug. A new runtime item was added but not handled here.
						return null;
					}
				})}
				{this.props.disconnected &&
					<div className='console-item-starting'>
						<span className='codicon codicon-loading codicon-modifier-spin'></span>
						<span>{localize(
							"positron.console.extensionsRestarting",
							"Extensions restarting..."
						)}</span>
					</div>
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
