; Order matters! Place higher precedence first.
; Adapted from https://github.com/zed-industries/zed/blob/main/crates/languages/src/typescript/highlights.scm

; Language constants

[
  (true)
  (false)
  (null)
  (undefined)
] @constant.language

(namespace_import
  "*" @constant.language)

; Keywords

[
  "delete"
  "in"
  "infer"
  "instanceof"
  "keyof"
  "of"
  "typeof"
] @keyword.operator.expression

[
  "as"
  "await"
  "break"
  "case"
  "catch"
  "continue"
  "default"
  "do"
  "else"
  "export"
  "finally"
  "for"
  "from"
  "if"
  "import"
  "require"
  "return"
  "satisfies"
  "switch"
  "throw"
  "try"
  "type"
  "while"
  "yield"
] @keyword.control

[
  "abstract"
  "async"
  "declare"
  "extends"
  "implements"
  "override"
  "private"
  "protected"
  "public"
  "readonly"
  "static"
] @storage.modifier

[
  "=>"
  "class"
  "const"
  "enum"
  "function"
  "get"
  "interface"
  "let"
  "namespace"
  "set"
  "var"
] @storage.type

[
  "debugger"
  "target"
  "with"
] @keyword

; TODO: works in the playground but not here
(regex_flags) @keyword

[
  "void"
] @support.type

[
  "new"
] @keyword.operator.new

; Tokens

[
  ";"
  "?."
  "."
  ","
  ":"
  "?"
] @punctuation.delimiter

[
  "-"
  "--"
  "-="
  "+"
  "++"
  "+="
  "*"
  "*="
  "**"
  "**="
  "/"
  "/="
  "%"
  "%="
  "<"
  "<="
  "<<"
  "<<="
  "="
  "=="
  "==="
  "!"
  "!="
  "!=="
  "=>"
  ">"
  ">="
  ">>"
  ">>="
  ">>>"
  ">>>="
  "~"
  "^"
  "&"
  "|"
  "^="
  "&="
  "|="
  "&&"
  "||"
  "??"
  "&&="
  "||="
  "??="
] @keyword.operator

; Special identifiers

(type_identifier) @entity.name.type
(predefined_type) @support.type

(("const")
  (variable_declarator
  	name: (identifier) @variable.other.constant))

([
  (identifier)
  (shorthand_property_identifier)
  (shorthand_property_identifier_pattern)] @variable.other.constant
  (#match? @variable.other.constant "^[A-Z][A-Z_]+$"))

(extends_clause
  value: (identifier) @entity.other.inherited-class)

; Function and method calls

(call_expression
  function: (identifier) @entity.name.function)

(call_expression
  function: (member_expression
    property: (property_identifier) @entity.name.function))

(new_expression
  constructor: (identifier) @entity.name.function)

; Function and method definitions

(function_expression
  name: (identifier) @entity.name.function)
(function_declaration
  name: (identifier) @entity.name.function)
(method_definition
  name: (property_identifier) @storage.type
  (#eq? @storage.type "constructor"))
(method_definition
  name: (property_identifier) @entity.name.function)
(method_signature
  name: (property_identifier) @entity.name.function)

(pair
  key: (property_identifier) @entity.name.function
  value: [(function_expression) (arrow_function)])

(assignment_expression
  left: (member_expression
    property: (property_identifier) @entity.name.function)
  right: [(function_expression) (arrow_function)])

(variable_declarator
  name: (identifier) @entity.name.function
  value: [(function_expression) (arrow_function)])

(assignment_expression
  left: (identifier) @entity.name.function
  right: [(function_expression) (arrow_function)])

; Properties

(member_expression
  object: (this)
  property: (property_identifier) @variable)

(member_expression
  property: (property_identifier) @variable.other.constant
  (#match? @variable.other.constant "^[A-Z][A-Z_]+$"))

[
  (property_identifier)
  (shorthand_property_identifier)
  (shorthand_property_identifier_pattern)] @variable

; Variables

(identifier) @variable

; Template TODO: These don't seem to be working

(template_substitution
  "${" @punctuation.definition.template-expression.begin
  "}" @punctuation.definition.template-expression.end)

(template_type
  "${" @punctuation.definition.template-expression.begin
  "}" @punctuation.definition.template-expression.end)

(type_arguments
  "<" @punctuation.bracket
  ">" @punctuation.bracket)

; Literals

(this) @variable.language
(super) @variable.language

(comment) @comment

; TODO: This doesn't seem to be working
(escape_sequence) @constant.character.escape

[
  (string)
  (template_string)
  (template_literal_type)
] @string

; NOTE: the typescript grammar doesn't break regex into nice parts so as to capture parts of it separately
(regex) @string.regexp
(number) @constant.numeric

