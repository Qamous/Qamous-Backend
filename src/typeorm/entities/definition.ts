import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Word } from './word';
import { User } from './user';

@Entity({ name: 'definitions' })
export class Definition {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @ManyToOne(() => Word)
  word: Word;

  // The definitions that we generate will have a user ID of 0
  @ManyToOne(() => User)
  user: User;

  @Column({ nullable: false })
  definition: string;

  // Examples are not required
  @Column({ nullable: true })
  example: string;

  @Column({ nullable: false })
  isArabic: boolean;

  @Column({ nullable: false })
  AddedTimestamp: Date;

  @Column({ default: 0 })
  likeCount: number;

  @Column({ default: 0 })
  dislikeCount: number;
}
