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
use harp::exec::geterrmessage;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::protect::RProtect;
use harp::r_lock;
use harp::r_string;
use harp::r_symbol;
use libR_sys::*;
use log::*;
use regex::Captures;
use regex::Regex;
use stdext::*;
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
use crate::lsp::traits::point::PointExt;
use crate::lsp::traits::position::PositionExt;
use crate::lsp::traits::tree::TreeExt;

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

struct CompletionData {
    source: String,
    position: Point,
    visited: HashSet<usize>,
}

unsafe fn completion_item_from_package(package: &str) -> Result<CompletionItem> {

    let mut item = CompletionItem {
        label: package.to_string(),
        ..Default::default()
    };

    item.kind = Some(CompletionItemKind::MODULE);

    // generate package documentation
    //
    // TODO: This is fairly slow so we disable this for now.
    // It'd be nice if we could defer help generation until the time
    // the user asks for it, but it seems like we need to provide it
    // up-front. For that reason, we'll probably need to generate a
    // cache of help documentation, or implement some sort of LSP-side
    // filtering of completion results based on the current token.
    let documentation = RFunction::from(".rs.help.package")
        .add(package)
        .call()?;

    if TYPEOF(*documentation) as u32 == VECSXP {

        // TODO: Use safe extraction functions here
        let doc_type = VECTOR_ELT(*documentation, 0);
        let doc_contents = VECTOR_ELT(*documentation, 1);

        if TYPEOF(doc_type) as u32 == STRSXP && TYPEOF(doc_contents) as u32 == STRSXP {

            let _doc_type = RObject::new(doc_type).to::<String>().unwrap();
            let doc_contents = RObject::new(doc_contents).to::<String>().unwrap();

            item.documentation = Some(Documentation::MarkupContent(MarkupContent {
                kind: MarkupKind::Markdown,
                value: doc_contents.to_string()
            }));
        }

    }

    return Ok(item);

}

unsafe fn completion_item_from_function(name: &str) -> Result<CompletionItem> {

    let label = format!("{}()", name);
    let detail = "(Function)";
    let mut item = CompletionItem::new_simple(label.to_string(), detail.to_string());

    item.kind = Some(CompletionItemKind::FUNCTION);

    item.insert_text_format = Some(InsertTextFormat::SNIPPET);
    item.insert_text = Some(format!("{}($0)", name));

    // TODO: Include 'detail' based on the function signature?
    // TODO: Include help documentation?

    return Ok(item);
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

    let mut item = CompletionItem::new_simple(name.to_string(), "(Object)".to_string());
    item.kind = Some(CompletionItemKind::STRUCT);
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

unsafe fn completion_item_from_parameter(string: impl ToString, callee: impl ToString) -> Result<CompletionItem> {

    let mut item = CompletionItem::new_simple(string.to_string(), callee.to_string());
    item.kind = Some(CompletionItemKind::FIELD);
    item.insert_text_format = Some(InsertTextFormat::SNIPPET);
    item.insert_text = Some(string.to_string() + " = ");

    // TODO: Include help based on the help documentation for the argument.
    // It looks like raw HTML help is not supported, so we'll probably have to
    // request the HTML help from R, and then convert that to Markdown with
    // pandoc or something similar.
    //
    // TODO: Could we build this from roxygen comments for functions definitions
    // existing only in-source?

    item.detail = Some("This is some detail.".to_string());
    item.documentation = Some(Documentation::MarkupContent(MarkupContent {
        kind: MarkupKind::Markdown,
        value: "# This is some Markdown.".to_string(),
    }));

    return Ok(item);

}

fn call_uses_nse(node: &Node, data: &CompletionData) -> bool {

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
    let value = unwrap!(lhs.utf8_text(data.source.as_bytes()), {
        return false;
    });

    match value {
        "expression" | "local" | "quote" | "enquote" | "substitute" | "with" | "within" => { return true; },
        _ => { return false; }
    }

}

fn append_defined_variables(node: &Node, data: &mut CompletionData, completions: &mut Vec<CompletionItem>) {

    let mut cursor = node.walk();
    cursor.recurse(|node| {

        // skip nodes that exist beyond the completion position
        if node.start_position().is_after(data.position) {
            return false;
        }

        // skip nodes that were already visited
        if data.visited.contains(&node.id()) {
            return false;
        }

        match node.kind() {

            "left_assignment" | "super_assignment" | "equals_assignment" => {

                // check for a valid completion
                match completion_item_from_assignment(&node, &data.source) {
                    Ok(item) => completions.push(item),
                    Err(error) => error!("{}", error),
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
                return !call_uses_nse(&node, &data);

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

fn append_function_parameters(node: &Node, data: &mut CompletionData, completions: &mut Vec<CompletionItem>) -> Result<()> {

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
            match completion_item_from_identifier(&node, &data.source) {
                Ok(item) => completions.push(item),
                Err(error) => error!("{}", error),
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

unsafe fn append_parameter_completions(document: &Document, callee: &str, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_parameter_completions({:?})", callee);

    // Check for a function defined in this document that can provide parameters.
    let index = index_document(document);
    for symbol in index {
        match symbol {
            IndexedSymbol::Function { name, arguments } => {
                if name == callee {
                    for argument in arguments {
                        match completion_item_from_parameter(argument, name.clone()) {
                            Ok(item) => completions.push(item),
                            Err(error) => error!("{}", error),
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
    let mut protect = RProtect::new();
    let mut status: ParseStatus = 0;

    // Parse the callee text. The text will be parsed as an R expression,
    // which is a vector of calls to be evaluated.
    let string_sexp = protect.add(r_string!(callee));
    let parsed_sexp = protect.add(R_ParseVector(string_sexp, 1, &mut status, R_NilValue));

    if status != ParseStatus_PARSE_OK {
        bail!("Error parsing {} [status {}]", callee, status);
    }

    // Evaluate the text. We use evaluation here to make it easier to support
    // the lookup of complex left-hand expressions.
    //
    // TODO: Avoid evaluating function calls here.
    let mut value = R_NilValue;
    for i in 0..Rf_length(parsed_sexp) {
        let expr = VECTOR_ELT(parsed_sexp, i as isize);
        let mut errc : i32 = 0;
        value = R_tryEvalSilent(expr, R_GlobalEnv, &mut errc);
        if errc != 0 {
            bail!("Error evaluating {}: {}", callee, geterrmessage());
        }
    }

    // Protect the final evaluation result here, as we'll
    // need to introspect on its result.
    value = protect.add(value);

    if Rf_isFunction(value) != 0 {

        let strings = RFunction::from(".rs.formalNames")
            .add(value)
            .call()?
            .to::<Vec<String>>()?;

        // Return the names of these formals.
        for string in strings.iter() {
            match completion_item_from_parameter(string, callee) {
                Ok(item) => completions.push(item),
                Err(error) => error!("{}", error),
            }
        }

    }

    Ok(())

}

unsafe fn append_namespace_completions(package: &str, exports_only: bool, completions: &mut Vec<CompletionItem>) -> Result<()> {

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

#[allow(dead_code)]
fn append_keyword_completions(completions: &mut Vec<CompletionItem>) {

    let keywords = vec![
    "NULL", "NA", "TRUE", "FALSE", "Inf", "NaN", "NA_integer_",
    "NA_real_", "NA_character_", "NA_complex_", "function", "while",
    "repeat", "for", "if", "in", "else", "next", "break", "return",
    ];

    for keyword in keywords {
        let mut item = CompletionItem::new_simple(keyword.to_string(), "[keyword]".to_string());
        item.kind = Some(CompletionItemKind::KEYWORD);
        completions.push(item);
    }

}

unsafe fn append_search_path_completions(completions: &mut Vec<CompletionItem>) -> Result<()> {

    // Iterate through environments starting from the global environment.
    let mut envir = R_GlobalEnv;

    while envir != R_EmptyEnv {

        // List symbols in the environment.
        let symbols = R_lsInternal(envir, 1);

        // Create completion items for each.
        let strings = RObject::new(symbols).to::<Vec<String>>()?;
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
        let item = completion_item_from_package(string)?;
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

pub(crate) fn can_provide_completions(document: &mut Document, params: &CompletionParams) -> bool {

    // get reference to AST
    let ast = unwrap!(document.ast.as_ref(), {
        return false;
    });

    // get document source
    let source = document.contents.to_string();

    // figure out the token / node at the cursor position. note that we use
    // the previous token here as the cursor itself will be located just past
    // the cursor / node providing the associated context
    let mut point = params.text_document_position.position.as_point();
    if point.column > 1 { point.column -= 1; }

    let node = unwrap!(ast.root_node().descendant_for_point_range(point, point), {
        return false;
    });

    let value = node.utf8_text(source.as_bytes()).unwrap();

    // completions will be triggered as the user types ':', which implies that
    // a completion request could be sent before the user has finished typing
    // '::' or ':::'. detect this particular case and don't provide completions
    // in that context
    if value == ":" {
        return false;
    }

    return true;

}

pub(crate) fn append_session_completions(document: &mut Document, params: &CompletionParams, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_session_completions()");

    // get reference to AST
    let ast = unwrap!(document.ast.as_ref(), {
        bail!("Error retrieving document AST")
    });

    // get document source
    let source = document.contents.to_string();

    // figure out the token / node at the cursor position. note that we use
    // the previous token here as the cursor itself will be located just past
    // the cursor / node providing the associated context
    let mut point = params.text_document_position.position.as_point();
    if point.column > 1 { point.column -= 1; }

    let mut node = unwrap!(ast.root_node().descendant_for_point_range(point, point), {
        bail!("Error finding node at point {:?}", point);
    });

    // check for completion within a comment -- in such a case, we usually
    // want to complete things like roxygen tags
    //
    // TODO: should some of this token processing happen in treesitter?
    if node.kind() == "comment" {
        let pattern = Regex::new(r"^.*\s").unwrap();
        let contents = node.utf8_text(source.as_bytes()).unwrap();
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
                        let package = prev.utf8_text(source.as_bytes()).unwrap();
                        return r_lock! { append_namespace_completions(package, exports_only, completions) };
                    }
                }
            }
        }
    }

    loop {

        // If we landed on a 'call', then we should provide parameter completions
        // for the associated callee if possible.
        if node.kind() == "call" {
            if let Some(child) = node.child(0) {
                let text = child.utf8_text(source.as_bytes())?;
                return r_lock! { append_parameter_completions(document, &text, completions) };
            };
        }

        // Handle the case with 'package::prefix', where the user has now
        // started typing the prefix of the symbol they would like completions for.
        if matches!(node.kind(), "namespace_get" | "namespace_get_internal") {
            if let Some(package_node) = node.child(0) {
                if let Some(colon_node) = node.child(1) {
                    let package = package_node.utf8_text(source.as_bytes()).unwrap();
                    let exports_only = colon_node.kind() == "::";
                    return r_lock! { append_namespace_completions(package, exports_only, completions) };
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
    return r_lock! { append_search_path_completions(completions) };

}

pub(crate) fn append_document_completions(document: &mut Document, params: &CompletionParams, completions: &mut Vec<CompletionItem>) -> Result<()> {

    info!("append_document_completions()");

    // get reference to AST
    let ast = document.ast()?;

    // try to find child for point
    let point = params.text_document_position.position.as_point();
    let mut node = ast.node_at_point(point)?;

    // skip comments
    if node.kind() == "comment" {
        trace!("cursor position lies within R comment; not providing document completions");
        return Ok(());
    }

    // build completion data
    let mut data = CompletionData {
        source: document.contents.to_string(),
        position: point,
        visited: HashSet::new(),
    };

    loop {

        // If this is a brace list, or the document root, recurse to find identifiers.
        if node.kind() == "brace_list" || node.parent() == None {
            append_defined_variables(&node, &mut data, completions);
        }

        // If this is a function definition, add parameter names.
        if node.kind() == "function_definition" {
            let result = append_function_parameters(&node, &mut data, completions);
            if let Err(error) = result {
                error!("{}", error);
            }
        }

        // Mark this node as visited.
        data.visited.insert(node.id());

        // Keep going.
        node = match node.parent() {
            Some(node) => node,
            None => break,
        };

    }

    Ok(())

}
