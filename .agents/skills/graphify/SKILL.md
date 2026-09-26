---
name: graphify
description: "Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools."
---

# /graphify

Turn any folder of files into a navigable knowledge graph with community detection, an honest audit trail, and interactive outputs.

## Usage

```bash
graphify query "<question>"     # BFS traversal of graph.json for a question
graphify path "<A>" "<B>"       # Shortest path between two nodes/files
graphify explain "<concept>"    # Node explanation with all neighbors and degree
graphify affected "<concept>"   # Reverse traversal of impacted nodes
graphify god-nodes              # List architectural hub nodes
graphify update .               # Re-extract code files and update the graph (AST-only)
```

## Rules for Codebase Questions

1. When `graphify-out/graph.json` exists, **always run `graphify query "<question>"` first**.
2. For relationships between modules, use `graphify path "<A>" "<B>"`.
3. For explaining a node/symbol, use `graphify explain "<concept>"`.
4. Read `graphify-out/GRAPH_REPORT.md` for high-level architecture overviews.
5. After modifying code, run `graphify update .` to keep the graph up to date.
