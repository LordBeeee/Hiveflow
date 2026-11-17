import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('assets')
@Index('assets_space_idx', ['spaceId'])
export class AssetEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'space_id', type: 'uuid' }) spaceId!: string;
  @Column({ type: 'text', default: 'image' }) kind!: 'image';
  @Column({ name: 'storage_key', type: 'text' }) storageKey!: string;
  @Column({ type: 'text' }) url!: string;
  @Column({ type: 'text' }) mime!: string;
  @Column({ name: 'size_bytes', type: 'int' }) sizeBytes!: number;
  @Column({ type: 'int' }) width!: number;
  @Column({ type: 'int' }) height!: number;
  @Column({ type: 'text' }) sha256!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
