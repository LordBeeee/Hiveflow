import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { resolve } from 'node:path';
import { databaseOptions } from './options';

ConfigModule.forRoot({
  envFilePath: [resolve(__dirname, '../../../../.env'), '.env'],
});
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

export default new DataSource(databaseOptions(url));
