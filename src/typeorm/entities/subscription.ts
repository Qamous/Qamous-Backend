import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { User } from './user';

@Entity()
export class Subscription {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User)
  user: User;

  @Column()
  userId: number;

  @Column()
  status: 'active' | 'cancelled' | 'expired';

  @CreateDateColumn()
  startDate: Date;

  @Column()
  endDate: Date;

  @Column({ default: false })
  autoRenew: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 20.00 })
  amount: number;
}