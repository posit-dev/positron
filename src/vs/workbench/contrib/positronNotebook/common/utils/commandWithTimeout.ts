/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from 'vs/platform/commands/common/commands';

interface CommandWithTimeoutArgs<T = unknown> {
	/**
	 * Command to run.
	 */
	command: string;
	/**
	 * Arguments for command bundled into an array
	 */
	args: any[];
	/**
	 * Timeout in milliseconds.
	 */
	timeoutMs: number;
	/**
	 * Command service to run the command on.
	 */
	commandService: ICommandService;
	/**
	 * Function to run on successful command execution.
	 */
	onSuccess: (res: T) => void;
	/**
	 * Function to run on command error.
	 */
	onError: (err: Error) => void;
	/**
	 * Function to run on command timeout.
	 */
	onTimeout: () => void;
}


/**
 * Run a command on the command service with a timeout.
 *
 * Useful for running in things like `React.useEffect()`s.
 * @param args Arguments in the form of `CommandWithTimeoutArgs`
 * @returns Timeout ID for the command that can be used to clear the timeout with `clearTimeout()`
 */
export function commandWithTimeout<T = unknown>({
	command, args, timeoutMs = 5000, commandService, onSuccess, onTimeout, onError,
}: CommandWithTimeoutArgs<T>): NodeJS.Timeout {

	const timeout = setTimeout(() => {
		onTimeout();
	}, timeoutMs);

	async function runCommand() {
		try {
			const res = await commandService.executeCommand<T>(command, ...args);
			if (!res) {
				onError(new Error('Unexpected null response from command'));
				return;
			}
			onSuccess(res);
		} catch (error) {
			onError(error);
		}

		clearTimeout(timeout);
	}

	runCommand();

	return timeout;
}
