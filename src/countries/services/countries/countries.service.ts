import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Country } from '../../../typeorm/entities/country';

@Injectable()
export class CountriesService {
  constructor(
    @InjectRepository(Country)
    private countriesRepository: Repository<Country>,
  ) {}

  async getAllCountries(): Promise<Country[]> {
    return this.countriesRepository.find();
  }

  async getCountryByCode(countryCode: string): Promise<Country> {
    return this.countriesRepository.findOne({ where: { countryCode } });
  }
}
