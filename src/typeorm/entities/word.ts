import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Country } from './country';
import { User } from './user';
import { Definition } from './definition';

@Entity({ name: 'words' })
export class Word {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @ManyToOne(() => User, (user: User) => user.words)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: false })
  userId: number;

  @OneToMany(() => Definition, (definition) => definition.word)
  definitions: Definition[];

  // Not using { unique: true } because there may be words that are spelled the
  // same but have different meanings in different languages
  @Column({ nullable: false })
  arabicWord: string;

  // Franco-Arabic translations are not required
  @Column({ nullable: true })
  francoArabicWord: string;

  @ManyToMany(() => Country)
  @JoinTable()
  countries: Country[];

  @Column()
  createdAt: Date;

  // The number of times a word has been reported as inappropriate / incorrect.
  // This will need to be updated when a new row is added to the reports table.
  @Column({ default: 0 })
  reportCount: number;
}
