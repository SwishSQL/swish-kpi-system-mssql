-- A department head/line manager (or admin) marking that an employee was away
-- for a whole month, so getDueAssignments() excludes them from that month's
-- required/counted KPIs.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[EmployeeVacation] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeProfileId] NVARCHAR(1000) NOT NULL,
    [submissionMonth] NVARCHAR(1000) NOT NULL,
    [markedByUserId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EmployeeVacation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EmployeeVacation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EmployeeVacation_employeeProfileId_submissionMonth_key] UNIQUE NONCLUSTERED ([employeeProfileId],[submissionMonth])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmployeeVacation_submissionMonth_idx] ON [dbo].[EmployeeVacation]([submissionMonth]);

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeVacation] ADD CONSTRAINT [EmployeeVacation_employeeProfileId_fkey] FOREIGN KEY ([employeeProfileId]) REFERENCES [dbo].[EmployeeProfile]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeVacation] ADD CONSTRAINT [EmployeeVacation_markedByUserId_fkey] FOREIGN KEY ([markedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

