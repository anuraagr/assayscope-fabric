# Diagram sources

| Diagram | Rendered view | Editable source |
|---|---|---|
| Local and Fabric architecture | [SVG](architecture.svg) | [Excalidraw](architecture.excalidraw) |
| Lab research review workflow | [SVG](research-workflow.svg) | [Excalidraw](research-workflow.excalidraw) |
| Analytical data and image lineage | [SVG](data-lineage.svg) | [Excalidraw](data-lineage.excalidraw) |
| Ontology and external lab-context boundaries | [SVG](knowledge-context.svg) | [Excalidraw](knowledge-context.excalidraw) |

The diagrams use factual component and scientific labels. They distinguish actual
components from data boundaries; they are not deployment receipts or product screenshots.
SVGs include accessible titles/descriptions and have no external assets.

Edit the layout definitions in `scripts/build-diagrams.mjs`, then regenerate both formats:

```powershell
npm run docs:diagrams
node scripts\build-diagrams.mjs --check
```

The matching Excalidraw files can be opened in an approved editor, such as
[Microsoft's Excalidraw instance](https://aka.ms/excalidraw) when available to you.
Shapes and labels remain editable. If making an exploratory edit there, transfer the
final layout back to the generator so the checked-in SVG and editable source do not drift.
