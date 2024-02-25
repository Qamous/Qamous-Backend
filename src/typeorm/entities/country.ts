import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'country' })
export class Country {
  @PrimaryColumn({
    type: 'char',
    length: 2,
    unique: true,
    nullable: false,
  })
  countryCode: string;

  @Column({ unique: true, nullable: false })
  countryName: string;
}
