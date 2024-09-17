# reh-web

> [!IMPORTANT]
> **Please don't edit files in this directory directly.**

> [!NOTE]
> Please commit the created/updated `package.json` and `yarn.lock` files in this directory when they are updated.

The [package.json](./package.json) file in this directory is a merge of the [remote/package.json](../package.json) file and the [remote/web/package.json](../web/package.json) file, as the packages needed to build reh-web are a combination of the remote and web packages.

The package.json file in this directory is created/updated via the [build/npm/postinstall.js](../../build/npm/postinstall.js) script. That script is automatically run after `yarn` is executed in the top-level directory and updates the package.json, yarn.lock and node_modules in this directory.

Since the files in this directory are auto-generated via the `postinstall.js` script, please don't edit them directly. Running `yarn` at the top-level of the project will kick off updates to these files.

If you're building on Windows, it's possible you might see 👻 invisible 👻 unstaged changes to the [package.json](./package.json) file.
- **The tl;dr**: if this happens, stage the file and it should disappear and you shouldn't have to think about this again.
- **The details**: this should only happen the first time you run `yarn` (and maybe also if you clear the Git index/cache) on Windows. The "invisible" changes occur after regenerating package.json on Windows, where CRLF is used for line endings instead of LF. Git line ending normalization has been set to LF for package.json via [.gitattributes](./.gitattributes) to avoid changing the line endings when the file is generated on different platforms. So, when you stage the file, the conversion to LF happens and it will no longer appear as modified.
