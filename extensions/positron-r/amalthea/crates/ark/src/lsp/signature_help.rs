//
// signature.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use anyhow::Result;
use harp::eval::RParseEvalOptions;
use harp::eval::r_parse_eval;
use harp::utils::r_formals;
use log::info;
use stdext::unwrap;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::Documentation;
use tower_lsp::lsp_types::ParameterInformation;
use tower_lsp::lsp_types::ParameterLabel;
use tower_lsp::lsp_types::SignatureHelp;
use tower_lsp::lsp_types::SignatureHelpParams;
use tower_lsp::lsp_types::SignatureInformation;

use crate::lsp::documents::Document;
use crate::lsp::help::RHtmlHelp;
use crate::lsp::traits::cursor::TreeCursorExt;
use crate::lsp::traits::point::PointExt;
use crate::lsp::traits::position::PositionExt;

/// SAFETY: Requires access to the R runtime.
pub unsafe fn signature_help(document: &Document, params: &SignatureHelpParams) -> Result<Option<SignatureHelp>> {

    // Get document AST + completion position.
    let ast = &document.ast;
    let source = document.contents.to_string();
    let point = params.text_document_position_params.position.as_point();

    // Find the node closest to the completion point.
    let mut cursor = ast.walk();
    let mut node = cursor.find_leaf(point);

    // If we landed on a comma before the cursor position, move to the next sibling node.
    // We need to check the position as, if the cursor is "on" the comma as in
    //
    //    foo (x = ,)
    //
    // then the current context is associated with 'x = ' and not with what follows
    // the comma.
    if node.kind() == "comma" && node.start_position().is_before(point) {
        if let Some(sibling) = node.next_sibling() {
            node = sibling;
        }
    }

    if node.kind() == ")" {
        if let Some(sibling) = node.prev_sibling() {
            node = sibling;
        }
    }

    info!("Signature help node: {}", node.to_sexp());

    // Get the current node.
    let mut parent = match node.parent() {
        Some(parent) => parent,
        None => return Ok(None),
    };

    // Look for a call node. Keep track of other relevant context while we search for it.
    // We want to figure out which of the current formals is currently "active". This is
    // a bit tricky for R functions, as one can supply named and unnamed arguments in any
    // order. For example:
    //
    //   foo(a = 1, b, c = 2, d)
    //
    // is a legal function call, and so we cannot just count commas to see which
    // parameter is currently active.

    // The list of arguments that have been explicitly specified.
    let mut explicit_parameters = vec![];

    // The number of unnamed arguments that have been supplied.
    let mut num_unnamed_arguments = 0;

    // The active argument, if any. Relevant for cases where the cursor is lying after 'x = <...>',
    // so we know that 'x' must be active.
    let mut active_argument = None;

    // Whether we've found the child node we were looking for.
    let mut found_child = false;

    // The computed argument offset.
    let mut offset : Option<u32> = None;

    let call = loop {

        // If we found an 'arguments' node, then use that to infer the current offset.
        if parent.kind() == "arguments" {

            // If the cursor lies upon a named argument, use that as an override.
            if let Some(name) = node.child_by_field_name("name") {
                active_argument = Some(name.utf8_text(source.as_bytes())?);
            }

            let mut cursor = parent.walk();
            let children = parent.children(&mut cursor);
            for child in children {

                if let Some(name) = child.child_by_field_name("name") {

                    // If this is a named argument, add it to the list.
                    let name = name.utf8_text(source.as_bytes())?;
                    explicit_parameters.push(name);

                    // Subtract 1 from the number of unnamed arguments, as
                    // the next comma we see won't be associated with an
                    // unnamed argument.
                    num_unnamed_arguments -= 1;

                }

                // If we find a comma, add to the offset.
                if !found_child && child.kind() == "comma" {
                    num_unnamed_arguments += 1;
                }

                // If we've now walked up to the current node, we can quit.
                if child == node {
                    found_child = true;
                }

            }

        }

        // If we find the 'call' node, we can quit.
        if parent.kind() == "call" {
            break parent;
        }

        // Update.
        node = parent;
        parent = match node.parent() {
            Some(parent) => parent,
            None => return Ok(None),
        };

    };

    // Get the left-hand side of the call.
    let callee = unwrap!(call.child(0), None => {
        return Ok(None);
    });

    // TODO: Should we search the document and / or the workspace index
    // before asking the R session for a definition? Which should take precedence?

    // Try to figure out what R object it's associated with.
    let code = callee.utf8_text(source.as_bytes())?;
    let object = r_parse_eval(code, RParseEvalOptions {
        forbid_function_calls: true,
    })?;

    // Get the formal parameter names associated with this function.
    let formals = r_formals(*object)?;

    // Get the help documentation associated with this function.
    let help = if matches!(callee.kind(), "::" | ":::") {

        let lhs = callee.child_by_field_name("lhs").into_result()?;
        let package = lhs.utf8_text(source.as_bytes())?;

        let rhs = callee.child_by_field_name("rhs").into_result()?;
        let topic = rhs.utf8_text(source.as_bytes())?;

        RHtmlHelp::new(topic, Some(package))

    } else {

        let topic = callee.utf8_text(source.as_bytes())?;
        RHtmlHelp::new(topic, None)

    };

    // The signature label. We generate this as we walk through the
    // parameters, so we can more easily record offsets.
    let mut label = String::new();
    label.push_str(code);
    label.push_str("(");

    // Get the available parameters.
    let mut parameters = vec![];

    // Iterate over the documentation for each parameter, and add the relevant information.
    for (index, argument) in formals.iter().enumerate() {

        // Compute signature offsets.
        let start = label.len() as u32;
        let end = start + argument.name.len() as u32;

        // Add the parameter to the label.
        label.push_str(argument.name.as_str());
        label.push_str(", ");

        // If we had an explicit name, and this name matches the argument,
        // then update the offset now.
        if active_argument == Some(argument.name.as_str()) {
            offset = Some(index as u32);
        }

        // Get documentation, if any.
        let mut documentation = None;
        if let Ok(Some(ref help)) = help {
            let markup = help.parameter(&argument.name);
            if let Ok(Some(markup)) = markup {
                documentation = Some(Documentation::MarkupContent(markup));
            }
        }

        // Add the new parameter.
        parameters.push(ParameterInformation {
            label: ParameterLabel::LabelOffsets([start, end]),
            documentation: documentation,
        });

    }

    // Clean up the closing ', ', and add a closing parenthesis.
    if label.ends_with(", ") {
        label.pop();
        label.pop();
    }

    // Add a closing parenthesis.
    label.push_str(")");

    // Finally, if we don't have an offset, figure it out now.
    if offset.is_none() {

        for (index, argument) in formals.iter().enumerate() {

            // Was this argument explicitly provided? If so, skip it.
            if explicit_parameters.contains(&argument.name.as_str()) {
                continue;
            }

            // Otherwise, check and see if we have any remaining commas.
            if num_unnamed_arguments > 0 {
                num_unnamed_arguments -= 1;
                continue;
            }

            // This is the argument.
            offset = Some(index as u32);
            break;

        }

    }

    // NOTE: It seems like the front-end still tries to highlight the first
    // parameter when the offset is set to none, so here we just force it to
    // match no available argument.
    if offset.is_none() {
        offset = Some((formals.len() + 1).try_into().unwrap_or_default());
    }

    let signature = SignatureInformation {
        label: label,
        documentation: None,
        parameters: Some(parameters),
        active_parameter: offset,
    };

    let help = SignatureHelp {
        signatures: vec![signature],
        active_signature: None,
        active_parameter: offset,
    };

    info!("{:?}", help);
    Ok(Some(help))

}
