import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Batch, SpaceGraph } from '@hiveflow/shared';
@Entity('batches')
export class BatchEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'space_id', type: 'uuid' }) spaceId!: string;
  @Column({ type: 'jsonb' }) graph!: SpaceGraph;
  @Column({ type: 'jsonb' }) levels!: string[][];
  @Column({ name: 'current_level', type: 'integer', default: 0 })
  currentLevel!: number;
  @Column({ type: 'boolean', default: false }) force!: boolean;
  @Column({ type: 'text' }) status!: Batch['status'];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
