//
// completions.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::collections::HashSet;
use std::path::Path;

use harp::exec::geterrmessage;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::protect::RProtect;
use harp::r_lock;
use harp::r_string;
use harp::r_symbol;
use harp::utils::r_inherits;
use libR_sys::*;
use log::info;
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

fn completion_item_from_identifier(node: &Node, source: &str) -> CompletionItem {
    let label = node.utf8_text(source.as_bytes()).expect("empty assignee");
    let detail = format!("Defined on line {}", node.start_position().row + 1);
    return CompletionItem::new_simple(label.to_string(), detail);
}


fn completion_item_from_assignment(node: &Node, source: &str) -> Option<CompletionItem> {

    let lhs = unwrap!(node.child(0), { return None; });
    let rhs = unwrap!(node.child(2), { return None; });

    let label = lhs.utf8_text(source.as_bytes()).expect("empty assignee");
    let detail = format!("Defined on line {}", lhs.start_position().row + 1);

    let mut item = CompletionItem::new_simple(format!("{}()", label), detail);

    if rhs.kind() == "function_definition" {
        item.kind = Some(CompletionItemKind::FUNCTION);
        item.insert_text_format = Some(InsertTextFormat::SNIPPET);
        item.insert_text = Some(format!("{}($0)", label));
    }

    return Some(item);
}

struct CompletionData {
    source: String,
    position: Point,
    visited: HashSet<usize>,
}

unsafe fn completion_item_from_package(package: &str) -> CompletionItem {

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
        .call()
        .unwrap();

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

    return item;

}

unsafe fn completion_item_from_function(name: &str) -> CompletionItem {

    let label = format!("{}()", name);
    let detail = "(Function)";
    let mut item = CompletionItem::new_simple(label.to_string(), detail.to_string());

    item.kind = Some(CompletionItemKind::FUNCTION);

    item.insert_text_format = Some(InsertTextFormat::SNIPPET);
    item.insert_text = Some(format!("{}($0)", name));

    // TODO: Include 'detail' based on the function signature?
    // TODO: Include help documentation?

    return item;
}

unsafe fn completion_item_from_object(name: &str, mut object: SEXP, envir: SEXP) -> Option<CompletionItem> {

    // TODO: Can we figure out the object type without forcing promise evaluation?
    if TYPEOF(object) as u32 == PROMSXP {
        let mut errc = 0;
        object = R_tryEvalSilent(object, envir, &mut errc);
        if errc != 0 {
            info!("Error creating completion item: {}", geterrmessage());
            return None;
        }
    }

    if Rf_isFunction(object) != 0 {
        return Some(completion_item_from_function(name));
    }

    let mut item = CompletionItem::new_simple(name.to_string(), "(Object)".to_string());
    item.kind = Some(CompletionItemKind::STRUCT);
    return Some(item);

}

unsafe fn completion_item_from_symbol(name: &str, envir: SEXP) -> Option<CompletionItem> {

    let symbol = r_symbol!(name);
    let object = Rf_findVarInFrame(envir, symbol);
    if object == R_UnboundValue {
        return None;
    }

    return completion_item_from_object(name, object, envir);

}

unsafe fn completion_item_from_parameter(string: impl ToString, callee: impl ToString) -> CompletionItem {

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

    return item;

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
                if let Some(completion) = completion_item_from_assignment(&node, &data.source) {
                    completions.push(completion);
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

fn append_function_parameters(node: &Node, data: &mut CompletionData, completions: &mut Vec<CompletionItem>) {

    let mut cursor = node.walk();

    if !cursor.goto_first_child() {
        info!("goto_first_child() failed");
        return;
    }

    if !cursor.goto_next_sibling() {
        info!("goto_next_sibling() failed");
        return;
    }

    let kind = cursor.node().kind();
    if kind != "formal_parameters" {
        info!("unexpected node kind {}", kind);
        return;
    }

    if !cursor.goto_first_child() {
        info!("goto_first_child() failed");
        return;
    }

    // The R tree-sitter grammar doesn't parse an R function's formals list into
    // a tree; instead, it's just held as a sequence of tokens. that said, the
    // only way an identifier could / should show up here is if it is indeed a
    // function parameter, so just search direct children here for identifiers.
    while cursor.goto_next_sibling() {
        let node = cursor.node();
        if node.kind() == "identifier" {
            completions.push(completion_item_from_identifier(&node, &data.source));
        }
    }

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

unsafe fn append_parameter_completions(document: &Document, callee: &str, completions: &mut Vec<CompletionItem>) {

    info!("append_parameter_completions({:?})", callee);

    // Check for a function defined in this document that can provide parameters.
    let index = index_document(document);
    for symbol in index {
        match symbol {
            IndexedSymbol::Function { name, arguments } => {
                if name == callee {
                    for argument in arguments {
                        let item = completion_item_from_parameter(argument, name.clone());
                        completions.push(item);
                    }
                    return;
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
        info!("Error parsing {} [status {}]", callee, status);
        return;
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
            dbg!("Error evaluating {}", callee);
            return;
        }
    }

    // Protect the final evaluation result here, as we'll
    // need to introspect on its result.
    value = protect.add(value);

    if Rf_isFunction(value) != 0 {

        let names = RFunction::from(".rs.formalNames")
            .add(value)
            .call()
            .unwrap();

        if r_inherits(*names, "error") {
            return;
        }

        // Return the names of these formals.
        if let Ok(strings) = names.to::<Vec<String>>() {
            for string in strings.iter() {
                let item = completion_item_from_parameter(string, callee);
                completions.push(item);
            }
        }

    }

}

unsafe fn append_namespace_completions(package: &str, exports_only: bool, completions: &mut Vec<CompletionItem>) {

    info!("append_namespace_completions({:?}, {})", package, exports_only);

    // Get the package namespace.
    let namespace = RFunction::new("base", "getNamespace")
        .add(package)
        .call()
        .unwrap();

    let symbols = if package == "base" {
        list_namespace_symbols(*namespace)
    } else if exports_only {
        list_namespace_exports(*namespace)
    } else {
        list_namespace_symbols(*namespace)
    };

    if TYPEOF(*symbols) as u32 != STRSXP {
        info!("Unexpected SEXPTYPE {}", TYPEOF(*symbols));
        return;
    }

    // Create completion items for each.
    if let Ok(strings) = symbols.to::<Vec<String>>() {
        for string in strings.iter() {
            if let Some(item) = completion_item_from_symbol(string, *namespace) {
                completions.push(item);
            }
        }
    }

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

unsafe fn append_search_path_completions(completions: &mut Vec<CompletionItem>) {

    // Iterate through environments starting from the global environment.
    let mut envir = R_GlobalEnv;

    while envir != R_EmptyEnv {

        // List symbols in the environment.
        let symbols = R_lsInternal(envir, 1);

        // Create completion items for each.
        if let Ok(strings) = RObject::new(symbols).to::<Vec<String>>() {
            for string in strings.iter() {
                if let Some(item) = completion_item_from_symbol(string, envir) {
                    completions.push(item);
                }
            }
        }

        // Get the next environment.
        envir = ENCLOS(envir);

    }

    // Include installed packages as well.
    // TODO: This can be slow on NFS.
    let packages = RFunction::new("base", ".packages")
        .param("all.available", true)
        .call()
        .unwrap();

    if let Ok(strings) = packages.to::<Vec<String>>() {
        for string in strings.iter() {
            let item = completion_item_from_package(string);
            completions.push(item);
        }
    }


}

unsafe fn append_roxygen_completions(token: &str, completions: &mut Vec<CompletionItem>) {

    // TODO: cache these?
    // TODO: use an indexer to build the tag list?
    let tags = RFunction::new("base", "system.file")
        .param("package", "roxygen2")
        .add("roxygen2-tags.yml")
        .call()
        .unwrap()
        .to::<String>()
        .unwrap();

    if tags.is_empty() {
        return;
    }

    let tags = Path::new(&tags);
    if !tags.exists() {
        return;
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

pub(crate) fn append_session_completions(document: &mut Document, params: &CompletionParams, completions: &mut Vec<CompletionItem>) {

    info!("append_session_completions()");

    // get reference to AST
    let ast = unwrap!(document.ast.as_ref(), {
        return;
    });

    // get document source
    let source = document.contents.to_string();

    // figure out the token / node at the cursor position. note that we use
    // the previous token here as the cursor itself will be located just past
    // the cursor / node providing the associated context
    let mut point = params.text_document_position.position.as_point();
    if point.column > 1 { point.column -= 1; }

    let mut node = unwrap!(ast.root_node().descendant_for_point_range(point, point), {
        return;
    });

    info!("Node: {:?}", node);

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
            r_lock! { append_roxygen_completions(&token[1..], completions) };
            return;
        } else {
            return;
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
                        r_lock! { append_namespace_completions(package, exports_only, completions) }
                        return;
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
                let text = child.utf8_text(source.as_bytes()).unwrap();
                r_lock! { append_parameter_completions(document, &text, completions) }
                return;
            };
        }

        // Handle the case with 'package::prefix', where the user has now
        // started typing the prefix of the symbol they would like completions for.
        if matches!(node.kind(), "namespace_get" | "namespace_get_internal") {
            if let Some(package_node) = node.child(0) {
                if let Some(colon_node) = node.child(1) {
                    let package = package_node.utf8_text(source.as_bytes()).unwrap();
                    let exports_only = colon_node.kind() == "::";
                    r_lock! { append_namespace_completions(package, exports_only, completions) }
                    return;
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
    r_lock! { append_search_path_completions(completions) };

}

pub(crate) fn append_document_completions(document: &mut Document, params: &CompletionParams, completions: &mut Vec<CompletionItem>) {

    info!("append_document_completions()");

    // get reference to AST
    let ast = unwrap!(document.ast.as_ref(), {
        return;
    });

    // try to find child for point
    let point = params.text_document_position.position.as_point();
    let mut node = unwrap!(ast.root_node().descendant_for_point_range(point, point), {
        return;
    });

    // skip comments
    if node.kind() == "comment" {
        return;
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
            append_function_parameters(&node, &mut data, completions);
        }

        // Mark this node as visited.
        data.visited.insert(node.id());

        // Keep going.
        node = match node.parent() {
            Some(node) => node,
            None => break,
        };

    }

}
