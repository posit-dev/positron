//
// completions.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::collections::HashSet;
use std::path::Path;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use harp::eval::RParseEvalOptions;
use harp::eval::r_parse_eval;
use harp::exec::geterrmessage;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::r_lock;
use harp::r_symbol;
use lazy_static::lazy_static;
use libR_sys::*;
use log::*;
use regex::Captures;
use regex::Regex;
use scraper::ElementRef;
use scraper::Html;
use scraper::Selector;
use serde::Deserialize;
use serde::Serialize;
use stdext::*;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::Command;
use tower_lsp::lsp_types::CompletionItem;
use tower_lsp::lsp_types::CompletionItemKind;
use tower_lsp::lsp_types::CompletionParams;
use tower_lsp::lsp_types::Documentation;
use tower_lsp::lsp_types::InsertTextFormat;
use tower_lsp::lsp_types::MarkupContent;
use tower_lsp::lsp_types::MarkupKind;
use tree_sitter::Node;
use tree_sitter::Point;
use yaml_rust::YamlLoader;

use crate::lsp::indexer::IndexedSymbol;
use crate::lsp::indexer::index_document;
use crate::lsp::document::Document;
use crate::lsp::traits::cursor::TreeCursorExt;
use crate::lsp::traits::node::NodeExt;
use crate::lsp::traits::point::PointExt;
use crate::lsp::traits::position::PositionExt;
use crate::lsp::traits::tree::TreeExt;

lazy_static! {
    // NOTE: Regex::new() is quite slow to compile, so it's much better to keep
    // a single singleton pattern and use that repeatedly for matches.
    static ref RE_SYNTACTIC_IDENTIFIER : Regex =
        Regex::new(r"^[\p{L}\p{Nl}.][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}.]*$").unwrap();
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CompletionData {
    value: String,
    source: Option<String>,
}

pub struct CompletionContext<'a> {
    pub document: &'a mut Document,
    pub token: String,
    pub source: String,
    pub point: Point,
    pub params: CompletionParams,
}

// TODO: Belongs somewhere else.
fn to_markdown(elt: ElementRef, buffer: &mut String) {

    for node in elt.children() {

        if let Some(elt) = ElementRef::wrap(node) {
            if elt.value().name() == "code" {
                buffer.push('`');
                to_markdown(elt, buffer);
                buffer.push('`');
            } else {
                to_markdown(elt, buffer);
            }
        } else if let Some(text) = node.value().as_text() {
            buffer.push_str(text.as_ref());
        }

    }
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

    // get the callee
    let lhs = unwrap!(node.child(0), {
        return false;
    });

    // validate we have an identifier or a string
    match lhs.kind() {
        "identifier" | "string" => {},
        _ => { return false; }
    }

    // check for a function whose evaluation occurs in a local scope
    let value = unwrap!(lhs.utf8_text(context.source.as_bytes()), {
        return false;
    });

    match value {
        "expression" | "local" | "quote" | "enquote" | "substitute" | "with" | "within" => { return true; },
        _ => { return false; }
    }

}

unsafe fn resolve_argument_completion_item(item: &mut CompletionItem, data: &CompletionData) -> Result<()> {

    let source = data.source.as_ref().into_result()?;
    let html = RFunction::from(".rs.help.getHtmlHelpContents")
        .add(source.as_ref())
        .call()?
        .to::<String>()?;

    // Find and parse the arguments in the HTML help. The help file has the structure:
    //
    // <h3>Arguments</h3>
    //
    // <table>
    // <tr style="vertical-align: top;"><td><code>parameter</code></td>
    // <td>
    // Parameter documentation.
    // </td></tr>

    let doc = Html::parse_document(html.as_str());
    let selector = Selector::parse("h3").unwrap();
    let mut headers = doc.select(&selector);
    let header = headers.find(|node| node.html() == "<h3>Arguments</h3>").into_result()?;

    // Find the table. Note that empty lines enter the AST, so we need to skip those
    // even though the table is the next element sibling.
    let table = header.next_siblings().find(|node| {
        node.value().as_element().map(|elt| elt.name() == "table").unwrap_or(false)
    }).into_result()?;

    // Wrap the table back into an element reference.
    let table = ElementRef::wrap(table).into_result()?;

    // I really wish R included classes on these table elements...
    let selector = Selector::parse(r#"tr[style="vertical-align: top;"] > td"#).unwrap();
    let mut cells = table.select(&selector);

    // Start iterating through pairs of cells.
    loop {

        // Get the parameters. Note that multiple parameters might be contained
        // within a single table cell, so we'll need to split that later.
        let lhs = unwrap!(cells.next(), { break });
        let parameters : String = lhs.text().collect();

        // Get the parameter description. We'll convert this from HTML to Markdown.
        let rhs = unwrap!(cells.next(), { break });

        // Check and see if we've found the parameter we care about.
        let pattern = Regex::new("\\s*,\\s*").unwrap();
        let mut params = pattern.split(parameters.as_str());
        let label = params.find(|&value| value == item.label);
        if label.is_none() {
            continue;
        }

        // We found the relevant parameter; add its documentation.
        let mut buffer = String::new();
        to_markdown(rhs, &mut buffer);
        let description = buffer.trim().to_string();

        let markup = MarkupContent {
            kind: MarkupKind::Markdown,
            value: description,
        };

        // Build the actual markup content.
        // We found it; amend the documentation.
        item.detail = Some(format!("{}()", source));
        item.documentation = Some(Documentation::MarkupContent(markup));
        return Ok(())

    }

    Ok(())


}

pub unsafe fn resolve_completion_item(item: &mut CompletionItem, data: &CompletionData) -> Result<()> {

    // Handle arguments specially.
    if let Some(kind) = item.kind {
        if kind == CompletionItemKind::FIELD {
            return resolve_argument_completion_item(item, data);
        }
    }

    Ok(())

}

fn completion_item_from_identifier(node: &Node, source: &str) -> Result<CompletionItem> {
    let label = node.utf8_text(source.as_bytes())?;
    let detail = format!("Defined on line {}", node.start_position().row + 1);
    return Ok(CompletionItem::new_simple(label.to_string(), detail));
}

fn completion_item_from_assignment(node: &Node, source: &str) -> Result<CompletionItem> {

    let lhs = node.child(0).context("unexpected missing assignment name")?;
    let rhs = node.child(2).context("unexpected missing assignment value")?;

    let label = lhs.utf8_text(source.as_bytes())?;
    let detail = format!("Defined on line {}", lhs.start_position().row + 1);

    let mut item = CompletionItem::new_simple(format!("{}()", label), detail);

    if rhs.kind() == "function_definition" {
        item.kind = Some(CompletionItemKind::FUNCTION);
        item.insert_text_format = Some(InsertTextFormat::SNIPPET);
        item.insert_text = Some(format!("{}($0)", label));
    }

    return Ok(item);

}

unsafe fn completion_item_from_package(package: &str, append_colons: bool) -> Result<CompletionItem> {

    let mut item = CompletionItem {
        label: package.to_string(),
        ..Default::default()
    };

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

    let data = CompletionData {
        source: None,
        value: package.to_string(),
    };

    item.data = Some(serde_json::to_value(data)?);
    return Ok(item);

}

unsafe fn completion_item_from_function(name: &str) -> Result<CompletionItem> {

    let mut item = CompletionItem {
        label: format!("{}()", name),
        ..Default::default()
    };

    // item.detail = Some("(Function)".to_string());
    item.kind = Some(CompletionItemKind::FUNCTION);

    item.insert_text_format = Some(InsertTextFormat::SNIPPET);
    item.insert_text = if is_syntactic(name) {
        Some(format!("{}($0)", name))
    } else {
        Some(format!("`{}`($0)", name.replace("`", "\\`")))
    };

    // provide parameter completions after completiong function
    item.command = Some(Command {
        title: "Trigger Suggest".to_string(),
        command: "editor.action.triggerSuggest".to_string(),
        ..Default::default()
    });

    let data = CompletionData {
        source: None,
        value: name.to_string(),
    };

    item.data = Some(serde_json::to_value(data)?);
    return Ok(item);
}

unsafe fn completion_item_from_name(name: &str, callee: &str, enquote: bool) -> Result<CompletionItem> {

    let mut item = CompletionItem {
        label: name.to_string(),
        ..Default::default()
    };

    if enquote {
        item.insert_text = Some(format!("\"{}\"", name));
    }

    item.detail = Some(callee.to_string());
    item.kind = Some(CompletionItemKind::FIELD);

    Ok(item)

}

unsafe fn completion_item_from_object(name: &str, mut object: SEXP, envir: SEXP) -> Result<CompletionItem> {

    // TODO: Can we figure out the object type without forcing promise evaluation?
    if TYPEOF(object) as u32 == PROMSXP {
        let mut errc = 0;
        object = R_tryEvalSilent(object, envir, &mut errc);
        if errc != 0 {
            bail!("Error creating completion item: {}", geterrmessage());
        }
    }

    if Rf_isFunction(object) != 0 {
        return completion_item_from_function(name);
    }

    let mut item = CompletionItem {
        label: quote_if_non_syntactic(name),
        ..Default::default()
    };

    item.detail = Some("(Object)".to_string());
    item.kind = Some(CompletionItemKind::STRUCT);

    let data = CompletionData {
        source: None,
        value: name.to_string(),
    };

    item.data = Some(serde_json::to_value(data)?);
    return Ok(item);

}

unsafe fn completion_item_from_symbol(name: &str, envir: SEXP) -> Result<CompletionItem> {

    let symbol = r_symbol!(name);
    let object = Rf_findVarInFrame(envir, symbol);
    if object == R_UnboundValue {
        bail!("Object '{}' not defined in environment {:?}", name, envir);
    }

    return completion_item_from_object(name, object, envir);

}

unsafe fn completion_item_from_parameter(parameter: &str, callee: &str) -> Result<CompletionItem> {

    let mut item = CompletionItem {
        label: quote_if_non_syntactic(parameter),
        ..Default::default()
    };

    item.kind = Some(CompletionItemKind::FIELD);
    item.insert_text_format = Some(InsertTextFormat::SNIPPET);
    item.insert_text = Some(parameter.to_string() + " = ");

    let data = CompletionData {
        source: Some(callee.to_string()),
        value: parameter.to_string(),
    };

    item.data = Some(serde_json::to_value(data)?);
    return Ok(item);

}

pub fn completion_context<'a>(document: &'a mut Document, params: CompletionParams) -> Result<CompletionContext<'a>> {

    // get reference to AST
    let ast = document.ast()?;

    // try to find node at completion position
    let mut point = params.text_document_position.position.as_point();
    if point.column > 1 {
        point.column -= 1;
    }

    // use the node to figure out the completion token
    let node = ast.node_at_point(point)?;
    let source = document.contents.to_string();
    let token = node.utf8_text(source.as_bytes())?.to_string();

    // build completion context
    Ok(CompletionContext { document, token, source, point, params })

}

fn append_defined_variables(node: &Node, context: &CompletionContext, completions: &mut Vec<CompletionItem>) {

    let visited : HashSet<usize> = HashSet::new();

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

            "left_assignment" | "super_assignment" | "equals_assignment" => {

                // check that the left-hand side is an identifier or a string
                if let Some(child) = node.child(0) {
                    if matches!(child.kind(), "identifier" | "string") {
                        match completion_item_from_assignment(&node, &context.source) {
                            Ok(item) => completions.push(item),
                            Err(error) => error!("{:?}", error),
                        }
                    }
                }

                // return true in case we have nested assignments
                return true;

            }

            "right_assignment" | "super_right_assignment" => {

                // return true for nested assignments
                return true;

            }

            "call" => {

                // don't recurse into calls for certain functions
                return !call_uses_nse(&node, context);

            }

            "function_definition" => {

                // don't recurse into function definitions, as these create as new scope
                // for variable definitions (and so such definitions are no longer visible)
                return false;

            }

            _ => {
                return true;
            }

        }

    });

}

fn append_function_parameters(node: &Node, context: &CompletionContext, completions: &mut Vec<CompletionItem>) -> Result<()> {

    let mut cursor = node.walk();

    if !cursor.goto_first_child() {
        bail!("goto_first_child() failed");
    }

    if !cursor.goto_next_sibling() {
        bail!("goto_next_sibling() failed");
    }

    let kind = cursor.node().kind();
    if kind != "formal_parameters" {
        bail!("unexpected node kind {}", kind);
    }

    if !cursor.goto_first_child() {
        bail!("goto_first_child() failed");
    }

    // The R tree-sitter grammar doesn't parse an R function's formals list into
    // a tree; instead, it's just held as a sequence of tokens. that said, the
    // only way an identifier could / should show up here is if it is indeed a
    // function parameter, so just search direct children here for identifiers.
    while cursor.goto_next_sibling() {
        let node = cursor.node();
        if node.kind() == "identifier" {
            match completion_item_from_identifier(&node, &context.source) {
                Ok(item) => completions.push(item),
                Err(error) => error!("{:?}", error),
            }
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

unsafe fn append_subset_completions(_context: &CompletionContext, callee: &str, enquote: bool, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_subset_completions({:?})", callee);

    let value = r_parse_eval(callee, RParseEvalOptions {
        forbid_function_calls: true,
    })?;

    let names = RFunction::new("base", "names")
        .add(value)
        .call()?
        .to::<Vec<String>>()?;

    for name in names {
        match completion_item_from_name(&name, callee, enquote) {
            Ok(item) => completions.push(item),
            Err(error) => error!("{:?}", error),
        }
    }

    Ok(())

}

unsafe fn append_parameter_completions(context: &CompletionContext, callee: &str, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_parameter_completions({:?})", callee);

    // Check for a function defined in this document that can provide parameters.
    let index = index_document(context.document);
    for symbol in index {
        match symbol {
            IndexedSymbol::Function { name, arguments } => {
                if name == callee {
                    for argument in arguments {
                        match completion_item_from_parameter(argument.as_str(), name.as_str()) {
                            Ok(item) => completions.push(item),
                            Err(error) => error!("{:?}", error),
                        }
                    }
                    return Ok(());
                }
            }
        }
    }

    // TODO: Given the callee, we should also try to find its definition within
    // the document index of function definitions, since it may not be defined
    // within the session.
    let value = r_parse_eval(callee, RParseEvalOptions {
        forbid_function_calls: true,
    })?;

    if Rf_isFunction(*value) != 0 {

        let strings = RFunction::from(".rs.formalNames")
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

unsafe fn append_namespace_completions(_context: &CompletionContext, package: &str, exports_only: bool, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_namespace_completions({:?}, {})", package, exports_only);

    // Get the package namespace.
    let namespace = RFunction::new("base", "getNamespace")
        .add(package)
        .call()?;

    let symbols = if package == "base" {
        list_namespace_symbols(*namespace)
    } else if exports_only {
        list_namespace_exports(*namespace)
    } else {
        list_namespace_symbols(*namespace)
    };

    let strings = symbols.to::<Vec<String>>()?;
    for string in strings.iter() {
        if let Ok(item) = completion_item_from_symbol(string, *namespace) {
            completions.push(item);
        }
    }

    Ok(())

}

fn append_keyword_completions(completions: &mut Vec<CompletionItem>) {

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
        let mut item = CompletionItem {
            label: snippet.0.to_string(),
            ..Default::default()
        };

        item.detail = Some("[keyword]".to_string());
        item.insert_text_format = Some(InsertTextFormat::SNIPPET);

        item.insert_text = if snippet.1 == "return" {
            Some(format!("{}()", snippet.1.to_string()))
        } else {
            Some(format!("{} ()", snippet.1.to_string()))
        };

        completions.push(item);
    }

    // provide other completion results
    // NOTE: Some R keywords have definitions provided in the R
    // base namespace, so we don't need to provide duplicate
    // definitions for these here.
    let keywords = vec![
        "NULL", "NA", "TRUE", "FALSE", "Inf", "NaN",
        "NA_integer_", "NA_real_", "NA_character_", "NA_complex_",
        "in", "else", "next", "break",
    ];

    for keyword in keywords {
        let mut item = CompletionItem::new_simple(keyword.to_string(), "[keyword]".to_string());
        item.kind = Some(CompletionItemKind::KEYWORD);
        completions.push(item);
    }

}

unsafe fn append_search_path_completions(_context: &CompletionContext, completions: &mut Vec<CompletionItem>) -> Result<()> {

    // start with keywords
    append_keyword_completions(completions);

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
                !matches!(name.as_str(), "if" | "else" | "for" | "in" | "while" | "repeat" | "break" | "next" | "return" | "function")
            });
        }
        for string in strings.iter() {
            if let Ok(item) = completion_item_from_symbol(string, envir) {
                completions.push(item);
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

unsafe fn append_roxygen_completions(_token: &str, completions: &mut Vec<CompletionItem>) -> Result<()> {

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

        let name = unwrap!(entry["name"].as_str(), {
            continue;
        });

        let label = name.to_string();
        let mut item = CompletionItem {
            label: label.clone(),
            ..Default::default()
        };

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

pub(crate) fn can_provide_completions(document: &mut Document, params: &CompletionParams) -> Result<bool> {

    // figure out the token / node at the cursor position. note that we use
    // the previous token here as the cursor itself will be located just past
    // the cursor / node providing the associated context
    let mut point = params.text_document_position.position.as_point();
    if point.column > 1 {
        point.column -= 1;
    }

    let node = document.ast()?.node_at_point(point)?;
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

pub(crate) fn append_session_completions(context: &CompletionContext, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_session_completions()");

    // get reference to AST
    let ast = context.document.ast()?;
    let mut node = ast.node_at_point(context.point)?;

    // check for completion within a comment -- in such a case, we usually
    // want to complete things like roxygen tags
    //
    // TODO: should some of this token processing happen in treesitter?
    if node.kind() == "comment" {
        let pattern = Regex::new(r"^.*\s").unwrap();
        let contents = node.utf8_text(context.source.as_bytes()).unwrap();
        let token = pattern.replace(contents, "");
        info!("Token: {:?}", token);
        if token.starts_with('@') {
            return r_lock! { append_roxygen_completions(&token[1..], completions) };
        } else {
            return Ok(());
        }
    }

    // check to see if we're completing a symbol from a namespace,
    // via code like:
    //
    //   package::sym
    //   package:::sym
    //
    // note that we'll need to handle cases where the user hasn't
    // yet started typing the symbol name, so that the cursor would
    // be on the '::' or ':::' token.
    //
    // Note that treesitter collects the tokens into a tree of the form:
    //
    //    - stats::bar - namespace_get
    //    - stats - identifier
    //    - :: - ::
    //    - bar - identifier
    //
    // But, if the tree is not yet complete, then treesitter gives us:
    //
    //    - stats - identifier
    //    - :: - ERROR
    //      - :: - ::
    //
    // So we have to do some extra work to get the package name in each case.
    if matches!(node.kind(), "::" | ":::") {
        let exports_only = node.kind() == "::";
        if let Some(parent) = node.parent() {
            if parent.kind() == "ERROR" {
                if let Some(prev) = parent.prev_sibling() {
                    if matches!(prev.kind(), "identifier" | "string") {
                        let package = prev.utf8_text(context.source.as_bytes()).unwrap();
                        return r_lock! { append_namespace_completions(context, package, exports_only, completions) };
                    }
                }
            }
        }
    }

    loop {

        // Check for 'subset' completions.
        if matches!(node.kind(), "dollar" | "subset" | "subset2") {
            let enquote = matches!(node.kind(), "subset" | "subset2");
            if let Some(child) = node.child(0) {
                let text = child.utf8_text(context.source.as_bytes())?;
                return r_lock! { append_subset_completions(context, &text, enquote, completions) };
            }
        }

        // If we landed on a 'call', then we should provide parameter completions
        // for the associated callee if possible.
        if node.kind() == "call" {
            if let Some(child) = node.child(0) {
                let text = child.utf8_text(context.source.as_bytes())?;
                return r_lock! { append_parameter_completions(context, &text, completions) };
            }
        }

        // Handle the case with 'package::prefix', where the user has now
        // started typing the prefix of the symbol they would like completions for.
        if matches!(node.kind(), "namespace_get" | "namespace_get_internal") {
            if let Some(package_node) = node.child(0) {
                if let Some(colon_node) = node.child(1) {
                    let package = package_node.utf8_text(context.source.as_bytes()).unwrap();
                    let exports_only = colon_node.kind() == "::";
                    return r_lock! { append_namespace_completions(context, package, exports_only, completions) };
                }
            }
        }

        // If we reach a brace list, bail.
        if node.kind() == "brace_list" {
            break;
        }

        // Update the node.
        node = match node.parent() {
            Some(node) => node,
            None => break
        };

    }

    // If we got here, then it's appropriate to return completions
    // for any packages + symbols on the search path.
    return r_lock! { append_search_path_completions(context, completions) };

}

pub(crate) fn append_document_completions(context: &CompletionContext, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_document_completions()");

    // get reference to AST
    let ast = context.document.ast()?;
    let mut node = ast.node_at_point(context.point)?;

    // skip comments
    if node.kind() == "comment" {
        trace!("cursor position lies within R comment; not providing document completions");
        return Ok(());
    }

    let mut visited : HashSet<usize> = HashSet::new();
    loop {

        // If this is a brace list, or the document root, recurse to find identifiers.
        if node.kind() == "brace_list" || node.parent() == None {
            append_defined_variables(&node, context, completions);
        }

        // If this is a function definition, add parameter names.
        if node.kind() == "function_definition" {
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
