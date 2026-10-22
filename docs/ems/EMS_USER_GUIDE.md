# EMS User Guide: Employee & Administrator Manual

## 1. Employee Guide: Managing Your Leaves & Balances

### 1.1 Navigating to Employee Management
1. Log in to the AIIMS CDER Fieldworker Attendance Portal (`/index.html`).
2. On Desktop: Click on the **Employee Management** tab in the main navigation bar.
3. On Mobile: Tap the **Leaves** tab in the bottom navigation bar.

---

### 1.2 Viewing Your Leave Balances
At the top of the EMS dashboard, you will see four balance cards:
- **Casual Leave (CL)**: Available balance for personal exigencies.
- **Earned Leave (EL)**: Available long-term privilege leave balance.
- **Restricted Holiday (RH)**: Available restricted holidays (max 2 per year).
- **Comp-Off (COMP_OFF)**: Accumulated compensatory off days from weekend/holiday duty.

---

### 1.3 How to Apply for Leave
1. Scroll down to the **Apply for Leave** card.
2. Select the **Leave Type** (`CL`, `EL`, `RH`, or `COMP_OFF`).
3. Select your **Start Date** and **End Date**.
4. For CL or Comp-Off, check **Half-Day (0.5 day)** if taking only a partial day.
5. As soon as you select dates, notice the **Live Calculation Preview** box:
   - It automatically calculates your deductible working days.
   - It clearly identifies any intervening holidays or Sundays that are not deducted from your balance.
6. Provide a clear, honest **Reason for Leave** in the text box.
7. Click **Submit Leave Request**.
8. A green notification banner confirms submission, and your new request appears in your **Leave Application History** table with the status `PENDING`.

---

### 1.4 Cancelling a Leave Request
If your plans change or an error was made:
1. Locate the request in your **Leave Application History** table.
2. If the request is in `PENDING` or future `APPROVED` status, click the **Cancel** button.
3. Confirm cancellation in the in-app dialog.
4. Your balance is immediately refunded.

---

### 1.5 Claiming Comp-Off for Weekend/Holiday Duty
If you performed field surveys on a Sunday or official holiday:
1. Navigate to the **Comp-Off Claims** section.
2. Enter the date of duty performed and a brief justification.
3. Submit the claim. Once approved by your administrator, 1 full day (or 0.5 day) will be added to your available Comp-Off balance.

---

## 2. Administrator Guide: Leave Approvals & Oversight

### 2.1 Accessing the EMS Admin Panel
1. Log in to the Administrative Web Panel (`/admin.html`).
2. In the left navigation menu, click **Employee Management (EMS)**.

---

### 2.2 Reviewing Pending Approvals
1. The **Pending Leave Approvals** table lists all applications awaiting administrative sanction.
2. The table displays:
   - Employee Name & Code (`FW-XXX`).
   - Leave Type and Dates.
   - Working Days Deductible.
   - Employee Reason.
3. Click the **Review** button to open the Decision Modal.

---

### 2.3 Taking Administrative Action
Inside the Decision Modal:
1. Review the employee's current balance and full application details.
2. Choose one of three actions:
   - **Approve**: Confirms the leave and marks the status as `APPROVED`. (Decision remarks optional).
   - **Reject**: Rejects the application and automatically refunds deducted days back to the employee's balance. (Remarks mandatory).
   - **Request Correction (Hold)**: Returns the application to the employee for date adjustments or clarification. (Remarks mandatory).
3. Click **Submit Decision**. The queue refreshes instantly.

---

### 2.4 Staff Leave Register & Audit
- Under **Staff Leave Register**, filter past and active leaves across the entire team by Employee, Leave Type, or Status (`APPROVED`, `REJECTED`, `CANCELLED`).
- View comprehensive audit trails showing reviewer identity, review timestamp, and decision remarks.
