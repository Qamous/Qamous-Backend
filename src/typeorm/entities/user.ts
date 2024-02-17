import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true })
  username: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  dateOfBirth: Date;

  @Column({ nullable: true, type: 'blob' })
  profilePicture: Buffer;
  // should be a later feature... so everyone gets a null profile picture
  // at first

  @Column({ default: 0 })
  likesReceived: number;

  @Column()
  createdAt: Date;
}
