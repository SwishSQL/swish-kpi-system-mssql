-- Matrix becomes a fixed category that drives scoring, not just a free-text
-- label. scoreCap/zeroActualIsPerfect are dropped: every live KPI in the
-- Postgres original held the default value, so removing them changes no
-- existing score.

BEGIN TRY

BEGIN TRAN;

-- Add matrixType
ALTER TABLE [dbo].[Kpi]
ADD [matrixType] NVARCHAR(1000) NOT NULL
CONSTRAINT [Kpi_matrixType_df] DEFAULT 'UNIT';

-- Dynamic SQL is required because SQL Server may compile the UPDATE
-- before the newly added matrixType column is visible.

EXEC sp_executesql N'
UPDATE [dbo].[Kpi]
SET [matrixType] = ''PERCENTAGE''
WHERE [matrix] LIKE ''%[%]%''
   OR [matrix] LIKE ''%score%/%100%'';
';

EXEC sp_executesql N'
UPDATE [dbo].[Kpi]
SET [matrixType] = ''TIME''
WHERE [matrixType] = ''UNIT''
  AND (
        [matrix] LIKE ''%time%''
        OR [matrix] LIKE ''%day%''
        OR [matrix] LIKE ''%hour%''
      );
';

-- SQL Server requires default constraints to be removed
-- before their columns can be dropped.

ALTER TABLE [dbo].[Kpi]
DROP CONSTRAINT [Kpi_scoreCap_df];

ALTER TABLE [dbo].[Kpi]
DROP CONSTRAINT [Kpi_zeroActualIsPerfect_df];

-- Now the columns can be removed safely.

ALTER TABLE [dbo].[Kpi]
DROP COLUMN [scoreCap];

ALTER TABLE [dbo].[Kpi]
DROP COLUMN [zeroActualIsPerfect];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW;

END CATCH