import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Country } from './country';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ nullable: false })
  firstName: string;

  @Column({ nullable: false })
  lastName: string;

  @Column({ unique: true, nullable: false })
  email: string;

  @Column({ unique: true, nullable: false })
  username: string;

  @Column({ nullable: false })
  hashedPassword: string;

  @Column({ nullable: false })
  salt: string;

  @Column({ nullable: true })
  dateOfBirth: Date;

  @Column({ nullable: true, type: 'blob' })
  profilePicture: Buffer;
  // TODO: should be a later feature... so everyone gets a null profile picture at first

  @Column({ default: 0 })
  likesReceived: number;

  @Column()
  createdAt: Date;

  @ManyToOne(() => Country)
  country: Country;
}
