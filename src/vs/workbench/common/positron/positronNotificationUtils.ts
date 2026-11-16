/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProgress, IProgressService, IProgressStep, ProgressLocation } from '../../../platform/progress/common/progress.js';

/**
 * How long a delayed progress notification waits before its toast appears.
 */
export const DELAYED_NOTIFICATION_PROGRESS_DELAY_MS = 10_000;

export interface IDelayedNotificationProgressOptions {
	/**
	 * Shown in the status bar and, once the delay passes, in the notification.
	 */
	readonly title: string;

	/**
	 * Whether the notification offers a Cancel button. Defaults to true.
	 */
	readonly cancellable?: boolean;

	/**
	 * Milliseconds before the toast appears. Defaults to
	 * DELAYED_NOTIFICATION_PROGRESS_DELAY_MS.
	 */
	readonly notificationDelay?: number;
}

/**
 * Runs a task with two layers of progress feedback, both cancellable:
 *
 * - A status bar spinner with the title, shown right away (the progress
 *   service waits 150 ms so a near-instant task shows nothing). A Window
 *   progress with no command is implemented by the progress service as a silent
 *   notification, so this layer also has an entry in the notification center
 *   with its own Cancel button, and clicking the spinner opens that center. It
 *   stays up for the whole task, including while the toast is visible.
 * - A toast with a Cancel button, shown only if the task is still running after
 *   `notificationDelay`. A task that finishes sooner never pops a toast over
 *   whatever the user is looking at.
 *
 * `onDidCancel` is called when the user cancels from either layer.
 */
export function withDelayedNotificationProgress<R>(
	progressService: IProgressService,
	options: IDelayedNotificationProgressOptions,
	task: (progress: IProgress<IProgressStep>) => Promise<R>,
	onDidCancel?: (choice?: number) => void
): Promise<R> {
	return progressService.withProgress(
		{ location: ProgressLocation.Window, title: options.title, cancellable: options.cancellable ?? true },
		() => progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: options.title,
				cancellable: options.cancellable ?? true,
				delay: options.notificationDelay ?? DELAYED_NOTIFICATION_PROGRESS_DELAY_MS
			},
			task,
			onDidCancel
		),
		onDidCancel
	);
}
