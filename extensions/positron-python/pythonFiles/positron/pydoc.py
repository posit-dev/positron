#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import builtins
import inspect
import io
import logging
import os
import pkgutil
import pydoc
import sys
import urllib.parse
import warnings
from collections import deque
from pydoc import _is_bound_method  # type: ignore
from pydoc import _split_list  # type: ignore
from pydoc import sort_attributes  # type: ignore
from pydoc import (
    Helper,
    ModuleScanner,
    classify_class_attrs,
    describe,
    isdata,
    locate,
    visiblename,
)
from traceback import format_exception_only
from typing import Any, Dict, Optional

from docstring_to_markdown.rst import rst_to_markdown
from markdown_it import MarkdownIt

logger = logging.getLogger(__name__)


class _PositronHTMLDoc(pydoc.HTMLDoc):
    def page(self, title, contents):
        """Format an HTML page."""
        # --- Start Positron ---
        # moved from _HTMLDoc class in pydoc._url_handler
        # update path for positron file system
        css_path = "_pydoc.css"

        css_link = '<link rel="stylesheet" type="text/css" href="%s">' % css_path

        # removed html_navbar() for aesthetics
        return """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pydoc: %s</title>
%s</head><body>%s</div>
</body></html>""" % (
            title,
            css_link,
            contents,
        )
        # --- End Positron ---

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def heading(self, title, extras=""):
        """Format a page heading."""
        return """
<table class="heading">
<tr class="heading-text decor">
<td class="title">&nbsp;<br>%s</td>
<td class="extra">%s</td></tr></table>
    """ % (
            title,
            extras or "&nbsp;",
        )

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def section(self, title, cls, contents, width=6, prelude="", marginalia=None, gap="&nbsp;"):
        """Format a section with a heading."""
        if marginalia is None:
            marginalia = '<span class="code">' + "&nbsp;" * width + "</span>"
        result = """<p>
<table class="section">
<tr class="decor %s-decor heading-text">
<td class="section-title" colspan=3>&nbsp;<br>%s</td></tr>
    """ % (
            cls,
            title,
        )
        if prelude:
            result = (
                result
                + """
<tr><td class="decor %s-decor" rowspan=2>%s</td>
<td class="decor %s-decor" colspan=2>%s</td></tr>
<tr><td>%s</td>"""
                % (cls, marginalia, cls, prelude, gap)
            )
        else:
            result = (
                result
                + """
<tr><td class="decor %s-decor">%s</td><td>%s</td>"""
                % (cls, marginalia, gap)
            )

        return result + '\n<td class="singlecolumn">%s</td></tr></table>' % contents

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def bigsection(self, title, *args):
        """Format a section with a big heading."""
        title = '<strong class="bigsection">%s</strong>' % title
        return self.section(title, *args)

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docmodule(self, object: Any, name=None, mod=None, *ignored):
        """Produce HTML documentation for a module object."""
        name = object.__name__  # ignore the passed-in name
        try:
            all = object.__all__
        except AttributeError:
            all = None
        parts = name.split(".")
        links = []
        for i in range(len(parts) - 1):
            links.append(
                '<a href="%s.html" class="white">%s</a>' % (".".join(parts[: i + 1]), parts[i])
            )
        linkedname = ".".join(links + parts[-1:])
        head = '<strong class="title">%s</strong>' % linkedname
        try:
            path = inspect.getabsfile(object)
            url = urllib.parse.quote(path)
            filelink = self.filelink(url, path)
        except TypeError:
            filelink = "(built-in)"
        info = []
        if hasattr(object, "__version__"):
            version = str(object.__version__)
            if version[:11] == "$" + "Revision: " and version[-1:] == "$":
                version = version[11:-1].strip()
            info.append("version %s" % self.escape(version))
        if hasattr(object, "__date__"):
            info.append(self.escape(str(object.__date__)))
        if info:
            head = head + " (%s)" % ", ".join(info)
        docloc = self.getdocloc(object)
        if docloc is not None:
            docloc = '<br><a href="%(docloc)s">Module Reference</a>' % locals()
        else:
            docloc = ""
        result = self.heading(head, '<a href=".">index</a><br>' + filelink + docloc)

        modules = inspect.getmembers(object, inspect.ismodule)

        classes, cdict = [], {}
        for key, value in inspect.getmembers(object, inspect.isclass):
            # if __all__ exists, believe it.  Otherwise use old heuristic.
            if all is not None or (inspect.getmodule(value) or object) is object:
                if visiblename(key, all, object):
                    classes.append((key, value))
                    cdict[key] = cdict[value] = "#" + key
        for key, value in classes:
            for base in value.__bases__:
                key, modname = base.__name__, base.__module__
                module = sys.modules.get(modname)
                if modname != name and module and hasattr(module, key):
                    if getattr(module, key) is base:
                        if not key in cdict:
                            cdict[key] = cdict[base] = modname + ".html#" + key
        funcs, fdict = [], {}
        for key, value in inspect.getmembers(object, inspect.isroutine):
            # if __all__ exists, believe it.  Otherwise use old heuristic.
            if all is not None or inspect.isbuiltin(value) or inspect.getmodule(value) is object:
                if visiblename(key, all, object):
                    funcs.append((key, value))
                    fdict[key] = "#-" + key
                    if inspect.isfunction(value):
                        fdict[value] = fdict[key]
        data = []
        for key, value in inspect.getmembers(object, isdata):
            if visiblename(key, all, object):
                data.append((key, value))

        doc = self.markup(_getdoc(object), self.preformat, fdict, cdict)
        # --- Start Positron ---
        # Remove <span class="code">
        # doc = doc and '<span class="code">%s</span>' % doc
        # --- End Positron ---
        result = result + "<p>%s</p>\n" % doc

        if hasattr(object, "__path__"):
            modpkgs = []
            for importer, modname, ispkg in pkgutil.iter_modules(object.__path__):
                modpkgs.append((modname, name, ispkg, 0))
            modpkgs.sort()
            contents = self.multicolumn(modpkgs, self.modpkglink)
            result = result + self.bigsection("Package Contents", "pkg-content", contents)
        elif modules:
            contents = self.multicolumn(modules, lambda t: self.modulelink(t[1]))
            result = result + self.bigsection("Modules", "pkg-content", contents)

        if classes:
            classlist = [value for (key, value) in classes]
            contents = [self.formattree(inspect.getclasstree(classlist, True), name)]
            for key, value in classes:
                contents.append(self.document(value, key, name, fdict, cdict))
            result = result + self.bigsection("Classes", "index", " ".join(contents))
        if funcs:
            contents = []
            for key, value in funcs:
                contents.append(self.document(value, key, name, fdict, cdict))
            result = result + self.bigsection("Functions", "functions", " ".join(contents))
        if data:
            contents = []
            for key, value in data:
                contents.append(self.document(value, key))
            result = result + self.bigsection("Data", "data", "<br>\n".join(contents))
        if hasattr(object, "__author__"):
            contents = self.markup(str(object.__author__), self.preformat)
            result = result + self.bigsection("Author", "author", contents)
        if hasattr(object, "__credits__"):
            contents = self.markup(str(object.__credits__), self.preformat)
            result = result + self.bigsection("Credits", "credits", contents)

        return result

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docclass(self, object: Any, name=None, mod=None, funcs={}, classes={}, *ignored):
        """Produce HTML documentation for a class object."""
        realname = object.__name__
        name = name or realname
        bases = object.__bases__

        contents = []
        push = contents.append

        # Cute little class to pump out a horizontal rule between sections.
        class HorizontalRule:
            def __init__(self):
                self.needone = 0

            def maybe(self):
                if self.needone:
                    push("<hr>\n")
                self.needone = 1

        hr = HorizontalRule()

        # List the mro, if non-trivial.
        mro = deque(inspect.getmro(object))
        if len(mro) > 2:
            hr.maybe()
            push("<dl><dt>Method resolution order:</dt>\n")
            for base in mro:
                push("<dd>%s</dd>\n" % self.classlink(base, object.__module__))
            push("</dl>\n")

        def spill(msg, attrs, predicate):
            ok, attrs = _split_list(attrs, predicate)
            if ok:
                hr.maybe()
                push(msg)
                for name, kind, homecls, value in ok:
                    try:
                        value = getattr(object, name)
                    except Exception:
                        # Some descriptors may meet a failure in their __get__.
                        # (bug #1785)
                        push(self.docdata(value, name, mod))
                    else:
                        push(self.document(value, name, mod, funcs, classes, mdict, object))
                    push("\n")
            return attrs

        def spilldescriptors(msg, attrs, predicate):
            ok, attrs = _split_list(attrs, predicate)
            if ok:
                hr.maybe()
                push(msg)
                for name, kind, homecls, value in ok:
                    push(self.docdata(value, name, mod))
            return attrs

        def spilldata(msg, attrs, predicate):
            ok, attrs = _split_list(attrs, predicate)
            if ok:
                hr.maybe()
                push(msg)
                for name, kind, homecls, value in ok:
                    base = self.docother(getattr(object, name), name, mod)
                    doc = _getdoc(value)
                    if not doc:
                        push("<dl><dt>%s</dl>\n" % base)
                    else:
                        doc = self.markup(_getdoc(value), self.preformat, funcs, classes, mdict)
                        # --- Start Positron ---
                        # Remove <span class="code">
                        # doc = '<dd><span class="code">%s</span>' % doc
                        # --- End Positron ---
                        push("<dl><dt>%s%s</dl>\n" % (base, doc))
                    push("\n")
            return attrs

        attrs = [
            (name, kind, cls, value)
            for name, kind, cls, value in classify_class_attrs(object)
            if visiblename(name, obj=object)
        ]

        mdict = {}
        for key, kind, homecls, value in attrs:
            mdict[key] = anchor = "#" + name + "-" + key
            try:
                value = getattr(object, name)
            except Exception:
                # Some descriptors may meet a failure in their __get__.
                # (bug #1785)
                pass
            try:
                # The value may not be hashable (e.g., a data attr with
                # a dict or list value).
                mdict[value] = anchor
            except TypeError:
                pass

        while attrs:
            if mro:
                thisclass = mro.popleft()
            else:
                thisclass = attrs[0][2]
            attrs, inherited = _split_list(attrs, lambda t: t[2] is thisclass)

            if object is not builtins.object and thisclass is builtins.object:
                attrs = inherited
                continue
            elif thisclass is object:
                tag = "defined here"
            else:
                tag = "inherited from %s" % self.classlink(thisclass, object.__module__)
            tag += ":<br>\n"

            sort_attributes(attrs, object)

            # Pump out the attrs, segregated by kind.
            attrs = spill("Methods %s" % tag, attrs, lambda t: t[1] == "method")
            attrs = spill("Class methods %s" % tag, attrs, lambda t: t[1] == "class method")
            attrs = spill("Static methods %s" % tag, attrs, lambda t: t[1] == "static method")
            attrs = spilldescriptors(
                "Readonly properties %s" % tag, attrs, lambda t: t[1] == "readonly property"
            )
            attrs = spilldescriptors(
                "Data descriptors %s" % tag, attrs, lambda t: t[1] == "data descriptor"
            )
            attrs = spilldata("Data and other attributes %s" % tag, attrs, lambda t: t[1] == "data")
            assert attrs == []
            attrs = inherited

        contents = "".join(contents)

        if name == realname:
            title = '<a name="%s">class <strong>%s</strong></a>' % (name, realname)
        else:
            title = '<strong>%s</strong> = <a name="%s">class %s</a>' % (name, name, realname)
        if bases:
            parents = []
            for base in bases:
                parents.append(self.classlink(base, object.__module__))
            title = title + "(%s)" % ", ".join(parents)

        decl = ""
        try:
            signature = inspect.signature(object)
        except (ValueError, TypeError):
            signature = None
        if signature:
            argspec = str(signature)
            if argspec and argspec != "()":
                decl = name + self.escape(argspec) + "\n\n"

        doc = _getdoc(object)
        if decl:
            doc = decl + (doc or "")
        doc = self.markup(doc, self.preformat, funcs, classes, mdict)
        # --- Start Positron ---
        # Remove <span class="code">
        # doc = doc and '<span class="code">%s<br>&nbsp;</span>' % doc
        # --- End Positron ---

        return self.section(title, "title", contents, 3, doc)

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docroutine(
        self,
        object: Any,
        name=None,
        mod=None,
        funcs={},
        classes={},
        methods={},
        cl=None,
    ):
        """Produce HTML documentation for a function or method object."""
        realname = object.__name__
        name = name or realname
        anchor = (cl and cl.__name__ or "") + "-" + name
        note = ""
        skipdocs = 0
        if _is_bound_method(object):
            imclass = object.__self__.__class__
            if cl:
                if imclass is not cl:
                    note = " from " + self.classlink(imclass, mod)  # type: ignore
            else:
                if object.__self__ is not None:
                    note = " method of %s instance" % self.classlink(object.__self__.__class__, mod)  # type: ignore
                else:
                    note = " unbound %s method" % self.classlink(imclass, mod)  # type: ignore

        if inspect.iscoroutinefunction(object) or inspect.isasyncgenfunction(object):
            asyncqualifier = "async "
        else:
            asyncqualifier = ""

        if name == realname:
            title = '<a name="%s"><strong>%s</strong></a>' % (anchor, realname)
        else:
            if cl and inspect.getattr_static(cl, realname, []) is object:
                reallink = '<a href="#%s">%s</a>' % (cl.__name__ + "-" + realname, realname)
                skipdocs = 1
            else:
                reallink = realname
            title = '<a name="%s"><strong>%s</strong></a> = %s' % (anchor, name, reallink)
        argspec = None
        if inspect.isroutine(object):
            try:
                signature = inspect.signature(object)
            except (ValueError, TypeError):
                signature = None
            if signature:
                argspec = str(signature)
                if realname == "<lambda>":
                    title = "<strong>%s</strong> <em>lambda</em> " % name
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
            + (note and self.grey('<span class="heading-text">%s</span>' % note))
        )

        if skipdocs:
            return "<dl><dt>%s</dt></dl>\n" % decl
        else:
            doc = self.markup(_getdoc(object), self.preformat, funcs, classes, methods)
            # --- Start Positron ---
            # Remove <span class="code">
            # doc = doc and '<dd><span class="code">%s</span></dd>' % doc
            # --- End Positron ---
            return "<dl><dt>%s</dt>%s</dl>\n" % (decl, doc)

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docdata(self, object, name=None, mod=None, cl=None):
        """Produce html documentation for a data descriptor."""
        results = []
        push = results.append

        if name:
            push("<dl><dt><strong>%s</strong></dt>\n" % name)
        doc = self.markup(_getdoc(object), self.preformat)
        if doc:
            # --- Start Positron ---
            # Remove <span class="code">
            # push('<dd><span class="code">%s</span></dd>\n' % doc)
            push("<dd>%s</dd>\n" % doc)
            # --- End Positron ---
        push("</dl>\n")

        return "".join(results)

    docproperty = docdata

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def docother(self, object, name=None, mod=None, *ignored):
        """Produce HTML documentation for a data object."""
        lhs = name and "<strong>%s</strong> = " % name or ""
        return lhs + self.repr(object)

    def markup(self, text, escape=None, funcs={}, classes={}, methods={}):
        # Don't do any marking up, let the rst parser handle it.
        return text

    # as is from pydoc.HTMLDoc to port Python 3.11 breaking CSS changes
    def index(self, dir, shadowed: Optional[Dict[str, int]] = None):
        """Generate an HTML index for a directory of modules."""
        modpkgs = []
        if shadowed is None:
            shadowed = {}
        for importer, name, ispkg in pkgutil.iter_modules([dir]):
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
            return '<a href="%s.html">%s</a>' % (name, name)

        heading = self.heading('<strong class="title">Index of Modules</strong>')
        names = [name for name in sys.builtin_module_names if name != "__main__"]
        contents = self.multicolumn(names, bltinlink)
        contents = [heading, "<p>" + self.bigsection("Built-in Modules", "index", contents)]

        seen = {}
        for dir in sys.path:
            contents.append(self.index(dir, seen))

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

        def callback(path, modname, desc):
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
            return '<a href="%s.html">%s</a>' % (name, name)

        results = []
        heading = self.heading(
            '<strong class="title">Search Results</strong>',
        )
        for name, desc in search_result:
            results.append(bltinlink(name) + desc)
        contents = heading + self.bigsection("key = %s" % key, "index", "<br>".join(results))
        return "Search Results", contents

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_getobj(self, url):
        # --- Start Positron ---
        # Don't reload numpy, it raises a UserWarning if you do
        forceload = not url.startswith("numpy")
        # --- End Positron ---
        obj = locate(url, forceload=forceload)
        if obj is None and url != "None":
            raise ValueError("could not find object")
        title = describe(obj)
        content = self.document(obj, url)
        return title, content

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_topics(self):
        """Index of topic texts available."""

        def bltinlink(name):
            return '<a href="topic?key=%s">%s</a>' % (name, name)

        heading = self.heading(
            '<strong class="title">INDEX</strong>',
        )
        names = sorted(Helper.topics.keys())

        contents = self.multicolumn(names, bltinlink)
        contents = heading + self.bigsection("Topics", "index", contents)
        return "Topics", contents

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_keywords(self):
        """Index of keywords."""
        heading = self.heading(
            '<strong class="title">INDEX</strong>',
        )
        names = sorted(Helper.keywords.keys())

        def bltinlink(name):
            return '<a href="topic?key=%s">%s</a>' % (name, name)

        contents = self.multicolumn(names, bltinlink)
        contents = heading + self.bigsection("Keywords", "index", contents)
        return "Keywords", contents

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_topicpage(self, topic):
        """Topic or keyword help page."""
        buf = io.StringIO()
        htmlhelp = Helper(buf, buf)
        contents, xrefs = htmlhelp._gettopic(topic)  # type: ignore
        if topic in htmlhelp.keywords:
            title = "KEYWORD"
        else:
            title = "TOPIC"
        heading = self.heading(
            '<strong class="title">%s</strong>' % title,
        )
        contents = "<pre>%s</pre>" % self.markup(contents)
        contents = self.bigsection(topic, "index", contents)
        if xrefs:
            xrefs = sorted(xrefs.split())

            def bltinlink(name):
                return '<a href="topic?key=%s">%s</a>' % (name, name)

            xrefs = self.multicolumn(xrefs, bltinlink)
            xrefs = self.section("Related help topics: ", "index", xrefs)
        return ("%s %s" % (title, topic), "".join((heading, contents, xrefs)))

    # as is from pydoc._url_handler to port Python 3.11 breaking CSS changes
    def html_error(self, url, exc):
        heading = self.heading(
            '<strong class="title">Error</strong>',
        )
        contents = "<br>".join(self.escape(line) for line in format_exception_only(type(exc), exc))
        contents = heading + self.bigsection(url, "error", contents)
        return "Error - %s" % url, contents

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


def _getdoc(object: Any) -> str:
    """Override `pydoc.getdoc` to parse reStructuredText docstrings."""
    docstring = _pydoc_getdoc(object)

    markdown = rst_to_markdown(docstring)

    md = MarkdownIt("commonmark", {"html": True}).enable("table")
    html = md.render(markdown)

    return html


# adapted from pydoc._url_handler
def _url_handler(url, content_type="text/html"):
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
        path_here = os.path.dirname(os.path.realpath(__file__))
        css_path = os.path.join(path_here, url)
        with open(css_path) as fp:
            return "".join(fp.readlines())
    elif content_type == "text/html":
        return html.get_html_page(url)
    # Errors outside the url handler are caught by the server.
    raise TypeError("unknown content type %r for url %s" % (content_type, url))


# Keep a reference to the original/unpatched `pydoc.getdoc`.
_pydoc_getdoc = pydoc.getdoc


def start_server(port: int = 0):
    """Adapted from pydoc.browser."""
    # Monkey patch pydoc for our custom functionality
    pydoc.HTMLDoc = _PositronHTMLDoc
    pydoc.getdoc = _getdoc

    # Setting port to 0 will use an arbitrary port
    thread = pydoc._start_server(_url_handler, hostname="localhost", port=port)  # type: ignore

    if thread.error:
        logger.error(f"Could not start the pydoc help server. Error: {thread.error}")
        return
    elif thread.serving:
        logger.info(f"Pydoc server ready at: {thread.url}")

    return thread


if __name__ == "__main__":
    # Run Positron's pydoc server on a custom port, useful for development.
    #
    # Example:
    #
    #   python -m positron.pydoc

    logging.basicConfig(level=logging.INFO)
    start_server(port=65216)
