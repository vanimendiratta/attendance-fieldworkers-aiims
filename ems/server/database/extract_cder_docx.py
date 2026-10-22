#!/usr/bin/env python3
"""
Extract authoritative CDER Staff Details, Leave Rules, and Individual Leave Records
from 'CDER Staff Details and Leave Rules & Record.docx'.
Strictly adheres to document values without inference or correction.
"""

import sys
import os
import json
import docx

def extract_cder_docx(docx_path):
    if not os.path.exists(docx_path):
        raise FileNotFoundError(f"Document not found at: {docx_path}")

    doc = docx.Document(docx_path)

    # 1. Extract rules from Table 0
    rules = []
    if len(doc.tables) > 0:
        t0 = doc.tables[0]
        for row in t0.rows[1:]:
            cells = [c.text.strip().replace('\n', ' ') for c in row.cells]
            rules.append({
                "leave_type": cells[0],
                "entitlement": cells[1],
                "rule_provision": cells[2]
            })

    # 2. Extract staff master from Table 1
    staff = []
    if len(doc.tables) > 1:
        t1 = doc.tables[1]
        for row in t1.rows[1:]:
            cells = [c.text.strip() for c in row.cells]
            staff.append({
                "sno": int(cells[0]),
                "name": cells[1],
                "designation": cells[2],
                "contact": cells[3],
                "email": cells[4],
                "joining_date": cells[5] # DD/MM/YYYY
            })

    # 3. Extract individual leave entitlement and balance records from Table 2 and Table 3
    leave_records = []
    tables_to_read = []
    if len(doc.tables) > 2:
        tables_to_read.append(doc.tables[2])
    if len(doc.tables) > 3:
        tables_to_read.append(doc.tables[3])

    for table in tables_to_read:
        for row in table.rows[1:]:
            cells = [c.text.strip() for c in row.cells]
            leave_records.append({
                "sno": int(cells[0]),
                "name": cells[1],
                "designation": cells[2],
                "cl_entitled": float(cells[3]),
                "cl_balance": float(cells[4]),
                "el_availed_raw": float(cells[5]), # Raw document column 5 ("EL availed")
                "el_balance": float(cells[6]),
                "rh_entitled": float(cells[7]),
                "rh_balance": float(cells[8]),
                "co_balance": float(cells[9])
            })

    return {
        "title": "CENTRE FOR DENTAL EDUCATION AND RESEARCH - Staff Details & Leave Rules | 2026–2027",
        "tenure_start": "2026-04-01",
        "tenure_end": "2027-03-31",
        "record_snapshot_date": "2026-10-01",
        "joining_date_cutoff_day": 25,
        "rules": rules,
        "staff": staff,
        "leave_records": leave_records
    }

if __name__ == "__main__":
    default_path = os.path.join(os.path.dirname(__file__), "..", "..", "CDER Staff Details and Leave Rules & Record.docx")
    docx_file = sys.argv[1] if len(sys.argv) > 1 else default_path
    
    data = extract_cder_docx(docx_file)
    output_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "cder_extracted_data.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Extracted {len(data['staff'])} staff and {len(data['leave_records'])} leave records into {output_path}")
