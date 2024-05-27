import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Word } from './word';
import { User } from './user';
import { Exclude } from 'class-transformer';

@Entity({ name: 'word-reports' })
export class WordReport {
  @Exclude()
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Exclude()
  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  reportingUser: User;

  @Column({ nullable: false })
  userId: number;

  @ManyToOne(() => Word)
  @JoinColumn({ name: 'wordId' })
  reportedWord: Word;

  @Column({ nullable: false })
  wordId: number;

  @Exclude()
  @Column({ nullable: false, type: 'text' })
  reportText: string;

  @Exclude()
  @CreateDateColumn()
  createdAt: Date;
}
