import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { NodeRun, NodeType, RunOutput } from '@hiveflow/shared';

@Entity('node_runs')
export class NodeRunEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'space_id', type: 'uuid' }) spaceId!: string;
  @Column({ name: 'node_id', type: 'text' }) nodeId!: string;
  @Column({ name: 'node_type', type: 'text' }) nodeType!: NodeType;
  @Column({ type: 'bigint', generated: 'increment', unique: true })
  sequence!: string;
  @Column({ name: 'batch_id', type: 'uuid', nullable: true }) batchId!:
    string | null;
  @Column({ type: 'text' }) status!: NodeRun['status'];
  @Column({ name: 'input_hash', type: 'text' }) inputHash!: string;
  @Column({ type: 'jsonb' }) params!: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) output!: RunOutput | null;
  @Column({ type: 'text', nullable: true }) error!: string | null;
  @Column({ type: 'text', nullable: true }) provider!: string | null;
  @Column({ name: 'cache_hit', type: 'boolean', default: false })
  cacheHit!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
