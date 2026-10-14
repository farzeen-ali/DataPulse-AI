import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { SchemaContextService } from './context/schema-context.service';
import { QueryExecutorService } from './execution/query-executor.service';
import { IntentRouterService } from './intent/intent-router.service';
import { OverviewService } from './overview/overview.service';
import { AnalyticsPipelineService } from './pipeline/analytics-pipeline.service';
import { ResultProcessorService } from './results/result-processor.service';
import { SchemaService } from './schema/schema.service';
import { PromptGuardService } from './security/prompt-guard.service';
import { SqlValidatorService } from './security/sql-validator.service';
import { SqlGeneratorService } from './sql/sql-generator.service';
import { SummaryService } from './summary/summary.service';

@Module({
  controllers: [AnalyticsController],
  providers: [
    PromptGuardService,
    IntentRouterService,
    SchemaContextService,
    SqlGeneratorService,
    SqlValidatorService,
    QueryExecutorService,
    ResultProcessorService,
    SummaryService,
    AnalyticsPipelineService,
    SchemaService,
    OverviewService,
  ],
})
export class AnalyticsModule {}
