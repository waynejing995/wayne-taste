# Export decisions

Status: approved

- D1: A report row is normalized before rendering: the name is stripped of surrounding whitespace and title-cased, and the amount is parsed from a currency string (leading `$`, thousands separators, surrounding whitespace) and quantized to 2 decimal places with exact decimal half-even rounding, then returned as a float.
- D2: CSV and JSON renderers are separate public entry points; neither imports the other's renderer.
- D3: Each renderer is imported from its own module (`export.csv_report`, `export.json_report`); `src/export/__init__.py` stays empty and is a locked input.
