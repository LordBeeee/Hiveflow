import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

export abstract class StorageService {
  abstract put(key: string, bytes: Buffer, mime: string): Promise<void>;
  abstract get(key: string): Promise<Readable>;
  abstract remove(key: string): Promise<void>;
  abstract signedUrl(key: string): Promise<string>;
}

@Injectable()
export class S3StorageService
  extends StorageService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(config: ConfigService) {
    super();
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      region: config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
      maxAttempts: 3,
    });
  }
  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      throw new Error(
        'Object storage is unavailable. Check S3 configuration and the bucket bootstrap.',
      );
    }
  }
  async put(key: string, bytes: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );
  }
  async get(key: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!(result.Body instanceof Readable))
      throw new Error('Object storage returned an invalid stream');
    return result.Body;
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  signedUrl(key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 900 },
    );
  }
  onModuleDestroy() {
    this.client.destroy();
  }
}
