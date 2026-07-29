/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandHandler } from '../../../platform/commands/common/commands.js';
import { IWorkbenchEnvironmentService } from '../../services/environment/common/environmentService.js';

/**
 * Registers `id` with the command registry, but only when the smoke-test driver
 * is enabled. Returns a disposable that unregisters the command; when the
 * driver is disabled nothing is registered and the disposable is a no-op.
 *
 * Use this for any command whose only consumer is an e2e test, typically read
 * back through `code.driver.executeCommand()`.
 *
 * Why the gate matters: prefixing a command id with an underscore keeps it out
 * of the command palette, keybindings editor, and menus, but it stays visible
 * to extensions via `vscode.commands.getCommands(false)` and runnable via
 * `vscode.commands.executeCommand(...)`. Gating registration on the same flag
 * that guards the smoke-test driver means a test-only command is absent from
 * the registry entirely in a normal session, while the e2e path keeps working:
 * both the Electron and web launchers pass `--enable-smoke-test-driver`,
 * including when running against a release build.
 *
 * Do not use this for commands that are a real API. `_executeCodeInConsole`,
 * for example, is underscore-prefixed but is bridged to extensions as
 * `positron.executeCodeFromPosition`, so it must stay registered.
 *
 * The environment service is only available through dependency injection, so
 * call this from a workbench contribution rather than at module scope. The
 * contribution needs no body beyond the registration:
 *
 * ```ts
 * export class MyCommandContribution extends Disposable implements IWorkbenchContribution {
 *
 *     static readonly ID = 'workbench.contrib.positronMyCommand';
 *
 *     constructor(
 *         @IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
 *     ) {
 *         super();
 *
 *         this._register(registerCommandIfSmokeTestDriver(
 *             environmentService, MY_COMMAND_ID, myHandler));
 *     }
 * }
 * ```
 *
 * Register it with `registerWorkbenchContribution2` at `WorkbenchPhase.BlockRestore`,
 * so the command exists before the smoke-test driver resolves
 * `whenWorkbenchRestored()` at `Restored`, which is the earliest point a test
 * can invoke it.
 *
 * @param environmentService Injected environment service.
 * @param id Command id. Prefix with an underscore by convention.
 * @param handler Command handler, same shape as `registerCommand` takes.
 */
export function registerCommandIfSmokeTestDriver<Args extends unknown[]>(
	environmentService: IWorkbenchEnvironmentService,
	id: string,
	handler: ICommandHandler<Args>,
): IDisposable {
	return environmentService.enableSmokeTestDriver
		? CommandsRegistry.registerCommand(id, handler)
		: Disposable.None;
}
