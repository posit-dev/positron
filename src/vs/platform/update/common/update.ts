/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { upcast } from '../../../base/common/types.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface IUpdate {
	// Windows and Linux: 9a19815253d91900be5ec1016e0ecc7cc9a6950 (Commit Hash). Mac: 1.54.0 (Product Version)
	version: string;
	productVersion?: string;
	timestamp?: number;
	url?: string;
	sha256hash?: string;
	// --- Start Positron ---
	codeoss_version?: string;
	// --- End Positron ---
}

/**
 * Updates are run as a state machine:
 *
 *      Uninitialized
 *           ↓
 *          Idle
 *          ↓  ↑
 *   Checking for Updates  →  Available for Download
 *         ↓                    ↓
 *                     ←   Overwriting
 *     Downloading              ↑
 *                     →      Ready
 *         ↓                    ↑
 *     Downloaded      →     Updating
 *
 * Available: There is an update available for download (linux, darwin on metered connection).
 * Ready: Code will be updated as soon as it restarts (win32, darwin).
 * Downloaded: There is an update ready to be installed in the background (win32).
 */

export const enum StateType {
	Uninitialized = 'uninitialized',
	Idle = 'idle',
	Disabled = 'disabled',
	CheckingForUpdates = 'checking for updates',
	AvailableForDownload = 'available for download',
	Downloading = 'downloading',
	Downloaded = 'downloaded',
	Updating = 'updating',
	Ready = 'ready',
	Overwriting = 'overwriting',
}

export const enum UpdateType {
	Setup,
	Archive,
	Snap
}

export const enum DisablementReason {
	NotBuilt,
	DisabledByEnvironment,
	ManuallyDisabled,
	MissingConfiguration,
	InvalidConfiguration,
	RunningAsAdmin,
	EmbeddedApp,
}

export type Uninitialized = { type: StateType.Uninitialized };
export type Disabled = { type: StateType.Disabled; reason: DisablementReason };
export type Idle = { type: StateType.Idle; updateType: UpdateType; error?: string };
export type CheckingForUpdates = { type: StateType.CheckingForUpdates; explicit: boolean };
export type AvailableForDownload = { type: StateType.AvailableForDownload; update: IUpdate };
export type Downloading = { type: StateType.Downloading; update?: IUpdate; explicit: boolean; overwrite: boolean; downloadedBytes?: number; totalBytes?: number; startTime?: number };
export type Downloaded = { type: StateType.Downloaded; update: IUpdate; explicit: boolean; overwrite: boolean };
export type Updating = { type: StateType.Updating; update: IUpdate; currentProgress?: number; maxProgress?: number };
export type Ready = { type: StateType.Ready; update: IUpdate; explicit: boolean; overwrite: boolean };
export type Overwriting = { type: StateType.Overwriting; update: IUpdate; explicit: boolean };

export type State = Uninitialized | Disabled | Idle | CheckingForUpdates | AvailableForDownload | Downloading | Downloaded | Updating | Ready | Overwriting;

export const State = {
	Uninitialized: upcast<Uninitialized>({ type: StateType.Uninitialized }),
	Disabled: (reason: DisablementReason): Disabled => ({ type: StateType.Disabled, reason }),
	Idle: (updateType: UpdateType, error?: string): Idle => ({ type: StateType.Idle, updateType, error }),
	CheckingForUpdates: (explicit: boolean): CheckingForUpdates => ({ type: StateType.CheckingForUpdates, explicit }),
	AvailableForDownload: (update: IUpdate): AvailableForDownload => ({ type: StateType.AvailableForDownload, update }),
	Downloading: (update: IUpdate | undefined, explicit: boolean, overwrite: boolean, downloadedBytes?: number, totalBytes?: number, startTime?: number): Downloading => ({ type: StateType.Downloading, update, explicit, overwrite, downloadedBytes, totalBytes, startTime }),
	Downloaded: (update: IUpdate, explicit: boolean, overwrite: boolean): Downloaded => ({ type: StateType.Downloaded, update, explicit, overwrite }),
	Updating: (update: IUpdate, currentProgress?: number, maxProgress?: number): Updating => ({ type: StateType.Updating, update, currentProgress, maxProgress }),
	Ready: (update: IUpdate, explicit: boolean, overwrite: boolean): Ready => ({ type: StateType.Ready, update, explicit, overwrite }),
	Overwriting: (update: IUpdate, explicit: boolean): Overwriting => ({ type: StateType.Overwriting, update, explicit }),
};

export interface IAutoUpdater extends Event.NodeEventEmitter {
	setFeedURL(url: string): void;
	checkForUpdates(): void;
	applyUpdate?(): Promise<void>;
	quitAndInstall(): void;
}

export const IUpdateService = createDecorator<IUpdateService>('updateService');

export interface IUpdateService {
	readonly _serviceBrand: undefined;

	readonly onStateChange: Event<State>;
	readonly state: State;

	checkForUpdates(explicit: boolean): Promise<void>;
	downloadUpdate(explicit: boolean): Promise<void>;
	applyUpdate(): Promise<void>;
	quitAndInstall(): Promise<void>;

	/**
	 * @deprecated This method should not be used any more. It will be removed in a future release.
	*/
	isLatestVersion(): Promise<boolean | undefined>;
	_applySpecificUpdate(packagePath: string): Promise<void>;
	setInternalOrg(internalOrg: string | undefined): Promise<void>;

	// --- Start Positron ---
	updateActiveLanguages(languages: string[]): void;
	getReleaseNotes(): Promise<string>;
	resetTelemetryId(): void;
	// --- End Positron ---
}
