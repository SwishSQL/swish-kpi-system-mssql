-- Department heads can propose a KPI for their own department; it stays
-- PENDING until Compliance or an Admin approves it. Every KPI created the
-- way the library has always worked keeps behaving exactly as today: it
-- defaults straight to APPROVED.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Kpi] ADD [approvalStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_approvalStatus_df] DEFAULT 'APPROVED',
[createdByUserId] NVARCHAR(1000),
[rejectionReason] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_rejectionReason_df] DEFAULT '';

-- AddForeignKey
ALTER TABLE [dbo].[Kpi] ADD CONSTRAINT [Kpi_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

