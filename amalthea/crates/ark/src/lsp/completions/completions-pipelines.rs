
fn is_pipe_operator(node: &Node) -> bool {
    matches!(node.kind(), "%>%" | "|>")
}

