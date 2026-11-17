import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpaceEntity } from './space.entity';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  imports: [TypeOrmModule.forFeature([SpaceEntity])],
  controllers: [SpacesController],
  providers: [SpacesService],
})
export class SpacesModule {}
