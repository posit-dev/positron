// Type definitions to allow compilation of spec directory code

// Augment catch clause error types to allow property access
declare global {
	interface Error {
		code?: string | number;
		signal?: string;
		cmdOutput?: string;
		stderr?: string;
		Message?: string;
	}

	// Allow PlatformSwitch to be used as both an object and callable
	interface PlatformSwitch<T> extends Function {
		posix: T;
		win32: T;
	}
}

export { };
