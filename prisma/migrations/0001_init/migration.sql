BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeId] NVARCHAR(1000) NOT NULL,
    [fullName] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [systemRole] NVARCHAR(1000) NOT NULL CONSTRAINT [User_systemRole_df] DEFAULT 'EMPLOYEE',
    [mustChangePassword] BIT NOT NULL CONSTRAINT [User_mustChangePassword_df] DEFAULT 1,
    [isActive] BIT NOT NULL CONSTRAINT [User_isActive_df] DEFAULT 1,
    [failedLoginAttempts] INT NOT NULL CONSTRAINT [User_failedLoginAttempts_df] DEFAULT 0,
    [lockedUntil] DATETIME2,
    [lastLoginAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_employeeId_key] UNIQUE NONCLUSTERED ([employeeId]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(1000) NOT NULL,
    [tokenHash] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [ipAddress] NVARCHAR(1000),
    [userAgent] NVARCHAR(1000),
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Session_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Session_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[Permission] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000) NOT NULL CONSTRAINT [Permission_description_df] DEFAULT '',
    CONSTRAINT [Permission_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Permission_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[RolePermission] (
    [id] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL,
    [permissionId] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [RolePermission_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RolePermission_role_permissionId_key] UNIQUE NONCLUSTERED ([role],[permissionId])
);

-- CreateTable
CREATE TABLE [dbo].[UserPermissionOverride] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [permissionId] NVARCHAR(1000) NOT NULL,
    [allowed] BIT NOT NULL,
    CONSTRAINT [UserPermissionOverride_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserPermissionOverride_userId_permissionId_key] UNIQUE NONCLUSTERED ([userId],[permissionId])
);

-- CreateTable
CREATE TABLE [dbo].[Department] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [departmentManagerEmployeeId] NVARCHAR(1000),
    [isActive] BIT NOT NULL CONSTRAINT [Department_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Department_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Department_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Department_code_key] UNIQUE NONCLUSTERED ([code]),
    CONSTRAINT [Department_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[EmployeeProfile] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [employeeId] NVARCHAR(1000) NOT NULL,
    [fullName] NVARCHAR(1000) NOT NULL,
    [departmentId] NVARCHAR(1000),
    [position] NVARCHAR(1000),
    [perspective] NVARCHAR(1000),
    [dateOfHiring] DATETIME2,
    [directManagerEmployeeId] NVARCHAR(1000),
    [crossDepartmentOverride] BIT NOT NULL CONSTRAINT [EmployeeProfile_crossDepartmentOverride_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [EmployeeProfile_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EmployeeProfile_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [EmployeeProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EmployeeProfile_employeeId_key] UNIQUE NONCLUSTERED ([employeeId])
);

-- CreateTable
CREATE TABLE [dbo].[Kpi] (
    [id] NVARCHAR(1000) NOT NULL,
    [kpiCode] NVARCHAR(1000) NOT NULL,
    [kpiName] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(max) NOT NULL CONSTRAINT [Kpi_description_df] DEFAULT '',
    [calculationMethod] NVARCHAR(max) NOT NULL CONSTRAINT [Kpi_calculationMethod_df] DEFAULT '',
    [varianceIndicator] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_varianceIndicator_df] DEFAULT 'U',
    [matrix] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_matrix_df] DEFAULT '',
    [defaultTarget] FLOAT(53),
    [targetText] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_targetText_df] DEFAULT '',
    [defaultThreshold] FLOAT(53),
    [defaultWeight] FLOAT(53),
    [frequency] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_frequency_df] DEFAULT 'Monthly',
    [responsibleDepartmentText] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_responsibleDepartmentText_df] DEFAULT '',
    [responsibleDepartmentId] NVARCHAR(1000),
    [formOfSubmission] NVARCHAR(max) NOT NULL CONSTRAINT [Kpi_formOfSubmission_df] DEFAULT '',
    [scoreCap] FLOAT(53) NOT NULL CONSTRAINT [Kpi_scoreCap_df] DEFAULT 100,
    [zeroActualIsPerfect] BIT NOT NULL CONSTRAINT [Kpi_zeroActualIsPerfect_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [Kpi_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Kpi_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Kpi_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Kpi_kpiCode_key] UNIQUE NONCLUSTERED ([kpiCode])
);

-- CreateTable
CREATE TABLE [dbo].[KpiAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeProfileId] NVARCHAR(1000) NOT NULL,
    [kpiId] NVARCHAR(1000) NOT NULL,
    [year] INT NOT NULL,
    [target] FLOAT(53) NOT NULL,
    [threshold] FLOAT(53) NOT NULL,
    [weight] FLOAT(53) NOT NULL,
    [frequency] NVARCHAR(1000) NOT NULL CONSTRAINT [KpiAssignment_frequency_df] DEFAULT 'Monthly',
    [formOfSubmission] NVARCHAR(1000) NOT NULL CONSTRAINT [KpiAssignment_formOfSubmission_df] DEFAULT '',
    [effectiveFrom] DATETIME2 NOT NULL,
    [effectiveTo] DATETIME2,
    [isActive] BIT NOT NULL CONSTRAINT [KpiAssignment_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [KpiAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [KpiAssignment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [KpiAssignment_employeeProfileId_kpiId_year_effectiveFrom_key] UNIQUE NONCLUSTERED ([employeeProfileId],[kpiId],[year],[effectiveFrom])
);

-- CreateTable
CREATE TABLE [dbo].[SubmissionPeriod] (
    [id] NVARCHAR(1000) NOT NULL,
    [month] INT NOT NULL,
    [year] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [SubmissionPeriod_status_df] DEFAULT 'OPEN',
    [opensAt] DATETIME2,
    [deadlineAt] DATETIME2,
    [gracePeriodEndsAt] DATETIME2,
    [lockedAt] DATETIME2,
    [reopenedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SubmissionPeriod_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SubmissionPeriod_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SubmissionPeriod_year_month_key] UNIQUE NONCLUSTERED ([year],[month])
);

-- CreateTable
CREATE TABLE [dbo].[KpiSubmission] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeProfileId] NVARCHAR(1000) NOT NULL,
    [kpiAssignmentId] NVARCHAR(1000) NOT NULL,
    [submissionMonth] NVARCHAR(1000) NOT NULL,
    [actualResult] FLOAT(53) NOT NULL,
    [rawSourceValue] NVARCHAR(1000),
    [normalizedActualResult] FLOAT(53) NOT NULL,
    [calculatedScore] FLOAT(53) NOT NULL,
    [weightedScore] FLOAT(53) NOT NULL,
    [submissionStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [KpiSubmission_submissionStatus_df] DEFAULT 'SUBMITTED',
    [performanceStatus] NVARCHAR(1000) NOT NULL,
    [comment] NVARCHAR(max) NOT NULL CONSTRAINT [KpiSubmission_comment_df] DEFAULT '',
    [submittedByUserId] NVARCHAR(1000),
    [submittedOnBehalfOfEmployee] BIT NOT NULL CONSTRAINT [KpiSubmission_submittedOnBehalfOfEmployee_df] DEFAULT 0,
    [version] INT NOT NULL CONSTRAINT [KpiSubmission_version_df] DEFAULT 1,
    [idempotencyKey] NVARCHAR(1000),
    [submittedAt] DATETIME2 NOT NULL CONSTRAINT [KpiSubmission_submittedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [lockedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [KpiSubmission_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [KpiSubmission_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [KpiSubmission_kpiAssignmentId_submissionMonth_key] UNIQUE NONCLUSTERED ([kpiAssignmentId],[submissionMonth])
);

-- CreateTable
CREATE TABLE [dbo].[SubmissionApproval] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeProfileId] NVARCHAR(1000) NOT NULL,
    [submissionMonth] NVARCHAR(1000) NOT NULL,
    [stage] NVARCHAR(1000) NOT NULL CONSTRAINT [SubmissionApproval_stage_df] DEFAULT 'PENDING_LINE_MANAGER',
    [submittedByUserId] NVARCHAR(1000),
    [submittedAt] DATETIME2 NOT NULL CONSTRAINT [SubmissionApproval_submittedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lineManagerUserId] NVARCHAR(1000),
    [lineManagerAt] DATETIME2,
    [departmentManagerUserId] NVARCHAR(1000),
    [departmentManagerAt] DATETIME2,
    [complianceUserId] NVARCHAR(1000),
    [complianceAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SubmissionApproval_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SubmissionApproval_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SubmissionApproval_employeeProfileId_submissionMonth_key] UNIQUE NONCLUSTERED ([employeeProfileId],[submissionMonth])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [approvalId] NVARCHAR(1000) NOT NULL,
    [action] NVARCHAR(1000) NOT NULL,
    [stage] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [comment] NVARCHAR(max) NOT NULL CONSTRAINT [ApprovalEvent_comment_df] DEFAULT '',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ApprovalEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ApprovalEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Attachment] (
    [id] NVARCHAR(1000) NOT NULL,
    [submissionId] NVARCHAR(1000) NOT NULL,
    [originalFileName] NVARCHAR(1000) NOT NULL,
    [storageKey] NVARCHAR(1000) NOT NULL,
    [fileUrl] NVARCHAR(1000),
    [mimeType] NVARCHAR(1000) NOT NULL,
    [fileSize] INT NOT NULL,
    [checksum] NVARCHAR(1000) NOT NULL,
    [data] VARBINARY(max),
    [uploadedByUserId] NVARCHAR(1000),
    [uploadedAt] DATETIME2 NOT NULL CONSTRAINT [Attachment_uploadedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Attachment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Attachment_storageKey_key] UNIQUE NONCLUSTERED ([storageKey]),
    CONSTRAINT [Attachment_submissionId_checksum_key] UNIQUE NONCLUSTERED ([submissionId],[checksum])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [action] NVARCHAR(1000) NOT NULL,
    [entityType] NVARCHAR(1000) NOT NULL,
    [entityId] NVARCHAR(1000),
    [oldValues] NVARCHAR(max),
    [newValues] NVARCHAR(max),
    [ipAddress] NVARCHAR(1000),
    [userAgent] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ImportJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [fileName] NVARCHAR(1000) NOT NULL,
    [importType] NVARCHAR(1000) NOT NULL,
    [workbookSheetName] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [ImportJob_status_df] DEFAULT 'PENDING',
    [totalRows] INT NOT NULL CONSTRAINT [ImportJob_totalRows_df] DEFAULT 0,
    [validRows] INT NOT NULL CONSTRAINT [ImportJob_validRows_df] DEFAULT 0,
    [failedRows] INT NOT NULL CONSTRAINT [ImportJob_failedRows_df] DEFAULT 0,
    [errorReport] NVARCHAR(max),
    [summary] NVARCHAR(max),
    [uploadedByUserId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ImportJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [completedAt] DATETIME2,
    CONSTRAINT [ImportJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Notification] (
    [id] NVARCHAR(1000) NOT NULL,
    [recipientUserId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [message] NVARCHAR(max) NOT NULL,
    [entityType] NVARCHAR(1000),
    [entityId] NVARCHAR(1000),
    [link] NVARCHAR(1000) NOT NULL CONSTRAINT [Notification_link_df] DEFAULT '',
    [isRead] BIT NOT NULL CONSTRAINT [Notification_isRead_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Notification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SystemSetting] (
    [key] NVARCHAR(1000) NOT NULL,
    [value] NVARCHAR(max) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SystemSetting_pkey] PRIMARY KEY CLUSTERED ([key])
);

-- EmployeeProfile.userId is nullable and most profiles have no login;
-- a plain UNIQUE would forbid the second NULL. Filtered index = Postgres semantics.
CREATE UNIQUE NONCLUSTERED INDEX [EmployeeProfile_userId_key] ON [dbo].[EmployeeProfile]([userId]) WHERE [userId] IS NOT NULL;

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_email_idx] ON [dbo].[User]([email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_isActive_idx] ON [dbo].[User]([isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_expiresAt_idx] ON [dbo].[Session]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmployeeProfile_departmentId_idx] ON [dbo].[EmployeeProfile]([departmentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmployeeProfile_directManagerEmployeeId_idx] ON [dbo].[EmployeeProfile]([directManagerEmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmployeeProfile_isActive_idx] ON [dbo].[EmployeeProfile]([isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [KpiAssignment_employeeProfileId_year_isActive_idx] ON [dbo].[KpiAssignment]([employeeProfileId], [year], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [KpiAssignment_kpiId_idx] ON [dbo].[KpiAssignment]([kpiId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [KpiSubmission_employeeProfileId_submissionMonth_idx] ON [dbo].[KpiSubmission]([employeeProfileId], [submissionMonth]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [KpiSubmission_submissionMonth_idx] ON [dbo].[KpiSubmission]([submissionMonth]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SubmissionApproval_stage_idx] ON [dbo].[SubmissionApproval]([stage]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SubmissionApproval_submissionMonth_idx] ON [dbo].[SubmissionApproval]([submissionMonth]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalEvent_approvalId_idx] ON [dbo].[ApprovalEvent]([approvalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Attachment_submissionId_idx] ON [dbo].[Attachment]([submissionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_userId_idx] ON [dbo].[AuditLog]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_entityType_entityId_idx] ON [dbo].[AuditLog]([entityType], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_action_idx] ON [dbo].[AuditLog]([action]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_createdAt_idx] ON [dbo].[AuditLog]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_recipientUserId_isRead_idx] ON [dbo].[Notification]([recipientUserId], [isRead]);

-- AddForeignKey
ALTER TABLE [dbo].[Session] ADD CONSTRAINT [Session_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_permissionId_fkey] FOREIGN KEY ([permissionId]) REFERENCES [dbo].[Permission]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UserPermissionOverride] ADD CONSTRAINT [UserPermissionOverride_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UserPermissionOverride] ADD CONSTRAINT [UserPermissionOverride_permissionId_fkey] FOREIGN KEY ([permissionId]) REFERENCES [dbo].[Permission]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeProfile] ADD CONSTRAINT [EmployeeProfile_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeProfile] ADD CONSTRAINT [EmployeeProfile_departmentId_fkey] FOREIGN KEY ([departmentId]) REFERENCES [dbo].[Department]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeProfile] ADD CONSTRAINT [EmployeeProfile_directManagerEmployeeId_fkey] FOREIGN KEY ([directManagerEmployeeId]) REFERENCES [dbo].[EmployeeProfile]([employeeId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Kpi] ADD CONSTRAINT [Kpi_responsibleDepartmentId_fkey] FOREIGN KEY ([responsibleDepartmentId]) REFERENCES [dbo].[Department]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[KpiAssignment] ADD CONSTRAINT [KpiAssignment_employeeProfileId_fkey] FOREIGN KEY ([employeeProfileId]) REFERENCES [dbo].[EmployeeProfile]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[KpiAssignment] ADD CONSTRAINT [KpiAssignment_kpiId_fkey] FOREIGN KEY ([kpiId]) REFERENCES [dbo].[Kpi]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[KpiSubmission] ADD CONSTRAINT [KpiSubmission_employeeProfileId_fkey] FOREIGN KEY ([employeeProfileId]) REFERENCES [dbo].[EmployeeProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[KpiSubmission] ADD CONSTRAINT [KpiSubmission_kpiAssignmentId_fkey] FOREIGN KEY ([kpiAssignmentId]) REFERENCES [dbo].[KpiAssignment]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[KpiSubmission] ADD CONSTRAINT [KpiSubmission_submittedByUserId_fkey] FOREIGN KEY ([submittedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SubmissionApproval] ADD CONSTRAINT [SubmissionApproval_employeeProfileId_fkey] FOREIGN KEY ([employeeProfileId]) REFERENCES [dbo].[EmployeeProfile]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SubmissionApproval] ADD CONSTRAINT [SubmissionApproval_submittedByUserId_fkey] FOREIGN KEY ([submittedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SubmissionApproval] ADD CONSTRAINT [SubmissionApproval_lineManagerUserId_fkey] FOREIGN KEY ([lineManagerUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SubmissionApproval] ADD CONSTRAINT [SubmissionApproval_departmentManagerUserId_fkey] FOREIGN KEY ([departmentManagerUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SubmissionApproval] ADD CONSTRAINT [SubmissionApproval_complianceUserId_fkey] FOREIGN KEY ([complianceUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalEvent] ADD CONSTRAINT [ApprovalEvent_approvalId_fkey] FOREIGN KEY ([approvalId]) REFERENCES [dbo].[SubmissionApproval]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalEvent] ADD CONSTRAINT [ApprovalEvent_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Attachment] ADD CONSTRAINT [Attachment_submissionId_fkey] FOREIGN KEY ([submissionId]) REFERENCES [dbo].[KpiSubmission]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Attachment] ADD CONSTRAINT [Attachment_uploadedByUserId_fkey] FOREIGN KEY ([uploadedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportJob] ADD CONSTRAINT [ImportJob_uploadedByUserId_fkey] FOREIGN KEY ([uploadedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_recipientUserId_fkey] FOREIGN KEY ([recipientUserId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

