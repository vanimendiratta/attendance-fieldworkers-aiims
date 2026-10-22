# EMS Role and Permission Matrix

## 1. Overview of System Roles

The integrated AIIMS CDER system recognizes four primary tiers of authorization:

1. **Employee / Fieldworker (`employee`)**: Standard field investigators, data entry operators, and research staff assigned across states and districts.
2. **State-Level Administrator (`state_admin`)**: Regional supervisory administrators responsible for specific state/UT clusters.
3. **Institutional Administrator (`admin`)**: Central project administrators managing attendance and leave approvals for AIIMS CDER.
4. **Super Administrator (`super_admin`)**: System engineers with full administrative access, policy configuration, and ledger adjustment privileges.

---

## 2. Granular Permissions Matrix

| Feature / Action | `employee` | `state_admin` | `admin` | `super_admin` |
| :--- | :---: | :---: | :---: | :---: |
| **View Own Balances & Ledger** | Allowed | Allowed | Allowed | Allowed |
| **Simulate Working-Days Deduction** | Allowed | Allowed | Allowed | Allowed |
| **Submit Leave Request** | Allowed | Allowed | Allowed | Allowed |
| **Cancel Own Leave Application** | Allowed | Allowed | Allowed | Allowed |
| **Submit Comp-Off Duty Claim** | Allowed (Fieldworkers) | Allowed | Allowed | Allowed |
| **View Pending Approvals Queue** | Denied | Scoped (State/UT) | Allowed (Global) | Allowed (Global) |
| **Approve / Reject Leave Request** | Denied | Scoped (State/UT) | Allowed (Global) | Allowed (Global) |
| **Hold / Request Correction** | Denied | Scoped (State/UT) | Allowed (Global) | Allowed (Global) |
| **Approve Own Leave Request** | **PROHIBITED** | **PROHIBITED** | **PROHIBITED** | **PROHIBITED** |
| **View Staff Leave Register** | Denied | Scoped (State/UT) | Allowed (Global) | Allowed (Global) |
| **Review Comp-Off Duty Claims** | Denied | Scoped (State/UT) | Allowed (Global) | Allowed (Global) |
| **Perform Manual Balance Adjustment** | Denied | Denied | Denied | Allowed |
| **Configure Leave Policy Rules** | Denied | Denied | View Only | Allowed |
| **Trigger Batch Credit Schedules** | Denied | Denied | View Only | Allowed |

---

## 3. Jurisdiction & Scope Boundaries

### 3.1 State and District Boundaries
- State-level administrators (`state_admin`) are assigned specific `state` and `district` attributes in their profile.
- When retrieving pending approvals (`GET /api/ems/admin/leave/pending`), the query restricts rows by:
  ```sql
  WHERE employees.state = ? AND employees.district = ?
  ```
- Any attempt by a `state_admin` to approve a leave request belonging to an employee outside their jurisdiction returns `403 Forbidden`.

### 3.2 Anti-Self-Approval Safeguard
To maintain strict institutional integrity:
- An administrator cannot approve, reject, or hold their own leave application.
- The backend evaluates:
  ```javascript
  if (leaveRequest.employee_id === reviewer.id) {
    return res.status(403).json({ success: false, error: 'Self-approval is prohibited by AIIMS CDER leave policy.' });
  }
  ```
- When an administrator requires leave, their application must be submitted through their employee profile and approved by a peer or super administrator.

---

## 4. Enforcement Points

| Enforcement Layer | File Path | Mechanism |
| :--- | :--- | :--- |
| **Route Protection** | `ems/server/middleware/authMiddleware.js` | `authenticateToken` validates session or JWT identity. |
| **Role Restriction** | `ems/server/middleware/authMiddleware.js` | `requireAdmin`, `requireSuperAdmin` checks user role. |
| **Resource Ownership** | `ems/server/controllers/leaveController.js` | Verifies `req.user.id === target_employee_id`. |
| **State Boundary** | `ems/server/controllers/adminController.js` | Filters datasets by `req.user.assigned_state`. |
