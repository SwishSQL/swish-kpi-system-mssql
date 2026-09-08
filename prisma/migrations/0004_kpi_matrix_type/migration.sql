-- Matrix becomes a fixed category that drives scoring, not just a free-text
-- label. scoreCap/zeroActualIsPerfect are dropped: every live KPI in the
-- Postgres original held the default value, so removing them changes no
-- existing score.

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Kpi] ADD [matrixType] NVARCHAR(1000) NOT NULL CONSTRAINT [Kpi_matrixType_df] DEFAULT 'UNIT';

-- Backfill: categorize every existing KPI from its old free-text "matrix"
-- label, using the same rule the Excel importer already applies
-- (isPercentMatrix in src/lib/importer.ts) so a KPI imported yesterday and
-- one migrated today land the same way. Everything that isn't recognizably
-- a percentage or a time/day/hour unit defaults to UNIT, which keeps today's
-- ratio-based scoring unchanged for those rows, including any blank matrix.
-- The default collation on this database is case-insensitive, matching every
-- other text match in this port, so no explicit COLLATE is needed here.
UPDATE [dbo].[Kpi]
SET [matrixType] = 'PERCENTAGE'
WHERE [matrix] LIKE '%[%]%' OR [matrix] LIKE '%score%/%100%';

UPDATE [dbo].[Kpi]
SET [matrixType] = 'TIME'
WHERE [matrixType] = 'UNIT'
  AND ([matrix] LIKE '%time%' OR [matrix] LIKE '%day%' OR [matrix] LIKE '%hour%');

-- AlterTable: drop the two fields that never varied from their default in
-- the Postgres original.
ALTER TABLE [dbo].[Kpi] DROP COLUMN [scoreCap];
ALTER TABLE [dbo].[Kpi] DROP COLUMN [zeroActualIsPerfect];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
