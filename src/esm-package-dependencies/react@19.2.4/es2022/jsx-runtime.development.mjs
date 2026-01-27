/* esm.sh - esbuild bundle(react@19.2.4/jsx-runtime) es2022 development */
import * as __0$ from "./react.development.mjs";
const require = n => { const e = m => typeof m.default < "u" ? m.default : m, c = m => Object.assign({ __esModule: true }, m); switch (n) { case "react": return e(__0$); default: throw new Error("module \"" + n + "\" not found"); } };
const __create = Object.create;
const __defProp = Object.defineProperty;
const __getOwnPropDesc = Object.getOwnPropertyDescriptor;
const __getOwnPropNames = Object.getOwnPropertyNames;
const __getProtoOf = Object.getPrototypeOf;
const __hasOwnProp = Object.prototype.hasOwnProperty;
const __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
	get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function (x) {
	if (typeof require !== "undefined") { return require.apply(this, arguments); }
	throw Error('Dynamic require of "' + x + '" is not supported');
});
const __commonJS = (cb, mod) => function __require2() {
	return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
const __export = (target, all) => {
	for (const name in all) { __defProp(target, name, { get: all[name], enumerable: true }); }
};
const __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") {
		for (const key of __getOwnPropNames(from)) {
			if (!__hasOwnProp.call(to, key) && key !== except) { __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable }); }
		}
	}
	return to;
};
const __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
const __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
	// If the importer is in node compatibility mode or this is not an ESM
	// file that has been converted to a CommonJS file using a Babel-
	// compatible transform (i.e. "__esModule" has not been set), then set
	// "default" to the CommonJS "module.exports" for node compatibility.
	isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
	mod
));

// ../esmd/npm/react@19.2.4/node_modules/.pnpm/react@19.2.4/node_modules/react/cjs/react-jsx-runtime.development.js
const require_react_jsx_runtime_development = __commonJS({
	"../esmd/npm/react@19.2.4/node_modules/.pnpm/react@19.2.4/node_modules/react/cjs/react-jsx-runtime.development.js"(exports) {
		"use strict";
		(function () {
			function getComponentNameFromType(type) {
				if (null == type) { return null; }
				if ("function" === typeof type) { return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null; }
				if ("string" === typeof type) { return type; }
				switch (type) {
					case REACT_FRAGMENT_TYPE:
						return "Fragment";
					case REACT_PROFILER_TYPE:
						return "Profiler";
					case REACT_STRICT_MODE_TYPE:
						return "StrictMode";
					case REACT_SUSPENSE_TYPE:
						return "Suspense";
					case REACT_SUSPENSE_LIST_TYPE:
						return "SuspenseList";
					case REACT_ACTIVITY_TYPE:
						return "Activity";
				}
				if ("object" === typeof type) {
					switch ("number" === typeof type.tag && console.error(
						"Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
					), type.$$typeof) {
						case REACT_PORTAL_TYPE:
							return "Portal";
						case REACT_CONTEXT_TYPE:
							return type.displayName || "Context";
						case REACT_CONSUMER_TYPE:
							return (type._context.displayName || "Context") + ".Consumer";
						case REACT_FORWARD_REF_TYPE:
							var innerType = type.render;
							type = type.displayName;
							type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
							return type;
						case REACT_MEMO_TYPE:
							return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
						case REACT_LAZY_TYPE:
							innerType = type._payload;
							type = type._init;
							try {
								return getComponentNameFromType(type(innerType));
							} catch (x) {
							}
					}
				}
				return null;
			}
			function testStringCoercion(value) {
				return "" + value;
			}
			function checkKeyStringCoercion(value) {
				try {
					testStringCoercion(value);
					var JSCompiler_inline_result = false;
				} catch (e) {
					JSCompiler_inline_result = true;
				}
				if (JSCompiler_inline_result) {
					JSCompiler_inline_result = console;
					const JSCompiler_temp_const = JSCompiler_inline_result.error;
					const JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
					JSCompiler_temp_const.call(
						JSCompiler_inline_result,
						"The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
						JSCompiler_inline_result$jscomp$0
					);
					return testStringCoercion(value);
				}
			}
			function getTaskName(type) {
				if (type === REACT_FRAGMENT_TYPE) { return "<>"; }
				if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE) { return "<...>"; }
				try {
					const name = getComponentNameFromType(type);
					return name ? "<" + name + ">" : "<...>";
				} catch (x) {
					return "<...>";
				}
			}
			function getOwner() {
				const dispatcher = ReactSharedInternals.A;
				return null === dispatcher ? null : dispatcher.getOwner();
			}
			function UnknownOwner() {
				return Error("react-stack-top-frame");
			}
			function hasValidKey(config) {
				if (hasOwnProperty.call(config, "key")) {
					const getter = Object.getOwnPropertyDescriptor(config, "key").get;
					if (getter && getter.isReactWarning) { return false; }
				}
				return void 0 !== config.key;
			}
			function defineKeyPropWarningGetter(props, displayName) {
				function warnAboutAccessingKey() {
					specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
						"%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
						displayName
					));
				}
				warnAboutAccessingKey.isReactWarning = true;
				Object.defineProperty(props, "key", {
					get: warnAboutAccessingKey,
					configurable: true
				});
			}
			function elementRefGetterWithDeprecationWarning() {
				let componentName = getComponentNameFromType(this.type);
				didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
					"Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
				));
				componentName = this.props.ref;
				return void 0 !== componentName ? componentName : null;
			}
			function ReactElement(type, key, props, owner, debugStack, debugTask) {
				const refProp = props.ref;
				type = {
					$$typeof: REACT_ELEMENT_TYPE,
					type,
					key,
					props,
					_owner: owner
				};
				null !== (void 0 !== refProp ? refProp : null) ? Object.defineProperty(type, "ref", {
					enumerable: false,
					get: elementRefGetterWithDeprecationWarning
				}) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
				type._store = {};
				Object.defineProperty(type._store, "validated", {
					configurable: false,
					enumerable: false,
					writable: true,
					value: 0
				});
				Object.defineProperty(type, "_debugInfo", {
					configurable: false,
					enumerable: false,
					writable: true,
					value: null
				});
				Object.defineProperty(type, "_debugStack", {
					configurable: false,
					enumerable: false,
					writable: true,
					value: debugStack
				});
				Object.defineProperty(type, "_debugTask", {
					configurable: false,
					enumerable: false,
					writable: true,
					value: debugTask
				});
				Object.freeze && (Object.freeze(type.props), Object.freeze(type));
				return type;
			}
			function jsxDEVImpl(type, config, maybeKey, isStaticChildren, debugStack, debugTask) {
				let children = config.children;
				if (void 0 !== children) {
					if (isStaticChildren) {
						if (isArrayImpl(children)) {
							for (isStaticChildren = 0; isStaticChildren < children.length; isStaticChildren++) { validateChildKeys(children[isStaticChildren]); }
							Object.freeze && Object.freeze(children);
						} else {
							console.error(
								"React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead."
							);
						}
					}
					else { validateChildKeys(children); }
				}
				if (hasOwnProperty.call(config, "key")) {
					children = getComponentNameFromType(type);
					let keys = Object.keys(config).filter(function (k) {
						return "key" !== k;
					});
					isStaticChildren = 0 < keys.length ? "{key: someKey, " + keys.join(": ..., ") + ": ...}" : "{key: someKey}";
					didWarnAboutKeySpread[children + isStaticChildren] || (keys = 0 < keys.length ? "{" + keys.join(": ..., ") + ": ...}" : "{}", console.error(
						'A props object containing a "key" prop is being spread into JSX:\n  let props = %s;\n  <%s {...props} />\nReact keys must be passed directly to JSX without using spread:\n  let props = %s;\n  <%s key={someKey} {...props} />',
						isStaticChildren,
						children,
						keys,
						children
					), didWarnAboutKeySpread[children + isStaticChildren] = true);
				}
				children = null;
				void 0 !== maybeKey && (checkKeyStringCoercion(maybeKey), children = "" + maybeKey);
				hasValidKey(config) && (checkKeyStringCoercion(config.key), children = "" + config.key);
				if ("key" in config) {
					maybeKey = {};
					for (const propName in config) { "key" !== propName && (maybeKey[propName] = config[propName]); }
				} else { maybeKey = config; }
				children && defineKeyPropWarningGetter(
					maybeKey,
					"function" === typeof type ? type.displayName || type.name || "Unknown" : type
				);
				return ReactElement(
					type,
					children,
					maybeKey,
					getOwner(),
					debugStack,
					debugTask
				);
			}
			function validateChildKeys(node) {
				isValidElement(node) ? node._store && (node._store.validated = 1) : "object" === typeof node && null !== node && node.$$typeof === REACT_LAZY_TYPE && ("fulfilled" === node._payload.status ? isValidElement(node._payload.value) && node._payload.value._store && (node._payload.value._store.validated = 1) : node._store && (node._store.validated = 1));
			}
			function isValidElement(object) {
				return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
			}
			var React = __require("react"), REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = Symbol.for("react.profiler"), REACT_CONSUMER_TYPE = Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = Symbol.for("react.memo"), REACT_LAZY_TYPE = Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = Symbol.for("react.activity"), REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"), ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, hasOwnProperty = Object.prototype.hasOwnProperty, isArrayImpl = Array.isArray, createTask = console.createTask ? console.createTask : function () {
				return null;
			};
			React = {
				react_stack_bottom_frame: function (callStackForError) {
					return callStackForError();
				}
			};
			let specialPropKeyWarningShown;
			var didWarnAboutElementRef = {};
			const unknownOwnerDebugStack = React.react_stack_bottom_frame.bind(
				React,
				UnknownOwner
			)();
			const unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
			var didWarnAboutKeySpread = {};
			exports.Fragment = REACT_FRAGMENT_TYPE;
			exports.jsx = function (type, config, maybeKey) {
				const trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
				return jsxDEVImpl(
					type,
					config,
					maybeKey,
					false,
					trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
					trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
				);
			};
			exports.jsxs = function (type, config, maybeKey) {
				const trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
				return jsxDEVImpl(
					type,
					config,
					maybeKey,
					true,
					trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
					trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
				);
			};
		})();
	}
});

// ../esmd/npm/react@19.2.4/node_modules/.pnpm/react@19.2.4/node_modules/react/jsx-runtime.js
const require_jsx_runtime = __commonJS({
	"../esmd/npm/react@19.2.4/node_modules/.pnpm/react@19.2.4/node_modules/react/jsx-runtime.js"(exports, module) {
		"use strict";
		if (false) {
			module.exports = null;
		} else {
			module.exports = require_react_jsx_runtime_development();
		}
	}
});

// ../esmd/npm/react@19.2.4/build.js
const build_exports = {};
__export(build_exports, {
	Fragment: () => Fragment,
	default: () => build_default,
	jsx: () => jsx,
	jsxs: () => jsxs
});
const __module = __toESM(require_jsx_runtime());
__reExport(build_exports, __toESM(require_jsx_runtime()));
var { Fragment, jsx, jsxs } = __module;
const { default: __default, ...__rest } = __module;
var build_default = __default !== void 0 ? __default : __rest;
export {
	Fragment,
	build_default as default,
	jsx,
	jsxs
};
/*! Bundled license information:

react/cjs/react-jsx-runtime.development.js:
  (**
   * @license React
   * react-jsx-runtime.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
//# sourceMappingURL=jsx-runtime.development.js.map