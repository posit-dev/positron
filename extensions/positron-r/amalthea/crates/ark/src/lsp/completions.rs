//
// completions.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::collections::HashSet;
use std::env::current_dir;
use std::fs::DirEntry;
use std::path::Path;
use std::path::PathBuf;

use anyhow::bail;
use anyhow::Result;
use harp::eval::r_parse_eval;
use harp::eval::RParseEvalOptions;
use harp::exec::geterrmessage;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::r_symbol;
use harp::string::r_string_decode;
use harp::utils::r_envir_name;
use harp::utils::r_formals;
use harp::utils::r_typeof;
use lazy_static::lazy_static;
use libR_sys::*;
use log::*;
use regex::Captures;
use regex::Regex;
use serde::Deserialize;
use serde::Serialize;
use stdext::join::joined;
use stdext::unwrap::IntoOption;
use stdext::unwrap::IntoResult;
use stdext::*;
use tower_lsp::lsp_types::Command;
use tower_lsp::lsp_types::CompletionItem;
use tower_lsp::lsp_types::CompletionItemKind;
use tower_lsp::lsp_types::CompletionParams;
use tower_lsp::lsp_types::Documentation;
use tower_lsp::lsp_types::InsertTextFormat;
use tower_lsp::lsp_types::MarkupContent;
use tower_lsp::lsp_types::MarkupKind;
use tower_lsp::lsp_types::TextDocumentPositionParams;
use tree_sitter::Node;
use tree_sitter::Point;
use yaml_rust::YamlLoader;

use crate::lsp::backend::Backend;
use crate::lsp::documents::Document;
use crate::lsp::help::RHtmlHelp;
use crate::lsp::indexer;
use crate::lsp::signature_help::signature_help;
use crate::lsp::traits::cursor::TreeCursorExt;
use crate::lsp::traits::node::NodeExt;
use crate::lsp::traits::point::PointExt;
use crate::lsp::traits::position::PositionExt;
use crate::lsp::traits::string::StringExt;
use crate::lsp::traits::tree::TreeExt;

lazy_static! {
    // NOTE: Regex::new() is quite slow to compile, so it's much better to keep
    // a single singleton pattern and use that repeatedly for matches.
    static ref RE_SYNTACTIC_IDENTIFIER : Regex =
        Regex::new(r"^[\p{L}\p{Nl}.][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}.]*$").unwrap();
}

#[derive(Serialize, Deserialize, Debug)]
pub enum CompletionData {
    DataVariable {
        name: String,
        owner: String,
    },
    Directory {
        path: PathBuf,
    },
    File {
        path: PathBuf,
    },
    Function {
        name: String,
        package: Option<String>,
    },
    Object {
        name: String,
    },
    Package {
        name: String,
    },
    Parameter {
        name: String,
        function: String,
    },
    RoxygenTag {
        tag: String,
    },
    ScopeParameter {
        name: String,
    },
    ScopeVariable {
        name: String,
    },
    Snippet {
        text: String,
    },
    Unknown,
}

#[derive(Debug)]
pub struct CompletionContext<'a> {
    pub document: &'a Document,
    pub node: Node<'a>,
    pub source: String,
    pub point: Point,
    pub include_hidden: bool,
}

fn is_pipe_operator(node: &Node) -> bool {
    matches!(node.kind(), "%>%" | "|>")
}

fn is_syntactic(name: &str) -> bool {
    return RE_SYNTACTIC_IDENTIFIER.is_match(name);
}

fn quote_if_non_syntactic(name: &str) -> String {
    if RE_SYNTACTIC_IDENTIFIER.is_match(name) {
        name.to_string()
    } else {
        format!("`{}`", name.replace("`", "\\`"))
    }
}

fn call_uses_nse(node: &Node, context: &CompletionContext) -> bool {
    let result: Result<()> = local! {

        let lhs = node.child(0).into_result()?;
        matches!(lhs.kind(), "identifier" | "string").into_result()?;

        let value = lhs.utf8_text(context.source.as_bytes())?;
        matches!(value, "expression" | "local" | "quote" | "enquote" | "substitute" | "with" | "within").into_result()?;

        Ok(())

    };

    result.is_ok()
}

unsafe fn resolve_package_completion_item(
    item: &mut CompletionItem,
    package: &str,
) -> Result<bool> {
    let topic = join!(package, "-package");
    let help = unwrap!(RHtmlHelp::new(topic.as_str(), Some(package))?, None => {
        return Ok(false);
    });

    let markup = help.markdown()?;
    let markup = MarkupContent {
        kind: MarkupKind::Markdown,
        value: markup.to_string(),
    };

    item.detail = None;
    item.documentation = Some(Documentation::MarkupContent(markup));

    Ok(true)
}

unsafe fn resolve_function_completion_item(
    item: &mut CompletionItem,
    name: &str,
    package: Option<&str>,
) -> Result<bool> {
    let help = unwrap!(RHtmlHelp::new(name, package)?, None => {
        return Ok(false);
    });

    let markup = help.markdown()?;

    let markup = MarkupContent {
        kind: MarkupKind::Markdown,
        value: markup,
    };

    item.documentation = Some(Documentation::MarkupContent(markup));

    Ok(true)
}

// TODO: Include package as well here?
unsafe fn resolve_parameter_completion_item(
    item: &mut CompletionItem,
    name: &str,
    function: &str,
) -> Result<bool> {
    // Get help for this function.
    let help = unwrap!(RHtmlHelp::new(function, None)?, None => {
        return Ok(false);
    });

    // Extract the relevant parameter help.
    let markup = unwrap!(help.parameter(name)?, None => {
        return Ok(false);
    });

    // Build the actual markup content.
    // We found it; amend the documentation.
    item.detail = Some(format!("{}()", function));
    item.documentation = Some(Documentation::MarkupContent(markup));
    Ok(true)
}

#[allow(unused_variables)]
pub unsafe fn resolve_completion_item(
    item: &mut CompletionItem,
    data: &CompletionData,
) -> Result<bool> {
    match data {
        CompletionData::DataVariable { name, owner } => Ok(false),
        CompletionData::Directory { path } => Ok(false),
        CompletionData::File { path } => Ok(false),
        CompletionData::Function { name, package } => {
            resolve_function_completion_item(item, name, package.as_deref())
        },
        CompletionData::Package { name } => resolve_package_completion_item(item, name),
        CompletionData::Parameter { name, function } => {
            resolve_parameter_completion_item(item, name, function)
        },
        CompletionData::Object { name } => Ok(false),
        CompletionData::RoxygenTag { tag } => Ok(false),
        CompletionData::ScopeVariable { name } => Ok(false),
        CompletionData::ScopeParameter { name } => Ok(false),
        CompletionData::Snippet { text } => Ok(false),
        CompletionData::Unknown => Ok(false),
    }
}

fn completion_item(label: impl AsRef<str>, data: CompletionData) -> Result<CompletionItem> {
    Ok(CompletionItem {
        label: label.as_ref().to_string(),
        data: Some(serde_json::to_value(data)?),
        ..Default::default()
    })
}

fn completion_item_from_file(entry: DirEntry) -> Result<CompletionItem> {
    let name = entry.file_name().to_string_lossy().to_string();
    let mut item = completion_item(name, CompletionData::File { path: entry.path() })?;

    item.kind = Some(CompletionItemKind::FILE);
    Ok(item)
}

fn completion_item_from_directory(entry: DirEntry) -> Result<CompletionItem> {
    let mut name = entry.file_name().to_string_lossy().to_string();
    name.push_str("/");

    let mut item = completion_item(&name, CompletionData::Directory { path: entry.path() })?;

    item.kind = Some(CompletionItemKind::FOLDER);
    item.command = Some(Command {
        title: "Trigger Suggest".to_string(),
        command: "editor.action.triggerSuggest".to_string(),
        ..Default::default()
    });

    Ok(item)
}

fn completion_item_from_direntry(entry: DirEntry) -> Result<CompletionItem> {
    let is_dir = entry
        .file_type()
        .map(|value| value.is_dir())
        .unwrap_or(false);
    if is_dir {
        return completion_item_from_directory(entry);
    } else {
        return completion_item_from_file(entry);
    }
}

fn completion_item_from_assignment(
    node: &Node,
    context: &CompletionContext,
) -> Result<CompletionItem> {
    let lhs = node.child_by_field_name("lhs").into_result()?;
    let rhs = node.child_by_field_name("rhs").into_result()?;

    let label = lhs.utf8_text(context.source.as_bytes())?;

    // TODO: Resolve functions that exist in-document here.
    let mut item = completion_item(label, CompletionData::ScopeVariable {
        name: label.to_string(),
    })?;

    let markup = MarkupContent {
        kind: MarkupKind::Markdown,
        value: format!(
            "Defined in this document on line {}.",
            lhs.start_position().row + 1
        ),
    };

    item.detail = Some(label.to_string());
    item.documentation = Some(Documentation::MarkupContent(markup));
    item.kind = Some(CompletionItemKind::VARIABLE);

    if rhs.kind() == "function" {
        if let Some(parameters) = rhs.child_by_field_name("parameters") {
            let parameters = parameters.utf8_text(context.source.as_bytes())?;
            item.detail = Some(join!(label, parameters));
        }

        item.kind = Some(CompletionItemKind::FUNCTION);
        item.insert_text_format = Some(InsertTextFormat::SNIPPET);
        item.insert_text = Some(format!("{}($0)", label));
    }

    return Ok(item);
}

unsafe fn completion_item_from_package(
    package: &str,
    append_colons: bool,
) -> Result<CompletionItem> {
    let mut item = completion_item(package.to_string(), CompletionData::Package {
        name: package.to_string(),
    })?;

    item.kind = Some(CompletionItemKind::MODULE);

    if append_colons {
        item.insert_text_format = Some(InsertTextFormat::SNIPPET);
        item.insert_text = Some(format!("{}::", package));
        item.command = Some(Command {
            title: "Trigger Suggest".to_string(),
            command: "editor.action.triggerSuggest".to_string(),
            ..Default::default()
        });
    }

    return Ok(item);
}

pub fn completion_item_from_function<T: AsRef<str>>(
    name: &str,
    envir: Option<&str>,
    parameters: &[T],
) -> Result<CompletionItem> {
    let label = format!("{}", name);
    let mut item = completion_item(label, CompletionData::Function {
        name: name.to_string(),
        package: envir.map(|s| s.to_string()),
    })?;

    item.kind = Some(CompletionItemKind::FUNCTION);

    let detail = format!("{}({})", name, joined(parameters, ", "));
    item.detail = Some(detail);

    item.insert_text_format = Some(InsertTextFormat::SNIPPET);
    item.insert_text = if is_syntactic(name) {
        Some(format!("{}($0)", name))
    } else {
        Some(format!("`{}`($0)", name.replace("`", "\\`")))
    };

    // provide parameter completions after completiong function
    item.command = Some(Command {
        title: "Trigger Parameter Hints".to_string(),
        command: "editor.action.triggerParameterHints".to_string(),
        ..Default::default()
    });

    return Ok(item);
}

// TODO
unsafe fn completion_item_from_dataset(name: &str) -> Result<CompletionItem> {
    let mut item = completion_item(name.to_string(), CompletionData::Unknown)?;
    item.kind = Some(CompletionItemKind::STRUCT);
    Ok(item)
}
unsafe fn completion_item_from_data_variable(
    name: &str,
    owner: &str,
    enquote: bool,
) -> Result<CompletionItem> {
    let mut item = completion_item(name.to_string(), CompletionData::DataVariable {
        name: name.to_string(),
        owner: owner.to_string(),
    })?;

    if enquote {
        item.insert_text = Some(format!("\"{}\"", name));
    }

    item.detail = Some(owner.to_string());
    item.kind = Some(CompletionItemKind::VARIABLE);

    Ok(item)
}

unsafe fn completion_item_from_object(
    name: &str,
    mut object: SEXP,
    envir: SEXP,
) -> Result<CompletionItem> {
    // TODO: Can we figure out the object type without forcing promise evaluation?
    if TYPEOF(object) as u32 == PROMSXP {
        let mut errc = 0;
        object = R_tryEvalSilent(object, envir, &mut errc);
        if errc != 0 {
            bail!("Error creating completion item: {}", geterrmessage());
        }
    }

    // TODO: For some functions (e.g. S4 generics?) the help file might be
    // associated with a separate package. See 'stats4::AIC()' for one example.
    //
    // In other words, when creating a completion item for these functions,
    // we should also figure out where we can receive the help from.
    if Rf_isFunction(object) != 0 {
        let envir = r_envir_name(envir)?;
        let formals = r_formals(object)?;
        let arguments = formals
            .iter()
            .map(|formal| formal.name.as_str())
            .collect::<Vec<_>>();
        return completion_item_from_function(name, Some(envir.as_str()), &arguments);
    }

    let mut item = completion_item(name, CompletionData::Object {
        name: name.to_string(),
    })?;

    item.detail = Some("(Object)".to_string());
    item.kind = Some(CompletionItemKind::STRUCT);

    Ok(item)
}

unsafe fn completion_item_from_namespace(name: &str, namespace: SEXP) -> Result<CompletionItem> {
    let symbol = r_symbol!(name);

    // First, look in the namespace itself.
    let object = Rf_findVarInFrame(namespace, symbol);
    if object != R_UnboundValue {
        return completion_item_from_object(name, object, namespace);
    }

    // Otherwise, try the imports environment.
    let imports = ENCLOS(namespace);
    let object = Rf_findVarInFrame(imports, symbol);
    if object != R_UnboundValue {
        return completion_item_from_object(name, object, namespace);
    }

    bail!(
        "Object '{}' not defined in namespace {:?}",
        name,
        r_envir_name(namespace)?
    );
}

unsafe fn completion_item_from_symbol(name: &str, envir: SEXP) -> Result<CompletionItem> {
    let symbol = r_symbol!(name);
    let object = Rf_findVarInFrame(envir, symbol);
    if object == R_UnboundValue {
        bail!("Object '{}' not defined in environment {:?}", name, envir);
    }

    return completion_item_from_object(name, object, envir);
}

// This is used when providing completions for a parameter in a document
// that is considered in-scope at the cursor position.
fn completion_item_from_scope_parameter(
    parameter: &str,
    _context: &CompletionContext,
) -> Result<CompletionItem> {
    let mut item = completion_item(parameter, CompletionData::ScopeParameter {
        name: parameter.to_string(),
    })?;

    item.kind = Some(CompletionItemKind::VARIABLE);
    Ok(item)
}

unsafe fn completion_item_from_parameter(parameter: &str, callee: &str) -> Result<CompletionItem> {
    let label = quote_if_non_syntactic(parameter);
    let mut item = completion_item(label, CompletionData::Parameter {
        name: parameter.to_string(),
        function: callee.to_string(),
    })?;

    // TODO: It'd be nice if we could be smarter about how '...' completions are handled,
    // but evidently VSCode doesn't let us set an empty 'insert text' string here.
    // Might be worth fixing upstream.
    item.kind = Some(CompletionItemKind::FIELD);
    item.insert_text_format = Some(InsertTextFormat::SNIPPET);
    item.insert_text = if parameter == "..." {
        Some("...".to_string())
    } else {
        Some(parameter.to_string() + " = ")
    };

    Ok(item)
}

pub fn completion_context<'a>(
    document: &'a Document,
    position: &TextDocumentPositionParams,
) -> Result<CompletionContext<'a>> {
    // get reference to AST
    let ast = &document.ast;

    // try to find node at completion position
    let point = position.position.as_point();

    // use the node to figure out the completion token
    let node = ast.node_at_point(point);
    let source = document.contents.to_string();

    // track whether we should include hidden completions
    let text = node.utf8_text(source.as_bytes())?;
    let include_hidden = text.starts_with(".");

    // build completion context
    Ok(CompletionContext {
        document,
        node,
        source,
        point,
        include_hidden,
    })
}

fn append_defined_variables(
    node: &Node,
    context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) {
    let visited: HashSet<usize> = HashSet::new();

    let mut cursor = node.walk();
    cursor.recurse(|node| {
        // skip nodes that exist beyond the completion position
        if node.start_position().is_after(context.point) {
            return false;
        }

        // skip nodes that were already visited
        if visited.contains(&node.id()) {
            return false;
        }

        match node.kind() {
            "=" | "<-" | "<<-" => {
                // check that the left-hand side is an identifier or a string
                if let Some(child) = node.child(0) {
                    if matches!(child.kind(), "identifier" | "string") {
                        match completion_item_from_assignment(&node, context) {
                            Ok(item) => completions.push(item),
                            Err(error) => error!("{:?}", error),
                        }
                    }
                }

                // return true in case we have nested assignments
                return true;
            },

            "->" | "->>" => {
                // return true for nested assignments
                return true;
            },

            "call" => {
                // don't recurse into calls for certain functions
                return !call_uses_nse(&node, context);
            },

            "function" => {
                // don't recurse into function definitions, as these create as new scope
                // for variable definitions (and so such definitions are no longer visible)
                return false;
            },

            _ => {
                return true;
            },
        }
    });
}

// TODO: Pick a name that makes it clear this is a function defined in the associated document.
fn append_function_parameters(
    node: &Node,
    context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    // get the parameters node
    let parameters = node.child_by_field_name("parameters").into_result()?;

    // iterate through the children, looking for parameters with known names
    let mut cursor = parameters.walk();
    for node in parameters.children(&mut cursor) {
        if node.kind() != "parameter" {
            continue;
        }

        let node = unwrap!(node.child_by_field_name("name"), None => {
            continue;
        });

        if node.kind() != "identifier" {
            continue;
        }

        let parameter = node.utf8_text(context.source.as_bytes()).into_result()?;
        match completion_item_from_scope_parameter(parameter, context) {
            Ok(item) => completions.push(item),
            Err(error) => error!("{:?}", error),
        }
    }

    Ok(())
}

unsafe fn list_namespace_exports(namespace: SEXP) -> RObject {
    let ns = Rf_findVarInFrame(namespace, r_symbol!(".__NAMESPACE__."));
    if ns == R_UnboundValue {
        return RObject::null();
    }

    let exports = Rf_findVarInFrame(ns, r_symbol!("exports"));
    if exports == R_UnboundValue {
        return RObject::null();
    }

    return RObject::new(R_lsInternal(exports, 1));
}

unsafe fn list_namespace_symbols(namespace: SEXP) -> RObject {
    return RObject::new(R_lsInternal(namespace, 1));
}

unsafe fn append_subset_completions(
    _context: &CompletionContext,
    callee: &str,
    enquote: bool,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    info!("append_subset_completions({:?})", callee);

    let value = r_parse_eval(callee, RParseEvalOptions {
        forbid_function_calls: true,
    })?;

    let names = RFunction::new("base", "names")
        .add(value)
        .call()?
        .to::<Vec<String>>()?;

    for name in names {
        match completion_item_from_data_variable(&name, callee, enquote) {
            Ok(item) => completions.push(item),
            Err(error) => error!("{:?}", error),
        }
    }

    Ok(())
}

unsafe fn append_custom_completions(
    context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) -> Result<bool> {
    // Use the signature help tools to figure out the necessary pieces.
    let position = context.point.as_position();
    let signatures = signature_help(context.document, &position)?;

    let signatures = unwrap!(signatures, None => {
        return Ok(false);
    });

    // Pull out the relevant signature information.
    let signature = signatures.signatures.get(0).into_result()?;
    let mut name = signature.label.clone();
    let parameters = signature.parameters.as_ref().into_result()?;
    let index = signature.active_parameter.into_result()?;
    let parameter = parameters.get(index as usize).into_result()?;

    // Extract the argument text.
    let argument = match parameter.label.clone() {
        tower_lsp::lsp_types::ParameterLabel::LabelOffsets([start, end]) => {
            let label = signature.label.as_str();
            let substring = label.get((start as usize)..(end as usize));
            substring.unwrap().to_string()
        },
        tower_lsp::lsp_types::ParameterLabel::Simple(string) => string,
    };

    // Trim off the function arguments from the signature.
    if let Some(index) = name.find('(') {
        name = name[0..index].to_string();
    }

    // Check and see if we're in the 'name' position,
    // versus the 'value' position, for a function invocation.
    //
    // For example:
    //
    //    Sys.setenv(EDITOR = "vim")
    //               ^^^^^^   ^^^^^
    //                name    value
    //
    // This is mainly relevant because we might only want to
    // provide certain completions in the 'name' position.
    let node = context.document.ast.node_at_point(context.point);

    let marker = node.bwd_leaf_iter().find_map(|node| match node.kind() {
        "(" | "comma" => Some("name"),
        "=" => Some("value"),
        _ => None,
    });

    let position = marker.unwrap_or("value");

    // Call our custom completion function.
    let r_completions = RFunction::from(".ps.completions.getCustomCallCompletions")
        .param("name", name)
        .param("argument", argument)
        .param("position", position)
        .call()?;

    if r_typeof(*r_completions) != VECSXP {
        return Ok(false);
    }

    // TODO: Use safe access APIs here.
    let values = VECTOR_ELT(*r_completions, 0);
    let kind = VECTOR_ELT(*r_completions, 1);
    let enquote = VECTOR_ELT(*r_completions, 2);
    let append = VECTOR_ELT(*r_completions, 3);
    if let Ok(values) = RObject::view(values).to::<Vec<String>>() {
        let kind = RObject::view(kind)
            .to::<String>()
            .unwrap_or("unknown".to_string());
        let enquote = RObject::view(enquote).to::<bool>().unwrap_or(false);
        let append = RObject::view(append)
            .to::<String>()
            .unwrap_or("".to_string());
        for value in values.iter() {
            let value = value.clone();
            let item = match kind.as_str() {
                "package" => completion_item_from_package(&value, false),
                "dataset" => completion_item_from_dataset(&value),
                _ => completion_item(&value, CompletionData::Unknown),
            };

            let mut item = unwrap!(item, Err(error) => {
                log::error!("{}", error);
                continue;
            });

            if enquote && node.kind() != "string" {
                item.insert_text = Some(format!("\"{}\"", value));
            } else if !append.is_empty() {
                item.insert_text = Some(format!("{}{}", value, append));
            }

            completions.push(item);
        }
    }

    Ok(true)
}

unsafe fn append_call_completions(
    context: &CompletionContext,
    _cursor: &Node,
    node: &Node,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    let callee = node
        .child(0)
        .into_result()?
        .utf8_text(context.source.as_bytes())?;
    append_argument_completions(context, &callee, completions)
}

fn find_pipe_root(mut node: Node) -> Option<Node> {
    let mut root = None;

    loop {
        if is_pipe_operator(&node) {
            root = Some(node);
        }

        node = match node.parent() {
            Some(node) => node,
            None => return root,
        }
    }
}

unsafe fn append_pipe_completions(
    context: &CompletionContext,
    node: &Node,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    // Try to figure out the code associated with the 'root' of the pipe expression.
    let root = local! {

        let root = find_pipe_root(*node)?;
        is_pipe_operator(&root).into_option()?;

        // Get the left-hand side of the pipe expression.
        let mut lhs = root.child_by_field_name("lhs")?;
        while is_pipe_operator(&lhs) {
            lhs = lhs.child_by_field_name("lhs")?;
        }

        // Try to evaluate the left-hand side
        let root = lhs.utf8_text(context.source.as_bytes()).ok()?;
        Some(root)

    };

    let root = unwrap!(root, None => {
        return Ok(());
    });

    let value = r_parse_eval(root, RParseEvalOptions {
        forbid_function_calls: true,
    })?;

    // Try to retrieve names from the resulting item
    let names = RFunction::new("base", "names")
        .add(value)
        .call()?
        .to::<Vec<String>>()?;

    for name in names {
        let item = completion_item_from_data_variable(&name, root, false)?;
        completions.push(item);
    }

    Ok(())
}

unsafe fn append_argument_completions(
    _context: &CompletionContext,
    callee: &str,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    info!("append_argument_completions({:?})", callee);

    // Check for a function defined in the workspace that can provide parameters.
    if let Some((_path, entry)) = indexer::find(callee) {
        #[allow(unused)]
        match entry.data {
            indexer::IndexEntryData::Function { name, arguments } => {
                for argument in arguments {
                    match completion_item_from_parameter(argument.as_str(), name.as_str()) {
                        Ok(item) => completions.push(item),
                        Err(error) => error!("{:?}", error),
                    }
                }
            },

            indexer::IndexEntryData::Section { level, title } => {
                // nothing to do
            },
        }
    }

    // TODO: Given the callee, we should also try to find its definition within
    // the document index of function definitions, since it may not be defined
    // within the session.
    let value = r_parse_eval(callee, RParseEvalOptions {
        forbid_function_calls: true,
    })?;

    if Rf_isFunction(*value) != 0 {
        let strings = RFunction::from(".ps.completions.formalNames")
            .add(*value)
            .call()?
            .to::<Vec<String>>()?;

        // Return the names of these formals.
        for string in strings.iter() {
            match completion_item_from_parameter(string, callee) {
                Ok(item) => completions.push(item),
                Err(error) => error!("{:?}", error),
            }
        }
    }

    Ok(())
}

unsafe fn append_namespace_completions(
    _context: &CompletionContext,
    package: &str,
    exports_only: bool,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    info!(
        "append_namespace_completions({:?}, {})",
        package, exports_only
    );

    // Get the package namespace.
    let namespace = RFunction::new("base", "getNamespace").add(package).call()?;

    let symbols = if package == "base" {
        list_namespace_symbols(*namespace)
    } else if exports_only {
        list_namespace_exports(*namespace)
    } else {
        list_namespace_symbols(*namespace)
    };

    let strings = symbols.to::<Vec<String>>()?;
    for string in strings.iter() {
        match completion_item_from_namespace(string, *namespace) {
            Ok(item) => completions.push(item),
            Err(error) => error!("{:?}", error),
        }
    }

    Ok(())
}

fn append_keyword_completions(completions: &mut Vec<CompletionItem>) -> anyhow::Result<()> {
    // add some built-in snippet completions for control flow
    // NOTE: We don't use placeholder names for the final cursor locations below,
    // as the editting experience is not great (e.g. trying to insert a '{' will
    // cause the editor to just surround the snippet text with '{}'.
    let snippets = vec![
        ("function", "function(${1:arguments}) $0"),
        ("while", "while (${1:condition}) $0"),
        ("repeat", "repeat $0"),
        ("for", "for (${1:variable} in ${2:vector}) $0"),
        ("if", "if (${1:condition}) $0"),
        ("return", "return(${0:value})"),
    ];

    for snippet in snippets {
        let label = snippet.0.to_string();
        let mut item = completion_item(label.to_string(), CompletionData::Snippet {
            text: label.clone(),
        })?;

        item.detail = Some("[keyword]".to_string());
        item.insert_text_format = Some(InsertTextFormat::SNIPPET);
        item.insert_text = Some(snippet.1.to_string());

        completions.push(item);
    }

    // provide other completion results
    // NOTE: Some R keywords have definitions provided in the R
    // base namespace, so we don't need to provide duplicate
    // definitions for these here.
    let keywords = vec![
        "NULL",
        "NA",
        "TRUE",
        "FALSE",
        "Inf",
        "NaN",
        "NA_integer_",
        "NA_real_",
        "NA_character_",
        "NA_complex_",
        "in",
        "else",
        "next",
        "break",
    ];

    for keyword in keywords {
        let mut item = CompletionItem::new_simple(keyword.to_string(), "[keyword]".to_string());
        item.kind = Some(CompletionItemKind::KEYWORD);
        completions.push(item);
    }

    Ok(())
}

unsafe fn append_search_path_completions(
    _context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    // start with keywords
    append_keyword_completions(completions)?;

    // Iterate through environments starting from the global environment.
    let mut envir = R_GlobalEnv;

    while envir != R_EmptyEnv {
        // List symbols in the environment.
        let symbols = R_lsInternal(envir, 1);

        // Create completion items for each.
        let mut strings = RObject::new(symbols).to::<Vec<String>>()?;

        // If this is the base environment, we'll want to remove some
        // completion items (mainly, control flow keywords which don't
        // behave like "regular" functions.)
        if envir == R_BaseEnv || envir == R_BaseNamespace {
            strings.retain(|name| {
                !matches!(
                    name.as_str(),
                    "if" | "else" |
                        "for" |
                        "in" |
                        "while" |
                        "repeat" |
                        "break" |
                        "next" |
                        "return" |
                        "function"
                )
            });
        }

        for string in strings.iter() {
            match completion_item_from_symbol(string, envir) {
                Ok(item) => completions.push(item),
                Err(error) => error!("{:?}", error),
            }
        }

        // Get the next environment.
        envir = ENCLOS(envir);
    }

    // Include installed packages as well.
    // TODO: This can be slow on NFS.
    let packages = RFunction::new("base", ".packages")
        .param("all.available", true)
        .call()?;

    let strings = packages.to::<Vec<String>>()?;
    for string in strings.iter() {
        let item = completion_item_from_package(string, true)?;
        completions.push(item);
    }

    Ok(())
}

unsafe fn append_roxygen_completions(
    _token: &str,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    // TODO: cache these?
    // TODO: use an indexer to build the tag list?
    let tags = RFunction::new("base", "system.file")
        .param("package", "roxygen2")
        .add("roxygen2-tags.yml")
        .call()?
        .to::<String>()?;

    if tags.is_empty() {
        return Ok(());
    }

    let tags = Path::new(&tags);
    if !tags.exists() {
        return Ok(());
    }

    let contents = std::fs::read_to_string(tags).unwrap();
    let docs = YamlLoader::load_from_str(contents.as_str()).unwrap();
    let doc = &docs[0];

    let items = doc.as_vec().unwrap();
    for entry in items.iter() {
        let name = unwrap!(entry["name"].as_str(), None => {
            continue;
        });

        let label = name.to_string();
        let mut item = completion_item(label.clone(), CompletionData::RoxygenTag {
            tag: label.clone(),
        })?;

        // TODO: What is the appropriate icon for us to use here?
        let template = entry["template"].as_str();
        if let Some(template) = template {
            let text = format!("{}{}", name, template);
            let pattern = Regex::new(r"\{([^}]+)\}").unwrap();

            let mut count = 0;
            let text = pattern.replace_all(&text, |caps: &Captures| {
                count += 1;
                let capture = caps.get(1).map_or("", |m| m.as_str());
                format!("${{{}:{}}}", count, capture)
            });

            item.insert_text_format = Some(InsertTextFormat::SNIPPET);
            item.insert_text = Some(text.to_string());
        } else {
            item.insert_text = Some(format!("@{}", label.as_str()));
        }

        item.detail = Some(format!("@{}{}", name, template.unwrap_or("")));
        if let Some(description) = entry["description"].as_str() {
            let markup = MarkupContent {
                kind: MarkupKind::Markdown,
                value: description.to_string(),
            };
            item.documentation = Some(Documentation::MarkupContent(markup));
        }

        completions.push(item);
    }

    return Ok(());
}

pub fn can_provide_completions(document: &mut Document, params: &CompletionParams) -> Result<bool> {
    // figure out the token / node at the cursor position. note that we use
    // the previous token here as the cursor itself will be located just past
    // the cursor / node providing the associated context
    let mut point = params.text_document_position.position.as_point();
    if point.column > 1 {
        point.column -= 1;
    }

    let node = document.ast.node_at_point(point);
    let source = document.contents.to_string();
    let value = node.utf8_text(source.as_bytes())?;

    // completions will be triggered as the user types ':', which implies that
    // a completion request could be sent before the user has finished typing
    // '::' or ':::'. detect this particular case and don't provide completions
    // in that context
    if value == ":" {
        return Ok(false);
    }

    return Ok(true);
}

unsafe fn append_file_completions(
    context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    // Get the contents of the string token.
    //
    // NOTE: This includes the quotation characters on the string, and so
    // also includes any internal escapes! We need to decode the R string
    // before searching the path entries.
    let token = context.node.utf8_text(context.source.as_bytes())?;
    let contents = r_string_decode(token).into_result()?;
    log::info!("String value (decoded): {}", contents);

    // Use R to normalize the path.
    let path = RFunction::new("base", "normalizePath")
        .param("path", contents)
        .param("winslash", "/")
        .param("mustWork", false)
        .call()?
        .to::<String>()?;

    // parse the file path and get the directory component
    let mut path = PathBuf::from(path.as_str());
    log::info!("Normalized path: {}", path.display());

    // if this path doesn't have a root, add it on
    if !path.has_root() {
        let root = current_dir()?;
        path = root.join(path);
    }

    // if this isn't a directory, get the parent path
    if !path.is_dir() {
        if let Some(parent) = path.parent() {
            path = parent.to_path_buf();
        }
    }

    // look for files in this directory
    log::info!("Reading directory: {}", path.display());
    let entries = std::fs::read_dir(path)?;
    for entry in entries.into_iter() {
        let entry = unwrap!(entry, Err(error) => {
            log::error!("{}", error);
            continue;
        });

        let item = unwrap!(completion_item_from_direntry(entry), Err(error) => {
            log::error!("{}", error);
            continue;
        });

        completions.push(item);
    }

    Ok(())
}

pub unsafe fn append_session_completions(
    context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    info!("append_session_completions()");

    // get reference to AST
    let cursor = context.node;
    let mut node = cursor;

    // check for completion within a comment -- in such a case, we usually
    // want to complete things like roxygen tags
    //
    // TODO: should some of this token processing happen in treesitter?
    if node.kind() == "comment" {
        let pattern = Regex::new(r"^.*\s").unwrap();
        let contents = node.utf8_text(context.source.as_bytes()).unwrap();
        let token = pattern.replace(contents, "");
        if token.starts_with('@') {
            return append_roxygen_completions(&token[1..], completions);
        } else {
            return Ok(());
        }
    }

    let mut use_search_path = true;
    let mut found_call_completions = false;

    loop {
        // Check for 'subset' completions.
        if matches!(node.kind(), "$" | "[" | "[[") {
            let enquote = matches!(node.kind(), "[" | "[[");
            if let Some(child) = node.child(0) {
                let text = child.utf8_text(context.source.as_bytes())?;
                append_subset_completions(context, &text, enquote, completions)?;
            }
        }

        // If we landed on a 'call', then we should provide parameter completions
        // for the associated callee if possible.
        if !found_call_completions && node.kind() == "call" {
            found_call_completions = true;

            // Check for library() completions.
            match append_custom_completions(context, completions) {
                Ok(done) => {
                    if done {
                        return Ok(());
                    }
                },
                Err(error) => error!("{}", error),
            }

            // Check for pipe completions.
            append_pipe_completions(context, &node, completions)?;

            // Check for generic call completions.
            append_call_completions(context, &cursor, &node, completions)?;
        }

        // Handle the case with 'package::prefix', where the user has now
        // started typing the prefix of the symbol they would like completions for.
        if matches!(node.kind(), "::" | ":::") {
            let exports_only = node.kind() == "::";
            if let Some(node) = node.child(0) {
                let package = node.utf8_text(context.source.as_bytes())?;
                append_namespace_completions(context, package, exports_only, completions)?;
                use_search_path = false;
                break;
            }
        }

        // If we reach a brace list, bail.
        if node.kind() == "{" {
            break;
        }

        // Update the node.
        node = match node.parent() {
            Some(node) => node,
            None => break,
        };
    }

    // If we get here, and we were located within a string,
    // just provide file completions.
    if cursor.kind() == "string" {
        return append_file_completions(context, completions);
    }

    // If we got here, then it's appropriate to return completions
    // for any packages + symbols on the search path.
    if use_search_path {
        append_search_path_completions(context, completions)?;
    }

    Ok(())
}

pub fn append_document_completions(
    context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    // get reference to AST
    let mut node = context.node;

    // skip comments
    if node.kind() == "comment" {
        trace!("cursor position lies within R comment; not providing document completions");
        return Ok(());
    }

    // don't complete following subset-style operators
    if matches!(node.kind(), "::" | ":::" | "$" | "[" | "[[") {
        return Ok(());
    }

    let mut visited: HashSet<usize> = HashSet::new();
    loop {
        // If this is a brace list, or the document root, recurse to find identifiers.
        if node.kind() == "{" || node.parent() == None {
            append_defined_variables(&node, context, completions);
        }

        // If this is a function definition, add parameter names.
        if node.kind() == "function" {
            let result = append_function_parameters(&node, context, completions);
            if let Err(error) = result {
                error!("{:?}", error);
            }
        }

        // Mark this node as visited.
        visited.insert(node.id());

        // Keep going.
        node = match node.parent() {
            Some(node) => node,
            None => break,
        };
    }

    Ok(())
}

pub fn append_workspace_completions(
    backend: &Backend,
    context: &CompletionContext,
    completions: &mut Vec<CompletionItem>,
) -> Result<()> {
    // TODO: Don't provide completions if token is empty in certain contexts
    // (e.g. parameter completions or something like that)
    if matches!(context.node.kind(), "::" | ":::") {
        return Ok(());
    }

    if let Some(parent) = context.node.parent() {
        if matches!(parent.kind(), "::" | ":::") {
            return Ok(());
        }
    }

    if matches!(context.node.kind(), "string") {
        return Ok(());
    }

    let token = if context.node.kind() == "identifier" {
        context.node.utf8_text(context.source.as_bytes())?
    } else {
        ""
    };

    // get entries from the index
    indexer::map(|path, symbol, entry| {
        if !symbol.fuzzy_matches(token) {
            return;
        }

        match &entry.data {
            indexer::IndexEntryData::Function { name, arguments } => {
                let mut completion = unwrap!(completion_item_from_function(name, None, arguments), Err(error) => {
                    error!("{:?}", error);
                    return;
                });

                // add some metadata about where the completion was found
                let mut path = path.to_str().unwrap_or_default();
                let workspace = backend.workspace.lock();
                for folder in &workspace.folders {
                    if let Ok(folder) = folder.to_file_path() {
                        if let Some(folder) = folder.to_str() {
                            if path.starts_with(folder) {
                                path = &path[folder.len() + 1..];
                                break;
                            }
                        }
                    }
                }

                let value = format!(
                    "Defined in `{}` on line {}.",
                    path,
                    entry.range.start.line + 1
                );
                let markup = MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: value,
                };

                completion.documentation = Some(Documentation::MarkupContent(markup));
                completions.push(completion);
            },

            indexer::IndexEntryData::Section { level: _, title: _ } => {},
        }
    });

    Ok(())
}
