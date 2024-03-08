import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Word } from './word';
import { User } from './user';

@Entity({ name: 'word-reports' })
export class WordReport {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @ManyToOne(() => Word)
  word: Word;

  @ManyToOne(() => User)
  reportingUser: User;

  @ManyToOne(() => User)
  reportedUser: User;

  @Column({ nullable: false })
  reportText: string;

  @Column({ nullable: false })
  AddedTimestamp: Date;
}
