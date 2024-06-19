import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Country } from './country';
import { Definition } from './definition';
import { Word } from './word';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ nullable: false })
  firstName: string;

  @Exclude()
  @Column({ nullable: false })
  lastName: string;

  @Exclude()
  @Column({ unique: true, nullable: false })
  email: string;

  @Column({ unique: true, nullable: false })
  username: string;

  @Exclude()
  @Column({ nullable: true })
  password: string;

  @Exclude()
  @Column({ nullable: true })
  dateOfBirth: Date;

  @Exclude() // TODO: temporary
  @Column({ nullable: true, type: 'blob' })
  profilePicture: Buffer;
  // TODO: should be a later feature... so everyone gets a null profile picture at first

  @Column({ default: 0 })
  likesReceived: number;

  @Column()
  createdAt: Date;

  @ManyToOne(() => Country)
  country: Country;

  @OneToMany(() => Definition, (definition) => definition.user)
  definitions: Definition[];

  @OneToMany(() => Word, (word) => word.user)
  words: Word[];
}
