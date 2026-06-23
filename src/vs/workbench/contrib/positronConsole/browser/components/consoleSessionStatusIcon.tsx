/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { RuntimeStatusIcon } from './runtimeStatus.js';
import { runtimeStateToRuntimeStatus } from '../../common/sessionDisplayUtils.js';
import { useSessionRuntimeState } from './useSessionRuntimeState.js';

interface ConsoleSessionStatusIconProps {
	readonly positronConsoleInstance: IPositronConsoleInstance;
}

export const ConsoleSessionStatusIcon = ({ positronConsoleInstance }: ConsoleSessionStatusIconProps) => {
	const services = usePositronReactServicesContext();
	// Read the session by id rather than the console's attached session: a
	// restart detaches the runtime while it exits, so attachedRuntimeSession is
	// briefly undefined even though the session is still restarting.
	const session = services.runtimeSessionService.getSession(positronConsoleInstance.sessionId);
	const runtimeState = useSessionRuntimeState(session) ?? RuntimeState.Uninitialized;
	const runtimeStatus = runtimeStateToRuntimeStatus[runtimeState];
	return <RuntimeStatusIcon status={runtimeStatus} />;
};
