import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user';
import { Definition } from './definition';
import { Exclude } from 'class-transformer';

@Entity({ name: 'definition-reports' })
export class DefinitionReport {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Exclude()
  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  reportingUser: User;

  @Column({ nullable: true })
  userId: number;

  @ManyToOne(() => Definition)
  @JoinColumn({ name: 'definitionId' })
  reportedDefinition: Definition;

  @Column({ nullable: false })
  definitionId: number;

  @Exclude()
  @Column({ nullable: false, type: 'text' })
  reportText: string;

  @Exclude()
  @CreateDateColumn()
  createdAt: Date;
}
