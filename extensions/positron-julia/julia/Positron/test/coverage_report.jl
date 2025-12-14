# Simple coverage report
using Coverage

cov = process_folder("src")
covered, total = get_summary(cov)

println("=" ^ 70)
println("Code Coverage Report")
println("=" ^ 70)
println("\nOverall: $covered/$total lines = $(round(covered/total*100, digits=1))%")

println("\nPer-file coverage:")
println("-" ^ 70)

files = ["variables.jl", "help.jl", "data_explorer.jl", "plots.jl", "ui.jl",
         "comm.jl", "jsonrpc.jl", "kernel.jl"]

for file in files
    file_cov = filter(x -> endswith(x.filename, file), cov)
    if !isempty(file_cov)
        covered_lines = count(x -> !isnothing(x.coverage) && x.coverage > 0, file_cov)
        total_lines = length(file_cov)
        pct = round(covered_lines/total_lines*100, digits=1)
        status = pct > 70 ? "✅" : (pct > 40 ? "🟡" : "❌")
        println("$status $file: $covered_lines/$total_lines ($pct%)")
    end
end

println("\n" * "=" ^ 70)
println("Focus testing on ❌ and 🟡 files")
