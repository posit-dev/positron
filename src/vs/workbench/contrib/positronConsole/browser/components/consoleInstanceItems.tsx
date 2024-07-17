/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./consoleInstanceItems';

// React.
import * as React from 'react';
import { flushSync } from 'react-dom';
import { Component } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { ConsoleInput } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInput';
import { RuntimeTrace } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeTrace';
import { RuntimeExited } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeExited';
import { RuntimeStartup } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartup';
import { RuntimeStarted } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarted';
import { RuntimeOffline } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeOffline';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemTrace';
import { RuntimeStarting } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarting';
import { RuntimeActivity } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeActivity';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemExited';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartup';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStarted';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemOffline';
import { RuntimeReconnected } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeReconnected';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStarting';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemActivity';
import { RuntimePendingInput } from 'vs/workbench/contrib/positronConsole/browser/components/runtimePendingInput';
import { RuntimeRestartButton } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeRestartButton';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemReconnected';
import { RuntimeStartupFailure } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartupFailure';
import { RuntimeItemPendingInput } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemPendingInput';
import { RuntimeItemRestartButton } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemRestartButton';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartupFailure';

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
		return (
			<>
				<div className='top-spacer' />
				{this.props.positronConsoleInstance.runtimeItems.map(runtimeItem => {
					if (runtimeItem instanceof RuntimeItemActivity) {
						return <RuntimeActivity key={runtimeItem.id} fontInfo={this.props.editorFontInfo} runtimeItemActivity={runtimeItem} positronConsoleInstance={this.props.positronConsoleInstance} />;
					} else if (runtimeItem instanceof RuntimeItemPendingInput) {
						return <RuntimePendingInput key={runtimeItem.id} fontInfo={this.props.editorFontInfo} runtimeItemPendingInput={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStartup) {
						return <RuntimeStartup key={runtimeItem.id} runtimeItemStartup={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemReconnected) {
						return <RuntimeReconnected key={runtimeItem.id} runtimeItemReconnected={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStarting) {
						return <RuntimeStarting key={runtimeItem.id} runtimeItemStarting={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStarted) {
						return <RuntimeStarted key={runtimeItem.id} runtimeItemStarted={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemOffline) {
						return <RuntimeOffline key={runtimeItem.id} runtimeItemOffline={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemExited) {
						return <RuntimeExited key={runtimeItem.id} runtimeItemExited={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemRestartButton) {
						return <RuntimeRestartButton key={runtimeItem.id} runtimeItemRestartButton={runtimeItem} positronConsoleInstance={this.props.positronConsoleInstance} />;
					} else if (runtimeItem instanceof RuntimeItemStartupFailure) {
						return <RuntimeStartupFailure key={runtimeItem.id} runtimeItemStartupFailure={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemTrace) {
						return this.props.trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
					} else {
						// This indicates a bug.
						return null;
					}
				})}
				{!this.props.positronConsoleInstance.promptActive && this.props.runtimeAttached &&
					<ConsoleInput
						width={this.props.consoleInputWidth}
						positronConsoleInstance={this.props.positronConsoleInstance}
						onSelectAll={this.props.onSelectAll}
						onCodeExecuted={() =>
							// Update the component to eliminate flickering.
							flushSync(() => this.forceUpdate()
						)}
					/>
				}
			</>
		);
	}
}
