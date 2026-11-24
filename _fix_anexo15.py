import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

path = "docs/07_frontend/mockups/anexo-15-matriz-conflictividad.html"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

original = content

# 1. Remove the tematica filter label block (label + span + select + options)
content = re.sub(
    r'<label class="select-filter">\s*<span>Temática</span>.*?</label>\n\n',
    "",
    content,
    flags=re.DOTALL,
)

# 2. Remove <th>Temática</th>
content = content.replace("<th>Temática</th>\n", "")

# 3. Remove JS references to tematica
# 3a. state object entry
content = re.sub(r'[ \t]*tematica: "Todas",\n', "", content)
# 3b. matches() block
content = re.sub(
    r'[ \t]*if \(\s*state\.tematica !== "Todas" &&\s*d\.tematica !== state\.tematica\s*\)\s*return false;\n',
    "",
    content,
)
# 3c. clear handler
content = re.sub(r'[ \t]*state\.tematica = "Todas";\n', "", content)

# 4. Fix structural numbers affected by removing one column
content = content.replace("tdEmpty.colSpan = 18;", "tdEmpty.colSpan = 17;")
content = content.replace("row.children[12]", "row.children[11]")

# 5. Notes section references
content = content.replace("subsector, tematica,", "subsector,")  # column list
content = content.replace("quince columnas", "catorce columnas")
content = content.replace("usa diez de ellas", "usa nueve de ellas")
content = content.replace("ocho catálogos", "siete catálogos")
content = content.replace(
    "subsector, temática, unidad", "subsector, unidad"
)  # LEFT JOIN list

# 6. Remove the contract table row for Temática
content = re.sub(
    r"<tr>\s*<td>Temática</td>.*?</tr>\s*\n",
    "",
    content,
    flags=re.DOTALL,
)

# 7. Remove data-tematica attributes (whole line)
content = re.sub(r'[ \t]*data-tematica="[^"]*"\n', "", content)

# 8. Remove the 6th <td> from each row in #matrix-rows
tbody_start = content.find('<tbody id="matrix-rows">')
tbody_end = content.find("</tbody>", tbody_start)
tbody = content[tbody_start:tbody_end]

rows = re.findall(r"<tr\b.*?</tr>", tbody, re.DOTALL)


def remove_6th_td(row):
    cells = list(re.finditer(r"<td\b[^>]*>.*?</td>", row, re.DOTALL))
    if len(cells) < 6:
        return row
    cell = cells[5]
    end = cell.end()
    nl = row.find("\n", end)
    if nl != -1:
        j = nl + 1
        while j < len(row) and row[j] in " \t":
            j += 1
        return row[: cell.start()] + row[j:]
    return row[: cell.start()] + row[end:]


new_rows = [remove_6th_td(r) for r in rows]
new_tbody = "".join(new_rows)
content = content[:tbody_start] + new_tbody + content[tbody_end:]

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

# ---- Verification ----
print("=== VERIFICATION ===")

# Count th in thead
thead_start = content.find("<thead>")
thead_end = content.find("</thead>", thead_start)
thead = content[thead_start:thead_end]
th_count = len(re.findall(r"<th\b", thead))
print(f"Number of <th> in thead: {th_count}")

# Count td per row in tbody
tbody2_start = content.find('<tbody id="matrix-rows">')
tbody2_end = content.find("</tbody>", tbody2_start)
tbody2 = content[tbody2_start:tbody2_end]
rows2 = re.findall(r"<tr\b.*?</tr>", tbody2, re.DOTALL)
td_counts = [len(re.findall(r"<td\b", r)) for r in rows2]
print(f"Number of rows: {len(rows2)}")
print(f"td per row: min={min(td_counts)}, max={max(td_counts)}")
mismatch = [i for i, c in enumerate(td_counts) if c != th_count]
print(f"Rows with td != th: {len(mismatch)} -> {mismatch}")

# Check remaining tematica references
remaining = re.findall(r"tem[áa]tica", content, re.IGNORECASE)
print(f'Remaining "tematica/Temática" occurrences: {len(remaining)}')
for m in remaining:
    print("  ", m)
