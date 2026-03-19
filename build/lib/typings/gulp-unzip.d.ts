
declare module "gulp-unzip" {
	interface Options {
		keepEmpty?: boolean;
		filter?(entry: { path: string; type: string }): boolean;
	}

	function f(options?: Options): NodeJS.ReadWriteStream;

	/**
	 * This is required as per:
	 * https://github.com/microsoft/TypeScript/issues/5073
	 */
	namespace f { }

	export = f;
}
