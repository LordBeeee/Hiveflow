import { Controller, Get } from '@nestjs/common';
import { APP_NAME, type HealthResponse } from '@hiveflow/shared';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok', app: APP_NAME };
  }
}
