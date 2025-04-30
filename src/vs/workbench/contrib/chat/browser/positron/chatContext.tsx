/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react'
import { PropsWithChildren, useContext } from 'react';
import { PositronChatServices, PositronChatState, usePositronChatState } from './chatState.js';

const PositronChatContext = React.createContext<PositronChatState>(undefined!);

export const PositronChatContextProvider = (props: PropsWithChildren<PositronChatServices>) => {
	const positronChatState = usePositronChatState(props);

	return (
		<PositronChatContext.Provider value={positronChatState}>
			{props.children}
		</PositronChatContext.Provider>
	);
};

export const usePositronChatContext = () => useContext(PositronChatContext);
