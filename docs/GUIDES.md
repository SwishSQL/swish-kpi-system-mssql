# User Guides

## Employee

1. Sign in with your **work email**. First time: your password is your **Employee ID**; you must set a new password immediately.
2. The **Submissions** page shows your KPI card for the selected month (month picker in the top bar).
3. For each KPI row: enter the **Actual Result** (percentages as points — enter `79` for 79%), click **📎 Attach** and upload at least one evidence file (PDF/Excel/Word/image/CSV, max 10 MB, up to 5 files).
4. Expand a row (▸) for the description, calculation method, comments and attachment list.
5. Click **Submit** (or **Update** if results already exist). All KPIs are validated together — the button saves everything in one step; missing results or attachments are listed by KPI code.
6. **Dashboard** shows your scores, final monthly score and trend. The bell shows notifications (manager submissions on your behalf, reopened periods…).

## Direct Manager / Line Manager

Everything an employee has, plus:
- The Submissions page also lists **all direct and indirect reports** in your branch.
- You can enter results and upload evidence **on behalf of** any of your staff and submit for them (the employee is notified).
- Dashboard adds team completion, employee ranking, below-threshold KPIs and a not-submitted list.

## Department Manager

Branch access plus the **entire department** (all line managers and employees), the department dashboard (Completed Employees Average, Strict Department Score, Submission Completion Rate) and submission rights for the whole department while the month is editable.

## Compliance Specialist

- Company-wide access: use the **Department selector** in the top bar (All Departments or a specific one) — the employee list, dashboards, completion and search all follow the selection.
- Can view and submit/update results for any employee while the period allows it.
- Filters: month, department, manager, employee, KPI, submission status, performance status.
- **Export CSV** from the dashboard for any month.
- KPI Library / Assignments management and Imports are available when the Admin grants those permissions (overrides in Admin → Permissions).

## Admin / Super Admin / HR Admin

- **Users**: create users (Employee ID, name, work email, role, department; temporary password defaults to the Employee ID), edit roles, activate/deactivate, reset passwords.
- **Departments**: create/edit departments and assign Department Managers.
- **Hierarchy**: tree view with report counts; assign/remove direct managers (self-reporting and cycles are blocked, cross-department needs an override), move employees between departments, deactivate employees; warnings for employees without managers and departments without managers.
- **KPI Library**: define KPIs (U/D variance, targets, thresholds, weights, frequency, form of submission, score cap, zero-is-perfect flag).
- **Assignments**: assign KPIs per employee per year; weight totals per employee are flagged when ≠ 100%.
- **Periods**: open/close/lock/reopen months, deadlines and grace periods. Locking freezes all submissions of that month.
- **Permissions**: role × permission matrix plus per-user allow/deny overrides. You cannot grant a permission you do not hold (Super Admin excepted).
- **Import**: the workbook wizard (see README).
- **Audit Log**: searchable, filterable trail of every important action with before/after values.
