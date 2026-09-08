-- A department head's edit to a Kpi or KpiAssignment for their own department
-- applies immediately but is flagged here for Compliance to review.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[EditRequest] (
    [id] NVARCHAR(1000) NOT NULL,
    [entityType] NVARCHAR(1000) NOT NULL,
    [entityId] NVARCHAR(1000) NOT NULL,
    [oldValues] NVARCHAR(max) NOT NULL,
    [newValues] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [EditRequest_status_df] DEFAULT 'PENDING',
    [requestedByUserId] NVARCHAR(1000) NOT NULL,
    [reviewedByUserId] NVARCHAR(1000),
    [rejectionReason] NVARCHAR(1000) NOT NULL CONSTRAINT [EditRequest_rejectionReason_df] DEFAULT '',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EditRequest_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [reviewedAt] DATETIME2,
    CONSTRAINT [EditRequest_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EditRequest_entityType_entityId_idx] ON [dbo].[EditRequest]([entityType], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EditRequest_status_idx] ON [dbo].[EditRequest]([status]);

-- AddForeignKey
ALTER TABLE [dbo].[EditRequest] ADD CONSTRAINT [EditRequest_requestedByUserId_fkey] FOREIGN KEY ([requestedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EditRequest] ADD CONSTRAINT [EditRequest_reviewedByUserId_fkey] FOREIGN KEY ([reviewedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

