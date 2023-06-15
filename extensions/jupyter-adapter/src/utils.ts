export class PromiseHandles<T> {
	resolve!: (value: T | Promise<T>) => void;
	reject!: (error: unknown) => void;
	promise: Promise<T>;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		})
	}
}
