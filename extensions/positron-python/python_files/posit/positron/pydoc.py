# noqa: A005
#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import contextlib
import importlib.metadata
import inspect
import io
import logging
import pathlib
import pkgutil
import pydoc
import re
import sys
import warnings
from dataclasses import dataclass
from functools import partial
from pydoc import (
    ModuleScanner,
    _is_bound_method,  # type: ignore
    describe,
    isdata,
    locate,
    visiblename,
)
from traceback import format_exception_only
from typing import TYPE_CHECKING, Any, cast

from ._vendor.markdown_it import MarkdownIt
from ._vendor.pygments import highlight
from ._vendor.pygments.formatters.html import HtmlFormatter
from ._vendor.pygments.lexers import get_lexer_by_name
from ._vendor.pygments.util import ClassNotFound
from .docstrings import convert_docstring
from .utils import get_module_name, is_numpy_ufunc

if TYPE_CHECKING:
    from types import ModuleType

logger = logging.getLogger(__name__)


def _compact_signature(obj: Any, name="", max_chars=45) -> str | None:
    """
    Produce a compact signature for a callable object.

    This was written to match signatures in class attribute lists in the pandas documentation,
    for example: https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.html#pandas.DataFrame

    Example
    -------

    >>> def foo(a, b, c=1, *args, **kwargs):
    ...     pass
    >>> compact_signature(foo)
    '(a, b, c=1, *args, **kwargs)'

    Returns `None` for uncallable objects.

    >>> compact_signature(1)
    None
    """
    try:
        signature = inspect.signature(obj)
    except (TypeError, ValueError):
        # TODO: Try falling back to getting the signature from the docstring e.g. `numpy.array`
        return None

    seen_optionals = False
    seen_keyword_only = False

    def _stringify(args):
        # Convert a list of arg strings to a single signature, adding brackets as needed
        nonlocal seen_optionals
        result = ", ".join(args)
        if seen_optionals:
            result += "]"
        return f"({result})"

    args = []
    for name, param in signature.parameters.items():
        if name == "self":
            continue

        # Is it the first keyword-only argument?
        elif not seen_keyword_only and param.kind is param.KEYWORD_ONLY:
            seen_keyword_only = True
            args.append("*")

        # Is it variadic?
        elif param.kind is param.VAR_POSITIONAL or param.kind is param.VAR_KEYWORD:
            seen_keyword_only = True

        arg = str(param.replace(annotation=param.empty, default=param.empty))

        # Is it the first optional argument?
        if not seen_optionals and param.default is not param.empty:
            seen_optionals = True
            if args:
                args[-1] += "["
            else:
                arg = f"[{arg}"

        args.append(arg)

        # Check if we should truncate the remaining args
        result = _stringify(args)
        if len(name + result) > max_chars:
            # Replace the last arg with an ellipsis
            args.pop()
            args.append("...")
            break

    return _stringify(args)


def _untyped_signature(obj: Any) -> str | None:
    """
    Produce a signature for a callable object, with all annotations removed.

    This was written to match signatures in the header of pages for callables in the pandas
    documentation, for example: https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.html#pandas.DataFrame

    Example
    -------

    >>> def foo(a: int, b: str, c=1, *args, **kwargs) -> None:
    ...     pass
    >>> untyped_signature(foo)
    '(a, b, c=1, *args, **kwargs) -> None'
    """
    try:
        signature = inspect.signature(obj)
    except (ValueError, TypeError):
        # TODO: Try falling back to getting the signature from the docstring e.g. `numpy.array`
        return None

    untyped_params = [
        param.replace(annotation=param.empty)
        for name, param in signature.parameters.items()
        if name != "self"
    ]
    signature = signature.replace(parameters=untyped_params, return_annotation=signature.empty)
    return str(signature)


def _get_summary(object_: Any) -> str | None:
    """Get the one-line summary from the docstring of an object."""
    doc = _pydoc_getdoc(object_)
    return doc.split("\n\n", 1)[0]


def _tabulate_attrs(attrs: list[_Attr], cls_name: str | None = None) -> list[str]:
    """Create an HTML table of attribute signatures and summaries."""
    result = []
    # "autosummary" refers to the Sphinx extension that this is based on
    result.append('<table class="autosummary">')
    result.append("<tbody>")
    for attr in attrs:
        _cls_name = cls_name or attr.cls.__name__
        full_name = f"{_cls_name}.{attr.name}"
        argspec = _compact_signature(attr.value, attr.name) or ""
        link = f'<a href="{full_name}"><code>{attr.name}</code></a>{argspec}'
        summary = _get_summary(attr.value) or ""
        row_lines = [
            "<tr>",
            "<td>",
            link,
            "</td>",
            "<td>",
            summary,
            "</td>",
            "</tr>",
        ]
        result.extend(row_lines)
    result.append("</tbody>")
    result.append("</table>")
    return result


# as-is from pydoc 3.11
# --- Start Positron ---
class PositronHelper(pydoc.Helper):
    # --- End Positron ---
    def _gettopic(self, topic, more_xrefs=""):
        """Return unbuffered tuple of (topic, xrefs).

        If an error occurs here, the exception is caught and displayed by
        the url handler.

        This function duplicates the showtopic method but returns its
        result directly so it can be formatted for display in an html page.
        """
        try:
            import pydoc_data.topics
        except ImportError:
            return (
                """
Sorry, topic and keyword documentation is not available because the
module "pydoc_data.topics" could not be found.
""",
                "",
            )
        target = self.topics.get(topic, self.keywords.get(topic))
        if not target:
            # --- Start Positron ---
            raise ValueError(f"No help found for topic: {topic}.")
            # --- End Positron ---
        if isinstance(target, str):
            return self._gettopic(target, more_xrefs)
        label, xrefs = target
        doc = pydoc_data.topics.topics[label]
        if more_xrefs:
            xrefs = (xrefs or "") + " " + more_xrefs
        return doc, xrefs


@dataclass
class _Attr:
    name: str
    cls: Any
    value: Any


class _PositronHTMLDoc(pydoc.HTMLDoc):
    def document(self, object: Any, *args: Any):  # noqa: A002
        # Handle numpy ufuncs, which don't return True for `inspect.isroutine` but which we still
        # want to document as routines.
        if is_numpy_ufunc(object):
            return self.docroutine(object, *args)

        return super().document(object, *args)

    def page(self, title, contents):
        """Format an HTML page."""
        # --- Start Positron ---
        # moved from _HTMLDoc class in pydoc._url_handler
        # update path for positron file system
        css_path = "_pydoc.css"

        css_link = f'<link rel="stylesheet" type="text/css" href="{css_path}">'

        # removed html_navbar() for aesthetics
        return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pydoc: {title}</title>
{css_link}</head><body>{contents}</div>
</body></html>"""
        # --- End Positron ---

    def heading(self, title: str, extras="") -> str:  # type: ignore ReportIncompatibleMethodOverride
        """Format a page heading."""
        # Simplified version of pydoc.HTMLDoc.heading that doesn't use tables
        lines = [f"<h1>{title}</h1>"]
        if extras:
            lines.append(extras)
        return "\n".join(lines)

    def section(  # type: ignore ReportIncompatibleMethodOverride
        self,
        title: str,
        cls: str,
        contents: str,
        width=None,
        prelude="",
        marginalia=None,
        gap=None,
    ) -> str:
        """Format a section with a heading."""
        # Simplified version of pydoc.HTMLDoc.section that doesn't use tables
        if width is not None:
            logger.debug(f"Ignoring width: {width}")

        if marginalia:
            logger.debug(f"Ignoring marginalia: {marginalia}")

        if gap:
            logger.debug(f"Ignoring gap: {gap}")

        lines = [
            f'<section class="{cls}">',
            f"<h2>{title}</h2>",
        ]
        if prelude:
            lines.append(prelude)
        lines.append(contents)
        lines.append("</section>")
        return "\n".join(lines)

    def bigsection(self, *args):
        # This no longer does anything on top of `section`, we keep it for compatibility with pydoc
        return self.section(*args)

    # Heavily customized version of pydoc.HTMLDoc.docmodule
    def docmodule(self, object: ModuleType, *_):  # type: ignore reportIncompatibleMethodOverride  # noqa: A002
        obj_name = object.__name__

        # Create the heading, with links to each parent module
        parts = obj_name.split(".")
        links = []
        for i in range(len(parts) - 1):
            url = ".".join(parts[: i + 1]) + ".html"
            links.append(f'<a href="{url}">{parts[i]}</a>')
        linkedname = ".".join(links + parts[-1:])
        head = linkedname

        pkg_version = ""
        if hasattr(object, "__version__"):
            pkg_version = self._version_text(str(object.__version__))

        # TODO: Re-enable once file links actually work in the Positron Help pane
        # Add a link to the module file
        # try:
        #     path = inspect.getabsfile(object)
        # except TypeError:
        #     filelink = "(built-in)"
        # else:
        #     url = urllib.parse.quote(path)
        #     filelink = f'<a class="source-link" href="file:{url}">[source]</a>'

        result = pkg_version + self.heading(title=head)

        # Separate the module's members into modules, classes, functions, and data.
        # Respect the module's __all__ attribute if it exists.
        all_ = getattr(object, "__all__", None)
        modules = []
        classes = []
        funcs = []
        data = []
        for name, value in inspect.getmembers(object):
            if not visiblename(name, all_, object):
                continue

            attr = _Attr(name=name, cls=object, value=value)

            if inspect.ismodule(value):
                modules.append(attr)
            elif inspect.isclass(value):
                classes.append(attr)
            elif inspect.isroutine(value):
                funcs.append(attr)
            elif isdata(value):
                data.append(attr)

        # Add the module's parsed docstring to the page
        doc = _getdoc(object)
        result += doc

        # Add the module's members to the page
        if modules:
            contents = _tabulate_attrs(modules, obj_name)
            result += self.bigsection("Modules", "modules", "\n".join(contents))

        if classes:
            contents = _tabulate_attrs(classes, obj_name)
            result += self.bigsection("Classes", "classes", "\n".join(contents))

        if funcs:
            contents = _tabulate_attrs(funcs, obj_name)
            result += self.bigsection("Functions", "functions", "\n".join(contents))

        if data:
            contents = _tabulate_attrs(data, obj_name)
            result += self.bigsection("Data", "data", "\n".join(contents))

        return result

    # Heavily customized version of pydoc.HTMLDoc.docclass
    def docclass(self, obj: type, name=None, *_):  # type: ignore reportIncompatibleMethodOverride
        obj_name = name or obj.__name__

        # Separate the class's members into attributes and methods
        attributes = []
        methods = []
        for name, value in inspect.getmembers(obj):
            if name.startswith("_"):
                continue

            attr = _Attr(name=name, cls=obj, value=value)

            if callable(value):
                methods.append(attr)
            else:
                attributes.append(attr)

        match = re.search(r"^([^.]*)\.", obj_name)
        pkg_version = ""

        if match:
            with contextlib.suppress(importlib.metadata.PackageNotFoundError):
                pkg_version = importlib.metadata.version(match.group(1))  # type: ignore

        version_text = self._version_text(pkg_version)

        result = version_text + self.heading(title=obj_name)

        # Add the object's signature to the page
        signature = _untyped_signature(obj) or ""
        signature = self.escape(signature)
        signature = f"<code><strong><em>class</em> {obj_name}<em>{signature}</em></strong></code>"
        result += signature

        # Add the object's parsed docstring to the page
        doc = _getdoc(obj)
        result += doc

        # Add the object's members to the page
        if attributes:
            contents = _tabulate_attrs(attributes, obj_name)
            result += self.bigsection("Attributes", "attributes", "\n".join(contents))

        if methods:
            contents = _tabulate_attrs(methods, obj_name)
            result += self.bigsection("Methods", "functions", "\n".join(contents))

        return result

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docroutine(
        self,
        object: Any,  # noqa: A002
        name=None,
        mod=None,
        funcs=None,
        classes=None,
        methods=None,
        cl=None,
    ):
        """Produce HTML documentation for a function or method object."""
        if methods is None:
            methods = {}
        if classes is None:
            classes = {}
        if funcs is None:
            funcs = {}
        realname = object.__name__
        name = name or realname
        anchor = ((cl and cl.__name__) or "") + "-" + name
        note = ""
        skipdocs = 0
        if _is_bound_method(object):
            imclass = object.__self__.__class__
            if cl:
                if imclass is not cl:
                    note = " from " + self.classlink(imclass, mod)  # type: ignore
            else:
                if object.__self__ is not None:
                    note = f" method of {self.classlink(object.__self__.__class__, mod)} instance"  # type: ignore
                else:
                    note = f" unbound {self.classlink(imclass, mod)} method"  # type: ignore

        if inspect.iscoroutinefunction(object) or inspect.isasyncgenfunction(object):
            asyncqualifier = "async "
        else:
            asyncqualifier = ""

        if name == realname:
            title = f'<a name="{anchor}"><strong>{realname}</strong></a>'
        else:
            if cl and inspect.getattr_static(cl, realname, []) is object:
                reallink = '<a href="#{}">{}</a>'.format(cl.__name__ + "-" + realname, realname)
                skipdocs = 1
            else:
                reallink = realname
            title = f'<a name="{anchor}"><strong>{name}</strong></a> = {reallink}'
        argspec = None
        if inspect.isroutine(object):
            try:
                signature = inspect.signature(object)
            except (ValueError, TypeError):
                signature = None
            if signature:
                argspec = str(signature)
                if realname == "<lambda>":
                    title = f"<strong>{name}</strong> <em>lambda</em> "
                    # XXX lambda's won't usually have func_annotations['return']
                    # since the syntax doesn't support but it is possible.
                    # So removing parentheses isn't truly safe.
                    argspec = argspec[1:-1]  # remove parentheses
        if not argspec:
            argspec = "(...)"

        decl = (
            asyncqualifier
            + title
            + self.escape(argspec)
            + (note and self.grey(f'<span class="heading-text">{note}</span>'))
        )

        if skipdocs:
            return f"<dl><dt>{decl}</dt></dl>\n"
        else:
            doc = self.markup(_getdoc(object), self.preformat, funcs, classes, methods)
            # --- Start Positron ---
            # Remove <span class="code">
            # doc = doc and '<dd><span class="code">%s</span></dd>' % doc
            # --- End Positron ---
            return f"<dl><dt>{decl}</dt>{doc}</dl>\n"

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docdata(self, object, name=None, mod=None, cl=None):  # noqa: A002, ARG002
        """Produce html documentation for a data descriptor."""
        results = []
        push = results.append

        if name:
            push(f"<dl><dt><strong>{name}</strong></dt>\n")
        doc = self.markup(_getdoc(object), self.preformat)
        if doc:
            # --- Start Positron ---
            # Remove <span class="code">
            # push('<dd><span class="code">%s</span></dd>\n' % doc)
            push(f"<dd>{doc}</dd>\n")
            # --- End Positron ---
        push("</dl>\n")

        return "".join(results)

    docproperty = docdata

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docother(self, object, name=None, mod=None, *ignored):  # noqa: A002, ARG002
        """Produce HTML documentation for a data object."""
        lhs = (name and f"<strong>{name}</strong> = ") or ""
        return lhs + self.repr(object)

    def markup(self, text, escape=None, funcs=None, classes=None, methods=None):  # noqa: ARG002
        # Don't do any marking up, let the rst parser handle it.
        if methods is None:
            methods = {}
        if classes is None:
            classes = {}
        if funcs is None:
            funcs = {}
        return text

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def index(self, dir, shadowed: dict[str, int] | None = None):  # type: ignore reportIncompatibleMethodOverride  # noqa: A002
        """Generate an HTML index for a directory of modules."""
        modpkgs = []
        if shadowed is None:
            shadowed = {}
        for _importer, name, ispkg in pkgutil.iter_modules([dir]):
            if any((0xD800 <= ord(ch) <= 0xDFFF) for ch in name):
                # ignore a module if its name contains a surrogate character
                continue
            modpkgs.append((name, "", ispkg, name in shadowed))
            shadowed[name] = 1

        modpkgs.sort()
        contents = self.multicolumn(modpkgs, self.modpkglink)
        return self.bigsection(dir, "index", contents)

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_index(self):
        """Module Index page."""

        def bltinlink(name):
            return f'<a href="{name}.html">{name}</a>'

        heading = self.heading('<strong class="title">Index of Modules</strong>')
        names = [name for name in sys.builtin_module_names if name != "__main__"]
        contents = self.multicolumn(names, bltinlink)
        contents = [heading, "<p>" + self.bigsection("Built-in Modules", "index", contents)]

        seen = {}
        for dir_ in sys.path:
            contents.append(self.index(dir_, seen))

        contents.append(
            '<p align=right class="heading-text grey"><strong>pydoc</strong> by Ka-Ping Yee'
            "&lt;ping@lfw.org&gt;</p>"
        )
        return "Index of Modules", "".join(contents)

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_search(self, key):
        """Search results page."""
        # scan for modules
        search_result = []

        def callback(_path, modname, desc):
            if modname[-9:] == ".__init__":
                modname = modname[:-9] + " (package)"
            search_result.append((modname, desc and "- " + desc))

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore")  # ignore problems during import

            def onerror(modname):
                pass

            ModuleScanner().run(callback, key, onerror=onerror)

        # format page
        def bltinlink(name):
            return f'<a href="{name}.html">{name}</a>'

        results = []
        heading = self.heading(
            '<strong class="title">Search Results</strong>',
        )
        for name, desc in search_result:
            results.append(bltinlink(name) + desc)
        contents = heading + self.bigsection(f"key = {key}", "index", "<br>".join(results))
        return "Search Results", contents

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_getobj(self, url):
        # --- Start Positron ---
        # Skip forced reloads for all modules. It is unlikely to affect the UX provided that these
        # modules don't change within the lifetime of the help service
        obj = locate(url, forceload=False)
        # --- End Positron ---
        if obj is None and url != "None":
            raise ValueError("could not find object")
        title = describe(obj)
        content = self.document(obj, url)
        return title, content

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_topics(self):
        """Index of topic texts available."""

        def bltinlink(name):
            return f'<a href="topic?key={name}">{name}</a>'

        heading = self.heading(
            '<strong class="title">INDEX</strong>',
        )
        # --- Start Positron ---
        names = sorted(PositronHelper.topics.keys())
        # --- End Positron ---

        contents = self.multicolumn(names, bltinlink)
        contents = heading + self.bigsection("Topics", "index", contents)
        return "Topics", contents

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_keywords(self):
        """Index of keywords."""
        heading = self.heading(
            '<strong class="title">INDEX</strong>',
        )
        # --- Start Positron ---
        names = sorted(PositronHelper.keywords.keys())
        # --- End Positron ---

        def bltinlink(name):
            return f'<a href="topic?key={name}">{name}</a>'

        contents = self.multicolumn(names, bltinlink)
        contents = heading + self.bigsection("Keywords", "index", contents)
        return "Keywords", contents

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_topicpage(self, topic):
        """Topic or keyword help page."""
        buf = io.StringIO()
        # --- Start Positron ---
        htmlhelp = PositronHelper(buf, buf)
        # --- End Positron ---
        contents, xrefs = htmlhelp._gettopic(topic)  # type: ignore  # noqa: SLF001
        title = "KEYWORD" if topic in htmlhelp.keywords else "TOPIC"
        heading = self.heading(
            f'<strong class="title">{title}</strong>',
        )
        contents = f"<pre>{self.markup(contents)}</pre>"
        contents = self.bigsection(topic, "index", contents)
        if xrefs:
            xrefs = sorted(xrefs.split())

            def bltinlink(name):
                return f'<a href="topic?key={name}">{name}</a>'

            xrefs = self.multicolumn(xrefs, bltinlink)
            xrefs = self.section("Related help topics: ", "index", xrefs)
        return (f"{title} {topic}", f"{heading}{contents}{xrefs}")

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_error(self, url, exc):  # noqa: ARG002
        heading = self.heading(
            '<strong class="title">Not found</strong>',
        )
        contents = "<br>".join(self.escape(line) for line in format_exception_only(type(exc), exc))
        # --- Start Positron ---
        contents = heading + self.bigsection("", "error", contents)
        return "Error", contents
        # --- End Positron ---

    # moved from pydoc._url_handler to method
    def get_html_page(self, url):
        """Generate an HTML page for url."""
        complete_url = url
        if url.endswith(".html"):
            url = url[:-5]

        # --- Start Positron ---
        # for typechecking
        title, content = None, None
        # --- End Positron ---

        try:
            if url in ("", "index"):
                title, content = self.html_index()
            elif url == "topics":
                title, content = self.html_topics()
            elif url == "keywords":
                title, content = self.html_keywords()
            elif "=" in url:
                op, _, url = url.partition("=")
                if op == "search?key":
                    title, content = self.html_search(url)
                elif op == "topic?key":
                    # try topics first, then objects.
                    try:
                        title, content = self.html_topicpage(url)
                    except ValueError:
                        title, content = self.html_getobj(url)
                elif op == "get?key":
                    # try objects first, then topics.
                    if url in ("", "index"):
                        title, content = self.html_index()
                    else:
                        try:
                            title, content = self.html_getobj(url)
                        except ValueError:
                            title, content = self.html_topicpage(url)
                else:
                    raise ValueError("bad pydoc url")
            else:
                title, content = self.html_getobj(url)
        except Exception as exc:
            # Catch any errors and display them in an error page.
            title, content = self.html_error(complete_url, exc)

        # --- Start Positron ---
        # for typechecking
        assert title is not None
        assert content is not None
        # --- End Positron ---

        return self.page(title, content)

    def _version_text(self, version: str) -> str:
        # Add the module's __version__ to the heading
        if len(version) > 0:
            pkg_version = self.escape(version)
            return f'<div class="package-version">{"v" + pkg_version}</div>'
        else:
            return ""


# as is from < Python 3.9, since 3.9 introduces a breaking change to pydoc.getdoc
def _pydoc_getdoc(object_: Any) -> str:
    """Get the doc string or comments for an object."""
    result = inspect.getdoc(object_) or inspect.getcomments(object_)
    return (result and re.sub("^ *\n", "", result.rstrip())) or ""


def _getdoc(object_: Any) -> str:
    """Override `pydoc.getdoc` to parse reStructuredText docstrings."""
    try:
        docstring = _pydoc_getdoc(object_) or "No documentation found."
        html = _docstring_to_html(docstring, object_)
    except Exception as exception:
        # This is caught somewhere above us in pydoc. Log the exception so we see it in Positron
        # logs.
        logger.exception(f"Failed to parse docstring for {object_}: {exception}")
        raise exception
    return html


def _resolve(target: str, from_obj: Any) -> str | None:
    """Resolve a possibly partially specified `target` to a full import path."""
    # Special cases that are commonly false positives, never link these:
    if target == "data":
        return None

    # Is `target` a module?
    try:
        importlib.import_module(target)
    except Exception:
        pass
    else:
        return target

    # Is `target` a fully qualified name to a class, function, or instance?
    if "." in target:
        module_path, object_path = target.rsplit(".", 1)
        try:
            module = importlib.import_module(module_path)
        except Exception:
            pass
        else:
            # Ignore all warnings that happen upon `hasattr(module, object_path)` e.g.
            # `hasattr(numpy, 'object')`
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")

                if hasattr(module, object_path):
                    return target

        # Is `target` a fully qualified path to a class attribute or method?
        if "." in module_path:
            # Example:
            #   name: pandas.DataFrame.to_csv
            #   module_path: pandas.DataFrame -> pandas
            #   object_path: to_csv -> DataFrame
            #   attr_path: to_csv
            attr_path = object_path
            module_path, object_path = module_path.rsplit(".", 1)
            try:
                module = importlib.import_module(module_path)
            except Exception:
                pass
            else:
                obj = getattr(module, object_path, None)
                if obj is not None and hasattr(obj, attr_path):
                    return f"{module_path}.{object_path}.{attr_path}"

    # Is `target` a fully qualified name, but implicitly relative to `from_obj`'s package?
    from_module_name = get_module_name(from_obj)
    if from_module_name is not None:
        from_package_name = from_module_name.split(".")[0]
        if not target.startswith(from_package_name):  # Avoid infinite recursion
            target = f"{from_package_name}.{target}"
            return _resolve(target, from_obj)

    # Could not resolve.
    return None


_SECTION_RE = re.compile(r"\n#### ([\w\s]+)\n\n")


def _is_argument_name(match: re.Match) -> bool:
    """Does a match correspond to an argument name?."""
    # Get the line that the match is on.
    start, end = match.span()
    pre = match.string[:start]
    post = match.string[end:]
    start_line = pre.rfind("\n") + 1
    end_line = end + post.find("\n")
    line = match.string[start_line:end_line]

    # Does the line start with a list item (an argument)?
    if line.startswith("- "):
        # Are we in a `Parameters` section?
        sections = _SECTION_RE.findall(pre)
        if sections and sections[-1] == "Parameters":
            return True
    return False


def _linkify_match(match: re.Match, object_: Any) -> str:
    logger.debug(f"Linkifying: {match.group(0)}")

    # Don't link arguments, a common case of false positives, otherwise, e.g.
    # a `copy` argument would link to the standard library `copy` module.
    if _is_argument_name(match):
        return match.group(0)

    # gather all groups
    start, name, end = match.groups()

    # Try to resolve `target` and replace it with a link.
    key = _resolve(name, object_)
    if key is None:
        logger.debug("Could not resolve")
        return match.group(0)
    result = f"[{start}{name}{end}](get?key={key})"
    logger.debug(f"Resolved: {key}")
    return result


def _link_url(match: re.Match) -> str:
    logger.debug(f"Creating link: {match.group(0)}")

    start, url, end = match.groups()

    return f'{start}<a href="{url}">{url}</a>{end}'


def _linkify(markdown: str, object_: Any) -> str:
    """
    Linkify.

    Replace all instances like '`<name>`' or '`[](~name)`' with a
    relative pydoc link to a resolved object.
    """
    pattern_sphinx = r"(?P<start>`+)(?P<name>[^\d\W`][\w\.]*)(?P<end>`+)"
    replacement = partial(_linkify_match, object_=object_)
    result = re.sub(pattern_sphinx, replacement, markdown)

    pattern_md = r"`?\[\]\((?P<start>`?)~(?P<name>[^)^`]+)(?P<end>`?)\)`?"
    replacement = partial(_linkify_match, object_=object_)
    result = re.sub(pattern_md, replacement, result)

    pattern_url = re.compile(r"(?P<start>\s)(?P<url>https?://\S+)(?P<end>\s)")
    replacement = _link_url
    return re.sub(pattern_url, replacement, result)


def _highlight(code: str, name: str, _attrs: str) -> str:
    """
    Highlight a code block.

    This is called via MarkdownIt. For example, given the following markdown code block:

    ```python {.attr1 .attr2}
    print("Hello, world!")
    ```

    ... it would call `_highlight('print("Hello, world!"'), "python", ["attr1", "attr2"])`.
    """
    try:
        lexer = get_lexer_by_name(name)
    except ClassNotFound:
        # Default to the `TextLexer` which doesn't highlight anything.
        lexer = get_lexer_by_name("text")

    formatter = HtmlFormatter()
    result = highlight(code, lexer, formatter)
    return cast(str, result)


def _docstring_to_html(docstring: str, object_: Any) -> str:
    """Parse a docstring in one of the supported formats to HTML."""
    logger.debug(f"Parsing docstring to html for object: {object_}")

    markdown = convert_docstring(docstring)

    markdown = _linkify(markdown, object_)

    md = MarkdownIt("commonmark", {"html": True, "highlight": _highlight}).enable(["table"])

    return md.render(markdown)


# adapted from pydoc._url_handler
def _url_handler(url: str, content_type="text/html"):
    """The pydoc url handler for use with the pydoc server.

    If the content_type is 'text/css', the _pydoc.css style
    sheet is read and returned if it exits.

    If the content_type is 'text/html', then the result of
    get_html_page(url) is returned.
    """
    # --- Start Positron ---
    # moved subclass _HTMLDoc and functions to _PositronHTMLDoc

    html = _PositronHTMLDoc()

    # --- End Positron ---

    if url.startswith("/"):
        url = url[1:]
    if content_type == "text/css":
        path_here = pathlib.Path(__file__).parent
        css_path = path_here / url
        with css_path.open() as fp:
            return "".join(fp.readlines())
    elif content_type == "text/html":
        return html.get_html_page(url)
    # Errors outside the url handler are caught by the server.
    raise TypeError(f"unknown content type {content_type!r} for url {url}")


def start_server(port: int = 0):
    """Adapted from pydoc.browser."""
    # Setting port to 0 will use an arbitrary port
    thread = pydoc._start_server(_url_handler, hostname="localhost", port=port)  # type: ignore  # noqa: SLF001

    if thread.error:
        logger.error(f"Could not start the pydoc help server. Error: {thread.error}")
        return None
    elif thread.serving:
        logger.info(f"Pydoc server ready at: {thread.url}")

    return thread


if __name__ == "__main__":
    # Run Positron's pydoc server on a custom port, useful for development.
    #
    # Example:
    #
    #   python -m positron.pydoc

    logging.basicConfig(level=logging.DEBUG)
    start_server(port=65216)
