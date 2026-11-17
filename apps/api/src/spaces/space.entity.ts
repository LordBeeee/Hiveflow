import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SpaceGraph } from '@hiveflow/shared';

@Entity('spaces')
@Index('spaces_user_updated_idx', ['userId', 'updatedAt'])
export class SpaceEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'text' }) name!: string;
  @Column({ type: 'jsonb' }) graph!: SpaceGraph;
  @Column({ name: 'schema_version', type: 'int', default: 1 })
  schemaVersion!: number;
  @Column({ type: 'int', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
