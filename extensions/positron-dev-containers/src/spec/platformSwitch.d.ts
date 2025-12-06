// Type augmentations for PlatformSwitch to handle union types properly

import type { PlatformSwitch } from './spec-common/commonUtils';

declare module './spec-common/commonUtils' {
	// Allow PlatformSwitch functions to be callable
	export function platformDispatch<T extends (...args: any[]) => any>(
		platform: NodeJS.Platform,
		platformSwitch: PlatformSwitch<T>
	): T;

	export function platformDispatch<T>(
		platform: NodeJS.Platform,
		platformSwitch: PlatformSwitch<T>
	): T;
}
