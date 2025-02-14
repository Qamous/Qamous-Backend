import {
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Word } from './word';
import { User } from './user';
import { Exclude } from 'class-transformer';
import { Country } from './country';

@Entity({ name: 'definitions' })
export class Definition {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  // The definitions that we generate will have a user ID of 1
  @ManyToOne(() => Word, (word) => word.definitions)
  @JoinColumn({ name: 'wordId' })
  word: Word;

  @ManyToOne(() => User, (user) => user.definitions)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Country)
  @JoinColumn({ name: 'countryCode' })
  country: Country;

  @Column({ nullable: false })
  wordId: number;

  @Column({ nullable: false })
  userId: number;

  @Column({ nullable: true, type: 'char', length: 2 })
  countryCode: string;

  @Column({ nullable: false, length: 10000 })
  definition: string;

  // Examples are not required
  @Column({ nullable: true })
  example: string;

  @Column({ nullable: false })
  isArabic: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  AddedTimestamp: Date;

  @Column({ default: 0 })
  likeCount: number;

  @Column({ default: 0 })
  dislikeCount: number;

  // The number of times a definition has been reported as inappropriate / incorrect.
  @Exclude()
  @Column({ default: 0 })
  reportCount: number;
}
