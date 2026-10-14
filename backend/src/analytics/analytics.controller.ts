import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsQueryDto } from './dto/query.dto';
import { OverviewService } from './overview/overview.service';
import { AnalyticsPipelineService } from './pipeline/analytics-pipeline.service';
import { SchemaService } from './schema/schema.service';

/** Model calls are expensive: the query endpoint has its own, tighter limit. */
const queryLimit = () =>
  Number(process.env.QUERY_RATE_LIMIT_PER_MINUTE ?? 10) || 10;

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly pipeline: AnalyticsPipelineService,
    private readonly schema: SchemaService,
    private readonly overview: OverviewService,
  ) {}

  @Post('query')
  @HttpCode(200)
  @Throttle({ default: { limit: queryLimit, ttl: 60_000 } })
  query(@Body() dto: AnalyticsQueryDto) {
    return this.pipeline.run(dto.prompt);
  }

  @Get('schema')
  getSchema() {
    return this.schema.describe();
  }

  @Get('overview')
  getOverview() {
    return this.overview.getOverview();
  }
}
