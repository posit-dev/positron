/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
// import { app } from 'electron';
import { app, BrowserWindow } from 'electron';
// --- End Positron ---
import { coalesce } from '../../../base/common/arrays.js';
// --- Start Positron ---
import { CancellationToken } from '../../../base/common/cancellation.js';
import { selectCanvasLaunchWindow } from '../common/positronCanvasLaunch.js';
import { IPositronCanvasModeMainService } from '../../positronCanvasMode/common/positronCanvasMode.js';
// --- End Positron ---
import { IProcessEnvironment, isMacintosh } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { whenDeleted } from '../../../base/node/pfs.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { NativeParsedArgs } from '../../environment/common/argv.js';
import { isLaunchedFromCli } from '../../environment/node/argvHelper.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IURLService } from '../../url/common/url.js';
import { ICodeWindow } from '../../window/electron-main/window.js';
import { IWindowSettings } from '../../window/common/window.js';
import { IOpenConfiguration, IWindowsMainService, OpenContext } from '../../windows/electron-main/windows.js';
import { IProtocolUrl } from '../../url/electron-main/url.js';

export const ID = 'launchMainService';
export const ILaunchMainService = createDecorator<ILaunchMainService>(ID);

export interface IStartArguments {
	readonly args: NativeParsedArgs;
	readonly userEnv: IProcessEnvironment;
}

export interface ILaunchMainService {

	readonly _serviceBrand: undefined;

	start(args: NativeParsedArgs, userEnv: IProcessEnvironment): Promise<void>;

	getMainProcessId(): Promise<number>;
}

export class LaunchMainService implements ILaunchMainService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IURLService private readonly urlService: IURLService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		// --- Start Positron ---
		@IPositronCanvasModeMainService private readonly positronCanvasModeMainService: IPositronCanvasModeMainService,
		// --- End Positron ---
	) { }

	async start(args: NativeParsedArgs, userEnv: IProcessEnvironment): Promise<void> {
		this.logService.trace('Received data from other instance: ', args, userEnv);

		// macOS: Electron > 7.x changed its behaviour to not
		// bring the application to the foreground when a window
		// is focused programmatically. Only via `app.focus` and
		// the option `steal: true` can you get the previous
		// behaviour back. The only reason to use this option is
		// when a window is getting focused while the application
		// is not in the foreground and since we got instructed
		// to open a new window from another instance, we ensure
		// that the app has focus.
		if (isMacintosh) {
			app.focus({ steal: true });
		}

		// Check early for open-url which is handled in URL service
		const urlsToOpen = this.parseOpenUrl(args);
		if (urlsToOpen.length) {
			let whenWindowReady: Promise<unknown> = Promise.resolve();

			// Create a window if there is none
			if (this.windowsMainService.getWindowCount() === 0) {
				const window = (await this.windowsMainService.openEmptyWindow({ context: OpenContext.DESKTOP })).at(0);
				if (window) {
					whenWindowReady = window.ready();
				}
			}

			// Make sure a window is open, ready to receive the url event
			whenWindowReady.then(() => {
				for (const { uri, originalUrl } of urlsToOpen) {
					this.urlService.open(uri, { originalUrl });
				}
			});
		}

		// Otherwise handle in windows service
		else {
			return this.startOpenWindow(args, userEnv);
		}
	}

	private parseOpenUrl(args: NativeParsedArgs): IProtocolUrl[] {
		if (args['open-url'] && args._urls && args._urls.length > 0) {

			// --open-url must contain -- followed by the url(s)
			// process.argv is used over args._ as args._ are resolved to file paths at this point

			return coalesce(args._urls
				.map(url => {
					try {
						return { uri: URI.parse(url), originalUrl: url };
					} catch (err) {
						return null;
					}
				}));
		}

		return [];
	}

	private async startOpenWindow(args: NativeParsedArgs, userEnv: IProcessEnvironment): Promise<void> {
		const context = isLaunchedFromCli(userEnv) ? OpenContext.CLI : OpenContext.DESKTOP;

		let usedWindows: ICodeWindow[] = [];

		const waitMarkerFileURI = args.wait && args.waitMarkerFilePath ? URI.file(args.waitMarkerFilePath) : undefined;
		const remoteAuthority = args.remote || undefined;

		const baseConfig: IOpenConfiguration = {
			context,
			cli: args,
			/**
			 * When opening a new window from a second instance that sent args and env
			 * over to this instance, we want to preserve the environment only if that second
			 * instance was spawned from the CLI or used the `--preserve-env` flag (example:
			 * when using `open -n "VSCode.app" --args --preserve-env WORKSPACE_FOLDER`).
			 *
			 * This is done to ensure that the second window gets treated exactly the same
			 * as the first window, for example, it gets the same resolved user shell environment.
			 *
			 * https://github.com/microsoft/vscode/issues/194736
			 */
			userEnv: (args['preserve-env'] || context === OpenContext.CLI) ? userEnv : undefined,
			waitMarkerFileURI,
			remoteAuthority,
			forceProfile: args.profile,
			forceTempProfile: args['profile-temp']
		};

		// Special case extension development
		if (args.extensionDevelopmentPath) {
			await this.windowsMainService.openExtensionDevelopmentHostWindow(args.extensionDevelopmentPath, baseConfig);
		}

		// Agents window
		else if (args['agents']) {
			usedWindows = await this.windowsMainService.openAgentsWindow(baseConfig);
		}

		// Start without file/folder arguments
		else if (!args._.length && !args['folder-uri'] && !args['file-uri']) {
			// --- Start Positron ---
			// A bare relaunch while Canvas mode is engaged means "bring
			// Positron forward", and the surface to bring forward is Canvas.
			// Falling through would restore the hidden IDE window or open a
			// fresh one beside Canvas -- the exact reveal the mode prevents.
			// A `--canvas` launch falls through on purpose: it re-enters
			// Canvas explicitly below, which handles the IDE window itself.
			if (!args.canvas && this.positronCanvasModeMainService.isEngaged) {
				this.logService.info('[canvas] Focusing Canvas for an argumentless launch while Canvas mode is engaged');
				BrowserWindow.getAllWindows().find(window => window.isVisible() && !window.isMinimized())?.focus();
				return;
			}
			// --- End Positron ---
			let openNewWindow = false;

			// Force new window
			if (args['new-window'] || baseConfig.forceProfile || baseConfig.forceTempProfile) {
				openNewWindow = true;
			}

			// Force reuse window
			else if (args['reuse-window']) {
				openNewWindow = false;
			}

			// Otherwise check for settings
			else {
				const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');
				const openWithoutArgumentsInNewWindowConfig = windowConfig?.openWithoutArgumentsInNewWindow || 'default' /* default */;
				switch (openWithoutArgumentsInNewWindowConfig) {
					case 'on':
						openNewWindow = true;
						break;
					case 'off':
						openNewWindow = false;
						break;
					default:
						openNewWindow = !isMacintosh; // prefer to restore running instance on macOS
				}
			}

			// Open new Window
			if (openNewWindow) {
				usedWindows = await this.windowsMainService.open({
					...baseConfig,
					forceNewWindow: true,
					forceEmpty: true
				});
			}

			// Focus existing window or open if none opened
			else {
				const lastActive = this.windowsMainService.getLastActiveWindow();
				if (lastActive) {
					this.windowsMainService.openExistingWindow(lastActive, baseConfig);

					usedWindows = [lastActive];
				} else {
					usedWindows = await this.windowsMainService.open({
						...baseConfig,
						forceEmpty: true
					});
				}
			}
		}

		// Start with file/folder arguments
		else {
			// --- Start Positron ---
			// An externally requested open must not land behind an engaged
			// Canvas window: untouched, it reveals the hidden IDE and blocks
			// on a workspace-trust dialog. `handleExternalOpen` holds or
			// releases the open per `CANVAS_EXTERNAL_OPEN_POLICY`; a `--canvas`
			// launch is a request for Canvas itself and is never routed away.
			const openWithArguments = () => this.windowsMainService.open({
				// --- End Positron ---
				...baseConfig,
				forceNewWindow: args['new-window'],
				preferNewWindow: !args['reuse-window'] && !args.wait,
				forceReuseWindow: args['reuse-window'],
				diffMode: args.diff,
				mergeMode: args.merge,
				addMode: args.add,
				removeMode: args.remove,
				noRecentEntry: !!args['skip-add-to-recently-opened'],
				gotoLineMode: args.goto
			});
			// --- Start Positron ---
			if (args.canvas) {
				usedWindows = await openWithArguments();
			} else {
				let opening: Promise<ICodeWindow[]> | undefined;
				// Awaited: with the exit-and-open policy the `open` callback
				// only runs once the engaged window has released Canvas mode
				// (or the release wait timed out), so `opening` is not
				// assigned until `handleExternalOpen` resolves.
				await this.positronCanvasModeMainService.handleExternalOpen(
					!!args.wait,
					() => { opening = openWithArguments(); },
					engagedWindowId => this.windowsMainService.getWindowById(engagedWindowId)?.sendWhenReady('vscode:runAction', CancellationToken.None, {
						id: 'positron.canvas.exit',
						from: 'menu',
					})
				);
				usedWindows = opening ? await opening : [];
			}
			// --- End Positron ---
		}

		// --- Start Positron ---
		// LaunchMainService handles requests forwarded by a second process. A
		// reused renderer consumed its startup arguments on an earlier launch, so
		// it only learns about Canvas intent as an action. Newly opened windows
		// carry the flag in their configuration instead; see
		// `selectCanvasLaunchWindow` for why they must not also get the action.
		if (args.canvas) {
			const canvasWindow = selectCanvasLaunchWindow(usedWindows, this.windowsMainService.getLastActiveWindow());
			if (canvasWindow) {
				canvasWindow.sendWhenReady('vscode:runAction', CancellationToken.None, {
					// The palette action, not the plain `positron.canvas.enter`
					// command: a forwarded `--canvas` is a user asking for Canvas
					// with no other surface to hear about a failure, and the
					// action is what turns a non-entry into a notification.
					// `runAction` ignores return values, so the plain command's
					// outcome would go nowhere.
					id: 'positron.canvas.open',
					from: 'menu',
				});
				canvasWindow.focus();
			}
		}
		// --- End Positron ---

		// If the other instance is waiting to be killed, we hook up a window listener if one window
		// is being used and only then resolve the startup promise which will kill this second instance.
		// In addition, we poll for the wait marker file to be deleted to return.
		if (waitMarkerFileURI && usedWindows.length === 1 && usedWindows[0]) {
			return Promise.race([
				usedWindows[0].whenClosedOrLoaded,
				whenDeleted(waitMarkerFileURI.fsPath)
			]).then(() => undefined, () => undefined);
		}
	}

	async getMainProcessId(): Promise<number> {
		this.logService.trace('Received request for process ID from other instance.');

		return process.pid;
	}
}
