-- Approval moves from the employee-month down to the individual KPI.
-- SubmissionApproval.stage stays, but is now the rollup of the KPI stages
-- inside it (the least advanced one) rather than the source of truth.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[KpiSubmission] ADD [stage] NVARCHAR(1000) NOT NULL CONSTRAINT [KpiSubmission_stage_df] DEFAULT 'PENDING_LINE_MANAGER';

-- AlterTable
ALTER TABLE [dbo].[ApprovalEvent] ADD [kpiCode] NVARCHAR(1000),
[kpiSubmissionId] NVARCHAR(1000);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalEvent_kpiSubmissionId_idx] ON [dbo].[ApprovalEvent]([kpiSubmissionId]);


-- Backfill: existing KPIs inherit the stage their employee-month had reached,
-- so nothing in flight changes position. Rows with no approval record keep the
-- default, which is where a fresh submission starts anyway.
UPDATE s
SET s.[stage] = a.[stage]
FROM [dbo].[KpiSubmission] s
INNER JOIN [dbo].[SubmissionApproval] a
  ON a.[employeeProfileId] = s.[employeeProfileId]
 AND a.[submissionMonth] = s.[submissionMonth];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

