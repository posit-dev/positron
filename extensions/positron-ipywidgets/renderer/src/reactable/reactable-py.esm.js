/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*! Bundled license information:

react-is/cjs/react-is.development.js:
(** @license React v16.13.1
	* react-is.development.js
	*
	* Copyright (c) Facebook, Inc. and its affiliates.
	*
	* This source code is licensed under the MIT license found in the
	* LICENSE file in the root directory of this source tree.
	*)

object-assign/index.js:
	(*
	object-assign
	(c) Sindre Sorhus
	@license MIT
	*)
*/

import * as requireReact from "react";
import * as requireReactDom from "react-dom";
function require(m) {
	if (m === "react") return requireReact;
	if (m === "react-dom") return requireReactDom;
	throw new Error("Unknown module" + m);
}
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) =>
	typeof require !== "undefined"
		? require
		: typeof Proxy !== "undefined"
			? new Proxy(x, {
				get: (a, b) => (typeof require !== "undefined" ? require : a)[b],
			})
			: x)(function (x) {
				if (typeof require !== "undefined") return require.apply(this, arguments);
				throw Error('Dynamic require of "' + x + '" is not supported');
			});
var __commonJS = (cb, mod) =>
	function __require2() {
		return (
			mod ||
			(0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
			mod.exports
		);
	};
var __copyProps = (to, from2, except, desc) => {
	if ((from2 && typeof from2 === "object") || typeof from2 === "function") {
		for (let key of __getOwnPropNames(from2))
			if (!__hasOwnProp.call(to, key) && key !== except)
				__defProp(to, key, {
					get: () => from2[key],
					enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable,
				});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (
	(target = mod != null ? __create(__getProtoOf(mod)) : {}),
	__copyProps(
		// If the importer is in node compatibility mode or this is not an ESM
		// file that has been converted to a CommonJS file using a Babel-
		// compatible transform (i.e. "__esModule" has not been set), then set
		// "default" to the CommonJS "module.exports" for node compatibility.
		isNodeMode || !mod || !mod.__esModule
			? __defProp(target, "default", { value: mod, enumerable: true })
			: target,
		mod
	)
);

// tmp/reactable/node_modules/react-table/dist/react-table.development.js
var require_react_table_development = __commonJS({
	"tmp/reactable/node_modules/react-table/dist/react-table.development.js"(
		exports,
		module
	) {
		(function (global, factory) {
			typeof exports === "object" && typeof module !== "undefined"
				? factory(exports, __require("react"))
				: typeof define === "function" && define.amd
					? define(["exports", "react"], factory)
					: ((global = global || self),
						factory((global.ReactTable = {}), global.React));
		})(exports, function (exports2, React12) {
			"use strict";
			React12 =
				React12 && Object.prototype.hasOwnProperty.call(React12, "default")
					? React12["default"]
					: React12;
			function asyncGeneratorStep(
				gen,
				resolve,
				reject,
				_next,
				_throw,
				key,
				arg
			) {
				try {
					var info = gen[key](arg);
					var value = info.value;
				} catch (error2) {
					reject(error2);
					return;
				}
				if (info.done) {
					resolve(value);
				} else {
					Promise.resolve(value).then(_next, _throw);
				}
			}
			function _asyncToGenerator(fn) {
				return function () {
					var self2 = this,
						args = arguments;
					return new Promise(function (resolve, reject) {
						var gen = fn.apply(self2, args);
						function _next(value) {
							asyncGeneratorStep(
								gen,
								resolve,
								reject,
								_next,
								_throw,
								"next",
								value
							);
						}
						function _throw(err) {
							asyncGeneratorStep(
								gen,
								resolve,
								reject,
								_next,
								_throw,
								"throw",
								err
							);
						}
						_next(void 0);
					});
				};
			}
			function _extends() {
				_extends =
					Object.assign ||
					function (target) {
						for (var i = 1; i < arguments.length; i++) {
							var source = arguments[i];
							for (var key in source) {
								if (Object.prototype.hasOwnProperty.call(source, key)) {
									target[key] = source[key];
								}
							}
						}
						return target;
					};
				return _extends.apply(this, arguments);
			}
			function _objectWithoutPropertiesLoose(source, excluded) {
				if (source == null) return {};
				var target = {};
				var sourceKeys = Object.keys(source);
				var key, i;
				for (i = 0; i < sourceKeys.length; i++) {
					key = sourceKeys[i];
					if (excluded.indexOf(key) >= 0) continue;
					target[key] = source[key];
				}
				return target;
			}
			function _toPrimitive(input, hint) {
				if (typeof input !== "object" || input === null) return input;
				var prim = input[Symbol.toPrimitive];
				if (prim !== void 0) {
					var res = prim.call(input, hint || "default");
					if (typeof res !== "object") return res;
					throw new TypeError("@@toPrimitive must return a primitive value.");
				}
				return (hint === "string" ? String : Number)(input);
			}
			function _toPropertyKey(arg) {
				var key = _toPrimitive(arg, "string");
				return typeof key === "symbol" ? key : String(key);
			}
			var renderErr = "Renderer Error \u261D\uFE0F";
			var actions5 = {
				init: "init",
			};
			var defaultRenderer = function defaultRenderer2(_ref) {
				var _ref$value = _ref.value,
					value = _ref$value === void 0 ? "" : _ref$value;
				return value;
			};
			var emptyRenderer = function emptyRenderer2() {
				return React12.createElement(React12.Fragment, null, "\xA0");
			};
			var defaultColumn2 = {
				Cell: defaultRenderer,
				width: 150,
				minWidth: 0,
				maxWidth: Number.MAX_SAFE_INTEGER,
			};
			function mergeProps() {
				for (
					var _len = arguments.length, propList = new Array(_len), _key = 0;
					_key < _len;
					_key++
				) {
					propList[_key] = arguments[_key];
				}
				return propList.reduce(function (props, next2) {
					var style = next2.style,
						className = next2.className,
						rest = _objectWithoutPropertiesLoose(next2, ["style", "className"]);
					props = _extends({}, props, {}, rest);
					if (style) {
						props.style = props.style
							? _extends({}, props.style || {}, {}, style || {})
							: style;
					}
					if (className) {
						props.className = props.className
							? props.className + " " + className
							: className;
					}
					if (props.className === "") {
						delete props.className;
					}
					return props;
				}, {});
			}
			function handlePropGetter(prevProps, userProps, meta) {
				if (typeof userProps === "function") {
					return handlePropGetter({}, userProps(prevProps, meta));
				}
				if (Array.isArray(userProps)) {
					return mergeProps.apply(void 0, [prevProps].concat(userProps));
				}
				return mergeProps(prevProps, userProps);
			}
			var makePropGetter5 = function makePropGetter6(hooks, meta) {
				if (meta === void 0) {
					meta = {};
				}
				return function (userProps) {
					if (userProps === void 0) {
						userProps = {};
					}
					return [].concat(hooks, [userProps]).reduce(function (prev2, next2) {
						return handlePropGetter(
							prev2,
							next2,
							_extends({}, meta, {
								userProps,
							})
						);
					}, {});
				};
			};
			var reduceHooks = function reduceHooks2(
				hooks,
				initial,
				meta,
				allowUndefined
			) {
				if (meta === void 0) {
					meta = {};
				}
				return hooks.reduce(function (prev2, next2) {
					var nextValue = next2(prev2, meta);
					{
						if (!allowUndefined && typeof nextValue === "undefined") {
							console.info(next2);
							throw new Error(
								"React Table: A reducer hook \u261D\uFE0F just returned undefined! This is not allowed."
							);
						}
					}
					return nextValue;
				}, initial);
			};
			var loopHooks = function loopHooks2(hooks, context, meta) {
				if (meta === void 0) {
					meta = {};
				}
				return hooks.forEach(function (hook) {
					var nextValue = hook(context, meta);
					{
						if (typeof nextValue !== "undefined") {
							console.info(hook, nextValue);
							throw new Error(
								"React Table: A loop-type hook \u261D\uFE0F just returned a value! This is not allowed."
							);
						}
					}
				});
			};
			function ensurePluginOrder6(plugins, befores, pluginName4, afters) {
				if (afters) {
					throw new Error(
						'Defining plugins in the "after" section of ensurePluginOrder is no longer supported (see plugin ' +
						pluginName4 +
						")"
					);
				}
				var pluginIndex = plugins.findIndex(function (plugin) {
					return plugin.pluginName === pluginName4;
				});
				if (pluginIndex === -1) {
					{
						throw new Error(
							'The plugin "' +
							pluginName4 +
							`" was not found in the plugin list!
This usually means you need to need to name your plugin hook by setting the 'pluginName' property of the hook function, eg:

	` +
							pluginName4 +
							".pluginName = '" +
							pluginName4 +
							"'\n"
						);
					}
				}
				befores.forEach(function (before) {
					var beforeIndex = plugins.findIndex(function (plugin) {
						return plugin.pluginName === before;
					});
					if (beforeIndex > -1 && beforeIndex > pluginIndex) {
						{
							throw new Error(
								"React Table: The " +
								pluginName4 +
								" plugin hook must be placed after the " +
								before +
								" plugin hook!"
							);
						}
					}
				});
			}
			function functionalUpdate2(updater, old) {
				return typeof updater === "function" ? updater(old) : updater;
			}
			function useGetLatest8(obj) {
				var ref = React12.useRef();
				ref.current = obj;
				return React12.useCallback(function () {
					return ref.current;
				}, []);
			}
			var safeUseLayoutEffect2 =
				typeof document !== "undefined"
					? React12.useLayoutEffect
					: React12.useEffect;
			function useMountedLayoutEffect6(fn, deps) {
				var mountedRef = React12.useRef(false);
				safeUseLayoutEffect2(function () {
					if (mountedRef.current) {
						fn();
					}
					mountedRef.current = true;
				}, deps);
			}
			function useAsyncDebounce2(defaultFn, defaultWait) {
				if (defaultWait === void 0) {
					defaultWait = 0;
				}
				var debounceRef = React12.useRef({});
				var getDefaultFn = useGetLatest8(defaultFn);
				var getDefaultWait = useGetLatest8(defaultWait);
				return React12.useCallback(
					/* @__PURE__ */(function () {
						var _ref2 = _asyncToGenerator(
							/* @__PURE__ */ regeneratorRuntime.mark(function _callee2() {
							var _len2,
								args,
								_key2,
								_args2 = arguments;
							return regeneratorRuntime.wrap(function _callee2$(_context2) {
								while (1) {
									switch ((_context2.prev = _context2.next)) {
										case 0:
											for (
												_len2 = _args2.length,
												args = new Array(_len2),
												_key2 = 0;
												_key2 < _len2;
												_key2++
											) {
												args[_key2] = _args2[_key2];
											}
											if (!debounceRef.current.promise) {
												debounceRef.current.promise = new Promise(function (
													resolve,
													reject
												) {
													debounceRef.current.resolve = resolve;
													debounceRef.current.reject = reject;
												});
											}
											if (debounceRef.current.timeout) {
												clearTimeout(debounceRef.current.timeout);
											}
											debounceRef.current.timeout = setTimeout(
													/* @__PURE__ */ _asyncToGenerator(
														/* @__PURE__ */ regeneratorRuntime.mark(
												function _callee() {
													return regeneratorRuntime.wrap(
														function _callee$(_context) {
															while (1) {
																switch ((_context.prev = _context.next)) {
																	case 0:
																		delete debounceRef.current.timeout;
																		_context.prev = 1;
																		_context.t0 = debounceRef.current;
																		_context.next = 5;
																		return getDefaultFn().apply(
																			void 0,
																			args
																		);
																	case 5:
																		_context.t1 = _context.sent;
																		_context.t0.resolve.call(
																			_context.t0,
																			_context.t1
																		);
																		_context.next = 12;
																		break;
																	case 9:
																		_context.prev = 9;
																		_context.t2 = _context["catch"](1);
																		debounceRef.current.reject(
																			_context.t2
																		);
																	case 12:
																		_context.prev = 12;
																		delete debounceRef.current.promise;
																		return _context.finish(12);
																	case 15:
																	case "end":
																		return _context.stop();
																}
															}
														},
														_callee,
														null,
														[[1, 9, 12, 15]]
													);
												}
											)
											),
												getDefaultWait()
											);
											return _context2.abrupt(
												"return",
												debounceRef.current.promise
											);
										case 5:
										case "end":
											return _context2.stop();
									}
								}
							}, _callee2);
						})
						);
						return function () {
							return _ref2.apply(this, arguments);
						};
					})(),
					[getDefaultFn, getDefaultWait]
				);
			}
			function makeRenderer(instance, column2, meta) {
				if (meta === void 0) {
					meta = {};
				}
				return function (type, userProps) {
					if (userProps === void 0) {
						userProps = {};
					}
					var Comp = typeof type === "string" ? column2[type] : type;
					if (typeof Comp === "undefined") {
						console.info(column2);
						throw new Error(renderErr);
					}
					return flexRender(
						Comp,
						_extends(
							{},
							instance,
							{
								column: column2,
							},
							meta,
							{},
							userProps
						)
					);
				};
			}
			function flexRender(Comp, props) {
				return isReactComponent(Comp)
					? React12.createElement(Comp, props)
					: Comp;
			}
			function isReactComponent(component) {
				return (
					isClassComponent(component) ||
					typeof component === "function" ||
					isExoticComponent(component)
				);
			}
			function isClassComponent(component) {
				return (
					typeof component === "function" &&
					(function () {
						var proto = Object.getPrototypeOf(component);
						return proto.prototype && proto.prototype.isReactComponent;
					})()
				);
			}
			function isExoticComponent(component) {
				return (
					typeof component === "object" &&
					typeof component.$$typeof === "symbol" &&
					["react.memo", "react.forward_ref"].includes(
						component.$$typeof.description
					)
				);
			}
			function linkColumnStructure(columns, parent, depth) {
				if (depth === void 0) {
					depth = 0;
				}
				return columns.map(function (column2) {
					column2 = _extends({}, column2, {
						parent,
						depth,
					});
					assignColumnAccessor(column2);
					if (column2.columns) {
						column2.columns = linkColumnStructure(
							column2.columns,
							column2,
							depth + 1
						);
					}
					return column2;
				});
			}
			function flattenColumns(columns) {
				return flattenBy2(columns, "columns");
			}
			function assignColumnAccessor(column2) {
				var id = column2.id,
					accessor = column2.accessor,
					Header = column2.Header;
				if (typeof accessor === "string") {
					id = id || accessor;
					var accessorPath = accessor.split(".");
					accessor = function accessor2(row) {
						return getBy(row, accessorPath);
					};
				}
				if (!id && typeof Header === "string" && Header) {
					id = Header;
				}
				if (!id && column2.columns) {
					console.error(column2);
					throw new Error(
						'A column ID (or unique "Header" value) is required!'
					);
				}
				if (!id) {
					console.error(column2);
					throw new Error("A column ID (or string accessor) is required!");
				}
				Object.assign(column2, {
					id,
					accessor,
				});
				return column2;
			}
			function decorateColumn(column2, userDefaultColumn) {
				if (!userDefaultColumn) {
					throw new Error();
				}
				Object.assign(
					column2,
					_extends(
						{
							// Make sure there is a fallback header, just in case
							Header: emptyRenderer,
							Footer: emptyRenderer,
						},
						defaultColumn2,
						{},
						userDefaultColumn,
						{},
						column2
					)
				);
				Object.assign(column2, {
					originalWidth: column2.width,
				});
				return column2;
			}
			function makeHeaderGroups(
				allColumns2,
				defaultColumn3,
				additionalHeaderProperties
			) {
				if (additionalHeaderProperties === void 0) {
					additionalHeaderProperties = function additionalHeaderProperties2() {
						return {};
					};
				}
				var headerGroups = [];
				var scanColumns = allColumns2;
				var uid = 0;
				var getUID = function getUID2() {
					return uid++;
				};
				var _loop = function _loop2() {
					var headerGroup = {
						headers: [],
					};
					var parentColumns = [];
					var hasParents = scanColumns.some(function (d) {
						return d.parent;
					});
					scanColumns.forEach(function (column2) {
						var latestParentColumn = [].concat(parentColumns).reverse()[0];
						var newParent;
						if (hasParents) {
							if (column2.parent) {
								newParent = _extends(
									{},
									column2.parent,
									{
										originalId: column2.parent.id,
										id: column2.parent.id + "_" + getUID(),
										headers: [column2],
									},
									additionalHeaderProperties(column2)
								);
							} else {
								var originalId = column2.id + "_placeholder";
								newParent = decorateColumn(
									_extends(
										{
											originalId,
											id: column2.id + "_placeholder_" + getUID(),
											placeholderOf: column2,
											headers: [column2],
										},
										additionalHeaderProperties(column2)
									),
									defaultColumn3
								);
							}
							if (
								latestParentColumn &&
								latestParentColumn.originalId === newParent.originalId
							) {
								latestParentColumn.headers.push(column2);
							} else {
								parentColumns.push(newParent);
							}
						}
						headerGroup.headers.push(column2);
					});
					headerGroups.push(headerGroup);
					scanColumns = parentColumns;
				};
				while (scanColumns.length) {
					_loop();
				}
				return headerGroups.reverse();
			}
			var pathObjCache = /* @__PURE__ */ new Map();
			function getBy(obj, path, def) {
				if (!path) {
					return obj;
				}
				var cacheKey = typeof path === "function" ? path : JSON.stringify(path);
				var pathObj =
					pathObjCache.get(cacheKey) ||
					(function () {
						var pathObj2 = makePathArray(path);
						pathObjCache.set(cacheKey, pathObj2);
						return pathObj2;
					})();
				var val;
				try {
					val = pathObj.reduce(function (cursor2, pathPart) {
						return cursor2[pathPart];
					}, obj);
				} catch (e) { }
				return typeof val !== "undefined" ? val : def;
			}
			function getFirstDefined2() {
				for (
					var _len = arguments.length, args = new Array(_len), _key = 0;
					_key < _len;
					_key++
				) {
					args[_key] = arguments[_key];
				}
				for (var i = 0; i < args.length; i += 1) {
					if (typeof args[i] !== "undefined") {
						return args[i];
					}
				}
			}
			function isFunction(a) {
				if (typeof a === "function") {
					return a;
				}
			}
			function flattenBy2(arr, key) {
				var flat = [];
				var recurse = function recurse2(arr2) {
					arr2.forEach(function (d) {
						if (!d[key]) {
							flat.push(d);
						} else {
							recurse2(d[key]);
						}
					});
				};
				recurse(arr);
				return flat;
			}
			function expandRows2(rows, _ref) {
				var manualExpandedKey = _ref.manualExpandedKey,
					expanded = _ref.expanded,
					_ref$expandSubRows = _ref.expandSubRows,
					expandSubRows =
						_ref$expandSubRows === void 0 ? true : _ref$expandSubRows;
				var expandedRows = [];
				var handleRow = function handleRow2(row, addToExpandedRows) {
					if (addToExpandedRows === void 0) {
						addToExpandedRows = true;
					}
					row.isExpanded =
						(row.original && row.original[manualExpandedKey]) ||
						expanded[row.id];
					row.canExpand = row.subRows && !!row.subRows.length;
					if (addToExpandedRows) {
						expandedRows.push(row);
					}
					if (row.subRows && row.subRows.length && row.isExpanded) {
						row.subRows.forEach(function (row2) {
							return handleRow2(row2, expandSubRows);
						});
					}
				};
				rows.forEach(function (row) {
					return handleRow(row);
				});
				return expandedRows;
			}
			function getFilterMethod(filter, userFilterTypes, filterTypes2) {
				return (
					isFunction(filter) ||
					userFilterTypes[filter] ||
					filterTypes2[filter] ||
					filterTypes2.text
				);
			}
			function shouldAutoRemoveFilter(autoRemove, value, column2) {
				return autoRemove
					? autoRemove(value, column2)
					: typeof value === "undefined";
			}
			function unpreparedAccessWarning() {
				throw new Error(
					"React-Table: You have not called prepareRow(row) one or more rows you are attempting to render."
				);
			}
			var passiveSupported2 = null;
			function passiveEventSupported2() {
				if (typeof passiveSupported2 === "boolean") return passiveSupported2;
				var supported = false;
				try {
					var options = {
						get passive() {
							supported = true;
							return false;
						},
					};
					window.addEventListener("test", null, options);
					window.removeEventListener("test", null, options);
				} catch (err) {
					supported = false;
				}
				passiveSupported2 = supported;
				return passiveSupported2;
			}
			var reOpenBracket = /\[/g;
			var reCloseBracket = /\]/g;
			function makePathArray(obj) {
				return flattenDeep(obj)
					.map(function (d) {
						return String(d).replace(".", "_");
					})
					.join(".")
					.replace(reOpenBracket, ".")
					.replace(reCloseBracket, "")
					.split(".");
			}
			function flattenDeep(arr, newArr) {
				if (newArr === void 0) {
					newArr = [];
				}
				if (!Array.isArray(arr)) {
					newArr.push(arr);
				} else {
					for (var i = 0; i < arr.length; i += 1) {
						flattenDeep(arr[i], newArr);
					}
				}
				return newArr;
			}
			var defaultGetTableProps = function defaultGetTableProps2(props) {
				return _extends(
					{
						role: "table",
					},
					props
				);
			};
			var defaultGetTableBodyProps = function defaultGetTableBodyProps2(props) {
				return _extends(
					{
						role: "rowgroup",
					},
					props
				);
			};
			var defaultGetHeaderProps = function defaultGetHeaderProps2(props, _ref) {
				var column2 = _ref.column;
				return _extends(
					{
						key: "header_" + column2.id,
						colSpan: column2.totalVisibleHeaderCount,
						role: "columnheader",
					},
					props
				);
			};
			var defaultGetFooterProps = function defaultGetFooterProps2(
				props,
				_ref2
			) {
				var column2 = _ref2.column;
				return _extends(
					{
						key: "footer_" + column2.id,
						colSpan: column2.totalVisibleHeaderCount,
					},
					props
				);
			};
			var defaultGetHeaderGroupProps = function defaultGetHeaderGroupProps2(
				props,
				_ref3
			) {
				var index = _ref3.index;
				return _extends(
					{
						key: "headerGroup_" + index,
						role: "row",
					},
					props
				);
			};
			var defaultGetFooterGroupProps = function defaultGetFooterGroupProps2(
				props,
				_ref4
			) {
				var index = _ref4.index;
				return _extends(
					{
						key: "footerGroup_" + index,
					},
					props
				);
			};
			var defaultGetRowProps = function defaultGetRowProps2(props, _ref5) {
				var row = _ref5.row;
				return _extends(
					{
						key: "row_" + row.id,
						role: "row",
					},
					props
				);
			};
			var defaultGetCellProps = function defaultGetCellProps2(props, _ref6) {
				var cell = _ref6.cell;
				return _extends(
					{
						key: "cell_" + cell.row.id + "_" + cell.column.id,
						role: "cell",
					},
					props
				);
			};
			function makeDefaultPluginHooks() {
				return {
					useOptions: [],
					stateReducers: [],
					useControlledState: [],
					columns: [],
					columnsDeps: [],
					allColumns: [],
					allColumnsDeps: [],
					accessValue: [],
					materializedColumns: [],
					materializedColumnsDeps: [],
					useInstanceAfterData: [],
					visibleColumns: [],
					visibleColumnsDeps: [],
					headerGroups: [],
					headerGroupsDeps: [],
					useInstanceBeforeDimensions: [],
					useInstance: [],
					prepareRow: [],
					getTableProps: [defaultGetTableProps],
					getTableBodyProps: [defaultGetTableBodyProps],
					getHeaderGroupProps: [defaultGetHeaderGroupProps],
					getFooterGroupProps: [defaultGetFooterGroupProps],
					getHeaderProps: [defaultGetHeaderProps],
					getFooterProps: [defaultGetFooterProps],
					getRowProps: [defaultGetRowProps],
					getCellProps: [defaultGetCellProps],
					useFinalInstance: [],
				};
			}
			actions5.resetHiddenColumns = "resetHiddenColumns";
			actions5.toggleHideColumn = "toggleHideColumn";
			actions5.setHiddenColumns = "setHiddenColumns";
			actions5.toggleHideAllColumns = "toggleHideAllColumns";
			var useColumnVisibility = function useColumnVisibility2(hooks) {
				hooks.getToggleHiddenProps = [defaultGetToggleHiddenProps];
				hooks.getToggleHideAllColumnsProps = [
					defaultGetToggleHideAllColumnsProps,
				];
				hooks.stateReducers.push(reducer5);
				hooks.useInstanceBeforeDimensions.push(useInstanceBeforeDimensions2);
				hooks.headerGroupsDeps.push(function (deps, _ref) {
					var instance = _ref.instance;
					return [].concat(deps, [instance.state.hiddenColumns]);
				});
				hooks.useInstance.push(useInstance7);
			};
			useColumnVisibility.pluginName = "useColumnVisibility";
			var defaultGetToggleHiddenProps = function defaultGetToggleHiddenProps2(
				props,
				_ref2
			) {
				var column2 = _ref2.column;
				return [
					props,
					{
						onChange: function onChange(e) {
							column2.toggleHidden(!e.target.checked);
						},
						style: {
							cursor: "pointer",
						},
						checked: column2.isVisible,
						title: "Toggle Column Visible",
					},
				];
			};
			var defaultGetToggleHideAllColumnsProps =
				function defaultGetToggleHideAllColumnsProps2(props, _ref3) {
					var instance = _ref3.instance;
					return [
						props,
						{
							onChange: function onChange(e) {
								instance.toggleHideAllColumns(!e.target.checked);
							},
							style: {
								cursor: "pointer",
							},
							checked:
								!instance.allColumnsHidden &&
								!instance.state.hiddenColumns.length,
							title: "Toggle All Columns Hidden",
							indeterminate:
								!instance.allColumnsHidden &&
								instance.state.hiddenColumns.length,
						},
					];
				};
			function reducer5(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							hiddenColumns: [],
						},
						state
					);
				}
				if (action.type === actions5.resetHiddenColumns) {
					return _extends({}, state, {
						hiddenColumns: instance.initialState.hiddenColumns || [],
					});
				}
				if (action.type === actions5.toggleHideColumn) {
					var should =
						typeof action.value !== "undefined"
							? action.value
							: !state.hiddenColumns.includes(action.columnId);
					var hiddenColumns = should
						? [].concat(state.hiddenColumns, [action.columnId])
						: state.hiddenColumns.filter(function (d) {
							return d !== action.columnId;
						});
					return _extends({}, state, {
						hiddenColumns,
					});
				}
				if (action.type === actions5.setHiddenColumns) {
					return _extends({}, state, {
						hiddenColumns: functionalUpdate2(action.value, state.hiddenColumns),
					});
				}
				if (action.type === actions5.toggleHideAllColumns) {
					var shouldAll =
						typeof action.value !== "undefined"
							? action.value
							: !state.hiddenColumns.length;
					return _extends({}, state, {
						hiddenColumns: shouldAll
							? instance.allColumns.map(function (d) {
								return d.id;
							})
							: [],
					});
				}
			}
			function useInstanceBeforeDimensions2(instance) {
				var headers = instance.headers,
					hiddenColumns = instance.state.hiddenColumns;
				var isMountedRef = React12.useRef(false);
				if (!isMountedRef.current);
				var handleColumn = function handleColumn2(column2, parentVisible) {
					column2.isVisible =
						parentVisible && !hiddenColumns.includes(column2.id);
					var totalVisibleHeaderCount2 = 0;
					if (column2.headers && column2.headers.length) {
						column2.headers.forEach(function (subColumn) {
							return (totalVisibleHeaderCount2 += handleColumn2(
								subColumn,
								column2.isVisible
							));
						});
					} else {
						totalVisibleHeaderCount2 = column2.isVisible ? 1 : 0;
					}
					column2.totalVisibleHeaderCount = totalVisibleHeaderCount2;
					return totalVisibleHeaderCount2;
				};
				var totalVisibleHeaderCount = 0;
				headers.forEach(function (subHeader) {
					return (totalVisibleHeaderCount += handleColumn(subHeader, true));
				});
			}
			function useInstance7(instance) {
				var columns = instance.columns,
					flatHeaders = instance.flatHeaders,
					dispatch = instance.dispatch,
					allColumns2 = instance.allColumns,
					getHooks = instance.getHooks,
					hiddenColumns = instance.state.hiddenColumns,
					_instance$autoResetHi = instance.autoResetHiddenColumns,
					autoResetHiddenColumns =
						_instance$autoResetHi === void 0 ? true : _instance$autoResetHi;
				var getInstance2 = useGetLatest8(instance);
				var allColumnsHidden = allColumns2.length === hiddenColumns.length;
				var toggleHideColumn2 = React12.useCallback(
					function (columnId, value) {
						return dispatch({
							type: actions5.toggleHideColumn,
							columnId,
							value,
						});
					},
					[dispatch]
				);
				var setHiddenColumns2 = React12.useCallback(
					function (value) {
						return dispatch({
							type: actions5.setHiddenColumns,
							value,
						});
					},
					[dispatch]
				);
				var toggleHideAllColumns = React12.useCallback(
					function (value) {
						return dispatch({
							type: actions5.toggleHideAllColumns,
							value,
						});
					},
					[dispatch]
				);
				var getToggleHideAllColumnsProps = makePropGetter5(
					getHooks().getToggleHideAllColumnsProps,
					{
						instance: getInstance2(),
					}
				);
				flatHeaders.forEach(function (column2) {
					column2.toggleHidden = function (value) {
						dispatch({
							type: actions5.toggleHideColumn,
							columnId: column2.id,
							value,
						});
					};
					column2.getToggleHiddenProps = makePropGetter5(
						getHooks().getToggleHiddenProps,
						{
							instance: getInstance2(),
							column: column2,
						}
					);
				});
				var getAutoResetHiddenColumns = useGetLatest8(autoResetHiddenColumns);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetHiddenColumns()) {
							dispatch({
								type: actions5.resetHiddenColumns,
							});
						}
					},
					[dispatch, columns]
				);
				Object.assign(instance, {
					allColumnsHidden,
					toggleHideColumn: toggleHideColumn2,
					setHiddenColumns: setHiddenColumns2,
					toggleHideAllColumns,
					getToggleHideAllColumnsProps,
				});
			}
			var defaultInitialState = {};
			var defaultColumnInstance = {};
			var defaultReducer = function defaultReducer2(state, action, prevState) {
				return state;
			};
			var defaultGetSubRows = function defaultGetSubRows2(row, index) {
				return row.subRows || [];
			};
			var defaultGetRowId = function defaultGetRowId2(row, index, parent) {
				return "" + (parent ? [parent.id, index].join(".") : index);
			};
			var defaultUseControlledState = function defaultUseControlledState2(d) {
				return d;
			};
			function applyDefaults(props) {
				var _props$initialState = props.initialState,
					initialState =
						_props$initialState === void 0
							? defaultInitialState
							: _props$initialState,
					_props$defaultColumn = props.defaultColumn,
					defaultColumn3 =
						_props$defaultColumn === void 0
							? defaultColumnInstance
							: _props$defaultColumn,
					_props$getSubRows = props.getSubRows,
					getSubRows2 =
						_props$getSubRows === void 0
							? defaultGetSubRows
							: _props$getSubRows,
					_props$getRowId = props.getRowId,
					getRowId =
						_props$getRowId === void 0 ? defaultGetRowId : _props$getRowId,
					_props$stateReducer = props.stateReducer,
					stateReducer =
						_props$stateReducer === void 0
							? defaultReducer
							: _props$stateReducer,
					_props$useControlledS = props.useControlledState,
					useControlledState =
						_props$useControlledS === void 0
							? defaultUseControlledState
							: _props$useControlledS,
					rest = _objectWithoutPropertiesLoose(props, [
						"initialState",
						"defaultColumn",
						"getSubRows",
						"getRowId",
						"stateReducer",
						"useControlledState",
					]);
				return _extends({}, rest, {
					initialState,
					defaultColumn: defaultColumn3,
					getSubRows: getSubRows2,
					getRowId,
					stateReducer,
					useControlledState,
				});
			}
			var useTable2 = function useTable3(props) {
				for (
					var _len = arguments.length,
					plugins = new Array(_len > 1 ? _len - 1 : 0),
					_key = 1;
					_key < _len;
					_key++
				) {
					plugins[_key - 1] = arguments[_key];
				}
				props = applyDefaults(props);
				plugins = [useColumnVisibility].concat(plugins);
				var instanceRef = React12.useRef({});
				var getInstance2 = useGetLatest8(instanceRef.current);
				Object.assign(
					getInstance2(),
					_extends({}, props, {
						plugins,
						hooks: makeDefaultPluginHooks(),
					})
				);
				plugins.filter(Boolean).forEach(function (plugin) {
					plugin(getInstance2().hooks);
				});
				var getHooks = useGetLatest8(getInstance2().hooks);
				getInstance2().getHooks = getHooks;
				delete getInstance2().hooks;
				Object.assign(
					getInstance2(),
					reduceHooks(getHooks().useOptions, applyDefaults(props))
				);
				var _getInstance = getInstance2(),
					data = _getInstance.data,
					userColumns = _getInstance.columns,
					initialState = _getInstance.initialState,
					defaultColumn3 = _getInstance.defaultColumn,
					getSubRows2 = _getInstance.getSubRows,
					getRowId = _getInstance.getRowId,
					stateReducer = _getInstance.stateReducer,
					useControlledState = _getInstance.useControlledState;
				var getStateReducer = useGetLatest8(stateReducer);
				var reducer6 = React12.useCallback(
					function (state2, action) {
						if (!action.type) {
							console.info({
								action,
							});
							throw new Error("Unknown Action \u{1F446}");
						}
						return []
							.concat(
								getHooks().stateReducers,
								Array.isArray(getStateReducer())
									? getStateReducer()
									: [getStateReducer()]
							)
							.reduce(function (s, handler) {
								return handler(s, action, state2, getInstance2()) || s;
							}, state2);
					},
					[getHooks, getStateReducer, getInstance2]
				);
				var _React$useReducer = React12.useReducer(
					reducer6,
					void 0,
					function () {
						return reducer6(initialState, {
							type: actions5.init,
						});
					}
				),
					reducerState = _React$useReducer[0],
					dispatch = _React$useReducer[1];
				var state = reduceHooks(
					[].concat(getHooks().useControlledState, [useControlledState]),
					reducerState,
					{
						instance: getInstance2(),
					}
				);
				Object.assign(getInstance2(), {
					state,
					dispatch,
				});
				var columns = React12.useMemo(
					function () {
						return linkColumnStructure(
							reduceHooks(getHooks().columns, userColumns, {
								instance: getInstance2(),
							})
						);
					},
					[getHooks, getInstance2, userColumns].concat(
						reduceHooks(getHooks().columnsDeps, [], {
							instance: getInstance2(),
						})
					)
				);
				getInstance2().columns = columns;
				var allColumns2 = React12.useMemo(
					function () {
						return reduceHooks(getHooks().allColumns, flattenColumns(columns), {
							instance: getInstance2(),
						}).map(assignColumnAccessor);
					},
					[columns, getHooks, getInstance2].concat(
						reduceHooks(getHooks().allColumnsDeps, [], {
							instance: getInstance2(),
						})
					)
				);
				getInstance2().allColumns = allColumns2;
				var _React$useMemo = React12.useMemo(
					function () {
						var rows2 = [];
						var flatRows2 = [];
						var rowsById2 = {};
						var allColumnsQueue = [].concat(allColumns2);
						while (allColumnsQueue.length) {
							var column2 = allColumnsQueue.shift();
							accessRowsForColumn({
								data,
								rows: rows2,
								flatRows: flatRows2,
								rowsById: rowsById2,
								column: column2,
								getRowId,
								getSubRows: getSubRows2,
								accessValueHooks: getHooks().accessValue,
								getInstance: getInstance2,
							});
						}
						return [rows2, flatRows2, rowsById2];
					},
					[allColumns2, data, getRowId, getSubRows2, getHooks, getInstance2]
				),
					rows = _React$useMemo[0],
					flatRows = _React$useMemo[1],
					rowsById = _React$useMemo[2];
				Object.assign(getInstance2(), {
					rows,
					initialRows: [].concat(rows),
					flatRows,
					rowsById,
					// materializedColumns,
				});
				loopHooks(getHooks().useInstanceAfterData, getInstance2());
				var visibleColumns3 = React12.useMemo(
					function () {
						return reduceHooks(getHooks().visibleColumns, allColumns2, {
							instance: getInstance2(),
						}).map(function (d) {
							return decorateColumn(d, defaultColumn3);
						});
					},
					[getHooks, allColumns2, getInstance2, defaultColumn3].concat(
						reduceHooks(getHooks().visibleColumnsDeps, [], {
							instance: getInstance2(),
						})
					)
				);
				allColumns2 = React12.useMemo(
					function () {
						var columns2 = [].concat(visibleColumns3);
						allColumns2.forEach(function (column2) {
							if (
								!columns2.find(function (d) {
									return d.id === column2.id;
								})
							) {
								columns2.push(column2);
							}
						});
						return columns2;
					},
					[allColumns2, visibleColumns3]
				);
				getInstance2().allColumns = allColumns2;
				{
					var duplicateColumns = allColumns2.filter(function (column2, i) {
						return (
							allColumns2.findIndex(function (d) {
								return d.id === column2.id;
							}) !== i
						);
					});
					if (duplicateColumns.length) {
						console.info(allColumns2);
						throw new Error(
							'Duplicate columns were found with ids: "' +
							duplicateColumns
								.map(function (d) {
									return d.id;
								})
								.join(", ") +
							'" in the columns array above'
						);
					}
				}
				var headerGroups = React12.useMemo(
					function () {
						return reduceHooks(
							getHooks().headerGroups,
							makeHeaderGroups(visibleColumns3, defaultColumn3),
							getInstance2()
						);
					},
					[getHooks, visibleColumns3, defaultColumn3, getInstance2].concat(
						reduceHooks(getHooks().headerGroupsDeps, [], {
							instance: getInstance2(),
						})
					)
				);
				getInstance2().headerGroups = headerGroups;
				var headers = React12.useMemo(
					function () {
						return headerGroups.length ? headerGroups[0].headers : [];
					},
					[headerGroups]
				);
				getInstance2().headers = headers;
				getInstance2().flatHeaders = headerGroups.reduce(function (
					all,
					headerGroup
				) {
					return [].concat(all, headerGroup.headers);
				},
					[]);
				loopHooks(getHooks().useInstanceBeforeDimensions, getInstance2());
				var visibleColumnsDep = visibleColumns3
					.filter(function (d) {
						return d.isVisible;
					})
					.map(function (d) {
						return d.id;
					})
					.sort()
					.join("_");
				visibleColumns3 = React12.useMemo(
					function () {
						return visibleColumns3.filter(function (d) {
							return d.isVisible;
						});
					},
					// eslint-disable-next-line react-hooks/exhaustive-deps
					[visibleColumns3, visibleColumnsDep]
				);
				getInstance2().visibleColumns = visibleColumns3;
				var _calculateHeaderWidth = calculateHeaderWidths(headers),
					totalColumnsMinWidth = _calculateHeaderWidth[0],
					totalColumnsWidth = _calculateHeaderWidth[1],
					totalColumnsMaxWidth = _calculateHeaderWidth[2];
				getInstance2().totalColumnsMinWidth = totalColumnsMinWidth;
				getInstance2().totalColumnsWidth = totalColumnsWidth;
				getInstance2().totalColumnsMaxWidth = totalColumnsMaxWidth;
				loopHooks(getHooks().useInstance, getInstance2());
				[]
					.concat(getInstance2().flatHeaders, getInstance2().allColumns)
					.forEach(function (column2) {
						column2.render = makeRenderer(getInstance2(), column2);
						column2.getHeaderProps = makePropGetter5(
							getHooks().getHeaderProps,
							{
								instance: getInstance2(),
								column: column2,
							}
						);
						column2.getFooterProps = makePropGetter5(
							getHooks().getFooterProps,
							{
								instance: getInstance2(),
								column: column2,
							}
						);
					});
				getInstance2().headerGroups = React12.useMemo(
					function () {
						return headerGroups.filter(function (headerGroup, i) {
							headerGroup.headers = headerGroup.headers.filter(function (
								column2
							) {
								var recurse = function recurse2(headers2) {
									return headers2.filter(function (column3) {
										if (column3.headers) {
											return recurse2(column3.headers);
										}
										return column3.isVisible;
									}).length;
								};
								if (column2.headers) {
									return recurse(column2.headers);
								}
								return column2.isVisible;
							});
							if (headerGroup.headers.length) {
								headerGroup.getHeaderGroupProps = makePropGetter5(
									getHooks().getHeaderGroupProps,
									{
										instance: getInstance2(),
										headerGroup,
										index: i,
									}
								);
								headerGroup.getFooterGroupProps = makePropGetter5(
									getHooks().getFooterGroupProps,
									{
										instance: getInstance2(),
										headerGroup,
										index: i,
									}
								);
								return true;
							}
							return false;
						});
					},
					[headerGroups, getInstance2, getHooks]
				);
				getInstance2().footerGroups = []
					.concat(getInstance2().headerGroups)
					.reverse();
				getInstance2().prepareRow = React12.useCallback(
					function (row) {
						row.getRowProps = makePropGetter5(getHooks().getRowProps, {
							instance: getInstance2(),
							row,
						});
						row.allCells = allColumns2.map(function (column2) {
							var value = row.values[column2.id];
							var cell = {
								column: column2,
								row,
								value,
							};
							cell.getCellProps = makePropGetter5(getHooks().getCellProps, {
								instance: getInstance2(),
								cell,
							});
							cell.render = makeRenderer(getInstance2(), column2, {
								row,
								cell,
								value,
							});
							return cell;
						});
						row.cells = visibleColumns3.map(function (column2) {
							return row.allCells.find(function (cell) {
								return cell.column.id === column2.id;
							});
						});
						loopHooks(getHooks().prepareRow, row, {
							instance: getInstance2(),
						});
					},
					[getHooks, getInstance2, allColumns2, visibleColumns3]
				);
				getInstance2().getTableProps = makePropGetter5(
					getHooks().getTableProps,
					{
						instance: getInstance2(),
					}
				);
				getInstance2().getTableBodyProps = makePropGetter5(
					getHooks().getTableBodyProps,
					{
						instance: getInstance2(),
					}
				);
				loopHooks(getHooks().useFinalInstance, getInstance2());
				return getInstance2();
			};
			function calculateHeaderWidths(headers, left) {
				if (left === void 0) {
					left = 0;
				}
				var sumTotalMinWidth = 0;
				var sumTotalWidth = 0;
				var sumTotalMaxWidth = 0;
				var sumTotalFlexWidth = 0;
				headers.forEach(function (header) {
					var subHeaders = header.headers;
					header.totalLeft = left;
					if (subHeaders && subHeaders.length) {
						var _calculateHeaderWidth2 = calculateHeaderWidths(
							subHeaders,
							left
						),
							totalMinWidth = _calculateHeaderWidth2[0],
							totalWidth = _calculateHeaderWidth2[1],
							totalMaxWidth = _calculateHeaderWidth2[2],
							totalFlexWidth = _calculateHeaderWidth2[3];
						header.totalMinWidth = totalMinWidth;
						header.totalWidth = totalWidth;
						header.totalMaxWidth = totalMaxWidth;
						header.totalFlexWidth = totalFlexWidth;
					} else {
						header.totalMinWidth = header.minWidth;
						header.totalWidth = Math.min(
							Math.max(header.minWidth, header.width),
							header.maxWidth
						);
						header.totalMaxWidth = header.maxWidth;
						header.totalFlexWidth = header.canResize ? header.totalWidth : 0;
					}
					if (header.isVisible) {
						left += header.totalWidth;
						sumTotalMinWidth += header.totalMinWidth;
						sumTotalWidth += header.totalWidth;
						sumTotalMaxWidth += header.totalMaxWidth;
						sumTotalFlexWidth += header.totalFlexWidth;
					}
				});
				return [
					sumTotalMinWidth,
					sumTotalWidth,
					sumTotalMaxWidth,
					sumTotalFlexWidth,
				];
			}
			function accessRowsForColumn(_ref) {
				var data = _ref.data,
					rows = _ref.rows,
					flatRows = _ref.flatRows,
					rowsById = _ref.rowsById,
					column2 = _ref.column,
					getRowId = _ref.getRowId,
					getSubRows2 = _ref.getSubRows,
					accessValueHooks = _ref.accessValueHooks,
					getInstance2 = _ref.getInstance;
				var accessRow = function accessRow2(
					originalRow,
					rowIndex,
					depth,
					parent,
					parentRows
				) {
					if (depth === void 0) {
						depth = 0;
					}
					var original = originalRow;
					var id = getRowId(originalRow, rowIndex, parent);
					var row = rowsById[id];
					if (!row) {
						row = {
							id,
							original,
							index: rowIndex,
							depth,
							cells: [{}],
							// This is a dummy cell
						};
						row.cells.map = unpreparedAccessWarning;
						row.cells.filter = unpreparedAccessWarning;
						row.cells.forEach = unpreparedAccessWarning;
						row.cells[0].getCellProps = unpreparedAccessWarning;
						row.values = {};
						parentRows.push(row);
						flatRows.push(row);
						rowsById[id] = row;
						row.originalSubRows = getSubRows2(originalRow, rowIndex);
						if (row.originalSubRows) {
							var subRows = [];
							row.originalSubRows.forEach(function (d, i) {
								return accessRow2(d, i, depth + 1, row, subRows);
							});
							row.subRows = subRows;
						}
					} else if (row.subRows) {
						row.originalSubRows.forEach(function (d, i) {
							return accessRow2(d, i, depth + 1, row);
						});
					}
					if (column2.accessor) {
						row.values[column2.id] = column2.accessor(
							originalRow,
							rowIndex,
							row,
							parentRows,
							data
						);
					}
					row.values[column2.id] = reduceHooks(
						accessValueHooks,
						row.values[column2.id],
						{
							row,
							column: column2,
							instance: getInstance2(),
						},
						true
					);
				};
				data.forEach(function (originalRow, rowIndex) {
					return accessRow(originalRow, rowIndex, 0, void 0, rows);
				});
			}
			actions5.resetExpanded = "resetExpanded";
			actions5.toggleRowExpanded = "toggleRowExpanded";
			actions5.toggleAllRowsExpanded = "toggleAllRowsExpanded";
			var useExpanded2 = function useExpanded3(hooks) {
				hooks.getToggleAllRowsExpandedProps = [
					defaultGetToggleAllRowsExpandedProps,
				];
				hooks.getToggleRowExpandedProps = [defaultGetToggleRowExpandedProps];
				hooks.stateReducers.push(reducer$1);
				hooks.useInstance.push(useInstance$1);
				hooks.prepareRow.push(prepareRow3);
			};
			useExpanded2.pluginName = "useExpanded";
			var defaultGetToggleAllRowsExpandedProps =
				function defaultGetToggleAllRowsExpandedProps2(props, _ref) {
					var instance = _ref.instance;
					return [
						props,
						{
							onClick: function onClick(e) {
								instance.toggleAllRowsExpanded();
							},
							style: {
								cursor: "pointer",
							},
							title: "Toggle All Rows Expanded",
						},
					];
				};
			var defaultGetToggleRowExpandedProps =
				function defaultGetToggleRowExpandedProps2(props, _ref2) {
					var row = _ref2.row;
					return [
						props,
						{
							onClick: function onClick() {
								row.toggleRowExpanded();
							},
							style: {
								cursor: "pointer",
							},
							title: "Toggle Row Expanded",
						},
					];
				};
			function reducer$1(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							expanded: {},
						},
						state
					);
				}
				if (action.type === actions5.resetExpanded) {
					return _extends({}, state, {
						expanded: instance.initialState.expanded || {},
					});
				}
				if (action.type === actions5.toggleAllRowsExpanded) {
					var value = action.value;
					var rowsById = instance.rowsById;
					var isAllRowsExpanded =
						Object.keys(rowsById).length === Object.keys(state.expanded).length;
					var expandAll =
						typeof value !== "undefined" ? value : !isAllRowsExpanded;
					if (expandAll) {
						var expanded = {};
						Object.keys(rowsById).forEach(function (rowId) {
							expanded[rowId] = true;
						});
						return _extends({}, state, {
							expanded,
						});
					}
					return _extends({}, state, {
						expanded: {},
					});
				}
				if (action.type === actions5.toggleRowExpanded) {
					var id = action.id,
						setExpanded = action.value;
					var exists = state.expanded[id];
					var shouldExist =
						typeof setExpanded !== "undefined" ? setExpanded : !exists;
					if (!exists && shouldExist) {
						var _extends2;
						return _extends({}, state, {
							expanded: _extends(
								{},
								state.expanded,
								((_extends2 = {}), (_extends2[id] = true), _extends2)
							),
						});
					} else if (exists && !shouldExist) {
						var _state$expanded = state.expanded,
							_ = _state$expanded[id],
							rest = _objectWithoutPropertiesLoose(
								_state$expanded,
								[id].map(_toPropertyKey)
							);
						return _extends({}, state, {
							expanded: rest,
						});
					} else {
						return state;
					}
				}
			}
			function useInstance$1(instance) {
				var data = instance.data,
					rows = instance.rows,
					rowsById = instance.rowsById,
					_instance$manualExpan = instance.manualExpandedKey,
					manualExpandedKey =
						_instance$manualExpan === void 0
							? "expanded"
							: _instance$manualExpan,
					_instance$paginateExp = instance.paginateExpandedRows,
					paginateExpandedRows =
						_instance$paginateExp === void 0 ? true : _instance$paginateExp,
					_instance$expandSubRo = instance.expandSubRows,
					expandSubRows =
						_instance$expandSubRo === void 0 ? true : _instance$expandSubRo,
					_instance$autoResetEx = instance.autoResetExpanded,
					autoResetExpanded =
						_instance$autoResetEx === void 0 ? true : _instance$autoResetEx,
					getHooks = instance.getHooks,
					plugins = instance.plugins,
					expanded = instance.state.expanded,
					dispatch = instance.dispatch;
				ensurePluginOrder6(
					plugins,
					["useSortBy", "useGroupBy", "usePivotColumns", "useGlobalFilter"],
					"useExpanded"
				);
				var getAutoResetExpanded = useGetLatest8(autoResetExpanded);
				var isAllRowsExpanded = Boolean(
					Object.keys(rowsById).length && Object.keys(expanded).length
				);
				if (isAllRowsExpanded) {
					if (
						Object.keys(rowsById).some(function (id) {
							return !expanded[id];
						})
					) {
						isAllRowsExpanded = false;
					}
				}
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetExpanded()) {
							dispatch({
								type: actions5.resetExpanded,
							});
						}
					},
					[dispatch, data]
				);
				var toggleRowExpanded = React12.useCallback(
					function (id, value) {
						dispatch({
							type: actions5.toggleRowExpanded,
							id,
							value,
						});
					},
					[dispatch]
				);
				var toggleAllRowsExpanded2 = React12.useCallback(
					function (value) {
						return dispatch({
							type: actions5.toggleAllRowsExpanded,
							value,
						});
					},
					[dispatch]
				);
				var expandedRows = React12.useMemo(
					function () {
						if (paginateExpandedRows) {
							return expandRows2(rows, {
								manualExpandedKey,
								expanded,
								expandSubRows,
							});
						}
						return rows;
					},
					[
						paginateExpandedRows,
						rows,
						manualExpandedKey,
						expanded,
						expandSubRows,
					]
				);
				var expandedDepth = React12.useMemo(
					function () {
						return findExpandedDepth(expanded);
					},
					[expanded]
				);
				var getInstance2 = useGetLatest8(instance);
				var getToggleAllRowsExpandedProps = makePropGetter5(
					getHooks().getToggleAllRowsExpandedProps,
					{
						instance: getInstance2(),
					}
				);
				Object.assign(instance, {
					preExpandedRows: rows,
					expandedRows,
					rows: expandedRows,
					expandedDepth,
					isAllRowsExpanded,
					toggleRowExpanded,
					toggleAllRowsExpanded: toggleAllRowsExpanded2,
					getToggleAllRowsExpandedProps,
				});
			}
			function prepareRow3(row, _ref3) {
				var getHooks = _ref3.instance.getHooks,
					instance = _ref3.instance;
				row.toggleRowExpanded = function (set) {
					return instance.toggleRowExpanded(row.id, set);
				};
				row.getToggleRowExpandedProps = makePropGetter5(
					getHooks().getToggleRowExpandedProps,
					{
						instance,
						row,
					}
				);
			}
			function findExpandedDepth(expanded) {
				var maxDepth = 0;
				Object.keys(expanded).forEach(function (id) {
					var splitId = id.split(".");
					maxDepth = Math.max(maxDepth, splitId.length);
				});
				return maxDepth;
			}
			var text = function text2(rows, ids, filterValue) {
				rows = rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return String(rowValue)
							.toLowerCase()
							.includes(String(filterValue).toLowerCase());
					});
				});
				return rows;
			};
			text.autoRemove = function (val) {
				return !val;
			};
			var exactText = function exactText2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return rowValue !== void 0
							? String(rowValue).toLowerCase() ===
							String(filterValue).toLowerCase()
							: true;
					});
				});
			};
			exactText.autoRemove = function (val) {
				return !val;
			};
			var exactTextCase = function exactTextCase2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return rowValue !== void 0
							? String(rowValue) === String(filterValue)
							: true;
					});
				});
			};
			exactTextCase.autoRemove = function (val) {
				return !val;
			};
			var includes = function includes2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return rowValue.includes(filterValue);
					});
				});
			};
			includes.autoRemove = function (val) {
				return !val || !val.length;
			};
			var includesAll = function includesAll2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return (
							rowValue &&
							rowValue.length &&
							filterValue.every(function (val) {
								return rowValue.includes(val);
							})
						);
					});
				});
			};
			includesAll.autoRemove = function (val) {
				return !val || !val.length;
			};
			var includesSome = function includesSome2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return (
							rowValue &&
							rowValue.length &&
							filterValue.some(function (val) {
								return rowValue.includes(val);
							})
						);
					});
				});
			};
			includesSome.autoRemove = function (val) {
				return !val || !val.length;
			};
			var includesValue = function includesValue2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return filterValue.includes(rowValue);
					});
				});
			};
			includesValue.autoRemove = function (val) {
				return !val || !val.length;
			};
			var exact = function exact2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return rowValue === filterValue;
					});
				});
			};
			exact.autoRemove = function (val) {
				return typeof val === "undefined";
			};
			var equals = function equals2(rows, ids, filterValue) {
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return rowValue == filterValue;
					});
				});
			};
			equals.autoRemove = function (val) {
				return val == null;
			};
			var between = function between2(rows, ids, filterValue) {
				var _ref = filterValue || [],
					min3 = _ref[0],
					max3 = _ref[1];
				min3 = typeof min3 === "number" ? min3 : -Infinity;
				max3 = typeof max3 === "number" ? max3 : Infinity;
				if (min3 > max3) {
					var temp = min3;
					min3 = max3;
					max3 = temp;
				}
				return rows.filter(function (row) {
					return ids.some(function (id) {
						var rowValue = row.values[id];
						return rowValue >= min3 && rowValue <= max3;
					});
				});
			};
			between.autoRemove = function (val) {
				return (
					!val || (typeof val[0] !== "number" && typeof val[1] !== "number")
				);
			};
			var filterTypes = /* @__PURE__ */ Object.freeze({
				__proto__: null,
				text,
				exactText,
				exactTextCase,
				includes,
				includesAll,
				includesSome,
				includesValue,
				exact,
				equals,
				between,
			});
			actions5.resetFilters = "resetFilters";
			actions5.setFilter = "setFilter";
			actions5.setAllFilters = "setAllFilters";
			var useFilters2 = function useFilters3(hooks) {
				hooks.stateReducers.push(reducer$2);
				hooks.useInstance.push(useInstance$2);
			};
			useFilters2.pluginName = "useFilters";
			function reducer$2(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							filters: [],
						},
						state
					);
				}
				if (action.type === actions5.resetFilters) {
					return _extends({}, state, {
						filters: instance.initialState.filters || [],
					});
				}
				if (action.type === actions5.setFilter) {
					var columnId = action.columnId,
						filterValue = action.filterValue;
					var allColumns2 = instance.allColumns,
						userFilterTypes = instance.filterTypes;
					var column2 = allColumns2.find(function (d) {
						return d.id === columnId;
					});
					if (!column2) {
						throw new Error(
							"React-Table: Could not find a column with id: " + columnId
						);
					}
					var filterMethod = getFilterMethod(
						column2.filter,
						userFilterTypes || {},
						filterTypes
					);
					var previousfilter = state.filters.find(function (d) {
						return d.id === columnId;
					});
					var newFilter = functionalUpdate2(
						filterValue,
						previousfilter && previousfilter.value
					);
					if (
						shouldAutoRemoveFilter(filterMethod.autoRemove, newFilter, column2)
					) {
						return _extends({}, state, {
							filters: state.filters.filter(function (d) {
								return d.id !== columnId;
							}),
						});
					}
					if (previousfilter) {
						return _extends({}, state, {
							filters: state.filters.map(function (d) {
								if (d.id === columnId) {
									return {
										id: columnId,
										value: newFilter,
									};
								}
								return d;
							}),
						});
					}
					return _extends({}, state, {
						filters: [].concat(state.filters, [
							{
								id: columnId,
								value: newFilter,
							},
						]),
					});
				}
				if (action.type === actions5.setAllFilters) {
					var filters = action.filters;
					var _allColumns = instance.allColumns,
						_userFilterTypes = instance.filterTypes;
					return _extends({}, state, {
						// Filter out undefined values
						filters: functionalUpdate2(filters, state.filters).filter(function (
							filter
						) {
							var column3 = _allColumns.find(function (d) {
								return d.id === filter.id;
							});
							var filterMethod2 = getFilterMethod(
								column3.filter,
								_userFilterTypes || {},
								filterTypes
							);
							if (
								shouldAutoRemoveFilter(
									filterMethod2.autoRemove,
									filter.value,
									column3
								)
							) {
								return false;
							}
							return true;
						}),
					});
				}
			}
			function useInstance$2(instance) {
				var data = instance.data,
					rows = instance.rows,
					flatRows = instance.flatRows,
					rowsById = instance.rowsById,
					allColumns2 = instance.allColumns,
					userFilterTypes = instance.filterTypes,
					manualFilters = instance.manualFilters,
					_instance$defaultCanF = instance.defaultCanFilter,
					defaultCanFilter =
						_instance$defaultCanF === void 0 ? false : _instance$defaultCanF,
					disableFilters = instance.disableFilters,
					filters = instance.state.filters,
					dispatch = instance.dispatch,
					_instance$autoResetFi = instance.autoResetFilters,
					autoResetFilters =
						_instance$autoResetFi === void 0 ? true : _instance$autoResetFi;
				var setFilter2 = React12.useCallback(
					function (columnId, filterValue) {
						dispatch({
							type: actions5.setFilter,
							columnId,
							filterValue,
						});
					},
					[dispatch]
				);
				var setAllFilters2 = React12.useCallback(
					function (filters2) {
						dispatch({
							type: actions5.setAllFilters,
							filters: filters2,
						});
					},
					[dispatch]
				);
				allColumns2.forEach(function (column2) {
					var id = column2.id,
						accessor = column2.accessor,
						columnDefaultCanFilter = column2.defaultCanFilter,
						columnDisableFilters = column2.disableFilters;
					column2.canFilter = accessor
						? getFirstDefined2(
							columnDisableFilters === true ? false : void 0,
							disableFilters === true ? false : void 0,
							true
						)
						: getFirstDefined2(columnDefaultCanFilter, defaultCanFilter, false);
					column2.setFilter = function (val) {
						return setFilter2(column2.id, val);
					};
					var found = filters.find(function (d) {
						return d.id === id;
					});
					column2.filterValue = found && found.value;
				});
				var _React$useMemo = React12.useMemo(
					function () {
						if (manualFilters || !filters.length) {
							return [rows, flatRows, rowsById];
						}
						var filteredFlatRows2 = [];
						var filteredRowsById2 = {};
						var filterRows = function filterRows2(rows2, depth) {
							if (depth === void 0) {
								depth = 0;
							}
							var filteredRows2 = rows2;
							filteredRows2 = filters.reduce(function (filteredSoFar, _ref) {
								var columnId = _ref.id,
									filterValue = _ref.value;
								var column2 = allColumns2.find(function (d) {
									return d.id === columnId;
								});
								if (!column2) {
									return filteredSoFar;
								}
								if (depth === 0) {
									column2.preFilteredRows = filteredSoFar;
								}
								var filterMethod = getFilterMethod(
									column2.filter,
									userFilterTypes || {},
									filterTypes
								);
								if (!filterMethod) {
									console.warn(
										"Could not find a valid 'column.filter' for column with the ID: " +
										column2.id +
										"."
									);
									return filteredSoFar;
								}
								column2.filteredRows = filterMethod(
									filteredSoFar,
									[columnId],
									filterValue
								);
								return column2.filteredRows;
							}, rows2);
							filteredRows2.forEach(function (row) {
								filteredFlatRows2.push(row);
								filteredRowsById2[row.id] = row;
								if (!row.subRows) {
									return;
								}
								row.subRows =
									row.subRows && row.subRows.length > 0
										? filterRows2(row.subRows, depth + 1)
										: row.subRows;
							});
							return filteredRows2;
						};
						return [filterRows(rows), filteredFlatRows2, filteredRowsById2];
					},
					[
						manualFilters,
						filters,
						rows,
						flatRows,
						rowsById,
						allColumns2,
						userFilterTypes,
					]
				),
					filteredRows = _React$useMemo[0],
					filteredFlatRows = _React$useMemo[1],
					filteredRowsById = _React$useMemo[2];
				React12.useMemo(
					function () {
						var nonFilteredColumns = allColumns2.filter(function (column2) {
							return !filters.find(function (d) {
								return d.id === column2.id;
							});
						});
						nonFilteredColumns.forEach(function (column2) {
							column2.preFilteredRows = filteredRows;
							column2.filteredRows = filteredRows;
						});
					},
					[filteredRows, filters, allColumns2]
				);
				var getAutoResetFilters = useGetLatest8(autoResetFilters);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetFilters()) {
							dispatch({
								type: actions5.resetFilters,
							});
						}
					},
					[dispatch, manualFilters ? null : data]
				);
				Object.assign(instance, {
					preFilteredRows: rows,
					preFilteredFlatRows: flatRows,
					preFilteredRowsById: rowsById,
					filteredRows,
					filteredFlatRows,
					filteredRowsById,
					rows: filteredRows,
					flatRows: filteredFlatRows,
					rowsById: filteredRowsById,
					setFilter: setFilter2,
					setAllFilters: setAllFilters2,
				});
			}
			actions5.resetGlobalFilter = "resetGlobalFilter";
			actions5.setGlobalFilter = "setGlobalFilter";
			var useGlobalFilter2 = function useGlobalFilter3(hooks) {
				hooks.stateReducers.push(reducer$3);
				hooks.useInstance.push(useInstance$3);
			};
			useGlobalFilter2.pluginName = "useGlobalFilter";
			function reducer$3(state, action, previousState, instance) {
				if (action.type === actions5.resetGlobalFilter) {
					return _extends({}, state, {
						globalFilter: instance.initialState.globalFilter || void 0,
					});
				}
				if (action.type === actions5.setGlobalFilter) {
					var filterValue = action.filterValue;
					var userFilterTypes = instance.userFilterTypes;
					var filterMethod = getFilterMethod(
						instance.globalFilter,
						userFilterTypes || {},
						filterTypes
					);
					var newFilter = functionalUpdate2(filterValue, state.globalFilter);
					if (shouldAutoRemoveFilter(filterMethod.autoRemove, newFilter)) {
						var globalFilter = state.globalFilter,
							stateWithoutGlobalFilter = _objectWithoutPropertiesLoose(state, [
								"globalFilter",
							]);
						return stateWithoutGlobalFilter;
					}
					return _extends({}, state, {
						globalFilter: newFilter,
					});
				}
			}
			function useInstance$3(instance) {
				var data = instance.data,
					rows = instance.rows,
					flatRows = instance.flatRows,
					rowsById = instance.rowsById,
					allColumns2 = instance.allColumns,
					userFilterTypes = instance.filterTypes,
					globalFilter = instance.globalFilter,
					manualGlobalFilter = instance.manualGlobalFilter,
					globalFilterValue = instance.state.globalFilter,
					dispatch = instance.dispatch,
					_instance$autoResetGl = instance.autoResetGlobalFilter,
					autoResetGlobalFilter =
						_instance$autoResetGl === void 0 ? true : _instance$autoResetGl,
					disableGlobalFilter = instance.disableGlobalFilter;
				var setGlobalFilter = React12.useCallback(
					function (filterValue) {
						dispatch({
							type: actions5.setGlobalFilter,
							filterValue,
						});
					},
					[dispatch]
				);
				var _React$useMemo = React12.useMemo(
					function () {
						if (
							manualGlobalFilter ||
							typeof globalFilterValue === "undefined"
						) {
							return [rows, flatRows, rowsById];
						}
						var filteredFlatRows = [];
						var filteredRowsById = {};
						var filterMethod = getFilterMethod(
							globalFilter,
							userFilterTypes || {},
							filterTypes
						);
						if (!filterMethod) {
							console.warn("Could not find a valid 'globalFilter' option.");
							return rows;
						}
						allColumns2.forEach(function (column2) {
							var columnDisableGlobalFilter = column2.disableGlobalFilter;
							column2.canFilter = getFirstDefined2(
								columnDisableGlobalFilter === true ? false : void 0,
								disableGlobalFilter === true ? false : void 0,
								true
							);
						});
						var filterableColumns = allColumns2.filter(function (c) {
							return c.canFilter === true;
						});
						var filterRows = function filterRows2(filteredRows) {
							filteredRows = filterMethod(
								filteredRows,
								filterableColumns.map(function (d) {
									return d.id;
								}),
								globalFilterValue
							);
							filteredRows.forEach(function (row) {
								filteredFlatRows.push(row);
								filteredRowsById[row.id] = row;
								row.subRows =
									row.subRows && row.subRows.length
										? filterRows2(row.subRows)
										: row.subRows;
							});
							return filteredRows;
						};
						return [filterRows(rows), filteredFlatRows, filteredRowsById];
					},
					[
						manualGlobalFilter,
						globalFilterValue,
						globalFilter,
						userFilterTypes,
						allColumns2,
						rows,
						flatRows,
						rowsById,
						disableGlobalFilter,
					]
				),
					globalFilteredRows = _React$useMemo[0],
					globalFilteredFlatRows = _React$useMemo[1],
					globalFilteredRowsById = _React$useMemo[2];
				var getAutoResetGlobalFilter = useGetLatest8(autoResetGlobalFilter);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetGlobalFilter()) {
							dispatch({
								type: actions5.resetGlobalFilter,
							});
						}
					},
					[dispatch, manualGlobalFilter ? null : data]
				);
				Object.assign(instance, {
					preGlobalFilteredRows: rows,
					preGlobalFilteredFlatRows: flatRows,
					preGlobalFilteredRowsById: rowsById,
					globalFilteredRows,
					globalFilteredFlatRows,
					globalFilteredRowsById,
					rows: globalFilteredRows,
					flatRows: globalFilteredFlatRows,
					rowsById: globalFilteredRowsById,
					setGlobalFilter,
					disableGlobalFilter,
				});
			}
			function sum2(values, aggregatedValues) {
				return aggregatedValues.reduce(function (sum3, next2) {
					return sum3 + (typeof next2 === "number" ? next2 : 0);
				}, 0);
			}
			function min2(values) {
				var min3 = values[0] || 0;
				values.forEach(function (value) {
					if (typeof value === "number") {
						min3 = Math.min(min3, value);
					}
				});
				return min3;
			}
			function max2(values) {
				var max3 = values[0] || 0;
				values.forEach(function (value) {
					if (typeof value === "number") {
						max3 = Math.max(max3, value);
					}
				});
				return max3;
			}
			function minMax(values) {
				var min3 = values[0] || 0;
				var max3 = values[0] || 0;
				values.forEach(function (value) {
					if (typeof value === "number") {
						min3 = Math.min(min3, value);
						max3 = Math.max(max3, value);
					}
				});
				return min3 + ".." + max3;
			}
			function average(values) {
				return sum2(null, values) / values.length;
			}
			function median2(values) {
				if (!values.length) {
					return null;
				}
				var mid = Math.floor(values.length / 2);
				var nums = [].concat(values).sort(function (a, b) {
					return a - b;
				});
				return values.length % 2 !== 0
					? nums[mid]
					: (nums[mid - 1] + nums[mid]) / 2;
			}
			function unique2(values) {
				return Array.from(new Set(values).values());
			}
			function uniqueCount(values) {
				return new Set(values).size;
			}
			function count2(values) {
				return values.length;
			}
			var aggregations2 = /* @__PURE__ */ Object.freeze({
				__proto__: null,
				sum: sum2,
				min: min2,
				max: max2,
				minMax,
				average,
				median: median2,
				unique: unique2,
				uniqueCount,
				count: count2,
			});
			var emptyArray2 = [];
			var emptyObject2 = {};
			actions5.resetGroupBy = "resetGroupBy";
			actions5.setGroupBy = "setGroupBy";
			actions5.toggleGroupBy = "toggleGroupBy";
			var useGroupBy2 = function useGroupBy3(hooks) {
				hooks.getGroupByToggleProps = [defaultGetGroupByToggleProps2];
				hooks.stateReducers.push(reducer$4);
				hooks.visibleColumnsDeps.push(function (deps, _ref) {
					var instance = _ref.instance;
					return [].concat(deps, [instance.state.groupBy]);
				});
				hooks.visibleColumns.push(visibleColumns2);
				hooks.useInstance.push(useInstance$4);
				hooks.prepareRow.push(prepareRow$1);
			};
			useGroupBy2.pluginName = "useGroupBy";
			var defaultGetGroupByToggleProps2 =
				function defaultGetGroupByToggleProps3(props, _ref2) {
					var header = _ref2.header;
					return [
						props,
						{
							onClick: header.canGroupBy
								? function (e) {
									e.persist();
									header.toggleGroupBy();
								}
								: void 0,
							style: {
								cursor: header.canGroupBy ? "pointer" : void 0,
							},
							title: "Toggle GroupBy",
						},
					];
				};
			function reducer$4(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							groupBy: [],
						},
						state
					);
				}
				if (action.type === actions5.resetGroupBy) {
					return _extends({}, state, {
						groupBy: instance.initialState.groupBy || [],
					});
				}
				if (action.type === actions5.setGroupBy) {
					var value = action.value;
					return _extends({}, state, {
						groupBy: value,
					});
				}
				if (action.type === actions5.toggleGroupBy) {
					var columnId = action.columnId,
						setGroupBy2 = action.value;
					var resolvedGroupBy =
						typeof setGroupBy2 !== "undefined"
							? setGroupBy2
							: !state.groupBy.includes(columnId);
					if (resolvedGroupBy) {
						return _extends({}, state, {
							groupBy: [].concat(state.groupBy, [columnId]),
						});
					}
					return _extends({}, state, {
						groupBy: state.groupBy.filter(function (d) {
							return d !== columnId;
						}),
					});
				}
			}
			function visibleColumns2(columns, _ref3) {
				var groupBy = _ref3.instance.state.groupBy;
				var groupByColumns = groupBy
					.map(function (g) {
						return columns.find(function (col) {
							return col.id === g;
						});
					})
					.filter(Boolean);
				var nonGroupByColumns = columns.filter(function (col) {
					return !groupBy.includes(col.id);
				});
				columns = [].concat(groupByColumns, nonGroupByColumns);
				columns.forEach(function (column2) {
					column2.isGrouped = groupBy.includes(column2.id);
					column2.groupedIndex = groupBy.indexOf(column2.id);
				});
				return columns;
			}
			var defaultUserAggregations2 = {};
			function useInstance$4(instance) {
				var data = instance.data,
					rows = instance.rows,
					flatRows = instance.flatRows,
					rowsById = instance.rowsById,
					allColumns2 = instance.allColumns,
					flatHeaders = instance.flatHeaders,
					_instance$groupByFn = instance.groupByFn,
					groupByFn =
						_instance$groupByFn === void 0
							? defaultGroupByFn2
							: _instance$groupByFn,
					manualGroupBy = instance.manualGroupBy,
					_instance$aggregation = instance.aggregations,
					userAggregations =
						_instance$aggregation === void 0
							? defaultUserAggregations2
							: _instance$aggregation,
					plugins = instance.plugins,
					groupBy = instance.state.groupBy,
					dispatch = instance.dispatch,
					_instance$autoResetGr = instance.autoResetGroupBy,
					autoResetGroupBy =
						_instance$autoResetGr === void 0 ? true : _instance$autoResetGr,
					disableGroupBy = instance.disableGroupBy,
					defaultCanGroupBy = instance.defaultCanGroupBy,
					getHooks = instance.getHooks;
				ensurePluginOrder6(
					plugins,
					["useColumnOrder", "useFilters"],
					"useGroupBy"
				);
				var getInstance2 = useGetLatest8(instance);
				allColumns2.forEach(function (column2) {
					var accessor = column2.accessor,
						defaultColumnGroupBy = column2.defaultGroupBy,
						columnDisableGroupBy = column2.disableGroupBy;
					column2.canGroupBy = accessor
						? getFirstDefined2(
							column2.canGroupBy,
							columnDisableGroupBy === true ? false : void 0,
							disableGroupBy === true ? false : void 0,
							true
						)
						: getFirstDefined2(
							column2.canGroupBy,
							defaultColumnGroupBy,
							defaultCanGroupBy,
							false
						);
					if (column2.canGroupBy) {
						column2.toggleGroupBy = function () {
							return instance.toggleGroupBy(column2.id);
						};
					}
					column2.Aggregated = column2.Aggregated || column2.Cell;
				});
				var toggleGroupBy2 = React12.useCallback(
					function (columnId, value) {
						dispatch({
							type: actions5.toggleGroupBy,
							columnId,
							value,
						});
					},
					[dispatch]
				);
				var setGroupBy2 = React12.useCallback(
					function (value) {
						dispatch({
							type: actions5.setGroupBy,
							value,
						});
					},
					[dispatch]
				);
				flatHeaders.forEach(function (header) {
					header.getGroupByToggleProps = makePropGetter5(
						getHooks().getGroupByToggleProps,
						{
							instance: getInstance2(),
							header,
						}
					);
				});
				var _React$useMemo = React12.useMemo(
					function () {
						if (manualGroupBy || !groupBy.length) {
							return [
								rows,
								flatRows,
								rowsById,
								emptyArray2,
								emptyObject2,
								flatRows,
								rowsById,
							];
						}
						var existingGroupBy = groupBy.filter(function (g) {
							return allColumns2.find(function (col) {
								return col.id === g;
							});
						});
						var aggregateRowsToValues = function aggregateRowsToValues2(
							leafRows,
							groupedRows3,
							depth
						) {
							var values = {};
							allColumns2.forEach(function (column2) {
								if (existingGroupBy.includes(column2.id)) {
									values[column2.id] = groupedRows3[0]
										? groupedRows3[0].values[column2.id]
										: null;
									return;
								}
								var aggregateFn =
									typeof column2.aggregate === "function"
										? column2.aggregate
										: userAggregations[column2.aggregate] ||
										aggregations2[column2.aggregate];
								if (aggregateFn) {
									var groupedValues = groupedRows3.map(function (row) {
										return row.values[column2.id];
									});
									var leafValues = leafRows.map(function (row) {
										var columnValue = row.values[column2.id];
										if (!depth && column2.aggregateValue) {
											var aggregateValueFn =
												typeof column2.aggregateValue === "function"
													? column2.aggregateValue
													: userAggregations[column2.aggregateValue] ||
													aggregations2[column2.aggregateValue];
											if (!aggregateValueFn) {
												console.info({
													column: column2,
												});
												throw new Error(
													"React Table: Invalid column.aggregateValue option for column listed above"
												);
											}
											columnValue = aggregateValueFn(
												columnValue,
												row,
												column2
											);
										}
										return columnValue;
									});
									values[column2.id] = aggregateFn(leafValues, groupedValues);
								} else if (column2.aggregate) {
									console.info({
										column: column2,
									});
									throw new Error(
										"React Table: Invalid column.aggregate option for column listed above"
									);
								} else {
									values[column2.id] = null;
								}
							});
							return values;
						};
						var groupedFlatRows2 = [];
						var groupedRowsById2 = {};
						var onlyGroupedFlatRows2 = [];
						var onlyGroupedRowsById2 = {};
						var nonGroupedFlatRows2 = [];
						var nonGroupedRowsById2 = {};
						var groupUpRecursively = function groupUpRecursively2(
							rows2,
							depth,
							parentId
						) {
							if (depth === void 0) {
								depth = 0;
							}
							if (depth === existingGroupBy.length) {
								return rows2.map(function (row) {
									return _extends({}, row, {
										depth,
									});
								});
							}
							var columnId = existingGroupBy[depth];
							var rowGroupsMap = groupByFn(rows2, columnId);
							var aggregatedGroupedRows = Object.entries(rowGroupsMap).map(
								function (_ref4, index) {
									var groupByVal = _ref4[0],
										groupedRows3 = _ref4[1];
									var id = columnId + ":" + groupByVal;
									id = parentId ? parentId + ">" + id : id;
									var subRows = groupUpRecursively2(
										groupedRows3,
										depth + 1,
										id
									);
									var leafRows = depth
										? flattenBy2(groupedRows3, "leafRows")
										: groupedRows3;
									var values = aggregateRowsToValues(
										leafRows,
										groupedRows3,
										depth
									);
									var row = {
										id,
										isGrouped: true,
										groupByID: columnId,
										groupByVal,
										values,
										subRows,
										leafRows,
										depth,
										index,
									};
									subRows.forEach(function (subRow) {
										groupedFlatRows2.push(subRow);
										groupedRowsById2[subRow.id] = subRow;
										if (subRow.isGrouped) {
											onlyGroupedFlatRows2.push(subRow);
											onlyGroupedRowsById2[subRow.id] = subRow;
										} else {
											nonGroupedFlatRows2.push(subRow);
											nonGroupedRowsById2[subRow.id] = subRow;
										}
									});
									return row;
								}
							);
							return aggregatedGroupedRows;
						};
						var groupedRows2 = groupUpRecursively(rows);
						groupedRows2.forEach(function (subRow) {
							groupedFlatRows2.push(subRow);
							groupedRowsById2[subRow.id] = subRow;
							if (subRow.isGrouped) {
								onlyGroupedFlatRows2.push(subRow);
								onlyGroupedRowsById2[subRow.id] = subRow;
							} else {
								nonGroupedFlatRows2.push(subRow);
								nonGroupedRowsById2[subRow.id] = subRow;
							}
						});
						return [
							groupedRows2,
							groupedFlatRows2,
							groupedRowsById2,
							onlyGroupedFlatRows2,
							onlyGroupedRowsById2,
							nonGroupedFlatRows2,
							nonGroupedRowsById2,
						];
					},
					[
						manualGroupBy,
						groupBy,
						rows,
						flatRows,
						rowsById,
						allColumns2,
						userAggregations,
						groupByFn,
					]
				),
					groupedRows = _React$useMemo[0],
					groupedFlatRows = _React$useMemo[1],
					groupedRowsById = _React$useMemo[2],
					onlyGroupedFlatRows = _React$useMemo[3],
					onlyGroupedRowsById = _React$useMemo[4],
					nonGroupedFlatRows = _React$useMemo[5],
					nonGroupedRowsById = _React$useMemo[6];
				var getAutoResetGroupBy = useGetLatest8(autoResetGroupBy);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetGroupBy()) {
							dispatch({
								type: actions5.resetGroupBy,
							});
						}
					},
					[dispatch, manualGroupBy ? null : data]
				);
				Object.assign(instance, {
					preGroupedRows: rows,
					preGroupedFlatRow: flatRows,
					preGroupedRowsById: rowsById,
					groupedRows,
					groupedFlatRows,
					groupedRowsById,
					onlyGroupedFlatRows,
					onlyGroupedRowsById,
					nonGroupedFlatRows,
					nonGroupedRowsById,
					rows: groupedRows,
					flatRows: groupedFlatRows,
					rowsById: groupedRowsById,
					toggleGroupBy: toggleGroupBy2,
					setGroupBy: setGroupBy2,
				});
			}
			function prepareRow$1(row) {
				row.allCells.forEach(function (cell) {
					var _row$subRows;
					cell.isGrouped =
						cell.column.isGrouped && cell.column.id === row.groupByID;
					cell.isPlaceholder = !cell.isGrouped && cell.column.isGrouped;
					cell.isAggregated =
						!cell.isGrouped &&
						!cell.isPlaceholder &&
						((_row$subRows = row.subRows) == null
							? void 0
							: _row$subRows.length);
				});
			}
			function defaultGroupByFn2(rows, columnId) {
				return rows.reduce(function (prev2, row, i) {
					var resKey = "" + row.values[columnId];
					prev2[resKey] = Array.isArray(prev2[resKey]) ? prev2[resKey] : [];
					prev2[resKey].push(row);
					return prev2;
				}, {});
			}
			var reSplitAlphaNumeric = /([0-9]+)/gm;
			var alphanumeric = function alphanumeric2(rowA, rowB, columnId) {
				var _getRowValuesByColumn = getRowValuesByColumnID(
					rowA,
					rowB,
					columnId
				),
					a = _getRowValuesByColumn[0],
					b = _getRowValuesByColumn[1];
				a = toString(a);
				b = toString(b);
				a = a.split(reSplitAlphaNumeric).filter(Boolean);
				b = b.split(reSplitAlphaNumeric).filter(Boolean);
				while (a.length && b.length) {
					var aa = a.shift();
					var bb = b.shift();
					var an = parseInt(aa, 10);
					var bn = parseInt(bb, 10);
					var combo = [an, bn].sort();
					if (isNaN(combo[0])) {
						if (aa > bb) {
							return 1;
						}
						if (bb > aa) {
							return -1;
						}
						continue;
					}
					if (isNaN(combo[1])) {
						return isNaN(an) ? -1 : 1;
					}
					if (an > bn) {
						return 1;
					}
					if (bn > an) {
						return -1;
					}
				}
				return a.length - b.length;
			};
			function datetime(rowA, rowB, columnId) {
				var _getRowValuesByColumn2 = getRowValuesByColumnID(
					rowA,
					rowB,
					columnId
				),
					a = _getRowValuesByColumn2[0],
					b = _getRowValuesByColumn2[1];
				a = a.getTime();
				b = b.getTime();
				return compareBasic(a, b);
			}
			function basic(rowA, rowB, columnId) {
				var _getRowValuesByColumn3 = getRowValuesByColumnID(
					rowA,
					rowB,
					columnId
				),
					a = _getRowValuesByColumn3[0],
					b = _getRowValuesByColumn3[1];
				return compareBasic(a, b);
			}
			function string(rowA, rowB, columnId) {
				var _getRowValuesByColumn4 = getRowValuesByColumnID(
					rowA,
					rowB,
					columnId
				),
					a = _getRowValuesByColumn4[0],
					b = _getRowValuesByColumn4[1];
				a = a.split("").filter(Boolean);
				b = b.split("").filter(Boolean);
				while (a.length && b.length) {
					var aa = a.shift();
					var bb = b.shift();
					var alower = aa.toLowerCase();
					var blower = bb.toLowerCase();
					if (alower > blower) {
						return 1;
					}
					if (blower > alower) {
						return -1;
					}
					if (aa > bb) {
						return 1;
					}
					if (bb > aa) {
						return -1;
					}
					continue;
				}
				return a.length - b.length;
			}
			function number(rowA, rowB, columnId) {
				var _getRowValuesByColumn5 = getRowValuesByColumnID(
					rowA,
					rowB,
					columnId
				),
					a = _getRowValuesByColumn5[0],
					b = _getRowValuesByColumn5[1];
				var replaceNonNumeric = /[^0-9.]/gi;
				a = Number(String(a).replace(replaceNonNumeric, ""));
				b = Number(String(b).replace(replaceNonNumeric, ""));
				return compareBasic(a, b);
			}
			function compareBasic(a, b) {
				return a === b ? 0 : a > b ? 1 : -1;
			}
			function getRowValuesByColumnID(row1, row2, columnId) {
				return [row1.values[columnId], row2.values[columnId]];
			}
			function toString(a) {
				if (typeof a === "number") {
					if (isNaN(a) || a === Infinity || a === -Infinity) {
						return "";
					}
					return String(a);
				}
				if (typeof a === "string") {
					return a;
				}
				return "";
			}
			var sortTypes = /* @__PURE__ */ Object.freeze({
				__proto__: null,
				alphanumeric,
				datetime,
				basic,
				string,
				number,
			});
			actions5.resetSortBy = "resetSortBy";
			actions5.setSortBy = "setSortBy";
			actions5.toggleSortBy = "toggleSortBy";
			actions5.clearSortBy = "clearSortBy";
			defaultColumn2.sortType = "alphanumeric";
			defaultColumn2.sortDescFirst = false;
			var useSortBy2 = function useSortBy3(hooks) {
				hooks.getSortByToggleProps = [defaultGetSortByToggleProps];
				hooks.stateReducers.push(reducer$5);
				hooks.useInstance.push(useInstance$5);
			};
			useSortBy2.pluginName = "useSortBy";
			var defaultGetSortByToggleProps = function defaultGetSortByToggleProps2(
				props,
				_ref
			) {
				var instance = _ref.instance,
					column2 = _ref.column;
				var _instance$isMultiSort = instance.isMultiSortEvent,
					isMultiSortEvent =
						_instance$isMultiSort === void 0
							? function (e) {
								return e.shiftKey;
							}
							: _instance$isMultiSort;
				return [
					props,
					{
						onClick: column2.canSort
							? function (e) {
								e.persist();
								column2.toggleSortBy(
									void 0,
									!instance.disableMultiSort && isMultiSortEvent(e)
								);
							}
							: void 0,
						style: {
							cursor: column2.canSort ? "pointer" : void 0,
						},
						title: column2.canSort ? "Toggle SortBy" : void 0,
					},
				];
			};
			function reducer$5(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							sortBy: [],
						},
						state
					);
				}
				if (action.type === actions5.resetSortBy) {
					return _extends({}, state, {
						sortBy: instance.initialState.sortBy || [],
					});
				}
				if (action.type === actions5.clearSortBy) {
					var sortBy = state.sortBy;
					var newSortBy = sortBy.filter(function (d) {
						return d.id !== action.columnId;
					});
					return _extends({}, state, {
						sortBy: newSortBy,
					});
				}
				if (action.type === actions5.setSortBy) {
					var _sortBy = action.sortBy;
					return _extends({}, state, {
						sortBy: _sortBy,
					});
				}
				if (action.type === actions5.toggleSortBy) {
					var columnId = action.columnId,
						desc = action.desc,
						multi = action.multi;
					var allColumns2 = instance.allColumns,
						disableMultiSort = instance.disableMultiSort,
						disableSortRemove = instance.disableSortRemove,
						disableMultiRemove = instance.disableMultiRemove,
						_instance$maxMultiSor = instance.maxMultiSortColCount,
						maxMultiSortColCount =
							_instance$maxMultiSor === void 0
								? Number.MAX_SAFE_INTEGER
								: _instance$maxMultiSor;
					var _sortBy2 = state.sortBy;
					var column2 = allColumns2.find(function (d) {
						return d.id === columnId;
					});
					var sortDescFirst = column2.sortDescFirst;
					var existingSortBy = _sortBy2.find(function (d) {
						return d.id === columnId;
					});
					var existingIndex = _sortBy2.findIndex(function (d) {
						return d.id === columnId;
					});
					var hasDescDefined = typeof desc !== "undefined" && desc !== null;
					var _newSortBy = [];
					var sortAction;
					if (!disableMultiSort && multi) {
						if (existingSortBy) {
							sortAction = "toggle";
						} else {
							sortAction = "add";
						}
					} else {
						if (
							existingIndex !== _sortBy2.length - 1 ||
							_sortBy2.length !== 1
						) {
							sortAction = "replace";
						} else if (existingSortBy) {
							sortAction = "toggle";
						} else {
							sortAction = "replace";
						}
					}
					if (
						sortAction === "toggle" && // Must be toggling
						!disableSortRemove && // If disableSortRemove, disable in general
						!hasDescDefined && // Must not be setting desc
						(multi ? !disableMultiRemove : true) && // If multi, don't allow if disableMultiRemove
						((existingSortBy && // Finally, detect if it should indeed be removed
							existingSortBy.desc &&
							!sortDescFirst) ||
							(!existingSortBy.desc && sortDescFirst))
					) {
						sortAction = "remove";
					}
					if (sortAction === "replace") {
						_newSortBy = [
							{
								id: columnId,
								desc: hasDescDefined ? desc : sortDescFirst,
							},
						];
					} else if (sortAction === "add") {
						_newSortBy = [].concat(_sortBy2, [
							{
								id: columnId,
								desc: hasDescDefined ? desc : sortDescFirst,
							},
						]);
						_newSortBy.splice(0, _newSortBy.length - maxMultiSortColCount);
					} else if (sortAction === "toggle") {
						_newSortBy = _sortBy2.map(function (d) {
							if (d.id === columnId) {
								return _extends({}, d, {
									desc: hasDescDefined ? desc : !existingSortBy.desc,
								});
							}
							return d;
						});
					} else if (sortAction === "remove") {
						_newSortBy = _sortBy2.filter(function (d) {
							return d.id !== columnId;
						});
					}
					return _extends({}, state, {
						sortBy: _newSortBy,
					});
				}
			}
			function useInstance$5(instance) {
				var data = instance.data,
					rows = instance.rows,
					flatRows = instance.flatRows,
					allColumns2 = instance.allColumns,
					_instance$orderByFn = instance.orderByFn,
					orderByFn =
						_instance$orderByFn === void 0
							? defaultOrderByFn
							: _instance$orderByFn,
					userSortTypes = instance.sortTypes,
					manualSortBy = instance.manualSortBy,
					defaultCanSort = instance.defaultCanSort,
					disableSortBy = instance.disableSortBy,
					flatHeaders = instance.flatHeaders,
					sortBy = instance.state.sortBy,
					dispatch = instance.dispatch,
					plugins = instance.plugins,
					getHooks = instance.getHooks,
					_instance$autoResetSo = instance.autoResetSortBy,
					autoResetSortBy =
						_instance$autoResetSo === void 0 ? true : _instance$autoResetSo;
				ensurePluginOrder6(
					plugins,
					["useFilters", "useGlobalFilter", "useGroupBy", "usePivotColumns"],
					"useSortBy"
				);
				var setSortBy = React12.useCallback(
					function (sortBy2) {
						dispatch({
							type: actions5.setSortBy,
							sortBy: sortBy2,
						});
					},
					[dispatch]
				);
				var toggleSortBy = React12.useCallback(
					function (columnId, desc, multi) {
						dispatch({
							type: actions5.toggleSortBy,
							columnId,
							desc,
							multi,
						});
					},
					[dispatch]
				);
				var getInstance2 = useGetLatest8(instance);
				flatHeaders.forEach(function (column2) {
					var accessor = column2.accessor,
						defaultColumnCanSort = column2.canSort,
						columnDisableSortBy = column2.disableSortBy,
						id = column2.id;
					var canSort = accessor
						? getFirstDefined2(
							columnDisableSortBy === true ? false : void 0,
							disableSortBy === true ? false : void 0,
							true
						)
						: getFirstDefined2(defaultCanSort, defaultColumnCanSort, false);
					column2.canSort = canSort;
					if (column2.canSort) {
						column2.toggleSortBy = function (desc, multi) {
							return toggleSortBy(column2.id, desc, multi);
						};
						column2.clearSortBy = function () {
							dispatch({
								type: actions5.clearSortBy,
								columnId: column2.id,
							});
						};
					}
					column2.getSortByToggleProps = makePropGetter5(
						getHooks().getSortByToggleProps,
						{
							instance: getInstance2(),
							column: column2,
						}
					);
					var columnSort = sortBy.find(function (d) {
						return d.id === id;
					});
					column2.isSorted = !!columnSort;
					column2.sortedIndex = sortBy.findIndex(function (d) {
						return d.id === id;
					});
					column2.isSortedDesc = column2.isSorted ? columnSort.desc : void 0;
				});
				var _React$useMemo = React12.useMemo(
					function () {
						if (manualSortBy || !sortBy.length) {
							return [rows, flatRows];
						}
						var sortedFlatRows2 = [];
						var availableSortBy = sortBy.filter(function (sort) {
							return allColumns2.find(function (col) {
								return col.id === sort.id;
							});
						});
						var sortData = function sortData2(rows2) {
							var sortedData = orderByFn(
								rows2,
								availableSortBy.map(function (sort) {
									var column2 = allColumns2.find(function (d) {
										return d.id === sort.id;
									});
									if (!column2) {
										throw new Error(
											"React-Table: Could not find a column with id: " +
											sort.id +
											" while sorting"
										);
									}
									var sortType = column2.sortType;
									var sortMethod =
										isFunction(sortType) ||
										(userSortTypes || {})[sortType] ||
										sortTypes[sortType];
									if (!sortMethod) {
										throw new Error(
											"React-Table: Could not find a valid sortType of '" +
											sortType +
											"' for column '" +
											sort.id +
											"'."
										);
									}
									return function (a, b) {
										return sortMethod(a, b, sort.id, sort.desc);
									};
								}),
								// Map the directions
								availableSortBy.map(function (sort) {
									var column2 = allColumns2.find(function (d) {
										return d.id === sort.id;
									});
									if (column2 && column2.sortInverted) {
										return sort.desc;
									}
									return !sort.desc;
								})
							);
							sortedData.forEach(function (row) {
								sortedFlatRows2.push(row);
								if (!row.subRows || row.subRows.length === 0) {
									return;
								}
								row.subRows = sortData2(row.subRows);
							});
							return sortedData;
						};
						return [sortData(rows), sortedFlatRows2];
					},
					[
						manualSortBy,
						sortBy,
						rows,
						flatRows,
						allColumns2,
						orderByFn,
						userSortTypes,
					]
				),
					sortedRows = _React$useMemo[0],
					sortedFlatRows = _React$useMemo[1];
				var getAutoResetSortBy = useGetLatest8(autoResetSortBy);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetSortBy()) {
							dispatch({
								type: actions5.resetSortBy,
							});
						}
					},
					[manualSortBy ? null : data]
				);
				Object.assign(instance, {
					preSortedRows: rows,
					preSortedFlatRows: flatRows,
					sortedRows,
					sortedFlatRows,
					rows: sortedRows,
					flatRows: sortedFlatRows,
					setSortBy,
					toggleSortBy,
				});
			}
			function defaultOrderByFn(arr, funcs, dirs) {
				return [].concat(arr).sort(function (rowA, rowB) {
					for (var i = 0; i < funcs.length; i += 1) {
						var sortFn = funcs[i];
						var desc = dirs[i] === false || dirs[i] === "desc";
						var sortInt = sortFn(rowA, rowB);
						if (sortInt !== 0) {
							return desc ? -sortInt : sortInt;
						}
					}
					return dirs[0] ? rowA.index - rowB.index : rowB.index - rowA.index;
				});
			}
			var pluginName3 = "usePagination";
			actions5.resetPage = "resetPage";
			actions5.gotoPage = "gotoPage";
			actions5.setPageSize = "setPageSize";
			var usePagination2 = function usePagination3(hooks) {
				hooks.stateReducers.push(reducer$6);
				hooks.useInstance.push(useInstance$6);
			};
			usePagination2.pluginName = pluginName3;
			function reducer$6(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							pageSize: 10,
							pageIndex: 0,
						},
						state
					);
				}
				if (action.type === actions5.resetPage) {
					return _extends({}, state, {
						pageIndex: instance.initialState.pageIndex || 0,
					});
				}
				if (action.type === actions5.gotoPage) {
					var pageCount = instance.pageCount,
						page = instance.page;
					var newPageIndex = functionalUpdate2(
						action.pageIndex,
						state.pageIndex
					);
					var canNavigate = false;
					if (newPageIndex > state.pageIndex) {
						canNavigate =
							pageCount === -1
								? page.length >= state.pageSize
								: newPageIndex < pageCount;
					} else if (newPageIndex < state.pageIndex) {
						canNavigate = newPageIndex > -1;
					}
					if (!canNavigate) {
						return state;
					}
					return _extends({}, state, {
						pageIndex: newPageIndex,
					});
				}
				if (action.type === actions5.setPageSize) {
					var pageSize = action.pageSize;
					var topRowIndex = state.pageSize * state.pageIndex;
					var pageIndex = Math.floor(topRowIndex / pageSize);
					return _extends({}, state, {
						pageIndex,
						pageSize,
					});
				}
			}
			function useInstance$6(instance) {
				var rows = instance.rows,
					_instance$autoResetPa = instance.autoResetPage,
					autoResetPage =
						_instance$autoResetPa === void 0 ? true : _instance$autoResetPa,
					_instance$manualExpan = instance.manualExpandedKey,
					manualExpandedKey =
						_instance$manualExpan === void 0
							? "expanded"
							: _instance$manualExpan,
					plugins = instance.plugins,
					userPageCount = instance.pageCount,
					_instance$paginateExp = instance.paginateExpandedRows,
					paginateExpandedRows =
						_instance$paginateExp === void 0 ? true : _instance$paginateExp,
					_instance$expandSubRo = instance.expandSubRows,
					expandSubRows =
						_instance$expandSubRo === void 0 ? true : _instance$expandSubRo,
					_instance$state = instance.state,
					pageSize = _instance$state.pageSize,
					pageIndex = _instance$state.pageIndex,
					expanded = _instance$state.expanded,
					globalFilter = _instance$state.globalFilter,
					filters = _instance$state.filters,
					groupBy = _instance$state.groupBy,
					sortBy = _instance$state.sortBy,
					dispatch = instance.dispatch,
					data = instance.data,
					manualPagination = instance.manualPagination;
				ensurePluginOrder6(
					plugins,
					[
						"useGlobalFilter",
						"useFilters",
						"useGroupBy",
						"useSortBy",
						"useExpanded",
					],
					"usePagination"
				);
				var getAutoResetPage = useGetLatest8(autoResetPage);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetPage()) {
							dispatch({
								type: actions5.resetPage,
							});
						}
					},
					[
						dispatch,
						manualPagination ? null : data,
						globalFilter,
						filters,
						groupBy,
						sortBy,
					]
				);
				var pageCount = manualPagination
					? userPageCount
					: Math.ceil(rows.length / pageSize);
				var pageOptions = React12.useMemo(
					function () {
						return pageCount > 0
							? []
								.concat(new Array(pageCount))
								.fill(null)
								.map(function (d, i) {
									return i;
								})
							: [];
					},
					[pageCount]
				);
				var page = React12.useMemo(
					function () {
						var page2;
						if (manualPagination) {
							page2 = rows;
						} else {
							var pageStart = pageSize * pageIndex;
							var pageEnd = pageStart + pageSize;
							page2 = rows.slice(pageStart, pageEnd);
						}
						if (paginateExpandedRows) {
							return page2;
						}
						return expandRows2(page2, {
							manualExpandedKey,
							expanded,
							expandSubRows,
						});
					},
					[
						expandSubRows,
						expanded,
						manualExpandedKey,
						manualPagination,
						pageIndex,
						pageSize,
						paginateExpandedRows,
						rows,
					]
				);
				var canPreviousPage = pageIndex > 0;
				var canNextPage =
					pageCount === -1
						? page.length >= pageSize
						: pageIndex < pageCount - 1;
				var gotoPage2 = React12.useCallback(
					function (pageIndex2) {
						dispatch({
							type: actions5.gotoPage,
							pageIndex: pageIndex2,
						});
					},
					[dispatch]
				);
				var previousPage = React12.useCallback(
					function () {
						return gotoPage2(function (old) {
							return old - 1;
						});
					},
					[gotoPage2]
				);
				var nextPage = React12.useCallback(
					function () {
						return gotoPage2(function (old) {
							return old + 1;
						});
					},
					[gotoPage2]
				);
				var setPageSize2 = React12.useCallback(
					function (pageSize2) {
						dispatch({
							type: actions5.setPageSize,
							pageSize: pageSize2,
						});
					},
					[dispatch]
				);
				Object.assign(instance, {
					pageOptions,
					pageCount,
					page,
					canPreviousPage,
					canNextPage,
					gotoPage: gotoPage2,
					previousPage,
					nextPage,
					setPageSize: setPageSize2,
				});
			}
			actions5.resetPivot = "resetPivot";
			actions5.togglePivot = "togglePivot";
			var _UNSTABLE_usePivotColumns = function _UNSTABLE_usePivotColumns2(
				hooks
			) {
				hooks.getPivotToggleProps = [defaultGetPivotToggleProps];
				hooks.stateReducers.push(reducer$7);
				hooks.useInstanceAfterData.push(useInstanceAfterData);
				hooks.allColumns.push(allColumns);
				hooks.accessValue.push(accessValue);
				hooks.materializedColumns.push(materializedColumns);
				hooks.materializedColumnsDeps.push(materializedColumnsDeps);
				hooks.visibleColumns.push(visibleColumns$1);
				hooks.visibleColumnsDeps.push(visibleColumnsDeps);
				hooks.useInstance.push(useInstance$7);
				hooks.prepareRow.push(prepareRow$2);
			};
			_UNSTABLE_usePivotColumns.pluginName = "usePivotColumns";
			var defaultPivotColumns = [];
			var defaultGetPivotToggleProps = function defaultGetPivotToggleProps2(
				props,
				_ref
			) {
				var header = _ref.header;
				return [
					props,
					{
						onClick: header.canPivot
							? function (e) {
								e.persist();
								header.togglePivot();
							}
							: void 0,
						style: {
							cursor: header.canPivot ? "pointer" : void 0,
						},
						title: "Toggle Pivot",
					},
				];
			};
			function reducer$7(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							pivotColumns: defaultPivotColumns,
						},
						state
					);
				}
				if (action.type === actions5.resetPivot) {
					return _extends({}, state, {
						pivotColumns:
							instance.initialState.pivotColumns || defaultPivotColumns,
					});
				}
				if (action.type === actions5.togglePivot) {
					var columnId = action.columnId,
						setPivot = action.value;
					var resolvedPivot =
						typeof setPivot !== "undefined"
							? setPivot
							: !state.pivotColumns.includes(columnId);
					if (resolvedPivot) {
						return _extends({}, state, {
							pivotColumns: [].concat(state.pivotColumns, [columnId]),
						});
					}
					return _extends({}, state, {
						pivotColumns: state.pivotColumns.filter(function (d) {
							return d !== columnId;
						}),
					});
				}
			}
			function useInstanceAfterData(instance) {
				instance.allColumns.forEach(function (column2) {
					column2.isPivotSource = instance.state.pivotColumns.includes(
						column2.id
					);
				});
			}
			function allColumns(columns, _ref2) {
				var instance = _ref2.instance;
				columns.forEach(function (column2) {
					column2.isPivotSource = instance.state.pivotColumns.includes(
						column2.id
					);
					column2.uniqueValues = /* @__PURE__ */ new Set();
				});
				return columns;
			}
			function accessValue(value, _ref3) {
				var column2 = _ref3.column;
				if (column2.uniqueValues && typeof value !== "undefined") {
					column2.uniqueValues.add(value);
				}
				return value;
			}
			function materializedColumns(materialized, _ref4) {
				var instance = _ref4.instance;
				var allColumns2 = instance.allColumns,
					state = instance.state;
				if (
					!state.pivotColumns.length ||
					!state.groupBy ||
					!state.groupBy.length
				) {
					return materialized;
				}
				var pivotColumns = state.pivotColumns
					.map(function (id) {
						return allColumns2.find(function (d) {
							return d.id === id;
						});
					})
					.filter(Boolean);
				var sourceColumns = allColumns2.filter(function (d) {
					return (
						!d.isPivotSource &&
						!state.groupBy.includes(d.id) &&
						!state.pivotColumns.includes(d.id)
					);
				});
				var buildPivotColumns = function buildPivotColumns2(
					depth,
					parent,
					pivotFilters
				) {
					if (depth === void 0) {
						depth = 0;
					}
					if (pivotFilters === void 0) {
						pivotFilters = [];
					}
					var pivotColumn = pivotColumns[depth];
					if (!pivotColumn) {
						return sourceColumns.map(function (sourceColumn) {
							return _extends({}, sourceColumn, {
								canPivot: false,
								isPivoted: true,
								parent,
								depth,
								id:
									"" +
									(parent
										? parent.id + "." + sourceColumn.id
										: sourceColumn.id),
								accessor: function accessor(originalRow, i, row) {
									if (
										pivotFilters.every(function (filter) {
											return filter(row);
										})
									) {
										return row.values[sourceColumn.id];
									}
								},
							});
						});
					}
					var uniqueValues = Array.from(pivotColumn.uniqueValues).sort();
					return uniqueValues.map(function (uniqueValue) {
						var columnGroup = _extends({}, pivotColumn, {
							Header:
								pivotColumn.PivotHeader ||
									typeof pivotColumn.header === "string"
									? pivotColumn.Header + ": " + uniqueValue
									: uniqueValue,
							isPivotGroup: true,
							parent,
							depth,
							id: parent
								? parent.id + "." + pivotColumn.id + "." + uniqueValue
								: pivotColumn.id + "." + uniqueValue,
							pivotValue: uniqueValue,
						});
						columnGroup.columns = buildPivotColumns2(
							depth + 1,
							columnGroup,
							[].concat(pivotFilters, [
								function (row) {
									return row.values[pivotColumn.id] === uniqueValue;
								},
							])
						);
						return columnGroup;
					});
				};
				var newMaterialized = flattenColumns(buildPivotColumns());
				return [].concat(materialized, newMaterialized);
			}
			function materializedColumnsDeps(deps, _ref5) {
				var _ref5$instance$state = _ref5.instance.state,
					pivotColumns = _ref5$instance$state.pivotColumns,
					groupBy = _ref5$instance$state.groupBy;
				return [].concat(deps, [pivotColumns, groupBy]);
			}
			function visibleColumns$1(visibleColumns3, _ref6) {
				var state = _ref6.instance.state;
				visibleColumns3 = visibleColumns3.filter(function (d) {
					return !d.isPivotSource;
				});
				if (
					state.pivotColumns.length &&
					state.groupBy &&
					state.groupBy.length
				) {
					visibleColumns3 = visibleColumns3.filter(function (column2) {
						return column2.isGrouped || column2.isPivoted;
					});
				}
				return visibleColumns3;
			}
			function visibleColumnsDeps(deps, _ref7) {
				var instance = _ref7.instance;
				return [].concat(deps, [
					instance.state.pivotColumns,
					instance.state.groupBy,
				]);
			}
			function useInstance$7(instance) {
				var columns = instance.columns,
					allColumns2 = instance.allColumns,
					flatHeaders = instance.flatHeaders,
					getHooks = instance.getHooks,
					plugins = instance.plugins,
					dispatch = instance.dispatch,
					_instance$autoResetPi = instance.autoResetPivot,
					autoResetPivot =
						_instance$autoResetPi === void 0 ? true : _instance$autoResetPi,
					manaulPivot = instance.manaulPivot,
					disablePivot = instance.disablePivot,
					defaultCanPivot = instance.defaultCanPivot;
				ensurePluginOrder6(plugins, ["useGroupBy"], "usePivotColumns");
				var getInstance2 = useGetLatest8(instance);
				allColumns2.forEach(function (column2) {
					var accessor = column2.accessor,
						defaultColumnPivot = column2.defaultPivot,
						columnDisablePivot = column2.disablePivot;
					column2.canPivot = accessor
						? getFirstDefined2(
							column2.canPivot,
							columnDisablePivot === true ? false : void 0,
							disablePivot === true ? false : void 0,
							true
						)
						: getFirstDefined2(
							column2.canPivot,
							defaultColumnPivot,
							defaultCanPivot,
							false
						);
					if (column2.canPivot) {
						column2.togglePivot = function () {
							return instance.togglePivot(column2.id);
						};
					}
					column2.Aggregated = column2.Aggregated || column2.Cell;
				});
				var togglePivot = function togglePivot2(columnId, value) {
					dispatch({
						type: actions5.togglePivot,
						columnId,
						value,
					});
				};
				flatHeaders.forEach(function (header) {
					header.getPivotToggleProps = makePropGetter5(
						getHooks().getPivotToggleProps,
						{
							instance: getInstance2(),
							header,
						}
					);
				});
				var getAutoResetPivot = useGetLatest8(autoResetPivot);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetPivot()) {
							dispatch({
								type: actions5.resetPivot,
							});
						}
					},
					[dispatch, manaulPivot ? null : columns]
				);
				Object.assign(instance, {
					togglePivot,
				});
			}
			function prepareRow$2(row) {
				row.allCells.forEach(function (cell) {
					cell.isPivoted = cell.column.isPivoted;
				});
			}
			var pluginName$1 = "useRowSelect";
			actions5.resetSelectedRows = "resetSelectedRows";
			actions5.toggleAllRowsSelected = "toggleAllRowsSelected";
			actions5.toggleRowSelected = "toggleRowSelected";
			actions5.toggleAllPageRowsSelected = "toggleAllPageRowsSelected";
			var useRowSelect2 = function useRowSelect3(hooks) {
				hooks.getToggleRowSelectedProps = [defaultGetToggleRowSelectedProps2];
				hooks.getToggleAllRowsSelectedProps = [
					defaultGetToggleAllRowsSelectedProps2,
				];
				hooks.getToggleAllPageRowsSelectedProps = [
					defaultGetToggleAllPageRowsSelectedProps2,
				];
				hooks.stateReducers.push(reducer$8);
				hooks.useInstance.push(useInstance$8);
				hooks.prepareRow.push(prepareRow$3);
			};
			useRowSelect2.pluginName = pluginName$1;
			var defaultGetToggleRowSelectedProps2 =
				function defaultGetToggleRowSelectedProps3(props, _ref) {
					var instance = _ref.instance,
						row = _ref.row;
					var _instance$manualRowSe = instance.manualRowSelectedKey,
						manualRowSelectedKey =
							_instance$manualRowSe === void 0
								? "isSelected"
								: _instance$manualRowSe;
					var checked = false;
					if (row.original && row.original[manualRowSelectedKey]) {
						checked = true;
					} else {
						checked = row.isSelected;
					}
					return [
						props,
						{
							onChange: function onChange(e) {
								row.toggleRowSelected(e.target.checked);
							},
							style: {
								cursor: "pointer",
							},
							checked,
							title: "Toggle Row Selected",
							indeterminate: row.isSomeSelected,
						},
					];
				};
			var defaultGetToggleAllRowsSelectedProps2 =
				function defaultGetToggleAllRowsSelectedProps3(props, _ref2) {
					var instance = _ref2.instance;
					return [
						props,
						{
							onChange: function onChange(e) {
								instance.toggleAllRowsSelected(e.target.checked);
							},
							style: {
								cursor: "pointer",
							},
							checked: instance.isAllRowsSelected,
							title: "Toggle All Rows Selected",
							indeterminate: Boolean(
								!instance.isAllRowsSelected &&
								Object.keys(instance.state.selectedRowIds).length
							),
						},
					];
				};
			var defaultGetToggleAllPageRowsSelectedProps2 =
				function defaultGetToggleAllPageRowsSelectedProps3(props, _ref3) {
					var instance = _ref3.instance;
					return [
						props,
						{
							onChange: function onChange(e) {
								instance.toggleAllPageRowsSelected(e.target.checked);
							},
							style: {
								cursor: "pointer",
							},
							checked: instance.isAllPageRowsSelected,
							title: "Toggle All Current Page Rows Selected",
							indeterminate: Boolean(
								!instance.isAllPageRowsSelected &&
								instance.page.some(function (_ref4) {
									var id = _ref4.id;
									return instance.state.selectedRowIds[id];
								})
							),
						},
					];
				};
			function reducer$8(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							selectedRowIds: {},
						},
						state
					);
				}
				if (action.type === actions5.resetSelectedRows) {
					return _extends({}, state, {
						selectedRowIds: instance.initialState.selectedRowIds || {},
					});
				}
				if (action.type === actions5.toggleAllRowsSelected) {
					var setSelected = action.value;
					var isAllRowsSelected = instance.isAllRowsSelected,
						rowsById = instance.rowsById,
						_instance$nonGroupedR = instance.nonGroupedRowsById,
						nonGroupedRowsById =
							_instance$nonGroupedR === void 0
								? rowsById
								: _instance$nonGroupedR;
					var selectAll =
						typeof setSelected !== "undefined"
							? setSelected
							: !isAllRowsSelected;
					var selectedRowIds = Object.assign({}, state.selectedRowIds);
					if (selectAll) {
						Object.keys(nonGroupedRowsById).forEach(function (rowId) {
							selectedRowIds[rowId] = true;
						});
					} else {
						Object.keys(nonGroupedRowsById).forEach(function (rowId) {
							delete selectedRowIds[rowId];
						});
					}
					return _extends({}, state, {
						selectedRowIds,
					});
				}
				if (action.type === actions5.toggleRowSelected) {
					var id = action.id,
						_setSelected = action.value;
					var _rowsById = instance.rowsById,
						_instance$selectSubRo = instance.selectSubRows,
						selectSubRows =
							_instance$selectSubRo === void 0 ? true : _instance$selectSubRo,
						getSubRows2 = instance.getSubRows;
					var isSelected = state.selectedRowIds[id];
					var shouldExist =
						typeof _setSelected !== "undefined" ? _setSelected : !isSelected;
					if (isSelected === shouldExist) {
						return state;
					}
					var newSelectedRowIds = _extends({}, state.selectedRowIds);
					var handleRowById = function handleRowById2(id2) {
						var row = _rowsById[id2];
						if (row) {
							if (!row.isGrouped) {
								if (shouldExist) {
									newSelectedRowIds[id2] = true;
								} else {
									delete newSelectedRowIds[id2];
								}
							}
							if (selectSubRows && getSubRows2(row)) {
								return getSubRows2(row).forEach(function (row2) {
									return handleRowById2(row2.id);
								});
							}
						}
					};
					handleRowById(id);
					return _extends({}, state, {
						selectedRowIds: newSelectedRowIds,
					});
				}
				if (action.type === actions5.toggleAllPageRowsSelected) {
					var _setSelected2 = action.value;
					var page = instance.page,
						_rowsById2 = instance.rowsById,
						_instance$selectSubRo2 = instance.selectSubRows,
						_selectSubRows =
							_instance$selectSubRo2 === void 0 ? true : _instance$selectSubRo2,
						isAllPageRowsSelected = instance.isAllPageRowsSelected,
						_getSubRows = instance.getSubRows;
					var _selectAll =
						typeof _setSelected2 !== "undefined"
							? _setSelected2
							: !isAllPageRowsSelected;
					var _newSelectedRowIds = _extends({}, state.selectedRowIds);
					var _handleRowById = function _handleRowById2(id2) {
						var row = _rowsById2[id2];
						if (!row.isGrouped) {
							if (_selectAll) {
								_newSelectedRowIds[id2] = true;
							} else {
								delete _newSelectedRowIds[id2];
							}
						}
						if (_selectSubRows && _getSubRows(row)) {
							return _getSubRows(row).forEach(function (row2) {
								return _handleRowById2(row2.id);
							});
						}
					};
					page.forEach(function (row) {
						return _handleRowById(row.id);
					});
					return _extends({}, state, {
						selectedRowIds: _newSelectedRowIds,
					});
				}
				return state;
			}
			function useInstance$8(instance) {
				var data = instance.data,
					rows = instance.rows,
					getHooks = instance.getHooks,
					plugins = instance.plugins,
					rowsById = instance.rowsById,
					_instance$nonGroupedR2 = instance.nonGroupedRowsById,
					nonGroupedRowsById =
						_instance$nonGroupedR2 === void 0
							? rowsById
							: _instance$nonGroupedR2,
					_instance$autoResetSe = instance.autoResetSelectedRows,
					autoResetSelectedRows =
						_instance$autoResetSe === void 0 ? true : _instance$autoResetSe,
					selectedRowIds = instance.state.selectedRowIds,
					_instance$selectSubRo3 = instance.selectSubRows,
					selectSubRows =
						_instance$selectSubRo3 === void 0 ? true : _instance$selectSubRo3,
					dispatch = instance.dispatch,
					page = instance.page,
					getSubRows2 = instance.getSubRows;
				ensurePluginOrder6(
					plugins,
					[
						"useFilters",
						"useGroupBy",
						"useSortBy",
						"useExpanded",
						"usePagination",
					],
					"useRowSelect"
				);
				var selectedFlatRows = React12.useMemo(
					function () {
						var selectedFlatRows2 = [];
						rows.forEach(function (row) {
							var isSelected = selectSubRows
								? getRowIsSelected2(row, selectedRowIds, getSubRows2)
								: !!selectedRowIds[row.id];
							row.isSelected = !!isSelected;
							row.isSomeSelected = isSelected === null;
							if (isSelected) {
								selectedFlatRows2.push(row);
							}
						});
						return selectedFlatRows2;
					},
					[rows, selectSubRows, selectedRowIds, getSubRows2]
				);
				var isAllRowsSelected = Boolean(
					Object.keys(nonGroupedRowsById).length &&
					Object.keys(selectedRowIds).length
				);
				var isAllPageRowsSelected = isAllRowsSelected;
				if (isAllRowsSelected) {
					if (
						Object.keys(nonGroupedRowsById).some(function (id) {
							return !selectedRowIds[id];
						})
					) {
						isAllRowsSelected = false;
					}
				}
				if (!isAllRowsSelected) {
					if (
						page &&
						page.length &&
						page.some(function (_ref5) {
							var id = _ref5.id;
							return !selectedRowIds[id];
						})
					) {
						isAllPageRowsSelected = false;
					}
				}
				var getAutoResetSelectedRows = useGetLatest8(autoResetSelectedRows);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetSelectedRows()) {
							dispatch({
								type: actions5.resetSelectedRows,
							});
						}
					},
					[dispatch, data]
				);
				var toggleAllRowsSelected = React12.useCallback(
					function (value) {
						return dispatch({
							type: actions5.toggleAllRowsSelected,
							value,
						});
					},
					[dispatch]
				);
				var toggleAllPageRowsSelected = React12.useCallback(
					function (value) {
						return dispatch({
							type: actions5.toggleAllPageRowsSelected,
							value,
						});
					},
					[dispatch]
				);
				var toggleRowSelected = React12.useCallback(
					function (id, value) {
						return dispatch({
							type: actions5.toggleRowSelected,
							id,
							value,
						});
					},
					[dispatch]
				);
				var getInstance2 = useGetLatest8(instance);
				var getToggleAllRowsSelectedProps = makePropGetter5(
					getHooks().getToggleAllRowsSelectedProps,
					{
						instance: getInstance2(),
					}
				);
				var getToggleAllPageRowsSelectedProps = makePropGetter5(
					getHooks().getToggleAllPageRowsSelectedProps,
					{
						instance: getInstance2(),
					}
				);
				Object.assign(instance, {
					selectedFlatRows,
					isAllRowsSelected,
					isAllPageRowsSelected,
					toggleRowSelected,
					toggleAllRowsSelected,
					getToggleAllRowsSelectedProps,
					getToggleAllPageRowsSelectedProps,
					toggleAllPageRowsSelected,
				});
			}
			function prepareRow$3(row, _ref6) {
				var instance = _ref6.instance;
				row.toggleRowSelected = function (set) {
					return instance.toggleRowSelected(row.id, set);
				};
				row.getToggleRowSelectedProps = makePropGetter5(
					instance.getHooks().getToggleRowSelectedProps,
					{
						instance,
						row,
					}
				);
			}
			function getRowIsSelected2(row, selectedRowIds, getSubRows2) {
				if (selectedRowIds[row.id]) {
					return true;
				}
				var subRows = getSubRows2(row);
				if (subRows && subRows.length) {
					var allChildrenSelected = true;
					var someSelected = false;
					subRows.forEach(function (subRow) {
						if (someSelected && !allChildrenSelected) {
							return;
						}
						if (getRowIsSelected2(subRow, selectedRowIds, getSubRows2)) {
							someSelected = true;
						} else {
							allChildrenSelected = false;
						}
					});
					return allChildrenSelected ? true : someSelected ? null : false;
				}
				return false;
			}
			var defaultInitialRowStateAccessor =
				function defaultInitialRowStateAccessor2(row) {
					return {};
				};
			var defaultInitialCellStateAccessor =
				function defaultInitialCellStateAccessor2(cell) {
					return {};
				};
			actions5.setRowState = "setRowState";
			actions5.setCellState = "setCellState";
			actions5.resetRowState = "resetRowState";
			var useRowState = function useRowState2(hooks) {
				hooks.stateReducers.push(reducer$9);
				hooks.useInstance.push(useInstance$9);
				hooks.prepareRow.push(prepareRow$4);
			};
			useRowState.pluginName = "useRowState";
			function reducer$9(state, action, previousState, instance) {
				var _instance$initialRowS = instance.initialRowStateAccessor,
					initialRowStateAccessor =
						_instance$initialRowS === void 0
							? defaultInitialRowStateAccessor
							: _instance$initialRowS,
					_instance$initialCell = instance.initialCellStateAccessor,
					initialCellStateAccessor =
						_instance$initialCell === void 0
							? defaultInitialCellStateAccessor
							: _instance$initialCell,
					rowsById = instance.rowsById;
				if (action.type === actions5.init) {
					return _extends(
						{
							rowState: {},
						},
						state
					);
				}
				if (action.type === actions5.resetRowState) {
					return _extends({}, state, {
						rowState: instance.initialState.rowState || {},
					});
				}
				if (action.type === actions5.setRowState) {
					var _extends2;
					var rowId = action.rowId,
						value = action.value;
					var oldRowState =
						typeof state.rowState[rowId] !== "undefined"
							? state.rowState[rowId]
							: initialRowStateAccessor(rowsById[rowId]);
					return _extends({}, state, {
						rowState: _extends(
							{},
							state.rowState,
							((_extends2 = {}),
								(_extends2[rowId] = functionalUpdate2(value, oldRowState)),
								_extends2)
						),
					});
				}
				if (action.type === actions5.setCellState) {
					var _oldRowState$cellStat,
						_rowsById$_rowId,
						_rowsById$_rowId$cell,
						_extends3,
						_extends4;
					var _rowId = action.rowId,
						columnId = action.columnId,
						_value = action.value;
					var _oldRowState =
						typeof state.rowState[_rowId] !== "undefined"
							? state.rowState[_rowId]
							: initialRowStateAccessor(rowsById[_rowId]);
					var oldCellState =
						typeof (_oldRowState == null
							? void 0
							: (_oldRowState$cellStat = _oldRowState.cellState) == null
								? void 0
								: _oldRowState$cellStat[columnId]) !== "undefined"
							? _oldRowState.cellState[columnId]
							: initialCellStateAccessor(
								(_rowsById$_rowId = rowsById[_rowId]) == null
									? void 0
									: (_rowsById$_rowId$cell = _rowsById$_rowId.cells) == null
										? void 0
										: _rowsById$_rowId$cell.find(function (cell) {
											return cell.column.id === columnId;
										})
							);
					return _extends({}, state, {
						rowState: _extends(
							{},
							state.rowState,
							((_extends4 = {}),
								(_extends4[_rowId] = _extends({}, _oldRowState, {
									cellState: _extends(
										{},
										_oldRowState.cellState || {},
										((_extends3 = {}),
											(_extends3[columnId] = functionalUpdate2(
												_value,
												oldCellState
											)),
											_extends3)
									),
								})),
								_extends4)
						),
					});
				}
			}
			function useInstance$9(instance) {
				var _instance$autoResetRo = instance.autoResetRowState,
					autoResetRowState =
						_instance$autoResetRo === void 0 ? true : _instance$autoResetRo,
					data = instance.data,
					dispatch = instance.dispatch;
				var setRowState = React12.useCallback(
					function (rowId, value) {
						return dispatch({
							type: actions5.setRowState,
							rowId,
							value,
						});
					},
					[dispatch]
				);
				var setCellState = React12.useCallback(
					function (rowId, columnId, value) {
						return dispatch({
							type: actions5.setCellState,
							rowId,
							columnId,
							value,
						});
					},
					[dispatch]
				);
				var getAutoResetRowState = useGetLatest8(autoResetRowState);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetRowState()) {
							dispatch({
								type: actions5.resetRowState,
							});
						}
					},
					[data]
				);
				Object.assign(instance, {
					setRowState,
					setCellState,
				});
			}
			function prepareRow$4(row, _ref) {
				var instance = _ref.instance;
				var _instance$initialRowS2 = instance.initialRowStateAccessor,
					initialRowStateAccessor =
						_instance$initialRowS2 === void 0
							? defaultInitialRowStateAccessor
							: _instance$initialRowS2,
					_instance$initialCell2 = instance.initialCellStateAccessor,
					initialCellStateAccessor =
						_instance$initialCell2 === void 0
							? defaultInitialCellStateAccessor
							: _instance$initialCell2,
					rowState = instance.state.rowState;
				if (row) {
					row.state =
						typeof rowState[row.id] !== "undefined"
							? rowState[row.id]
							: initialRowStateAccessor(row);
					row.setState = function (updater) {
						return instance.setRowState(row.id, updater);
					};
					row.cells.forEach(function (cell) {
						if (!row.state.cellState) {
							row.state.cellState = {};
						}
						cell.state =
							typeof row.state.cellState[cell.column.id] !== "undefined"
								? row.state.cellState[cell.column.id]
								: initialCellStateAccessor(cell);
						cell.setState = function (updater) {
							return instance.setCellState(row.id, cell.column.id, updater);
						};
					});
				}
			}
			actions5.resetColumnOrder = "resetColumnOrder";
			actions5.setColumnOrder = "setColumnOrder";
			var useColumnOrder = function useColumnOrder2(hooks) {
				hooks.stateReducers.push(reducer$a);
				hooks.visibleColumnsDeps.push(function (deps, _ref) {
					var instance = _ref.instance;
					return [].concat(deps, [instance.state.columnOrder]);
				});
				hooks.visibleColumns.push(visibleColumns$2);
				hooks.useInstance.push(useInstance$a);
			};
			useColumnOrder.pluginName = "useColumnOrder";
			function reducer$a(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							columnOrder: [],
						},
						state
					);
				}
				if (action.type === actions5.resetColumnOrder) {
					return _extends({}, state, {
						columnOrder: instance.initialState.columnOrder || [],
					});
				}
				if (action.type === actions5.setColumnOrder) {
					return _extends({}, state, {
						columnOrder: functionalUpdate2(
							action.columnOrder,
							state.columnOrder
						),
					});
				}
			}
			function visibleColumns$2(columns, _ref2) {
				var columnOrder = _ref2.instance.state.columnOrder;
				if (!columnOrder || !columnOrder.length) {
					return columns;
				}
				var columnOrderCopy = [].concat(columnOrder);
				var columnsCopy = [].concat(columns);
				var columnsInOrder = [];
				var _loop = function _loop2() {
					var targetColumnId = columnOrderCopy.shift();
					var foundIndex = columnsCopy.findIndex(function (d) {
						return d.id === targetColumnId;
					});
					if (foundIndex > -1) {
						columnsInOrder.push(columnsCopy.splice(foundIndex, 1)[0]);
					}
				};
				while (columnsCopy.length && columnOrderCopy.length) {
					_loop();
				}
				return [].concat(columnsInOrder, columnsCopy);
			}
			function useInstance$a(instance) {
				var dispatch = instance.dispatch;
				instance.setColumnOrder = React12.useCallback(
					function (columnOrder) {
						return dispatch({
							type: actions5.setColumnOrder,
							columnOrder,
						});
					},
					[dispatch]
				);
			}
			defaultColumn2.canResize = true;
			actions5.columnStartResizing = "columnStartResizing";
			actions5.columnResizing = "columnResizing";
			actions5.columnDoneResizing = "columnDoneResizing";
			actions5.resetResize = "resetResize";
			var useResizeColumns2 = function useResizeColumns3(hooks) {
				hooks.getResizerProps = [defaultGetResizerProps2];
				hooks.getHeaderProps.push({
					style: {
						position: "relative",
					},
				});
				hooks.stateReducers.push(reducer$b);
				hooks.useInstance.push(useInstance$b);
				hooks.useInstanceBeforeDimensions.push(useInstanceBeforeDimensions$1);
			};
			var defaultGetResizerProps2 = function defaultGetResizerProps3(
				props,
				_ref
			) {
				var instance = _ref.instance,
					header = _ref.header;
				var dispatch = instance.dispatch;
				var onResizeStart = function onResizeStart2(e, header2) {
					var isTouchEvent = false;
					if (e.type === "touchstart") {
						if (e.touches && e.touches.length > 1) {
							return;
						}
						isTouchEvent = true;
					}
					var headersToResize = getLeafHeaders(header2);
					var headerIdWidths = headersToResize.map(function (d) {
						return [d.id, d.totalWidth];
					});
					var clientX = isTouchEvent
						? Math.round(e.touches[0].clientX)
						: e.clientX;
					var raf;
					var mostRecentClientX;
					var dispatchEnd = function dispatchEnd2() {
						window.cancelAnimationFrame(raf);
						raf = null;
						dispatch({
							type: actions5.columnDoneResizing,
						});
					};
					var dispatchMove = function dispatchMove2() {
						window.cancelAnimationFrame(raf);
						raf = null;
						dispatch({
							type: actions5.columnResizing,
							clientX: mostRecentClientX,
						});
					};
					var scheduleDispatchMoveOnNextAnimationFrame =
						function scheduleDispatchMoveOnNextAnimationFrame2(clientXPos) {
							mostRecentClientX = clientXPos;
							if (!raf) {
								raf = window.requestAnimationFrame(dispatchMove);
							}
						};
					var handlersAndEvents = {
						mouse: {
							moveEvent: "mousemove",
							moveHandler: function moveHandler(e2) {
								return scheduleDispatchMoveOnNextAnimationFrame(e2.clientX);
							},
							upEvent: "mouseup",
							upHandler: function upHandler(e2) {
								document.removeEventListener(
									"mousemove",
									handlersAndEvents.mouse.moveHandler
								);
								document.removeEventListener(
									"mouseup",
									handlersAndEvents.mouse.upHandler
								);
								dispatchEnd();
							},
						},
						touch: {
							moveEvent: "touchmove",
							moveHandler: function moveHandler(e2) {
								if (e2.cancelable) {
									e2.preventDefault();
									e2.stopPropagation();
								}
								scheduleDispatchMoveOnNextAnimationFrame(e2.touches[0].clientX);
								return false;
							},
							upEvent: "touchend",
							upHandler: function upHandler(e2) {
								document.removeEventListener(
									handlersAndEvents.touch.moveEvent,
									handlersAndEvents.touch.moveHandler
								);
								document.removeEventListener(
									handlersAndEvents.touch.upEvent,
									handlersAndEvents.touch.moveHandler
								);
								dispatchEnd();
							},
						},
					};
					var events = isTouchEvent
						? handlersAndEvents.touch
						: handlersAndEvents.mouse;
					var passiveIfSupported = passiveEventSupported2()
						? {
							passive: false,
						}
						: false;
					document.addEventListener(
						events.moveEvent,
						events.moveHandler,
						passiveIfSupported
					);
					document.addEventListener(
						events.upEvent,
						events.upHandler,
						passiveIfSupported
					);
					dispatch({
						type: actions5.columnStartResizing,
						columnId: header2.id,
						columnWidth: header2.totalWidth,
						headerIdWidths,
						clientX,
					});
				};
				return [
					props,
					{
						onMouseDown: function onMouseDown(e) {
							return e.persist() || onResizeStart(e, header);
						},
						onTouchStart: function onTouchStart(e) {
							return e.persist() || onResizeStart(e, header);
						},
						style: {
							cursor: "col-resize",
						},
						draggable: false,
						role: "separator",
					},
				];
			};
			useResizeColumns2.pluginName = "useResizeColumns";
			function reducer$b(state, action) {
				if (action.type === actions5.init) {
					return _extends(
						{
							columnResizing: {
								columnWidths: {},
							},
						},
						state
					);
				}
				if (action.type === actions5.resetResize) {
					return _extends({}, state, {
						columnResizing: {
							columnWidths: {},
						},
					});
				}
				if (action.type === actions5.columnStartResizing) {
					var clientX = action.clientX,
						columnId = action.columnId,
						columnWidth = action.columnWidth,
						headerIdWidths = action.headerIdWidths;
					return _extends({}, state, {
						columnResizing: _extends({}, state.columnResizing, {
							startX: clientX,
							headerIdWidths,
							columnWidth,
							isResizingColumn: columnId,
						}),
					});
				}
				if (action.type === actions5.columnResizing) {
					var _clientX = action.clientX;
					var _state$columnResizing = state.columnResizing,
						startX = _state$columnResizing.startX,
						_columnWidth = _state$columnResizing.columnWidth,
						_state$columnResizing2 = _state$columnResizing.headerIdWidths,
						_headerIdWidths =
							_state$columnResizing2 === void 0 ? [] : _state$columnResizing2;
					var deltaX = _clientX - startX;
					var percentageDeltaX = deltaX / _columnWidth;
					var newColumnWidths = {};
					_headerIdWidths.forEach(function (_ref2) {
						var headerId = _ref2[0],
							headerWidth = _ref2[1];
						newColumnWidths[headerId] = Math.max(
							headerWidth + headerWidth * percentageDeltaX,
							0
						);
					});
					return _extends({}, state, {
						columnResizing: _extends({}, state.columnResizing, {
							columnWidths: _extends(
								{},
								state.columnResizing.columnWidths,
								{},
								newColumnWidths
							),
						}),
					});
				}
				if (action.type === actions5.columnDoneResizing) {
					return _extends({}, state, {
						columnResizing: _extends({}, state.columnResizing, {
							startX: null,
							isResizingColumn: null,
						}),
					});
				}
			}
			var useInstanceBeforeDimensions$1 = function useInstanceBeforeDimensions3(
				instance
			) {
				var flatHeaders = instance.flatHeaders,
					disableResizing = instance.disableResizing,
					getHooks = instance.getHooks,
					columnResizing = instance.state.columnResizing;
				var getInstance2 = useGetLatest8(instance);
				flatHeaders.forEach(function (header) {
					var canResize = getFirstDefined2(
						header.disableResizing === true ? false : void 0,
						disableResizing === true ? false : void 0,
						true
					);
					header.canResize = canResize;
					header.width =
						columnResizing.columnWidths[header.id] ||
						header.originalWidth ||
						header.width;
					header.isResizing = columnResizing.isResizingColumn === header.id;
					if (canResize) {
						header.getResizerProps = makePropGetter5(
							getHooks().getResizerProps,
							{
								instance: getInstance2(),
								header,
							}
						);
					}
				});
			};
			function useInstance$b(instance) {
				var plugins = instance.plugins,
					dispatch = instance.dispatch,
					_instance$autoResetRe = instance.autoResetResize,
					autoResetResize =
						_instance$autoResetRe === void 0 ? true : _instance$autoResetRe,
					columns = instance.columns;
				ensurePluginOrder6(plugins, ["useAbsoluteLayout"], "useResizeColumns");
				var getAutoResetResize = useGetLatest8(autoResetResize);
				useMountedLayoutEffect6(
					function () {
						if (getAutoResetResize()) {
							dispatch({
								type: actions5.resetResize,
							});
						}
					},
					[columns]
				);
				var resetResizing = React12.useCallback(
					function () {
						return dispatch({
							type: actions5.resetResize,
						});
					},
					[dispatch]
				);
				Object.assign(instance, {
					resetResizing,
				});
			}
			function getLeafHeaders(header) {
				var leafHeaders = [];
				var recurseHeader = function recurseHeader2(header2) {
					if (header2.columns && header2.columns.length) {
						header2.columns.map(recurseHeader2);
					}
					leafHeaders.push(header2);
				};
				recurseHeader(header);
				return leafHeaders;
			}
			var cellStyles = {
				position: "absolute",
				top: 0,
			};
			var useAbsoluteLayout = function useAbsoluteLayout2(hooks) {
				hooks.getTableBodyProps.push(getRowStyles2);
				hooks.getRowProps.push(getRowStyles2);
				hooks.getHeaderGroupProps.push(getRowStyles2);
				hooks.getFooterGroupProps.push(getRowStyles2);
				hooks.getHeaderProps.push(function (props, _ref) {
					var column2 = _ref.column;
					return [
						props,
						{
							style: _extends({}, cellStyles, {
								left: column2.totalLeft + "px",
								width: column2.totalWidth + "px",
							}),
						},
					];
				});
				hooks.getCellProps.push(function (props, _ref2) {
					var cell = _ref2.cell;
					return [
						props,
						{
							style: _extends({}, cellStyles, {
								left: cell.column.totalLeft + "px",
								width: cell.column.totalWidth + "px",
							}),
						},
					];
				});
				hooks.getFooterProps.push(function (props, _ref3) {
					var column2 = _ref3.column;
					return [
						props,
						{
							style: _extends({}, cellStyles, {
								left: column2.totalLeft + "px",
								width: column2.totalWidth + "px",
							}),
						},
					];
				});
			};
			useAbsoluteLayout.pluginName = "useAbsoluteLayout";
			var getRowStyles2 = function getRowStyles3(props, _ref4) {
				var instance = _ref4.instance;
				return [
					props,
					{
						style: {
							position: "relative",
							width: instance.totalColumnsWidth + "px",
						},
					},
				];
			};
			var cellStyles$1 = {
				display: "inline-block",
				boxSizing: "border-box",
			};
			var getRowStyles$1 = function getRowStyles3(props, _ref) {
				var instance = _ref.instance;
				return [
					props,
					{
						style: {
							display: "flex",
							width: instance.totalColumnsWidth + "px",
						},
					},
				];
			};
			var useBlockLayout = function useBlockLayout2(hooks) {
				hooks.getRowProps.push(getRowStyles$1);
				hooks.getHeaderGroupProps.push(getRowStyles$1);
				hooks.getFooterGroupProps.push(getRowStyles$1);
				hooks.getHeaderProps.push(function (props, _ref2) {
					var column2 = _ref2.column;
					return [
						props,
						{
							style: _extends({}, cellStyles$1, {
								width: column2.totalWidth + "px",
							}),
						},
					];
				});
				hooks.getCellProps.push(function (props, _ref3) {
					var cell = _ref3.cell;
					return [
						props,
						{
							style: _extends({}, cellStyles$1, {
								width: cell.column.totalWidth + "px",
							}),
						},
					];
				});
				hooks.getFooterProps.push(function (props, _ref4) {
					var column2 = _ref4.column;
					return [
						props,
						{
							style: _extends({}, cellStyles$1, {
								width: column2.totalWidth + "px",
							}),
						},
					];
				});
			};
			useBlockLayout.pluginName = "useBlockLayout";
			function useFlexLayout2(hooks) {
				hooks.getTableProps.push(getTableProps);
				hooks.getRowProps.push(getRowStyles$2);
				hooks.getHeaderGroupProps.push(getRowStyles$2);
				hooks.getFooterGroupProps.push(getRowStyles$2);
				hooks.getHeaderProps.push(getHeaderProps3);
				hooks.getCellProps.push(getCellProps3);
				hooks.getFooterProps.push(getFooterProps3);
			}
			useFlexLayout2.pluginName = "useFlexLayout";
			var getTableProps = function getTableProps2(props, _ref) {
				var instance = _ref.instance;
				return [
					props,
					{
						style: {
							minWidth: instance.totalColumnsMinWidth + "px",
						},
					},
				];
			};
			var getRowStyles$2 = function getRowStyles3(props, _ref2) {
				var instance = _ref2.instance;
				return [
					props,
					{
						style: {
							display: "flex",
							flex: "1 0 auto",
							minWidth: instance.totalColumnsMinWidth + "px",
						},
					},
				];
			};
			var getHeaderProps3 = function getHeaderProps4(props, _ref3) {
				var column2 = _ref3.column;
				return [
					props,
					{
						style: {
							boxSizing: "border-box",
							flex: column2.totalFlexWidth
								? column2.totalFlexWidth + " 0 auto"
								: void 0,
							minWidth: column2.totalMinWidth + "px",
							width: column2.totalWidth + "px",
						},
					},
				];
			};
			var getCellProps3 = function getCellProps4(props, _ref4) {
				var cell = _ref4.cell;
				return [
					props,
					{
						style: {
							boxSizing: "border-box",
							flex: cell.column.totalFlexWidth + " 0 auto",
							minWidth: cell.column.totalMinWidth + "px",
							width: cell.column.totalWidth + "px",
						},
					},
				];
			};
			var getFooterProps3 = function getFooterProps4(props, _ref5) {
				var column2 = _ref5.column;
				return [
					props,
					{
						style: {
							boxSizing: "border-box",
							flex: column2.totalFlexWidth
								? column2.totalFlexWidth + " 0 auto"
								: void 0,
							minWidth: column2.totalMinWidth + "px",
							width: column2.totalWidth + "px",
						},
					},
				];
			};
			actions5.columnStartResizing = "columnStartResizing";
			actions5.columnResizing = "columnResizing";
			actions5.columnDoneResizing = "columnDoneResizing";
			actions5.resetResize = "resetResize";
			function useGridLayout(hooks) {
				hooks.stateReducers.push(reducer$c);
				hooks.getTableProps.push(getTableProps$1);
				hooks.getHeaderProps.push(getHeaderProps$1);
				hooks.getRowProps.push(getRowProps);
			}
			useGridLayout.pluginName = "useGridLayout";
			var getTableProps$1 = function getTableProps2(props, _ref) {
				var instance = _ref.instance;
				var gridTemplateColumns = instance.visibleColumns.map(function (
					column2
				) {
					var _instance$state$colum;
					if (instance.state.gridLayout.columnWidths[column2.id])
						return instance.state.gridLayout.columnWidths[column2.id] + "px";
					if (
						(_instance$state$colum = instance.state.columnResizing) == null
							? void 0
							: _instance$state$colum.isResizingColumn
					)
						return instance.state.gridLayout.startWidths[column2.id] + "px";
					if (typeof column2.width === "number") return column2.width + "px";
					return column2.width;
				});
				return [
					props,
					{
						style: {
							display: "grid",
							gridTemplateColumns: gridTemplateColumns.join(" "),
						},
					},
				];
			};
			var getHeaderProps$1 = function getHeaderProps4(props, _ref2) {
				var column2 = _ref2.column;
				return [
					props,
					{
						id: "header-cell-" + column2.id,
						style: {
							position: "sticky",
							//enables a scroll wrapper to be placed around the table and have sticky headers
							gridColumn: "span " + column2.totalVisibleHeaderCount,
						},
					},
				];
			};
			var getRowProps = function getRowProps2(props, _ref3) {
				var row = _ref3.row;
				if (row.isExpanded) {
					return [
						props,
						{
							style: {
								gridColumn: "1 / " + (row.cells.length + 1),
							},
						},
					];
				}
				return [props, {}];
			};
			function reducer$c(state, action, previousState, instance) {
				if (action.type === actions5.init) {
					return _extends(
						{
							gridLayout: {
								columnWidths: {},
							},
						},
						state
					);
				}
				if (action.type === actions5.resetResize) {
					return _extends({}, state, {
						gridLayout: {
							columnWidths: {},
						},
					});
				}
				if (action.type === actions5.columnStartResizing) {
					var columnId = action.columnId,
						headerIdWidths = action.headerIdWidths;
					var columnWidth = getElementWidth(columnId);
					if (columnWidth !== void 0) {
						var startWidths = instance.visibleColumns.reduce(function (
							acc,
							column2
						) {
							var _extends2;
							return _extends(
								{},
								acc,
								((_extends2 = {}),
									(_extends2[column2.id] = getElementWidth(column2.id)),
									_extends2)
							);
						},
							{});
						var minWidths = instance.visibleColumns.reduce(function (
							acc,
							column2
						) {
							var _extends3;
							return _extends(
								{},
								acc,
								((_extends3 = {}),
									(_extends3[column2.id] = column2.minWidth),
									_extends3)
							);
						},
							{});
						var maxWidths = instance.visibleColumns.reduce(function (
							acc,
							column2
						) {
							var _extends4;
							return _extends(
								{},
								acc,
								((_extends4 = {}),
									(_extends4[column2.id] = column2.maxWidth),
									_extends4)
							);
						},
							{});
						var headerIdGridWidths = headerIdWidths.map(function (_ref4) {
							var headerId = _ref4[0];
							return [headerId, getElementWidth(headerId)];
						});
						return _extends({}, state, {
							gridLayout: _extends({}, state.gridLayout, {
								startWidths,
								minWidths,
								maxWidths,
								headerIdGridWidths,
								columnWidth,
							}),
						});
					} else {
						return state;
					}
				}
				if (action.type === actions5.columnResizing) {
					var clientX = action.clientX;
					var startX = state.columnResizing.startX;
					var _state$gridLayout = state.gridLayout,
						_columnWidth = _state$gridLayout.columnWidth,
						_minWidths = _state$gridLayout.minWidths,
						_maxWidths = _state$gridLayout.maxWidths,
						_state$gridLayout$hea = _state$gridLayout.headerIdGridWidths,
						_headerIdGridWidths =
							_state$gridLayout$hea === void 0 ? [] : _state$gridLayout$hea;
					var deltaX = clientX - startX;
					var percentageDeltaX = deltaX / _columnWidth;
					var newColumnWidths = {};
					_headerIdGridWidths.forEach(function (_ref5) {
						var headerId = _ref5[0],
							headerWidth = _ref5[1];
						newColumnWidths[headerId] = Math.min(
							Math.max(
								_minWidths[headerId],
								headerWidth + headerWidth * percentageDeltaX
							),
							_maxWidths[headerId]
						);
					});
					return _extends({}, state, {
						gridLayout: _extends({}, state.gridLayout, {
							columnWidths: _extends(
								{},
								state.gridLayout.columnWidths,
								{},
								newColumnWidths
							),
						}),
					});
				}
				if (action.type === actions5.columnDoneResizing) {
					return _extends({}, state, {
						gridLayout: _extends({}, state.gridLayout, {
							startWidths: {},
							minWidths: {},
							maxWidths: {},
						}),
					});
				}
			}
			function getElementWidth(columnId) {
				var _document$getElementB;
				var width =
					(_document$getElementB = document.getElementById(
						"header-cell-" + columnId
					)) == null
						? void 0
						: _document$getElementB.offsetWidth;
				if (width !== void 0) {
					return width;
				}
			}
			exports2._UNSTABLE_usePivotColumns = _UNSTABLE_usePivotColumns;
			exports2.actions = actions5;
			exports2.defaultColumn = defaultColumn2;
			exports2.defaultGroupByFn = defaultGroupByFn2;
			exports2.defaultOrderByFn = defaultOrderByFn;
			exports2.defaultRenderer = defaultRenderer;
			exports2.emptyRenderer = emptyRenderer;
			exports2.ensurePluginOrder = ensurePluginOrder6;
			exports2.flexRender = flexRender;
			exports2.functionalUpdate = functionalUpdate2;
			exports2.loopHooks = loopHooks;
			exports2.makePropGetter = makePropGetter5;
			exports2.makeRenderer = makeRenderer;
			exports2.reduceHooks = reduceHooks;
			exports2.safeUseLayoutEffect = safeUseLayoutEffect2;
			exports2.useAbsoluteLayout = useAbsoluteLayout;
			exports2.useAsyncDebounce = useAsyncDebounce2;
			exports2.useBlockLayout = useBlockLayout;
			exports2.useColumnOrder = useColumnOrder;
			exports2.useExpanded = useExpanded2;
			exports2.useFilters = useFilters2;
			exports2.useFlexLayout = useFlexLayout2;
			exports2.useGetLatest = useGetLatest8;
			exports2.useGlobalFilter = useGlobalFilter2;
			exports2.useGridLayout = useGridLayout;
			exports2.useGroupBy = useGroupBy2;
			exports2.useMountedLayoutEffect = useMountedLayoutEffect6;
			exports2.usePagination = usePagination2;
			exports2.useResizeColumns = useResizeColumns2;
			exports2.useRowSelect = useRowSelect2;
			exports2.useRowState = useRowState;
			exports2.useSortBy = useSortBy2;
			exports2.useTable = useTable2;
			Object.defineProperty(exports2, "__esModule", { value: true });
		});
	},
});

// tmp/reactable/node_modules/react-table/index.js
var require_react_table = __commonJS({
	"tmp/reactable/node_modules/react-table/index.js"(exports, module) {
		if (false) {
			module.exports = null;
		} else {
			module.exports = require_react_table_development();
		}
	},
});

// tmp/reactable/node_modules/prop-types/node_modules/react-is/cjs/react-is.development.js
var require_react_is_development = __commonJS({
	"tmp/reactable/node_modules/prop-types/node_modules/react-is/cjs/react-is.development.js"(
		exports
	) {
		"use strict";
		if (true) {
			(function () {
				"use strict";
				var hasSymbol = typeof Symbol === "function" && Symbol.for;
				var REACT_ELEMENT_TYPE = hasSymbol
					? Symbol.for("react.element")
					: 60103;
				var REACT_PORTAL_TYPE = hasSymbol ? Symbol.for("react.portal") : 60106;
				var REACT_FRAGMENT_TYPE = hasSymbol
					? Symbol.for("react.fragment")
					: 60107;
				var REACT_STRICT_MODE_TYPE = hasSymbol
					? Symbol.for("react.strict_mode")
					: 60108;
				var REACT_PROFILER_TYPE = hasSymbol
					? Symbol.for("react.profiler")
					: 60114;
				var REACT_PROVIDER_TYPE = hasSymbol
					? Symbol.for("react.provider")
					: 60109;
				var REACT_CONTEXT_TYPE = hasSymbol
					? Symbol.for("react.context")
					: 60110;
				var REACT_ASYNC_MODE_TYPE = hasSymbol
					? Symbol.for("react.async_mode")
					: 60111;
				var REACT_CONCURRENT_MODE_TYPE = hasSymbol
					? Symbol.for("react.concurrent_mode")
					: 60111;
				var REACT_FORWARD_REF_TYPE = hasSymbol
					? Symbol.for("react.forward_ref")
					: 60112;
				var REACT_SUSPENSE_TYPE = hasSymbol
					? Symbol.for("react.suspense")
					: 60113;
				var REACT_SUSPENSE_LIST_TYPE = hasSymbol
					? Symbol.for("react.suspense_list")
					: 60120;
				var REACT_MEMO_TYPE = hasSymbol ? Symbol.for("react.memo") : 60115;
				var REACT_LAZY_TYPE = hasSymbol ? Symbol.for("react.lazy") : 60116;
				var REACT_BLOCK_TYPE = hasSymbol ? Symbol.for("react.block") : 60121;
				var REACT_FUNDAMENTAL_TYPE = hasSymbol
					? Symbol.for("react.fundamental")
					: 60117;
				var REACT_RESPONDER_TYPE = hasSymbol
					? Symbol.for("react.responder")
					: 60118;
				var REACT_SCOPE_TYPE = hasSymbol ? Symbol.for("react.scope") : 60119;
				function isValidElementType(type) {
					return (
						typeof type === "string" ||
						typeof type === "function" || // Note: its typeof might be other than 'symbol' or 'number' if it's a polyfill.
						type === REACT_FRAGMENT_TYPE ||
						type === REACT_CONCURRENT_MODE_TYPE ||
						type === REACT_PROFILER_TYPE ||
						type === REACT_STRICT_MODE_TYPE ||
						type === REACT_SUSPENSE_TYPE ||
						type === REACT_SUSPENSE_LIST_TYPE ||
						(typeof type === "object" &&
							type !== null &&
							(type.$$typeof === REACT_LAZY_TYPE ||
								type.$$typeof === REACT_MEMO_TYPE ||
								type.$$typeof === REACT_PROVIDER_TYPE ||
								type.$$typeof === REACT_CONTEXT_TYPE ||
								type.$$typeof === REACT_FORWARD_REF_TYPE ||
								type.$$typeof === REACT_FUNDAMENTAL_TYPE ||
								type.$$typeof === REACT_RESPONDER_TYPE ||
								type.$$typeof === REACT_SCOPE_TYPE ||
								type.$$typeof === REACT_BLOCK_TYPE))
					);
				}
				function typeOf(object) {
					if (typeof object === "object" && object !== null) {
						var $$typeof = object.$$typeof;
						switch ($$typeof) {
							case REACT_ELEMENT_TYPE:
								var type = object.type;
								switch (type) {
									case REACT_ASYNC_MODE_TYPE:
									case REACT_CONCURRENT_MODE_TYPE:
									case REACT_FRAGMENT_TYPE:
									case REACT_PROFILER_TYPE:
									case REACT_STRICT_MODE_TYPE:
									case REACT_SUSPENSE_TYPE:
										return type;
									default:
										var $$typeofType = type && type.$$typeof;
										switch ($$typeofType) {
											case REACT_CONTEXT_TYPE:
											case REACT_FORWARD_REF_TYPE:
											case REACT_LAZY_TYPE:
											case REACT_MEMO_TYPE:
											case REACT_PROVIDER_TYPE:
												return $$typeofType;
											default:
												return $$typeof;
										}
								}
							case REACT_PORTAL_TYPE:
								return $$typeof;
						}
					}
					return void 0;
				}
				var AsyncMode = REACT_ASYNC_MODE_TYPE;
				var ConcurrentMode = REACT_CONCURRENT_MODE_TYPE;
				var ContextConsumer = REACT_CONTEXT_TYPE;
				var ContextProvider = REACT_PROVIDER_TYPE;
				var Element = REACT_ELEMENT_TYPE;
				var ForwardRef = REACT_FORWARD_REF_TYPE;
				var Fragment3 = REACT_FRAGMENT_TYPE;
				var Lazy = REACT_LAZY_TYPE;
				var Memo = REACT_MEMO_TYPE;
				var Portal = REACT_PORTAL_TYPE;
				var Profiler = REACT_PROFILER_TYPE;
				var StrictMode = REACT_STRICT_MODE_TYPE;
				var Suspense = REACT_SUSPENSE_TYPE;
				var hasWarnedAboutDeprecatedIsAsyncMode = false;
				function isAsyncMode(object) {
					{
						if (!hasWarnedAboutDeprecatedIsAsyncMode) {
							hasWarnedAboutDeprecatedIsAsyncMode = true;
							console["warn"](
								"The ReactIs.isAsyncMode() alias has been deprecated, and will be removed in React 17+. Update your code to use ReactIs.isConcurrentMode() instead. It has the exact same API."
							);
						}
					}
					return (
						isConcurrentMode(object) || typeOf(object) === REACT_ASYNC_MODE_TYPE
					);
				}
				function isConcurrentMode(object) {
					return typeOf(object) === REACT_CONCURRENT_MODE_TYPE;
				}
				function isContextConsumer(object) {
					return typeOf(object) === REACT_CONTEXT_TYPE;
				}
				function isContextProvider(object) {
					return typeOf(object) === REACT_PROVIDER_TYPE;
				}
				function isElement(object) {
					return (
						typeof object === "object" &&
						object !== null &&
						object.$$typeof === REACT_ELEMENT_TYPE
					);
				}
				function isForwardRef(object) {
					return typeOf(object) === REACT_FORWARD_REF_TYPE;
				}
				function isFragment(object) {
					return typeOf(object) === REACT_FRAGMENT_TYPE;
				}
				function isLazy(object) {
					return typeOf(object) === REACT_LAZY_TYPE;
				}
				function isMemo(object) {
					return typeOf(object) === REACT_MEMO_TYPE;
				}
				function isPortal(object) {
					return typeOf(object) === REACT_PORTAL_TYPE;
				}
				function isProfiler(object) {
					return typeOf(object) === REACT_PROFILER_TYPE;
				}
				function isStrictMode(object) {
					return typeOf(object) === REACT_STRICT_MODE_TYPE;
				}
				function isSuspense(object) {
					return typeOf(object) === REACT_SUSPENSE_TYPE;
				}
				exports.AsyncMode = AsyncMode;
				exports.ConcurrentMode = ConcurrentMode;
				exports.ContextConsumer = ContextConsumer;
				exports.ContextProvider = ContextProvider;
				exports.Element = Element;
				exports.ForwardRef = ForwardRef;
				exports.Fragment = Fragment3;
				exports.Lazy = Lazy;
				exports.Memo = Memo;
				exports.Portal = Portal;
				exports.Profiler = Profiler;
				exports.StrictMode = StrictMode;
				exports.Suspense = Suspense;
				exports.isAsyncMode = isAsyncMode;
				exports.isConcurrentMode = isConcurrentMode;
				exports.isContextConsumer = isContextConsumer;
				exports.isContextProvider = isContextProvider;
				exports.isElement = isElement;
				exports.isForwardRef = isForwardRef;
				exports.isFragment = isFragment;
				exports.isLazy = isLazy;
				exports.isMemo = isMemo;
				exports.isPortal = isPortal;
				exports.isProfiler = isProfiler;
				exports.isStrictMode = isStrictMode;
				exports.isSuspense = isSuspense;
				exports.isValidElementType = isValidElementType;
				exports.typeOf = typeOf;
			})();
		}
	},
});

// tmp/reactable/node_modules/prop-types/node_modules/react-is/index.js
var require_react_is = __commonJS({
	"tmp/reactable/node_modules/prop-types/node_modules/react-is/index.js"(
		exports,
		module
	) {
		"use strict";
		if (false) {
			module.exports = null;
		} else {
			module.exports = require_react_is_development();
		}
	},
});

// tmp/reactable/node_modules/object-assign/index.js
var require_object_assign = __commonJS({
	"tmp/reactable/node_modules/object-assign/index.js"(exports, module) {
		"use strict";
		var getOwnPropertySymbols = Object.getOwnPropertySymbols;
		var hasOwnProperty = Object.prototype.hasOwnProperty;
		var propIsEnumerable = Object.prototype.propertyIsEnumerable;
		function toObject(val) {
			if (val === null || val === void 0) {
				throw new TypeError(
					"Object.assign cannot be called with null or undefined"
				);
			}
			return Object(val);
		}
		function shouldUseNative() {
			try {
				if (!Object.assign) {
					return false;
				}
				var test1 = new String("abc");
				test1[5] = "de";
				if (Object.getOwnPropertyNames(test1)[0] === "5") {
					return false;
				}
				var test2 = {};
				for (var i = 0; i < 10; i++) {
					test2["_" + String.fromCharCode(i)] = i;
				}
				var order2 = Object.getOwnPropertyNames(test2).map(function (n) {
					return test2[n];
				});
				if (order2.join("") !== "0123456789") {
					return false;
				}
				var test3 = {};
				"abcdefghijklmnopqrst".split("").forEach(function (letter) {
					test3[letter] = letter;
				});
				if (
					Object.keys(Object.assign({}, test3)).join("") !==
					"abcdefghijklmnopqrst"
				) {
					return false;
				}
				return true;
			} catch (err) {
				return false;
			}
		}
		module.exports = shouldUseNative()
			? Object.assign
			: function (target, source) {
				var from2;
				var to = toObject(target);
				var symbols;
				for (var s = 1; s < arguments.length; s++) {
					from2 = Object(arguments[s]);
					for (var key in from2) {
						if (hasOwnProperty.call(from2, key)) {
							to[key] = from2[key];
						}
					}
					if (getOwnPropertySymbols) {
						symbols = getOwnPropertySymbols(from2);
						for (var i = 0; i < symbols.length; i++) {
							if (propIsEnumerable.call(from2, symbols[i])) {
								to[symbols[i]] = from2[symbols[i]];
							}
						}
					}
				}
				return to;
			};
	},
});

// tmp/reactable/node_modules/prop-types/lib/ReactPropTypesSecret.js
var require_ReactPropTypesSecret = __commonJS({
	"tmp/reactable/node_modules/prop-types/lib/ReactPropTypesSecret.js"(
		exports,
		module
	) {
		"use strict";
		var ReactPropTypesSecret = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";
		module.exports = ReactPropTypesSecret;
	},
});

// tmp/reactable/node_modules/prop-types/lib/has.js
var require_has = __commonJS({
	"tmp/reactable/node_modules/prop-types/lib/has.js"(exports, module) {
		module.exports = Function.call.bind(Object.prototype.hasOwnProperty);
	},
});

// tmp/reactable/node_modules/prop-types/checkPropTypes.js
var require_checkPropTypes = __commonJS({
	"tmp/reactable/node_modules/prop-types/checkPropTypes.js"(exports, module) {
		"use strict";
		var printWarning = function () { };
		if (true) {
			ReactPropTypesSecret = require_ReactPropTypesSecret();
			loggedTypeFailures = {};
			has = require_has();
			printWarning = function (text) {
				var message = "Warning: " + text;
				if (typeof console !== "undefined") {
					console.error(message);
				}
				try {
					throw new Error(message);
				} catch (x) { }
			};
		}
		var ReactPropTypesSecret;
		var loggedTypeFailures;
		var has;
		function checkPropTypes(
			typeSpecs,
			values,
			location,
			componentName,
			getStack
		) {
			if (true) {
				for (var typeSpecName in typeSpecs) {
					if (has(typeSpecs, typeSpecName)) {
						var error2;
						try {
							if (typeof typeSpecs[typeSpecName] !== "function") {
								var err = Error(
									(componentName || "React class") +
									": " +
									location +
									" type `" +
									typeSpecName +
									"` is invalid; it must be a function, usually from the `prop-types` package, but received `" +
									typeof typeSpecs[typeSpecName] +
									"`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`."
								);
								err.name = "Invariant Violation";
								throw err;
							}
							error2 = typeSpecs[typeSpecName](
								values,
								typeSpecName,
								componentName,
								location,
								null,
								ReactPropTypesSecret
							);
						} catch (ex) {
							error2 = ex;
						}
						if (error2 && !(error2 instanceof Error)) {
							printWarning(
								(componentName || "React class") +
								": type specification of " +
								location +
								" `" +
								typeSpecName +
								"` is invalid; the type checker function must return `null` or an `Error` but returned a " +
								typeof error2 +
								". You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument)."
							);
						}
						if (
							error2 instanceof Error &&
							!(error2.message in loggedTypeFailures)
						) {
							loggedTypeFailures[error2.message] = true;
							var stack = getStack ? getStack() : "";
							printWarning(
								"Failed " +
								location +
								" type: " +
								error2.message +
								(stack != null ? stack : "")
							);
						}
					}
				}
			}
		}
		checkPropTypes.resetWarningCache = function () {
			if (true) {
				loggedTypeFailures = {};
			}
		};
		module.exports = checkPropTypes;
	},
});

// tmp/reactable/node_modules/prop-types/factoryWithTypeCheckers.js
var require_factoryWithTypeCheckers = __commonJS({
	"tmp/reactable/node_modules/prop-types/factoryWithTypeCheckers.js"(
		exports,
		module
	) {
		"use strict";
		var ReactIs = require_react_is();
		var assign2 = require_object_assign();
		var ReactPropTypesSecret = require_ReactPropTypesSecret();
		var has = require_has();
		var checkPropTypes = require_checkPropTypes();
		var printWarning = function () { };
		if (true) {
			printWarning = function (text) {
				var message = "Warning: " + text;
				if (typeof console !== "undefined") {
					console.error(message);
				}
				try {
					throw new Error(message);
				} catch (x) { }
			};
		}
		function emptyFunctionThatReturnsNull() {
			return null;
		}
		module.exports = function (isValidElement, throwOnDirectAccess) {
			var ITERATOR_SYMBOL = typeof Symbol === "function" && Symbol.iterator;
			var FAUX_ITERATOR_SYMBOL = "@@iterator";
			function getIteratorFn(maybeIterable) {
				var iteratorFn =
					maybeIterable &&
					((ITERATOR_SYMBOL && maybeIterable[ITERATOR_SYMBOL]) ||
						maybeIterable[FAUX_ITERATOR_SYMBOL]);
				if (typeof iteratorFn === "function") {
					return iteratorFn;
				}
			}
			var ANONYMOUS = "<<anonymous>>";
			var ReactPropTypes = {
				array: createPrimitiveTypeChecker("array"),
				bigint: createPrimitiveTypeChecker("bigint"),
				bool: createPrimitiveTypeChecker("boolean"),
				func: createPrimitiveTypeChecker("function"),
				number: createPrimitiveTypeChecker("number"),
				object: createPrimitiveTypeChecker("object"),
				string: createPrimitiveTypeChecker("string"),
				symbol: createPrimitiveTypeChecker("symbol"),
				any: createAnyTypeChecker(),
				arrayOf: createArrayOfTypeChecker,
				element: createElementTypeChecker(),
				elementType: createElementTypeTypeChecker(),
				instanceOf: createInstanceTypeChecker,
				node: createNodeChecker(),
				objectOf: createObjectOfTypeChecker,
				oneOf: createEnumTypeChecker,
				oneOfType: createUnionTypeChecker,
				shape: createShapeTypeChecker,
				exact: createStrictShapeTypeChecker,
			};
			function is(x, y) {
				if (x === y) {
					return x !== 0 || 1 / x === 1 / y;
				} else {
					return x !== x && y !== y;
				}
			}
			function PropTypeError(message, data) {
				this.message = message;
				this.data = data && typeof data === "object" ? data : {};
				this.stack = "";
			}
			PropTypeError.prototype = Error.prototype;
			function createChainableTypeChecker(validate) {
				if (true) {
					var manualPropTypeCallCache = {};
					var manualPropTypeWarningCount = 0;
				}
				function checkType(
					isRequired,
					props,
					propName,
					componentName,
					location,
					propFullName,
					secret
				) {
					componentName = componentName || ANONYMOUS;
					propFullName = propFullName || propName;
					if (secret !== ReactPropTypesSecret) {
						if (throwOnDirectAccess) {
							var err = new Error(
								"Calling PropTypes validators directly is not supported by the `prop-types` package. Use `PropTypes.checkPropTypes()` to call them. Read more at http://fb.me/use-check-prop-types"
							);
							err.name = "Invariant Violation";
							throw err;
						} else if (typeof console !== "undefined") {
							var cacheKey = componentName + ":" + propName;
							if (
								!manualPropTypeCallCache[cacheKey] && // Avoid spamming the console because they are often not actionable except for lib authors
								manualPropTypeWarningCount < 3
							) {
								printWarning(
									"You are manually calling a React.PropTypes validation function for the `" +
									propFullName +
									"` prop on `" +
									componentName +
									"`. This is deprecated and will throw in the standalone `prop-types` package. You may be seeing this warning due to a third-party PropTypes library. See https://fb.me/react-warning-dont-call-proptypes for details."
								);
								manualPropTypeCallCache[cacheKey] = true;
								manualPropTypeWarningCount++;
							}
						}
					}
					if (props[propName] == null) {
						if (isRequired) {
							if (props[propName] === null) {
								return new PropTypeError(
									"The " +
									location +
									" `" +
									propFullName +
									"` is marked as required " +
									("in `" + componentName + "`, but its value is `null`.")
								);
							}
							return new PropTypeError(
								"The " +
								location +
								" `" +
								propFullName +
								"` is marked as required in " +
								("`" + componentName + "`, but its value is `undefined`.")
							);
						}
						return null;
					} else {
						return validate(
							props,
							propName,
							componentName,
							location,
							propFullName
						);
					}
				}
				var chainedCheckType = checkType.bind(null, false);
				chainedCheckType.isRequired = checkType.bind(null, true);
				return chainedCheckType;
			}
			function createPrimitiveTypeChecker(expectedType) {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName,
					secret
				) {
					var propValue = props[propName];
					var propType = getPropType(propValue);
					if (propType !== expectedType) {
						var preciseType = getPreciseType(propValue);
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type " +
							("`" +
								preciseType +
								"` supplied to `" +
								componentName +
								"`, expected ") +
							("`" + expectedType + "`."),
							{ expectedType }
						);
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function createAnyTypeChecker() {
				return createChainableTypeChecker(emptyFunctionThatReturnsNull);
			}
			function createArrayOfTypeChecker(typeChecker) {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					if (typeof typeChecker !== "function") {
						return new PropTypeError(
							"Property `" +
							propFullName +
							"` of component `" +
							componentName +
							"` has invalid PropType notation inside arrayOf."
						);
					}
					var propValue = props[propName];
					if (!Array.isArray(propValue)) {
						var propType = getPropType(propValue);
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type " +
							("`" +
								propType +
								"` supplied to `" +
								componentName +
								"`, expected an array.")
						);
					}
					for (var i = 0; i < propValue.length; i++) {
						var error2 = typeChecker(
							propValue,
							i,
							componentName,
							location,
							propFullName + "[" + i + "]",
							ReactPropTypesSecret
						);
						if (error2 instanceof Error) {
							return error2;
						}
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function createElementTypeChecker() {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					var propValue = props[propName];
					if (!isValidElement(propValue)) {
						var propType = getPropType(propValue);
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type " +
							("`" +
								propType +
								"` supplied to `" +
								componentName +
								"`, expected a single ReactElement.")
						);
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function createElementTypeTypeChecker() {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					var propValue = props[propName];
					if (!ReactIs.isValidElementType(propValue)) {
						var propType = getPropType(propValue);
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type " +
							("`" +
								propType +
								"` supplied to `" +
								componentName +
								"`, expected a single ReactElement type.")
						);
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function createInstanceTypeChecker(expectedClass) {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					if (!(props[propName] instanceof expectedClass)) {
						var expectedClassName = expectedClass.name || ANONYMOUS;
						var actualClassName = getClassName(props[propName]);
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type " +
							("`" +
								actualClassName +
								"` supplied to `" +
								componentName +
								"`, expected ") +
							("instance of `" + expectedClassName + "`.")
						);
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function createEnumTypeChecker(expectedValues) {
				if (!Array.isArray(expectedValues)) {
					if (true) {
						if (arguments.length > 1) {
							printWarning(
								"Invalid arguments supplied to oneOf, expected an array, got " +
								arguments.length +
								" arguments. A common mistake is to write oneOf(x, y, z) instead of oneOf([x, y, z])."
							);
						} else {
							printWarning(
								"Invalid argument supplied to oneOf, expected an array."
							);
						}
					}
					return emptyFunctionThatReturnsNull;
				}
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					var propValue = props[propName];
					for (var i = 0; i < expectedValues.length; i++) {
						if (is(propValue, expectedValues[i])) {
							return null;
						}
					}
					var valuesString = JSON.stringify(
						expectedValues,
						function replacer(key, value) {
							var type = getPreciseType(value);
							if (type === "symbol") {
								return String(value);
							}
							return value;
						}
					);
					return new PropTypeError(
						"Invalid " +
						location +
						" `" +
						propFullName +
						"` of value `" +
						String(propValue) +
						"` " +
						("supplied to `" +
							componentName +
							"`, expected one of " +
							valuesString +
							".")
					);
				}
				return createChainableTypeChecker(validate);
			}
			function createObjectOfTypeChecker(typeChecker) {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					if (typeof typeChecker !== "function") {
						return new PropTypeError(
							"Property `" +
							propFullName +
							"` of component `" +
							componentName +
							"` has invalid PropType notation inside objectOf."
						);
					}
					var propValue = props[propName];
					var propType = getPropType(propValue);
					if (propType !== "object") {
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type " +
							("`" +
								propType +
								"` supplied to `" +
								componentName +
								"`, expected an object.")
						);
					}
					for (var key in propValue) {
						if (has(propValue, key)) {
							var error2 = typeChecker(
								propValue,
								key,
								componentName,
								location,
								propFullName + "." + key,
								ReactPropTypesSecret
							);
							if (error2 instanceof Error) {
								return error2;
							}
						}
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function createUnionTypeChecker(arrayOfTypeCheckers) {
				if (!Array.isArray(arrayOfTypeCheckers)) {
					true
						? printWarning(
							"Invalid argument supplied to oneOfType, expected an instance of array."
						)
						: void 0;
					return emptyFunctionThatReturnsNull;
				}
				for (var i = 0; i < arrayOfTypeCheckers.length; i++) {
					var checker = arrayOfTypeCheckers[i];
					if (typeof checker !== "function") {
						printWarning(
							"Invalid argument supplied to oneOfType. Expected an array of check functions, but received " +
							getPostfixForTypeWarning(checker) +
							" at index " +
							i +
							"."
						);
						return emptyFunctionThatReturnsNull;
					}
				}
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					var expectedTypes = [];
					for (var i2 = 0; i2 < arrayOfTypeCheckers.length; i2++) {
						var checker2 = arrayOfTypeCheckers[i2];
						var checkerResult = checker2(
							props,
							propName,
							componentName,
							location,
							propFullName,
							ReactPropTypesSecret
						);
						if (checkerResult == null) {
							return null;
						}
						if (checkerResult.data && has(checkerResult.data, "expectedType")) {
							expectedTypes.push(checkerResult.data.expectedType);
						}
					}
					var expectedTypesMessage =
						expectedTypes.length > 0
							? ", expected one of type [" + expectedTypes.join(", ") + "]"
							: "";
					return new PropTypeError(
						"Invalid " +
						location +
						" `" +
						propFullName +
						"` supplied to " +
						("`" + componentName + "`" + expectedTypesMessage + ".")
					);
				}
				return createChainableTypeChecker(validate);
			}
			function createNodeChecker() {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					if (!isNode(props[propName])) {
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` supplied to " +
							("`" + componentName + "`, expected a ReactNode.")
						);
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function invalidValidatorError(
				componentName,
				location,
				propFullName,
				key,
				type
			) {
				return new PropTypeError(
					(componentName || "React class") +
					": " +
					location +
					" type `" +
					propFullName +
					"." +
					key +
					"` is invalid; it must be a function, usually from the `prop-types` package, but received `" +
					type +
					"`."
				);
			}
			function createShapeTypeChecker(shapeTypes) {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					var propValue = props[propName];
					var propType = getPropType(propValue);
					if (propType !== "object") {
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type `" +
							propType +
							"` " +
							("supplied to `" + componentName + "`, expected `object`.")
						);
					}
					for (var key in shapeTypes) {
						var checker = shapeTypes[key];
						if (typeof checker !== "function") {
							return invalidValidatorError(
								componentName,
								location,
								propFullName,
								key,
								getPreciseType(checker)
							);
						}
						var error2 = checker(
							propValue,
							key,
							componentName,
							location,
							propFullName + "." + key,
							ReactPropTypesSecret
						);
						if (error2) {
							return error2;
						}
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function createStrictShapeTypeChecker(shapeTypes) {
				function validate(
					props,
					propName,
					componentName,
					location,
					propFullName
				) {
					var propValue = props[propName];
					var propType = getPropType(propValue);
					if (propType !== "object") {
						return new PropTypeError(
							"Invalid " +
							location +
							" `" +
							propFullName +
							"` of type `" +
							propType +
							"` " +
							("supplied to `" + componentName + "`, expected `object`.")
						);
					}
					var allKeys = assign2({}, props[propName], shapeTypes);
					for (var key in allKeys) {
						var checker = shapeTypes[key];
						if (has(shapeTypes, key) && typeof checker !== "function") {
							return invalidValidatorError(
								componentName,
								location,
								propFullName,
								key,
								getPreciseType(checker)
							);
						}
						if (!checker) {
							return new PropTypeError(
								"Invalid " +
								location +
								" `" +
								propFullName +
								"` key `" +
								key +
								"` supplied to `" +
								componentName +
								"`.\nBad object: " +
								JSON.stringify(props[propName], null, "  ") +
								"\nValid keys: " +
								JSON.stringify(Object.keys(shapeTypes), null, "  ")
							);
						}
						var error2 = checker(
							propValue,
							key,
							componentName,
							location,
							propFullName + "." + key,
							ReactPropTypesSecret
						);
						if (error2) {
							return error2;
						}
					}
					return null;
				}
				return createChainableTypeChecker(validate);
			}
			function isNode(propValue) {
				switch (typeof propValue) {
					case "number":
					case "string":
					case "undefined":
						return true;
					case "boolean":
						return !propValue;
					case "object":
						if (Array.isArray(propValue)) {
							return propValue.every(isNode);
						}
						if (propValue === null || isValidElement(propValue)) {
							return true;
						}
						var iteratorFn = getIteratorFn(propValue);
						if (iteratorFn) {
							var iterator = iteratorFn.call(propValue);
							var step;
							if (iteratorFn !== propValue.entries) {
								while (!(step = iterator.next()).done) {
									if (!isNode(step.value)) {
										return false;
									}
								}
							} else {
								while (!(step = iterator.next()).done) {
									var entry = step.value;
									if (entry) {
										if (!isNode(entry[1])) {
											return false;
										}
									}
								}
							}
						} else {
							return false;
						}
						return true;
					default:
						return false;
				}
			}
			function isSymbol(propType, propValue) {
				if (propType === "symbol") {
					return true;
				}
				if (!propValue) {
					return false;
				}
				if (propValue["@@toStringTag"] === "Symbol") {
					return true;
				}
				if (typeof Symbol === "function" && propValue instanceof Symbol) {
					return true;
				}
				return false;
			}
			function getPropType(propValue) {
				var propType = typeof propValue;
				if (Array.isArray(propValue)) {
					return "array";
				}
				if (propValue instanceof RegExp) {
					return "object";
				}
				if (isSymbol(propType, propValue)) {
					return "symbol";
				}
				return propType;
			}
			function getPreciseType(propValue) {
				if (typeof propValue === "undefined" || propValue === null) {
					return "" + propValue;
				}
				var propType = getPropType(propValue);
				if (propType === "object") {
					if (propValue instanceof Date) {
						return "date";
					} else if (propValue instanceof RegExp) {
						return "regexp";
					}
				}
				return propType;
			}
			function getPostfixForTypeWarning(value) {
				var type = getPreciseType(value);
				switch (type) {
					case "array":
					case "object":
						return "an " + type;
					case "boolean":
					case "date":
					case "regexp":
						return "a " + type;
					default:
						return type;
				}
			}
			function getClassName(propValue) {
				if (!propValue.constructor || !propValue.constructor.name) {
					return ANONYMOUS;
				}
				return propValue.constructor.name;
			}
			ReactPropTypes.checkPropTypes = checkPropTypes;
			ReactPropTypes.resetWarningCache = checkPropTypes.resetWarningCache;
			ReactPropTypes.PropTypes = ReactPropTypes;
			return ReactPropTypes;
		};
	},
});

// tmp/reactable/node_modules/prop-types/index.js
var require_prop_types = __commonJS({
	"tmp/reactable/node_modules/prop-types/index.js"(exports, module) {
		if (true) {
			ReactIs = require_react_is();
			throwOnDirectAccess = true;
			module.exports = require_factoryWithTypeCheckers()(
				ReactIs.isElement,
				throwOnDirectAccess
			);
		} else {
			module.exports = null();
		}
		var ReactIs;
		var throwOnDirectAccess;
	},
});

// tmp/reactable/srcjs/Reactable.js
var import_react_table8 = __toESM(require_react_table());
var import_prop_types3 = __toESM(require_prop_types());
import React11, { Fragment as Fragment2 } from "react";

// tmp/reactable/srcjs/reactR.js
import React from "react";
import ReactDOM from "react-dom";
function hydrate(components, tag) {
	if (React.isValidElement(tag)) {
		return tag;
	}
	if (typeof tag === "string") return tag;
	if (tag.name[0] === tag.name[0].toUpperCase() && !components[tag.name]) {
		throw new Error("Unknown component: " + tag.name);
	}
	const elem = components[tag.name] || tag.name;
	const args = [elem, tag.attribs];
	for (let child of tag.children) {
		args.push(hydrate(components, child));
	}
	return React.createElement(...args);
}

// tmp/reactable/srcjs/Pagination.js
var import_prop_types = __toESM(require_prop_types());
import React3 from "react";

// tmp/reactable/node_modules/@emotion/sheet/dist/emotion-sheet.browser.esm.js
function sheetForTag(tag) {
	if (tag.sheet) {
		return tag.sheet;
	}
	for (var i = 0; i < document.styleSheets.length; i++) {
		if (document.styleSheets[i].ownerNode === tag) {
			return document.styleSheets[i];
		}
	}
}
function createStyleElement(options) {
	var tag = document.createElement("style");
	tag.setAttribute("data-emotion", options.key);
	if (options.nonce !== void 0) {
		tag.setAttribute("nonce", options.nonce);
	}
	tag.appendChild(document.createTextNode(""));
	tag.setAttribute("data-s", "");
	return tag;
}
var StyleSheet = /* @__PURE__ */ (function () {
	function StyleSheet2(options) {
		var _this = this;
		this._insertTag = function (tag) {
			var before;
			if (_this.tags.length === 0) {
				if (_this.insertionPoint) {
					before = _this.insertionPoint.nextSibling;
				} else if (_this.prepend) {
					before = _this.container.firstChild;
				} else {
					before = _this.before;
				}
			} else {
				before = _this.tags[_this.tags.length - 1].nextSibling;
			}
			_this.container.insertBefore(tag, before);
			_this.tags.push(tag);
		};
		this.isSpeedy = options.speedy === void 0 ? false : options.speedy;
		this.tags = [];
		this.ctr = 0;
		this.nonce = options.nonce;
		this.key = options.key;
		this.container = options.container;
		this.prepend = options.prepend;
		this.insertionPoint = options.insertionPoint;
		this.before = null;
	}
	var _proto = StyleSheet2.prototype;
	_proto.hydrate = function hydrate3(nodes) {
		nodes.forEach(this._insertTag);
	};
	_proto.insert = function insert(rule) {
		if (this.ctr % (this.isSpeedy ? 65e3 : 1) === 0) {
			this._insertTag(createStyleElement(this));
		}
		var tag = this.tags[this.tags.length - 1];
		if (true) {
			var isImportRule3 =
				rule.charCodeAt(0) === 64 && rule.charCodeAt(1) === 105;
			if (isImportRule3 && this._alreadyInsertedOrderInsensitiveRule) {
				console.error(
					"You're attempting to insert the following rule:\n" +
					rule +
					"\n\n`@import` rules must be before all other types of rules in a stylesheet but other rules have already been inserted. Please ensure that `@import` rules are before all other rules."
				);
			}
			this._alreadyInsertedOrderInsensitiveRule =
				this._alreadyInsertedOrderInsensitiveRule || !isImportRule3;
		}
		if (this.isSpeedy) {
			var sheet = sheetForTag(tag);
			try {
				sheet.insertRule(rule, sheet.cssRules.length);
			} catch (e) {
				if (
					!/:(-moz-placeholder|-moz-focus-inner|-moz-focusring|-ms-input-placeholder|-moz-read-write|-moz-read-only|-ms-clear){/.test(
						rule
					)
				) {
					console.error(
						'There was a problem inserting the following rule: "' + rule + '"',
						e
					);
				}
			}
		} else {
			tag.appendChild(document.createTextNode(rule));
		}
		this.ctr++;
	};
	_proto.flush = function flush() {
		this.tags.forEach(function (tag) {
			return tag.parentNode && tag.parentNode.removeChild(tag);
		});
		this.tags = [];
		this.ctr = 0;
		if (true) {
			this._alreadyInsertedOrderInsensitiveRule = false;
		}
	};
	return StyleSheet2;
})();

// tmp/reactable/node_modules/stylis/src/Enum.js
var MS = "-ms-";
var MOZ = "-moz-";
var WEBKIT = "-webkit-";
var COMMENT = "comm";
var RULESET = "rule";
var DECLARATION = "decl";
var IMPORT = "@import";
var KEYFRAMES = "@keyframes";

// tmp/reactable/node_modules/stylis/src/Utility.js
var abs = Math.abs;
var from = String.fromCharCode;
var assign = Object.assign;
function hash(value, length2) {
	return (
		(((((((length2 << 2) ^ charat(value, 0)) << 2) ^ charat(value, 1)) << 2) ^
			charat(value, 2)) <<
			2) ^
		charat(value, 3)
	);
}
function trim(value) {
	return value.trim();
}
function match(value, pattern) {
	return (value = pattern.exec(value)) ? value[0] : value;
}
function replace(value, pattern, replacement) {
	return value.replace(pattern, replacement);
}
function indexof(value, search) {
	return value.indexOf(search);
}
function charat(value, index) {
	return value.charCodeAt(index) | 0;
}
function substr(value, begin, end) {
	return value.slice(begin, end);
}
function strlen(value) {
	return value.length;
}
function sizeof(value) {
	return value.length;
}
function append(value, array) {
	return array.push(value), value;
}
function combine(array, callback) {
	return array.map(callback).join("");
}

// tmp/reactable/node_modules/stylis/src/Tokenizer.js
var line = 1;
var column = 1;
var length = 0;
var position = 0;
var character = 0;
var characters = "";
function node(value, root, parent, type, props, children, length2) {
	return {
		value,
		root,
		parent,
		type,
		props,
		children,
		line,
		column,
		length: length2,
		return: "",
	};
}
function copy(root, props) {
	return assign(
		node("", null, null, "", null, null, 0),
		root,
		{ length: -root.length },
		props
	);
}
function char() {
	return character;
}
function prev() {
	character = position > 0 ? charat(characters, --position) : 0;
	if ((column--, character === 10)) (column = 1), line--;
	return character;
}
function next() {
	character = position < length ? charat(characters, position++) : 0;
	if ((column++, character === 10)) (column = 1), line++;
	return character;
}
function peek() {
	return charat(characters, position);
}
function caret() {
	return position;
}
function slice(begin, end) {
	return substr(characters, begin, end);
}
function token(type) {
	switch (type) {
		// \0 \t \n \r \s whitespace token
		case 0:
		case 9:
		case 10:
		case 13:
		case 32:
			return 5;
		// ! + , / > @ ~ isolate token
		case 33:
		case 43:
		case 44:
		case 47:
		case 62:
		case 64:
		case 126:
		// ; { } breakpoint token
		case 59:
		case 123:
		case 125:
			return 4;
		// : accompanied token
		case 58:
			return 3;
		// " ' ( [ opening delimit token
		case 34:
		case 39:
		case 40:
		case 91:
			return 2;
		// ) ] closing delimit token
		case 41:
		case 93:
			return 1;
	}
	return 0;
}
function alloc(value) {
	return (
		(line = column = 1),
		(length = strlen((characters = value))),
		(position = 0),
		[]
	);
}
function dealloc(value) {
	return (characters = ""), value;
}
function delimit(type) {
	return trim(
		slice(
			position - 1,
			delimiter(type === 91 ? type + 2 : type === 40 ? type + 1 : type)
		)
	);
}
function whitespace(type) {
	while ((character = peek()))
		if (character < 33) next();
		else break;
	return token(type) > 2 || token(character) > 3 ? "" : " ";
}
function escaping(index, count2) {
	while (--count2 && next())
		if (
			character < 48 ||
			character > 102 ||
			(character > 57 && character < 65) ||
			(character > 70 && character < 97)
		)
			break;
	return slice(index, caret() + (count2 < 6 && peek() == 32 && next() == 32));
}
function delimiter(type) {
	while (next())
		switch (character) {
			// ] ) " '
			case type:
				return position;
			// " '
			case 34:
			case 39:
				if (type !== 34 && type !== 39) delimiter(character);
				break;
			// (
			case 40:
				if (type === 41) delimiter(type);
				break;
			// \
			case 92:
				next();
				break;
		}
	return position;
}
function commenter(type, index) {
	while (next())
		if (type + character === 47 + 10) break;
		else if (type + character === 42 + 42 && peek() === 47) break;
	return (
		"/*" + slice(index, position - 1) + "*" + from(type === 47 ? type : next())
	);
}
function identifier(index) {
	while (!token(peek())) next();
	return slice(index, position);
}

// tmp/reactable/node_modules/stylis/src/Parser.js
function compile(value) {
	return dealloc(
		parse("", null, null, null, [""], (value = alloc(value)), 0, [0], value)
	);
}
function parse(
	value,
	root,
	parent,
	rule,
	rules,
	rulesets,
	pseudo,
	points,
	declarations
) {
	var index = 0;
	var offset = 0;
	var length2 = pseudo;
	var atrule = 0;
	var property = 0;
	var previous = 0;
	var variable = 1;
	var scanning = 1;
	var ampersand = 1;
	var character2 = 0;
	var type = "";
	var props = rules;
	var children = rulesets;
	var reference = rule;
	var characters2 = type;
	while (scanning)
		switch (((previous = character2), (character2 = next()))) {
			// (
			case 40:
				if (previous != 108 && characters2.charCodeAt(length2 - 1) == 58) {
					if (
						indexof(
							(characters2 += replace(delimit(character2), "&", "&\f")),
							"&\f"
						) != -1
					)
						ampersand = -1;
					break;
				}
			// " ' [
			case 34:
			case 39:
			case 91:
				characters2 += delimit(character2);
				break;
			// \t \n \r \s
			case 9:
			case 10:
			case 13:
			case 32:
				characters2 += whitespace(previous);
				break;
			// \
			case 92:
				characters2 += escaping(caret() - 1, 7);
				continue;
			// /
			case 47:
				switch (peek()) {
					case 42:
					case 47:
						append(
							comment(commenter(next(), caret()), root, parent),
							declarations
						);
						break;
					default:
						characters2 += "/";
				}
				break;
			// {
			case 123 * variable:
				points[index++] = strlen(characters2) * ampersand;
			// } ; \0
			case 125 * variable:
			case 59:
			case 0:
				switch (character2) {
					// \0 }
					case 0:
					case 125:
						scanning = 0;
					// ;
					case 59 + offset:
						if (property > 0 && strlen(characters2) - length2)
							append(
								property > 32
									? declaration(characters2 + ";", rule, parent, length2 - 1)
									: declaration(
										replace(characters2, " ", "") + ";",
										rule,
										parent,
										length2 - 2
									),
								declarations
							);
						break;
					// @ ;
					case 59:
						characters2 += ";";
					// { rule/at-rule
					default:
						append(
							(reference = ruleset(
								characters2,
								root,
								parent,
								index,
								offset,
								rules,
								points,
								type,
								(props = []),
								(children = []),
								length2
							)),
							rulesets
						);
						if (character2 === 123)
							if (offset === 0)
								parse(
									characters2,
									root,
									reference,
									reference,
									props,
									rulesets,
									length2,
									points,
									children
								);
							else
								switch (atrule) {
									// d m s
									case 100:
									case 109:
									case 115:
										parse(
											value,
											reference,
											reference,
											rule &&
											append(
												ruleset(
													value,
													reference,
													reference,
													0,
													0,
													rules,
													points,
													type,
													rules,
													(props = []),
													length2
												),
												children
											),
											rules,
											children,
											length2,
											points,
											rule ? props : children
										);
										break;
									default:
										parse(
											characters2,
											reference,
											reference,
											reference,
											[""],
											children,
											0,
											points,
											children
										);
								}
				}
				(index = offset = property = 0),
					(variable = ampersand = 1),
					(type = characters2 = ""),
					(length2 = pseudo);
				break;
			// :
			case 58:
				(length2 = 1 + strlen(characters2)), (property = previous);
			default:
				if (variable < 1) {
					if (character2 == 123) --variable;
					else if (character2 == 125 && variable++ == 0 && prev() == 125)
						continue;
				}
				switch (((characters2 += from(character2)), character2 * variable)) {
					// &
					case 38:
						ampersand = offset > 0 ? 1 : ((characters2 += "\f"), -1);
						break;
					// ,
					case 44:
						(points[index++] = (strlen(characters2) - 1) * ampersand),
							(ampersand = 1);
						break;
					// @
					case 64:
						if (peek() === 45) characters2 += delimit(next());
						(atrule = peek()),
							(offset = length2 =
								strlen((type = characters2 += identifier(caret())))),
							character2++;
						break;
					// -
					case 45:
						if (previous === 45 && strlen(characters2) == 2) variable = 0;
				}
		}
	return rulesets;
}
function ruleset(
	value,
	root,
	parent,
	index,
	offset,
	rules,
	points,
	type,
	props,
	children,
	length2
) {
	var post = offset - 1;
	var rule = offset === 0 ? rules : [""];
	var size = sizeof(rule);
	for (var i = 0, j = 0, k = 0; i < index; ++i)
		for (
			var x = 0,
			y = substr(value, post + 1, (post = abs((j = points[i])))),
			z = value;
			x < size;
			++x
		)
			if ((z = trim(j > 0 ? rule[x] + " " + y : replace(y, /&\f/g, rule[x]))))
				props[k++] = z;
	return node(
		value,
		root,
		parent,
		offset === 0 ? RULESET : type,
		props,
		children,
		length2
	);
}
function comment(value, root, parent) {
	return node(
		value,
		root,
		parent,
		COMMENT,
		from(char()),
		substr(value, 2, -2),
		0
	);
}
function declaration(value, root, parent, length2) {
	return node(
		value,
		root,
		parent,
		DECLARATION,
		substr(value, 0, length2),
		substr(value, length2 + 1, -1),
		length2
	);
}

// tmp/reactable/node_modules/stylis/src/Prefixer.js
function prefix(value, length2) {
	switch (hash(value, length2)) {
		// color-adjust
		case 5103:
			return WEBKIT + "print-" + value + value;
		// animation, animation-(delay|direction|duration|fill-mode|iteration-count|name|play-state|timing-function)
		case 5737:
		case 4201:
		case 3177:
		case 3433:
		case 1641:
		case 4457:
		case 2921:
		// text-decoration, filter, clip-path, backface-visibility, column, box-decoration-break
		case 5572:
		case 6356:
		case 5844:
		case 3191:
		case 6645:
		case 3005:
		// mask, mask-image, mask-(mode|clip|size), mask-(repeat|origin), mask-position, mask-composite,
		case 6391:
		case 5879:
		case 5623:
		case 6135:
		case 4599:
		case 4855:
		// background-clip, columns, column-(count|fill|gap|rule|rule-color|rule-style|rule-width|span|width)
		case 4215:
		case 6389:
		case 5109:
		case 5365:
		case 5621:
		case 3829:
			return WEBKIT + value + value;
		// appearance, user-select, transform, hyphens, text-size-adjust
		case 5349:
		case 4246:
		case 4810:
		case 6968:
		case 2756:
			return WEBKIT + value + MOZ + value + MS + value + value;
		// flex, flex-direction
		case 6828:
		case 4268:
			return WEBKIT + value + MS + value + value;
		// order
		case 6165:
			return WEBKIT + value + MS + "flex-" + value + value;
		// align-items
		case 5187:
			return (
				WEBKIT +
				value +
				replace(
					value,
					/(\w+).+(:[^]+)/,
					WEBKIT + "box-$1$2" + MS + "flex-$1$2"
				) +
				value
			);
		// align-self
		case 5443:
			return (
				WEBKIT +
				value +
				MS +
				"flex-item-" +
				replace(value, /flex-|-self/, "") +
				value
			);
		// align-content
		case 4675:
			return (
				WEBKIT +
				value +
				MS +
				"flex-line-pack" +
				replace(value, /align-content|flex-|-self/, "") +
				value
			);
		// flex-shrink
		case 5548:
			return WEBKIT + value + MS + replace(value, "shrink", "negative") + value;
		// flex-basis
		case 5292:
			return (
				WEBKIT + value + MS + replace(value, "basis", "preferred-size") + value
			);
		// flex-grow
		case 6060:
			return (
				WEBKIT +
				"box-" +
				replace(value, "-grow", "") +
				WEBKIT +
				value +
				MS +
				replace(value, "grow", "positive") +
				value
			);
		// transition
		case 4554:
			return (
				WEBKIT +
				replace(value, /([^-])(transform)/g, "$1" + WEBKIT + "$2") +
				value
			);
		// cursor
		case 6187:
			return (
				replace(
					replace(
						replace(value, /(zoom-|grab)/, WEBKIT + "$1"),
						/(image-set)/,
						WEBKIT + "$1"
					),
					value,
					""
				) + value
			);
		// background, background-image
		case 5495:
		case 3959:
			return replace(value, /(image-set\([^]*)/, WEBKIT + "$1$`$1");
		// justify-content
		case 4968:
			return (
				replace(
					replace(
						value,
						/(.+:)(flex-)?(.*)/,
						WEBKIT + "box-pack:$3" + MS + "flex-pack:$3"
					),
					/s.+-b[^;]+/,
					"justify"
				) +
				WEBKIT +
				value +
				value
			);
		// (margin|padding)-inline-(start|end)
		case 4095:
		case 3583:
		case 4068:
		case 2532:
			return replace(value, /(.+)-inline(.+)/, WEBKIT + "$1$2") + value;
		// (min|max)?(width|height|inline-size|block-size)
		case 8116:
		case 7059:
		case 5753:
		case 5535:
		case 5445:
		case 5701:
		case 4933:
		case 4677:
		case 5533:
		case 5789:
		case 5021:
		case 4765:
			if (strlen(value) - 1 - length2 > 6)
				switch (charat(value, length2 + 1)) {
					// (m)ax-content, (m)in-content
					case 109:
						if (charat(value, length2 + 4) !== 45) break;
					// (f)ill-available, (f)it-content
					case 102:
						return (
							replace(
								value,
								/(.+:)(.+)-([^]+)/,
								"$1" +
								WEBKIT +
								"$2-$3$1" +
								MOZ +
								(charat(value, length2 + 3) == 108 ? "$3" : "$2-$3")
							) + value
						);
					// (s)tretch
					case 115:
						return ~indexof(value, "stretch")
							? prefix(replace(value, "stretch", "fill-available"), length2) +
							value
							: value;
				}
			break;
		// position: sticky
		case 4949:
			if (charat(value, length2 + 1) !== 115) break;
		// display: (flex|inline-flex)
		case 6444:
			switch (
			charat(value, strlen(value) - 3 - (~indexof(value, "!important") && 10))
			) {
				// stic(k)y
				case 107:
					return replace(value, ":", ":" + WEBKIT) + value;
				// (inline-)?fl(e)x
				case 101:
					return (
						replace(
							value,
							/(.+:)([^;!]+)(;|!.+)?/,
							"$1" +
							WEBKIT +
							(charat(value, 14) === 45 ? "inline-" : "") +
							"box$3$1" +
							WEBKIT +
							"$2$3$1" +
							MS +
							"$2box$3"
						) + value
					);
			}
			break;
		// writing-mode
		case 5936:
			switch (charat(value, length2 + 11)) {
				// vertical-l(r)
				case 114:
					return (
						WEBKIT +
						value +
						MS +
						replace(value, /[svh]\w+-[tblr]{2}/, "tb") +
						value
					);
				// vertical-r(l)
				case 108:
					return (
						WEBKIT +
						value +
						MS +
						replace(value, /[svh]\w+-[tblr]{2}/, "tb-rl") +
						value
					);
				// horizontal(-)tb
				case 45:
					return (
						WEBKIT +
						value +
						MS +
						replace(value, /[svh]\w+-[tblr]{2}/, "lr") +
						value
					);
			}
			return WEBKIT + value + MS + value + value;
	}
	return value;
}

// tmp/reactable/node_modules/stylis/src/Serializer.js
function serialize(children, callback) {
	var output = "";
	var length2 = sizeof(children);
	for (var i = 0; i < length2; i++)
		output += callback(children[i], i, children, callback) || "";
	return output;
}
function stringify(element, index, children, callback) {
	switch (element.type) {
		case IMPORT:
		case DECLARATION:
			return (element.return = element.return || element.value);
		case COMMENT:
			return "";
		case KEYFRAMES:
			return (element.return =
				element.value + "{" + serialize(element.children, callback) + "}");
		case RULESET:
			element.value = element.props.join(",");
	}
	return strlen((children = serialize(element.children, callback)))
		? (element.return = element.value + "{" + children + "}")
		: "";
}

// tmp/reactable/node_modules/stylis/src/Middleware.js
function middleware(collection) {
	var length2 = sizeof(collection);
	return function (element, index, children, callback) {
		var output = "";
		for (var i = 0; i < length2; i++)
			output += collection[i](element, index, children, callback) || "";
		return output;
	};
}
function prefixer(element, index, children, callback) {
	if (element.length > -1) {
		if (!element.return)
			switch (element.type) {
				case DECLARATION:
					element.return = prefix(element.value, element.length);
					break;
				case KEYFRAMES:
					return serialize(
						[
							copy(element, {
								value: replace(element.value, "@", "@" + WEBKIT),
							}),
						],
						callback
					);
				case RULESET:
					if (element.length)
						return combine(element.props, function (value) {
							switch (match(value, /(::plac\w+|:read-\w+)/)) {
								// :read-(only|write)
								case ":read-only":
								case ":read-write":
									return serialize(
										[
											copy(element, {
												props: [
													replace(value, /:(read-\w+)/, ":" + MOZ + "$1"),
												],
											}),
										],
										callback
									);
								// :placeholder
								case "::placeholder":
									return serialize(
										[
											copy(element, {
												props: [
													replace(
														value,
														/:(plac\w+)/,
														":" + WEBKIT + "input-$1"
													),
												],
											}),
											copy(element, {
												props: [replace(value, /:(plac\w+)/, ":" + MOZ + "$1")],
											}),
											copy(element, {
												props: [replace(value, /:(plac\w+)/, MS + "input-$1")],
											}),
										],
										callback
									);
							}
							return "";
						});
			}
	}
}

// tmp/reactable/node_modules/@emotion/cache/dist/emotion-cache.browser.esm.js
var last = function last2(arr) {
	return arr.length ? arr[arr.length - 1] : null;
};
var identifierWithPointTracking = function identifierWithPointTracking2(
	begin,
	points,
	index
) {
	var previous = 0;
	var character2 = 0;
	while (true) {
		previous = character2;
		character2 = peek();
		if (previous === 38 && character2 === 12) {
			points[index] = 1;
		}
		if (token(character2)) {
			break;
		}
		next();
	}
	return slice(begin, position);
};
var toRules = function toRules2(parsed, points) {
	var index = -1;
	var character2 = 44;
	do {
		switch (token(character2)) {
			case 0:
				if (character2 === 38 && peek() === 12) {
					points[index] = 1;
				}
				parsed[index] += identifierWithPointTracking(
					position - 1,
					points,
					index
				);
				break;
			case 2:
				parsed[index] += delimit(character2);
				break;
			case 4:
				if (character2 === 44) {
					parsed[++index] = peek() === 58 ? "&\f" : "";
					points[index] = parsed[index].length;
					break;
				}
			// fallthrough
			default:
				parsed[index] += from(character2);
		}
	} while ((character2 = next()));
	return parsed;
};
var getRules = function getRules2(value, points) {
	return dealloc(toRules(alloc(value), points));
};
var fixedElements = /* @__PURE__ */ new WeakMap();
var compat = function compat2(element) {
	if (
		element.type !== "rule" ||
		!element.parent || // positive .length indicates that this rule contains pseudo
		// negative .length indicates that this rule has been already prefixed
		element.length < 1
	) {
		return;
	}
	var value = element.value,
		parent = element.parent;
	var isImplicitRule =
		element.column === parent.column && element.line === parent.line;
	while (parent.type !== "rule") {
		parent = parent.parent;
		if (!parent) return;
	}
	if (
		element.props.length === 1 &&
		value.charCodeAt(0) !== 58 &&
		!fixedElements.get(parent)
	) {
		return;
	}
	if (isImplicitRule) {
		return;
	}
	fixedElements.set(element, true);
	var points = [];
	var rules = getRules(value, points);
	var parentRules = parent.props;
	for (var i = 0, k = 0; i < rules.length; i++) {
		for (var j = 0; j < parentRules.length; j++, k++) {
			element.props[k] = points[i]
				? rules[i].replace(/&\f/g, parentRules[j])
				: parentRules[j] + " " + rules[i];
		}
	}
};
var removeLabel = function removeLabel2(element) {
	if (element.type === "decl") {
		var value = element.value;
		if (
			// charcode for l
			value.charCodeAt(0) === 108 && // charcode for b
			value.charCodeAt(2) === 98
		) {
			element["return"] = "";
			element.value = "";
		}
	}
};
var ignoreFlag =
	"emotion-disable-server-rendering-unsafe-selector-warning-please-do-not-use-this-the-warning-exists-for-a-reason";
var isIgnoringComment = function isIgnoringComment2(element) {
	return (
		!!element &&
		element.type === "comm" &&
		element.children.indexOf(ignoreFlag) > -1
	);
};
var createUnsafeSelectorsAlarm = function createUnsafeSelectorsAlarm2(cache) {
	return function (element, index, children) {
		if (element.type !== "rule") return;
		var unsafePseudoClasses = element.value.match(
			/(:first|:nth|:nth-last)-child/g
		);
		if (unsafePseudoClasses && cache.compat !== true) {
			var prevElement = index > 0 ? children[index - 1] : null;
			if (prevElement && isIgnoringComment(last(prevElement.children))) {
				return;
			}
			unsafePseudoClasses.forEach(function (unsafePseudoClass) {
				console.error(
					'The pseudo class "' +
					unsafePseudoClass +
					'" is potentially unsafe when doing server-side rendering. Try changing it to "' +
					unsafePseudoClass.split("-child")[0] +
					'-of-type".'
				);
			});
		}
	};
};
var isImportRule = function isImportRule2(element) {
	return (
		element.type.charCodeAt(1) === 105 && element.type.charCodeAt(0) === 64
	);
};
var isPrependedWithRegularRules = function isPrependedWithRegularRules2(
	index,
	children
) {
	for (var i = index - 1; i >= 0; i--) {
		if (!isImportRule(children[i])) {
			return true;
		}
	}
	return false;
};
var nullifyElement = function nullifyElement2(element) {
	element.type = "";
	element.value = "";
	element["return"] = "";
	element.children = "";
	element.props = "";
};
var incorrectImportAlarm = function incorrectImportAlarm2(
	element,
	index,
	children
) {
	if (!isImportRule(element)) {
		return;
	}
	if (element.parent) {
		console.error(
			"`@import` rules can't be nested inside other rules. Please move it to the top level and put it before regular rules. Keep in mind that they can only be used within global styles."
		);
		nullifyElement(element);
	} else if (isPrependedWithRegularRules(index, children)) {
		console.error(
			"`@import` rules can't be after other rules. Please put your `@import` rules before your other rules."
		);
		nullifyElement(element);
	}
};
var defaultStylisPlugins = [prefixer];
var createCache = function createCache2(options) {
	var key = options.key;
	if (!key) {
		throw new Error(
			"You have to configure `key` for your cache. Please make sure it's unique (and not equal to 'css') as it's used for linking styles to your cache.\nIf multiple caches share the same key they might \"fight\" for each other's style elements."
		);
	}
	if (key === "css") {
		var ssrStyles = document.querySelectorAll(
			"style[data-emotion]:not([data-s])"
		);
		Array.prototype.forEach.call(ssrStyles, function (node2) {
			var dataEmotionAttribute = node2.getAttribute("data-emotion");
			if (dataEmotionAttribute.indexOf(" ") === -1) {
				return;
			}
			document.head.appendChild(node2);
			node2.setAttribute("data-s", "");
		});
	}
	var stylisPlugins = options.stylisPlugins || defaultStylisPlugins;
	if (true) {
		if (/[^a-z-]/.test(key)) {
			throw new Error(
				'Emotion key must only contain lower case alphabetical characters and - but "' +
				key +
				'" was passed'
			);
		}
	}
	var inserted = {};
	var container;
	var nodesToHydrate = [];
	{
		container = options.container || document.head;
		Array.prototype.forEach.call(
			// this means we will ignore elements which don't have a space in them which
			// means that the style elements we're looking at are only Emotion 11 server-rendered style elements
			document.querySelectorAll('style[data-emotion^="' + key + ' "]'),
			function (node2) {
				var attrib = node2.getAttribute("data-emotion").split(" ");
				for (var i = 1; i < attrib.length; i++) {
					inserted[attrib[i]] = true;
				}
				nodesToHydrate.push(node2);
			}
		);
	}
	var _insert;
	var omnipresentPlugins = [compat, removeLabel];
	if (true) {
		omnipresentPlugins.push(
			createUnsafeSelectorsAlarm({
				get compat() {
					return cache.compat;
				},
			}),
			incorrectImportAlarm
		);
	}
	{
		var currentSheet;
		var finalizingPlugins = [
			stringify,
			true
				? function (element) {
					if (!element.root) {
						if (element["return"]) {
							currentSheet.insert(element["return"]);
						} else if (element.value && element.type !== COMMENT) {
							currentSheet.insert(element.value + "{}");
						}
					}
				}
				: rulesheet(function (rule) {
					currentSheet.insert(rule);
				}),
		];
		var serializer = middleware(
			omnipresentPlugins.concat(stylisPlugins, finalizingPlugins)
		);
		var stylis = function stylis2(styles) {
			return serialize(compile(styles), serializer);
		};
		_insert = function insert(selector, serialized, sheet, shouldCache) {
			currentSheet = sheet;
			if (serialized.map !== void 0) {
				currentSheet = {
					insert: function insert2(rule) {
						sheet.insert(rule + serialized.map);
					},
				};
			}
			stylis(
				selector ? selector + "{" + serialized.styles + "}" : serialized.styles
			);
			if (shouldCache) {
				cache.inserted[serialized.name] = true;
			}
		};
	}
	var cache = {
		key,
		sheet: new StyleSheet({
			key,
			container,
			nonce: options.nonce,
			speedy: options.speedy,
			prepend: options.prepend,
			insertionPoint: options.insertionPoint,
		}),
		nonce: options.nonce,
		inserted,
		registered: {},
		insert: _insert,
	};
	cache.sheet.hydrate(nodesToHydrate);
	return cache;
};
var emotion_cache_browser_esm_default = createCache;

// tmp/reactable/node_modules/@emotion/hash/dist/emotion-hash.esm.js
function murmur2(str) {
	var h = 0;
	var k,
		i = 0,
		len = str.length;
	for (; len >= 4; ++i, len -= 4) {
		k =
			(str.charCodeAt(i) & 255) |
			((str.charCodeAt(++i) & 255) << 8) |
			((str.charCodeAt(++i) & 255) << 16) |
			((str.charCodeAt(++i) & 255) << 24);
		k =
			/* Math.imul(k, m): */
			(k & 65535) * 1540483477 + (((k >>> 16) * 59797) << 16);
		k ^= /* k >>> r: */ k >>> 24;
		h =
			/* Math.imul(k, m): */
			((k & 65535) * 1540483477 +
				(((k >>> 16) * 59797) << 16)) /* Math.imul(h, m): */ ^
			((h & 65535) * 1540483477 + (((h >>> 16) * 59797) << 16));
	}
	switch (len) {
		case 3:
			h ^= (str.charCodeAt(i + 2) & 255) << 16;
		case 2:
			h ^= (str.charCodeAt(i + 1) & 255) << 8;
		case 1:
			h ^= str.charCodeAt(i) & 255;
			h =
				/* Math.imul(h, m): */
				(h & 65535) * 1540483477 + (((h >>> 16) * 59797) << 16);
	}
	h ^= h >>> 13;
	h =
		/* Math.imul(h, m): */
		(h & 65535) * 1540483477 + (((h >>> 16) * 59797) << 16);
	return ((h ^ (h >>> 15)) >>> 0).toString(36);
}
var emotion_hash_esm_default = murmur2;

// tmp/reactable/node_modules/@emotion/unitless/dist/emotion-unitless.esm.js
var unitlessKeys = {
	animationIterationCount: 1,
	borderImageOutset: 1,
	borderImageSlice: 1,
	borderImageWidth: 1,
	boxFlex: 1,
	boxFlexGroup: 1,
	boxOrdinalGroup: 1,
	columnCount: 1,
	columns: 1,
	flex: 1,
	flexGrow: 1,
	flexPositive: 1,
	flexShrink: 1,
	flexNegative: 1,
	flexOrder: 1,
	gridRow: 1,
	gridRowEnd: 1,
	gridRowSpan: 1,
	gridRowStart: 1,
	gridColumn: 1,
	gridColumnEnd: 1,
	gridColumnSpan: 1,
	gridColumnStart: 1,
	msGridRow: 1,
	msGridRowSpan: 1,
	msGridColumn: 1,
	msGridColumnSpan: 1,
	fontWeight: 1,
	lineHeight: 1,
	opacity: 1,
	order: 1,
	orphans: 1,
	tabSize: 1,
	widows: 1,
	zIndex: 1,
	zoom: 1,
	WebkitLineClamp: 1,
	// SVG-related properties
	fillOpacity: 1,
	floodOpacity: 1,
	stopOpacity: 1,
	strokeDasharray: 1,
	strokeDashoffset: 1,
	strokeMiterlimit: 1,
	strokeOpacity: 1,
	strokeWidth: 1,
};
var emotion_unitless_esm_default = unitlessKeys;

// tmp/reactable/node_modules/@emotion/serialize/node_modules/@emotion/memoize/dist/emotion-memoize.esm.js
function memoize(fn) {
	var cache = /* @__PURE__ */ Object.create(null);
	return function (arg) {
		if (cache[arg] === void 0) cache[arg] = fn(arg);
		return cache[arg];
	};
}
var emotion_memoize_esm_default = memoize;

// tmp/reactable/node_modules/@emotion/serialize/dist/emotion-serialize.browser.esm.js
var ILLEGAL_ESCAPE_SEQUENCE_ERROR = `You have illegal escape sequence in your template literal, most likely inside content's property value.
Because you write your CSS inside a JavaScript string you actually have to do double escaping, so for example "content: '\\00d7';" should become "content: '\\\\00d7';".
You can read more about this here:
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#ES2018_revision_of_illegal_escape_sequences`;
var UNDEFINED_AS_OBJECT_KEY_ERROR =
	"You have passed in falsy value as style object's key (can happen when in example you pass unexported component as computed key).";
var hyphenateRegex = /[A-Z]|^ms/g;
var animationRegex = /_EMO_([^_]+?)_([^]*?)_EMO_/g;
var isCustomProperty = function isCustomProperty2(property) {
	return property.charCodeAt(1) === 45;
};
var isProcessableValue = function isProcessableValue2(value) {
	return value != null && typeof value !== "boolean";
};
var processStyleName = /* @__PURE__ */ emotion_memoize_esm_default(function (
	styleName
) {
	return isCustomProperty(styleName)
		? styleName
		: styleName.replace(hyphenateRegex, "-$&").toLowerCase();
});
var processStyleValue = function processStyleValue2(key, value) {
	switch (key) {
		case "animation":
		case "animationName": {
			if (typeof value === "string") {
				return value.replace(animationRegex, function (match2, p1, p2) {
					cursor = {
						name: p1,
						styles: p2,
						next: cursor,
					};
					return p1;
				});
			}
		}
	}
	if (
		emotion_unitless_esm_default[key] !== 1 &&
		!isCustomProperty(key) &&
		typeof value === "number" &&
		value !== 0
	) {
		return value + "px";
	}
	return value;
};
if (true) {
	contentValuePattern =
		/(var|attr|counters?|url|(((repeating-)?(linear|radial))|conic)-gradient)\(|(no-)?(open|close)-quote/;
	contentValues = ["normal", "none", "initial", "inherit", "unset"];
	oldProcessStyleValue = processStyleValue;
	msPattern = /^-ms-/;
	hyphenPattern = /-(.)/g;
	hyphenatedCache = {};
	processStyleValue = function processStyleValue3(key, value) {
		if (key === "content") {
			if (
				typeof value !== "string" ||
				(contentValues.indexOf(value) === -1 &&
					!contentValuePattern.test(value) &&
					(value.charAt(0) !== value.charAt(value.length - 1) ||
						(value.charAt(0) !== '"' && value.charAt(0) !== "'")))
			) {
				throw new Error(
					"You seem to be using a value for 'content' without quotes, try replacing it with `content: '\"" +
					value +
					"\"'`"
				);
			}
		}
		var processed = oldProcessStyleValue(key, value);
		if (
			processed !== "" &&
			!isCustomProperty(key) &&
			key.indexOf("-") !== -1 &&
			hyphenatedCache[key] === void 0
		) {
			hyphenatedCache[key] = true;
			console.error(
				"Using kebab-case for css properties in objects is not supported. Did you mean " +
				key
					.replace(msPattern, "ms-")
					.replace(hyphenPattern, function (str, _char) {
						return _char.toUpperCase();
					}) +
				"?"
			);
		}
		return processed;
	};
}
var contentValuePattern;
var contentValues;
var oldProcessStyleValue;
var msPattern;
var hyphenPattern;
var hyphenatedCache;
var noComponentSelectorMessage =
	"Component selectors can only be used in conjunction with @emotion/babel-plugin, the swc Emotion plugin, or another Emotion-aware compiler transform.";
function handleInterpolation(mergedProps, registered, interpolation) {
	if (interpolation == null) {
		return "";
	}
	if (interpolation.__emotion_styles !== void 0) {
		if (interpolation.toString() === "NO_COMPONENT_SELECTOR") {
			throw new Error(noComponentSelectorMessage);
		}
		return interpolation;
	}
	switch (typeof interpolation) {
		case "boolean": {
			return "";
		}
		case "object": {
			if (interpolation.anim === 1) {
				cursor = {
					name: interpolation.name,
					styles: interpolation.styles,
					next: cursor,
				};
				return interpolation.name;
			}
			if (interpolation.styles !== void 0) {
				var next2 = interpolation.next;
				if (next2 !== void 0) {
					while (next2 !== void 0) {
						cursor = {
							name: next2.name,
							styles: next2.styles,
							next: cursor,
						};
						next2 = next2.next;
					}
				}
				var styles = interpolation.styles + ";";
				if (interpolation.map !== void 0) {
					styles += interpolation.map;
				}
				return styles;
			}
			return createStringFromObject(mergedProps, registered, interpolation);
		}
		case "function": {
			if (mergedProps !== void 0) {
				var previousCursor = cursor;
				var result2 = interpolation(mergedProps);
				cursor = previousCursor;
				return handleInterpolation(mergedProps, registered, result2);
			} else if (true) {
				console.error(
					"Functions that are interpolated in css calls will be stringified.\nIf you want to have a css call based on props, create a function that returns a css call like this\nlet dynamicStyle = (props) => css`color: ${props.color}`\nIt can be called directly with props or interpolated in a styled call like this\nlet SomeComponent = styled('div')`${dynamicStyle}`"
				);
			}
			break;
		}
		case "string":
			if (true) {
				var matched = [];
				var replaced = interpolation.replace(
					animationRegex,
					function (match2, p1, p2) {
						var fakeVarName = "animation" + matched.length;
						matched.push(
							"const " +
							fakeVarName +
							" = keyframes`" +
							p2.replace(/^@keyframes animation-\w+/, "") +
							"`"
						);
						return "${" + fakeVarName + "}";
					}
				);
				if (matched.length) {
					console.error(
						"`keyframes` output got interpolated into plain string, please wrap it with `css`.\n\nInstead of doing this:\n\n" +
						[].concat(matched, ["`" + replaced + "`"]).join("\n") +
						"\n\nYou should wrap it with `css` like this:\n\n" +
						("css`" + replaced + "`")
					);
				}
			}
			break;
	}
	if (registered == null) {
		return interpolation;
	}
	var cached = registered[interpolation];
	return cached !== void 0 ? cached : interpolation;
}
function createStringFromObject(mergedProps, registered, obj) {
	var string = "";
	if (Array.isArray(obj)) {
		for (var i = 0; i < obj.length; i++) {
			string += handleInterpolation(mergedProps, registered, obj[i]) + ";";
		}
	} else {
		for (var _key in obj) {
			var value = obj[_key];
			if (typeof value !== "object") {
				if (registered != null && registered[value] !== void 0) {
					string += _key + "{" + registered[value] + "}";
				} else if (isProcessableValue(value)) {
					string +=
						processStyleName(_key) + ":" + processStyleValue(_key, value) + ";";
				}
			} else {
				if (_key === "NO_COMPONENT_SELECTOR" && true) {
					throw new Error(noComponentSelectorMessage);
				}
				if (
					Array.isArray(value) &&
					typeof value[0] === "string" &&
					(registered == null || registered[value[0]] === void 0)
				) {
					for (var _i = 0; _i < value.length; _i++) {
						if (isProcessableValue(value[_i])) {
							string +=
								processStyleName(_key) +
								":" +
								processStyleValue(_key, value[_i]) +
								";";
						}
					}
				} else {
					var interpolated = handleInterpolation(
						mergedProps,
						registered,
						value
					);
					switch (_key) {
						case "animation":
						case "animationName": {
							string += processStyleName(_key) + ":" + interpolated + ";";
							break;
						}
						default: {
							if (_key === "undefined") {
								console.error(UNDEFINED_AS_OBJECT_KEY_ERROR);
							}
							string += _key + "{" + interpolated + "}";
						}
					}
				}
			}
		}
	}
	return string;
}
var labelPattern = /label:\s*([^\s;\n{]+)\s*(;|$)/g;
var sourceMapPattern;
if (true) {
	sourceMapPattern =
		/\/\*#\ssourceMappingURL=data:application\/json;\S+\s+\*\//g;
}
var cursor;
var serializeStyles = function serializeStyles2(args, registered, mergedProps) {
	if (
		args.length === 1 &&
		typeof args[0] === "object" &&
		args[0] !== null &&
		args[0].styles !== void 0
	) {
		return args[0];
	}
	var stringMode = true;
	var styles = "";
	cursor = void 0;
	var strings = args[0];
	if (strings == null || strings.raw === void 0) {
		stringMode = false;
		styles += handleInterpolation(mergedProps, registered, strings);
	} else {
		if (strings[0] === void 0) {
			console.error(ILLEGAL_ESCAPE_SEQUENCE_ERROR);
		}
		styles += strings[0];
	}
	for (var i = 1; i < args.length; i++) {
		styles += handleInterpolation(mergedProps, registered, args[i]);
		if (stringMode) {
			if (strings[i] === void 0) {
				console.error(ILLEGAL_ESCAPE_SEQUENCE_ERROR);
			}
			styles += strings[i];
		}
	}
	var sourceMap;
	if (true) {
		styles = styles.replace(sourceMapPattern, function (match3) {
			sourceMap = match3;
			return "";
		});
	}
	labelPattern.lastIndex = 0;
	var identifierName = "";
	var match2;
	while ((match2 = labelPattern.exec(styles)) !== null) {
		identifierName +=
			"-" + // $FlowFixMe we know it's not null
			match2[1];
	}
	var name = emotion_hash_esm_default(styles) + identifierName;
	if (true) {
		return {
			name,
			styles,
			map: sourceMap,
			next: cursor,
			toString: function toString() {
				return "You have tried to stringify object returned from `css` function. It isn't supposed to be used directly (e.g. as value of the `className` prop), but rather handed to emotion so it can handle it (e.g. as value of `css` prop).";
			},
		};
	}
	return {
		name,
		styles,
		next: cursor,
	};
};

// tmp/reactable/node_modules/@emotion/utils/dist/emotion-utils.browser.esm.js
var isBrowser = true;
function getRegisteredStyles(registered, registeredStyles, classNames2) {
	var rawClassName = "";
	classNames2.split(" ").forEach(function (className) {
		if (registered[className] !== void 0) {
			registeredStyles.push(registered[className] + ";");
		} else {
			rawClassName += className + " ";
		}
	});
	return rawClassName;
}
var registerStyles = function registerStyles2(cache, serialized, isStringTag) {
	var className = cache.key + "-" + serialized.name;
	if (
		// we only need to add the styles to the registered cache if the
		// class name could be used further down
		// the tree but if it's a string tag, we know it won't
		// so we don't have to add it to registered cache.
		// this improves memory usage since we can avoid storing the whole style string
		(isStringTag === false || // we need to always store it if we're in compat mode and
			// in node since emotion-server relies on whether a style is in
			// the registered cache to know whether a style is global or not
			// also, note that this check will be dead code eliminated in the browser
			isBrowser === false) &&
		cache.registered[className] === void 0
	) {
		cache.registered[className] = serialized.styles;
	}
};
var insertStyles = function insertStyles2(cache, serialized, isStringTag) {
	registerStyles(cache, serialized, isStringTag);
	var className = cache.key + "-" + serialized.name;
	if (cache.inserted[serialized.name] === void 0) {
		var current = serialized;
		do {
			var maybeStyles = cache.insert(
				serialized === current ? "." + className : "",
				current,
				cache.sheet,
				true
			);
			current = current.next;
		} while (current !== void 0);
	}
};

// tmp/reactable/node_modules/@emotion/css/create-instance/dist/emotion-css-create-instance.esm.js
function insertWithoutScoping(cache, serialized) {
	if (cache.inserted[serialized.name] === void 0) {
		return cache.insert("", serialized, cache.sheet, true);
	}
}
function merge(registered, css2, className) {
	var registeredStyles = [];
	var rawClassName = getRegisteredStyles(
		registered,
		registeredStyles,
		className
	);
	if (registeredStyles.length < 2) {
		return className;
	}
	return rawClassName + css2(registeredStyles);
}
var createEmotion = function createEmotion2(options) {
	var cache = emotion_cache_browser_esm_default(options);
	cache.sheet.speedy = function (value) {
		if (this.ctr !== 0) {
			throw new Error("speedy must be changed before any rules are inserted");
		}
		this.isSpeedy = value;
	};
	cache.compat = true;
	var css2 = function css3() {
		for (
			var _len = arguments.length, args = new Array(_len), _key = 0;
			_key < _len;
			_key++
		) {
			args[_key] = arguments[_key];
		}
		var serialized = serializeStyles(args, cache.registered, void 0);
		insertStyles(cache, serialized, false);
		return cache.key + "-" + serialized.name;
	};
	var keyframes = function keyframes2() {
		for (
			var _len2 = arguments.length, args = new Array(_len2), _key2 = 0;
			_key2 < _len2;
			_key2++
		) {
			args[_key2] = arguments[_key2];
		}
		var serialized = serializeStyles(args, cache.registered);
		var animation = "animation-" + serialized.name;
		insertWithoutScoping(cache, {
			name: serialized.name,
			styles: "@keyframes " + animation + "{" + serialized.styles + "}",
		});
		return animation;
	};
	var injectGlobal = function injectGlobal2() {
		for (
			var _len3 = arguments.length, args = new Array(_len3), _key3 = 0;
			_key3 < _len3;
			_key3++
		) {
			args[_key3] = arguments[_key3];
		}
		var serialized = serializeStyles(args, cache.registered);
		insertWithoutScoping(cache, serialized);
	};
	var cx = function cx2() {
		for (
			var _len4 = arguments.length, args = new Array(_len4), _key4 = 0;
			_key4 < _len4;
			_key4++
		) {
			args[_key4] = arguments[_key4];
		}
		return merge(cache.registered, css2, classnames(args));
	};
	return {
		css: css2,
		cx,
		injectGlobal,
		keyframes,
		hydrate: function hydrate3(ids) {
			ids.forEach(function (key) {
				cache.inserted[key] = true;
			});
		},
		flush: function flush() {
			cache.registered = {};
			cache.inserted = {};
			cache.sheet.flush();
		},
		// $FlowFixMe
		sheet: cache.sheet,
		cache,
		getRegisteredStyles: getRegisteredStyles.bind(null, cache.registered),
		merge: merge.bind(null, cache.registered, css2),
	};
};
var classnames = function classnames2(args) {
	var cls = "";
	for (var i = 0; i < args.length; i++) {
		var arg = args[i];
		if (arg == null) continue;
		var toAdd = void 0;
		switch (typeof arg) {
			case "boolean":
				break;
			case "object": {
				if (Array.isArray(arg)) {
					toAdd = classnames2(arg);
				} else {
					toAdd = "";
					for (var k in arg) {
						if (arg[k] && k) {
							toAdd && (toAdd += " ");
							toAdd += k;
						}
					}
				}
				break;
			}
			default: {
				toAdd = arg;
			}
		}
		if (toAdd) {
			cls && (cls += " ");
			cls += toAdd;
		}
	}
	return cls;
};
var emotion_css_create_instance_esm_default = createEmotion;

// tmp/reactable/srcjs/utils.js
var import_react_table = __toESM(require_react_table());
import React2 from "react";
function classNames(...classes) {
	return classes.filter((cls) => cls).join(" ");
}
function getFirstDefined(...args) {
	return args.find((x) => x != null);
}
function removeEmptyProps(obj) {
	for (let [key, value] of Object.entries(obj)) {
		if (value == null) {
			delete obj[key];
		} else if (typeof value === "object") {
			removeEmptyProps(value);
			if (Object.keys(value).length === 0) {
				delete obj[key];
			}
		}
	}
}
function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function getLeafColumns(column2) {
	const leafColumns = [];
	const recurseColumn = (column3) => {
		if (column3.columns) {
			column3.columns.forEach(recurseColumn);
		} else {
			leafColumns.push(column3);
		}
	};
	recurseColumn(column2);
	return leafColumns;
}
function convertRowsToV6(rows) {
	return rows.map((row) => {
		if (row.subRows && row.subRows.length > 0) {
			return { _subRows: convertRowsToV6(row.subRows), ...row.values };
		} else {
			return row.values;
		}
	});
}
function rowsToCSV(rows, options = {}) {
	let { columnIds, headers = true, sep = ",", dec = "." } = options;
	const rowToCSV = (row) => {
		return row
			.map((value) => {
				if (value == null) {
					value = "";
				}
				if (value instanceof Date) {
					value = value.toISOString();
				} else if (typeof value !== "string" && typeof value !== "number") {
					value = JSON.stringify(value);
				} else if (dec !== "." && typeof value === "number") {
					value = value.toString().replace(".", dec);
				}
				if (
					typeof value === "string" &&
					(value.includes('"') || value.includes(sep))
				) {
					value = `"${value.replace(/"/g, '""')}"`;
				}
				return value;
			})
			.join(sep);
	};
	let csvRows = [];
	if (!columnIds) {
		columnIds = rows.length > 0 ? Object.keys(rows[0]) : [];
	}
	if (headers) {
		csvRows.push(rowToCSV(columnIds));
	}
	for (let row of rows) {
		const values = columnIds.map((id) => row[id]);
		csvRows.push(rowToCSV(values));
	}
	return csvRows.join("\n") + "\n";
}
function downloadCSV(content, filename) {
	const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
	if (window.navigator.msSaveBlob) {
		window.navigator.msSaveBlob(blob, filename);
	} else {
		const link = document.createElement("a");
		const url = window.URL.createObjectURL(blob);
		link.href = url;
		link.download = filename;
		link.click();
		window.URL.revokeObjectURL(url);
	}
}
function isBrowser2() {
	return typeof document !== "undefined";
}
function useAsyncDebounce(defaultFn, defaultWait = 0) {
	const debounceRef = React2.useRef({});
	const getDefaultFn = (0, import_react_table.useGetLatest)(defaultFn);
	const getDefaultWait = (0, import_react_table.useGetLatest)(defaultWait);
	return React2.useCallback(
		(...args) => {
			if (!debounceRef.current.promise) {
				debounceRef.current.promise = new Promise((resolve, reject) => {
					debounceRef.current.resolve = resolve;
					debounceRef.current.reject = reject;
				});
			}
			if (debounceRef.current.timeout) {
				clearTimeout(debounceRef.current.timeout);
			}
			debounceRef.current.timeout = setTimeout(() => {
				delete debounceRef.current.timeout;
				try {
					debounceRef.current.resolve(getDefaultFn()(...args));
				} catch (err) {
					debounceRef.current.reject(err);
				} finally {
					delete debounceRef.current.promise;
				}
			}, getDefaultWait());
			return debounceRef.current.promise;
		},
		[getDefaultFn, getDefaultWait]
	);
}

// tmp/reactable/srcjs/theme.js
function createTheme(options) {
	if (!options) return null;
	let {
		color,
		backgroundColor,
		borderColor,
		borderWidth,
		stripedColor,
		highlightColor,
		cellPadding,
		style,
		tableBorderColor = borderColor,
		tableBorderWidth = borderWidth,
		tableStyle,
		headerBorderColor = borderColor,
		headerBorderWidth = borderWidth,
		headerStyle,
		groupHeaderBorderColor = borderColor,
		groupHeaderBorderWidth = borderWidth,
		groupHeaderStyle,
		tableBodyStyle,
		rowGroupStyle,
		rowStyle,
		rowStripedStyle,
		rowHighlightStyle,
		rowSelectedStyle,
		cellBorderColor = borderColor,
		cellBorderWidth = borderWidth,
		cellStyle,
		footerBorderColor = borderColor,
		footerBorderWidth = borderWidth,
		footerStyle,
		inputStyle,
		filterInputStyle,
		searchInputStyle,
		selectStyle,
		paginationStyle,
		pageButtonStyle,
		pageButtonHoverStyle,
		pageButtonActiveStyle,
		pageButtonCurrentStyle,
	} = options;
	const expanderColor = getFirstDefinedProp(
		[cellStyle, rowStyle, tableBodyStyle, tableStyle, style],
		"color",
		color
	);
	const selectColor = getFirstDefinedProp([selectStyle, style], "color", color);
	headerBorderWidth = getFirstDefinedProp(
		[headerStyle],
		"borderWidth",
		headerBorderWidth
	);
	let css2 = {
		style: {
			color,
			backgroundColor,
			...style,
		},
		tableStyle: {
			borderColor: tableBorderColor,
			borderWidth: tableBorderWidth,
			...tableStyle,
		},
		headerStyle: {
			borderColor: headerBorderColor,
			borderWidth: headerBorderWidth,
			padding: cellPadding,
			...headerStyle,
			".rt-bordered &, .rt-outlined &": {
				borderWidth: headerBorderWidth,
			},
		},
		groupHeaderStyle: {
			// For vertical borders
			borderColor: groupHeaderBorderColor,
			borderWidth: groupHeaderBorderWidth,
			padding: cellPadding,
			...groupHeaderStyle,
			// For horizontal borders
			"&::after": {
				backgroundColor: groupHeaderBorderColor,
				height: groupHeaderBorderWidth,
			},
			".rt-bordered &": {
				borderWidth: groupHeaderBorderWidth,
			},
		},
		tableBodyStyle,
		rowGroupStyle,
		rowStyle: {
			...rowStyle,
			"&.rt-tr-striped": {
				backgroundColor: stripedColor,
				...rowStripedStyle,
			},
			"&.rt-tr-highlight:hover": {
				backgroundColor: highlightColor,
				...rowHighlightStyle,
			},
			"&.rt-tr-selected": {
				...rowSelectedStyle,
			},
		},
		cellStyle: {
			borderColor: cellBorderColor,
			borderWidth: cellBorderWidth,
			padding: cellPadding,
			...cellStyle,
		},
		footerStyle: {
			borderColor: footerBorderColor,
			borderWidth: footerBorderWidth,
			padding: cellPadding,
			...footerStyle,
		},
		filterCellStyle: {
			borderColor: cellBorderColor,
			borderWidth: cellBorderWidth,
			padding: cellPadding,
			...cellStyle,
		},
		expanderStyle: {
			"&::after": {
				borderTopColor: expanderColor,
			},
		},
		filterInputStyle: {
			...inputStyle,
			...filterInputStyle,
		},
		searchInputStyle: {
			...inputStyle,
			...searchInputStyle,
		},
		paginationStyle: {
			borderTopColor: cellBorderColor,
			borderTopWidth: cellBorderWidth,
			...paginationStyle,
			".rt-page-jump": {
				...inputStyle,
			},
			".rt-page-size-select": {
				...selectStyle,
				"@supports (-moz-appearance: none)": {
					backgroundImage:
						selectColor &&
						`url('data:image/svg+xml;charset=US-ASCII,<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path fill="${urlEncode(
							selectColor
						)}" d="M24 1.5l-12 21-12-21h24z"/></svg>')`,
				},
			},
			".rt-page-button": {
				...pageButtonStyle,
			},
			".rt-page-button:not(:disabled):hover": {
				...pageButtonHoverStyle,
			},
			".rt-page-button:not(:disabled):active": {
				...pageButtonActiveStyle,
			},
			".rt-keyboard-active & .rt-page-button:not(:disabled):focus": {
				...pageButtonHoverStyle,
			},
			".rt-page-button-current": {
				...pageButtonCurrentStyle,
			},
		},
	};
	removeEmptyProps(css2);
	return css2;
}
function getFirstDefinedProp(objects, prop, defaultVal) {
	const found = objects.find((x) => x && x[prop] != null);
	return found ? found[prop] : defaultVal;
}
function urlEncode(str) {
	return encodeURIComponent(str).replace("(", "%28").replace(")", "%29");
}
var emotion;
function getEmotion() {
	if (emotion) {
		return emotion;
	}
	let container;
	let insertionPoint;
	if (isBrowser2()) {
		for (let link of document.querySelectorAll("link")) {
			const filename = link.href.substring(link.href.lastIndexOf("/") + 1);
			if (link.rel === "stylesheet" && filename === "reactable.css") {
				container = link.parentElement;
				insertionPoint = link;
				break;
			}
		}
	}
	emotion = emotion_css_create_instance_esm_default({
		// Class prefix and unique key to prevent conflicts with other Emotion instances
		key: "reactable",
		container,
		insertionPoint,
	});
	return emotion;
}
function css(...args) {
	const emotion2 = getEmotion();
	args = args.filter((arg) => arg != null);
	return args.length ? emotion2.css(args) : null;
}

// tmp/reactable/srcjs/language.js
var defaultLanguage = {
	// Sorting
	sortLabel: "Sort {name}",
	// Filters
	filterPlaceholder: "",
	filterLabel: "Filter {name}",
	// Search
	searchPlaceholder: "Search",
	searchLabel: "Search",
	// Tables
	noData: "No rows found",
	// Pagination
	pageNext: "Next",
	pagePrevious: "Previous",
	pageNumbers: "{page} of {pages}",
	pageInfo: `{rowStart}${String.fromCharCode(8211)}{rowEnd} of {rows} rows`,
	pageSizeOptions: "Show {rows}",
	pageNextLabel: "Next page",
	pagePreviousLabel: "Previous page",
	pageNumberLabel: "Page {page}",
	pageJumpLabel: "Go to page",
	pageSizeOptionsLabel: "Rows per page",
	// Column groups
	groupExpandLabel: "Toggle group",
	// Row details
	detailsExpandLabel: "Toggle details",
	// Selection
	selectAllRowsLabel: "Select all rows",
	selectAllSubRowsLabel: "Select all rows in group",
	selectRowLabel: "Select row",
	// Deprecated in v0.3.0
	defaultGroupHeader: "Grouped",
	detailsCollapseLabel: "Toggle details",
	deselectAllRowsLabel: "Deselect all rows",
	deselectAllSubRowsLabel: "Deselect all rows in group",
	deselectRowLabel: "Deselect row",
};
function renderTemplate(template, params = {}) {
	if (!template || !params) {
		return template;
	}
	const keys = Object.keys(params);
	const separator = "(" + keys.map((key) => `{${key}}`).join("|") + ")";
	const strings = template.split(new RegExp(separator));
	const templateParams = keys.reduce((obj, key) => {
		obj[`{${key}}`] = params[key];
		return obj;
	}, {});
	const rendered = strings.map((s) =>
		templateParams[s] != null ? templateParams[s] : s
	);
	if (rendered.some((val) => typeof val === "object")) {
		return rendered;
	}
	return rendered.join("");
}

// tmp/reactable/srcjs/Pagination.js
var PageButton = ({ isCurrent, className, ...props }) => {
	className = classNames(
		className,
		"rt-page-button",
		isCurrent ? " rt-page-button-current" : null
	);
	return /* @__PURE__ */ React3.createElement(
		"button",
		{ type: "button", className, ...props },
		props.children
	);
};
PageButton.propTypes = {
	isCurrent: import_prop_types.default.bool,
	className: import_prop_types.default.string,
	children: import_prop_types.default.node,
};
function getVisiblePages(page, totalPages) {
	if (totalPages <= 6) {
		return [...Array(totalPages)].map((_, i) => i + 1);
	}
	if (page <= 4) {
		return [1, 2, 3, 4, 5, totalPages];
	} else if (totalPages - page < 3) {
		return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
	} else {
		return [1, page - 1, page, page + 1, totalPages];
	}
}
var Pagination = class extends React3.Component {
	constructor(props) {
		super(props);
		this.changePage = this.changePage.bind(this);
		this.applyPage = this.applyPage.bind(this);
		this.state = {
			pageJumpValue: props.page + 1,
			prevPage: props.page,
		};
	}
	static getDerivedStateFromProps(props, state) {
		if (props.page !== state.prevPage) {
			return {
				pageJumpValue: props.page + 1,
				prevPage: props.page,
			};
		}
		return null;
	}
	changePage(newPage) {
		const currentPage = this.props.page + 1;
		if (newPage === currentPage) {
			return;
		}
		this.props.onPageChange(newPage - 1);
	}
	applyPage(e) {
		if (e) {
			e.preventDefault();
		}
		const newPage = this.state.pageJumpValue;
		if (newPage !== "") {
			this.changePage(newPage);
		} else {
			const currentPage = this.props.page + 1;
			this.setState({ pageJumpValue: currentPage });
		}
	}
	renderPageInfo({ page, pageSize, pageRowCount, rowCount, language }) {
		const rowStart = Math.min(page * pageSize + 1, rowCount);
		const rowEnd = Math.max(
			Math.min(page * pageSize + pageSize, rowCount),
			pageRowCount
		);
		const pageInfo = renderTemplate(language.pageInfo, {
			rowStart,
			rowEnd,
			rows: rowCount,
		});
		return /* @__PURE__ */ React3.createElement(
			"div",
			{ className: "rt-page-info", "aria-live": "polite" },
			pageInfo
		);
	}
	renderPageSizeOptions({
		pageSize,
		pageSizeOptions,
		onPageSizeChange,
		language,
	}) {
		const selector = /* @__PURE__ */ React3.createElement(
			"select",
			{
				key: "page-size-select",
				className: "rt-page-size-select",
				"aria-label": language.pageSizeOptionsLabel,
				onChange: (e) => onPageSizeChange(Number(e.target.value)),
				value: pageSize,
			},
			pageSizeOptions.map((option, i) =>
				/* @__PURE__ */ React3.createElement(
				"option",
				{ key: i, value: option },
				option
			)
			)
		);
		const elements = renderTemplate(language.pageSizeOptions, {
			rows: selector,
		});
		return /* @__PURE__ */ React3.createElement(
			"div",
			{ className: "rt-page-size" },
			elements
		);
	}
	renderPageJump({ onChange, value, onBlur, onKeyPress, inputType, language }) {
		return /* @__PURE__ */ React3.createElement("input", {
			key: "page-jump",
			className: "rt-page-jump",
			"aria-label": language.pageJumpLabel,
			type: inputType,
			onChange,
			value,
			onBlur,
			onKeyPress,
		});
	}
	getPageJumpProperties() {
		return {
			onKeyPress: (e) => {
				if (e.which === 13 || e.keyCode === 13) {
					this.applyPage();
				}
			},
			onBlur: this.applyPage,
			value: this.state.pageJumpValue,
			onChange: (e) => {
				const value = e.target.value;
				if (value === "") {
					this.setState({ pageJumpValue: value });
					return;
				}
				const newPage = Number(value);
				if (!Number.isNaN(newPage)) {
					const nearestValidPage = Math.min(
						Math.max(newPage, 1),
						Math.max(this.props.pages, 1)
					);
					this.setState({ pageJumpValue: nearestValidPage });
				}
			},
			inputType: "number",
			language: this.props.language,
		};
	}
	render() {
		const {
			paginationType,
			showPageSizeOptions,
			showPageInfo,
			page,
			pages,
			canPrevious,
			canNext,
			theme,
			language,
		} = this.props;
		const pageInfo = showPageInfo ? this.renderPageInfo(this.props) : null;
		const pageSizeOptions = showPageSizeOptions
			? this.renderPageSizeOptions(this.props)
			: null;
		const currentPage = page + 1;
		const visiblePages = getVisiblePages(currentPage, pages);
		let pageNumbers;
		if (paginationType === "numbers") {
			let pageButtons = [];
			visiblePages.forEach((page2, index) => {
				const isCurrent = currentPage === page2;
				const pageButton = /* @__PURE__ */ React3.createElement(
					PageButton,
					{
						key: page2,
						isCurrent,
						onClick: this.changePage.bind(null, page2),
						"aria-label":
							renderTemplate(language.pageNumberLabel, { page: page2 }) +
							(isCurrent ? " " : ""),
						"aria-current": isCurrent ? "page" : null,
					},
					page2
				);
				if (page2 - visiblePages[index - 1] > 1) {
					pageButtons.push(
						/* @__PURE__ */ React3.createElement(
						"span",
						{
							className: "rt-page-ellipsis",
							key: `ellipsis-${page2}`,
							role: "separator",
						},
						"..."
					)
					);
				}
				pageButtons.push(pageButton);
			});
			pageNumbers = pageButtons;
		} else {
			const page2 =
				paginationType === "jump"
					? this.renderPageJump(this.getPageJumpProperties())
					: currentPage;
			const totalPages = Math.max(pages, 1);
			pageNumbers = /* @__PURE__ */ React3.createElement(
				"div",
				{ className: "rt-page-numbers" },
				renderTemplate(language.pageNumbers, { page: page2, pages: totalPages })
			);
		}
		const prevButton = /* @__PURE__ */ React3.createElement(
			PageButton,
			{
				className: "rt-prev-button",
				onClick: () => {
					if (!canPrevious) return;
					this.changePage(currentPage - 1);
				},
				disabled: !canPrevious,
				"aria-disabled": !canPrevious ? "true" : null,
				"aria-label": language.pagePreviousLabel,
			},
			language.pagePrevious
		);
		const nextButton = /* @__PURE__ */ React3.createElement(
			PageButton,
			{
				className: "rt-next-button",
				onClick: () => {
					if (!canNext) return;
					this.changePage(currentPage + 1);
				},
				disabled: !canNext,
				"aria-disabled": !canNext ? "true" : null,
				"aria-label": language.pageNextLabel,
			},
			language.pageNext
		);
		return /* @__PURE__ */ React3.createElement(
			"div",
			{ className: classNames("rt-pagination", css(theme.paginationStyle)) },
			/* @__PURE__ */ React3.createElement(
				"div",
				{ className: "rt-pagination-info" },
				pageInfo,
				pageSizeOptions
			),
			/* @__PURE__ */ React3.createElement(
				"div",
				{ className: "rt-pagination-nav" },
				prevButton,
				pageNumbers,
				nextButton
			)
		);
	}
};
Pagination.propTypes = {
	paginationType: import_prop_types.default.oneOf([
		"numbers",
		"jump",
		"simple",
	]),
	pageSizeOptions: import_prop_types.default.arrayOf(
		import_prop_types.default.number
	),
	showPageSizeOptions: import_prop_types.default.bool,
	showPageInfo: import_prop_types.default.bool,
	page: import_prop_types.default.number.isRequired,
	pages: import_prop_types.default.number.isRequired,
	pageSize: import_prop_types.default.number.isRequired,
	pageRowCount: import_prop_types.default.number.isRequired,
	canPrevious: import_prop_types.default.bool.isRequired,
	canNext: import_prop_types.default.bool.isRequired,
	onPageChange: import_prop_types.default.func.isRequired,
	onPageSizeChange: import_prop_types.default.func.isRequired,
	rowCount: import_prop_types.default.number.isRequired,
	theme: import_prop_types.default.shape({
		paginationStyle: import_prop_types.default.object,
	}),
	language: import_prop_types.default.shape({
		pageNext: import_prop_types.default.string,
		pagePrevious: import_prop_types.default.string,
		pageNumbers: import_prop_types.default.string,
		pageInfo: import_prop_types.default.string,
		pageSizeOptions: import_prop_types.default.string,
		pageNextLabel: import_prop_types.default.string,
		pagePreviousLabel: import_prop_types.default.string,
		pageNumberLabel: import_prop_types.default.string,
		pageJumpLabel: import_prop_types.default.string,
		pageSizeOptionsLabel: import_prop_types.default.string,
	}),
};
Pagination.defaultProps = {
	paginationType: "numbers",
	pageSizeOptions: [10, 25, 50, 100],
	showPageInfo: true,
	language: defaultLanguage,
};

// tmp/reactable/srcjs/WidgetContainer.js
var import_prop_types2 = __toESM(require_prop_types());
import React4 from "react";
var WidgetContainer = class _WidgetContainer extends React4.Component {
	componentDidMount() {
		this.staticRender();
	}
	staticRender() {
		if (!window.HTMLWidgets) {
			return;
		}
		if (!_WidgetContainer.throttled) {
			window.HTMLWidgets.staticRender();
			_WidgetContainer.throttled = true;
			if (typeof setTimeout !== "undefined") {
				setTimeout(() => {
					if (_WidgetContainer.lastCall) {
						window.HTMLWidgets.staticRender();
					}
					_WidgetContainer.throttled = false;
					_WidgetContainer.lastCall = false;
				});
			}
		} else {
			_WidgetContainer.lastCall = true;
		}
	}
	render() {
		if (!isBrowser2()) {
			return null;
		}
		return this.props.children;
	}
};
WidgetContainer.propTypes = {
	children: import_prop_types2.default.node,
};

// tmp/reactable/srcjs/useFlexLayout.js
var import_react_table2 = __toESM(require_react_table());
function useFlexLayout(hooks) {
	hooks.getTheadProps = [getRowGroupStyles];
	hooks.getTfootProps = [getRowGroupStyles];
	hooks.getTableBodyProps.push(getRowGroupStyles);
	hooks.getRowProps.push(getRowStyles);
	hooks.getHeaderGroupProps.push(getRowStyles);
	hooks.getFooterGroupProps.push(getRowStyles);
	hooks.getHeaderProps.push(getHeaderProps);
	hooks.getCellProps.push(getCellProps);
	hooks.getFooterProps.push(getFooterProps);
	hooks.useInstance.push(useInstance);
}
useFlexLayout.pluginName = "useFlexLayout";
var getRowGroupStyles = (props, { instance }) => {
	return [
		props,
		{
			style: {
				minWidth: asPx(instance.totalColumnsWidth),
			},
		},
	];
};
var getRowStyles = (props, { instance }) => {
	return [
		props,
		{
			style: {
				flex: "1 0 auto",
				minWidth: asPx(instance.totalColumnsWidth),
			},
		},
	];
};
var getHeaderProps = (props, { column: column2 }) => {
	const maxWidth =
		column2.totalMaxWidth < Number.MAX_SAFE_INTEGER
			? column2.totalMaxWidth
			: null;
	return [
		props,
		{
			style: {
				flex: `${column2.flexWidth} 0 auto`,
				minWidth: asPx(column2.totalMinWidth),
				width: asPx(column2.totalWidth),
				maxWidth: asPx(maxWidth),
			},
		},
	];
};
var getCellProps = (props, { cell }) => {
	const maxWidth =
		cell.column.totalMaxWidth < Number.MAX_SAFE_INTEGER
			? cell.column.totalMaxWidth
			: null;
	return [
		props,
		{
			style: {
				flex: `${cell.column.flexWidth} 0 auto`,
				minWidth: asPx(cell.column.totalMinWidth),
				width: asPx(cell.column.totalWidth),
				maxWidth: asPx(maxWidth),
			},
		},
	];
};
var getFooterProps = (props, { column: column2 }) => {
	const maxWidth =
		column2.totalMaxWidth < Number.MAX_SAFE_INTEGER
			? column2.totalMaxWidth
			: null;
	return [
		props,
		{
			style: {
				flex: `${column2.flexWidth} 0 auto`,
				minWidth: asPx(column2.totalMinWidth),
				width: asPx(column2.totalWidth),
				maxWidth: asPx(maxWidth),
			},
		},
	];
};
function useInstance(instance) {
	const { headers, state, getHooks } = instance;
	const resizedWidths = state.columnResizing.columnWidths;
	function calculateFlexWidths(columns) {
		let totalFlexWidth = 0;
		columns.forEach((column2) => {
			if (column2.headers) {
				column2.flexWidth = calculateFlexWidths(column2.headers);
			} else {
				if (resizedWidths[column2.id] != null) {
					column2.flexWidth = 0;
				} else {
					const isFixedWidth = column2.totalMinWidth === column2.totalMaxWidth;
					column2.flexWidth = isFixedWidth ? 0 : column2.totalMinWidth;
				}
			}
			if (column2.isVisible) {
				totalFlexWidth += column2.flexWidth;
			}
		});
		return totalFlexWidth;
	}
	calculateFlexWidths(headers);
	const getInstance2 = (0, import_react_table2.useGetLatest)(instance);
	const getTheadProps = (0, import_react_table2.makePropGetter)(
		getHooks().getTheadProps,
		{ instance: getInstance2() }
	);
	const getTfootProps = (0, import_react_table2.makePropGetter)(
		getHooks().getTfootProps,
		{ instance: getInstance2() }
	);
	Object.assign(instance, {
		getTheadProps,
		getTfootProps,
	});
}
function asPx(value) {
	return typeof value === "number" ? `${value}px` : void 0;
}

// tmp/reactable/srcjs/useStickyColumns.js
var import_react_table3 = __toESM(require_react_table());
function useStickyColumns(hooks) {
	hooks.getHeaderProps.push(getHeaderProps2);
	hooks.getCellProps.push(getCellProps2);
	hooks.getFooterProps.push(getFooterProps2);
	hooks.useInstance.push(useInstance2);
}
useStickyColumns.pluginName = "useStickyColumns";
var getHeaderProps2 = (props, { column: column2 }) => {
	if (!column2.stickyProps) {
		return props;
	}
	return [props, column2.stickyProps];
};
var getCellProps2 = (props, { cell }) => {
	if (!cell.column.stickyProps) {
		return props;
	}
	return [props, cell.column.stickyProps];
};
var getFooterProps2 = (props, { column: column2 }) => {
	if (!column2.stickyProps) {
		return props;
	}
	return [props, column2.stickyProps];
};
var getStickyProps = (column2, columns) => {
	const props = {
		className: "rt-sticky",
		style: {
			position: "sticky",
		},
	};
	if (column2.sticky === "left") {
		const stickyCols = columns.filter((col) => col.sticky === "left");
		props.style.left = 0;
		for (let col of stickyCols) {
			if (col.id === column2.id) break;
			props.style.left += col.totalWidth;
		}
	} else if (column2.sticky === "right") {
		const stickyCols = columns.filter((col) => col.sticky === "right");
		props.style.right = 0;
		for (let col of stickyCols.reverse()) {
			if (col.id === column2.id) break;
			props.style.right += col.totalWidth;
		}
	}
	return props;
};
function useInstance2(instance) {
	const { plugins, headerGroups } = instance;
	(0, import_react_table3.ensurePluginOrder)(
		plugins,
		["useResizeColumns"],
		"useStickyColumns"
	);
	headerGroups.forEach((headerGroup) => {
		const columns = headerGroup.headers;
		columns.forEach((column2) => {
			const groupColumns = [column2];
			if (column2.columns) {
				groupColumns.push(...getLeafColumns(column2));
			}
			const firstStickyCol = groupColumns.find((col) => col.sticky);
			if (firstStickyCol) {
				groupColumns.forEach((col) => {
					col.sticky = firstStickyCol.sticky;
				});
			}
		});
		columns.forEach((column2) => {
			if (column2.sticky) {
				column2.stickyProps = getStickyProps(column2, columns);
			}
		});
	});
}

// tmp/reactable/srcjs/useGroupBy.js
var import_react_table4 = __toESM(require_react_table());
import React5 from "react";
var aggregations = {};
var emptyArray = [];
var emptyObject = {};
import_react_table4.actions.resetGroupBy = "resetGroupBy";
import_react_table4.actions.setGroupBy = "setGroupBy";
import_react_table4.actions.toggleGroupBy = "toggleGroupBy";
function useGroupBy(hooks) {
	hooks.getGroupByToggleProps = [defaultGetGroupByToggleProps];
	hooks.stateReducers.push(reducer);
	hooks.visibleColumnsDeps.push((deps, { instance }) => [
		...deps,
		instance.state.groupBy,
	]);
	hooks.visibleColumns.push(visibleColumns);
	hooks.useInstance.push(useInstance3);
	hooks.prepareRow.push(prepareRow);
}
useGroupBy.pluginName = "useGroupBy";
var defaultGetGroupByToggleProps = (props, { header }) => [
	props,
	{
		onClick: header.canGroupBy
			? (e) => {
				e.persist();
				header.toggleGroupBy();
			}
			: void 0,
		style: {
			cursor: header.canGroupBy ? "pointer" : void 0,
		},
		title: "Toggle GroupBy",
	},
];
function reducer(state, action, previousState, instance) {
	if (action.type === import_react_table4.actions.init) {
		return {
			groupBy: [],
			...state,
		};
	}
	if (action.type === import_react_table4.actions.resetGroupBy) {
		return {
			...state,
			groupBy: instance.initialState.groupBy || [],
		};
	}
	if (action.type === import_react_table4.actions.setGroupBy) {
		const { value } = action;
		return {
			...state,
			groupBy: value,
		};
	}
	if (action.type === import_react_table4.actions.toggleGroupBy) {
		const { columnId, value: setGroupBy2 } = action;
		const resolvedGroupBy =
			typeof setGroupBy2 !== "undefined"
				? setGroupBy2
				: !state.groupBy.includes(columnId);
		if (resolvedGroupBy) {
			return {
				...state,
				groupBy: [...state.groupBy, columnId],
			};
		}
		return {
			...state,
			groupBy: state.groupBy.filter((d) => d !== columnId),
		};
	}
}
function visibleColumns(
	columns,
	{
		instance: {
			state: { groupBy },
		},
	}
) {
	const groupByColumns = groupBy
		.map((g) => columns.find((col) => col.id === g))
		.filter(Boolean);
	const nonGroupByColumns = columns.filter((col) => !groupBy.includes(col.id));
	columns = [...groupByColumns, ...nonGroupByColumns];
	columns.forEach((column2) => {
		column2.isGrouped = groupBy.includes(column2.id);
		column2.groupedIndex = groupBy.indexOf(column2.id);
	});
	return columns;
}
var defaultUserAggregations = {};
function useInstance3(instance) {
	const {
		data,
		rows,
		flatRows,
		rowsById,
		allColumns,
		flatHeaders,
		groupByFn = defaultGroupByFn,
		manualGroupBy,
		aggregations: userAggregations = defaultUserAggregations,
		plugins,
		state: { groupBy },
		dispatch,
		autoResetGroupBy = true,
		disableGroupBy,
		defaultCanGroupBy,
		getHooks,
	} = instance;
	(0, import_react_table4.ensurePluginOrder)(
		plugins,
		["useColumnOrder", "useFilters"],
		"useGroupBy"
	);
	const getInstance2 = (0, import_react_table4.useGetLatest)(instance);
	allColumns.forEach((column2) => {
		const {
			accessor,
			defaultGroupBy: defaultColumnGroupBy,
			disableGroupBy: columnDisableGroupBy,
		} = column2;
		column2.canGroupBy = accessor
			? getFirstDefined(
				column2.canGroupBy,
				columnDisableGroupBy === true ? false : void 0,
				disableGroupBy === true ? false : void 0,
				true
			)
			: getFirstDefined(
				column2.canGroupBy,
				defaultColumnGroupBy,
				defaultCanGroupBy,
				false
			);
		if (column2.canGroupBy) {
			column2.toggleGroupBy = () => instance.toggleGroupBy(column2.id);
		}
		column2.Aggregated = column2.Aggregated || column2.Cell;
	});
	const toggleGroupBy2 = React5.useCallback(
		(columnId, value) => {
			dispatch({
				type: import_react_table4.actions.toggleGroupBy,
				columnId,
				value,
			});
		},
		[dispatch]
	);
	const setGroupBy2 = React5.useCallback(
		(value) => {
			dispatch({ type: import_react_table4.actions.setGroupBy, value });
		},
		[dispatch]
	);
	flatHeaders.forEach((header) => {
		header.getGroupByToggleProps = (0, import_react_table4.makePropGetter)(
			getHooks().getGroupByToggleProps,
			{
				instance: getInstance2(),
				header,
			}
		);
	});
	const [
		groupedRows,
		groupedFlatRows,
		groupedRowsById,
		onlyGroupedFlatRows,
		onlyGroupedRowsById,
		nonGroupedFlatRows,
		nonGroupedRowsById,
	] = React5.useMemo(() => {
		if (groupBy.length === 0) {
			return [
				rows,
				flatRows,
				rowsById,
				emptyArray,
				emptyObject,
				flatRows,
				rowsById,
			];
		}
		if (manualGroupBy) {
			const existingGroupBy2 = groupBy.filter((g) =>
				allColumns.find((col) => col.id === g)
			);
			const setGroupingProps = (rows2, depth = 0) => {
				rows2.forEach((row) => {
					row.depth = depth;
				});
				if (depth === existingGroupBy2.length) {
					return;
				}
				const columnId = existingGroupBy2[depth];
				const groupedColumns = existingGroupBy2.slice(0, depth + 1);
				const aggregatedColumns = allColumns
					.filter((col) => !groupedColumns.includes(col.id))
					.map((col) => col.id);
				rows2.forEach((row) => {
					if (!row.isGrouped) {
						return;
					}
					row.groupByID = columnId;
					row.aggregatedColumns = aggregatedColumns;
					setGroupingProps(row.subRows, depth + 1);
				});
			};
			const flatRows2 = rows.filter((row) => row.parentId == null);
			setGroupingProps(flatRows2);
			return [
				rows,
				flatRows2,
				rowsById,
				emptyArray,
				emptyObject,
				flatRows2,
				rowsById,
			];
		}
		const existingGroupBy = groupBy.filter((g) =>
			allColumns.find((col) => col.id === g)
		);
		const aggregateRowsToValues = (
			leafRows,
			groupedRows3,
			depth,
			aggregatedColumns
		) => {
			const values = {};
			allColumns.forEach((column2) => {
				if (!aggregatedColumns.includes(column2.id)) {
					values[column2.id] = groupedRows3[0]
						? groupedRows3[0].values[column2.id]
						: null;
					return;
				}
				let aggregateFn =
					typeof column2.aggregate === "function"
						? column2.aggregate
						: userAggregations[column2.aggregate] ||
						aggregations[column2.aggregate];
				if (aggregateFn) {
					const leafValues = leafRows.map((row) => {
						let columnValue = row.values[column2.id];
						if (!depth && column2.aggregateValue) {
							const aggregateValueFn =
								typeof column2.aggregateValue === "function"
									? column2.aggregateValue
									: userAggregations[column2.aggregateValue] ||
									aggregations[column2.aggregateValue];
							if (!aggregateValueFn) {
								console.info({ column: column2 });
								throw new Error(
									`React Table: Invalid column.aggregateValue option for column listed above`
								);
							}
							columnValue = aggregateValueFn(columnValue, row, column2);
						}
						return columnValue;
					});
					values[column2.id] = aggregateFn(
						leafValues,
						leafRows.map((row) => row.values),
						groupedRows3.map((row) => row.values)
					);
				} else if (column2.aggregate) {
					console.info({ column: column2 });
					throw new Error(
						`React Table: Invalid column.aggregate option for column listed above`
					);
				} else {
					values[column2.id] = null;
				}
			});
			return values;
		};
		let groupedFlatRows2 = [];
		const groupedRowsById2 = {};
		const onlyGroupedFlatRows2 = [];
		const onlyGroupedRowsById2 = {};
		const nonGroupedFlatRows2 = [];
		const nonGroupedRowsById2 = {};
		const groupUpRecursively = (rows2, depth = 0, parentId) => {
			if (depth === existingGroupBy.length) {
				rows2.forEach((row) => {
					row.depth = depth;
				});
				return rows2;
			}
			const columnId = existingGroupBy[depth];
			let rowGroupsMap = groupByFn(rows2, columnId);
			const aggregatedGroupedRows = Object.entries(rowGroupsMap).map(
				([groupByVal, groupedRows3], index) => {
					let id = `${columnId}:${groupByVal}`;
					id = parentId ? `${parentId}>${id}` : id;
					const subRows = groupUpRecursively(groupedRows3, depth + 1, id);
					const leafRows = depth
						? flattenBy(groupedRows3, "leafRows")
						: groupedRows3;
					const groupedColumns = existingGroupBy.slice(0, depth + 1);
					const aggregatedColumns = allColumns
						.filter((col) => !groupedColumns.includes(col.id))
						.map((col) => col.id);
					const values = aggregateRowsToValues(
						leafRows,
						subRows,
						depth,
						aggregatedColumns
					);
					const row = {
						id,
						isGrouped: true,
						groupByID: columnId,
						groupByVal,
						values,
						subRows,
						leafRows,
						depth,
						// Originally, aggregated rows had a row index corresponding to the index within
						// rowGroupsMap. This row index doesn't map to a valid data row and overlaps
						// with the leaf rows, so explicitly omit it.
						// index: undefined,
						index: void 0,
						groupIndex: index,
						// All columns that can be aggregated (including groupBy columns)
						aggregatedColumns,
					};
					subRows.forEach((subRow) => {
						groupedFlatRows2.push(subRow);
						groupedRowsById2[subRow.id] = subRow;
						if (subRow.isGrouped) {
							onlyGroupedFlatRows2.push(subRow);
							onlyGroupedRowsById2[subRow.id] = subRow;
						} else {
							nonGroupedFlatRows2.push(subRow);
							nonGroupedRowsById2[subRow.id] = subRow;
						}
					});
					return row;
				}
			);
			return aggregatedGroupedRows;
		};
		const groupedRows2 = groupUpRecursively(rows);
		groupedRows2.forEach((subRow) => {
			groupedFlatRows2.push(subRow);
			groupedRowsById2[subRow.id] = subRow;
			if (subRow.isGrouped) {
				onlyGroupedFlatRows2.push(subRow);
				onlyGroupedRowsById2[subRow.id] = subRow;
			} else {
				nonGroupedFlatRows2.push(subRow);
				nonGroupedRowsById2[subRow.id] = subRow;
			}
		});
		return [
			groupedRows2,
			groupedFlatRows2,
			groupedRowsById2,
			onlyGroupedFlatRows2,
			onlyGroupedRowsById2,
			nonGroupedFlatRows2,
			nonGroupedRowsById2,
		];
	}, [
		manualGroupBy,
		groupBy,
		rows,
		flatRows,
		rowsById,
		allColumns,
		userAggregations,
		groupByFn,
	]);
	const getAutoResetGroupBy = (0, import_react_table4.useGetLatest)(
		autoResetGroupBy
	);
	(0, import_react_table4.useMountedLayoutEffect)(() => {
		if (getAutoResetGroupBy()) {
			dispatch({ type: import_react_table4.actions.resetGroupBy });
		}
	}, [dispatch, manualGroupBy ? null : data]);
	Object.assign(instance, {
		preGroupedRows: rows,
		preGroupedFlatRow: flatRows,
		preGroupedRowsById: rowsById,
		groupedRows,
		groupedFlatRows,
		groupedRowsById,
		onlyGroupedFlatRows,
		onlyGroupedRowsById,
		nonGroupedFlatRows,
		nonGroupedRowsById,
		rows: groupedRows,
		flatRows: groupedFlatRows,
		rowsById: groupedRowsById,
		toggleGroupBy: toggleGroupBy2,
		setGroupBy: setGroupBy2,
	});
}
function prepareRow(row) {
	row.allCells.forEach((cell) => {
		cell.isGrouped = cell.column.isGrouped && cell.column.id === row.groupByID;
		cell.isAggregated =
			!cell.isGrouped &&
			row.aggregatedColumns?.includes(cell.column.id) &&
			row.subRows?.length;
		cell.isPlaceholder =
			!cell.isGrouped && cell.column.isGrouped && !cell.isAggregated;
	});
}
function defaultGroupByFn(rows, columnId) {
	return rows.reduce((prev2, row) => {
		const resKey = `${row.values[columnId]}`;
		prev2[resKey] = Array.isArray(prev2[resKey]) ? prev2[resKey] : [];
		prev2[resKey].push(row);
		return prev2;
	}, {});
}
function flattenBy(arr, key) {
	const flat = [];
	const recurse = (arr2) => {
		arr2.forEach((d) => {
			if (!d[key]) {
				flat.push(d);
			} else {
				recurse(d[key]);
			}
		});
	};
	recurse(arr);
	return flat;
}

// tmp/reactable/srcjs/useResizeColumns.js
var import_react_table5 = __toESM(require_react_table());
import React6 from "react";
var passiveSupported = null;
function passiveEventSupported() {
	if (typeof passiveSupported === "boolean") return passiveSupported;
	let supported = false;
	try {
		const options = {
			get passive() {
				supported = true;
				return false;
			},
		};
		window.addEventListener("test", null, options);
		window.removeEventListener("test", null, options);
	} catch (err) {
		supported = false;
	}
	passiveSupported = supported;
	return passiveSupported;
}
import_react_table5.defaultColumn.canResize = true;
import_react_table5.actions.columnStartResizing = "columnStartResizing";
import_react_table5.actions.columnResizing = "columnResizing";
import_react_table5.actions.columnDoneResizing = "columnDoneResizing";
import_react_table5.actions.resetResize = "resetResize";
function useResizeColumns(hooks) {
	hooks.getResizerProps = [defaultGetResizerProps];
	hooks.getHeaderProps.push({
		style: {
			position: "relative",
		},
	});
	hooks.stateReducers.push(reducer2);
	hooks.useInstance.push(useInstance4);
	hooks.useInstanceBeforeDimensions.push(useInstanceBeforeDimensions);
}
var defaultGetResizerProps = (props, { instance, header }) => {
	const { dispatch } = instance;
	const onResizeStart = (e, header2) => {
		let isTouchEvent = false;
		if (e.type === "touchstart") {
			if (e.touches && e.touches.length > 1) {
				return;
			}
			isTouchEvent = true;
		}
		const headersToResize = getAllColumns(header2);
		const headerIdWidths = headersToResize.map((d) => [d.id, d.getDOMWidth()]);
		const columnWidth = headerIdWidths.find(([id]) => id === header2.id)[1];
		const clientX = isTouchEvent ? Math.round(e.touches[0].clientX) : e.clientX;
		let raf;
		let mostRecentClientX;
		const dispatchMove = () => {
			window.cancelAnimationFrame(raf);
			raf = null;
			dispatch({
				type: import_react_table5.actions.columnResizing,
				clientX: mostRecentClientX,
			});
		};
		const dispatchEnd = () => {
			window.cancelAnimationFrame(raf);
			raf = null;
			dispatch({ type: import_react_table5.actions.columnDoneResizing });
		};
		const scheduleDispatchMoveOnNextAnimationFrame = (clientXPos) => {
			mostRecentClientX = clientXPos;
			if (!raf) {
				raf = window.requestAnimationFrame(dispatchMove);
			}
		};
		const handlersAndEvents = {
			mouse: {
				moveEvent: "mousemove",
				moveHandler: (e2) =>
					scheduleDispatchMoveOnNextAnimationFrame(e2.clientX),
				upEvent: "mouseup",
				upHandler: () => {
					document.removeEventListener(
						"mousemove",
						handlersAndEvents.mouse.moveHandler
					);
					document.removeEventListener(
						"mouseup",
						handlersAndEvents.mouse.upHandler
					);
					dispatchEnd();
				},
			},
			touch: {
				moveEvent: "touchmove",
				moveHandler: (e2) => {
					if (e2.cancelable) {
						e2.preventDefault();
						e2.stopPropagation();
					}
					scheduleDispatchMoveOnNextAnimationFrame(e2.touches[0].clientX);
					return false;
				},
				upEvent: "touchend",
				upHandler: () => {
					document.removeEventListener(
						handlersAndEvents.touch.moveEvent,
						handlersAndEvents.touch.moveHandler
					);
					document.removeEventListener(
						handlersAndEvents.touch.upEvent,
						handlersAndEvents.touch.upHandler
					);
					dispatchEnd();
				},
			},
		};
		const events = isTouchEvent
			? handlersAndEvents.touch
			: handlersAndEvents.mouse;
		const passiveIfSupported = passiveEventSupported()
			? { passive: false }
			: false;
		document.addEventListener(
			events.moveEvent,
			events.moveHandler,
			passiveIfSupported
		);
		document.addEventListener(
			events.upEvent,
			events.upHandler,
			passiveIfSupported
		);
		dispatch({
			type: import_react_table5.actions.columnStartResizing,
			columnId: header2.id,
			columnWidth,
			headerIdWidths,
			clientX,
		});
	};
	return [
		props,
		{
			onMouseDown: (e) => e.persist() || onResizeStart(e, header),
			onTouchStart: (e) => e.persist() || onResizeStart(e, header),
			style: {
				cursor: "col-resize",
			},
			draggable: false,
			role: "separator",
		},
	];
};
useResizeColumns.pluginName = "useResizeColumns";
function reducer2(state, action) {
	if (action.type === import_react_table5.actions.init) {
		return {
			columnResizing: {
				columnWidths: {},
			},
			...state,
		};
	}
	if (action.type === import_react_table5.actions.resetResize) {
		return {
			...state,
			columnResizing: {
				columnWidths: {},
			},
		};
	}
	if (action.type === import_react_table5.actions.columnStartResizing) {
		const { clientX, columnId, columnWidth, headerIdWidths } = action;
		return {
			...state,
			columnResizing: {
				...state.columnResizing,
				startX: clientX,
				headerIdWidths,
				columnWidth,
				isResizingColumn: columnId,
			},
		};
	}
	if (action.type === import_react_table5.actions.columnResizing) {
		const { clientX } = action;
		const { startX, columnWidth, headerIdWidths = [] } = state.columnResizing;
		const deltaX = clientX - startX;
		const percentageDeltaX = deltaX / columnWidth;
		const newColumnWidths = {};
		headerIdWidths.forEach(([headerId, headerWidth]) => {
			newColumnWidths[headerId] = Math.max(
				headerWidth + headerWidth * percentageDeltaX,
				0
			);
		});
		return {
			...state,
			columnResizing: {
				...state.columnResizing,
				columnWidths: {
					...state.columnResizing.columnWidths,
					...newColumnWidths,
				},
			},
		};
	}
	if (action.type === import_react_table5.actions.columnDoneResizing) {
		return {
			...state,
			columnResizing: {
				...state.columnResizing,
				startX: null,
				isResizingColumn: null,
			},
		};
	}
}
var useInstanceBeforeDimensions = (instance) => {
	const {
		flatHeaders,
		disableResizing,
		getHooks,
		state: { columnResizing },
	} = instance;
	const getInstance2 = (0, import_react_table5.useGetLatest)(instance);
	flatHeaders.forEach((header) => {
		const canResize = getFirstDefined(
			header.disableResizing === true ? false : void 0,
			disableResizing === true ? false : void 0,
			true
		);
		header.canResize = canResize;
		header.width = getFirstDefined(
			columnResizing.columnWidths[header.id],
			header.originalWidth,
			header.width
		);
		header.isResizing = columnResizing.isResizingColumn === header.id;
		if (canResize) {
			header.getResizerProps = (0, import_react_table5.makePropGetter)(
				getHooks().getResizerProps,
				{
					instance: getInstance2(),
					header,
				}
			);
		}
	});
};
function useInstance4(instance) {
	const { plugins, dispatch, autoResetResize = true, columns } = instance;
	(0, import_react_table5.ensurePluginOrder)(
		plugins,
		["useAbsoluteLayout"],
		"useResizeColumns"
	);
	const getAutoResetResize = (0, import_react_table5.useGetLatest)(
		autoResetResize
	);
	(0, import_react_table5.useMountedLayoutEffect)(() => {
		if (getAutoResetResize()) {
			dispatch({ type: import_react_table5.actions.resetResize });
		}
	}, [columns]);
	const resetResizing = React6.useCallback(
		() => dispatch({ type: import_react_table5.actions.resetResize }),
		[dispatch]
	);
	Object.assign(instance, {
		resetResizing,
	});
}
function getAllColumns(column2) {
	const allColumns = [];
	const recurseColumn = (column3) => {
		if (column3.columns && column3.columns.length) {
			column3.columns.forEach(recurseColumn);
		}
		allColumns.push(column3);
	};
	recurseColumn(column2);
	return allColumns;
}

// tmp/reactable/srcjs/useRowSelect.js
var import_react_table6 = __toESM(require_react_table());
import React7 from "react";
var pluginName = "useRowSelect";
import_react_table6.actions.resetSelectedRows = "resetSelectedRows";
import_react_table6.actions.toggleAllRowsSelected = "toggleAllRowsSelected";
import_react_table6.actions.toggleRowSelected = "toggleRowSelected";
import_react_table6.actions.toggleAllPageRowsSelected =
	"toggleAllPageRowsSelected";
import_react_table6.actions.setRowsSelected = "setRowsSelected";
function useRowSelect(hooks) {
	hooks.getToggleRowSelectedProps = [defaultGetToggleRowSelectedProps];
	hooks.getToggleAllRowsSelectedProps = [defaultGetToggleAllRowsSelectedProps];
	hooks.getToggleAllPageRowsSelectedProps = [
		defaultGetToggleAllPageRowsSelectedProps,
	];
	hooks.stateReducers.push(reducer3);
	hooks.useInstance.push(useInstance5);
	hooks.prepareRow.push(prepareRow2);
}
useRowSelect.pluginName = pluginName;
var defaultGetToggleRowSelectedProps = (props, { instance, row }) => {
	const { manualRowSelectedKey = "isSelected" } = instance;
	let checked = false;
	if (row.original && row.original[manualRowSelectedKey]) {
		checked = true;
	} else {
		checked = row.isSelected;
	}
	return [
		props,
		{
			onChange: (e) => {
				row.toggleRowSelected(e.target.checked);
			},
			style: {
				cursor: "pointer",
			},
			checked,
			title: "Toggle Row Selected",
			indeterminate: row.isSomeSelected,
		},
	];
};
var defaultGetToggleAllRowsSelectedProps = (props, { instance }) => [
	props,
	{
		onChange: (e) => {
			instance.toggleAllRowsSelected(e.target.checked);
		},
		style: {
			cursor: "pointer",
		},
		checked: instance.isAllRowsSelected,
		title: "Toggle All Rows Selected",
		indeterminate: Boolean(
			!instance.isAllRowsSelected &&
			Object.keys(instance.state.selectedRowIds).length
		),
	},
];
var defaultGetToggleAllPageRowsSelectedProps = (props, { instance }) => [
	props,
	{
		onChange(e) {
			instance.toggleAllPageRowsSelected(e.target.checked);
		},
		style: {
			cursor: "pointer",
		},
		checked: instance.isAllPageRowsSelected,
		title: "Toggle All Current Page Rows Selected",
		indeterminate: Boolean(
			!instance.isAllPageRowsSelected &&
			instance.page.some(({ id }) => instance.state.selectedRowIds[id])
		),
	},
];
function reducer3(state, action, previousState, instance) {
	if (action.type === import_react_table6.actions.init) {
		return {
			selectedRowIds: {},
			...state,
		};
	}
	if (action.type === import_react_table6.actions.resetSelectedRows) {
		return {
			...state,
			selectedRowIds: instance.initialState.selectedRowIds || {},
		};
	}
	if (action.type === import_react_table6.actions.toggleAllRowsSelected) {
		const { value: setSelected } = action;
		const {
			isAllRowsSelected,
			rowsById,
			nonGroupedRowsById = rowsById,
		} = instance;
		const selectAll =
			typeof setSelected !== "undefined" ? setSelected : !isAllRowsSelected;
		const selectedRowIds = Object.assign({}, state.selectedRowIds);
		if (selectAll) {
			Object.keys(nonGroupedRowsById).forEach((rowId) => {
				selectedRowIds[rowId] = true;
			});
		} else {
			Object.keys(nonGroupedRowsById).forEach((rowId) => {
				delete selectedRowIds[rowId];
			});
		}
		return {
			...state,
			selectedRowIds,
		};
	}
	if (action.type === import_react_table6.actions.toggleRowSelected) {
		const { id, value: setSelected } = action;
		const { rowsById, selectSubRows = true } = instance;
		const isSelected = state.selectedRowIds[id];
		const shouldExist =
			typeof setSelected !== "undefined" ? setSelected : !isSelected;
		if (isSelected === shouldExist) {
			return state;
		}
		const newSelectedRowIds = { ...state.selectedRowIds };
		const handleRowById = (id2) => {
			const row = rowsById[id2];
			if (!row.isGrouped) {
				if (shouldExist) {
					newSelectedRowIds[id2] = true;
				} else {
					delete newSelectedRowIds[id2];
				}
			}
			if (selectSubRows && row.subRows) {
				return row.subRows.forEach((row2) => handleRowById(row2.id));
			}
		};
		handleRowById(id);
		return {
			...state,
			selectedRowIds: newSelectedRowIds,
		};
	}
	if (action.type === import_react_table6.actions.toggleAllPageRowsSelected) {
		const { value: setSelected } = action;
		const {
			page,
			rowsById,
			selectSubRows = true,
			isAllPageRowsSelected,
		} = instance;
		const selectAll =
			typeof setSelected !== "undefined" ? setSelected : !isAllPageRowsSelected;
		const newSelectedRowIds = { ...state.selectedRowIds };
		const handleRowById = (id) => {
			const row = rowsById[id];
			if (!row.isGrouped) {
				if (selectAll) {
					newSelectedRowIds[id] = true;
				} else {
					delete newSelectedRowIds[id];
				}
			}
			if (selectSubRows && row.subRows) {
				return row.subRows.forEach((row2) => handleRowById(row2.id));
			}
		};
		page.forEach((row) => handleRowById(row.id));
		return {
			...state,
			selectedRowIds: newSelectedRowIds,
		};
	}
	if (action.type === import_react_table6.actions.setRowsSelected) {
		const { ids: setSelected } = action;
		const { rowsById, selectSubRows = true } = instance;
		const newSelectedRowIds = {};
		const handleRowById = (id) => {
			const row = rowsById[id];
			if (!row) {
				newSelectedRowIds[id] = true;
				return;
			}
			if (!row.isGrouped) {
				newSelectedRowIds[id] = true;
			}
			if (selectSubRows && row.subRows) {
				return row.subRows.forEach((row2) => handleRowById(row2.id));
			}
		};
		setSelected.forEach((rowId) => handleRowById(rowId));
		return {
			...state,
			selectedRowIds: newSelectedRowIds,
		};
	}
	return state;
}
function useInstance5(instance) {
	const {
		data,
		rows,
		getHooks,
		plugins,
		rowsById,
		nonGroupedRowsById = rowsById,
		autoResetSelectedRows = true,
		state: { selectedRowIds },
		selectSubRows = true,
		dispatch,
		page,
	} = instance;
	(0, import_react_table6.ensurePluginOrder)(
		plugins,
		["useFilters", "useGroupBy", "useSortBy", "useExpanded", "usePagination"],
		"useRowSelect"
	);
	const selectedFlatRows = React7.useMemo(() => {
		const selectedFlatRows2 = [];
		const handleRow = (row) => {
			const isSelected = selectSubRows
				? getRowIsSelected(row, selectedRowIds)
				: !!selectedRowIds[row.id];
			row.isSelected = !!isSelected;
			row.isSomeSelected = isSelected === null;
			if (isSelected) {
				selectedFlatRows2.push(row);
			}
			if (row.subRows && row.subRows.length) {
				row.subRows.forEach((row2) => handleRow(row2));
			}
		};
		rows.forEach((row) => handleRow(row));
		return selectedFlatRows2;
	}, [rows, selectSubRows, selectedRowIds]);
	let isAllRowsSelected = Boolean(
		Object.keys(nonGroupedRowsById).length && Object.keys(selectedRowIds).length
	);
	let isAllPageRowsSelected = isAllRowsSelected;
	if (isAllRowsSelected) {
		if (Object.keys(nonGroupedRowsById).some((id) => !selectedRowIds[id])) {
			isAllRowsSelected = false;
		}
	}
	if (!isAllRowsSelected) {
		if (page && page.length && page.some(({ id }) => !selectedRowIds[id])) {
			isAllPageRowsSelected = false;
		}
	}
	const getAutoResetSelectedRows = (0, import_react_table6.useGetLatest)(
		autoResetSelectedRows
	);
	(0, import_react_table6.useMountedLayoutEffect)(() => {
		if (getAutoResetSelectedRows()) {
			dispatch({ type: import_react_table6.actions.resetSelectedRows });
		}
	}, [dispatch, data]);
	const toggleAllRowsSelected = React7.useCallback(
		(value) =>
			dispatch({
				type: import_react_table6.actions.toggleAllRowsSelected,
				value,
			}),
		[dispatch]
	);
	const toggleAllPageRowsSelected = React7.useCallback(
		(value) =>
			dispatch({
				type: import_react_table6.actions.toggleAllPageRowsSelected,
				value,
			}),
		[dispatch]
	);
	const toggleRowSelected = React7.useCallback(
		(id, value) =>
			dispatch({
				type: import_react_table6.actions.toggleRowSelected,
				id,
				value,
			}),
		[dispatch]
	);
	const setRowsSelected = React7.useCallback(
		(ids) =>
			dispatch({ type: import_react_table6.actions.setRowsSelected, ids }),
		[dispatch]
	);
	const getInstance2 = (0, import_react_table6.useGetLatest)(instance);
	const getToggleAllRowsSelectedProps = (0, import_react_table6.makePropGetter)(
		getHooks().getToggleAllRowsSelectedProps,
		{
			instance: getInstance2(),
		}
	);
	const getToggleAllPageRowsSelectedProps = (0,
		import_react_table6.makePropGetter)(
			getHooks().getToggleAllPageRowsSelectedProps,
			{ instance: getInstance2() }
		);
	Object.assign(instance, {
		selectedFlatRows,
		isAllRowsSelected,
		isAllPageRowsSelected,
		toggleRowSelected,
		toggleAllRowsSelected,
		setRowsSelected,
		getToggleAllRowsSelectedProps,
		getToggleAllPageRowsSelectedProps,
		toggleAllPageRowsSelected,
	});
}
function prepareRow2(row, { instance }) {
	row.toggleRowSelected = (set) => instance.toggleRowSelected(row.id, set);
	row.getToggleRowSelectedProps = (0, import_react_table6.makePropGetter)(
		instance.getHooks().getToggleRowSelectedProps,
		{
			instance,
			row,
		}
	);
}
function getRowIsSelected(row, selectedRowIds) {
	if (selectedRowIds[row.id]) {
		return true;
	}
	const subRows = row.subRows;
	if (subRows && subRows.length) {
		let allChildrenSelected = true;
		let someSelected = false;
		const availableSubRows = subRows.filter((row2) => row2 != null);
		if (availableSubRows.length !== subRows.length) {
			return false;
		}
		subRows.forEach((subRow) => {
			if (someSelected && !allChildrenSelected) {
				return;
			}
			if (getRowIsSelected(subRow, selectedRowIds)) {
				someSelected = true;
			} else {
				allChildrenSelected = false;
			}
		});
		return allChildrenSelected ? true : someSelected ? null : false;
	}
	return false;
}

// tmp/reactable/srcjs/usePagination.js
var import_react_table7 = __toESM(require_react_table());
import React8 from "react";
var pluginName2 = "usePagination";
import_react_table7.actions.resetPage = "resetPage";
import_react_table7.actions.gotoPage = "gotoPage";
import_react_table7.actions.setPageSize = "setPageSize";
function usePagination(hooks) {
	hooks.stateReducers.push(reducer4);
	hooks.useInstance.push(useInstance6);
}
usePagination.pluginName = pluginName2;
function reducer4(state, action, previousState, instance) {
	if (action.type === import_react_table7.actions.init) {
		return {
			pageSize: 10,
			pageIndex: 0,
			...state,
		};
	}
	if (action.type === import_react_table7.actions.resetPage) {
		return {
			...state,
			pageIndex: instance.initialState.pageIndex || 0,
		};
	}
	if (action.type === import_react_table7.actions.gotoPage) {
		const { pageCount, page } = instance;
		const newPageIndex = (0, import_react_table7.functionalUpdate)(
			action.pageIndex,
			state.pageIndex
		);
		let canNavigate = false;
		if (newPageIndex > state.pageIndex) {
			canNavigate =
				pageCount === -1
					? page.length >= state.pageSize
					: newPageIndex < pageCount;
		} else if (newPageIndex < state.pageIndex) {
			canNavigate = newPageIndex > -1;
		}
		if (!canNavigate) {
			return state;
		}
		return {
			...state,
			pageIndex: newPageIndex,
		};
	}
	if (action.type === import_react_table7.actions.setPageSize) {
		const { pageSize } = action;
		const topRowIndex = state.pageSize * state.pageIndex;
		const pageIndex = Math.floor(topRowIndex / pageSize);
		return {
			...state,
			pageIndex,
			pageSize,
		};
	}
}
function useInstance6(instance) {
	const {
		rows,
		autoResetPage = true,
		manualExpandedKey = "expanded",
		plugins,
		pageCount: userPageCount,
		paginateExpandedRows = true,
		expandSubRows = true,
		disablePagination,
		state: { pageIndex, expanded, globalFilter, filters, groupBy, sortBy },
		dispatch,
		data,
		manualPagination,
		// User-specified row count when using manual pagination. Takes precedence over pageCount.
		rowCount: userRowCount,
	} = instance;
	(0, import_react_table7.ensurePluginOrder)(
		plugins,
		["useGlobalFilter", "useFilters", "useGroupBy", "useSortBy", "useExpanded"],
		"usePagination"
	);
	const getAutoResetPage = (0, import_react_table7.useGetLatest)(autoResetPage);
	(0, import_react_table7.useMountedLayoutEffect)(() => {
		if (getAutoResetPage()) {
			dispatch({ type: import_react_table7.actions.resetPage });
		}
	}, [
		dispatch,
		manualPagination ? null : data,
		globalFilter,
		filters,
		groupBy,
		sortBy,
	]);
	const pageSize = disablePagination ? rows.length : instance.state.pageSize;
	let pageCount;
	if (manualPagination) {
		pageCount =
			userRowCount != null && userRowCount >= 0
				? Math.ceil(userRowCount / pageSize)
				: userPageCount;
	} else {
		pageCount = Math.ceil(rows.length / pageSize);
	}
	const pageOptions = React8.useMemo(
		() =>
			pageCount > 0
				? [...new Array(pageCount)].fill(null).map((d, i) => i)
				: [],
		[pageCount]
	);
	const [page, pageRowCount] = React8.useMemo(() => {
		let page2;
		if (manualPagination) {
			page2 = rows;
		} else {
			const pageStart = pageSize * pageIndex;
			const pageEnd = pageStart + pageSize;
			page2 = rows.slice(pageStart, pageEnd);
		}
		const pageRowCount2 = page2.length;
		if (paginateExpandedRows) {
			return [page2, pageRowCount2];
		}
		return [
			expandRows(page2, { manualExpandedKey, expanded, expandSubRows }),
			pageRowCount2,
		];
	}, [
		expandSubRows,
		expanded,
		manualExpandedKey,
		manualPagination,
		pageIndex,
		pageSize,
		paginateExpandedRows,
		rows,
	]);
	const canPreviousPage = pageIndex > 0;
	const canNextPage =
		pageCount === -1 ? page.length >= pageSize : pageIndex < pageCount - 1;
	const gotoPage2 = React8.useCallback(
		(pageIndex2) => {
			dispatch({
				type: import_react_table7.actions.gotoPage,
				pageIndex: pageIndex2,
			});
		},
		[dispatch]
	);
	const previousPage = React8.useCallback(() => {
		return gotoPage2((old) => old - 1);
	}, [gotoPage2]);
	const nextPage = React8.useCallback(() => {
		return gotoPage2((old) => old + 1);
	}, [gotoPage2]);
	const setPageSize2 = React8.useCallback(
		(pageSize2) => {
			dispatch({
				type: import_react_table7.actions.setPageSize,
				pageSize: pageSize2,
			});
		},
		[dispatch]
	);
	Object.assign(instance, {
		pageOptions,
		pageCount,
		page,
		pageRowCount,
		canPreviousPage,
		canNextPage,
		gotoPage: gotoPage2,
		previousPage,
		nextPage,
		setPageSize: setPageSize2,
	});
}
function expandRows(
	rows,
	{ manualExpandedKey, expanded, expandSubRows = true }
) {
	const expandedRows = [];
	const handleRow = (row, addToExpandedRows = true) => {
		row.isExpanded =
			(row.original && row.original[manualExpandedKey]) || expanded[row.id];
		row.canExpand = row.subRows && !!row.subRows.length;
		if (addToExpandedRows) {
			expandedRows.push(row);
		}
		if (row.subRows && row.subRows.length && row.isExpanded) {
			row.subRows.forEach((row2) => handleRow(row2, expandSubRows));
		}
	};
	rows.forEach((row) => handleRow(row));
	return expandedRows;
}

// tmp/reactable/srcjs/useMeta.js
import React9 from "react";
function useMeta(initialMeta = {}) {
	const [meta, setRawMeta] = React9.useState(initialMeta);
	const setMeta2 = (meta2) => {
		if (meta2 == null) {
			setRawMeta({});
			return;
		}
		if (typeof meta2 !== "object" && typeof meta2 !== "function") {
			throw new Error("meta must be an object or function");
		}
		setRawMeta((prevMeta) => {
			if (typeof meta2 === "function") {
				meta2 = meta2(prevMeta);
			}
			const newMeta = { ...prevMeta, ...meta2 };
			for (let [key, value] of Object.entries(newMeta)) {
				if (value === void 0) {
					delete meta2[key];
				}
			}
			return newMeta;
		});
	};
	return [meta, setMeta2];
}

// tmp/reactable/srcjs/columns.js
import React10, { Fragment } from "react";

// tmp/reactable/srcjs/aggregators.js
function sum(values) {
	const numbers = omitMissingNumbers(values);
	if (numbers.length === 0) {
		return 0;
	}
	const result2 = numbers.reduce((a, b) => a + b, 0);
	return round(result2, 12);
}
function mean(values) {
	const numbers = omitMissingNumbers(values);
	if (numbers.length === 0) {
		return NaN;
	}
	const result2 = sum(numbers) / numbers.length;
	return round(result2, 12);
}
function maxNumber(values) {
	const numbers = omitMissingNumbers(values);
	if (numbers.length === 0) {
		return NaN;
	}
	return Math.max.apply(null, numbers);
}
function minNumber(values) {
	const numbers = omitMissingNumbers(values);
	if (numbers.length === 0) {
		return NaN;
	}
	return Math.min.apply(null, numbers);
}
function median(values) {
	const numbers = omitMissingNumbers(values);
	if (numbers.length === 0) {
		return NaN;
	}
	numbers.sort((a, b) => a - b);
	if (numbers.length % 2 === 1) {
		return numbers[(numbers.length - 1) / 2];
	} else {
		return mean(numbers.slice(numbers.length / 2 - 1, numbers.length / 2 + 1));
	}
}
function max(values) {
	let maxValue;
	values.forEach((value) => {
		if (maxValue == null || value > maxValue) {
			maxValue = value;
		}
	});
	return maxValue;
}
function min(values) {
	let minValue;
	values.forEach((value) => {
		if (minValue == null || value < minValue) {
			minValue = value;
		}
	});
	return minValue;
}
function count(values) {
	return values.length;
}
function unique(values) {
	return [...new Set(values)].join(", ");
}
function frequency(values) {
	const counts = {};
	values.forEach((value) => {
		counts[value] = counts[value] || 0;
		counts[value] += 1;
	});
	const strs = Object.keys(counts).map((val) => {
		return val + (counts[val] > 1 ? ` (${counts[val]})` : "");
	});
	return strs.join(", ");
}
var numericAggregators = {
	mean,
	sum,
	max: maxNumber,
	min: minNumber,
	median,
};
var defaultAggregators = {
	max,
	min,
	count,
	unique,
	frequency,
};
function getAggregateFunction(name, type) {
	if (type === "numeric" && numericAggregators[name]) {
		return numericAggregators[name];
	}
	return defaultAggregators[name];
}
function round(n, digits = 3) {
	if (!Number.isFinite(n)) {
		return n;
	}
	digits = digits > 0 ? digits : 0;
	const c = Math.pow(10, digits);
	return (Math.sign(n) * Math.round(Math.abs(n) * c)) / c;
}
function omitMissingNumbers(values) {
	return values.filter((n) => n != null && !Number.isNaN(n));
}

// tmp/reactable/srcjs/columns.js
var emptyValue = "\u200B";
var subRowsKey = ".subRows";
var rowSelectedKey = ".selected";
var rowExpandedKey = ".expanded";
var rowStateKey = "__state";
function getSubRows(row) {
	return row[subRowsKey] || [];
}
function normalizeColumnData(data, columns) {
	for (let col of columns) {
		if (col.type === "numeric" && data[col.id]) {
			convertJSONNumbers(data[col.id]);
		}
	}
	return columnsToRows(data);
}
function convertJSONNumbers(arr) {
	for (let i = 0; i < arr.length; i++) {
		let n = arr[i];
		if (typeof n === "number" || n == null) {
			continue;
		}
		if (n === "NA") {
			n = null;
		} else if (n === "NaN") {
			n = NaN;
		} else if (n === "Inf") {
			n = Infinity;
		} else if (n === "-Inf") {
			n = -Infinity;
		} else {
			n = Number(n);
		}
		arr[i] = n;
	}
}
function columnsToRows(columns) {
	const names = Object.keys(columns);
	if (names.length === 0) {
		return [];
	}
	if (columns[rowStateKey]) {
		columns[rowStateKey] = normalizeColumnData(
			columns[rowStateKey],
			numericRowStateColumns
		);
	}
	const rows = new Array(columns[names[0]].length);
	for (let i = 0; i < rows.length; i++) {
		rows[i] = {};
		for (let name of names) {
			const value = columns[name][i];
			if (name === subRowsKey) {
				if (value instanceof Object) {
					rows[i][name] = columnsToRows(value);
				}
			} else {
				rows[i][name] = value;
			}
		}
	}
	return rows;
}
var numericRowStateColumns = [{ id: "index", type: "numeric" }];
function materializedRowsToData(rows, paginateSubRows) {
	const parentRowIds = {};
	return rows.map((row) => {
		let parentId;
		let subRowCount;
		if (paginateSubRows) {
			parentId = parentRowIds[row.id];
			subRowCount = row.subRows.length;
			row.subRows.forEach((subRow) => {
				parentRowIds[subRow.id] = row.id;
			});
		}
		const rowState = {
			id: row.id,
			index: row.index,
			grouped: row.isGrouped ? true : null,
			parentId,
			subRowCount,
			// Currently unused
			expanded: row.isExpanded ? true : null,
			selected: row.isSelected ? true : null,
		};
		removeEmptyProps(rowState);
		const dataRow = { ...row.values, [rowStateKey]: rowState };
		if (!paginateSubRows) {
			if (row.subRows && row.subRows.length > 0) {
				dataRow[subRowsKey] = materializedRowsToData(row.subRows);
			}
		}
		return dataRow;
	});
}
function RawHTML({ html, className, ...props }) {
	return /* @__PURE__ */ React10.createElement("div", {
		className: classNames("rt-text-content", className),
		dangerouslySetInnerHTML: { __html: html },
		...props,
	});
}
function buildColumnDefs(columns, groups, tableProps = {}) {
	const {
		sortable,
		defaultSortDesc,
		showSortIcon,
		showSortable,
		filterable,
		resizable,
	} = tableProps;
	columns = columns.map((column2) => {
		let col = { ...column2 };
		col.accessor = (row) => row[col.id];
		if (typeof col.aggregate === "string") {
			col.aggregate = getAggregateFunction(col.aggregate, col.type);
		}
		const sortMethod = createCompareFunction({
			type: col.type,
			naLast: col.sortNALast,
		});
		col.sortType = function sortType(a, b, id, desc) {
			return sortMethod(a.values[id], b.values[id], desc);
		};
		col.sortable = getFirstDefined(col.sortable, sortable);
		col.disableSortBy = !col.sortable;
		col.defaultSortDesc = getFirstDefined(col.defaultSortDesc, defaultSortDesc);
		col.sortDescFirst = col.defaultSortDesc;
		col.filterable = getFirstDefined(col.filterable, filterable);
		col.disableFilters = !col.filterable;
		if (col.searchable === false) {
			col.disableGlobalFilter = true;
		}
		if (col.show === false && col.searchable !== true) {
			col.disableGlobalFilter = true;
		}
		if (col.type === "numeric") {
			col.createMatcher = createStartsWithMatcher;
		} else {
			col.createMatcher = createSubstringMatcher;
		}
		col.filter = (rows, columnIds, filterValue) => {
			const id = columnIds[0];
			if (typeof col.filterMethod === "function") {
				return col.filterMethod(rows, id, filterValue);
			}
			const match2 = col.createMatcher(filterValue);
			return rows.filter((row) => {
				const value = row.values[id];
				return match2(value);
			});
		};
		if (col.type === "numeric") {
			col.align = col.align || "right";
		} else {
			col.align = col.align || "left";
		}
		col.vAlign = col.vAlign || "top";
		col.headerVAlign = col.headerVAlign || "top";
		const { width, minWidth, maxWidth } = col;
		col.minWidth = getFirstDefined(width, minWidth, 100);
		col.maxWidth = getFirstDefined(width, maxWidth, Number.MAX_SAFE_INTEGER);
		col.minWidth = Math.min(col.minWidth, col.maxWidth);
		col.width = col.minWidth;
		col.resizable = getFirstDefined(col.resizable, resizable);
		if (col.minWidth === col.maxWidth) {
			col.resizable = false;
		}
		col.disableResizing = !col.resizable;
		col.Cell = function Cell(cellInfo, state) {
			let value = cellInfo.value;
			const isMissingValue = value == null || Number.isNaN(value);
			if (isMissingValue) {
				value = col.na;
			}
			if (!isMissingValue && col.format && col.format.cell) {
				value = formatValue(value, col.format.cell);
			}
			if (col.cell) {
				if (typeof col.cell === "function") {
					value = col.cell({ ...cellInfo, value }, state);
				}
				if (Array.isArray(col.cell) && !cellInfo.aggregated) {
					value = col.cell[cellInfo.index];
					if (value) {
						value = hydrate({ Fragment, WidgetContainer }, value);
					}
				}
			}
			if (value == null || value === "") {
				value = emptyValue;
			}
			let content;
			if (React10.isValidElement(value)) {
				content = value;
			} else if (col.html) {
				content = /* @__PURE__ */ React10.createElement(RawHTML, {
					style: { display: "inline" },
					html: value,
				});
			} else {
				content = String(value);
			}
			return content;
		};
		if (col.grouped) {
			col.Grouped = function Grouped(cellInfo, state) {
				let value = cellInfo.value;
				const isMissingValue = value == null || Number.isNaN(value);
				if (isMissingValue) {
					value = col.na;
				}
				if (!isMissingValue && col.format && col.format.cell) {
					value = formatValue(value, col.format.cell);
				}
				value = col.grouped({ ...cellInfo, value }, state);
				if (value == null || value === "") {
					value = emptyValue;
				}
				let content;
				if (React10.isValidElement(value)) {
					content = value;
				} else if (col.html) {
					content = /* @__PURE__ */ React10.createElement(RawHTML, {
						style: { display: "inline" },
						html: value,
					});
				} else {
					content = String(value);
				}
				return content;
			};
		} else {
			col.Grouped = function Grouped(cellInfo, state) {
				const value = col.Cell(cellInfo, state);
				return /* @__PURE__ */ React10.createElement(
					React10.Fragment,
					null,
					value,
					cellInfo.subRows && ` (${cellInfo.subRows.length})`
				);
			};
		}
		col.Aggregated = function Aggregated(cellInfo, state) {
			let value = cellInfo.value;
			if (value != null && col.format && col.format.aggregated) {
				value = formatValue(value, col.format.aggregated);
			}
			if (col.aggregated) {
				value = col.aggregated({ ...cellInfo, value }, state);
			}
			if (value == null) {
				value = "";
			}
			let content;
			if (React10.isValidElement(value)) {
				content = value;
			} else if (col.html) {
				return /* @__PURE__ */ React10.createElement(RawHTML, { html: value });
			} else {
				content = String(value);
			}
			return content;
		};
		col.Header = function Header(column3, state) {
			let header = col.name;
			if (col.header != null) {
				if (typeof col.header === "function") {
					header = col.header(column3, state);
				} else {
					header = hydrate({ Fragment, WidgetContainer }, col.header);
				}
			}
			let content;
			if (React10.isValidElement(header)) {
				content = header;
			} else if (col.html) {
				content = /* @__PURE__ */ React10.createElement(RawHTML, {
					html: header,
				});
			} else {
				content = header != null ? String(header) : "";
			}
			if (col.sortable && showSortIcon) {
				const sortClass = showSortable ? "rt-sort" : "";
				content = col.html
					? content
					: /* @__PURE__ */ React10.createElement(
						"div",
						{ className: "rt-text-content" },
						content
					);
				if (col.align === "right") {
					return /* @__PURE__ */ React10.createElement(
						"div",
						{ className: "rt-sort-header" },
						/* @__PURE__ */ React10.createElement("span", {
							className: classNames(sortClass, "rt-sort-left"),
							"aria-hidden": "true",
						}),
						content
					);
				} else {
					return /* @__PURE__ */ React10.createElement(
						"div",
						{ className: "rt-sort-header" },
						content,
						/* @__PURE__ */ React10.createElement("span", {
							className: classNames(sortClass, "rt-sort-right"),
							"aria-hidden": "true",
						})
					);
				}
			}
			return content;
		};
		if (col.footer != null) {
			col.Footer = function Footer(column3, state) {
				let footer;
				if (typeof col.footer === "function") {
					footer = col.footer(column3, state);
				} else {
					footer = hydrate({ Fragment, WidgetContainer }, col.footer);
				}
				if (React10.isValidElement(footer)) {
					return footer;
				} else if (col.html) {
					return /* @__PURE__ */ React10.createElement(RawHTML, {
						html: footer,
					});
				} else {
					return footer != null ? String(footer) : "";
				}
			};
		} else {
			col.Footer = emptyValue;
		}
		const colAlignClass = getAlignClass(col.align);
		const cellVAlignClass = getVAlignClass(col.vAlign);
		const headerVAlignClass = getVAlignClass(col.headerVAlign);
		col.headerClassName = classNames(
			colAlignClass,
			headerVAlignClass,
			col.headerClassName
		);
		col.footerClassName = classNames(
			colAlignClass,
			cellVAlignClass,
			col.footerClassName
		);
		col.getProps = (rowInfo, column3, state) => {
			let props = {
				className: classNames(colAlignClass, cellVAlignClass),
			};
			if (col.className) {
				let className;
				if (typeof col.className === "function") {
					className = col.className(rowInfo, column3, state);
				} else if (Array.isArray(col.className)) {
					className = col.className[rowInfo.index];
				} else {
					className = col.className;
				}
				props.className = classNames(props.className, className);
			}
			if (col.style) {
				let style;
				if (typeof col.style === "function") {
					style = col.style(rowInfo, column3, state);
				} else if (Array.isArray(col.style)) {
					style = col.style[rowInfo.index];
				} else {
					style = col.style;
				}
				props.style = style;
			}
			return props;
		};
		return col;
	});
	if (groups) {
		columns = addColumnGroups(columns, groups);
		columns.forEach((col, i) => {
			col.id = `group_${i}`;
			if (col.name != null || col.header != null) {
				col.Header = function Header(column2, state) {
					let header = col.name;
					if (col.header) {
						if (typeof col.header === "function") {
							header = col.header(column2, state);
						} else {
							header = hydrate({ Fragment, WidgetContainer }, col.header);
						}
					}
					if (React10.isValidElement(header)) {
						return header;
					} else if (col.html) {
						return /* @__PURE__ */ React10.createElement(RawHTML, {
							html: header,
						});
					} else {
						return header != null ? String(header) : "";
					}
				};
			} else {
				col.Header = emptyValue;
			}
			const leafColumns = getLeafColumns(col);
			if (leafColumns.every((col2) => col2.disableResizing)) {
				col.disableResizing = true;
			}
			col.align = col.align || "center";
			col.headerVAlign = col.headerVAlign || "top";
			const colAlignClass = getAlignClass(col.align);
			const headerVAlignClass = getVAlignClass(col.headerVAlign);
			col.headerClassName = classNames(
				colAlignClass,
				headerVAlignClass,
				col.headerClassName
			);
		});
	}
	return columns;
}
function addColumnGroups(columns, groups) {
	groups.forEach((group) => {
		group = { ...group };
		const groupIds = group.columns;
		group.columns = [];
		columns = columns.reduce((newCols2, col) => {
			if (col.id === groupIds[0]) {
				newCols2.push(group);
				group.columns.push(col);
			} else if (groupIds.includes(col.id)) {
				group.columns.push(col);
			} else {
				newCols2.push(col);
			}
			return newCols2;
		}, []);
	});
	const newCols = [];
	let lastGroup;
	columns.forEach((col) => {
		if (col.columns) {
			newCols.push(col);
			lastGroup = null;
		} else {
			if (!lastGroup) {
				lastGroup = { columns: [], isUngrouped: true };
				newCols.push(lastGroup);
			}
			lastGroup.columns.push(col);
		}
	});
	columns = newCols;
	return columns;
}
function createCompareFunction({ type, naLast } = {}) {
	return function compare(a, b, desc) {
		if (type === "numeric") {
			a = Number.isNaN(a) ? null : a;
			b = Number.isNaN(b) ? null : b;
		} else {
			a = typeof a === "string" ? a.toLowerCase() : a;
			b = typeof b === "string" ? b.toLowerCase() : b;
		}
		if (a === b) {
			return 0;
		}
		if (a == null) {
			if (naLast) return desc ? -1 : 1;
			return -1;
		}
		if (b == null) {
			if (naLast) return desc ? 1 : -1;
			return 1;
		}
		if (a > b) {
			return 1;
		}
		if (a < b) {
			return -1;
		}
		return 0;
	};
}
function formatValue(value, options) {
	let {
		prefix: prefix2,
		suffix,
		digits,
		separators,
		percent,
		currency,
		datetime,
		date,
		time,
		hour12,
		locales,
	} = options;
	if (typeof value === "number") {
		if (separators || percent || currency || digits != null || locales) {
			let maximumFractionDigits = 18;
			const options2 = { useGrouping: separators ? true : false };
			if (percent) {
				options2.style = "percent";
				maximumFractionDigits = 12;
			}
			if (currency) {
				options2.style = "currency";
				options2.currency = currency;
			} else if (digits != null) {
				options2.minimumFractionDigits = Math.min(
					digits,
					maximumFractionDigits
				);
				options2.maximumFractionDigits = Math.min(
					digits,
					maximumFractionDigits
				);
			} else {
				options2.maximumFractionDigits = maximumFractionDigits;
			}
			value = value.toLocaleString(locales || void 0, options2);
		}
	}
	if (datetime || date || time) {
		locales = locales || void 0;
		const options2 = {};
		if (hour12 != null) {
			options2.hour12 = hour12;
		}
		if (datetime) {
			value = new Date(value).toLocaleString(locales, options2);
		} else if (date) {
			if (value.includes("-") && !value.includes("T") && !value.includes("Z")) {
				value = value.replace(/-/g, "/");
			}
			value = new Date(value).toLocaleDateString(locales, options2);
		} else if (time) {
			value = new Date(value).toLocaleTimeString(locales, options2);
		}
	}
	if (prefix2 != null) {
		value = value != null ? value : "";
		value = String(prefix2) + value;
	}
	if (suffix != null) {
		value = value != null ? value : "";
		value = value + String(suffix);
	}
	return value;
}
function createStartsWithMatcher(str) {
	const regex = new RegExp("^" + escapeRegExp(str), "i");
	return (value) => {
		if (value === void 0) {
			return false;
		}
		return regex.test(value);
	};
}
function createSubstringMatcher(str) {
	const regex = new RegExp(escapeRegExp(str), "i");
	return (value) => {
		if (value === void 0) {
			return false;
		}
		return regex.test(value);
	};
}
function getAlignClass(align) {
	return `rt-align-${align}`;
}
function getVAlignClass(vAlign) {
	if (vAlign === "top") {
		return "";
	}
	return `rt-valign-${vAlign}`;
}

// tmp/reactable/srcjs/Reactable.js
function hydrate2(components, tag) {
	console.log("tag");
	console.log(tag);
	if (React11.isValidElement(tag)) {
		console.log("skipping");
		return tag;
	}
	if (typeof tag === "string") return tag;
	if (tag.name[0] === tag.name[0].toUpperCase() && !components[tag.name]) {
		throw new Error("Unknown component: " + tag.name);
	}
	const elem = components[tag.name] || tag.name;
	const args = [elem, tag.attribs];
	for (let child of tag.children) {
		args.push(hydrate2(components, child));
	}
	return React11.createElement(...args);
}
var tableInstances = {};
function getInstance(tableId) {
	if (!tableId) {
		throw new Error("A reactable table ID must be provided");
	}
	const getInstance2 = tableInstances[tableId];
	if (!getInstance2) {
		throw new Error(`reactable instance '${tableId}' not found`);
	}
	return getInstance2();
}
function getState(tableId) {
	return getInstance(tableId).state;
}
function setFilter(tableId, columnId, value) {
	getInstance(tableId).setFilter(columnId, value);
}
function setAllFilters(tableId, value) {
	getInstance(tableId).setAllFilters(value);
}
function setSearch(tableId, value) {
	getInstance(tableId).setGlobalFilter(value);
}
function toggleGroupBy(tableId, columnId, isGrouped) {
	getInstance(tableId).toggleGroupBy(columnId, isGrouped);
}
function setGroupBy(tableId, columnIds) {
	getInstance(tableId).setGroupBy(columnIds);
}
function toggleAllRowsExpanded(tableId, isExpanded) {
	getInstance(tableId).toggleAllRowsExpanded(isExpanded);
}
function downloadDataCSV(tableId, filename = "data.csv", options = {}) {
	getInstance(tableId).downloadDataCSV(filename, options);
}
function getDataCSV(tableId, options = {}) {
	return getInstance(tableId).getDataCSV(options);
}
function setMeta(tableId, meta) {
	getInstance(tableId).setMeta(meta);
}
function toggleHideColumn(tableId, columnId, isHidden) {
	getInstance(tableId).toggleHideColumn(columnId, isHidden);
}
function setHiddenColumns(tableId, columns) {
	getInstance(tableId).setHiddenColumns(columns);
}
function setData(tableId, data, options) {
	getInstance(tableId).setData(data, options);
}
function onStateChange(tableId, listenerFn) {
	return getInstance(tableId).onStateChange(listenerFn);
}
function gotoPage(tableId, pageIndex) {
	getInstance(tableId).gotoPage(pageIndex);
}
function setPageSize(tableId, pageSize) {
	getInstance(tableId).setPageSize(pageSize);
}
function Reactable({
	data,
	columns,
	columnGroups,
	sortable,
	defaultSortDesc,
	showSortIcon,
	showSortable,
	filterable,
	resizable,
	theme,
	language,
	dataKey,
	...rest
}) {
	data = normalizeColumnData(data, columns);
	columns = buildColumnDefs(columns, columnGroups, {
		sortable,
		defaultSortDesc,
		showSortIcon,
		showSortable,
		filterable,
		resizable,
	});
	theme = createTheme(theme) || {};
	language = { ...defaultLanguage, ...language };
	for (let key in language) {
		language[key] = language[key] || null;
	}
	return /* @__PURE__ */ React11.createElement(Table, {
		data,
		columns,
		theme,
		language,
		key: dataKey,
		...rest,
	});
}
function useMemoizedObject(obj) {
	const objStr = JSON.stringify(obj);
	return React11.useMemo(() => {
		return obj;
	}, [objStr]);
}
function ReactableData({
	data,
	columns,
	columnGroups,
	sortable,
	defaultSortDesc,
	showSortIcon,
	showSortable,
	filterable,
	resizable,
	// Controlled state
	sortBy,
	filters,
	searchValue,
	groupBy,
	expanded,
	selectedRowIds,
	...rest
}) {
	data = React11.useMemo(
		() => normalizeColumnData(data, columns),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[]
	);
	columns = React11.useMemo(
		() =>
			buildColumnDefs(columns, columnGroups, {
				sortable,
				defaultSortDesc,
				showSortIcon,
				showSortable,
				filterable,
				resizable,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[]
	);
	sortBy = useMemoizedObject(sortBy || []);
	filters = useMemoizedObject(filters || []);
	groupBy = useMemoizedObject(groupBy || []);
	expanded = useMemoizedObject(expanded || {});
	selectedRowIds = useMemoizedObject(selectedRowIds || {});
	return /* @__PURE__ */ React11.createElement(TableData, {
		data,
		columns,
		sortBy,
		filters,
		searchValue,
		groupBy,
		expanded,
		selectedRowIds,
		...rest,
	});
}
var RootComponent = React11.forwardRef(function RootComponent2(
	{ className, ...rest },
	ref
) {
	return /* @__PURE__ */ React11.createElement("div", {
		ref,
		className: classNames("Reactable", "ReactTable", className),
		...rest,
	});
});
var TableComponent = React11.forwardRef(function TableComponent2(
	{ className, ...rest },
	ref
) {
	return /* @__PURE__ */ React11.createElement("div", {
		ref,
		className: classNames("rt-table", className),
		role: "table",
		...rest,
	});
});
function TheadComponent({ className, ...rest }) {
	return /* @__PURE__ */ React11.createElement("div", {
		className: classNames("rt-thead", className),
		role: "rowgroup",
		...rest,
	});
}
function TbodyComponent({ className, ...rest }) {
	return /* @__PURE__ */ React11.createElement("div", {
		className: classNames("rt-tbody", className),
		role: "rowgroup",
		...rest,
	});
}
function TfootComponent({ className, ...rest }) {
	return /* @__PURE__ */ React11.createElement("div", {
		className: classNames("rt-tfoot", className),
		role: "rowgroup",
		...rest,
	});
}
function TrGroupComponent({ className, ...rest }) {
	return /* @__PURE__ */ React11.createElement("div", {
		className: classNames("rt-tr-group", className),
		...rest,
	});
}
function TrComponent({ className, ...rest }) {
	return /* @__PURE__ */ React11.createElement("div", {
		className: classNames("rt-tr", className),
		role: "row",
		...rest,
	});
}
var ThComponent = React11.forwardRef(function ThComponent2(props, ref) {
	let {
		canSort,
		sortDescFirst,
		isSorted,
		isSortedDesc,
		toggleSortBy,
		canResize,
		isResizing,
		className,
		innerClassName,
		children,
		...thProps
	} = props;
	const [skipNextSort, setSkipNextSort] = React11.useState(false);
	if (canSort) {
		const currentSortOrder = isSorted
			? isSortedDesc
				? "descending"
				: "ascending"
			: "none";
		const defaultSortOrder = sortDescFirst ? "descending" : "ascending";
		const toggleSort = (isMultiSort) => {
			let sortDesc = isSorted ? !isSortedDesc : sortDescFirst;
			if (isMultiSort) {
				sortDesc = null;
			}
			toggleSortBy && toggleSortBy(sortDesc, isMultiSort);
		};
		thProps = {
			...thProps,
			"aria-sort": currentSortOrder,
			tabIndex: "0",
			onClick: (e) => {
				if (!skipNextSort) {
					toggleSort(e.shiftKey);
				}
			},
			onKeyPress: (e) => {
				const keyCode = e.which || e.keyCode;
				if (keyCode === 13 || keyCode === 32) {
					toggleSort(e.shiftKey);
				}
			},
			onMouseUp: () => {
				if (isResizing) {
					setSkipNextSort(true);
				} else {
					setSkipNextSort(false);
				}
			},
			onMouseDown: (e) => {
				if (e.detail > 1 || e.shiftKey) {
					e.preventDefault();
				}
			},
			// Focus indicator for keyboard navigation
			"data-sort-hint": isSorted ? null : defaultSortOrder,
		};
	}
	return /* @__PURE__ */ React11.createElement(
		"div",
		{
			className: classNames("rt-th", canResize && "rt-th-resizable", className),
			role: "columnheader",
			ref,
			...thProps,
		},
		/* @__PURE__ */ React11.createElement(
			"div",
			{ className: classNames("rt-th-inner", innerClassName) },
			children
		)
	);
});
ThComponent.propTypes = {
	defaultSortOrder: import_prop_types3.default.string,
	canSort: import_prop_types3.default.bool,
	sortDescFirst: import_prop_types3.default.bool,
	isSorted: import_prop_types3.default.bool,
	isSortedDesc: import_prop_types3.default.bool,
	toggleSortBy: import_prop_types3.default.func,
	canResize: import_prop_types3.default.bool,
	isResizing: import_prop_types3.default.bool,
	className: import_prop_types3.default.string,
	innerClassName: import_prop_types3.default.string,
	children: import_prop_types3.default.node,
};
function TdComponent({ className, innerClassName, children, ...rest }) {
	return /* @__PURE__ */ React11.createElement(
		"div",
		{ className: classNames("rt-td", className), role: "cell", ...rest },
		/* @__PURE__ */ React11.createElement(
			"div",
			{ className: classNames("rt-td-inner", innerClassName) },
			children
		)
	);
}
function getCellTheme(style) {
	if (!style) {
		return {};
	}
	if (style.padding != null) {
		const { padding, ...cellStyle } = style;
		return {
			className: css(cellStyle),
			innerClassName: css({ padding }),
		};
	}
	return { className: css(style) };
}
function ResizerComponent({ onMouseDown, onTouchStart, className, ...rest }) {
	return /* @__PURE__ */ React11.createElement("div", {
		className: classNames("rt-resizer", className),
		onMouseDown,
		onTouchStart,
		"aria-hidden": true,
		...rest,
	});
}
ResizerComponent.propTypes = {
	onMouseDown: import_prop_types3.default.func,
	onTouchStart: import_prop_types3.default.func,
	className: import_prop_types3.default.string,
};
var RowDetails = class extends React11.Component {
	componentDidMount() {
		if (window.Shiny && window.Shiny.bindAll) {
			window.Shiny.bindAll(this.el);
		}
	}
	componentWillUnmount() {
		if (window.Shiny && window.Shiny.unbindAll) {
			window.Shiny.unbindAll(this.el);
		}
	}
	render() {
		const { children, html } = this.props;
		let props = { ref: (el) => (this.el = el) };
		if (html) {
			props = { ...props, dangerouslySetInnerHTML: { __html: html } };
		} else {
			props = { ...props, children };
		}
		return /* @__PURE__ */ React11.createElement("div", {
			className: "rt-tr-details",
			...props,
		});
	}
};
RowDetails.propTypes = {
	children: import_prop_types3.default.node,
	html: import_prop_types3.default.string,
};
function ExpanderComponent({ isExpanded, className, "aria-label": ariaLabel }) {
	return /* @__PURE__ */ React11.createElement(
		"button",
		{
			className: "rt-expander-button",
			"aria-label": ariaLabel,
			"aria-expanded": isExpanded ? "true" : "false",
		},
		/* @__PURE__ */ React11.createElement(
			"span",
			{
				className: classNames(
					"rt-expander",
					isExpanded && "rt-expander-open",
					className
				),
				tabIndex: "-1",
				"aria-hidden": "true",
			},
			"\u200B"
		)
	);
}
ExpanderComponent.propTypes = {
	isExpanded: import_prop_types3.default.bool,
	className: import_prop_types3.default.string,
	"aria-label": import_prop_types3.default.string,
};
function FilterComponent({
	filterValue,
	setFilter: setFilter2,
	className,
	placeholder,
	"aria-label": ariaLabel,
}) {
	return /* @__PURE__ */ React11.createElement("input", {
		type: "text",
		className: classNames("rt-filter", className),
		value: filterValue || "",
		onChange: (e) => setFilter2(e.target.value || void 0),
		placeholder,
		"aria-label": ariaLabel,
	});
}
FilterComponent.propTypes = {
	filterValue: import_prop_types3.default.string,
	setFilter: import_prop_types3.default.func.isRequired,
	className: import_prop_types3.default.string,
	placeholder: import_prop_types3.default.string,
	"aria-label": import_prop_types3.default.string,
};
function SearchComponent({
	searchValue,
	setSearch: setSearch2,
	className,
	placeholder,
	"aria-label": ariaLabel,
}) {
	return /* @__PURE__ */ React11.createElement("input", {
		type: "text",
		value: searchValue || "",
		onChange: (e) => setSearch2(e.target.value || void 0),
		className: classNames("rt-search", className),
		placeholder,
		"aria-label": ariaLabel,
	});
}
SearchComponent.propTypes = {
	searchValue: import_prop_types3.default.string,
	setSearch: import_prop_types3.default.func.isRequired,
	className: import_prop_types3.default.string,
	placeholder: import_prop_types3.default.string,
	"aria-label": import_prop_types3.default.string,
};
function NoDataComponent({ className, ...rest }) {
	return /* @__PURE__ */ React11.createElement("div", {
		className: classNames("rt-no-data", className),
		"aria-live": "assertive",
		...rest,
	});
}
function SelectInputComponent({
	type,
	checked,
	onChange,
	"aria-label": ariaLabel,
}) {
	return /* @__PURE__ */ React11.createElement(
		"div",
		{ className: "rt-select" },
		/* @__PURE__ */ React11.createElement("input", {
			type,
			checked,
			onChange,
			className: "rt-select-input",
			"aria-label": ariaLabel,
		}),
		"\u200B"
	);
}
SelectInputComponent.propTypes = {
	type: import_prop_types3.default.oneOf(["checkbox", "radio"]).isRequired,
	checked: import_prop_types3.default.bool,
	onChange: import_prop_types3.default.func,
	"aria-label": import_prop_types3.default.string,
};
function TableData({
	data,
	columns,
	groupBy,
	searchMethod,
	pagination,
	paginateSubRows,
	selection,
	crosstalkGroup,
	crosstalkId,
	setResolvedData,
	// Controlled state
	pageSize,
	pageIndex,
	sortBy,
	filters,
	searchValue,
	expanded,
	selectedRowIds,
}) {
	const dataColumns = React11.useMemo(
		() => columns.reduce((cols, col) => cols.concat(getLeafColumns(col)), []),
		[columns]
	);
	const globalFilter = React11.useMemo(() => {
		if (searchMethod) {
			return searchMethod;
		}
		return function globalFilter2(rows, columnIds, searchValue2) {
			const matchers = dataColumns.reduce((obj, col) => {
				obj[col.id] = col.createMatcher(searchValue2);
				return obj;
			}, {});
			rows = rows.filter((row) => {
				for (const id of columnIds) {
					const value = row.values[id];
					if (matchers[id](value)) {
						return true;
					}
				}
			});
			return rows;
		};
	}, [dataColumns, searchMethod]);
	const useRowSelectColumn = function useRowSelectColumn2(hooks) {
		if (selection) {
			hooks.visibleColumns.push((columns2) => {
				const selectionCol = {
					// Apply defaults from existing selection column
					...columns2.find((col) => col.selectable),
					selectable: true,
					// Disable sorting, filtering, and searching for selection columns
					disableSortBy: true,
					filterable: false,
					disableFilters: true,
					disableGlobalFilter: true,
				};
				return [selectionCol, ...columns2.filter((col) => !col.selectable)];
			});
		}
	};
	const useCrosstalkColumn = function useCrosstalkColumn2(hooks) {
		if (crosstalkGroup) {
			hooks.visibleColumns.push((columns2) => {
				const ctCol = {
					id: crosstalkId,
					filter: (rows, id, value) => {
						if (!value) {
							return rows;
						}
						return rows.filter((row) => {
							if (value.includes(row.index)) {
								return true;
							}
						});
					},
					disableGlobalFilter: true,
				};
				return columns2.concat(ctCol);
			});
			hooks.stateReducers.push((state) => {
				if (!state.hiddenColumns.includes(crosstalkId)) {
					return {
						...state,
						hiddenColumns: state.hiddenColumns.concat(crosstalkId),
					};
				}
				return state;
			});
		}
	};
	const instance = (0, import_react_table8.useTable)(
		{
			columns,
			data,
			useControlledState: (state) => {
				return React11.useMemo(
					() => ({
						...state,
						pageIndex,
						pageSize,
						sortBy,
						filters,
						globalFilter: searchValue,
						groupBy,
						expanded,
						selectedRowIds,
					}),
					// These dependencies are required for proper table updates
					// eslint-disable-next-line react-hooks/exhaustive-deps
					[
						state,
						pageIndex,
						pageSize,
						sortBy,
						filters,
						searchValue,
						groupBy,
						expanded,
						selectedRowIds,
					]
				);
			},
			globalFilter,
			paginateExpandedRows: paginateSubRows ? true : false,
			disablePagination: !pagination,
			getSubRows,
			// Disable manual row expansion
			manualExpandedKey: null,
			// Maintain grouped state when the data changes
			autoResetGroupBy: false,
			// Maintain sorted state when the data changes
			autoResetSortBy: false,
			// Maintain expanded state when groupBy, sortBy, defaultPageSize change.
			// Expanded state is still reset when the data changes via dataKey or updateReactable.
			autoResetExpanded: false,
			// Maintain filtered state when the data changes
			autoResetFilters: false,
			autoResetGlobalFilter: false,
			// Maintain selected state when groupBy, sortBy, defaultPageSize change.
			// Selected state is still reset when the data changes via dataKey or updateReactable.
			autoResetSelectedRows: false,
			// Maintain resized state when the data changes
			autoResetResize: false,
			// Reset current page when the data changes (e.g., sorting, filtering, searching)
			autoResetPage: true,
		},
		useResizeColumns,
		useFlexLayout,
		useStickyColumns,
		import_react_table8.useFilters,
		import_react_table8.useGlobalFilter,
		useGroupBy,
		import_react_table8.useSortBy,
		import_react_table8.useExpanded,
		usePagination,
		useRowSelect,
		useRowSelectColumn,
		useCrosstalkColumn
	);
	const maxRowCount = React11.useRef(
		paginateSubRows ? instance.flatRows.length : instance.rows.length
	);
	React11.useEffect(() => {
		maxRowCount.current = 0;
	}, [data]);
	React11.useEffect(() => {
		const rowCount = paginateSubRows
			? instance.flatRows.length
			: instance.rows.length;
		if (rowCount > maxRowCount.current) {
			maxRowCount.current = rowCount;
		}
	}, [paginateSubRows, instance.flatRows, instance.rows]);
	if (setResolvedData) {
		setResolvedData({
			data: materializedRowsToData(instance.page, paginateSubRows),
			rowCount: instance.rows.length,
			maxRowCount: maxRowCount.current,
		});
	}
	return null;
}
function Table({
	data: originalData,
	columns,
	groupBy,
	searchable,
	searchMethod,
	defaultSorted,
	pagination,
	paginationType,
	showPagination,
	showPageSizeOptions,
	showPageInfo,
	defaultPageSize,
	pageSizeOptions,
	minRows,
	paginateSubRows,
	defaultExpanded,
	selection,
	defaultSelected,
	selectionId,
	onClick,
	outlined,
	bordered,
	borderless,
	compact,
	nowrap,
	striped,
	highlight,
	className,
	style,
	rowClassName,
	rowStyle,
	inline,
	width,
	height,
	theme,
	language,
	meta: initialMeta,
	crosstalkKey,
	crosstalkGroup,
	crosstalkId,
	elementId,
	nested,
	dataURL,
	serverRowCount: initialServerRowCount,
	serverMaxRowCount: initialServerMaxRowCount,
}) {
	const [newData, setNewData] = React11.useState(null);
	const data = React11.useMemo(() => {
		return newData ? newData : originalData;
	}, [newData, originalData]);
	const useServerData = dataURL != null;
	const [serverRowCount, setServerRowCount] = React11.useState(
		initialServerRowCount
	);
	const [serverMaxRowCount, setServerMaxRowCount] = React11.useState(
		initialServerMaxRowCount
	);
	const dataColumns = React11.useMemo(() => {
		return columns.reduce((cols, col) => cols.concat(getLeafColumns(col)), []);
	}, [columns]);
	const globalFilter = React11.useMemo(() => {
		if (searchMethod) {
			return searchMethod;
		}
		return function globalFilter2(rows, columnIds, searchValue) {
			const matchers = dataColumns.reduce((obj, col) => {
				obj[col.id] = col.createMatcher(searchValue);
				return obj;
			}, {});
			rows = rows.filter((row) => {
				for (const id of columnIds) {
					const value = row.values[id];
					if (matchers[id](value)) {
						return true;
					}
				}
			});
			return rows;
		};
	}, [dataColumns, searchMethod]);
	const useRowSelectColumn = function useRowSelectColumn2(hooks) {
		if (selection) {
			hooks.visibleColumns.push((columns2) => {
				const selectionCol = {
					// Apply defaults from existing selection column
					...columns2.find((col) => col.selectable),
					selectable: true,
					// Disable sorting, filtering, and searching for selection columns
					disableSortBy: true,
					filterable: false,
					disableFilters: true,
					disableGlobalFilter: true,
				};
				return [selectionCol, ...columns2.filter((col) => !col.selectable)];
			});
		}
	};
	const useCrosstalkColumn = function useCrosstalkColumn2(hooks) {
		if (crosstalkGroup) {
			hooks.visibleColumns.push((columns2) => {
				const ctCol = {
					id: crosstalkId,
					filter: (rows, id, value) => {
						if (!value) {
							return rows;
						}
						return rows.filter((row) => {
							if (value.includes(row.index)) {
								return true;
							}
						});
					},
					disableGlobalFilter: true,
				};
				return columns2.concat(ctCol);
			});
			hooks.stateReducers.push((state2) => {
				if (!state2.hiddenColumns.includes(crosstalkId)) {
					return {
						...state2,
						hiddenColumns: state2.hiddenColumns.concat(crosstalkId),
					};
				}
				return state2;
			});
		}
	};
	const [meta, setMeta2] = useMeta(initialMeta);
	function useServerSideRows(hooks) {
		hooks.useInstance.push((instance2) => {
			const { rows, manualPagination, rowsById: rowsById2 } = instance2;
			if (!manualPagination) {
				return;
			}
			const setRowProps = (rows2) => {
				rows2.forEach((row) => {
					const rowState = row.original[rowStateKey];
					if (!rowState) {
						return;
					}
					row.index = rowState.index;
					if (rowState.selected) {
						row.original[rowSelectedKey] = rowState.selected;
					}
					if (rowState.expanded) {
						row.original[rowExpandedKey] = rowState.expanded;
					}
					if (rowState.grouped) {
						row.isGrouped = true;
					}
					if (rowState.parentId != null) {
						rowsById2[rowState.parentId].subRows.push(row);
						row.parentId = rowState.parentId;
					}
					if (!paginateSubRows) {
						setRowProps(row.subRows, row);
					}
				});
				if (paginateSubRows) {
					rows2.forEach((row) => {
						const rowState = row.original[rowStateKey];
						row.subRows.length = rowState.subRowCount;
					});
				}
			};
			setRowProps(rows);
		});
	}
	const getRowId = React11.useMemo(() => {
		const defaultGetRowId = (row, index, parent) => {
			return `${parent ? [parent.id, index].join(".") : index}`;
		};
		if (!useServerData) {
			return defaultGetRowId;
		}
		return (row, index, parent) => {
			if (row[rowStateKey]) {
				return row[rowStateKey].id;
			}
			return defaultGetRowId(row, index, parent);
		};
	}, [useServerData]);
	const { state, ...instance } = (0, import_react_table8.useTable)(
		{
			columns,
			data,
			initialState: {
				hiddenColumns: dataColumns
					.filter((col) => col.show === false)
					.map((col) => col.id),
				groupBy: groupBy || [],
				sortBy: defaultSorted || [],
				pageSize: defaultPageSize,
				selectedRowIds: defaultSelected
					? defaultSelected.reduce(
						(obj, index) => ({ ...obj, [index]: true }),
						{}
					)
					: {},
			},
			globalFilter,
			paginateExpandedRows: paginateSubRows ? true : false,
			disablePagination: !pagination,
			getSubRows,
			getRowId,
			// Maintain grouped state when the data changes
			autoResetGroupBy: false,
			// Maintain sorted state when the data changes
			autoResetSortBy: false,
			// Maintain expanded state when groupBy, sortBy, defaultPageSize change.
			// Expanded state is still reset when the data changes via dataKey or updateReactable.
			autoResetExpanded: false,
			// Maintain filtered state when the data changes
			autoResetFilters: false,
			autoResetGlobalFilter: false,
			// Maintain selected state when groupBy, sortBy, defaultPageSize change.
			// Selected state is still reset when the data changes via dataKey or updateReactable.
			autoResetSelectedRows: false,
			// Maintain resized state when the data changes
			autoResetResize: false,
			// Reset current page when the data changes (e.g., sorting, filtering, searching)
			autoResetPage: true,
			manualPagination: useServerData,
			manualSortBy: useServerData,
			manualGlobalFilter: useServerData,
			manualFilters: useServerData,
			manualGroupBy: useServerData,
			// TODO for when server-side row selection is implemented - need the ability to select all first
			// manualRowSelectedKey: useServerData ? rowSelectedKey : null,
			// TODO for when server-side row expansion is implemented
			// Disable manual row expansion
			manualExpandedKey: null,
			// Prevent duplicate sub rows when sub rows are paginated server-side
			expandSubRows: !(useServerData && paginateSubRows),
			rowCount: useServerData ? serverRowCount : null,
		},
		useServerSideRows,
		useResizeColumns,
		useFlexLayout,
		useStickyColumns,
		import_react_table8.useFilters,
		import_react_table8.useGlobalFilter,
		useGroupBy,
		import_react_table8.useSortBy,
		import_react_table8.useExpanded,
		usePagination,
		useRowSelect,
		useRowSelectColumn,
		useCrosstalkColumn
	);
	const skipInitialFetch = React11.useRef(initialServerRowCount != null);
	React11.useEffect(() => {
		if (!useServerData) {
			return;
		}
		if (skipInitialFetch.current) {
			skipInitialFetch.current = false;
			return;
		}
		const url = new window.URL(dataURL, window.location);
		const params = {
			pageIndex: state.pageIndex,
			pageSize: state.pageSize,
			sortBy: state.sortBy,
			filters: state.filters,
			searchValue: state.globalFilter,
			groupBy: state.groupBy,
			expanded: state.expanded,
			selectedRowIds: state.selectedRowIds,
		};
		window
			.fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(params),
			})
			.then((res) => res.json())
			.then((body) => {
				const data2 = normalizeColumnData(body.data, dataColumns);
				const { rowCount, maxRowCount: maxRowCount2 } = body;
				setNewData(data2);
				setServerRowCount(rowCount);
				setServerMaxRowCount(maxRowCount2);
			})
			.catch((err) => {
				console.error(err);
			});
	}, [
		useServerData,
		dataURL,
		state.pageIndex,
		state.pageSize,
		state.sortBy,
		state.filters,
		state.globalFilter,
		state.groupBy,
		state.expanded,
		state.selectedRowIds,
		dataColumns,
	]);
	(0, import_react_table8.useMountedLayoutEffect)(() => {
		const setSortBy = instance.setSortBy;
		setSortBy(defaultSorted || []);
	}, [instance.setSortBy, defaultSorted]);
	(0, import_react_table8.useMountedLayoutEffect)(() => {
		const setGroupBy2 = instance.setGroupBy;
		setGroupBy2(groupBy || []);
	}, [instance.setGroupBy, groupBy]);
	(0, import_react_table8.useMountedLayoutEffect)(() => {
		const setPageSize2 = instance.setPageSize;
		setPageSize2(defaultPageSize);
	}, [instance.setPageSize, defaultPageSize]);
	(0, import_react_table8.useMountedLayoutEffect)(() => {
		const setRowsSelected = instance.setRowsSelected;
		setRowsSelected((defaultSelected || []).map((index) => String(index)));
	}, [instance.setRowsSelected, defaultSelected]);
	const rowsById = instance.preFilteredRowsById || instance.rowsById;
	const selectedRowIndexes = React11.useMemo(() => {
		return Object.keys(state.selectedRowIds).reduce((indexes, id) => {
			const row = rowsById[id];
			if (row) {
				indexes.push(row.index);
			}
			return indexes;
		}, []);
	}, [state.selectedRowIds, rowsById]);
	React11.useEffect(() => {
		if (!selection) {
			return;
		}
		const selectedIndexes = selectedRowIndexes.map((index) => index + 1);
		if (selectionId && window.Shiny) {
			window.Shiny.onInputChange(selectionId, selectedIndexes);
		}
	}, [selectedRowIndexes, selection, selectionId]);
	const searchableRef = React11.useRef(searchable);
	(0, import_react_table8.safeUseLayoutEffect)(() => {
		if (searchableRef.current && !searchable) {
			const setGlobalFilter = instance.setGlobalFilter;
			setGlobalFilter(void 0);
		}
		searchableRef.current = searchable;
	}, [searchable, instance.setGlobalFilter]);
	const makeSearch = () => {
		if (!searchable) {
			return null;
		}
		return /* @__PURE__ */ React11.createElement(SearchComponent, {
			searchValue: state.globalFilter,
			setSearch: instance.setGlobalFilter,
			className: css(theme.searchInputStyle),
			placeholder: language.searchPlaceholder,
			"aria-label": language.searchLabel,
		});
	};
	const rowData = convertRowsToV6(instance.rows);
	const stateInfo = React11.useMemo(() => {
		return {
			...state,
			searchValue: state.globalFilter,
			meta,
			hiddenColumns: state.hiddenColumns.filter((id) => id !== crosstalkId),
			// For v6 compatibility
			sorted: state.sortBy,
			pageRows: convertRowsToV6(instance.page),
			sortedData: rowData,
			data,
			page: state.pageIndex,
			pageSize: state.pageSize,
			pages: instance.pageCount,
			selected: selectedRowIndexes,
		};
	}, [
		state,
		meta,
		crosstalkId,
		instance.page,
		rowData,
		data,
		instance.pageCount,
		selectedRowIndexes,
	]);
	const makeThead = () => {
		const theadProps = instance.getTheadProps();
		return /* @__PURE__ */ React11.createElement(
			TheadComponent,
			{ ...theadProps },
			makeHeaders(),
			makeFilters()
		);
	};
	const headerRefs = React11.useRef({});
	const handleHeader = (column2) => {
		column2.getDOMWidth = () => {
			return headerRefs.current[column2.id].getBoundingClientRect().width;
		};
		if (column2.headers && column2.headers.length) {
			column2.headers.forEach((col) => handleHeader(col));
		}
	};
	instance.headers.forEach(handleHeader);
	const makeHeaders = () => {
		return instance.headerGroups.map((headerGroup, i) => {
			const isGroupHeader = i < instance.headerGroups.length - 1;
			const { key: headerGroupKey, ...headerGroupProps } =
				headerGroup.getHeaderGroupProps({
					className: isGroupHeader ? "rt-tr-group-header" : "rt-tr-header",
				});
			return /* @__PURE__ */ React11.createElement(
				TrComponent,
				{ key: headerGroupKey, ...headerGroupProps },
				headerGroup.headers.map((column2) => {
					column2 = {
						...column2,
						column: column2,
						// Deprecated in v0.3.0
						data: rowData,
						// Deprecated in v0.3.0
					};
					let header =
						typeof column2.Header === "function"
							? column2.Header(column2, stateInfo)
							: column2.render("Header");
					let headerProps = {
						// colspan doesn't apply to ARIA tables, but react-table adds it. Remove it.
						colSpan: null,
						ref: (el) => (headerRefs.current[column2.id] = el),
					};
					if (isGroupHeader) {
						const { className: themeClass, innerClassName } = getCellTheme(
							theme.groupHeaderStyle
						);
						headerProps = {
							...headerProps,
							"aria-colspan": column2.totalVisibleHeaderCount,
							className: classNames(
								!column2.isUngrouped ? "rt-th-group" : "rt-th-group-none",
								column2.headerClassName,
								themeClass
							),
							innerClassName,
							style: column2.headerStyle,
							canResize: column2.canResize,
						};
					} else {
						const { className: themeClass, innerClassName } = getCellTheme(
							theme.headerStyle
						);
						headerProps = {
							...headerProps,
							// Assign cell role to selectable column headers to prevent input labels
							// from being read as column names ("select all rows column").
							role: column2.selectable ? "cell" : "columnheader",
							className: classNames(column2.headerClassName, themeClass),
							innerClassName,
							style: column2.headerStyle,
							canResize: column2.canResize,
							isResizing: column2.isResizing,
						};
						if (column2.canSort) {
							headerProps = {
								...headerProps,
								"aria-label": renderTemplate(language.sortLabel, {
									name: column2.name,
								}),
								canSort: column2.canSort,
								sortDescFirst: column2.sortDescFirst,
								isSorted: column2.isSorted,
								isSortedDesc: column2.isSortedDesc,
								// Use toggleSortBy instead of getSortByToggleProps() for more control over sorting
								toggleSortBy: column2.toggleSortBy,
							};
						}
					}
					let resizer;
					if (column2.canResize) {
						const { onMouseDown, onTouchStart } = column2.getResizerProps();
						resizer = /* @__PURE__ */ React11.createElement(ResizerComponent, {
							onMouseDown: (e) => {
								onMouseDown(e);
								e.preventDefault();
							},
							onTouchStart,
							onClick: (e) => {
								e.stopPropagation();
							},
						});
					}
					if (
						column2.selectable &&
						selection === "multiple" &&
						instance.rows.length > 0
					) {
						const toggleAllRowsSelected = () =>
							instance.toggleAllRowsSelected();
						headerProps = {
							...headerProps,
							onClick: toggleAllRowsSelected,
							className: classNames(headerProps.className, "rt-td-select"),
						};
						header = /* @__PURE__ */ React11.createElement(
							SelectInputComponent,
							{
								type: "checkbox",
								checked: instance.isAllRowsSelected,
								onChange: toggleAllRowsSelected,
								"aria-label": language.selectAllRowsLabel,
							}
						);
					}
					const { key, ...resolvedHeaderProps } =
						column2.getHeaderProps(headerProps);
					return /* @__PURE__ */ React11.createElement(
						ThComponent,
						{ key, ...resolvedHeaderProps },
						header,
						resizer
					);
				})
			);
		});
	};
	const isFilterable = instance.visibleColumns.some((col) => col.filterable);
	const filterableRef = React11.useRef(isFilterable);
	(0, import_react_table8.safeUseLayoutEffect)(() => {
		if (filterableRef.current && !isFilterable) {
			const setAllFilters2 = instance.setAllFilters;
			setAllFilters2(
				instance.visibleColumns.map((col) => ({ id: col.id, value: void 0 }))
			);
		}
		filterableRef.current = isFilterable;
	}, [isFilterable, instance.visibleColumns, instance.setAllFilters]);
	const makeFilters = () => {
		if (!isFilterable) {
			return null;
		}
		return /* @__PURE__ */ React11.createElement(
			TrComponent,
			{ className: classNames("rt-tr-filters", css(theme.rowStyle)) },
			instance.visibleColumns.map((column2) => {
				let filter;
				if (column2.filterable) {
					if (column2.filterInput != null) {
						let filterInput;
						if (typeof column2.filterInput === "function") {
							filterInput = column2.filterInput(column2, stateInfo);
						} else {
							filterInput = hydrate(
								{ Fragment: Fragment2, WidgetContainer },
								column2.filterInput
							);
						}
						if (React11.isValidElement(filterInput)) {
							filter = filterInput;
						} else if (column2.html) {
							filter = /* @__PURE__ */ React11.createElement(RawHTML, {
								html: filterInput,
							});
						}
					} else {
						filter = /* @__PURE__ */ React11.createElement(FilterComponent, {
							filterValue: column2.filterValue,
							setFilter: column2.setFilter,
							className: css(theme.filterInputStyle),
							placeholder: language.filterPlaceholder,
							"aria-label": renderTemplate(language.filterLabel, {
								name: column2.name,
							}),
						});
					}
				}
				const { className: themeClass, innerClassName } = getCellTheme(
					theme.filterCellStyle
				);
				const filterCellProps = {
					role: "cell",
					// colspan doesn't apply to ARIA tables, but react-table adds it. Remove it.
					colSpan: null,
					className: classNames(
						"rt-td-filter",
						column2.headerClassName,
						themeClass
					),
					innerClassName,
					style: column2.headerStyle,
				};
				const { key, ...resolvedFilterCellProps } =
					column2.getHeaderProps(filterCellProps);
				return /* @__PURE__ */ React11.createElement(
					TdComponent,
					{ key, ...resolvedFilterCellProps },
					filter
				);
			})
		);
	};
	(0, import_react_table8.safeUseLayoutEffect)(() => {
		const toggleAllRowsExpanded2 = instance.toggleAllRowsExpanded;
		if (defaultExpanded) {
			toggleAllRowsExpanded2(true);
		} else {
			toggleAllRowsExpanded2(false);
		}
	}, [instance.toggleAllRowsExpanded, defaultExpanded]);
	const [expandedColumns, setExpandedColumns] = React11.useState({});
	const makeRowDetails = (rowInfo, state2) => {
		if (!rowInfo.isExpanded || rowInfo.isGrouped) {
			return null;
		}
		const expandedId = expandedColumns[rowInfo.id];
		let expandedCol;
		if (expandedId != null) {
			expandedCol = instance.visibleColumns.find(
				(col) => col.id === expandedId
			);
		} else {
			expandedCol = instance.visibleColumns.find((col) => col.details);
		}
		if (!expandedCol) {
			return null;
		}
		const { details, html } = expandedCol;
		let props = {};
		if (typeof details === "function") {
			let content = details(rowInfo, state2);
			if (html) {
				props.html = content;
			}
			props.children = content;
		} else if (Array.isArray(details)) {
			let content = details[rowInfo.index];
			if (content == null) {
				return null;
			}
			if (html) {
				props.html = content;
			}
			props.children = hydrate2(
				{ Reactable, Fragment: Fragment2, WidgetContainer },
				content
			);
		}
		return /* @__PURE__ */ React11.createElement(RowDetails, {
			key: `${expandedCol.id}_${rowInfo.index}`,
			...props,
		});
	};
	const makeTbody = () => {
		const hasStickyColumns = instance.visibleColumns.some(
			(column2) => column2.sticky
		);
		let rowHighlightClass = hasStickyColumns
			? "rt-tr-highlight-sticky"
			: "rt-tr-highlight";
		let rowStripedClass = hasStickyColumns
			? "rt-tr-striped-sticky"
			: "rt-tr-striped";
		const rows = instance.page.map((row, viewIndex) => {
			instance.prepareRow(row);
			const toggleRowSelected = (set) => {
				if (set == null) {
					set = !row.isSelected;
				}
				if (selection === "single") {
					instance.setRowsSelected([]);
				}
				row.toggleRowSelected(set);
			};
			const rowInfo = {
				...row,
				toggleRowSelected,
				// For v6 compatibility
				viewIndex,
				row: row.values,
				// Deprecated in v0.3.0
				subRows: convertRowsToV6(row.subRows),
				aggregated: row.isGrouped,
				expanded: row.isExpanded,
				level: row.depth,
				selected: row.isSelected,
				page: state.pageIndex,
				// Deprecated in v0.3.0
			};
			const rowProps = {
				className: classNames(
					striped && (viewIndex % 2 ? null : rowStripedClass),
					highlight && rowHighlightClass,
					row.isSelected && "rt-tr-selected",
					css(theme.rowStyle)
				),
			};
			if (rowClassName) {
				let rowCls;
				if (typeof rowClassName === "function") {
					rowCls = rowClassName(rowInfo, stateInfo);
				} else if (Array.isArray(rowClassName)) {
					rowCls = rowClassName[rowInfo.index];
				} else {
					rowCls = rowClassName;
				}
				rowProps.className = classNames(rowProps.className, rowCls);
			}
			if (rowStyle) {
				if (typeof rowStyle === "function") {
					rowProps.style = rowStyle(rowInfo, stateInfo);
				} else if (Array.isArray(rowStyle)) {
					rowProps.style = rowStyle[rowInfo.index];
				} else {
					rowProps.style = rowStyle;
				}
			}
			const rowDetails = makeRowDetails(rowInfo, stateInfo);
			let expandedId;
			if (row.isExpanded) {
				if (expandedColumns[row.id] != null) {
					expandedId = expandedColumns[row.id];
				} else {
					const expandedCol = instance.visibleColumns.find(
						(col) => col.details
					);
					expandedId = expandedCol ? expandedCol.id : null;
				}
			}
			const resolvedRowProps = row.getRowProps(rowProps);
			return (
				// Use relative row index for key (like in v6) rather than row index (v7)
				// for better rerender performance, especially with a large number of rows.
				/* @__PURE__ */ React11.createElement(
				TrGroupComponent,
				{
					key: `${row.depth}_${viewIndex}`,
					className: css(theme.rowGroupStyle),
				},
					/* @__PURE__ */ React11.createElement(
					TrComponent,
					{ ...resolvedRowProps, key: void 0 },
					row.cells.map((cell, colIndex) => {
						const { column: column2 } = cell;
						let cellProps = column2.getProps
							? column2.getProps(rowInfo, column2, stateInfo)
							: {};
						const { className: themeClass, innerClassName } = getCellTheme(
							theme.cellStyle
						);
						cellProps = {
							...cellProps,
							className: classNames(cellProps.className, themeClass),
							innerClassName,
							role: column2.rowHeader ? "rowheader" : "cell",
						};
						const cellInfo = {
							...cell,
							column: column2,
							filterValue: column2.filterValue,
							...rowInfo,
						};
						let value;
						if (cell.isGrouped) {
							value = column2.Grouped
								? column2.Grouped(cellInfo, stateInfo)
								: cellInfo.value;
						} else if (cell.isAggregated) {
							value = column2.Aggregated
								? column2.Aggregated(cellInfo, stateInfo)
								: cell.render("Aggregated");
						} else if (cell.isPlaceholder) {
							value = "";
						} else {
							value = column2.Cell
								? column2.Cell(cellInfo, stateInfo)
								: cell.render("Cell");
						}
						let hasDetails;
						if (column2.details && !row.isGrouped) {
							if (
								Array.isArray(column2.details) &&
								column2.details[row.index] == null
							) {
							} else {
								hasDetails = true;
							}
						}
						let expander;
						if (hasDetails) {
							const isExpanded = row.isExpanded && expandedId === column2.id;
							cellProps = {
								...cellProps,
								onClick: () => {
									if (isExpanded) {
										row.toggleRowExpanded(false);
										const newExpandedColumns = { ...expandedColumns };
										delete newExpandedColumns[row.id];
										setExpandedColumns(newExpandedColumns);
									} else {
										row.toggleRowExpanded(true);
										const newExpandedColumns = {
											...expandedColumns,
											[row.id]: column2.id,
										};
										setExpandedColumns(newExpandedColumns);
									}
								},
								className: classNames(
									cellProps.className,
									"rt-td-expandable"
								),
							};
							if (value === emptyValue) {
								cellProps.style = {
									textOverflow: "clip",
									userSelect: "none",
									...cellProps.style,
								};
							}
							const expanderProps = {
								isExpanded,
								className: css(theme.expanderStyle),
								"aria-label": language.detailsExpandLabel,
							};
							expander = /* @__PURE__ */ React11.createElement(
								ExpanderComponent,
								{ ...expanderProps }
							);
						} else if (cell.isGrouped) {
							const isExpanded = row.isExpanded;
							cellProps = {
								...cellProps,
								onClick: () => row.toggleRowExpanded(),
								className: classNames(
									cellProps.className,
									"rt-td-expandable"
								),
							};
							const expanderProps = {
								isExpanded,
								className: css(theme.expanderStyle),
								"aria-label": language.groupExpandLabel,
							};
							expander = /* @__PURE__ */ React11.createElement(
								ExpanderComponent,
								{ ...expanderProps }
							);
						} else if (cell.column.isGrouped && row.canExpand) {
							cellProps = {
								...cellProps,
								onClick: () => row.toggleRowExpanded(),
								className: classNames(
									cellProps.className,
									"rt-td-expandable"
								),
							};
						}
						const canRowSelect =
							selection === "multiple" ||
							(selection === "single" && !cell.isAggregated);
						if (column2.selectable && canRowSelect) {
							cellProps = {
								...cellProps,
								onClick: () => toggleRowSelected(),
								className: classNames(cellProps.className, "rt-td-select"),
							};
							let ariaLabel;
							if (cell.isAggregated) {
								ariaLabel = language.selectAllSubRowsLabel;
							} else {
								ariaLabel = language.selectRowLabel;
							}
							value = /* @__PURE__ */ React11.createElement(
								SelectInputComponent,
								{
									type: selection === "multiple" ? "checkbox" : "radio",
									checked: row.isSelected,
									onChange: () => toggleRowSelected(),
									"aria-label": ariaLabel,
								}
							);
						}
						if (onClick && !cellProps.onClick) {
							if (onClick === "expand") {
								cellProps.onClick = () => row.toggleRowExpanded();
							} else if (onClick === "select" && canRowSelect) {
								cellProps.onClick = () => toggleRowSelected();
							} else if (typeof onClick === "function") {
								cellProps.onClick = () =>
									onClick(rowInfo, column2, stateInfo);
							}
						}
						const resolvedCellProps = cell.getCellProps(cellProps);
						return (
								// Use column ID for key (like in v6) rather than row index (v7)
								// for better rerender performance, especially with a large number of rows.
								/* @__PURE__ */ React11.createElement(
							TdComponent,
							{ ...resolvedCellProps, key: `${colIndex}_${column2.id}` },
							expander,
							value
						)
						);
					})
				),
				rowDetails
			)
			);
		});
		let padRows;
		minRows = minRows ? Math.max(minRows, 1) : 1;
		const padRowCount = Math.max(minRows - instance.page.length, 0);
		if (padRowCount > 0) {
			padRows = [...Array(padRowCount)].map((_, viewIndex) => {
				const rowProps = {
					className: classNames("rt-tr-pad", css(theme.rowStyle)),
				};
				if (rowClassName) {
					let rowCls;
					if (typeof rowClassName === "function") {
						rowCls = rowClassName(void 0, stateInfo);
					} else if (Array.isArray(rowClassName)) {
					} else {
						rowCls = rowClassName;
					}
					rowProps.className = classNames(rowProps.className, rowCls);
				}
				if (rowStyle) {
					if (typeof rowStyle === "function") {
						rowProps.style = rowStyle(void 0, stateInfo);
					} else if (Array.isArray(rowStyle)) {
					} else {
						rowProps.style = rowStyle;
					}
				}
				return /* @__PURE__ */ React11.createElement(
					TrGroupComponent,
					{
						key: viewIndex,
						className: css(theme.rowGroupStyle),
						"aria-hidden": true,
					},
					/* @__PURE__ */ React11.createElement(
						TrComponent,
						{ ...rowProps },
						instance.visibleColumns.map((column2) => {
							const { className: themeClass, innerClassName } = getCellTheme(
								theme.cellStyle
							);
							const cellProps = {
								className: themeClass,
							};
							const { className: className3, style: style2 } =
								column2.getFooterProps(cellProps);
							return /* @__PURE__ */ React11.createElement(
								TdComponent,
								{
									key: `${viewIndex}_${column2.id}`,
									className: className3,
									innerClassName,
									style: style2,
								},
								"\xA0"
							);
						})
					)
				);
			});
		}
		let className2 = css(theme.tableBodyStyle);
		let noData;
		if (instance.rows.length === 0) {
			noData = /* @__PURE__ */ React11.createElement(
				NoDataComponent,
				null,
				language.noData
			);
			className2 = classNames("rt-tbody-no-data", className2);
		} else {
			noData = /* @__PURE__ */ React11.createElement(NoDataComponent, null);
		}
		const tbodyProps = instance.getTableBodyProps({ className: className2 });
		return /* @__PURE__ */ React11.createElement(
			TbodyComponent,
			{ ...tbodyProps },
			rows,
			padRows,
			noData
		);
	};
	const makeTfoot = () => {
		const hasFooters = instance.visibleColumns.some(
			(column2) => column2.footer != null
		);
		if (!hasFooters) {
			return null;
		}
		const tfootProps = instance.getTfootProps();
		return /* @__PURE__ */ React11.createElement(
			TfootComponent,
			{ ...tfootProps },
			/* @__PURE__ */ React11.createElement(
				TrComponent,
				null,
				instance.visibleColumns.map((column2) => {
					column2 = {
						...column2,
						column: column2,
						// Deprecated in v0.3.0
						data: rowData,
						// Deprecated in v0.3.0
					};
					const footer =
						typeof column2.Footer === "function"
							? column2.Footer(column2, stateInfo)
							: column2.render("Footer");
					const { className: themeClass, innerClassName } = getCellTheme(
						theme.footerStyle
					);
					const footerProps = {
						className: classNames(
							"rt-td-footer",
							column2.footerClassName,
							themeClass
						),
						innerClassName,
						style: column2.footerStyle,
						role: column2.rowHeader ? "rowheader" : "cell",
						// colspan doesn't apply to ARIA tables, but react-table adds it. Remove it.
						colSpan: null,
					};
					const { key, ...resolvedFooterProps } =
						column2.getFooterProps(footerProps);
					return /* @__PURE__ */ React11.createElement(
						TdComponent,
						{ key, ...resolvedFooterProps },
						footer
					);
				})
			)
		);
	};
	const maxRowCount = React11.useRef(
		paginateSubRows ? instance.flatRows.length : instance.rows.length
	);
	React11.useEffect(() => {
		maxRowCount.current = 0;
	}, [data]);
	React11.useEffect(() => {
		const rowCount = paginateSubRows
			? instance.flatRows.length
			: instance.rows.length;
		if (rowCount > maxRowCount.current) {
			maxRowCount.current = rowCount;
		}
	}, [paginateSubRows, instance.flatRows, instance.rows]);
	const makePagination = () => {
		if (showPagination === false) {
			return null;
		} else if (!pagination && showPagination == null) {
			return null;
		} else if (pagination && showPagination == null) {
			const minPageSize = showPageSizeOptions
				? Math.min(state.pageSize, ...(pageSizeOptions || []))
				: state.pageSize;
			let rowCount;
			if (serverMaxRowCount != null) {
				rowCount = serverMaxRowCount;
			} else if (serverRowCount != null) {
				rowCount = serverRowCount;
			} else {
				rowCount = maxRowCount.current;
			}
			if (rowCount <= minPageSize) {
				return null;
			}
		}
		return /* @__PURE__ */ React11.createElement(Pagination, {
			paginationType,
			pageSizeOptions,
			showPageInfo,
			showPageSizeOptions,
			page: state.pageIndex,
			pages: instance.pageCount,
			pageSize: state.pageSize,
			pageRowCount: instance.pageRowCount,
			canNext: instance.canNextPage,
			canPrevious: instance.canPreviousPage,
			onPageChange: instance.gotoPage,
			onPageSizeChange: instance.setPageSize,
			rowCount: serverRowCount != null ? serverRowCount : instance.rows.length,
			theme,
			language,
		});
	};
	const rootElement = React11.useRef(null);
	const keyboardActiveProps = {
		onMouseDown: () => {
			rootElement.current.classList.remove("rt-keyboard-active");
		},
		onKeyDown: () => {
			rootElement.current.classList.add("rt-keyboard-active");
		},
		onKeyUp: (e) => {
			const keyCode = e.which || e.keyCode;
			if (keyCode === 9) {
				rootElement.current.classList.add("rt-keyboard-active");
			}
		},
	};
	const tableElement = React11.useRef(null);
	const [tableHasScrollbar, setTableHasScrollbar] = React11.useState(false);
	(0, import_react_table8.safeUseLayoutEffect)(() => {
		const checkTableHasScrollbar = () => {
			const { scrollHeight, clientHeight, scrollWidth, clientWidth } =
				tableElement.current;
			const hasScrollbar =
				scrollHeight > clientHeight || scrollWidth > clientWidth;
			setTableHasScrollbar(hasScrollbar);
		};
		if (window.ResizeObserver) {
			const resizeObserver = new ResizeObserver(() => {
				checkTableHasScrollbar();
			});
			resizeObserver.observe(tableElement.current);
			return function cleanup() {
				resizeObserver.disconnect();
			};
		} else {
			checkTableHasScrollbar();
		}
	}, []);
	React11.useEffect(() => {
		if (!window.Shiny || !window.Shiny.onInputChange || nested) {
			return;
		}
		const outputId = rootElement.current.parentElement.getAttribute(
			"data-reactable-output"
		);
		if (!outputId) {
			return;
		}
		const selectedIndexes = stateInfo.selected.map((index) => index + 1);
		const page = stateInfo.page + 1;
		let sorted = stateInfo.sorted.length > 0 ? {} : null;
		for (let sortInfo of stateInfo.sorted) {
			sorted[sortInfo.id] = sortInfo.desc ? "desc" : "asc";
		}
		const state2 = {
			page,
			pageSize: stateInfo.pageSize,
			pages: stateInfo.pages,
			sorted,
			selected: selectedIndexes,
		};
		Object.keys(state2).forEach((prop) => {
			window.Shiny.onInputChange(
				`${outputId}__reactable__${prop}`,
				state2[prop]
			);
		});
	}, [
		nested,
		stateInfo.page,
		stateInfo.pageSize,
		stateInfo.pages,
		stateInfo.sorted,
		stateInfo.selected,
	]);
	const getPageCount = (0, import_react_table8.useGetLatest)(
		instance.pageCount
	);
	React11.useEffect(() => {
		if (!window.Shiny || nested) {
			return;
		}
		const outputId = rootElement.current.parentElement.getAttribute(
			"data-reactable-output"
		);
		if (!outputId) {
			return;
		}
		const setRowsSelected = instance.setRowsSelected;
		const gotoPage2 = instance.gotoPage;
		const toggleAllRowsExpanded2 = instance.toggleAllRowsExpanded;
		const updateState = (newState) => {
			if (newState.jsEvals) {
				for (let key of newState.jsEvals) {
					window.HTMLWidgets.evaluateStringMember(newState, key);
				}
			}
			if (newState.data != null) {
				const data2 = normalizeColumnData(newState.data, dataColumns);
				setNewData(data2);
			}
			if (newState.selected != null) {
				const selectedRowIds = newState.selected.map((index) => String(index));
				setRowsSelected(selectedRowIds);
			}
			if (newState.page != null) {
				const nearestValidPage = Math.min(
					Math.max(newState.page, 0),
					Math.max(getPageCount() - 1, 0)
				);
				gotoPage2(nearestValidPage);
			}
			if (newState.expanded != null) {
				if (newState.expanded) {
					toggleAllRowsExpanded2(true);
				} else {
					toggleAllRowsExpanded2(false);
				}
			}
			if (newState.meta !== void 0) {
				setMeta2(newState.meta);
			}
		};
		window.Shiny.addCustomMessageHandler(
			`__reactable__${outputId}`,
			updateState
		);
	}, [
		nested,
		instance.setRowsSelected,
		instance.gotoPage,
		instance.toggleAllRowsExpanded,
		dataColumns,
		getPageCount,
		setMeta2,
	]);
	const ctRef = React11.useRef(null);
	(0, import_react_table8.safeUseLayoutEffect)(() => {
		if (!crosstalkGroup || !window.crosstalk) {
			return;
		}
		const ct = {};
		ct.selection = new window.crosstalk.SelectionHandle(crosstalkGroup);
		ct.filter = new window.crosstalk.FilterHandle(crosstalkGroup);
		ct.selected = ct.selection.value;
		ct.filtered = ct.filter.filteredKeys;
		ctRef.current = ct;
		const rowByKey = (crosstalkKey || []).reduce((obj, key, index) => {
			obj[key] = index;
			return obj;
		}, {});
		const setFilter2 = instance.setFilter;
		const setRowsSelected = instance.setRowsSelected;
		const applyCrosstalkFilter = () => {
			const selectedKeys =
				ct.selected && ct.selected.length > 0 ? ct.selected : null;
			const filteredKeys = ct.filtered;
			let keys;
			if (!selectedKeys && !filteredKeys) {
				keys = null;
			} else if (!selectedKeys) {
				keys = filteredKeys;
			} else if (!filteredKeys) {
				keys = selectedKeys;
			} else {
				keys = selectedKeys.filter((key) => filteredKeys.includes(key));
			}
			const filteredRows = keys ? keys.map((key) => rowByKey[key]) : null;
			setFilter2(crosstalkId, filteredRows);
		};
		const setCrosstalkSelection = (value) => {
			if (ct.selected !== value) {
				ct.selected = value;
				applyCrosstalkFilter();
			}
		};
		const setCrosstalkFilter = (value) => {
			if (ct.filtered !== value) {
				ct.filtered = value;
				applyCrosstalkFilter();
			}
		};
		ct.selection.on("change", (e) => {
			if (e.sender !== ct.selection) {
				setCrosstalkSelection(e.value);
				ct.skipNextSelection = true;
				setRowsSelected([]);
			} else {
				setCrosstalkSelection(null);
			}
		});
		ct.filter.on("change", (e) => {
			if (e.sender !== ct.filter) {
				setCrosstalkFilter(e.value);
			}
		});
		if (ct.selected || ct.filtered) {
			applyCrosstalkFilter();
		}
		return function cleanup() {
			try {
				ct.selection.close();
			} catch (e) {
				console.error("Error closing Crosstalk selection handle:", e);
			}
			try {
				ct.filter.close();
			} catch (e) {
				console.error("Error closing Crosstalk filter handle:", e);
			}
		};
	}, [
		crosstalkKey,
		crosstalkGroup,
		crosstalkId,
		instance.setFilter,
		instance.setRowsSelected,
	]);
	(0, import_react_table8.safeUseLayoutEffect)(() => {
		if (!ctRef.current) {
			return;
		}
		if (!defaultSelected) {
			ctRef.current.skipNextSelection = true;
		}
	}, [defaultSelected]);
	(0, import_react_table8.safeUseLayoutEffect)(() => {
		if (!ctRef.current || !selection) {
			return;
		}
		const ct = ctRef.current;
		if (ct.skipNextSelection) {
			ct.skipNextSelection = false;
			return;
		}
		const selectedKeys = Object.keys(state.selectedRowIds).map((id) => {
			return crosstalkKey[rowsById[id].index];
		});
		try {
			ct.selection.set(selectedKeys);
		} catch (e) {
			console.error("Error selecting Crosstalk keys:", e);
		}
	}, [state.selectedRowIds, rowsById, selection, crosstalkKey]);
	instance.state = stateInfo;
	instance.downloadDataCSV = (filename, options = {}) => {
		filename = filename || "data.csv";
		const csv = instance.getDataCSV(options);
		downloadCSV(csv, filename);
	};
	instance.getDataCSV = (options = {}) => {
		if (!options.columnIds) {
			options.columnIds = dataColumns.map((col) => col.id);
		}
		const dataColumnIds = data.length > 0 ? Object.keys(data[0]) : [];
		options.columnIds = options.columnIds.filter((id) =>
			dataColumnIds.includes(id)
		);
		const rows = instance.preGroupedRows.map((row) => row.values);
		const csv = rowsToCSV(rows, options);
		return csv;
	};
	instance.setMeta = setMeta2;
	const origToggleHideColumn = instance.toggleHideColumn;
	instance.toggleHideColumn = (columnId, isHidden) => {
		if (isHidden && stateInfo.hiddenColumns.includes(columnId)) {
			return;
		}
		origToggleHideColumn(columnId, isHidden);
	};
	instance.setData = (data2, options = {}) => {
		options = Object.assign(
			{ resetSelected: true, resetExpanded: false },
			options
		);
		if (typeof data2 !== "object" || data2 == null) {
			throw new Error(
				"data must be an array of row objects or an object containing column arrays"
			);
		}
		if (!Array.isArray(data2)) {
			data2 = normalizeColumnData(data2, dataColumns);
		}
		setNewData(data2);
		if (options.resetSelected) {
			instance.setRowsSelected([]);
		}
		if (options.resetExpanded) {
			instance.toggleAllRowsExpanded(false);
		}
	};
	let stateCallbacks = React11.useRef([]);
	instance.onStateChange = (listenerFn) => {
		if (typeof listenerFn !== "function") {
			throw new Error("listenerFn must be a function");
		}
		stateCallbacks.current.push(listenerFn);
		return function cancel() {
			stateCallbacks.current = stateCallbacks.current.filter(
				(cb) => cb !== listenerFn
			);
		};
	};
	const onStateChange2 = useAsyncDebounce((state2) => {
		stateCallbacks.current.forEach((cb) => {
			cb(state2);
		});
	}, 0);
	React11.useEffect(() => {
		onStateChange2(stateInfo);
	}, [stateInfo, onStateChange2]);
	const getTableInstance = (0, import_react_table8.useGetLatest)(instance);
	React11.useEffect(() => {
		let instanceId = elementId;
		if (!instanceId) {
			instanceId = rootElement.current.parentElement.getAttribute(
				"data-reactable-output"
			);
		}
		if (!instanceId) {
			return;
		}
		tableInstances[instanceId] = getTableInstance;
		return function cleanup() {
			delete tableInstances[instanceId];
		};
	}, [elementId, getTableInstance]);
	className = classNames(
		className,
		css(theme.style),
		outlined && "rt-outlined",
		bordered && "rt-bordered",
		borderless && "rt-borderless",
		compact && "rt-compact",
		nowrap && "rt-nowrap",
		inline && " rt-inline"
	);
	style = { width, height, ...style };
	const isResizing = state.columnResizing.isResizingColumn != null;
	const tableClassName = classNames(
		css(theme.tableStyle),
		isResizing && "rt-resizing"
	);
	return /* @__PURE__ */ React11.createElement(
		RootComponent,
		{ ref: rootElement, ...keyboardActiveProps, className, style },
		makeSearch(),
		/* @__PURE__ */ React11.createElement(
			TableComponent,
			{
				ref: tableElement,
				tabIndex: tableHasScrollbar ? 0 : null,
				className: tableClassName,
			},
			makeThead(),
			makeTbody(),
			makeTfoot()
		),
		makePagination()
	);
}
Reactable.propTypes = {
	data: import_prop_types3.default.objectOf(import_prop_types3.default.array)
		.isRequired,
	columns: import_prop_types3.default.arrayOf(import_prop_types3.default.object)
		.isRequired,
	columnGroups: import_prop_types3.default.arrayOf(
		import_prop_types3.default.object
	),
	groupBy: import_prop_types3.default.arrayOf(
		import_prop_types3.default.string
	),
	sortable: import_prop_types3.default.bool,
	resizable: import_prop_types3.default.bool,
	filterable: import_prop_types3.default.bool,
	searchable: import_prop_types3.default.bool,
	searchMethod: import_prop_types3.default.func,
	defaultSortDesc: import_prop_types3.default.bool,
	defaultSorted: import_prop_types3.default.arrayOf(
		import_prop_types3.default.shape({
			id: import_prop_types3.default.string,
			desc: import_prop_types3.default.bool,
		})
	),
	pagination: import_prop_types3.default.bool,
	defaultPageSize: import_prop_types3.default.number,
	pageSizeOptions: import_prop_types3.default.arrayOf(
		import_prop_types3.default.number
	),
	paginationType: import_prop_types3.default.oneOf([
		"numbers",
		"jump",
		"simple",
	]),
	showPagination: import_prop_types3.default.bool,
	showPageSizeOptions: import_prop_types3.default.bool,
	showPageInfo: import_prop_types3.default.bool,
	minRows: import_prop_types3.default.number,
	paginateSubRows: import_prop_types3.default.bool,
	defaultExpanded: import_prop_types3.default.bool,
	selection: import_prop_types3.default.oneOf(["multiple", "single"]),
	selectionId: import_prop_types3.default.string,
	// Deprecated in v0.3.0
	defaultSelected: import_prop_types3.default.arrayOf(
		import_prop_types3.default.number
	),
	onClick: import_prop_types3.default.oneOfType([
		import_prop_types3.default.oneOf(["expand", "select"]),
		import_prop_types3.default.func,
	]),
	outlined: import_prop_types3.default.bool,
	bordered: import_prop_types3.default.bool,
	borderless: import_prop_types3.default.bool,
	striped: import_prop_types3.default.bool,
	highlight: import_prop_types3.default.bool,
	compact: import_prop_types3.default.bool,
	nowrap: import_prop_types3.default.bool,
	showSortIcon: import_prop_types3.default.bool,
	showSortable: import_prop_types3.default.bool,
	className: import_prop_types3.default.string,
	style: import_prop_types3.default.object,
	rowClassName: import_prop_types3.default.oneOfType([
		import_prop_types3.default.string,
		import_prop_types3.default.func,
		import_prop_types3.default.array,
	]),
	rowStyle: import_prop_types3.default.oneOfType([
		import_prop_types3.default.object,
		import_prop_types3.default.func,
		import_prop_types3.default.array,
	]),
	inline: import_prop_types3.default.bool,
	width: import_prop_types3.default.oneOfType([
		import_prop_types3.default.string,
		import_prop_types3.default.number,
	]),
	height: import_prop_types3.default.oneOfType([
		import_prop_types3.default.string,
		import_prop_types3.default.number,
	]),
	theme: import_prop_types3.default.object,
	language: import_prop_types3.default.object,
	meta: import_prop_types3.default.object,
	crosstalkKey: import_prop_types3.default.array,
	crosstalkGroup: import_prop_types3.default.string,
	crosstalkId: import_prop_types3.default.string,
	elementId: import_prop_types3.default.string,
	nested: import_prop_types3.default.bool,
	dataKey: import_prop_types3.default.string,
	dataURL: import_prop_types3.default.string,
	serverRowCount: import_prop_types3.default.number,
	serverMaxRowCount: import_prop_types3.default.number,
};
Reactable.defaultProps = {
	sortable: true,
	pagination: true,
	defaultPageSize: 10,
	paginationType: "numbers",
	pageSizeOptions: [10, 25, 50, 100],
	showPageInfo: true,
	minRows: 1,
	showSortIcon: true,
	crosstalkId: "__crosstalk__",
};
ReactableData.propTypes = Reactable.propTypes;
ReactableData.defaultProps = Reactable.defaultProps;

// tmp/reactable/srcjs/index2.js
function tryEval(code) {
	var result = null;
	try {
		result = eval("(" + code + ")");
	} catch (error) {
		if (!(error instanceof SyntaxError)) {
			throw error;
		}
		try {
			result = eval(code);
		} catch (e) {
			if (e instanceof SyntaxError) {
				throw error;
			} else {
				throw e;
			}
		}
	}
	return result;
}
function replaceWithEval(obj, fields) {
	for (let field of fields) {
		if (obj[field] && typeof obj[field].code === "string") {
			var res = tryEval(obj[field].code);
			if (typeof res === "function") {
				console.log("replacing", field, obj[field], res);
				obj[field] = res;
			}
		}
	}
	return obj;
}
function mapReplaceWithEval(obj, field) {
	if (obj === void 0) {
		return obj;
	}
	if (!Array.isArray(obj)) {
		return obj;
	}
	var res = obj.map((x) => replaceWithEval(x, field));
	return res;
}
function Reactable2({ data, columns, ...rest }) {
	var colProps = [
		"filterMethod",
		"footer",
		"cell",
		"details",
		"style",
		"header",
		"aggregate",
		"aggregated",
	];
	var tableProps = ["rowStyle", "rowClass", "onClick"];
	var columns = mapReplaceWithEval(columns, colProps);
	var rest = replaceWithEval(rest, tableProps);
	1 + 1;
	return Reactable({
		data,
		columns,
		...rest,
	});
}
Reactable2.propTypes = Reactable.propTypes;
Reactable2.defaultProps = Reactable.defaultProps;
export {
	ReactableData,
	Reactable2 as default,
	downloadDataCSV,
	getDataCSV,
	getInstance,
	getState,
	gotoPage,
	hydrate2,
	onStateChange,
	setAllFilters,
	setData,
	setFilter,
	setGroupBy,
	setHiddenColumns,
	setMeta,
	setPageSize,
	setSearch,
	toggleAllRowsExpanded,
	toggleGroupBy,
	toggleHideColumn,
};
