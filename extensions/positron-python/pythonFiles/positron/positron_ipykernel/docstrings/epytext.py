#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import re
from textwrap import dedent, indent
from typing import List

# from markdown_to_docstring.google.ESCAPE_RULES
ESCAPE_RULES = {
    # Avoid Markdown in magic methods or filenames like __init__.py
    r"__(?P<text>\S+)__": r"\_\_\g<text>\_\_",
}

EPYTEXT_FIELDS: List[str] = [
    "@param",
    "@type",
    "@keyword",
    "@ivar",  # class instance variable
    "@cvar",  # static class
    "@var",
    "@group",
    "@sort",
    "@todo",
    "@return",
    "@rtype",  # return type
    "@raise",
    "@see",
    "@note",
    "@attention",
    "@bug",
    "@warning",
    "@version",
    "@deprecated",
    "@since",
    "@change",
    "@permission",
    "@requires",
    "@precondition",
    "@postcondition",
    "@invariant",
    "@author",
    "@organization",
    "@copyright",
    "@license",
    "@contact",
    "@summary",
]


# adapted from docstring_to_markdown.google.Section
class Section:
    def __init__(self, name: str, content: str) -> None:
        # --- Start Positron ---
        name = dedent(name)

        # epytext is in the style of "@something: " or "@something name: "
        # in either case, we can split on the first " "
        split = name[1:].split(" ", 1)

        self.name = split[0].capitalize() if split[0].endswith(":") else split[0].capitalize() + ":"
        self.content = ""

        # epytext should only ever have 1 arg name per section
        self.arg_name = ""
        # add any information from the first line to the rest of the content

        self._parse(split[1] + content)
        # --- End Positron ---

    def _parse(self, content: str) -> None:
        content = content.rstrip("\n")

        parts = []
        cur_part = []

        for line in content.split("\n"):
            # --- Start Positron ---
            line = line.replace("    ", " ", 1)
            line = line.replace("\t", " ", 1)
            # --- End Positron ---

            if line.startswith(" "):
                # Continuation from a multiline description
                cur_part.append(line)
                continue

            if cur_part:
                # Leaving multiline description
                parts.append(cur_part)
                cur_part = [line]
            else:
                # Entering new description part
                cur_part.append(line)

        # Last part
        parts.append(cur_part)
        # Format section
        for part in parts:
            indentation = ""
            skip_first = False

            if ":" in part[0]:
                spl = part[0].split(":")

                arg = spl[0]
                # --- Start Positron ---
                self.arg_name = arg
                # --- End Positron ---

                description = ":".join(spl[1:]).lstrip()
                # --- Start Positron ---
                # indentation rules are different in epytext
                # indentation = (len(arg) + 6) * " "
                # --- End Positron ---

                if description:
                    # --- Start Positron ---
                    # arg and description are on the same line
                    # for epytext docstrings
                    self.content += "- `{}`: {}".format(arg, description).rstrip()
                    skip_first = True
                else:
                    self.content += " {}\n".format(arg)
            else:
                self.content += "{}\n".format(part[0])
                # --- End Positron ---

            for n, line in enumerate(part[1:]):
                if skip_first and n == 0:
                    # This ensures that indented params get moved to the
                    # previous line
                    # --- Start Positron ---
                    # previous lines lose spaces between words
                    self.content += " {}\n".format(line.lstrip())
                    # --- End Positron ---
                    continue

                self.content += "{}{}\n".format(indentation, line.lstrip())

        # remove trailing whitespaces and trailing newlines
        self.content = self.content.rstrip("\n").rstrip()

    def as_markdown(self) -> str:
        return "#### {}\n\n{}\n\n".format(self.name, self.content)


# similar to docstring_to_markdown.google.GoogleDocstring
# --- Start Positron ---
class EpytextDocstring:
    # --- End Positron ---
    def __init__(self, docstring: str) -> None:
        self.sections: List[Section] = []
        self.description: str = ""

        self._parse(docstring)

    def _parse(self, docstring: str) -> None:
        self.sections = []
        self.description = ""

        buf = ""
        cur_section = ""
        for line in docstring.split("\n"):
            if is_section(line):
                # Entering new section
                if cur_section:
                    # Leaving previous section, save it and reset buffer
                    self.sections.append(Section(cur_section, buf))
                    buf = ""

                # --- Start Positron ---
                # Remember currently parsed section
                cur_section = line.rstrip()
                # --- End Positron ---
                continue

            # Parse section content
            if cur_section:
                buf += line + "\n"
            else:
                # Before setting cur_section, we're parsing the function description
                self.description += line + "\n"

        # Last section
        self.sections.append(Section(cur_section, buf))

    # --- Start Positron ---
    # other docstring styles have all section entries combined, where epytext
    # has a section per parameter/type, so we have to aggregate the sections
    def combine_sections(self):
        # have to have all the types first
        self.sections.sort(key=custom_sort_key)

        unique_sections = {}
        type_sections = {}
        # Iterate through the list of Section objects
        for section in self.sections:
            name = section.name
            content = section.content

            if name == "Type:":
                type_sections[section.arg_name] = content.split(f"`{section.arg_name}`: ", 1)[1]
            elif name == "Rtype:":
                unique_sections["Return:"].content = (
                    f"({content.rstrip()}) {unique_sections['Return:'].content}"
                )
            else:
                matching_type = type_sections.get(str(section.arg_name))

                if matching_type:
                    content_split = content.split(":", 1)
                    # replace the : we split on, add type name, then content
                    section.content = (
                        f"- `{section.arg_name}` ({matching_type.rstrip()}):{content_split[1]}"
                    )
                if name in unique_sections:
                    # Append the description if the section heading is already present
                    unique_sections[name].content += "\n" + section.content
                else:
                    unique_sections[name] = section

        # Convert back to a list of Sections
        unique_sections_list = list(unique_sections.values())

        return unique_sections_list

    # --- End Positron ---

    def as_markdown(self) -> str:
        text = self.description

        # --- Start Positron ---
        unique_sections = self.combine_sections()
        # --- End Positron ---

        for section in unique_sections:
            text += section.as_markdown()

        return text.rstrip("\n") + "\n"  # Only keep one last newline


# --- Start Positron ---
def custom_sort_key(section):
    if section.name == "Type:":
        return 0
    if section.name == "Rtype":
        return 2
    else:
        return 1


# --- End Positron ---


# adapted from docstring_to_markdown.looks_like_google
# --- Start Positron ---
def looks_like_epytext(value: str) -> bool:
    for field in EPYTEXT_FIELDS:
        if re.search(r"{}".format(field), value):
            # --- End Positron ---
            return True

    return False


# adapted from docstring_to_markdown.google.is_section
def is_section(line: str) -> bool:
    # --- Start Positron ---
    for field in EPYTEXT_FIELDS:
        if re.search(r"{}".format(field), line):
            # --- End Positron ---
            return True

    return False


# adapted from docstring_to_markdown.google.google_to_markdown
# --- Start Positron ---
def epytext_to_markdown(text: str, extract_signature: bool = True) -> str:
    # --- End Positron ---
    # Escape parts we don't want to render
    for pattern, replacement in ESCAPE_RULES.items():
        text = re.sub(pattern, replacement, text)

    # --- Start Positron ---
    docstring = EpytextDocstring(text)
    # --- End Positron ---

    return docstring.as_markdown()
