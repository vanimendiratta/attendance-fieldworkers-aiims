# EMS Leave Policy Configuration

## 1. Statutory Context & Baseline Policy

The leave policies implemented within EMS are aligned directly with the **AIIMS CDER Staff Rules & Records** and standard **Central Civil Services (CCS) Leave Rules** adapted for fieldworkers and research project personnel.

---

## 2. Policy Specifications by Leave Category

### 2.1 Casual Leave (CL)
- **Annual Entitlement**: 8 days per calendar year (January 1 – December 31).
- **Credit Schedule**: Credited in full at the beginning of the calendar year or pro-rated for mid-year joiners.
- **Deduction Calculation**:
  - Weekly offs (Sundays for fieldworkers, Saturdays/Sundays for administrative personnel) falling within the leave period are **excluded** from deduction.
  - Gazetted public holidays falling within the leave period are **excluded** from deduction.
- **Half-Day Option**: Permitted (0.5 day deduction) for either First Half (Morning) or Second Half (Afternoon).
- **Consecutive Day Ceiling**: Maximum 3 consecutive working days in a single spell unless exceptional sanction is granted by the Principal Investigator.
- **Carryover / Encashment**: CL cannot be carried forward to the subsequent year and lapses on December 31. No encashment is permitted.

### 2.2 Earned Leave (EL)
- **Annual Entitlement**: 30 days per calendar year.
- **Credit Schedule**: Credited in advance in two half-yearly installments of 15 days each on **January 1** and **July 1**.
- **Deduction Calculation (Sandwich Rule)**:
  - Intervening Sundays and Gazetted Holidays are **included** in the deduction calculation per CCS Leave Rules.
  - Example: A leave application from Friday through Monday spans 4 calendar days; all 4 days are debited from the EL balance.
- **Half-Day Option**: **Not permitted**.
- **Maximum Accumulation**: Up to 300 days over the lifetime of service.

### 2.3 Restricted Holiday (RH)
- **Annual Entitlement**: Maximum 2 days per calendar year.
- **Eligible Dates**: Must be selected from the official Central Government Restricted Holiday list maintained in `holidays` master table (`type = 'RESTRICTED'`).
- **Half-Day Option**: Not permitted.

### 2.4 Compensatory Off (COMP_OFF)
- **Eligibility**: Fieldworkers and technical staff required to perform duty on a Sunday or Gazetted Holiday for urgent survey, camp, or clinical trials.
- **Application Process**: Employee submits duty verification through the Comp-Off portal (`POST /api/ems/compoff/apply`) referencing the date of duty.
- **Validity Window**: Comp-Off must be utilized within **90 days** from the date of duty performed; unutilized credits expire automatically.
- **Consecutive Day Ceiling**: Maximum 3 consecutive working days.

---

## 3. Master Policy Versioning & Dynamic Schema

To ensure regulatory audit compliance, policy configurations are stored in `leave_rule_versions` in SQLite:

```sql
CREATE TABLE IF NOT EXISTS leave_rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  entitlement_annual REAL NOT NULL,
  carry_forward_max REAL NOT NULL,
  sandwich_rule_applies INTEGER NOT NULL DEFAULT 0,
  half_day_allowed INTEGER NOT NULL DEFAULT 0,
  max_consecutive_days INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 4. Unresolved Organizational Decisions & Recommendations

1. **Mid-Year Pro-Rata Accrual for New Joiners**:
   - *Current Implementation*: Initial seed allocates full quota or pro-rates based on joining quarter.
   - *Recommendation*: AIIMS project administration should formalize whether joiners after the 15th of any month earn CL for that month.
2. **Duty Verification for Comp-Off Claims**:
   - *Current Implementation*: Automated cross-check with attendance check-in records (`attendance.db`).
   - *Recommendation*: Super-admin sign-off required for camp locations lacking GPS check-in capability.
3. **Maternity and Paternity Leave**:
   - Statutory provisions (180 days for maternity, 15 days for paternity) are configured in policy tables as discretionary requests requiring manual verification of medical certification.
