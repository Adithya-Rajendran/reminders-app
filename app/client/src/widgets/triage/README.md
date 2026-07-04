# Prioritize widget

This folder owns the Prioritize surface. The widget is intentionally split so
layout, drag/drop behavior, and task-row rendering can be tested without changing
the dashboard host:

- `TriageWidget.jsx`: capability wiring, derived task views, and drop persistence.
- `layout.js`: pure size-tier decisions for compact, standard, tall, and roomy
  shapes.
- `MostImportantCard.jsx`: the single-task callout.
- `TriageMatrix.jsx` and `TriageQuadrant.jsx`: proportional matrix cells and
  dense task rows.
- `TriageWidget.css`: all Prioritize-only styling.
