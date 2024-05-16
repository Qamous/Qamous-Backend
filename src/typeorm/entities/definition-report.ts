import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user';
import { Definition } from './definition';
import { Exclude } from 'class-transformer';

@Entity({ name: 'definition_reports' })
export class DefinitionReport {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Exclude()
  @ManyToOne(() => User, (user) => user.id)
  reportingUser: User;

  @Exclude()
  @ManyToOne(() => User, (user) => user.id)
  reportedUser: User;

  @ManyToOne(() => Definition, (definition) => definition.id)
  reportedDefinition: Definition;

  @Exclude()
  @Column({ nullable: false, type: 'text' })
  reportText: string;

  @Exclude()
  @CreateDateColumn()
  createdAt: Date;
}
