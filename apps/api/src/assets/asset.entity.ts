import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { MediaKind } from '@hiveflow/shared';

@Entity('assets')
@Index('assets_space_idx', ['spaceId'])
export class AssetEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'space_id', type: 'uuid' }) spaceId!: string;
  @Column({ type: 'text', default: 'image' }) kind!: MediaKind;
  @Column({ name: 'storage_key', type: 'text' }) storageKey!: string;
  @Column({ type: 'text' }) url!: string;
  @Column({ type: 'text' }) mime!: string;
  @Column({
    name: 'size_bytes',
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  sizeBytes!: number;
  @Column({ type: 'int', nullable: true }) width!: number | null;
  @Column({ type: 'int', nullable: true }) height!: number | null;
  @Column({ name: 'duration_ms', type: 'int', nullable: true }) durationMs!:
    number | null;
  @Column({ type: 'text' }) sha256!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
