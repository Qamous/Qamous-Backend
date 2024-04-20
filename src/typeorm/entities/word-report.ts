import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Word } from './word';
import { User } from './user';
import { Exclude } from 'class-transformer';

@Entity({ name: 'word-reports' })
export class WordReport {
  @Exclude()
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Exclude()
  @ManyToOne(() => Word)
  word: Word;

  @Exclude()
  @ManyToOne(() => User)
  reportingUser: User;

  @Exclude()
  @ManyToOne(() => User)
  reportedUser: User;

  @Exclude()
  @Column({ nullable: false })
  reportText: string;

  @Exclude()
  @Column({ nullable: false })
  AddedTimestamp: Date;
}
