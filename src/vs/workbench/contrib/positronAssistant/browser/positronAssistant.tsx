/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect } from 'react';
import 'vs/css!./positronAssistant';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronAssistantContextProvider, PositronAssistantServices } from 'vs/workbench/contrib/positronAssistant/browser/positronAssistantContext';

export interface PositronAssistantProps extends PositronAssistantServices { }

export const PositronAssistant = (props: React.PropsWithChildren<PositronAssistantProps>) => {

	// Stubs for propagating height and width to the React component.
	const [_width, setWidth] = React.useState(props.reactComponentContainer.width);
	const [_height, setHeight] = React.useState(props.reactComponentContainer.height);

	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));
		return () => disposableStore.dispose();
	}, [props.reactComponentContainer]);

	return (
		<div className='positron-connections'>
			<PositronAssistantContextProvider {...props}>
				Hello, world.
			</PositronAssistantContextProvider>
		</div>
	);
};
